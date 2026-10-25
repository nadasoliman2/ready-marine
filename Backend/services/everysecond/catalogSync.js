/**
 * Catalogue → the agent's menu.
 *
 * Every product is mapped (helpers.menuItemsForProduct decides what may be
 * sold in chat), compared with the hash of what was last pushed, and only the
 * difference is sent through EverySecond's batch endpoint — so a run where
 * nothing changed costs one query and no requests. Products that went back to
 * draft, lost their vendor's subscription, or were deleted leave the menu; past
 * orders on EverySecond keep their lines.
 *
 * Stock and price changes need no hook of their own: both are part of the
 * hash, so the next run picks them up wherever they were edited (vendor
 * dashboard, admin, bulk upload, catalogue tools).
 */
const { Product } = require('../../models/products');
const { Category } = require('../../models/categories');
const { Brand } = require('../../models/product_brands');
const { CarBrand } = require('../../models/car_brands');
const { Seller } = require('../../models/sellers');
const { EverySecondMenuItem } = require('../../models/everysecond');
const { api, isConfigured, sleep } = require('./client');
const { menuItemsForProduct, itemHash } = require('./helpers');

const BATCH_SIZE = 500;
let lastSync = null;
let syncRunning = false;

// EVERYSECOND_SITE_URL only matters on a development machine, where FRONTEND_URL is
// http://localhost and the menu still needs public https links (EverySecond drops the rest).
const siteUrl = () => (process.env.EVERYSECOND_SITE_URL || process.env.FRONTEND_URL || 'https://readycar.store').replace(/\/+$/, '');
const assetBase = () => (process.env.BACKEND_PUBLIC_URL || process.env.EVERYSECOND_SITE_URL || process.env.FRONTEND_URL || 'https://readycar.store').replace(/\/+$/, '');

