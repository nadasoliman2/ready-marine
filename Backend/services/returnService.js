const { Order } = require("../models/orders");
const { User } = require("../models/users");
const { ReturnRequest, generateReturnNumber } = require("../models/returnRequests");
const { createNotification } = require("../models/notifications");
const { sendReturnStatusEmail } = require("./emailService");

const RETURN_WINDOW_DAYS = 14;

const RETURN_TRANSITIONS = {
  pending_vendor_review: ["vendor_approved", "vendor_rejected", "pending_admin_review", "cancelled"],
  vendor_approved: ["pending_admin_review"],
  vendor_rejected: ["pending_admin_review"],
  pending_admin_review: ["approved", "rejected"],
  approved: ["return_shipping"],
  return_shipping: ["return_received"],
  return_received: ["refund_processing"],
  refund_processing: ["completed"],
};

/**
 * Photo or video evidence is required on EVERY return, whatever the reason.
 *
 * It used to be demanded only for the fault-implying reasons (defective, wrong item, not as
 * described). That left the reasons most open to dispute — "changed my mind" on an item
 * that arrives scratched — with nothing on file, and the argument about what condition the
 * goods were in came down to two people's word months later.
 *
 * It also pairs with the parcel photos the vendor now takes at handover: one picture of the
 * box leaving the store, one of the goods coming back. Requiring only half of that pair was
 * the gap.
 */
const MIN_RETURN_EVIDENCE = 1;
const MAX_RETURN_EVIDENCE = 6;
const FAULT_TYPE_BY_REASON = {
  defective: "vendor_fault",
  wrong_item: "vendor_fault",
  not_as_described: "vendor_fault",
  changed_mind: "customer_fault",
};
const ALLOWED_FAULT_TYPES = ["vendor_fault", "customer_fault", "undetermined"];

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const normalizeActor = (actor = {}) => ({
  role: actor.role || "system",
  label: actor.label || actor.username || "System",
});

const appendHistory = (doc, action, title, details = "", metadata = {}, actor = {}) => {
  const a = normalizeActor(actor);
  doc.history = doc.history || [];
  doc.history.push({
    action,
    title,
    details,
    actor_role: a.role,
    actor_label: a.label,
    metadata,
    created_at: new Date(),
  });
};

const assertTransition = (currentStatus, targetStatus) => {
  const allowed = RETURN_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(targetStatus)) {
    const err = new Error(`Cannot transition from "${currentStatus}" to "${targetStatus}"`);
    err.code = "INVALID_RETURN_STATUS";
    throw err;
  }
};

const normalizeFaultType = (faultType, reason) => {
  if (ALLOWED_FAULT_TYPES.includes(faultType)) return faultType;
  return FAULT_TYPE_BY_REASON[reason] || "undetermined";
};

/**
 * Clean what the client sent into storable evidence entries.
 *
 * The client is not trusted for any of it: entries without a usable URL are dropped rather
 * than stored as blanks that would later render as broken images, and `type` is inferred
 * from the extension instead of believed, so an mp4 labelled "image" still plays.
 */
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".m4v", ".avi"];

const normalizeEvidence = (evidence = []) => {
  const list = Array.isArray(evidence) ? evidence : [evidence];
  const seen = new Set();
  const out = [];

  for (const raw of list) {
    const url = String((raw && typeof raw === "object" ? raw.url : raw) || "").trim();
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    const lower = url.toLowerCase().split("?")[0];
    const isVideo = VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
    out.push({ url, type: isVideo ? "video" : "image", uploaded_at: new Date() });
  }

  return out;
};

/* ------------------------------------------------------------------ */
/*  Validation                                                        */
/* ------------------------------------------------------------------ */

