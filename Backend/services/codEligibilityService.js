/**
 * Who may pay cash on delivery.
 *
 * WHY THIS EXISTS. COD is the only method where the customer can change their mind at the
 * door. When they do, we have already paid to send the parcel and we pay again to bring it
 * back, the vendor has packed and lost a sale, and nothing was collected. A customer who does
 * that repeatedly is not a risk to be priced in — they are a customer who should be asked to
 * pay first.
 *
 * TWO TESTS, AND BOTH MUST PASS:
 *
 *   OURS    the share of this customer's finished orders that never reached them. Counted
 *           from our own orders, which is the only record of what they did to US.
 *
 *   BOSTA'S `receiver.ranking`, a 0-100 score on the phone number. Worth consulting because
 *           it is NOT derived from our data: a customer whose record with us is 4 delivered
 *           and 3 refused comes back as 83.3, so Bosta is scoring behaviour across deliveries
 *           we cannot see. It is also undocumented and only exists for a phone that has
 *           already received a Bosta parcel.
 *
 * WHAT NEVER BLOCKS ANYONE:
 *
 *   · a customer with no finished orders — a first order has nothing to judge;
 *   · fewer finished orders than `min_finished_orders` — one refusal out of two is 50% and
 *     means nothing;
 *   · Bosta being unreachable, or holding no ranking for the number. The decision falls back
 *     to our own test alone. A third party that is down must never close the shop's most
 *     common payment method.
 *
 * IDENTITY IS THE PHONE, NOT THE ACCOUNT. A customer who has been blocked and makes a new
 * account is the same person at the same door, and the phone is what the courier calls. Both
 * are matched, so a fresh account with an old number keeps the old history.
 */

const { SiteSettings } = require("../models/site_settings");
const { Order } = require("../models/orders");
const { User } = require("../models/users");
const { phoneLookupVariants } = require("./shared/phone");

const DEFAULTS = {
    enabled: true,
    min_finished_orders: 3,
    max_undelivered_percent: 50,
    use_bosta_ranking: true,
    min_bosta_ranking: 30,
    ranking_cache_hours: 12,
};

const round1 = (n) => Number((Number(n) || 0).toFixed(1));

const getPolicy = async () => {
    const settings = await SiteSettings.findOne().select("cod_policy wallet").lean();
    return {
        ...DEFAULTS,
        ...(settings?.cod_policy || {}),
        // The site-wide COD switch still wins over everything here.
        cod_enabled_globally: settings?.wallet?.cod_enabled !== false,
    };
};

/* ------------------------------------------------------------------ */
/*  Our own record of the customer                                    */
/* ------------------------------------------------------------------ */

/** Delivered, including a parcel a courier later reports as returned after delivering it. */
const parcelDelivered = (sub) =>
    sub?.status === "delivered" || (sub?.status === "returned" && !!sub.delivered_at);

/**
 * Did this parcel cost us a trip and reach nobody?
 *
 * Two cases, by the shop owner's own definition: refused at the door, and cancelled by the
 * customer after it had already been handed to a courier. A parcel cancelled before it ever
 * moved is NOT one of them — a customer who cancels while we are still packing has done
 * nothing wrong, and counting it would punish them for our own stock problems.
 */
const parcelWasted = (sub, order) => {
    if (sub?.status === "returned" && !sub.delivered_at) return true;
    if (sub?.status !== "cancelled") return false;

    const shipment = (order.shipments || []).find(
        (s) => s.sub_order_id && String(s.sub_order_id) === String(sub._id) && !s.superseded_at
    );
    return !!shipment?.sent_at;
};

const OPEN_PARCEL_STATUSES = new Set([
    "pending_review", "awaiting_tracking", "awaiting_handover", "ready_for_pickup", "needs_admin",
    "handed_to_courier", "pickup_scheduled", "picked_up", "in_transit", "out_for_delivery", "exception",
]);

/**
 * This customer's record with us: how many orders finished, and how many of those never
 * reached them.
 *
 * COUNTED PER ORDER, not per parcel, because that is the unit the shop owner reasons in — and
 * because a three-vendor basket refused at one door is one refusal, not one out of three. An
 * order where ANY parcel was taken counts as received: the customer did open the door.
 */
