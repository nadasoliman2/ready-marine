const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * A transfer that actually landed in our bank from a courier.
 *
 * WHY IT IS RECORDED BY HAND. A courier collects cash at the door and holds it — Bosta pays
 * out weekly, on Wednesdays — so at any moment there is a real amount of our money sitting
 * at each courier. Our own books can say what that amount SHOULD be, parcel by parcel. Only
 * the bank can say what arrived. Until Bosta opens `/wallet/cashouts` and
 * `/businesses/{id}/transactions` to the API key (both answer 401 to it today), the second
 * half of that sentence has to be typed in.
 *
 * WHAT IT IS FOR. Not bookkeeping for its own sake: the `difference` is the point. A
 * transfer that comes up short is a deduction nobody told us about — a fee, a lost parcel, a
 * COD collected and not passed on — and without this row it is invisible, because the
 * expected figure quietly gets replaced by whatever arrived.
 */
const courierSettlementSchema = new Schema(
    {
        provider: { type: String, required: true, index: true },

        /** What actually reached the bank. */
        amount: { type: Number, required: true },
        /** What our parcel ledger said those same parcels owed us. */
        expected_amount: { type: Number, default: 0 },
        /** `amount - expected_amount`. Negative means the courier kept more than we booked. */
        difference: { type: Number, default: 0 },

        received_at: { type: Date, required: true, index: true },
        /** Bank reference, Bosta cashout id, whatever lets this be found again later. */
        reference: { type: String, default: "", trim: true },
        notes: { type: String, default: "", trim: true },

        /** How many parcels this transfer closed. The parcels themselves carry the back-link. */
        parcels_count: { type: Number, default: 0 },

        recorded_by: { type: Schema.Types.ObjectId, ref: "User", default: null },
        recorded_by_name: { type: String, default: "" },
    },
    { timestamps: true }
);

courierSettlementSchema.index({ provider: 1, received_at: -1 });

const CourierSettlement = mongoose.model("CourierSettlement", courierSettlementSchema);

module.exports = { CourierSettlement };
