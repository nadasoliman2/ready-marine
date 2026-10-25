const { SmartLabel } = require("../models/smartLabels");
const { Order } = require("../models/orders");
const { Seller } = require("../models/sellers");
const shippingEngine = require("./shippingEngine");

/**
 * Smart Label — the vendor sticks a pre-printed Bosta label on the parcel and scans it,
 * and that number becomes the shipment's tracking number when the admin presses "ready".
 *
 * Scanning reserves the number HERE ONLY. Nothing is sent to Bosta until dispatch, which
 * keeps the admin's dispatch decision exactly where it is today and makes every correction
 * before it free — unlinking a reservation cancels nothing, because nothing exists yet.
 *
 * The local duplicate check is not a claim of authority over the numbers. Bosta owns them
 * and rejects a number already in use at create time. Checking first only saves that call
 * and, far more importantly, tells the vendor while they are still holding the parcel.
 */

// Order statuses in which a parcel may still be labelled.
//
// The `partially_*` values matter as much as the rest now: on a three-vendor order the
// first parcel going to Bosta moves the ORDER to `partially_shipped`, and without them the
// second vendor would be refused a label for a parcel that has not left their shop.
const PRE_DISPATCH_ORDER_STATUSES = [
  "pending", "processing", "confirmed", "ready",
  "partially_shipped", "partially_delivered",
];

async function isEnabled() {
  const settings = await shippingEngine.getSettings();
  return settings?.smart_label_enabled === true;
}

async function assertEnabled() {
  if (!(await isEnabled())) {
    throw new Error("Smart Label scanning is not enabled.");
  }
}

/** Human label for an order, for error messages that must name the clashing order. */
function orderRef(order) {
  return order?.transaction?.reference || order?._id?.toString() || "";
}

/** Resolve who is acting, so history and the label row name a person, not a role. */
async function resolveActor(actor = {}) {
  if (actor.role === "vendor") {
    const vendor = await Seller.findById(actor.id).select("store_name store_username name").lean();
    return {
      role: "vendor",
      label: actor.label || vendor?.store_name || vendor?.store_username || vendor?.name || "Vendor",
    };
  }
  return { role: "admin", label: actor.label || "Admin" };
}

function appendHistory(order, action, title, details, metadata, actor) {
  order.history = order.history || [];
  order.history.push({
    action,
    title,
    details,
    actor_role: actor.role || "system",
    actor_label: actor.label || "System",
    metadata,
    created_at: new Date(),
  });
}

/**
 * The shipment already dispatched for this vendor, if any.
 *
 * Reads the generic `tracking_number` as well as Bosta's own: an Arrive parcel never writes
 * `bosta_tracking_number`, so checking only that would report "not dispatched" for a parcel
 * that is already with a courier and let a label be stuck onto it.
 */
function dispatchedShipment(order, vendorId) {
  return (order.shipments || []).find(
    (s) => s.vendor_id?.toString() === vendorId.toString()
      && (s.tracking_number || s.bosta_tracking_number)
      && !s.superseded_at
  );
}

/** This vendor's approved items on the order. */
function approvedItems(order, vendorId) {
  return (order.items || []).filter(
    (i) => i.vendor_id?.toString() === vendorId.toString() && i.vendor_status === "approved"
  );
}

/**
 * Message for a number that is already spoken for, naming the order holding it — a bare
 * "duplicate" leaves the vendor with no idea which parcel to look at.
 */
async function duplicateMessage(trackingNumber) {
  const held = await SmartLabel.findOne({ tracking_number: trackingNumber }).lean();
  const orderId = held?.order_id || null;
  if (!orderId) {
    const shipped = await Order.findOne({
      $or: [
        { "shipments.smart_label_barcode": trackingNumber },
        // Before September 2026 the sticker WAS the tracking number.
        { "shipments.bosta_tracking_number": trackingNumber },
      ],
    })
      .select("transaction.reference")
      .lean();
    if (shipped) {
      return `This label is already on order #${orderRef(shipped)}. Use another label.`;
    }
    return "This label is already in use. Use another label.";
  }
  const order = await Order.findById(orderId).select("transaction.reference").lean();
  return `This label is already registered on order #${orderRef(order) || orderId}. Use another label.`;
}

