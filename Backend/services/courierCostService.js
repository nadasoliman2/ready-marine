/**
 * What a parcel really costs us at Bosta, and what the customer paid for it.
 *
 * WHY THIS EXISTS. Retail shipping is a flat 25 EGP per parcel (`bostaTariff.FLAT_RETAIL_RATE`)
 * while the courier bills its own price for the trip. The difference is a subsidy Ready Car
 * pays out of margin. Before this module the cost side was modelled but read by nothing, so
 * that subsidy existed in the bank statement and nowhere else. This is the ledger that makes
 * it visible.
 *
 * TWO WAYS A LEG IS PAID FOR, and `billing_mode` says which:
 *
 *   tariff   the courier bills this parcel its rate for this destination and keeps the fee
 *            out of the cash it collects. Every Arrive parcel, and every Bosta parcel from
 *            before the account moved onto bundles.
 *   bundle   already paid. Bosta's prepaid bundles buy a fixed number of parcels up front,
 *            and a delivery — to Cairo or to Aswan, normal or heavy-bulky — takes exactly
 *            one of them. The cost is the credit price (`bostaBundleService`), the rate card
 *            survives as `list_send`, and NOTHING is deducted from the COD for the trip.
 *
 * WHAT IT OWNS. Every write to `order.shipments[].courier_cost` happens here and nowhere
 * else, so there is exactly one answer to "what did this parcel cost" and one place to fix
 * it when Bosta changes how they bill.
 *
 * FROZEN, NOT DERIVED. The cost is stamped onto the shipment at dispatch. `bostaTariff.js`
 * is periodically re-read from Bosta's pricing API and updated; pricing an old parcel off
 * today's table would quietly restate every historical figure, so a parcel keeps the price
 * that applied the day it shipped. The same discipline the customer's allocation already
 * follows.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It never guesses. A destination city that is not in the
 * tariff is recorded with `priced: false` and a zero cost rather than a plausible-looking
 * average, and the report counts those parcels separately — an unmeasured parcel must read
 * as unmeasured, not as a cheap one.
 */

const { Order } = require("../models/orders");
const { BostaPickup } = require("../models/bostaPickups");
const bostaTariff = require("./bostaTariff");

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** send + extra_cod + rto + cancel_fee, recomputed from the parts so the total can never drift. */
function retotal(cost) {
    cost.total = round2(
        Number(cost.send || 0) + Number(cost.extra_cod || 0)
        + Number(cost.rto || 0) + Number(cost.cancel_fee || 0)
    );
    return cost;
}

/**
 * Stamp what cancelling an already-dispatched parcel cost us.
 *
 * Only Arrive can reach this with a non-zero number. Bosta terminates a delivery for free
 * until a pickup is booked, and our cancel window closes there, so a cancelled Bosta parcel
 * genuinely costs nothing. Arrive has no cancellation at all and prices one at the full
 * delivery fee — so before this, the customer's refund went out, Arrive billed us, and the
 * loss appeared in no report. See `couriers/arrive/cancellation.js`.
 *
 * Idempotent: a parcel that already carries a cancellation fee is left alone.
 *
 * @returns {object|null} the updated `courier_cost`, or null when there is nothing honest to write
 */
function recordCancellationCost(shipment, sub) {
    const cost = shipment && shipment.courier_cost;
    if (!cost || !cost.recorded_at) return null;
    if (Number(cost.cancel_fee || 0) > 0) return cost;
    if ((cost.provider || "bosta") !== "arrive") return cost;

    const { cancellationOutcome } = require("./couriers/arrive/cancellation");
    const outcome = cancellationOutcome(sub, shipment);
    if (!outcome.priced || !outcome.fee) return cost;

    cost.cancel_fee = round2(outcome.fee);
    // A parcel cancelled in transit is never going to be delivered, so the delivery leg it
    // was stamped with at dispatch stands and the cancellation is charged on top — which is
    // exactly how Arrive bills it.
    shipment.courier_cost = retotal(cost);
    return shipment.courier_cost;
}

