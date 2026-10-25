/**
 * Corporate-account statistics for the admin — feature 14, phase 5.
 *
 * One company, or every company together, month by month over a chosen range. Four
 * questions, the four the feature is measured by:
 *
 *   money         what was invoiced, paid, is still owed, is late — and did invoices get
 *                 paid on time (success measure 3)
 *   activity      orders, sales, average order, how many of the registered employees
 *                 actually order, how much of their limits and of the company's cap they
 *                 use (success measures 1 and 4)
 *   consolidation how much goes to the office and rides in a batch, how batches close (by
 *                 count, by time, alone), parcels and money saved — the figures N and T are
 *                 tuned with (success measure 2)
 *   what they buy the vendors and products each company orders most
 *
 * Everything is read from the records the earlier phases keep — orders, the ledger, the
 * spend counters, batches and invoices — nothing is stored for the report. Months are
 * the company month the orders count against (store time zone), the same key the limits,
 * ledger and invoices use.
 */

const ExcelJS = require('exceljs');
const { Order } = require('../models/orders');
const { Company, CompanyMembership } = require('../models/companies');
const { CompanyLedgerEntry, CompanySpendCounter } = require('../models/companyLedger');
const { CompanyBatch } = require('../models/companyBatches');
const { CompanyInvoice } = require('../models/companyInvoices');
const { Seller } = require('../models/sellers');
const {
    companyError, round2, monthKey, isObjectId, effectiveLimit, loadCompanyById,
} = require('./companyService');

const DAY = 24 * 3600 * 1000;
const MAX_MONTHS = 24;
const pct = (part, whole) => (whole > 0 ? round2((part / whole) * 100) : null);

/* ------------------------------------------------------------------ */
/* The month range                                                     */
/* ------------------------------------------------------------------ */

const shiftMonth = (key, delta) => {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 15));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Every month from `from` to `to` inclusive; the last six by default, never more than 24. */
const monthRange = ({ from, to } = {}) => {
    const valid = (k) => typeof k === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(k);
    const end = valid(to) ? to : monthKey();
    let start = valid(from) ? from : shiftMonth(end, -5);
    if (start > end) throw companyError('INVALID_RANGE', 'The start month is after the end month', 400);
    // Never more than 24 months: the most recent ones win.
    const earliest = shiftMonth(end, -(MAX_MONTHS - 1));
    if (start < earliest) start = earliest;
    const months = [];
    for (let k = start; k <= end; k = shiftMonth(k, 1)) months.push(k);
    return months;
};

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

const emptyMonth = (month) => ({
    month,
    money: { invoiced: 0, paid: 0, outstanding: 0, overdue: 0, max_days_late: 0, invoices: 0, due: 0, paid_on_time: 0, on_time_rate: null, company_share: 0, state: 'none' },
    activity: { orders: 0, car_orders: 0, sales: 0, company_share: 0, employee_paid: 0, avg_order: 0, active_employees: 0, registered_employees: 0, active_rate: null, cap: 0, cap_used: 0, cap_usage: null, limits: 0, limits_used: 0, limit_usage: null },
    consolidation: { office_orders: 0, office_rate: null, consolidated_orders: 0, consolidated_rate: null, batches: 0, by_count: 0, by_time: 0, by_admin: 0, alone: 0, avg_size: null, avg_hours_to_close: null, parcels_saved: 0, savings: 0, shipping_charged: 0, courier_cost: 0, subsidy: 0, subsidy_saved_estimate: null },
});

/** What one parcel's delivery leg cost us, as frozen on its shipment at dispatch. */
const legCost = (shipment) => {
    const c = shipment?.courier_cost || {};
    const base = c.billing_mode === 'bundle' ? Number(c.list_send || 0) : Number(c.send || 0);
    return base + Number(c.extra_cod || 0);
};

/**
 * All the raw rows for a scope (one company or all) and a set of months, read once.
 */
