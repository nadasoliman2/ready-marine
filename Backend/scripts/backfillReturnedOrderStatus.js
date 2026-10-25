/**
 * One-off backfill: give every order that already carries a return the status that says so.
 *
 * Until now a return only ever touched the ITEMS — `return_status` per line — and never the
 * order's headline status, so an order whose contents came back weeks ago still reads
 * "completed" on the customer's screen. That is now derived (see
 * `subOrderService.deriveOrderStatus`), but derivation only runs when something moves. Orders
 * whose returns finished before this change would keep their stale status forever, which is
 * exactly the complaint that prompted the fix.
 *
 * Nothing here decides anything: it recomputes each order with the same function the live
 * code uses and writes the result. An order whose status is already right is left untouched,
 * so the script is safe to re-run.
 *
 *   node scripts/backfillReturnedOrderStatus.js            # dry run — prints, writes nothing
 *   node scripts/backfillReturnedOrderStatus.js --apply    # write
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { Order } = require('../models/orders');
const subOrderService = require('../services/subOrderService');

const APPLY = process.argv.includes('--apply');

const RETURN_ITEM_STATUSES = [
  'return_requested', 'return_approved', 'return_in_progress', 'returned', 'refunded',
];

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log(`Connected. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  // Only orders that have a return on at least one line can possibly be wrong.
  const orders = await Order.find({ 'items.return_status': { $in: RETURN_ITEM_STATUSES } });
  console.log(`${orders.length} order(s) carry a return.\n`);

  const changes = [];
  for (const order of orders) {
    const from = order.status;
    const result = subOrderService.syncOrderStatus(order, 'Return status backfill');
    if (!result.changed) continue;

    changes.push({ id: String(order._id), ref: order.transaction?.reference || '', from, to: order.status });
    if (APPLY) await order.save();
  }

  if (changes.length === 0) {
    console.log('Every order already carries the right status. Nothing to do.');
  } else {
    console.log(`${changes.length} order(s) ${APPLY ? 'updated' : 'would be updated'}:\n`);
    for (const c of changes) {
      console.log(`  ${c.ref || c.id}   ${c.from}  →  ${c.to}`);
    }
    const bucket = changes.reduce((acc, c) => ({ ...acc, [c.to]: (acc[c.to] || 0) + 1 }), {});
    console.log('\nBy new status:');
    for (const [status, n] of Object.entries(bucket)) console.log(`  ${status}: ${n}`);
  }

  if (!APPLY && changes.length > 0) console.log('\nDry run — re-run with --apply to write.');
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
