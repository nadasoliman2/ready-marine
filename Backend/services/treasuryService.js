/**
 * Treasury Service — where the money actually is, and what came in each month.
 *
 * THE QUESTION. The P&L says whether the business made money. It does not say where that
 * money is sitting, and for this business it is sitting in four different places at once:
 *
 *   customer wallets   cash customers have already given us and have not spent yet. Ours to
 *                      hold, NOT ours to keep — the only figure here that is a liability.
 *   Fawaterak          card payments collected and not yet transferred to the bank.
 *   Paymob             the same, at the other gateway.
 *   couriers           COD collected at the door, held until the courier's payout run.
 *
 * Each is money that exists and is not in the bank, and none of them appeared anywhere
 * before this module. They are reported side by side and NEVER summed into one figure: three
 * of them are money owed TO us and one is money we owe OUT, and a single total would be the
 * difference of two unrelated things.
 *
 * HOW A GATEWAY BALANCE IS DERIVED. Everything the gateway collected for us, net of the fee
 * it kept on each payment, minus every transfer we have recorded as received. Four separate
 * flows pay through the same gateways — customer orders, wallet top-ups, vendor
 * subscriptions and packaging sales — and all four are counted, because all four are money
 * the gateway is holding.
 *
 * DOUBLE COUNTING, AND THE ONE PLACE IT WOULD HAPPEN. An order paid from a wallet brings in
 * no new money: the cash arrived earlier, as a top-up. So wallet-paid orders are reported in
 * the monthly sales table (they are sales) and excluded from every "cash that came in"
 * figure (they are not income twice). Every method is labelled with which of the two it is.
 */

const mongoose = require("mongoose");

const { Order } = require("../models/orders");
const { OrderPayment } = require("../models/orderPayments");
const { SubscriptionPayment } = require("../models/subscriptionPayments");
const { WalletTopup } = require("../models/walletTopups");
const { SupplyOrder } = require("../models/supplyOrders");
const { WalletAccount } = require("../models/walletAccounts");
const { GatewayPayout } = require("../models/gatewayPayouts");
const { recordAuditLog } = require("../models/auditLog");
const { gatewayFeeFor } = require("./shared/gatewayFee");

const round2 = (n) => Number((Number(n) || 0).toFixed(2));

/** Gateways the screens always show, even at zero — a missing row reads as "no data". */
const GATEWAYS = ["fawaterak", "paymob"];

const GATEWAY_LABELS = { fawaterak: "فواتيرك", paymob: "Paymob" };

/**
 * The four flows that pay through a gateway, described once.
 *
 * Every one of them stores the same four facts in a different shape — top-ups keep piastres,
 * supplies nest the whole payment block — so the differences live here and nothing
 * downstream has to know them.
 */
const PAYMENT_SOURCES = [
    {
        key: "orders",
        label: { ar: "أوردرات", en: "Orders" },
        model: OrderPayment,
        match: { status: "paid" },
        dateField: "paid_at",
        select: "paid_at amount provider webhook_payloads",
        amount: (d) => Number(d.amount || 0),
        provider: (d) => d.provider || "fawaterak",
        at: (d) => d.paid_at,
        payloads: (d) => d.webhook_payloads,
    },
    {
        key: "topups",
        label: { ar: "شحن محافظ", en: "Wallet top-ups" },
        model: WalletTopup,
        match: { status: "paid" },
        dateField: "paid_at",
        select: "paid_at amount_minor provider webhook_payloads",
        // Wallets are kept in piastres so a balance can never drift; money is reported in pounds.
        amount: (d) => Number(d.amount_minor || 0) / 100,
        provider: (d) => d.provider || "fawaterak",
        at: (d) => d.paid_at,
        payloads: (d) => d.webhook_payloads,
    },
    {
        key: "subscriptions",
        label: { ar: "اشتراكات تجار", en: "Vendor subscriptions" },
        model: SubscriptionPayment,
        match: { status: "paid" },
        dateField: "paid_at",
        select: "paid_at amount provider webhook_payloads",
        amount: (d) => Number(d.amount || 0),
        provider: (d) => d.provider || "fawaterak",
        at: (d) => d.paid_at,
        payloads: (d) => d.webhook_payloads,
    },
    {
        key: "supplies",
        label: { ar: "مستلزمات تغليف", en: "Packaging supplies" },
        model: SupplyOrder,
        match: { payment_status: "paid" },
        dateField: "payment.paid_at",
        select: "payment total",
        amount: (d) => Number(d.total || 0),
        provider: (d) => d.payment?.provider || "fawaterak",
        at: (d) => d.payment?.paid_at,
        payloads: (d) => d.payment?.webhook_payloads,
    },
];

