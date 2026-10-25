/**
 * Reviewing vendors' products before they go live ("Pending approval").
 *
 * ReadyCar does not turn vendors' products away: the admin corrects what is wrong and
 * publishes. So the review is built around finding what needs correcting and correcting a
 * lot of it at once:
 *
 *   reviewQueue()     every product waiting, with the problems found on each (`issues`)
 *   bulkFix()         one correction (category, part type, fitment) on many products,
 *                     and optionally publish them in the same step
 *   approveProducts() publish, many at once, and tell each vendor once what went live and
 *                     what was corrected on it
 *   changedFixes()    what an admin edit changed, kept on the product (`review_fixes`) until
 *                     it is published, so the vendor can be told
 */

const mongoose = require('mongoose');
const { Product } = require('../models/products');
const { Category } = require('../models/categories');
// Populated by the queue; loaded here so the service stands on its own (scripts, tests).
require('../models/sellers');
require('../models/product_brands');
const { createNotification } = require('../models/notifications');
const { recordProductStatusChange } = require('./shared/productAudit');
const { normalizePartType } = require('./shared/partType');

/* ------------------------------------------------------------------ */
/*  What an admin corrected                                           */
/* ------------------------------------------------------------------ */

// The parts of a product a correction is named by, for the vendor's notice.
const FIXES = {
    title: { en: 'title', ar: 'العنوان' },
    description: { en: 'description', ar: 'الوصف' },
    category: { en: 'category', ar: 'الفئة' },
    brand: { en: 'brand', ar: 'الماركة' },
    part_type: { en: 'part type', ar: 'نوع القطعة' },
    part_number: { en: 'part number', ar: 'رقم القطعة' },
    sku: { en: 'SKU', ar: 'كود المنتج' },
    gtin: { en: 'barcode', ar: 'الباركود' },
    price: { en: 'price', ar: 'السعر' },
    discount: { en: 'discount', ar: 'الخصم' },
    fitment: { en: 'fitting cars', ar: 'العربيات المناسبة' },
    images: { en: 'images', ar: 'الصور' },
    stock: { en: 'stock', ar: 'المخزون' },
};

const idOf = (v) => (v && typeof v === 'object' && v._id ? String(v._id) : v ? String(v) : '');
const text = (v) => String(v ?? '').trim();
const fitmentKey = (p) => JSON.stringify({
    u: !!p.is_universal,
    c: (p.compatible_cars || []).map((c) => [
        idOf(c.brand_id), !!c.all_models,
        (c.models || []).map((m) => [idOf(m.model_id), !!m.all_years, [...(m.years || [])].sort()]),
    ]),
});

/** Which corrections (FIXES keys) an edit made, comparing the product before and after. */
const changedFixes = (before, after) => {
    if (!before || !after) return [];
    const differ = (...fields) => fields.some((f) => text(before[f]) !== text(after[f]));
    const out = [];
    if (differ('title_ar', 'title_en', 'subtitle_ar', 'subtitle_en')) out.push('title');
    if (differ('description_ar', 'description_en')) out.push('description');
    if (idOf(before.category_id) !== idOf(after.category_id)) out.push('category');
    if (idOf(before.product_brand_id) !== idOf(after.product_brand_id)) out.push('brand');
    if (differ('part_type')) out.push('part_type');
    if (differ('part_number')) out.push('part_number');
    if (differ('sku')) out.push('sku');
    if (differ('gtin')) out.push('gtin');
    if (Number(before.price) !== Number(after.price)) out.push('price');
    if (differ('discount_type') || Number(before.discount_value || 0) !== Number(after.discount_value || 0)) out.push('discount');
    if (fitmentKey(before) !== fitmentKey(after)) out.push('fitment');
    if ((before.images || []).map((i) => i.url).join('|') !== (after.images || []).map((i) => i.url).join('|')) out.push('images');
    if (!!before.stock_management !== !!after.stock_management || Number(before.quantity || 0) !== Number(after.quantity || 0)) out.push('stock');
    return out;
};

