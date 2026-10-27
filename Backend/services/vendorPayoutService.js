/**
 * Vendor Payout Service
 * ---------------------
 * The one place money leaves Ready Car for a vendor — by Paymob Payouts to the vendor's
 * saved wallet or bank account, or recorded by hand for a transfer made outside the system.
 *
 *   admin transfers the cleared orders    -> adminPay(vendor, earningIds, { channel })
 *   vendor asks for their money           -> requestPayout(vendor)   -> admin approves -> sent
 *   Paymob answers / is asked             -> applyGatewayAnswer / refreshPayouts
 *   admin stops money                     -> freezeEarning / setVendorHold
 *   admin pays before settlement ends     -> adminPay(..., { earlyIds, earlyReason })
 *
 * ── The invariants every function here keeps ────────────────────────────────────────
 *
 *  1. A parcel's money is paid AT MOST ONCE. Before any transfer is attempted, each parcel
 *     (VendorEarning) is claimed for exactly one payout by a conditional update that only
 *     matches unclaimed rows. Two admins pressing Pay at once cannot both claim a row.
 *
 *  2. A transfer is sent AT MOST ONCE. The send claims the payout (sent_at: null -> now)
 *     before calling Paymob; a second caller finds it claimed. A timeout or 5xx never
 *     triggers a resend — the payout is marked "outcome unknown" and resolved by inquiry
 *     (`client_reference_id`, generated before the call, is how Paymob finds it).
 *
 *  3. Money is never lost. A payout that fails, is rejected, is cancelled or is returned by
 *     the bank RELEASES its parcels: they are unpaid again and payable again. An interrupted
 *     setup (a crash mid-way) leaves a `draft` that the maintenance sweep releases.
 *
 *  4. A vendor is never paid money they already spent. The wallet balance
 *     (vendorEarningsService.recomputeWalletBalances) also carries refunds on parcels paid
 *     earlier, packaging bought from the wallet, and old withdrawals that named no parcels.
 *     Whatever part of that the unpaid parcels do not cover is DEDUCTED from the payout, so
 *     after it the wallet reads exactly what is still owed.
 *
 * MongoDB here is a standalone server (no transactions), so every multi-document step is
 * ordered so that a crash between two writes leaves a state the sweep can recognise and
 * undo, and a per-vendor lock stops two payouts from netting the same deductions.
 */

const crypto = require("crypto");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const { VendorEarning } = require("../models/vendorEarnings");
const { WithdrawalRequest, generateWithdrawalNumber } = require("../models/withdrawalRequests");
const { Seller } = require("../models/sellers");
const { Order } = require("../models/orders");
const { recordAuditLog } = require("../models/auditLog");
const { createNotification } = require("../models/notifications");
const { ReturnRequest } = require("../models/returnRequests");
const { recomputeWalletBalances, tryClearEarning, TERMINAL_RETURN_STATUSES } = require("./vendorEarningsService");
const payoutSchedule = require("./payoutScheduleService");
const methods = require("./payouts/payoutMethods");
const paymob = require("./payouts/paymobPayoutClient");

const round2 = (n) => Number((Number(n) || 0).toFixed(2));
const toObjectId = (id) => (typeof id === "string" ? new mongoose.Types.ObjectId(id) : id);

/** Statuses that hold money: it is committed to the vendor and not spendable again. */
const OPEN_STATUSES = ["pending", "approved", "processing"];
/** Statuses whose parcels must be free again. */
const RELEASED_STATUSES = ["failed", "rejected", "cancelled"];

const LOCK_MS = 60 * 1000;
const DRAFT_STALE_MS = 10 * 60 * 1000;
const UNKNOWN_REVIEW_MS = 30 * 60 * 1000;
const RETURN_WATCH_DAYS = 10;

const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

const notify = (vendorId, type, title, message, data) =>
  createNotification(vendorId, type, title, message, data).catch((err) =>
    console.error(`[Payouts] Notification failed (${type}): ${err.message}`));

const historyEntry = (action, title, details = "", actor = {}, metadata = {}) => ({
  action,
  title,
  details,
  actor_role: actor.role || "system",
  actor_label: actor.label || "System",
  metadata,
  created_at: new Date(),
});

/** A settled parcel that no payout has claimed and nobody has frozen. */
const payableFilter = (vendorId) => ({
  vendor_id: toObjectId(vendorId),
  status: "available",
  payout_id: null,
  "frozen.active": { $ne: true },
  effective_net: { $gt: 0 },
});

/* ------------------------------------------------------------------ */
/*  Per-vendor lock                                                   */
/* ------------------------------------------------------------------ */

const withVendorLock = async (vendorId, work) => {
  const now = new Date();
  const got = await Seller.findOneAndUpdate(
    { _id: toObjectId(vendorId), $or: [{ payout_lock_until: null }, { payout_lock_until: { $lt: now } }] },
    { $set: { payout_lock_until: new Date(now.getTime() + LOCK_MS) } },
    { returnDocument: "after", projection: { _id: 1 } }
  );
  if (!got) {
    if (!(await Seller.exists({ _id: toObjectId(vendorId) }))) throw fail("NOT_FOUND", "Vendor not found");
    throw fail("BUSY", "Another payout for this vendor is being prepared right now. Try again in a moment.");
  }
  try {
    return await work();
  } finally {
    await Seller.updateOne({ _id: toObjectId(vendorId) }, { $set: { payout_lock_until: null } }).catch(() => {});
  }
};

/* ------------------------------------------------------------------ */
/*  What can be paid, and what it nets to                             */
/* ------------------------------------------------------------------ */

/**
 * The money a payout of `earningIds` (or of every payable parcel, when null) would move.
 *
 *   gross       Σ effective_net of the chosen parcels
 *   deductions  the part of what the wallet owes us that the payout absorbs
 *   amount      gross − deductions: what is actually transferred
 *
 * `outstanding` is everything the wallet owes us right now: (Σ unpaid payable parcels) minus
 * the live wallet balance. It is zero for a vendor with no clawbacks, packaging or old
 * withdrawals. Only as much of it as the chosen parcels cover is taken — the rest waits for
 * the next payout.
 *
 * It can also be NEGATIVE: the wallet holds more than its unpaid parcels. That happens when
 * an older withdrawal that named no parcels was netted into a payout and then rejected — the
 * money is the vendor's but no parcel carries it. It is then paid out as a credit on top of
 * the parcels (deductions < 0), and can be paid on its own with no parcels at all. Either
 * way `amount` never exceeds the live wallet balance.
 */
const computeSettlement = async (vendorId, earningIds = null, { extra = [] } = {}) => {
  const wallet = await recomputeWalletBalances(vendorId);
  const payable = await VendorEarning.find(payableFilter(vendorId)).sort({ clearable_at: 1, delivered_at: 1 });
  const unpaid = round2(payable.reduce((sum, e) => sum + e.effective_net, 0));
  const outstanding = Math.max(0, round2(unpaid - wallet.available_balance));

  let chosen = payable;
  if (Array.isArray(earningIds)) {
    const wanted = new Set(earningIds.map(String));
    chosen = payable.filter((e) => wanted.has(String(e._id)));
    if (chosen.length !== wanted.size) {
      const found = new Set(chosen.map((e) => String(e._id)));
      const blocked = [...wanted].filter((id) => !found.has(id));
      throw fail(
        "INVALID_STATUS",
        `${blocked.length} of the selected orders cannot be paid now — they are frozen, already in a payout, ` +
        `refunded, not yet settled, or belong to another vendor. Reload and try again.`,
        { blocked_ids: blocked }
      );
    }
  }

  // `extra`: parcels still inside their settlement period that the admin is paying early.
  // They are not in the wallet yet, so they add to the payout without touching `signed` —
  // releasing them raises the unpaid total and the wallet balance by the same amount.
  chosen = [...chosen, ...extra];

  const gross = round2(chosen.reduce((sum, e) => sum + e.effective_net, 0));
  const signed = round2(unpaid - wallet.available_balance); // < 0: the wallet holds a credit
  const deductions = signed >= 0 ? round2(Math.min(signed, gross)) : signed;
  return { wallet, earnings: chosen, gross, deductions, amount: round2(gross - deductions), outstanding, credit: Math.max(0, -signed), unpaid };
};

