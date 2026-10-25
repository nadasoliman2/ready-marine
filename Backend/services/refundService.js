const { Order } = require("../models/orders");
const { Product } = require("../models/products");
const { User } = require("../models/users");
const { Refund, generateRefundNumber } = require("../models/refunds");
const { ReturnRequest } = require("../models/returnRequests");
const { createNotification } = require("../models/notifications");
const { sendRefundCompletedEmail } = require("./emailService");

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

const FAULT_TYPE_BY_REASON = {
  defective: "vendor_fault",
  wrong_item: "vendor_fault",
  not_as_described: "vendor_fault",
  changed_mind: "customer_fault",
};

const inferFaultTypeFromReason = (reason) => FAULT_TYPE_BY_REASON[reason] || "undetermined";

/* ------------------------------------------------------------------ */
/*  Refund Calculation Engine                                         */
/* ------------------------------------------------------------------ */

/**
 * Calculate refund amounts for a return request.
 *
 * Mirrors the commission calculation logic in orderService.js:
 * - Proportional coupon discount reversal
 * - Commission reversal based on post-discount amounts
 * - Shipping refund allocation for vendor_fault returns
 */
const calculateRefund = (returnRequest, order) => {
  const faultType = returnRequest.fault_type;

  // Reconstruct coupon context from order
  const totalDiscount = Number(order.coupon_discount_amount || 0);
  const couponScopeType = order.coupon_scope_type;
  // The vendor's percentage of the coupon, as frozen on the order. Absent on orders from
  // before coupons could be shared: 0, the platform funded them.
  const vendorPct = Math.min(100, Math.max(0, Number(order.coupon_vendor_share_percent || 0)));

  // Calculate eligible subtotal for coupon (all items that were eligible)
  // We approximate by using all order items as eligible if scope is all_products,
  // otherwise only items matching the scope. Since we don't store individual item
  // coupon eligibility, we use the full subtotal for proportional calculation.
  const allItemsTotal = (order.items || []).reduce(
    (sum, item) => sum + Number(item.unit_price || 0) * Number(item.quantity || 0),
    0
  );
  const eligibleSubtotal = allItemsTotal > 0 ? allItemsTotal : 1; // prevent div by zero

  // Get vendor's shipping cost from the order
  const vendorIdStr = returnRequest.vendor_id.toString();
  const perVendor = (order.shipping?.per_vendor || []).find(
    (pv) => pv.vendor_id?.toString() === vendorIdStr
  );
  const vendorShippingCost = Number(perVendor?.cost || 0);

  // Sum of all vendor items (full quantities) to calculate proportional shipping
  const vendorItemsTotal = (order.items || [])
    .filter((i) => i.vendor_id?.toString() === vendorIdStr)
    .reduce((sum, i) => sum + Number(i.unit_price || 0) * Number(i.quantity || 0), 0);

  // Loyalty points funded a share of this order's merchandise. That share is
  // allocated across post-coupon line value, so a returned item carries back
  // exactly the proportion of the discount it was given.
  const orderLoyaltyDiscount = Number(order.loyalty?.redemption_discount || 0);
  const orderMerchandiseAfterCoupon = Math.max(0, allItemsTotal - totalDiscount);
  const loyaltyRate = orderMerchandiseAfterCoupon > 0
    ? orderLoyaltyDiscount / orderMerchandiseAfterCoupon
    : 0;

  const lineItems = [];
  let totalSubtotal = 0;
  let totalDiscountReversal = 0;
  let totalDiscountVendorShare = 0;
  let totalLoyaltyReversal = 0;
  let totalShippingRefund = 0;
  let totalCommissionReversal = 0;

  for (const item of returnRequest.items) {
    const lineTotal = Number(item.quantity_returning) * Number(item.unit_price);

    // Proportional coupon discount reversal
    let discountShare = 0;
    if (totalDiscount > 0) {
      const fullLineTotal = Number(item.quantity_purchased) * Number(item.unit_price);
      const itemDiscountShare = (fullLineTotal / eligibleSubtotal) * totalDiscount;
      discountShare = Number(
        (itemDiscountShare * (Number(item.quantity_returning) / Number(item.quantity_purchased))).toFixed(2)
      );
    }

    // The vendor's part of that discount — the only part that comes off their earning.
    const discountVendorShare = Number(((discountShare * vendorPct) / 100).toFixed(2));

    const postCouponLineTotal = Math.max(0, lineTotal - discountShare);
    // What points paid for on this line. Comes off the cash refund and goes
    // back as points instead.
    const loyaltyShare = Number(Math.min(postCouponLineTotal, postCouponLineTotal * loyaltyRate).toFixed(2));

    const effectiveRefund = Math.max(0, postCouponLineTotal - loyaltyShare);

    // Commission reversal (mirrors orderService.js commission calc). Based on
    // the post-coupon value: the vendor was paid for the goods regardless of
    // whether the customer settled with cash or with points.
    const commissionReversal = Number(
      (postCouponLineTotal * (Number(item.commission_rate || 0) / 100)).toFixed(2)
    );

    // Shipping refund (only for vendor_fault)
    let shippingShare = 0;
    if (faultType === "vendor_fault" && vendorShippingCost > 0 && vendorItemsTotal > 0) {
      shippingShare = Number(
        (vendorShippingCost * (lineTotal / vendorItemsTotal)).toFixed(2)
      );
    }

    // Money only. The loyalty-funded share is already excluded from
    // `effectiveRefund` and comes back to the customer as points.
    const refundAmount = Number((effectiveRefund + shippingShare).toFixed(2));

    lineItems.push({
      return_item_id: item._id,
      order_item_id: item.order_item_id,
      product_title: item.product_title,
      variant_label: item.variant_label,
      quantity: item.quantity_returning,
      unit_price: item.unit_price,
      line_total: lineTotal,
      discount_share: discountShare,
      discount_vendor_share: discountVendorShare,
      loyalty_share: loyaltyShare,
      shipping_share: shippingShare,
      commission_reversal: commissionReversal,
      refund_amount: refundAmount,
    });

    totalSubtotal += lineTotal;
    totalDiscountReversal += discountShare;
    totalDiscountVendorShare += discountVendorShare;
    totalLoyaltyReversal += loyaltyShare;
    totalShippingRefund += shippingShare;
    totalCommissionReversal += commissionReversal;
  }

  return {
    lineItems,
    subtotal: Number(totalSubtotal.toFixed(2)),
    discountReversal: Number(totalDiscountReversal.toFixed(2)),
    discountVendorShare: Number(totalDiscountVendorShare.toFixed(2)),
    loyaltyReversal: Number(totalLoyaltyReversal.toFixed(2)),
    shippingRefund: Number(totalShippingRefund.toFixed(2)),
    totalCommissionReversal: Number(totalCommissionReversal.toFixed(2)),
  };
};

