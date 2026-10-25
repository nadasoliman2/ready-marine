/**
 * Vendor supplies — the small shop that sells packaging and labels to vendors.
 *
 * Two halves:
 *   CATALOGUE — admin-owned CRUD over `SupplyProduct`. Prices are per PACK.
 *   ORDERS    — a vendor fills a basket, the wallet pays what it can, a hosted invoice
 *               covers the rest, and the admin ships it.
 *
 * The money rule that shapes everything here: a vendor's wallet balance is DERIVED from
 * the rows that spend it (see vendorEarningsService.recomputeWalletBalances), never
 * incremented or decremented. So "charging the wallet" means writing `wallet_amount` on the
 * order, and "refunding" means moving that order to a status the derivation ignores. There
 * is no balance to get out of step, and no compensating write to forget.
 */

const mongoose = require('mongoose');

const { SupplyProduct } = require('../models/supplyProducts');
const {
    SupplyOrder,
    generateSupplyOrderNumber,
    appendSupplyHistory,
} = require('../models/supplyOrders');
const { Seller } = require('../models/sellers');
const { createNotification } = require('../models/notifications');
const { recordAuditLog } = require('../models/auditLog');
const gateway = require('./paymentGateway');
const vendorEarningsService = require('./vendorEarningsService');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const fail = (code, message, status = 400) => {
    const err = new Error(message);
    err.code = code;
    err.status = status;
    return err;
};

const getFrontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
const getBackendUrl = () => (process.env.BACKEND_PUBLIC_URL || 'http://localhost:4000').replace(/\/$/, '');

/* ------------------------------------------------------------------ */
/* Catalogue — admin                                                   */
/* ------------------------------------------------------------------ */

const CATALOGUE_FIELDS = [
    'name', 'name_ar', 'description', 'description_ar', 'category', 'dimensions',
    'price', 'pack_size', 'unit_label', 'unit_label_ar',
    'min_order_quantity', 'max_order_quantity', 'image', 'is_active', 'sort_order',
];

const pickCataloguePayload = (data = {}) => {
    const out = {};
    for (const key of CATALOGUE_FIELDS) {
        if (data[key] === undefined) continue;
        out[key] = data[key];
    }
    if (out.price !== undefined) out.price = Math.max(0, Number(out.price) || 0);
    if (out.pack_size !== undefined) out.pack_size = Math.max(1, Number(out.pack_size) || 1);
    if (out.min_order_quantity !== undefined) out.min_order_quantity = Math.max(1, Number(out.min_order_quantity) || 1);
    if (out.max_order_quantity !== undefined) {
        const max = Number(out.max_order_quantity);
        out.max_order_quantity = Number.isFinite(max) && max > 0 ? max : null;
    }
    return out;
};

const listSupplyProducts = async ({ includeInactive = false, category } = {}) => {
    const filter = {};
    if (!includeInactive) filter.is_active = true;
    if (category && category !== 'all') filter.category = category;
    return SupplyProduct.find(filter).sort({ sort_order: 1, category: 1, price: 1 }).lean();
};

const createSupplyProduct = async (data, actor = {}) => {
    const payload = pickCataloguePayload(data);
    if (!payload.name) throw fail('NAME_REQUIRED', 'The item needs a name.');
    if (payload.price === undefined) throw fail('PRICE_REQUIRED', 'The item needs a price.');
    const product = await SupplyProduct.create(payload);
    await recordAuditLog({
        action: 'supply_product_created',
        actor: { role: 'admin', label: actor.label || 'Admin' },
        target_type: 'supply_product',
        target_id: product._id,
        target_snapshot: { name: product.name, price: product.price, pack_size: product.pack_size },
    });
    return product;
};

const updateSupplyProduct = async (id, data, actor = {}) => {
    const product = await SupplyProduct.findById(id);
    if (!product) throw fail('NOT_FOUND', 'Item not found', 404);
    const before = { name: product.name, price: product.price, pack_size: product.pack_size };
    Object.assign(product, pickCataloguePayload(data));
    await product.save();
    await recordAuditLog({
        action: 'supply_product_updated',
        actor: { role: 'admin', label: actor.label || 'Admin' },
        target_type: 'supply_product',
        target_id: product._id,
        target_snapshot: before,
        impact: { name: product.name, price: product.price, pack_size: product.pack_size },
    });
    return product;
};

