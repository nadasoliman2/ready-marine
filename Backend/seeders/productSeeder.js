require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');

const { Seller } = require('../models/sellers');
const { Category } = require('../models/categories');
const { Brand: ProductBrand } = require('../models/product_brands');
const { Brand: CarBrand } = require('../models/product_brands');
const { Product } = require('../models/products');
const { connectToDatabase } = require('./db');

/* ============================================================
   HELPERS
   ============================================================ */
const yrs = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ({ year: from + i }));
const slug = (str) => str.toLowerCase().replace(/[\s\/&]+/g, '-').replace(/[^a-z0-9-]/g, '');

const seedData = async () => {
    try {
        await connectToDatabase();
        console.log('✅ Connected to MongoDB');

        const resetSeedData = process.env.RESET_SEED_DATA === 'true';
        const [productBrandCount, productCount, sellerCount] = await Promise.all([
            ProductBrand.countDocuments({}),
            Product.countDocuments({}),
            Seller.countDocuments({}),
        ]);

        if (!resetSeedData && (productBrandCount > 0 || productCount > 0 || sellerCount > 0)) {
            console.log(
                `ℹ️  Found existing product data: ${productBrandCount} product brands, ${productCount} products, ${sellerCount} sellers. Skipping destructive reseed.`
            );
            await mongoose.disconnect();
            process.exit(0);
        }

        if (resetSeedData) {
            await Promise.all([
                ProductBrand.deleteMany({}),
                Product.deleteMany({}),
                Seller.deleteMany({}),
            ]);
            console.log('🗑️  Cleared existing data');
        }

        /* ====================================================
           1. SELLER
           ==================================================== */
        const seller = await Seller.create({
            name: 'Ready Marine Official Store',
            store_name: 'Ready Marine Premium Parts',
            store_username: 'readymarine_official',
            email: 'info@readymarine.store',
            phone: '920001234',
            // Seeded vendors need a real Egyptian city, otherwise they can never be linked to
            // Bosta and show up forever in the unlinked-locations sweep.
            locations: [{ address: '12 Street 9, Maadi as Sarayat, Cairo', shipping_country: 'Egypt', shipping_city: 'Cairo', is_default: true }],
            password: 'hashed_password_placeholder',
        });
        console.log('🏪 Seller created');

        const allCats = await Category.find({});
        console.log(`📂 Found ${allCats.length} existing categories in DB`);

        const getCat = (name) => allCats.find(c => c.name === name) || allCats[0];

        /* ====================================================
           3. CAR BRANDS  (Fetch from DB since seeded separately)
           ==================================================== */
        const createdCarBrands = await CarBrand.find({});
        console.log(`📂 Found ${createdCarBrands.length} existing car brands in DB`);

        const getCB = (name) => createdCarBrands.find(b => b.name === name);
        const getMod = (cb, modelName) => cb?.models.find(m => m.name === modelName);

        /* ====================================================
           4. PRODUCT BRANDS
           ==================================================== */
        const pBrandDefs = [
            { name: 'Bosch', image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Bosch-brand.svg/320px-Bosch-brand.svg.png' },
            { name: 'Denso', image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/DENSO_logo.svg/320px-DENSO_logo.svg.png' },
            { name: 'NGK', image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/NGK_logo.svg/320px-NGK_logo.svg.png' },
            { name: 'Brembo', image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e9/Brembo_logo.svg/320px-Brembo_logo.svg.png' },
            { name: 'Mobil 1', image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Mobil_1_logo.svg/320px-Mobil_1_logo.svg.png' },
            { name: 'Castrol', image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Castrol_logo.svg/320px-Castrol_logo.svg.png' },
            { name: 'KYB', image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/KYB_logo.svg/320px-KYB_logo.svg.png' },
            { name: 'Aisin', image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/62/Aisin_logo.svg/320px-Aisin_logo.svg.png' },
        ];
        const createdPBrands = [];
        for (const b of pBrandDefs) {
            createdPBrands.push(await ProductBrand.create({ name: b.name, image: b.image }));
        }
        console.log(`🏷️  ${createdPBrands.length} product brands created`);

        const getPB = (name) => createdPBrands.find(b => b.name === name) || createdPBrands[0];

        /* ====================================================
           5. PRODUCTS  (30 real, named products)
           ==================================================== */

        // Pexels images for auto parts
        const IMG = {
            brakePad: 'https://images.pexels.com/photos/4489749/pexels-photo-4489749.jpeg?auto=compress&cs=tinysrgb&w=800',
            sparkPlug: 'https://images.pexels.com/photos/4488636/pexels-photo-4488636.jpeg?auto=compress&cs=tinysrgb&w=800',
            oilFilter: 'https://images.pexels.com/photos/6894430/pexels-photo-6894430.jpeg?auto=compress&cs=tinysrgb&w=800',
            shockAbsorber: 'https://images.pexels.com/photos/279949/pexels-photo-279949.jpeg?auto=compress&cs=tinysrgb&w=800',
            radiator: 'https://images.pexels.com/photos/3806983/pexels-photo-3806983.jpeg?auto=compress&cs=tinysrgb&w=800',
            enginePart: 'https://images.pexels.com/photos/190537/pexels-photo-190537.jpeg?auto=compress&cs=tinysrgb&w=800',
            battery: 'https://images.pexels.com/photos/4489741/pexels-photo-4489741.jpeg?auto=compress&cs=tinysrgb&w=800',
            brakeDisc: 'https://images.pexels.com/photos/4489762/pexels-photo-4489762.jpeg?auto=compress&cs=tinysrgb&w=800',
            headlight: 'https://images.pexels.com/photos/244553/pexels-photo-244553.jpeg?auto=compress&cs=tinysrgb&w=800',
            oilChange: 'https://images.pexels.com/photos/3807517/pexels-photo-3807517.jpeg?auto=compress&cs=tinysrgb&w=800',
        };

        // Helper to build slug with a unique suffix to avoid collisions
        let slugCounter = 1000;
        const makeSlug = (str) => `${slug(str)}-${slugCounter++}`;
        const makeSlugAr = (str) => {
            // Create a URL-safe Arabic slug with a number suffix
            const num = slugCounter++;
            return `${str.replace(/\s+/g, '-')}-${num}`;
        };

        const descEn = (part) =>
            `Premium ${part} manufactured to OEM specifications. Engineered for superior performance, durability, and exact fitment. Rigorously tested to meet international quality standards. Easy bolt-on installation with no modifications required.`;
        const descAr = (part) =>
            `${part} فائقة الجودة مصنوعة وفق مواصفات OEM. مصممة لأداء عالٍ ومتانة وملاءمة مثالية. تم اختبارها بصرامة وفق معايير الجودة الدولية. سهلة التركيب دون الحاجة إلى أي تعديلات.`;

        // Shorthand helpers
        const toy = getCB('Toyota');
        const hon = getCB('Honda');
        const bmw = getCB('BMW');
        const merc = getCB('Mercedes-Benz');
        const nis = getCB('Nissan');
        const hyu = getCB('Hyundai');
        const kia = getCB('Kia');
        const ford = getCB('Ford');
        const chev = getCB('Chevrolet');
        const lex = getCB('Lexus');

        const allBrand = (cb) => ({
            brand_id: cb._id, brand_name: cb.name,
            all_models: true, models: [],
        });

        const allYears = (cb, modelName) => {
            const m = getMod(cb, modelName);
            return {
                brand_id: cb._id, brand_name: cb.name,
                all_models: false,
                models: [{ model_id: m._id, model_name: m.name, all_years: true, years: [] }],
            };
        };

        const specificYears = (cb, modelName, years) => {
            const m = getMod(cb, modelName);
            return {
                brand_id: cb._id, brand_name: cb.name,
                all_models: false,
                models: [{ model_id: m._id, model_name: m.name, all_years: false, years }],
            };
        };

        const multiModels = (cb, specs) => ({
            brand_id: cb._id, brand_name: cb.name,
            all_models: false,
            models: specs.map(({ modelName, years, allYrs }) => {
                const m = getMod(cb, modelName);
                return { model_id: m._id, model_name: m.name, all_years: !!allYrs, years: years || [] };
            }),
        });



