const crypto = require('crypto');
const mongoose = require('mongoose');

const { Review, ReviewInvite, MAX_REVIEW_IMAGES } = require('../models/reviews');
const { Order } = require('../models/orders');
const { Product } = require('../models/products');
const { Seller } = require('../models/sellers');
const { recordAuditLog } = require('../models/auditLog');
const { authorizationError } = require('./shared/addressAuthorization');
const { canonicalPhone } = require('./shared/phone');
const { User } = require('../models/users');

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

/**
 * Hours after a parcel is delivered before its review request goes out.
 *
 * A day is long enough for the customer to have opened the box and used the part, and
 * short enough that the delivery is still the thing they remember.
 */
const INVITE_DELAY_HOURS = Number(process.env.REVIEW_INVITE_DELAY_HOURS) > 0
    ? Number(process.env.REVIEW_INVITE_DELAY_HOURS)
    : 24;

/** How long a review link stays usable. */
const INVITE_TTL_DAYS = Number(process.env.REVIEW_INVITE_TTL_DAYS) > 0
    ? Number(process.env.REVIEW_INVITE_TTL_DAYS)
    : 30;

/**
 * How long after the due moment a parcel is still invited. The sweep used to match exactly one
 * calendar day, so a failed send, or a day the sweep did not run, meant that parcel was never
 * invited at all. Within this window a failed send is simply retried on the next pass.
 */
const INVITE_RETRY_DAYS = Number(process.env.REVIEW_INVITE_RETRY_DAYS) > 0
    ? Number(process.env.REVIEW_INVITE_RETRY_DAYS)
    : 7;

/** The store's own clock: the hours a message may be sent are Cairo hours. */
const STORE_TIMEZONE = process.env.STORE_TIMEZONE || 'Africa/Cairo';

/**
 * The only hours a review request may be sent, on the store's clock.
 *
 * The sweep runs every hour so a parcel is asked about roughly a day after it arrived
 * rather than whenever a daily job happens to fire — but a WhatsApp at 4 AM is worse than
 * one a few hours late, so anything due overnight waits for the morning.
 */
const SEND_FROM_HOUR = Number(process.env.REVIEW_INVITE_FROM_HOUR) >= 0
    ? Number(process.env.REVIEW_INVITE_FROM_HOUR)
    : 10;
const SEND_UNTIL_HOUR = Number(process.env.REVIEW_INVITE_UNTIL_HOUR) > 0
    ? Number(process.env.REVIEW_INVITE_UNTIL_HOUR)
    : 21;

/** The hour of day at `date` on the store's clock, 0–23. */
const storeHour = (date = new Date()) => Number(
    new Intl.DateTimeFormat('en-US', { timeZone: STORE_TIMEZONE, hour: '2-digit', hourCycle: 'h23' }).format(date)
);

/** EverySecond template `readycar_reviews_taker` (UTILITY, ar, dynamic button). */
const REVIEW_TEMPLATE_ID = Number(process.env.WHATSAPP_REVIEW_TEMPLATE_ID || 42);

const reviewError = authorizationError;

const getFrontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const buildReviewUrl = (token) => `${getFrontendUrl()}/review/${encodeURIComponent(token)}`;

/* ------------------------------------------------------------------ */
/* Invitations                                                         */
/* ------------------------------------------------------------------ */

/**
 * Products from an order that are still reviewable.
 *
 * Bundle members are collapsed to one entry per product: a customer who bought
 * a kit rates the parts, not the same part twice because it appeared in two
 * bundle groups. Returned/refunded lines are excluded — asking someone to rate
 * an item they sent back is a bad experience.
 */
const reviewableItems = (order, subOrderId = null) => {
    const seen = new Set();
    const items = [];

    for (const item of order.items || []) {
        const productId = item.product_id?._id || item.product_id;
        if (!productId) continue;
        // Scoped to one parcel when the invite is for a parcel: the customer rates the box
        // that arrived, not the ones still on their way.
        if (subOrderId && String(item.sub_order_id || '') !== String(subOrderId)) continue;
        // A line the vendor could not supply never reached the customer.
        if (item.vendor_status === 'declined') continue;
        if (['returned', 'refunded'].includes(item.return_status)) continue;

        const key = String(productId);
        if (seen.has(key)) continue;
        seen.add(key);

        items.push({
            product_id: productId,
            product_title: item.product_title,
            product_image: item.product_image,
            variant_label: item.variant_label && item.variant_label !== 'Default' ? item.variant_label : '',
            vendor_id: item.vendor_id?._id || item.vendor_id || null,
        });
    }

    return items;
};

