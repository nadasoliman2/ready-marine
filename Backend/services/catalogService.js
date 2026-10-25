const mongoose = require('mongoose');
const { CatalogEntry } = require('../models/catalogEntries');
const { Product } = require('../models/products');
const { Brand } = require('../models/product_brands');
const { Category } = require('../models/categories');
require('../models/categories');
require('../models/product_brands');
require('../models/sellers');

/**
 * Master catalog — the platform's product-identity layer.
 *
 * Two rules govern everything in this file:
 *
 *  1. The catalog PRE-FILLS, it does not GOVERN. Entry data is copied onto a
 *     vendor product once, at creation. No later edit to an entry propagates.
 *  2. The link is invisible to vendors. Nothing here returns a link flag to a
 *     vendor-facing payload beyond "you already have a product on this entry",
 *     which exists only to stop them creating a second one.
 */

/* Fields that come from the entry when a vendor picks one. Everything else on a
   product (price, discount, stock, SKU, publish status) belongs to the vendor. */
const CATALOG_OWNED_FIELDS = [
    'title_en', 'title_ar',
    'subtitle_en', 'subtitle_ar',
    'description_en', 'description_ar',
    'category_id', 'product_brand_id',
    'part_number', 'gtin',
    'images',
    'is_universal', 'compatible_cars',
    'variation_types',
];

const entryListPopulate = 'category_id product_brand_id';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toPlain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

/** The catalog changed: the link-suggestion matcher reads it again on its next use. */
const catalogChanged = () => require('./catalogMatchService').invalidateCatalogMatcher();

const isValidId = (value) => !!value && mongoose.Types.ObjectId.isValid(String(value));
// Aggregation `$match` compares by type: a string id never equals a stored ObjectId.
const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

/** Part numbers differ only by punctuation far more often than by content. */
const normalizeCode = (value) => String(value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/* ─────────────────────────────────────────────────────────────
   Prefill — turning an entry into product fields
   ───────────────────────────────────────────────────────────── */

/**
 * The catalog-owned half of a product payload, taken from `entry`.
 * Sub-document _ids are dropped so Mongoose mints fresh ones on the product —
 * the copy is the vendor's own, not a shared reference.
 */
const buildPrefillFromEntry = (entry) => {
    const src = toPlain(entry);
    if (!src) return {};

    return {
        title_en: src.title_en || '',
        title_ar: src.title_ar || '',
        subtitle_en: src.subtitle_en || '',
        subtitle_ar: src.subtitle_ar || '',
        description_en: src.description_en || '',
        description_ar: src.description_ar || '',
        category_id: src.category_id?._id ? String(src.category_id._id) : (src.category_id ? String(src.category_id) : ''),
        product_brand_id: src.product_brand_id?._id ? String(src.product_brand_id._id) : (src.product_brand_id ? String(src.product_brand_id) : ''),
        part_number: src.part_number || '',
        gtin: src.gtin || '',
        images: (src.images || []).map((img) => ({ url: img.url, is_primary: !!img.is_primary })),
        is_universal: src.is_universal !== false,
        compatible_cars: JSON.parse(JSON.stringify(src.compatible_cars || [])),
        variation_types: (src.variation_types || []).map((vt) => ({
            name: vt.name,
            options: (vt.options || []).map((o) => ({ value: o.value })),
        })),
    };
};

/**
 * Fill only the gaps in `data` from `entry` — used by the Excel path, where a
 * vendor may upload a file carrying nothing but SKU, price and stock and expect
 * the catalog to cover the rest. Anything the vendor did write wins.
 */
const fillMissingFromEntry = (data, entry) => {
    const prefill = buildPrefillFromEntry(entry);
    const out = { ...data };

    const isBlank = (v) => v === undefined || v === null || v === '' ||
        (Array.isArray(v) && v.length === 0);

    for (const field of CATALOG_OWNED_FIELDS) {
        // `is_universal` is a tri-state on an uploaded row (true/false/null =
        // "the cell was empty"), so only a genuine null takes the entry's value.
        if (field === 'is_universal') {
            if (out.is_universal === null || out.is_universal === undefined) {
                out.is_universal = prefill.is_universal;
                if (isBlank(out.compatible_cars)) out.compatible_cars = prefill.compatible_cars;
            }
            continue;
        }
        // Compatible cars only travel with a compatibility decision, handled above.
        if (field === 'compatible_cars') {
            if (out.is_universal === false && isBlank(out.compatible_cars) && prefill.compatible_cars.length) {
                out.compatible_cars = prefill.compatible_cars;
            }
            continue;
        }
        if (isBlank(out[field]) && !isBlank(prefill[field])) out[field] = prefill[field];
    }

    return out;
};

/* ─────────────────────────────────────────────────────────────
   Vendor-facing search (the gate in front of every add path)
   ───────────────────────────────────────────────────────────── */

/**
 * Search the catalog for a vendor.
 *
 * Approved AND suggested entries are returned — suggestions surface so a second
 * vendor finds the product a first vendor just added, which is the only thing
 * suppressing duplicates at the source. Archived and merged entries never appear:
 * archiving blocks new selections, it does not break old ones.
 *
 * Each result carries `vendor_product_id` when this vendor already has a product
 * on the entry, so the UI can offer "Open your product" instead of "Select".
 */
/* ─────────────────────────────────────────────────────────────
   Brand ↔ category dependence, shared by every facet endpoint
   ───────────────────────────────────────────────────────────── */

/**
 * Every category id under each of `ids`, the ids themselves included.
 *
 * A brand tagged with a parent category works in everything below it, so the tag has to
 * be read as the whole subtree before it can be compared with the final category a
 * catalog entry or product actually carries.
 */
const expandCategoryIds = async (ids) => {
    const all = await Category.find().select('_id parent_id').lean();
    const childrenOf = new Map();
    for (const c of all) {
        const key = String(c.parent_id || '');
        if (!childrenOf.has(key)) childrenOf.set(key, []);
        childrenOf.get(key).push(String(c._id));
    }
    const out = new Set();
    const stack = (ids || []).map(String);
    while (stack.length) {
        const id = stack.pop();
        if (out.has(id)) continue;
        out.add(id);
        for (const child of childrenOf.get(id) || []) stack.push(child);
    }
    return out;
};

/**
 * Narrow a pair of facet lists so each only offers choices that fit the other.
 *
 * Two rules, both from the brand's own tags (`Brand.categories`):
 *
 *   · with a category chosen, a brand stays only if it is tagged for that category
 *     (directly or through a parent) — or carries no tags at all;
 *   · with a brand chosen, a category stays only if that brand is tagged for it — or the
 *     brand carries no tags at all.
 *
 * An untagged brand is treated as "works everywhere", never as "works nowhere": tagging is
 * done one brand at a time, and the filters must keep working for the brands not yet
 * reached. The counts are left as computed by the caller, which has already restricted
 * them to the other selection, so each option still promises exactly what picking it shows.
 */
const applyBrandCategoryTags = async ({ categories, brands, category_id = null, product_brand_id = null }) => {
    let keptCategories = categories;
    let keptBrands = brands;

    if (isValidId(category_id)) {
        const tagged = await Brand.find({ _id: { $in: brands.map((b) => b._id) } }).select('categories').lean();
        const tagsById = new Map(tagged.map((b) => [String(b._id), (b.categories || []).map(String)]));
        // One expansion for all brands: the subtree lookup is the same table every time.
        const expanded = new Map();
        for (const [id, tags] of tagsById) {
            if (tags.length) expanded.set(id, await expandCategoryIds(tags));
        }
        keptBrands = brands.filter((b) => {
            const subtree = expanded.get(String(b._id));
            return !subtree || subtree.has(String(category_id));
        });
    }

    if (isValidId(product_brand_id)) {
        const brand = await Brand.findById(product_brand_id).select('categories').lean();
        const tags = (brand?.categories || []).map(String);
        if (tags.length) {
            const subtree = await expandCategoryIds(tags);
            keptCategories = categories.filter((c) => subtree.has(String(c._id)));
        }
    }

    return { categories: keptCategories, brands: keptBrands };
};

/**
 * The categories and brands the catalog ACTUALLY holds, with a count each.
 *
 * Deliberately derived from catalog entries rather than reused from the shop-wide product
 * filters. Those list every brand the store sells, and most of them have no catalog entry —
 * so the dropdown would be long, mostly dead, and every dead choice returns nothing. Here a
 * brand appears only if picking it can show something.
 *
 * Scoped to the same statuses the vendor search reads, so the counts match what the filter
 * will actually produce.
 */
const getCatalogFacets = async ({ status = null, category_id = null, product_brand_id = null } = {}) => {
    // The counts have to describe the same set the caller is looking at, or a facet reading
    // "(143)" on the archived tab would promise rows that are not there. The vendor gate
    // passes nothing and gets the two statuses it can actually search.
    const visible = status && status !== 'all'
        ? { status }
        : { status: { $in: ['approved', 'suggested'] } };

    // Each list is counted INSIDE the other selection: with a brand chosen, the category
    // counts are that brand's entries per category, so "(12)" is what picking it will show.
    const categoryMatch = isValidId(product_brand_id) ? { product_brand_id: toObjectId(product_brand_id) } : {};
    const brandMatch = isValidId(category_id) ? { category_id: toObjectId(category_id) } : {};

    const [categories, brands] = await Promise.all([
        CatalogEntry.aggregate([
            { $match: { ...visible, ...categoryMatch, category_id: { $ne: null } } },
            { $group: { _id: '$category_id', count: { $sum: 1 } } },
            { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'c' } },
            { $unwind: '$c' },
            // Categories store their English name as `name`; some older rows also carry
            // `name_en`. Either way the caller gets a filled `name_en`.
            { $project: { _id: 1, count: 1, name_en: { $ifNull: ['$c.name_en', '$c.name'] }, name_ar: '$c.name_ar' } },
            { $sort: { count: -1 } },
        ]),
        CatalogEntry.aggregate([
            { $match: { ...visible, ...brandMatch, product_brand_id: { $ne: null } } },
            { $group: { _id: '$product_brand_id', count: { $sum: 1 } } },
            // The brand may be a hand-entered one or a car make (brandRef.js): look in both
            // and take whichever answered.
            { $lookup: { from: 'brands', localField: '_id', foreignField: '_id', as: 'b' } },
            { $lookup: { from: 'carbrands', localField: '_id', foreignField: '_id', as: 'cb' } },
            { $addFields: { b: { $ifNull: [{ $first: '$b' }, { $first: '$cb' }] } } },
            { $match: { b: { $ne: null } } },
            // Brands carry a single lowercase `name`, not a bilingual pair like categories.
            // Both language fields are filled from it so the caller can render every facet
            // the same way instead of special-casing one of them.
            { $project: { _id: 1, count: 1, name_en: '$b.name', name_ar: '$b.name' } },
            { $sort: { count: -1 } },
        ]),
    ]);

    return applyBrandCategoryTags({ categories, brands, category_id, product_brand_id });
};

