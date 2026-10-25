const { User } = require('../models/users');
const { OrderPayment } = require('../models/orderPayments');
const { SiteSettings } = require('../models/site_settings');
const { recordAuditLog } = require('../models/auditLog');
const { getPricedOrderPreview } = require('./orderService');
const shippingEngine = require('./shippingEngine');
const { notifyCustomer } = require('./customerNotificationService');
const {
    requireActiveFriendship,
    getSharedAddressIds,
    friendError,
} = require('./friendService');
const {
    resolveSharedAddress,
    toShippingAddressSnapshot,
} = require('./shared/addressAuthorization');
const { publicProfile } = require('./shared/customerIdentifier');
const { toPublicPreview: buildLoyaltyPreview } = require('./loyaltyService');
const walletService = require('./walletService');

const round2 = (value) => Number((Number(value) || 0).toFixed(2));

const getCurrency = async () => {
    try {
        const settings = await SiteSettings.findOne().select('currency').lean();
        return settings?.currency || 'QAR';
    } catch (err) {
        return 'QAR';
    }
};

/**
 * Authorize a friend checkout and price it from scratch.
 *
 * Everything the browser sends is treated as a *request*, never as authority:
 * the payer comes from the session, the recipient from an active friendship,
 * the address from the recipient's own address book gated by a live share
 * check, and every price, discount, and shipping cost is recomputed here.
 *
 * @param {ObjectId} payerUserId  Always taken from the authenticated session.
 */
const authorizeAndPrice = async (payerUserId, {
    friend_id,
    recipient_address_id,
    items = [],
    shipping_method_id = null,
    coupon_code = '',
    redeem_points = 0,
} = {}) => {
    if (!Array.isArray(items) || items.length === 0) {
        throw friendError('EMPTY_CART', 'Select at least one item', 400);
    }

    // 1 + 2. Friendship must be active, and neither side may have blocked the
    // other — `requireActiveFriendship` treats blocked and removed as "no such
    // friendship", so a blocked payer cannot even confirm the account exists.
    const friendship = await requireActiveFriendship(payerUserId, friend_id);

    // 3 + 4. The address must belong to the RECIPIENT and be shared with the
    // PAYER right now. Re-read on every call — never cached across the flow.
    const sharedIds = await getSharedAddressIds(friend_id, payerUserId);
    if (sharedIds.size === 0) {
        throw friendError(
            'NO_SHARED_ADDRESS',
            'This friend has not shared a delivery address with you yet',
            409
        );
    }
    const { owner: recipient, address } = await resolveSharedAddress(
        friend_id,
        recipient_address_id,
        sharedIds
    );

    const destination = {
        country: address.shipping_country || null,
        city: address.shipping_city || null,
    };

    // 7. The shipping method must still be offered for this destination.
    let quote = null;
    let selectedMethod = null;
    if (destination.country) {
        quote = await shippingEngine.getQuoteForDestination({ items, destination, useCache: true });
        const methods = quote?.available_methods || [];
        if (methods.length > 0) {
            selectedMethod = methods.find((method) => String(method.id) === String(shipping_method_id)) || null;
            if (!selectedMethod && shipping_method_id) {
                throw friendError('SHIPPING_METHOD_INVALID', 'Please choose an available shipping method', 400);
            }
        }
    }

    // 5 + 6 + 8. Products, variants, stock, and bundles are validated inside
    // the preview; the coupon is evaluated against the PAYER, who is the
    // paying customer — a coupon the recipient owns does not apply here.
    // Points, like the coupon, belong to the PAYER — the friend receiving the
    // parcel neither spends their balance nor earns from this order.
    const preview = await getPricedOrderPreview({
        userId: payerUserId,
        items,
        couponCode: coupon_code || '',
        shippingDestination: selectedMethod ? destination : null,
        shippingMethodId: selectedMethod ? selectedMethod.id : null,
        redeemPoints: redeem_points,
    });

    return {
        friendship,
        recipient,
        address,
        destination,
        quote,
        selectedMethod,
        preview,
        // The server-built payload. This — not anything from the client — is
        // what gets frozen onto the payment and later becomes the order.
        checkoutPayload: {
            shipping_address: toShippingAddressSnapshot(address),
            items,
            checkout_source: 'cart',
            coupon_code: coupon_code || undefined,
            shipping_destination: selectedMethod ? destination : null,
            shipping_method_id: selectedMethod ? selectedMethod.id : null,
            // Filled in by the caller once it knows which prepaid route is
            // live — the wallet, or the gateway when the wallet is switched off.
            payment_method: 'credit_card',
            friendship_id: friendship._id,
            paid_by_user_id: payerUserId,
            ordered_for_user_id: recipient._id,
            redeem_points: Number(preview.loyalty?.redeemed_points || 0),
        },
        total: round2(preview.total),
    };
};

