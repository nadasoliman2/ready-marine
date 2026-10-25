const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * OtpCode — a short-lived one-time code sent over WhatsApp or email.
 *
 * Only the SHA-256 hash of the code is stored, for the same reason password
 * hashes are: a leaked database must not hand an attacker a working code. The
 * plaintext exists only in memory long enough to be delivered.
 *
 * Every code carries its own attempt counter and expiry so a brute-force guess
 * is bounded per code rather than per account, and a code cannot outlive its
 * window even if the sweep is late (a TTL index removes it regardless).
 */
const OTP_CHANNELS = ['whatsapp', 'email'];
const OTP_PURPOSES = [
    // Completing a pending registration (no account exists yet).
    'register',
    // Confirming contact details on an account the customer is signed in to.
    'verify_phone',
    'verify_email',
    // Confirming the order a guest just placed — which is also what claims the
    // account created for them during checkout. One code, two meanings, and
    // the customer is only ever told about the one they asked for.
    'guest_checkout',
    // Signing in to an existing account with a code instead of a password.
    'otp_login',
    // Accepting a Friends or Family invitation sent to a number that had no
    // account. The link proves someone received a forwarded message; this code
    // proves they hold the number — and accepting grants read access to the
    // inviter's saved addresses, so the difference matters.
    'invite_claim',
    // Resetting a forgotten password with a code sent to the account's WhatsApp number,
    // as an alternative to the emailed link.
    'password_reset',
];

const otpCodeSchema = new Schema(
    {
        channel: { type: String, enum: OTP_CHANNELS, required: true },
        purpose: { type: String, enum: OTP_PURPOSES, required: true, index: true },

        // Exactly one of these anchors the code:
        //  - verification_id for a pending registration,
        //  - user_id for a signed-in customer confirming their details.
        verification_id: { type: Schema.Types.ObjectId, ref: 'EmailVerification', default: null, index: true },
        user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
        // Which collection `user_id` points into. Customers and stores are
        // separate accounts that can hold the same email, so without this a
        // code issued to one could be looked up as the other's.
        account_role: { type: String, enum: ['user', 'vendor'], default: 'user', index: true },

        // Normalized phone or email the code was actually delivered to. Verified
        // against at confirm time so a code issued for one destination can never
        // validate a different one.
        destination: { type: String, required: true },

        code_hash: { type: String, required: true },
        attempts: { type: Number, default: 0 },
        max_attempts: { type: Number, default: 5 },

        expires_at: { type: Date, required: true },
        consumed_at: { type: Date, default: null },

        // Provider handle for the delivery attempt (the WhatsApp campaign id),
        // so a "no code arrived" report can be traced without ever storing the
        // code in readable form.
        delivery_reference: { type: String, default: null },

        // Resend throttling state.
        last_sent_at: { type: Date, default: Date.now },
        resend_count: { type: Number, default: 0 },

        created_at: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

// Codes are worthless once expired — let the database reclaim them even if no
// application sweep runs.
otpCodeSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
// The lookup performed on every confirm attempt.
otpCodeSchema.index({ purpose: 1, destination: 1, consumed_at: 1 });

const OtpCode = mongoose.model('OtpCode', otpCodeSchema);

module.exports = { OtpCode, OTP_CHANNELS, OTP_PURPOSES };
