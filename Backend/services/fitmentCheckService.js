/**
 * The fitment check, for the admin: products whose own title or description names cars the
 * fitment does not (services/matching/fitmentCheck.js), and the one-press fix.
 *
 *   listFitmentIssues()   the worklist — published, waiting for approval, or drafts
 *   checkProductFitment() one product's findings (the product page, the approval queue)
 *   applyFitmentFix()     add the cars / set the years the admin accepted
 *   dismissFitmentIssues() "the fitment is right": off the list until something changes
 *
 * The check reads every product in a few hundred milliseconds, so the worklist is computed
 * on request rather than stored; the car list it resolves names against is kept for ten
 * minutes.
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
const { Product } = require('../models/products');
const { CarBrand } = require('../models/car_brands');
const { createVehicleReader } = require('./matching/vehicleMentions');
const { checkFitment, applyFitmentFix: buildFixedFitment, ACTIONABLE, TEXT_FIELDS } = require('./matching/fitmentCheck');
const { noteFixes } = require('./productReviewService');

const READER_TTL_MS = 10 * 60 * 1000;
let reader = null;
let readerAt = 0;

const getReader = async () => {
    if (!reader || Date.now() - readerAt > READER_TTL_MS) {
        const carBrands = await CarBrand.find().select('name models').lean();
        reader = createVehicleReader(carBrands);
        readerAt = Date.now();
    }
    return reader;
};

/** Car brands were edited: read them again on the next check. */
const invalidateFitmentReader = () => { reader = null; };

const FIELDS = `${TEXT_FIELDS.join(' ')} is_universal compatible_cars status vendor_id sku part_number images fitment_check_dismissed`;
const SEVERITY_RANK = { high: 0, medium: 1, low: 2, info: 3 };

/** What was found, as a short stable string: a dismissal holds only while it is unchanged. */
const signatureOf = (findings) => crypto.createHash('sha1')
    .update(JSON.stringify(findings
        .filter((f) => ACTIONABLE.has(f.type))
        .map((f) => [f.type, ...(f.cars || [f.car]).map((c) => `${c.make_id}|${c.model_id}|${(c.years || []).join(',')}`)])
        .sort()))
    .digest('hex').slice(0, 16);

const actionable = (findings) => findings.filter((f) => ACTIONABLE.has(f.type));

