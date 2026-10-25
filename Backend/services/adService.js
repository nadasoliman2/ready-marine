/**
 * Ad Service
 * ----------
 * Unified vendor ads with admin approval + scheduling. Three types:
 *   - banner            (image in the homepage banner slider)
 *   - product_visibility (boost a product into listings/sections, labeled Sponsored)
 *   - featured_vendor   (surface the vendor in the home slider / vendors directory)
 *
 * Lifecycle: pending -> approved (admin sets start/end window) -> expired
 *            pending -> rejected | cancelled
 *
 * An ad is "live" iff: status === 'approved' AND start_date <= now <= end_date.
 * Ads are resolved at READ TIME and never mutate the underlying entity.
 * Pricing is coordinated off-platform — no billing here.
 */

const { AdRequest, generateAdNumber } = require("../models/ads");
const { createNotification } = require("../models/notifications");
const { Service } = require("../models/services");
const {
  DEFAULT_BANNER_LIMIT,
  DEFAULT_SHIFT_MINUTES,
  selectBannerShift,
} = require("./bannerRotation");

const BANNER_SUBJECTS = ["product", "store", "custom", "service"];
const PRODUCT_PLACEMENTS = ["category_top", "shop_top", "promoted_section", "most_sold", "new_arrivals", "special_offers"];
const VENDOR_PLACEMENTS = ["home", "vendors_page"];
const ACTIVE_SUBSCRIPTION = ["active", "trial_active"];

const appendHistory = (doc, action, title, details = "", metadata = {}, actor = {}) => {
  doc.history.push({
    action,
    title,
    details,
    actor_role: actor.role || "system",
    actor_label: actor.label || "System",
    metadata,
    created_at: new Date(),
  });
};

const notify = (vendorId, type, title, message, data) => {
  createNotification(vendorId, type, title, message, data).catch((err) =>
    console.error(`[Ads] Notification failed (${type}): ${err.message}`)
  );
};

const isValidLink = (url) =>
  typeof url === "string" && (/^https?:\/\//i.test(url) || url.startsWith("/"));

/* ------------------------------------------------------------------ */
/*  Vendor actions                                                    */
/* ------------------------------------------------------------------ */

const createAdRequest = async (vendorId, payload = {}) => {
  const { Seller } = require("../models/sellers");
  const { Product } = require("../models/products");

  const type = ["banner", "product_visibility", "featured_vendor"].includes(payload.type) ? payload.type : "banner";
  const subject_type = BANNER_SUBJECTS.includes(payload.subject_type) ? payload.subject_type : "custom";
  const isServiceAd = type === "banner" && subject_type === "service";

  // Eligibility: only service banners are subscription-free; everything else
  // requires an active/trial subscription.
  if (!isServiceAd) {
    const vendor = await Seller.findById(vendorId).select("subscription_status").lean();
    if (!vendor || !ACTIVE_SUBSCRIPTION.includes(vendor.subscription_status)) {
      throw Object.assign(
        new Error("An active subscription is required to request this ad type. Subscribe first to add products, then advertise."),
        { code: "SUBSCRIPTION_REQUIRED" }
      );
    }
  }

  const doc = {
    ad_number: generateAdNumber(),
    vendor_id: vendorId,
    type,
    vendor_note: payload.vendor_note || "",
    status: "pending",
    history: [],
  };

  if (type === "banner") {
    if (!payload.banner_image) {
      throw Object.assign(new Error("A banner image is required"), { code: "INVALID_INPUT" });
    }
    if (!isValidLink(payload.link_url)) {
      throw Object.assign(new Error("A valid destination link is required"), { code: "INVALID_INPUT" });
    }
    doc.subject_type = subject_type;
    doc.banner_image = payload.banner_image;
    doc.link_url = payload.link_url;
    doc.product_id = payload.product_id || null;
  } else if (type === "product_visibility") {
    const placements = (payload.placements || []).filter((p) => PRODUCT_PLACEMENTS.includes(p));
    if (!payload.product_id) {
      throw Object.assign(new Error("A product is required"), { code: "INVALID_INPUT" });
    }
    if (!placements.length) {
      throw Object.assign(new Error("Select at least one placement"), { code: "INVALID_INPUT" });
    }
    const product = await Product.findById(payload.product_id).select("vendor_id status").lean();
    if (!product || product.vendor_id?.toString() !== vendorId.toString()) {
      throw Object.assign(new Error("Product not found"), { code: "NOT_FOUND" });
    }
    if (product.status !== "published") {
      throw Object.assign(new Error("Only published products can be advertised"), { code: "INVALID_INPUT" });
    }
    doc.product_id = payload.product_id;
    doc.placements = placements;
  } else if (type === "featured_vendor") {
    const vendor_placements = (payload.vendor_placements || []).filter((p) => VENDOR_PLACEMENTS.includes(p));
    if (!vendor_placements.length) {
      throw Object.assign(new Error("Select at least one placement"), { code: "INVALID_INPUT" });
    }
    doc.vendor_placements = vendor_placements;
  }

  const ad = await AdRequest.create(doc);
  appendHistory(ad, "ad_requested", "Ad requested", `Vendor submitted a ${type.replace("_", " ")} ad request.`, {}, { role: "vendor", label: "Vendor" });
  await ad.save();
  return ad;
};

const cancelAdRequest = async (vendorId, id) => {
  const ad = await AdRequest.findById(id);
  if (!ad || ad.vendor_id.toString() !== vendorId.toString()) {
    throw Object.assign(new Error("Ad request not found"), { code: "NOT_FOUND" });
  }
  if (ad.status !== "pending") {
    throw Object.assign(new Error("Only pending ad requests can be cancelled"), { code: "INVALID_STATUS" });
  }
  ad.status = "cancelled";
  ad.updated_at = new Date();
  appendHistory(ad, "ad_cancelled", "Ad cancelled", "Vendor cancelled the request.", {}, { role: "vendor", label: "Vendor" });
  await ad.save();
  return ad;
};

const listVendorAds = async (vendorId, { status, page = 1, limit = 20 } = {}) => {
  const filter = { vendor_id: vendorId };
  if (status) filter.status = status;

  const total = await AdRequest.countDocuments(filter);
  const ads = await AdRequest.find(filter)
    .sort({ created_at: -1 })
    .skip((Math.max(1, Number(page)) - 1) * Number(limit))
    .limit(Number(limit))
    .lean();
  await attachAdStats(ads);

  return { ads, pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)), limit: Number(limit) } };
};

