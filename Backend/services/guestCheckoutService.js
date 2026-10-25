/**
 * Guest checkout — accounts created silently from the shipping form.
 *
 * The customer never sees the word "account". They fill in the name, phone, and
 * address an order needs anyway, and those same fields become a `User` with
 * `account_status: 'guest'` and no password. Everything downstream — orders,
 * wallet, loyalty, returns, family, friend checkout — keeps working unchanged
 * because from the backend's point of view there is always a real `user_id`.
 *
 * ── The disclosure rule ───────────────────────────────────────────────────
 * A guest account is addressed by phone number alone, and a phone number is
 * not a secret: anyone who knows one could ask for a session on it. So the
 * invariant is absolute and lives in `guestDisclosureBlocked` below:
 *
 *     an account with account_status 'guest' and no phone_verified_at
 *     discloses NOTHING — no saved addresses, no order history, no profile.
 *
 * It can accumulate those things, and the moment its owner proves the number
 * with a WhatsApp code they get all of it. Until then a session on it is worth
 * no more than the shipping form the visitor just typed themselves.
 *
 * ── Why the code comes AFTER the order ────────────────────────────────────
 * Nothing here blocks placing an order. A code demanded before the button is
 * one more wall between a customer and a purchase; the same code offered on the
 * confirmation screen is answered by someone who has already committed. The
 * order is real either way — an unconfirmed one simply carries an unverified
 * phone, which is exactly the flag the ops team needs for a cash order.
 */
const { User, createUser, findUserByPhoneVariants } = require('../models/users');
const { canonicalPhone, isValidEgyptMobile, maskPhone } = require('./shared/phone');
const { authorizationError } = require('./shared/addressAuthorization');
const { issueOtp, verifyOtp, clearOtps } = require('./otpService');
const { generateToken, hashPassword } = require('./authService');

const guestError = authorizationError;

/** How long a guest session lasts. Long enough to finish and confirm an order. */
const GUEST_SESSION_DURATION = '7d';

/* ------------------------------------------------------------------ */
/* The disclosure rule                                                 */
/* ------------------------------------------------------------------ */

/**
 * True when this account must not reveal anything it has accumulated.
 *
 * Exported and called from the profile and order-history routes rather than
 * being enforced here, because the rule has to hold at the point of disclosure
 * — a guard that only ran at session creation would be bypassed by every
 * request that came after it.
 */
const guestDisclosureBlocked = (user) =>
    user?.account_status === 'guest' && !user?.phone_verified_at;

/* ------------------------------------------------------------------ */
/* Identity lookup                                                     */
/* ------------------------------------------------------------------ */

/**
 * Answer one question and nothing more: does this number already have an
 * account someone can sign in to?
 *
 * The response is a bare boolean pair — never a name, an avatar, or a masked
 * email. Whether a given number shops here is precisely what an enumeration
 * attack is after, so the route that exposes this is rate-limited hard and the
 * payload is kept useless for building a list.
 *
 * An unclaimed guest deliberately reports `exists: false`: from the customer's
 * point of view they have no account, and offering to "sign in" to one they
 * never created would be both confusing and a disclosure.
 */
const lookupPhone = async (rawPhone) => {
    if (!isValidEgyptMobile(rawPhone)) {
        return { exists: false, can_use_password: false };
    }

    const user = await findUserByPhoneVariants(rawPhone);
    if (!user || guestDisclosureBlocked(user)) {
        return { exists: false, can_use_password: false };
    }

    return {
        exists: true,
        // Lets the screen offer "use your password" alongside the code, instead
        // of sending a code to someone who would rather just type it.
        can_use_password: !!user.password,
    };
};

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

const guestSessionPayload = (user) => ({
    id: user._id,
    name: user.name,
    email: user.email || null,
    phone: user.phone,
    profile_image: user.profile_image || null,
    role: 'user',
    account_status: user.account_status,
    phone_verified_at: user.phone_verified_at || null,
    is_guest: guestDisclosureBlocked(user),
    cars: [],
});

