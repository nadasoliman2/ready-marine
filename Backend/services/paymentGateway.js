/**
 * The payment gateway layer — one door in front of Fawaterak and Paymob.
 *
 * Four flows take money through a hosted payment page: customer orders, wallet
 * top-ups, vendor subscriptions and supply orders. None of them should know
 * which provider is switched on, so all four call `createHostedPayment` and
 * `readPayment` here and store whatever comes back.
 *
 * ── The rule that matters more than any other ───────────────────────────────
 *
 * Starting a payment reads the CURRENT switch. Everything afterwards reads the
 * provider stored ON THE RECORD. An admin flipping the switch while a customer
 * is sitting on a Fawaterak page must not orphan that payment, so confirmation,
 * webhooks and sweeps all take `provider` from the row, never from settings.
 *
 * ── Why Paymob forced a shared webhook ──────────────────────────────────────
 *
 * Paymob honours a per-request `notification_url` only for CARD integration
 * ids. Mobile wallet, kiosk and BNPL use the single URL saved against the
 * integration id in Paymob's dashboard — one URL for the whole merchant
 * account. So the four per-flow webhook routes we have for Fawaterak cannot
 * carry over: every Paymob callback lands on one endpoint and is dispatched by
 * the `special_reference` we minted here. See `paymentFlows.js`.
 */

const { SiteSettings } = require('../models/site_settings');
const fawaterak = require('./fawaterakService');
const paymob = require('./paymobService');

const PROVIDERS = ['fawaterak', 'paymob'];

/* ------------------------------------------------------------------ */
/* Flow definitions                                                    */
/* ------------------------------------------------------------------ */

/**
 * The four flows, and what each one is allowed to offer.
 *
 * `kiosk` appears for wallet top-ups ONLY, and that is a deliberate product
 * decision rather than an oversight. A kiosk payment issues a reference the
 * customer may redeem days later; a basket cannot survive that wait — prices
 * and stock move, and the amount check would refuse to build the order after
 * the customer had already handed over cash. Funding a wallet has no basket to
 * go stale, and the customer then pays the order from their balance instantly.
 *
 * `bnpl` is the reverse case: instalments only make sense against goods, so it
 * is offered on orders and nowhere else.
 */
const FLOWS = {
    order: { methods: ['card', 'wallet', 'bnpl'], expiryHours: 6 },
    // Long window on purpose — a kiosk reference is useless if it expires
    // before the customer reaches a kiosk. The cost is cosmetic: an abandoned
    // card top-up shows as pending for two days instead of six hours.
    wallet: { methods: ['card', 'wallet', 'kiosk'], expiryHours: 48 },
    sub: { methods: ['card', 'wallet'], expiryHours: 6 },
    supply: { methods: ['card', 'wallet'], expiryHours: 6 },
};

const isKnownFlow = (flow) => Object.prototype.hasOwnProperty.call(FLOWS, flow);

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

const DEFAULT_PAYMENT_SETTINGS = {
    provider: 'fawaterak',
    paymob_pilot_user_ids: [],
};

/**
 * The switch, plus its escape hatch.
 *
 * `paymob_pilot_user_ids` is what lets Paymob be exercised on the real server
 * without a single customer noticing: those accounts are routed to Paymob while
 * everyone else stays on Fawaterak. It is meant to be emptied once the switch
 * itself is flipped.
 */
const getPaymentSettings = async () => {
    const doc = await SiteSettings.findOne().select('payments').lean();
    const stored = doc?.payments || {};
    return {
        ...DEFAULT_PAYMENT_SETTINGS,
        ...stored,
        provider: PROVIDERS.includes(stored.provider) ? stored.provider : DEFAULT_PAYMENT_SETTINGS.provider,
        paymob_pilot_user_ids: (stored.paymob_pilot_user_ids || []).map((id) => String(id)),
    };
};

