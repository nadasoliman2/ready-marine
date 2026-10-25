// Product discount pricing — the client-side mirror of
// Backend/services/shared/productPricing.js.
//
// Sellers enter a regular `price` plus, optionally, a discount described by a
// TYPE ('fixed' | 'percentage') and a VALUE. The sale price shown to customers
// is derived from those three and is never typed by hand — the backend is the
// authority, these helpers only drive the live preview and the inline errors so
// a seller sees the problem before submitting.
//
// Keep the rules here in step with the backend module; they are deliberately
// the same rules, expressed twice, because the form must explain a rejection
// before the request is made.

export const DISCOUNT_TYPES = ['fixed', 'percentage'];

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/** '' / null / undefined → null; otherwise a finite Number or null. */
export function numOrNull(v) {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/** The discounted price, or null when there is no valid discount. */
export function computeDiscountPrice(price, discountType, discountValue) {
    const base = numOrNull(price);
    const value = numOrNull(discountValue);
    if (!DISCOUNT_TYPES.includes(discountType)) return null;
    if (base === null || value === null || value <= 0) return null;

    const final = discountType === 'percentage' ? base * (1 - value / 100) : base - value;
    if (!Number.isFinite(final) || final <= 0 || final >= base) return null;
    return round2(final);
}

/**
 * @returns {string|null} a seller-facing error, or null when the discount is
 *          valid (including "no discount at all").
 */
export function validateDiscount(price, discountType, discountValue, isAr = false) {
    const base = numOrNull(price);
    const value = numOrNull(discountValue);

    if (!discountType) return null;
    if (!DISCOUNT_TYPES.includes(discountType)) {
        return isAr ? 'نوع خصم غير صالح.' : 'Invalid discount type.';
    }
    if (value === null || value <= 0) {
        return isAr ? 'أدخل قيمة خصم أكبر من صفر.' : 'Enter a discount value greater than zero.';
    }
    if (discountType === 'percentage') {
        return value >= 100
            ? (isAr ? 'النسبة يجب أن تكون أقل من 100%.' : 'The percentage must be less than 100%.')
            : null;
    }
    if (base === null || base <= 0) {
        return isAr ? 'أدخل السعر أولاً.' : 'Enter the price first.';
    }
    return value >= base
        ? (isAr ? 'مبلغ الخصم يجب أن يكون أقل من السعر.' : 'The discount amount must be less than the price.')
        : null;
}

/** Short human label for a discount, e.g. "20% off" / "QAR 15 off". */
export function discountLabel(discountType, discountValue, currency = '', isAr = false) {
    const value = numOrNull(discountValue);
    if (!DISCOUNT_TYPES.includes(discountType) || value === null || value <= 0) return '';
    if (discountType === 'percentage') return isAr ? `خصم ${value}%` : `${value}% off`;
    return isAr ? `خصم ${currency} ${value}` : `${currency} ${value} off`;
}

/**
 * ---------------------------------------------------------------------------
 * Display side
 * ---------------------------------------------------------------------------
 * What every card / price block renders, resolved in ONE place so the two
 * figures can never come out the wrong way round.
 *
 * The charged price is `discount_price ?? price` — that is what the cart, the
 * orders and the Mongo aggregations all resolve, so the shown price must be
 * exactly that and nothing else. The regular price is only struck through when
 * it is genuinely HIGHER than what will be charged. Legacy rows written before
 * `normalizePricing()` can still hold discount_price >= price (see
 * Backend/scripts/fixInvertedProductDiscounts.js); those used to render as a
 * high "sale" price with a lower price crossed out next to it. Here they simply
 * render as a single plain price until the data is repaired.
 */

/**
 * @returns {{price:number, original:number, hasDiscount:boolean, discountPct:number|null}}
 *          `price` is what the customer pays; `original` is only meaningful —
 *          and only ever larger — when `hasDiscount` is true.
 */
export function resolvePricing(price, discountPrice) {
    const regular = numOrNull(price);
    const sale = numOrNull(discountPrice);
    const effective = sale !== null ? sale : regular;

    if (effective === null) return { price: 0, original: 0, hasDiscount: false, discountPct: null };
    if (regular === null || effective >= regular) {
        return { price: effective, original: effective, hasDiscount: false, discountPct: null };
    }
    return {
        price: effective,
        original: regular,
        hasDiscount: true,
        discountPct: Math.round(((regular - effective) / regular) * 100),
    };
}

/**
 * Pricing for one variant. A variant's price is an absolute override, not a
 * modifier, and a variant with no discount of its own inherits the product's —
 * the same fallbacks every read path already uses.
 */
export function variantPricing(product = {}, variant = null) {
    if (!variant) return resolvePricing(product.price, product.discount_price ?? null);
    return resolvePricing(
        variant.price != null ? variant.price : product.price,
        variant.discount_price != null ? variant.discount_price : (product.discount_price ?? null),
    );
}

/**
 * Pricing for a product card: the cheapest variant when the product has any
 * ("From QAR …"), otherwise the product's own.
 */
export function cardPricing(product = {}) {
    const variants = product.variants || [];
    if (!variants.length) return { ...variantPricing(product, null), hasVariants: false };

    let cheapest = null;
    for (const variant of variants) {
        const pricing = variantPricing(product, variant);
        if (!cheapest || pricing.price < cheapest.price) cheapest = pricing;
    }
    return { ...(cheapest || variantPricing(product, null)), hasVariants: true };
}

/** Read the pricing fields off a product/variant into form state. */
export function pricingFormValues(source = {}) {
    return {
        discount_type: source.discount_type || '',
        discount_value: source.discount_value ?? '',
    };
}

/** Form state → API payload ('' type means "no discount"). */
export function pricingPayload(form = {}) {
    const type = DISCOUNT_TYPES.includes(form.discount_type) ? form.discount_type : null;
    return {
        discount_type: type,
        discount_value: type ? numOrNull(form.discount_value) : null,
    };
}
