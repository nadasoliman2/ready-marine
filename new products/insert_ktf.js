/**
 * insert_readycar.js
 * ------------------------------------------------------------------------
 * Import the X-Turbo Auto Parts price list (readycar.xlsx, 696 rows) for vendor
 * chadymuhamed@gmail.com, through the SAME code path the vendor UI uses
 * (services/vendorService.addProduct) — slugs, subscription gate, schema
 * validation and shipping-cache invalidation all run exactly as the dashboard.
 *
 * The sheet has only: supplier code, Arabic name, brand column, super/category,
 * price. Everything else is generated:
 *   - bilingual content (title/subtitle/description, AR native + EN) authored
 *     from the real name + brand + resolved part type + parsed car fitment,
 *   - category mapped from the sheet's Arabic category (+ keyword refinement),
 *   - car compatibility parsed from the name (and, for MG rows, the brand column)
 *     and resolved against the CarBrand catalog (missing models are added).
 *
 * NOTE on the brand column: for most rows it is the PART manufacturer (VALEO,
 * GSP, CTR ...). For the MG section it instead holds the CAR model
 * (MG5/MG6, ZS, RX5\HS ...) — handled specially: those become compatibility,
 * not a part-brand prefix.
 *
 * NO IMAGES (per request) → inserted as **draft** (addProduct only requires an
 * image for pending/published). SKU = XTB-<SKU-ID> (unique → idempotent).
 * part_number = supplier code. DRY_RUN=1 = read-only plan. DUMP=1 = one line/row.
 * ------------------------------------------------------------------------
 */
const path = require('path');
const fs = require('fs');
const Module = require('module');

function resolveBackendDir() {
    if (process.env.BACKEND_DIR) return path.resolve(process.env.BACKEND_DIR);
    if (fs.existsSync(path.join(__dirname, 'services', 'vendorService.js'))) return __dirname;
    return path.resolve(__dirname, '..', 'Backend');
}
const BACKEND_DIR = resolveBackendDir();
if (!fs.existsSync(path.join(BACKEND_DIR, 'services', 'vendorService.js'))) {
    console.error(`\n[FATAL] Backend not found at ${BACKEND_DIR} (set BACKEND_DIR=/app in Docker)\n`); process.exit(1);
}
process.env.NODE_PATH = [path.join(BACKEND_DIR, 'node_modules'), process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter);
Module._initPaths();
require('dotenv').config({ path: path.join(BACKEND_DIR, '.env') });

const mongoose = require('mongoose');
const XLSX = require('xlsx');
const { Seller } = require(path.join(BACKEND_DIR, 'models', 'sellers'));
const { Category } = require(path.join(BACKEND_DIR, 'models', 'categories'));
const { Product } = require(path.join(BACKEND_DIR, 'models', 'products'));
const { CarBrand } = require(path.join(BACKEND_DIR, 'models', 'car_brands'));
const { addProduct } = require(path.join(BACKEND_DIR, 'services', 'vendorService'));

const MONGO_URI = process.env.MONGO_URI;
const VENDOR_EMAIL = process.env.VENDOR_EMAIL || 'ktf22620@hotmail.com';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'rows.json');
const SKU_PREFIX = process.env.SKU_PREFIX || 'KTF';
const FALLBACK_CATEGORY = process.env.FALLBACK_CATEGORY || 'Mechanical Parts';
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : null;
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

/* ---------- Arabic normalization (unify spelling variants) ---------- */
const AN = (s) => String(s).replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[ؤ]/g, 'و').replace(/[ئ]/g, 'ي').replace(/ـ/g, '').trim();

