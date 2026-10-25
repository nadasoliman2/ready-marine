const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * Friendship — a SYMMETRIC, many-to-many relationship between two customers.
 *
 * Unlike Family (one organizer, many members, one membership per account), a
 * customer may have any number of friends and neither side outranks the other.
 * Either can buy for the other on a different order.
 *
 * Symmetry is enforced by storage, not by convention: the two user ids are
 * always sorted before persistence, so A↔B and B↔A resolve to the same row and
 * the unique index makes a duplicate pair impossible.
 *
 * One row exists per pair FOREVER. Removing a friendship flips `status` rather
 * than deleting, so re-friending reuses the row instead of racing the index,
 * and the history of a past relationship is not silently erased.
 */

/** Canonical ordering for a pair of customer ids. */
const orderPair = (a, b) => {
    const left = String(a);
    const right = String(b);
    return left < right
        ? { user_low_id: a, user_high_id: b }
        : { user_low_id: b, user_high_id: a };
};

const friendshipSchema = new Schema(
    {
        user_low_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        user_high_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        initiated_by_user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },

        status: { type: String, enum: ['active', 'removed', 'blocked'], default: 'active', index: true },
        // Set only while status is 'blocked'. The blocker is the only account
        // that may lift it; the blocked side cannot re-friend around it.
        blocked_by_user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },

        accepted_at: { type: Date, default: Date.now },
        ended_at: { type: Date, default: null },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

friendshipSchema.index(
    { user_low_id: 1, user_high_id: 1 },
    { unique: true, name: 'unique_customer_pair' }
);
// Lookup of "all my friends" from either side of the pair.
friendshipSchema.index({ user_low_id: 1, status: 1 });
friendshipSchema.index({ user_high_id: 1, status: 1 });

friendshipSchema.pre('save', function () {
    this.updated_at = new Date();
});

/**
 * FriendInvitation — a pending request from one customer to another.
 *
 * Authorization is by `recipient_user_id`, never by the raw contact identifier
 * the sender typed: the identifier is only used to resolve the account once,
 * then discarded down to a masked form for the sender's own display.
 *
 * The recipient does NOT have to be an existing customer. When a phone number
 * has no account, a placeholder guest account is created and pointed at here —
 * which is why this field can stay required, and why every downstream rule
 * (pair uniqueness, address shares, buying for each other) keeps working
 * untouched. What changes is only how the invitation is delivered and answered:
 * a real account gets an in-app notification, a placeholder gets a WhatsApp
 * link plus the code that claims it.
 */
const friendInvitationSchema = new Schema(
    {
        sender_user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        recipient_user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

        // Denormalized sorted pair, so the "one pending request per pair"
        // constraint can be a real database index rather than a race-prone read.
        pair_low_id: { type: Schema.Types.ObjectId, required: true },
        pair_high_id: { type: Schema.Types.ObjectId, required: true },

        identifier_type: { type: String, enum: ['email', 'phone'], required: true },
        // Masked only — never the full email or phone number.
        identifier_masked: { type: String, default: '' },

        // Addresses the SENDER offers up-front; applied when the invite is accepted.
        sender_shared_address_ids: [{ type: Schema.Types.ObjectId }],

        status: {
            type: String,
            enum: ['pending', 'accepted', 'declined', 'cancelled', 'expired'],
            default: 'pending',
            index: true,
        },
        expires_at: { type: Date, required: true, index: true },
        responded_at: { type: Date, default: null },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },

        /* ---- Invitations to someone who had no account ---- */

        // How this invitation reached the recipient. 'in_app' is the original
        // behaviour and needs no token: the recipient is already a customer and
        // answers it from their Friends tab.
        channel: { type: String, enum: ['in_app', 'whatsapp'], default: 'in_app', index: true },

        // Set only for 'whatsapp'. Only the sha256 hash is persisted — the raw
        // token exists just long enough to be put in one message, exactly as a
        // password reset token does.
        token_hash: { type: String, default: null, index: true },

        // True when accepting this invitation will also CLAIM the recipient's
        // account, because it was created for them by this invitation. Recorded
        // rather than re-derived so that an account which is later claimed some
        // other way does not retroactively rewrite how this invite was sent.
        created_recipient_account: { type: Boolean, default: false },

        // Provider handle for the WhatsApp send, so "I never got a link" is
        // answerable without ever storing the token in readable form.
        delivery_reference: { type: String, default: null },
        last_sent_at: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

// At most one PENDING invitation per unordered pair, in either direction. If B
// already invited A, A must answer that request instead of creating a mirror.
friendInvitationSchema.index(
    { pair_low_id: 1, pair_high_id: 1 },
    { unique: true, partialFilterExpression: { status: 'pending' }, name: 'one_pending_invite_per_pair' }
);

friendInvitationSchema.pre('save', function () {
    this.updated_at = new Date();
});

/**
 * FriendAddressShare — one row per granted address, per direction.
 *
 * Sharing is DIRECTIONAL: A sharing an address with B says nothing about what B
 * shares with A. The row grants selection permission only; the address itself
 * stays embedded on the owner's `User` document and is never copied here, so an
 * edit or deletion by the owner takes effect everywhere at once.
 */
const friendAddressShareSchema = new Schema(
    {
        friendship_id: { type: Schema.Types.ObjectId, ref: 'Friendship', required: true, index: true },
        // Whose address book the id belongs to.
        owner_user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        // Who is permitted to select it at checkout.
        viewer_user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        address_id: { type: Schema.Types.ObjectId, required: true },
        created_at: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

friendAddressShareSchema.index(
    { friendship_id: 1, owner_user_id: 1, viewer_user_id: 1, address_id: 1 },
    { unique: true, name: 'unique_address_grant' }
);
// "What did this friend share with me?" — the checkout lookup.
friendAddressShareSchema.index({ viewer_user_id: 1, owner_user_id: 1 });

/**
 * FriendEmailInvite — a friend invitation to an email address with NO account yet.
 *
 * A FriendInvitation needs a recipient account, and an email address alone cannot carry
 * one (`phone` is required and unique on a user). So the invitation waits here, the
 * person is emailed, and the moment an account is created with this address it becomes
 * a normal in-app FriendInvitation (`convertPendingEmailInvites`).
 */
const friendEmailInviteSchema = new Schema(
    {
        sender_user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        email: { type: String, required: true, lowercase: true, trim: true },
        sender_shared_address_ids: [{ type: Schema.Types.ObjectId }],
        status: { type: String, enum: ['pending', 'converted', 'expired'], default: 'pending' },
        expires_at: { type: Date, required: true },
        converted_invitation_id: { type: Schema.Types.ObjectId, ref: 'FriendInvitation', default: null },
        language: { type: String, default: 'en' },
        created_at: { type: Date, default: Date.now },
    },
    { versionKey: false }
);
friendEmailInviteSchema.index({ email: 1, status: 1 });
friendEmailInviteSchema.index({ sender_user_id: 1, email: 1, status: 1 });

const Friendship = mongoose.model('Friendship', friendshipSchema);
const FriendEmailInvite = mongoose.model('FriendEmailInvite', friendEmailInviteSchema);
const FriendInvitation = mongoose.model('FriendInvitation', friendInvitationSchema);
const FriendAddressShare = mongoose.model('FriendAddressShare', friendAddressShareSchema);

module.exports = {
    Friendship,
    FriendEmailInvite,
    FriendInvitation,
    FriendAddressShare,
    orderPair,
};
