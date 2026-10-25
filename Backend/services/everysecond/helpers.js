/**
 * Pure helpers for the EverySecond chat-commerce integration
 * (Backend/docs/EVERYSECOND_CHAT_COMMERCE.md).
 *
 * No database and no network here, so every rule can be tested on its own:
 * how a product becomes a menu item on the agent, how a webhook is verified,
 * how the address a customer gave in chat becomes a shipping destination, and
 * which of our order statuses the customer is told about.
 */
const crypto = require('crypto');

/* ------------------------------------------------------------------ */
/* Ids                                                                 */
/* ------------------------------------------------------------------ */

/*
 * The id EverySecond knows each sellable row by — the product's own _id, plus
 * "~" and the variant's _id for a product with variants. Both are ObjectIds, so
 * the id is URL-safe and never changes when a vendor renames the product or its
 * slug, which keeps carts and past orders on EverySecond pointing at the same
 * row.
 */
const SEPARATOR = '~';
const OBJECT_ID = /^[a-f0-9]{24}$/;

const toExternalId = (productId, variantId = null) => {
    const p = String(productId || '').toLowerCase();
    return variantId ? `${p}${SEPARATOR}${String(variantId).toLowerCase()}` : p;
};

/** `{ productId, variantId }`, or null when the id is not one of ours. */
const parseExternalId = (externalId) => {
    const raw = String(externalId || '').trim().toLowerCase();
    const [productId, variantId = null, ...rest] = raw.split(SEPARATOR);
    if (rest.length || !OBJECT_ID.test(productId) || (variantId !== null && !OBJECT_ID.test(variantId))) return null;
    return { productId, variantId };
};

/* ------------------------------------------------------------------ */
/* Webhook signature                                                   */
/* ------------------------------------------------------------------ */

/** HMAC-SHA256 over "<t>.<raw body>" — what X-EverySecond-Signature carries as v1. */
const signBody = (secret, t, rawBody) => crypto
    .createHmac('sha256', String(secret))
    .update(Buffer.concat([Buffer.from(`${t}.`), Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''))]))
    .digest('hex');

/**
 * `X-EverySecond-Signature: t=<unix>,v1=<hex>[,v1=<hex>]`. For a day after the
 * endpoint secret is rotated the header carries one v1 per secret; any match
 * is enough. A replay older than the tolerance is refused even when genuine.
 */
const verifySignature = ({ header, rawBody, secret, toleranceSeconds = 300, now = Date.now() }) => {
    if (!secret || !header) return false;
    let t = null;
    const signatures = [];
    for (const part of String(header).split(',')) {
        const [k, v = ''] = part.trim().split('=');
        if (k === 't') t = Number.parseInt(v, 10);
        if (k === 'v1' && /^[0-9a-f]+$/i.test(v)) signatures.push(v);
    }
    if (!Number.isFinite(t) || !signatures.length) return false;
    if (Math.abs(now / 1000 - t) > toleranceSeconds) return false;
    const expected = Buffer.from(signBody(secret, t, rawBody), 'hex');
    return signatures.some((sig) => {
        const received = Buffer.from(sig, 'hex');
        return received.length === expected.length && crypto.timingSafeEqual(received, expected);
    });
};

