const { OrderPayment } = require('../models/orderPayments');
const { User } = require('../models/users');
const gateway = require('./paymentGateway');
const loyaltyService = require('./loyaltyService');
const { getPricedOrderPreview, placeOrder } = require('./orderService');

const getFrontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
const getBackendUrl = () => (
    process.env.BACKEND_PUBLIC_URL ||
    process.env.BACKEND_URL ||
    process.env.API_PUBLIC_URL ||
    `http://localhost:${process.env.PORT || 4000}`
).replace(/\/api\/?$/, '').replace(/\/$/, '');

const splitName = (name = '') => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return {
        first_name: parts[0] || 'ReadyCar',
        last_name: parts.slice(1).join(' ') || 'Customer',
    };
};

const normalizeCheckoutPayload = (orderData = {}) => ({
    shipping_address: orderData.shipping_address,
    items: orderData.items || [],
    checkout_source: orderData.checkout_source || 'cart',
    coupon_code: orderData.coupon_code || undefined,
    shipping_destination: orderData.shipping_destination || null,
    shipping_method_id: orderData.shipping_method_id || null,
    payment_method: 'credit_card',
    // Family provenance, carried through the hosted-payment round trip so the
    // resulting order still points back at the request that created it.
    family_id: orderData.family_id || null,
    family_order_request_id: orderData.family_order_request_id || null,
    requested_by_user_id: orderData.requested_by_user_id || null,
    // Friend provenance. Frozen here on purpose: once the provider captures
    // funds, this snapshot completes the order even if the friendship or the
    // address share is revoked during the external round trip.
    friendship_id: orderData.friendship_id || null,
    paid_by_user_id: orderData.paid_by_user_id || null,
    ordered_for_user_id: orderData.ordered_for_user_id || null,
    // The customer's REQUESTED points. Never authoritative — it is re-clamped
    // against the live balance and the configured cap on every pricing pass.
    redeem_points: Math.max(0, Math.floor(Number(orderData.redeem_points) || 0)),
});

/**
 * Where the customer lands after paying.
 *
 * A family payment returns to the request it settles; a friend payment returns
 * to checkout flagged as friend context so the page confirms it through the
 * friend-checkout endpoint. Exported because the shared Paymob return route has
 * to rebuild exactly these URLs — Paymob redirects everything to one endpoint,
 * and that endpoint is what sends the customer to the page they expect.
 */
const buildReturnUrl = (payment, status) => {
    const paymentId = payment._id.toString();
    const returnPath = payment.family_order_request_id
        ? `/family/requests/${payment.family_order_request_id}`
        : '/checkout';
    const contextQuery = payment.checkout_context === 'friend' ? '&context=friend' : '';
    return `${getFrontendUrl()}${returnPath}?payment=${status}&paymentId=${paymentId}${contextQuery}`;
};

const buildPaymentRequest = ({ payment, user }) => {
    const shippingAddress = payment.checkout_payload?.shipping_address || {};
    const { first_name, last_name } = splitName(user.name || shippingAddress.recipient_name);

    return {
        flow: 'order',
        recordId: payment._id,
        userId: user._id,
        amount: Number(payment.amount),
        currency: payment.currency,
        customer: {
            first_name,
            last_name,
            email: user.email,
            phone: shippingAddress.phone || user.phone,
            address: shippingAddress.full_address || '',
            city: shippingAddress.city || '',
            unique_id: user._id.toString(),
        },
        items: [{ name: 'ReadyCar order', price: Number(payment.amount), quantity: 1 }],
        returnUrls: {
            success: buildReturnUrl(payment, 'success'),
            fail: buildReturnUrl(payment, 'failed'),
            pending: buildReturnUrl(payment, 'pending'),
        },
        webhookUrl: `${getBackendUrl()}/api/orders/fawaterak/webhook_json`,
        extras: { orderPaymentId: payment._id.toString(), userId: user._id.toString() },
    };
};

/**
 * Return a payment's held points to the customer's available balance.
 *
 * Called on every path where the hosted invoice can no longer become an order:
 * a failed invoice creation, a rejected amount, a provider failure. Safe to
 * call more than once, and a no-op once the reservation has been consumed —
 * releasing spent points would mint them.
 */
