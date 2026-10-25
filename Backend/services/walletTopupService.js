/**
 * Wallet top-up service — the gateway round trip that puts money into a wallet.
 *
 * Structurally this is `orderPaymentService` with the order removed: create a
 * local record, open a hosted Fawaterak invoice, and let two independent
 * confirmations (the browser redirect and the server-to-server webhook) race to
 * credit the wallet exactly once. The ledger's unique idempotency key is what
 * settles that race, so both paths call the same `creditTopup` without
 * coordinating.
 *
 * What is deliberately different from an order payment: nothing is reserved or
 * held here. A top-up that is abandoned costs the customer nothing and leaves
 * no balance stranded, so an unpaid invoice is simply marked expired by the
 * sweep rather than needing a compensating release.
 */

const { WalletTopup } = require('../models/walletTopups');
const { User } = require('../models/users');
const gateway = require('./paymentGateway');
const walletService = require('./walletService');

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

const topupError = (code, message) => {
    const err = new Error(message);
    err.code = code;
    err.status = code === 'NOT_COMPANY_MANAGER' ? 403 : code === 'TOPUP_NOT_FOUND' ? 404 : 400;
    return err;
};

/**
 * Where the customer lands after paying.
 *
 * A top-up started from checkout must return to checkout — the basket is still
 * sitting there, and sending the customer to the wallet page instead makes them
 * navigate back and rebuild their intent. `return_path` is captured when the
 * top-up is created and is validated to a relative path, so a crafted request
 * cannot turn the redirect into an open redirect to another domain.
 */
const ALLOWED_ORIGINS = ['wallet', 'checkout', 'friend_checkout', 'family_request'];

const sanitizeReturnPath = (value, origin) => {
    const fallback = origin === 'checkout' || origin === 'friend_checkout'
        ? '/checkout'
        : '/profile?tab=wallet';

    const path = String(value || '').trim();
    // Relative, single-slash paths only. `//evil.com` is protocol-relative and
    // would leave the site entirely.
    if (!path.startsWith('/') || path.startsWith('//')) return fallback;
    if (path.includes('://')) return fallback;
    return path;
};

const withQuery = (path, params) => {
    const [base, existing = ''] = path.split('?');
    const search = new URLSearchParams(existing);
    for (const [key, value] of Object.entries(params)) search.set(key, value);
    return `${base}?${search.toString()}`;
};

/**
 * Where the customer lands after paying.
 *
 * Exported because the shared Paymob return route has to rebuild it: Paymob
 * redirects every payment to one endpoint, and that endpoint is what sends the
 * customer back to the page they started from — which for a top-up may be the
 * wallet, or the checkout they were funding.
 */
const buildReturnUrl = (topup, status) => {
    const returnPath = topup.return_path || '/profile?tab=wallet';
    return `${getFrontendUrl()}${withQuery(returnPath, { topup: status, topupId: topup._id.toString() })}`;
};

const buildPaymentRequest = ({ topup, user }) => {
    const { first_name, last_name } = splitName(user.name);
    const amount = walletService.toMajor(topup.amount_minor);

    return {
        flow: 'wallet',
        recordId: topup._id,
        userId: user._id,
        amount,
        currency: topup.currency,
        customer: {
            first_name,
            last_name,
            email: user.email,
            phone: user.phone,
            address: user.addresses?.[0]?.full_address || '',
            city: user.addresses?.[0]?.city || '',
            unique_id: user._id.toString(),
        },
        items: [{ name: topup.company_id ? 'ReadyCar company wallet top-up' : 'ReadyCar wallet top-up', price: amount, quantity: 1 }],
        returnUrls: {
            success: buildReturnUrl(topup, 'success'),
            fail: buildReturnUrl(topup, 'failed'),
            pending: buildReturnUrl(topup, 'pending'),
        },
        webhookUrl: `${getBackendUrl()}/api/users/wallet/fawaterak/webhook_json`,
        extras: { walletTopupId: topup._id.toString(), userId: user._id.toString() },
    };
};

/**
 * Start a top-up: create the local record, then the hosted invoice.
 *
 * The record is written FIRST and on purpose. If the gateway call succeeds but
 * our process dies before we persist the response, the customer may still be
 * charged — and an unexplained charge with no row to reconcile against is the
 * one outcome a payments integration must never produce.
 */
