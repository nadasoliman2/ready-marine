/**
 * Loyalty Service
 * ---------------
 * The single writer for customer loyalty balances.
 *
 * Two invariants hold everywhere below:
 *
 *  1. **Every** point movement is an immutable `LoyaltyTransaction` row. The
 *     three balances on `LoyaltyAccount` are a cache of that ledger, never an
 *     independent source of truth, and nothing outside this file writes them.
 *
 *  2. **Every** movement carries an `idempotency_key` unique to the business
 *     event that caused it. Bosta webhooks, the tracking sweep, the payment
 *     redirect, and the payment webhook all replay the same hooks — the unique
 *     index is what turns a replay into a no-op instead of duplicate points.
 *
 * Balance changes are applied with a CONDITIONAL `$inc` (`available >= n`), so
 * two checkouts racing in two tabs cannot spend the same points: the second
 * conditional update matches nothing and fails loudly.
 */

const mongoose = require('mongoose');
const { LoyaltyAccount } = require('../models/loyaltyAccounts');
const { LoyaltyTransaction } = require('../models/loyaltyTransactions');
const { SiteSettings } = require('../models/site_settings');

const round2 = (value) => Number((Number(value) || 0).toFixed(2));
const toInt = (value) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? n : 0;
};

const DEFAULT_SETTINGS = {
    enabled: false,
    earning_enabled: true,
    redemption_enabled: true,
    activated_at: null,
    spend_per_point: 25,
    point_value: 0.5,
    min_redeem_points: 1,
    max_redemption_percent: 50,
    allow_with_coupons: true,
    points_expiry_days: null,
};

/* ------------------------------------------------------------------ */
/*  Settings                                                          */
/* ------------------------------------------------------------------ */

/**
 * Active loyalty configuration, with every field guaranteed present and sane.
 * Falls back to a disabled program on any read failure — a settings outage
 * must degrade to "no loyalty", never to "free points".
 */
const getLoyaltySettings = async () => {
    try {
        const doc = await SiteSettings.findOne().select('loyalty currency').lean();
        const loyalty = doc?.loyalty || {};
        return {
            ...DEFAULT_SETTINGS,
            ...loyalty,
            spend_per_point: Number(loyalty.spend_per_point) > 0
                ? Number(loyalty.spend_per_point)
                : DEFAULT_SETTINGS.spend_per_point,
            point_value: Number(loyalty.point_value) > 0
                ? Number(loyalty.point_value)
                : DEFAULT_SETTINGS.point_value,
            min_redeem_points: Math.max(0, toInt(loyalty.min_redeem_points ?? DEFAULT_SETTINGS.min_redeem_points)),
            max_redemption_percent: Math.min(100, Math.max(0,
                Number(loyalty.max_redemption_percent ?? DEFAULT_SETTINGS.max_redemption_percent))),
            currency: doc?.currency || 'EGP',
        };
    } catch (err) {
        console.error('[Loyalty] Failed to read settings:', err.message);
        return { ...DEFAULT_SETTINGS, currency: 'EGP' };
    }
};

/** Validate an admin settings payload. Returns the sanitized patch. */
const validateSettingsPatch = (patch = {}) => {
    const out = {};
    const errors = [];

    const bools = ['enabled', 'earning_enabled', 'redemption_enabled', 'allow_with_coupons'];
    for (const key of bools) {
        if (patch[key] !== undefined) out[key] = !!patch[key];
    }

    if (patch.spend_per_point !== undefined) {
        const v = Number(patch.spend_per_point);
        if (!Number.isFinite(v) || v <= 0) errors.push('Spend per point must be greater than 0');
        else out.spend_per_point = v;
    }
    if (patch.point_value !== undefined) {
        const v = Number(patch.point_value);
        if (!Number.isFinite(v) || v <= 0) errors.push('Point value must be greater than 0');
        else out.point_value = v;
    }
    if (patch.min_redeem_points !== undefined) {
        const v = Number(patch.min_redeem_points);
        if (!Number.isFinite(v) || v < 0 || v !== Math.floor(v)) {
            errors.push('Minimum redeemable points must be a whole number of 0 or more');
        } else out.min_redeem_points = v;
    }
    if (patch.max_redemption_percent !== undefined) {
        const v = Number(patch.max_redemption_percent);
        if (!Number.isFinite(v) || v < 0 || v > 100) {
            errors.push('Maximum redemption percent must be between 0 and 100');
        } else out.max_redemption_percent = v;
    }
    if (patch.points_expiry_days !== undefined) {
        if (patch.points_expiry_days === null || patch.points_expiry_days === '') {
            out.points_expiry_days = null;
        } else {
            const v = Number(patch.points_expiry_days);
            if (!Number.isFinite(v) || v <= 0 || v !== Math.floor(v)) {
                errors.push('Points expiry days must be a whole number greater than 0, or empty for no expiry');
            } else out.points_expiry_days = v;
        }
    }

    if (errors.length > 0) {
        const err = new Error(errors.join('. '));
        err.code = 'INVALID_LOYALTY_SETTINGS';
        throw err;
    }
    return out;
};

const snapshotOf = (settings) => ({
    spend_per_point: Number(settings.spend_per_point),
    point_value: Number(settings.point_value),
    currency: settings.currency || 'EGP',
});

/* ------------------------------------------------------------------ */
/*  Accounts                                                          */
/* ------------------------------------------------------------------ */

