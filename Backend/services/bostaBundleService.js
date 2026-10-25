/**
 * Bosta Bundle Service
 * --------------------
 * What a Bosta parcel costs us now that the account runs on prepaid bundles, and how much
 * of the bundle is left before shipping stops.
 *
 * WHAT CHANGED. `bostaTariff` prices a parcel by destination sector and size — 97 EGP to
 * Cairo, 140 to Aswan, 564 for a heavy-bulky box. That is still what Bosta LISTS, and it is
 * still what a parcel would cost without a bundle. It is no longer what we pay. On a bundle,
 * Bosta's own calculator discounts the whole shipping fee of every destination and every
 * size to zero (verified 2026-09-20 across sectors 1..7 and all three declarable sizes), and
 * takes one parcel off the balance instead. A parcel to Aswan and a parcel to Cairo cost
 * exactly the same thing: one of the twenty.
 *
 * So the cost of a Bosta parcel is the CREDIT PRICE — what the bundle cost divided by how
 * many parcels it carries, 2000/20 = 100 EGP — and the tariff is kept only as the list price
 * we are being spared.
 *
 * WHAT IS STILL CASH. The bundle covers the shipping fee and nothing else. The COD
 * collection fee (1% of the COD above 2000, plus VAT), the 70 EGP fee for a courier visit
 * that collects fewer than two parcels, Bosta's own packaging, opening-package and extra
 * weight are all billed on top and come out of the money Bosta holds for us.
 *
 * TWO WAYS A BUNDLE ENDS, and both cost money:
 *
 *   it runs out   shipping stops dead until another is bought — Bosta does not fall back
 *                 to the per-parcel tariff on this account.
 *   it expires    on its date, WITH whatever is left on it. Nothing rolls over. The cycle
 *                 before this one was bought for 20 parcels and used 11: 900 EGP expired.
 *
 * Which is why this module's other job is warning early enough to act, and recording the
 * waste when it happens anyway rather than letting it vanish into "shipping costs".
 */

const bostaService = require("./bostaService");
const { BostaBundleCycle } = require("../models/bostaBundles");
const { ShippingSettings } = require("../models/shipping_settings");
const { createNotification } = require("../models/notifications");

const round2 = (n) => Number((Number(n) || 0).toFixed(2));
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a mirrored bundle may be trusted before the dispatch path re-reads it.
 *
 * Short, because the number it feeds — how many parcels are left — is the one that decides
 * whether shipping is about to stop. Long enough that a burst of dispatches does not open a
 * Bosta call each.
 */
const FRESH_MS = 5 * 60 * 1000;

/* ------------------------------------------------------------------ */
/*  Sync                                                              */
/* ------------------------------------------------------------------ */

const creditPriceOf = (paid, total) => (Number(total) > 0 ? round2(Number(paid || 0) / Number(total)) : 0);

/** Bosta's `subscriptions/current` shape -> our row. */
const fromSubscription = (s) => ({
    subscription_id: Number(s.id),
    bundle_id: s.bundle_id ?? null,
    name_ar: s.bundleNameAr || "",
    name_en: s.bundleNameEn || "",
    paid_amount: Number(s.paid_amount || 0),
    total_orders: Number(s.bundle_total_orders || 0),
    consumed_orders: Number(s.consumed_orders || 0),
    credit_price: creditPriceOf(s.paid_amount, s.bundle_total_orders),
    started_at: s.created_at ? new Date(s.created_at) : null,
    expires_at: s.expire_at ? new Date(s.expire_at) : null,
    auto_renewal: !!s.isAutoRenewal || Number(s.auto_renewal) === 1,
    synced_at: new Date(),
});

/** Bosta's `payment-logs` shape -> our row. Past cycles arrive only in this shape. */
const fromPaymentLog = (log) => ({
    subscription_id: Number(log.subscriptionId),
    name_ar: log.bundleNameAr || "",
    name_en: log.bundleNameEn || "",
    paid_amount: Number(log.paidAmount || 0),
    total_orders: Number(log.numberOfBundleOrders || 0),
    consumed_orders: Number(log.numberOfConsumedOrders || 0),
    credit_price: creditPriceOf(log.paidAmount, log.numberOfBundleOrders),
    started_at: log.startDate ? new Date(log.startDate) : null,
    expires_at: log.expiryDate ? new Date(log.expiryDate) : null,
    synced_at: new Date(),
});

