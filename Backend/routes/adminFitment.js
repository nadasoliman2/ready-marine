const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const fitmentCheckService = require('../services/fitmentCheckService');

/**
 * The fitment check — products whose title or description names cars their fitment does not
 * (services/fitmentCheckService.js). Mounted under /api/admin/products, so it answers to the
 * products permission like the rest of the product screens.
 */

const fail = (res, error) => res.status(error.status || 500).json({ message: error.message });

/**
 * @desc    The worklist: products with fitment findings, most serious first
 * @route   GET /api/admin/products/fitment-check?status=published|pending|draft|all&type=&severity=&vendor_id=&q=&page=&limit=
 */
router.get('/', protect('admin'), async (req, res) => {
    try {
        res.json(await fitmentCheckService.listFitmentIssues({
            status: req.query.status || 'published',
            type: req.query.type || '',
            severity: req.query.severity || 'medium',
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
 * @desc    One product's findings
 * @route   GET /api/admin/products/fitment-check/:id
 */
router.get('/:id([0-9a-fA-F]{24})', protect('admin'), async (req, res) => {
    try {
        res.json(await fitmentCheckService.checkProductFitment(req.params.id));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Add the cars / set the years the admin accepted
 * @route   POST /api/admin/products/fitment-check/:id/apply   body: { changes: [{ make_id, model_id, years, all_years }] }
 */
router.post('/:id([0-9a-fA-F]{24})/apply', protect('admin'), async (req, res) => {
    try {
        res.json({ message: 'Fitment updated', ...(await fitmentCheckService.applyFitmentFix(req.params.id, req.body?.changes)) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    The fitment is right as it is: off the worklist until the findings change
 * @route   POST /api/admin/products/fitment-check/:id/dismiss
 */
router.post('/:id([0-9a-fA-F]{24})/dismiss', protect('admin'), async (req, res) => {
    try {
        res.json({ message: 'Dismissed', ...(await fitmentCheckService.dismissFitmentIssues(req.params.id)) });
    } catch (error) {
        fail(res, error);
    }
});

module.exports = router;
