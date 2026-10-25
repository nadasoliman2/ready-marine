/**
 * The website chat — ReadyCar's own chat window, backed by the same EverySecond
 * agent that answers on WhatsApp, Messenger and Instagram.
 *
 * The browser never talks to EverySecond: the agent's key can read every
 * customer conversation, so it stays here and this service holds the chat on
 * the customer's behalf through the Chat API.
 *
 * One customer is one chat. A signed-in customer's chat is keyed by their
 * account ("web:user:<id>"), so it follows them across devices and an order
 * placed in it is filed under their account. A guest's is keyed by a random id
 * the browser keeps ("web:anon:<id>"); knowing that id is what lets the same
 * browser read the conversation back, so it must be unguessable.
 *
 * Website chat spends the same monthly message quota as WhatsApp — which is
 * why sending is rate-limited here.
 */
const { Product } = require('../../models/products');
require('../../models/sellers'); // populated on products below
const { api, isConfigured } = require('./client');
const { parseExternalId, toExternalId, variantLabelOf, pricesOf, httpsOnly } = require('./helpers');
const { absoluteImageUrl } = require('./catalogSync');

const SESSION_ID = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_MESSAGE = 1000;
const MAX_CARDS = 5;

const chatError = (status, en, ar, locale) => {
    const err = new Error(locale === 'ar' ? ar : en);
    err.status = status;
    return err;
};

/* ------------------------------------------------------------------ */
/* Who is talking                                                      */
/* ------------------------------------------------------------------ */

const identityFor = ({ user, sessionId, locale }) => {
    if (user) {
        return {
            key: `web:user:${user._id || user.id}`,
            name: String(user.name || '').trim(),
            phone: String(user.phone || '').trim(),
        };
    }
    const id = String(sessionId || '').trim();
    if (!SESSION_ID.test(id)) throw chatError(400, 'A chat session id is required', 'مطلوب رقم جلسة للشات', locale);
    return { key: `web:anon:${id}`, name: '', phone: '' };
};

/* ------------------------------------------------------------------ */
/* Limits — in memory, per process: a restart only errs towards letting */
/* a message through.                                                   */
/* ------------------------------------------------------------------ */

const windows = new Map();
let day = { date: '', count: 0 };

const allow = (bucket, limit, windowMs, now) => {
    const recent = (windows.get(bucket) || []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
        windows.set(bucket, recent);
        return false;
    }
    recent.push(now);
    windows.set(bucket, recent);
    return true;
};

const assertWithinLimits = ({ key, ip, locale }, now = Date.now()) => {
    if (windows.size > 20_000) windows.clear();
    const today = new Date(now).toISOString().slice(0, 10);
    if (day.date !== today) day = { date: today, count: 0 };
    const cap = Number.parseInt(process.env.EVERYSECOND_WEB_CHAT_DAILY_LIMIT ?? '1000', 10);
    if (cap > 0 && day.count >= cap) {
        throw chatError(503, 'The assistant is busy right now. Please try again later.', 'المساعد مشغول دلوقتي، جرّب كمان شوية.', locale);
    }
    // A person types a handful of messages a minute; a script does not.
    if (!allow(`id:${key}`, 12, 5 * 60_000, now) || (ip && !allow(`ip:${ip}`, 60, 10 * 60_000, now))) {
        throw chatError(429, "You're sending messages very quickly — please wait a moment.", 'بتبعت رسايل بسرعة شوية — استنى لحظة وجرّب تاني.', locale);
    }
    day.count += 1;
};

/* ------------------------------------------------------------------ */
/* The chat behind an identity                                          */
/* ------------------------------------------------------------------ */

const chatIds = new Map(); // identity key → { id | null, checkedAt }

const remember = (key, id) => {
    if (chatIds.size > 5000) chatIds.clear();
    chatIds.set(key, { id, checkedAt: Date.now() });
};