const getOrCreateAccount = async (userId) => {
    if (!userId) throw new Error('A loyalty account needs a user');
    const existing = await LoyaltyAccount.findOne({ user_id: userId });
    if (existing) return existing;
    try {
        return await LoyaltyAccount.create({ user_id: userId });
    } catch (err) {
        // Unique-index race: another request created it a moment ago.
        if (err.code === 11000) return await LoyaltyAccount.findOne({ user_id: userId });
        throw err;
    }
};

/** Read-only balances. Never creates an account, so a GET stays a GET. */
const getBalances = async (userId) => {
    const empty = {
        available_points: 0, pending_points: 0, reserved_points: 0,
        lifetime_earned_points: 0, lifetime_redeemed_points: 0,
    };
    // Mongoose strips an undefined filter value, so a missing id would match
    // the FIRST account in the collection — someone else's balance. Refuse.
    if (!userId) return empty;

    const account = await LoyaltyAccount.findOne({ user_id: userId }).lean();
    return {
        available_points: account?.available_points || 0,
        pending_points: account?.pending_points || 0,
        reserved_points: account?.reserved_points || 0,
        lifetime_earned_points: account?.lifetime_earned_points || 0,
        lifetime_redeemed_points: account?.lifetime_redeemed_points || 0,
    };
};

/* ------------------------------------------------------------------ */
/*  The one write path                                                */
/* ------------------------------------------------------------------ */

const loyaltyError = (code, message) => {
    const err = new Error(message);
    err.code = code;
    return err;
};

/**
 * Apply one ledger entry: mutate balances atomically, then durably record why.
 *
 * Order of operations matters. The conditional `$inc` runs FIRST so an
 * over-spend is rejected by the database rather than by a read-then-write
 * check that another request can slip through. The ledger row is written
 * second; if its unique key collides, the operation was already applied by an
 * earlier replay, so the `$inc` is rolled back and the original row returned.
 *
 * @param {Object} deltas  Signed change per balance, e.g. { available: -20, reserved: 20 }.
 * @param {Object} lifetime Signed change for the lifetime counters.
 * @returns {{ transaction, account, duplicate: boolean }}
 */
const applyLedgerEntry = async ({
    userId,
    type,
    points,
    deltas = {},
    lifetime = {},
    idempotencyKey,
    monetaryValue = 0,
    settings,
    orderId = null,
    paymentId = null,
    refundId = null,
    sourceTransactionId = null,
    availableAt = null,
    reason = '',
    actor = {},
}) => {
    if (!idempotencyKey) throw new Error('A loyalty transaction needs an idempotency key');

    const magnitude = Math.max(0, toInt(points));

    // Fast path — a replay we have already seen. Cheaper than provoking the
    // unique-index collision below, and far more common.
    const seen = await LoyaltyTransaction.findOne({ idempotency_key: idempotencyKey });
    if (seen) {
        const account = await LoyaltyAccount.findOne({ user_id: userId });
        return { transaction: seen, account, duplicate: true };
    }

    const account = await getOrCreateAccount(userId);
    const activeSettings = settings || await getLoyaltySettings();

    const inc = {};
    const filter = { _id: account._id };
    const fieldOf = { available: 'available_points', pending: 'pending_points', reserved: 'reserved_points' };

    for (const [balance, field] of Object.entries(fieldOf)) {
        const delta = toInt(deltas[balance] || 0);
        if (delta === 0) continue;
        inc[field] = delta;
        // A negative delta may never drive a balance below zero. Expressing
        // that as a query condition is what makes the whole operation atomic.
        if (delta < 0) filter[field] = { $gte: -delta };
    }
    if (lifetime.earned) inc.lifetime_earned_points = toInt(lifetime.earned);
    if (lifetime.redeemed) inc.lifetime_redeemed_points = toInt(lifetime.redeemed);

    const updated = Object.keys(inc).length > 0
        ? await LoyaltyAccount.findOneAndUpdate(
            filter,
            { $inc: inc, $set: { updated_at: new Date() } },
            { returnDocument: 'after' }
        )
        : account;

    if (!updated) {
        throw loyaltyError(
            'INSUFFICIENT_POINTS',
            'Not enough loyalty points are available for this operation'
        );
    }

    try {
        const transaction = await LoyaltyTransaction.create({
            user_id: userId,
            account_id: account._id,
            type,
            points: magnitude,
            monetary_value: round2(monetaryValue),
            balance_deltas: {
                available: toInt(deltas.available || 0),
                pending: toInt(deltas.pending || 0),
                reserved: toInt(deltas.reserved || 0),
            },
            order_id: orderId,
            payment_id: paymentId,
            refund_id: refundId,
            source_transaction_id: sourceTransactionId,
            idempotency_key: idempotencyKey,
            settings_snapshot: snapshotOf(activeSettings),
            available_at: availableAt,
            reason,
            actor: { role: actor.role || 'system', label: actor.label || actor.username || 'System' },
        });
        return { transaction, account: updated, duplicate: false };
    } catch (err) {
        // Roll the balances back — the ledger is authoritative, and a balance
        // we cannot explain with a transaction must not survive.
        if (Object.keys(inc).length > 0) {
            const revert = Object.fromEntries(Object.entries(inc).map(([k, v]) => [k, -v]));
            await LoyaltyAccount.updateOne({ _id: account._id }, { $inc: revert, $set: { updated_at: new Date() } });
        }
        if (err.code === 11000) {
            // Lost the race to a concurrent replay of the same event.
            const existing = await LoyaltyTransaction.findOne({ idempotency_key: idempotencyKey });
            const current = await LoyaltyAccount.findById(account._id);
            return { transaction: existing, account: current, duplicate: true };
        }
        throw err;
    }
};

