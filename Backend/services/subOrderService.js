/**
 * Sub-orders — the unit of FULFILMENT inside an order.
 *
 * An order stays one financial entity: one price, one payment, one coupon, one loyalty
 * snapshot, one shipping total shown at checkout. But a basket bought from three stores
 * becomes three physical parcels, collected from three pickup branches by Bosta, arriving
 * on three different days. This module owns that second reality.
 *
 * A sub-order is keyed on (vendor, pickup branch), not on vendor alone: a vendor shipping
 * from two branches produces two real parcels that Bosta collects separately and delivers
 * days apart, and a single row could not answer "delivered when?" for either.
 *
 * ── The allocation, and why it freezes ────────────────────────────────────────────────
 * Each sub-order carries its own share of shipping, coupon and loyalty, so that the sum of
 * what every courier collects equals the order total EXACTLY. Two independent facts force
 * that split to be frozen the moment the first sub-order dispatches:
 *
 *   1. Bosta exposes `createDelivery` and `terminateDelivery` and nothing else. A COD
 *      amount cannot be restated once the delivery exists.
 *   2. These figures are shown to the customer at checkout, before they pay. A number
 *      shown before payment cannot quietly change afterwards.
 *
 * So a later cancellation refunds its OWN frozen share and never re-prices its siblings.
 * Where that leaves a genuine shortfall, the store absorbs it rather than surprising the
 * customer at the door.
 */

const mongoose = require("mongoose");

/* ------------------------------------------------------------------ */
/*  Status vocabulary                                                 */
/* ------------------------------------------------------------------ */

/**
 * The stages where the vendor still owes the parcel an action, in order.
 *
 * `handed_to_courier` is deliberately NOT here even though the vendor sets it: once they
 * have confirmed the courier took the parcel they owe it nothing more, and `awaitsVendor`
 * is what decides whether a parcel is still on the vendor's plate.
 */
const VENDOR_STAGES = ["pending_review", "awaiting_tracking", "awaiting_handover", "ready_for_pickup"];

/** Statuses Bosta drives once a parcel is on its way. */
const BOSTA_DRIVEN = [
  "pickup_scheduled", "picked_up", "in_transit", "out_for_delivery",
  "delivered", "returned", "exception",
];

/** Neither alive nor progressing — excluded from the order-level rollup. */
const CLOSED_OFF_FLOW = ["cancelled"];

/**
 * Forward progression, least → most advanced, for the order-level rollup.
 *
 * `pickup_scheduled` comes BEFORE `handed_to_courier`: the admin books the visit, then the
 * courier turns up and the vendor hands the box over. A parcel that has actually been given
 * away is further along than one that merely has an appointment.
 *
 * `handed_to_courier` can also be reached straight from `ready_for_pickup`, when a courier
 * arrives before anyone booked one. Skipping a rung is normal here; the ladder only has to
 * rank the rungs, not insist every parcel touches all of them.
 */
const FORWARD_ORDER = [
  "held_in_batch",
  "pending_review", "awaiting_tracking", "awaiting_handover", "ready_for_pickup",
  "pickup_scheduled", "handed_to_courier",
  "picked_up", "in_transit", "out_for_delivery", "delivered",
];

/** Order status that corresponds to every live sub-order sitting in this one. */
const SUB_TO_ORDER_STATUS = {
  // Waiting in a company batch (feature 14): the order is placed and nothing has moved.
  held_in_batch: "pending",
  pending_review: "pending",
  awaiting_tracking: "processing",
  awaiting_handover: "processing",
  ready_for_pickup: "ready",
  // The vendor's word is enough for the ORDER to say the courier has it. That is the whole
  // point of the step: before either the vendor or Bosta says so, no screen may claim it.
  handed_to_courier: "picked_up",
  pickup_scheduled: "pickup_scheduled",
  picked_up: "picked_up",
  in_transit: "in_transit",
  out_for_delivery: "out_for_delivery",
  delivered: "completed",
  returned: "returned",
  exception: "exception",
};

/**
 * Where a parcel really is. A company-batch rider (`in_batch_parcel`) travels inside its
 * lead's box and has no journey of its own, so it reads as the lead's status — which the
 * batch service copies onto `company_batch.mirror_status`. Every other parcel is its status.
 */
const effectiveStatus = (sub) =>
  sub?.status === "in_batch_parcel" ? (sub.company_batch?.mirror_status || "awaiting_handover") : sub?.status;

/** A sub-order that has left the vendor's hands and is with Bosta. */
const isDispatched = (sub) =>
  !!sub && (!!sub.tracking_number || !!sub.bosta_tracking_number || BOSTA_DRIVEN.includes(sub.status)
    || sub.status === "in_batch_parcel");

/** Still waiting in a company batch — invisible to the vendor, no deadline running. */
const isHeldInBatch = (sub) => sub?.status === "held_in_batch";

/** A sub-order still counted as part of what the customer is owed. */
const isLive = (sub) => !!sub && !CLOSED_OFF_FLOW.includes(sub.status);

/* ------------------------------------------------------------------ */
/*  Money helpers                                                     */
/* ------------------------------------------------------------------ */

const toMinor = (amount) => Math.round(Number(amount || 0) * 100);
const toMajor = (minor) => Number((Number(minor || 0) / 100).toFixed(2));

/**
 * Split `totalMinor` across `weights` so the parts sum to `totalMinor` EXACTLY.
 *
 * Largest-remainder: floor every share, then hand the leftover units to whoever lost the
 * most to rounding. Without it a three-way split of an odd amount silently loses a piastre,
 * and the sum of what the couriers collect stops matching the order total — which is the
 * one invariant this whole feature promises the customer.
 */
const allocateExact = (totalMinor, weights) => {
  const n = weights.length;
  if (n === 0) return [];
  const total = Math.round(totalMinor);
  const sum = weights.reduce((a, b) => a + b, 0);

  if (sum <= 0) {
    const base = Math.floor(total / n);
    const out = weights.map(() => base);
    for (let i = 0; i < total - base * n; i++) out[i % n]++;
    return out;
  }

  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map((x) => Math.floor(x));
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const byFraction = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; remainder > 0; k++, remainder--) floors[byFraction[k % n].i]++;
  return floors;
};

/* ------------------------------------------------------------------ */
/*  Lookups                                                           */
/* ------------------------------------------------------------------ */

const idsEqual = (a, b) => !!a && !!b && a.toString() === b.toString();

const findSubOrder = (order, subOrderId) =>
  (order?.sub_orders || []).find((s) => idsEqual(s._id, subOrderId)) || null;

/** Every line this sub-order is responsible for, declined ones included. */
const subOrderItems = (order, subOrder) =>
  (order?.items || []).filter((i) => idsEqual(i.sub_order_id, subOrder?._id));

