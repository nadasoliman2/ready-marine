const mongoose = require("mongoose");

const { Schema } = mongoose;

/* ------------------ Year Subdocument ------------------ */
// No `_id`: a year has no identity of its own, and at ~111K of these across all
// brands the per-subdocument ObjectId was pure weight (a third of this collection's size)
// for a field nothing ever addresses by id.
const yearSchema = new Schema(
    {
        year: {
            type: Number,
            required: true,
        },
    },
    { _id: false }
);

/* ------------------ Model Subdocument ------------------ */
const modelSchema = new Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        years: [yearSchema],
    },
    { _id: true }
);

/* ------------------ Car Brand Schema ------------------ */
const carBrandSchema = new Schema(
    {
        name: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },
        image: {
            type: String,
            trim: true,
        },
        is_featured: {
            type: Boolean,
            default: false,
        },

        models: [modelSchema],
    },
    {
        timestamps: true,
    }
);

const CarBrand = mongoose.model("CarBrand", carBrandSchema);

module.exports = { CarBrand };