/**
 * Authoritative preview for the friend checkout screen. Returns prices the
 * client may DISPLAY; it never returns anything the client may later submit as
 * authority — payment creation re-derives all of it.
 */
const previewFriendCheckout = async (payerUserId, body = {}) => {
    // COD must be impossible, not merely hidden. Reject any attempt to steer
    // this flow toward cash at the earliest point it can be expressed.
    assertPrepaidPayment(body);

    const result = await authorizeAndPrice(payerUserId, body);
    const currency = await getCurrency();
    const walletEnabled = await walletService.isWalletEnabled();

    return {
        recipient: publicProfile(result.recipient),
        address: {
            _id: result.address._id,
            label: result.address.label || '',
            recipient_name: result.address.recipient_name,
            phone: result.address.phone,
            full_address: result.address.full_address,
            shipping_country: result.address.shipping_country || null,
            shipping_city: result.address.shipping_city || null,
        },
        destination: result.destination,
        available_methods: result.quote?.available_methods || [],
        selected_method: result.selectedMethod,
        blocked_no_zone: result.quote?.blocked === true,
        coupon_applied: !!result.preview.couponResult,
        coupon: result.preview.couponResult?.coupon
            ? { code: result.preview.couponResult.coupon.code }
            : null,
        totals: {
            subtotal: round2(result.preview.subtotal),
            discount: round2(result.preview.discountAmount),
            loyalty_discount: round2(result.preview.loyalty?.discount || 0),
            shipping: round2(result.selectedMethod ? result.selectedMethod.total_cost : 0),
            total: round2(result.preview.total),
        },
        loyalty: buildLoyaltyPreview(result.preview.loyalty),
        currency,
        // The payer chooses, exactly as they would buying for themselves. Cash
        // is absent by design, not by omission: at the door it would be the
        // RECIPIENT paying for their own gift.
        payment_methods: await walletService.getAvailablePaymentMethods(),
        online_payment_only: true,
        // The payer's own wallet against THIS total. The recipient's balance is
        // deliberately absent and never consulted — a gift is paid for by the
        // person giving it.
        wallet: walletEnabled
            ? await (async () => {
                const check = await walletService.evaluateOrderPayment({
                    userId: payerUserId,
                    total: result.preview.total,
                });
                return {
                    enabled: true,
                    available: check.available,
                    shortfall: check.shortfall,
                    sufficient: check.sufficient,
                    status: check.status,
                    currency: check.currency,
                };
            })()
            : { enabled: false },
    };
};

/**
 * Friend orders are prepaid. Hiding cash on delivery in the UI is not a
 * control — this is the control.
 *
 * `wallet` joins `credit_card` as an accepted method rather than replacing it
 * in this check: the store can be switched back to gateway checkout at any
 * time, and a stale browser tab holding the other value must not be told its
 * perfectly ordinary order is forbidden. Cash remains rejected outright, which
 * is the rule this function exists to enforce.
 */
const assertPrepaidPayment = (body = {}) => {
    const method = body.payment_method;
    if (method && !['credit_card', 'wallet'].includes(method)) {
        throw friendError(
            'FRIEND_ORDER_ONLINE_ONLY',
            'Orders placed for a friend must be paid online',
            400
        );
    }
};

/**
 * Create the hosted payment invoice.
 *
 * No `Order` exists at this point and none is created if the customer abandons
 * the provider page. Authorization is verified here, once, and then frozen: the
 * spec is explicit that revoking a friendship AFTER funds are captured must not
 * strand a paid transaction.
 */
