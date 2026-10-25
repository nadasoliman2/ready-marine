const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * Relationship labels are descriptive only — they never grant permissions.
 * Authorization comes from the membership role (organizer / member).
 */
const RELATIONSHIPS = ['son', 'daughter', 'husband', 'wife', 'parent', 'sibling', 'other'];

/* ------------------ Family ------------------ */
const familySchema = new Schema(
    {
        name: { type: String, default: '' },
        organizer_user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        status: { type: String, enum: ['active', 'dissolved'], default: 'active', index: true },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

familySchema.pre('save', function () {
    // Mongoose 9 document middleware is promise-based — no `next` callback.
    this.updated_at = new Date();
});

/* ------------------ Family Membership ------------------ */
const familyMembershipSchema = new Schema(
    {
        family_id: { type: Schema.Types.ObjectId, ref: 'Family', required: true, index: true },
        // Intentionally NOT `index: true` — the unique partial index declared
        // below covers this key, and both would claim the name `user_id_1`.
        user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        role: { type: String, enum: ['organizer', 'member'], required: true },
        relationship: { type: String, enum: RELATIONSHIPS, default: 'other' },
        // Subset of the ORGANIZER's embedded address _ids this member may use.
        shared_address_ids: [{ type: Schema.Types.ObjectId }],
        status: { type: String, enum: ['active', 'left', 'removed'], default: 'active', index: true },
        joined_at: { type: Date, default: Date.now },
        ended_at: { type: Date, default: null },
    },
    { timestamps: false }
);

// MVP rule: one ACTIVE membership per customer account. The partial filter keeps
// historical (left/removed) rows from blocking a later join.
familyMembershipSchema.index(
    { user_id: 1 },
    { unique: true, partialFilterExpression: { status: 'active' }, name: 'one_active_membership_per_user' }
);
familyMembershipSchema.index({ family_id: 1, status: 1 });

/* ------------------ Family Invitation ------------------ */
const familyInvitationSchema = new Schema(
    {
        family_id: { type: Schema.Types.ObjectId, ref: 'Family', required: true, index: true },
        invited_by_user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },

        /**
         * Exactly one of `email` or `phone` identifies the invitee.
         *
         * `email` was required until family invitations could also be sent over
         * WhatsApp. It stays the identity for every invitation that already
         * exists and for every one sent to an address; a phone invitation
         * carries `phone` instead and is answered with a code rather than by
         * signing in with a matching mailbox.
         *
         * Both are normalized on the way in — the email through the auth
         * normalizer, the phone through `canonicalPhone` — so the same person
         * cannot be invited twice under two spellings of the same identifier.
         */
        email: { type: String, required: false, default: null, lowercase: true, trim: true, index: true },
        phone: { type: String, required: false, default: null, trim: true, index: true },
        // How this invitation was delivered, and therefore how it is answered.
        channel: { type: String, enum: ['email', 'whatsapp'], default: 'email', index: true },
        // The account the invitation resolves to. Null for an email invitation
        // to an address with no account — there is nothing to point at, and the
        // invitee is identified by the mailbox they sign in with. Always set for
        // a phone invitation, because a number with no account gets a
        // placeholder guest one created for it.
        invited_user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
        // True when accepting will also CLAIM that account, because this
        // invitation is what brought it into existence.
        created_invited_account: { type: Boolean, default: false },
        delivery_reference: { type: String, default: null },
        relationship: { type: String, enum: RELATIONSHIPS, default: 'other' },
        shared_address_ids: [{ type: Schema.Types.ObjectId }],
        // Only the sha256 hash of the single-use token is persisted.
        token_hash: { type: String, required: true, index: true },
        status: {
            type: String,
            enum: ['pending', 'accepted', 'declined', 'expired', 'revoked'],
            default: 'pending',
            index: true,
        },
        expires_at: { type: Date, required: true, index: true },
        accepted_by_user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        last_sent_at: { type: Date, default: Date.now },
        created_at: { type: Date, default: Date.now },
        updated_at: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

familyInvitationSchema.index({ family_id: 1, email: 1, status: 1 });
// The same question for a phone invitation: "is one already pending for this
// person in this family?" Indexed rather than scanned for the same reason.
familyInvitationSchema.index({ family_id: 1, phone: 1, status: 1 });

familyInvitationSchema.pre('save', function () {
    // Mongoose 9 document middleware is promise-based — no `next` callback.
    this.updated_at = new Date();
});

const Family = mongoose.model('Family', familySchema);
const FamilyMembership = mongoose.model('FamilyMembership', familyMembershipSchema);
const FamilyInvitation = mongoose.model('FamilyInvitation', familyInvitationSchema);

module.exports = {
    Family,
    FamilyMembership,
    FamilyInvitation,
    RELATIONSHIPS,
};
