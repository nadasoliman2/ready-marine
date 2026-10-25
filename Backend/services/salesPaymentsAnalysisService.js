/**
 * Sales & payments analysis — the second sheet of the tracking report workbook.
 *
 * The finance team built it by hand beside the tracking report ("تحليل المبيعات
 * والمدفوعات"), out of two screens: the treasury's money map and the report's own totals.
 * It ties the two together: everything that was paid, who is holding it, and how much of it
 * was sales.
 *
 * CUMULATIVE, TO THE END OF THE PERIOD. Every figure here runs from the first day of trading
 * to the report's `to` date, and the `from` date is ignored. The sheet is made of balances —
 * what a gateway holds, what a courier holds, what sits in wallets, what vendors are still
 * owed — and a balance has no meaning over a window: a card paid in August for an order
 * delivered in September is one event on each side of any monthly cut. Cumulative is the
 * only basis on which "paid" and "sold" reconcile. The per-period view is the first sheet.
 *
 * THE RECONCILIATION. One row per party that takes money for us:
 *
 *     collected − their fees − transferred to the bank = balance still with them
 *
 * and, across all of them:
 *
 *     total paid = sales + everything paid that was not a sale
 *
 * "Not a sale" is wallet top-ups not yet spent, packaging, vendor subscriptions, and order
 * money that never became a sale (cancelled and refunded, or not finished yet). It goes
 * negative for a company account: sold, on the invoice, not paid yet.
 *
 * Sales are the tracking report's, by the same rules — orders whose every parcel is final —
 * so this sheet and the first cannot disagree about an order.
 */
const { Order } = require("../models/orders");
const { WalletTransaction } = require("../models/walletTransactions");
const { CompanyPayment } = require("../models/companyInvoices");
const { getTrackingReport } = require("./trackingReportService");
const treasury = require("./treasuryService");
const courierSettlements = require("./courierSettlementService");
const couriers = require("./couriers");
const finance = require("./financeService");

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Customer wallets at `until`, by what moved the balance. Kept in piastres; reported in pounds. */
const walletMovements = async (until) => {
    const byType = await WalletTransaction.aggregate([
        { $match: { created_at: { $lte: until } } },
        // Available and reserved together: a checkout hold moves money between the two and
        // changes nothing a customer owns.
        { $group: { _id: "$type", net: { $sum: { $add: ["$balance_deltas.available", "$balance_deltas.reserved"] } } } },
    ]);
    const net = (...types) => round2(byType.filter((t) => types.includes(t._id)).reduce((a, t) => a + t.net, 0) / 100);
    return {
        topups: net("topup"),
        // A hold and its release (or its purchase) net to nothing between them.
        purchases: round2(0 - net("purchase", "purchase_reserve", "purchase_release")),
        refunds: net("purchase_refund", "refund_credit"),
        adjustments: net("admin_credit", "admin_debit"),
        balance: round2(byType.reduce((a, t) => a + t.net, 0) / 100),
    };
};

/** Money paid straight into the bank by `until`: company transfers, and bank-transfer orders. */
const directToBank = async (until) => {
    const [[company], [transfers]] = await Promise.all([
        // A credit set against an invoice moved no money.
        CompanyPayment.aggregate([
            { $match: { status: "confirmed", kind: { $ne: "credit" }, paid_on: { $lte: until } } },
            { $group: { _id: null, amount: { $sum: "$amount" } } },
        ]),
        Order.aggregate([
            { $match: { "transaction.payment_method": "bank_transfer", "transaction.status": "paid", status: { $ne: "cancelled" }, created_at: { $lte: until } } },
            { $group: { _id: null, amount: { $sum: "$transaction.amount" } } },
        ]),
    ]);
    return { company: round2(company?.amount || 0), bank: round2(transfers?.amount || 0) };
};

/**
 * Build the analysis as of the end of `to` (today, when there is none).
 *
 * @param {{ to?: string, sales?: object }} p  `sales` is a tracking report already built
 *        with no `from` for the same `to`, to save building it twice.
 */
