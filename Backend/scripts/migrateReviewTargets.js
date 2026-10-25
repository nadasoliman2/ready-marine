/**
 * Makes an existing installation ready for vendor reviews and vendor reputation numbers.
 *
 *   node Backend/scripts/migrateReviewTargets.js            # report only
 *   node Backend/scripts/migrateReviewTargets.js --apply    # write
 *
 * Three things, all idempotent:
 *
 *  1. DROP `one_review_per_order_item`. That index was unique on (order_id, product_id).
 *     A vendor review has a null product_id, so an order spanning two sellers would
 *     produce two rows that the old index reads as duplicates — the second seller's
 *     review would be silently rejected. Mongo does not replace an index when its
 *     definition changes, so this has to be an explicit drop.
 *
 *  2. STAMP `target_type: 'product'` on every existing review. The schema defaults it, but
 *     a default only applies to documents Mongoose writes; rows already on disk keep
 *     whatever they had, and the new unique index treats a missing field as null — which
 *     would put every legacy review in a different uniqueness bucket than the new ones.
 *
 *  3. BACKFILL every vendor's `completed_orders_count`, `rating` and `reviews_count`, so
 *     the storefront shows real history from the first page load instead of zeroes that
 *     only fill in as new orders land.
 */

require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

const OLD_INDEX = 'one_review_per_order_item';
const NEW_INDEX = 'one_review_per_order_target';

async function run() {
    let shouldDisconnect = false;
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(process.env.MONGO_URI);
        shouldDisconnect = true;
    }

    console.log(APPLY ? 'APPLYING review/vendor-stats migration\n' : 'DRY RUN — nothing is written. Re-run with --apply.\n');

    const { Review } = require('../models/reviews');
    const vendorStatsService = require('../services/vendorStatsService');
    const collection = Review.collection;

    /* ---- 1. indexes ---- */
    console.log('Indexes');
    const indexes = await collection.indexes();
    const names = indexes.map((i) => i.name);

    if (names.includes(OLD_INDEX)) {
        console.log(`  ~ dropping ${OLD_INDEX} (unique on order_id+product_id)`);
        if (APPLY) await collection.dropIndex(OLD_INDEX);
    } else {
        console.log(`  = ${OLD_INDEX} already gone`);
    }

    if (names.includes(NEW_INDEX)) {
        console.log(`  = ${NEW_INDEX} already present`);
    } else {
        console.log(`  + creating ${NEW_INDEX} (unique on order_id+target_type+product_id+vendor_id)`);
        if (APPLY) {
            await collection.createIndex(
                { order_id: 1, target_type: 1, product_id: 1, vendor_id: 1 },
                { unique: true, name: NEW_INDEX }
            );
        }
    }

    /* ---- 2. stamp target_type ---- */
    console.log('\nExisting reviews');
    const untyped = await collection.countDocuments({ target_type: { $exists: false } });
    if (untyped === 0) {
        console.log('  = every review already carries a target_type');
    } else {
        console.log(`  ~ ${untyped} review(s) -> target_type: "product"`);
        if (APPLY) await collection.updateMany({ target_type: { $exists: false } }, { $set: { target_type: 'product' } });
    }

    /* ---- 3. vendor stats backfill ---- */
    console.log('\nVendor reputation backfill');
    if (!APPLY) {
        const { Seller } = require('../models/sellers');
        console.log(`  ~ would recompute completed orders + rating for ${await Seller.countDocuments()} vendor(s)`);
    } else {
        const { total, changed } = await vendorStatsService.recomputeAllVendors();
        console.log(`  ~ recomputed ${total} vendor(s); ${changed.length} changed`);
        for (const row of changed.slice(0, 25)) {
            console.log(`     ${String(row.vendor || '—').padEnd(34)} orders=${String(row.completed).padStart(4)}  rating=${row.rating} (${row.reviews_count})`);
        }
        if (changed.length > 25) console.log(`     …and ${changed.length - 25} more`);
    }

    console.log('\nDone.');
    if (shouldDisconnect) await mongoose.disconnect();
}

if (require.main === module) {
    run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { run };
