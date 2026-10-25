/**
 * Paymob — the raw wire protocol, and nothing else.
 *
 * This file knows how to talk to Paymob and how to prove a callback came from
 * them. It knows nothing about orders, wallets, subscriptions or supplies;
 * `paymentGateway.js` is what maps our flows onto these calls, and it is the
 * only module that should import this one.
 *
 * Three things here are genuinely different from `fawaterakService` and are the
 * reason the gateway layer exists at all:
 *
 *   1. There is no "invoice". A payment starts as an INTENTION, which returns a
 *      `client_secret`; the checkout page is a URL we assemble ourselves from
 *      that secret and our public key.
 *
 *   2. Money is in PIASTRES. Every amount crossing this boundary is an integer
 *      hundredth of a pound, and `toMinor`/`toMajor` are the only places that
 *      conversion is allowed to happen.
 *
 *   3. Callbacks are signed with HMAC-SHA512 over the values of twenty fields
 *      concatenated in a FIXED order — not alphabetical, not the JSON order.
 *      The list below is copied from the docs verbatim and must not be
 *      "tidied"; reordering it silently rejects every real callback.
 */

const crypto = require('crypto');
const https = require('https');

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

/**
 * Test or live?
 *
 * Returned as `sandbox`/`live` rather than Paymob's own `test`/`live` because
 * that is the enum every payment record in this codebase already stores, and a
 * second vocabulary for the same idea is how mismatched rows happen.
 */
const getMode = () => (process.env.PAYMOB_MODE === 'live' ? 'live' : 'sandbox');

const isLive = () => getMode() === 'live';

const getBaseUrl = () => (process.env.PAYMOB_BASE_URL || 'https://accept.paymob.com').replace(/\/$/, '');

const getCheckoutUrl = () => (process.env.PAYMOB_CHECKOUT_URL || 'https://eg.checkout.paymob.com').replace(/\/$/, '');

const getSecretKey = () => (isLive() ? process.env.PAYMOB_SECRET_KEY_LIVE : process.env.PAYMOB_SECRET_KEY_TEST);

const getPublicKey = () => (isLive() ? process.env.PAYMOB_PUBLIC_KEY_LIVE : process.env.PAYMOB_PUBLIC_KEY_TEST);

const getApiKey = () => process.env.PAYMOB_API_KEY;

const getHmacSecret = () => process.env.PAYMOB_HMAC_SECRET;

const getCurrency = () => process.env.PAYMOB_CURRENCY || 'EGP';

/**
 * The Integration IDs, one per payment method per mode.
 *
 * Paymob treats every method as a separate integration with its own numeric id,
 * and an id from the wrong mode is rejected with a 404 that names neither the
 * id nor the mode — so the suffix is chosen by `getMode()` here rather than by
 * whoever is calling.
 */
const INTEGRATION_ENV = {
    card: ['PAYMOB_INTEGRATION_CARD_TEST', 'PAYMOB_INTEGRATION_CARD_LIVE'],
    wallet: ['PAYMOB_INTEGRATION_WALLET_TEST', 'PAYMOB_INTEGRATION_WALLET_LIVE'],
    kiosk: ['PAYMOB_INTEGRATION_KIOSK_TEST', 'PAYMOB_INTEGRATION_KIOSK_LIVE'],
    bnpl: ['PAYMOB_INTEGRATION_BNPL_TEST', 'PAYMOB_INTEGRATION_BNPL_LIVE'],
};

/**
 * Resolve a list of method names to the integration ids configured for them.
 *
 * Unconfigured methods are dropped rather than failing: a store that has not
 * been approved for valU yet should still be able to take card payments, and
 * the alternative — every checkout erroring until all four ids are filled in —
 * makes the rollout all-or-nothing for no good reason.
 */
const resolveIntegrationIds = (methods = ['card']) => {
    const live = isLive();
    const ids = [];
    for (const method of methods) {
        const envNames = INTEGRATION_ENV[method];
        if (!envNames) continue;
        const raw = process.env[envNames[live ? 1 : 0]];
        const id = parseInt(String(raw || '').trim(), 10);
        if (Number.isFinite(id) && id > 0 && !ids.includes(id)) ids.push(id);
    }
    return ids;
};

