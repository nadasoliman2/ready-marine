const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * WalletTopup — one hosted gateway invoice that puts money INTO a wallet.
 *
 * This is the only place real money now enters the customer side of the store:
 * checkout spends wallet credit, and credit is created here. It mirrors
 * `OrderPayment` closely on purpose (same provider, same webhook shape, same
 * redirect round trip) but stays a separate collection, because the two have
 * opposite failure consequences. A failed order payment means no order; a
 * failed top-up means money may have left a customer's card with nothing to
 * show for it, so this record exists BEFORE the invoice does and is never
 * deleted — an unexplained charge must always have a row to reconcile against.
 *
 * `credited_at` and the ledger row it points to are what make crediting
 * exactly-once. The redirect and the webhook both confirm the same payment,
 * routinely within milliseconds of each other.
 */
const walletTopupSchema = new Schema(
    {
        user_id: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
        company_id: { type: Schema.Types.ObjectId, ref: 'Company', default: null, index: true },

        // Minor units (piastres), matching the ledger. See `walletAccounts.js`
        // for why money is never stored here as a float.
        amount_minor: { type: Number, required: true, min: 1 },
        currency: { type: String, required: true, default: "EGP" },

        status: {
            type: String,
            enum: ["pending", "paid", "failed", "expired", "paid_credit_failed"],
            default: "pending",
            index: true,
        },

        // Where the customer was when they started, so we can send them back
        // there. A top-up begun from checkout returns to checkout with the
        // basket intact; one begun from the wallet page returns to the wallet.
        origin: { type: String, enum: ["wallet", "checkout", "friend_checkout", "family_request"], default: "wallet" },
        return_path: { type: String, default: "" },

        provider: { type: String, default: "fawaterak" },
        provider_mode: { type: String, enum: ["sandbox", "live"], default: "sandbox" },
        invoice_id: { type: String, default: null, index: true },
        invoice_key: { type: String, default: null, index: true },
        payment_url: { type: String, default: null },
        payment_method: { type: String, default: null },
        provider_reference: { type: String, default: null, index: true },
        paid_at: { type: Date, default: null },

        // Stamped once the money reached the wallet. The presence of this field
        // — not the `paid` status — is what says the customer actually has the
        // credit, and it is set in the same step that writes the ledger row.
        credited_at: { type: Date, default: null },
        wallet_transaction_id: { type: Schema.Types.ObjectId, ref: "WalletTransaction", default: null },
        company_wallet_transaction_id: { type: Schema.Types.ObjectId, ref: 'CompanyWalletTransaction', default: null },

        raw_response: { type: Schema.Types.Mixed, default: null },
        webhook_payloads: { type: [Schema.Types.Mixed], default: [] },
        error_message: { type: String, default: null },
    },
    { timestamps: true }
);

const WalletTopup = mongoose.model("WalletTopup", walletTopupSchema);

module.exports = { WalletTopup };
