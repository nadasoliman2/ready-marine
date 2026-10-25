/**
 * Bosta Cost Service
 * ------------------
 * What a parcel costs US, as opposed to what the customer was charged for it.
 *
 * The order already stores the second number — `order.shipping.total_cost` and each
 * sub-order's `shipping_share` — because the customer saw it before paying. Nothing stored
 * the first, which made the shipping half of the profit report unanswerable: we knew our
 * revenue on every parcel and none of our cost.
 *
 * Four line items, each with its own trigger:
 *
 *   send           the base rate for the destination sector at this parcel's size
 *   extra_cod_fee  1% of the COD above 2000 EGP, on the parcel carrying the money
 *   pickup_share   this parcel's share of the courier visit that collected it
 *   rto            what bringing it back cost, when the customer refused it
 *
 * Computed once at dispatch and SNAPSHOTTED onto the shipment. `bostaTariff` is a live
 * file that gets updated whenever Bosta re-prices, and a cost derived at report time would
 * quietly restate every parcel we ever shipped — last quarter's profit would move because
 * this quarter's rates changed. Parcels that predate the snapshot are back-filled by
 * `scripts/backfillBostaCosts.js` and marked `source: 'derived'` so the screens can say
 * which figures are estimates.
 */

const bostaTariff = require("../services/bostaTariff");
const { City } = require("../models/cities");
const { BostaPickup } = require("../models/bostaPickups");
const { Product } = require("../models/products");

const round2 = (n) => Number((Number(n) || 0).toFixed(2));

/* ------------------------------------------------------------------ *
 * Reference-data caches
 *
 * Costing a parcel needs two lookups that are pure reference data — which sector a city is
 * in, and which size bracket a product's shipping class means. Uncached, a lifetime profit
 * report costs thousands of parcels and fires those queries once per parcel, for answers
 * that change perhaps twice a year.
 *
 * A short TTL rather than a permanent memo: an admin who fixes a city's `bosta_sector`
 * because a report flagged it uncosted should see the corrected figure on their next look,
 * not after a redeploy.
 * ------------------------------------------------------------------ */
const CACHE_TTL_MS = 5 * 60 * 1000;

const makeCache = () => ({ map: new Map(), expires: 0 });
const _sectorCache = makeCache();
const _sizeCache = makeCache();
const _pickupCache = makeCache();

const cacheGet = (cache, key) => {
    if (Date.now() > cache.expires) {
        cache.map.clear();
        cache.expires = Date.now() + CACHE_TTL_MS;
        return undefined;
    }
    return cache.map.get(key);
};

const cacheSet = (cache, key, value) => {
    if (cache.expires === 0) cache.expires = Date.now() + CACHE_TTL_MS;
    cache.map.set(key, value);
    return value;
};

/* ------------------------------------------------------------------ */
/*  Inputs                                                            */
/* ------------------------------------------------------------------ */

/**
 * The Bosta sector for an order's destination.
 *
 * Tries the tariff's own city table first — its names are the strings Bosta itself
 * returns — then falls back to the City collection's `bosta_sector`, which is where a city
 * added after the tariff file was last synced will be found.
 */
const sectorForOrder = async (order) => {
    const cityName = order?.shipping?.destination?.city || null;

    const direct = bostaTariff.sectorForCity(cityName);
    if (direct) return direct;
    if (!cityName) return null;

    // Cached including the misses: a city the tariff cannot place is the case that would
    // otherwise re-query on every parcel going there, which is every parcel in a whole
    // governorate.
    const cached = cacheGet(_sectorCache, cityName);
    if (cached !== undefined) return cached;

    const city = await City.findOne({
        $or: [{ name: cityName }, { name_ar: cityName }],
    })
        .select("bosta_sector")
        .lean();

    return cacheSet(_sectorCache, cityName, city?.bosta_sector || null);
};

/**
 * The Bosta size bracket a parcel prices at: the largest size among its items' shipping
 * classes, because the courier bills the box rather than its contents.
 *
 * Deliberately the same derivation `bostaFulfillmentService` uses when it DECLARES the
 * parcel to Bosta. If the two ever disagreed we would be billed for one size and costing
 * ourselves at another, and the gap would show up as unexplained margin drift.
 */