const searchCatalogForVendor = async (
    vendorId,
    { q = '', category_id = null, product_brand_id = null, page = 1, limit = 20 } = {},
) => {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const safePage = Math.max(Number(page) || 1, 1);

    const query = { status: { $in: ['approved', 'suggested'] } };

    // Both optional and independent of the term: narrowing to a brand with an empty box is
    // a legitimate way to browse what the catalog holds, not only a way to refine a search.
    if (isValidId(category_id)) query.category_id = category_id;
    if (isValidId(product_brand_id)) query.product_brand_id = product_brand_id;

    const term = String(q || '').trim();
    if (term) {
        const rx = new RegExp(escapeRegex(term), 'i');
        query.$or = [
            { title_en: rx },
            { title_ar: rx },
            { subtitle_en: rx },
            { subtitle_ar: rx },
            { part_number: rx },
            { gtin: rx },
        ];
    }

    const [entries, total] = await Promise.all([
        CatalogEntry.find(query)
            // 'approved' sorts before 'suggested' alphabetically, so approved
            // entries lead and the newest of each status follows.
            .sort({ status: 1, created_at: -1 })
            .skip((safePage - 1) * safeLimit)
            .limit(safeLimit)
            .populate(entryListPopulate)
            .lean(),
        CatalogEntry.countDocuments(query),
    ]);

    const owned = entries.length
        ? await Product.find({
            vendor_id: vendorId,
            catalog_entry_id: { $in: entries.map((e) => e._id) },
        }).select('_id catalog_entry_id').lean()
        : [];
    const ownedByEntry = new Map(owned.map((p) => [String(p.catalog_entry_id), String(p._id)]));

    return {
        entries: entries.map((e) => ({
            ...e,
            vendor_product_id: ownedByEntry.get(String(e._id)) || null,
        })),
        pagination: {
            total,
            page: safePage,
            pages: Math.ceil(total / safeLimit),
            limit: safeLimit,
        },
    };
};

/**
 * A single entry, prepared for prefilling a vendor form. Returns null when the
 * entry does not exist or was merged away, and follows `merged_into` so a link
 * captured before a merge still resolves to the surviving entry.
 */
const getSelectableEntry = async (entryId, { follow = true } = {}) => {
    if (!isValidId(entryId)) return null;
    const entry = await CatalogEntry.findById(entryId).populate(entryListPopulate).lean();
    if (!entry) return null;
    if (entry.status === 'merged' && follow && entry.merged_into) {
        return getSelectableEntry(entry.merged_into, { follow: false });
    }
    return entry;
};

