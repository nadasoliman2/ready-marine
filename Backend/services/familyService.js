const crypto = require('crypto');
const mongoose = require('mongoose');

const { User } = require('../models/users');
const { Family, FamilyMembership, FamilyInvitation, RELATIONSHIPS } = require('../models/families');
const { recordAuditLog } = require('../models/auditLog');
const { sendFamilyInvitationEmail } = require('./emailService');
const {
    buildInviteLandingUrl,
    parseInviteIdentifier,
    maskInviteIdentifier,
    resolveInviteTarget,
    sendWhatsappInvite,
} = require('./shared/guestInvites');
const { guestDisclosureBlocked } = require('./guestCheckoutService');
const { notifyCustomer } = require('./customerNotificationService');
const {
    normalizeEmailForAuth,
    formatPhone,
    hashPassword,
    generateToken,
} = require('./authService');
const {
    authorizationError,
    sharedAddressShape,
    assertOwnedAddressIds,
} = require('./shared/addressAuthorization');

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const INVITATION_TTL_DAYS = 7;
/**
 * How many invitations one family may have outstanding at once.
 *
 * A brake that only started to matter when invitations could go to numbers with
 * no account: each one creates a row and sends a WhatsApp message, so without a
 * cap the Family tab is a bulk-messaging endpoint attached to the store's own
 * sender reputation. Accepted and declined invitations stop counting.
 */
const MAX_PENDING_INVITATIONS = 20;

const getFrontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

const buildInvitationUrl = (token) => `${getFrontendUrl()}/family/invitation/${encodeURIComponent(token)}`;

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const RELATIONSHIP_LABELS = {
    son: { en: 'son', ar: 'ابن' },
    daughter: { en: 'daughter', ar: 'ابنة' },
    husband: { en: 'husband', ar: 'زوج' },
    wife: { en: 'wife', ar: 'زوجة' },
    parent: { en: 'parent', ar: 'والد/والدة' },
    sibling: { en: 'sibling', ar: 'أخ/أخت' },
    other: { en: 'family member', ar: 'فرد من العائلة' },
};

const relationshipLabel = (relationship, language = 'en') =>
    (RELATIONSHIP_LABELS[relationship] || RELATIONSHIP_LABELS.other)[language === 'ar' ? 'ar' : 'en'];

const normalizeRelationship = (value) => (RELATIONSHIPS.includes(value) ? value : 'other');

/** Domain error with a machine-readable `code` the routes map to HTTP statuses. */
const familyError = authorizationError;

/** Minimal public shape of a customer, safe to show inside a family. */
const publicUserShape = (user) => user ? ({
    _id: user._id,
    name: user.name,
    email: user.email,
    profile_image: user.profile_image || null,
}) : null;

// Address shapes and ownership checks live in shared/addressAuthorization —
// Family and Friends must never drift on what a viewer is allowed to see.

/* ------------------------------------------------------------------ */
/* Membership resolution                                               */
/* ------------------------------------------------------------------ */

/**
 * Resolve the caller's active family position from the database.
 *
 * This is the single authorization primitive for the whole feature: no route
 * ever accepts an organizer id, family id, or address id from the client as
 * proof of authority — everything is re-derived here.
 */
const resolveFamilyContext = async (userId) => {
    const membership = await FamilyMembership.findOne({ user_id: userId, status: 'active' });
    if (!membership) return { membership: null, family: null, role: null };

    const family = await Family.findById(membership.family_id);
    if (!family || family.status !== 'active') return { membership: null, family: null, role: null };

    return { membership, family, role: membership.role };
};

const requireOrganizer = async (userId) => {
    const context = await resolveFamilyContext(userId);
    if (!context.family || context.role !== 'organizer') {
        throw familyError('NOT_ORGANIZER', 'You are not a family organizer', 403);
    }
    return context;
};

const requireMember = async (userId) => {
    const context = await resolveFamilyContext(userId);
    if (!context.family || context.role !== 'member') {
        throw familyError('NOT_FAMILY_MEMBER', 'You are not part of a family', 403);
    }
    return context;
};

/* ------------------------------------------------------------------ */
/* Family tab payload                                                  */
/* ------------------------------------------------------------------ */

/** Expire stale pending invitations lazily whenever the family is read. */
const expireStaleInvitations = async (familyId) => {
    await FamilyInvitation.updateMany(
        { family_id: familyId, status: 'pending', expires_at: { $lte: new Date() } },
        { status: 'expired', updated_at: new Date() }
    );
};

/**
 * Everything the Family tab needs, shaped by the caller's role.
 * Returns `{ role: null }` when the customer has no family yet.
 */
