const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const shippingService = require('../services/shippingService');
const shippingEngine = require('../services/shippingEngine');
const { City } = require('../models/cities');

/**
 * @desc   Zone picker tree (countries -> cities) for the checkout dropdown + shipping config flags.
 * @route  GET /api/shipping/zones
 * @access Public
 */
router.get('/zones', async (req, res) => {
    try {
        const [tree, settings] = await Promise.all([
            shippingService.getZonePickerTree(),
            shippingEngine.getSettings(),
        ]);
        res.json({
            tree,
            config: {
                enabled: settings.enabled,
                multi_vendor_mode: settings.multi_vendor_mode,
                // When exactly one country is configured, the UI can skip asking for it.
                single_country: tree.length === 1 ? tree[0].country : null,
                single_country_ar: tree.length === 1 ? (tree[0].country_ar || tree[0].country) : null,
                single_country_has_wildcard: tree.length === 1 ? !!tree[0].has_whole_country_option : false,
            },
        });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

/**
 * @desc   Canonical city list (Bosta-compatible names).
 * @route  GET /api/shipping/cities
 * @access Public
 */
router.get('/cities', async (req, res) => {
    try {
        const cities = await City.find().sort({ name: 1 }).lean();
        res.json({ cities });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

/**
 * @desc   Active shipping classes (for the vendor/admin product form selector).
 * @route  GET /api/shipping/classes
 * @access Public
 */
router.get('/classes', async (req, res) => {
    try {
        const classes = await shippingService.listActiveClasses();
        res.json({ classes });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

/**
 * @desc   Get available shipping methods + costs for a cart and destination.
 * @route  POST /api/shipping/quote
 * @access Private (user)
 */
router.post('/quote', protect('user'), async (req, res) => {
    try {
        const { items, destination } = req.body || {};
        const quote = await shippingEngine.getQuoteForDestination({ items: items || [], destination: destination || {}, useCache: true });
        res.json(quote);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

module.exports = router;
