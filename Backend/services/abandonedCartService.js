/**
 * Abandoned-cart reminders: one email per abandoned cart, from a daily cron.
 *
 * A cart qualifies when it holds something, has not been touched for
 * ABANDONED_CART_INACTIVITY_HOURS (`cart.updated_at` — every cart sync from the site moves
 * it, so a signed-in visit counts as activity), belongs to an active account with an email
 * that has not unsubscribed from marketing, and has no online payment in progress.
 *
 * Online status (presenceService) is a second, independent condition: a customer with a
 * socket open is skipped for this run and NOT marked, so the cart is looked at again the
 * next day. An open socket is not proof of shopping and a closed one is not proof of
 * leaving, which is why inactivity is required either way. When Redis cannot say, the
 * customer is treated as possibly online: no email.
 *
 * A "cycle" is the cart's contents plus the customer's latest order (`cycleKeyOf`). Changing
 * the cart or placing any order starts a new one, and each cycle gets at most one reminder.
 *
 * Delivery is at-most-once per cycle, by design — a missed reminder costs less than a
 * duplicate one:
 *   - a customer is claimed with compare-and-set on `abandoned_cart_reminder.version` and
 *     on `cart.updated_at`, so two instances (or two runs) can never both send, and a cart
 *     touched after it was read is not claimed;
 *   - after the claim everything is read again, and the email goes out only if nothing moved;
 *   - it is recorded as sent only once Resend has accepted it. Retries inside a run reuse one
 *     Resend idempotency key, so a timeout followed by a retry is still one email;
 *   - a refusal from Resend leaves the cycle for the next run, up to
 *     ABANDONED_CART_MAX_ATTEMPTS; a send whose outcome is unknown (no answer, or a claim that
 *     expired unrecorded after a crash) closes the cycle instead of risking a second email.
 * The window that remains: a checkout landing between the last re-check and Resend accepting
 * the message (milliseconds) still gets the email.
 */
const crypto = require('crypto');
const cron = require('node-cron');
const { User } = require('../models/users');
const { Product } = require('../models/products');
const { Order } = require('../models/orders');
const { OrderPayment } = require('../models/orderPayments');
const { AbandonedCartEmail } = require('../models/abandonedCartEmails');
const { SiteSettings } = require('../models/site_settings');

const DEFAULTS = {
    cron: '0 18 * * *',
    timezone: 'Africa/Cairo',
    inactivityHours: 24,
    cooldownDays: 7,
    maxAttempts: 3,
};
const CLAIM_MS = 10 * 60 * 1000;         // a send holds the customer this long
const RUN_LOCK_KEY = 'abandoned-cart:run-lock';
const RUN_LOCK_MS = 2 * 60 * 60 * 1000;   // longer than any run; claims guard the rest
const ORDER_LOOKBACK_DAYS = 30;          // a line bought this recently is not advertised
const MAX_EMAIL_ITEMS = 6;
const SEND_GAP_MS = 600;                 // Resend allows 2 requests a second
const SEND_TRIES = 3;

const USER_FIELDS = 'name email phone account_status marketing_emails_unsubscribed preferred_language cart abandoned_cart_reminder';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ------------------ Configuration ------------------ */

const readConfig = (env = process.env) => {
    const errors = [];
    const number = (name, fallback, min) => {
        const raw = env[name];
        if (raw === undefined || String(raw).trim() === '') return fallback;
        const value = Number(raw);
        if (!Number.isFinite(value) || value < min) {
            errors.push(`${name} must be a number of at least ${min} (got "${raw}")`);
            return fallback;
        }
        return value;
    };

    const config = {
        enabled: String(env.ABANDONED_CART_ENABLED || '').trim().toLowerCase() === 'true',
        cron: String(env.ABANDONED_CART_CRON || DEFAULTS.cron).trim(),
        timezone: String(env.ABANDONED_CART_TIMEZONE || DEFAULTS.timezone).trim(),
        inactivityHours: number('ABANDONED_CART_INACTIVITY_HOURS', DEFAULTS.inactivityHours, 1),
        cooldownDays: number('ABANDONED_CART_COOLDOWN_DAYS', DEFAULTS.cooldownDays, 0),
        maxAttempts: Math.floor(number('ABANDONED_CART_MAX_ATTEMPTS', DEFAULTS.maxAttempts, 1)),
    };
    if (!cron.validate(config.cron)) errors.push(`ABANDONED_CART_CRON is not a valid cron expression ("${config.cron}")`);
    try { new Intl.DateTimeFormat('en-US', { timeZone: config.timezone }); }
    catch (_) { errors.push(`ABANDONED_CART_TIMEZONE is not a known time zone ("${config.timezone}")`); }
    return { config, errors };
};

