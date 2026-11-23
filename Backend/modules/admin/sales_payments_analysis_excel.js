/**
 * The "تحليل المبيعات والمدفوعات" sheet, laid out the way the finance team drew it beside
 * the tracking report: the headline on the left (everything paid, how much of it reached
 * the bank, how much is still outside it), and on the right one row per party that holds
 * money for us, the customer wallets, the sales by collector, and how the sales split.
 *
 * Sums and differences are live formulas, each carrying its computed result, so the sheet
 * still adds up if someone corrects a figure in it. The table grows with the number of
 * gateways and couriers, so every address below is worked out from where the rows landed
 * rather than written down.
 */
const FONT = "Arial";
const RED = "FFDC2626";
const BLACK = "FF18181B";
const WHITE = "FFFFFFFF";
const GREY = "FF71717A";
const HIGHLIGHT = "FFFFC000";
// A zero reads as a dash, the way the team's own sheet shows it.
const MONEY = '#,##0.00;-#,##0.00;"-"';
const DATE = "yyyy-mm-dd";

/** The table's columns, D being the row's label. `gatewayOnly` ones stay blank for the rest. */
const TABLE = [
    { col: "E", key: "topups", head: "شحن محافظ", gatewayOnly: true },
    { col: "F", key: "supplies", head: "مستلزمات تغليف", gatewayOnly: true, other: true },
    { col: "G", key: "subscriptions", head: "اشتراكات تجار", gatewayOnly: true, other: true },
    { col: "H", key: "not_sales", head: "مدفوعات خارج المبيعات", other: true },
    { col: "I", key: "sales", head: "اوردرات (مبيعات)" },
    { col: "J", key: "collected", head: "محصل" },
    { col: "K", key: "fees", head: "عمولتهم" },
    { col: "L", key: "to_bank", head: "محول للبنك" },
    { col: "M", key: "balance", head: "رصيد" },
    { col: "N", key: "sales_fee", head: "عمولة التحصيل على المبيعات" },
];

const WIDTHS = { A: 36, B: 15, C: 5, D: 30, E: 14, F: 15, G: 14, H: 20, I: 16, J: 14, K: 14, L: 20, M: 14, N: 24 };

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** A formula cell that also carries its value, for viewers that do not recalculate. */
const f = (formula, result) => ({ formula, result: round2(result) });

const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