const releaseLoyaltyHold = async (payment, reason) => {
    try {
        const points = Number(payment?.redeemed_points || 0);
        if (!payment || points <= 0) return;
        await loyaltyService.releaseReservation({
            userId: payment.user_id,
            points,
            paymentId: payment._id,
            reason,
        });
    } catch (err) {
        console.error(`[Loyalty] Failed to release hold for payment ${payment?._id}: ${err.message}`);
    }
};

/**
 * Give back the company limit a card checkout was holding (feature 14). Safe to
 * call more than once: the hold is marked spent on the row the first time.
 */
const releaseCompanyHold = async (payment, reason) => {
    try {
        if (!payment?.company_checkout?.reserved) return;
        await require('./companyOrderService').releaseCheckoutHold(payment.company_checkout);
        payment.company_checkout = { ...payment.company_checkout, reserved: false, released_reason: reason };
        payment.markModified('company_checkout');
        await payment.save();
    } catch (err) {
        console.error(`[Company] Failed to release the limit held by payment ${payment?._id}: ${err.message}`);
    }
};

/**
 * What the customer pays on the provider's page. On a company order that is
 * only their own part — the company's share goes on its monthly invoice.
 */
const payableAmount = (total, companyCheckout) =>
    Number((Number(total) - Number(companyCheckout?.company_amount || 0)).toFixed(2));

const createOrderPayment = async ({ userId, orderData, familyOrderRequestId = null, friendContext = null, companyCheckout = null }) => {
    const user = await User.findById(userId).lean();
    if (!user) throw new Error('User not found');

    const checkoutPayload = normalizeCheckoutPayload(orderData);
    if (!checkoutPayload.shipping_address) throw new Error('Shipping address is required');

    const preview = await getPricedOrderPreview({
        userId,
        items: checkoutPayload.items,
        couponCode: checkoutPayload.coupon_code,
        shippingDestination: checkoutPayload.shipping_destination,
        shippingMethodId: checkoutPayload.shipping_method_id,
        redeemPoints: checkoutPayload.redeem_points,
    });

    const redeemedPoints = Number(preview.loyalty?.redeemed_points || 0);
    const loyaltyDiscount = Number(preview.loyalty?.discount || 0);
    // Freeze the CLAMPED result onto the payload. Everything downstream — the
    // amount-match check, the order, the consume — reads this, so the customer
    // is charged and credited against one number, not three re-derivations.
    checkoutPayload.redeem_points = redeemedPoints;

    // A company checkout agreed a split a moment ago; if the price moved since, the
    // employee would be charged for a different part than they were shown.
    const amountToPay = payableAmount(preview.total, companyCheckout);
    if (companyCheckout && Math.abs(amountToPay - Number(companyCheckout.personal_amount || 0)) > 0.01) {
        const err = new Error('The order total changed while you were checking out. Please review it again.');
        err.code = 'PRICE_CHANGED';
        throw err;
    }

    // Decided once, here, and then frozen onto the record. Everything after
    // this point — the redirect confirmation, the webhook, the sweep — reads it
    // back off the row, so an admin flipping the switch cannot strand a
    // customer who is already sitting on the other provider's page.
    const provider = await gateway.resolveProvider({ userId });

    const payment = await OrderPayment.create({
        user_id: userId,
        family_order_request_id: familyOrderRequestId || checkoutPayload.family_order_request_id || null,
        checkout_context: companyCheckout ? 'company' : (friendContext?.checkout_context || 'self'),
        company_checkout: companyCheckout || null,
        friendship_id: friendContext?.friendship_id || null,
        ordered_for_user_id: friendContext?.ordered_for_user_id || null,
        recipient_address_id: friendContext?.recipient_address_id || null,
        checkout_payload: checkoutPayload,
        redeemed_points: redeemedPoints,
        loyalty_discount: loyaltyDiscount,
        amount: amountToPay,
        currency: gateway.getCurrencyFor(provider),
        provider,
        provider_mode: gateway.getModeFor(provider),
    });

    // Hold the points BEFORE handing the customer to the provider. While the
    // hosted invoice is open the balance is out of reach of a second tab, and
    // the invoice below is priced against points that are provably theirs.
    if (redeemedPoints > 0) {
        try {
            const reservation = await loyaltyService.reservePoints({
                userId,
                points: redeemedPoints,
                paymentId: payment._id,
                settings: preview.loyalty.settings,
            });
            payment.loyalty_reservation_id = reservation?._id || null;
            await payment.save();
        } catch (err) {
            payment.status = 'failed';
            payment.activation_error = `Loyalty reservation failed: ${err.message}`;
            await payment.save();
            throw err;
        }
    }

    let hosted;
    try {
        hosted = await gateway.createHostedPayment({ ...buildPaymentRequest({ payment, user }), provider });
    } catch (err) {
        payment.status = 'failed';
        payment.activation_error = err.message;
        await payment.save();
        // No payment page was ever opened, so nothing can complete this payment.
        // Hand the points straight back rather than stranding them.
        await releaseLoyaltyHold(payment, 'Payment invoice could not be created');
        throw err;
    }

    payment.invoice_id = hosted.invoice_id;
    payment.invoice_key = hosted.invoice_key;
    payment.payment_url = hosted.payment_url;
    payment.provider_reference = hosted.provider_reference;
    payment.raw_response = hosted.raw_response;
    await payment.save();

    if (!payment.payment_url) {
        // Nothing can be paid without a page, so this payment is over: mark it so,
        // and give the points back now rather than after the stale sweep. The
        // company hold is released by the caller (companyOrderService), which is
        // why the row must stop looking pending — the sweep would release it twice.
        payment.status = 'failed';
        payment.activation_error = `${provider} did not return a payment URL`;
        await payment.save();
        await releaseLoyaltyHold(payment, 'Payment page could not be opened');
        const err = new Error(`${provider} did not return a payment URL`);
        err.code = 'PAYMENT_URL_MISSING';
        throw err;
    }

    return { payment };
};

