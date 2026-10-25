/**
 * Finance Service
 * ---------------
 * The admin's money view, in four questions:
 *
 *   1. What do we owe each vendor, and when is it due?   -> listVendorBalances / getVendorLedger / payEarnings
 *   2. What did we earn in commission, order by order?   -> getCommissionLedger
 *   3. Who paid us, what did it cost, did we profit?     -> getCustomerRevenue / getProfitAndLoss
 *   4. Where does the company stand overall?             -> getFinanceOverview
 *
 * Three rules hold everywhere in this file:
 *
 *   MONEY IS NEVER RE-DERIVED. Every figure traces to a stored snapshot — `VendorEarning`
 *   for what a parcel earned, `shipment.bosta_cost` for what it cost, `AdSpend` for what
 *   marketing cost. Recomputing from today's commission rates or today's Bosta tariff
 *   would restate last quarter every time a setting changed.
 *
 *   REVENUE IS RECOGNISED ON DELIVERY, not on order. An order placed in March and
 *   delivered in April is April's revenue, because until it is delivered it may still be
 *   cancelled. Every date filter in this file therefore runs on `delivered_at`, and the
 *   one place that does not — ad spend — says so.
 *
 *   REFUNDS REDUCE THE PERIOD THEY LAND IN. A March order refunded in April reduces
 *   April, so the two months always sum to the truth even though neither is restated.
 */

const mongoose = require("mongoose");

const { VendorEarning } = require("../models/vendorEarnings");
const { WithdrawalRequest, generateWithdrawalNumber } = require("../models/withdrawalRequests");
const { Order } = require("../models/orders");
const { Seller } = require("../models/sellers");
const { Refund } = require("../models/refunds");
const { SubscriptionPayment } = require("../models/subscriptionPayments");
const { SupplyOrder } = require("../models/supplyOrders");
const { AdSpend } = require("../models/adSpend");
const { recordAuditLog } = require("../models/auditLog");
const { createNotification } = require("../models/notifications");

const payoutSchedule = require("./payoutScheduleService");
const bostaCostService = require("./bostaCostService");
const { recomputeWalletBalances } = require("./vendorEarningsService");
const { DELIVERED_ORDER_STATUSES, AT_VENDOR_STATUSES, IN_TRANSIT_STATUSES } = require("./subOrderService");
const { User } = require("../models/users");
const { OrderPayment } = require("../models/orderPayments");
const { WalletTopup } = require("../models/walletTopups");
const { gatewayFeeFor } = require("./shared/gatewayFee");
const payoutMethods = require("./payouts/payoutMethods");
const paymobPayouts = require("./payouts/paymobPayoutClient");

const round2 = (n) => Number((Number(n) || 0).toFixed(2));
const toObjectId = (id) => (typeof id === "string" ? new mongoose.Types.ObjectId(id) : id);

/**
 * A [from, to] filter on a date field, with `to` pushed to the end of its day.
 *
 * A report "to 31 March" must include everything that happened ON 31 March. Without this
 * the range ends at midnight and silently drops the last day — the kind of error that
 * looks like a slow month rather than a bug.
 */
const dateRange = (from, to) => {
    const range = {};
    if (from) range.$gte = new Date(from);
    if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        range.$lte = end;
    }
    return Object.keys(range).length > 0 ? range : null;
};

/* ================================================================== */
/*  1. VENDOR PAYOUTS                                                 */
/* ================================================================== */

/**
 * Every vendor with money in the system, and what stage it is at.
 *
 * The three buckets answer three different questions and must not be added together:
 *
 *   held      earned, but the return window is still open — we may yet have to reverse it
 *   payable   cleared and unpaid: this is the debt
 *   paid      already handed over
 *
 * `payable` is the number the admin acts on, and it is defined as
 * { status: 'available', payout_id: null } — see the note on `VendorEarning.payout_id`
 * for why paying an earning does not change its status.
 */
/* Aggregation predicates shared by the vendor screens. An earning is exactly one of:
 * held (pending), payable, frozen, in a payout, paid, or reversed. */
const NOT_FROZEN = { $ne: [{ $ifNull: ["$frozen.active", false] }, true] };
const IS_PAYABLE = { $and: [{ $eq: ["$status", "available"] }, { $eq: ["$payout_id", null] }, NOT_FROZEN] };
const IS_FROZEN = { $and: [{ $eq: ["$payout_id", null] }, { $ne: ["$status", "reversed"] }, { $eq: ["$frozen.active", true] }] };
const IS_IN_PAYOUT = { $and: [{ $ne: ["$payout_id", null] }, { $in: [{ $ifNull: ["$payout_status", "paid"] }, ["requested", "processing"]] }] };
// A stamped row from before `payout_status` existed was written by a finished manual payout.
const IS_PAID = { $and: [{ $ne: ["$payout_id", null] }, { $eq: [{ $ifNull: ["$payout_status", "paid"] }, "paid"] }] };

const listVendorBalances = async ({ search = "", sort = "payable", onlyOwed = false } = {}) => {
    const globalSchedule = await payoutSchedule.getGlobalSchedule();

    const rows = await VendorEarning.aggregate([
        {
            $group: {
                _id: "$vendor_id",
                held_amount: {
                    $sum: { $cond: [{ $and: [{ $eq: ["$status", "pending"] }, NOT_FROZEN] }, "$effective_net", 0] },
                },
                held_count: {
                    $sum: { $cond: [{ $and: [{ $eq: ["$status", "pending"] }, NOT_FROZEN] }, 1, 0] },
                },
                payable_amount: {
                    $sum: { $cond: [IS_PAYABLE, "$effective_net", 0] },
                },
                payable_count: {
                    $sum: { $cond: [IS_PAYABLE, 1, 0] },
                },
                // Stopped by an admin (unpaid, frozen) — owed, but not payable until released.
                frozen_amount: {
                    $sum: { $cond: [IS_FROZEN, "$effective_net", 0] },
                },
                // Claimed by a request awaiting review or a transfer still on its way.
                in_payout_amount: {
                    $sum: { $cond: [IS_IN_PAYOUT, "$effective_net", 0] },
                },
                paid_amount: {
                    $sum: { $cond: [IS_PAID, "$effective_net", 0] },
                },
                // Drives the "overdue" flag: the oldest unpaid cleared earning is the one
                // that has been waiting longest, and its scheduled date is the one that
                // was missed.
                oldest_payable_at: {
                    $min: { $cond: [IS_PAYABLE, "$clearable_at", null] },
                },
                lifetime_gross: { $sum: "$gross_amount" },
                lifetime_commission: { $sum: "$commission_amount" },
                total_reversed: { $sum: "$reversed_net" },
                earnings_count: { $sum: 1 },
            },
        },
    ]);

    const vendorIds = rows.map((r) => r._id).filter(Boolean);
    const vendors = await Seller.find({ _id: { $in: vendorIds } })
        .select("name store_name email phone wallet payout_schedule default_bank_details status payout_method payout_hold")
        .lean();
    const vendorById = new Map(vendors.map((v) => [String(v._id), v]));

    const now = new Date();
    let result = rows
        .map((row) => {
            const vendor = vendorById.get(String(row._id));
            if (!vendor) return null; // vendor hard-deleted; its earnings are orphaned

            const schedule = payoutSchedule.resolveSchedule(
                { ...globalSchedule },
                vendor.payout_schedule
            );

            // What the money currently held is WAITING for, so the admin can see the
            // pipeline rather than only the debt.
            const nextPayout = payoutSchedule.nextPayoutOnOrAfter(schedule, now);
            const dueDate = row.oldest_payable_at
                ? payoutSchedule.nextPayoutOnOrAfter(schedule, row.oldest_payable_at)
                : null;

            return {
                vendor_id: row._id,
                store_name: vendor.store_name,
                owner_name: vendor.name,
                email: vendor.email,
                phone: vendor.phone,
                status: vendor.status,
                has_bank_details: !!vendor.default_bank_details?.account_number,
                payout_method: payoutMethods.describe(vendor.payout_method),
                payout_hold: vendor.payout_hold?.active ? { reason: vendor.payout_hold.reason, at: vendor.payout_hold.at } : null,

                held_amount: round2(row.held_amount),
                held_count: row.held_count,
                payable_amount: round2(row.payable_amount),
                payable_count: row.payable_count,
                // What a transfer of every payable order would actually send, after what the
                // wallet already owes (refunds on paid orders, packaging, older withdrawals).
                // From the cached wallet — the vendor page recomputes it live.
                // Paying everything payable sends exactly the wallet balance (see computeSettlement).
                net_payable: round2(Math.max(0, vendor.wallet?.available_balance ?? row.payable_amount)),
                frozen_amount: round2(row.frozen_amount),
                in_payout_amount: round2(row.in_payout_amount),
                paid_amount: round2(row.paid_amount),
                lifetime_gross: round2(row.lifetime_gross),
                lifetime_commission: round2(row.lifetime_commission),
                total_reversed: round2(row.total_reversed),
                earnings_count: row.earnings_count,

                schedule: {
                    ...schedule,
                    label: payoutSchedule.describeSchedule(schedule),
                },
                next_payout_at: nextPayout,
                // The date this vendor's oldest unpaid money was due. In the past means a
                // payout was missed, which is the whole reason this column exists.
                due_at: dueDate,
                is_overdue: !!(dueDate && dueDate < payoutSchedule.startOfDay(now) && row.payable_amount > 0),
            };
        })
        .filter(Boolean);

    if (search) {
        const needle = search.toLowerCase();
        result = result.filter(
            (r) =>
                (r.store_name || "").toLowerCase().includes(needle) ||
                (r.owner_name || "").toLowerCase().includes(needle) ||
                (r.email || "").toLowerCase().includes(needle)
        );
    }

    if (onlyOwed) result = result.filter((r) => r.payable_amount > 0 || r.net_payable > 0);

    const sorters = {
        payable: (a, b) => b.payable_amount - a.payable_amount,
        held: (a, b) => b.held_amount - a.held_amount,
        paid: (a, b) => b.paid_amount - a.paid_amount,
        // Overdue first, then by how long they have been waiting.
        due: (a, b) => (a.due_at ? a.due_at.getTime() : Infinity) - (b.due_at ? b.due_at.getTime() : Infinity),
        name: (a, b) => (a.store_name || "").localeCompare(b.store_name || ""),
    };
    result.sort(sorters[sort] || sorters.payable);

    const totals = result.reduce(
        (acc, r) => ({
            held: round2(acc.held + r.held_amount),
            payable: round2(acc.payable + r.payable_amount),
            frozen: round2(acc.frozen + r.frozen_amount),
            in_payout: round2(acc.in_payout + r.in_payout_amount),
            paid: round2(acc.paid + r.paid_amount),
            commission: round2(acc.commission + r.lifetime_commission),
            vendors_owed: acc.vendors_owed + (r.payable_amount > 0 ? 1 : 0),
            overdue: acc.overdue + (r.is_overdue ? 1 : 0),
        }),
        { held: 0, payable: 0, frozen: 0, in_payout: 0, paid: 0, commission: 0, vendors_owed: 0, overdue: 0 }
    );

    return {
        vendors: result,
        totals,
        global_schedule: {
            ...globalSchedule,
            label: payoutSchedule.describeSchedule(globalSchedule),
            upcoming: payoutSchedule.upcomingPayouts(globalSchedule, { count: 4 }),
        },
    };
};

