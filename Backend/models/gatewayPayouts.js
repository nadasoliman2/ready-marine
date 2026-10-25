const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * A transfer that arrived in our bank from a payment gateway.
 *
 * WHY IT IS TYPED IN. A gateway holds every pound it collects for us until its settlement
 * run — so at any moment there is real money at Fawaterak and at Paymob that our books had
 * no line for. Our side of that is exact: every successful payment is recorded, and the fee
 * each one carried is read off the provider's own confirmation. What is NOT available is
 * the other side: neither provider exposes a settlement or balance endpoint to the keys we
 * hold (checked 2026-09-21 — Fawaterak publishes invoice and transaction endpoints only,
 * and Paymob's balance endpoints belong to its Bills and Payouts portals, not to the Accept
 * account we collect through). So the transfers are entered as they land.
 *
 * A RUNNING BALANCE, NOT AN ITEMISED MATCH. Unlike a courier settlement — which names the
 * exact parcels it pays for, because each parcel carries its own COD — a gateway transfer is
 * one lump against a stream of payments. So this row is just the money out: the balance at a
 * gateway is everything it collected for us, net of its fees, minus everything it has sent.
 * That is how a merchant statement reads, and it is the shape the answer actually has.
 */
const gatewayPayoutSchema = new Schema(
    {
        /** "fawaterak" or "paymob" — the same strings the payment records carry. */
        provider: { type: String, required: true, index: true },

        amount: { type: Number, required: true, min: 0 },
        received_at: { type: Date, required: true, index: true },

        /** Bank reference or the gateway's own settlement id, so the row can be found again. */
        reference: { type: String, default: "", trim: true },
        notes: { type: String, default: "", trim: true },

        /**
         * Where it went: our bank, or our Paymob Payouts budget (a top-up "from Accept
         * balance" moves money from the Paymob we collect through to the one we pay vendors
         * from). The second kind is made by the Payouts top-up it belongs to, and goes with it.
         */
        destination: { type: String, enum: ["bank", "paymob_payouts"], default: "bank" },
        payouts_topup_id: { type: Schema.Types.ObjectId, ref: "PayoutsTopup", default: null },

        recorded_by: { type: Schema.Types.ObjectId, ref: "User", default: null },
        recorded_by_name: { type: String, default: "" },
    },
    { timestamps: true }
);

gatewayPayoutSchema.index({ provider: 1, received_at: -1 });

const GatewayPayout = mongoose.model("GatewayPayout", gatewayPayoutSchema);

module.exports = { GatewayPayout };