/**
 * The distinct vendors an order can be asked about: one per seller who actually shipped
 * something the customer kept. Derived from the same item list the products come from, so
 * a seller whose only line was returned is not asked about either.
 */
const reviewableVendors = async (order, subOrderId = null) => {
    const ids = [];
    const seen = new Set();
    for (const item of reviewableItems(order, subOrderId)) {
        const vendorId = item.vendor_id;
        if (!vendorId) continue;
        const key = String(vendorId);
        if (seen.has(key)) continue;
        seen.add(key);
        ids.push(vendorId);
    }
    if (ids.length === 0) return [];

    const sellers = await Seller.find({ _id: { $in: ids } }).select('store_name store_username store_image').lean();
    const byId = new Map(sellers.map((v) => [String(v._id), v]));
    // Preserve the order the items appear in, so the form reads the way the order does.
    return ids
        .map((id) => byId.get(String(id)))
        .filter(Boolean)
        .map((v) => ({
            vendor_id: v._id,
            store_name: v.store_name,
            store_username: v.store_username,
            store_image: v.store_image || '',
        }));
};

/**
 * Keep only images this server issued, and only as many as a review may carry.
 *
 * A review is submitted with a bearer token and no login, so the image list is attacker
 * controlled: without this an arbitrary third-party URL could be rendered on a product
 * page once a moderator waved the review through. Anything not served from our own
 * uploads path is dropped rather than rejected, so one bad entry cannot cost the customer
 * the rating they took the trouble to write.
 */
const sanitizeReviewImages = (images) => {
    const list = Array.isArray(images) ? images : [];
    const out = [];
    for (const entry of list) {
        const url = String(entry?.url ?? entry ?? '').trim();
        if (!url) continue;
        if (!/\/uploads\/reviews\/[A-Za-z0-9._-]+$/.test(url)) continue;
        if (out.some((i) => i.url === url)) continue;
        out.push({ url });
        if (out.length >= MAX_REVIEW_IMAGES) break;
    }
    return out;
};

/** Midnight at the start of `date`'s day in the store's timezone, as a real instant. */
const storeStartOfDay = (date = new Date()) => {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
            timeZone: STORE_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
        }).formatToParts(date).map((p) => [p.type, p.value])
    );
    // The offset of the store's zone at this moment, from the wall-clock it reports.
    const wallAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    const offsetMs = wallAsUtc - Math.floor(date.getTime() / 1000) * 1000;
    return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day) - offsetMs);
};

const findParcel = (order, subOrderId) =>
    (order.sub_orders || []).find((s) => String(s._id) === String(subOrderId)) || null;

/**
 * Give a parcel a live review link and return the raw token.
 *
 * One invite per parcel, never more: a second call adds another live link to the same
 * invite instead of replacing it, so the link already in the customer's WhatsApp keeps
 * working after they press "rate" on the site. An expired invite is renewed.
 */
const issueParcelInvite = async (order, sub, { markSent = false } = {}) => {
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const key = { order_id: order._id, sub_order_id: sub._id };

    const existing = await ReviewInvite.findOne(key);
    if (!existing) {
        await ReviewInvite.create({
            ...key,
            token_hash: hashToken(token),
            expires_at: expiresAt,
            sent_at: markSent ? new Date() : null,
        });
    } else {
        const extra = [...(existing.extra_token_hashes || []), hashToken(token)].slice(-10);
        await ReviewInvite.updateOne(
            key,
            {
                extra_token_hashes: extra,
                expires_at: expiresAt > existing.expires_at ? expiresAt : existing.expires_at,
                ...(markSent ? { sent_at: new Date() } : {}),
            }
        );
    }
    return { token, url: buildReviewUrl(token), expiresAt };
};

