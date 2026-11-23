const mongoose = require("mongoose");

const { Schema } = mongoose;

/* ------------------ Brand Schema ------------------ */
const brandSchema = new Schema(
    {
        name: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
        },
        image: {
            type: String, // Logo URL
        },
        categories: [{ type: Schema.Types.ObjectId, ref: "Category" }],
    },
    {
        timestamps: true,
    }
);

const Brand = mongoose.models.Brand || mongoose.model("Brand", brandSchema);

// Register aliases so legacy Mongoose queries resolve directly to Brand
if (!mongoose.models.ProductBrand) mongoose.models.ProductBrand = Brand;

module.exports = {
    Brand,
    ProductBrand: Brand,
};