/* ---------- dictionaries (Arabic keys written normalized) ---------- */
const BRAND_AR = { // normalized Arabic brand word -> English brand (must exist in catalog)
    'هيونداي': 'Hyundai', 'هونداي': 'Hyundai', 'كيا': 'Kia', 'تويوتا': 'Toyota', 'نيسان': 'Nissan',
    'هوندا': 'Honda', 'ميتسوبيشي': 'Mitsubishi', 'متسوبيشي': 'Mitsubishi', 'مازدا': 'Mazda',
    'شيفروليه': 'Chevrolet', 'شيفورليه': 'Chevrolet', 'شفروليه': 'Chevrolet', 'دايو': 'Daewoo',
    'فيات': 'Fiat', 'رينو': 'Renault', 'بيجو': 'Peugeot', 'سكودا': 'Skoda', 'اوبل': 'Opel',
    'فورد': 'Ford', 'مرسيدس': 'Mercedes-Benz', 'اودي': 'Audi', 'شيري': 'Chery', 'جيلي': 'Geely',
    'بروتون': 'Proton', 'سوزوكي': 'Suzuki', 'اسبرانزا': 'Speranza', 'سبرانزا': 'Speranza',
};
const MODEL_AR = { // normalized Arabic model word -> [brand, catalog-candidate, arabicLabel]
    'اكسيل': ['Hyundai', 'Excel', 'اكسيل'], 'اكسل': ['Hyundai', 'Excel', 'اكسيل'],
    'اكسنت': ['Hyundai', 'Accent', 'اكسنت'], 'اكسينت': ['Hyundai', 'Accent', 'اكسنت'], 'فيرنا': ['Hyundai', 'Verna', 'فيرنا'],
    'النترا': ['Hyundai', 'Elantra', 'النترا'], 'سوناتا': ['Hyundai', 'Sonata', 'سوناتا'],
    'توسان': ['Hyundai', 'Tucson', 'توسان'], 'كريتا': ['Hyundai', 'Creta', 'كريتا'],
    'ماتريكس': ['Hyundai', 'Matrix', 'ماتريكس'], 'افانتي': ['Hyundai', 'Avante', 'افانتي'],
    'سنتافي': ['Hyundai', 'Santa Fe', 'سنتافي'],
    'سيراتو': ['Kia', 'Cerato', 'سيراتو'], 'كارينز': ['Kia', 'Carens', 'كارينز'],
    'بيكانتو': ['Kia', 'Picanto', 'بيكانتو'], 'ريو': ['Kia', 'Rio', 'ريو'],
    'سبورتاج': ['Kia', 'Sportage', 'سبورتاج'], 'سورينتو': ['Kia', 'Sorento', 'سورينتو'],
    'سول': ['Kia', 'Soul', 'سول'], 'سيلتوس': ['Kia', 'Seltos', 'سيلتوس'], 'سيفيا': ['Kia', 'Sephia', 'سيفيا'],
    'لانوس': ['Chevrolet', 'Lanos', 'لانوس'], 'اوبترا': ['Chevrolet', 'Optra', 'اوبترا'],
    'افيو': ['Chevrolet', 'Aveo', 'افيو'], 'كروز': ['Chevrolet', 'Cruze', 'كروز'],
    'سبارك': ['Chevrolet', 'Spark', 'سبارك'], 'كابتيفا': ['Chevrolet', 'Captiva', 'كابتيفا'],
    'نوبيرا': ['Daewoo', 'Nubira', 'نوبيرا'], 'ليجانزا': ['Daewoo', 'Leganza', 'ليجانزا'],
    'اسبيرو': ['Daewoo', 'Espero', 'اسبيرو'], 'ماتيز': ['Daewoo', 'Matiz', 'ماتيز'],
    'صني': ['Nissan', 'Sunny', 'صني'], 'سنترا': ['Nissan', 'Sentra', 'سنترا'],
    'تيدا': ['Nissan', 'Tiida', 'تيدا'], 'قشقاي': ['Nissan', 'Qashqai', 'قشقاي'],
    'جوك': ['Nissan', 'Juke', 'جوك'], 'اكستريل': ['Nissan', 'X-Trail', 'اكس تريل'],
    'كورولا': ['Toyota', 'Corolla', 'كورولا'], 'كرولا': ['Toyota', 'Corolla', 'كورولا'],
    'ياريس': ['Toyota', 'Yaris', 'ياريس'], 'كامري': ['Toyota', 'Camry', 'كامري'],
    'لانسر': ['Mitsubishi', 'Lancer', 'لانسر'], 'شارك': ['Mitsubishi', 'Shark', 'شارك'],
    'باجيرو': ['Mitsubishi', 'Pajero', 'باجيرو'],
    'استرا': ['Opel', 'Astra', 'استرا'], 'كورسا': ['Opel', 'Corsa', 'كورسا'], 'فيكترا': ['Opel', 'Vectra', 'فيكترا'],
    'داستر': ['Renault', 'Duster', 'داستر'], 'لوجان': ['Renault', 'Logan', 'لوجان'],
    'سيمبول': ['Renault', 'Symbol', 'سيمبول'], 'ميجان': ['Renault', 'Megane', 'ميجان'],
    'تيجو': ['Chery', 'Tiggo', 'تيجو'],
    'النوس': ['Chevrolet', 'Lanos', 'لانوس'], 'لانوس': ['Chevrolet', 'Lanos', 'لانوس'],
    'النسر': ['Nissan', 'Sunny', 'صني'], 'برايد': ['Kia', 'Pride', 'برايد'],
    'ايمجراند': ['Geely', 'Emgrand', 'ايمجراند'], 'اوكتافيا': ['Skoda', 'Octavia', 'اوكتافيا'],
    'سوناتا': ['Hyundai', 'Sonata', 'سوناتا'],
};
const MODEL_LAT = { // uppercased Latin token -> [brand, candidate]
    'ACCENT': ['Hyundai', 'Accent'], 'VERNA': ['Hyundai', 'Verna'], 'ELANTRA': ['Hyundai', 'Elantra'],
    'TUCSON': ['Hyundai', 'Tucson'], 'I10': ['Hyundai', 'i10'], 'I20': ['Hyundai', 'i20'], 'I30': ['Hyundai', 'i30'],
    'CERATO': ['Kia', 'Cerato'], 'RIO': ['Kia', 'Rio'], 'CARENS': ['Kia', 'Carens'], 'PICANTO': ['Kia', 'Picanto'],
    'LANOS': ['Chevrolet', 'Lanos'], 'OPTRA': ['Chevrolet', 'Optra'], 'AVEO': ['Chevrolet', 'Aveo'], 'CRUZE': ['Chevrolet', 'Cruze'],
    'N16': ['Nissan', 'Sunny'], 'N17': ['Nissan', 'Sunny'], 'J10': ['Nissan', 'Qashqai'], 'C12': ['Nissan', 'Tiida'],
    'F3': ['BYD', 'F3'], 'F6': ['BYD', 'F6'], 'G3': ['BYD', 'G3'], 'L3': ['BYD', 'L3'], 'G5': ['BYD', 'G5'],
};
// Latin brand tokens (brand-only, no model) -> catalog brand.
const BRAND_LAT = { 'BYD': 'BYD', 'GEELY': 'Geely', 'CHERY': 'Chery', 'CHERRY': 'Chery', 'MG': 'MG' };
// MG car tokens (appear in the brand column or name) -> catalog MG model name.
const MG_TOKENS = { 'MG3': 'MG 3', 'MG5': 'MG 5', 'MG6': 'MG 6', 'MG7': 'MG 7', 'ZS': 'ZS', 'HS': 'HS', 'RX5': 'RX5' };
const ENSURE_MODELS = { 'Hyundai': ['Excel'], 'Kia': ['Sephia', 'Pride'] }; // guarantee these exist

