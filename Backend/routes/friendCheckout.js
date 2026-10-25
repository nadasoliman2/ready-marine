/**
 * Friend Checkout Router — buying parts for a friend.
 * Mounted at /api/orders/friend-checkout.
 *
 * There is deliberately NO `place-cod` endpoint here. Orders placed for a
 * friend are online-only, and the service rejects any non-card payment method
 * with `FRIEND_ORDER_ONLINE_ONLY` rather than relying on the UI to hide it.
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { rateLimit } = require('../middleware/rateLimit');
const friendCheckoutService = require('../services/friendCheckoutService');

const fail = (res, error) => res.status(error.status || 400).json({
    code: error.code || 'FRIEND_CHECKOUT_ERROR',
    message: error.message,
});

/**
 * @desc    Server-authoritative price, shipping, and authorization preview.
 *          Returns figures the client may display, never values it may submit
 *          back as authority — payment creation re-derives all of them.
 * @route   POST /api/orders/friend-checkout/preview
 */
router.post('/preview', protect('user'), async (req, res) => {
    try {
        res.json(await friendCheckoutService.previewFriendCheckout(req.user._id, req.body || {}));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Create the hosted online invoice. Creates NO order — the order is
 *          created only once the provider confirms the payment.
 * @route   POST /api/orders/friend-checkout/create-payment
 */
router.post(
    '/create-payment',
    protect('user'),
    rateLimit({ name: 'friend_pay', windowMs: 60 * 1000, max: 10 }),
    async (req, res) => {
        try {
            const result = await friendCheckoutService.createFriendPayment(
                req.user._id,
                req.body || {}
            );

            // Wallet checkout settles inside that call, so the order already
            // exists and there is nothing for the browser to redirect to.
            if (result.mode === 'wallet') {
                return res.status(201).json({
                    success: true,
                    requiresPayment: false,
                    recipient: result.recipient,
                    order: result.order,
                });
            }

            const { payment, recipient } = result;
            res.status(201).json({
                success: true,
                requiresPayment: true,
                paymentUrl: payment.payment_url,
                recipient,
                payment: {
                    id: payment._id,
                    status: payment.status,
                    invoiceId: payment.invoice_id,
                },
            });
        } catch (error) {
            // A shortfall is not an error the customer can only read about —
            // it is an amount they can top up. Pass it through so the friend
            // checkout screen can offer the same one-tap top-up as the main one.
            if (error.code === 'INSUFFICIENT_BALANCE' || error.code === 'WALLET_FROZEN') {
                return res.status(error.code === 'WALLET_FROZEN' ? 423 : 402).json({
                    code: error.code,
                    message: error.message,
                });
            }
            fail(res, error);
        }
    }
);

/**
 * @desc    Confirm after the provider redirect. Idempotent — a refresh, a
 *          double click, or a redirect racing its own webhook all resolve to
 *          the same single order.
 * @route   POST /api/orders/friend-checkout/confirm-payment
 */
router.post('/confirm-payment', protect('user'), async (req, res) => {
    try {
        const result = await friendCheckoutService.confirmFriendPayment(req.user._id, {
            paymentId: req.body?.paymentId,
            invoiceId: req.body?.invoice_id,
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
            order_id: result.order_id,
            message: result.alreadyPaid ? 'Payment was already confirmed' : 'Payment confirmed and order created',
        });
    } catch (error) {
        fail(res, error);
    }
});

module.exports = router;
