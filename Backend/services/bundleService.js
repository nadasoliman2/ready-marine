/**
 * Bundle Service
 * Vendor bundle CRUD + publish/approval gating, member-validity invariant, and
 * server-authoritative effective-price computation. Mirrors the product flow in
 * vendorService.js but for multi-product bundles owned by a single vendor.
 *
 * NOTE: this module must NOT require orderService (orderService requires this
 * module for checkout-time bundle expansion — avoid the circular dependency).
 * The member unit-price precedence is replicated locally to match
 * orderService.buildVariantSnapshot exactly.
 */
const mongoose = require('mongoose');
const { Bundle } = require('../models/bundles');
const { Product } = require('../models/products');
const { Seller } = require('../models/sellers');
const { SiteSettings } = require('../models/site_settings');
const { requireActiveSubscription } = require('./vendorSubscriptionService');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Active (non-suspended, subscribed) vendor ids — mirrors productService. */
const getActiveVendorIds = async () => {
    return Seller.find({
        status: { $ne: 'suspended' },
        subscription_status: { $in: ['active', 'trial_active'] },
    }).distinct('_id');
};

/**
 * Resolve a member's current effective unit price. Precedence matches
 * orderService.buildVariantSnapshot: variant.discount_price ?? variant.price ??
 * product.discount_price ?? product.price.
 */
const resolveMemberUnitPrice = (product, variantId) => {
    const variants = product.variants || [];
    let variant = null;
    if (variantId) variant = variants.find(v => v._id.toString() === variantId.toString());
    if (!variant && variants.length > 0) variant = variants[0];
    if (!variant) return Number(product.discount_price ?? product.price) || 0;
    return Number((variant.discount_price ?? variant.price) ?? (product.discount_price ?? product.price)) || 0;
};

/**
 * Load each member's product document (lean) alongside the member entry.
 * Returns [{ member, product }]; product is null if it no longer exists.
 */
const loadMembersWithProducts = async (members = []) => {
    const ids = members.map(m => m.product_id).filter(Boolean);
    const products = await Product.find({ _id: { $in: ids } })
        .populate('vendor_id', 'status store_name store_username')
        .lean();
    const byId = new Map(products.map(p => [p._id.toString(), p]));
    return members.map(m => ({ member: m, product: byId.get(String(m.product_id)) || null }));
};

/**
 * Compute the bundle's effective price from members' CURRENT effective prices.
 * @param {{pricing_mode:string, pricing_value:number}} pricing
 * @param {Array<{member, product}>} membersWithProducts
 * @returns {{ combined, effective, savings, memberBreakdown }}
 */
const computeBundlePricing = (pricing, membersWithProducts) => {
    const memberBreakdown = [];
    let combined = 0;

    for (const { member, product } of membersWithProducts) {
        if (!product) continue;
        const unit = resolveMemberUnitPrice(product, member.variant_id);
        const qty = Number(member.quantity) || 1;
        const lineTotal = unit * qty;
        combined += lineTotal;
        memberBreakdown.push({
            product_id: product._id,
            variant_id: member.variant_id || null,
            quantity: qty,
            effective_unit: round2(unit),
            line_total: round2(lineTotal),
            product,
        });
    }

    combined = round2(combined);
    const value = Number(pricing.pricing_value) || 0;
    let effective;
    if (pricing.pricing_mode === 'percent') {
        effective = round2(combined * (1 - Math.min(Math.max(value, 0), 100) / 100));
    } else if (pricing.pricing_mode === 'amount') {
        effective = round2(Math.max(0, combined - value));
    } else {
        effective = round2(Math.max(0, value)); // fixed total
    }

    return { combined, effective, savings: round2(Math.max(0, combined - effective)), memberBreakdown };
};

/**
 * Validate the bundle-member invariant: every member must be one of this
 * vendor's own PUBLISHED, active products; a pinned variant must exist.
 * Throws a coded Error on the first violation.
 */
