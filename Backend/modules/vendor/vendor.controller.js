const vendorService = require("./vendor.service");

/**
 * GET /api/vendors/stats
 */
const getStats = async (req, res) => {
    try {
        const stats = await vendorService.getVendorDashboardStats(req.user._id, { range: req.query.range });
        res.json({ success: true, stats });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * GET /api/vendors/orders/counts
 */
const getOrderCounts = async (req, res) => {
    try {
        const counts = await vendorService.getVendorOrderCounts(req.user._id);
        res.json({ success: true, counts });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * GET /api/vendors/sub-orders
 */
const getSubOrders = async (req, res) => {
    try {
        const result = await vendorService.getVendorSubOrders(req.user._id, { tab: req.query.tab || null });
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getStats,
    getOrderCounts,
    getSubOrders,
};