/* ------------------------------------------------------------------ */
/*  Where the money is right now                                      */
/* ------------------------------------------------------------------ */

const emptyGateway = (provider) => ({
    provider,
    label: GATEWAY_LABELS[provider] || provider,
    payments: 0,
    collected: 0,
    fees: 0,
    net: 0,
    paid_out: 0,
    held: 0,
    // Payments whose confirmation carried no fee figure but were priced off the provider's
    // published rate (Fawaterak: 2% + 2 EGP plus VAT). In `fees`, and counted here so the
    // screen can say which part of the balance is tariff rather than statement.
    estimated_fees: 0,
    // Payments with no fee figure AND no rate to price them by. Counted rather than
    // assumed to be free, so `held` reads as "at least this much" rather than as exact.
    unpriced_fees: 0,
    last_payout_at: null,
    by_source: {},
});

/**
 * What each gateway is holding for us: collected, less its fees, less what it has sent.
 *
 * Streamed rather than aggregated because the fee is not a field — it lives inside the
 * provider's confirmation payload and has to be read out of it per payment.
 *
 * `until` gives the position as it stood at that moment — payments and transfers after it
 * are left out — for a report dated in the past. Without it, the position is today's.
 */
const getGatewayPositions = async ({ until = null } = {}) => {
    const dated = until ? { $ne: null, $lte: until } : { $ne: null };
    const positions = new Map(GATEWAYS.map((g) => [g, emptyGateway(g)]));
    const ensure = (provider) => {
        if (!positions.has(provider)) positions.set(provider, emptyGateway(provider));
        return positions.get(provider);
    };

    for (const source of PAYMENT_SOURCES) {
        const cursor = source.model
            .find({ ...source.match, [source.dateField]: dated })
            .select(source.select)
            .lean()
            .cursor();

        for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
            const pos = ensure(source.provider(doc));
            const amount = source.amount(doc);
            const { fee, estimated } = gatewayFeeFor({
                payloads: source.payloads(doc), amount, provider: source.provider(doc),
            });

            pos.payments += 1;
            pos.collected = round2(pos.collected + amount);
            if (fee === null) pos.unpriced_fees += 1;
            else {
                pos.fees = round2(pos.fees + fee);
                if (estimated) pos.estimated_fees += 1;
            }

            const bucket = pos.by_source[source.key] || { amount: 0, payments: 0 };
            bucket.amount = round2(bucket.amount + amount);
            bucket.payments += 1;
            pos.by_source[source.key] = bucket;
        }
    }

    const payouts = await GatewayPayout.aggregate([
        ...(until ? [{ $match: { received_at: { $lte: until } } }] : []),
        { $group: { _id: "$provider", amount: { $sum: "$amount" }, count: { $sum: 1 }, last: { $max: "$received_at" } } },
    ]);
    for (const row of payouts) {
        const pos = ensure(row._id);
        pos.paid_out = round2(row.amount);
        pos.payouts_count = row.count;
        pos.last_payout_at = row.last;
    }

    for (const pos of positions.values()) {
        pos.net = round2(pos.collected - pos.fees);
        pos.held = round2(pos.net - pos.paid_out);
    }

    return [...positions.values()].sort((a, b) => b.held - a.held);
};