/** Impressions / clicks / actions totals stamped on each ad row as `stats`, one query. */
const attachAdStats = async (ads) => {
  const { getAdTotals } = require("./adAnalyticsService");
  const totals = await getAdTotals(ads.map((a) => a._id));
  for (const ad of ads) ad.stats = totals[String(ad._id)] || { impressions: 0, clicks: 0, actions: 0, ctr: 0 };
  return ads;
};

/* ------------------------------------------------------------------ */
/*  Admin actions                                                     */
/* ------------------------------------------------------------------ */

const listAllAds = async ({ vendorId, status, from, to, page = 1, limit = 20 } = {}) => {
  const filter = {};
  if (status) filter.status = status;
  if (vendorId) filter.vendor_id = vendorId;
  if (from || to) {
    filter.created_at = {};
    if (from) filter.created_at.$gte = new Date(from);
    if (to) filter.created_at.$lte = new Date(to);
  }

  const total = await AdRequest.countDocuments(filter);
  const ads = await AdRequest.find(filter)
    .sort({ created_at: -1 })
    .skip((Math.max(1, Number(page)) - 1) * Number(limit))
    .limit(Number(limit))
    .populate("vendor_id", "store_name name email")
    .populate("product_id", "title_en title_ar slug_en slug_ar")
    .lean();
  await attachAdStats(ads);

  return { ads, pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)), limit: Number(limit) } };
};

const getAdById = async (id) => {
  return await AdRequest.findById(id)
    .populate("vendor_id", "store_name name email phone")
    .populate("product_id", "title_en title_ar slug_en slug_ar")
    .lean();
};

const approveAd = async (id, { start_date, end_date, adminUsername = "Admin" } = {}) => {
  const ad = await AdRequest.findById(id);
  if (!ad) throw Object.assign(new Error("Ad request not found"), { code: "NOT_FOUND" });
  if (ad.status !== "pending") {
    throw Object.assign(new Error("Only pending ad requests can be approved"), { code: "INVALID_STATUS" });
  }

  const start = new Date(start_date);
  const end = new Date(end_date);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
    throw Object.assign(new Error("A valid start/end date range is required"), { code: "INVALID_INPUT" });
  }

  ad.status = "approved";
  ad.start_date = start;
  ad.end_date = end;
  ad.admin_review = { decision: "approved", notes: "", reviewed_at: new Date(), reviewed_by: adminUsername };
  ad.updated_at = new Date();
  appendHistory(ad, "ad_approved", "Ad approved",
    `Approved by ${adminUsername}. Live ${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}.`,
    { start_date: start, end_date: end }, { role: "admin", label: adminUsername });
  await ad.save();

  notify(ad.vendor_id, "ad_approved", "Ad approved",
    `Your banner ad ${ad.ad_number} was approved and will run from ${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}.`,
    { ad_id: ad._id, start_date: start, end_date: end });
  return ad;
};