/**
 * Where a cycle stands, from its own numbers rather than from Bosta's wording.
 *
 * Derived here and not read off the API because a past cycle, which only ever appears in
 * the payment log, carries no status field at all — and the two sources have to agree or
 * the history and the headline would tell different stories.
 */
const statusOf = (row, now = new Date()) => {
    if (Number(row.consumed_orders || 0) >= Number(row.total_orders || 0) && Number(row.total_orders || 0) > 0) {
        return "consumed";
    }
    if (row.expires_at && new Date(row.expires_at) <= now) return "expired";
    return "active";
};

/**
 * Pull the account's bundle state from Bosta and mirror it.
 *
 * Idempotent: every row is an upsert on Bosta's subscription id, so this can run on a cron,
 * on demand from the admin screen, and in the dispatch path without any of them stepping on
 * the others.
 *
 * `wasted_*` is written ONCE, at the moment a cycle stops being active. Recomputing it on
 * every sync would be harmless today and wrong the day Bosta reworks the payment log — and
 * a loss that restates itself is not a loss anyone can act on.
 */
const syncFromBosta = async () => {
    const now = new Date();
    const seen = new Map();

    // The payment log is the complete history; `current` is the only place a live cycle's
    // consumption is up to date. Read both, let `current` win where they overlap.
    const logs = await bostaService.listBundlePaymentLogs().catch((err) => {
        console.error(`[BostaBundle] Could not read payment logs: ${err.message}`);
        return null;
    });
    for (const log of logs || []) {
        const row = fromPaymentLog(log);
        if (row.subscription_id) seen.set(row.subscription_id, row);
    }

    const current = await bostaService.getCurrentBundleSubscription().catch((err) => {
        console.error(`[BostaBundle] Could not read current subscription: ${err.message}`);
        return null;
    });
    if (current?.id) {
        const row = fromSubscription(current);
        seen.set(row.subscription_id, { ...(seen.get(row.subscription_id) || {}), ...row });
    }

    // Neither call answered: leave the mirror exactly as it was. An empty sync must never
    // be mistaken for "the bundle is gone" — that would price parcels off the tariff and
    // silence the balance warnings at the very moment Bosta is unreachable.
    if (!logs && !current) return { synced: 0, closed: 0, ok: false };

    let closed = 0;

    // The day a cycle's leftovers were actually lost — its own expiry date, not the day we
    // noticed. The P&L dates the waste by this, and a first sync that discovered three old
    // cycles at once would otherwise dump all of their losses into this month.
    const lostOn = (row) => (row.expires_at && new Date(row.expires_at) < now ? new Date(row.expires_at) : now);

    for (const row of seen.values()) {
        const existing = await BostaBundleCycle.findOne({ subscription_id: row.subscription_id });
        const status = statusOf({ ...(existing?.toObject?.() || {}), ...row }, now);

        if (!existing) {
            const doc = new BostaBundleCycle({ ...row, status });
            if (status !== "active") {
                doc.closed_at = lostOn(doc);
                doc.wasted_orders = Math.max(0, Number(doc.total_orders || 0) - Number(doc.consumed_orders || 0));
                doc.wasted_amount = round2(doc.wasted_orders * Number(doc.credit_price || 0));
                closed += 1;
            }
            await doc.save();
            continue;
        }

        Object.assign(existing, row);

        // The cycle has just stopped being active: freeze what it wasted, once.
        if (status !== "active" && existing.status === "active") {
            existing.closed_at = lostOn(existing);
            existing.wasted_orders = Math.max(0, Number(existing.total_orders || 0) - Number(existing.consumed_orders || 0));
            existing.wasted_amount = round2(existing.wasted_orders * Number(existing.credit_price || 0));
            closed += 1;
        }
        existing.status = status;
        await existing.save();
    }

    return { synced: seen.size, closed, ok: true };
};

/* ------------------------------------------------------------------ */
/*  Reading the live bundle                                           */
/* ------------------------------------------------------------------ */

/**
 * The bundle a parcel dispatched RIGHT NOW would be billed against, refreshing the mirror
 * when it has gone stale.
 *
 * Returns null when there is no live bundle — which is a real state, not an error: it means
 * Bosta will not accept another parcel until one is bought.
 */
