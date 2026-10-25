/**
 * The actions that move a sub-order through its life — the vendor's three stages, the
 * cancellation paths, and the admin's intervention resolutions.
 *
 * Kept apart from `subOrderService`, which owns the arithmetic and the state vocabulary and
 * touches nothing outside the order document. Everything here reaches further: Bosta,
 * wallets, loyalty, labels, notifications.
 *
 * ── The vendor's three stages ─────────────────────────────────────────────────────────
 *   ① Confirm products   every item marked available or not, each saved on press
 *   ② Assign tracking    scan a Smart Label, or download the AWB Bosta minted
 *   ③ Ready for pickup   photograph the sealed parcel, then hand it over
 *
 * Any decline in ① parks the parcel in `needs_admin` instead of advancing it. That is
 * deliberate: the admin then speaks to the customer off-platform — "it is out of stock, I
 * can get it from another store at this price, or there is another colour" — and needs to
 * be able to act on that conversation before the vendor goes any further.
 */

const { Order } = require("../models/orders");
const { Seller } = require("../models/sellers");
const subOrderService = require("./subOrderService");
const bostaFulfillmentService = require("./bostaFulfillmentService");
const smartLabelService = require("./smartLabelService");
const shippingEngine = require("./shippingEngine");
const walletService = require("./walletService");
const loyaltyService = require("./loyaltyService");
const bostaService = require("./bostaService");
const couriers = require("./couriers");
const courierCostService = require("./courierCostService");

const MAX_PARCEL_PHOTOS = 5;
const trackingOf = (sub) => couriers.trackingNumberOf(sub);

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const fail = (message, code = "SUB_ORDER_ERROR", status = 400) =>
  Object.assign(new Error(message), { code, status });

/**
 * The one sentence every "no label, no waybill" refusal uses. A parcel may leave stage ②
 * with either a scanned Smart Sticker or a printed waybill; the sticker is never required
 * once a waybill exists, and vice versa. Only a parcel with NEITHER is held back.
 */
const LABEL_OR_WAYBILL_REQUIRED =
  "A Smart Sticker or a waybill (بوليصة) must exist on this parcel — scan the sticker, or create the shipment and print its waybill";

/** Load an order and the sub-order inside it, refusing anything that does not line up. */
const loadSubOrder = async (orderId, subOrderId, { vendorId = null } = {}) => {
  const order = await Order.findById(orderId);
  if (!order) throw fail("Order not found", "ORDER_NOT_FOUND", 404);

  const sub = subOrderService.findSubOrder(order, subOrderId);
  if (!sub) throw fail("Parcel not found on this order", "SUB_ORDER_NOT_FOUND", 404);

  // A vendor may only ever touch their own parcel. Checked here rather than in each route
  // so no future caller can forget it.
  if (vendorId && sub.vendor_id.toString() !== vendorId.toString()) {
    throw fail("This parcel belongs to another vendor", "FORBIDDEN", 403);
  }

  return { order, sub };
};

/**
 * Company consolidation (feature 14): a rider ships inside its batch's lead, so the
 * shipping steps are refused on it with a pointer to the order that carries it; a lead
 * may only ship once every order in the combined parcel is confirmed.
 */
const assertNotRider = (sub) => {
  if (sub.company_batch?.role === "rider" || sub.status === "in_batch_parcel") {
    throw fail(
      `This order is packed inside the combined company parcel of order ${sub.company_batch?.lead_reference || ""} — continue from that one`,
      "RIDES_IN_BATCH",
      409
    );
  }
  if (sub.status === "held_in_batch") throw fail("This order is still waiting in its company batch", "BATCH_WAITING", 409);
};
const assertBatchCanShip = async (order, sub) => {
  assertNotRider(sub);
  if (sub.company_batch?.role === "lead" && !trackingOf(sub)) {
    try {
      await require("./companyBatchService").dispatchOptionsFor(order, sub);
    } catch (err) {
      throw fail(err.message, err.code || "BATCH_NOT_READY", err.status || 409);
    }
  }
};

const vendorActor = async (vendorId) => {
  const vendor = await Seller.findById(vendorId).select("store_name store_username name").lean();
  return {
    role: "vendor",
    label: vendor?.store_name || vendor?.store_username || vendor?.name || "Vendor",
  };
};

/** Notify the customer about one of their parcels. Never throws — a missed message must
 *  not fail the action that produced it. */
const notifyAboutParcel = async (order, sub, payload, extra = {}) => {
  try {
    const { notifyCustomer } = require("./customerNotificationService");
    await notifyCustomer(order.user_id, payload.type, payload, {
      link: `/profile?tab=orders&order=${order._id}`,
      data: { order_id: order._id, sub_order_id: sub._id, ...extra },
    });
  } catch (err) {
    console.error(`[Sub-order] Customer notification failed for ${sub?._id}: ${err.message}`);
  }
};

/** The store name shown to the customer beside a parcel, so they know which shop it is. */
const vendorNameFor = async (vendorId) => {
  const vendor = await Seller.findById(vendorId).select("store_name store_username").lean();
  return vendor?.store_name || vendor?.store_username || "the store";
};

/**
 * Mirror this vendor's parcel states back onto their supervision row.
 *
 * `vendor_supervisions` stays the per-VENDOR financial rollup that commissions and the
 * vendor dashboard read, so it must not drift: a vendor with two branches has two parcels
 * but one supervision, which is "supervised" only once neither parcel still awaits review.
 */
const syncVendorSupervision = (order, vendorId) => {
  const supervision = (order.vendor_supervisions || []).find(
    (vs) => vs.vendor_id.toString() === vendorId.toString()
  );
  if (!supervision) return;
  const theirItems = (order.items || []).filter(
    (i) => i.vendor_id?.toString() === vendorId.toString()
  );
  const allReviewed = theirItems.length > 0 && theirItems.every((i) => i.vendor_status !== "pending");
  supervision.status = allReviewed ? "supervised" : "pending";
};

/* ------------------------------------------------------------------ */
/*  Stage ① — Confirm products                                        */
/* ------------------------------------------------------------------ */

/**
 * Mark one item available or not. Writes immediately — there is no submit step, so nothing
 * a vendor has already decided can be lost by navigating away.
 *
 * Declining requires a reason because the admin uses that exact text when they phone the
 * customer. "Not available" with no explanation leaves them with nothing to say.
 */
const reviewItem = async ({ orderId, subOrderId, itemId, available, reason = "", actor, vendorId = null }) => {
  const { order, sub } = await loadSubOrder(orderId, subOrderId, { vendorId });

  const blocked = subOrderService.editBlockedReason(order);
  if (blocked && sub.status !== "pending_review") throw fail(blocked, "ORDER_LOCKED");
  if (!["pending_review", "needs_admin"].includes(sub.status)) {
    throw fail("This parcel has moved past the review stage", "WRONG_STAGE");
  }

  const item = (order.items || []).find(
    (i) => i._id.toString() === itemId.toString() && subOrderService.findSubOrder(order, i.sub_order_id)?._id?.toString() === sub._id.toString()
  );
  if (!item) throw fail("Item not found on this parcel", "ITEM_NOT_FOUND", 404);

  if (!available && !String(reason || "").trim()) {
    throw fail("Please say why this item is not available", "REASON_REQUIRED");
  }

  const from = item.vendor_status;
  item.vendor_status = available ? "approved" : "declined";
  item.vendor_note = available ? "" : String(reason).trim();

  subOrderService.appendSubHistory(
    sub,
    "item_reviewed",
    available ? "Item confirmed available" : "Item marked unavailable",
    `${item.product_title}: ${from} → ${item.vendor_status}${item.vendor_note ? ` (${item.vendor_note})` : ""}`,
    { item_id: item._id.toString(), from, to: item.vendor_status, reason: item.vendor_note },
    actor
  );

  syncVendorSupervision(order, sub.vendor_id);
  await order.save();

  return { order, sub, item };
};

/** Confirm every outstanding item on the parcel in one press. */
const approveAllItems = async ({ orderId, subOrderId, actor, vendorId = null }) => {
  const { order, sub } = await loadSubOrder(orderId, subOrderId, { vendorId });
  if (!["pending_review", "needs_admin"].includes(sub.status)) {
    throw fail("This parcel has moved past the review stage", "WRONG_STAGE");
  }

  let changed = 0;
  for (const item of subOrderService.subOrderItems(order, sub)) {
    if (item.vendor_status === "approved") continue;
    item.vendor_status = "approved";
    item.vendor_note = "";
    changed += 1;
  }

  if (changed > 0) {
    subOrderService.appendSubHistory(
      sub, "items_reviewed_bulk", "All items confirmed available",
      `${changed} item(s) confirmed in one action.`, { count: changed }, actor
    );
    syncVendorSupervision(order, sub.vendor_id);
    await order.save();
  }

  return { order, sub, changed };
};

/**
 * Refuse the whole parcel in one press, with one reason that covers every line.
 *
 * A vendor who is closed, out of the whole basket, or unable to ship at all was previously
 * made to type the same sentence once per item and then press Confirm — so the fast path
 * was the tedious one. This writes that sentence onto every line and confirms in the same
 * call, which parks the parcel with the website team exactly as an item-by-item refusal does.
 * Nothing about what happens afterwards is different: the admin still owns the conversation
 * with the customer.
 */
