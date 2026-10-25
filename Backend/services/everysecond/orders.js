/**
 * Chat orders — the agent sells, this store decides.
 *
 *   order.validate   answered synchronously (EverySecond waits 4 s). At "quote"
 *                    our prices, availability and shipping fee are what the
 *                    agent reads back; at "place" the order is created here,
 *                    through the same orderService.placeOrder a web checkout
 *                    uses, and its reference goes back as merchant_ref.
 *   order.created    links EverySecond's order to ours — or places ours now if
 *                    the validation never reached us (no webhook, a timeout).
 *   order.failed /
 *   order.cancelled  cancel ours while nothing has left the vendor yet.
 *   status sweep     tells the customer, in the same chat, when the order is
 *                    confirmed, shipped and delivered (our status is derived
 *                    from the parcels and changes in many places — couriers,
 *                    vendors, admins — so one sweep reads it rather than every
 *                    one of those places calling out).
 *
 * Chat orders are cash on delivery only. Wallet, points and coupons are never
 * spent from a chat.
 */
const { Order } = require('../../models/orders');
const { User, createUser, findUserByPhoneVariants } = require('../../models/users');
const { Product } = require('../../models/products');
require('../../models/sellers'); // populated on products below
const { City } = require('../../models/cities');
const { recordEvent, markEvent, findRetryableEvents } = require('../../models/everysecond');
const { canonicalPhone, isValidEgyptMobile } = require('../shared/phone');
const { api, isConfigured, sleep } = require('./client');
const {
    parseExternalId,
    toExternalId,
    orderAddressFromChat,
    pricesOf,
    isSellableStock,
    messageFor,
    ES_STATUS_FOR,
    ES_STATUS_RANK,
} = require('./helpers');

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const ACTOR = { role: 'system', label: 'AI chat (EverySecond)' };

/* ------------------------------------------------------------------ */
/* Lines                                                               */
/* ------------------------------------------------------------------ */

const activeVendorFilter = { status: { $ne: 'suspended' }, subscription_status: { $in: ['active', 'trial_active'] } };

/** Resolve chat lines ({ external_id, qty }) to our products, with what is wrong with each. */
async function resolveLines(rawItems) {
    const raw = Array.isArray(rawItems) ? rawItems : [];
    const parsed = raw.map((it) => ({
        externalId: String(it?.external_id ?? '').trim(),
        ids: parseExternalId(it?.external_id),
        qty: Math.max(1, Number.parseInt(it?.qty, 10) || 1),
    }));
    const productIds = [...new Set(parsed.map((l) => l.ids?.productId).filter(Boolean))];
    const products = productIds.length
        ? await Product.find({ _id: { $in: productIds } })
            .select('title_en title_ar price discount_price status vendor_id variants stock_management stock_status quantity')
            .populate({ path: 'vendor_id', select: 'status subscription_status' })
            .lean()
        : [];
    const byId = new Map(products.map((p) => [String(p._id), p]));

    return parsed.map((l) => {
        const line = { externalId: l.externalId, qty: l.qty, product: null, variant: null, unit: 0, problem: null };
        const product = l.ids ? byId.get(l.ids.productId) : null;
        const variant = product && l.ids.variantId
            ? (product.variants || []).find((v) => String(v._id) === l.ids.variantId) || null
            : null;
        const vendor = product?.vendor_id;
        const vendorActive = vendor && vendor.status !== 'suspended' && activeVendorFilter.subscription_status.$in.includes(vendor.subscription_status);
        if (!product || product.status !== 'published' || !vendorActive
            || (l.ids.variantId && !variant) || (!l.ids.variantId && (product.variants || []).length)) {
            line.problem = 'unknown';
            return line;
        }
        line.product = product;
        line.variant = variant;
        line.unit = round2(pricesOf(product, variant).unit);
        if (!(line.unit > 0)) line.problem = 'unknown';
        else if (!isSellableStock(product)) line.problem = 'short';
        return line;
    });
}