/**
 * Find or create the account this checkout will belong to, and hand back a
 * session for it.
 *
 * Refuses outright when the number belongs to a real account. That is the
 * single most important line in this file: without it, typing a stranger's
 * phone number into the shipping form would hand over their session. The
 * caller is told to send a code instead, which is the flow that can safely
 * prove the number belongs to whoever is asking.
 *
 * An existing UNCLAIMED guest is reused rather than duplicated, so a customer
 * who abandons a checkout and comes back keeps one identity and one order
 * history. Reuse is safe only because of the disclosure rule — the session
 * being handed over can read nothing the visitor did not just type.
 */
const startGuestSession = async ({ name, phone, language = 'en' }) => {
    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
        throw guestError('GUEST_NAME_REQUIRED', 'Please enter your name', 400);
    }
    if (!isValidEgyptMobile(phone)) {
        throw guestError('GUEST_PHONE_INVALID', 'Enter a valid Egyptian mobile number (01xxxxxxxxx)', 400);
    }

    const normalizedPhone = canonicalPhone(phone);
    const existing = await findUserByPhoneVariants(normalizedPhone);

    if (existing && !guestDisclosureBlocked(existing)) {
        throw guestError(
            'ACCOUNT_EXISTS',
            'This number already has an account. Send a code to sign in.',
            409
        );
    }

    let user = existing;
    if (user) {
        // Reuse, but refresh the name: the customer is filling in this form
        // now, and what they type now is more current than a previous attempt.
        if (user.name !== trimmedName) {
            user.name = trimmedName;
            await user.save();
        }
    } else {
        // `email` is deliberately not passed at all. The schema defaults it to
        // undefined so the key is absent from the stored document — the users
        // email index is partial on `$type: 'string'`, which excludes both an
        // absent field and an explicit null, so either would in fact be legal.
        // Absent is chosen because it is the honest shape: this account has no
        // email, rather than an email whose value is nothing.
        user = await createUser({
            name: trimmedName,
            phone: normalizedPhone,
            password: null,
            account_status: 'guest',
            preferred_language: language === 'ar' ? 'ar' : 'en',
        });
    }

    return {
        token: generateToken({ id: user._id, role: 'user' }, process.env.JWT_SECRET_USER, GUEST_SESSION_DURATION),
        user: guestSessionPayload(user),
    };
};

/* ------------------------------------------------------------------ */
/* Claiming — the code sent after the order                            */
/* ------------------------------------------------------------------ */

/**
 * Send the confirmation code for an order a guest has just placed.
 *
 * Anchored to the account rather than to the order: the code proves the phone,
 * and proving the phone is what confirms every order sitting on that account.
 */
const sendGuestConfirmation = async ({ user, language = 'en' }) => {
    if (!user) throw guestError('GUEST_SESSION_REQUIRED', 'No checkout session', 401);

    if (user.phone_verified_at) {
        throw guestError('PHONE_ALREADY_VERIFIED', 'This number is already confirmed', 409);
    }

    const issued = await issueOtp({
        channel: 'whatsapp',
        purpose: 'guest_checkout',
        destination: user.phone,
        userId: user._id,
        accountRole: 'user',
        language,
        name: user.name,
    });

    return {
        channel: 'whatsapp',
        masked_destination: issued.masked_destination,
        expires_at: issued.expires_at,
        resend_available_at: issued.resend_available_at,
    };
};

/**
 * Confirm the code, and with it the account.
 *
 * This is the only transition out of the disclosure rule, so it is the moment
 * everything the account holds becomes readable. Both fields move together:
 * `phone_verified_at` is what the guard reads, `account_status` is what ops
 * filter on, and leaving one behind would mean a claimed account that still
 * reports itself as an unclaimed one.
 */
