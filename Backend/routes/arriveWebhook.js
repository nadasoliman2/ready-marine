/**
 * Arrive Shipping status webhook.
 *
 * Arrive posts `{ "response": [ { waybill, status_id, status_ar, status_en, notes, reason,
 * scheduled, store, order_id, client_id } ] }` on every status change — sometimes a bare
 * array, sometimes one object. No signature, so the shared secret rides in the URL path
 * exactly as it does for Bosta: POST /api/webhooks/arrive/<ARRIVE_WEBHOOK_SECRET>.
 *
 * Always answers 200 once the secret checks out, even for waybills we do not know: Arrive
 * retries on failure, and a retry cannot make an unknown waybill known.
 */
const express = require("express");
const router = express.Router();
const { Order } = require("../models/orders");
const { applyArriveEvent } = require("../services/couriers/arrive/tracking");

const SECRET = process.env.ARRIVE_WEBHOOK_SECRET || "";

const verify = (req) => {
  if (!SECRET) { console.warn("[Arrive webhook] ARRIVE_WEBHOOK_SECRET not set — skipping verification"); return true; }
  return (req.params.secret || req.query.secret) === SECRET;
};

const entriesOf = (body) => {
  if (!body) return [];
  if (Array.isArray(body)) return body.flatMap(entriesOf);
  if (Array.isArray(body.response)) return body.response;
  if (body.response && typeof body.response === "object") return Object.values(body.response).every((v) => v && typeof v === "object") ? Object.values(body.response) : [body.response];
  if (body.waybill) return [body];
  // PHP-style form encoding parsed flat by express.urlencoded({ extended: false }):
  // "response[0][waybill]": "TS…" → rebuild the entries.
  const flat = {};
  for (const [k, v] of Object.entries(body)) {
    const m = /^response\[(\d+)\]\[(\w+)\]$/.exec(k);
    if (m) (flat[m[1]] = flat[m[1]] || {})[m[2]] = v;
  }
  const rebuilt = Object.values(flat);
  if (rebuilt.length === 0) console.warn("[Arrive webhook] unrecognised body shape:", JSON.stringify(body).slice(0, 500));
  return rebuilt;
};

async function handle(req, res) {
  if (!verify(req)) return res.status(401).json({ success: false, message: "Invalid webhook secret" });
  const entries = entriesOf(req.body);
  const handled = [];
  const orderService = require("../services/orderService");

  for (const e of entries) {
    const waybill = e.waybill != null ? String(e.waybill) : null;
    if (!waybill) continue;
    try {
      const order = await Order.findOne({ shipments: { $elemMatch: { provider: "arrive", tracking_number: waybill } } });
      if (!order) { handled.push({ waybill, result: "unknown" }); continue; }
      const shipment = order.shipments.find((s) => s.provider === "arrive" && s.tracking_number === waybill);
      const r = applyArriveEvent(order, shipment, e, "Arrive Webhook");
      await order.save();
      if (r.result?.sub_order_delivered) {
        const sub = (order.sub_orders || []).find((s) => s._id.toString() === r.result.sub_order_id?.toString());
        if (sub) await orderService.onSubOrderDelivered(order, sub);
      }
      handled.push({ waybill, result: r.applied ? "applied" : "recorded", status: r.mapped.status, code: r.mapped.id });
    } catch (err) {
      console.error(`[Arrive webhook] ${waybill}: ${err.message}`);
      handled.push({ waybill, result: "error" });
    }
  }
  res.json({ success: true, handled });
}

router.post("/", handle);
router.post("/:secret", handle);

module.exports = router;