const loadScope = async (companyIds, months) => {
    const scope = companyIds ? { $in: companyIds } : { $exists: true };
    const [orders, ledger, counters, invoices, batches, companies, memberships] = await Promise.all([
        Order.find({ 'company.company_id': scope, 'company.month': { $in: months } })
            .select('user_id created_at status total_price company items.product_id items.product_title items.quantity items.unit_price items.vendor_id items.sub_order_id sub_orders._id sub_orders.status sub_orders.shipping_share sub_orders.company_batch shipments.sub_order_id shipments.courier_cost shipments.superseded_at')
            .lean(),
        CompanyLedgerEntry.aggregate([
            // By the month the purchase belongs to, not the month it is invoiced in.
            { $match: { company_id: scope } },
            { $addFields: { purchase_month: { $ifNull: ['$deferred_from', '$month'] } } },
            { $match: { purchase_month: { $in: months } } },
            { $group: { _id: { company_id: '$company_id', month: '$purchase_month' }, net: { $sum: '$amount' } } },
        ]),
        CompanySpendCounter.find({ company_id: scope, month: { $in: months } }).select('company_id month scope user_id amount').lean(),
        CompanyInvoice.find({ company_id: scope, month: { $in: months }, snapshot_at: { $ne: null } })
            .select('company_id month amount_due amount_paid status due_at paid_at').lean(),
        CompanyBatch.find({ company_id: scope, status: 'closed', closed_at: { $gte: rangeStart(months[0]) } })
            .select('company_id opened_at closed_at close_reason members.status members.dropped_at members.savings').lean(),
        Company.find(companyIds ? { _id: { $in: companyIds } } : {}).lean(),
        CompanyMembership.find({ company_id: scope, status: 'active' }).lean(),
    ]);
    return { orders, ledger, counters, invoices, batches, companies, memberships };
};

/** A safe lower bound for the first month's instants (a day early covers any time zone). */
const rangeStart = (key) => {
    const [y, m] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1) - DAY);
};

/** Month key of an instant, in the store's time zone. */
const monthOf = (date) => monthKey(new Date(date));

/**
 * Fold the raw rows into months, a total over the range, and per-company rows.
 */