/**
 * What customers are holding in their wallets.
 *
 * The one figure on this screen that points the other way: it is cash we already took and
 * still owe in goods, so it is labelled a liability everywhere it appears. `reserved` is the
 * part locked by a checkout in flight — still the customer's, and already spoken for.
 */
const getWalletPosition = async () => {
    const [row] = await WalletAccount.aggregate([
        {
            $group: {
                _id: null,
                available: { $sum: "$available_minor" },
                reserved: { $sum: "$reserved_minor" },
                accounts: { $sum: 1 },
                funded: { $sum: { $cond: [{ $gt: ["$available_minor", 0] }, 1, 0] } },
                frozen: { $sum: { $cond: [{ $eq: ["$status", "frozen"] }, 1, 0] } },
            },
        },
    ]);

    const [corporate] = await require('../models/companies').Company.aggregate([
        // Wallet companies, and one on an invoice that still has something in the wallet
        // it used to pay from.
        { $match: { $or: [{ billing_mode: { $in: require('./companyWalletService').WALLET_MODES } }, { wallet_balance_minor: { $nin: [0, null] } }] } },
        { $group: {
            _id: null,
            available: { $sum: { $max: ['$wallet_balance_minor', 0] } },
            owed: { $sum: { $max: [{ $multiply: ['$wallet_balance_minor', -1] }, 0] } },
            accounts: { $sum: 1 },
            funded: { $sum: { $cond: [{ $gt: ['$wallet_balance_minor', 0] }, 1, 0] } },
        } },
    ]);
    const available = round2(((row?.available || 0) + (corporate?.available || 0)) / 100);
    const reserved = round2((row?.reserved || 0) / 100);

    return {
        available,
        reserved,
        total: round2(available + reserved),
        accounts: (row?.accounts || 0) + (corporate?.accounts || 0),
        company_available: round2((corporate?.available || 0) / 100),
        company_owed: round2((corporate?.owed || 0) / 100),
        funded_accounts: (row?.funded || 0) + (corporate?.funded || 0),
        frozen_accounts: row?.frozen || 0,
    };
};

/**
 * Everything customers have ever paid us, and where it went.
 *
 * The screen's other figures answer "what is still on its way to the bank". This answers
 * the question before it: of all the money paid, how much has LANDED in the bank, how much
 * is still outside it, and how much the gateways and couriers kept as their fees on the
 * way. The three always add up to the total, so the fees are derived for the couriers
 * (collected, less what they transferred, less what they still hold) rather than re-priced.
 *
 * Wallet-paid orders are not here: that cash arrived earlier, as a top-up through a
 * gateway, and is counted there. Company-account orders are counted when the company's
 * transfer is confirmed — until then nobody has paid anything.
 */