/**
 * Scan a label onto a vendor's shipment-to-be.
 *
 * @param {Object} args
 * @param {string} args.orderId
 * @param {string} args.vendorId  whose shipment the label belongs to
 * @param {string} args.trackingNumber  exactly what the scanner read
 * @param {{ role: 'vendor'|'admin', id?: string, label?: string }} args.actor
 * @returns {Object} the created reservation (lean)
 */
async function scanLabel({ orderId, vendorId, trackingNumber, actor = {}, order: heldByCaller = null }) {
  await assertEnabled();

  // Scanned verbatim, by design: no length or shape filter, because Bosta's label format is
  // not documented to us and a guessed filter would reject real labels. The accepted cost is
  // that a product barcode scanned by mistake is taken as a tracking number.
  const number = String(trackingNumber || "").trim();
  if (!number) throw new Error("No label was scanned.");

  // A caller mid-flow hands in the document it is already holding. Loading a second copy
  // of the same order and saving it here would bump `__v` underneath them, and their own
  // save — the one that persists the tracking number and moves the parcel on — would then
  // fail with a VersionError against a document it can no longer match.
  const order = heldByCaller || await Order.findById(orderId);
  if (!order) throw new Error("Order not found");
  if (!PRE_DISPATCH_ORDER_STATUSES.includes(order.status)) {
    throw new Error("This order can no longer be labelled — it has already left for delivery.");
  }

  const supervision = (order.vendor_supervisions || []).find(
    (vs) => vs.vendor_id.toString() === vendorId.toString()
  );
  if (!supervision) throw new Error("This vendor has no items on this order.");

  // A parcel already on Bosta can still take a sticker — its first one was refused, or it
  // went out on the printed route — as long as it does not carry one yet. That case links
  // straight to the live delivery further down instead of reserving.
  const liveShipment = dispatchedShipment(order, vendorId);
  if (liveShipment && liveShipment.smart_label_barcode) {
    throw new Error(`This shipment already carries sticker ${liveShipment.smart_label_barcode} and cannot be relabelled.`);
  }
  if (liveShipment && liveShipment.provider && liveShipment.provider !== "bosta") {
    throw new Error("This shipment is with another courier and cannot take a Bosta sticker.");
  }

  // A Smart Label is a pre-printed BOSTA number. Reserving one for a parcel that will go out
  // with another courier burns the sticker for good: dispatch never releases a reservation it
  // did not consume, and the number is then refused on every future parcel.
  const couriers = require("./couriers");
  const subForVendor = (order.sub_orders || []).find((s) => s.vendor_id?.toString() === vendorId.toString());
  // Packed inside another order's combined parcel: that parcel's sticker is the one it
  // travels under. A sticker reserved here would never be dispatched — and is burned.
  if (subForVendor?.company_batch?.role === "rider") {
    throw new Error(
      `This order ships inside the combined parcel of order ${subForVendor.company_batch.lead_reference || ""} — it travels under that parcel's sticker.`
    );
  }
  const provider = await couriers.courierFor(subForVendor);
  if (!couriers.capabilities(provider).smartLabel) {
    throw new Error(
      `Smart Label works with Bosta only — this parcel is going out with ${couriers.labelOf(provider)}. Print the waybill instead.`
    );
  }
  if (supervision.status !== "supervised") {
    throw new Error("Review your items on this order before scanning a label.");
  }
  if (approvedItems(order, vendorId).length === 0) {
    throw new Error("There is nothing to ship for this vendor — no approved items.");
  }

  const existing = await SmartLabel.findOne({ order_id: order._id, vendor_id: vendorId }).lean();
  if (existing) {
    throw new Error(
      `This shipment already carries label ${existing.tracking_number}. Unlink it before scanning another.`
    );
  }

  const clash = await SmartLabel.findOne({ tracking_number: number }).lean();
  if (clash) throw new Error(await duplicateMessage(number));

  // A sticker that already shipped is gone for good even though no reservation holds it.
  const shipped = await Order.findOne({
    $or: [
      { "shipments.smart_label_barcode": number },
      { "shipments.bosta_tracking_number": number },
    ],
  })
    .select("transaction.reference")
    .lean();
  if (shipped) {
    throw new Error(`This label is already on order #${orderRef(shipped)}. Use another label.`);
  }

  // Ask Bosta whether the sticker is real and still free, while the vendor is holding the
  // parcel. Validation needs a tracking number in the payload but does not look it up
  // (verified against the live API), so a placeholder stands in for the delivery that
  // does not exist yet. Best-effort: only a definite "no" from Bosta refuses the scan; a
  // network failure lets the reservation through and the link at dispatch decides.
  try {
    await require("./bostaService").linkBarcode({ barcode: number, trackingNumber: "0000000", apply: false });
  } catch (err) {
    if (err.bostaCode) throw new Error(`Bosta does not accept this sticker: ${err.message}`);
  }

  const who = await resolveActor({ ...actor, id: actor.id || vendorId });

  if (liveShipment) {
    const sub = (order.sub_orders || []).find((x) => String(x._id) === String(liveShipment.sub_order_id));
    if (!sub) throw new Error("This shipment's parcel could not be found on the order.");
    // Lazy: bostaFulfillmentService requires this module.
    await require("./bostaFulfillmentService").linkStickerToShipment(order, sub, number);
    const linked = await SmartLabel.create({
      tracking_number: number,
      order_id: order._id,
      vendor_id: vendorId,
      fulfillment_location: supervision.fulfillment_location || "",
      status: "dispatched",
      scanned_by_role: who.role,
      scanned_by_label: who.label,
      scanned_at: new Date(),
    });
    appendHistory(
      order,
      "smart_label_scanned",
      "Smart label linked",
      `${who.label} scanned sticker ${number}; it is now linked to shipment ${liveShipment.bosta_tracking_number}.`,
      { vendor_id: vendorId.toString(), tracking_number: number, linked_to: liveShipment.bosta_tracking_number },
      who
    );
    if (!heldByCaller) await order.save();
    return linked.toObject();
  }

  let label;
  try {
    label = await SmartLabel.create({
      tracking_number: number,
      order_id: order._id,
      vendor_id: vendorId,
      fulfillment_location: supervision.fulfillment_location || "",
      status: "reserved",
      scanned_by_role: who.role,
      scanned_by_label: who.label,
      scanned_at: new Date(),
    });
  } catch (err) {
    // Lost a race — either someone else took the number, or another tab labelled this
    // shipment first. Both are unique-index violations; the message says which.
    if (err.code === 11000) {
      const mine = await SmartLabel.findOne({ order_id: order._id, vendor_id: vendorId }).lean();
      if (mine) {
        throw new Error(
          `This shipment already carries label ${mine.tracking_number}. Unlink it before scanning another.`
        );
      }
      throw new Error(await duplicateMessage(number));
    }
    throw err;
  }

  appendHistory(
    order,
    "smart_label_scanned",
    "Smart label scanned",
    `${who.label} scanned label ${number} for this shipment.`,
    { vendor_id: vendorId.toString(), tracking_number: number },
    who
  );
  // Whoever owns the document owns the save. Mutating and leaving it to the caller is the
  // contract the rest of this file already follows — see `releaseReservations`.
  if (!heldByCaller) await order.save();

  return label.toObject();
}

