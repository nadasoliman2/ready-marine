/**
 * Company consolidation batches — feature 14, phase 3.
 *
 * An employee ordering on the company account in "consolidate to office" mode does not
 * send their order to the vendor at once. Each of its parcels (one per vendor branch)
 * waits in the batch for (company office × vendor × branch). The batch closes when it
 * holds `target_count` orders, or when `deadline_at` passes — whichever comes first — and
 * then goes to the vendor as ONE combined parcel.
 *
 * ── Money ─────────────────────────────────────────────────────────────────────────────
 * At checkout the order is charged its FULL standalone shipping (so the employee can never
 * go over their limit). When the batch closes, the combined parcel is priced with the same
 * rules and split between the orders in it: equally, unless an equal share would make any
 * order pay more than it would have alone — then in proportion to what each would have
 * paid alone. Nobody ever pays more than their standalone shipping. The difference goes
 * back to the company at close (off the bill, back onto the limit). Should the combined
 * parcel ever cost more than the orders would separately, the batch does not combine:
 * each order ships on its own at the shipping it was charged.
 *
 * ── The one physical parcel ───────────────────────────────────────────────────────────
 * At close one member becomes the `lead`: its courier delivery carries the whole box, to
 * the office. The others are `rider`s, packed inside it with no delivery of their own. The
 * vendor confirms each order's items separately (each belongs to a different person), and
 * once all are confirmed the lead ships with every member's items. A rider then reads as
 * `in_batch_parcel` and mirrors the lead's status until the lead is delivered or returned,
 * when the rider becomes delivered / returned for real — with its own earnings, loyalty
 * and notification, exactly as if it had travelled alone.
 */

const { Order } = require('../models/orders');
const { Company } = require('../models/companies');
const { CompanyBatch } = require('../models/companyBatches');
const { User } = require('../models/users');
const { Seller } = require('../models/sellers');
const { createNotification } = require('../models/notifications');
const subOrderService = require('./subOrderService');
const shippingEngine = require('./shippingEngine');
const { notifyCustomer } = require('./customerNotificationService');
const {
    companyError,
    round2,
    sameId,
    getCorporateSettings,
    effectiveConsolidation,
} = require('./companyService');

const HOUR = 3600 * 1000;
/** A `closing` batch older than this was interrupted; the sweep finishes it. */
const CLOSING_STALE_MS = 10 * 60 * 1000;
const SYSTEM = { role: 'system', label: 'Company batch' };

/** Statuses of a batch member the vendor has not confirmed yet — the combined parcel waits for them. */
const NOT_CONFIRMED = ['held_in_batch', 'pending_review', 'needs_admin'];

const idOf = (v) => (v?._id || v || '').toString();

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

/** N orders or T hours for this company — the admin's global values or its exception. */
const batchSettingsFor = async (company) => {
    const settings = await getCorporateSettings();
    const eff = effectiveConsolidation(company, settings);
    return {
        target_count: Math.max(2, Math.round(Number(eff.order_count) || 3)),
        wait_hours: Math.max(1, Math.round(Number(eff.wait_hours) || 48)),
    };
};

const vendorDeadlineHours = async () => {
    const settings = await shippingEngine.getSettings().catch(() => null);
    return Number(settings?.vendor_action_deadline_hours ?? 48);
};

/* ------------------------------------------------------------------ */
/* Placement: hold, then join                                          */
/* ------------------------------------------------------------------ */

/**
 * Hold a consolidate-mode order's parcels before the order is written. Parcels from a
 * vendor the person chose to "ship now" at checkout are left alone. Runs after the money
 * is allocated, so each held parcel records the standalone shipping it was charged.
 *
 * @returns {number} how many parcels were held
 */
const holdParcels = (subOrders = [], { shipNowVendorIds = [] } = {}) => {
    const shipNow = new Set((shipNowVendorIds || []).map(String));
    const now = new Date();
    let held = 0;
    for (const sub of subOrders) {
        if (shipNow.has(String(sub.vendor_id))) continue;
        sub.status = 'held_in_batch';
        sub.deadline_at = null;
        sub.company_batch = {
            batch_id: null,
            role: null,
            joined_at: now,
            standalone_shipping: round2(sub.shipping_share || 0),
            savings: 0,
        };
        sub.history = sub.history || [];
        sub.history.push({
            action: 'company_batch_waiting',
            title: 'Waiting in the company batch',
            details: 'Waits for colleagues ordering from the same store, then ships with them as one parcel to the branch.',
            actor_role: 'system',
            actor_label: 'Company batch',
            created_at: now,
        });
        held += 1;
    }
    return held;
};

/** What the vendor's packing labels and the company's screens call this order. */
const memberLabel = (order, userName) => {
    if (order.company?.beneficiary === 'car') return `Company car ${order.company.car_label || ''}`.trim();
    return userName || order.shipping_address?.recipient_name || '';
};

/**
 * Put `member` into the open batch for this route, or open one. A single conditional
 * update joins, so a full batch (or one past its time) is never joined; the unique index
 * on open batches makes two simultaneous openers converge on one batch.
 */
const joinOrOpen = async ({ route, member, settings, officeName }) => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const now = new Date();
        const joined = await CompanyBatch.findOneAndUpdate(
            {
                ...route,
                status: 'open',
                deadline_at: { $gt: now },
                $expr: { $lt: ['$waiting_count', '$target_count'] },
            },
            { $push: { members: member }, $inc: { waiting_count: 1 }, $set: { updated_at: now } },
            { returnDocument: 'after' }
        );
        if (joined) return joined;

        // The join missed. Either the open batch is full or past its time — it is about to
        // be closed by whoever filled it, or by the timer, so close it now and start a fresh
        // one — or a colleague opened a new batch a moment ago, and the next try joins it.
        const current = await CompanyBatch.findOne({ ...route, status: 'open' });
        if (current) {
            const full = current.waiting_count >= current.target_count;
            const late = new Date(current.deadline_at) <= new Date();
            if (full || late) {
                await closeBatch(current._id, full ? 'count' : 'time')
                    .catch((err) => console.error(`[Company batch] Could not close ${current._id}: ${err.message}`));
            }
            continue;
        }

        try {
            return await CompanyBatch.create({
                ...route,
                office_name: officeName || '',
                status: 'open',
                target_count: settings.target_count,
                wait_hours: settings.wait_hours,
                opened_at: now,
                deadline_at: new Date(now.getTime() + settings.wait_hours * HOUR),
                waiting_count: 1,
                members: [member],
            });
        } catch (err) {
            if (err.code === 11000) continue; // someone opened it a moment ago — join theirs
            throw err;
        }
    }
    throw new Error('Could not place the order in a company batch');
};

/**
 * Join every held parcel of a just-placed order to its batch, closing any batch it fills.
 * Safe to repeat: parcels that already have a batch are skipped.
 *
 * @returns {{ joined: number, closed: string[] }}
 */