async function findChat(identity) {
    const cached = chatIds.get(identity.key);
    if (cached && (cached.id || Date.now() - cached.checkedAt < 60_000)) return cached.id;
    const res = await api('GET', `/chats?per_page=1&external_id=${encodeURIComponent(identity.key)}`);
    const id = (res?.data || res?.chats || [])[0]?.id ?? null;
    remember(identity.key, id);
    return id;
}

async function openChat(identity, locale) {
    const res = await api('POST', '/chats', {
        external_id: identity.key,
        ...(identity.name ? { name: identity.name } : {}),
        ...(identity.phone ? { phone: identity.phone } : {}),
        metadata: { source: 'website', locale: locale === 'en' ? 'en' : 'ar' },
    });
    const id = res?.chat?.id;
    if (!id) throw new Error('EverySecond did not return a chat id');
    remember(identity.key, id);
    return id;
}

/* ------------------------------------------------------------------ */
/* Our products behind cards and lines                                  */
/* ------------------------------------------------------------------ */

const money = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

async function productsFor(...externalIdLists) {
    const ids = [...new Set(externalIdLists.flat().map((id) => parseExternalId(id)?.productId).filter(Boolean))];
    if (!ids.length) return new Map();
    try {
        const rows = await Product.find({ _id: { $in: ids } })
            .select('title_en title_ar slug_en slug_ar price discount_price status vendor_id images variants stock_management stock_status quantity')
            .populate({ path: 'vendor_id', select: 'status' })
            .lean();
        return new Map(rows.map((p) => [String(p._id), p]));
    } catch {
        return new Map(); // photos and links are a nicety; the chat still works without them
    }
}

const primaryImage = (p) => absoluteImageUrl((p?.images || []).find((i) => i?.is_primary)?.url || p?.images?.[0]?.url) || null;

/*
 * What the storefront's addToCart(product, variant, qty) needs to put this row
 * in the website cart — the same shape a product card on the site passes.
 */
const cartRefOf = (product, variant) => {
    if (!product || product.status !== 'published' || product.vendor_id?.status === 'suspended') return null;
    return {
        product: {
            _id: String(product._id),
            title_en: product.title_en,
            title_ar: product.title_ar,
            price: product.price,
            discount_price: product.discount_price,
            image: primaryImage(product) || '',
            slug_en: product.slug_en,
            slug_ar: product.slug_ar,
            status: product.status,
            vendor_id: product.vendor_id ? { _id: String(product.vendor_id._id || product.vendor_id), status: product.vendor_id.status } : null,
        },
        variant: variant
            ? { _id: String(variant._id), price: variant.price, discount_price: variant.discount_price, selected_options: variant.selected_options || [] }
            : null,
    };
};

const lookup = (externalId, products) => {
    const ids = parseExternalId(externalId);
    const product = ids ? products.get(ids.productId) : null;
    const variant = product && ids.variantId ? (product.variants || []).find((v) => String(v._id) === ids.variantId) || null : null;
    return { ids, product, variant };
};

/**
 * A product card as the agent recommended it. Price and photo come from the
 * agent's menu — this store's own catalogue, synced — never from the model.
 * Our product adds the slugs (so the card links to the page in the shopper's
 * own language) and `cart` (so the card can add straight to the site cart).
 */
const toProductCard = (p, products) => {
    if (!p || typeof p !== 'object') return null;
    const name = String(p.name ?? '').trim();
    const { product, variant } = lookup(p.external_id, products);
    const image = httpsOnly(p.image_url) || httpsOnly(p.image_full_url) || primaryImage(product);
    if (!name || !image) return null;
    const options = p.options && typeof p.options === 'object' && !Array.isArray(p.options)
        ? Object.values(p.options).map((v) => String(v ?? '').trim()).filter(Boolean).join(' / ')
        : variantLabelOf(variant);
    return {
        externalId: String(p.external_id || '') || null,
        name,
        description: String(p.description ?? '').trim() || null,
        options: options || null,
        price: money(p.price),
        originalPrice: money(p.original_price),
        priceText: String(p.price_text ?? '').trim() || null,
        currency: String(p.currency ?? '').trim() || null,
        offerName: String(p.offer_name ?? '').trim() || null,
        image,
        url: httpsOnly(p.product_url) || null,
        slugEn: product?.slug_en || null,
        slugAr: product?.slug_ar || null,
        inStock: p.in_stock !== false,
        cart: cartRefOf(product, variant),
    };
};