/**
 * The shipment this parcel is riding NOW.
 *
 * A reactivated parcel keeps its old, terminated shipment row for its history, marked
 * `superseded_at`, and gets a new one on re-dispatch — so "the shipment for this parcel" is
 * no longer simply the first row that names it. The parcel's own `shipment_id` wins; failing
 * that, the newest row that is not retired.
 */
const liveShipmentFor = (order, subOrder) => {
  const rows = (order?.shipments || []).filter((s) => idsEqual(s.sub_order_id, subOrder?._id));
  if (rows.length === 0) return null;
  if (subOrder?.shipment_id) {
    const byId = rows.find((s) => idsEqual(s._id, subOrder.shipment_id) && !s.superseded_at);
    if (byId) return byId;
  }
  const live = rows.filter((s) => !s.superseded_at);
  return live.length ? live[live.length - 1] : null;
};

/** Lines this sub-order will actually ship. */
const shippableItems = (order, subOrder) =>
  subOrderItems(order, subOrder).filter((i) => i.vendor_status === "approved");

/** All sub-orders belonging to one vendor — a vendor with two branches has two. */
const vendorSubOrders = (order, vendorId) =>
  (order?.sub_orders || []).filter((s) => idsEqual(s.vendor_id, vendorId));

/** Stable identity of the (vendor, branch) pair a line belongs to. */
const groupKey = (vendorId, location) => `${vendorId}::${location || ""}`;

const appendSubHistory = (subOrder, action, title, details = "", metadata = {}, actor = {}) => {
  subOrder.history = subOrder.history || [];
  subOrder.history.push({
    action,
    title,
    details,
    actor_role: actor.role || "system",
    actor_label: actor.label || actor.username || "System",
    metadata,
    created_at: new Date(),
  });
};

/* ------------------------------------------------------------------ */
/*  Construction                                                      */
/* ------------------------------------------------------------------ */

/**
 * Group priced items into sub-orders and stamp each item with the sub-order that will
 * fulfil it.
 *
 * The branch is read from the vendor's default location, mirroring what
 * `buildVendorSupervisionsFromItems` already does — so a vendor with one branch yields one
 * sub-order and nothing about the single-vendor case changes.
 *
 * @param {Array} pricedItems  mutated: each gains `sub_order_key`
 * @param {Map}   vendorMap    vendorId → vendor doc (for the default location)
 * @param {string} orderReference  used to mint REF-XXXX-1, -2, …
 * @returns {Array} sub-order sub-documents, ready to assign to `order.sub_orders`
 */
const buildSubOrdersFromItems = (pricedItems = [], vendorMap = new Map(), orderReference = "") => {
  const groups = new Map();

  for (const item of pricedItems) {
    const vendorId = item.vendor_id?.toString();
    if (!vendorId) continue;

    const vendor = vendorMap.get(vendorId);
    const location = vendor?.locations?.find((l) => l.is_default)?.address
      || vendor?.locations?.[0]?.address
      || "";
    const key = groupKey(vendorId, location);

    if (!groups.has(key)) {
      groups.set(key, {
        _id: new mongoose.Types.ObjectId(),
        vendor_id: vendorId,
        fulfillment_location: location,
        merchandise_total: 0,
        commission_total: 0,
      });
    }

    const group = groups.get(key);
    group.merchandise_total += Number(item.line_total || 0);
    group.commission_total += Number(item.commission_amount || 0);
    item.sub_order_key = key;
  }

  const subOrders = [...groups.values()].map((g, index) => ({
    _id: g._id,
    reference: orderReference ? `${orderReference}-${index + 1}` : "",
    vendor_id: g.vendor_id,
    fulfillment_location: g.fulfillment_location,
    status: "pending_review",
    merchandise_total: Number(g.merchandise_total.toFixed(2)),
    commission_total: Number(g.commission_total.toFixed(2)),
    created_at: new Date(),
    history: [{
      action: "sub_order_created",
      title: "Parcel created",
      details: `Assigned to ${g.fulfillment_location || "the vendor's default branch"}.`,
      actor_role: "system",
      actor_label: "System",
      created_at: new Date(),
    }],
  }));

  // Second pass: turn the grouping key on each item into the real sub-order id.
  const idByKey = new Map([...groups.entries()].map(([key, g]) => [key, g._id]));
  for (const item of pricedItems) {
    if (item.sub_order_key) {
      item.sub_order_id = idByKey.get(item.sub_order_key);
      delete item.sub_order_key;
    }
  }

  return subOrders;
};

/**
 * Attach an item to a sub-order for the given (vendor, branch), creating one if the pair
 * has none yet. This is the path an admin takes when replacing a declined item with a
 * product from ANOTHER vendor: the line leaves one parcel and joins — or opens — another.
 *
 * A vendor whose existing sub-order has already dispatched gets a NEW one rather than
 * having the live parcel reopened; that parcel is already labelled and its COD is fixed
 * at Bosta.
 *
 * @returns {Object} the sub-order the item now belongs to
 */
const attachItemToSubOrder = (order, item, { vendorId, location = "", actor = {} } = {}) => {
  const target = (order.sub_orders || []).find(
    (s) =>
      idsEqual(s.vendor_id, vendorId) &&
      (s.fulfillment_location || "") === (location || "") &&
      !isDispatched(s) &&
      s.status !== "cancelled"
  );

  if (target) {
    item.sub_order_id = target._id;
    // A new line is unreviewed by definition, so the parcel goes back to stage 1.
    if (target.status !== "needs_admin") target.status = "pending_review";
    appendSubHistory(
      target, "item_added", "Item added to this parcel",
      `${item.product_title} was added and needs the vendor's confirmation.`,
      { item_id: item._id?.toString() }, actor
    );
    return target;
  }

  const index = (order.sub_orders || []).length + 1;
  const baseRef = order.transaction?.reference || order._id?.toString() || "";
  const created = {
    _id: new mongoose.Types.ObjectId(),
    reference: baseRef ? `${baseRef}-${index}` : "",
    vendor_id: vendorId,
    fulfillment_location: location,
    status: "pending_review",
    merchandise_total: 0,
    commission_total: 0,
    created_at: new Date(),
    history: [{
      action: "sub_order_created",
      title: "Parcel created",
      details: "Opened for a replacement item sourced from this vendor.",
      actor_role: actor.role || "admin",
      actor_label: actor.label || "Admin",
      created_at: new Date(),
    }],
  };
  order.sub_orders.push(created);
  const stored = order.sub_orders[order.sub_orders.length - 1];
  item.sub_order_id = stored._id;
  return stored;
};

/* ------------------------------------------------------------------ */
/*  Allocation                                                        */
/* ------------------------------------------------------------------ */

/**
 * Re-derive every sub-order's money from the order's current contents.
 *
 * Runs at placement and after any admin edit — but NEVER after the allocation freezes,
 * because by then a COD is live at Bosta and a figure has been shown to the customer.
 *
 * The identity it guarantees:
 *     Σ sub_order.cod_amount === order.total_price
 *
 * Shipping comes from `order.shipping.per_vendor[]`, which is per VENDOR. A vendor with two
 * branches has their leg split across those branches in proportion to merchandise — the
 * engine prices a vendor's shipping as one leg, and there is no finer figure to use.
 *
 * @returns {boolean} true if amounts were written, false if the freeze blocked it
 */
