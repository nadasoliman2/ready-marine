/**
 * One-off migration: split every existing order into sub-orders (parcels).
 *
 * Every live order is converted, not just the undispatched ones. Two order shapes in one
 * admin list is a support burden that outlasts the release and makes every bug report
 * ambiguous — "does this order have parcels?" would become the first question on every
 * ticket for months.
 *
 * ── What it does per order ─────────────────────────────────────────────────────────────
 *  1. Groups the items into (vendor, pickup branch) parcels. The branch is taken from the
 *     shipment that actually carried the items where one exists — that is the historical
 *     truth — and from the vendor supervision otherwise.
 *  2. Stamps every item with the parcel that fulfils it, and links each shipment to it.
 *  3. Derives each parcel's status from what really happened to its shipment, so a parcel
 *     delivered last week reads as delivered rather than starting again at stage 1.
 *  4. Allocates the money — shipping, coupon and loyalty shares, and the COD each parcel
 *     was carrying — and FREEZES it on any order already dispatched, because those Bosta
 *     deliveries hold COD amounts that can never be restated.
 *  5. Recomputes the order's headline status from its parcels.
 *  6. Back-fills `sub_order_id` on existing earnings, returns and refunds so the money and
 *     the returns line up with the parcels from day one.
 *
 * ── Idempotent ─────────────────────────────────────────────────────────────────────────
 * An order that already has `sub_orders` is skipped, so a re-run after a partial failure
 * picks up where it stopped.
 *
 * Run:
 *   node scripts/migrateOrdersToSubOrders.js            # dry run — reports, writes nothing
 *   node scripts/migrateOrdersToSubOrders.js --apply    # write
 *   node scripts/migrateOrdersToSubOrders.js --apply --limit 50
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { Order } = require('../models/orders');
const { Seller } = require('../models/sellers');
const { VendorEarning } = require('../models/vendorEarnings');
const { ReturnRequest } = require('../models/returnRequests');
const { Refund } = require('../models/refunds');
const subOrderService = require('../services/subOrderService');
const { mapBostaStateToOrderStatus } = require('../services/bostaStatusMap');

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 0;

/** The order status a legacy order was left in, mapped onto its parcels. */
const ORDER_STATUS_TO_SUB = {
    pending: 'pending_review',
    processing: 'awaiting_tracking',
    confirmed: 'awaiting_tracking',
    ready: 'ready_for_pickup',
    pickup_scheduled: 'pickup_scheduled',
    picked_up: 'picked_up',
    in_transit: 'in_transit',
    out_for_delivery: 'out_for_delivery',
    completed: 'delivered',
    returned: 'returned',
    exception: 'exception',
    cancelled: 'cancelled',
};

/**
 * What really happened to this parcel.
 *
 * The shipment's own Bosta state wins whenever there is one — it is the record of the
 * physical parcel. Only a parcel that never reached Bosta falls back to the order's
 * status, and then it is clamped so it can never claim to be further along than a parcel
 * with no tracking number could possibly be.
 */
const deriveSubStatus = (order, shipment, items) => {
    if (order.status === 'cancelled') return 'cancelled';

    if (shipment?.bosta_status) {
        const mapped = mapBostaStateToOrderStatus(shipment.bosta_status);
        if (mapped === 'completed') return 'delivered';
        if (mapped && mapped !== 'ready') return mapped;
        // "Pickup requested" / "Waiting for route": the parcel is with Bosta but nothing is
        // moving yet, which is exactly `ready_for_pickup`.
        return 'ready_for_pickup';
    }

    if (shipment?.bosta_tracking_number) return 'ready_for_pickup';

    // Never dispatched. A parcel with an unreviewed item is still at stage 1 whatever the
    // order claimed, and one with a declined item needs a human.
    if (items.some((i) => i.vendor_status === 'declined')) return 'needs_admin';
    if (items.some((i) => i.vendor_status === 'pending')) return 'pending_review';

    const fromOrder = ORDER_STATUS_TO_SUB[order.status] || 'pending_review';
    // Clamp: with no tracking number this parcel cannot be past stage 1's exit.
    return ['pending_review', 'needs_admin'].includes(fromOrder) ? fromOrder : 'awaiting_tracking';
};

