/**
 * Withdrawal Service
 * ------------------
 * Vendor payout requests drawn against the wallet's available balance.
 *
 * Reservation model: a request in 'pending' or 'approved' reserves its amount
 * (reflected in Seller.wallet.reserved_balance), so it can't be double-spent.
 * 'paid' moves the amount into total_withdrawn permanently. 'rejected' /
 * 'cancelled' release the reservation.
 *
 * Double-spend guards:
 *  - Only ONE open (pending/approved/processing) withdrawal per vendor at a time.
 *  - A request claims the vendor's settled orders the moment it is made (see
 *    vendorPayoutService.createPayout), so an admin cannot also pay them separately, and
 *    it is sized from the LIVE wallet — never more than the vendor actually has.
 *  - Rejecting or cancelling a request releases those orders back to the wallet.
 */

const { WithdrawalRequest, generateWithdrawalNumber } = require("../models/withdrawalRequests");
const { recomputeWalletBalances } = require("./vendorEarningsService");
const payouts = require("./vendorPayoutService");
const { createNotification } = require("../models/notifications");

const notify = (vendorId, type, title, message, data) => {
  createNotification(vendorId, type, title, message, data).catch((err) =>
    console.error(`[Withdrawal] Notification failed (${type}): ${err.message}`)
  );
};

/* ------------------------------------------------------------------ */
/*  Vendor actions                                                    */
/* ------------------------------------------------------------------ */

/**
 * A vendor asking to be paid. Always for everything that has settled: the request names the
 * exact orders it covers, which is what keeps the admin's per-order payout screen and the
 * vendor's wallet telling the same story. `amount` from older clients is ignored — it could
 * not say WHICH orders it meant.
 *
 * It is always sent through Paymob to the vendor's saved payout method when the admin
 * approves. A request for a bank transfer by hand is refused: Paymob cannot send it.
 */
const createWithdrawal = async (vendorId, { channel, notes = "" } = {}) => {
  if (channel && channel !== "paymob") {
    throw Object.assign(
      new Error("Payouts go only through Paymob to your saved wallet or bank account."),
      { code: "INVALID_INPUT" }
    );
  }
  return payouts.requestPayout(vendorId, { notes });
};

const cancelWithdrawal = async (vendorId, id) => {
  const withdrawal = await WithdrawalRequest.findById(id);
  if (!withdrawal || withdrawal.vendor_id.toString() !== vendorId.toString()) {
    throw Object.assign(new Error("Withdrawal request not found"), { code: "NOT_FOUND" });
  }
  if (withdrawal.status !== "pending") {
    throw Object.assign(new Error("Only pending withdrawals can be cancelled"), { code: "INVALID_STATUS" });
  }

  // Conditional, so a cancel racing an admin's approval cannot undo a transfer being sent.
  const cancelled = await WithdrawalRequest.findOneAndUpdate(
    { _id: withdrawal._id, status: "pending" },
    {
      $set: { status: "cancelled", updated_at: new Date() },
      $push: {
        history: {
          action: "withdrawal_cancelled", title: "Withdrawal cancelled", details: "Vendor cancelled the request.",
          actor_role: "vendor", actor_label: "Vendor", metadata: {}, created_at: new Date(),
        },
      },
    },
    { returnDocument: "after" }
  );
  if (!cancelled) {
    throw Object.assign(new Error("Only pending withdrawals can be cancelled"), { code: "INVALID_STATUS" });
  }
  await payouts.releaseEarnings(cancelled._id, `Withdrawal ${cancelled.withdrawal_number} was cancelled by the vendor.`, { role: "vendor", label: "Vendor" });

  await recomputeWalletBalances(vendorId);
  return cancelled;
};

const listVendorWithdrawals = async (vendorId, { status, page = 1, limit = 20 } = {}) => {
  const filter = { vendor_id: vendorId, status: { $ne: "draft" } };
  if (status) filter.status = status;

  const total = await WithdrawalRequest.countDocuments(filter);
  const withdrawals = await WithdrawalRequest.find(filter)
    .select("-gateway.attempts -gateway.client_reference_id -history")
    .sort({ created_at: -1 })
    .skip((Math.max(1, Number(page)) - 1) * Number(limit))
    .limit(Number(limit))
    .lean();

  // The vendor sees where the money went, never the raw account number of an old transfer.
  const { describe, mask } = require("./payouts/payoutMethods");
  for (const w of withdrawals) {
    w.destination = w.channel === "paymob" ? describe(w.payout_method) : null;
    delete w.payout_method;
    if (w.bank_details?.account_number) w.bank_details.account_number = mask(w.bank_details.account_number);
    if (w.bank_details?.iban) w.bank_details.iban = mask(w.bank_details.iban, 4);
  }

  return {
    withdrawals,
    pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)), limit: Number(limit) },
  };
};

/* ------------------------------------------------------------------ */
/*  Admin actions                                                     */
/* ------------------------------------------------------------------ */

const listAllWithdrawals = async ({ vendorId, status, channel, initiatedBy, needsReview, from, to, page = 1, limit = 20 } = {}) => {
  const filter = { status: { $ne: "draft" } };
  if (status) filter.status = status;
  // Records from before `channel` existed have no value stored; every one of them was manual.
  if (channel === "manual") filter.channel = { $ne: "paymob" };
  else if (channel) filter.channel = channel;
  if (initiatedBy) filter.initiated_by = initiatedBy;
  if (needsReview) filter["gateway.needs_review"] = true;
  if (vendorId) filter.vendor_id = vendorId;
  if (from || to) {
    filter.created_at = {};
    if (from) filter.created_at.$gte = new Date(from);
    if (to) filter.created_at.$lte = new Date(to);
  }

  const total = await WithdrawalRequest.countDocuments(filter);
  const withdrawals = await WithdrawalRequest.find(filter)
    .sort({ created_at: -1 })
    .skip((Math.max(1, Number(page)) - 1) * Number(limit))
    .limit(Number(limit))
    .select("-gateway.attempts")
    .populate("vendor_id", "store_name name email payout_hold")
    .lean();

  return {
    withdrawals,
    pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)), limit: Number(limit) },
  };
};

