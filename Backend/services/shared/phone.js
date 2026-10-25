/**
 * Canonical phone handling for identity lookups.
 *
 * `formatPhone` (authService) only strips non-digits, so the same Egyptian
 * mobile reaches the database as three different strings depending on how the
 * customer typed it:
 *
 *   01012345678    → "01012345678"
 *   +201012345678  → "201012345678"
 *   00201012345678 → "00201012345678"
 *
 * That is harmless while a phone is only ever a stored attribute, but guest
 * checkout makes it an IDENTITY: the number alone decides whether we resume an
 * account or create one. Under the old rule a customer who typed their number
 * with a country code the second time would silently get a second account —
 * and their order history would split in two.
 *
 * So: one canonical form for anything we WRITE, and a variant set for anything
 * we READ. Existing rows are left exactly as they are; the variant set is what
 * makes them findable without a migration that would have to rewrite phone
 * numbers on live accounts.
 */

const EGYPT_CC = '20';
/** National significant number for an Egyptian mobile: 1 + operator + 8 digits. */
const EG_MOBILE_NSN = /^1[0-9]{9}$/;

/** Strip every non-digit, and drop an international "00" access prefix. */
const digitsOnly = (raw) => {
    const digits = String(raw || '').replace(/\D/g, '');
    return digits.startsWith('00') ? digits.slice(2) : digits;
};

/**
 * Reduce an Egyptian mobile to its national significant number (no country
 * code, no trunk zero), or return null when the input is not one.
 */
const egyptNsn = (raw) => {
    let digits = digitsOnly(raw);
    if (!digits) return null;

    if (digits.startsWith(EGYPT_CC) && digits.length > 10) digits = digits.slice(EGYPT_CC.length);
    if (digits.startsWith('0')) digits = digits.slice(1);

    return EG_MOBILE_NSN.test(digits) ? digits : null;
};

/**
 * The single form guest checkout WRITES.
 *
 * Local `01XXXXXXXXX` is deliberate rather than E.164: it is what the checkout
 * form already validates against, what the overwhelming majority of existing
 * rows hold, and what a support agent reads back over the phone. Choosing the
 * form the data is already in keeps new guest accounts findable by every
 * pre-existing lookup in the codebase.
 *
 * A number that is not an Egyptian mobile falls back to digits-only, matching
 * the legacy `formatPhone` behaviour so nothing regresses for other countries.
 */
const canonicalPhone = (raw) => {
    const nsn = egyptNsn(raw);
    return nsn ? `0${nsn}` : digitsOnly(raw);
};

/**
 * Every form the SAME number could already be stored as.
 *
 * Used with `$in` so a lookup finds an account regardless of which format the
 * customer happened to use when they first registered. Order is irrelevant;
 * duplicates are removed because an `$in` with repeats is just noise.
 */
const phoneLookupVariants = (raw) => {
    const nsn = egyptNsn(raw);
    if (!nsn) {
        const digits = digitsOnly(raw);
        return digits ? [digits] : [];
    }

    return [...new Set([
        `0${nsn}`,               // 01012345678  — canonical
        nsn,                     // 1012345678   — trunk zero dropped
        `${EGYPT_CC}${nsn}`,     // 201012345678 — country code, as formatPhone leaves "+20…"
        `${EGYPT_CC}0${nsn}`,    // 2001012345678 — country code kept over the trunk zero
        `00${EGYPT_CC}${nsn}`,   // 00201012345678 — access prefix survived formatPhone
    ])];
};

/** True when the value is a well-formed Egyptian mobile number. */
const isValidEgyptMobile = (raw) => egyptNsn(raw) !== null;

/** Show enough of a number to recognise it, not enough to disclose it. */
const maskPhone = (raw) => {
    const value = String(raw || '');
    if (value.length <= 4) return value;
    return `${'*'.repeat(value.length - 4)}${value.slice(-4)}`;
};

module.exports = {
    canonicalPhone,
    phoneLookupVariants,
    isValidEgyptMobile,
    maskPhone,
    egyptNsn,
};
