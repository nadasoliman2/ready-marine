const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getPricedOrderPreview } = require('../services/orderService');

router.post('/validate', protect('user'), async (req, res) => {
    try {
        const { code, items } = req.body || {};
        if (!code) {
            return res.status(400).json({ message: 'Coupon code is required' });
        }

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ message: 'Cart items are required' });
        }

        const preview = await getPricedOrderPreview({
            userId: req.user._id,
            items,
            couponCode: code,
        });

        if (!preview.couponResult) {
            return res.status(400).json({ message: 'Coupon is not applicable' });
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
});

module.exports = router;