const rejectAd = async (id, { reason, adminUsername = "Admin" } = {}) => {
  const ad = await AdRequest.findById(id);
  if (!ad) throw Object.assign(new Error("Ad request not found"), { code: "NOT_FOUND" });
  if (ad.status !== "pending") {
    throw Object.assign(new Error("Only pending ad requests can be rejected"), { code: "INVALID_STATUS" });
  }

  ad.status = "rejected";
  ad.rejection_reason = reason || null;
  ad.admin_review = { decision: "rejected", notes: reason || "", reviewed_at: new Date(), reviewed_by: adminUsername };
  ad.updated_at = new Date();
  appendHistory(ad, "ad_rejected", "Ad rejected", reason || "Rejected by admin.", {}, { role: "admin", label: adminUsername });
  await ad.save();

  notify(ad.vendor_id, "ad_rejected", "Ad rejected",
    `Your banner ad ${ad.ad_number} was rejected.${reason ? ` Reason: ${reason}` : ""}`,
    { ad_id: ad._id, reason: reason || null });
  return ad;
};

const takeDownAd = async (id, { adminUsername = "Admin" } = {}) => {
  const ad = await AdRequest.findById(id);
  if (!ad) throw Object.assign(new Error("Ad request not found"), { code: "NOT_FOUND" });
  if (ad.status !== "approved") {
    throw Object.assign(new Error("Only approved ads can be taken down"), { code: "INVALID_STATUS" });
  }
  ad.status = "expired";
  ad.end_date = new Date();
  ad.updated_at = new Date();
  appendHistory(ad, "ad_taken_down", "Ad taken down", `Taken down early by ${adminUsername}.`, {}, { role: "admin", label: adminUsername });
  await ad.save();
  return ad;
};

/* ------------------------------------------------------------------ */
/*  Public + cron                                                     */
/* ------------------------------------------------------------------ */

// Base filter for a live ad of a given type.
const liveAdFilter = (type, now = new Date()) => {
  return { type, status: "approved", start_date: { $lte: now }, end_date: { $gte: now } };
};

const getActiveBanners = async (limit = 20) => {
  return await AdRequest.find(liveAdFilter("banner"))
    .sort({ start_date: -1 })
    .limit(Number(limit))
    .select("ad_number banner_image link_url start_date subject_type")
    .lean();
};

const getHomepageBannerShift = async ({ limit = DEFAULT_BANNER_LIMIT, now = new Date() } = {}) => {
  const shiftMinutes = Number.parseInt(process.env.BANNER_SHIFT_MINUTES, 10) || DEFAULT_SHIFT_MINUTES;
  const [ads, services] = await Promise.all([
    AdRequest.find(liveAdFilter("banner", now))
      .sort({ start_date: -1, _id: 1 })
      .select("banner_image link_url start_date")
      .lean(),
    Service.aggregate([
      { $match: { status: "active", show_in_banner_ad_slider: true } },
      { $sort: { created_at: -1, _id: 1 } },
      {
        $project: {
          title_en: 1,
          title_ar: 1,
          description_en: { $substrCP: [{ $ifNull: ["$description_en", ""] }, 0, 320] },
          description_ar: { $substrCP: [{ $ifNull: ["$description_ar", ""] }, 0, 320] },
          vendor_name_en: 1,
          vendor_name_ar: 1,
          vendor_location_en: 1,
          vendor_location_ar: 1,
          locations: { $slice: [{ $ifNull: ["$locations", []] }, 1] },
          slug_en: 1,
          slug_ar: 1,
          price: 1,
          created_at: 1,
          primary_image: {
            $let: {
              vars: {
                primary: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: { $ifNull: ["$images", []] },
                        as: "image",
                        cond: { $eq: ["$$image.is_primary", true] },
                      },
                    },
                    0,
                  ],
                },
              },
              in: {
                $ifNull: [
                  "$$primary",
                  { $arrayElemAt: [{ $ifNull: ["$images", []] }, 0] },
                ],
              },
            },
          },
        },
      },
    ]),
  ]);

  const adCandidates = ads
    .filter((ad) => ad.banner_image)
    .map((ad) => ({
      kind: "ad",
      id: String(ad._id),
      sortDate: new Date(ad.start_date || 0).getTime(),
      image: ad.banner_image,
      link: ad.link_url,
    }));

  const serviceCandidates = services
    .map((service) => {
      const { primary_image: primaryImage, ...serviceFields } = service;
      if (!primaryImage?.url) return null;

      return {
        kind: "service",
        id: String(service._id),
        sortDate: new Date(service.created_at || 0).getTime(),
        service: {
          ...serviceFields,
          images: [{ url: primaryImage.url, is_primary: true }],
        },
      };
    })
    .filter(Boolean);

  const candidates = [...adCandidates, ...serviceCandidates].sort((left, right) => {
    if (right.sortDate !== left.sortDate) return right.sortDate - left.sortDate;
    return `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`);
  });

  const rotation = selectBannerShift(candidates, {
    limit,
    now,
    shiftMinutes,
  });

  return {
    ...rotation,
    slides: rotation.slides.map(({ sortDate, ...slide }) => slide),
  };
};