const parsePayload = (payload = {}) => {
    if (payload.pay_load && typeof payload.pay_load === 'object') return payload.pay_load;
    if (typeof payload.pay_load === 'string') {
        try {
            return JSON.parse(payload.pay_load);
        } catch (error) {
            return {};
        }
    }
    return {};
};

const findPaymentFromWebhook = async (payload = {}) => {
    const payLoad = parsePayload(payload);
    if (payLoad.orderPaymentId) {
        const byPayload = await OrderPayment.findById(payLoad.orderPaymentId);
        if (byPayload) return byPayload;
    }

    const or = [];
    if (payload.invoice_id) or.push({ invoice_id: String(payload.invoice_id) });
    if (payload.invoice_key) or.push({ invoice_key: payload.invoice_key });
    if (!or.length) return null;
    return OrderPayment.findOne({ $or: or });
};

const assertAmountMatches = async (payment) => {
    const checkoutPayload = payment.checkout_payload || {};
    const preview = await getPricedOrderPreview({
        userId: payment.user_id,
        items: checkoutPayload.items,
        couponCode: checkoutPayload.coupon_code,
        shippingDestination: checkoutPayload.shipping_destination,
        shippingMethodId: checkoutPayload.shipping_method_id,
        redeemPoints: Number(payment.redeemed_points || 0),
        // The held points are the ones this invoice was priced with. Counting
        // them back keeps the re-price identical to the original, instead of
        // failing every points checkout for a mismatch we created ourselves.
        reservedPoints: Number(payment.redeemed_points || 0),
    });
    const expected = payableAmount(preview.total, payment.company_checkout);
    const paid = Number(Number(payment.amount || 0).toFixed(2));
    if (Math.abs(expected - paid) > 0.01) {
        payment.status = 'amount_mismatch';
        payment.activation_error = `Paid amount ${paid} does not match current order total ${expected}`;
        await payment.save();
        // This payment can never become an order — do not sit on the points, or on
        // the company limit it was holding.
        await releaseLoyaltyHold(payment, 'Order total changed before the payment was confirmed');
        await releaseCompanyHold(payment, 'Order total changed before the payment was confirmed');
        const err = new Error(payment.activation_error);
        err.code = 'AMOUNT_MISMATCH';
        throw err;
    }
};

