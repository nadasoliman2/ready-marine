/**
 * "My company" — an employee's own view of their company membership.
 * Mounted at /api/users/company.
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const companyService = require('../services/companyService');

const fail = (res, error) => {
    if (!error.status) console.error('[My company]', error);
    return res.status(error.status || 500).json({ code: error.code || 'COMPANY_ERROR', message: error.message });
};

/**
 * @desc    The caller's companies — each with its limit and what is left of it this month.
 *          `{ membership: null, memberships: [] }` for someone in no company. There is no
 *          "leave": an employee who leaves the job is deactivated by the company's manager.
 * @route   GET /api/users/company
 */
router.get('/', protect('user'), async (req, res) => {
    try {
        res.json(await companyService.getMyCompany(req.user._id));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    The caller's own orders on the company account, newest first
 * @route   GET /api/users/company/orders
 */
router.get('/orders', protect('user'), async (req, res) => {
    try {
        res.json(await require('../services/companyOrderService').getMyCompanyOrders(req.user._id, req.query));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    The caller's consolidated parcels: waiting in a batch, or already combined
 * @route   GET /api/users/company/batches
 */
router.get('/batches', protect('user'), async (req, res) => {
    try {
        res.json({ rows: await require('../services/companyBatchService').myBatchParcels(req.user._id) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Take one waiting parcel out of its batch and send it now, at full shipping
 * @route   POST /api/users/company/orders/:orderId/parcels/:subOrderId/ship-now
 */
router.post('/orders/:orderId/parcels/:subOrderId/ship-now', protect('user'), async (req, res) => {
    try {
        await require('../services/companyBatchService').shipNow(req.user._id, req.params.orderId, req.params.subOrderId);
        res.json({ ok: true });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Pay the company's remaining share of one of your own company orders from your
 *          wallet. The company is credited and the amount goes back onto your limit.
 * @route   POST /api/users/company/orders/:orderId/settle
 */
router.post('/orders/:orderId/settle', protect('user'), async (req, res) => {
    try {
        res.json(await require('../services/companyOrderService').settleOrderByEmployee(req.user._id, req.params.orderId));
    } catch (error) {
        fail(res, error);
    }
});

module.exports = router;
