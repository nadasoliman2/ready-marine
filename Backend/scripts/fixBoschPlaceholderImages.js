#!/usr/bin/env node
/* ------------------ Replace Bosch's "no image" placeholder ------------------
 *
 *   node scripts/fixBoschPlaceholderImages.js            # dry run
 *   node scripts/fixBoschPlaceholderImages.js --apply
 *
 * Bosch has no photograph for 19,719 of its 37,668 parts. For those its commerce
 * API returns a default endpoint (/o/commerce-media/default/?groupId=40414) that
 * serves a grey "no image available" camera icon. The import took that at face
 * value and pointed 19,702 catalog entries at the one icon file, so instead of
 * reading as "no photo" they read as a photo — and inside a family like Euroline
 * Brake Pads a few part numbers showed the real part while the rest showed the
 * icon.
 *
 * Bosch does photograph the product LINE for its marketing pages, so each of
 * those parts now carries its own line's photo — a real picture of that kind of
 * part. Where a line has no page of its own, a photographed sibling part from
 * the same line is used instead.
 *
 * Where neither exists the entry is left with NO image rather than the icon.
 * QuietCast Premium Disc Brake Rotors is the big one: Bosch publishes no rotor
 * photograph anywhere, and using the brake PAD image would show the wrong part.
 *
 * The part→image mapping is resolved from the scrape into ./boschLineImages.json.
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { CatalogEntry } = require('../models/catalogEntries');
const { Brand } = require('../models/product_brands');
const MAPPING = require('./boschLineImages.json');

const APPLY = process.argv.includes('--apply');
const BASE = (process.env.BACKEND_PUBLIC_URL || 'https://readycar.store').replace(/\/+$/, '');
const PLACEHOLDER = /\/uploads\/catalog\/bosch\/image\.png$/;

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`MODE: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (nothing will be written)'}\n`);

    const brand = await Brand.findOne({ name: 'bosch' });
    // Entries still on the icon, plus any left imageless by an earlier pass —
    // the family-image resolution improves as more line folders are matched.
    const entries = await CatalogEntry.find(
        { product_brand_id: brand._id, $or: [{ 'images.url': PLACEHOLDER }, { images: { $size: 0 } }] },
        { part_number: 1, title_en: 1, images: 1 }
    ).lean();
    console.log(`Entries on the placeholder icon or with no image: ${entries.length}`);
    console.log(`Part numbers with a family image resolved: ${Object.keys(MAPPING).length}\n`);

    const stats = { line: 0, sibling: 0, cleared: 0, noPart: 0 };
    const ops = [];
    let shown = 0;

    for (const e of entries) {
        const pn = (e.part_number || '').trim();
        const rel = pn ? MAPPING[pn] : null;
        if (!pn) stats.noPart++;

        let images = [];
        if (rel) {
            images = [{ url: `${BASE}/uploads/${rel}`, is_primary: true }];
            if (rel.includes('/bosch-lines/')) stats.line++; else stats.sibling++;
        } else stats.cleared++;

        if (shown++ < 5) console.log(`  ${e.title_en}\n    → ${rel ? `${BASE}/uploads/${rel}` : '(no image)'}`);
        if (!rel && !e.images.length) continue;   // already imageless, nothing to change
        ops.push({ updateOne: { filter: { _id: e._id }, update: { $set: { images, updated_at: new Date() } } } });
    }

    console.log(`\n--- Summary ---`);
    console.log(`Given their product-line photo : ${stats.line}`);
    console.log(`Given a sibling part's photo   : ${stats.sibling}`);
    console.log(`Left with no image (honest)    : ${stats.cleared}`);
    if (stats.noPart) console.log(`Entries with no part number    : ${stats.noPart}`);

    if (APPLY && ops.length) {
        let modified = 0;
        for (let i = 0; i < ops.length; i += 1000) {
            const res = await CatalogEntry.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
            modified += res.modifiedCount;
            process.stdout.write(`\r  written ${modified}/${ops.length}`);
        }
        console.log(`\nModified: ${modified}`);
    } else if (!APPLY) console.log('\nDry run — nothing was written. Re-run with --apply.');

    await mongoose.disconnect();
})().catch((err) => { console.error(err); process.exit(1); });
