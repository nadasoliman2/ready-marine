const { Order } = require("../models/orders");
const { Seller } = require("../models/sellers");
const { Product } = require("../models/products");
const bostaService = require("./bostaService");
const bostaTariff = require("./bostaTariff");
const courierCostService = require("./courierCostService");
const bostaCostService = require("./bostaCostService");
const smartLabelService = require("./smartLabelService");
const { applyBostaStatusToOrder, extractBostaState, mergeTrackingHistory } = require("./bostaStatusMap");

// Normalize a tracking value (string name or numeric code) to a readable state string.
const readableState = (currentStatus) => extractBostaState({ state: currentStatus }) || currentStatus;

/**
 * Analyze orders for a pickup: count parcels, detect fragile/big items via shipping classes.
 *
 * Addresses are free text and far from unique — real vendors have branches recorded as
 * just "Cairo" or "Maadi" — so the vendor scopes the match. Without it one store's
 * parcels get counted into another store's pickup.
 *
 * @param {Array} orderIds - Order IDs to analyze
 * @param {string} locationAddress - Filter shipments by this pickup address
 * @param {string} [vendorId] - Also require the shipment to belong to this vendor
 * @returns {{ parcelCount: number, hasFragile: boolean, hasBigItems: boolean,
 *             packageType: string, pickupFee: number, notes: string }}
 */
async function analyzePickupOrders(orderIds, locationAddress, vendorId = null) {
  if (!orderIds || orderIds.length === 0) {
    return { parcelCount: 0, hasFragile: false, hasBigItems: false, packageType: "Normal", pickupFee: 0, notes: "" };
  }

  const orders = await Order.find({ _id: { $in: orderIds } }).lean();
  const couriers = require("./couriers");

  let parcelCount = 0;
  const productIds = new Set();

  for (const order of orders) {
    for (const shipment of order.shipments || []) {
      if (locationAddress && shipment.pickup_address?.address !== locationAddress) continue;
      if (vendorId && shipment.vendor_id?.toString() !== vendorId.toString()) continue;
      // This is a BOSTA pickup: only boxes a Bosta driver will collect may be counted.
      // Parcels riding another courier share the same branch address, and counting them
      // would both promise Bosta more boxes than exist and divide the visit fee by a number
      // that is too large, under-charging every real Bosta parcel's `pickup_share`.
      if (couriers.providerOfShipment(shipment) !== "bosta") continue;
      // Retired by a reactivation — that delivery is terminated, nothing will be collected.
      if (shipment.superseded_at) continue;
      // Each shipment from this location = 1 parcel
      parcelCount++;
      // Collect product IDs from the shipment's items
      for (const itemId of shipment.items || []) {
        const item = order.items.find((i) => i._id.toString() === itemId.toString());
        if (item?.product_id) productIds.add(item.product_id.toString());
      }
    }
  }

  // Resolve the biggest size in the visit from the same shipping-class lookup the rate
  // engine priced with, so the courier is told to bring the vehicle the parcels need.
  const { hasFragile, sizeKey, hasBigItems } = await classFlagsForItems(
    Array.from(productIds).map((id) => ({ product_id: id }))
  );

  // Bosta's *pickup* size enum is only Normal / Light Bulky / Heavy Bulky — narrower than
  // the six pricing brackets, so the measured-upgrade sizes collapse back to Normal here.
  // Deliveries use a third, different enum; see deliverySpecs().
  const PICKUP_SIZES = { heavy_bulky: "Heavy Bulky", light_bulky: "Light Bulky" };
  const packageType = PICKUP_SIZES[sizeKey] || "Normal";

  const count = parcelCount || 1;

  // Fragile goes in notes (Bosta has no fragile packageType)
  const notesParts = [];
  if (hasFragile) notesParts.push("Contains fragile items - handle with care");

  return {
    parcelCount: count,
    hasFragile,
    hasBigItems,
    packageType,
    // What sending a courier for this few parcels costs US. Never reaches a customer —
    // see the note on `BostaPickup.pickup_fee`.
    pickupFee: bostaTariff.pickupFee(count),
    notes: notesParts.join(". "),
  };
}

/**
 * Build the `specs` a delivery is created with.
 *
 * Bosta otherwise files every parcel as Small / 1kg, which skews its pricing and the
 * insurance it calculates. The size enum here is the *delivery* one (Parcel, Document,
 * Small, Medium, Large, Light Bulky, Heavy Bulky) — "Normal" is only valid on pickups
 * and is rejected here.
 *
 * @param {Array} items - the order items in this shipment
 * @param {{ hasBigItems: boolean, hasFragile: boolean }} flags - from the shipping classes
 */
function deliverySpecs(items, flags = {}) {
  const itemsCount = items.reduce((n, item) => n + (item.quantity || 1), 0);

  // The size we DECLARE has to be the size we PRICED, or the two halves of the transaction
  // disagree: the customer paid for a Normal parcel and Bosta invoices a bulky one. Both
  // halves read the same shipping class through bostaTariff, so they cannot drift.
  // `deliveryPackageType` is null for a Normal parcel — Bosta's delivery enum has no
  // "Normal", and the item count is the honest way to pick between Small/Medium/Large.
  let packageType = bostaTariff.deliveryPackageType(flags.sizeKey);
  if (!packageType) {
    packageType = "Small";
    if (itemsCount > 6) packageType = "Large";
    else if (itemsCount > 2) packageType = "Medium";
  }

  const description = parcelDescription(items, flags);

  return { packageType, packageDetails: { itemsCount, ...(description ? { description } : {}) } };
}

/** Bosta shows the description on the AWB and in its dashboard; it has to stay readable. */
const DESCRIPTION_MAX = 250;

/**
 * What is in the box, in words: "دريل شحن 3/4 بوصة ×2 ، فلتر زيت (أحمر) ×1".
 *
 * Sent as `specs.packageDetails.description`, which Bosta prints on the airway bill and
 * shows as "وصف الشحنة" in its dashboard — so the courier and the customer can both see
 * what the parcel is without opening it. Built from the order's own frozen titles, so a
 * product renamed after the sale does not change what a shipped parcel says it carried.
 *
 * The fragile warning stays at the end, where it was before the item list joined it.
 * Over-long lists are cut at a whole item and marked with "…" rather than sliced
 * mid-word.
 */
function parcelDescription(items, flags = {}) {
  const lines = [];
  for (const item of items || []) {
    const title = String(item.product_title || item.bundle_title || "").trim();
    if (!title) continue;
    // "Default" is the placeholder a product without variants carries; it says nothing.
    const rawVariant = String(item.variant_label || "").trim();
    const variant = /^default$/i.test(rawVariant) ? "" : rawVariant;
    const qty = Number(item.quantity || 1);
    lines.push(`${title}${variant ? ` (${variant})` : ""}${qty > 1 ? ` ×${qty}` : ""}`);
  }

  const fragile = flags.hasFragile ? "Fragile — handle with care" : "";
  const room = DESCRIPTION_MAX - (fragile ? fragile.length + 3 : 0);

  let text = "";
  for (const line of lines) {
    const next = text ? `${text} ، ${line}` : line;
    if (next.length > room) { text = text ? `${text} …` : `${line.slice(0, room - 1)}…`; break; }
    text = next;
  }

  return [text, fragile].filter(Boolean).join(" — ") || undefined;
}

/**
 * What a set of order items means for the courier: the parcel's Bosta size, and whether
 * anything in it needs careful handling.
 *
 * Size comes from the items' shipping classes through the same `bostaTariff` lookup the
 * rate engine used to price them, and the largest one wins because the courier bills the
 * box rather than its contents. Fragility is orthogonal to size — Bosta has no fragile
 * bracket, so it travels as a note.
 */
async function classFlagsForItems(items) {
  const productIds = items.map((i) => i.product_id).filter(Boolean);
  if (productIds.length === 0) {
    return { hasFragile: false, sizeKey: bostaTariff.DEFAULT_SIZE_KEY, hasBigItems: false };
  }

  const products = await Product.find({
    _id: { $in: productIds },
    shipping_class_id: { $ne: null },
  }).populate("shipping_class_id", "name").lean();

  let hasFragile = false;
  const sizeKeys = [];
  for (const product of products) {
    const className = product.shipping_class_id?.name || "";
    if (/fragile|قابل للكسر/i.test(className)) hasFragile = true;
    const sizeKey = bostaTariff.sizeKeyForClassName(className);
    if (sizeKey) sizeKeys.push(sizeKey);
  }
  const sizeKey = bostaTariff.largestSize(sizeKeys);
  // Kept for callers that only ask "is this oversized?" — now derived from the size rather
  // than from a second, separate name match that could disagree with it.
  const hasBigItems = sizeKey === "heavy_bulky" || sizeKey === "light_bulky";
  return { hasFragile, sizeKey, hasBigItems };
}

/**
 * Groups approved order items by (vendor_id + fulfillment_location).
 * This handles multi-vendor splitting AND same-vendor-different-location splitting.
 */
