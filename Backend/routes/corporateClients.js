const express = require('express');
const router = express.Router();
const { corporateClientsShowcase } = require('../services/companyService');

/**
 * @desc    The corporate accounts shown on the home page ("ReadyCar's corporate clients"):
 *          active, with a logo their manager chose to show. Name and logo only.
 * @route   GET /api/corporate-clients
 * @access  Public
 */
router.get('/', async (req, res) => {
    try {
        res.set('Cache-Control', 'public, max-age=300');
        res.json({ success: true, clients: await corporateClientsShowcase() });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