/**
 * Who is asked to review a parcel: normally the person on the delivery address, who received
 * it.
 *
 * A company order is the exception. Delivered to an office, its address carries the office
 * contact's mobile — that is who the courier calls, and it is often the company's manager —
 * so the request went to them instead of the employee who ordered. It goes to the account
 * that placed the order (the employee, or the manager ordering for a company car), as the
 * order confirmation does (`resolveConfirmationRecipient` in orderService). An account with
 * no phone is not asked by WhatsApp at all rather than sending it to the office: it can still
 * rate from its orders page.
 *
 * @returns {Promise<{ phone: string|null, name: string }>}
 */
const reviewRecipient = async (order) => {
    if (order.company?.company_id && order.user_id) {
        const orderer = await User.findById(order.user_id).select('name phone').lean();
        return { phone: orderer?.phone || null, name: orderer?.name || '' };
    }
    return { phone: order.shipping_address?.phone || null, name: order.shipping_address?.recipient_name || '' };
};

/**
 * Send one parcel's review request over WhatsApp.
 * Fail-safe: never throws, so one bad number cannot stop the sweep.
 */
const sendReviewInvite = async (order, sub) => {
    const recipient = await reviewRecipient(order);
    const phone = recipient.phone;
    if (!phone) return { skipped: 'no_phone' };
    if (!sub) return { skipped: 'no_parcel' };

    const items = reviewableItems(order, sub._id);
    if (items.length === 0) return { skipped: 'nothing_to_review' };

    const hadInvite = !!(await ReviewInvite.exists({ order_id: order._id, sub_order_id: sub._id }));
    const { token, url } = await issueParcelInvite(order, sub, { markSent: true });
    const reference = sub.reference || order.transaction?.reference || order._id.toString();

    try {
        const whatsappService = require('./whatsappService');
        const result = await whatsappService.sendTemplateMessage({
            phone,
            templateId: REVIEW_TEMPLATE_ID,
            variables: {
                1: recipient.name || 'عميلنا العزيز',
                2: reference,
            },
            // This template's button is a DYNAMIC url, and this provider wants
            // the complete URL rather than just the variable suffix — which the
            // template's base then gets prepended to. See the note in
            // `shared/guestInvites.js` and the rescue in frontend middleware.
            buttonUrl: url,
            campaignName: `Review request #${reference}`,
            recipientName: recipient.name,
        });

        await ReviewInvite.updateOne(
            { order_id: order._id, sub_order_id: sub._id },
            { delivery_reference: result?.campaignId ? String(result.campaignId) : null }
        );

        return { sent: true, campaignId: result?.campaignId || null, token };
    } catch (err) {
        const detail = err.details?.length ? ` [${err.details.join('; ')}]` : '';
        console.error(`[Reviews] invite failed for order ${order._id}, parcel ${sub._id}: ${err.message}${detail}`);
        // Not sent: clear `sent_at` so the next sweep tries again. An invite the customer
        // already opened from the site keeps its links; a brand-new one is dropped.
        if (hadInvite) {
            await ReviewInvite.updateOne({ order_id: order._id, sub_order_id: sub._id }, { sent_at: null });
        } else {
            await ReviewInvite.deleteOne({ order_id: order._id, sub_order_id: sub._id, submitted_at: null });
        }
        return { sent: false, error: err.message };
    }
};

/**
 * Sweep: invite customers for parcels delivered `INVITE_DELAY_HOURS` ago.
 *
 * Per parcel, because parcels of one order arrive on different days. Runs hourly and looks
 * back over a window rather than at one exact moment, so a failed send or a missed run is
 * caught up; a parcel already messaged — or already rated from the site — is never messaged
 * again. Outside the store's sending hours it does nothing, so an overnight delivery is
 * asked about in the morning instead of at 4 AM.
 */
