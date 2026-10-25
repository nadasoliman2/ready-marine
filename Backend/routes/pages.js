const express = require('express');
const router = express.Router();
const { Page } = require('../models/pages');

/**
 * @route   GET /api/pages/:slug
 * @desc    Get a specific page by its slug
 * @access  Public
 */
router.get('/:slug', async (req, res) => {
    try {
        const page = await Page.findOne({ slug: req.params.slug });
        if (!page) {
            return res.status(404).json({ success: false, message: 'Page not found' });
        }
        res.json({ success: true, page });
    } catch (err) {
        console.error('Error fetching page:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
