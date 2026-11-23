'use strict';
/**
 * templateGenerator.js
 * Generates the styled bulk-upload Excel template on the fly,
 * injecting live Categories, Brands and Car Brands from MongoDB.
 */
const ExcelJS = require('exceljs');
const { Category } = require('../../models/categories');
const { Brand }    = require('../../models/product_brands');
const { ShippingClass } = require('../../models/shipping_classes');

// ── Palette ──────────────────────────────────────────────────────────────────
const COLOR = {
    HEADER_DARK:  '1E2A38',   // dark navy  – title bar
    REQUIRED_BG:  'E8F0FE',   // soft blue  – required columns
    OPTIONAL_BG:  'FFF8E1',   // soft amber – optional columns
    REF_BG:       'E8F5E9',   // soft green – reference columns
    HEADER_TEXT:  'FFFFFF',   // white
    SUBHEADER_BG: '2E3F56',   // mid-navy – column group labels
    COL_HEADER_BG:'374F6B',   // blue-grey – column name row
    HINT_BG:      'F1F3F4',   // light grey – hints row
    BORDER:       'CBD5E0',
    REF_HEADER:   '1B5E20',   // dark green for reference sheet headers
    REF_HEADER_BG:'43A047',   // green for reference sheet header bg
};

const FONT_MAIN  = 'Calibri';
const FIRST_DATA_ROW = 6;
const LAST_PREFORMATTED_ROW = 205;
const LAST_EXCEL_ROW = 5000;

// ── i18n helper ─────────────────────────────────────────────────────────────
// Returns the English or Arabic variant based on the requested language.
const L = (lang, en, ar) => (lang === 'ar' ? ar : en);

// ── Helpers ───────────────────────────────────────────────────────────────────
function hdr(text, bgHex, fgHex = COLOR.HEADER_TEXT, size = 11, bold = true) {
    return {
        value: text,
        style: {
            font:      { name: FONT_MAIN, size, bold, color: { argb: 'FF' + fgHex } },
            fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + bgHex } },
            alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
            border: {
                top:    { style: 'thin', color: { argb: 'FF' + COLOR.BORDER } },
                bottom: { style: 'thin', color: { argb: 'FF' + COLOR.BORDER } },
                left:   { style: 'thin', color: { argb: 'FF' + COLOR.BORDER } },
                right:  { style: 'thin', color: { argb: 'FF' + COLOR.BORDER } },
            },
        },
    };
}

function applyStyle(cell, style) {
    if (style.font)      cell.font      = style.font;
    if (style.fill)      cell.fill      = style.fill;
    if (style.alignment) cell.alignment = style.alignment;
    if (style.border)    cell.border    = style.border;
    if (style.numFmt)    cell.numFmt    = style.numFmt;
}

function styleRow(ws, rowNum, cells) {
    const row = ws.getRow(rowNum);
    cells.forEach(({ col, value, style }) => {
        const cell = row.getCell(col);
        if (value !== undefined) cell.value = value;
        applyStyle(cell, style);
    });
    row.commit();
}

function refHeaderStyle(col) {
    return {
        font:      { name: FONT_MAIN, size: 11, bold: true, color: { argb: 'FFFFFFFF' } },
        fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COLOR.REF_HEADER_BG } },
        alignment: { vertical: 'middle', horizontal: 'center' },
        border: {
            bottom: { style: 'medium', color: { argb: 'FF' + COLOR.REF_HEADER } },
        },
    };
}

function refDataStyle(rowNum) {
    const isEven = rowNum % 2 === 0;
    return {
        font:      { name: FONT_MAIN, size: 10 },
        fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'FFF9FBE7' : 'FFFFFFFF' } },
        alignment: { vertical: 'middle' },
        border: {
            bottom: { style: 'hair', color: { argb: 'FFD5E8D4' } },
        },
    };
}