/* ------------------------------------------------------------------ */
/*  Loyalty settlement                                                */
/* ------------------------------------------------------------------ */

/**
 * Work out what a return owes the loyalty ledger, in points.
 *
 * Two independent movements, and they are not the same number:
 *
 *  - **Restore**: points that PAID for the returned items come back. Their
 *    share is proportional to the post-coupon value being returned.
 *  - **Reverse**: points the order EARNED on those items are taken away.
 *    Proportional to the eligible (cash-funded) value being returned, because
 *    that is what earned them in the first place.
 *
 * Both are clamped to what is still outstanding on the order, so partial
 * returns can be repeated without ever over-restoring or over-reversing.
 */
const planLoyaltySettlement = (order, calc) => {
  const loyalty = order.loyalty || {};

  const allItemsTotal = (order.items || []).reduce(
    (sum, item) => sum + Number(item.unit_price || 0) * Number(item.quantity || 0),
    0
  );
  const orderMerchandiseAfterCoupon = Math.max(0, allItemsTotal - Number(order.coupon_discount_amount || 0));
  const returnedAfterCoupon = Math.max(0, Number(calc.subtotal) - Number(calc.discountReversal));
  const returnedRatio = orderMerchandiseAfterCoupon > 0
    ? Math.min(1, returnedAfterCoupon / orderMerchandiseAfterCoupon)
    : 0;

  // --- Restore what points paid for ---
  const redeemed = Math.max(0, Math.floor(Number(loyalty.redeemed_points || 0)));
  const alreadyRestored = Math.max(0, Math.floor(Number(loyalty.restored_points || 0)));
  const restoreOutstanding = Math.max(0, redeemed - alreadyRestored);
  const pointsToRestore = Math.min(restoreOutstanding, Math.round(redeemed * returnedRatio));

  // --- Reverse what the order earned ---
  // Earning ran on merchandise AFTER the loyalty discount, so the returned
  // slice of that base is the post-coupon return minus its loyalty share.
  const eligibleBase = Math.max(0, Number(loyalty.eligible_amount || 0));
  const returnedEligible = Math.max(0, returnedAfterCoupon - Number(calc.loyaltyReversal || 0));
  const earnedRatio = eligibleBase > 0 ? Math.min(1, returnedEligible / eligibleBase) : 0;

  const earned = Math.max(0, Math.floor(Number(loyalty.earn_points_pending || 0)));
  const alreadyReversed = Math.max(0, Math.floor(Number(loyalty.earned_points_reversed || 0)));
  const reverseOutstanding = Math.max(0, earned - alreadyReversed);
  const pointsToReverse = Math.min(reverseOutstanding, Math.round(earned * earnedRatio));

  return { pointsToRestore, pointsToReverse };
};

