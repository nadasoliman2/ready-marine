/**
 * Central mapping between Bosta delivery states and internal order statuses.
 *
 * Authoritative Bosta webhook payload shape (verified against Bosta's live webhook schema):
 *   {
 *     "_id": "<delivery id>",
 *     "trackingNumber": 12345678,            // number or string
 *     "state": 45,                            // BARE NUMERIC state code (NOT an object/string)
 *     "type": "SEND",                         // SEND | EXCHANGE | CUSTOMER_RETURN_PICKUP | RTO | SIGN_AND_RETURN | FXF_SEND
 *     "timeStamp": 1719139200000,             // epoch milliseconds
 *     "deliveryPromiseDate": "23-06-2026",
 *     "numberOfAttempts": 0,
 *     "cod": 0,                               // present when delivered (state 45)
 *     "isConfirmedDelivery": true,            // present when delivered
 *     "exceptionReason": "...",               // present when exception (state 47)
 *     "exceptionCode": 1,                     // present when exception
 *     "businessReference": "..."              // optional
 *   }
 *
 * So the numeric `state` code is the source of truth. We also keep a value-string map for
 * the GET /deliveries tracking endpoint (polling fallback), which returns named states.
 */

// The parcel's own status vocabulary, read from the schema itself so this file cannot drift
// away from what the database will actually accept.
const { SUB_ORDER_STATUSES } = require("../models/orders");

// Internal order statuses driven by Bosta once an order is dispatched.
// These must NOT be manually editable by the admin (see orderService.updateOrderStatus).
const BOSTA_DRIVEN_STATUSES = [
  "ready",
  "pickup_scheduled",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "completed",
  "returned",
  "exception",
];

// Forward progression order (least → most advanced). Used to derive the order
// status from multiple shipments (the order reflects the least-advanced shipment).
const FORWARD_ORDER = [
  "pickup_scheduled",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "completed",
];

/**
 * Numeric Bosta state code → internal order status (PRIMARY — webhooks send numeric codes).
 * Codes verified against Bosta's live state list.
 */
const BOSTA_CODE_TO_ORDER_STATUS = {
  // ── Dispatched, but nobody is coming for it yet ───────────────────────────────
  // "Pickup requested" is the state EVERY delivery is born in — it means "this parcel
  // exists and is waiting to be collected", NOT "a courier has been booked". Mapping it
  // to pickup_scheduled made every order claim a pickup was scheduled ~20 minutes after
  // dispatch, while Bosta had no pickup request and our pickups module was empty.
  10: "ready",            // Pickup requested  — created, nothing booked
  11: "ready",            // Waiting for route — queued, still no courier assigned

  // ── A courier is actually coming ──────────────────────────────────────────────
  20: "pickup_scheduled", // Route Assigned              — a route now covers this parcel
  22: "pickup_scheduled", // Picking up from consignee   — star heading to collect (CRP)

  // ── Collected ─────────────────────────────────────────────────────────────────
  21: "picked_up",        // Picked up from business
  23: "picked_up",        // Picked up from consignee (return)

  // ── Moving inside Bosta's network ─────────────────────────────────────────────
  // "Received at warehouse" can arrive both before and after "In transit between hubs",
  // so it maps forward rather than back — otherwise a hub scan would drag an in-transit
  // order back to picked_up.
  24: "in_transit",       // Received at warehouse
  25: "in_transit",       // Fulfilled (FXF)
  30: "in_transit",       // In transit between Hubs

  // ── Out with the courier, heading to the customer ─────────────────────────────
  40: "out_for_delivery", // Picking up (cash collection)
  41: "out_for_delivery", // Picked up (heading to customer)

  // ── Finished ──────────────────────────────────────────────────────────────────
  45: "completed",        // Delivered
  46: "returned",         // Returned to business
  60: "returned",         // Returned to stock (FXF)
  49: "cancelled",        // Canceled

  // ── Needs a human ─────────────────────────────────────────────────────────────
  47: "exception",        // Exception
  48: "exception",        // Terminated (3 failed attempts)
  100: "exception",       // Lost
  101: "exception",       // Damaged
  102: "exception",       // Investigation
  103: "exception",       // Awaiting your action
  105: "exception",       // On hold
  // 104 Archived → intentionally unmapped (terminal admin state; must not regress status)
};

