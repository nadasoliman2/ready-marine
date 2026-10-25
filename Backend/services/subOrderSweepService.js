/**
 * Background sweeps for sub-orders — the deadline reminders and the overdue flag.
 *
 * Both are deliberately toothless: they nudge and they flag, but they never cancel. A late
 * parcel is still a parcel the customer is waiting for, and writing it off is a judgement
 * call an admin makes after speaking to somebody — not something a cron job should decide
 * at 3am.
 *
 * Run from the same cron as the Bosta polling sweep (see app.js).
 */

const { Order } = require("../models/orders");
const { Seller } = require("../models/sellers");
const { createNotification } = require("../models/notifications");
const shippingEngine = require("./shippingEngine");
const subOrderService = require("./subOrderService");

/** Statuses that mean the vendor still owes this parcel an action. */
const AWAITING_VENDOR = ["pending_review", "awaiting_tracking", "awaiting_handover"];

/** What the vendor is actually being asked to do, so the nudge says something useful. */
const NEXT_STEP = {
  pending_review: "confirm which products are available",
  awaiting_tracking: "assign the tracking number",
  awaiting_handover: "seal the parcel and confirm it is ready for pickup",
};

/**
 * Nudge vendors whose deadline is approaching, and flag the ones who have passed it.
 *
 * @returns {{ reminded: number, flagged: number }}
 */
const runSubOrderDeadlineSweep = async () => {
  const settings = await shippingEngine.getSettings().catch(() => null);
  const reminderHours = Number(settings?.vendor_deadline_reminder_hours ?? 12);

  const now = new Date();
  const reminderCutoff = new Date(now.getTime() + reminderHours * 3600 * 1000);

  const orders = await Order.find({
    "sub_orders": {
      $elemMatch: {
        status: { $in: AWAITING_VENDOR },
        deadline_at: { $ne: null, $lte: reminderCutoff },
      },
    },
  }).select("_id transaction.reference sub_orders");

  let reminded = 0;
  let flagged = 0;

  for (const order of orders) {
    let dirty = false;
    const reference = order.transaction?.reference || order._id;

    for (const sub of order.sub_orders || []) {
      if (!AWAITING_VENDOR.includes(sub.status)) continue;
      if (!sub.deadline_at) continue;
      // A company-batch rider that is confirmed waits for its combined parcel; the lead
      // carries the deadline for the box (feature 14).
      if (sub.company_batch?.role === "rider" && sub.status !== "pending_review") continue;

      const overdue = new Date(sub.deadline_at) <= now;

      // ---- Passed the deadline: flag it for the admin queue, once ----
      if (overdue && !sub.is_overdue) {
        sub.is_overdue = true;
        dirty = true;
        flagged += 1;
        subOrderService.appendSubHistory(
          sub, "sub_order_overdue", "Past its deadline",
          `Still waiting for the vendor to ${NEXT_STEP[sub.status] || "act"}.`,
          { deadline_at: sub.deadline_at }, { role: "system", label: "Deadline sweep" }
        );
        await notifyVendor(
          sub.vendor_id,
          "sub_order_overdue",
          "A parcel is past its deadline",
          `Order #${reference}: please ${NEXT_STEP[sub.status] || "act on this parcel"}.`,
          { order_id: order._id, sub_order_id: sub._id }
        );
        await notifyAdmins(
          "sub_order_overdue",
          "A parcel is past its deadline",
          `Order #${reference} — ${await vendorName(sub.vendor_id)} has not ${NEXT_STEP[sub.status] || "acted"} yet.`,
          { order_id: order._id, sub_order_id: sub._id }
        );
        continue;
      }

      // ---- Approaching: remind the vendor once ----
      if (!overdue && !sub.deadline_reminded_at) {
        sub.deadline_reminded_at = now;
        dirty = true;
        reminded += 1;
        const hoursLeft = Math.max(1, Math.round((new Date(sub.deadline_at) - now) / 3600000));
        await notifyVendor(
          sub.vendor_id,
          "sub_order_deadline_soon",
          "A parcel is due soon",
          `Order #${reference}: about ${hoursLeft} hour(s) left to ${NEXT_STEP[sub.status] || "act"}.`,
          { order_id: order._id, sub_order_id: sub._id, hours_left: hoursLeft }
        );
      }
    }

    if (dirty) {
      await order.save().catch((err) =>
        console.error(`[Sub-order sweep] Could not save order ${order._id}: ${err.message}`));
    }
  }

  return { reminded, flagged };
};

