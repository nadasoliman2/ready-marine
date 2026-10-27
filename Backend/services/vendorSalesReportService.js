/**
 * The vendor's sales report: one row per parcel of theirs — an order can hold several
 * vendors' parcels, and a vendor sees only their own — with what it sold for, ReadyCar's
 * commission, what is the vendor's, the order's date and the parcel's status.
 *
 * Money:
 *   - once delivered, the parcel's earning (VendorEarning) is the truth: it carries what a
 *     return took back (reversed_net, reversed_commission);
 *   - before that, the parcel's frozen allocation, which is what the earning will be:
 *     merchandise − the vendor's share of a coupon − commission;
 *   - a cancelled parcel is listed, with no commission and nothing to the vendor, and is
 *     left out of the totals.
 * `deductions` is whatever sits between the value and commission and the net (the vendor's
 * coupon share, a return), so every row adds up on screen.
 */

const ExcelJS = require('exceljs');
const mongoose = require('mongoose');
const { Order } = require('../models/orders');
const { VendorEarning } = require('../models/vendorEarnings');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// A parcel waiting in a company's batch is not the vendor's yet (they do not see it).
const HIDDEN = new Set(['held_in_batch']);

const STATUS_GROUPS = {
    delivered: (s) => s === 'delivered',
    returned: (s) => s === 'returned',
    cancelled: (s) => s === 'cancelled',
    in_progress: (s) => !['delivered', 'returned', 'cancelled'].includes(s),
};

const STATUS_AR = {
    pending_review: 'تأكيد المنتجات', awaiting_tracking: 'محتاج رقم تتبع', awaiting_handover: 'جاري التغليف',
    ready_for_pickup: 'في انتظار المندوب', pickup_scheduled: 'تم حجز المندوب', handed_to_courier: 'اتسلمت للمندوب',
    picked_up: 'تم الاستلام', in_transit: 'قيد النقل', out_for_delivery: 'خرج للتسليم', delivered: 'تم التسليم',
    returned: 'تم الإرجاع', exception: 'مشكلة', needs_admin: 'مع إدارة الموقع', cancelled: 'ملغاة',
    in_batch_parcel: 'ضمن شحنة مجمعة',
};

const dayStart = (value) => {
    const d = value ? new Date(`${value}T00:00:00+02:00`) : null; // Cairo
    return d && !Number.isNaN(d.getTime()) ? d : null;
};

/**
 * @param vendorId
 * @param from, to   'YYYY-MM-DD' (the order's date, Cairo days, both included)
 * @param status     all | in_progress | delivered | returned | cancelled
 */