/**
 * Delete an item outright.
 *
 * Safe because every order line snapshots what it bought — name, price, pack size — so a
 * deleted item leaves past orders fully readable. Deactivating is still the better move for
 * something merely out of stock, and the admin UI says so.
 */
const deleteSupplyProduct = async (id, actor = {}) => {
    const product = await SupplyProduct.findById(id);
    if (!product) throw fail('NOT_FOUND', 'Item not found', 404);

    // Refuse only while an order is still in flight: the admin is about to pack this thing,
    // and removing it from the catalogue mid-fulfilment loses them the reference.
    const openOrders = await SupplyOrder.countDocuments({
        'items.product_id': product._id,
        status: { $in: ['pending', 'approved'] },
    });
    if (openOrders > 0) {
        throw fail(
            'ITEM_IN_OPEN_ORDER',
            `${openOrders} open order(s) still include this item. Deactivate it instead, or finish those orders first.`,
            409
        );
    }

    await product.deleteOne();
    await recordAuditLog({
        action: 'supply_product_deleted',
        actor: { role: 'admin', label: actor.label || 'Admin' },
        target_type: 'supply_product',
        target_id: product._id,
        target_snapshot: { name: product.name, price: product.price },
    });
    return { deleted: true };
};

/* ------------------------------------------------------------------ */
/* Ordering — vendor                                                   */
/* ------------------------------------------------------------------ */

/** Turn a raw basket into priced, snapshotted lines. Throws on anything it cannot honour. */
const buildOrderItems = async (rawItems = []) => {
    const list = Array.isArray(rawItems) ? rawItems : [];
    if (list.length === 0) throw fail('EMPTY_ORDER', 'Add at least one item to your order.');

    const ids = list
        .map((i) => String(i?.product_id || ''))
        .filter((id) => mongoose.Types.ObjectId.isValid(id));
    const products = await SupplyProduct.find({ _id: { $in: ids }, is_active: true }).lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));

    const items = [];
    for (const raw of list) {
        const product = byId.get(String(raw?.product_id || ''));
        // Refuse rather than skip: silently dropping a line would charge the vendor for an
        // order that is not the one they submitted.
        if (!product) throw fail('ITEM_UNAVAILABLE', 'One of the items is no longer available.');

        const quantity = Math.floor(Number(raw.quantity) || 0);
        if (quantity < 1) continue;
        if (quantity < product.min_order_quantity) {
            throw fail('BELOW_MIN', `${product.name}: the smallest order is ${product.min_order_quantity}.`);
        }
        if (product.max_order_quantity && quantity > product.max_order_quantity) {
            throw fail('ABOVE_MAX', `${product.name}: the largest order is ${product.max_order_quantity}.`);
        }

        items.push({
            product_id: product._id,
            name: product.name,
            name_ar: product.name_ar || '',
            dimensions: product.dimensions || '',
            category: product.category,
            quantity,
            unit_price: product.price,
            pack_size: product.pack_size,
            unit_label: product.unit_label,
            unit_label_ar: product.unit_label_ar,
            line_total: round2(quantity * product.price),
        });
    }

    if (items.length === 0) throw fail('EMPTY_ORDER', 'Add at least one item to your order.');
    return items;
};

/** The vendor's default branch, so the admin knows where to send the box. */
const shipToForVendor = (vendor) => {
    const location = (vendor.locations || []).find((l) => l.is_default) || (vendor.locations || [])[0] || {};
    return {
        contact_name: vendor.name || vendor.store_name || '',
        phone: vendor.phone || '',
        address: location.address || '',
        city: location.shipping_city || '',
    };
};

/**
 * Place an order.
 *
 * The wallet pays as much as it can and an invoice covers the remainder. The wallet share
 * is committed by WRITING THE ROW, which is also what reserves it — so the check for
 * overspending has to happen after the write, not before. Two tabs submitting at once both
 * read the same balance; only the recount afterwards can catch the second one, and it
 * voids that order rather than letting a vendor spend the same money twice.
 */