const toProductCards = (list, products) =>
    (Array.isArray(list) ? list : []).map((p) => toProductCard(p, products)).filter(Boolean).slice(0, MAX_CARDS);

const toMessage = (m, products) => ({
    id: m.id,
    // "customer" is the shopper; anyone else spoke for ReadyCar (the agent, or a teammate who took over).
    from: m.author === 'customer' || m.direction === 'inbound' ? 'customer' : 'assistant',
    author: m.author || '',
    text: m.text === '[audio]' ? '' : m.text || '',
    image: httpsOnly((m.media || []).find((x) => x?.type === 'image')?.url) || null,
    audio: httpsOnly((m.media || []).find((x) => x?.type === 'audio')?.url) || null,
    // Cards are stored on the reply's own row, so a reloaded conversation shows them again.
    products: toProductCards((m.media || []).find((x) => x?.type === 'products')?.items, products),
    sentAt: m.sent_at || null,
});

/* A basket or order line: name, price and quantity are the agent's; photo, link and cart ref are ours. */
const toLine = (line, products) => {
    const { product, variant } = lookup(line?.external_id, products);
    const qty = Math.max(1, Number.parseInt(line?.qty, 10) || 1);
    const unitPrice = money(line?.unit_price) ?? (product ? money(pricesOf(product, variant).unit) : null);
    return {
        externalId: String(line?.external_id || '') || null,
        name: String(line?.name ?? '').trim() || (product ? product.title_en : ''),
        qty,
        unitPrice,
        lineTotal: money(line?.line_total) ?? (unitPrice !== null ? Math.round(unitPrice * qty * 100) / 100 : null),
        image: primaryImage(product),
        slugEn: product?.slug_en || null,
        slugAr: product?.slug_ar || null,
        cart: cartRefOf(product, variant),
    };
};

/**
 * The basket as the agent holds it after a turn, or null when there is none
 * (including right after it became an order). Delivery and total are ours —
 * from the last order.validate answer — and only when it accepted the basket.
 */
const toCart = (cart, products = new Map()) => {
    const items = (Array.isArray(cart?.items) ? cart.items : []).map((l) => toLine(l, products)).filter((l) => l.name);
    if (!items.length) return null;
    const quote = cart.merchant_quote && cart.merchant_quote.ok !== false ? cart.merchant_quote : null;
    return {
        id: cart.id ?? null,
        items,
        itemsTotal: money(cart.items_total) ?? Math.round(items.reduce((s, l) => s + (l.lineTotal || 0), 0) * 100) / 100,
        deliveryFee: quote ? money(quote.delivery_fee) : null,
        total: quote ? money(quote.total) : null,
        currency: String(cart.currency || '').trim() || null,
    };
};

/** The order a turn placed, changed or cancelled. `reference` is ours (REF-…), the one in the customer's account. */
const toOrder = (order, products = new Map()) => {
    if (!order || !order.id) return null;
    return {
        id: order.id,
        status: String(order.status || 'pending'),
        reference: String(order.merchant_ref || '').trim() || null,
        items: (Array.isArray(order.items) ? order.items : []).map((l) => toLine(l, products)).filter((l) => l.name),
        itemsTotal: money(order.items_total),
        deliveryFee: money(order.delivery_fee),
        total: money(order.total),
        currency: String(order.currency || '').trim() || null,
        trackingUrl: httpsOnly(order.tracking_url) || null,
    };
};

