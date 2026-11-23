const express = require('express');
const { optionalUser } = require('../../middleware/authMiddleware');
const rawBody = require('../../middleware/rawBody');
const assistant = require('../admin/everysecond/assistant');
const { Product } = require('../../models/products');

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
const phoneOf = (req) => String(req.query?.phone ?? req.body?.phone ?? '').trim();
const identityOf = (req) => assistant.identityFor({
    user: req.user || null,
    sessionId: req.query?.sessionId ?? req.body?.sessionId,
    phone: phoneOf(req),
    locale: localeOf(req),
});
// Behind nginx the socket address is the proxy's; the first forwarded hop is the visitor.
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';

// In-memory local message history for dev/fallback mode
const localSessions = new Map();

async function localFallbackReply(text, locale) {
    const q = String(text || '').trim().toLowerCase();
    const isAr = locale !== 'en';

    // Order tracking inquiry
    if (/order|طلبي|اوردر|تتبع|شحن|فين الطلب/i.test(q)) {
        return {
            reply: isAr
                ? 'تقدر تتابع جميع طلباتك وحالتها بالتفصيل من صفحة [طلباتي](/profile/orders). وإذا حابب تتواصل مع خدمة العملاء للمساعدة المباشرة تقدر تراسلنا.'
                : 'You can track all your orders and delivery status directly from the [My Orders](/profile/orders) page.',
            products: []
        };
    }

    // Vendor registration inquiry
    if (/بيع|تاجر|انضمام|سجل تاجر|vendor|sell/i.test(q)) {
        return {
            reply: isAr
                ? 'أهلاً بيك كشريك تاجر في ريدي مارين ⛵! تقدر تفتح حساب متجر بحري وتبيع قطع الغيار والمستلزمات من هنا: [تسجيل تاجر جديد](/vendor/register).'
                : 'Welcome as a vendor partner at Ready Marine ⛵! You can register and sell marine parts here: [Vendor Registration](/vendor/register).',
            products: []
        };
    }

    // Keyword search in catalog
    const words = q.split(/\s+/).filter((w) => w.length > 2 && !/عايز|عاوز|مركبي|ليختي|قطعة|قطع|غيار|محتاج|ابعتلي|دور/i.test(w));
    let matchingProducts = [];
    if (words.length > 0) {
        const regexes = words.map((w) => new RegExp(w, 'i'));
        matchingProducts = await Product.find({
            status: { $in: ['published', 'approved'] },
            is_active: { $ne: false },
            $or: [
                { title_ar: { $in: regexes } },
                { title_en: { $in: regexes } },
                { description_ar: { $in: regexes } },
                { description_en: { $in: regexes } },
                { part_number: { $in: regexes } },
                { sku: { $in: regexes } }
            ]
        }).limit(4).lean();
    }

    if (matchingProducts.length === 0) {
        // Fallback: pick up to 3 published products
        matchingProducts = await Product.find({
            status: { $in: ['published', 'approved'] },
            is_active: { $ne: false }
        }).limit(3).lean();
    }

    // Format products for chat cards
    const productCards = matchingProducts.map((p) => {
        const price = p.price || (p.variants?.[0]?.price) || 0;
        const origPrice = p.original_price || p.regular_price || null;
        const img = p.images?.[0]?.url || p.images?.[0] || '';
        return {
            externalId: String(p._id),
            name: isAr ? (p.title_ar || p.title_en) : (p.title_en || p.title_ar),
            description: isAr ? (p.subtitle_ar || p.subtitle_en || '') : (p.subtitle_en || p.subtitle_ar || ''),
            price: Number(price) || 0,
            originalPrice: origPrice && origPrice > price ? Number(origPrice) : null,
            image: typeof img === 'string' ? img : '',
            slugEn: p.slug_en || null,
            slugAr: p.slug_ar || null,
            inStock: (p.quantity == null || p.quantity > 0) && p.stock_status !== 'outofstock',
            cart: { product: p, variant: null }
        };
    });

    const replyText = isAr
        ? (matchingProducts.length > 0
            ? 'لقيتلك المنتجات دي في كتالوج ريدي مارين ⛵: تقدر تضيفها للسلة أو تضغط على التفاصيل.'
            : 'أهلاً بيك في ريدي مارين ⛵! قولي نوع وموديل مركبك والقطعة اللي بتدور عليها، أو تصفح قسم [جميع المنتجات](/products).')
        : (matchingProducts.length > 0
            ? 'Here are matching products from Ready Marine catalog ⛵:'
            : 'Welcome to Ready Marine ⛵! Tell me your vessel type and the part you need, or browse [All Products](/products).');

    return { reply: replyText, products: productCards };
}

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
    if (!assistant.isConfigured()) {
        const ident = identityOf(req);
        const history = localSessions.get(ident.key) || [];
        return { enabled: true, messages: history, cart: null, cartSync: false };
    }
    // Before a guest has a session id there is nothing to read — say only whether the assistant is on.
    if (!req.user && !req.query?.sessionId) {
        return { enabled: assistant.isConfigured(), messages: [], cart: null, cartSync: assistant.cartSyncEnabled() };
    }
    return assistant.history({ identity: identityOf(req), after: req.query?.after });
}));

router.post('/messages', optionalUser, handle(async (req) => {
    if (!assistant.isConfigured()) {
        const ident = identityOf(req);
        const text = String(req.body?.message || '').trim();
        const locale = localeOf(req);
        const { reply, products } = await localFallbackReply(text, locale);
        const sessionHistory = localSessions.get(ident.key) || [];
        const userMsg = { id: Date.now(), from: 'customer', author: 'customer', text, products: [], sentAt: new Date().toISOString() };
        const botMsg = { id: Date.now() + 1, from: 'assistant', author: 'agent', text: reply, products, sentAt: new Date().toISOString() };
        sessionHistory.push(userMsg, botMsg);
        localSessions.set(ident.key, sessionHistory.slice(-50));
        return { status: 'replied', messageId: botMsg.id, reply: botMsg };
    }
    return assistant.send({
        identity: identityOf(req),
        message: req.body?.message,
        locale: localeOf(req),
        ip: clientIp(req),
    });
}));

// The recording is the raw request body, so the session and language ride in the query.
router.post(
    '/voice',
    optionalUser,
    rawBody({ limit: assistant.MAX_VOICE_BYTES, message: 'Voice notes can be up to two minutes' }),
    handle(async (req) => {
        if (!assistant.isConfigured()) {
            const ident = identityOf(req);
            const locale = localeOf(req);
            const reply = locale === 'ar'
                ? 'استلمت تسجيلك الصوتي 🎙️! اكتب لي طلبك نصياً لأقدر أبحث لك في كتالوج ريدي مارين بأعلى دقة ⚓.'
                : 'Received your voice note 🎙️! Please type your query to search the catalog.';
            const botMsg = { id: Date.now(), from: 'assistant', author: 'agent', text: reply, products: [], sentAt: new Date().toISOString() };
            return { status: 'replied', messageId: botMsg.id, reply: botMsg, transcript: '' };
        }
        return assistant.sendVoice({
            identity: identityOf(req),
            audio: req.body,
            contentType: req.get('content-type'),
            locale: localeOf(req),
            ip: clientIp(req),
        });
    })
);

// Start a new conversation.
router.delete('/messages', optionalUser, handle(async (req) => {
    if (!assistant.isConfigured()) {
        localSessions.delete(identityOf(req).key);
        return { reset: true };
    }
    return assistant.reset({ identity: identityOf(req) });
}));

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