const sendPendingReviewInvites = async ({ now = new Date(), ignoreHours = false } = {}) => {
    const hour = storeHour(now);
    if (!ignoreHours && (hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR)) {
        return { invited: 0, sent: 0, skipped: 'quiet_hours' };
    }

    const dayMs = 24 * 60 * 60 * 1000;
    // Delivered at least `INVITE_DELAY_HOURS` ago...
    const dueBefore = new Date(now.getTime() - INVITE_DELAY_HOURS * 60 * 60 * 1000);
    // ...and not so long ago that the message would read as out of the blue.
    const notBefore = new Date(dueBefore.getTime() - INVITE_RETRY_DAYS * dayMs);

    const orders = await Order.find({
        sub_orders: { $elemMatch: { status: 'delivered', delivered_at: { $gte: notBefore, $lt: dueBefore } } },
    }).select('_id items sub_orders shipping_address transaction delivered_at user_id company.company_id').limit(500).lean();

    if (orders.length === 0) return { invited: 0, sent: 0 };

    const invites = await ReviewInvite.find({ order_id: { $in: orders.map((o) => o._id) } })
        .select('order_id sub_order_id sent_at submitted_at').lean();
    const done = new Set();
    const wholeOrderInvited = new Set();
    for (const i of invites) {
        if (!i.sub_order_id) { wholeOrderInvited.add(String(i.order_id)); continue; }
        if (i.sent_at || i.submitted_at) done.add(`${i.order_id}:${i.sub_order_id}`);
    }

    let invited = 0;
    let sent = 0;
    for (const order of orders) {
        // An order invited as a whole before parcels were rated separately is not asked twice.
        if (wholeOrderInvited.has(String(order._id))) continue;
        for (const sub of order.sub_orders || []) {
            if (sub.status !== 'delivered' || !sub.delivered_at) continue;
            if (sub.delivered_at < notBefore || sub.delivered_at >= dueBefore) continue;
            if (done.has(`${order._id}:${sub._id}`)) continue;
            const result = await sendReviewInvite(order, sub);
            if (result.skipped) continue;
            invited += 1;
            if (result.sent) sent += 1;
        }
    }

    return { invited, sent };
};

/**
 * The customer's own "rate this parcel" button, from their orders page.
 *
 * Signed in, so ownership is checked here rather than proven by a token. Returns a link to
 * the same review page the WhatsApp message opens, or says the parcel is already rated.
 */
const getParcelReviewLink = async (userId, orderId, subOrderId) => {
    if (!mongoose.Types.ObjectId.isValid(String(orderId)) || !mongoose.Types.ObjectId.isValid(String(subOrderId))) {
        throw reviewError('ORDER_NOT_FOUND', 'Order not found', 404);
    }
    const order = await Order.findOne({ _id: orderId, user_id: userId })
        .select('_id items sub_orders transaction').lean();
    if (!order) throw reviewError('ORDER_NOT_FOUND', 'Order not found', 404);

    const sub = findParcel(order, subOrderId);
    if (!sub) throw reviewError('PARCEL_NOT_FOUND', 'Parcel not found', 404);
    if (sub.status !== 'delivered') {
        throw reviewError('PARCEL_NOT_DELIVERED', 'You can rate this parcel once it has been delivered', 409);
    }
    if (reviewableItems(order, sub._id).length === 0) {
        throw reviewError('NOTHING_TO_REVIEW', 'There is nothing to rate in this parcel', 409);
    }

    const existing = await ReviewInvite.findOne({ order_id: order._id, sub_order_id: sub._id }).lean();
    if (existing?.submitted_at) return { submitted: true };

    const { url } = await issueParcelInvite(order, sub);
    return { submitted: false, url, path: new URL(url).pathname };
};

/** For the customer's order list: which delivered parcels are already rated. */
const reviewStateForOrders = async (orders = []) => {
    const ids = orders.map((o) => o._id);
    if (ids.length === 0) return new Map();
    const rows = await ReviewInvite.find({ order_id: { $in: ids }, submitted_at: { $ne: null } })
        .select('order_id sub_order_id').lean();
    const state = new Map();
    for (const r of rows) state.set(`${r.order_id}:${r.sub_order_id || '*'}`, 'submitted');
    return state;
};

/* ------------------------------------------------------------------ */
/* Customer-facing: open and submit                                    */
/* ------------------------------------------------------------------ */

const loadLiveInvite = async (token) => {
    if (!token) throw reviewError('INVITE_NOT_FOUND', 'This review link is invalid', 404);

    const hash = hashToken(token);
    const invite = await ReviewInvite.findOne({ $or: [{ token_hash: hash }, { extra_token_hashes: hash }] });
    if (!invite) throw reviewError('INVITE_NOT_FOUND', 'This review link is invalid or has already been used', 404);
    if (invite.submitted_at) throw reviewError('INVITE_ALREADY_USED', 'You have already reviewed this order. Thank you!', 409);
    if (invite.expires_at <= new Date()) throw reviewError('INVITE_EXPIRED', 'This review link has expired', 410);

    return invite;
};