const vendorName = async (vendorId) => {
  const v = await Seller.findById(vendorId).select("store_name store_username").lean();
  return v?.store_name || v?.store_username || "A vendor";
};

const notifyVendor = async (vendorId, type, title, message, data) => {
  try {
    await createNotification(vendorId, type, title, message, data);
  } catch (err) {
    console.error(`[Sub-order sweep] Vendor notification failed: ${err.message}`);
  }
};

const notifyAdmins = async (type, title, message, data) => {
  try {
    const { User } = require("../models/users");
    const admins = await User.find({ role: "admin" }).select("_id").lean();
    await Promise.allSettled(
      admins.map((a) => createNotification(a._id, type, title, message, data))
    );
  } catch (err) {
    console.error(`[Sub-order sweep] Admin notification failed: ${err.message}`);
  }
};

/**
 * Tell the customer a parcel is on its final leg — and, on a cash order, exactly what its
 * courier will ask for.
 *
 * Sent per parcel, naming the store, because three couriers asking for three different
 * amounts is only alarming when nobody said it was coming.
 */
const notifyOutForDelivery = async (order, sub) => {
  try {
    const { notifyCustomer } = require("./customerNotificationService");
    const store = await vendorName(sub.vendor_id);
    const isCOD = order.transaction?.payment_method === "cash";
    const due = Number(sub.cod_amount || 0);

    await notifyCustomer(order.user_id, "sub_order_out_for_delivery", {
      title_en: `Your parcel from ${store} is out for delivery`,
      title_ar: `شحنة ${store} خرجت للتسليم`,
      message_en: isCOD
        ? `The courier will collect ${due.toFixed(2)} for this parcel.`
        : `It is already paid for — nothing to pay on delivery.`,
      message_ar: isCOD
        ? `المندوب هيحصّل ${due.toFixed(2)} على الشحنة دي.`
        : `الشحنة مدفوعة بالكامل — مفيش أي مبلغ عند الاستلام.`,
    }, {
      link: `/profile?tab=orders&order=${order._id}`,
      data: { order_id: order._id, sub_order_id: sub._id, amount_due: isCOD ? due : 0 },
    });
  } catch (err) {
    console.error(`[Sub-order] Out-for-delivery notice failed for ${sub?._id}: ${err.message}`);
  }
};

/**
 * Tell the customer a parcel has arrived, naming the store and how many are still coming —
 * so a partially delivered order never reads as "everything arrived, the rest is lost".
 */
const notifyParcelDelivered = async (order, sub) => {
  try {
    const { notifyCustomer } = require("./customerNotificationService");
    const store = await vendorName(sub.vendor_id);
    const live = (order.sub_orders || []).filter(subOrderService.isLive);
    const remaining = live.filter((s) => s.status !== "delivered").length;

    await notifyCustomer(order.user_id, "sub_order_delivered", {
      title_en: `Your parcel from ${store} has arrived`,
      title_ar: `وصلت شحنة ${store}`,
      message_en: remaining > 0
        ? `${remaining} more parcel(s) from this order are still on the way.`
        : `That was the last parcel — your order is complete.`,
      message_ar: remaining > 0
        ? `فاضل ${remaining} شحنة من نفس الطلب في الطريق.`
        : `دي كانت آخر شحنة — طلبك اكتمل.`,
    }, {
      link: `/profile?tab=orders&order=${order._id}`,
      data: { order_id: order._id, sub_order_id: sub._id, remaining },
    });
  } catch (err) {
    console.error(`[Sub-order] Delivery notice failed for ${sub?._id}: ${err.message}`);
  }
};

module.exports = {
  AWAITING_VENDOR,
  runSubOrderDeadlineSweep,
  notifyOutForDelivery,
  notifyParcelDelivered,
};