/* ------------------------------------------------------------------ */
/*  Pricing helpers (pure)                                            */
/* ------------------------------------------------------------------ */

/**
 * Points earned by an order.
 *
 * `floor` per order, on merchandise only, AFTER coupon and loyalty discounts —
 * so redeemed points never earn more points and shipping never earns anything.
 */
const calculateEarnedPoints = (eligibleAmount, settings) => {
    const spendPerPoint = Number(settings?.spend_per_point) || DEFAULT_SETTINGS.spend_per_point;
    const amount = Math.max(0, Number(eligibleAmount) || 0);
    return Math.floor(amount / spendPerPoint);
};

/**
 * The authoritative redemption for a checkout.
 *
 * Clamps the customer's request by, in order: the configured percentage cap on
 * eligible merchandise, their real balance, and the configured minimum. The
 * browser's numbers are only ever a *request* — this result is what is charged.
 *
 * @param {number} eligibleMerchandise Product subtotal AFTER coupon, shipping excluded.
 */
const computeRedemption = ({
    settings,
    availablePoints = 0,
    eligibleMerchandise = 0,
    requestedPoints = 0,
    hasCoupon = false,
}) => {
    const empty = {
        points: 0,
        discount: 0,
        max_points: 0,
        max_discount: 0,
        blocked_reason: null,
    };

    if (!settings?.enabled || !settings?.redemption_enabled) {
        return { ...empty, blocked_reason: 'REDEMPTION_DISABLED' };
    }
    if (hasCoupon && !settings.allow_with_coupons) {
        return { ...empty, blocked_reason: 'COUPON_STACKING_DISABLED' };
    }

    const merchandise = Math.max(0, round2(eligibleMerchandise));
    const pointValue = Number(settings.point_value) || DEFAULT_SETTINGS.point_value;
    const capAmount = round2(merchandise * (Number(settings.max_redemption_percent) / 100));

    // Floor, so the discount can never exceed the cap by a rounding cent.
    const maxPoints = Math.max(0, Math.min(toInt(availablePoints), Math.floor(capAmount / pointValue)));
    const maxDiscount = round2(maxPoints * pointValue);

    const requested = Math.max(0, toInt(requestedPoints));
    if (requested === 0) return { ...empty, max_points: maxPoints, max_discount: maxDiscount };

    const points = Math.min(requested, maxPoints);
    if (points < Number(settings.min_redeem_points || 0)) {
        return {
            ...empty,
            max_points: maxPoints,
            max_discount: maxDiscount,
            blocked_reason: 'BELOW_MINIMUM',
        };
    }

    return {
        points,
        discount: round2(points * pointValue),
        max_points: maxPoints,
        max_discount: maxDiscount,
        blocked_reason: null,
    };
};

/* ------------------------------------------------------------------ */
/*  Redemption operations                                             */
/* ------------------------------------------------------------------ */

/**
 * Hold points for an active hosted payment. Called before the customer leaves
 * for the provider, so the balance cannot be spent again while they are away.
 */
const reservePoints = async ({ userId, points, paymentId, settings, reason = '' }) => {
    const magnitude = toInt(points);
    if (magnitude <= 0) return null;
    const active = settings || await getLoyaltySettings();

    const { transaction } = await applyLedgerEntry({
        userId,
        type: 'redeem_reserve',
        points: magnitude,
        deltas: { available: -magnitude, reserved: magnitude },
        idempotencyKey: `payment:${paymentId}:redeem-reserve`,
        monetaryValue: magnitude * Number(active.point_value),
        settings: active,
        paymentId,
        reason: reason || 'Points held for an online payment',
    });
    return transaction;
};

/** Payment failed, expired, or was abandoned — give the hold back. */
const releaseReservation = async ({ userId, points, paymentId, settings, reason = '' }) => {
    const magnitude = toInt(points);
    if (magnitude <= 0) return null;
    const active = settings || await getLoyaltySettings();

    const reserve = await LoyaltyTransaction.findOne({
        idempotency_key: `payment:${paymentId}:redeem-reserve`,
    });
    if (!reserve) return null;
    // A consumed reservation is spent, not held — releasing it would mint points.
    const consumed = await LoyaltyTransaction.exists({
        idempotency_key: `payment:${paymentId}:redeem-consume`,
    });
    if (consumed) return null;

    const { transaction } = await applyLedgerEntry({
        userId,
        type: 'redeem_release',
        points: magnitude,
        deltas: { available: magnitude, reserved: -magnitude },
        idempotencyKey: `payment:${paymentId}:redeem-release`,
        monetaryValue: magnitude * Number(active.point_value),
        settings: active,
        paymentId,
        sourceTransactionId: reserve._id,
        reason: reason || 'Online payment did not complete',
    });
    return transaction;
};

/**
 * Spend points on a placed order.
 *
 * Online orders consume a reservation made earlier (`from: 'reserved'`); cash
 * on delivery has no hosted payment to reserve against and spends the
 * available balance directly at placement (`from: 'available'`).
 */