const getFamilyOverview = async (userId) => {
    const { membership, family, role } = await resolveFamilyContext(userId);
    if (!family) return { role: null, family: null };

    await expireStaleInvitations(family._id);

    const organizer = await User.findById(family.organizer_user_id).select('name email profile_image addresses');

    if (role === 'organizer') {
        const memberships = await FamilyMembership.find({
            family_id: family._id,
            role: 'member',
            status: 'active',
        }).sort({ joined_at: 1 });

        const memberUsers = await User.find({ _id: { $in: memberships.map((m) => m.user_id) } })
            .select('name email profile_image');
        const userMap = new Map(memberUsers.map((u) => [u._id.toString(), u]));

        const invitations = await FamilyInvitation.find({ family_id: family._id, status: 'pending' })
            .sort({ created_at: -1 })
            .lean();

        return {
            role: 'organizer',
            family: { _id: family._id, name: family.name, status: family.status },
            organizer: publicUserShape(organizer),
            // The organizer's own addresses, so they can pick what to share.
            addresses: (organizer?.addresses || []).map(sharedAddressShape),
            members: memberships.map((m) => ({
                _id: m._id,
                user: publicUserShape(userMap.get(m.user_id.toString())),
                relationship: m.relationship,
                shared_address_ids: m.shared_address_ids.map(String),
                joined_at: m.joined_at,
            })),
            invitations: invitations.map((inv) => ({
                _id: inv._id,
                email: inv.email,
                relationship: inv.relationship,
                shared_address_ids: (inv.shared_address_ids || []).map(String),
                created_at: inv.created_at,
                last_sent_at: inv.last_sent_at,
                expires_at: inv.expires_at,
            })),
        };
    }

    // ---- Member view ----
    const sharedIds = new Set(membership.shared_address_ids.map(String));
    const sharedAddresses = (organizer?.addresses || [])
        .filter((a) => sharedIds.has(a._id.toString()))
        .map(sharedAddressShape);

    return {
        role: 'member',
        family: { _id: family._id, name: family.name, status: family.status },
        organizer: publicUserShape(organizer),
        membership: {
            _id: membership._id,
            relationship: membership.relationship,
            joined_at: membership.joined_at,
        },
        shared_addresses: sharedAddresses,
    };
};

/**
 * Shared addresses a member may use at checkout. Resolved from the organizer's
 * live address list intersected with this member's permission, so unsharing or
 * deleting an address takes effect immediately.
 */
const getSharedAddressesForMember = async (userId) => {
    const { membership, family } = await resolveFamilyContext(userId);
    if (!family || membership.role !== 'member') return { organizer: null, addresses: [] };

    const organizer = await User.findById(family.organizer_user_id).select('name profile_image addresses');
    const sharedIds = new Set(membership.shared_address_ids.map(String));

    return {
        organizer: publicUserShape(organizer),
        relationship: membership.relationship,
        addresses: (organizer?.addresses || [])
            .filter((a) => sharedIds.has(a._id.toString()))
            .map(sharedAddressShape),
    };
};

/* ------------------------------------------------------------------ */
/* Invitations                                                         */
/* ------------------------------------------------------------------ */

/** Validate that every requested address id really belongs to the organizer. */
const assertAddressesOwnedByOrganizer = (organizer, addressIds = []) =>
    assertOwnedAddressIds(organizer, addressIds).map((id) => new mongoose.Types.ObjectId(id));

/** The family is created implicitly the first time an organizer invites someone. */
const getOrCreateFamilyForOrganizer = async (userId) => {
    const existing = await resolveFamilyContext(userId);
    if (existing.family) {
        if (existing.role !== 'organizer') {
            throw familyError(
                'ALREADY_IN_FAMILY',
                'You already belong to a family as a member. Leave it before starting your own.',
                409
            );
        }
        return existing.family;
    }

    const organizer = await User.findById(userId).select('name');
    const family = await Family.create({
        name: organizer?.name ? `${organizer.name}'s family` : 'Family',
        organizer_user_id: userId,
        status: 'active',
    });

    try {
        await FamilyMembership.create({
            family_id: family._id,
            user_id: userId,
            role: 'organizer',
            relationship: 'other',
            shared_address_ids: [],
            status: 'active',
        });
    } catch (err) {
        // Unique-active-membership index lost a race — clean up the orphan family.
        await Family.deleteOne({ _id: family._id });
        throw familyError('ALREADY_IN_FAMILY', 'You already belong to a family', 409);
    }

    return family;
};

/**
 * Invite someone by email or mobile number — whether or not they are a customer.
 *
 * A mobile number with no account gets a PLACEHOLDER guest account created for
 * it and a WhatsApp link; an email keeps the original behaviour of a token sent
 * to a mailbox, claimed by whoever signs in with it. The difference is not a
 * preference: `phone` is the required, unique field on a user, so a number can
 * anchor an account and an address cannot.
 *
 * The response still never reveals whether the identifier already belongs to
 * another family. Membership conflicts are explained privately at acceptance
 * time instead, to the person they actually concern.
 */