/**
 * One vendor's full ledger: every earning, order by order, with the payout date each is
 * bound for and whether it can be paid today.
 *
 * `is_payable` is what the UI dims on. It is false for three separate reasons and each
 * one is reported separately — a row held by an open return needs a different action from
 * a row simply waiting out its window, and collapsing them into "not yet" hides that.
 */
const getVendorLedger = async (vendorId, { status = "", from, to, page = 1, limit = 25 } = {}) => {
    const vendor = await Seller.findById(vendorId)
        .select("name store_name email phone wallet payout_schedule default_bank_details payout_method payout_hold")
        .lean();
    if (!vendor) {
        const err = new Error("Vendor not found");
        err.code = "NOT_FOUND";
        throw err;
    }
    // The live balance, so the "net payable" figure below is exact rather than cached.
    vendor.wallet = await recomputeWalletBalances(vendorId);

    const schedule = await payoutSchedule.getScheduleForVendor(vendorId);
    const now = new Date();

    const filter = { vendor_id: toObjectId(vendorId) };
    if (status === "payable") Object.assign(filter, { status: "available", payout_id: null, "frozen.active": { $ne: true } });
    else if (status === "held") Object.assign(filter, { status: "pending", "frozen.active": { $ne: true } });
    else if (status === "frozen") Object.assign(filter, { payout_id: null, status: { $ne: "reversed" }, "frozen.active": true });
    else if (status === "in_payout") Object.assign(filter, { payout_id: { $ne: null }, payout_status: { $in: ["requested", "processing"] } });
    else if (status === "paid") Object.assign(filter, { payout_id: { $ne: null }, payout_status: { $nin: ["requested", "processing"] } });
    else if (status === "reversed") filter.status = "reversed";

    const deliveredRange = dateRange(from, to);
    if (deliveredRange) filter.delivered_at = deliveredRange;

    const total = await VendorEarning.countDocuments(filter);
    const earnings = await VendorEarning.find(filter)
        .sort({ clearable_at: 1, delivered_at: 1 })
        .skip((Math.max(1, Number(page)) - 1) * Number(limit))
        .limit(Number(limit))
        .lean();

    // One query for every order on the page, rather than one per row.
    const orderIds = [...new Set(earnings.map((e) => String(e.order_id)))];
    const orders = await Order.find({ _id: { $in: orderIds } })
        .select("_id user_id status created_at delivered_at items sub_orders transaction shipping total_price coupon_code shipping_address")
        .populate("user_id", "name email phone")
        .lean();
    const orderById = new Map(orders.map((o) => [String(o._id), o]));

    const payoutIds = [...new Set(earnings.map((e) => e.payout_id).filter(Boolean).map(String))];
    const payouts = await WithdrawalRequest.find({ _id: { $in: payoutIds } })
        .select("withdrawal_number paid_at payment_reference amount scheduled_for status channel initiated_by")
        .lean();
    const payoutById = new Map(payouts.map((p) => [String(p._id), p]));

    // Which held rows the admin could pay before their settlement period ends, and if not, why.
    const { earlyReleaseBlocks } = require("./vendorPayoutService");
    const earlyBlocks = await earlyReleaseBlocks(earnings.filter((e) => e.status === "pending"));

    const rows = earnings.map((earning) => {
        const order = orderById.get(String(earning.order_id));
        const sub = earning.sub_order_id
            ? (order?.sub_orders || []).find((s) => String(s._id) === String(earning.sub_order_id))
            : null;

        // The lines this parcel actually carried. Falls back to the whole order for
        // pre-parcel rows, where the vendor's items are the only ones that exist.
        const items = (order?.items || []).filter((i) =>
            earning.sub_order_id
                ? i.sub_order_id && String(i.sub_order_id) === String(earning.sub_order_id)
                : String(i.vendor_id) === String(vendorId)
        );

        const inPayout = !!earning.payout_id;
        const isPaid = inPayout && !["requested", "processing"].includes(earning.payout_status);
        const isFrozen = !inPayout && !!earning.frozen?.active;
        const windowClosed = earning.clearable_at <= now;
        const isPayable = earning.status === "available" && !inPayout && !isFrozen && earning.effective_net > 0;

        return {
            earning_id: earning._id,
            order_id: earning.order_id,
            sub_order_id: earning.sub_order_id,
            reference: sub?.reference || String(earning.order_id).slice(-8).toUpperCase(),
            order_status: order?.status || null,
            parcel_status: sub?.status || null,

            customer: order?.user_id
                ? { id: order.user_id._id, name: order.user_id.name, email: order.user_id.email, phone: order.user_id.phone }
                : null,

            items: items.map((i) => ({
                title: i.product_title,
                image: i.product_image,
                variant: i.variant_label,
                quantity: i.quantity,
                unit_price: i.unit_price,
                line_total: round2(i.unit_price * i.quantity),
                commission_rate: i.commission_rate,
                commission_amount: i.commission_amount,
                return_status: i.return_status,
            })),

            gross_amount: earning.gross_amount,
            // The vendor's share of the coupon on this parcel — already out of `net_amount`.
            coupon_share: round2(earning.coupon_share || 0),
            commission_amount: earning.commission_amount,
            net_amount: earning.net_amount,
            reversed_net: earning.reversed_net,
            reversed_commission: earning.reversed_commission,
            reversed_coupon: round2(earning.reversed_coupon || 0),
            effective_net: earning.effective_net,
            // Shipping never belongs to the vendor — the customer paid it to us and we paid
            // it to Bosta — but it is shown so a vendor querying their total can see where
            // the rest of the order's money went.
            shipping_charged: sub?.shipping_share ?? null,

            payment_method: earning.payment_method,
            delivered_at: earning.delivered_at,
            clearable_at: earning.clearable_at,
            days_until_clear: payoutSchedule.daysUntil(earning.clearable_at, now),

            status: earning.status,
            has_open_return: earning.has_open_return,

            is_payable: isPayable,
            payout_status: earning.payout_status || (earning.payout_id ? "paid" : null),
            can_release_early: earning.status === "pending" && earlyBlocks.get(String(earning._id)) === null,
            early_block: earning.status === "pending" ? earlyBlocks.get(String(earning._id)) || null : null,
            early_release: earning.early_release?.at ? earning.early_release : null,
            frozen: earning.frozen?.active ? earning.frozen : null,
            hold_days: earning.hold_days ?? null,
            // Why not, when not. Separate reasons because they need separate actions.
            blocked_reason: isPaid
                ? "paid"
                : inPayout
                    ? "in_payout"
                : isFrozen
                    ? "frozen"
                : earning.status === "reversed"
                    ? "reversed"
                    : earning.has_open_return
                        ? "open_return"
                        : !windowClosed
                            ? "holding"
                            : earning.effective_net <= 0
                                ? "fully_refunded"
                                : null,

            // The payout this money is bound for, dated from its OWN clearing date so it
            // does not creep forward while it waits.
            scheduled_payout_at: payoutSchedule.payoutDateForEarning(schedule, earning),

            payout: earning.payout_id
                ? {
                    id: earning.payout_id,
                    ...(payoutById.get(String(earning.payout_id)) || {}),
                    paid_at: earning.paid_at,
                }
                : null,
        };
    });

    // Totals across the WHOLE ledger, not just this page — a page total would change as
    // the admin paged and could never be reconciled against the vendor list.
    const [summary] = await VendorEarning.aggregate([
        { $match: { vendor_id: toObjectId(vendorId) } },
        {
            $group: {
                _id: null,
                held: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "pending"] }, NOT_FROZEN] }, "$effective_net", 0] } },
                payable: { $sum: { $cond: [IS_PAYABLE, "$effective_net", 0] } },
                frozen: { $sum: { $cond: [IS_FROZEN, "$effective_net", 0] } },
                in_payout: { $sum: { $cond: [IS_IN_PAYOUT, "$effective_net", 0] } },
                paid: { $sum: { $cond: [IS_PAID, "$effective_net", 0] } },
                lifetime_gross: { $sum: "$gross_amount" },
                lifetime_coupon: { $sum: { $ifNull: ["$coupon_share", 0] } },
                lifetime_commission: { $sum: "$commission_amount" },
                lifetime_reversed: { $sum: "$reversed_net" },
            },
        },
    ]);

    return {
        vendor: {
            _id: vendor._id,
            store_name: vendor.store_name,
            owner_name: vendor.name,
            email: vendor.email,
            phone: vendor.phone,
            wallet: vendor.wallet,
            bank_details: vendor.default_bank_details,
            payout_method: payoutMethods.describe(vendor.payout_method, { masked: false }),
            payout_method_updated_at: vendor.payout_method?.updated_at || null,
            payout_hold: vendor.payout_hold?.active ? vendor.payout_hold : null,
        },
        paymob: {
            configured: paymobPayouts.isConfigured(),
            environment: paymobPayouts.environment(),
        },
        schedule: {
            ...schedule,
            label: payoutSchedule.describeSchedule(schedule),
            next_payout_at: payoutSchedule.nextPayoutOnOrAfter(schedule, now),
            upcoming: payoutSchedule.upcomingPayouts(schedule, { count: 4 }),
        },
        summary: {
            held: round2(summary?.held || 0),
            payable: round2(summary?.payable || 0),
            // What paying every payable order would transfer after the wallet's deductions.
            net_payable: round2(Math.max(0, vendor.wallet?.available_balance ?? 0)),
            // Positive: the wallet owes us and it comes off. Negative: a credit not tied to
            // any order, paid on top.
            deductions: round2((summary?.payable || 0) - Math.max(0, vendor.wallet?.available_balance ?? 0)),
            frozen: round2(summary?.frozen || 0),
            in_payout: round2(summary?.in_payout || 0),
            paid: round2(summary?.paid || 0),
            lifetime_gross: round2(summary?.lifetime_gross || 0),
            lifetime_coupon: round2(summary?.lifetime_coupon || 0),
            lifetime_commission: round2(summary?.lifetime_commission || 0),
            lifetime_reversed: round2(summary?.lifetime_reversed || 0),
        },
        rows,
        pagination: {
            total,
            page: Number(page),
            pages: Math.ceil(total / Number(limit)) || 1,
            limit: Number(limit),
        },
    };
};

