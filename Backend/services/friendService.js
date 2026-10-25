const mongoose = require('mongoose');

const { User } = require('../models/users');
const { Friendship, FriendInvitation, FriendAddressShare, FriendEmailInvite, orderPair } = require('../models/friendships');
const { recordAuditLog } = require('../models/auditLog');
const { notifyCustomer } = require('./customerNotificationService');
const {
    parseIdentifier,
    maskIdentifier,
    findCustomerByIdentifier,
    publicProfile,
} = require('./shared/customerIdentifier');
const {
    hashInviteToken,
    generateInviteToken,
    getFrontendUrl,
    buildInviteLandingUrl,
    parseInviteIdentifier,
    maskInviteIdentifier,
    resolveInviteTarget,
    sendWhatsappInvite,
} = require('./shared/guestInvites');
const { guestDisclosureBlocked } = require('./guestCheckoutService');
const {
    authorizationError,
    sharedAddressShape,
    addressGlanceShape,
    assertOwnedAddressIds,
} = require('./shared/addressAuthorization');

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const INVITATION_TTL_DAYS = 7;
/** Spam brake: a customer cannot accumulate an unbounded friend graph. */
const MAX_ACTIVE_FRIENDS = 100;
/**
 * Spam brake of a different kind, and the more important one now.
 *
 * Inviting a phone number with no account CREATES an account and sends a
 * WhatsApp message. Without a cap on how many invitations one customer may have
 * outstanding, that is a free bulk-messaging endpoint attached to somebody
 * else's WhatsApp bill and reputation. Active friendships are capped separately
 * because accepted invitations stop counting here.
 */
const MAX_PENDING_INVITATIONS = 20;

// The unified landing path, so the WhatsApp template can declare one fixed base
// URL. `/friends/invitation/<token>` still serves the same page for links that
// were sent before this changed.
const buildFriendInvitationUrl = (token) => buildInviteLandingUrl(token);

const friendError = authorizationError;

const buildExpiry = () => new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

/**
 * Invitations to email addresses with no account, per sender. They cannot be seen or
 * cancelled from the Friends tab (showing them would tell the sender the address has no
 * account), so they get their own brake instead of counting against the visible one —
 * and going over it drops the invitation quietly rather than saying why.
 */
const MAX_PENDING_EMAIL_INVITES = 20;

const friendsTabUrl = () => `${getFrontendUrl()}/profile?tab=friends`;

const WHATSAPP_FRIEND_CONTEXT = {
    ar: 'عايز يضيفك كصديق على ريدي كار عشان تقدروا تشتروا قطع لبعض',
    en: 'wants to connect with you on ReadyCar so you can buy parts for each other',
};

/**
 * Reach the invitee on every channel they have, beyond the one the invitation already
 * went out on. Best effort by design: the invitation exists and the primary channel has
 * delivered, so a failed extra message is logged, never thrown — and never reported to
 * the sender, whose answer must not change with how the person could be reached.
 *
 * @returns {Promise<string[]>} the extra channels that actually went out
 */
const deliverFriendInviteExtras = async ({ recipient, sender, invitation, token, primary }) => {
    const { sendFriendInvitationEmail } = require('./emailService');
    const lang = recipient.preferred_language === 'ar' ? 'ar' : 'en';
    const sent = [];

    if (primary !== 'whatsapp' && recipient.phone && token) {
        try {
            // The link goes through /invite/<token> because the WhatsApp template only
            // accepts that shape; for an in-app invitation it forwards to the Friends tab.
            const res = await sendWhatsappInvite({
                phone: recipient.phone,
                inviterName: sender.name,
                contextLine: WHATSAPP_FRIEND_CONTEXT[lang],
                url: buildFriendInvitationUrl(token),
                campaignLabel: `Friend invitation from ${sender.name}`,
            });
            if (!res?.skipped) sent.push('whatsapp');
        } catch (err) {
            console.error(`[Friends] WhatsApp copy of invitation ${invitation._id} failed: ${err.message}`);
        }
    }

    if (recipient.email) {
        try {
            const claim = invitation.channel === 'whatsapp';
            await sendFriendInvitationEmail({
                to: recipient.email,
                inviterName: sender.name,
                // An unclaimed guest confirms through the token page; a customer who
                // already signs in answers from their Friends tab.
                actionUrl: claim ? buildFriendInvitationUrl(token) : friendsTabUrl(),
                mode: claim ? 'claim' : 'account',
                expiresAt: invitation.expires_at,
                language: lang,
            });
            sent.push('email');
        } catch (err) {
            console.error(`[Friends] Email copy of invitation ${invitation._id} failed: ${err.message}`);
        }
    }

    return sent;
};

/**
 * Invite an email address that has no account: hold the invitation until one is made,
 * and email the person now. Always resolves — the sender gets the same answer whether
 * or not this address has an account.
 */
const inviteEmailWithoutAccount = async ({ sender, email, sharedAddressIds, language }) => {
    const now = new Date();
    const live = { sender_user_id: sender._id, status: 'pending', expires_at: { $gt: now } };

    // Already invited and still waiting: do not email them again.
    if (await FriendEmailInvite.exists({ ...live, email })) return;
    if (await FriendEmailInvite.countDocuments(live) >= MAX_PENDING_EMAIL_INVITES) return;

    const pending = await FriendEmailInvite.create({
        sender_user_id: sender._id,
        email,
        sender_shared_address_ids: sharedAddressIds.map((id) => new mongoose.Types.ObjectId(id)),
        status: 'pending',
        expires_at: buildExpiry(),
        language: language === 'ar' ? 'ar' : 'en',
    });

    try {
        const { sendFriendInvitationEmail } = require('./emailService');
        await sendFriendInvitationEmail({
            to: email,
            inviterName: sender.name,
            actionUrl: `${getFrontendUrl()}/register`,
            mode: 'signup',
            expiresAt: pending.expires_at,
            language,
        });
    } catch (err) {
        // Kept, not deleted: if they sign up with this address anyway, the request is
        // still waiting for them. Only the email failed.
        console.error(`[Friends] Invitation email to a new address failed: ${err.message}`);
    }

    await recordAuditLog({
        action: 'friend_invitation_sent',
        actor: { role: 'user', label: sender.name },
        target_type: 'friend_invitation',
        target_id: pending._id,
        target_snapshot: {
            identifier_type: 'email',
            identifier_masked: maskInviteIdentifier({ type: 'email', normalized: email }),
            channel: 'email',
            created_recipient_account: false,
        },
        impact: { shared_address_count: sharedAddressIds.length },
    });
};

