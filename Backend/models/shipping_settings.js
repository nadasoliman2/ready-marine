const mongoose = require("mongoose");

/* ------------------ Shipping Settings (singleton) ------------------ */
// Kept separate from SiteSettings because SiteSettings is shipped to the public
// client AppContext; these are internal/admin knobs.
const shippingSettingsSchema = new mongoose.Schema(
    {
        enabled: { type: Boolean, default: true },
        // "split" prices each (vendor, branch) parcel on its own leg and sums the legs into
        // the one total the customer sees. "combined" prices the basket as a whole and
        // apportions it afterwards. Both produce `shipping.per_vendor[]`, so each parcel's
        // COD is exact either way — this only decides how the total is arrived at, and with
        // "split" the method's min/max fee applies PER PARCEL, which raises the price of a
        // multi-vendor basket. Changing it is a pricing decision, not a technical one.
        //
        // NOTE: this default only applies to a settings row that does not exist yet. An
        // existing installation keeps whatever is stored — change it in
        // Admin → Shipping → Settings.
        multi_vendor_mode: { type: String, enum: ["combined", "split"], default: "split" },
        // What to do when the customer's destination matches no zone.
        no_zone_behavior: { type: String, enum: ["free", "block", "flat"], default: "free" },
        no_zone_flat_cost: { type: Number, default: 0, min: 0 },
        default_weight_unit: { type: String, default: "kg" },
        cache_ttl_seconds: { type: Number, default: 300, min: 0 },
        // Bosta pickup scheduling
        // Off by default: booking a courier is a real-world action, so it stays opt-in
        // until an admin deliberately turns it on.
        auto_pickup_enabled: { type: Boolean, default: false },
        default_pickup_time_slot: { type: String, enum: ["10:00 to 13:00", "13:00 to 16:00"], default: "10:00 to 13:00" },
        pickup_batch_threshold: { type: Number, default: 1, min: 1 },
        pickup_cutoff_hour: { type: Number, default: 16, min: 0, max: 23 },
        pickup_skip_fridays: { type: Boolean, default: true },
        // Smart Label: vendors scan a pre-printed Bosta label instead of the admin printing
        // an AWB. Off by default for the same reason auto-pickup is — it changes what really
        // gets shipped, so it waits until the labels are physically in vendors' hands.
        smart_label_enabled: { type: Boolean, default: false },
        // The courier NEW parcels go to unless a parcel carries its own override. Parcels
        // already dispatched keep the courier stamped on their shipment.
        courier_provider: { type: String, enum: ["bosta", "arrive"], default: "bosta" },
        // How long a vendor has to carry a sub-order all the way to "ready for pickup",
        // measured from when the order is placed. Passing it only FLAGS the sub-order for
        // the admin — nothing is auto-cancelled, because a late parcel is still a parcel
        // the customer wants and writing it off is a judgement call.
        vendor_action_deadline_hours: { type: Number, default: 48, min: 1 },
        // How long before that deadline the vendor is reminded.
        vendor_deadline_reminder_hours: { type: Number, default: 12, min: 0 },

        /* ---- Bosta prepaid bundle (باقة الشحن) ----
         * A bundle carries a fixed number of parcels and dies on its expiry date WITH
         * WHATEVER IS LEFT ON IT. Both ends are therefore worth warning about, and both
         * warnings are useless if they arrive too late to act on: the cycle that ran
         * 15 Aug -> 19 Sep 2026 expired with 9 of its 20 parcels unused, 900 EGP gone.
         * Shipping also simply STOPS when a bundle runs out, so the balance warning is not
         * only about money.
         */
        bundle_low_orders_threshold: { type: Number, default: 5, min: 0 },
        bundle_low_days_threshold: { type: Number, default: 5, min: 0 },

        /* ---- How each courier settles the cash it collects ----
         * The two models are genuinely different and the money screen cannot guess which
         * one a courier is on:
         *
         *   net    the courier keeps its fees out of the COD and transfers the rest, so
         *          what we are owed is the collection MINUS those fees. Bosta works this
         *          way — and with a prepaid bundle the delivery itself is already paid, so
         *          all it still keeps is the COD collection fee.
         *   gross  the courier transfers every pound it collected and invoices its fees
         *          separately, so what we are owed is the whole collection.
         *
         * A row per courier rather than a field per courier, so adding the next one is data.
         */
        courier_cod_settlement: {
            type: [
                new mongoose.Schema(
                    {
                        provider: { type: String, required: true },
                        cod_mode: { type: String, enum: ["net", "gross"], default: "net" },
                    },
                    { _id: false }
                ),
            ],
            default: () => [
                { provider: "bosta", cod_mode: "net" },
                { provider: "arrive", cod_mode: "net" },
            ],
        },
    },
    { timestamps: true }
);

const ShippingSettings = mongoose.model("ShippingSettings", shippingSettingsSchema);

module.exports = { ShippingSettings };