/* ------------------------------------------------------------------ */
/*  Paying before the settlement period ends                          */
/* ------------------------------------------------------------------ */

const EARLY_BLOCK_TEXT = {
  not_found: "not this vendor's order",
  not_held: "not inside its settlement period any more",
  frozen: "frozen by an admin",
  in_payout: "already in a payout",
  nothing: "nothing left after refunds",
  not_delivered: "the parcel is no longer delivered (cancelled or returned)",
  open_return: "a return is open on it",
};

/**
 * Why each earning can NOT be paid before its settlement period ends, or null when it can.
 * One query for the orders and one for open returns, however many rows are asked about.
 *
 * Only a parcel that is really in the customer's hands and not being returned qualifies —
 * paying early is a bet that it stays there, and these are the facts that already say it
 * will not.
 */
const earlyReleaseBlocks = async (earnings) => {
  const out = new Map();
  if (!earnings.length) return out;
  const orderIds = [...new Set(earnings.map((e) => String(e.order_id)))];
  const [orders, openReturns] = await Promise.all([
    Order.find({ _id: { $in: orderIds } }).select("status sub_orders._id sub_orders.status").lean(),
    ReturnRequest.find({ order_id: { $in: orderIds }, status: { $nin: TERMINAL_RETURN_STATUSES } })
      .select("order_id sub_order_id vendor_id").lean(),
  ]);
  const orderById = new Map(orders.map((o) => [String(o._id), o]));
  for (const e of earnings) {
    let reason = null;
    if (e.status !== "pending") reason = "not_held";
    else if (e.frozen?.active) reason = "frozen";
    else if (e.payout_id) reason = "in_payout";
    else if (!(e.effective_net > 0)) reason = "nothing";
    else {
      const order = orderById.get(String(e.order_id));
      const sub = e.sub_order_id ? (order?.sub_orders || []).find((x) => String(x._id) === String(e.sub_order_id)) : null;
      const delivered = e.sub_order_id ? sub?.status === "delivered" : order?.status === "completed";
      if (!delivered) reason = "not_delivered";
      else if (openReturns.some((r) => String(r.order_id) === String(e.order_id) && (e.sub_order_id
        ? String(r.sub_order_id) === String(e.sub_order_id)
        : String(r.vendor_id) === String(e.vendor_id)))) reason = "open_return";
    }
    out.set(String(e._id), reason);
  }
  return out;
};

/**
 * Split what the admin selected for early payment into rows to release now and rows that
 * have meanwhile settled on their own (those are simply paid normally). Throws, naming each
 * row, when any cannot be paid early.
 */
const resolveEarlyIds = async (vendorId, earlyIds) => {
  const ids = [...new Set((earlyIds || []).map(String))];
  if (!ids.length) return { held: [], settled: [] };
  const rows = await VendorEarning.find({ _id: { $in: ids.map(toObjectId) }, vendor_id: toObjectId(vendorId) });
  const byId = new Map(rows.map((r) => [String(r._id), r]));
  const settled = rows.filter((r) => r.status === "available" && !r.payout_id && !r.frozen?.active && r.effective_net > 0);
  const toCheck = rows.filter((r) => !settled.includes(r));
  const blocks = await earlyReleaseBlocks(toCheck);
  const blocked = [];
  for (const id of ids) {
    if (!byId.has(id)) blocked.push({ id, reason: "not_found" });
    else if (blocks.get(id)) blocked.push({ id, reason: blocks.get(id) });
  }
  if (blocked.length) {
    throw fail(
      "INVALID_STATUS",
      `${blocked.length} of the orders chosen for early payment cannot be paid early: ` +
      [...new Set(blocked.map((b) => EARLY_BLOCK_TEXT[b.reason]))].join("; ") + ". Reload and try again.",
      { blocked_ids: blocked.map((b) => b.id) }
    );
  }
  return { held: toCheck, settled };
};

/** The same numbers, for a screen to show before anyone presses the button. */
const previewPayout = async (vendorId, earningIds = null, { earlyIds = [] } = {}) => {
  const early = await resolveEarlyIds(vendorId, earlyIds);
  const baseIds = early.settled.length
    ? [...(earningIds || []), ...early.settled.map((e) => String(e._id))]
    : earningIds;
  const s = await computeSettlement(vendorId, baseIds, { extra: early.held });
  const vendor = await Seller.findById(vendorId).select("payout_method payout_hold").lean();
  return {
    earning_count: s.earnings.length,
    earning_ids: s.earnings.map((e) => e._id),
    early_count: early.held.length,
    early_amount: round2(early.held.reduce((sum, e) => sum + e.effective_net, 0)),
    gross: s.gross,
    deductions: s.deductions,
    amount: s.amount,
    outstanding_deductions: s.outstanding,
    wallet_credit: s.credit,
    unpaid_total: s.unpaid,
    wallet_available: s.wallet.available_balance,
    payout_method: methods.describe(vendor?.payout_method),
    payout_method_complete: methods.isComplete(vendor?.payout_method),
    payout_method_problem: vendor?.payout_method?.issuer ? methods.problemWith(vendor.payout_method) : null,
    payout_hold: vendor?.payout_hold?.active ? vendor.payout_hold : null,
    paymob_configured: paymob.isConfigured(),
    paymob_environment: paymob.environment(),
  };
};

/* ------------------------------------------------------------------ */
/*  Claiming and releasing parcels                                    */
/* ------------------------------------------------------------------ */

const setEarningsState = async (payoutId, state, { paidAt = null, details = "", actor = {} } = {}) => {
  const now = new Date();
  await VendorEarning.updateMany(
    { payout_id: toObjectId(payoutId) },
    {
      $set: { payout_status: state, paid_at: state === "paid" ? (paidAt || now) : null, updated_at: now },
      ...(details
        ? { $push: { history: historyEntry(`earning_payout_${state}`, `Payout ${state}`, details, actor, { payout_id: payoutId }) } }
        : {}),
    }
  );
};

/** Hand every parcel of a payout back to the wallet, unpaid. */
const releaseEarnings = async (payoutId, reason, actor = {}) => {
  const now = new Date();
  const res = await VendorEarning.updateMany(
    { payout_id: toObjectId(payoutId) },
    {
      $set: { payout_id: null, payout_status: null, paid_at: null, updated_at: now },
      $push: {
        history: historyEntry("earning_released", "Back in the wallet", reason, actor, { payout_id: payoutId }),
      },
    }
  );

  // Parcels released EARLY for this payout go back to their settlement period if it has not
  // ended yet: the early release was for this transfer only, and must not leave the money
  // withdrawable ahead of time now that the transfer did not happen.
  await VendorEarning.updateMany(
    {
      "early_release.payout_id": toObjectId(payoutId),
      "early_release.undone_at": null,
      payout_id: null,
      status: "available",
      clearable_at: { $gt: now },
    },
    {
      $set: { status: "pending", cleared_at: null, "early_release.undone_at": now, updated_at: now },
      $push: {
        history: historyEntry("earning_early_release_undone", "Back in its settlement period",
          "The early payout did not go through, so this order waits for its settlement date again.", actor, { payout_id: payoutId }),
      },
    }
  );
  return res.modifiedCount || 0;
};

/* ------------------------------------------------------------------ */
/*  Creating a payout                                                 */
/* ------------------------------------------------------------------ */

const STAMP_FOR = { pending: "requested", approved: "requested", paid: "paid" };

/**
 * Build a payout and claim its parcels, all-or-nothing.
 *
 *   1. created as `draft` (reserves nothing, listed nowhere)
 *   2. parcels claimed by ONE conditional update; if any was taken meanwhile, every claim is
 *      released and the draft cancelled
 *   3. flipped to its real status, which is what makes it count against the wallet
 */