/**
 * Move the points a completed refund settles, then record what moved on the
 * order so a later partial return prices against the remainder.
 *
 * Keyed on the refund id, so re-processing the same refund — an admin clicking
 * twice, a retried job — moves nothing the second time.
 */
const applyRefundToLoyalty = async (refund) => {
  const pointsToRestore = Math.max(0, Number(refund.loyalty_points_restored || 0));
  const pointsToReverse = Math.max(0, Number(refund.loyalty_points_reversed || 0));
  if (pointsToRestore === 0 && pointsToReverse === 0) return;

  const loyaltyService = require("./loyaltyService");
  const { LoyaltyTransaction } = require("../models/loyaltyTransactions");
  const order = await Order.findById(refund.order_id).select("user_id loyalty");
  if (!order) return;

  // Points belong to the payer, which on a gift order is the order owner.
  const ownerId = order.loyalty?.payer_user_id || order.user_id;
  const applied = { restored: 0, reversed: 0 };

  if (pointsToRestore > 0) {
    const tx = await loyaltyService.restorePoints({
      userId: ownerId,
      points: pointsToRestore,
      orderId: refund.order_id,
      refundId: refund._id,
      reason: `Refund ${refund.refund_number}: points that paid for the returned items`,
    });
    if (tx) applied.restored = pointsToRestore;
  }

  if (pointsToReverse > 0) {
    // Never reverse an earn the order did not actually make. The plan above is
    // priced off `loyalty.earn_points_pending`, which is written at placement as
    // an estimate — so on an order that was refunded before it ever earned, or one
    // whose credit was trimmed because a parcel was cancelled, that figure is
    // larger than what the customer was given. Reversing it whole would take the
    // difference out of points earned on other orders.
    const earnRow = await LoyaltyTransaction.findOne({
      idempotency_key: `order:${refund.order_id}:earn-pending`,
    }).lean();
    const credited = Math.max(0, Math.floor(Number(earnRow?.points || 0)));
    const alreadyReversed = Math.max(0, Math.floor(Number(order.loyalty?.earned_points_reversed || 0)));
    const reversible = Math.min(pointsToReverse, Math.max(0, credited - alreadyReversed));

    const tx = reversible <= 0 ? null : await loyaltyService.reverseEarnedPoints({
      userId: ownerId,
      points: reversible,
      orderId: refund.order_id,
      refundId: refund._id,
      reason: `Refund ${refund.refund_number}: points earned on the returned items`,
    });
    // A reversal can come up short when the customer already spent the points.
    // Record what actually moved, never what we wished had.
    if (tx) applied.reversed = tx.points;
  }

  if (applied.restored === 0 && applied.reversed === 0) return;

  await Order.updateOne(
    { _id: refund.order_id },
    {
      $inc: {
        "loyalty.restored_points": applied.restored,
        "loyalty.earned_points_reversed": applied.reversed,
      },
      $push: {
        history: {
          action: "loyalty_refund_settled",
          title: "Loyalty points settled for refund",
          details: `Refund ${refund.refund_number}: ${applied.restored} point(s) returned, ${applied.reversed} point(s) reversed.`,
          actor_role: "system",
          actor_label: "System",
          metadata: {
            refund_id: refund._id,
            points_restored: applied.restored,
            points_reversed: applied.reversed,
          },
          created_at: new Date(),
        },
      },
    }
  );
};

/* ------------------------------------------------------------------ */
/*  Create Refund                                                     */
/* ------------------------------------------------------------------ */

/**
 * Where a refund goes by default: back the way the customer paid.
 *
 * A wallet-funded order is the one case with no choice at all — there is no
 * card charge to reverse and no bank transfer that would be honest — so it
 * always returns to the wallet, whatever the feature flag says afterwards.
 *
 * Cash on delivery has no instrument either. It defaults to store credit while
 * the wallet is live (instant, traceable, no admin trip) and falls back to a
 * hand-keyed bank transfer only when there is no wallet to credit.
 */