const createSupplyOrder = async (vendorId, { items: rawItems, vendor_note = '', delivery_method } = {}) => {
    const vendor = await Seller.findById(vendorId).lean();
    if (!vendor) throw fail('VENDOR_NOT_FOUND', 'Vendor not found', 404);

    // Frozen onto the order before any money moves, so the webhook and the
    // retry both read the gateway that actually holds this payment rather than
    // whatever the admin switch happens to say later.
    const provider = await gateway.resolveProvider();

    const items = await buildOrderItems(rawItems);
    const total = round2(items.reduce((sum, i) => sum + i.line_total, 0));
    if (total <= 0) throw fail('INVALID_TOTAL', 'This order comes to nothing to pay.');

    // Read the balance fresh — a cached one is exactly how a vendor ends up overdrawn.
    const wallet = await vendorEarningsService.recomputeWalletBalances(vendorId);
    const walletAmount = round2(Math.min(Math.max(0, wallet.available_balance), total));
    const onlineAmount = round2(total - walletAmount);

    const order = await SupplyOrder.create({
        order_number: generateSupplyOrderNumber(),
        vendor_id: vendorId,
        items,
        total,
        wallet_amount: walletAmount,
        online_amount: onlineAmount,
        // Fully covered by the wallet settles on the spot; anything else waits for the
        // invoice, and holds the wallet share meanwhile.
        payment_status: onlineAmount === 0 ? 'paid' : 'awaiting_online',
        settled_at: onlineAmount === 0 ? new Date() : null,
        status: 'pending',
        ship_to: shipToForVendor(vendor),
        delivery: { method: delivery_method || 'with_pickup' },
        vendor_note: String(vendor_note || '').trim().slice(0, 500),
        payment: { provider, provider_mode: gateway.getModeFor(provider) },
    });

    appendSupplyHistory(
        order, 'order_placed', 'Order placed',
        `${items.length} item(s), ${total} EGP — ${walletAmount} from wallet, ${onlineAmount} online.`,
        { role: 'vendor', label: vendor.store_name || vendor.name }
    );
    await order.save();

    // The row is now part of the derivation, so recounting tells us whether it fitted.
    const after = await vendorEarningsService.recomputeWalletBalances(vendorId);
    if (after.available_balance < 0) {
        order.payment_status = 'cancelled';
        order.status = 'cancelled';
        appendSupplyHistory(order, 'order_voided', 'Order voided',
            'The wallet balance changed while this order was being placed.', { role: 'system' });
        await order.save();
        await vendorEarningsService.recomputeWalletBalances(vendorId);
        throw fail('WALLET_CHANGED', 'Your wallet balance changed while the order was being placed. Please try again.', 409);
    }

    if (onlineAmount === 0) {
        await notifyAdminsOfNewOrder(order, vendor);
        return { order, payment_url: null };
    }

    const paymentUrl = await attachInvoice(order, vendor);
    return { order, payment_url: paymentUrl };
};

/**
 * Where the vendor lands after paying.
 *
 * Exported because the shared Paymob return route has to rebuild it: Paymob
 * redirects every payment to one endpoint, and that endpoint is what sends the
 * vendor back to their supplies page.
 */
const buildReturnUrl = (order, status) =>
    `${getFrontendUrl()}/dashboard/supplies?payment=${status}&orderId=${order._id.toString()}`;

