/**
 * Friends Router — friendships, invitations, and directional address sharing.
 * Mounted at /api/users/friends.
 *
 * Every endpoint requires a CUSTOMER session. Vendor and admin accounts cannot
 * participate in friendships at all: `protect('user')` rejects them outright.
 * The caller is always derived from the session — a payer, owner, or viewer id
 * is never accepted from the request body.
 */
const express = require('express');
const router = express.Router();
const { protect, denyUnclaimedGuest } = require('../middleware/authMiddleware');
const { rateLimit } = require('../middleware/rateLimit');
const friendService = require('../services/friendService');
const friendCheckoutService = require('../services/friendCheckoutService');

const fail = (res, error) => res.status(error.status || 400).json({
    code: error.code || 'FRIEND_ERROR',
    message: error.message,
});

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

/**
 * @desc    Active friends, incoming requests, and outgoing invitations
 * @route   GET /api/users/friends
 */
router.get('/', protect('user'), async (req, res) => {
    try {
        res.json(await friendService.getFriendsOverview(req.user._id));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Friends the caller can currently buy for (drives the checkout selector)
 * @route   GET /api/users/friends/purchasable
 */
router.get('/purchasable', protect('user'), denyUnclaimedGuest, async (req, res) => {
    try {
        res.json(await friendService.getPurchasableFriends(req.user._id));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Orders a friend bought FOR the caller — read-only, no financial data
 * @route   GET /api/users/friends/orders-for-me
 */
router.get('/orders-for-me', protect('user'), async (req, res) => {
    try {
        res.json(await friendCheckoutService.getOrdersForMe(req.user._id));
    } catch (error) {
        fail(res, error);
    }
});

/* ------------------------------------------------------------------ */
/* Invitations                                                         */
/* ------------------------------------------------------------------ */

/**
 * @desc    Invite someone by email or mobile number, account or not
 * @route   POST /api/users/friends/invitations
 *
 * A mobile number with no account gets a placeholder account and a WhatsApp
 * link. That makes this endpoint able to send messages to arbitrary numbers, so
 * the rate limit here is a real control rather than a double-click guard — and
 * `MAX_PENDING_INVITATIONS` in the service caps the standing total on top of it.
 */
router.post(
    '/invitations',
    protect('user'),
    denyUnclaimedGuest,
    rateLimit({ name: 'friend_invite', windowMs: 60 * 60 * 1000, max: 20 }),
    async (req, res) => {
        try {
            const result = await friendService.inviteFriend(
                req.user._id,
                {
                    identifier: req.body?.identifier,
                    shared_address_ids: req.body?.shared_address_ids,
                },
                { language: req.body?.language === 'ar' ? 'ar' : 'en' }
            );
            res.status(201).json(result);
        } catch (error) {
            fail(res, error);
        }
    }
);

/**
 * @desc    Accept a friend request, sharing back at least one own address
 * @route   POST /api/users/friends/invitations/:id/accept
 */
router.post(
    '/invitations/:id/accept',
    protect('user'),
    rateLimit({ name: 'friend_invite_accept', windowMs: 10 * 60 * 1000, max: 30 }),
    async (req, res) => {
        try {
            const result = await friendService.acceptInvitation(req.user._id, req.params.id, {
                shared_address_ids: req.body?.shared_address_ids,
            });
            res.json({ message: 'You are now friends.', ...result });
        } catch (error) {
            fail(res, error);
        }
    }
);

/**
 * @desc    Decline a friend request
 * @route   POST /api/users/friends/invitations/:id/decline
 */
router.post('/invitations/:id/decline', protect('user'), async (req, res) => {
    try {
        res.json(await friendService.declineInvitation(req.user._id, req.params.id));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Sender cancels their own pending invitation
 * @route   DELETE /api/users/friends/invitations/:id
 */
router.delete('/invitations/:id', protect('user'), async (req, res) => {
    try {
        res.json(await friendService.cancelInvitation(req.user._id, req.params.id));
    } catch (error) {
        fail(res, error);
    }
});

/* ------------------------------------------------------------------ */
/* Address sharing                                                     */
/* ------------------------------------------------------------------ */

/**
 * @desc    Addresses this friend has shared WITH the caller (authorized view)
 * @route   GET /api/users/friends/:friendId/shared-addresses
 */
router.get('/:friendId/shared-addresses', protect('user'), async (req, res) => {
    try {
        res.json(await friendService.getAddressesSharedWithMe(req.user._id, req.params.friendId));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    The caller's own addresses, flagged with what they share to a friend
 * @route   GET /api/users/friends/:friendId/my-shared-addresses
 */
router.get('/:friendId/my-shared-addresses', protect('user'), async (req, res) => {
    try {
        res.json(await friendService.getMySharedAddresses(req.user._id, req.params.friendId));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Replace which of the caller's addresses a friend may use
 * @route   PUT /api/users/friends/:friendId/my-shared-addresses
 */
router.put('/:friendId/my-shared-addresses', protect('user'), async (req, res) => {
    try {
        const result = await friendService.updateMySharedAddresses(
            req.user._id,
            req.params.friendId,
            req.body?.shared_address_ids || []
        );
        res.json({ message: 'Shared addresses updated.', ...result });
    } catch (error) {
        fail(res, error);
    }
});

/* ------------------------------------------------------------------ */
/* Ending a friendship                                                 */
/* ------------------------------------------------------------------ */

/**
 * @desc    Remove a friendship (revokes address sharing both ways)
 * @route   DELETE /api/users/friends/:friendId
 */
router.delete('/:friendId', protect('user'), async (req, res) => {
    try {
        res.json(await friendService.removeFriend(req.user._id, req.params.friendId));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Block a customer — stronger than removing; future invitations in
 *          either direction silently no-op and the block is never disclosed.
 * @route   POST /api/users/friends/:friendId/block
 */
router.post('/:friendId/block', protect('user'), async (req, res) => {
    try {
        res.json(await friendService.blockFriend(req.user._id, req.params.friendId));
    } catch (error) {
        fail(res, error);
    }
});

module.exports = router;
