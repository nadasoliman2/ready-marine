const mongoose = require("mongoose");
const crypto = require("crypto");
const { Schema } = mongoose;

/**
 * SupplyOrder — a vendor's request for packaging and labels, and the record of what they
 * paid for it.
 *
 * TWO INDEPENDENT AXES, deliberately kept as two fields:
 *   `payment_status` — has the money settled?
 *   `status`         — has the box physically reached the vendor?
 * They do not move together. An order can be paid and not yet packed, or handed over at a
 * pickup before the online payment webhook lands. Collapsing them into one enum would have
 * forced a state for every combination and made "paid but not sent" indistinguishable from
 * "sent but not paid" — which are opposite problems for whoever is chasing it.
 *
 * HOW IT IS PAID. The vendor's earnings wallet pays as much as it can and a hosted Fawaterak
 * invoice covers the rest, so a vendor with money in the store does not have to reach for a
 * card. Both halves are recorded as amounts, never as a mutated balance: the wallet in this
 * codebase is DERIVED (see vendorEarningsService.recomputeWalletBalances), so `wallet_amount`
 * on this row IS the debit. That is what makes a cancelled or failed order release the money
 * with no compensating write — the row stops matching the sum, and the balance is right again.
 */

const supplyOrderHistorySchema = new Schema(
    {
        action: { type: String, required: true },
        title: { type: String, required: true },
        details: { type: String, default: "" },
        actor_role: { type: String, default: "system" },
        actor_label: { type: String, default: "System" },
        metadata: { type: Schema.Types.Mixed },
        created_at: { type: Date, default: Date.now },
    },
    { _id: true }
);

/**
 * One line. Every commercial field is SNAPSHOTTED at order time — an admin who re-prices
 * flyers tomorrow must not silently re-price an order placed today, and deleting a
 * discontinued item must not leave an order unable to say what was bought.
 */
const supplyOrderItemSchema = new Schema(
    {
        product_id: { type: Schema.Types.ObjectId, ref: "SupplyProduct", default: null },
        name: { type: String, required: true },
        name_ar: { type: String, default: "" },
        dimensions: { type: String, default: "" },
        category: { type: String, default: "other" },

        /** Packs ordered. */
        quantity: { type: Number, required: true, min: 1 },
        /** Price of ONE pack at the time of ordering. */
        unit_price: { type: Number, required: true, min: 0 },
        /** Pieces in one pack at the time of ordering. */
        pack_size: { type: Number, required: true, min: 1, default: 1 },
        unit_label: { type: String, default: "piece" },
        unit_label_ar: { type: String, default: "قطعة" },

        /** quantity × unit_price. Stored so a total never depends on re-deriving old prices. */
        line_total: { type: Number, required: true, min: 0 },
    },
    { _id: true }
);

const FULFILMENT_STATUSES = ["pending", "approved", "sent", "delivered", "rejected", "cancelled"];
const PAYMENT_STATUSES = ["unpaid", "awaiting_online", "paid", "failed", "cancelled"];
/** Handing the box over with a courier the vendor already sees is the cheapest route. */
const DELIVERY_METHODS = ["with_pickup", "courier", "handover"];

const supplyOrderSchema = new Schema(
    {
        order_number: { type: String, required: true, unique: true, index: true },
        vendor_id: { type: Schema.Types.ObjectId, ref: "Seller", required: true, index: true },

        items: { type: [supplyOrderItemSchema], required: true },
        /** Σ line_total. There is no tax or shipping line — the price list is all-in. */
        total: { type: Number, required: true, min: 0 },

        /* ---- Money ---- */
        // How the total was split when the order was placed. wallet + online === total.
        wallet_amount: { type: Number, default: 0, min: 0 },
        online_amount: { type: Number, default: 0, min: 0 },
        payment_status: { type: String, enum: PAYMENT_STATUSES, default: "unpaid", index: true },
        // When the wallet half stopped being a hold and became a spend. Both halves settle
        // together — a part-paid order is a state nobody could act on.
        settled_at: { type: Date, default: null },

        payment: {
            provider: { type: String, default: "fawaterak" },
            provider_mode: { type: String, enum: ["sandbox", "live"], default: "sandbox" },
            invoice_id: { type: String, default: null, index: true },
            invoice_key: { type: String, default: null, index: true },
            payment_url: { type: String, default: null },
            payment_method: { type: String, default: null },
            provider_reference: { type: String, default: null, index: true },
            // How many times a payment page has been opened for this order.
            // Unlike the other three flows, a supply order can reopen its
            // payment on the same row — and Paymob rejects a reference it has
            // already seen, so every attempt has to mint a fresh one.
            attempt: { type: Number, default: 0 },
            paid_at: { type: Date, default: null },
            error: { type: String, default: null },
            raw_response: { type: Schema.Types.Mixed, default: null },
            webhook_payloads: { type: [Schema.Types.Mixed], default: [] },
        },

        /* ---- Fulfilment ---- */
        status: { type: String, enum: FULFILMENT_STATUSES, default: "pending", index: true },
        // Snapshotted from the vendor's default branch so the admin knows where to send it
        // without opening the vendor record.
        ship_to: {
            contact_name: { type: String, default: "" },
            phone: { type: String, default: "" },
            address: { type: String, default: "" },
            city: { type: String, default: "" },
        },
        delivery: {
            method: { type: String, enum: DELIVERY_METHODS, default: "with_pickup" },
            tracking_number: { type: String, default: "" },
            notes: { type: String, default: "" },
            sent_at: { type: Date, default: null },
            delivered_at: { type: Date, default: null },
        },

        vendor_note: { type: String, default: "" },
        admin_note: { type: String, default: "" },
        rejection_reason: { type: String, default: "" },

        history: { type: [supplyOrderHistorySchema], default: [] },
    },
    { timestamps: true }
);

/* ------------------ Indexes ------------------ */
supplyOrderSchema.index({ vendor_id: 1, createdAt: -1 });
supplyOrderSchema.index({ status: 1, createdAt: -1 });
// The wallet derivation sums `wallet_amount` per vendor by payment_status, so it reads
// straight off this index instead of scanning the collection on every balance refresh.
supplyOrderSchema.index({ vendor_id: 1, payment_status: 1 });

supplyOrderSchema.pre("validate", function (next) {
    // The split must always describe the whole total. A rounding drift here would show up
    // as money quietly appearing in or vanishing from a vendor's balance.
    const split = Number((Number(this.wallet_amount || 0) + Number(this.online_amount || 0)).toFixed(2));
    if (split !== Number(Number(this.total || 0).toFixed(2))) {
        this.invalidate("wallet_amount", "The wallet and online amounts must add up to the order total.");
    }
    if (typeof next === "function") next();
});

/* ------------------ Helpers ------------------ */
const generateSupplyOrderNumber = () =>
    `SUP-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

const appendSupplyHistory = (order, action, title, details = "", actor = {}, metadata = {}) => {
    order.history.push({
        action,
        title,
        details,
        actor_role: actor.role || "system",
        actor_label: actor.label || "System",
        metadata,
        created_at: new Date(),
    });
};

const SupplyOrder = mongoose.model("SupplyOrder", supplyOrderSchema);

module.exports = {
    SupplyOrder,
    generateSupplyOrderNumber,
    appendSupplyHistory,
    FULFILMENT_STATUSES,
    PAYMENT_STATUSES,
    DELIVERY_METHODS,
};