/**
 * Release a vendor's reservation so the label can be used again.
 * Refused once the delivery exists on Bosta — at that point the number belongs to a live
 * shipment, and freeing it here would let it be scanned onto a second parcel while Bosta
 * still has it. Cancelling that shipment on Bosta is the only way back.
 */
async function unlinkLabel({ orderId, vendorId, actor = {} }) {
  const order = await Order.findById(orderId);
  if (!order) throw new Error("Order not found");

  const label = await SmartLabel.findOne({ order_id: order._id, vendor_id: vendorId });
  if (!label) throw new Error("This shipment has no scanned label.");

  if (label.status === "dispatched" || dispatchedShipment(order, vendorId)) {
    throw new Error(
      "This label is already on a shipment at Bosta. Cancel that shipment on Bosta to release the number."
    );
  }

  const who = await resolveActor({ ...actor, id: actor.id || vendorId });
  await SmartLabel.deleteOne({ _id: label._id });

  appendHistory(
    order,
    "smart_label_unlinked",
    "Smart label unlinked",
    `${who.label} unlinked label ${label.tracking_number}; it can be scanned again.`,
    { vendor_id: vendorId.toString(), tracking_number: label.tracking_number },
    who
  );
  await order.save();

  return { tracking_number: label.tracking_number };
}