const validateReturnEligibility = async (orderId, userId, items, reason, evidence = []) => {
  const order = await Order.findById(orderId);
  if (!order) throw Object.assign(new Error("Order not found"), { code: "ORDER_NOT_FOUND" });
  if (order.user_id.toString() !== userId.toString()) {
    throw Object.assign(new Error("Order does not belong to this user"), { code: "ORDER_NOT_FOUND" });
  }
  // Eligibility is decided by the PARCEL these items arrived in, not by the order.
  //
  // An order can hold three parcels delivered days apart. Requiring the whole order to be
  // complete meant a customer holding a faulty part since Monday could not open a return
  // until the slowest vendor turned up on Friday — and then the window ran from Friday for
  // all of them. Each parcel now carries its own delivery date and its own window.
  const hasSubOrders = Array.isArray(order.sub_orders) && order.sub_orders.length > 0;
  let eligibleSubOrder = null;

  if (hasSubOrders) {
    const firstItem = order.items.id(items?.[0]?.order_item_id);
    eligibleSubOrder = firstItem
      ? (order.sub_orders || []).find((s) => s._id.toString() === String(firstItem.sub_order_id))
      : null;

    if (!eligibleSubOrder) {
      throw Object.assign(
        new Error("Could not work out which parcel these items arrived in"),
        { code: "ORDER_NOT_ELIGIBLE" }
      );
    }
    if (eligibleSubOrder.status !== "delivered") {
      throw Object.assign(
        new Error("This parcel has not been delivered yet, so it cannot be returned"),
        { code: "ORDER_NOT_ELIGIBLE" }
      );
    }
  } else if (!require("./subOrderService").DELIVERED_ORDER_STATUSES.includes(order.status)) {
    // Every delivered status, not just "completed": once one line of an old order is on its
    // way back the order's status says so, and that must not block a return on the rest.
    throw Object.assign(new Error("Only completed orders are eligible for returns"), { code: "ORDER_NOT_ELIGIBLE" });
  }

  // Check return window — from THIS parcel's delivery, not the order's last one.
  const deliveredAt = eligibleSubOrder?.delivered_at || order.delivered_at || order.created_at;
  const deadline = new Date(deliveredAt);
  deadline.setDate(deadline.getDate() + RETURN_WINDOW_DAYS);
  if (new Date() > deadline) {
    throw Object.assign(
      new Error(`Return window has expired (${RETURN_WINDOW_DAYS} days from this parcel's delivery)`),
      { code: "RETURN_WINDOW_EXPIRED" }
    );
  }

  // Evidence, on every return without exception.
  const cleanEvidence = normalizeEvidence(evidence);
  if (cleanEvidence.length < MIN_RETURN_EVIDENCE) {
    throw Object.assign(
      new Error("Please attach at least one photo of the item you are returning"),
      { code: "EVIDENCE_REQUIRED" }
    );
  }
  if (cleanEvidence.length > MAX_RETURN_EVIDENCE) {
    throw Object.assign(
      new Error(`A return can carry at most ${MAX_RETURN_EVIDENCE} photos or videos`),
      { code: "TOO_MUCH_EVIDENCE" }
    );
  }

  // Validate items
  if (!items || items.length === 0) {
    throw Object.assign(new Error("At least one item is required"), { code: "INVALID_ITEMS" });
  }

  // All items must belong to the same vendor
  const vendorIds = new Set();

  // Check existing return requests for this order to track cumulative returned quantities
  const existingReturns = await ReturnRequest.find({
    order_id: orderId,
    status: { $nin: ["rejected", "cancelled"] },
  }).lean();

  // Build map of already-returning quantities per order_item_id
  const returningQtyMap = {};
  for (const ret of existingReturns) {
    for (const ri of ret.items) {
      const key = ri.order_item_id.toString();
      returningQtyMap[key] = (returningQtyMap[key] || 0) + ri.quantity_returning;
    }
  }

  const validatedItems = [];

  for (const reqItem of items) {
    const orderItem = order.items.id(reqItem.order_item_id);
    if (!orderItem) {
      throw Object.assign(new Error(`Order item ${reqItem.order_item_id} not found`), { code: "INVALID_ITEMS" });
    }
    if (orderItem.vendor_status !== "approved") {
      throw Object.assign(
        new Error(`Item "${orderItem.product_title}" was not approved and cannot be returned`),
        { code: "INVALID_ITEMS" }
      );
    }

    const qtyReturning = Number(reqItem.quantity_returning) || orderItem.quantity;
    const alreadyReturning = returningQtyMap[orderItem._id.toString()] || 0;
    const available = orderItem.quantity - alreadyReturning;

    if (available <= 0) {
      throw Object.assign(
        new Error(`Item "${orderItem.product_title}" already has a pending or completed return`),
        { code: "ITEM_ALREADY_RETURNED" }
      );
    }
    if (qtyReturning > available) {
      throw Object.assign(
        new Error(`Cannot return ${qtyReturning} of "${orderItem.product_title}" — only ${available} available`),
        { code: "INVALID_ITEMS" }
      );
    }

    vendorIds.add(orderItem.vendor_id.toString());

    validatedItems.push({
      order_item_id: orderItem._id,
      product_id: orderItem.product_id,
      product_title: orderItem.product_title,
      product_image: orderItem.product_image,
      variant_id: orderItem.variant_id,
      variant_label: orderItem.variant_label,
      quantity_purchased: orderItem.quantity,
      quantity_returning: qtyReturning,
      unit_price: orderItem.unit_price,
      commission_rate: orderItem.commission_rate || 0,
      commission_amount: orderItem.commission_amount || 0,
    });
  }

  if (vendorIds.size > 1) {
    throw Object.assign(
      new Error("All items in a return request must belong to the same vendor. Create separate requests per vendor."),
      { code: "MULTI_VENDOR_RETURN" }
    );
  }

  // Tighter than the vendor rule above once parcels exist: two branches of the same vendor
  // are two parcels with two delivery dates, two return windows and two earnings rows, so a
  // request spanning both has no single answer to any of them.
  if (eligibleSubOrder) {
    const foreign = validatedItems.find((vi) => {
      const oi = order.items.id(vi.order_item_id);
      return String(oi?.sub_order_id) !== eligibleSubOrder._id.toString();
    });
    if (foreign) {
      throw Object.assign(
        new Error("All items in a return request must have arrived in the same parcel. Create separate requests per parcel."),
        { code: "MULTI_PARCEL_RETURN" }
      );
    }
  }

  const vendorId = [...vendorIds][0];
  return {
    order, validatedItems, vendorId, deadline,
    subOrderId: eligibleSubOrder?._id || null,
    evidence: cleanEvidence,
  };
};

