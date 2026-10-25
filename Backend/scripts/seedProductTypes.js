/**
 * Create the shop's product types and put the categories under them.
 *
 *   node scripts/seedProductTypes.js           # dry run: says what it would do
 *   node scripts/seedProductTypes.js --apply   # writes
 *
 * Safe to run again: a type is matched by its English name and created only if missing, and a
 * category only ever gains a type (never loses one), so assignments made later in the admin
 * are kept. A category named here that does not exist is reported and skipped.
 *
 * The grouping, agreed with the owner on 2026-10-11: broad, shopper-facing types for people
 * who know what they want but not which part of the car it belongs to. A category may sit
 * under more than one type ("Brakes" is a spare part and routine maintenance).
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { Category } = require('../models/categories');
const { ProductType } = require('../models/productTypes');

// [path from the root, as category English names]
const TYPES = [
    {
        name: 'Spare Parts', name_ar: 'قطع غيار', sort_order: 1,
        categories: [['Engine'], ['Mechanical Parts'], ['Brakes'], ['Electrical & Lighting'], ['Car Body and Glass'],
            ['Wiper and Washer System'], ['Motorcycle Parts'], ['Electric Vehicle EV Parts']],
    },
    {
        name: 'Routine Maintenance', name_ar: 'صيانة دورية', sort_order: 2,
        categories: [['Filters'], ['Engine Oil'], ['Brakes'], ['Wiper and Washer System', 'Wiper blades'], ['Electrical & Lighting', 'Battery']],
    },
    { name: 'Accessories', name_ar: 'إكسسوارات', sort_order: 3, categories: [['Car Accessories']] },
    { name: 'Car Care', name_ar: 'عناية وتنظيف', sort_order: 4, categories: [['Car Care']] },
    { name: 'Tools', name_ar: 'عِدد وأدوات', sort_order: 5, categories: [['Tools']] },
    { name: 'Tyres & Wheels', name_ar: 'كاوتش وجنوط', sort_order: 6, categories: [['Tyres'], ['Wheels & Rims']] },
];

const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

const findByPath = (categories, path) => {
    let parent = null;
    let found = null;
    for (const name of path) {
        found = categories.find((c) => String(c.parent_id || null) === String(parent) && sameName(c.name, name));
        if (!found) return null;
        parent = found._id;
    }
    return found;
};

(async () => {
    const apply = process.argv.includes('--apply');
    await mongoose.connect(process.env.MONGO_URI);
    const categories = await Category.find().select('_id name parent_id type_ids').lean();

    for (const spec of TYPES) {
        let type = (await ProductType.find().lean()).find((t) => sameName(t.name, spec.name));
        if (!type) {
            console.log(`${apply ? 'create' : 'would create'} type "${spec.name}" / ${spec.name_ar}`);
            if (apply) type = (await ProductType.create({ name: spec.name, name_ar: spec.name_ar, sort_order: spec.sort_order })).toObject();
        } else {
            console.log(`type "${spec.name}" exists`);
        }

        for (const path of spec.categories) {
            const category = findByPath(categories, path);
            if (!category) { console.log(`   ! category not found: ${path.join(' > ')}`); continue; }
            const has = type && (category.type_ids || []).some((id) => String(id) === String(type._id));
            if (has) { console.log(`   = ${path.join(' > ')}`); continue; }
            console.log(`   ${apply ? '+' : 'would add'} ${path.join(' > ')}`);
            if (apply) await Category.updateOne({ _id: category._id }, { $addToSet: { type_ids: type._id } });
        }
    }

    if (!apply) console.log('\nDry run. Run with --apply to write.');
    await mongoose.disconnect();
})().catch((err) => { console.error(err); process.exit(1); });