const validateMemberInvariant = async (vendorId, members = []) => {
    if (!Array.isArray(members) || members.length < 2) {
        const err = new Error('A bundle must contain at least two products.');
        err.code = 'INVALID_BUNDLE_MEMBER';
        throw err;
    }
    const withProducts = await loadMembersWithProducts(members);
    for (const { member, product } of withProducts) {
        if (!product) {
            const err = new Error('A selected product no longer exists.');
            err.code = 'INVALID_BUNDLE_MEMBER';
            throw err;
        }
        const productVendorId = product.vendor_id?._id || product.vendor_id;
        if (String(productVendorId) !== String(vendorId)) {
            const err = new Error('All bundle products must belong to you.');
            err.code = 'MEMBER_WRONG_VENDOR';
            throw err;
        }
        if (product.status !== 'published' || product.is_active === false) {
            const err = new Error(`Product "${product.title_en || product.title_ar || product._id}" must be published and active to include it in a bundle.`);
            err.code = 'MEMBER_NOT_PUBLISHED';
            throw err;
        }
        if (member.variant_id) {
            const exists = (product.variants || []).some(v => v._id.toString() === member.variant_id.toString());
            if (!exists) {
                const err = new Error('A selected product variant no longer exists.');
                err.code = 'INVALID_BUNDLE_MEMBER';
                throw err;
            }
        }
    }
    return withProducts;
};

/** Global admin toggle: is admin approval required for bundle publishing? */
const getBundleApprovalRequired = async () => {
    const settings = await SiteSettings.findOne().select('bundle_approval_required').lean();
    // Default true (approval required) when unset.
    return settings?.bundle_approval_required !== false;
};

/** Generate a unique slug within the Bundle collection. */
const generateBundleSlug = async (title, vendorName, lang = 'en', bundleId = null) => {
    if (!title) return '';
    let slug = `${title}-${vendorName}`.toLowerCase();
    if (lang === 'en') {
        slug = slug.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    } else {
        slug = slug.replace(/[^ء-ي0-9a-z]+/g, '-').replace(/^-+|-+$/g, '');
    }
    let uniqueSlug = slug;
    let counter = 1;
    while (true) {
        const query = lang === 'en' ? { slug_en: uniqueSlug } : { slug_ar: uniqueSlug };
        if (bundleId) query._id = { $ne: bundleId };
        const existing = await Bundle.findOne(query).select('_id').lean();
        if (!existing) return uniqueSlug;
        uniqueSlug = `${slug}-${counter++}`;
    }
};

/** Validate required fields before a bundle can be published/submitted. */
const validateForPublish = (data) => {
    const hasEnglish = !!(data.title_en?.trim()) && !!(data.subtitle_en?.trim()) && !!(data.description_en?.trim());
    const hasArabic = !!(data.title_ar?.trim()) && !!(data.subtitle_ar?.trim()) && !!(data.description_ar?.trim());
    if (!hasEnglish && !hasArabic) {
        const err = new Error('Please fill title, subtitle and description in at least one language (English or Arabic).');
        err.code = 'INCOMPLETE_BUNDLE';
        throw err;
    }
    if (!Array.isArray(data.members) || data.members.length < 2) {
        const err = new Error('A bundle must contain at least two products.');
        err.code = 'INCOMPLETE_BUNDLE';
        throw err;
    }
    if (!['fixed', 'percent', 'amount'].includes(data.pricing_mode)) {
        const err = new Error('Invalid pricing mode.');
        err.code = 'INCOMPLETE_BUNDLE';
        throw err;
    }
    if (data.pricing_value === undefined || data.pricing_value === null || Number(data.pricing_value) < 0) {
        const err = new Error('A valid bundle price is required.');
        err.code = 'INCOMPLETE_BUNDLE';
        throw err;
    }
    if (!data.images || data.images.length === 0) {
        const err = new Error('At least one bundle image is required.');
        err.code = 'INCOMPLETE_BUNDLE';
        throw err;
    }
};

const normalizeMembers = (members = []) =>
    (Array.isArray(members) ? members : []).map(m => ({
        product_id: m.product_id,
        variant_id: m.variant_id || null,
        quantity: Math.max(1, Number(m.quantity) || 1),
    }));

/**
 * Add a new bundle. Always goes to pending unless approval is off or the vendor
 * auto-publishes. Requires an active subscription (does NOT consume a product slot).
 */