const getPaidOverview = async ({ gateways, courierCash }) => {
    // Cash on delivery, ever: every delivered parcel of a cash order.
    let codCollected = 0;
    let codParcels = 0;
    const cashCursor = Order.find({ "transaction.payment_method": "cash", "sub_orders.status": "delivered" })
        .select("sub_orders.status sub_orders.cod_amount")
        .lean()
        .cursor();
    for (let order = await cashCursor.next(); order != null; order = await cashCursor.next()) {
        for (const sub of order.sub_orders || []) {
            if (sub.status !== "delivered") continue;
            const cod = Number(sub.cod_amount || 0);
            if (!(cod > 0)) continue;
            codCollected = round2(codCollected + cod);
            codParcels += 1;
        }
    }

    // Transfers made straight to the bank: confirmed company-invoice payments, and orders
    // paid by bank transfer.
    const { CompanyPayment } = require("../models/companyInvoices");
    const [companyRow] = await CompanyPayment.aggregate([
        { $match: { status: "confirmed", kind: { $ne: "credit" } } },
        { $group: { _id: null, amount: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]);
    const [transferRow] = await Order.aggregate([
        { $match: { "transaction.payment_method": "bank_transfer", "transaction.status": "paid", status: { $ne: "cancelled" } } },
        { $group: { _id: null, amount: { $sum: "$transaction.amount" }, count: { $sum: 1 } } },
    ]);

    const sum = (list, key) => round2(list.reduce((s, x) => s + Number(x[key] || 0), 0));
    const gateway = {
        collected: sum(gateways, "collected"),
        fees: sum(gateways, "fees"),
        in_bank: sum(gateways, "paid_out"),
        outside_bank: sum(gateways, "held"),
        payments: gateways.reduce((s, g) => s + (g.payments || 0), 0),
    };
    const courierInBank = round2(courierCash.totals.settled);
    const courierOutside = round2(courierCash.totals.outstanding);
    const courier = {
        collected: codCollected,
        in_bank: courierInBank,
        outside_bank: courierOutside,
        // What the couriers kept for delivering: never below zero, in case a transfer was
        // recorded for more than the parcels it covered.
        fees: round2(Math.max(0, codCollected - courierInBank - courierOutside)),
        parcels: codParcels,
    };
    const company = { collected: round2(companyRow?.amount || 0), payments: companyRow?.count || 0 };
    const bankTransfers = { collected: round2(transferRow?.amount || 0), orders: transferRow?.count || 0 };

    const inBank = round2(gateway.in_bank + courier.in_bank + company.collected + bankTransfers.collected);
    const outsideBank = round2(gateway.outside_bank + courier.outside_bank);
    const fees = round2(gateway.fees + courier.fees);
    return {
        // Total = in the bank + outside the bank + fees kept on the way.
        total: round2(inBank + outsideBank + fees),
        in_bank: inBank,
        outside_bank: outsideBank,
        fees_kept: fees,
        by_channel: { gateways: gateway, couriers: courier, company_invoices: company, bank_transfers: bankTransfers },
    };
};

/**
 * Every place money is sitting, in one answer.
 *
 * `owed_to_us` adds only the two that are genuinely owed TO us — the gateways and the
 * couriers. Wallets are kept out of it and reported on their own, because adding money we
 * owe to money we are owed produces a number that describes nothing.
 */
const getMoneyMap = async () => {
    const [wallets, gateways, courierCash, companies] = await Promise.all([
        getWalletPosition(),
        getGatewayPositions(),
        require("./courierSettlementService").getCashPositions(),
        // Company accounts (feature 14): credit we extended, billed monthly. Reported on its
        // own and kept out of `owed_to_us`, which is money a third party is HOLDING for us —
        // this is money a customer has not paid yet.
        require("./companyInvoiceService").receivables().catch(() => null),
    ]);

    const gatewayHeld = round2(gateways.reduce((s, g) => s + g.held, 0));
    const courierHeld = round2(courierCash.totals.outstanding);
    const paid = await getPaidOverview({ gateways, courierCash });

    return {
        as_of: new Date(),
        wallets,
        gateways,
        couriers: courierCash.couriers,
        companies,
        paid,
        totals: {
            at_gateways: gatewayHeld,
            at_couriers: courierHeld,
            owed_to_us: round2(gatewayHeld + courierHeld),
            owed_to_customers: wallets.total,
            owed_by_companies: companies ? round2(companies.invoiced_outstanding + companies.not_yet_invoiced) : 0,
        },
    };
};

/* ------------------------------------------------------------------ */
/*  The monthly picture                                               */
/* ------------------------------------------------------------------ */

/**
 * How an order's money reached us. Finer than `payment_method` on purpose: "card" is not one
 * answer when two gateways hold the money in two different accounts.
 */
const methodKey = (transaction) => {
    const method = transaction?.payment_method || "";
    if (method === "cash") return "cash";
    if (method === "wallet") return "wallet";
    if (method === "bank_transfer") return "bank_transfer";
    // Sold on a company's account: billed on its monthly invoice (feature 14). Any part
    // the employee paid by card still arrives through the gateway and is counted there.
    if (method === "company_account") return "company";
    const provider = String(transaction?.provider || "").toLowerCase();
    if (provider === "paymob") return "card_paymob";
    if (provider === "fawaterak") return "card_fawaterak";
    return "card_other";
};

const METHOD_LABELS = {
    cash: { ar: "كاش عند الاستلام", en: "Cash on delivery" },
    card_fawaterak: { ar: "كارت — فواتيرك", en: "Card — Fawaterak" },
    card_paymob: { ar: "كارت — Paymob", en: "Card — Paymob" },
    card_other: { ar: "كارت — غير محدد", en: "Card — unattributed" },
    wallet: { ar: "محفظة", en: "Wallet" },
    bank_transfer: { ar: "تحويل بنكي", en: "Bank transfer" },
    company: { ar: "حساب شركة (فاتورة شهرية)", en: "Company account (monthly invoice)" },
};

/** `YYYY-MM` in LOCAL time — the same basis `financeService` buckets by, for the same reason. */
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const emptyMonth = (key, from, to) => ({
    month: key,
    from,
    to,
    // What was SOLD: orders placed this month, whatever happened to the money afterwards.
    sold: { total: 0, orders: 0, by_method: {} },
    // What ARRIVED: money that actually reached a gateway or a courier this month. A cash
    // order counts on the day it was delivered, a card order on the day it was paid.
    collected: { total: 0, by_method: {}, by_source: {} },
});

/**
 * Month by month: what was sold, how it was paid for, and what money actually arrived.
 *
 * TWO COLUMNS, NOT ONE, because they answer different questions and routinely disagree. An
 * order placed on 29 March and delivered on 2 April is March's sale and April's cash; a
 * bundle of orders placed in a month that were all refused at the door is a good sales month
 * and no money at all. Reporting either one alone hides a real problem.
 *
 * The cancelled are excluded from both: an order that never happened is not a sale, and a
 * cash order that was never delivered collected nothing.
 */
const getMonthlyIntake = async ({ months = 12 } = {}) => {
    const capped = Math.min(36, Math.max(1, Number(months) || 12));
    const now = new Date();
    const windowStart = new Date(now.getFullYear(), now.getMonth() - (capped - 1), 1);
    const windowEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const buckets = new Map();
    for (let i = capped - 1; i >= 0; i -= 1) {
        const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);
        buckets.set(monthKey(start), emptyMonth(monthKey(start), start, end));
    }

    const inWindow = (d) => d && new Date(d) >= windowStart && new Date(d) <= windowEnd;
    const bucketFor = (d) => (inWindow(d) ? buckets.get(monthKey(new Date(d))) : null);

    const addSold = (date, method, amount) => {
        const b = bucketFor(date);
        if (!b) return;
        b.sold.total = round2(b.sold.total + amount);
        b.sold.orders += 1;
        const row = b.sold.by_method[method] || { amount: 0, orders: 0 };
        row.amount = round2(row.amount + amount);
        row.orders += 1;
        b.sold.by_method[method] = row;
    };

    const addCollected = (date, method, source, amount) => {
        const b = bucketFor(date);
        if (!b) return;
        b.collected.total = round2(b.collected.total + amount);
        const row = b.collected.by_method[method] || { amount: 0, payments: 0 };
        row.amount = round2(row.amount + amount);
        row.payments += 1;
        b.collected.by_method[method] = row;
        const src = b.collected.by_source[source] || { amount: 0, payments: 0 };
        src.amount = round2(src.amount + amount);
        src.payments += 1;
        b.collected.by_source[source] = src;
    };

    /* ---- Orders: sold on the day they were placed ---------------------------------- */
    // Only `cancelled` is excluded. There is no unpaid-order status to filter out: a hosted
    // payment that is never completed leaves an `OrderPayment` and no order at all.
    const orderCursor = Order.find({
        created_at: { $gte: windowStart, $lte: windowEnd },
        status: { $ne: "cancelled" },
    })
        .select("created_at delivered_at total_price status transaction sub_orders")
        .lean()
        .cursor();

    for (let order = await orderCursor.next(); order != null; order = await orderCursor.next()) {
        addSold(order.created_at, methodKey(order.transaction), Number(order.total_price || 0));
    }

    /* ---- Cash: collected on the day each PARCEL was delivered -----------------------
     * Per parcel, not per order, because a two-vendor order is two couriers collecting on
     * two different days — and on a partly delivered order the undelivered half was never
     * collected at all.
     */
    const cashCursor = Order.find({
        "transaction.payment_method": "cash",
        "sub_orders.status": "delivered",
        $or: [
            { "sub_orders.delivered_at": { $gte: windowStart, $lte: windowEnd } },
            { delivered_at: { $gte: windowStart, $lte: windowEnd } },
        ],
    })
        .select("delivered_at sub_orders shipments transaction")
        .lean()
        .cursor();

    for (let order = await cashCursor.next(); order != null; order = await cashCursor.next()) {
        for (const sub of order.sub_orders || []) {
            if (sub.status !== "delivered") continue;
            const cod = Number(sub.cod_amount || 0);
            if (!(cod > 0)) continue;
            addCollected(sub.delivered_at || order.delivered_at, "cash", "orders", cod);
        }
    }

    /* ---- Gateway money: collected on the day the provider confirmed it -------------- */
    for (const source of PAYMENT_SOURCES) {
        const cursor = source.model
            .find({ ...source.match, [source.dateField]: { $gte: windowStart, $lte: windowEnd } })
            .select(source.select)
            .lean()
            .cursor();

        for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
            const provider = source.provider(doc);
            const method = provider === "paymob" ? "card_paymob" : provider === "fawaterak" ? "card_fawaterak" : "card_other";
            addCollected(source.at(doc), method, source.key, source.amount(doc));
        }
    }

    /* ---- Company invoices: collected on the day the transfer was made ----------------
     * Only transfers the admin confirmed. The orders were counted as SOLD when placed; this
     * is when their money actually reached the bank.
     */
    const companyPayments = await require("./companyInvoiceService").confirmedPaymentsBetween(windowStart, windowEnd).catch(() => []);
    for (const p of companyPayments) addCollected(p.paid_on, "company", "company_invoices", Number(p.amount || 0));

    const rows = [...buckets.values()];

    return {
        months: rows,
        method_labels: METHOD_LABELS,
        source_labels: {
            ...Object.fromEntries(PAYMENT_SOURCES.map((s) => [s.key, s.label])),
            company_invoices: { ar: "فواتير الشركات", en: "Company invoices" },
        },
        totals: {
            sold: round2(rows.reduce((s, r) => s + r.sold.total, 0)),
            orders: rows.reduce((s, r) => s + r.sold.orders, 0),
            collected: round2(rows.reduce((s, r) => s + r.collected.total, 0)),
        },
    };
};

