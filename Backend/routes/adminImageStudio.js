const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const studio = require('../services/imageStudioService');

/**
 * The image studio (services/imageStudioService.js): cleaner product pictures offered before
 * anything changes, and web pictures for products that have none. Mounted under
 * /api/admin/products, so it answers to the products permission like the other product screens.
 */

const fail = (res, error) => res.status(error.status || 500).json({ message: error.message, code: error.code });
const actor = (req) => req.user?.username || 'admin';
const ID = '([0-9a-fA-F]{24})';

/**
 * @desc    Counts for the studio's tabs, and whether the image service is up
 * @route   GET /api/admin/products/image-studio/summary?status=all|published|pending|draft
 */
router.get('/summary', protect('admin'), async (req, res) => {
    try {
        res.json(await studio.summary({ status: req.query.status || 'all' }));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    One tab of the studio
 * @route   GET /api/admin/products/image-studio?tab=suggestions|working|no_images|not_clean&status=&q=&page=&limit=
 */
router.get('/', protect('admin'), async (req, res) => {
    try {
        res.json(await studio.listStudio({
            tab: req.query.tab, status: req.query.status, q: req.query.q, page: req.query.page, limit: req.query.limit,
        }));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Ask for cleaner pictures for several products (at most 50)
 * @route   POST /api/admin/products/image-studio/queue   body: { product_ids: [] }
 */
router.post('/queue', protect('admin'), async (req, res) => {
    try {
        res.json(await studio.queueMany(req.body?.product_ids, actor(req)));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Take a suggestion: the cleaned picture replaces its original, which stays at the end
 * @route   POST /api/admin/products/image-studio/suggestions/:id/apply   body: { option_url?, keep_original?, make_main? }
 */
router.post(`/suggestions/:id${ID}/apply`, protect('admin'), async (req, res) => {
    try {
        const keep = req.body?.keep_original === undefined ? true : !!req.body.keep_original;
        const makeMain = req.body?.make_main === undefined ? undefined : !!req.body.make_main;
        res.json(await studio.applySuggestion(req.params.id, { option_url: req.body?.option_url, keep_original: keep, make_main: makeMain }, actor(req)));
    } catch (error) {
        fail(res, error);
    }
});

/** @route POST /api/admin/products/image-studio/suggestions/:id/dismiss */
router.post(`/suggestions/:id${ID}/dismiss`, protect('admin'), async (req, res) => {
    try {
        res.json({ suggestion: await studio.dismissSuggestion(req.params.id, actor(req)) });
    } catch (error) {
        fail(res, error);
    }
});

/** @route POST /api/admin/products/image-studio/suggestions/:id/retry */
router.post(`/suggestions/:id${ID}/retry`, protect('admin'), async (req, res) => {
    try {
        res.json({ suggestion: await studio.retrySuggestion(req.params.id) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    A product's pictures, its suggestions, and the web query its details make
 * @route   GET /api/admin/products/image-studio/:productId
 */
router.get(`/:productId${ID}`, protect('admin'), async (req, res) => {
    try {
        res.json(await studio.forProduct(req.params.productId));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Make cleaner versions of the product's pictures
 * @route   POST /api/admin/products/image-studio/:productId/suggest   body: { force? }
 */
router.post(`/:productId${ID}/suggest`, protect('admin'), async (req, res) => {
    try {
        res.json(await studio.queueProduct(req.params.productId, { by: actor(req), force: !!req.body?.force }));
    } catch (error) {
        fail(res, error);
    }
});

/** @route POST /api/admin/products/image-studio/:productId/apply-all */
router.post(`/:productId${ID}/apply-all`, protect('admin'), async (req, res) => {
    try {
        res.json(await studio.applyAll(req.params.productId, actor(req)));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Pictures of this product found on the web (Bing image search, no LLM)
 * @route   GET /api/admin/products/image-studio/:productId/web-search?q=
 */
router.get(`/:productId${ID}/web-search`, protect('admin'), async (req, res) => {
    try {
        res.json(await studio.webSearchForProduct(req.params.productId, req.query.q));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Use a web picture: downloaded, cleaned, then offered like any suggestion
 * @route   POST /api/admin/products/image-studio/:productId/web-pick   body: { image_url, page_url?, title?, query? }
 */
router.post(`/:productId${ID}/web-pick`, protect('admin'), async (req, res) => {
    try {
        res.json({ suggestion: await studio.pickWebImage(req.params.productId, req.body || {}, actor(req)) });
    } catch (error) {
        fail(res, error);
    }
});

module.exports = router;