/**
 * Stamp a dispatched parcel with what Bosta will bill for it and what the customer paid.
 *
 * Called from `bostaFulfillmentService.dispatchSubOrder` at the moment the delivery is
 * created, because that is when the three things the price depends on are all known and
 * final: the destination city, the parcel's size, and the COD the courier will collect.
 *
 * @param {object} shipment            the freshly pushed `order.shipments[]` sub-document
 * @param {string} dropOffCity         destination city, as sent to Bosta
 * @param {string} sizeKey             a `bostaTariff.SIZES` key
 * @param {number} codAmount           what the courier collects on delivery (0 when prepaid)
 * @param {number} chargedToCustomer   the parcel's `sub_order.shipping_share`
 */
async function recordDispatchCost(shipment, { dropOffCity, sizeKey, codAmount = 0, chargedToCustomer = 0, provider = "bosta", arriveGroup = null, weightKg = 0, asOf = null } = {}) {
    if (!shipment) return null;

    if (provider === "arrive") {
        // Arrive prices by its own area group, weight-surcharged, no COD percentage.
        const q = require("./couriers/arrive/tariff").quote(arriveGroup, weightKg);
        const cost = {
            provider: "arrive",
            group: q.group || arriveGroup || "",
            sector: null,
            size_key: "",
            // Arrive has no prepaid bundle: every parcel is billed its own fee and taken
            // out of the cash it collects.
            billing_mode: "tariff",
            bundle_subscription_id: null,
            list_send: round2(q.priced ? q.delivery : 0),
            send: round2(q.priced ? q.delivery : 0),
            extra_cod: 0,
            rto: 0,
            charged: round2(chargedToCustomer),
            priced: q.priced,
            recorded_at: new Date(),
        };
        shipment.courier_cost = retotal(cost);
        return shipment.courier_cost;
    }

    const sector = bostaTariff.sectorForCity(dropOffCity);
    const size = sizeKey || bostaTariff.DEFAULT_SIZE_KEY;
    // `sendCost` returns null for a sector or size it has no rate for. That is the one
    // signal that separates "this parcel cost nothing" from "we do not know", and it is
    // carried through as `priced` rather than collapsed into a 0.
    const listSend = sector === null ? null : bostaTariff.sendCost(sector, size, { vat: true });

    /* ---- What the delivery leg actually costs, which is no longer the rate card ----
     *
     * On a prepaid bundle Bosta bills nothing per parcel: it takes ONE parcel off the
     * balance, the same one whether the box goes to Cairo for a listed 97 EGP or to Aswan
     * for 140. So the cost is the credit price — what the bundle cost divided by the parcels
     * it carries — and the rate card becomes `list_send`, the price we were spared.
     *
     * Stamped now, from the bundle live at this moment, because a bundle bought next month
     * at a different price must not re-price a parcel that shipped on this one.
     */
    // `asOf` is the back-fill's: a parcel that shipped in July was billed the rate card and
    // one that shipped in September was one of twenty on a bundle, and only the date can
    // tell them apart. A live dispatch passes nothing and is priced against today's bundle.
    const bundleService = require("./bostaBundleService");
    const bundle = await (asOf ? bundleService.pricingAsOf(asOf) : bundleService.pricingForDispatch())
        .catch(() => ({ mode: "tariff" }));
    const onBundle = bundle.mode === "bundle";
    const send = onBundle ? bundle.credit_price : listSend;

    const cost = {
        provider: "bosta",
        group: "",
        sector: sector,
        size_key: size,
        billing_mode: onBundle ? "bundle" : "tariff",
        bundle_subscription_id: onBundle ? bundle.subscription_id : null,
        list_send: round2(listSend || 0),
        send: round2(send || 0),
        // Bosta's 1% on the COD above 2000 EGP is charged per DELIVERY, so it belongs to
        // the parcel, not to the order — which is also how the customer is surcharged for it.
        extra_cod: round2(bostaTariff.extraCodFee(codAmount, { vat: true })),
        rto: 0,
        charged: round2(chargedToCustomer),
        // A bundle parcel is priced exactly, even to a city the rate card cannot place:
        // the credit price does not depend on where it is going. Only a tariff-billed
        // parcel can be unpriceable.
        priced: onBundle ? true : listSend !== null,
        recorded_at: new Date(),
    };

    shipment.courier_cost = retotal(cost);
    return shipment.courier_cost;
}