const createFriendPayment = async (payerUserId, body = {}) => {
    assertPrepaidPayment(body);

    const result = await authorizeAndPrice(payerUserId, body);

    // What the payer asked for decides the route. An older client sends
    // nothing, and then the wallet still wins wherever it is live — the
    // behaviour this flow had before the gateway rejoined it.
    const walletEnabled = await walletService.isWalletEnabled();
    const requested = body.payment_method || (walletEnabled ? 'wallet' : 'credit_card');

    if (requested === 'wallet' && !walletEnabled) {
        throw friendError('WALLET_DISABLED', 'Wallet checkout is currently unavailable', 409);
    }

    if (requested === 'credit_card' && !(await walletService.isOnlinePaymentAllowed())) {
        throw friendError(
            'ONLINE_PAYMENT_DISABLED',
            'Online payment is unavailable right now. Please choose another payment method.',
            409
        );
    }

    // ---- Wallet path: no invoice, no round trip, no window in which to fail ----
    //
    // The whole reason this function froze authorization onto a payment was the
    // external round trip: funds could be captured minutes after the friendship
    // was checked, and revoking it mid-payment must not strand money. Paying
    // from the wallet removes that gap entirely — authorization and payment
    // happen in the same request — so the order is simply placed.
    if (requested === 'wallet') {
        const { placeOrder } = require('./orderService');

        const order = await placeOrder(payerUserId, {
            ...result.checkoutPayload,
            payment_method: 'wallet',
        });

        await recordAuditLog({
            action: 'friend_order_paid_from_wallet',
            actor: { role: 'user', label: String(payerUserId) },
            target_type: 'friendship',
            target_id: result.friendship._id,
            target_snapshot: { order_id: order._id, ordered_for_user_id: result.recipient._id },
            impact: { amount: order.total_price },
        });

        // Both sides are told, exactly as they are on the gateway path.
        // Shaped like the payment record the gateway path passes, so both
        // routes produce identical notifications and audit trail.
        await notifyFriendOrderCreated(
            {
                user_id: payerUserId,
                ordered_for_user_id: result.recipient._id,
                friendship_id: result.friendship._id,
                checkout_context: 'friend',
            },
            order
        ).catch((err) => console.error('[FriendCheckout] notification failed:', err.message));

        return { mode: 'wallet', order, recipient: publicProfile(result.recipient) };
    }

    const { createOrderPayment } = require('./orderPaymentService');
    const { payment } = await createOrderPayment({
        // The hosted invoice always belongs to the authenticated payer.
        userId: payerUserId,
        orderData: result.checkoutPayload,
        friendContext: {
            checkout_context: 'friend',
            friendship_id: result.friendship._id,
            ordered_for_user_id: result.recipient._id,
            recipient_address_id: result.address._id,
        },
    });

    await recordAuditLog({
        action: 'friend_payment_created',
        actor: { role: 'user', label: String(payerUserId) },
        target_type: 'friendship',
        target_id: result.friendship._id,
        target_snapshot: { payment_id: payment._id, ordered_for_user_id: result.recipient._id },
        impact: { amount: payment.amount, currency: payment.currency },
    });

    return { payment, recipient: publicProfile(result.recipient) };
};

/**
 * Confirm a friend payment after the provider redirect.
 *
 * Idempotent by delegation: `confirmFawaterakOrderPayment` returns the existing
 * order when the payment already converted, so a refresh, a double click, or a
 * redirect racing its own webhook all resolve to the same single order.
 */
const confirmFriendPayment = async (payerUserId, { paymentId, invoiceId }) => {
    const payment = await OrderPayment.findOne({
        _id: paymentId,
        user_id: payerUserId,
        checkout_context: 'friend',
    });
    if (!payment) throw friendError('PAYMENT_NOT_FOUND', 'Payment not found', 404);

    if (payment.order_id) {
        return { status: 'paid', alreadyPaid: true, order_id: payment.order_id };
    }

    const { confirmFawaterakOrderPayment } = require('./orderPaymentService');
    const result = await confirmFawaterakOrderPayment({
        userId: payerUserId,
        paymentId: payment._id,
        invoiceId,
    });

    if (result.status !== 'paid') {
        await onFriendPaymentFailed(payment);
        return { status: result.status };
    }

    const fresh = await OrderPayment.findById(payment._id).select('order_id');
    return { status: 'paid', order_id: fresh?.order_id || result.order?._id || null };
};