// Part-type resolver (normalized Arabic patterns) — specific first.
const PART_KW = [
    [/طقم\s*دبرياج/, { en: 'Clutch Kit', ar: 'طقم دبرياج' }],
    [/اسطوانه\s*دبرياج/, { en: 'Clutch Cylinder', ar: 'اسطوانة دبرياج' }],
    [/بليه\s*دبرياج/, { en: 'Clutch Release Bearing', ar: 'بلية دبرياج' }],
    [/دبرياج/, { en: 'Clutch', ar: 'دبرياج' }],
    [/تيل|قبقاب/, { en: 'Brake Pads', ar: 'تيل فرامل' }],
    [/هوب|قرص\s*فرامل/, { en: 'Brake Disc', ar: 'قرص فرامل' }],
    [/فرامل/, { en: 'Brake Part', ar: 'قطعة فرامل' }],
    [/مساعد/, { en: 'Shock Absorber', ar: 'مساعد' }],
    [/بيض\s*مقص|مقص/, { en: 'Control Arm', ar: 'مقص' }],
    [/باره/, { en: 'Suspension Link', ar: 'بارة إكصال' }],
    [/كوبلن/, { en: 'CV Joint', ar: 'كوبلن' }],
    [/قربه|قرب/, { en: 'CV Joint Boot', ar: 'جلدة عكس' }],
    [/جلبه|جلب/, { en: 'Bushing', ar: 'جلبة' }],
    [/قاعده|قواعد/, { en: 'Mount', ar: 'قاعدة' }],
    [/صره/, { en: 'Wheel Hub', ar: 'صرة عجل' }],
    [/وش\s*فانوس/, { en: 'Headlight Cover', ar: 'وش فانوس' }],
    [/فانوس|فوانيس/, { en: 'Headlight', ar: 'فانوس' }],
    [/كبوت/, { en: 'Hood', ar: 'كبوت' }],
    [/رفرف/, { en: 'Fender', ar: 'رفرف' }],
    [/شبكه|صدر\s*امامي|اكصدام|صدام/, { en: 'Bumper/Grille', ar: 'صدر أمامي' }],
    [/مروحه/, { en: 'Cooling Fan', ar: 'مروحة تبريد' }],
    [/طقم\s*بستم|بستم/, { en: 'Piston Kit', ar: 'طقم بستم' }],
    [/طقم\s*صباب|صباب/, { en: 'Valve Set', ar: 'طقم صباب' }],
    [/ديسك/, { en: 'Clutch Disc', ar: 'ديسك دبرياج' }],
    [/حامل\s*موتور/, { en: 'Engine Mount', ar: 'حامل موتور' }],
    [/ساعه\s*حراره/, { en: 'Temperature Sensor', ar: 'ساعة حرارة' }],
    [/سلك\s*بوجيه|كابالت\s*بوجيه/, { en: 'Spark Plug Wires', ar: 'سلك بوجيه' }],
    [/ترس\s*مارش/, { en: 'Starter Gear', ar: 'ترس مارش' }],
    [/اويل\s*سيل/, { en: 'Oil Seal', ar: 'أويل سيل' }],
    [/فلتر\s*هواء/, { en: 'Air Filter', ar: 'فلتر هواء' }],
    [/فلتر\s*زيت/, { en: 'Oil Filter', ar: 'فلتر زيت' }],
    [/فلتر\s*(بنزين|وقود|سولار)/, { en: 'Fuel Filter', ar: 'فلتر بنزين' }],
    [/فلتر\s*(مكيف|تكييف|تكيف|مقصور)/, { en: 'Cabin Filter', ar: 'فلتر مكيف' }],
    [/فلتر/, { en: 'Filter', ar: 'فلتر' }],
    [/كاتينه/, { en: 'Timing Chain', ar: 'كاتينة' }],
    [/سير/, { en: 'Drive Belt', ar: 'سير' }],
    [/بوجيه|بوجيهات|شمعات/, { en: 'Spark Plug', ar: 'بوجيه' }],
    [/كوعه/, { en: 'Coolant Hose', ar: 'كوعة مياه' }],
    [/ثرموستات/, { en: 'Thermostat', ar: 'ثرموستات' }],
    [/ردياتير|رادياتير/, { en: 'Radiator', ar: 'رادياتير' }],
    [/خرطوم/, { en: 'Hose', ar: 'خرطوم' }],
    [/طلمبه\s*مياه|طرمبه\s*مياه/, { en: 'Water Pump', ar: 'طلمبة مياه' }],
    [/طلمبه\s*(بنزين|وقود)/, { en: 'Fuel Pump', ar: 'طلمبة بنزين' }],
    [/طلمبه|طرمبه/, { en: 'Pump', ar: 'طلمبة' }],
    [/جوان/, { en: 'Gasket', ar: 'جوان' }],
    [/بومه|بكره/, { en: 'Idler/Tensioner Pulley', ar: 'بكرة سير' }],
    [/بوبينه/, { en: 'Ignition Coil', ar: 'بوبينة' }],
    [/حساس/, { en: 'Sensor', ar: 'حساس' }],
    [/شداد/, { en: 'Tensioner', ar: 'شداد' }],
    [/كرنك/, { en: 'Crankshaft Part', ar: 'قطعة كرنك' }],
    [/زيت/, { en: 'Oil', ar: 'زيت' }],
    [/بليه|بلي/, { en: 'Bearing', ar: 'بلية' }],
    [/كاوتش\s*ميزان/, { en: 'Steering Rack Boot', ar: 'كاوتش ميزان' }],
    [/مصفحه/, { en: 'Skid Plate', ar: 'مصفحة' }],
];
const CAT_MAP = { // sheet Arabic category -> catalog category (English name)
    'عفشه': 'Suspension and Steering System', 'دوره تبريد': 'Cooling System Components',
    'فلاتر': 'Filters', 'نظام الفرامل': 'Brakes', 'موتور و بنزين': 'Engine',
    'سيور': 'Timing Belts/Chains', 'زيوت': 'Oils', 'بوجيهات': 'Spark Plugs',
    'دبرياج': 'Clutches', 'بلي': 'Wheel Hub', 'مباين': 'Main Engine Components',
    'طلمبات': 'Water Pump', 'منظفات': 'Car Care', 'قرب': 'Suspension and Steering System',
    'كهرباء': 'Electrical & Lighting',
};
const CAT_KW = [ // normalized keyword -> catalog category (for 'MG' + ambiguous refinement)
    [/تيل|قبقاب|فرامل/, 'Brakes'], [/فلتر\s*هواء/, 'Air filter'], [/فلتر\s*زيت/, 'Oil filter'],
    [/فلتر\s*(مكيف|تكييف|تكيف|مقصور)/, 'Cabin filter'], [/فلتر/, 'Filters'],
    [/مساعد|مقص|باره|جلبه|جلب|قاعده|قواعد|عفشه|شداد|كاوتش\s*ميزان|مصفحه|صره|كوبلن|قربه/, 'Suspension and Steering System'],
    [/دبرياج/, 'Clutches'], [/بوجيه|شمعات/, 'Spark Plugs'], [/سير|سيور|كاتينه|بومه|بكره/, 'Timing Belts/Chains'],
    [/كوعه|خرطوم|ثرموستات|ردياتير|رادياتير|تبريد|مياه/, 'Cooling System Components'],
    [/طلمبه\s*مياه/, 'Water Pump'], [/جوان/, 'Gaskets'],
    [/بوبينه|حساس|دينامو|مارش|كهرب|ساعه\s*حراره|سلك\s*بوجيه/, 'Electrical & Lighting'],
    [/فانوس|فوانيس/, 'Outdoor lighting'],
    [/كبوت/, 'Hood'], [/رفرف|شبكه|صدر\s*امامي|اكصدام|صدام|كسر/, 'Exterior Car Body Parts'],
    [/مروحه|رادياتير|ردياتير/, 'Cooling System Components'],
    [/بستم|صباب|كرنك|طقم\s*جوان|وش\s*سلندر/, 'Main Engine Components'],
    [/ديسك|دبرياج/, 'Clutches'], [/صره/, 'Wheel Hub'],
];