/**
 * Pay a vendor for a chosen set of earnings.
 *
 * The admin picks rows and presses Pay. `channel` "manual" records a transfer made outside
 * the system (the original behaviour); "paymob" sends it through Paymob Payouts to the
 * vendor's saved method. Both are written by `vendorPayoutService.adminPay`, which claims
 * every row for this one payout before anything moves and nets whatever the vendor's wallet
 * already owes — so paying never hands over money the vendor already spent.
 *
 * Rejects the WHOLE request if any single earning is not payable. A partial payout would
 * leave the admin believing they had settled rows that silently did not go out.
 */
const payEarnings = async (vendorId, earningIds, {
    channel = "manual", payment_reference = null, notes = "", adminLabel = "Admin", early_ids = [], early_reason = "",
} = {}) => {
    // Required here rather than at the top: vendorPayoutService reaches back into the
    // earnings service this file also loads, and a load-time cycle would hand one of them
    // a half-built module.
    const { adminPay } = require("./vendorPayoutService");
    return adminPay(vendorId, earningIds, {
        channel,
        paymentReference: payment_reference,
        notes,
        actor: { role: "admin", label: adminLabel },
        // Orders still inside their settlement period that the admin chose to pay now.
        earlyIds: early_ids,
        earlyReason: early_reason,
    });
};

/** A vendor's payout history — what has actually gone out, newest first. */
const listVendorPayouts = async (vendorId, { page = 1, limit = 20 } = {}) => {
    const filter = { vendor_id: toObjectId(vendorId), status: { $ne: "draft" } };
    const total = await WithdrawalRequest.countDocuments(filter);
    const payouts = await WithdrawalRequest.find(filter)
        .sort({ created_at: -1 })
        .skip((Math.max(1, Number(page)) - 1) * Number(limit))
        .limit(Number(limit))
        .lean();

    return {
        payouts,
        pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)) || 1, limit: Number(limit) },
    };
};

/* ================================================================== */
/*  2. COMMISSION LEDGER                                              */
/* ================================================================== */

/**
 * Our commission, order by order, with every number that produced it.
 *
 * Built from `VendorEarning` rather than from the orders themselves because the earning is
 * the snapshot: it holds the commission as it was CHARGED, including any reversal a refund
 * has since applied. Re-deriving from `order.items[].commission_amount` would show the
 * gross commission on an order that was half returned.
 */
const getCommissionLedger = async ({ from, to, vendorId = "", search = "", page = 1, limit = 25 } = {}) => {
    const filter = {};
    const range = dateRange(from, to);
    if (range) filter.delivered_at = range;
    if (vendorId) filter.vendor_id = toObjectId(vendorId);

    const total = await VendorEarning.countDocuments(filter);
    const earnings = await VendorEarning.find(filter)
        .sort({ delivered_at: -1 })
        .skip((Math.max(1, Number(page)) - 1) * Number(limit))
        .limit(Number(limit))
        .lean();

    const orderIds = [...new Set(earnings.map((e) => String(e.order_id)))];
    const vendorIds = [...new Set(earnings.map((e) => String(e.vendor_id)))];

    const [orders, vendors] = await Promise.all([
        Order.find({ _id: { $in: orderIds } })
            .select("_id user_id status created_at delivered_at items sub_orders shipments transaction shipping total_price coupon_code coupon_discount_amount loyalty shipping_address")
            .populate("user_id", "name email phone")
            .lean(),
        Seller.find({ _id: { $in: vendorIds } }).select("name store_name").lean(),
    ]);

    const orderById = new Map(orders.map((o) => [String(o._id), o]));
    const vendorById = new Map(vendors.map((v) => [String(v._id), v]));

    // Per-parcel Bosta cost, so each commission row can show the shipping side beside it.
    const costsByOrder = new Map();
    for (const order of orders) {
        costsByOrder.set(String(order._id), await bostaCostService.costsForOrder(order));
    }

    let rows = earnings.map((earning) => {
        const order = orderById.get(String(earning.order_id));
        const vendor = vendorById.get(String(earning.vendor_id));
        const sub = earning.sub_order_id
            ? (order?.sub_orders || []).find((s) => String(s._id) === String(earning.sub_order_id))
            : null;

        const items = (order?.items || []).filter((i) =>
            earning.sub_order_id
                ? i.sub_order_id && String(i.sub_order_id) === String(earning.sub_order_id)
                : String(i.vendor_id) === String(earning.vendor_id)
        );

        const bostaCost = earning.sub_order_id
            ? costsByOrder.get(String(earning.order_id))?.get(String(earning.sub_order_id))
            : null;

        const shippingCharged = round2(sub?.shipping_share || 0);
        const shippingCost = round2(bostaCost?.total || 0);

        const netCommission = round2(earning.commission_amount - earning.reversed_commission);

        // The coupon on this parcel, and who funded it. The vendor's part is already out of
        // `vendor_net`; the platform's part is our cost on this parcel and comes off
        // `our_revenue`, the way it comes off the P&L.
        const couponVendor = round2(earning.coupon_share || sub?.coupon_vendor_share || 0);
        const couponTotal = round2(sub?.coupon_share || 0);
        const couponPlatform = round2(Math.max(0, couponTotal - couponVendor));

        return {
            earning_id: earning._id,
            order_id: earning.order_id,
            sub_order_id: earning.sub_order_id,
            reference: sub?.reference || String(earning.order_id).slice(-8).toUpperCase(),
            order_status: order?.status || null,
            parcel_status: sub?.status || null,

            vendor: vendor ? { id: earning.vendor_id, store_name: vendor.store_name, owner_name: vendor.name } : null,
            customer: order?.user_id
                ? { id: order.user_id._id, name: order.user_id.name, email: order.user_id.email, phone: order.user_id.phone }
                : null,
            city: order?.shipping?.destination?.city || null,

            items: items.map((i) => ({
                title: i.product_title,
                image: i.product_image,
                variant: i.variant_label,
                quantity: i.quantity,
                unit_price: i.unit_price,
                line_total: round2(i.unit_price * i.quantity),
                commission_rate: i.commission_rate,
                commission_amount: i.commission_amount,
                return_status: i.return_status,
            })),

            /* ---- The money, in the order it happens ---- */
            merchandise: earning.gross_amount,
            coupon_total: couponTotal,
            coupon_vendor_share: couponVendor,
            coupon_platform_share: couponPlatform,
            coupon_vendor_share_percent: Number(order?.coupon_vendor_share_percent || 0),
            commission_charged: earning.commission_amount,
            commission_reversed: earning.reversed_commission,
            commission_net: netCommission,
            // The blended rate this parcel actually paid. Shown because a parcel mixing two
            // categories has no single configured rate to quote.
            effective_rate: earning.gross_amount > 0
                ? round2((earning.commission_amount / earning.gross_amount) * 100)
                : 0,
            vendor_net: earning.effective_net,

            shipping_charged: shippingCharged,
            shipping_cost: shippingCost,
            shipping_margin: round2(shippingCharged - shippingCost),
            shipping_cost_source: bostaCost?.source || null,
            bosta_cost_breakdown: bostaCost || null,

            // Commission + shipping margin − our share of the coupon: what the parcel was
            // worth to US.
            our_revenue: round2(netCommission + shippingCharged - shippingCost - couponPlatform),

            payment_method: earning.payment_method,
            delivered_at: earning.delivered_at,
            ordered_at: order?.created_at || null,
            earning_status: earning.status,
            is_paid_to_vendor: !!earning.payout_id && !["requested", "processing"].includes(earning.payout_status),
        };
    });

    if (search) {
        const needle = search.toLowerCase();
        rows = rows.filter(
            (r) =>
                (r.reference || "").toLowerCase().includes(needle) ||
                (r.customer?.name || "").toLowerCase().includes(needle) ||
                (r.customer?.email || "").toLowerCase().includes(needle) ||
                (r.vendor?.store_name || "").toLowerCase().includes(needle)
        );
    }

    // Period totals across EVERY matching row, not just this page.
    const [totals] = await VendorEarning.aggregate([
        { $match: filter },
        {
            $group: {
                _id: null,
                merchandise: { $sum: "$gross_amount" },
                coupon_vendor_share: { $sum: { $ifNull: ["$coupon_share", 0] } },
                commission_charged: { $sum: "$commission_amount" },
                commission_reversed: { $sum: "$reversed_commission" },
                vendor_net: { $sum: "$effective_net" },
                parcels: { $sum: 1 },
            },
        },
    ]);

    return {
        rows,
        totals: {
            merchandise: round2(totals?.merchandise || 0),
            coupon_vendor_share: round2(totals?.coupon_vendor_share || 0),
            commission_charged: round2(totals?.commission_charged || 0),
            commission_reversed: round2(totals?.commission_reversed || 0),
            commission_net: round2((totals?.commission_charged || 0) - (totals?.commission_reversed || 0)),
            vendor_net: round2(totals?.vendor_net || 0),
            parcels: totals?.parcels || 0,
            average_rate: totals?.merchandise
                ? round2((totals.commission_charged / totals.merchandise) * 100)
                : 0,
        },
        pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)) || 1, limit: Number(limit) },
    };
};

/* ================================================================== */
/*  3. CUSTOMERS, COSTS AND PROFIT                                    */
/* ================================================================== */

/**
 * The profit arithmetic, in exactly one place.
 *
 * Both the single-period report and the monthly chart run through this. When the same
 * formula was written out twice, the two were one edit away from disagreeing — and a
 * dashboard whose chart contradicts its own headline is worse than one without a chart.
 *
 * The one judgement encoded here: the vendor's share is NOT a cost. It was never our
 * money — the customer's payment passes through us on its way to them — so subtracting it
 * would report a loss on every profitable order.
 */
