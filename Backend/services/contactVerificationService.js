const { User } = require('../models/users');
const { Seller } = require('../models/sellers');
const { recordAuditLog } = require('../models/auditLog');
const { issueOtp, verifyOtp, clearOtps, otpError, RESEND_COOLDOWN_SECONDS } = require('./otpService');
const { normalizeEmailForAuth, formatPhone } = require('./authService');
const { parseIdentifier } = require('./shared/customerIdentifier');

/**
 * Confirming the contact details of a SIGNED-IN account — a customer or a
 * store owner. Both prove ownership the same way and hold the same four
 * fields, so they share this service rather than growing a second copy that
 * would drift.
 *
 * Distinct from registration verification: an account already exists, so the
 * challenge is anchored to the account id rather than to a pending record, and
 * a replacement value is staged in `pending_email` / `pending_phone` until the
 * code proves it. A live email or phone is never overwritten by an unproven
 * one — otherwise a typo during this prompt would lock the account holder out
 * of the very account they are signed in to.
 *
 * Customers and stores are separate collections that may hold the same email,
 * so `role` travels with every call: it selects the collection AND scopes the
 * one-time code, so a code issued to a store can never be spent as a customer's.
 */

const TARGETS = { email: 'verify_email', phone: 'verify_phone' };

const MODELS = { user: User, vendor: Seller };

const modelFor = (role) => {
    const model = MODELS[role];
    if (!model) throw otpError('INVALID_ROLE', 'Unknown account type', 400);
    return model;
};

/** A store is identified by its store name; a customer by their own. */
const displayName = (account, role) =>
    (role === 'vendor' ? (account.store_name || account.name) : account.name) || '';

const assertTarget = (target) => {
    if (!TARGETS[target]) {
        throw otpError('INVALID_TARGET', 'Choose either email or phone', 400);
    }
    return TARGETS[target];
};

/** What the prompt needs in order to decide what (if anything) to ask for. */
const getVerificationStatus = async (userId, role = 'user') => {
    const user = await modelFor(role).findById(userId)
        .select('email phone email_verified_at phone_verified_at pending_email pending_phone');
    if (!user) throw otpError('USER_NOT_FOUND', 'Account not found', 404);

    return {
        email: user.email,
        phone: user.phone,
        email_verified: !!user.email_verified_at,
        phone_verified: !!user.phone_verified_at,
        // A value already awaiting its code, so the UI can resume rather than
        // silently discard what the customer typed last time.
        pending_email: user.pending_email || null,
        pending_phone: user.pending_phone || null,
        fully_verified: !!user.email_verified_at && !!user.phone_verified_at,
        resend_cooldown_seconds: RESEND_COOLDOWN_SECONDS,
    };
};

/**
 * Validate and stage a replacement contact value.
 * Uniqueness is checked against BOTH live and pending values so two accounts
 * cannot race toward the same phone number or email address.
 */
const stageNewValue = async (user, target, rawValue, role = 'user') => {
    if (target === 'email') {
        const parsed = parseIdentifier(rawValue);
        if (parsed.type !== 'email') {
            throw otpError('INVALID_EMAIL', 'Enter a valid email address', 400);
        }
        const normalized = normalizeEmailForAuth(rawValue);
        if (normalized === user.email) return null;

        const taken = await modelFor(role).findOne({
            _id: { $ne: user._id },
            $or: [{ email: normalized }, { pending_email: normalized }],
        }).select('_id');
        if (taken) throw otpError('EMAIL_IN_USE', 'That email is already used by another account', 409);

        user.pending_email = normalized;
        await user.save();
        return normalized;
    }

    const formatted = formatPhone(String(rawValue || ''));
    if (formatted.length < 10) {
        throw otpError('INVALID_PHONE', 'Enter a valid phone number', 400);
    }
    if (formatted === user.phone) return null;

    const taken = await modelFor(role).findOne({
        _id: { $ne: user._id },
        $or: [{ phone: formatted }, { pending_phone: formatted }],
    }).select('_id');
    if (taken) throw otpError('PHONE_IN_USE', 'That phone number is already used by another account', 409);

    user.pending_phone = formatted;
    await user.save();
    return formatted;
};