/** Open the hosted payment page for the online remainder and store its handles. */
const attachInvoice = async (order, vendor) => {
    const [firstName, ...rest] = String(vendor.name || vendor.store_name || 'Vendor').trim().split(/\s+/);
    const provider = order.payment?.provider || await gateway.resolveProvider();

    // A fresh attempt number for every page we open. Paymob refuses a reference
    // it has seen before, so reusing one would make `retryPayment` fail at the
    // provider rather than giving the vendor a second chance to pay.
    order.payment.attempt = (order.payment.attempt || 0) + 1;

    const request = {
        flow: 'supply',
        recordId: order._id,
        attempt: order.payment.attempt,
        provider,
        amount: Number(order.online_amount),
        currency: gateway.getCurrencyFor(provider),
        customer: {
            first_name: firstName || 'Vendor',
            last_name: rest.join(' ') || '-',
            email: vendor.email,
            phone: vendor.phone,
            address: order.ship_to?.address || '',
            city: order.ship_to?.city || '',
            unique_id: vendor._id.toString(),
        },
        // The payment covers the ONLINE REMAINDER, not the order total — the wallet already
        // holds the rest. Both providers reject a breakdown whose lines do not add up to
        // the charge, so the real itemisation can only be sent when the vendor is paying for
        // the whole order online. A part-paid order goes as one balance line instead; the
        // full breakdown is on the order itself either way.
        items: order.wallet_amount > 0
            ? [{
                name: `Supplies ${order.order_number} — balance after wallet`,
                price: Number(order.online_amount),
                quantity: 1,
            }]
            : order.items.map((i) => ({
                name: `${i.name}${i.dimensions ? ` (${i.dimensions})` : ''}`,
                price: Number(i.unit_price),
                quantity: i.quantity,
            })),
        returnUrls: {
            success: buildReturnUrl(order, 'success'),
            fail: buildReturnUrl(order, 'failed'),
            pending: buildReturnUrl(order, 'pending'),
        },
        webhookUrl: `${getBackendUrl()}/api/vendors/supplies/fawaterak/webhook_json`,
        extras: { supplyOrderId: order._id.toString(), vendorId: vendor._id.toString() },
    };

    let hosted;
    try {
        hosted = await gateway.createHostedPayment(request);
    } catch (err) {
        // The order stays alive and unpaid so the vendor can retry rather than rebuild the
        // basket, but the wallet hold is released — an invoice that never existed must not
        // sit on their balance.
        order.payment_status = 'failed';
        order.payment.error = err.message;
        appendSupplyHistory(order, 'payment_failed', 'Could not start the payment', err.message, { role: 'system' });
        await order.save();
        await vendorEarningsService.recomputeWalletBalances(order.vendor_id);
        throw fail('PAYMENT_START_FAILED', `Could not start the payment: ${err.message}`);
    }

    order.payment.provider = hosted.provider;
    order.payment.provider_mode = hosted.provider_mode;
    order.payment.invoice_id = hosted.invoice_id;
    order.payment.invoice_key = hosted.invoice_key;
    order.payment.payment_url = hosted.payment_url;
    order.payment.provider_reference = hosted.provider_reference;
    order.payment.raw_response = hosted.raw_response;
    await order.save();

    if (!order.payment.payment_url) {
        throw fail('PAYMENT_URL_MISSING', 'The payment provider did not return a payment link.');
    }
    return order.payment.payment_url;
};

/** Re-open a payment for an order whose invoice failed or was abandoned. */
const retryPayment = async (vendorId, orderId) => {
    const order = await SupplyOrder.findOne({ _id: orderId, vendor_id: vendorId });
    if (!order) throw fail('NOT_FOUND', 'Order not found', 404);
    if (order.payment_status === 'paid') throw fail('ALREADY_PAID', 'This order is already paid.');
    if (['cancelled', 'rejected'].includes(order.status)) throw fail('ORDER_CLOSED', 'This order is closed.');

    if (order.payment.payment_url && order.payment_status === 'awaiting_online') {
        return { order, payment_url: order.payment.payment_url };
    }

    const vendor = await Seller.findById(vendorId).lean();
    // Re-hold the wallet share before the invoice exists, so the two halves of the payment
    // are never live under different assumptions about the balance.
    order.payment_status = 'awaiting_online';
    order.payment.error = null;
    await order.save();
    const paymentUrl = await attachInvoice(order, vendor);
    return { order, payment_url: paymentUrl };
};

/* ------------------------------------------------------------------ */
/* Payment settlement                                                  */
/* ------------------------------------------------------------------ */

const findOrderFromWebhook = async (payload = {}) => {
    let supplyOrderId = payload.pay_load?.supplyOrderId;
    if (!supplyOrderId && typeof payload.pay_load === 'string') {
        try { supplyOrderId = JSON.parse(payload.pay_load)?.supplyOrderId; } catch (_) {}
    }
    if (supplyOrderId && mongoose.Types.ObjectId.isValid(String(supplyOrderId))) {
        const byPayload = await SupplyOrder.findById(supplyOrderId);
        if (byPayload) return byPayload;
    }
    const or = [];
    if (payload.invoice_id) or.push({ 'payment.invoice_id': String(payload.invoice_id) });
    if (payload.invoice_key) or.push({ 'payment.invoice_key': payload.invoice_key });
    if (!or.length) return null;
    return SupplyOrder.findOne({ $or: or });
};

/**
 * Mark an order paid. Idempotent: the redirect and the webhook routinely confirm the same
 * payment milliseconds apart, and a second call must not re-notify or re-settle.
 */