/**
 * Is Paymob usable at all right now?
 *
 * Called before the switch is allowed to point at Paymob, so an admin finds out
 * from a settings screen rather than from a customer who cannot check out.
 */
const getConfigStatus = () => {
    const missing = [];
    if (!getSecretKey()) missing.push(isLive() ? 'PAYMOB_SECRET_KEY_LIVE' : 'PAYMOB_SECRET_KEY_TEST');
    if (!getPublicKey()) missing.push(isLive() ? 'PAYMOB_PUBLIC_KEY_LIVE' : 'PAYMOB_PUBLIC_KEY_TEST');
    if (!getApiKey()) missing.push('PAYMOB_API_KEY');
    if (!getHmacSecret()) missing.push('PAYMOB_HMAC_SECRET');
    if (!resolveIntegrationIds(['card']).length) {
        missing.push(isLive() ? 'PAYMOB_INTEGRATION_CARD_LIVE' : 'PAYMOB_INTEGRATION_CARD_TEST');
    }
    return { ready: missing.length === 0, mode: getMode(), missing };
};

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

/** Pounds to piastres. Rounded, never truncated — 12.345 must not become 12.34. */
const toMinor = (major) => Math.round(Number(major || 0) * 100);

/** Piastres back to pounds, for storing next to every other amount we hold. */
const toMajor = (minor) => Math.round(Number(minor || 0)) / 100;

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

const formatProviderMessage = (value, fallback = 'Paymob request failed') => {
    if (!value) return fallback;
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        return value.map((item) => formatProviderMessage(item, '')).filter(Boolean).join(', ') || fallback;
    }
    if (typeof value === 'object') {
        return Object.entries(value)
            .map(([key, item]) => {
                const formatted = formatProviderMessage(item, '');
                return formatted ? `${key}: ${formatted}` : key;
            })
            .filter(Boolean)
            .join(', ') || fallback;
    }
    return String(value);
};

const requestJson = ({ method = 'POST', path, body, authorization }) => {
    const url = new URL(`${getBaseUrl()}${path}`);
    const payload = body ? JSON.stringify(body) : null;

    return new Promise((resolve, reject) => {
        const req = https.request(
            {
                hostname: url.hostname,
                path: `${url.pathname}${url.search}`,
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...(authorization ? { Authorization: authorization } : {}),
                    ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
                },
            },
            (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    let parsed = {};
                    if (data) {
                        try {
                            parsed = JSON.parse(data);
                        } catch (error) {
                            parsed = { message: data };
                        }
                    }

                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsed);
                        return;
                    }

                    const message = formatProviderMessage(parsed?.detail || parsed?.message || parsed);
                    const err = new Error(message);
                    err.providerResponse = parsed;
                    err.statusCode = res.statusCode;
                    reject(err);
                });
            }
        );

        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
};

/* ------------------------------------------------------------------ */
/* Intentions                                                          */
/* ------------------------------------------------------------------ */

/**
 * Open a payment intention and return the page to send the customer to.
 *
 * `specialReference` is the only thread tying this payment back to our records.
 * Paymob echoes it in every callback as `merchant_order_id`, and — because the
 * webhook URL is shared by all four of our flows — it is also what tells the
 * dispatcher which flow a callback belongs to. Paymob rejects a reference it
 * has seen before, so a retry MUST vary it; `paymentGateway` appends an attempt
 * counter for exactly that reason.
 */