const createPayout = async (vendorId, {
  earningIds = null,
  initiatedBy,
  channel,
  targetStatus,
  actor = {},
  notes = "",
  paymentReference = null,
  bankDetails = null,
  retryOf = null,
  allowOffset = false,
  earlyIds = [],
  earlyReason = "",
}) => withVendorLock(vendorId, async () => {
  const vendor = await Seller.findById(vendorId)
    .select("store_name payout_hold payout_method default_bank_details")
    .lean();
  if (!vendor) throw fail("NOT_FOUND", "Vendor not found");
  if (vendor.payout_hold?.active) {
    throw fail("PAYOUTS_ON_HOLD", `Payouts to ${vendor.store_name} are on hold${vendor.payout_hold.reason ? `: ${vendor.payout_hold.reason}` : ""}.`);
  }

  // Orders the admin is paying before their settlement period ends. Checked inside the lock,
  // so nothing can claim or freeze them between the check and the release below.
  const early = await resolveEarlyIds(vendorId, earlyIds);
  if (early.held.length && !String(earlyReason || "").trim()) {
    throw fail("INVALID_INPUT", "Say why these orders are being paid before their settlement period ends.");
  }
  const chosenIds = early.settled.length
    ? [...(earningIds || []), ...early.settled.map((e) => String(e._id))]
    : earningIds;

  const s = await computeSettlement(vendorId, chosenIds, { extra: early.held });
  if (s.earnings.length === 0 && !(s.amount > 0)) throw fail("NOTHING_PAYABLE", "There are no settled orders waiting to be paid.");

  if (channel === "paymob") {
    if (!methods.isComplete(vendor.payout_method)) {
      throw fail("NO_PAYOUT_METHOD", vendor.payout_method?.issuer
        ? `This vendor's payout method cannot be paid to: ${methods.problemWith(vendor.payout_method)} Ask them to correct it on their wallet page.`
        : "This vendor has not saved a payout method (wallet or bank account) yet.");
    }
    if (s.amount <= 0) {
      throw fail(
        "NOTHING_TO_TRANSFER",
        `Nothing to transfer: ${s.deductions} EGP the vendor's wallet already owes (refunds on paid orders, ` +
        `packaging, earlier withdrawals) covers these orders. Record it as a manual settlement instead.`
      );
    }
    const min = methods.MIN_AMOUNT[vendor.payout_method.issuer];
    if (min && s.amount < min) {
      throw fail("BELOW_MINIMUM", `Paymob's minimum for this method is ${min} EGP; this payout is ${s.amount} EGP.`);
    }
  } else if (s.amount <= 0 && !allowOffset) {
    throw fail("NOTHING_TO_TRANSFER", `Nothing to withdraw: your balance already owes ${s.deductions} EGP against these orders.`);
  }

  // Invoice lines, from the parcels' orders.
  const orders = await Order.find({ _id: { $in: [...new Set(s.earnings.map((e) => String(e.order_id)))] } })
    .select("_id sub_orders._id sub_orders.reference")
    .lean();
  const refOf = new Map();
  for (const o of orders) for (const sub of o.sub_orders || []) refOf.set(String(sub._id), sub.reference);
  const lines = s.earnings.map((e) => ({
    earning_id: e._id,
    order_id: e.order_id,
    sub_order_id: e.sub_order_id || null,
    reference: (e.sub_order_id && refOf.get(String(e.sub_order_id))) || String(e.order_id).slice(-8).toUpperCase(),
    delivered_at: e.delivered_at,
    clearable_at: e.clearable_at,
    gross_amount: round2(e.gross_amount),
    coupon_share: round2(e.coupon_share || 0),
    commission_amount: round2(e.commission_amount),
    reversed_net: round2(e.reversed_net || 0),
    amount: round2(e.effective_net),
    paid_early: early.held.some((h) => String(h._id) === String(e._id)),
  }));

  const now = new Date();
  const schedule = await payoutSchedule.getScheduleForVendor(vendorId);
  const offset = s.amount <= 0;
  const bank = bankDetails || vendor.default_bank_details || {};

  const payout = await WithdrawalRequest.create({
    withdrawal_number: generateWithdrawalNumber(),
    vendor_id: toObjectId(vendorId),
    amount: s.amount,
    gross_amount: s.gross,
    deductions: s.deductions,
    initiated_by: initiatedBy,
    channel,
    earning_ids: s.earnings.map((e) => e._id),
    lines,
    retry_of: retryOf,
    scheduled_for: payoutSchedule.nextPayoutOnOrAfter(schedule, now),
    payout_method: channel === "paymob"
      ? {
        issuer: vendor.payout_method.issuer,
        msisdn: vendor.payout_method.msisdn || null,
        bank_card_number: vendor.payout_method.bank_card_number || null,
        bank_code: vendor.payout_method.bank_code || null,
        bank_name: methods.describe(vendor.payout_method)?.bank_name || null,
        full_name: vendor.payout_method.full_name || null,
      }
      : undefined,
    bank_details: {
      bank_name: bank.bank_name || null,
      account_holder: bank.account_holder || null,
      account_number: bank.account_number || null,
      iban: bank.iban || null,
      notes,
    },
    gateway: channel === "paymob" ? { provider: "paymob", client_reference_id: crypto.randomUUID() } : undefined,
    payment_reference: paymentReference,
    status: "draft",
    history: [
      historyEntry(
        initiatedBy === "vendor" ? "withdrawal_requested" : "payout_created",
        initiatedBy === "vendor" ? "Withdrawal requested" : offset ? "Settled against the wallet" : "Payout created",
        `${s.earnings.length} order(s): ${s.gross} EGP` +
        (s.deductions > 0 ? ` − ${s.deductions} EGP already owed by the wallet` : "") +
        (s.deductions < 0 ? ` + ${-s.deductions} EGP wallet credit not tied to any order` : "") +
        ` = ${s.amount} EGP` +
        (channel === "paymob" ? ` via Paymob (${methods.describe(vendor.payout_method)?.label?.en}).` : ".") +
        (early.held.length ? ` ${early.held.length} of them paid before their settlement period ended: ${String(earlyReason).trim()}` : ""),
        actor,
        {
          gross: s.gross, deductions: s.deductions, amount: s.amount, channel, earning_count: s.earnings.length,
          early_ids: early.held.map((e) => e._id), early_reason: early.held.length ? String(earlyReason).trim() : null,
        }
      ),
    ],
  });

  // Anything that goes wrong from here undoes itself: the claims are released, early releases
  // go back to their settlement period, and the draft is cancelled — so a failure can never
  // leave money claimed by a payout that does not exist, or withdrawable ahead of time.
  const abandon = async (why) => {
    await releaseEarnings(payout._id, `Payout ${payout.withdrawal_number} was abandoned while being prepared.`, actor);
    await WithdrawalRequest.updateOne(
      { _id: payout._id, status: "draft" },
      {
        $set: { status: "cancelled", updated_at: new Date() },
        $push: { history: historyEntry("payout_aborted", "Abandoned", why, actor) },
      }
    );
  };

  try {
    // Release the early orders into the wallet FOR THIS PAYOUT. Conditional on each still being
    // held, unfrozen and unclaimed.
    if (early.held.length) {
      const heldIds = early.held.map((e) => e._id);
      const released = await VendorEarning.updateMany(
        { _id: { $in: heldIds }, vendor_id: toObjectId(vendorId), status: "pending", payout_id: null, "frozen.active": { $ne: true } },
        {
          $set: {
            status: "available",
            cleared_at: now,
            has_open_return: false,
            updated_at: now,
            early_release: { at: now, by: actor.label || "Admin", reason: String(earlyReason).trim(), payout_id: payout._id, undone_at: null },
          },
          $push: {
            history: historyEntry("earning_released_early", "Paid before the settlement period ended",
              `${String(earlyReason).trim()} — released for ${payout.withdrawal_number}.`, actor, { payout_id: payout._id }),
          },
        }
      );
      if ((released.modifiedCount || 0) !== heldIds.length) {
        await abandon("Some orders changed while they were being released early.");
        throw fail("INVALID_STATUS", "Some of these orders changed while the payout was being prepared. Reload and try again.");
      }
    }

    const stamp = STAMP_FOR[targetStatus] || "requested";
    const ids = s.earnings.map((e) => e._id);
    const claim = await VendorEarning.updateMany(
      { ...payableFilter(vendorId), _id: { $in: ids } },
      {
        $set: { payout_id: payout._id, payout_status: stamp, paid_at: stamp === "paid" ? now : null, updated_at: now },
        $push: {
          history: historyEntry("earning_in_payout", "Added to a payout", `Included in ${payout.withdrawal_number}.`, actor, {
            payout_id: payout._id, payout_number: payout.withdrawal_number,
          }),
        },
      }
    );

    if ((claim.modifiedCount || 0) !== ids.length) {
      await abandon("Some orders changed while it was being prepared.");
      throw fail("INVALID_STATUS", "Some of these orders changed while the payout was being prepared. Reload and try again.");
    }

    const live = await WithdrawalRequest.findOneAndUpdate(
      { _id: payout._id, status: "draft" },
      {
        $set: {
          status: targetStatus,
          updated_at: new Date(),
          ...(targetStatus === "paid" ? { paid_at: now } : {}),
          ...(targetStatus === "approved" || targetStatus === "paid"
            ? { admin_review: { decision: "approved", notes, reviewed_at: now, reviewed_by: actor.label || "Admin" } }
            : {}),
        },
      },
      { returnDocument: "after" }
    );
    if (!live) {
      // The maintenance sweep cancelled the draft between our two writes (only possible if this
      // took over ten minutes). Its parcels were released with it; say so rather than pretend.
      throw fail("INVALID_STATUS", "The payout took too long to prepare and was abandoned. Try again.");
    }

    await recomputeWalletBalances(vendorId);
    return live;
  } catch (err) {
    // Our own refusals (string codes) already cleaned up; anything unexpected (a database
    // error, whose code is numeric) is cleaned up here rather than left for the ten-minute sweep.
    if (typeof err.code !== "string") await abandon(`Preparation failed: ${err.message}`).catch(() => {});
    throw err;
  }
});