/* ------------------ Admin settings over the environment ------------------ */

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAILY_CRON_RE = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/;
const cronOfTime = (time) => {
    const [, h, m] = time.match(TIME_RE);
    return `${Number(m)} ${Number(h)} * * *`;
};
/** 'HH:MM' for a once-a-day cron expression, null for anything else. */
const timeOfCron = (expr) => {
    const match = String(expr || '').trim().match(DAILY_CRON_RE);
    if (!match || Number(match[1]) > 59 || Number(match[2]) > 23) return null;
    return `${String(match[2]).padStart(2, '0')}:${String(match[1]).padStart(2, '0')}`;
};

/**
 * The configuration in force: what the admin saved on the dashboard (SiteSettings
 * `abandoned_cart`), and for anything not saved there, the ABANDONED_CART_* environment.
 */
const effectiveConfig = async (env = process.env) => {
    const { config, errors } = readConfig(env);
    const doc = await SiteSettings.findOne().select('abandoned_cart').lean();
    const saved = doc?.abandoned_cart || {};
    let problems = errors;
    if (typeof saved.enabled === 'boolean') config.enabled = saved.enabled;
    if (TIME_RE.test(saved.send_time || '')) {
        config.cron = cronOfTime(saved.send_time);
        problems = problems.filter((e) => !e.startsWith('ABANDONED_CART_CRON'));
    }
    if (Number.isInteger(saved.inactivity_hours) && saved.inactivity_hours >= 1) {
        config.inactivityHours = saved.inactivity_hours;
        problems = problems.filter((e) => !e.startsWith('ABANDONED_CART_INACTIVITY_HOURS'));
    }
    config.sendTime = timeOfCron(config.cron);
    return { config, errors: problems, saved };
};

/* ------------------ Cycle ------------------ */

const cycleKeyOf = (cart, latestOrderId) => {
    const lines = (cart?.items || [])
        .map((l) => `${l.product_id || ''}:${l.variant_id || ''}:${l.bundle_id || ''}x${l.quantity}`)
        .sort();
    return crypto.createHash('sha256').update(`${lines.join('|')}#${latestOrderId || ''}`).digest('hex').slice(0, 32);
};

const latestOrderIdOf = async (userId) => {
    const order = await Order.findOne({ user_id: userId }).sort({ created_at: -1 }).select('_id').lean();
    return order?._id ? String(order._id) : null;
};

/* ------------------ Eligibility ------------------ */

const inactivityCutoff = (now, config) => new Date(now.getTime() - config.inactivityHours * 3600 * 1000);

/** Why this customer's cart is not a reminder candidate at all, or null. */
const customerSkipReason = (user, { now, config }) => {
    if (!user?.cart?.items?.length) return 'empty_cart';
    const updatedAt = user.cart.updated_at ? new Date(user.cart.updated_at) : null;
    if (!updatedAt || updatedAt > inactivityCutoff(now, config)) return 'recently_active';
    if (user.account_status !== 'active') return 'not_active_account';
    if (typeof user.email !== 'string' || !EMAIL_RE.test(user.email)) return 'no_email';
    if (user.marketing_emails_unsubscribed) return 'unsubscribed';
    return null;
};

/** Why this cycle gets no reminder now, judging only the reminder record, or null. */
const reminderSkipReason = (user, cycleKey, { now, config }) => {
    const r = user.abandoned_cart_reminder || {};
    if (r.sent_cycle_key === cycleKey) return 'already_reminded';
    if (r.gave_up_cycle_key === cycleKey) return 'gave_up';
    if (r.attempts_cycle_key === cycleKey && (r.attempts || 0) >= config.maxAttempts) return 'gave_up';
    if (r.claim_id && r.claim_expires_at && new Date(r.claim_expires_at) > now) return 'claimed_elsewhere';
    if (config.cooldownDays > 0 && r.sent_at
        && now.getTime() - new Date(r.sent_at).getTime() < config.cooldownDays * 24 * 3600 * 1000) {
        return 'cooldown';
    }
    return null;
};