const getSalesPaymentsAnalysis = async ({ to, sales = null } = {}) => {
    const until = finance.dateRange(null, to)?.$lte || new Date();

    const [report, gateways, courierCash, wallet, direct] = await Promise.all([
        sales || getTrackingReport({ to, language: "ar" }),
        treasury.getGatewayPositions({ until }),
        courierSettlements.getCashPositionsAt(until),
        walletMovements(until),
        directToBank(until),
    ]);

    // Sales, and the fee paid to collect them, by who collected.
    const sold = new Map();
    for (const row of report.rows) {
        for (const share of row.collected_by || []) {
            const key = `${share.kind}:${share.provider || ""}`;
            const s = sold.get(key) || { amount: 0, fee: 0 };
            s.amount += share.amount;
            s.fee += share.fee;
            sold.set(key, s);
        }
    }
    const take = (kind, provider = "") => {
        const s = sold.get(`${kind}:${provider}`) || { amount: 0, fee: 0 };
        sold.delete(`${kind}:${provider}`);
        return { sales: round2(s.amount), sales_fee: round2(s.fee) };
    };

    const channels = [];
    for (const g of [...gateways].sort((a, b) => treasury.GATEWAYS.indexOf(a.provider) - treasury.GATEWAYS.indexOf(b.provider))) {
        const { sales: s, sales_fee } = take("gateway", g.provider);
        channels.push({
            kind: "gateway",
            provider: g.provider,
            label: g.label,
            topups: g.by_source.topups?.amount || 0,
            supplies: g.by_source.supplies?.amount || 0,
            subscriptions: g.by_source.subscriptions?.amount || 0,
            not_sales: round2((g.by_source.orders?.amount || 0) - s),
            sales: s,
            collected: g.collected,
            fees: g.fees,
            to_bank: g.paid_out,
            balance: g.held,
            sales_fee,
            unpriced_fees: g.unpriced_fees,
        });
    }
    for (const c of courierCash) {
        const { sales: s, sales_fee } = take("courier", c.provider);
        // A courier that has never carried cash for us is not a row worth reading.
        if (c.provider !== "bosta" && c.collected === 0 && c.settled === 0 && s === 0) continue;
        channels.push({
            kind: "courier",
            provider: c.provider,
            label: couriers.labelOf(c.provider, true),
            topups: 0, supplies: 0, subscriptions: 0,
            not_sales: round2(c.collected - s),
            sales: s,
            collected: c.collected,
            fees: c.kept,
            to_bank: c.settled,
            balance: c.outstanding,
            sales_fee,
        });
    }
    // Paid straight into the bank: nothing is held and nothing is kept on the way.
    const straight = (kind, label, paid) => {
        const { sales: s, sales_fee } = take(kind);
        if (paid === 0 && s === 0) return;
        channels.push({
            kind, provider: null, label,
            topups: 0, supplies: 0, subscriptions: 0,
            not_sales: round2(paid - s),
            sales: s, collected: paid, fees: 0, to_bank: paid, balance: 0, sales_fee,
        });
    };
    straight("company", "حسابات الشركات (فواتير شهرية)", direct.company);
    straight("bank", "تحويل بنكي", direct.bank);

    const walletSales = take("wallet").sales;
    // Sales attributed to a party with no position above — a gateway named on the order
    // that never recorded a payment. Shown rather than dropped, so the sales still add up.
    for (const [key, s] of sold) {
        const [kind, provider] = key.split(":");
        channels.push({
            kind, provider, label: provider || kind,
            topups: 0, supplies: 0, subscriptions: 0,
            not_sales: round2(-s.amount),
            sales: round2(s.amount), collected: 0, fees: 0, to_bank: 0, balance: 0, sales_fee: round2(s.fee),
        });
    }
    const t = report.totals;

    return {
        as_of: until,
        truncated: report.truncated,
        channels,
        wallet: { ...wallet, sales: walletSales },
        sales: {
            total: t.total,
            vendor_net: t.vendor_net,
            commission: t.commission,
            shipping: t.shipping,
            shipping_cost: t.shipping_cost,
            to_vendors: report.transfers.to_vendors.amount,
        },
    };
};

module.exports = { getSalesPaymentsAnalysis };
