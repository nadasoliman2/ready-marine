/**
 * Subscription Middleware
 * Gates product publishing behind active subscription checks.
 */
const { requireActiveSubscription, requireProductLimit } = require('../services/vendorSubscriptionService');

/**
 * Middleware: Requires vendor to have an active subscription.
 * Blocks product publish/edit operations.
 */
const requireSubscription = async (req, res, next) => {
    try {
        const vendorId = req.user._id;
        await requireActiveSubscription(vendorId);
        next();
    } catch (error) {
        if (error.code === 'NO_SUBSCRIPTION') {
            return res.status(403).json({
                success: false,
                code: error.code,
                message: error.message,
            });
        }
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Middleware: Requires vendor to have available product publishing slots.
 * Must be used after requireSubscription.
 */
const requireProductQuota = async (req, res, next) => {
    try {
        const vendorId = req.user._id;
        const result = await requireProductLimit(vendorId);
        req.subscriptionQuota = result;
        next();
    } catch (error) {
        if (error.code === 'NO_SUBSCRIPTION') {
            return res.status(403).json({
                success: false,
                code: error.code,
                message: error.message,
            });
        }
        if (error.code === 'PRODUCT_LIMIT_REACHED') {
            return res.status(403).json({
                success: false,
                code: error.code,
                message: error.message,
                maxProducts: error.maxProducts,
                currentCount: error.currentCount,
            });
        }
        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    requireSubscription,
    requireProductQuota,
};