const inviteFamilyMember = async (organizerId, { email, identifier, relationship, shared_address_ids = [] }, { language = 'en' } = {}) => {
    // `email` is still accepted under its own name so existing callers keep
    // working; `identifier` is the one that may also be a mobile number.
    const parsed = parseInviteIdentifier(identifier || email);
    if (!parsed.type) {
        throw familyError('INVALID_IDENTIFIER', 'Enter a valid email address or mobile number', 400);
    }

    const organizer = await User.findById(organizerId).select('name email phone addresses preferred_language');
    if (!organizer) throw familyError('USER_NOT_FOUND', 'User not found', 404);

    const ownEmail = parseInviteIdentifier(organizer.email || '');
    const ownPhone = parseInviteIdentifier(organizer.phone || '');
    if ((ownEmail.normalized && parsed.normalized === ownEmail.normalized)
        || (ownPhone.normalized && parsed.normalized === ownPhone.normalized)) {
        throw familyError('CANNOT_INVITE_SELF', 'You cannot invite yourself', 400);
    }

    const family = await getOrCreateFamilyForOrganizer(organizerId);
    const addressIds = assertAddressesOwnedByOrganizer(organizer, shared_address_ids);

    const { user: invitedUser, created } = await resolveInviteTarget(parsed, {
        inviterName: organizer.name,
        language,
        // As with Friends: an email has nothing to hang an account on, because
        // `phone` is required and unique on a user. Email invitations therefore
        // keep their original shape — a token to a mailbox, claimed by whoever
        // signs in with it.
        allowCreate: parsed.type === 'phone',
    });

    // Already an active member of THIS family — safe to disclose to the organizer.
    if (invitedUser) {
        const existingMembership = await FamilyMembership.findOne({
            family_id: family._id,
            user_id: invitedUser._id,
            status: 'active',
        });
        if (existingMembership) {
            throw familyError('ALREADY_MEMBER', 'This person is already in your family', 409);
        }
    }

    await expireStaleInvitations(family._id);

    const pendingFilter = parsed.type === 'email'
        ? { family_id: family._id, email: parsed.normalized, status: 'pending' }
        : { family_id: family._id, phone: parsed.normalized, status: 'pending' };
    if (await FamilyInvitation.findOne(pendingFilter)) {
        throw familyError(
            'INVITATION_EXISTS',
            'An invitation is already pending for this person. Resend it instead.',
            409
        );
    }

    // A cap on how many invitations one organizer can have outstanding. It
    // matters more now than it did: a phone invitation creates an account and
    // sends a WhatsApp message, so without this the family tab is a bulk
    // messaging endpoint attached to the store's own sender reputation.
    const pendingCount = await FamilyInvitation.countDocuments({ family_id: family._id, status: 'pending' });
    if (pendingCount >= MAX_PENDING_INVITATIONS) {
        throw familyError(
            'PENDING_INVITE_LIMIT',
            `You already have ${MAX_PENDING_INVITATIONS} invitations waiting for an answer. Cancel one before sending another.`,
            429
        );
    }

    const overWhatsapp = parsed.type === 'phone';
    const token = crypto.randomBytes(32).toString('hex');
    const invitation = await FamilyInvitation.create({
        family_id: family._id,
        invited_by_user_id: organizerId,
        email: parsed.type === 'email' ? parsed.normalized : null,
        phone: overWhatsapp ? parsed.normalized : null,
        channel: overWhatsapp ? 'whatsapp' : 'email',
        invited_user_id: invitedUser?._id || null,
        created_invited_account: created,
        relationship: normalizeRelationship(relationship),
        shared_address_ids: addressIds,
        token_hash: hashToken(token),
        status: 'pending',
        expires_at: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
        last_sent_at: new Date(),
    });

    try {
        if (overWhatsapp) {
            const sent = await sendWhatsappInvite({
                phone: parsed.normalized,
                inviterName: organizer.name,
                contextLine: language === 'ar'
                    ? `ضامّك لعيلته على ريدي مارين كـ${relationshipLabel(invitation.relationship, 'ar')} — هو اللي بيدفع`
                    : `is adding you to their Ready Marine family as their ${relationshipLabel(invitation.relationship, 'en')} — they pay`,
                url: buildInviteLandingUrl(token),
                campaignLabel: `Family invitation from ${organizer.name}`,
            });
            if (sent?.skipped) {
                throw familyError(
                    'INVITE_DELIVERY_UNAVAILABLE',
                    'WhatsApp invitations are not available right now. Please try again later.',
                    503
                );
            }
            if (sent?.campaignId) {
                invitation.delivery_reference = String(sent.campaignId);
                await invitation.save();
            }
        } else {
            await sendFamilyInvitationEmail({
                to: parsed.normalized,
                organizerName: organizer.name,
                relationshipLabel: relationshipLabel(invitation.relationship, language),
                invitationUrl: buildInvitationUrl(token),
                expiresAt: invitation.expires_at,
                language,
            });
        }
    } catch (err) {
        // Delivery failed — drop the invitation so the organizer can retry
        // cleanly, rather than being told to "resend" something that never left.
        await FamilyInvitation.deleteOne({ _id: invitation._id });
        if (err.code === 'INVITE_DELIVERY_UNAVAILABLE') throw err;
        throw familyError(
            overWhatsapp ? 'INVITE_DELIVERY_FAILED' : 'EMAIL_DELIVERY_FAILED',
            `Could not send the invitation: ${err.message}`,
            502
        );
    }

    // And the other channel, when the person has one.
    const extraChannels = await deliverFamilyInviteExtras({
        invitation,
        organizerName: organizer.name,
        token,
        fallbackLanguage: language,
    });

    await recordAuditLog({
        action: 'family_invitation_sent',
        actor: { role: 'user', label: organizer.name },
        target_type: 'family_invitation',
        target_id: invitation._id,
        target_snapshot: {
            identifier_masked: maskInviteIdentifier(parsed),
            channel: invitation.channel,
            extra_channels: extraChannels,
            relationship: invitation.relationship,
            created_invited_account: created,
        },
        impact: { shared_address_count: addressIds.length },
    });

    return {
        invitation: {
            _id: invitation._id,
            email: invitation.email,
            phone: invitation.phone,
            channel: invitation.channel,
            identifier_masked: maskInviteIdentifier(parsed),
            relationship: invitation.relationship,
            shared_address_ids: addressIds.map(String),
            created_at: invitation.created_at,
            last_sent_at: invitation.last_sent_at,
            expires_at: invitation.expires_at,
        },
    };
};