const getActiveCycle = async ({ maxAgeMs = FRESH_MS } = {}) => {
    const now = new Date();
    let cycle = await BostaBundleCycle.findOne({ status: "active" }).sort({ started_at: -1 }).lean();

    const stale = !cycle || !cycle.synced_at || now - new Date(cycle.synced_at) > maxAgeMs;
    if (stale) {
        await syncFromBosta().catch((err) => console.error(`[BostaBundle] Sync failed: ${err.message}`));
        cycle = await BostaBundleCycle.findOne({ status: "active" }).sort({ started_at: -1 }).lean();
    }

    if (!cycle) return null;
    // A mirror that has not been re-read since the cycle's own expiry date is not evidence
    // that the cycle is still alive.
    if (cycle.expires_at && new Date(cycle.expires_at) <= now) return null;
    return cycle;
};

/**
 * How to price a Bosta parcel being dispatched now.
 *
 * `mode: "bundle"` is the normal answer and carries the credit price to stamp on it.
 * `mode: "tariff"` means no live bundle could be established — either none is active or
 * Bosta could not be reached — and the caller falls back to the list tariff, which is an
 * over-estimate rather than a silent zero.
 */
const pricingForDispatch = async () => {
    const cycle = await getActiveCycle().catch(() => null);
    if (!cycle || !(Number(cycle.credit_price) > 0)) return { mode: "tariff", credit_price: 0, subscription_id: null };

    return {
        mode: "bundle",
        credit_price: round2(cycle.credit_price),
        subscription_id: cycle.subscription_id,
        remaining_orders: Math.max(0, Number(cycle.total_orders || 0) - Number(cycle.consumed_orders || 0)),
    };
};

/* ------------------------------------------------------------------ */
/*  Alerts                                                            */
/* ------------------------------------------------------------------ */

const notifyAdmins = async (type, title, message, data) => {
    try {
        const { User } = require("../models/users");
        const admins = await User.find({ role: "admin" }).select("_id").lean();
        await Promise.allSettled(admins.map((a) => createNotification(a._id, type, title, message, data)));
    } catch (err) {
        console.error(`[BostaBundle] Admin notification failed: ${err.message}`);
    }
};

/**
 * Warn about a bundle that is about to end, early enough to do something about it.
 *
 * Three separate warnings, each sent once per cycle, because they need three different
 * reactions:
 *
 *   running low    buy the next bundle before shipping stops.
 *   expiring       either ship the parcels still on it or accept losing them.
 *   depleted       nothing ships until a bundle is bought. This one is an outage.
 *
 * Stamped on the cycle rather than counted, so a sweep that runs every hour does not
 * re-send, and a new cycle starts with a clean slate.
 */