const activatePaidOrderPayment = async (payment, providerPayload = null) => {
    if (!payment) throw new Error('Payment not found');
    if (payment.status === 'paid' && payment.order_id) {
        return { status: 'paid', alreadyPaid: true, payment, order: payment.order_id };
    }

    if (providerPayload) payment.webhook_payloads.push(providerPayload);
    if (providerPayload?.payment_method) payment.payment_method = providerPayload.payment_method;
    if (providerPayload?.invoice_id) payment.invoice_id = String(providerPayload.invoice_id);
    if (providerPayload?.invoice_key) payment.invoice_key = providerPayload.invoice_key;
    payment.provider_reference = payment.invoice_id || payment.invoice_key || payment.provider_reference;

    await assertAmountMatches(payment);

    try {
        const paidAt = providerPayload?.paid_at ? new Date(providerPayload.paid_at) : new Date();
        // A company checkout becomes a company-account order: the card paid only the
        // employee's part, and the company's share was held on its limit already.
        const companyCheckout = payment.company_checkout || null;
        const methodForOrder = companyCheckout ? 'company_account' : 'credit_card';
        const order = await placeOrder(payment.user_id, {
            ...(payment.checkout_payload || {}),
            payment_method: methodForOrder,
        }, {
            company: companyCheckout,
            // The points were held when the invoice was created; placing the
            // order turns that hold into a spend rather than charging again.
            loyaltyReservation: Number(payment.redeemed_points || 0) > 0
                ? { points: Number(payment.redeemed_points), paymentId: payment._id }
                : null,
            transaction: {
                payment_method: methodForOrder,
                status: 'paid',
                reference: payment.provider_reference || payment._id.toString(),
                provider: payment.provider,
                provider_mode: payment.provider_mode,
                payment_id: payment._id,
                invoice_id: payment.invoice_id,
                invoice_key: payment.invoice_key,
                payment_url: payment.payment_url,
                paid_at: paidAt,
                provider_payload: providerPayload ? {
                    invoice_id: providerPayload.invoice_id,
                    invoice_key: providerPayload.invoice_key,
                    payment_method: providerPayload.payment_method,
                    paid_at: providerPayload.paid_at,
                    source: providerPayload.source,
                } : null,
            },
        });

        // Family requests convert exactly once. If another caller (redirect
        // confirmation vs webhook) already converted this request, drop the
        // order we just built rather than leaving a duplicate behind.
        if (payment.family_order_request_id) {
            const { onFamilyPaymentConverted } = require('./familyOrderRequestService');
            const { converted } = await onFamilyPaymentConverted(payment.family_order_request_id, order);
            if (!converted) {
                const { FamilyOrderRequest } = require('../models/familyOrderRequests');
                const { Order } = require('../models/orders');
                await Order.deleteOne({ _id: order._id });
                // The order we just built is gone, so the points it spent have
                // nothing left to fund. Give them straight back rather than
                // letting a discarded duplicate quietly eat a balance.
                if (Number(payment.redeemed_points || 0) > 0) {
                    await loyaltyService.restorePoints({
                        userId: payment.user_id,
                        points: Number(payment.redeemed_points),
                        orderId: order._id,
                        reason: 'Duplicate family conversion discarded',
                        idempotencyKey: `payment:${payment._id}:redeem-restore-duplicate`,
                    }).catch((err) => console.error(`[Loyalty] Duplicate restore failed: ${err.message}`));
                }
                const request = await FamilyOrderRequest.findById(payment.family_order_request_id).select('converted_order_id');
                payment.status = 'paid';
                payment.order_id = request?.converted_order_id || null;
                payment.paid_at = paidAt;
                payment.activation_error = null;
                await payment.save();
                return { status: 'paid', alreadyPaid: true, payment, order: payment.order_id };
            }
        }

        payment.status = 'paid';
        payment.order_id = order._id;
        payment.paid_at = paidAt;
        payment.activation_error = null;
        if (companyCheckout?.reserved) {
            // The hold became the order's charge; nothing is held any more.
            payment.company_checkout = { ...companyCheckout, reserved: false, converted: true };
            payment.markModified('company_checkout');
        }
        await payment.save();

        // Tell both sides only after the order genuinely exists — the webhook
        // and the redirect both land here, and `order_id` above makes the
        // second arrival return early instead of notifying twice.
        if (payment.checkout_context === 'friend') {
            const { notifyFriendOrderCreated } = require('./friendCheckoutService');
            await notifyFriendOrderCreated(payment, order).catch((notifyErr) =>
                console.error('[FriendCheckout] notification failed:', notifyErr.message));
        }

        return { status: 'paid', payment, order };
    } catch (err) {
        payment.status = 'paid_order_failed';
        payment.activation_error = err.message;
        await payment.save();
        // The money was captured but no order exists. Support will resolve the
        // payment by hand; the points and the company limit must not stay locked
        // while that happens.
        await releaseLoyaltyHold(payment, 'Order creation failed after payment');
        await releaseCompanyHold(payment, 'Order creation failed after payment');
        throw err;
    }
};