const consumePoints = async ({ userId, points, orderId, paymentId = null, settings, from = 'available', idempotencyKey = null, reason = '' }) => {
    const magnitude = toInt(points);
    if (magnitude <= 0) return null;
    const active = settings || await getLoyaltySettings();

    const deltas = from === 'reserved'
        ? { reserved: -magnitude }
        : { available: -magnitude };

    const { transaction } = await applyLedgerEntry({
        userId,
        type: 'redeem_consume',
        points: magnitude,
        deltas,
        lifetime: { redeemed: magnitude },
        idempotencyKey: idempotencyKey || (paymentId
            ? `payment:${paymentId}:redeem-consume`
            : `order:${orderId}:redeem-consume`),
        monetaryValue: magnitude * Number(active.point_value),
        settings: active,
        orderId,
        paymentId,
        reason: reason || 'Points redeemed on an order',
    });
    return transaction;
};

/**
 * Give spent points back — a cancelled COD order, or the loyalty-funded share
 * of a refunded item. Restored as POINTS, never as cash: the customer never
 * paid money for them, so refunding money would be minting it.
 */
const restorePoints = async ({ userId, points, orderId, refundId = null, settings, reason = '', idempotencyKey }) => {
    const magnitude = toInt(points);
    if (magnitude <= 0) return null;
    const active = settings || await getLoyaltySettings();

    const key = idempotencyKey || (refundId
        ? `refund:${refundId}:redeem-restore`
        : `order:${orderId}:redeem-restore`);

    const { transaction } = await applyLedgerEntry({
        userId,
        type: 'redeem_restore',
        points: magnitude,
        // Restored points are immediately spendable: they were already
        // settled once, so there is nothing left to wait for.
        deltas: { available: magnitude },
        lifetime: { redeemed: -magnitude },
        idempotencyKey: key,
        monetaryValue: magnitude * Number(active.point_value),
        settings: active,
        orderId,
        refundId,
        reason: reason || 'Redeemed points returned',
    });
    return transaction;
};

/* ------------------------------------------------------------------ */
/*  Earning operations                                                */
/* ------------------------------------------------------------------ */

/**
 * Reduce earned points after a refund.
 *
 * Pending first, then available — a customer who has not yet been given the
 * points loses them silently, and only a genuine shortfall touches a balance
 * they can already see. Never drives a balance negative: if they have already
 * spent released points, the reversal stops at zero rather than creating debt.
 */
const reverseEarnedPoints = async ({ userId, points, orderId, refundId = null, settings, reason = '', idempotencyKey }) => {
    const magnitude = toInt(points);
    if (magnitude <= 0) return null;
    const active = settings || await getLoyaltySettings();

    const account = await getOrCreateAccount(userId);
    const fromPending = Math.min(magnitude, account.pending_points);
    const fromAvailable = Math.min(magnitude - fromPending, account.available_points);
    const total = fromPending + fromAvailable;
    if (total <= 0) return null;

    const key = idempotencyKey || (refundId
        ? `refund:${refundId}:earn-reverse`
        : `order:${orderId}:earn-reverse`);

    const { transaction } = await applyLedgerEntry({
        userId,
        type: 'earn_reverse',
        points: total,
        deltas: { pending: -fromPending, available: -fromAvailable },
        lifetime: { earned: -fromAvailable },
        idempotencyKey: key,
        monetaryValue: total * Number(active.point_value),
        settings: active,
        orderId,
        refundId,
        reason: reason || 'Earned points reversed by a refund',
    });
    return transaction;
};

/**
 * Order statuses that mean the earn never really happened — the order was
 * cancelled after it was delivered, or the goods came back. Points sitting out
 * the return window on one of these are taken back rather than released.
 */
const DEAD_EARN_ORDER_STATUSES = ['cancelled', 'returned', 'refunded'];

/**
 * Take back whatever earn an order is still holding, because it was cancelled or
 * returned.
 *
 * Two guards make this safe to call from anywhere, as often as you like:
 *
 *  - It reverses nothing unless the order actually CREDITED points. This matters
 *    more than it looks: `loyalty.earn_points_pending` is written at placement as
 *    an estimate, long before delivery, so its presence is not evidence that the
 *    customer was ever given anything. Reversing on the estimate alone would take
 *    points off a balance those points never entered — points earned on somebody
 *    else's order.
 *  - It only ever reverses what is still outstanding, so the live hook below and
 *    the daily sweep can both fire on the same order and the second one moves
 *    nothing.
 *
 * @returns {Object|null} the ledger transaction, or null when there was nothing to take.
 */