const sizeKeyForItems = async (items) => {
    const productIds = [...new Set((items || []).map((i) => i.product_id).filter(Boolean).map(String))];
    if (productIds.length === 0) return bostaTariff.DEFAULT_SIZE_KEY;

    const sizeKeys = [];
    const unknown = [];

    for (const id of productIds) {
        const cached = cacheGet(_sizeCache, id);
        if (cached === undefined) unknown.push(id);
        else if (cached) sizeKeys.push(cached);
    }

    if (unknown.length > 0) {
        const products = await Product.find({ _id: { $in: unknown } })
            .select("shipping_class_id")
            .populate("shipping_class_id", "name")
            .lean();

        const found = new Set();
        for (const product of products) {
            const key = bostaTariff.sizeKeyForClassName(product.shipping_class_id?.name || "");
            cacheSet(_sizeCache, String(product._id), key || null);
            found.add(String(product._id));
            if (key) sizeKeys.push(key);
        }
        // A product that has since been deleted still appears on old orders. Cached as
        // "no size" so a historical report does not re-query for it on every parcel.
        for (const id of unknown) if (!found.has(id)) cacheSet(_sizeCache, id, null);
    }

    return bostaTariff.largestSize(sizeKeys);
};

/**
 * This parcel's share of the courier visit that collected it.
 *
 * The fee is charged per VISIT, not per parcel, so it is split evenly across the parcels
 * on the pickup: a visit collecting one parcel puts the whole 70 EGP on it, a visit
 * collecting seven puts a seventh on each. Attributing the whole fee to every parcel
 * would count it as many times as the courier had boxes to carry.
 */
const pickupShareForSubOrder = async (subOrder) => {
    if (!subOrder?.pickup_id) return 0;

    // Cached by pickup id, because the parcels sharing a visit all ask the same question
    // of the same document — that is precisely what "sharing a visit" means.
    const key = String(subOrder.pickup_id);
    const cached = cacheGet(_pickupCache, key);
    if (cached !== undefined) return cached;

    const pickup = await BostaPickup.findById(subOrder.pickup_id).select("pickup_fee parcel_count").lean();
    if (!pickup || !pickup.pickup_fee) return cacheSet(_pickupCache, key, 0);

    const parcels = Math.max(1, Number(pickup.parcel_count) || 1);
    return cacheSet(_pickupCache, key, round2(pickup.pickup_fee / parcels));
};

/* ------------------------------------------------------------------ */
/*  Costing                                                           */
/* ------------------------------------------------------------------ */

/**
 * Cost one parcel.
 *
 * @param {object} order     the parent order (needs `shipping.destination`, `items`)
 * @param {object} subOrder  the parcel's sub-order (COD, pickup, status)
 * @param {object} [opts]
 * @param {string} [opts.source]  'snapshot' at dispatch, 'derived' when back-filling
 * @returns {Promise<object>} a `bosta_cost` shaped object, never null
 */
