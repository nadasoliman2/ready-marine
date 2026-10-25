const express = require('express');
const router = express.Router();
const { protect, denyUnclaimedGuest } = require('../middleware/authMiddleware');
const {
    getCustomerWallet,
    getTransactionHistory,
} = require('../services/loyaltyService');

/**
 * Customer-facing loyalty routes.
 *
 * Every handler derives the account from the authenticated session — there is
 * no route here that takes a user id, so one customer can never read another's
 * balance, including a friend they buy for or a family member they organize.
 */

/**
 * @desc    Balance, current monetary value, and the active rules
 * @route   GET /api/users/loyalty
 */
router.get('/', protect('user'), denyUnclaimedGuest, async (req, res) => {
    try {
        const wallet = await getCustomerWallet(req.user._id);
        res.json({ success: true, ...wallet });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Paginated ledger history for this customer
 * @route   GET /api/users/loyalty/transactions
 */
router.get('/transactions', protect('user'), denyUnclaimedGuest, async (req, res) => {
    try {
        const { page, limit, type } = req.query;
        const result = await getTransactionHistory(req.user._id, { page, limit, type });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