const compute = (raw, months, { now = new Date() } = {}) => {
    const byMonth = new Map(months.map((m) => [m, emptyMonth(m)]));
    const byCompany = new Map(raw.companies.map((c) => [String(c._id), {
        company_id: c._id, name: c.name, status: c.status,
        orders: 0, sales: 0, company_share: 0, invoiced: 0, paid: 0, outstanding: 0, overdue: 0,
        office_orders: 0, consolidated_orders: 0, savings: 0, parcels_saved: 0,
        active: new Set(), registered: 0, cap_used: 0, cap: 0,
    }]));
    const companyById = new Map(raw.companies.map((c) => [String(c._id), c]));
    const activeByMonth = new Map(months.map((m) => [m, new Set()]));
    const vendors = new Map();
    const products = new Map();
    const perCompanyTop = new Map();
    let singleLegCosts = [];

    // ---- Orders ----
    for (const o of raw.orders) {
        const month = o.company?.month;
        const row = byMonth.get(month);
        if (!row) continue;
        const live = o.status !== 'cancelled';
        const cRow = byCompany.get(String(o.company.company_id));
        const liveSubIds = new Set((o.sub_orders || []).filter((s) => s.status !== 'cancelled').map((s) => String(s._id)));

        // Shipping money and courier costs happen even on a partly cancelled order.
        for (const s of o.sub_orders || []) {
            if (s.status === 'cancelled') continue;
            row.consolidation.shipping_charged += Number(s.shipping_share || 0);
            if (s.company_batch?.role === 'rider') {
                row.consolidation.parcels_saved += 1;
                if (cRow) cRow.parcels_saved += 1;
            }
            const saving = Number(s.company_batch?.savings || 0);
            row.consolidation.savings += saving;
            if (cRow) cRow.savings += saving;
        }
        for (const sh of o.shipments || []) {
            if (sh.superseded_at || !liveSubIds.has(String(sh.sub_order_id))) continue;
            const cost = legCost(sh);
            row.consolidation.courier_cost += cost;
            const sub = (o.sub_orders || []).find((s) => String(s._id) === String(sh.sub_order_id));
            if (cost > 0 && sub && sub.company_batch?.role !== 'lead') singleLegCosts.push(cost);
        }

        if (!live) continue;
        row.activity.orders += 1;
        row.activity.sales += Number(o.total_price || 0);
        row.activity.employee_paid += Number(o.company?.personal_amount || 0);
        if (o.company.beneficiary === 'car') row.activity.car_orders += 1;
        else activeByMonth.get(month).add(String(o.user_id));
        if (o.company.office_id) row.consolidation.office_orders += 1;
        if (o.company.delivery_mode === 'consolidate') row.consolidation.consolidated_orders += 1;
        if (cRow) {
            cRow.orders += 1;
            cRow.sales += Number(o.total_price || 0);
            if (o.company.beneficiary !== 'car') cRow.active.add(String(o.user_id));
            if (o.company.office_id) cRow.office_orders += 1;
            if (o.company.delivery_mode === 'consolidate') cRow.consolidated_orders += 1;
        }

        // What they buy: goods on parcels that were not cancelled.
        const top = perCompanyTop.get(String(o.company.company_id)) || { vendors: new Map(), products: new Map() };
        perCompanyTop.set(String(o.company.company_id), top);
        const seenVendors = new Set();
        for (const it of o.items || []) {
            if (it.sub_order_id && !liveSubIds.has(String(it.sub_order_id))) continue;
            const amount = Number(it.unit_price || 0) * Number(it.quantity || 0);
            for (const [map, key, base] of [
                [vendors, String(it.vendor_id), { vendor_id: it.vendor_id }],
                [top.vendors, String(it.vendor_id), { vendor_id: it.vendor_id }],
                [products, String(it.product_id), { product_id: it.product_id, title: it.product_title }],
                [top.products, String(it.product_id), { product_id: it.product_id, title: it.product_title }],
            ]) {
                const v = map.get(key) || { ...base, orders: 0, quantity: 0, sales: 0 };
                v.quantity += Number(it.quantity || 0);
                v.sales += amount;
                map.set(key, v);
            }
            if (!seenVendors.has(String(it.vendor_id))) {
                seenVendors.add(String(it.vendor_id));
                vendors.get(String(it.vendor_id)).orders += 1;
                top.vendors.get(String(it.vendor_id)).orders += 1;
            }
            products.get(String(it.product_id)).orders += 1;
            top.products.get(String(it.product_id)).orders += 1;
        }
    }

    // ---- The company's share, from the ledger (after savings, returns and adjustments) ----
    for (const l of raw.ledger) {
        const row = byMonth.get(l._id.month);
        if (!row) continue;
        row.activity.company_share += Number(l.net || 0);
        const cRow = byCompany.get(String(l._id.company_id));
        if (cRow) cRow.company_share += Number(l.net || 0);
    }

    // ---- Cap and limit usage, from the counters the limits are enforced against ----
    for (const c of raw.counters) {
        const row = byMonth.get(c.month);
        if (!row) continue;
        const amount = Math.max(0, Number(c.amount || 0));
        if (c.scope === 'company') {
            row.activity.cap_used += amount;
            const cRow = byCompany.get(String(c.company_id));
            if (cRow) cRow.cap_used += amount;
        } else {
            row.activity.limits_used += amount;
        }
    }
    // Caps and limits as they stand today — the history of a limit is not kept.
    let totalCap = 0;
    let totalLimits = 0;
    let registered = 0;
    for (const m of raw.memberships) {
        const company = companyById.get(String(m.company_id));
        if (!company || !m.is_employee) continue;
        registered += 1;
        totalLimits += effectiveLimit(company, m).limit ?? 0; // null: the company has no employee limits
        const cRow = byCompany.get(String(m.company_id));
        if (cRow) cRow.registered += 1;
    }
    for (const c of raw.companies) {
        // A monthly cap is a month's allowance. On a credit wallet the same field is a
        // credit line — a total, not something to multiply by the months.
        const cap = require('./companyWalletService').isWallet(c) ? 0 : Number(c.monthly_cap || 0);
        totalCap += cap;
        const cRow = byCompany.get(String(c._id));
        if (cRow) cRow.cap = cap * months.length;
    }

    // ---- Invoices ----
    for (const inv of raw.invoices) {
        const row = byMonth.get(inv.month);
        if (!row) continue;
        const balance = Math.max(0, Number(inv.amount_due || 0) - Number(inv.amount_paid || 0));
        const late = balance > 0.005 && new Date(inv.due_at) < now;
        row.money.invoices += 1;
        row.money.invoiced += Number(inv.amount_due || 0);
        row.money.paid += Number(inv.amount_paid || 0);
        row.money.outstanding += balance;
        if (late) {
            row.money.overdue += balance;
            row.money.max_days_late = Math.max(row.money.max_days_late, Math.floor((now - new Date(inv.due_at)) / DAY) + 1);
        }
        // On time: only invoices whose due date has come are judged.
        if (new Date(inv.due_at) < now && Number(inv.amount_due || 0) > 0.005) {
            row.money.due += 1;
            if (inv.status === 'paid' && inv.paid_at && new Date(inv.paid_at) <= new Date(inv.due_at)) row.money.paid_on_time += 1;
        }
        const cRow = byCompany.get(String(inv.company_id));
        if (cRow) {
            cRow.invoiced += Number(inv.amount_due || 0);
            cRow.paid += Number(inv.amount_paid || 0);
            cRow.outstanding += balance;
            if (late) cRow.overdue += balance;
        }
    }

    // ---- Batches, by the month they closed in ----
    const hoursByMonth = new Map();
    const sizesByMonth = new Map();
    for (const b of raw.batches) {
        const month = monthOf(b.closed_at);
        const row = byMonth.get(month);
        if (!row) continue;
        const size = (b.members || []).filter((m) => m.status === 'released').length;
        if (size === 0) continue;
        row.consolidation.batches += 1;
        if (b.close_reason === 'count') row.consolidation.by_count += 1;
        else if (b.close_reason === 'admin') row.consolidation.by_admin += 1;
        else row.consolidation.by_time += 1;
        if (size === 1) row.consolidation.alone += 1;
        (sizesByMonth.get(month) || sizesByMonth.set(month, []).get(month)).push(size);
        (hoursByMonth.get(month) || hoursByMonth.set(month, []).get(month)).push((new Date(b.closed_at) - new Date(b.opened_at)) / 3600000);
    }

    // ---- The estimate: what a single parcel's delivery leg typically costs us ----
    const avgLeg = singleLegCosts.length ? singleLegCosts.reduce((a, b) => a + b, 0) / singleLegCosts.length : null;

    // ---- Finish each month ----
    const invoicedMonths = new Set(raw.invoices.map((i) => i.month));
    for (const row of byMonth.values()) {
        const a = row.activity;
        const c = row.consolidation;
        const m = row.money;
        a.active_employees = activeByMonth.get(row.month).size;
        a.registered_employees = registered;
        a.active_rate = pct(a.active_employees, registered);
        a.avg_order = a.orders ? round2(a.sales / a.orders) : 0;
        a.cap = round2(totalCap);
        a.cap_usage = pct(a.cap_used, totalCap);
        a.limits = round2(totalLimits);
        a.limit_usage = pct(a.limits_used, totalLimits);
        c.office_rate = pct(c.office_orders, a.orders);
        c.consolidated_rate = pct(c.consolidated_orders, a.orders);
        const sizes = sizesByMonth.get(row.month) || [];
        c.avg_size = sizes.length ? round2(sizes.reduce((x, y) => x + y, 0) / sizes.length) : null;
        const hours = hoursByMonth.get(row.month) || [];
        c.avg_hours_to_close = hours.length ? round2(hours.reduce((x, y) => x + y, 0) / hours.length) : null;
        c.subsidy = round2(c.courier_cost - c.shipping_charged);
        // Deliveries we did not have to pay for, less the shipping we gave back for them.
        c.subsidy_saved_estimate = avgLeg !== null ? round2(c.parcels_saved * avgLeg - c.savings) : null;
        m.company_share = round2(a.company_share);
        m.on_time_rate = pct(m.paid_on_time, m.due);
        m.state = invoicedMonths.has(row.month) ? 'invoiced' : (row.month >= monthKey(now) ? 'current' : (a.orders ? 'pending' : 'none'));
        for (const k of Object.keys(a)) if (typeof a[k] === 'number' && !k.endsWith('_rate') && !k.endsWith('_usage')) a[k] = round2(a[k]);
        for (const k of Object.keys(c)) if (typeof c[k] === 'number' && !k.endsWith('_rate')) c[k] = round2(c[k]);
        for (const k of ['invoiced', 'paid', 'outstanding', 'overdue']) m[k] = round2(m[k]);
    }

    const rows = months.map((m) => byMonth.get(m));
    const sum = (f) => round2(rows.reduce((s, r) => s + Number(f(r) || 0), 0));
    const totals = {
        orders: sum((r) => r.activity.orders),
        sales: sum((r) => r.activity.sales),
        company_share: sum((r) => r.activity.company_share),
        employee_paid: sum((r) => r.activity.employee_paid),
        avg_order: sum((r) => r.activity.orders) ? round2(sum((r) => r.activity.sales) / sum((r) => r.activity.orders)) : 0,
        invoiced: sum((r) => r.money.invoiced),
        paid: sum((r) => r.money.paid),
        outstanding: sum((r) => r.money.outstanding),
        overdue: sum((r) => r.money.overdue),
        on_time_rate: pct(sum((r) => r.money.paid_on_time), sum((r) => r.money.due)),
        registered_employees: registered,
        active_employees: new Set(rows.flatMap((r) => [...activeByMonth.get(r.month)])).size,
        office_rate: pct(sum((r) => r.consolidation.office_orders), sum((r) => r.activity.orders)),
        consolidated_rate: pct(sum((r) => r.consolidation.consolidated_orders), sum((r) => r.activity.orders)),
        batches: sum((r) => r.consolidation.batches),
        by_count: sum((r) => r.consolidation.by_count),
        by_time: sum((r) => r.consolidation.by_time),
        by_admin: sum((r) => r.consolidation.by_admin),
        alone: sum((r) => r.consolidation.alone),
        parcels_saved: sum((r) => r.consolidation.parcels_saved),
        savings: sum((r) => r.consolidation.savings),
        subsidy: sum((r) => r.consolidation.subsidy),
        subsidy_saved_estimate: avgLeg !== null ? sum((r) => r.consolidation.subsidy_saved_estimate) : null,
        avg_parcel_cost: avgLeg !== null ? round2(avgLeg) : null,
        cap_usage: pct(sum((r) => r.activity.cap_used), totalCap * months.length),
        limit_usage: pct(sum((r) => r.activity.limits_used), totalLimits * months.length),
    };
    const allSizes = [...sizesByMonth.values()].flat();
    const allHours = [...hoursByMonth.values()].flat();
    totals.avg_batch_size = allSizes.length ? round2(allSizes.reduce((a, b) => a + b, 0) / allSizes.length) : null;
    totals.avg_hours_to_close = allHours.length ? round2(allHours.reduce((a, b) => a + b, 0) / allHours.length) : null;

    const companies = [...byCompany.values()].map((c) => ({
        company_id: c.company_id,
        name: c.name,
        status: c.status,
        orders: c.orders,
        sales: round2(c.sales),
        company_share: round2(c.company_share),
        invoiced: round2(c.invoiced),
        paid: round2(c.paid),
        outstanding: round2(c.outstanding),
        overdue: round2(c.overdue),
        office_rate: pct(c.office_orders, c.orders),
        consolidated_rate: pct(c.consolidated_orders, c.orders),
        savings: round2(c.savings),
        parcels_saved: c.parcels_saved,
        active_employees: c.active.size,
        registered_employees: c.registered,
        active_rate: pct(c.active.size, c.registered),
        cap_usage: pct(c.cap_used, c.cap),
    })).sort((a, b) => b.sales - a.sales);

    return { rows, totals, companies, vendors, products, perCompanyTop };
};

