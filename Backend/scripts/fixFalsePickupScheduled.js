#!/usr/bin/env node
/**
 * Backfill: undo the orders that were marked `pickup_scheduled` by the old status map.
 *
 * Bosta's state 10 ("Pickup requested") is the state every delivery is created in — it
 * means "waiting to be collected", not "a courier is booked". The old map translated it to
 * `pickup_scheduled`, so ~20 minutes after dispatch the tracking sweep silently advanced
 * every order to "Pickup Scheduled" while Bosta held no pickup request and our pickups
 * module stayed empty.
 *
 * This puts those orders back to `ready` so they reappear in "Orders Needing Pickup".
 * Only orders that are demonstrably in that state are touched:
 *   - order status is `pickup_scheduled`
 *   - no BostaPickup row references the order
 *   - every shipment is still sitting at a pre-collection Bosta state
 *
 *   node scripts/fixFalsePickupScheduled.js            # report only
 *   node scripts/fixFalsePickupScheduled.js --apply    # write the corrections
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { Order } = require('../models/orders');
const { BostaPickup } = require('../models/bostaPickups');

const APPLY = process.argv.includes('--apply');

// Bosta states that mean "nobody has come for it yet". An order whose shipments are all
// here cannot legitimately be `pickup_scheduled` unless a pickup row says otherwise.
const PRE_COLLECTION = new Set([
  'pickup requested',
  'waiting for route',
  'pending',
  'waiting for pickup',
]);

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');
  console.log(`Database : ${uri.replace(/\/\/[^@]*@/, '//***@')}`);
  console.log(`Mode     : ${APPLY ? 'APPLY — will update orders' : 'DRY RUN — no changes'}\n`);

  await mongoose.connect(uri);

  const candidates = await Order.find({ status: 'pickup_scheduled' });
  console.log(`Orders currently pickup_scheduled : ${candidates.length}`);

  // One query for every pickup row, so a genuinely-scheduled order is never touched.
  const scheduledOrderIds = new Set();
  for (const p of await BostaPickup.find({ status: { $ne: 'cancelled' } }).select('order_ids').lean()) {
    for (const id of p.order_ids || []) scheduledOrderIds.add(id.toString());
  }
  console.log(`Orders referenced by a real pickup: ${scheduledOrderIds.size}\n`);

  const toFix = [];
  const kept = [];
  for (const order of candidates) {
    if (scheduledOrderIds.has(order._id.toString())) {
      kept.push(`${order._id} — has a real pickup row`);
      continue;
    }
    const shipments = order.shipments || [];
    if (shipments.length === 0) {
      kept.push(`${order._id} — no shipments; left alone`);
      continue;
    }
    const states = shipments.map((s) => (s.bosta_status || '').trim().toLowerCase());
    if (!states.every((s) => PRE_COLLECTION.has(s))) {
      kept.push(`${order._id} — past collection (${[...new Set(states)].join(', ')})`);
      continue;
    }
    toFix.push(order);
  }

  console.log(`Wrongly marked  : ${toFix.length}`);
  console.log(`Left untouched  : ${kept.length}`);
  if (kept.length) {
    console.log('\nUntouched:');
    for (const k of kept) console.log(`  · ${k}`);
  }
  if (toFix.length) {
    console.log('\nWould reset to "ready":');
    for (const o of toFix) {
      const states = [...new Set((o.shipments || []).map((s) => s.bosta_status))];
      console.log(`  → ${o._id}  (${states.join(', ')})`);
    }
  }

  if (!APPLY) {
    console.log('\nDry run — re-run with --apply to write these.');
    await mongoose.disconnect();
    return;
  }

  let fixed = 0;
  for (const order of toFix) {
    await Order.updateOne(
      { _id: order._id, status: 'pickup_scheduled' },
      {
        $set: { status: 'ready' },
        $push: {
          history: {
            action: 'order_status_corrected',
            title: 'Pickup status corrected',
            details:
              'Order was marked "Pickup Scheduled" by a mis-read of Bosta\'s "Pickup requested" ' +
              'state. No pickup had actually been booked, so it is back in the needs-pickup queue.',
            actor_role: 'system',
            actor_label: 'Data correction',
            metadata: { from: 'pickup_scheduled', to: 'ready' },
            created_at: new Date(),
          },
        },
      }
    );
    fixed++;
  }

  console.log(`\nReset ${fixed} order(s) to "ready".`);
  console.log(`Still pickup_scheduled: ${await Order.countDocuments({ status: 'pickup_scheduled' })}`);
  await mongoose.disconnect();
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
