/**
 * The dispatcher behind Paymob's single callback endpoint.
 *
 * Fawaterak gets a webhook URL per flow, so each of its routes already knows
 * what it is settling. Paymob does not: a per-request `notification_url` is
 * honoured only for CARD integration ids, while mobile wallet, kiosk and BNPL
 * all use the one URL saved against the integration id in Paymob's dashboard.
 * One URL for the whole merchant account, four kinds of payment behind it.
 *
 * So every Paymob payment carries a `special_reference` of the form
 * `flow:recordId:attempt`, Paymob echoes it back as `merchant_order_id`, and
 * this registry turns it into "load this row, settle it this way, send the
 * browser there".
 *
 * Each flow contributes three things and nothing else:
 *   load(id)               — the record, or null
 *   settle(record, payload) — make the payment count (idempotent)
 *   returnUrl(record, status) — where the customer expects to land
 *
 * `settle` is deliberately the SAME function the Fawaterak webhook calls. This
 * module routes; it does not re-implement what a paid payment means.
 */

const mongoose = require('mongoose');

const { OrderPayment } = require('../models/orderPayments');
const { WalletTopup } = require('../models/walletTopups');
const { SubscriptionPayment } = require('../models/subscriptionPayments');
const { SupplyOrder } = require('../models/supplyOrders');

const orderPaymentService = require('./orderPaymentService');
const walletTopupService = require('./walletTopupService');
const subscriptionPaymentService = require('./subscriptionPaymentService');
const supplyService = require('./supplyService');

const FLOWS = {
    order: {
        label: 'order payment',
        model: OrderPayment,
        invoicePath: 'invoice_id',
        load: (id) => OrderPayment.findById(id),
        settle: (record, payload) => orderPaymentService.activatePaidOrderPayment(record, payload),
        returnUrl: (record, status) => orderPaymentService.buildReturnUrl(record, status),
    },
    wallet: {
        label: 'wallet top-up',
        model: WalletTopup,
        invoicePath: 'invoice_id',
        load: (id) => WalletTopup.findById(id),
        settle: (record, payload) => walletTopupService.creditPaidTopup(record, payload),
        returnUrl: (record, status) => walletTopupService.buildReturnUrl(record, status),
    },
    sub: {
        label: 'vendor subscription',
        model: SubscriptionPayment,
        invoicePath: 'invoice_id',
        load: (id) => SubscriptionPayment.findById(id),
        settle: (record, payload) => subscriptionPaymentService.activatePaidPayment(record, payload),
        returnUrl: (record, status) => subscriptionPaymentService.buildReturnUrl(record, status),
    },
    supply: {
        label: 'supply order',
        model: SupplyOrder,
        // The supply order keeps its payment handles one level down, under
        // `payment`, because the row is an order first and a payment second.
        invoicePath: 'payment.invoice_id',
        load: (id) => SupplyOrder.findById(id),
        settle: (record, payload) => supplyService.settlePaidOrder(record, payload),
        returnUrl: (record, status) => supplyService.buildReturnUrl(record, status),
    },
};

const getFlow = (name) => FLOWS[name] || null;

/**
 * Resolve a callback to the row it belongs to, by our own reference.
 *
 * This is the happy path: the reference is ours, it names the flow and the row,
 * and nothing has to be searched for.
 */
const findByReference = async (reference) => {
    const gateway = require('./paymentGateway');
    const parsed = gateway.parseReference(reference);
    if (!parsed) return null;

    const flow = getFlow(parsed.flow);
    if (!flow) return null;
    if (!mongoose.Types.ObjectId.isValid(parsed.recordId)) return null;

    const record = await flow.load(parsed.recordId);
    if (!record) return null;
    return { flow: parsed.flow, handler: flow, record };
};

/**
 * Fall back to Paymob's own order id, across all four collections.
 *
 * Needed because the browser redirect does not reliably carry
 * `merchant_order_id` — Paymob's documented sample sends only the numeric
 * order. Every flow stores that number in `invoice_id` when the intention is
 * created, so one indexed lookup per collection finds it.
 *
 * Only ever used for ROUTING the browser. Settlement goes through the
 * server-to-server callback, which always carries the reference.
 */
const findByPaymobOrderId = async (orderId) => {
    if (!orderId) return null;
    const id = String(orderId);

    for (const [name, handler] of Object.entries(FLOWS)) {
        const record = await handler.model.findOne({ [handler.invoicePath]: id });
        if (record) return { flow: name, handler, record };
    }
    return null;
};

/** Which provider holds this record? Supply orders nest it; the rest do not. */
const providerOf = (flow, record) => (flow === 'supply' ? record.payment?.provider : record.provider);

module.exports = {
    FLOWS,
    getFlow,
    findByReference,
    findByPaymobOrderId,
    providerOf,
};