/** Keep what an admin edit corrected on a product still waiting for approval. */
const noteFixes = async (productId, keys) => {
    if (!keys?.length) return;
    await Product.updateOne({ _id: productId }, { $addToSet: { review_fixes: { $each: keys } } });
};

/* ------------------------------------------------------------------ */
/*  What is wrong with a product                                      */
/* ------------------------------------------------------------------ */

const ISSUES = [
    'no_fitment', 'fitment_mismatch', 'no_title_ar', 'no_title_en', 'no_description', 'no_category', 'no_part_type',
    'no_part_number', 'no_image', 'price_problem', 'price_outlier',
];

const effectivePrice = (p) => Number(p.discount_price ?? p.price) || 0;

const median = (values) => {
    if (!values.length) return null;
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * The problems on one product.
 * @param marketPrice  what other vendors sell the same catalog item for (median), or null
 */
const issuesOf = (p, marketPrice = null) => {
    const out = [];
    if (!p.is_universal && !(p.compatible_cars || []).length) out.push('no_fitment');
    if (!text(p.title_ar)) out.push('no_title_ar');
    if (!text(p.title_en)) out.push('no_title_en');
    if (!text(p.description_ar) && !text(p.description_en)) out.push('no_description');
    if (!p.category_id) out.push('no_category');
    if (!p.part_type) out.push('no_part_type');
    // A part for a specific car is found by its number; an accessory for any car often has none.
    if (!p.is_universal && !text(p.part_number)) out.push('no_part_number');
    // No brand is not a problem: the field is optional and most products have none.
    if (!(p.images || []).length) out.push('no_image');
    if (!(Number(p.price) > 0) || (p.discount_price != null && Number(p.discount_price) >= Number(p.price))) out.push('price_problem');
    else if (marketPrice) {
        const ratio = effectivePrice(p) / marketPrice;
        if (ratio > 1.6 || ratio < 0.6) out.push('price_outlier');
    }
    return out;
};

/* ------------------------------------------------------------------ */
/*  The queue                                                         */
/* ------------------------------------------------------------------ */

/** Every product waiting for approval, slim, with its problems. Newest first. */
const reviewQueue = async () => {
    const products = await Product.find({ status: 'pending' })
        .select('title_ar title_en sku part_number part_type price discount_price discount_type discount_value images '
            + 'category_id product_brand_id vendor_id is_universal compatible_cars description_ar description_en '
            + 'subtitle_ar subtitle_en fitment_check_dismissed catalog_entry_id review_fixes created_at')
        .populate('category_id', 'name name_ar parent_id')
        .populate('product_brand_id', 'name')
        .populate('vendor_id', 'store_name store_username auto_publish_products')
        .sort({ created_at: -1 })
        .lean();

    // What other vendors sell the same catalog item for, live.
    const catalogIds = [...new Set(products.map((p) => idOf(p.catalog_entry_id)).filter(Boolean))];
    const offers = catalogIds.length
        ? await Product.find({ status: 'published', catalog_entry_id: { $in: catalogIds.map((id) => new mongoose.Types.ObjectId(id)) } })
            .select('catalog_entry_id vendor_id price discount_price').lean()
        : [];
    const offersOf = new Map();
    for (const o of offers) {
        const key = idOf(o.catalog_entry_id);
        if (!offersOf.has(key)) offersOf.set(key, []);
        offersOf.get(key).push(o);
    }

    // The fitment the title or description names and the fitment does not hold
    // (services/fitmentCheckService.js): read once for the whole queue.
    const fitment = require('./fitmentCheckService');
    const fitmentReader = await fitment.getReader().catch(() => null);
    const fitmentIssueOf = (p) => {
        if (!fitmentReader) return null;
        const d = fitment.findingsFor(p, fitmentReader);
        if (d.dismissed) return null;
        const found = fitment.actionable(d.findings).filter((f) => f.severity === 'high' || f.severity === 'medium');
        return found.length ? found : null;
    };

    return products.map((p) => {
        const others = (offersOf.get(idOf(p.catalog_entry_id)) || []).filter((o) => idOf(o.vendor_id) !== idOf(p.vendor_id));
        const market = median(others.map(effectivePrice).filter((v) => v > 0));
        const issues = issuesOf(p, market);
        const fitmentFindings = !issues.includes('no_fitment') && fitmentIssueOf(p);
        if (fitmentFindings) issues.splice(1, 0, 'fitment_mismatch');
        return {
            _id: p._id,
            title_ar: p.title_ar || '',
            title_en: p.title_en || '',
            sku: p.sku || '',
            part_number: p.part_number || '',
            part_type: p.part_type || null,
            price: p.price,
            discount_price: p.discount_price ?? null,
            image: (p.images || []).find((i) => i.is_primary)?.url || p.images?.[0]?.url || null,
            images_count: (p.images || []).length,
            category: p.category_id ? { _id: p.category_id._id, name: p.category_id.name, name_ar: p.category_id.name_ar } : null,
            brand: p.product_brand_id ? { _id: p.product_brand_id._id, name: p.product_brand_id.name } : null,
            vendor: p.vendor_id ? {
                _id: p.vendor_id._id,
                store_name: p.vendor_id.store_name,
                store_username: p.vendor_id.store_username,
                auto_publish_products: !!p.vendor_id.auto_publish_products,
            } : null,
            is_universal: !!p.is_universal,
            // "Toyota Corolla, Hyundai" — enough to see what it fits without opening it.
            cars: (p.compatible_cars || []).map((c) => (c.all_models || !(c.models || []).length
                ? c.brand_name
                : `${c.brand_name} ${(c.models || []).map((m) => m.model_name).slice(0, 3).join('/')}${(c.models || []).length > 3 ? '…' : ''}`)),
            market_price: market,
            issues,
            // "the title says Lancer Boma, the fitment has no Lancer": what to add, for the card.
            fitment_hint: fitmentFindings ? fitmentFindings.flatMap((f) => (f.cars || [f.car]).map((c) => [c.make, c.model].filter(Boolean).join(' '))).slice(0, 4) : [],
            review_fixes: p.review_fixes || [],
            created_at: p.created_at,
        };
    });
};

/* ------------------------------------------------------------------ */
/*  Publishing                                                        */
/* ------------------------------------------------------------------ */

const reviewError = (code, message, status = 400) => Object.assign(new Error(message), { code, status });

const validIds = (ids) => {
    const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))].filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (!list.length) throw reviewError('NO_PRODUCTS', 'Choose at least one product.');
    if (list.length > 2000) throw reviewError('TOO_MANY', 'At most 2000 products at once.');
    return list;
};