const allocate = (order) => {
  if (!order || !Array.isArray(order.sub_orders) || order.sub_orders.length === 0) return false;
  if (order.allocation_frozen) return false;

  const live = order.sub_orders.filter(isLive);
  if (live.length === 0) return false;

  // ---- Merchandise per sub-order, straight from its lines ----
  const merchMinor = live.map((sub) =>
    subOrderItems(order, sub).reduce(
      (sum, i) => sum + toMinor(Number(i.unit_price || 0) * Number(i.quantity || 0)),
      0
    )
  );
  const commissionMinor = live.map((sub) =>
    subOrderItems(order, sub).reduce((sum, i) => sum + toMinor(i.commission_amount), 0)
  );
  const merchTotalMinor = merchMinor.reduce((a, b) => a + b, 0);

  // ---- Shipping: per-vendor leg, sub-split across that vendor's branches ----
  const shippingEnabled = order.shipping?.enabled !== false;
  const shippingTotalMinor = shippingEnabled ? toMinor(order.shipping?.total_cost) : 0;
  const perVendor = new Map(
    (order.shipping?.per_vendor || []).map((pv) => [String(pv.vendor_id), toMinor(pv.cost)])
  );

  let shippingMinor;
  if (perVendor.size > 0 && shippingEnabled) {
    shippingMinor = new Array(live.length).fill(0);
    // Group the live sub-orders by vendor, then split each vendor's leg across them.
    const byVendor = new Map();
    live.forEach((sub, i) => {
      const key = String(sub.vendor_id);
      if (!byVendor.has(key)) byVendor.set(key, []);
      byVendor.get(key).push(i);
    });
    for (const [vendorKey, indexes] of byVendor) {
      const legMinor = perVendor.get(vendorKey) || 0;
      const shares = allocateExact(legMinor, indexes.map((i) => merchMinor[i]));
      indexes.forEach((i, k) => { shippingMinor[i] = shares[k]; });
    }
    // A vendor present in the order but missing from `per_vendor` contributes nothing, so
    // the legs can fall short of the quoted total. Spread the gap rather than lose it.
    const allocated = shippingMinor.reduce((a, b) => a + b, 0);
    const gap = shippingTotalMinor - allocated;
    if (gap !== 0) {
      const fill = allocateExact(Math.abs(gap), merchMinor);
      shippingMinor = shippingMinor.map((v, i) => v + Math.sign(gap) * fill[i]);
    }
  } else {
    shippingMinor = allocateExact(shippingTotalMinor, merchMinor);
  }

  // ---- Coupon: proportional to merchandise ----
  const couponMinor = allocateExact(toMinor(order.coupon_discount_amount), merchMinor);

  // ---- Who funded it: the vendor's percentage of each parcel's coupon, the rest ours ----
  // Rounded per parcel, and the rounding always falls on the platform so a vendor is never
  // charged a piastre more than the percentage says. Identity per parcel:
  //     coupon_vendor_share + coupon_platform_share === coupon_share
  const vendorPct = Math.min(100, Math.max(0, Number(order.coupon_vendor_share_percent || 0)));
  const couponVendorMinor = couponMinor.map((c) => Math.floor((c * vendorPct) / 100));
  const couponPlatformMinor = couponMinor.map((c, i) => c - couponVendorMinor[i]);

  // ---- Loyalty: proportional to POST-COUPON merchandise ----
  // Points bought down what was left after the coupon, so that is the base they spread
  // over. Clamped to the order's merchandise so a shrunken order cannot end up with a
  // discount larger than the goods it still contains.
  const postCoupon = merchMinor.map((m, i) => Math.max(0, m - couponMinor[i]));
  const loyaltyRequested = toMinor(order.loyalty?.redemption_discount);
  const loyaltyTotalMinor = Math.min(loyaltyRequested, postCoupon.reduce((a, b) => a + b, 0));
  const loyaltyMinor = allocateExact(loyaltyTotalMinor, postCoupon);

  // ---- COD, then a final correction so the parts sum to the order total exactly ----
  const codMinor = live.map((_, i) =>
    Math.max(0, merchMinor[i] + shippingMinor[i] - couponMinor[i] - loyaltyMinor[i])
  );
  const orderTotalMinor = toMinor(order.total_price);
  const drift = orderTotalMinor - codMinor.reduce((a, b) => a + b, 0);
  if (drift !== 0) {
    // Clamping a sub-order's COD at zero is the only thing that can produce drift here.
    // Put the difference on the largest parcel, where it is proportionally smallest.
    let biggest = 0;
    for (let i = 1; i < codMinor.length; i++) if (codMinor[i] > codMinor[biggest]) biggest = i;
    codMinor[biggest] = Math.max(0, codMinor[biggest] + drift);
  }

  live.forEach((sub, i) => {
    sub.merchandise_total = toMajor(merchMinor[i]);
    sub.commission_total = toMajor(commissionMinor[i]);
    sub.shipping_share = toMajor(shippingMinor[i]);
    sub.coupon_share = toMajor(couponMinor[i]);
    sub.coupon_vendor_share = toMajor(couponVendorMinor[i]);
    sub.coupon_platform_share = toMajor(couponPlatformMinor[i]);
    sub.loyalty_share = toMajor(loyaltyMinor[i]);
    sub.cod_amount = toMajor(codMinor[i]);
  });

  return true;
};

/**
 * The parcel breakdown for a checkout that has not been placed yet.
 *
 * Deliberately routed through the SAME `buildSubOrdersFromItems` + `allocate` pair the real
 * order uses, rather than a parallel calculation for display. The figures shown to the
 * customer before they pay are the figures frozen at dispatch and sent to Bosta as each
 * parcel's COD — a second implementation would eventually disagree with the first, and the
 * customer would be the one to find out.
 *
 * @returns {{ parcel_count: number, parcels: Array }}
 */
