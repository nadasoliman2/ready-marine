const { Order } = require("../models/orders");
const { ReturnRequest } = require("../models/returnRequests");
const { Seller } = require("../models/sellers");
const bostaService = require("./bostaService");
const { extractBostaState, mapBostaStateToOrderStatus, mergeTrackingHistory, parseBostaTimestamp } = require("./bostaStatusMap");

// A return delivery reaches the vendor when Bosta reports "Returned to business" (state 46,
// maps to "returned") — or "Delivered" (45) for return flows that report it that way.
const isReturnDelivered = (rawState) =>
  ["returned", "completed"].includes(mapBostaStateToOrderStatus(rawState));

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const appendHistory = (doc, action, title, details = "", metadata = {}, actor = {}) => {
  doc.history = doc.history || [];
  doc.history.push({
    action,
    title,
    details,
    actor_role: actor.role || "system",
    actor_label: actor.label || "System",
    metadata,
    created_at: new Date(),
  });
};

/**
 * Resolve vendor address for return dropoff.
 * Uses the vendor's default location or the fulfillment location from the order.
 */
const resolveVendorDropoffAddress = async (vendorId, order) => {
  const vendor = await Seller.findById(vendorId).select("name store_name phone email locations").lean();
  if (!vendor) throw Object.assign(new Error("Vendor not found"), { code: "NOT_FOUND" });

  // Try to find the fulfillment location used in the original order's vendor supervision
  const supervision = (order.vendor_supervisions || []).find(
    (vs) => vs.vendor_id?.toString() === vendorId.toString()
  );
  const fulfillmentAddr = supervision?.fulfillment_location;

  // Find matching vendor location or use default
  let location = null;
  if (fulfillmentAddr) {
    location = vendor.locations?.find((loc) => loc.address === fulfillmentAddr);
  }
  if (!location) {
    location = vendor.locations?.find((loc) => loc.is_default) || vendor.locations?.[0];
  }

  return {
    address: location?.address || fulfillmentAddr || "",
    city: location?.shipping_city || "",
    bosta_location_id: location?.bosta_location_id || null,
    vendor_name: vendor.store_name || vendor.name,
    vendor_phone: vendor.phone,
  };
};

/* ------------------------------------------------------------------ */
/*  Create Return Shipment                                            */
/* ------------------------------------------------------------------ */

/**
 * Creates a reverse Bosta delivery: customer (pickup) -> vendor (dropoff).
 */