/** The top of a tally map, with vendor names filled in. */
const topOf = async (map, limit = 10) => {
    const list = [...map.values()].sort((a, b) => b.sales - a.sales).slice(0, limit);
    const vendorIds = list.filter((v) => v.vendor_id).map((v) => v.vendor_id);
    const names = vendorIds.length
        ? new Map((await Seller.find({ _id: { $in: vendorIds } }).select('store_name store_username').lean()).map((s) => [String(s._id), s.store_name || s.store_username]))
        : new Map();
    return list.map((v) => ({
        ...v,
        name: v.vendor_id ? (names.get(String(v.vendor_id)) || '') : (v.title || ''),
        sales: round2(v.sales),
    }));
};

/**
 * What the N and T settings are doing, in words an admin can act on. Deliberately modest:
 * a hint, never an automatic change.
 */
const tuningHint = (totals) => {
    if (!totals.batches) return null;
    const timeShare = (totals.by_time / totals.batches) * 100;
    const aloneShare = (totals.alone / totals.batches) * 100;
    if (aloneShare >= 50) return { key: 'mostly_alone', time_share: round2(timeShare), alone_share: round2(aloneShare) };
    if (timeShare >= 60) return { key: 'mostly_time', time_share: round2(timeShare), alone_share: round2(aloneShare) };
    if (timeShare <= 20 && totals.avg_hours_to_close !== null && totals.avg_hours_to_close < 6) {
        return { key: 'fills_fast', time_share: round2(timeShare), alone_share: round2(aloneShare) };
    }
    return { key: 'balanced', time_share: round2(timeShare), alone_share: round2(aloneShare) };
};