/**
 * Reach the invitee on the channel the invitation did NOT go out on, when they have it.
 *
 *   sent by WhatsApp  → also email the account's address, if the number has an account
 *                       with one;
 *   sent by email     → also WhatsApp the account's number, if the address belongs to an
 *                       account.
 *
 * Both copies carry the same token, and both land on the same page. Best effort: the
 * invitation already reached them on its own channel, so a failed copy is logged, not
 * thrown.
 *
 * @returns {Promise<string[]>} the extra channels that actually went out
 */
const deliverFamilyInviteExtras = async ({ invitation, organizerName, token, fallbackLanguage = 'en' }) => {
    const sent = [];
    const target = invitation.invited_user_id
        ? await User.findById(invitation.invited_user_id).select('email phone preferred_language')
        : (invitation.email ? await User.findOne({ email: invitation.email }).select('email phone preferred_language') : null);
    if (!target) return sent;

    const lang = target.preferred_language === 'ar' ? 'ar' : (target.preferred_language === 'en' ? 'en' : fallbackLanguage);

    if (invitation.channel === 'whatsapp' && target.email) {
        try {
            await sendFamilyInvitationEmail({
                to: target.email,
                organizerName,
                relationshipLabel: relationshipLabel(invitation.relationship, lang),
                invitationUrl: buildInvitationUrl(token),
                expiresAt: invitation.expires_at,
                language: lang,
            });
            sent.push('email');
        } catch (err) {
            console.error(`[Family] Email copy of invitation ${invitation._id} failed: ${err.message}`);
        }
    }

    if (invitation.channel === 'email' && target.phone) {
        try {
            const res = await sendWhatsappInvite({
                phone: target.phone,
                inviterName: organizerName,
                contextLine: lang === 'ar'
                    ? `ضامّك لعيلته على ريدي مارين كـ${relationshipLabel(invitation.relationship, 'ar')} — هو اللي بيدفع`
                    : `is adding you to their Ready Marine family as their ${relationshipLabel(invitation.relationship, 'en')} — they pay`,
                url: buildInviteLandingUrl(token),
                campaignLabel: `Family invitation from ${organizerName}`,
            });
            if (!res?.skipped) sent.push('whatsapp');
        } catch (err) {
            console.error(`[Family] WhatsApp copy of invitation ${invitation._id} failed: ${err.message}`);
        }
    }

    return sent;
};