/* ---------- helpers ---------- */
function partType(nName) { for (const [re, v] of PART_KW) if (re.test(nName)) return v; return null; }
function normLat(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function resolveModel(brandObj, candidate) {
    const c = candidate.toLowerCase();
    let m = brandObj.models.find(x => x.name.toLowerCase() === c);
    if (m) return m;
    m = brandObj.models.find(x => x.name.toLowerCase().split(/[^a-z0-9]+/i).includes(c));
    if (m) return m;
    return brandObj.models.find(x => normLat(x.name) === normLat(candidate)) || null;
}
function parseYears(name) {
    const ys = new Set(); let m;
    let re = /\b(19[89]\d|20[0-3]\d)\s*[-/]\s*(19[89]\d|20[0-3]\d)\b/g;
    while ((m = re.exec(name))) { let a = +m[1], b = +m[2]; if (a > b)[a, b] = [b, a]; for (let y = a; y <= b && y - a < 40; y++) ys.add(y); }
    re = /\(([^)]*)\)/g; let pm;
    while ((pm = re.exec(name))) {
        const nums = (pm[1].match(/\b\d{2}\b/g) || []).map(n => +n >= 80 ? 1900 + +n : 2000 + +n);
        if (nums.length >= 2) { const a = Math.min(...nums), b = Math.max(...nums); for (let y = a; y <= b && y - a < 40; y++) ys.add(y); }
        else if (nums.length === 1) ys.add(nums[0]);
    }
    re = /\b(19[89]\d|20[0-3]\d)\b/g;
    while ((m = re.exec(name))) ys.add(+m[1]);
    return [...ys].sort((a, b) => a - b);
}
function mgFrom(str) { // extract catalog MG model names from a string (brand col or name)
    const found = new Set();
    const up = String(str).toUpperCase();
    for (const [tok, model] of Object.entries(MG_TOKENS)) {
        const re = new RegExp('(^|[^A-Z0-9])' + tok + '([^A-Z0-9]|$)');
        if (re.test(up)) found.add(model);
    }
    return [...found];
}
// car references from the name -> [{brand, model|null}]
function parseCars(name) {
    const nN = AN(name), up = name.toUpperCase(), refs = [];
    for (const key of Object.keys(MODEL_AR)) if (nN.includes(key)) { const [b, mdl] = MODEL_AR[key]; refs.push({ brand: b, model: mdl }); }
    for (const [lat, pair] of Object.entries(MODEL_LAT)) { const re = new RegExp('(^|[^A-Z0-9])' + lat + '([^A-Z0-9]|$)'); if (re.test(up)) refs.push({ brand: pair[0], model: pair[1] }); }
    for (const mdl of mgFrom(name)) refs.push({ brand: 'MG', model: mdl });
    const brandsFound = new Set();
    for (const key of Object.keys(BRAND_AR)) if (nN.includes(key)) brandsFound.add(BRAND_AR[key]);
    for (const [lat, en] of Object.entries(BRAND_LAT)) { const re = new RegExp('(^|[^A-Z0-9])' + lat + '([^A-Z0-9]|$)'); if (re.test(up)) brandsFound.add(en); }
    for (const b of brandsFound) if (!refs.some(r => r.brand === b)) refs.push({ brand: b, model: null });
    const seen = new Set(), out = [];
    for (const r of refs) { const k = r.brand + '|' + (r.model || '*'); if (!seen.has(k)) { seen.add(k); out.push(r); } }
    return out;
}
const BRAND_EN2AR = {}; for (const [ar, en] of Object.entries(BRAND_AR)) if (!BRAND_EN2AR[en]) BRAND_EN2AR[en] = ar;
const MODEL_EN2AR = {}; for (const v of Object.values(MODEL_AR)) MODEL_EN2AR[v[0] + '|' + v[1]] = v[2];
function carLabelEn(brand, modelName) { return modelName.toLowerCase().startsWith(brand.toLowerCase()) ? modelName : `${brand} ${modelName}`; }
function carLabelAr(brand, modelName, candidate) { const b = BRAND_EN2AR[brand] || brand; const m = MODEL_EN2AR[brand + '|' + candidate] || modelName; return m.toLowerCase && m.toLowerCase().startsWith(brand.toLowerCase()) ? m : `${b} ${m}`; }