const orderItemsOf = (lines) => lines.map((l) => ({
    product_id: String(l.product._id),
    ...(l.variant ? { variant_id: String(l.variant._id) } : {}),
    quantity: l.qty,
}));

/* ------------------------------------------------------------------ */
/* Who the order belongs to                                            */
/* ------------------------------------------------------------------ */

const phoneOf = (customer = {}) => String(customer.phone || customer.phone_e164 || customer.sender_id || '').trim();

/*
 * The account a chat order is filed under — ReadyCar orders always have one.
 *
 *   website chat, signed in — the conversation was opened by our own backend
 *     for that customer and carries their id ("web:user:<id>"), so it is theirs.
 *   otherwise, by phone — the account that already has this number, or a new
 *     guest account (no password, nothing disclosed until the phone is proved),
 *     exactly as a guest web checkout would create.
 *
 * A typed phone is not proof of identity, but a chat order spends nothing from
 * the account (cash on delivery only — no wallet, no points), and the order
 * confirmation goes to that same number on WhatsApp before anything ships.
 */
async function accountFor({ customer = {}, channel = '', chatId = null }) {
    if (chatId && ['api', 'website', 'web'].includes(channel)) {
        try {
            const res = await api('GET', `/chats/${chatId}`, null, { timeoutMs: 1500 });
            const id = /^web:user:([a-f0-9]{24})$/.exec(String(res?.chat?.external_id ?? ''))?.[1];
            if (id) {
                const user = await User.findById(id);
                if (user) return { user, phone: phoneOf(customer) || user.phone };
            }
        } catch {
            // Not worth failing an order over; it is filed by phone below.
        }
    }

    const typed = phoneOf(customer);
    if (!isValidEgyptMobile(typed)) {
        const err = new Error('A valid Egyptian mobile number is required');
        err.chatReason = 'needPhone';
        throw err;
    }
    const phone = canonicalPhone(typed);
    let user = await findUserByPhoneVariants(phone);
    if (!user) {
        try {
            user = await createUser({
                name: String(customer.name || '').trim() || 'Chat customer',
                phone,
                password: null,
                account_status: 'guest',
                preferred_language: customer.language === 'en' ? 'en' : 'ar',
            });
        } catch (err) {
            // Two deliveries for the same new customer at once: the other one created it.
            if (err?.code !== 11000) throw err;
            user = await findUserByPhoneVariants(phone);
        }
    }
    return { user, phone };
}

/* ------------------------------------------------------------------ */
/* Placing                                                             */
/* ------------------------------------------------------------------ */

let citiesCache = { at: 0, rows: [] };
async function storeCities() {
    if (Date.now() - citiesCache.at < 10 * 60_000 && citiesCache.rows.length) return citiesCache.rows;
    citiesCache = { at: Date.now(), rows: await City.find().select('name name_ar country').lean() };
    return citiesCache.rows;
}

/* What placeOrder's refusals mean for the customer. Anything else is not theirs to fix. */
function chatReasonOf(err) {
    if (err?.chatReason) return err.chatReason;
    const m = String(err?.message || '');
    if (/cash on delivery/i.test(m)) return 'noCod';
    if (err?.code === 'SHIPPING_NO_ZONE' || /do not ship/i.test(m)) return 'noShipping';
    if (/phone/i.test(m)) return 'needPhone';
    if (/not available|not found|suspended|at least one item|quantity/i.test(m)) return 'unavailable';
    return null;
}

/**
 * Create our order for a chat basket. Throws an Error with `chatReason` when
 * the customer can do something about it.
 */