/* ------------------------------------------------------------------ */
/*  Create                                                            */
/* ------------------------------------------------------------------ */

const createReturnRequest = async ({ userId, orderId, items, reason, reason_details = "", evidence = [], fault_type }) => {
  const {
    order, validatedItems, vendorId, deadline, subOrderId,
    evidence: cleanEvidence,
  } = await validateReturnEligibility(orderId, userId, items, reason, evidence);
  const initialFaultType = normalizeFaultType(fault_type, reason);

  const returnRequest = await ReturnRequest.create({
    return_number: generateReturnNumber(),
    order_id: orderId,
    user_id: userId,
    vendor_id: vendorId,
    sub_order_id: subOrderId,
    items: validatedItems,
    reason,
    reason_details,
    // The cleaned list, never the raw body.
    evidence: cleanEvidence,
    fault_type: initialFaultType,
    status: "pending_vendor_review",
    return_window_deadline: deadline,
    history: [
      {
        action: "return_created",
        title: "Return request created",
        details: `Customer requested return for ${validatedItems.length} item(s). Reason: ${reason}`,
        actor_role: "user",
        actor_label: "Customer",
        metadata: {
          reason,
          fault_type: initialFaultType,
          item_count: validatedItems.length,
          evidence_count: cleanEvidence.length,
        },
        created_at: new Date(),
      },
    ],
  });

  // Update order item return_status
  for (const vi of validatedItems) {
    const orderItem = order.items.id(vi.order_item_id);
    if (orderItem) orderItem.return_status = "return_requested";
  }

  appendHistory(order, "return_requested", "Return request submitted", `Return ${returnRequest.return_number} created`, {
    return_id: returnRequest._id,
    return_number: returnRequest.return_number,
  }, { role: "user", label: "Customer" });

  // The order stops being "completed" the moment part of it starts coming back.
  require("./subOrderService").syncOrderStatus(order, "Customer");

  await order.save();

  // Notify vendor
  try {
    const itemNames = validatedItems.map((i) => i.product_title).join(", ");
    await createNotification(
      vendorId,
      "return_request_received",
      "New Return Request",
      `Return ${returnRequest.return_number}: Customer wants to return ${validatedItems.length} item(s) — ${itemNames}. Reason: ${reason}.`,
      { return_id: returnRequest._id, return_number: returnRequest.return_number, order_id: orderId }
    );
  } catch (_) { /* notification failure should not block */ }

  return returnRequest;
};

/* ------------------------------------------------------------------ */
/*  Read                                                              */
/* ------------------------------------------------------------------ */

