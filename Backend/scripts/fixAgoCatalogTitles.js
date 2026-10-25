#!/usr/bin/env node
/* ------------------ Re-title the agopartspro catalog entries in English ------------------
 *
 *   node scripts/fixAgoCatalogTitles.js            # dry run
 *   node scripts/fixAgoCatalogTitles.js --apply
 *
 * The first import generated title_en mechanically ("AGO Hose 127"), throwing
 * away everything the Arabic name said — position (upper/lower), shape (T, L,
 * Y-piece), circuit (heater feed, cold return) and the car it fits. This rebuilds
 * title_en, subtitle_en and description_en from the hand-written translations in
 * ./agoTitlesEn.js. title_ar is the source of truth and is never touched.
 *
 * The script refuses to write if a single Arabic name is missing a translation,
 * so a partial dictionary cannot silently leave placeholder titles behind.
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { CatalogEntry } = require('../models/catalogEntries');
const { Brand } = require('../models/product_brands');
const TITLES = require('./agoTitlesEn');

const APPLY = process.argv.includes('--apply');

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`MODE: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (nothing will be written)'}\n`);

    const brand = await Brand.findOne({ name: 'ago parts pro' });
    if (!brand) { console.error('Product brand "ago parts pro" not found.'); process.exit(1); }

    const entries = await CatalogEntry.find({ product_brand_id: brand._id }).lean();
    console.log(`agopartspro entries: ${entries.length}`);

    const missing = [...new Set(entries.map((e) => e.title_ar).filter((t) => !TITLES[t]))];
    if (missing.length) {
        console.error(`\n${missing.length} Arabic name(s) have no translation — refusing to write:`);
        missing.forEach((m) => console.error(`  ${m}`));
        process.exit(1);
    }
    console.log('Every Arabic name has a translation.\n');

    let changed = 0;
    const ops = [];
    for (const e of entries) {
        const titleEn = TITLES[e.title_ar];
        // "خرطوم — شيري انفي" → the page name; the fitment list is already in Arabic
        // in subtitle_ar, so the English subtitle carries the same fact in English.
        // The Arabic line joins brands with "،" — an Arabic comma reads as a glyph
        // box in an English sentence, so normalise it on the way out.
        const fits = ((e.description_ar.match(/^يركب على: (.+)\.$/m) || [])[1] || '').replace(/،\s*/g, ', ');
        const code = e.part_number || '';

        const subtitleEn = fits ? `Fits ${fits}` : 'AGO Parts Pro';
        const descriptionEn = [
            `${titleEn}, manufactured by AGO Parts Pro.`,
            fits && `Fits: ${fits}.`,
            code && `Part code: ${code}.`,
        ].filter(Boolean).join('\n');

        if (e.title_en === titleEn && e.subtitle_en === subtitleEn && e.description_en === descriptionEn) continue;
        changed++;
        if (changed <= 6) console.log(`  ${(e.title_en || '').padEnd(26)} → ${titleEn}`);
        ops.push({
            updateOne: {
                filter: { _id: e._id },
                update: { $set: { title_en: titleEn, subtitle_en: subtitleEn, description_en: descriptionEn, updated_at: new Date() } },
            },
        });
    }
    if (changed > 6) console.log(`  … and ${changed - 6} more`);
    console.log(`\nEntries to rewrite: ${changed}`);

    if (APPLY && ops.length) {
        const res = await CatalogEntry.bulkWrite(ops, { ordered: false });
        console.log(`Written: ${res.modifiedCount}`);
    } else if (!APPLY) console.log('\nDry run — nothing was written. Re-run with --apply.');

    await mongoose.disconnect();
})().catch((err) => { console.error(err); process.exit(1); });