const joinBatchesForOrder = async (orderId) => {
    const order = await Order.findById(idOf(orderId));
    if (!order?.company) return { joined: 0, closed: [] };
    const held = (order.sub_orders || []).filter((s) => s.status === 'held_in_batch' && !s.company_batch?.batch_id && !s.company_batch?.left_at);
    if (held.length === 0) return { joined: 0, closed: [] };

    const company = await Company.findById(order.company.company_id).lean();
    if (!company) return { joined: 0, closed: [] };
    const settings = await batchSettingsFor(company);
    const user = await User.findById(order.user_id).select('name').lean();

    const closed = [];
    let joined = 0;
    for (const sub of held) {
        const route = {
            company_id: company._id,
            office_id: order.company.office_id,
            vendor_id: sub.vendor_id,
            fulfillment_location: sub.fulfillment_location || '',
        };
        const member = {
            order_id: order._id,
            sub_order_id: sub._id,
            user_id: order.user_id,
            display_name: memberLabel(order, user?.name),
            order_reference: sub.reference || order.transaction?.reference || '',
            beneficiary: order.company.beneficiary,
            joined_at: sub.company_batch?.joined_at || new Date(),
            status: 'waiting',
            standalone_shipping: round2(sub.company_batch?.standalone_shipping ?? sub.shipping_share ?? 0),
        };
        const batch = await joinOrOpen({ route, member, settings, officeName: order.company.office_name });
        await Order.updateOne(
            { _id: order._id, 'sub_orders._id': sub._id },
            { $set: { 'sub_orders.$.company_batch.batch_id': batch._id } }
        );
        joined += 1;
        if (batch.waiting_count >= batch.target_count) {
            const done = await closeBatch(batch._id, 'count')
                .catch((err) => { console.error(`[Company batch] Close failed for ${batch._id}: ${err.message}`); return null; });
            if (done) closed.push(String(batch._id));
        }
    }
    return { joined, closed };
};

/* ------------------------------------------------------------------ */
/* Closing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Close an open batch. Only one caller wins the `open → closing` claim; the rest return
 * null. The claim-then-process shape means a crash leaves the batch in `closing`, and the
 * sweep picks it up and finishes it — every step below is safe to repeat.
 */
const closeBatch = async (batchId, reason = 'time', actor = SYSTEM) => {
    const batch = await CompanyBatch.findOneAndUpdate(
        { _id: batchId, status: 'open' },
        { $set: { status: 'closing', closing_started_at: new Date(), close_reason: reason, updated_at: new Date() } },
        { returnDocument: 'after' }
    );
    if (!batch) return null;
    return finishClosing(batch, actor);
};

/** Load each member's order and parcel. `known` lets a caller pass an order it already holds. */
const loadMembers = async (batch, { statuses = null, known = null } = {}) => {
    const members = (batch.members || []).filter((m) => !statuses || statuses.includes(m.status));
    const ids = [...new Set(members.map((m) => String(m.order_id)))].filter((id) => !known || id !== String(known._id));
    const orders = ids.length ? await Order.find({ _id: { $in: ids } }) : [];
    const byId = new Map(orders.map((o) => [String(o._id), o]));
    if (known) byId.set(String(known._id), known);
    return members.map((member) => {
        const order = byId.get(String(member.order_id)) || null;
        const sub = order ? subOrderService.findSubOrder(order, member.sub_order_id) : null;
        return { member, order, sub };
    });
};

/**
 * The combined parcel's shipping, priced with the first member's frozen rules (every
 * member ordered to the same office). Falls back to "no saving" when it cannot be priced:
 * a wrong saving is money we would have to take back, and that promise is never broken.
 */
const priceCombinedParcel = async (entries) => {
    const standaloneTotal = round2(entries.reduce((s, e) => s + Number(e.member.standalone_shipping || 0), 0));
    try {
        const items = entries.flatMap((e) => subOrderService.subOrderItems(e.order, e.sub));
        const quoted = await shippingEngine.quoteAgainstSnapshot(entries[0].order.shipping, items);
        if (quoted === null || !Number.isFinite(quoted)) return standaloneTotal;
        return round2(Math.max(0, quoted));
    } catch (err) {
        console.error(`[Company batch] Could not price a combined parcel: ${err.message}`);
        return standaloneTotal;
    }
};

/**
 * Split the combined parcel's shipping between its orders.
 *
 *   equal         the rule — split evenly, even when the batch closed short of N
 *   proportional  when an even split would make any order pay more than it would alone:
 *                 each pays in proportion to its standalone shipping, so the order that
 *                 made the parcel heavy carries the difference it caused
 *   single        only one order: it pays its full standalone shipping
 *   separate      the combined parcel would cost more than the orders sent one by one:
 *                 nothing is combined, each ships alone at its standalone shipping
 *
 * Every share is capped at that order's standalone shipping.
 */
const splitParcelShipping = (parcelCost, standalones) => {
    const n = standalones.length;
    if (n <= 1) return { mode: 'single', shares: standalones.map((s) => round2(s)) };
    const toMinor = subOrderService.toMinor;
    const parcelMinor = toMinor(parcelCost);
    const standaloneMinor = standalones.map(toMinor);
    if (parcelMinor > standaloneMinor.reduce((sum, v) => sum + v, 0)) {
        return { mode: 'separate', shares: standalones.map((s) => round2(s)) };
    }

    let mode = 'equal';
    let shares = subOrderService.allocateExact(parcelMinor, standalones.map(() => 1));
    if (shares.some((share, i) => share > standaloneMinor[i])) {
        mode = 'proportional';
        shares = subOrderService.allocateExact(parcelMinor, standaloneMinor);
    }
    shares = shares.map((share, i) => Math.min(share, standaloneMinor[i]));
    return { mode, shares: shares.map(subOrderService.toMajor) };
};

/** Lower an order's figures by the shipping it saved on one parcel. The caller saves. */
const applySavingsToOrder = (order, sub, savings, back) => {
    const value = round2(savings);
    sub.shipping_share = round2(Number(sub.shipping_share || 0) - value);
    sub.cod_amount = round2(Math.max(0, Number(sub.cod_amount || 0) - value));
    sub.company_batch.savings = round2(Number(sub.company_batch.savings || 0) + value);

    order.total_price = round2(Number(order.total_price || 0) - value);
    if (order.transaction) order.transaction.amount = round2(Number(order.transaction.amount || 0) - value);
    if (order.shipping) {
        order.shipping.total_cost = round2(Math.max(0, Number(order.shipping.total_cost || 0) - value));
        const leg = (order.shipping.per_vendor || []).find((pv) => sameId(pv.vendor_id, sub.vendor_id));
        if (leg) leg.cost = round2(Math.max(0, Number(leg.cost || 0) - value));
        // A line of its own, so the order's shipping breakdown still adds up to its total.
        order.shipping.adjustments = [
            ...(order.shipping.adjustments || []),
            { source: 'company_batch', label: 'Company batch saving', amount: -value },
        ];
        order.markModified('shipping');
        shippingEngine.assignVendorShippingCosts(order);
    }
    order.company.company_amount = round2(Number(order.company.company_amount || 0) - back.company);
    order.company.personal_amount = round2(Number(order.company.personal_amount || 0) - back.personal);
    order.company.shipping_savings = round2(Number(order.company.shipping_savings || 0) + value);

    order.history = order.history || [];
    order.history.push({
        action: 'company_batch_savings',
        title: 'Shipping saved by the company batch',
        details: `${value.toFixed(2)} of shipping given back${back.personal > 0 ? ` (${back.personal.toFixed(2)} to the wallet)` : ''}.`,
        actor_role: 'system',
        actor_label: 'Company batch',
        metadata: { sub_order_id: sub._id, savings: value, to_company: back.company, to_wallet: back.personal },
        created_at: new Date(),
    });
};

