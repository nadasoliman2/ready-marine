const express = require('express');
const rawBody = require('../middleware/rawBody');
const everysecond = require('../services/everysecond');
const { verifySignature } = require('../services/everysecond/helpers');

/*
 * EverySecond webhook — chat orders (Backend/docs/EVERYSECOND_CHAT_COMMERCE.md).
 *
 * Mounted in app.js BEFORE express.json(): the signature is an HMAC over the
 * exact bytes sent, and re-serialising parsed JSON would not reproduce them.
 *
 * order.validate is synchronous — EverySecond waits up to four seconds. Anything
 * slower is cut off here and answered 503, which the agent treats as "no
 * webhook": the sale carries on, and order.created places ours when it arrives.
 * Every other event is answered 2xx as soon as it is stored and applied after.
 */
const router = express.Router();

const validateTimeoutMs = () => {
    const ms = Number.parseInt(process.env.EVERYSECOND_VALIDATE_TIMEOUT_MS, 10);
    return Math.min(3800, Math.max(1000, Number.isFinite(ms) ? ms : 3500));
};

router.post('/', rawBody({ limit: 2 * 1024 * 1024 }), async (req, res) => {
    const secret = process.env.EVERYSECOND_WEBHOOK_SECRET;
    if (!secret) return res.status(503).json({ error: 'EverySecond webhook is not configured' });

    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!verifySignature({ header: req.get('X-EverySecond-Signature'), rawBody: raw, secret })) {
        return res.status(400).json({ error: 'Invalid signature' });
    }
    let envelope;
    try {
        envelope = JSON.parse(raw.toString('utf8'));
    } catch {
        return res.status(400).json({ error: 'Body is not JSON' });
    }
    const event = req.get('X-EverySecond-Event') || envelope?.event || '';
    const eventId = req.get('X-EverySecond-Event-Id') || envelope?.id || '';

    try {
        const work = everysecond.receiveEvent({ eventId, event, envelope });
        const result = event === 'order.validate'
            ? await Promise.race([work, new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), validateTimeoutMs()))])
            : await work;

        if (result.timedOut) return res.status(503).json({ error: 'No answer in time' });
        if (result.sync) return res.status(200).json(result.answer);
        res.status(200).json({ received: true });
        if (result.process) setImmediate(result.process);
    } catch (err) {
        console.error(`[everysecond] webhook ${event} failed:`, err?.message || err);
        // A 5xx makes EverySecond retry an event, and means "no answer" for a validation.
        if (!res.headersSent) res.status(500).json({ error: 'Could not process the event' });
    }
});

module.exports = router;