const reverseOutstandingEarn = async ({ order, reason = '', idempotencyKey, settings }) => {
    if (!order?._id) return null;

    // Did this order ever hand the customer points, and how many? The ledger row is
    // the only honest answer. `loyalty.earn_points_pending` starts life at placement
    // as an estimate, and on a partly cancelled order the credit is deliberately
    // smaller than it — so reversing against the order's figure could take more than
    // the order ever gave, and the excess would come out of points earned elsewhere.
    const earnRow = await LoyaltyTransaction.findOne({
        idempotency_key: `order:${order._id}:earn-pending`,
    }).lean();
    if (!earnRow) return null;

    const loyalty = order.loyalty || {};
    const earned = Math.max(0, toInt(earnRow.points));
    const alreadyReversed = Math.max(0, toInt(loyalty.earned_points_reversed));
    const outstanding = earned - alreadyReversed;
    if (outstanding <= 0) return null;

    const transaction = await reverseEarnedPoints({
        userId: loyalty.payer_user_id || order.paid_by_user_id || order.user_id,
        points: outstanding,
        orderId: order._id,
        settings,
        reason: reason || 'Order cancelled or returned',
        // One key for every route into this reversal — the live cancel hook, the
        // admin closing a parcel as returned, and both sweep phases. An order goes
        // dead once, so they are all the same movement arriving by different roads,
        // and sharing the key lets the ledger itself refuse the second one.
        idempotencyKey: idempotencyKey || `order:${order._id}:earn-reverse-cancel`,
    });
    // A reversal comes up short when the points were already released and spent.
    // Record what actually moved, never what we asked for.
    if (!transaction || transaction.points <= 0) return null;

    const { Order } = require('../models/orders');
    await Order.updateOne(
        { _id: order._id },
        {
            $inc: { 'loyalty.earned_points_reversed': transaction.points },
            $push: {
                history: {
                    action: 'loyalty_points_reversed',
                    title: 'Loyalty points cancelled',
                    details: `${transaction.points} point${transaction.points === 1 ? '' : 's'} taken back — ${reason || 'the order was cancelled or returned'}.`,
                    actor_role: 'system',
                    actor_label: 'System',
                    metadata: { points: transaction.points, reason },
                    created_at: new Date(),
                },
            },
        }
    );

    return transaction;
};

/**
 * Record the points a delivered order earned, held until the return window
 * closes. Idempotent per order, because "delivered" arrives from a Bosta
 * webhook, a polling sweep, and an admin status change — often all three.
 */
/**
 * Whether every parcel still part of the order has stopped moving — each one either
 * arrived or came back.
 *
 * The earn is a single order-level figure, so it can only be taken once the answer to
 * "how much of this did the customer actually receive?" has stopped changing. Crediting
 * while a parcel is still in transit would freeze a number that is about to be wrong,
 * and the ledger row is idempotent, so nothing would ever top it up.
 */
const isEarnSettled = (order) => {
    const live = (order?.sub_orders || []).filter((s) => s.status !== 'cancelled');
    if (live.length === 0) return true;
    return live.every((s) => s.status === 'delivered' || s.status === 'returned');
};

/**
 * The slice of an order's estimated earn that its DELIVERED parcels actually earned.
 *
 * The estimate on the order is priced at checkout, over the whole basket. A parcel
 * cancelled before it shipped was refunded, so the customer never spent that money
 * and never earned on it — crediting the whole estimate would pay them points for
 * goods they did not receive and were not charged for.
 *
 * The split uses each parcel's own frozen allocation (merchandise, less its share of
 * the coupon and of the points spent), which is the same base the earn was priced on
 * and the same one a refund reverses against. Summing the parcels rather than dividing
 * by `loyalty.eligible_amount` keeps the ratio internally consistent, so the delivered
 * shares of a fully delivered order add back up to exactly the estimate.
 *
 * Falls straight through for an order with no parcels (placed before the split) and
 * for one where nothing was cancelled, so the ordinary path never picks up a rounding
 * error it did not have before.
 */
const deliveredEarnPoints = (order, estimatedPoints) => {
    const subs = order?.sub_orders || [];
    if (subs.length === 0) return estimatedPoints;
    // Everything arrived — the shares would only reintroduce a rounding error.
    if (subs.every((s) => s.status === 'delivered')) return estimatedPoints;

    const eligibleOf = (s) => Math.max(0,
        Number(s.merchandise_total || 0) - Number(s.coupon_share || 0) - Number(s.loyalty_share || 0));

    const wholeOrder = subs.reduce((sum, s) => sum + eligibleOf(s), 0);
    if (wholeOrder <= 0) return 0;

    const delivered = subs
        .filter((s) => s.status === 'delivered')
        .reduce((sum, s) => sum + eligibleOf(s), 0);

    return Math.max(0, Math.min(estimatedPoints, Math.round(estimatedPoints * (delivered / wholeOrder))));
};

