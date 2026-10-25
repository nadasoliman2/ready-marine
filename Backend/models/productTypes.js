const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * A product type: a broad, shopper-facing grouping of categories — "Spare parts", "Routine
 * maintenance", "Accessories" — for people who know what they want but not which part of the
 * car it belongs to. Categories carry the types they belong to (`Category.type_ids`, any
 * level, more than one); the home page's search offers the types instead of the category
 * tree, and the shop shows a type's categories as its cards.
 */
const productTypeSchema = new Schema(
    {
        name: { type: String, required: true, trim: true },
        name_ar: { type: String, trim: true, default: "" },
        image: { type: String, default: "" },
        sort_order: { type: Number, default: 0 },
        is_active: { type: Boolean, default: true, index: true },
    },
    { timestamps: true }
);

const ProductType = mongoose.model("ProductType", productTypeSchema);

module.exports = { ProductType };
