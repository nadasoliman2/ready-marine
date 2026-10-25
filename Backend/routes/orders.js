const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { placeOrder, getPricedOrderPreview } = require('../services/orderService');
const { toPublicPreview } = require('../services/loyaltyService');
const {
    createOrderPayment,
    findPaymentFromWebhook,
    activatePaidOrderPayment,
    confirmOrderPayment,
} = require('../services/orderPaymentService');
const { verifyPaidWebhookHash } = require('../services/fawaterakService');
const walletService = require('../services/walletService');

/**
 * Provenance fields are set by internal services only (family conversion,
 * friend checkout). Accepting them from a browser would let a customer forge an
 * order "for" another account — which would then surface in that account's
 * read-only list — or route a friend order through cash on delivery. Strip them
 * unconditionally: this route only ever places an order for the caller.
 */
const stripProvenanceFields = (body = {}) => {
    const {
        family_id, family_order_request_id, requested_by_user_id,
        friendship_id, paid_by_user_id, ordered_for_user_id,
        ...safe
    } = body;
    return safe;
};

/**
 * @desc    Place a new order
 * @route   POST /api/orders
 */
router.post('/', protect('user'), async (req, res) => {
    try {
        const orderData = stripProvenanceFields(req.body);
        const walletEnabled = await walletService.isWalletEnabled();

        // An unconfirmed guest may place an order — that is the whole point —
        // but only with money that arrives with the order. Account balances and
        // point balances are things the session has not earned the right to
        // spend, and the screen never offers them; this is the server saying so
        // independently rather than trusting that it didn't.
        if (req.isUnclaimedGuest) {
            if (orderData.payment_method === 'wallet') {
                return res.status(403).json({
                    success: false,
                    code: 'GUEST_NOT_CONFIRMED',
                    message: 'Confirm your number to pay from your wallet balance.',
                });
            }
            orderData.redeem_points = 0;
        }

        // The wallet and the gateway now stand side by side, so a request for
        // one is never quietly turned into the other: a customer who chose to
        // pay by card must not find their wallet emptied instead. When the
        // store has switched the gateway off, the request is refused with a
        // reason the screen can act on, and the basket survives.
        // On the company account: companyOrderService prices it, checks the limit and
        // the cap, and places it wholly on the company — an order above what is left
        // is refused, and the person places it from their own account instead.
        if (orderData.payment_method === 'company_account') {
            if (req.isUnclaimedGuest) {
                return res.status(403).json({
                    success: false,
                    code: 'GUEST_NOT_CONFIRMED',
                    message: 'Confirm your number to order on the company account.',
                });
            }
            const result = await require('../services/companyOrderService').placeCompanyOrder(req.user._id, orderData);
            if (result.requiresPayment) {
                return res.status(201).json({
                    success: true,
                    requiresPayment: true,
                    message: 'Payment invoice created for the part above your limit',
                    paymentUrl: result.payment.payment_url,
                    payment: {
                        id: result.payment._id,
                        status: result.payment.status,
                        invoiceId: result.payment.invoice_id,
                        invoiceKey: result.payment.invoice_key,
                    },
                });
            }
            return res.status(201).json({ success: true, message: 'Order placed successfully', order: result.order });
        }

        if (orderData.payment_method === 'credit_card' && !(await walletService.isOnlinePaymentAllowed())) {
            return res.status(409).json({
                success: false,
                code: 'ONLINE_PAYMENT_DISABLED',
                message: 'Online payment is unavailable right now. Please choose another payment method.',
            });
        }

        if (orderData.payment_method === 'wallet') {
            if (!walletEnabled) {
                return res.status(409).json({
                    success: false,
                    code: 'WALLET_DISABLED',
                    message: 'Wallet checkout is currently unavailable',
                });
            }

            // Priced server-side, then compared against the balance in integer
            // piastres. The client is never trusted for either number — it only
            // gets told the shortfall so it can offer to top up exactly that.
            const preview = await getPricedOrderPreview({
                userId: req.user._id,
                items: orderData.items,
                couponCode: orderData.coupon_code || '',
                shippingDestination: orderData.shipping_destination || null,
                shippingMethodId: orderData.shipping_method_id || null,
                redeemPoints: orderData.redeem_points || 0,
            });

            const check = await walletService.evaluateOrderPayment({
                userId: req.user._id,
                total: preview.total,
            });

            if (check.status === 'frozen') {
                return res.status(423).json({
                    success: false,
                    code: 'WALLET_FROZEN',
                    message: 'This wallet is temporarily on hold. Please contact support.',
                });
            }

            if (!check.sufficient) {
                return res.status(402).json({
                    success: false,
                    code: 'INSUFFICIENT_BALANCE',
                    message: 'Your wallet balance is not enough for this order',
                    wallet: {
                        required: check.required,
                        available: check.available,
                        shortfall: check.shortfall,
                        currency: check.currency,
                    },
                });
            }
        }

        if (orderData.payment_method === 'credit_card') {
            const result = await createOrderPayment({
                userId: req.user._id,
                orderData,
            });
            return res.status(201).json({
                success: true,
                requiresPayment: true,
                message: 'Payment invoice created successfully',
                paymentUrl: result.payment.payment_url,
                payment: {
                    id: result.payment._id,
                    status: result.payment.status,
                    invoiceId: result.payment.invoice_id,
                    invoiceKey: result.payment.invoice_key,
                },
            });
        }

        const order = await placeOrder(req.user._id, orderData);
        res.status(201).json({ success: true, message: 'Order placed successfully', order });
    } catch (error) {
        // The check above is advisory — the authoritative guard is the atomic
        // debit inside `placeOrder`, which is what a second tab spending the
        // same credit will lose against. Surface that as a shortfall too, so
        // the customer gets the same top-up offer either way.
        if (error.code === 'INSUFFICIENT_BALANCE') {
            const balances = await walletService.getBalances(req.user._id).catch(() => null);
            return res.status(402).json({
                success: false,
                code: 'INSUFFICIENT_BALANCE',
                message: error.message,
                wallet: balances ? { available: balances.available, currency: balances.currency } : undefined,
            });
        }
        if (error.code === 'WALLET_FROZEN') {
            return res.status(423).json({ success: false, code: error.code, message: error.message });
        }
        // Company checkout refusals carry a code the screen turns into a sentence
        // (limit used up, cap reached, paused, choose how to pay the rest...).
        if (error.code && error.status) {
            return res.status(error.status).json({
                success: false,
                code: error.code,
                message: error.message,
                ...(error.details ? { details: error.details } : {}),
            });
        }
        if (error.code === 'PRICE_CHANGED') {
            return res.status(409).json({ success: false, code: error.code, message: error.message });
        }
        res.status(400).json({ message: error.message });
    }
});

