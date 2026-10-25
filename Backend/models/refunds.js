const mongoose = require("mongoose");
const crypto = require("crypto");
const { Schema } = mongoose;

/* ------------------ Refund Line Item ------------------ */
const refundLineItemSchema = new Schema(
  {
    return_item_id: { type: Schema.Types.ObjectId, required: true },
    order_item_id: { type: Schema.Types.ObjectId, required: true },
    product_title: { type: String, required: true },
    variant_label: { type: String },
    quantity: { type: Number, required: true },
    unit_price: { type: Number, required: true },
    line_total: { type: Number, required: true },
    discount_share: { type: Number, default: 0 },
    // The part of `discount_share` the vendor had funded (per the coupon's split frozen on
    // the order). Only this much of the coupon comes back off the vendor's earning.
    discount_vendor_share: { type: Number, default: 0 },
    // The share of this line that loyalty points paid for. Deducted from the
    // cash refund and returned as points instead — the customer never paid
    // money for it, so refunding money would be creating it.
    loyalty_share: { type: Number, default: 0 },
    shipping_share: { type: Number, default: 0 },
    commission_reversal: { type: Number, default: 0 },
    refund_amount: { type: Number, required: true },
  },
  { _id: true }
);

/* ------------------ Refund History ------------------ */
const refundHistorySchema = new Schema(
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

/* ------------------ Refund Schema ------------------ */
const refundSchema = new Schema(
  {
    refund_number: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    return_request_id: {
      type: Schema.Types.ObjectId,
      ref: "ReturnRequest",
      required: true,
      index: true,
    },

    order_id: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },

    user_id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    vendor_id: {
      type: Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
      index: true,
    },

    // The parcel these items came in. A vendor shipping from two branches has two parcels
    // that arrive days apart, so the vendor alone cannot say which delivery date this
    // return's window runs from.
    sub_order_id: {
      type: Schema.Types.ObjectId,
      default: null,
      index: true,
    },


    line_items: [refundLineItemSchema],

    subtotal: { type: Number, required: true },
    discount_reversal: { type: Number, default: 0 },
    // Of `discount_reversal`, the part the vendor had funded. Read by the earnings
    // reversal; the customer's refund uses the whole `discount_reversal`.
    discount_vendor_share: { type: Number, default: 0 },
    // EGP value of the returned items that loyalty points funded, and the
    // number of points that will be handed back for it.
    loyalty_reversal: { type: Number, default: 0 },
    loyalty_points_restored: { type: Number, default: 0 },
    // Points this order earned that the return takes back.
    loyalty_points_reversed: { type: Number, default: 0 },
    shipping_refund: { type: Number, default: 0 },
    restocking_fee: { type: Number, default: 0 },
    // Money only — `loyalty_reversal` is deliberately NOT part of this.
    total_refund_amount: { type: Number, required: true },
    total_commission_reversal: { type: Number, default: 0 },

    original_payment_method: {
      type: String,
      enum: ["credit_card", "cash", "wallet", "bank_transfer", "company_account"],
      required: true,
    },

    refund_method: {
      type: String,
      // "company_account": taken off the company's invoice (and back to the employee's
      // limit), with any part they paid themselves returned to their wallet.
      enum: ["original_payment", "bank_transfer", "store_credit", "company_account"],
      required: true,
    },

    payment_details: {
      fawaterak_invoice_id: { type: String, default: null },
      bank_name: { type: String, default: null },
      account_holder: { type: String, default: null },
      account_number: { type: String, default: null },
      iban: { type: String, default: null },
      processed_by: { type: String, default: null },
      notes: { type: String, default: "" },
    },

    fault_type: {
      type: String,
      enum: ["vendor_fault", "customer_fault"],
      required: true,
    },

    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed"],
      default: "pending",
      index: true,
    },

    processed_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },

    history: [refundHistorySchema],

    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

/* ------------------ Indexes ------------------ */
refundSchema.index({ status: 1, created_at: -1 });
refundSchema.index({ vendor_id: 1, status: 1 });

/* ------------------ Helpers ------------------ */
const generateRefundNumber = () => {
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `REF-${rand}`;
};

const Refund = mongoose.model("Refund", refundSchema);

module.exports = { Refund, generateRefundNumber };