const declineAllItems = async ({ orderId, subOrderId, reason = "", actor, vendorId = null }) => {
  const text = String(reason || "").trim();
  if (!text) throw fail("Please say why this parcel cannot be fulfilled", "REASON_REQUIRED");

  const { order, sub } = await loadSubOrder(orderId, subOrderId, { vendorId });
  if (!["pending_review", "needs_admin"].includes(sub.status)) {
    throw fail("This parcel has moved past the review stage", "WRONG_STAGE");
  }

  const items = subOrderService.subOrderItems(order, sub);
  if (items.length === 0) throw fail("This parcel has no items", "EMPTY_PARCEL");

  for (const item of items) {
    item.vendor_status = "declined";
    item.vendor_note = text;
  }

  subOrderService.appendSubHistory(
    sub, "items_declined_bulk", "Whole parcel refused",
    `${items.length} item(s) marked unavailable in one action: ${text}`,
    { count: items.length, reason: text }, actor
  );

  syncVendorSupervision(order, sub.vendor_id);
  await order.save();

  // Confirming is what actually parks the parcel and notifies the admins. Re-reading the
  // order there is safe: everything above is already persisted.
  return confirmItems({ orderId, subOrderId, actor, vendorId });
};

/**
 * Leave stage ① — "Confirm product availability".
 *
 * Two outcomes, and which one happens is decided entirely by whether anything was declined:
 *
 *   · everything available → the parcel advances, and (unless Smart Label is on) its Bosta
 *     delivery is created here so the vendor has an AWB to print in stage ②.
 *   · anything declined    → the parcel parks in `needs_admin`. Nothing is sent to Bosta,
 *     because what the customer is actually buying is no longer settled.
 */
const confirmItems = async ({ orderId, subOrderId, actor, vendorId = null }) => {
  const { order, sub } = await loadSubOrder(orderId, subOrderId, { vendorId });

  if (sub.status === "cancelled") throw fail("This parcel is cancelled", "CANCELLED");
  if (sub.status !== "pending_review" && sub.status !== "needs_admin") {
    throw fail("This parcel has already been confirmed", "WRONG_STAGE");
  }

  const items = subOrderService.subOrderItems(order, sub);
  if (items.length === 0) throw fail("This parcel has no items", "EMPTY_PARCEL");

  const stillPending = items.filter((i) => i.vendor_status === "pending");
  if (stillPending.length > 0) {
    throw fail(`${stillPending.length} item(s) still need a decision`, "ITEMS_PENDING");
  }

  const declined = items.filter((i) => i.vendor_status === "declined");
  if (declined.length > 0) {
    // Park it. The admin talks to the customer and decides: source a replacement from this
    // vendor, source one from another vendor, drop the line and refund it, or cancel the
    // parcel. Only then does the vendor get to continue.
    sub.status = "needs_admin";
    sub.needs_admin_since = sub.needs_admin_since || new Date();
    sub.needs_admin_reason = declined
      .map((i) => `${i.product_title}: ${i.vendor_note || "no reason given"}`)
      .join("; ");

    subOrderService.appendSubHistory(
      sub, "sub_order_needs_admin", "Waiting for the website team",
      `${declined.length} item(s) unavailable — the order team will contact the customer.`,
      { declined_count: declined.length, reasons: sub.needs_admin_reason }, actor
    );

    syncVendorSupervision(order, sub.vendor_id);
    subOrderService.syncOrderStatus(order, actor.label || "System");
    await order.save();

    await notifyAdminsOfIntervention(order, sub).catch(() => {});
    return { order, sub, parked: true, dispatched: false };
  }

  sub.items_confirmed_at = new Date();

  // A company-batch member (feature 14) does not ship on its own: every order in the
  // combined parcel is confirmed separately, and the one shipment is created on the lead
  // once the last of them is — right away with a printed waybill, or when the vendor scans
  // the sticker on the combined box.
  if (sub.company_batch?.role) {
    sub.status = "awaiting_tracking";
    subOrderService.appendSubHistory(
      sub, "sub_order_items_confirmed", "Products confirmed",
      sub.company_batch.role === "lead"
        ? "Confirmed. This order carries the combined company parcel — it ships once every order in it is confirmed."
        : `Confirmed. Pack these items separately with this person's label; they ship inside the combined parcel of order ${sub.company_batch.lead_reference || ""}.`,
      { batch_id: sub.company_batch.batch_id, role: sub.company_batch.role }, actor
    );
    syncVendorSupervision(order, sub.vendor_id);
    subOrderService.syncOrderStatus(order, actor.label || "System");
    await order.save();

    const batch = await require("./companyBatchService").onMemberConfirmed(sub.company_batch.batch_id, actor);
    const fresh = batch.dispatched ? await Order.findById(order._id) : order;
    return {
      order: fresh,
      sub: subOrderService.findSubOrder(fresh, sub._id),
      parked: false,
      dispatched: !!batch.dispatched,
      batch,
    };
  }

  // Smart Label ON: the label is already on the parcel, so the delivery is created in
  // stage ② with the number the vendor scans. Smart Label OFF: Bosta mints the number and
  // it has to exist NOW, because stage ② is where the vendor prints it.
  const provider = await couriers.courierFor(sub);
  const smartLabelEnabled = couriers.smartLabelApplies(provider, await smartLabelService.isEnabled().catch(() => false));

  if (smartLabelEnabled) {
    sub.status = "awaiting_tracking";
    subOrderService.appendSubHistory(
      sub, "sub_order_items_confirmed", "Products confirmed",
      "Scan the label stuck on this parcel to continue.", {}, actor
    );
  } else {
    try {
      await bostaFulfillmentService.dispatchSubOrder(order, sub, { actor });
      sub.status = "awaiting_tracking";
      sub.tracking_assigned_at = new Date();
      subOrderService.appendSubHistory(
        sub, "sub_order_items_confirmed", "Products confirmed",
        `Shipment created with ${couriers.labelOf(sub.courier || provider)} — print the waybill and stick it on the parcel.`,
        { tracking_number: trackingOf(sub), courier: sub.courier || provider }, actor
      );
    } catch (err) {
      // The parcel stays exactly where it was so the vendor can simply press again. Nothing
      // partial is left behind: `dispatchSubOrder` throws before mutating anything when the
      // create fails.
      subOrderService.appendSubHistory(
        sub, "sub_order_dispatch_failed", "Could not create the shipment",
        err.message, { error: err.message }, actor
      );
      await order.save().catch(() => {});
      throw fail(
        `Products confirmed, but the shipment could not be created: ${err.message}. Please try again.`,
        "BOSTA_CREATE_FAILED"
      );
    }
  }

  syncVendorSupervision(order, sub.vendor_id);
  subOrderService.syncOrderStatus(order, actor.label || "System");
  await order.save();

  return { order, sub, parked: false, dispatched: !smartLabelEnabled, courier: sub.courier || provider };
};

/* ------------------------------------------------------------------ */
/*  Stage ② — Assign tracking number                                  */
/* ------------------------------------------------------------------ */

/**
 * Leave stage ② with a tracking number on the parcel.
 *
 * With Smart Label on, the scanned number IS the delivery: it is reserved locally and then
 * the Bosta delivery is created carrying it, so no waybill is ever printed. With Smart
 * Label off the number already exists — Bosta minted it at the end of stage ① — and this
 * call only records that the vendor has printed and attached it.
 */
