/**
 * Catalog link suggestions for the admin — the matcher (services/matching/catalogMatcher.js)
 * kept warm, and the questions the admin screens ask of it:
 *
 *   matchProducts(ids)    which entry each of these products is (the unlinked worklist, the
 *                         product page's catalog panel)
 *   similarForEntries(ids) which entries each suggestion may duplicate (the suggestions tab)
 *   reviewLinks()         products linked to an entry they do not read like (a wrong link)
 *
 * The matcher reads the whole catalog into memory — 38,000 entries, a few seconds — so it is
 * built once and rebuilt in the background when it is ten minutes old or the catalog changed.
 * A request never waits for a rebuild once one matcher exists; the entries it returns are
 * re-read from the database, so one merged or archived a moment ago is never proposed.
 */

const mongoose = require('mongoose');
const { CatalogEntry } = require('../models/catalogEntries');
const { Product } = require('../models/products');
const { Brand } = require('../models/product_brands');
const { Category } = require('../models/categories');
const { CarBrand } = require('../models/car_brands');
const { buildCatalogMatcherAsync, levelOf } = require('./matching/catalogMatcher');

const MAX_AGE_MS = 10 * 60 * 1000;
const MAX_BATCH = 100;
const SELECTABLE = ['approved', 'suggested'];

const ENTRY_FIELDS = 'title_en title_ar subtitle_en subtitle_ar part_number gtin category_id product_brand_id product_brand_source '
    + 'is_universal compatible_cars status created_by_vendor_id source_product_id images';
const PRODUCT_FIELDS = 'title_en title_ar subtitle_en subtitle_ar part_number gtin sku category_id product_brand_id product_brand_source '
    + 'is_universal compatible_cars vendor_id catalog_entry_id';

let current = null;
let builtAt = 0;
let building = null;
let stale = false;

const build = async () => {
    const [entries, brands, categories, carBrands] = await Promise.all([
        CatalogEntry.find({ status: { $in: SELECTABLE } }).select(ENTRY_FIELDS).lean(),
        Brand.find().select('name').lean(),
        Category.find().select('parent_id').lean(),
        CarBrand.find().select('name models').lean(),
    ]);
    return buildCatalogMatcherAsync({ entries, brands, categories, carBrands });
};

const refresh = () => {
    if (!building) {
        building = build()
            .then((m) => { current = m; builtAt = Date.now(); stale = false; return m; })
            .catch((err) => { console.error('[CatalogMatch] Could not build the matcher:', err.message); throw err; })
            .finally(() => { building = null; });
    }
    return building;
};

/** The matcher: the one in memory, refreshed behind the request when it is old. */
const getMatcher = async () => {
    if (!current) return refresh();
    if (stale || Date.now() - builtAt > MAX_AGE_MS) refresh().catch(() => {});
    return current;
};

/** The catalog changed: the next request rebuilds in the background. */
const invalidateCatalogMatcher = () => { stale = true; };

const ids = (list) => [...new Set((Array.isArray(list) ? list : []).map(String))]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .slice(0, MAX_BATCH);

/**
 * The entries in `results` as they are now: still selectable, with their brand and how many
 * products carry each. A result whose entry was merged, archived or rejected since the matcher
 * was built is dropped.
 */
const freshen = async (resultsById) => {
    const entryIds = [...new Set(Object.values(resultsById).flat().map((r) => String(r.entry._id)))];
    if (!entryIds.length) return resultsById;
    const [live, counts] = await Promise.all([
        CatalogEntry.find({ _id: { $in: entryIds }, status: { $in: SELECTABLE } })
            .select('title_en title_ar part_number status images category_id product_brand_id product_brand_source')
            .populate('category_id', 'name name_ar')
            .populate('product_brand_id', 'name')
            .lean(),
        Product.aggregate([
            { $match: { catalog_entry_id: { $in: entryIds.map((id) => new mongoose.Types.ObjectId(id)) } } },
            { $group: { _id: '$catalog_entry_id', count: { $sum: 1 } } },
        ]),
    ]);
    const byId = new Map(live.map((e) => [String(e._id), e]));
    const countOf = new Map(counts.map((c) => [String(c._id), c.count]));
    const out = {};
    for (const [key, results] of Object.entries(resultsById)) {
        out[key] = results
            .filter((r) => byId.has(String(r.entry._id)))
            .map((r) => ({
                ...byId.get(String(r.entry._id)),
                product_count: countOf.get(String(r.entry._id)) || 0,
                similarity: r.score,
                level: r.level,
                reasons: r.reasons,
            }));
    }
    return out;
};

/**
 * The entries each product most likely is: { productId: [entry + similarity, level, reasons] }.
 * A product's own entry (it is linked already, or its suggestion) is never proposed to it.
 */
const matchProducts = async (productIds, { limit = 3 } = {}) => {
    const list = ids(productIds);
    if (!list.length) return {};
    const [matcher, products, ownSuggestions] = await Promise.all([
        getMatcher(),
        Product.find({ _id: { $in: list } }).select(PRODUCT_FIELDS).lean(),
        CatalogEntry.find({ source_product_id: { $in: list } }).select('_id source_product_id').lean(),
    ]);
    const own = new Map();
    for (const e of ownSuggestions) own.set(String(e.source_product_id), [...(own.get(String(e.source_product_id)) || []), String(e._id)]);
    const results = {};
    for (const p of products) {
        const exclude = [...(own.get(String(p._id)) || []), ...(p.catalog_entry_id ? [String(p.catalog_entry_id)] : [])];
        results[String(p._id)] = matcher.match(p, { limit, exclude });
    }
    return freshen(results);
};

