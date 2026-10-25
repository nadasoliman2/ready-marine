/**
 * Back-fill `shipment.bosta_cost` on parcels dispatched before the field existed.
 *
 * Costs are normally snapshotted at dispatch. Everything shipped before the finance module
 * landed has no snapshot at all, which would leave the shipping half of the profit report
 * showing a 100% margin on the entire history — the most misleading possible answer.
 *
 * Rows written here are marked `source: 'derived'` and the screens label them as
 * estimates, because they are priced against TODAY'S tariff rather than the one in force
 * on the day the parcel actually shipped.
 *
 * Usage:
 *   node scripts/backfillBostaCosts.js            # dry run — report only, writes nothing
 *   node scripts/backfillBostaCosts.js --apply    # write the costs
 *   node scripts/backfillBostaCosts.js --apply --force   # also re-cost existing snapshots
 */

require('dotenv').config();
const mongoose = require('mongoose');

const { Order } = require('../models/orders');
const bostaCostService = require('../services/bostaCostService');

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');

const round2 = (n) => Number((Number(n) || 0).toFixed(2));

async function main() {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
        console.error('Set MONGO_URI (or MONGODB_URI) before running this script.');
        process.exit(1);
    }

    await mongoose.connect(uri);
    console.log(`Connected. Mode: ${APPLY ? (FORCE ? 'APPLY (re-costing everything)' : 'APPLY') : 'DRY RUN'}\n`);

    // Only orders that actually produced a parcel — nothing has been billed for an order
    // that never reached the courier.
    const orders = await Order.find({ 'shipments.0': { $exists: true } });

    let ordersTouched = 0;
    let parcelsCosted = 0;
    let parcelsSkipped = 0;
    let uncosted = 0; // no sector could be resolved — reported, never guessed at
    let totalCost = 0;

    for (const order of orders) {
        let changed = false;

        for (const shipment of order.shipments) {
            if (shipment.bosta_cost?.computed_at && !FORCE) {
                parcelsSkipped += 1;
                continue;
            }

            const sub = (order.sub_orders || []).find(
                (s) => shipment.sub_order_id && String(s._id) === String(shipment.sub_order_id)
            );
            // A shipment with no sub-order predates parcels entirely. Cost it against the
            // order as a whole — one shipment, one delivery, the same thing the courier billed.
            const target = sub || { _id: shipment.sub_order_id, cod_amount: shipment.cod_amount, status: order.status, pickup_id: null };

            const cost = await bostaCostService.costForParcel(order, target, { source: 'derived' });

            if (!cost.sector_id) {
                uncosted += 1;
                console.warn(
                    `  ! Order ${order._id} parcel ${shipment._id}: no Bosta sector for ` +
                    `"${order.shipping?.destination?.city || 'unknown city'}" — left uncosted.`
                );
            }

            if (APPLY) shipment.bosta_cost = cost;
            parcelsCosted += 1;
            totalCost += cost.total;
            changed = true;
        }

        if (changed) {
            ordersTouched += 1;
            if (APPLY) await order.save();
        }
    }

    console.log('\n--- Summary ---');
    console.log(`Orders with shipments : ${orders.length}`);
    console.log(`Orders touched        : ${ordersTouched}`);
    console.log(`Parcels costed        : ${parcelsCosted}`);
    console.log(`Parcels already costed: ${parcelsSkipped}${FORCE ? ' (re-costed anyway)' : ' (skipped)'}`);
    console.log(`Parcels with no sector: ${uncosted}`);
    console.log(`Total derived cost    : ${round2(totalCost)} EGP`);

    if (!APPLY) console.log('\nDry run — nothing written. Re-run with --apply to save.');
    if (uncosted > 0) {
        console.log(
            '\nUncosted parcels are shipped to a city the tariff does not map to a sector. ' +
            'Fix by setting `bosta_sector` on those City documents, then re-run with --apply --force.'
        );
    }

    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error('Backfill failed:', err);
    await mongoose.disconnect();
    process.exit(1);
});