/** A hosted payment opened within the inactivity window: the customer is mid-checkout. */
const checkoutInProgress = async (userId, { now, config }) => Boolean(await OrderPayment.exists({
    user_id: userId,
    status: 'pending',
    createdAt: { $gte: inactivityCutoff(now, config) },
}));

const variantLabelOf = (variant) => (variant?.selected_options || []).map((o) => o.option_value).filter(Boolean).join(' / ');

/**
 * The cart lines worth showing, as the email's items: still buyable the way the storefront
 * decides it (published, from an active vendor, in stock — the same rules as the Meta feed),
 * and not something the customer has just bought anyway.
 */
const resolveReminderItems = async (user, { now }) => {
    const { getActiveVendorIds } = require('./productService');
    const { getPublicBundleById } = require('./bundleService');
    const { formatProductForEmail } = require('./carEmailCampaignService');
    const lang = user.preferred_language === 'ar' ? 'ar' : 'en';
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const lines = user.cart?.items || [];

    const productIds = [...new Set(lines.filter((l) => l.product_id && !l.bundle_id).map((l) => String(l.product_id)))];
    const [activeVendorIds, recentOrders] = await Promise.all([
        getActiveVendorIds(),
        Order.find({ user_id: user._id, created_at: { $gte: new Date(now.getTime() - ORDER_LOOKBACK_DAYS * 24 * 3600 * 1000) } })
            .select('items.product_id items.variant_id items.bundle_id').lean(),
    ]);
    const products = productIds.length === 0 ? [] : await Product.find({
        _id: { $in: productIds },
        status: 'published',
        vendor_id: { $in: activeVendorIds },
    }).select('title_en title_ar slug_en slug_ar images price discount_price stock_management quantity variants').lean();
    const productById = new Map(products.map((p) => [String(p._id), p]));

    const ordered = new Set();
    for (const order of recentOrders) {
        for (const item of order.items || []) {
            if (item.bundle_id) ordered.add(`b:${item.bundle_id}`);
            if (item.product_id) ordered.add(`p:${item.product_id}:${item.variant_id || ''}`);
        }
    }

    const items = [];
    for (const line of lines) {
        if (line.bundle_id) {
            if (ordered.has(`b:${line.bundle_id}`)) continue;
            const bundle = await getPublicBundleById(line.bundle_id);
            if (!bundle || !bundle.is_purchasable) continue;
            const card = formatProductForEmail(bundle, lang);
            const slug = (lang === 'ar' ? bundle.slug_ar : bundle.slug_en) || bundle.slug_ar || bundle.slug_en || String(bundle._id);
            items.push({
                title: card.title,
                variantLabel: '',
                imageUrl: card.imageUrl,
                link: `${frontendUrl}/${lang}/bundle/${encodeURIComponent(slug)}`,
                quantity: line.quantity,
                price: bundle.pricing?.effective ?? 0,
            });
            continue;
        }

        const product = line.product_id ? productById.get(String(line.product_id)) : null;
        if (!product) continue;
        if (ordered.has(`p:${line.product_id}:${line.variant_id || ''}`)) continue;

        let price = product.discount_price ?? product.price;
        let variantLabel = '';
        if (line.variant_id) {
            const variant = (product.variants || []).find((v) => String(v._id) === String(line.variant_id));
            if (!variant) continue;
            if (product.stock_management && !(Number(variant.stock) > 0)) continue;
            price = variant.discount_price ?? variant.price ?? price;
            variantLabel = variantLabelOf(variant);
        } else if (product.stock_management
            && !(Number(product.quantity) > 0)
            && !(product.variants || []).some((v) => Number(v.stock) > 0)) {
            continue;
        }

        const card = formatProductForEmail(product, lang);
        items.push({ title: card.title, variantLabel, imageUrl: card.imageUrl, link: card.link, quantity: line.quantity, price });
    }

    return {
        items: items.slice(0, MAX_EMAIL_ITEMS),
        moreCount: Math.max(0, items.length - MAX_EMAIL_ITEMS),
        total: Math.round(items.reduce((sum, i) => sum + (Number(i.price) || 0) * (Number(i.quantity) || 1), 0) * 100) / 100,
        lang,
    };
};

