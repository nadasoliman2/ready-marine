/**
 * Inviting someone who has no account yet — shared by Friends and Family.
 *
 * Both features used to be able to invite only people who were already
 * customers. Family would email a token to an address that may or may not
 * resolve; Friends would look the person up and, finding nobody, quietly do
 * nothing at all. In both cases the person the customer actually wanted to
 * reach never heard about it.
 *
 * This module closes that gap the same way checkout did: a PLACEHOLDER guest
 * account, created silently from the identifier, that the invitation can point
 * at. Everything downstream — friendships, memberships, shared addresses,
 * buying for each other — keeps working against a normal `user_id`, because
 * that is exactly what it gets.
 *
 * ── Two rules make that safe ──────────────────────────────────────────────
 *
 * 1. A placeholder is an unclaimed guest, so `guestDisclosureBlocked` already
 *    applies to it in full: it discloses nothing, cannot be signed into with a
 *    password, and cannot spend account money. Creating one for a stranger's
 *    number hands the creator nothing.
 *
 * 2. Opening the invitation link is NOT acceptance. The link proves someone
 *    received a forwarded message; a WhatsApp code proves they hold the number.
 *    Since accepting grants read access to the INVITER's saved addresses, the
 *    code is what stands between a forwarded screenshot and someone else's
 *    address book.
 */
const crypto = require('crypto');

const { User, createUser } = require('../../models/users');
const { canonicalPhone, isValidEgyptMobile, phoneLookupVariants } = require('./phone');
const { normalizeEmailForAuth } = require('../authService');
const { authorizationError } = require('./addressAuthorization');

const inviteError = authorizationError;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/* ------------------------------------------------------------------ */
/* Tokens                                                              */
/* ------------------------------------------------------------------ */

/** Only the hash is ever persisted, for the same reason password hashes are. */
const hashInviteToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const generateInviteToken = () => crypto.randomBytes(32).toString('hex');

const getFrontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

/**
 * The single landing URL every WhatsApp invitation points at.
 *
 * One path for both features, deliberately. A WhatsApp template declares ONE
 * fixed base URL for its button and Meta checks that the delivered link starts
 * with it — so two paths (`/friends/invitation/…` and `/family/invitation/…`)
 * would have forced the base down to the bare domain — which is what template
 * 47 was in fact created with, so the delivered link currently carries this URL
 * appended to the domain and is straightened out by `frontend/src/middleware.js`.
 *
 * The page behind it only resolves which kind of invitation the token is and
 * forwards to the existing landing page, so neither of those pages changed and
 * links already sent under the old paths keep working.
 */
const buildInviteLandingUrl = (token) => `${getFrontendUrl()}/invite/${encodeURIComponent(token)}`;

/* ------------------------------------------------------------------ */
/* Identifier                                                          */
/* ------------------------------------------------------------------ */

/**
 * Classify an invitation identifier and normalize it the way auth does.
 *
 * The distinction matters beyond routing the message: only a PHONE can carry a
 * placeholder account, because `phone` is the one required, unique field on a
 * user. An email invitation to a stranger has nothing to hang an account on, so
 * it keeps the existing behaviour — a token emailed to an address, claimed when
 * somebody signs in with it.
 */
const parseInviteIdentifier = (raw) => {
    const value = String(raw || '').trim();
    if (!value) return { type: null, normalized: '', raw: value };

    if (value.includes('@')) {
        const normalized = normalizeEmailForAuth(value);
        return EMAIL_PATTERN.test(normalized)
            ? { type: 'email', normalized, raw: value }
            : { type: null, normalized: '', raw: value };
    }

    return isValidEgyptMobile(value)
        ? { type: 'phone', normalized: canonicalPhone(value), raw: value }
        : { type: null, normalized: '', raw: value };
};

