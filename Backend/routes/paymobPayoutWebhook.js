const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const { WithdrawalRequest } = require('../models/withdrawalRequests');
const vendorPayouts = require('../services/vendorPayoutService');

/**
 * Paymob Payouts status callback (bank and Aman transfers only — wallets answer on the spot).
 * Registered by hand in the Paymob Payouts dashboard (sidebar → CallBack Url) as
 *   https://readycar.store/api/webhooks/paymob-payouts/<PAYMOB_PAYOUT_CALLBACK_SECRET>
 *
 * The callback is NOT signed, so its body is never trusted: it only tells us WHICH transfer
 * to look at, and the status is then read from Paymob's authenticated inquiry API. A forged
 * call can at most make us ask Paymob a question.
 */
const secretMatches = (given) => {
    const expected = process.env.PAYMOB_PAYOUT_CALLBACK_SECRET || '';
    if (!expected || !given) return false;
    const a = Buffer.from(String(given));
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};

router.post('/:secret', async (req, res) => {
    if (!secretMatches(req.params.secret)) return res.status(404).json({ success: false });

    const txId = req.body?.transaction_id ? String(req.body.transaction_id) : null;
    // Answer at once: Paymob only needs to know we received it.
    res.json({ success: true });
    if (!txId) return;

    try {
        const payout = await WithdrawalRequest.findOne({ channel: 'paymob', 'gateway.transaction_id': txId }).select('_id').lean();
        if (!payout) {
            console.warn(`[Payouts] Paymob callback for unknown transaction ${txId}`);
            return;
        }
        await WithdrawalRequest.updateOne(
            { _id: payout._id },
            {
                $push: {
                    'gateway.attempts': {
                        $each: [{
                            kind: 'callback',
                            at: new Date(),
                            disbursement_status: req.body?.disbursement_status ?? null,
                            status_code: req.body?.status_code != null ? String(req.body.status_code) : null,
                            raw: req.body,
                        }],
                        $slice: -50,
                    },
                },
            }
        );
        await vendorPayouts.refreshPayout(payout._id);
    } catch (err) {
        console.error(`[Payouts] Paymob callback for ${txId} failed: ${err.message}`);
    }
});

module.exports = router;
