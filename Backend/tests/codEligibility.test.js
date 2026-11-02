const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { startMongo } = require('./support/testServers');
const codEligibility = require('../services/codEligibilityService');
const { SiteSettings } = require('../models/site_settings');
const { Order } = require('../models/orders');
const { User } = require('../models/users');

describe('COD Eligibility Service', () => {
    let mongo;

    before(async () => {
        mongo = await startMongo('test-cod-eligibility');
        await mongoose.connect(mongo.uri);
    });

    after(async () => {
        await mongoose.disconnect();
        await mongo.stop();
    });

    test('validatePolicyPatch clamps values and strips unknown keys', () => {
        const patch = {
            enabled: 'yes',
            min_finished_orders: 500, // clamped to 100
            max_undelivered_percent: -20, // clamped to 0
            min_bosta_ranking: 150, // clamped to 100
            ranking_cache_hours: 0, // clamped to 1
            malicious_key: 'inject',
        };
        const cleaned = codEligibility.validatePolicyPatch(patch);
        assert.equal(cleaned.enabled, true);
        assert.equal(cleaned.min_finished_orders, 100);
        assert.equal(cleaned.max_undelivered_percent, 0);
        assert.equal(cleaned.min_bosta_ranking, 100);
        assert.equal(cleaned.ranking_cache_hours, 1);
        assert.equal(cleaned.malicious_key, undefined);
    });

    test('getPolicy returns defaults when SiteSettings has no cod_policy', async () => {
        await SiteSettings.deleteMany({});
        const policy = await codEligibility.getPolicy();
        assert.equal(policy.enabled, true);
        assert.equal(policy.min_finished_orders, 3);
        assert.equal(policy.max_undelivered_percent, 50);
        assert.equal(policy.cod_enabled_globally, true);
    });

    test('getSiteStats returns 0 finished orders for customer with no history', async () => {
        const stats = await codEligibility.getSiteStats({ phone: '01011112222' });
        assert.equal(stats.finished, 0);
        assert.equal(stats.received, 0);
        assert.equal(stats.not_received, 0);
        assert.equal(stats.enough_data, false);
    });

    const createMockOrder = (overrides = {}) => {
        const vendorId = new mongoose.Types.ObjectId();
        return Order.create({
            user_id: overrides.userId || new mongoose.Types.ObjectId(),
            total_price: overrides.total_price || 150,
            status: overrides.status || 'completed',
            shipping_address: {
                recipient_name: 'Ahmed Test',
                phone: overrides.phone || '01000000000',
                full_address: '123 Marina Street, Alexandria',
            },
            sub_orders: overrides.sub_orders || [{
                vendor_id: vendorId,
                status: 'delivered',
                delivered_at: new Date(),
            }],
        });
    };

    test('getSiteStats ignores orders currently in flight', async () => {
        const phone = '01022223333';
        const userId = new mongoose.Types.ObjectId();
        const vendorId = new mongoose.Types.ObjectId();

        await createMockOrder({
            userId,
            phone,
            status: 'processing',
            sub_orders: [{ vendor_id: vendorId, status: 'in_transit' }],
        });

        const stats = await codEligibility.getSiteStats({ userId, phone });
        assert.equal(stats.finished, 0);
        assert.equal(stats.orders_total, 1);
        assert.equal(stats.enough_data, false);
    });

    test('getSiteStats counts delivered and wasted parcels accurately', async () => {
        const phone = '01033334444';
        const userId = new mongoose.Types.ObjectId();
        const vendorId = new mongoose.Types.ObjectId();

        // Order 1: delivered
        await createMockOrder({
            userId,
            phone,
            status: 'completed',
            sub_orders: [{ vendor_id: vendorId, status: 'delivered', delivered_at: new Date() }],
        });

        // Order 2: returned without delivery (wasted trip)
        await createMockOrder({
            userId,
            phone,
            status: 'returned',
            sub_orders: [{ vendor_id: vendorId, status: 'returned', delivered_at: null }],
        });

        const stats = await codEligibility.getSiteStats({ userId, phone });
        assert.equal(stats.finished, 2);
        assert.equal(stats.received, 1);
        assert.equal(stats.not_received, 1);
        assert.equal(stats.undelivered_percent, 50);
    });

    test('evaluate denies COD when site-wide switch is off', async () => {
        await SiteSettings.updateOne(
            {},
            { $set: { "wallet.cod_enabled": false } },
            { upsert: true }
        );

        const result = await codEligibility.evaluate({ phone: '01044445555' });
        assert.equal(result.allowed, false);
        assert.ok(result.reasons.some((r) => r.code === 'cod_disabled_site_wide'));

        // Restore site-wide switch
        await SiteSettings.updateOne({}, { $set: { "wallet.cod_enabled": true } });
    });

    test('evaluate enforces admin override allow and block', async () => {
        const userBlocked = await User.create({
            name: 'Blocked User',
            phone: '01055556666',
            cod_risk: { override: 'block', override_reason: 'Abuse history' },
        });

        const blockResult = await codEligibility.evaluate({ userId: userBlocked._id, phone: userBlocked.phone });
        assert.equal(blockResult.allowed, false);
        assert.ok(blockResult.reasons.some((r) => r.code === 'admin_blocked'));

        const userAllowed = await User.create({
            name: 'Allowed User',
            phone: '01077778888',
            cod_risk: { override: 'allow', override_reason: 'VIP customer' },
        });

        const allowResult = await codEligibility.evaluate({ userId: userAllowed._id, phone: userAllowed.phone });
        assert.equal(allowResult.allowed, true);
        assert.ok(allowResult.reasons.some((r) => r.code === 'admin_allowed'));
    });

    test('evaluate blocks customer exceeding max undelivered rate after reaching min finished orders', async () => {
        const phone = '01099990000';
        const userId = new mongoose.Types.ObjectId();
        const vendorId = new mongoose.Types.ObjectId();

        // 1 delivered, 3 wasted = 4 finished orders, 75% undelivered (policy default max is 50%, min 3)
        await createMockOrder({
            userId,
            phone,
            status: 'completed',
            sub_orders: [{ vendor_id: vendorId, status: 'delivered', delivered_at: new Date() }],
        });
        for (let i = 0; i < 3; i++) {
            await createMockOrder({
                userId,
                phone,
                status: 'returned',
                sub_orders: [{ vendor_id: vendorId, status: 'returned', delivered_at: null }],
            });
        }

        const result = await codEligibility.evaluate({ userId, phone });
        assert.equal(result.allowed, false);
        assert.ok(result.reasons.some((r) => r.code === 'site_undelivered_rate'));
    });

    test('isAllowed returns boolean for empty args', async () => {
        const allowed = await codEligibility.isAllowed();
        assert.equal(typeof allowed, 'boolean');
        assert.equal(allowed, true);
    });
});
