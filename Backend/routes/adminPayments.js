/**
 * Admin control over which gateway takes the money.
 *
 * One switch, four flows. Changing it affects only payments STARTED afterwards;
 * anything already open at the other provider keeps settling there, because
 * every payment record carries its own `provider`.
 *
 * The API keys are not editable here and never will be — they live in the root
 * `.env` alongside Fawaterak's. This screen reports which of them are missing
 * so an admin can see why the switch will not move, without ever being shown a
 * secret key.
 */

const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/authMiddleware');
const { SiteSettings } = require('../models/site_settings');
const { recordAuditLog } = require('../models/auditLog');
const gateway = require('../services/paymentGateway');
const paymob = require('../services/paymobService');
const fawaterak = require('../services/fawaterakService');

const getAdminActor = (req) => ({
    role: 'admin',
    label: req.user?.username || 'Admin',
});

/**
 * @desc    Read the payment gateway configuration
 * @route   GET /api/admin/payments/settings
 */
router.get('/settings', protect('admin'), async (req, res) => {
    try {
        const settings = await gateway.getPaymentSettings();
        res.json({
            success: true,
            settings,
            providers: {
                fawaterak: { mode: fawaterak.getMode(), ready: true },
                paymob: paymob.getConfigStatus(),
            },
            // Both URLs have to be saved against every Integration ID in
            // Paymob's dashboard, so the screen can show them to copy rather
            // than making someone reconstruct them from the docs.
            paymob_callback_urls: {
                webhook: `${gateway.getBackendUrl()}${gateway.PAYMOB_WEBHOOK_PATH}`,
                redirect: `${gateway.getBackendUrl()}${gateway.PAYMOB_RETURN_PATH}`,
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Change the gateway, or the pilot accounts routed to Paymob
 * @route   PUT /api/admin/payments/settings
 *
 * Pointing `provider` at a gateway whose credentials are missing is refused
 * outright: the first symptom would otherwise be a customer's checkout failing.
 */
router.put('/settings', protect('admin'), async (req, res) => {
    try {
        const patch = gateway.validateSettingsPatch(req.body || {});
        if (Object.keys(patch).length === 0) {
            return res.status(400).json({ success: false, message: 'No payment settings were provided' });
        }

        let doc = await SiteSettings.findOne();
        if (!doc) doc = new SiteSettings();

        const before = {
            ...gateway.DEFAULT_PAYMENT_SETTINGS,
            ...(doc.payments ? doc.payments.toObject?.() || doc.payments : {}),
        };

        doc.payments = { ...before, ...patch };
        doc.markModified('payments');
        await doc.save();

        const settings = await gateway.getPaymentSettings();

        await recordAuditLog({
            action: 'payment_provider_updated',
            actor: getAdminActor(req),
            target_type: 'site_settings',
            target_id: doc._id,
            impact: { before, after: patch },
        });

        res.json({ success: true, settings });
    } catch (err) {
        const status = ['INVALID_SETTINGS', 'PROVIDER_NOT_CONFIGURED'].includes(err.code) ? 400 : 500;
        res.status(status).json({ success: false, code: err.code, message: err.message });
    }
});

module.exports = router;
