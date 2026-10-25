const express = require('express');
const router = express.Router();
const { getAllProducts, getLandingProducts, getProductById, getCategories } = require('../services/productService');
const { optionalUser } = require('../middleware/authMiddleware');

// GET /api/products/categories
router.get('/categories', async (req, res) => {
    console.log('HIT /categories route');
    try {
        const categories = await getCategories();
        res.json(categories);
    } catch (error) {
        console.error('Categories Error:', error);
        res.status(500).json({ message: error.message });
    }
});

// GET /api/products/filters
router.get('/filters', async (req, res) => {
    try {
        const { getFilterMetadata } = require('../services/productService');
        // `?parts=categories,productBrands` for a screen that only draws those two filters.
        // Unset means everything, so no existing caller changes behaviour.
        const parts = String(req.query.parts || '').split(',').map((p) => p.trim()).filter(Boolean);
        // `detail=full` expands every car make's models and years — 1.9MB on this install.
        // Only the product forms need that; everything else gets the makes alone.
        const filters = await getFilterMetadata(parts, { detail: req.query.detail === 'full' ? 'full' : 'slim' });
        // This payload is dominated by near-static reference data (car brands/models/
        // years); letting the browser reuse it for a couple of minutes turns "every
        // product page re-downloads several MB" into "downloaded once per session".
        // Kept short so an admin's edit is never stale for long, and the server-side
        // cache above is invalidated immediately on write regardless.
        res.set('Cache-Control', 'public, max-age=120');
        res.json(filters);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET /api/products/car-brands/:id/models — the models of one make, on demand
router.get('/car-brands/:id/models', async (req, res) => {
    try {
        const { getCarBrandModels } = require('../services/productService');
        const brand = await getCarBrandModels(req.params.id);
        if (!brand) return res.status(404).json({ message: 'Car brand not found' });
        // Same reasoning as the filters payload: near-static reference data.
        res.set('Cache-Control', 'public, max-age=300');
        res.json(brand);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET /api/products/suggest?q=…  — search-as-you-type for the search box
router.get('/suggest', async (req, res) => {
    try {
        const { suggest } = require('../services/searchSuggestService');
        const result = await suggest(req.query.q, { limit: req.query.limit });
        // Identical keystrokes from many visitors ("فلتر", "brake") are worth a short cache.
        res.set('Cache-Control', 'public, max-age=30');
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET /api/products — a signed-in customer's list puts what fits their garage first, so the
// answer depends on who asks and must not be shared by a cache.
router.get('/', optionalUser, async (req, res) => {
    try {
        const result = await getAllProducts(req.query, { user: req.user });
        if (req.user) res.set('Cache-Control', 'private, no-store');
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET /api/products/landing/:section
router.get('/landing/:section', async (req, res) => {
    try {
        const products = await getLandingProducts(req.params.section, req.query.limit);
        res.json({ products });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET /api/products/slug/:slug
router.get('/slug/:slug', async (req, res) => {
    try {
        const { getProductBySlug } = require('../services/productService');
        const product = await getProductBySlug(req.params.slug);
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }
        res.json(product);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET /api/products/:id (Hex ID validation)
router.get('/:id([0-9a-fA-F]{24})', async (req, res) => {
    try {
        const product = await getProductById(req.params.id, { publicOnly: true });
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }
        res.json(product);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