const settlePaidOrder = async (order, webhookPayload = null) => {
    if (order.payment_status === 'paid') return order;

    order.payment_status = 'paid';
    order.settled_at = new Date();
    order.payment.paid_at = new Date();
    if (webhookPayload) {
        if (webhookPayload.payment_method) order.payment.payment_method = webhookPayload.payment_method;
        order.payment.webhook_payloads.push(webhookPayload);
    }
    appendSupplyHistory(
        order, 'payment_settled', 'Payment received',
        `${order.wallet_amount} EGP from the wallet, ${order.online_amount} EGP online.`,
        { role: 'system' }
    );
    await order.save();

    // The wallet share moves from held to spent — same total either way, but the vendor's
    // wallet page should stop calling it "reserved".
    await vendorEarningsService.recomputeWalletBalances(order.vendor_id);

    const vendor = await Seller.findById(order.vendor_id).lean();
    await notifyAdminsOfNewOrder(order, vendor);
    return order;
};

/**
 * Ask the provider whether an order's online half was actually paid, and settle it if so.
 *
 * This is the path the webhook is NOT. A hosted-page payment reaches us three ways — the
 * provider's server-to-server callback, the vendor's browser landing back on the supplies
 * page, and a periodic sweep — and every one of them has to be able to settle on its own.
 * The webhook alone was the whole story for this flow until a vendor paid, Fawaterak's
 * callback was rejected at the signature check, and the order sat on "awaiting payment"
 * with the money already taken. The other three flows never had that failure mode because
 * each re-reads the payment from the provider on the redirect; this closes the gap.
 *
 * Never trusts anything the browser says: the only input is the order, the only source of
 * truth is `gateway.readPayment`.
 */
const readPaymentFromProvider = async (order) => gateway.readPayment({
    provider: order.payment?.provider || 'fawaterak',
    invoice_id: order.payment?.invoice_id,
    invoice_key: order.payment?.invoice_key,
    provider_reference: order.payment?.provider_reference,
});

const confirmPaymentFor = async (order, { source }) => {
    if (order.payment_status === 'paid') return { status: 'paid', alreadyPaid: true, order };
    if (order.payment_status !== 'awaiting_online') {
        return { status: order.payment_status, order };
    }
    if (!order.payment?.invoice_id && !order.payment?.provider_reference) {
        return { status: 'pending', order, reason: 'no payment was ever opened for this order' };
    }

    const confirmation = await readPaymentFromProvider(order);
    order.payment.raw_response = {
        ...(order.payment.raw_response || {}),
        confirmation: confirmation.envelope,
    };

    if (!confirmation.paid) {
        await order.save();
        return { status: 'pending', order };
    }

    await settlePaidOrder(order, gateway.buildConfirmationPayload(confirmation, { source }));
    return { status: 'paid', order };
};

/** The vendor, back from the payment page. Scoped to their own orders. */
const confirmPayment = async (vendorId, orderId) => {
    const order = await SupplyOrder.findOne({ _id: orderId, vendor_id: vendorId });
    if (!order) throw fail('NOT_FOUND', 'Order not found', 404);
    return confirmPaymentFor(order, { source: 'redirect_confirmation' });
};

/**
 * An admin looking at an order that says "awaiting payment" while the vendor swears they
 * paid. One press asks the provider, and the answer is written to the order's history
 * either way so the next person to open it does not have to ask again.
 */
const recheckPayment = async (orderId, actor = {}) => {
    const order = await SupplyOrder.findById(orderId);
    if (!order) throw fail('NOT_FOUND', 'Order not found', 404);

    const result = await confirmPaymentFor(order, { source: 'admin_recheck' });
    if (result.status !== 'paid' || result.alreadyPaid) {
        appendSupplyHistory(order, 'payment_rechecked', 'Payment re-checked with the provider',
            result.alreadyPaid
                ? 'The order was already marked paid.'
                : `The provider reports the online payment is still ${result.status}.`,
            actor, { status: result.status, invoice_id: order.payment?.invoice_id || null });
        await order.save();
    }
    return result;
};

/**
 * Hourly safety net: any order still waiting on its online half is re-read from the
 * provider, and settled if the money is there. Cheap — a handful of GETs — and the only
 * thing standing between a lost webhook and a vendor whose order never moves.
 *
 * Leaves unpaid orders alone. The vendor can cancel their own, the admin can reject, and
 * the wallet hold is released by either; deciding when "abandoned" begins is not a job
 * for a sweep.
 */
