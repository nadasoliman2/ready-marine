#!/usr/bin/env node
/* ------------------ Merge catalog entries that describe the same part ------------------
 *
 *   node scripts/mergeDuplicateCatalogEntries.js            # dry run
 *   node scripts/mergeDuplicateCatalogEntries.js --apply
 *
 * Bosch lists a number of parts under two product lines at once — 67101 is both
 * a "Fuel Pump" and a "Fuel Pump Assembly", 0986494535 is both a "Euroline" and
 * a "Blue" brake pad. The scrape faithfully carried both rows, so the catalog
 * ended up with two entries for one physical part. That is the one thing a
 * central catalog must not have: two vendors stocking the same part would attach
 * their offers to different entries, and the "who sells this and for how much"
 * view — the entire point of the feature — would silently split in half.
 *
 * Duplicates are keyed on BRAND + part number, never part number alone: AGO's
 * short codes (127, 196, 208) collide head-on with Bosch glow plug numbers, and
 * a bare part-number key would merge a Speranza coolant hose into a Bosch glow
 * plug. A part number only identifies a part within its manufacturer. Entries
 * with no part number fall back to brand + title.
 *
 * Even inside one brand a shared number is not always one part. Bosch part
 * numbers are real manufacturer keys — 67101 listed as both "Fuel Pump" and
 * "Fuel Pump Assembly" is one pump under two marketing lines, so it merges.
 * AGO's codes are short catalogue sequence numbers it reuses: 133 is a Lancer
 * coolant hose on one page and a BYD one on another. For brands whose numbers
 * are not authoritative, a merge additionally requires the Arabic name to
 * match, which is what a genuine cross-listing looks like.
 * The richer row survives; the other becomes status:'merged' pointing at it,
 * which is exactly what the schema's `merged_into` is for — a stale link on an
 * old product still resolves. Nothing is deleted, so this is reversible.
 *
 * Fitment is UNIONED onto the survivor first, so merging never loses a car.
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { CatalogEntry } = require('../models/catalogEntries');
const { Brand } = require('../models/product_brands');

const APPLY = process.argv.includes('--apply');

// Brands whose part numbers uniquely identify a part on their own.
const AUTHORITATIVE_PART_NUMBERS = ['bosch'];

/* The row a vendor is better off landing on: most fitment, then most text,
   then has an image. _id last so the choice is stable across runs. */
function pickSurvivor(group) {
    return [...group].sort((a, b) => {
        const carsA = (a.compatible_cars || []).reduce((n, c) => n + (c.models?.length || 0), 0);
        const carsB = (b.compatible_cars || []).reduce((n, c) => n + (c.models?.length || 0), 0);
        if (carsA !== carsB) return carsB - carsA;
        const lenA = (a.description_en || '').length, lenB = (b.description_en || '').length;
        if (lenA !== lenB) return lenB - lenA;
        const imgA = a.images?.length ? 1 : 0, imgB = b.images?.length ? 1 : 0;
        if (imgA !== imgB) return imgB - imgA;
        return a._id.toString() < b._id.toString() ? -1 : 1;
    })[0];
}

/* Union of two compatible_cars arrays, deduplicated by brand then model.
   all_years wins over an explicit list, since it is the broader claim. */