/** Run `work` over `items`, a few at a time. */
const inBatches = async (items, size, work) => {
    for (let i = 0; i < items.length; i += size) {
        await Promise.all(items.slice(i, i + size).map(work));
    }
};

/**
 * Publish products — the same steps as approving one: first-time approval marks it
 * published-once (`is_published`) and offers it to the catalog. Each vendor is then told
 * ONCE what went live and what was corrected on it.
 *
 * @returns {{ approved: string[] }}
 */
const approveProducts = async (ids, actor = {}) => {
    const list = validIds(ids);
    const before = await Product.find({ _id: { $in: list } })
        .select('_id is_published status vendor_id title_ar title_en review_fixes').lean();
    const approved = [];
    const byVendor = new Map();

    await inBatches(before.filter((p) => p.status !== 'published'), 5, async (p) => {
        const product = await Product.findByIdAndUpdate(
            p._id,
            { $set: { status: 'published', is_published: true }, $unset: { review_fixes: 1 } },
            { returnDocument: 'after', runValidators: true },
        ).populate('category_id product_brand_id vendor_id');
        if (!product) return;
        await recordProductStatusChange({ product, from: p.status, to: 'published', actor, reason: 'Approved' });
        // Now that it is live and complete it can be offered to the catalog as a suggestion.
        if (!p.is_published) await require('./catalogService').suggestProductIfEligible(product._id).catch(() => {});
        approved.push(String(p._id));

        const vendorId = idOf(p.vendor_id);
        if (!byVendor.has(vendorId)) byVendor.set(vendorId, { count: 0, titles: [], fixes: {}, product_ids: [] });
        const v = byVendor.get(vendorId);
        v.count += 1;
        if (v.titles.length < 3) v.titles.push(p.title_ar || p.title_en || '');
        if (v.product_ids.length < 50) v.product_ids.push(String(p._id));
        for (const key of p.review_fixes || []) v.fixes[key] = (v.fixes[key] || 0) + 1;
    });

    // One notice per vendor, whatever the number of products.
    for (const [vendorId, v] of byVendor) {
        const fixed = Object.entries(v.fixes).map(([k, n]) => `${FIXES[k]?.en || k}${v.count > 1 ? ` (${n})` : ''}`);
        const title = v.count === 1 ? 'Your product is live' : `${v.count} of your products are live`;
        const message = (v.count === 1 ? `"${v.titles[0]}" is now published on ReadyCar.` : `${v.count} products are now published on ReadyCar.`)
            + (fixed.length ? ` We corrected the ${fixed.join(', ')} for you before publishing.` : '');
        await createNotification(vendorId, 'products_published', title, message, {
            count: v.count, titles: v.titles, fixes: v.fixes, product_ids: v.product_ids,
        }).catch((err) => console.error(`[Review] Notice to vendor ${vendorId} failed: ${err.message}`));
    }

    if (approved.length) {
        require('./shippingEngine').invalidateShippingCache();
    }
    return { approved };
};