const previewSubOrders = ({
  pricedItems = [],
  vendorMap = new Map(),
  shippingSnapshot = null,
  couponDiscount = 0,
  couponVendorSharePercent = 0,
  loyaltyDiscount = 0,
  total = 0,
}) => {
  const items = pricedItems.map((i) => ({ ...i }));
  const subs = buildSubOrdersFromItems(items, vendorMap, "");

  const draft = {
    items,
    sub_orders: subs,
    shipping: shippingSnapshot,
    coupon_discount_amount: couponDiscount,
    coupon_vendor_share_percent: couponVendorSharePercent,
    loyalty: { redemption_discount: loyaltyDiscount },
    total_price: total,
    allocation_frozen: false,
  };
  allocate(draft);

  return {
    parcel_count: subs.length,
    parcels: subs.map((sub) => {
      const vendor = vendorMap.get(String(sub.vendor_id));
      return {
        vendor_id: sub.vendor_id,
        vendor_name: vendor?.store_name || vendor?.store_username || "",
        fulfillment_location: sub.fulfillment_location,
        item_count: items.filter((i) => idsEqual(i.sub_order_id, sub._id)).length,
        merchandise_total: sub.merchandise_total,
        shipping_share: sub.shipping_share,
        coupon_share: sub.coupon_share,
        coupon_vendor_share: sub.coupon_vendor_share,
        coupon_platform_share: sub.coupon_platform_share,
        loyalty_share: sub.loyalty_share,
        // What this parcel's courier will ask for on a cash order.
        cod_amount: sub.cod_amount,
      };
    }),
  };
};

/**
 * Fix the split. Called the instant the first sub-order dispatches to Bosta.
 *
 * After this the admin may no longer edit the order's contents — only cancel a sub-order —
 * because every remaining figure is either live at Bosta or already promised to the
 * customer.
 */
const freezeAllocation = (order, actor = {}) => {
  if (order.allocation_frozen) return false;
  order.allocation_frozen = true;
  order.allocation_frozen_at = new Date();
  for (const sub of order.sub_orders || []) {
    if (isLive(sub)) sub.allocation_frozen_at = order.allocation_frozen_at;
  }
  order.history = order.history || [];
  order.history.push({
    action: "allocation_frozen",
    title: "Order amounts locked",
    details:
      "The first parcel was sent to Bosta, so each parcel's amount is now fixed. " +
      "Items can no longer be changed; a parcel can still be cancelled.",
    actor_role: actor.role || "system",
    actor_label: actor.label || "System",
    metadata: { frozen_at: order.allocation_frozen_at },
    created_at: new Date(),
  });
  return true;
};

/** The reason an edit is refused, or null when editing is still allowed. */
const editBlockedReason = (order) => {
  if (order?.allocation_frozen) {
    return "This order's amounts were locked when its first parcel was sent to Bosta. " +
      "Items can no longer be changed — cancel the parcel instead.";
  }
  return null;
};

/* ------------------------------------------------------------------ */
/*  Order-level rollup                                                */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Returns — the journey back                                        */
/* ------------------------------------------------------------------ */

/**
 * The item return_status values that mean the goods are no longer with the customer.
 * `refunded` counts as returned: the money followed the goods, it did not replace them.
 */
const RETURNED_ITEM_STATUSES = ["returned", "refunded"];
/** A return that is agreed or moving, but not finished. */
const OPEN_RETURN_STATUSES = ["return_requested", "return_approved", "return_in_progress"];

/**
 * What has come back out of a set of items, as one word.
 *
 * Read from the items rather than stored, for the same reason the order's status is read
 * from its parcels: the item `return_status` is written at every step of the return
 * already, so anything stored beside it could only ever disagree with it.
 *
 * The active steps win over the settled ones. An order with one line refunded last week and
 * another collected this morning is best described by the thing that is still happening —
 * and when that settles, the description falls back to the partial.
 */
const deriveReturnState = (items = []) => {
  const relevant = items.filter((i) => i && i.return_status && i.return_status !== "none");
  if (relevant.length === 0) return { key: "none", returned: 0, total: items.length };

  const returned = items.filter((i) => RETURNED_ITEM_STATUSES.includes(i.return_status)).length;
  const refunded = items.filter((i) => i.return_status === "refunded").length;
  const counts = { returned, total: items.length };

  // Still travelling back, or agreed and not yet shipped: something is in motion.
  if (relevant.some((i) => i.return_status === "return_in_progress")) {
    return { key: "return_in_progress", ...counts };
  }
  if (relevant.some((i) => ["return_requested", "return_approved"].includes(i.return_status))) {
    return { key: "return_requested", ...counts };
  }

  // Nothing in motion: describe what actually came back.
  if (returned === items.length && items.length > 0) {
    return { key: refunded === items.length ? "refunded" : "returned", ...counts };
  }
  if (returned > 0) return { key: "partially_returned", ...counts };

  return { key: "none", ...counts };
};

/** The return state of one parcel, from the items that shipped in it. */
const subOrderReturnState = (order, sub) => deriveReturnState(subOrderItems(order, sub));

/** The return state of the whole order, across every parcel that is still part of it. */
const orderReturnState = (order) => {
  const liveSubIds = new Set((order?.sub_orders || []).filter(isLive).map((s) => String(s._id)));
  const items = (order?.items || []).filter(
    // Items on a cancelled parcel were never delivered, so they cannot have come back.
    (i) => !i.sub_order_id || liveSubIds.has(String(i.sub_order_id))
  );
  return deriveReturnState(items);
};

/** Return states that replace the order's headline status outright. */
const RETURN_OVERLAY_STATUSES = [
  "return_requested", "return_in_progress", "partially_returned", "returned", "refunded",
];

/** Statuses that mean every parcel still part of the order has arrived. */
const SETTLED_DELIVERED = ["completed", "partially_cancelled"];

/**
 * Replace a finished order's status with what is coming back, when something is.
 *
 * Forward only: it never restores a status, because every caller derives its base fresh
 * from the parcels or the shipments, so a cancelled return simply stops matching here and
 * the base wins on its own.
 */
const applyReturnOverlay = (order, baseStatus) => {
  if (!SETTLED_DELIVERED.includes(baseStatus)) return baseStatus;
  const ret = orderReturnState(order);
  return RETURN_OVERLAY_STATUSES.includes(ret.key) ? ret.key : baseStatus;
};

/**
 * Order statuses that all mean "the customer received this".
 *
 * A return does not undo the delivery — it is a later event with its own reversal handling
 * for earnings and loyalty. Anything that queries for delivered orders must therefore match
 * this whole list, or a return would quietly drop the order out of figures it belongs in.
 */
/**
 * Where a parcel physically is, for the money-in-flight report.
 *
 * The split point is `handed_to_courier`, and it is the vendor's own word that a courier
 * took the parcel — see the comment on the status list in models/orders.js. Anything before
 * it means the goods are STILL IN THE STORE, and anything from it onward means they have
 * left, even though Bosta has not confirmed the collection yet. That is the boundary the
 * question "is it still with the vendor?" actually asks about.
 *
 * `needs_admin` sits with the vendor: an item was declined or the vendor went unavailable,
 * and nothing has moved. `exception` sits in transit: the parcel is out there and Bosta has
 * a problem with it, which is still money on the road and not money in the store.
 *
 * `delivered`, `returned` and `cancelled` are in neither: they have arrived somewhere and
 * stopped being in flight.
 */
const AT_VENDOR_STATUSES = [
  "pending_review",
  "awaiting_tracking",
  "awaiting_handover",
  "ready_for_pickup",
  "needs_admin",
];

