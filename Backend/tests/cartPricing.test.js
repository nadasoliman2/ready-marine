const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { startMongo } = require('./support/testServers');
const { buildPricedOrderItems } = require('../services/orderService');
const { Product } = require('../models/products');
const { Seller } = require('../models/sellers');
const { Category } = require('../models/categories');

// Largest-remainder allocation logic (reproduced directly for isolated invariant verification)
const allocateProportional = (totalCents, weights) => {
    const n = weights.length;
    if (n === 0) return [];
    const sum = weights.reduce((a, b) => a + b, 0);
    if (sum <= 0) {
        const base = Math.floor(totalCents / n);
        const out = weights.map(() => base);
        for (let i = 0; i < totalCents - base * n; i++) out[i]++;
        return out;
    }
    const raw = weights.map(w => (totalCents * w) / sum);
    const floor = raw.map(x => Math.floor(x));
    const remainder = totalCents - floor.reduce((a, b) => a + b, 0);
    const order = raw.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < remainder; k++) floor[order[k % n].i]++;
    return floor;
};

describe('Cart Pricing & Server-Side Price Authority', () => {
    let mongo;
    let vendor;
    let suspendedVendor;
    let category;

    before(async () => {
        mongo = await startMongo('test-cart-pricing');
        await mongoose.connect(mongo.uri);

        category = await Category.create({
            name: 'Marine Engines',
            name_ar: 'محركات بحرية',
        });

        vendor = await Seller.create({
            name: 'Active Vendor',
            store_name: 'Marine Depot',
            store_username: 'marinedepot',
            email: 'depot@readymarine.test',
            phone: '01011112222',
            password: 'hashedpassword',
            status: 'active',
            locations: [{ address: 'Alexandria Port', is_default: true }],
        });

        suspendedVendor = await Seller.create({
            name: 'Suspended Vendor',
            store_name: 'Suspended Shop',
            store_username: 'suspendedshop',
            email: 'suspended@readymarine.test',
            phone: '01033334444',
            password: 'hashedpassword',
            status: 'suspended',
            locations: [{ address: 'Suez Port', is_default: true }],
        });
    });

    after(async () => {
        await mongoose.disconnect();
        await mongo.stop();
    });

    const createMockProduct = (overrides = {}) => {
        return Product.create({
            vendor_id: overrides.vendor_id || vendor._id,
            category_id: category._id,
            sku: overrides.sku || `SKU-${Date.now()}-${Math.random()}`,
            title_en: overrides.title_en || 'Marine Part',
            subtitle_en: 'High Grade Marine Part',
            description_en: 'Tested marine equipment part',
            slug_en: overrides.slug_en || `marine-part-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
            price: overrides.price || 100,
            discount_type: overrides.discount_type || null,
            discount_value: overrides.discount_value || null,
            status: overrides.status || 'published',
            is_universal: true,
            ...overrides,
        });
    };

    describe('allocateProportional Algorithm', () => {
        test('allocates total cents with zero penny drift across unequal weights', () => {
            const totalCents = 10000; // 100.00 EGP
            const weights = [33, 33, 34];
            const allocated = allocateProportional(totalCents, weights);

            assert.equal(allocated.reduce((a, b) => a + b, 0), totalCents);
            assert.deepEqual(allocated, [3300, 3300, 3400]);
        });

        test('allocates correctly when remainder pennies must be distributed to largest fractions', () => {
            const totalCents = 100; // 1.00 EGP distributed 3 ways: 33.3333 each
            const weights = [1, 1, 1];
            const allocated = allocateProportional(totalCents, weights);

            assert.equal(allocated.reduce((a, b) => a + b, 0), 100);
            assert.equal(allocated.length, 3);
            assert.ok(allocated.includes(34));
            assert.ok(allocated.includes(33));
        });

        test('handles zero weights safely without dividing by zero', () => {
            const totalCents = 500;
            const weights = [0, 0];
            const allocated = allocateProportional(totalCents, weights);

            assert.equal(allocated.reduce((a, b) => a + b, 0), 500);
            assert.deepEqual(allocated, [250, 250]);
        });
    });

    describe('buildPricedOrderItems Validations', () => {
        test('rejects empty items array', async () => {
            await assert.rejects(
                async () => buildPricedOrderItems([]),
                /Order must contain at least one item/
            );
        });

        test('rejects non-array or missing items', async () => {
            await assert.rejects(
                async () => buildPricedOrderItems(null),
                /Order must contain at least one item/
            );
        });

        test('rejects item without product ID', async () => {
            await assert.rejects(
                async () => buildPricedOrderItems([{ quantity: 2 }]),
                /Order item is missing a product/
            );
        });

        test('rejects non-existent product ID', async () => {
            const fakeId = new mongoose.Types.ObjectId();
            await assert.rejects(
                async () => buildPricedOrderItems([{ product_id: fakeId, quantity: 1 }]),
                new RegExp(`Product not found: ${fakeId}`)
            );
        });

        test('rejects negative or non-numeric quantities, and documents zero coercion', async () => {
            const product = await createMockProduct({
                title_en: 'Propeller Nut',
                price: 150,
            });

            // Negative quantity is rejected
            await assert.rejects(
                async () => buildPricedOrderItems([{ product_id: product._id, quantity: -2 }]),
                /Invalid item quantity/
            );

            // Non-numeric string is rejected
            await assert.rejects(
                async () => buildPricedOrderItems([{ product_id: product._id, quantity: 'abc' }]),
                /Invalid item quantity/
            );

            // Edge Case / Finding: quantity: 0 falls back to 1 via (item.quantity || 1)
            const zeroPriced = await buildPricedOrderItems([{ product_id: product._id, quantity: 0 }]);
            assert.equal(zeroPriced[0].quantity, 1);
        });

        test('rejects draft product', async () => {
            const draftProduct = await createMockProduct({
                title_en: 'Unreleased Marine Compass',
                price: 500,
                status: 'draft',
            });

            await assert.rejects(
                async () => buildPricedOrderItems([{ product_id: draftProduct._id, quantity: 1 }]),
                /Product is not available for purchase/
            );
        });

        test('rejects product belonging to suspended vendor', async () => {
            const suspendedProduct = await createMockProduct({
                vendor_id: suspendedVendor._id,
                title_en: 'Suspended Marine Radar',
                price: 1200,
                status: 'published',
            });

            await assert.rejects(
                async () => buildPricedOrderItems([{ product_id: suspendedProduct._id, quantity: 1 }]),
                /Product is not available because its vendor is suspended/
            );
        });
    });

    describe('Server-Side Price Authority & Tampering Prevention', () => {
        test('ignores client-supplied price and calculates unit price & line total strictly from database', async () => {
            const realProduct = await createMockProduct({
                title_en: 'High Quality Anchor',
                price: 1000,
                discount_type: 'fixed',
                discount_value: 200, // effective discount_price will be 800
            });

            // Adversarial payload: attacker attempts to pay 1 EGP instead of 800 EGP
            const maliciousPayload = [
                {
                    product_id: realProduct._id,
                    quantity: 3,
                    price: 1,
                    unit_price: 1,
                    line_total: 3,
                    discount: 999,
                },
            ];

            const pricedItems = await buildPricedOrderItems(maliciousPayload);

            assert.equal(pricedItems.length, 1);
            const item = pricedItems[0];
            // Price must come from DB effective price (800 EGP)
            assert.equal(item.unit_price, 800);
            assert.equal(item.quantity, 3);
            assert.equal(item.line_total, 2400); // 800 * 3
            assert.equal(item.vendor_id.toString(), vendor._id.toString());
        });
    });
});
