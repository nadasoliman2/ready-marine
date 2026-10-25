const express = require('express');
const { optionalUser } = require('../middleware/authMiddleware');
const rawBody = require('../middleware/rawBody');
const assistant = require('../services/everysecond/assistant');

/*
 * The website chat with the AI assistant (Backend/docs/EVERYSECOND_CHAT_COMMERCE.md).
 *
 * Public: a guest can ask before they have an account. A guest is identified by
 * the random `sessionId` their browser keeps, a signed-in customer by their
 * session cookie (optionalUser). A vendor or admin session is treated as a
 * guest — those accounts cannot buy.
 */
const router = express.Router();

const localeOf = (req) => (String(req.query?.locale ?? req.body?.locale ?? '').toLowerCase() === 'en' ? 'en' : 'ar');
const identityOf = (req) => assistant.identityFor({
    user: req.user || null,
    sessionId: req.query?.sessionId ?? req.body?.sessionId,
    locale: localeOf(req),
});
// Behind nginx the socket address is the proxy's; the first forwarded hop is the visitor.
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';

const handle = (fn) => async (req, res) => {
    try {
        res.json({ success: true, data: await fn(req) });
    } catch (err) {
        const status = err.status >= 400 && err.status < 600 ? err.status : 500;
        if (status >= 500 && !err.status) console.error('[assistant]', err?.message || err);
        res.status(status).json({ success: false, message: status === 500 && !err.status ? 'Something went wrong' : err.message });
    }
};

router.get('/messages', optionalUser, handle(async (req) => {
    // Before a guest has a session id there is nothing to read — say only whether the assistant is on.
    if (!req.user && !req.query?.sessionId) {
        return { enabled: assistant.isConfigured(), messages: [], cart: null, cartSync: assistant.cartSyncEnabled() };
    }
    return assistant.history({ identity: identityOf(req), after: req.query?.after });
}));

router.post('/messages', optionalUser, handle((req) => assistant.send({
    identity: identityOf(req),
    message: req.body?.message,
    locale: localeOf(req),
    ip: clientIp(req),
})));

// The recording is the raw request body, so the session and language ride in the query.
router.post(
    '/voice',
    optionalUser,
    rawBody({ limit: assistant.MAX_VOICE_BYTES, message: 'Voice notes can be up to two minutes' }),
    handle((req) => assistant.sendVoice({
        identity: identityOf(req),
        audio: req.body,
        contentType: req.get('content-type'),
        locale: localeOf(req),
        ip: clientIp(req),
    }))
);

// Start a new conversation.
router.delete('/messages', optionalUser, handle((req) => assistant.reset({ identity: identityOf(req) })));

// The website cart, kept in step with the chat basket.
router.put('/cart', optionalUser, handle((req) => assistant.syncCart({
    identity: identityOf(req),
    items: req.body?.items,
    create: req.body?.create === true,
    locale: localeOf(req),
    ip: clientIp(req),
})));
router.delete('/cart', optionalUser, handle((req) => assistant.closeCart({
    identity: identityOf(req),
    reason: req.query?.reason ?? req.body?.reason,
})));

module.exports = router;