const runBundleAlertSweep = async () => {
    const settings = await ShippingSettings.findOne().lean();
    const lowOrders = Number(settings?.bundle_low_orders_threshold ?? 5);
    const lowDays = Number(settings?.bundle_low_days_threshold ?? 5);

    await syncFromBosta().catch((err) => console.error(`[BostaBundle] Alert sweep sync failed: ${err.message}`));

    const now = new Date();
    const cycle = await BostaBundleCycle.findOne({ status: "active" }).sort({ started_at: -1 });

    // No live bundle at all — the outage case. Warned about once a day rather than once
    // ever, because it does not resolve itself and every day it lasts is a day of no shipping.
    if (!cycle) {
        const lastAlert = await BostaBundleCycle.findOne({ depleted_alert_at: { $ne: null } })
            .sort({ depleted_alert_at: -1 })
            .lean();
        if (!lastAlert?.depleted_alert_at || now - new Date(lastAlert.depleted_alert_at) > DAY_MS) {
            await notifyAdmins(
                "bosta_bundle_depleted",
                "لا توجد باقة شحن فعّالة",
                "رصيد باقة بوسطة انتهى أو الباقة خلصت مدتها. الشحن متوقف لحد ما تشتري باقة جديدة.",
                { remaining_orders: 0 }
            );
            // Stamped on the most recent cycle so the once-a-day rhythm has somewhere to live.
            const latest = await BostaBundleCycle.findOne().sort({ started_at: -1 });
            if (latest) { latest.depleted_alert_at = now; await latest.save(); }
        }
        return { alerted: "depleted" };
    }

    const remaining = Math.max(0, Number(cycle.total_orders || 0) - Number(cycle.consumed_orders || 0));
    const daysLeft = cycle.expires_at
        ? Math.max(0, Math.ceil((new Date(cycle.expires_at) - now) / DAY_MS))
        : null;
    const sent = [];

    if (remaining <= 0 && !cycle.depleted_alert_at) {
        await notifyAdmins(
            "bosta_bundle_depleted",
            "رصيد باقة بوسطة خلص",
            `${cycle.name_ar || cycle.name_en} استهلكت الـ${cycle.total_orders} شحنة كلها. الشحن هيقف لحد ما تشتري باقة جديدة.`,
            { subscription_id: cycle.subscription_id, remaining_orders: 0 }
        );
        cycle.depleted_alert_at = now;
        sent.push("depleted");
    } else if (remaining > 0 && remaining <= lowOrders && !cycle.low_orders_alert_at) {
        await notifyAdmins(
            "bosta_bundle_low",
            "رصيد باقة بوسطة قرب يخلص",
            `فاضل ${remaining} شحنة بس في ${cycle.name_ar || cycle.name_en}. اشتري الباقة الجاية قبل ما الشحن يقف.`,
            { subscription_id: cycle.subscription_id, remaining_orders: remaining }
        );
        cycle.low_orders_alert_at = now;
        sent.push("low_orders");
    }

    // The expiry warning names the parcels at risk, because "your bundle expires in 5 days"
    // is not actionable and "you are about to lose 9 parcels worth 900 EGP" is.
    if (daysLeft !== null && daysLeft <= lowDays && remaining > 0 && !cycle.expiry_alert_at) {
        await notifyAdmins(
            "bosta_bundle_expiring",
            "باقة بوسطة قرب تخلص مدتها",
            `فاضل ${daysLeft} يوم على انتهاء ${cycle.name_ar || cycle.name_en}، ولسه عندك ${remaining} شحنة متستخدمتش ` +
            `(قيمتها ${round2(remaining * Number(cycle.credit_price || 0))} ج). الشحنات دي بتضيع ومش بتترحّل للباقة الجاية.`,
            {
                subscription_id: cycle.subscription_id,
                days_left: daysLeft,
                remaining_orders: remaining,
                value_at_risk: round2(remaining * Number(cycle.credit_price || 0)),
            }
        );
        cycle.expiry_alert_at = now;
        sent.push("expiring");
    }

    if (sent.length > 0) await cycle.save();
    return { alerted: sent, remaining, days_left: daysLeft };
};

/* ------------------------------------------------------------------ */
/*  Reporting                                                         */
/* ------------------------------------------------------------------ */

/**
 * Everything the admin screen shows about bundles: where the live one stands, what past
 * cycles really cost, and how much of them was thrown away.
 *
 * `effective_credit_price` is the number that matters and the one nobody is told: a bundle
 * bought for 20 parcels and used 11 times did not cost 100 EGP a parcel, it cost 182.
 */