/* ─────────────────────────────────────────────────────────────
   Suggestions — the "add a new product" side of the gate
   ───────────────────────────────────────────────────────────── */

/**
 * Create a `suggested` entry from the product a vendor just authored.
 *
 * Called on every add path where the vendor did NOT pick an entry, so the
 * catalog grows from vendor work from day one. Failures are swallowed by the
 * caller's try/catch on purpose: a suggestion is internal admin bookkeeping and
 * must never be the reason a vendor's product fails to save.
 */
const createSuggestionFromProduct = async (product, vendorId) => {
    const src = toPlain(product);
    if (!src?.category_id) return null;
    // Only a finished, live listing is worth an admin's review. A draft may never be
    // completed, and a half-filled one would only produce a half-filled template.
    if (!isSuggestionWorthy(src)) return null;

    const entry = new CatalogEntry({
        title_en: src.title_en,
        title_ar: src.title_ar,
        subtitle_en: src.subtitle_en,
        subtitle_ar: src.subtitle_ar,
        description_en: src.description_en,
        description_ar: src.description_ar,
        category_id: src.category_id?._id || src.category_id,
        product_brand_id: src.product_brand_id?._id || src.product_brand_id || null,
        part_number: src.part_number,
        gtin: src.gtin,
        images: (src.images || []).map((img) => ({ url: img.url, is_primary: !!img.is_primary })),
        is_universal: src.is_universal !== false,
        compatible_cars: src.is_universal !== false ? [] : (src.compatible_cars || []),
        variation_types: (src.variation_types || []).map((vt) => ({
            name: vt.name,
            options: (vt.options || []).map((o) => ({ value: o.value })),
        })),
        status: 'suggested',
        created_by_role: 'vendor',
        created_by_vendor_id: vendorId,
        source_product_id: src._id || null,
    });

    await entry.save();
    catalogChanged();
    return entry;
};

/**
 * Resolve what a saved product should link to.
 *
 * `requestedEntryId` — the vendor picked an entry: link to it (following a merge).
 * no entry            — the vendor authored a new product: mint a suggestion.
 *
 * Returns the entry id to store, or null when nothing could be linked. Never
 * throws: a broken catalog must not block a vendor from listing a product.
 */
const resolveLinkForNewProduct = async (product, vendorId, requestedEntryId) => {
    try {
        if (isValidId(requestedEntryId)) {
            const entry = await getSelectableEntry(requestedEntryId);
            if (entry) return entry._id;
        }
        const suggestion = await createSuggestionFromProduct(product, vendorId);
        return suggestion?._id || null;
    } catch (err) {
        console.error('[Catalog] Could not link product to a catalog entry:', err.message);
        return null;
    }
};

/**
 * Attach the resolved link to an already-saved product.
 * Used by every add path after the product document exists, so a catalog problem
 * can never roll back a successful save.
 */
const linkProductAfterSave = async (product, vendorId, requestedEntryId) => {
    const entryId = await resolveLinkForNewProduct(product, vendorId, requestedEntryId);
    if (!entryId) return null;
    try {
        await Product.updateOne({ _id: product._id }, { $set: { catalog_entry_id: entryId } });
        if (product.catalog_entry_id !== undefined) product.catalog_entry_id = entryId;
    } catch (err) {
        console.error('[Catalog] Could not store the catalog link:', err.message);
        return null;
    }
    return entryId;
};

/**
 * One product per (vendor + entry). Returns the existing product id, or null.
 * The vendor is redirected to it rather than being allowed a second listing.
 */
const findVendorProductOnEntry = async (vendorId, entryId) => {
    if (!isValidId(entryId)) return null;
    const existing = await Product.findOne({ vendor_id: vendorId, catalog_entry_id: entryId })
        .select('_id').lean();
    return existing ? String(existing._id) : null;
};

/* ─────────────────────────────────────────────────────────────
   Matching — the Excel "Review links" proposals
   ───────────────────────────────────────────────────────────── */

/**
 * Propose one catalog entry per row: by GTIN when the catalog has the row's barcode, else
 * by the catalog matcher (services/catalogMatchService.js) — part number first (spacing and
 * leading zeros forgiven: "F5969" is "F 5969", "580454140" is "0580454140"), then maker, car
 * and title, with any contradiction (another brand, another car, front against rear) ruling
 * an entry out. Only a strong or likely match is proposed. Rows are never auto-linked: the
 * vendor confirms, changes or rejects each proposal on the "Review links" screen, because a
 * wrong link that passes unnoticed is exactly what this screen exists to prevent.
 *
 * @returns {Map<number, {entry: object, reason: string}>} keyed by row index.
 */
const proposeEntriesForRows = async (rows) => {
    const proposals = new Map();
    if (!Array.isArray(rows) || rows.length === 0) return proposals;

    const gtins = [...new Set(rows.map((r) => String(r.gtin || '').trim()).filter(Boolean))];
    const byGtin = new Map();
    if (gtins.length) {
        const found = await CatalogEntry.find({ status: { $in: ['approved', 'suggested'] }, gtin: { $in: gtins } }).select('_id gtin').lean();
        for (const e of found) if (!byGtin.has(normalizeCode(e.gtin))) byGtin.set(normalizeCode(e.gtin), e._id);
    }

    const matcher = await require('./catalogMatchService').getMatcher();
    const picked = new Map();
    rows.forEach((row, index) => {
        const gtin = normalizeCode(row.gtin);
        if (gtin && byGtin.has(gtin)) { picked.set(index, { id: byGtin.get(gtin), reason: 'gtin' }); return; }
        const [best] = matcher.match(row, { limit: 1, min: 0.55 });
        if (!best) return;
        picked.set(index, { id: best.entry._id, reason: best.reasons.some((r) => r.key === 'code') ? 'part_number' : 'title' });
    });

    const entries = picked.size
        ? await CatalogEntry.find({ _id: { $in: [...picked.values()].map((p) => p.id) }, status: { $in: ['approved', 'suggested'] } }).populate(entryListPopulate).lean()
        : [];
    const byId = new Map(entries.map((e) => [String(e._id), e]));
    for (const [index, { id, reason }] of picked) {
        const entry = byId.get(String(id));
        if (entry) proposals.set(index, { entry, reason });
    }
    return proposals;
};

/* ─────────────────────────────────────────────────────────────
   Admin — building, reviewing and cleaning the catalog
   ───────────────────────────────────────────────────────────── */

/** Per-status counts, for the tab badges. */
const getStatusCounts = async () => {
    const rows = await CatalogEntry.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const counts = { approved: 0, suggested: 0, archived: 0, merged: 0, rejected: 0 };
    for (const row of rows) counts[row._id] = row.count;
    // The badge must promise what the queue shows: only suggestions from finished products.
    counts.suggested = await CatalogEntry.countDocuments({ status: 'suggested', ...(await visibleSuggestionScope()) });
    return counts;
};

