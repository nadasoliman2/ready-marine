/**
 * Arrive delivery areas: sync from the API, search for the admin's picker, and a best-effort
 * suggestion from the free-text address so most parcels need no manual choice.
 */
const fs = require("fs");
const path = require("path");
const { ArriveSector } = require("../../../models/arriveSectors");
const client = require("./client");
const { normalizeArabic } = require("./statusMap");
const { isUnservedGroup } = require("./tariff");

/** Pull the live list; falls back to the JSON dump only when the API cannot be reached. */
async function syncSectors({ actor = {} } = {}) {
  let rows;
  let source = "api";
  try {
    rows = await client.read("getAllSectors", {});
  } catch (err) {
    source = `docs/arrive-sectors.json (API failed: ${err.message})`;
    const dump = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../docs/arrive-sectors.json"), "utf8"));
    rows = dump.map((s) => ({ id: s.id, name: s.name, key_words: s.kw, gov_name: s.gov, gov_id: "" }));
  }
  const now = new Date();
  let upserted = 0;
  for (const r of rows) {
    const id = Number(r.id);
    if (!id) continue;
    await ArriveSector.updateOne(
      { sector_id: id },
      {
        $set: {
          name: String(r.name || "").trim(),
          name_norm: normalizeArabic(r.name),
          gov_id: String(r.gov_id || ""),
          gov_name: String(r.gov_name || "").trim(),
          key_words: String(r.key_words || "").replace(/^[(,\s]+|[)\s]+$/g, ""),
          serviceable: !isUnservedGroup(r.gov_name),
          synced_at: now,
        },
      },
      { upsert: true }
    );
    upserted += 1;
  }
  return { count: upserted, source, synced_at: now };
}

async function ensureSectors() {
  const n = await ArriveSector.estimatedDocumentCount();
  if (n === 0) await syncSectors();
}

/** Search by name, keyword, group or id — the admin's picker. */
async function searchSectors(q = "", { limit = 25 } = {}) {
  await ensureSectors();
  const term = String(q || "").trim();
  if (!term) {
    return ArriveSector.find({ serviceable: true }).sort({ gov_name: 1, name: 1 }).limit(limit).lean();
  }
  if (/^\d+$/.test(term)) {
    const one = await ArriveSector.findOne({ sector_id: Number(term) }).lean();
    if (one) return [one];
  }
  const norm = normalizeArabic(term);
  const rx = new RegExp(norm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return ArriveSector.find({
    $or: [{ name_norm: rx }, { name: rx }, { key_words: rx }, { gov_name: rx }],
  }).sort({ serviceable: -1, name: 1 }).limit(limit).lean();
}

const getSector = async (id) => (id ? ArriveSector.findOne({ sector_id: Number(id) }).lean() : null);

// Our 28 checkout cities → the Arrive pricing groups they can fall in. Used only to rank
// candidates when the address text matches several areas, and to say "unmapped" honestly
// when it matches none.
const CITY_GROUPS = {
  cairo: ["القاهره", "ضواحي القاهره والجيزه", "المدن الجديده"],
  giza: ["الجيزه", "ضواحي القاهره والجيزه", "المدن الجديده"],
  alexandria: ["الاسكندريه", "ضواحي الاسكندريه"],
};

/**
 * Best guess from the address text: the longest area name that appears in it. The Arrive
 * list is district-level, so "شارع ٩ المعادي" finds المعادي and "6 October" finds 6 اكتوبر.
 * @returns {{ sector: object|null, confidence: 'high'|'low'|'none', candidates: object[] }}
 */
async function suggestSector({ address = "", city = "" } = {}) {
  await ensureSectors();
  const text = normalizeArabic(address);
  if (!text) return { sector: null, confidence: "none", candidates: [] };
  const all = await ArriveSector.find({ serviceable: true }).select("sector_id name name_norm gov_name key_words").lean();
  const hits = [];
  for (const s of all) {
    const n = s.name_norm || normalizeArabic(s.name);
    if (n.length < 3) continue;
    const variants = new Set([n, n.replace(/^ال/, "")]);
    for (const kw of String(s.key_words || "").split(",")) {
      const k = normalizeArabic(kw);
      if (k.length >= 4 && !/^eg/i.test(k)) variants.add(k);
    }
    for (const v of variants) {
      if (v.length >= 3 && text.includes(v)) { hits.push({ s, len: v.length }); break; }
    }
  }
  if (hits.length === 0) return { sector: null, confidence: "none", candidates: [] };
  const groups = CITY_GROUPS[String(city || "").toLowerCase()] || null;
  hits.sort((a, b) => {
    const ga = groups ? (groups.map(normalizeArabic).includes(normalizeArabic(a.s.gov_name)) ? 1 : 0) : 0;
    const gb = groups ? (groups.map(normalizeArabic).includes(normalizeArabic(b.s.gov_name)) ? 1 : 0) : 0;
    return gb - ga || b.len - a.len;
  });
  const best = hits[0].s;
  const confidence = hits.length === 1 || hits[0].len >= 5 ? "high" : "low";
  return { sector: best, confidence, candidates: hits.slice(0, 5).map((h) => h.s) };
}

module.exports = { syncSectors, ensureSectors, searchSectors, getSector, suggestSector };
