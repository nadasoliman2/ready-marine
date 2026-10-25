const mongoose = require("mongoose");
const { Schema } = mongoose;

const citySchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    name_ar: { type: String, required: true, trim: true },
    bosta_code: { type: String, required: true, unique: true, trim: true },
    // Bosta's 7-sector grouping (1 Cairo & Giza ... 7 Sinai & New Valley). The sector, not
    // the city, is what the courier's rate table is keyed on, so this is what decides which
    // shipping zone a destination falls into. Sourced from Bosta's own /cities response and
    // mirrored in services/bostaTariff.js.
    bosta_sector: { type: Number, default: null, min: 1, max: 7, index: true },
    country: { type: String, default: "Egypt", trim: true },
    country_ar: { type: String, default: "مصر", trim: true },
  },
  { timestamps: false }
);

citySchema.index({ country: 1, name: 1 });

const City = mongoose.model("City", citySchema);

module.exports = { City };