const assignTracking = async ({ orderId, subOrderId, trackingNumber = null, actor, vendorId = null }) => {
  const { order, sub } = await loadSubOrder(orderId, subOrderId, { vendorId });

  if (sub.status === "cancelled") throw fail("This parcel is cancelled", "CANCELLED");
  if (sub.status === "needs_admin") throw fail("This parcel is waiting for the website team", "NEEDS_ADMIN");
  assertNotRider(sub);
  if (sub.status !== "awaiting_tracking") {
    throw fail("This parcel is not at the tracking-number stage", "WRONG_STAGE");
  }
  await assertBatchCanShip(order, sub);

  const provider = await couriers.courierFor(sub);
  const smartLabelEnabled = couriers.smartLabelApplies(provider, await smartLabelService.isEnabled().catch(() => false));

  // A shipment that already exists — minted by the courier through `createPrintedShipment`
  // or at the end of stage ① — only needs the vendor's word that the waybill is on the box.
  // Checked before the Smart Label branch so a vendor who chose the printed route is not
  // asked to scan a label they do not have.
  const scanned = String(trackingNumber || "").trim();

  if (smartLabelEnabled && scanned && trackingOf(sub)) {
    // The shipment exists already (printed route, or an earlier sticker Bosta refused)
    // and the vendor is scanning a sticker onto it. Links to the live delivery; nothing
    // is created. A refusal here leaves the shipment exactly as it was.
    try {
      await smartLabelService.scanLabel({
        orderId: order._id,
        order,
        vendorId: sub.vendor_id,
        trackingNumber: scanned,
        actor: { ...actor, id: sub.vendor_id },
      });
    } catch (err) {
      await order.save().catch(() => {});
      throw fail(err.message, "STICKER_REFUSED");
    }
  } else if (smartLabelEnabled && !trackingOf(sub)) {
    const number = scanned;
    // Neither exists yet. Both are acceptable and neither is mandatory on its own: the
    // sticker is optional whenever a waybill is there, and the waybill is optional
    // whenever a sticker is. Only having NEITHER stops the parcel.
    if (!number) throw fail(LABEL_OR_WAYBILL_REQUIRED, "TRACKING_REQUIRED");

    // Reserve locally first so a number already spoken for is refused while the vendor is
    // still holding the parcel, rather than several seconds later by Bosta.
    await smartLabelService.scanLabel({
      orderId: order._id,
      // Hand over the document already loaded here. Letting scanLabel fetch and save its
      // own copy of the same order is what used to strand this whole step: its save moved
      // the version on, and the save at the bottom of this function — the one that writes
      // the tracking number and the new status — died with a VersionError, leaving a
      // reserved label and a live Bosta delivery that the order had no record of.
      order,
      vendorId: sub.vendor_id,
      trackingNumber: number,
      actor: { ...actor, id: sub.vendor_id },
    });

    const reservation = await smartLabelService.reservationFor(order._id, sub.vendor_id);
    let dispatchResult;
    try {
      dispatchResult = await bostaFulfillmentService.dispatchSubOrder(order, sub, {
        trackingNumber: number,
        actor,
      });
    } catch (err) {
      // The create itself failed, so nothing exists at Bosta. Hand the number back: the
      // label is still physically on the parcel and perfectly usable.
      await smartLabelService.releaseReservations(order, {
        vendorId: sub.vendor_id,
        reason: `Bosta rejected the shipment (${err.message})`,
        actor,
      }).catch(() => {});
      await order.save().catch(() => {});
      throw fail(`The shipment could not be created: ${err.message}`, "BOSTA_CREATE_FAILED");
    }

    if (dispatchResult?.stickerError) {
      // The delivery IS live; only the sticker was refused. Release the sticker, then save
      // for real — this save is what keeps the delivery on the order, so its failure must
      // surface, not be swallowed. The parcel stays at this stage with the waybill and a
      // scanner side by side.
      await smartLabelService.releaseReservations(order, {
        vendorId: sub.vendor_id,
        reason: dispatchResult.stickerError,
        actor,
      }).catch(() => {});
      subOrderService.syncOrderStatus(order, actor.label || "System");
      await order.save();
      throw fail(dispatchResult.stickerError, "STICKER_REFUSED");
    }
    if (reservation) await smartLabelService.markDispatched(reservation._id);
  } else if (!trackingOf(sub)) {
    // Stage ① should have created it. Recover rather than strand the vendor.
    await bostaFulfillmentService.dispatchSubOrder(order, sub, { actor });
  }

  sub.status = "awaiting_handover";
  sub.tracking_assigned_at = sub.tracking_assigned_at || new Date();
  subOrderService.appendSubHistory(
    sub, "sub_order_tracking_assigned", "Tracking number assigned",
    `Tracking ${trackingOf(sub)} (${couriers.labelOf(sub.courier || provider)})${sub.smart_label_barcode ? `, linked to sticker ${sub.smart_label_barcode}` : ""}. Photograph the sealed parcel to finish.`,
    { tracking_number: trackingOf(sub), smart_label_barcode: sub.smart_label_barcode || null, smart_label: smartLabelEnabled, courier: sub.courier || provider }, actor
  );

  subOrderService.syncOrderStatus(order, actor.label || "System");
  await order.save();

  return { order, sub };
};

/**
 * The other way out of stage ② with Smart Label on: no sticker, so Bosta mints the number
 * and the vendor prints the waybill — exactly what stage ① does when Smart Label is off.
 *
 * Both routes exist side by side on purpose. A vendor who has run out of stickers, or
 * whose sticker Bosta refuses, must not be stuck at a scanner; and one who does have a
 * sticker must not be made to print. The parcel stays at `awaiting_tracking` afterwards
 * so `assignTracking` — now with nothing to scan — records that the waybill is attached.
 *
 * Any reservation on this parcel is released first: a sticker that is not going to be
 * the tracking number is still a perfectly good sticker for the next parcel.
 */
const createPrintedShipment = async ({ orderId, subOrderId, actor, vendorId = null }) => {
  const { order, sub } = await loadSubOrder(orderId, subOrderId, { vendorId });

  if (sub.status === "cancelled") throw fail("This parcel is cancelled", "CANCELLED");
  if (sub.status === "needs_admin") throw fail("This parcel is waiting for the website team", "NEEDS_ADMIN");
  assertNotRider(sub);
  if (sub.status !== "awaiting_tracking") {
    throw fail("This parcel is not at the tracking-number stage", "WRONG_STAGE");
  }
  if (trackingOf(sub)) throw fail("This parcel already has a shipment", "ALREADY_DISPATCHED");
  await assertBatchCanShip(order, sub);

  const reservation = await smartLabelService.reservationFor(order._id, sub.vendor_id);
  if (reservation) {
    await smartLabelService.releaseReservations(order, {
      vendorId: sub.vendor_id,
      reason: "The vendor chose a printed waybill instead",
      actor,
    });
  }

  try {
    await bostaFulfillmentService.dispatchSubOrder(order, sub, { actor });
  } catch (err) {
    subOrderService.appendSubHistory(
      sub, "sub_order_dispatch_failed", "Could not create the shipment",
      err.message, { error: err.message }, actor
    );
    await order.save().catch(() => {});
    throw fail(`The shipment could not be created: ${err.message}`, "BOSTA_CREATE_FAILED");
  }

  subOrderService.appendSubHistory(
    sub, "sub_order_shipment_created", "Shipment created",
    `${couriers.labelOf(sub.courier)} issued tracking ${trackingOf(sub)}. Print the waybill and stick it on the parcel.`,
    { tracking_number: trackingOf(sub), printed_waybill: true, courier: sub.courier }, actor
  );

  subOrderService.syncOrderStatus(order, actor.label || "System");
  await order.save();

  return { order, sub };
};

/* ------------------------------------------------------------------ */
/*  Stage ③ — Ready for pickup                                        */
/* ------------------------------------------------------------------ */

/**
 * Attach photographs of the sealed parcel. Up to five, and all of them optional.
 *
 * They used to be mandatory before a parcel could be called ready. They are not any more:
 * a vendor standing at a counter with a sealed box and a bad camera was blocked from
 * finishing a parcel that was, in every real sense, finished. They remain the vendor's own
 * evidence in a dispute and the admin still reviews whatever is there before booking a
 * courier — but evidence you choose to keep is a different thing from a gate.
 */
const addParcelPhotos = async ({ orderId, subOrderId, urls = [], actor, vendorId = null }) => {
  const { order, sub } = await loadSubOrder(orderId, subOrderId, { vendorId });

  assertNotRider(sub);
  if (!["awaiting_handover", "ready_for_pickup"].includes(sub.status)) {
    throw fail("This parcel is not ready to be photographed yet", "WRONG_STAGE");
  }

  const clean = (Array.isArray(urls) ? urls : [urls]).map((u) => String(u || "").trim()).filter(Boolean);
  if (clean.length === 0) throw fail("No photo was uploaded", "NO_PHOTOS");

  const room = MAX_PARCEL_PHOTOS - (sub.parcel_photos || []).length;
  if (room <= 0) throw fail(`A parcel can carry at most ${MAX_PARCEL_PHOTOS} photos`, "TOO_MANY_PHOTOS");

  for (const url of clean.slice(0, room)) {
    sub.parcel_photos.push({ url, uploaded_at: new Date(), uploaded_by_label: actor.label || "Vendor" });
  }

  subOrderService.appendSubHistory(
    sub, "parcel_photos_added", "Parcel photos added",
    `${Math.min(clean.length, room)} photo(s) attached.`,
    { count: Math.min(clean.length, room) }, actor
  );

  await order.save();
  return { order, sub, added: Math.min(clean.length, room), skipped: Math.max(0, clean.length - room) };
};

const removeParcelPhoto = async ({ orderId, subOrderId, photoId, actor, vendorId = null }) => {
  const { order, sub } = await loadSubOrder(orderId, subOrderId, { vendorId });
  // Once a courier is booked the photos are the record of what was handed over, so they
  // stop being the vendor's to edit.
  if (sub.pickup_booked_at) throw fail("A courier is already booked for this parcel", "PICKUP_BOOKED");

  const before = sub.parcel_photos.length;
  sub.parcel_photos = sub.parcel_photos.filter((p) => p._id.toString() !== photoId.toString());
  if (sub.parcel_photos.length === before) throw fail("Photo not found", "PHOTO_NOT_FOUND", 404);

  // Removing the last photo no longer un-finishes the parcel. Photos stopped being what
  // makes a parcel ready, so deleting one cannot un-make it — the vendor's confirmation is
  // the thing that said it was sealed, and that still stands.

  subOrderService.appendSubHistory(sub, "parcel_photo_removed", "Parcel photo removed", "", {}, actor);
  await order.save();
  return { order, sub };
};

/**
 * Finish stage ③ — the vendor says the parcel is sealed and waiting. It now offers itself to
 * the admin's Pickups module, where a courier is booked for it.
 *
 * This does NOT mean the parcel has left the store, and nothing may say that it has: the
 * courier has not been yet. Stage ④ (`confirmHandover`) is where that becomes true.
 */