const IN_TRANSIT_STATUSES = [
  "handed_to_courier",
  "pickup_scheduled",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "exception",
];

const DELIVERED_ORDER_STATUSES = ["completed", ...RETURN_OVERLAY_STATUSES];

/**
 * Derive the order's headline status from its sub-orders.
 *
 * Cancelled sub-orders are excluded rather than allowed to poison the rollup — an order
 * whose second parcel was cancelled is still progressing on its first. `exception` and
 * `returned` are likewise isolated to their own parcel: they surface on the order only
 * when nothing else is still moving, so one troubled parcel cannot make a healthy order
 * look stuck.
 *
 * @returns {{ status: string, delivered: number, total: number }}
 */
const deriveOrderStatus = (order) => {
  const subs = order?.sub_orders || [];
  if (subs.length === 0) {
    // Orders placed before the parcel split have no sub-orders, but they still have items,
    // and those items still record a return. Without this an old order would go on calling
    // itself completed after the customer sent it back.
    const base = order?.status || "pending";
    const overlaid = applyReturnOverlay(order, base);
    if (overlaid !== base) return { status: overlaid, delivered: 0, total: 0 };
    const ret = orderReturnState(order);
    // Undo the overlay when the return is cancelled or rejected. `returned` is deliberately
    // excluded: Bosta produces that one too on these old orders, and reverting it would
    // overwrite a real failed delivery.
    const REVERSIBLE = RETURN_OVERLAY_STATUSES.filter((k) => k !== "returned");
    if (REVERSIBLE.includes(base) && ret.key === "none") {
      return { status: "completed", delivered: 0, total: 0 };
    }
    return { status: base, delivered: 0, total: 0 };
  }

  const live = subs.filter(isLive);
  const delivered = live.filter((s) => s.status === "delivered").length;

  // Everything cancelled → the order is cancelled. Some cancelled and something delivered
  // → partially cancelled, which is what an admin cancelling an order mid-flight leaves.
  if (live.length === 0) {
    return { status: "cancelled", delivered: 0, total: subs.length };
  }

  const counts = { total: live.length, delivered };
  const cancelledSome = subs.length > live.length;

  if (delivered === live.length) {
    // Everything still part of this order has arrived, so a return can now describe the
    // order as a whole. Before this point something is still on its way, and that is the
    // more important fact about the order — the return shows on its own parcel instead.
    const base = cancelledSome ? "partially_cancelled" : "completed";
    return { status: applyReturnOverlay(order, base), delivered, total: live.length };
  }

  // A parcel already in the customer's hands, with others still moving.
  if (delivered > 0) return { status: "partially_delivered", delivered, total: live.length };

  // Nothing delivered yet. If every live parcel agrees on a status, show it; the mixed
  // case is what `partially_shipped` exists for.
  const statuses = live.map(effectiveStatus);
  const distinct = [...new Set(statuses)];
  if (distinct.length === 1) {
    const mapped = SUB_TO_ORDER_STATUS[distinct[0]];
    if (mapped) return { status: mapped, delivered, total: live.length };
    // needs_admin has no order-level equivalent — the order is simply still being prepared.
    return { status: "processing", delivered, total: live.length };
  }

  const anyDispatched = live.some(isDispatched);
  if (anyDispatched) return { status: "partially_shipped", delivered, total: live.length };

  // All still pre-dispatch and disagreeing: reflect the least-advanced one, so the order
  // never claims to be further along than its slowest parcel.
  let minIdx = FORWARD_ORDER.length;
  for (const s of statuses) {
    const idx = FORWARD_ORDER.indexOf(s);
    if (idx !== -1 && idx < minIdx) minIdx = idx;
  }
  const least = FORWARD_ORDER[minIdx] || "pending_review";
  return { status: SUB_TO_ORDER_STATUS[least] || "processing", delivered, total: live.length };
};

/**
 * Recompute and write `order.status` from the sub-orders, recording the change.
 * Mutates in memory; the caller saves.
 * @returns {{ changed: boolean, from: string, to: string, delivered: number, total: number }}
 */
const syncOrderStatus = (order, actorLabel = "System") => {
  const from = order.status;
  const { status, delivered, total } = deriveOrderStatus(order);

  if (status === "completed" && !order.delivered_at) order.delivered_at = new Date();
  if (status === from) return { changed: false, from, to: from, delivered, total };

  order.status = status;
  order.history = order.history || [];
  order.history.push({
    action: status === "completed" ? "order_auto_completed" : "order_status_changed",
    title: status === "completed" ? "Order completed" : "Order status changed",
    details: `Order moved to ${status} (${delivered} of ${total} parcels delivered).`,
    actor_role: "system",
    actor_label: actorLabel,
    metadata: { from, to: status, delivered, total },
    created_at: new Date(),
  });
  return { changed: true, from, to: status, delivered, total };
};

/* ------------------------------------------------------------------ */
/*  Deadlines                                                         */
/* ------------------------------------------------------------------ */

/** Stamp the vendor's deadline on every sub-order that does not have one yet. */
const applyDeadlines = (order, deadlineHours = 48) => {
  const base = order.created_at ? new Date(order.created_at) : new Date();
  const due = new Date(base.getTime() + Number(deadlineHours || 48) * 3600 * 1000);
  for (const sub of order.sub_orders || []) {
    // A parcel waiting in a company batch is not the vendor's yet; its clock starts when
    // the batch releases it (companyBatchService).
    if (!sub.deadline_at && sub.status !== "held_in_batch") sub.deadline_at = due;
  }
};

/** True while the vendor still owes this parcel an action. */
const awaitsVendor = (sub) => VENDOR_STAGES.includes(sub?.status);

/* ------------------------------------------------------------------ */
/*  Cancellation window                                               */
/* ------------------------------------------------------------------ */

/**
 * Whether this parcel may still be cancelled, and why not when it may not.
 *
 * The line is the pickup booking, not the Bosta dispatch: up to that point nothing has been
 * promised to a courier, so cancelling costs only an API call. Once a pickup exists a
 * driver is committed to collecting it, and the option disappears for the vendor AND the
 * customer alike.
 */
/**
 * May this parcel still be cancelled, and if not, why.
 *
 * The window closes when the COURIER HAS THE BOX — the vendor pressing "handed to courier",
 * or Bosta scanning it — and not before. A booked pickup does not close it: until the
 * courier actually arrives the parcel is still on the vendor's counter, the delivery can
 * still be terminated at Bosta, and the customer's "I changed my mind" costs nobody a trip.
 * It used to close at booking, which turned a customer who cancelled the morning of the
 * pickup into a support ticket and a courier sent for a box nobody wanted.
 *
 * Both languages, because the customer reads this on their order and the vendor on theirs.
 */
