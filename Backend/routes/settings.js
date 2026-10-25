const express = require('express');
const router = express.Router();
const { SiteSettings } = require('../models/site_settings');

/**
 * @desc    Get global site settings
 * @route   GET /api/settings
 * @access  Public
 */
router.get('/', async (req, res) => {
    try {
        // The abandoned-cart schedule and its run results are the admin's business.
        let settings = await SiteSettings.findOne().select('-abandoned_cart');
        
        // If no settings exist yet, create default settings automatically
        if (!settings) {
            settings = await SiteSettings.create({});
        }

        res.json({ success: true, settings });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
