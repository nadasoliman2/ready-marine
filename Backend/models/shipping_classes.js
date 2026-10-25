const mongoose = require("mongoose");
const { Schema } = mongoose;

/* ------------------ Shipping Class ------------------ */
// A classification assigned to products that influences shipping cost
// (e.g. Light, Heavy, Fragile, Perishable). Admin-managed only.
const shippingClassSchema = new Schema(
    {
        name: { type: String, required: true, trim: true },
        name_ar: { type: String, trim: true, default: "" },
        description: { type: String, trim: true, default: "" },
        // Optional flat handling fee suggested for this class (a class_based
        // method may also define its own per-class handling fee that overrides this).
        default_handling_fee: { type: Number, default: 0, min: 0 },
        is_active: { type: Boolean, default: true, index: true },
    },
    { timestamps: true }
);

// Case-insensitive uniqueness on name.
shippingClassSchema.index(
    { name: 1 },
    { unique: true, collation: { locale: "en", strength: 2 } }
);

const ShippingClass = mongoose.model("ShippingClass", shippingClassSchema);

module.exports = { ShippingClass };