const confirmGuestPhone = async ({ user, code }) => {
    if (!user) throw guestError('GUEST_SESSION_REQUIRED', 'No checkout session', 401);

    if (user.phone_verified_at) {
        return { already_confirmed: true, user: guestSessionPayload(user) };
    }

    await verifyOtp({
        purpose: 'guest_checkout',
        userId: user._id,
        accountRole: 'user',
        code,
    });

    const now = new Date();
    const updated = await User.findByIdAndUpdate(
        user._id,
        { $set: { phone_verified_at: now, account_status: 'active' } },
        { returnDocument: 'after' }
    ).select('-password');

    await clearOtps({ purpose: 'guest_checkout', userId: user._id, accountRole: 'user' });

    // Stamp the orders this code just vouched for, so a cash order's confirmed
    // status is answerable from the order itself rather than by joining to the
    // account that placed it.
    const { Order } = require('../models/orders');
    await Order.updateMany(
        { user_id: user._id, placed_as_guest: true, guest_phone_confirmed_at: null },
        { $set: { guest_phone_confirmed_at: now } }
    );

    return { already_confirmed: false, user: guestSessionPayload(updated) };
};

/**
 * Optionally give a claimed account a password, from the confirmation screen.
 *
 * Gated on the phone being proven. Without that gate this would be a complete
 * account-takeover primitive: type a stranger's number into checkout, get a
 * guest session, set a password, own the account.
 */
const setGuestPassword = async ({ user, password }) => {
    if (!user) throw guestError('GUEST_SESSION_REQUIRED', 'No checkout session', 401);

    if (!user.phone_verified_at) {
        throw guestError(
            'PHONE_NOT_VERIFIED',
            'Confirm the code we sent you before setting a password',
            403
        );
    }
    if (String(password || '').length < 6) {
        throw guestError('PASSWORD_TOO_SHORT', 'Password must be at least 6 characters', 400);
    }
    if (user.password) {
        throw guestError('PASSWORD_ALREADY_SET', 'This account already has a password', 409);
    }

    await User.findByIdAndUpdate(user._id, {
        $set: {
            password: await hashPassword(password),
            password_changed_at: new Date(),
            account_status: 'active',
        },
    });

    return { ok: true };
};

/* ------------------------------------------------------------------ */
/* Code sign-in for accounts that already exist                        */
/* ------------------------------------------------------------------ */

/**
 * Send a sign-in code to an existing account's number.
 *
 * Always reports success, whether or not the number resolves. The screen that
 * calls this sits in an open checkout page, so a truthful "no such account"
 * would turn it into a phone-number oracle for anyone who opened it — and the
 * honest answer is available to the real owner anyway, on their own phone.
 */
const startOtpLogin = async ({ phone, language = 'en' }) => {
    const genericResult = {
        sent: true,
        masked_destination: maskPhone(canonicalPhone(phone)),
    };

    if (!isValidEgyptMobile(phone)) return genericResult;

    const user = await findUserByPhoneVariants(phone);
    if (!user || guestDisclosureBlocked(user)) return genericResult;

    try {
        const issued = await issueOtp({
            channel: 'whatsapp',
            purpose: 'otp_login',
            destination: user.phone,
            userId: user._id,
            accountRole: 'user',
            language,
            name: user.name,
        });
        return { sent: true, masked_destination: issued.masked_destination, expires_at: issued.expires_at, resend_available_at: issued.resend_available_at };
    } catch (err) {
        // A cooldown or a send limit is the customer's own recent request. Let
        // it through as itself so the screen can show the wait — these carry no
        // information about whether the account exists, because the caller had
        // to already be in a cooldown to see one.
        if (err.code === 'OTP_RESEND_COOLDOWN' || err.code === 'OTP_RESEND_LIMIT') throw err;
        return genericResult;
    }
};

/**
 * Complete a code sign-in.
 *
 * The number must be resolved again here rather than trusted from the start
 * call, and a wrong number is reported as a bad code — the failure must look
 * identical whether the account is missing or the digits were wrong.
 */