const validateSettingsPatch = (patch = {}) => {
    const out = {};

    if (patch.provider !== undefined) {
        if (!PROVIDERS.includes(patch.provider)) {
            const err = new Error(`Unknown payment provider "${patch.provider}"`);
            err.code = 'INVALID_SETTINGS';
            throw err;
        }
        // Pointing the store at a provider whose keys are missing would take
        // every online payment down at once, and the first symptom would be a
        // customer's failed checkout. Refuse here instead.
        if (patch.provider === 'paymob') {
            const status = paymob.getConfigStatus();
            if (!status.ready) {
                const err = new Error(
                    `Paymob is not configured for ${status.mode} mode. Missing: ${status.missing.join(', ')}`
                );
                err.code = 'PROVIDER_NOT_CONFIGURED';
                throw err;
            }
        }
        out.provider = patch.provider;
    }

    if (patch.paymob_pilot_user_ids !== undefined) {
        if (!Array.isArray(patch.paymob_pilot_user_ids)) {
            const err = new Error('Pilot user ids must be a list');
            err.code = 'INVALID_SETTINGS';
            throw err;
        }
        const mongoose = require('mongoose');
        const ids = patch.paymob_pilot_user_ids
            .map((id) => String(id || '').trim())
            .filter((id) => mongoose.Types.ObjectId.isValid(id));
        if (ids.length > 20) {
            const err = new Error('At most 20 pilot accounts can be listed');
            err.code = 'INVALID_SETTINGS';
            throw err;
        }
        out.paymob_pilot_user_ids = [...new Set(ids)];
    }

    return out;
};

/**
 * Which provider should a NEW payment go to?
 *
 * Only ever called when a payment is being created. Everywhere else reads the
 * provider off the record.
 */
const resolveProvider = async ({ userId = null } = {}) => {
    const settings = await getPaymentSettings();
    if (userId && settings.paymob_pilot_user_ids.includes(String(userId))) return 'paymob';
    return settings.provider;
};

const getModeFor = (provider) => (provider === 'paymob' ? paymob.getMode() : fawaterak.getMode());

const getCurrencyFor = (provider) => (provider === 'paymob' ? paymob.getCurrency() : fawaterak.getCurrency());

/* ------------------------------------------------------------------ */
/* References                                                          */
/* ------------------------------------------------------------------ */

const getBackendUrl = () => (
    process.env.BACKEND_PUBLIC_URL ||
    process.env.BACKEND_URL ||
    process.env.API_PUBLIC_URL ||
    `http://localhost:${process.env.PORT || 4000}`
).replace(/\/api\/?$/, '').replace(/\/$/, '');

const PAYMOB_WEBHOOK_PATH = '/api/payments/paymob/webhook';
const PAYMOB_RETURN_PATH = '/api/payments/paymob/return';

/**
 * The thread tying a Paymob transaction back to one of our records.
 *
 * Shaped `flow:recordId:attempt` because the shared webhook has nothing else to
 * dispatch on. The attempt counter is not decoration: Paymob rejects a
 * `special_reference` it has already seen, and `supplyService.retryPayment`
 * reopens a payment on the same order row, so a fixed reference would make
 * every retry fail at the provider.
 */
const buildReference = (flow, recordId, attempt = 1) =>
    `${flow}:${String(recordId)}:${Math.max(1, parseInt(attempt, 10) || 1)}`;

const parseReference = (reference) => {
    const parts = String(reference || '').split(':');
    if (parts.length < 2) return null;
    const [flow, recordId, attempt] = parts;
    if (!isKnownFlow(flow)) return null;
    return { flow, recordId, attempt: parseInt(attempt, 10) || 1 };
};

/* ------------------------------------------------------------------ */
/* Creating a hosted payment                                           */
/* ------------------------------------------------------------------ */

