/**
 * The tracking report as an Excel workbook, laid out the way the finance team drew it in
 * "READYCAR TRACKING REPORT.xlsx": the period on row 2, the 23 headers on row 3, one order
 * per row from row 4, and the two period figures (money into our bank, money out to
 * vendors) as single merged cells down columns V and W.
 *
 * The derived columns are live formulas — net, total, shipping margin, profit, and the
 * totals row — so the sheet still adds up if someone corrects a figure in it. Each carries
 * its computed result too, so it reads correctly even in a viewer that does not
 * recalculate.
 */
const ExcelJS = require("exceljs");
const { addSalesPaymentsSheet } = require("./salesPaymentsAnalysisExcel");

const FONT = "Arial";
const RED = "FFDC2626";
const MONEY = "#,##0.00";
const DATE = "yyyy-mm-dd";

/** The template's headers, verbatim, A → W. */
const HEADERS = [
    "م", "رقم الطلب", "اسم العميل", "تاريخ الطلب", "تاريخ اخر استلام", "حاله الطلب",
    "مبلغ الطلب", "خصم", "ولاء العملاء", "صافي الطلب", "قيمة الشحن", "الاجمالي ",
    "عمولة ريدي كار", "صافي التاجر", "تكلفة الشحن", "هامش الشحن", "اجمالي ربح ريدي كار",
    "طريقة الدفع", "الشركة المسؤولة عن التحصيل", "المبلغ المحصل", "عمولة التحصيل",
    "مبلغ التحويل للبنك ", "مبلغ التحويل للتاجر ",
];

const WIDTHS = [6, 16, 22, 13, 15, 16, 13, 11, 12, 13, 12, 13, 14, 13, 12, 12, 16, 12, 22, 14, 13, 18, 18];

const toDate = (d) => (d ? new Date(d) : null);

/** A formula cell that also carries its value, for viewers that do not recalculate. */
const f = (formula, result) => ({ formula, result: Math.round((Number(result) || 0) * 100) / 100 });

