const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * One row per abandoned-cart reminder the sweep tried to send (services/abandonedCartService.js),
 * for the admin's report. A log, not state: what decides whether a customer is emailed again
 * lives on the user (`abandoned_cart_reminder`); this only remembers what went out, to whom,
 * with which items, and what came of it.
 *
 * status
 *   'sent'            — Resend accepted it.
 *   'failed'          — Resend refused, or was never reached; the next run may try again.
 *   'outcome_unknown' — no answer; it may have gone out, so it is not retried.
 */
const abandonedCartEmailItemSchema = new Schema(
    {
        title: { type: String, default: "" },
        variant_label: { type: String, default: "" },
        quantity: { type: Number, default: 1 },
        price: { type: Number, default: 0 },
        link: { type: String, default: "" },
        image_url: { type: String, default: "" },
    },
    { _id: false }
);

const abandonedCartEmailSchema = new Schema(
    {
        user_id: { type: Schema.Types.ObjectId, ref: "User", required: true },
        // Snapshots: the report shows who it went to, even if the account changes later.
        customer_name: { type: String, default: "" },
        email: { type: String, default: "" },
        phone: { type: String, default: "" },
        language: { type: String, enum: ["en", "ar"], default: "en" },

        status: { type: String, enum: ["sent", "failed", "outcome_unknown"], required: true, index: true },
        // The items as the email showed them (at most the first few), the count of the rest,
        // and the value of every buyable line — not only the ones shown.
        items: { type: [abandonedCartEmailItemSchema], default: [] },
        more_count: { type: Number, default: 0 },
        items_total: { type: Number, default: 0 },

        cycle_key: { type: String, default: "" },
        attempt: { type: Number, default: 1 },
        provider_message_id: { type: String, default: null },
        error: { type: String, default: null },
        created_at: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

abandonedCartEmailSchema.index({ created_at: -1 });
abandonedCartEmailSchema.index({ user_id: 1, created_at: -1 });

const AbandonedCartEmail = mongoose.model("AbandonedCartEmail", abandonedCartEmailSchema);

module.exports = { AbandonedCartEmail };
