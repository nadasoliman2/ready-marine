const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * Shared sub-schemas for the shipping rule-engine methods and shipping policies.
 * Keeping these in one place so the condition vocabulary stays identical between
 * `ShippingMethod.rule_config.rules[].conditions` and `ShippingPolicy.conditions`.
 */

const CONDITION_FIELDS = [
    "cart_total",                // items subtotal for the leg, pre-coupon
    "cart_total_after_discount", // items subtotal for the leg, post-coupon
    "total_weight",              // sum of (product.weight ?? 0) * qty (kg)
    "item_count",                // sum of quantities
    "vendor_count",              // distinct vendors in the leg (1 in split mode)
    "has_class",                 // membership: a shipping class id is present in the leg
    "has_category",              // membership: a category id is present in the leg
    "has_vendor",                // membership: a vendor id is present in the leg
    "country",                   // destination country (case-insensitive string)
    "city",                      // destination city (case-insensitive string)
];

const CONDITION_OPERATORS = ["eq", "ne", "gt", "gte", "lt", "lte", "in", "not_in", "contains"];

const conditionSchema = new Schema(
    {
        field: { type: String, enum: CONDITION_FIELDS, required: true },
        operator: { type: String, enum: CONDITION_OPERATORS, required: true },
        // Number for numeric fields, string for country/city/has_*,
        // array for `in` / `not_in`.
        value: { type: Schema.Types.Mixed },
    },
    { _id: false }
);

// Actions available inside a rule-engine method rule.
const RULE_ACTION_TYPES = ["add_fixed", "add_percent", "set_cost", "free_shipping", "set_min_fee", "set_max_fee"];

const ruleActionSchema = new Schema(
    {
        type: { type: String, enum: RULE_ACTION_TYPES, required: true },
        value: { type: Number, default: 0 },
    },
    { _id: false }
);

// Actions available inside a shipping policy.
const POLICY_ACTION_TYPES = [
    "free_shipping",
    "percent_discount",
    "fixed_discount",
    "surcharge_fixed",
    "surcharge_percent",
    // Adds `value`% of the part of the leg's post-coupon subtotal that exceeds
    // `threshold`. Unlike `surcharge_percent`, which is a percentage of the shipping cost
    // computed so far, this is a percentage of the BASKET — the shape a courier's
    // value-based fee actually has. It exists because Bosta bills 1% of the COD above
    // 2000 EGP, and no combination of the other actions can express "a percentage of the
    // amount over a threshold".
    "surcharge_percent_above",
    "set_min_fee",
    "set_max_fee",
    "override_cost",
];

const policyActionSchema = new Schema(
    {
        type: { type: String, enum: POLICY_ACTION_TYPES, required: true },
        value: { type: Number, default: 0 },
        // Only read by `surcharge_percent_above`: the basket amount below which the
        // surcharge is nothing. Ignored by every other action.
        threshold: { type: Number, default: 0 },
    },
    { _id: false }
);

const ruleSchema = new Schema(
    {
        name: { type: String, trim: true, default: "Rule" },
        priority: { type: Number, default: 0 },
        stop_processing: { type: Boolean, default: false },
        condition_logic: { type: String, enum: ["all", "any"], default: "all" },
        conditions: [conditionSchema],
        actions: [ruleActionSchema],
    },
    { _id: true }
);

module.exports = {
    CONDITION_FIELDS,
    CONDITION_OPERATORS,
    RULE_ACTION_TYPES,
    POLICY_ACTION_TYPES,
    conditionSchema,
    ruleActionSchema,
    policyActionSchema,
    ruleSchema,
};