/**
 * What the review page renders. Deliberately narrow: the items to rate and the
 * order reference. No address, no totals, no payment — the token is a public
 * bearer credential, so it must not unlock the customer's order detail.
 */
const getInviteContext = async (token) => {
    const invite = await loadLiveInvite(token);

    const order = await Order.findById(invite.order_id)
        .select('items sub_orders transaction delivered_at shipping_address.recipient_name user_id company.company_id');
    if (!order) throw reviewError('INVITE_NOT_FOUND', 'This review link is invalid', 404);
    const scope = invite.sub_order_id || null;
    const parcel = scope ? findParcel(order, scope) : null;

    const existing = await Review.find({ order_id: order._id })
        .select('target_type product_id vendor_id rating comment images')
        .lean();
    const byProduct = new Map(
        existing.filter((r) => r.target_type !== 'vendor' && r.product_id).map((r) => [r.product_id.toString(), r])
    );
    const byVendor = new Map(
        existing.filter((r) => r.target_type === 'vendor' && r.vendor_id).map((r) => [r.vendor_id.toString(), r])
    );

    const prefill = (prior) => ({
        rating: prior?.rating || 0,
        comment: prior?.comment || '',
        images: (prior?.images || []).map((i) => i.url),
    });

    const items = reviewableItems(order, scope).map((item) => ({
        product_id: item.product_id,
        vendor_id: item.vendor_id,
        title: item.product_title,
        image: item.product_image,
        variant_label: item.variant_label,
        ...prefill(byProduct.get(String(item.product_id))),
    }));

    return {
        reference: parcel?.reference || order.transaction?.reference || order._id.toString(),
        // The person being asked: on a company order the one who ordered, not the office.
        customer_name: (await reviewRecipient(order)).name,
        delivered_at: parcel?.delivered_at || order.delivered_at,
        expires_at: invite.expires_at,
        max_images: MAX_REVIEW_IMAGES,
        items,
        // The sellers behind those items. The form groups the products under their seller
        // and puts this block at the end of each group, so rating the shop is one more tap
        // rather than a second journey the customer will never make.
        vendors: (await reviewableVendors(order, scope)).map((vendor) => ({
            ...vendor,
            ...prefill(byVendor.get(String(vendor.vendor_id))),
        })),
    };
};

/**
 * Which account wrote the reviews for this order.
 *
 * The review link goes to the phone on the order's delivery address, so the reviewer is
 * whichever account on the order holds that number — the recipient of a friend order, the
 * member or organizer of a family one, or simply the customer. When no account on the order
 * holds it, the recipient of a friend order, else the order's owner.
 *
 * @returns {Promise<object|null>} the User (with `name`), or null if none can be found
 */
const resolveReviewerAccount = async (order) => {
    const related = [order.ordered_for_user_id, order.requested_by_user_id, order.user_id]
        .filter(Boolean)
        .map(String);
    const ids = [...new Set(related)];
    if (ids.length === 0) return null;

    const users = await User.find({ _id: { $in: ids } }).select('name phone').lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));

    const shipPhone = canonicalPhone(order.shipping_address?.phone || '');
    if (shipPhone) {
        for (const id of ids) {
            const u = byId.get(id);
            if (u?.phone && canonicalPhone(u.phone) === shipPhone) return u;
        }
    }
    return byId.get(String(order.ordered_for_user_id || '')) || byId.get(String(order.user_id || '')) || null;
};

/**
 * The name to show on each review: the reviewer account's CURRENT name, read now.
 *
 *   account exists   → its live name
 *   account deleted  → a generic label; a deleted account's name does not linger
 *   no account       → the name recorded when the review was written
 *
 * One query for the whole page of reviews.
 */
const liveAuthorNames = async (reviews = [], { fallback = '' } = {}) => {
    const ids = [...new Set(reviews.map((r) => r.reviewer_user_id).filter(Boolean).map(String))];
    const users = ids.length ? await User.find({ _id: { $in: ids } }).select('name').lean() : [];
    const names = new Map(users.map((u) => [String(u._id), u.name]));
    return reviews.map((r) => {
        if (r.reviewer_user_id) {
            const live = names.get(String(r.reviewer_user_id));
            return live ? String(live).trim() : fallback;
        }
        return String(r.author_name || '').trim() || fallback;
    });
};