/** Hand a waiting parcel to the vendor, with or without a batch around it. The caller saves. */
const releaseParcel = (order, sub, { role = null, lead = null, deadlineHours = 48, details = '' } = {}) => {
    const now = new Date();
    sub.status = 'pending_review';
    sub.deadline_at = new Date(now.getTime() + Number(deadlineHours || 48) * HOUR);
    sub.company_batch.role = role;
    sub.company_batch.released_at = now;
    if (lead) {
        sub.company_batch.lead_order_id = lead.order_id;
        sub.company_batch.lead_sub_order_id = lead.sub_order_id;
        sub.company_batch.lead_reference = lead.reference || '';
    }
    subOrderService.appendSubHistory(
        sub,
        'company_batch_released',
        role ? 'Sent to the store with the company batch' : 'Sent to the store',
        details,
        { role, batch_id: sub.company_batch.batch_id || null },
        SYSTEM
    );
    subOrderService.syncOrderStatus(order, 'Company batch');
};

/**
 * Price, split, give back the savings, and release every waiting order to the vendor.
 * Re-entrant: the split is written to the batch before any money moves, and a member
 * whose parcel was already released by an interrupted run is left as it is.
 */
const finishClosing = async (batch, actor = SYSTEM) => {
    const entries = await loadMembers(batch, { statuses: ['waiting', 'released'] });

    // A member whose parcel was cancelled while it waited, but whose "left" mark never
    // landed (an interrupted cancellation), is out.
    for (const e of entries) {
        if (e.member.status === 'waiting' && (!e.sub || e.sub.status === 'cancelled' || e.sub.company_batch?.left_at)) {
            e.member.status = 'left';
            e.member.left_reason = e.sub?.company_batch?.left_reason || 'cancelled';
            e.member.left_at = new Date();
        }
    }
    const live = entries
        .filter((e) => e.member.status !== 'left' && e.sub)
        .sort((a, b) => new Date(a.member.joined_at) - new Date(b.member.joined_at));

    if (live.length === 0) {
        batch.status = 'cancelled';
        batch.waiting_count = 0;
        batch.closed_at = new Date();
        await batch.save();
        return batch;
    }

    // ---- 1. The split, written down before any money moves ----
    if (batch.parcel_shipping === null || batch.parcel_shipping === undefined) {
        const standalones = live.map((e) => round2(e.member.standalone_shipping || 0));
        const parcel = live.length === 1 ? standalones[0] : await priceCombinedParcel(live);
        const { mode, shares } = splitParcelShipping(parcel, standalones);
        live.forEach((e, i) => {
            e.member.share = shares[i];
            e.member.savings = round2(Math.max(0, standalones[i] - shares[i]));
        });
        batch.parcel_shipping = parcel;
        batch.split_mode = mode;
        batch.lead = mode === 'separate' ? null : { order_id: live[0].order._id, sub_order_id: live[0].sub._id };
        batch.markModified('members');
        await batch.save();
    }

    // Separate: combining would have cost more, so every order travels as if it were alone.
    const separate = batch.split_mode === 'separate';
    const single = live.length === 1 || separate;
    const lead = single ? null : {
        order_id: batch.lead.order_id,
        sub_order_id: batch.lead.sub_order_id,
        reference: live.find((e) => sameId(e.sub._id, batch.lead.sub_order_id))?.member.order_reference || '',
    };
    const deadlineHours = await vendorDeadlineHours();

    // ---- 2. Each order: savings back, figures lowered, parcel released ----
    const companyOrderService = require('./companyOrderService');
    const released = [];
    for (const e of live) {
        const { order, sub, member } = e;
        if (sub.status !== 'held_in_batch') {
            member.status = 'released';
            member.released_at = member.released_at || sub.company_batch?.released_at || new Date();
            continue;
        }
        const savings = round2(member.savings || 0);
        if (savings > 0) {
            const back = await companyOrderService.returnBatchSavings({
                order,
                amount: savings,
                key: `batch:${batch._id}:${sub._id}:savings`,
                subOrderId: sub._id,
                batchId: batch._id,
                actor,
            });
            applySavingsToOrder(order, sub, savings, back);
        }
        const isLead = !single && sameId(sub._id, lead.sub_order_id);
        releaseParcel(order, sub, {
            role: single ? null : (isLead ? 'lead' : 'rider'),
            lead: single ? null : lead,
            deadlineHours,
            details: separate
                ? 'Shipping the batch as one parcel would have cost more than sending each order separately, so this one ships on its own.'
                : single
                ? 'The batch closed with this order alone, so it ships on its own.'
                : `One combined parcel of ${live.length} orders for the branch${savings > 0 ? ` — ${savings.toFixed(2)} of shipping saved` : ''}.`,
        });
        await order.save();
        member.status = 'released';
        member.released_at = new Date();
        released.push(e);
    }

    batch.status = 'closed';
    batch.waiting_count = 0;
    batch.closed_at = batch.closed_at || new Date();
    batch.markModified('members');
    await batch.save();

    // ---- 3. Tell the store once, and each person what they saved ----
    if (released.length > 0) {
        if (separate) {
            await Promise.all(released.map((e) => notifyVendorOfBatch(batch, [e]).catch(() => {})));
        } else {
            await notifyVendorOfBatch(batch, live).catch(() => {});
        }
        await Promise.all(released.map((e) => notifyMemberReleased(batch, e, separate ? 1 : live.length).catch(() => {})));
    }
    return batch;
};

const notifyVendorOfBatch = async (batch, live) => {
    const company = await Company.findById(batch.company_id).select('name').lean();
    const combined = live.length > 1;
    await createNotification(
        batch.vendor_id,
        combined ? 'company_batch_received' : 'new_order_received',
        combined ? 'New combined company order' : 'New order received',
        combined
            ? `${live.length} orders for ${company?.name || 'a company'} (${batch.office_name || 'office'}) — review each one, pack each person's items separately with their label, then put them all in ONE parcel.`
            : `Order #${live[0].member.order_reference} is waiting for your review.`,
        {
            batch_id: batch._id,
            order_id: combined ? batch.lead?.order_id || live[0].order._id : live[0].order._id,
            sub_order_id: combined ? batch.lead?.sub_order_id || live[0].sub._id : live[0].sub._id,
            order_count: live.length,
        }
    );

    const { sendNewOrderWhatsapp, sendVendorOrderWhatsapp, vendorParcelPath } = require('./notificationService');
    if (!combined) {
        sendNewOrderWhatsapp({ vendorId: batch.vendor_id, order: live[0].order, subOrders: [live[0].sub] });
        return;
    }
    // The lead parcel's page is where the vendor works the whole combined order from.
    sendVendorOrderWhatsapp({
        vendorId: batch.vendor_id,
        headline: `وصلك أوردر مجمّع جديد على Ready Marine: ${live.length} أوردرات${company?.name ? ` لشركة ${company.name}` : ''}`,
        detail: 'راجع كل أوردر وجهّز حاجة كل شخص لوحده بالملصق بتاعه، وبعدين حطّهم كلهم في طرد واحد',
        path: vendorParcelPath(batch.lead?.order_id || live[0].order._id, batch.lead?.sub_order_id || live[0].sub._id),
        campaignName: `Vendor combined order — batch ${batch._id}`,
    });
};

