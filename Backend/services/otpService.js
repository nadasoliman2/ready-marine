const crypto = require('crypto');

const { OtpCode } = require('../models/otpCodes');
const { authorizationError } = require('./shared/addressAuthorization');

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const CODE_LENGTH = 6;
const TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES) > 0 ? Number(process.env.OTP_TTL_MINUTES) : 10;
/**
 * Deliberately longer than the observed WhatsApp delivery latency.
 *
 * Measured against this provider: UTILITY templates arrive in ~3s, but the
 * AUTHENTICATION `otp_code` template took ~60s — and two codes sent 53s apart
 * to the same number were both silently dropped, while an isolated send
 * arrived. Rapid repeats to one recipient appear to be suppressed upstream, so
 * a 60s cooldown would invite a resend at exactly the wrong moment and lose
 * both messages. Wait past the delivery window before allowing another.
 */
const RESEND_COOLDOWN_SECONDS = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS) > 0
    ? Number(process.env.OTP_RESEND_COOLDOWN_SECONDS)
    : 120;
const MAX_RESENDS = Number(process.env.OTP_MAX_RESENDS) > 0 ? Number(process.env.OTP_MAX_RESENDS) : 5;
const MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS) > 0 ? Number(process.env.OTP_MAX_ATTEMPTS) : 5;

/** EverySecond template `otp_code` (AUTHENTICATION, one variable: the code). */
const WHATSAPP_OTP_TEMPLATE_ID = Number(process.env.WHATSAPP_OTP_TEMPLATE_ID || 1);

const otpError = authorizationError;

/* ------------------------------------------------------------------ */
/* Code generation                                                     */
/* ------------------------------------------------------------------ */

/**
 * Generate a uniformly-distributed numeric code.
 *
 * `randomInt` is used rather than `randomBytes % 10` because the modulo of a
 * byte over ten is biased toward the low digits, which measurably shrinks the
 * search space of a 6-digit code.
 */
const generateCode = () => {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += crypto.randomInt(0, 10);
    return code;
};

/**
 * Server-side pepper for code hashing.
 *
 * A bare SHA-256 of a 6-digit code is reversible in under a second — the whole
 * keyspace is a million entries — so a plain digest would give anyone with read
 * access to the database every live code. Keying the digest with a secret the
 * database does not contain means stolen rows alone are not enough.
 */
const OTP_PEPPER = process.env.OTP_PEPPER
    || process.env.JWT_SECRET_USER
    || process.env.COOKIE_SECRET
    || '';

if (!OTP_PEPPER && process.env.NODE_ENV === 'production') {
    console.warn('[OTP] No OTP_PEPPER/JWT_SECRET_USER set — codes are hashed without a server secret.');
}

const hashCode = (code) => crypto
    .createHmac('sha256', OTP_PEPPER)
    .update(String(code))
    .digest('hex');

/**
 * Compare in constant time so the comparison itself cannot leak how many
 * leading digits were correct.
 */
const codeMatches = (candidate, storedHash) => {
    const candidateHash = Buffer.from(hashCode(candidate));
    const expected = Buffer.from(String(storedHash || ''));
    if (candidateHash.length !== expected.length) return false;
    return crypto.timingSafeEqual(candidateHash, expected);
};

/* ------------------------------------------------------------------ */
/* Delivery                                                            */
/* ------------------------------------------------------------------ */

const deliverWhatsapp = async ({ destination, code, purpose }) => {
    const whatsappService = require('./whatsappService');
    return await whatsappService.sendTemplateMessage({
        phone: destination,
        templateId: WHATSAPP_OTP_TEMPLATE_ID,
        // The `otp_code` template takes exactly one variable: the code itself.
        variables: { 1: code },
        // Dashboard label only — deliberately free of the code and the number.
        campaignName: `Verification code (${purpose})`,
    });
};

const deliverEmail = async ({ destination, code, language, name }) => {
    const { sendOtpEmail } = require('./emailService');
    return await sendOtpEmail({
        to: destination,
        name,
        code,
        expiryMinutes: TTL_MINUTES,
        language,
    });
};

