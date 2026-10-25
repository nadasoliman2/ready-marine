const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { fold } = require('../services/matching/text');
const { createVehicleReader } = require('../services/matching/vehicleMentions');
const { checkFitment, applyFitmentFix } = require('../services/matching/fitmentCheck');
const { buildCatalogMatcher } = require('../services/matching/catalogMatcher');

/* A small car list in the shape of `carbrands`. */
const id = () => new mongoose.Types.ObjectId();
const years = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ({ year: from + i }));
const make = (name, models) => ({ _id: id(), name, models: models.map(([m, a, b]) => ({ _id: id(), name: m, years: years(a, b) })) });
const CARS = [
    make('Mitsubishi', [['Lancer', 1973, 2024], ['Pajero', 1982, 2027]]),
    make('Hyundai', [['Verna', 1994, 2027], ['Accent', 1994, 2027], ['Elantra', 1990, 2027], ['Tucson', 2004, 2027], ['Matrix', 2000, 2024]]),
    make('Kia', [['Cerato', 2004, 2025], ['Sportage', 1993, 2027], ['Rio', 2000, 2023]]),
    make('Nissan', [['Sunny', 1966, 2027], ['Tiida', 2004, 2024]]),
    make('Chevrolet', [['Lanos', 1997, 2021], ['Optra', 1997, 2027]]),
    make('Daewoo', [['Lanos', 1997, 2009], ['Nubira', 1997, 2024]]),
    make('Toyota', [['Corolla', 1966, 2027], ['Yaris', 1999, 2027]]),
    make('BYD', [['F3', 2005, 2021]]),
];
const reader = createVehicleReader(CARS);
const read = (text) => reader.read([{ field: 'title_ar', text }]).mentions
    .map((m) => [m.make, m.model, m.years.map((y) => `${y.from}-${y.to ?? '…'}`).join(',')].filter(Boolean).join(' '));

test('text folds Arabic variants and pulls glued words apart', () => {
    assert.equal(fold('سبورتاج2021'), 'سبورتاج 2021');
    assert.equal(fold('ix35شمال'), 'ix35 شمال');
    assert.equal(fold('أوبترا ٢٠٠٨'), 'اوبترا 2008');
});

test('Egyptian names for the Lancer are all the Lancer', () => {
    assert.deepEqual(read('جوان غطاء تاكيهات بومه - LUXSY'), ['Mitsubishi Lancer']);
    assert.deepEqual(read('مشترك مياه ردياتير فبر شارك 2008-2015 - GSP'), ['Mitsubishi Lancer 2008-2015']);
    assert.deepEqual(read('كوعة علوي شارك 97 - AGO'), ['Mitsubishi Lancer 1997-1997']);
    // "النسر" is a misspelt "لانسر" next to a Lancer generation, and nothing on its own.
    assert.deepEqual(read('النسر كرستالة 107'), ['Mitsubishi Lancer', 'Mitsubishi Lancer']);
    assert.deepEqual(read('كريستال واكس (250 مل) من DTR'), []);
});

test('market names and chassis codes resolve to the model in the car list', () => {
    assert.deepEqual(read('طلمبة بنزين كاملة كيا سبورتاج 2009-... / هيونداي ix35 (2009-...)'), ['Kia Sportage 2009-…', 'Hyundai Tucson 2009-…']);
    assert.deepEqual(read('كوعة علوي سيراتو - HD - AGO'), ['Kia Cerato', 'Hyundai Elantra']);
    assert.deepEqual(read('تيل خلفى قبقاب N16 - HI Q'), ['Nissan Sunny']);
});

test('codes that are also ordinary words need their make', () => {
    assert.deepEqual(read('ليد H1 لمبة امامية'), []);
    assert.deepEqual(read('كاميرا HD خلفية'), []);
    assert.deepEqual(read('مقص عجل امامي RB 2012 شمال - GSP'), ['Hyundai Accent 2012-2012']);
});

test('years go to the car named before them, never across another car', () => {
    assert.deepEqual(read('تيل خلفى قبقاب كورولا 2001 - ياريس 2006 - HI Q'), ['Toyota Corolla 2001-2001', 'Toyota Yaris 2006-2006']);
    assert.deepEqual(read('اسطوانة دبرياج اكسيل + لانسر (94 / 99)'), ['Hyundai Excel', 'Mitsubishi Lancer 1994-1999']);
});

const fitmentOf = (...pairs) => pairs.map(([mk, md]) => {
    const brand = CARS.find((c) => c.name === mk);
    const model = brand.models.find((m) => m.name === md);
    return { brand_id: brand._id, brand_name: brand.name, all_models: false, models: [{ model_id: model._id, model_name: model.name, years: [], all_years: true }] };
});

test('a car the title names and the fitment lacks is found, with its years', () => {
    const product = { title_ar: 'طقم دبرياج بدون بلية تويوتا كورولا 2001 \\ يارس 2006 - VALEO', is_universal: false, compatible_cars: fitmentOf(['Toyota', 'Corolla']) };
    const { findings } = checkFitment(product, reader);
    const missing = findings.filter((f) => f.type === 'missing_car');
    assert.equal(missing.length, 1);
    assert.equal(missing[0].car.model, 'Yaris');
    assert.deepEqual(missing[0].car.years, [2006]);
    assert.equal(missing[0].severity, 'high');
});