/**
 * Store the customer's ratings.
 *
 * Everything lands as `pending` — nothing reaches a product page until an admin
 * approves it. The product ids are validated against the order, so a crafted
 * payload cannot attach a review to a product the customer never bought.
 */
const submitReviews = async (token, entries = []) => {
    const invite = await loadLiveInvite(token);

    const order = await Order.findById(invite.order_id)
        .select('items user_id ordered_for_user_id requested_by_user_id transaction shipping_address.recipient_name shipping_address.phone');
    if (!order) throw reviewError('INVITE_NOT_FOUND', 'This review link is invalid', 404);

    const scope = invite.sub_order_id || null;
    const allowedProducts = new Map(reviewableItems(order, scope).map((i) => [String(i.product_id), i]));
    const allowedVendors = new Map((await reviewableVendors(order, scope)).map((v) => [String(v.vendor_id), v]));

    const cleaned = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
        const isVendorReview = entry?.target_type === 'vendor';

        // The target has to be something this order actually contained. Silently ignoring
        // an unknown one would hide a real mismatch, and accepting it would let a crafted
        // payload rate a product or a shop the customer never bought from.
        let target;
        if (isVendorReview) {
            target = allowedVendors.get(String(entry?.vendor_id || ''));
            if (!target) throw reviewError('VENDOR_NOT_IN_ORDER', 'One of the sellers is not part of this order', 400);
        } else {
            target = allowedProducts.get(String(entry?.product_id || ''));
            if (!target) throw reviewError('PRODUCT_NOT_IN_ORDER', 'One of the products is not part of this order', 400);
        }

        const rating = Number(entry.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            throw reviewError('INVALID_RATING', 'Each rating must be between 1 and 5 stars', 400);
        }

        cleaned.push({
            target_type: isVendorReview ? 'vendor' : 'product',
            product_id: isVendorReview ? null : target.product_id,
            // Both targets carry it: it IS the target of a vendor review, and it is the
            // denormalized provenance on a product one.
            vendor_id: target.vendor_id,
            rating,
            comment: String(entry.comment || '').trim().slice(0, 1000),
            images: sanitizeReviewImages(entry.images),
        });
    }

    if (cleaned.length === 0) {
        throw reviewError('NO_RATINGS', 'Rate at least one product', 400);
    }

    // The account's name, not the name typed on the delivery address when the order was
    // placed — and it is re-read live on every screen afterwards (`liveAuthorNames`).
    const reviewer = await resolveReviewerAccount(order);
    const authorName = reviewer?.name || order.shipping_address?.recipient_name || '';
    for (const entry of cleaned) {
        await Review.findOneAndUpdate(
            {
                order_id: order._id,
                target_type: entry.target_type,
                product_id: entry.product_id,
                vendor_id: entry.vendor_id,
            },
            {
                order_id: order._id,
                target_type: entry.target_type,
                product_id: entry.product_id,
                vendor_id: entry.vendor_id,
                user_id: order.user_id || null,
                reviewer_user_id: reviewer?._id || null,
                rating: entry.rating,
                comment: entry.comment,
                images: entry.images,
                author_name: authorName,
                // A resubmission returns to moderation rather than keeping an
                // older approval with new text underneath it.
                status: 'pending',
                reviewed_by: null,
                reviewed_at: null,
                rejection_reason: '',
                updated_at: new Date(),
            },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        );
    }

    // Single use: the link stops working once the form is submitted.
    invite.submitted_at = new Date();
    await invite.save();

    return {
        submitted: cleaned.length,
        products: cleaned.filter((c) => c.target_type === 'product').length,
        vendors: cleaned.filter((c) => c.target_type === 'vendor').length,
        pending_moderation: true,
    };
};

/* ------------------------------------------------------------------ */
/* Product rating aggregation                                          */
/* ------------------------------------------------------------------ */

/**
 * Recompute a product's public rating from its APPROVED reviews only.
 *
 * Derived rather than incremented: an approve-then-reject cycle, an edited
 * rating, or a deleted review all converge to the right number without drift.
 */
