const https = require("https");
const { BOSTA_CODE_TO_VALUE } = require("./bostaStatusMap");

const BOSTA_BASE_URL = process.env.BOSTA_BASE_URL || "https://app.bosta.co";
const BOSTA_API_KEY = process.env.BOSTA_API_KEY || "";
const BOSTA_WEBHOOK_URL = process.env.BOSTA_WEBHOOK_URL || "";

// Bosta requires webhook URLs to be proper domain names (no IPs, must have TLD)
const BOSTA_URL_PATTERN = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_+.~#?&//=]*)/;
const isValidBostaWebhookUrl = (url) => url && BOSTA_URL_PATTERN.test(url);

/**
 * Generic HTTPS JSON request to Bosta API.
 */
function requestJson({ method = "GET", path, body, timeoutMs = 15000 }) {
  if (!BOSTA_API_KEY) throw new Error("BOSTA_API_KEY is not configured");

  const url = new URL(`${BOSTA_BASE_URL}${path}`);
  const payload = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: BOSTA_API_KEY,
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          let parsed = {};
          if (data) {
            try { parsed = JSON.parse(data); } catch (_) { parsed = { message: data }; }
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
            return;
          }

          const message = parsed?.message || parsed?.error || `Bosta API error (${res.statusCode})`;
          const err = new Error(typeof message === "string" ? message : JSON.stringify(message));
          err.statusCode = res.statusCode;
          err.providerResponse = parsed;
          reject(err);
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("Bosta API timeout")); });
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * True when an error is worth retrying: network failures, timeouts, and 5xx.
 * A 4xx means Bosta understood us and said no (bad address, COD limit, duplicate
 * reference, ...) — replaying it just burns 3x the latency and, for POSTs, risks
 * creating a second delivery. 429 is the one 4xx that is genuinely transient.
 */
function isRetryable(err) {
  const status = err?.statusCode;
  if (status == null) return true; // socket error / timeout — no response at all
  if (status === 429) return true;
  return status >= 500;
}

/**
 * Retry wrapper with exponential backoff. Only retries transient failures.
 */
async function withRetry(fn, retries = 3) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err)) throw err;
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
  }
  throw lastErr;
}

// Bosta's address schema is { city, firstLine, zoneId?, districtId?, ... }. It has no
// `zone` / `district` name fields — anything sent under those names is silently dropped,
// so we only forward what Bosta actually reads.
// Two different Bosta rules, verified against the API:
//   pickup locations accept 5 characters or more;
//   delivery addresses need MORE than 5 (i.e. 6+).
// Exported so vendor validation can hold addresses to the stricter of the two — otherwise
// a 5-character branch passes signup and then fails at dispatch time.
const MIN_PICKUP_LOCATION_FIRST_LINE = 5;
const MIN_FIRST_LINE = 6;

function buildAddress(addr, label) {
  const firstLine = (addr.firstLine || addr.address || "").trim();
  const city = (addr.city || "").trim();
  if (!city && !addr.zoneId && !addr.districtId) {
    throw new Error(`Bosta ${label}: city, zoneId, or districtId is required`);
  }
  if (firstLine.length < MIN_FIRST_LINE) {
    throw new Error(
      `Bosta ${label}: street address must be longer than 5 characters (got "${firstLine}")`
    );
  }
  const out = { firstLine, city };
  for (const k of ["zoneId", "districtId", "secondLine", "buildingNumber", "floor", "apartment"]) {
    if (addr[k]) out[k] = addr[k];
  }
  return out;
}

/**
 * Create a delivery on Bosta.
 *
 * Which address goes where depends on the order type (see Bosta's "Create Your First
 * Delivery" guide) — the caller decides:
 *   type 10 (Deliver): dropOffAddress = customer, businessLocationId = vendor pickup point.
 *   type 25 (CRP):     pickupAddress  = customer, businessLocationId = where it returns to.
 * Sending a CRP without a pickupAddress makes Bosta 500.
 *
 * @returns {{ deliveryId: string, trackingNumber: string }}
 */
