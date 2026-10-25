const mongoose = require("mongoose");
const { Schema } = mongoose;

const subscriptionPaymentSchema = new Schema(
    {
        vendor_id: { type: Schema.Types.ObjectId, ref: "Seller", required: true, index: true },
        package_id: { type: Schema.Types.ObjectId, ref: "SubscriptionPackage", default: null },
        action: {
            type: String,
            enum: ["purchase", "renew", "resubscribe", "change_plan"],
            required: true,
            index: true,
        },
        billing_period: {
            type: String,
            enum: ["monthly", "yearly"],
            default: "monthly",
        },
        selected_product_ids: [{ type: Schema.Types.ObjectId, ref: "Product" }],
        amount: { type: Number, required: true, min: 0 },
        currency: { type: String, required: true, default: "EGP" },
        status: {
            type: String,
            enum: ["pending", "paid", "failed", "expired"],
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

const SubscriptionPayment = mongoose.model("SubscriptionPayment", subscriptionPaymentSchema);

module.exports = { SubscriptionPayment };