test('a part marked for every car while its title names one is found', () => {
    const { findings } = checkFitment({ title_ar: 'تيل الفرامل االمامى ماتركس', is_universal: true, compatible_cars: [] }, reader);
    assert.equal(findings[0].type, 'universal_but_named');
    assert.equal(findings[0].cars[0].model, 'Matrix');
});

test('the same car under another badge is not missing', () => {
    const product = { title_ar: 'كوبلن داخلي دايو لانوس', is_universal: false, compatible_cars: fitmentOf(['Chevrolet', 'Lanos']) };
    assert.equal(checkFitment(product, reader).findings.filter((f) => f.type === 'missing_car').length, 0);
});

test('a toy model of a car is not a part for it', () => {
    const { findings } = checkFitment({ title_en: '1:32 Scale Toyota Corolla Diecast Model', is_universal: true, compatible_cars: [] }, reader);
    assert.equal(findings.length, 0);
});

test('applying a fix adds the car and keeps what was there', () => {
    const product = { is_universal: false, compatible_cars: fitmentOf(['Toyota', 'Corolla']) };
    const yaris = CARS.find((c) => c.name === 'Toyota').models.find((m) => m.name === 'Yaris');
    const out = applyFitmentFix(product, [{ make_id: CARS.find((c) => c.name === 'Toyota')._id, model_id: yaris._id, years: [2006], all_years: false }], reader.cars);
    assert.deepEqual(out.compatible_cars[0].models.map((m) => [m.model_name, m.all_years, m.years]), [['Corolla', true, []], ['Yaris', false, [2006]]]);
});

/* The matcher, over a handful of entries. */
const BRANDS = [{ _id: id(), name: 'bosch' }, { _id: id(), name: 'ago parts pro' }, { _id: id(), name: 'dtr' }];
const [BOSCH, AGO, DTR] = BRANDS.map((b) => b._id);
const entry = (fields) => ({ _id: id(), status: 'approved', is_universal: true, compatible_cars: [], ...fields });
const ENTRIES = [
    entry({ title_ar: 'فلتر بنزين بوش F 5969', part_number: 'F 5969', product_brand_id: BOSCH }),
    entry({ title_ar: 'طرمبة بنزين بوش 0580454140', part_number: '0580454140', product_brand_id: BOSCH }),
    entry({ title_ar: 'كوعة هيونداى فرنا علوى', part_number: '147', product_brand_id: AGO }),
    entry({ title_ar: 'كوعة هيونداى فرنا سفلى', part_number: '148', product_brand_id: AGO }),
    entry({ title_ar: 'DTR Spray Wax 500ml D256', part_number: 'ZFB2DEA37A06D63C0AEAEZ', product_brand_id: DTR }),
    entry({ title_ar: 'DTR Glass Cleaner 500ml D207', part_number: 'Z5E50310D7B6276C74009Z', product_brand_id: DTR }),
];
const matcher = buildCatalogMatcher({ entries: ENTRIES, brands: BRANDS, categories: [], carBrands: CARS });
const top = (doc) => matcher.match(doc, { limit: 1 })[0]?.entry.title_ar || null;

test('a part number matches across spacing and a dropped leading zero', () => {
    assert.equal(top({ title_ar: 'فلتر بنزين لانوس - BOSCH', part_number: 'F5969' }), 'فلتر بنزين بوش F 5969');
    assert.equal(top({ title_ar: 'قلب طلمبة بنزين - BOSCH', part_number: '580454140' }), 'طرمبة بنزين بوش 0580454140');
});

test('upper and lower are two parts, however alike the rest reads', () => {
    assert.equal(top({ title_ar: 'كوعة علوي فيرنا - AGO', part_number: '147' }), 'كوعة هيونداى فرنا علوى');
    const lower = matcher.match({ title_ar: 'كوعة سفلي فيرنا - AGO', part_number: '147' }, { limit: 3, min: 0, withConflicts: true })
        .find((r) => r.entry.part_number === '147');
    assert.ok(lower.conflicts.includes('axis:vertical'));
});

test('the same maker with another code is another product; a size is not a code', () => {
    assert.equal(top({ title_ar: 'سبراي واكس (500 مل) من DTR', part_number: 'D256' }), 'DTR Spray Wax 500ml D256');
    // Both are DTR and 500 ml; only the code tells them apart.
    const r = matcher.match({ title_ar: 'شامبو غسيل السيارة (500 مل) من DTR', part_number: 'D204' }, { limit: 3 });
    assert.equal(r.length, 0);
});

test('another brand is another product', () => {
    const r = matcher.match({ title_ar: 'فلتر بنزين لانوس - GSP', part_number: 'F5969' }, { limit: 3 });
    assert.equal(r.length, 0);
});