const notifyMemberReleased = async (batch, entry, count) => {
    const savings = round2(entry.member.savings || 0);
    const alone = count <= 1;
    await notifyCustomer(entry.order.user_id, 'company_batch_released', {
        title_en: alone ? 'Your order is on its way to the store' : `Your order joined a combined parcel of ${count}`,
        title_ar: alone ? 'أوردرك اتبعت للمورد' : `أوردرك اتجمّع في طرد واحد مع ${count - 1} من زمايلك`,
        message_en: savings > 0
            ? `You saved ${savings.toFixed(2)} on shipping — it went back to your limit or wallet.`
            : 'It now goes to the store for preparation.',
        message_ar: savings > 0
            ? `وفّرت ${savings.toFixed(2)} ج في الشحن — رجعوا لليميت أو لمحفظتك.`
            : 'دلوقتي بيتجهز عند المورد.',
    }, {
        link: `/profile?tab=orders&order=${entry.order._id}`,
        data: { order_id: entry.order._id, sub_order_id: entry.sub._id, batch_id: batch._id, savings },
    });
};

/* ------------------------------------------------------------------ */
/* Leaving before the close                                            */
/* ------------------------------------------------------------------ */

/**
 * Take a waiting parcel out of its batch (cancelled, or "ship it now"). Refuses while the
 * batch is being closed — the parcel is being released at that very moment. Marks the
 * parcel in memory; the caller saves.
 */
const leaveBatch = async (order, sub, reason = 'cancelled') => {
    if (sub.status !== 'held_in_batch') return { left: false };
    const batchId = sub.company_batch?.batch_id;
    const now = new Date();
    if (batchId) {
        const res = await CompanyBatch.findOneAndUpdate(
            { _id: batchId, status: 'open', members: { $elemMatch: { sub_order_id: sub._id, status: 'waiting' } } },
            {
                $set: {
                    'members.$.status': 'left',
                    'members.$.left_reason': reason,
                    'members.$.left_at': now,
                    updated_at: now,
                },
                $inc: { waiting_count: -1 },
            },
            { returnDocument: 'after' }
        );
        if (!res) {
            const current = await CompanyBatch.findById(batchId).select('status').lean();
            if (current?.status === 'closing') {
                throw companyError('BATCH_CLOSING', 'This batch is closing right now — try again in a minute', 409);
            }
        } else if (res.waiting_count <= 0) {
            // Nobody left waiting: retire it, so the next order starts a fresh batch with a
            // fresh deadline rather than inheriting this one's.
            await CompanyBatch.updateOne(
                { _id: batchId, status: 'open', waiting_count: { $lte: 0 } },
                { $set: { status: 'cancelled', closed_at: now, updated_at: now } }
            );
        }
    }
    sub.company_batch.left_at = now;
    sub.company_batch.left_reason = reason;
    return { left: true };
};

/**
 * "Ship it now": the person takes one waiting parcel out of its batch and sends it on its
 * own, at the full shipping already paid. Allowed to whoever placed the order.
 */
const shipNow = async (userId, orderId, subOrderId) => {
    const order = await Order.findById(orderId);
    if (!order || !order.company || !sameId(order.user_id, userId)) {
        throw companyError('ORDER_NOT_FOUND', 'Order not found', 404);
    }
    const sub = subOrderService.findSubOrder(order, subOrderId);
    if (!sub) throw companyError('SUB_ORDER_NOT_FOUND', 'Parcel not found', 404);
    if (sub.status !== 'held_in_batch') {
        throw companyError('NOT_WAITING', 'This order is no longer waiting in a batch', 409);
    }

    await leaveBatch(order, sub, 'ship_now');
    releaseParcel(order, sub, {
        deadlineHours: await vendorDeadlineHours(),
        details: 'Taken out of the company batch by the customer and sent on its own, at full shipping.',
    });
    await order.save();

    await createNotification(
        sub.vendor_id,
        'new_order_received',
        'New Order Received',
        `Order #${sub.reference || order.transaction?.reference || order._id} is waiting for your review.`,
        { order_id: order._id, sub_order_id: sub._id }
    ).catch(() => {});
    require('./notificationService').sendNewOrderWhatsapp({ vendorId: sub.vendor_id, order, subOrders: [sub] });
    return { order, sub };
};

/* ------------------------------------------------------------------ */
/* Leaving after the close                                             */
/* ------------------------------------------------------------------ */

/**
 * A released member was cancelled before the combined parcel shipped (the store had run
 * out, the website team cancelled it). The others keep the share they were promised; the
 * company absorbs whatever the smaller parcel costs above those shares. If it was the
 * lead, the next member takes over.
 */
const onReleasedMemberCancelled = async (order, sub, actor = SYSTEM) => {
    const batchId = sub.company_batch?.batch_id;
    if (!batchId || !sub.company_batch?.role) return null;
    const batch = await CompanyBatch.findById(batchId);
    if (!batch || batch.status !== 'closed') return null;

    const member = (batch.members || []).find((m) => sameId(m.sub_order_id, sub._id));
    if (!member || member.dropped_at) return null;
    member.dropped_at = new Date();
    batch.markModified('members');

    const entries = (await loadMembers(batch, { statuses: ['released'], known: order }))
        .filter((e) => !e.member.dropped_at && e.sub && e.sub.status !== 'cancelled')
        .sort((a, b) => new Date(a.member.joined_at) - new Date(b.member.joined_at));

    if (entries.length === 0) {
        batch.finished_at = batch.finished_at || new Date();
        await batch.save();
        return batch;
    }

    // ---- A new lead, when the lead left before the parcel shipped ----
    if (sameId(batch.lead?.sub_order_id, sub._id) && !batch.dispatched_at) {
        const next = entries[0];
        const alone = entries.length === 1;
        batch.lead = { order_id: next.order._id, sub_order_id: next.sub._id };
        for (const e of entries) {
            const isLead = sameId(e.sub._id, next.sub._id);
            e.sub.company_batch.role = alone ? null : (isLead ? 'lead' : 'rider');
            e.sub.company_batch.lead_order_id = alone ? null : next.order._id;
            e.sub.company_batch.lead_sub_order_id = alone ? null : next.sub._id;
            e.sub.company_batch.lead_reference = alone ? '' : next.member.order_reference;
            subOrderService.appendSubHistory(
                e.sub, 'company_batch_lead_changed',
                alone ? 'Ships on its own now' : (isLead ? 'Now carries the combined parcel' : 'Combined parcel moved to another order'),
                alone
                    ? 'Every other order left the combined parcel, so this one ships alone.'
                    : `The combined parcel now ships on order ${next.member.order_reference}.`,
                {}, actor
            );
            if (!sameId(e.order._id, order._id)) await e.order.save();
        }
    }

    // ---- The company covers the smaller parcel's shortfall ----
    const promised = round2(entries.reduce((s, e) => s + Number(e.member.share ?? e.member.standalone_shipping ?? 0), 0));
    const newCost = entries.length === 1
        ? round2(entries[0].member.standalone_shipping || 0)
        : await priceCombinedParcel(entries);
    const gap = round2(Math.max(0, newCost - promised) - Number(batch.company_absorbed || 0));
    if (gap > 0) {
        const companyOrderService = require('./companyOrderService');
        const leadEntry = entries.find((e) => sameId(e.sub._id, batch.lead?.sub_order_id)) || entries[0];
        const res = await companyOrderService.absorbShippingDifference({
            order: leadEntry.order,
            amount: gap,
            key: `batch:${batch._id}:absorb:${sub._id}`,
            batchId: batch._id,
            actor,
        });
        if (!res.duplicate) batch.company_absorbed = round2(Number(batch.company_absorbed || 0) + gap);
    }
    batch.parcel_shipping = newCost;
    await batch.save();

    // The order that left may have been the last one the store still had to confirm.
    await onMemberConfirmed(batch._id, actor).catch(() => {});
    return batch;
};