async function createDelivery({
  pickupAddress,
  dropOffAddress,
  returnAddress,
  businessLocationId,
  receiver,
  cod = 0,
  businessReference,
  uniqueBusinessReference,
  notes = "",
  returnNotes,
  specs,
  returnSpecs,
  trackingNumber,
  type = 10, // 10 = SEND, 25 = Customer Return Pickup (CRP)
}) {
  const isCRP = type === 25;

  const body = {
    type,
    receiver: {
      firstName: receiver?.firstName || "",
      lastName: receiver?.lastName || "",
      phone: receiver?.phone || "",
    },
    cod,
    businessReference,
    notes,
  };

  if (dropOffAddress) body.dropOffAddress = buildAddress(dropOffAddress, "dropOffAddress");
  if (pickupAddress) body.pickupAddress = buildAddress(pickupAddress, "pickupAddress");
  if (returnAddress) body.returnAddress = buildAddress(returnAddress, "returnAddress");

  if (isCRP && !body.pickupAddress) {
    throw new Error("Bosta CRP (type 25) requires pickupAddress (the customer's address)");
  }
  if (!isCRP && !body.dropOffAddress) {
    throw new Error(`Bosta type ${type} requires dropOffAddress`);
  }

  // Ties the shipment to a registered pickup location so the parcel is collected from
  // (or returned to) the right vendor branch. Without it Bosta uses the account default.
  if (businessLocationId) body.businessLocationId = businessLocationId;

  // Bosta rejects a duplicate uniqueBusinessReference, which makes a retried POST safe:
  // if the first attempt actually landed, the replay is refused instead of creating a
  // second shipment the business would be billed for.
  if (uniqueBusinessReference) body.uniqueBusinessReference = uniqueBusinessReference;

  // Smart Label: the parcel already carries a Bosta label bought from Bosta, so the
  // delivery is created *with* that number instead of letting Bosta mint a new one — which
  // is what removes the print-and-stick step. Bosta stores it, returns it on GET and search,
  // and refuses a number already in use ("This trackingNumber is already in use"), so it
  // stays the authority on duplicates.
  if (trackingNumber) body.trackingNumber = trackingNumber;

  if (specs) body.specs = specs;
  if (returnSpecs) body.returnSpecs = returnSpecs;
  if (returnNotes) body.returnNotes = returnNotes;

  if (isValidBostaWebhookUrl(BOSTA_WEBHOOK_URL)) {
    body.webhookUrl = BOSTA_WEBHOOK_URL;
  }

  const data = await withRetry(() => requestJson({ method: "POST", path: "/api/v0/deliveries", body }));

  return {
    deliveryId: data._id || data.deliveryId || data.data?._id,
    trackingNumber: data.trackingNumber || data.data?.trackingNumber,
  };
}

/**
 * Track a delivery by tracking number or delivery id.
 *
 * The timeline lives under `timeline` — an ordered list of milestones where the ones
 * already reached carry `done: true` and a `date`. (Bosta has no `trackingHistory` /
 * `transitEvents` field; reading those always yielded an empty list.)
 *
 * Also carries `expectedCashoutDate` — the day Bosta says it will transfer THIS parcel's
 * collected cash. It is the only place the courier tells us when our money is coming, and
 * the finance screen reports the COD held per courier off it.
 *
 * @returns {{ state: string, currentStatus: string, trackingHistory: Array, expectedCashoutDate: string|null }}
 */
async function trackDelivery(trackingNumber) {
  const data = await withRetry(() =>
    requestJson({ method: "GET", path: `/api/v0/deliveries/${trackingNumber}` })
  );
  const delivery = data?.data || data;

  // state is { value, code } on the detail endpoint but can arrive as a bare string or,
  // on list endpoints, as an object with only a code — resolve all three to a name.
  let state = delivery.state?.value || delivery.status;
  if (!state && typeof delivery.state === "string") state = delivery.state;
  if (!state && delivery.state?.code != null) {
    state = BOSTA_CODE_TO_VALUE[delivery.state.code] || null;
  }

  const trackingHistory = (Array.isArray(delivery.timeline) ? delivery.timeline : [])
    .filter((e) => e.done && (e.date || e.timestamp))
    .map((e) => ({
      state: BOSTA_CODE_TO_VALUE[e.code] || e.value || String(e.code),
      timestamp: e.date || e.timestamp,
      notes: "",
    }));

  return {
    state,
    currentStatus: state,
    trackingHistory,
    expectedCashoutDate: delivery.cashoutInfo?.expectedCashoutDate || null,
  };
}

