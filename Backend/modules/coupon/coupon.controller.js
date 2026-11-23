const { getPricedOrderPreview } = require("../order/order.service");
const couponService = require("./coupon.service");
const { validateCouponInput } = require("./coupon.validation");

/**
 * Validate coupon code against cart items
 * POST /api/coupons/validate
 */
const validateCoupon = async (req, res) => {
    try {
        const { code, items } = req.body || {};
        if (!code) {
            return res.status(400).json({ message: "Coupon code is required" });
        }

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: "Cart items are required" });
        }

        const preview = await getPricedOrderPreview({
            userId: req.user._id,
            items,
            couponCode: code,
        });

        if (!preview.couponResult) {
            return res.status(400).json({ message: "Coupon is not applicable" });
        }

        return res.json({
            success: true,
            coupon: preview.couponResult.coupon,
            pricing: preview.couponResult.pricing,
            eligible_item_ids: preview.couponResult.eligible_item_ids,
        });
    } catch (error) {
        return res.status(400).json({ message: error.message });
    }
};

/**
 * Get all coupons (Admin)
 * GET /api/admin/coupons
 */
const getCoupons = async (req, res) => {
    try {
        const coupons = await couponService.getAllCoupons?.() || [];
        res.json({ success: true, coupons });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Create new coupon (Admin)
 * POST /api/admin/coupons
 */
const createCoupon = async (req, res) => {
    try {
        const { isValid, errors } = validateCouponInput(req.body);
        if (!isValid) return res.status(400).json({ success: false, message: errors.join(" - ") });

        const coupon = await couponService.createCoupon?.(req.body);
        res.status(201).json({ success: true, coupon });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

module.exports = {
    validateCoupon,
    getCoupons,
    createCoupon,
};
