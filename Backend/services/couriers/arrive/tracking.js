/**
 * Applying Arrive status updates to parcels — shared by the webhook and the polling sweep.
 *
 * Arrive's webhook carries no event time, so ordering is by MEANING rather than by clock:
 * a parcel that has reached `delivered` or `returned` is never moved back by a later "in
 * transit", and an unknown code is recorded on the timeline without touching the parcel.
 * Everything else rides the same `applyBostaStatusToOrder` path Bosta uses, with the
 * status already mapped, so both couriers roll the order up identically.
 */
const { Order } = require("../../../models/orders");
const { mapArrive, rawLabel, TERMINAL } = require("./statusMap");
const adapter = require("./adapter");

/**
 * @param {Object} order      mutable Order document
 * @param {Object} shipment   the Arrive shipment row
 * @param {Object} event      { status_id?, name_ar?, name_en?, status_ar?, status_en?, notes?, reason?, scheduled? }
 * @param {string} actorLabel
 * @returns {{ applied: boolean, changed: boolean, mapped: object, result: object|null, attention: string|null }}
 */
function applyArriveEvent(order, shipment, event, actorLabel = "Arrive") {
  const mapped = mapArrive({
    id: event.status_id ?? event.id ?? null,
    name: [event.name_ar, event.name_en, event.status_ar, event.status_en],
  });
  const label = rawLabel({ id: mapped.id, name_ar: event.name_ar || event.status_ar, name_en: event.name_en || event.status_en });
  const notes = [event.reason, event.notes, event.scheduled ? `scheduled ${event.scheduled}` : "", mapped.note]
    .filter(Boolean).join(" · ");

  const { applyBostaStatusToOrder } = require("../../bostaStatusMap");
  const sub = (order.sub_orders || []).find((s) => s._id?.toString() === shipment.sub_order_id?.toString()) || null;
  if (shipment.superseded_at || sub?.courier_transfer?.phase === 'removing') {
    return { applied: false, changed: false, mapped, result: null, attention: null };
  }

  // Terminal states are never walked back by an undated event.
  const subDone = sub && ["delivered", "returned"].includes(sub.status);
  const regress = subDone && mapped.status && !TERMINAL.includes(mapped.status);

  const result = applyBostaStatusToOrder(order, shipment, label, {
    notes,
    actorLabel,
    // Informational, unknown, or a regression: record on the timeline, do not move the parcel.
    mapped: regress || !mapped.status ? "__skip__" : mapped.status,
  });
  shipment.provider_status = label;

  if (mapped.attention && sub) {
    const last = (sub.history || []).slice(-1)[0];
    const already = last && last.action === "courier_attention" && last.details === mapped.attention;
    if (!already) {
      sub.history = sub.history || [];
      sub.history.push({
        action: "courier_attention",
        title: "Arrive needs your attention",
        details: mapped.attention,
        actor_role: "system",
        actor_label: actorLabel,
        metadata: { status_id: mapped.id, raw: label },
        created_at: new Date(),
      });
    }
  }
  return { applied: !!mapped.status && !regress, changed: !!result?.changed, mapped, result, attention: mapped.attention };
}

/** Live Arrive shipments across live orders — the sweep's working set. */
async function liveArriveShipments() {
  const orders = await Order.find({
    "shipments.provider": "arrive",
    status: { $nin: ["cancelled", "completed", "refunded"] },
  });
  const rows = [];
  for (const order of orders) {
    for (const shipment of order.shipments || []) {
      if (shipment.provider !== "arrive" || !shipment.tracking_number || shipment.superseded_at) continue;
      const sub = (order.sub_orders || []).find((s) => s._id?.toString() === shipment.sub_order_id?.toString());
      if (!sub || ["delivered", "returned", "cancelled"].includes(sub.status)) continue;
      rows.push({ order, shipment, sub });
    }
  }
  return rows;
}

/**
 * Polling fallback, every 20 minutes: one `getCurrentStatus` call per 50 waybills, well inside
 * the 50 requests / minute ceiling for any realistic volume.
 */
async function sweepActiveArriveShipments() {
  if (!adapter.isConfigured()) return { checked: 0, updated: 0, skipped: "not configured" };
  const rows = await liveArriveShipments();
  if (rows.length === 0) return { checked: 0, updated: 0 };

  const statuses = await adapter.currentStatus(rows.map((r) => r.shipment.tracking_number));
  const orderService = require("../../orderService");
  const touched = new Map(); // order id → { order, deliveredSubIds, changed }

  for (const { order, shipment } of rows) {
    const hit = statuses.get(String(shipment.tracking_number));
    if (!hit) continue;
    const entry = touched.get(String(order._id)) || { order, deliveredSubIds: [], changed: false };
    const r = applyArriveEvent(order, shipment, hit.raw, "Arrive Sweep");
    if (r.changed) entry.changed = true;
    if (r.result?.sub_order_delivered) entry.deliveredSubIds.push(r.result.sub_order_id);
    touched.set(String(order._id), entry);
  }

  let updated = 0;
  for (const { order, deliveredSubIds, changed } of touched.values()) {
    try {
      await order.save();
      if (changed) updated += 1;
      for (const subId of deliveredSubIds) {
        const sub = (order.sub_orders || []).find((s) => s._id.toString() === subId?.toString());
        if (sub) await orderService.onSubOrderDelivered(order, sub);
      }
    } catch (err) {
      console.error(`[Arrive sweep] Failed to save order ${order._id}: ${err.message}`);
    }
  }
  return { checked: rows.length, updated };
}

module.exports = { applyArriveEvent, sweepActiveArriveShipments, liveArriveShipments };
