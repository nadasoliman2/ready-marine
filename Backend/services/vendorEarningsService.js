/**
 * Vendor Earnings Service
 * -----------------------
 * Manages the per-(order, vendor) earnings ledger and the cached wallet
 * balances on the Seller document.
 *
 * Rules (confirmed with product owner):
 *  - "Received by buyer" = order status 'completed' with delivered_at set.
 *  - Net earned per (order, vendor) = subtotal - commission (shipping EXCLUDED).
 *  - Earnings are HELD until the 14-day return window closes AND no open
 *    return exists for that (order, vendor), then become withdrawable.
 *  - Same rule for all payment methods, including COD/cash.
 */

const { VendorEarning } = require("../models/vendorEarnings");
const { WithdrawalRequest } = require("../models/withdrawalRequests");
const { Order } = require("../models/orders");
const { ReturnRequest } = require("../models/returnRequests");
const { Seller } = require("../models/sellers");
const { createNotification } = require("../models/notifications");
const payoutSchedule = require("./payoutScheduleService");

/**
 * When a parcel delivered at `deliveredAt` becomes payable, and the settlement period that
 * produced the date. The period is the vendor's schedule hold_days (their override, else the
 * global setting), never shorter than the customer return window.
 */
const settlementFor = async (vendorId, deliveredAt) => {
  let holdDays;
  try {
    holdDays = payoutSchedule.effectiveHoldDays(await payoutSchedule.getScheduleForVendor(vendorId));
  } catch (err) {
    // The earning must be recorded even if settings cannot be read; the return window is
    // the floor the setting could never go under anyway.
    console.error(`[Earnings] Could not read the settlement period for vendor ${vendorId}: ${err.message}`);
    holdDays = payoutSchedule.effectiveHoldDays(null);
  }
  const clearableAt = new Date(deliveredAt);
  clearableAt.setDate(clearableAt.getDate() + holdDays);
  return { holdDays, clearableAt };
};

const round2 = (n) => Number((Number(n) || 0).toFixed(2));

// Return statuses that are terminal (no longer "open").
const TERMINAL_RETURN_STATUSES = ["rejected", "vendor_rejected", "cancelled", "completed"];

/* ------------------------------------------------------------------ */
/*  Earning creation (idempotent via unique {order_id, sub_order_id}) */
/* ------------------------------------------------------------------ */

/**
 * Record what one delivered PARCEL earned its vendor.
 *
 * Called the moment that parcel is delivered — not when the order finishes — so a vendor
 * who delivered on Monday starts their holding period on Monday, whatever the slowest
 * vendor on the same order is doing. The holding window likewise runs from this parcel's
 * own delivery date, matching the return window the customer sees on its card.
 *
 * Idempotent: delivery reaches us from a webhook, the polling sweep, and admin overrides.
 */
const ensureEarningForSubOrder = async (order, subOrder) => {
  if (!subOrder || !subOrder.vendor_id) return null;
  if (subOrder.status === "cancelled") return null;

  const existing = await VendorEarning.findOne({ order_id: order._id, sub_order_id: subOrder._id });
  if (existing) return existing;

  // The parcel's own merchandise and commission — never the vendor's order-wide totals,
  // which for a two-branch vendor would pay them twice.
  //
  // The coupon: only the vendor's agreed share of it comes off their money. The platform's
  // share was never theirs to fund and is booked as our cost in the P&L instead.
  const gross = round2(subOrder.merchandise_total);
  const couponShare = round2(subOrder.coupon_vendor_share || 0);
  const commission = round2(subOrder.commission_total);
  const net = round2(gross - couponShare - commission);

  const deliveredAt = subOrder.delivered_at || order.delivered_at || new Date();
  const { holdDays, clearableAt } = await settlementFor(subOrder.vendor_id, deliveredAt);

  try {
    const created = await VendorEarning.create({
      hold_days: holdDays,
      order_id: order._id,
      sub_order_id: subOrder._id,
      vendor_id: subOrder.vendor_id,
      gross_amount: gross,
      coupon_share: couponShare,
      commission_amount: commission,
      net_amount: net,
      reversed_net: 0,
      reversed_commission: 0,
      reversed_coupon: 0,
      effective_net: Math.max(0, net),
      status: "pending",
      payment_method: order.transaction?.payment_method,
      delivered_at: deliveredAt,
      clearable_at: clearableAt,
      history: [
        {
          action: "earning_created",
          title: "Earning recorded",
          details:
            `Net ${net} EGP recorded for delivered parcel ${subOrder.reference || subOrder._id}` +
            (couponShare > 0 ? ` (after ${couponShare} EGP vendor share of the coupon)` : "") +
            `. Held until ${clearableAt.toISOString().slice(0, 10)}.`,
          metadata: { gross, coupon_share: couponShare, commission, net, sub_order_id: subOrder._id },
        },
      ],
    });
    // The vendor's cached wallet is what their dashboard reads. Without this it only caught
    // up when they opened the wallet page or when money cleared, so a delivered parcel was
    // missing from "pending" for days (Super Edge read 530.16 against a ledger of 746.16).
    // Best-effort: the earning is recorded either way, and every later recompute converges.
    await recomputeWalletBalances(subOrder.vendor_id).catch((err) =>
      console.error(`[Earnings] Wallet recompute after parcel ${subOrder._id} failed: ${err.message}`));
    return created;
  } catch (err) {
    if (err.code === 11000) {
      const existing = await VendorEarning.findOne({ order_id: order._id, sub_order_id: subOrder._id });
      if (existing) return existing;

      // A duplicate with no row for THIS parcel means the legacy unique
      // {order_id, vendor_id} index is still on the collection — Mongoose never drops an
      // index a schema stopped declaring. It forbids a vendor earning on two parcels of one
      // order, which is precisely what shipping from two branches produces, and it would
      // otherwise lose this parcel's money in silence.
      console.error(
        `[Earnings] Could not record parcel ${subOrder._id} on order ${order._id}: the legacy ` +
        `unique {order_id, vendor_id} index is still present on vendorEarnings. ` +
        `Run: node scripts/migrateOrdersToSubOrders.js --apply`
      );
      return null;
    }
    throw err;
  }
};

