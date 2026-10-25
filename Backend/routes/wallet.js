const express = require('express');
const router = express.Router();
const { protect, denyUnclaimedGuest } = require('../middleware/authMiddleware');
const walletService = require('../services/walletService');
const walletTopupService = require('../services/walletTopupService');
const { verifyPaidWebhookHash } = require('../services/fawaterakService');

/**
 * Customer-facing wallet routes.
 *
 * Every handler except the provider webhook derives the account from the
 * authenticated session. There is no route here that accepts a user id, so one
 * customer can never read or move another's balance — including a friend they
 * buy for or a family member they organize.
 */

const statusForCode = (code) => ({
    TOPUP_NOT_FOUND: 404,
    USER_NOT_FOUND: 404,
    TOPUP_REFERENCE_REQUIRED: 400,
    INVALID_AMOUNT: 400,
    TOPUP_DISABLED: 409,
    WALLET_FROZEN: 423,
    INSUFFICIENT_BALANCE: 402,
}[code] || 400);

/**
 * @desc    Balance, top-up options, and whether the wallet is live
 * @route   GET /api/users/wallet
 */
router.get('/', protect('user'), denyUnclaimedGuest, async (req, res) => {
    try {
        const wallet = await walletService.getCustomerWallet(req.user._id);
        res.json({ success: true, ...wallet });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Paginated statement for this customer
 * @route   GET /api/users/wallet/transactions
 */
router.get('/transactions', protect('user'), denyUnclaimedGuest, async (req, res) => {
    try {
        const { page, limit, type } = req.query;
        const result = await walletService.getTransactionHistory(req.user._id, { page, limit, type });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    This customer's top-up attempts, paid or not
 * @route   GET /api/users/wallet/topups
 */
router.get('/topups', protect('user'), denyUnclaimedGuest, async (req, res) => {
    try {
        const result = await walletTopupService.listTopups(req.user._id, req.query);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Start a top-up and hand back the hosted payment URL
 * @route   POST /api/users/wallet/topups
 *
 * `amount` is whatever the customer asked for — either the exact shortfall
 * checkout computed for them, or a figure they typed. It is validated as money
 * here and nowhere else trusts it.
 */
router.post('/topups', protect('user'), denyUnclaimedGuest, async (req, res) => {
    try {
        const { amount, origin, return_path } = req.body || {};
        const topup = await walletTopupService.createTopup({
            userId: req.user._id,
            amount,
            origin,
            returnPath: return_path,
        });

        res.status(201).json({
            success: true,
            paymentUrl: topup.payment_url,
            topup: {
                id: topup._id,
                amount: walletService.toMajor(topup.amount_minor),
                currency: topup.currency,
                status: topup.status,
            },
        });
    } catch (err) {
        res.status(statusForCode(err.code)).json({ success: false, code: err.code, message: err.message });
    }
});

/**
 * @desc    Confirm a top-up after the gateway redirect
 * @route   POST /api/users/wallet/topups/confirm
 *
 * The redirect URL is under the customer's control, so this re-reads the
 * invoice from Fawaterak rather than believing `?topup=success`.
 */
router.post('/topups/confirm', protect('user'), denyUnclaimedGuest, async (req, res) => {
    try {
        const { topupId, invoice_id } = req.body || {};
        const result = await walletTopupService.confirmTopup({
            userId: req.user._id,
            topupId,
            invoiceId: invoice_id,
        });

        if (result.status !== 'paid') {
            return res.json({ success: true, status: result.status, message: 'Top-up is not confirmed yet' });
        }

        const balances = await walletService.getBalances(req.user._id);
        res.json({
            success: true,
            status: 'paid',
            message: result.alreadyCredited ? 'Top-up was already credited' : 'Wallet topped up successfully',
            amount: walletService.toMajor(result.topup.amount_minor),
            balances,
        });
    } catch (err) {
        res.status(statusForCode(err.code)).json({ success: false, code: err.code, message: err.message });
    }
});

/**
 * @desc    Fawaterak paid webhook for wallet top-ups
 * @route   POST /api/users/wallet/fawaterak/webhook_json
 *
 * Unauthenticated by nature — the provider calls it — so the HMAC signature is
 * the only thing standing between this endpoint and free money. It is verified
 * before the payload is looked at.
 */
router.post('/fawaterak/webhook_json', async (req, res) => {
    try {
        if (!verifyPaidWebhookHash(req.body)) {
            return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
        }

        if (String(req.body.invoice_status || '').toLowerCase() !== 'paid') {
            return res.json({ success: true, ignored: true });
        }

        const topup = await walletTopupService.findTopupFromWebhook(req.body);
        if (!topup) {
            // Not ours — order payments post to their own webhook, but a
            // misrouted call must not read as a failure the provider retries.
            return res.status(404).json({ success: false, message: 'Top-up not found' });
        }

        // A record opened on Paymob can never be settled by a Fawaterak
        // callback. Both providers hand us numeric ids, so a collision between
        // a Fawaterak invoice id and a Paymob order id is unlikely but not
        // impossible — and settling the wrong payment is not a mistake that can
        // be walked back.
        if (topup.provider !== 'fawaterak') {
            return res.json({ success: true, ignored: true, reason: 'record belongs to another provider' });
        }

        await walletTopupService.creditPaidTopup(topup, { ...req.body, source: 'webhook' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