/**
 * Turn email invitations waiting for this address into real ones, now that it has an
 * account. Called right after an account is created. Never throws — a sign-up must not
 * fail because of a friend request.
 */
const convertPendingEmailInvites = async (user) => {
    try {
        if (!user?.email) return 0;
        const email = require('./shared/emailIdentity').canonicalEmail(String(user.email));
        const now = new Date();
        const waiting = await FriendEmailInvite.find({ email, status: 'pending' });
        let converted = 0;

        for (const pending of waiting) {
            if (pending.expires_at <= now) {
                pending.status = 'expired';
                await pending.save();
                continue;
            }
            const sender = await User.findById(pending.sender_user_id).select('name addresses');
            if (!sender || String(sender._id) === String(user._id)) {
                pending.status = 'expired';
                await pending.save();
                continue;
            }

            // Only addresses the sender still owns.
            const owned = new Set((sender.addresses || []).map((a) => String(a._id)));
            const shareIds = (pending.sender_shared_address_ids || []).filter((id) => owned.has(String(id)));

            const existing = await findFriendshipRow(sender._id, user._id);
            const pair = orderPair(sender._id, user._id);
            const pendingForPair = await FriendInvitation.exists({
                pair_low_id: pair.user_low_id, pair_high_id: pair.user_high_id, status: 'pending',
            });

            if (existing?.status === 'active' || existing?.status === 'blocked' || pendingForPair || shareIds.length === 0) {
                pending.status = 'expired';
                await pending.save();
                continue;
            }

            const invitation = await FriendInvitation.create({
                sender_user_id: sender._id,
                recipient_user_id: user._id,
                pair_low_id: pair.user_low_id,
                pair_high_id: pair.user_high_id,
                identifier_type: 'email',
                identifier_masked: maskInviteIdentifier({ type: 'email', normalized: email }),
                sender_shared_address_ids: shareIds,
                status: 'pending',
                expires_at: pending.expires_at,
                channel: 'in_app',
                token_hash: null,
                created_recipient_account: false,
                last_sent_at: new Date(),
            });

            await notifyCustomer(
                user._id,
                'friend_invitation_received',
                {
                    title_en: 'New friend request',
                    title_ar: 'طلب صداقة جديد',
                    message_en: `${sender.name} wants to connect with you on ReadyCar so you can buy parts for each other.`,
                    message_ar: `يريد ${sender.name} إضافتك كصديق على ReadyCar حتى تتمكنا من شراء القطع لبعضكما.`,
                },
                { link: '/profile?tab=friends', data: { invitation_id: invitation._id } }
            );

            pending.status = 'converted';
            pending.converted_invitation_id = invitation._id;
            await pending.save();
            converted += 1;
        }
        return converted;
    } catch (err) {
        console.error(`[Friends] Could not convert email invitations for ${user?._id}: ${err.message}`);
        return 0;
    }
};

/* ------------------------------------------------------------------ */
/* Friendship resolution                                               */
/* ------------------------------------------------------------------ */

/** The stored row for a pair, in any state (or null if they never connected). */
const findFriendshipRow = async (userA, userB) => {
    const pair = orderPair(userA, userB);
    return await Friendship.findOne({ user_low_id: pair.user_low_id, user_high_id: pair.user_high_id });
};

/** Given a friendship row and one participant, return the other participant's id. */
const otherParticipant = (friendship, userId) =>
    friendship.user_low_id.toString() === String(userId)
        ? friendship.user_high_id
        : friendship.user_low_id;

/**
 * Load an ACTIVE friendship the caller is party to, or throw.
 *
 * This is the authorization primitive for everything friend-related: a friend
 * id from the client is never trusted on its own, it must resolve to an active
 * row that includes the authenticated caller.
 */
const requireActiveFriendship = async (userId, friendUserId) => {
    if (!mongoose.Types.ObjectId.isValid(friendUserId)) {
        throw friendError('FRIENDSHIP_NOT_FOUND', 'Friend not found', 404);
    }
    if (String(userId) === String(friendUserId)) {
        throw friendError('FRIENDSHIP_NOT_FOUND', 'Friend not found', 404);
    }

    const friendship = await findFriendshipRow(userId, friendUserId);
    if (!friendship || friendship.status !== 'active') {
        // A blocked or removed relationship is indistinguishable from one that
        // never existed — the caller learns nothing about the other account.
        throw friendError('FRIENDSHIP_NOT_FOUND', 'Friend not found', 404);
    }

    return friendship;
};

const countActiveFriends = async (userId) => await Friendship.countDocuments({
    status: 'active',
    $or: [{ user_low_id: userId }, { user_high_id: userId }],
});

/* ------------------------------------------------------------------ */
/* Address sharing                                                     */
/* ------------------------------------------------------------------ */

/** Ids `ownerUserId` currently permits `viewerUserId` to select. */
const getSharedAddressIds = async (ownerUserId, viewerUserId) => {
    const shares = await FriendAddressShare.find({
        owner_user_id: ownerUserId,
        viewer_user_id: viewerUserId,
    }).select('address_id').lean();

    return new Set(shares.map((share) => share.address_id.toString()));
};

/**
 * Replace the caller's sharing list for one friend.
 *
 * A full replace (rather than add/remove deltas) makes revocation exact: what
 * is not in the new list is gone, immediately, for every future checkout.
 */
