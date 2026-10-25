#!/usr/bin/env node
/* ------------------ Import the scraped catalogs into CatalogEntry ------------------
 *
 *   node scripts/importScrapedCatalog.js              # dry run, writes nothing
 *   node scripts/importScrapedCatalog.js --apply      # writes
 *   node scripts/importScrapedCatalog.js --only=ago   # one source at a time
 *
 * Sources (mounted at --data, default /data):
 *   /data/data/products.csv                       agopartspro — 153 Arabic hoses
 *   /data/bosch/data/final_products.json.gz       Bosch — 37,668 parts + fitment
 *
 * Neither source publishes a category, an Arabic name (Bosch) or an English one
 * (agopartspro), and `category_id` plus a title are the only fields CatalogEntry
 * actually requires. Everything the sources do not carry is derived here, from
 * the mapping in ./catalogImportMap.js — never invented per-row.
 *
 * Idempotency: an entry is skipped when one already exists with the same
 * (part_number, title_en). Re-running after a partial failure resumes safely.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { CatalogEntry } = require('../models/catalogEntries');
const { Category } = require('../models/categories');
const { Brand } = require('../models/product_brands');
const { CarBrand } = require('../models/car_brands');
const MAP = require('./catalogImportMap');
const AGO_TITLES = require('./agoTitlesEn');
const BOSCH_DESC = require('./boschDescriptionsAr');
const BOSCH_LINE_IMAGES = require('./boschLineImages.json');
const { KEYS: SPEC_AR, VALUES: SPEC_VAL_AR, DROP: SPEC_DROP } = require('./boschSpecsAr');

const APPLY = process.argv.includes('--apply');
const DATA = (process.argv.find((a) => a.startsWith('--data=')) || '--data=/data').split('=')[1];
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '--only=all').split('=')[1];
// --sample=N prints N built documents instead of a count, for eyeballing a dry run.
const SAMPLE = Number((process.argv.find((a) => a.startsWith('--sample=')) || '--sample=0').split('=')[1]);

const IMG_BASE = (process.env.BACKEND_PUBLIC_URL || 'https://readycar.store').replace(/\/+$/, '');
const BATCH = 500;

const norm = (s) => (s || '').toString().toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim();

/* ------------------ Bosch helpers ------------------ */

// The category field collapses 4,162 parts into "Home" and 346 into "Products";
// the product line is specific for every row, so it is the primary key.
function lineKeyOf(p) {
    const pl = (p.product_line || '').trim();
    if (pl && !['products', 'home'].includes(pl.toLowerCase())) return pl;
    return (p.name || '').replace(/\s*\([^()]*\)\s*$/, '').trim();
}

function classifyBosch(p, stats) {
    const line = lineKeyOf(p);
    let hit = MAP.LINE_MAP[line.toLowerCase()];
    if (hit) { stats.byLine++; return { ...hit, line }; }

    for (const [re, val] of MAP.LINE_PATTERNS) {
        if (re.test(line)) { stats.byPattern++; return { ...val, line }; }
    }
    hit = MAP.CATEGORY_MAP[(p.category || '').toLowerCase()];
    if (hit) { stats.byCategory++; return { ...hit, line }; }

    stats.unmapped.set(line, (stats.unmapped.get(line) || 0) + 1);
    return null;
}