/** An absolute URL for a stored image — older rows keep "/uploads/…" paths. */
const absoluteImageUrl = (url) => {
    const value = String(url || '').trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value.replace(/^http:\/\//i, 'https://');
    return `${assetBase()}${value.startsWith('/') ? '' : '/'}${value}`;
};

/** The product page in the language the menu links to (EVERYSECOND_PRODUCT_LOCALE, default Arabic). */
const productPageUrl = (product, locale = process.env.EVERYSECOND_PRODUCT_LOCALE === 'en' ? 'en' : 'ar') => {
    const slug = locale === 'ar' ? (product.slug_ar || product.slug_en) : (product.slug_en || product.slug_ar);
    return slug ? `${siteUrl()}/${locale}/product/${encodeURIComponent(slug)}` : '';
};

const titleCase = (s) => String(s || '').replace(/\b([a-z])/g, (m) => m.toUpperCase());

async function catalogueContext() {
    const [categories, brands, carBrands, activeVendors] = await Promise.all([
        Category.find().select('name').lean(),
        Brand.find().select('name').lean(),
        CarBrand.find().select('name').lean(),
        Seller.find({ status: { $ne: 'suspended' }, subscription_status: { $in: ['active', 'trial_active'] } }).distinct('_id'),
    ]);
    const categoryById = new Map(categories.map((c) => [String(c._id), c.name]));
    const brandById = new Map(brands.map((b) => [String(b._id), titleCase(b.name)]));
    const carBrandById = new Map(carBrands.map((b) => [String(b._id), b.name]));
    const vendors = new Set(activeVendors.map(String));
    const cap = Number.parseInt(process.env.EVERYSECOND_MAX_QTY_PER_ORDER, 10);
    return {
        isActiveVendor: (id) => vendors.has(String(id?._id || id || '')),
        categoryName: (id) => categoryById.get(String(id || '')) || '',
        brandName: (product) => {
            const id = String(product.product_brand_id || '');
            return product.product_brand_source === 'CarBrand' ? carBrandById.get(id) || '' : brandById.get(id) || '';
        },
        imageUrl: absoluteImageUrl,
        productUrl: (product) => productPageUrl(product),
        maxQtyPerOrder: cap > 0 ? cap : null,
    };
}

/*
 * The batch endpoint answers per entry ({ data: [{ external_id, status, error }] }).
 * Read defensively: an entry that names an error failed, anything else succeeded.
 */
function failuresFrom(response) {
    const rows = [response?.results, response?.data, response?.items].find(Array.isArray) || [];
    const failed = new Map();
    for (const row of rows) {
        const id = row?.external_id;
        const error = row?.error || row?.errors || (row?.ok === false ? 'refused' : '')
            || (['error', 'failed'].includes(String(row?.result ?? row?.status ?? '')) ? row?.message || 'refused' : '');
        if (id && error) failed.set(String(id), typeof error === 'string' ? error : JSON.stringify(error));
    }
    return failed;
}

/** Every external id EverySecond currently holds for this agent. */
async function remoteMenuIds() {
    const ids = new Set();
    for (let page = 1; ; page += 1) {
        const res = await api('GET', `/orders/menu/items?per_page=500&page=${page}`);
        for (const row of res?.data || []) if (row?.external_id) ids.add(String(row.external_id));
        if (!(res?.meta?.last_page > page)) return ids;
    }
}

/**
 * Bring the agent's menu in line with the catalogue.
 *
 * `reconcile` starts from what EverySecond actually holds instead of what this
 * database remembers pushing — that removes items another environment left on
 * the menu and re-sends ones deleted there by hand. It costs a full listing, so
 * it runs at startup and on request, not every few minutes.
 */
async function syncCatalog({ reconcile = false } = {}) {
    if (!isConfigured()) return { skipped: 'EVERYSECOND_API_KEY is not set' };
    if (syncRunning) return { skipped: 'a sync is already running' };
    syncRunning = true;
    const startedAt = new Date();
    try {
        const ctx = await catalogueContext();
        const desired = new Map();
        const cursor = Product.find({})
            .select('title_en title_ar subtitle_en subtitle_ar part_number part_type slug_en slug_ar price discount_price status vendor_id category_id '
                + 'product_brand_id product_brand_source is_universal compatible_cars stock_management stock_status quantity images variants')
            .lean()
            .cursor();
        for await (const product of cursor) {
            for (const [id, item] of menuItemsForProduct(product, ctx)) desired.set(id, item);
        }

        const known = new Map((await EverySecondMenuItem.find({}).select('external_id hash').lean()).map((row) => [row.external_id, row]));
        if (reconcile) {
            const remote = await remoteMenuIds();
            for (const id of [...known.keys()]) if (!remote.has(id)) known.delete(id);
            for (const id of remote) if (!known.has(id)) known.set(id, { external_id: id, hash: '' });
        }

        const entries = [];
        for (const [id, item] of desired) {
            if (item) {
                const hash = itemHash(item);
                if (known.get(id)?.hash !== hash) entries.push({ entry: { op: 'upsert', external_id: id, ...item }, hash });
            } else if (known.has(id)) {
                entries.push({ entry: { op: 'delete', external_id: id } });
            }
        }
        for (const id of known.keys()) if (!desired.has(id)) entries.push({ entry: { op: 'delete', external_id: id } });

        let pushed = 0;
        let deleted = 0;
        let failed = 0;
        for (let i = 0; i < entries.length; i += BATCH_SIZE) {
            const batch = entries.slice(i, i + BATCH_SIZE);
            let failures;
            try {
                failures = failuresFrom(await api('POST', '/orders/menu/items/batch', { items: batch.map((b) => b.entry) }, { timeoutMs: 120_000 }));
            } catch (err) {
                // The whole batch was refused: record it on every entry so the next run retries them.
                failures = new Map(batch.map((b) => [b.entry.external_id, err.message]));
            }
            const writes = [];
            for (const { entry, hash } of batch) {
                const id = entry.external_id;
                const error = failures.get(id);
                if (entry.op === 'delete') {
                    // A delete of something EverySecond no longer has is still done.
                    if (!error || /no menu item|not found|404/i.test(error)) {
                        writes.push({ deleteOne: { filter: { external_id: id } } });
                        deleted += 1;
                    } else {
                        failed += 1;
                        writes.push({ updateOne: { filter: { external_id: id }, update: { $set: { error: String(error).slice(0, 500) } } } });
                    }
                } else if (error) {
                    failed += 1;
                    writes.push({ updateOne: { filter: { external_id: id }, update: { $set: { hash: '', error: String(error).slice(0, 500) } }, upsert: true } });
                } else {
                    pushed += 1;
                    writes.push({ updateOne: { filter: { external_id: id }, update: { $set: { hash, error: '', synced_at: new Date() } }, upsert: true } });
                }
            }
            if (writes.length) await EverySecondMenuItem.bulkWrite(writes, { ordered: false });
            if (i + BATCH_SIZE < entries.length) await sleep(1000);
        }

        lastSync = {
            at: startedAt,
            finished_at: new Date(),
            reconcile,
            sellable: [...desired.values()].filter(Boolean).length,
            pushed,
            deleted,
            failed,
            error: '',
        };
        return lastSync;
    } catch (err) {
        lastSync = { at: startedAt, finished_at: new Date(), reconcile, pushed: 0, deleted: 0, failed: 0, error: err.message };
        throw err;
    } finally {
        syncRunning = false;
    }
}

const getLastSync = () => lastSync;

module.exports = { syncCatalog, getLastSync, absoluteImageUrl, productPageUrl };