const defaultRefundMethod = (originalMethod, walletLive) => {
  // A company-account order goes back the way it was paid: off the company's bill.
  if (originalMethod === "company_account") return "company_account";
  if (originalMethod === "wallet") return "store_credit";
  if (originalMethod === "credit_card") return "original_payment";
  if (originalMethod === "bank_transfer") return "bank_transfer";
  return walletLive ? "store_credit" : "bank_transfer";
};

/**
 * Validate the admin's chosen destination against what the order can actually
 * support, falling back to the default when nothing was chosen.
 */
const resolveRefundMethod = ({ requested, originalMethod, walletLive }) => {
  // The company paid for (most of) this order, so the refund is the company's. There is
  // no honest alternative destination — handing it to the employee's wallet would give
  // them money their employer spent.
  if (originalMethod === "company_account") {
    if (requested && requested !== "company_account") {
      throw Object.assign(
        new Error("This order was paid on a company account, so the refund goes back to that account"),
        { code: "INVALID_REFUND_METHOD" }
      );
    }
    return "company_account";
  }
  if (requested === "company_account") {
    throw Object.assign(new Error("This order was not paid on a company account"), { code: "INVALID_REFUND_METHOD" });
  }
  if (!requested) return defaultRefundMethod(originalMethod, walletLive);

  if (!["original_payment", "bank_transfer", "store_credit", "company_account"].includes(requested)) {
    throw Object.assign(new Error("Unknown refund destination"), { code: "INVALID_REFUND_METHOD" });
  }

  // "Back to the original payment" only means something when there was a card
  // charge to reverse. For a wallet-funded order the original payment IS the
  // wallet, so the request is honoured by reading it that way rather than by
  // refusing a choice the admin plainly meant.
  if (requested === "original_payment") {
    if (originalMethod === "wallet") return "store_credit";
    if (originalMethod !== "credit_card") {
      throw Object.assign(
        new Error("This order was not paid by card, so there is no card payment to reverse"),
        { code: "INVALID_REFUND_METHOD" }
      );
    }
  }

  return requested;
};

