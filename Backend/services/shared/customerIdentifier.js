/**
 * Customer identifier helpers shared by the Family and Friends features.
 *
 * Both features let one customer reference another by a contact identifier, and
 * both must normalize it EXACTLY the way login and registration do — otherwise
 * "A.Hmed+tag@Gmail.com" and "ahmed@gmail.com" would resolve to different
 * people, and an invite could silently miss (or, worse, duplicate) an account.
 */
const { User } = require('../../models/users');
const { normalizeEmailForAuth, formatPhone } = require('../authService');

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Classify a free-text identifier as an email or a phone number and normalize
 * it with the matching auth rule. Returns `{ type: null }` when it is neither.
 */
const parseIdentifier = (raw) => {
    const value = String(raw || '').trim();
    if (!value) return { type: null, normalized: '', raw: value };

    if (value.includes('@')) {
        const normalized = normalizeEmailForAuth(value);
        return EMAIL_PATTERN.test(normalized)
            ? { type: 'email', normalized, raw: value }
            : { type: null, normalized: '', raw: value };
    }

    const digits = formatPhone(value);
    // Short digit strings are typos, not phone numbers — refuse rather than
    // run a lookup that could match an unrelated account.
    return digits.length >= 7
        ? { type: 'phone', normalized: digits, raw: value }
        : { type: null, normalized: '', raw: value };
};

/**
 * Mask an identifier for display back to the SENDER of an invitation.
 * The sender typed it, so echoing a masked form is not a disclosure — but the
 * masked form is what we persist, so a leaked record never exposes a full
 * address or number.
 */
const maskIdentifier = ({ type, normalized }) => {
    if (!normalized) return '';

    if (type === 'email') {
        const [local, domain] = normalized.split('@');
        const head = local.slice(0, 2);
        return `${head}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
    }

    const tail = normalized.slice(-3);
    return `${'*'.repeat(Math.max(1, normalized.length - 3))}${tail}`;
};

/**
 * Resolve a customer account from a normalized identifier.
 *
 * Returns null when nothing matches. Callers MUST NOT turn that null into a
 * distinguishable response: whether an email or phone has a ReadyCar account is
 * exactly the fact account-enumeration attacks are after.
 */
const findCustomerByIdentifier = async (parsed) => {
    if (!parsed?.type) return null;

    const filter = parsed.type === 'email'
        ? { email: parsed.normalized }
        : { phone: parsed.normalized };

    return await User.findOne(filter).select('name email phone profile_image preferred_language');
};

/** Safe public shape of another customer — name and avatar only. */
const publicProfile = (user) => user ? ({
    _id: user._id,
    name: user.name,
    profile_image: user.profile_image || null,
}) : null;

module.exports = {
    parseIdentifier,
    maskIdentifier,
    findCustomerByIdentifier,
    publicProfile,
};
