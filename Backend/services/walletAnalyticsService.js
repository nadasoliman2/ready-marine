/**
 * Wallet analytics — the reporting half of the customer wallet.
 *
 * ── What this covers, and what it deliberately does not ─────────────────────────────
 * This is the CUSTOMER wallet: `WalletAccount` / `WalletTransaction` / `WalletTopup`, a
 * prepaid balance a customer buys with a card and spends at checkout.
 *
 * It is NOT the vendor "wallet". That is a different ledger with a different meaning —
 * money the store OWES a seller, built from `VendorEarning` and `WithdrawalRequest`, and
 * already reported by `financeService.getFinanceOverview().position`. The two must never be
 * summed: one is a liability we hold in cash, the other is a liability we owe out of future
 * revenue. A single "total wallet balance" across both would be a number with no meaning.
 *
 * ── Money ───────────────────────────────────────────────────────────────────────────
 * Everything is stored in MINOR units (piastres). Aggregation stays in minor units all the
 * way through and converts exactly once, at the return boundary, so no intermediate sum
 * ever carries a rounding error.
 *
 * ── Which transactions count as what ────────────────────────────────────────────────
 * Classification is by type and not by the sign of `balance_deltas.available`, because two
 * of the eight types only move money BETWEEN the available and reserved pockets of the same
 * wallet. Counting those as spending would report a checkout that was started and abandoned
 * as consumed money.
 */

const mongoose = require("mongoose");
const { WalletAccount } = require("../models/walletAccounts");
const { WalletTransaction } = require("../models/walletTransactions");
const { WalletTopup } = require("../models/walletTopups");
const { User } = require("../models/users");

const toMajor = (minor) => Number(((Number(minor) || 0) / 100).toFixed(2));
const round2 = (n) => Number((Number(n) || 0).toFixed(2));
const toObjectId = (id) => (typeof id === "string" ? new mongoose.Types.ObjectId(id) : id);

/** Money entering the wallet from outside it. */
const CREDIT_TYPES = ["topup", "purchase_refund", "refund_credit", "admin_credit"];

/** Money leaving the wallet for good. */
const DEBIT_TYPES = ["purchase", "admin_debit"];

/**
 * Movements between the available and reserved pockets of the SAME wallet. Not income, not
 * spending — a checkout holding funds and then either completing or giving them back. They
 * are excluded from every total and reported on their own, because a large release figure
 * means abandoned checkouts, which is a real signal about the funnel and not about money.
 */
const HOLD_TYPES = ["purchase_reserve", "purchase_release"];

/** Manual movements, as opposed to anything the system did on its own. */
const ADMIN_TYPES = ["admin_credit", "admin_debit"];

const dateRange = (from, to) => {
    const range = {};
    if (from) range.$gte = new Date(from);
    if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        range.$lte = end;
    }
    return Object.keys(range).length ? range : null;
};

/* ══════════════════════════════════════════════════════════════════════════════════ *
 * 1. Overview — what the wallets hold right now
 * ══════════════════════════════════════════════════════════════════════════════════ */

/** Buckets for the balance distribution, in MAJOR units. Upper bound is exclusive. */
const BALANCE_BUCKETS = [
    { key: "zero", min: 0, max: 0.01 },
    { key: "under_50", min: 0.01, max: 50 },
    { key: "50_200", min: 50, max: 200 },
    { key: "200_1000", min: 200, max: 1000 },
    { key: "over_1000", min: 1000, max: Infinity },
];

/** A wallet nobody has moved money in or out of for this long is idle, not active. */
const IDLE_AFTER_DAYS = 90;

