const mongoose = require("mongoose");
const { Schema } = mongoose;

const bostaPickupSchema = new Schema(
  {
    bosta_pickup_id: { type: String, required: true, unique: true },
    bosta_location_id: { type: String, required: true, index: true },

    location_address: { type: String, default: "" },
    vendor_id: { type: Schema.Types.ObjectId, ref: "Seller", index: true },
    vendor_name: { type: String, default: "" },

    scheduled_date: { type: String, required: true },
    scheduled_time_slot: { type: String, required: true },

    contact_person: {
      name: { type: String, default: "" },
      phone: { type: String, default: "" },
      email: { type: String, default: "" },
    },

    status: {
      type: String,
      enum: ["scheduled", "picked_up", "cancelled", "failed"],
      default: "scheduled",
      index: true,
    },

    // Bosta's own state name ("Requested", "Canceled", ...) kept verbatim for support,
    // alongside the mapped `status` above.
    bosta_state: { type: String, default: null },
    last_refreshed_at: { type: Date, default: null },

    order_ids: [{ type: Schema.Types.ObjectId, ref: "Order" }],

    parcel_count: { type: Number, default: 0 },

    // What Bosta bills US for sending a courier to collect this few parcels — 0 once the
    // visit carries enough of them to be free. READY CAR ABSORBS IT: no customer is ever
    // quoted it, because dispatching a courier early rather than waiting for a fuller batch
    // is an operational call made after the customer's price was already fixed. Recorded so
    // the cost of that call is visible in the admin's Pickups module instead of surfacing
    // only on Bosta's weekly invoice. Refreshed whenever another order joins the pickup.
    pickup_fee: { type: Number, default: 0 },
    has_fragile: { type: Boolean, default: false },
    has_big_items: { type: Boolean, default: false },

    created_at: { type: Date, default: Date.now },
    created_by: { type: String, default: "system" },
  },
  { timestamps: false }
);

// One live pickup per location per day. Cancelled rows are excluded: they are kept for
// history, and without the partial filter a cancelled row permanently blocked that
// (location, date) — the lookup skips cancelled and finds nothing, so the code books a
// courier on Bosta and then fails to save it, orphaning a real, billed pickup.
// Listed positively rather than as `$ne: "cancelled"` — MongoDB rejects negations in a
// partial index ("Expression not supported in partial index: $not").
const LIVE_PICKUP_STATUSES = ["scheduled", "picked_up", "failed"];

bostaPickupSchema.index(
  { bosta_location_id: 1, scheduled_date: 1 },
  { unique: true, partialFilterExpression: { status: { $in: LIVE_PICKUP_STATUSES } } }
);

const BostaPickup = mongoose.model("BostaPickup", bostaPickupSchema);

module.exports = { BostaPickup, LIVE_PICKUP_STATUSES };