const addBundle = async (vendorId, data) => {
    await requireActiveSubscription(vendorId);

    const vendor = await Seller.findById(vendorId);
    if (!vendor) throw new Error('Vendor not found');

    data.vendor_id = vendorId;
    data.members = normalizeMembers(data.members);

    const submitting = data.status !== undefined && data.status !== 'draft';
    if (submitting) {
        validateForPublish(data);
        await validateMemberInvariant(vendorId, data.members);
        const approvalRequired = await getBundleApprovalRequired();
        if (approvalRequired && !vendor.auto_publish_products) {
            data.status = 'pending';
            data.is_published = false;
        } else {
            data.status = 'published';
            data.is_published = true;
        }
    } else {
        data.status = 'draft';
        data.is_published = false;
    }

    const vendorName = vendor.store_name || vendor.store_username;
    if (data.title_en) data.slug_en = await generateBundleSlug(data.title_en, vendorName, 'en');
    if (data.title_ar) data.slug_ar = await generateBundleSlug(data.title_ar, vendorName, 'ar');

    const bundle = new Bundle(data);
    await bundle.save();
    return bundle;
};

/** Update a bundle (vendor must own it). */
const updateBundle = async (vendorId, bundleId, updateData) => {
    delete updateData.vendor_id;
    delete updateData.is_published;

    const before = await Bundle.findOne({ _id: bundleId, vendor_id: vendorId }).populate('vendor_id');
    if (!before) throw new Error('Bundle not found or unauthorized');

    const vendor = before.vendor_id;
    const vendorName = vendor.store_name || vendor.store_username;

    if (updateData.members !== undefined) updateData.members = normalizeMembers(updateData.members);

    if (updateData.title_en !== undefined && updateData.title_en && updateData.title_en !== before.title_en) {
        updateData.slug_en = await generateBundleSlug(updateData.title_en, vendorName, 'en', bundleId);
    }
    if (updateData.title_ar !== undefined && updateData.title_ar && updateData.title_ar !== before.title_ar) {
        updateData.slug_ar = await generateBundleSlug(updateData.title_ar, vendorName, 'ar', bundleId);
    }

    if (updateData.status === 'published' || updateData.status === 'pending') {
        const merged = { ...before.toObject(), ...updateData };
        validateForPublish(merged);
        await validateMemberInvariant(vendorId, merged.members);
        const approvalRequired = await getBundleApprovalRequired();
        if (approvalRequired && !vendor.auto_publish_products) {
            updateData.status = 'pending';
        } else {
            updateData.status = 'published';
            updateData.is_published = true;
        }
    }

    const bundle = await Bundle.findOneAndUpdate(
        { _id: bundleId, vendor_id: vendorId },
        { $set: updateData },
        { returnDocument: 'after', runValidators: true }
    );
    return bundle;
};

const deleteBundle = async (vendorId, bundleId) => {
    const bundle = await Bundle.findOneAndDelete({ _id: bundleId, vendor_id: vendorId });
    if (!bundle) throw new Error('Bundle not found or unauthorized');
    return bundle;
};

const getVendorBundles = async (vendorId) => {
    const bundles = await Bundle.find({ vendor_id: vendorId })
        .populate('members.product_id', 'title_en title_ar images price discount_price status variants')
        .sort({ created_at: -1 })
        .lean();
    return bundles.map(b => ({ ...b, pricing: computeBundlePricing(b, (b.members || []).map(m => ({ member: m, product: m.product_id }))) }));
};

const getVendorBundleById = async (vendorId, bundleId) => {
    const bundle = await Bundle.findOne({ _id: bundleId, vendor_id: vendorId })
        .populate('members.product_id', 'title_en title_ar images price discount_price status variants vendor_id is_active')
        .lean();
    if (!bundle) return null;
    const mwp = (bundle.members || []).map(m => ({ member: m, product: m.product_id }));
    return { ...bundle, pricing: computeBundlePricing(bundle, mwp) };
};

/** The creating vendor's own published products (for the builder's picker). */
const getEligibleProducts = async (vendorId) => {
    return Product.find({ vendor_id: vendorId, status: 'published' })
        .select('title_en title_ar images price discount_price variants variation_types')
        .sort({ created_at: -1 })
        .lean();
};