/**
 * Confirm a payment after the browser comes back from the provider.
 *
 * Scoped to the authenticated user, and the payment is always re-read from the
 * provider rather than trusted from the query string — `?payment=success` is
 * fully under the customer's control and proves nothing on its own.
 */
const confirmOrderPayment = async ({ userId, paymentId, invoiceId }) => {
    if (!paymentId && !invoiceId) {
        const err = new Error('paymentId or invoice_id is required');
        err.code = 'PAYMENT_REFERENCE_REQUIRED';
        throw err;
    }

    const filter = { user_id: userId };
    const or = [];
    if (paymentId) or.push({ _id: paymentId });
    if (invoiceId) or.push({ invoice_id: String(invoiceId) });
    filter.$or = or;

    const payment = await OrderPayment.findOne(filter);
    if (!payment) {
        const err = new Error('Payment not found');
        err.code = 'PAYMENT_NOT_FOUND';
        throw err;
    }

    if (payment.status === 'paid' && payment.order_id) {
        await payment.populate('order_id');
        return { status: 'paid', alreadyPaid: true, payment, order: payment.order_id };
    }

    if (invoiceId && payment.invoice_id && String(payment.invoice_id) !== String(invoiceId)) {
        const err = new Error('Invoice does not match this payment');
        err.code = 'INVOICE_MISMATCH';
        throw err;
    }

    const result = await gateway.readPayment({
        provider: payment.provider,
        invoice_id: payment.invoice_id || invoiceId,
        invoice_key: payment.invoice_key,
        provider_reference: payment.provider_reference,
    });

    payment.raw_response = {
        ...(payment.raw_response || {}),
        confirmation: result.envelope,
    };

    if (!result.paid) {
        await payment.save();
        return { status: 'pending', payment, invoice: result.raw };
    }

    return activatePaidOrderPayment(payment, gateway.buildConfirmationPayload(result, {
        source: 'redirect_confirmation',
    }));
};

// How long a hosted invoice may sit unpaid before we treat it as abandoned and
// hand its held points back. Generous on purpose — a customer who genuinely
// pays two hours later still gets their order; they just re-spend the points,
// and the amount check catches any drift.
const PAYMENT_HOLD_TTL_HOURS = 6;

/**
 * Return points held by hosted invoices nobody ever paid.
 *
 * Without this, closing the payment tab would strand a balance indefinitely —
 * the customer sees points they cannot spend and no event ever frees them.
 * Runs from the daily cron; releasing is idempotent and skips anything that
 * was in fact consumed.
 */
const releaseStalePaymentHolds = async () => {
    const cutoff = new Date(Date.now() - PAYMENT_HOLD_TTL_HOURS * 60 * 60 * 1000);
    const stale = await OrderPayment.find({
        status: 'pending',
        createdAt: { $lte: cutoff },
        $or: [
            { redeemed_points: { $gt: 0 } },
            // A company checkout holds part of the employee's limit (feature 14).
            { 'company_checkout.reserved': true },
        ],
    });

    let released = 0;
    for (const payment of stale) {
        await releaseLoyaltyHold(payment, 'Payment was never completed');
        await releaseCompanyHold(payment, 'Payment was never completed');
        payment.status = 'expired';
        payment.activation_error = payment.activation_error || 'Payment expired before completion';
        await payment.save().catch((err) =>
            console.error(`[Loyalty] Failed to expire payment ${payment._id}: ${err.message}`));
        released += 1;
    }

    if (released > 0) console.log(`[Loyalty] Released holds on ${released} abandoned payment(s).`);
    return { released };
};

module.exports = {
    createOrderPayment,
    findPaymentFromWebhook,
    activatePaidOrderPayment,
    confirmOrderPayment,
    buildReturnUrl,
    releaseStalePaymentHolds,
};