/* ------------------------------------------------------------------ */
/* Issuing                                                             */
/* ------------------------------------------------------------------ */

const anchorFilter = ({ purpose, userId, verificationId, accountRole = 'user' }) => {
    const filter = { purpose, consumed_at: null };
    // A signed-in account is anchored by id AND by which collection that id
    // lives in: a customer and a store are separate accounts that may share an
    // email, so the role is part of the identity, not a label on it.
    if (userId) {
        filter.user_id = userId;
        filter.account_role = accountRole;
    }
    if (verificationId) filter.verification_id = verificationId;
    return filter;
};

/**
 * Issue and deliver a one-time code.
 *
 * Any earlier unconsumed code for the same anchor is invalidated first, so only
 * the most recently delivered code can ever work — otherwise a customer who
 * requested three codes would leave three valid ones outstanding.
 *
 * Resend pacing is carried forward from the superseded code so requesting a new
 * code cannot be used to reset the cooldown.
 */
const issueOtp = async ({
    channel,
    purpose,
    destination,
    userId = null,
    verificationId = null,
    accountRole = 'user',
    language = 'en',
    name = '',
}) => {
    if (!destination) throw otpError('OTP_DESTINATION_REQUIRED', 'No destination to send the code to', 400);

    const previous = await OtpCode.findOne(anchorFilter({ purpose, userId, verificationId, accountRole }))
        .sort({ created_at: -1 });

    if (previous) {
        const sinceLastSend = Date.now() - new Date(previous.last_sent_at).getTime();
        const waitMs = RESEND_COOLDOWN_SECONDS * 1000 - sinceLastSend;
        if (waitMs > 0) {
            const err = otpError(
                'OTP_RESEND_COOLDOWN',
                `Please wait ${Math.ceil(waitMs / 1000)} seconds before requesting another code`,
                429
            );
            err.retryAfterSeconds = Math.ceil(waitMs / 1000);
            throw err;
        }
        if (previous.resend_count + 1 >= MAX_RESENDS) {
            throw otpError(
                'OTP_RESEND_LIMIT',
                'Too many codes requested. Please try again later.',
                429
            );
        }
    }

    const code = generateCode();
    const resendCount = previous ? previous.resend_count + 1 : 0;

    // Retire the old code BEFORE delivering the new one, so a delivery that
    // races a confirm cannot leave two live codes.
    await OtpCode.updateMany(
        anchorFilter({ purpose, userId, verificationId, accountRole }),
        { consumed_at: new Date() }
    );

    const record = await OtpCode.create({
        channel,
        purpose,
        verification_id: verificationId,
        user_id: userId,
        account_role: accountRole,
        destination,
        code_hash: hashCode(code),
        max_attempts: MAX_ATTEMPTS,
        expires_at: new Date(Date.now() + TTL_MINUTES * 60 * 1000),
        last_sent_at: new Date(),
        resend_count: resendCount,
    });

    let deliveryReference = null;
    try {
        if (channel === 'whatsapp') {
            const sent = await deliverWhatsapp({ destination, code, purpose });
            // The provider campaign id. Recorded so "I never received a code"
            // is answerable — it is the only handle support can poll, since the
            // code itself is never stored in a readable form.
            deliveryReference = sent?.campaignId || null;
            if (deliveryReference) {
                await OtpCode.updateOne({ _id: record._id }, { delivery_reference: String(deliveryReference) });
            }
        } else {
            await deliverEmail({ destination, code, language, name });
        }
    } catch (err) {
        // Nothing was delivered — drop the code rather than leave the customer
        // waiting on a message that will never arrive.
        await OtpCode.deleteOne({ _id: record._id });
        throw otpError(
            'OTP_DELIVERY_FAILED',
            channel === 'whatsapp'
                ? `Could not send the WhatsApp code: ${err.message}`
                : `Could not send the email code: ${err.message}`,
            502
        );
    }

    return {
        channel,
        // Never the code itself, and never the full destination.
        masked_destination: maskDestination(channel, destination),
        expires_at: record.expires_at,
        resend_available_at: new Date(Date.now() + RESEND_COOLDOWN_SECONDS * 1000),
        delivery_reference: deliveryReference,
    };
};