/** Linked-product count per entry id, so the list can show "12 vendors". */
const countProductsByEntry = async (entryIds) => {
    if (!entryIds.length) return new Map();
    const rows = await Product.aggregate([
        { $match: { catalog_entry_id: { $in: entryIds.map((id) => new mongoose.Types.ObjectId(String(id))) } } },
        { $group: { _id: '$catalog_entry_id', count: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [String(r._id), r.count]));
};

const listEntries = async ({ status = 'approved', q = '', category_id = null, product_brand_id = null, page = 1, limit = 20 } = {}) => {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);

    const query = { $and: [] };
    if (status === 'all') {
        // "All" pairs approved entries with the suggestions that are actually reviewable.
        query.$and.push({ $or: [{ status: 'approved' }, { status: 'suggested', ...(await visibleSuggestionScope()) }] });
    } else if (status === 'suggested') {
        query.$and.push({ status: 'suggested' }, await visibleSuggestionScope());
    } else {
        query.$and.push({ status });
    }

    if (isValidId(category_id)) query.category_id = category_id;
    if (isValidId(product_brand_id)) query.product_brand_id = product_brand_id;

    const term = String(q || '').trim();
    if (term) {
        const rx = new RegExp(escapeRegex(term), 'i');
        query.$and.push({ $or: [{ title_en: rx }, { title_ar: rx }, { part_number: rx }, { gtin: rx }] });
    }

    const [entries, total] = await Promise.all([
        CatalogEntry.find(query)
            .sort({ created_at: -1 })
            .skip((safePage - 1) * safeLimit)
            .limit(safeLimit)
            .populate(`${entryListPopulate} created_by_vendor_id`)
            .lean(),
        CatalogEntry.countDocuments(query),
    ]);

    const productCounts = await countProductsByEntry(entries.map((e) => e._id));

    return {
        entries: entries.map((e) => ({ ...e, product_count: productCounts.get(String(e._id)) || 0 })),
        pagination: { total, page: safePage, pages: Math.ceil(total / safeLimit), limit: safeLimit },
    };
};

/** Total sellable units on a product — the sum of its variants, or its own quantity. */
const productStock = (product) => {
    if ((product.variants || []).length > 0) {
        return product.variants.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
    }
    return Number(product.quantity) || 0;
};

/** What the customer would actually pay: the discounted price when there is one. */
const effectivePrice = (product) => {
    const price = Number(product.discount_price ?? product.price);
    return Number.isFinite(price) ? price : 0;
};

/**
 * An entry plus its analytics: the vendors carrying it, their prices, and the
 * spread across them. Admin-only — exposing competitor pricing to vendors would
 * invite a price war and give them a reason to avoid linking at all.
 *
 * Products linked to an ARCHIVED entry still count here: archiving stops new
 * selections, it does not retire the history.
 */
const getEntryDetail = async (entryId) => {
    if (!isValidId(entryId)) return null;
    const entry = await CatalogEntry.findById(entryId)
        .populate(`${entryListPopulate} created_by_vendor_id merged_into`)
        .lean();
    if (!entry) return null;

    const products = await Product.find({ catalog_entry_id: entry._id })
        .select('title_en title_ar sku price discount_price status is_published quantity variants sold_count vendor_id created_at')
        .populate({ path: 'vendor_id', select: 'store_name store_username status' })
        .lean();

    const vendors = products
        .map((p) => ({
            product_id: p._id,
            vendor_id: p.vendor_id?._id || null,
            vendor_name: p.vendor_id?.store_name || p.vendor_id?.store_username || '—',
            vendor_status: p.vendor_id?.status || null,
            title: p.title_en || p.title_ar || '',
            sku: p.sku,
            price: Number(p.price) || 0,
            effective_price: effectivePrice(p),
            stock: productStock(p),
            sold_count: Number(p.sold_count) || 0,
            status: p.status,
            created_at: p.created_at,
        }))
        // Sorted by price, cheapest first — the question the table answers is
        // "who is cheapest on this product".
        .sort((a, b) => a.effective_price - b.effective_price);

    const prices = vendors.map((v) => v.effective_price).filter((p) => p > 0);
    const stats = {
        vendor_count: new Set(vendors.map((v) => String(v.vendor_id))).size,
        product_count: vendors.length,
        min_price: prices.length ? Math.min(...prices) : null,
        max_price: prices.length ? Math.max(...prices) : null,
        avg_price: prices.length ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100 : null,
        total_stock: vendors.reduce((sum, v) => sum + v.stock, 0),
        total_sold: vendors.reduce((sum, v) => sum + v.sold_count, 0),
    };

    return { entry, vendors, stats };
};

/**
 * Entries that look like `entry`, for the merge decision on a suggestion: the catalog matcher's
 * candidates (services/catalogMatchService.js) — the same part number, the same maker, the
 * same car and the same kind of part, with any contradiction (another brand, another car,
 * front against rear, another size) ruling a candidate out. Each comes with `similarity`,
 * `level` and the `reasons` behind it.
 */
const findSimilarEntries = async (entry, { limit = 5 } = {}) => {
    const source = toPlain(entry);
    if (!source?._id) return [];
    const result = await require('./catalogMatchService').similarForEntries([source._id], { limit });
    return result[String(source._id)] || [];
};

/**
 * `findSimilarEntries` for a page of suggestions at once, as { entryId: [similar] }. The
 * Suggestions tab asked once per card: up to 200 requests in a second, past nginx's limit of
 * 10 a second per address, and the page itself was refused with them (429).
 */
const MAX_SIMILAR_BATCH = 100;
const findSimilarForEntries = async (entryIds, { limit = 5 } = {}) => {
    const ids = [...new Set((Array.isArray(entryIds) ? entryIds : []).map(String))].filter(isValidId).slice(0, MAX_SIMILAR_BATCH);
    return require('./catalogMatchService').similarForEntries(ids, { limit });
};

/** Only the fields an admin may write. Status changes go through their own verbs. */
const sanitizeEntryInput = (data = {}) => {
    const out = {};
    for (const field of CATALOG_OWNED_FIELDS) {
        if (data[field] === undefined) continue;
        out[field] = data[field];
    }
    if (out.product_brand_id === '') out.product_brand_id = null;
    if (out.category_id === '') delete out.category_id;
    if (out.is_universal) out.compatible_cars = [];
    return out;
};

const createEntry = async (data, { role = 'admin', vendorId = null } = {}) => {
    const entry = new CatalogEntry({
        ...sanitizeEntryInput(data),
        // An admin-authored entry is part of the catalog immediately; there is
        // nobody left to review it.
        status: role === 'admin' ? 'approved' : 'suggested',
        created_by_role: role,
        created_by_vendor_id: vendorId,
    });
    await entry.save();
    catalogChanged();
    return entry;
};

/**
 * Edit an entry. Loaded and saved rather than updated in place so the schema's
 * pre-validate hook runs — that hook, not the field definitions, is what holds
 * the "a title in at least one language" rule.
 */
const updateEntry = async (entryId, data) => {
    const entry = await CatalogEntry.findById(entryId);
    if (!entry) throw new Error('Catalog entry not found');

    Object.assign(entry, sanitizeEntryInput(data));
    entry.updated_at = new Date();
    await entry.save();
    catalogChanged();
    return entry.populate(entryListPopulate);
};

/**
 * Approve a suggestion, optionally after editing it. The vendor's product is not
 * touched — only the entry becomes part of the catalog.
 */
const approveEntry = async (entryId, edits = null) => {
    const entry = await CatalogEntry.findById(entryId);
    if (!entry) throw new Error('Catalog entry not found');
    if (entry.status === 'merged') throw new Error('A merged entry cannot be approved.');

    if (edits) Object.assign(entry, sanitizeEntryInput(edits));
    entry.status = 'approved';
    entry.updated_at = new Date();
    await entry.save();
    catalogChanged();
    return entry;
};

/**
 * Fold `entryId` into `targetId`: every product linked to the source moves to the
 * target, silently. Product data is never touched — only the link is corrected,
 * which is why this is safe to run while a vendor is editing their product.
 */
const mergeEntry = async (entryId, targetId) => {
    if (!isValidId(targetId)) throw new Error('Pick a target entry to merge into.');
    if (String(entryId) === String(targetId)) throw new Error('An entry cannot be merged into itself.');

    const [source, target] = await Promise.all([
        CatalogEntry.findById(entryId),
        CatalogEntry.findById(targetId),
    ]);
    if (!source) throw new Error('Catalog entry not found');
    if (!target) throw new Error('Target catalog entry not found');
    if (target.status === 'merged') throw new Error('The target entry was itself merged away. Pick the surviving entry.');

    const moved = await Product.updateMany(
        { catalog_entry_id: source._id },
        { $set: { catalog_entry_id: target._id } },
    );

    source.status = 'merged';
    source.merged_into = target._id;
    source.updated_at = new Date();
    await source.save();
    catalogChanged();

    return { source, target, moved: moved.modifiedCount ?? moved.nModified ?? 0 };
};

const setEntryStatus = async (entryId, status) => {
    const entry = await CatalogEntry.findById(entryId);
    if (!entry) throw new Error('Catalog entry not found');
    if (entry.status === 'merged') throw new Error('A merged entry can no longer change status.');
    entry.status = status;
    entry.updated_at = new Date();
    await entry.save();
    catalogChanged();
    return entry;
};

/** Archive: gone from vendor search, still linked, still counted. */
const archiveEntry = (entryId) => setEntryStatus(entryId, 'archived');

/**
 * Reject a suggestion: it leaves the queue for good. The vendor's product keeps its link
 * to the rejected entry, which is exactly what keeps it from being suggested again — and
 * off the unlinked worklist, since it is not unlinked.
 */
const rejectEntry = async (entryId) => {
    const entry = await CatalogEntry.findById(entryId);
    if (!entry) throw new Error('Catalog entry not found');
    if (entry.status !== 'suggested') throw new Error('Only a suggestion can be rejected.');
    entry.status = 'rejected';
    entry.updated_at = new Date();
    await entry.save();
    catalogChanged();
    return entry;
};

/** Restore: an archived entry goes back to approved; a rejected suggestion back to the queue. */
const restoreEntry = async (entryId) => {
    const entry = await CatalogEntry.findById(entryId).select('status').lean();
    if (!entry) throw new Error('Catalog entry not found');
    return setEntryStatus(entryId, entry.status === 'rejected' ? 'suggested' : 'approved');
};

/**
 * Hard delete — refused for any entry with linked products. One click must never
 * be able to drop a dozen products out of analytics; archive or merge instead.
 */
const deleteEntry = async (entryId) => {
    const entry = await CatalogEntry.findById(entryId);
    if (!entry) throw new Error('Catalog entry not found');

    const linked = await Product.countDocuments({ catalog_entry_id: entry._id });
    if (linked > 0) {
        const err = new Error(`This entry is linked to ${linked} product(s). Archive or merge it instead.`);
        err.code = 'ENTRY_HAS_PRODUCTS';
        throw err;
    }

    await CatalogEntry.deleteOne({ _id: entry._id });
    catalogChanged();
    return entry;
};

/**
 * Point a product at a different entry, or at none. The admin's escape hatch for
 * a vendor who picked "oil filter" and edited it into a brake kit — caught during
 * product review, never automatically.
 */
/**
 * Copy the linked entry's images onto the product.
 *
 * Additive, never a replacement: the vendor's own photos stay, the entry's images the
 * product does not already carry are added in front of them, and the entry's primary
 * becomes the product's primary — the catalog picture is the curated one, which is
 * the whole reason an admin presses this. Pressing it twice adds nothing the second time.
 */
const importImagesFromEntry = async (productId) => {
    const product = await Product.findById(productId).select('images catalog_entry_id');
    if (!product) throw new Error('Product not found');
    if (!product.catalog_entry_id) throw new Error('This product is not linked to a catalog entry');
    const entry = await CatalogEntry.findById(product.catalog_entry_id).select('images').lean();
    if (!entry) throw new Error('Catalog entry not found');

    const incoming = (entry.images || []).filter((img) => img && img.url);
    if (incoming.length === 0) throw new Error('The catalog entry has no images to import');

    const have = new Set((product.images || []).map((img) => String(img.url)));
    const added = incoming.filter((img) => !have.has(String(img.url)));
    const primaryUrl = (incoming.find((img) => img.is_primary) || incoming[0]).url;

    const merged = [
        ...added.map((img) => ({ url: img.url, is_primary: false })),
        ...(product.images || []).map((img) => ({ _id: img._id, url: img.url, is_primary: false })),
    ].map((img) => ({ ...img, is_primary: String(img.url) === String(primaryUrl) }));

    await Product.updateOne({ _id: product._id }, { $set: { images: merged } });
    return { added: added.length, total: merged.length, primary: primaryUrl };
};

/**
 * Copy the linked entry's brand onto the product. Through findByIdAndUpdate so the brand
 * source (hand-entered brand or car make) is stamped by the shared hook.
 */
const importBrandFromEntry = async (productId) => {
    const product = await Product.findById(productId).select('product_brand_id catalog_entry_id');
    if (!product) throw new Error('Product not found');
    if (!product.catalog_entry_id) throw new Error('This product is not linked to a catalog entry');
    const entry = await CatalogEntry.findById(product.catalog_entry_id).select('product_brand_id').lean();
    if (!entry) throw new Error('Catalog entry not found');
    if (!entry.product_brand_id) throw new Error('The catalog entry has no brand to import');

    await Product.findByIdAndUpdate(product._id, { product_brand_id: entry.product_brand_id });
    return { product_brand_id: entry.product_brand_id, changed: String(product.product_brand_id || '') !== String(entry.product_brand_id) };
};

/**
 * Linked products still missing what their catalog entry could give them — the data-entry
 * worklists behind the catalog's "no images" and "no brand" tabs.
 *
 *   gap = 'images'  linked, and the product carries no image at all
 *   gap = 'brand'   linked, and the product carries no brand
 *
 * Each row says whether its entry can fill the gap (`can_import`), so the admin can clear
 * the easy ones with one press and see at a glance which ones need a hand. Those come
 * first. `counts` always carries both totals for the tab badges.
 */
const LINKED_GAP_MATCH = {
    images: { $or: [{ images: { $exists: false } }, { images: { $size: 0 } }] },
    brand: { $or: [{ product_brand_id: null }, { product_brand_id: { $exists: false } }] },
};

const listLinkedGaps = async ({ gap = 'images', q = '', page = 1, limit = 20 } = {}) => {
    const which = LINKED_GAP_MATCH[gap] ? gap : 'images';
    const base = { catalog_entry_id: { $ne: null } };

    const match = { ...base, ...LINKED_GAP_MATCH[which] };
    const term = String(q || '').trim();
    if (term) {
        const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        match.$and = [{ $or: [{ title_en: rx }, { title_ar: rx }, { sku: rx }, { part_number: rx }] }];
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const lim = Math.min(100, Math.max(1, Number(limit) || 20));

    const rows = await Product.aggregate([
        { $match: match },
        { $lookup: { from: 'catalogentries', localField: 'catalog_entry_id', foreignField: '_id', as: 'entry' } },
        { $unwind: { path: '$entry', preserveNullAndEmptyArrays: true } },
        {
            $addFields: {
                can_import: which === 'images'
                    ? { $gt: [{ $size: { $ifNull: ['$entry.images', []] } }, 0] }
                    : { $ne: [{ $ifNull: ['$entry.product_brand_id', null] }, null] },
            },
        },
        { $sort: { can_import: -1, updated_at: -1, _id: -1 } },
        {
            $facet: {
                total: [{ $count: 'n' }],
                importable: [{ $match: { can_import: true } }, { $count: 'n' }],
                page: [
                    { $skip: (pageNum - 1) * lim },
                    { $limit: lim },
                    { $lookup: { from: 'sellers', localField: 'vendor_id', foreignField: '_id', as: 'vendor' } },
                    {
                        $project: {
                            title_en: 1, title_ar: 1, sku: 1, part_number: 1, status: 1, images: 1,
                            product_brand_id: 1, can_import: 1,
                            vendor: { $let: { vars: { v: { $first: '$vendor' } }, in: { _id: '$$v._id', store_name: '$$v.store_name' } } },
                            entry: {
                                _id: '$entry._id', title_en: '$entry.title_en', title_ar: '$entry.title_ar',
                                part_number: '$entry.part_number', images: '$entry.images',
                                product_brand_id: '$entry.product_brand_id',
                            },
                        },
                    },
                ],
            },
        },
    ]);

    const facet = rows[0] || {};
    const products = facet.page || [];

    // Brand names for the entry column (brand tab) — either collection, see brandRef.js.
    const brandIds = [...new Set(products.map((p) => p.entry?.product_brand_id).filter(Boolean).map(String))];
    if (brandIds.length) {
        const { CarBrand } = require('../models/car_brands');
        const [manual, makes] = await Promise.all([
            Brand.find({ _id: { $in: brandIds } }).select('name').lean(),
            CarBrand.find({ _id: { $in: brandIds } }).select('name').lean(),
        ]);
        const names = new Map([...manual, ...makes].map((b) => [String(b._id), b.name]));
        for (const p of products) {
            if (p.entry?.product_brand_id) p.entry.brand_name = names.get(String(p.entry.product_brand_id)) || '';
        }
    }

    const [imagesCount, brandCount] = await Promise.all([
        Product.countDocuments({ ...base, ...LINKED_GAP_MATCH.images }),
        Product.countDocuments({ ...base, ...LINKED_GAP_MATCH.brand }),
    ]);

    const total = facet.total?.[0]?.n || 0;
    return {
        gap: which,
        products,
        importable: facet.importable?.[0]?.n || 0,
        counts: { images: imagesCount, brand: brandCount },
        pagination: { total, page: pageNum, pages: Math.max(1, Math.ceil(total / lim)), limit: lim },
    };
};

const relinkProduct = async (productId, entryId) => {
    const product = await Product.findById(productId);
    if (!product) throw new Error('Product not found');

    if (entryId === null || entryId === '') {
        product.catalog_entry_id = null;
    } else {
        const entry = await getSelectableEntry(entryId);
        if (!entry) throw new Error('Catalog entry not found');
        product.catalog_entry_id = entry._id;
    }

    await Product.updateOne({ _id: product._id }, { $set: { catalog_entry_id: product.catalog_entry_id } });
    return product.catalog_entry_id;
};


/* ─────────────────────────────────────────────────────────────
   Unlinked vendor products (admin worklist)
   ───────────────────────────────────────────────────────────── */

/**
 * What still stops a product from going live, in the storefront's own terms.
 *
 * Mirrors vendorService.validateForPublish deliberately: the admin worklist is
 * useless if it disagrees with the gate the product will actually hit. Split by
 * ownership, because that is the whole point — a template can supply the catalog
 * side and can never supply the price, so the two must not be shown as one list.
 */
const describeProductGaps = (product) => {
    const filled = (v) => !!(v && String(v).trim());
    const hasEnglish = filled(product.title_en) && filled(product.subtitle_en) && filled(product.description_en);
    const hasArabic = filled(product.title_ar) && filled(product.subtitle_ar) && filled(product.description_ar);

    const fromCatalog = [];
    if (!hasEnglish && !hasArabic) fromCatalog.push('text');
    if (!product.category_id) fromCatalog.push('category');
    if (!(product.images || []).length) fromCatalog.push('images');

    const fromVendor = [];
    if (!product.price || Number(product.price) <= 0) fromVendor.push('price');

    return {
        missing_from_catalog: fromCatalog,
        missing_from_vendor: fromVendor,
        // A template closes the catalog side only. Saying "publishable" when the
        // vendor still owes a price would send the admin on a pointless errand.
        blocked_by_vendor: fromVendor.length > 0,
        ready_to_publish: fromCatalog.length === 0 && fromVendor.length === 0,
    };
};

/** Published, and nothing missing on either side — the only products worth reviewing. */
const isSuggestionWorthy = (product) =>
    product?.status === 'published' && describeProductGaps(product).ready_to_publish;

/**
 * The same completeness test as a Mongo filter, so the worklist can page over the
 * products that qualify instead of loading everything and filtering in memory.
 */
const filled = { $exists: true, $nin: [null, ''] };
const completePublishedProductQuery = () => ({
    status: 'published',
    category_id: { $ne: null },
    'images.0': { $exists: true },
    price: { $gt: 0 },
    $or: [
        { title_en: filled, subtitle_en: filled, description_en: filled },
        { title_ar: filled, subtitle_ar: filled, description_ar: filled },
    ],
});

/**
 * Mint a suggestion for a product that has just gone live without a catalog entry.
 * Called from every path that publishes a product; a no-op when the product is already
 * linked, or still has gaps. Never throws — publishing must not depend on the catalog.
 */
const suggestProductIfEligible = async (productId) => {
    try {
        const product = await Product.findById(productId).lean();
        if (!product || product.catalog_entry_id || !isSuggestionWorthy(product)) return null;
        return await linkProductAfterSave(product, product.vendor_id, null);
    } catch (err) {
        console.error('[Catalog] Could not suggest the published product:', err.message);
        return null;
    }
};

/**
 * Which suggestions deserve to be shown: those whose source product is published and
 * complete NOW. Suggestions minted before this rule existed, or whose product was later
 * unpublished, stay in the collection but out of the queue — and come back by themselves
 * the day the product is finished. Suggestions with no source product are admin-made
 * and always shown.
 */
const visibleSuggestionScope = async () => {
    const sourceIds = await CatalogEntry.distinct('source_product_id', { status: 'suggested', source_product_id: { $ne: null } });
    if (!sourceIds.length) return { $or: [{ source_product_id: null }, { source_product_id: { $exists: false } }] };
    const eligible = await Product.find({ _id: { $in: sourceIds }, ...completePublishedProductQuery() }).select('_id').lean();
    return {
        $or: [
            { source_product_id: null },
            { source_product_id: { $exists: false } },
            { source_product_id: { $in: eligible.map((p) => p._id) } },
        ],
    };
};

/**
 * Vendor products with no catalog entry, for the admin's linking worklist.
 *
 * Only PUBLISHED, COMPLETE products that the admin has not dismissed: a draft may never
 * be finished, and a listing with gaps would only make a template with the same gaps.
 * `status` is accepted for compatibility and no longer widens the list.
 */
const listUnlinkedProducts = async ({
    status = 'all',
    q = '',
    category_id = null,
    product_brand_id = null,
    with_match = '',
    page = 1,
    limit = 20,
} = {}) => {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);

    const query = { $and: [unlinkedWorklistBase()] };
    if (isValidId(category_id)) query.category_id = category_id;
    if (isValidId(product_brand_id)) query.product_brand_id = product_brand_id;

    const term = String(q || '').trim();
    if (term) {
        const rx = new RegExp(escapeRegex(term), 'i');
        query.$and.push({ $or: [{ title_en: rx }, { title_ar: rx }, { part_number: rx }, { sku: rx }] });
    }

    // Only the products the matcher has a proposal for, the surest first — the ones an admin
    // can clear with one press each.
    if (with_match === 'strong' || with_match === 'likely') {
        const match = require('./catalogMatchService');
        const candidates = await Product.find(query).select(match.PRODUCT_FIELDS).lean();
        const ranked = await match.rankWithProposals(candidates, { min: with_match });
        const pageIds = ranked.slice((safePage - 1) * safeLimit, safePage * safeLimit).map((p) => p._id);
        const docs = await Product.find({ _id: { $in: pageIds } }).populate('category_id product_brand_id vendor_id').lean();
        const byId = new Map(docs.map((d) => [String(d._id), d]));
        return {
            products: pageIds.map((id) => byId.get(String(id))).filter(Boolean).map((p) => ({ ...p, gaps: describeProductGaps(p) })),
            pagination: { page: safePage, limit: safeLimit, total: ranked.length, pages: Math.max(Math.ceil(ranked.length / safeLimit), 1) },
        };
    }

    const [products, total] = await Promise.all([
        Product.find(query)
            .sort({ created_at: -1, _id: -1 })
            .skip((safePage - 1) * safeLimit)
            .limit(safeLimit)
            .populate('category_id product_brand_id vendor_id')
            .lean(),
        Product.countDocuments(query),
    ]);

    return {
        products: products.map((p) => ({ ...p, gaps: describeProductGaps(p) })),
        pagination: { page: safePage, limit: safeLimit, total, pages: Math.max(Math.ceil(total / safeLimit), 1) },
    };
};

/**
 * The categories and brands present among UNLINKED PRODUCTS.
 *
 * Read from the products collection, not from catalog entries, because this tab lists
 * products. The two sets barely overlap by definition: a brand with plenty of catalog
 * entries can have nothing left unlinked, and the brands that fill this worklist are
 * precisely the ones the catalog does not cover yet. Reusing the catalog facets here would
 * offer choices that return nothing and hide the ones that matter.
 *
 * `status` narrows to the same chip the admin has selected, so the counts describe the list
 * in front of them rather than the whole worklist.
 */
const getUnlinkedProductFacets = async ({ status = 'all', category_id = null, product_brand_id = null } = {}) => {
    const match = { $and: [unlinkedWorklistBase()] };

    // Same dependence as the catalog facets: each list is counted inside the other selection.
    const categoryMatch = isValidId(product_brand_id) ? { product_brand_id: toObjectId(product_brand_id) } : {};
    const brandMatch = isValidId(category_id) ? { category_id: toObjectId(category_id) } : {};

    const [categories, brands] = await Promise.all([
        Product.aggregate([
            { $match: { ...match, ...categoryMatch, category_id: { $ne: null } } },
            { $group: { _id: '$category_id', count: { $sum: 1 } } },
            { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'c' } },
            { $unwind: '$c' },
            { $project: { _id: 1, count: 1, name_en: { $ifNull: ['$c.name_en', '$c.name'] }, name_ar: '$c.name_ar' } },
            { $sort: { count: -1 } },
        ]),
        Product.aggregate([
            { $match: { ...match, ...brandMatch, product_brand_id: { $ne: null } } },
            { $group: { _id: '$product_brand_id', count: { $sum: 1 } } },
            // The brand may be a hand-entered one or a car make (brandRef.js): look in both
            // and take whichever answered.
            { $lookup: { from: 'brands', localField: '_id', foreignField: '_id', as: 'b' } },
            { $lookup: { from: 'carbrands', localField: '_id', foreignField: '_id', as: 'cb' } },
            { $addFields: { b: { $ifNull: [{ $first: '$b' }, { $first: '$cb' }] } } },
            { $match: { b: { $ne: null } } },
            // Brands carry a single lowercase `name`, unlike categories.
            { $project: { _id: 1, count: 1, name_en: '$b.name', name_ar: '$b.name' } },
            { $sort: { count: -1 } },
        ]),
    ]);

    return applyBrandCategoryTags({ categories, brands, category_id, product_brand_id });
};