/* ------------------ Claim and record (compare-and-set on version) ------------------ */

const REMINDER = 'abandoned_cart_reminder';
const clearClaim = {
    [`${REMINDER}.claim_id`]: null,
    [`${REMINDER}.claim_cycle_key`]: null,
    [`${REMINDER}.claim_expires_at`]: null,
};

const claimCustomer = async (user, cycleKey, claimId, now) => {
    const res = await User.updateOne(
        {
            _id: user._id,
            'cart.updated_at': user.cart.updated_at,
            [`${REMINDER}.version`]: user[REMINDER]?.version ?? null,
        },
        {
            $set: {
                [`${REMINDER}.claim_id`]: claimId,
                [`${REMINDER}.claim_cycle_key`]: cycleKey,
                [`${REMINDER}.claim_expires_at`]: new Date(now.getTime() + CLAIM_MS),
                [`${REMINDER}.last_attempt_at`]: now,
            },
            $inc: { [`${REMINDER}.version`]: 1 },
        },
    );
    return res.modifiedCount === 1;
};

const releaseClaim = (userId, claimId) => User.updateOne(
    { _id: userId, [`${REMINDER}.claim_id`]: claimId },
    { $set: clearClaim, $inc: { [`${REMINDER}.version`]: 1 } },
);

const recordSent = async (userId, claimId, cycleKey, providerId, now) => {
    const sent = {
        [`${REMINDER}.sent_cycle_key`]: cycleKey,
        [`${REMINDER}.sent_at`]: now,
        [`${REMINDER}.provider_message_id`]: providerId || null,
        [`${REMINDER}.last_error`]: null,
    };
    const res = await User.updateOne(
        { _id: userId, [`${REMINDER}.claim_id`]: claimId },
        { $set: { ...sent, ...clearClaim }, $inc: { [`${REMINDER}.version`]: 1 } },
    );
    // The claim expired and was settled meanwhile. The email did go out, so that is still
    // what the record must say.
    if (res.matchedCount === 0) {
        await User.updateOne({ _id: userId }, { $set: sent, $inc: { [`${REMINDER}.version`]: 1 } });
    }
};

const recordFailure = async (user, claimId, cycleKey, { error, outcomeKnown }, config) => {
    const r = user[REMINDER] || {};
    const attempts = (r.attempts_cycle_key === cycleKey ? (r.attempts || 0) : 0) + 1;
    const giveUp = !outcomeKnown ? 'outcome_unknown' : (attempts >= config.maxAttempts ? 'attempts_exhausted' : null);
    await User.updateOne(
        { _id: user._id, [`${REMINDER}.claim_id`]: claimId },
        {
            $set: {
                ...clearClaim,
                [`${REMINDER}.attempts`]: attempts,
                [`${REMINDER}.attempts_cycle_key`]: cycleKey,
                [`${REMINDER}.last_error`]: String(error?.message || error).slice(0, 500),
                ...(giveUp ? { [`${REMINDER}.gave_up_cycle_key`]: cycleKey, [`${REMINDER}.gave_up_reason`]: giveUp } : {}),
            },
            $inc: { [`${REMINDER}.version`]: 1 },
        },
    );
};

/**
 * A claim that expired without a recorded result: the instance stopped somewhere between
 * claiming and recording, and nobody knows whether Resend accepted the email. That cycle is
 * closed — retrying could send it twice. Returns the customer as they are afterwards.
 */
const settleExpiredClaim = async (user, now) => {
    const r = user[REMINDER];
    if (!r?.claim_id || !r.claim_expires_at || new Date(r.claim_expires_at) > now) return user;
    await User.updateOne(
        { _id: user._id, [`${REMINDER}.version`]: r.version, [`${REMINDER}.claim_id`]: r.claim_id },
        {
            $set: {
                ...clearClaim,
                [`${REMINDER}.gave_up_cycle_key`]: r.claim_cycle_key,
                [`${REMINDER}.gave_up_reason`]: 'outcome_unknown',
                [`${REMINDER}.last_error`]: 'A send was claimed and its result never recorded',
            },
            $inc: { [`${REMINDER}.version`]: 1 },
        },
    );
    console.warn(`[AbandonedCart] User ${user._id}: an unrecorded send expired; that cart gets no further reminder.`);
    return User.findById(user._id).select(USER_FIELDS).lean();
};