/** Build the parcels for one order. Returns null when there is nothing to convert. */
const buildForOrder = (order, vendorMap) => {
    const groups = new Map();

    for (const item of order.items || []) {
        const vendorId = item.vendor_id?.toString();
        if (!vendorId) continue;

        // The branch the parcel actually shipped from is the historical truth; the
        // supervision's fulfillment_location is only a guess about what would have happened.
        const shipment = (order.shipments || []).find(
            (s) =>
                s.vendor_id?.toString() === vendorId &&
                (s.items || []).some((id) => id.toString() === item._id.toString())
        );
        const supervision = (order.vendor_supervisions || []).find(
            (vs) => vs.vendor_id?.toString() === vendorId
        );
        const vendor = vendorMap.get(vendorId);

        const location =
            shipment?.pickup_address?.address
            || supervision?.fulfillment_location
            || vendor?.locations?.find((l) => l.is_default)?.address
            || vendor?.locations?.[0]?.address
            || '';

        const key = `${vendorId}::${location}`;
        if (!groups.has(key)) {
            groups.set(key, { vendorId, location, items: [], shipment: shipment || null });
        }
        const group = groups.get(key);
        group.items.push(item);
        if (!group.shipment && shipment) group.shipment = shipment;
    }

    // A shipment whose item links were never recorded still represents a real parcel, so
    // match it to the group for its (vendor, branch) rather than lose it.
    for (const shipment of order.shipments || []) {
        const key = `${shipment.vendor_id}::${shipment.pickup_address?.address || ''}`;
        const group = groups.get(key);
        if (group && !group.shipment) group.shipment = shipment;
    }

    if (groups.size === 0) return null;

    const reference = order.transaction?.reference || order._id.toString();
    const subOrders = [];
    let index = 0;

    for (const group of groups.values()) {
        index += 1;
        const merchandise = group.items.reduce(
            (sum, i) => sum + Number(i.unit_price || 0) * Number(i.quantity || 0), 0
        );
        const commission = group.items.reduce((sum, i) => sum + Number(i.commission_amount || 0), 0);
        const status = deriveSubStatus(order, group.shipment, group.items);

        subOrders.push({
            _id: new mongoose.Types.ObjectId(),
            reference: `${reference}-${index}`,
            vendor_id: group.vendorId,
            fulfillment_location: group.location,
            status,
            merchandise_total: Number(merchandise.toFixed(2)),
            commission_total: Number(commission.toFixed(2)),
            shipment_id: group.shipment?._id || null,
            bosta_tracking_number: group.shipment?.bosta_tracking_number || null,
            items_confirmed_at: group.shipment?.sent_at || null,
            tracking_assigned_at: group.shipment?.sent_at || null,
            ready_at: group.shipment?.sent_at || null,
            // Nothing was ever photographed before this feature existed. Left empty on
            // purpose so the screens can say so rather than show an empty gallery.
            parcel_photos: [],
            delivered_at: status === 'delivered' ? (order.delivered_at || null) : null,
            cancelled_at: status === 'cancelled' ? (order.updated_at || order.created_at || null) : null,
            created_at: order.created_at || new Date(),
            history: [{
                action: 'sub_order_migrated',
                title: 'Parcel created from an existing order',
                details: `Converted at migration with status "${status}".`,
                actor_role: 'system',
                actor_label: 'Migration',
                metadata: { derived_from: order.status, had_shipment: !!group.shipment },
                created_at: new Date(),
            }],
            _items: group.items,
        });
    }

    return subOrders;
};

/**
 * Drop the old `{order_id, vendor_id}` UNIQUE index on vendorEarnings.
 *
 * Earnings moved from one row per (order, vendor) to one row per (order, parcel), and the
 * schema no longer declares that index as unique — but Mongoose only ever CREATES indexes,
 * it never removes ones a schema stopped declaring, and this project calls no
 * `syncIndexes()`. So the old unique constraint survives a deploy and quietly forbids the
 * one thing the split exists to allow: a vendor shipping two parcels from two branches on
 * the same order.
 *
 * Left in place, the second parcel's earnings row fails with E11000 and the vendor is
 * silently never paid for it. This has to run, and it has to run before any two-branch
 * order is delivered.
 */