/** The worklist's definition: unlinked, published, complete, and not dismissed. */
const unlinkedWorklistBase = () => ({
    $and: [
        { $or: [{ catalog_entry_id: null }, { catalog_entry_id: { $exists: false } }] },
        { $or: [{ catalog_dismissed_at: null }, { catalog_dismissed_at: { $exists: false } }] },
        completePublishedProductQuery(),
    ],
});

/** Counts for the worklist badge. Everything on it is published, so the two agree. */
const getUnlinkedProductCounts = async () => {
    const total = await Product.countDocuments(unlinkedWorklistBase());
    return { all: total, draft: 0, pending: 0, published: total };
};

/**
 * Take a product off the worklist for good. Nothing about the product changes for the
 * vendor or the storefront; the admin has simply decided it is not catalog material.
 */
const dismissUnlinkedProduct = async (productId) => {
    if (!isValidId(productId)) throw new Error('Product not found');
    const product = await Product.findById(productId).select('_id catalog_entry_id').lean();
    if (!product) throw new Error('Product not found');
    if (product.catalog_entry_id) throw new Error('This product is already linked to a catalog entry.');
    await Product.updateOne({ _id: product._id }, { $set: { catalog_dismissed_at: new Date() } });
    return { product_id: product._id };
};

/**
 * Copy an entry's data into the BLANK fields of a draft product.
 *
 * Only blanks, and only on a draft. A published or pending product is a listing
 * the vendor already stands behind, and a field they filled is theirs even when
 * the entry disagrees — the catalog pre-fills, it does not govern.
 *
 * The product is left as a draft on purpose. Completing someone's listing is a
 * favour; publishing it for them is a decision that belongs to the vendor.
 */
