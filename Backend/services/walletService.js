/**
 * Wallet service — the single writer of customer store credit.
 *
 * The store no longer charges a card at checkout. A customer tops up the wallet
 * through the gateway and then spends credit, and every refund comes back here
 * instead of to a card or a bank account. That makes this file the only place
 * customer money is created, moved, or destroyed, and every rule about how it
 * behaves lives here rather than in the routes that call it.
 *
 * Three invariants hold everything together:
 *
 *   1. The ledger is the truth. `WalletAccount` is a cache; every balance
 *      change writes a `WalletTransaction` explaining it. A balance we cannot
 *      explain is rolled back rather than kept.
 *
 *   2. Every operation is idempotent. Mongo here is a standalone server, so
 *      there are no multi-document transactions to lean on — correctness comes
 *      from a conditional atomic `$inc` plus a unique idempotency key, exactly
 *      as `loyaltyService` does it. The gateway's redirect and its webhook
 *      confirm the same top-up simultaneously on a routine basis; replaying
 *      must be a no-op, never a second credit.
 *
 *   3. Money is integers. Balances are minor units (piastres). Callers speak
 *      EGP and conversion happens at this boundary, so nothing downstream ever
 *      does floating-point arithmetic on a balance.
 */

const mongoose = require('mongoose');
const { WalletAccount } = require('../models/walletAccounts');
const { WalletTransaction } = require('../models/walletTransactions');
const { SiteSettings } = require('../models/site_settings');

/* ------------------------------------------------------------------ */
/*  Money conversion                                                  */
/* ------------------------------------------------------------------ */

/**
 * EGP → piastres.
 *
 * `Math.round` rather than a truncation: 12.345 becoming 1234 instead of 1235
 * loses the customer a piastre on every conversion, and a rounding rule that
 * always favours the store is the kind of thing that is discovered in an audit.
 */
const toMinor = (amount) => {
    const value = Number(amount);
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 100);
};

/** piastres → EGP, for display and for the rest of the app's float-based totals. */
const toMajor = (minor) => Number(((Number(minor) || 0) / 100).toFixed(2));

const round2 = (value) => Number((Number(value) || 0).toFixed(2));

const walletError = (code, message, extra = {}) => {
    const err = new Error(message);
    err.code = code;
    Object.assign(err, extra);
    return err;
};

/* ------------------------------------------------------------------ */
/*  Settings                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_WALLET_SETTINGS = {
    enabled: false,
    topup_enabled: true,
    // Does the gateway stay on the checkout screen once the wallet is live?
    //
    // On (the default) the wallet ADDS a way to pay instead of replacing one:
    // the customer picks the wallet, the gateway, or cash. Off restores the
    // original wallet-only behaviour — wallet plus cash, gateway reserved for
    // funding the wallet. Kept separate from `enabled` so the store can step
    // back to wallet-only without switching the wallet off and stranding every
    // balance customers are holding.
    online_payment_enabled: true,
    // Suggestions only — the customer may always type their own amount, and
    // the shortfall top-up at checkout ignores these entirely.
    topup_suggestions: [100, 250, 500, 1000],
    currency: 'EGP',
    // Cash on delivery survives the switch to wallet checkout. Turning this off
    // makes the store fully prepaid.
    cod_enabled: true,
};

const getWalletSettings = async () => {
    const doc = await SiteSettings.findOne().select('wallet currency').lean();
    const stored = doc?.wallet || {};
    return {
        ...DEFAULT_WALLET_SETTINGS,
        ...stored,
        // A blank site currency must not silently blank the wallet's.
        currency: stored.currency || doc?.currency || DEFAULT_WALLET_SETTINGS.currency,
        topup_suggestions: Array.isArray(stored.topup_suggestions) && stored.topup_suggestions.length
            ? stored.topup_suggestions
            : DEFAULT_WALLET_SETTINGS.topup_suggestions,
    };
};

/** Is wallet checkout live? Used as the kill switch by every calling flow. */
const isWalletEnabled = async () => {
    const settings = await getWalletSettings();
    return !!settings.enabled;
};

/**
 * May the customer pay this order through the gateway?
 *
 * With the wallet switched off the gateway is the ONLY prepaid route, so the
 * setting is not consulted — it can never take the last way to pay online away
 * from a store that has no wallet.
 */