/* ---------- content ---------- */
function stripBrandDup(name, brand) { return name.replace(new RegExp('\\s*[-–]?\\s*' + brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i'), '').trim(); }
function genContent(row, cat, carsEn, carsAr, partBrand) {
    const pt = partType(AN(row.name)) || { en: cat.name, ar: cat.name_ar };
    const forEn = carsEn.length ? ` for ${carsEn.join(' / ')}` : '';
    const forAr = carsAr.length ? ` لسيارات ${carsAr.join(' / ')}` : '';
    if (partBrand) {
        const cleanName = stripBrandDup(row.name, partBrand);
        return {
            title_ar: `${cleanName} - ${partBrand}`,
            title_en: `${partBrand} ${pt.en}${forEn}`,
            subtitle_ar: `${pt.ar} ${partBrand} — أداء موثوق وتركيب مطابق للمواصفات`,
            subtitle_en: `Reliable ${pt.en} by ${partBrand} — precise fit and long service life`,
            description_ar: `${cleanName} من ماركة ${partBrand}. قطعة غيار عالية الجودة${forAr} مصمّمة لتوفير أداء ثابت وموثوق وعمر تشغيلي أطول مع تركيب مطابق للمواصفات الأصلية. يوصى بالتركيب لدى فني متخصص لضمان أفضل أداء. كود القطعة: ${row.code}.`,
            description_en: `${partBrand} ${pt.en.toLowerCase()}${forEn}. A high-quality replacement part engineered for consistent, dependable performance, a direct OE-style fit and longer service life. Professional installation is recommended for best results. Part code: ${row.code}.`,
        };
    }
    // no part brand (e.g. MG rows where the brand column is the car)
    return {
        title_ar: `${row.name}${carsAr.length ? ' - ' + carsAr.join(' / ') : ''}`,
        title_en: `${pt.en}${forEn}`,
        subtitle_ar: `${pt.ar} — أداء موثوق وتركيب مطابق للمواصفات`,
        subtitle_en: `Reliable ${pt.en}${forEn} — precise fit and long service life`,
        description_ar: `${row.name}. قطعة غيار عالية الجودة${forAr} مصمّمة لأداء ثابت وموثوق وتركيب مطابق للمواصفات الأصلية وعمر تشغيلي أطول. يوصى بالتركيب لدى فني متخصص لضمان أفضل أداء.`,
        description_en: `High-quality ${pt.en.toLowerCase()}${forEn}. Engineered for consistent, dependable performance, a direct OE-style fit and longer service life. Professional installation is recommended for best results.`,
    };
}

/* ---------- main ---------- */
// Rows come from the PDF extraction: {part, car, price, qty, notes, file, cathint}.
// Build a unified product row: name = part (+ car when not already in part).
function loadRows() {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return data.map((r, i) => {
        const part = (r.part || '').trim();
        const car = (r.car || '').trim();
        const name = car && !part.includes(car) ? `${part} ${car}` : (part || car);
        return { id: i + 1, name, part, car, price: r.price, cathint: (r.cathint || '').trim(), file: r.file };
    });
}
async function main() {
    if (!MONGO_URI) { console.error('[FATAL] MONGO_URI not set'); process.exit(1); }
    let rows = loadRows(); if (LIMIT) rows = rows.slice(0, LIMIT);
    console.log('─'.repeat(70));
    console.log(`Rows: ${rows.length}   Vendor: ${VENDOR_EMAIL}   Mode: ${DRY_RUN ? 'DRY RUN (read-only)' : 'LIVE'}   Status: draft (no images)`);
    console.log('─'.repeat(70));
    await mongoose.connect(MONGO_URI);
    const vendor = await Seller.findOne({ email: new RegExp('^' + VENDOR_EMAIL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') });
    if (!vendor) { console.error(`[FATAL] vendor ${VENDOR_EMAIL} not found`); await mongoose.disconnect(); process.exit(1); }
    console.log(`Vendor: ${vendor.store_name} (${vendor._id})  sub=${vendor.subscription_status}`);

    const cats = await Category.find({ is_active: true }).lean();
    const catByEn = new Map(), catByAr = new Map();
    for (const c of cats) { if (c.name && !catByEn.has(c.name.toLowerCase())) catByEn.set(c.name.toLowerCase(), c); if (c.name_ar && !catByAr.has(c.name_ar)) catByAr.set(c.name_ar, c); }
    const catByName = (n) => catByEn.get(String(n).toLowerCase()) || catByAr.get(String(n)) || null;
    const fallbackCat = catByName(FALLBACK_CATEGORY);
    function resolveCategory(row) {
        // Category comes from part-type keywords in the item name + any category hint.
        let target = null;
        const hay = AN(row.name + ' ' + (row.cathint || ''));
        for (const [re, cn] of CAT_KW) if (re.test(hay)) { target = cn; break; }
        return { cat: catByName(target) || fallbackCat, viaFallback: !catByName(target) };
    }

    const brandCache = new Map();
    async function getBrand(name) { if (!brandCache.has(name)) brandCache.set(name, await CarBrand.findOne({ name: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') })); return brandCache.get(name); }

    // Phase A: find + add missing catalog models
    const missing = new Map();
    const note = (b, c) => { if (!missing.has(b)) missing.set(b, new Set()); missing.get(b).add(c); };
    for (const [b, list] of Object.entries(ENSURE_MODELS)) { const bo = await getBrand(b); if (bo) for (const c of list) if (!resolveModel(bo, c)) note(b, c); }
    for (const row of rows) {
        const refs = parseCars(`${row.part} ${row.car}`);
        for (const ref of refs) { if (!ref.model) continue; const bo = await getBrand(ref.brand); if (!bo) { note('(MISSING BRAND) ' + ref.brand, ref.model); continue; } if (!resolveModel(bo, ref.model)) note(ref.brand, ref.model); }
    }
    console.log('\n── catalog model additions needed ──');
    if (!missing.size) console.log('  (none)');
    for (const [b, s] of missing) console.log('  ' + b + ' : ' + [...s].join(', '));
    if (!DRY_RUN) for (const [b, s] of missing) {
        if (b.startsWith('(MISSING BRAND)')) continue;
        const bo = await getBrand(b); for (const c of s) if (!resolveModel(bo, c)) bo.models.push({ name: c, years: [] });
        await bo.save(); brandCache.delete(b); await getBrand(b);
    }

    // Phase B: build + insert
    const stats = { universal: 0, compat: 0, created: 0, skipped: 0, failed: 0, fallbackCat: 0, zeroPrice: 0 };
    const catCount = {}, samples = [];
    for (const row of rows) {
        // Missing/zero price → still insert as draft with price 0 (a placeholder the
        // vendor replaces before publishing; the publish gate enforces price > 0).
        const price = Number(row.price) > 0 ? Number(row.price) : 0;
        if (price === 0) stats.zeroPrice++;
        const sku = `${SKU_PREFIX}-${row.id}`;
        const { cat, viaFallback } = resolveCategory(row);
        if (viaFallback) stats.fallbackCat++;
        catCount[cat.name] = (catCount[cat.name] || 0) + 1;

        const partBrand = null; // no reliable part-manufacturer column in this source
        const refs = parseCars(`${row.part} ${row.car}`);
        const years = parseYears(row.name);

        const byBrand = new Map(), carsEn = [], carsAr = [];
        for (const ref of refs) {
            const bo = await getBrand(ref.brand); if (!bo) continue;
            let e = byBrand.get(bo.name);
            if (!e) { e = { brand_id: bo._id, brand_name: bo.name, all_models: false, models: [] }; byBrand.set(bo.name, e); }
            if (!ref.model) { e.all_models = true; e.models = []; carsEn.push(bo.name); carsAr.push(BRAND_EN2AR[bo.name] || bo.name); continue; }
            if (e.all_models) continue;
            let m = resolveModel(bo, ref.model);
            if (DRY_RUN && !m) m = { _id: new mongoose.Types.ObjectId(), name: ref.model };
            if (!m) continue;
            e.models.push({ model_id: m._id, model_name: m.name, years: years.slice(), all_years: years.length === 0 });
            carsEn.push(carLabelEn(bo.name, m.name));
            carsAr.push(carLabelAr(bo.name, m.name, ref.model));
        }
        const compatible_cars = [...byBrand.values()];
        const isUniversal = compatible_cars.length === 0;
        isUniversal ? stats.universal++ : stats.compat++;

        const content = genContent(row, cat, [...new Set(carsEn)], [...new Set(carsAr)], partBrand);
        const payload = {
            ...content, sku, price,
            category_id: cat._id, is_universal: isUniversal, compatible_cars: isUniversal ? [] : compatible_cars,
            stock_status: 'instock', stock_management: false, images: [], status: 'draft',
        };
        if (samples.length < 8) samples.push({ cat, payload, carsEn: [...new Set(carsEn)] });
        if (process.env.DUMP) console.log(`${cat.name} | ${payload.title_en} | uni=${payload.is_universal} | ${row.name}`);

        if (DRY_RUN) { stats.created++; continue; }
        const exists = await Product.findOne({ vendor_id: vendor._id, sku }).select('_id').lean();
        if (exists) { stats.skipped++; continue; }
        try { await addProduct(vendor._id, payload); stats.created++; }
        catch (err) { stats.failed++; console.error(`FAIL ${sku} — ${err.code ? '[' + err.code + '] ' : ''}${err.message}`); if (err.code === 'NO_SUBSCRIPTION') break; }
    }

    console.log('\n── category distribution (resolved) ──');
    Object.entries(catCount).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + String(v).padStart(4) + '  ' + k));
    console.log('\n── sample products ──');
    for (const s of samples) {
        console.log('\n  ' + s.payload.sku + '  cat=' + s.cat.name + '  universal=' + s.payload.is_universal + (s.carsEn.length ? '  cars=[' + s.carsEn.join(', ') + ']' : ''));
        console.log('   AR: ' + s.payload.title_ar);
        console.log('   EN: ' + s.payload.title_en);
        console.log('   subAR: ' + s.payload.subtitle_ar);
        console.log('   descEN: ' + s.payload.description_en);
    }
    console.log('\n' + '─'.repeat(70));
    console.log(`universal=${stats.universal}  car-specific=${stats.compat}  fallbackCat=${stats.fallbackCat}  price0-placeholder=${stats.zeroPrice}`);
    console.log(`created=${stats.created}  skipped(already exist)=${stats.skipped}  failed=${stats.failed}` + (DRY_RUN ? '  (DRY RUN — no writes)' : ''));
    console.log('─'.repeat(70));
    await mongoose.disconnect();
}
main().catch(async (e) => { console.error('[FATAL]', e); try { await mongoose.disconnect(); } catch (_) { } process.exit(1); });