async function createChatOrder({ customer = {}, channel = '', chatId = null, lines, fulfillment = {}, esOrder = null }) {
    const { user, phone } = await accountFor({ customer, channel, chatId });
    const name = String(customer.name || user?.name || '').trim();
    const address = orderAddressFromChat(fulfillment, { cities: await storeCities(), name, phone });
    if (!address.shipping_destination) {
        const err = new Error('No governorate in the delivery address');
        err.chatReason = 'needCity';
        throw err;
    }
    const { placeOrder } = require('../orderService');
    let order;
    try {
        order = await placeOrder(user._id, {
            shipping_address: address.shipping_address,
            items: orderItemsOf(lines),
            payment_method: 'cash',
            shipping_destination: address.shipping_destination,
            redeem_points: 0,
            checkout_source: 'chat',
        });
    } catch (err) {
        err.chatReason = chatReasonOf(err);
        throw err;
    }
    await Order.updateOne(
        { _id: order._id },
        {
            $set: {
                source: 'everysecond',
                chat: {
                    es_order_id: esOrder?.id ?? null,
                    lead_id: customer.lead_id ?? null,
                    channel: String(channel || ''),
                    conversation_url: String(esOrder?.conversation_url || ''),
                    announced_status: '',
                    announce_error: '',
                    announce_attempts: 0,
                    announced_at: null,
                },
            },
            $push: {
                history: {
                    action: 'chat_order',
                    title: 'Placed through the AI chat',
                    details: `The customer confirmed this order with the AI assistant on ${channel || 'chat'}.`,
                    actor_role: ACTOR.role,
                    actor_label: ACTOR.label,
                    metadata: { channel, lead_id: customer.lead_id ?? null, chat_id: chatId ?? null },
                    created_at: new Date(),
                },
            },
        }
    );
    return order;
}

/* ------------------------------------------------------------------ */
/* order.validate                                                      */
/* ------------------------------------------------------------------ */

/**
 * Answer order.validate. Only an explicit `ok: false` stops a sale; it is kept
 * for what cannot be sold at all (an unknown or withdrawn item, an out-of-stock
 * line at the moment of placing, a refusal the customer must act on).
 */
async function validateOrder(data = {}) {
    const language = data.customer?.language === 'en' ? 'en' : 'ar';
    const stage = data.stage === 'place' ? 'place' : 'quote';
    const fulfillment = data.fulfillment || {};
    if (fulfillment.type === 'pickup') return { ok: false, message: messageFor('pickup', language) };

    const lines = await resolveLines(data.items);
    const answerItems = lines.map((l) => ({
        external_id: l.externalId,
        qty: l.qty,
        unit_price: l.unit,
        available_qty: l.problem ? 0 : l.qty,
    }));
    if (!lines.length || lines.some((l) => l.problem === 'unknown') || (stage === 'place' && lines.some((l) => l.problem))) {
        return { ok: false, items: answerItems, message: messageFor('unavailable', language) };
    }

    if (stage === 'place') {
        try {
            const order = await createChatOrder({
                customer: data.customer,
                channel: data.channel,
                chatId: data.chat_id,
                lines,
                fulfillment,
            });
            const shipping = Number(order.shipping?.total_cost || 0);
            return {
                ok: true,
                items: order.items.map((it) => ({
                    external_id: lines.find((l) => String(l.product._id) === String(it.product_id))?.externalId
                        || toExternalId(it.product_id, null),
                    qty: it.quantity,
                    unit_price: Number(it.unit_price),
                    available_qty: it.quantity,
                })),
                delivery_fee: round2(shipping),
                total: round2(order.total_price),
                merchant_ref: order.transaction?.reference || String(order._id),
                payment_url: null,
                message: null,
            };
        } catch (err) {
            if (err.chatReason) {
                console.warn(`[everysecond] chat order refused (${err.chatReason}): ${err.message}`);
                return { ok: false, items: answerItems, message: messageFor(err.chatReason, language) };
            }
            throw err; // "no answer" — EverySecond saves its order and order.created retries ours
        }
    }

    // Quote: our merchandise total and, once the governorate is known, our shipping fee.
    const sellable = lines.filter((l) => !l.problem);
    const itemsTotal = round2(sellable.reduce((sum, l) => sum + l.unit * l.qty, 0));
    let deliveryFee = null;
    const address = orderAddressFromChat(fulfillment, { cities: await storeCities() });
    if (address.shipping_destination && sellable.length) {
        try {
            const { getPricedOrderPreview } = require('../orderService');
            const preview = await Promise.race([
                getPricedOrderPreview({ userId: null, items: orderItemsOf(sellable), shippingDestination: address.shipping_destination }),
                sleep(2500).then(() => null),
            ]);
            if (preview) deliveryFee = round2(preview.shippingTotal);
        } catch (err) {
            if (err?.code === 'SHIPPING_NO_ZONE') return { ok: false, items: answerItems, message: messageFor('noShipping', language) };
            console.warn('[everysecond] quote shipping failed:', err.message);
        }
    }
    return {
        ok: true,
        items: answerItems,
        ...(deliveryFee !== null ? { delivery_fee: deliveryFee, total: round2(itemsTotal + deliveryFee) } : {}),
        merchant_ref: null,
        payment_url: null,
        message: null,
    };
}