/** Bosta's full record of one delivery, as it holds it now. */
async function getDelivery(trackingNumber) {
  const data = await withRetry(() => requestJson({ method: "GET", path: `/api/v0/deliveries/${trackingNumber}` }));
  return data?.data || data;
}

/**
 * Change what Bosta holds on a delivery that already exists.
 *
 * Same body shape as creation, sent partially: only the keys present are changed. Used to
 * put the parcel description on deliveries created before the description was sent.
 * Bosta refuses the update once the parcel is past pickup, and that refusal is the
 * caller's to report — it is Bosta's answer, not a transport failure.
 */
async function updateDelivery(deliveryId, payload) {
  return withRetry(() => requestJson({ method: "PUT", path: `/api/v0/deliveries/${deliveryId}`, body: payload }));
}

/**
 * Terminate (cancel) a delivery.
 */
async function terminateDelivery(deliveryId) {
  await withRetry(() => requestJson({ method: "DELETE", path: `/api/v0/deliveries/${deliveryId}` }));
}

/**
 * Link a Smart Sticker's barcode to a delivery that already exists.
 *
 * This is how Bosta wants pre-printed stickers handled since September 2026 (their
 * support, 16 Sep): the delivery is created normally and Bosta mints the tracking number,
 * then the sticker's barcode is attached to it. Sending the sticker number AS the tracking
 * number — which worked until the end of August — is now refused by a 7–10 digit rule.
 *
 * `apply: false` only validates (the barcode exists and is not linked to anything yet);
 * `apply: true` performs the link. Both answer `{ success, message }`, with
 * `errorCode` 4142 for an unknown barcode and 4144 for one already linked.
 */
async function linkBarcode({ barcode, trackingNumber, apply = true }) {
  let data;
  try {
    data = await withRetry(() =>
      requestJson({
        method: "PUT",
        path: "/api/v2/barcode/link",
        body: { apply, barcode: String(barcode), trackingNumber: String(trackingNumber), entryMethod: "SCANNER" },
      })
    );
  } catch (err) {
    // A 4xx is Bosta's answer about the sticker, not a transport failure. Callers tell
    // the two apart by `bostaCode`: set only when Bosta actually replied.
    if (err.statusCode && err.statusCode < 500) {
      err.bostaCode = err.providerResponse?.errorCode || err.statusCode;
    }
    throw err;
  }
  if (data && data.success === false) {
    const err = new Error(data.message || "Bosta refused the barcode");
    err.bostaCode = data.errorCode || true;
    throw err;
  }
  return data;
}

/**
 * Fetch the AWB (airway bill) for a delivery.
 *
 * Bosta returns the PDF itself, base64-encoded, under `data` — not a URL. Callers get
 * the raw bytes so they can stream them to the browser.
 * @returns {Buffer} the AWB PDF
 */
async function printAWB(deliveryId) {
  const data = await withRetry(() =>
    requestJson({ method: "GET", path: `/api/v0/deliveries/awb/${deliveryId}` })
  );

  const b64 = typeof data === "string" ? data : data?.data;
  if (typeof b64 !== "string" || !b64) {
    // Over 50 AWBs at once Bosta emails a zip instead of answering inline; for a single
    // delivery an empty body means it simply isn't printable (CRP / finished orders).
    throw new Error(data?.message || "Bosta did not return an AWB for this shipment");
  }
  return Buffer.from(b64, "base64");
}

/* ======================== Pickup Location CRUD (v2) ======================== */

/**
 * List all pickup locations on Bosta.
 */
async function listPickupLocations() {
  const data = await withRetry(() =>
    requestJson({ method: "GET", path: "/api/v2/pickup-locations" })
  );
  return data?.data?.list || data?.data || data || [];
}

