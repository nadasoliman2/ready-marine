require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');

const { Seller } = require('../models/sellers');
const { Category } = require('../models/categories');
const { Brand: ProductBrand } = require('../models/product_brands');
const { CarBrand } = require('../models/car_brands');
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
            name: 'ReadyCar Official Store',
            store_name: 'ReadyCar Premium Parts',
            store_username: 'readycar_official',
            email: 'info@readycar.store',
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

        const productDefs = [
            /* ---- UNIVERSAL (is_universal = true) ---- */
            {
                title_en: 'Bosch Workshop Windshield Wiper Set',
                title_ar: 'طقم مساحات زجاج بوش ورك شوب',
                subtitle_en: 'All-Season Universal Wiper Blade',
                subtitle_ar: 'مساحة عالمية لجميع الفصول',
                desc: 'Windshield Wiper',
                desc_ar: 'مساحات الزجاج',
                catName: 'Filters', brandName: 'Bosch',
                sku: 'BSH-WW-3397118903', part_number: 'W-3397118903', gtin: '4047024462793',
                price: 89, image: IMG.enginePart, is_universal: true, compatible_cars: [],
            },
            {
                title_en: 'Castrol EDGE 5W-30 Full Synthetic Engine Oil',
                title_ar: 'زيت محرك كاسترول إيدج 5W-30 تخليقي كامل',
                subtitle_en: 'Fluid Titanium Technology — 5 Litre',
                subtitle_ar: 'تقنية التيتانيوم السائل — 5 لتر',
                desc: 'Full Synthetic Engine Oil',
                desc_ar: 'زيت محرك تخليقي كامل',
                catName: 'Oil Filters', brandName: 'Castrol',
                sku: 'CST-EDGE-5W30-5L', part_number: 'C-15669E', gtin: '4008177072604',
                price: 145, image: IMG.oilChange, is_universal: true, compatible_cars: [],
            },
            {
                title_en: 'Mobil 1 0W-40 Advanced Full Synthetic Motor Oil',
                title_ar: 'زيت موتور موبيل 1 تخليقي 0W-40',
                subtitle_en: 'Extended Performance — 5 Quart',
                subtitle_ar: 'أداء مطوّل — 5 كوارت',
                desc: 'Advanced Full Synthetic Motor Oil',
                desc_ar: 'زيت موتور تخليقي متقدم',
                catName: 'Oil Filters', brandName: 'Mobil 1',
                sku: 'MOB1-0W40-5QT', part_number: 'M-120760', gtin: '0071924120761',
                price: 165, image: IMG.oilChange, is_universal: true, compatible_cars: [],
            },
            {
                title_en: 'Bosch S5 AGM Battery 70Ah',
                title_ar: 'بطارية بوش S5 AGM سعة 70 أمبير',
                subtitle_en: 'Absorbent Glass Mat — Stop/Start Ready',
                subtitle_ar: 'تقنية AGM — تدعم نظام Stop/Start',
                desc: 'AGM Car Battery',
                desc_ar: 'بطارية سيارة AGM',
                catName: 'Batteries', brandName: 'Bosch',
                sku: 'BSH-S5-A08', part_number: 'B-0092S5A080', gtin: '4047023728880',
                price: 620, image: IMG.battery, is_universal: true, compatible_cars: [],
            },

            /* ---- BRAND-WIDE: all_models = true ---- */
            {
                title_en: 'Denso Air Filter — All Toyota Models',
                title_ar: 'فلتر هواء دينسو — جميع موديلات تويوتا',
                subtitle_en: 'OEM Quality Replacement Air Filter',
                subtitle_ar: 'فلتر هواء بديل بجودة OEM',
                desc: 'Air Filter',
                desc_ar: 'فلتر الهواء',
                catName: 'Air Filters', brandName: 'Denso',
                sku: 'DNS-AF-TOY-ALL', part_number: 'D-143-3471', gtin: '0019971403437',
                price: 75, image: IMG.oilFilter,
                is_universal: false,
                compatible_cars: [allBrand(toy)],
            },
            {
                title_en: 'NGK Spark Plug Set — All Honda Engines',
                title_ar: 'طقم بواجي NGK — لجميع محركات هوندا',
                subtitle_en: 'Iridium IX High Performance — Set of 4',
                subtitle_ar: 'إيريديوم IX عالي الأداء — 4 بواجي',
                desc: 'Iridium Spark Plug Set',
                desc_ar: 'طقم بواجي الإيريديوم',
                catName: 'Spark Plugs', brandName: 'NGK',
                sku: 'NGK-IXU-HON-4PK', part_number: 'N-IZFR6K11', gtin: '4548163044101',
                price: 210, image: IMG.sparkPlug,
                is_universal: false,
                compatible_cars: [allBrand(hon)],
            },
            {
                title_en: 'Brembo Brake Pad Set — All BMW Models',
                title_ar: 'طقم فحمات فرامل بريمبو — جميع موديلات BMW',
                subtitle_en: 'Low Dust Premium Ceramic Formula',
                subtitle_ar: 'صيغة سيراميك ممتازة منخفضة الغبار',
                desc: 'Ceramic Brake Pad Set',
                desc_ar: 'طقم فحمات فرامل سيراميك',
                catName: 'Brake Pads', brandName: 'Brembo',
                sku: 'BRM-BP-BMW-CER', part_number: 'B-P06017N', gtin: '8014966155847',
                price: 385, image: IMG.brakePad,
                is_universal: false,
                compatible_cars: [allBrand(bmw)],
            },
            {
                title_en: 'KYB Shock Absorber — All Nissan Patrol Years',
                title_ar: 'مساعد KYB — نيسان باترول جميع السنوات',
                subtitle_en: 'Excel-G Gas Pressurized — Front Pair',
                subtitle_ar: 'غاز Excel-G مضغوط — زوج أمامي',
                desc: 'Gas Shock Absorber',
                desc_ar: 'مساعد غاز',
                catName: 'Shock Absorbers', brandName: 'KYB',
                sku: 'KYB-EG-NIS-PAT-F', part_number: 'K-341117', gtin: '4961477341119',
                price: 520, image: IMG.shockAbsorber,
                is_universal: false,
                compatible_cars: [allYears(nis, 'Patrol')],
            },

            /* ---- MODEL-WIDE: all_years = true on specific models ---- */
            {
                title_en: 'Denso Radiator Assembly — Toyota Camry (All Years)',
                title_ar: 'رادياتير دينسو — تويوتا كامري (جميع السنوات)',
                subtitle_en: 'First Time Fit Dual-Core Radiator',
                subtitle_ar: 'رادياتير ثنائي النواة بملاءمة مثالية',
                desc: 'Radiator Assembly',
                desc_ar: 'مجموعة الرادياتير',
                catName: 'Radiators', brandName: 'Denso',
                sku: 'DNS-RAD-CAM-AY', part_number: 'D-221-3138', gtin: '0014286099843',
                price: 980, image: IMG.radiator,
                is_universal: false,
                compatible_cars: [allYears(toy, 'Camry')],
            },
            {
                title_en: 'Brembo Rear Brake Disc — Mercedes-Benz C-Class (All Years)',
                title_ar: 'هوبة فرامل خلفية بريمبو — مرسيدس C-Class (جميع السنوات)',
                subtitle_en: 'Sport Drilled & Slotted Disc — Single',
                subtitle_ar: 'هوبة رياضية مثقوبة ومشقوقة — قطعة واحدة',
                desc: 'Drilled & Slotted Brake Disc',
                desc_ar: 'هوبة فرامل مثقوبة ومشقوقة',
                catName: 'Brake Discs', brandName: 'Brembo',
                sku: 'BRM-BD-MEC-AY', part_number: 'B-08A54711', gtin: '8014966158244',
                price: 460, image: IMG.brakeDisc,
                is_universal: false,
                compatible_cars: [allYears(merc, 'C-Class')],
            },
            {
                title_en: 'Bosch Ignition Coil — Toyota Corolla (All Years)',
                title_ar: 'كويل إشعال بوش — تويوتا كورولا (جميع السنوات)',
                subtitle_en: 'OE Replacement Ignition Coil Pack',
                subtitle_ar: 'طقم كويل إشعال بديل مطابق للأصلي',
                desc: 'Ignition Coil',
                desc_ar: 'كويل الإشعال',
                catName: 'Ignition Coils', brandName: 'Bosch',
                sku: 'BSH-IC-COR-AY', part_number: 'B-0221604115', gtin: '4047024300172',
                price: 195, image: IMG.enginePart,
                is_universal: false,
                compatible_cars: [allYears(toy, 'Corolla')],
            },
            {
                title_en: 'NGK Iridium Spark Plug — Honda Civic (All Years)',
                title_ar: 'بواجي NGK إيريديوم — هوندا سيفيك (جميع السنوات)',
                subtitle_en: 'Laser Iridium OEM Replacement',
                subtitle_ar: 'بواجي إيريديوم ليزر بديل OEM',
                desc: 'Laser Iridium Spark Plug',
                desc_ar: 'بواجي الإيريديوم الليزري',
                catName: 'Spark Plugs', brandName: 'NGK',
                sku: 'NGK-LI-CIV-AY', part_number: 'N-SILZKAR7B11', gtin: '4548163159017',
                price: 95, image: IMG.sparkPlug,
                is_universal: false,
                compatible_cars: [allYears(hon, 'Civic')],
            },
            {
                title_en: 'Aisin Water Pump — Hyundai Elantra (All Years)',
                title_ar: 'مضخة مياه أيسين — هيونداي إيلانترا (جميع السنوات)',
                subtitle_en: 'OE Quality Coolant Pump with Gasket',
                subtitle_ar: 'مضخة التبريد بجودة OE مع حشية',
                desc: 'Coolant Water Pump',
                desc_ar: 'مضخة سائل التبريد',
                catName: 'Water Pumps', brandName: 'Aisin',
                sku: 'ASN-WP-ELA-AY', part_number: 'A-WPH-012', gtin: '4528427000129',
                price: 275, image: IMG.radiator,
                is_universal: false,
                compatible_cars: [allYears(hyu, 'Elantra')],
            },

            /* ---- SPECIFIC: brand + model + specific years ---- */
            {
                title_en: 'Brembo P06087N Front Brake Pad Set',
                title_ar: 'طقم فحمات فرامل أمامية بريمبو P06087N',
                subtitle_en: 'Premium Ceramic Compound — Low Noise',
                subtitle_ar: 'تركيبة سيراميك ممتازة — صوت منخفض',
                desc: 'Ceramic Front Brake Pad',
                desc_ar: 'فحمة فرامل أمامية سيراميك',
                catName: 'Brake Pads', brandName: 'Brembo',
                sku: 'BRM-P06087N', part_number: 'B-P06087N', gtin: '8014966155779',
                price: 320, image: IMG.brakePad,
                is_universal: false,
                compatible_cars: [
                    specificYears(toy, 'Camry', [2018, 2019, 2020, 2021, 2022, 2023, 2024]),
                    specificYears(toy, 'RAV4', [2019, 2020, 2021, 2022, 2023]),
                ],
            },
            {
                title_en: 'KYB Excel-G Rear Shock Absorber — BMW 5 Series',
                title_ar: 'مساعد خلفي KYB Excel-G — BMW الفئة الخامسة',
                subtitle_en: 'Gas Charged — OE Replacement Performance',
                subtitle_ar: 'مشحون بالغاز — أداء OE بديل',
                desc: 'Rear Gas Shock Absorber',
                desc_ar: 'مساعد خلفي غاز',
                catName: 'Shock Absorbers', brandName: 'KYB',
                sku: 'KYB-EG-BMW5-R', part_number: 'K-365015', gtin: '4961477365015',
                price: 610, image: IMG.shockAbsorber,
                is_universal: false,
                compatible_cars: [
                    specificYears(bmw, '5 Series', [2017, 2018, 2019, 2020, 2021, 2022, 2023]),
                ],
            },
            {
                title_en: 'Bosch Fuel Filter — Nissan Altima 2019–2024',
                title_ar: 'فلتر وقود بوش — نيسان التيما 2019–2024',
                subtitle_en: 'High Flow In-Line Fuel Filter',
                subtitle_ar: 'فلتر وقود عالي التدفق',
                desc: 'In-Line Fuel Filter',
                desc_ar: 'فلتر الوقود',
                catName: 'Fuel Filters', brandName: 'Bosch',
                sku: 'BSH-FF-NIS-ALT', part_number: 'B-71054', gtin: '0028851711545',
                price: 115, image: IMG.oilFilter,
                is_universal: false,
                compatible_cars: [
                    specificYears(nis, 'Altima', [2019, 2020, 2021, 2022, 2023, 2024]),
                ],
            },
            {
                title_en: 'Denso Oil Filter — Toyota Land Cruiser 2015–2024',
                title_ar: 'فلتر زيت دينسو — تويوتا لاند كروزر 2015–2024',
                subtitle_en: 'Enhanced Filtration Capacity',
                subtitle_ar: 'قدرة ترشيح محسّنة',
                desc: 'Engine Oil Filter',
                desc_ar: 'فلتر زيت المحرك',
                catName: 'Oil Filters', brandName: 'Denso',
                sku: 'DNS-OF-LC-2015', part_number: 'D-150-2024', gtin: '0019971150243',
                price: 65, image: IMG.oilFilter,
                is_universal: false,
                compatible_cars: [
                    specificYears(toy, 'Land Cruiser', [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024]),
                ],
            },
            {
                title_en: 'Aisin Thermostat — Toyota Hilux 2012–2024',
                title_ar: 'ثرموستات أيسين — تويوتا هايلوكس 2012–2024',
                subtitle_en: 'OE Quality Coolant Thermostat with Housing',
                subtitle_ar: 'ثرموستات التبريد مع الهيكل بجودة OE',
                desc: 'Engine Thermostat',
                desc_ar: 'ثرموستات المحرك',
                catName: 'Thermostats', brandName: 'Aisin',
                sku: 'ASN-TS-HLX-12', part_number: 'A-THT-006', gtin: '4528427000617',
                price: 145, image: IMG.radiator,
                is_universal: false,
                compatible_cars: [
                    specificYears(toy, 'Hilux', [2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024]),
                ],
            },
            {
                title_en: 'NGK Iridium Spark Plug — BMW 3 Series / 5 Series',
                title_ar: 'بواجي NGK إيريديوم — BMW الفئة الثالثة / الخامسة',
                subtitle_en: '4-Electrode Laser Iridium — Set of 6',
                subtitle_ar: 'إيريديوم ليزري رباعي الأقطاب — طقم 6',
                desc: 'Laser Iridium Spark Plug',
                desc_ar: 'بواجي الإيريديوم الليزري',
                catName: 'Spark Plugs', brandName: 'NGK',
                sku: 'NGK-LI-BMW35-6PK', part_number: 'N-BKR6EKPA', gtin: '4548163300458',
                price: 380, image: IMG.sparkPlug,
                is_universal: false,
                compatible_cars: [
                    multiModels(bmw, [
                        { modelName: '3 Series', years: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023] },
                        { modelName: '5 Series', years: [2017, 2018, 2019, 2020, 2021, 2022, 2023] },
                    ]),
                ],
            },
            {
                title_en: 'Brembo Rear Brake Pad Set — Honda Accord & CR-V',
                title_ar: 'طقم فحمات فرامل خلفية بريمبو — هوندا أكورد وCR-V',
                subtitle_en: 'Street Performance Organic Formula',
                subtitle_ar: 'صيغة عضوية لأداء الشوارع',
                desc: 'Rear Organic Brake Pad Set',
                desc_ar: 'طقم فحمات فرامل خلفية عضوية',
                catName: 'Brake Pads', brandName: 'Brembo',
                sku: 'BRM-BP-HON-AOR', part_number: 'B-P28075', gtin: '8014966128009',
                price: 295, image: IMG.brakePad,
                is_universal: false,
                compatible_cars: [
                    multiModels(hon, [
                        { modelName: 'Accord', years: [2016, 2017, 2018, 2019, 2020, 2021, 2022] },
                        { modelName: 'CR-V', years: [2015, 2016, 2017, 2018, 2019, 2020, 2021] },
                    ]),
                ],
            },
            {
                title_en: 'KYB Front Shock Absorber — Kia Sportage & Hyundai Tucson',
                title_ar: 'مساعد أمامي KYB — كيا سبورتاج وهيونداي توسان',
                subtitle_en: 'Gas-A-Just Monotube — Front Left or Right',
                subtitle_ar: 'أحادي الأنبوب Gas-A-Just — أمامي أيمن أو أيسر',
                desc: 'Front Monotube Shock Absorber',
                desc_ar: 'مساعد أمامي أحادي الأنبوب',
                catName: 'Shock Absorbers', brandName: 'KYB',
                sku: 'KYB-GAJ-KIA-HYU', part_number: 'K-551105', gtin: '4961477551104',
                price: 410, image: IMG.shockAbsorber,
                is_universal: false,
                compatible_cars: [
                    multiModels(kia, [
                        { modelName: 'Sportage', years: [2017, 2018, 2019, 2020, 2021, 2022] },
                    ]),
                    multiModels(hyu, [
                        { modelName: 'Tucson', years: [2016, 2017, 2018, 2019, 2020, 2021] },
                    ]),
                ],
            },
            {
                title_en: 'Bosch Headlight Assembly — Mercedes-Benz E-Class',
                title_ar: 'مجموعة المصباح الأمامي بوش — مرسيدس E-Class',
                subtitle_en: 'LED Bi-Xenon Projector Assembly — Driver Side',
                subtitle_ar: 'مجموعة بروجكتور LED بي-زينون — جانب السائق',
                desc: 'Headlight Assembly',
                desc_ar: 'مجموعة المصباح الأمامي',
                catName: 'Headlights', brandName: 'Bosch',
                sku: 'BSH-HL-MEC-ECS', part_number: 'B-AL167000', gtin: '4047024710078',
                price: 1250, image: IMG.headlight,
                is_universal: false,
                compatible_cars: [
                    specificYears(merc, 'E-Class', [2017, 2018, 2019, 2020, 2021, 2022]),
                ],
            },
            {
                title_en: 'Denso Fuel Filter — Ford F-150 2015–2024',
                title_ar: 'فلتر وقود دينسو — فورد F-150 2015–2024',
                subtitle_en: 'High-Pressure In-Tank Fuel Filter',
                subtitle_ar: 'فلتر وقود بضغط عالٍ داخل الخزان',
                desc: 'In-Tank Fuel Filter',
                desc_ar: 'فلتر وقود داخل الخزان',
                catName: 'Fuel Filters', brandName: 'Denso',
                sku: 'DNS-FF-F150-15', part_number: 'D-952-0001', gtin: '0019971950019',
                price: 185, image: IMG.oilFilter,
                is_universal: false,
                compatible_cars: [
                    specificYears(ford, 'F-150', [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024]),
                ],
            },
            {
                title_en: 'Aisin Control Arm — Lexus RX 350 & LX 570',
                title_ar: 'مقص تعليق أيسين — لكزس RX 350 وLX 570',
                subtitle_en: 'OEM Replacement Front Lower Control Arm',
                subtitle_ar: 'مقص التعليق الأمامي السفلي بديل OEM',
                desc: 'Front Lower Control Arm',
                desc_ar: 'مقص التعليق الأمامي السفلي',
                catName: 'Control Arms', brandName: 'Aisin',
                sku: 'ASN-CA-LEX-RX-LX', part_number: 'A-WCKX-1001', gtin: '4528427100018',
                price: 720, image: IMG.shockAbsorber,
                is_universal: false,
                compatible_cars: [
                    multiModels(lex, [
                        { modelName: 'RX 350', years: [2016, 2017, 2018, 2019, 2020, 2021, 2022] },
                        { modelName: 'LX 570', years: [2015, 2016, 2017, 2018, 2019, 2020, 2021] },
                    ]),
                ],
            },
            {
                title_en: 'Brembo Rear Brake Disc — Chevrolet Silverado',
                title_ar: 'هوبة فرامل خلفية بريمبو — شيفروليه سيلفرادو',
                subtitle_en: 'Max Braking Drilled & Slotted Rotor',
                subtitle_ar: 'روتور مثقوب ومشقوق للكبح الأقصى',
                desc: 'Rear Drilled & Slotted Brake Disc',
                desc_ar: 'هوبة فرامل خلفية مثقوبة ومشقوقة',
                catName: 'Brake Discs', brandName: 'Brembo',
                sku: 'BRM-BD-SLV-R', part_number: 'B-25767B', gtin: '8014966120003',
                price: 540, image: IMG.brakeDisc,
                is_universal: false,
                compatible_cars: [
                    specificYears(chev, 'Silverado', [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022]),
                ],
            },
            {
                title_en: 'Bosch Ignition Coil — Chevrolet Tahoe & Silverado',
                title_ar: 'كويل إشعال بوش — شيفروليه تاهو وسيلفرادو',
                subtitle_en: 'High Energy Inductive Ignition Coil',
                subtitle_ar: 'كويل إشعال حثي عالي الطاقة',
                desc: 'High Energy Ignition Coil',
                desc_ar: 'كويل الإشعال عالي الطاقة',
                catName: 'Ignition Coils', brandName: 'Bosch',
                sku: 'BSH-IC-CHV-TAS', part_number: 'B-0221604008', gtin: '4047024300141',
                price: 235, image: IMG.enginePart,
                is_universal: false,
                compatible_cars: [
                    multiModels(chev, [
                        { modelName: 'Tahoe', years: [2014, 2015, 2016, 2017, 2018, 2019, 2020] },
                        { modelName: 'Silverado', years: [2014, 2015, 2016, 2017, 2018, 2019, 2020] },
                    ]),
                ],
            },
            {
                title_en: 'Denso Alternator — Toyota Camry 2018–2024',
                title_ar: 'دينامو دينسو — تويوتا كامري 2018–2024',
                subtitle_en: 'Remanufactured OE Alternator — 150A',
                subtitle_ar: 'دينامو OE مُعاد تصنيعه — 150 أمبير',
                desc: 'OE Remanufactured Alternator',
                desc_ar: 'دينامو مُعاد تصنيعه بجودة OE',
                catName: 'Alternators', brandName: 'Denso',
                sku: 'DNS-ALT-CAM-18', part_number: 'D-210-1104', gtin: '0019971211046',
                price: 890, image: IMG.enginePart,
                is_universal: false,
                compatible_cars: [
                    specificYears(toy, 'Camry', [2018, 2019, 2020, 2021, 2022, 2023, 2024]),
                ],
            },
            {
                title_en: 'KYB Ball Joint Kit — Kia Sorento 2015–2022',
                title_ar: 'طقم جوزة KYB — كيا سورنتو 2015–2022',
                subtitle_en: 'Front Lower Ball Joint with Dust Boot',
                subtitle_ar: 'جوزة تعليق أمامية سفلية مع غطاء واقٍ',
                desc: 'Front Lower Ball Joint',
                desc_ar: 'جوزة التعليق الأمامية السفلية',
                catName: 'Ball Joints', brandName: 'KYB',
                sku: 'KYB-BJ-KIA-SOR', part_number: 'K-GBJ1080', gtin: '4961477108046',
                price: 175, image: IMG.shockAbsorber,
                is_universal: false,
                compatible_cars: [
                    specificYears(kia, 'Sorento', [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022]),
                ],
            },
            {
                title_en: 'NGK Oxygen Sensor — Ford Explorer 2016–2024',
                title_ar: 'حساس الأكسجين NGK — فورد إكسبلورر 2016–2024',
                subtitle_en: 'Upstream Air-Fuel Ratio Sensor',
                subtitle_ar: 'حساس نسبة الهواء/الوقود العلوي',
                desc: 'Air-Fuel Ratio Oxygen Sensor',
                desc_ar: 'حساس الأكسجين لنسبة الهواء والوقود',
                catName: 'Sensors', brandName: 'NGK',
                sku: 'NGK-OS-FRD-EXP', part_number: 'N-24388', gtin: '4548163243886',
                price: 290, image: IMG.enginePart,
                is_universal: false,
                compatible_cars: [
                    specificYears(ford, 'Explorer', [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024]),
                ],
            },
        ];

        let created = 0;
        for (const def of productDefs) {
            const cat = getCat(def.catName);
            const pBrand = getPB(def.brandName);

            const slugEn = makeSlug(def.title_en);
            const slugAr = makeSlugAr(def.title_ar);

            await Product.create({
                vendor_id: seller._id,
                category_id: cat._id,
                product_brand_id: pBrand._id,

                title_en: def.title_en,
                title_ar: def.title_ar,
                subtitle_en: def.subtitle_en,
                subtitle_ar: def.subtitle_ar,
                description_en: descEn(def.desc),
                description_ar: descAr(def.desc_ar),

                sku: def.sku,
                part_number: def.part_number,
                gtin: def.gtin,

                slug_en: slugEn,
                slug_ar: slugAr,

                status: 'published',
                is_published: true,

                price: def.price,
                // `def.discount` is a fraction (0.15 = 15% off). discount_price is
                // derived by the model from this pair — never set it directly.
                discount_type: def.discount ? 'percentage' : null,
                discount_value: def.discount ? def.discount * 100 : null,

                is_universal: def.is_universal,
                compatible_cars: def.compatible_cars || [],

                is_featured: created < 6,          // first 6 are featured
                is_special_offer: created % 5 === 4,    // every 5th is a special offer

                quantity: 20 + Math.floor(Math.random() * 80),

                images: [
                    { url: def.image, is_primary: true },
                ],

                rating: 3.8 + Math.random() * 1.2,
                reviews_count: 10 + Math.floor(Math.random() * 200),

                sold_count: Math.floor(Math.random() * 500),
            });
            created++;
        }

        console.log(`✅ ${created} products seeded successfully!`);
        console.log('\n📊 Summary:');
        console.log('  - Sellers:         1');
        console.log(`  - Categories:      ${allCats.length}`);
        console.log(`  - Car Brands:      ${createdCarBrands.length}`);
        console.log(`  - Product Brands:  ${createdPBrands.length}`);
        console.log(`  - Products:        ${created}`);
        process.exit(0);

    } catch (err) {
        console.error('❌ Seeding error:', err.message || err);
        process.exit(1);
    }
};

seedData();