const markReadyForPickup = async ({ orderId, subOrderId, actor, vendorId = null }) => {
  const { order, sub } = await loadSubOrder(orderId, subOrderId, { vendorId });

  if (sub.status === "ready_for_pickup") return { order, sub, alreadyReady: true };
  assertNotRider(sub);
  if (sub.status !== "awaiting_handover") {
    throw fail("Assign a tracking number to this parcel first", "WRONG_STAGE");
  }
  if (!trackingOf(sub)) {
    throw fail(LABEL_OR_WAYBILL_REQUIRED, "NO_TRACKING");
  }

  sub.status = "ready_for_pickup";
  sub.ready_at = new Date();
  sub.is_overdue = false;

  subOrderService.appendSubHistory(
    sub, "sub_order_ready", "Ready for pickup",
    // Says what is actually true. It used to say "sealed, photographed and waiting", which
    // was two claims too many on a parcel with no photos that no courier had visited.
    actor.role === "admin"
      ? "The website team marked the parcel sealed on the vendor's behalf. It is waiting at the store for a courier."
      : "The vendor sealed the parcel. It is waiting at the store for a courier.",
    { photo_count: (sub.parcel_photos || []).length }, actor
  );

  subOrderService.syncOrderStatus(order, actor.label || "System");
  await order.save();

  return { order, sub, alreadyReady: false };
};

/* ------------------------------------------------------------------ */
/*  Stage ④ — Handed to the courier                                   */
/* ------------------------------------------------------------------ */

/**
 * The vendor confirms a Bosta courier physically took the parcel.
 *
 * WHY THIS STEP EXISTS. Before it, a parcel jumped from "the vendor says it is sealed" to
 * screens announcing it had left the store — while it was very often still sitting on the
 * counter. Nobody had said the courier came. There are exactly two people who can know
 * that: Bosta, through a webhook, and the vendor who handed the box over. This is the
 * vendor's half. Until one of the two speaks, no screen may claim the parcel has moved.
 *
 * ALLOWED FROM `ready_for_pickup` AS WELL AS `pickup_scheduled`, because couriers do not
 * wait for our booking flow — one turning up at a branch and taking a sealed parcel is an
 * ordinary morning, and refusing the vendor's confirmation because an admin had not booked
 * the visit yet would push them back to telling us on WhatsApp.
 *
 * Bosta's own confirmation later moves the parcel on to `picked_up`. `handed_over_at`
 * survives that, so "when did the store say it went?" stays answerable afterwards.
 */
const confirmHandover = async ({ orderId, subOrderId, actor, vendorId = null }) => {
  const { order, sub } = await loadSubOrder(orderId, subOrderId, { vendorId });

  // Idempotent, and so is anything further along: a vendor pressing this on a parcel Bosta
  // has already reported as collected is telling the truth, and must not get an error.
  const ALREADY_GONE = ["handed_to_courier", "picked_up", "in_transit", "out_for_delivery", "delivered"];
  if (ALREADY_GONE.includes(sub.status)) return { order, sub, alreadyHandedOver: true };
  assertNotRider(sub);

  if (!["ready_for_pickup", "pickup_scheduled"].includes(sub.status)) {
    throw fail("Mark this parcel ready for pickup first", "WRONG_STAGE");
  }
  if (!trackingOf(sub)) {
    throw fail(LABEL_OR_WAYBILL_REQUIRED, "NO_TRACKING");
  }

  sub.status = "handed_to_courier";
  sub.handed_over_at = new Date();
  sub.handed_over_by_label = actor.label || "Vendor";
  sub.is_overdue = false;

  const handoverCourier = couriers.labelOf(sub.courier || (await couriers.courierFor(sub)));
  subOrderService.appendSubHistory(
    sub, "sub_order_handed_over", "Handed to the courier",
    `The vendor confirmed a ${handoverCourier} courier collected this parcel.`,
    { confirmed_by: sub.handed_over_by_label, courier: sub.courier || null }, actor
  );

  subOrderService.syncOrderStatus(order, actor.label || "System");
  await order.save();

  return { order, sub, alreadyHandedOver: false };
};

/* ------------------------------------------------------------------ */
/*  Cancellation                                                      */
/* ------------------------------------------------------------------ */

/** A vendor asks for their parcel to be dropped; an admin decides. */
const requestCancellation = async ({ orderId, subOrderId, reason, actor, vendorId = null }) => {
  const { order, sub } = await loadSubOrder(orderId, subOrderId, { vendorId });

  const { allowed, reason: blocked } = subOrderService.cancellability(sub);
  if (!allowed) throw fail(blocked, "CANCEL_WINDOW_CLOSED");
  if (!String(reason || "").trim()) throw fail("Please give a reason", "REASON_REQUIRED");
  if (sub.cancel_request?.requested_at) throw fail("A cancellation request is already open", "ALREADY_REQUESTED");

  sub.cancel_request = {
    requested_at: new Date(),
    requested_by_role: actor.role || "vendor",
    requested_by_label: actor.label || "Vendor",
    reason: String(reason).trim(),
  };

  subOrderService.appendSubHistory(
    sub, "cancel_requested", "Cancellation requested",
    String(reason).trim(), { requested_by: actor.label }, actor
  );

  await order.save();
  await notifyAdminsOfIntervention(order, sub, "cancellation requested").catch(() => {});
  return { order, sub };
};

/**
 * Cancel one parcel and give back exactly what it was carrying.
 *
 * The refund is this parcel's own FROZEN share — merchandise plus its shipping, minus its
 * slice of the coupon and of the loyalty discount. Its siblings are never re-priced, because
 * their COD figures are already live at Bosta and were already shown to the customer.
 *
 * A CUSTOMER-initiated cancellation additionally re-checks the coupon: if what is left falls
 * under the coupon's minimum, the coupon is dropped and the refund is computed without it.
 * A cancellation caused by a vendor or the admin never costs the customer their discount —
 * it was not their doing.
 */
/**
 * Ledger idempotency key for this parcel's current cancel/reactivate cycle.
 *
 * The first cancellation keeps the bare key it always had, so nothing already written to
 * the ledger changes meaning. A parcel that was reactivated and is being cancelled AGAIN
 * gets a suffixed key, so the customer is refunded again rather than the refund being
 * treated as a replay of the first one.
 */
const cycleKey = (sub, base) => {
  const n = Number(sub.reactivation_count || 0);
  return n > 0 ? `${base}:r${n}` : base;
};

/**
 * Take a cancelled parcel out of the courier visit that was booked for it.
 *
 * The customer may now cancel right up to the moment the courier collects, so a parcel can
 * be cancelled while a Bosta pickup is already booked to fetch it. The booking is then
 * wrong in one of two ways: it still counts this box (the courier expects N parcels, the
 * fee was priced on N), or it has nothing left to collect at all — in which case the visit
 * is cancelled at Bosta so nobody drives out for an empty counter.
 *
 * Counted from the database, not from this order alone: one pickup collects every parcel
 * at that branch that day, across orders.
 *
 * @returns {{ bosta_pickup_id: string, remaining: number, visit_cancelled: boolean, warning: string|null }|null}
 */
const detachFromBookedPickup = async (order, sub) => {
  if (!sub.pickup_id) return null;
  const { BostaPickup } = require("../models/bostaPickups");
  const pickup = await BostaPickup.findById(sub.pickup_id);
  if (!pickup || pickup.status !== "scheduled") return null;

  // Every parcel still waiting on this visit, other than the one being cancelled.
  const docs = await Order.find({ "sub_orders.pickup_id": pickup._id }).select("_id sub_orders").lean();
  let remaining = 0;
  let thisOrderStillOnIt = false;
  for (const o of docs) {
    for (const s of o.sub_orders || []) {
      if (String(s.pickup_id) !== String(pickup._id) || s.status !== "pickup_scheduled") continue;
      if (String(s._id) === String(sub._id)) continue;
      remaining += 1;
      if (String(o._id) === String(order._id)) thisOrderStillOnIt = true;
    }
  }

  let warning = null;
  if (remaining === 0) {
    try {
      await bostaService.deletePickup(pickup.bosta_pickup_id);
    } catch (err) {
      // The visit stays booked at Bosta and someone has to cancel it by hand — said
      // plainly on the parcel rather than discovered when the courier turns up.
      warning = `Bosta pickup #${pickup.bosta_pickup_id} could not be cancelled at Bosta (${err.message}) — cancel it by hand.`;
      console.error(`[Sub-order] ${warning}`);
    }
    pickup.status = "cancelled";
    pickup.parcel_count = 0;
    pickup.order_ids = [];
    await pickup.save();
    return { bosta_pickup_id: pickup.bosta_pickup_id, remaining: 0, visit_cancelled: true, warning };
  }

  // The visit still happens, for fewer boxes. Re-price what Bosta will charge us for it —
  // a visit that was free at N parcels may not be at N − 1.
  pickup.parcel_count = remaining;
  pickup.pickup_fee = require("./bostaTariff").pickupFee(remaining);
  if (!thisOrderStillOnIt) {
    pickup.order_ids = (pickup.order_ids || []).filter((id) => String(id) !== String(order._id));
  }
  await pickup.save();
  return { bosta_pickup_id: pickup.bosta_pickup_id, remaining, visit_cancelled: false, warning: null };
};