const createReturnShipment = async (returnRequestId, actor = {}) => {
  const ret = await ReturnRequest.findById(returnRequestId);
  if (!ret) throw Object.assign(new Error("Return request not found"), { code: "NOT_FOUND" });

  if (ret.status !== "approved") {
    throw Object.assign(
      new Error("Return must be approved before creating a shipment"),
      { code: "INVALID_RETURN_STATUS" }
    );
  }

  if (ret.return_shipment?.bosta_delivery_id) {
    throw Object.assign(
      new Error("Return shipment already exists"),
      { code: "SHIPMENT_EXISTS" }
    );
  }

  const order = await Order.findById(ret.order_id);
  if (!order) throw Object.assign(new Error("Order not found"), { code: "NOT_FOUND" });

  // For return: pickup = customer's address, dropoff = vendor's address (reversed)
  const customerAddress = order.shipping_address;
  const dropoffCity = order.shipping?.destination?.city || "";

  const vendorDropoff = await resolveVendorDropoffAddress(ret.vendor_id, order);

  // Parse customer name (the customer is the consignee Bosta picks the return up from)
  const nameParts = (customerAddress?.recipient_name || "Customer").trim().split(/\s+/);
  const customerFirstName = nameParts[0] || "Customer";
  const customerLastName = nameParts.slice(1).join(" ");

  // Customer Return Pickup (type 25): Bosta collects the parcel FROM the customer, so the
  // customer's address goes in pickupAddress. Where it goes back to is the vendor's
  // registered pickup location (businessLocationId); Bosta fills in the dropOffAddress
  // from it. Falling back to a free-text returnAddress keeps vendors who haven't been
  // synced to Bosta yet working — without either, Bosta answers 500.
  if (!dropoffCity) {
    throw Object.assign(
      new Error("Cannot create return shipment: the order has no destination city."),
      { code: "MISSING_CITY" }
    );
  }
  if (!vendorDropoff.bosta_location_id && !vendorDropoff.city) {
    throw Object.assign(
      new Error(
        `Cannot create return shipment: vendor "${vendorDropoff.vendor_name || ret.vendor_id}" has no Bosta pickup location and no city on their address.`
      ),
      { code: "MISSING_VENDOR_LOCATION" }
    );
  }

  const result = await bostaService.createDelivery({
    pickupAddress: {
      firstLine: customerAddress?.full_address || "",
      city: dropoffCity,
    },
    ...(vendorDropoff.bosta_location_id
      ? { businessLocationId: vendorDropoff.bosta_location_id }
      : { returnAddress: { firstLine: vendorDropoff.address, city: vendorDropoff.city } }),
    receiver: {
      firstName: customerFirstName,
      lastName: customerLastName,
      phone: customerAddress?.phone || "",
    },
    cod: 0,
    businessReference: `RET-${ret._id}-${ret.vendor_id}`,
    uniqueBusinessReference: `RET-${ret._id}`,
    notes: `Return ${ret.return_number} — pickup from customer`,
    returnNotes: `Return ${ret.return_number} — deliver to ${vendorDropoff.vendor_name || "vendor"}`,
    type: 25, // Customer Return Pickup (CRP)
  });

  // Store return shipment data
  ret.return_shipment = {
    bosta_delivery_id: result.deliveryId,
    bosta_tracking_number: result.trackingNumber,
    bosta_status: "Pickup requested",
    pickup_address: {
      address: customerAddress?.full_address || "",
      city: dropoffCity,
    },
    dropoff_address: {
      address: vendorDropoff.address,
      city: vendorDropoff.city,
    },
    sent_at: new Date(),
    tracking_history: [
      { state: "Pickup requested", timestamp: new Date(), notes: "Return shipment created" },
    ],
  };

  ret.status = "return_shipping";
  ret.updated_at = new Date();

  appendHistory(ret, "return_shipment_created", "Return shipment created",
    `Bosta delivery created. Tracking: ${result.trackingNumber}`,
    { bosta_delivery_id: result.deliveryId, tracking_number: result.trackingNumber },
    actor);

  // The CRP exists on Bosta from here on. If persisting fails, the shipment would be live
  // and billed with nothing recording it — and because uniqueBusinessReference is derived
  // from the return id, every retry would be refused as a duplicate. Cancel it instead.
  try {
    await ret.save();
  } catch (saveErr) {
    let stranded = false;
    try { await bostaService.terminateDelivery(result.deliveryId); }
    catch (_) { stranded = true; }
    console.error(`[ReturnLogistics] Could not save return ${ret._id} after creating the shipment: ${saveErr.message}`);
    throw Object.assign(
      new Error(
        `Return shipment could not be saved (${saveErr.message}).` +
        (stranded
          ? ` WARNING: cancel tracking ${result.trackingNumber} on Bosta by hand before retrying.`
          : " The Bosta shipment was cancelled; you can retry.")
      ),
      { code: "SAVE_FAILED" }
    );
  }

  // Update order item return_status
  const orderDoc = await Order.findById(ret.order_id);
  if (orderDoc) {
    for (const ri of ret.items) {
      const orderItem = orderDoc.items.id(ri.order_item_id);
      if (orderItem) orderItem.return_status = "return_in_progress";
    }
    // Travelling back to the vendor — the order says so rather than claiming completion.
    require("./subOrderService").syncOrderStatus(orderDoc, "Returns");
    await orderDoc.save();
  }

  return ret;
};

/* ------------------------------------------------------------------ */
/*  Refresh Return Tracking                                           */
/* ------------------------------------------------------------------ */