/**
 * Open a hosted payment page and return the handles to store on the record.
 *
 * The returned field names are the ones every flow already persists, so
 * adopting this layer is a call swap rather than a schema change. What they
 * hold differs by provider, and the mapping is stated here once:
 *
 *   | field              | Fawaterak    | Paymob                       |
 *   |--------------------|--------------|------------------------------|
 *   | invoice_id         | invoiceId    | intention_order_id           |
 *   | invoice_key        | invoiceKey   | intention id (`pi_…`)        |
 *   | provider_reference | invoiceId    | special_reference            |
 *
 * `provider_reference` differing in kind between the two is intentional: for
 * Fawaterak the invoice IS the handle, while for Paymob the reference we minted
 * is the only value that survives every callback shape.
 *
 * @param {string}  flow        one of `order` | `wallet` | `sub` | `supply`
 * @param {string}  recordId    the row this payment belongs to
 * @param {number}  attempt     1 for the first try, incremented on every retry
 * @param {number}  amount      in major units (EGP), not piastres
 * @param {object}  customer    { first_name, last_name, email, phone, address, city, unique_id }
 * @param {Array}   items       [{ name, price, quantity }] — used only if it reconciles
 * @param {object}  returnUrls  { success, fail, pending } absolute frontend URLs
 * @param {string}  webhookUrl  the Fawaterak per-flow webhook; ignored by Paymob
 * @param {string}  provider    force a provider (a record being retried keeps its own)
 */
const createHostedPayment = async ({
    flow,
    recordId,
    attempt = 1,
    amount,
    currency,
    customer = {},
    items = [],
    returnUrls = {},
    webhookUrl,
    extras = {},
    userId = null,
    provider = null,
}) => {
    if (!isKnownFlow(flow)) throw new Error(`Unknown payment flow "${flow}"`);

    const chosen = provider || await resolveProvider({ userId });
    const reference = buildReference(flow, recordId, attempt);

    if (chosen === 'paymob') {
        const backendUrl = getBackendUrl();
        const intention = await paymob.createIntention({
            amountMajor: amount,
            currency: currency || paymob.getCurrency(),
            methods: FLOWS[flow].methods,
            items,
            billing: {
                first_name: customer.first_name,
                last_name: customer.last_name,
                email: customer.email,
                phone: customer.phone,
                street: customer.address,
                city: customer.city,
            },
            specialReference: reference,
            expirationSeconds: FLOWS[flow].expiryHours * 3600,
            notificationUrl: `${backendUrl}${PAYMOB_WEBHOOK_PATH}`,
            redirectionUrl: `${backendUrl}${PAYMOB_RETURN_PATH}`,
            extras: { flow, record_id: String(recordId), ...extras },
        });

        return {
            provider: 'paymob',
            provider_mode: paymob.getMode(),
            currency: currency || paymob.getCurrency(),
            payment_url: intention.paymentUrl,
            invoice_id: intention.orderId,
            invoice_key: intention.intentionId,
            provider_reference: reference,
            raw_response: intention.raw,
        };
    }

    const response = await fawaterak.createInvoiceLink({
        cartTotal: Number(amount).toFixed(2),
        currency: currency || fawaterak.getCurrency(),
        customer: {
            first_name: customer.first_name || 'ReadyCar',
            last_name: customer.last_name || 'Customer',
            email: customer.email,
            phone: customer.phone,
            address: customer.address || '',
            customer_unique_id: customer.unique_id,
        },
        redirectionUrls: {
            successUrl: returnUrls.success,
            failUrl: returnUrls.fail,
            pendingUrl: returnUrls.pending,
            webhookUrl,
        },
        cartItems: items.length
            ? items.map((item) => ({
                name: item.name,
                price: Number(item.price).toFixed(2),
                quantity: item.quantity || 1,
            }))
            : [{ name: 'ReadyCar', price: Number(amount).toFixed(2), quantity: 1 }],
        payLoad: { ...extras, reference },
        sendEmail: false,
        sendSMS: false,
    });

    const data = response?.data || {};
    const invoiceId = data.invoiceId ? String(data.invoiceId) : null;
    return {
        provider: 'fawaterak',
        provider_mode: fawaterak.getMode(),
        currency: currency || fawaterak.getCurrency(),
        payment_url: data.url || null,
        invoice_id: invoiceId,
        invoice_key: data.invoiceKey || null,
        provider_reference: invoiceId || data.invoiceKey || reference,
        raw_response: response,
    };
};