/* ------------------------------------------------------------------ */
/*  Admin: pay the settled orders                                     */
/* ------------------------------------------------------------------ */

/**
 * The admin's transfer of a vendor's settled orders.
 *
 *   channel "paymob"  sent now to the vendor's saved method
 *   channel "manual"  a transfer the admin already made elsewhere, recorded with its reference
 *
 * Null `earningIds` means every payable order.
 */
const adminPay = async (vendorId, earningIds, {
  channel = "manual", paymentReference = null, notes = "", actor = {}, earlyIds = [], earlyReason = "",
} = {}) => {
  const early = Array.isArray(earlyIds) ? earlyIds.filter(Boolean) : [];
  if (earningIds != null && (!Array.isArray(earningIds) || (earningIds.length === 0 && early.length === 0))) {
    throw fail("INVALID_INPUT", "Select at least one order to pay.");
  }
  if (!["manual", "paymob"].includes(channel)) throw fail("INVALID_INPUT", "Unknown payout channel.");
  if (channel === "paymob" && !paymob.isConfigured()) {
    throw fail("NOT_CONFIGURED", "Paymob Payouts is not configured on the server.");
  }

  const payout = await createPayout(vendorId, {
    earningIds,
    initiatedBy: "admin",
    channel,
    targetStatus: channel === "paymob" ? "approved" : "paid",
    actor: { role: "admin", ...actor },
    notes,
    paymentReference,
    allowOffset: channel === "manual",
    earlyIds: early,
    earlyReason,
  });

  recordAuditLog({
    action: "vendor_payout",
    actor: { role: "admin", label: actor.label || "Admin" },
    target_type: "vendor_payout",
    target_id: payout._id,
    target_snapshot: {
      vendor_id: vendorId,
      payout_number: payout.withdrawal_number,
      channel,
      gross: payout.gross_amount,
      deductions: payout.deductions,
      amount: payout.amount,
      payment_reference: paymentReference,
    },
    impact: {
      earnings: payout.earning_ids.length,
      earning_ids: payout.earning_ids,
      ...(early.length ? { paid_before_settlement: early, early_reason: String(earlyReason).trim() } : {}),
    },
  });

  if (channel === "manual") {
    notify(vendorId, "payout_paid", "Payout sent",
      `${payout.amount} EGP has been paid to you for ${payout.earning_ids.length} order(s).`,
      { payout_id: payout._id, amount: payout.amount, payout_number: payout.withdrawal_number });
    const wallet = await recomputeWalletBalances(vendorId);
    return { payout, wallet, paid_count: payout.earning_ids.length, amount: payout.amount };
  }

  const sent = await sendViaPaymob(payout._id, actor);
  const wallet = await recomputeWalletBalances(vendorId);
  return { payout: sent.payout, state: sent.state, wallet, paid_count: payout.earning_ids.length, amount: payout.amount };
};

/* ------------------------------------------------------------------ */
/*  Vendor: ask for the money                                         */
/* ------------------------------------------------------------------ */

/**
 * A vendor asking to be paid everything that has settled. The request claims those orders at
 * once (so an admin cannot pay them twice meanwhile) and waits for an admin to approve it,
 * which sends it through Paymob to the vendor's saved payout method — the only way a vendor
 * is paid. There is no typed-in bank transfer: Paymob could not send it.
 */
const requestPayout = async (vendorId, { notes = "" } = {}) => {
  const open = await WithdrawalRequest.exists({
    vendor_id: toObjectId(vendorId), initiated_by: "vendor", status: { $in: OPEN_STATUSES },
  });
  if (open) throw fail("WITHDRAWAL_EXISTS", "You already have a withdrawal request in progress.");

  const vendor = await Seller.findById(vendorId).select("payout_method").lean();
  if (!methods.isComplete(vendor?.payout_method)) {
    throw fail("NO_PAYOUT_METHOD", vendor?.payout_method?.issuer
      ? `Your payout method needs a correction on the wallet page: ${methods.problemWith(vendor.payout_method)}`
      : "Save where we send your money (a wallet or a bank account) on the wallet page first.");
  }

  return createPayout(vendorId, {
    earningIds: null,
    initiatedBy: "vendor",
    channel: "paymob",
    targetStatus: "pending",
    actor: { role: "vendor", label: "Vendor" },
    notes,
  });
};

/* ------------------------------------------------------------------ */
/*  Sending through Paymob                                            */
/* ------------------------------------------------------------------ */

const describeStatus = (body) => {
  const d = body?.status_description;
  if (d == null) return null;
  return typeof d === "string" ? d : JSON.stringify(d);
};

/** Paymob's answer → "paid" | "failed" | "processing". */
const gatewayState = (body, httpStatus = 200) => {
  const s = String(body?.disbursement_status ?? body?.transaction_status ?? "").trim().toLowerCase();
  if (["success", "successful", "succeeded"].includes(s)) return "paid";
  if (["failed", "failure", "rejected", "returned", "cancelled", "canceled", "error"].includes(s)) return "failed";
  if (!s && httpStatus >= 400 && httpStatus < 500) return "failed";
  return "processing";
};

const numberOrNull = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Keep what Paymob sent, minus anything that identifies a recipient twice over. */
const attemptFrom = (kind, body, { httpStatus = null, error = null } = {}) => ({
  kind,
  at: new Date(),
  http_status: httpStatus,
  disbursement_status: body?.disbursement_status ?? body?.transaction_status ?? null,
  status_code: body?.status_code != null ? String(body.status_code) : null,
  status_description: describeStatus(body),
  error,
  raw: body || null,
});

/**
 * Send an approved Paymob payout. Returns { payout, state } where state is "paid",
 * "processing" (bank transfers take hours to days), "failed" or "unknown".
 */
