#!/usr/bin/env node
/* ------------------ Put the Bosch entries into actual Arabic ------------------
 *
 *   node scripts/arabizeBoschCatalog.js            # dry run
 *   node scripts/arabizeBoschCatalog.js --apply
 *
 * The import built description_ar as two Arabic sentences followed by Bosch's
 * English marketing paragraph and an English specification block — so the
 * "Arabic" description was mostly English. This rewrites both from:
 *
 *   ./boschDescriptionsAr.js  134 product-line paragraphs, translated
 *   ./boschSpecsAr.js         216 spec labels + their low-cardinality values
 *
 * It reads the English back out of description_ar rather than re-opening the
 * scrape, so it needs no data mount and stays correct for the entries whose
 * titles were later rewritten (the 122 internal-UUID rows) or merged away.
 *
 * subtitle_ar becomes the first sentence of the translated copy — an actual
 * description of the part instead of the generic "قطعة غيار Bosch" stamp.
 *
 * Re-running is safe: an entry whose description no longer holds an English
 * block is left alone and counted as already done.
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { CatalogEntry } = require('../models/catalogEntries');
const { Brand } = require('../models/product_brands');
const DESC = require('./boschDescriptionsAr');
const { KEYS, VALUES, DROP } = require('./boschSpecsAr');

const APPLY = process.argv.includes('--apply');
const SPEC_HEADER = 'المواصفات الفنية:';
const HAS_LATIN = /[A-Za-z]{4,}/;

/* Split the stored description into: Arabic header, the English blurb, and the
   raw specification block. The importer joined these with blank lines. */
function split(descAr) {
    const [body, rawSpecs = ''] = descAr.split(`\n\n${SPEC_HEADER}\n`);
    const paras = body.split('\n\n');
    // paras[0] = "<label> من بوش (Bosch) — رقم القطعة X."
    // paras[1] = the fixed OE sentence, paras[2] = Bosch's English copy (optional)
    return { head: paras.slice(0, 2), english: paras.slice(2).join('\n\n').trim(), rawSpecs };
}

/* paras[1] is the importer's generic "OE-spec part" filler. Once the real
   translated copy is in place it says nothing the next paragraph does not. */
function headFor(head, hasCopy) {
    return hasCopy ? head.slice(0, 1) : head;
}

/* Bosch spec blocks are "Key: Value" per line, except that a few values (the
   Prop 65 legal text) contain their own newlines. A line only starts a new spec
   when its key is one we know; anything else continues the previous value. */
function parseSpecs(raw) {
    const out = [];
    for (const line of raw.split('\n')) {
        const m = /^([^:]+):\s*(.*)$/.exec(line);
        const key = m && m[1].trim();
        if (m && (KEYS[key] || DROP.has(key))) out.push([key, m[2].trim()]);
        else if (out.length) out[out.length - 1][1] += ` ${line.trim()}`;
    }
    return out;
}

/* Bosch quotes weight in pounds to six decimals ("9.590108 lb"). Egypt buys in
   kilograms, and six decimals on a brake pad is noise, so convert and round.
   Other dimension labels already name their unit, so a trailing "in"/"mm" on
   the value just repeats it. */
const LB_TO_KG = 0.45359237;
function normaliseValue(key, raw) {
    if (key === 'Automotive Item Weight (lbs)') {
        const n = parseFloat(raw);
        if (Number.isFinite(n)) return `${(n * LB_TO_KG).toFixed(2)} كجم`;
    }
    return raw.replace(/\s+(in|inch|inches|mm|lb|lbs)\.?$/i, '').trim();
}

function arabicSpecs(pairs, stats) {
    const lines = [];
    for (const [k, v] of pairs) {
        if (DROP.has(k)) { stats.specsDropped++; continue; }
        const label = KEYS[k];
        if (!label) { stats.unknownSpecKeys.add(k); continue; }
        const value = VALUES[v] || VALUES[v.trim()] || normaliseValue(k, v);
        if (!value) continue;
        if (/[A-Za-z]{4,}/.test(value)) stats.latinValues.set(value, (stats.latinValues.get(value) || 0) + 1);
        lines.push(`${label}: ${value}`);
    }
    return lines;
}

/* The opening sentence, for the subtitle. Arabic full stops are '.' here. */
function firstSentence(text, max = 180) {
    const s = text.split(/(?<=\.)\s/)[0].trim();
    return s.length <= max ? s : `${s.slice(0, s.lastIndexOf(' ', max)).trimEnd()}…`;
}

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`MODE: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (nothing will be written)'}\n`);

    const brand = await Brand.findOne({ name: 'bosch' });
    if (!brand) { console.error('Product brand "bosch" not found.'); process.exit(1); }

    const entries = await CatalogEntry.find({ product_brand_id: brand._id },
        { description_ar: 1, subtitle_ar: 1, title_ar: 1 }).lean();
    console.log(`Bosch entries: ${entries.length}`);

    const stats = {
        rewritten: 0, alreadyArabic: 0, noBlurb: 0,
        untranslated: new Map(), unknownSpecKeys: new Set(), specsDropped: 0, latinValues: new Map(),
    };
    const ops = [];
    let shown = 0;

    for (const e of entries) {
        const { head, english, rawSpecs } = split(e.description_ar || '');
        if (!english && !HAS_LATIN.test(rawSpecs)) { stats.alreadyArabic++; continue; }

        let arCopy = '';
        if (english) {
            arCopy = DESC.lookup(english) || '';
            if (!arCopy) {
                const k = DESC.norm(english).slice(0, 80);
                stats.untranslated.set(k, (stats.untranslated.get(k) || 0) + 1);
                continue;   // never half-translate: leave it and report
            }
        } else stats.noBlurb++;

        const specLines = arabicSpecs(parseSpecs(rawSpecs), stats);
        const description_ar = [
            ...headFor(head, Boolean(arCopy)),
            arCopy,
            specLines.length ? `${SPEC_HEADER}\n${specLines.join('\n')}` : '',
        ].filter(Boolean).join('\n\n');

        const subtitle_ar = arCopy ? firstSentence(arCopy) : e.subtitle_ar;

        if (shown++ < 2) {
            console.log(`\n--- ${e.title_ar}`);
            console.log(subtitle_ar);
            console.log(description_ar.split('\n').slice(0, 14).join('\n'));
        }

        stats.rewritten++;
        ops.push({ updateOne: { filter: { _id: e._id }, update: { $set: { description_ar, subtitle_ar, updated_at: new Date() } } } });
    }

    console.log(`\n--- Summary ---`);
    console.log(`To rewrite            : ${stats.rewritten}`);
    console.log(`Already Arabic        : ${stats.alreadyArabic}`);
    console.log(`No English copy       : ${stats.noBlurb}`);
    console.log(`Prop 65 / junk specs dropped: ${stats.specsDropped}`);
    if (stats.unknownSpecKeys.size) {
        console.log(`Spec keys with no translation (${stats.unknownSpecKeys.size}):`);
        [...stats.unknownSpecKeys].slice(0, 15).forEach((k) => console.log(`  ${k}`));
    }
    if (stats.latinValues.size) {
        console.log(`\nSpec VALUES still containing English (${stats.latinValues.size} distinct):`);
        [...stats.latinValues.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
            .forEach(([k, n]) => console.log(`  x${n}  ${k.slice(0, 90)}`));
    }
    if (stats.untranslated.size) {
        console.log(`\nEnglish paragraphs with no translation (${stats.untranslated.size}) — add to boschDescriptionsAr.js:`);
        [...stats.untranslated.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
            .forEach(([k, n]) => console.log(`  x${n}  ${k}…`));
    }

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