const getWalletOverview = async () => {
    const idleBefore = new Date(Date.now() - IDLE_AFTER_DAYS * 24 * 60 * 60 * 1000);

    const [totals] = await WalletAccount.aggregate([
        {
            $group: {
                _id: null,
                accounts: { $sum: 1 },
                frozen: { $sum: { $cond: [{ $eq: ["$status", "frozen"] }, 1, 0] } },
                available: { $sum: "$available_minor" },
                reserved: { $sum: "$reserved_minor" },
                topped_up: { $sum: "$lifetime_topped_up_minor" },
                spent: { $sum: "$lifetime_spent_minor" },
                refunded: { $sum: "$lifetime_refunded_minor" },
                // Wallets that were funded at some point, as opposed to rows created by a
                // customer merely visiting the wallet page.
                ever_funded: { $sum: { $cond: [{ $gt: ["$lifetime_topped_up_minor", 0] }, 1, 0] } },
                with_balance: { $sum: { $cond: [{ $gt: ["$available_minor", 0] }, 1, 0] } },
                zero_balance: { $sum: { $cond: [{ $lte: ["$available_minor", 0] }, 1, 0] } },
            },
        },
    ]);

    // Distribution, computed from the same collection in one pass rather than five counts.
    const distributionRows = await WalletAccount.aggregate([
        {
            $bucket: {
                groupBy: "$available_minor",
                boundaries: [0, 1, 5000, 20000, 100000],
                default: "over_1000",
                output: { wallets: { $sum: 1 }, balance: { $sum: "$available_minor" } },
            },
        },
    ]);
    const bucketKeyFor = (id) =>
        ({ 0: "zero", 1: "under_50", 5000: "50_200", 20000: "200_1000" }[id] || "over_1000");
    const distribution = BALANCE_BUCKETS.map((b) => {
        const row = distributionRows.find((r) => bucketKeyFor(r._id) === b.key);
        return {
            bucket: b.key,
            wallets: row?.wallets || 0,
            balance: toMajor(row?.balance || 0),
        };
    });

    // Activity is a property of the LEDGER, not of the account row: `updated_at` moves for
    // reasons that are not money (a freeze, a settings migration), so asking the ledger is
    // the only way to say "this wallet has actually been used lately".
    const [activity] = await WalletTransaction.aggregate([
        { $match: { created_at: { $gte: idleBefore } } },
        { $group: { _id: "$account_id" } },
        { $count: "active" },
    ]);

    const accounts = totals?.accounts || 0;
    const available = totals?.available || 0;
    const toppedUp = totals?.topped_up || 0;

    return {
        as_of: new Date(),
        accounts,
        frozen_accounts: totals?.frozen || 0,
        funded_accounts: totals?.ever_funded || 0,
        // "Active" means money moved in the window, not merely that the row exists.
        active_accounts: activity?.active || 0,
        idle_after_days: IDLE_AFTER_DAYS,

        available: toMajor(available),
        // Held against a checkout in flight. Still the customer's money, not spendable.
        reserved: toMajor(totals?.reserved || 0),
        // What the store would owe if every customer asked for their balance back today.
        outstanding_liability: toMajor(available + (totals?.reserved || 0)),

        lifetime_topped_up: toMajor(toppedUp),
        lifetime_spent: toMajor(totals?.spent || 0),
        lifetime_refunded: toMajor(totals?.refunded || 0),

        wallets_with_balance: totals?.with_balance || 0,
        wallets_zero_balance: totals?.zero_balance || 0,
        average_balance: accounts > 0 ? toMajor(available / accounts) : 0,

        /**
         * How much of everything ever put into wallets has been spent. The honest reading of
         * "utilisation": with no top-ups it is null rather than 0, because zero would claim
         * nothing is being used when in fact nothing exists to use.
         */
        utilisation_rate: toppedUp > 0 ? round2(((totals?.spent || 0) / toppedUp) * 100) : null,

        distribution,
    };
};

/* ══════════════════════════════════════════════════════════════════════════════════ *
 * 2. Top-ups — how balance gets bought
 * ══════════════════════════════════════════════════════════════════════════════════ */

