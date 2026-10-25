/**
 * Arrive's price list for the Ready Car account, frozen from the portal calculator on
 * 2026-09-13 (`docs/arrive-tariff.json`). Arrive exposes no pricing API, so this file is the
 * tariff the same way `bostaTariff.js` is for Bosta — and, like it, the number is stamped on
 * the parcel at dispatch so a later price change never restates history.
 *
 * Prices are per pricing GROUP (Arrive's `gov_name` on a sector), plus 5 EGP per kilogram over
 * the 2 kg allowance. Whether they include VAT is unconfirmed; recorded as-is.
 */
const fs = require("fs");
const path = require("path");
const { normalizeArabic } = require("./statusMap");

let table = null;
function load() {
  if (table) return table;
  table = new Map();
  try {
    const rows = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../docs/arrive-tariff.json"), "utf8"));
    for (const r of rows) table.set(normalizeArabic(r.group), r);
  } catch (err) {
    console.error(`[Arrive tariff] could not load docs/arrive-tariff.json: ${err.message}`);
  }
  return table;
}

const UNSERVED_GROUP = normalizeArabic("مناطق غيرمخدومه");
const isUnservedGroup = (govName) => normalizeArabic(govName) === UNSERVED_GROUP;

/**
 * @returns {{ priced: boolean, group: string, delivery: number, return: number, refuse: number,
 *             cancel: number, over_weight: number, delivery_hours: number|null }}
 */
function quote(govName, weightKg = 0) {
  const row = load().get(normalizeArabic(govName));
  if (!row) return { priced: false, group: govName || "", delivery: 0, return: 0, refuse: 0, cancel: 0, over_weight: 0, delivery_hours: null };
  const allowed = Number(row.allowed_weight_kg || 2);
  const perKg = Number(row.over_weight_per_kg || 5);
  const over = Math.max(0, Math.ceil(Number(weightKg || 0) - allowed));
  const overWeight = over * perKg;
  return {
    priced: true,
    group: row.group,
    delivery: Number(row.delivery || 0) + overWeight,
    return: Number(row.return || 0),
    refuse: Number(row.refuse || 0),
    cancel: Number(row.cancel || 0),
    over_weight: overWeight,
    delivery_hours: row.delivery_hours ?? null,
  };
}

module.exports = { quote, isUnservedGroup, load };