/*
 * Where the sale stands after a turn. A turn the agent did not take (a teammate
 * has the chat, or it went to a ticket) returns no `cart` at all, and the widget
 * keeps the basket it had.
 */
async function saleOf(res) {
    const products = await productsFor(
        (res?.cart?.items || []).map((l) => l.external_id),
        (res?.order?.items || []).map((l) => l.external_id),
        (res?.products || []).map((p) => p.external_id),
    );
    const tookTurn = res?.status === 'replied' || (res && 'cart' in res);
    return {
        products,
        sale: {
            ...(tookTurn ? { cart: toCart(res.cart, products) } : {}),
            order: toOrder(res?.order, products),
        },
    };
}

async function openCart(chatId) {
    try {
        const res = await api('GET', `/chats/${chatId}/cart`, null, { timeoutMs: 5000 });
        if (!res?.cart) return null;
        return toCart(res.cart, await productsFor((res.cart.items || []).map((l) => l.external_id)));
    } catch {
        return null;
    }
}

/* ------------------------------------------------------------------ */
/* The website cart, kept in step with the chat basket                  */
/* ------------------------------------------------------------------ */

const cartSyncEnabled = () => isConfigured() && process.env.EVERYSECOND_CART_TWO_WAY !== 'false';
const MAX_CART_LINES = 100;
const CLOSE_REASONS = new Set(['ordered_on_website', 'paid_on_website']);
const OBJECT_ID = /^[a-f0-9]{24}$/;

/** The site cart ({ productId, variantId, qty }[]) as basket lines keyed like the menu. Bundles are not in the menu. */
const toBasketLines = (items) => {
    if (!Array.isArray(items)) return [];
    const lines = new Map();
    for (const it of items.slice(0, MAX_CART_LINES)) {
        const productId = String(it?.productId || '').toLowerCase();
        const variantId = it?.variantId ? String(it.variantId).toLowerCase() : null;
        if (!OBJECT_ID.test(productId) || (variantId && !OBJECT_ID.test(variantId))) continue;
        const externalId = toExternalId(productId, variantId);
        const qty = Math.min(999, (lines.get(externalId)?.qty || 0) + Math.max(1, Number.parseInt(it?.qty, 10) || 1));
        lines.set(externalId, { externalId, productId, variantId, qty });
    }
    return [...lines.values()];
};

const backToSite = (rows, lines) => (Array.isArray(rows) ? rows : []).flatMap((row) => {
    const line = lines.find((l) => l.externalId === row?.external_id);
    if (!line) return [];
    return [{
        productId: line.productId,
        variantId: line.variantId,
        reason: String(row.reason || ''),
        ...(row.requested_qty != null ? { requestedQty: Number(row.requested_qty), qty: Number(row.qty) } : {}),
    }];
});

/**
 * Put the website cart into the chat basket, so the agent works from what the
 * customer picked on the site. The whole cart each time; EverySecond replaces
 * the basket's lines and prices them from the menu. A cart with no chat behind
 * it stays on the site unless `create` — set only when the customer is about to
 * write, so browsing never opens a conversation.
 */