/* ------------------------------------------------------------------ */
/* Order events                                                        */
/* ------------------------------------------------------------------ */

const findByReference = (ref) => (ref ? Order.findOne({ 'transaction.reference': String(ref) }) : null);

const sameBasket = (ours, theirs) => {
    const key = (rows) => rows.map((r) => `${r.id}x${r.qty}`).sort().join(',');
    return key(ours.map((it) => ({ id: String(it.product_id), qty: Number(it.quantity) })))
        === key(theirs.map((it) => ({ id: parseExternalId(it.external_id)?.productId || '', qty: Number(it.qty) })));
};

/*
 * Our answer at "place" arrived after EverySecond stopped waiting, so its order
 * has no merchant_ref — but ours exists. Same phone, same basket, last 30 min.
 */
async function findLatePlacedOrder(esOrder) {
    const phone = phoneOf(esOrder.customer);
    if (!isValidEgyptMobile(phone)) return null;
    const { phoneLookupVariants } = require('../shared/phone');
    const candidates = await Order.find({
        source: 'everysecond',
        'chat.es_order_id': null,
        'shipping_address.phone': { $in: phoneLookupVariants(phone) },
        created_at: { $gte: new Date(Date.now() - 30 * 60_000) },
    }).sort({ created_at: -1 });
    return candidates.find((o) => sameBasket(o.items || [], esOrder.items || [])) || null;
}

async function linkChat(order, esOrder) {
    await Order.updateOne({ _id: order._id }, {
        $set: {
            source: 'everysecond',
            'chat.es_order_id': esOrder.id,
            'chat.lead_id': esOrder.customer?.lead_id ?? order.chat?.lead_id ?? null,
            'chat.channel': esOrder.channel || order.chat?.channel || '',
            'chat.conversation_url': esOrder.conversation_url || '',
        },
    });
}

async function onOrderCreated(esOrder) {
    if (!esOrder?.id) return 'ignored';
    if (await Order.exists({ 'chat.es_order_id': esOrder.id })) return 'processed';

    let ours = await findByReference(esOrder.merchant_ref);
    if (!ours) ours = await findLatePlacedOrder(esOrder);

    if (!ours) {
        // The validation never placed it (no webhook then, or no answer in time): place it now.
        const lines = await resolveLines((esOrder.items || []).map((it) => ({ external_id: it.external_id, qty: it.qty })));
        const language = esOrder.customer?.language === 'en' ? 'en' : 'ar';
        try {
            if (!lines.length || lines.some((l) => l.problem)) {
                throw Object.assign(new Error('lines no longer sellable'), { chatReason: 'unavailable' });
            }
            ours = await createChatOrder({
                customer: esOrder.customer,
                channel: esOrder.channel,
                chatId: esOrder.chat_id,
                lines,
                fulfillment: {
                    type: esOrder.fulfillment_type,
                    zone: esOrder.delivery_zone,
                    address: esOrder.address,
                    address_details: esOrder.address_details,
                },
                esOrder,
            });
            // Our number reaches EverySecond with the first status announcement (merchant_ref).
        } catch (err) {
            if (!err.chatReason) throw err;
            // Cannot be fulfilled: tell the customer in the chat rather than leave a phantom order there.
            await api('POST', `/orders/${esOrder.id}/cancel`, {
                notify_customer: true,
                message: messageFor(err.chatReason === 'unavailable' ? 'failed' : err.chatReason, language),
            });
            return 'processed';
        }
    }

    await linkChat(ours, esOrder);
    return 'processed';
}

