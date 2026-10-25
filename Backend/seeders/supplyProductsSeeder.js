/**
 * The packaging and label catalogue, from the supplier's price list.
 *
 *   node Backend/seeders/supplyProductsSeeder.js            # show what would change
 *   node Backend/seeders/supplyProductsSeeder.js --apply    # write it
 *
 * PRICES ARE PER PACK. The list is written that way — "فلير صغير: 3.5 جنيه / 10 قطع" is
 * 3.5 for the ten — so `price` is what one pack costs and `pack_size` is what is inside it.
 *
 * Re-running is safe and CONSERVATIVE: items are matched by name and only created if
 * missing. An existing item is never re-priced, because the admin is meant to own prices
 * from the dashboard and a seeder that reset them would undo their work on every deploy.
 * Pass --reprice to deliberately push the list prices back over what is stored.
 *
 * The poly-mailer sizes line up with Bosta's own shipping brackets (see
 * services/bostaTariff.js): a parcel packed in the medium mailer is what Bosta prices as
 * "Normal", the large one is "Large", and the white bag is "White Bag". That is why the
 * dimensions are worth showing the vendor — the bag they pick decides what the shipping costs.
 */

require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const { SupplyProduct } = require('../models/supplyProducts');

// Dry run unless told otherwise. `seed({ apply: true })` is the programmatic equivalent of
// the `--apply` flag, which is how the first-boot check writes the catalogue.
const APPLY_FROM_ARGV = process.argv.includes('--apply');
const REPRICE_FROM_ARGV = process.argv.includes('--reprice');
let APPLY = APPLY_FROM_ARGV;
let REPRICE = REPRICE_FROM_ARGV;

const CATALOGUE = [
    /* ---- Poly mailers — sold in packs of 10 ---- */
    { name: 'Small poly mailer',  name_ar: 'فلير صغير',   category: 'poly_mailer', dimensions: '20 × 30 cm',  price: 3.5, pack_size: 10, sort_order: 10 },
    { name: 'Medium poly mailer', name_ar: 'فلير متوسط',  category: 'poly_mailer', dimensions: '35 × 40 cm',  price: 4.5, pack_size: 10, sort_order: 11 },
    { name: 'Large poly mailer',  name_ar: 'فلير كبير',   category: 'poly_mailer', dimensions: '45 × 50 cm',  price: 6.7, pack_size: 10, sort_order: 12 },
    { name: 'White Bag',          name_ar: 'وايت باج',    category: 'poly_mailer', dimensions: '50 × 100 cm', price: 7.5, pack_size: 10, sort_order: 13 },

    /* ---- Boxes — sold singly ---- */
    { name: 'Small box',   name_ar: 'صندوق صغير',      category: 'box', dimensions: '9 × 13 × 20 cm',  price: 3.5, pack_size: 1, sort_order: 20 },
    { name: 'Medium box',  name_ar: 'صندوق متوسط',     category: 'box', dimensions: '11 × 20 × 24 cm', price: 6,   pack_size: 1, sort_order: 21 },
    { name: 'Large box',   name_ar: 'صندوق كبير',      category: 'box', dimensions: '12 × 22 × 35 cm', price: 9,   pack_size: 1, sort_order: 22 },
    { name: 'X-Large box', name_ar: 'صندوق إكس لارج',  category: 'box', dimensions: '15 × 27 × 35 cm', price: 11,  pack_size: 1, sort_order: 23 },

    /* ---- Stickers and extras ---- */
    {
        name: 'Fragile sticker', name_ar: 'ملصق قابل للكسر', category: 'sticker',
        price: 50, pack_size: 50, sort_order: 30,
        description: 'Marks a parcel as fragile for the courier.',
        description_ar: 'يوضّح للمندوب إن الطرد قابل للكسر.',
    },
    {
        name: 'Security seal sticker', name_ar: 'ملصق تأمين', category: 'sticker',
        price: 50, pack_size: 50, sort_order: 31,
        description: 'Tamper-evident seal — shows whether a parcel was opened in transit.',
        description_ar: 'ختم أمان بيوضّح لو الطرد اتفتح في الطريق.',
    },
    {
        name: 'Smart tracking label', name_ar: 'الملصق الذكي', category: 'label',
        price: 50, pack_size: 10, sort_order: 40,
        // The one item that does something inside the system: scanning it is what fills in
        // a parcel's tracking number without the admin printing an AWB.
        description: 'Pre-printed Bosta label. Scan it on a parcel instead of waiting for a printed AWB.',
        description_ar: 'ملصق بوسطة مطبوع مسبقاً. امسحه على الطرد بدل انتظار طباعة البوليصة.',
    },
    {
        name: 'Thermal label roll', name_ar: 'رول ملصقات حرارية', category: 'label',
        price: 350, pack_size: 500, sort_order: 41,
        unit_label: 'label', unit_label_ar: 'ملصق',
        description: 'Roll of 500 thermal labels for a label printer.',
        description_ar: 'رول 500 ملصق حراري لطابعة الملصقات.',
    },
];

async function seed({ apply = APPLY_FROM_ARGV, reprice = REPRICE_FROM_ARGV } = {}) {
    APPLY = apply;
    REPRICE = reprice;
    let shouldDisconnect = false;
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(process.env.MONGO_URI);
        shouldDisconnect = true;
    }

    console.log(APPLY ? 'APPLYING supplies catalogue\n' : 'DRY RUN — nothing is written. Re-run with --apply.\n');

    let created = 0;
    let repriced = 0;
    for (const item of CATALOGUE) {
        const existing = await SupplyProduct.findOne({ name: item.name })
            .collation({ locale: 'en', strength: 2 });

        if (!existing) {
            console.log(`  + ${item.name.padEnd(24)} ${String(item.price).padStart(6)} EGP / ${item.pack_size} ${item.unit_label_ar || 'قطعة'}`);
            if (APPLY) await SupplyProduct.create({ ...item, is_active: true });
            created += 1;
            continue;
        }

        if (REPRICE && (existing.price !== item.price || existing.pack_size !== item.pack_size)) {
            console.log(`  ~ ${item.name.padEnd(24)} ${existing.price}/${existing.pack_size} -> ${item.price}/${item.pack_size}`);
            if (APPLY) {
                existing.price = item.price;
                existing.pack_size = item.pack_size;
                await existing.save();
            }
            repriced += 1;
            continue;
        }

        console.log(`  = ${item.name.padEnd(24)} already in the catalogue at ${existing.price} EGP / ${existing.pack_size}`);
    }

    console.log(`\n${created} to create, ${repriced} to re-price. ${REPRICE ? '' : '(prices left alone — pass --reprice to overwrite them)'}`);

    if (shouldDisconnect) await mongoose.disconnect();
    return { created, repriced };
}

if (require.main === module) {
    seed().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { seed, CATALOGUE };
