/**
 * Courier Settlement Service
 * --------------------------
 * How much cash each courier is holding for us, and matching it against the transfers that
 * actually arrive.
 *
 * THE QUESTION THIS ANSWERS. On a cash order the customer pays the courier, not us. The
 * courier holds that money for days — Bosta transfers weekly, on Wednesdays — and until it
 * lands, it is ours and it is somewhere else. Nothing in the finance module knew that:
 * revenue was recognised the moment a parcel was delivered, as if the cash were already in
 * the bank. For a business running mostly on COD that gap is the single largest number
 * nobody could see.
 *
 * WHAT THE COURIER KEEPS, AND WHY IT DIFFERS PER COURIER:
 *
 *   net    (Bosta, Arrive today) the courier takes its fees out of the cash before it
 *          transfers the rest. What we are owed is the collection MINUS those fees.
 *   gross  the courier transfers every pound and invoices separately. We are owed all of it.
 *
 * Which one a courier is on is a setting, not a guess — `ShippingSettings.courier_cod_settlement`.
 *
 * WHAT `owed` IS. The cash that will physically arrive from this courier, and nothing else.
 * It is not profit and it is not ours to keep: most of it is the vendors' money and some of
 * it pays for shipping we subsidise. Those are answered by the vendor ledger and the P&L. A
 * figure that tried to be both "what will reach my hand" and "what I get to keep" would be
 * neither, so this one only ever answers the first.
 *
 * AND WHY THE PREPAID BUNDLE CHANGES THE ANSWER. A Bosta parcel on a bundle has ALREADY been
 * paid for, up front, when the bundle was bought. So Bosta deducts nothing for the trip and
 * we are owed the whole COD less only the collection fee. Deducting the delivery again here
 * would charge us for the same parcel twice — once in the bundle and once out of the cash —
 * and would understate what Bosta owes us by about 100 EGP on every single order.
 * `courier_cost.billing_mode` is what keeps the two apart.
 */

const mongoose = require("mongoose");

const { Order } = require("../models/orders");
const { CourierSettlement } = require("../models/courierSettlements");
const { ShippingSettings } = require("../models/shipping_settings");
const { recordAuditLog } = require("../models/auditLog");

const round2 = (n) => Number((Number(n) || 0).toFixed(2));

/** Couriers the money screen always shows, even at zero — an absent row reads as "no data". */
const KNOWN_PROVIDERS = ["bosta", "arrive"];

const PROVIDER_LABELS = { bosta: "بوسطة", arrive: "Arrive" };

/* ------------------------------------------------------------------ */
/*  What each parcel owes us                                          */
/* ------------------------------------------------------------------ */

/** The newest live shipment row for a parcel — a reactivated parcel has more than one. */
const liveShipmentFor = (order, subId) => {
    const rows = (order?.shipments || []).filter(
        (s) => s.sub_order_id && subId && String(s.sub_order_id) === String(subId) && !s.superseded_at
    );
    return rows.length ? rows[rows.length - 1] : null;
};

/**
 * What the courier keeps out of THIS parcel's cash.
 *
 * Only the parts it actually deducts. On a bundle parcel the delivery leg is not one of
 * them — it was paid months before the customer opened the door.
 */
const feesKeptByCourier = (shipment, { codMode }) => {
    const cost = shipment?.courier_cost;
    if (!cost || !cost.recorded_at) return 0;
    // A courier that transfers the collection whole and invoices later keeps nothing here.
    if (codMode === "gross") return 0;

    const prepaidLeg = cost.billing_mode === "bundle";
    const send = prepaidLeg ? 0 : Number(cost.send || 0);

    return round2(
        send +
        Number(cost.extra_cod || 0) +
        Number(cost.rto || 0) +
        Number(cost.cancel_fee || 0)
    );
};