const cancellability = (sub) => {
  if (!sub) return { allowed: false, reason: "Parcel not found", reason_ar: "الطرد غير موجود" };
  if (sub.status === "cancelled") {
    return { allowed: false, reason: "This parcel is already cancelled", reason_ar: "الطرد ده ملغي بالفعل" };
  }
  // Company consolidation: once the batch's combined parcel has a courier delivery, every
  // order inside it is sealed in one box with colleagues' orders. Pulling one out means
  // re-opening that box at the store, so it is no longer something a click can do — the
  // order comes back as a return after delivery instead.
  if (sub.status === "in_batch_parcel" || (sub.company_batch?.role === "lead" && sub.company_batch?.dispatched_at)) {
    return {
      allowed: false,
      reason: "This order is packed in a combined parcel with colleagues' orders — contact the website team, or request a return after delivery",
      reason_ar: "الأوردر ده متغلّف في طرد مجمّع مع أوردرات زمايلك — كلّم فريق الموقع، أو اطلب إرجاع بعد الاستلام",
    };
  }
  if (sub.status === "delivered") {
    return {
      allowed: false,
      reason: "This parcel has already been delivered — request a return instead",
      reason_ar: "الطرد ده اتسلم بالفعل — اطلب إرجاع بدل الإلغاء",
    };
  }
  // Arrive charges the full delivery fee for a cancellation once it holds the shipment, and
  // has no cancel API — so for an Arrive parcel the window closes at dispatch, not at pickup.
  if ((sub.courier === "arrive" || (sub.tracking_number && !sub.bosta_tracking_number)) && sub.tracking_number) {
    return {
      allowed: false,
      reason: "This parcel is already with Arrive — contact the website team to cancel it",
      reason_ar: "الطرد ده مع شركة Arrive بالفعل — كلّم فريق الموقع عشان يلغيه",
    };
  }
  if (["handed_to_courier", "picked_up", "in_transit", "out_for_delivery", "returned"].includes(sub.status)) {
    return {
      allowed: false,
      reason: "The courier has already collected this parcel",
      reason_ar: "المندوب استلم الطرد ده بالفعل",
    };
  }
  return { allowed: true, reason: null, reason_ar: null };
};

/* ------------------------------------------------------------------ */
/*  Presentation                                                      */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  The journey                                                       */
/* ------------------------------------------------------------------ */

/**
 * Every rung of a parcel's journey, in order, with where it actually is right now.
 *
 * Built on the SERVER, not in each screen, because the vendor's view and the customer's view
 * must never disagree about where a parcel is — two hand-written ladders drift the first time
 * a status is added, and the last three months of this codebase are largely that lesson.
 *
 * `owner` says WHOSE step each rung is, which is the difference between "the shop has not
 * packed it yet" and "the courier has not moved it yet". Customers ask that question
 * constantly and a bare status word never answers it.
 *
 * Off-flow endings (`cancelled`, `returned`, `exception`, `needs_admin`) are not rungs — a
 * parcel does not pass THROUGH them on the way to delivery, it stops at them. They are
 * returned separately as `ending`, so a screen can show the ladder frozen where it stopped
 * with the ending stated beside it, rather than pretending the parcel is still climbing.
 *
 * @returns {{ steps: Array, ending: object|null, current_index: number }}
 */
const JOURNEY_LADDER = [
  { key: "pending_review", owner: "vendor", at: (sub) => sub.company_batch?.released_at || sub.created_at },
  { key: "awaiting_tracking", owner: "vendor", at: (sub) => sub.items_confirmed_at },
  { key: "awaiting_handover", owner: "vendor", at: (sub) => sub.tracking_assigned_at },
  { key: "ready_for_pickup", owner: "vendor", at: (sub) => sub.ready_at },
  { key: "pickup_scheduled", owner: "platform", at: (sub) => sub.pickup_booked_at },
  { key: "handed_to_courier", owner: "vendor", at: (sub) => sub.handed_over_at },
  { key: "picked_up", owner: "bosta", at: () => null },
  { key: "in_transit", owner: "bosta", at: () => null },
  { key: "out_for_delivery", owner: "bosta", at: () => null },
  { key: "delivered", owner: "bosta", at: (sub) => sub.delivered_at },
];

/** The off-flow endings, and whether each one means the parcel stopped for a bad reason. */
const JOURNEY_ENDINGS = {
  cancelled: { at: (sub) => sub.cancelled_at, tone: "closed" },
  returned: { at: () => null, tone: "problem" },
  exception: { at: () => null, tone: "problem" },
  needs_admin: { at: (sub) => sub.needs_admin_since, tone: "problem" },
};

/**
 * A company-consolidation parcel has one more rung before the vendor sees it: the wait in
 * the batch. Only those parcels get it, so every other ladder stays exactly as it was.
 */
const BATCH_RUNG = { key: "held_in_batch", owner: "platform", at: (sub) => sub.company_batch?.joined_at || sub.created_at };
const ladderFor = (sub) => (sub?.company_batch?.joined_at ? [BATCH_RUNG, ...JOURNEY_LADDER] : JOURNEY_LADDER);

const buildJourney = (order, sub) => {
  const status = effectiveStatus(sub);
  const LADDER = ladderFor(sub);
  const ending = JOURNEY_ENDINGS[status]
    ? {
        key: status,
        at: JOURNEY_ENDINGS[status].at(sub) || null,
        tone: JOURNEY_ENDINGS[status].tone,
        reason: sub.cancel_reason || sub.needs_admin_reason || "",
      }
    : null;

  // Where on the ladder the parcel is, or where it had got to before it stopped.
  let currentIndex;
  if (ending) {
    // A parcel parked off-flow keeps the rungs it genuinely climbed — those things really
    // happened. Reconstructed from the timestamps, which are written as each rung is reached
    // and are not erased by the parcel later going off-flow. `needs_admin` strikes during
    // review, before any of the later stamps exist, which is why this can land on 0.
    currentIndex = 0;
    LADDER.forEach((rung, i) => { if (rung.at(sub)) currentIndex = i; });
  } else {
    currentIndex = LADDER.findIndex((r) => r.key === status);
    if (currentIndex < 0) currentIndex = 0;
  }

  // Bosta's own event times for the rungs it drives. The shipment's tracking history is the
  // only place they exist — the sub-order stores no timestamp for "in transit".
  const shipment = liveShipmentFor(order, sub);
  const bostaAt = new Map();
  for (const entry of shipment?.tracking_history || []) {
    const mapped = require("./bostaStatusMap").mapBostaStateToOrderStatus(entry.state);
    const key = mapped === "completed" ? "delivered" : mapped;
    // First occurrence wins: a parcel that goes out for delivery twice reached that rung
    // the first time.
    if (key && !bostaAt.has(key) && entry.timestamp) bostaAt.set(key, entry.timestamp);
  }

  const steps = LADDER.map((rung, i) => {
    const at = rung.at(sub) || bostaAt.get(rung.key) || null;
    let state;
    if (i < currentIndex) {
      // Reached-and-passed. A rung with no timestamp was genuinely skipped — a courier who
      // turned up unbooked really does mean no appointment was ever made — and saying
      // "skipped" is more honest than drawing a tick over something that never happened.
      state = at ? "done" : "skipped";
    } else if (i === currentIndex) {
      // Delivered is the end of the ladder, not a place the parcel is waiting — it earns a
      // tick like every other rung it climbed rather than a "you are here".
      state = ending ? "stopped" : status === "delivered" ? "done" : "current";
    } else {
      state = "todo";
    }
    // `owner: "bosta"` on the ladder means "the courier drives this rung", not that Bosta
    // does — so it is resolved to the courier this parcel is actually riding. Left as the
    // literal it was, every Arrive parcel's journey was badged "بوسطة" to the customer.
    const owner = rung.owner === "bosta"
      ? require("./couriers").providerOfShipment(shipment) || rung.owner
      : rung.owner;
    return { key: rung.key, owner, state, at };
  });

  return { steps, ending, current_index: currentIndex };
};