const composeTotals = (parts) => {
    const commissionNet = round2((parts.commission_charged || 0) - (parts.commission_reversed || 0));
    const shippingMargin = round2((parts.shipping_charged || 0) - (parts.shipping_cost || 0));

    const revenue = round2(
        commissionNet +
        (parts.shipping_charged || 0) +
        (parts.subscriptions || 0) +
        (parts.supplies || 0)
    );

    // `shipping_cost` already carries Bosta's extra-COD fee — it is part of what the
    // parcel cost — so only the gateway's cut is added here, or COD collection would
    // be counted twice.
    //
    // `bundle_waste` is its own line and NOT folded into `shipping_cost`. A parcel that
    // shipped on a prepaid bundle cost one credit — 100 EGP — whatever else happened that
    // month, and spreading the unused credits back over it would make every order look
    // worse while hiding the one number anyone can act on: the parcels that were bought
    // and never shipped before the bundle expired.
    const costs = round2(
        (parts.shipping_cost || 0) +
        (parts.bundle_waste || 0) +
        (parts.gateway_fees || 0) +
        (parts.coupon_discounts || 0) +
        (parts.loyalty_discounts || 0) +
        (parts.ad_spend || 0)
    );

    const profit = round2(revenue - costs);

    return {
        commission_net: commissionNet,
        shipping_margin: shippingMargin,
        revenue,
        costs,
        profit,
        margin_percent: revenue > 0 ? round2((profit / revenue) * 100) : 0,
    };
};

/* ------------------------------------------------------------------ */
/*  The books move per PARCEL                                          */
/* ------------------------------------------------------------------ */

/**
 * Which parcels count, and when.
 *
 * Revenue is only ever money that ARRIVED: a parcel counts on the day it was delivered, with
 * its own frozen share of shipping and discounts. Reading whole orders instead — "the order
 * is completed, take its total" — got three things wrong at once:
 *
 *   · an order with one parcel delivered and one cancelled reads `partially_cancelled`, so it
 *     dropped out of the shipping, cost and discount lines entirely while its commission
 *     (from the earning ledger, which is per parcel) stayed in — the two halves of the same
 *     report disagreed;
 *   · a completed order's shipping and gross value included the parcels that were cancelled
 *     off it, which were never collected;
 *   · a parcel the customer refused at the door (`returned` without ever being delivered)
 *     cost us the outbound leg AND the trip home, and neither appeared anywhere.
 *
 * So the unit is the parcel. `delivered` parcels carry revenue and their delivery cost;
 * `refused` parcels carry cost only, dated when they came back. A parcel still moving, or
 * cancelled before it moved, is in neither — it is on the pipeline, not in the books.
 */
const PARCEL_ORDER_FIELDS =
    "_id user_id status created_at delivered_at items sub_orders shipments transaction shipping total_price coupon_code coupon_discount_amount loyalty";

/** Delivered, including a parcel a courier later reports as returned after delivering it. */
const parcelWasDelivered = (sub) =>
    sub?.status === "delivered" || (sub?.status === "returned" && !!sub.delivered_at);

/** Refused at the door and carried back: it never reached the customer. */
const parcelWasRefused = (sub) => sub?.status === "returned" && !sub.delivered_at;

const parcelDeliveredAt = (order, sub) => sub.delivered_at || order.delivered_at || null;

const parcelReturnedAt = (order, sub) => {
    const entry = [...(sub.history || [])].reverse().find((h) => h?.metadata?.to === "returned");
    if (entry?.created_at) return new Date(entry.created_at);
    const shipment = require("./subOrderService").liveShipmentFor(order, sub);
    return shipment?.last_event_at || shipment?.last_tracked_at || null;
};

/** The customer-facing money of one delivered parcel, from its frozen allocation. */
const parcelMoney = (sub) => {
    const merchandise = Number(sub.merchandise_total || 0);
    const shipping = Number(sub.shipping_share || 0);
    const coupon = Number(sub.coupon_share || 0);
    // Who funded the coupon. A parcel from before the split existed carries neither field:
    // the vendor's part reads 0 and the whole coupon falls to us, which is what it was.
    const couponVendor = Number(sub.coupon_vendor_share || 0);
    const couponPlatform = sub.coupon_platform_share !== undefined && sub.coupon_platform_share !== null
        ? Number(sub.coupon_platform_share)
        : Math.max(0, coupon - couponVendor);
    const loyalty = Number(sub.loyalty_share || 0);
    return {
        merchandise, shipping, coupon, loyalty,
        coupon_vendor: couponVendor,
        coupon_platform: couponPlatform,
        gross: merchandise + shipping - coupon - loyalty,
    };
};

/**
 * Stream every parcel that settled inside `range` — delivered or refused — with what it cost.
 *
 * A refused parcel's cost must include the return leg. The cost snapshotted at dispatch was
 * taken while the parcel was still going out, so its `rto` is 0; the leg is added here from
 * the courier ledger when that recorded it, otherwise priced from the tariff.
 */
const forEachSettledParcel = async ({ range = null, populateUser = false, onParcel }) => {
    const inRange = (d) => !!d
        && (!range || ((!range.$gte || d >= range.$gte) && (!range.$lte || d <= range.$lte)));

    const filter = { "sub_orders.status": { $in: ["delivered", "returned"] } };
    // A coarse database cut for a dated range; the exact per-parcel test is `inRange` below.
    // Refused parcels are kept regardless of date because their date lives in their history.
    if (range) {
        filter.$or = [
            { "sub_orders.delivered_at": range },
            { delivered_at: range },
            { "sub_orders.status": "returned" },
        ];
    }

    let query = Order.find(filter).select(PARCEL_ORDER_FIELDS).lean();
    if (populateUser) query = query.populate("user_id", "name email phone created_at");
    const cursor = query.cursor();

    for (let order = await cursor.next(); order != null; order = await cursor.next()) {
        let costs = null;
        for (const sub of order.sub_orders || []) {
            let kind = null;
            let at = null;
            if (parcelWasDelivered(sub)) { kind = "delivered"; at = parcelDeliveredAt(order, sub); }
            else if (parcelWasRefused(sub)) { kind = "refused"; at = parcelReturnedAt(order, sub); }
            if (!kind || !inRange(at ? new Date(at) : null)) continue;

            if (!costs) costs = await bostaCostService.costsForOrder(order);
            let cost = costs.get(String(sub._id)) || null;

            if (kind === "refused" && cost && !(Number(cost.rto) > 0)) {
                const shipment = require("./subOrderService").liveShipmentFor(order, sub);
                let rto = Number(shipment?.courier_cost?.rto || 0);
                if (!(rto > 0) && (!shipment?.provider || shipment.provider === "bosta")) {
                    const derived = await bostaCostService.costForParcel(order, sub, { source: "derived" });
                    rto = Number(derived?.rto || 0);
                }
                if (rto > 0) cost = { ...cost, rto: round2(rto), total: round2(Number(cost.total || 0) + rto) };
            }

            await onParcel({ order, sub, kind, at: new Date(at), cost });
        }
    }
};

/**
 * Who paid us, and what we actually kept from them.
 *
 * Grouped per customer over the period, on DELIVERED orders — an order still in transit
 * has not earned us anything yet and may still be refused at the door.
 */