/** Show enough to recognise, never enough to disclose. */
const maskInviteIdentifier = ({ type, normalized }) => {
    if (!normalized) return '';
    if (type === 'email') {
        const [local, domain] = normalized.split('@');
        return `${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
    }
    return `${'*'.repeat(Math.max(0, normalized.length - 4))}${normalized.slice(-4)}`;
};

/* ------------------------------------------------------------------ */
/* Resolving the person being invited                                  */
/* ------------------------------------------------------------------ */

/**
 * Find the account this invitation is for, creating a placeholder if there is
 * none and the identifier is a phone number.
 *
 * @param {object}  parsed        Output of `parseInviteIdentifier`.
 * @param {string}  inviterName   Used only to label the placeholder until its
 *                                owner claims it and supplies their own name.
 * @param {boolean} allowCreate   False for callers that must not create rows —
 *                                a preview, or a re-send of an existing invite.
 * @returns {Promise<{user: object|null, created: boolean}>}
 */
const resolveInviteTarget = async (parsed, { inviterName = '', language = 'en', allowCreate = true } = {}) => {
    if (!parsed?.type) return { user: null, created: false };

    if (parsed.type === 'email') {
        const user = await User.findOne({ email: parsed.normalized });
        // No placeholder for an email: `phone` is required and unique on a user,
        // and inventing one would either fail or collide with a real number.
        return { user, created: false };
    }

    const existing = await User.findOne({ phone: { $in: phoneLookupVariants(parsed.normalized) } });
    if (existing) return { user: existing, created: false };
    if (!allowCreate) return { user: null, created: false };

    // The placeholder. Deliberately carries no email (the users email index is
    // partial, so an absent one is legal) and no password, which is what makes
    // it an unclaimed guest and therefore disclosure-blocked from birth.
    //
    // The name is a placeholder too: we genuinely do not know it. It is replaced
    // by whatever the person types when they claim the account, and it is never
    // shown back to the inviter as though we had looked it up.
    const user = await createUser({
        name: inviteePlaceholderName(inviterName, language),
        phone: parsed.normalized,
        password: null,
        account_status: 'guest',
        preferred_language: language === 'ar' ? 'ar' : 'en',
    });

    return { user, created: true };
};

/**
 * What to call someone we know nothing about but a phone number.
 *
 * Never a guess at their real name, and never the inviter's name on its own —
 * an ops screen showing "Ahmed" for two different people would be worse than
 * showing neither.
 */
const inviteePlaceholderName = (inviterName, language) => {
    const suffix = inviterName ? ` (${String(inviterName).slice(0, 40)})` : '';
    return language === 'ar' ? `مدعو${suffix}` : `Invited guest${suffix}`;
};

/* ------------------------------------------------------------------ */
/* Delivery                                                            */
/* ------------------------------------------------------------------ */

/**
 * EverySecond template `readycar_invitation` (UTILITY, ar, dynamic url button).
 *
 * Takes exactly two variables — the inviter's name and one context line that
 * says what they are inviting you to — and a button whose URL is supplied per
 * message. Defaulted the way every other template id in this codebase is, so a
 * fresh environment works without extra configuration; override to point at a
 * different account's copy.
 */
const WHATSAPP_INVITE_TEMPLATE_ID = Number(process.env.WHATSAPP_INVITE_TEMPLATE_ID || 47);

/**
 * Send an invitation over WhatsApp.
 *
 * Returns `{ skipped: 'not_configured' }` rather than throwing when no template
 * is set, so a store that has not created the template yet still gets working
 * invitations for people who already have accounts — the in-app notification
 * path is unaffected. Callers decide whether an undelivered invitation is fatal.
 */
const sendWhatsappInvite = async ({ phone, inviterName, contextLine, url, campaignLabel }) => {
    if (!WHATSAPP_INVITE_TEMPLATE_ID) {
        console.warn('[Invites] WHATSAPP_INVITE_TEMPLATE_ID not set — WhatsApp invitation not sent.');
        return { skipped: 'not_configured' };
    }

    const whatsappService = require('../whatsappService');
    return await whatsappService.sendTemplateMessage({
        phone,
        templateId: WHATSAPP_INVITE_TEMPLATE_ID,
        variables: { 1: inviterName, 2: contextLine },
        // The provider rejects anything but a complete public URL here
        // ("button_url must be a public URL"), while the template's dynamic-URL
        // base is the bare domain — so what WhatsApp delivers is the base with
        // this whole URL appended: `readycar.store/https:/readycar.store/invite/…`.
        // `frontend/src/middleware.js` forwards that shape to the real page;
        // a clean link needs the template's base fixed in the provider account.
        buttonUrl: url,
        // Dashboard label only — deliberately free of the token and the number.
        campaignName: campaignLabel,
    });
};

module.exports = {
    inviteError,
    hashInviteToken,
    generateInviteToken,
    getFrontendUrl,
    buildInviteLandingUrl,
    parseInviteIdentifier,
    maskInviteIdentifier,
    resolveInviteTarget,
    inviteePlaceholderName,
    sendWhatsappInvite,
    WHATSAPP_INVITE_TEMPLATE_ID,
};
