/**
 * Public Bundles Router — storefront-facing bundle endpoints (no auth).
 */
const express = require('express');
const router = express.Router();
const {
    getLandingBundles,
    getPublicBundleBySlug,
    getPublicBundleById,
} = require('../services/bundleService');

/**
 * @desc    Bundles for the homepage row
 * @route   GET /api/bundles/landing
 */
router.get('/landing', async (req, res) => {
    try {
        const bundles = await getLandingBundles(req.query.limit ? Number(req.query.limit) : 8);
        res.json({ bundles });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Public bundle by slug
 * @route   GET /api/bundles/slug/:slug
 */
router.get('/slug/:slug', async (req, res) => {
    try {
        const bundle = await getPublicBundleBySlug(req.params.slug);
        if (!bundle) return res.status(404).json({ message: 'Bundle not found' });
        res.json({ bundle });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Public bundle by id
 * @route   GET /api/bundles/:id
 */
router.get('/:id([0-9a-fA-F]{24})', async (req, res) => {
    try {
        const bundle = await getPublicBundleById(req.params.id);
        if (!bundle) return res.status(404).json({ message: 'Bundle not found' });
        res.json({ bundle });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