/** Notify both parties once a friend payment became a real order. */
const notifyFriendOrderCreated = async (payment, order) => {
    const [payer, recipient, currency] = await Promise.all([
        User.findById(payment.user_id).select('name'),
        User.findById(payment.ordered_for_user_id).select('name'),
        getCurrency(),
    ]);
    const reference = order.transaction?.reference || order._id.toString();
    const amount = `${currency} ${Number(order.total_price || 0).toFixed(2)}`;

    await Promise.all([
        notifyCustomer(
            payment.ordered_for_user_id,
            'friend_order_created',
            {
                title_en: 'A friend sent you an order',
                title_ar: 'أرسل لك أحد الأصدقاء طلباً',
                message_en: `${payer?.name || 'A friend'} bought parts for you (order #${reference}). You can track the delivery from Orders for me.`,
                message_ar: `قام ${payer?.name || 'أحد الأصدقاء'} بشراء قطع لك (الطلب رقم ${reference}). يمكنك متابعة التوصيل من "طلبات لي".`,
            },
            { link: '/profile?tab=friends', data: { order_id: order._id } }
        ),
        notifyCustomer(
            payment.user_id,
            'friend_order_paid',
            {
                title_en: 'Order placed for your friend',
                title_ar: 'تم تنفيذ الطلب لصديقك',
                message_en: `Order #${reference} (${amount}) for ${recipient?.name || 'your friend'} was paid and placed successfully.`,
                message_ar: `تم دفع وتنفيذ الطلب رقم ${reference} (${amount}) لصالح ${recipient?.name || 'صديقك'} بنجاح.`,
            },
            { link: '/profile?tab=orders', data: { order_id: order._id } }
        ),
    ]);

    await recordAuditLog({
        action: 'friend_payment_converted',
        actor: { role: 'system', label: 'Payment provider' },
        target_type: 'friendship',
        target_id: payment.friendship_id,
        target_snapshot: { order_id: order._id, payment_id: payment._id },
        impact: { total_price: order.total_price },
    });
};

/** Payment failed or was abandoned — no order exists, and none will. */
const onFriendPaymentFailed = async (payment, reason = '') => {
    if (!payment || payment.order_id) return;

    await notifyCustomer(
        payment.user_id,
        'friend_order_payment_failed',
        {
            title_en: 'Payment did not complete',
            title_ar: 'لم تكتمل عملية الدفع',
            message_en: `Your payment for a friend's order was not completed${reason ? `: ${reason}` : ''}. No order was created and nothing was charged — you can try again.`,
            message_ar: `لم تكتمل عملية الدفع الخاصة بطلب صديقك${reason ? `: ${reason}` : ''}. لم يتم إنشاء أي طلب ولم يتم خصم أي مبلغ — يمكنك المحاولة مرة أخرى.`,
        },
        { link: '/checkout', data: { payment_id: payment._id } }
    );
};

/**
 * Orders bought FOR the caller by a friend — read-only.
 *
 * Deliberately narrow: reference, items, delivery summary, status, tracking.
 * No transaction, payment record, provider reference, commission, or refund
 * control. The recipient never gains a financial handle on someone else's
 * money, and never sees the payer's other orders or addresses.
 */
const getOrdersForMe = async (userId) => {
    const { Order } = require('../models/orders');
    const orders = await Order.find({ ordered_for_user_id: userId })
        .sort({ created_at: -1 })
        .limit(50)
        .lean();

    const payerIds = [...new Set(orders.map((order) => String(order.paid_by_user_id || order.user_id)))];
    const payers = await User.find({ _id: { $in: payerIds } }).select('name profile_image');
    const payerMap = new Map(payers.map((user) => [user._id.toString(), user]));

    return {
        orders: orders.map((order) => ({
            _id: order._id,
            reference: order.transaction?.reference || order._id.toString(),
            status: order.status,
            created_at: order.created_at,
            delivered_at: order.delivered_at || null,
            // Enough to recognise the gift, not enough to reveal what was paid
            // or how — the recipient sees a simple "paid online" label only.
            paid_online: true,
            paid_by: publicProfile(payerMap.get(String(order.paid_by_user_id || order.user_id))),
            items: (order.items || []).map((item) => ({
                product_title: item.product_title,
                product_image: item.product_image,
                variant_label: item.variant_label,
                quantity: item.quantity,
            })),
            delivery_summary: {
                recipient_name: order.shipping_address?.recipient_name || '',
                city: order.shipping?.destination?.city || null,
                country: order.shipping?.destination?.country || null,
            },
            shipments: (order.shipments || []).map((shipment) => ({
                provider: shipment.provider || 'bosta',
                tracking_number: shipment.tracking_number || shipment.bosta_tracking_number,
                bosta_tracking_number: shipment.bosta_tracking_number,
                bosta_status: shipment.bosta_status,
                tracking_history: shipment.tracking_history || [],
            })),
        })),
    };
};

module.exports = {
    authorizeAndPrice,
    assertPrepaidPayment,
    previewFriendCheckout,
    createFriendPayment,
    confirmFriendPayment,
    notifyFriendOrderCreated,
    onFriendPaymentFailed,
    getOrdersForMe,
};