const cancelSubOrder = async ({ orderId, subOrderId, reason, actor, byRole = "admin", vendorId = null, skipWindowCheck = false }) => {
  const { order, sub } = await loadSubOrder(orderId, subOrderId, { vendorId });

  if (sub.status === "cancelled") throw fail("This parcel is already cancelled", "ALREADY_CANCELLED");
  const statusBefore = sub.status;
  const couponDiscountBefore = Number(order.coupon_discount_amount || 0);
  if (!skipWindowCheck) {
    const { allowed, reason: blocked } = subOrderService.cancellability(sub);
    if (!allowed) throw fail(blocked, "CANCEL_WINDOW_CLOSED");
  }

  // Still waiting in a company batch (feature 14): out of the batch first. Refused while
  // the batch is closing, because the parcel is being handed to the vendor that instant.
  if (statusBefore === "held_in_batch") {
    try {
      await require("./companyBatchService").leaveBatch(order, sub, "cancelled");
    } catch (err) {
      throw fail(err.message, err.code || "BATCH_CLOSING", err.status || 409);
    }
  }

  // Terminate the delivery first. Doing it after the local write would risk a courier
  // arriving for a parcel the system has already written off.
  const shipment = subOrderService.liveShipmentFor(order, sub);
  const shipProvider = shipment ? couriers.providerOfShipment(shipment) : null;
  let strandedTracking = null;
  let arriveOutcome = null;
  if (shipment && shipProvider === "arrive" && shipment.tracking_number) {
    // Arrive has no cancellation at all — not in the API, and withheld from the merchant
    // portal too. What a human must now go and do depends on whether the courier already
    // has the box, and so does what it costs us; both come from one place.
    arriveOutcome = require("./couriers/arrive/cancellation").cancellationOutcome(sub, shipment);
    strandedTracking = shipment.tracking_number;
    courierCostService.recordCancellationCost(shipment, sub);
  } else if (shipment?.bosta_delivery_id) {
    try {
      await bostaService.terminateDelivery(shipment.bosta_delivery_id);
    } catch (err) {
      // Recorded, not swallowed: someone has to cancel it at Bosta by hand.
      strandedTracking = shipment.bosta_tracking_number || shipment.bosta_delivery_id;
      console.error(`[Sub-order] Could not terminate Bosta delivery ${strandedTracking}: ${err.message}`);
    }
  }
  const strandedLabel = shipProvider ? couriers.labelOf(shipProvider) : "the courier";

  // A courier visit booked for this parcel is trimmed or cancelled. After the delivery is
  // terminated and before the local write, on the same principle: Bosta must not be left
  // expecting a box the system has already written off.
  const pickupOutcome = await detachFromBookedPickup(order, sub).catch((err) => {
    console.error(`[Sub-order] Could not detach ${sub._id} from its pickup: ${err.message}`);
    return null;
  });

  // Any label held for this parcel goes back — the sticker is still on a box somewhere and
  // is perfectly reusable on the next one.
  await smartLabelService.releaseReservations(order, {
    vendorId: sub.vendor_id,
    reason: "parcel cancelled",
    actor,
  }).catch(() => {});

  const couponDropped = byRole === "customer" ? await revalidateCouponAfterCancel(order, sub) : false;

  let refundAmount = Number(sub.cod_amount || 0);
  if (couponDropped) {
    // The coupon no longer applies, so the share of it this parcel was carrying is not the
    // customer's to keep either. Refund the parcel net of the discount it had been given.
    refundAmount = Math.max(0, refundAmount - Number(sub.coupon_share || 0));
  }

  sub.status = "cancelled";
  sub.status_before_cancel = statusBefore;
  if (strandedTracking) {
    sub.courier_cancel_pending = {
      provider: shipProvider, tracking_number: strandedTracking,
      at: new Date(), done_at: null, done_by_label: "",
      // What the admin must actually go and do, decided by whether the courier already has
      // the box. Stored rather than derived at read time so the instruction cannot drift
      // once the parcel moves on.
      stage: arriveOutcome?.stage || null,
      instruction: arriveOutcome?.action || "",
      instruction_ar: arriveOutcome?.action_ar || "",
      expected_fee: arriveOutcome?.priced ? arriveOutcome.fee : null,
    };
  }
  sub.cancelled_at = new Date();
  sub.cancelled_by_role = byRole;
  sub.cancel_reason = String(reason || "").trim();
  sub.refunded_amount = 0;

  // Money only moves back for an order that was actually paid up front. A cash order was
  // never charged for this parcel — cancelling it simply means no courier calls.
  const prepaid = ["wallet", "credit_card"].includes(order.transaction?.payment_method)
    && order.transaction?.status === "paid";

  // A company-account order (feature 14) is refunded the way it was paid: the company's
  // share comes off its bill and back to the limit, the employee's own part to their
  // wallet — in the proportion the order was split.
  const companyPaid = order.transaction?.payment_method === "company_account" && !!order.company;
  if (companyPaid && refundAmount > 0) {
    try {
      const { duplicate } = await require("./companyOrderService").refundShare({
        order,
        amount: refundAmount,
        key: cycleKey(sub, `sub-order:${sub._id}:company-refund-cancel`),
        subOrderId: sub._id,
        reason: `Parcel ${sub.reference || sub._id} cancelled`,
        actor,
      });
      if (!duplicate) sub.refunded_amount = refundAmount;
    } catch (err) {
      console.error(`[Sub-order] Company refund failed for ${sub._id}: ${err.message}`);
    }
  }

  if (prepaid && refundAmount > 0) {
    try {
      const { duplicate } = await walletService.refundOrder({
        userId: order.paid_by_user_id || order.user_id,
        amountMinor: walletService.toMinor(refundAmount),
        orderId: order._id,
        reason: `Parcel ${sub.reference || sub._id} cancelled`,
        // Keyed on the PARCEL, so cancelling two parcels on one order refunds twice while
        // cancelling the same parcel twice refunds once. Suffixed per reactivation cycle —
        // see `cycleKey`.
        idempotencyKey: cycleKey(sub, `sub-order:${sub._id}:wallet-refund-cancel`),
        actor,
      });
      if (!duplicate) sub.refunded_amount = refundAmount;
    } catch (err) {
      console.error(`[Sub-order] Wallet refund failed for ${sub._id}: ${err.message}`);
    }
  }

  // Points this parcel consumed come back whatever the payment method was — they were spent
  // at checkout, before any of this.
  const loyaltyBack = Math.round(
    Number(order.loyalty?.redeemed_points || 0) *
    (Number(order.loyalty?.redemption_discount || 0) > 0
      ? Number(sub.loyalty_share || 0) / Number(order.loyalty.redemption_discount)
      : 0)
  );
  if (loyaltyBack > 0) {
    try {
      const restored = await loyaltyService.restorePoints({
        userId: order.loyalty?.payer_user_id || order.user_id,
        points: loyaltyBack,
        orderId: order._id,
        reason: "Parcel cancelled",
        idempotencyKey: cycleKey(sub, `sub-order:${sub._id}:redeem-restore-cancel`),
      });
      if (restored) order.loyalty.restored_points = Number(order.loyalty.restored_points || 0) + loyaltyBack;
    } catch (err) {
      console.error(`[Sub-order] Point restore failed for ${sub._id}: ${err.message}`);
    }
  }

  subOrderService.appendSubHistory(
    sub, "sub_order_cancelled", "Parcel cancelled",
    [
      String(reason || "").trim(),
      sub.refunded_amount
        ? (companyPaid
          ? `${sub.refunded_amount.toFixed(2)} taken off the company account (any part the customer paid went back to their wallet).`
          : `${sub.refunded_amount.toFixed(2)} returned to the wallet.`)
        : "",
      loyaltyBack ? `${loyaltyBack} point(s) returned.` : "",
      couponDropped ? "The coupon no longer applies to what remains and was removed." : "",
      pickupOutcome
        ? (pickupOutcome.visit_cancelled
          ? `Bosta pickup #${pickupOutcome.bosta_pickup_id} had nothing left to collect and was cancelled.`
          : `Removed from Bosta pickup #${pickupOutcome.bosta_pickup_id}; ${pickupOutcome.remaining} parcel(s) remain on it.`)
        : "",
      pickupOutcome?.warning ? `WARNING: ${pickupOutcome.warning}` : "",
      strandedTracking ? `WARNING: cancel ${strandedTracking} at ${strandedLabel} by hand${shipProvider === "arrive" ? " (Arrive portal → request → cancel shipment)" : ""}.` : "",
    ].filter(Boolean).join(" "),
    {
      cancelled_by: byRole,
      courier: shipProvider,
      from: statusBefore,
      pickup: pickupOutcome,
      refunded: sub.refunded_amount,
      points_restored: loyaltyBack,
      coupon_dropped: couponDropped,
      coupon_discount_before: couponDiscountBefore,
      stranded_tracking: strandedTracking,
      bosta_tracking_number: shipment?.bosta_tracking_number || shipment?.tracking_number || null,
      shipment_id: shipment?._id || null,
      cycle: Number(sub.reactivation_count || 0),
    },
    actor
  );

  syncVendorSupervision(order, sub.vendor_id);
  subOrderService.syncOrderStatus(order, actor.label || "System");
  await order.save();

  // A company-batch member released to the vendor and cancelled before the combined
  // parcel shipped: the colleagues keep their share, the company covers the difference,
  // and the lead moves on if this was it.
  if (statusBefore !== "held_in_batch" && sub.company_batch?.role) {
    await require("./companyBatchService").onReleasedMemberCancelled(order, sub, actor)
      .catch((err) => console.error(`[Sub-order] Batch update after cancelling ${sub._id} failed: ${err.message}`));
  }

  // The vendor hears about it too — most of all when the box is already sealed on their
  // counter with a courier on the way: they must not hand it over. Not for an order that
  // was still waiting in a company batch: the vendor never saw it.
  if (byRole !== "vendor" && statusBefore !== "held_in_batch") {
    const sealed = ["ready_for_pickup", "pickup_scheduled"].includes(statusBefore);
    const ref = sub.reference || String(sub._id);
    try {
      const { createNotification } = require("../models/notifications");
      await createNotification(
        sub.vendor_id,
        "sub_order_cancelled",
        sealed ? `Parcel ${ref} cancelled — do not hand it to the courier` : `Parcel ${ref} cancelled`,
        [
          byRole === "customer" ? `The customer cancelled parcel ${ref}.` : `The website team cancelled parcel ${ref}.`,
          sealed ? "It is still at your branch: unpack it and put the items back in stock." : "Stop preparing it.",
          pickupOutcome?.visit_cancelled
            ? `The courier visit booked for it (Bosta pickup #${pickupOutcome.bosta_pickup_id}) was cancelled.`
            : pickupOutcome
              ? `The courier is still coming for your other ${pickupOutcome.remaining} parcel(s).`
              : "",
        ].filter(Boolean).join(" "),
        { order_id: order._id, sub_order_id: sub._id, cancelled_by: byRole, pickup: pickupOutcome }
      );
    } catch (err) {
      console.error(`[Sub-order] Vendor notification failed for ${sub._id}: ${err.message}`);
    }
  }

  const vendorName = await vendorNameFor(sub.vendor_id);
  await notifyAboutParcel(order, sub, {
    type: "sub_order_cancelled",
    title_en: `Part of your order was cancelled`,
    title_ar: `تم إلغاء جزء من طلبك`,
    message_en: `The parcel from ${vendorName} was cancelled.${sub.refunded_amount ? ` ${sub.refunded_amount.toFixed(2)} has been returned to your wallet.` : ""} The rest of your order is unaffected.`,
    message_ar: `تم إلغاء شحنة ${vendorName}.${sub.refunded_amount ? ` تمت إعادة ${sub.refunded_amount.toFixed(2)} إلى محفظتك.` : ""} باقي طلبك لم يتأثر.`,
  });

  return {
    order, sub, refunded: sub.refunded_amount, points_restored: loyaltyBack,
    coupon_dropped: couponDropped,
    pickup: pickupOutcome,
    stranded_tracking: strandedTracking,
    // Which portal the admin has to go and cancel it in. Without this the screen guessed
    // "Bosta", sending them to look for an Arrive waybill in the wrong company's portal —
    // and a parcel nobody cancels is a parcel we are billed for.
    stranded_courier: strandedTracking ? shipProvider : null,
  };
};

