'use strict';

const XLSX = require('xlsx');
const mongoose = require('mongoose');
const { normalizePartType } = require('./shared/partType');
const { Product } = require('../models/products');
const { Seller } = require('../models/sellers');
const { Category } = require('../models/categories');
const { Brand } = require('../models/product_brands');
const { CarBrand } = require('../models/car_brands');
const { ShippingClass } = require('../models/shipping_classes');
const shippingEngine = require('./shippingEngine');
const { normalizePricing, normalizeDiscountType, round2 } = require('./shared/productPricing');
const { normalizeProductImages } = require('./shared/productImages');

/* ─────────────────────────────────────────────────────────────
   Column index mapping (0-based, matching the template order without Slugs)
   ───────────────────────────────────────────────────────────── */
const COL = {
    SKU: 0,
    PART_NUMBER: 1,
    GTIN: 2,
    TITLE_EN: 3,
    SUBTITLE_EN: 4,
    DESCRIPTION_EN: 5,
    TITLE_AR: 6,
    SUBTITLE_AR: 7,
    DESCRIPTION_AR: 8,
    PRICE: 9,
    DISCOUNT_TYPE: 10,
    DISCOUNT_VALUE: 11,
    STATUS: 12,
    CATEGORY_ID: 13,
    PRODUCT_BRAND_ID: 14,
    IS_UNIVERSAL: 15,
    COMPATIBLE_CARS: 16,
    STOCK_MANAGEMENT: 17,
    QUANTITY: 18,
    STOCK_STATUS: 19,
    IMAGE_URLS: 20,
    VARIATION_TYPES: 21,
    VARIANTS: 22,
    WEIGHT: 23,
    DIMENSIONS: 24,
    SHIPPING_CLASS_ID: 25,
    // Added last so every earlier column keeps its index. Required: a sheet without it
    // (downloaded before it existed) fails each row with a pointer to the new template.
    PART_TYPE: 26,
};

/* Layout of templates downloaded BEFORE the discount fields changed: one
   "Discount Price" column where the type/value pair now sits. Vendors keep
   working copies of the sheet for months, so those files are still accepted —
   the single sale price is read and converted to an equivalent fixed discount.
   Detected from the header row, never guessed from the data. */
const LEGACY_COL = {
    SKU: 0,
    PART_NUMBER: 1,
    GTIN: 2,
    TITLE_EN: 3,
    SUBTITLE_EN: 4,
    DESCRIPTION_EN: 5,
    TITLE_AR: 6,
    SUBTITLE_AR: 7,
    DESCRIPTION_AR: 8,
    PRICE: 9,
    LEGACY_DISCOUNT_PRICE: 10,
    STATUS: 11,
    CATEGORY_ID: 12,
    PRODUCT_BRAND_ID: 13,
    IS_UNIVERSAL: 14,
    COMPATIBLE_CARS: 15,
    STOCK_MANAGEMENT: 16,
    QUANTITY: 17,
    STOCK_STATUS: 18,
    IMAGE_URLS: 19,
    VARIATION_TYPES: 20,
    VARIANTS: 21,
    WEIGHT: 22,
    DIMENSIONS: 23,
    SHIPPING_CLASS_ID: 24,
    // Never in a legacy sheet; read anyway so a hand-added last column still counts.
    PART_TYPE: 25,
};

const DATA_START_ROW = 5;   // 0-based → Excel row 6
const HEADER_ROW = 3;       // 0-based → Excel row 4 (column names)

/* ─────────────────────────────────────────────────────────────
   Slug generator (mirrors vendorService.generateSlug)
   ───────────────────────────────────────────────────────────── */
async function generateSlug(title, vendorName, lang, productId = null) {
    if (!title) return '';
    let slug = `${title}-${vendorName}`.toLowerCase();
    if (lang === 'en') {
        slug = slug.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    } else {
        slug = slug.replace(/[^\u0621-\u064A0-9a-z]+/g, '-').replace(/^-+|-+$/g, '');
    }

    let uniqueSlug = slug;
    let counter = 1;
    while (true) {
        const query = lang === 'en' ? { slug_en: uniqueSlug } : { slug_ar: uniqueSlug };
        if (productId) query._id = { $ne: productId };
        const existing = await Product.findOne(query);
        if (!existing) break;
        uniqueSlug = `${slug}-${counter++}`;
    }
    return uniqueSlug;
}

/* ─────────────────────────────────────────────────────────────
   Helper: read a cell as trimmed string (avoids numeric coercion)
   ───────────────────────────────────────────────────────────── */
function cellStr(row, colIdx) {
    const cell = row[colIdx];
    if (cell === undefined || cell === null) return null;
    const raw = String(cell).trim();
    return raw === '' ? null : raw;
}

/* ─────────────────────────────────────────────────────────────
   Helper: parse boolean from TRUE / FALSE string
   ───────────────────────────────────────────────────────────── */
function parseBool(val) {
    if (val === null || val === undefined) return null;
    const s = String(val).trim().toUpperCase();
    if (s === 'TRUE') return true;
    if (s === 'FALSE') return false;
    return null;
}

/* ─────────────────────────────────────────────────────────────
   Parse: Compatible Cars
   Format: BRAND_ID:MODEL_ID:YEAR1,YEAR2 | BRAND_ID:MODEL_ID:ALL
   ───────────────────────────────────────────────────────────── */
function parseCompatibleCars(raw) {
    if (!raw) return [];
    const entries = raw.split('|').map(e => e.trim()).filter(Boolean);
    const grouped = {};
    for (const entry of entries) {
        const parts = entry.split(':');
        if (parts.length < 3) continue;
        const [brand_id, model_id, yearsStr] = parts;
        const all_years = yearsStr.trim().toUpperCase() === 'ALL';
        const years = all_years ? [] : yearsStr.split(',').map(y => parseInt(y.trim(), 10)).filter(n => !isNaN(n));
        if (!grouped[brand_id]) grouped[brand_id] = { brand_id: brand_id.trim(), models: [] };
        grouped[brand_id].models.push({ model_id: model_id.trim(), years, all_years });
    }
    return Object.values(grouped);
}