async function syncCart({ identity, items, create = false, locale, ip }) {
    const empty = { synced: false, cart: null, skipped: [], adjusted: [] };
    if (!cartSyncEnabled()) return empty;
    const lines = toBasketLines(items);
    const now = Date.now();
    if (!allow(`cart:${identity.key}`, 30, 5 * 60_000, now) || (ip && !allow(`cart-ip:${ip}`, 120, 10 * 60_000, now))) {
        throw chatError(429, 'Too many cart updates — please wait a moment.', 'تحديثات كتير للسلة — استنى لحظة.', locale);
    }
    const put = (chatId) => api('PUT', `/chats/${chatId}/cart`, { items: lines.map((l) => ({ external_id: l.externalId, qty: l.qty })) }, { timeoutMs: 10_000 });
    try {
        let chatId = await findChat(identity);
        if (!chatId) {
            if (!create || !lines.length) return empty;
            chatId = await openChat(identity, locale);
        }
        let res;
        try {
            res = await put(chatId);
        } catch (err) {
            if (err?.status !== 404) throw err;
            chatIds.delete(identity.key);
            if (!create || !lines.length) return empty;
            res = await put(await openChat(identity, locale));
        }
        return {
            synced: true,
            cart: toCart(res?.cart, await productsFor((res?.cart?.items || []).map((l) => l.external_id))),
            skipped: backToSite(res?.skipped, lines),
            adjusted: backToSite(res?.adjusted, lines),
        };
    } catch (err) {
        if (err?.status === 422) return { synced: true, unchanged: true, skipped: backToSite(err.data?.skipped, lines), adjusted: [] };
        console.error('[assistant] cart sync failed:', err?.message || err);
        throw chatError(503, "The chat basket couldn't be updated right now.", 'معرفناش نحدّث سلة الشات دلوقتي.', locale);
    }
}