/**
 * The entries each suggestion may duplicate — the merge candidates on the suggestions tab.
 * Same shape as `findSimilarForEntries` always had, plus `level` and `reasons`.
 */
const similarForEntries = async (entryIds, { limit = 5 } = {}) => {
    const list = ids(entryIds);
    if (!list.length) return {};
    const [matcher, entries] = await Promise.all([
        getMatcher(),
        CatalogEntry.find({ _id: { $in: list } }).select(ENTRY_FIELDS).lean(),
    ]);
    const results = {};
    for (const e of entries) results[String(e._id)] = matcher.match(e, { limit, exclude: [String(e._id)] });
    for (const id of list) results[id] = results[id] || [];
    return freshen(results);
};

/**
 * Products linked to an entry they do not read like: another brand, another car, front
 * against rear — or simply nothing in common. A suggestion minted from the product itself is
 * its own description and is never questioned. The admin's "keep" (`catalog_link_checked_at`)
 * takes a link off the list until it changes.
 */
const reviewLinks = async ({ page = 1, limit = 20 } = {}) => {
    const matcher = await getMatcher();
    const linked = await Product.find({ catalog_entry_id: { $ne: null } })
        .select(`${PRODUCT_FIELDS} catalog_link_checked_at status images price`)
        .lean();
    const entryIds = [...new Set(linked.map((p) => String(p.catalog_entry_id)))];
    const entries = await CatalogEntry.find({ _id: { $in: entryIds } }).select(`${ENTRY_FIELDS} updated_at`).lean();
    const byId = new Map(entries.map((e) => [String(e._id), e]));

    const flagged = [];
    for (const p of linked) {
        const e = byId.get(String(p.catalog_entry_id));
        if (!e || String(e.source_product_id || '') === String(p._id)) continue;
        if (p.catalog_link_checked_at && (!e.updated_at || new Date(e.updated_at) <= new Date(p.catalog_link_checked_at))) continue;
        const verdict = matcher.check(p, e);
        if (!verdict.conflicts.length && verdict.level) continue;
        flagged.push({ product: p, entry: e, verdict });
    }
    // The links with a contradiction first, the merely weak after.
    flagged.sort((a, b) => (b.verdict.conflicts.length > 0) - (a.verdict.conflicts.length > 0) || a.verdict.score - b.verdict.score);

    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);
    const slice = flagged.slice((safePage - 1) * safeLimit, safePage * safeLimit);

    const vendorIds = [...new Set(slice.map((f) => String(f.product.vendor_id)))];
    const vendors = vendorIds.length ? await mongoose.model('Seller').find({ _id: { $in: vendorIds } }).select('store_name').lean() : [];
    const vendorName = new Map(vendors.map((v) => [String(v._id), v.store_name]));

    return {
        links: slice.map(({ product, entry, verdict }) => ({
            product: {
                _id: product._id, title_ar: product.title_ar, title_en: product.title_en, part_number: product.part_number,
                sku: product.sku, status: product.status, images: (product.images || []).slice(0, 1),
                vendor: { _id: product.vendor_id, store_name: vendorName.get(String(product.vendor_id)) || null },
            },
            entry: {
                _id: entry._id, title_ar: entry.title_ar, title_en: entry.title_en, part_number: entry.part_number,
                status: entry.status, images: (entry.images || []).slice(0, 1),
            },
            score: verdict.score,
            level: verdict.level,
            conflicts: verdict.conflicts,
            reasons: verdict.reasons,
        })),
        total: flagged.length,
        pagination: { total: flagged.length, page: safePage, pages: Math.max(1, Math.ceil(flagged.length / safeLimit)), limit: safeLimit },
    };
};

/** The admin looked at a flagged link and it is right: off the list until the entry changes. */
const keepLink = async (productId) => {
    if (!mongoose.Types.ObjectId.isValid(String(productId))) throw new Error('Product not found');
    const res = await Product.updateOne({ _id: productId, catalog_entry_id: { $ne: null } }, { $set: { catalog_link_checked_at: new Date() } });
    if (!res.matchedCount) throw new Error('This product is not linked to a catalog entry.');
    return { product_id: productId };
};

/**
 * The unlinked worklist's products that have a proposal at or above `level`, best first —
 * so the admin can clear the sure ones in one sitting.
 */
const rankWithProposals = async (products, { min = 'likely' } = {}) => {
    const matcher = await getMatcher();
    const floor = { strong: 0.72, likely: 0.55, possible: 0.4 }[min] ?? 0.55;
    const own = await CatalogEntry.find({ source_product_id: { $in: products.map((p) => p._id) } }).select('_id source_product_id').lean();
    const ownOf = new Map(own.map((e) => [String(e.source_product_id), String(e._id)]));
    return products
        .map((p) => ({ p, best: matcher.match(p, { limit: 1, exclude: ownOf.has(String(p._id)) ? [ownOf.get(String(p._id))] : [] })[0] }))
        .filter((x) => x.best && x.best.score >= floor)
        .sort((a, b) => b.best.score - a.best.score)
        .map((x) => x.p);
};

module.exports = {
    getMatcher,
    invalidateCatalogMatcher,
    matchProducts,
    similarForEntries,
    reviewLinks,
    keepLink,
    rankWithProposals,
    levelOf,
    PRODUCT_FIELDS,
};