/** Re-issue a fresh single-use token for a pending invitation and resend it. */
const resendInvitation = async (organizerId, invitationId, { language = 'en' } = {}) => {
    const { family } = await requireOrganizer(organizerId);
    const invitation = await FamilyInvitation.findOne({ _id: invitationId, family_id: family._id });
    if (!invitation) throw familyError('INVITATION_NOT_FOUND', 'Invitation not found', 404);
    if (invitation.status !== 'pending') {
        throw familyError('INVITATION_NOT_PENDING', 'This invitation is no longer pending', 409);
    }

    const organizer = await User.findById(organizerId).select('name');
    const token = crypto.randomBytes(32).toString('hex');
    invitation.token_hash = hashToken(token);
    invitation.expires_at = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
    invitation.last_sent_at = new Date();

    // Resend by the route the invitation was ORIGINALLY sent by. A WhatsApp
    // invitation carries no email address at all, so mailing it would either
    // throw or deliver to nobody — and the organizer would be told it had been
    // resent either way.
    if (invitation.channel === 'whatsapp') {
        const sent = await sendWhatsappInvite({
            phone: invitation.phone,
            inviterName: organizer?.name || 'Your family organizer',
            contextLine: language === 'ar'
                ? `ضامّك لعيلته على ريدي مارين كـ${relationshipLabel(invitation.relationship, 'ar')} — هو اللي بيدفع`
                : `is adding you to their Ready Marine family as their ${relationshipLabel(invitation.relationship, 'en')} — they pay`,
            url: buildInviteLandingUrl(token),
            campaignLabel: `Family invitation from ${organizer?.name || 'organizer'}`,
        });
        if (sent?.skipped) {
            throw familyError(
                'INVITE_DELIVERY_UNAVAILABLE',
                'WhatsApp invitations are not available right now. Please try again later.',
                503
            );
        }
        if (sent?.campaignId) invitation.delivery_reference = String(sent.campaignId);
    } else {
        await sendFamilyInvitationEmail({
            to: invitation.email,
            organizerName: organizer?.name || 'Your family organizer',
            relationshipLabel: relationshipLabel(invitation.relationship, language),
            invitationUrl: buildInvitationUrl(token),
            expiresAt: invitation.expires_at,
            language,
        });
    }

    await invitation.save();

    // The new token invalidated every earlier copy, so the other channel gets it too.
    await deliverFamilyInviteExtras({
        invitation,
        organizerName: organizer?.name || 'Your family organizer',
        token,
        fallbackLanguage: language,
    });

    return { invitation: { _id: invitation._id, expires_at: invitation.expires_at, last_sent_at: invitation.last_sent_at } };
};

const revokeInvitation = async (organizerId, invitationId) => {
    const { family } = await requireOrganizer(organizerId);
    const invitation = await FamilyInvitation.findOne({ _id: invitationId, family_id: family._id });
    if (!invitation) throw familyError('INVITATION_NOT_FOUND', 'Invitation not found', 404);
    if (invitation.status !== 'pending') {
        throw familyError('INVITATION_NOT_PENDING', 'This invitation is no longer pending', 409);
    }

    invitation.status = 'revoked';
    // Burn the token so an already-open landing page cannot still accept it.
    invitation.token_hash = hashToken(crypto.randomBytes(32).toString('hex'));
    await invitation.save();

    return { invitation: { _id: invitation._id, status: invitation.status } };
};

/** Look up a pending invitation by its raw token, or throw a precise reason. */
const findLiveInvitationByToken = async (token) => {
    if (!token) throw familyError('INVITATION_NOT_FOUND', 'Invitation link is invalid', 404);

    const invitation = await FamilyInvitation.findOne({ token_hash: hashToken(token) });
    if (!invitation) throw familyError('INVITATION_NOT_FOUND', 'Invitation link is invalid or has already been used', 404);

    if (invitation.status === 'revoked') {
        throw familyError('INVITATION_REVOKED', 'This invitation was cancelled by the organizer', 410);
    }
    if (invitation.status === 'accepted') {
        throw familyError('INVITATION_ALREADY_ACCEPTED', 'This invitation has already been accepted', 409);
    }
    if (invitation.status === 'declined') {
        throw familyError('INVITATION_DECLINED', 'This invitation was already declined', 409);
    }
    if (invitation.status === 'expired' || invitation.expires_at <= new Date()) {
        if (invitation.status === 'pending') {
            invitation.status = 'expired';
            await invitation.save();
        }
        throw familyError('INVITATION_EXPIRED', 'This invitation has expired. Ask the organizer to send a new one.', 410);
    }

    return invitation;
};

/**
 * Public invitation preview.
 *
 * Exposes only what the landing page must show — organizer name, relationship,
 * expiry, and the invited email. No addresses, member list, or family data is
 * returned before the invitation is actually accepted.
 */
const getInvitationPreview = async (token, currentUser = null) => {
    const invitation = await findLiveInvitationByToken(token);
    const [family, organizer] = await Promise.all([
        Family.findById(invitation.family_id).select('status'),
        User.findById(invitation.invited_by_user_id).select('name profile_image'),
    ]);

    if (!family || family.status !== 'active') {
        throw familyError('FAMILY_UNAVAILABLE', 'This family is no longer available', 410);
    }

    const overWhatsapp = invitation.channel === 'whatsapp';

    // A phone invitation always resolves to an account — a placeholder one if
    // the number had none — so "does an account exist" is answered by whether
    // that account has been claimed, not by whether a row exists.
    const invitedUser = invitation.invited_user_id
        ? await User.findById(invitation.invited_user_id).select('account_status phone_verified_at')
        : null;

    const invitedAccountExists = overWhatsapp
        ? !!invitedUser && !guestDisclosureBlocked(invitedUser)
        : !!(await User.exists({ email: invitation.email }));

    const signedInEmailMatches = overWhatsapp
        ? null
        : (currentUser ? normalizeEmailForAuth(currentUser.email) === invitation.email : null);

    return {
        invitation: {
            // The email is echoed only for an email invitation, where the
            // invitee typed it into a sign-in box anyway. A phone invitation
            // returns a masked number instead: this page is reachable by anyone
            // holding a forwarded link, and it should be enough to recognise the
            // number without printing it for whoever the link reached.
            email: overWhatsapp ? null : invitation.email,
            phone_masked: overWhatsapp ? maskInviteIdentifier({ type: 'phone', normalized: invitation.phone }) : null,
            channel: invitation.channel,
            relationship: invitation.relationship,
            expires_at: invitation.expires_at,
            shared_address_count: (invitation.shared_address_ids || []).length,
        },
        organizer: { name: organizer?.name || 'A Ready Marine customer', profile_image: organizer?.profile_image || null },
        // Lets the landing page choose between "sign in", "create account",
        // "confirm with a code", and "wrong account" without a second round trip.
        invited_account_exists: invitedAccountExists,
        signed_in_email_matches: signedInEmailMatches,
        // Whether accepting also claims the account. Drives whether the page
        // asks for a name alongside the code, or only for the code.
        needs_account_setup: overWhatsapp && !!invitedUser && guestDisclosureBlocked(invitedUser),
    };
};