/* ------------------------------------------------------------------ */
/* The vendor's side: confirm each, ship once                          */
/* ------------------------------------------------------------------ */

/** Released members still part of the parcel, with their orders. */
const liveEntries = async (batch, known = null) =>
    (await loadMembers(batch, { statuses: ['released'], known }))
        .filter((e) => !e.member.dropped_at && e.sub && e.sub.status !== 'cancelled')
        .sort((a, b) => new Date(a.member.joined_at) - new Date(b.member.joined_at));

/**
 * What the lead's courier delivery needs to carry the whole box. Called from inside the
 * dispatch itself, so no path — vendor, admin, bulk send — can ship a batch member alone.
 *
 * @returns {null|object} null for an ordinary parcel
 * @throws a rider (it ships inside the lead), or a lead whose colleagues are not all confirmed
 */
const dispatchOptionsFor = async (order, sub) => {
    if (sub.status === 'held_in_batch') {
        throw companyError('BATCH_WAITING', 'This order is still waiting in its company batch', 409);
    }
    const role = sub.company_batch?.role;
    if (role === 'rider') {
        throw companyError(
            'RIDES_IN_BATCH',
            `This order ships inside the combined parcel of order ${sub.company_batch.lead_reference || ''} — prepare that one`.replace(/\s+—/, ' —'),
            409
        );
    }
    if (role !== 'lead') return null;

    const batch = await CompanyBatch.findById(sub.company_batch.batch_id);
    if (!batch) throw companyError('BATCH_NOT_FOUND', 'The company batch for this parcel was not found', 404);
    const entries = await liveEntries(batch, order);
    const pending = entries.filter((e) => NOT_CONFIRMED.includes(e.sub.status));
    if (pending.length > 0) {
        throw companyError(
            'BATCH_NOT_READY',
            `${pending.length} of the ${entries.length} orders in this combined parcel still need to be confirmed`,
            409
        );
    }

    const company = await Company.findById(batch.company_id).lean();
    const office = (company?.offices || []).find((o) => sameId(o._id, batch.office_id) && o.active !== false) || null;
    const items = entries.flatMap((e) => subOrderService.shippableItems(e.order, e.sub));
    if (items.length === 0) throw companyError('EMPTY_PARCEL', 'This combined parcel has no confirmed items to ship', 409);

    const references = entries.map((e) => e.member.order_reference).filter(Boolean);
    return {
        batch_id: batch._id,
        items,
        member_count: entries.length,
        recipient_name: office?.recipient_name || order.shipping_address?.recipient_name || '',
        phone: office?.phone || order.shipping_address?.phone || '',
        address: office ? `${company.name} — ${office.name}: ${office.full_address}` : (order.shipping_address?.full_address || ''),
        city: office?.shipping_city || order.shipping?.destination?.city || '',
        notes: `Company combined parcel — ${entries.length} orders (${references.join(', ')}) for ${company?.name || 'company'}${office ? `, ${office.name}` : ''}. Each person's items are packed and labelled separately inside.`,
        charged_to_customers: round2(entries.reduce((s, e) => s + Number(e.sub.shipping_share || 0), 0)),
    };
};

/** Stamp the lead as shipped. Called by the dispatch, on the document it is about to save. */
const markLeadDispatched = async (sub, options) => {
    if (!options?.batch_id || sub.company_batch?.role !== 'lead') return;
    sub.company_batch.dispatched_at = new Date();
    await CompanyBatch.updateOne(
        { _id: options.batch_id },
        { $set: { dispatched_at: sub.company_batch.dispatched_at, updated_at: new Date() } }
    ).catch((err) => console.error(`[Company batch] Could not stamp dispatch on ${options.batch_id}: ${err.message}`));
};

/**
 * A member's items were confirmed. When that was the last one, and the store prints
 * waybills (Smart Label off), the combined shipment is created right away on the lead —
 * exactly what confirming does for an ordinary parcel. With Smart Label on the vendor scans
 * the sticker on the combined parcel instead.
 *
 * @returns {{ ready: boolean, dispatched: boolean, pending: number, total: number }}
 */
const onMemberConfirmed = async (batchId, actor = SYSTEM) => {
    const batch = await CompanyBatch.findById(batchId);
    if (!batch || batch.status !== 'closed' || batch.dispatched_at) {
        return { ready: false, dispatched: !!batch?.dispatched_at, pending: 0, total: 0 };
    }
    const entries = await liveEntries(batch);
    const pending = entries.filter((e) => NOT_CONFIRMED.includes(e.sub.status)).length;
    if (pending > 0) return { ready: false, dispatched: false, pending, total: entries.length };

    const leadEntry = entries.find((e) => sameId(e.sub._id, batch.lead?.sub_order_id));
    if (!leadEntry || leadEntry.sub.company_batch?.role !== 'lead') {
        return { ready: true, dispatched: false, pending: 0, total: entries.length };
    }
    const { order, sub } = leadEntry;
    if (sub.status !== 'awaiting_tracking' || sub.tracking_number || sub.bosta_tracking_number) {
        return { ready: true, dispatched: false, pending: 0, total: entries.length };
    }

    const couriers = require('./couriers');
    const smartLabelService = require('./smartLabelService');
    const provider = await couriers.courierFor(sub);
    const smartLabel = couriers.smartLabelApplies(provider, await smartLabelService.isEnabled().catch(() => false));
    if (smartLabel) return { ready: true, dispatched: false, pending: 0, total: entries.length };

    try {
        await require('./bostaFulfillmentService').dispatchSubOrder(order, sub, { actor });
        sub.tracking_assigned_at = new Date();
        subOrderService.appendSubHistory(
            sub, 'company_batch_shipment_created', 'Combined shipment created',
            `Every order is confirmed — one shipment for all ${entries.length}. Print the waybill and stick it on the combined parcel.`,
            { tracking_number: sub.tracking_number, member_count: entries.length }, actor
        );
        subOrderService.syncOrderStatus(order, actor.label || 'System');
        await order.save();
        return { ready: true, dispatched: true, pending: 0, total: entries.length };
    } catch (err) {
        subOrderService.appendSubHistory(
            sub, 'sub_order_dispatch_failed', 'Could not create the combined shipment', err.message, { error: err.message }, actor
        );
        await order.save().catch(() => {});
        console.error(`[Company batch] Combined shipment failed for batch ${batchId}: ${err.message}`);
        return { ready: true, dispatched: false, pending: 0, total: entries.length, error: err.message };
    }
};

/* ------------------------------------------------------------------ */
/* Riders follow the lead                                              */
/* ------------------------------------------------------------------ */

const RIDER_COPIED_STAMPS = ['tracking_assigned_at', 'ready_at', 'handed_over_at', 'handed_over_by_label', 'pickup_booked_at'];

/**
 * Bring every rider level with its lead. Delivered and returned are made real on the
 * rider (with its own earnings, loyalty and notification); anything before that is
 * mirrored. Runs one at a time per batch in this process: a second request while one is
 * running is folded into a re-run.
 */
const running = new Map();
const syncBatchRiders = (batchId) => {
    const key = String(batchId);
    const current = running.get(key);
    if (current) {
        current.again = true;
        return current.promise;
    }
    const state = { again: false, promise: null };
    state.promise = (async () => {
        try {
            do {
                state.again = false;
                await syncOnce(key);
            } while (state.again);
        } finally {
            running.delete(key);
        }
    })();
    running.set(key, state);
    return state.promise;
};

