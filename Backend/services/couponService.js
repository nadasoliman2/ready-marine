const mongoose = require('mongoose');
const { Coupon } = require('../models/coupons');
const { Category } = require('../models/categories');

const normalizeCode = (code = '') => String(code || '').trim().toUpperCase();

const getDescendantCategoryIds = async (categoryIds = []) => {
    const ids = categoryIds
        .map(id => id?.toString?.())
        .filter(Boolean);

    if (ids.length === 0) return [];

    const allCategories = await Category.find().select('_id parent_id').lean();
    const queue = [...ids];
    const result = new Set(ids);

    while (queue.length > 0) {
        const parentId = queue.shift();
        for (const cat of allCategories) {
            const catParentId = cat.parent_id ? cat.parent_id.toString() : null;
            if (catParentId === parentId) {
                const childId = cat._id.toString();
                if (!result.has(childId)) {
                    result.add(childId);
                    queue.push(childId);
                }
            }
        }
    }

    return Array.from(result);
};

const isCouponActiveNow = (coupon, now = new Date()) => {
    if (!coupon?.is_active) return false;
    if (coupon.starts_at && new Date(coupon.starts_at) > now) return false;
    if (coupon.expires_at && new Date(coupon.expires_at) < now) return false;
    return true;
};

const getUserUsageCount = (coupon, userId) => {
    if (!coupon?.usage_by_user || !userId) return 0;
    const found = coupon.usage_by_user.find(entry => String(entry.user_id) === String(userId));
    return Number(found?.count || 0);
};

const validateCouponWindowAndLimits = (coupon, userId, subtotal) => {
    if (!coupon) throw new Error('Coupon not found');

    if (!isCouponActiveNow(coupon)) {
        throw new Error('Coupon is inactive or expired');
    }

    if (coupon.usage_limit_total != null && Number(coupon.used_count || 0) >= Number(coupon.usage_limit_total)) {
        throw new Error('Coupon usage limit reached');
    }

    if (coupon.usage_limit_per_user != null) {
        const usedByUser = getUserUsageCount(coupon, userId);
        if (usedByUser >= Number(coupon.usage_limit_per_user)) {
            throw new Error('You already reached this coupon usage limit');
        }
    }

    if (Number(subtotal || 0) < Number(coupon.min_order_amount || 0)) {
        throw new Error(`Minimum order amount for this coupon is ${coupon.min_order_amount}`);
    }
};

const resolveScopeMatcher = async (coupon) => {
    const scopeType = coupon.scope_type;

    if (scopeType === 'all_products') {
        return () => true;
    }

    if (scopeType === 'product_list') {
        const productIdSet = new Set((coupon.product_ids || []).map(id => String(id)));
        return (item) => productIdSet.has(String(item.product_id));
    }

    if (scopeType === 'vendor_list') {
        const vendorIdSet = new Set((coupon.vendor_ids || []).map(id => String(id)));
        return (item) => vendorIdSet.has(String(item.vendor_id));
    }

    if (scopeType === 'category_tree') {
        const categoryIds = await getDescendantCategoryIds(coupon.category_ids || []);
        const categoryIdSet = new Set(categoryIds.map(String));
        return (item) => item.category_id && categoryIdSet.has(String(item.category_id));
    }

    return () => false;
};

const computeDiscount = (coupon, eligibleSubtotal) => {
    const discountValue = Number(coupon.discount_value || 0);
    if (eligibleSubtotal <= 0 || discountValue <= 0) return 0;

    let discountAmount = 0;
    if (coupon.discount_type === 'percent') {
        discountAmount = (eligibleSubtotal * discountValue) / 100;
    } else {
        discountAmount = discountValue;
    }

    return Math.max(0, Math.min(discountAmount, eligibleSubtotal));
};

const buildCouponPricing = async ({ coupon, items, userId }) => {
    const subtotal = Number(items.reduce((sum, item) => sum + Number(item.line_total || 0), 0));

    validateCouponWindowAndLimits(coupon, userId, subtotal);

    const isEligibleItem = await resolveScopeMatcher(coupon);
    const eligibleItems = items.filter(isEligibleItem);
    const eligibleSubtotal = Number(eligibleItems.reduce((sum, item) => sum + Number(item.line_total || 0), 0));

    if (eligibleSubtotal <= 0) {
        throw new Error('Coupon is not applicable to items in your cart');
    }

    const discountAmount = Number(computeDiscount(coupon, eligibleSubtotal));
    const finalTotal = Math.max(0, subtotal - discountAmount);

    return {
        coupon: {
            _id: coupon._id,
            code: coupon.code,
            name: coupon.name,
            discount_type: coupon.discount_type,
            discount_value: Number(coupon.discount_value || 0),
            scope_type: coupon.scope_type,
            // Carried to the order so the split is frozen at placement: editing the coupon
            // later must not re-price who paid for a discount already given.
            vendor_share_percent: Number(coupon.vendor_share_percent || 0),
        },
        pricing: {
            subtotal,
            eligible_subtotal: eligibleSubtotal,
            discount_amount: discountAmount,
            final_total: finalTotal,
        },
        eligible_item_ids: eligibleItems.map(item => String(item.product_id)),
    };
};

const findCouponByCode = async (code) => {
    const normalized = normalizeCode(code);
    if (!normalized) throw new Error('Coupon code is required');

    const coupon = await Coupon.findOne({ code: normalized });
    if (!coupon) throw new Error('Invalid coupon code');
    return coupon;
};

const applyCouponToPricedItems = async ({ code, items, userId }) => {
    const coupon = await findCouponByCode(code);
    return await buildCouponPricing({ coupon, items, userId });
};

const consumeCouponUsage = async ({ couponId, userId, session = null }) => {
    if (!couponId || !userId) return;

    const coupon = await Coupon.findById(couponId).select('usage_by_user');
    if (!coupon) return;

    const idx = (coupon.usage_by_user || []).findIndex(entry => String(entry.user_id) === String(userId));

    let update = null;
    if (idx === -1) {
        update = {
            $inc: { used_count: 1 },
            $push: { usage_by_user: { user_id: userId, count: 1 } },
        };
    } else {
        update = {
            $inc: {
                used_count: 1,
                [`usage_by_user.${idx}.count`]: 1,
            },
        };
    }

    const query = { _id: new mongoose.Types.ObjectId(couponId) };
    if (session) {
        await Coupon.findOneAndUpdate(query, update, { session });
    } else {
        await Coupon.findOneAndUpdate(query, update);
    }
};

module.exports = {
    normalizeCode,
    findCouponByCode,
    applyCouponToPricedItems,
    consumeCouponUsage,
    buildCouponPricing,
};