const replaceSharedAddresses = async ({ friendship, ownerUserId, viewerUserId, addressIds }) => {
    const owner = await User.findById(ownerUserId).select('name addresses');
    if (!owner) throw friendError('USER_NOT_FOUND', 'User not found', 404);

    const validated = assertOwnedAddressIds(owner, addressIds);

    await FriendAddressShare.deleteMany({
        friendship_id: friendship._id,
        owner_user_id: ownerUserId,
        viewer_user_id: viewerUserId,
    });

    if (validated.length > 0) {
        await FriendAddressShare.insertMany(validated.map((addressId) => ({
            friendship_id: friendship._id,
            owner_user_id: ownerUserId,
            viewer_user_id: viewerUserId,
            address_id: new mongoose.Types.ObjectId(addressId),
        })));
    }

    return validated;
};

/**
 * Addresses a friend has shared WITH the caller, for the authorized checkout.
 * Full delivery detail — this is the one place the viewer is entitled to it.
 */
const getAddressesSharedWithMe = async (userId, friendUserId) => {
    const friendship = await requireActiveFriendship(userId, friendUserId);
    const sharedIds = await getSharedAddressIds(friendUserId, userId);

    const friend = await User.findById(friendUserId).select('name profile_image addresses');
    if (!friend) throw friendError('FRIENDSHIP_NOT_FOUND', 'Friend not found', 404);

    return {
        friendship_id: friendship._id,
        friend: publicProfile(friend),
        addresses: (friend.addresses || [])
            .filter((address) => sharedIds.has(address._id.toString()))
            .map(sharedAddressShape),
    };
};

/** The caller's OWN addresses, flagged with whether each is shared to one friend. */
const getMySharedAddresses = async (userId, friendUserId) => {
    await requireActiveFriendship(userId, friendUserId);
    const sharedIds = await getSharedAddressIds(userId, friendUserId);

    const me = await User.findById(userId).select('addresses');
    return {
        addresses: (me?.addresses || []).map((address) => ({
            ...sharedAddressShape(address),
            is_default: !!address.is_default,
            is_shared: sharedIds.has(address._id.toString()),
        })),
        shared_address_ids: [...sharedIds],
    };
};

const updateMySharedAddresses = async (userId, friendUserId, addressIds = []) => {
    const friendship = await requireActiveFriendship(userId, friendUserId);

    const validated = await replaceSharedAddresses({
        friendship,
        ownerUserId: userId,
        viewerUserId: friendUserId,
        addressIds,
    });

    const me = await User.findById(userId).select('name');
    await notifyCustomer(
        friendUserId,
        'friend_address_access_changed',
        {
            title_en: 'Shared addresses updated',
            title_ar: 'تم تحديث العناوين المشتركة',
            message_en: validated.length === 0
                ? `${me.name} is no longer sharing a delivery address with you.`
                : `${me.name} updated which of their delivery addresses you can use (${validated.length}).`,
            message_ar: validated.length === 0
                ? `لم يعد ${me.name} يشارك أي عنوان توصيل معك.`
                : `قام ${me.name} بتحديث العناوين التي يمكنك استخدامها (${validated.length}).`,
        },
        // Never put address text in a notification preview.
        { link: '/profile?tab=friends', data: { shared_address_count: validated.length } }
    );

    await recordAuditLog({
        action: 'friend_address_access_changed',
        actor: { role: 'user', label: me.name },
        target_type: 'friendship',
        target_id: friendship._id,
        target_snapshot: { owner_user_id: userId, viewer_user_id: friendUserId },
        impact: { shared_address_count: validated.length },
    });

    return { shared_address_ids: validated };
};

/* ------------------------------------------------------------------ */
/* Friends overview                                                    */
/* ------------------------------------------------------------------ */

/** Lazily expire pending invitations whenever the Friends tab is read. */
const expireStaleInvitations = async (userId) => {
    await FriendInvitation.updateMany(
        {
            status: 'pending',
            expires_at: { $lte: new Date() },
            $or: [{ sender_user_id: userId }, { recipient_user_id: userId }],
        },
        { status: 'expired', updated_at: new Date() }
    );
};

/**
 * Everything the Friends tab needs: incoming requests, active friends with
 * both directions of sharing summarised, and the caller's outgoing invitations.
 */
const getFriendsOverview = async (userId) => {
    await expireStaleInvitations(userId);

    const friendships = await Friendship.find({
        status: 'active',
        $or: [{ user_low_id: userId }, { user_high_id: userId }],
    }).sort({ accepted_at: -1 });

    const friendIds = friendships.map((friendship) => otherParticipant(friendship, userId));

    const [friendUsers, incoming, outgoing, me] = await Promise.all([
        User.find({ _id: { $in: friendIds } }).select('name profile_image addresses'),
        FriendInvitation.find({ recipient_user_id: userId, status: 'pending' }).sort({ created_at: -1 }),
        FriendInvitation.find({ sender_user_id: userId, status: 'pending' }).sort({ created_at: -1 }),
        User.findById(userId).select('addresses'),
    ]);
    const friendMap = new Map(friendUsers.map((user) => [user._id.toString(), user]));

    // Both directions of sharing, in two queries rather than 2N.
    const [sharesToMe, sharesFromMe] = await Promise.all([
        FriendAddressShare.find({ viewer_user_id: userId, owner_user_id: { $in: friendIds } }).lean(),
        FriendAddressShare.find({ owner_user_id: userId, viewer_user_id: { $in: friendIds } }).lean(),
    ]);

    const groupBy = (rows, key) => rows.reduce((map, row) => {
        const id = row[key].toString();
        if (!map.has(id)) map.set(id, []);
        map.get(id).push(row.address_id.toString());
        return map;
    }, new Map());

    const toMe = groupBy(sharesToMe, 'owner_user_id');
    const fromMe = groupBy(sharesFromMe, 'viewer_user_id');

    const senderIds = incoming.map((invitation) => invitation.sender_user_id);
    const senders = await User.find({ _id: { $in: senderIds } }).select('name profile_image');
    const senderMap = new Map(senders.map((user) => [user._id.toString(), user]));

    return {
        // Whether the caller can participate at all — both sides need an address.
        has_own_address: (me?.addresses || []).length > 0,
        my_addresses: (me?.addresses || []).map((address) => ({
            ...sharedAddressShape(address),
            is_default: !!address.is_default,
        })),

        incoming_requests: incoming.map((invitation) => ({
            _id: invitation._id,
            // Only the safe public profile of the sender: name and avatar.
            sender: publicProfile(senderMap.get(invitation.sender_user_id.toString())),
            created_at: invitation.created_at,
            expires_at: invitation.expires_at,
        })),

        friends: friendships.map((friendship) => {
            const friendId = otherParticipant(friendship, userId).toString();
            const friend = friendMap.get(friendId);
            const theirSharedIds = new Set(toMe.get(friendId) || []);

            return {
                friendship_id: friendship._id,
                friend: publicProfile(friend),
                since: friendship.accepted_at,
                // What they let me use — label + city only in the list view.
                // Full delivery detail appears only inside friend checkout.
                addresses_shared_with_me: (friend?.addresses || [])
                    .filter((address) => theirSharedIds.has(address._id.toString()))
                    .map(addressGlanceShape),
                my_shared_address_ids: fromMe.get(friendId) || [],
                // Drives "Buy for this friend" vs "ask them to share an address".
                can_buy_for_them: theirSharedIds.size > 0,
            };
        }),

        outgoing_invitations: outgoing.map((invitation) => ({
            _id: invitation._id,
            identifier_type: invitation.identifier_type,
            identifier_masked: invitation.identifier_masked,
            created_at: invitation.created_at,
            expires_at: invitation.expires_at,
        })),
    };
};

