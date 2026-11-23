const productService = require('./product.service');
const { suggest } = require('./search_suggest.service');

/**
 * GET /api/products/categories
 */
const getCategories = async (req, res) => {
    try {
        const categories = await productService.getCategories();
        res.json(categories);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/**
 * GET /api/products/filters
 */
const getFilters = async (req, res) => {
    try {
        const parts = String(req.query.parts || '').split(',').map((p) => p.trim()).filter(Boolean);
        const filters = await productService.getFilterMetadata(parts, { detail: req.query.detail === 'full' ? 'full' : 'slim' });
        res.set('Cache-Control', 'public, max-age=120');
        res.json(filters);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/**
 * GET /api/products/vessel-brands/:id/models
 */
const getBrandModels = async (req, res) => {
    try {
        const brand = await productService.getVesselBrandModels(req.params.id);
        if (!brand) return res.status(404).json({ message: 'Brand models not found' });
        res.set('Cache-Control', 'public, max-age=300');
        res.json(brand);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/**
 * GET /api/products/suggest
 */
const getSuggestions = async (req, res) => {
    try {
        const result = await suggest(req.query.q, { limit: req.query.limit });
        res.set('Cache-Control', 'public, max-age=30');
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/**
 * GET /api/products
 */
const getAllProducts = async (req, res) => {
    try {
        const result = await productService.getAllProducts(req.query, { user: req.user });
        if (req.user) res.set('Cache-Control', 'private, no-store');
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/**
 * GET /api/products/landing/:section
 */
const getLandingProducts = async (req, res) => {
    try {
        const products = await productService.getLandingProducts(req.params.section, req.query.limit);
        res.json({ products });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/**
 * GET /api/products/slug/:slug
 */
const getProductBySlug = async (req, res) => {
    try {
        const product = await productService.getProductBySlug(req.params.slug);
        if (!product) return res.status(404).json({ message: 'Product not found' });
        res.json(product);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

/**
 * GET /api/products/:id
 */
const getProductById = async (req, res) => {
    try {
        const product = await productService.getProductById(req.params.id, { publicOnly: true });
        if (!product) return res.status(404).json({ message: 'Product not found' });
        res.json(product);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getCategories,
    getFilters,
    getBrandModels,
    getSuggestions,
    getAllProducts,
    getLandingProducts,
    getProductBySlug,
    getProductById,
};
