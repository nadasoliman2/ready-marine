/**
 * One-off backfill: price every parcel that shipped before the courier-cost ledger existed.
 *
 * `services/courierCostService.js` stamps each new parcel with what Bosta bills for it, but
 * it only runs at dispatch. Without this, the subsidy report would start from an empty
 * ledger and show nothing about the months already shipped — the exact period anyone would
 * want to look at first.
 *
 * WHAT IT CAN AND CANNOT KNOW. Sector, size and COD are all recoverable from the order:
 * the destination city is frozen on `order.shipping.destination`, the size comes from the
 * items' shipping classes through the same function the live dispatch uses, and the COD is
 * stored on the shipment. What it CANNOT recover is the tariff as it stood on the day each
 * parcel actually shipped — it prices everything off today's `bostaTariff.js`. For parcels
 * shipped under the tariff read on 2026-08-23 that is exact; for anything older it is
 * today's price for an old parcel, which is why backfilled rows are worth reading as a
 * scale rather than as an invoice.
 *
 * A parcel whose destination city is not in the tariff is written with `priced: false` and
 * no cost, never with a guess — the report counts those separately.
 *
 * Re-running is safe: a parcel that already carries `courier_cost.recorded_at` is skipped,
 * so this never overwrites a figure frozen by a real dispatch.
 *
 *   node scripts/backfillCourierCosts.js            # dry run — prints, writes nothing
 *   node scripts/backfillCourierCosts.js --apply    # write
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { Order } = require('../models/orders');
const bostaTariff = require('../services/bostaTariff');
const courierCostService = require('../services/courierCostService');
const { classFlagsForItems } = require('../services/bostaFulfillmentService');

const APPLY = process.argv.includes('--apply');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** The order items this shipment carried, so the parcel is sized by its real contents. */
function itemsOfShipment(order, shipment) {
    const ids = (shipment.items || []).map(String);
    if (ids.length === 0) return [];
    return (order.items || []).filter((it) => ids.includes(String(it._id)));
}

const run = async () => {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log(APPLY ? 'APPLYING — writing courier costs.\n' : 'DRY RUN — nothing is written. Re-run with --apply.\n');

    const orders = await Order.find({
        'shipments.0': { $exists: true },
        'shipments.courier_cost.recorded_at': null,
    });

    let priced = 0;
    let unpriced = 0;
    let withRto = 0;
    let skipped = 0;
    let totalPaid = 0;
    let totalCharged = 0;

    for (const order of orders) {
        let touched = false;

        for (const shipment of order.shipments || []) {
            if (shipment.courier_cost && shipment.courier_cost.recorded_at) { skipped++; continue; }

            const sub = shipment.sub_order_id
                ? (order.sub_orders || []).find((s) => String(s._id) === String(shipment.sub_order_id))
                : null;

            const items = itemsOfShipment(order, shipment);

            // An Arrive parcel priced off the Bosta tariff would be wrong twice: the number
            // would be invented from a destination city Arrive does not price by, and the row
            // would be stamped `provider: "bosta"`, moving the parcel into the wrong courier's
            // column in every report. Price it by the area group it was actually sent to,
            // which the dispatch stored on the shipment.
            if (shipment.provider === 'arrive') {
                const group = shipment.provider_payload?.gov_name || null;
                const cost = await courierCostService.recordDispatchCost(shipment, {
                    provider: 'arrive',
                    arriveGroup: group,
                    // No weight is kept on the shipment, so only the base fee can be restored.
                    // The over-2 kg surcharge is not invented.
                    weightKg: 0,
                    codAmount: Number(shipment.cod_amount || 0),
                    chargedToCustomer: sub
                        ? Number(sub.shipping_share || 0)
                        : Number(order.shipping?.total_cost || 0),
                });
                if (cost.priced) { priced++; totalPaid += Number(cost.total || 0); }
                else unpriced++;
                totalCharged += Number(cost.charged || 0);
                if (sub ? sub.status === 'returned' : false) {
                    courierCostService.recordReturnCost(shipment);
                    if (Number(shipment.courier_cost.rto || 0) > 0) withRto++;
                }
                touched = true;
                continue;
            }

            const flags = await classFlagsForItems(items);

            const cost = await courierCostService.recordDispatchCost(shipment, {
                dropOffCity: order.shipping?.destination?.city || '',
                sizeKey: flags.sizeKey,
                codAmount: Number(shipment.cod_amount || 0),
                // Priced against the bundle that was live the DAY THIS PARCEL SHIPPED, not
                // today's. A parcel from before bundles existed was billed the rate card, one
                // from inside a closed cycle cost that cycle's credit price, and stamping
                // either with the other would invent a number.
                asOf: shipment.sent_at || order.delivered_at || order.created_at || null,
                // Pre-sub-order shipments have no `shipping_share`; the order's own total is
                // the only figure that describes what the customer paid for carriage, and on
                // a single-parcel order it is the same number.
                chargedToCustomer: sub
                    ? Number(sub.shipping_share || 0)
                    : Number(order.shipping?.total_cost || 0),
            });

            // A parcel that already came back was billed for the return leg too. The
            // sub-order's own status is the record of that; the shipment's Bosta state is
            // the fallback for orders that predate sub-orders.
            const wasReturned = sub
                ? sub.status === 'returned'
                : /return/i.test(String(shipment.bosta_status || ''));
            if (wasReturned) {
                courierCostService.recordReturnCost(shipment);
                if (Number(shipment.courier_cost.rto || 0) > 0) withRto++;
            }

            // `sent_at` is what the report filters on. A parcel that never recorded one
            // would be invisible no matter what it cost, so fall back to the order's date.
            if (!shipment.sent_at) shipment.sent_at = order.created_at || new Date();

            if (cost.priced) priced++; else unpriced++;
            totalPaid = round2(totalPaid + Number(shipment.courier_cost.total || 0));
            totalCharged = round2(totalCharged + Number(shipment.courier_cost.charged || 0));
            touched = true;
        }

        if (touched && APPLY) await order.save();
    }

    console.log(`orders scanned      : ${orders.length}`);
    console.log(`parcels priced      : ${priced}`);
    console.log(`parcels unpriced    : ${unpriced}   (destination city not in the tariff)`);
    console.log(`parcels with an RTO : ${withRto}`);
    console.log(`already stamped     : ${skipped}`);
    console.log('');
    console.log(`collected from customers : ${totalCharged.toFixed(2)} EGP`);
    console.log(`billed by Bosta          : ${totalPaid.toFixed(2)} EGP`);
    console.log(`subsidy                  : ${round2(totalPaid - totalCharged).toFixed(2)} EGP`);
    console.log(`\n(retail is a flat ${bostaTariff.FLAT_RETAIL_RATE} EGP per parcel; pickup-visit fees are added by the report, not here)`);

    await mongoose.disconnect();
};

run().catch((e) => { console.error(e); process.exit(1); });