const buildTrackingReportWorkbook = async (report, analysis = null) => {
    const wb = new ExcelJS.Workbook();
    wb.creator = "ReadyCar";
    wb.created = new Date();
    // Recalculate on open: a zero result is not stored with its formula, and the sheet
    // must add up in Excel whatever the viewer that wrote it cached.
    wb.calcProperties.fullCalcOnLoad = true;
    const ws = wb.addWorksheet("تقرير التتبع", {
        views: [{ rightToLeft: true, state: "frozen", xSplit: 2, ySplit: 3 }],
    });

    ws.columns = WIDTHS.map((width) => ({ width }));

    // ---- Row 1: title ----
    ws.getCell("A1").value = "READYCAR TRACKING REPORT";
    ws.getCell("A1").font = { name: FONT, size: 14, bold: true, color: { argb: RED } };

    // ---- Row 2: the period, and the rule for which orders are in it ----
    ws.getCell("G2").value = "الفترة من";
    ws.getCell("H2").value = report.period.from ? toDate(report.period.from) : "من البداية";
    ws.getCell("J2").value = "الفترة الي ";
    ws.getCell("K2").value = report.period.to ? toDate(report.period.to) : "حتى اليوم";
    ws.mergeCells("M2:P2");
    ws.getCell("M2").value = "التقرير يعرض الطلبات فقط المنفذة خلال الفترة ";
    for (const addr of ["G2", "J2", "M2"]) ws.getCell(addr).font = { name: FONT, bold: true };
    for (const addr of ["H2", "K2"]) {
        ws.getCell(addr).font = { name: FONT };
        ws.getCell(addr).numFmt = DATE;
    }
    ws.getCell("M2").alignment = { horizontal: "center" };

    // ---- Row 3: headers ----
    const header = ws.getRow(3);
    HEADERS.forEach((h, i) => {
        const c = header.getCell(i + 1);
        c.value = h;
        c.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED } };
        c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        c.border = { bottom: { style: "thin", color: { argb: "FF7F1D1D" } } };
    });
    header.height = 32;

    // ---- Rows 4…: one order each ----
    const first = 4;
    const rows = report.rows || [];
    rows.forEach((r, i) => {
        const n = first + i;
        const row = ws.getRow(n);
        row.getCell(1).value = i + 1;                                  // A م
        row.getCell(2).value = r.order_number;                          // B
        row.getCell(3).value = r.customer_name;                         // C
        row.getCell(4).value = toDate(r.ordered_at);                    // D
        row.getCell(5).value = toDate(r.last_delivered_at);             // E
        row.getCell(6).value = r.status_label;                          // F
        row.getCell(7).value = r.merchandise;                           // G
        row.getCell(8).value = r.coupon;                                // H
        row.getCell(9).value = r.loyalty;                               // I
        row.getCell(10).value = f(`G${n}-H${n}-I${n}`, r.net);          // J صافي الطلب
        row.getCell(11).value = r.shipping;                             // K
        row.getCell(12).value = f(`J${n}+K${n}`, r.total);              // L الاجمالي
        row.getCell(13).value = r.commission;                           // M
        row.getCell(14).value = r.vendor_net;                           // N
        row.getCell(15).value = r.shipping_cost;                        // O
        row.getCell(16).value = f(`K${n}-O${n}`, r.shipping_margin);    // P هامش الشحن
        row.getCell(17).value = f(`L${n}-N${n}-O${n}-U${n}`, r.profit); // Q ربح ريدي كار
        row.getCell(18).value = r.payment_method;                       // R
        row.getCell(19).value = r.collector;                            // S
        row.getCell(20).value = r.collected;                            // T
        row.getCell(21).value = r.collection_fee;                       // U

        row.eachCell({ includeEmpty: false }, (c, col) => {
            c.font = { name: FONT };
            if (col === 4 || col === 5) c.numFmt = DATE;
            if ((col >= 7 && col <= 17) || col === 20 || col === 21) c.numFmt = MONEY;
            c.alignment = { vertical: "middle", horizontal: col === 3 || col === 19 ? "right" : "center" };
        });
        if (i % 2 === 1) {
            for (let col = 1; col <= 21; col += 1) {
                row.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F4F5" } };
            }
        }
    });

    // ---- V and W: one figure for the whole period, down the full height of the table ----
    const last = Math.max(first, first + rows.length - 1);
    if (last > first) {
        ws.mergeCells(`V${first}:V${last}`);
        ws.mergeCells(`W${first}:W${last}`);
    }
    const bank = ws.getCell(`V${first}`);
    bank.value = report.transfers?.to_bank?.amount || 0;
    const vend = ws.getCell(`W${first}`);
    vend.value = report.transfers?.to_vendors?.amount || 0;
    for (const c of [bank, vend]) {
        c.numFmt = MONEY;
        c.font = { name: FONT, bold: true, size: 12 };
        c.alignment = { horizontal: "center", vertical: "middle" };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF2F2" } };
    }
    const bankLines = (report.transfers?.to_bank?.breakdown || []).map((b) => `${b.label}: ${b.amount} (${b.count})`);
    bank.note = ["يعرض فقط الاموال المحولة لريدي كار خلال فترة التقرير", ...bankLines].join("\n");
    vend.note = `يعرض فقط الاموال المحولة للتاجر خلال فترة التقرير${report.transfers?.to_vendors?.count ? `\n${report.transfers.to_vendors.count} تحويل` : ""}`;

    // ---- Totals ----
    const totalRowNumber = last + 1;
    const tr = ws.getRow(totalRowNumber);
    tr.getCell(2).value = "الإجمالي";
    const lastData = first + rows.length - 1;
    const t = report.totals || {};
    const sumCols = { 7: "merchandise", 8: "coupon", 9: "loyalty", 10: "net", 11: "shipping", 12: "total", 13: "commission", 14: "vendor_net", 15: "shipping_cost", 16: "shipping_margin", 17: "profit", 20: "collected", 21: "collection_fee" };
    for (const [col, key] of Object.entries(sumCols)) {
        const letter = ws.getColumn(Number(col)).letter;
        tr.getCell(Number(col)).value = rows.length
            ? f(`SUM(${letter}${first}:${letter}${lastData})`, t[key])
            : 0;
        tr.getCell(Number(col)).numFmt = MONEY;
    }
    tr.eachCell({ includeEmpty: false }, (c) => {
        c.font = { name: FONT, bold: true };
        c.border = { top: { style: "medium", color: { argb: RED } } };
        c.alignment = { horizontal: "center" };
    });

    // ---- Definitions, where the reader will see them ----
    const notes = [
        "طريقة الحساب:",
        "• الطلبات المعروضة: الطلبات اللي كل طرودها وصلت لحالة نهائية (مسلم / ملغي / مرتجع) وآخر حدث فيها داخل الفترة.",
        "• المبالغ محسوبة على الطرود المسلّمة فقط. الطلب الملغي يظهر بتكلفته الفعلية فقط (مثل رسوم إلغاء Arrive)، والطرد المرفوض بتكلفة الذهاب والرجوع.",
        "• الخصم = إجمالي خصم الكوبون. نصيب التاجر منه داخل في صافي التاجر، ونصيب ريدي كار داخل في الربح.",
        "• صافي التاجر والعمولة = المسجلين وقت التسليم. المرتجعات بعد التسليم تظهر في شاشة المرتجعات.",
        "• تكلفة الشحن لا تشمل رسوم التحصيل النقدي لبوسطة؛ دي في عمولة التحصيل.",
        "• عمولة التحصيل: الدفع عند الاستلام = رسوم بوسطة على التحصيل، البطاقة = عمولة بوابة الدفع (2% + 2 جنيه + ضريبة لو مش مسجلة)، المحفظة = صفر.",
        "• اجمالي ربح ريدي كار = الاجمالي − صافي التاجر − تكلفة الشحن − عمولة التحصيل.",
        "• مبلغ التحويل للبنك = تحويلات بوابات الدفع وشركات الشحن المسجلة في الخزنة خلال الفترة. مبلغ التحويل للتاجر = مدفوعات التجار المدفوعة خلال الفترة.",
    ];
    if (report.truncated) notes.push("• تنبيه: التقرير اتقصّ عند 5000 طلب — ضيّق الفترة.");
    notes.forEach((text, i) => {
        const c = ws.getCell(`B${totalRowNumber + 2 + i}`);
        c.value = text;
        c.font = { name: FONT, size: 10, bold: i === 0, color: { argb: i === 0 ? "FF111827" : "FF52525B" } };
    });

    // ---- Second sheet: the sales & payments analysis ----
    if (analysis) addSalesPaymentsSheet(wb, analysis);

    return wb;
};

module.exports = { buildTrackingReportWorkbook };