const createRefund = async (returnRequestId, { restocking_fee = 0, notes = "", refund_method = null, adminUsername = "Admin" }) => {
  const ret = await ReturnRequest.findById(returnRequestId);
  if (!ret) throw Object.assign(new Error("Return request not found"), { code: "NOT_FOUND" });
  if (ret.refund_id) {
    throw Object.assign(new Error("A refund already exists for this return"), { code: "REFUND_ALREADY_EXISTS" });
  }
  if (!["return_received", "approved"].includes(ret.status)) {
    throw Object.assign(
      new Error("Return must be received or approved before creating a refund"),
      { code: "INVALID_RETURN_STATUS" }
    );
  }
  if (ret.fault_type === "undetermined") {
    const inferredFaultType = inferFaultTypeFromReason(ret.reason);
    if (inferredFaultType !== "undetermined") {
      ret.fault_type = inferredFaultType;
      appendHistory(ret, "fault_type_inferred", "Fault type inferred", `Fault type inferred from customer reason: ${ret.reason}`, {
        reason: ret.reason,
        fault_type: inferredFaultType,
      }, { role: "system", label: "System" });
    }
  }

  if (ret.fault_type === "undetermined") {
    throw Object.assign(
      new Error("Fault type must be determined before creating a refund"),
      { code: "INVALID_RETURN_STATUS" }
    );
  }

  const order = await Order.findById(ret.order_id);
  if (!order) throw Object.assign(new Error("Order not found"), { code: "NOT_FOUND" });

  const calc = calculateRefund(ret, order);
  const restockingFee = Math.max(0, Number(restocking_fee) || 0);
  // `loyaltyReversal` is subtracted here and NOWHERE refunded as money: the
  // customer settled that part with points, so it comes back as points.
  const totalRefundAmount = Math.max(
    0,
    Number(
      (calc.subtotal - calc.discountReversal - calc.loyaltyReversal + calc.shippingRefund - restockingFee)
        .toFixed(2)
    )
  );
  const loyaltyPlan = planLoyaltySettlement(order, calc);

  // ---- Where the money goes ----
  //
  // The admin decides, per refund. `defaultRefundMethod` only chooses what the
  // screen offers first, and it offers the way the customer paid: someone who
  // paid by card expects their card back, and someone who paid from the wallet
  // has no card to be given back. The admin can override either way.
  const originalMethod = order.transaction?.payment_method || "cash";
  const walletService = require("./walletService");
  const walletLive = await walletService.isWalletEnabled().catch(() => false);

  const refundMethod = resolveRefundMethod({
    requested: refund_method,
    originalMethod,
    walletLive,
  });

  const refund = await Refund.create({
    refund_number: generateRefundNumber(),
    return_request_id: ret._id,
    order_id: order._id,
    // Carried through so the reversal lands on the right parcel's earnings row — a vendor
    // with two branches has two, and reversing the wrong one takes money from a delivery
    // that was never returned.
    sub_order_id: ret.sub_order_id || null,
    user_id: ret.user_id,
    vendor_id: ret.vendor_id,
    line_items: calc.lineItems,
    subtotal: calc.subtotal,
    discount_reversal: calc.discountReversal,
    discount_vendor_share: calc.discountVendorShare,
    loyalty_reversal: calc.loyaltyReversal,
    loyalty_points_restored: loyaltyPlan.pointsToRestore,
    loyalty_points_reversed: loyaltyPlan.pointsToReverse,
    shipping_refund: calc.shippingRefund,
    restocking_fee: restockingFee,
    total_refund_amount: totalRefundAmount,
    total_commission_reversal: calc.totalCommissionReversal,
    original_payment_method: originalMethod,
    refund_method: refundMethod,
    payment_details: {
      fawaterak_invoice_id: order.transaction?.invoice_id || null,
      notes,
    },
    fault_type: ret.fault_type,
    status: "pending",
    history: [
      {
        action: "refund_created",
        title: "Refund created",
        details: `Refund of ${totalRefundAmount} EGP created. Method: ${refundMethod}`,
        actor_role: "admin",
        actor_label: adminUsername,
        metadata: { total_refund_amount: totalRefundAmount, refund_method: refundMethod },
        created_at: new Date(),
      },
    ],
  });

  // Link refund to return request and advance status
  ret.refund_id = refund._id;
  ret.status = "refund_processing";
  ret.updated_at = new Date();
  ret.history.push({
    action: "refund_created",
    title: "Refund initiated",
    details: `Refund ${refund.refund_number} created for ${totalRefundAmount} EGP`,
    actor_role: "admin",
    actor_label: adminUsername,
    metadata: { refund_id: refund._id, refund_number: refund.refund_number },
    created_at: new Date(),
  });
  await ret.save();

  // Notify user
  try {
    // Using vendor notification model — for user notifications in the future,
    // this could be extended. For now, log for admin awareness.
    console.log(`[RefundService] Refund ${refund.refund_number} created for return ${ret.return_number}: ${totalRefundAmount} EGP`);
  } catch (_) {}

  return refund;
};

/* ------------------------------------------------------------------ */
/*  Process Refund (admin marks as processing)                        */
/* ------------------------------------------------------------------ */

const processRefund = async (refundId, adminUsername = "Admin") => {
  const refund = await Refund.findById(refundId);
  if (!refund) throw Object.assign(new Error("Refund not found"), { code: "NOT_FOUND" });
  if (refund.status !== "pending" && refund.status !== "failed") {
    throw Object.assign(new Error("Refund must be pending or failed to process"), { code: "INVALID_STATUS" });
  }

  refund.status = "processing";
  refund.processed_at = new Date();
  refund.updated_at = new Date();

  const isStoreCredit = refund.refund_method === "store_credit";
  const isCompanyAccount = refund.refund_method === "company_account";
  appendHistory(refund, "refund_processing", "Refund processing started",
    isStoreCredit
      ? "Crediting the customer's wallet."
      : isCompanyAccount
        ? "Crediting the company account (and the customer's wallet for any part they paid)."
        : `Admin initiated refund processing. Process externally via ${refund.refund_method === "original_payment" ? "Fawaterak dashboard" : "bank transfer"}.`,
    {}, { role: "admin", label: adminUsername });

  await refund.save();

  // A wallet refund has nothing to do externally, so pausing at "processing"
  // for a second admin click would only delay the customer's money. Complete it
  // in the same step; `completeRefund` is what actually moves the credit. A
  // company-account refund is the same kind of internal booking.
  if (isStoreCredit || isCompanyAccount) {
    return completeRefund(refund._id, { adminUsername });
  }

  return refund;
};

/* ------------------------------------------------------------------ */
/*  Complete Refund                                                   */
/* ------------------------------------------------------------------ */