/* ------------------------------------------------------------------ */
/* Invitations                                                         */
/* ------------------------------------------------------------------ */

/**
 * Invite someone by email or mobile number — whether or not they are a customer.
 *
 * A mobile number that has no account gets a PLACEHOLDER guest account created
 * for it and a WhatsApp link; an existing customer gets the in-app request they
 * already know how to answer. The person the sender actually meant to reach now
 * hears about it either way, which is the whole point: this used to resolve the
 * identifier, find nobody, and silently do nothing.
 *
 * Enumeration resistance is kept exactly where it still buys something. An
 * EMAIL invitation answers uniformly whether or not the address has an account,
 * because there it is the only signal available. A PHONE invitation no longer
 * needs to: the message goes out in both cases, so observing the response tells
 * an attacker nothing they did not already cause.
 */
const inviteFriend = async (userId, { identifier, shared_address_ids = [] }, { language = 'en' } = {}) => {
    // The invite-aware parser, not the lookup one: it canonicalises an Egyptian
    // mobile to a single form, which is what makes "the same number" mean one
    // person whether the sender typed it with a country code or without.
    const parsed = parseInviteIdentifier(identifier);
    if (!parsed.type) {
        throw friendError('INVALID_IDENTIFIER', 'Enter a valid email address or mobile number', 400);
    }

    const me = await User.findById(userId).select('name email phone addresses preferred_language');
    if (!me) throw friendError('USER_NOT_FOUND', 'User not found', 404);

    if ((me.addresses || []).length === 0) {
        throw friendError(
            'NO_SAVED_ADDRESS',
            'Add a delivery address to your account before inviting a friend',
            409
        );
    }

    // The sender must offer something, otherwise the friendship is one-legged
    // from birth and the friend can never buy for them.
    const validatedAddressIds = assertOwnedAddressIds(me, shared_address_ids);
    if (validatedAddressIds.length === 0) {
        throw friendError('SHARE_ADDRESS_REQUIRED', 'Select at least one of your addresses to share', 400);
    }

    // Self-invite, including via an alternate spelling of the same identifier.
    const ownEmail = parseInviteIdentifier(me.email || '');
    const ownPhone = parseInviteIdentifier(me.phone || '');
    if ((ownEmail.normalized && parsed.normalized === ownEmail.normalized)
        || (ownPhone.normalized && parsed.normalized === ownPhone.normalized)) {
        throw friendError('CANNOT_INVITE_SELF', 'You cannot send a friend request to yourself', 400);
    }

    if (await countActiveFriends(userId) >= MAX_ACTIVE_FRIENDS) {
        throw friendError('FRIEND_LIMIT_REACHED', `You can have at most ${MAX_ACTIVE_FRIENDS} friends`, 409);
    }

    await expireStaleInvitations(userId);

    const pendingSent = await FriendInvitation.countDocuments({ sender_user_id: userId, status: 'pending' });
    if (pendingSent >= MAX_PENDING_INVITATIONS) {
        throw friendError(
            'PENDING_INVITE_LIMIT',
            `You already have ${MAX_PENDING_INVITATIONS} invitations waiting for an answer. Cancel one before sending another.`,
            429
        );
    }

    /**
     * ONE answer for every path below that does not throw.
     *
     * This has to be identical whether the number turned out to have an account,
     * to be blocked, or to already have an invitation waiting — otherwise the
     * endpoint tells anyone who can call it whether a given phone number shops
     * here, which is exactly what an enumeration sweep is after.
     *
     * The wording differs by IDENTIFIER TYPE only, because the two are honestly
     * different outcomes. A phone invitation always reaches the person somehow —
     * a WhatsApp link if they are new, an in-app request if they are not — so it
     * can be reported as sent. An email invitation to an address with no account
     * genuinely does nothing, so it can only promise the conditional.
     *
     * `code` is what the screen switches on; `message` is the fallback for any
     * caller that does not know the code.
     */
    // Both identifier types now always reach the person — a phone by WhatsApp, an email
    // by email even when the address has no account — so both report the same thing.
    const uniformResult = {
        code: 'INVITE_SENT',
        identifier_masked: maskInviteIdentifier(parsed),
        message: 'Invitation sent.',
    };

    const { user: recipient, created } = await resolveInviteTarget(parsed, {
        inviterName: me.name,
        language,
        // An email address has nothing to hang an account on — `phone` is
        // required and unique on a user — so an email invitation to a stranger
        // keeps the old behaviour of quietly going nowhere.
        allowCreate: parsed.type === 'phone',
    });

    if (!recipient) {
        // Only an email can land here (a phone always resolves, to a placeholder if
        // need be). Hold the invitation for when that address signs up, and email it now.
        await inviteEmailWithoutAccount({
            sender: me,
            email: parsed.normalized,
            sharedAddressIds: validatedAddressIds,
            language,
        });
        return uniformResult;
    }
    if (recipient._id.toString() === userId.toString()) {
        throw friendError('CANNOT_INVITE_SELF', 'You cannot send a friend request to yourself', 400);
    }

    const existing = await findFriendshipRow(userId, recipient._id);
    if (existing?.status === 'active') {
        // Safe to disclose: the sender can already see this person in their list.
        throw friendError('ALREADY_FRIENDS', 'You are already friends with this person', 409);
    }
    if (existing?.status === 'blocked') {
        // Never reveal a block. Behave exactly like a delivered invitation.
        return uniformResult;
    }

    const pair = orderPair(userId, recipient._id);
    const pendingForPair = await FriendInvitation.findOne({
        pair_low_id: pair.user_low_id,
        pair_high_id: pair.user_high_id,
        status: 'pending',
    });

    if (pendingForPair) {
        // If THEY already invited US, do not create a mirror request — point the
        // caller at the incoming one so the pair converges on a single decision.
        if (pendingForPair.recipient_user_id.toString() === userId.toString()) {
            throw friendError(
                'INCOMING_REQUEST_EXISTS',
                'This person has already sent you a friend request. Accept it from your Friends tab.',
                409
            );
        }
        return uniformResult;
    }

    /**
     * How this invitation will reach them, decided by whether they can already
     * be reached in the app at all.
     *
     * An unclaimed guest — whether we just created it or it came from an
     * abandoned checkout — has no way to see an in-app notification: they have
     * never signed in, and the disclosure rule means the notification list is
     * refused to them anyway. Those get a WhatsApp link. An existing customer
     * keeps the in-app request they already know how to answer.
     */
    //
    // Any unclaimed guest takes the WhatsApp route now, however they were typed: an email
    // that resolves to a guest from an abandoned checkout is still someone who cannot see
    // an in-app request. Every invitation carries a token, so the WhatsApp copy sent to an
    // existing customer has a /invite/ link to point at (it forwards to the Friends tab).
    const needsOutOfBandInvite = guestDisclosureBlocked(recipient);
    const token = generateInviteToken();

    const invitation = await FriendInvitation.create({
        sender_user_id: userId,
        recipient_user_id: recipient._id,
        pair_low_id: pair.user_low_id,
        pair_high_id: pair.user_high_id,
        identifier_type: parsed.type,
        identifier_masked: maskInviteIdentifier(parsed),
        sender_shared_address_ids: validatedAddressIds.map((id) => new mongoose.Types.ObjectId(id)),
        status: 'pending',
        expires_at: buildExpiry(),
        channel: needsOutOfBandInvite ? 'whatsapp' : 'in_app',
        token_hash: hashInviteToken(token),
        created_recipient_account: created,
        last_sent_at: new Date(),
    });

    if (needsOutOfBandInvite) {
        try {
            const sent = await sendWhatsappInvite({
                phone: recipient.phone,
                inviterName: me.name,
                contextLine: language === 'ar'
                    ? 'عايز يضيفك كصديق على ريدي كار عشان تقدروا تشتروا قطع لبعض'
                    : 'wants to connect with you on ReadyCar so you can buy parts for each other',
                url: buildFriendInvitationUrl(token),
                campaignLabel: `Friend invitation from ${me.name}`,
            });
            if (sent?.campaignId) {
                await FriendInvitation.updateOne(
                    { _id: invitation._id },
                    { delivery_reference: String(sent.campaignId) }
                );
            }
            if (sent?.skipped) {
                // Nothing was delivered and nothing ever will be for this row.
                // Drop it so the sender can retry once delivery is configured,
                // rather than leaving an invitation that looks sent and is not.
                await FriendInvitation.deleteOne({ _id: invitation._id });
                throw friendError(
                    'INVITE_DELIVERY_UNAVAILABLE',
                    'WhatsApp invitations are not available right now. Please try again later.',
                    503
                );
            }
        } catch (err) {
            if (err.code === 'INVITE_DELIVERY_UNAVAILABLE') throw err;
            await FriendInvitation.deleteOne({ _id: invitation._id });
            throw friendError(
                'INVITE_DELIVERY_FAILED',
                `Could not send the WhatsApp invitation: ${err.message}`,
                502
            );
        }
    } else {
        await notifyCustomer(
            recipient._id,
            'friend_invitation_received',
            {
                title_en: 'New friend request',
                title_ar: 'طلب صداقة جديد',
                message_en: `${me.name} wants to connect with you on ReadyCar so you can buy parts for each other.`,
                message_ar: `يريد ${me.name} إضافتك كصديق على ReadyCar حتى تتمكنا من شراء القطع لبعضكما.`,
            },
            { link: '/profile?tab=friends', data: { invitation_id: invitation._id } }
        );
    }

    // Then every other channel the person has: their email, and WhatsApp for a customer
    // who so far only got the in-app request.
    const extraChannels = await deliverFriendInviteExtras({
        recipient,
        sender: me,
        invitation,
        token,
        primary: needsOutOfBandInvite ? 'whatsapp' : 'in_app',
    });

    await recordAuditLog({
        action: 'friend_invitation_sent',
        actor: { role: 'user', label: me.name },
        target_type: 'friend_invitation',
        target_id: invitation._id,
        target_snapshot: {
            identifier_type: parsed.type,
            identifier_masked: invitation.identifier_masked,
            channel: invitation.channel,
            extra_channels: extraChannels,
            created_recipient_account: created,
        },
        impact: { shared_address_count: validatedAddressIds.length },
    });

    // Deliberately the SAME object the early returns above use. Reporting the
    // delivery channel here would undo everything they are careful about: the
    // sender would learn that a WhatsApp link went out, and therefore that the
    // number had no account — the precise fact this endpoint must not disclose.
    // The sender chose the number and it has been contacted; which pipe carried
    // it is not information they need.
    return uniformResult;
};

