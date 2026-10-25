const mongoose = require("mongoose");
const { Schema } = mongoose;
const { conditionSchema, policyActionSchema } = require("./_shippingShared");

/* ------------------ Shipping Policy ------------------ */
// A cross-cutting admin rule applied AFTER the chosen zone method computes a base cost.
// Examples: "Free shipping over 2000", "Fragile items +20%", "Heavy items min fee 50".
const shippingPolicySchema = new Schema(
    {
        name: { type: String, required: true, trim: true },
        name_ar: { type: String, trim: true, default: "" },
        is_active: { type: Boolean, default: true, index: true },
        // Lower priority number runs first.
        priority: { type: Number, default: 0 },

        scope: { type: String, enum: ["global", "zone"], default: "global" },
        zone_id: { type: Schema.Types.ObjectId, ref: "ShippingZone", default: null },

        // Empty list = no filter on that dimension. A policy applies to a leg when,
        // for each non-empty list, the leg contains at least one matching item.
        applies_to: {
            shipping_class_ids: [{ type: Schema.Types.ObjectId, ref: "ShippingClass" }],
            vendor_ids: [{ type: Schema.Types.ObjectId, ref: "Seller" }],
            category_ids: [{ type: Schema.Types.ObjectId, ref: "Category" }],
        },

        condition_logic: { type: String, enum: ["all", "any"], default: "all" },
        conditions: [conditionSchema],
        actions: [policyActionSchema],
    },
    { timestamps: true }
);

shippingPolicySchema.pre("validate", function (next) {
    if (this.scope === "zone" && !this.zone_id) {
        this.invalidate("zone_id", "A zone-scoped policy must reference a zone.");
    }
    if (this.scope === "global") {
        this.zone_id = null;
    }
    if (typeof next === "function") next();
});

shippingPolicySchema.index({ is_active: 1, scope: 1 });

const ShippingPolicy = mongoose.model("ShippingPolicy", shippingPolicySchema);

module.exports = { ShippingPolicy };
