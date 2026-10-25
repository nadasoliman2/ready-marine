const mongoose = require("mongoose");
const { Schema } = mongoose;

const orderPaymentSchema = new Schema(
    {
        // Always the paying customer. For family orders this is the ORGANIZER.
        user_id: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
        order_id: { type: Schema.Types.ObjectId, ref: "Order", default: null, index: true },
        // Set when this payment settles a family order request.
        family_order_request_id: { type: Schema.Types.ObjectId, ref: "FamilyOrderRequest", default: null, index: true },

        // ---- Friend checkout context, frozen at payment creation.
        // Authorization is verified BEFORE the hosted payment starts; once the
        // provider has captured funds this immutable snapshot is what completes
        // the order, so revoking a friendship mid-payment cannot strand money.
        checkout_context: { type: String, enum: ["self", "friend", "company"], default: "self", index: true },
        // Company checkout (feature 14): the employee is paying online only the part of
        // the order their limit did not cover. Everything the resulting order needs about
        // the company side is frozen here, including how much was held against the limit
        // while the payment page is open — released again if the payment never completes.
        company_checkout: { type: Schema.Types.Mixed, default: null },
        friendship_id: { type: Schema.Types.ObjectId, ref: "Friendship", default: null },
        ordered_for_user_id: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
        recipient_address_id: { type: Schema.Types.ObjectId, default: null },
        checkout_payload: { type: Schema.Types.Mixed, required: true },

        // ---- Loyalty reservation, bound 1:1 to this hosted invoice ----
        // Points are held the moment the invoice is created and released the
        // moment it fails or expires, so an abandoned payment can never leave
        // a customer's balance stranded.
        loyalty_reservation_id: { type: Schema.Types.ObjectId, ref: "LoyaltyTransaction", default: null },
        redeemed_points: { type: Number, default: 0 },
        loyalty_discount: { type: Number, default: 0 },

        amount: { type: Number, required: true, min: 0 },
        currency: { type: String, required: true, default: "EGP" },
        status: {
            type: String,
            enum: ["pending", "paid", "failed", "expired", "paid_order_failed", "amount_mismatch"],
            default: "pending",
            index: true,
        },
        provider: { type: String, default: "fawaterak" },
        provider_mode: { type: String, enum: ["sandbox", "live"], default: "sandbox" },
        invoice_id: { type: String, default: null, index: true },
        invoice_key: { type: String, default: null, index: true },
        payment_url: { type: String, default: null },
        payment_method: { type: String, default: null },
        provider_reference: { type: String, default: null, index: true },
        paid_at: { type: Date, default: null },
        raw_response: { type: Schema.Types.Mixed, default: null },
        webhook_payloads: { type: [Schema.Types.Mixed], default: [] },
        activation_error: { type: String, default: null },
    },
    {
        timestamps: true,
    }
);

const OrderPayment = mongoose.model("OrderPayment", orderPaymentSchema);

module.exports = { OrderPayment };