const getBundleOverview = async ({ refresh = false } = {}) => {
    if (refresh) await syncFromBosta().catch((err) => console.error(`[BostaBundle] Refresh failed: ${err.message}`));

    const now = new Date();
    const cycles = await BostaBundleCycle.find().sort({ started_at: -1 }).limit(24).lean();
    const active = cycles.find((c) => c.status === "active" && (!c.expires_at || new Date(c.expires_at) > now)) || null;

    const history = cycles.map((c) => {
        const consumed = Number(c.consumed_orders || 0);
        const total = Number(c.total_orders || 0);
        const wasted = c.closed_at ? Number(c.wasted_orders || 0) : Math.max(0, total - consumed);
        return {
            subscription_id: c.subscription_id,
            name: c.name_ar || c.name_en,
            paid_amount: round2(c.paid_amount),
            total_orders: total,
            consumed_orders: consumed,
            wasted_orders: wasted,
            wasted_amount: c.closed_at ? round2(c.wasted_amount) : round2(wasted * Number(c.credit_price || 0)),
            credit_price: round2(c.credit_price),
            // What each parcel ACTUALLY cost once the unused ones are paid for by the ones
            // that shipped. Null while nothing has shipped yet — there is no such thing as
            // the cost per parcel of zero parcels.
            effective_credit_price: consumed > 0 ? round2(Number(c.paid_amount || 0) / consumed) : null,
            started_at: c.started_at,
            expires_at: c.expires_at,
            status: c.status,
        };
    });

    const closed = history.filter((h) => h.status !== "active");

    // The same thresholds the alert sweep uses. Returned so the screen warns at exactly the
    // point the notification fires, rather than at a number of its own that drifts from it.
    const settings = await ShippingSettings.findOne()
        .select("bundle_low_orders_threshold bundle_low_days_threshold")
        .lean();

    return {
        thresholds: {
            low_orders: Number(settings?.bundle_low_orders_threshold ?? 5),
            low_days: Number(settings?.bundle_low_days_threshold ?? 5),
        },
        active: active
            ? {
                subscription_id: active.subscription_id,
                name: active.name_ar || active.name_en,
                paid_amount: round2(active.paid_amount),
                credit_price: round2(active.credit_price),
                total_orders: Number(active.total_orders || 0),
                consumed_orders: Number(active.consumed_orders || 0),
                remaining_orders: Math.max(0, Number(active.total_orders || 0) - Number(active.consumed_orders || 0)),
                started_at: active.started_at,
                expires_at: active.expires_at,
                days_left: active.expires_at ? Math.max(0, Math.ceil((new Date(active.expires_at) - now) / DAY_MS)) : null,
                auto_renewal: !!active.auto_renewal,
                value_at_risk: round2(
                    Math.max(0, Number(active.total_orders || 0) - Number(active.consumed_orders || 0)) *
                    Number(active.credit_price || 0)
                ),
                synced_at: active.synced_at,
            }
            : null,
        history,
        lifetime: {
            cycles: closed.length,
            paid: round2(closed.reduce((s, h) => s + h.paid_amount, 0)),
            shipped: closed.reduce((s, h) => s + h.consumed_orders, 0),
            wasted_orders: closed.reduce((s, h) => s + h.wasted_orders, 0),
            wasted_amount: round2(closed.reduce((s, h) => s + h.wasted_amount, 0)),
        },
    };
};

/**
 * What expired unused inside a period, dated on the day each cycle closed.
 *
 * The P&L reads this as its own loss line rather than folding it into shipping cost: a
 * parcel that shipped cost 100 EGP whatever else happened that month, and burying the waste
 * inside the parcels would make every order look worse than it was while hiding the one
 * number that can actually be fixed.
 */
const wastedBundleValue = async (range = null) => {
    const filter = { closed_at: { $ne: null }, wasted_amount: { $gt: 0 } };
    if (range) filter.closed_at = { ...(range.$gte ? { $gte: range.$gte } : {}), ...(range.$lte ? { $lte: range.$lte } : {}) };

    const rows = await BostaBundleCycle.find(filter).select("wasted_orders wasted_amount closed_at").lean();
    return {
        orders: rows.reduce((s, r) => s + Number(r.wasted_orders || 0), 0),
        amount: round2(rows.reduce((s, r) => s + Number(r.wasted_amount || 0), 0)),
    };
};

/**
 * How a parcel that shipped on `date` was billed.
 *
 * Exists for the back-fill, which prices parcels that shipped months ago. Pricing them off
 * TODAY's bundle would be as wrong as pricing them off today's rate card: a parcel sent in
 * July predates bundles entirely and was billed the tariff, while one sent in September was
 * one of twenty on a bundle that has since closed. The cycle it actually fell inside is the
 * only honest answer, and the mirror is the only place that still knows.
 */
const pricingAsOf = async (date) => {
    if (!date) return pricingForDispatch();

    const at = new Date(date);
    const cycle = await BostaBundleCycle.findOne({
        started_at: { $lte: at },
        expires_at: { $gte: at },
    })
        .sort({ started_at: -1 })
        .lean();

    if (!cycle || !(Number(cycle.credit_price) > 0)) {
        return { mode: "tariff", credit_price: 0, subscription_id: null };
    }
    return {
        mode: "bundle",
        credit_price: round2(cycle.credit_price),
        subscription_id: cycle.subscription_id,
    };
};

module.exports = {
    syncFromBosta,
    getActiveCycle,
    pricingForDispatch,
    pricingAsOf,
    runBundleAlertSweep,
    getBundleOverview,
    wastedBundleValue,
};
