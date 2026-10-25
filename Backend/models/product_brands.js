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
        // The categories this brand makes things for. A parent category stands for every
        // category under it. EMPTY MEANS UNKNOWN, not "none": a brand nobody has tagged yet
        // keeps appearing everywhere, so tagging can happen brand by brand without the
        // untagged ones vanishing from every filter in the meantime.
        categories: [{ type: Schema.Types.ObjectId, ref: "Category" }],
    },
    {
        timestamps: true, // createdAt / updatedAt (مفيد هنا)
    }
);

const Brand = mongoose.model("Brand", brandSchema);

module.exports = { Brand };