const createIntention = async ({
    amountMajor,
    currency = getCurrency(),
    methods = ['card'],
    items = [],
    billing = {},
    specialReference,
    expirationSeconds,
    notificationUrl,
    redirectionUrl,
    extras = {},
}) => {
    const secretKey = getSecretKey();
    if (!secretKey) throw new Error(`Paymob secret key is not configured for ${getMode()} mode`);

    const publicKey = getPublicKey();
    if (!publicKey) throw new Error(`Paymob public key is not configured for ${getMode()} mode`);

    const integrationIds = resolveIntegrationIds(methods);
    if (!integrationIds.length) {
        throw new Error(`No Paymob integration ids are configured for ${getMode()} mode`);
    }

    const amount = toMinor(amountMajor);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Paymob amount must be greater than zero');

    // Paymob rejects an intention whose item amounts do not add up to the total,
    // so the caller's breakdown is used only when it reconciles exactly. A
    // single balance line is always truthful about what is being charged.
    const normalizedItems = items
        .map((item) => ({
            name: String(item.name || 'ReadyCar').slice(0, 50),
            amount: toMinor(item.price),
            quantity: Math.max(1, parseInt(item.quantity, 10) || 1),
            ...(item.description ? { description: String(item.description).slice(0, 255) } : {}),
        }))
        .filter((item) => item.amount > 0);

    const itemsTotal = normalizedItems.reduce((sum, item) => sum + item.amount * item.quantity, 0);
    const body = {
        amount,
        currency,
        payment_methods: integrationIds,
        items: itemsTotal === amount && normalizedItems.length
            ? normalizedItems
            : [{ name: 'ReadyCar', amount, quantity: 1 }],
        billing_data: {
            first_name: String(billing.first_name || 'ReadyCar').slice(0, 50),
            last_name: String(billing.last_name || 'Customer').slice(0, 50),
            email: billing.email || 'no-reply@readycar.com',
            // Paymob rejects the intention outright without a phone number, so
            // a placeholder beats a 400 the customer would see as "payment
            // unavailable". Every one of our flows has a real phone in practice.
            phone_number: String(billing.phone || '+20000000000'),
            street: String(billing.street || 'NA'),
            building: 'NA',
            floor: 'NA',
            apartment: 'NA',
            city: String(billing.city || 'NA'),
            state: String(billing.state || 'NA'),
            country: String(billing.country || 'EG'),
        },
        special_reference: specialReference,
        ...(expirationSeconds ? { expiration: Math.round(expirationSeconds) } : {}),
        ...(notificationUrl ? { notification_url: notificationUrl } : {}),
        ...(redirectionUrl ? { redirection_url: redirectionUrl } : {}),
        ...(Object.keys(extras).length ? { extras } : {}),
    };

    const response = await requestJson({
        method: 'POST',
        path: '/v1/intention/',
        body,
        authorization: `Token ${secretKey}`,
    });

    const clientSecret = response?.client_secret;
    if (!clientSecret) {
        const err = new Error('Paymob did not return a client secret');
        err.providerResponse = response;
        throw err;
    }

    return {
        clientSecret,
        intentionId: response.id || null,
        orderId: response.intention_order_id ? String(response.intention_order_id) : null,
        paymentUrl: buildCheckoutUrl(clientSecret),
        raw: response,
    };
};

/** The hosted page. Assembled here because Paymob does not return one. */
const buildCheckoutUrl = (clientSecret) => {
    const params = new URLSearchParams({ publicKey: getPublicKey() || '', clientSecret });
    return `${getCheckoutUrl()}/?${params.toString()}`;
};

/* ------------------------------------------------------------------ */
/* Transaction inquiry — "did the money actually arrive?"               */
/* ------------------------------------------------------------------ */

/**
 * Auth tokens are a second, older credential path: the inquiry API predates the
 * secret key and still wants a token minted from the API key. Cached because a
 * redirect confirmation and a webhook arriving together would otherwise mint
 * two tokens for one payment.
 */
let cachedAuthToken = null;
let cachedAuthTokenAt = 0;
const AUTH_TOKEN_TTL_MS = 45 * 60 * 1000;

const getAuthToken = async ({ force = false } = {}) => {
    if (!force && cachedAuthToken && Date.now() - cachedAuthTokenAt < AUTH_TOKEN_TTL_MS) {
        return cachedAuthToken;
    }

    const apiKey = getApiKey();
    if (!apiKey) throw new Error('PAYMOB_API_KEY is not configured');

    const response = await requestJson({
        method: 'POST',
        path: '/api/auth/tokens',
        body: { api_key: apiKey },
    });

    if (!response?.token) {
        const err = new Error('Paymob did not return an auth token');
        err.providerResponse = response;
        throw err;
    }

    cachedAuthToken = response.token;
    cachedAuthTokenAt = Date.now();
    return cachedAuthToken;
};