/** Enrich a public bundle: compute pricing + re-check the member invariant. */
const enrichPublicBundle = async (bundle) => {
    const mwp = (bundle.members || []).map(m => ({ member: m, product: m.product_id }));
    const pricing = computeBundlePricing(bundle, mwp);
    let is_purchasable = true;
    try {
        await validateMemberInvariant(bundle.vendor_id?._id || bundle.vendor_id, (bundle.members || []).map(m => ({
            product_id: m.product_id?._id || m.product_id,
            variant_id: m.variant_id,
            quantity: m.quantity,
        })));
    } catch (_) {
        is_purchasable = false;
    }
    return { ...bundle, pricing, is_purchasable, member_count: (bundle.members || []).length };
};

const publicPopulate = [
    { path: 'members.product_id', select: 'title_en title_ar subtitle_en subtitle_ar slug_en slug_ar images price discount_price status variants is_active vendor_id' },
    { path: 'vendor_id', select: 'store_name store_username store_image status subscription_status' },
];

const getPublicBundleBySlug = async (slug) => {
    const activeVendorIds = await getActiveVendorIds();
    const bundle = await Bundle.findOne({
        status: 'published',
        vendor_id: { $in: activeVendorIds },
        $or: [{ slug_en: slug }, { slug_ar: slug }],
    }).populate(publicPopulate).lean();
    if (!bundle) return null;
    return enrichPublicBundle(bundle);
};

const getPublicBundleById = async (id) => {
    const activeVendorIds = await getActiveVendorIds();
    const bundle = await Bundle.findOne({
        _id: id,
        status: 'published',
        vendor_id: { $in: activeVendorIds },
    }).populate(publicPopulate).lean();
    if (!bundle) return null;
    return enrichPublicBundle(bundle);
};

const getLandingBundles = async (limit = 8) => {
    const safeLimit = Math.min(Math.max(Number(limit) || 8, 1), 24);
    const activeVendorIds = await getActiveVendorIds();
    const bundles = await Bundle.find({
        status: 'published',
        vendor_id: { $in: activeVendorIds },
    }).populate(publicPopulate).sort({ created_at: -1 }).limit(safeLimit).lean();

    const enriched = await Promise.all(bundles.map(enrichPublicBundle));
    // Only surface currently-purchasable bundles on the homepage row.
    return enriched.filter(b => b.is_purchasable);
};

/* ------------------ Admin moderation ------------------ */
const getBundlesForAdmin = async ({ status } = {}) => {
    const filter = {};
    if (status) filter.status = status;
    const bundles = await Bundle.find(filter)
        .populate('vendor_id', 'store_name store_username')
        .populate('members.product_id', 'title_en title_ar images price discount_price status variants')
        .sort({ created_at: -1 })
        .lean();
    return bundles.map(b => ({ ...b, pricing: computeBundlePricing(b, (b.members || []).map(m => ({ member: m, product: m.product_id }))) }));
};

const approveBundle = async (bundleId) => {
    const bundle = await Bundle.findById(bundleId);
    if (!bundle) throw new Error('Bundle not found');
    await validateMemberInvariant(bundle.vendor_id, bundle.members);
    bundle.status = 'published';
    bundle.is_published = true;
    await bundle.save();
    return bundle;
};

const rejectBundle = async (bundleId) => {
    const bundle = await Bundle.findByIdAndUpdate(
        bundleId,
        { status: 'draft' },
        { returnDocument: 'after' }
    );
    if (!bundle) throw new Error('Bundle not found');
    return bundle;
};

module.exports = {
    getActiveVendorIds,
    resolveMemberUnitPrice,
    loadMembersWithProducts,
    computeBundlePricing,
    validateMemberInvariant,
    getBundleApprovalRequired,
    generateBundleSlug,
    addBundle,
    updateBundle,
    deleteBundle,
    getVendorBundles,
    getVendorBundleById,
    getEligibleProducts,
    getPublicBundleBySlug,
    getPublicBundleById,
    getLandingBundles,
    getBundlesForAdmin,
    approveBundle,
    rejectBundle,
};