/* ------------------------------------------------------------------ */
/*  Reactivation — reversing a cancellation                            */
/* ------------------------------------------------------------------ */

/** The most recent cancellation entry in this parcel's history, if any. */
const latestCancelEntry = (sub) =>
  [...(sub.history || [])].reverse().find((h) => h.action === "sub_order_cancelled") || null;

/**
 * Where a reactivated parcel goes back to.
 *
 * Its Bosta delivery — if it ever had one — was terminated and cannot be revived, so a
 * dispatched parcel returns to the vendor's stage ① with its item decisions intact: the
 * next "confirm" (or the admin's Send button) creates a fresh delivery. A parcel that never
 * reached Bosta simply goes back to where it was.
 */
const restoredStatusFor = (order, sub, hadShipment) => {
  const items = subOrderService.subOrderItems(order, sub);
  if (items.some((i) => i.vendor_status === "pending")) return "pending_review";
  if (items.some((i) => i.vendor_status === "declined")) return "needs_admin";
  const before = sub.status_before_cancel;
  if (!hadShipment && ["pending_review", "needs_admin", "awaiting_tracking"].includes(before)) return before;
  return "pending_review";
};

/**
 * Reverse a cancellation: put the parcel back on the flow and take back exactly what the
 * cancellation gave out.
 *
 * Everything is checked BEFORE anything moves. The wallet re-charge and the point
 * re-consumption are the only writes that cannot be undone by discarding the document,
 * so they happen last before the save and each is compensated if the next step fails.
 *
 *   · Money      the refunded share is charged back to the wallet that received it. A
 *                customer who already spent it cannot have the parcel reinstated — the
 *                call refuses with INSUFFICIENT_WALLET rather than creating debt.
 *   · Points     points the cancellation returned are consumed again, same rule.
 *   · Coupon     a coupon dropped by a customer cancellation is restored to what it was.
 *   · Bosta      the old shipment row is kept, marked superseded; the parcel loses its
 *                tracking number so a NEW delivery is created on the next dispatch. A
 *                delivery the cancel could not terminate is terminated again here.
 *   · Record     the cancellation itself is archived on the parcel (`cancellations`), so
 *                the live cancel fields can be cleared without losing what happened.
 *
 * Admin only: cancellation is the customer's right, reversing it is not.
 */