/* ------------------------------------------------------------------ */
/* Catalogue → menu items                                              */
/* ------------------------------------------------------------------ */

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const text = (v) => String(v ?? '').trim();
const httpsOnly = (url) => (/^https:\/\/[^\s"'<>]+$/i.test(text(url)) ? text(url) : undefined);

const bilingual = (en, ar) => {
    const value = {};
    if (text(en)) value.en = text(en);
    if (text(ar)) value.ar = text(ar);
    return Object.keys(value).length ? value : undefined;
};

const variantLabelOf = (variant) => (variant?.selected_options || [])
    .map((o) => text(o.option_value))
    .filter(Boolean)
    .join(' / ');

/*
 * EverySecond refuses a name over 255 characters, and a few vendor titles are
 * whole spec sheets. The title is cut — never the variant label, which is what
 * tells two rows of the same product apart.
 */
const MAX_NAME = 255;
const nameOf = (title, label) => {
    const suffix = label ? ` (${label})` : '';
    const room = Math.max(20, MAX_NAME - suffix.length);
    const cut = title.length > room ? `${title.slice(0, room - 1).trimEnd()}…` : title;
    return `${cut}${suffix}`.slice(0, MAX_NAME);
};

/** What one row sells for, and its list price — the same rule as the cart and orderService. */
const pricesOf = (product, variant) => {
    const list = Number(variant ? (variant.price ?? product.price) : product.price);
    const unit = Number(variant
        ? ((variant.discount_price ?? variant.price) ?? (product.discount_price ?? product.price))
        : (product.discount_price ?? product.price));
    return { list, unit };
};

/*
 * Whether the storefront would sell it right now. Out of stock is the vendor's
 * explicit "outofstock", or a tracked quantity that has run out; a quantity
 * nobody entered (null) is not tracked, exactly as checkout treats it.
 */
const isSellableStock = (product) => {
    if (product.stock_status === 'outofstock') return false;
    if (product.stock_management && product.stock_status !== 'onbackorder') {
        const q = product.quantity;
        if (q !== null && q !== undefined && Number.isFinite(Number(q)) && Number(q) <= 0) return false;
    }
    return true;
};

const trackedQty = (product) => {
    if (!product.stock_management || product.stock_status === 'onbackorder') return null;
    const q = Number(product.quantity);
    return product.quantity !== null && product.quantity !== undefined && Number.isFinite(q) ? Math.max(0, q) : null;
};

/*
 * "Fits: Toyota Corolla 2015–2020, Hyundai Elantra" — the line that lets the
 * agent match a part to the customer's car. Kept short: it rides in the
 * description of every menu item.
 */
const fitmentOf = (product, lang = 'en') => {
    if (product.is_universal) return lang === 'ar' ? 'يناسب كل العربيات' : 'Universal fit';
    const cars = (product.compatible_cars || []).map((car) => {
        const brand = text(car.brand_name);
        if (!brand) return '';
        if (car.all_models || !(car.models || []).length) return brand;
        const models = car.models.map((m) => {
            const years = (m.years || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
            const span = m.all_years || !years.length
                ? ''
                : years.length === 1 ? ` ${years[0]}` : ` ${years[0]}–${years[years.length - 1]}`;
            return `${text(m.model_name)}${span}`.trim();
        }).filter(Boolean);
        return `${brand} ${models.join(', ')}`.trim();
    }).filter(Boolean);
    if (!cars.length) return '';
    const list = cars.slice(0, 6).join(' · ') + (cars.length > 6 ? ' …' : '');
    return lang === 'ar' ? `يناسب: ${list}` : `Fits: ${list}`;
};

const PART_TYPE = {
    original: { en: 'Original', ar: 'أصلي' },
    oem: { en: 'OEM', ar: 'OEM' },
    aftermarket: { en: 'Aftermarket', ar: 'تجاري' },
};

const describe = (product, lang, brandName) => {
    const subtitle = text(lang === 'ar' ? (product.subtitle_ar || product.subtitle_en) : (product.subtitle_en || product.subtitle_ar));
    const parts = [
        brandName,
        PART_TYPE[product.part_type]?.[lang],
        subtitle,
        fitmentOf(product, lang),
        product.part_number ? `${lang === 'ar' ? 'رقم القطعة' : 'Part no.'} ${text(product.part_number)}` : '',
    ].map(text).filter(Boolean);
    return parts.join(' — ').slice(0, 480);
};

/**
 * The menu items one product should have on the agent, keyed by external id.
 *
 * A value of `null` means "must not exist there": the sync deletes it if it was
 * ever pushed. That covers anything the storefront would not show — a draft or
 * pending product, a suspended or unsubscribed vendor, a row with no price.
 *
 * `ctx`:
 *   isActiveVendor(id)   → the vendor may sell right now
 *   categoryName(id)     → the category's English name
 *   brandName(product)   → the product brand's name, or ''
 *   imageUrl(url)        → an absolute URL for a stored image path
 *   productUrl(product)  → the storefront link to the product
 *   maxQtyPerOrder       → per-order cap, or null
 */
const menuItemsForProduct = (product, ctx) => {
    const out = new Map();
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    const rows = variants.length ? variants : [null];
    const eligible = product?.status === 'published' && ctx.isActiveVendor(product.vendor_id);
    const titleEn = text(product?.title_en || product?.title_ar);
    const titleAr = text(product?.title_ar);
    const brand = ctx.brandName?.(product) || '';
    const primary = (product?.images || []).find((img) => img?.is_primary)?.url || product?.images?.[0]?.url;

    for (const variant of rows) {
        const externalId = toExternalId(product._id, variant?._id);
        const { list, unit } = pricesOf(product, variant);
        if (!eligible || !titleEn || !(unit > 0)) {
            out.set(externalId, null);
            continue;
        }
        const label = variantLabelOf(variant);
        const options = (variant?.selected_options || []).filter((o) => text(o.type_name) && text(o.option_value));
        const onOffer = list > unit;
        const item = {
            name: bilingual(nameOf(titleEn, label), titleAr ? nameOf(titleAr, label) : ''),
            description: bilingual(describe(product, 'en', brand), describe(product, 'ar', brand)),
            category: ctx.categoryName?.(product.category_id) || undefined,
            // EverySecond charges the lowest of price and offer_price, so the
            // sale price goes in offer_price and price stays the list price.
            price: round2(onOffer ? list : unit),
            offer_price: onOffer ? round2(unit) : null,
            available: isSellableStock(product),
            stock_qty: trackedQty(product),
            image_url: httpsOnly(ctx.imageUrl?.(primary)),
            product_url: httpsOnly(ctx.productUrl?.(product)),
            option_group: variants.length ? titleEn : undefined,
            options: options.length ? Object.fromEntries(options.map((o) => [text(o.type_name), text(o.option_value)])) : undefined,
            branches: 'all',
            orderable_in_chat: true,
            max_qty_per_order: ctx.maxQtyPerOrder || null,
            requires_staff_approval: false,
        };
        // Undefined keys are dropped so the hash only changes when content does.
        out.set(externalId, JSON.parse(JSON.stringify(item)));
    }
    return out;
};

const itemHash = (item) => crypto.createHash('sha1').update(JSON.stringify(item)).digest('hex');

/* ------------------------------------------------------------------ */
/* Customers and addresses                                             */
/* ------------------------------------------------------------------ */

/* Egyptian governorate names arrive with and without "al-", hamza, taa marbuta
   and alef maqsura variants; this folds them to one spelling for matching. */
const foldName = (s) => text(s)
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    // "El Giza", "al-Sharqia", "الجيزة" — but never the "al" of "Alexandria".
    .replace(/^(al|el)[\s-]+/, '')
    .replace(/^ال/, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Common names a customer types that are not the courier's spelling. */
const CITY_ALIASES = {
    'cairo': ['القاهرة', 'القاهره', 'مصر', 'kahera', 'qahera'],
    'giza': ['الجيزة', 'جيزة', 'giza', 'gizah'],
    'alexandria': ['اسكندرية', 'الإسكندرية', 'إسكندرية', 'alex', 'eskendereya'],
    'el kalioubia': ['القليوبية', 'qalyubia', 'kalyoubia', 'qalubia'],
    'monufia': ['المنوفية', 'menoufia', 'menofia'],
    'sharqia': ['الشرقية', 'sharkia', 'sharkeya'],
    'assuit': ['أسيوط', 'asyut', 'assiut'],
    'bani suif': ['بني سويف', 'beni suef', 'bani sweif'],
    'menya': ['المنيا', 'minya', 'minia'],
    'matrouh': ['مرسى مطروح', 'مطروح', 'marsa matrouh'],
    'kafr alsheikh': ['كفر الشيخ', 'kafr el sheikh'],
    'behira': ['البحيرة', 'beheira', 'buhayra'],
};

const ALIASES_BY_CITY = new Map(Object.entries(CITY_ALIASES).map(([city, names]) => [foldName(city), names]));
const namesOf = (city) => [city.name, city.name_ar, ...(ALIASES_BY_CITY.get(foldName(city.name)) || [])].map(foldName).filter(Boolean);

/** The City row (from the shipping table) a chat address names, or null. */
const matchCity = (candidates, cities = []) => {
    const wanted = candidates.map(foldName).filter(Boolean);
    if (!wanted.length) return null;
    for (const city of cities) {
        const names = namesOf(city);
        if (wanted.some((w) => names.includes(w))) return city;
    }
    // "Nasr City, Cairo" / "مدينة نصر - القاهرة": a governorate named inside the text.
    for (const city of cities) {
        const names = namesOf(city).filter((n) => n.length >= 4);
        if (wanted.some((w) => names.some((n) => w.includes(n)))) return city;
    }
    return null;
};

/**
 * The storefront shipping address and destination for a chat order. The
 * delivery zone the agent matched is a governorate (that is how the zones are
 * set up on EverySecond), so it resolves against our City table the same way a
 * web checkout's city does.
 */
const orderAddressFromChat = (fulfillment = {}, { cities = [], name = '', phone = '' } = {}) => {
    const details = fulfillment.address_details || {};
    const area = text(details.area || fulfillment.zone || fulfillment.delivery_zone);
    const city = matchCity([fulfillment.zone, fulfillment.delivery_zone, details.area, fulfillment.address], cities);
    const parts = [details.street, details.building && `Building ${details.building}`, details.unit && `Apt ${details.unit}`, area, details.notes]
        .map(text)
        .filter(Boolean);
    const full = text(fulfillment.address) || parts.join(', ') || area;
    return {
        shipping_address: {
            recipient_name: text(name) || 'Chat customer',
            phone: text(phone),
            full_address: full || 'Address to be confirmed by phone',
        },
        shipping_destination: city ? { country: city.country || 'Egypt', city: city.name } : null,
        city,
    };
};

/* ------------------------------------------------------------------ */
/* Statuses                                                            */
/* ------------------------------------------------------------------ */

/*
 * Our order status (derived from the parcels) → what EverySecond announces to
 * the customer in the chat. Statuses there only move forward, so the in-between
 * states we have no word for are left out rather than mapped backwards.
 */
const ES_STATUS_FOR = {
    processing: 'confirmed',
    confirmed: 'confirmed',
    ready: 'preparing',
    pickup_scheduled: 'preparing',
    picked_up: 'preparing',
    in_transit: 'out_for_delivery',
    out_for_delivery: 'out_for_delivery',
    partially_shipped: 'out_for_delivery',
    completed: 'delivered',
    cancelled: 'cancelled',
};
const ES_STATUS_RANK = { pending: 0, confirmed: 1, preparing: 2, out_for_delivery: 3, delivered: 4 };

/* ------------------------------------------------------------------ */
/* Lines the customer reads                                            */
/* ------------------------------------------------------------------ */

/* Egyptian Arabic, matching the agent — sent to the customer as they are. */
const CUSTOMER_MESSAGES = {
    unavailable: {
        ar: 'معلش، في منتجات مش متاحة دلوقتي بالكمية اللي طلبتها.',
        en: "Sorry, some items aren't available right now in the quantity you asked for.",
    },
    pickup: {
        ar: 'الطلبات من الشات توصيل بس حاليًا، مفيش استلام من الفرع.',
        en: 'Chat orders are delivery only for now — there is no pickup.',
    },
    needPhone: {
        ar: 'محتاج رقم موبايلك المصري (01xxxxxxxxx) عشان نأكد الطلب.',
        en: 'Please share your Egyptian mobile number (01xxxxxxxxx) so we can place the order.',
    },
    needCity: {
        ar: 'قولّي المحافظة اللي هنوصل لها (مثلًا القاهرة أو الجيزة أو إسكندرية) عشان أحسب الشحن.',
        en: 'Which governorate should we deliver to (e.g. Cairo, Giza, Alexandria)? I need it to work out the shipping.',
    },
    noCod: {
        ar: 'الدفع عند الاستلام مش متاح للحساب ده. المنتجات اتحطت في السلة على الموقع وتقدر تكمّل الطلب وتدفع أونلاين من هناك.',
        en: "Cash on delivery isn't available for this account. Your items are in your cart on the website — you can complete the order and pay online there.",
    },
    noShipping: {
        ar: 'للأسف مش بنوصل للمنطقة دي دلوقتي.',
        en: "Sorry, we don't deliver to that area right now.",
    },
    failed: {
        ar: 'معلش، معرفناش نأكد الطلب. ممكن تكمّله من الموقع readycar.store أو تكلم خدمة العملاء وهنساعدك.',
        en: "Sorry, we couldn't place this order. You can complete it on readycar.store or contact customer service and we'll help.",
    },
};

const messageFor = (key, language) => CUSTOMER_MESSAGES[key]?.[language === 'en' ? 'en' : 'ar'] ?? null;

module.exports = {
    toExternalId,
    parseExternalId,
    signBody,
    verifySignature,
    pricesOf,
    variantLabelOf,
    isSellableStock,
    fitmentOf,
    menuItemsForProduct,
    itemHash,
    foldName,
    matchCity,
    orderAddressFromChat,
    ES_STATUS_FOR,
    ES_STATUS_RANK,
    messageFor,
    httpsOnly,
};
