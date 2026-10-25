/**
 * Reset all order-related data for a fresh start.
 * Deletes: Orders, OrderPayments, BostaPickups, ReturnRequests, Refunds.
 *
 * Usage:
 *   node scripts/resetOrders.js
 *   docker compose exec backend node scripts/resetOrders.js
 */

require("dotenv").config({ path: __dirname + "/../.env" });
const mongoose = require("mongoose");

async function reset() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to DB");

    const { Order } = require("../models/orders");
    const { OrderPayment } = require("../models/orderPayments");
    const { BostaPickup } = require("../models/bostaPickups");
    const { ReturnRequest } = require("../models/returnRequests");
    const { Refund } = require("../models/refunds");

    const counts = {
      orders: await Order.countDocuments(),
      orderPayments: await OrderPayment.countDocuments(),
      bostaPickups: await BostaPickup.countDocuments(),
      returnRequests: await ReturnRequest.countDocuments(),
      refunds: await Refund.countDocuments(),
    };

    console.log("\nWill delete:");
    Object.entries(counts).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
    console.log("");

    await Order.deleteMany({});
    console.log("✅ Orders deleted");

    await OrderPayment.deleteMany({});
    console.log("✅ OrderPayments deleted");

    await BostaPickup.deleteMany({});
    console.log("✅ BostaPickups deleted");

    await ReturnRequest.deleteMany({});
    console.log("✅ ReturnRequests deleted");

    await Refund.deleteMany({});
    console.log("✅ Refunds deleted");

    console.log("\nDone. Fresh start ready.");
  } catch (err) {
    console.error("Failed:", err.message);
  } finally {
    await mongoose.disconnect();
  }
}

reset();