const buildSalesReport = async (vendorId, { from, to, status = 'all' } = {}) => {
    const vendor = new mongoose.Types.ObjectId(String(vendorId));
    const range = {};
    const start = dayStart(from);
    const endDay = dayStart(to);
    if (start) range.$gte = start;
    if (endDay) range.$lt = new Date(endDay.getTime() + 86400000);

    const orders = await Order.find({
        'sub_orders.vendor_id': vendor,
        ...(Object.keys(range).length ? { created_at: range } : {}),
    }).select('reference created_at items sub_orders').sort({ created_at: -1 }).lean();

    const parcels = [];
    for (const order of orders) {
        for (const sub of order.sub_orders || []) {
            if (String(sub.vendor_id) !== String(vendor) || HIDDEN.has(sub.status)) continue;
            parcels.push({ order, sub });
        }
    }
    const earnings = await VendorEarning.find({ sub_order_id: { $in: parcels.map((p) => p.sub._id) } })
        .select('sub_order_id gross_amount commission_amount reversed_commission effective_net status payout_status')
        .lean();
    const earningOf = new Map(earnings.map((e) => [String(e.sub_order_id), e]));

    const inGroup = STATUS_GROUPS[status] || null;
    const rows = [];
    for (const { order, sub } of parcels) {
        if (inGroup && !inGroup(sub.status)) continue;
        const earning = earningOf.get(String(sub._id));
        const cancelled = sub.status === 'cancelled';
        const value = round2(earning ? earning.gross_amount : sub.merchandise_total);
        const commission = cancelled ? 0 : round2(earning
            ? earning.commission_amount - (earning.reversed_commission || 0)
            : sub.commission_total);
        const net = cancelled ? 0 : round2(earning
            ? earning.effective_net
            : sub.merchandise_total - (sub.coupon_vendor_share || 0) - sub.commission_total);
        const items = (order.items || [])
            .filter((i) => String(i.sub_order_id) === String(sub._id))
            .map((i) => ({ title: i.product_title, variant: i.variant_label || '', quantity: i.quantity }));
        rows.push({
            order_id: order._id,
            sub_order_id: sub._id,
            // The parcel's own reference, or the order's short id as the wallet shows it.
            reference: sub.reference || `#${String(order._id).slice(-8)}`,
            created_at: order.created_at,
            status: sub.status,
            delivered_at: sub.delivered_at || null,
            items,
            value,
            commission,
            deductions: cancelled ? 0 : round2(value - commission - net),
            net,
            // Whether the money reached the vendor's wallet, and whether it was paid out.
            earning_status: earning ? earning.status : null,
            paid_out: earning ? earning.payout_status === 'paid' : false,
        });
    }

    const counted = rows.filter((r) => r.status !== 'cancelled');
    const sum = (key) => round2(counted.reduce((s, r) => s + r[key], 0));
    return {
        from: from || null,
        to: to || null,
        status,
        rows,
        totals: {
            orders: counted.length,
            cancelled: rows.length - counted.length,
            value: sum('value'),
            commission: sum('commission'),
            deductions: sum('deductions'),
            net: sum('net'),
        },
    };
};

/** The same report as an Excel workbook, in Arabic, right to left. */
const buildSalesReportWorkbook = async (vendorId, query = {}) => {
    const report = await buildSalesReport(vendorId, query);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Ready Marine';
    wb.created = new Date();
    const ws = wb.addWorksheet('تقرير المبيعات', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    const withDeductions = report.rows.some((r) => Math.abs(r.deductions) > 0.004);
    const titles = ['تاريخ الطلب', 'رقم الطلب', 'المنتجات', 'الحالة', 'قيمة الطلب', 'العمولة', ...(withDeductions ? ['خصومات (كوبون / مرتجع)'] : []), 'الصافي ليك'];
    ws.columns = [14, 20, 50, 18, 14, 12, ...(withDeductions ? [18] : []), 14].map((width) => ({ width }));
    const head = ws.addRow(titles);
    head.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    head.height = 28;
    const MONEY = '#,##0.00';
    const moneyCols = withDeductions ? [5, 6, 7, 8] : [5, 6, 7];
    for (const r of report.rows) {
        const row = ws.addRow([
            new Date(r.created_at),
            r.reference,
            r.items.map((i) => `${i.title}${i.variant ? ` (${i.variant})` : ''} × ${i.quantity}`).join('، '),
            STATUS_AR[r.status] || r.status,
            r.value,
            r.commission,
            ...(withDeductions ? [r.deductions] : []),
            r.net,
        ]);
        row.getCell(1).numFmt = 'yyyy-mm-dd';
        moneyCols.forEach((c) => { row.getCell(c).numFmt = MONEY; });
        if (r.status === 'cancelled') row.font = { color: { argb: 'FF9CA3AF' } };
    }
    const t = report.totals;
    const total = ws.addRow(['', '', `الإجمالي (${t.orders} طلب${t.cancelled ? ` — من غير ${t.cancelled} ملغي` : ''})`, '', t.value, t.commission, ...(withDeductions ? [t.deductions] : []), t.net]);
    total.font = { bold: true };
    moneyCols.forEach((c) => { total.getCell(c).numFmt = MONEY; });

    const period = [report.from, report.to].filter(Boolean).join('_to_') || 'all';
    return { workbook: wb, filename: `readymarine-sales-${period}.xlsx` };
};

module.exports = { buildSalesReport, buildSalesReportWorkbook, STATUS_GROUPS };