/** The reservation waiting to be sent for this vendor's shipment, if any. */
function reservationFor(orderId, vendorId) {
  return SmartLabel.findOne({ order_id: orderId, vendor_id: vendorId, status: "reserved" }).lean();
}

/** All labels on an order, for the admin's "who scanned and who didn't" view. */
function labelsForOrder(orderId) {
  return SmartLabel.find({ order_id: orderId }).lean();
}

/** Labels for a set of orders, keyed `${order_id}:${vendor_id}`. */
async function labelsForOrders(orderIds) {
  const labels = await SmartLabel.find({ order_id: { $in: orderIds } }).lean();
  const byKey = new Map();
  for (const l of labels) byKey.set(`${l.order_id}:${l.vendor_id}`, l);
  return byKey;
}

/** The number is now live on Bosta — freeze it so it can't be unlinked behind Bosta's back. */
async function markDispatched(labelId) {
  await SmartLabel.updateOne(
    { _id: labelId },
    { $set: { status: "dispatched", dispatched_at: new Date() } }
  );
}

/**
 * Give reserved numbers back.
 *
 * Every path that ends "this parcel is not going out after all" leads here: the order was
 * cancelled, the vendor's items were declined, or Bosta refused the number at dispatch. The
 * label is still physically fine — it gets peeled off and stuck on another parcel — so the
 * number must not stay locked to a shipment that will never exist.
 *
 * Only `reserved` rows are released; a dispatched number belongs to Bosta.
 *
 * @param {Object} order  a live Order document — history is appended, NOT saved (the caller saves)
 * @returns {number} how many were released
 */
async function releaseReservations(order, { vendorId = null, reason = "", actor = {} } = {}) {
  const filter = { order_id: order._id, status: "reserved" };
  if (vendorId) filter.vendor_id = vendorId;

  const released = await SmartLabel.find(filter).lean();
  if (released.length === 0) return 0;

  await SmartLabel.deleteMany({ _id: { $in: released.map((l) => l._id) } });

  const who = await resolveActor(actor);
  for (const label of released) {
    appendHistory(
      order,
      "smart_label_released",
      "Smart label released",
      `Label ${label.tracking_number} was released${reason ? ` — ${reason}` : ""}. It can be scanned again.`,
      { vendor_id: label.vendor_id.toString(), tracking_number: label.tracking_number, reason },
      who
    );
  }
  return released.length;
}

/**
 * Release by tracking number, with no order history.
 *
 * For the one case where the order document cannot be saved at all: dispatch created the
 * deliveries, the save failed, and the deliveries were cancelled on Bosta again. The
 * numbers are free, but there is nowhere to record it.
 */
async function forceRelease(trackingNumbers = []) {
  if (!trackingNumbers.length) return 0;
  const res = await SmartLabel.deleteMany({ tracking_number: { $in: trackingNumbers } });
  return res.deletedCount || 0;
}

/**
 * Release any reservation whose vendor has nothing left to ship.
 *
 * Called after item reviews change: a vendor who scanned a label and then declined their
 * last item would otherwise sit on a number nobody can reuse.
 *
 * Mutates `order` (history only) — the caller saves.
 */
async function releaseUnshippableReservations(order, actor = {}) {
  const held = await SmartLabel.find({ order_id: order._id, status: "reserved" }).lean();
  let released = 0;
  for (const label of held) {
    if (approvedItems(order, label.vendor_id).length > 0) continue;
    released += await releaseReservations(order, {
      vendorId: label.vendor_id,
      reason: "no approved items left for this vendor",
      actor,
    });
  }
  return released;
}

module.exports = {
  isEnabled,
  scanLabel,
  unlinkLabel,
  reservationFor,
  labelsForOrder,
  labelsForOrders,
  markDispatched,
  forceRelease,
  releaseReservations,
  releaseUnshippableReservations,
};
