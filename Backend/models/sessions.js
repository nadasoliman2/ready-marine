const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * Session — one signed-in browser of a customer or a store (services/sessionService.js).
 *
 * The browser holds a short access token (`token` cookie, minutes) and a refresh token
 * (`refresh_token` cookie). Only the SHA-256 hash of the refresh token is stored, so a leaked
 * database hands out no working session. Every refresh swaps in a new refresh token and keeps
 * the previous hash for a short grace window (two tabs refreshing at once); the previous one
 * presented after that window means a copy is in someone else's hands, and the session ends.
 *
 * A session lasts `duration_ms` from its last refresh: in use it never ends, left idle for
 * the whole length it does (a TTL index removes it regardless).
 */
const sessionSchema = new Schema(
    {
        account_id: { type: Schema.Types.ObjectId, required: true, index: true },
        role: { type: String, enum: ['user', 'vendor'], required: true },

        token_hash: { type: String, required: true },
        previous_hash: { type: String, default: null },
        rotated_at: { type: Date, default: null },

        duration_ms: { type: Number, required: true },
        expires_at: { type: Date, required: true },
        // "Remember me": the cookies outlive the browser. Otherwise they go when it closes.
        persistent: { type: Boolean, default: false },

        user_agent: { type: String, default: '' },
        ip: { type: String, default: '' },
        last_used_at: { type: Date, default: Date.now },
        revoked_at: { type: Date, default: null },
        created_at: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

sessionSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ account_id: 1, role: 1, revoked_at: 1 });

const Session = mongoose.model('Session', sessionSchema);

module.exports = { Session };