/**
 * The admin report's row for this attempt (models/abandonedCartEmails.js). Best effort: it is
 * written after the outcome is recorded on the customer, and losing it loses a report line,
 * never the guard against a second email.
 */
const logEmail = async (user, { status, items, moreCount, total, lang, cycleKey, attempt, providerId = null, error = null, now }) => {
    try {
        await AbandonedCartEmail.create({
            user_id: user._id,
            customer_name: user.name || '',
            email: user.email || '',
            phone: user.phone || '',
            language: lang,
            status,
            items: items.map((i) => ({
                title: i.title, variant_label: i.variantLabel || '', quantity: i.quantity,
                price: i.price, link: i.link, image_url: i.imageUrl,
            })),
            more_count: moreCount,
            items_total: total,
            cycle_key: cycleKey,
            attempt,
            provider_message_id: providerId,
            error: error ? String(error).slice(0, 500) : null,
            created_at: now,
        });
    } catch (err) {
        console.error(`[AbandonedCart] Could not log the email to user ${user._id}: ${err.message}`);
    }
};

/* ------------------ Sending ------------------ */

// Errors that prove the request never reached Resend, so nothing can have been sent.
const NEVER_REACHED = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH']);
const neverReached = (err) => Boolean(err.notSent) || NEVER_REACHED.has(err.code);
// No answer, and no proof it never arrived: Resend may have accepted it.
const outcomeUnknown = (err) => !err.statusCode && !neverReached(err);
const isRetryable = (err) => !err.notSent && (!err.statusCode || err.statusCode === 429 || err.statusCode >= 500);

/**
 * Up to SEND_TRIES with one idempotency key. `outcomeKnown` is false when any try went
 * unanswered: Resend may have accepted it, so the cycle must not be retried later.
 */
const sendWithRetries = async (send, args, { retryDelayMs }) => {
    let lastError = null;
    let anyUnanswered = false;
    for (let attempt = 1; attempt <= SEND_TRIES; attempt += 1) {
        try {
            return { ok: true, response: await send(args) };
        } catch (err) {
            lastError = err;
            if (outcomeUnknown(err)) anyUnanswered = true;
            if (!isRetryable(err) || attempt === SEND_TRIES) break;
            if (retryDelayMs > 0) await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
        }
    }
    return { ok: false, error: lastError, outcomeKnown: !anyUnanswered };
};

/* ------------------ One customer ------------------ */

const isConnected = async (presence, userId) => {
    try {
        return { known: true, connected: await presence.isUserConnected(userId) };
    } catch (err) {
        return { known: false, error: err };
    }
};

/** Is everything that justified the claim still true? Read fresh from the database. */
const stillEligibleAfterClaim = async (claimed, cycleKey, ctx) => {
    const fresh = await User.findById(claimed._id).select(USER_FIELDS).lean();
    if (!fresh || customerSkipReason(fresh, ctx)) return false;
    if (+new Date(fresh.cart.updated_at) !== +new Date(claimed.cart.updated_at)) return false;
    if (cycleKeyOf(fresh.cart, await latestOrderIdOf(fresh._id)) !== cycleKey) return false;
    return !(await checkoutInProgress(fresh._id, ctx));
};