const getSiteStats = async ({ userId = null, phone = "" } = {}) => {
    const variants = phoneLookupVariants(phone);
    const or = [];
    if (userId) or.push({ user_id: userId });
    if (variants.length > 0) or.push({ "shipping_address.phone": { $in: variants } });
    if (or.length === 0) {
        return { orders_total: 0, finished: 0, received: 0, not_received: 0, undelivered_percent: 0, enough_data: false };
    }

    const orders = await Order.find({ $or: or })
        .select("status sub_orders shipments created_at")
        .lean();

    let received = 0;
    let notReceived = 0;
    // Every order, finished or not. It decides whether Bosta is worth asking at all: Bosta's
    // search only sees OUR deliveries, so a customer who has never ordered from us has no
    // record there to rank, and the call would spend half a second to return nothing.
    const ordersTotal = orders.length;

    for (const order of orders) {
        const parcels = order.sub_orders || [];

        // An order still moving tells us nothing yet.
        if (parcels.some((s) => OPEN_PARCEL_STATUSES.has(s.status))) continue;

        if (parcels.length === 0) {
            // Orders that predate sub-orders: fall back to the order's own status.
            if (order.status === "completed") received += 1;
            else if (order.status === "returned") notReceived += 1;
            continue;
        }

        if (parcels.some(parcelDelivered)) { received += 1; continue; }
        if (parcels.some((s) => parcelWasted(s, order))) { notReceived += 1; }
        // Anything else — cancelled before it ever shipped — is in neither total.
    }

    const finished = received + notReceived;
    return {
        orders_total: ordersTotal,
        finished,
        received,
        not_received: notReceived,
        undelivered_percent: finished > 0 ? round1((notReceived / finished) * 100) : 0,
        enough_data: finished > 0,
    };
};

/* ------------------------------------------------------------------ */
/*  Bosta's view of the customer                                      */
/* ------------------------------------------------------------------ */

/**
 * Bosta's ranking for a phone, from the cache when it is fresh.
 *
 * Cached on the user because checkout waits on this: the figure moves over weeks, and a
 * customer who reloads the checkout page three times must not open three calls to Bosta.
 * A failed fetch leaves the cache untouched and returns what we had, if anything.
 */
const getBostaRanking = async ({ userId = null, phone = "", policy, force = false } = {}) => {
    if (!policy.use_bosta_ranking || !phone) return { ranking: null, checked_at: null, source: "off" };

    const user = userId ? await User.findById(userId).select("cod_risk").lean() : null;
    const cached = user?.cod_risk || null;
    const maxAgeMs = Math.max(1, Number(policy.ranking_cache_hours || 12)) * 3600 * 1000;
    const fresh = cached?.bosta_checked_at && Date.now() - new Date(cached.bosta_checked_at) < maxAgeMs;

    if (!force && fresh) {
        return { ranking: cached.bosta_ranking ?? null, checked_at: cached.bosta_checked_at, source: "cache" };
    }

    const profile = await require("./bostaService")
        .getCustomerDeliveryProfile(phone)
        .catch(() => null);

    if (!profile) {
        // Bosta had nothing, or could not be reached. Either way the cached value — even a
        // stale one — is better than nothing, and the absence is reported honestly.
        return {
            ranking: cached?.bosta_ranking ?? null,
            checked_at: cached?.bosta_checked_at || null,
            source: cached?.bosta_checked_at ? "stale_cache" : "unavailable",
        };
    }

    if (userId) {
        await User.updateOne(
            { _id: userId },
            {
                $set: {
                    "cod_risk.bosta_ranking": profile.ranking,
                    "cod_risk.bosta_delivered": profile.delivered,
                    "cod_risk.bosta_returned": profile.returned,
                    "cod_risk.bosta_checked_at": new Date(),
                },
            }
        ).catch(() => { });
    }

    return {
        ranking: profile.ranking,
        delivered: profile.delivered,
        returned: profile.returned,
        checked_at: new Date(),
        source: "bosta",
    };
};

/* ------------------------------------------------------------------ */
/*  The decision                                                      */
/* ------------------------------------------------------------------ */

/**
 * May this customer pay cash on delivery?
 *
 * The shape of the answer matters as much as the answer: `reasons` says which test failed and
 * on what numbers, because "COD is off for this customer" with no explanation is unanswerable
 * when they call support about it.
 *
 * @param {object}  args
 * @param {string}  [args.userId]  the account placing the order, when there is one
 * @param {string}  [args.phone]   the DELIVERY phone — the identity that actually matters
 * @param {boolean} [args.force]   re-read Bosta even if the cache is fresh (admin screens)
 */
