/**
 * Paymob's two callbacks, for all four payment flows.
 *
 * Both routes are PUBLIC — Paymob has no session with us — and both are
 * authenticated by the HMAC-SHA512 signature on the payload rather than by a
 * logged-in user.
 *
 *   POST /api/payments/paymob/webhook   server-to-server, JSON, settles money
 *   GET  /api/payments/paymob/return    the customer's browser, routes only
 *
 * One endpoint each, shared by orders, wallet top-ups, vendor subscriptions and
 * supply orders, because Paymob honours a per-request callback URL only for
 * card integration ids — every other method uses the single URL configured on
 * the integration id in their dashboard. `paymentFlows` does the dispatch.
 */

const express = require('express');
const router = express.Router();

const paymob = require('../services/paymobService');
const flows = require('../services/paymentFlows');

const getFrontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

/**
 * Acknowledge a callback we cannot act on.
 *
 * Deliberately a 200. A callback for a row we do not recognise is not a failure
 * Paymob can fix by retrying, and an error status would have them redeliver it
 * on a schedule for days. The log line is what a human needs; the 200 is what
 * stops the noise.
 */
const acknowledge = (res, reason, detail = {}) => {
    console.warn(`[Paymob] Ignoring callback: ${reason}`, detail);
    return res.json({ success: true, ignored: true, reason });
};

/**
 * Keep a callback we are not acting on, without changing the record's status.
 *
 * A kiosk reference that is never redeemed, or a card that was declined, still
 * leaves a trail worth having when a customer calls to ask what happened.
 */
const recordPendingPayload = async (flow, record, payload) => {
    try {
        if (flow === 'supply') {
            record.payment.webhook_payloads.push(payload);
            if (payload.payment_method) record.payment.payment_method = payload.payment_method;
        } else {
            record.webhook_payloads.push(payload);
            if (payload.payment_method) record.payment_method = payload.payment_method;
        }
        await record.save();
    } catch (err) {
        console.error(`[Paymob] Could not record pending payload on ${flow} ${record._id}: ${err.message}`);
    }
};

/**
 * @desc    Transaction processed callback — the one that moves money
 * @route   POST /api/payments/paymob/webhook
 */
router.post('/webhook', async (req, res) => {
    try {
        // The signature travels in the QUERY STRING of the notification URL,
        // not in the body. Verified before anything is read out of the payload,
        // because an unsigned body is just a stranger's JSON.
        if (!paymob.verifyProcessedCallback(req.body, req.query.hmac)) {
            return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
        }

        const txn = paymob.normalizeTransaction(req.body);
        const reference = txn.merchant_order_id;

        const found = await flows.findByReference(reference)
            || await flows.findByPaymobOrderId(txn.order_id);

        if (!found) {
            return acknowledge(res, 'no matching payment record', {
                reference,
                order_id: txn.order_id,
            });
        }

        const { flow, handler, record } = found;

        // A record opened on Fawaterak can never be settled by a Paymob
        // callback. If this fires, a reference has collided or a callback has
        // been replayed against the wrong row — either way, do not touch money.
        const provider = flows.providerOf(flow, record);
        if (provider !== 'paymob') {
            return acknowledge(res, `record belongs to ${provider}, not paymob`, { reference });
        }

        const payload = {
            source: 'webhook',
            invoice_id: txn.order_id,
            invoice_key: flow === 'supply' ? record.payment?.invoice_key : record.invoice_key,
            transaction_id: txn.transaction_id,
            payment_method: txn.payment_method,
            paid_at: txn.paid_at,
            raw: txn.raw,
        };

        // A kiosk payment announces itself twice: once when the reference is
        // issued (pending, no money yet) and once when the customer hands over
        // cash. Settling on the first would credit a wallet nobody has funded,
        // so the payload is recorded for support and the row stays pending.
        if (txn.pending) {
            await recordPendingPayload(flow, record, payload);
            return res.json({ success: true, pending: true });
        }

        if (!txn.paid) {
            await recordPendingPayload(flow, record, payload);
            return acknowledge(res, 'transaction did not succeed', {
                reference,
                error_occured: txn.error_occured,
            });
        }

        await handler.settle(record, payload);
        res.json({ success: true });
    } catch (err) {
        console.error('[Paymob] Webhook failed:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Transaction response callback — send the customer back where they started
 * @route   GET /api/payments/paymob/return
 *
 * This route settles NOTHING. It exists because Paymob redirects every payment
 * to one URL, and the four flows each have their own page the customer expects
 * to land on. The page they land on then confirms the payment through its own
 * endpoint, which re-reads the payment from Paymob — so a forged query string
 * gets a customer a redirect and nothing more.
 */
router.get('/return', async (req, res) => {
    try {
        // Worth checking even though nothing here depends on it: a failing
        // signature means either a hand-typed URL or a misconfigured HMAC
        // secret, and the second one is worth finding before go-live.
        if (!paymob.verifyRedirectCallback(req.query)) {
            console.warn('[Paymob] Redirect arrived with an invalid or missing HMAC', {
                order: paymob.redirectOrderId(req.query),
            });
        }

        const txn = paymob.normalizeTransaction(req.query);
        const status = txn.paid ? 'success' : (txn.pending ? 'pending' : 'failed');

        const found = await flows.findByReference(txn.merchant_order_id)
            || await flows.findByPaymobOrderId(paymob.redirectOrderId(req.query));

        if (!found) {
            console.error('[Paymob] Redirect could not be matched to a payment', {
                order: paymob.redirectOrderId(req.query),
                reference: txn.merchant_order_id,
            });
            return res.redirect(`${getFrontendUrl()}/?payment=${status}`);
        }

        return res.redirect(found.handler.returnUrl(found.record, status));
    } catch (err) {
        console.error('[Paymob] Redirect handling failed:', err.message);
        res.redirect(`${getFrontendUrl()}/?payment=failed`);
    }
});

module.exports = router;
