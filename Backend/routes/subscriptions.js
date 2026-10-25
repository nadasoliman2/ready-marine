/**
 * Vendor Subscription Router
 * Handles subscription purchase, renew, and status for vendors.
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
    getVendorSubscriptionStatus,
    hasUsedFreeTrial,
} = require('../services/vendorSubscriptionService');
const { getActivePackages } = require('../services/subscriptionService');
const {
    createSubscriptionPayment,
    findPaymentFromWebhook,
    activatePaidPayment,
    confirmSubscriptionPayment,
} = require('../services/subscriptionPaymentService');
const { verifyPaidWebhookHash } = require('../services/fawaterakService');

/**
 * Get vendor's subscription status + product counts
 * @route   GET /api/vendors/subscription/status
 * @access  Private (Vendor)
 */
router.get('/status', protect('vendor'), async (req, res) => {
    try {
        const status = await getVendorSubscriptionStatus(req.user._id);
        res.json({ success: true, ...status });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Get available subscription packages for purchase
 * @route   GET /api/vendors/subscription/packages
 * @access  Private (Vendor)
 */
router.get('/packages', protect('vendor'), async (req, res) => {
    try {
        const packages = await getActivePackages();
        res.json({ success: true, packages });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Check if vendor has used free trial
 * @route   GET /api/vendors/subscription/free-trial
 * @access  Private (Vendor)
 */
router.get('/free-trial', protect('vendor'), async (req, res) => {
    try {
        const used = await hasUsedFreeTrial(req.user._id);
        res.json({ success: true, usedFreeTrial: used });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Purchase a new subscription
 * @route   POST /api/vendors/subscription/purchase
 * @access  Private (Vendor)
 */
router.post('/purchase', protect('vendor'), async (req, res) => {
    try {
        const { packageId, billing_period } = req.body;

        if (!packageId) {
            return res.status(400).json({ success: false, message: 'packageId is required' });
        }

        const result = await createSubscriptionPayment({
            vendorId: req.user._id,
            packageId,
            action: 'purchase',
            billingPeriod: billing_period || 'monthly',
        });

        if (result.activated) {
            return res.status(201).json({
                success: true,
                message: 'Subscription activated successfully',
                subscription: result.subscription,
            });
        }

        res.status(201).json({
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
    } catch (err) {
        const statusCode = err.code === 'ALREADY_SUBSCRIBED' ? 409
            : err.code === 'PACKAGE_NOT_FOUND' ? 404
            : err.code === 'PACKAGE_INACTIVE' ? 400
            : err.code === 'PRODUCT_LIMIT_EXCEEDED' ? 400
            : err.code === 'FREE_TRIAL_ALREADY_USED' ? 409
            : 400;

        res.status(statusCode).json({
            success: false,
            code: err.code,
            message: err.message,
            maxProducts: err.maxProducts,
            currentCount: err.currentCount,
        });
    }
});

/**
 * Renew an existing subscription
 * @route   POST /api/vendors/subscription/renew
 * @access  Private (Vendor)
 */
router.post('/renew', protect('vendor'), async (req, res) => {
    try {
        const { billing_period } = req.body;

        const result = await createSubscriptionPayment({
            vendorId: req.user._id,
            action: 'renew',
            billingPeriod: billing_period || 'monthly',
        });

        res.json({
            success: true,
            requiresPayment: true,
            message: 'Renewal payment invoice created successfully',
            paymentUrl: result.payment.payment_url,
            payment: {
                id: result.payment._id,
                status: result.payment.status,
                invoiceId: result.payment.invoice_id,
                invoiceKey: result.payment.invoice_key,
            },
        });
    } catch (err) {
        const statusCode = err.code === 'NO_SUBSCRIPTION' ? 404 : 400;
        res.status(statusCode).json({ success: false, code: err.code, message: err.message });
    }
});

/**
 * Resubscribe after subscription ended/cancelled (with product selection if over limit)
 * @route   POST /api/vendors/subscription/resubscribe
 * @access  Private (Vendor)
 */
router.post('/resubscribe', protect('vendor'), async (req, res) => {
    try {
        const { packageId, billing_period, selectedProductIds } = req.body;

        if (!packageId) {
            return res.status(400).json({ success: false, message: 'packageId is required' });
        }

        const result = await createSubscriptionPayment({
            vendorId: req.user._id,
            packageId,
            action: 'resubscribe',
            billingPeriod: billing_period || 'monthly',
            selectedProductIds: selectedProductIds || [],
        });

        if (result.activated) {
            return res.status(201).json({
                success: true,
                message: 'Account reactivated and subscription activated',
                subscription: result.subscription,
            });
        }

        res.status(201).json({
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
    } catch (err) {
        const statusCode = err.code === 'SELECT_PRODUCTS_REQUIRED' ? 400
            : err.code === 'FREE_TRIAL_ALREADY_USED' ? 409
            : 400;
        res.status(statusCode).json({
            success: false,
            code: err.code,
            message: err.message,
            excessCount: err.excessCount,
            maxProducts: err.maxProducts,
            allProducts: err.allProducts,
        });
    }
});

/**
 * Change an active subscription plan.
 * @route   POST /api/vendors/subscription/change-plan
 * @access  Private (Vendor)
 */
router.post('/change-plan', protect('vendor'), async (req, res) => {
    try {
        const { packageId, billing_period, selectedProductIds } = req.body;

        if (!packageId) {
            return res.status(400).json({ success: false, message: 'packageId is required' });
        }

        const result = await createSubscriptionPayment({
            vendorId: req.user._id,
            packageId,
            action: 'change_plan',
            billingPeriod: billing_period || 'monthly',
            selectedProductIds: selectedProductIds || [],
        });

        if (result.activated) {
            return res.status(201).json({
                success: true,
                message: 'Subscription plan changed successfully',
                subscription: result.subscription,
            });
        }

        res.status(201).json({
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
    } catch (err) {
        const statusCode = err.code === 'SELECT_PRODUCTS_REQUIRED' ? 400
            : err.code === 'FREE_TRIAL_ALREADY_USED' ? 409
            : err.code === 'NO_SUBSCRIPTION' ? 404
            : err.code === 'SAME_PACKAGE' ? 409
            : 400;
        res.status(statusCode).json({
            success: false,
            code: err.code,
            message: err.message,
            excessCount: err.excessCount,
            maxProducts: err.maxProducts,
            allProducts: err.allProducts,
        });
    }
});

/**
 * Confirm payment after Fawaterak redirects the vendor back to the dashboard.
 * This avoids waiting for the webhook when the gateway already exposes invoice_id.
 * @route   POST /api/vendors/subscription/confirm-payment
 * @access  Private (Vendor)
 */
router.post('/confirm-payment', protect('vendor'), async (req, res) => {
    try {
        const { paymentId, invoice_id } = req.body;
        const result = await confirmSubscriptionPayment({
            vendorId: req.user._id,
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
            message: result.alreadyPaid ? 'Payment was already confirmed' : 'Payment confirmed and subscription activated',
        });
    } catch (err) {
        const statusCode = err.code === 'PAYMENT_NOT_FOUND' ? 404
            : err.code === 'PAYMENT_REFERENCE_REQUIRED' ? 400
            : err.code === 'INVOICE_MISMATCH' ? 400
            : 400;
        res.status(statusCode).json({ success: false, code: err.code, message: err.message });
    }
});

/**
 * Fawaterak paid webhook.
 * Fawaterak recommends a URL ending with _json for JSON payloads.
 * @route   POST /api/vendors/subscription/fawaterak/webhook_json
 * @access  Public
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

        await activatePaidPayment(payment, req.body);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
