/**
 * Product discount pricing — shared by every write path (vendor form, admin
 * form, Excel bulk upload, online bulk grid, seeders).
 *
 * A product is priced with THREE inputs the seller actually types:
 *
 *   price           the regular price
 *   discount_type   'fixed' | 'percentage' | null  (null = no discount)
 *   discount_value  the amount off (currency) or the percent off (0–100)
 *
 * `discount_price` is NOT an input any more — it is DERIVED from those three
 * and stored alongside them. It stays in the schema on purpose: every read path
 * in the platform (storefront cards, product page, cart, orders, shipping
 * bands, bundles, the Mongo aggregations in productService) already resolves an
 * effective price through `discount_price ?? price`, and those must keep
 * working untouched. Storing the derived value also keeps it sortable and
 * filterable in Mongo, which a computed-on-read field could not be.
 *
 * The rule that follows from that: NOTHING may write `discount_price` directly.
 * Every writer calls `normalizePricing()` (or lets the model's pre-validate
 * hook do it) so the stored value can never drift from the type/value pair.
 *
 * Variants follow the same shape. A variant's discount applies to the variant's
 * own effective price (`variant.price ?? product.price`). A variant with no
 * discount_type keeps `discount_price: null`, which preserves the pre-existing
 * fallback behaviour in the read paths (a variant with no price and no discount
 * inherits the product's discount_price).
 */

const DISCOUNT_TYPES = ['fixed', 'percentage'];

/** Money rounding — 2 decimals, avoiding float dust like 39.989999999999995. */
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** '' / null / undefined → null; otherwise a finite Number or null. */
const numOrNull = (v) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/**
 * Normalize a raw discount_type coming from a form, a JSON body or a
 * spreadsheet cell. Anything that is not a known type — including the explicit
 * "no discount" values a dropdown may send — becomes null.
 */
function normalizeDiscountType(raw) {
    if (raw === null || raw === undefined) return null;
    const s = String(raw).trim().toLowerCase();
    if (s === '' || s === 'none' || s === 'no' || s === 'null') return null;
    if (s === 'percent' || s === 'percentage' || s === '%') return 'percentage';
    if (s === 'fixed' || s === 'amount') return 'fixed';
    return String(raw).trim(); // kept as-is so validation can report it
}

/**
 * The discounted price for a given base price and discount, or null when there
 * is no discount. Returns null (rather than throwing) for invalid input — the
 * caller validates separately and reports a field error.
 */
function computeDiscountPrice(price, discountType, discountValue) {
    const base = numOrNull(price);
    const value = numOrNull(discountValue);
    if (!DISCOUNT_TYPES.includes(discountType)) return null;
    if (base === null || value === null || value <= 0) return null;

    const final = discountType === 'percentage'
        ? base * (1 - value / 100)
        : base - value;

    // A discount may never zero out or exceed the price — those are rejected by
    // validateDiscount, and refused here too so no caller can bypass it.
    if (!Number.isFinite(final) || final <= 0 || final >= base) return null;
    return round2(final);
}

/**
 * Validate a discount against its base price.
 * @returns {string|null} an error message, or null when the discount is valid
 *          (including the "no discount at all" case).
 */
function validateDiscount(price, discountType, discountValue, { isAr = false } = {}) {
    const base = numOrNull(price);
    const value = numOrNull(discountValue);

    if (discountType === null) {
        return null; // no discount — discount_value is ignored
    }
    if (!DISCOUNT_TYPES.includes(discountType)) {
        return isAr
            ? 'نوع الخصم يجب أن يكون "fixed" (مبلغ ثابت) أو "percentage" (نسبة مئوية).'
            : 'Discount type must be either "fixed" or "percentage".';
    }
    if (value === null || value <= 0) {
        return isAr
            ? 'قيمة الخصم مطلوبة ويجب أن تكون أكبر من صفر عند اختيار نوع خصم.'
            : 'Discount value is required and must be greater than zero when a discount type is set.';
    }
    if (discountType === 'percentage') {
        if (value >= 100) {
            return isAr
                ? 'نسبة الخصم يجب أن تكون أقل من 100%.'
                : 'Discount percentage must be less than 100%.';
        }
        return null;
    }
    // fixed
    if (base === null || base <= 0) {
        return isAr
            ? 'يجب تحديد سعر صحيح قبل إضافة خصم بمبلغ ثابت.'
            : 'A valid price is required before a fixed discount can be applied.';
    }
    if (value >= base) {
        return isAr
            ? 'مبلغ الخصم يجب أن يكون أقل من السعر.'
            : 'The fixed discount amount must be less than the price.';
    }
    return null;
}