/* ─────────────────────────────────────────────────────────────
   Parse: Variation Types
   Format: TypeName1:Option1,Option2 ; TypeName2:OptionA,OptionB
   ───────────────────────────────────────────────────────────── */
function parseVariationTypes(raw) {
    if (!raw) return [];
    return raw.split(';').map(typeStr => {
        const colonIdx = typeStr.indexOf(':');
        if (colonIdx === -1) return null;
        const name = typeStr.slice(0, colonIdx).trim();
        const optionsStr = typeStr.slice(colonIdx + 1).trim();
        const options = optionsStr.split(',').map(v => ({ value: v.trim() })).filter(o => o.value);
        return name ? { name, options } : null;
    }).filter(Boolean);
}

/* ─────────────────────────────────────────────────────────────
   Parse: Variants
   Format: Color=Red|Size=Small::price=49.99::discount_type=percentage::discount_value=10::stock=30 || Color=Blue::stock=20

   `discount_price=` from older sheets is still understood and converted to the
   equivalent fixed discount, so a saved working copy keeps importing.
   ───────────────────────────────────────────────────────────── */
function parseVariants(raw, variation_types) {
    if (!raw) return [];
    const typeMap = {};
    (variation_types || []).forEach(vt => { typeMap[vt.name.toLowerCase()] = vt; });

    return raw.split('||').map(variantStr => {
        const sections = variantStr.trim().split('::');
        const selected_options = sections[0].split('|').map(pair => {
            const eqIdx = pair.indexOf('=');
            if (eqIdx === -1) return null;
            const type_name = pair.slice(0, eqIdx).trim();
            const option_value = pair.slice(eqIdx + 1).trim();
            return type_name && option_value ? { type_name, option_value } : null;
        }).filter(Boolean);

        let price = null, discount_type = null, discount_value = null, legacyDiscountPrice = null, stock = 0;
        for (const section of sections.slice(1)) {
            const eqIdx = section.indexOf('=');
            if (eqIdx === -1) continue;
            const key = section.slice(0, eqIdx).trim().toLowerCase();
            const val = section.slice(eqIdx + 1).trim();
            if (key === 'price') price = parseFloat(val);
            else if (key === 'discount_type') discount_type = normalizeDiscountType(val);
            else if (key === 'discount_value') discount_value = parseFloat(val);
            else if (key === 'discount_price') legacyDiscountPrice = parseFloat(val);
            else if (key === 'stock') stock = parseInt(val, 10);
        }

        // Legacy sale price → the fixed amount that produces it. Needs the
        // variant's own price; when the variant inherits the base price the
        // conversion is deferred to the row (see convertLegacyVariantDiscounts).
        if (discount_type === null && Number.isFinite(legacyDiscountPrice)) {
            discount_type = 'fixed';
            discount_value = Number.isFinite(price) ? round2(price - legacyDiscountPrice) : null;
        }

        // Resolve type_id / option_id from the variation_types parsed for this row
        const resolved = selected_options.map(so => {
            const vt = typeMap[so.type_name.toLowerCase()];
            if (!vt) return so;
            const opt = (vt.options || []).find(o => o.value.toLowerCase() === so.option_value.toLowerCase());
            return {
                ...so,
                type_id: vt._id || null,
                option_id: opt?._id || null,
            };
        });

        return {
            selected_options: resolved,
            price,
            discount_type,
            discount_value,
            _legacy_discount_price: legacyDiscountPrice,
            stock,
        };
    }).filter(v => v.selected_options.length > 0);
}

/**
 * A discount value with no discount type is almost always a filled-in amount
 * whose type cell was left blank. Silently ignoring it would publish the
 * product at full price, so flag it for an explicit row error instead.
 */
function flagValueWithoutType(r) {
    r._discount_value_without_type =
        r.discount_type === null && Number.isFinite(r.discount_value) && r.discount_value > 0;
    if (r.discount_type === null) r.discount_value = null;
}

/**
 * Finish the legacy `discount_price=` conversion for variants that inherit the
 * product's base price — only known once the row's own price is parsed.
 */
function convertLegacyVariantDiscounts(variants, basePrice) {
    for (const v of (variants || [])) {
        const legacy = v._legacy_discount_price;
        delete v._legacy_discount_price;
        if (!Number.isFinite(legacy) || v.discount_type !== 'fixed' || v.discount_value !== null) continue;
        const effective = Number.isFinite(v.price) ? v.price : basePrice;
        if (Number.isFinite(effective)) v.discount_value = round2(effective - legacy);
    }
}

/* ─────────────────────────────────────────────────────────────
   Parse: Dimensions
   Format: LxWxH (cm), e.g. 30x20x10  — also accepts * or , as separators
   ───────────────────────────────────────────────────────────── */
function parseDimensions(raw) {
    if (!raw) return undefined;
    const parts = String(raw).split(/[x*,×]/i).map(p => parseFloat(String(p).trim()));
    const [length, width, height] = parts;
    const dims = {
        length: Number.isFinite(length) && length >= 0 ? length : null,
        width: Number.isFinite(width) && width >= 0 ? width : null,
        height: Number.isFinite(height) && height >= 0 ? height : null,
    };
    if (dims.length === null && dims.width === null && dims.height === null) return undefined;
    return dims;
}

/**
 * What a bulk row's requested status is actually allowed to become.
 *
 * The single-product form has always run this gate (see `addProduct` in vendorService):
 * a vendor asking to publish gets `pending` unless an admin turned on
 * `auto_publish_products` for their store. Bulk upload skipped it entirely and wrote the
 * STATUS column straight into the product, so a vendor could put "published" in a
 * spreadsheet and land on the storefront without anyone approving it — which is exactly
 * what happened, 13 times.
 *
 * `bypassApproval` is for the admin's own bulk upload, which runs through this same
 * service. It defaults to FALSE so a caller that forgets to say who it is gets the safe
 * answer rather than the permissive one.
 */
function resolveBulkStatus(requested, { vendor, bypassApproval = false }) {
    if (requested !== 'published') return 'draft';
    if (bypassApproval) return 'published';
    return vendor?.auto_publish_products ? 'published' : 'pending';
}