/** Close the chat basket after the customer ordered on the website. Never fails the caller. */
async function closeCart({ identity, reason }) {
    if (!cartSyncEnabled()) return { closed: false };
    try {
        const chatId = await findChat(identity);
        if (!chatId) return { closed: false };
        const res = await api('DELETE', `/chats/${chatId}/cart`, { reason: CLOSE_REASONS.has(reason) ? reason : 'ordered_on_website' }, { timeoutMs: 10_000 });
        return { closed: Boolean(res?.closed) };
    } catch (err) {
        if (err?.status === 404) chatIds.delete(identity.key);
        else console.error('[assistant] closing the chat basket failed:', err?.message || err);
        return { closed: false };
    }
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

/** The conversation so far, oldest first. `after` returns only newer messages (the handoff poll). */
async function history({ identity, after }) {
    const cartSync = cartSyncEnabled();
    if (!isConfigured()) return { enabled: false, messages: [], cart: null, cartSync: false };
    const chatId = await findChat(identity);
    if (!chatId) return { enabled: true, messages: [], cart: null, cartSync };
    const since = Number.parseInt(after, 10);
    try {
        const [res, cart] = await Promise.all([
            api('GET', `/chats/${chatId}/messages?limit=100${since > 0 ? `&after=${since}` : ''}`),
            since > 0 ? null : openCart(chatId),
        ]);
        const rows = res?.messages || [];
        const products = await productsFor(rows.flatMap((m) => ((m.media || []).find((x) => x?.type === 'products')?.items || []).map((p) => p.external_id)));
        return { enabled: true, messages: rows.map((m) => toMessage(m, products)), cart, cartSync };
    } catch (err) {
        if (err?.status === 404) {
            chatIds.delete(identity.key);
            return { enabled: true, messages: [], cart: null, cartSync };
        }
        throw err;
    }
}

async function deliver({ identity, locale, body }) {
    const post = (chatId) => api('POST', `/chats/${chatId}/messages`, body(), { timeoutMs: 65_000 });
    try {
        let chatId = (await findChat(identity)) ?? (await openChat(identity, locale));
        try {
            return await post(chatId);
        } catch (err) {
            if (err?.status !== 404) throw err;
            chatId = await openChat(identity, locale);
            return await post(chatId);
        }
    } catch (err) {
        if (err?.status === 422) {
            throw chatError(422, "We couldn't use that recording — please try again, or type your message.", 'معرفناش نسمع التسجيل ده — جرّب تاني أو اكتب رسالتك.', locale);
        }
        console.error('[assistant] message failed:', err?.message || err);
        throw chatError(503, "The assistant can't reply right now. Please try again in a moment.", 'المساعد مش قادر يرد دلوقتي، جرّب كمان شوية.', locale);
    }
}

const replyOf = (res, products) => (res?.reply
    ? {
        id: res.reply_id ?? null,
        from: 'assistant',
        author: 'agent',
        text: res.reply,
        image: httpsOnly(res.image?.url) || null,
        products: toProductCards(res.products, products),
        sentAt: res.sent_at || null,
    }
    : null);

/** Send one customer message; the agent's reply and where the sale stands come back. */
async function send({ identity, message, locale, ip }) {
    if (!isConfigured()) throw chatError(503, 'The assistant is not available right now.', 'المساعد مش متاح دلوقتي.', locale);
    const value = String(message ?? '').trim();
    if (!value) throw chatError(400, 'Write a message first', 'اكتب رسالة الأول', locale);
    if (value.length > MAX_MESSAGE) throw chatError(400, `Messages can be up to ${MAX_MESSAGE} characters`, `الرسالة لحد ${MAX_MESSAGE} حرف`, locale);
    assertWithinLimits({ key: identity.key, ip, locale });
    const res = await deliver({ identity, locale, body: () => ({ message: value }) });
    const { products, sale } = await saleOf(res);
    return { status: res?.status || 'replied', messageId: res?.message_id ?? null, reply: replyOf(res, products), ...sale };
}

/* Voice notes: EverySecond transcribes them (Egyptian Arabic, English, mixed) and answers the transcript. */
const MAX_VOICE_BYTES = 10 * 1024 * 1024;
const MIN_VOICE_BYTES = 1024;
const VOICE_TYPES = {
    'audio/webm': 'webm', 'video/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'video/mp4': 'm4a',
    'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
};
const voiceExtension = (contentType) => VOICE_TYPES[String(contentType || '').split(';')[0].trim().toLowerCase()] || null;

async function sendVoice({ identity, audio, contentType, locale, ip }) {
    if (!isConfigured()) throw chatError(503, 'The assistant is not available right now.', 'المساعد مش متاح دلوقتي.', locale);
    const ext = voiceExtension(contentType);
    if (!ext || !Buffer.isBuffer(audio)) throw chatError(400, 'That is not a voice recording', 'ده مش تسجيل صوتي', locale);
    if (audio.length < MIN_VOICE_BYTES) throw chatError(400, 'That recording is too short', 'التسجيل قصير أوي', locale);
    if (audio.length > MAX_VOICE_BYTES) throw chatError(413, 'Voice notes can be up to two minutes', 'الفويس نوت لحد دقيقتين', locale);
    assertWithinLimits({ key: identity.key, ip, locale });
    const type = String(contentType).split(';')[0].trim().toLowerCase();
    const res = await deliver({
        identity,
        locale,
        body: () => {
            const form = new FormData();
            form.append('audio', new Blob([audio], { type }), `voice-note.${ext}`);
            return form;
        },
    });
    const { products, sale } = await saleOf(res);
    return {
        status: res?.status || 'replied',
        messageId: res?.message_id ?? null,
        transcript: String(res?.transcript || '').trim() || null,
        audio: httpsOnly(res?.audio?.url) || null,
        reply: replyOf(res, products),
        ...sale,
    };
}

/** Start over: close the chat, so the next message opens one with no memory of this one. */
async function reset({ identity }) {
    if (!isConfigured()) return { closed: false };
    const chatId = await findChat(identity);
    if (chatId) {
        try {
            await api('DELETE', `/chats/${chatId}`);
        } catch (err) {
            if (err?.status !== 404) throw err;
        }
    }
    chatIds.delete(identity.key);
    return { closed: Boolean(chatId) };
}

module.exports = {
    isConfigured,
    cartSyncEnabled,
    identityFor,
    history,
    send,
    sendVoice,
    syncCart,
    closeCart,
    reset,
    toBasketLines,
    toCart,
    toProductCard,
    MAX_VOICE_BYTES,
};