/** Load a pending invitation the caller is allowed to act on, in a given role. */
const loadPendingInvitation = async (invitationId, userId, role) => {
    if (!mongoose.Types.ObjectId.isValid(invitationId)) {
        throw friendError('INVITATION_NOT_FOUND', 'Friend request not found', 404);
    }

    const field = role === 'recipient' ? 'recipient_user_id' : 'sender_user_id';
    const invitation = await FriendInvitation.findOne({ _id: invitationId, [field]: userId });
    if (!invitation) throw friendError('INVITATION_NOT_FOUND', 'Friend request not found', 404);

    if (invitation.status !== 'pending') {
        throw friendError('INVITATION_NOT_PENDING', 'This friend request is no longer pending', 409);
    }
    if (invitation.expires_at <= new Date()) {
        invitation.status = 'expired';
        await invitation.save();
        throw friendError('INVITATION_EXPIRED', 'This friend request has expired', 410);
    }

    return invitation;
};

/**
 * Accept a friend request.
 *
 * Creates the single symmetric friendship row and BOTH directional sharing
 * lists at once: the sender's choices were captured when they invited, the
 * recipient's are supplied here. Neither side ends up able to buy for someone
 * who never agreed to receive.
 */
const acceptInvitation = async (userId, invitationId, { shared_address_ids = [] } = {}) => {
    const invitation = await loadPendingInvitation(invitationId, userId, 'recipient');

    const me = await User.findById(userId).select('name addresses');
    if ((me.addresses || []).length === 0) {
        throw friendError(
            'NO_SAVED_ADDRESS',
            'Add a delivery address to your account before accepting a friend request',
            409
        );
    }

    const myAddressIds = assertOwnedAddressIds(me, shared_address_ids);
    if (myAddressIds.length === 0) {
        throw friendError('SHARE_ADDRESS_REQUIRED', 'Select at least one of your addresses to share', 400);
    }

    if (await countActiveFriends(userId) >= MAX_ACTIVE_FRIENDS) {
        throw friendError('FRIEND_LIMIT_REACHED', `You can have at most ${MAX_ACTIVE_FRIENDS} friends`, 409);
    }

    const sender = await User.findById(invitation.sender_user_id).select('name addresses');
    if (!sender) throw friendError('USER_NOT_FOUND', 'That customer no longer exists', 404);

    const pair = orderPair(userId, invitation.sender_user_id);
    const existing = await findFriendshipRow(userId, invitation.sender_user_id);
    if (existing?.status === 'blocked') {
        throw friendError('FRIENDSHIP_BLOCKED', 'This friend request can no longer be accepted', 409);
    }

    // One row per pair, ever — reactivate rather than insert a duplicate.
    const friendship = existing
        ? Object.assign(existing, {
            status: 'active',
            accepted_at: new Date(),
            ended_at: null,
            initiated_by_user_id: invitation.sender_user_id,
        })
        : new Friendship({ ...pair, initiated_by_user_id: invitation.sender_user_id, status: 'active' });
    await friendship.save();

    // The sender's offer may have gone stale (addresses deleted since inviting),
    // so re-validate it against their CURRENT address book rather than trusting
    // what was stored at invite time.
    const senderAddressIds = (invitation.sender_shared_address_ids || [])
        .map(String)
        .filter((id) => (sender.addresses || []).some((address) => address._id.toString() === id));

    await Promise.all([
        replaceSharedAddresses({
            friendship,
            ownerUserId: invitation.sender_user_id,
            viewerUserId: userId,
            addressIds: senderAddressIds,
        }),
        replaceSharedAddresses({
            friendship,
            ownerUserId: userId,
            viewerUserId: invitation.sender_user_id,
            addressIds: myAddressIds,
        }),
    ]);

    invitation.status = 'accepted';
    invitation.responded_at = new Date();
    await invitation.save();

    await notifyCustomer(
        invitation.sender_user_id,
        'friend_invitation_accepted',
        {
            title_en: 'Friend request accepted',
            title_ar: 'تم قبول طلب الصداقة',
            message_en: `${me.name} accepted your friend request. You can now buy parts for each other.`,
            message_ar: `قبل ${me.name} طلب الصداقة. يمكنكما الآن شراء القطع لبعضكما.`,
        },
        { link: '/profile?tab=friends', data: { friendship_id: friendship._id } }
    );

    await recordAuditLog({
        action: 'friend_invitation_accepted',
        actor: { role: 'user', label: me.name },
        target_type: 'friendship',
        target_id: friendship._id,
        target_snapshot: { sender_user_id: invitation.sender_user_id, recipient_user_id: userId },
        impact: {
            sender_shared_count: senderAddressIds.length,
            recipient_shared_count: myAddressIds.length,
        },
    });

    return {
        friendship_id: friendship._id,
        friend: publicProfile(sender),
        // Surfaced so the UI can warn if the sender's offer expired with their addresses.
        sender_shared_address_count: senderAddressIds.length,
    };
};