const reactivateSubOrder = async ({ orderId, subOrderId, reason, actor }) => {
  const { order, sub } = await loadSubOrder(orderId, subOrderId);

  if (sub.status !== "cancelled") throw fail("Only a cancelled parcel can be reactivated", "NOT_CANCELLED");
  if (!String(reason || "").trim()) throw fail("A written reason is required to reactivate a parcel", "REASON_REQUIRED");

  const items = subOrderService.subOrderItems(order, sub);
  if (items.length === 0) throw fail("This parcel has no items left to reinstate", "EMPTY_PARCEL");

  const vendor = await Seller.findById(sub.vendor_id).select("_id store_name is_active status").lean();
  if (!vendor) throw fail("The vendor for this parcel no longer exists", "VENDOR_GONE");

  const cancelEntry = latestCancelEntry(sub);
  const meta = cancelEntry?.metadata || {};

  // What the cancellation handed out. The parcel's own field is authoritative for money;
  // the history entry is the only record of the points figure.
  const rechargeAmount = Number(sub.refunded_amount || 0);
  const pointsBack = Number(meta.points_restored || 0);
  const couponWasDropped = !!meta.coupon_dropped;

  const payerId = order.paid_by_user_id || order.user_id;
  const loyaltyPayerId = order.loyalty?.payer_user_id || order.user_id;

  // On a company order only the employee's own part of the refund came from — and goes
  // back to — their wallet; the company's part is re-charged on its ledger instead.
  const companyPaid = order.transaction?.payment_method === "company_account" && !!order.company;
  const companySplit = companyPaid && rechargeAmount > 0
    ? require("./companyOrderService").splitAmount(order, rechargeAmount)
    : null;
  const walletRecharge = companySplit ? companySplit.personal : rechargeAmount;

  // ---- Pre-flight: refuse before touching anything ----
  if (walletRecharge > 0) {
    const bal = await walletService.getBalances(payerId);
    const available = Number(bal?.available ?? bal?.available_balance ?? 0);
    if (available + 1e-9 < walletRecharge) {
      throw fail(
        `The customer's wallet holds ${available.toFixed(2)} but ${walletRecharge.toFixed(2)} must be charged back to reinstate this parcel`,
        "INSUFFICIENT_WALLET"
      );
    }
  }
  if (pointsBack > 0) {
    const bal = await loyaltyService.getBalances(loyaltyPayerId);
    if (Number(bal?.available_points || 0) < pointsBack) {
      throw fail(
        `The customer has ${Number(bal?.available_points || 0)} point(s) but ${pointsBack} must be taken back to reinstate this parcel`,
        "INSUFFICIENT_POINTS"
      );
    }
  }

  const cycle = Number(sub.reactivation_count || 0);
  const now = new Date();

  // ---- Bosta: the old delivery is dead; make sure it really is ----
  const oldShipment = subOrderService.liveShipmentFor(order, sub);
  let strandedTracking = null;
  if (oldShipment && couriers.providerOfShipment(oldShipment) === "arrive" && oldShipment.tracking_number) {
    // Nothing to call: the old Arrive waybill must be cancelled in their portal by hand.
    strandedTracking = oldShipment.tracking_number;
  } else if (oldShipment?.bosta_delivery_id && meta.stranded_tracking) {
    // The cancel could not terminate it, so it may still be live at Bosta. One more try;
    // a second failure is reported, never hidden — two live deliveries for one parcel is
    // the outcome this exists to prevent.
    try {
      await bostaService.terminateDelivery(oldShipment.bosta_delivery_id);
    } catch (err) {
      strandedTracking = oldShipment.bosta_tracking_number || oldShipment.bosta_delivery_id;
      console.error(`[Sub-order] Reactivation could not terminate Bosta delivery ${strandedTracking}: ${err.message}`);
    }
  }

  // ---- In-memory mutation (nothing persisted yet) ----
  const restoredStatus = restoredStatusFor(order, sub, !!oldShipment);

  sub.cancellations = sub.cancellations || [];
  sub.cancellations.push({
    cancelled_at: sub.cancelled_at,
    cancelled_by_role: sub.cancelled_by_role,
    cancel_reason: sub.cancel_reason,
    status_before: sub.status_before_cancel || meta.from || null,
    refunded_amount: rechargeAmount,
    points_restored: pointsBack,
    coupon_dropped: couponWasDropped,
    coupon_discount_before: meta.coupon_discount_before ?? null,
    stranded_tracking: meta.stranded_tracking || null,
    bosta_tracking_number: oldShipment?.bosta_tracking_number || sub.bosta_tracking_number || null,
    shipment_id: oldShipment?._id || sub.shipment_id || null,
    reactivated_at: now,
    reactivated_by_label: actor.label || "Admin",
    reactivation_reason: String(reason).trim(),
    recharged_amount: rechargeAmount,
    points_reconsumed: pointsBack,
    coupon_restored: couponWasDropped,
    restored_status: restoredStatus,
  });

  if (oldShipment) {
    oldShipment.superseded_at = now;
    oldShipment.superseded_reason = `Parcel reactivated by ${actor.label || "Admin"}; a new delivery replaces this one`;
  }

  sub.status = restoredStatus;
  sub.cancelled_at = null;
  sub.cancelled_by_role = null;
  sub.cancel_reason = "";
  sub.refunded_amount = 0;
  sub.status_before_cancel = null;
  sub.cancel_request = { requested_at: null, requested_by_role: null, requested_by_label: null, reason: "" };
  sub.reactivation_count = cycle + 1;
  sub.reactivated_at = now;
  // A company-batch member comes back as an ordinary parcel: its batch has moved on
  // without it (feature 14). The record of the batch stays on the parcel.
  if (sub.company_batch?.joined_at) {
    sub.company_batch.role = null;
    sub.company_batch.mirror_status = null;
    if (!sub.company_batch.left_at) {
      sub.company_batch.left_at = now;
      sub.company_batch.left_reason = "cancelled";
    }
  }
  if (!sub.deadline_at) sub.deadline_at = new Date(now.getTime() + 48 * 3600 * 1000);
  if (strandedTracking) {
    // The retired waybill may still be live at the courier; keep (or raise) the reminder.
    if (!sub.courier_cancel_pending?.at || sub.courier_cancel_pending.done_at) {
      sub.courier_cancel_pending = { provider: couriers.providerOfShipment(oldShipment), tracking_number: strandedTracking, at: now, done_at: null, done_by_label: "" };
    }
  }

  // Fulfilment links: a new delivery will be created, so none of these may point at the
  // old one. Photos are kept — they are still evidence of what the vendor packed.
  sub.shipment_id = null;
  sub.bosta_tracking_number = null;
  sub.tracking_number = null;
  sub.dispatch_attempt = { provider: null, reference: null, at: null };
  sub.pickup_id = null;
  sub.pickup_booked_at = null;
  sub.tracking_assigned_at = null;
  sub.ready_at = null;
  sub.handed_over_at = null;
  sub.handed_over_by_label = "";
  if (restoredStatus !== "awaiting_tracking") sub.items_confirmed_at = null;
  if (restoredStatus === "needs_admin") {
    sub.needs_admin_since = sub.needs_admin_since || now;
    if (!sub.needs_admin_reason) {
      sub.needs_admin_reason = items
        .filter((i) => i.vendor_status === "declined")
        .map((i) => `${i.product_title}: ${i.vendor_note || "no reason given"}`)
        .join("; ");
    }
  } else {
    sub.needs_admin_since = null;
    sub.needs_admin_reason = "";
  }

  // A fresh deadline of the same length the parcel originally had: the vendor is being
  // asked to start again, and an already-expired deadline would flag it overdue at once.
  if (sub.deadline_at && sub.created_at) {
    const span = new Date(sub.deadline_at).getTime() - new Date(sub.created_at).getTime();
    sub.deadline_at = new Date(now.getTime() + Math.max(span, 0));
  }
  sub.deadline_reminded_at = null;
  sub.is_overdue = false;

  let couponRestored = false;
  if (couponWasDropped) {
    const restoreTo = meta.coupon_discount_before != null
      ? Number(meta.coupon_discount_before)
      : (order.sub_orders || []).reduce((sum, s) => sum + Number(s.coupon_share || 0), 0);
    if (restoreTo > 0 && Number(order.coupon_discount_amount || 0) === 0) {
      order.coupon_discount_amount = restoreTo;
      couponRestored = true;
      order.history = order.history || [];
      order.history.push({
        action: "coupon_restored",
        title: "Coupon applies again",
        details: `The parcel whose cancellation removed ${order.coupon_code} was reinstated, so the ${restoreTo.toFixed(2)} discount is back.`,
        actor_role: actor.role || "admin",
        actor_label: actor.label || "Admin",
        metadata: { coupon_code: order.coupon_code, restored: restoreTo },
        created_at: now,
      });
    }
  }

  if (pointsBack > 0 && order.loyalty) {
    order.loyalty.restored_points = Math.max(0, Number(order.loyalty.restored_points || 0) - pointsBack);
  }

  subOrderService.appendSubHistory(
    sub, "sub_order_reactivated", "Parcel reinstated",
    [
      String(reason).trim(),
      rechargeAmount
        ? (companySplit
          ? `${companySplit.company.toFixed(2)} charged back to the company account${walletRecharge > 0 ? ` and ${walletRecharge.toFixed(2)} to the wallet` : ""}.`
          : `${rechargeAmount.toFixed(2)} charged back to the wallet.`)
        : "",
      pointsBack ? `${pointsBack} point(s) taken back.` : "",
      couponRestored ? "The coupon applies again." : "",
      (oldShipment?.tracking_number || oldShipment?.bosta_tracking_number)
        ? `Previous ${couriers.labelOf(couriers.providerOfShipment(oldShipment))} delivery ${oldShipment.tracking_number || oldShipment.bosta_tracking_number} is retired; a new one is created on the next dispatch.`
        : "",
      strandedTracking ? `WARNING: cancel ${strandedTracking} at ${couriers.labelOf(couriers.providerOfShipment(oldShipment))} by hand before dispatching.` : "",
      `Back to ${restoredStatus}.`,
    ].filter(Boolean).join(" "),
    {
      reactivated_by: actor.role || "admin",
      restored_status: restoredStatus,
      recharged: rechargeAmount,
      points_reconsumed: pointsBack,
      coupon_restored: couponRestored,
      previous_tracking: oldShipment?.tracking_number || oldShipment?.bosta_tracking_number || null,
      previous_courier: oldShipment ? couriers.providerOfShipment(oldShipment) : null,
      stranded_tracking: strandedTracking,
      cycle: cycle + 1,
    },
    actor
  );

  syncVendorSupervision(order, sub.vendor_id);
  subOrderService.syncOrderStatus(order, actor.label || "Admin");

  // ---- Ledger writes, then the save; each later failure undoes the earlier writes ----
  const walletKey = `sub-order:${sub._id}:wallet-recharge-reactivate:r${cycle + 1}`;
  const pointsKey = `sub-order:${sub._id}:redeem-reconsume-reactivate:r${cycle + 1}`;
  let walletDone = false;
  let pointsDone = false;

  const companyKey = `sub-order:${sub._id}:company-recharge-reactivate:r${cycle + 1}`;
  let companyDone = false;

  const undoLedger = async () => {
    if (companyDone) {
      await require("./companyOrderService").refundShare({
        order, amount: companySplit.company, key: `${companyKey}:undo`, subOrderId: sub._id,
        reason: "Reactivation failed — company charge reversed", actor,
      }).catch((e) => console.error(`[Sub-order] Could not undo company re-charge for ${sub._id}: ${e.message}`));
    }
    if (pointsDone) {
      await loyaltyService.restorePoints({
        userId: loyaltyPayerId, points: pointsBack, orderId: order._id,
        reason: "Reactivation failed — points returned",
        idempotencyKey: `${pointsKey}:undo`,
      }).catch((e) => console.error(`[Sub-order] Could not undo point re-consumption for ${sub._id}: ${e.message}`));
    }
    if (walletDone) {
      await walletService.refundOrder({
        userId: payerId, amountMinor: walletService.toMinor(walletRecharge), orderId: order._id,
        reason: "Reactivation failed — money returned",
        idempotencyKey: `${walletKey}:undo`, actor,
      }).catch((e) => console.error(`[Sub-order] Could not undo wallet re-charge for ${sub._id}: ${e.message}`));
    }
  };

  try {
    if (companySplit && companySplit.company > 0) {
      await require("./companyOrderService").chargeBack({
        order,
        amount: rechargeAmount,
        key: companyKey,
        subOrderId: sub._id,
        reason: `Parcel ${sub.reference || sub._id} reinstated`,
        actor,
      });
      companyDone = true;
    }
    if (walletRecharge > 0) {
      const { duplicate } = await walletService.rechargeOrder({
        userId: payerId,
        amountMinor: walletService.toMinor(walletRecharge),
        orderId: order._id,
        reason: `Parcel ${sub.reference || sub._id} reinstated`,
        idempotencyKey: walletKey,
        actor,
      });
      walletDone = !duplicate;
    }
    if (pointsBack > 0) {
      await loyaltyService.consumePoints({
        userId: loyaltyPayerId,
        points: pointsBack,
        orderId: order._id,
        idempotencyKey: pointsKey,
        reason: `Parcel ${sub.reference || sub._id} reinstated`,
      });
      pointsDone = true;
    }
    await order.save();
  } catch (err) {
    await undoLedger();
    if (err.code === "INSUFFICIENT_BALANCE") throw fail(err.message, "INSUFFICIENT_WALLET");
    if (err.code === "INSUFFICIENT_POINTS") throw fail(err.message, "INSUFFICIENT_POINTS");
    throw err;
  }

  const vendorName = await vendorNameFor(sub.vendor_id);
  await notifyAboutParcel(order, sub, {
    type: "sub_order_reactivated",
    title_en: "Part of your order is back on",
    title_ar: "تمت إعادة تفعيل جزء من طلبك",
    message_en: `The parcel from ${vendorName} that was cancelled has been reinstated${rechargeAmount ? ` and ${rechargeAmount.toFixed(2)} was charged back to your wallet` : ""}. It will be prepared and shipped as normal.`,
    message_ar: `تمت إعادة تفعيل شحنة ${vendorName} التي كانت ملغاة${rechargeAmount ? ` وتم خصم ${rechargeAmount.toFixed(2)} من محفظتك مرة أخرى` : ""}. سيتم تجهيزها وشحنها كالمعتاد.`,
  });

  return {
    order,
    sub,
    restored_status: restoredStatus,
    recharged: rechargeAmount,
    points_reconsumed: pointsBack,
    coupon_restored: couponRestored,
    previous_tracking: oldShipment?.tracking_number || oldShipment?.bosta_tracking_number || null,
    previous_courier: oldShipment ? couriers.providerOfShipment(oldShipment) : null,
    stranded_tracking: strandedTracking,
    stranded_courier: strandedTracking && oldShipment ? couriers.providerOfShipment(oldShipment) : null,
  };
};