/* EverySecond could not save an order we accepted at "place" — void ours. The agent already told the customer. */
async function onOrderFailed(data) {
    const ref = data?.context?.merchant_ref || data?.order?.merchant_ref || data?.merchant_ref;
    const ours = await findByReference(ref);
    if (!ours || ours.status !== 'pending') return 'ignored';
    const { cancelWholeOrder } = require('../orderService');
    await cancelWholeOrder(ours, ACTOR);
    await Order.updateOne({ _id: ours._id }, { $set: { 'chat.announced_status': 'cancelled' } });
    return 'processed';
}

/* Cancelled on EverySecond's side (staff there, or the customer in chat) before anything shipped. */
async function onOrderCancelled(esOrder) {
    const ours = (esOrder?.id ? await Order.findOne({ 'chat.es_order_id': esOrder.id }) : null)
        || (await findByReference(esOrder?.merchant_ref));
    if (!ours || !['pending', 'processing', 'confirmed'].includes(ours.status)) return 'ignored';
    const { cancelWholeOrder } = require('../orderService');
    await cancelWholeOrder(ours, ACTOR);
    await Order.updateOne({ _id: ours._id }, { $set: { 'chat.announced_status': 'cancelled' } });
    return 'processed';
}

async function processEvent(stored) {
    const data = stored.payload?.data || {};
    try {
        let outcome = 'ignored';
        if (stored.event === 'order.created') outcome = await onOrderCreated(data.order);
        else if (stored.event === 'order.failed') outcome = await onOrderFailed(data);
        else if (stored.event === 'order.cancelled') outcome = await onOrderCancelled(data.order);
        await markEvent(stored.event_id, outcome);
    } catch (err) {
        console.error(`[everysecond] ${stored.event} ${stored.event_id} failed:`, err?.message || err);
        await markEvent(stored.event_id, 'failed', String(err?.message || err).slice(0, 500));
    }
}

/**
 * One verified webhook delivery. order.validate is answered synchronously;
 * every other event is stored once (a retry carries the same id) and applied
 * after the 2xx has gone back.
 */
async function receiveEvent({ eventId, event, envelope }) {
    if (event === 'order.validate') return { sync: true, answer: await validateOrder(envelope?.data || {}) };
    const stored = await recordEvent({ eventId: String(eventId || envelope?.id || ''), event, payload: envelope });
    return { sync: false, process: stored ? () => processEvent(stored) : null };
}

async function retryEvents() {
    const due = await findRetryableEvents({ olderThan: new Date(Date.now() - 60_000) });
    for (const stored of due) await processEvent(stored);
    return due.length;
}

/*
 * Catch-up: orders EverySecond holds that never reached us — the webhook was
 * down, not registered yet, or this is a local machine EverySecond cannot call.
 * Read newest first, stop at the first one we already know.
 */