const getTopupAnalytics = async ({ from, to, topLimit = 10 } = {}) => {
    const range = dateRange(from, to);
    const match = range ? { created_at: range } : {};

    const [byStatus, byMethod, topRows, [paidTotals]] = await Promise.all([
        WalletTopup.aggregate([
            { $match: match },
            { $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$amount_minor" } } },
            { $sort: { count: -1 } },
        ]),
        // Only paid top-ups carry a method: the gateway reports it on settlement, so an
        // abandoned attempt has none and would otherwise show up as a "null" method.
        WalletTopup.aggregate([
            { $match: { ...match, status: "paid" } },
            {
                $group: {
                    _id: { $ifNull: ["$payment_method", "unknown"] },
                    count: { $sum: 1 },
                    amount: { $sum: "$amount_minor" },
                },
            },
            { $sort: { amount: -1 } },
        ]),
        WalletTopup.aggregate([
            { $match: { ...match, status: "paid" } },
            { $group: { _id: "$user_id", count: { $sum: 1 }, amount: { $sum: "$amount_minor" } } },
            { $sort: { amount: -1 } },
            { $limit: topLimit },
        ]),
        WalletTopup.aggregate([
            { $match: { ...match, status: "paid" } },
            {
                $group: {
                    _id: null,
                    count: { $sum: 1 },
                    amount: { $sum: "$amount_minor" },
                    customers: { $addToSet: "$user_id" },
                    largest: { $max: "$amount_minor" },
                    smallest: { $min: "$amount_minor" },
                },
            },
        ]),
    ]);

    const topUsers = await attachUsers(topRows);

    const statusMap = byStatus.reduce((acc, r) => {
        acc[r._id] = { count: r.count, amount: toMajor(r.amount) };
        return acc;
    }, {});

    const attempted = byStatus.reduce((n, r) => n + r.count, 0);
    const paidCount = paidTotals?.count || 0;
    const customers = (paidTotals?.customers || []).length;

    return {
        // Money actually collected. `paid_credit_failed` is money the gateway TOOK and the
        // wallet never received — it is counted as attempted, never as collected, and the
        // exceptions queue in the wallet screen is where it gets resolved.
        collected: toMajor(paidTotals?.amount || 0),
        count: paidCount,
        attempted,
        // Of everything started, how much reached the wallet. The number that says whether
        // the payment flow itself is healthy.
        success_rate: attempted > 0 ? round2((paidCount / attempted) * 100) : null,
        average_value: paidCount > 0 ? toMajor((paidTotals?.amount || 0) / paidCount) : 0,
        largest: toMajor(paidTotals?.largest || 0),
        smallest: toMajor(paidTotals?.smallest || 0),
        customers,
        // How often a paying customer comes back to top up inside this window.
        purchases_per_customer: customers > 0 ? round2(paidCount / customers) : 0,
        by_status: statusMap,
        by_payment_method: byMethod.map((r) => ({
            method: r._id,
            count: r.count,
            amount: toMajor(r.amount),
        })),
        top_customers: topUsers,
    };
};

/* ══════════════════════════════════════════════════════════════════════════════════ *
 * 3. Consumption — how balance gets spent
 * ══════════════════════════════════════════════════════════════════════════════════ */

const getConsumptionAnalytics = async ({ from, to, topLimit = 10 } = {}) => {
    const range = dateRange(from, to);
    const match = range ? { created_at: range } : {};

    const [byType, topRows, [spendTotals], [holdTotals]] = await Promise.all([
        WalletTransaction.aggregate([
            { $match: match },
            { $group: { _id: "$type", count: { $sum: 1 }, amount: { $sum: "$amount_minor" } } },
            { $sort: { amount: -1 } },
        ]),
        WalletTransaction.aggregate([
            { $match: { ...match, type: { $in: DEBIT_TYPES } } },
            { $group: { _id: "$user_id", count: { $sum: 1 }, amount: { $sum: "$amount_minor" } } },
            { $sort: { amount: -1 } },
            { $limit: topLimit },
        ]),
        WalletTransaction.aggregate([
            { $match: { ...match, type: { $in: DEBIT_TYPES } } },
            {
                $group: {
                    _id: null,
                    count: { $sum: 1 },
                    amount: { $sum: "$amount_minor" },
                    wallets: { $addToSet: "$account_id" },
                    largest: { $max: "$amount_minor" },
                },
            },
        ]),
        WalletTransaction.aggregate([
            { $match: { ...match, type: "purchase_release" } },
            { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$amount_minor" } } },
        ]),
    ]);

    const topUsers = await attachUsers(topRows);
    const spentCount = spendTotals?.count || 0;
    const spent = spendTotals?.amount || 0;

    const typeMap = byType.reduce((acc, r) => {
        acc[r._id] = { count: r.count, amount: toMajor(r.amount) };
        return acc;
    }, {});

    const credited = CREDIT_TYPES.reduce((n, t) => n + (typeMap[t]?.amount || 0), 0);

    return {
        spent: toMajor(spent),
        count: spentCount,
        average_value: spentCount > 0 ? toMajor(spent / spentCount) : 0,
        largest: toMajor(spendTotals?.largest || 0),
        spending_wallets: (spendTotals?.wallets || []).length,

        // Everything that came IN over the same window, so the two sides of the period can
        // be read against each other without a second call.
        credited: round2(credited),
        net_change: round2(credited - toMajor(spent)),

        /**
         * Held for a checkout and then given back — an abandoned or failed checkout. Kept
         * out of every money total on purpose and reported here, because a rising number is
         * a checkout problem and reading it as spending would hide that.
         */
        released_holds: { count: holdTotals?.count || 0, amount: toMajor(holdTotals?.amount || 0) },

        by_type: typeMap,
        top_customers: topUsers,
    };
};

/* ══════════════════════════════════════════════════════════════════════════════════ *
 * 4. Trend — the two sides of the wallet, month by month
 * ══════════════════════════════════════════════════════════════════════════════════ */

/**
 * Credits and debits bucketed by month, plus the running balance those movements imply.
 *
 * The running balance is derived by walking FORWARD from the earliest bucket rather than by
 * reading `available_minor` per month, because the account row only ever holds today's
 * figure — there is no history of it anywhere. That makes this an approximation of the
 * closing balance for each month, exact at the final one, and it is labelled as derived so
 * nobody reconciles a bank statement against it.
 */
const getWalletTrend = async ({ months = 12 } = {}) => {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCMonth(start.getUTCMonth() - (Number(months) - 1));

    const rows = await WalletTransaction.aggregate([
        { $match: { created_at: { $gte: start } } },
        {
            $group: {
                _id: {
                    y: { $year: "$created_at" },
                    m: { $month: "$created_at" },
                    type: "$type",
                },
                amount: { $sum: "$amount_minor" },
                count: { $sum: 1 },
            },
        },
    ]);

    // Everything that moved BEFORE the window, so the first bucket does not open at zero.
    const [before] = await WalletTransaction.aggregate([
        { $match: { created_at: { $lt: start } } },
        {
            $group: {
                _id: null,
                credited: {
                    $sum: { $cond: [{ $in: ["$type", CREDIT_TYPES] }, "$amount_minor", 0] },
                },
                debited: {
                    $sum: { $cond: [{ $in: ["$type", DEBIT_TYPES] }, "$amount_minor", 0] },
                },
            },
        },
    ]);

    const buckets = new Map();
    for (let i = 0; i < Number(months); i += 1) {
        const d = new Date(start);
        d.setUTCMonth(d.getUTCMonth() + i);
        buckets.set(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`, {
            month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
            credited: 0,
            debited: 0,
            topups: 0,
            transactions: 0,
        });
    }

    for (const row of rows) {
        const bucket = buckets.get(`${row._id.y}-${row._id.m}`);
        if (!bucket) continue;
        bucket.transactions += row.count;
        if (CREDIT_TYPES.includes(row._id.type)) bucket.credited += row.amount;
        if (DEBIT_TYPES.includes(row._id.type)) bucket.debited += row.amount;
        if (row._id.type === "topup") bucket.topups += row.amount;
    }

    let running = (before?.credited || 0) - (before?.debited || 0);
    return [...buckets.values()].map((b) => {
        running += b.credited - b.debited;
        return {
            month: b.month,
            credited: toMajor(b.credited),
            debited: toMajor(b.debited),
            topups: toMajor(b.topups),
            transactions: b.transactions,
            net: toMajor(b.credited - b.debited),
            // Derived, not observed — see the note on this function.
            closing_balance: toMajor(running),
        };
    });
};

/* ══════════════════════════════════════════════════════════════════════════════════ *
 * 5. The ledger — every movement, searchable
 * ══════════════════════════════════════════════════════════════════════════════════ */

const LEDGER_SORTS = {
    newest: { created_at: -1 },
    oldest: { created_at: 1 },
    largest: { amount_minor: -1 },
    smallest: { amount_minor: 1 },
};

/**
 * One page of the wallet ledger across every customer.
 *
 * `search` matches the customer (name, phone, email) and the transaction's own identifiers
 * (reason, idempotency key). The customer lookup runs first and narrows by id, rather than
 * joining every transaction to its user and filtering after — on a ledger this is the
 * difference between an index scan and a full collection walk.
 */
const listWalletLedger = async ({
    search = "",
    type = "",
    actor = "",
    from,
    to,
    userId = "",
    minAmount = null,
    maxAmount = null,
    sort = "newest",
    page = 1,
    limit = 25,
} = {}) => {
    const filter = {};

    const range = dateRange(from, to);
    if (range) filter.created_at = range;

    if (type) filter.type = { $in: String(type).split(",").filter(Boolean) };
    if (userId && mongoose.Types.ObjectId.isValid(userId)) filter.user_id = toObjectId(userId);

    // "Who did this" — the distinction the audit requirement turns on. `actor.role` is
    // written on every row, so this needs no heuristics about the type.
    if (actor === "admin") filter["actor.role"] = "admin";
    else if (actor === "system") filter["actor.role"] = { $ne: "admin" };

    if (minAmount !== null && minAmount !== "") filter.amount_minor = { $gte: Math.round(Number(minAmount) * 100) };
    if (maxAmount !== null && maxAmount !== "") {
        filter.amount_minor = { ...(filter.amount_minor || {}), $lte: Math.round(Number(maxAmount) * 100) };
    }

    const term = String(search || "").trim();
    if (term) {
        const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        const users = await User.find({ $or: [{ name: rx }, { phone: rx }, { email: rx }] })
            .select("_id")
            .limit(500)
            .lean();
        const ids = users.map((u) => u._id);
        filter.$or = [{ reason: rx }, { idempotency_key: rx }, ...(ids.length ? [{ user_id: { $in: ids } }] : [])];
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const perPage = Math.min(200, Math.max(1, Number(limit) || 25));

    const [total, rows, [totals]] = await Promise.all([
        WalletTransaction.countDocuments(filter),
        WalletTransaction.find(filter)
            .sort(LEDGER_SORTS[sort] || LEDGER_SORTS.newest)
            .skip((pageNum - 1) * perPage)
            .limit(perPage)
            .populate("user_id", "name phone email")
            .lean(),
        // Totals for the WHOLE filtered set, not just the page on screen — a filter that
        // shows 25 of 4,000 rows is useless if the figure under it only adds up those 25.
        WalletTransaction.aggregate([
            { $match: filter },
            {
                $group: {
                    _id: null,
                    credited: { $sum: { $cond: [{ $in: ["$type", CREDIT_TYPES] }, "$amount_minor", 0] } },
                    debited: { $sum: { $cond: [{ $in: ["$type", DEBIT_TYPES] }, "$amount_minor", 0] } },
                    held: { $sum: { $cond: [{ $in: ["$type", HOLD_TYPES] }, "$amount_minor", 0] } },
                },
            },
        ]),
    ]);

    return {
        transactions: rows.map(shapeLedgerRow),
        totals: {
            credited: toMajor(totals?.credited || 0),
            debited: toMajor(totals?.debited || 0),
            held: toMajor(totals?.held || 0),
            net: toMajor((totals?.credited || 0) - (totals?.debited || 0)),
        },
        pagination: {
            total,
            page: pageNum,
            limit: perPage,
            pages: Math.max(1, Math.ceil(total / perPage)),
        },
    };
};

const shapeLedgerRow = (t) => ({
    _id: t._id,
    created_at: t.created_at,
    type: t.type,
    direction: CREDIT_TYPES.includes(t.type) ? "credit" : DEBIT_TYPES.includes(t.type) ? "debit" : "hold",
    amount: toMajor(t.amount_minor),
    currency: t.currency || "EGP",
    balance_after: toMajor(t.balance_after_minor),
    // The available pocket before this row, re-derived rather than stored: the model keeps
    // the closing balance and the delta, and the opening balance is the difference.
    balance_before: toMajor((t.balance_after_minor || 0) - (t.balance_deltas?.available || 0)),
    deltas: {
        available: toMajor(t.balance_deltas?.available || 0),
        reserved: toMajor(t.balance_deltas?.reserved || 0),
    },
    customer: t.user_id
        ? { _id: t.user_id._id, name: t.user_id.name, phone: t.user_id.phone, email: t.user_id.email || "" }
        : null,
    order_id: t.order_id || null,
    topup_id: t.topup_id || null,
    refund_id: t.refund_id || null,
    reason: t.reason || "",
    actor: { role: t.actor?.role || "system", label: t.actor?.label || "System" },
    is_manual: ADMIN_TYPES.includes(t.type),
    // The business identity of the movement — what makes a repeated webhook a no-op, and
    // what an investigation traces a balance change back through.
    reference: t.idempotency_key,
});

/* ══════════════════════════════════════════════════════════════════════════════════ *
 * 6. Reconciliation — does the ledger still agree with the balances?
 * ══════════════════════════════════════════════════════════════════════════════════ */

/**
 * Re-add every movement per wallet and compare the result with the stored balance.
 *
 * The account row carries cached counters that every write updates alongside the ledger.
 * The ledger is the source of truth; the counters are what the app reads. Nothing keeps
 * them honest except the code that writes both, so this asks the question directly: if a
 * balance ever changed without a matching row, it shows up here and nowhere else.
 *
 * This is the check behind "prevent unexplained balance changes" — the requirement cannot
 * be met by an audit log alone, because a log records what asked to happen and this records
 * whether the money agrees.
 */
const reconcileWallets = async ({ limit = 50 } = {}) => {
    const rows = await WalletTransaction.aggregate([
        {
            $group: {
                _id: "$account_id",
                derived: { $sum: "$balance_deltas.available" },
                movements: { $sum: 1 },
                last_at: { $max: "$created_at" },
            },
        },
        {
            $lookup: {
                from: "walletaccounts",
                localField: "_id",
                foreignField: "_id",
                as: "acct",
            },
        },
        { $unwind: "$acct" },
        {
            $addFields: {
                stored: "$acct.available_minor",
                drift: { $subtract: ["$acct.available_minor", "$derived"] },
            },
        },
        { $match: { drift: { $ne: 0 } } },
        { $sort: { drift: -1 } },
        { $limit: Math.min(500, Number(limit) || 50) },
        {
            $lookup: {
                from: "users",
                localField: "acct.user_id",
                foreignField: "_id",
                as: "user",
            },
        },
        { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
    ]);

    const [scope] = await WalletTransaction.aggregate([
        { $group: { _id: "$account_id" } },
        { $count: "wallets" },
    ]);

    return {
        checked: scope?.wallets || 0,
        mismatched: rows.length,
        // Empty is the expected and healthy answer. Anything here is money that moved
        // without a row explaining it, and it is a bug, not a report.
        wallets: rows.map((r) => ({
            user_id: r.acct.user_id,
            customer: r.user ? { name: r.user.name, phone: r.user.phone } : null,
            stored_balance: toMajor(r.stored),
            ledger_balance: toMajor(r.derived),
            drift: toMajor(r.drift),
            movements: r.movements,
            last_movement_at: r.last_at,
        })),
    };
};

/* ══════════════════════════════════════════════════════════════════════════════════ *
 * Shared helpers
 * ══════════════════════════════════════════════════════════════════════════════════ */

/** Turn `{_id: userId, count, amount}` rows into rows carrying the customer. */
const attachUsers = async (rows) => {
    if (!rows.length) return [];
    const users = await User.find({ _id: { $in: rows.map((r) => r._id) } })
        .select("name phone email")
        .lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    return rows.map((r) => {
        const u = byId.get(String(r._id));
        return {
            user_id: r._id,
            name: u?.name || "—",
            phone: u?.phone || "",
            email: u?.email || "",
            count: r.count,
            amount: toMajor(r.amount),
        };
    });
};

/* ══════════════════════════════════════════════════════════════════════════════════ *
 * The one call the dashboard makes
 * ══════════════════════════════════════════════════════════════════════════════════ */

/**
 * Everything the wallet screen needs, in one round trip.
 *
 * The pieces run in parallel because none of them reads another's output — the screen is
 * five independent questions about the same collections, and issuing them one after another
 * would make the slowest one the sum of all five.
 */
const getWalletDashboard = async ({ from, to, months = 12 } = {}) => {
    const [overview, topups, consumption, trend, reconciliation] = await Promise.all([
        getWalletOverview(),
        getTopupAnalytics({ from, to }),
        getConsumptionAnalytics({ from, to }),
        getWalletTrend({ months }),
        reconcileWallets({ limit: 20 }),
    ]);

    return {
        overview,
        topups,
        consumption,
        trend,
        reconciliation,
        /**
         * The lifecycle, as one row of figures that are meant to be read left to right:
         * bought → added → available → spent → left. Lifetime, never a period, because a
         * balance is a running total and slicing it by date would produce a "remaining"
         * that never matches the wallet the customer sees.
         */
        flow: {
            purchased: overview.lifetime_topped_up,
            refunded_in: overview.lifetime_refunded,
            spent: overview.lifetime_spent,
            reserved: overview.reserved,
            remaining: overview.available,
        },
        period: { from: from || null, to: to || null },
    };
};

module.exports = {
    getWalletOverview,
    getTopupAnalytics,
    getConsumptionAnalytics,
    getWalletTrend,
    listWalletLedger,
    reconcileWallets,
    getWalletDashboard,
    CREDIT_TYPES,
    DEBIT_TYPES,
    HOLD_TYPES,
    ADMIN_TYPES,
};