/** The settlement mode configured for each courier, with a sane default for an unknown one. */
const settlementModes = async () => {
    const settings = await ShippingSettings.findOne().select("courier_cod_settlement").lean();
    const map = new Map(KNOWN_PROVIDERS.map((p) => [p, "net"]));
    for (const row of settings?.courier_cod_settlement || []) {
        if (row?.provider) map.set(row.provider, row.cod_mode === "gross" ? "gross" : "net");
    }
    return map;
};

const emptyPosition = (provider) => ({
    provider,
    label: PROVIDER_LABELS[provider] || provider,
    cod_mode: "net",
    parcels: 0,
    collected: 0,
    fees_kept: 0,
    // What the delivery of these same parcels cost us, when it was paid for up front out of
    // a bundle. Reported so the cost is visible, and kept OUT of `fees_kept` and `owed`
    // because it is not deducted from the cash — it left the bank weeks earlier.
    prepaid_shipping: 0,
    owed: 0,
    settled: 0,
    outstanding: 0,
    oldest_delivered_at: null,
    next_expected_at: null,
});

/**
 * Walk every parcel that collected cash and has not been settled, handing each to `onParcel`.
 *
 * Unsettled is the filter that matters, not a date range: money a courier collected in
 * March and still has not transferred is outstanding TODAY, and a screen that only looked at
 * this month would report it as nothing.
 */
const forEachCollectingParcel = async ({ settled = false, provider = null, onParcel }) => {
    const filter = {
        "sub_orders.status": "delivered",
        "transaction.payment_method": "cash",
        // A coarse cut so the scan does not grow with every order ever settled: keep only
        // orders that still hold at least one collecting parcel on the side being asked
        // for. The exact per-parcel test is still done below — this pairs an order's
        // shipments loosely, and a settled parcel sharing an order with an unsettled one
        // is filtered out there.
        shipments: {
            $elemMatch: {
                cod_amount: { $gt: 0 },
                "cod_settlement.settled_at": settled ? { $ne: null } : null,
                ...(provider ? { provider } : {}),
            },
        },
    };

    const cursor = Order.find(filter)
        .select("_id user_id delivered_at sub_orders shipments transaction")
        .lean()
        .cursor();

    for (let order = await cursor.next(); order != null; order = await cursor.next()) {
        for (const sub of order.sub_orders || []) {
            if (sub.status !== "delivered") continue;

            const shipment = liveShipmentFor(order, sub._id);
            if (!shipment) continue;
            const cod = Number(shipment.cod_amount ?? sub.cod_amount ?? 0);
            if (!(cod > 0)) continue;

            const isSettled = !!shipment.cod_settlement?.settled_at;
            if (isSettled !== settled) continue;
            if (provider && (shipment.provider || "bosta") !== provider) continue;

            await onParcel({ order, sub, shipment, cod });
        }
    }
};

/* ------------------------------------------------------------------ */
/*  The headline: what is sitting where                               */
/* ------------------------------------------------------------------ */

/**
 * Cash position per courier: collected, kept, owed, settled, still outstanding.
 *
 * `owed` counts only DELIVERED parcels. A parcel in transit will probably be delivered and
 * will probably turn into cash, but it is not money anyone owes us yet, and a refused parcel
 * never becomes cash at all — it becomes a return leg we pay for.
 */