const processCandidate = async (candidate, ctx) => {
    const { now, config, presence, sendEmail, dryRun } = ctx;

    // 1. A cheap first look, from the candidate as the sweep read it.
    const early = customerSkipReason(candidate, ctx)
        || reminderSkipReason(candidate, cycleKeyOf(candidate.cart, await latestOrderIdOf(candidate._id)), ctx);
    if (early) return early;

    // 2. Online right now? "Unknown" is not "offline".
    const online = await isConnected(presence, candidate._id);
    if (!online.known) {
        ctx.presenceErrors.push(online.error.message);
        return 'presence_unknown';
    }
    if (online.connected) return 'connected';

    // 3. Everything again, freshly read.
    let user = await User.findById(candidate._id).select(USER_FIELDS).lean();
    if (!user) return 'gone';
    user = await settleExpiredClaim(user, now);
    const reason = customerSkipReason(user, ctx);
    if (reason) return reason;
    const cycleKey = cycleKeyOf(user.cart, await latestOrderIdOf(user._id));
    const stateReason = reminderSkipReason(user, cycleKey, ctx);
    if (stateReason) return stateReason;
    if (await checkoutInProgress(user._id, ctx)) return 'checkout_in_progress';
    const { items, moreCount, total, lang } = await resolveReminderItems(user, ctx);
    if (items.length === 0) return 'no_available_items';
    if (dryRun) {
        console.log(`[AbandonedCart] (dry run) would remind user ${user._id} <${user.email}> about ${items.length + moreCount} item(s).`);
        return 'would_send';
    }

    // 4. Claim it; lose to anyone who touched the customer or the cart since the read.
    const claimId = crypto.randomUUID();
    if (!(await claimCustomer(user, cycleKey, claimId, now))) return 'claim_lost';

    // 5. Nothing moved while claiming, and still offline?
    if (!(await stillEligibleAfterClaim(user, cycleKey, ctx))) {
        await releaseClaim(user._id, claimId);
        return 'changed_during_processing';
    }
    const again = await isConnected(presence, user._id);
    if (!again.known || again.connected) {
        await releaseClaim(user._id, claimId);
        if (!again.known) ctx.presenceErrors.push(again.error.message);
        return again.known ? 'connected' : 'presence_unknown';
    }

    // 6. Send, and record only what Resend accepted.
    const r = user[REMINDER] || {};
    const attemptNo = (r.attempts_cycle_key === cycleKey ? (r.attempts || 0) : 0) + 1;
    const { generateUnsubscribeToken } = require('./carEmailCampaignService');
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const backendUrl = (process.env.BACKEND_PUBLIC_URL || process.env.BACKEND_URL || 'http://localhost:4000').replace(/\/+$/, '');
    const unsubscribeUrl = `${backendUrl}/api/admin/car-campaigns/unsubscribe?uid=${user._id}&email=${encodeURIComponent(user.email)}&token=${generateUnsubscribeToken(String(user._id), user.email)}`;

    const result = await sendWithRetries(sendEmail, {
        to: user.email,
        name: user.name,
        items,
        moreCount,
        cartUrl: `${frontendUrl}/${lang}/checkout`,
        unsubscribeUrl,
        language: lang,
        idempotencyKey: `abandoned-cart/${user._id}/${cycleKey}/${attemptNo}`,
    }, ctx);

    const logged = { items, moreCount, total, lang, cycleKey, attempt: attemptNo, now };
    if (result.ok) {
        await recordSent(user._id, claimId, cycleKey, result.response?.id, now);
        await logEmail(user, { ...logged, status: 'sent', providerId: result.response?.id || null });
        console.log(`[AbandonedCart] Reminded user ${user._id} (${items.length + moreCount} item(s)).`);
        return 'sent';
    }
    await recordFailure(user, claimId, cycleKey, result, config);
    await logEmail(user, { ...logged, status: result.outcomeKnown ? 'failed' : 'outcome_unknown', error: result.error?.message });
    console.error(`[AbandonedCart] Reminder to user ${user._id} failed${result.outcomeKnown ? '' : ' with an unknown outcome'}: ${result.error?.message}`);
    return result.outcomeKnown ? 'send_failed' : 'send_outcome_unknown';
};

/* ------------------ The run ------------------ */

let running = false;

const defaultSend = (args) => require('./emailService').sendAbandonedCartEmail(args);
const defaultLock = (key, ttlMs) => require('./redisClient').acquireLock(key, ttlMs);