/**
 * Active product-visibility ads for a given placement, newest-first.
 * Returns [{ product_id, ad_number }] — productService joins to the products.
 * For 'category_top', optionally restrict to ads whose product falls within a
 * set of category ids (the viewed category subtree).
 */
const getActiveProductAds = async ({ placement, categoryIds = null, limit = 24 } = {}) => {
  if (!PRODUCT_PLACEMENTS.includes(placement)) return [];
  const filter = { ...liveAdFilter("product_visibility"), placements: placement };
  let ads = await AdRequest.find(filter)
    .sort({ start_date: -1 })
    .select("product_id ad_number")
    .lean();

  if (placement === "category_top" && Array.isArray(categoryIds) && categoryIds.length) {
    const { Product } = require("../models/products");
    const idSet = new Set(categoryIds.map(String));
    const productIds = ads.map((a) => a.product_id).filter(Boolean);
    const prods = await Product.find({ _id: { $in: productIds } }).select("category_id").lean();
    const inScope = new Set(prods.filter((p) => idSet.has(String(p.category_id))).map((p) => String(p._id)));
    ads = ads.filter((a) => inScope.has(String(a.product_id)));
  }

  return ads.slice(0, Number(limit));
};

/**
 * Live featured_vendor ads for a placement ('home'|'vendors_page'), newest-first, one per
 * vendor: `[{ vendor_id, ad_id, ad_number }]`. The ad id rides along so the screen that
 * shows the vendor can report the ad's impressions and clicks.
 */
const getActiveFeaturedVendorAds = async (placement) => {
  if (!VENDOR_PLACEMENTS.includes(placement)) return [];
  const ads = await AdRequest.find({ ...liveAdFilter("featured_vendor"), vendor_placements: placement })
    .sort({ start_date: -1 })
    .select("vendor_id ad_number")
    .lean();
  // De-dupe while preserving newest-first order.
  const seen = new Set();
  const out = [];
  for (const a of ads) {
    const id = String(a.vendor_id);
    if (!seen.has(id)) { seen.add(id); out.push({ vendor_id: a.vendor_id, ad_id: a._id, ad_number: a.ad_number }); }
  }
  return out;
};

/** Vendor ids only — see getActiveFeaturedVendorAds. */
const getActiveFeaturedVendorIds = async (placement) =>
  (await getActiveFeaturedVendorAds(placement)).map((a) => a.vendor_id);

const expireOldAds = async () => {
  const now = new Date();
  const result = await AdRequest.updateMany(
    { status: "approved", end_date: { $lt: now } },
    { $set: { status: "expired", updated_at: now } }
  );
  const count = result.modifiedCount ?? result.nModified ?? 0;
  console.log(`[Ads] Expired ${count} ended ad(s).`);
  return { expired: count };
};

module.exports = {
  getActiveFeaturedVendorAds,
  createAdRequest,
  cancelAdRequest,
  listVendorAds,
  listAllAds,
  getAdById,
  approveAd,
  rejectAd,
  takeDownAd,
  getActiveBanners,
  getHomepageBannerShift,
  getActiveProductAds,
  getActiveFeaturedVendorIds,
  expireOldAds,
};