/* ─────────────────────────────────────────────────────────────
   Parse: Image URLs
   Format: url1*,url2,url3   (* marks primary)
   ───────────────────────────────────────────────────────────── */
function parseImages(raw) {
    if (!raw) return [];
    const parts = raw.split(',').map(p => p.trim()).filter(Boolean);
    const images = parts.map((p) => {
        const isPrimary = p.endsWith('*');
        return { url: isPrimary ? p.slice(0, -1) : p, is_primary: isPrimary };
    });
    // Same rule as every other way a product is written: exactly one primary, and it is
    // first — so a sheet that stars the third image really does get that image on the card.
    // Also covers a sheet with no star at all, and one that stars several.
    return normalizeProductImages(images);
}

/* ─────────────────────────────────────────────────────────────
   linkVariantIds — assign _id references within variation_types
   ───────────────────────────────────────────────────────────── */
function linkVariantIds(variation_types, variants) {
    variation_types.forEach(vt => {
        if (!vt._id) vt._id = new mongoose.Types.ObjectId();
        (vt.options || []).forEach(opt => {
            if (!opt._id) opt._id = new mongoose.Types.ObjectId();
        });
    });

    (variants || []).forEach(variant => {
        (variant.selected_options || []).forEach(so => {
            const matchedType = variation_types.find(vt => vt.name.toLowerCase() === so.type_name.toLowerCase());
            if (matchedType) {
                so.type_id = matchedType._id;
                const matchedOpt = (matchedType.options || []).find(o => o.value.toLowerCase() === so.option_value.toLowerCase());
                if (matchedOpt) so.option_id = matchedOpt._id;
            }
        });
    });
}

/* ─────────────────────────────────────────────────────────────
   Helper: normalize a dimensions object ({length,width,height}) coming
   from JSON (the web grid) into numbers / null, matching parseDimensions.
   ───────────────────────────────────────────────────────────── */