const addSalesPaymentsSheet = (wb, analysis) => {
    const ws = wb.addWorksheet("تحليل المبيعات والمدفوعات", { views: [{ rightToLeft: true }] });
    for (const [letter, width] of Object.entries(WIDTHS)) ws.getColumn(letter).width = width;

    const put = (addr, value, { bold = true, size = 11, color = BLACK, bg = null, money = false, align = null } = {}) => {
        const c = ws.getCell(addr);
        c.value = value;
        c.font = { name: FONT, bold, size, color: { argb: color } };
        if (bg) c.fill = fill(bg);
        if (money) c.numFmt = MONEY;
        if (align) c.alignment = { horizontal: align, vertical: "middle", wrapText: align === "center" };
        return c;
    };
    const head = (addr, text, bg = RED) => put(addr, text, { color: WHITE, bg, align: "center" });
    const amount = (addr, value, opts = {}) => put(addr, value, { money: true, ...opts });

    const channels = analysis.channels;
    const total = (key) => round2(channels.reduce((a, c) => a + Number(c[key] || 0), 0));

    // ---- Right: one row per party holding money for us ----
    put("D1", "تفاصيل المبالغ عند بوابات الدفع وشركات الشحن", { size: 12 });
    for (const t of TABLE) head(`${t.col}2`, t.head);
    ws.getRow(2).height = 32;

    const first = 3;
    channels.forEach((ch, i) => {
        const n = first + i;
        put(`D${n}`, ch.label, { size: 12, align: "center" });
        for (const t of TABLE) {
            if (t.gatewayOnly && ch.kind !== "gateway") continue;
            const value = t.key === "collected" ? f(`SUM(E${n}:I${n})`, ch.collected)
                : t.key === "balance" ? f(`J${n}-K${n}-L${n}`, ch.balance)
                : ch[t.key];
            // What was paid and is not a sale stands out, the way the team marked it.
            amount(`${t.col}${n}`, value, { bg: t.other && Number(ch[t.key]) !== 0 ? HIGHLIGHT : null });
        }
    });
    const last = first + channels.length - 1;
    const tot = last + 1;
    for (const t of TABLE) {
        amount(`${t.col}${tot}`, f(`SUM(${t.col}${first}:${t.col}${last})`, total(t.key)), { color: WHITE, bg: t.key === "sales" ? BLACK : RED });
    }

    // ---- Right: customer wallets — money we hold and still owe in goods ----
    const w = analysis.wallet;
    const wh = tot + 2;
    const wr = wh + 1;
    head(`E${wh}`, "شحن محافظ");
    head(`I${wh}`, "سحب اوردرات");
    head(`J${wh}`, "صافي");
    head(`K${wh}`, "مرتجع (اترد بالمحفظة)");
    head(`L${wh}`, "تسويات إدارية");
    head(`M${wh}`, "رصيد");
    ws.getRow(wh).height = 32;
    put(`D${wr}`, "رصيد محافظ العملاء", { size: 12, align: "center" });
    amount(`E${wr}`, w.topups);
    amount(`I${wr}`, w.purchases);
    amount(`J${wr}`, f(`E${wr}-I${wr}`, w.topups - w.purchases));
    amount(`K${wr}`, w.refunds);
    amount(`L${wr}`, w.adjustments);
    amount(`M${wr}`, f(`J${wr}+K${wr}+L${wr}`, w.balance), { color: "FFD97706" });

    // ---- Right: sales, by who collected them ----
    const sh = wr + 2;
    ws.mergeCells(`D${sh}:H${sh}`);
    head(`D${sh}`, "المبيعات حسب جهة التحصيل", BLACK);
    channels.forEach((ch, i) => {
        put(`D${sh + 1 + i}`, ch.label, { size: 12, align: "center" });
        amount(`I${sh + 1 + i}`, f(`I${first + i}`, ch.sales));
    });
    const walletSales = sh + 1 + channels.length;
    put(`D${walletSales}`, "محافظ العملاء", { size: 12, align: "center" });
    amount(`I${walletSales}`, w.sales);
    const salesTotal = walletSales + 1;
    const sales = round2(total("sales") + w.sales);
    ws.mergeCells(`D${salesTotal}:H${salesTotal}`);
    head(`D${salesTotal}`, "اجمالي المبيعات", BLACK);
    amount(`I${salesTotal}`, f(`SUM(I${sh + 1}:I${walletSales})`, sales), { color: WHITE, bg: BLACK });

    // ---- Right: how the sales split, and what is still owed out of them ----
    const s = analysis.sales;
    const b = salesTotal + 2;
    put(`D${b}`, "اجمالي المبيعات", { size: 12, align: "center" });
    amount(`E${b}`, f(`I${salesTotal}`, sales));
    const line = (offset, label, value, beside = null) => {
        const n = b + offset;
        put(`C${n}`, offset, { bold: false });
        put(`D${n}`, label);
        amount(`E${n}`, value);
        if (!beside) return;
        ws.mergeCells(`F${n}:G${n}`);
        put(`F${n}`, beside.label, { bold: false, align: "center" });
        amount(`H${n}`, beside.value);
        put(`J${n}`, beside.result, { bold: false });
        const result = round2(Number(value) - beside.value);
        amount(`K${n}`, f(`E${n}-H${n}`, result), { color: result < 0 ? RED : BLACK });
    };
    line(1, "صافي التجار", s.vendor_net, { label: "محول للتجار", value: s.to_vendors, result: "مستحق نهائي" });
    line(2, "عمولة ريدي مارين", s.commission);
    line(3, "قيمة الشحن المدفوع من العملاء", s.shipping, { label: "قيمة الشحن الفعلي", value: s.shipping_cost, result: "هامش الشحن" });
    // What is left of the sales once the three above are taken out: the discounts we bore.
    line(4, "ولاء العملاء والخصومات", f(`E${b}-E${b + 1}-E${b + 2}-E${b + 3}`, sales - s.vendor_net - s.commission - s.shipping));

    // ---- Left: the headline ----
    const label = (addr, text) => put(addr, text, { size: 12, color: GREY, align: "center" });
    label("A1", "إجمالي اللي اتدفع");
    amount("B1", f(`J${tot}`, total("collected")), { size: 12, color: RED });
    put("A2", "تراكمي من بداية التشغيل حتى", { bold: false, size: 10, color: GREY, align: "center" });
    put("B2", analysis.as_of, { bold: false, size: 10, color: GREY }).numFmt = DATE;
    label("A3", "منها نزل البنك");
    amount("B3", f(`L${tot}`, total("to_bank")), { size: 12, color: "FF059669" });
    label("A4", "منها لسه برّه البنك");
    amount("B4", f(`M${tot}`, total("balance")), { size: 12, color: "FFD97706" });
    label("A5", "عمولة البوابات + مصاريف شركات الشحن");
    amount("B5", f(`K${tot}`, total("fees")), { size: 12 });

    const held = (kind) => {
        const cells = channels.map((c, i) => (c.kind === kind ? `M${first + i}` : null)).filter(Boolean);
        const sum = channels.filter((c) => c.kind === kind).reduce((a, c) => a + c.balance, 0);
        return cells.length ? f(cells.join("+"), sum) : 0;
    };
    ws.mergeCells("A6:B6");
    head("A6", "تفاصيل اللي لسه برّه البنك");
    put("A7", "عند بوابات الدفع", { bold: false, align: "center" });
    amount("B7", held("gateway"), { size: 12 });
    put("A8", "عند شركات الشحن", { bold: false, align: "center" });
    amount("B8", held("courier"), { size: 12 });
    head("A9", "اجمالي ");
    amount("B9", f("SUM(B7:B8)", total("balance")), { size: 12, color: WHITE, bg: RED });

    // ---- Left: paid = sales + what was paid and is not a sale ----
    const paid = total("collected");
    head("A12", "اجمالي اللي اتدفع", BLACK);
    amount("B12", f("B1", paid), { size: 12, color: RED });
    head("A13", "من المبيعات", BLACK);
    amount("B13", f(`I${salesTotal}`, sales), { size: 12, color: WHITE, bg: BLACK });
    head("A14", "اخري", BLACK);
    amount("B14", f("B12-B13", paid - sales), { size: 12, bg: HIGHLIGHT });
    put("A15", "تفاصيل «اخري»:", { size: 10, color: GREY, align: "center" });
    const other = [
        ["شحن محافظ لسه ما اتصرفش في مبيعات", f(`E${tot}-I${walletSales}`, total("topups") - w.sales)],
        ["مستلزمات تغليف", f(`F${tot}`, total("supplies"))],
        ["اشتراكات تجار", f(`G${tot}`, total("subscriptions"))],
        ["مدفوعات خارج المبيعات", f(`H${tot}`, total("not_sales"))],
    ];
    other.forEach(([text, value], i) => {
        put(`A${16 + i}`, text, { bold: false, align: "center" });
        amount(`B${16 + i}`, value, { bold: false });
    });

    // ---- Definitions, where the reader will see them ----
    const notes = [
        "طريقة القراءة:",
        "• كل الأرقام هنا تراكمية — من بداية التشغيل لحد آخر يوم في الفترة — لأنها أرصدة (عند البوابات، عند شركات الشحن، في المحافظ، مستحق التجار). الطلبات المنفذة خلال الفترة نفسها في شيت تقرير التتبع.",
        "• لكل جهة: محصل − عمولتهم − محول للبنك = رصيد لسه عندها. وإجمالي اللي اتدفع = نزل البنك + برّه البنك + العمولات.",
        "• اوردرات (مبيعات) = الطلبات المنفذة بنفس قواعد تقرير التتبع، موزعة على الجهة اللي حصّلت فلوسها.",
        "• مدفوعات خارج المبيعات = فلوس أوردرات اتحصّلت ومش محسوبة مبيعات: أوردر اتلغى أو رجع (واترد للمحفظة أو للكارت) أو لسه ما خلصش. بالسالب = مبيعات لسه ما اتحصّلتش (حسابات الشركات).",
        "• عمولتهم: للبوابات = عمولة كل عملية دفع؛ لشركات الشحن = اللي خصموه من الكاش قبل التحويل. عمولة التحصيل على المبيعات = نفس عمود عمولة التحصيل في تقرير التتبع.",
        "• اخري = اللي اتدفع ومش مبيعات: شحن محافظ لسه ما اتصرفش + مستلزمات تغليف + اشتراكات تجار + مدفوعات خارج المبيعات.",
        "• ولاء العملاء والخصومات = اللي ريدي مارين اتحملته من الخصومات: اجمالي المبيعات − صافي التجار − العمولة − الشحن.",
    ];
    const unpriced = channels.reduce((a, c) => a + (c.unpriced_fees || 0), 0);
    if (unpriced > 0) notes.push(`• تنبيه: ${unpriced} عملية دفع من غير عمولة مسجلة ولا تعريفة معروفة — العمولات والأرصدة عند البوابة دي حد أدنى/أقصى مش رقم نهائي.`);
    if (analysis.truncated) notes.push("• تنبيه: المبيعات اتقصّت عند 5000 طلب — الأرقام التراكمية ناقصة.");
    const notesFrom = Math.max(16 + other.length, b + 5) + 1;
    notes.forEach((text, i) => {
        put(`A${notesFrom + i}`, text, { bold: i === 0, size: 10, color: i === 0 ? "FF111827" : "FF52525B" });
    });

    return ws;
};

module.exports = { addSalesPaymentsSheet };
