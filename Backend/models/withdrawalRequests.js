const mongoose = require("mongoose");
const crypto = require("crypto");
const { Schema } = mongoose;

/* ------------------ Withdrawal History ------------------ */
const withdrawalHistorySchema = new Schema(
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

/* ------------------ Withdrawal Request Schema ------------------ */
// `bank_details` is a nested object rather than a sub-schema, so its paths are flattened
// onto this schema and `this` is the withdrawal document itself.
// Bank details are only demanded of a vendor asking for a MANUAL bank transfer. A Paymob
// payout carries its destination in `payout_method` instead.
const needsBankDetails = function () {
  return this.initiated_by !== "admin" && this.channel !== "paymob";
};

/* ------------------ Paymob attempt log ------------------ */
// Every call made to Paymob for this payout and what came back, in order. Kept verbatim
// (minus the token) so a disputed transfer can be traced without Paymob's dashboard.
const gatewayAttemptSchema = new Schema(
  {
    kind: { type: String, enum: ["disburse", "inquiry", "callback"], required: true },
    at: { type: Date, default: Date.now },
    http_status: { type: Number, default: null },
    disbursement_status: { type: String, default: null },
    status_code: { type: String, default: null },
    status_description: { type: String, default: null },
    error: { type: String, default: null },
    raw: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const withdrawalRequestSchema = new Schema(
  {
    withdrawal_number: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    vendor_id: {
      type: Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
      index: true,
    },

    amount: { type: Number, required: true, min: 0 },

    /* ---- Who started it ----
     * A vendor asking to be paid and an admin running the scheduled payout produce the
     * same thing — money leaving us for a vendor's bank account — so they share one
     * record. Anything else would need `recomputeWalletBalances` to subtract two
     * different ledgers and keep them from double-counting the same money.
     *
     * The difference is only in the paperwork: a vendor request arrives `pending` and
     * waits for review, an admin payout is created already `paid` because the admin
     * pressed the button that made the transfer.
     */
    initiated_by: {
      type: String,
      enum: ["vendor", "admin"],
      default: "vendor",
      index: true,
    },

    /* ---- How the money travels ----
     *   manual  the admin moved it outside the system (bank app, cash) and typed a reference
     *   paymob  sent by us through the Paymob Payouts API to the vendor's saved method
     */
    channel: {
      type: String,
      enum: ["manual", "paymob"],
      default: "manual",
      index: true,
    },

    // Where a Paymob payout went, COPIED from the vendor's saved method at the moment it was
    // created — a vendor changing their wallet number afterwards must not rewrite where an
    // earlier transfer says it went.
    payout_method: {
      issuer: { type: String, default: null },
      msisdn: { type: String, default: null },
      bank_card_number: { type: String, default: null },
      bank_code: { type: String, default: null },
      bank_name: { type: String, default: null },
      full_name: { type: String, default: null },
    },

    /* ---- Money breakdown ----
     * gross_amount   Σ effective_net of the parcels in `earning_ids`
     * deductions     what the vendor's wallet already owed us when this payout was made:
     *                refunds on parcels paid earlier (clawbacks), packaging bought from the
     *                wallet, and any older withdrawal that named no parcels. Netted here so
     *                the vendor is never paid money they already spent.
     * amount         gross_amount − deductions: what actually left us. The wallet balance
     *                subtracts THIS figure, which is why the two sides always reconcile.
     *
     * Records from before the breakdown existed have gross_amount null; their `amount` is
     * the whole story. */
    gross_amount: { type: Number, default: null },
    deductions: { type: Number, default: 0 },

    /* ---- Paymob state (channel: paymob) ----
     * client_reference_id is generated BEFORE the call and sent with it, so a timed-out
     * request can still be found at Paymob — and is never blindly re-sent. */
    gateway: {
      provider: { type: String, default: null },
      // Which Paymob it went to: "production" | "staging". A transfer to the test server moved
      // no money, and the Payouts account statement leaves it out. Null on transfers sent
      // before this was recorded (2026-10-18; the two sent to staging were marked by hand).
      environment: { type: String, default: null },
      client_reference_id: { type: String, default: null, index: true },
      transaction_id: { type: String, default: null, index: true },
      disbursement_status: { type: String, default: null },
      status_code: { type: String, default: null },
      status_description: { type: String, default: null },
      // Paymob's charge for the transfer. Ready Car bears it (customer_bears_fees=false), so
      // it is a cost of ours and never touches the vendor's balance.
      fees: { type: Number, default: null },
      vat: { type: Number, default: null },
      sent_at: { type: Date, default: null },
      // True when the call went out and no answer came back: the transfer may or may not
      // exist. Resolved only by an inquiry, never by sending again.
      outcome_unknown: { type: Boolean, default: false },
      // Set when an "unknown" transfer still cannot be found at Paymob half an hour later:
      // an admin must look at the Paymob dashboard and resolve it by hand.
      needs_review: { type: Boolean, default: false, index: true },
      last_checked_at: { type: Date, default: null },
      check_count: { type: Number, default: 0 },
      attempts: { type: [gatewayAttemptSchema], default: [] },
    },

    // The invoice lines, COPIED when the payout was made. A refund landing later changes the
    // earning, never what this invoice says was paid for.
    lines: [
      {
        _id: false,
        earning_id: { type: Schema.Types.ObjectId, ref: "VendorEarning" },
        order_id: { type: Schema.Types.ObjectId, ref: "Order" },
        sub_order_id: { type: Schema.Types.ObjectId, default: null },
        reference: { type: String, default: null },
        delivered_at: { type: Date, default: null },
        clearable_at: { type: Date, default: null },
        gross_amount: { type: Number, default: 0 },
        coupon_share: { type: Number, default: 0 },
        commission_amount: { type: Number, default: 0 },
        reversed_net: { type: Number, default: 0 },
        amount: { type: Number, default: 0 }, // effective_net at payout time
        // Paid before its settlement period ended, by an admin override.
        paid_early: { type: Boolean, default: false },
      },
    ],

    // A payout re-sent after this one failed points back here, so the trail reads in order.
    retry_of: { type: Schema.Types.ObjectId, ref: "WithdrawalRequest", default: null },

    // The exact parcels this payout settles. Empty for a vendor-initiated withdrawal,
    // which draws on the balance as a whole and names no particular order.
    earning_ids: [{ type: Schema.Types.ObjectId, ref: "VendorEarning" }],

    // The scheduled payout date this run belongs to, from `payoutScheduleService`. Lets
    // the admin reopen "the 3 March payout" and see exactly what went out in it.
    scheduled_for: { type: Date, default: null, index: true },

    // Bank details are what a vendor SUBMITS; an admin payout copies the vendor's saved
    // defaults, which may be blank if they never filled them in. Still required on the
    // vendor path — a vendor asking for money must say where to send it — but optional
    // for an admin payout, which records a transfer that has already happened and may
    // have gone out by a route we hold no account number for.
    bank_details: {
      bank_name: { type: String, default: null, required: needsBankDetails },
      account_holder: { type: String, default: null, required: needsBankDetails },
      account_number: { type: String, default: null, required: needsBankDetails },
      iban: { type: String, default: null },
      notes: { type: String, default: "" },
    },

    status: {
      type: String,
      // draft       being assembled: its parcels are being claimed. Reserves nothing and is
      //             never listed; a draft older than a few minutes was interrupted and the
      //             repair sweep releases whatever it had claimed.
      // processing  sent to Paymob, waiting for its final answer — still RESERVES the money
      // failed      Paymob refused or returned it — the money is released back to the wallet
      enum: ["draft", "pending", "approved", "processing", "rejected", "paid", "failed", "cancelled"],
      default: "pending",
      index: true,
    },

    admin_review: {
      decision: { type: String, enum: ["approved", "rejected"], default: null },
      notes: { type: String, default: "" },
      reviewed_at: { type: Date, default: null },
      reviewed_by: { type: String, default: null },
    },

    rejection_reason: { type: String, default: null },
    paid_at: { type: Date, default: null },
    payment_reference: { type: String, default: null },

    history: [withdrawalHistorySchema],

    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

/* ------------------ Indexes ------------------ */
withdrawalRequestSchema.index({ vendor_id: 1, status: 1 });
withdrawalRequestSchema.index({ status: 1, created_at: -1 });
withdrawalRequestSchema.index({ channel: 1, status: 1 });

/* ------------------ Helpers ------------------ */
const generateWithdrawalNumber = () => {
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `WD-${rand}`;
};

const WithdrawalRequest = mongoose.model("WithdrawalRequest", withdrawalRequestSchema);

module.exports = { WithdrawalRequest, generateWithdrawalNumber };
