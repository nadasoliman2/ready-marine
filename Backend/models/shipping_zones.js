const mongoose = require("mongoose");
const { Schema } = mongoose;

/* ------------------ Zone Location ------------------ */
// A zone covers one or more (country, city) pairs. `city: null` means the whole country.
const zoneLocationSchema = new Schema(
    {
        country: { type: String, required: true, trim: true },
        country_ar: { type: String, trim: true, default: "" },
        city: { type: String, trim: true, default: null }, // null = whole country
        city_ar: { type: String, trim: true, default: "" },
    },
    { _id: true }
);

/* ------------------ Shipping Zone ------------------ */
const shippingZoneSchema = new Schema(
    {
        name: { type: String, required: true, trim: true },
        name_ar: { type: String, trim: true, default: "" },
        is_active: { type: Boolean, default: true, index: true },
        // Lower priority number wins when two active zones both cover a destination.
        priority: { type: Number, default: 0 },
        locations: { type: [zoneLocationSchema], default: [] },
    },
    { timestamps: true }
);

shippingZoneSchema.pre("validate", function (next) {
    for (const loc of this.locations || []) {
        if (!loc.country || !loc.country.trim()) {
            this.invalidate("locations", "Every zone location must have a country.");
            break;
        }
        // Normalize: trim; treat empty city string as "whole country".
        loc.country = loc.country.trim();
        if (loc.city !== null && loc.city !== undefined) {
            const c = String(loc.city).trim();
            loc.city = c.length ? c : null;
        }
    }
    if (typeof next === "function") next();
});

shippingZoneSchema.index({ "locations.country": 1 });

const ShippingZone = mongoose.model("ShippingZone", shippingZoneSchema);

module.exports = { ShippingZone };