const sendViaPaymob = async (payoutId, actor = {}) => {
  const payout = await WithdrawalRequest.findById(payoutId);
  if (!payout) throw fail("NOT_FOUND", "Payout not found");
  if (payout.channel !== "paymob") throw fail("INVALID_STATUS", "This payout is not a Paymob transfer.");
  if (payout.status !== "approved" || payout.gateway?.sent_at) {
    throw fail("INVALID_STATUS", `This payout is ${payout.status}${payout.gateway?.sent_at ? " and was already sent" : ""}.`);
  }
  if (!paymob.isConfigured()) throw fail("NOT_CONFIGURED", "Paymob Payouts is not configured on the server.");

  const vendor = await Seller.findById(payout.vendor_id).select("payout_hold store_name").lean();
  if (vendor?.payout_hold?.active) {
    throw fail("PAYOUTS_ON_HOLD", `Payouts to ${vendor.store_name} are on hold${vendor.payout_hold.reason ? `: ${vendor.payout_hold.reason}` : ""}.`);
  }

  // Claim the send. Whoever wins this update is the only caller that talks to Paymob.
  const now = new Date();
  const claimed = await WithdrawalRequest.findOneAndUpdate(
    { _id: payout._id, status: "approved", "gateway.sent_at": null },
    {
      $set: {
        status: "processing",
        "gateway.provider": "paymob",
        "gateway.environment": paymob.environment(),
        "gateway.sent_at": now,
        "gateway.client_reference_id": payout.gateway?.client_reference_id || crypto.randomUUID(),
        updated_at: now,
      },
      $push: { history: historyEntry("payout_sending", "Sending via Paymob", "", { role: "admin", ...actor }) },
    },
    { returnDocument: "after" }
  );
  if (!claimed) throw fail("INVALID_STATUS", "This payout was already sent.");
  await setEarningsState(claimed._id, "processing");

  const payload = {
    ...methods.disbursePayload(claimed.payout_method, claimed.amount),
    client_reference_id: claimed.gateway.client_reference_id,
    // Ready Car bears Paymob's fee and VAT: the vendor receives the whole amount.
    customer_bears_fees: false,
    comment: `Ready Marine payout ${claimed.withdrawal_number}`,
  };

  let answer;
  try {
    answer = await paymob.disburse(payload);
  } catch (err) {
    if (err.uncertain) {
      await WithdrawalRequest.updateOne(
        { _id: claimed._id },
        {
          $set: { "gateway.outcome_unknown": true, updated_at: new Date() },
          $push: {
            "gateway.attempts": { $each: [attemptFrom("disburse", err.body, { httpStatus: err.status, error: err.message })], $slice: -50 },
            history: historyEntry("payout_outcome_unknown", "Waiting for Paymob's answer",
              `${err.message}. The transfer may or may not have gone through; it will be checked with Paymob ` +
              `automatically and is never re-sent.`),
          },
        }
      );
      return { payout: await WithdrawalRequest.findById(claimed._id).lean(), state: "unknown" };
    }
    // Nothing reached Paymob (not configured, login refused, throttled, host unreachable).
    await markFailed(claimed._id, `Not sent: ${err.message}`, {
      attempt: attemptFrom("disburse", err.body, { httpStatus: err.status, error: err.message }),
      actor,
    });
    return { payout: await WithdrawalRequest.findById(claimed._id).lean(), state: "failed" };
  }

  const state = await applyGatewayAnswer(claimed._id, answer.body, { kind: "disburse", httpStatus: answer.httpStatus });
  return { payout: await WithdrawalRequest.findById(claimed._id).lean(), state };
};

/** Fail a payout and put its parcels back in the wallet. Safe to call twice. */
const markFailed = async (payoutId, reason, { attempt = null, actor = {}, gatewaySet = {}, fromStatuses = ["processing", "approved"] } = {}) => {
  const updated = await WithdrawalRequest.findOneAndUpdate(
    { _id: toObjectId(payoutId), status: { $in: fromStatuses } },
    {
      $set: { status: "failed", "gateway.outcome_unknown": false, "gateway.needs_review": false, updated_at: new Date(), ...gatewaySet },
      $push: {
        history: historyEntry("payout_failed", "Payout failed", `${reason} The orders are back in the vendor's wallet.`, actor),
        ...(attempt ? { "gateway.attempts": { $each: [attempt], $slice: -50 } } : {}),
      },
    },
    { returnDocument: "after" }
  );
  if (!updated) return null;
  await releaseEarnings(updated._id, `Payout ${updated.withdrawal_number} failed: ${reason}`, actor);
  await recomputeWalletBalances(updated.vendor_id);
  notify(updated.vendor_id, "payout_failed", "Payout did not go through",
    `Payout ${updated.withdrawal_number} (${updated.amount} EGP) failed: ${reason} The money is back in your wallet.`,
    { payout_id: updated._id, amount: updated.amount });
  recordAuditLog({
    action: "vendor_payout_failed",
    actor: { role: actor.role || "system", label: actor.label || "System" },
    target_type: "vendor_payout",
    target_id: updated._id,
    target_snapshot: { payout_number: updated.withdrawal_number, amount: updated.amount, reason },
  });
  return updated;
};

/**
 * Apply one answer from Paymob — to the disburse call, to an inquiry, or relayed by the
 * callback after we re-read it. Idempotent: the same answer twice changes nothing.
 */
const applyGatewayAnswer = async (payoutId, body, { kind = "inquiry", httpStatus = 200 } = {}) => {
  const payout = await WithdrawalRequest.findById(payoutId);
  if (!payout) return null;
  const state = gatewayState(body, httpStatus);
  const now = new Date();

  const gatewaySet = {
    "gateway.last_checked_at": now,
    "gateway.outcome_unknown": false,
    ...(body?.transaction_id ? { "gateway.transaction_id": String(body.transaction_id) } : {}),
    ...(body?.disbursement_status || body?.transaction_status
      ? { "gateway.disbursement_status": String(body.disbursement_status ?? body.transaction_status) }
      : {}),
    ...(body?.status_code != null ? { "gateway.status_code": String(body.status_code) } : {}),
    ...(describeStatus(body) ? { "gateway.status_description": describeStatus(body) } : {}),
    ...(numberOrNull(body?.fees) != null ? { "gateway.fees": numberOrNull(body.fees) } : {}),
    ...(numberOrNull(body?.vat) != null ? { "gateway.vat": numberOrNull(body.vat) } : {}),
  };
  const attempt = attemptFrom(kind, body, { httpStatus });

  const answered = numberOrNull(body?.amount);
  const amountNote = answered != null && Math.abs(answered - payout.amount) > 0.009
    ? historyEntry("payout_amount_mismatch", "Amount differs at Paymob",
      `Paymob reports ${answered} EGP for a payout of ${payout.amount} EGP. Check the Paymob dashboard.`)
    : null;

  if (state === "paid") {
    const won = await WithdrawalRequest.findOneAndUpdate(
      { _id: payout._id, status: "processing" },
      {
        $set: { ...gatewaySet, status: "paid", paid_at: now, "gateway.needs_review": false, updated_at: now },
        $push: {
          "gateway.attempts": { $each: [attempt], $slice: -50 },
          history: { $each: [historyEntry("payout_paid", "Paid via Paymob",
            `Transaction ${body?.transaction_id || payout.gateway?.transaction_id || "—"}.`), ...(amountNote ? [amountNote] : [])] },
        },
      },
      { returnDocument: "after" }
    );
    if (won) {
      await setEarningsState(won._id, "paid", { paidAt: now, details: `Paid in ${won.withdrawal_number} via Paymob.` });
      await recomputeWalletBalances(won.vendor_id);
      notify(won.vendor_id, "payout_paid", "Payout sent",
        `${won.amount} EGP has been sent to your ${methods.describe(won.payout_method)?.label?.en || "account"}.`,
        { payout_id: won._id, amount: won.amount, payout_number: won.withdrawal_number });
      return "paid";
    }
    await WithdrawalRequest.updateOne({ _id: payout._id }, { $set: gatewaySet, $push: { "gateway.attempts": { $each: [attempt], $slice: -50 } } });
    return payout.status === "paid" ? "paid" : payout.status;
  }

  if (state === "failed") {
    const wasPaid = payout.status === "paid";
    const reason = describeStatus(body) || `Paymob status ${body?.status_code || "failed"}.`;
    const failed = await markFailed(payout._id, wasPaid ? `Returned by the bank after payment: ${reason}` : reason, {
      attempt,
      gatewaySet,
      fromStatuses: ["processing", "paid"],
    });
    if (!failed) {
      await WithdrawalRequest.updateOne({ _id: payout._id }, { $set: gatewaySet, $push: { "gateway.attempts": { $each: [attempt], $slice: -50 } } });
    }
    return "failed";
  }

  // Still on its way (bank transfers).
  await WithdrawalRequest.updateOne(
    { _id: payout._id },
    {
      $set: { ...gatewaySet, updated_at: now },
      $push: {
        "gateway.attempts": { $each: [attempt], $slice: -50 },
        ...(kind === "disburse"
          ? { history: { $each: [historyEntry("payout_processing", "Accepted by Paymob", describeStatus(body) || "Being processed."), ...(amountNote ? [amountNote] : [])] } }
          : {}),
      },
    }
  );
  if (kind === "disburse") {
    notify(payout.vendor_id, "payout_processing", "Payout on its way",
      `${payout.amount} EGP is being transferred to your ${methods.describe(payout.payout_method)?.label?.en || "account"}.`,
      { payout_id: payout._id, amount: payout.amount });
  }
  return "processing";
};

