require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');

const { Seller } = require('../models/sellers');
const { Category } = require('../models/categories');
const { Brand: ProductBrand } = require('../models/product_brands');
const { CarBrand } = require('../models/car_brands');
const { Product } = require('../models/products');
const { SiteSettings } = require('../models/site_settings');
const { connectToDatabase } = require('./db');

/*
 * Ready Marine's starting catalogue: the engine and vessel makes the fitment search offers,
 * the marine brands, and the products in seeders/data/marineProducts.json (photos from
 * Wikimedia Commons). It replaces whatever products, product brands and makes are there,
 * so it refuses to run over existing products without --reset:
 *
 *   node ./seeders/marineCatalogSeeder.js --reset
 *
 * Categories are left as they are (seeded from readymarine_scrapping by categorySeeder).
 */

const yrs = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ({ year: from + i }));

// The "car brands" collection holds whatever a part is fitted to; here, outboard and inboard
// engine makers, personal watercraft and boat builders.
const MAKES = [
    { name: 'Yamaha', models: ['F25', 'F70', 'F115', 'F150', 'F200', 'F250', 'F300', 'F350'], years: [2012, 2025], featured: true },
    { name: 'Mercury', models: ['FourStroke 40', 'FourStroke 115', 'FourStroke 150', 'Verado 250', 'Verado 300', 'Verado 400'], years: [2012, 2025], featured: true },
    { name: 'Suzuki Marine', models: ['DF40A', 'DF90A', 'DF140A', 'DF200A', 'DF300B'], years: [2012, 2025], featured: true },
    { name: 'Honda Marine', models: ['BF20', 'BF50', 'BF100', 'BF150', 'BF225', 'BF250'], years: [2012, 2025], featured: true },
    { name: 'Volvo Penta', models: ['D2-40', 'D4-300', 'D6-440', 'IPS 600', 'V8-350'], years: [2010, 2025], featured: true },
    { name: 'Yanmar', models: ['3YM30', '4JH57', '6LY440', '8LV370'], years: [2010, 2025], featured: true },
    { name: 'Evinrude', models: ['E-TEC 90', 'E-TEC G2 150', 'E-TEC G2 250'], years: [2010, 2020] },
    { name: 'Tohatsu', models: ['MFS30', 'MFS60', 'MFS115'], years: [2012, 2025] },
    { name: 'Caterpillar Marine', models: ['C7.1', 'C12.9', 'C18', 'C32'], years: [2010, 2025] },
    { name: 'Cummins Marine', models: ['QSB6.7', 'QSC8.3', 'QSM11'], years: [2010, 2025] },
    { name: 'Sea-Doo', models: ['Spark', 'GTI 130', 'RXT-X 300'], years: [2015, 2025] },
    { name: 'Yamaha WaveRunner', models: ['VX Cruiser', 'FX Cruiser SVHO', 'GP1800R'], years: [2015, 2025] },
    { name: 'Bayliner', models: ['VR5', 'Element E18', 'Trophy T22CC'], years: [2014, 2025] },
    { name: 'Sea Ray', models: ['SPX 190', 'SDX 250', 'Sundancer 320'], years: [2014, 2025] },
    { name: 'Beneteau', models: ['Flyer 8', 'Antares 9', 'Oceanis 40.1'], years: [2014, 2025] },
    { name: 'Azimut', models: ['Atlantis 45', 'Azimut 53', 'Grande 27M'], years: [2014, 2025] },
];

// Sold counts for the "most sold" rail, highest first in catalogue order — a stand-in until
// real orders exist. No ratings: those only ever come from real reviews.
const soldCount = (index) => Math.max(0, 240 - index * 9);

