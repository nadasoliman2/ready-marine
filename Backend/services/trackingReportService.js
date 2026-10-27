/**
 * The ReadyCar tracking report — one row per order that FINISHED inside the period.
 *
 * Built to the layout the finance team drew in "READYCAR TRACKING REPORT.xlsx": the order,
 * what the customer paid, how it splits between the vendor and us, what shipping and
 * collection cost, and who collected the money; plus two period figures — what reached our
 * bank and what we transferred to vendors.
 *
 * WHICH ORDERS. "Executed within the period" means every parcel of the order has reached a
 * final state (delivered, cancelled, or refused and returned) and the LAST of those events
 * falls inside the period. An order with one parcel still on the road waits until it lands.
 *
 * WHICH MONEY. Only what actually happened. Revenue columns count delivered parcels; a
 * cancelled parcel contributes nothing but a cost it really incurred (an Arrive
 * cancellation fee); a refused parcel contributes its outbound and return legs. The parcel
 * rules are the finance module's own (`parcelMoney`, `parcelWasDelivered`, ...), so this
 * report and the P&L cannot disagree about the same parcel.
 *
 * THE PROFIT COLUMN is what the customer paid, less what goes to the vendor, less shipping
 * cost, less the collection fee:
 *
 *     profit = total − vendor_net − shipping_cost − collection_fee
 *            = commission + shipping margin − our share of the coupon − loyalty − fee
 *
 * Commission and vendor net are the figures recorded at delivery. A return refunded AFTER
 * delivery is not netted out here; the refunds screen carries those.
 */
const { Order } = require("../models/orders");
const { VendorEarning } = require("../models/vendorEarnings");
const { OrderPayment } = require("../models/orderPayments");
const { GatewayPayout } = require("../models/gatewayPayouts");
const { CourierSettlement } = require("../models/courierSettlements");
const { WithdrawalRequest } = require("../models/withdrawalRequests");
const bostaCostService = require("./bostaCostService");
const couriers = require("./couriers");
const { gatewayFeeFor } = require("./shared/gatewayFee");
const finance = require("./financeService");

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Terminal parcel states: nothing more will happen to a parcel in one of these. */
const FINAL_PARCEL_STATUSES = ["delivered", "cancelled", "returned"];

/** Hard ceiling on one report, so a click on "all time" cannot pull the whole collection. */
const MAX_ROWS = 5000;

const PAYMENT_LABELS = {
    cash: { key: "COD", ar: "الدفع عند الاستلام", en: "Cash on delivery" },
    wallet: { key: "WALLET", ar: "المحفظة", en: "Wallet" },
    credit_card: { key: "VISA", ar: "بطاقة", en: "Card" },
    company_account: { key: "COMPANY", ar: "حساب شركة", en: "Company account" },
};

const GATEWAY_LABELS = { fawaterak: { ar: "فواتيرك", en: "Fawaterak" }, paymob: { ar: "Paymob", en: "Paymob" } };

const STATUS_LABELS = {
    delivered: { ar: "مسلم", en: "Delivered" },
    partial: { ar: "مسلم جزئيًا", en: "Partly delivered" },
    cancelled: { ar: "ملغي", en: "Cancelled" },
    refused: { ar: "مرتجع (رفض الاستلام)", en: "Refused" },
};

/** When a parcel reached its final state, or null if it has not. */
const parcelFinalAt = (order, sub) => {
    if (finance.parcelWasDelivered(sub)) return finance.parcelDeliveredAt(order, sub);
    if (finance.parcelWasRefused(sub)) return finance.parcelReturnedAt(order, sub);
    if (sub.status === "cancelled") return sub.cancelled_at || null;
    return null;
};

/**
 * Who is holding what an order collected: the courier of each cash parcel, the gateway its
 * card was charged through, the customer's wallet, or the employer's account.
 *
 * The `collector` column says this in words, for a reader. The analysis sheet has to ADD
 * by collector, so the same answer is kept here as amounts. A card order's money is all at
 * the gateway; on a company order only the part the employee paid by card is, and the rest
 * is on the company's invoice.
 */