const costForParcel = async (order, subOrder, { source = "snapshot" } = {}) => {
    const empty = {
        billing_mode: "tariff",
        bundle_subscription_id: null,
        send: 0,
        extra_cod_fee: 0,
        pickup_share: 0,
        rto: 0,
        total: 0,
        sector_id: null,
        size_key: null,
        source,
        computed_at: new Date(),
    };
    if (!order || !subOrder) return empty;

    const sectorId = await sectorForOrder(order);

    /* ---- Which bundle cycle, if any, paid for this parcel ----
     *
     * Read here as well as in `courierCostService` because the two ledgers are both live:
     * `courier_cost` is what the subsidy report reads, `bosta_cost` is what the P&L reads,
     * and if only one of them knew about bundles the same parcel would cost 100 EGP on one
     * screen and 140 on the other.
     *
     * Dated by the parcel's own dispatch, so a back-filled parcel is priced against the
     * bundle that was live the day it shipped rather than the one live today.
     */
    const sentAt = liveShipmentFor(order, subOrder._id)?.sent_at || null;
    const bundle = await require("./bostaBundleService")
        .pricingAsOf(sentAt)
        .catch(() => ({ mode: "tariff" }));
    const onBundle = bundle.mode === "bundle";

    // The items on THIS parcel, not the whole order — a two-vendor basket is two parcels
    // and each is sized by what is actually in its own box.
    const parcelItems = (order.items || []).filter(
        (i) => i.sub_order_id && subOrder._id && String(i.sub_order_id) === String(subOrder._id)
    );
    const sizeKey = await sizeKeyForItems(parcelItems.length > 0 ? parcelItems : order.items);

    // With no sector we cannot price the leg at all. Reported as zero with the sector left
    // null so the screens can flag it as uncosted rather than quietly showing 100% margin.
    //
    // Unless a bundle paid for it: then the destination is irrelevant — every parcel on a
    // bundle costs one credit, so even a city the tariff cannot place has an exact price.
    const send = onBundle
        ? bundle.credit_price
        : (sectorId ? bostaTariff.sendCost(sectorId, sizeKey, { vat: true }) ?? 0 : 0);

    // Only cash orders carry a COD; a card order was paid before the parcel moved.
    const codAmount = order.transaction?.payment_method === "cash" ? Number(subOrder.cod_amount || 0) : 0;
    const extraCodFee = bostaTariff.extraCodFee(codAmount, { vat: true });

    const pickupShare = await pickupShareForSubOrder(subOrder);

    // A refused parcel costs us twice: the delivery attempt AND the trip home, with no
    // shipping revenue against either. This is what makes a parcel's margin negative.
    //
    // Priced off the tariff even on a bundle: the bundle's terms cover shipping fees and
    // explicitly not "any other fees", and Bosta has not confirmed that a return leg is
    // free. Charging it is the conservative reading — a cost we did not pay shows up as
    // margin we did not expect, which is the harmless direction to be wrong in.
    const rto =
        subOrder.status === "returned" && sectorId
            ? bostaTariff.rtoCost(sectorId, sizeKey, { vat: true }) ?? 0
            : 0;

    const total = round2(send + extraCodFee + pickupShare + rto);

    return {
        billing_mode: onBundle ? "bundle" : "tariff",
        bundle_subscription_id: onBundle ? bundle.subscription_id : null,
        send: round2(send),
        extra_cod_fee: round2(extraCodFee),
        pickup_share: round2(pickupShare),
        rto: round2(rto),
        total,
        sector_id: sectorId,
        size_key: sizeKey,
        source,
        computed_at: new Date(),
    };
};

/**
 * Compute and persist the cost of the shipment carrying `subOrder`.
 *
 * Called from the dispatch path. Never throws into its caller: a cost we failed to record
 * is a reporting gap the back-fill can close later, and it must not be the reason a parcel
 * fails to reach the courier.
 */
/** Newest non-retired shipment row for a parcel — a reactivated parcel has more than one. */
const liveShipmentFor = (order, subId) => {
    const rows = (order?.shipments || []).filter(
        (s) => s.sub_order_id && subId && String(s.sub_order_id) === String(subId) && !s.superseded_at
    );
    return rows.length ? rows[rows.length - 1] : null;
};

const snapshotCostForSubOrder = async (order, subOrder) => {
    try {
        const shipment = liveShipmentFor(order, subOrder?._id);
        if (!shipment) return null;
        if (shipment.provider && shipment.provider !== "bosta") return null;

        const cost = await costForParcel(order, subOrder, { source: "snapshot" });
        shipment.bosta_cost = cost;
        return cost;
    } catch (err) {
        console.error(`[BostaCost] Could not cost parcel ${subOrder?._id} on order ${order?._id}: ${err.message}`);
        return null;
    }
};