/**
 * Add the cost of bringing a refused parcel back, when it reaches `returned`.
 *
 * A returned parcel costs us TWICE — the outbound attempt is billed whether or not the
 * customer took it, and the RTO leg is billed on top. Recording only the outbound half
 * would make failed deliveries look as cheap as successful ones, which is exactly backwards.
 *
 * Idempotent: webhooks are retried and the polling sweep re-reads the same state every 20
 * minutes, so a parcel that already carries an RTO charge is left alone.
 */
function recordReturnCost(shipment) {
    const cost = shipment && shipment.courier_cost;
    // Nothing to add to on a parcel dispatched before this ledger existed, or one whose
    // destination the tariff could not price. Backfill is the fix for the first; the
    // second has no honest number to add.
    if (!cost || !cost.priced || !cost.recorded_at) return null;
    if (Number(cost.rto || 0) > 0) return cost;
    if (cost.provider === "arrive") {
        // Arrive's return leg is a flat fee per its tariff group (20 EGP at the time of
        // capture). Whether a refused parcel is billed the delivery fee on top is unconfirmed
        // with Arrive; only the confirmed part is recorded.
        const q = require("./couriers/arrive/tariff").quote(cost.group, 0);
        cost.rto = round2(q.priced ? q.return : 0);
        shipment.courier_cost = retotal(cost);
        return shipment.courier_cost;
    }

    const rto = bostaTariff.rtoCost(cost.sector, cost.size_key || bostaTariff.DEFAULT_SIZE_KEY, { vat: true });
    if (rto === null) return cost;

    cost.rto = round2(rto);
    return retotal(cost);
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

const EMPTY_MONEY = () => ({ collected: 0, send: 0, extra_cod: 0, rto: 0, paid: 0, subsidy: 0 });

/**
 * Group rows into the shape the report renders, keyed on `keyOf` and labelled by `labelOf`.
 * Shared by the sector and size breakdowns so the two cannot compute a subsidy differently.
 */
function group(rows, keyOf, labelOf) {
    const out = new Map();
    for (const r of rows) {
        const key = keyOf(r);
        if (key === null || key === undefined) continue;
        if (!out.has(key)) out.set(key, { key, ...labelOf(key), parcels: 0, ...EMPTY_MONEY() });
        const g = out.get(key);
        g.parcels += 1;
        g.collected = round2(g.collected + Number(r.charged || 0));
        g.send = round2(g.send + Number(r.send || 0));
        g.extra_cod = round2(g.extra_cod + Number(r.extra_cod || 0));
        g.rto = round2(g.rto + Number(r.rto || 0));
        g.paid = round2(g.paid + Number(r.total || 0));
        g.subsidy = round2(g.paid - g.collected);
    }
    return [...out.values()];
}

/**
 * The subsidy report for a period, measured on the day each parcel SHIPPED (`sent_at`) —
 * not on the day its order was placed, because the courier bills us for the dispatch.
 *
 * Pickup fees are folded in from `BostaPickup.pickup_fee`. They are a real Bosta charge that
 * Ready Car already absorbs, they belong to a courier VISIT rather than to any one parcel,
 * and so they are added to the platform's side of the ledger without being attributed to a
 * sector or a size.
 *
 * @param {Date|string} from  inclusive lower bound on `sent_at`
 * @param {Date|string} to    exclusive upper bound on `sent_at`
 */
async function summarize({ from, to } = {}) {
    const start = from ? new Date(from) : new Date(0);
    const end = to ? new Date(to) : new Date();

    const rows = await Order.aggregate([
        { $match: { "shipments.0": { $exists: true } } },
        { $unwind: "$shipments" },
        {
            $match: {
                "shipments.courier_cost.recorded_at": { $ne: null },
                "shipments.sent_at": { $gte: start, $lt: end },
            },
        },
        {
            $project: {
                _id: 0,
                provider: { $ifNull: ["$shipments.courier_cost.provider", "bosta"] },
                group: "$shipments.courier_cost.group",
                sector: "$shipments.courier_cost.sector",
                size_key: "$shipments.courier_cost.size_key",
                send: "$shipments.courier_cost.send",
                extra_cod: "$shipments.courier_cost.extra_cod",
                rto: "$shipments.courier_cost.rto",
                total: "$shipments.courier_cost.total",
                charged: "$shipments.courier_cost.charged",
                priced: "$shipments.courier_cost.priced",
            },
        },
    ]);

    // Only priced parcels are summed. An unpriced one still carries a real extra-COD fee —
    // that fee depends on the COD alone, not on the destination — but adding it while its
    // send leg is an unknown 0 would quietly make the subsidy look SMALLER than it is, which
    // is the one direction this report must never err in. Counting it out and saying so is
    // the honest half-measure; `parcels.unpriced` is how the reader knows to.
    const pricedRows = rows.filter((r) => r.priced);

    const money = EMPTY_MONEY();
    let returned = 0;
    for (const r of pricedRows) {
        if (Number(r.rto || 0) > 0) returned += 1;
        money.collected = round2(money.collected + Number(r.charged || 0));
        money.send = round2(money.send + Number(r.send || 0));
        money.extra_cod = round2(money.extra_cod + Number(r.extra_cod || 0));
        money.rto = round2(money.rto + Number(r.rto || 0));
        money.paid = round2(money.paid + Number(r.total || 0));
    }

    const [pickups] = await BostaPickup.aggregate([
        {
            $match: {
                created_at: { $gte: start, $lt: end },
                // A cancelled visit never happened, so Bosta never billed it. Counting it
                // would inflate the subsidy with money that was not spent.
                status: { $ne: "cancelled" },
            },
        },
        { $group: { _id: null, fees: { $sum: "$pickup_fee" }, visits: { $sum: 1 } } },
    ]);
    const pickup_fees = round2(pickups?.fees || 0);

    money.pickup = pickup_fees;
    money.paid = round2(money.paid + pickup_fees);
    money.subsidy = round2(money.paid - money.collected);

    return {
        period: { from: start, to: end },
        parcels: {
            total: rows.length,
            priced: pricedRows.length,
            // Dispatched to a city the tariff cannot price. If this is not 0, every figure
            // below — the money as well as the breakdowns — is missing that many parcels.
            unpriced: rows.length - pricedRows.length,
            returned,
        },
        pickup_visits: pickups?.visits || 0,
        money,
        // Which courier carried what. Bosta rows before the switch carry no provider and
        // count as Bosta.
        by_courier: group(pricedRows, (r) => r.provider || "bosta", (p) => ({
            name: p === "arrive" ? "Arrive" : "Bosta",
            name_ar: p === "arrive" ? "أرايف" : "بوسطة",
        })).sort((a, b) => b.paid - a.paid),
        // Bosta prices by sector number, Arrive by area group name; one table, keyed so the
        // two never collide.
        by_sector: group(pricedRows, (r) => (r.provider === "arrive" ? `arrive:${r.group || "?"}` : r.sector), (id) => {
            if (typeof id === "string" && id.startsWith("arrive:")) {
                const g = id.slice(7);
                return { name: `Arrive — ${g}`, name_ar: `أرايف — ${g}` };
            }
            const s = bostaTariff.getSector(id);
            return { name: s?.name || `Sector ${id}`, name_ar: s?.name_ar || `منطقة ${id}` };
        }).sort((a, b) => String(a.key).localeCompare(String(b.key))),
        by_size: group(pricedRows.filter((r) => r.provider !== "arrive"), (r) => r.size_key || null, (k) => {
            const s = bostaTariff.getSize(k);
            return { name: s?.name || k, name_ar: s?.name_ar || k };
        }).sort((a, b) => b.paid - a.paid),
    };
}

module.exports = {
    recordDispatchCost,
    recordReturnCost,
    recordCancellationCost,
    summarize,
};