/** Shared tail of both acceptance paths. */
const attachMembershipFromInvitation = async (invitation, user) => {
    const activeMembership = await FamilyMembership.findOne({ user_id: user._id, status: 'active' });
    if (activeMembership) {
        throw familyError(
            'ALREADY_IN_FAMILY',
            'This account already belongs to a family. Leave that family before joining another.',
            409
        );
    }

    let membership;
    try {
        membership = await FamilyMembership.create({
            family_id: invitation.family_id,
            user_id: user._id,
            role: 'member',
            relationship: invitation.relationship,
            shared_address_ids: invitation.shared_address_ids || [],
            status: 'active',
        });
    } catch (err) {
        if (err.code === 11000) {
            throw familyError('ALREADY_IN_FAMILY', 'This account already belongs to a family', 409);
        }
        throw err;
    }

    invitation.status = 'accepted';
    invitation.accepted_by_user_id = user._id;
    // Single-use: burn the token so a replayed link cannot re-accept.
    invitation.token_hash = hashToken(crypto.randomBytes(32).toString('hex'));
    await invitation.save();

    await notifyCustomer(
        invitation.invited_by_user_id,
        'family_invitation_accepted',
        {
            title_en: 'Family invitation accepted',
            title_ar: 'تم قبول دعوة العائلة',
            message_en: `${user.name} joined your family and can now send you order requests.`,
            message_ar: `انضم ${user.name} إلى عائلتك ويمكنه الآن إرسال طلبات شراء إليك.`,
        },
        { link: '/profile?tab=family', data: { member_user_id: user._id } }
    );

    await recordAuditLog({
        action: 'family_invitation_accepted',
        actor: { role: 'user', label: user.name },
        target_type: 'family_membership',
        target_id: membership._id,
        target_snapshot: { family_id: invitation.family_id, relationship: invitation.relationship },
        impact: { shared_address_count: (invitation.shared_address_ids || []).length },
    });

    return membership;
};

/** Accept using an already signed-in customer account. */
const acceptInvitationAsUser = async (token, user) => {
    const invitation = await findLiveInvitationByToken(token);

    if (invitation.channel === 'whatsapp') {
        // The invitation is addressed to a NUMBER, so the signed-in account has
        // to be the one that number resolves to. Matching on the email would be
        // meaningless here — the invited account may not have one at all.
        if (String(invitation.invited_user_id || '') !== String(user._id)) {
            throw familyError(
                'ACCOUNT_MISMATCH',
                'This invitation was sent to another mobile number',
                403
            );
        }
    } else if (normalizeEmailForAuth(user.email) !== invitation.email) {
        throw familyError(
            'EMAIL_MISMATCH',
            'This invitation was sent to another email address',
            403
        );
    }

    await attachMembershipFromInvitation(invitation, user);
    return { joined: true };
};

/**
 * Accept by creating a brand-new customer account.
 *
 * The invitation itself proves control of the invited mailbox, so this path
 * skips the usual second email-verification loop: the account is created,
 * the membership attached, and a session issued atomically.
 */