/* ------------------------------------------------------------------ */
/*  One gateway's statement                                           */
/* ------------------------------------------------------------------ */

/**
 * Every movement at one gateway, newest first, with the balance after each.
 *
 * The running balance is computed from the WHOLE history and then walked backwards over the
 * page, so row one always shows today's real balance no matter which page is open. A balance
 * computed from a page alone would be right only on the first one.
 */
const getGatewayLedger = async (provider, { page = 1, limit = 50 } = {}) => {
    const rows = [];

    for (const source of PAYMENT_SOURCES) {
        const cursor = source.model
            .find({ ...source.match, [source.dateField]: { $ne: null } })
            .select(source.select)
            .lean()
            .cursor();

        for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
            if (source.provider(doc) !== provider) continue;
            const amount = source.amount(doc);
            const { fee, estimated } = gatewayFeeFor({ payloads: source.payloads(doc), amount, provider });
            rows.push({
                kind: "in",
                source: source.key,
                at: source.at(doc),
                amount: round2(amount),
                fee: fee === null ? null : round2(fee),
                // Tariff, not statement: the confirmation carried no fee figure.
                fee_estimated: estimated,
                net: round2(amount - (fee || 0)),
            });
        }
    }

    for (const payout of await GatewayPayout.find({ provider }).lean()) {
        rows.push({
            kind: "out",
            source: "payout",
            at: payout.received_at,
            amount: round2(payout.amount),
            fee: null,
            fee_estimated: false,
            net: round2(-payout.amount),
            reference: payout.reference,
            notes: payout.notes,
            id: payout._id,
            // "bank", or "paymob_payouts": sent on to the budget vendors are paid from, as a
            // Payouts top-up "from Accept balance" (that top-up made this row, and owns it).
            destination: payout.destination || "bank",
            locked: !!payout.payouts_topup_id,
        });
    }

    rows.sort((a, b) => new Date(a.at) - new Date(b.at));

    let balance = 0;
    for (const row of rows) {
        balance = round2(balance + row.net);
        row.balance = balance;
    }

    rows.reverse();
    const start = (Math.max(1, page) - 1) * limit;

    return {
        provider,
        label: GATEWAY_LABELS[provider] || provider,
        balance,
        total: rows.length,
        page,
        limit,
        rows: rows.slice(start, start + limit),
    };
};

