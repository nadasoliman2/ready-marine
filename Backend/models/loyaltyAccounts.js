const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * LoyaltyAccount — one wallet per CUSTOMER.
 *
 * Three balances, never one:
 *   pending   → earned at delivery, not spendable until the return window closes
 *   available → spendable right now
 *   reserved  → held by an active checkout/hosted payment
 *
 * These fields are a cache of the immutable `LoyaltyTransaction` ledger. Nothing
 * outside `loyaltyService` may write them: every mutation goes through a ledger
 * entry so a balance can always be explained by the transactions behind it.
 */
const loyaltyAccountSchema = new Schema(
    {
        user_id: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },

        available_points: { type: Number, default: 0, min: 0 },
        pending_points: { type: Number, default: 0, min: 0 },
        reserved_points: { type: Number, default: 0, min: 0 },

        lifetime_earned_points: { type: Number, default: 0, min: 0 },
        lifetime_redeemed_points: { type: Number, default: 0, min: 0 },

        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

const LoyaltyAccount = mongoose.model("LoyaltyAccount", loyaltyAccountSchema);

module.exports = { LoyaltyAccount };