function expandYears(range) {
    const m = /^(\d{4})(?:\s*-\s*(\d{4}))?$/.exec((range || '').trim());
    if (!m) return [];
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (to < from || to - from > 60) return [];
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/* Bosch fitment rows -> compatible_cars, keeping only cars this catalog knows.
   A make with no matching model still becomes a brand-level entry: "fits this
   make, model unlisted" is true, while inventing the model would not be. */
function buildCompatibility(rows, carIndex, stats) {
    const brands = new Map();
    for (const row of rows || []) {
        const brand = carIndex.get(norm(MAP.MAKE_ALIASES[norm(row.make)] || row.make));
        if (!brand) { stats.makeMiss.set(row.make, (stats.makeMiss.get(row.make) || 0) + 1); continue; }

        if (!brands.has(brand.id)) {
            brands.set(brand.id, { brand_id: brand._id, brand_name: brand.name, models: new Map(), all_models: false });
        }
        const bucket = brands.get(brand.id);
        const model = brand.models.get(norm(row.model));
        if (!model) { stats.modelMiss++; continue; }
        stats.modelHit++;

        if (!bucket.models.has(model.id)) {
            bucket.models.set(model.id, { model_id: model._id, model_name: model.name, years: new Set(), all_years: false });
        }
        const mb = bucket.models.get(model.id);
        for (const y of expandYears(row.years)) mb.years.add(y);
    }

    return [...brands.values()].map((b) => ({
        brand_id: b.brand_id,
        brand_name: b.brand_name,
        all_models: false,
        models: [...b.models.values()].map((m) => {
            const years = [...m.years].sort((a, z) => a - z);
            // A fitment spanning more than 15 model years is a "fits every year"
            // statement in practice; storing 40 integers per model is not useful.
            return years.length > 15
                ? { model_id: m.model_id, model_name: m.model_name, years: [], all_years: true }
                : { model_id: m.model_id, model_name: m.model_name, years, all_years: false };
        }),
    })).filter((b) => b.models.length > 0);
}

// Cut on a word boundary — a subtitle ending "common with low" reads as broken text.
function clip(s, max) {
    if (s.length <= max) return s;
    const cut = s.slice(0, max);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).trimEnd()}…`;
}

function specsToText(specs) {
    if (!specs || typeof specs !== 'object') return '';
    return Object.entries(specs).filter(([, v]) => v != null && `${v}`.trim()).map(([k, v]) => `${k}: ${v}`).join('\n');
}

const LB_TO_KG = 0.45359237;

/* The same spec block in Arabic: labels translated, low-cardinality values
   translated, pounds converted to kilograms, and the California Prop 65 notices
   omitted — they are a US legal requirement with no meaning for a buyer here. */
function specsToArabic(specs, stats) {
    if (!specs || typeof specs !== 'object') return '';
    const lines = [];
    for (const [k, raw] of Object.entries(specs)) {
        if (raw == null || !`${raw}`.trim()) continue;
        if (SPEC_DROP.has(k)) continue;
        const label = SPEC_AR[k];
        if (!label) { stats.unknownSpecKeys.add(k); continue; }
        const v = `${raw}`.trim();
        let value = SPEC_VAL_AR[v];
        if (!value) {
            const n = k === 'Automotive Item Weight (lbs)' ? parseFloat(v) : NaN;
            value = Number.isFinite(n)
                ? `${(n * LB_TO_KG).toFixed(2)} كجم`
                : v.replace(/\s+(in|inch|inches|mm|lb|lbs)\.?$/i, '').trim();
        }
        if (value) lines.push(`${label}: ${value}`);
    }
    return lines.join('\n');
}

function buildBoschEntry(p, cls, brandId, carIndex, stats) {
    const pn = (p.part_number || '').trim();
    const base = (p.name || '').replace(/\s*\([^()]*\)\s*$/, '').trim() || cls.line;
    const specs = specsToText(p.specifications);

    const compatible_cars = buildCompatibility(p.compatibility, carIndex, stats);

    // Bosch has no photograph for 52% of its catalogue; for those its API returns
    // a default endpoint serving a grey "no image" icon, which the scrape stored
    // as image.png. Pointing an entry at that makes "no photo" look like a photo,
    // so those parts take their product LINE's real photo instead (resolved into
    // boschLineImages.json), or none at all.
    const isPlaceholder = /(^|\/)image\.png$/.test(p.local_image || '');
    const familyImage = isPlaceholder ? BOSCH_LINE_IMAGES[pn] : null;
    if (isPlaceholder && !familyImage) stats.noImage++;

    const images = familyImage
        ? [{ url: `${IMG_BASE}/uploads/${familyImage}`, is_primary: true }]
        : (p.local_image && !isPlaceholder)
            ? [{ url: `${IMG_BASE}/uploads/catalog/bosch/${path.basename(p.local_image)}`, is_primary: true }]
            : [];

    const descEn = [
        (p.description || p.short_description || '').trim(),
        specs && `Specifications:\n${specs}`,
        pn && `Bosch part number: ${pn}`,
    ].filter(Boolean).join('\n\n');

    // Bosch publishes no Arabic at all. The copy is per product LINE, so the 134
    // distinct paragraphs are translated once in ./boschDescriptionsAr.js rather
    // than pasted in English into an Arabic field.
    const copyAr = BOSCH_DESC.lookup(p.short_description);
    if (p.short_description && !copyAr) stats.untranslatedCopy.add(BOSCH_DESC.norm(p.short_description).slice(0, 80));
    const specsAr = specsToArabic(p.specifications, stats);

    const descAr = [
        `${cls.ar} من بوش (Bosch)${pn ? ` — رقم القطعة ${pn}` : ''}.`,
        copyAr || 'قطعة بمواصفات المُصنّع الأصلي، مصمّمة لأداء ثابت وعمر تشغيلي أطول وتركيب مطابق.',
        specsAr && `المواصفات الفنية:\n${specsAr}`,
    ].filter(Boolean).join('\n\n');

    return {
        title_en: `Bosch ${base}${pn ? ` ${pn}` : ''}`.replace(/\s+/g, ' ').trim(),
        title_ar: `${cls.ar} بوش${pn ? ` ${pn}` : ''}`.trim(),
        subtitle_en: clip((p.short_description || '').trim().replace(/\s+/g, ' '), 200),
        subtitle_ar: copyAr ? clip(copyAr.split(/(?<=\.)\s/)[0].trim(), 180) : `${cls.ar} — قطعة غيار Bosch`,
        description_en: descEn,
        description_ar: descAr,
        category_id: new mongoose.Types.ObjectId(cls.cat),
        product_brand_id: brandId,
        part_number: pn,
        gtin: '',
        images,
        is_universal: compatible_cars.length === 0,
        compatible_cars,
        variation_types: [],
        status: 'approved',
        created_by_role: 'admin',
        created_at: new Date(),
        updated_at: new Date(),
    };
}

/* ------------------ agopartspro helpers ------------------ */

// Minimal RFC-4180 reader: the file has quoted fields containing commas.
function readCsv(file) {
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
            else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c !== '\r') field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    const header = rows.shift();
    return rows.filter((r) => r.length === header.length)
        .map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i]])));
}

function classifyAgo(name) {
    for (const [re, val] of MAP.AGO_NAME_RULES) if (re.test((name || '').trim())) return val;
    return MAP.AGO_DEFAULT;
}

function buildAgoEntry(r, brandId, carIndex, stats) {
    const name = (r.product_name || '').trim();
    const cls = classifyAgo(name);
    const code = (r.product_code || '').trim();
    const page = (r.model || '').trim();

    const compatible_cars = [];
    for (const [brandName, modelName] of MAP.AGO_MODEL_MAP[page] || []) {
        const brand = carIndex.get(norm(brandName));
        if (!brand) { stats.makeMiss.set(brandName, (stats.makeMiss.get(brandName) || 0) + 1); continue; }
        const model = modelName ? brand.models.get(norm(modelName)) : null;
        if (modelName && !model) { stats.modelMiss++; stats.agoModelMiss.add(`${page} → ${brandName}/${modelName}`); }
        compatible_cars.push({
            brand_id: brand._id,
            brand_name: brand.name,
            all_models: false,
            models: model ? [{ model_id: model._id, model_name: model.name, years: [], all_years: true }] : [],
        });
        if (model) stats.modelHit++;
    }
    // A brand with no models resolved carries no fitment information the UI can
    // filter on, so the entry stays universal rather than pretending otherwise.
    const specific = compatible_cars.some((c) => c.models.length > 0);

    const ext = path.extname(r.local_image || '') || '.jpg';
    const images = r.local_image
        ? [{ url: `${IMG_BASE}/uploads/catalog/ago/${r.model_page_id}-${code || r.media_id}${ext}`, is_primary: true }]
        : [];

    const carsList = (MAP.AGO_MODEL_MAP[page] || []).map(([b, m]) => (m ? `${b} ${m}` : b));
    const carsAr = carsList.join('، ');
    const carsEn = carsList.join(', ');   // English comma; carsAr keeps the Arabic one

    // The Arabic name is the only name the source publishes and it is a real
    // description (position, shape, circuit, car). Translations live in
    // ./agoTitlesEn.js; a name with no entry there is reported, never papered
    // over with a generated stand-in like "AGO Hose 127".
    const titleEn = AGO_TITLES[name];
    if (!titleEn) stats.untranslated.add(name);

    return {
        title_ar: name,
        title_en: titleEn || `AGO ${cls.en}${code ? ` ${code}` : ''}`,
        subtitle_ar: `${cls.ar} — ${page}`,
        subtitle_en: carsEn ? `Fits ${carsEn}` : 'AGO Parts Pro',
        description_ar: [
            `${name}.`,
            carsAr && `يركب على: ${carsAr}.`,
            code && `كود القطعة: ${code}.`,
            'من إنتاج AGO Parts Pro.',
        ].filter(Boolean).join('\n'),
        description_en: [
            `${titleEn || cls.en}, manufactured by AGO Parts Pro.`,
            carsEn && `Fits: ${carsEn}.`,
            code && `Part code: ${code}.`,
        ].filter(Boolean).join('\n'),
        category_id: new mongoose.Types.ObjectId(cls.cat),
        product_brand_id: brandId,
        part_number: code,
        gtin: '',
        images,
        is_universal: !specific,
        compatible_cars: specific ? compatible_cars.filter((c) => c.models.length > 0) : [],
        variation_types: [],
        status: 'approved',
        created_by_role: 'admin',
        created_at: new Date(),
        updated_at: new Date(),
    };
}

/* ------------------ main ------------------ */

async function insertAll(docs, label) {
    let written = 0, failed = 0;
    for (let i = 0; i < docs.length; i += BATCH) {
        const slice = docs.slice(i, i + BATCH);
        try {
            const res = await CatalogEntry.insertMany(slice, { ordered: false });
            written += res.length;
        } catch (err) {
            written += err.insertedDocs?.length || err.result?.insertedCount || 0;
            const errs = err.writeErrors || [];
            failed += errs.length;
            for (const e of errs.slice(0, 5)) console.error(`  FAILED ${label}: ${e.errmsg || e.err?.errmsg}`);
        }
        process.stdout.write(`\r  ${label}: ${written}/${docs.length} written`);
    }
    process.stdout.write('\n');
    return { written, failed };
}

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`Database: ${process.env.MONGO_URI.replace(/\/\/[^@]*@/, '//***@')}`);
    console.log(`MODE: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (nothing will be written)'}\n`);

    /* Every category id in the map must exist, or entries land in a category the
       storefront cannot render. Fail before writing a single row. */
    const wanted = [...new Set(Object.values(MAP.CAT))];
    const found = await Category.find({ _id: { $in: wanted } }, { name: 1, name_ar: 1 }).lean();
    if (found.length !== wanted.length) {
        const have = new Set(found.map((c) => c._id.toString()));
        console.error('Missing categories:', wanted.filter((id) => !have.has(id)).join(', '));
        process.exit(1);
    }
    console.log(`Categories resolved: ${found.length}/${wanted.length}`);

    /* Brands. Bosch already exists; AGO Parts Pro does not and is created here. */
    let bosch = await Brand.findOne({ name: 'bosch' });
    let ago = await Brand.findOne({ name: 'ago parts pro' });
    if (!ago) {
        if (APPLY) { ago = await Brand.create({ name: 'ago parts pro' }); console.log('Created product brand "ago parts pro".'); }
        else console.log('Would create product brand "ago parts pro".');
    }
    console.log(`Brands: bosch=${bosch ? 'ok' : 'MISSING'} ago=${ago ? 'ok' : '(pending)'}`);

    /* Car brand + model index for compatibility resolution. */
    const carIndex = new Map();
    for (const b of await CarBrand.find({}, { name: 1, models: 1 }).lean()) {
        const models = new Map();
        for (const m of b.models || []) models.set(norm(m.name), { _id: m._id, id: m._id.toString(), name: m.name });
        carIndex.set(norm(b.name), { _id: b._id, id: b._id.toString(), name: b.name, models });
    }
    console.log(`Car brands indexed: ${carIndex.size}\n`);

    /* Existing entries, for idempotency.
       A handful of Bosch rows are keyed by an internal UUID rather than a part
       number; those were later cleaned up in place (UUID stripped from both the
       part number and the title), so the raw key computed from the scrape no
       longer matches them. Indexing the cleaned form as well keeps a re-run from
       inserting 122 duplicates. */
    const UUID = /\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\s*/;
    const dedupeKeys = (pn, title) => {
        const keys = [`${pn || ''}|${title || ''}`];
        if (UUID.test(pn || '')) keys.push(`|${(title || '').replace(UUID, ' ').replace(/\s+/g, ' ').trim()}`);
        return keys;
    };
    const existing = new Set();
    for (const e of await CatalogEntry.find({}, { part_number: 1, title_en: 1 }).lean()) {
        existing.add(`${e.part_number || ''}|${e.title_en || ''}`);
    }
    console.log(`Catalog entries already present: ${existing.size}\n`);

    const stats = {
        byLine: 0, byPattern: 0, byCategory: 0, unmapped: new Map(),
        makeMiss: new Map(), modelMiss: 0, modelHit: 0, agoModelMiss: new Set(), untranslated: new Set(),
        untranslatedCopy: new Set(), unknownSpecKeys: new Set(), noImage: 0,
    };
    const totals = {};

    /* ---- agopartspro ---- */
    if (ONLY === 'all' || ONLY === 'ago') {
        const rows = readCsv(path.join(DATA, 'data', 'products.csv'));
        const cards = rows.filter((r) => r.is_product_card === 'True');
        const docs = [];
        let dup = 0;
        for (const r of cards) {
            const d = buildAgoEntry(r, ago?._id || null, carIndex, stats);
            if (existing.has(`${d.part_number}|${d.title_en}`)) { dup++; continue; }
            docs.push(d);
        }
        console.log(`agopartspro : ${rows.length} rows, ${rows.length - cards.length} banner skipped, ${dup} already present, ${docs.length} to insert`);
        if (SAMPLE) docs.slice(0, SAMPLE).forEach((d) => console.log(JSON.stringify(d, null, 1)));
        totals.ago = docs.length;
        if (APPLY && docs.length) Object.assign(totals, { agoResult: await insertAll(docs, 'ago') });
    }

    /* ---- Bosch ---- */
    if (ONLY === 'all' || ONLY === 'bosch') {
        const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DATA, 'bosch', 'data', 'final_products.json.gz'))));
        const prods = raw.products || [];
        const docs = [];
        let dup = 0, skipped = 0;
        for (const p of prods) {
            const cls = classifyBosch(p, stats);
            if (!cls) { skipped++; continue; }
            const d = buildBoschEntry(p, cls, bosch?._id || null, carIndex, stats);
            const keys = dedupeKeys(d.part_number, d.title_en);
            if (keys.some((k) => existing.has(k))) { dup++; continue; }
            keys.forEach((k) => existing.add(k));
            docs.push(d);
        }
        console.log(`\nBosch       : ${prods.length} parts, ${dup} already present, ${skipped} unclassifiable, ${docs.length} to insert`);
        console.log(`  classified by line=${stats.byLine} pattern=${stats.byPattern} category=${stats.byCategory}`);
        if (SAMPLE) docs.filter((d) => d.compatible_cars.length).slice(0, SAMPLE).forEach((d) => console.log(JSON.stringify(d, null, 1)));
        totals.bosch = docs.length;
        if (APPLY && docs.length) Object.assign(totals, { boschResult: await insertAll(docs, 'bosch') });
    }

    /* ---- report ---- */
    console.log('\n--- Coverage ---');
    if (stats.unmapped.size) {
        console.log(`Unmapped product lines (${stats.unmapped.size}) — these rows were NOT imported:`);
        [...stats.unmapped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
            .forEach(([k, n]) => console.log(`  ${String(n).padStart(6)}  ${k}`));
    } else console.log('Unmapped product lines: none — every part got a category.');

    if (stats.noImage) console.log(`Parts Bosch never photographed, left with no image: ${stats.noImage}`);
    console.log(`Fitment rows matched to a known car model : ${stats.modelHit}`);
    console.log(`Fitment rows dropped (model not in carbrands): ${stats.modelMiss}`);
    if (stats.makeMiss.size) {
        const top = [...stats.makeMiss.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
        console.log(`Makes not in carbrands (${stats.makeMiss.size}): ${top.map(([k, n]) => `${k}(${n})`).join(', ')}`);
    }
    if (stats.untranslatedCopy.size) {
        console.log(`\nBosch paragraphs with no Arabic translation (${stats.untranslatedCopy.size}) — add to boschDescriptionsAr.js:`);
        [...stats.untranslatedCopy].slice(0, 10).forEach((n) => console.log(`  ${n}…`));
    }
    if (stats.unknownSpecKeys.size) {
        console.log(`\nSpec keys with no Arabic label (${stats.unknownSpecKeys.size}) — add to boschSpecsAr.js:`);
        [...stats.unknownSpecKeys].slice(0, 10).forEach((n) => console.log(`  ${n}`));
    }
    if (stats.untranslated.size) {
        console.log(`\nArabic names with no English translation in agoTitlesEn.js (${stats.untranslated.size}) — add them there:`);
        [...stats.untranslated].forEach((n) => console.log(`  ${n}`));
    }
    if (stats.agoModelMiss.size) {
        console.log('agopartspro pages whose model is not in carbrands:');
        [...stats.agoModelMiss].forEach((s) => console.log(`  ${s}`));
    }

    if (!APPLY) console.log('\nDry run — nothing was written. Re-run with --apply.');
    else console.log(`\nDone. Catalog entries now: ${await CatalogEntry.countDocuments()}`);

    await mongoose.disconnect();
})().catch((err) => { console.error(err); process.exit(1); });