/**
 * Send a code to the customer's email or phone.
 *
 * `value` is optional: supplying it corrects the contact detail before the code
 * goes out, which is the whole point of prompting — a customer whose number is
 * wrong must be able to fix it, not just re-send to the wrong number.
 */
const sendVerificationCode = async (userId, { target, value = null, language = 'en', role = 'user' }) => {
    const purpose = assertTarget(target);

    const user = await modelFor(role).findById(userId);
    if (!user) throw otpError('USER_NOT_FOUND', 'Account not found', 404);

    let destination;
    if (value) {
        destination = await stageNewValue(user, target, value, role)
            || (target === 'email' ? user.email : user.phone);
    } else {
        // Resume a staged change if one is outstanding, otherwise use the live value.
        destination = target === 'email'
            ? (user.pending_email || user.email)
            : (user.pending_phone || user.phone);
    }

    if (!destination) {
        throw otpError('OTP_DESTINATION_REQUIRED', `No ${target} on file to send a code to`, 400);
    }

    const issued = await issueOtp({
        // Email confirmations use an emailed code rather than a link: the
        // customer is already signed in and staying on the page, so a code
        // completes in place instead of bouncing through the inbox.
        channel: target === 'email' ? 'email' : 'whatsapp',
        purpose,
        destination,
        userId: user._id,
        accountRole: role,
        language,
        name: displayName(user, role),
    });

    return { target, ...issued };
};

/**
 * Confirm a code and stamp the contact detail as verified, committing any
 * staged replacement at the same moment it is proven.
 */
const confirmVerificationCode = async (userId, { target, code, role = 'user' }) => {
    const purpose = assertTarget(target);

    const user = await modelFor(role).findById(userId);
    if (!user) throw otpError('USER_NOT_FOUND', 'Account not found', 404);

    const { destination } = await verifyOtp({ purpose, userId: user._id, code, accountRole: role });
    const now = new Date();

    if (target === 'email') {
        // Commit only if the code was actually sent to the staged address —
        // a stale code must never validate a value changed after it was issued.
        if (user.pending_email && user.pending_email === destination) {
            user.email = user.pending_email;
        }
        user.pending_email = null;
        user.email_verified_at = now;
    } else {
        if (user.pending_phone && user.pending_phone === destination) {
            user.phone = user.pending_phone;
        }
        user.pending_phone = null;
        user.phone_verified_at = now;
    }

    try {
        await user.save();
    } catch (err) {
        // A unique-index collision here means the value was claimed between
        // staging and confirming.
        if (err.code === 11000) {
            throw otpError(
                target === 'email' ? 'EMAIL_IN_USE' : 'PHONE_IN_USE',
                `That ${target} was just claimed by another account. Try a different one.`,
                409
            );
        }
        throw err;
    }

    await clearOtps({ purpose, userId: user._id, accountRole: role });

    await recordAuditLog({
        action: target === 'email' ? 'contact_email_verified' : 'contact_phone_verified',
        actor: { role, label: displayName(user, role) },
        target_type: role,
        target_id: user._id,
        target_snapshot: { target },
        impact: {},
    });

    return {
        target,
        verified: true,
        email: user.email,
        phone: user.phone,
        email_verified: !!user.email_verified_at,
        phone_verified: !!user.phone_verified_at,
    };
};

/** Drop a staged replacement without verifying it. */
const cancelPendingChange = async (userId, target, role = 'user') => {
    const purpose = assertTarget(target);
    const user = await modelFor(role).findById(userId);
    if (!user) throw otpError('USER_NOT_FOUND', 'Account not found', 404);

    if (target === 'email') user.pending_email = null;
    else user.pending_phone = null;
    await user.save();

    await clearOtps({ purpose, userId: user._id, accountRole: role });
    return { target, cancelled: true };
};

module.exports = {
    getVerificationStatus,
    sendVerificationCode,
    confirmVerificationCode,
    cancelPendingChange,
};
