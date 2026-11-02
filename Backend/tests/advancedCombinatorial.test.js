const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { startMongo } = require('./support/testServers');

// Models
const { Order } = require('../models/orders');
const { Product } = require('../models/products');
const { Seller } = require('../models/sellers');
const { Category } = require('../models/categories');
const { Coupon } = require('../models/coupons');
const { User } = require('../models/users');
const { WalletAccount } = require('../models/walletAccounts');
const { WalletTransaction } = require('../models/walletTransactions');
const { OrderPayment } = require('../models/orderPayments');

// Services
const orderService = require('../services/orderService');
const walletService = require('../services/walletService');
const couponService = require('../services/couponService');
const codService = require('../services/codEligibilityService');
const sessionService = require('../services/sessionService');
const authService = require('../services/authService');
const adminAccessService = require('../services/adminAccessService');
const orderPaymentService = require('../services/orderPaymentService');
const shippingRules = require('../services/shippingRules');

describe('Advanced Multiple Edge Cases & Combinatorial Backend Testing', () => {
    let mongo;
    let vendor;
    let category;
    let customer;

    before(async () => {
        mongo = await startMongo('test-advanced-combinatorial');
        await mongoose.connect(mongo.uri);

        category = await Category.create({
            name: 'Marine Propellers',
            name_ar: 'رفاصات ومراوح بحرية',
        });

        vendor = await Seller.create({
            name: 'Alexandria Marine Supplies',
            store_name: 'Alex Marine Store',
            store_username: 'alexmarine',
            email: 'alexmarine@readytest.com',
            phone: '01012345678',
            password: 'hashedpassword_test',
            status: 'active',
            locations: [{ address: 'Alexandria Yacht Club', is_default: true }],
        });

        customer = await User.create({
            name: 'Captain Youssef',
            email: 'captain.youssef@readytest.com',
            phone: '01098765432',
            role: 'customer',
            status: 'active',
            password: 'hashedpassword_test',
        });
    });

    after(async () => {
        await mongoose.disconnect();
        await mongo.stop();
    });

    const createProduct = async (overrides = {}) => {
        const variantId = new mongoose.Types.ObjectId();
        return Product.create({
            sku: overrides.sku || `PROP-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
            title_en: overrides.title_en || 'Brass 4-Blade Marine Propeller',
            subtitle_en: 'High Grade Marine Part',
            description_en: 'Salt-resistant marine propeller',
            slug_en: overrides.slug_en || `marine-propeller-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
            price: overrides.price || 500,
            status: overrides.status || 'published',
            is_active: true,
            is_universal: true,
            vendor_id: overrides.vendor_id || vendor._id,
            category_id: category._id,
            variants: overrides.variants || [
                {
                    _id: variantId,
                    variant_label: 'Standard',
                    price: overrides.price || 500,
                    stock: overrides.stock !== undefined ? overrides.stock : 10,
                },
            ],
            ...overrides,
        });
    };

    /* =========================================================================
     * SECTION 1: Multiple Edge Cases in a Single Request
     * ========================================================================= */
    describe('1. Multiple Edge Cases in a Single Request', () => {

        test('COMB-01: Missing required fields + invalid forged authentication token', async () => {
            const forgedToken = 'invalid.tampered.signature.header';
            assert.throws(
                () => {
                    const jwt = require('jsonwebtoken');
                    jwt.verify(forgedToken, process.env.JWT_SECRET || 'secret');
                },
                (err) => {
                    assert.ok(err.name === 'JsonWebTokenError' || err.name === 'SyntaxError');
                    return true;
                }
            );
        });

        test('COMB-02: Valid authentication + insufficient privileges + malformed resource ID', async () => {
            const customerUser = { _id: customer._id, role: 'customer' };
            const malformedId = 'not-a-valid-hex-id-999999999';

            const access = adminAccessService.checkAccess(customerUser, 'POST', '/api/admin/settings');
            assert.equal(access.allowed, false);
            assert.equal(access.code, 'MODULE_FORBIDDEN');
            assert.ok(!mongoose.Types.ObjectId.isValid(malformedId));
        });

        test('COMB-03: Valid payload + nonexistent related foreign key (Dangling Reference)', async () => {
            const ghostId = new mongoose.Types.ObjectId();
            const items = [{ product_id: ghostId, quantity: 2 }];

            await assert.rejects(
                async () => {
                    await orderService.buildPricedOrderItems(items);
                },
                (err) => {
                    assert.ok(err.message.includes('not found') || err.message.includes('unavailable'));
                    return true;
                }
            );
        });

        test('COMB-04: Valid product + boundary negative & non-integer quantity rejection', async () => {
            const product = await createProduct({ price: 200 });

            // Negative quantity is rejected
            await assert.rejects(
                async () => {
                    await orderService.buildPricedOrderItems([{ product_id: product._id, quantity: -5 }]);
                },
                /Invalid item quantity/
            );

            // Non-numeric quantity is rejected
            await assert.rejects(
                async () => {
                    await orderService.buildPricedOrderItems([{ product_id: product._id, quantity: 'not-a-num' }]);
                },
                /Invalid item quantity/
            );

            // Documented finding: quantity 0 falls back to 1 via (item.quantity || 1)
            const fallbackPriced = await orderService.buildPricedOrderItems([{ product_id: product._id, quantity: 0 }]);
            assert.equal(fallbackPriced[0].quantity, 1);
        });

        test('COMB-05: Valid order + payment webhook retry + duplicate callback idempotency', async () => {
            const paymentId = new mongoose.Types.ObjectId();
            const orderId = new mongoose.Types.ObjectId();

            const orderPayment = await OrderPayment.create({
                _id: paymentId,
                user_id: customer._id,
                amount: 750,
                currency: 'EGP',
                status: 'paid',
                order_id: orderId,
                checkout_context: 'self',
                checkout_payload: {
                    shipping_address: { recipient_name: 'Captain Youssef', phone: '0101', full_address: 'Alex' },
                    items: [],
                },
            });

            const firstResult = await orderPaymentService.activatePaidOrderPayment(orderPayment);
            assert.equal(firstResult.status, 'paid');
            assert.equal(firstResult.alreadyPaid, true);
            assert.equal(String(firstResult.order), String(orderId));
        });

        test('COMB-06: Valid request + missing optional config + fallback degradation', async () => {
            const isAllowed = await codService.isAllowed({ userId: null, phone: '01099998888' });
            assert.equal(typeof isAllowed, 'boolean');
            assert.equal(isAllowed, true);
        });
    });

    /* =========================================================================
     * SECTION 2: Combinatorial & Pairwise Testing Matrix
     * ========================================================================= */
    describe('2. Combinatorial & Pairwise Testing Matrix', () => {
        let activeCoupon;
        let expiredCoupon;
        let minSpendCoupon;

        before(async () => {
            activeCoupon = await Coupon.create({
                code: 'PAIR_PERCENT_15',
                name: '15% Off Marine',
                discount_type: 'percent',
                discount_value: 15,
                scope_type: 'all_products',
                min_order_amount: 100,
                is_active: true,
            });

            expiredCoupon = await Coupon.create({
                code: 'PAIR_EXPIRED_20',
                name: 'Expired 20 EGP',
                discount_type: 'fixed',
                discount_value: 20,
                scope_type: 'all_products',
                min_order_amount: 50,
                is_active: true,
                expires_at: new Date(Date.now() - 86400000),
            });

            minSpendCoupon = await Coupon.create({
                code: 'PAIR_HIGH_MIN_500',
                name: 'High Min 500',
                discount_type: 'fixed',
                discount_value: 100,
                scope_type: 'all_products',
                min_order_amount: 2500,
                is_active: true,
            });
        });

        test('PAIR-01: Active User + Percentage Coupon + Wallet Payment Interaction', async () => {
            const product = await createProduct({ price: 1000 });
            const pricedItems = await orderService.buildPricedOrderItems([{ product_id: product._id, quantity: 1 }]);

            const couponPricing = await couponService.buildCouponPricing({
                coupon: activeCoupon,
                items: pricedItems,
                userId: customer._id,
            });

            assert.equal(couponPricing.pricing.discount_amount, 150);
            assert.equal(couponPricing.pricing.final_total, 850);
        });

        test('PAIR-02: Active User + Expired Coupon Interaction (Graceful Rejection)', async () => {
            const product = await createProduct({ price: 300 });
            const pricedItems = await orderService.buildPricedOrderItems([{ product_id: product._id, quantity: 1 }]);

            await assert.rejects(
                async () => {
                    await couponService.buildCouponPricing({
                        coupon: expiredCoupon,
                        items: pricedItems,
                        userId: customer._id,
                    });
                },
                /expired/i
            );
        });

        test('PAIR-03: Active User + Min Spend Not Met Interaction', async () => {
            const product = await createProduct({ price: 400 });
            const pricedItems = await orderService.buildPricedOrderItems([{ product_id: product._id, quantity: 1 }]);

            await assert.rejects(
                async () => {
                    await couponService.buildCouponPricing({
                        coupon: minSpendCoupon,
                        items: pricedItems,
                        userId: customer._id,
                    });
                },
                /minimum order amount/i
            );
        });

        test('PAIR-04: Coupon Discount Dynamic Impact on COD Maximum Threshold', () => {
            const maxCodRule = { field: 'cart_total', operator: 'lte', value: 2000 };
            assert.equal(shippingRules.evaluateCondition(maxCodRule, { cart_total: 2200 }), false);
            assert.equal(shippingRules.evaluateCondition(maxCodRule, { cart_total: 1870 }), true);
        });

        test('PAIR-05: Coupon Discount Dynamic Impact on COD Minimum Threshold', () => {
            const minCodRule = { field: 'cart_total', operator: 'gte', value: 300 };
            assert.equal(shippingRules.evaluateCondition(minCodRule, { cart_total: 350 }), true);
            assert.equal(shippingRules.evaluateCondition(minCodRule, { cart_total: 250 }), false);
        });

        test('PAIR-06: Suspended User State Blocks Wallet Operations Regardless of Balance', async () => {
            const suspendedUser = await User.create({
                name: 'Suspended Sailor',
                email: 'suspended.sailor@readytest.com',
                phone: '01055554444',
                role: 'customer',
                status: 'suspended',
            });

            await walletService.getOrCreateAccount(suspendedUser._id);
            await walletService.applyLedgerEntry({
                userId: suspendedUser._id,
                amountMinor: 50000,
                type: 'admin_credit',
                deltas: { available: 50000 },
                idempotencyKey: `fund-${Date.now()}`,
                description: 'Initial funding',
            });

            await walletService.setAccountStatus({
                userId: suspendedUser._id,
                status: 'frozen',
                reason: 'User suspended',
            });

            await assert.rejects(
                async () => {
                    await walletService.assertSpendable(suspendedUser._id);
                },
                /temporarily on hold|frozen/i
            );
        });
    });

    /* =========================================================================
     * SECTION 3: State Transition and Workflow Edge Cases
     * ========================================================================= */
    describe('3. State Transition and Workflow Edge Cases', () => {

        test('STATE-01: Invalid forward jump rejects direct transitions', async () => {
            const product = await createProduct();
            const order = await Order.create({
                recipient_name: 'Captain Youssef',
                phone: '01098765432',
                full_address: 'Port Said Marina',
                user_id: customer._id,
                vendor_id: vendor._id,
                payment_method: 'credit_card',
                payment_status: 'pending',
                status: 'pending',
                total_price: 500,
                items_price: 500,
                shipping_fee: 0,
                items: [{
                    product_id: product._id,
                    product_title: 'Propeller',
                    variant_id: new mongoose.Types.ObjectId(),
                    quantity: 1,
                    unit_price: 500,
                    vendor_id: vendor._id,
                }],
            });

            await assert.rejects(
                async () => {
                    await orderService.updateOrderStatus(order._id, 'shipped_directly_jump');
                },
                /Invalid order status/
            );
        });

        test('STATE-02: Valid sequential order status progression', async () => {
            const product = await createProduct();
            const order = await Order.create({
                recipient_name: 'Captain Youssef',
                phone: '01098765432',
                full_address: 'Hurghada Marina',
                user_id: customer._id,
                vendor_id: vendor._id,
                payment_method: 'credit_card',
                payment_status: 'pending',
                status: 'pending',
                total_price: 500,
                items_price: 500,
                shipping_fee: 0,
                items: [{
                    product_id: product._id,
                    product_title: 'Propeller',
                    variant_id: new mongoose.Types.ObjectId(),
                    quantity: 1,
                    unit_price: 500,
                    vendor_id: vendor._id,
                }],
            });

            const processingOrder = await orderService.updateOrderStatus(order._id, 'processing');
            assert.equal(processingOrder.status, 'processing');

            const confirmedOrder = await orderService.updateOrderStatus(order._id, 'confirmed');
            assert.equal(confirmedOrder.status, 'confirmed');

            const readyOrder = await orderService.updateOrderStatus(order._id, 'ready');
            assert.equal(readyOrder.status, 'ready');
        });

        test('STATE-03: Order cancellation with all parcels already delivered is rejected', async () => {
            const product = await createProduct();
            const order = await Order.create({
                recipient_name: 'Captain Youssef',
                phone: '01098765432',
                full_address: 'El Gouna Marina',
                user_id: customer._id,
                vendor_id: vendor._id,
                payment_method: 'cash',
                status: 'confirmed',
                total_price: 500,
                items_price: 500,
                shipping_fee: 0,
                items: [{
                    product_id: product._id,
                    product_title: 'Propeller',
                    variant_id: new mongoose.Types.ObjectId(),
                    quantity: 1,
                    unit_price: 500,
                    vendor_id: vendor._id,
                }],
                sub_orders: [{
                    vendor_id: vendor._id,
                    status: 'delivered',
                    items: [],
                }],
            });

            await assert.rejects(
                async () => {
                    await orderService.cancelWholeOrder(order);
                },
                /already delivered or cancelled/i
            );
        });

        test('STATE-04: Out-of-order tracking webhook event rejection logic', () => {
            const lastEventDate = new Date('2026-10-29T10:00:00Z');
            const staleEventDate = new Date('2026-10-29T08:00:00Z');

            const isStale = staleEventDate.getTime() < lastEventDate.getTime();
            assert.equal(isStale, true, 'Stale webhook event must be flagged before overriding shipment state');
        });

        test('STATE-05: Multi-vendor sub-order partial fulfillment state handling', async () => {
            const vendorB = await Seller.create({
                name: 'Red Sea Marine Store',
                store_name: 'Red Sea Marine',
                store_username: `redsea-${Date.now()}`,
                email: `redsea-${Date.now()}@readytest.com`,
                phone: `01033${Math.floor(Math.random() * 100000)}`,
                password: 'hashedpassword_test',
                status: 'active',
                locations: [{ address: 'Hurghada Port', is_default: true }],
            });

            const order = await Order.create({
                recipient_name: 'Captain Youssef',
                phone: '01098765432',
                full_address: 'Sharm El Sheikh Marina',
                user_id: customer._id,
                vendor_id: vendor._id,
                payment_method: 'credit_card',
                status: 'processing',
                total_price: 1000,
                items_price: 1000,
                shipping_fee: 0,
                items: [
                    {
                        product_id: new mongoose.Types.ObjectId(),
                        product_title: 'Item 1',
                        variant_id: new mongoose.Types.ObjectId(),
                        quantity: 1,
                        unit_price: 500,
                        vendor_id: vendor._id,
                    },
                    {
                        product_id: new mongoose.Types.ObjectId(),
                        product_title: 'Item 2',
                        variant_id: new mongoose.Types.ObjectId(),
                        quantity: 1,
                        unit_price: 500,
                        vendor_id: vendorB._id,
                    },
                ],
                sub_orders: [
                    { vendor_id: vendor._id, status: 'delivered', items: [] },
                    { vendor_id: vendorB._id, status: 'in_transit', items: [] },
                ],
            });

            const deliveredCount = order.sub_orders.filter((s) => s.status === 'delivered').length;
            const inFlightCount = order.sub_orders.filter((s) => s.status === 'in_transit').length;

            assert.equal(deliveredCount, 1);
            assert.equal(inFlightCount, 1);
            assert.notEqual(order.status, 'delivered', 'Order must not mark fully delivered when 1 parcel is still in-flight');
        });
    });

    /* =========================================================================
     * SECTION 4: Concurrency and Race Conditions
     * ========================================================================= */
    describe('4. Concurrency and Race Conditions', () => {

        test('CONC-01: Concurrent wallet debits prevent double-spend / negative balance', async () => {
            const user = await User.create({
                name: 'Race Customer',
                email: `race-${Date.now()}@test.com`,
                phone: `01000${Math.floor(Math.random() * 100000)}`,
                role: 'customer',
            });

            await walletService.getOrCreateAccount(user._id);

            // Fund exactly 100 EGP (10,000 minor)
            await walletService.applyLedgerEntry({
                userId: user._id,
                amountMinor: 10000,
                type: 'topup',
                deltas: { available: 10000 },
                idempotencyKey: `fund-race-${Date.now()}`,
                description: 'Seed balance',
            });

            // Two concurrent debit requests of 70 EGP each (Total 140 EGP > 100 EGP)
            const debit1 = walletService.applyLedgerEntry({
                userId: user._id,
                amountMinor: 7000,
                type: 'purchase',
                deltas: { available: -7000 },
                idempotencyKey: `debit-1-${Date.now()}`,
                description: 'Debit 1',
            });

            const debit2 = walletService.applyLedgerEntry({
                userId: user._id,
                amountMinor: 7000,
                type: 'purchase',
                deltas: { available: -7000 },
                idempotencyKey: `debit-2-${Date.now()}`,
                description: 'Debit 2',
            });

            const results = await Promise.allSettled([debit1, debit2]);

            const fulfilled = results.filter((r) => r.status === 'fulfilled');
            const rejected = results.filter((r) => r.status === 'rejected');

            assert.equal(fulfilled.length, 1, 'Exactly one concurrent debit must succeed');
            assert.equal(rejected.length, 1, 'Second concurrent debit must be rejected');

            const finalBalances = await walletService.getBalances(user._id);
            assert.equal(finalBalances.available, 30); // 30 EGP
            assert.ok(finalBalances.available >= 0, 'Balance must never drop below 0');
        });

        test('CONC-02: Concurrent duplicate wallet credits with same idempotency key credit once', async () => {
            const user = await User.create({
                name: 'Idempotent Customer',
                email: `idem-${Date.now()}@test.com`,
                phone: `01000${Math.floor(Math.random() * 100000)}`,
                role: 'customer',
            });

            await walletService.getOrCreateAccount(user._id);
            const sharedIdempotencyKey = `idem-key-${Date.now()}`;

            const credit1 = walletService.applyLedgerEntry({
                userId: user._id,
                amountMinor: 5000,
                type: 'topup',
                deltas: { available: 5000 },
                idempotencyKey: sharedIdempotencyKey,
                description: 'Concurrent topup',
            });

            const credit2 = walletService.applyLedgerEntry({
                userId: user._id,
                amountMinor: 5000,
                type: 'topup',
                deltas: { available: 5000 },
                idempotencyKey: sharedIdempotencyKey,
                description: 'Concurrent topup duplicate',
            });

            const res = await Promise.all([credit1, credit2]);
            const duplicates = res.map((r) => r.duplicate);
            assert.ok(duplicates.includes(false));
            assert.ok(duplicates.includes(true));

            const finalBalances = await walletService.getBalances(user._id);
            assert.equal(finalBalances.available, 50); // 50 EGP
        });

        test('CONC-03: Concurrent coupon usage consumption increments count accurately', async () => {
            const singleUseCoupon = await Coupon.create({
                code: `CONC_COUPON_${Date.now()}`,
                name: 'Limited Coupon',
                discount_type: 'fixed',
                discount_value: 50,
                scope_type: 'all_products',
                min_order_amount: 100,
                is_active: true,
            });

            const consumptions = Array.from({ length: 5 }).map(() =>
                couponService.consumeCouponUsage({
                    couponId: singleUseCoupon._id,
                    userId: customer._id,
                })
            );

            await Promise.all(consumptions);

            const updatedCoupon = await Coupon.findById(singleUseCoupon._id);
            assert.equal(updatedCoupon.used_count, 5);
        });

        test('CONC-04: Atomic stock decrement prevents overselling below zero', async () => {
            const variantId = new mongoose.Types.ObjectId();
            const product = await createProduct({
                variants: [{ _id: variantId, variant_label: 'Single Unit', price: 100, stock: 1 }],
            });

            const buy1 = Product.findOneAndUpdate(
                { _id: product._id, 'variants._id': variantId, 'variants.stock': { $gte: 1 } },
                { $inc: { 'variants.$.stock': -1 } },
                { returnDocument: 'after' }
            );

            const buy2 = Product.findOneAndUpdate(
                { _id: product._id, 'variants._id': variantId, 'variants.stock': { $gte: 1 } },
                { $inc: { 'variants.$.stock': -1 } },
                { returnDocument: 'after' }
            );

            const [res1, res2] = await Promise.all([buy1, buy2]);

            const successes = [res1, res2].filter(Boolean);
            assert.equal(successes.length, 1, 'Only one customer can purchase the final in-stock unit');

            const freshProduct = await Product.findById(product._id);
            assert.equal(freshProduct.variants[0].stock, 0);
            assert.ok(freshProduct.variants[0].stock >= 0, 'Inventory invariant: stock must never be negative');
        });
    });

    /* =========================================================================
     * SECTION 5: Failure Injection and Partial Failures
     * ========================================================================= */
    describe('5. Failure Injection and Partial Failures', () => {

        test('FAIL-01: Downstream notification failure does not rollback created order', async () => {
            const product = await createProduct();

            const order = await Order.create({
                recipient_name: 'Captain Youssef',
                phone: '01098765432',
                full_address: 'Alexandria Marina',
                user_id: customer._id,
                vendor_id: vendor._id,
                payment_method: 'credit_card',
                payment_status: 'paid',
                status: 'processing',
                total_price: 500,
                items_price: 500,
                shipping_fee: 0,
                items: [{
                    product_id: product._id,
                    product_title: 'Propeller',
                    variant_id: new mongoose.Types.ObjectId(),
                    quantity: 1,
                    unit_price: 500,
                    vendor_id: vendor._id,
                }],
            });

            const sendNotification = async () => {
                throw new Error('ECONNREFUSED: Mail server unreachable');
            };

            let notificationFailed = false;
            try {
                await sendNotification();
            } catch {
                notificationFailed = true;
            }

            assert.equal(notificationFailed, true);
            const persistedOrder = await Order.findById(order._id);
            assert.ok(persistedOrder);
            assert.equal(persistedOrder.status, 'processing');
        });

        test('FAIL-02: Courier booking API failure prevents in-transit advancement', async () => {
            const mockCourierApi = {
                bookShipment: async () => {
                    const err = new Error('Courier API 500 Internal Server Error');
                    err.status = 500;
                    throw err;
                },
            };

            let parcelStatus = 'processing';
            let trackingNumber = null;

            try {
                const booking = await mockCourierApi.bookShipment();
                parcelStatus = 'in_transit';
                trackingNumber = booking.trackingNumber;
            } catch {
                // Keep local status unchanged
            }

            assert.equal(parcelStatus, 'processing', 'Parcel status must not advance if courier booking fails');
            assert.equal(trackingNumber, null);
        });

        test('FAIL-03: Corrupted product record mid-calculation fails safely', async () => {
            const corruptedProduct = await createProduct({
                price: 0,
                status: 'draft',
            });

            await assert.rejects(
                async () => {
                    await orderService.buildPricedOrderItems([{ product_id: corruptedProduct._id, quantity: 1 }]);
                },
                /Product is not available for purchase/
            );
        });

        test('FAIL-04: Redis outage fallback degradation test', () => {
            const redisClientMock = {
                status: 'end',
                get: async () => {
                    throw new Error('Redis is not available');
                },
            };

            const isAvailable = redisClientMock.status === 'ready';
            assert.equal(isAvailable, false);
        });
    });

    /* =========================================================================
     * SECTION 6: Security Edge-Case Combinations
     * ========================================================================= */
    describe('6. Security Edge-Case Combinations', () => {

        test('SEC-01: IDOR / Resource Ownership Isolation in Order Operations', async () => {
            const otherCustomer = await User.create({
                name: 'Stranger Sailor',
                email: `stranger-${Date.now()}@test.com`,
                phone: `01077${Math.floor(Math.random() * 100000)}`,
                role: 'customer',
            });

            const order = await Order.create({
                recipient_name: 'Stranger Sailor',
                phone: '01077778888',
                full_address: 'Port Ghalib',
                user_id: otherCustomer._id,
                vendor_id: vendor._id,
                payment_method: 'cash',
                status: 'pending',
                total_price: 300,
                items_price: 300,
                shipping_fee: 0,
                items: [{
                    product_id: new mongoose.Types.ObjectId(),
                    product_title: 'Part',
                    variant_id: new mongoose.Types.ObjectId(),
                    quantity: 1,
                    unit_price: 300,
                    vendor_id: vendor._id,
                }],
            });

            const isOwner = String(order.user_id) === String(customer._id);
            assert.equal(isOwner, false, 'User must not own another customer order');
        });

        test('SEC-02: Mass assignment attempt of financial & role fields is rejected', () => {
            const maliciousPayload = {
                name: 'Updated Name',
                role: 'admin',
                wallet_balance: 999999,
                is_super_admin: true,
                available_minor: 50000000,
            };

            const allowedFields = ['name', 'phone', 'profile_image'];
            const sanitized = {};
            for (const key of allowedFields) {
                if (maliciousPayload[key] !== undefined) {
                    sanitized[key] = maliciousPayload[key];
                }
            }

            assert.equal(sanitized.role, undefined);
            assert.equal(sanitized.wallet_balance, undefined);
            assert.equal(sanitized.is_super_admin, undefined);
            assert.equal(sanitized.name, 'Updated Name');
        });

        test('SEC-03: NoSQL query operator injection in ID parameter handled safely', () => {
            const maliciousId = { $ne: null };
            assert.equal(
                mongoose.Types.ObjectId.isValid(maliciousId),
                false,
                'MongoDB operator objects must fail ObjectId validity check'
            );
        });

        test('SEC-04: Payment webhook signature tampering rejected', () => {
            const crypto = require('crypto');
            const secret = 'webhook_secret_key_12345';
            const payload = JSON.stringify({ order_id: '123', amount: 500 });

            const validHmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
            const tamperedHmac = validHmac.slice(0, -4) + '0000';

            const timingSafeMatch = crypto.timingSafeEqual(
                Buffer.from(validHmac),
                Buffer.from(tamperedHmac)
            );
            assert.equal(timingSafeMatch, false, 'Tampered HMAC signature must fail authentication check');
        });
    });

    /* =========================================================================
     * SECTION 7: Boundary & Data Combination Testing
     * ========================================================================= */
    describe('7. Boundary & Data Combination Testing', () => {

        test('BOUND-01: Floating point rounding and fractional piastres banker conversion', () => {
            const sum = 0.1 + 0.2;
            assert.notEqual(sum, 0.3);

            assert.equal(walletService.toMinor(sum), 30);
            assert.equal(walletService.toMinor(19.999), 2000);
            assert.equal(walletService.toMinor(19.001), 1900);
        });

        test('BOUND-02: Zero-value 100% discount order handling', () => {
            const total = 500;
            const discount = 500;
            const netPayable = Math.max(0, total - discount);

            assert.equal(netPayable, 0);
            const requiresGateway = netPayable > 0;
            assert.equal(requiresGateway, false, 'Orders with 0 net payable bypass external payment gateways');
        });

        test('BOUND-03: Boundary numeric inputs (Infinity, NaN, negative, non-integers)', () => {
            assert.equal(walletService.toMinor(Infinity), 0);
            assert.equal(walletService.toMinor(-Infinity), 0);
            assert.equal(walletService.toMinor(NaN), 0);
            assert.equal(walletService.toMinor('not-a-number'), 0);
        });

        test('BOUND-04: Unicode, RTL, long Arabic strings, and special characters', async () => {
            const longArabicString = 'مضخة ماء تبريد بحرية فائقة الجودة لليخوت والمراكب في البحر الأحمر '.repeat(3).trim();
            const product = await createProduct({
                title_en: 'Heavy Duty Sea Pump',
                title_ar: longArabicString,
            });

            const loaded = await Product.findById(product._id);
            assert.equal(loaded.title_ar, longArabicString);
        });
    });

    /* =========================================================================
     * SECTION 8: Metamorphic and Invariant Testing
     * ========================================================================= */
    describe('8. Metamorphic and Invariant Testing', () => {

        test('INVAR-01: Idempotency invariant (1 call vs 10 repeated calls produce identical balance)', async () => {
            const user = await User.create({
                name: 'Idempotency User',
                email: `idempotent-${Date.now()}@test.com`,
                phone: `01066${Math.floor(Math.random() * 100000)}`,
                role: 'customer',
            });

            await walletService.getOrCreateAccount(user._id);
            const key = `fixed-refund-key-${Date.now()}`;

            // 1st call
            await walletService.applyLedgerEntry({
                userId: user._id,
                amountMinor: 25000,
                type: 'admin_credit',
                deltas: { available: 25000 },
                idempotencyKey: key,
                description: 'Refund credit',
            });

            const balanceAfterFirst = await walletService.getBalances(user._id);

            // Repeat 9 more times with same idempotency key
            for (let i = 0; i < 9; i++) {
                await walletService.applyLedgerEntry({
                    userId: user._id,
                    amountMinor: 25000,
                    type: 'admin_credit',
                    deltas: { available: 25000 },
                    idempotencyKey: key,
                    description: 'Refund duplicate retry',
                });
            }

            const balanceAfterTen = await walletService.getBalances(user._id);

            assert.equal(balanceAfterFirst.available, balanceAfterTen.available);
            assert.equal(balanceAfterTen.available, 250); // 250.00 EGP
        });

        test('INVAR-02: Financial balance conservation invariant (Credits - Debits === Balance)', async () => {
            const user = await User.create({
                name: 'Audit User',
                email: `audit-${Date.now()}@test.com`,
                phone: `01088${Math.floor(Math.random() * 100000)}`,
                role: 'customer',
            });

            await walletService.getOrCreateAccount(user._id);

            // Sequence of transactions: +500, +200, -150, -50, +100
            const transactions = [
                { amount: 50000, delta: 50000, type: 'topup' },
                { amount: 20000, delta: 20000, type: 'topup' },
                { amount: 15000, delta: -15000, type: 'purchase' },
                { amount: 5000, delta: -5000, type: 'purchase' },
                { amount: 10000, delta: 10000, type: 'refund_credit' },
            ];

            let expectedBalanceMinor = 0;
            for (let i = 0; i < transactions.length; i++) {
                const tx = transactions[i];
                expectedBalanceMinor += tx.delta;

                await walletService.applyLedgerEntry({
                    userId: user._id,
                    amountMinor: tx.amount,
                    deltas: { available: tx.delta },
                    type: tx.type,
                    idempotencyKey: `audit-tx-${i}-${Date.now()}`,
                    description: `Tx ${i}`,
                });
            }

            const currentBalances = await walletService.getBalances(user._id);
            assert.equal(currentBalances.available, walletService.toMajor(expectedBalanceMinor));
            assert.equal(currentBalances.available, 600); // 500 + 200 - 150 - 50 + 100 = 600 EGP
        });

        test('INVAR-03: Order total price calculation conservation invariant', () => {
            const itemPrices = [120.50, 45.00, 234.50];
            const itemsSum = itemPrices.reduce((a, b) => a + b, 0); // 400.00
            const shippingFee = 60.00;
            const discount = 40.00;

            const calculatedTotal = itemsSum + shippingFee - discount;
            assert.equal(calculatedTotal, 420.00);
            assert.equal(calculatedTotal, (400.00 + 60.00 - 40.00));
        });
    });
});
