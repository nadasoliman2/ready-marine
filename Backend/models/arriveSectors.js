/**
 * Arrive Shipping delivery areas ("sectors").
 *
 * Arrive addresses a parcel at district level — 500+ areas, each inside a pricing group
 * (`gov_name`, which is a tariff band, not an administrative governorate). The list comes
 * from `getAllSectors` and is re-synced by an admin button; `docs/arrive-sectors.json` is
 * only the seed for a machine that has never reached the API.
 */
const mongoose = require("mongoose");
const { Schema } = mongoose;

const arriveSectorSchema = new Schema(
  {
    sector_id: { type: Number, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    // Normalised (diacritics stripped, alef/taa-marbuta unified) for matching address text.
    name_norm: { type: String, default: "", index: true },
    gov_id: { type: String, default: "" },
    gov_name: { type: String, default: "", index: true },
    key_words: { type: String, default: "" },
    // Arrive lists nine areas under "غير مخدومة" — priced but not actually delivered to.
    serviceable: { type: Boolean, default: true },
    synced_at: { type: Date, default: null },
  },
  { timestamps: false }
);

const ArriveSector = mongoose.model("ArriveSector", arriveSectorSchema);

module.exports = { ArriveSector };
