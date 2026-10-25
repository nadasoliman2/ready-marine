const mongoose = require("mongoose");
const { AdEvent, AD_EVENT_TYPES, AD_ACTIONS } = require("../models/adEvents");
const { AdRequest } = require("../models/ads");

const MAX_BATCH = 50;
const MAX_TEXT = 300;
// The same viewer seeing the same ad in the same slot again within this window is the
// page re-rendering, not a second person looking — it is not counted twice.
const IMPRESSION_DEDUPE_MS = 60 * 1000;

const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));
const clip = (v) => String(v ?? "").trim().slice(0, MAX_TEXT);

const deviceFromUserAgent = (ua = "") => {
  const s = String(ua).toLowerCase();
  if (!s) return "unknown";
  if (/ipad|tablet|kindle|silk|playbook/.test(s)) return "tablet";
  if (/mobi|iphone|android|ipod|opera mini|blackberry|windows phone/.test(s)) return "mobile";
  return "desktop";
};

/**
 * Store a batch of events sent by one browser. Bad rows are dropped quietly rather than
 * failing the batch: this is telemetry, and a broken row must never surface as an error
 * on a page that was otherwise working.
 */
const recordEvents = async (rawEvents, { viewerId = "", userId = null, userAgent = "", referrer = "" } = {}) => {
  const rows = (Array.isArray(rawEvents) ? rawEvents : []).slice(0, MAX_BATCH);
  const viewer = clip(viewerId).slice(0, 64);
  const device = deviceFromUserAgent(userAgent);

  const adIds = [...new Set(rows.map((r) => String(r?.ad_id || "")).filter(isValidId))];
  if (!adIds.length) return { recorded: 0 };
  const ads = await AdRequest.find({ _id: { $in: adIds } }).select("vendor_id type status").lean();
  const adById = new Map(ads.map((a) => [String(a._id), a]));

  const docs = [];
  const seenInBatch = new Set();
  for (const r of rows) {
    const ad = adById.get(String(r?.ad_id || ""));
    if (!ad) continue;
    const event = AD_EVENT_TYPES.includes(r?.event) ? r.event : null;
    if (!event) continue;
    const action = AD_ACTIONS.includes(r?.action) ? r.action : (event === "click" ? "open" : "");
    if (event === "action" && !action) continue;
    const placement = clip(r?.placement).slice(0, 60);

    if (event === "impression") {
      const key = `${ad._id}|${placement}`;
      if (seenInBatch.has(key)) continue;
      seenInBatch.add(key);
    }

    docs.push({
      ad_id: ad._id,
      vendor_id: ad.vendor_id,
      ad_type: ad.type || "",
      event,
      action,
      placement,
      page: clip(r?.page),
      target: clip(r?.target),
      viewer_id: viewer,
      user_id: userId || null,
      device,
      referrer: clip(referrer),
      created_at: new Date(),
    });
  }
  if (!docs.length) return { recorded: 0 };

  // Drop impressions this viewer already produced for the same ad and slot moments ago.
  if (viewer) {
    const impressions = docs.filter((d) => d.event === "impression");
    if (impressions.length) {
      const since = new Date(Date.now() - IMPRESSION_DEDUPE_MS);
      const recent = await AdEvent.find({
        viewer_id: viewer,
        event: "impression",
        ad_id: { $in: impressions.map((d) => d.ad_id) },
        created_at: { $gte: since },
      }).select("ad_id placement").lean();
      const recentKeys = new Set(recent.map((e) => `${e.ad_id}|${e.placement}`));
      for (let i = docs.length - 1; i >= 0; i -= 1) {
        const d = docs[i];
        if (d.event === "impression" && recentKeys.has(`${d.ad_id}|${d.placement}`)) docs.splice(i, 1);
      }
    }
  }
  if (!docs.length) return { recorded: 0 };

  await AdEvent.insertMany(docs, { ordered: false });
  return { recorded: docs.length };
};

const dayKey = { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } };

/**
 * Everything the ad did over a period, in one read.
 *
 * `from` / `to` are ISO dates; the default is the ad's whole life. Every figure comes
 * straight from the event rows, so the numbers on the admin screen and the vendor screen
 * are the same numbers.
 */