const completeRefund = async (refundId, { payment_details = {}, adminUsername = "Admin" }) => {
  const refund = await Refund.findById(refundId);
  if (!refund) throw Object.assign(new Error("Refund not found"), { code: "NOT_FOUND" });
  if (refund.status !== "processing") {
    throw Object.assign(new Error("Refund must be processing to complete"), { code: "INVALID_STATUS" });
  }

  // ---- Move the money, before anything is marked done ----
  //
  // Ordered first on purpose. Everything below this point — the return request,
  // the order items, the vendor's earnings reversal — describes a refund that
  // has already happened. If the credit fails, none of that may be written, or
  // the store would show a completed refund the customer never received.
  //
  // Idempotent on the refund id, so a retried completion credits once.
  if (refund.refund_method === "store_credit" && Number(refund.total_refund_amount) > 0) {
    const walletService = require("./walletService");
    try {
      await walletService.creditRefund({
        userId: refund.user_id,
        amountMinor: walletService.toMinor(refund.total_refund_amount),
        refundId: refund._id,
        orderId: refund.order_id,
        reason: `Refund ${refund.refund_number}`,
        actor: { role: "admin", label: adminUsername },
      });
    } catch (err) {
      refund.status = "failed";
      refund.updated_at = new Date();
      appendHistory(refund, "refund_failed", "Refund failed",
        `Could not credit the customer's wallet: ${err.message}`,
        {}, { role: "admin", label: adminUsername });
      await refund.save();
      throw Object.assign(
        new Error(`Refund could not be credited to the customer's wallet: ${err.message}`),
        { code: "WALLET_CREDIT_FAILED" }
      );
    }
  }

  // A company-account refund: the company's share off its bill (and back to the
  // employee's limit), the employee's own share to their wallet. Idempotent on the
  // refund id, like the wallet credit above.
  if (refund.refund_method === "company_account" && Number(refund.total_refund_amount) > 0) {
    try {
      const order = await Order.findById(refund.order_id);
      await require("./companyOrderService").refundShare({
        order,
        amount: refund.total_refund_amount,
        key: `refund:${refund._id}`,
        refundId: refund._id,
        subOrderId: refund.sub_order_id || null,
        reason: `Refund ${refund.refund_number}`,
        actor: { role: "admin", label: adminUsername },
      });
    } catch (err) {
      refund.status = "failed";
      refund.updated_at = new Date();
      appendHistory(refund, "refund_failed", "Refund failed",
        `Could not credit the company account: ${err.message}`,
        {}, { role: "admin", label: adminUsername });
      await refund.save();
      throw Object.assign(
        new Error(`Refund could not be credited to the company account: ${err.message}`),
        { code: "COMPANY_CREDIT_FAILED" }
      );
    }
  }

  // Update payment details
  if (payment_details.bank_name) refund.payment_details.bank_name = payment_details.bank_name;
  if (payment_details.account_holder) refund.payment_details.account_holder = payment_details.account_holder;
  if (payment_details.account_number) refund.payment_details.account_number = payment_details.account_number;
  if (payment_details.iban) refund.payment_details.iban = payment_details.iban;
  if (payment_details.notes) refund.payment_details.notes = payment_details.notes;
  refund.payment_details.processed_by = adminUsername;

  refund.status = "completed";
  refund.completed_at = new Date();
  refund.updated_at = new Date();
  appendHistory(refund, "refund_completed", "Refund completed",
    `Refund of ${refund.total_refund_amount} EGP issued via ${refund.refund_method}`,
    { total_refund_amount: refund.total_refund_amount },
    { role: "admin", label: adminUsername });

  await refund.save();

  // Advance return request to completed
  const ret = await ReturnRequest.findById(refund.return_request_id);
  if (ret) {
    ret.status = "completed";
    ret.updated_at = new Date();
    ret.history.push({
      action: "return_completed",
      title: "Return completed",
      details: `Refund ${refund.refund_number} issued. ${refund.total_refund_amount} EGP`,
      actor_role: "admin",
      actor_label: adminUsername,
      metadata: { refund_number: refund.refund_number, amount: refund.total_refund_amount },
      created_at: new Date(),
    });
    await ret.save();
  }

  // Update order items return_status to refunded
  const order = await Order.findById(refund.order_id);
  if (order) {
    const returnRequest = ret || await ReturnRequest.findById(refund.return_request_id).lean();
    if (returnRequest) {
      for (const ri of returnRequest.items) {
        const orderItem = order.items.id(ri.order_item_id);
        if (orderItem) orderItem.return_status = "refunded";
      }
    }

    // Reverse commission in vendor_supervisions
    const vendorIdStr = refund.vendor_id.toString();
    const supervision = order.vendor_supervisions.find(
      (vs) => vs.vendor_id?.toString() === vendorIdStr
    );
    if (supervision && refund.total_commission_reversal > 0) {
      supervision.total_commission = Math.max(
        0,
        Number((supervision.total_commission - refund.total_commission_reversal).toFixed(2))
      );
      supervision.total_amount = Math.max(
        0,
        Number((supervision.total_amount - (refund.subtotal - refund.discount_reversal)).toFixed(2))
      );
    }

    // Check if ALL items in order are refunded -> mark transaction as refunded
    const allRefunded = order.items.every((item) => item.return_status === "refunded");
    if (allRefunded && order.transaction) {
      order.transaction.status = "refunded";
    }

    // Money back as well as goods: the order's status says so.
    require("./subOrderService").syncOrderStatus(order, adminUsername || "Refunds");

    order.history.push({
      action: "refund_completed",
      title: "Refund issued",
      details: `Refund ${refund.refund_number}: ${refund.total_refund_amount} EGP`,
      actor_role: "admin",
      actor_label: adminUsername,
      metadata: { refund_id: refund._id, refund_number: refund.refund_number, amount: refund.total_refund_amount },
      created_at: new Date(),
    });

    await order.save();

    // A parcel refunded in full stops being a completed order for its vendor. Fail-safe:
    // a reputation figure must never hold up a refund.
    try {
      await require("./vendorStatsService").refreshCompletedOrdersForOrder(order);
    } catch (err) {
      console.error(`[VendorStats] Recount after refund ${refund.refund_number} failed: ${err.message}`);
    }
  }

  // Reverse the vendor's earning ledger by the refunded net amount.
  try {
    const { applyRefundReversalToEarning } = require("./vendorEarningsService");
    await applyRefundReversalToEarning(refund);
  } catch (err) {
    console.error(`[Refund] Failed to apply earning reversal for ${refund.refund_number}: ${err.message}`);
  }

  // Settle loyalty: take back the points these items earned, and give back the
  // points that paid for them. Never fatal — a refund must complete even if the
  // loyalty ledger is momentarily unavailable; the amounts are idempotent and
  // an admin adjustment can close any gap.
  try {
    await applyRefundToLoyalty(refund);
  } catch (err) {
    console.error(`[Refund] Failed to apply loyalty reversal for ${refund.refund_number}: ${err.message}`);
  }

  // Restock inventory
  try {
    if (ret) {
      for (const ri of ret.items) {
        const product = await Product.findById(ri.product_id);
        if (product) {
          if (product.sold_count > 0) {
            product.sold_count = Math.max(0, product.sold_count - ri.quantity_returning);
          }
          if (ri.variant_id) {
            const variant = product.variants?.id(ri.variant_id);
            if (variant && typeof variant.stock === "number") {
              variant.stock += ri.quantity_returning;
            }
          } else if (typeof product.quantity === "number") {
            product.quantity += ri.quantity_returning;
          }
          await product.save();
        }
      }
    }
  } catch (err) {
    console.error("[RefundService] Restock error:", err.message);
  }

  // Notify vendor about commission reversal
  try {
    await createNotification(
      refund.vendor_id,
      "refund_completed",
      "Refund Completed — Earnings Adjusted",
      `Refund ${refund.refund_number} completed. Commission reversal: ${refund.total_commission_reversal} EGP.`,
      { refund_id: refund._id, refund_number: refund.refund_number, commission_reversal: refund.total_commission_reversal }
    );
  } catch (_) {}

  // Email customer about refund completion
  try {
    const customer = await User.findById(refund.user_id).select("name email").lean();
    if (customer?.email) {
      await sendRefundCompletedEmail({
        to: customer.email,
        name: customer.name,
        refundNumber: refund.refund_number,
        amount: refund.total_refund_amount,
        method: refund.refund_method,
      });
    }
  } catch (_) {}

  // Tell the customer in-app as well. Wallet credit is spendable the instant it
  // lands, so this is not just a receipt — it is the prompt that the money is
  // already there and usable, which is the whole advantage over a bank transfer
  // they would otherwise wait days for.
  if (refund.refund_method === "store_credit" && Number(refund.total_refund_amount) > 0) {
    try {
      const { notifyCustomer } = require("./customerNotificationService");
      const amount = Number(refund.total_refund_amount).toFixed(2);
      notifyCustomer(refund.user_id, "wallet_refund_credited", {
        title_en: "Refund added to your wallet",
        title_ar: "تمت إضافة مبلغ الاسترداد إلى محفظتك",
        message_en: `Refund ${refund.refund_number} of ${amount} has been added to your wallet and is ready to use on your next order.`,
        message_ar: `تمت إضافة مبلغ الاسترداد ${refund.refund_number} وقدره ${amount} إلى محفظتك وهو جاهز للاستخدام في طلبك القادم.`,
      }, {
        link: "/profile?tab=wallet",
        data: { amount: Number(amount), refund_number: refund.refund_number },
      });
    } catch (_) {}
  }

  return refund;
};