const declineInvitation = async (userId, invitationId) => {
    const invitation = await loadPendingInvitation(invitationId, userId, 'recipient');

    invitation.status = 'declined';
    invitation.responded_at = new Date();
    await invitation.save();

    const me = await User.findById(userId).select('name');
    await notifyCustomer(
        invitation.sender_user_id,
        'friend_invitation_declined',
        {
            title_en: 'Friend request declined',
            title_ar: 'تم رفض طلب الصداقة',
            message_en: `${me.name} declined your friend request.`,
            message_ar: `رفض ${me.name} طلب الصداقة.`,
        },
        { link: '/profile?tab=friends' }
    );

    return { declined: true };
};

const cancelInvitation = async (userId, invitationId) => {
    const invitation = await loadPendingInvitation(invitationId, userId, 'sender');

    invitation.status = 'cancelled';
    invitation.responded_at = new Date();
    await invitation.save();

    return { cancelled: true };
};

/* ------------------------------------------------------------------ */
/* Ending a friendship                                                 */
/* ------------------------------------------------------------------ */

/**
 * Tear down a friendship. Shared addresses are revoked on BOTH sides
 * immediately — a friendship that has ended must not leave a usable grant
 * behind in either direction. Completed orders are untouched.
 */
const endFriendship = async (friendship, { status, blockedBy = null }) => {
    friendship.status = status;
    friendship.blocked_by_user_id = blockedBy;
    friendship.ended_at = new Date();
    await friendship.save();

    const removed = await FriendAddressShare.deleteMany({ friendship_id: friendship._id });
    return removed.deletedCount || 0;
};