/**
 * Ensure a VendorEarning exists for a given order + vendor supervision.
 * Returns the earning document (existing or newly created). Idempotent.
 *
 * Legacy path, for orders that predate parcels and were never migrated.
 */
const ensureEarningForSupervision = async (order, supervision) => {
  const vendorId = supervision.vendor_id;
  if (!vendorId) return null;

  const existing = await VendorEarning.findOne({ order_id: order._id, vendor_id: vendorId });
  if (existing) return existing;

  const gross = round2(supervision.total_amount);
  const commission = round2(supervision.total_commission);
  const net = round2(gross - commission);

  const deliveredAt = order.delivered_at || order.created_at || new Date();
  const { holdDays, clearableAt } = await settlementFor(vendorId, deliveredAt);

  try {
    const earning = await VendorEarning.create({
      hold_days: holdDays,
      order_id: order._id,
      vendor_id: vendorId,
      gross_amount: gross,
      commission_amount: commission,
      net_amount: net,
      reversed_net: 0,
      reversed_commission: 0,
      effective_net: Math.max(0, net),
      status: "pending",
      payment_method: order.transaction?.payment_method,
      delivered_at: deliveredAt,
      clearable_at: clearableAt,
      history: [
        {
          action: "earning_created",
          title: "Earning recorded",
          details: `Net ${net} EGP recorded for delivered order. Held until ${clearableAt.toISOString().slice(0, 10)}.`,
          metadata: { gross, commission, net },
        },
      ],
    });
    return earning;
  } catch (err) {
    // Unique-index race: another worker created it concurrently.
    if (err.code === 11000) {
      return await VendorEarning.findOne({ order_id: order._id, vendor_id: vendorId });
    }
    throw err;
  }
};

/* ------------------------------------------------------------------ */
/*  Balance recomputation (cache on Seller.wallet)                    */
/* ------------------------------------------------------------------ */

/**
 * Recompute and persist a vendor's cached wallet balances from the
 * authoritative earnings + withdrawals aggregations.
 */