/* ------------------------------------------------------------------ */
/*  Asking Paymob where things stand                                  */
/* ------------------------------------------------------------------ */

const isBankIssuer = (issuer) => methods.BANK_ISSUERS.includes(issuer);

/** Look one payout up at Paymob: by its transaction id when known, else by our reference. */
const lookup = async (payout) => {
  const key = payout.gateway?.transaction_id || payout.gateway?.client_reference_id;
  if (!key) return null;
  const tries = isBankIssuer(payout.payout_method?.issuer) ? [{ bank: true }, { bank: false }] : [{ bank: false }, { bank: true }];
  for (const opts of tries) {
    const rows = await paymob.inquire([key], opts);
    const hit = rows.find((r) => String(r.transaction_id) === String(payout.gateway?.transaction_id))
      || (rows.length === 1 ? rows[0] : null);
    if (hit) return hit;
  }
  return null;
};

/**
 * Re-read one payout from Paymob and apply what it says. Used by the admin's "check now"
 * button, by the callback, and by the maintenance sweep.
 */
const refreshPayout = async (payoutId) => {
  const payout = await WithdrawalRequest.findById(payoutId).lean();
  if (!payout) throw fail("NOT_FOUND", "Payout not found");
  if (payout.channel !== "paymob" || !payout.gateway?.sent_at) {
    return { payout, state: payout.status, found: false };
  }

  const hit = await lookup(payout);
  await WithdrawalRequest.updateOne(
    { _id: payout._id },
    { $set: { "gateway.last_checked_at": new Date() }, $inc: { "gateway.check_count": 1 } }
  );

  if (!hit) {
    const age = Date.now() - new Date(payout.gateway.sent_at).getTime();
    if (payout.status === "processing" && payout.gateway.outcome_unknown && age > UNKNOWN_REVIEW_MS && !payout.gateway.needs_review) {
      await WithdrawalRequest.updateOne(
        { _id: payout._id },
        {
          $set: { "gateway.needs_review": true },
          $push: {
            history: historyEntry("payout_needs_review", "Needs a look",
              "Paymob has no record of this transfer 30 minutes after it was sent. Check the Paymob dashboard, " +
              "then mark it failed (the orders return to the wallet) if it is not there."),
          },
        }
      );
    }
    return { payout: await WithdrawalRequest.findById(payout._id).lean(), state: payout.status, found: false };
  }

  const state = await applyGatewayAnswer(payout._id, hit, { kind: "inquiry" });
  return { payout: await WithdrawalRequest.findById(payout._id).lean(), state, found: true };
};

/**
 * An admin closing a transfer whose outcome is unknown and which Paymob cannot find, after
 * checking the Paymob dashboard. Asks Paymob once more first: if it turns up, its real
 * status wins and nothing is failed by hand.
 */
const resolveUnknownAsFailed = async (payoutId, { reason, actor = {} } = {}) => {
  if (!reason || !String(reason).trim()) throw fail("INVALID_INPUT", "Say what the Paymob dashboard showed.");
  const payout = await WithdrawalRequest.findById(payoutId).lean();
  if (!payout) throw fail("NOT_FOUND", "Payout not found");
  if (payout.status !== "processing" || !payout.gateway?.outcome_unknown) {
    throw fail("INVALID_STATUS", "Only a transfer whose outcome is unknown can be closed by hand.");
  }
  const again = await refreshPayout(payoutId);
  if (again.found) {
    throw fail("INVALID_STATUS", `Paymob does have this transfer (status: ${again.payout.gateway?.disbursement_status}). It was updated from Paymob instead.`);
  }
  await markFailed(payoutId, `Closed by ${actor.label || "Admin"} — not found at Paymob: ${String(reason).trim()}`, {
    actor: { role: "admin", ...actor },
    fromStatuses: ["processing"],
  });
  return WithdrawalRequest.findById(payoutId).lean();
};

/** Send the orders of a failed payout again, as a new payout (the failed one stays on record). */
const retryFailedPayout = async (payoutId, { actor = {} } = {}) => {
  const old = await WithdrawalRequest.findById(payoutId).lean();
  if (!old) throw fail("NOT_FOUND", "Payout not found");
  if (old.status !== "failed" || old.channel !== "paymob") {
    throw fail("INVALID_STATUS", "Only a failed Paymob payout can be sent again.");
  }
  if (!old.earning_ids?.length) throw fail("INVALID_STATUS", "This payout names no orders to resend.");

  // Orders the failed payout had released early went back to their settlement period when
  // it failed. Sending them again is the same early payment, for the same stated reason.
  const rows = await VendorEarning.find({ _id: { $in: old.earning_ids } })
    .select("status early_release").lean();
  const earlyAgain = rows.filter((r) => r.status === "pending" && String(r.early_release?.payout_id) === String(old._id));
  const earlyIds = earlyAgain.map((r) => String(r._id));
  const normalIds = old.earning_ids.map(String).filter((id) => !earlyIds.includes(id));
  const earlyReason = earlyAgain.length
    ? `${earlyAgain[0].early_release?.reason || "Paid early"} (retry of ${old.withdrawal_number})`
    : "";

  return adminPay(old.vendor_id, normalIds, {
    channel: "paymob", actor, notes: `Retry of ${old.withdrawal_number}`, earlyIds, earlyReason,
  })
    .then(async (res) => {
      await WithdrawalRequest.updateOne({ _id: res.payout._id }, { $set: { retry_of: old._id } });
      return res;
    });
};

/* ------------------------------------------------------------------ */
/*  Review of vendor requests                                         */
/* ------------------------------------------------------------------ */

/**
 * Approve a vendor's request. A Paymob request is sent the moment it is approved — that is
 * what approval means for it. A manual one waits for "Mark paid" with the bank reference.
 */
const approveRequest = async (payoutId, { actor = {} } = {}) => {
  const payout = await WithdrawalRequest.findById(payoutId).lean();
  if (!payout) throw fail("NOT_FOUND", "Withdrawal request not found");
  if (payout.status !== "pending") throw fail("INVALID_STATUS", "Only pending withdrawals can be approved");

  const vendor = await Seller.findById(payout.vendor_id).select("payout_hold store_name").lean();
  if (vendor?.payout_hold?.active) {
    throw fail("PAYOUTS_ON_HOLD", `Payouts to ${vendor.store_name} are on hold${vendor.payout_hold.reason ? `: ${vendor.payout_hold.reason}` : ""}.`);
  }
  if (payout.channel === "paymob" && !paymob.isConfigured()) {
    throw fail("NOT_CONFIGURED", "Paymob Payouts is not configured on the server.");
  }

  const now = new Date();
  const approved = await WithdrawalRequest.findOneAndUpdate(
    { _id: payout._id, status: "pending" },
    {
      $set: {
        status: "approved",
        admin_review: { decision: "approved", notes: "", reviewed_at: now, reviewed_by: actor.label || "Admin" },
        updated_at: now,
      },
      $push: { history: historyEntry("withdrawal_approved", "Withdrawal approved", `Approved by ${actor.label || "Admin"}.`, { role: "admin", ...actor }) },
    },
    { returnDocument: "after" }
  );
  if (!approved) throw fail("INVALID_STATUS", "Only pending withdrawals can be approved");
  await recomputeWalletBalances(approved.vendor_id);

  if (approved.channel === "paymob") {
    const sent = await sendViaPaymob(approved._id, actor);
    return { withdrawal: sent.payout, state: sent.state };
  }
  notify(approved.vendor_id, "withdrawal_approved", "Withdrawal approved",
    `Your withdrawal ${approved.withdrawal_number} for ${approved.amount} EGP was approved and is awaiting payout.`,
    { withdrawal_id: approved._id, amount: approved.amount });
  return { withdrawal: approved.toObject(), state: "approved" };
};