/* ------------------------------------------------------------------ */
/*  One correction on many products                                   */
/* ------------------------------------------------------------------ */

/**
 * @param set   { category_id?, part_type?, fitment?: { is_universal: true } |
 *                { is_universal: false, compatible_cars: [...] } }
 * @param publish  publish them too, in the same step
 */
const bulkFix = async ({ ids, set = {}, publish = false } = {}, actor = {}) => {
    const list = validIds(ids);
    const $set = {};
    const keys = [];

    if (set.category_id) {
        if (!mongoose.Types.ObjectId.isValid(String(set.category_id)) || !(await Category.exists({ _id: set.category_id }))) {
            throw reviewError('BAD_CATEGORY', 'That category does not exist.');
        }
        $set.category_id = set.category_id;
        keys.push('category');
    }
    if (set.part_type) {
        const partType = normalizePartType(set.part_type);
        if (!partType) throw reviewError('BAD_PART_TYPE', 'Choose a part type: original, OEM or aftermarket.');
        $set.part_type = partType;
        keys.push('part_type');
    }
    if (set.fitment) {
        if (set.fitment.is_universal) {
            $set.is_universal = true;
            $set.compatible_cars = [];
        } else {
            const cars = Array.isArray(set.fitment.compatible_cars) ? set.fitment.compatible_cars : [];
            if (!cars.length || cars.some((c) => !c?.brand_id || !c?.brand_name)) {
                throw reviewError('BAD_FITMENT', 'Choose at least one car make for these products.');
            }
            $set.is_universal = false;
            $set.compatible_cars = cars;
        }
        keys.push('fitment');
    }
    if (!keys.length && !publish) throw reviewError('NOTHING_TO_DO', 'Choose something to correct, or publish.');

    let updated = 0;
    if (keys.length) {
        const res = await Product.updateMany(
            { _id: { $in: list }, status: 'pending' },
            { $set, $addToSet: { review_fixes: { $each: keys } } },
            { runValidators: true },
        );
        updated = res.modifiedCount || 0;
        require('./productService').invalidateFilterMetadataCache?.();
    }
    const published = publish ? (await approveProducts(list, actor)).approved : [];
    return { updated, published: published.length, published_ids: published };
};

module.exports = {
    FIXES,
    ISSUES,
    changedFixes,
    noteFixes,
    issuesOf,
    reviewQueue,
    approveProducts,
    bulkFix,
};