const syncOnce = async (batchId) => {
    const batch = await CompanyBatch.findById(batchId);
    if (!batch?.lead?.order_id) return;
    const leadOrder = await Order.findById(batch.lead.order_id);
    const lead = leadOrder ? subOrderService.findSubOrder(leadOrder, batch.lead.sub_order_id) : null;
    if (!lead?.company_batch?.dispatched_at) return;

    const leadStatus = lead.status;
    const sweep = require('./subOrderSweepService');
    const orderService = require('./orderService');

    const riders = (await liveEntries(batch, leadOrder)).filter((e) => !sameId(e.sub._id, lead._id));
    for (const { order, sub } of riders) {
        if (sub.company_batch?.role !== 'rider') continue;
        if (['delivered', 'returned'].includes(sub.status)) continue;

        let target = 'in_batch_parcel';
        if (leadStatus === 'delivered') target = 'delivered';
        else if (leadStatus === 'returned') target = 'returned';
        else if (leadStatus === 'cancelled') target = 'needs_admin';

        const before = subOrderService.effectiveStatus(sub);
        if (sub.status === target && (target !== 'in_batch_parcel' || sub.company_batch.mirror_status === leadStatus)) continue;

        sub.status = target;
        sub.company_batch.mirror_status = leadStatus;
        sub.tracking_number = lead.tracking_number || sub.tracking_number;
        sub.courier = lead.courier || sub.courier;
        sub.is_overdue = false;
        for (const stamp of RIDER_COPIED_STAMPS) if (lead[stamp] && !sub[stamp]) sub[stamp] = lead[stamp];
        if (target === 'delivered') sub.delivered_at = lead.delivered_at || new Date();
        if (target === 'needs_admin') {
            sub.needs_admin_since = new Date();
            sub.needs_admin_reason = `The combined parcel (order ${sub.company_batch.lead_reference || ''}) was cancelled — decide what happens to this order`;
        }
        subOrderService.freezeAllocation(order, SYSTEM);
        subOrderService.appendSubHistory(
            sub, 'company_batch_rider_moved',
            target === 'delivered' ? 'Delivered with the combined parcel' : 'Moved with the combined parcel',
            `The combined parcel (order ${sub.company_batch.lead_reference || ''}) is now "${leadStatus}".`,
            { lead_status: leadStatus }, SYSTEM
        );
        subOrderService.syncOrderStatus(order, 'Company batch');
        await order.save();

        const after = subOrderService.effectiveStatus(sub);
        if (target === 'delivered') {
            await orderService.onSubOrderDelivered(order, sub)
                .catch((err) => console.error(`[Company batch] Delivery hook failed for ${sub._id}: ${err.message}`));
            await sweep.notifyParcelDelivered(order, sub);
        } else if (after === 'out_for_delivery' && before !== 'out_for_delivery') {
            await sweep.notifyOutForDelivery(order, sub);
        }
    }

    await Order.updateOne(
        { _id: leadOrder._id, 'sub_orders._id': lead._id },
        { $set: { 'sub_orders.$.company_batch.mirror_status': leadStatus } }
    );
    if (['delivered', 'returned', 'cancelled'].includes(leadStatus) && !batch.finished_at) {
        await CompanyBatch.updateOne({ _id: batch._id }, { $set: { finished_at: new Date(), updated_at: new Date() } });
    }
};

/** Called by the Order post-save hook when a lead parcel moved. */
const syncRidersOfLeadOrder = async (orderId) => {
    const order = await Order.findById(orderId).select('sub_orders').lean();
    const leads = (order?.sub_orders || []).filter((s) => s.company_batch?.role === 'lead' && s.company_batch.dispatched_at);
    for (const lead of leads) await syncBatchRiders(lead.company_batch.batch_id);
};

/* ------------------------------------------------------------------ */
/* The sweep                                                           */
/* ------------------------------------------------------------------ */

/**
 * Every few minutes: close batches whose time is up, finish interrupted closes, join
 * orders whose join failed, and bring riders level with their leads.
 */
const runBatchSweep = async () => {
    const now = new Date();
    const result = { closed: 0, recovered: 0, joined: 0, released: 0, synced: 0 };

    const due = await CompanyBatch.find({ status: 'open', deadline_at: { $lte: now } }).select('_id').lean();
    for (const b of due) {
        const done = await closeBatch(b._id, 'time').catch((err) => {
            console.error(`[Company batch] Timed close failed for ${b._id}: ${err.message}`);
            return null;
        });
        if (done) result.closed += 1;
    }

    const stuck = await CompanyBatch.find({ status: 'closing', closing_started_at: { $lte: new Date(now.getTime() - CLOSING_STALE_MS) } });
    for (const batch of stuck) {
        await finishClosing(batch).then(() => { result.recovered += 1; })
            .catch((err) => console.error(`[Company batch] Could not finish closing ${batch._id}: ${err.message}`));
    }

    const orphanCutoff = new Date(now.getTime() - 2 * 60 * 1000);
    const orphans = await Order.find({
        created_at: { $lte: orphanCutoff },
        sub_orders: { $elemMatch: { status: 'held_in_batch', 'company_batch.batch_id': null, 'company_batch.left_at': null } },
    }).select('_id').lean();
    for (const o of orphans) {
        const r = await joinBatchesForOrder(o._id).catch((err) => {
            console.error(`[Company batch] Late join failed for order ${o._id}: ${err.message}`);
            return { joined: 0 };
        });
        result.joined += r.joined || 0;
    }

    // A parcel that left its batch but never finished leaving (an interrupted cancel or
    // "ship now") would wait forever. After a few minutes it goes on alone.
    const stranded = await Order.find({
        sub_orders: { $elemMatch: { status: 'held_in_batch', 'company_batch.left_at': { $lte: new Date(now.getTime() - CLOSING_STALE_MS) } } },
    });
    const deadlineHours = await vendorDeadlineHours();
    for (const order of stranded) {
        for (const sub of order.sub_orders) {
            if (sub.status !== 'held_in_batch' || !sub.company_batch?.left_at) continue;
            releaseParcel(order, sub, { deadlineHours, details: 'Left its company batch; sent on its own.' });
            result.released += 1;
        }
        await order.save().catch((err) => console.error(`[Company batch] Could not release order ${order._id}: ${err.message}`));
    }

    const moving = await CompanyBatch.find({ status: 'closed', dispatched_at: { $ne: null }, finished_at: null }).select('_id').lean();
    for (const b of moving) {
        await syncBatchRiders(b._id).then(() => { result.synced += 1; })
            .catch((err) => console.error(`[Company batch] Rider sync failed for ${b._id}: ${err.message}`));
    }
    return result;
};

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/** The route's open batch, for checkout: how many are waiting and until when. */
const openBatchFor = async ({ companyId, officeId, vendorId, location = '' }) =>
    CompanyBatch.findOne({
        company_id: companyId,
        office_id: officeId,
        vendor_id: vendorId,
        fulfillment_location: location || '',
        status: 'open',
        deadline_at: { $gt: new Date() },
    }).select('waiting_count target_count deadline_at opened_at').lean();

/**
 * What checkout shows for each parcel in consolidate mode: the batch it would join (or
 * that it would open one), and roughly what it could save if the batch fills.
 */