/* ------------------------------------------------------------------ */
/*  Admin stops money: one parcel, or everything to a vendor          */
/* ------------------------------------------------------------------ */

const freezeEarning = async (earningId, { reason, actor = {} } = {}) => {
  if (!reason || !String(reason).trim()) throw fail("INVALID_INPUT", "Give a reason — the vendor will see it.");
  const earning = await VendorEarning.findById(earningId).lean();
  if (!earning) throw fail("NOT_FOUND", "Order earning not found");
  if (earning.frozen?.active) throw fail("INVALID_STATUS", "This order is already frozen.");
  if (earning.payout_id) {
    const p = await WithdrawalRequest.findById(earning.payout_id).select("withdrawal_number status").lean();
    throw fail("INVALID_STATUS",
      p && ["paid"].includes(p.status)
        ? `This order was already paid in ${p.withdrawal_number}; paid money cannot be frozen.`
        : `This order is inside payout ${p?.withdrawal_number || ""} (${p?.status || "unknown"}). Reject or cancel that payout first.`);
  }
  if (earning.status === "reversed") throw fail("INVALID_STATUS", "This order was refunded; there is nothing to freeze.");

  const now = new Date();
  const updated = await VendorEarning.findOneAndUpdate(
    { _id: earning._id, payout_id: null, "frozen.active": { $ne: true } },
    {
      $set: { frozen: { active: true, reason: String(reason).trim(), by: actor.label || "Admin", at: now }, updated_at: now },
      $push: { history: historyEntry("earning_frozen", "Frozen by admin", String(reason).trim(), { role: "admin", ...actor }) },
    },
    { returnDocument: "after" }
  );
  if (!updated) throw fail("INVALID_STATUS", "This order changed meanwhile (it may have just been put in a payout). Reload.");

  await recomputeWalletBalances(updated.vendor_id);
  notify(updated.vendor_id, "earning_frozen", "Order payment on hold",
    `${updated.effective_net} EGP for one of your orders is on hold: ${updated.frozen.reason}`,
    { earning_id: updated._id, order_id: updated.order_id, amount: updated.effective_net });
  recordAuditLog({
    action: "vendor_earning_frozen",
    actor: { role: "admin", label: actor.label || "Admin" },
    target_type: "vendor_earning",
    target_id: updated._id,
    target_snapshot: { vendor_id: updated.vendor_id, order_id: updated.order_id, amount: updated.effective_net, reason: updated.frozen.reason },
  });
  return updated;
};

const unfreezeEarning = async (earningId, { note = "", actor = {} } = {}) => {
  const now = new Date();
  const updated = await VendorEarning.findOneAndUpdate(
    { _id: toObjectId(earningId), "frozen.active": true },
    {
      $set: { "frozen.active": false, updated_at: now },
      $push: { history: historyEntry("earning_unfrozen", "Released by admin", note || "", { role: "admin", ...actor }) },
    },
    { returnDocument: "after" }
  );
  if (!updated) {
    if (!(await VendorEarning.exists({ _id: toObjectId(earningId) }))) throw fail("NOT_FOUND", "Order earning not found");
    throw fail("INVALID_STATUS", "This order is not frozen.");
  }
  // Its settlement date may have passed while it was frozen: let it clear now rather than at
  // tomorrow's sweep.
  await tryClearEarning(updated, now);
  await recomputeWalletBalances(updated.vendor_id);
  notify(updated.vendor_id, "earning_unfrozen", "Order payment released",
    `${updated.effective_net} EGP for one of your orders is no longer on hold.`,
    { earning_id: updated._id, order_id: updated.order_id, amount: updated.effective_net });
  recordAuditLog({
    action: "vendor_earning_unfrozen",
    actor: { role: "admin", label: actor.label || "Admin" },
    target_type: "vendor_earning",
    target_id: updated._id,
    target_snapshot: { vendor_id: updated.vendor_id, order_id: updated.order_id, note },
  });
  return VendorEarning.findById(updated._id).lean();
};

/**
 * Stop (or resume) every payout to a vendor. Earnings keep clearing; nothing can leave.
 * Payouts already sent to Paymob cannot be recalled from here and are unaffected.
 */
const setVendorHold = async (vendorId, { active, reason = "", actor = {} } = {}) => {
  if (active && !String(reason || "").trim()) throw fail("INVALID_INPUT", "Give a reason — the vendor will see it.");
  const hold = active
    ? { active: true, reason: String(reason).trim(), by: actor.label || "Admin", at: new Date() }
    : { active: false, reason: null, by: actor.label || "Admin", at: new Date() };
  const vendor = await Seller.findByIdAndUpdate(vendorId, { $set: { payout_hold: hold } }, { returnDocument: "after" })
    .select("store_name payout_hold");
  if (!vendor) throw fail("NOT_FOUND", "Vendor not found");

  notify(vendorId, active ? "payouts_paused" : "payouts_resumed",
    active ? "Payouts on hold" : "Payouts resumed",
    active ? `Payouts to your store are on hold: ${hold.reason}` : "Payouts to your store have resumed.",
    { reason: hold.reason });
  recordAuditLog({
    action: active ? "vendor_payouts_held" : "vendor_payouts_resumed",
    actor: { role: "admin", label: actor.label || "Admin" },
    target_type: "vendor_payout_hold",
    target_id: vendor._id,
    target_snapshot: { store_name: vendor.store_name, reason: hold.reason },
  });
  return vendor.payout_hold;
};

/* ------------------------------------------------------------------ */
/*  Vendor's payout method                                            */
/* ------------------------------------------------------------------ */

const getPayoutMethod = async (vendorId) => {
  const vendor = await Seller.findById(vendorId).select("payout_method payout_hold").lean();
  if (!vendor) throw fail("NOT_FOUND", "Vendor not found");
  const m = vendor.payout_method?.issuer ? vendor.payout_method : null;
  return {
    method: m ? { ...m, ...methods.describe(m, { masked: false }) } : null,
    complete: methods.isComplete(m),
    // Why a saved method cannot be paid to (a fast transfer to an account number), or null.
    problem: m ? methods.problemWith(m) : null,
    payout_hold: vendor.payout_hold?.active ? { reason: vendor.payout_hold.reason, at: vendor.payout_hold.at } : null,
  };
};

/** Save where money goes. Needs the account password: this decides who receives the money. */
const setPayoutMethod = async (vendorId, input, password) => {
  const vendor = await Seller.findById(vendorId).select("password payout_method");
  if (!vendor) throw fail("NOT_FOUND", "Vendor not found");
  if (!password || !(await bcrypt.compare(String(password), vendor.password || ""))) {
    throw fail("WRONG_PASSWORD", "The password is not correct.");
  }
  const clean = methods.normaliseMethod(input);
  const before = vendor.payout_method?.issuer ? methods.describe(vendor.payout_method) : null;
  vendor.payout_method = { ...clean, updated_at: new Date() };
  await vendor.save();

  const after = methods.describe(clean);
  notify(vendorId, "payout_method_changed", "Payout method changed",
    `Your payouts will now go to ${after.label.en} ${after.account}.` +
    (before ? ` (was ${before.label.en} ${before.account})` : "") +
    " If this was not you, contact Ready Marine immediately.",
    { issuer: clean.issuer });
  return getPayoutMethod(vendorId);
};

/* ------------------------------------------------------------------ */
/*  Invoices                                                          */
/* ------------------------------------------------------------------ */