const createPendingEarn = async ({ order, settings }) => {
    const active = settings || await getLoyaltySettings();
    if (!active.enabled || !active.earning_enabled) return null;

    // No retroactive points: only orders placed after the program went live.
    if (active.activated_at && new Date(order.created_at) < new Date(active.activated_at)) return null;

    const loyalty = order.loyalty || {};
    const estimated = toInt(loyalty.earn_points_pending);
    if (estimated <= 0) return null;

    // Wait for the last parcel to stop moving, then earn on the ones that arrived.
    // A cancelled parcel was refunded and a returned one came back; neither was ever
    // paid for, so neither earns.
    if (!isEarnSettled(order)) return null;
    const points = deliveredEarnPoints(order, estimated);
    if (points <= 0) return null;

    // Points belong to the PAYER. On a gift order `user_id` is already the
    // payer, so this stays correct without special-casing the recipient.
    const payerUserId = loyalty.payer_user_id || order.paid_by_user_id || order.user_id;

    // The window runs from the last parcel the customer actually received. `delivered_at`
    // is only stamped on an order that completed in full, so an order that settled with a
    // parcel cancelled or returned has to read the date off the parcels themselves.
    const deliveries = (order.sub_orders || [])
        .filter((s) => s.status === 'delivered' && s.delivered_at)
        .map((s) => new Date(s.delivered_at).getTime());
    const lastDelivery = order.delivered_at
        ? new Date(order.delivered_at)
        : (deliveries.length ? new Date(Math.max(...deliveries)) : new Date());

    const availableAt = new Date(lastDelivery);
    availableAt.setDate(availableAt.getDate() + getReturnWindowDays());

    const { transaction, duplicate } = await applyLedgerEntry({
        userId: payerUserId,
        type: 'earn_pending',
        points,
        deltas: { pending: points },
        idempotencyKey: `order:${order._id}:earn-pending`,
        monetaryValue: points * Number(active.point_value),
        settings: {
            ...active,
            // Freeze the rate the ORDER was priced with, not today's rate.
            spend_per_point: Number(loyalty.spend_per_point_snapshot) || active.spend_per_point,
            point_value: Number(loyalty.point_value_snapshot) || active.point_value,
        },
        orderId: order._id,
        availableAt,
        reason: 'Order delivered',
    });

    if (duplicate) return null;

    // Write back what was actually credited, because from here on the order's own
    // figure is what everything else reasons about — a later return prices its
    // reversal against it, and the sweep releases against it. Leaving the checkout
    // estimate in place on a partly cancelled order would let a full return reverse
    // more points than the order ever handed out.
    if (points !== estimated) {
        const { Order } = require('../models/orders');
        await Order.updateOne(
            { _id: order._id },
            {
                $set: { 'loyalty.earn_points_pending': points },
                $push: {
                    history: {
                        action: 'loyalty_points_pending',
                        title: 'Loyalty points held',
                        details: `${points} point${points === 1 ? '' : 's'} held for the return window — ` +
                            `${estimated - points} not earned, on parcels that were cancelled.`,
                        actor_role: 'system',
                        actor_label: 'System',
                        metadata: { credited: points, estimated },
                        created_at: new Date(),
                    },
                },
            }
        );
    }

    return transaction;
};

const getReturnWindowDays = () => {
    // Required lazily: returnService pulls in the order/refund graph, and a
    // top-level require here would make the two modules circular.
    const { RETURN_WINDOW_DAYS } = require('./returnService');
    return RETURN_WINDOW_DAYS;
};

/**
 * Move a matured pending earn into the available balance.
 * `pendingTransaction` is the original `earn_pending` row.
 */
const releasePendingEarn = async ({ pendingTransaction, settings, remainingPoints }) => {
    const active = settings || await getLoyaltySettings();
    const points = remainingPoints === undefined ? pendingTransaction.points : toInt(remainingPoints);
    if (points <= 0) return null;

    const { transaction, duplicate } = await applyLedgerEntry({
        userId: pendingTransaction.user_id,
        type: 'earn_release',
        points,
        deltas: { pending: -points, available: points },
        lifetime: { earned: points },
        idempotencyKey: `order:${pendingTransaction.order_id}:earn-release`,
        monetaryValue: points * Number(active.point_value),
        settings: active,
        orderId: pendingTransaction.order_id,
        sourceTransactionId: pendingTransaction._id,
        reason: 'Return window closed',
    });

    return duplicate ? null : transaction;
};

/* ------------------------------------------------------------------ */
/*  Admin adjustments                                                 */
/* ------------------------------------------------------------------ */

/**
 * Credit or debit a customer by hand, for support.
 *
 * There is deliberately no path that writes a balance directly: an adjustment
 * is an ordinary ledger entry with a mandatory reason and a named admin, so it
 * shows up in the customer's own history like everything else.
 */
const adminAdjustPoints = async ({ userId, points, reason, actor = {}, direction }) => {
    const magnitude = toInt(points);
    if (magnitude <= 0) throw loyaltyError('INVALID_POINTS', 'Enter a whole number of points greater than 0');
    if (!reason || !String(reason).trim()) {
        throw loyaltyError('REASON_REQUIRED', 'A reason is required for every manual adjustment');
    }
    if (!['credit', 'debit'].includes(direction)) {
        throw loyaltyError('INVALID_DIRECTION', 'Adjustment direction must be credit or debit');
    }

    const settings = await getLoyaltySettings();
    const before = await getBalances(userId);

    const { transaction } = await applyLedgerEntry({
        userId,
        type: direction === 'credit' ? 'admin_credit' : 'admin_debit',
        points: magnitude,
        deltas: { available: direction === 'credit' ? magnitude : -magnitude },
        lifetime: direction === 'credit' ? { earned: magnitude } : {},
        // Manual adjustments are intentionally NOT deduplicated across calls —
        // an admin correcting twice means twice. Uniqueness comes from time.
        idempotencyKey: `admin:${userId}:${direction}:${Date.now()}:${new mongoose.Types.ObjectId()}`,
        monetaryValue: magnitude * Number(settings.point_value),
        settings,
        reason: String(reason).trim(),
        actor,
    });

    const after = await getBalances(userId);
    return { transaction, before, after };
};

/* ------------------------------------------------------------------ */
/*  Reads                                                             */
/* ------------------------------------------------------------------ */

