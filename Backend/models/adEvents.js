const mongoose = require("mongoose");
const { Schema } = mongoose;

/* ------------------ Ad Event ------------------
 * One row per thing a visitor did with an ad: saw it, clicked it, or acted on what it
 * led to. Kept as raw rows rather than counters on the ad so the analytics can be cut
 * any way later (by day, by placement, by device, unique viewers) without deciding
 * up front which cuts matter. Volume is bounded: an impression is recorded once per
 * viewer, ad and placement per page view, and the client batches.
 * ---------------------------------------------------------------------------- */

const AD_EVENT_TYPES = ["impression", "click", "action"];

// What the click or the follow-up did. `open` is the ad's own link; the rest happen on
// the page the ad led to, within the same visit, and are attributed to the last ad the
// viewer clicked for that subject.
const AD_ACTIONS = [
  "open",
  "view_product",
  "add_to_cart",
  "buy_now",
  "checkout",
  "order_placed",
  "visit_store",
  "whatsapp",
  "call",
  "view_service",
];

const adEventSchema = new Schema(
  {
    ad_id: { type: Schema.Types.ObjectId, ref: "AdRequest", required: true, index: true },
    vendor_id: { type: Schema.Types.ObjectId, ref: "Seller", required: true, index: true },
    ad_type: { type: String, default: "" },
    event: { type: String, enum: AD_EVENT_TYPES, required: true },
    action: { type: String, enum: [...AD_ACTIONS, ""], default: "" },
    // Where on the site the ad was shown: home_banner, services_banner, promoted_section,
    // category_top, shop_top, most_sold, new_arrivals, special_offers, home, vendors_page…
    placement: { type: String, default: "", trim: true },
    // The page path the event happened on, and what the click pointed at.
    page: { type: String, default: "", trim: true },
    target: { type: String, default: "", trim: true },
    // Anonymous, device-local id the client keeps in localStorage. Never a person, but
    // stable enough to count "how many different people" rather than "how many renders".
    viewer_id: { type: String, default: "", index: true },
    user_id: { type: Schema.Types.ObjectId, ref: "User", default: null },
    device: { type: String, enum: ["mobile", "tablet", "desktop", "unknown"], default: "unknown" },
    referrer: { type: String, default: "" },
    created_at: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

adEventSchema.index({ ad_id: 1, created_at: -1 });
adEventSchema.index({ ad_id: 1, event: 1, created_at: -1 });
adEventSchema.index({ ad_id: 1, viewer_id: 1, event: 1, placement: 1, created_at: -1 });
adEventSchema.index({ vendor_id: 1, created_at: -1 });

const AdEvent = mongoose.model("AdEvent", adEventSchema);

module.exports = { AdEvent, AD_EVENT_TYPES, AD_ACTIONS };