// ── Column definitions ────────────────────────────────────────────────────────
// Each entry: { label, label_ar, hint, hint_ar, group, group_ar, groupBg, width, required }
// IMPORTANT: Only the displayed labels/hints/groups are localised. The parser
// reads cells by column INDEX (not by header text), so the column ORDER must
// never change. Dropdown values (draft/published/TRUE/FALSE/instock…) stay in
// English because the importer matches them literally.
const COLUMNS = [
    // IDENTIFIERS
    { label: 'SKU',              label_ar: 'رمز المنتج (SKU)', hint: 'Unique seller code',     hint_ar: 'رمز فريد للبائع',                     group: 'IDENTIFIERS',    group_ar: 'المعرّفات',     groupBg: 'D32F2F', width: 18, required: true  },
    { label: 'Part Number',      label_ar: 'رقم القطعة',       hint: 'OEM / aftermarket part #', hint_ar: 'رقم القطعة الأصلي / البديل',        group: 'IDENTIFIERS',    group_ar: 'المعرّفات',     groupBg: 'D32F2F', width: 20, required: false },
    { label: 'GTIN',             label_ar: 'الباركود (GTIN)',  hint: 'Barcode / EAN / UPC',    hint_ar: 'باركود / EAN / UPC',                  group: 'IDENTIFIERS',    group_ar: 'المعرّفات',     groupBg: 'D32F2F', width: 20, required: false },
    // CONTENT EN (optional if AR complete)
    { label: 'Title (EN)',       label_ar: 'العنوان (إنجليزي)',      hint: 'English product title',  hint_ar: 'عنوان المنتج بالإنجليزية',      group: 'CONTENT (EN)',   group_ar: 'المحتوى (إنجليزي)', groupBg: '1565C0', width: 28, required: false },
    { label: 'Subtitle (EN)',    label_ar: 'العنوان الفرعي (إنجليزي)', hint: 'Short English subtitle', hint_ar: 'عنوان فرعي قصير بالإنجليزية', group: 'CONTENT (EN)',   group_ar: 'المحتوى (إنجليزي)', groupBg: '1565C0', width: 24, required: false },
    { label: 'Description (EN)', label_ar: 'الوصف (إنجليزي)',        hint: 'Full English description', hint_ar: 'وصف كامل بالإنجليزية',        group: 'CONTENT (EN)',   group_ar: 'المحتوى (إنجليزي)', groupBg: '1565C0', width: 40, required: false },
    // CONTENT AR (optional if EN complete)
    { label: 'Title (AR)',       label_ar: 'العنوان (عربي)',        hint: 'Arabic product title',   hint_ar: 'عنوان المنتج بالعربية',          group: 'CONTENT (AR)',   group_ar: 'المحتوى (عربي)',  groupBg: '6A1B9A', width: 28, required: false },
    { label: 'Subtitle (AR)',    label_ar: 'العنوان الفرعي (عربي)', hint: 'Short Arabic subtitle',  hint_ar: 'عنوان فرعي قصير بالعربية',      group: 'CONTENT (AR)',   group_ar: 'المحتوى (عربي)',  groupBg: '6A1B9A', width: 24, required: false },
    { label: 'Description (AR)', label_ar: 'الوصف (عربي)',          hint: 'Full Arabic description', hint_ar: 'وصف كامل بالعربية',            group: 'CONTENT (AR)',   group_ar: 'المحتوى (عربي)',  groupBg: '6A1B9A', width: 40, required: false },
    // PRICING
    { label: 'Price',            label_ar: 'السعر',            hint: 'Regular price (numeric)', hint_ar: 'السعر الأساسي (رقم)',               group: 'PRICING',        group_ar: 'التسعير',       groupBg: '00695C', width: 14, required: true  },
    { label: 'Discount Type',    label_ar: 'نوع الخصم',        hint: 'fixed / percentage – blank if none', hint_ar: 'fixed / percentage – اتركه فارغاً إن لم يوجد', group: 'PRICING', group_ar: 'التسعير', groupBg: '00695C', width: 16, required: false },
    { label: 'Discount Value',   label_ar: 'قيمة الخصم',       hint: 'Amount off, or % off (0–100)', hint_ar: 'قيمة الخصم بالمبلغ أو بالنسبة (0–100)', group: 'PRICING', group_ar: 'التسعير',   groupBg: '00695C', width: 16, required: false },
    // PUBLISHING
    { label: 'Status',           label_ar: 'الحالة',           hint: 'draft / published',      hint_ar: 'draft / published (مسودة / منشور)',   group: 'PUBLISHING',     group_ar: 'النشر',         groupBg: '37474F', width: 14, required: false },
    // CLASSIFICATION
    { label: 'Category Path',    label_ar: 'الفئة',            hint: 'Select from dropdown ▼', hint_ar: 'اختر من القائمة المنسدلة ▼',        group: 'CLASSIFICATION', group_ar: 'التصنيف',       groupBg: '558B2F', width: 32, required: true  },
    { label: 'Product Brand',    label_ar: 'الماركة المصنعة',   hint: 'Select from dropdown ▼ or enter new brand', hint_ar: 'اختر من القائمة المنسدلة ▼ أو اكتب ماركة جديدة (إجباري)', group: 'CLASSIFICATION', group_ar: 'التصنيف',       groupBg: '558B2F', width: 28, required: true },
    { label: 'Part Type',        label_ar: 'نوع القطعة',       hint: 'Original / OEM / Aftermarket (Required)', hint_ar: 'Original (أصلي) / OEM / Aftermarket (تجاري) (إجباري)', group: 'CLASSIFICATION', group_ar: 'التصنيف', groupBg: '558B2F', width: 22, required: true },
    { label: 'Target Audiences', label_ar: 'المجموعات المخصصة', hint: 'Select from dropdown or type comma-separated (Optional)', hint_ar: 'اختر من القائمة أو اكتب المجموعات مفصولة بفواصل (اختياري)', group: 'CLASSIFICATION', group_ar: 'التصنيف', groupBg: '558B2F', width: 34, required: false },
    // INVENTORY
    { label: 'Stock Mgmt',       label_ar: 'إدارة المخزون',    hint: 'TRUE to track stock quantity', hint_ar: 'TRUE لتتبّع كمية المخزون',       group: 'INVENTORY',      group_ar: 'المخزون',       groupBg: '4527A0', width: 14, required: false },
    { label: 'Quantity',         label_ar: 'الكمية',           hint: 'Initial stock qty (if managed)', hint_ar: 'كمية المخزون الأولية (عند التتبّع)', group: 'INVENTORY', group_ar: 'المخزون',     groupBg: '4527A0', width: 12, required: false },
    { label: 'Stock Status',     label_ar: 'حالة المخزون',     hint: 'instock / outofstock / onbackorder', hint_ar: 'instock / outofstock / onbackorder', group: 'INVENTORY', group_ar: 'المخزون', groupBg: '4527A0', width: 16, required: false },
    // MEDIA
    { label: 'Image URLs',       label_ar: 'روابط الصور',      hint: 'Comma-separated URLs; * = primary', hint_ar: 'روابط مفصولة بفواصل؛ * = الصورة الرئيسية', group: 'MEDIA', group_ar: 'الوسائط', groupBg: '00838F', width: 40, required: false },
    // VARIATIONS
    { label: 'Options',          label_ar: 'الخيارات', hint: 'Option:Val1,Val2 ; Option2:ValA,ValB', hint_ar: 'الخيار:قيمة1,قيمة2 ; خيار2:قيمةأ,قيمةب', group: 'OPTIONS', group_ar: 'الخيارات', groupBg: 'AD1457', width: 36, required: false },
    { label: 'Variants',         label_ar: 'التنويعات',       hint: 'Color=Red::price=49.99::discount_type=percentage::discount_value=20::stock=10 || …', hint_ar: 'Color=Red::price=49.99::discount_type=percentage::discount_value=20::stock=10 || …', group: 'OPTIONS', group_ar: 'الخيارات', groupBg: 'AD1457', width: 50, required: false },
    // SHIPPING (optional — strongly recommended for weight-based rates)
    { label: 'Weight (kg)',      label_ar: 'الوزن (كجم)',      hint: 'Per-unit weight in kg, e.g. 1.5', hint_ar: 'وزن الوحدة بالكيلوجرام، مثال 1.5', group: 'SHIPPING',     group_ar: 'الشحن',         groupBg: '00695C', width: 14, required: false },
    { label: 'Dimensions (cm)',  label_ar: 'الأبعاد (سم)',     hint: 'LxWxH in cm, e.g. 30x20x10', hint_ar: 'الطول×العرض×الارتفاع بالسم، مثال 30x20x10', group: 'SHIPPING', group_ar: 'الشحن',     groupBg: '00695C', width: 18, required: false },
    { label: 'Shipping Class',   label_ar: 'فئة الشحن',        hint: 'Select from dropdown ▼ (optional)', hint_ar: 'اختر من القائمة المنسدلة ▼ (اختياري)', group: 'SHIPPING', group_ar: 'الشحن', groupBg: '00695C', width: 28, required: false },
];

