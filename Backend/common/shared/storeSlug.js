/**
 * The store's address in a link: /store/<store_slug>.
 *
 * `store_username` cannot be that. It is free text — 44 stores carry a space ("x-turbo auto
 * parts"), a "#", Arabic or an apostrophe — and it is also a vendor LOGIN identifier, so it
 * cannot simply be rewritten. The slug is its URL-safe twin: lowercase latin letters,
 * digits and single hyphens ("x-turbo-auto-parts"), unique across stores and never equal to
 * another store's username, so /store/<x> can resolve by slug first and username second
 * without ever landing on the wrong shop.
 */
/**
 * Arabic letters written in latin, so an Arabic store name becomes a readable link
 * ("احمد فتحى" → "ahmd-fthy") instead of vanishing and leaving a meaningless fallback.
 */
const AR_TO_LATIN = {
    'ا': 'a', 'أ': 'a', 'إ': 'e', 'آ': 'a', 'ٱ': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'g',
    'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'z', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh', 'ص': 's',
    'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'k', 'ك': 'k', 'ل': 'l',
    'م': 'm', 'ن': 'n', 'ه': 'h', 'ة': 'a', 'و': 'w', 'ي': 'y', 'ى': 'y', 'ئ': 'e', 'ؤ': 'o',
    'ء': '', 'ـ': '',
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};
const transliterate = (text) => String(text || '')
    .replace(/[\u064B-\u0652]/g, '')   // harakat
    .replace(/[\u0600-\u06FF]/g, (ch) => (ch in AR_TO_LATIN ? AR_TO_LATIN[ch] : ''));

/** An address or anything else that must never end up in a public link. */
const looksPrivate = (text) => /@|\d{9,}/.test(String(text || ''));

const slugify = (text) => transliterate(text)
    .toLowerCase()
    .replace(/['’`]/g, '')           // "papa's" → "papas", not "papa-s"
    .replace(/[^a-z0-9]+/g, '-')     // spaces, "#", Arabic, punctuation → one hyphen
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');

/**
 * A free slug for this seller. Tries the username, then the store name, then a neutral
 * fallback, adding -2, -3… on a clash.
 */
const buildStoreSlug = async (SellerModel, { _id = null, store_username = '', store_name = '' } = {}) => {
    const base = (!looksPrivate(store_username) && slugify(store_username))
        || (!looksPrivate(store_name) && slugify(store_name))
        || `store-${String(_id || '').slice(-6) || Date.now().toString(36)}`;
    for (let n = 1; n < 200; n += 1) {
        const candidate = n === 1 ? base : `${base}-${n}`;
        const clash = await SellerModel.exists({
            _id: { $ne: _id },
            $or: [{ store_slug: candidate }, { store_username: candidate }],
        });
        if (!clash) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
};

module.exports = { slugify, transliterate, buildStoreSlug };