const slugify = (str) => str.toLowerCase().replace(/[\s/&'"″]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
const slugifyAr = (str) => str.trim().replace(/[\s/]+/g, '-').replace(/["'″]/g, '');

const run = async () => {
    await connectToDatabase();
    console.log('✅ Connected to MongoDB:', mongoose.connection.db.databaseName);

    const reset = process.argv.includes('--reset');
    const existing = await Product.countDocuments({});
    if (existing > 0 && !reset) {
        console.log(`ℹ️  ${existing} products already exist. Pass --reset to replace them with the marine catalogue.`);
        process.exit(0);
    }

    const products = require('./data/marineProducts.json');
    const categories = await Category.find({});
    const categoryByName = new Map(categories.map((c) => [c.name, c]));
    const missing = [...new Set(products.map((p) => p.category))].filter((name) => !categoryByName.has(name));
    if (missing.length) throw new Error(`Categories not in the database: ${missing.join(', ')} — run seed:categories first.`);

    await Promise.all([Product.deleteMany({}), ProductBrand.deleteMany({}), CarBrand.deleteMany({})]);
    console.log('🗑️  Cleared products, product brands and makes');

    /* Makes and their models */
    const makes = await CarBrand.insertMany(MAKES.map((m) => ({
        name: m.name,
        is_featured: !!m.featured,
        models: m.models.map((name) => ({ name, years: yrs(m.years[0], m.years[1]) })),
    })));
    const makeByName = new Map(makes.map((m) => [m.name, m]));
    console.log(`🚤 ${makes.length} engine & vessel makes`);

    /* Product brands, tagged with the categories they are sold in */
    const brandCategories = new Map();
    for (const p of products) {
        if (!p.brand) continue;
        if (!brandCategories.has(p.brand)) brandCategories.set(p.brand, new Set());
        brandCategories.get(p.brand).add(String(categoryByName.get(p.category)._id));
    }
    const brands = await ProductBrand.insertMany([...brandCategories].map(([name, cats]) => ({ name, categories: [...cats] })));
    const brandByName = new Map(brands.map((b) => [b.name, b]));
    console.log(`🏷️  ${brands.length} product brands`);

    /* The store that sells them */
    let seller = await Seller.findOne({});
    if (seller) {
        seller.name = 'Ready Marine Official Store';
        seller.store_name = 'Ready Marine Official Store';
        seller.store_username = 'readymarine_official';
        seller.email = 'info@tech-oriented.digital';
        await seller.save();
    } else {
        seller = await Seller.create({
            name: 'Ready Marine Official Store',
            store_name: 'Ready Marine Official Store',
            store_username: 'readymarine_official',
            email: 'info@tech-oriented.digital',
            phone: '010155661614',
            locations: [{ address: '696 El Houria St., Louran', shipping_country: 'Egypt', shipping_city: 'Alexandria', is_default: true }],
            password: 'hashed_password_placeholder',
        });
    }
    console.log('🏪 Seller:', seller.store_name);

    /* Products */
    const fitment = (list) => list.map(([makeName, modelNames]) => {
        const make = makeByName.get(makeName);
        if (!make) throw new Error(`Unknown make: ${makeName}`);
        if (!modelNames) return { brand_id: make._id, brand_name: make.name, all_models: true, models: [] };
        return {
            brand_id: make._id,
            brand_name: make.name,
            all_models: false,
            models: modelNames.map((modelName) => {
                const model = make.models.find((m) => m.name === modelName);
                if (!model) throw new Error(`Unknown model: ${makeName} ${modelName}`);
                return { model_id: model._id, model_name: model.name, all_years: true, years: [] };
            }),
        };
    });

    let created = 0;
    for (const [index, def] of products.entries()) {
        const compatible = fitment(def.compatible || []);
        await Product.create({
            vendor_id: seller._id,
            category_id: categoryByName.get(def.category)._id,
            product_brand_id: def.brand ? brandByName.get(def.brand)._id : undefined,

            title_en: def.title_en,
            title_ar: def.title_ar,
            subtitle_en: def.subtitle_en,
            subtitle_ar: def.subtitle_ar,
            description_en: def.description_en || `${def.title_en}. ${def.subtitle_en}. Marine-grade quality, checked by Ready Marine before dispatch to your dock, marina or door anywhere in Egypt.`,
            description_ar: def.description_ar || `${def.title_ar}. ${def.subtitle_ar}. جودة بحرية، بتتراجع من Ready Marine قبل الشحن للمرسى أو المارينا أو لحد باب البيت في أي مكان في مصر.`,

            sku: def.sku,
            part_number: def.part_number,

            slug_en: `${slugify(def.title_en)}-${1000 + index}`,
            slug_ar: `${slugifyAr(def.title_ar)}-${1000 + index}`,

            status: 'published',
            is_published: true,

            price: def.price,
            // `def.discount` is a fraction (0.1 = 10% off); the model derives discount_price.
            discount_type: def.discount ? 'percentage' : null,
            discount_value: def.discount ? Math.round(def.discount * 100) : null,

            is_universal: compatible.length === 0,
            compatible_cars: compatible,

            is_featured: index < 8,
            is_special_offer: !!def.discount,

            stock_management: true,
            quantity: 6 + ((index * 7) % 40),

            images: def.images.map((url, i) => ({ url, is_primary: i === 0 })),

            sold_count: soldCount(index),
        });
        created++;
    }
    console.log(`📦 ${created} products`);

    /* Store identity */
    await SiteSettings.updateOne({}, {
        $set: {
            currency: 'EGP',
            header_phone: '010155661614',
            header_text_en: "Welcome to Ready Marine — Egypt's first multi-vendor marine platform",
            header_text_ar: 'أهلاً بيك في Ready Marine — أول منصة متعددة التجار لقطع غيار اليخوت والمراكب في مصر',
            footer_text_en: 'Genuine yacht, boat and marine engine parts from verified vendors — fitment checked, delivered to your dock, marina or door across Egypt.',
            footer_text_ar: 'قطع غيار أصلية لليخوت والمراكب ومحركاتها من تجار موثّقين — بنتأكد من التوافق ونوصّل للمرسى أو المارينا أو لحد البيت في كل مصر.',
            footer_phones: ['010155661614'],
            footer_emails: ['info@tech-oriented.digital'],
            contact_email: 'info@tech-oriented.digital',
            contact_telephone: '010155661614',
            contact_address: '696 El Houria St. Louran-Alexandria, Egypt',
            locations_en: ['Alexandria, Egypt'],
            locations_ar: ['الإسكندرية، مصر'],
        },
    }, { upsert: true });
    console.log('⚙️  Site settings updated');

    await mongoose.disconnect();
    process.exit(0);
};

run().catch((err) => {
    console.error('❌ Seeding error:', err.message || err);
    process.exit(1);
});