const getReturnRequestById = async (id) => {
  const returnRequest = await ReturnRequest.findById(id)
    .populate("user_id", "name email phone")
    .populate("vendor_id", "name store_name email phone")
    .lean();

  if (!returnRequest) return returnRequest;

  // How this order was paid, and therefore where a refund goes unless the
  // admin says otherwise. Carried here so the refund screen can preselect the
  // destination instead of asking the admin to remember it.
  const order = await Order.findById(returnRequest.order_id)
    .select("transaction.payment_method")
    .lean();
  const originalMethod = order?.transaction?.payment_method || "cash";

  const { defaultRefundMethod } = require("./refundService");
  const walletService = require("./walletService");
  const walletLive = await walletService.isWalletEnabled().catch(() => false);

  return {
    ...returnRequest,
    original_payment_method: originalMethod,
    default_refund_method: defaultRefundMethod(originalMethod, walletLive),
  };
};

const getReturnRequestsForUser = async (userId, { page = 1, limit = 20, status } = {}) => {
  const filter = { user_id: userId };
  if (status) filter.status = status;

  const total = await ReturnRequest.countDocuments(filter);
  const returns = await ReturnRequest.find(filter)
    .sort({ created_at: -1 })
    .skip((Math.max(1, Number(page)) - 1) * Number(limit))
    .limit(Number(limit))
    .populate("vendor_id", "store_name")
    .lean();

  return {
    returns,
    pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)), limit: Number(limit) },
  };
};

const getReturnRequestsForVendor = async (vendorId, { page = 1, limit = 20, status } = {}) => {
  const filter = { vendor_id: vendorId };
  if (status) filter.status = status;

  const total = await ReturnRequest.countDocuments(filter);
  const returns = await ReturnRequest.find(filter)
    .sort({ created_at: -1 })
    .skip((Math.max(1, Number(page)) - 1) * Number(limit))
    .limit(Number(limit))
    .populate("user_id", "name email")
    .lean();

  return {
    returns,
    pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)), limit: Number(limit) },
  };
};

const getAllReturnRequests = async ({ page = 1, limit = 20, status, vendorId, search, from, to } = {}) => {
  const filter = {};
  if (status) filter.status = status;
  if (vendorId) filter.vendor_id = vendorId;
  if (from || to) {
    filter.created_at = {};
    if (from) filter.created_at.$gte = new Date(from);
    if (to) filter.created_at.$lte = new Date(to);
  }
  if (search) {
    filter.$or = [
      { return_number: { $regex: search, $options: "i" } },
      { reason_details: { $regex: search, $options: "i" } },
    ];
  }

  const total = await ReturnRequest.countDocuments(filter);
  const returns = await ReturnRequest.find(filter)
    .sort({ created_at: -1 })
    .skip((Math.max(1, Number(page)) - 1) * Number(limit))
    .limit(Number(limit))
    .populate("user_id", "name email")
    .populate("vendor_id", "store_name name")
    .lean();

  return {
    returns,
    pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)), limit: Number(limit) },
  };
};

const getReturnCounts = async (filter = {}) => {
  const statuses = [
    "pending_vendor_review", "vendor_approved", "vendor_rejected",
    "pending_admin_review", "approved", "rejected",
    "return_shipping", "return_received", "refund_processing", "completed", "cancelled",
  ];
  const counts = {};
  await Promise.all(
    statuses.map(async (s) => {
      counts[s] = await ReturnRequest.countDocuments({ ...filter, status: s });
    })
  );
  counts.total = Object.values(counts).reduce((a, b) => a + b, 0);
  return counts;
};

/* ------------------------------------------------------------------ */
/*  Vendor Review                                                     */
/* ------------------------------------------------------------------ */