/** One sweep; see runAbandonedCartReminders. */
const sweep = async ({
    now = new Date(),
    config,
    presence = require('./presenceService'),
    sendEmail = defaultSend,
    acquireLock = defaultLock,
    dryRun = false,
    sendGapMs = SEND_GAP_MS,
    retryDelayMs = 1500,
} = {}) => {
    if (running) return { skipped: 'already_running' };
    running = true;
    let release = null;
    try {
        if (!config) config = (await effectiveConfig()).config;
        if (!dryRun && sendEmail === defaultSend && !process.env.RESEND_TOKEN) {
            console.error('[AbandonedCart] Skipped: RESEND_TOKEN is not configured.');
            return { skipped: 'email_not_configured' };
        }
        // Without Redis nobody can say who is online, and "unknown" never means "offline".
        try { await presence.ping(); }
        catch (err) {
            console.error(`[AbandonedCart] Skipped: online status cannot be checked (${err.message}).`);
            return { skipped: 'presence_unavailable' };
        }
        if (acquireLock) {
            try { release = await acquireLock(RUN_LOCK_KEY, RUN_LOCK_MS); }
            catch (err) {
                console.error(`[AbandonedCart] Skipped: run lock unavailable (${err.message}).`);
                return { skipped: 'lock_unavailable' };
            }
            if (!release) return { skipped: 'locked' };
        }

        const ctx = { now, config, presence, sendEmail, dryRun, retryDelayMs, presenceErrors: [] };
        const counts = {};
        const cursor = User.find({
            'cart.items.0': { $exists: true },
            'cart.updated_at': { $lte: inactivityCutoff(now, config) },
            account_status: 'active',
            email: { $type: 'string' },
            marketing_emails_unsubscribed: { $ne: true },
        }).select(USER_FIELDS).sort({ 'cart.updated_at': 1 }).lean().cursor();

        for await (const candidate of cursor) {
            let outcome;
            try { outcome = await processCandidate(candidate, ctx); }
            catch (err) {
                console.error(`[AbandonedCart] User ${candidate._id}: ${err.message}`);
                outcome = 'error';
            }
            counts[outcome] = (counts[outcome] || 0) + 1;
            if ((outcome === 'sent' || outcome.startsWith('send_')) && sendGapMs > 0) {
                await new Promise((r) => setTimeout(r, sendGapMs));
            }
        }

        if (ctx.presenceErrors.length > 0) {
            console.error(`[AbandonedCart] Online status unknown for ${ctx.presenceErrors.length} customer(s), not emailed: ${ctx.presenceErrors[0]}`);
        }
        console.log(`[AbandonedCart] Run finished${dryRun ? ' (dry run)' : ''}: ${JSON.stringify(counts)}`);
        return { counts };
    } finally {
        if (release) await release();
        running = false;
    }
};

/**
 * One sweep. Everything it depends on can be handed in (tests, the manual script); the
 * defaults are the real ones, and the configuration defaults to the one in force
 * (effectiveConfig). Returns counts per outcome, or { skipped: reason }.
 *
 * A real run (the real mailer, not a dry run) leaves its result on SiteSettings for the
 * admin's page: when it ran, and what it did or why it did not.
 */
const runAbandonedCartReminders = async (options = {}) => {
    const result = await sweep(options);
    const real = !options.dryRun && (options.sendEmail === undefined || options.sendEmail === defaultSend);
    if (real && result.skipped !== 'already_running' && result.skipped !== 'locked') {
        await SiteSettings.updateOne({}, {
            $set: { 'abandoned_cart.last_run_at': options.now || new Date(), 'abandoned_cart.last_run_result': result },
        }).catch((err) => console.error(`[AbandonedCart] Could not record the run: ${err.message}`));
    }
    return result;
};

/* ------------------ Schedule ------------------ */

let task = null;
let scheduledKey = null;
let scheduler = null; // the cron library, once this process runs the schedule at all

/**
 * Make the node-cron task match the configuration in force. Called every minute and right
 * after the admin saves, so a new time (or switching it off) applies without a restart, on
 * every instance. Several instances each holding a task is fine: the run lock and the
 * per-customer claims make the duplicates harmless.
 */
const syncSchedule = async (cronLib = cron) => {
    const { config, errors } = await effectiveConfig();
    const key = config.enabled && errors.length === 0 ? `${config.cron}|${config.timezone}` : null;
    if (key === scheduledKey) return;
    if (task) task.stop();
    task = null;
    scheduledKey = key;
    if (!config.enabled) {
        console.log('[Cron] Abandoned-cart reminders are off.');
        return;
    }
    if (errors.length > 0) {
        console.error(`[Cron] Abandoned-cart reminders NOT scheduled: ${errors.join('; ')}`);
        return;
    }
    task = cronLib.schedule(config.cron, () => {
        runAbandonedCartReminders()
            .catch((err) => console.error('[Cron] Abandoned-cart reminders failed:', err.message));
    }, { timezone: config.timezone });
    console.log(`[Cron] Abandoned-cart reminders scheduled ("${config.cron}", ${config.timezone}, after ${config.inactivityHours}h idle).`);
};

