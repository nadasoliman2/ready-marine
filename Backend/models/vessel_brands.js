const mongoose = require("mongoose");

const { Schema } = mongoose;

/* ------------------ Year Subdocument ------------------ */
// No `_id`: a year has no identity of its own, so we save memory.
const yearSchema = new Schema(
    {
        year: {
            type: Number,
            required: true,
        },
    },
    { _id: false }
);

/* ------------------ Model / Hull Subdocument ------------------ */
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

/* ------------------ Vessel / Marine Brand Schema ------------------ */
const vesselBrandSchema = new Schema(
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
        collection: "vesselbrands",
    }
);

const VesselBrand = mongoose.models.VesselBrand || mongoose.model("VesselBrand", vesselBrandSchema);

module.exports = {
    VesselBrand,
    BoatBrand: VesselBrand,
    CarBrand: VesselBrand, // Backward-compatibility alias
};