const fillDraftFromEntry = async (product, entry) => {
    if (!product || product.status !== 'draft') return { filled: [] };

    const current = toPlain(product);
    const merged = fillMissingFromEntry(current, entry);

    const filled = CATALOG_OWNED_FIELDS.filter(
        (f) => JSON.stringify(current[f] ?? null) !== JSON.stringify(merged[f] ?? null),
    );
    if (!filled.length) return { filled: [] };

    const $set = { updated_at: new Date() };
    for (const f of filled) $set[f] = merged[f];
    await Product.updateOne({ _id: product._id }, { $set });

    return { filled };
};

/**
 * Link an unlinked product to an entry the catalog already has, and top up its
 * blanks if it is a draft. Returns what changed so the admin sees it.
 */
const linkUnlinkedProduct = async (productId, entryId) => {
    const product = await Product.findById(productId);
    if (!product) throw new Error('Product not found');

    const entry = await getSelectableEntry(entryId);
    if (!entry) throw new Error('Catalog entry not found');

    await Product.updateOne({ _id: product._id }, { $set: { catalog_entry_id: entry._id } });
    const { filled } = await fillDraftFromEntry(product, entry);

    return { entry_id: entry._id, filled, product_status: product.status };
};

/**
 * Publish an unlinked vendor product as a NEW catalog template.
 *
 * `data` is the entry as the admin left it in the form — prefilled from the
 * product, then edited or not. Whatever they publish is what the template says;
 * the product itself is never rewritten from those edits, only topped up where
 * it was blank.
 *
 * The entry is admin-authored, so it goes straight to `approved` — there is
 * nobody left to review it. `source_product_id` records where it came from.
 */