const createTopup = async ({ userId, amount, origin = 'wallet', returnPath = '', companyId = null }) => {
    const settings = await walletService.getWalletSettings();
    if (!settings.topup_enabled) {
        throw topupError('TOPUP_DISABLED', 'Wallet top-ups are currently unavailable');
    }

    // A frozen wallet cannot take money in either. Letting a customer fund an
    // account they are barred from spending from would only trap their cash.
    if (companyId) {
        const { company } = await require('./companyService').resolveCompanyContext(userId, { companyId, role: 'manager', strict: true });
        if (!company) throw topupError('NOT_COMPANY_MANAGER', 'You do not manage this company');
        if (!require('./companyWalletService').isWallet(company)) throw topupError('COMPANY_NOT_WALLET', 'This company pays by monthly invoice');
        // After the end, only to clear a balance left below zero.
        if (company.status === 'ended' && !(company.wallet_balance_minor < 0)) throw topupError('COMPANY_ENDED', 'This company account has ended');
        returnPath = `/company/wallet?companyId=${company._id}`;
    } else {
        await walletService.assertSpendable(userId);
    }

    const amountMinor = walletService.toMinor(amount);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
        throw topupError('INVALID_AMOUNT', 'Enter a top-up amount greater than zero');
    }

    const user = await User.findById(userId).lean();
    if (!user) throw topupError('USER_NOT_FOUND', 'User not found');

    const safeOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : 'wallet';

    // Frozen onto the record before anything is opened at the provider, so the
    // confirmation, the webhook and the sweep all agree on who holds this money
    // even if the admin switch moves while the customer is paying.
    const provider = await gateway.resolveProvider({ userId });
    if (companyId && gateway.getCurrencyFor(provider) !== 'EGP') throw topupError('CURRENCY_MISMATCH', 'Company wallets require payments in EGP');

    const topup = await WalletTopup.create({
        user_id: userId,
        company_id: companyId,
        amount_minor: amountMinor,
        currency: gateway.getCurrencyFor(provider),
        origin: safeOrigin,
        return_path: sanitizeReturnPath(returnPath, safeOrigin),
        provider,
        provider_mode: gateway.getModeFor(provider),
    });

    let hosted;
    try {
        hosted = await gateway.createHostedPayment({ ...buildPaymentRequest({ topup, user }), provider });
    } catch (err) {
        topup.status = 'failed';
        topup.error_message = err.message;
        await topup.save();
        throw err;
    }

    topup.invoice_id = hosted.invoice_id;
    topup.invoice_key = hosted.invoice_key;
    topup.payment_url = hosted.payment_url;
    topup.provider_reference = hosted.provider_reference;
    topup.raw_response = hosted.raw_response;
    await topup.save();

    if (!topup.payment_url) {
        topup.status = 'failed';
        topup.error_message = `${provider} did not return a payment URL`;
        await topup.save();
        throw topupError('PAYMENT_URL_MISSING', `${provider} did not return a payment URL`);
    }

    return topup;
};

/**
 * Move a confirmed payment into the wallet.
 *
 * Reached from both the redirect and the webhook. `credited_at` plus the
 * ledger's idempotency key make the second arrival a no-op — it returns the
 * same success rather than crediting again or reporting a failure.
 */
const creditPaidTopup = async (topup, providerPayload = null) => {
    if (!topup) throw topupError('TOPUP_NOT_FOUND', 'Top-up not found');

    if (providerPayload) topup.webhook_payloads.push(providerPayload);
    if (providerPayload?.payment_method) topup.payment_method = providerPayload.payment_method;
    if (providerPayload?.invoice_id) topup.invoice_id = String(providerPayload.invoice_id);
    if (providerPayload?.invoice_key) topup.invoice_key = providerPayload.invoice_key;
    topup.provider_reference = topup.invoice_id || topup.invoice_key || topup.provider_reference;

    if (topup.credited_at) {
        topup.status = 'paid';
        await topup.save();
        return { status: 'paid', alreadyCredited: true, topup };
    }

    const paidAt = providerPayload?.paid_at ? new Date(providerPayload.paid_at) : new Date();

    try {
        const { transaction } = topup.company_id
            ? await require('./companyWalletService').move({
                companyId: topup.company_id, deltaMinor: topup.amount_minor,
                key: `topup:${topup._id}:credit`, kind: 'topup', topupId: topup._id,
                reason: 'Online company wallet top-up',
                // Paid for already: it lands even if the company moved to an invoice
                // while the payment was on its way, and comes off that invoice.
                settling: true,
            })
            : await walletService.creditTopup({
            userId: topup.user_id,
            amountMinor: topup.amount_minor,
            topupId: topup._id,
            reason: 'Wallet top-up',
        });

        topup.status = 'paid';
        topup.paid_at = paidAt;
        topup.credited_at = new Date();
        if (topup.company_id) topup.company_wallet_transaction_id = transaction?._id || null;
        else topup.wallet_transaction_id = transaction?._id || null;
        topup.error_message = null;
        await topup.save();

        return { status: 'paid', alreadyCredited: false, topup, transaction };
    } catch (err) {
        // The money was captured but the credit failed. Flagged distinctly so
        // it surfaces for support rather than looking like an unpaid invoice —
        // this is a customer who has paid and has nothing to show for it.
        topup.status = 'paid_credit_failed';
        topup.paid_at = paidAt;
        topup.error_message = err.message;
        await topup.save();
        throw err;
    }
};