function normalizeDimensions(d) {
    if (!d || typeof d !== 'object') return undefined;
    const num = (v) => {
        if (v === '' || v === null || v === undefined) return null;
        const n = parseFloat(v);
        return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const dims = { length: num(d.length), width: num(d.width), height: num(d.height) };
    if (dims.length === null && dims.width === null && dims.height === null) return undefined;
    return dims;
}

/* ─────────────────────────────────────────────────────────────
   buildReferenceData — fetch the vendor + reference collections once and
   build the maps / resolvers shared by both the Excel and JSON entry points.
   ───────────────────────────────────────────────────────────── */
async function buildReferenceData(vendorId) {
    const vendor = await Seller.findById(vendorId);
    if (!vendor) throw new Error('Vendor not found.');
    const vendorName = vendor.store_name || vendor.store_username || 'vendor';

    const norm = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase();

    const [allCategories, allBrands, allShippingClasses] = await Promise.all([
        Category.find().lean(),
        // Hand-entered brands and the car makes, the same list the template's dropdown shows.
        Brand.find().lean().then((rows) => require('./shared/brandRef').mergedProductBrands(rows)),
        ShippingClass.find().lean(),
    ]);

    const categoryMap = new Map(allCategories.map(c => [c._id.toString(), c]));
    const brandMap = new Map(allBrands.map(b => [b._id.toString(), b]));
    const shippingClassMap = new Map(allShippingClasses.map(sc => [sc._id.toString(), sc]));

    // Leaf categories only: a product must be filed under a final (most specific)
    // category, never an intermediate parent. A leaf is not the parent of any other.
    const categoryParentIds = new Set();
    for (const c of allCategories) if (c.parent_id) categoryParentIds.add(c.parent_id.toString());
    const isLeafCategory = (id) => categoryMap.has(id) && !categoryParentIds.has(id);

    // Category path resolver — mirrors templateGenerator so dropdown strings match.
    const resolveCatPath = (catId, pathLang) => {
        const parts = [];
        let curr = categoryMap.get(catId.toString());
        while (curr) {
            parts.unshift(pathLang === 'en' ? (curr.name || curr.name_ar) : (curr.name_ar || curr.name));
            curr = curr.parent_id ? categoryMap.get(curr.parent_id.toString()) : null;
        }
        return parts.join(' > ');
    };

    // name → id maps (accept both English and Arabic display strings)
    const categoryNameToId = new Map();
    for (const c of allCategories) {
        const en = norm(resolveCatPath(c._id, 'en'));
        const ar = norm(resolveCatPath(c._id, 'ar'));
        if (en) categoryNameToId.set(en, c._id.toString());
        if (ar) categoryNameToId.set(ar, c._id.toString());
    }
    const brandNameToId = new Map();
    for (const b of allBrands) if (b.name) brandNameToId.set(norm(b.name), b._id.toString());
    const shippingNameToId = new Map();
    for (const sc of allShippingClasses) {
        if (sc.name) shippingNameToId.set(norm(sc.name), sc._id.toString());
        if (sc.name_ar) shippingNameToId.set(norm(sc.name_ar), sc._id.toString());
    }

    // Resolve a cell that may hold either an ObjectId or a dropdown name.
    // Returns { id, raw }; id is null when a non-empty value can't be matched.
    const resolveRef = (raw, nameToId) => {
        const t = (raw || '').trim();
        if (!t) return { id: null, raw: '' };
        if (mongoose.Types.ObjectId.isValid(t)) return { id: t.toLowerCase(), raw: t };
        return { id: nameToId.get(norm(t)) || null, raw: t };
    };

    return {
        vendor, vendorName,
        categoryMap, brandMap, shippingClassMap, isLeafCategory,
        categoryNameToId, brandNameToId, shippingNameToId, resolveRef,
    };
}

/* ─────────────────────────────────────────────────────────────
   buildCarBrandMap — fetch only the car brands referenced by the rows'
   (already-structured) compatible_cars arrays.
   ───────────────────────────────────────────────────────────── */
async function buildCarBrandMap(coercedRows) {
    const ids = new Set();
    for (const r of coercedRows) {
        (r.compatible_cars || []).forEach(entry => {
            if (entry.brand_id && mongoose.Types.ObjectId.isValid(entry.brand_id)) ids.add(String(entry.brand_id));
        });
    }
    const found = await CarBrand.find({ _id: { $in: [...ids] } }).lean();
    return new Map(found.map(cb => [cb._id.toString(), cb]));
}

/* ─────────────────────────────────────────────────────────────
   processRows — shared per-row validation + save loop with draft-on-error.
   Consumes STRUCTURED rows: compatible_cars / images / variation_types /
   variants / dimensions are already objects (the Excel and JSON entry points
   each prepare the rows before calling this). Returns { succeeded, failed }.
   ───────────────────────────────────────────────────────────── */
async function processRows(coercedRows, vendorId, refs, { bypassApproval = false } = {}) {
    const { vendor, vendorName, categoryMap, brandMap, shippingClassMap, carBrandMap, isLeafCategory } = refs;

    const succeeded = [];
    const failed = [];

    // Master catalog: resolve every row's entry up front, then let each entry
    // fill the gaps the vendor left. A file carrying only SKU, price and stock
    // passes validation on the strength of the catalog alone — which is the point
    // of matching before saving rather than after.
    const catalogService = require('./catalogService');
    const claimedEntries = new Set();
    for (const r of coercedRows) {
        if (!r.catalog_entry_id) continue;
        try {
            const entry = await catalogService.getSelectableEntry(r.catalog_entry_id);
            if (!entry) { r.catalog_entry_id = null; continue; }
            r.catalog_entry_id = String(entry._id);

            // One product per (vendor + entry) — enforced across the batch as well
            // as against what the vendor already sells, so a file listing the same
            // entry twice fails the second row instead of creating a duplicate.
            const existingId = await catalogService.findVendorProductOnEntry(vendorId, entry._id);
            if (existingId || claimedEntries.has(r.catalog_entry_id)) {
                r._catalog_duplicate = true;
                continue;
            }
            claimedEntries.add(r.catalog_entry_id);

            Object.assign(r, catalogService.fillMissingFromEntry(r, entry));
            // `category_raw` is what the "Category is required" check reads — it
            // holds whatever the vendor typed in the cell. A category supplied by
            // the catalog has no cell behind it, so stand its id in, otherwise a
            // row that the entry just completed would still fail as empty.
            if (!r.category_raw && r.category_id) r.category_raw = String(r.category_id);
        } catch (err) {
            console.error(`[BulkUpload] Catalog prefill failed for row ${r._rowNum}:`, err.message);
            r.catalog_entry_id = null;
        }
    }

    for (const r of coercedRows) {
        // Structured-field defaults (JSON rows may omit empties)
        r.compatible_cars = Array.isArray(r.compatible_cars) ? r.compatible_cars : [];
        r.variation_types = Array.isArray(r.variation_types) ? r.variation_types : [];
        r.variants = Array.isArray(r.variants) ? r.variants : [];
        r.images = Array.isArray(r.images) ? r.images : [];

        const errors = [];

        if (r._catalog_duplicate) {
            errors.push({ field: 'Catalog', message: 'You already have a product on the selected catalog entry. Pick a different one or mark this row as a new product.' });
        }

        /* Stage 3: Required field validation */
        if (!r.sku) errors.push({ field: 'SKU', message: 'SKU is required.' });
        if (!r.price || r.price <= 0) errors.push({ field: 'Price', message: 'Price must be a positive number.' });
        if (r.is_universal === null) errors.push({ field: 'Is Universal?', message: 'Is Universal? must be TRUE or FALSE.' });
        if (!r.part_type) {
            errors.push({
                field: 'Part Type',
                message: r.part_type_raw
                    ? `Part type "${r.part_type_raw}" is not recognised — choose Original, OEM or Aftermarket.`
                    : 'Part type is required: Original, OEM or Aftermarket. Using an older sheet? Download the latest template — Part Type is its last column.',
            });
        }

        // Language validation
        const hasEnSet = !!(r.title_en && r.subtitle_en && r.description_en);
        const hasArSet = !!(r.title_ar && r.subtitle_ar && r.description_ar);
        if (!hasEnSet && !hasArSet) {
            errors.push({ field: 'Content', message: 'At least one complete language set (all three of Title, Subtitle, Description) is required in English or Arabic.' });
        }

        /* Stage 4: Reference validation (dropdown name or raw ID) */
        // Category — required, and must be a final (leaf) category.
        if (!r.category_raw) {
            errors.push({ field: 'Category', message: 'Category is required. Pick a value from the Category dropdown.' });
        } else if (!r.category_id || !categoryMap.has(r.category_id)) {
            errors.push({ field: 'Category', message: `Category "${r.category_raw}" not found. Pick a value from the Category dropdown.` });
        } else if (!isLeafCategory(r.category_id)) {
            errors.push({ field: 'Category', message: `Category "${r.category_raw}" has subcategories — choose a final (most specific) category.` });
        }

        // Product Brand — optional.
        if (r.product_brand_raw && (!r.product_brand_id || !brandMap.has(r.product_brand_id))) {
            errors.push({ field: 'Product Brand', message: `Brand "${r.product_brand_raw}" not found. Pick a value from the Product Brand dropdown.` });
        }

        // Compatible cars reference validation
        const carErrors = [];
        for (const entry of r.compatible_cars) {
            if (!mongoose.Types.ObjectId.isValid(entry.brand_id)) {
                carErrors.push(`Car brand_id "${entry.brand_id}" is not a valid ObjectId.`);
                continue;
            }
            const carBrand = carBrandMap.get(String(entry.brand_id));
            if (!carBrand) {
                carErrors.push(`Car brand "${entry.brand_id}" not found.`);
                continue;
            }
            // Enrich brand_name
            entry.brand_name = carBrand.name;

            for (const model of (entry.models || [])) {
                const foundModel = carBrand.models.find(m => m._id.toString() === String(model.model_id));
                if (!foundModel) {
                    carErrors.push(`Model "${model.model_id}" not found under car brand "${carBrand.name}".`);
                    continue;
                }
                model.model_name = foundModel.name;

                if (!model.all_years) {
                    const availableYears = new Set(foundModel.years.map(y => y.year));
                    for (const yr of (model.years || [])) {
                        if (!availableYears.has(yr)) {
                            carErrors.push(`Year ${yr} not available for model "${foundModel.name}".`);
                        }
                    }
                }
            }
        }
        if (carErrors.length > 0) {
            errors.push({ field: 'Compatible Cars', message: carErrors.join(' ') });
        }

        /* Stage 5: Business logic validation */
        if (r.is_universal === false && r.compatible_cars.length === 0) {
            errors.push({ field: 'Compatible Cars', message: 'Compatible Cars must be filled when Is Universal? is FALSE.' });
        }
        if (r.is_universal === true && r.compatible_cars.length > 0) {
            errors.push({ field: 'Compatible Cars', message: 'Compatible Cars must be empty when Is Universal? is TRUE.' });
        }
        // Pricing: coerce the discount type/value pair and derive discount_price
        // for the row and each of its variants, in one place for both entry
        // points. Field names match the template column labels.
        if (r._discount_value_without_type) {
            errors.push({ field: 'Discount Type', message: 'Discount Value was filled in but Discount Type is empty. Choose "fixed" or "percentage".' });
        }
        const pricingErrors = normalizePricing(r);
        for (const pe of pricingErrors) {
            errors.push({
                field: pe.field === 'Variants' ? 'Variants' : 'Discount Value',
                message: pe.message,
            });
        }

        if (r.variation_types.length > 0) {
            // Assign _ids so variants can reference them
            r.variation_types.forEach(vt => { if (!vt._id) vt._id = new mongoose.Types.ObjectId(); (vt.options || []).forEach(o => { if (!o._id) o._id = new mongoose.Types.ObjectId(); }); });
        }

        if (r.variants.length > 0) {
            // Validate variant options against defined types
            const typeMapLocal = {};
            r.variation_types.forEach(vt => { typeMapLocal[vt.name.toLowerCase()] = vt; });

            for (const variant of r.variants) {
                // Variant discounts were validated by normalizePricing above.
                for (const so of (variant.selected_options || [])) {
                    const vt = typeMapLocal[so.type_name.toLowerCase()];
                    if (!vt) {
                        errors.push({ field: 'Variants', message: `Variant references unknown type "${so.type_name}".` });
                    } else {
                        const hasOpt = vt.options.some(o => o.value.toLowerCase() === so.option_value.toLowerCase());
                        if (!hasOpt) {
                            errors.push({ field: 'Variants', message: `Option "${so.option_value}" not found in type "${so.type_name}".` });
                        }
                    }
                }
            }

            // If variants exist with stock management → null product-level quantity
            if (r.stock_management) r.quantity = null;
        } else if (r.stock_management && (r.quantity === null || isNaN(r.quantity) || r.quantity < 0)) {
            errors.push({ field: 'Quantity', message: 'Quantity must be a non-negative integer when Stock Management is TRUE and no variants are defined.' });
        }

        // Shipping class: an invalid / unknown id is ignored (not a hard error).
        if (r.shipping_class_id && !shippingClassMap.has(r.shipping_class_id)) r.shipping_class_id = null;

        /* ── Stage 6 & 7: Save ── */
        const hasErrors = errors.length > 0;

        if (!hasErrors) {
            /* VALID ROW — generate slugs and save */
            try {
                const effectiveStatus = resolveBulkStatus(r.status, { vendor, bypassApproval });

                let slug_en = undefined;
                let slug_ar = undefined;
                // Also for `pending`, not just `published`: the approve route sets the status
                // and nothing else, so a product that reached the queue without a slug would
                // come out of it live and unreachable.
                if (effectiveStatus !== 'draft') {
                    slug_en = hasEnSet ? await generateSlug(r.title_en, vendorName, 'en') : undefined;
                    slug_ar = hasArSet ? await generateSlug(r.title_ar, vendorName, 'ar') : undefined;
                }

                // Link variant IDs
                if (r.variation_types.length > 0 && r.variants.length > 0) {
                    linkVariantIds(r.variation_types, r.variants);
                }

                const doc = new Product({
                    vendor_id: vendorId,
                    sku: r.sku,
                    part_number: r.part_number,
                    gtin: r.gtin,
                    part_type: r.part_type,
                    title_en: r.title_en,
                    subtitle_en: r.subtitle_en,
                    description_en: r.description_en,
                    title_ar: r.title_ar,
                    subtitle_ar: r.subtitle_ar,
                    description_ar: r.description_ar,
                    slug_en,
                    slug_ar,
                    price: r.price,
                    discount_type: r.discount_type,
                    discount_value: r.discount_value,
                    status: effectiveStatus,
                    // A row only REACHES `published` through an admin: either this is the
                    // admin's own upload, or an admin turned on `auto_publish_products` for
                    // this store. Both are an approval, so the approved marker has to be set
                    // with it. Leaving it false is what produced 13 products that were live
                    // on the storefront while every report of unapproved work said there
                    // were none.
                    is_published: effectiveStatus === 'published',
                    category_id: r.category_id,
                    product_brand_id: r.product_brand_id,
                    is_universal: r.is_universal,
                    compatible_cars: r.compatible_cars,
                    stock_management: r.stock_management,
                    quantity: r.quantity,
                    stock_status: r.stock_status,
                    images: r.images,
                    variation_types: r.variation_types,
                    variants: r.variants,
                    weight: r.weight,
                    dimensions: r.dimensions,
                    shipping_class_id: r.shipping_class_id || null,
                    for_girls: !!r.for_girls,
                    for_trunk: !!r.for_trunk,
                });

                await doc.save();

                // Same rule as the single-add path: a matched row links to its
                // entry, an unmatched row mints a suggestion. Never inside the
                // save — a catalog failure must not turn a saved product into a
                // reported failure.
                await catalogService.linkProductAfterSave(doc, vendorId, r.catalog_entry_id);

                succeeded.push({
                    row: r._rowNum,
                    _id: doc._id,
                    title: r.title_en || r.title_ar,
                    sku: r.sku,
                });
            } catch (dbErr) {
                // DB-level errors (e.g. duplicate SKU) — treat as failure, no draft saved
                failed.push({
                    row: r._rowNum,
                    sku: r.sku || '',
                    title: r.title_en || r.title_ar || '',
                    errors: [{ field: 'Database', message: dbErr.message }],
                    savedAsDraft: false,
                });
            }
        } else {
            /* INVALID ROW — save as draft with whatever safe data we have */
            let draftId = null;
            let savedAsDraft = false;

            try {
                // Only include fields that passed individual validations
                const draftData = {
                    vendor_id: vendorId,
                    status: 'draft',
                    for_girls: !!r.for_girls,
                    for_trunk: !!r.for_trunk,
                    // NO slug generation for drafts
                };

                if (r.sku) draftData.sku = r.sku;
                if (r.part_number) draftData.part_number = r.part_number;
                if (r.gtin) draftData.gtin = r.gtin;
                if (r.part_type) draftData.part_type = r.part_type;
                if (r.price > 0) draftData.price = r.price;
                // Keep the discount only when it is self-consistent — normalizePricing
                // nulls discount_price for anything it rejected.
                if (r.discount_type && r.discount_price !== null) {
                    draftData.discount_type = r.discount_type;
                    draftData.discount_value = r.discount_value;
                    // Drafts save with validateBeforeSave:false, which skips the
                    // model hook — so carry the already-derived price across.
                    draftData.discount_price = r.discount_price;
                }
                if (r.title_en) draftData.title_en = r.title_en;
                if (r.subtitle_en) draftData.subtitle_en = r.subtitle_en;
                if (r.description_en) draftData.description_en = r.description_en;
                if (r.title_ar) draftData.title_ar = r.title_ar;
                if (r.subtitle_ar) draftData.subtitle_ar = r.subtitle_ar;
                if (r.description_ar) draftData.description_ar = r.description_ar;
                if (r.category_id && categoryMap.has(r.category_id)) draftData.category_id = r.category_id;
                if (r.product_brand_id && brandMap.has(r.product_brand_id)) draftData.product_brand_id = r.product_brand_id;
                if (r.images.length > 0) draftData.images = r.images;
                if (r.variation_types.length > 0) draftData.variation_types = r.variation_types;

                if (r.quantity !== null && !isNaN(r.quantity)) draftData.quantity = r.quantity;
                if (r.stock_management !== null) draftData.stock_management = r.stock_management;
                if (r.stock_status) draftData.stock_status = r.stock_status;
                if (r.weight !== null) draftData.weight = r.weight;
                if (r.dimensions) draftData.dimensions = r.dimensions;
                if (r.shipping_class_id) draftData.shipping_class_id = new mongoose.Types.ObjectId(r.shipping_class_id);

                // Compatibility
                const carFieldErrors = errors.some(e => e.field === 'Compatible Cars');
                if (r.is_universal !== null && !carFieldErrors) {
                    draftData.is_universal = r.is_universal;
                    if (r.is_universal === false && r.compatible_cars.length > 0) {
                        draftData.compatible_cars = r.compatible_cars;
                    }
                } else {
                    // Safe fallback: mark universal so save doesn't fail schema validation
                    draftData.is_universal = true;
                }

                // Ensure minimum identifiers exist for save
                if (!draftData.sku) draftData.sku = `DRAFT-${Date.now().toString(36).toUpperCase()}`;
                if (!draftData.price) draftData.price = 0;
                // Need at least one slug placeholder to pass model validation
                // Since drafts have no slug, we use validateBeforeSave: false
                if (!draftData.category_id) delete draftData.category_id;
                if (!draftData.product_brand_id) delete draftData.product_brand_id;

                // Need category and brand as ObjectIds to avoid cast errors
                if (draftData.category_id) draftData.category_id = new mongoose.Types.ObjectId(draftData.category_id);
                if (draftData.product_brand_id) draftData.product_brand_id = new mongoose.Types.ObjectId(draftData.product_brand_id);

                // A failed row keeps a link it was explicitly matched to, but never
                // mints a suggestion: the data that just failed validation is the
                // last thing the admin review queue needs.
                if (r.catalog_entry_id && !r._catalog_duplicate) {
                    draftData.catalog_entry_id = new mongoose.Types.ObjectId(r.catalog_entry_id);
                }

                const draft = new Product(draftData);
                await draft.save({ validateBeforeSave: false });
                draftId = draft._id;
                savedAsDraft = true;
            } catch (draftErr) {
                console.error(`[BulkUpload] Could not save draft for row ${r._rowNum}:`, draftErr.message);
            }

            failed.push({
                row: r._rowNum,
                sku: r.sku || '',
                title: r.title_en || r.title_ar || '',
                errors,
                savedAsDraft,
                draftId,
            });
        }
    }

    shippingEngine.invalidateShippingCache();
    return { succeeded, failed };
}

/* ─────────────────────────────────────────────────────────────
   detectLayout — 'current' (Discount Type + Discount Value) or 'legacy'
   (a single Discount Price column). Read from the header row so a stale
   working copy of the template still imports instead of silently shifting
   every column after PRICING by one.
   ───────────────────────────────────────────────────────────── */
function detectLayout(raw) {
    const header = raw[HEADER_ROW] || [];
    const at = (i) => String(header[i] ?? '').trim().toLowerCase();

    // New layout: the value column sits where Status used to be.
    if (at(COL.DISCOUNT_VALUE).includes('discount value') || at(COL.DISCOUNT_VALUE).includes('قيمة الخصم')) return 'current';
    if (at(COL.DISCOUNT_TYPE).includes('discount type') || at(COL.DISCOUNT_TYPE).includes('نوع الخصم')) return 'current';

    // Old layout: a single "Discount Price" / "سعر الخصم" column.
    const legacyHeader = at(LEGACY_COL.LEGACY_DISCOUNT_PRICE);
    if (legacyHeader.includes('discount price') || legacyHeader.includes('سعر الخصم')) return 'legacy';

    // Header missing or renamed — assume the current template.
    return 'current';
}

/* ─────────────────────────────────────────────────────────────
   MAIN: processBulkUpload — Excel entry point. Parses the workbook, coerces
   each row into the structured shape, then delegates to processRows.
   ───────────────────────────────────────────────────────────── */
async function parseWorkbook(fileBuffer, vendorId) {

    /* ── Stage 1: File Validation ── */
    let workbook;
    try {
        workbook = XLSX.read(fileBuffer, { type: 'buffer', cellText: true, cellDates: false, raw: false });
    } catch (e) {
        throw new Error('Invalid .xlsx file — could not parse the workbook.');
    }

    if (!workbook.SheetNames.includes('Products')) {
        throw new Error('Sheet named "Products" not found in the uploaded file.');
    }

    const sheet = workbook.Sheets['Products'];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

    // Which template generation is this? Column 11 (0-based 10) holds the single
    // "Discount Price" in the old layout and "Discount Type" in the new one.
    const layout = detectLayout(raw);
    const C = layout === 'legacy' ? LEGACY_COL : COL;

    const dataRows = raw.slice(DATA_START_ROW).filter(row => {
        // Skip fully empty rows
        return row.some(cell => String(cell).trim() !== '');
    });

    if (dataRows.length === 0) throw new Error('No data rows found (data must start at row 6).');

    /* ── Reference data (vendor + dropdown name → ID resolution) ── */
    const refs = await buildReferenceData(vendorId);
    const { resolveRef, categoryNameToId, brandNameToId, shippingNameToId } = refs;

    const coercedRows = dataRows.map((row, idx) => {
        const cat   = resolveRef(cellStr(row, C.CATEGORY_ID), categoryNameToId);
        const brand = resolveRef(cellStr(row, C.PRODUCT_BRAND_ID), brandNameToId);
        const ship  = resolveRef(cellStr(row, C.SHIPPING_CLASS_ID), shippingNameToId);
        const r = {
            _rowNum: idx + 6, // Excel row number (1-based, header is rows 1-5)
            sku: cellStr(row, C.SKU),
            part_number: cellStr(row, C.PART_NUMBER),
            gtin: cellStr(row, C.GTIN),
            part_type: normalizePartType(cellStr(row, C.PART_TYPE)),
            part_type_raw: cellStr(row, C.PART_TYPE),
            title_en: cellStr(row, C.TITLE_EN),
            subtitle_en: cellStr(row, C.SUBTITLE_EN),
            description_en: cellStr(row, C.DESCRIPTION_EN),
            title_ar: cellStr(row, C.TITLE_AR),
            subtitle_ar: cellStr(row, C.SUBTITLE_AR),
            description_ar: cellStr(row, C.DESCRIPTION_AR),
            price: parseFloat(cellStr(row, C.PRICE)) || null,
            status: (cellStr(row, C.STATUS) || 'draft').toLowerCase(),
            category_id: cat.id,
            category_raw: cat.raw,
            product_brand_id: brand.id,
            product_brand_raw: brand.raw,
            is_universal: parseBool(cellStr(row, C.IS_UNIVERSAL)),
            stock_management: parseBool(cellStr(row, C.STOCK_MANAGEMENT)),
            quantity: cellStr(row, C.QUANTITY) !== null ? parseInt(cellStr(row, C.QUANTITY), 10) : null,
            stock_status: (cellStr(row, C.STOCK_STATUS) || 'instock').toLowerCase().replace(/\s+/g, ''),
            weight: cellStr(row, C.WEIGHT) !== null ? parseFloat(cellStr(row, C.WEIGHT)) : null,
            dimensions: parseDimensions(cellStr(row, C.DIMENSIONS)),
            shipping_class_id: ship.id,
            shipping_class_raw: ship.raw,
            for_girls: false,
            for_trunk: false,
        };

        /* Discount: the type/value pair in the current template; a single sale
           price in a legacy sheet, converted to the equivalent fixed amount. */
        if (layout === 'legacy') {
            const salePrice = cellStr(row, C.LEGACY_DISCOUNT_PRICE) ? parseFloat(cellStr(row, C.LEGACY_DISCOUNT_PRICE)) : null;
            const usable = Number.isFinite(salePrice) && Number.isFinite(r.price);
            r.discount_type = usable ? 'fixed' : null;
            r.discount_value = usable ? round2(r.price - salePrice) : null;
        } else {
            const rawValue = cellStr(row, C.DISCOUNT_VALUE);
            r.discount_type = normalizeDiscountType(cellStr(row, C.DISCOUNT_TYPE));
            r.discount_value = rawValue !== null ? parseFloat(rawValue) : null;
            flagValueWithoutType(r);
        }

        if (r.stock_management === null) r.stock_management = true;
        if (!['draft', 'published'].includes(r.status)) r.status = 'draft';
        if (r.weight !== null && (!Number.isFinite(r.weight) || r.weight < 0)) r.weight = null;

        // Structure the complex fields from their raw strings (so processRows
        // receives fully-structured rows, like the JSON path).
        r.compatible_cars = parseCompatibleCars(cellStr(row, C.COMPATIBLE_CARS));
        r.variation_types = parseVariationTypes(cellStr(row, C.VARIATION_TYPES));
        r.variants = parseVariants(cellStr(row, C.VARIANTS), r.variation_types);
        convertLegacyVariantDiscounts(r.variants, r.price);
        r.images = parseImages(cellStr(row, C.IMAGE_URLS));

        return r;
    });

    const carBrandMap = await buildCarBrandMap(coercedRows);
    return { coercedRows, refs: { ...refs, carBrandMap } };
}

/* ─────────────────────────────────────────────────────────────
   processBulkUpload — parse an uploaded workbook and save every row.

   The vendor-facing flow no longer calls this directly: the upload page runs
   previewBulkUpload first so the vendor can review the catalog links, and then
   saves through processBulkJsonUpload. It stays as the one-shot path for the
   admin importer and for any caller that has no review step.
   ───────────────────────────────────────────────────────────── */
async function processBulkUpload(fileBuffer, vendorId, options = {}) {
    const { coercedRows, refs } = await parseWorkbook(fileBuffer, vendorId);
    return processRows(coercedRows, vendorId, refs, options);
}

/* ─────────────────────────────────────────────────────────────
   previewBulkUpload — parse a workbook WITHOUT saving anything, and propose a
   catalog entry per row.

   This is what makes the "Review links" screen possible with an unchanged
   template: the file carries no entry column, so the match is computed here from
   part number, GTIN, brand and title, and the vendor confirms it. The rows come
   back in exactly the shape processBulkJsonUpload accepts, so the confirmed set
   is posted straight back with each row's chosen `catalog_entry_id`.
   ───────────────────────────────────────────────────────────── */
async function previewBulkUpload(fileBuffer, vendorId) {
    const { coercedRows } = await parseWorkbook(fileBuffer, vendorId);
    const catalogService = require('./catalogService');
    const proposals = await catalogService.proposeEntriesForRows(coercedRows);

    const rows = coercedRows.map((r, index) => {
        const proposal = proposals.get(index) || null;
        return {
            row: r._rowNum,
            // The row itself, ready to post back untouched. `_rowNum` is dropped:
            // processBulkJsonUpload re-derives row numbers from array order.
            data: (({ _rowNum, _discount_value_without_type, ...rest }) => rest)(r),
            // What the vendor wrote, for the left-hand side of the review row.
            summary: {
                sku: r.sku || '',
                title: r.title_en || r.title_ar || '',
                part_number: r.part_number || '',
                part_type: r.part_type || null,
                price: r.price,
            },
            match: proposal
                ? {
                    entry_id: String(proposal.entry._id),
                    title: proposal.entry.title_en || proposal.entry.title_ar || '',
                    image: proposal.entry.images?.[0]?.url || null,
                    category: proposal.entry.category_id?.name || null,
                    brand: proposal.entry.product_brand_id?.name || null,
                    status: proposal.entry.status,
                    reason: proposal.reason,
                }
                : null,
        };
    });

    return {
        rows,
        counters: {
            total: rows.length,
            matched: rows.filter((r) => r.match).length,
            unmatched: rows.filter((r) => !r.match).length,
        },
    };
}

/* ─────────────────────────────────────────────────────────────
   processBulkJsonUpload — Web-grid entry point. Accepts an array of
   single-product-form-shaped objects (IDs + already-structured sub-objects),
   maps them into the structured row shape, then delegates to processRows.
   ───────────────────────────────────────────────────────────── */
async function processBulkJsonUpload(products, vendorId, { maxProducts = 200, ...options } = {}) {
    if (!Array.isArray(products) || products.length === 0) {
        throw new Error('No products provided.');
    }
    // The grid caps itself at 200 rows. A reviewed Excel file has no such ceiling
    // — the template promises no product-count limit — so that caller raises it.
    if (products.length > maxProducts) {
        throw new Error(`Too many products: ${products.length}. Maximum is ${maxProducts} per submission.`);
    }

    const refs = await buildReferenceData(vendorId);

    const str = (v) => {
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        return s === '' ? null : s;
    };
    const validId = (v) => {
        const s = str(v);
        return s && mongoose.Types.ObjectId.isValid(s) ? s : null;
    };
    const numOrNull = (v) => {
        if (v === '' || v === null || v === undefined) return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    };

    const coercedRows = products.map((p, idx) => {
        const r = {
            _rowNum: idx + 1, // 1-based grid row index
            sku: str(p.sku),
            part_number: str(p.part_number),
            gtin: str(p.gtin),
            part_type: normalizePartType(p.part_type),
            part_type_raw: str(p.part_type_raw ?? p.part_type),
            title_en: str(p.title_en),
            subtitle_en: str(p.subtitle_en),
            description_en: str(p.description_en),
            title_ar: str(p.title_ar),
            subtitle_ar: str(p.subtitle_ar),
            description_ar: str(p.description_ar),
            price: numOrNull(p.price),
            discount_type: normalizeDiscountType(p.discount_type),
            discount_value: numOrNull(p.discount_value),
            status: ['draft', 'published'].includes(p.status) ? p.status : 'draft',
            category_id: validId(p.category_id),
            category_raw: str(p.category_id) || '',
            product_brand_id: validId(p.product_brand_id),
            product_brand_raw: str(p.product_brand_id) || '',
            is_universal: typeof p.is_universal === 'boolean' ? p.is_universal : null,
            stock_management: typeof p.stock_management === 'boolean' ? p.stock_management : true,
            quantity: p.quantity === '' || p.quantity === null || p.quantity === undefined ? null : parseInt(p.quantity, 10),
            stock_status: (str(p.stock_status) || 'instock').toLowerCase().replace(/\s+/g, ''),
            weight: numOrNull(p.weight),
            dimensions: normalizeDimensions(p.dimensions),
            shipping_class_id: validId(p.shipping_class_id),
            shipping_class_raw: str(p.shipping_class_id) || '',
            for_girls: !!p.for_girls,
            for_trunk: !!p.for_trunk,
            // The catalog entry this row was matched to (Excel review screen) or
            // picked from (grid popup). Null means "the vendor authored this from
            // scratch" and a suggestion is minted for it after the save.
            catalog_entry_id: validId(p.catalog_entry_id),
            // already-structured complex fields (pass through)
            compatible_cars: Array.isArray(p.compatible_cars) ? p.compatible_cars : [],
            images: Array.isArray(p.images) ? p.images : [],
            variation_types: Array.isArray(p.variation_types) ? p.variation_types : [],
            variants: Array.isArray(p.variants) ? p.variants : [],
        };
        if (r.weight !== null && (!Number.isFinite(r.weight) || r.weight < 0)) r.weight = null;
        flagValueWithoutType(r);
        return r;
    });

    const carBrandMap = await buildCarBrandMap(coercedRows);
    return processRows(coercedRows, vendorId, { ...refs, carBrandMap }, options);
}

/* ─────────────────────────────────────────────────────────────
   generateBulkUploadTemplate — delegates to templateGenerator
   ───────────────────────────────────────────────────────────── */
async function generateBulkUploadTemplate(lang = 'en') {
    const { generateBulkUploadTemplate: gen } = require('./templateGenerator');
    return gen(lang);
}

module.exports = { processBulkUpload, previewBulkUpload, processBulkJsonUpload, generateBulkUploadTemplate };