const getCashPositions = async () => {
    const modes = await settlementModes();
    const positions = new Map(KNOWN_PROVIDERS.map((p) => [p, { ...emptyPosition(p), cod_mode: modes.get(p) || "net" }]));

    const ensure = (provider) => {
        if (!positions.has(provider)) {
            positions.set(provider, { ...emptyPosition(provider), cod_mode: modes.get(provider) || "net" });
        }
        return positions.get(provider);
    };

    await forEachCollectingParcel({
        settled: false,
        onParcel: ({ order, sub, shipment, cod }) => {
            const provider = shipment.provider || "bosta";
            const pos = ensure(provider);
            const fees = feesKeptByCourier(shipment, { codMode: pos.cod_mode });

            pos.parcels += 1;
            pos.collected = round2(pos.collected + cod);
            pos.fees_kept = round2(pos.fees_kept + fees);
            pos.owed = round2(pos.owed + cod - fees);

            if (shipment.courier_cost?.billing_mode === "bundle") {
                pos.prepaid_shipping = round2(pos.prepaid_shipping + Number(shipment.courier_cost.send || 0));
            }

            const deliveredAt = sub.delivered_at || order.delivered_at || null;
            if (deliveredAt && (!pos.oldest_delivered_at || new Date(deliveredAt) < new Date(pos.oldest_delivered_at))) {
                pos.oldest_delivered_at = deliveredAt;
            }

            const expected = shipment.cod_settlement?.expected_at || null;
            if (expected && (!pos.next_expected_at || new Date(expected) < new Date(pos.next_expected_at))) {
                pos.next_expected_at = expected;
            }
        },
    });

    // What has already been transferred, so the screen can show the whole relationship and
    // not just the open end of it.
    const settled = await CourierSettlement.aggregate([
        { $group: { _id: "$provider", amount: { $sum: "$amount" }, count: { $sum: 1 }, last: { $max: "$received_at" } } },
    ]);
    for (const row of settled) {
        const pos = ensure(row._id);
        pos.settled = round2(row.amount);
        pos.settlements_count = row.count;
        pos.last_settled_at = row.last;
    }

    for (const pos of positions.values()) pos.outstanding = pos.owed;

    const list = [...positions.values()].sort((a, b) => b.outstanding - a.outstanding);

    return {
        couriers: list,
        totals: {
            parcels: list.reduce((s, p) => s + p.parcels, 0),
            collected: round2(list.reduce((s, p) => s + p.collected, 0)),
            fees_kept: round2(list.reduce((s, p) => s + p.fees_kept, 0)),
            prepaid_shipping: round2(list.reduce((s, p) => s + p.prepaid_shipping, 0)),
            outstanding: round2(list.reduce((s, p) => s + p.outstanding, 0)),
            settled: round2(list.reduce((s, p) => s + p.settled, 0)),
        },
    };
};

/**
 * Each courier's cash as it stood at the end of a day: what it had collected by then, what
 * had reached the bank by then, and what it was still holding.
 *
 * `getCashPositions` answers "what is outstanding today". A report dated 30 September has
 * to answer for 30 September whatever was delivered or transferred since — so a parcel
 * delivered after `until` is not counted at all, and one settled after it is still
 * outstanding. `kept` is what the courier took on the way: collected, less what it
 * transferred, less what it still holds. It is derived, not re-priced, so the three always
 * add up to the collection — and it goes negative if a transfer was recorded for more than
 * its parcels were booked at.
 */
const getCashPositionsAt = async (until) => {
    const modes = await settlementModes();
    const blank = (provider) => ({
        provider,
        label: PROVIDER_LABELS[provider] || provider,
        cod_mode: modes.get(provider) || "net",
        parcels: 0,
        collected: 0,
        settled: 0,
        outstanding: 0,
        kept: 0,
    });
    const positions = new Map(KNOWN_PROVIDERS.map((p) => [p, blank(p)]));
    const ensure = (provider) => {
        if (!positions.has(provider)) positions.set(provider, blank(provider));
        return positions.get(provider);
    };

    const onParcel = ({ order, sub, shipment, cod }) => {
        const deliveredAt = sub.delivered_at || order.delivered_at || null;
        if (deliveredAt && new Date(deliveredAt) > until) return;

        const pos = ensure(shipment.provider || "bosta");
        pos.parcels += 1;
        pos.collected = round2(pos.collected + cod);

        const settledAt = shipment.cod_settlement?.settled_at || null;
        if (settledAt && new Date(settledAt) <= until) return;
        pos.outstanding = round2(pos.outstanding + cod - feesKeptByCourier(shipment, { codMode: pos.cod_mode }));
    };
    await forEachCollectingParcel({ settled: false, onParcel });
    await forEachCollectingParcel({ settled: true, onParcel });

    const transfers = await CourierSettlement.aggregate([
        { $match: { received_at: { $lte: until } } },
        { $group: { _id: "$provider", amount: { $sum: "$amount" } } },
    ]);
    for (const row of transfers) ensure(row._id).settled = round2(row.amount);

    for (const pos of positions.values()) pos.kept = round2(pos.collected - pos.settled - pos.outstanding);

    return [...positions.values()];
};