/* ------------------------------------------------------------------ */
/* Reading a payment back                                              */
/* ------------------------------------------------------------------ */

/** Is a Fawaterak invoice record paid? Unchanged from the original flow code. */
const isInvoicePaid = (invoiceData = {}) => {
    if (invoiceData.paid === 1 || invoiceData.paid === true || invoiceData.paid === '1') return true;
    if (invoiceData.paid_at) return true;
    return String(invoiceData.invoice_status || invoiceData.status || '').toLowerCase() === 'paid';
};

/**
 * Ask the provider what actually happened to a payment.
 *
 * This is the "never trust the redirect" call. A browser landing back on our
 * site with `?payment=success` proves nothing — the query string belongs to the
 * customer — so every confirmation path re-reads the payment from the provider
 * before anything is created or credited.
 *
 * Returns one shape regardless of provider:
 *   { paid, pending, paid_at, payment_method, invoice_id, invoice_key, raw, envelope }
 *
 * `raw` is the provider's own record of the payment and is what gets stored in
 * `webhook_payloads`, because it is the only place either provider states its
 * fee. `envelope` is the full HTTP response, kept for `raw_response`.
 */
const readPayment = async ({ provider, invoice_id: invoiceId, invoice_key: invoiceKey, provider_reference: reference }) => {
    if (provider === 'paymob') {
        const response = await paymob.inquireTransaction({ orderId: invoiceId, merchantOrderId: reference });
        const txn = paymob.normalizeTransaction(response);
        return {
            paid: txn.paid,
            pending: txn.pending,
            paid_at: txn.paid_at,
            payment_method: txn.payment_method,
            invoice_id: txn.order_id || invoiceId,
            invoice_key: invoiceKey,
            transaction_id: txn.transaction_id,
            raw: txn.raw,
            envelope: response,
        };
    }

    if (!invoiceId) {
        const err = new Error('Payment invoice id is missing');
        err.code = 'PAYMENT_REFERENCE_REQUIRED';
        throw err;
    }

    const response = await fawaterak.getInvoiceData(invoiceId);
    const data = response?.data || {};
    const paid = isInvoicePaid(data);
    return {
        paid,
        pending: !paid,
        paid_at: data.paid_at || null,
        payment_method: data.payment_method || null,
        invoice_id: data.invoice_id ? String(data.invoice_id) : invoiceId,
        invoice_key: data.invoice_key || invoiceKey,
        transaction_id: null,
        raw: data,
        envelope: response,
    };
};

/**
 * The payload a flow stores when a payment is confirmed.
 *
 * Kept identical in shape to what the Fawaterak flows already push into
 * `webhook_payloads`, so the finance reports that read `raw.commission` out of
 * that history keep working untouched for existing rows.
 */
const buildConfirmationPayload = (result, { source }) => ({
    source,
    invoice_id: result.invoice_id,
    invoice_key: result.invoice_key,
    payment_method: result.payment_method,
    paid_at: result.paid_at,
    ...(result.transaction_id ? { transaction_id: result.transaction_id } : {}),
    raw: result.raw,
});

module.exports = {
    PROVIDERS,
    FLOWS,
    DEFAULT_PAYMENT_SETTINGS,
    PAYMOB_WEBHOOK_PATH,
    PAYMOB_RETURN_PATH,
    getPaymentSettings,
    validateSettingsPatch,
    resolveProvider,
    getModeFor,
    getCurrencyFor,
    buildReference,
    parseReference,
    createHostedPayment,
    readPayment,
    isInvoicePaid,
    buildConfirmationPayload,
    getBackendUrl,
};