const recomputeWalletBalances = async (vendorId) => {
  const { SupplyOrder } = require("../models/supplyOrders");

  // Grouped by status AND freeze: a frozen row is neither spendable nor merely "held for the
  // return window" — it is stopped by an admin, and the vendor sees it as its own figure.
  const earningAgg = await VendorEarning.aggregate([
    { $match: { vendor_id: toObjectId(vendorId) } },
    {
      $group: {
        _id: { status: "$status", frozen: { $eq: ["$frozen.active", true] } },
        total: { $sum: "$effective_net" },
      },
    },
  ]);

  const withdrawalAgg = await WithdrawalRequest.aggregate([
    { $match: { vendor_id: toObjectId(vendorId) } },
    { $group: { _id: "$status", total: { $sum: "$amount" } } },
  ]);

  // Packaging the vendor bought from us. The order row IS the debit — there is no ledger
  // entry to write and none to reverse, so a cancelled or failed order simply stops
  // matching this query and the money is available again.
  const supplyAgg = await SupplyOrder.aggregate([
    { $match: { vendor_id: toObjectId(vendorId) } },
    { $group: { _id: "$payment_status", total: { $sum: "$wallet_amount" } } },
  ]);

  let pending = 0;
  let grossAvailable = 0;
  let frozen = 0;
  for (const row of earningAgg) {
    const { status, frozen: isFrozen } = row._id || {};
    if (status === "reversed") continue;
    if (isFrozen) frozen += row.total;
    else if (status === "pending") pending += row.total;
    else if (status === "available") grossAvailable += row.total;
  }

  // `processing` is a Paymob transfer on its way: the money is committed exactly as an
  // approved request is. `failed`, `rejected` and `cancelled` never left, so they reserve
  // nothing and the money is spendable again.
  let reserved = 0;
  let withdrawn = 0;
  for (const row of withdrawalAgg) {
    if (["pending", "approved", "processing"].includes(row._id)) reserved += row.total;
    else if (row._id === "paid") withdrawn += row.total;
  }

  let supplyHeld = 0;   // wallet share of an order still waiting on its online half
  let supplySpent = 0;  // wallet share of a settled order
  for (const row of supplyAgg) {
    if (row._id === "awaiting_online") supplyHeld += row.total;
    else if (row._id === "paid") supplySpent += row.total;
  }

  const wallet = {
    available_balance: round2(grossAvailable - reserved - withdrawn - supplyHeld - supplySpent),
    pending_balance: round2(pending),
    // Both kinds of hold are money the vendor cannot spend twice, so they read as one
    // number; the supplies figure is broken out separately below for the wallet page.
    reserved_balance: round2(reserved + supplyHeld),
    frozen_balance: round2(frozen),
    total_withdrawn: round2(withdrawn),
    // Kept apart from `total_withdrawn`, which means "paid out to a bank account".
    total_spent_on_supplies: round2(supplySpent),
    last_recomputed_at: new Date(),
  };

  await Seller.findByIdAndUpdate(vendorId, { $set: { wallet } });
  return wallet;
};

const toObjectId = (id) => {
  const mongoose = require("mongoose");
  return typeof id === "string" ? new mongoose.Types.ObjectId(id) : id;
};

/* ------------------------------------------------------------------ */
/*  Daily clearance sweep (called from the app.js cron)               */
/* ------------------------------------------------------------------ */

/**
 * Phase 1: backfill VendorEarning records for delivered orders.
 * Phase 2: move pending -> available once the return window closes and no
 *          open return exists; mark fully-refunded earnings as reversed.
 */
const runEarningsClearanceSweep = async () => {
  const now = new Date();
  const affectedVendors = new Set();
  let created = 0;
  let cleared = 0;
  let reversed = 0;

  // --- Phase 1: create missing earnings for delivered PARCELS ---
  // Scoped to delivered parcels rather than completed orders: a partially delivered order
  // still owes its delivered vendors their money, and waiting for the order to finish is
  // exactly the delay sub-orders exist to remove.
  const ordersWithDeliveries = await Order.find({
    "sub_orders.status": "delivered",
  }).select("_id created_at delivered_at transaction sub_orders");

  for (const order of ordersWithDeliveries) {
    for (const sub of order.sub_orders || []) {
      if (sub.status !== "delivered") continue;
      const before = await VendorEarning.exists({ order_id: order._id, sub_order_id: sub._id });
      if (before) continue;
      const earning = await ensureEarningForSubOrder(order, sub);
      if (earning) {
        created += 1;
        affectedVendors.add(earning.vendor_id.toString());
      }
    }
  }

  // Legacy orders that predate parcels and were never migrated.
  const legacyDelivered = await Order.find({
    // Every status that means the customer received it — a later return has its own
    // reversal and must not stop the earning being created in the first place.
    status: { $in: require("./subOrderService").DELIVERED_ORDER_STATUSES },
    delivered_at: { $ne: null },
    $or: [{ sub_orders: { $exists: false } }, { sub_orders: { $size: 0 } }],
  }).select("_id created_at delivered_at transaction vendor_supervisions");

  for (const order of legacyDelivered) {
    for (const supervision of order.vendor_supervisions || []) {
      const before = await VendorEarning.exists({ order_id: order._id, vendor_id: supervision.vendor_id });
      if (before) continue;
      const earning = await ensureEarningForSupervision(order, supervision);
      if (earning) {
        created += 1;
        affectedVendors.add(earning.vendor_id.toString());
      }
    }
  }

  // --- Phase 2: clear pending earnings past their window ---
  // A row an admin froze stays where it is until it is unfrozen.
  const candidates = await VendorEarning.find({
    status: "pending",
    clearable_at: { $lte: now },
    "frozen.active": { $ne: true },
  });

  for (const earning of candidates) {
    const outcome = await tryClearEarning(earning, now);
    if (outcome === "cleared") cleared += 1;
    else if (outcome === "reversed") reversed += 1;
    if (outcome !== "unchanged") affectedVendors.add(earning.vendor_id.toString());
  }

  // --- Recompute caches for every affected vendor ---
  for (const vendorId of affectedVendors) {
    await recomputeWalletBalances(vendorId);
  }

  console.log(`[Earnings] Sweep complete. created=${created} cleared=${cleared} reversed=${reversed} vendors=${affectedVendors.size}`);
  return { created, cleared, reversed, vendors: affectedVendors.size };
};

