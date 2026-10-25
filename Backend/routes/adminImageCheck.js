const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const imageCheckService = require('../services/imageCheckService');

/**
 * The image check — products whose pictures look wrong (services/imageCheckService.js).
 * Mounted under /api/admin/products, so it answers to the products permission like the
 * fitment check beside it.
 */

const fail = (res, error) => res.status(error.status || 500).json({ message: error.message });

/**
 * @desc    The worklist, worst first
 * @route   GET /api/admin/products/image-check?status=published|pending|draft|all&severity=high|medium|low&type=&vendor_id=&q=&page=&limit=
 */
router.get('/', protect('admin'), async (req, res) => {
    try {
        res.json(await imageCheckService.listImageIssues({
            status: req.query.status || 'published',
            severity: req.query.severity || 'low',
            type: req.query.type || '',
            vendor_id: req.query.vendor_id || '',
            q: req.query.q || '',
            page: req.query.page,
            limit: req.query.limit,
        }));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Measure new pictures now (instead of within ten minutes)
 * @route   POST /api/admin/products/image-check/scan
 */
router.post('/scan', protect('admin'), async (req, res) => {
    try {
        imageCheckService.kick();
        res.json({ progress: imageCheckService.progress() });
    } catch (error) {
        fail(res, error);
    }
});

/** @route GET /api/admin/products/image-check/:id */
router.get('/:id([0-9a-fA-F]{24})', protect('admin'), async (req, res) => {
    try {
        res.json(await imageCheckService.checkProductImages(req.params.id));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    The pictures are fine: off the worklist until they change
 * @route   POST /api/admin/products/image-check/:id/dismiss   body: { signature }
 */
router.post('/:id([0-9a-fA-F]{24})/dismiss', protect('admin'), async (req, res) => {
    try {
        res.json({ message: 'Marked good', ...(await imageCheckService.dismissImageIssues(req.params.id, req.body || {}, req.user?.username || 'admin')) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Put one of the product's pictures first
 * @route   POST /api/admin/products/image-check/:id/make-main   body: { url, signature }
 */
router.post('/:id([0-9a-fA-F]{24})/make-main', protect('admin'), async (req, res) => {
    try {
        res.json({ message: 'Main picture changed', ...(await imageCheckService.makeMainImage(req.params.id, req.body || {})) });
    } catch (error) {
        fail(res, error);
    }
});

/** @route POST /api/admin/products/image-check/:id/restore — undo "the pictures are fine" */
router.post('/:id([0-9a-fA-F]{24})/restore', protect('admin'), async (req, res) => {
    try {
        res.json({ message: 'Back on the list', ...(await imageCheckService.restoreImageIssues(req.params.id)) });
    } catch (error) {
        fail(res, error);
    }
});

module.exports = router;