/* ------------------------------------------------------------------ */
/* Public                                                              */
/* ------------------------------------------------------------------ */

/** Every company together. */
const overallStats = async (query = {}) => {
    const months = monthRange(query);
    const raw = await loadScope(null, months);
    const out = compute(raw, months);
    const { getCorporateSettings } = require('./companyService');
    const settings = await getCorporateSettings();
    return {
        scope: 'all',
        from: months[0],
        to: months[months.length - 1],
        months: out.rows,
        totals: out.totals,
        companies: out.companies,
        top_vendors: await topOf(out.vendors),
        top_products: await topOf(out.products),
        consolidation_setting: { order_count: settings.batch_order_count, wait_hours: settings.batch_wait_hours },
        tuning: tuningHint(out.totals),
    };
};

/** One company. */
const companyStats = async (companyId, query = {}) => {
    if (!isObjectId(companyId)) throw companyError('COMPANY_NOT_FOUND', 'Company not found', 404);
    const company = await loadCompanyById(companyId);
    const months = monthRange(query);
    const raw = await loadScope([company._id], months);
    const out = compute(raw, months);
    const top = out.perCompanyTop.get(String(company._id)) || { vendors: new Map(), products: new Map() };
    const { getCorporateSettings, effectiveConsolidation } = require('./companyService');
    return {
        scope: 'company',
        company: { _id: company._id, name: company.name, status: company.status },
        from: months[0],
        to: months[months.length - 1],
        months: out.rows,
        totals: out.totals,
        top_vendors: await topOf(top.vendors),
        top_products: await topOf(top.products),
        consolidation_setting: effectiveConsolidation(company, await getCorporateSettings()),
        tuning: tuningHint(out.totals),
    };
};