/**
 * Move ONE pending earning whose settlement date has passed into the wallet — or reverse it
 * when its parcel was cancelled or fully refunded, or leave it while a return is open.
 *
 * Shared by the daily sweep and by an admin unfreezing a row whose date has already gone
 * by, so both follow exactly the same rules. Returns "cleared" | "reversed" | "held" |
 * "unchanged". Does not recompute the wallet; the caller does, once.
 */
const tryClearEarning = async (earning, now = new Date()) => {
  if (earning.status !== "pending" || earning.frozen?.active) return "unchanged";
  if (!earning.clearable_at || earning.clearable_at > now) return "unchanged";
  // Guard: the parcel (or, for legacy rows, the order) may have been cancelled after
  // delivery. Checked per PARCEL — an order showing `partially_cancelled` has a cancelled
  // sibling, which must not reverse the money for one that really was delivered.
  const order = await Order.findById(earning.order_id).select("status sub_orders");
  const ownParcel = earning.sub_order_id
    ? (order?.sub_orders || []).find((s) => s._id.toString() === earning.sub_order_id.toString())
    : null;
  const cancelled = ownParcel
    ? ownParcel.status === "cancelled"
    : order && order.status === "cancelled";
  if (cancelled) {
    earning.status = "reversed";
    earning.effective_net = 0;
    earning.updated_at = now;
    earning.history.push({
      action: "earning_reversed",
      title: "Earning reversed",
      details: "The parcel was cancelled after delivery.",
    });
    await earning.save();
    return "reversed";
  }

  // Scoped to this parcel when we have one: a return raised against a vendor's OTHER
  // branch must not freeze the money for the branch that delivered cleanly.
  const openReturn = await ReturnRequest.exists({
    order_id: earning.order_id,
    ...(earning.sub_order_id
      ? { sub_order_id: earning.sub_order_id }
      : { vendor_id: earning.vendor_id }),
    status: { $nin: TERMINAL_RETURN_STATUSES },
  });

  if (openReturn) {
    if (!earning.has_open_return) {
      earning.has_open_return = true;
      earning.updated_at = now;
      await earning.save();
    }
    return "held";
  }

  earning.has_open_return = false;
  earning.effective_net = Math.max(0, round2(earning.net_amount - earning.reversed_net));

  if (earning.effective_net <= 0) {
    earning.status = "reversed";
    earning.history.push({
      action: "earning_reversed",
      title: "Earning fully reversed",
      details: "Net earning fully reversed by refunds before clearance.",
    });
  } else {
    earning.status = "available";
    earning.cleared_at = now;
    earning.history.push({
      action: "earning_cleared",
      title: "Earning available",
      details: `Settlement period ended. ${earning.effective_net} EGP now withdrawable.`,
      metadata: { effective_net: earning.effective_net },
    });
    notify(earning.vendor_id, "earnings_available", "Earnings available", `${earning.effective_net} EGP is now available to withdraw.`, {
      earning_id: earning._id,
      amount: earning.effective_net,
    });
  }

  earning.updated_at = now;
  await earning.save();
  return earning.status === "available" ? "cleared" : "reversed";
};

/* ------------------------------------------------------------------ */
/*  Refund reversal hook (called from refundService.completeRefund)   */
/* ------------------------------------------------------------------ */

/**
 * Apply a completed refund's reversal to the matching earning.
 * netReversal = subtotal - discount_reversal - commission_reversal
 * (shipping refund is ignored — shipping is excluded from earnings).
 */