/**
 * The same journey, told to the CUSTOMER, for the order as a whole.
 *
 * Two things make it different from the parcel ladder above, and both are deliberate.
 *
 * FEWER RUNGS. Ten steps is the fulfilment pipeline; a customer's question is "where is my
 * stuff?". `awaiting_tracking` ("a waybill still has to be attached") is a conversation
 * between us and the store. And `handed_to_courier` vs `picked_up` — the store's word
 * against Bosta's scan — is a distinction WE need in order not to lie about where a parcel
 * is; to the buyer both mean the courier has it. So the ten collapse into seven.
 *
 * THE ORDER SITS AT ITS SLOWEST PARCEL. A basket from three stores has three parcels in
 * three places, and there is no honest single position other than the one furthest behind:
 * the order is not delivered until the last box arrives. A step is only marked done once
 * EVERY live parcel has passed it, and its timestamp is the last parcel to do so — the
 * moment the whole order really reached that point, not the moment the quickest parcel did.
 *
 * Cancelled parcels are excluded from the rollup: a basket where one store dropped out is
 * still tracked by the parcels that are actually coming.
 */
const CUSTOMER_LADDER = [
  // A parcel waiting in a company batch has been placed and nothing more.
  { key: "placed", from: ["held_in_batch"] },
  { key: "preparing", from: ["pending_review", "awaiting_tracking", "awaiting_handover"] },
  { key: "ready", from: ["ready_for_pickup", "pickup_scheduled"] },
  { key: "with_courier", from: ["handed_to_courier", "picked_up"] },
  { key: "in_transit", from: ["in_transit"] },
  { key: "out_for_delivery", from: ["out_for_delivery"] },
  { key: "delivered", from: ["delivered"] },
];

/** Which customer rung a parcel rung rolls up into. */
const CUSTOMER_INDEX_OF = (() => {
  const map = new Map();
  CUSTOMER_LADDER.forEach((rung, i) => rung.from.forEach((k) => map.set(k, i)));
  return map;
})();

/** Order-level endings, in the order they win when more than one could apply. */
const ORDER_ENDINGS = ["cancelled", "returned", "exception", "refunded", "partially_cancelled"];

const buildOrderJourney = (order) => {
  const all = order?.sub_orders || [];
  // Cancelled parcels are excluded so a dropped store cannot hold the order back — UNLESS
  // every parcel was cancelled, in which case they are all there is, and the ladder should
  // show how far the order actually got before it was called off rather than nothing at all.
  const live = all.filter(isLive);
  const subs = live.length > 0 ? live : all;

  // Legacy orders placed before parcels existed have nothing to roll up. Returning null
  // rather than a ladder of blanks lets the screen simply not draw one.
  if (subs.length === 0) return null;

  // Each parcel's position and timestamps, expressed on the customer's seven rungs.
  const perParcel = subs.map((sub) => {
    const { steps, ending } = buildJourney(order, sub);
    const at = new Array(CUSTOMER_LADDER.length).fill(null);
    at[0] = order.created_at || null;
    let index = 0;

    for (const step of steps) {
      const ci = CUSTOMER_INDEX_OF.get(step.key);
      if (ci === undefined) continue;
      // First rung of the group to carry a time is when the parcel entered that group.
      if (step.at && !at[ci]) at[ci] = step.at;
      if (step.state === "done" || step.state === "skipped") index = Math.max(index, ci);
      if (step.state === "current" || step.state === "stopped") index = Math.max(index, ci);
    }
    return { at, index, ending };
  });

  // The slowest parcel decides where the ORDER is.
  const currentIndex = perParcel.reduce((min, p) => Math.min(min, p.index), CUSTOMER_LADDER.length - 1);

  const orderStatus = order?.status;
  const ending = ORDER_ENDINGS.includes(orderStatus)
    ? { key: orderStatus, at: null, tone: orderStatus === "cancelled" ? "closed" : "problem", reason: "" }
    : null;

  // Everything that is still coming has arrived. An order in this state DID finish its
  // journey, so the last rung earns its tick even when an ending is also being shown — a
  // basket where one store dropped out still delivered everything else, and marking that
  // final step with a cross would be telling the customer their parcels never came.
  const allDelivered = perParcel.every((p) => p.index === CUSTOMER_LADDER.length - 1);

  const steps = CUSTOMER_LADDER.map((rung, i) => {
    // Reached only when every live parcel has passed it, and dated by the last one to do so
    // — the moment the ORDER got there, not the moment its quickest parcel did.
    const everyone = perParcel.every((p) => p.index >= i);
    const times = perParcel.map((p) => p.at[i]).filter(Boolean);
    const at = everyone && times.length === perParcel.length
      ? new Date(Math.max(...times.map((t) => new Date(t).getTime())))
      : null;

    let state;
    if (i < currentIndex) state = at ? "done" : "skipped";
    else if (i === currentIndex) {
      if (ending && !allDelivered) state = "stopped";
      else state = i === CUSTOMER_LADDER.length - 1 ? "done" : "current";
    } else state = "todo";

    return { key: rung.key, owner: "order", state, at };
  });

  return { steps, ending, current_index: currentIndex };
};

/**
 * The shape every screen reads — customer card, vendor stepper, admin panel.
 * `include` decides how much of it the caller is allowed to see; commission and the
 * vendor's cost never reach a customer.
 */
