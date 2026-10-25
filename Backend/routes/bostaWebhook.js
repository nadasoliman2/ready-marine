const express = require("express");
const router = express.Router();
const { Order } = require("../models/orders");
const { handleReturnBostaWebhook } = require("../services/returnLogisticsService");
const { extractBostaState, applyBostaStatusToOrder } = require("../services/bostaStatusMap");

const BOSTA_WEBHOOK_SECRET = process.env.BOSTA_WEBHOOK_SECRET || "";

/**
 * Verify the shared secret. Bosta does not sign webhooks, so we require a secret
 * passed either in the URL path (/api/webhooks/bosta/:secret) or as ?secret=.
 * If BOSTA_WEBHOOK_SECRET is unset, verification is skipped (logged) for local dev.
 */
function verifySecret(req) {
  if (!BOSTA_WEBHOOK_SECRET) {
    console.warn("[Bosta webhook] BOSTA_WEBHOOK_SECRET not set — skipping verification");
    return true;
  }
  const provided = req.params.secret || req.query.secret;
  return provided === BOSTA_WEBHOOK_SECRET;
}

/**
 * @desc    Bosta webhook — receives delivery status updates
 * @route   POST /api/webhooks/bosta            (secret via ?secret=)
 * @route   POST /api/webhooks/bosta/:secret    (secret in path)
 * @access  Public (verified by shared secret)
 */
async function handleWebhook(req, res) {
  try {
    if (!verifySecret(req)) {
      return res.status(401).json({ success: false, message: "Invalid webhook secret" });
    }

    // Bosta sends: trackingNumber (number|string), state (numeric code), timeStamp (epoch ms),
    // and on exceptions: exceptionReason / exceptionCode.
    const statusValue = extractBostaState(req.body);
    const timestamp = req.body.timeStamp || req.body.timestamp;
    const notes = req.body.exceptionReason || req.body.notes || "";
    const rawTracking = req.body.trackingNumber ?? req.body.TrackingNumber;
    const trackingNum = rawTracking != null ? String(rawTracking) : null;

    if (!trackingNum) {
      return res.status(400).json({ success: false, message: "Missing trackingNumber" });
    }

    const order = await Order.findOne({
      "shipments.bosta_tracking_number": trackingNum,
    });

    if (!order) {
      // Might be a return shipment instead of a forward delivery.
      try {
        const returnResult = await handleReturnBostaWebhook(trackingNum, req.body);
        if (returnResult) {
          return res.json({ success: true, type: "return_shipment" });
        }
      } catch (err) {
        console.error("Return webhook error:", err.message);
      }
      return res.status(404).json({ success: false, message: "Order not found for tracking number" });
    }

    const shipment = order.shipments.find(
      (s) => s.bosta_tracking_number === trackingNum
    );

    if (!shipment) {
      return res.status(404).json({ success: false, message: "Shipment not found" });
    }

    const result = applyBostaStatusToOrder(order, shipment, statusValue, {
      timestamp,
      notes,
      actorLabel: "Bosta Webhook",
    });

    await order.save();

    // Delivery now happens per PARCEL, and it is what releases that vendor's money and
    // opens that parcel's return window. Fired on the parcel that actually landed, not on
    // the order — the order may still have two more in transit. Safe on every webhook
    // replay: the earnings row and the loyalty ledger are both keyed idempotently.
    const orderService = require("../services/orderService");
    if (result.sub_order_delivered) {
      const sub = (order.sub_orders || []).find(
        (s) => s._id.toString() === result.sub_order_id?.toString()
      );
      if (sub) await orderService.onSubOrderDelivered(order, sub);
    } else if (result.changed && result.to === "completed") {
      // Legacy order with no parcels.
      await orderService.onOrderCompleted(order);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Bosta webhook error:", err.message);
    res.status(500).json({ success: false, message: "Internal error" });
  }
}

router.post("/", handleWebhook);
router.post("/:secret", handleWebhook);

module.exports = router;