const dropLegacyEarningsIndex = async () => {
    const coll = mongoose.connection.collection('vendorearnings');
    let indexes = [];
    try {
        indexes = await coll.indexes();
    } catch (err) {
        console.log(`\nCould not read vendorEarnings indexes (${err.message}) — check by hand.`);
        return;
    }

    const legacy = indexes.find(
        (i) => i.unique && i.key && i.key.order_id === 1 && i.key.vendor_id === 1 && !('sub_order_id' in i.key)
    );

    if (!legacy) {
        console.log('\nvendorEarnings: no legacy unique {order_id, vendor_id} index — nothing to drop.');
        return;
    }

    console.log(`\nvendorEarnings: found the legacy UNIQUE index "${legacy.name}".`);
    console.log('  It blocks a vendor from earning on two parcels of one order, which is');
    console.log('  exactly what shipping from two branches produces.');

    if (!APPLY) {
        console.log('  Dry run — it will be dropped when you re-run with --apply.');
        return;
    }

    await coll.dropIndex(legacy.name);
    console.log(`  Dropped. The non-unique {order_id, vendor_id} index is recreated by the`);
    console.log('  model on next boot, and uniqueness now lives on {order_id, sub_order_id}.');
};

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`Database: ${String(process.env.MONGO_URI).replace(/\/\/[^@]*@/, '//***@')}`);
    console.log(APPLY ? '\nMODE: APPLY (writing)\n' : '\nMODE: DRY RUN (nothing will be written)\n');

    await dropLegacyEarningsIndex();

    const filter = { $or: [{ sub_orders: { $exists: false } }, { sub_orders: { $size: 0 } }] };
    const total = await Order.countDocuments();
    const pending = await Order.countDocuments(filter);
    console.log(`Orders total           : ${total}`);
    console.log(`Orders to convert      : ${pending}`);

    const vendors = await Seller.find().select('_id locations store_name').lean();
    const vendorMap = new Map(vendors.map((v) => [v._id.toString(), v]));

    const cursor = Order.find(filter).limit(LIMIT || 0).cursor();

    const stats = {
        converted: 0, skipped: 0, failed: 0, parcels: 0, frozen: 0,
        multiParcel: 0, mismatched: 0,
        earnings: 0, returns: 0, refunds: 0,
    };

    for await (const order of cursor) {
        try {
            const built = buildForOrder(order, vendorMap);
            if (!built) { stats.skipped += 1; continue; }

            // Link items and shipments to their parcel.
            for (const sub of built) {
                for (const item of sub._items) item.sub_order_id = sub._id;
                if (sub.shipment_id) {
                    const shipment = (order.shipments || []).find(
                        (s) => s._id.toString() === sub.shipment_id.toString()
                    );
                    if (shipment) shipment.sub_order_id = sub._id;
                }
                delete sub._items;
            }

            order.sub_orders = built;

            // Split the money the same way a new order would be split.
            subOrderService.allocate(order);

            // An order already with Bosta holds COD amounts that cannot be restated, so its
            // split is frozen exactly as a live order's would be at dispatch.
            const dispatched = built.some((s) => s.bosta_tracking_number);
            if (dispatched) {
                order.allocation_frozen = true;
                order.allocation_frozen_at = order.created_at || new Date();
                for (const sub of order.sub_orders) sub.allocation_frozen_at = order.allocation_frozen_at;
                stats.frozen += 1;
            }

            // Report where the historical COD does not match what the split says it should
            // have been. These are the orders that were quietly under- or over-collected by
            // the old "merchandise only" rule; the migration does not touch the live Bosta
            // deliveries, it only surfaces them.
            for (const sub of order.sub_orders) {
                const shipment = (order.shipments || []).find(
                    (s) => s.sub_order_id?.toString() === sub._id.toString()
                );
                if (!shipment || !shipment.cod_amount) continue;
                if (Math.abs(Number(shipment.cod_amount) - Number(sub.cod_amount)) > 0.01) {
                    stats.mismatched += 1;
                    break;
                }
            }

            subOrderService.syncOrderStatus(order, 'Migration');
            if (built.length > 1) stats.multiParcel += 1;
            stats.parcels += built.length;

            if (APPLY) {
                await order.save();

                // Point existing money and returns at the parcel they belong to.
                for (const sub of order.sub_orders) {
                    const r1 = await VendorEarning.updateMany(
                        { order_id: order._id, vendor_id: sub.vendor_id, sub_order_id: null },
                        { $set: { sub_order_id: sub._id } }
                    );
                    stats.earnings += r1.modifiedCount || 0;

                    const r2 = await ReturnRequest.updateMany(
                        { order_id: order._id, vendor_id: sub.vendor_id, sub_order_id: null },
                        { $set: { sub_order_id: sub._id } }
                    );
                    stats.returns += r2.modifiedCount || 0;

                    const r3 = await Refund.updateMany(
                        { order_id: order._id, vendor_id: sub.vendor_id, sub_order_id: null },
                        { $set: { sub_order_id: sub._id } }
                    );
                    stats.refunds += r3.modifiedCount || 0;
                }
            }

            stats.converted += 1;
            if (stats.converted % 100 === 0) console.log(`  …${stats.converted} orders converted`);
        } catch (err) {
            stats.failed += 1;
            console.error(`  FAILED ${order._id}: ${err.message}`);
        }
    }

    console.log('\n--- Result ---');
    console.log(`Converted              : ${stats.converted}`);
    console.log(`  of those, multi-parcel: ${stats.multiParcel}`);
    console.log(`Parcels created        : ${stats.parcels}`);
    console.log(`Allocation frozen      : ${stats.frozen}  (already with Bosta)`);
    console.log(`Skipped (no items)     : ${stats.skipped}`);
    console.log(`Failed                 : ${stats.failed}`);
    console.log(`Earnings re-pointed    : ${stats.earnings}`);
    console.log(`Returns re-pointed     : ${stats.returns}`);
    console.log(`Refunds re-pointed     : ${stats.refunds}`);
    if (stats.mismatched > 0) {
        console.log(
            `\nNOTE: ${stats.mismatched} dispatched order(s) had a COD at Bosta that differs from ` +
            `the correct split.\nThese are the historical under/over-collections from the old ` +
            `"merchandise only" COD rule.\nThey are NOT corrected here — Bosta cannot restate a ` +
            `live delivery's COD.`
        );
    }
    if (!APPLY) console.log('\nDry run — nothing was written. Re-run with --apply.');

    await mongoose.disconnect();
    process.exit(stats.failed > 0 ? 1 : 0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