const refreshReturnTracking = async (returnRequestId) => {
  const ret = await ReturnRequest.findById(returnRequestId);
  if (!ret) throw Object.assign(new Error("Return request not found"), { code: "NOT_FOUND" });

  if (!ret.return_shipment?.bosta_tracking_number) {
    throw Object.assign(new Error("No return shipment to track"), { code: "NO_SHIPMENT" });
  }

  try {
    const tracking = await bostaService.trackDelivery(ret.return_shipment.bosta_tracking_number);
    const state = extractBostaState({ state: tracking.currentStatus }) || tracking.currentStatus;
    if (state) ret.return_shipment.bosta_status = state;
    ret.return_shipment.last_tracked_at = new Date();
    // Fold Bosta's timeline in rather than over, so webhook-recorded detail survives.
    ret.return_shipment.tracking_history = mergeTrackingHistory(
      ret.return_shipment.tracking_history, tracking.trackingHistory
    );
  } catch (err) {
    // Keep existing data on failure
    console.error("[ReturnLogistics] Track error:", err.message);
  }

  // Auto-advance if delivered
  if (
    isReturnDelivered(ret.return_shipment.bosta_status) &&
    ret.status === "return_shipping"
  ) {
    ret.status = "return_received";
    ret.return_shipment.received_at = new Date();
    appendHistory(ret, "return_auto_received", "Return auto-received",
      "Bosta confirmed delivery of returned items", {}, { role: "system", label: "Bosta Tracking" });
  }

  ret.updated_at = new Date();
  await ret.save();
  return ret;
};

/* ------------------------------------------------------------------ */
/*  Handle Return Bosta Webhook                                       */
/* ------------------------------------------------------------------ */

const handleReturnBostaWebhook = async (trackingNumber, statusUpdate) => {
  const ret = await ReturnRequest.findOne({
    "return_shipment.bosta_tracking_number": trackingNumber,
  });

  if (!ret) return null; // Not a return shipment

  const statusValue = extractBostaState(statusUpdate);
  // Bosta can send timeStamp as a numeric string; `new Date("1719...")` is an Invalid Date
  // that fails to cast on save and 500s the webhook, so it goes through the shared parser.
  const eventAt = parseBostaTimestamp(statusUpdate.timeStamp ?? statusUpdate.timestamp);
  const when = eventAt || new Date();

  // Bosta doesn't order its webhooks — ignore one that predates the newest update we
  // already applied, so a late "in transit" can't undo a received return.
  if (eventAt && ret.return_shipment.last_event_at && eventAt <= ret.return_shipment.last_event_at) {
    return ret;
  }
  if (eventAt) ret.return_shipment.last_event_at = eventAt;

  const notes = statusUpdate.exceptionReason || statusUpdate.notes || "";
  ret.return_shipment.bosta_status = statusValue;
  ret.return_shipment.last_tracked_at = new Date();
  // A webhook always describes a real change, so it is always recorded — collapsing two
  // identical exception webhooks would lose a genuine second pickup attempt.
  ret.return_shipment.tracking_history.push({ state: statusValue, timestamp: when, notes });

  // Auto-advance to return_received if delivered
  if (
    isReturnDelivered(statusValue) &&
    ret.status === "return_shipping"
  ) {
    ret.status = "return_received";
    ret.return_shipment.received_at = new Date();
    appendHistory(ret, "return_auto_received", "Return items delivered",
      "Bosta confirmed delivery of returned items to vendor",
      { tracking_number: trackingNumber },
      { role: "system", label: "Bosta Webhook" });

    // Update order item return_status
    const order = await Order.findById(ret.order_id);
    if (order) {
      for (const ri of ret.items) {
        const orderItem = order.items.id(ri.order_item_id);
        if (orderItem) orderItem.return_status = "returned";
      }
      require("./subOrderService").syncOrderStatus(order, "Bosta Tracking");
      await order.save();
    }
  }

  ret.updated_at = new Date();
  await ret.save();
  return ret;
};

module.exports = {
  createReturnShipment,
  refreshReturnTracking,
  handleReturnBostaWebhook,
};
