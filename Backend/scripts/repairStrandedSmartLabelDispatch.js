/**
 * Reattach Bosta deliveries that were created for real but never recorded on the order.
 *
 * ── Why this script exists ────────────────────────────────────────────────────────────
 * `assignTracking` held one copy of the order document while `scanLabel` quietly loaded and
 * saved a SECOND copy of the same order. That save moved `__v` on, so the save at the end of
 * `assignTracking` — the one carrying the shipment row, the tracking number, the frozen
 * allocation and the new parcel status — died with a VersionError and threw all of it away.
 *
 * By then the delivery existed at Bosta. It was created, it was billed, and a courier was
 * coming for it, but the order had no shipment row and the parcel sat at `awaiting_tracking`
 * for ever: the vendor could not move on, and could not rescan either, because the reserved
 * label was still there.
 *
 * The double-load is fixed. This repairs the orders it already stranded.
 *
 * ── What it does ──────────────────────────────────────────────────────────────────────
 * For every smart label marked `dispatched` whose parcel never got its tracking number, it
 * asks Bosta whether the delivery is really there. If it is, the order is made to match
 * reality — the same shipment row `dispatchSubOrder` would have written, the same allocation
 * freeze, the same parcel status — and the parcel moves on to awaiting its photos.
 *
 * Bosta is never written to. The delivery is already correct: right label, right address,
 * right COD. The only thing that was ever missing is our record of it.
 *
 * A label Bosta does not recognise is reported and left alone — that one needs a human,
 * because "no delivery" and "the API is having a bad day" look the same from here.
 *
 * Run:
 *   node scripts/repairStrandedSmartLabelDispatch.js           # report only, write nothing
 *   node scripts/repairStrandedSmartLabelDispatch.js --apply   # reattach them
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { Order } = require('../models/orders');
const { SmartLabel } = require('../models/smartLabels');
const bostaService = require('../services/bostaService');
const subOrderService = require('../services/subOrderService');

const APPLY = process.argv.includes('--apply');

/** The Bosta delivery behind a tracking number, or null when it is not there. */
const fetchDelivery = async (trackingNumber) => {
    const base = process.env.BOSTA_BASE_URL || 'https://app.bosta.co';
    const res = await fetch(`${base}/api/v0/deliveries/${trackingNumber}`, {
        headers: { Authorization: process.env.BOSTA_API_KEY },
    });
    if (!res.ok) return null;
    const body = await res.json();
    const d = body?.data || body;
    return d?.trackingNumber ? d : null;
};

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`Database: ${String(process.env.MONGO_URI).replace(/\/\/[^@]*@/, '//***@')}`);
    console.log(APPLY ? '\nMODE: APPLY — stranded deliveries will be reattached.\n'
                      : '\nMODE: DRY RUN — nothing is written. Pass --apply to reattach.\n');

    const labels = await SmartLabel.find({ status: 'dispatched' }).lean();
    let repaired = 0, missing = 0, healthy = 0;

    for (const label of labels) {
        const order = await Order.findById(label.order_id);
        if (!order) { console.log(`  ORPHAN  ${label.tracking_number} — order is gone`); continue; }

        const sub = (order.sub_orders || []).find(
            (s) => s.vendor_id?.toString() === label.vendor_id?.toString()
        );
        if (!sub) { console.log(`  ORPHAN  ${label.tracking_number} — no parcel for that vendor`); continue; }

        // Already recorded: this one came through the flow intact.
        if (sub.bosta_tracking_number) { healthy += 1; continue; }

        const ref = order.transaction?.reference || order._id;
        const delivery = await fetchDelivery(label.tracking_number);
        if (!delivery) {
            missing += 1;
            console.log(`  NO DELIVERY  ${ref}  ${label.tracking_number} — Bosta does not know this number.`);
            console.log(`               Left alone. Unlink the label by hand if the parcel never went.`);
            continue;
        }

        repaired += 1;
        const state = delivery.state?.value || 'Pickup requested';
        console.log(`  REATTACH  ${ref}  ${label.tracking_number}  (Bosta: ${state}, COD ${delivery.cod})`);
        console.log(`            parcel ${sub._id}: ${sub.status} → awaiting_handover`);
        if (!APPLY) continue;

        const items = subOrderService.shippableItems(order, sub);
        order.shipments.push({
            vendor_id: sub.vendor_id,
            sub_order_id: sub._id,
            pickup_address: { address: label.fulfillment_location || '', city: '' },
            bosta_delivery_id: delivery._id,
            bosta_tracking_number: label.tracking_number,
            bosta_status: state,
            is_smart_label: true,
            items: items.map((i) => i._id),
            cod_amount: Number(delivery.cod || sub.cod_amount || 0),
            sent_at: label.dispatched_at || new Date(),
            tracking_history: [{
                state,
                timestamp: label.dispatched_at || new Date(),
                notes: 'Reattached: the delivery existed at Bosta but the order never recorded it',
            }],
        });
        const shipment = order.shipments[order.shipments.length - 1];
        sub.shipment_id = shipment._id;
        sub.bosta_tracking_number = label.tracking_number;

        const actor = { role: 'system', label: 'Repair script' };
        subOrderService.freezeAllocation(order, actor);

        subOrderService.appendSubHistory(
            sub, 'sub_order_dispatched', 'Parcel sent to Bosta',
            `Tracking number ${label.tracking_number}. Reattached by repair — the delivery was created at ` +
            `Bosta but the order failed to save it.`,
            { tracking_number: label.tracking_number, cod_amount: Number(delivery.cod || 0), is_smart_label: true },
            actor
        );

        sub.status = 'awaiting_handover';
        sub.tracking_assigned_at = sub.tracking_assigned_at || label.dispatched_at || new Date();
        subOrderService.appendSubHistory(
            sub, 'sub_order_tracking_assigned', 'Tracking number assigned',
            `Tracking ${label.tracking_number}. Photograph the sealed parcel to finish.`,
            { tracking_number: label.tracking_number, smart_label: true }, actor
        );

        subOrderService.syncOrderStatus(order, 'Repair script');
        await order.save();
        console.log(`            done.`);
    }

    console.log(`\nAlready recorded, untouched: ${healthy}`);
    console.log(`Stranded and reattachable:   ${repaired}`);
    console.log(`Label with no delivery:      ${missing}`);
    if (!APPLY && repaired) console.log('\nRe-run with --apply to reattach these.');

    await mongoose.disconnect();
})().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect();
    process.exit(1);
});
