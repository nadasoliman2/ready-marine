'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const mongoose = require('mongoose');

const { startMongo } = require('./support/testServers');
const { Category } = require('../models/categories');
const { Brand } = require('../models/product_brands');
const { ShippingClass } = require('../models/shipping_classes');
const { Seller } = require('../models/sellers');
const { Product } = require('../models/products');
const { generateBulkUploadTemplate } = require('../modules/general/template_generator.service');
const { processBulkUpload, processBulkJsonUpload } = require('../modules/admin/bulk_upload.service');

describe('Bulk Upload & Template Generator (Marine Domain)', () => {
    let mongo;
    let vendorId;
    let categoryId;
    let brandId;

    before(async () => {
        mongo = await startMongo('test-bulk-upload-marine');
        await mongoose.connect(mongo.uri);

        // Seed vendor
        const vendor = await Seller.create({
            name: 'Marine Test Seller',
            email: 'marinetest@readytest.com',
            password: 'hashedpassword_test_123',
            store_name: 'Marine Test Store',
            store_username: 'marinetest',
            phone: '01012345678',
            locations: [{ address: 'Alexandria Yacht Marina', is_default: true }],
            auto_publish_products: true,
        });
        vendorId = vendor._id;

        // Seed Category
        const cat = await Category.create({
            name: 'Marine Electronics',
            name_ar: 'الاجهزة البحرية',
            is_active: true,
        });
        categoryId = cat._id;

        // Seed Brand
        const br = await Brand.create({
            name: 'garmin',
        });
        brandId = br._id;

        // Seed Shipping Class
        await ShippingClass.create({
            name: 'Standard Marine',
            name_ar: 'شحن بحري قياسي',
            is_active: true,
        });

        // Seed Target Audiences
        const { seedInitialAudiences } = require('../modules/audience/audience.service');
        await seedInitialAudiences();
    });

    after(async () => {
        await mongoose.disconnect();
        await mongo.stop();
    });

    test('Template generator (Arabic): creates marine sheets, marine headers, and no car references', async () => {
        const buffer = await generateBulkUploadTemplate('ar');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);

        const sheetNames = wb.worksheets.map(w => w.name);
        assert.ok(sheetNames.includes('Products'), 'Products sheet must exist');
        assert.ok(sheetNames.includes('Instructions'), 'Instructions sheet must exist');
        assert.ok(sheetNames.includes('Lists'), 'Lists sheet must exist');
        assert.ok(sheetNames.includes('Marine Brands (Reference)'), 'Marine Brands reference sheet must exist');
        assert.strictEqual(sheetNames.includes('Car Brands (Reference)'), false, 'Car Brands sheet must NOT exist');

        const wsProd = wb.getWorksheet('Products');
        const headerValues = wsProd.getRow(4).values.filter(Boolean);
        assert.ok(headerValues.includes('إدارة المخزون'), 'Stock Mgmt header must exist');
        assert.ok(headerValues.includes('نوع القطعة'), 'Part Type header must exist');
        assert.strictEqual(headerValues.some(v => typeof v === 'string' && v.includes('منتج عام')), false, 'Is Universal must be removed');

        // Check instructions text has no car mentions
        const wsInst = wb.getWorksheet('Instructions');
        let fullText = '';
        wsInst.eachRow(r => {
            r.eachCell(c => {
                if (typeof c.value === 'string') fullText += c.value + ' ';
            });
        });
        assert.strictEqual(fullText.includes('السيارات المتوافقة'), false, 'Must not reference automotive cars');
        assert.strictEqual(fullText.includes('الشركة المصنّعة للعربية'), false, 'Must not mention car maker');
    });

    test('Template generator (English): creates English marine headers and reference sheet', async () => {
        const buffer = await generateBulkUploadTemplate('en');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);

        const wsProd = wb.getWorksheet('Products');
        const headerValues = wsProd.getRow(4).values.filter(Boolean);
        assert.ok(headerValues.includes('Stock Mgmt'), 'Stock Mgmt header must exist');
        assert.ok(headerValues.includes('Part Type'), 'Part Type header must exist');
        assert.strictEqual(headerValues.some(v => typeof v === 'string' && v.includes('Is Universal')), false, 'Is Universal must be removed');

        const wsRef = wb.getWorksheet('Marine Brands (Reference)');
        assert.ok(wsRef.rowCount >= 2, 'Marine brands reference sheet must have rows');
    });

    test('Bulk upload (Excel): general marine product with blank compatibility defaults to universal and succeeds', async () => {
        // Build Excel using the actual generated template
        const templateBuf = await generateBulkUploadTemplate('en');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(templateBuf);
        const ws = wb.getWorksheet('Products');

        // Row 6: data
        const row6 = ws.getRow(6);
        row6.getCell(1).value = 'TEST-GPS-01'; // SKU
        row6.getCell(2).value = 'PN-001';      // Part #
        row6.getCell(4).value = 'Garmin Chartplotter 923'; // Title EN
        row6.getCell(5).value = '9-inch Marine GPS';       // Subtitle EN
        row6.getCell(6).value = 'High resolution chartplotter for boats'; // Desc EN
        row6.getCell(7).value = 'شاشة جارمن بحرية 923';      // Title AR
        row6.getCell(8).value = 'شاشة ملاحة بحرية 9 بوصة';    // Subtitle AR
        row6.getCell(9).value = 'جهاز ملاحة عالي الدقة للقوارب واليخوت'; // Desc AR
        row6.getCell(10).value = '15000';                   // Price
        row6.getCell(13).value = 'published';               // Status
        row6.getCell(14).value = 'Marine Electronics';     // Category
        row6.getCell(15).value = 'garmin';                 // Product Brand
        row6.getCell(16).value = 'Original';               // Part Type
        row6.getCell(17).value = 'pro_angler, yacht_luxury'; // Target Audiences (Optional)
        row6.getCell(18).value = 'TRUE';                   // Stock Mgmt
        row6.getCell(19).value = '10';                     // Quantity
        row6.getCell(20).value = 'instock';                // Stock Status
        row6.getCell(21).value = 'https://example.com/gps.jpg'; // Images
        row6.getCell(24).value = '2.5';                    // Weight
        row6.getCell(25).value = '30x20x10';               // Dimensions
        row6.commit();

        const buf = await wb.xlsx.writeBuffer();
        const result = await processBulkUpload(buf, vendorId, { bypassApproval: true });

        assert.strictEqual(result.failed.length, 0, `Upload should succeed with 0 failures, got: ${JSON.stringify(result.failed)}`);
        assert.strictEqual(result.succeeded.length, 1);

        const saved = await Product.findOne({ sku: 'TEST-GPS-01' }).lean();
        assert.ok(saved);
        assert.strictEqual(saved.is_universal, true, 'Product should default to is_universal: true');
        assert.strictEqual(saved.price, 15000);
        assert.strictEqual(String(saved.category_id), String(categoryId));
        assert.strictEqual(String(saved.product_brand_id), String(brandId));
        const { TargetAudience } = require('../models/target_audiences');
        const audDocs = await TargetAudience.find({ _id: { $in: saved.target_audiences } }).select('key').lean();
        assert.strictEqual(saved.target_audiences.length, 2, 'Should save 2 target audience ObjectIds');
        assert.deepStrictEqual(audDocs.map(a => a.key).sort(), ['pro_angler', 'yacht_luxury'].sort());
    });

    test('Bulk upload (Excel): auto-registers new marine brand and accepts Arabic boolean and Arabic category name', async () => {
        const templateBuf = await generateBulkUploadTemplate('ar');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(templateBuf);
        const ws = wb.getWorksheet('Products');

        const row6 = ws.getRow(6);
        row6.getCell(1).value = 'TEST-ROD-02';
        row6.getCell(4).value = 'Shimano Offshore Fishing Rod';
        row6.getCell(5).value = 'Heavy Big Game Rod';
        row6.getCell(6).value = 'Premium saltwater trolling rod';
        row6.getCell(7).value = 'قصبة صيد شيمانو للمياه العميقة';
        row6.getCell(8).value = 'قصبة صيد بيج جيم';
        row6.getCell(9).value = 'قصبة ممتازة لصيد الأسماك الكبيرة في المياه المالحة';
        row6.getCell(10).value = '4500';
        row6.getCell(11).value = 'fixed';
        row6.getCell(12).value = '500';
        row6.getCell(13).value = 'published';
        row6.getCell(14).value = 'الاجهزة البحرية'; // Arabic category name
        row6.getCell(15).value = 'shimano marine'; // Product brand (auto-registers)
        row6.getCell(16).value = 'أصلي'; // Arabic for Original
        row6.getCell(17).value = 'مستلزمات المياه المالحة'; // Arabic target audience name
        row6.getCell(18).value = 'نعم'; // Arabic boolean for TRUE
        row6.getCell(19).value = '5';
        row6.getCell(20).value = 'instock';
        row6.getCell(21).value = 'https://example.com/rod.jpg';
        row6.getCell(24).value = '1.2';
        row6.getCell(25).value = '180x10x10';
        row6.commit();

        const buf = await wb.xlsx.writeBuffer();
        const result = await processBulkUpload(buf, vendorId, { bypassApproval: true });

        assert.strictEqual(result.failed.length, 0, `Upload should succeed, got: ${JSON.stringify(result.failed)}`);
        assert.strictEqual(result.succeeded.length, 1);

        const saved = await Product.findOne({ sku: 'TEST-ROD-02' }).lean();
        assert.ok(saved);
        assert.strictEqual(saved.is_universal, true);
        assert.strictEqual(saved.part_type, 'original');
        assert.strictEqual(saved.discount_price, 4000);
        const { TargetAudience: TargetAudience2 } = require('../models/target_audiences');
        const audDocs2 = await TargetAudience2.find({ _id: { $in: saved.target_audiences } }).select('key').lean();
        assert.strictEqual(saved.target_audiences.length, 1, 'Should save 1 target audience ObjectId');
        assert.deepStrictEqual(audDocs2.map(a => a.key), ['saltwater']);

        // Verify new brand was auto-created
        const createdBrand = await Brand.findById(saved.product_brand_id).lean();
        assert.ok(createdBrand);
        assert.strictEqual(createdBrand.name, 'shimano marine');
    });

    test('Bulk upload (Excel): rejects row when Product Brand is missing', async () => {
        const templateBuf = await generateBulkUploadTemplate('ar');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(templateBuf);
        const ws = wb.getWorksheet('Products');

        const row6 = ws.getRow(6);
        row6.getCell(1).value = 'TEST-NO-BRAND';
        row6.getCell(4).value = 'Marine Anchor 15kg';
        row6.getCell(5).value = 'Galvanized steel anchor';
        row6.getCell(6).value = 'Durable marine anchor for boats';
        row6.getCell(7).value = 'مخطاف بحري 15 كجم';
        row6.getCell(8).value = 'مخطاف صلب مجلفن';
        row6.getCell(9).value = 'مخطاف قوي لليخوت والقوارب';
        row6.getCell(10).value = '3200';
        row6.getCell(14).value = 'الاجهزة البحرية';
        // Brand (cell 15) left blank!
        row6.getCell(17).value = 'TRUE';
        row6.getCell(18).value = '3';
        row6.commit();

        const buf = await wb.xlsx.writeBuffer();
        const result = await processBulkUpload(buf, vendorId, { bypassApproval: true });

        assert.strictEqual(result.succeeded.length, 0, 'Should not succeed without brand');
        assert.strictEqual(result.failed.length, 1, 'Should fail row without brand');
        const brandErr = result.failed[0].errors.find(e => e.field === 'Brand');
        assert.ok(brandErr, 'Error report must contain Brand error');
    });

    test('Bulk JSON upload: supports marine product payload and defaults is_universal', async () => {
        const payload = [{
            sku: 'TEST-JACKET-03',
            title_en: 'Inflatable Life Vest 150N',
            subtitle_en: 'Offshore safety lifejacket',
            description_en: 'Automatic inflation lifejacket with harness',
            title_ar: 'سترة نجاة بحرية قابلة للنفخ 150N',
            subtitle_ar: 'سترة سلامة بحرية',
            description_ar: 'سترة نجاة أوتوماتيكية للسلامة البحرية',
            price: 2200,
            category_id: String(categoryId),
            product_brand_id: String(brandId),
            quantity: 25,
            images: [{ url: 'https://example.com/vest.jpg', is_primary: true }],
            is_universal: true,
        }];

        const result = await processBulkJsonUpload(payload, vendorId, { bypassApproval: true });
        assert.strictEqual(result.failed.length, 0);
        assert.strictEqual(result.succeeded.length, 1);

        const saved = await Product.findOne({ sku: 'TEST-JACKET-03' }).lean();
        assert.ok(saved);
        assert.strictEqual(saved.is_universal, true);
    });
});