/** Show enough of the destination to recognise it, not enough to disclose it. */
const maskDestination = (channel, destination) => {
    const value = String(destination || '');
    if (channel === 'email') {
        const [local, domain] = value.split('@');
        if (!domain) return value;
        return `${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
    }
    return `${'*'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
};

/* ------------------------------------------------------------------ */
/* Verifying                                                           */
/* ------------------------------------------------------------------ */

/**
 * Check a submitted code and consume it on success.
 *
 * A wrong guess increments the attempt counter atomically; hitting the cap
 * burns the code entirely, so an attacker cannot keep guessing by racing
 * parallel requests against the same code.
 */
const verifyOtp = async ({ purpose, code, userId = null, verificationId = null, accountRole = 'user' }) => {
    const submitted = String(code || '').trim();
    if (!/^\d{6}$/.test(submitted)) {
        throw otpError('OTP_INVALID_FORMAT', 'Enter the 6-digit code', 400);
    }

    const record = await OtpCode.findOne(anchorFilter({ purpose, userId, verificationId, accountRole }))
        .sort({ created_at: -1 });

    if (!record) {
        throw otpError('OTP_NOT_FOUND', 'No active code. Request a new one.', 404);
    }
    if (record.expires_at <= new Date()) {
        await OtpCode.updateOne({ _id: record._id }, { consumed_at: new Date() });
        throw otpError('OTP_EXPIRED', 'This code has expired. Request a new one.', 410);
    }
    if (record.attempts >= record.max_attempts) {
        await OtpCode.updateOne({ _id: record._id }, { consumed_at: new Date() });
        throw otpError('OTP_TOO_MANY_ATTEMPTS', 'Too many incorrect attempts. Request a new code.', 429);
    }

    if (!codeMatches(submitted, record.code_hash)) {
        const updated = await OtpCode.findOneAndUpdate(
            { _id: record._id, consumed_at: null },
            { $inc: { attempts: 1 } },
            { returnDocument: 'after' }
        );
        const remaining = Math.max(0, (updated?.max_attempts ?? MAX_ATTEMPTS) - (updated?.attempts ?? MAX_ATTEMPTS));
        if (remaining === 0) {
            await OtpCode.updateOne({ _id: record._id }, { consumed_at: new Date() });
            throw otpError('OTP_TOO_MANY_ATTEMPTS', 'Too many incorrect attempts. Request a new code.', 429);
        }
        const err = otpError('OTP_INCORRECT', `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} left.`, 400);
        err.attemptsRemaining = remaining;
        throw err;
    }

    // Single-use: consume conditionally so two simultaneous correct submissions
    // cannot both succeed.
    const consumed = await OtpCode.findOneAndUpdate(
        { _id: record._id, consumed_at: null },
        { consumed_at: new Date() },
        { returnDocument: 'after' }
    );
    if (!consumed) {
        throw otpError('OTP_ALREADY_USED', 'This code was already used. Request a new one.', 409);
    }

    return { destination: record.destination, channel: record.channel };
};

/** Discard any outstanding codes for an anchor (e.g. after a successful flow). */
const clearOtps = async ({ purpose, userId = null, verificationId = null, accountRole = 'user' }) => {
    await OtpCode.updateMany(anchorFilter({ purpose, userId, verificationId, accountRole }), { consumed_at: new Date() });
};

module.exports = {
    CODE_LENGTH,
    TTL_MINUTES,
    RESEND_COOLDOWN_SECONDS,
    MAX_ATTEMPTS,
    WHATSAPP_OTP_TEMPLATE_ID,
    generateCode,
    hashCode,
    issueOtp,
    verifyOtp,
    clearOtps,
    maskDestination,
    otpError,
};