/**
 * The parcels behind one courier's outstanding figure, oldest first.
 *
 * Oldest first because that is the order they will be transferred in, and because the oldest
 * unsettled parcel is the one worth asking about.
 */
const listOutstandingParcels = async (provider, { page = 1, limit = 100 } = {}) => {
    const modes = await settlementModes();
    const codMode = modes.get(provider) || "net";
    const rows = [];

    await forEachCollectingParcel({
        settled: false,
        provider,
        onParcel: ({ order, sub, shipment, cod }) => {
            const fees = feesKeptByCourier(shipment, { codMode });
            rows.push({
                order_id: order._id,
                // The parcel's own reference (REF-A3F9-1) when it has one, else the order's.
                // Orders carry no order number of their own; the reference lives on the
                // transaction, and the admin screens show its last 8 characters.
                order_number: sub.reference || order.transaction?.reference || String(order._id).slice(-6),
                sub_order_id: sub._id,
                tracking_number: shipment.tracking_number || shipment.bosta_tracking_number || null,
                delivered_at: sub.delivered_at || order.delivered_at || null,
                expected_at: shipment.cod_settlement?.expected_at || null,
                cod: round2(cod),
                fees_kept: fees,
                owed: round2(cod - fees),
                billing_mode: shipment.courier_cost?.billing_mode || "tariff",
            });
        },
    });

    rows.sort((a, b) => new Date(a.delivered_at || 0) - new Date(b.delivered_at || 0));

    const start = (Math.max(1, page) - 1) * limit;
    return {
        provider,
        cod_mode: codMode,
        total: rows.length,
        total_owed: round2(rows.reduce((s, r) => s + r.owed, 0)),
        page,
        limit,
        parcels: rows.slice(start, start + limit),
    };
};

/* ------------------------------------------------------------------ */
/*  Recording a transfer                                              */
/* ------------------------------------------------------------------ */

/**
 * Record a transfer that reached the bank and close the parcels it paid for.
 *
 * The admin names the parcels rather than the system guessing them from the amount. A
 * transfer that is 40 EGP short could be four parcels short or one unexpected fee, and
 * deciding that by arithmetic would silently mark someone's money as received. So the
 * parcels are explicit, `expected_amount` is what they add up to, and the gap is stored as
 * `difference` where it can be chased.
 *
 * Written parcel by parcel with positional updates rather than one big save: these orders
 * are live, and a delivery webhook landing mid-settlement must not be overwritten by a copy
 * of the order read before it arrived.
 */