const toPublicSubOrder = (order, sub, { audience = "customer", vendor = null } = {}) => {
  const items = subOrderItems(order, sub);
  const shipment = liveShipmentFor(order, sub);

  const base = {
    _id: sub._id,
    reference: sub.reference,
    // Where the parcel really is: a company-batch rider reads as its lead (see
    // `effectiveStatus`), so no screen needs to know the batch exists to label it.
    status: effectiveStatus(sub),
    raw_status: sub.status,
    company_batch: sub.company_batch?.joined_at ? {
      batch_id: sub.company_batch.batch_id || null,
      role: sub.company_batch.role || null,
      waiting: sub.status === "held_in_batch",
      joined_at: sub.company_batch.joined_at,
      released_at: sub.company_batch.released_at || null,
      left_at: sub.company_batch.left_at || null,
      left_reason: sub.company_batch.left_reason || null,
      lead_order_id: sub.company_batch.lead_order_id || null,
      lead_sub_order_id: sub.company_batch.lead_sub_order_id || null,
      lead_reference: sub.company_batch.lead_reference || "",
      dispatched_at: sub.company_batch.dispatched_at || null,
      standalone_shipping: sub.company_batch.standalone_shipping ?? null,
      savings: Number(sub.company_batch.savings || 0),
    } : null,
    // What came back out of THIS parcel. Kept beside `status` rather than folded into it:
    // the parcel really was delivered, and a customer return is a different event from
    // Bosta handing an undelivered parcel back to the vendor.
    return_state: deriveReturnState(items),
    // Every rung of the journey with where it actually is — built here so the vendor's view
    // and the customer's view can never disagree about where a parcel has got to.
    journey: buildJourney(order, sub),
    vendor_id: sub.vendor_id,
    vendor_name: vendor?.store_name || vendor?.store_username || null,
    fulfillment_location: sub.fulfillment_location,
    items,
    item_count: items.length,
    cod_amount: sub.cod_amount,
    merchandise_total: sub.merchandise_total,
    shipping_share: sub.shipping_share,
    coupon_share: sub.coupon_share,
    loyalty_share: sub.loyalty_share,
    bosta_tracking_number: sub.bosta_tracking_number,
    // The Smart Sticker on the box, distinct from the tracking number since Sept 2026.
    smart_label_barcode: sub.smart_label_barcode || shipment?.smart_label_barcode || null,
    // Courier-agnostic fields — screens should read these; `bosta_*` stays for old callers.
    // Rows read with .lean() carry no schema defaults, so a shipment from before the courier
    // switch has no `provider` at all — it is Bosta, and must read as Bosta.
    courier: shipment ? require("./couriers").providerOfShipment(shipment) : (sub.courier || null),
    courier_label: require("./couriers").labelOf(shipment ? require("./couriers").providerOfShipment(shipment) : (sub.courier || "bosta")),
    // Arabic too: the serializer does not know the reader's language, and sending only the
    // Latin name put "Arrive" and "Bosta" inside otherwise-Arabic sentences on every screen.
    courier_label_ar: require("./couriers").labelOf(shipment ? require("./couriers").providerOfShipment(shipment) : (sub.courier || "bosta"), true),
    tracking_number: sub.tracking_number || sub.bosta_tracking_number || null,
    tracking_url: require("./couriers").trackingUrlFor(shipment ? require("./couriers").providerOfShipment(shipment) : (sub.courier || "bosta"), sub.tracking_number || sub.bosta_tracking_number),
    courier_sector_id: sub.courier_sector_id || null,
    courier_sector_name: sub.courier_sector_name || "",
    tracking_history: shipment?.tracking_history || [],
    bosta_status: shipment?.bosta_status || null,
    parcel_photos: sub.parcel_photos || [],
    delivered_at: sub.delivered_at,
    cancelled_at: sub.cancelled_at,
    cancel_reason: sub.cancel_reason,
    can_cancel: cancellability(sub).allowed,
    cancel_blocked_reason: cancellability(sub).reason,
    cancel_blocked_reason_ar: cancellability(sub).reason_ar,
    reactivation_count: Number(sub.reactivation_count || 0),
    reactivated_at: sub.reactivated_at || null,
    created_at: sub.created_at,
  };

  if (audience === "customer") return base;

  return {
    ...base,
    commission_total: sub.commission_total,
    // How the parcel's coupon was funded. Vendor and admin only: the customer sees one
    // discount, and who paid for it is between us and the vendor.
    coupon_vendor_share: Number(sub.coupon_vendor_share || 0),
    coupon_platform_share: Number(sub.coupon_platform_share ?? (Number(sub.coupon_share || 0) - Number(sub.coupon_vendor_share || 0))),
    deadline_at: sub.deadline_at,
    is_overdue: sub.is_overdue,
    needs_admin_reason: sub.needs_admin_reason,
    needs_admin_since: sub.needs_admin_since,
    cancel_request: sub.cancel_request,
    items_confirmed_at: sub.items_confirmed_at,
    tracking_assigned_at: sub.tracking_assigned_at,
    ready_at: sub.ready_at,
    // When the STORE said the courier took it. Survives Bosta's later confirmation, so the
    // two claims stay separately answerable.
    handed_over_at: sub.handed_over_at,
    handed_over_by_label: sub.handed_over_by_label,
    allocation_frozen_at: sub.allocation_frozen_at,
    pickup_id: sub.pickup_id,
    pickup_booked_at: sub.pickup_booked_at,
    shipment_id: sub.shipment_id,
    // Admin only: a cancelled parcel may be reinstated, and every past cancellation is
    // kept whole so the refund-and-recharge trail can be read off the parcel.
    can_reactivate: sub.status === "cancelled",
    // The admin may change the courier until a shipment exists.
    can_change_courier: !sub.tracking_number && !sub.bosta_tracking_number && sub.status !== "cancelled",
    courier_cancel_pending: sub.courier_cancel_pending?.at && !sub.courier_cancel_pending?.done_at ? sub.courier_cancel_pending : null,
    courier_override: sub.courier || null,
    courier_transfer: sub.courier_transfer || null,
    courier_transfer_blocked_reason: require('./couriers/transfer').blockedReason(sub),
    courier_transfer_blocked_reason_ar: require('./couriers/transfer').blockedReason(sub, true),
    dispatch_attempt: sub.dispatch_attempt?.at ? sub.dispatch_attempt : null,
    status_before_cancel: sub.status_before_cancel || null,
    cancellations: sub.cancellations || [],
    history: sub.history || [],
  };
};

module.exports = {
  VENDOR_STAGES,
  BOSTA_DRIVEN,
  effectiveStatus,
  isHeldInBatch,
  FORWARD_ORDER,
  SUB_TO_ORDER_STATUS,
  isDispatched,
  isLive,
  awaitsVendor,
  allocateExact,
  toMinor,
  toMajor,
  findSubOrder,
  subOrderItems,
  shippableItems,
  liveShipmentFor,
  vendorSubOrders,
  appendSubHistory,
  buildSubOrdersFromItems,
  attachItemToSubOrder,
  allocate,
  previewSubOrders,
  freezeAllocation,
  editBlockedReason,
  deriveOrderStatus,
  syncOrderStatus,
  deriveReturnState,
  subOrderReturnState,
  orderReturnState,
  applyReturnOverlay,
  DELIVERED_ORDER_STATUSES,
  AT_VENDOR_STATUSES,
  IN_TRANSIT_STATUSES,
  applyDeadlines,
  cancellability,
  buildJourney,
  buildOrderJourney,
  toPublicSubOrder,
};
