const orderService = require("./order.service");

/**
 * POST /api/orders
 * Create order
 */
const createOrder = async (req, res) => {
    try {
        const order = await orderService.createOrder(req.body, req.user);
        res.status(201).json({ success: true, order });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

/**
 * GET /api/orders
 * List customer orders
 */
const getMyOrders = async (req, res) => {
    try {
        const orders = await orderService.getOrdersByUser(req.user._id);
        res.json({ success: true, orders });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * GET /api/orders/:id
 */
const getOrder = async (req, res) => {
    try {
        const order = await orderService.getOrderById(req.params.id, req.user);
        if (!order) return res.status(404).json({ success: false, message: "Order not found" });
        res.json({ success: true, order });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createOrder,
    getMyOrders,
    getOrder,
};
