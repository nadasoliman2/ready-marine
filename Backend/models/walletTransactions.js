const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * WalletTransaction — the immutable wallet ledger.
 *
 * Every piastre that moves produces exactly one row. Nothing in the app updates
 * or deletes a row: a correction is a NEW compensating transaction, so a
 * balance can always be re-derived from history. This is the record that
 * answers "where did my money go" for a customer and "what did we actually do"
 * for support, so it is written even on paths where it costs an extra write.
 *
 * `idempotency_key` is unique and carries the business identity of the
 * operation (`topup:<id>:credit`, `order:<id>:purchase`, `refund:<id>:credit`).
 * The gateway redirect and the gateway webhook race each other on every single
 * top-up, and Bosta/return hooks fire repeatedly — the unique index is what
 * makes a repeat a no-op instead of double money.
 */
const WALLET_TRANSACTION_TYPES = [
    "topup",            // gateway payment confirmed → credit added
    "purchase",         // order paid from the wallet
    "purchase_reserve", // checkout in flight → available held
    "purchase_release", // checkout abandoned/failed → hold returned
    "purchase_refund",  // order cancelled → money returned to the wallet
    "refund_credit",    // return/refund settled into the wallet
    "admin_credit",     // manual support credit
    "admin_debit",      // manual support debit
];

const walletTransactionSchema = new Schema(
    {
        user_id: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
        account_id: { type: Schema.Types.ObjectId, ref: "WalletAccount", required: true, index: true },

        type: { type: String, enum: WALLET_TRANSACTION_TYPES, required: true, index: true },

        // Always a POSITIVE magnitude in minor units — direction is carried by
        // `type` and by the balance deltas below, so a row is never ambiguous.
        amount_minor: { type: Number, required: true, min: 0 },
        currency: { type: String, default: "EGP" },

        // Exact effect this row had on each balance (may be negative). Kept so
        // the ledger explains a balance without re-deriving the rules that
        // produced it — the rules may change, the history may not.
        balance_deltas: {
            available: { type: Number, default: 0 },
            reserved: { type: Number, default: 0 },
        },

        // Balance AFTER this row was applied. A statement line is far more
        // useful — and far easier to reconcile against — when it carries the
        // running balance rather than requiring the reader to sum the history.
        balance_after_minor: { type: Number, default: 0 },

        order_id: { type: Schema.Types.ObjectId, ref: "Order", default: null, index: true },
        topup_id: { type: Schema.Types.ObjectId, ref: "WalletTopup", default: null, index: true },
        refund_id: { type: Schema.Types.ObjectId, ref: "Refund", default: null, index: true },
        // Set when the money moved on behalf of someone else's basket — a
        // friend order or a family request. The payer owns the row; this is who
        // it was spent for.
        beneficiary_user_id: { type: Schema.Types.ObjectId, ref: "User", default: null },

        idempotency_key: { type: String, required: true, unique: true, index: true },

        reason: { type: String, default: "" },
        actor: {
            role: { type: String, default: "system" },
            label: { type: String, default: "System" },
        },

        created_at: { type: Date, default: Date.now, index: true },
    },
    { timestamps: false }
);

walletTransactionSchema.index({ user_id: 1, created_at: -1 });

const WalletTransaction = mongoose.model("WalletTransaction", walletTransactionSchema);

module.exports = { WalletTransaction, WALLET_TRANSACTION_TYPES };
