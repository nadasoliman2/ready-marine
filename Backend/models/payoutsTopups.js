const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * Money loaded into our Paymob Payouts budget — the account vendors are paid from.
 *
 * The budget goes down by every transfer to a vendor (and Paymob's fee on it) and up only by
 * these. Paymob lists them (topup/inquire), and a sync copies every one here, so most rows
 * are `origin: "paymob"`. A top-up the admin knows about before Paymob lists it is entered by
 * hand (`origin: "manual"`); when Paymob lists it, the sync links that row rather than add a
 * second one.
 *
 * Only an approved top-up is money in the budget. Pending ones are kept to be shown as such.
 */
const payoutsTopupSchema = new Schema(
    {
        amount: { type: Number, required: true, min: 0.01 },

        /** When the budget was credited: Paymob's approval time, or the date typed in. */
        topped_up_at: { type: Date, default: null, index: true },

        /** Where the money came from — Paymob's transfer_type, in our words. */
        source: {
            type: String,
            enum: ["bank_transfer", "bank_deposit", "accept_balance", "other"],
            default: "other",
        },

        /** Paymob's status for it; a hand-entered one is taken as approved. */
        status: { type: String, enum: ["pending", "initiated", "approved", "rejected"], default: "approved", index: true },

        origin: { type: String, enum: ["paymob", "manual"], required: true },
        paymob_topup_id: { type: Number, default: null },
        paymob_created_at: { type: Date, default: null },
        rejection_reason: { type: String, default: "" },

        reference: { type: String, default: "", trim: true },
        notes: { type: String, default: "", trim: true },

        recorded_by: { type: Schema.Types.ObjectId, ref: "User", default: null },
        recorded_by_name: { type: String, default: "" },

        /** Paymob's last answer for it, as received. */
        raw: { type: Schema.Types.Mixed, default: null },
    },
    { timestamps: true }
);

payoutsTopupSchema.index({ paymob_topup_id: 1 }, { unique: true, partialFilterExpression: { paymob_topup_id: { $type: "number" } } });

const PayoutsTopup = mongoose.model("PayoutsTopup", payoutsTopupSchema);

module.exports = { PayoutsTopup };