const isOnlinePaymentAllowed = async () => {
    const settings = await getWalletSettings();
    if (!settings.enabled) return true;
    return !!settings.online_payment_enabled;
};

/**
 * The prepaid methods checkout may offer right now, in the order they are
 * shown. Decided here rather than in each screen so every flow — normal
 * checkout, a gift, a family approval — offers exactly the same set.
 */
const getAvailablePaymentMethods = async () => {
    const settings = await getWalletSettings();
    const methods = [];
    if (settings.enabled) methods.push('wallet');
    if (!settings.enabled || settings.online_payment_enabled) methods.push('credit_card');
    return methods;
};

/**
 * Validate an admin settings patch.
 *
 * Only known keys survive, and each is coerced to its real type — a settings
 * document is the one place a typo becomes a site-wide behaviour change.
 */
const validateSettingsPatch = (patch = {}) => {
    const out = {};

    if (patch.enabled !== undefined) out.enabled = !!patch.enabled;
    if (patch.topup_enabled !== undefined) out.topup_enabled = !!patch.topup_enabled;
    if (patch.online_payment_enabled !== undefined) out.online_payment_enabled = !!patch.online_payment_enabled;
    if (patch.cod_enabled !== undefined) out.cod_enabled = !!patch.cod_enabled;

    if (patch.topup_suggestions !== undefined) {
        if (!Array.isArray(patch.topup_suggestions)) {
            throw walletError('INVALID_SETTINGS', 'Top-up suggestions must be a list of amounts');
        }
        const amounts = patch.topup_suggestions
            .map((value) => round2(value))
            .filter((value) => Number.isFinite(value) && value > 0);
        if (amounts.length > 8) {
            throw walletError('INVALID_SETTINGS', 'At most 8 top-up suggestions can be shown');
        }
        out.topup_suggestions = [...new Set(amounts)].sort((a, b) => a - b);
    }

    return out;
};

/* ------------------------------------------------------------------ */
/*  Accounts                                                          */
/* ------------------------------------------------------------------ */

const getOrCreateAccount = async (userId) => {
    const existing = await WalletAccount.findOne({ user_id: userId });
    if (existing) return existing;

    try {
        return await WalletAccount.create({ user_id: userId });
    } catch (err) {
        // Two requests from the same customer can land here together; the
        // unique index decides, and the loser reads what the winner wrote.
        if (err.code === 11000) return WalletAccount.findOne({ user_id: userId });
        throw err;
    }
};

/** Public shape of an account, in EGP. Never hand raw minor units to a caller. */
const toPublicAccount = (account, settings = {}) => ({
    available: toMajor(account?.available_minor || 0),
    reserved: toMajor(account?.reserved_minor || 0),
    // What the customer can actually pay with today. Reserved money is already
    // committed to a checkout in flight and must never be added back in here.
    spendable: toMajor(account?.available_minor || 0),
    currency: account?.currency || settings.currency || 'EGP',
    status: account?.status || 'active',
    frozen_reason: account?.status === 'frozen' ? (account.frozen_reason || '') : '',
    lifetime: {
        topped_up: toMajor(account?.lifetime_topped_up_minor || 0),
        spent: toMajor(account?.lifetime_spent_minor || 0),
        refunded: toMajor(account?.lifetime_refunded_minor || 0),
    },
});

const getBalances = async (userId) => {
    const account = await getOrCreateAccount(userId);
    const settings = await getWalletSettings();
    return toPublicAccount(account, settings);
};

/**
 * Spendable balance in minor units, for internal pricing decisions.
 *
 * Separate from `getBalances` on purpose: callers deciding whether an order can
 * be paid must compare integers against integers, never a rounded EGP float
 * against another rounded EGP float.
 */
const getSpendableMinor = async (userId) => {
    const account = await getOrCreateAccount(userId);
    return account.available_minor || 0;
};

/* ------------------------------------------------------------------ */
/*  The ledger engine                                                 */
/* ------------------------------------------------------------------ */