const getTransactionHistory = async (userId, { page = 1, limit = 20, type } = {}) => {
    const filter = { user_id: userId };
    if (type) filter.type = type;

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));

    const [total, transactions] = await Promise.all([
        LoyaltyTransaction.countDocuments(filter),
        LoyaltyTransaction.find(filter)
            .sort({ created_at: -1 })
            .skip((safePage - 1) * safeLimit)
            .limit(safeLimit)
            .populate('order_id', 'transaction.reference created_at total_price')
            .lean(),
    ]);

    return {
        transactions: transactions.map((t) => ({
            _id: t._id,
            type: t.type,
            points: t.points,
            monetary_value: t.monetary_value,
            balance_deltas: t.balance_deltas,
            reason: t.reason,
            actor: t.actor,
            available_at: t.available_at,
            created_at: t.created_at,
            settings_snapshot: t.settings_snapshot,
            order: t.order_id
                ? {
                    _id: t.order_id._id,
                    reference: t.order_id.transaction?.reference || String(t.order_id._id),
                    total_price: t.order_id.total_price,
                }
                : null,
        })),
        pagination: { total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) },
    };
};

/** Everything the customer's "My Points" screen needs, in one call. */
const getCustomerWallet = async (userId) => {
    const [settings, balances] = await Promise.all([getLoyaltySettings(), getBalances(userId)]);
    const pointValue = Number(settings.point_value);

    return {
        enabled: !!settings.enabled,
        balances,
        value: {
            available: round2(balances.available_points * pointValue),
            pending: round2(balances.pending_points * pointValue),
            reserved: round2(balances.reserved_points * pointValue),
            currency: settings.currency,
        },
        rules: {
            earning_enabled: !!settings.earning_enabled,
            redemption_enabled: !!settings.redemption_enabled,
            spend_per_point: Number(settings.spend_per_point),
            point_value: pointValue,
            min_redeem_points: Number(settings.min_redeem_points),
            max_redemption_percent: Number(settings.max_redemption_percent),
            allow_with_coupons: !!settings.allow_with_coupons,
            points_expiry_days: settings.points_expiry_days ?? null,
            return_window_days: getReturnWindowDays(),
            currency: settings.currency,
        },
    };
};

/**
 * Shape the loyalty block of a priced preview for the browser.
 *
 * Deliberately omits the raw settings object: the client gets the few numbers
 * it needs to render a summary and nothing it could mistake for authority.
 */
const toPublicPreview = (loyalty = {}) => ({
    enabled: !!loyalty.settings?.enabled,
    redemption_enabled: !!loyalty.settings?.redemption_enabled,
    earning_enabled: !!loyalty.settings?.earning_enabled,
    available_points: loyalty.available_points || 0,
    pending_points: loyalty.pending_points || 0,
    // What the customer asked for vs what they actually get — the two differ
    // whenever the cap or the balance bites, and the UI must say so.
    requested_points: loyalty.requested_points || 0,
    redeemed_points: loyalty.redeemed_points || 0,
    discount: round2(loyalty.discount || 0),
    max_points: loyalty.max_points || 0,
    max_discount: round2(loyalty.max_discount || 0),
    blocked_reason: loyalty.blocked_reason || null,
    estimated_earn_points: loyalty.estimated_earn_points || 0,
    point_value: Number(loyalty.point_value || 0),
    spend_per_point: Number(loyalty.spend_per_point || 0),
    min_redeem_points: Number(loyalty.settings?.min_redeem_points || 0),
    max_redemption_percent: Number(loyalty.settings?.max_redemption_percent || 0),
    currency: loyalty.settings?.currency || 'EGP',
});

/* ------------------------------------------------------------------ */
/*  Daily sweep (called from the app.js cron)                         */
/* ------------------------------------------------------------------ */

// A return that is still open blocks settlement — releasing points on an order
// the customer is actively returning is exactly what the holding period exists
// to prevent.
const TERMINAL_RETURN_STATUSES = ['rejected', 'vendor_rejected', 'cancelled', 'completed'];

/**
 * Phase 1: back-fill pending earns for delivered orders the live hooks missed
 *          (a dropped webhook, a crash between save and hook, a restore).
 * Phase 2: release matured pending earns whose return window has closed and
 *          that carry no open return.
 *
 * Both phases lean entirely on ledger idempotency keys, so running the sweep
 * twice in a row — or alongside a live webhook — changes nothing.
 */
