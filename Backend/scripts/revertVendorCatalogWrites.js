#!/usr/bin/env node
/* ------------------ Undo the catalog writes made while linking a vendor ------------------
 *
 *   node scripts/revertVendorCatalogWrites.js            # dry run
 *   node scripts/revertVendorCatalogWrites.js --apply
 *
 * Linking a vendor's products to the catalog should only ever set
 * catalog_entry_id on the product. The run on 2026-08-20 went further in two
 * ways, and both are undone here:
 *
 *   1. Sixteen products had no counterpart in the catalog, so entries were
 *      CREATED from the vendor's own titles and the products linked to them.
 *      That pushes vendor data into the catalog — the opposite direction. The
 *      products are unlinked and those sixteen entries deleted; a product with
 *      no matching entry is supposed to stay unlinked.
 *
 *   2. Four AGO entry pairs were merged and the survivors renamed. Whatever the
 *      merits, that is editing the catalog, not linking to it. The eight entries
 *      are restored byte-for-byte from the snapshot taken immediately before the
 *      run, rather than retyped from memory.
 *
 * The 62 products that were linked to entries the catalog already had are
 * correct and are left completely alone.
 *
 * Requires the pre-run snapshot restored into a scratch database:
 *   mongorestore --archive --gzip --nsFrom='readycar.*' --nsTo='readycar_prelink.*' --drop < <backup>
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { CatalogEntry } = require('../models/catalogEntries');
const { Product } = require('../models/products');
const { NO_CATALOG_MATCH, MERGE } = require('./vendorCatalogLinks');

const APPLY = process.argv.includes('--apply');
const SNAPSHOT_DB = 'readycar_prelink';

/* Fields the merge touched. Restored from the snapshot exactly as they were. */
const RESTORE_FIELDS = ['title_ar', 'title_en', 'compatible_cars', 'is_universal', 'status', 'merged_into'];

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`MODE: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (nothing will be written)'}\n`);

    const snapshot = mongoose.connection.client.db(SNAPSHOT_DB).collection('catalogentries');
    if (!(await snapshot.countDocuments())) {
        console.error(`Snapshot database "${SNAPSHOT_DB}" is empty — restore the pre-run backup first.`);
        process.exit(1);
    }

    /* ---- 1. unlink the products, delete the entries built from them ---- */
    console.log('--- Entries created from vendor data ---');
    let unlinked = 0, deleted = 0, kept = 0;
    for (const n of NO_CATALOG_MATCH) {
        const entry = await CatalogEntry.findOne({ part_number: n.pn, title_ar: n.ar });
        const product = await Product.findById(n.product, { title_ar: 1, catalog_entry_id: 1 }).lean();
        if (!entry) { console.log(`  already gone: ${n.ar}`); continue; }

        // Never delete an entry something else has since attached itself to.
        const users = await Product.countDocuments({ catalog_entry_id: entry._id, _id: { $ne: entry._id } });
        const others = await Product.countDocuments({ catalog_entry_id: entry._id, _id: { $ne: new mongoose.Types.ObjectId(n.product) } });
        if (others > 0) { console.log(`  KEEPING ${n.ar} — ${others} other product(s) link to it`); kept++; continue; }

        console.log(`  unlink "${product?.title_ar}"  +  delete entry "${n.ar}"${users ? '' : ''}`);
        if (APPLY) {
            await Product.updateOne({ _id: n.product }, { $set: { catalog_entry_id: null } });
            await CatalogEntry.deleteOne({ _id: entry._id });
        }
        unlinked++; deleted++;
    }

    /* ---- 2. restore the eight entries the merge touched ---- */
    console.log('\n--- Entries changed by the merge, restored from the snapshot ---');
    let restored = 0;
    for (const m of MERGE) {
        for (const id of [m.keep, m.merge]) {
            const before = await snapshot.findOne({ _id: new mongoose.Types.ObjectId(id) });
            const now = await CatalogEntry.findById(id).lean();
            if (!before || !now) { console.log(`  ! missing ${id}`); continue; }

            const changed = RESTORE_FIELDS.filter((f) => JSON.stringify(before[f] ?? null) !== JSON.stringify(now[f] ?? null));
            if (!changed.length) { console.log(`  unchanged: ${now.title_ar}`); continue; }

            console.log(`  ${now.title_ar}\n      → ${before.title_ar}   [${changed.join(', ')}]`);
            if (APPLY) {
                const $set = { updated_at: new Date() };
                for (const f of RESTORE_FIELDS) $set[f] = before[f] ?? null;
                await CatalogEntry.updateOne({ _id: id }, { $set });
            }
            restored++;
        }
    }

    console.log('\n--- Summary ---');
    console.log(`Products unlinked        : ${unlinked}`);
    console.log(`Entries deleted          : ${deleted}`);
    if (kept) console.log(`Entries kept (in use)    : ${kept}`);
    console.log(`Entries restored         : ${restored}`);

    if (APPLY) {
        const rx = /AGO|bosch|بوش/i;
        const scope = { $or: [{ title_ar: rx }, { title_en: rx }] };
        console.log(`\nIn-scope products still linked: ${await Product.countDocuments({ ...scope, catalog_entry_id: { $ne: null } })}`);
        console.log(`In-scope products unlinked    : ${await Product.countDocuments({ ...scope, catalog_entry_id: null })}`);
    } else console.log('\nDry run — nothing was written. Re-run with --apply.');

    await mongoose.disconnect();
})().catch((err) => { console.error(err); process.exit(1); });