/**
 * Read the last transaction on an order.
 *
 * Preferred lookup is Paymob's own `order_id`, which we store the moment the
 * intention is created. `merchant_order_id` is the fallback for a record that
 * somehow never captured one — it is our `special_reference`, so it always
 * exists even when the intention response was lost.
 *
 * Callbacks remain the primary signal; this is the "the webhook never came"
 * path, exactly as the Fawaterak `getInvoiceData` call is today.
 */
const inquireTransaction = async ({ orderId, merchantOrderId }) => {
    if (!orderId && !merchantOrderId) throw new Error('orderId or merchantOrderId is required');

    const call = async (token) => requestJson({
        method: 'POST',
        path: '/api/ecommerce/orders/transaction_inquiry',
        body: {
            auth_token: token,
            ...(orderId ? { order_id: String(orderId) } : { merchant_order_id: String(merchantOrderId) }),
        },
    });

    try {
        return await call(await getAuthToken());
    } catch (err) {
        // A cached token that expired early looks like a 401. One forced retry
        // turns that into a normal confirmation instead of a support ticket.
        if (err.statusCode !== 401 && err.statusCode !== 403) throw err;
        return call(await getAuthToken({ force: true }));
    }
};

/* ------------------------------------------------------------------ */
/* HMAC                                                                */
/* ------------------------------------------------------------------ */

/**
 * The twenty fields, in Paymob's order. Copied from the docs as-is.
 *
 * The two shapes differ in exactly two places: the server-to-server callback
 * nests everything under `obj` and names the transaction `id` and the order
 * `order.id`, while the browser redirect flattens them to `id` and `order_id`.
 * Everything else is identical, which is why one list with two overrides is
 * clearer here than two near-duplicate lists.
 */
const HMAC_FIELDS = [
    'amount_cents',
    'created_at',
    'currency',
    'error_occured',
    'has_parent_transaction',
    'id',
    'integration_id',
    'is_3d_secure',
    'is_auth',
    'is_capture',
    'is_refunded',
    'is_standalone_payment',
    'is_voided',
    'order.id',
    'owner',
    'pending',
    'source_data.pan',
    'source_data.sub_type',
    'source_data.type',
    'success',
];

/**
 * On the redirect the order is flat, but which name it arrives under is not
 * settled: the HMAC guide says `order_id` while Paymob's own sample redirect
 * sends `order`. Both are accepted, first one present wins — guessing wrong
 * would reject every genuine return.
 */
const REDIRECT_FIELD_OVERRIDES = { 'order.id': ['order_id', 'order'] };

const readPath = (source, path) => path.split('.').reduce(
    (value, key) => (value === null || value === undefined ? undefined : value[key]),
    source
);

const readRedirectField = (query, field) => {
    const names = REDIRECT_FIELD_OVERRIDES[field] || [field];
    for (const name of names) {
        if (query[name] !== undefined && query[name] !== null && query[name] !== '') return query[name];
    }
    return undefined;
};

/** The Paymob order id off a redirect, under whichever name it arrived. */
const redirectOrderId = (query = {}) => {
    const value = readRedirectField(query, 'order.id');
    return value === undefined ? null : String(value);
};

/**
 * Build the string Paymob hashed.
 *
 * Values are concatenated with NO separator. A missing value contributes an
 * empty string rather than "undefined" — a wallet transaction has no card PAN,
 * and stringifying the absence would break every wallet callback.
 */
const buildHmacString = (source, { redirect = false } = {}) => HMAC_FIELDS
    .map((field) => {
        const value = redirect ? readRedirectField(source, field) : readPath(source, field);
        if (value === null || value === undefined) return '';
        return String(value);
    })
    .join('');

const safeEquals = (a, b) => {
    const left = Buffer.from(String(a || ''));
    const right = Buffer.from(String(b || ''));
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
};

/**
 * Verify a server-to-server callback (POST, JSON body under `obj`).
 *
 * Paymob puts the signature in the QUERY STRING of the notification URL, not in
 * the body, so the caller has to hand both over. The body copy is accepted too
 * because some Paymob account configurations include it there as well and
 * rejecting a valid callback is worse than checking one extra place.
 */