const sweepAwaitingOrders = async () => {
    // Give the provider a few minutes before asking; a vendor still on the payment page is
    // not a lost webhook.
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const candidates = await SupplyOrder.find({
        payment_status: 'awaiting_online',
        status: { $nin: ['cancelled', 'rejected'] },
        updatedAt: { $lte: cutoff },
        $or: [{ 'payment.invoice_id': { $ne: null } }, { 'payment.provider_reference': { $ne: null } }],
    }).limit(200);

    let checked = 0;
    let rescued = 0;
    for (const order of candidates) {
        checked += 1;
        try {
            const result = await confirmPaymentFor(order, { source: 'sweep' });
            if (result.status === 'paid' && !result.alreadyPaid) rescued += 1;
        } catch (err) {
            console.error(`[Supplies] Sweep could not read payment for ${order.order_number}: ${err.message}`);
        }
    }
    if (rescued > 0) console.log(`[Supplies] Settled ${rescued} paid order(s) the webhook never reported.`);
    return { checked, rescued };
};

/* ------------------------------------------------------------------ */
/* Admin management                                                    */
/* ------------------------------------------------------------------ */

const listOrdersForAdmin = async ({ status = 'all', payment_status = 'all', vendor_id, page = 1, limit = 20 } = {}) => {
    const filter = {};
    if (status && status !== 'all') filter.status = status;
    if (payment_status && payment_status !== 'all') filter.payment_status = payment_status;
    if (vendor_id && mongoose.Types.ObjectId.isValid(String(vendor_id))) filter.vendor_id = vendor_id;

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));

    const [total, orders, pendingCount] = await Promise.all([
        SupplyOrder.countDocuments(filter),
        SupplyOrder.find(filter)
            .sort({ createdAt: -1 })
            .skip((safePage - 1) * safeLimit)
            .limit(safeLimit)
            .populate('vendor_id', 'store_name store_username phone email')
            .lean(),
        // The sidebar badge: orders the admin has not acted on AND that are actually paid
        // for. An unpaid one is the vendor's move, not theirs.
        SupplyOrder.countDocuments({ status: 'pending', payment_status: 'paid' }),
    ]);

    return {
        orders,
        pending_count: pendingCount,
        pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) },
    };
};

const listOrdersForVendor = async (vendorId, { page = 1, limit = 20 } = {}) => {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const filter = { vendor_id: vendorId };
    const [total, orders] = await Promise.all([
        SupplyOrder.countDocuments(filter),
        SupplyOrder.find(filter).sort({ createdAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
    ]);
    return { orders, pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) } };
};

const VENDOR_NOTIFICATIONS = {
    approved: ['supply_order_approved', 'Supplies order approved'],
    sent: ['supply_order_sent', 'Supplies order on its way'],
    delivered: ['supply_order_delivered', 'Supplies delivered'],
    rejected: ['supply_order_rejected', 'Supplies order rejected'],
};

/**
 * The admin's whole management surface: move an order along, with a reason when that
 * matters. Deliberately a single transition function rather than five endpoints — the rules
 * about what may follow what belong in one place.
 */
const ALLOWED_TRANSITIONS = {
    pending: ['approved', 'rejected', 'cancelled'],
    approved: ['sent', 'cancelled', 'rejected'],
    sent: ['delivered'],
    delivered: [],
    rejected: [],
    cancelled: [],
};