const runLoyaltySweep = async () => {
    const { Order } = require('../models/orders');
    const { ReturnRequest } = require('../models/returnRequests');
    const { notifyCustomer } = require('./customerNotificationService');

    const settings = await getLoyaltySettings();
    if (!settings.enabled) return { created: 0, released: 0, held: 0, reversed: 0, skipped: 'disabled' };

    const now = new Date();
    let created = 0;
    let released = 0;
    let held = 0;
    let reversedCount = 0;

    // --- Phase 1: back-fill missing pending earns ---
    if (settings.earning_enabled) {
        const deliveredFilter = {
            // Delivery is what earns the points; a later return reverses them separately.
            // `partially_cancelled` and `partially_delivered` belong here too. Both can be
            // settled orders that earned something: the first arrived in full minus the
            // parcels that were cancelled, the second minus the ones that went back. Neither
            // is ever stamped `delivered_at` — that is written only on a completed order —
            // which is why this cannot filter on it. `createPendingEarn` applies the real
            // test, refusing anything still in motion and pricing the rest off the parcels
            // that actually arrived.
            status: { $in: [
                ...require('./subOrderService').DELIVERED_ORDER_STATUSES,
                'partially_cancelled',
                'partially_delivered',
            ] },
            'loyalty.earn_points_pending': { $gt: 0 },
        };
        if (settings.activated_at) deliveredFilter.created_at = { $gte: new Date(settings.activated_at) };

        // `sub_orders` is not optional here: the earn is split across the parcels that
        // actually arrived, and without them every order would look like nothing was
        // cancelled and get credited the full checkout estimate.
        const deliveredOrders = await Order.find(deliveredFilter)
            .select('_id user_id paid_by_user_id created_at delivered_at loyalty sub_orders')
            .lean();

        for (const order of deliveredOrders) {
            const exists = await LoyaltyTransaction.exists({
                idempotency_key: `order:${order._id}:earn-pending`,
            });
            if (exists) continue;
            const transaction = await createPendingEarn({ order, settings });
            if (transaction) created += 1;
        }
    }

    // --- Phase 2: release matured pending earns ---
    const matured = await LoyaltyTransaction.find({
        type: 'earn_pending',
        available_at: { $lte: now },
    }).lean();

    for (const pending of matured) {
        const alreadyReleased = await LoyaltyTransaction.exists({
            idempotency_key: `order:${pending.order_id}:earn-release`,
        });
        if (alreadyReleased) continue;

        const order = await Order.findById(pending.order_id)
            .select('user_id paid_by_user_id status loyalty transaction').lean();
        // An order that was cancelled after delivery, or whose goods came back,
        // earns nothing; take the pending points instead of releasing them.
        if (!order || DEAD_EARN_ORDER_STATUSES.includes(order.status)) {
            await reverseEarnedPoints({
                userId: pending.user_id,
                points: pending.points,
                orderId: pending.order_id,
                settings,
                reason: order ? `Order ${order.status} after delivery` : 'Order cancelled after delivery',
                idempotencyKey: `order:${pending.order_id}:earn-reverse-cancel`,
            }).catch((err) => console.error(`[Loyalty] Reverse-on-cancel failed: ${err.message}`));
            continue;
        }

        const openReturn = await ReturnRequest.exists({
            order_id: pending.order_id,
            status: { $nin: TERMINAL_RETURN_STATUSES },
        });
        if (openReturn) {
            // Hold, do not release. The next sweep re-checks; a return that
            // ends in a refund will have reversed these points by then.
            held += 1;
            continue;
        }

        const reversed = toInt(order.loyalty?.earned_points_reversed || 0);
        const remaining = Math.max(0, pending.points - reversed);
        if (remaining <= 0) continue;

        const transaction = await releasePendingEarn({
            pendingTransaction: pending,
            settings,
            remainingPoints: remaining,
        }).catch((err) => {
            console.error(`[Loyalty] Release failed for order ${pending.order_id}: ${err.message}`);
            return null;
        });
        if (!transaction) continue;

        released += 1;
        await require('../models/orders').Order.updateOne(
            { _id: pending.order_id },
            { $set: { 'loyalty.earned_points_released': remaining } }
        );

        notifyCustomer(pending.user_id, 'loyalty_points_available', {
            title_en: 'Your points are ready',
            title_ar: 'نقاطك جاهزة',
            message_en: `${remaining} point${remaining === 1 ? '' : 's'} are now available to use on your next order.`,
            message_ar: `${remaining} نقطة أصبحت متاحة للاستخدام في طلبك القادم.`,
        }, {
            link: '/profile?tab=points',
            data: { points: remaining, order_id: pending.order_id },
        });
    }

    // --- Phase 3: take back earns on orders that turned out to earn nothing ---
    // Phase 2 only ever looks at MATURED rows, so without this an order cancelled
    // or returned the day after delivery would sit there showing pending points
    // for the rest of the return window before anything went back. The live hooks
    // handle the common paths; this catches an order that reached a dead status by
    // a route with no hook on it — a Bosta "returned to business", an admin forcing
    // a parcel to returned, a return settled without a refund row.
    const deadOrders = await Order.find({
        status: { $in: DEAD_EARN_ORDER_STATUSES },
        'loyalty.earn_points_pending': { $gt: 0 },
    }).select('_id user_id paid_by_user_id status loyalty').lean();

    for (const order of deadOrders) {
        const transaction = await reverseOutstandingEarn({
            order,
            settings,
            reason: `Order ${order.status}`,
        }).catch((err) => {
            console.error(`[Loyalty] Reverse-on-dead failed for order ${order._id}: ${err.message}`);
            return null;
        });
        if (transaction) reversedCount += 1;
    }

    console.log(`[Loyalty] Sweep complete. created=${created} released=${released} held=${held} reversed=${reversedCount}`);
    return { created, released, held, reversed: reversedCount };
};

module.exports = {
    // settings
    getLoyaltySettings,
    validateSettingsPatch,
    DEFAULT_LOYALTY_SETTINGS: DEFAULT_SETTINGS,
    // accounts
    getOrCreateAccount,
    getBalances,
    getCustomerWallet,
    getTransactionHistory,
    // pricing
    calculateEarnedPoints,
    computeRedemption,
    toPublicPreview,
    // operations
    applyLedgerEntry,
    reservePoints,
    releaseReservation,
    consumePoints,
    restorePoints,
    reverseEarnedPoints,
    reverseOutstandingEarn,
    createPendingEarn,
    releasePendingEarn,
    runLoyaltySweep,
    adminAdjustPoints,
    // internals reused by the sweep
    round2,
    DEAD_EARN_ORDER_STATUSES,
};
