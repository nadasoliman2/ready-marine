// Shared helpers for the online bulk product entry grid.

import { validateDiscount } from '../../../lib/productPricing';
import { entryToFormPatch } from '../../../lib/catalog';
import { partTypeRequiredText } from '../../../lib/partType';

export const L = (lang, en, ar) => (lang === 'ar' ? ar : en);

let _seq = 0;
function rid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    _seq += 1;
    return `row_${Date.now().toString(36)}_${_seq}`;
}

// A fresh, empty row — mirrors the single-product form state shape.
export function blankRow() {
    return {
        _id: rid(),
        title_en: '', title_ar: '',
        subtitle_en: '', subtitle_ar: '',
        description_en: '', description_ar: '',
        sku: '', part_number: '', gtin: '',
        // Original / OEM / Aftermarket — required (lib/partType). A catalog entry does not
        // set it: the same part can be original at one store and aftermarket at another.
        part_type: '',
        status: 'draft',
        price: '', discount_type: '', discount_value: '',
        category_id: '', product_brand_id: '',
        is_universal: true, for_girls: false, for_trunk: false, stock_management: true,
        stock_status: 'instock', quantity: 1,
        images: [], compatible_cars: [], variation_types: [], variants: [],
        weight: '', dimensions: { length: '', width: '', height: '' }, shipping_class_id: '',
        // The catalog entry this row came from, when it came from the picker.
        // Never rendered as a column: the vendor is not shown the link, and a
        // pre-filled row simply looks like a row they had already filled in.
        catalog_entry_id: null,
        _serverErrors: null,
    };
}

// A row pre-filled from a catalog entry — everything except the vendor's own
// fields (SKU, price, discount, stock), which stay empty for them to enter.
export function rowFromCatalogEntry(entry) {
    return {
        ...blankRow(),
        ...entryToFormPatch(entry),
        catalog_entry_id: String(entry._id),
    };
}

// Deep-ish clone of a row for "duplicate" (new id, cleared SKU + server errors).
// The catalog link is dropped: a vendor may only have one product per entry, so
// a duplicated row is by definition a different product.
export function cloneRow(row) {
    const copy = JSON.parse(JSON.stringify({ ...row, _serverErrors: null }));
    copy._id = rid();
    copy.sku = '';
    copy.catalog_entry_id = null;
    return copy;
}

// Walk the nested category tree → leaf ids + display path labels (by language).
export function buildCategoryIndex(tree, lang) {
    const leafIds = new Set();
    const pathLabel = new Map();
    const nameOf = (c) => (lang === 'ar' ? (c.name_ar || c.name) : (c.name_en || c.name));
    const walk = (nodes, prefix) => {
        for (const c of (nodes || [])) {
            const id = String(c._id);
            const label = [...prefix, nameOf(c)];
            pathLabel.set(id, label.join(' › '));
            const subs = c.subcategories || [];
            if (subs.length === 0) leafIds.add(id);
            else walk(subs, label);
        }
    };
    walk(tree || [], []);
    return { leafIds, pathLabel };
}

// Is the row effectively blank (so we skip it on submit and show a neutral dot)?
export function isRowEmpty(row) {
    return (
        !str(row.sku) && !str(row.title_en) && !str(row.title_ar) &&
        !str(row.price) && (row.images?.length || 0) === 0 &&
        !str(row.subtitle_en) && !str(row.description_en) &&
        !str(row.subtitle_ar) && !str(row.description_ar) &&
        !row.category_id && (row.compatible_cars?.length || 0) === 0
    );
}

function str(v) { return v === null || v === undefined ? '' : String(v).trim(); }

// Client-side validation that MIRRORS the server (processRows) rules.
// Returns an array of { field, message }.
export function validateRow(row, refs) {
    const errors = [];
    const E = (field, message) => errors.push({ field, message });
    const lang = refs?.language;
    const price = Number(row.price);

    if (!str(row.sku)) E('SKU', L(lang, 'SKU is required', 'رمز المنتج (SKU) مطلوب'));
    if (!row.part_type) E('Part Type', partTypeRequiredText(lang === 'ar'));
    if (!(price > 0)) E('Price', L(lang, 'Price must be positive', 'يجب أن يكون السعر رقماً موجباً'));

    if (!row.category_id) E('Category', L(lang, 'Pick a category', 'اختر فئة'));
    else if (refs?.leafIds && !refs.leafIds.has(String(row.category_id))) E('Category', L(lang, 'Choose a final (most specific) category', 'اختر فئة نهائية (الأكثر تحديداً)'));

    if ((row.images?.length || 0) === 0) E('Images', L(lang, 'Add at least one image', 'أضف صورة واحدة على الأقل'));

    const en = str(row.title_en) && str(row.subtitle_en) && str(row.description_en);
    const ar = str(row.title_ar) && str(row.subtitle_ar) && str(row.description_ar);
    if (!en && !ar) E('Content', L(lang, 'Complete the EN or AR set (title, subtitle, description)', 'أكمل مجموعة إنجليزية أو عربية (عنوان، عنوان فرعي، وصف)'));

    const cars = row.compatible_cars || [];
    if (row.is_universal === false && cars.length === 0) E('Compatibility', L(lang, 'Add compatible cars or mark Universal', 'أضف سيارات متوافقة أو فعّل "عام"'));
    if (row.is_universal === true && cars.length > 0) E('Compatibility', L(lang, 'Remove cars or turn off Universal', 'احذف السيارات أو أوقف "عام"'));

    // Same discount rules the server enforces, so the row lights up before submit.
    const discountError = validateDiscount(row.price, row.discount_type || null, row.discount_value, lang === 'ar');
    if (discountError) E('Discount', discountError);
    if (!row.discount_type && row.discount_value !== '' && row.discount_value != null) {
        E('Discount', L(lang, 'Pick a discount type for this value', 'اختر نوع الخصم لهذه القيمة'));
    }

    const hasVariants = (row.variants?.length || 0) > 0;
    if (row.stock_management && !hasVariants) {
        const q = row.quantity === '' || row.quantity == null ? NaN : parseInt(row.quantity, 10);
        if (isNaN(q) || q < 0) E('Quantity', L(lang, 'Quantity must be a non-negative integer', 'الكمية يجب أن تكون عدداً صحيحاً غير سالب'));
    }
    return errors;
}

// Build the JSON payload for the bulk-json endpoint (drops client-only fields,
// enforces universal ⇒ no compatible cars). Returns ONLY the non-empty rows in
// the same order, so the server's 1-based `row` index maps back to them.
export function buildSubmittable(rows) {
    return rows.filter((r) => !isRowEmpty(r));
}

export function rowToPayload(row) {
    const { _id, _serverErrors, ...rest } = row;
    // '' means "no discount"; send null so the server never has to guess, and
    // drop an orphan value that has no type.
    const discount_type = row.discount_type || null;
    return {
        ...rest,
        discount_type,
        discount_value: discount_type && row.discount_value !== '' ? row.discount_value : null,
        compatible_cars: row.is_universal ? [] : (row.compatible_cars || []),
    };
}