/**
 * Normalize the pricing fields of ONE object (a product or a variant) in place:
 * coerces the type/value pair and (re)derives `discount_price`.
 *
 * `basePrice` is the price the discount applies to — the object's own price for
 * a product, or `variant.price ?? product.price` for a variant.
 *
 * Only touches the object when it actually carries pricing input, so a partial
 * update (`PUT` with just a title) never wipes an existing discount.
 *
 * @returns {boolean} true when the object carried discount input at all.
 */
function normalizePricingFields(target, basePrice) {
    if (!target || typeof target !== 'object') return false;

    const hasTypeInput = Object.prototype.hasOwnProperty.call(target, 'discount_type');
    const hasValueInput = Object.prototype.hasOwnProperty.call(target, 'discount_value');
    if (!hasTypeInput && !hasValueInput) return false;

    const type = normalizeDiscountType(target.discount_type);
    const value = numOrNull(target.discount_value);

    if (type === null) {
        target.discount_type = null;
        target.discount_value = null;
        target.discount_price = null;
        return true;
    }

    target.discount_type = type;
    target.discount_value = value;
    target.discount_price = computeDiscountPrice(basePrice, type, value);
    return true;
}

/**
 * Normalize a whole product payload (product-level pricing + every variant) and
 * collect human-readable validation errors.
 *
 * On an UPDATE, pass the stored document as `existing`. Two things depend on it:
 *   • a payload that changes only the discount is validated against the stored
 *     price, and
 *   • a payload that changes only the price re-derives the stored discount, so
 *     `discount_price` can never be left describing the old price (which is how
 *     a percentage discount would silently go wrong).
 *
 * @param {object} data      product payload — mutated in place
 * @param {object} [options]
 * @param {object} [options.existing]  stored product (update paths only)
 * @param {boolean} [options.isAr]     Arabic error messages
 * @returns {Array<{field: string, message: string}>} validation errors
 */
function normalizePricing(data, { existing = null, isAr = false } = {}) {
    const errors = [];
    if (!data || typeof data !== 'object') return errors;

    const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
    const priceChanging = has(data, 'price') && data.price !== '';
    const basePrice = priceChanging ? numOrNull(data.price) : numOrNull(existing?.price);

    // Price moved but the discount was not re-sent → carry the stored discount
    // in so it is recomputed against the new price.
    if (existing && priceChanging && !has(data, 'discount_type') && !has(data, 'discount_value')) {
        data.discount_type = existing.discount_type ?? null;
        data.discount_value = existing.discount_value ?? null;
    }

    if (normalizePricingFields(data, basePrice)) {
        const err = validateDiscount(basePrice, data.discount_type, data.discount_value, { isAr });
        if (err) errors.push({ field: 'Discount', message: err });
    }

    // Same carry-forward for variants: a base-price change moves the effective
    // price of every variant that does not override it.
    if (existing && priceChanging && !Array.isArray(data.variants) && Array.isArray(existing.variants) && existing.variants.length > 0) {
        data.variants = existing.variants.map(v => ({
            ...(typeof v.toObject === 'function' ? v.toObject() : v),
        }));
    }

    if (Array.isArray(data.variants)) {
        data.variants.forEach((variant, i) => {
            const variantPrice = numOrNull(variant?.price);
            const effectivePrice = variantPrice !== null ? variantPrice : basePrice;
            if (normalizePricingFields(variant, effectivePrice)) {
                const err = validateDiscount(effectivePrice, variant.discount_type, variant.discount_value, { isAr });
                if (err) {
                    errors.push({
                        field: 'Variants',
                        message: isAr ? `التنويع رقم ${i + 1}: ${err}` : `Variant ${i + 1}: ${err}`,
                    });
                }
            }
        });
    }

    return errors;
}

module.exports = {
    DISCOUNT_TYPES,
    round2,
    normalizeDiscountType,
    computeDiscountPrice,
    validateDiscount,
    normalizePricingFields,
    normalizePricing,
};
