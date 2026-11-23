'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { startMongo } = require('./support/testServers');
const { TargetAudience } = require('../models/target_audiences');
const audienceService = require('../modules/audience/audience.service');
const { Product } = require('../models/products');
const { Seller } = require('../models/sellers');
const { Category } = require('../models/categories');
const { Brand } = require('../models/product_brands');

describe('Target Audience & Dynamic Hero Slider', () => {
    let mongo;
    let vendorId;
    let categoryId;
    let brandId;

    before(async () => {
        mongo = await startMongo('test-target-audience');
        await mongoose.connect(mongo.uri);

        // Seed initial audiences
        await audienceService.seedInitialAudiences();

        // Seed basic fixtures
        const vendor = await Seller.create({
            name: 'Audience Test Seller',
            email: 'audtest@readytest.com',
            password: 'hashedpassword_test_123',
            store_name: 'Marine Speed Store',
            store_username: 'marinespeed',
            phone: '01011112222',
            locations: [{ address: 'Marina 5, North Coast', is_default: true }],
            auto_publish_products: true,
        });
        vendorId = vendor._id;

        const cat = await Category.create({ name: 'Marine Gear', name_ar: 'معدات بحرية', is_active: true });
        categoryId = cat._id;

        const br = await Brand.create({ name: 'Yamaha Marine' });
        brandId = br._id;
    });

    after(async () => {
        await mongoose.disconnect();
        await mongo.stop();
    });

    test('Initial seeding creates standard marine audiences with correct card positions', async () => {
        const count = await TargetAudience.countDocuments();
        assert.ok(count >= 10, 'Expected at least 10 seeded audiences');

        const yacht = await TargetAudience.findOne({ key: 'yacht_luxury' });
        assert.ok(yacht);
        assert.strictEqual(yacht.card_position, 'large');
        assert.strictEqual(yacht.name_ar, 'مستلزمات اليخوت الفاخرة');

        const comfort = await TargetAudience.findOne({ key: 'lifestyle_comfort' });
        assert.ok(comfort);
        assert.strictEqual(comfort.card_position, 'small_top');

        const smart = await TargetAudience.findOne({ key: 'smart_gear' });
        assert.ok(smart);
        assert.strictEqual(smart.card_position, 'small_bottom');
    });

    test('getSliderCards formats slides matching CardAutoSlider contract', async () => {
        const slider = await audienceService.getSliderCards();
        assert.ok(slider.large);
        assert.ok(slider.small_top);
        assert.ok(slider.small_bottom);

        assert.ok(Array.isArray(slider.large.slides));
        assert.ok(slider.large.slides.length > 0);
        assert.ok(slider.large.slides[0].titleAr);
        assert.ok(slider.large.slides[0].slug);

        assert.ok(Array.isArray(slider.small_top.slides));
        assert.ok(slider.small_top.slides.length > 0);

        assert.ok(Array.isArray(slider.small_bottom.slides));
        assert.ok(slider.small_bottom.slides.length > 0);
    });

    test('Admin can create, update, and delete custom audiences', async () => {
        // Create
        const created = await audienceService.createAudience({
            name_ar: 'مجموعة الصيد الليلي',
            name_en: 'Night Fishing Expeditions',
            badge_ar: 'صيد ليلي حصري',
            badge_en: 'Night Quest',
            description_ar: 'كشافات بحرية ومعدات الصيد ليلاً',
            card_position: 'large',
            sort_order: 10,
        });
        assert.ok(created._id);
        assert.strictEqual(created.key, 'night_fishing_expeditions');
        assert.strictEqual(created.card_position, 'large');

        // Update
        const updated = await audienceService.updateAudience(created._id, {
            badge_ar: 'معدات ليلية متطورة',
            card_position: 'small_top',
        });
        assert.strictEqual(updated.badge_ar, 'معدات ليلية متطورة');
        assert.strictEqual(updated.card_position, 'small_top');

        // Delete
        await audienceService.deleteAudience(created._id);
        const deleted = await TargetAudience.findById(created._id);
        assert.strictEqual(deleted, null);
    });

    test('Product associates with TargetAudience ref ID and updates stats', async () => {
        const proAngler = await TargetAudience.findOne({ key: 'pro_angler' });
        assert.ok(proAngler);

        const prod = await Product.create({
            sku: 'TEST-REEL-001',
            vendor_id: vendorId,
            category_id: categoryId,
            product_brand_id: brandId,
            title_en: 'Saltwater Heavy Reel',
            subtitle_en: 'Deep sea fishing reel',
            description_en: 'High-power drag reel for saltwater game fish',
            slug_en: 'saltwater-heavy-reel-001',
            title_ar: 'بكرة صيد بحري ثقيل',
            subtitle_ar: 'بكرة سحب فائقة القوة',
            description_ar: 'بكرة صيد مخصصة للأسماك الكبيرة في المياه المالحة',
            slug_ar: 'saltwater-heavy-reel-ar-001',
            price: 7500,
            status: 'published',
            is_universal: true,
            target_audiences: [proAngler._id],
        });

        assert.ok(prod._id);
        assert.strictEqual(String(prod.target_audiences[0]), String(proAngler._id));

        // Verify audience stats include the product
        const stats = await audienceService.getAudiencesWithStats();
        const statPro = stats.find(a => String(a._id) === String(proAngler._id));
        assert.ok(statPro);
        assert.ok(statPro.products_count >= 1);
    });
});