const getCustomerRevenue = async ({ from, to, search = "", sort = "revenue", page = 1, limit = 25 } = {}) => {
    const range = dateRange(from, to);

    /* Commission actually charged, per order, from the earnings snapshot.
     *
     * Grouped in the database rather than fetched and summed here: the result is four
     * numbers per order instead of a document per parcel, which is what keeps this map
     * affordable when the range is "lifetime". Matched on the same delivered_at range as
     * the orders, so it never has to be told which order ids to look for. */
    const earningsByOrder = new Map();
    const earningRows = await VendorEarning.aggregate([
        { $match: range ? { delivered_at: range } : {} },
        {
            $group: {
                _id: "$order_id",
                commission: { $sum: "$commission_amount" },
                reversed: { $sum: "$reversed_commission" },
                merchandise: { $sum: "$gross_amount" },
                vendor_net: { $sum: "$effective_net" },
            },
        },
    ]);
    for (const row of earningRows) {
        earningsByOrder.set(String(row._id), {
            commission: row.commission,
            reversed: row.reversed,
            merchandise: row.merchandise,
            vendor_net: row.vendor_net,
        });
    }

    // Refunds that landed in this period, charged against the period they landed in.
    const refundFilter = { status: "completed" };
    if (range) refundFilter.completed_at = range;
    const refunds = await Refund.find(refundFilter).select("order_id total_refund_amount").lean();
    const refundByOrder = new Map();
    for (const r of refunds) {
        const key = String(r.order_id);
        refundByOrder.set(key, round2((refundByOrder.get(key) || 0) + Number(r.total_refund_amount || 0)));
    }

    const byCustomer = new Map();

    // Per parcel, for the same reasons as the profit report (see `forEachSettledParcel`): a
    // customer is worth what ARRIVED — the parcels they received, with their own share of
    // shipping and discounts — and a parcel they refused at the door costs us both legs.
    // The accumulator is keyed by CUSTOMER, so it stays bounded by how many people have
    // bought from us rather than by how many times they did.
    const orderSeen = new Map(); // customer -> Set(order ids)
    await forEachSettledParcel({
        range,
        populateUser: true,
        onParcel: ({ order, sub, kind, at, cost }) => {
            const user = order.user_id;
            if (!user?._id) return;
            const key = String(user._id);

            const entry = byCustomer.get(key) || {
                customer_id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                joined_at: user.created_at,
                orders: 0,
                gross_paid: 0,
                merchandise: 0,
                commission: 0,
                commission_reversed: 0,
                vendor_payable: 0,
                shipping_charged: 0,
                shipping_cost: 0,
                // Our share of the coupons this customer used; the vendors' share is beside it.
                coupon_discount: 0,
                coupon_vendor_funded: 0,
                loyalty_discount: 0,
                refunded: 0,
                refused_parcels: 0,
                first_order_at: null,
                last_order_at: null,
            };

            entry.shipping_cost += Number(cost?.total || 0);

            if (kind === "refused") {
                entry.refused_parcels += 1;
                byCustomer.set(key, entry);
                return;
            }

            const m = parcelMoney(sub);
            entry.gross_paid += m.gross;
            entry.shipping_charged += m.shipping;
            entry.coupon_discount += m.coupon_platform;
            entry.coupon_vendor_funded += m.coupon_vendor;
            entry.loyalty_discount += m.loyalty;

            // Commission and refunds are per ORDER in their ledgers, so they are taken once,
            // on the first delivered parcel of that order seen for this customer.
            const seen = orderSeen.get(key) || new Set();
            const orderKey = String(order._id);
            if (!seen.has(orderKey)) {
                seen.add(orderKey);
                orderSeen.set(key, seen);
                entry.orders += 1;
                const money = earningsByOrder.get(orderKey) || { commission: 0, reversed: 0, merchandise: 0, vendor_net: 0 };
                entry.merchandise += money.merchandise;
                entry.commission += money.commission;
                entry.commission_reversed += money.reversed;
                entry.vendor_payable += money.vendor_net;
                entry.refunded += refundByOrder.get(orderKey) || 0;
            }

            if (!entry.first_order_at || at < entry.first_order_at) entry.first_order_at = at;
            if (!entry.last_order_at || at > entry.last_order_at) entry.last_order_at = at;

            byCustomer.set(key, entry);
        },
    });

    let rows = [...byCustomer.values()].map((e) => {
        const commissionNet = round2(e.commission - e.commission_reversed);
        const shippingMargin = round2(e.shipping_charged - e.shipping_cost);
        // What this customer was worth to us: our commission plus the shipping margin,
        // less discounts we funded and anything refunded. The vendor's share never enters
        // it — that money was always theirs, it only passed through us.
        const netRevenue = round2(commissionNet + shippingMargin - e.coupon_discount - e.loyalty_discount);

        return {
            ...e,
            gross_paid: round2(e.gross_paid),
            merchandise: round2(e.merchandise),
            commission: round2(e.commission),
            commission_net: commissionNet,
            vendor_payable: round2(e.vendor_payable),
            shipping_charged: round2(e.shipping_charged),
            shipping_cost: round2(e.shipping_cost),
            shipping_margin: shippingMargin,
            coupon_discount: round2(e.coupon_discount),
            coupon_vendor_funded: round2(e.coupon_vendor_funded),
            loyalty_discount: round2(e.loyalty_discount),
            refunded: round2(e.refunded),
            net_revenue: netRevenue,
            average_order_value: e.orders ? round2(e.gross_paid / e.orders) : 0,
        };
    });

    if (search) {
        const needle = search.toLowerCase();
        rows = rows.filter(
            (r) =>
                (r.name || "").toLowerCase().includes(needle) ||
                (r.email || "").toLowerCase().includes(needle) ||
                (r.phone || "").toLowerCase().includes(needle)
        );
    }

    const sorters = {
        revenue: (a, b) => b.net_revenue - a.net_revenue,
        spend: (a, b) => b.gross_paid - a.gross_paid,
        orders: (a, b) => b.orders - a.orders,
        recent: (a, b) => new Date(b.last_order_at) - new Date(a.last_order_at),
    };
    rows.sort(sorters[sort] || sorters.revenue);

    const totals = rows.reduce(
        (acc, r) => ({
            customers: acc.customers + 1,
            orders: acc.orders + r.orders,
            gross_paid: round2(acc.gross_paid + r.gross_paid),
            merchandise: round2(acc.merchandise + r.merchandise),
            commission_net: round2(acc.commission_net + r.commission_net),
            vendor_payable: round2(acc.vendor_payable + r.vendor_payable),
            shipping_charged: round2(acc.shipping_charged + r.shipping_charged),
            shipping_cost: round2(acc.shipping_cost + r.shipping_cost),
            shipping_margin: round2(acc.shipping_margin + r.shipping_margin),
            coupon_discount: round2(acc.coupon_discount + r.coupon_discount),
            coupon_vendor_funded: round2(acc.coupon_vendor_funded + r.coupon_vendor_funded),
            loyalty_discount: round2(acc.loyalty_discount + r.loyalty_discount),
            refunded: round2(acc.refunded + r.refunded),
            net_revenue: round2(acc.net_revenue + r.net_revenue),
        }),
        {
            customers: 0, orders: 0, gross_paid: 0, merchandise: 0, commission_net: 0,
            vendor_payable: 0, shipping_charged: 0, shipping_cost: 0, shipping_margin: 0,
            coupon_discount: 0, coupon_vendor_funded: 0, loyalty_discount: 0, refunded: 0, net_revenue: 0,
        }
    );

    const start = (Math.max(1, Number(page)) - 1) * Number(limit);

    return {
        rows: rows.slice(start, start + Number(limit)),
        totals,
        pagination: {
            total: rows.length,
            page: Number(page),
            pages: Math.ceil(rows.length / Number(limit)) || 1,
            limit: Number(limit),
        },
    };
};

/**
 * The profit and loss for a period.
 *
 * Every revenue stream, every cost line, one bottom line. Ad spend is the only figure not
 * recognised on delivery — it is recognised on the days the campaign ran, apportioned, and
 * a campaign straddling the period boundary contributes only its overlapping days.
 */
/**
 * What Fawaterak kept from everything it collected for us, per source.
 *
 * Every hosted payment — an order, a vendor subscription, a wallet top-up, a packaging
 * order — is charged the same way, so all four are read here rather than only the one
 * the profit report happened to be looking at. Bucketed by `paid_at`: the fee is taken
 * the moment the customer pays, not when a parcel lands.
 *
 * A payment whose confirmation never recorded the fee (older top-ups stored only our own
 * confirmation summary, never Fawaterak's record) is priced off Fawaterak's published
 * rate — 2% + 2 EGP, plus VAT — because it was charged exactly like every other payment.
 * Those rows are reported as `estimated` so the total reads as the real bill while still
 * saying which part of it came from the tariff rather than the statement. Only a payment
 * on a provider with no confirmed rate stays `unpriced`.
 *
 * `onEach` lets the monthly chart bucket the same rows by date without a second scan.
 */
const scanGatewayFees = async ({ range = null, onEach = null } = {}) => {
    const sources = [
        { key: "orders", model: OrderPayment, dateField: "paid_at", amount: (d) => Number(d.amount || 0), provider: (d) => d.provider, payloads: (d) => d.webhook_payloads },
        { key: "subscriptions", model: SubscriptionPayment, dateField: "paid_at", amount: (d) => Number(d.amount || 0), provider: (d) => d.provider, payloads: (d) => d.webhook_payloads },
        // Wallets are kept in piastres so a balance can never drift; the fee is on pounds.
        { key: "topups", model: WalletTopup, dateField: "paid_at", amount: (d) => Number(d.amount_minor || 0) / 100, provider: (d) => d.provider, payloads: (d) => d.webhook_payloads },
        { key: "supplies", model: SupplyOrder, dateField: "payment.paid_at", amount: (d) => Number(d.total || 0), provider: (d) => d.payment?.provider, payloads: (d) => d.payment?.webhook_payloads },
    ];

    const result = { total: 0, payments: 0, unpriced: 0, estimated: 0, by_source: {} };

    for (const source of sources) {
        const filter = { [source.dateField]: range || { $ne: null } };
        const bucket = { total: 0, payments: 0, unpriced: 0, estimated: 0 };
        const cursor = source.model
            .find(filter)
            .select(`${source.dateField} amount amount_minor total provider payment.provider webhook_payloads payment.webhook_payloads`)
            .lean()
            .cursor();
        for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
            const { fee, estimated } = gatewayFeeFor({
                payloads: source.payloads(doc),
                amount: source.amount(doc),
                provider: source.provider(doc),
            });
            bucket.payments += 1;
            if (fee === null) bucket.unpriced += 1;
            else {
                bucket.total += fee;
                if (estimated) bucket.estimated += 1;
            }
            const at = source.dateField === "payment.paid_at" ? doc.payment?.paid_at : doc.paid_at;
            if (onEach) onEach({ source: source.key, at, fee, estimated });
        }
        result.by_source[source.key] = {
            total: round2(bucket.total),
            payments: bucket.payments,
            unpriced: bucket.unpriced,
            estimated: bucket.estimated,
        };
        result.total += bucket.total;
        result.payments += bucket.payments;
        result.unpriced += bucket.unpriced;
        result.estimated += bucket.estimated;
    }

    result.total = round2(result.total);
    return result;
};

