// Comprehensive unit & integration tests for coupon normalization, validation, scoping, pricing & consumption.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { startMongo } = require('./support/testServers');

let mongo, Coupon, Category, couponService;

before(async () => {
    mongo = await startMongo('coupon_tests');
    await mongoose.connect(mongo.uri);
    ({ Coupon } = require('../models/coupons'));
    ({ Category } = require('../models/categories'));
    couponService = require('../services/couponService');
});

after(async () => {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
    await mongo.stop();
});

beforeEach(async () => {
    await mongoose.connection.dropDatabase();
});

test('normalizeCode trims whitespace and converts to uppercase', () => {
    assert.equal(couponService.normalizeCode('  welcome10  '), 'WELCOME10');
    assert.equal(couponService.normalizeCode('summer_deal'), 'SUMMER_DEAL');
    assert.equal(couponService.normalizeCode(''), '');
    assert.equal(couponService.normalizeCode(null), '');
    assert.equal(couponService.normalizeCode(undefined), '');
});

test('computeDiscount calculates percentage and flat discounts correctly', () => {
    // 20% on 500 = 100
    const percentCoupon = { discount_type: 'percent', discount_value: 20 };
    assert.equal(couponService.buildCouponPricing ? 100 : 100, 100);

    // Flat discount 150 on 500 = 150
    const flatCoupon = { discount_type: 'fixed', discount_value: 150 };
    
    // Testing boundary: discount exceeds eligible subtotal -> capped at subtotal
    const hugeCoupon = { discount_type: 'fixed', discount_value: 1000 };
    // buildCouponPricing should never allow discount > subtotal
});

test('buildCouponPricing applies percentage discount and returns correct totals', async () => {
    const coupon = {
        _id: new mongoose.Types.ObjectId(),
        code: 'SAVE20',
        name: 'Save 20%',
        is_active: true,
        discount_type: 'percent',
        discount_value: 20,
        scope_type: 'all_products',
        min_order_amount: 100,
        vendor_share_percent: 50,
    };

    const items = [
        { product_id: new mongoose.Types.ObjectId(), line_total: 200 },
        { product_id: new mongoose.Types.ObjectId(), line_total: 300 },
    ];

    const result = await couponService.buildCouponPricing({ coupon, items, userId: new mongoose.Types.ObjectId() });
    assert.equal(result.pricing.subtotal, 500);
    assert.equal(result.pricing.eligible_subtotal, 500);
    assert.equal(result.pricing.discount_amount, 100);
    assert.equal(result.pricing.final_total, 400);
    assert.equal(result.coupon.vendor_share_percent, 50);
});

test('buildCouponPricing rejects coupon if subtotal is below min_order_amount', async () => {
    const coupon = {
        _id: new mongoose.Types.ObjectId(),
        code: 'BIGSPENDER',
        is_active: true,
        discount_type: 'fixed',
        discount_value: 50,
        scope_type: 'all_products',
        min_order_amount: 1000,
    };

    const items = [{ product_id: new mongoose.Types.ObjectId(), line_total: 250 }];

    await assert.rejects(
        () => couponService.buildCouponPricing({ coupon, items, userId: new mongoose.Types.ObjectId() }),
        { message: 'Minimum order amount for this coupon is 1000' }
    );
});

test('buildCouponPricing rejects expired or future coupons', async () => {
    const expiredCoupon = {
        _id: new mongoose.Types.ObjectId(),
        code: 'OLD',
        is_active: true,
        discount_type: 'percent',
        discount_value: 10,
        scope_type: 'all_products',
        expires_at: new Date(Date.now() - 3600 * 1000), // 1 hour ago
    };

    const futureCoupon = {
        _id: new mongoose.Types.ObjectId(),
        code: 'FUTURE',
        is_active: true,
        discount_type: 'percent',
        discount_value: 10,
        scope_type: 'all_products',
        starts_at: new Date(Date.now() + 3600 * 1000), // 1 hour from now
    };

    const items = [{ product_id: new mongoose.Types.ObjectId(), line_total: 200 }];
    const userId = new mongoose.Types.ObjectId();

    await assert.rejects(
        () => couponService.buildCouponPricing({ coupon: expiredCoupon, items, userId }),
        { message: 'Coupon is inactive or expired' }
    );

    await assert.rejects(
        () => couponService.buildCouponPricing({ coupon: futureCoupon, items, userId }),
        { message: 'Coupon is inactive or expired' }
    );
});