const checkoutBatchInfo = async ({ company, officeId, parcels = [] }) => {
    const settings = await batchSettingsFor(company);
    const vendorIds = [...new Set(parcels.map((p) => String(p.vendor_id)).filter(Boolean))];
    const vendors = await Seller.find({ _id: { $in: vendorIds } }).select('store_name store_username').lean();
    const names = new Map(vendors.map((v) => [String(v._id), v.store_name || v.store_username || '']));
    const out = [];
    for (const p of parcels) {
        const open = officeId
            ? await openBatchFor({ companyId: company._id, officeId, vendorId: p.vendor_id, location: p.fulfillment_location })
            : null;
        const standalone = round2(p.shipping_share || 0);
        const target = open ? open.target_count : settings.target_count;
        const waiting = open ? open.waiting_count : 0;
        out.push({
            vendor_id: p.vendor_id,
            vendor_name: names.get(String(p.vendor_id)) || '',
            fulfillment_location: p.fulfillment_location || '',
            standalone_shipping: standalone,
            // Waiting orders already in the batch, and the number that closes it.
            waiting,
            target,
            will_close_now: waiting + 1 >= target,
            deadline_at: open ? open.deadline_at : new Date(Date.now() + settings.wait_hours * HOUR),
            opens_new: !open,
            wait_hours: open ? null : settings.wait_hours,
            // "Save up to": full shipping minus an even share of a full batch. An estimate —
            // the real split is priced when the batch closes, and never above `standalone`.
            share_if_full: round2(standalone / target),
            save_up_to: round2(Math.max(0, standalone - standalone / target)),
        });
    }
    return { target_count: settings.target_count, wait_hours: settings.wait_hours, parcels: out };
};

/** A person's parcels that are waiting in (or rode in) a batch, for "My company". */
const myBatchParcels = async (userId, { limit = 20 } = {}) => {
    const orders = await Order.find({ user_id: userId, 'company.delivery_mode': 'consolidate' })
        .sort({ created_at: -1 }).limit(limit).lean();
    const batchIds = [...new Set(orders.flatMap((o) => (o.sub_orders || []).map((s) => s.company_batch?.batch_id).filter(Boolean)).map(String))];
    const batches = await CompanyBatch.find({ _id: { $in: batchIds } })
        .select('status target_count waiting_count deadline_at office_name vendor_id closed_at close_reason parcel_shipping split_mode').lean();
    const byId = new Map(batches.map((b) => [String(b._id), b]));
    const vendorIds = [...new Set(orders.flatMap((o) => (o.sub_orders || []).map((s) => String(s.vendor_id))))];
    const vendors = await Seller.find({ _id: { $in: vendorIds } }).select('store_name store_username store_slug').lean();
    const names = new Map(vendors.map((v) => [String(v._id), v.store_name || v.store_username || '']));
    const usernames = new Map(vendors.map((v) => [String(v._id), v.store_username || '']));
    // The clean link segment for the share message (/store/x-turbo-auto-parts).
    const slugs = new Map(vendors.map((v) => [String(v._id), v.store_slug || '']));

    const rows = [];
    for (const order of orders) {
        for (const sub of order.sub_orders || []) {
            if (!sub.company_batch?.joined_at) continue;
            const batch = sub.company_batch.batch_id ? byId.get(String(sub.company_batch.batch_id)) : null;
            rows.push({
                order_id: order._id,
                order_reference: order.transaction?.reference || '',
                sub_order_id: sub._id,
                reference: sub.reference,
                vendor_name: names.get(String(sub.vendor_id)) || '',
                // For "tell your colleagues": a link to the store, so the batch fills sooner.
                vendor_username: usernames.get(String(sub.vendor_id)) || '',
                vendor_slug: slugs.get(String(sub.vendor_id)) || '',
                items: subOrderService.subOrderItems(order, sub).map((i) => ({ title: i.product_title, quantity: i.quantity })),
                waiting: sub.status === 'held_in_batch',
                status: subOrderService.effectiveStatus(sub),
                left_reason: sub.company_batch.left_reason || null,
                joined_at: sub.company_batch.joined_at,
                released_at: sub.company_batch.released_at || null,
                standalone_shipping: sub.company_batch.standalone_shipping ?? null,
                savings: round2(sub.company_batch.savings || 0),
                batch: batch ? {
                    status: batch.status,
                    waiting_count: batch.waiting_count,
                    target_count: batch.target_count,
                    deadline_at: batch.deadline_at,
                    office_name: batch.office_name,
                    close_reason: batch.close_reason,
                } : null,
            });
        }
    }
    return rows;
};

/** Open batches and this month's savings, for the company portal and the admin. */
const companyBatchOverview = async (companyId, month = null) => {
    const { monthKey } = require('./companyService');
    const m = month || monthKey();
    const [open, closed] = await Promise.all([
        CompanyBatch.find({ company_id: companyId, status: { $in: ['open', 'closing'] } }).sort({ deadline_at: 1 }).lean(),
        CompanyBatch.find({ company_id: companyId, status: 'closed' }).sort({ closed_at: -1 }).limit(200).lean(),
    ]);
    const vendorIds = [...new Set([...open, ...closed].map((b) => String(b.vendor_id)))];
    const vendors = await Seller.find({ _id: { $in: vendorIds } }).select('store_name store_username').lean();
    const names = new Map(vendors.map((v) => [String(v._id), v.store_name || v.store_username || '']));

    // This month's savings, read from the parcels themselves (the figures that were
    // billed). A cancelled order saved nothing — it was refunded in full — and whatever the
    // company absorbed when an order left a closed batch comes off what it saved.
    const orders = await Order.find({ 'company.company_id': companyId, 'company.month': m, 'company.delivery_mode': 'consolidate' })
        .select('sub_orders.company_batch sub_orders.status').lean();
    const liveSubs = orders.flatMap((o) => (o.sub_orders || []).filter((s) => s.status !== 'cancelled' && s.company_batch?.joined_at));
    const monthBatchIds = new Set(liveSubs
        .filter((s) => s.company_batch.batch_id && s.company_batch.released_at && s.company_batch.role)
        .map((s) => String(s.company_batch.batch_id)));
    const absorbed = (await CompanyBatch.find({ _id: { $in: [...monthBatchIds] } }).select('company_absorbed').lean())
        .reduce((sum, b) => sum + Number(b.company_absorbed || 0), 0);
    const savings = round2(Math.max(0, liveSubs.reduce((sum, s) => sum + Number(s.company_batch.savings || 0), 0) - absorbed));
    const riders = liveSubs.filter((s) => s.company_batch.role === 'rider').length;

    const shape = (b) => ({
        _id: b._id,
        status: b.status,
        office_id: b.office_id,
        office_name: b.office_name,
        vendor_name: names.get(String(b.vendor_id)) || '',
        waiting_count: b.waiting_count,
        target_count: b.target_count,
        opened_at: b.opened_at,
        deadline_at: b.deadline_at,
        closed_at: b.closed_at,
        close_reason: b.close_reason,
        parcel_shipping: b.parcel_shipping,
        split_mode: b.split_mode,
        company_absorbed: round2(b.company_absorbed || 0),
        members: (b.members || []).filter((mm) => mm.status !== 'left').map((mm) => ({
            display_name: mm.display_name,
            order_reference: mm.order_reference,
            status: mm.status,
            dropped: !!mm.dropped_at,
            standalone_shipping: mm.standalone_shipping,
            share: mm.share,
            savings: mm.savings,
        })),
    });

    return {
        month: m,
        savings,
        // Parcels that did not have to travel on their own: every rider is one fewer delivery.
        parcels_saved: riders,
        combined_parcels: monthBatchIds.size,
        open: open.map(shape),
        recent: closed.slice(0, 20).map(shape),
    };
};