/**
 * Guarantee the ledger's unique index exists before any money moves.
 *
 * Idempotency has two layers: a cheap read that catches the common replay, and
 * the unique index on `idempotency_key` that catches the concurrent one. Only
 * the index is actually a guarantee — two simultaneous confirmations of the
 * same payment both miss the read, and without the index both would credit.
 *
 * Mongoose builds indexes in the background after the connection opens, which
 * leaves a window on a fresh deployment, a restored dump, or a newly created
 * database where the collection exists and the index does not. Awaiting
 * `init()` once closes that window; every later call resolves an already
 * settled promise, so the cost is a microtask.
 */
let indexesReady = null;
const ensureIndexes = () => {
    if (!indexesReady) {
        indexesReady = Promise.all([
            WalletTransaction.init(),
            WalletAccount.init(),
        ]).catch((err) => {
            // Let the next call retry rather than caching a permanent failure.
            indexesReady = null;
            throw err;
        });
    }
    return indexesReady;
};

/**
 * Apply one ledger entry: mutate balances atomically, then durably record why.
 *
 * The order of operations is the whole design. The conditional `$inc` runs
 * FIRST, so an overdraft is rejected by the database rather than by a
 * read-then-write check two concurrent requests can both pass. The ledger row
 * is written second; if its unique key collides, this operation already
 * happened in an earlier replay, so the `$inc` is undone and the original row
 * returned.
 *
 * @param {Object} deltas Signed change per balance in MINOR units,
 *                        e.g. { available: -5000, reserved: 5000 }.
 * @returns {{ transaction, account, duplicate: boolean }}
 */
const applyLedgerEntry = async ({
    userId,
    type,
    amountMinor,
    deltas = {},
    lifetime = {},
    idempotencyKey,
    orderId = null,
    topupId = null,
    refundId = null,
    beneficiaryUserId = null,
    reason = '',
    actor = {},
}) => {
    if (!idempotencyKey) throw new Error('A wallet transaction needs an idempotency key');

    // Before the first movement of money, and effectively free thereafter.
    await ensureIndexes();

    const magnitude = Math.max(0, Math.round(Number(amountMinor) || 0));

    // Fast path — a replay we have already seen. Cheaper than provoking the
    // unique-index collision below, and by far the more common case.
    const seen = await WalletTransaction.findOne({ idempotency_key: idempotencyKey });
    if (seen) {
        const account = await WalletAccount.findOne({ user_id: userId });
        return { transaction: seen, account, duplicate: true };
    }

    const account = await getOrCreateAccount(userId);

    const inc = {};
    const filter = { _id: account._id };
    const fieldOf = { available: 'available_minor', reserved: 'reserved_minor' };

    for (const [balance, field] of Object.entries(fieldOf)) {
        const delta = Math.round(Number(deltas[balance]) || 0);
        if (delta === 0) continue;
        inc[field] = delta;
        // A negative delta may never drive a balance below zero. Expressing
        // that as a query condition is what makes the whole operation atomic —
        // and what makes an overdraft impossible rather than merely unlikely.
        if (delta < 0) filter[field] = { $gte: -delta };
    }
    if (lifetime.topped_up) inc.lifetime_topped_up_minor = Math.round(lifetime.topped_up);
    if (lifetime.spent) inc.lifetime_spent_minor = Math.round(lifetime.spent);
    if (lifetime.refunded) inc.lifetime_refunded_minor = Math.round(lifetime.refunded);

    const updated = Object.keys(inc).length > 0
        ? await WalletAccount.findOneAndUpdate(
            filter,
            { $inc: inc, $set: { updated_at: new Date() } },
            { returnDocument: 'after' }
        )
        : account;

    if (!updated) {
        throw walletError(
            'INSUFFICIENT_BALANCE',
            'Your wallet balance is not enough for this operation',
            { available: toMajor(account.available_minor || 0) }
        );
    }

    try {
        const transaction = await WalletTransaction.create({
            user_id: userId,
            account_id: account._id,
            type,
            amount_minor: magnitude,
            currency: account.currency || 'EGP',
            balance_deltas: {
                available: Math.round(Number(deltas.available) || 0),
                reserved: Math.round(Number(deltas.reserved) || 0),
            },
            balance_after_minor: updated.available_minor || 0,
            order_id: orderId,
            topup_id: topupId,
            refund_id: refundId,
            beneficiary_user_id: beneficiaryUserId,
            idempotency_key: idempotencyKey,
            reason,
            actor: { role: actor.role || 'system', label: actor.label || actor.username || 'System' },
        });
        return { transaction, account: updated, duplicate: false };
    } catch (err) {
        // Roll the balances back — the ledger is authoritative, and a balance
        // we cannot explain with a transaction must not survive.
        if (Object.keys(inc).length > 0) {
            const revert = Object.fromEntries(Object.entries(inc).map(([k, v]) => [k, -v]));
            await WalletAccount.updateOne(
                { _id: account._id },
                { $inc: revert, $set: { updated_at: new Date() } }
            );
        }
        if (err.code === 11000) {
            // Lost the race to a concurrent replay of the same event.
            const existing = await WalletTransaction.findOne({ idempotency_key: idempotencyKey });
            const current = await WalletAccount.findById(account._id);
            return { transaction: existing, account: current, duplicate: true };
        }
        throw err;
    }
};

