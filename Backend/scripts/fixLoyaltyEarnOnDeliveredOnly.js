/**
 * Re-settle loyalty earning so an order only ever earned on the parcels the customer
 * actually received.
 *
 * ── Why this script exists ────────────────────────────────────────────────────────────
 * The earn was taken as one order-level figure priced at CHECKOUT, over the whole basket,
 * and credited when the order finished. Nothing re-checked what had actually arrived by
 * then, which left two opposite errors in the data:
 *
 *   OVER-CREDITED — a parcel was cancelled and refunded, but the order still credited the
 *   full basket estimate. The customer holds points for goods they never received and were
 *   paid back for.
 *
 *   UNDER-CREDITED — a parcel went back to the vendor instead of being cancelled. The order
 *   never reached "every parcel delivered", so the earn hook never fired at all and the
 *   customer got NOTHING, including on the parcels that did arrive.
 *
 * ── What it does ──────────────────────────────────────────────────────────────────────
 * For every order whose parcels have stopped moving, it recomputes the earn from the
 * delivered parcels' own frozen allocation (merchandise, less that parcel's share of the
 * coupon and of any points spent) at the rate the ORDER was priced with, and settles the
 * difference against the ledger:
 *
 *   credited > correct  → reverse the excess     (clamped: never drives a balance negative,
 *                                                 so points already spent are simply lost to
 *                                                 the reversal rather than becoming a debt)
 *   credited < correct  → credit the shortfall
 *
 * Orders where every parcel arrived are never touched — there is nothing to re-apportion
 * and recomputing would only risk a one-point rounding drift.
 *
 * Idempotent. The correct figure is derived from the parcels and the frozen rate, never by
 * scaling a stored total that a previous run may already have rewritten, so running it
 * twice changes nothing the second time.
 *
 * Run:
 *   node scripts/fixLoyaltyEarnOnDeliveredOnly.js            # report only, write nothing
 *   node scripts/fixLoyaltyEarnOnDeliveredOnly.js --apply    # settle the differences
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { Order } = require('../models/orders');
const { LoyaltyTransaction } = require('../models/loyaltyTransactions');
const loyaltyService = require('../services/loyaltyService');

const APPLY = process.argv.includes('--apply');

/** A parcel's own earning base — the same one the refund path reverses against. */
const eligibleOf = (sub) => Math.max(0,
    Number(sub.merchandise_total || 0) - Number(sub.coupon_share || 0) - Number(sub.loyalty_share || 0));

