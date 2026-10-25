const mongoose = require("mongoose");
const { Schema } = mongoose;

/* ------------------ Earning History ------------------ */
const earningHistorySchema = new Schema(
  {
    action: { type: String, required: true },
    title: { type: String, required: true },
    details: { type: String },
    actor_role: { type: String, default: "system" },
    actor_label: { type: String, default: "System" },
    metadata: { type: Schema.Types.Mixed },
    created_at: { type: Date, default: Date.now },
  },
  { _id: true }
);

/* ------------------ Vendor Earning Schema ------------------
 * One record per PARCEL (order, sub-order). Represents the vendor's net share of a
 * delivered parcel, held until that parcel's return window closes, then made withdrawable.
 * Shipping is excluded (net = subtotal - commission).
 *
 * Keyed on the parcel rather than the vendor because a vendor shipping from two branches
 * has two parcels that arrive days apart: a single per-vendor row could not say which
 * delivery date its holding period runs from, and would have forced the first branch's
 * money to wait for the second — the exact blocking sub-orders exist to remove.
 * -------------------------------------------------------------- */
const vendorEarningSchema = new Schema(
  {
    order_id: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },

    // Null only on rows created before sub-orders existed; the migration back-fills them.
    sub_order_id: {
      type: Schema.Types.ObjectId,
      default: null,
      index: true,
    },

    vendor_id: {
      type: Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
      index: true,
    },

    // Money snapshot taken from order.vendor_supervisions[] at creation.
    gross_amount: { type: Number, required: true }, // = parcel merchandise at list price (subtotal, shipping excluded)
    // The vendor's share of the coupon on this parcel — the part of the discount they
    // agreed to fund when the coupon was created. 0 on every parcel from before coupons
    // could be shared, which is exactly what those parcels were: platform-funded.
    coupon_share: { type: Number, default: 0 },
    commission_amount: { type: Number, required: true }, // charged on the post-coupon value
    net_amount: { type: Number, required: true }, // = gross_amount - coupon_share - commission_amount

    // Refund reversal tracking.
    reversed_net: { type: Number, default: 0 }, // cumulative net reversed by completed refunds
    reversed_commission: { type: Number, default: 0 }, // cumulative commission reversed (informational)
    reversed_coupon: { type: Number, default: 0 }, // cumulative vendor coupon share handed back by refunds (informational)
    effective_net: { type: Number, required: true }, // = max(0, net_amount - reversed_net)

    status: {
      type: String,
      enum: ["pending", "available", "reversed"],
      default: "pending",
      index: true,
    },

    payment_method: {
      type: String,
      enum: ["credit_card", "cash", "wallet", "bank_transfer", "company_account"],
    },

    /* ---- Payout linkage ----
     * The payout that handed this parcel's money to the vendor, or null while it is still
     * owed. `status` is deliberately NOT extended with a "paid" value: the wallet balance
     * in `recomputeWalletBalances` is (Σ available earnings − Σ withdrawals), so an earning
     * dropping out of `available` the moment a payout subtracts it would deduct the same
     * money twice. The earning stays `available` and simply stops being UNPAID.
     *
     * "What do we still owe this vendor?" is therefore { status: 'available', payout_id: null }.
     */
    payout_id: {
      type: Schema.Types.ObjectId,
      ref: "WithdrawalRequest",
      default: null,
      index: true,
    },
    paid_at: { type: Date, default: null },

    /* Where the payout named by `payout_id` stands, so every screen can tell money that has
     * LEFT from money that is only promised. `payout_id` alone could not: a vendor's request
     * waiting for review and a transfer still on its way through Paymob both hold the parcel
     * (it must not be paid a second time) without it having been paid yet.
     *
     *   null          unpaid (with payout_id null)
     *   "requested"   inside a vendor's request awaiting review / an approved manual payout
     *   "processing"  sent to Paymob, final status not known yet
     *   "paid"        the money reached the vendor
     *
     * Rows stamped before this field existed carry a payout_id and no value here; every one
     * of them was written by the admin Pay button, which recorded a finished transfer, so a
     * missing value on a stamped row reads as "paid".
     *
     * A payout that fails or is rejected RELEASES its parcels — payout_id, paid_at and this
     * field all go back to null — so the money is payable again, never lost. */
    payout_status: {
      type: String,
      enum: ["requested", "processing", "paid"], // null (unpaid) skips the enum check
      default: null,
    },

    /* ---- Admin freeze ----
     * An admin stopping this parcel's money from reaching the vendor (a dispute, a suspected
     * fake delivery). A frozen row does not clear into the wallet, cannot be put into a
     * payout, and is shown to the vendor with the reason. Unfreezing lets it clear normally
     * — immediately if its settlement date has already passed.
     *
     * Only UNPAID money can be frozen: money that has left cannot be stopped from here. */
    frozen: {
      active: { type: Boolean, default: false, index: true },
      reason: { type: String, default: null },
      by: { type: String, default: null },
      at: { type: Date, default: null },
    },

    /* ---- Admin early release ----
     * An admin paying this parcel before its settlement period ended. The row is moved to
     * `available` for exactly one payout (`payout_id`); if that payout fails, is rejected or is
     * abandoned while the original date is still ahead, the row goes back to `pending` with
     * its original `clearable_at` — an early release never leaves money withdrawable early on
     * its own. A return raised after an early payout is recovered like any refund on a paid
     * parcel: it comes off the vendor's next payout.
     *
     * `clearable_at` itself is never rewritten, so the row keeps saying when it WOULD have
     * settled. */
    early_release: {
      at: { type: Date, default: null },
      by: { type: String, default: null },
      reason: { type: String, default: null },
      payout_id: { type: Schema.Types.ObjectId, ref: "WithdrawalRequest", default: null },
      undone_at: { type: Date, default: null },
    },

    // The settlement period this row was given, in days — max(return window, the vendor's
    // hold_days) at the moment of delivery. Kept so a later change to the setting can be
    // told apart from what this parcel was promised.
    hold_days: { type: Number, default: null },

    delivered_at: { type: Date, required: true, index: true },
    clearable_at: { type: Date, required: true, index: true }, // = delivered_at + hold_days (never under RETURN_WINDOW_DAYS)
    cleared_at: { type: Date, default: null },
    has_open_return: { type: Boolean, default: false },

    history: [earningHistorySchema],

    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

/* ------------------ Indexes ------------------ */
// One row per parcel. `sparse` keeps pre-migration rows (sub_order_id: null) from colliding
// with each other on a shared null, which a plain unique index would treat as duplicates.
vendorEarningSchema.index({ order_id: 1, sub_order_id: 1 }, { unique: true, sparse: true });
vendorEarningSchema.index({ order_id: 1, vendor_id: 1 });
vendorEarningSchema.index({ vendor_id: 1, status: 1 });
vendorEarningSchema.index({ status: 1, clearable_at: 1 });
// The admin payout screen's only question: what is owed to this vendor right now?
vendorEarningSchema.index({ vendor_id: 1, status: 1, payout_id: 1 });

const VendorEarning = mongoose.model("VendorEarning", vendorEarningSchema);

module.exports = { VendorEarning };