/**
 * Create a pickup location on Bosta.
 * @returns {{ locationId: string }}
 */
async function createPickupLocation({ locationName, contacts, address }) {
  const data = await withRetry(() =>
    requestJson({
      method: "POST",
      path: "/api/v2/pickup-locations",
      body: {
        locationName,
        contacts: contacts || [],
        address: {
          city: address?.city || "",
          firstLine: address?.firstLine || "",
          secondLine: address?.secondLine || "",
          floor: address?.floor || "",
          apartment: address?.apartment || "",
          buildingNumber: address?.buildingNumber || "",
        },
      },
    })
  );
  return { locationId: data?.data?.pickupId || data?.data?._id || data?._id || data?.pickupId };
}

/**
 * Update a pickup location on Bosta.
 */
async function updatePickupLocation(locationId, { locationName, contacts, address }) {
  await withRetry(() =>
    requestJson({
      method: "PUT",
      path: `/api/v2/pickup-locations/${locationId}`,
      body: {
        locationName,
        contacts: contacts || [],
        address: {
          city: address?.city || "",
          firstLine: address?.firstLine || "",
          secondLine: address?.secondLine || "",
          floor: address?.floor || "",
          apartment: address?.apartment || "",
          buildingNumber: address?.buildingNumber || "",
          // Kept when a location has one, so an update does not drop a district someone
          // set on Bosta's side. Never the zone: Bosta refuses an update that names it.
          ...(address?.districtId ? { districtId: address.districtId } : {}),
        },
      },
    })
  );
}

/**
 * Delete a pickup location on Bosta.
 */
async function deletePickupLocation(locationId) {
  await withRetry(() =>
    requestJson({ method: "DELETE", path: `/api/v2/pickup-locations/${locationId}` })
  );
}

/**
 * The name a vendor branch carries on Bosta: the store first, then the address. The
 * address alone was the name before, and nobody searching Bosta's dashboard for a store
 * found it — one admin created a second location for the same branch by hand instead.
 */
function pickupLocationName(vendorLocation, vendorContact) {
  const address = (vendorLocation?.address || "").trim();
  const store = (vendorContact?.store_name || "").trim();
  if (!store) return address || "Vendor Location";
  return address ? `${store} — ${address}` : store;
}

/**
 * Ensure a vendor location exists on Bosta.
 * If it already has a bosta_location_id, update it. Otherwise create it.
 * `vendorContact` is { name, phone, store_name }.
 * @returns {string} bosta_location_id
 */
async function ensurePickupLocation(vendorLocation, vendorContact) {
  const locationName = pickupLocationName(vendorLocation, vendorContact);
  const fullName = (vendorContact?.name || "Vendor").trim().split(/\s+/);
  const contacts = [{
    firstName: fullName[0] || "Vendor",
    lastName: fullName.slice(1).join(" ") || "Store",
    phone: vendorContact?.phone || "00000000000",
    isDefault: true,
  }];
  const address = {
    city: vendorLocation.shipping_city || "",
    firstLine: vendorLocation.address || "",
  };

  if (vendorLocation.bosta_location_id) {
    // A failed update must not block the vendor's own save, but it does mean Bosta still
    // holds the old address — log it loudly rather than losing it.
    try {
      await updatePickupLocation(vendorLocation.bosta_location_id, { locationName, contacts, address });
    } catch (err) {
      console.error(
        `[Bosta] Failed to sync pickup location ${vendorLocation.bosta_location_id} ("${locationName}"): ${err.message}`
      );
    }
    return vendorLocation.bosta_location_id;
  }

  // Create new
  const result = await createPickupLocation({ locationName, contacts, address });
  return result.locationId;
}

/* ======================== Pickup Scheduling ======================== */

/**
 * Create a pickup request.
 * @returns {{ pickupId: string }}
 */