/** One product's findings, as the screens show them. */
const describe = (product, result) => {
    const findings = [...result.findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
    const signature = signatureOf(findings);
    const dismissed = !!(product.fitment_check_dismissed?.signature && product.fitment_check_dismissed.signature === signature);
    return {
        findings,
        signature,
        dismissed,
        actionable: actionable(findings).length,
        top_severity: findings.length ? findings[0].severity : null,
        mentions: result.mentions,
    };
};

/** The findings on a product already loaded, with the reader already built. */
const findingsFor = (product, r) => describe(product, checkFitment(product, r));

/** The findings on one product. */
const checkProductFitment = async (productOrId) => {
    const product = productOrId && productOrId._id && productOrId.title_ar !== undefined
        ? productOrId
        : await Product.findById(productOrId).select(FIELDS).lean();
    if (!product) throw Object.assign(new Error('Product not found'), { status: 404 });
    return describe(product, checkFitment(product, await getReader()));
};

/**
 * Products with something to fix, most serious first.
 *
 * @param status    'published' | 'pending' | 'draft' | 'all'
 * @param type      one finding type, or '' for any actionable one
 * @param severity  'high' | 'medium' | 'low' — the lowest shown (default medium)
 */
const listFitmentIssues = async ({ status = 'published', type = '', severity = 'medium', vendor_id = '', q = '', page = 1, limit = 20 } = {}) => {
    const r = await getReader();
    const query = {};
    if (['published', 'pending', 'draft'].includes(status)) query.status = status;
    if (vendor_id && mongoose.Types.ObjectId.isValid(String(vendor_id))) query.vendor_id = vendor_id;
    const term = String(q || '').trim();
    if (term) {
        const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        query.$or = [{ title_ar: rx }, { title_en: rx }, { sku: rx }, { part_number: rx }];
    }
    const products = await Product.find(query).select(FIELDS).populate('vendor_id', 'store_name').lean();

    const floor = SEVERITY_RANK[severity] ?? SEVERITY_RANK.medium;
    const counts = { total: 0, by_type: {}, by_status: {} };
    const rows = [];
    for (const p of products) {
        const d = describe(p, checkFitment(p, r));
        if (d.dismissed) continue;
        const shown = d.findings.filter((f) => ACTIONABLE.has(f.type) && SEVERITY_RANK[f.severity] <= floor);
        if (!shown.length) continue;
        counts.total += 1;
        counts.by_status[p.status] = (counts.by_status[p.status] || 0) + 1;
        for (const t of new Set(shown.map((f) => f.type))) counts.by_type[t] = (counts.by_type[t] || 0) + 1;
        if (type && !shown.some((f) => f.type === type)) continue;
        rows.push({
            product: {
                _id: p._id, title_ar: p.title_ar, title_en: p.title_en, sku: p.sku, part_number: p.part_number, status: p.status,
                image: (p.images || []).find((i) => i.is_primary)?.url || p.images?.[0]?.url || null,
                vendor: p.vendor_id ? { _id: p.vendor_id._id, store_name: p.vendor_id.store_name } : null,
                is_universal: !!p.is_universal,
                compatible_cars: p.compatible_cars || [],
            },
            findings: d.findings.filter((f) => SEVERITY_RANK[f.severity] <= Math.max(floor, SEVERITY_RANK.info)),
            signature: d.signature,
            top: Math.min(...shown.map((f) => SEVERITY_RANK[f.severity])),
        });
    }
    rows.sort((a, b) => a.top - b.top);

    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);
    return {
        rows: rows.slice((safePage - 1) * safeLimit, safePage * safeLimit),
        counts,
        pagination: { total: rows.length, page: safePage, pages: Math.max(1, Math.ceil(rows.length / safeLimit)), limit: safeLimit },
    };
};

/**
 * Apply the fixes the admin ticked.
 *
 * @param changes  [{ make_id, model_id|null, years: number[], all_years: boolean }]
 * @returns the product's fitment after, and what the check finds on it now
 */
const applyFitmentFix = async (productId, changes) => {
    if (!mongoose.Types.ObjectId.isValid(String(productId))) throw Object.assign(new Error('Product not found'), { status: 404 });
    if (!Array.isArray(changes) || !changes.length) throw Object.assign(new Error('Choose at least one fix to apply.'), { status: 400 });
    const product = await Product.findById(productId).select('status is_universal compatible_cars').lean();
    if (!product) throw Object.assign(new Error('Product not found'), { status: 404 });

    const r = await getReader();
    const fitment = buildFixedFitment(product, changes, r.cars);
    // Only the fitment is written: nothing else about the product, and not its status.
    await Product.updateOne({ _id: product._id }, { $set: fitment }, { runValidators: true });

    // A product still waiting for approval tells its vendor what was corrected when it goes live.
    if (product.status === 'pending') await noteFixes(product._id, ['fitment']);
    require('./productService').invalidateFilterMetadataCache?.();

    const after = await checkProductFitment(product._id);
    return { ...fitment, check: after };
};

/** "The fitment is right as it is": off the worklist until the findings change. */
const dismissFitmentIssues = async (productId) => {
    const d = await checkProductFitment(productId);
    await Product.updateOne({ _id: productId }, { $set: { fitment_check_dismissed: { at: new Date(), signature: d.signature } } });
    return { product_id: productId };
};

module.exports = {
    getReader,
    invalidateFitmentReader,
    checkProductFitment,
    findingsFor,
    listFitmentIssues,
    applyFitmentFix,
    dismissFitmentIssues,
    actionable,
};
