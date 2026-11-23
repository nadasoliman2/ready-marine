/**
 * Arrive status codes → Ready Car's status vocabulary.
 *
 * Arrive reports a numeric `status_id` on webhooks and only a NAME (`name_ar` / `name_en`)
 * from `getCurrentStatus`, so both are mapped here. The target is the ORDER vocabulary that
 * `applyBostaStatusToOrder` already consumes (`completed` for delivered), which is how one
 * apply path serves both couriers.
 *
 * `null` means informational: the event is recorded on the shipment's timeline but the
 * parcel does not move. `attention` marks states a person must look at — a partial delivery,
 * an exchange, or Arrive cancelling on its own — and is written into the parcel history so
 * the admin queue picks it up.
 */
const fs = require("fs");
const path = require("path");

const MAP = {
  1: { status: "pickup_scheduled" }, 330: { status: "pickup_scheduled" },
  2: { status: "picked_up" }, 16: { status: "picked_up" },
  3: { status: "in_transit" }, 125: { status: "in_transit" }, 600: { status: "in_transit" },
  24: { status: "in_transit" }, 39: { status: "in_transit" }, 26: { status: "in_transit" },
  450: { status: "in_transit" }, 34: { status: "in_transit" },
  4: { status: "out_for_delivery" }, 45: { status: "out_for_delivery" },
  46: { status: "out_for_delivery" }, 47: { status: "out_for_delivery" },
  5: { status: "completed" }, 33: { status: "completed" },
  18: { status: "completed", attention: "Arrive reports a PARTIAL delivery — check what the customer kept" },
  6: { status: "exception" }, 900: { status: "exception" }, 1200: { status: "exception" },
  13: { status: "exception" }, 19: { status: "exception" }, 20: { status: "exception" },
  25: { status: "exception" }, 1100: { status: "exception" }, 1150: { status: "exception" },
  100: { status: "exception" }, 110: { status: "exception" }, 120: { status: "exception" },
  43: { status: "exception", attention: "Arrive is compensating for this parcel (lost or damaged)" },
  220: { status: "exception", attention: "Arrive paid compensation for this parcel" },
  150: { status: "exception" },
  7: { status: "exception", note: "returning to sender" }, 27: { status: "exception", note: "returning to sender" },
  28: { status: "exception", note: "returning to sender" }, 31: { status: "exception", note: "returning to sender" },
  135: { status: "exception", note: "returning to sender" },
  14: { status: "returned" }, 8: { status: "returned" }, 105: { status: "returned" },
  800: { status: "exception", attention: "Arrive cancelled this shipment — cancel the parcel here to refund the customer" },
  1250: { status: "exception", attention: "Arrive reports an unconfirmed cancellation" },
  17: { status: "exception", attention: "Exchange / pickup-of-parcel state reported by Arrive" },
  22: { status: "exception", attention: "Exchange return reported by Arrive" },
  21: { status: "exception", attention: "Partial return reported by Arrive" },
  29: { status: null }, 30: { status: null }, 700: { status: null }, 1500: { status: null }, 115: { status: null },
};

/** Arabic → Latin-insensitive normalisation shared with the sector matcher. */
function normalizeArabic(s) {
  return String(s || "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

let byName = null;
function nameIndex() {
  if (byName) return byName;
  byName = new Map();
  try {
    const list = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../docs/arrive-statuses.json"), "utf8"));
    for (const s of list) byName.set(normalizeArabic(s.name), Number(s.id));
  } catch (_) { /* the id map still works */ }
  // English names seen from getCurrentStatus / the PDF.
  const en = {
    "pickup request": 1, "time scheduled": 6, "in transit": 24, "delivered": 33, "un-delivered": 13,
    "out for delivery": 4, "returned": 14, "picked up": 2, "cancelled": 800, "canceled": 800,
  };
  for (const [k, v] of Object.entries(en)) byName.set(k, v);
  // Arabic wordings the API uses that the portal's filter list does not. Added, never
  // overwriting, so a real portal name always keeps its own id.
  const arAliases = {
    "شحنة مؤجلة": 6,            // portal: "تأجيل"
    "فشل التسليم": 13,          // portal: "مشكلة في التسليم"
    "تسليم ناجح": 5,
    "طلب بيك اب": 1,
    "تم الاستلام في المخزن": 3,
  };
  for (const [k, v] of Object.entries(arAliases)) {
    const key = normalizeArabic(k);
    if (!byName.has(key)) byName.set(key, v);
  }
  return byName;
}

const idFromName = (name) => nameIndex().get(normalizeArabic(name)) ?? null;

/**
 * @param {Object}  ev
 * @param {number|string|null} ev.id    Arrive's numeric status_id — webhooks carry it
 * @param {string|string[]|null} ev.name  one name, or every name the answer offered
 * @returns {{ id: number|null, status: string|null, attention: string|null, note: string|null, known: boolean }}
 *
 * `name` takes a LIST because `getCurrentStatus` sends no code and its Arabic wording is not
 * always the portal's: Arrive's own PDF documents `name_ar: "شحنة مؤجلة"` where the portal
 * filter says "تأجيل" (6). Trying only the Arabic would leave that event unknown and the
 * parcel unmoved, even though `name_en: "Time Scheduled"` resolves it. So every candidate is
 * tried in turn and the first that resolves wins.
 */
function mapArrive({ id = null, name = null } = {}) {
  let code = id != null && id !== "" ? Number(id) : null;
  if (code == null || Number.isNaN(code)) {
    code = null;
    for (const candidate of [].concat(name || [])) {
      if (!candidate) continue;
      const hit = idFromName(candidate);
      if (hit != null) { code = hit; break; }
    }
  }
  const m = code != null ? MAP[code] : undefined;
  return {
    id: code,
    status: m ? m.status : null,
    attention: m?.attention || null,
    note: m?.note || null,
    known: !!m,
  };
}

/** Human label for the timeline: Arrive's own words, with the code for the record. */
const rawLabel = ({ id, name_ar, name_en, status_ar, status_en }) => {
  const text = name_en || status_en || name_ar || status_ar || "";
  return id != null ? `${text} (#${id})`.trim() : text;
};

const TERMINAL = ["completed", "returned"];

module.exports = { MAP, mapArrive, idFromName, normalizeArabic, rawLabel, TERMINAL };