async function createPickup({ businessLocationId, scheduledDate, scheduledTimeSlot, contactPerson, noOfPackages, notes, packageType }) {
  const body = {
    businessLocationId,
    scheduledDate,
    scheduledTimeSlot,
    contactPerson: {
      name: contactPerson?.name || "",
      phone: contactPerson?.phone || "",
      email: contactPerson?.email || "",
    },
  };
  if (noOfPackages) body.noOfPackages = noOfPackages;
  if (notes) body.notes = notes;
  if (packageType && packageType !== "Normal") body.packageType = packageType;

  const data = await withRetry(() =>
    requestJson({ method: "POST", path: "/api/v0/pickups", body })
  );
  return { pickupId: data?.message?._id || data?._id || data?.data?._id || data?.pickupId };
}

/**
 * Bosta pickup state (a name, e.g. "Requested") → our BostaPickup.status enum.
 * Unknown states return null so a state we haven't seen can't corrupt the record.
 */
function mapBostaPickupState(state) {
  if (!state || typeof state !== "string") return null;
  switch (state.trim().toLowerCase()) {
    case "requested":
    case "route assigned":
    case "rescheduled":
      return "scheduled";
    case "picked up":
    case "picked":
    case "completed":
      return "picked_up";
    case "canceled":
    case "cancelled":
      return "cancelled";
    case "failed":
    case "not picked":
      return "failed";
    default:
      return null;
  }
}

/**
 * Days Bosta will actually collect on, soonest first (ISO `YYYY-MM-DD`).
 *
 * This is the authoritative answer: it already excludes today once Bosta's own same-day
 * cut-off has passed, plus Fridays and holidays. Guessing locally gets "Can not choose
 * today because it's after the cut-off time" rejections. Only exists on v2.
 */
async function getAvailablePickupDates(days = 7) {
  const data = await withRetry(() =>
    requestJson({ method: "GET", path: `/api/v2/pickups/available-dates?days=${days}` })
  );
  const list = data?.data || [];
  return Array.isArray(list) ? list.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [];
}

/**
 * Get all pickups. Bosta rejects this endpoint without paging params, and answers with
 * `{ result: { pickups } }` here (unlike the single-pickup route, which uses `message`).
 */
async function getAllPickups({ pageId = 0, pageLimit = 50 } = {}) {
  const data = await withRetry(() =>
    requestJson({ method: "GET", path: `/api/v0/pickups?pageId=${pageId}&pageLimit=${pageLimit}` })
  );
  return data?.result?.pickups || data?.message?.result?.pickups || data?.data?.pickups || [];
}

/**
 * Get a single pickup by ID. Bosta wraps the pickup in `message`, not `data`.
 */
async function getPickupById(pickupId) {
  const data = await withRetry(() =>
    requestJson({ method: "GET", path: `/api/v0/pickups/${pickupId}` })
  );
  return data?.message || data?.data || data;
}

/**
 * Cancel a pickup.
 */
async function deletePickup(pickupId) {
  await withRetry(() =>
    requestJson({ method: "DELETE", path: `/api/v0/pickups/${pickupId}` })
  );
}

/* ------------------------------------------------------------------ *
 * Shipping bundles (باقات الشحن)
 *
 * Since Bosta moved this account onto prepaid bundles, a parcel is no longer billed the
 * per-sector tariff at all: the bundle is bought up front for a fixed number of parcels and
 * every delivery, to Cairo or to Aswan, burns exactly ONE of them. What still costs cash on
 * top is the COD collection fee and the other extras.
 *
 * These three endpoints are not in Bosta's published API docs — they were read off the
 * business dashboard's own bundle page and verified against this account on 2026-09-20.
 * They accept the business API key, unlike `/wallet/*` and `/businesses/{id}/transactions`,
 * which answer 401 to it and need dashboard access Bosta has to grant.
 * ------------------------------------------------------------------ */

/** The bundles Bosta currently sells: id, name, price, how many parcels it carries. */
async function listBundles() {
  const data = await withRetry(() => requestJson({ method: "GET", path: "/api/v2/bundles" }));
  return data?.data?.bundles || [];
}

/**
 * The bundle we are on right now — or null when none is active, which is the state where
 * shipping simply stops until one is bought.
 *
 * Carries `consumed_orders` / `numberOfRemainingOrders` and `expire_at` /
 * `numberOfRemainingDays`. BOTH can end the bundle: it dies on the day it expires even with
 * parcels left on it, and the leftovers are lost, not carried over.
 */