/* ------------------------------------------------------------------ */
/*  Fail Refund                                                       */
/* ------------------------------------------------------------------ */

const failRefund = async (refundId, { failure_reason = "", adminUsername = "Admin" }) => {
  const refund = await Refund.findById(refundId);
  if (!refund) throw Object.assign(new Error("Refund not found"), { code: "NOT_FOUND" });
  if (refund.status !== "processing") {
    throw Object.assign(new Error("Refund must be processing to mark as failed"), { code: "INVALID_STATUS" });
  }

  refund.status = "failed";
  refund.updated_at = new Date();
  appendHistory(refund, "refund_failed", "Refund failed",
    failure_reason || "Refund processing failed",
    { failure_reason },
    { role: "admin", label: adminUsername });

  await refund.save();
  return refund;
};

/* ------------------------------------------------------------------ */
/*  Read                                                              */
/* ------------------------------------------------------------------ */

const getRefundById = async (id) => {
  return await Refund.findById(id)
    .populate("user_id", "name email phone")
    .populate("vendor_id", "store_name name email")
    .populate("return_request_id", "return_number status reason")
    .lean();
};

const getRefundsForOrder = async (orderId) => {
  return await Refund.find({ order_id: orderId })
    .sort({ created_at: -1 })
    .populate("vendor_id", "store_name")
    .lean();
};

