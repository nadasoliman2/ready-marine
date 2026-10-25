const mongoose = require("mongoose");
const { Schema } = mongoose;
const { ruleSchema } = require("./_shippingShared");

/* ------------------ Flat-rate config ------------------ */
const flatConfigSchema = new Schema(
    {
        per_item_cost: { type: Number, default: 0 },
        per_vendor_cost: { type: Number, default: 0 },
    },
    { _id: false }
);

/* ------------------ Weight-tier config ------------------ */
const weightTierSchema = new Schema(
    {
        min_weight: { type: Number, default: 0, min: 0 },
        max_weight: { type: Number, default: null }, // null = ∞
        cost: { type: Number, default: 0 },
    },
    { _id: true }
);

const weightConfigSchema = new Schema(
    {
        tiers: { type: [weightTierSchema], default: [] },
    },
    { _id: false }
);

/* ------------------ Class-based config ------------------ */
const classRateSchema = new Schema(
    {
        shipping_class_id: { type: Schema.Types.ObjectId, ref: "ShippingClass", required: true },
        cost: { type: Number, default: 0 },
        handling_fee: { type: Number, default: 0 },
        surcharge_percent: { type: Number, default: 0 },
    },
    { _id: true }
);

const classConfigSchema = new Schema(
    {
        default_class_cost: { type: Number, default: 0 }, // applied once per leg if any unclassed product is present
        class_rates: { type: [classRateSchema], default: [] },
    },
    { _id: false }
);

/* ------------------ Rule-engine config ------------------ */
const ruleConfigSchema = new Schema(
    {
        rules: { type: [ruleSchema], default: [] },
    },
    { _id: false }
);

/* ------------------ Shipping Method ------------------ */
const METHOD_TYPES = ["flat", "weight_tier", "class_based", "rule_engine"];

const shippingMethodSchema = new Schema(
    {
        zone_id: { type: Schema.Types.ObjectId, ref: "ShippingZone", required: true, index: true },
        name: { type: String, required: true, trim: true },
        name_ar: { type: String, trim: true, default: "" },
        type: { type: String, enum: METHOD_TYPES, required: true },
        is_active: { type: Boolean, default: true },
        sort_order: { type: Number, default: 0 },
        delivery_time_min_days: { type: Number, default: null, min: 0 },
        delivery_time_max_days: { type: Number, default: null, min: 0 },

        base_cost: { type: Number, default: 0 },
        min_fee: { type: Number, default: 0, min: 0 },
        max_fee: { type: Number, default: null }, // null = no cap

        flat_config: { type: flatConfigSchema, default: undefined },
        weight_config: { type: weightConfigSchema, default: undefined },
        class_config: { type: classConfigSchema, default: undefined },
        rule_config: { type: ruleConfigSchema, default: undefined },
    },
    { timestamps: true }
);

shippingMethodSchema.pre("validate", function (next) {
    // max_fee >= min_fee
    if (this.max_fee !== null && this.max_fee !== undefined) {
        if (Number(this.max_fee) < Number(this.min_fee || 0)) {
            this.invalidate("max_fee", "Maximum fee must be greater than or equal to the minimum fee.");
        }
    }

    // Exactly the matching type-config must be present.
    if (this.type === "flat") {
        if (!this.flat_config) this.flat_config = {};
    } else if (this.type === "weight_tier") {
        if (!this.weight_config || !Array.isArray(this.weight_config.tiers) || this.weight_config.tiers.length === 0) {
            this.invalidate("weight_config", "A weight-tier method requires at least one weight tier.");
        } else {
            const tiers = [...this.weight_config.tiers].sort((a, b) => Number(a.min_weight || 0) - Number(b.min_weight || 0));
            this.weight_config.tiers = tiers;
            if (Number(tiers[0].min_weight || 0) !== 0) {
                this.invalidate("weight_config", "The first weight tier must start at 0 kg.");
            }
            let openEnded = 0;
            for (let i = 0; i < tiers.length; i++) {
                const t = tiers[i];
                const max = (t.max_weight === null || t.max_weight === undefined) ? null : Number(t.max_weight);
                if (max === null) {
                    openEnded += 1;
                } else if (max <= Number(t.min_weight || 0)) {
                    this.invalidate("weight_config", "Each weight tier's max must be greater than its min.");
                }
                if (i > 0) {
                    const prev = tiers[i - 1];
                    const prevMax = (prev.max_weight === null || prev.max_weight === undefined) ? null : Number(prev.max_weight);
                    if (prevMax === null) {
                        this.invalidate("weight_config", "Only the last weight tier may be open-ended (no max).");
                    } else if (Number(t.min_weight || 0) !== prevMax) {
                        this.invalidate("weight_config", "Weight tiers must be contiguous (each tier's min must equal the previous tier's max).");
                    }
                }
            }
            if (openEnded !== 1) {
                this.invalidate("weight_config", "Exactly one weight tier (the last) must be open-ended (no max).");
            }
        }
    } else if (this.type === "class_based") {
        if (!this.class_config) this.class_config = { class_rates: [] };
    } else if (this.type === "rule_engine") {
        if (!this.rule_config) this.rule_config = { rules: [] };
    }

    // Clear configs that don't belong to the selected type (avoid stale data).
    if (this.type !== "flat") this.flat_config = undefined;
    if (this.type !== "weight_tier") this.weight_config = undefined;
    if (this.type !== "class_based") this.class_config = undefined;
    if (this.type !== "rule_engine") this.rule_config = undefined;

    if (typeof next === "function") next();
});

shippingMethodSchema.index({ zone_id: 1, is_active: 1, sort_order: 1 });

const ShippingMethod = mongoose.model("ShippingMethod", shippingMethodSchema);

module.exports = { ShippingMethod, METHOD_TYPES };