/** Every live parcel has either arrived or come back. */
const isSettled = (order) => {
    const live = (order.sub_orders || []).filter((s) => s.status !== 'cancelled');
    if (live.length === 0) return true;
    return live.every((s) => s.status === 'delivered' || s.status === 'returned');
};

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`Database: ${String(process.env.MONGO_URI).replace(/\/\/[^@]*@/, '//***@')}`);
    console.log(APPLY ? '\nMODE: APPLY — the ledger will be written.\n'
                      : '\nMODE: DRY RUN — nothing is written. Pass --apply to settle.\n');

    const settings = await loyaltyService.getLoyaltySettings();

    // Only orders that carry a loyalty snapshot and have parcels to apportion across.
    const orders = await Order.find({
        'loyalty.earn_points_pending': { $gt: 0 },
        'sub_orders.0': { $exists: true },
    }).select('_id transaction user_id paid_by_user_id status loyalty sub_orders').lean();

    let examined = 0, overs = 0, unders = 0, overPoints = 0, underPoints = 0, untouched = 0, skipped = 0;
    const rows = [];

    for (const order of orders) {
        if (!isSettled(order)) { skipped += 1; continue; }

        const subs = order.sub_orders || [];
        // Nothing was lost — the whole basket arrived, so there is nothing to re-apportion.
        if (subs.every((s) => s.status === 'delivered')) { untouched += 1; continue; }

        examined += 1;

        const deliveredEligible = subs
            .filter((s) => s.status === 'delivered')
            .reduce((sum, s) => sum + eligibleOf(s), 0);

        // The rate the ORDER was priced with, never today's.
        const spendPerPoint = Number(order.loyalty?.spend_per_point_snapshot) || settings.spend_per_point;
        const correct = loyaltyService.calculateEarnedPoints(deliveredEligible, { spend_per_point: spendPerPoint });

        const earnRow = await LoyaltyTransaction.findOne({
            idempotency_key: `order:${order._id}:earn-pending`,
        }).lean();
        const credited = Math.max(0, Math.floor(Number(earnRow?.points || 0)));
        const alreadyReversed = Math.max(0, Math.floor(Number(order.loyalty?.earned_points_reversed || 0)));
        const net = Math.max(0, credited - alreadyReversed);

        if (net === correct) { untouched += 1; continue; }

        const ref = order.transaction?.reference || order._id;
        const delivered = subs.filter((s) => s.status === 'delivered').length;
        const label = `${ref}  ${order.status}  ${delivered}/${subs.length} delivered`;

        if (net > correct) {
            const excess = net - correct;
            overs += 1; overPoints += excess;
            rows.push(`  OVER   ${label}  holds ${net}, earned ${correct}  → take back ${excess}`);
            if (APPLY) {
                const tx = await loyaltyService.reverseEarnedPoints({
                    userId: order.loyalty?.payer_user_id || order.paid_by_user_id || order.user_id,
                    points: excess,
                    orderId: order._id,
                    settings,
                    reason: 'Corrected: points had been earned on parcels that were never received',
                    idempotencyKey: `order:${order._id}:earn-correct-excess`,
                });
                if (tx?.points > 0) {
                    await Order.updateOne({ _id: order._id }, {
                        $inc: { 'loyalty.earned_points_reversed': tx.points },
                        $set: { 'loyalty.earn_points_pending': correct + alreadyReversed },
                        $push: { history: {
                            action: 'loyalty_points_reversed',
                            title: 'Loyalty points corrected',
                            details: `${tx.points} point(s) taken back — earned on parcels that were cancelled or returned.`,
                            actor_role: 'system', actor_label: 'Correction script',
                            metadata: { held: net, earned: correct, taken: tx.points },
                            created_at: new Date(),
                        } },
                    });
                    if (tx.points < excess) {
                        rows.push(`         ...only ${tx.points} could be taken; the rest was already spent.`);
                    }
                }
            }
        } else {
            const shortfall = correct - net;
            unders += 1; underPoints += shortfall;
            rows.push(`  UNDER  ${label}  holds ${net}, earned ${correct}  → credit ${shortfall}`);
            if (APPLY) {
                // No earn row at all is the common shape here: the hook never fired because
                // the order never reached "every parcel delivered". Let the service create
                // it, so the return window and the rate snapshot are handled the one way.
                if (!earnRow) {
                    const full = await Order.findById(order._id);
                    await loyaltyService.createPendingEarn({ order: full, settings });
                } else {
                    await loyaltyService.applyLedgerEntry({
                        userId: order.loyalty?.payer_user_id || order.paid_by_user_id || order.user_id,
                        type: 'earn_pending',
                        points: shortfall,
                        deltas: { pending: shortfall },
                        idempotencyKey: `order:${order._id}:earn-correct-shortfall`,
                        monetaryValue: shortfall * Number(order.loyalty?.point_value_snapshot || settings.point_value),
                        settings,
                        orderId: order._id,
                        availableAt: earnRow.available_at,
                        reason: 'Corrected: points owed on parcels that were received',
                    });
                    await Order.updateOne({ _id: order._id }, {
                        $set: { 'loyalty.earn_points_pending': correct + alreadyReversed },
                    });
                }
            }
        }
    }

    console.log(rows.length ? rows.join('\n') : '  Nothing to correct.');
    console.log(`\nStill in motion, left alone: ${skipped}`);
    console.log(`Settled and already correct:  ${untouched}`);
    console.log(`Settled and re-apportioned:   ${examined}`);
    console.log(`  over-credited:  ${overs} order(s), ${overPoints} point(s) to take back`);
    console.log(`  under-credited: ${unders} order(s), ${underPoints} point(s) to credit`);
    if (!APPLY && (overs || unders)) console.log('\nRe-run with --apply to settle these.');

    await mongoose.disconnect();
})().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect();
    process.exit(1);
});
