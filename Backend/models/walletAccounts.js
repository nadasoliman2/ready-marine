const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * WalletAccount — one store-credit wallet per CUSTOMER, denominated in money.
 *
 * Deliberately shaped like `LoyaltyAccount`, because the two answer the same
 * question in different units: what may this customer spend right now. The
 * difference that matters is what the balance IS. Loyalty points are a reward
 * the store issues; wallet credit is the customer's own money — topped up
 * through the payment gateway, or handed back by a refund. Every decision here
 * is a decision about someone's cash.
 *
 * ---- Why the balances are integers ----
 *
 * Balances are stored in MINOR UNITS (piastres for EGP), never in floating
 * point pounds. Mongo's `$inc` on a double accumulates representation error —
 * a wallet topped up and spent enough times drifts to 99.99999999999999 — and
 * the failure that produces is the worst kind: the customer is shown a balance
 * of 100.00, tries to spend 100.00, and is told they have insufficient funds.
 * Integers make every balance exact, so the number on the screen is provably
 * the number in the database. `walletService` converts at its boundary and is
 * the only thing that ever reads or writes these fields.
 *
 * Two balances:
 *   available → spendable right now
 *   reserved  → held by a checkout in flight
 *
 * Reserved exists for the same reason it does in loyalty: an order is placed in
 * several steps, and money about to be spent must be out of reach of a second
 * tab in the meantime.
 *
 * These fields are a CACHE of the immutable `WalletTransaction` ledger. Nothing
 * outside `walletService` may write them — every mutation goes through a ledger
 * entry, so a balance can always be explained by the transactions behind it.
 */
const walletAccountSchema = new Schema(
    {
        user_id: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },

        available_minor: { type: Number, default: 0, min: 0 },
        reserved_minor: { type: Number, default: 0, min: 0 },

        currency: { type: String, default: "EGP" },

        // Lifetime counters, for support and reporting. Never used to compute a
        // spendable balance — only `available_minor` is authoritative.
        lifetime_topped_up_minor: { type: Number, default: 0, min: 0 },
        lifetime_spent_minor: { type: Number, default: 0, min: 0 },
        lifetime_refunded_minor: { type: Number, default: 0, min: 0 },

        // ---- Support / fraud control ----
        // A frozen wallet keeps its balance and its history; it simply cannot
        // spend or be topped up while an investigation is open. Refunds and
        // admin corrections still land, because money the customer is already
        // owed must not be withheld by a flag nobody remembered to clear.
        status: { type: String, enum: ["active", "frozen"], default: "active", index: true },
        frozen_at: { type: Date, default: null },
        frozen_reason: { type: String, default: "" },
        frozen_by: { type: String, default: "" },

        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

const WalletAccount = mongoose.model("WalletAccount", walletAccountSchema);

module.exports = { WalletAccount };