/** Numeric Bosta state code → human-readable value string (Bosta's `name`). */
const BOSTA_CODE_TO_VALUE = {
  10: "Pickup requested",
  11: "Waiting for route",
  20: "Route Assigned",
  21: "Picked up from business",
  22: "Picking up from consignee",
  23: "Picked up from consignee",
  24: "Received at warehouse",
  25: "Fulfilled",
  30: "In transit between Hubs",
  40: "Picking up",
  41: "Picked up",
  45: "Delivered",
  46: "Returned to business",
  47: "Exception",
  48: "Terminated",
  49: "Canceled",
  60: "Returned to stock",
  100: "Lost",
  101: "Damaged",
  102: "Investigation",
  103: "Awaiting your action",
  104: "Archived",
  105: "On hold",
};

/**
 * Bosta state value string (lowercased) → internal order status. Used by the GET tracking
 * endpoint (polling) which returns named states. Covers Bosta's current value names plus
 * a few legacy/older-SDK aliases for safety.
 */
const BOSTA_STATE_TO_ORDER_STATUS = {
  // Dispatched, nobody coming yet — see the code map above for why these are `ready`.
  pending: "ready",
  "pickup requested": "ready",
  "waiting for route": "ready",
  "waiting for pickup": "ready",
  // A courier is actually coming
  "route assigned": "pickup_scheduled",
  "picking up from consignee": "pickup_scheduled",
  // Collected
  "picked up from business": "picked_up",
  "picked up from consignee": "picked_up",
  // In network
  "received at warehouse": "in_transit",
  fulfilled: "in_transit",
  "in transit between hubs": "in_transit",
  // Heading to customer (plain "Picked up" = state 41, dashboard "Heading to customer")
  "picked up": "out_for_delivery",
  "picking up": "out_for_delivery",
  delivering: "out_for_delivery",
  "arrived at customer": "out_for_delivery",
  // Delivered
  delivered: "completed",
  "delivery confirmed": "completed",
  // Returned to business / stock
  "returned to business": "returned",
  "returned to stock": "returned",
  // Cancelled
  canceled: "cancelled",
  cancelled: "cancelled",
  // Problem states
  terminated: "exception",
  exception: "exception",
  investigation: "exception",
  "awaiting your action": "exception",
  "on hold": "exception",
  lost: "exception",
  damaged: "exception",
};