const getProfitAndLoss = async ({ from, to, adSpendOverride = null } = {}) => {
    const range = dateRange(from, to);

    /* ---- Revenue: order commission ---- */
    const earningFilter = range ? { delivered_at: range } : {};
    const [commissionAgg] = await VendorEarning.aggregate([
        { $match: earningFilter },
        {
            $group: {
                _id: null,
                merchandise: { $sum: "$gross_amount" },
                commission_charged: { $sum: "$commission_amount" },
                commission_reversed: { $sum: "$reversed_commission" },
                vendor_net: { $sum: "$effective_net" },
                parcels: { $sum: 1 },
            },
        },
    ]);
    const commissionNet = round2((commissionAgg?.commission_charged || 0) - (commissionAgg?.commission_reversed || 0));

    /* ---- Revenue and cost: shipping, per parcel ---- */
    let shippingCharged = 0;
    let shippingCost = 0;
    // Only OUR share of the coupons is a cost. The vendor's share came off their earning
    // and is theirs to carry; it is reported beside the cost so the customer's discount
    // still reconciles, but it never touches the profit line.
    let couponDiscount = 0;
    let couponVendorFunded = 0;
    let loyaltyDiscount = 0;
    let grossOrderValue = 0;
    let estimatedParcels = 0;
    let orderCount = 0;
    const bostaBreakdown = { send: 0, extra_cod_fee: 0, pickup_share: 0, rto: 0 };
    let codFeeParcels = 0;

    let deliveredParcels = 0;
    let refusedParcels = 0;
    const deliveredOrders = new Set();

    // Streamed: with no date range this reads every parcel ever settled, and the lifetime
    // figure on the overview asks for exactly that. Every number below is an accumulator.
    await forEachSettledParcel({
        range,
        onParcel: ({ order, sub, kind, cost }) => {
            if (kind === "delivered") {
                const m = parcelMoney(sub);
                deliveredParcels += 1;
                deliveredOrders.add(String(order._id));
                shippingCharged += m.shipping;
                couponDiscount += m.coupon_platform;
                couponVendorFunded += m.coupon_vendor;
                loyaltyDiscount += m.loyalty;
                grossOrderValue += m.gross;
            } else {
                refusedParcels += 1;
            }

            if (!cost) return;
            shippingCost += Number(cost.total || 0);
            bostaBreakdown.send += Number(cost.send || 0);
            bostaBreakdown.extra_cod_fee += Number(cost.extra_cod_fee || 0);
            if (Number(cost.extra_cod_fee || 0) > 0) codFeeParcels += 1;
            bostaBreakdown.pickup_share += Number(cost.pickup_share || 0);
            bostaBreakdown.rto += Number(cost.rto || 0);
            // Costs we had to derive rather than read from a snapshot are estimates, and
            // the report says how much of it is estimated rather than quietly blending them.
            if (cost.source === "derived") estimatedParcels += 1;
        },
    });
    orderCount = deliveredOrders.size;

    /* ---- Revenue: vendor subscriptions ---- */
    const subFilter = { status: "paid", ...(range ? { paid_at: range } : {}) };
    const [subAgg] = await SubscriptionPayment.aggregate([
        { $match: subFilter },
        { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]);

    /* ---- Revenue: packaging supplies sold to vendors ---- */
    const supplyFilter = { payment_status: "paid", ...(range ? { createdAt: range } : {}) };
    const [supplyAgg] = await SupplyOrder.aggregate([
        { $match: supplyFilter },
        { $group: { _id: null, total: { $sum: "$total" }, count: { $sum: 1 } } },
    ]);

    /* ---- Cost: refunds we absorbed ---- */
    const refundFilter = { status: "completed", ...(range ? { completed_at: range } : {}) };
    const [refundAgg] = await Refund.aggregate([
        { $match: refundFilter },
        {
            $group: {
                _id: null,
                total: { $sum: "$total_refund_amount" },
                commission_reversed: { $sum: "$total_commission_reversal" },
                count: { $sum: 1 },
            },
        },
    ]);

    /* ---- Cost: what the gateway kept ---- */
    const gatewayFees = await scanGatewayFees({ range });

    /* ---- Cost: prepaid shipping bought and never used ---- */
    // Dated on the day the bundle closed, because that is the day the money was actually
    // lost — up to that moment the parcels were still shippable.
    const bundleWaste = await require("./bostaBundleService")
        .wastedBundleValue(range)
        .catch(() => ({ orders: 0, amount: 0 }));

    /* ---- Cost: marketing ---- */
    const adSpend = await getAdSpendForPeriod({ from, to });
    const adSpendApplied = adSpendOverride !== null && adSpendOverride !== undefined && adSpendOverride !== ""
        ? round2(adSpendOverride)
        : adSpend.total;

    /* ---- The bottom line ---- */
    const subscriptionRevenue = round2(subAgg?.total || 0);
    const supplyRevenue = round2(supplyAgg?.total || 0);

    // Through the shared helper, so this and the monthly chart can never disagree.
    const totals = composeTotals({
        commission_charged: commissionAgg?.commission_charged || 0,
        commission_reversed: commissionAgg?.commission_reversed || 0,
        shipping_charged: shippingCharged,
        shipping_cost: shippingCost,
        gateway_fees: gatewayFees.total,
        subscriptions: subscriptionRevenue,
        supplies: supplyRevenue,
        coupon_discounts: couponDiscount,
        loyalty_discounts: loyaltyDiscount,
        ad_spend: adSpendApplied,
        bundle_waste: bundleWaste.amount,
    });

    const shippingMargin = totals.shipping_margin;
    const totalRevenue = totals.revenue;
    const totalCosts = totals.costs;
    const netProfit = totals.profit;

    return {
        period: { from: from || null, to: to || null },

        revenue: {
            commission_charged: round2(commissionAgg?.commission_charged || 0),
            commission_reversed: round2(commissionAgg?.commission_reversed || 0),
            commission_net: commissionNet,
            shipping_charged: round2(shippingCharged),
            subscriptions: subscriptionRevenue,
            subscription_count: subAgg?.count || 0,
            supplies: supplyRevenue,
            supply_order_count: supplyAgg?.count || 0,
            total: totalRevenue,
        },

        costs: {
            // The delivery legs only. Bosta's COD fee is part of the same invoice but is
            // the price of collecting money, not of moving a box, so it is shown on the
            // collection line below — the two lines add up to the Bosta bill.
            shipping_paid_to_bosta: round2(shippingCost - bostaBreakdown.extra_cod_fee),
            bosta_breakdown: {
                send: round2(bostaBreakdown.send),
                extra_cod_fee: round2(bostaBreakdown.extra_cod_fee),
                pickup_share: round2(bostaBreakdown.pickup_share),
                rto: round2(bostaBreakdown.rto),
            },
            // The price of getting paid: what Bosta charges to carry the cash on a COD
            // parcel, and what Fawaterak keeps from a card payment.
            collection: {
                bosta_cod: round2(bostaBreakdown.extra_cod_fee),
                // Parcels that actually incurred the fee — on this tier only a COD above
                // 2000 EGP does, so most cash parcels cost nothing to collect.
                bosta_cod_parcels: codFeeParcels,
                gateway: gatewayFees.total,
                gateway_payments: gatewayFees.payments,
                // Priced off Fawaterak's 2% + 2 EGP rate because the confirmation stored
                // no fee figure. Part of the total, not a gap in it.
                gateway_estimated: gatewayFees.estimated,
                gateway_unpriced: gatewayFees.unpriced,
                gateway_by_source: gatewayFees.by_source,
                total: round2(bostaBreakdown.extra_cod_fee + gatewayFees.total),
            },
            // Prepaid shipping that expired unused. Its own line because it is a loss with
            // its own cause and its own fix — buy a smaller bundle, or ship more before it
            // expires — and because it belongs to no order.
            bundle_waste: round2(bundleWaste.amount),
            bundle_waste_orders: bundleWaste.orders,
            // Our share of the coupons given on delivered parcels. The vendors' share is
            // beside it, not in it: it reduced their payout, not our profit.
            coupon_discounts: round2(couponDiscount),
            coupon_vendor_funded: round2(couponVendorFunded),
            coupon_total: round2(couponDiscount + couponVendorFunded),
            loyalty_discounts: round2(loyaltyDiscount),
            ad_spend: adSpendApplied,
            ad_spend_is_override: adSpendApplied !== adSpend.total,
            total: totalCosts,
        },

        // Not a cost — it was never ours. Shown so the gross order value reconciles.
        pass_through: {
            vendor_earnings: round2(commissionAgg?.vendor_net || 0),
            refunds_to_customers: round2(refundAgg?.total || 0),
            refund_count: refundAgg?.count || 0,
        },

        result: {
            gross_order_value: round2(grossOrderValue),
            merchandise: round2(commissionAgg?.merchandise || 0),
            shipping_margin: shippingMargin,
            net_profit: netProfit,
            is_profit: netProfit >= 0,
            margin_percent: totals.margin_percent,
            // Return on ad spend: revenue earned for each pound of marketing.
            roas: adSpendApplied > 0 ? round2(totalRevenue / adSpendApplied) : null,
            profit_per_order: orderCount ? round2(netProfit / orderCount) : 0,
            // Orders with at least one parcel delivered in the period, and those parcels.
            orders: orderCount,
            parcels: deliveredParcels,
            // Refused at the door and carried back: cost, no revenue.
            refused_parcels: refusedParcels,
        },

        // How much of the shipping cost is an estimate rather than a snapshot, so nobody
        // reconciles this against a Bosta invoice without knowing.
        data_quality: {
            estimated_parcel_costs: estimatedParcels,
            total_parcels: deliveredParcels + refusedParcels,
        },

        ad_spend_detail: adSpend,
    };
};

/* ================================================================== */
/*  AD SPEND                                                          */
/* ================================================================== */

/** Ad spend overlapping a period, apportioned by day and broken down by channel. */
const getAdSpendForPeriod = async ({ from, to } = {}) => {
    const filter = {};
    // Overlap, not containment: a campaign running across the whole quarter belongs
    // partly to every month in it.
    if (from) filter.end_date = { $gte: new Date(from) };
    if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        filter.start_date = { $lte: end };
    }

    const entries = await AdSpend.find(filter).sort({ start_date: -1 });

    const byChannel = {};
    let total = 0;

    const rows = entries.map((entry) => {
        const applied = entry.amountWithin(from, to);
        total += applied;
        byChannel[entry.channel] = round2((byChannel[entry.channel] || 0) + applied);
        return {
            _id: entry._id,
            channel: entry.channel,
            campaign: entry.campaign,
            amount: entry.amount,
            amount_in_period: applied,
            start_date: entry.start_date,
            end_date: entry.end_date,
            notes: entry.notes,
            created_by_label: entry.created_by_label,
            created_at: entry.created_at,
        };
    });

    return { total: round2(total), by_channel: byChannel, entries: rows, count: rows.length };
};

const createAdSpend = async (data, adminLabel = "Admin") => {
    const entry = await AdSpend.create({
        channel: data.channel,
        campaign: data.campaign || "",
        amount: data.amount,
        start_date: data.start_date,
        end_date: data.end_date || data.start_date,
        notes: data.notes || "",
        created_by_label: adminLabel,
        history: [
            {
                action: "ad_spend_created",
                title: "Ad spend recorded",
                details: `${data.amount} EGP on ${data.channel}.`,
                actor_label: adminLabel,
            },
        ],
    });

    recordAuditLog({
        action: "ad_spend_created",
        actor: { role: "admin", label: adminLabel },
        target_type: "ad_spend",
        target_id: entry._id,
        target_snapshot: {
            amount: entry.amount,
            channel: entry.channel,
            campaign: entry.campaign,
            start_date: entry.start_date,
            end_date: entry.end_date,
        },
    });

    return entry;
};

const updateAdSpend = async (id, data, adminLabel = "Admin") => {
    const entry = await AdSpend.findById(id);
    if (!entry) {
        const err = new Error("Ad spend entry not found");
        err.code = "NOT_FOUND";
        throw err;
    }

    const before = { amount: entry.amount, channel: entry.channel, start_date: entry.start_date, end_date: entry.end_date };

    for (const field of ["channel", "campaign", "amount", "start_date", "end_date", "notes"]) {
        if (data[field] !== undefined) entry[field] = data[field];
    }
    entry.updated_at = new Date();
    entry.history.push({
        action: "ad_spend_updated",
        title: "Ad spend updated",
        details: `Changed from ${before.amount} EGP (${before.channel}) to ${entry.amount} EGP (${entry.channel}).`,
        actor_label: adminLabel,
        metadata: { before },
    });

    await entry.save();
    return entry;
};