const updateOrderStatus = async (orderId, { status, note = '', tracking_number, delivery_method, actor = {} } = {}) => {
    const order = await SupplyOrder.findById(orderId);
    if (!order) throw fail('NOT_FOUND', 'Order not found', 404);

    const allowed = ALLOWED_TRANSITIONS[order.status] || [];
    if (!allowed.includes(status)) {
        throw fail('INVALID_TRANSITION', `An order that is "${order.status}" cannot become "${status}".`);
    }
    if (['rejected', 'cancelled'].includes(status) && !String(note || '').trim()) {
        throw fail('REASON_REQUIRED', 'Say why, so the vendor knows what happened.');
    }
    // Nothing ships before the money is in. The admin can still reject or cancel an unpaid
    // order, which is how an abandoned one gets cleared.
    if (status === 'approved' && order.payment_status !== 'paid') {
        throw fail('NOT_PAID', 'This order has not been paid yet.');
    }

    const from = order.status;
    order.status = status;
    if (note) order.admin_note = String(note).trim().slice(0, 500);
    if (delivery_method) order.delivery.method = delivery_method;
    if (tracking_number !== undefined) order.delivery.tracking_number = String(tracking_number || '').trim();
    if (status === 'sent') order.delivery.sent_at = new Date();
    if (status === 'delivered') order.delivery.delivered_at = new Date();
    if (['rejected', 'cancelled'].includes(status)) {
        order.rejection_reason = String(note).trim().slice(0, 300);
        // Refunding IS this: a closed order stops matching the wallet derivation, so the
        // held or spent amount returns to the vendor's balance with no ledger write.
        order.payment_status = 'cancelled';
    }

    appendSupplyHistory(order, `order_${status}`, `Order ${status}`, String(note || '').trim(), actor,
        { from, to: status, tracking_number: order.delivery.tracking_number || undefined });
    await order.save();

    if (['rejected', 'cancelled'].includes(status)) {
        await vendorEarningsService.recomputeWalletBalances(order.vendor_id);
    }

    const notif = VENDOR_NOTIFICATIONS[status];
    if (notif) {
        const [type, title] = notif;
        const detail = status === 'sent' && order.delivery.tracking_number
            ? `Tracking: ${order.delivery.tracking_number}`
            : String(note || '').trim();
        await createNotification(order.vendor_id, type, title,
            `Order ${order.order_number}${detail ? ` — ${detail}` : ''}`,
            { supply_order_id: order._id, order_number: order.order_number, status }
        ).catch((err) => console.error(`[Supplies] notify failed for ${order._id}: ${err.message}`));
    }

    await recordAuditLog({
        action: `supply_order_${status}`,
        actor: { role: actor.role || 'admin', label: actor.label || 'Admin' },
        target_type: 'supply_order',
        target_id: order._id,
        target_snapshot: { order_number: order.order_number, vendor_id: order.vendor_id, total: order.total },
        impact: { from, to: status },
    });

    return order;
};

/** A vendor withdrawing their own order, before the admin has packed anything. */
const cancelOwnOrder = async (vendorId, orderId, reason = '') => {
    const order = await SupplyOrder.findOne({ _id: orderId, vendor_id: vendorId });
    if (!order) throw fail('NOT_FOUND', 'Order not found', 404);
    if (!['pending'].includes(order.status)) {
        throw fail('TOO_LATE', 'This order is already being prepared. Ask support to cancel it.');
    }

    order.status = 'cancelled';
    order.payment_status = 'cancelled';
    order.rejection_reason = String(reason || 'Cancelled by the vendor').trim().slice(0, 300);
    appendSupplyHistory(order, 'order_cancelled', 'Order cancelled', order.rejection_reason, { role: 'vendor' });
    await order.save();
    await vendorEarningsService.recomputeWalletBalances(vendorId);
    return order;
};

/**
 * Tell the admin team a paid order is waiting to be packed.
 *
 * Fired on SETTLEMENT rather than on submission: an unpaid order is the vendor's move, and
 * an admin pulled to a queue item they cannot action learns to ignore the queue.
 * Fail-safe — the order is already in their list either way.
 */
const notifyAdminsOfNewOrder = async (order, vendor) => {
    try {
        const { User } = require('../models/users');
        const admins = await User.find({ role: 'admin' }).select('_id').lean();
        const storeName = vendor?.store_name || vendor?.name || 'A vendor';
        await Promise.allSettled(admins.map((admin) => createNotification(
            admin._id,
            'supply_order_placed',
            'New supplies order',
            `${storeName} ordered ${order.items.length} item(s) — ${order.total} EGP (${order.order_number}).`,
            { supply_order_id: order._id, order_number: order.order_number, vendor_id: order.vendor_id }
        )));
    } catch (err) {
        console.error(`[Supplies] Admin notification failed for ${order.order_number}: ${err.message}`);
    }
};

module.exports = {
    // catalogue
    listSupplyProducts,
    createSupplyProduct,
    updateSupplyProduct,
    deleteSupplyProduct,
    // vendor
    createSupplyOrder,
    listOrdersForVendor,
    retryPayment,
    cancelOwnOrder,
    // payment
    findOrderFromWebhook,
    settlePaidOrder,
    confirmPayment,
    recheckPayment,
    sweepAwaitingOrders,
    buildReturnUrl,
    // admin
    listOrdersForAdmin,
    updateOrderStatus,
};