/** Extract a numeric Bosta state code from a payload, if present. */
function extractBostaCode(payload) {
  if (!payload || typeof payload !== "object") return null;
  let raw = null;
  if (typeof payload.state === "number") raw = payload.state;
  else if (typeof payload.state === "string" && /^\d+$/.test(payload.state.trim())) raw = payload.state.trim();
  else if (payload.state && typeof payload.state === "object" && payload.state.code != null) raw = payload.state.code;
  else if (payload.currentStatus && typeof payload.currentStatus === "object" && payload.currentStatus.code != null) raw = payload.currentStatus.code;
  else if (payload.CurrentStatus && typeof payload.CurrentStatus === "object" && payload.CurrentStatus.code != null) raw = payload.CurrentStatus.code;
  else if (payload.stateCode != null) raw = payload.stateCode;
  else if (payload.state_code != null) raw = payload.state_code;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Defensively extract a human-readable Bosta state from any payload shape (webhook body or
 * tracking response). Bosta's webhook sends a bare numeric `state` code, which we convert to
 * a readable value string; the tracking endpoint may send a nested { value, code } or a string.
 * @returns {string} state string (e.g. 'Delivered'), or "" if none found.
 */
function extractBostaState(payload) {
  if (!payload || typeof payload !== "object") return "";

  // Webhook shape: bare numeric state code.
  if (typeof payload.state === "number") {
    return BOSTA_CODE_TO_VALUE[payload.state] || `state ${payload.state}`;
  }

  const candidates = [
    payload.state && typeof payload.state === "object" ? payload.state.value : null,
    typeof payload.state === "string" && !/^\d+$/.test(payload.state.trim()) ? payload.state : null,
    payload.currentStatus && typeof payload.currentStatus === "object"
      ? payload.currentStatus.value || payload.currentStatus.state
      : null,
    typeof payload.currentStatus === "string" ? payload.currentStatus : null,
    payload.CurrentStatus && typeof payload.CurrentStatus === "object"
      ? payload.CurrentStatus.value || payload.CurrentStatus.state
      : null,
    typeof payload.CurrentStatus === "string" ? payload.CurrentStatus : null,
    typeof payload.Status === "string" ? payload.Status : null,
    typeof payload.status === "string" ? payload.status : null,
  ];
  for (const c of candidates) {
    if (c && typeof c === "string" && c.trim()) return c.trim();
  }

  // Fall back to any numeric code we can find → readable value.
  const code = extractBostaCode(payload);
  if (code != null && BOSTA_CODE_TO_VALUE[code]) return BOSTA_CODE_TO_VALUE[code];
  return "";
}

/**
 * Map a raw Bosta state to an internal order status. Accepts a numeric code, a numeric
 * string, or a value string ('Delivered' / 'delivered').
 * @returns {string|null} internal status, or null if unknown/unmapped (e.g. Archived).
 */
function mapBostaStateToOrderStatus(rawState) {
  if (rawState == null) return null;

  const numeric =
    typeof rawState === "number"
      ? rawState
      : (typeof rawState === "string" && /^\d+$/.test(rawState.trim()) ? Number(rawState.trim()) : null);
  if (numeric != null) return BOSTA_CODE_TO_ORDER_STATUS[numeric] || null;

  if (typeof rawState !== "string") return null;
  return BOSTA_STATE_TO_ORDER_STATUS[rawState.trim().toLowerCase()] || null;
}


/**
 * True when every approved item on the order is carried by some shipment.
 *
 * Dispatch can leave an approved item with no shipment — a vendor whose create failed
 * while others succeeded, or an item approved after the order was already sent. Such an
 * order must never read as finished, so the status derivation needs to know.
 */
function allApprovedItemsHaveShipment(order) {
  const approved = (order?.items || []).filter((i) => i.vendor_status === "approved");
  if (approved.length === 0) return true;

  const shipped = new Set();
  for (const s of order.shipments || []) {
    for (const id of s.items || []) shipped.add(id.toString());
  }
  // A shipment that records no item ids can't be reasoned about; treat the order as fully
  // covered rather than pinning it open forever on missing bookkeeping.
  if (shipped.size === 0) return true;

  return approved.every((i) => shipped.has(i._id.toString()));
}

/**
 * Derive the overall order status from the mapped status of every shipment.
 * Unmapped shipments (null) are ignored so unknown states can't regress the order.
 * - `completed` only when EVERY mapped shipment is completed AND every approved item
 *   actually has a shipment (`allItemsShipped`).
 * - any `exception` surfaces as `exception`; otherwise any `returned` surfaces as `returned`.
 * - otherwise the order reflects the LEAST-advanced shipment in the forward flow.
 *
 * `ready` is deliberately absent from FORWARD_ORDER. Shipments sitting at Bosta's
 * "Pickup requested" therefore derive nothing, leaving the order's current status alone —
 * which is what lets an admin schedule a pickup by hand without the next poll yanking the
 * order back to `ready` just because Bosta hasn't assigned a route yet.
 */
function deriveOrderStatus(shipmentStatuses, allItemsShipped = true) {
  const statuses = shipmentStatuses.filter(Boolean);
  if (statuses.length === 0) return null;

  // `allItemsShipped === false` means an approved item never got a shipment. The order is
  // then not finishable no matter how well the shipments that DO exist are going — the
  // customer is still owed part of what they bought. Without this the order reports
  // "completed" once its existing shipments are delivered, silently writing off the rest.
  if (statuses.every((s) => s === "completed")) {
    return allItemsShipped ? "completed" : "out_for_delivery";
  }
  if (statuses.some((s) => s === "exception")) return "exception";
  if (statuses.some((s) => s === "returned")) return "returned";
  if (statuses.every((s) => s === "cancelled")) return "cancelled";

  let minIdx = FORWARD_ORDER.length - 1;
  let found = false;
  for (const s of statuses) {
    const idx = FORWARD_ORDER.indexOf(s);
    if (idx !== -1 && idx < minIdx) { minIdx = idx; found = true; }
    else if (idx !== -1) found = true;
  }
  return found ? FORWARD_ORDER[minIdx] : null;
}

/**
 * Apply a Bosta status update to a single shipment and recompute the order status.
 * Stores the raw Bosta value string as the shipment's status, appends tracking history,
 * recomputes order.status from all shipments, sets delivered_at on completion, and appends
 * an order.history audit entry when the status changes.
 * @returns {{ changed: boolean, from: string, to: string }}
 */
/**
 * Bosta's `timeStamp` is epoch milliseconds, but it can arrive as a string — and
 * `new Date("1719139200000")` is an Invalid Date, not that instant, which then fails to
 * cast on save and 500s the webhook forever. Numeric strings are read as epoch; anything
 * unparseable is discarded so the caller falls back to "now".
 * @returns {Date|null}
 */
function parseBostaTimestamp(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Apply a mapped status to the sub-order this shipment carries.
 *
 * The sub-order is the source of truth for delivery state; the order's own status is a
 * rollup derived from all of them afterwards. Keeping the write here means one delivered
 * parcel is recorded as delivered even while its siblings are still in a warehouse —
 * which is the whole point of splitting the order.
 *
 * @returns {{ sub: Object|null, changed: boolean, deliveredNow: boolean }}
 */
function applyStatusToSubOrder(order, shipment, mapped, rawState, actorLabel) {
  if (!mapped) return { sub: null, changed: false, deliveredNow: false };

  const subId = shipment?.sub_order_id;
  const sub = subId
    ? (order.sub_orders || []).find((s) => s._id?.toString() === subId.toString())
    // Orders placed before sub-orders existed, and any shipment whose link was lost, fall
    // back to the vendor. A vendor with two branches is ambiguous that way, so the
    // tracking number decides first and the vendor only breaks a remaining tie.
    : (order.sub_orders || []).find(
        (s) =>
          (shipment?.bosta_tracking_number && s.bosta_tracking_number === shipment.bosta_tracking_number) ||
          (s.vendor_id?.toString() === shipment?.vendor_id?.toString() && !s.bosta_tracking_number)
      );

  if (!sub) return { sub: null, changed: false, deliveredNow: false };

  // A cancelled parcel is off the flow for good: Bosta may still emit events for a
  // delivery that was terminated, and they must not resurrect it.
  if (sub.status === "cancelled") return { sub, changed: false, deliveredNow: false };
  if (sub.status === mapped) return { sub, changed: false, deliveredNow: false };

  // `mapped` comes from the ORDER status vocabulary, which is not the parcel's. Most values
  // exist in both, but "ready" does not: it is the order-level word for "a parcel of mine is
  // waiting for a courier", while the parcel itself says `ready_for_pickup`. Bosta states 10
  // and 11 ("Pickup requested" / "Waiting for route") map to it, and they are the states
  // EVERY delivery is born in — so every sweep over a parcel awaiting collection wrote a
  // word the schema rejects, `order.save()` threw, and the whole sweep update for that order
  // was thrown away: tracking history, Bosta's own state string, all of it.
  //
  // Skipping is the right answer, not translating. States 10/11 only say the delivery exists
  // at Bosta; they carry nothing about how far the VENDOR has got — whether the parcel is
  // still being packed or already sealed and photographed is ours to know, not Bosta's.
  // Anything else outside the parcel vocabulary is skipped for the same reason: a status
  // Bosta cannot speak to must never cost us the rest of the update.
  if (!SUB_ORDER_STATUSES.includes(mapped)) return { sub, changed: false, deliveredNow: false };

  const from = sub.status;
  sub.status = mapped;

  const deliveredNow = mapped === "delivered" && !sub.delivered_at;
  if (deliveredNow) sub.delivered_at = new Date();

  // A refused parcel is billed twice — the outbound attempt happened whether or not the
  // customer took it, and Bosta charges again to carry it back. Adding the return leg here
  // is what stops a failed delivery reading as cheaply as a successful one in the subsidy
  // report. Idempotent, because this path is re-entered by every webhook retry and by the
  // 20-minute polling sweep. Required lazily: bostaStatusMap is loaded by the fulfilment
  // service, which the cost service does not depend on, and a top-level require here would
  // close that loop.
  if (mapped === "returned") {
    require("./courierCostService").recordReturnCost(shipment);
  }

  sub.history = sub.history || [];
  sub.history.push({
    action: mapped === "delivered" ? "sub_order_delivered" : "sub_order_status_changed",
    title: mapped === "delivered" ? "Parcel delivered" : "Parcel status changed",
    details: `Moved to ${mapped} (from ${shipment?.provider === "arrive" ? "Arrive" : "Bosta"}: ${rawState || "tracking sync"}).`,
    actor_role: "system",
    actor_label: actorLabel,
    metadata: { from, to: mapped, bosta_state: rawState || null, provider: shipment?.provider || "bosta" },
    created_at: new Date(),
  });

  return { sub, changed: true, deliveredNow };
}

function applyBostaStatusToOrder(order, shipment, rawState, opts = {}) {
  const transferring = (order.sub_orders || []).some((sub) =>
    String(sub._id) === String(shipment.sub_order_id) && sub.courier_transfer?.phase === 'removing');
  // DELETE can trigger a cancellation webhook before the replacement is saved. That
  // cancellation belongs to the retired waybill, not to the customer's parcel.
  if (transferring) return { changed: false, from: order.status, to: order.status, transferring: true };
  // `mapped`: a status already translated by another courier's map (Arrive). "__skip__"
  // records the event on the timeline and leaves the parcel alone.
  const { timestamp, notes = "", actorLabel = "Bosta", mapped: preMapped = null } = opts;
  const eventAt = parseBostaTimestamp(timestamp);
  const when = eventAt || new Date();

  // Bosta gives no ordering guarantee on webhooks, and a retried one can land long after
  // a later event. Without this, an "In transit" delivered late would drag a completed
  // order back to in_transit. `timestamp` is Bosta's own event time and is only present
  // on webhooks; the polling sweep omits it because it reads Bosta's *current* state and
  // must always be allowed to apply.
  if (eventAt && shipment.last_event_at && eventAt <= shipment.last_event_at) {
    return { changed: false, from: order.status, to: order.status, stale: true };
  }
  if (eventAt) shipment.last_event_at = eventAt;

  if (rawState) {
    // Only record an event that carries new information. The polling sweep re-reports the
    // same state every 20 minutes; appending each one would add a duplicate line per poll
    // forever (a shipment sitting in transit for a week would collect ~500 of them).
    //
    // A webhook is always news, because Bosta only fires one when something actually
    // changed — two identical "Exception / customer not answering" webhooks are two real
    // failed delivery attempts, and collapsing them loses an attempt. Only the pollers,
    // which re-read the same state on a timer, are deduplicated.
    const last = shipment.tracking_history[shipment.tracking_history.length - 1];
    const isNews =
      !!eventAt || !last || last.state !== rawState || (notes || "") !== (last.notes || "");

    shipment.bosta_status = rawState;
    shipment.last_tracked_at = new Date();
    if (isNews) shipment.tracking_history.push({ state: rawState, timestamp: when, notes });
  }

  const prevStatus = order.status;
  if (prevStatus === "cancelled") {
    return { changed: false, from: prevStatus, to: prevStatus };
  }

  // A shipment retired by a reactivation belongs to a delivery that was terminated. Its
  // own timeline above is kept current, but the parcel now rides a different delivery and
  // must never be moved by this one — least of all to "cancelled".
  if (shipment.superseded_at) {
    return { changed: false, from: prevStatus, to: prevStatus, superseded: true };
  }

  if (preMapped === "__skip__") {
    return { changed: false, from: prevStatus, to: prevStatus, skipped: true };
  }
  const mapped = preMapped || mapBostaStateToOrderStatus(rawState || shipment.bosta_status);

  // Sub-orders are the source of truth. Write the parcel's own state first, then roll the
  // order up from all of them — so a delivered parcel reads as delivered even while its
  // siblings are still moving, and an exception on one parcel cannot make a healthy order
  // look stuck.
  if (Array.isArray(order.sub_orders) && order.sub_orders.length > 0) {
    const subOrderService = require("./subOrderService");
    const subMapped = mapped === "completed" ? "delivered" : mapped;
    const applied = applyStatusToSubOrder(order, shipment, subMapped, rawState, actorLabel);

    const rolled = subOrderService.syncOrderStatus(order, actorLabel);

    // Customer-facing notices ride on the parcel's own transitions, naming the store. Two
    // moments matter: "out for delivery" is when a cash customer needs to know what this
    // courier will ask for, and "delivered" is when they need to know how many are still
    // coming — otherwise a partial delivery reads as the rest having gone missing.
    if (applied.changed && (subMapped === "out_for_delivery" || subMapped === "delivered")) {
      const sweep = require("./subOrderSweepService");
      const notify = subMapped === "delivered" ? sweep.notifyParcelDelivered : sweep.notifyOutForDelivery;
      // Fire-and-forget: a missed notification must never fail a status update, and this
      // path runs inside a webhook that Bosta will otherwise retry.
      Promise.resolve(notify(order, applied.sub)).catch(() => {});
    }

    return {
      changed: rolled.changed,
      from: rolled.from,
      to: rolled.to,
      sub_order_id: applied.sub?._id || null,
      sub_order_changed: applied.changed,
      // Delivery is what earns loyalty and releases a vendor's money, and both now happen
      // per parcel. The caller needs to know which parcel just landed, not only whether
      // the whole order finished.
      sub_order_delivered: applied.deliveredNow,
    };
  }

  // Legacy path: an order that predates sub-orders and was never migrated.
  const shipmentStatuses = (order.shipments || []).map((s) =>
    mapBostaStateToOrderStatus(s.bosta_status)
  );
  const derivedBase = deriveOrderStatus(shipmentStatuses, allApprovedItemsHaveShipment(order));
  // A late tracking sync must not overwrite a return that has already started: the goods
  // coming back is the newer fact about this order, not the delivery that preceded it.
  const derived = derivedBase
    ? require("./subOrderService").applyReturnOverlay(order, derivedBase)
    : derivedBase;

  if (!derived || derived === prevStatus) {
    return { changed: false, from: prevStatus, to: prevStatus };
  }

  order.status = derived;
  if (derived === "completed" && !order.delivered_at) {
    order.delivered_at = new Date();
  }

  order.history.push({
    action: derived === "completed" ? "order_auto_completed" : "order_status_changed",
    title: derived === "completed" ? "Order auto-completed" : "Order status changed",
    details: `Order moved to ${derived} (from Bosta: ${rawState || "tracking sync"}).`,
    actor_role: "system",
    actor_label: actorLabel,
    metadata: { from: prevStatus, to: derived, bosta_state: rawState || null },
    created_at: new Date(),
  });

  return { changed: true, from: prevStatus, to: derived };
}

/**
 * Merge Bosta's timeline into a shipment's stored history.
 *
 * The two sources are complementary: the polled timeline is the authoritative list of
 * milestones, while webhook entries carry detail the timeline omits (exception reasons).
 * Replacing one with the other loses information either way, so entries are matched on
 * state + minute and the richer note wins.
 *
 * @returns {Array} the merged history, oldest first
 */
function mergeTrackingHistory(existing = [], incoming = []) {
  // Two-level identity. The outer bucket (state + minute) decides "is this the same
  // moment"; the note decides "is this the same event within it". Keying on the bucket
  // alone merged two exceptions with different reasons into one; adding the note to the
  // key alone produced a duplicate whenever the timeline reported a milestone the webhook
  // had already recorded with a reason. So: distinct reasons are kept side by side, and a
  // note-less copy is dropped once any noted copy exists for that moment.
  const bucketOf = (e) => {
    const t = e.timestamp ? new Date(e.timestamp).getTime() : 0;
    const ms = Number.isNaN(t) ? 0 : t;
    return `${String(e.state || "").toLowerCase()}@${Math.floor(ms / 60000)}`;
  };
  const noteOf = (e) => String(e.notes || "").trim().toLowerCase();

  const buckets = new Map();
  for (const entry of [...existing, ...incoming]) {
    if (!entry || !entry.state) continue;
    const b = bucketOf(entry);
    if (!buckets.has(b)) buckets.set(b, new Map());
    const byNote = buckets.get(b);
    const n = noteOf(entry);
    if (!byNote.has(n)) byNote.set(n, entry);
  }

  const out = [];
  for (const byNote of buckets.values()) {
    const noted = [...byNote.entries()].filter(([n]) => n !== "");
    // A bare milestone adds nothing once the same moment is described with a reason.
    for (const [, entry] of noted.length ? noted : byNote) out.push(entry);
  }

  return out.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
}

/** True if a status is driven by Bosta (set post-dispatch; not manually editable). */
function isBostaDrivenStatus(status) {
  return BOSTA_DRIVEN_STATUSES.includes(status);
}

module.exports = {
  BOSTA_STATE_TO_ORDER_STATUS,
  BOSTA_CODE_TO_ORDER_STATUS,
  BOSTA_CODE_TO_VALUE,
  BOSTA_DRIVEN_STATUSES,
  FORWARD_ORDER,
  extractBostaState,
  extractBostaCode,
  mapBostaStateToOrderStatus,
  deriveOrderStatus,
  allApprovedItemsHaveShipment,
  applyStatusToSubOrder,
  applyBostaStatusToOrder,
  mergeTrackingHistory,
  parseBostaTimestamp,
  isBostaDrivenStatus,
};
