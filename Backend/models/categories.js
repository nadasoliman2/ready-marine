const mongoose = require("mongoose");
const { Schema } = mongoose;

const categorySchema = new Schema(
    {
        name: { type: String, required: true, trim: true },
        name_ar: { type: String, trim: true },
        parent_id: { 
            type: Schema.Types.ObjectId, 
            ref: "Category", 
            default: null,
            index: true
        },
        image: { type: String },
        sort_order: { type: Number, default: 0 },
        is_active: { type: Boolean, default: true, index: true },
        // The product types this category is offered under (models/productTypes.js). Any
        // level, and more than one: "Brakes" is both a spare part and routine maintenance.
        type_ids: { type: [{ type: Schema.Types.ObjectId, ref: "ProductType" }], default: [], index: true }
    },
    { timestamps: true }
);

const Category = mongoose.model("Category", categorySchema);

module.exports = { Category };