const collectedBy = ({ method, collected, courierCash, cardPaid, fallbackGateway }) => {
    const shares = [];
    const add = (kind, provider, amount, fee = 0) => {
        if (round2(amount) === 0 && round2(fee) === 0) return;
        shares.push({ kind, provider, amount: round2(amount), fee: round2(fee) });
    };

    if (method === "cash") {
        for (const [provider, held] of courierCash) add("courier", provider, held.amount, held.fee);
        return shares;
    }
    if (method === "wallet") {
        add("wallet", null, collected);
        return shares;
    }
    if (method !== "credit_card" && method !== "company_account") {
        add("bank", null, collected);
        return shares;
    }

    const isCard = method === "credit_card";
    const cardTotal = [...cardPaid.values()].reduce((a, p) => a + p.amount, 0);
    const atGateways = isCard ? collected : Math.min(collected, cardTotal);
    if (cardTotal > 0) {
        // The fee is charged on the whole payment, so it is not scaled down with the amount.
        for (const [provider, paid] of cardPaid) add("gateway", provider, atGateways * (paid.amount / cardTotal), isCard ? paid.fee : 0);
    } else if (isCard) {
        add("gateway", fallbackGateway, collected);
    }
    if (!isCard) add("company", null, collected - atGateways);
    return shares;
};

/**
 * Build the report.
 *
 * @param {{ from?: string, to?: string, language?: 'ar'|'en' }} p
 * @returns {Promise<{ period, rows, totals, transfers, truncated }>}
 */
