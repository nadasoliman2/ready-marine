'use strict';
/**
 * templateGenerator.js
 * Generates the styled bulk-upload Excel template on the fly,
 * injecting live Categories, Brands and Car Brands from MongoDB.
 */
const ExcelJS = require('exceljs');
const { Category } = require('../models/categories');
const { Brand }    = require('../models/product_brands');
const { CarBrand } = require('../models/car_brands');
const { ShippingClass } = require('../models/shipping_classes');

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
const LAST_EXCEL_ROW = 1048576;

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
    { label: 'Product Brand',    label_ar: 'الماركة',          hint: 'Select from dropdown ▼', hint_ar: 'اختر من القائمة المنسدلة ▼',        group: 'CLASSIFICATION', group_ar: 'التصنيف',       groupBg: '558B2F', width: 28, required: false },
    // COMPATIBILITY
    { label: 'Is Universal?',    label_ar: 'يناسب كل السيارات؟', hint: 'TRUE = fits all cars', hint_ar: 'TRUE = يناسب كل السيارات',           group: 'COMPATIBILITY',  group_ar: 'التوافق',       groupBg: 'E65100', width: 14, required: true  },
    { label: 'Compatible Cars',  label_ar: 'السيارات المتوافقة', hint: 'BRAND_ID:MODEL_ID:YEAR1,YEAR2 | …', hint_ar: 'معرّف_الماركة:معرّف_الموديل:سنة1,سنة2 | …', group: 'COMPATIBILITY', group_ar: 'التوافق', groupBg: 'E65100', width: 40, required: false },
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
    // PART TYPE — last on purpose: the parser reads by index, so a new column can only be appended.
    { label: 'Part Type',        label_ar: 'نوع القطعة',       hint: 'Original / OEM / Aftermarket ▼', hint_ar: 'Original (أصلي) / OEM / Aftermarket (تجاري) ▼', group: 'PART TYPE', group_ar: 'نوع القطعة', groupBg: 'D32F2F', width: 18, required: true },
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
    // Is Universal: dropdown
    ws.dataValidations.add(range('Is Universal?'), {
        type: 'list', allowBlank: true,
        formulae: ['"TRUE,FALSE"'],
        showErrorMessage: true,
        errorTitle: L(lang, 'Invalid Value', 'قيمة غير صحيحة'),
        error: L(lang, 'Choose TRUE or FALSE.', 'اختر TRUE أو FALSE.'),
    });
    // Stock Mgmt: dropdown
    ws.dataValidations.add(range('Stock Mgmt'), {
        type: 'list', allowBlank: true,
        formulae: ['"TRUE,FALSE"'],
        showErrorMessage: true,
        errorTitle: L(lang, 'Invalid Value', 'قيمة غير صحيحة'),
        error: L(lang, 'Choose TRUE or FALSE.', 'اختر TRUE أو FALSE.'),
    });
    // Part Type: dropdown, required
    ws.dataValidations.add(range('Part Type'), {
        type: 'list', allowBlank: false,
        formulae: ['"Original,OEM,Aftermarket"'],
        showErrorMessage: true,
        errorTitle: L(lang, 'Invalid Part Type', 'نوع قطعة غير صحيح'),
        error: L(lang, 'Choose Original, OEM or Aftermarket.', 'اختر Original (أصلي) أو OEM أو Aftermarket (تجاري).'),
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

    return ws;
}

// ── Build hidden Lists sheet (data source for the dropdowns) ───────────────────
// Holds only the display names, in the template language. Kept veryHidden so
// users can't accidentally edit or rely on it — they only see the dropdowns.
function buildListsSheet(wb, { categories = [], brands = [], shipping = [] }) {
    const ws = wb.addWorksheet('Lists', { state: 'veryHidden' });
    ws.state = 'veryHidden';
    categories.forEach((v, i) => { ws.getCell(`A${i + 1}`).value = v; });
    brands.forEach((v, i) => { ws.getCell(`B${i + 1}`).value = v; });
    shipping.forEach((v, i) => { ws.getCell(`C${i + 1}`).value = v; });
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
    addSection(4, L(lang, '  RULES & VALIDATION', '  القواعد والتحقّق'));
    ws.getRow(5).height = 6;
    addRow(6,  L(lang, 'Language requirement', 'متطلّب اللغة'),
        L(lang,
          'Each product MUST have EITHER a complete English set (Title EN + Subtitle EN + Description EN) OR a complete Arabic set — or both. Mixing partial sets is rejected.',
          'يجب أن يحتوي كل منتج إمّا على مجموعة إنجليزية كاملة (العنوان + العنوان الفرعي + الوصف بالإنجليزية) أو مجموعة عربية كاملة — أو كلتيهما. خلط مجموعات ناقصة سيُرفض.'));
    ws.getRow(7).height = 6;
    addRow(8,  L(lang, 'Compatibility requirement', 'متطلّب التوافق'),
        L(lang,
          "Set 'Is Universal?' = TRUE  →  leave Compatible Cars blank.\nSet 'Is Universal?' = FALSE  →  you MUST fill Compatible Cars.",
          "اضبط 'يناسب كل السيارات؟' = TRUE  →  اترك خانة السيارات المتوافقة فارغة.\nاضبط 'يناسب كل السيارات؟' = FALSE  →  يجب تعبئة السيارات المتوافقة."));
    ws.getRow(9).height = 6;
    addRow(10, L(lang, 'Required columns', 'الأعمدة المطلوبة'),
        L(lang,
          'SKU, Price, Category Path, Is Universal?\nAll highlighted in the Products sheet with a dark header.',
          'رمز المنتج (SKU)، السعر، الفئة، يناسب كل السيارات؟\nجميعها مميّزة في ورقة المنتجات برأس داكن.'));

    ws.getRow(11).height = 6;

    // ── COMPATIBLE CARS FORMAT ────────────────────────────────────
    addSection(12, L(lang, '  COMPATIBLE CARS FORMAT', '  تنسيق السيارات المتوافقة'));
    ws.getRow(13).height = 6;
    addRow(14, L(lang, 'Concept', 'الفكرة'),
        L(lang,
          'You select car brands, models and years from the UI (they are pre-loaded from the database).\nWhen exporting from the UI selection tool, the IDs are filled automatically.\nIf filling manually, use the Car Brands (Reference) sheet.',
          'تختار ماركات السيارات والموديلات والسنوات من الواجهة (محمّلة مسبقاً من قاعدة البيانات).\nعند التصدير من أداة الاختيار، تُملأ المعرّفات تلقائياً.\nعند التعبئة يدوياً، استخدم ورقة ماركات السيارات (مرجع).'));
    ws.getRow(15).height = 6;
    addRow(16, L(lang, 'Format', 'التنسيق'),
        L(lang,
          'BRAND_ID:MODEL_ID:YEAR1,YEAR2,YEAR3\n\nMultiple cars separated by  |  (pipe)\n\nExamples:\n  Single model/years:   6640a1b2c3d4e5f6:7750b9c1:2019,2020,2021\n  Multiple models:      6640a1b2:7750b9c1:2020,2021 | 6640a1b2:8861c0d2:ALL\n  All years of model:   6640a1b2:7750b9c1:ALL',
          'معرّف_الماركة:معرّف_الموديل:سنة1,سنة2,سنة3\n\nتُفصل عدة سيارات بعلامة  |  (شَرطة عمودية)\n\nأمثلة:\n  موديل/سنوات واحدة:   6640a1b2c3d4e5f6:7750b9c1:2019,2020,2021\n  عدة موديلات:        6640a1b2:7750b9c1:2020,2021 | 6640a1b2:8861c0d2:ALL\n  كل سنوات الموديل:    6640a1b2:7750b9c1:ALL'));
    ws.getRow(16).height = 90;
    ws.getRow(17).height = 6;
    addRow(18, L(lang, 'All years shortcut', 'اختصار كل السنوات'),
        L(lang,
          'Use  :ALL  instead of listing individual years to mean every year of that model.',
          'استخدم  :ALL  بدلاً من سرد السنوات للإشارة إلى كل سنوات ذلك الموديل.'));
    ws.getRow(19).height = 6;

    // ── VARIATION TYPES FORMAT ────────────────────────────────────
    addSection(20, L(lang, '  VARIATION TYPES FORMAT', '  تنسيق أنواع المتغيّرات'));
    ws.getRow(21).height = 6;
    addRow(22, L(lang, 'Concept', 'الفكرة'),
        L(lang,
          'Options define the axes (e.g. Color, Size).\nEach option has a list of values.\nFormats must be exact or the import will be rejected.',
          'الخيارات تحدّد المحاور (مثل اللون، المقاس).\nلكل خيار قائمة قيم.\nيجب أن تكون التنسيقات دقيقة وإلّا سيُرفض الاستيراد.'));
    ws.getRow(23).height = 6;
    addRow(24, L(lang, 'Options column format', 'تنسيق عمود الخيارات'),
        L(lang,
          'Option1:Value1,Value2,Value3 ; Option2:ValueA,ValueB\n\nSeparate options with semicolons  ;\nSeparate values with commas  ,\n\nExample:\n  Color:Red,Blue,Black ; Size:Small,Medium,Large',
          'الخيار1:قيمة1,قيمة2,قيمة3 ; الخيار2:قيمةأ,قيمةب\n\nافصل الخيارات بفاصلة منقوطة  ;\nافصل القيم بفواصل  ,\n\nمثال:\n  Color:Red,Blue,Black ; Size:Small,Medium,Large'));
    ws.getRow(24).height = 90;
    ws.getRow(25).height = 6;
    addRow(26, L(lang, 'Variants column format', 'تنسيق عمود التنويعات'),
        L(lang,
          'Each variant on one \'row\' inside the cell, variants separated by  ||\n\nPer variant:  Option=Value|Option=Value :: price=XX.XX :: discount_type=fixed|percentage :: discount_value=XX.XX :: stock=N\n\nprice / discount_type / discount_value / stock are optional (falls back to product base values).\nThe discount applies to the variant\'s own price when it sets one, otherwise to the product price.\n\nExample:\n  Color=Red|Size=Small::price=49.99::discount_type=percentage::discount_value=20::stock=30 || Color=Blue|Size=Large::price=52.99::discount_type=fixed::discount_value=5::stock=20',
          'كل متغيّر في "سطر" داخل الخلية، تُفصل المتغيّرات بـ  ||\n\nلكل متغيّر:  Option=Value|Option=Value :: price=XX.XX :: discount_type=fixed|percentage :: discount_value=XX.XX :: stock=N\n\nالسعر / نوع الخصم / قيمة الخصم / المخزون اختيارية (تعود إلى قيم المنتج الأساسية).\nيُطبَّق الخصم على سعر المتغيّر نفسه إن وُجد، وإلا على سعر المنتج.\n\nمثال:\n  Color=Red|Size=Small::price=49.99::discount_type=percentage::discount_value=20::stock=30 || Color=Blue|Size=Large::price=52.99::discount_type=fixed::discount_value=5::stock=20'));
    ws.getRow(26).height = 100;
    ws.getRow(27).height = 6;

    // ── IMAGES FORMAT ────────────────────────────────────────────
    addSection(28, L(lang, '  IMAGES FORMAT', '  تنسيق الصور'));
    ws.getRow(29).height = 6;
    addRow(30, L(lang, 'Format', 'التنسيق'),
        L(lang,
          'Comma-separated full URLs.\nAppend  *  (asterisk) immediately after the URL (no space) to mark it as the PRIMARY image.\n\nExample:\n  https://cdn.example.com/main.jpg*,https://cdn.example.com/side.jpg,https://cdn.example.com/detail.jpg\n\nOnly one URL should be marked primary. If none marked, first URL becomes primary.',
          'روابط كاملة مفصولة بفواصل.\nأضف  *  (نجمة) مباشرة بعد الرابط (دون مسافة) لتحديده كصورة رئيسية.\n\nمثال:\n  https://cdn.example.com/main.jpg*,https://cdn.example.com/side.jpg,https://cdn.example.com/detail.jpg\n\nيُحدَّد رابط واحد فقط كرئيسي. إن لم يُحدَّد أيّ منها، يصبح الرابط الأول هو الرئيسي.'));
    ws.getRow(30).height = 90;
    ws.getRow(31).height = 6;

    // ── CATEGORY PATH FORMAT ─────────────────────────────────────
    addSection(32, L(lang, '  CATEGORY (DROPDOWN)', '  الفئة (قائمة منسدلة)'));
    ws.getRow(33).height = 6;
    addRow(34, L(lang, 'How to pick a category', 'كيف تختار الفئة'),
        L(lang,
          'Click the Category cell in the Products sheet and pick a value from the dropdown ▼.\nThe list shows the full category path (e.g. "Brakes > Brake Pads").\nOnly FINAL (most specific) categories are listed — parent categories that still have subcategories cannot be chosen.\nWhen you upload, the system matches your choice to its ID automatically — you never deal with IDs.',
          'انقر خلية الفئة في ورقة المنتجات واختر قيمة من القائمة المنسدلة ▼.\nتعرض القائمة مسار الفئة الكامل (مثل "فرامل > تيل فرامل").\nتظهر فقط الفئات النهائية (الأكثر تحديداً) — لا يمكن اختيار الفئات الأم التي لها فئات فرعية.\nعند الرفع، يطابق النظام اختيارك مع المعرّف تلقائياً — لا تتعامل مع المعرّفات إطلاقاً.'));
    ws.getRow(35).height = 6;
    addRow(36, L(lang, 'Important', 'مهم'),
        L(lang,
          'Type the value by hand only if it exactly matches a dropdown option. Free text that is not in the list will be rejected on upload.',
          'لا تكتب القيمة يدوياً إلا إذا كانت مطابقة تماماً لأحد خيارات القائمة. أي نص حر غير موجود في القائمة سيُرفض عند الرفع.'));
    ws.getRow(37).height = 6;

    // ── PRODUCT BRAND ────────────────────────────────────────────
    addSection(38, L(lang, '  PRODUCT BRAND (DROPDOWN)', '  ماركة المنتج (قائمة منسدلة)'));
    ws.getRow(39).height = 6;
    addRow(40, L(lang, 'How to pick a brand', 'كيف تختار الماركة'),
        L(lang,
          'Click the Product Brand cell and pick a brand (e.g. Bosch, Brembo) from the dropdown ▼.\nThe system resolves it to its ID automatically on upload. Leave blank for no brand.',
          'انقر خلية الماركة واختر ماركة (مثل Bosch، Brembo) من القائمة المنسدلة ▼.\nيحوّلها النظام إلى معرّفها تلقائياً عند الرفع. اتركها فارغة إن لم توجد ماركة.'));
    ws.getRow(41).height = 6;

    // ── HOW TO SUBMIT ────────────────────────────────────────────
    addSection(42, L(lang, '  HOW TO SUBMIT', '  كيفية الإرسال'));
    ws.getRow(43).height = 6;
    addRow(44, L(lang, 'Step 1 – Prepare', 'الخطوة 1 – التحضير'),
        L(lang, 'Fill in the Products sheet. Delete the sample rows before uploading.',
                'املأ ورقة المنتجات. احذف الصفوف النموذجية قبل الرفع.'));
    ws.getRow(45).height = 6;
    addRow(46, L(lang, 'Step 2 – Save', 'الخطوة 2 – الحفظ'),
        L(lang, 'Save as .xlsx  (Excel Workbook format). Do NOT change sheet names.',
                'احفظ بصيغة .xlsx  (تنسيق Excel Workbook). لا تغيّر أسماء الأوراق.'));
    ws.getRow(47).height = 6;
    addRow(48, L(lang, 'Step 3 – Upload', 'الخطوة 3 – الرفع'),
        L(lang, 'Go to Vendor Dashboard → Products → Bulk Upload → drag & drop the file.',
                'اذهب إلى لوحة البائع → المنتجات → الرفع الجماعي → اسحب وأفلت الملف.'));
    ws.getRow(49).height = 6;
    addRow(50, L(lang, 'Step 4 – Review errors', 'الخطوة 4 – مراجعة الأخطاء'),
        L(lang, 'The system shows a per-row error report. Fix errors and re-upload. Successful rows are imported immediately; failed rows are saved as drafts.',
                'يعرض النظام تقرير أخطاء لكل صف. أصلح الأخطاء وأعد الرفع. تُستورد الصفوف الناجحة فوراً؛ وتُحفظ الصفوف الفاشلة كمسودات.'));
    ws.getRow(51).height = 6;
    addRow(52, L(lang, 'Rows per file', 'عدد الصفوف لكل ملف'),
        L(lang, 'There is no product-count limit. Add or paste as many product rows as needed.',
                'لا يوجد حد لعدد المنتجات. أضف أو الصق أي عدد تحتاجه من صفوف المنتجات.'));
    ws.getRow(53).height = 6;

    // ── SHIPPING (OPTIONAL) ──────────────────────────────────────
    addSection(54, L(lang, '  SHIPPING ATTRIBUTES (OPTIONAL — RECOMMENDED)', '  خصائص الشحن (اختيارية — مُوصى بها)'));
    ws.getRow(55).height = 6;
    addRow(56, L(lang, 'Weight (kg)', 'الوزن (كجم)'),
        L(lang, 'Per-unit weight in kilograms (e.g. 1.5). Strongly recommended — required for weight-based shipping rates to work. Leave blank if unknown (treated as 0 kg).',
                'وزن الوحدة بالكيلوجرام (مثال 1.5). مُوصى به بشدة — مطلوب لعمل أسعار الشحن المبنية على الوزن. اتركه فارغاً إن كان غير معروف (يُعامَل كـ 0 كجم).'));
    ws.getRow(57).height = 6;
    addRow(58, L(lang, 'Dimensions (cm)', 'الأبعاد (سم)'),
        L(lang, 'Length x Width x Height in centimeters, e.g. 30x20x10. Informational only for now. Leave blank if unknown.',
                'الطول × العرض × الارتفاع بالسنتيمتر، مثال 30x20x10. للمعلومات فقط حالياً. اتركه فارغاً إن كان غير معروف.'));
    ws.getRow(59).height = 6;
    addRow(60, L(lang, 'Shipping Class', 'فئة الشحن'),
        L(lang, 'Optional. Pick a class from the dropdown ▼ (e.g. Light, Heavy, Fragile); the system resolves it to its ID on upload. Leave blank for no class.',
                'اختياري. اختر فئة من القائمة المنسدلة ▼ (مثل خفيف، ثقيل، قابل للكسر)؛ يحوّلها النظام إلى معرّفها عند الرفع. اتركه فارغاً لعدم تعيين فئة.'));
    ws.getRow(61).height = 6;

    // ── PRICING & DISCOUNTS ──────────────────────────────────────
    addSection(62, L(lang, '  PRICING & DISCOUNTS', '  التسعير والخصومات'));
    ws.getRow(63).height = 6;
    addRow(64, L(lang, 'How pricing works', 'كيف يعمل التسعير'),
        L(lang,
          'You enter the REGULAR price plus, optionally, a discount described by TWO columns:\n\n  Discount Type   →  fixed  (an amount off) or  percentage  (a % off)\n  Discount Value  →  the amount, or the percentage between 0 and 100\n\nThe sale price the customer sees is calculated for you. You never type it.',
          'تُدخل السعر الأساسي، وإن أردت خصماً تُحدده بعمودين:\n\n  نوع الخصم   →  fixed (مبلغ ثابت) أو  percentage (نسبة مئوية)\n  قيمة الخصم  →  المبلغ، أو النسبة بين 0 و 100\n\nيُحتسب سعر البيع الظاهر للعميل تلقائياً. لا تكتبه بنفسك.'));
    ws.getRow(64).height = 100;
    ws.getRow(65).height = 6;
    addRow(66, L(lang, 'Examples', 'أمثلة'),
        L(lang,
          'Price 200, Discount Type = fixed,      Discount Value = 50   →  customer pays 150\nPrice 200, Discount Type = percentage, Discount Value = 25   →  customer pays 150\nPrice 200, Discount Type blank                               →  no discount, customer pays 200',
          'السعر 200، نوع الخصم = fixed،      قيمة الخصم = 50   ←  يدفع العميل 150\nالسعر 200، نوع الخصم = percentage، قيمة الخصم = 25   ←  يدفع العميل 150\nالسعر 200، نوع الخصم فارغ                             ←  بدون خصم، يدفع العميل 200'));
    ws.getRow(66).height = 70;
    ws.getRow(67).height = 6;
    addRow(68, L(lang, 'Rules', 'القواعد'),
        L(lang,
          'Leave BOTH discount columns blank when there is no discount.\nIf you set a Discount Type you MUST set a Discount Value greater than 0.\nA fixed amount must be less than the Price. A percentage must be less than 100.\nA Discount Value with no Discount Type is rejected — it would silently sell at full price.',
          'اترك عمودَي الخصم فارغين عند عدم وجود خصم.\nإذا حددت نوع الخصم فيجب تحديد قيمة خصم أكبر من صفر.\nالمبلغ الثابت يجب أن يكون أقل من السعر. والنسبة يجب أن تكون أقل من 100.\nقيمة خصم بدون نوع خصم تُرفض — لأنها ستبيع بالسعر الكامل دون تنبيه.'));
    ws.getRow(68).height = 80;
    ws.getRow(69).height = 6;
    addRow(70, L(lang, 'Older template files', 'ملفات القالب القديمة'),
        L(lang,
          'A saved copy of the previous template (with a single "Discount Price" column) still uploads. Its sale price is converted to the equivalent fixed discount automatically. Download this template for the new columns.',
          'النسخة المحفوظة من القالب السابق (بعمود واحد "سعر الخصم") ما زالت تُرفع بنجاح. يُحوَّل سعر العرض تلقائياً إلى خصم بمبلغ ثابت مكافئ. حمّل هذا القالب للحصول على الأعمدة الجديدة.'));
    ws.getRow(70).height = 60;
    ws.getRow(71).height = 6;

    // ── PART TYPE ────────────────────────────────────────────────
    addSection(72, L(lang, '  PART TYPE (REQUIRED)', '  نوع القطعة (مطلوب)'));
    ws.getRow(73).height = 6;
    addRow(74, L(lang, 'Values', 'القيم'),
        L(lang,
          'Pick one in the LAST column of the Products sheet:\n  Original     — the car maker\'s own part, in its packaging\n  OEM          — made by the maker\'s supplier to the same specification\n  Aftermarket  — a third-party part made to fit\n\nRows without it are not imported. A sheet downloaded before this column existed has no Part Type — download this template again.',
          'اختر قيمة في العمود الأخير من ورقة المنتجات:\n  Original (أصلي)     — قطعة الشركة المصنّعة للعربية، في علبتها\n  OEM                  — من مورّد الشركة المصنّعة بنفس المواصفات\n  Aftermarket (تجاري) — قطعة من شركة تانية متصنّعة تركب على العربية\n\nالصف اللي من غيرها مش بيترفع. الشيت القديم اللي اتنزّل قبل العمود ده ملوش نوع القطعة — نزّل القالب ده من جديد.'));
    ws.getRow(74).height = 110;
    ws.getRow(75).height = 6;

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
    wb.creator  = 'Sayarty Platform';
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

    // Brands (names are not localised): hand-entered ones and the car makes together, the
    // same list every brand picker on the site shows.
    const brands = await Brand.find().lean().then((rows) => require('./shared/brandRef').mergedProductBrands(rows));
    const brandRows = brands.map(b => [b._id.toString(), b.name]);

    // Car Brands
    const carBrands = await CarBrand.find().sort({ name: 1 }).lean();
    const carRows = [];
    carBrands.forEach(cb => {
        (cb.models || []).forEach(m => {
            const years = (m.years || []).map(y => y.year).sort().join(', ');
            carRows.push([cb._id.toString(), cb.name, m._id.toString(), m.name, years]);
        });
    });

    // Shipping classes — AR column falls back to the EN name so the dropdown
    // never shows a blank entry for classes without an Arabic name.
    const shippingClasses = await ShippingClass.find().sort({ name: 1 }).lean();
    const scRows = shippingClasses
        .map(sc => [sc._id.toString(), sc.name, sc.name_ar || sc.name, sc.is_active ? L(lang, 'Active', 'مفعّلة') : L(lang, 'Inactive', 'غير مفعّلة')])
        .sort((a, b) => String(a[isAr ? 2 : 1]).localeCompare(String(b[isAr ? 2 : 1]), isAr ? 'ar' : 'en'));

    const refMeta = {
        categories: catRows.length,
        brands: brandRows.length,
        shipping: scRows.length,
    };

    // Hidden source lists for the dropdowns — display names in the template language.
    buildListsSheet(wb, {
        categories: catRows.map(r => isAr ? r[2] : r[1]),
        brands: brandRows.map(r => r[1]),
        shipping: scRows.map(r => isAr ? r[2] : r[1]),
    });

    // 1. Products sheet (with reference dropdowns)
    buildProductsSheet(wb, lang, refMeta);

    // 2. Instructions sheet
    buildInstructionsSheet(wb, lang);

    // 3. Car Brands Reference — kept: compatible cars are still entered by ID,
    //    so this lookup table is still needed (it is not a dropdown selector).
    buildRefSheet(wb, 'Car Brands (Reference)',
        [L(lang, 'Car Brand ID', 'معرّف ماركة السيارة'), L(lang, 'Car Brand Name', 'اسم ماركة السيارة'), L(lang, 'Model ID', 'معرّف الموديل'), L(lang, 'Model Name', 'اسم الموديل'), L(lang, 'Available Years', 'السنوات المتاحة')],
        carRows, [28, 20, 28, 30, 40], 'FFE65100', lang);

    return await wb.xlsx.writeBuffer();
}

module.exports = { generateBulkUploadTemplate };