async function importMissedOrders({ sinceMinutes = 24 * 60 } = {}) {
    const since = new Date(Date.now() - sinceMinutes * 60_000).toISOString().slice(0, 10);
    let res;
    try {
        res = await api('GET', `/orders?per_page=50&since=${since}`);
    } catch (err) {
        if (err.status === 403) return 0; // the Orders module is off for this agent: nothing to catch up on
        throw err;
    }
    let imported = 0;
    for (const esOrder of res?.data || []) {
        if (!esOrder?.id || esOrder.status === 'cancelled') continue;
        if (await Order.exists({ 'chat.es_order_id': esOrder.id })) continue;
        // Only orders the agent took from a chat; dashboard orders are not ours to place.
        if (esOrder.created_by && esOrder.created_by !== 'ai') continue;
        const eventId = `import:${esOrder.id}`;
        const stored = await recordEvent({ eventId, event: 'order.created', payload: { id: eventId, event: 'order.created', data: { order: esOrder } } });
        if (stored) {
            await processEvent(stored);
            imported += 1;
        }
    }
    return imported;
}

/* ------------------------------------------------------------------ */
/* Store → customer                                                    */
/* ------------------------------------------------------------------ */

/**
 * Tell the customer about this order's status, in the conversation it came
 * from. Idempotent on our side (announced_status) and on EverySecond's
 * ("repeating a call never messages the customer twice").
 */
async function announceOrderStatus(order) {
    if (!isConfigured() || order?.source !== 'everysecond') return false;
    const target = ES_STATUS_FOR[order.status];
    const told = order.chat?.announced_status || '';
    if (!target || told === target) return false;
    // Forward only: never announce a step the customer has already passed.
    if (target !== 'cancelled' && (ES_STATUS_RANK[told] ?? -1) >= ES_STATUS_RANK[target]) return false;

    const ref = order.transaction?.reference;
    const path = order.chat?.es_order_id
        ? `/orders/${order.chat.es_order_id}/status`
        : `/orders/ref/${encodeURIComponent(ref || '')}/status`;
    try {
        // A fulfilment status is refused before the order is confirmed there.
        if (target !== 'cancelled' && target !== 'confirmed' && !told) {
            await api('POST', path, { status: 'confirmed', merchant_ref: ref, notify_customer: false }).catch((err) => {
                if (err.status !== 409) throw err;
            });
        }
        await api('POST', path, { status: target, merchant_ref: ref, notify_customer: true });
        await Order.updateOne({ _id: order._id }, {
            $set: { 'chat.announced_status': target, 'chat.announced_at': new Date(), 'chat.announce_error': '', 'chat.announce_attempts': 0 },
        });
        return true;
    } catch (err) {
        // 409: EverySecond's order is already past this point (or cancelled there) — nothing to say.
        const settled = err.status === 409;
        await Order.updateOne({ _id: order._id }, {
            $set: {
                ...(settled ? { 'chat.announced_status': target } : {}),
                'chat.announce_error': String(err?.message || err).slice(0, 500),
                'chat.announced_at': new Date(),
            },
            ...(settled ? {} : { $inc: { 'chat.announce_attempts': 1 } }),
        });
        return false;
    }
}

/** Every chat order whose status moved since the customer was last told. */
async function sweepStatusAnnouncements({ limit = 100 } = {}) {
    const statuses = Object.keys(ES_STATUS_FOR);
    const orders = await Order.find({
        source: 'everysecond',
        status: { $in: statuses },
        'chat.announce_attempts': { $lt: 10 },
        created_at: { $gte: new Date(Date.now() - 60 * 24 * 60 * 60_000) },
    })
        .select('status transaction.reference chat source')
        .sort({ created_at: -1 })
        .limit(limit * 4)
        .lean();
    let told = 0;
    for (const order of orders) {
        if (ES_STATUS_FOR[order.status] === order.chat?.announced_status) continue;
        if (await announceOrderStatus(order)) told += 1;
        if (told >= limit) break;
    }
    return told;
}

module.exports = {
    validateOrder,
    receiveEvent,
    retryEvents,
    importMissedOrders,
    announceOrderStatus,
    sweepStatusAnnouncements,
    chatReasonOf,
};
