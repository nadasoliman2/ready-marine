const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * LoyaltyTransaction — the immutable loyalty ledger.
 *
 * Every point that moves produces exactly one row. Nothing in the app updates
 * or deletes a row: a correction is a NEW compensating transaction, so the
 * account balances can always be re-derived from history.
 *
 * `idempotency_key` is unique and carries the business identity of the
 * operation (`order:<id>:earn-pending`, `payment:<id>:redeem-consume`, ...).
 * Bosta webhooks, the polling sweep, the payment redirect, and the payment
 * webhook all fire the same hooks more than once — the unique index is what
 * makes a repeat a no-op instead of double points.
 */
const LOYALTY_TRANSACTION_TYPES = [
    "earn_pending",     // delivered order → points held for the return window
    "earn_release",     // return window closed → pending becomes available
    "earn_reverse",     // refund → earned points taken back (pending first)
    "redeem_reserve",   // hosted payment started → available held
    "redeem_release",   // payment failed/expired → hold returned
    "redeem_consume",   // payment/order succeeded → points spent
    "redeem_restore",   // cancellation/refund → spent points given back
    "admin_credit",     // manual support credit
    "admin_debit",      // manual support debit
    "expire",           // reserved for a future expiry policy (unused in MVP)
];

const loyaltyTransactionSchema = new Schema(
    {
        user_id: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
        account_id: { type: Schema.Types.ObjectId, ref: "LoyaltyAccount", required: true, index: true },

        type: { type: String, enum: LOYALTY_TRANSACTION_TYPES, required: true, index: true },

        // Always a POSITIVE magnitude — direction is carried by `type` and by
        // the balance deltas below, so a row is never ambiguous.
        points: { type: Number, required: true, min: 0 },
        // The EGP value of those points at the moment of this transaction.
        monetary_value: { type: Number, default: 0 },

        // Exact effect this row had on each balance (may be negative). Kept so
        // the ledger explains a balance without re-deriving the rules that
        // produced it — the rules may change, the history may not.
        balance_deltas: {
            available: { type: Number, default: 0 },
            pending: { type: Number, default: 0 },
            reserved: { type: Number, default: 0 },
        },

        order_id: { type: Schema.Types.ObjectId, ref: "Order", default: null, index: true },
        payment_id: { type: Schema.Types.ObjectId, ref: "OrderPayment", default: null, index: true },
        refund_id: { type: Schema.Types.ObjectId, ref: "Refund", default: null, index: true },
        source_transaction_id: { type: Schema.Types.ObjectId, ref: "LoyaltyTransaction", default: null },

        idempotency_key: { type: String, required: true, unique: true, index: true },

        // Frozen rates. Admin may change the program at any time; a historical
        // transaction must keep the numbers it was actually computed with.
        settings_snapshot: {
            spend_per_point: { type: Number, default: 0 },
            point_value: { type: Number, default: 0 },
            currency: { type: String, default: "EGP" },
        },

        // When a pending earn becomes spendable (earn_pending only).
        available_at: { type: Date, default: null, index: true },

        reason: { type: String, default: "" },
        actor: {
            role: { type: String, default: "system" },
            label: { type: String, default: "System" },
        },

        created_at: { type: Date, default: Date.now, index: true },
    },
    { timestamps: false }
);

loyaltyTransactionSchema.index({ user_id: 1, created_at: -1 });

const LoyaltyTransaction = mongoose.model("LoyaltyTransaction", loyaltyTransactionSchema);

module.exports = { LoyaltyTransaction, LOYALTY_TRANSACTION_TYPES };