const recomputeProductRating = async (productId) => {
    const [summary] = await Review.aggregate([
        {
            $match: {
                product_id: new mongoose.Types.ObjectId(String(productId)),
                // Vendor reviews carry a null product_id and so cannot match here, but the
                // filter is explicit: a product's stars must never absorb its seller's.
                target_type: 'product',
                status: 'approved',
            },
        },
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);

    const rating = summary ? Number(summary.avg.toFixed(2)) : 0;
    const count = summary ? summary.count : 0;

    await Product.updateOne({ _id: productId }, { rating, reviews_count: count });
    return { rating, reviews_count: count };
};

/* ------------------------------------------------------------------ */
/* Admin moderation                                                    */
/* ------------------------------------------------------------------ */

const listReviewsForAdmin = async ({ status = 'pending', target = 'all', page = 1, limit = 20 } = {}) => {
    const filter = {};
    if (status && status !== 'all') filter.status = status;
    if (['product', 'vendor'].includes(target)) filter.target_type = target;

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));

    const [total, reviews, pendingCount] = await Promise.all([
        Review.countDocuments(filter),
        Review.find(filter)
            .sort({ created_at: -1 })
            .skip((safePage - 1) * safeLimit)
            .limit(safeLimit)
            .populate('product_id', 'title_en title_ar slug_en images')
            .populate('vendor_id', 'store_name store_username')
            .lean(),
        Review.countDocuments({ status: 'pending' }),
    ]);

    const adminNames = await liveAuthorNames(reviews, { fallback: 'Deleted account' });
    return {
        reviews: reviews.map((r, idx) => ({
            _id: r._id,
            target_type: r.target_type || 'product',
            rating: r.rating,
            comment: r.comment,
            // Moderating a photo is the half of this queue that matters most, so the
            // urls travel with the row rather than behind another request.
            images: (r.images || []).map((i) => i.url),
            // The reviewer account's name as it is NOW, not as it was on the order.
            author_name: adminNames[idx],
            status: r.status,
            rejection_reason: r.rejection_reason,
            created_at: r.created_at,
            reviewed_at: r.reviewed_at,
            reviewed_by: r.reviewed_by,
            order_id: r.order_id,
            product: r.product_id ? {
                _id: r.product_id._id,
                title: r.product_id.title_en || r.product_id.title_ar,
                slug: r.product_id.slug_en,
                image: (r.product_id.images || []).find((i) => i.is_primary)?.url || r.product_id.images?.[0]?.url || '',
            } : null,
            vendor_name: r.vendor_id?.store_name || null,
            vendor_username: r.vendor_id?.store_username || null,
        })),
        pending_count: pendingCount,
        pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) },
    };
};

const moderateReview = async (reviewId, { status, reason = '', actor = 'Admin' }) => {
    if (!['approved', 'rejected'].includes(status)) {
        throw reviewError('INVALID_STATUS', 'Status must be approved or rejected', 400);
    }
    if (!mongoose.Types.ObjectId.isValid(reviewId)) {
        throw reviewError('REVIEW_NOT_FOUND', 'Review not found', 404);
    }

    const review = await Review.findById(reviewId);
    if (!review) throw reviewError('REVIEW_NOT_FOUND', 'Review not found', 404);

    review.status = status;
    review.reviewed_by = actor;
    review.reviewed_at = new Date();
    review.rejection_reason = status === 'rejected' ? String(reason || '').slice(0, 300) : '';
    await review.save();

    // Recompute either way: approving adds it, rejecting a previously approved
    // review has to remove its contribution. Which average moves depends on what was
    // rated — a vendor review must never touch a product's stars, or vice versa.
    const vendorStatsService = require('./vendorStatsService');
    const totals = review.target_type === 'vendor'
        ? await vendorStatsService.recomputeVendorRating(review.vendor_id)
        : await recomputeProductRating(review.product_id);

    await recordAuditLog({
        action: status === 'approved' ? 'review_approved' : 'review_rejected',
        actor: { role: 'admin', label: actor },
        target_type: 'review',
        target_id: review._id,
        target_snapshot: {
            review_target: review.target_type,
            product_id: review.product_id,
            vendor_id: review.vendor_id,
            rating: review.rating,
        },
        impact: totals,
    });

    return { review_id: review._id, status, target_type: review.target_type, ...totals };
};