const getPayoutInvoice = async (payoutId, { vendorId = null, forAdmin = false } = {}) => {
  const payout = await WithdrawalRequest.findOne({ _id: toObjectId(payoutId), status: { $ne: "draft" } }).lean();
  if (!payout || (vendorId && String(payout.vendor_id) !== String(vendorId))) throw fail("NOT_FOUND", "Payout not found");

  const vendor = await Seller.findById(payout.vendor_id).select("name store_name email phone").lean();

  // Payouts made before invoice lines existed: rebuild the lines from their earnings.
  let lines = payout.lines || [];
  if (lines.length === 0 && payout.earning_ids?.length) {
    const earnings = await VendorEarning.find({ _id: { $in: payout.earning_ids } }).lean();
    lines = earnings.map((e) => ({
      earning_id: e._id,
      order_id: e.order_id,
      sub_order_id: e.sub_order_id,
      reference: String(e.order_id).slice(-8).toUpperCase(),
      delivered_at: e.delivered_at,
      clearable_at: e.clearable_at,
      gross_amount: e.gross_amount,
      coupon_share: e.coupon_share || 0,
      commission_amount: e.commission_amount,
      reversed_net: e.reversed_net || 0,
      amount: e.effective_net,
    }));
  }

  const g = payout.gateway || {};
  return {
    invoice: {
      number: payout.withdrawal_number,
      issued_at: payout.created_at,
      paid_at: payout.paid_at,
      status: payout.status,
      initiated_by: payout.initiated_by,
      channel: payout.channel,
      destination: payout.channel === "paymob"
        ? methods.describe(payout.payout_method, { masked: !forAdmin })
        : {
          label: { en: "Bank transfer", ar: "تحويل بنكي" },
          bank_name: payout.bank_details?.bank_name,
          full_name: payout.bank_details?.account_holder,
          account: forAdmin ? payout.bank_details?.account_number : methods.mask(payout.bank_details?.account_number),
        },
      payment_reference: payout.payment_reference || g.transaction_id || null,
      gross_amount: payout.gross_amount ?? payout.amount,
      deductions: payout.deductions || 0,
      amount: payout.amount,
      notes: payout.bank_details?.notes || "",
      rejection_reason: payout.rejection_reason || null,
    },
    vendor: vendor ? { name: vendor.name, store_name: vendor.store_name, email: vendor.email, phone: vendor.phone } : null,
    lines,
    gateway: payout.channel === "paymob"
      ? {
        transaction_id: g.transaction_id || null,
        disbursement_status: g.disbursement_status || null,
        status_description: g.status_description || null,
        sent_at: g.sent_at || null,
        outcome_unknown: !!g.outcome_unknown,
        needs_review: !!g.needs_review,
        ...(forAdmin
          ? {
            client_reference_id: g.client_reference_id,
            status_code: g.status_code,
            fees: g.fees,
            vat: g.vat,
            last_checked_at: g.last_checked_at,
            check_count: g.check_count,
            attempts: g.attempts || [],
          }
          : {}),
      }
      : null,
    history: forAdmin ? payout.history : (payout.history || []).map((h) => ({ action: h.action, title: h.title, created_at: h.created_at })),
  };
};

/* ------------------------------------------------------------------ */
/*  Maintenance sweep (cron)                                          */
/* ------------------------------------------------------------------ */

/**
 * Keeps the books true when something was interrupted, and follows Paymob transfers to
 * their final status:
 *
 *   1. drafts older than 10 minutes -> their claims released, cancelled
 *   2. parcels claimed by a payout that failed / was rejected / cancelled -> released
 *   3. Paymob transfers still processing -> asked about (≤ 4 inquiries a minute)
 *   4. bank transfers paid in the last 10 days -> asked about twice a day, because a bank
 *      can RETURN a transfer after reporting it successful
 */
const runPayoutMaintenance = async ({ maxInquiries = 12 } = {}) => {
  const summary = { drafts: 0, orphans: 0, checked: 0, paid: 0, failed: 0, errors: 0 };
  const touched = new Set();

  // 1. Interrupted drafts.
  const stale = await WithdrawalRequest.find({ status: "draft", created_at: { $lt: new Date(Date.now() - DRAFT_STALE_MS) } })
    .select("_id vendor_id withdrawal_number").lean();
  for (const d of stale) {
    const cancelled = await WithdrawalRequest.findOneAndUpdate(
      { _id: d._id, status: "draft" },
      {
        $set: { status: "cancelled", updated_at: new Date() },
        $push: { history: historyEntry("payout_aborted", "Abandoned", "Preparation was interrupted; the orders were returned to the wallet.") },
      }
    );
    if (cancelled) {
      await releaseEarnings(d._id, `Payout ${d.withdrawal_number} was interrupted while being prepared.`);
      touched.add(String(d.vendor_id));
      summary.drafts += 1;
    }
  }

  // 2. Parcels still claimed by a payout that no longer holds money. Only rows written with a
  //    payout_status (this system); older rows were stamped by finished manual payouts.
  const claimed = await VendorEarning.aggregate([
    { $match: { payout_id: { $ne: null }, payout_status: { $in: ["requested", "processing", "paid"] } } },
    { $group: { _id: "$payout_id", vendor_id: { $first: "$vendor_id" } } },
    { $lookup: { from: WithdrawalRequest.collection.name, localField: "_id", foreignField: "_id", as: "p" } },
    { $project: { vendor_id: 1, status: { $arrayElemAt: ["$p.status", 0] } } },
    { $match: { $or: [{ status: { $in: RELEASED_STATUSES } }, { status: null }] } },
  ]);
  for (const row of claimed) {
    const released = await releaseEarnings(row._id, "Released by the maintenance sweep: its payout no longer holds money.");
    if (released) {
      summary.orphans += released;
      touched.add(String(row.vendor_id));
    }
  }

  // 3 + 4. Follow Paymob.
  if (paymob.isConfigured()) {
    const processing = await WithdrawalRequest.find({ channel: "paymob", status: "processing", "gateway.sent_at": { $ne: null } })
      .sort({ "gateway.last_checked_at": 1 })
      .limit(maxInquiries)
      .select("_id")
      .lean();
    const watch = await WithdrawalRequest.find({
      channel: "paymob",
      status: "paid",
      "payout_method.issuer": { $in: methods.BANK_ISSUERS },
      paid_at: { $gte: new Date(Date.now() - RETURN_WATCH_DAYS * 86400000) },
      $or: [{ "gateway.last_checked_at": null }, { "gateway.last_checked_at": { $lt: new Date(Date.now() - 12 * 3600000) } }],
    })
      .limit(Math.max(0, maxInquiries - processing.length))
      .select("_id")
      .lean();

    for (const { _id } of [...processing, ...watch]) {
      try {
        const r = await refreshPayout(_id);
        summary.checked += 1;
        if (r.state === "paid") summary.paid += 1;
        if (r.state === "failed") summary.failed += 1;
      } catch (err) {
        summary.errors += 1;
        console.error(`[Payouts] Could not check payout ${_id} with Paymob: ${err.message}`);
        if (err.code === "THROTTLED") break;
      }
    }
  }

  for (const vendorId of touched) await recomputeWalletBalances(vendorId).catch(() => {});
  if (summary.drafts || summary.orphans || summary.checked || summary.errors) {
    console.log(`[Payouts] Maintenance: ${JSON.stringify(summary)}`);
  }
  return summary;
};

/** Our remaining balance at Paymob Payouts — for the admin screen. */
const getPaymobBudget = async () => {
  if (!paymob.isConfigured()) return { configured: false };
  const b = await paymob.budget();
  return { configured: true, environment: paymob.environment(), balance: b.balance, currency: b.currency };
};

module.exports = {
  OPEN_STATUSES,
  computeSettlement,
  previewPayout,
  earlyReleaseBlocks,
  adminPay,
  requestPayout,
  approveRequest,
  sendViaPaymob,
  applyGatewayAnswer,
  gatewayState,
  refreshPayout,
  resolveUnknownAsFailed,
  retryFailedPayout,
  markFailed,
  releaseEarnings,
  setEarningsState,
  freezeEarning,
  unfreezeEarning,
  setVendorHold,
  getPayoutMethod,
  setPayoutMethod,
  getPayoutInvoice,
  runPayoutMaintenance,
  getPaymobBudget,
};