/** One batch as the vendor sees it: each person's order, and the combined parcel. */
const vendorBatchView = async (vendorId, batchId) => {
    const batch = await CompanyBatch.findById(batchId);
    if (!batch || !sameId(batch.vendor_id, vendorId) || !['closed'].includes(batch.status)) {
        throw companyError('BATCH_NOT_FOUND', 'Combined order not found', 404);
    }
    const entries = await loadMembers(batch, { statuses: ['released'] });
    const company = await Company.findById(batch.company_id).select('name offices').lean();
    const office = (company?.offices || []).find((o) => sameId(o._id, batch.office_id)) || null;
    const lead = entries.find((e) => sameId(e.sub?._id, batch.lead?.sub_order_id));
    const live = entries.filter((e) => e.sub && e.sub.status !== 'cancelled' && !e.member.dropped_at);

    return {
        _id: batch._id,
        company_name: company?.name || '',
        office: office ? { name: office.name, recipient_name: office.recipient_name, phone: office.phone, full_address: office.full_address } : { name: batch.office_name },
        closed_at: batch.closed_at,
        order_count: live.length,
        confirmed_count: live.filter((e) => !NOT_CONFIRMED.includes(e.sub.status)).length,
        dispatched: !!batch.dispatched_at,
        lead: lead ? {
            order_id: lead.order._id,
            sub_order_id: lead.sub._id,
            reference: lead.member.order_reference,
            status: lead.sub.status,
            tracking_number: lead.sub.tracking_number || lead.sub.bosta_tracking_number || null,
        } : null,
        members: entries.map((e) => ({
            order_id: e.member.order_id,
            sub_order_id: e.member.sub_order_id,
            reference: e.member.order_reference,
            display_name: e.member.display_name,
            is_lead: sameId(e.member.sub_order_id, batch.lead?.sub_order_id),
            status: e.sub ? subOrderService.effectiveStatus(e.sub) : 'cancelled',
            dropped: !!e.member.dropped_at || e.sub?.status === 'cancelled',
            items: e.sub ? subOrderService.subOrderItems(e.order, e.sub).map((i) => ({
                _id: i._id,
                title: i.product_title,
                variant: /^default$/i.test(String(i.variant_label || '')) ? '' : (i.variant_label || ''),
                quantity: i.quantity,
                vendor_status: i.vendor_status,
            })) : [],
        })),
    };
};

/** A compact batch summary for each of a vendor's parcels, keyed by sub-order id. */
const vendorBatchSummaries = async (subs = []) => {
    const ids = [...new Set(subs.map((s) => s.company_batch?.batch_id).filter(Boolean).map(String))];
    if (ids.length === 0) return new Map();
    const batches = await CompanyBatch.find({ _id: { $in: ids } }).lean();
    const companies = await Company.find({ _id: { $in: [...new Set(batches.map((b) => String(b.company_id)))] } }).select('name').lean();
    const companyName = new Map(companies.map((c) => [String(c._id), c.name]));
    const byId = new Map(batches.map((b) => [String(b._id), b]));
    const out = new Map();
    for (const sub of subs) {
        const b = sub.company_batch?.batch_id ? byId.get(String(sub.company_batch.batch_id)) : null;
        if (!b || !sub.company_batch?.role) continue;
        const members = (b.members || []).filter((m) => m.status === 'released' && !m.dropped_at);
        out.set(String(sub._id), {
            batch_id: b._id,
            role: sub.company_batch.role,
            company_name: companyName.get(String(b.company_id)) || '',
            office_name: b.office_name,
            order_count: members.length,
            lead_order_id: b.lead?.order_id || null,
            lead_sub_order_id: b.lead?.sub_order_id || null,
            lead_reference: sub.company_batch.lead_reference || '',
            dispatched: !!b.dispatched_at,
        });
    }
    return out;
};

/**
 * For a customer's parcels still waiting in a batch: how full it is and when it ships at
 * the latest. Keyed by sub-order id; parcels not waiting are absent.
 */
const waitingInfoForSubs = async (subs = []) => {
    const waiting = subs.filter((s) => s.status === 'held_in_batch' && s.company_batch?.batch_id);
    if (waiting.length === 0) return new Map();
    const batches = await CompanyBatch.find({ _id: { $in: waiting.map((s) => s.company_batch.batch_id) } })
        .select('waiting_count target_count deadline_at status office_name').lean();
    const byId = new Map(batches.map((b) => [String(b._id), b]));
    const out = new Map();
    for (const sub of waiting) {
        const b = byId.get(String(sub.company_batch.batch_id));
        if (!b) continue;
        out.set(String(sub._id), {
            waiting_count: b.waiting_count,
            target_count: b.target_count,
            deadline_at: b.deadline_at,
            office_name: b.office_name,
            closing: b.status !== 'open',
        });
    }
    return out;
};

/** Admin: every batch of a company, newest first. */
const adminCompanyBatches = async (companyId, { status = null, limit = 100 } = {}) => {
    const filter = { company_id: companyId };
    if (status) filter.status = status;
    const batches = await CompanyBatch.find(filter).sort({ created_at: -1 }).limit(Math.min(500, limit)).lean();
    const vendors = await Seller.find({ _id: { $in: [...new Set(batches.map((b) => String(b.vendor_id)))] } }).select('store_name store_username').lean();
    const names = new Map(vendors.map((v) => [String(v._id), v.store_name || v.store_username || '']));
    return batches.map((b) => ({
        ...b,
        vendor_name: names.get(String(b.vendor_id)) || '',
        live_count: (b.members || []).filter((m) => m.status !== 'left' && !m.dropped_at).length,
    }));
};

/** Admin: close an open batch now, whatever it holds. */
const closeNowByAdmin = async (companyId, batchId, actor) => {
    const batch = await CompanyBatch.findOne({ _id: batchId, company_id: companyId }).select('status').lean();
    if (!batch) throw companyError('BATCH_NOT_FOUND', 'Batch not found', 404);
    if (batch.status !== 'open') throw companyError('BATCH_NOT_OPEN', 'This batch is not waiting any more', 409);
    const closed = await closeBatch(batchId, 'admin', actor);
    if (!closed) throw companyError('BATCH_NOT_OPEN', 'This batch is not waiting any more', 409);
    return closed;
};

/** Whether an office still has orders waiting for it — it cannot be removed until they ship. */
const officeHasWaitingBatches = async (companyId, officeId) =>
    !!(await CompanyBatch.exists({ company_id: companyId, office_id: officeId, status: { $in: ['open', 'closing'] } }));

module.exports = {
    batchSettingsFor,
    holdParcels,
    joinBatchesForOrder,
    closeBatch,
    finishClosing,
    splitParcelShipping,
    leaveBatch,
    shipNow,
    onReleasedMemberCancelled,
    dispatchOptionsFor,
    markLeadDispatched,
    onMemberConfirmed,
    syncBatchRiders,
    syncRidersOfLeadOrder,
    runBatchSweep,
    checkoutBatchInfo,
    myBatchParcels,
    companyBatchOverview,
    vendorBatchView,
    vendorBatchSummaries,
    waitingInfoForSubs,
    adminCompanyBatches,
    closeNowByAdmin,
    officeHasWaitingBatches,
};