function groupItemsByPickupLocation(order) {
  const groups = new Map();

  for (const item of order.items) {
    if (item.vendor_status !== "approved") continue;

    const supervision = order.vendor_supervisions.find(
      (vs) => vs.vendor_id.toString() === item.vendor_id.toString()
    );
    const location = supervision?.fulfillment_location || "";
    const key = `${item.vendor_id.toString()}::${location}`;

    if (!groups.has(key)) {
      groups.set(key, {
        vendor_id: item.vendor_id,
        fulfillment_location: location,
        items: [],
        total_amount: 0,
      });
    }

    const group = groups.get(key);
    group.items.push(item);
    group.total_amount += item.unit_price * item.quantity;
  }

  return Array.from(groups.values());
}

/**
 * Parse recipient name into firstName and lastName.
 */
function parseRecipientName(fullName) {
  const parts = (fullName || "").trim().split(/\s+/);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * Resolve vendor's pickup address details from their locations array.
 */
async function resolveVendorPickupAddress(vendorId, fulfillmentLocationStr) {
  const vendor = await Seller.findById(vendorId).lean();
  if (!vendor || !vendor.locations || vendor.locations.length === 0) {
    throw new Error(`Vendor ${vendorId} has no configured locations`);
  }

  // Match by address string or use default
  let location = vendor.locations.find((l) => l.address === fulfillmentLocationStr);
  if (!location) {
    location = vendor.locations.find((l) => l.is_default) || vendor.locations[0];
  }

  if (!location.shipping_city) {
    const vendorLabel = vendor.store_name || vendor.name || vendorId;
    throw new Error(
      `Vendor "${vendorLabel}" has no city set on their pickup location "${location.address}". They must select a city in their settings.`
    );
  }

  return {
    address: location.address,
    city: location.shipping_city,
    bosta_location_id: location.bosta_location_id || null,
    vendor_name: vendor.store_name || vendor.name,
  };
}

/**
 * The branch a parcel is actually collected from.
 *
 * `fulfillment_location` is a branch NAME snapshotted when the order was created, so a
 * vendor who renames or replaces that branch afterwards leaves every parcel of theirs
 * pointing at a string no location answers to any more. Dispatch already resolves that
 * the forgiving way — `resolveVendorPickupAddress` falls back to the default branch and
 * sends Bosta the real address — so everything that groups parcels by branch has to
 * resolve it identically. Comparing the raw strings instead makes a parcel the vendor has
 * FINISHED invisible to the admin who has to book its courier, with nothing to say why.
 *
 * @returns {Object|null} the vendor location, or null when the vendor has none at all.
 */
function resolveSubLocation(locations, fulfillmentLocation) {
  const list = locations || [];
  return (
    list.find((l) => (l.address || "") === (fulfillmentLocation || "")) ||
    list.find((l) => l.is_default) ||
    list[0] ||
    null
  );
}

/** Store name for a vendor, for messages an admin reads. Falls back to the id. */
async function vendorLabel(vendorId) {
  const vendor = await Seller.findById(vendorId).select("store_name name").lean();
  return vendor?.store_name || vendor?.name || vendorId.toString();
}

/**
 * Stable per-shipment reference.
 *
 * A vendor has exactly one supervision per order, and the supervision carries the
 * fulfillment location, so (order, vendor) identifies a shipment on its own. Keying on
 * that rather than the group's position matters now that dispatch can be retried for
 * only some vendors: a positional index shifts when an earlier group disappears, and the
 * reference would stop lining up with the delivery Bosta already holds.
 */
const groupReference = (order, group) => `${order._id}-${group.vendor_id}`;

/**
 * Create the Bosta delivery for ONE sub-order.
 *
 * This is the single place a delivery comes into existence, and therefore the single place
 * the order's money split freezes: from here Bosta holds a COD amount it offers no way to
 * restate, and that amount was already shown to the customer at checkout.
 *
 * WHEN it runs depends on how the store labels parcels, because the two modes need the
 * tracking number at opposite ends of the vendor's stage 2:
 *
 *   · Smart Label OFF — called as the vendor finishes stage 1. Bosta mints the number, and
 *     the vendor downloads the printable AWB in stage 2.
 *   · Smart Label ON  — called as the vendor scans in stage 2. The label is already stuck
 *     on the parcel, so the delivery is created carrying that number.
 *
 * Neither path involves the admin: their role is the pickup, not the dispatch.
 *
 * @param {Object} order      a loaded, mutable Order document
 * @param {Object} subOrder   the sub-document to dispatch
 * @param {Object} [opts]
 * @param {string} [opts.trackingNumber]  a scanned Smart Label to create the delivery with
 * @returns {{ shipment: Object }}
 * @throws {Error} if the delivery could not be created — the caller leaves the sub-order
 *                 where it was so the vendor can retry
 */
/**
 * Attach a Smart Sticker's barcode to this parcel's existing Bosta delivery.
 *
 * The one place the link is made, whether the sticker was scanned before the delivery
 * existed (dispatch calls this right after creating it) or after — a vendor whose first
 * sticker was refused scanning a second one, or an admin scanning onto a parcel that went
 * out on the printed route. Mutates the order document; the caller saves.
 */
async function linkStickerToShipment(order, subOrder, barcode) {
  // The LIVE shipment, never the first row naming the parcel: a reactivated parcel keeps its
  // terminated shipments for history, and linking a sticker to one of those links it to a
  // delivery Bosta has already cancelled.
  const shipment = require("./subOrderService").liveShipmentFor(order, subOrder);
  if (!shipment || !shipment.bosta_tracking_number) throw new Error("This parcel has no Bosta shipment to link a sticker to");
  if (shipment.smart_label_barcode) throw new Error(`This shipment already carries sticker ${shipment.smart_label_barcode}`);

  await bostaService.linkBarcode({ barcode, trackingNumber: shipment.bosta_tracking_number, apply: true });

  shipment.smart_label_barcode = barcode;
  shipment.is_smart_label = true;
  shipment.tracking_history = shipment.tracking_history || [];
  shipment.tracking_history.push({
    state: shipment.bosta_status || "Pickup requested",
    timestamp: new Date(),
    notes: `Linked to sticker ${barcode}`,
  });
  subOrder.smart_label_barcode = barcode;
  return shipment;
}

/**
 * Company consolidation (feature 14): a batch's lead ships the whole combined parcel, a
 * rider never ships on its own, and a parcel still waiting in its batch does not ship at
 * all. Resolved inside the dispatch so that no caller — vendor stage, admin button, bulk
 * send — can get this wrong.
 *
 * @returns {Promise<null|object>} the combined parcel's contents and destination, or null
 */
async function batchDispatchFor(order, subOrder) {
  if (subOrder.status !== "held_in_batch" && !subOrder.company_batch?.role) return null;
  return require("./companyBatchService").dispatchOptionsFor(order, subOrder);
}

async function dispatchSubOrder(order, subOrder, options = {}) {
  return require('./couriers/operation').withOperation(order, async () => {
    if (subOrder.courier_transfer?.phase === 'removing') {
      throw new Error('The previous waybill must be removed before sending this parcel again');
    }
    if (subOrder.dispatch_attempt?.at) {
      throw new Error('Resolve the previous shipment attempt before sending again');
    }
    let result;
    try {
      result = await createSubOrderShipment(order, subOrder, options);
    } catch (err) {
      // Cost/sticker bookkeeping can fail AFTER the courier has returned a waybill.
      // Record that live waybill so retrying the action cannot create another parcel.
      const shipment = require('./subOrderService').liveShipmentFor(order, subOrder);
      if (shipment && (shipment.tracking_number || shipment.bosta_tracking_number)) {
        subOrder.shipment_id = shipment._id;
        subOrder.courier = shipment.provider || 'bosta';
        subOrder.tracking_number = shipment.tracking_number || shipment.bosta_tracking_number;
        subOrder.bosta_tracking_number = subOrder.courier === 'bosta' ? subOrder.tracking_number : null;
        await order.save();
      }
      throw err;
    }
    // Persist the new tracking while holding the lock. Callers then save their vendor
    // stage changes; another send can no longer create a second delivery in that gap.
    try {
      await order.save();
    } catch (err) {
      // Keep the live result intact: callers may successfully retry the save. Cancelling
      // here would let that retry persist a tracking number for a delivery we just deleted.
      throw new Error(`Could not record the new shipment: ${err.message}. Check ${subOrder.courier} for waybill ${subOrder.tracking_number}; do not send again until it is reconciled.`);
    }
    return result;
  }, options.operationToken);
}

async function createSubOrderShipment(order, subOrder, { trackingNumber = null, actor = {} } = {}) {
  const subOrderService = require("./subOrderService");
  const couriers = require("./couriers");

  if (subOrder.tracking_number || subOrder.bosta_tracking_number) {
    throw new Error(`This parcel has already been sent to ${couriers.labelOf(subOrder.courier || "bosta")}`);
  }

  const provider = await couriers.courierFor(subOrder);
  if (provider === "arrive") return dispatchSubOrderToArrive(order, subOrder, { actor });

  const batch = await batchDispatchFor(order, subOrder);
  const ownItems = subOrderService.shippableItems(order, subOrder);
  const items = batch ? batch.items : ownItems;
  if (items.length === 0) {
    throw new Error("This parcel has no confirmed items to ship");
  }

  const dropOffCity = batch?.city || order.shipping?.destination?.city || "";
  if (!dropOffCity) {
    throw new Error(
      "Cannot send to Bosta: the order has no destination city. The customer must select a city at checkout."
    );
  }

  const pickupAddr = await resolveVendorPickupAddress(subOrder.vendor_id, subOrder.fulfillment_location);
  const { firstName, lastName } = parseRecipientName(batch?.recipient_name || order.shipping_address?.recipient_name);

  // Each parcel collects its OWN frozen share — merchandise plus its shipping, minus its
  // slice of the coupon and of the loyalty discount. Summed across the order's parcels this
  // equals `total_price` exactly, which is what stops the couriers from between them
  // collecting a different amount than the customer agreed to.
  const isCOD = order.transaction?.payment_method === "cash";
  const codAmount = isCOD ? Number(subOrder.cod_amount || 0) : 0;

  const flags = await classFlagsForItems(items);
  // Stable across retries and unique per parcel, so a replayed create is rejected by Bosta
  // rather than billed twice. The sub-order id is the parcel's identity — the vendor id
  // alone would collide for a vendor shipping from two branches.
  // A reactivated parcel gets a suffixed reference: its first delivery was terminated
  // under the bare one, and Bosta would reject the bare one as a replay.
  const cycle = Number(subOrder.reactivation_count || 0);
  const transfer = Number(subOrder.courier_transfer_count || 0);
  const reference = `${order._id}-${subOrder._id}${cycle > 0 ? `-r${cycle}` : ""}${transfer > 0 ? `-t${transfer}` : ""}`;

  // Where a refused parcel goes BACK to. Bosta fills this from the account's default
  // location when it is not sent — Ready Car's own office — so every RTO was travelling to
  // us instead of to the vendor who packed it. The vendor's branch is the right answer,
  // and it is only sent when it can be (Bosta refuses an address without a city or with a
  // street line under six characters); otherwise Bosta keeps its default, as before.
  const returnAddress = pickupAddr.city && String(pickupAddr.address || "").trim().length >= 6
    ? { firstLine: pickupAddr.address, city: pickupAddr.city }
    : null;

  const result = await bostaService.createDelivery({
    ...(pickupAddr.bosta_location_id
      ? { businessLocationId: pickupAddr.bosta_location_id }
      : { pickupAddress: { firstLine: pickupAddr.address, city: pickupAddr.city } }),
    ...(returnAddress ? { returnAddress } : {}),
    dropOffAddress: {
      firstLine: batch?.address || order.shipping_address?.full_address || "",
      city: dropOffCity,
    },
    receiver: { firstName, lastName, phone: batch?.phone || order.shipping_address?.phone || "" },
    cod: codAmount,
    businessReference: reference,
    uniqueBusinessReference: reference,
    specs: deliverySpecs(items, flags),
    notes: batch ? `${batch.notes} — ${pickupAddr.vendor_name}` : `Order ${order._id} — ${pickupAddr.vendor_name}`,
  });

  const barcode = trackingNumber ? String(trackingNumber).trim() : null;
  const finalTracking = result.trackingNumber || null;

  order.shipments.push({
    vendor_id: subOrder.vendor_id,
    sub_order_id: subOrder._id,
    pickup_address: { address: pickupAddr.address, city: pickupAddr.city },
    provider: "bosta",
    tracking_number: finalTracking,
    provider_shipment_id: result.deliveryId,
    provider_status: "Pickup requested",
    bosta_delivery_id: result.deliveryId,
    bosta_tracking_number: finalTracking,
    bosta_status: "Pickup requested",
    is_smart_label: false,
    smart_label_barcode: null,
    // This order's own lines. A combined company parcel carries colleagues' orders too,
    // but those lines belong to their own orders and come back through their own returns.
    items: ownItems.map((i) => i._id),
    cod_amount: codAmount,
    sent_at: new Date(),
    tracking_history: [{
      state: "Pickup requested",
      timestamp: new Date(),
      notes: batch ? `Combined company parcel created (${batch.member_count} orders)` : "Shipment created",
    }],
  });
  const shipment = order.shipments[order.shipments.length - 1];

  // What this parcel will cost us, stamped now rather than derived later — the destination,
  // the size and the COD are all final at this exact point, and the tariff they are priced
  // against will have moved by the time anyone reads the report. See courierCostService.
  await courierCostService.recordDispatchCost(shipment, {
    dropOffCity,
    sizeKey: flags.sizeKey,
    codAmount,
    // A combined company parcel was paid for by every order inside it.
    chargedToCustomer: batch ? batch.charged_to_customers : Number(subOrder.shipping_share || 0),
  });

  subOrder.shipment_id = shipment._id;
  subOrder.bosta_tracking_number = finalTracking;
  subOrder.tracking_number = finalTracking;
  subOrder.smart_label_barcode = null;
  subOrder.courier = "bosta";
  if (batch) await require("./companyBatchService").markLeadDispatched(subOrder, batch);

  // The sticker is attached to the delivery Bosta just minted, never sent as the tracking
  // number (see `bostaService.linkBarcode`).
  //
  // A refused sticker does NOT fail the dispatch. By this line the delivery is live and
  // billable at Bosta, so everything below — cost, frozen allocation, history — must still
  // run, and every caller must still save the order. Throwing here is exactly what lost
  // REF-C3G4C8WU on 16 Sep 2026: the admin route treated the throw as "nothing happened",
  // never saved, and Bosta delivered a parcel the order had no record of. Instead the
  // refusal is RETURNED as `stickerError`; the delivery is kept (as Bosta's own dashboard
  // does) so another sticker can be scanned onto it, or the waybill printed.
  let stickerError = null;
  if (barcode) {
    try {
      await linkStickerToShipment(order, subOrder, barcode);
    } catch (err) {
      stickerError = `Shipment ${finalTracking} was created, but Bosta did not accept sticker ${barcode}: ${err.message}. Scan another sticker or print the waybill.`;
      console.error(`[Bosta] Order ${order._id}, parcel ${subOrder._id}: ${stickerError}`);
      subOrderService.appendSubHistory(
        subOrder, "sub_order_sticker_refused", "Sticker not linked",
        stickerError, { tracking_number: finalTracking, barcode, error: err.message }, actor
      );
    }
  }

  // What this parcel will cost us, frozen against today's tariff. Recorded here rather
  // than derived when a report asks, because the tariff file changes and a derived figure
  // would restate the cost of parcels we shipped months ago. Best-effort by design — see
  // `snapshotCostForSubOrder`; a missing cost is a reporting gap, not a failed dispatch.
  await bostaCostService.snapshotCostForSubOrder(order, subOrder);

  // The point of no return for this order's pricing.
  subOrderService.freezeAllocation(order, actor);

  subOrderService.appendSubHistory(
    subOrder, "sub_order_dispatched", batch ? "Combined parcel sent to Bosta" : "Parcel sent to Bosta",
    `Tracking number ${finalTracking || "pending"}${codAmount ? `, ${codAmount.toFixed(2)} to collect on delivery` : ""}${batch ? ` — carries ${batch.member_count} company orders` : ""}.`,
    { tracking_number: finalTracking, cod_amount: codAmount, is_smart_label: !!subOrder.smart_label_barcode, batch_id: batch?.batch_id || null },
    actor
  );

  return { shipment, stickerError };
}

/**
 * Create the parcel's Arrive shipment.
 *
 * Differences from the Bosta path, all forced by Arrive's API:
 *   · the destination is a SECTOR (district). The admin's choice on the parcel wins; failing
 *     that the address text is matched against the sector list; failing that the parcel is
 *     refused with a message that names the fix ("choose the delivery area") — Arrive's
 *     free-text `keyword` fallback is not used because a mis-resolved area is a lost parcel.
 *   · there is no per-shipment sender field, so the vendor's branch goes in `notes` (Arrive
 *     collects from each branch — confirmed with them).
 *   · there is no duplicate guard, so a `dispatch_attempt` stamp is saved BEFORE the call and
 *     cleared after; an unknown outcome blocks further sends until an admin resolves it.
 *   · prepaid orders go with price 0 (confirmed with Arrive).
 */
async function dispatchSubOrderToArrive(order, subOrder, { actor = {} } = {}) {
  const subOrderService = require("./subOrderService");
  const arrive = require("./couriers/arrive/adapter");
  const sectors = require("./couriers/arrive/sectors");
  const arriveTariff = require("./couriers/arrive/tariff");

  if (!arrive.isConfigured()) throw new Error("Arrive is not configured (ARRIVE_API_USER / ARRIVE_API_PASSWORD)");

  const batch = await batchDispatchFor(order, subOrder);
  const ownItems = subOrderService.shippableItems(order, subOrder);
  const items = batch ? batch.items : ownItems;
  if (items.length === 0) throw new Error("This parcel has no confirmed items to ship");

  const dropOffCity = batch?.city || order.shipping?.destination?.city || "";
  const address = batch?.address || order.shipping_address?.full_address || "";
  if (!address) throw new Error("Cannot send to Arrive: the order has no delivery address");

  // Sector: chosen > suggested > refuse.
  let sector = subOrder.courier_sector_id ? await sectors.getSector(subOrder.courier_sector_id) : null;
  let sectorSource = sector ? "chosen" : null;
  if (!sector) {
    const s = await sectors.suggestSector({ address, city: dropOffCity });
    if (s.sector && s.confidence === "high") { sector = s.sector; sectorSource = "suggested"; }
    else if (s.sector) {
      throw new Error(`Cannot send to Arrive: the delivery area is ambiguous (looks like "${s.sector.name}"). Choose the Arrive area on this parcel first.`);
    } else {
      throw new Error("Cannot send to Arrive: no delivery area (sector) is set on this parcel. Choose the Arrive area first.");
    }
  }
  if (sector.serviceable === false || arriveTariff.isUnservedGroup(sector.gov_name)) {
    throw new Error(`Arrive does not deliver to "${sector.name}" (${sector.gov_name}). Send this parcel with Bosta instead.`);
  }

  const pickupAddr = await resolveVendorPickupAddress(subOrder.vendor_id, subOrder.fulfillment_location);
  const vendor = await Seller.findById(subOrder.vendor_id).select("store_name name phone").lean();
  const isCOD = order.transaction?.payment_method === "cash";
  const codAmount = isCOD ? Number(subOrder.cod_amount || 0) : 0;
  const cycle = Number(subOrder.reactivation_count || 0);
  const transfer = Number(subOrder.courier_transfer_count || 0);
  const reference = `${order._id}-${subOrder._id}${cycle > 0 ? `-r${cycle}` : ""}${transfer > 0 ? `-t${transfer}` : ""}`;
  const weightKg = items.reduce((sum, i) => sum + Number(i.weight || i.product_weight || 0) * Number(i.quantity || 1), 0) || null;
  const itemsSummary = items.map((i) => `${i.quantity || 1} × ${i.product_title || i.title || "item"}`).join(", ");
  const reasonNotes = `${batch ? `${batch.notes} · ` : ""}Order ${subOrder.reference || order._id} · Sender: ${pickupAddr.vendor_name}${vendor?.phone ? ` ${vendor.phone}` : ""} · Pickup from: ${pickupAddr.address}, ${pickupAddr.city}`;

  // The sender is this vendor's branch, not the Ready Car account. Arrive's own portal has
  // per-shipment "sub-sender" fields including an area, so the driver is sent to the right
  // store. The area is resolved from the branch address the same way the destination is; a
  // low-confidence guess is left out rather than sending a driver to the wrong district —
  // Arrive then falls back to the account branch, which is what happened for every parcel
  // before this.
  const senderSuggestion = await sectors
    .suggestSector({ address: pickupAddr.address, city: pickupAddr.city })
    .catch(() => ({ sector: null, confidence: "none" }));
  const senderSector = senderSuggestion.confidence === "high" ? senderSuggestion.sector : null;

  // The stamp that makes a timeout safe. Persisted on its own so it survives a crash mid-call.
  subOrder.dispatch_attempt = { provider: "arrive", reference, at: new Date() };
  await Order.updateOne(
    { _id: order._id, "sub_orders._id": subOrder._id },
    { $set: { "sub_orders.$.dispatch_attempt": subOrder.dispatch_attempt } }
  );

  let result;
  try {
    result = await arrive.createShipment({
      sectorId: sector.sector_id,
      recipientName: batch?.recipient_name || order.shipping_address?.recipient_name,
      recipientPhone: batch?.phone || order.shipping_address?.phone,
      address: `${address}${dropOffCity ? ` — ${dropOffCity}` : ""}`,
      codAmount,
      weightKg,
      quantity: items.reduce((n, i) => n + Number(i.quantity || 1), 0),
      productName: items[0]?.product_title || items[0]?.title || "Auto parts",
      productDesc: itemsSummary,
      notes: reasonNotes,
      orderReference: reference,
      serviceType: 1,
      senderName: pickupAddr.vendor_name,
      senderPhone: vendor?.phone || null,
      senderAddress: `${pickupAddr.address}${pickupAddr.city ? `, ${pickupAddr.city}` : ""}`,
      senderSectorId: senderSector?.sector_id || null,
    });
  } catch (err) {
    // A definite refusal (4xx with a message) is safe to retry later: nothing was created.
    // A timeout is not — leave the stamp in place so the admin checks the portal first.
    const definite = err.status && err.status >= 400 && err.status < 500;
    if (definite) {
      subOrder.dispatch_attempt = { provider: null, reference: null, at: null };
      await Order.updateOne({ _id: order._id, "sub_orders._id": subOrder._id }, { $set: { "sub_orders.$.dispatch_attempt": subOrder.dispatch_attempt } });
    }
    throw new Error(`Arrive rejected the shipment: ${err.message}${definite ? "" : " (outcome unknown — check the Arrive portal for reference " + reference + " before sending again)"}`);
  }
  subOrder.dispatch_attempt = { provider: null, reference: null, at: null };

  order.shipments.push({
    vendor_id: subOrder.vendor_id,
    sub_order_id: subOrder._id,
    pickup_address: { address: pickupAddr.address, city: pickupAddr.city },
    provider: "arrive",
    tracking_number: result.waybill,
    provider_shipment_id: result.shipment_id,
    provider_status: "Pickup request",
    provider_payload: {
      qr_code: result.qr_code, sector_id: sector.sector_id, sector_name: sector.name,
      gov_name: sector.gov_name, sector_source: sectorSource, reference,
      sender_name: pickupAddr.vendor_name,
      sender_sector_id: senderSector?.sector_id || null,
      sender_sector_name: senderSector?.name || null,
    },
    bosta_status: "Pickup request",
    is_smart_label: false,
    items: ownItems.map((i) => i._id),
    cod_amount: codAmount,
    sent_at: new Date(),
    tracking_history: [{ state: "Pickup Request (#1)", timestamp: new Date(), notes: batch ? `Combined company parcel created at Arrive (${batch.member_count} orders)` : "Shipment created at Arrive" }],
  });
  const shipment = order.shipments[order.shipments.length - 1];

  await courierCostService.recordDispatchCost(shipment, {
    provider: "arrive",
    arriveGroup: sector.gov_name,
    weightKg: weightKg || 0,
    codAmount,
    chargedToCustomer: batch ? batch.charged_to_customers : Number(subOrder.shipping_share || 0),
  });

  subOrder.shipment_id = shipment._id;
  subOrder.tracking_number = result.waybill;
  subOrder.courier = "arrive";
  subOrder.courier_sector_id = sector.sector_id;
  subOrder.courier_sector_name = sector.name;
  if (batch) await require("./companyBatchService").markLeadDispatched(subOrder, batch);

  subOrderService.freezeAllocation(order, actor);
  subOrderService.appendSubHistory(
    subOrder, "sub_order_dispatched", "Parcel sent to Arrive",
    `Waybill ${result.waybill} to ${sector.name} (${sector.gov_name})${codAmount ? `, ${codAmount.toFixed(2)} to collect on delivery` : ""}. Print the label and stick it on the parcel.`,
    { tracking_number: result.waybill, cod_amount: codAmount, provider: "arrive", sector_id: sector.sector_id, sector_source: sectorSource },
    actor
  );
  return { shipment };
}

/**
 * Record an Arrive shipment that exists at Arrive but not here — the admin found it in the
 * portal after a send whose outcome was unknown. Mirrors what `dispatchSubOrderToArrive`
 * writes, minus the create call.
 */
async function attachArriveShipment(order, subOrder, { waybill, actor = {} }) {
  const subOrderService = require("./subOrderService");
  const sectors = require("./couriers/arrive/sectors");
  if (subOrder.tracking_number || subOrder.bosta_tracking_number) throw new Error("This parcel already has a shipment");
  const items = subOrderService.shippableItems(order, subOrder);
  const pickupAddr = await resolveVendorPickupAddress(subOrder.vendor_id, subOrder.fulfillment_location);
  const sector = subOrder.courier_sector_id ? await sectors.getSector(subOrder.courier_sector_id) : null;
  const isCOD = order.transaction?.payment_method === "cash";
  const codAmount = isCOD ? Number(subOrder.cod_amount || 0) : 0;

  order.shipments.push({
    vendor_id: subOrder.vendor_id,
    sub_order_id: subOrder._id,
    pickup_address: { address: pickupAddr.address, city: pickupAddr.city },
    provider: "arrive",
    tracking_number: String(waybill),
    provider_status: "Pickup request",
    provider_payload: { sector_id: sector?.sector_id || null, sector_name: sector?.name || "", gov_name: sector?.gov_name || "", reference: subOrder.dispatch_attempt?.reference || null, attached_by_admin: true },
    bosta_status: "Pickup request",
    items: items.map((i) => i._id),
    cod_amount: codAmount,
    sent_at: new Date(),
    tracking_history: [{ state: "Pickup Request (#1)", timestamp: new Date(), notes: "Waybill entered by the website team after an unfinished send" }],
  });
  const shipment = order.shipments[order.shipments.length - 1];
  // Same weight the live dispatch would have priced on — without it the over-2 kg surcharge
  // is silently dropped and an attached parcel reads cheaper than the identical sent one.
  const attachedWeightKg = items.reduce(
    (sum, i) => sum + Number(i.weight || i.product_weight || 0) * Number(i.quantity || 1), 0
  ) || 0;
  await courierCostService.recordDispatchCost(shipment, {
    provider: "arrive",
    arriveGroup: sector?.gov_name || null,
    weightKg: attachedWeightKg,
    codAmount,
    chargedToCustomer: Number(subOrder.shipping_share || 0),
  });
  subOrder.shipment_id = shipment._id;
  subOrder.tracking_number = String(waybill);
  subOrder.courier = "arrive";
  subOrder.dispatch_attempt = { provider: null, reference: null, at: null };
  subOrderService.freezeAllocation(order, actor);
  subOrderService.appendSubHistory(subOrder, "sub_order_dispatched", "Parcel recorded at Arrive",
    `Waybill ${waybill} attached by the website team.`, { tracking_number: String(waybill), provider: "arrive", attached: true }, actor);
  return { shipment };
}

/**
 * Dispatch every parcel on this order that is ready to go — the admin's bulk action and
 * their rescue path when a vendor cannot act.
 *
 * The old all-or-nothing gate is gone. Each parcel stands alone: one vendor still reviewing
 * their items no longer holds back a vendor who finished yesterday, and a parcel that fails
 * at Bosta leaves its siblings dispatched. Parcels that are not ready are reported as
 * `skipped` with the reason, rather than failing the whole call.
 *
 * @returns {{ order, dispatched: Array, failures: Array, skipped: Array }}
 */
async function sendOrderToBosta(orderId, actor = {}) {
  const subOrderService = require("./subOrderService");
  const order = await Order.findById(orderId);
  if (!order) throw new Error("Order not found");
  if (!Array.isArray(order.sub_orders) || order.sub_orders.length === 0) {
    throw new Error("This order has no parcels to send. It may need migrating.");
  }

  const smartLabelEnabled = await smartLabelService.isEnabled();

  const dispatched = [];
  const failures = [];
  const skipped = [];

  const couriers = require("./couriers");
  for (const sub of order.sub_orders) {
    const provider = await couriers.courierFor(sub);
    const reservation = provider === "bosta" ? await smartLabelService.reservationFor(order._id, sub.vendor_id) : null;
    const blocked = dispatchBlockedReason(order, sub, smartLabelEnabled, !!reservation, { provider });
    if (blocked) {
      skipped.push({
        sub_order_id: sub._id.toString(),
        reference: sub.reference,
        vendor_name: await vendorLabel(sub.vendor_id),
        reason: blocked,
      });
      continue;
    }

    try {
      const { stickerError } = await dispatchSubOrder(order, sub, {
        trackingNumber: reservation?.tracking_number || null,
        actor,
      });
      sub.items_confirmed_at = sub.items_confirmed_at || new Date();
      sub.tracking_assigned_at = new Date();
      if (stickerError) {
        // The delivery exists but carries no sticker, so the box still needs a label: the
        // parcel goes back to the vendor's label step, where they scan another sticker or
        // print the waybill. The reserved sticker is handed back — it never got linked.
        sub.status = "awaiting_tracking";
        if (reservation) {
          await smartLabelService.releaseReservations(order, {
            vendorId: sub.vendor_id, reason: stickerError, actor,
          }).catch(() => {});
        }
      } else {
        sub.status = "awaiting_handover";
        if (reservation) await smartLabelService.markDispatched(reservation._id);
      }
      dispatched.push({
        sub_order_id: sub._id.toString(),
        reference: sub.reference,
        tracking_number: sub.tracking_number || sub.bosta_tracking_number,
        courier: sub.courier || provider,
        sticker_error: stickerError,
      });
    } catch (err) {
      const vendorName = await vendorLabel(sub.vendor_id);
      failures.push({
        sub_order_id: sub._id.toString(),
        vendor_id: sub.vendor_id.toString(),
        vendor_name: vendorName,
        message: err.message,
      });
      console.error(`[Bosta] Order ${order._id}, parcel ${sub.reference}: ${err.message}`);

      // The reserved number never made it onto a shipment. Holding it would strand a label
      // that is still physically on the parcel and perfectly reusable.
      if (reservation) {
        await smartLabelService.releaseReservations(order, {
          vendorId: sub.vendor_id,
          reason: `Bosta rejected the shipment (${err.message})`,
          actor,
        }).catch(() => {});
      }

      subOrderService.appendSubHistory(
        sub, "sub_order_dispatch_failed", "Could not send this parcel to Bosta",
        err.message, { error: err.message }, actor
      );
    }
  }

  if (dispatched.length === 0 && failures.length === 0) {
    throw new Error(
      skipped.length
        ? `Nothing to send — ${skipped.map((s) => `${s.vendor_name}: ${s.reason}`).join("; ")}`
        : "Nothing to send"
    );
  }

  subOrderService.syncOrderStatus(order, actor.label || "Admin");

  order.history = order.history || [];
  order.history.push({
    action: "bosta_shipments_created",
    title: failures.length ? "Some parcels sent to Bosta" : "Parcels sent to Bosta",
    details:
      `${dispatched.length} parcel(s) created on Bosta` +
      (failures.length ? `; ${failures.length} failed` : "") +
      (skipped.length ? `; ${skipped.length} not ready` : ""),
    actor_role: actor.role || "admin",
    actor_label: actor.label || "Admin",
    metadata: {
      dispatched: dispatched.map((d) => d.tracking_number),
      failed: failures.map((f) => f.vendor_name),
      skipped: skipped.map((s) => `${s.vendor_name}: ${s.reason}`),
    },
    created_at: new Date(),
  });

  // Each successful dispatch already persisted its waybill under the courier lock.
  // This save records the final stages and bulk history. A failure must not cancel
  // deliveries that are now durably linked to their parcels.
  try {
    await order.save();
  } catch (saveErr) {
    throw new Error(`Shipment records were saved, but final preparation stages could not be saved (${saveErr.message}). Refresh the order before continuing.`);
  }

  // Auto-pickup is opt-in. Best-effort: a pickup that cannot be raised must not undo a
  // dispatched parcel.
  try {
    const shippingEngine = require("./shippingEngine");
    const settings = await shippingEngine.getSettings();
    if (settings?.auto_pickup_enabled) {
      const fresh = await Order.findById(order._id);
      const { warnings } = await schedulePickupsForOrder(fresh || order, settings);
      for (const w of warnings) console.warn(`[Bosta Auto-Pickup] Order ${order._id}: ${w}`);
      if (fresh) return { order: fresh, dispatched, failures, skipped };
    }
  } catch (err) {
    console.error(`[Bosta Auto-Pickup] Order ${order._id}: ${err.message}`);
  }

  return { order, dispatched, failures, skipped };
}

/**
 * Why a parcel cannot go to Bosta right now, in words an admin can act on.
 * @returns {string|null} null when it is ready to dispatch
 */
/**
 * Why this parcel cannot go to Bosta right now, or null if it can.
 *
 * `allowWithoutLabel` is the admin's single-parcel button: pressed deliberately on one
 * parcel, it may create the shipment with a Bosta-minted number and print the waybill,
 * exactly as the vendor can. The bulk "send everything" keeps the block, because sweeping
 * up a parcel whose vendor is about to scan a sticker would leave that sticker unusable.
 */
function dispatchBlockedReason(order, sub, smartLabelEnabled, hasReservation, { allowWithoutLabel = false, provider = "bosta" } = {}) {
  const subOrderService = require("./subOrderService");
  const couriers = require("./couriers");
  if (sub.status === "cancelled") return "the parcel is cancelled";
  if (sub.courier_transfer?.phase === 'removing') return "the previous waybill removal must be confirmed before sending again";
  if (sub.status === "held_in_batch") {
    return "it is a company order still collecting in its batch for the branch — it ships together with its colleagues' orders once the batch closes (or close the batch early from the company page)";
  }
  if (sub.company_batch?.role === "rider" || sub.status === "in_batch_parcel") {
    return `it ships inside the combined company parcel of order ${sub.company_batch?.lead_reference || ""}`.trim();
  }
  if (sub.tracking_number || sub.bosta_tracking_number) return `already sent to ${couriers.labelOf(sub.courier || provider)}`;
  if (sub.status === "needs_admin") return "waiting for you to resolve a declined item";
  if (sub.dispatch_attempt?.at) {
    return `a previous send to ${couriers.labelOf(sub.dispatch_attempt.provider)} did not finish — check the courier's portal for reference ${sub.dispatch_attempt.reference}, then clear the attempt`;
  }
  // Smart Label only applies to couriers that honour it; an Arrive parcel is never held for a sticker.
  if (!couriers.capabilities(provider).smartLabel) smartLabelEnabled = false;

  const items = subOrderService.subOrderItems(order, sub);
  if (items.length === 0) return "the parcel has no items";
  if (items.some((i) => i.vendor_status === "pending")) return "the vendor has not reviewed every item";
  if (!items.some((i) => i.vendor_status === "approved")) return "every item was declined";
  // The bulk send never mints a number for an unlabelled parcel (it would strand a sticker
  // the vendor is about to scan), so a parcel with neither a sticker nor a waybill waits.
  if (smartLabelEnabled && !hasReservation && !allowWithoutLabel) return "a Smart Sticker or a waybill (بوليصة) must exist on it — the vendor scans the sticker or prints the waybill, or you send this parcel on its own";
  return null;
}

/**
 * Get current time in Egypt (UTC+2).
 */
function getEgyptNow() {
  const str = new Date().toLocaleString("en-US", { timeZone: "Africa/Cairo" });
  return new Date(str);
}

/** Format a Date as YYYY-MM-DD using its own calendar fields (never UTC-shifted). */
function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Pick the day Bosta should collect on.
 *
 * Two cut-offs are in play and they are not the same. Ours (`pickup_cutoff_hour`) is a
 * business preference — "don't promise same-day after 4pm". Bosta enforces its own, plus
 * Fridays and holidays, and rejects anything that breaks them ("Can not choose today
 * because it's after the cut-off time"). So we compute the earliest day *we* want, then
 * take the first day Bosta says it can actually come — asking beats guessing.
 *
 * If Bosta can't be reached the local guess stands; a rejected date is better than not
 * booking at all, and the caller surfaces the failure as a warning either way.
 *
 * @returns {{ date: string, deferred: boolean }}
 */
async function resolvePickupDate(egyptNow, { cutoffHour, skipFridays }) {
  const target = new Date(egyptNow);
  const deferred = egyptNow.getHours() >= cutoffHour;
  if (deferred) target.setDate(target.getDate() + 1);
  if (skipFridays) {
    while (target.getDay() === 5) target.setDate(target.getDate() + 1);
  }
  const preferred = toDateKey(target);

  try {
    const available = await bostaService.getAvailablePickupDates(14);
    const firstUsable = available.find((d) => d >= preferred);
    if (firstUsable) return { date: firstUsable, deferred: deferred || firstUsable !== preferred };
  } catch (err) {
    console.warn(`[Bosta Pickup] Could not read available dates, falling back to ${preferred}: ${err.message}`);
  }

  return { date: preferred, deferred };
}


/**
 * Tell the vendors whose parcels were just booked WHEN the courier is coming.
 *
 * The appointment already existed — it was written into the pickup and into each parcel's
 * history — but it lived only on admin screens, so the one person who has to physically hand
 * the box over was the one person not told. A vendor who does not know the day and the slot
 * cannot arrange to be at the branch for it.
 *
 * One notification per vendor per booking, not per parcel: a branch handing over four boxes
 * to one courier at one appointment does not need four identical messages.
 *
 * Never throws. A missed notification must not undo a courier booking that really exists at
 * Bosta — the booking is the outcome that matters, and it has already happened by here.
 *
 * @param {object} pickup   the BostaPickup that was created or joined
 * @param {Array}  parcels  [{ vendorId, orderId, subId }] — the parcels this booking covers
 */
async function notifyVendorsOfPickup(pickup, parcels = []) {
  try {
    if (!pickup || parcels.length === 0) return;
    const { createNotification } = require("../models/notifications");

    const byVendor = new Map();
    for (const p of parcels) {
      const key = String(p.vendorId || "");
      if (!key) continue;
      if (!byVendor.has(key)) byVendor.set(key, []);
      byVendor.get(key).push(p);
    }

    for (const [vendorId, rows] of byVendor) {
      const count = rows.length;
      await createNotification(
        vendorId,
        "pickup_scheduled",
        "A Bosta courier is booked",
        `${count} parcel(s) will be collected on ${pickup.scheduled_date} between ${pickup.scheduled_time_slot}` +
          `${pickup.location_address ? ` from ${pickup.location_address}` : ""}. ` +
          `Have them sealed and ready, and confirm the handover once the courier takes them.`,
        {
          pickup_id: pickup._id,
          scheduled_date: pickup.scheduled_date,
          scheduled_time_slot: pickup.scheduled_time_slot,
          location_address: pickup.location_address || "",
          parcel_count: count,
          // One order deep-links the notification straight at the parcel; several would have
          // to pick one arbitrarily, so the vendor is sent to their parcel list instead.
          order_id: count === 1 ? rows[0].orderId : null,
          sub_order_id: count === 1 ? rows[0].subId : null,
        }
      );
    }
  } catch (err) {
    console.error(`[Bosta Pickup] Vendor notification failed for pickup ${pickup?._id}: ${err.message}`);
  }
}

/**
 * Fold another order into an existing pickup and refresh its parcel/handling counts.
 * Used both when a pickup is already booked for the day and when a concurrent order
 * loses the race to claim the slot.
 */
async function attachOrderToPickup(pickup, order, location, vendor) {
  const { BostaPickup } = require("../models/bostaPickups");
  if (pickup.order_ids.some((id) => id.toString() === order._id.toString())) return pickup;

  pickup.order_ids.push(order._id);
  const analysis = await analyzePickupOrders(pickup.order_ids, location.address, vendor._id);
  pickup.parcel_count = analysis.parcelCount;
  pickup.has_fragile = analysis.hasFragile;
  pickup.has_big_items = analysis.hasBigItems;
  // Re-read rather than left alone: the order that just joined may be the second parcel,
  // which is exactly what makes Bosta stop charging for the visit.
  pickup.pickup_fee = analysis.pickupFee;
  await pickup.save();
  return pickup;
}

/**
 * Auto-schedule Bosta pickups for each unique vendor location in an order.
 * Applies configurable business rules: cutoff hour, skip Fridays, batch threshold.
 * Best-effort: failures are returned as warnings, not thrown.
 *
 * Advances the order to `pickup_scheduled` once every location it ships from has a
 * pickup booked, so it stops showing up in the admin's "needs pickup" queue.
 *
 * @returns {{ scheduled: Array, warnings: Array, orderAdvanced: boolean }}
 */
async function schedulePickupsForOrder(order, settings = null) {
  const { BostaPickup } = require("../models/bostaPickups");

  const cutoffHour = settings?.pickup_cutoff_hour ?? 16;
  const skipFridays = settings?.pickup_skip_fridays !== false;
  const batchThreshold = settings?.pickup_batch_threshold ?? 1;

  const egyptNow = getEgyptNow();
  const currentHour = egyptNow.getHours();

  const { date: scheduledDate, deferred } = await resolvePickupDate(egyptNow, { cutoffHour, skipFridays });

  // Use admin-configured time slot, fallback to time-based logic.
  // Normalize old format "10:00-13:00" → "10:00 to 13:00".
  const rawSlot = settings?.default_pickup_time_slot;
  const configuredSlot = rawSlot ? rawSlot.replace("-", " to ") : null;
  let defaultTimeSlot;
  if (deferred) {
    // A fresh day — the configured slot is reachable again, whatever time it is now.
    defaultTimeSlot = configuredSlot || "10:00 to 13:00";
  } else if (configuredSlot) {
    const startHour = parseInt(configuredSlot.split(":")[0], 10);
    defaultTimeSlot = currentHour < startHour ? configuredSlot : "13:00 to 16:00";
  } else {
    defaultTimeSlot = currentHour < 10 ? "10:00 to 13:00" : "13:00 to 16:00";
  }

  // Collect unique vendor locations with bosta_location_id
  const locationMap = new Map();
  // Locations we cannot book. Tracked so a shipment that silently has nowhere to be
  // collected from surfaces as a warning instead of stalling unnoticed.
  const unbookable = [];

  // Only parcels the vendor has finished — dispatched to Bosta AND sealed. A parcel
  // still being packed must not put a courier on the road for it, and its owner must keep
  // the ability to cancel until the moment a pickup really exists.
  const bookableSubs = (order.sub_orders || []).filter(
    (s) => s.status === "ready_for_pickup" && s.bosta_tracking_number && !s.pickup_id
  );
  // Which parcels belong to each Bosta location, so the booking can stamp them afterwards.
  const subsByLocation = new Map();

  for (const sub of bookableSubs) {
    const vendor = await Seller.findById(sub.vendor_id).lean();
    if (!vendor) {
      unbookable.push(`Vendor ${sub.vendor_id} no longer exists — pickup must be arranged manually.`);
      continue;
    }

    const location = resolveSubLocation(vendor.locations, sub.fulfillment_location);

    if (!location) {
      unbookable.push(
        `${vendor.store_name || vendor.name}: no location matching "${sub.fulfillment_location}" — schedule this pickup manually.`
      );
      continue;
    }
    if (!location.bosta_location_id) {
      unbookable.push(
        `${vendor.store_name || vendor.name}: location "${location.address}" is not linked to Bosta — schedule this pickup manually.`
      );
      continue;
    }

    if (!locationMap.has(location.bosta_location_id)) {
      locationMap.set(location.bosta_location_id, { vendor, location });
      subsByLocation.set(location.bosta_location_id, []);
    }
    subsByLocation.get(location.bosta_location_id).push(sub);
  }

  /**
   * Record that a courier is now committed to these parcels.
   *
   * This is the moment the cancel option disappears for the vendor AND the customer alike:
   * up to here nothing was promised to anyone, and cancelling cost only an API call.
   */
  const booked = [];
  const markSubsBooked = (bostaLocId, pickupDoc) => {
    for (const sub of subsByLocation.get(bostaLocId) || []) {
      booked.push({ subId: sub._id, pickupId: pickupDoc?._id || null });
    }
  };

  const scheduled = [];
  const warnings = [...unbookable];

  for (const [bostaLocId, { vendor, location }] of locationMap) {
    // Check if already scheduled for this date
    let existing = await BostaPickup.findOne({
      bosta_location_id: bostaLocId,
      scheduled_date: scheduledDate,
      status: { $ne: "cancelled" },
    });

    if (existing) {
      await attachOrderToPickup(existing, order, location, vendor);
      markSubsBooked(bostaLocId, existing);
      scheduled.push({ pickupId: existing.bosta_pickup_id, existing: true, location: location.address });
      continue;
    }

    // Batch threshold check: count ready orders for this location today
    if (batchThreshold > 1) {
      // Scope by vendor as well: the address alone is not a unique branch key.
      // Counts ready PARCELS at this branch, not whole orders: an order is now several
      // parcels from several branches, so counting orders would badly over-count a branch
      // that contributes one parcel to each of ten multi-vendor orders.
      const readyAgg = await Order.aggregate([
        { $match: { "sub_orders": { $elemMatch: { vendor_id: vendor._id, status: "ready_for_pickup" } } } },
        { $unwind: "$sub_orders" },
        { $match: {
            "sub_orders.vendor_id": vendor._id,
            "sub_orders.status": "ready_for_pickup",
            "sub_orders.fulfillment_location": location.address,
        } },
        { $count: "n" },
      ]);
      const readyCount = readyAgg[0]?.n || 0;
      if (readyCount < batchThreshold) {
        warnings.push(
          `${location.address}: ${readyCount}/${batchThreshold} orders — waiting for batch threshold before scheduling pickup.`
        );
        continue;
      }
    }

    // Claim the (location, date) slot in our own DB BEFORE calling Bosta. The unique index
    // makes the claim atomic, so two concurrent orders can't both book a courier. Booking
    // first and saving after left a real, billed pickup with no row behind it whenever the
    // save lost the race — invisible in the admin UI and impossible to cancel.
    let claim = null;
    try {
      claim = await BostaPickup.create({
        bosta_pickup_id: `pending:${bostaLocId}:${scheduledDate}`,
        bosta_location_id: bostaLocId,
        location_address: location.address,
        vendor_id: vendor._id,
        vendor_name: vendor.store_name || vendor.name,
        scheduled_date: scheduledDate,
        scheduled_time_slot: defaultTimeSlot,
        contact_person: {
          name: vendor.name || vendor.store_name,
          phone: vendor.phone,
          email: vendor.email,
        },
        status: "scheduled",
        order_ids: [order._id],
        created_by: "system",
      });
    } catch (err) {
      // Someone else claimed it first — attach to their pickup instead of booking a second.
      if (err.code === 11000) {
        const winner = await BostaPickup.findOne({
          bosta_location_id: bostaLocId, scheduled_date: scheduledDate, status: { $ne: "cancelled" },
        });
        if (winner) {
          await attachOrderToPickup(winner, order, location, vendor);
          markSubsBooked(bostaLocId, winner);
          scheduled.push({ pickupId: winner.bosta_pickup_id, existing: true, location: location.address });
        } else {
          warnings.push(`Pickup for ${location.address}: could not claim a slot, will retry.`);
        }
      } else {
        warnings.push(`Pickup for ${location.address}: ${err.message}`);
      }
      continue;
    }

    try {
      // Analyze orders for parcel count and item flags
      const analysis = await analyzePickupOrders([order._id], location.address, vendor._id);
      console.log(`[Bosta Pickup] Location "${location.address}": ${analysis.parcelCount} parcel(s), fragile=${analysis.hasFragile}, big=${analysis.hasBigItems}`);
      if (analysis.pickupFee > 0) {
        // Worth saying out loud: this is money the platform is spending to collect a
        // near-empty pickup, and raising `pickup_batch_threshold` is what stops it.
        console.log(`[Bosta Pickup] "${location.address}": only ${analysis.parcelCount} parcel(s) — Bosta will bill ${analysis.pickupFee} EGP for the visit. Absorbed by the platform.`);
      }

      const result = await bostaService.createPickup({
        businessLocationId: bostaLocId,
        scheduledDate,
        scheduledTimeSlot: defaultTimeSlot,
        contactPerson: {
          name: vendor.name || vendor.store_name,
          phone: vendor.phone,
          email: vendor.email,
        },
        noOfPackages: analysis.parcelCount,
        packageType: analysis.packageType,
        notes: analysis.notes || undefined,
      });

      if (!result.pickupId) throw new Error("Bosta returned no pickup id");

      claim.bosta_pickup_id = result.pickupId;
      claim.parcel_count = analysis.parcelCount;
      claim.has_fragile = analysis.hasFragile;
      claim.has_big_items = analysis.hasBigItems;
      claim.pickup_fee = analysis.pickupFee;
      await claim.save();

      markSubsBooked(bostaLocId, claim);
      scheduled.push({ pickupId: result.pickupId, existing: false, location: location.address });
    } catch (err) {
      // The claim never became a real booking — release it so the slot is free to retry.
      // Whatever Bosta may have created is terminated so it can't arrive unannounced.
      await BostaPickup.deleteOne({ _id: claim._id }).catch(() => {});
      if (claim.bosta_pickup_id && !claim.bosta_pickup_id.startsWith("pending:")) {
        try { await bostaService.deletePickup(claim.bosta_pickup_id); } catch (_) {}
      }
      // Bosta refusing because it already holds a pickup for this location and day is the
      // one recoverable case. Matched on Bosta's own error codes, taken from its documented
      // pickup error table — a bare "already" substring also matches unrelated messages
      // like "already has an outstanding balance".
      //   1078  Cannot create two pickup requests at the same date and pickup location
      //   2024  there is already a pickup assigned to a star today
      //   2025  there is already a pickup picked up by a star today
      //   2026  there is already a pickup marked with exception by a star today
      //   2027  you already created a pickup today
      // (1081 is the same-day cut-off, NOT a duplicate — handled by resolvePickupDate.)
      const DUPLICATE_PICKUP_CODES = [1078, 2024, 2025, 2026, 2027];
      const isAlreadyOnBosta = DUPLICATE_PICKUP_CODES.includes(err.providerResponse?.errorCode);

      warnings.push(
        isAlreadyOnBosta
          ? `Pickup for ${location.address}: Bosta already holds a pickup for ${scheduledDate} (${err.message}); schedule it manually if it needs changing.`
          : `Pickup for ${location.address}: ${err.message}`
      );
    }
  }

  // Persist each booked parcel on its own, with a positional filter rather than
  // `order.save()`. Booking spends seconds inside Bosta's API and a delivery webhook can
  // advance this order in that window; saving the document loaded beforehand would drag it
  // back. The `ready_for_pickup` guard makes each write a no-op if the parcel has already
  // moved on.
  const bookedNow = [];
  for (const { subId, pickupId } of booked) {
    const res = await Order.updateOne(
      { _id: order._id, "sub_orders._id": subId, "sub_orders.status": "ready_for_pickup" },
      {
        $set: {
          "sub_orders.$.status": "pickup_scheduled",
          "sub_orders.$.pickup_id": pickupId,
          "sub_orders.$.pickup_booked_at": new Date(),
        },
        $push: {
          "sub_orders.$.history": {
            action: "pickup_scheduled",
            title: "Pickup scheduled",
            details: `A courier is booked for ${scheduledDate} (${defaultTimeSlot}). This parcel can no longer be cancelled.`,
            actor_role: "system",
            actor_label: "Bosta Pickup",
            metadata: { scheduled_date: scheduledDate, time_slot: defaultTimeSlot },
            created_at: new Date(),
          },
        },
      }
    ).catch((err) => {
      warnings.push(`Could not record the pickup on parcel ${subId}: ${err.message}`);
      return { modifiedCount: 0 };
    });
    if (res.modifiedCount > 0) bookedNow.push({ subId, pickupId });
  }

  // Tell each vendor when their courier is coming. Done from `bookedNow`, so a parcel whose
  // write was a no-op (it had already moved on) never produces an appointment notice for a
  // booking it is not part of.
  {
    const { BostaPickup } = require("../models/bostaPickups");
    const subsById = new Map((order.sub_orders || []).map((s) => [String(s._id), s]));
    const byPickup = new Map();
    for (const { subId, pickupId } of bookedNow) {
      const key = String(pickupId);
      if (!byPickup.has(key)) byPickup.set(key, []);
      byPickup.get(key).push({
        vendorId: subsById.get(String(subId))?.vendor_id,
        orderId: order._id,
        subId,
      });
    }
    for (const [pickupId, parcels] of byPickup) {
      const doc = await BostaPickup.findById(pickupId).lean().catch(() => null);
      if (doc) await notifyVendorsOfPickup(doc, parcels);
    }
  }

  // The courier visit these parcels were just booked onto has a fee, and now that the
  // visit exists we know how many parcels it carries — so each one can take its share.
  // At dispatch there was no visit yet and the share was necessarily zero.
  if (bookedNow.length > 0) {
    await bostaCostService.applyPickupShareToParcels(order._id, bookedNow);
  }

  // Re-derive the order's headline from whatever the parcels now actually say. Read back
  // rather than reasoned about in memory, for the same reason as above.
  let orderAdvanced = false;
  if (bookedNow.length > 0) {
    const subOrderService = require("./subOrderService");
    const fresh = await Order.findById(order._id);
    if (fresh) {
      const rolled = subOrderService.syncOrderStatus(fresh, "Bosta Pickup");
      if (rolled.changed) {
        await Order.updateOne(
          { _id: fresh._id },
          {
            $set: { status: fresh.status },
            $push: { history: fresh.history[fresh.history.length - 1] },
          }
        ).catch((err) => console.error(`[Bosta Pickup] Status sync failed: ${err.message}`));
        order.status = fresh.status;
        orderAdvanced = true;
      }
      // Keep the caller's copy in step so it does not write a stale parcel state later.
      order.sub_orders = fresh.sub_orders;
    }
  }

  // Ids, not the {subId, pickupId} pairs the notification grouping needed — the field name
  // says sub-orders and callers read it as such.
  return { scheduled, warnings, orderAdvanced, booked_sub_orders: bookedNow.map((b) => b.subId) };
}

/**
 * Refresh tracking data for all shipments in an order from Bosta.
 */
async function refreshOrderTracking(orderId) {
  const order = await Order.findById(orderId);
  if (!order) throw new Error("Order not found");
  if (!order.shipments || order.shipments.length === 0) {
    throw new Error("No shipments to track");
  }

  const couriersMod = require("./couriers");
  let completedNow = false;
  const deliveredSubIds = [];

  // Arrive parcels first: the admin pressing "refresh" must reach every parcel on the order,
  // whichever courier carries it. Without this the answer was a cheerful success having
  // refreshed nothing, and the 20-minute cron was the only thing that ever moved them.
  const arriveShipments = (order.shipments || []).filter(
    (s) => couriersMod.providerOfShipment(s) === "arrive" && s.tracking_number && !s.superseded_at
  );
  if (arriveShipments.length > 0) {
    try {
      const arriveAdapter = require("./couriers/arrive/adapter");
      const { applyArriveEvent } = require("./couriers/arrive/tracking");
      const statuses = await arriveAdapter.currentStatus(arriveShipments.map((s) => s.tracking_number));
      for (const shipment of arriveShipments) {
        const hit = statuses.get(String(shipment.tracking_number));
        if (!hit) continue;
        const r = applyArriveEvent(order, shipment, hit.raw, "Arrive Tracking");
        if (r.result?.sub_order_delivered) deliveredSubIds.push(r.result.sub_order_id);
        if (r.changed && r.result?.to === "completed") completedNow = true;
      }
    } catch (err) {
      console.error(`[Arrive Tracking] refresh failed for order ${orderId}: ${err.message}`);
    }
  }

  for (const shipment of order.shipments) {
    if (!shipment.bosta_tracking_number) continue;
    // Retired by a reactivation — the delivery is terminated and the parcel has a new one.
    if (shipment.superseded_at) continue;
    try {
      const tracking = await bostaService.trackDelivery(
        shipment.bosta_tracking_number
      );
      // applyBostaStatusToOrder writes the parcel's own status, appends its history, and
      // then rolls the order up from all of them.
      const result = applyBostaStatusToOrder(order, shipment, readableState(tracking.currentStatus), {
        actorLabel: "Bosta Tracking",
      });
      if (result.sub_order_delivered) deliveredSubIds.push(result.sub_order_id);
      if (result.changed && result.to === "completed") completedNow = true;
      // Fold Bosta's timeline in rather than over: webhook entries carry exception
      // reasons that the timeline doesn't, and overwriting would drop them.
      shipment.tracking_history = mergeTrackingHistory(
        shipment.tracking_history, tracking.trackingHistory
      );
      if (tracking.expectedCashoutDate) {
        shipment.cod_settlement = shipment.cod_settlement || {};
        shipment.cod_settlement.expected_at = new Date(tracking.expectedCashoutDate);
      }
    } catch (_) {
      // Keep existing data on failure
    }
  }

  await order.save();

  // Each newly delivered parcel releases its own vendor's money and opens its own return
  // window; the order-level hook only exists for orders that predate parcels.
  const orderService = require("./orderService");
  for (const subId of deliveredSubIds) {
    const sub = (order.sub_orders || []).find((s) => s._id.toString() === subId?.toString());
    if (sub) await orderService.onSubOrderDelivered(order, sub).catch((err) =>
      console.error(`[Bosta Tracking] Delivery hook failed for ${subId}: ${err.message}`));
  }
  if (completedNow && deliveredSubIds.length === 0) {
    await orderService.onOrderCompleted(order);
  }

  return order;
}

/**
 * Polling fallback: poll Bosta for every order that is dispatched but not yet in a
 * terminal state, and apply status updates via the central mapping. Runs on a cron
 * (see app.js) so orders still progress even if a webhook is missed or unconfigured.
 * @returns {{ checked: number, updated: number }}
 */
async function sweepActiveBostaOrders() {
  // `exception` and `returned` are included deliberately: they are the states most
  // likely to need a correction (a postponed delivery still gets delivered later), and
  // if the webhook announcing that recovery is missed nothing else would ever re-check.
  const orders = await Order.find({
    status: {
      // The `partially_*` statuses are the normal state of a live multi-vendor order now, so
      // omitting them would have quietly excluded most orders from the polling fallback.
      $in: [
        "ready", "pickup_scheduled", "picked_up", "in_transit", "out_for_delivery",
        "partially_shipped", "partially_delivered", "exception", "returned",
      ],
    },
    "shipments.bosta_tracking_number": { $ne: null },
  });

  const orderService = require("./orderService");
  let updated = 0;
  for (const order of orders) {
    let changed = false;
    let completedNow = false;
    const deliveredSubIds = [];
    for (const shipment of order.shipments) {
      if (!shipment.bosta_tracking_number) continue;
      if (shipment.superseded_at) continue;
      try {
        const tracking = await bostaService.trackDelivery(shipment.bosta_tracking_number);
        const result = applyBostaStatusToOrder(order, shipment, readableState(tracking.currentStatus), {
          actorLabel: "Bosta Sweep",
        });
        shipment.tracking_history = mergeTrackingHistory(
          shipment.tracking_history, tracking.trackingHistory
        );
        // When Bosta says it will transfer this parcel's cash. Recorded whenever it is
        // offered, so the finance screen can say not just how much a courier is holding but
        // when it is due — and flag a transfer that is late.
        if (tracking.expectedCashoutDate) {
          shipment.cod_settlement = shipment.cod_settlement || {};
          shipment.cod_settlement.expected_at = new Date(tracking.expectedCashoutDate);
        }
        if (result.changed) changed = true;
        if (result.sub_order_delivered) deliveredSubIds.push(result.sub_order_id);
        if (result.changed && result.to === "completed") completedNow = true;
      } catch (_) {
        // Skip this shipment on failure; next sweep will retry.
      }
    }
    try {
      await order.save();
      if (changed) updated += 1;
      for (const subId of deliveredSubIds) {
        const sub = (order.sub_orders || []).find((s) => s._id.toString() === subId?.toString());
        if (sub) await orderService.onSubOrderDelivered(order, sub);
      }
      if (completedNow && deliveredSubIds.length === 0) {
        await orderService.onOrderCompleted(order);
      }
    } catch (err) {
      console.error(`[Bosta sweep] Failed to save order ${order._id}:`, err.message);
    }
  }

  return { checked: orders.length, updated };
}

module.exports = {
  parcelDescription,
  notifyVendorsOfPickup,
  sendOrderToBosta,
  dispatchSubOrder,
  linkStickerToShipment,
  // Exported for the courier-cost backfill, so a historical parcel is sized by the exact
  // same rule the live dispatch sizes it by rather than by a second copy that can drift.
  classFlagsForItems,
  dispatchBlockedReason,
  refreshOrderTracking,
  dispatchSubOrderToArrive,
  attachArriveShipment,
  sweepActiveBostaOrders,
  groupItemsByPickupLocation,
  schedulePickupsForOrder,
  resolveSubLocation,
  analyzePickupOrders,
};
