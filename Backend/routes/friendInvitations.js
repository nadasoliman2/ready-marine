/**
 * Friend Invitation Router — the token-addressed landing-page endpoints.
 * Mounted at /api/friend-invitations.
 *
 * Reachable without a session by design: these exist for someone who has never
 * had an account, arriving from a WhatsApp message. Opening the link never
 * accepts anything — acceptance always requires the code sent to the invited
 * number, because a forwarded link proves only that a message was forwarded,
 * and accepting grants read access to the inviter's saved addresses.
 */
const express = require('express');
const { startSession } = require('../services/sessionService');
const router = express.Router();
const { rateLimit } = require('../middleware/rateLimit');
const friendService = require('../services/friendService');

const fail = (res, error) => {
    if (error.retryAfterSeconds) res.set('Retry-After', String(error.retryAfterSeconds));
    return res.status(error.status || 400).json({
        code: error.code || 'FRIEND_ERROR',
        message: error.message,
        ...(error.attemptsRemaining !== undefined ? { attempts_remaining: error.attemptsRemaining } : {}),
    });
};

// A refresh session (services/sessionService.js), as every sign-in.
const setAuthCookie = (req, res, token) => startSession(req, res, token, { persistent: true });

/**
 * @desc    Invitation preview for the landing page
 * @route   GET /api/friend-invitations/:token
 *
 * Returns the inviter's public profile, a masked form of the invited number, and
 * whether accepting will also set up an account. Never the shared addresses
 * themselves, and never anything about the invited account — the visitor holding
 * this link has not yet proved the number is theirs.
 */
router.get(
    '/:token',
    rateLimit({ name: 'friend_invite_view', windowMs: 60 * 1000, max: 30 }),
    async (req, res) => {
        try {
            res.json(await friendService.getFriendInvitationPreview(req.params.token));
        } catch (error) {
            fail(res, error);
        }
    }
);

/**
 * @desc    Send the WhatsApp code that proves the invitee holds the number
 * @route   POST /api/friend-invitations/:token/send-code
 */
router.post(
    '/:token/send-code',
    rateLimit({ name: 'friend_invite_send_code', windowMs: 60 * 60 * 1000, max: 10 }),
    async (req, res) => {
        try {
            const verification = await friendService.sendFriendInviteCode(req.params.token, {
                language: req.body?.language === 'ar' ? 'ar' : 'en',
            });
            res.json({ success: true, verification });
        } catch (error) {
            fail(res, error);
        }
    }
);

/**
 * @desc    Accept: prove the number, claim the account, join the pair
 * @route   POST /api/friend-invitations/:token/accept
 *
 * Signs the invitee in on success. There is no separate registration step and
 * no password — the same silent-account pattern checkout uses, so the person
 * goes from a WhatsApp message to an active friendship without ever filling in
 * a sign-up form.
 */
router.post(
    '/:token/accept',
    rateLimit({ name: 'friend_invite_accept', windowMs: 10 * 60 * 1000, max: 30 }),
    async (req, res) => {
        try {
            const result = await friendService.acceptFriendInvitationViaToken(req.params.token, {
                code: req.body?.code,
                name: req.body?.name,
                address: req.body?.address,
                language: req.body?.language === 'ar' ? 'ar' : 'en',
            });
            const { token, ...safe } = result;
            await setAuthCookie(req, res, token);
            res.json({ success: true, ...safe });
        } catch (error) {
            fail(res, error);
        }
    }
);

/**
 * @desc    Decline the invitation
 * @route   POST /api/friend-invitations/:token/decline
 *
 * Deliberately requires no code: refusing grants nothing, and making someone
 * prove who they are before they can say no would be an odd thing to ask.
 */
router.post(
    '/:token/decline',
    rateLimit({ name: 'friend_invite_decline', windowMs: 10 * 60 * 1000, max: 20 }),
    async (req, res) => {
        try {
            res.json(await friendService.declineFriendInvitationViaToken(req.params.token));
        } catch (error) {
            fail(res, error);
        }
    }
);

module.exports = router;
