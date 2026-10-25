const mongoose = require("mongoose");
const { Schema } = mongoose;

/* ------------------ Ad Spend Schema ------------------
 * What WE spent on marketing — not to be confused with `ads.js`, which is a vendor
 * asking us to run a banner and is revenue rather than cost.
 *
 * Stored as a dated ledger rather than a number typed into the profit page, because a
 * profit figure that cannot be reproduced next month is not a profit figure. A report
 * for any period picks up every entry that OVERLAPS it, apportioned by day — a campaign
 * running 1 Jan to 31 Jan contributes ten days of its spend to a report covering the
 * first ten days of January.
 * ------------------------------------------------------------------------ */

const AD_CHANNELS = ["facebook", "instagram", "google", "tiktok", "snapchat", "influencer", "offline", "other"];

const adSpendHistorySchema = new Schema(
    {
        action: { type: String, required: true },
        title: { type: String, required: true },
        details: { type: String },
        actor_role: { type: String, default: "admin" },
        actor_label: { type: String, default: "Admin" },
        metadata: { type: Schema.Types.Mixed },
        created_at: { type: Date, default: Date.now },
    },
    { _id: true }
);

const adSpendSchema = new Schema(
    {
        channel: { type: String, enum: AD_CHANNELS, default: "other", index: true },

        // Free-text campaign name, so two Facebook campaigns in the same month stay tellable apart.
        campaign: { type: String, default: "", trim: true },

        amount: { type: Number, required: true, min: 0 },
        currency: { type: String, default: "EGP" },

        /* ---- The window the money bought ----
         * A single-day spend sets both to the same date. `end_date` is INCLUSIVE — a
         * campaign that ran on the 1st and the 2nd covers two days, not one.
         */
        start_date: { type: Date, required: true, index: true },
        end_date: { type: Date, required: true, index: true },

        notes: { type: String, default: "" },

        created_by_label: { type: String, default: "Admin" },

        history: { type: [adSpendHistorySchema], default: [] },

        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

/* ------------------ Indexes ------------------ */
// Every read is "what overlaps this period?", which is (start <= to && end >= from).
adSpendSchema.index({ start_date: 1, end_date: 1 });
adSpendSchema.index({ channel: 1, start_date: -1 });

/* ------------------ Validation ------------------ */
adSpendSchema.pre("validate", function (next) {
    if (this.start_date && this.end_date && this.end_date < this.start_date) {
        this.invalidate("end_date", "The end date cannot be before the start date.");
    }
    // Mongoose 9 invokes pre-validate hooks without a callback, so `next` is undefined
    // here. Guarded the same way as every other pre-validate hook in this codebase.
    if (typeof next === "function") next();
});

/**
 * The share of this entry's spend that falls inside [from, to].
 *
 * Apportioned by whole days rather than charged to whichever month the campaign started
 * in: a campaign spanning a month boundary genuinely bought traffic on both sides of it,
 * and a report that put all of it on one side would misstate both months.
 */
adSpendSchema.methods.amountWithin = function (from, to) {
    const dayMs = 24 * 60 * 60 * 1000;
    const startOfDay = (d) => {
        const x = new Date(d);
        x.setHours(0, 0, 0, 0);
        return x;
    };

    const spendStart = startOfDay(this.start_date);
    const spendEnd = startOfDay(this.end_date);
    const totalDays = Math.round((spendEnd - spendStart) / dayMs) + 1;
    if (totalDays <= 0) return 0;

    const windowStart = from ? startOfDay(from) : spendStart;
    const windowEnd = to ? startOfDay(to) : spendEnd;

    const overlapStart = spendStart > windowStart ? spendStart : windowStart;
    const overlapEnd = spendEnd < windowEnd ? spendEnd : windowEnd;
    const overlapDays = Math.round((overlapEnd - overlapStart) / dayMs) + 1;
    if (overlapDays <= 0) return 0;

    return Number(((this.amount * Math.min(overlapDays, totalDays)) / totalDays).toFixed(2));
};

const AdSpend = mongoose.model("AdSpend", adSpendSchema);

module.exports = { AdSpend, AD_CHANNELS };
