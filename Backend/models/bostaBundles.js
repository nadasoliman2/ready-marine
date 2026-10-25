const mongoose = require("mongoose");

/**
 * Bosta's prepaid shipping bundles, mirrored locally.
 *
 * WHY A MIRROR AND NOT A LIVE CALL. Two reasons, and they pull in the same direction:
 *
 *   · A parcel's cost is stamped at dispatch and must never move afterwards. Pricing a
 *     parcel needs the credit price of the bundle that was live THAT day — 2000/20 = 100 —
 *     and Bosta's API only ever answers about today. Once a cycle closes, the only place
 *     that number still exists is here.
 *
 *   · Bosta reports a bundle's consumption only while it is alive. The cycle that ran
 *     15 Aug → 19 Sep was bought for 20 parcels and used 11 of them: 9 parcels' worth of
 *     money, 900 EGP, expired unused. That fact has to be captured before the cycle rolls
 *     over, or the loss is invisible for ever.
 *
 * A row per BUNDLE CYCLE, keyed on Bosta's own subscription id, so re-syncing is an upsert
 * and can be run as often as we like.
 */
const bostaBundleCycleSchema = new mongoose.Schema(
    {
        /** Bosta's subscription id — the natural key, so a re-sync updates rather than duplicates. */
        subscription_id: { type: Number, required: true, unique: true, index: true },
        /** Which of the sold bundles this is (1 = Starter, 2 = Plus, 3 = Pro at time of writing). */
        bundle_id: { type: Number, default: null },
        name_ar: { type: String, default: "" },
        name_en: { type: String, default: "" },

        /** What we paid for the cycle, and how many parcels it carries. */
        paid_amount: { type: Number, default: 0 },
        total_orders: { type: Number, default: 0 },
        /** How many of them Bosta says are used. Only moves while the cycle is open. */
        consumed_orders: { type: Number, default: 0 },

        /**
         * What one parcel on this bundle costs us: `paid_amount / total_orders`.
         *
         * This is THE cost figure for a Bosta parcel now. It does not vary by governorate or
         * by size — verified against Bosta's own calculator, which discounts the full
         * shipping fee of every destination and every size down to zero while the bundle is
         * live, from a 97 EGP Cairo parcel to a 994 EGP heavy-bulky one to Aswan.
         */
        credit_price: { type: Number, default: 0 },

        started_at: { type: Date, default: null },
        /** A bundle dies on this date WITH ITS UNUSED PARCELS. They do not roll over. */
        expires_at: { type: Date, default: null, index: true },

        status: { type: String, enum: ["active", "expired", "consumed"], default: "active", index: true },
        auto_renewal: { type: Boolean, default: false },

        /* ---- Filled once when the cycle ends, never recomputed ---- */
        closed_at: { type: Date, default: null },
        /** Parcels bought and never shipped. */
        wasted_orders: { type: Number, default: 0 },
        /** `wasted_orders * credit_price` — money paid for nothing, reported as its own loss. */
        wasted_amount: { type: Number, default: 0 },

        /* ---- Alert bookkeeping: each warning is sent once per cycle ---- */
        low_orders_alert_at: { type: Date, default: null },
        expiry_alert_at: { type: Date, default: null },
        depleted_alert_at: { type: Date, default: null },

        synced_at: { type: Date, default: null },
    },
    { timestamps: true }
);

const BostaBundleCycle = mongoose.model("BostaBundleCycle", bostaBundleCycleSchema);

module.exports = { BostaBundleCycle };