const getAllRefunds = async ({ page = 1, limit = 20, status, vendorId, from, to } = {}) => {
  const filter = {};
  if (status) filter.status = status;
  if (vendorId) filter.vendor_id = vendorId;
  if (from || to) {
    filter.created_at = {};
    if (from) filter.created_at.$gte = new Date(from);
    if (to) filter.created_at.$lte = new Date(to);
  }

  const total = await Refund.countDocuments(filter);
  const refunds = await Refund.find(filter)
    .sort({ created_at: -1 })
    .skip((Math.max(1, Number(page)) - 1) * Number(limit))
    .limit(Number(limit))
    .populate("user_id", "name email")
    .populate("vendor_id", "store_name name")
    .populate("return_request_id", "return_number status reason")
    .lean();

  return {
    refunds,
    pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)), limit: Number(limit) },
  };
};

/* ------------------------------------------------------------------ */
/*  Analytics                                                         */
/* ------------------------------------------------------------------ */

const getRefundAnalytics = async ({ from, to, vendorId } = {}) => {
  const matchFilter = {};
  if (vendorId) matchFilter.vendor_id = require("mongoose").Types.ObjectId(vendorId);
  if (from || to) {
    matchFilter.created_at = {};
    if (from) matchFilter.created_at.$gte = new Date(from);
    if (to) matchFilter.created_at.$lte = new Date(to);
  }

  const [stats] = await Refund.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: null,
        total_refunds: { $sum: 1 },
        total_amount: { $sum: "$total_refund_amount" },
        total_commission_reversed: { $sum: "$total_commission_reversal" },
        completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
        processing: { $sum: { $cond: [{ $eq: ["$status", "processing"] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
      },
    },
  ]);

  const reasonStats = await ReturnRequest.aggregate([
    { $match: { ...matchFilter, status: { $ne: "cancelled" } } },
    { $group: { _id: "$reason", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  return {
    summary: stats || {
      total_refunds: 0, total_amount: 0, total_commission_reversed: 0,
      completed: 0, pending: 0, processing: 0, failed: 0,
    },
    top_return_reasons: reasonStats,
  };
};

module.exports = {
  calculateRefund,
  defaultRefundMethod,
  resolveRefundMethod,
  planLoyaltySettlement,
  applyRefundToLoyalty,
  createRefund,
  processRefund,
  completeRefund,
  failRefund,
  getRefundById,
  getRefundsForOrder,
  getAllRefunds,
  getRefundAnalytics,
};
