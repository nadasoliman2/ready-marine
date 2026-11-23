/**
 * Arrive Shipping adapter — the courier-specific half of dispatch and tracking.
 *
 * What Arrive's API can do: create a shipment, report the current status of up to 50
 * waybills, and give the dated history of one. What it cannot do — cancel, book a pickup,
 * print a waybill, price — is declared in `couriers/index.js` capabilities and handled by
 * the callers, never faked here.
 *
 * The per-shipment SENDER is a half-known case. Arrive's PDF lists no sender field, but their
 * own portal writes four ("الراسل الفرعى": name, phone, address, area), so we send those names
 * and let their API take them or ignore them. Ready Car is a marketplace — each parcel leaves
 * from a different vendor branch — so sending them is the only chance of the driver being
 * routed to the right store; ignoring them costs nothing and falls back to the account branch.
 */
const client = require("./client");
const { mapArrive } = require("./statusMap");

/** Egyptian mobile the way Arrive wants it: 11 digits starting with 0. */
function normalizePhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0020")) d = d.slice(4);
  else if (d.startsWith("20") && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith("1")) d = `0${d}`;
  return d;
}

const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

/**
 * Create one shipment. ONE attempt, no retry — see client.write. The caller stamps a
 * `dispatch_attempt` on the parcel before calling and clears it after, so a timeout can
 * never be followed by a blind second create.
 *
 * @returns {{ waybill: string, shipment_id: string, qr_code: string|null, raw: object }}
 */
async function createShipment({
  sectorId, keyword = null,
  recipientName, recipientPhone, recipientPhone2 = null, address, email = null,
  codAmount = 0, weightKg = null, quantity = null,
  productName, productDesc = "", notes = "", orderReference, serviceType = 1, flyerNumber = null,
  senderName = null, senderPhone = null, senderAddress = null, senderSectorId = null,
}) {
  const body = {
    ...(sectorId ? { sector_id: String(sectorId) } : {}),
    ...(keyword ? { keyword: clip(keyword, 120) } : {}),
    // The "sub-sender" (الراسل الفرعى) — the vendor branch this parcel actually leaves from.
    // Ready Car is a marketplace: every parcel ships from a different store, so the sender is
    // a property of the parcel, not of the account. These are the portal's own field names;
    // they are absent from Arrive's PDF, so if their API ignores them nothing breaks and the
    // account address is used, exactly as before. Confirm on the portal that the
    // "منطقة الراسل الفرعى" column is filled.
    ...(senderName ? { sender_name: clip(senderName, 250) } : {}),
    ...(senderPhone ? { sender_phone: normalizePhone(senderPhone) } : {}),
    ...(senderAddress ? { sender_address: clip(senderAddress, 2000) } : {}),
    ...(senderSectorId ? { sender_sector: String(senderSectorId) } : {}),
    product_name: clip(productName || "Auto parts", 250),
    product_desc: clip(productDesc, 2000),
    phone_1: normalizePhone(recipientPhone),
    ...(recipientPhone2 ? { phone_2: normalizePhone(recipientPhone2) } : {}),
    service_type: Number(serviceType) || 1,
    price: Math.max(0, Math.round(Number(codAmount) || 0)),
    ...(weightKg != null ? { weight: `${Number(weightKg).toFixed(1)} kg` } : {}),
    address: clip(address, 2000),
    notes: clip(notes, 2000),
    client_name: clip(recipientName || "Customer", 250),
    order_id: clip(orderReference, 255),
    ...(flyerNumber ? { email: clip(flyerNumber, 100) } : {}),
    ...(quantity != null ? { quantity: String(quantity) } : {}),
  };
  if (!body.sector_id && !body.keyword) throw new Error("Arrive needs a delivery area (sector) for this parcel");
  if (!body.phone_1 || body.phone_1.length < 10) throw new Error("Arrive needs a valid recipient mobile number");
  if (!body.address) throw new Error("Arrive needs a delivery address");

  const data = await client.write("addShipment", body);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.waybill) {
    throw new client.ArriveError(`Arrive addShipment returned no waybill: ${JSON.stringify(data).slice(0, 300)}`, { body: data, action: "addShipment" });
  }
  return { waybill: String(row.waybill), shipment_id: row.id != null ? String(row.id) : null, qr_code: row.qr_code || null, raw: row };
}

/**
 * Current status of up to 50 waybills. Names only — Arrive sends no code here — mapped by
 * name. Waybills Arrive does not know are simply absent from the answer.
 * @returns {Map<string, { raw: object, mapped: object }>}
 */
async function currentStatus(waybills) {
  const out = new Map();
  const list = [...new Set((waybills || []).filter(Boolean).map(String))];
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const rows = await client.read("getCurrentStatus", { waybill: chunk });
    for (const r of rows || []) {
      if (!r?.waybill) continue;
      // Every wording Arrive offered, not just the first: this answer carries no status code
      // and its Arabic is not always the portal's, so the English name is often the only one
      // that resolves. See mapArrive.
      out.set(String(r.waybill), {
        raw: r,
        mapped: mapArrive({
          id: r.status_id ?? r.id ?? null,
          name: [r.name_ar, r.name_en, r.status_ar, r.status_en],
        }),
      });
    }
  }
  return out;
}

/** Dated history of one waybill — used to explain an exception, not for routine polling. */
async function statusHistory(waybill) {
  const rows = await client.read("statusHistory", { waybill: String(waybill) });
  return (rows || []).map((r) => ({
    waybill: r.waybill,
    at: r.date_created ? new Date(String(r.date_created).replace(" ", "T")) : null,
    status_ar: r.status_ar || "", status_en: r.status_en || "",
    reason_ar: r.reason_ar || "", reason_en: r.reason_en || "",
    scheduled: r.scheduled_date && !/^0000/.test(r.scheduled_date) ? r.scheduled_date : null,
  }));
}

module.exports = { createShipment, currentStatus, statusHistory, normalizePhone, isConfigured: client.isConfigured };