const applyRefundReversalToEarning = async (refund) => {
  if (!refund) return null;

  // The parcel's own row when the refund names one; the per-vendor row only for refunds
  // raised before parcels existed.
  let earning = refund.sub_order_id
    ? await VendorEarning.findOne({ order_id: refund.order_id, sub_order_id: refund.sub_order_id })
    : await VendorEarning.findOne({ order_id: refund.order_id, vendor_id: refund.vendor_id });

  // Lazy-create if the sweep hasn't recorded this earning yet.
  if (!earning) {
    const order = await Order.findById(refund.order_id)
      .select("_id created_at delivered_at transaction vendor_supervisions sub_orders");
    const sub = refund.sub_order_id
      ? (order?.sub_orders || []).find((x) => x._id.toString() === refund.sub_order_id.toString())
      : null;
    if (order && sub) {
      earning = await ensureEarningForSubOrder(order, sub);
    } else {
      const supervision = order?.vendor_supervisions?.find(
        (vs) => vs.vendor_id?.toString() === refund.vendor_id.toString()
      );
      if (order && supervision) earning = await ensureEarningForSupervision(order, supervision);
    }
  }
  if (!earning) return null;

  // What the vendor had earned on the returned lines, and therefore gives back: the
  // goods at list price, less THEIR share of the coupon (they never had the platform's
  // share, so it cannot be taken from them), less the commission we are reversing.
  //
  // A refund from before the split existed carries no `discount_vendor_share`; it reads
  // as 0, the same as the platform-funded coupons of that time.
  const couponReversal = round2(refund.discount_vendor_share || 0);
  const netReversal = round2(
    (refund.subtotal || 0) - couponReversal - (refund.total_commission_reversal || 0)
  );
  if (netReversal <= 0) return earning;

  const wasAvailable = earning.status === "available";

  earning.reversed_net = round2(earning.reversed_net + netReversal);
  earning.reversed_commission = round2(earning.reversed_commission + (refund.total_commission_reversal || 0));
  earning.reversed_coupon = round2((earning.reversed_coupon || 0) + couponReversal);
  earning.effective_net = Math.max(0, round2(earning.net_amount - earning.reversed_net));
  earning.updated_at = new Date();

  earning.history.push({
    action: "earning_refund_reversal",
    title: "Earning reduced by refund",
    details: `Refund ${refund.refund_number || ""} reversed ${netReversal} EGP from this earning.`,
    metadata: { refund_id: refund._id, net_reversal: netReversal, effective_net: earning.effective_net },
  });

  if (earning.effective_net <= 0 && earning.status !== "pending") {
    earning.status = "reversed";
  }

  await earning.save();

  // If money had already cleared (and may already be withdrawn), surface a
  // clawback so the negative carryover is auditable.
  if (wasAvailable) {
    notify(earning.vendor_id, "earnings_clawback", "Balance adjustment", `A refund reduced your available balance by ${netReversal} EGP.`, {
      earning_id: earning._id,
      amount: netReversal,
    });
  }

  await recomputeWalletBalances(refund.vendor_id);
  return earning;
};

/* ------------------------------------------------------------------ */
/*  Reads                                                             */
/* ------------------------------------------------------------------ */

const getWalletSummary = async (vendorId) => {
  // Recompute on read so the dashboard is always current.
  const wallet = await recomputeWalletBalances(vendorId);

  const [pendingCount, availableCount, openWithdrawals] = await Promise.all([
    VendorEarning.countDocuments({ vendor_id: vendorId, status: "pending" }),
    VendorEarning.countDocuments({ vendor_id: vendorId, status: "available" }),
    WithdrawalRequest.countDocuments({ vendor_id: vendorId, status: { $in: ["pending", "approved", "processing"] } }),
  ]);

  return {
    wallet,
    counts: {
      pending_earnings: pendingCount,
      available_earnings: availableCount,
      open_withdrawals: openWithdrawals,
    },
  };
};

const getEarningsHistory = async (vendorId, { status, page = 1, limit = 20 } = {}) => {
  const filter = { vendor_id: vendorId };
  if (status) filter.status = status;

  const total = await VendorEarning.countDocuments(filter);
  const earnings = await VendorEarning.find(filter)
    .sort({ created_at: -1 })
    .skip((Math.max(1, Number(page)) - 1) * Number(limit))
    .limit(Number(limit))
    .lean();

  return {
    earnings,
    pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)), limit: Number(limit) },
  };
};

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                  */
/* ------------------------------------------------------------------ */

const notify = (vendorId, type, title, message, data) => {
  createNotification(vendorId, type, title, message, data).catch((err) =>
    console.error(`[Earnings] Notification failed (${type}): ${err.message}`)
  );
};

module.exports = {
  ensureEarningForSupervision,
  ensureEarningForSubOrder,
  recomputeWalletBalances,
  runEarningsClearanceSweep,
  tryClearEarning,
  TERMINAL_RETURN_STATUSES,
  applyRefundReversalToEarning,
  getWalletSummary,
  getEarningsHistory,
};