async function getCurrentBundleSubscription() {
  const data = await withRetry(() =>
    requestJson({ method: "GET", path: "/api/v2/bundles/subscriptions/current" })
  );
  return data?.data?.subscription || null;
}

/**
 * Every bundle ever bought on this account, newest first.
 *
 * This is where the real cost of a parcel comes from: a closed cycle knows what it cost and
 * how many of its parcels were actually used, so a bundle bought for 20 and used 11 times
 * says plainly that 9 parcels' worth of money expired unused.
 */
async function listBundlePaymentLogs() {
  const data = await withRetry(() =>
    requestJson({ method: "GET", path: "/api/v2/bundles/subscriptions/payment-logs" })
  );
  return data?.data?.paymentLogs || [];
}

/**
 * What Bosta knows about a customer's delivery behaviour, looked up by phone.
 *
 * `receiver.ranking` — a 0-100 score Bosta attaches to the person receiving a parcel — is the
 * only thing here we could not work out ourselves. Verified against this account: two of our
 * customers came back 100 and one 83.3, and the 83.3 does NOT match that customer's record
 * with us (4 delivered, 3 refused, which would be 57), so the figure is computed on Bosta's
 * side from data we do not hold. That is exactly what makes it worth asking for.
 *
 * ⚠️ UNDOCUMENTED. `ranking` appears in the delivery payload but in none of Bosta's published
 * schemas, and there is no endpoint that answers "what is this phone's score" — it can only be
 * read off a delivery the phone has already received. So it exists for customers who have
 * ordered from us before and for nobody else, and every caller must handle its absence as the
 * normal case rather than as an error.
 *
 * Deliberately NOT retried and given a short timeout: this runs while a customer is waiting on
 * the checkout screen, and a slow answer is worse than no answer.
 *
 * @returns {Promise<{ranking:number|null, delivered:number, returned:number, parcels:number}|null>}
 *          null when Bosta could not be reached or knows nothing about the number.
 */
async function getCustomerDeliveryProfile(phone, { timeoutMs = 5000, limit = 50 } = {}) {
  const { phoneLookupVariants } = require("./shared/phone");
  const variants = phoneLookupVariants(phone);
  if (variants.length === 0) return null;

  // Bosta stores receivers in international form; its search matches on the number it holds,
  // so the country-code variant is the one to ask with.
  const search = variants.find((v) => v.startsWith("20")) || variants[0];

  const data = await requestJson({
    method: "POST",
    path: "/api/v2/deliveries/search",
    body: { mobilePhones: search, limit },
    timeoutMs,
  }).catch(() => null);

  const deliveries = data?.data?.deliveries;
  if (!Array.isArray(deliveries) || deliveries.length === 0) return null;

  let ranking = null;
  let delivered = 0;
  let returned = 0;

  for (const d of deliveries) {
    // Newest first in Bosta's response; the first ranking seen is the current one.
    if (ranking === null && d.receiver?.ranking != null) ranking = Number(d.receiver.ranking);
    const state = d.state?.value || "";
    if (state === "Delivered") delivered += 1;
    else if (/return|rto/i.test(state)) returned += 1;
  }

  return { ranking, delivered, returned, parcels: deliveries.length };
}

module.exports = {
  createDelivery,
  getDelivery,
  updateDelivery,
  linkBarcode,
  trackDelivery,
  terminateDelivery,
  printAWB,
  listPickupLocations,
  createPickupLocation,
  pickupLocationName,
  updatePickupLocation,
  deletePickupLocation,
  ensurePickupLocation,
  createPickup,
  getAvailablePickupDates,
  getAllPickups,
  getPickupById,
  deletePickup,
  getCustomerDeliveryProfile,
  listBundles,
  getCurrentBundleSubscription,
  listBundlePaymentLogs,
  mapBostaPickupState,
  MIN_FIRST_LINE,
  MIN_PICKUP_LOCATION_FIRST_LINE,
};