const removeFriend = async (userId, friendUserId) => {
    const friendship = await requireActiveFriendship(userId, friendUserId);
    const [me, revoked] = await Promise.all([
        User.findById(userId).select('name'),
        endFriendship(friendship, { status: 'removed' }),
    ]);

    await notifyCustomer(
        friendUserId,
        'friendship_removed',
        {
            title_en: 'A friend removed you',
            title_ar: 'قام أحد الأصدقاء بإزالتك',
            message_en: `${me.name} is no longer connected with you on ReadyCar.`,
            message_ar: `لم يعد ${me.name} على قائمة أصدقائك في ReadyCar.`,
        },
        { link: '/profile?tab=friends' }
    );

    await recordAuditLog({
        action: 'friendship_removed',
        actor: { role: 'user', label: me.name },
        target_type: 'friendship',
        target_id: friendship._id,
        target_snapshot: { removed_user_id: friendUserId },
        impact: { revoked_address_shares: revoked },
    });

    return { removed: true, revoked_address_shares: revoked };
};

/**
 * Block a customer. Stronger than removing: the pair row stays `blocked`, so a
 * new invitation in either direction silently no-ops instead of reconnecting.
 * The blocked account is never told, which is the point of blocking.
 */
const blockFriend = async (userId, friendUserId) => {
    const friendship = await findFriendshipRow(userId, friendUserId);
    if (!friendship) throw friendError('FRIENDSHIP_NOT_FOUND', 'Friend not found', 404);

    const me = await User.findById(userId).select('name');
    const revoked = await endFriendship(friendship, { status: 'blocked', blockedBy: userId });

    // Any pending invitation between the two is void.
    await FriendInvitation.updateMany(
        {
            status: 'pending',
            pair_low_id: friendship.user_low_id,
            pair_high_id: friendship.user_high_id,
        },
        { status: 'cancelled', responded_at: new Date(), updated_at: new Date() }
    );

    await recordAuditLog({
        action: 'friendship_blocked',
        actor: { role: 'user', label: me.name },
        target_type: 'friendship',
        target_id: friendship._id,
        target_snapshot: { blocked_user_id: friendUserId },
        impact: { revoked_address_shares: revoked },
    });

    return { blocked: true };
};

/**
 * Friends the caller can currently buy FOR — active, and having shared at
 * least one still-existing address. This is what populates the checkout
 * recipient selector.
 */
const getPurchasableFriends = async (userId) => {
    const friendships = await Friendship.find({
        status: 'active',
        $or: [{ user_low_id: userId }, { user_high_id: userId }],
    });
    if (friendships.length === 0) return { friends: [] };

    const friendIds = friendships.map((friendship) => otherParticipant(friendship, userId));

    const [friends, shares] = await Promise.all([
        User.find({ _id: { $in: friendIds } }).select('name profile_image addresses'),
        FriendAddressShare.find({ viewer_user_id: userId, owner_user_id: { $in: friendIds } }).lean(),
    ]);

    const sharedByOwner = shares.reduce((map, share) => {
        const id = share.owner_user_id.toString();
        if (!map.has(id)) map.set(id, new Set());
        map.get(id).add(share.address_id.toString());
        return map;
    }, new Map());

    const friendshipByFriend = new Map(
        friendships.map((friendship) => [otherParticipant(friendship, userId).toString(), friendship])
    );

    return {
        friends: friends.map((friend) => {
            const sharedIds = sharedByOwner.get(friend._id.toString()) || new Set();
            // A share whose address was since deleted is not usable.
            const usable = (friend.addresses || []).filter((address) => sharedIds.has(address._id.toString()));

            return {
                ...publicProfile(friend),
                friendship_id: friendshipByFriend.get(friend._id.toString())._id,
                shared_address_count: usable.length,
                can_buy_for_them: usable.length > 0,
            };
        }),
    };
};

/** Cron sweep: retire invitations nobody answered. */
const expireOldInvitations = async () => {
    const result = await FriendInvitation.updateMany(
        { status: 'pending', expires_at: { $lte: new Date() } },
        { status: 'expired', updated_at: new Date() }
    );
    return { expired: result.modifiedCount || 0 };
};


/* ------------------------------------------------------------------ */
/* Token-addressed acceptance, for an invitee with no account          */
/* ------------------------------------------------------------------ */

/**
 * Load a WhatsApp invitation by its token, or say precisely why it is unusable.
 *
 * Every failure below is deliberately specific rather than uniform. This is not
 * an enumeration surface: reaching it at all requires holding a 32-byte token,
 * and someone who has one is entitled to know whether it expired, was answered,
 * or was cancelled — a flat "invalid" would leave them with no idea whether to
 * ask the sender for another.
 */
const loadFriendInvitationByToken = async (token) => {
    const raw = String(token || '');
    if (!raw) throw friendError('INVITATION_NOT_FOUND', 'This invitation link is not valid', 404);

    const invitation = await FriendInvitation.findOne({
        token_hash: hashInviteToken(raw),
        channel: 'whatsapp',
    });
    if (!invitation) throw friendError('INVITATION_NOT_FOUND', 'This invitation link is not valid', 404);

    if (invitation.status === 'accepted') {
        throw friendError('INVITATION_ALREADY_ACCEPTED', 'This invitation has already been accepted', 409);
    }
    if (invitation.status === 'declined' || invitation.status === 'cancelled') {
        throw friendError('INVITATION_CLOSED', 'This invitation is no longer available', 409);
    }
    if (invitation.status === 'expired' || invitation.expires_at <= new Date()) {
        if (invitation.status === 'pending') {
            invitation.status = 'expired';
            await invitation.save();
        }
        throw friendError('INVITATION_EXPIRED', 'This invitation has expired. Ask your friend to send a new one.', 410);
    }

    return invitation;
};