/**
 * @desc    Authoritative price preview for the checkout screen
 * @route   POST /api/orders/preview
 *
 * The client shows what this returns and submits nothing back as authority —
 * placement re-runs the identical pricing, so a tampered preview changes
 * nothing except what the customer briefly saw.
 */
router.post('/preview', protect('user'), async (req, res) => {
    try {
        const body = stripProvenanceFields(req.body);
        const preview = await getPricedOrderPreview({
            userId: req.user._id,
            items: body.items,
            couponCode: body.coupon_code || '',
            shippingDestination: body.shipping_destination || null,
            shippingMethodId: body.shipping_method_id || null,
            redeemPoints: body.redeem_points || 0,
        });

        res.json({
            success: true,
            totals: {
                subtotal: Number(preview.subtotal.toFixed(2)),
                coupon_discount: Number(preview.discountAmount.toFixed(2)),
                loyalty_discount: Number(Number(preview.loyalty?.discount || 0).toFixed(2)),
                items_total: Number(preview.itemsTotal.toFixed(2)),
                shipping: Number(Number(preview.shippingTotal || 0).toFixed(2)),
                total: Number(preview.total.toFixed(2)),
            },
            coupon: preview.couponResult?.coupon ? { code: preview.couponResult.coupon.code } : null,
            loyalty: toPublicPreview(preview.loyalty),
            // How this basket will physically arrive, and what each courier will collect.
            // Sent BEFORE payment on purpose: splitting an order is only disruptive when it
            // is a surprise. Once the customer has read "3 parcels, these amounts" they have
            // agreed to it — and "why is the courier asking me for a different number?"
            // stops being a support call. These are the same figures that are frozen at
            // dispatch and sent to Bosta as each parcel's COD; there is no second
            // calculation behind the scenes.
            delivery: {
                parcel_count: preview.parcelCount,
                // Below two parcels there is nothing to explain, so the screen shows nothing.
                is_split: preview.parcelCount > 1,
                parcels: (preview.parcels || []).map((p) => ({
                    vendor_name: p.vendor_name,
                    fulfillment_location: p.fulfillment_location,
                    item_count: p.item_count,
                    merchandise_total: Number(p.merchandise_total.toFixed(2)),
                    shipping: Number(p.shipping_share.toFixed(2)),
                    coupon_share: Number(p.coupon_share.toFixed(2)),
                    loyalty_share: Number(p.loyalty_share.toFixed(2)),
                    // What this parcel's courier asks for on a cash order.
                    amount_due_on_delivery: Number(p.cod_amount.toFixed(2)),
                })),
                // The parts add up to the order total in front of the customer.
                cod_total: Number(
                    (preview.parcels || []).reduce((sum, p) => sum + p.cod_amount, 0).toFixed(2)
                ),
            },
            // The wallet position for THIS total, so checkout can show the
            // balance, the shortfall, and a one-tap top-up without a second
            // round trip and without doing money arithmetic in the browser.
            wallet: await (async () => {
                // Store credit is account money. An unconfirmed guest has proved
                // nothing, so it is neither offered as a payment method nor
                // reported as a balance — the amount alone would say something
                // about whoever really owns this number.
                if (req.isUnclaimedGuest) return { enabled: false };
                if (!(await walletService.isWalletEnabled())) return { enabled: false };
                const check = await walletService.evaluateOrderPayment({
                    userId: req.user._id,
                    total: preview.total,
                });
                return {
                    enabled: true,
                    available: check.available,
                    shortfall: check.shortfall,
                    sufficient: check.sufficient,
                    status: check.status,
                    currency: check.currency,
                };
            })(),
            // Which prepaid methods checkout may offer right now. Decided
            // server-side so the screen never has to infer the rule, and so a
            // store that has stepped back to wallet-only stops offering the
            // gateway the moment the setting changes.
            payment_methods: await walletService.getAvailablePaymentMethods(),
            // The company-account option for THIS basket: which company (for someone in
            // several), whether it can be used, and why not.
            // Absent for anyone who is not in a company.
            company: req.isUnclaimedGuest
                ? { eligible: false }
                : await require('../services/companyOrderService')
                    .previewForCheckout(req.user._id, body.company || {}, preview.total, preview.parcels || [])
                    .catch((err) => {
                        console.error('[Company] checkout preview failed:', err.message);
                        return { eligible: false };
                    }),
            // Whether cash at the door is on offer for THIS customer. A bare boolean: the
            // storefront hides the option when it is false, and the customer is never told
            // they were scored — that conversation belongs to support, not to a checkout
            // screen. The real enforcement is in `placeOrder`, which re-runs the same rule.
            cod: {
                allowed: await require('../services/codEligibilityService').isAllowed({
                    userId: req.user._id,
                    phone: body.shipping_destination?.phone
                        || body.shipping_address?.phone
                        || req.user.phone
                        || '',
                }),
            },
        });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Confirm order payment after Fawaterak redirect
 * @route   POST /api/orders/confirm-payment
 */
router.post('/confirm-payment', protect('user'), async (req, res) => {
    try {
        const { paymentId, invoice_id } = req.body;
        const result = await confirmOrderPayment({
            userId: req.user._id,
            paymentId,
            invoiceId: invoice_id,
        });

        if (result.status !== 'paid') {
            return res.json({
                success: true,
                status: result.status,
                message: 'Payment is not confirmed yet',
            });
        }

        res.json({
            success: true,
            status: 'paid',
            message: result.alreadyPaid ? 'Payment was already confirmed' : 'Payment confirmed and order created',
            order: result.order,
        });
    } catch (err) {
        const statusCode = err.code === 'PAYMENT_NOT_FOUND' ? 404
            : err.code === 'PAYMENT_REFERENCE_REQUIRED' ? 400
            : err.code === 'INVOICE_MISMATCH' ? 400
            : err.code === 'AMOUNT_MISMATCH' ? 409
            : 400;
        res.status(statusCode).json({ success: false, code: err.code, message: err.message });
    }
});

/**
 * @desc    Fawaterak paid webhook for online order payments
 * @route   POST /api/orders/fawaterak/webhook_json
 */
router.post('/fawaterak/webhook_json', async (req, res) => {
    try {
        if (!verifyPaidWebhookHash(req.body)) {
            return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
        }

        if (String(req.body.invoice_status || '').toLowerCase() !== 'paid') {
            return res.json({ success: true, ignored: true });
        }

        const payment = await findPaymentFromWebhook(req.body);
        if (!payment) {
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }

        // A record opened on Paymob can never be settled by a Fawaterak
        // callback. Both providers hand us numeric ids, so a collision between
        // a Fawaterak invoice id and a Paymob order id is unlikely but not
        // impossible — and settling the wrong payment is not a mistake that can
        // be walked back.
        if (payment.provider !== 'fawaterak') {
            return res.json({ success: true, ignored: true, reason: 'record belongs to another provider' });
        }

        await activatePaidOrderPayment(payment, req.body);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
