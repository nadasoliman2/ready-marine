const mongoose = require("mongoose");
const crypto = require("crypto");
const { Schema } = mongoose;

/* ------------------ Ad History ------------------ */
const adHistorySchema = new Schema(
  {
    action: { type: String, required: true },
    title: { type: String, required: true },
    details: { type: String },
    actor_role: { type: String, default: "system" },
    actor_label: { type: String, default: "System" },
    metadata: { type: Schema.Types.Mixed },
    created_at: { type: Date, default: Date.now },
  },
  { _id: true }
);

/* ------------------ Ad Request Schema ------------------
 * A vendor-submitted ad. Three types share one lifecycle: on admin approval
 * the admin sets the live window (start_date / end_date); an ad is "live" only
 * while status === 'approved' AND start_date <= now <= end_date. Ads are
 * resolved at READ TIME and never mutate the underlying product/vendor.
 * Pricing is coordinated off-platform — no billing is handled here.
 * ------------------------------------------------------------------------ */
const isBanner = function () { return this.type === "banner"; };

const adRequestSchema = new Schema(
  {
    ad_number: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    vendor_id: {
      type: Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
      index: true,
    },

    // Ad type discriminator.
    type: {
      type: String,
      enum: ["banner", "product_visibility", "featured_vendor"],
      default: "banner",
      index: true,
    },

    /* ---- Banner fields ---- */
    // What the banner promotes. 'service' banners are subscription-free.
    subject_type: {
      type: String,
      enum: ["product", "store", "custom", "service"],
      default: "custom",
    },
    banner_image: { type: String, required: isBanner }, // uploaded image URL
    link_url: { type: String, required: isBanner },      // click destination (admin-validated)

    /* ---- Shared / product-visibility ---- */
    product_id: { type: Schema.Types.ObjectId, ref: "Product", default: null },
    // Where a product-visibility ad surfaces (vendor picks one or more).
    placements: {
      type: [String],
      enum: ["category_top", "shop_top", "promoted_section", "most_sold", "new_arrivals", "special_offers"],
      default: undefined,
    },

    /* ---- Featured-vendor fields ---- */
    vendor_placements: {
      type: [String],
      enum: ["home", "vendors_page"],
      default: undefined,
    },

    vendor_note: { type: String, default: "" },       // off-platform coordination note

    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled", "expired"],
      default: "pending",
      index: true,
    },

    // Live window — set by admin at approval.
    start_date: { type: Date, default: null },
    end_date: { type: Date, default: null },

    admin_review: {
      decision: { type: String, enum: ["approved", "rejected"], default: null },
      notes: { type: String, default: "" },
      reviewed_at: { type: Date, default: null },
      reviewed_by: { type: String, default: null },
    },

    rejection_reason: { type: String, default: null },

    history: [adHistorySchema],

    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

/* ------------------ Indexes ------------------ */
adRequestSchema.index({ vendor_id: 1, status: 1 });
adRequestSchema.index({ status: 1, type: 1, start_date: 1, end_date: 1 }); // read-time live-ad queries
adRequestSchema.index({ status: 1, created_at: -1 });

/* ------------------ Helpers ------------------ */
const generateAdNumber = () => {
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `AD-${rand}`;
};

const AdRequest = mongoose.model("AdRequest", adRequestSchema);

module.exports = { AdRequest, generateAdNumber };
