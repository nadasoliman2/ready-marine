/**
 * Family Invitation Router — the token-addressed landing-page endpoints.
 * Mounted at /api/family-invitations.
 *
 * These are reachable without a session because an invitee may arrive signed
 * out. Opening a link never accepts the invitation: acceptance is always an
 * explicit POST from an account whose email matches the invited address.
 */
const express = require('express');
const router = express.Router();
const { optionalUser } = require('../middleware/authMiddleware');
const { rateLimit } = require('../middleware/rateLimit');
const familyService = require('../services/familyService');

const fail = (res, error) => {
    if (error.retryAfterSeconds) res.set('Retry-After', String(error.retryAfterSeconds));
    return res.status(error.status || 400).json({
        code: error.code || 'FAMILY_ERROR',
        message: error.message,
        ...(error.attemptsRemaining !== undefined ? { attempts_remaining: error.attemptsRemaining } : {}),
    });
};

const setAuthCookie = (res, token) => {
    res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
    });
};

/** A vendor/admin session cannot participate in families. */
const rejectStaffSession = (req, res) => {
    if (req.cookies?.admin_token) {
        res.status(403).json({
            code: 'STAFF_SESSION',
            message: 'Family invitations can only be used with a customer account. Please switch accounts.',
        });
        return true;
    }
    return false;
};

/**
 * @desc    Invitation preview for the landing page. Returns only the organizer
 *          name, relationship, expiry and invited email — never addresses,
 *          members, or any other family data.
 * @route   GET /api/family-invitations/:token
 */
router.get(
    '/:token',
    rateLimit({ name: 'family_invite_view', windowMs: 60 * 1000, max: 30 }),
    optionalUser,
    async (req, res) => {
        try {
            res.json(await familyService.getInvitationPreview(req.params.token, req.user));
        } catch (error) {
            fail(res, error);
        }
    }
);

/**
 * @desc    Accept using the signed-in customer account
 * @route   POST /api/family-invitations/:token/accept
 */
router.post(
    '/:token/accept',
    rateLimit({ name: 'family_invite_accept', windowMs: 10 * 60 * 1000, max: 20 }),
    optionalUser,
    async (req, res) => {
        try {
            if (rejectStaffSession(req, res)) return;
            if (!req.user) {
                return res.status(401).json({
                    code: 'SIGN_IN_REQUIRED',
                    message: 'Sign in with the invited email address to accept this invitation.',
                });
            }
            res.json(await familyService.acceptInvitationAsUser(req.params.token, req.user));
        } catch (error) {
            fail(res, error);
        }
    }
);

/**
 * @desc    Accept by creating a new customer account. The secure invitation
 *          already proves control of the mailbox, so the account is created,
 *          joined, and signed in without a second verification email.
 * @route   POST /api/family-invitations/:token/accept-with-registration
 */
router.post(
    '/:token/accept-with-registration',
    rateLimit({ name: 'family_invite_register', windowMs: 60 * 60 * 1000, max: 10 }),
    optionalUser,
    async (req, res) => {
        try {
            if (rejectStaffSession(req, res)) return;

            const result = await familyService.acceptInvitationWithNewAccount(req.params.token, {
                name: req.body?.name,
                phone: req.body?.phone,
                password: req.body?.password,
                language: req.body?.language === 'ar' ? 'ar' : 'en',
            });

            setAuthCookie(res, result.token);
            res.status(201).json({ joined: true, user: result.user });
        } catch (error) {
            fail(res, error);
        }
    }
);

/**
 * @desc    Send the WhatsApp code that proves the invitee holds the number
 * @route   POST /api/family-invitations/:token/send-code
 *
 * Only for invitations sent over WhatsApp. An emailed invitation is proved by
 * the mailbox it was sent to, and asking for a code there would be asking the
 * invitee for something the invitation never established.
 */
router.post(
    '/:token/send-code',
    rateLimit({ name: 'family_invite_send_code', windowMs: 60 * 60 * 1000, max: 10 }),
    async (req, res) => {
        try {
            const verification = await familyService.sendFamilyInviteCode(req.params.token, {
                language: req.body?.language === 'ar' ? 'ar' : 'en',
            });
            res.json({ success: true, verification });
        } catch (error) {
            fail(res, error);
        }
    }
);

/**
 * @desc    Accept a WhatsApp invitation with the code — no password, no form
 * @route   POST /api/family-invitations/:token/accept-with-code
 *
 * The counterpart to `accept-with-registration`, and the reason that route is
 * no longer the only way in for someone with no account: a member joins with a
 * name and six digits instead of a registration form. They order against the
 * organizer's shared addresses, so nothing else is needed from them.
 */
router.post(
    '/:token/accept-with-code',
    rateLimit({ name: 'family_invite_accept_code', windowMs: 10 * 60 * 1000, max: 30 }),
    async (req, res) => {
        try {
            if (rejectStaffSession(req, res)) return;

            const result = await familyService.acceptInvitationWithCode(req.params.token, {
                code: req.body?.code,
                name: req.body?.name,
                language: req.body?.language === 'ar' ? 'ar' : 'en',
            });

            const { token, ...safe } = result;
            setAuthCookie(res, token);
            res.status(201).json(safe);
        } catch (error) {
            fail(res, error);
        }
    }
);

/**
 * @desc    Decline the invitation
 * @route   POST /api/family-invitations/:token/decline
 */
router.post(
    '/:token/decline',
    rateLimit({ name: 'family_invite_decline', windowMs: 10 * 60 * 1000, max: 20 }),
    async (req, res) => {
        try {
            res.json(await familyService.declineInvitation(req.params.token));
        } catch (error) {
            fail(res, error);
        }
    }
);

module.exports = router;
