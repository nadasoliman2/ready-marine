/**
 * Vendor supplies — packaging and labels.
 *
 * Mounted twice, because the two audiences need different halves of the same module:
 *   /api/vendors/supplies       — the vendor's shop, their orders, their payments
 *   /api/admin/supplies         — the catalogue and the fulfilment queue
 *
 * The Fawaterak webhook is the one PUBLIC route here: it is called by the payment provider,
 * not by a logged-in anyone, and is authenticated by the signed hash on the payload.
 */
const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const supplyService = require('../services/supplyService');
const { verifyPaidWebhookHash } = require('../services/fawaterakService');

const fail = (res, error) => res.status(error.status || 400).json({
    success: false,
    code: error.code || 'SUPPLY_ERROR',
    message: error.message,
});

/* ================================================================== */
/* Vendor router                                                       */
/* ================================================================== */

const vendorRouter = express.Router();

/**
 * Fawaterak paid webhook. Declared BEFORE `protect`, because the provider has no session.
 * @route POST /api/vendors/supplies/fawaterak/webhook_json
 */
vendorRouter.post('/fawaterak/webhook_json', async (req, res) => {
    try {
        if (!verifyPaidWebhookHash(req.body)) {
            return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
        }
        if (String(req.body.invoice_status || '').toLowerCase() !== 'paid') {
            return res.json({ success: true, ignored: true });
        }
        const order = await supplyService.findOrderFromWebhook(req.body);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

        // A record opened on Paymob can never be settled by a Fawaterak
        // callback. Both providers hand us numeric ids, so a collision between
        // a Fawaterak invoice id and a Paymob order id is unlikely but not
        // impossible — and settling the wrong payment is not a mistake that can
        // be walked back.
        if (order.payment?.provider !== 'fawaterak') {
            return res.json({ success: true, ignored: true, reason: 'record belongs to another provider' });
        }

        await supplyService.settlePaidOrder(order, req.body);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

vendorRouter.use(protect('vendor'));

/** @route GET /api/vendors/supplies/catalogue — what the vendor can buy, active only. */
vendorRouter.get('/catalogue', async (req, res) => {
    try {
        res.json({ success: true, products: await supplyService.listSupplyProducts({ category: req.query.category }) });
    } catch (err) { fail(res, err); }
});

/** @route GET /api/vendors/supplies/orders */
vendorRouter.get('/orders', async (req, res) => {
    try {
        res.json({ success: true, ...await supplyService.listOrdersForVendor(req.user.id, req.query) });
    } catch (err) { fail(res, err); }
});

/** @route POST /api/vendors/supplies/orders — place an order; may return a payment link. */
vendorRouter.post('/orders', async (req, res) => {
    try {
        const { order, payment_url } = await supplyService.createSupplyOrder(req.user.id, req.body || {});
        res.status(201).json({ success: true, order, payment_url });
    } catch (err) { fail(res, err); }
});

/** @route POST /api/vendors/supplies/orders/:id/pay — resume an abandoned or failed payment. */
vendorRouter.post('/orders/:id/pay', async (req, res) => {
    try {
        const { order, payment_url } = await supplyService.retryPayment(req.user.id, req.params.id);
        res.json({ success: true, order, payment_url });
    } catch (err) { fail(res, err); }
});

/**
 * The vendor is back from the payment page. Re-read the payment from the provider and
 * settle if it went through — the webhook is not the only way an order learns it is paid.
 * @route POST /api/vendors/supplies/orders/:id/confirm-payment
 */
vendorRouter.post('/orders/:id/confirm-payment', async (req, res) => {
    try {
        const { status, alreadyPaid, order } = await supplyService.confirmPayment(req.user.id, req.params.id);
        res.json({ success: true, status, alreadyPaid: Boolean(alreadyPaid), order });
    } catch (err) { fail(res, err); }
});

/** @route POST /api/vendors/supplies/orders/:id/cancel */
vendorRouter.post('/orders/:id/cancel', async (req, res) => {
    try {
        res.json({ success: true, order: await supplyService.cancelOwnOrder(req.user.id, req.params.id, req.body?.reason) });
    } catch (err) { fail(res, err); }
});

/* ================================================================== */
/* Admin router                                                        */
/* ================================================================== */

const adminRouter = express.Router();
adminRouter.use(protect('admin'));

const actorFrom = (req) => ({ role: 'admin', label: req.user?.username || 'Admin' });

/* ---- Catalogue ---- */

/** @route GET /api/admin/supplies/catalogue — includes deactivated items. */
adminRouter.get('/catalogue', async (req, res) => {
    try {
        const products = await supplyService.listSupplyProducts({
            includeInactive: true,
            category: req.query.category,
        });
        res.json({ success: true, products });
    } catch (err) { fail(res, err); }
});

adminRouter.post('/catalogue', async (req, res) => {
    try {
        res.status(201).json({ success: true, product: await supplyService.createSupplyProduct(req.body, actorFrom(req)) });
    } catch (err) { fail(res, err); }
});

adminRouter.put('/catalogue/:id', async (req, res) => {
    try {
        res.json({ success: true, product: await supplyService.updateSupplyProduct(req.params.id, req.body, actorFrom(req)) });
    } catch (err) { fail(res, err); }
});

adminRouter.delete('/catalogue/:id', async (req, res) => {
    try {
        res.json({ success: true, ...await supplyService.deleteSupplyProduct(req.params.id, actorFrom(req)) });
    } catch (err) { fail(res, err); }
});

/* ---- Orders ---- */

adminRouter.get('/orders', async (req, res) => {
    try {
        res.json({ success: true, ...await supplyService.listOrdersForAdmin(req.query) });
    } catch (err) { fail(res, err); }
});

/**
 * "The vendor says they paid." Ask the provider, settle if true, note the answer either way.
 * @route POST /api/admin/supplies/orders/:id/recheck-payment
 */
adminRouter.post('/orders/:id/recheck-payment', async (req, res) => {
    try {
        const { status, alreadyPaid, order } = await supplyService.recheckPayment(req.params.id, actorFrom(req));
        res.json({ success: true, status, alreadyPaid: Boolean(alreadyPaid), order });
    } catch (err) { fail(res, err); }
});

/**
 * The admin's entire management surface: move one order to its next state.
 * @route PUT /api/admin/supplies/orders/:id
 */
adminRouter.put('/orders/:id', async (req, res) => {
    try {
        const order = await supplyService.updateOrderStatus(req.params.id, {
            status: req.body?.status,
            note: req.body?.note,
            tracking_number: req.body?.tracking_number,
            delivery_method: req.body?.delivery_method,
            actor: actorFrom(req),
        });
        res.json({ success: true, order });
    } catch (err) { fail(res, err); }
});

module.exports = { vendorRouter, adminRouter };
