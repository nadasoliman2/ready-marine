/**
 * One-off data fix: repair products whose price and sale price were entered the
 * wrong way round, then express them in the discount type/value model.
 *
 * These rows hold discount_price >= price. Because every read path resolves the
 * effective price as `discount_price ?? price`, they have been CHARGING THE
 * HIGHER FIGURE while displaying the lower one struck through. Left alone the
 * migration skips them (see migrateProductDiscounts.js), because deciding what
 * the real price is belongs to a human, not a script.
 *
 * The decision applied here: the HIGHER number is the regular price, the LOWER
 * number is the price after discount.
 *
 *   BEFORE  price = 155, discount_price = 186   → customer paid 186
 *   AFTER   price = 186, discount_type = 'fixed', discount_value = 31,
 *           discount_price = 155                → customer pays 155
 *
 * NOTE this LOWERS what those products charge. That is the intended correction,
 * not a side effect: the storefront was already advertising the lower number as
 * the sale price, so this makes the charge match what shoppers were shown.
 *
 * Equal values (discount_price === price) are not inverted — there is no
 * discount to express, so they become a plain price with no discount and the
 * customer keeps paying exactly the same.
 *
 * Rows with a non-positive or missing price are reported and skipped; there is
 * nothing to infer from them.
 *
 * Idempotent: only rows still holding discount_price >= price are touched, so
 * re-running is a no-op.
 *
 *   node scripts/fixInvertedProductDiscounts.js            # dry run
 *   node scripts/fixInvertedProductDiscounts.js --apply    # write
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { Product } = require('../models/products');
const { round2, computeDiscountPrice } = require('../services/shared/productPricing');

const APPLY = process.argv.includes('--apply');

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

(async () => {
    const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/sayarty';
    await mongoose.connect(uri);
    console.log(`Database: ${uri.replace(/\/\/[^@]*@/, '//***@')}`);
    console.log(APPLY ? 'Mode    : APPLY (writing)\n' : 'Mode    : DRY RUN (no writes)\n');

    const stats = { swapped: 0, equalCleared: 0, skipped: 0, variantsSwapped: 0, written: 0 };
    const lines = [];

    const candidates = await Product.find({
        $expr: { $gte: ['$discount_price', '$price'] },
    }, { sku: 1, title_en: 1, title_ar: 1, price: 1, discount_price: 1, discount_type: 1, variants: 1 }).lean();

    console.log(`Inverted / equal rows found : ${candidates.length}\n`);

    for (const p of candidates) {
        const label = p.sku || p.title_en || p.title_ar || String(p._id);
        const price = num(p.price);
        const sale = num(p.discount_price);

        if (price === null || price <= 0 || sale === null || sale <= 0) {
            stats.skipped++;
            lines.push(`  SKIP  ${label}: price=${p.price} discount_price=${p.discount_price} (nothing to infer)`);
            continue;
        }

        const set = {};

        if (sale === price) {
            // Not inverted, just a duplicated figure — no discount to express.
            set.price = price;
            set.discount_type = null;
            set.discount_value = null;
            set.discount_price = null;
            stats.equalCleared++;
            lines.push(`  EQUAL ${label}: ${price} → price ${price}, no discount (customer still pays ${price})`);
        } else {
            // Inverted: the higher figure is the real price.
            const regular = sale;
            const afterDiscount = price;
            const value = round2(regular - afterDiscount);
            const derived = computeDiscountPrice(regular, 'fixed', value);

            if (derived === null) {
                stats.skipped++;
                lines.push(`  SKIP  ${label}: could not derive a valid discount from ${price}/${sale}`);
                continue;
            }

            set.price = regular;
            set.discount_type = 'fixed';
            set.discount_value = value;
            set.discount_price = derived;
            stats.swapped++;
            lines.push(`  SWAP  ${label}: price ${price}→${regular}, fixed −${value}, customer pays ${sale}→${derived}`);
        }

        /* Variants inherit the base price, so a variant that overrides nothing
           needs its derived sale price recomputed against the corrected price. */
        const variants = Array.isArray(p.variants) ? p.variants : [];
        if (variants.length > 0) {
            let touched = false;
            const migrated = variants.map((v) => {
                const effective = v.price != null ? v.price : set.price;
                if (!v.discount_type) {
                    if (v.discount_price != null) { touched = true; return { ...v, discount_price: null }; }
                    return v;
                }
                const recomputed = computeDiscountPrice(effective, v.discount_type, v.discount_value);
                if (recomputed !== v.discount_price) { touched = true; stats.variantsSwapped++; }
                return { ...v, discount_price: recomputed };
            });
            if (touched) set.variants = migrated;
        }

        if (APPLY) await Product.collection.updateOne({ _id: p._id }, { $set: set });
        stats.written++;
    }

    lines.forEach(l => console.log(l));

    console.log(`\nSwapped (inverted)      : ${stats.swapped}`);
    console.log(`Cleared (equal figures) : ${stats.equalCleared}`);
    console.log(`Skipped (unusable)      : ${stats.skipped}`);
    console.log(`Variant prices rederived: ${stats.variantsSwapped}`);
    console.log(`Documents ${APPLY ? 'written' : 'that would be written'}: ${stats.written}`);

    if (!APPLY) console.log('\nDry run — nothing written. Re-run with --apply.');

    await mongoose.disconnect();
})().catch(async (err) => {
    console.error('Fix failed:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