function unionCars(groups) {
    const brands = new Map();
    for (const cars of groups) {
        for (const c of cars || []) {
            const bk = c.brand_id.toString();
            if (!brands.has(bk)) brands.set(bk, { brand_id: c.brand_id, brand_name: c.brand_name, all_models: false, models: new Map() });
            const bucket = brands.get(bk);
            if (c.all_models) bucket.all_models = true;
            for (const m of c.models || []) {
                const mk = m.model_id.toString();
                const prev = bucket.models.get(mk);
                if (!prev) { bucket.models.set(mk, { model_id: m.model_id, model_name: m.model_name, years: new Set(m.years || []), all_years: !!m.all_years }); continue; }
                if (m.all_years) prev.all_years = true;
                (m.years || []).forEach((y) => prev.years.add(y));
            }
        }
    }
    return [...brands.values()].map((b) => ({
        brand_id: b.brand_id,
        brand_name: b.brand_name,
        all_models: b.all_models,
        models: [...b.models.values()].map((m) => ({
            model_id: m.model_id,
            model_name: m.model_name,
            years: m.all_years ? [] : [...m.years].sort((x, y) => x - y),
            all_years: m.all_years,
        })),
    }));
}

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`MODE: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (nothing will be written)'}\n`);

    const live = await CatalogEntry.find({ status: { $in: ['approved', 'suggested'] } }).lean();
    console.log(`Live catalog entries: ${live.length}`);

    const authoritative = new Set(
        (await Brand.find({ name: { $in: AUTHORITATIVE_PART_NUMBERS } }, { _id: 1 }).lean())
            .map((b) => b._id.toString())
    );
    console.log(`Brands with authoritative part numbers: ${authoritative.size}`);

    /* Group by part number; entries without one fall back to their title. */
    const groups = new Map();
    for (const e of live) {
        const pn = (e.part_number || '').trim();
        const brand = e.product_brand_id ? e.product_brand_id.toString() : 'nobrand';
        // Outside the authoritative brands the name has to match too, so a
        // reused catalogue code cannot fuse two unrelated parts.
        const nameKey = authoritative.has(brand) ? '' : `|${(e.title_ar || e.title_en || '').trim().toLowerCase()}`;
        const key = pn
            ? `${brand}|pn:${pn.toLowerCase()}${nameKey}`
            : `${brand}|t:${(e.title_en || e.title_ar || '').trim().toLowerCase()}`;
        if (key.includes('|pn:') && !pn) continue;
        if (key.endsWith('|t:')) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(e);
    }

    const dups = [...groups.entries()].filter(([, g]) => g.length > 1);
    const extra = dups.reduce((n, [, g]) => n + g.length - 1, 0);
    console.log(`Duplicate groups: ${dups.length}  |  entries to merge away: ${extra}\n`);

    let shown = 0;
    const ops = [];
    let carsGained = 0;
    for (const [key, group] of dups) {
        const survivor = pickSurvivor(group);
        const losers = group.filter((e) => e._id.toString() !== survivor._id.toString());

        const merged = unionCars(group.map((e) => e.compatible_cars));
        const before = (survivor.compatible_cars || []).reduce((n, c) => n + (c.models?.length || 0), 0);
        const after = merged.reduce((n, c) => n + (c.models?.length || 0), 0);
        if (after > before) carsGained += after - before;

        if (shown++ < 6) {
            console.log(`  ${key}`);
            console.log(`    keep  : ${survivor.title_en}`);
            losers.forEach((l) => console.log(`    merge : ${l.title_en}`));
            if (after > before) console.log(`    fitment models ${before} → ${after}`);
        }

        ops.push({
            updateOne: {
                filter: { _id: survivor._id },
                update: { $set: { compatible_cars: merged, is_universal: merged.length === 0, updated_at: new Date() } },
            },
        });
        for (const l of losers) {
            ops.push({
                updateOne: {
                    filter: { _id: l._id },
                    update: { $set: { status: 'merged', merged_into: survivor._id, updated_at: new Date() } },
                },
            });
        }
    }
    if (dups.length > 6) console.log(`  … and ${dups.length - 6} more groups`);

    console.log(`\nFitment models recovered onto survivors: ${carsGained}`);

    if (APPLY && ops.length) {
        const res = await CatalogEntry.bulkWrite(ops, { ordered: false });
        console.log(`Modified: ${res.modifiedCount}`);
        console.log(`Live entries now : ${await CatalogEntry.countDocuments({ status: { $in: ['approved', 'suggested'] } })}`);
        console.log(`Marked merged    : ${await CatalogEntry.countDocuments({ status: 'merged' })}`);
    } else if (!APPLY) console.log('\nDry run — nothing was written. Re-run with --apply.');

    await mongoose.disconnect();
})().catch((err) => { console.error(err); process.exit(1); });