const getTrackingReport = async ({ from, to, language = "ar" } = {}) => {
    const isAr = language !== "en";
    const L = (pair) => (isAr ? pair.ar : pair.en);
    const range = finance.dateRange(from, to);
    const inRange = (d) => !!d && (!range || ((!range.$gte || d >= range.$gte) && (!range.$lte || d <= range.$lte)));

    // Orders whose every parcel is final. The date cut here is coarse — the exact test is
    // the order's own final date, computed below — but it keeps the scan to the period.
    const filter = {
        "sub_orders.0": { $exists: true },
        sub_orders: { $not: { $elemMatch: { status: { $nin: FINAL_PARCEL_STATUSES } } } },
    };
    if (range) {
        filter.$or = [
            { "sub_orders.delivered_at": range },
            { "sub_orders.cancelled_at": range },
            { delivered_at: range },
            // A refused parcel's date lives in its history; keep them all and test exactly.
            { "sub_orders.status": "returned" },
        ];
    }

    const orders = await Order.find(filter)
        .select("_id user_id created_at delivered_at status items sub_orders shipments transaction shipping total_price coupon_code coupon_discount_amount loyalty shipping_address company")
        .populate("user_id", "name")
        .sort({ created_at: 1 })
        .lean();

    // Keep the orders whose LAST final event is inside the period.
    const finished = [];
    for (const order of orders) {
        const dates = (order.sub_orders || []).map((s) => parcelFinalAt(order, s)).filter(Boolean).map((d) => new Date(d));
        if (dates.length === 0) continue;
        const finalAt = new Date(Math.max(...dates.map((d) => d.getTime())));
        if (!inRange(finalAt)) continue;
        finished.push({ order, finalAt });
    }
    const truncated = finished.length > MAX_ROWS;
    const selected = finished.slice(0, MAX_ROWS);

    const orderIds = selected.map((f) => f.order._id);
    const [earnings, payments] = await Promise.all([
        VendorEarning.find({ order_id: { $in: orderIds } })
            .select("order_id sub_order_id gross_amount coupon_share commission_amount net_amount")
            .lean(),
        OrderPayment.find({ order_id: { $in: orderIds }, status: "paid" })
            .select("order_id amount provider webhook_payloads")
            .lean(),
    ]);
    const earningBySub = new Map(earnings.filter((e) => e.sub_order_id).map((e) => [String(e.sub_order_id), e]));
    const paymentsByOrder = new Map();
    for (const p of payments) {
        const key = String(p.order_id);
        if (!paymentsByOrder.has(key)) paymentsByOrder.set(key, []);
        paymentsByOrder.get(key).push(p);
    }

    const rows = [];
    for (const { order, finalAt } of selected) {
        const costs = await bostaCostService.costsForOrder(order);
        const method = order.transaction?.payment_method || "cash";

        let merchandise = 0, coupon = 0, loyalty = 0, shipping = 0;
        let commission = 0, vendorNet = 0, shippingCost = 0, codFee = 0, collected = 0;
        let delivered = 0, cancelled = 0, refused = 0;
        let lastDeliveredAt = null;
        const courierLabels = new Set();
        // The cash each courier collected on this order, and its fee for collecting it.
        const courierCash = new Map();

        for (const sub of order.sub_orders || []) {
            const cost = costs.get(String(sub._id)) || null;
            const shipment = require("./subOrderService").liveShipmentFor(order, sub);
            const provider = shipment ? couriers.providerOfShipment(shipment) : (sub.courier || null);

            if (finance.parcelWasDelivered(sub)) {
                delivered += 1;
                const m = finance.parcelMoney(sub);
                merchandise += m.merchandise;
                coupon += m.coupon;
                loyalty += m.loyalty;
                shipping += m.shipping;
                collected += m.gross;

                // The split recorded when the parcel was delivered; the parcel's own frozen
                // figures if the earning row has not been written yet.
                const earning = earningBySub.get(String(sub._id));
                const parcelCommission = earning ? Number(earning.commission_amount || 0) : Number(sub.commission_total || 0);
                const parcelVendorNet = earning
                    ? Number(earning.net_amount || 0)
                    : Number(sub.merchandise_total || 0) - Number(sub.coupon_vendor_share || 0) - Number(sub.commission_total || 0);
                commission += parcelCommission;
                vendorNet += parcelVendorNet;

                if (cost) {
                    // The courier's COD fee is the price of COLLECTING, not of moving the box,
                    // so it goes in the collection-fee column, not the shipping cost.
                    shippingCost += Number(cost.total || 0) - Number(cost.extra_cod_fee || 0);
                    codFee += Number(cost.extra_cod_fee || 0);
                }
                if (provider) courierLabels.add(couriers.labelOf(provider, isAr));
                if (method === "cash") {
                    const held = courierCash.get(provider || "bosta") || { amount: 0, fee: 0 };
                    held.amount += m.gross;
                    held.fee += Number(cost?.extra_cod_fee || 0);
                    courierCash.set(provider || "bosta", held);
                }
                const at = finance.parcelDeliveredAt(order, sub);
                if (at && (!lastDeliveredAt || new Date(at) > lastDeliveredAt)) lastDeliveredAt = new Date(at);
            } else if (finance.parcelWasRefused(sub)) {
                refused += 1;
                // Outbound AND return leg. The stamp taken at dispatch has no return leg yet,
                // so it is added the way the P&L adds it.
                let parcelCost = Number(cost?.total || 0) - Number(cost?.extra_cod_fee || 0);
                if (!(Number(cost?.rto) > 0)) {
                    let rto = Number(shipment?.courier_cost?.rto || 0);
                    if (!(rto > 0) && (!shipment?.provider || shipment.provider === "bosta")) {
                        const derived = await bostaCostService.costForParcel(order, sub, { source: "derived" }).catch(() => null);
                        rto = Number(derived?.rto || 0);
                    }
                    parcelCost += rto;
                }
                shippingCost += parcelCost;
                if (provider) courierLabels.add(couriers.labelOf(provider, isAr));
            } else if (sub.status === "cancelled") {
                cancelled += 1;
                // Only what a cancellation really cost: Arrive bills one; Bosta does not.
                shippingCost += Number(shipment?.courier_cost?.cancel_fee || 0);
            }
        }

        // Collection fee: the courier's COD fee on a cash order, the gateway's cut on a card
        // order (charged on the whole payment, cancelled parcels included), nothing on a
        // wallet order — that money was collected, and paid for, when the wallet was topped up.
        let gatewayFee = 0;
        const gatewayLabels = new Set();
        // What each gateway took for this order — a company order can carry a card part too.
        const cardPaid = new Map();
        for (const p of paymentsByOrder.get(String(order._id)) || []) {
            const gateway = p.provider || "fawaterak";
            const { fee } = gatewayFeeFor({ payloads: p.webhook_payloads, amount: p.amount, provider: p.provider });
            const paid = cardPaid.get(gateway) || { amount: 0, fee: 0 };
            paid.amount += Number(p.amount || 0);
            paid.fee += Number(fee || 0);
            cardPaid.set(gateway, paid);
            if (method !== "credit_card") continue;
            gatewayFee += Number(fee || 0);
            const g = GATEWAY_LABELS[gateway];
            gatewayLabels.add(g ? L(g) : p.provider);
        }
        const collectionFee = method === "cash" ? codFee : gatewayFee;

        // Nothing was collected on an order with no delivered parcel — unless a card was
        // charged up front, in which case the gateway did collect (and it was refunded).
        const collector = delivered === 0 && method !== "credit_card"
            ? "—"
            : method === "cash"
            ? ([...courierLabels].join(" + ") || (isAr ? "شركة الشحن" : "Courier"))
            : method === "credit_card"
                ? ([...gatewayLabels].join(" + ") || (isAr ? "بوابة الدفع" : "Payment gateway"))
                : method === "company_account"
                    // Billed to the employer on its monthly invoice (feature 14).
                    ? `${isAr ? "فاتورة شركة" : "Company invoice"}${order.company?.company_name ? ` — ${order.company.company_name}` : ""}`
                    : (isAr ? "ريدي مارين (المحفظة)" : "Ready Marine (wallet)");

        const statusKey = delivered > 0
            ? (cancelled > 0 || refused > 0 ? "partial" : "delivered")
            : refused > 0 ? "refused" : "cancelled";

        const net = merchandise - coupon - loyalty;
        const total = net + shipping;

        rows.push({
            order_id: order._id,
            order_number: order.transaction?.reference || String(order._id).slice(-8).toUpperCase(),
            customer_name: order.user_id?.name || order.shipping_address?.recipient_name || "",
            ordered_at: order.created_at,
            last_delivered_at: lastDeliveredAt,
            finished_at: finalAt,
            status: statusKey,
            status_label: L(STATUS_LABELS[statusKey]),
            merchandise: round2(merchandise),
            coupon: round2(coupon),
            loyalty: round2(loyalty),
            net: round2(net),
            shipping: round2(shipping),
            total: round2(total),
            commission: round2(commission),
            vendor_net: round2(vendorNet),
            shipping_cost: round2(shippingCost),
            shipping_margin: round2(shipping - shippingCost),
            payment_method: (PAYMENT_LABELS[method] || PAYMENT_LABELS.cash).key,
            payment_method_label: L(PAYMENT_LABELS[method] || PAYMENT_LABELS.cash),
            collector,
            collected_by: collectedBy({
                method, collected, courierCash, cardPaid,
                fallbackGateway: String(order.transaction?.provider || "fawaterak").toLowerCase(),
            }),
            collected: round2(collected),
            collection_fee: round2(collectionFee),
            profit: round2(total - vendorNet - shippingCost - collectionFee),
        });
    }

    const sum = (k) => round2(rows.reduce((a, r) => a + Number(r[k] || 0), 0));
    const totals = {
        orders: rows.length,
        merchandise: sum("merchandise"),
        coupon: sum("coupon"),
        loyalty: sum("loyalty"),
        net: sum("net"),
        shipping: sum("shipping"),
        total: sum("total"),
        commission: sum("commission"),
        vendor_net: sum("vendor_net"),
        shipping_cost: sum("shipping_cost"),
        shipping_margin: sum("shipping_margin"),
        collected: sum("collected"),
        collection_fee: sum("collection_fee"),
        profit: sum("profit"),
    };

    // ---- Period figures: money that MOVED inside the period, whatever orders it was for ----
    const moved = range ? { $gte: range.$gte || new Date(0), $lte: range.$lte || new Date() } : { $ne: null };
    const [gatewayIn, courierIn, vendorOut] = await Promise.all([
        GatewayPayout.aggregate([{ $match: { received_at: moved } }, { $group: { _id: "$provider", amount: { $sum: "$amount" }, count: { $sum: 1 } } }]),
        CourierSettlement.aggregate([{ $match: { received_at: moved } }, { $group: { _id: "$provider", amount: { $sum: "$amount" }, count: { $sum: 1 } } }]),
        WithdrawalRequest.aggregate([{ $match: { status: "paid", paid_at: moved } }, { $group: { _id: null, amount: { $sum: "$amount" }, count: { $sum: 1 } } }]),
    ]);
    const bankBreakdown = [
        ...gatewayIn.map((g) => ({ source: "gateway", provider: g._id, label: GATEWAY_LABELS[g._id] ? L(GATEWAY_LABELS[g._id]) : g._id, amount: round2(g.amount), count: g.count })),
        ...courierIn.map((c) => ({ source: "courier", provider: c._id, label: couriers.labelOf(c._id, isAr), amount: round2(c.amount), count: c.count })),
    ];

    return {
        period: { from: from || null, to: to || null },
        rows,
        totals,
        truncated,
        transfers: {
            to_bank: { amount: round2(bankBreakdown.reduce((a, b) => a + b.amount, 0)), breakdown: bankBreakdown },
            to_vendors: { amount: round2(vendorOut[0]?.amount || 0), count: vendorOut[0]?.count || 0 },
        },
    };
};

module.exports = { getTrackingReport, MAX_ROWS };