/**
 * Refuse to move money out of a wallet that support has frozen.
 *
 * Applied to spending and top-ups only. Money coming BACK — a refund, a
 * cancellation, an admin correction — is always allowed through: freezing an
 * account is a pause on activity, not a claim on a balance the customer is
 * already owed.
 */
const assertSpendable = async (userId) => {
    const account = await getOrCreateAccount(userId);
    if (account.status === 'frozen') {
        throw walletError(
            'WALLET_FROZEN',
            account.frozen_reason
                ? `This wallet is temporarily on hold: ${account.frozen_reason}`
                : 'This wallet is temporarily on hold. Please contact support.'
        );
    }
    return account;
};

/* ------------------------------------------------------------------ */
/*  Money in                                                          */
/* ------------------------------------------------------------------ */

/**
 * Credit a confirmed gateway top-up.
 *
 * Keyed on the top-up id, because the redirect confirmation and the webhook
 * both call this for the same payment, routinely within the same second.
 */
const creditTopup = async ({ userId, amountMinor, topupId, reason = 'Wallet top-up' }) => {
    return applyLedgerEntry({
        userId,
        type: 'topup',
        amountMinor,
        deltas: { available: amountMinor },
        lifetime: { topped_up: amountMinor },
        idempotencyKey: `topup:${topupId}:credit`,
        topupId,
        reason,
    });
};

/**
 * Settle a refund into the wallet.
 *
 * This is the single destination for returned money in the store — card
 * orders, wallet orders, and cash on delivery alike. It is deliberately not
 * gated on the wallet feature flag: money owed to a customer must land
 * somewhere even if checkout has been switched back to the gateway, and this
 * is the only automatic destination that exists.
 */
const creditRefund = async ({ userId, amountMinor, refundId, orderId = null, reason = '', actor = {} }) => {
    return applyLedgerEntry({
        userId,
        type: 'refund_credit',
        amountMinor,
        deltas: { available: amountMinor },
        lifetime: { refunded: amountMinor },
        idempotencyKey: `refund:${refundId}:credit`,
        refundId,
        orderId,
        reason: reason || 'Refund credited to your wallet',
        actor,
    });
};

/**
 * Return money for an order that will never ship.
 *
 * Distinct from `creditRefund` so the ledger — and the customer's statement —
 * says "order cancelled" rather than implying a return was processed.
 */
const refundOrder = async ({ userId, amountMinor, orderId, reason = 'Order cancelled', idempotencyKey, actor = {} }) => {
    return applyLedgerEntry({
        userId,
        type: 'purchase_refund',
        amountMinor,
        deltas: { available: amountMinor },
        lifetime: { refunded: amountMinor },
        idempotencyKey: idempotencyKey || `order:${orderId}:wallet-refund`,
        orderId,
        reason,
        actor,
    });
};

/**
 * Take back a cancellation refund because the parcel was reactivated.
 *
 * The compensating half of `refundOrder`: the customer is buying the same goods again,
 * so the ledger says `purchase` and the statement reads "charged again for a reinstated
 * parcel" rather than a refund that quietly disappears. Atomic and overdraft-proof like
 * every other debit — if the customer has already spent the refund, this throws
 * INSUFFICIENT_BALANCE and the caller must not reactivate.
 */