/**
 * Ask whichever provider holds this top-up whether the money actually arrived.
 *
 * Every confirmation path goes through here rather than reading the browser's
 * query string, and every one of them reads `topup.provider` — not the current
 * switch — so a top-up opened on Fawaterak is still verified against Fawaterak
 * long after the store has moved to Paymob.
 */
const readTopupFromProvider = async (topup, fallbackInvoiceId = null) => {
    const invoiceId = topup.invoice_id || fallbackInvoiceId;
    if (!invoiceId && !topup.provider_reference) {
        throw topupError('TOPUP_REFERENCE_REQUIRED', 'Top-up invoice id is missing');
    }

    return gateway.readPayment({
        provider: topup.provider,
        invoice_id: invoiceId,
        invoice_key: topup.invoice_key,
        provider_reference: topup.provider_reference,
    });
};

/** Resolve the top-up a webhook is about, by payload id or by invoice. */
const findTopupFromWebhook = async (payload = {}) => {
    let payLoad = {};
    if (payload.pay_load && typeof payload.pay_load === 'object') {
        payLoad = payload.pay_load;
    } else if (typeof payload.pay_load === 'string') {
        try { payLoad = JSON.parse(payload.pay_load); } catch (_) { payLoad = {}; }
    }

    if (payLoad.walletTopupId) {
        const byPayload = await WalletTopup.findById(payLoad.walletTopupId);
        if (byPayload) return byPayload;
    }

    const or = [];
    if (payload.invoice_id) or.push({ invoice_id: String(payload.invoice_id) });
    if (payload.invoice_key) or.push({ invoice_key: payload.invoice_key });
    if (!or.length) return null;
    return WalletTopup.findOne({ $or: or });
};

/**
 * Confirm a top-up after the browser comes back from the gateway.
 *
 * Scoped to the authenticated user, and the invoice is re-read from Fawaterak
 * rather than trusting the query string: the redirect URL is fully under the
 * customer's control, so `?topup=success` on its own proves nothing.
 */
const confirmTopup = async ({ userId, topupId, invoiceId, companyId = null }) => {
    if (!topupId && !invoiceId) {
        throw topupError('TOPUP_REFERENCE_REQUIRED', 'topupId or invoice_id is required');
    }

    const or = [];
    if (topupId) or.push({ _id: topupId });
    if (invoiceId) or.push({ invoice_id: String(invoiceId) });

    if (companyId) {
        const { company } = await require('./companyService').resolveCompanyContext(userId, { companyId, role: 'manager', strict: true });
        if (!company) throw topupError('NOT_COMPANY_MANAGER', 'You do not manage this company');
    }
    const topup = await WalletTopup.findOne({ user_id: userId, company_id: companyId, $or: or });
    if (!topup) throw topupError('TOPUP_NOT_FOUND', 'Top-up not found');

    if (topup.credited_at) {
        return { status: 'paid', alreadyCredited: true, topup };
    }

    const result = await readTopupFromProvider(topup, invoiceId);
    topup.raw_response = { ...(topup.raw_response || {}), confirmation: result.envelope };

    if (!result.paid) {
        await topup.save();
        return { status: 'pending', topup };
    }

    // The provider's own record of the payment: it is the only place either
    // gateway states the fee it kept, and finance reads it back from here.
    return creditPaidTopup(topup, gateway.buildConfirmationPayload(result, {
        source: 'redirect_confirmation',
    }));
};

/**
 * Retry a top-up that the gateway captured but that never reached the wallet.
 *
 * This is the admin's one-click fix for the `paid_credit_failed` state. It does
 * NOT take the admin's word that the money was paid — it re-reads the invoice
 * from Fawaterak first. An admin looking at a failed row cannot tell a genuine
 * capture from a provider glitch, and crediting on assumption would mint money.
 *
 * The credit itself is keyed on the top-up id, so this is safe to press twice
 * and safe to press on a row a background sweep has already rescued.
 */