const deleteAdSpend = async (id, adminLabel = "Admin") => {
    const entry = await AdSpend.findByIdAndDelete(id);
    if (!entry) {
        const err = new Error("Ad spend entry not found");
        err.code = "NOT_FOUND";
        throw err;
    }

    recordAuditLog({
        action: "ad_spend_deleted",
        actor: { role: "admin", label: adminLabel },
        target_type: "ad_spend",
        target_id: entry._id,
        // The whole entry, because after this the row is gone and the log is all that is
        // left to explain why a past period's profit figure changed.
        target_snapshot: {
            amount: entry.amount,
            channel: entry.channel,
            campaign: entry.campaign,
            start_date: entry.start_date,
            end_date: entry.end_date,
            notes: entry.notes,
        },
    });

    return entry;
};

/* ================================================================== */
/*  4. OVERVIEW — WHERE THE COMPANY STANDS                            */
/* ================================================================== */

/**
 * The whole company on one screen: what we hold, what we owe, what we have earned.
 *
 * Deliberately mixes two kinds of number, and labels which is which:
 *
 *   POSITION  a balance as of right now — what we owe vendors today. No date range
 *             applies to it; it is a fact about the present.
 *   FLOW      what happened over a period — this month's profit. Meaningless without
 *             its dates.
 *
 * Reporting a balance beside a period figure without saying which is which is how a
 * dashboard ends up quietly comparing a stock to a flow.
 */
const getFinanceOverview = async ({ from, to } = {}) => {
    const now = new Date();

    /* ---- POSITION ---- */
    const [balances] = await VendorEarning.aggregate([
        {
            $group: {
                _id: null,
                held: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "pending"] }, NOT_FROZEN] }, "$effective_net", 0] } },
                payable: { $sum: { $cond: [IS_PAYABLE, "$effective_net", 0] } },
                frozen: { $sum: { $cond: [IS_FROZEN, "$effective_net", 0] } },
                in_payout: { $sum: { $cond: [IS_IN_PAYOUT, "$effective_net", 0] } },
                paid_out: { $sum: { $cond: [IS_PAID, "$effective_net", 0] } },
                lifetime_commission: { $sum: "$commission_amount" },
                lifetime_reversed: { $sum: "$reversed_commission" },
                lifetime_merchandise: { $sum: "$gross_amount" },
            },
        },
    ]);

    // Vendor-initiated requests still waiting on an admin. A separate queue from the
    // scheduled payout, and one the admin can be blocking without realising.
    const [openWithdrawals] = await WithdrawalRequest.aggregate([
        { $match: { status: { $in: ["pending", "approved", "processing"] } } },
        { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]);

    const globalSchedule = await payoutSchedule.getGlobalSchedule();

    // Vendors whose money was due on a payout date that has already gone by.
    const overdueRows = await VendorEarning.aggregate([
        { $match: { status: "available", payout_id: null, "frozen.active": { $ne: true } } },
        { $group: { _id: "$vendor_id", amount: { $sum: "$effective_net" }, oldest: { $min: "$clearable_at" } } },
    ]);
    let overdueAmount = 0;
    let overdueVendors = 0;
    for (const row of overdueRows) {
        const due = payoutSchedule.nextPayoutOnOrAfter(globalSchedule, row.oldest);
        if (due && due < payoutSchedule.startOfDay(now)) {
            overdueAmount += row.amount;
            overdueVendors += 1;
        }
    }

    /* ---- FLOW ---- */
    const period = await getProfitAndLoss({ from, to });
    const lifetime = await getProfitAndLoss({});

    // Committed but not landed. Kept beside `position` and never folded into it: one is
    // money we hold, the other is money on its way, and adding them would overstate both.
    const pipeline = await getPipelineSnapshot();

    // Cash the couriers collected at the door and have not transferred yet. It is OURS and
    // it is not here — which is why it sits in `position` beside what we owe, and is added
    // to nothing: it is neither revenue (already recognised on delivery) nor pipeline (that
    // is money not yet collected).
    const courierCash = await require("./courierSettlementService")
        .getCashPositions()
        .catch((err) => {
            console.error(`[Finance] Courier cash position failed: ${err.message}`);
            return null;
        });

    return {
        position: {
            as_of: now,
            owed_to_vendors_now: round2(balances?.payable || 0),
            held_in_return_window: round2(balances?.held || 0),
            // Stopped by an admin, and claimed by a payout that has not finished yet.
            frozen_by_admin: round2(balances?.frozen || 0),
            in_payouts_under_way: round2(balances?.in_payout || 0),
            // Everything we will owe once every window closes, if nothing is refunded.
            total_vendor_liability: round2(
                (balances?.payable || 0) + (balances?.held || 0) + (balances?.frozen || 0) + (balances?.in_payout || 0)
            ),
            paid_to_vendors_lifetime: round2(balances?.paid_out || 0),
            open_withdrawal_requests: {
                amount: round2(openWithdrawals?.total || 0),
                count: openWithdrawals?.count || 0,
            },
            overdue: { amount: round2(overdueAmount), vendors: overdueVendors },
            next_payout_at: payoutSchedule.nextPayoutOnOrAfter(globalSchedule, now),
            schedule_label: payoutSchedule.describeSchedule(globalSchedule),
            // What the couriers are holding for us on delivered cash orders.
            cash_at_couriers: courierCash
                ? {
                    total: courierCash.totals.outstanding,
                    parcels: courierCash.totals.parcels,
                    by_courier: courierCash.couriers
                        .filter((c) => c.outstanding > 0 || c.parcels > 0)
                        .map((c) => ({ provider: c.provider, label: c.label, amount: c.outstanding, parcels: c.parcels })),
                }
                : null,
        },

        pipeline,

        period,
        lifetime: {
            revenue: lifetime.revenue,
            costs: lifetime.costs,
            result: lifetime.result,
        },

        schedule: {
            ...globalSchedule,
            label: payoutSchedule.describeSchedule(globalSchedule),
            upcoming: payoutSchedule.upcomingPayouts(globalSchedule, { count: 5 }),
        },
    };
};

/** A cart nobody has touched in this long is a leftover, not a live intention to buy. */
const ACTIVE_CART_DAYS = 14;

/**
 * Money that is committed but has not landed — the three stages between a customer picking
 * something up and the goods reaching their door.
 *
 * Deliberately NOT part of the P&L, and it shares no total with it. Nothing here has been
 * earned and none of it is owed to a vendor yet: `position` in the overview answers "what do
 * we hold and what do we owe", this answers "what is on its way". Adding a cart to revenue
 * is precisely the mistake the separation exists to prevent.
 *
 * COUNTING. A parcel is the thing that carries a status, and one order can have parcels at
 * two stages at once — two vendors moving at different speeds. So each stage reports both
 * `parcels` (what the number actually counts) and `orders` (the distinct orders behind
 * them). An order split across two stages appears in both, which is right: part of it is in
 * each. The two figures are never added together.
 *
 * AMOUNTS. `merchandise` is the goods alone, which is what the vendor is holding or has
 * shipped. `collectable` is what the customer actually pays for that parcel — goods plus its
 * share of shipping, minus its share of coupon and loyalty. They answer different questions
 * ("how much stock is sitting there" vs "how much cash is this worth"), so both are given
 * rather than one being picked for the reader.
 */