/** Start the schedule, and keep it following the admin's settings. */
const scheduleAbandonedCartReminders = (cronLib = cron) => {
    scheduler = cronLib;
    const sync = () => syncSchedule(cronLib)
        .catch((err) => console.error('[Cron] Abandoned-cart schedule check failed:', err.message));
    sync();
    cronLib.schedule('* * * * *', sync);
};

/* ------------------ The admin's page ------------------ */

/** Wall-clock parts of `date` in `timeZone`. */
const wallClock = (date, timeZone) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(date).map((p) => [p.type, p.value]));
    return { y: +parts.year, mo: +parts.month, d: +parts.day, h: +parts.hour, mi: +parts.minute };
};

/** The instant a wall-clock time on a calendar day happens in `timeZone`. */
const zonedInstant = ({ y, mo, d }, h, mi, timeZone) => {
    const guess = Date.UTC(y, mo - 1, d, h, mi);
    const seen = wallClock(new Date(guess), timeZone);
    const offset = Date.UTC(seen.y, seen.mo - 1, seen.d, seen.h, seen.mi) - guess;
    return new Date(guess - offset);
};

/** The next time the daily run fires, or null when it is off or not a once-a-day time. */
const nextRunAt = (config, now = new Date()) => {
    if (!config.enabled || !config.sendTime) return null;
    const [h, mi] = config.sendTime.split(':').map(Number);
    const today = wallClock(now, config.timezone);
    let next = zonedInstant(today, h, mi, config.timezone);
    if (next <= now) {
        const tomorrow = wallClock(new Date(next.getTime() + 26 * 3600 * 1000), config.timezone);
        next = zonedInstant(tomorrow, h, mi, config.timezone);
    }
    return next;
};

/** What the admin's schedule card shows. */
const getScheduleSettings = async () => {
    const { config, errors, saved } = await effectiveConfig();
    return {
        enabled: config.enabled,
        send_time: config.sendTime,
        inactivity_hours: config.inactivityHours,
        timezone: config.timezone,
        next_run_at: errors.length === 0 ? nextRunAt(config) : null,
        last_run_at: saved.last_run_at || null,
        last_run_result: saved.last_run_result || null,
        problems: errors,
    };
};

/**
 * Save the admin's schedule: { enabled, send_time 'HH:MM', inactivity_hours }. Any of them
 * may be left out. Throws an error with `code: 'INVALID'` for a bad value.
 */
const updateScheduleSettings = async (patch = {}) => {
    const invalid = (message) => Object.assign(new Error(message), { code: 'INVALID' });
    const set = {};
    if (patch.enabled !== undefined) {
        if (typeof patch.enabled !== 'boolean') throw invalid('enabled must be true or false');
        set['abandoned_cart.enabled'] = patch.enabled;
    }
    if (patch.send_time !== undefined) {
        if (!TIME_RE.test(String(patch.send_time))) throw invalid('send_time must be HH:MM (24-hour)');
        set['abandoned_cart.send_time'] = String(patch.send_time);
    }
    if (patch.inactivity_hours !== undefined) {
        const hours = Number(patch.inactivity_hours);
        if (!Number.isInteger(hours) || hours < 1 || hours > 720) throw invalid('inactivity_hours must be a whole number from 1 to 720');
        set['abandoned_cart.inactivity_hours'] = hours;
    }
    if (Object.keys(set).length === 0) throw invalid('Nothing to save');

    const before = await getScheduleSettings();
    if (!(await SiteSettings.exists({}))) await SiteSettings.create({});
    await SiteSettings.updateOne({}, { $set: set });
    // This instance at once (when it runs the schedule); the others within a minute.
    if (scheduler) await syncSchedule(scheduler);
    return { before, after: await getScheduleSettings() };
};

module.exports = {
    readConfig,
    effectiveConfig,
    runAbandonedCartReminders,
    scheduleAbandonedCartReminders,
    getScheduleSettings,
    updateScheduleSettings,
    _test: { nextRunAt, timeOfCron, cycleKeyOf, customerSkipReason, reminderSkipReason, resolveReminderItems, sendWithRetries, claimCustomer, RUN_LOCK_KEY },
};