/**
 * What the landing page may show before anyone has proved anything.
 *
 * Deliberately thin: who is inviting them, and how many addresses that person
 * is offering to share. Not the addresses themselves, not the sender's contact
 * details, and nothing at all about the invited account — the visitor holding
 * this link has not yet demonstrated that the number is theirs.
 */
const getFriendInvitationPreview = async (token) => {
    const invitation = await loadFriendInvitationByToken(token);
    const sender = await User.findById(invitation.sender_user_id).select('name profile_image addresses');
    if (!sender) throw friendError('USER_NOT_FOUND', 'That customer no longer exists', 404);

    const recipient = await User.findById(invitation.recipient_user_id).select('name phone account_status phone_verified_at addresses');
    if (!recipient) throw friendError('INVITATION_NOT_FOUND', 'This invitation link is not valid', 404);

    return {
        invitation_id: invitation._id,
        expires_at: invitation.expires_at,
        inviter: publicProfile(sender),
        // How much the sender is putting on the table, as a count only.
        sender_shared_address_count: (invitation.sender_shared_address_ids || []).length,
        // Masked, so the invitee can confirm the link reached the right number
        // without the page ever printing a full one.
        invited_masked: invitation.identifier_masked,
        // Whether accepting will also create their account. Drives whether the
        // page asks for a name and an address, or simply for the code.
        needs_account_setup: guestDisclosureBlocked(recipient),
        recipient_has_address: (recipient.addresses || []).length > 0,
    };
};

/** Issue the WhatsApp code that proves the invitee holds the invited number. */
const sendFriendInviteCode = async (token, { language = 'en' } = {}) => {
    const invitation = await loadFriendInvitationByToken(token);
    const recipient = await User.findById(invitation.recipient_user_id);
    if (!recipient) throw friendError('INVITATION_NOT_FOUND', 'This invitation link is not valid', 404);

    const { sendInviteClaimCode } = require('./guestCheckoutService');
    return await sendInviteClaimCode({ user: recipient, language });
};

/**
 * Accept over the token: prove the number, claim the account, join the pair.
 *
 * The address is collected here rather than afterwards because a friendship
 * with nothing shared back is inert — the sender specifically invited this
 * person so they could buy for each other, and an invitee with no address on
 * file cannot be bought for. Asking once, at the only moment they are certainly
 * paying attention, beats a friendship that quietly does not work.
 */
const acceptFriendInvitationViaToken = async (token, { code, name, address, language = 'en', rememberMe = true } = {}) => {
    const invitation = await loadFriendInvitationByToken(token);

    const recipient = await User.findById(invitation.recipient_user_id);
    if (!recipient) throw friendError('INVITATION_NOT_FOUND', 'This invitation link is not valid', 404);

    const needsSetup = guestDisclosureBlocked(recipient);

    // Verify BEFORE writing anything. A wrong code must leave no trace — no
    // address added, no name changed, no friendship half-created.
    const { claimInvitedAccount } = require('./guestCheckoutService');
    const session = await claimInvitedAccount({
        user: recipient,
        code,
        name: needsSetup ? name : '',
        rememberMe,
    });

    // Reload: the claim just changed account_status, and everything below reads
    // the account as it is now rather than as it was when the page loaded.
    const claimed = await User.findById(recipient._id);

    if ((claimed.addresses || []).length === 0) {
        const recipientName = String(name || claimed.name || '').trim();
        const line = String(address?.full_address || '').trim();
        if (!line) {
            throw friendError(
                'ADDRESS_REQUIRED',
                'Add a delivery address so your friend can send parts to you',
                400
            );
        }
        claimed.addresses.push({
            recipient_name: recipientName || claimed.name,
            phone: claimed.phone,
            full_address: line,
            shipping_country: address?.shipping_country || null,
            shipping_city: address?.shipping_city || null,
            is_default: true,
        });
        await claimed.save();
    }

    // From here the normal acceptance runs unchanged — same friendship row, same
    // address-share rows, same notification to the sender. The token flow only
    // ever replaced how the invitee got here and how they proved who they are.
    const shareIds = (claimed.addresses || []).map((a) => a._id.toString());
    const result = await acceptInvitation(claimed._id, invitation._id, { shared_address_ids: shareIds });

    return { ...result, token: session.token, user: session.user };
};

/** Decline over the token. Requires no proof: refusing grants nothing. */
const declineFriendInvitationViaToken = async (token) => {
    const invitation = await loadFriendInvitationByToken(token);

    invitation.status = 'declined';
    invitation.responded_at = new Date();
    await invitation.save();

    await notifyCustomer(
        invitation.sender_user_id,
        'friend_invitation_declined',
        {
            title_en: 'Friend request declined',
            title_ar: 'تم رفض طلب الصداقة',
            message_en: 'Your friend request was declined.',
            message_ar: 'تم رفض طلب الصداقة الذي أرسلته.',
        },
        { link: '/profile?tab=friends' }
    );

    return { declined: true };
};

module.exports = {
    MAX_ACTIVE_FRIENDS,
    friendError,
    findFriendshipRow,
    otherParticipant,
    requireActiveFriendship,
    getSharedAddressIds,
    getFriendsOverview,
    getPurchasableFriends,
    getAddressesSharedWithMe,
    getMySharedAddresses,
    updateMySharedAddresses,
    inviteFriend,
    convertPendingEmailInvites,
    getFriendInvitationPreview,
    sendFriendInviteCode,
    acceptFriendInvitationViaToken,
    declineFriendInvitationViaToken,
    acceptInvitation,
    declineInvitation,
    cancelInvitation,
    removeFriend,
    blockFriend,
    expireOldInvitations,
};