const retryFailedTopup = async (topupId, actor = {}) => {
    const topup = await WalletTopup.findById(topupId);
    if (!topup) throw topupError('TOPUP_NOT_FOUND', 'Top-up not found');

    if (topup.credited_at) {
        return { status: 'paid', alreadyCredited: true, topup };
    }

    if (!topup.invoice_id && !topup.provider_reference) {
        throw topupError(
            'TOPUP_NOT_VERIFIABLE',
            'This top-up has no provider invoice to verify against. Settle it with a manual wallet adjustment instead.'
        );
    }

    // The provider is the authority on whether money actually changed hands.
    const result = await readTopupFromProvider(topup);

    if (!result.paid) {
        topup.raw_response = { ...(topup.raw_response || {}), admin_retry: result.envelope };
        topup.status = 'failed';
        topup.error_message = 'Provider reports this payment as unpaid — nothing to credit';
        await topup.save();
        throw topupError(
            'TOPUP_NOT_PAID',
            'The payment provider reports this payment as unpaid, so there is nothing to credit. No money was taken.'
        );
    }

    return creditPaidTopup(topup, {
        ...gateway.buildConfirmationPayload(result, { source: 'admin_retry' }),
        actor: { role: actor.role || 'admin', label: actor.label || 'Admin' },
    });
};

const listTopups = async (userId, { page = 1, limit = 10 } = {}) => {
    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const perPage = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));

    const [rows, total] = await Promise.all([
        WalletTopup.find({ user_id: userId, company_id: null })
            .sort({ createdAt: -1 })
            .skip((currentPage - 1) * perPage)
            .limit(perPage)
            .lean(),
        WalletTopup.countDocuments({ user_id: userId, company_id: null }),
    ]);

    return {
        topups: rows.map((row) => ({
            _id: row._id,
            amount: walletService.toMajor(row.amount_minor),
            currency: row.currency,
            status: row.status,
            payment_method: row.payment_method,
            payment_url: row.status === 'pending' ? row.payment_url : null,
            created_at: row.createdAt,
            paid_at: row.paid_at,
        })),
        pagination: {
            page: currentPage,
            limit: perPage,
            total,
            pages: Math.max(1, Math.ceil(total / perPage)),
        },
    };
};

// How long an unpaid hosted payment may sit before we stop expecting it. Only
// cosmetic — nothing is held against a pending top-up — but it keeps the
// customer's top-up list honest instead of showing invoices forever.
//
// Paymob gets two days rather than six hours because kiosk payments are offered
// on this flow: the customer walks away with a reference and pays cash whenever
// they next pass a kiosk, and expiring that after six hours would write off a
// payment they are still perfectly able to make. The cost is that an abandoned
// card top-up also shows as pending for two days.
const TOPUP_TTL_HOURS = { fawaterak: 6, paymob: 48 };
const DEFAULT_TOPUP_TTL_HOURS = 6;

const topupCutoff = (provider) => new Date(
    Date.now() - (TOPUP_TTL_HOURS[provider] || DEFAULT_TOPUP_TTL_HOURS) * 60 * 60 * 1000
);

/**
 * Close out abandoned top-ups, and rescue any that were paid but never credited.
 *
 * The second half matters more than the first. A webhook that never arrived and
 * a redirect the customer closed leaves a real payment uncredited, and nothing
 * else in the system will ever notice. This sweep re-reads those invoices from
 * the provider before writing them off.
 */
const sweepStaleTopups = async () => {
    // The SHORTEST window decides what is worth loading; each row is then
    // measured against its OWN provider's cutoff, so a Paymob kiosk reference
    // is not written off on a Fawaterak schedule.
    const shortest = Math.min(DEFAULT_TOPUP_TTL_HOURS, ...Object.values(TOPUP_TTL_HOURS));
    const candidates = await WalletTopup.find({
        status: 'pending',
        createdAt: { $lte: new Date(Date.now() - shortest * 60 * 60 * 1000) },
    }).limit(500);

    let expired = 0;
    let rescued = 0;

    for (const topup of candidates) {
        if (topup.createdAt > topupCutoff(topup.provider)) continue;

        try {
            if (topup.invoice_id || topup.provider_reference) {
                const result = await readTopupFromProvider(topup);
                if (result.paid) {
                    await creditPaidTopup(topup, gateway.buildConfirmationPayload(result, { source: 'sweep' }));
                    rescued += 1;
                    continue;
                }
            }

            topup.status = 'expired';
            topup.error_message = topup.error_message || 'Top-up expired before completion';
            await topup.save();
            expired += 1;
        } catch (err) {
            console.error(`[Wallet] Sweep failed for top-up ${topup._id}: ${err.message}`);
        }
    }

    if (rescued > 0) console.log(`[Wallet] Credited ${rescued} paid top-up(s) the webhook never reported.`);
    if (expired > 0) console.log(`[Wallet] Expired ${expired} abandoned top-up(s).`);
    return { expired, rescued };
};

module.exports = {
    createTopup,
    creditPaidTopup,
    confirmTopup,
    findTopupFromWebhook,
    readTopupFromProvider,
    buildReturnUrl,
    retryFailedTopup,
    listTopups,
    sweepStaleTopups,
};