/**
 * Excel column letter for a column, looked up by its English label.
 * Derived rather than hardcoded: adding or removing a column shifts every
 * letter after it, and a stale literal silently attaches a dropdown to the
 * wrong column instead of failing.
 */
function colLetter(label) {
    const idx = COLUMNS.findIndex(c => c.label === label);
    if (idx === -1) throw new Error(`templateGenerator: unknown column "${label}"`);
    let n = idx + 1;
    let letters = '';
    while (n > 0) {
        const rem = (n - 1) % 26;
        letters = String.fromCharCode(65 + rem) + letters;
        n = Math.floor((n - 1) / 26);
    }
    return letters;
}

// ── Build Products sheet ──────────────────────────────────────────────────────
function buildProductsSheet(wb, lang = 'en', refMeta = {}) {
    const isAr = lang === 'ar';
    // NOTE: sheet name stays "Products" in all languages — the importer locates
    // the sheet by this exact name.
    const ws = wb.addWorksheet('Products', {
        views: [{ state: 'frozen', ySplit: 5, xSplit: 0, rightToLeft: isAr }],
        properties: { tabColor: { argb: 'FF1E2A38' } },
        pageSetup: { fitToPage: true, fitToWidth: 1 },
    });

    // Set column widths
    ws.columns = COLUMNS.map((c, i) => ({ key: String(i), width: c.width }));

    const totalCols = COLUMNS.length;

    // ROW 1 – Title bar
    ws.mergeCells(1, 1, 1, totalCols);
    const titleCell = ws.getCell('A1');
    titleCell.value = L(lang, '  PRODUCT BULK UPLOAD TEMPLATE', '  قالب رفع المنتجات الجماعي');
    titleCell.font      = { name: FONT_MAIN, size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COLOR.HEADER_DARK } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(1).height = 36;

    // ROW 2 – Legend
    ws.getRow(2).height = 22;
    const legendItems = [
        { col: 1, text: L(lang, '■  REQUIRED', '■  مطلوب'),        bg: 'D32F2F' },
        { col: 4, text: L(lang, '■  OPTIONAL', '■  اختياري'),       bg: '1565C0' },
        { col: 7, text: L(lang, '■  PICK FROM DROPDOWN ▼', '■  اختر من القائمة المنسدلة ▼'), bg: '558B2F' },
        { col: 10, text: L(lang, '⚠  Read Instructions sheet first', '⚠  اقرأ ورقة التعليمات أولاً'), bg: '37474F' },
    ];
    legendItems.forEach(item => {
        const cell = ws.getRow(2).getCell(item.col);
        cell.value = item.text;
        cell.font  = { name: FONT_MAIN, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + item.bg } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    // ROW 3 – Group headers (merge consecutive same groups)
    ws.getRow(3).height = 24;
    let gi = 0;
    while (gi < COLUMNS.length) {
        const grp = COLUMNS[gi].group;
        let end = gi;
        while (end + 1 < COLUMNS.length && COLUMNS[end + 1].group === grp) end++;
        if (end > gi) ws.mergeCells(3, gi + 1, 3, end + 1);
        const cell = ws.getRow(3).getCell(gi + 1);
        cell.value = isAr ? COLUMNS[gi].group_ar : grp;
        cell.font  = { name: FONT_MAIN, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COLUMNS[gi].groupBg } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        gi = end + 1;
    }

    // ROW 4 – Column names
    ws.getRow(4).height = 28;
    COLUMNS.forEach((col, i) => {
        const cell = ws.getRow(4).getCell(i + 1);
        cell.value = isAr ? col.label_ar : col.label;
        cell.font  = { name: FONT_MAIN, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + COLOR.COL_HEADER_BG } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
            top:    { style: 'thin', color: { argb: 'FF' + COLOR.BORDER } },
            bottom: { style: 'medium', color: { argb: 'FFFFFFFF' } },
            left:   { style: 'thin', color: { argb: 'FF4A6080' } },
            right:  { style: 'thin', color: { argb: 'FF4A6080' } },
        };
    });

    // ROW 5 – Hints
    ws.getRow(5).height = 40;
    COLUMNS.forEach((col, i) => {
        const cell = ws.getRow(5).getCell(i + 1);
        cell.value = isAr ? col.hint_ar : col.hint;
        cell.font  = { name: FONT_MAIN, size: 9, italic: true, color: { argb: 'FF555555' } };
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECEFF1' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });

    // Keep the downloaded file compact by pre-formatting 200 starter rows.
    // Uploads have no product-count cap, and validations below cover every
    // remaining Excel row so users can paste/add as many rows as they need.
    for (let r = FIRST_DATA_ROW; r <= LAST_PREFORMATTED_ROW; r++) {
        const row = ws.getRow(r);
        row.height = 20;
        COLUMNS.forEach((col, i) => {
            const cell = row.getCell(i + 1);
            const isEven = r % 2 === 0;
            const bgArgb = col.required
                ? (isEven ? 'FFFCE8E8' : 'FFFFFFFF')
                : (isEven ? 'FFF0F4FF' : 'FFFFFFFF');
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
            cell.font = { name: FONT_MAIN, size: 10 };
            cell.alignment = { vertical: 'middle' };
            cell.border = {
                bottom: { style: 'hair', color: { argb: 'FFCFD8DC' } },
                right:  { style: 'hair', color: { argb: 'FFCFD8DC' } },
            };
        });
        row.commit();
    }

    // Data validations — the dropdown VALUES stay English (the importer matches
    // them literally); only the error titles/messages are localised.
    const range = (label) => `${colLetter(label)}${FIRST_DATA_ROW}:${colLetter(label)}${LAST_EXCEL_ROW}`;

    // Discount Type: dropdown (blank = no discount)
    ws.dataValidations.add(range('Discount Type'), {
        type: 'list', allowBlank: true,
        formulae: ['"fixed,percentage"'],
        showErrorMessage: true,
        errorTitle: L(lang, 'Invalid Discount Type', 'نوع خصم غير صحيح'),
        error: L(lang, 'Choose fixed or percentage, or leave blank for no discount.',
                       'اختر fixed (مبلغ ثابت) أو percentage (نسبة مئوية)، أو اتركه فارغاً بدون خصم.'),
    });
    // Status: dropdown
    ws.dataValidations.add(range('Status'), {
        type: 'list', allowBlank: true,
        formulae: ['"draft,published"'],
        showErrorMessage: true,
        errorTitle: L(lang, 'Invalid Status', 'حالة غير صحيحة'),
        error: L(lang, 'Choose draft or published.', 'اختر draft أو published.'),
    });
    // // Is Universal: dropdown
    // ws.dataValidations.add(range('Is Universal?'), {
    //     type: 'list', allowBlank: true,
    //     formulae: ['"TRUE,FALSE"'],
    //     showErrorMessage: true,
    //     errorTitle: L(lang, 'Invalid Value', 'قيمة غير صحيحة'),
    //     error: L(lang, 'Choose TRUE or FALSE, or leave blank for universal marine products.', 'اختر TRUE أو FALSE، أو اتركها فارغة للمنتجات البحرية العامة.'),
    // });
    // Stock Mgmt: dropdown
    ws.dataValidations.add(range('Stock Mgmt'), {
        type: 'list', allowBlank: true,
        formulae: ['"TRUE,FALSE"'],
        showErrorMessage: true,
        errorTitle: L(lang, 'Invalid Value', 'قيمة غير صحيحة'),
        error: L(lang, 'Choose TRUE or FALSE.', 'اختر TRUE أو FALSE.'),
    });
    // Part Type: dropdown (optional for general marine products)
    ws.dataValidations.add(range('Part Type'), {
        type: 'list', allowBlank: true,
        formulae: ['"Original,OEM,Aftermarket"'],
        showErrorMessage: true,
        errorTitle: L(lang, 'Invalid Part Type', 'نوع قطعة غير صحيح'),
        error: L(lang, 'Choose Original, OEM or Aftermarket, or leave blank for general products.', 'اختر Original (أصلي) أو OEM أو Aftermarket (تجاري)، أو اتركه فارغاً للمنتجات العامة.'),
    });
    // Stock Status: dropdown
    ws.dataValidations.add(range('Stock Status'), {
        type: 'list', allowBlank: true,
        formulae: ['"instock,outofstock,onbackorder"'],
        showErrorMessage: true,
        errorTitle: L(lang, 'Invalid Status', 'حالة غير صحيحة'),
        error: L(lang, 'Choose instock, outofstock or onbackorder.', 'اختر instock أو outofstock أو onbackorder.'),
    });

    // ── Reference dropdowns (Category / Brand / Shipping) ──────────────────
    // The dropdown displays the human-readable NAME (in the template language).
    // Lists live on a hidden "Lists" sheet (col A = categories, B = brands,
    // C = shipping) already built in the template language. The importer
    // resolves the picked name back to its ID automatically. allowBlank keeps
    // Brand/Shipping optional; Category is required by row validation.
    const pickMsg = {
        showErrorMessage: true,
        errorStyle: 'warning',
        errorTitle: L(lang, 'Pick from the list', 'اختر من القائمة'),
        error: L(lang, 'Please choose a value from the dropdown so it can be matched automatically.',
                       'الرجاء اختيار قيمة من القائمة المنسدلة ليتم مطابقتها تلقائياً.'),
    };
    // Categories → Lists!A (final/leaf categories only)
    if (refMeta.categories > 0) {
        ws.dataValidations.add(range('Category Path'), {
            type: 'list', allowBlank: true,
            formulae: [`=Lists!$A$1:$A$${refMeta.categories}`],
            ...pickMsg,
        });
    }
    // Brands → Lists!B
    if (refMeta.brands > 0) {
        ws.dataValidations.add(range('Product Brand'), {
            type: 'list', allowBlank: true,
            formulae: [`=Lists!$B$1:$B$${refMeta.brands}`],
            ...pickMsg,
        });
    }
    // Shipping classes → Lists!C
    if (refMeta.shipping > 0) {
        ws.dataValidations.add(range('Shipping Class'), {
            type: 'list', allowBlank: true,
            formulae: [`=Lists!$C$1:$C$${refMeta.shipping}`],
            ...pickMsg,
        });
    }
    // Target Audiences → Lists!D
    if (refMeta.audiences > 0) {
        ws.dataValidations.add(range('Target Audiences'), {
            type: 'list', allowBlank: true,
            formulae: [`=Lists!$D$1:$D$${refMeta.audiences}`],
            ...pickMsg,
        });
    }

    return ws;
}

const AUDIENCES_LIST = [
    { key: 'yacht_luxury', ar: 'مستلزمات اليخوت الفاخرة', en: 'Premium / Yacht Luxury', desc_ar: 'مستلزمات واكسسوارات وقطع غيار اليخوت الفاخرة', desc_en: 'Luxury yacht accessories and equipment' },
    { key: 'pro_angler', ar: 'الصياد المحترف', en: 'Pro-Angler', desc_ar: 'معدات الصيد البحري المتقدمة وأجهزة كشف الأسماك', desc_en: 'Advanced fishing gear, sonars, and rods' },
    { key: 'family_safety', ar: 'أمان العائلة والأطفال', en: 'Family & Kids Safety', desc_ar: 'سترات نجاة، حقائب إسعاف، ومعدات السلامة البحرية', desc_en: 'Life jackets, safety gear, and first aid' },
    { key: 'lifestyle_comfort', ar: 'الرحلات والرفاهية', en: 'Lifestyle & Comfort', desc_ar: 'معدات الشواء، التبريد، والراحة على متن القارب', desc_en: 'Coolers, grills, seating and comfort' },
    { key: 'next_gen', ar: 'المبتدئين والشباب', en: 'Next-Gen Boaters', desc_ar: 'الأنشطة المائية، الألعاب، ومعدات الإبحار الحديثة', desc_en: 'Water sports, towables, and fun boating' },
    { key: 'diy_maintenance', ar: 'صيانتك بنفسك', en: 'DIY Boat Maintenance', desc_ar: 'عدد وأدوات الصيانة، الزيوت، ومواد حماية القوارب', desc_en: 'Maintenance tools, oils, cleaners and DIY care' },
    { key: 'saltwater', ar: 'مستلزمات المياه المالحة', en: 'Saltwater Off-Shore', desc_ar: 'معدات مقاومة للصدأ والتآكل في المياه المالحة', desc_en: 'Corrosion-resistant saltwater marine gear' },
    { key: 'freshwater', ar: 'مستلزمات المياه العذبة', en: 'Freshwater / Lake Fishing', desc_ar: 'معدات الإبحار والصيد في البحيرات والمياه العذبة', desc_en: 'Freshwater and lake fishing equipment' },
    { key: 'smart_gear', ar: 'الصيد الذكي', en: 'Smart Fishing Gear', desc_ar: 'أجهزة الملاحة GPS، البوصلات، والرادارات الذكية', desc_en: 'GPS, marine electronics, VHF, and smart tech' },
    { key: 'eco_friendly', ar: 'القسم الصديق للبيئة', en: 'Eco-Friendly Marine', desc_ar: 'محركات كهربائية وحلول صديقة للبيئة البحرية', desc_en: 'Electric propulsion and eco-marine gear' },
];

// ── Build hidden Lists sheet (data source for the dropdowns) ───────────────────
// Holds only the display names, in the template language. Kept veryHidden so
// users can't accidentally edit or rely on it — they only see the dropdowns.
function buildListsSheet(wb, { categories = [], brands = [], shipping = [], audiences = [] }) {
    const ws = wb.addWorksheet('Lists', { state: 'veryHidden' });
    ws.state = 'veryHidden';
    categories.forEach((v, i) => { ws.getCell(`A${i + 1}`).value = v; });
    brands.forEach((v, i) => { ws.getCell(`B${i + 1}`).value = v; });
    shipping.forEach((v, i) => { ws.getCell(`C${i + 1}`).value = v; });
    audiences.forEach((v, i) => { ws.getCell(`D${i + 1}`).value = v; });
    return ws;
}

// ── Build Instructions sheet — mirrors original product_bulk_upload_template.xlsx ──
function buildInstructionsSheet(wb, lang = 'en') {
    const isAr = lang === 'ar';
    const ws = wb.addWorksheet('Instructions', {
        properties: { tabColor: { argb: 'FF37474F' } },
        views: [{ rightToLeft: isAr }],
    });

    // 3 columns: A = narrow spacer, B = topic/section, C = detail
    ws.getColumn(1).width = 4;
    ws.getColumn(2).width = 28;
    ws.getColumn(3).width = 80;

    // Styles
    const titleFill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E2A38' } };
    const secFill    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E3F56' } };
    const evenFill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F3F4' } };
    const oddFill    = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
    const rowBorder  = { bottom: { style: 'hair', color: { argb: 'FFCBD5E0' } } };

    // ── Row 1: Title bar (merge A1:C1)
    ws.mergeCells('A1:C1');
    const title = ws.getCell('A1');
    title.value     = L(lang, '  BULK UPLOAD — INSTRUCTIONS & FORMAT GUIDE', '  الرفع الجماعي — التعليمات ودليل التنسيق');
    title.font      = { name: FONT_MAIN, size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
    title.fill      = titleFill;
    title.alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(1).height = 38;

    // ── Row 2: empty spacer
    ws.getRow(2).height = 8;
    ws.getRow(3).height = 8;

    // Helper: add a section header row (B+C merged, dark bg)
    function addSection(rowNum, label) {
        ws.getRow(rowNum).height = 24;
        ws.mergeCells(rowNum, 2, rowNum, 3);
        const cell = ws.getRow(rowNum).getCell(2);
        cell.value     = '  ' + label;
        cell.font      = { name: FONT_MAIN, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill      = secFill;
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
        ws.getRow(rowNum).commit();
    }

    // Helper: add a data row
    let _dataIdx = 0;
    function addRow(rowNum, topic, detail) {
        const isEven = _dataIdx % 2 === 0;
        _dataIdx++;
        const fill = isEven ? evenFill : oddFill;
        ws.getRow(rowNum).height = detail.includes('\n') ? 60 : 36;

        const bCell = ws.getRow(rowNum).getCell(2);
        bCell.value     = topic;
        bCell.font      = { name: FONT_MAIN, size: 10, bold: true, color: { argb: 'FF1E2A38' } };
        bCell.fill      = fill;
        bCell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
        bCell.border    = rowBorder;

        const cCell = ws.getRow(rowNum).getCell(3);
        cCell.value     = detail;
        cCell.font      = { name: FONT_MAIN, size: 10, color: { argb: 'FF2D2D2D' } };
        cCell.fill      = fill;
        cCell.alignment = { vertical: 'top', wrapText: true };
        cCell.border    = rowBorder;

        ws.getRow(rowNum).commit();
    }

    // ── RULES & VALIDATION ────────────────────────────────────────
    addSection(4, L(lang, '  FIELD REQUIREMENTS (MANDATORY VS OPTIONAL)', '  متطلبات الحقول (الإلزامية والاختيارية)'));
    ws.getRow(5).height = 6;
    addRow(6, L(lang, 'Mandatory Fields', 'الحقول الإلزامية'),
        L(lang,
          '1. SKU: Unique seller product code.\n2. Price: Base price (positive number).\n3. Part Type: Original / OEM / Aftermarket.\n4. Category Path: Select final leaf category from dropdown ▼.\n5. Product Brand: Select from dropdown ▼ or type a new brand name (auto-created).\n6. Content: Complete language set in English (Title EN + Subtitle EN + Description EN) OR Arabic (Title AR + Subtitle AR + Description AR) — or both.',
          '1. رمز المنتج (SKU): رمز فريد للمنتج.\n2. السعر (Price): السعر الأساسي (رقم موجب).\n3. نوع القطعة (Part Type): أصلي (Original) / OEM / تجاري (Aftermarket).\n4. الفئة (Category Path): اختر الفئة النهائية من القائمة المنسدلة ▼.\n5. الماركة المصنعة (Product Brand): اختر من القائمة ▼ أو اكتب ماركة جديدة (تُضاف تلقائياً للنظام).\n6. المحتوى: مجموعة لغوية كاملة بالعربية (العنوان + العنوان الفرعي + الوصف) أو بالإنجليزية (Title + Subtitle + Description) — أو كلتيهما.'));
    ws.getRow(6).height = 110;
    ws.getRow(7).height = 6;
    addRow(8, L(lang, 'Optional Fields', 'الحقول الاختيارية'),
        L(lang,
          '• Part Number (MPN) & GTIN (Barcode / EAN).\n• Discount Type (fixed / percentage) & Discount Value.\n• Target Audiences (e.g. Pro-Angler, Yacht Luxury).\n• Stock Management (TRUE/FALSE), Quantity & Stock Status.\n• Image URLs (comma-separated; * for primary image).\n• Options & Variants (e.g. Color, Size).\n• Weight (kg), Dimensions (cm: LxWxH), and Shipping Class.',
          '• رقم القطعة (MPN) والباركود الدولي (GTIN).\n• نوع الخصم (fixed / percentage) وقيمة الخصم.\n• المجموعات المخصصة (مثل الصياد المحترف، مستلزمات اليخوت الفاخرة).\n• تتبع المخزون (TRUE/FALSE)، الكمية، وحالة المخزون.\n• روابط الصور (مفصولة بفواصل، * للصورة الرئيسية).\n• الخيارات والتنويعات (مثل اللون والمقاس).\n• الوزن (كجم)، الأبعاد (سم: الطول×العرض×الارتفاع)، وفئة الشحن.'));
    ws.getRow(8).height = 110;
    ws.getRow(9).height = 6;

    // ── DROPDOWNS & ACCEPTED VALUES ──────────────────────────────
    addSection(10, L(lang, '  ACCEPTED DROPDOWN VALUES & FORMATS', '  القيم المقبولة وخيارات القوائم المنسدلة'));
    ws.getRow(11).height = 6;
    addRow(12, L(lang, 'Part Type (Required)', 'نوع القطعة (إجباري)'),
        L(lang,
          '• Original: Genuine OEM boat/engine manufacturer part.\n• OEM: Made by certified OEM supplier to exact specification.\n• Aftermarket: High-quality compatible marine replacement.',
          '• Original (أصلي): القطعة أو المعدة الأصلية للشركة المصنّعة.\n• OEM: مصنّعة من مورّد الشركة المصنّعة المعتمد بنفس المواصفات الدقيقة.\n• Aftermarket (تجاري): بديل تجاري متوافق عالي الجودة.'));
    ws.getRow(12).height = 70;
    ws.getRow(13).height = 6;
    addRow(14, L(lang, 'Product Brand (Required)', 'الماركة المصنعة (إجباري)'),
        L(lang,
          'Pick from the dropdown ▼ (e.g. Garmin, Yamaha, Mercury, Raymarine, Suzuki, Lowrance, Simrad, etc.).\nNEW BRANDS: You can also type any brand name directly! If the brand does not exist in the list, the system will automatically create it and register it into your system.',
          'اختر من القائمة المنسدلة ▼ (مثل Garmin، Yamaha، Mercury، Raymarine، Suzuki، Lowrance، Simrad، إلخ).\nإضافة ماركة جديدة: يمكنك أيضاً كتابة اسم أي ماركة يدوياً! إذا لم تكن موجودة بالقائمة، سيقوم النظام بإنشائها وتسجيلها تلقائياً في قائمة الماركات بالنظام.'));
    ws.getRow(14).height = 80;
    ws.getRow(15).height = 6;
    addRow(16, L(lang, 'Status (Publishing)', 'الحالة (النشر)'),
        L(lang,
          '• published: Ready for store display (or pending admin approval if review required).\n• draft: Saved as draft for later review.',
          '• published: جاهز للنشر في المتجر (أو بانتظار موافقة الإدارة إذا تطلب مراجعة).\n• draft: يُحفظ كمسودة للمراجعة والتعديل لاحقاً.'));
    ws.getRow(16).height = 50;
    ws.getRow(17).height = 6;
    addRow(18, L(lang, 'Discount Type & Value', 'نوع الخصم وقيمته'),
        L(lang,
          '• Discount Type: "percentage" (for % off) or "fixed" (for amount off EGP). Leave blank if none.\n• Discount Value: The discount amount or percent (e.g. 15 for 15% or 100 for 100 EGP).',
          '• نوع الخصم: "percentage" (نسبة مئوية) أو "fixed" (مبلغ ثابت). اتركه فارغاً في حال عدم وجود خصم.\n• قيمة الخصم: رقم النسبة أو المبلغ (مثال: 15 لنسبة 15% أو 100 لخصم 100 جنيه).'));
    ws.getRow(18).height = 60;
    ws.getRow(19).height = 6;
    addRow(20, L(lang, 'Stock & Inventory', 'المخزون وإدارة الكميات'),
        L(lang,
          '• Stock Mgmt: TRUE (to track quantity) or FALSE.\n• Quantity: Non-negative integer (e.g. 10). If left blank when managed, defaults to 1.\n• Stock Status: "instock" (in stock), "outofstock" (out of stock), or "onbackorder".',
          '• إدارة المخزون: TRUE (لتتبع كميات المخزون) أو FALSE.\n• الكمية: عدد صحيح غير سالب (مثال: 10). إن تركت فارغة مع تفعيل التتبع تُعتبر 1.\n• حالة المخزون: "instock" (متوفر بالمخزن)، "outofstock" (نفذ من المخزن)، أو "onbackorder" (طلب مسبق).'));
    ws.getRow(20).height = 70;
    ws.getRow(21).height = 6;

    // ── TARGET AUDIENCES (OPTIONAL) ──────────────────────────────────
    addSection(22, L(lang, '  TARGET AUDIENCES (OPTIONAL)', '  المجموعات المخصصة (اختياري)'));
    ws.getRow(23).height = 6;
    addRow(24, L(lang, 'Concept', 'الفكرة'),
        L(lang,
          'Classify products by boating lifestyle or specialized marine interest (e.g. Pro-Angler, Yacht Luxury, Family Safety).\nSelect from the dropdown ▼ or see the Custom Audiences (Reference) sheet. Leave blank if not applicable.',
          'تصنيف المنتجات حسب أسلوب الإبحار أو الاهتمام البحري (مثل: الصياد المحترف، مستلزمات اليخوت الفاخرة، أمان العائلة والأطفال).\nاختر من القائمة المنسدلة ▼ أو راجع ورقة المجموعات المخصصة (مرجع). اتركها فارغة إذا لم تنطبق.'));
    ws.getRow(24).height = 70;
    ws.getRow(25).height = 6;
    addRow(26, L(lang, 'Values & Codes', 'القيم والأكواد'),
        L(lang,
          'You can pick an audience from the dropdown or write multiple comma-separated names or codes (e.g. yacht_luxury, pro_angler).\nAvailable audiences are detailed in the Custom Audiences (Reference) sheet.',
          'يمكنك اختيار مجموعة من القائمة المنسدلة أو كتابة عدة مجموعات مفصولة بفواصل بالاسم أو الكود (مثل: مستلزمات اليخوت الفاخرة، الصياد المحترف).\nجميع المجموعات موضحة في ورقة المجموعات المخصصة (مرجع).'));
    ws.getRow(26).height = 70;
    ws.getRow(27).height = 6;

    // ── VARIATION TYPES FORMAT ────────────────────────────────────
    addSection(28, L(lang, '  VARIATION TYPES FORMAT', '  تنسيق أنواع المتغيّرات'));
    ws.getRow(29).height = 6;
    addRow(30, L(lang, 'Options column format', 'تنسيق عمود الخيارات'),
        L(lang,
          'Option1:Value1,Value2,Value3 ; Option2:ValueA,ValueB\n\nSeparate options with semicolons  ;\nSeparate values with commas  ,\n\nExample:\n  Color:Red,Blue,Black ; Size:Small,Medium,Large',
          'الخيار1:قيمة1,قيمة2,قيمة3 ; الخيار2:قيمةأ,قيمةب\n\nافصل الخيارات بفاصلة منقوطة  ;\nافصل القيم بفواصل  ,\n\nمثال:\n  Color:Red,Blue,Black ; Size:Small,Medium,Large'));
    ws.getRow(30).height = 90;
    ws.getRow(31).height = 6;
    addRow(32, L(lang, 'Variants column format', 'تنسيق عمود التنويعات'),
        L(lang,
          'Each variant on one \'row\' inside the cell, variants separated by  ||\n\nPer variant:  Option=Value|Option=Value :: price=XX.XX :: discount_type=fixed|percentage :: discount_value=XX.XX :: stock=N\n\nExample:\n  Color=Red|Size=Small::price=49.99::discount_type=percentage::discount_value=20::stock=30 || Color=Blue|Size=Large::price=52.99::discount_type=fixed::discount_value=5::stock=20',
          'كل متغيّر في "سطر" داخل الخلية، تُفصل المتغيّرات بـ  ||\n\nلكل متغيّر:  Option=Value|Option=Value :: price=XX.XX :: discount_type=fixed|percentage :: discount_value=XX.XX :: stock=N\n\nمثال:\n  Color=Red|Size=Small::price=49.99::discount_type=percentage::discount_value=20::stock=30 || Color=Blue|Size=Large::price=52.99::discount_type=fixed::discount_value=5::stock=20'));
    ws.getRow(32).height = 100;
    ws.getRow(33).height = 6;

    // ── IMAGES FORMAT ────────────────────────────────────────────
    addSection(34, L(lang, '  IMAGES FORMAT', '  تنسيق الصور'));
    ws.getRow(35).height = 6;
    addRow(36, L(lang, 'Format', 'التنسيق'),
        L(lang,
          'Comma-separated full URLs.\nAppend  *  (asterisk) immediately after the URL (no space) to mark it as the PRIMARY image.\n\nExample:\n  https://cdn.example.com/main.jpg*,https://cdn.example.com/side.jpg,https://cdn.example.com/detail.jpg',
          'روابط كاملة مفصولة بفواصل.\nأضف  *  (نجمة) مباشرة بعد الرابط (دون مسافة) لتحديده كصورة رئيسية.\n\nمثال:\n  https://cdn.example.com/main.jpg*,https://cdn.example.com/side.jpg,https://cdn.example.com/detail.jpg'));
    ws.getRow(36).height = 80;
    ws.getRow(37).height = 6;

    // ── CATEGORY PATH FORMAT ─────────────────────────────────────
    addSection(38, L(lang, '  CATEGORY (DROPDOWN)', '  الفئة (قائمة منسدلة)'));
    ws.getRow(39).height = 6;
    addRow(40, L(lang, 'How to pick a category', 'كيف تختار الفئة'),
        L(lang,
          'Click the Category cell in the Products sheet and pick a value from the dropdown ▼.\nThe list shows the full category path (e.g. "Marine Electronics > GPS & Navigation").\nOnly FINAL leaf categories are listed.\nWhen you upload, the system matches your choice to its ID automatically.',
          'انقر خلية الفئة في ورقة المنتجات واختر قيمة من القائمة المنسدلة ▼.\nتعرض القائمة مسار الفئة الكامل (مثل "الأجهزة البحرية > أجهزة الملاحة GPS").\nتظهر فقط الفئات النهائية (الأكثر تحديداً).\nعند الرفع، يطابق النظام اختيارك مع المعرّف تلقائياً دون الحاجة لكتابة أكواد.'));
    ws.getRow(40).height = 80;
    ws.getRow(41).height = 6;

    // ── HOW TO SUBMIT ────────────────────────────────────────────
    addSection(42, L(lang, '  HOW TO SUBMIT', '  كيفية الإرسال'));
    ws.getRow(43).height = 6;
    addRow(44, L(lang, 'Steps', 'الخطوات'),
        L(lang,
          '1. Fill in the Products sheet starting from row 6.\n2. Save as .xlsx (do not rename sheets).\n3. Go to Dashboard → Products → Bulk Upload → drag & drop the file.\n4. Review any errors: successful products are imported; errors can be edited online directly or completed as drafts.',
          '1. املأ ورقة المنتجات بدءاً من الصف 6.\n2. احفظ الملف بصيغة .xlsx (دون تغيير أسماء الأوراق).\n3. ادخل إلى لوحة التحكم ← المنتجات ← الرفع الجماعي بالأكسيل ← ارفع الملف.\n4. راجع تقرير المعالجة: المنتجات السليمة تُستورد فوراً، وأي صف به أخطاء يُحفظ كمسودة يمكنك تعديلها يدوياً وحفظها فوراً.'));
    ws.getRow(44).height = 90;
    ws.getRow(45).height = 6;

    // ── SHIPPING (OPTIONAL) ──────────────────────────────────────
    addSection(46, L(lang, '  SHIPPING ATTRIBUTES (OPTIONAL — RECOMMENDED)', '  خصائص الشحن (اختيارية — مُوصى بها)'));
    ws.getRow(47).height = 6;
    addRow(48, L(lang, 'Attributes', 'المحددات'),
        L(lang,
          '• Weight (kg): Per-unit weight in kilograms (e.g. 1.5). Recommended for weight-based shipping rates.\n• Dimensions (cm): LxWxH in centimeters, e.g. 30x20x10.\n• Shipping Class: Optional dropdown (e.g. Light, Heavy, Fragile).',
          '• الوزن (كجم): وزن الوحدة بالكيلوجرام (مثال: 1.5). مُوصى به لحساب أسعار الشحن بدقة.\n• الأبعاد (سم): الطول × العرض × الارتفاع بالسم، مثال: 30x20x10.\n• فئة الشحن: قائمة منسدلة اختيارية (مثل: شحن عادي، شحن ثقيل، قابل للكسر).'));
    ws.getRow(48).height = 80;
    ws.getRow(49).height = 6;

    return ws;
}

// ── Build Reference sheet (generic) ──────────────────────────────────────────
function buildRefSheet(wb, name, headers, rows, widths, tabArgb, lang = 'en') {
    const ws = wb.addWorksheet(name, {
        views: [{ state: 'frozen', ySplit: 1, rightToLeft: lang === 'ar' }],
        properties: { tabColor: { argb: tabArgb } },
    });

    ws.columns = widths.map((w, i) => ({ key: String(i), width: w }));

    // Header row
    ws.getRow(1).height = 26;
    headers.forEach((h, i) => {
        const cell = ws.getRow(1).getCell(i + 1);
        cell.value = h;
        cell.font  = { name: FONT_MAIN, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = { bottom: { style: 'medium', color: { argb: 'FF1B5E20' } } };
    });
    ws.getRow(1).commit();

    // Data rows
    rows.forEach((row, ri) => {
        const excelRow = ws.getRow(ri + 2);
        const isEven = (ri + 2) % 2 === 0;
        excelRow.height = 18;
        row.forEach((val, ci) => {
            const cell = excelRow.getCell(ci + 1);
            cell.value = val;
            cell.font  = { name: FONT_MAIN, size: 10 };
            cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'FFF1F8E9' : 'FFFFFFFF' } };
            cell.alignment = { vertical: 'middle' };
            cell.border = { bottom: { style: 'hair', color: { argb: 'FFD5E8D4' } } };
        });
        excelRow.commit();
    });

    return ws;
}

// ── Main export ───────────────────────────────────────────────────────────────
async function generateBulkUploadTemplate(lang = 'en') {
    const isAr = lang === 'ar';
    const wb = new ExcelJS.Workbook();
    wb.creator  = 'Ready Marine Platform';
    wb.created  = new Date();
    wb.modified = new Date();

    // ── Fetch reference data FIRST (fresh from DB) so the Products sheet can
    //    build its Category/Brand/Shipping dropdowns against these exact rows. ──

    // Categories
    const categories = await Category.find({ is_active: true }).lean();
    const catMap = new Map();
    categories.forEach(c => catMap.set(c._id.toString(), c));

    const resolvePath = (catId, pathLang) => {
        const parts = [];
        let curr = catMap.get(catId.toString());
        while (curr) {
            parts.unshift(pathLang === 'en' ? (curr.name || curr.name_ar) : (curr.name_ar || curr.name));
            curr = curr.parent_id ? catMap.get(curr.parent_id.toString()) : null;
        }
        return parts.join(' > ');
    };

    // Only LEAF categories are selectable — a product must be filed under a
    // final (most specific) category, never an intermediate parent. A leaf is a
    // category that is not the parent of any other category.
    const parentIds = new Set();
    categories.forEach(c => { if (c.parent_id) parentIds.add(c.parent_id.toString()); });
    const isLeaf = (c) => !parentIds.has(c._id.toString());

    // Sort by the column the dropdown will display (AR path for ar, EN for en)
    const catRows = categories
        .filter(isLeaf)
        .map(c => [c._id.toString(), resolvePath(c._id, 'en'), resolvePath(c._id, 'ar')])
        .sort((a, b) => String(a[isAr ? 2 : 1]).localeCompare(String(b[isAr ? 2 : 1]), isAr ? 'ar' : 'en'));

    // Brands (marine equipment, engines, apparel, electronics)
    const brands = await Brand.find().lean().then((rows) => require('../../common/shared/brandRef').mergedProductBrands(rows));
    const brandRows = brands.map(b => [b._id.toString(), b.name]);

    // Marine reference rows
    const marineRefRows = brandRows.map(b => [
        b[0],
        b[1],
        L(lang, 'Marine Brands & Equipment', 'معدات ومحركات بحرية')
    ]);

    // Shipping classes — AR column falls back to the EN name so the dropdown
    // never shows a blank entry for classes without an Arabic name.
    const shippingClasses = await ShippingClass.find().sort({ name: 1 }).lean();
    const scRows = shippingClasses
        .map(sc => [sc._id.toString(), sc.name, sc.name_ar || sc.name, sc.is_active ? L(lang, 'Active', 'مفعّلة') : L(lang, 'Inactive', 'غير مفعّلة')])
        .sort((a, b) => String(a[isAr ? 2 : 1]).localeCompare(String(b[isAr ? 2 : 1]), isAr ? 'ar' : 'en'));

    // Dynamic Target Audiences from database
    let dynamicAudiences = [];
    try {
        const { TargetAudience } = require('../../models/target_audiences');
        const dbAudiences = await TargetAudience.find({ is_active: true }).sort({ sort_order: 1, createdAt: 1 }).lean();
        if (dbAudiences && dbAudiences.length > 0) {
            dynamicAudiences = dbAudiences.map(a => ({
                key: a.key,
                ar: a.name_ar,
                en: a.name_en,
                desc_ar: a.description_ar,
                desc_en: a.description_en,
            }));
        }
    } catch {
        // Fallback to static list if db unreached
    }
    const audienceList = dynamicAudiences.length > 0 ? dynamicAudiences : AUDIENCES_LIST;

    const refMeta = {
        categories: catRows.length,
        brands: brandRows.length,
        shipping: scRows.length,
        audiences: audienceList.length,
    };

    // Hidden source lists for the dropdowns — display names in the template language.
    buildListsSheet(wb, {
        categories: catRows.map(r => isAr ? r[2] : r[1]),
        brands: brandRows.map(r => r[1]),
        shipping: scRows.map(r => isAr ? r[2] : r[1]),
        audiences: audienceList.map(a => isAr ? a.ar : a.en),
    });

    // 1. Products sheet (with reference dropdowns)
    buildProductsSheet(wb, lang, refMeta);

    // 2. Instructions sheet
    buildInstructionsSheet(wb, lang);

    // 3. Marine Brands Reference
    buildRefSheet(wb, 'Marine Brands (Reference)',
        [L(lang, 'Brand ID', 'معرّف الماركة'), L(lang, 'Marine Brand Name', 'اسم الماركة البحرية'), L(lang, 'Category / Scope', 'تصنيف الماركة / المجال')],
        marineRefRows, [28, 30, 40], 'FF00838F', lang);

    // 4. Custom Audiences Reference
    const audienceRefRows = audienceList.map(a => [
        a.key,
        isAr ? a.ar : a.en,
        isAr ? a.desc_ar : a.desc_en,
    ]);
    buildRefSheet(wb, L(lang, 'Custom Audiences (Reference)', 'المجموعات المخصصة (مرجع)'),
        [L(lang, 'Audience Code', 'كود المجموعة'), L(lang, 'Audience Name', 'اسم المجموعة'), L(lang, 'Description', 'الوصف')],
        audienceRefRows, [24, 32, 55], 'FF558B2F', lang);

    return await wb.xlsx.writeBuffer();
}

module.exports = { generateBulkUploadTemplate };