const vendorReviewReturn = async (returnId, vendorId, { decision, notes = "" }) => {
  const ret = await ReturnRequest.findById(returnId);
  if (!ret) throw Object.assign(new Error("Return request not found"), { code: "NOT_FOUND" });
  if (ret.vendor_id.toString() !== vendorId.toString()) {
    throw Object.assign(new Error("This return does not belong to your store"), { code: "VENDOR_MISMATCH" });
  }
  if (ret.status !== "pending_vendor_review") {
    throw Object.assign(
      new Error("Return is not pending vendor review"),
      { code: "INVALID_RETURN_STATUS" }
    );
  }
  if (!["approved", "rejected"].includes(decision)) {
    throw Object.assign(new Error("Decision must be 'approved' or 'rejected'"), { code: "INVALID_INPUT" });
  }

  const targetStatus = decision === "approved" ? "vendor_approved" : "vendor_rejected";
  assertTransition(ret.status, targetStatus);

  ret.vendor_review = { decision, notes, reviewed_at: new Date() };
  ret.status = targetStatus;
  ret.updated_at = new Date();

  appendHistory(ret, `vendor_${decision}`, `Vendor ${decision} return`, notes || `Vendor ${decision} the return request`, {
    decision, notes,
  }, { role: "vendor", label: "Vendor" });

  // Auto-escalate to admin
  assertTransition(ret.status, "pending_admin_review");
  ret.status = "pending_admin_review";
  appendHistory(ret, "escalated_to_admin", "Escalated to admin", `Return escalated to admin for final review after vendor ${decision}`, {}, { role: "system", label: "System" });

  await ret.save();
  return ret;
};

/* ------------------------------------------------------------------ */
/*  Admin Review                                                      */
/* ------------------------------------------------------------------ */

const adminReviewReturn = async (returnId, { decision, fault_type, notes = "", adminUsername = "Admin" }) => {
  const ret = await ReturnRequest.findById(returnId);
  if (!ret) throw Object.assign(new Error("Return request not found"), { code: "NOT_FOUND" });
  if (ret.status !== "pending_admin_review") {
    throw Object.assign(new Error("Return is not pending admin review"), { code: "INVALID_RETURN_STATUS" });
  }
  if (!["approved", "rejected"].includes(decision)) {
    throw Object.assign(new Error("Decision must be 'approved' or 'rejected'"), { code: "INVALID_INPUT" });
  }
  if (decision === "approved") {
    const finalFaultType = fault_type || ret.fault_type;
    if (!["vendor_fault", "customer_fault"].includes(finalFaultType)) {
      throw Object.assign(new Error("Fault type is required when approving a return"), { code: "INVALID_INPUT" });
    }
  }

  const targetStatus = decision === "approved" ? "approved" : "rejected";
  assertTransition(ret.status, targetStatus);

  ret.admin_review = { decision, notes, reviewed_at: new Date(), reviewed_by: adminUsername };
  ret.status = targetStatus;
  ret.updated_at = new Date();

  if (decision === "approved") {
    ret.fault_type = fault_type || ret.fault_type;
  }

  appendHistory(ret, `admin_${decision}`, `Admin ${decision} return`, notes || `Admin ${decision} the return request`, {
    decision, fault_type, notes,
  }, { role: "admin", label: adminUsername });

  await ret.save();

  // Update order item return_status
  const order = await Order.findById(ret.order_id);
  if (order) {
    for (const ri of ret.items) {
      const orderItem = order.items.id(ri.order_item_id);
      if (orderItem) {
        orderItem.return_status = decision === "approved" ? "return_approved" : "none";
      }
    }
    // A rejected return puts the order back to where it was, which this recomputes too.
    require("./subOrderService").syncOrderStatus(order, "Store team");
    await order.save();
  }

  // Notify vendor
  try {
    if (decision === "approved") {
      await createNotification(
        ret.vendor_id,
        "return_admin_approved",
        "Return Approved by Admin",
        `Return ${ret.return_number} has been approved. Awaiting return shipment.`,
        { return_id: ret._id, return_number: ret.return_number }
      );
    }
  } catch (_) {}

  // Email customer about the decision
  try {
    const customer = await User.findById(ret.user_id).select("name email").lean();
    if (customer?.email) {
      await sendReturnStatusEmail({
        to: customer.email,
        name: customer.name,
        returnNumber: ret.return_number,
        status: decision === "approved" ? "approved" : "rejected",
        details: decision === "approved"
          ? `Your return request ${ret.return_number} has been approved. We will arrange the return shipment.`
          : `Your return request ${ret.return_number} has been rejected.${notes ? ` Reason: ${notes}` : ""}`,
      });
    }
  } catch (_) {}

  // Auto-create the Bosta return shipment only when BOTH the vendor and the admin
  // approved. If the vendor rejected (and admin overrode to approve), leave the
  // return at "approved" so the admin can ship manually as an override.
  if (decision === "approved" && ret.vendor_review?.decision === "approved") {
    try {
      const { createReturnShipment } = require("./returnLogisticsService");
      return await createReturnShipment(ret._id, { role: "admin", label: adminUsername });
    } catch (err) {
      // Leave the return at "approved"; the admin can retry via the manual ship action.
      console.error(`[Return] Auto-ship to Bosta failed for ${ret.return_number}:`, err.message);
    }
  }

  return ret;
};

