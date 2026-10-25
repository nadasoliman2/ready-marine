/**
 * One-off migration: convert existing products from a typed-in sale price to
 * the discount type/value model.
 *
 * BEFORE  price + discount_price          (the sale price was typed by hand)
 * AFTER   price + discount_type + discount_value, with discount_price DERIVED
 *
 * Every pre-existing discount becomes a FIXED discount of `price - discount_price`.
 * That is the only faithful conversion: a hand-typed sale price carries no
 * record of whether the seller was thinking "25 off" or "10% off", and a fixed
 * amount reproduces the exact same sale price the customer sees today. Sellers
 * can switch any product to a percentage afterwards from the product form.
 *
 * Variants are migrated the same way, against their effective price
 * (variant.price ?? product.price).
 *
 * Rows whose stored discount_price is UNUSABLE (>= price, <= 0, or a discount
 * on a product with no price) are SKIPPED and reported, not converted. There is
 * no faithful conversion for them, and they are not a cosmetic problem: because
 * every read path resolves `discount_price ?? price`, a product with
 * discount_price ABOVE price is currently charging customers the higher figure.
 * Clearing it would quietly cut that product's live price, so the decision
 * belongs to a human. Skipping leaves the storefront behaving exactly as it
 * does today until someone fixes the price deliberately.
 *
 * Pass --clear-invalid to clear them instead (they then sell at `price`).
 *
 * Idempotent: a product that already has a discount_type is left alone, so the
 * script is safe to re-run and safe to run while the new code is deployed.
 *
 *   node scripts/migrateProductDiscounts.js                  # dry run — reports only
 *   node scripts/migrateProductDiscounts.js --apply          # write
 *   node scripts/migrateProductDiscounts.js --apply --clear-invalid
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { Product } = require('../models/products');
const { round2, computeDiscountPrice } = require('../services/shared/productPricing');

const APPLY = process.argv.includes('--apply');
const CLEAR_INVALID = process.argv.includes('--clear-invalid');

/** The fixed discount that reproduces `salePrice` off `basePrice`, or null. */
function toFixedDiscount(basePrice, salePrice) {
    const base = Number(basePrice);
    const sale = Number(salePrice);
    if (!Number.isFinite(base) || !Number.isFinite(sale)) return null;
    if (base <= 0 || sale <= 0 || sale >= base) return null;
    return round2(base - sale);
}