const getAdAnalytics = async (adId, { from, to } = {}) => {
  if (!isValidId(adId)) return null;
  const ad = await AdRequest.findById(adId).select("ad_number type status start_date end_date vendor_id product_id subject_type link_url placements vendor_placements created_at").lean();
  if (!ad) return null;

  const range = {};
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  if (fromDate && !Number.isNaN(fromDate.getTime())) range.$gte = fromDate;
  if (toDate && !Number.isNaN(toDate.getTime())) {
    // An inclusive "to" day: anything before the next midnight counts.
    const end = new Date(toDate);
    end.setHours(23, 59, 59, 999);
    range.$lte = end;
  }
  const match = { ad_id: ad._id, ...(Object.keys(range).length ? { created_at: range } : {}) };

  const [totals, uniques, byDay, byPlacement, byAction, byDevice, byPage, byAudience, last] = await Promise.all([
    AdEvent.aggregate([{ $match: match }, { $group: { _id: "$event", n: { $sum: 1 } } }]),
    AdEvent.aggregate([
      { $match: { ...match, viewer_id: { $ne: "" } } },
      { $group: { _id: { event: "$event", viewer: "$viewer_id" } } },
      { $group: { _id: "$_id.event", n: { $sum: 1 } } },
    ]),
    AdEvent.aggregate([
      { $match: match },
      { $group: { _id: { day: dayKey, event: "$event" }, n: { $sum: 1 } } },
      { $sort: { "_id.day": 1 } },
    ]),
    AdEvent.aggregate([
      { $match: match },
      { $group: { _id: { placement: "$placement", event: "$event" }, n: { $sum: 1 } } },
    ]),
    AdEvent.aggregate([
      { $match: { ...match, event: { $in: ["click", "action"] } } },
      { $group: { _id: "$action", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]),
    AdEvent.aggregate([
      { $match: match },
      { $group: { _id: { device: "$device", event: "$event" }, n: { $sum: 1 } } },
    ]),
    AdEvent.aggregate([
      { $match: { ...match, event: "impression" } },
      { $group: { _id: "$page", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 10 },
    ]),
    AdEvent.aggregate([
      { $match: match },
      { $group: { _id: { signed_in: { $cond: [{ $ifNull: ["$user_id", false] }, true, false] }, event: "$event" }, n: { $sum: 1 } } },
    ]),
    AdEvent.findOne(match).sort({ created_at: -1 }).select("created_at event action").lean(),
  ]);

  const count = (rows, key) => rows.find((r) => r._id === key)?.n || 0;
  const impressions = count(totals, "impression");
  const clicks = count(totals, "click");
  const actions = count(totals, "action");
  const uniqueViewers = count(uniques, "impression");
  const uniqueClickers = count(uniques, "click");

  const days = {};
  for (const r of byDay) {
    const d = (days[r._id.day] ||= { day: r._id.day, impressions: 0, clicks: 0, actions: 0 });
    d[`${r._id.event}s`] = r.n;
  }

  const placements = {};
  for (const r of byPlacement) {
    const p = (placements[r._id.placement || "unknown"] ||= { placement: r._id.placement || "unknown", impressions: 0, clicks: 0, actions: 0 });
    p[`${r._id.event}s`] = r.n;
  }
  const placementRows = Object.values(placements).map((p) => ({ ...p, ctr: p.impressions ? Number(((p.clicks / p.impressions) * 100).toFixed(2)) : 0 }));

  const devices = {};
  for (const r of byDevice) {
    const d = (devices[r._id.device] ||= { device: r._id.device, impressions: 0, clicks: 0, actions: 0 });
    d[`${r._id.event}s`] = r.n;
  }

  const audience = { signed_in: { impressions: 0, clicks: 0, actions: 0 }, guest: { impressions: 0, clicks: 0, actions: 0 } };
  for (const r of byAudience) {
    audience[r._id.signed_in ? "signed_in" : "guest"][`${r._id.event}s`] = r.n;
  }

  return {
    ad: {
      _id: ad._id,
      ad_number: ad.ad_number,
      type: ad.type,
      status: ad.status,
      start_date: ad.start_date,
      end_date: ad.end_date,
      subject_type: ad.subject_type,
      link_url: ad.link_url,
      placements: ad.placements || ad.vendor_placements || [],
    },
    range: { from: range.$gte || null, to: range.$lte || null },
    totals: {
      impressions,
      unique_viewers: uniqueViewers,
      clicks,
      unique_clickers: uniqueClickers,
      ctr: impressions ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
      actions,
      // How many of the people who saw it did anything at all.
      engagement_rate: uniqueViewers ? Number((((uniqueClickers) / uniqueViewers) * 100).toFixed(2)) : 0,
      last_event_at: last?.created_at || null,
    },
    by_day: Object.values(days),
    by_placement: placementRows.sort((a, b) => b.impressions - a.impressions),
    by_action: byAction.map((r) => ({ action: r._id || "open", count: r.n })),
    by_device: Object.values(devices),
    by_page: byPage.map((r) => ({ page: r._id || "", impressions: r.n })),
    audience,
  };
};

/** Totals for many ads at once — for the list screens, one query for the page. */
const getAdTotals = async (adIds = []) => {
  const ids = adIds.filter(isValidId).map((id) => new mongoose.Types.ObjectId(String(id)));
  if (!ids.length) return {};
  const rows = await AdEvent.aggregate([
    { $match: { ad_id: { $in: ids } } },
    { $group: { _id: { ad: "$ad_id", event: "$event" }, n: { $sum: 1 } } },
  ]);
  const out = {};
  for (const r of rows) {
    const o = (out[String(r._id.ad)] ||= { impressions: 0, clicks: 0, actions: 0 });
    o[`${r._id.event}s`] = r.n;
  }
  for (const o of Object.values(out)) o.ctr = o.impressions ? Number(((o.clicks / o.impressions) * 100).toFixed(2)) : 0;
  return out;
};

module.exports = { recordEvents, getAdAnalytics, getAdTotals };