const rechargeOrder = async ({ userId, amountMinor, orderId, reason = 'Parcel reinstated', idempotencyKey, actor = {} }) => {
    if (!idempotencyKey) throw new Error('rechargeOrder needs an idempotency key');
    await assertSpendable(userId);
    return applyLedgerEntry({
        userId,
        type: 'purchase',
        amountMinor,
        deltas: { available: -amountMinor },
        lifetime: { spent: amountMinor },
        idempotencyKey,
        orderId,
        reason,
        actor,
    });
};

/* ------------------------------------------------------------------ */
/*  Money out                                                         */
/* ------------------------------------------------------------------ */

/**
 * Spend wallet credit on an order.
 *
 * Called BEFORE the order document exists, mirroring how cash-on-delivery
 * spends loyalty points. That ordering is the point: if the balance moved since
 * the price preview, the conditional debit fails and no order is created. The
 * alternative — create the order, then charge — can produce an order whose
 * payment never succeeded, which is the one outcome that must be impossible.
 *
 * @param {string} reference Unique per placement attempt, so a retried
 *                           placement charges once and never twice.
 */
const chargeOrder = async ({ userId, amountMinor, reference, beneficiaryUserId = null, reason = 'Order paid from wallet' }) => {
    await assertSpendable(userId);
    return applyLedgerEntry({
        userId,
        type: 'purchase',
        amountMinor,
        deltas: { available: -amountMinor },
        lifetime: { spent: amountMinor },
        idempotencyKey: `checkout:${reference}:wallet-purchase`,
        beneficiaryUserId,
        reason,
    });
};

/** Attach a completed charge to the order it paid for, once that order exists. */
const linkChargeToOrder = async (transactionId, orderId) => {
    if (!transactionId || !orderId) return;
    await WalletTransaction.updateOne({ _id: transactionId }, { $set: { order_id: orderId } });
};

/**
 * Undo a charge whose order could not be created.
 *
 * The compensating half of `chargeOrder`. A separate ledger row rather than a
 * deletion, so the customer's statement shows the money leaving and returning
 * instead of a charge that silently vanishes.
 */
const reverseCharge = async ({ userId, amountMinor, reference, reason = 'Order could not be created' }) => {
    return applyLedgerEntry({
        userId,
        type: 'purchase_refund',
        amountMinor,
        deltas: { available: amountMinor },
        idempotencyKey: `checkout:${reference}:wallet-purchase-reversed`,
        reason,
    });
};

/* ------------------------------------------------------------------ */
/*  Admin                                                             */
/* ------------------------------------------------------------------ */

/**
 * Manually add or remove credit, always with a stated reason.
 *
 * The reason is mandatory and lands in the customer's own statement: a balance
 * that changes with no explanation is indistinguishable from a bug, and support
 * adjustments are exactly the rows a customer will ask about.
 */
const adminAdjust = async ({ userId, amount, reason, direction, actor = {} }) => {
    const amountMinor = toMinor(amount);
    if (!(amountMinor > 0)) throw walletError('INVALID_AMOUNT', 'Adjustment amount must be greater than zero');
    if (!reason || !String(reason).trim()) {
        throw walletError('REASON_REQUIRED', 'A reason is required for a manual wallet adjustment');
    }
    if (!['credit', 'debit'].includes(direction)) {
        throw walletError('INVALID_DIRECTION', 'Direction must be credit or debit');
    }

    const isCredit = direction === 'credit';
    // Timestamped and randomised so two identical corrections are two rows —
    // support genuinely does need to credit the same amount twice sometimes,
    // and collapsing that into one entry would silently swallow the second.
    const idempotencyKey = `admin:${userId}:${direction}:${Date.now()}:${new mongoose.Types.ObjectId()}`;

    const before = await getOrCreateAccount(userId);
    const beforeAvailable = toMajor(before.available_minor || 0);

    const result = await applyLedgerEntry({
        userId,
        type: isCredit ? 'admin_credit' : 'admin_debit',
        amountMinor,
        deltas: { available: isCredit ? amountMinor : -amountMinor },
        idempotencyKey,
        reason: String(reason).trim(),
        actor,
    });

    return {
        ...result,
        before: beforeAvailable,
        after: toMajor(result.account?.available_minor || 0),
    };
};