/**
 * Fold the pickup fee into parcels that have just been booked onto a courier visit.
 *
 * A parcel is dispatched BEFORE its pickup is booked, so the cost snapshotted at dispatch
 * necessarily carried a zero pickup share — at that moment no courier visit existed to
 * take a share of. This closes that gap once the visit is real.
 *
 * Written with targeted positional updates rather than a document save, matching the
 * booking path it is called from: booking spends seconds inside Bosta's API, and a
 * delivery webhook landing in that window must not be overwritten by a stale in-memory
 * copy of the order.
 */
const applyPickupShareToParcels = async (orderId, subOrderIds = []) => {
    if (!orderId || subOrderIds.length === 0) return 0;

    const { Order } = require("../models/orders");
    const order = await Order.findById(orderId).select("sub_orders shipments").lean();
    if (!order) return 0;

    let updated = 0;

    for (const subId of subOrderIds) {
        const sub = (order.sub_orders || []).find((s) => String(s._id) === String(subId));
        const shipment = liveShipmentFor(order, subId);
        if (!sub || !shipment?.bosta_cost) continue;

        const share = await pickupShareForSubOrder(sub);
        if (share === Number(shipment.bosta_cost.pickup_share || 0)) continue;

        // Rebuild the total from its parts rather than adding the delta, so a second call
        // for the same parcel — a rescheduled pickup, a retried booking — converges on the
        // right number instead of drifting a little further from it each time.
        const total = round2(
            Number(shipment.bosta_cost.send || 0) +
            Number(shipment.bosta_cost.extra_cod_fee || 0) +
            share +
            Number(shipment.bosta_cost.rto || 0)
        );

        const res = await Order.updateOne(
            { _id: orderId, "shipments.sub_order_id": sub._id },
            {
                $set: {
                    "shipments.$.bosta_cost.pickup_share": share,
                    "shipments.$.bosta_cost.total": total,
                },
            }
        ).catch((err) => {
            console.error(`[BostaCost] Could not apply pickup share to parcel ${subId}: ${err.message}`);
            return { modifiedCount: 0 };
        });

        if (res.modifiedCount > 0) updated += 1;
    }

    return updated;
};

/**
 * Every parcel cost on an order, keyed by sub-order id.
 *
 * Falls back to deriving a cost for any parcel that has no snapshot, so the finance
 * screens are complete on day one rather than only for orders shipped after this feature
 * landed. The `source` on each row says which is which.
 */
const costsForOrder = async (order) => {
    const bySubOrder = new Map();

    for (const sub of order.sub_orders || []) {
        const shipment = liveShipmentFor(order, sub._id);

        // A parcel carried by another courier is priced by that courier's tariff, stamped at
        // dispatch in `courier_cost`. Deriving it from the Bosta tariff would be a fiction.
        if (shipment && shipment.provider && shipment.provider !== "bosta") {
            const c = shipment.courier_cost || {};
            bySubOrder.set(String(sub._id), c.recorded_at ? {
                provider: shipment.provider,
                group: c.group || "",
                send: round2(c.send || 0),
                extra_cod_fee: round2(c.extra_cod || 0),
                pickup_share: 0,
                rto: round2(c.rto || 0),
                total: round2(c.total || 0),
                priced: c.priced !== false,
                source: `${shipment.provider}_tariff`,
                computed_at: c.recorded_at,
            } : null);
            continue;
        }

        if (shipment?.bosta_cost?.computed_at) {
            bySubOrder.set(String(sub._id), shipment.bosta_cost);
            continue;
        }

        // Nothing has left the building yet, so nothing has been billed.
        if (!shipment) {
            bySubOrder.set(String(sub._id), null);
            continue;
        }

        bySubOrder.set(String(sub._id), await costForParcel(order, sub, { source: "derived" }));
    }

    return bySubOrder;
};

/** Σ of every parcel cost on an order. */
const totalCostForOrder = async (order) => {
    const costs = await costsForOrder(order);
    let total = 0;
    for (const cost of costs.values()) total += Number(cost?.total || 0);
    return round2(total);
};

module.exports = {
    sectorForOrder,
    sizeKeyForItems,
    pickupShareForSubOrder,
    costForParcel,
    snapshotCostForSubOrder,
    applyPickupShareToParcels,
    costsForOrder,
    totalCostForOrder,
};
