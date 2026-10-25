const mongoose = require("mongoose");
const crypto = require("crypto");
const { Schema } = mongoose;

/* ------------------ Return Item Snapshot ------------------ */
const returnItemSchema = new Schema(
  {
    order_item_id: { type: Schema.Types.ObjectId, required: true },
    product_id: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    product_title: { type: String, required: true },
    product_image: { type: String },
    variant_id: { type: Schema.Types.ObjectId },
    variant_label: { type: String },
    quantity_purchased: { type: Number, required: true },
    quantity_returning: { type: Number, required: true, min: 1 },
    unit_price: { type: Number, required: true },
    commission_rate: { type: Number, default: 0 },
    commission_amount: { type: Number, default: 0 },
  },
  { _id: true }
);

/* ------------------ Evidence ------------------ */
const returnEvidenceSchema = new Schema(
  {
    url: { type: String, required: true },
    type: { type: String, enum: ["image", "video"], default: "image" },
    uploaded_at: { type: Date, default: Date.now },
  },
  { _id: true }
);

/* ------------------ Return History ------------------ */
const returnHistorySchema = new Schema(
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

/* ------------------ Return Shipment (embedded) ------------------ */
const returnShipmentSchema = new Schema(
  {
    bosta_delivery_id: { type: String, default: null },
    bosta_tracking_number: { type: String, default: null },
    bosta_status: { type: String, default: null },
    // See shipmentSchema.last_event_at — drops out-of-order Bosta webhooks.
    last_event_at: { type: Date, default: null },
    pickup_address: {
      address: { type: String },
      city: { type: String },
      zone: { type: String },
    },
    dropoff_address: {
      address: { type: String },
      city: { type: String },
      zone: { type: String },
      district: { type: String },
    },
    sent_at: { type: Date, default: null },
    received_at: { type: Date, default: null },
    last_tracked_at: { type: Date, default: null },
    tracking_history: {
      type: [
        {
          state: { type: String, required: true },
          timestamp: { type: Date, required: true },
          notes: { type: String, default: "" },
          _id: false,
        },
      ],
      default: [],
    },
    error: { type: String, default: null },
  },
  { _id: false }
);

/* ------------------ Return Request Schema ------------------ */
const returnRequestSchema = new Schema(
  {
    return_number: {
      type: String,
      required: true,
      unique: true,
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

    items: [returnItemSchema],

    reason: {
      type: String,
      enum: ["defective", "wrong_item", "not_as_described", "changed_mind", "other"],
      required: true,
    },

    reason_details: { type: String, default: "" },

    evidence: [returnEvidenceSchema],

    status: {
      type: String,
      enum: [
        "pending_vendor_review",
        "vendor_approved",
        "vendor_rejected",
        "pending_admin_review",
        "approved",
        "rejected",
        "return_shipping",
        "return_received",
        "refund_processing",
        "completed",
        "cancelled",
      ],
      default: "pending_vendor_review",
      index: true,
    },

    fault_type: {
      type: String,
      enum: ["vendor_fault", "customer_fault", "undetermined"],
      default: "undetermined",
    },

    vendor_review: {
      decision: { type: String, enum: ["approved", "rejected"], default: null },
      notes: { type: String, default: "" },
      reviewed_at: { type: Date, default: null },
    },

    admin_review: {
      decision: { type: String, enum: ["approved", "rejected"], default: null },
      notes: { type: String, default: "" },
      reviewed_at: { type: Date, default: null },
      reviewed_by: { type: String, default: null },
    },

    return_shipment: { type: returnShipmentSchema, default: undefined },

    refund_id: {
      type: Schema.Types.ObjectId,
      ref: "Refund",
      default: null,
    },

    return_window_deadline: { type: Date, required: true },

    history: [returnHistorySchema],

    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

/* ------------------ Indexes ------------------ */
returnRequestSchema.index({ order_id: 1, user_id: 1 });
returnRequestSchema.index({ vendor_id: 1, status: 1 });
returnRequestSchema.index({ status: 1, created_at: -1 });

/* ------------------ Helpers ------------------ */
const generateReturnNumber = () => {
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `RET-${rand}`;
};

const ReturnRequest = mongoose.model("ReturnRequest", returnRequestSchema);

module.exports = { ReturnRequest, generateReturnNumber };