const evaluate = async ({ userId = null, phone = "", force = false } = {}) => {
    const policy = await getPolicy();

    const [site, user] = await Promise.all([
        getSiteStats({ userId, phone }),
        userId ? User.findById(userId).select("cod_risk").lean() : null,
    ]);

    const override = user?.cod_risk?.override || null;

    // Asked only when there is something for Bosta to know about. A first-time customer is
    // invisible to it by construction, and checkout should not wait on a call that cannot
    // answer. A cached ranking is still returned when one exists.
    const worthAsking = site.orders_total > 0 || !!user?.cod_risk?.bosta_checked_at;
    const bosta = worthAsking
        ? await getBostaRanking({ userId, phone, policy, force })
        : { ranking: null, checked_at: null, source: "no_history" };

    const result = {
        allowed: true,
        reasons: [],
        override,
        override_reason: user?.cod_risk?.override_reason || "",
        site,
        bosta: {
            ranking: bosta.ranking,
            checked_at: bosta.checked_at,
            source: bosta.source,
            delivered: bosta.delivered ?? null,
            returned: bosta.returned ?? null,
        },
        policy: {
            enabled: policy.enabled,
            min_finished_orders: policy.min_finished_orders,
            max_undelivered_percent: policy.max_undelivered_percent,
            min_bosta_ranking: policy.min_bosta_ranking,
            use_bosta_ranking: policy.use_bosta_ranking,
        },
    };

    // The site-wide switch, then the admin's own word. An override is a decision a person
    // made about a person, and it beats both statistics.
    if (!policy.cod_enabled_globally) {
        result.allowed = false;
        result.reasons.push({ code: "cod_disabled_site_wide" });
        return result;
    }
    if (override === "block") {
        result.allowed = false;
        result.reasons.push({ code: "admin_blocked" });
        return result;
    }
    if (override === "allow") {
        result.reasons.push({ code: "admin_allowed" });
        return result;
    }
    if (!policy.enabled) return result;

    // OUR TEST. Only once there are enough finished orders for the share to mean something.
    if (site.finished >= policy.min_finished_orders && site.undelivered_percent > policy.max_undelivered_percent) {
        result.allowed = false;
        result.reasons.push({
            code: "site_undelivered_rate",
            value: site.undelivered_percent,
            threshold: policy.max_undelivered_percent,
            finished: site.finished,
        });
    }

    // BOSTA'S TEST. Skipped entirely when there is no number to test — never failed for it.
    if (policy.use_bosta_ranking && bosta.ranking !== null && bosta.ranking < policy.min_bosta_ranking) {
        result.allowed = false;
        result.reasons.push({
            code: "bosta_ranking",
            value: bosta.ranking,
            threshold: policy.min_bosta_ranking,
        });
    }

    return result;
};

/**
 * The cheap half of `evaluate`, for the paths that only need a yes or no.
 *
 * Never throws: a failure here must not stop an order being placed, and the safe direction is
 * to allow — refusing a good customer's order costs a sale, while allowing a bad one costs a
 * delivery we were already willing to risk before this feature existed.
 */
const isAllowed = async ({ userId = null, phone = "" } = {}) => {
    try {
        const result = await evaluate({ userId, phone });
        return result.allowed;
    } catch (err) {
        console.error(`[CodEligibility] Check failed, allowing COD: ${err.message}`);
        return true;
    }
};

/**
 * Admin decision on one customer: force COD open, force it shut, or hand them back to the rules.
 */
const setOverride = async (userId, { override = null, reason = "", adminLabel = "Admin" } = {}) => {
    if (!["allow", "block", null, ""].includes(override)) throw new Error("Unknown override");

    await User.updateOne(
        { _id: userId },
        {
            $set: {
                "cod_risk.override": override || null,
                "cod_risk.override_reason": String(reason || "").trim(),
                "cod_risk.override_by": adminLabel,
                "cod_risk.override_at": override ? new Date() : null,
            },
        }
    );

    return evaluate({ userId, phone: (await User.findById(userId).select("phone").lean())?.phone || "" });
};

/**
 * Coerce an admin's settings patch into the policy, key by key.
 *
 * Whitelisted for the same reason the shipping settings are: a settings document is the one
 * place where a typo becomes a site-wide behaviour change. A percentage that arrives as 150
 * or as "abc" is clamped or dropped rather than stored and silently never matched.
 */
const validatePolicyPatch = (patch = {}) => {
    const out = {};
    const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));

    if (patch.enabled !== undefined) out.enabled = !!patch.enabled;
    if (patch.use_bosta_ranking !== undefined) out.use_bosta_ranking = !!patch.use_bosta_ranking;

    if (patch.min_finished_orders !== undefined && Number.isFinite(Number(patch.min_finished_orders))) {
        out.min_finished_orders = Math.round(clamp(patch.min_finished_orders, 1, 100));
    }
    if (patch.max_undelivered_percent !== undefined && Number.isFinite(Number(patch.max_undelivered_percent))) {
        out.max_undelivered_percent = clamp(patch.max_undelivered_percent, 0, 100);
    }
    if (patch.min_bosta_ranking !== undefined && Number.isFinite(Number(patch.min_bosta_ranking))) {
        out.min_bosta_ranking = clamp(patch.min_bosta_ranking, 0, 100);
    }
    if (patch.ranking_cache_hours !== undefined && Number.isFinite(Number(patch.ranking_cache_hours))) {
        out.ranking_cache_hours = Math.round(clamp(patch.ranking_cache_hours, 1, 720));
    }

    return out;
};

/** Save a validated patch onto the site settings document. */
const updatePolicy = async (patch = {}) => {
    const clean = validatePolicyPatch(patch);
    if (Object.keys(clean).length === 0) throw new Error("No COD policy settings were provided");

    let doc = await SiteSettings.findOne();
    if (!doc) doc = new SiteSettings();

    const before = { ...DEFAULTS, ...(doc.cod_policy?.toObject?.() || doc.cod_policy || {}) };
    doc.cod_policy = { ...before, ...clean };
    await doc.save();

    return getPolicy();
};

module.exports = {
    DEFAULTS,
    validatePolicyPatch,
    updatePolicy,
    getPolicy,
    getSiteStats,
    getBostaRanking,
    evaluate,
    isAllowed,
    setOverride,
};