const publishProductAsEntry = async (productId, data) => {
    const product = await Product.findById(productId);
    if (!product) throw new Error('Product not found');
    if (product.catalog_entry_id) throw new Error('This product is already linked to a catalog entry.');

    const entry = await createEntry(data, { role: 'admin' });
    await CatalogEntry.updateOne({ _id: entry._id }, { $set: { source_product_id: product._id } });

    await Product.updateOne({ _id: product._id }, { $set: { catalog_entry_id: entry._id } });
    const { filled } = await fillDraftFromEntry(product, entry);

    return { entry, filled, product_status: product.status };
};

/** The entry form, prefilled from a vendor product. */
const buildEntryDraftFromProduct = async (productId) => {
    const product = await Product.findById(productId).populate('category_id product_brand_id vendor_id').lean();
    if (!product) throw new Error('Product not found');

    return {
        product: { ...product, gaps: describeProductGaps(product) },
        draft: {
            title_en: product.title_en || '',
            title_ar: product.title_ar || '',
            subtitle_en: product.subtitle_en || '',
            subtitle_ar: product.subtitle_ar || '',
            description_en: product.description_en || '',
            description_ar: product.description_ar || '',
            category_id: product.category_id?._id ? String(product.category_id._id) : '',
            product_brand_id: product.product_brand_id?._id ? String(product.product_brand_id._id) : '',
            part_number: product.part_number || '',
            gtin: product.gtin || '',
            images: (product.images || []).map((img) => ({ url: img.url, is_primary: !!img.is_primary })),
            is_universal: product.is_universal !== false,
            compatible_cars: JSON.parse(JSON.stringify(product.compatible_cars || [])),
            variation_types: (product.variation_types || []).map((vt) => ({
                name: vt.name,
                options: (vt.options || []).map((o) => ({ value: o.value })),
            })),
        },
    };
};

module.exports = {
    CATALOG_OWNED_FIELDS,
    describeProductGaps,
    listUnlinkedProducts,
    getUnlinkedProductCounts,
    dismissUnlinkedProduct,
    suggestProductIfEligible,
    rejectEntry,
    linkUnlinkedProduct,
    publishProductAsEntry,
    buildEntryDraftFromProduct,
    buildPrefillFromEntry,
    fillMissingFromEntry,
    searchCatalogForVendor,
    getSelectableEntry,
    createSuggestionFromProduct,
    resolveLinkForNewProduct,
    linkProductAfterSave,
    findVendorProductOnEntry,
    proposeEntriesForRows,
    getStatusCounts,
    listEntries,
    getCatalogFacets,
    getUnlinkedProductFacets,
    getEntryDetail,
    findSimilarEntries,
    findSimilarForEntries,
    createEntry,
    updateEntry,
    approveEntry,
    mergeEntry,
    archiveEntry,
    restoreEntry,
    deleteEntry,
    relinkProduct,
    importImagesFromEntry,
    importBrandFromEntry,
    listLinkedGaps,
};