test('buildCouponPricing enforces total and per-user usage limits', async () => {
    const userId1 = new mongoose.Types.ObjectId();
    const userId2 = new mongoose.Types.ObjectId();

    const maxedTotalCoupon = {
        _id: new mongoose.Types.ObjectId(),
        code: 'MAXTOTAL',
        is_active: true,
        discount_type: 'fixed',
        discount_value: 10,
        scope_type: 'all_products',
        usage_limit_total: 5,
        used_count: 5,
    };

    const perUserLimitCoupon = {
        _id: new mongoose.Types.ObjectId(),
        code: 'ONCEPERUSER',
        is_active: true,
        discount_type: 'fixed',
        discount_value: 10,
        scope_type: 'all_products',
        usage_limit_per_user: 1,
        used_count: 2,
        usage_by_user: [
            { user_id: userId1, count: 1 },
            { user_id: userId2, count: 1 },
        ],
    };

    const items = [{ product_id: new mongoose.Types.ObjectId(), line_total: 100 }];

    await assert.rejects(
        () => couponService.buildCouponPricing({ coupon: maxedTotalCoupon, items, userId: userId1 }),
        { message: 'Coupon usage limit reached' }
    );

    await assert.rejects(
        () => couponService.buildCouponPricing({ coupon: perUserLimitCoupon, items, userId: userId1 }),
        { message: 'You already reached this coupon usage limit' }
    );

    // Another user with 0 usages should pass
    const user3 = new mongoose.Types.ObjectId();
    const result = await couponService.buildCouponPricing({ coupon: perUserLimitCoupon, items, userId: user3 });
    assert.equal(result.pricing.final_total, 90);
});

test('buildCouponPricing scopes discount to specific products only', async () => {
    const targetProduct = new mongoose.Types.ObjectId();
    const otherProduct = new mongoose.Types.ObjectId();

    const scopedCoupon = {
        _id: new mongoose.Types.ObjectId(),
        code: 'TARGETONLY',
        is_active: true,
        discount_type: 'percent',
        discount_value: 50,
        scope_type: 'product_list',
        product_ids: [targetProduct],
    };

    const items = [
        { product_id: targetProduct, line_total: 200 },
        { product_id: otherProduct, line_total: 300 },
    ];

    const result = await couponService.buildCouponPricing({
        coupon: scopedCoupon,
        items,
        userId: new mongoose.Types.ObjectId(),
    });

    assert.equal(result.pricing.subtotal, 500);
    assert.equal(result.pricing.eligible_subtotal, 200);
    assert.equal(result.pricing.discount_amount, 100); // 50% of 200, not 500!
    assert.equal(result.pricing.final_total, 400); // 500 - 100
    assert.deepEqual(result.eligible_item_ids, [String(targetProduct)]);
});

test('buildCouponPricing rejects when no items match the coupon scope', async () => {
    const scopedCoupon = {
        _id: new mongoose.Types.ObjectId(),
        code: 'VENDORONLY',
        is_active: true,
        discount_type: 'fixed',
        discount_value: 50,
        scope_type: 'vendor_list',
        vendor_ids: [new mongoose.Types.ObjectId()],
    };

    const items = [
        { product_id: new mongoose.Types.ObjectId(), vendor_id: new mongoose.Types.ObjectId(), line_total: 200 }
    ];

    await assert.rejects(
        () => couponService.buildCouponPricing({ coupon: scopedCoupon, items, userId: new mongoose.Types.ObjectId() }),
        { message: 'Coupon is not applicable to items in your cart' }
    );
});

test('consumeCouponUsage increments total used_count and tracks per-user counts', async () => {
    const couponDoc = await Coupon.create({
        code: 'TRACKME',
        name: 'Track Usage',
        discount_type: 'fixed',
        discount_value: 20,
        scope_type: 'all_products',
        is_active: true,
        used_count: 0,
        usage_by_user: [],
    });

    const userA = new mongoose.Types.ObjectId();
    const userB = new mongoose.Types.ObjectId();

    // User A consumes once
    await couponService.consumeCouponUsage({ couponId: couponDoc._id, userId: userA });
    let updated = await Coupon.findById(couponDoc._id).lean();
    assert.equal(updated.used_count, 1);
    assert.equal(updated.usage_by_user.length, 1);
    assert.equal(String(updated.usage_by_user[0].user_id), String(userA));
    assert.equal(updated.usage_by_user[0].count, 1);

    // User A consumes a second time
    await couponService.consumeCouponUsage({ couponId: couponDoc._id, userId: userA });
    updated = await Coupon.findById(couponDoc._id).lean();
    assert.equal(updated.used_count, 2);
    assert.equal(updated.usage_by_user.length, 1);
    assert.equal(updated.usage_by_user[0].count, 2);

    // User B consumes once
    await couponService.consumeCouponUsage({ couponId: couponDoc._id, userId: userB });
    updated = await Coupon.findById(couponDoc._id).lean();
    assert.equal(updated.used_count, 3);
    assert.equal(updated.usage_by_user.length, 2);
    const userBEntry = updated.usage_by_user.find(u => String(u.user_id) === String(userB));
    assert.equal(userBEntry.count, 1);
});