/* ------------------------------------------------------------------ */
/* Excel                                                               */
/* ------------------------------------------------------------------ */

const buildStatsWorkbook = async (data) => {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'ReadyCar';
    wb.created = new Date();
    const MONEY = '#,##0.00';
    const PCT = '0.0"%"';
    const header = (ws, titles, widths) => {
        ws.columns = widths.map((width) => ({ width }));
        const row = ws.addRow(titles);
        row.eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        });
        row.height = 32;
    };
    const fmt = (row, moneyCols = [], pctCols = []) => {
        moneyCols.forEach((c) => { row.getCell(c).numFmt = MONEY; });
        pctCols.forEach((c) => { row.getCell(c).numFmt = PCT; });
    };
    const view = { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] };

    const monthly = wb.addWorksheet('شهر بشهر', view);
    header(monthly, [
        'الشهر', 'الأوردرات', 'أوردرات العربيات', 'المبيعات', 'على الشركات', 'دفعه الموظفين', 'متوسط الأوردر',
        'موظفين نشطين', 'من المسجلين %', 'استهلاك السقف %', 'استهلاك الليميتات %',
        'المفوتر', 'المدفوع', 'المتبقي', 'المتأخر', 'اتدفعت في ميعادها %',
        'على الفرع %', 'بالتجميع %', 'دفعات قفلت', 'بالعدد', 'بالوقت', 'من الأدمن', 'لوحدها', 'متوسط حجم الدفعة', 'متوسط ساعات القفل',
        'طرود اتوفرت', 'توفير الشركات', 'الشحن المحصّل', 'تكلفة الشحن علينا', 'دعم الشحن', 'دعم اتوفر (تقديري)',
    ], [10, 10, 10, 14, 14, 12, 12, 10, 10, 10, 10, 14, 14, 14, 14, 12, 10, 10, 10, 8, 8, 8, 8, 10, 10, 10, 12, 12, 12, 12, 12]);
    for (const r of data.months) {
        const a = r.activity;
        const m = r.money;
        const c = r.consolidation;
        const row = monthly.addRow([
            r.month, a.orders, a.car_orders, a.sales, a.company_share, a.employee_paid, a.avg_order,
            a.active_employees, a.active_rate, a.cap_usage, a.limit_usage,
            m.invoiced, m.paid, m.outstanding, m.overdue, m.on_time_rate,
            c.office_rate, c.consolidated_rate, c.batches, c.by_count, c.by_time, c.by_admin, c.alone, c.avg_size, c.avg_hours_to_close,
            c.parcels_saved, c.savings, c.shipping_charged, c.courier_cost, c.subsidy, c.subsidy_saved_estimate,
        ]);
        fmt(row, [4, 5, 6, 7, 12, 13, 14, 15, 27, 28, 29, 30, 31], [9, 10, 11, 16, 17, 18]);
    }

    if (data.companies) {
        const companies = wb.addWorksheet('الشركات', view);
        header(companies, ['الشركة', 'الحالة', 'الأوردرات', 'المبيعات', 'على الشركة', 'المفوتر', 'المدفوع', 'المتبقي', 'المتأخر', 'على الفرع %', 'بالتجميع %', 'التوفير', 'طرود اتوفرت', 'موظفين نشطين', 'المسجلين', 'استهلاك السقف %'],
            [26, 10, 10, 14, 14, 14, 14, 14, 14, 10, 10, 12, 10, 10, 10, 10]);
        for (const c of data.companies) {
            const row = companies.addRow([c.name, ({ active: 'نشطة', suspended: 'موقوفة', ended: 'انتهى التعاقد' }[c.status] || c.status), c.orders, c.sales, c.company_share, c.invoiced, c.paid, c.outstanding, c.overdue, c.office_rate, c.consolidated_rate, c.savings, c.parcels_saved, c.active_employees, c.registered_employees, c.cap_usage]);
            fmt(row, [4, 5, 6, 7, 8, 9, 12], [10, 11, 16]);
        }
    }

    for (const [title, list] of [['أكتر الموردين', data.top_vendors], ['أكتر المنتجات', data.top_products]]) {
        const ws = wb.addWorksheet(title, view);
        header(ws, ['الاسم', 'عدد الأوردرات', 'الكمية', 'المبيعات'], [36, 12, 10, 14]);
        for (const v of list) fmt(ws.addRow([v.name, v.orders, v.quantity, v.sales]), [4]);
    }
    return wb;
};

const exportOverall = async (query = {}) => {
    const data = await overallStats(query);
    return { workbook: await buildStatsWorkbook(data), filename: `readycar-companies-${data.from}-to-${data.to}.xlsx` };
};

const exportCompany = async (companyId, query = {}) => {
    const data = await companyStats(companyId, query);
    return { workbook: await buildStatsWorkbook(data), filename: `readycar-company-stats-${data.from}-to-${data.to}.xlsx` };
};

/** For the companies list: this month's orders and active employees, per company. */
const monthActivityByCompany = async (companyIds, month = monthKey()) => {
    const rows = await Order.aggregate([
        { $match: { 'company.company_id': { $in: companyIds }, 'company.month': month, status: { $ne: 'cancelled' } } },
        {
            $group: {
                _id: '$company.company_id',
                orders: { $sum: 1 },
                employees: { $addToSet: { $cond: [{ $eq: ['$company.beneficiary', 'employee'] }, '$user_id', null] } },
            },
        },
    ]);
    return new Map(rows.map((r) => [String(r._id), { orders: r.orders, active_employees: r.employees.filter(Boolean).length }]));
};

module.exports = {
    monthRange,
    overallStats,
    companyStats,
    exportOverall,
    exportCompany,
    monthActivityByCompany,
};