const acceptInvitationWithNewAccount = async (token, { name, phone, password, language = 'en' }) => {
    const invitation = await findLiveInvitationByToken(token);

    if (!name || !String(name).trim()) throw familyError('NAME_REQUIRED', 'Please enter your full name', 400);
    if (!password || String(password).length < 8) {
        throw familyError('WEAK_PASSWORD', 'Password must be at least 8 characters', 400);
    }

    const formattedPhone = formatPhone(String(phone || ''));
    if (!formattedPhone) throw familyError('PHONE_REQUIRED', 'Please enter your phone number', 400);

    if (await User.exists({ email: invitation.email })) {
        throw familyError('EMAIL_IN_USE', 'An account already exists for this email. Please sign in instead.', 409);
    }
    if (await User.exists({ phone: formattedPhone })) {
        throw familyError('PHONE_IN_USE', 'This phone number is already used by another account', 409);
    }

    const user = await User.create({
        name: String(name).trim(),
        email: invitation.email,
        phone: formattedPhone,
        password: await hashPassword(password),
        preferred_language: language === 'ar' ? 'ar' : 'en',
    });

    try {
        await attachMembershipFromInvitation(invitation, user);
    } catch (err) {
        // Never leave a half-created account behind if the join fails.
        await User.deleteOne({ _id: user._id });
        throw err;
    }

    // Friend requests that were waiting for this address to sign up.
    await require('./friendService').convertPendingEmailInvites(user);

    return {
        joined: true,
        token: generateToken({ id: user._id, role: 'user' }, process.env.JWT_SECRET_USER),
        user: {
            id: user._id,
            name: user.name,
            email: user.email,
            profile_image: null,
            role: 'user',
            cars: [],
        },
    };
};

/* ------------------------------------------------------------------ */
/* Accepting a WhatsApp invitation with a code                         */
/* ------------------------------------------------------------------ */

/**
 * Load a phone invitation and the account it points at.
 *
 * Both halves must exist: an invitation with no `invited_user_id` cannot be a
 * phone invitation, because every phone invitation either resolved to an
 * account or had a placeholder created for it.
 */
const loadWhatsappInvitation = async (token) => {
    const invitation = await findLiveInvitationByToken(token);
    if (invitation.channel !== 'whatsapp') {
        throw familyError(
            'WRONG_CHANNEL',
            'This invitation is confirmed by the link we emailed you.',
            409
        );
    }

    const invited = invitation.invited_user_id
        ? await User.findById(invitation.invited_user_id)
        : null;
    if (!invited) {
        throw familyError('INVITATION_NOT_FOUND', 'This invitation link is not valid', 404);
    }

    return { invitation, invited };
};

/** Issue the WhatsApp code that proves the invitee holds the invited number. */
const sendFamilyInviteCode = async (token, { language = 'en' } = {}) => {
    const { invited } = await loadWhatsappInvitation(token);
    const { sendInviteClaimCode } = require('./guestCheckoutService');
    return await sendInviteClaimCode({ user: invited, language });
};

/**
 * Accept over the token: prove the number, claim the account, join the family.
 *
 * No password, and — unlike the Friends equivalent — no address either. A family
 * MEMBER orders against the organizer's shared addresses and never their own, so
 * asking a new member for one would be collecting something the feature does not
 * use. The whole join is a name and six digits.
 */
const acceptInvitationWithCode = async (token, { code, name, language = 'en', rememberMe = true } = {}) => {
    const { invitation, invited } = await loadWhatsappInvitation(token);
    const needsSetup = guestDisclosureBlocked(invited);

    if (needsSetup && !String(name || '').trim()) {
        throw familyError('NAME_REQUIRED', 'Please enter your full name', 400);
    }

    // Prove first, write second. A wrong code must leave the account exactly as
    // it was — unclaimed, unnamed, and not in anybody's family.
    const { claimInvitedAccount } = require('./guestCheckoutService');
    const session = await claimInvitedAccount({
        user: invited,
        code,
        name: needsSetup ? name : '',
        rememberMe,
    });

    const claimed = await User.findById(invited._id);

    try {
        await attachMembershipFromInvitation(invitation, claimed);
    } catch (err) {
        // The account stays claimed on purpose. They proved the number, so the
        // account is legitimately theirs now — it simply could not join THIS
        // family (they already belong to another). Deleting it would take away
        // something they have earned and would strand any orders on it.
        throw err;
    }

    return {
        joined: true,
        token: session.token,
        user: session.user,
    };
};

const declineInvitation = async (token) => {
    const invitation = await findLiveInvitationByToken(token);

    invitation.status = 'declined';
    invitation.token_hash = hashToken(crypto.randomBytes(32).toString('hex'));
    await invitation.save();

    await notifyCustomer(
        invitation.invited_by_user_id,
        'family_invitation_declined',
        {
            title_en: 'Family invitation declined',
            title_ar: 'تم رفض دعوة العائلة',
            message_en: `Your invitation to ${invitation.email} was declined.`,
            message_ar: `تم رفض دعوتك المرسلة إلى ${invitation.email}.`,
        },
        { link: '/profile?tab=family' }
    );

    return { declined: true };
};

/* ------------------------------------------------------------------ */
/* Member management                                                   */
/* ------------------------------------------------------------------ */