/** Put a wallet on hold, or lift the hold. Balance and history are untouched. */
const setAccountStatus = async ({ userId, status, reason = '', actor = {} }) => {
    if (!['active', 'frozen'].includes(status)) {
        throw walletError('INVALID_STATUS', 'Wallet status must be active or frozen');
    }
    const account = await getOrCreateAccount(userId);

    account.status = status;
    account.frozen_at = status === 'frozen' ? new Date() : null;
    account.frozen_reason = status === 'frozen' ? String(reason || '').trim() : '';
    account.frozen_by = status === 'frozen' ? (actor.label || 'Admin') : '';
    account.updated_at = new Date();
    await account.save();

    return account;
};

/* ------------------------------------------------------------------ */
/*  History                                                           */
/* ------------------------------------------------------------------ */

const getTransactionHistory = async (userId, { page = 1, limit = 20, type } = {}) => {
    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const filter = { user_id: userId };
    if (type) filter.type = type;

    const [rows, total] = await Promise.all([
        WalletTransaction.find(filter)
            .sort({ created_at: -1 })
            .skip((currentPage - 1) * perPage)
            .limit(perPage)
            .populate('order_id', 'transaction.reference total_price created_at')
            .lean(),
        WalletTransaction.countDocuments(filter),
    ]);

    return {
        transactions: rows.map((row) => ({
            _id: row._id,
            type: row.type,
            amount: toMajor(row.amount_minor),
            currency: row.currency || 'EGP',
            balance_after: toMajor(row.balance_after_minor),
            reason: row.reason || '',
            actor: row.actor || null,
            created_at: row.created_at,
            order: row.order_id
                ? { _id: row.order_id._id, reference: row.order_id.transaction?.reference || null }
                : null,
        })),
        pagination: {
            page: currentPage,
            limit: perPage,
            total,
            pages: Math.max(1, Math.ceil(total / perPage)),
        },
    };
};

/**
 * Everything the customer's wallet screen needs, in one round trip.
 */
const getCustomerWallet = async (userId) => {
    const settings = await getWalletSettings();
    const account = await getOrCreateAccount(userId);

    return {
        enabled: !!settings.enabled,
        topup_enabled: !!settings.topup_enabled && account.status !== 'frozen',
        online_payment_enabled: !settings.enabled || !!settings.online_payment_enabled,
        topup_suggestions: settings.topup_suggestions,
        balances: toPublicAccount(account, settings),
    };
};

/* ------------------------------------------------------------------ */
/*  Checkout helper                                                   */
/* ------------------------------------------------------------------ */

/**
 * Can this customer pay this total from the wallet, and if not, by how much are
 * they short?
 *
 * The shortfall is what the checkout screen turns into a one-tap top-up, so it
 * is computed here from integers rather than by subtracting two rounded floats
 * in the browser — a customer sent to top up "0.00" because of a rounding
 * artefact has no way forward.
 */
const evaluateOrderPayment = async ({ userId, total }) => {
    const requiredMinor = toMinor(total);
    const account = await getOrCreateAccount(userId);
    const availableMinor = account.available_minor || 0;
    const shortfallMinor = Math.max(0, requiredMinor - availableMinor);

    return {
        currency: account.currency || 'EGP',
        status: account.status,
        required: toMajor(requiredMinor),
        available: toMajor(availableMinor),
        shortfall: toMajor(shortfallMinor),
        sufficient: shortfallMinor === 0,
        required_minor: requiredMinor,
        available_minor: availableMinor,
        shortfall_minor: shortfallMinor,
    };
};

module.exports = {
    // lifecycle
    ensureIndexes,
    // conversion
    toMinor,
    toMajor,
    // settings
    DEFAULT_WALLET_SETTINGS,
    getWalletSettings,
    isWalletEnabled,
    isOnlinePaymentAllowed,
    getAvailablePaymentMethods,
    validateSettingsPatch,
    // accounts
    getOrCreateAccount,
    getBalances,
    getSpendableMinor,
    toPublicAccount,
    assertSpendable,
    // ledger
    applyLedgerEntry,
    creditTopup,
    creditRefund,
    refundOrder,
    rechargeOrder,
    chargeOrder,
    linkChargeToOrder,
    reverseCharge,
    // admin
    adminAdjust,
    setAccountStatus,
    // reads
    getTransactionHistory,
    getCustomerWallet,
    evaluateOrderPayment,
};