/**
 * Re-check the coupon against what the order will still contain.
 *
 * Only ever called for a customer-initiated cancellation. Cancelling parcels until the
 * remainder slips under a coupon's minimum is otherwise a free discount, and it becomes
 * exploitable the moment customers can cancel parts of an order themselves.
 *
 * @returns {boolean} true if the coupon was dropped
 */
const revalidateCouponAfterCancel = async (order, cancellingSub) => {
  if (!order.coupon_code || !(Number(order.coupon_discount_amount) > 0)) return false;

  try {
    const { findCouponByCode } = require("./couponService");
    const coupon = await findCouponByCode(order.coupon_code);
    const minimum = Number(coupon?.min_order_amount || 0);
    if (minimum <= 0) return false;

    const remaining = (order.sub_orders || [])
      .filter((s) => subOrderService.isLive(s) && s._id.toString() !== cancellingSub._id.toString())
      .reduce((sum, s) => sum + Number(s.merchandise_total || 0), 0);

    if (remaining >= minimum) return false;

    order.coupon_discount_amount = 0;
    order.history = order.history || [];
    order.history.push({
      action: "coupon_removed",
      title: "Coupon no longer applies",
      details:
        `After this cancellation the order comes to ${remaining.toFixed(2)}, below the ` +
        `${minimum.toFixed(2)} minimum for ${order.coupon_code}. The discount was removed.`,
      actor_role: "system",
      actor_label: "System",
      metadata: { coupon_code: order.coupon_code, minimum, remaining },
      created_at: new Date(),
    });
    return true;
  } catch (err) {
    // Never block a cancellation on this. Leaving the discount in place costs the store a
    // little; refusing to cancel costs the customer their money.
    console.error(`[Sub-order] Coupon re-validation failed for ${order._id}: ${err.message}`);
    return false;
  }
};

/* ------------------------------------------------------------------ */
/*  Admin intervention                                                */
/* ------------------------------------------------------------------ */

/** Put a parked parcel back in the vendor's hands once the admin has sorted the items out. */
const releaseIntervention = async ({ orderId, subOrderId, note = "", actor }) => {
  const { order, sub } = await loadSubOrder(orderId, subOrderId);
  if (sub.status !== "needs_admin") throw fail("This parcel is not waiting on you", "WRONG_STAGE");

  const items = subOrderService.subOrderItems(order, sub);
  if (items.length === 0) throw fail("This parcel has no items left — cancel it instead", "EMPTY_PARCEL");
  if (items.some((i) => i.vendor_status === "declined")) {
    throw fail("Replace or remove the unavailable items first", "STILL_DECLINED");
  }

  sub.status = "pending_review";
  sub.needs_admin_reason = "";
  sub.needs_admin_since = null;

  subOrderService.appendSubHistory(
    sub, "intervention_resolved", "Returned to the vendor",
    note || "The order team resolved the unavailable items.", {}, actor
  );

  syncVendorSupervision(order, sub.vendor_id);
  subOrderService.syncOrderStatus(order, actor.label || "Admin");
  await order.save();
  return { order, sub };
};

/**
 * Close a parcel by hand after Bosta has stopped moving it.
 *
 * Deliberately narrow: an admin may only mark a parcel delivered, returned or cancelled, and
 * only with a written reason. Bosta stays the source of truth for everything else — this
 * exists because a parcel stuck in Bosta's `exception` otherwise sits there for ever.
 */
const adminCloseSubOrder = async ({ orderId, subOrderId, status, reason, actor }) => {
  const allowed = ["delivered", "returned", "cancelled"];
  if (!allowed.includes(status)) {
    throw fail(`An admin may only close a parcel as ${allowed.join(", ")}`, "INVALID_STATUS");
  }
  if (!String(reason || "").trim()) {
    throw fail("A written reason is required to override a parcel's status", "REASON_REQUIRED");
  }

  if (status === "cancelled") {
    return cancelSubOrder({ orderId, subOrderId, reason, actor, byRole: "admin", skipWindowCheck: true });
  }

  const { order, sub } = await loadSubOrder(orderId, subOrderId);
  // A company order still collecting in its batch has not even reached the vendor, so it
  // cannot have been delivered or returned. Cancelling it (above) is the only way out.
  if (sub.status === "held_in_batch") {
    throw fail(
      "This company order is still collecting in its batch — it has not reached the vendor yet. Close the batch from the company page, or cancel the parcel.",
      "BATCH_WAITING",
      409
    );
  }
  const from = sub.status;
  sub.status = status;
  if (status === "delivered" && !sub.delivered_at) sub.delivered_at = new Date();

  subOrderService.appendSubHistory(
    sub, "admin_status_override", "Status set by the website team",
    `${from} → ${status}. Reason: ${String(reason).trim()}`,
    { from, to: status, reason: String(reason).trim() }, actor
  );

  subOrderService.syncOrderStatus(order, actor.label || "Admin");
  await order.save();

  // Delivery is what earns loyalty and releases the vendor's money, whether Bosta reported
  // it or a human did.
  if (status === "delivered") {
    const { onSubOrderDelivered } = require("./orderService");
    await onSubOrderDelivered(order, sub).catch((err) =>
      console.error(`[Sub-order] Delivery hook failed for ${sub._id}: ${err.message}`));
  }

  // A parcel coming back can be the event that settles the order — the others already
  // arrived and nothing is moving any more. That is an order which earned on what the
  // customer kept, and `onSubOrderDelivered` will never fire for it because nothing was
  // delivered here.
  if (status === "returned") {
    const { onOrderCompleted } = require("./orderService");
    const live = (order.sub_orders || []).filter(subOrderService.isLive);
    const settled = live.every((s) => s.status === "delivered" || s.status === "returned");
    if (live.length > 0 && settled) {
      await onOrderCompleted(order).catch((err) =>
        console.error(`[Sub-order] Earn hook failed for order ${order._id}: ${err.message}`));
    }
  }

  // Closing the last parcel as returned takes the whole order back out of "delivered", and
  // points held for a return window the goods did not survive are not points the customer
  // earned. Reversed here rather than left for the daily sweep, so the customer is not
  // looking at pending points for an order they no longer have.
  if (loyaltyService.DEAD_EARN_ORDER_STATUSES.includes(order.status)) {
    await loyaltyService.reverseOutstandingEarn({
      order,
      reason: `Order ${order.status}`,
    }).catch((err) =>
      console.error(`[Sub-order] Earn reversal failed for order ${order._id}: ${err.message}`));
  }

  return { order, sub };
};

/** Raise the "needs your attention" flag for the admin team. */
const notifyAdminsOfIntervention = async (order, sub, what = "an unavailable item") => {
  try {
    const { createNotification } = require("../models/notifications");
    const { User } = require("../models/users");
    const admins = await User.find({ role: "admin" }).select("_id").lean();
    const vendorName = await vendorNameFor(sub.vendor_id);
    const reference = order.transaction?.reference || order._id;
    await Promise.allSettled(
      admins.map((a) =>
        createNotification(
          a._id,
          "sub_order_needs_admin",
          "A parcel needs your attention",
          `Order #${reference} — ${vendorName} reported ${what}.`,
          { order_id: order._id, sub_order_id: sub._id, reason: sub.needs_admin_reason || "" }
        )
      )
    );
  } catch (err) {
    console.error(`[Sub-order] Admin notification failed: ${err.message}`);
  }
};

module.exports = {
  MAX_PARCEL_PHOTOS,
  loadSubOrder,
  vendorActor,
  syncVendorSupervision,
  reviewItem,
  approveAllItems,
  declineAllItems,
  confirmItems,
  assignTracking,
  createPrintedShipment,
  addParcelPhotos,
  removeParcelPhoto,
  markReadyForPickup,
  confirmHandover,
  requestCancellation,
  cancelSubOrder,
  reactivateSubOrder,
  revalidateCouponAfterCancel,
  releaseIntervention,
  adminCloseSubOrder,
  notifyAdminsOfIntervention,
};