const verifyOtpLogin = async ({ phone, code, rememberMe = false }) => {
    const badCode = () => guestError('OTP_INCORRECT', 'Incorrect or expired code', 400);

    if (!isValidEgyptMobile(phone)) throw badCode();

    const user = await findUserByPhoneVariants(phone);
    if (!user || guestDisclosureBlocked(user)) throw badCode();

    await verifyOtp({
        purpose: 'otp_login',
        userId: user._id,
        accountRole: 'user',
        code,
    });

    // Signing in with a code to the number itself proves the number. An account
    // that registered by email link has never proven its phone; this is a
    // stronger proof than it had a moment ago, so record it.
    if (!user.phone_verified_at) {
        user.phone_verified_at = new Date();
        await user.save();
    }

    return {
        token: generateToken(
            { id: user._id, role: 'user' },
            process.env.JWT_SECRET_USER,
            rememberMe ? '30d' : '1d'
        ),
        user: {
            id: user._id,
            name: user.name,
            email: user.email || null,
            profile_image: user.profile_image || null,
            role: 'user',
            account_status: user.account_status,
            is_guest: false,
            cars: user.cars || [],
        },
    };
};

/* ------------------------------------------------------------------ */
/* Claiming a placeholder account created by an invitation             */
/* ------------------------------------------------------------------ */

/**
 * Send the code that lets an invitee claim the placeholder account created for
 * them, and issue a session once they answer it.
 *
 * Deliberately separate from the checkout confirmation even though the effect on
 * the account is identical, because the two are anchored differently: checkout
 * confirms a signed-in guest session, while this runs for someone who has no
 * session at all and is identified only by an invitation token. Sharing the
 * purpose would let a code issued for one flow be spent on the other.
 */
const sendInviteClaimCode = async ({ user, language = 'en' }) => {
    if (!user) throw guestError('INVITE_TARGET_MISSING', 'This invitation is no longer valid', 404);

    const issued = await issueOtp({
        channel: 'whatsapp',
        purpose: 'invite_claim',
        destination: user.phone,
        userId: user._id,
        accountRole: 'user',
        language,
        name: user.name,
    });

    return {
        channel: 'whatsapp',
        masked_destination: issued.masked_destination,
        expires_at: issued.expires_at,
        resend_available_at: issued.resend_available_at,
    };
};

/**
 * Verify an invite claim code and hand back a session.
 *
 * `name` is taken here rather than at invitation time because this is the first
 * moment the person themselves is present to say it — until now the account has
 * carried a placeholder label chosen by the system, never a guess at who they
 * are. An account that was already real keeps the name it already had.
 */
const claimInvitedAccount = async ({ user, code, name = '', rememberMe = true }) => {
    if (!user) throw guestError('INVITE_TARGET_MISSING', 'This invitation is no longer valid', 404);

    await verifyOtp({
        purpose: 'invite_claim',
        userId: user._id,
        accountRole: 'user',
        code,
    });

    const now = new Date();
    const update = { phone_verified_at: now, account_status: 'active' };

    // Only overwrite a placeholder label. A person who already had an account
    // does not get their name rewritten by whatever an invitation form collected.
    const trimmedName = String(name || '').trim();
    if (trimmedName && guestDisclosureBlocked(user)) {
        update.name = trimmedName;
    }

    const updated = await User.findByIdAndUpdate(
        user._id,
        { $set: update },
        { returnDocument: 'after' }
    ).select('-password');

    await clearOtps({ purpose: 'invite_claim', userId: user._id, accountRole: 'user' });

    return {
        token: generateToken(
            { id: updated._id, role: 'user' },
            process.env.JWT_SECRET_USER,
            rememberMe ? '30d' : '1d'
        ),
        user: guestSessionPayload(updated),
    };
};

module.exports = {
    guestDisclosureBlocked,
    sendInviteClaimCode,
    claimInvitedAccount,
    guestSessionPayload,
    lookupPhone,
    startGuestSession,
    sendGuestConfirmation,
    confirmGuestPhone,
    setGuestPassword,
    startOtpLogin,
    verifyOtpLogin,
};