/* ------------------------------------------------------------------ */
/* Public product reviews                                              */
/* ------------------------------------------------------------------ */

/** Approved reviews for a product page. Never exposes the reviewer's account. */
const getProductReviews = async (productId, { page = 1, limit = 10 } = {}) => {
    if (!mongoose.Types.ObjectId.isValid(productId)) {
        return { reviews: [], summary: { rating: 0, count: 0, breakdown: {} }, pagination: { page: 1, pages: 0, total: 0 } };
    }

    return listApprovedReviews({ product_id: productId, target_type: 'product' }, { page, limit });
};

/**
 * Approved reviews of a STORE, for its public page. Same shape as the product feed so one
 * component renders both.
 */
const getVendorReviews = async (vendorId, { page = 1, limit = 10 } = {}) => {
    if (!mongoose.Types.ObjectId.isValid(vendorId)) {
        return { reviews: [], summary: { rating: 0, count: 0, breakdown: {} }, pagination: { page: 1, pages: 0, total: 0 } };
    }
    return listApprovedReviews({ vendor_id: vendorId, target_type: 'vendor' }, { page, limit });
};

/**
 * The shared read path behind both public feeds: a page of approved reviews plus the
 * star breakdown, and never anything that identifies the reviewer's account.
 */
const listApprovedReviews = async (target, { page = 1, limit = 10 } = {}) => {
    const idField = target.target_type === 'vendor' ? 'vendor_id' : 'product_id';
    const filter = { ...target, status: 'approved' };
    const matchStage = {
        [idField]: new mongoose.Types.ObjectId(String(target[idField])),
        target_type: target.target_type,
        status: 'approved',
    };

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 10));

    const [total, reviews, breakdown] = await Promise.all([
        Review.countDocuments(filter),
        Review.find(filter)
            .sort({ created_at: -1 })
            .skip((safePage - 1) * safeLimit)
            .limit(safeLimit)
            .select('rating comment images author_name reviewer_user_id created_at')
            .lean(),
        Review.aggregate([
            { $match: matchStage },
            { $group: { _id: '$rating', count: { $sum: 1 } } },
        ]),
    ]);

    const stars = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let weighted = 0;
    let rated = 0;
    for (const row of breakdown) {
        stars[row._id] = row.count;
        weighted += row._id * row.count;
        rated += row.count;
    }

    const publicNames = await liveAuthorNames(reviews);
    return {
        reviews: reviews.map((r, idx) => ({
            rating: r.rating,
            comment: r.comment,
            images: (r.images || []).map((i) => i.url),
            // First name only — a full name on a public page is more disclosure
            // than a customer expects from rating a purchase. Read from the account as it
            // is now, so a renamed customer shows under their current name.
            author: String(publicNames[idx] || '').trim().split(/\s+/)[0] || 'عميل',
            created_at: r.created_at,
            verified_purchase: true,
        })),
        summary: {
            // Averaged over the breakdown's own total, which is the same set the stars
            // were counted from — using the paginated `total` would disagree with it if
            // the two queries ever saw different data.
            rating: rated > 0 ? Number((weighted / rated).toFixed(2)) : 0,
            count: total,
            breakdown: stars,
        },
        pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) },
    };
};

module.exports = {
    INVITE_DELAY_HOURS,
    INVITE_TTL_DAYS,
    REVIEW_TEMPLATE_ID,
    reviewableItems,
    issueParcelInvite,
    sendReviewInvite,
    reviewRecipient,
    sendPendingReviewInvites,
    getParcelReviewLink,
    reviewStateForOrders,
    storeStartOfDay,
    storeHour,
    getInviteContext,
    // Exported so the image-upload route can reject a dead link BEFORE multer writes a
    // file — the upload has to be gated on exactly the credential the form is.
    assertInviteIsLive: loadLiveInvite,
    submitReviews,
    recomputeProductRating,
    listReviewsForAdmin,
    moderateReview,
    getProductReviews,
    getVendorReviews,
    reviewableVendors,
    sanitizeReviewImages,
    buildReviewUrl,
};
