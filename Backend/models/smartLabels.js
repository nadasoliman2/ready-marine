const mongoose = require("mongoose");
const { Schema } = mongoose;

/* ------------------ Smart Label reservation ------------------ */
/**
 * A pre-printed Bosta label the vendor stuck on a parcel and scanned, held against the
 * shipment that parcel will become.
 *
 * This is NOT an inventory of labels and NOT a source of truth about the number: Bosta
 * sells the labels, owns the numbers, and is the final judge when the delivery is created.
 * The row exists so the obvious mistake — the same label on two parcels — is caught while
 * the vendor is still holding the parcel, without spending a Bosta call to find out.
 *
 * One row per prospective shipment. A vendor has exactly one supervision per order and
 * that supervision carries the fulfillment location, so (order, vendor) is the same key
 * `groupItemsByPickupLocation` splits shipments on — hence one label per vendor per order.
 */
const smartLabelSchema = new Schema(
  {
    // Scanned verbatim. There is deliberately no format validation: Bosta's label numbering
    // isn't documented to us, and a guessed filter would reject valid labels.
    tracking_number: { type: String, required: true, trim: true },

    order_id: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    vendor_id: { type: Schema.Types.ObjectId, ref: "Seller", required: true, index: true },
    // Snapshot of the supervision's fulfillment location at scan time — informational, so
    // an admin can see which branch scanned. The reservation follows the vendor, not the
    // branch, so a later branch change keeps the label attached.
    fulfillment_location: { type: String, default: "" },

    // reserved  — held locally, nothing sent to Bosta yet; free to unlink.
    // dispatched — the delivery exists on Bosta under this number; unlinking is refused
    //              because Bosta, not us, now holds the number.
    status: { type: String, enum: ["reserved", "dispatched"], default: "reserved", index: true },

    scanned_by_role: { type: String, enum: ["vendor", "admin"], required: true },
    scanned_by_label: { type: String, default: "" },
    scanned_at: { type: Date, default: Date.now },
    dispatched_at: { type: Date, default: null },
  },
  { timestamps: false }
);

/* ------------------ Indexing ------------------ */
// The duplicate guard. Unique rather than a read-then-write check so two vendors scanning
// the same number at the same instant can't both win — the second insert simply fails.
smartLabelSchema.index({ tracking_number: 1 }, { unique: true });
// One label per shipment ("شحنة واحدة = ملصق واحد"), enforced by the database for the same
// reason: two tabs scanning two labels onto one shipment must not both stick.
smartLabelSchema.index({ order_id: 1, vendor_id: 1 }, { unique: true });

const SmartLabel = mongoose.model("SmartLabel", smartLabelSchema);

module.exports = { SmartLabel };