const updateMemberSharedAddresses = async (organizerId, membershipId, addressIds = []) => {
    const { family } = await requireOrganizer(organizerId);
    const organizer = await User.findById(organizerId).select('name addresses');

    const membership = await FamilyMembership.findOne({
        _id: membershipId,
        family_id: family._id,
        role: 'member',
        status: 'active',
    });
    if (!membership) throw familyError('MEMBER_NOT_FOUND', 'Family member not found', 404);

    membership.shared_address_ids = assertAddressesOwnedByOrganizer(organizer, addressIds);
    await membership.save();

    await notifyCustomer(
        membership.user_id,
        'family_address_access_changed',
        {
            title_en: 'Shared addresses updated',
            title_ar: 'تم تحديث العناوين المشتركة',
            message_en: `${organizer.name} updated which delivery addresses you can use. You now have ${membership.shared_address_ids.length} shared address${membership.shared_address_ids.length === 1 ? '' : 'es'}.`,
            message_ar: `قام ${organizer.name} بتحديث العناوين المتاحة لك. لديك الآن ${membership.shared_address_ids.length} عنوان مشترك.`,
        },
        { link: '/profile?tab=family', data: { shared_address_count: membership.shared_address_ids.length } }
    );

    await recordAuditLog({
        action: 'family_address_access_changed',
        actor: { role: 'user', label: organizer.name },
        target_type: 'family_membership',
        target_id: membership._id,
        target_snapshot: { member_user_id: membership.user_id },
        impact: { shared_address_count: membership.shared_address_ids.length },
    });

    return { shared_address_ids: membership.shared_address_ids.map(String) };
};

/**
 * End a membership (organizer removal or voluntary leave).
 *
 * Address access is revoked immediately, and any request that has not yet been
 * paid is cancelled — an unpaid request must never survive the relationship
 * that authorized it. Completed orders are untouched.
 */
const endMembership = async (membership, { reason, actorName }) => {
    membership.status = reason === 'left' ? 'left' : 'removed';
    membership.ended_at = new Date();
    membership.shared_address_ids = [];
    await membership.save();

    const { cancelOpenRequestsForMembership } = require('./familyOrderRequestService');
    const cancelled = await cancelOpenRequestsForMembership(membership);

    await recordAuditLog({
        action: reason === 'left' ? 'family_member_left' : 'family_member_removed',
        actor: { role: 'user', label: actorName },
        target_type: 'family_membership',
        target_id: membership._id,
        target_snapshot: { family_id: membership.family_id, member_user_id: membership.user_id },
        impact: { cancelled_requests: cancelled },
    });

    return cancelled;
};

const removeMember = async (organizerId, membershipId) => {
    const { family } = await requireOrganizer(organizerId);
    const organizer = await User.findById(organizerId).select('name');

    const membership = await FamilyMembership.findOne({
        _id: membershipId,
        family_id: family._id,
        role: 'member',
        status: 'active',
    });
    if (!membership) throw familyError('MEMBER_NOT_FOUND', 'Family member not found', 404);

    const memberUserId = membership.user_id;
    const cancelled = await endMembership(membership, { reason: 'removed', actorName: organizer.name });

    await notifyCustomer(
        memberUserId,
        'family_member_removed',
        {
            title_en: 'You were removed from a family',
            title_ar: 'تمت إزالتك من العائلة',
            message_en: `${organizer.name} removed you from their Ready Marine family. You can no longer use their shared addresses.`,
            message_ar: `قام ${organizer.name} بإزالتك من عائلته على Ready Marine. لم يعد بإمكانك استخدام عناوينه المشتركة.`,
        },
        { link: '/profile?tab=family', data: { cancelled_requests: cancelled } }
    );

    return { removed: true, cancelled_requests: cancelled };
};

const leaveFamily = async (userId) => {
    const { membership, family, role } = await resolveFamilyContext(userId);
    if (!family) throw familyError('NOT_FAMILY_MEMBER', 'You are not part of a family', 403);
    if (role === 'organizer') {
        throw familyError(
            'ORGANIZER_CANNOT_LEAVE',
            'As the organizer you cannot leave your own family. Remove the members instead.',
            409
        );
    }

    const user = await User.findById(userId).select('name');
    const cancelled = await endMembership(membership, { reason: 'left', actorName: user?.name || 'Member' });

    await notifyCustomer(
        family.organizer_user_id,
        'family_member_left',
        {
            title_en: 'A family member left',
            title_ar: 'غادر أحد أفراد العائلة',
            message_en: `${user?.name || 'A member'} left your Ready Marine family.`,
            message_ar: `غادر ${user?.name || 'أحد الأفراد'} عائلتك على Ready Marine.`,
        },
        { link: '/profile?tab=family' }
    );

    return { left: true, cancelled_requests: cancelled };
};

module.exports = {
    RELATIONSHIPS,
    relationshipLabel,
    resolveFamilyContext,
    requireOrganizer,
    requireMember,
    getFamilyOverview,
    getSharedAddressesForMember,
    inviteFamilyMember,
    resendInvitation,
    revokeInvitation,
    getInvitationPreview,
    acceptInvitationAsUser,
    acceptInvitationWithNewAccount,
    sendFamilyInviteCode,
    acceptInvitationWithCode,
    declineInvitation,
    updateMemberSharedAddresses,
    removeMember,
    leaveFamily,
    familyError,
};