const verifyProcessedCallback = (body = {}, receivedHmac) => {
    const secret = getHmacSecret();
    if (!secret) return false;

    const obj = body?.obj;
    const signature = receivedHmac || body?.hmac;
    if (!obj || !signature) return false;

    const expected = crypto.createHmac('sha512', secret).update(buildHmacString(obj)).digest('hex');
    return safeEquals(expected, signature);
};

/**
 * Verify the browser redirect (GET, flat query params).
 *
 * Worth verifying even though the customer is right there: the query string is
 * entirely under their control, and this is what stops `?success=true` typed by
 * hand from turning into an order.
 */
const verifyRedirectCallback = (query = {}) => {
    const secret = getHmacSecret();
    if (!secret) return false;
    if (!query.hmac) return false;

    const expected = crypto.createHmac('sha512', secret).update(buildHmacString(query, { redirect: true })).digest('hex');
    return safeEquals(expected, query.hmac);
};

/* ------------------------------------------------------------------ */
/* Reading a transaction                                               */
/* ------------------------------------------------------------------ */

const asBool = (value) => value === true || value === 'true' || value === 1 || value === '1';

/**
 * One shape for a Paymob transaction, whichever door it came through.
 *
 * A webhook body, a redirect query string and an inquiry response all describe
 * the same thing with slightly different casing and nesting; the flows above
 * should never have to care which one they were handed.
 *
 * `pending` is not a detail. A kiosk payment reports `success: false,
 * pending: true` when the reference is issued and only becomes successful when
 * the customer actually hands over cash — treating that first callback as a
 * failure would cancel a payment that is merely waiting.
 */
const normalizeTransaction = (source = {}) => {
    const obj = source?.obj || source;
    const order = obj.order || {};

    const pending = asBool(obj.pending);
    const success = asBool(obj.success);

    return {
        transaction_id: obj.id ? String(obj.id) : null,
        // `order` (flat) is the redirect's spelling; `order.id` the callback's.
        order_id: (order.id || obj.order_id || obj.order) ? String(order.id || obj.order_id || obj.order) : null,
        merchant_order_id: order.merchant_order_id || obj.merchant_order_id || null,
        amount_major: toMajor(obj.amount_cents),
        currency: obj.currency || getCurrency(),
        // A pending transaction is neither paid nor failed. Kiosk references sit
        // here for as long as the customer takes to reach a kiosk.
        paid: success && !pending,
        pending,
        success,
        error_occured: asBool(obj.error_occured),
        paid_at: obj.created_at || null,
        payment_method: obj.source_data?.sub_type || obj.source_data?.type || obj['source_data.sub_type'] || null,
        source_type: obj.source_data?.type || obj['source_data.type'] || null,
        is_refunded: asBool(obj.is_refunded),
        is_voided: asBool(obj.is_voided),
        raw: obj,
    };
};

/**
 * What Paymob kept from this payment.
 *
 * Three fields can carry it and which one is populated depends on the account's
 * settlement configuration, so all three are tried, cheapest conversion last.
 * Returns null — never zero — when none of them carries a number, so finance
 * reports can say "could not be costed" instead of booking the payment as free.
 *
 * ⚠️ Unverified against a live transaction. Every field is 0 in Paymob's own
 * sample because the sample is a test payment. Confirm on the first real one
 * and delete this warning, the way the Fawaterak fee was confirmed at 4.56 on
 * a 100 EGP card payment.
 */
const feeFromTransaction = (source = {}) => {
    const obj = source?.obj || source;

    const cents = Number(obj.accept_fees_cents_int);
    if (Number.isFinite(cents) && cents > 0) return Number(toMajor(cents).toFixed(2));

    for (const value of [obj.accept_fees, obj.merchant_commission]) {
        const fee = Number(value);
        if (value !== null && value !== undefined && value !== '' && Number.isFinite(fee) && fee > 0) {
            return Number(fee.toFixed(2));
        }
    }
    return null;
};

module.exports = {
    getMode,
    getCurrency,
    getConfigStatus,
    resolveIntegrationIds,
    toMinor,
    toMajor,
    createIntention,
    buildCheckoutUrl,
    inquireTransaction,
    verifyProcessedCallback,
    verifyRedirectCallback,
    buildHmacString,
    redirectOrderId,
    normalizeTransaction,
    feeFromTransaction,
};