/* ------------------------------------------------------------------ */
/*  Customer Cancel                                                   */
/* ------------------------------------------------------------------ */

const cancelReturnRequest = async (returnId, userId) => {
  const ret = await ReturnRequest.findById(returnId);
  if (!ret) throw Object.assign(new Error("Return request not found"), { code: "NOT_FOUND" });
  if (ret.user_id.toString() !== userId.toString()) {
    throw Object.assign(new Error("Return does not belong to this user"), { code: "NOT_FOUND" });
  }
  if (ret.status !== "pending_vendor_review") {
    throw Object.assign(new Error("Return can only be cancelled while pending vendor review"), { code: "INVALID_RETURN_STATUS" });
  }

  assertTransition(ret.status, "cancelled");
  ret.status = "cancelled";
  ret.updated_at = new Date();
  appendHistory(ret, "return_cancelled", "Return cancelled by customer", "", {}, { role: "user", label: "Customer" });
  await ret.save();

  // Reset order item return_status
  const order = await Order.findById(ret.order_id);
  if (order) {
    for (const ri of ret.items) {
      const orderItem = order.items.id(ri.order_item_id);
      if (orderItem && orderItem.return_status === "return_requested") {
        orderItem.return_status = "none";
      }
    }
    // Nothing is coming back any more, so the order returns to its delivered status.
    require("./subOrderService").syncOrderStatus(order, "Customer");
    await order.save();
  }

  return ret;
};

/* ------------------------------------------------------------------ */
/*  Confirm Return Received                                           */
/* ------------------------------------------------------------------ */

const confirmReturnReceived = async (returnId, actor = {}) => {
  const ret = await ReturnRequest.findById(returnId);
  if (!ret) throw Object.assign(new Error("Return request not found"), { code: "NOT_FOUND" });

  if (ret.status !== "return_shipping" && ret.status !== "approved") {
    throw Object.assign(
      new Error("Return must be in shipping or approved status to confirm receipt"),
      { code: "INVALID_RETURN_STATUS" }
    );
  }

  // Allow transition from approved directly (for cases where shipping is handled externally)
  ret.status = "return_received";
  ret.updated_at = new Date();
  if (ret.return_shipment) {
    ret.return_shipment.received_at = new Date();
  }

  appendHistory(ret, "return_received", "Return goods received", "Vendor/admin confirmed receipt of returned items", {}, actor);
  await ret.save();

  // Update order item return_status
  const order = await Order.findById(ret.order_id);
  if (order) {
    for (const ri of ret.items) {
      const orderItem = order.items.id(ri.order_item_id);
      if (orderItem) orderItem.return_status = "returned";
    }
    require("./subOrderService").syncOrderStatus(order, "Store team");
    await order.save();

    // A parcel returned in full is no longer a completed order, so the vendor's public
    // count has to come back down. Fail-safe: never blocks recording the return itself.
    try {
      await require("./vendorStatsService").refreshCompletedOrdersForOrder(order);
    } catch (err) {
      console.error(`[VendorStats] Recount after return ${ret._id} failed: ${err.message}`);
    }
  }

  // Notify user
  try {
    await createNotification(
      ret.vendor_id,
      "return_received_by_vendor",
      "Returned Items Received",
      `Return ${ret.return_number}: Items have been received. Refund processing will begin shortly.`,
      { return_id: ret._id, return_number: ret.return_number }
    );
  } catch (_) { /* notification failure should not block */ }

  return ret;
};

module.exports = {
  RETURN_WINDOW_DAYS,
  RETURN_TRANSITIONS,
  validateReturnEligibility,
  createReturnRequest,
  getReturnRequestById,
  getReturnRequestsForUser,
  getReturnRequestsForVendor,
  getAllReturnRequests,
  getReturnCounts,
  vendorReviewReturn,
  adminReviewReturn,
  cancelReturnRequest,
  confirmReturnReceived,
};