const getWithdrawalById = async (id) => {
  return await WithdrawalRequest.findOne({ _id: id, status: { $ne: "draft" } })
    .populate("vendor_id", "store_name name email phone wallet payout_hold payout_method")
    .lean();
};

/**
 * Approve a vendor's request. A Paymob request is SENT on approval; a manual one waits for
 * "Mark paid". Returns the withdrawal (with `state` for a Paymob send: paid / processing /
 * failed / unknown).
 */
const approveWithdrawal = async (id, adminUsername = "Admin") => {
  const { withdrawal, state } = await payouts.approveRequest(id, { actor: { role: "admin", label: adminUsername } });
  return { ...withdrawal, state };
};

const rejectWithdrawal = async (id, { reason, adminUsername = "Admin" } = {}) => {
  const withdrawal = await WithdrawalRequest.findById(id);
  if (!withdrawal) throw Object.assign(new Error("Withdrawal request not found"), { code: "NOT_FOUND" });
  // An approved Paymob payout that was already SENT is in Paymob's hands: it cannot be
  // rejected here, only resolved by its answer.
  if (!["pending", "approved"].includes(withdrawal.status) || withdrawal.gateway?.sent_at) {
    throw Object.assign(new Error("Only pending or approved withdrawals can be rejected"), { code: "INVALID_STATUS" });
  }

  const now = new Date();
  const rejected = await WithdrawalRequest.findOneAndUpdate(
    { _id: withdrawal._id, status: { $in: ["pending", "approved"] }, "gateway.sent_at": null },
    {
      $set: {
        status: "rejected",
        rejection_reason: reason || null,
        admin_review: { decision: "rejected", notes: reason || "", reviewed_at: now, reviewed_by: adminUsername },
        updated_at: now,
      },
      $push: {
        history: {
          action: "withdrawal_rejected", title: "Withdrawal rejected", details: reason || "Rejected by admin.",
          actor_role: "admin", actor_label: adminUsername, metadata: {}, created_at: now,
        },
      },
    },
    { returnDocument: "after" }
  );
  if (!rejected) {
    throw Object.assign(new Error("This withdrawal changed meanwhile (it may have just been sent). Reload."), { code: "INVALID_STATUS" });
  }
  Object.assign(withdrawal, rejected.toObject());
  await payouts.releaseEarnings(rejected._id, `Withdrawal ${rejected.withdrawal_number} was rejected${reason ? `: ${reason}` : "."}`,
    { role: "admin", label: adminUsername });

  await recomputeWalletBalances(withdrawal.vendor_id);
  notify(withdrawal.vendor_id, "withdrawal_rejected", "Withdrawal rejected",
    `Your withdrawal ${withdrawal.withdrawal_number} was rejected.${reason ? ` Reason: ${reason}` : ""}`,
    { withdrawal_id: withdrawal._id, reason: reason || null });
  return withdrawal;
};

const markWithdrawalPaid = async (id, { payment_reference, adminUsername = "Admin" } = {}) => {
  const withdrawal = await WithdrawalRequest.findById(id);
  if (!withdrawal) throw Object.assign(new Error("Withdrawal request not found"), { code: "NOT_FOUND" });
  // Paymob payouts are marked paid by Paymob's answer, never by hand.
  if (withdrawal.status !== "approved" || withdrawal.channel === "paymob") {
    throw Object.assign(new Error(
      withdrawal.channel === "paymob"
        ? "Paymob payouts are marked paid by Paymob itself."
        : "Only approved withdrawals can be marked paid"
    ), { code: "INVALID_STATUS" });
  }

  const now = new Date();
  const paid = await WithdrawalRequest.findOneAndUpdate(
    { _id: withdrawal._id, status: "approved" },
    {
      $set: { status: "paid", paid_at: now, payment_reference: payment_reference || null, updated_at: now },
      $push: {
        history: {
          action: "withdrawal_paid", title: "Withdrawal paid",
          details: `Paid by ${adminUsername}.${payment_reference ? ` Ref: ${payment_reference}` : ""}`,
          actor_role: "admin", actor_label: adminUsername, metadata: { payment_reference: payment_reference || null }, created_at: now,
        },
      },
    },
    { returnDocument: "after" }
  );
  if (!paid) throw Object.assign(new Error("This withdrawal changed meanwhile. Reload."), { code: "INVALID_STATUS" });
  Object.assign(withdrawal, paid.toObject());
  await payouts.setEarningsState(paid._id, "paid", { paidAt: now, details: `Paid in ${paid.withdrawal_number} (manual transfer).`,
    actor: { role: "admin", label: adminUsername } });

  await recomputeWalletBalances(withdrawal.vendor_id);
  notify(withdrawal.vendor_id, "withdrawal_paid", "Withdrawal paid",
    `Your withdrawal ${withdrawal.withdrawal_number} for ${withdrawal.amount} EGP has been paid.`,
    { withdrawal_id: withdrawal._id, amount: withdrawal.amount, payment_reference: payment_reference || null });
  return withdrawal;
};

module.exports = {
  createWithdrawal,
  cancelWithdrawal,
  listVendorWithdrawals,
  listAllWithdrawals,
  getWithdrawalById,
  approveWithdrawal,
  rejectWithdrawal,
  markWithdrawalPaid,
};