(async () => {
    const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/sayarty';
    await mongoose.connect(uri);
    console.log(`Database: ${uri.replace(/\/\/[^@]*@/, '//***@')}`);
    console.log(APPLY ? 'Mode    : APPLY (writing)\n' : 'Mode    : DRY RUN (no writes)\n');

    const stats = {
        scanned: 0,
        alreadyMigrated: 0,
        productsConverted: 0,
        productsCleared: 0,
        productsSkippedInvalid: 0,
        variantsConverted: 0,
        variantsCleared: 0,
        variantsSkippedInvalid: 0,
        unchanged: 0,
        written: 0,
    };
    const cleared = [];

    // .lean() on purpose: the documents are inspected and written with a plain
    // updateOne, so the model's pre-validate hook never re-derives underneath us
    // and the migration writes exactly what it reports.
    const cursor = Product.find({}, {
        price: 1, discount_price: 1, discount_type: 1, discount_value: 1,
        sku: 1, title_en: 1, title_ar: 1, variants: 1,
    }).lean().cursor();

    for (let product = await cursor.next(); product; product = await cursor.next()) {
        stats.scanned++;

        // Already on the new model — leave it exactly as it is.
        if (product.discount_type) {
            stats.alreadyMigrated++;
            continue;
        }

        const set = {};
        const label = product.sku || product.title_en || product.title_ar || String(product._id);

        /* ── Product level ── */
        if (product.discount_price !== null && product.discount_price !== undefined) {
            const value = toFixedDiscount(product.price, product.discount_price);
            if (value === null && !CLEAR_INVALID) {
                // Leave the document completely untouched — writing even a null
                // discount_type here would be harmless today but the storefront
                // price is the thing at stake, so change nothing.
                stats.productsSkippedInvalid++;
                cleared.push(`  product ${label}: price=${product.price} discount_price=${product.discount_price}`);
                continue;
            }
            if (value === null) {
                set.discount_type = null;
                set.discount_value = null;
                set.discount_price = null;
                stats.productsCleared++;
                cleared.push(`  product ${label}: price=${product.price} discount_price=${product.discount_price} (CLEARED)`);
            } else {
                set.discount_type = 'fixed';
                set.discount_value = value;
                // Recompute rather than copy, so the stored sale price is exactly
                // what the new derivation produces.
                set.discount_price = computeDiscountPrice(product.price, 'fixed', value);
                stats.productsConverted++;
            }
        } else {
            set.discount_type = null;
            set.discount_value = null;
        }

        /* ── Variants ── */
        const variants = Array.isArray(product.variants) ? product.variants : [];
        if (variants.length > 0) {
            let variantTouched = false;
            const migrated = variants.map((v, i) => {
                if (v.discount_type) return v; // already migrated
                const effectivePrice = v.price != null ? v.price : product.price;
                if (v.discount_price === null || v.discount_price === undefined) {
                    variantTouched = variantTouched || v.discount_value != null;
                    return { ...v, discount_type: null, discount_value: null, discount_price: null };
                }
                const value = toFixedDiscount(effectivePrice, v.discount_price);
                if (value === null && !CLEAR_INVALID) {
                    stats.variantsSkippedInvalid++;
                    cleared.push(`  variant #${i + 1} of ${label}: effective price=${effectivePrice} discount_price=${v.discount_price}`);
                    return v; // untouched — keeps the current storefront price
                }
                variantTouched = true;
                if (value === null) {
                    stats.variantsCleared++;
                    cleared.push(`  variant #${i + 1} of ${label}: effective price=${effectivePrice} discount_price=${v.discount_price} (CLEARED)`);
                    return { ...v, discount_type: null, discount_value: null, discount_price: null };
                }
                stats.variantsConverted++;
                return {
                    ...v,
                    discount_type: 'fixed',
                    discount_value: value,
                    discount_price: computeDiscountPrice(effectivePrice, 'fixed', value),
                };
            });
            if (variantTouched) set.variants = migrated;
        }

        // Nothing meaningful to write for a product that never had a discount.
        const onlyNulls = set.discount_type === null && set.discount_value === null
            && set.discount_price === undefined && set.variants === undefined;
        if (onlyNulls && product.discount_value == null) {
            stats.unchanged++;
            continue;
        }

        if (APPLY) {
            await Product.collection.updateOne({ _id: product._id }, { $set: set });
        }
        stats.written++;
    }

    console.log(`Products scanned            : ${stats.scanned}`);
    console.log(`Already had a discount_type : ${stats.alreadyMigrated} (skipped)`);
    console.log(`No discount, nothing to do  : ${stats.unchanged}`);
    console.log(`Product discounts converted : ${stats.productsConverted}`);
    console.log(`Variant discounts converted : ${stats.variantsConverted}`);
    console.log(`Product discounts cleared   : ${stats.productsCleared}`);
    console.log(`Variant discounts cleared   : ${stats.variantsCleared}`);
    console.log(`Products SKIPPED (unusable) : ${stats.productsSkippedInvalid}`);
    console.log(`Variants SKIPPED (unusable) : ${stats.variantsSkippedInvalid}`);
    console.log(`Documents ${APPLY ? 'written' : 'that would be written'}   : ${stats.written}`);

    if (cleared.length > 0) {
        console.log(`\n${CLEAR_INVALID ? 'Cleared' : 'SKIPPED — left untouched'} as unusable (sale price >= price, <= 0, or no price).`);
        console.log(CLEAR_INVALID
            ? 'These now sell at their regular price.'
            : 'These still sell at their stored discount_price, exactly as before. Fix the prices deliberately, or re-run with --clear-invalid.');
        cleared.slice(0, 50).forEach(line => console.log(line));
        if (cleared.length > 50) console.log(`  … and ${cleared.length - 50} more`);
    }

    if (!APPLY) console.log('\nDry run — nothing written. Re-run with --apply to migrate.');

    await mongoose.disconnect();
})().catch(async (err) => {
    console.error('Migration failed:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