const getPipelineSnapshot = async () => {
    const activeSince = new Date(Date.now() - ACTIVE_CART_DAYS * 24 * 60 * 60 * 1000);

    /* ---- 1. CARTS -------------------------------------------------------------------
     * A cart row stores product_id, variant_id and quantity — never a price. So its value
     * can only be "what this would cost if they checked out now", read from the live
     * product. It is not a captured amount, and it moves when prices move.
     */
    const [cartRow] = await User.aggregate([
        { $match: { "cart.items.0": { $exists: true } } },
        { $project: { updated_at: "$cart.updated_at", items: "$cart.items" } },
        { $unwind: "$items" },
        { $lookup: { from: "products", localField: "items.product_id", foreignField: "_id", as: "p" } },
        { $unwind: { path: "$p", preserveNullAndEmptyArrays: true } },
        { $lookup: { from: "sellers", localField: "p.vendor_id", foreignField: "_id", as: "v" } },
        { $unwind: { path: "$v", preserveNullAndEmptyArrays: true } },
        {
            $addFields: {
                // A bundle's price is recomputed from its members' current prices and is
                // never stored, so it cannot be read here. Bundle lines are counted and
                // reported separately rather than valued at zero inside a total that would
                // then quietly understate.
                is_bundle: { $ne: [{ $ifNull: ["$items.bundle_id", null] }, null] },
                // The same lines the storefront drops from a cart. A draft product or a
                // suspended vendor cannot be bought, so counting it would inflate the
                // figure with money nobody is able to spend.
                sellable: {
                    $and: [
                        { $ne: [{ $ifNull: ["$p", null] }, null] },
                        { $ne: ["$p.status", "draft"] },
                        { $ne: ["$v.status", "suspended"] },
                    ],
                },
                variant: {
                    $first: {
                        $filter: {
                            input: { $ifNull: ["$p.variants", []] },
                            as: "vr",
                            cond: { $eq: ["$$vr._id", "$items.variant_id"] },
                        },
                    },
                },
            },
        },
        {
            $addFields: {
                // Same precedence as the product page: the variant overrides the product,
                // and a discount overrides the base price at whichever level won.
                unit_price: {
                    $ifNull: [
                        "$variant.discount_price",
                        {
                            $ifNull: [
                                "$variant.price",
                                { $ifNull: ["$p.discount_price", { $ifNull: ["$p.price", 0] }] },
                            ],
                        },
                    ],
                },
                counts: { $and: [{ $eq: ["$is_bundle", false] }, "$sellable"] },
            },
        },
        {
            $group: {
                _id: "$_id",
                updated_at: { $first: "$updated_at" },
                value: { $sum: { $cond: ["$counts", { $multiply: ["$unit_price", "$items.quantity"] }, 0] } },
                units: { $sum: { $cond: ["$counts", "$items.quantity", 0] } },
                bundle_lines: { $sum: { $cond: ["$is_bundle", 1, 0] } },
            },
        },
        {
            $group: {
                _id: null,
                // A cart counts only if something in it can still be bought. Two of the
                // first four carts on this install pointed entirely at deleted products —
                // they are rows in the collection, but a customer opening one sees an
                // empty cart, and counting them would report demand that does not exist.
                carts: { $sum: { $cond: [{ $gt: ["$units", 0] }, 1, 0] } },
                stale_carts: { $sum: { $cond: [{ $eq: ["$units", 0] }, 1, 0] } },
                value: { $sum: "$value" },
                units: { $sum: "$units" },
                bundle_lines: { $sum: "$bundle_lines" },
                active_carts: {
                    $sum: {
                        $cond: [
                            { $and: [{ $gte: ["$updated_at", activeSince] }, { $gt: ["$units", 0] }] },
                            1,
                            0,
                        ],
                    },
                },
                active_value: { $sum: { $cond: [{ $gte: ["$updated_at", activeSince] }, "$value", 0] } },
            },
        },
    ]);

    /* ---- 2 & 3. PARCELS IN FLIGHT ---------------------------------------------------
     * Both stages come from ONE pass over the sub-orders, bucketed by status, so the two
     * figures are always read from the same snapshot of the collection and cannot disagree
     * because a parcel moved between two queries.
     */
    const stageRows = await Order.aggregate([
        { $match: { status: { $nin: ["cancelled"] } } },
        { $unwind: "$sub_orders" },
        {
            $match: {
                "sub_orders.status": { $in: [...AT_VENDOR_STATUSES, ...IN_TRANSIT_STATUSES] },
            },
        },
        {
            $group: {
                _id: {
                    stage: {
                        $cond: [
                            { $in: ["$sub_orders.status", AT_VENDOR_STATUSES] },
                            "at_vendor",
                            "in_transit",
                        ],
                    },
                    status: "$sub_orders.status",
                },
                parcels: { $sum: 1 },
                orders: { $addToSet: "$_id" },
                vendors: { $addToSet: "$sub_orders.vendor_id" },
                merchandise: { $sum: { $ifNull: ["$sub_orders.merchandise_total", 0] } },
                collectable: { $sum: { $ifNull: ["$sub_orders.cod_amount", 0] } },
            },
        },
    ]);

    const emptyStage = () => ({
        parcels: 0,
        orders: new Set(),
        vendors: new Set(),
        merchandise: 0,
        collectable: 0,
        by_status: {},
    });
    const stages = { at_vendor: emptyStage(), in_transit: emptyStage() };

    for (const row of stageRows) {
        const stage = stages[row._id.stage];
        stage.parcels += row.parcels;
        stage.merchandise += row.merchandise;
        stage.collectable += row.collectable;
        row.orders.forEach((id) => stage.orders.add(String(id)));
        row.vendors.forEach((id) => stage.vendors.add(String(id)));
        // The per-status split is what makes the headline actionable: "still with the
        // vendor" is one number, but a parcel nobody has reviewed and a parcel sealed and
        // waiting for a courier need two different phone calls.
        stage.by_status[row._id.status] = {
            parcels: row.parcels,
            merchandise: round2(row.merchandise),
            collectable: round2(row.collectable),
        };
    }

    const shape = (stage) => ({
        parcels: stage.parcels,
        orders: stage.orders.size,
        vendors: stage.vendors.size,
        merchandise: round2(stage.merchandise),
        collectable: round2(stage.collectable),
        by_status: stage.by_status,
    });

    return {
        as_of: new Date(),
        carts: {
            count: cartRow?.carts || 0,
            value: round2(cartRow?.value || 0),
            units: cartRow?.units || 0,
            // Touched inside the active window — the half of the number that is still a
            // live intention rather than an abandoned leftover.
            active_count: cartRow?.active_carts || 0,
            active_value: round2(cartRow?.active_value || 0),
            active_window_days: ACTIVE_CART_DAYS,
            // Lines this figure could not price. Surfaced rather than swallowed, so the
            // total is read as "at least this much" when it is not zero.
            unpriced_bundle_lines: cartRow?.bundle_lines || 0,
            // Carts holding nothing buyable any more — every line points at a deleted or
            // unpublished product. Not demand; a cleanup signal.
            stale_count: cartRow?.stale_carts || 0,
        },
        at_vendor: shape(stages.at_vendor),
        in_transit: shape(stages.in_transit),
    };
};

/**
 * Revenue and profit bucketed by month, for the overview chart.
 *
 * Computed in ONE pass over the whole window rather than by calling `getProfitAndLoss`
 * twelve times. The naive version re-read twelve overlapping slices of the same
 * collections and, worse, re-derived the Bosta cost of every uncosted parcel once per
 * month it looked at — the single most expensive thing in this file, repeated.
 *
 * The per-month arithmetic goes through `composeTotals`, the same helper the single-period
 * report uses, so the chart and the headline figure can never drift apart.
 */
const getMonthlyTrend = async ({ months = 12 } = {}) => {
    const capped = Math.min(24, Math.max(1, Number(months) || 12));
    const now = new Date();

    const windowStart = new Date(now.getFullYear(), now.getMonth() - (capped - 1), 1);
    const windowEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // `YYYY-MM` in LOCAL time — the same basis the month boundaries above are built on.
    // Using UTC here would file an order placed late on the 31st into the wrong month.
    const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    const buckets = new Map();
    for (let i = capped - 1; i >= 0; i -= 1) {
        const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
        buckets.set(monthKey(start), {
            month: monthKey(start),
            from: start,
            to: new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999),
            commission_charged: 0,
            commission_reversed: 0,
            shipping_charged: 0,
            shipping_cost: 0,
            bundle_waste: 0,
            gateway_fees: 0,
            coupon_discounts: 0,
            loyalty_discounts: 0,
            subscriptions: 0,
            supplies: 0,
            ad_spend: 0,
            orders: 0,
        });
    }

    const add = (date, field, value) => {
        const bucket = buckets.get(monthKey(new Date(date)));
        if (bucket) bucket[field] += Number(value || 0);
    };

    /* Every line below is bucketed in JS by the SAME local-time `monthKey`.
     *
     * Deliberately not `$group` on `{ $year, $month }`: those bucket in UTC, and the order
     * scan below buckets in local time. In Egypt (UTC+2/+3) an order delivered just after
     * midnight on the 1st is still the previous month in UTC — so the commission line and
     * the shipping line of one bucket would be describing two different months, and only
     * near month boundaries, which is exactly the kind of discrepancy nobody finds. */

    const streamInto = async (query, dateField, apply) => {
        const cursor = query.lean().cursor();
        for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
            apply(doc, doc[dateField]);
        }
    };

    /* ---- Commission ---- */
    await streamInto(
        VendorEarning.find({ delivered_at: { $gte: windowStart, $lte: windowEnd } })
            .select("delivered_at commission_amount reversed_commission"),
        "delivered_at",
        (e, at) => {
            add(at, "commission_charged", e.commission_amount);
            add(at, "commission_reversed", e.reversed_commission);
        }
    );

    /* ---- Parcels: revenue when delivered, cost when delivered or refused ---- */
    // Same rules as the single-period report (`forEachSettledParcel`), so the chart and the
    // headline can never disagree. An order is counted in each month it had a delivery.
    const ordersByMonth = new Map();
    await forEachSettledParcel({
        range: { $gte: windowStart, $lte: windowEnd },
        onParcel: ({ order, sub, kind, at, cost }) => {
            if (kind === "delivered") {
                const m = parcelMoney(sub);
                add(at, "shipping_charged", m.shipping);
                // Same rule as the headline: only the platform's share of a coupon is a cost.
                add(at, "coupon_discounts", m.coupon_platform);
                add(at, "loyalty_discounts", m.loyalty);
                const month = monthKey(at);
                const seen = ordersByMonth.get(month) || new Set();
                if (!seen.has(String(order._id))) {
                    seen.add(String(order._id));
                    ordersByMonth.set(month, seen);
                    add(at, "orders", 1);
                }
            }
            add(at, "shipping_cost", cost?.total);
        },
    });

    /* ---- Subscriptions and supplies ---- */
    await streamInto(
        SubscriptionPayment.find({ status: "paid", paid_at: { $gte: windowStart, $lte: windowEnd } }).select("paid_at amount"),
        "paid_at",
        (p, at) => add(at, "subscriptions", p.amount)
    );

    await streamInto(
        SupplyOrder.find({ payment_status: "paid", createdAt: { $gte: windowStart, $lte: windowEnd } }).select("createdAt total"),
        "createdAt",
        (s, at) => add(at, "supplies", s.total)
    );

    /* ---- Prepaid shipping that expired unused, on the day its bundle closed ---- */
    // In the chart for the same reason it is in the headline: a month that let a bundle
    // expire half-used did worse than its orders suggest, and the two views of the same
    // month must not disagree.
    const { BostaBundleCycle } = require("../models/bostaBundles");
    await streamInto(
        BostaBundleCycle.find({ closed_at: { $gte: windowStart, $lte: windowEnd }, wasted_amount: { $gt: 0 } })
            .select("closed_at wasted_amount"),
        "closed_at",
        (c, at) => add(at, "bundle_waste", c.wasted_amount)
    );

    /* ---- Gateway fees, by the day the customer paid ---- */
    await scanGatewayFees({
        range: { $gte: windowStart, $lte: windowEnd },
        onEach: ({ at, fee }) => { if (fee !== null) add(at, "gateway_fees", fee); },
    });

    /* ---- Ad spend, apportioned into each month it overlaps ---- */
    const adEntries = await AdSpend.find({ end_date: { $gte: windowStart }, start_date: { $lte: windowEnd } });
    for (const bucket of buckets.values()) {
        for (const entry of adEntries) {
            bucket.ad_spend += entry.amountWithin(bucket.from, bucket.to);
        }
    }

    return [...buckets.values()].map((b) => {
        const totals = composeTotals(b);
        return {
            month: b.month,
            from: b.from,
            to: b.to,
            revenue: totals.revenue,
            costs: totals.costs,
            profit: totals.profit,
            orders: b.orders,
            commission: totals.commission_net,
            shipping_margin: totals.shipping_margin,
            ad_spend: round2(b.ad_spend),
        };
    });
};

module.exports = {
    // Vendors
    listVendorBalances,
    getVendorLedger,
    payEarnings,
    listVendorPayouts,
    // Commissions
    getCommissionLedger,
    // Customers & profit
    getCustomerRevenue,
    getProfitAndLoss,
    // Ad spend
    getAdSpendForPeriod,
    createAdSpend,
    updateAdSpend,
    deleteAdSpend,
    // Overview
    getFinanceOverview,
    getPipelineSnapshot,
    getMonthlyTrend,
    // Shared parcel rules, so other reports count money exactly the way these screens do.
    dateRange,
    parcelMoney,
    parcelWasDelivered,
    parcelWasRefused,
    parcelDeliveredAt,
    parcelReturnedAt,
};