const recordSettlement = async (
    provider,
    { amount, received_at, reference = "", notes = "", parcels = [], adminId = null, adminLabel = "Admin" } = {}
) => {
    if (!provider) throw new Error("A courier is required");
    if (!(Number(amount) >= 0)) throw new Error("A transfer amount is required");
    if (!Array.isArray(parcels) || parcels.length === 0) {
        throw new Error("Choose which parcels this transfer covers");
    }

    const modes = await settlementModes();
    const codMode = modes.get(provider) || "net";

    // Re-price the chosen parcels here rather than trusting what the screen sent: the number
    // that goes in the ledger has to come from the orders themselves.
    const wanted = new Set(parcels.map(String));
    const matched = [];
    let expected = 0;

    await forEachCollectingParcel({
        settled: false,
        provider,
        onParcel: ({ order, sub, shipment, cod }) => {
            if (!wanted.has(String(sub._id))) return;
            const fees = feesKeptByCourier(shipment, { codMode });
            expected = round2(expected + cod - fees);
            matched.push({ orderId: order._id, subId: sub._id, shipmentId: shipment._id });
        },
    });

    // All or nothing. A parcel that is already settled, or was never outstanding, means the
    // screen and the database disagree — and half-applying a bank transfer is worse than
    // refusing it.
    if (matched.length !== wanted.size) {
        throw new Error(
            `${wanted.size - matched.length} of the chosen parcels are no longer outstanding — reload and try again`
        );
    }

    const settlement = await CourierSettlement.create({
        provider,
        amount: round2(amount),
        expected_amount: expected,
        difference: round2(Number(amount) - expected),
        received_at: received_at ? new Date(received_at) : new Date(),
        reference: String(reference || "").trim(),
        notes: String(notes || "").trim(),
        parcels_count: matched.length,
        recorded_by: adminId ? new mongoose.Types.ObjectId(adminId) : null,
        recorded_by_name: adminLabel,
    });

    const settledAt = settlement.received_at;
    for (const m of matched) {
        await Order.updateOne(
            { _id: m.orderId, "shipments._id": m.shipmentId },
            {
                $set: {
                    "shipments.$.cod_settlement.settled_at": settledAt,
                    "shipments.$.cod_settlement.settlement_id": settlement._id,
                },
            }
        ).catch((err) => {
            console.error(`[CourierSettlement] Could not close parcel ${m.subId}: ${err.message}`);
        });
    }

    await recordAuditLog({
        action: "courier_settlement_recorded",
        actor: { role: "admin", label: adminLabel },
        target_type: "courier_settlement",
        target_id: settlement._id,
        target_snapshot: {
            provider,
            amount: settlement.amount,
            expected: settlement.expected_amount,
            difference: settlement.difference,
            reference: settlement.reference,
        },
        impact: { parcels: matched.length },
    });

    return settlement.toObject();
};

/** Transfers already recorded, newest first. */
const listSettlements = async ({ provider = "", page = 1, limit = 25 } = {}) => {
    const filter = provider ? { provider } : {};
    const [rows, total] = await Promise.all([
        CourierSettlement.find(filter)
            .sort({ received_at: -1 })
            .skip((Math.max(1, page) - 1) * limit)
            .limit(limit)
            .lean(),
        CourierSettlement.countDocuments(filter),
    ]);
    return { settlements: rows, total, page, limit };
};

/**
 * Undo a settlement that was entered wrongly, putting its parcels back on the outstanding list.
 *
 * Deliberately the only way to change one: editing the amount in place would leave the
 * parcels attached to a figure that no longer explains them.
 */
const deleteSettlement = async (settlementId, { adminId = null, adminLabel = "Admin" } = {}) => {
    const settlement = await CourierSettlement.findById(settlementId);
    if (!settlement) throw new Error("Settlement not found");

    await Order.updateMany(
        { "shipments.cod_settlement.settlement_id": settlement._id },
        {
            $set: {
                "shipments.$[s].cod_settlement.settled_at": null,
                "shipments.$[s].cod_settlement.settlement_id": null,
            },
        },
        { arrayFilters: [{ "s.cod_settlement.settlement_id": settlement._id }] }
    );

    await CourierSettlement.deleteOne({ _id: settlement._id });

    await recordAuditLog({
        action: "courier_settlement_deleted",
        actor: { role: "admin", label: adminLabel },
        target_type: "courier_settlement",
        target_id: settlement._id,
        target_snapshot: {
            provider: settlement.provider,
            amount: settlement.amount,
            reference: settlement.reference,
        },
        impact: { parcels: settlement.parcels_count },
    });

    return { deleted: true };
};

module.exports = {
    KNOWN_PROVIDERS,
    PROVIDER_LABELS,
    feesKeptByCourier,
    getCashPositions,
    getCashPositionsAt,
    listOutstandingParcels,
    recordSettlement,
    listSettlements,
    deleteSettlement,
};