/* ------------------------------------------------------------------ */
/*  Recording a gateway transfer                                      */
/* ------------------------------------------------------------------ */

const recordGatewayPayout = async (
    provider,
    { amount, received_at, reference = "", notes = "", adminId = null, adminLabel = "Admin" } = {}
) => {
    if (!provider) throw new Error("A gateway is required");
    if (!(Number(amount) > 0)) throw new Error("A transfer amount is required");

    const payout = await GatewayPayout.create({
        provider,
        amount: round2(amount),
        received_at: received_at ? new Date(received_at) : new Date(),
        reference: String(reference || "").trim(),
        notes: String(notes || "").trim(),
        recorded_by: adminId ? new mongoose.Types.ObjectId(adminId) : null,
        recorded_by_name: adminLabel,
    });

    await recordAuditLog({
        action: "gateway_payout_recorded",
        actor: { role: "admin", label: adminLabel },
        target_type: "gateway_payout",
        target_id: payout._id,
        target_snapshot: { provider, amount: payout.amount, reference: payout.reference },
    });

    return payout.toObject();
};

const listGatewayPayouts = async ({ provider = "", page = 1, limit = 25 } = {}) => {
    const filter = provider ? { provider } : {};
    const [rows, total] = await Promise.all([
        GatewayPayout.find(filter)
            .sort({ received_at: -1 })
            .skip((Math.max(1, page) - 1) * limit)
            .limit(limit)
            .lean(),
        GatewayPayout.countDocuments(filter),
    ]);
    return { payouts: rows, total, page, limit };
};

/** Delete a transfer entered by mistake. The balance it reduced goes straight back up. */
const deleteGatewayPayout = async (id, { adminId = null, adminLabel = "Admin" } = {}) => {
    const payout = await GatewayPayout.findById(id);
    if (!payout) throw new Error("Transfer not found");
    if (payout.payouts_topup_id) {
        throw new Error("ده تحويل لرصيد Paymob Payouts، بيتسجّل مع الشحنة بتاعته — امسحه من كشف حساب Payouts.");
    }

    await GatewayPayout.deleteOne({ _id: payout._id });

    await recordAuditLog({
        action: "gateway_payout_deleted",
        actor: { role: "admin", label: adminLabel },
        target_type: "gateway_payout",
        target_id: payout._id,
        target_snapshot: { provider: payout.provider, amount: payout.amount, reference: payout.reference },
    });

    return { deleted: true };
};

module.exports = {
    GATEWAYS,
    GATEWAY_LABELS,
    METHOD_LABELS,
    getWalletPosition,
    getGatewayPositions,
    getMoneyMap,
    getMonthlyIntake,
    getGatewayLedger,
    recordGatewayPayout,
    listGatewayPayouts,
    deleteGatewayPayout,
};
