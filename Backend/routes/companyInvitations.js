/**
 * Company invitation landing-page endpoints. Mounted at /api/company-invitations.
 *
 * Reachable without a session because an invitee may arrive signed out. Opening
 * a link never accepts: acceptance is an explicit POST from the account that
 * owns the invited email, or with a code sent to the invited number.
 */
const express = require('express');
const router = express.Router();
const { optionalUser } = require('../middleware/authMiddleware');
const { rateLimit } = require('../middleware/rateLimit');
const invitationService = require('../services/companyInvitationService');

const fail = (res, error) => {
    if (error.retryAfterSeconds) res.set('Retry-After', String(error.retryAfterSeconds));
    return res.status(error.status || 400).json({
        code: error.code || 'COMPANY_INVITE_ERROR',
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

/** A company membership belongs to a customer account, never a staff session. */
const rejectStaffSession = (req, res) => {
    if (req.cookies?.admin_token) {
        res.status(403).json({
            code: 'STAFF_SESSION',
            message: 'Company invitations can only be used with a customer account. Please switch accounts.',
        });
        return true;
    }
    return false;
};

const requestLanguage = (req) => (req.body?.language === 'ar' ? 'ar' : 'en');

/**
 * @desc    What the landing page shows — company name, role, limit, office
 * @route   GET /api/company-invitations/:token
 */
router.get(
    '/:token',
    rateLimit({ name: 'company_invite_view', windowMs: 60 * 1000, max: 30 }),
    optionalUser,
    async (req, res) => {
        try {
            res.json(await invitationService.getInvitationPreview(req.params.token, req.user));
        } catch (error) {
            fail(res, error);
        }
    }
);

/**
 * @desc    Accept with the signed-in customer account
 * @route   POST /api/company-invitations/:token/accept
 */
router.post(
    '/:token/accept',
    rateLimit({ name: 'company_invite_accept', windowMs: 10 * 60 * 1000, max: 20 }),
    optionalUser,
    async (req, res) => {
        try {
            if (rejectStaffSession(req, res)) return;
            if (!req.user) {
                return res.status(401).json({
                    code: 'SIGN_IN_REQUIRED',
                    message: 'Sign in with the invited account to accept this invitation.',
                });
            }
            res.json(await invitationService.acceptInvitationAsUser(req.params.token, req.user));
        } catch (error) {
            fail(res, error);
        }
    }
);

/**
 * @desc    Accept an emailed invitation by creating a new account for that address
 * @route   POST /api/company-invitations/:token/accept-with-registration
 */
router.post(
    '/:token/accept-with-registration',
    rateLimit({ name: 'company_invite_register', windowMs: 60 * 60 * 1000, max: 10 }),
    optionalUser,
    async (req, res) => {
        try {
            if (rejectStaffSession(req, res)) return;
            const result = await invitationService.acceptInvitationWithNewAccount(req.params.token, {
                name: req.body?.name,
                phone: req.body?.phone,
                password: req.body?.password,
                language: requestLanguage(req),
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
 * @desc    Send the WhatsApp code that proves the invitee holds the number
 * @route   POST /api/company-invitations/:token/send-code
 */
router.post(
    '/:token/send-code',
    rateLimit({ name: 'company_invite_send_code', windowMs: 60 * 60 * 1000, max: 10 }),
    async (req, res) => {
        try {
            const verification = await invitationService.sendInviteCode(req.params.token, { language: requestLanguage(req) });
            res.json({ success: true, verification });
        } catch (error) {
            fail(res, error);
        }
    }
);

/**
 * @desc    Accept a WhatsApp invitation with the code
 * @route   POST /api/company-invitations/:token/accept-with-code
 */
router.post(
    '/:token/accept-with-code',
    rateLimit({ name: 'company_invite_accept_code', windowMs: 10 * 60 * 1000, max: 30 }),
    async (req, res) => {
        try {
            if (rejectStaffSession(req, res)) return;
            const result = await invitationService.acceptInvitationWithCode(req.params.token, {
                code: req.body?.code,
                name: req.body?.name,
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
 * @route   POST /api/company-invitations/:token/decline
 */
router.post(
    '/:token/decline',
    rateLimit({ name: 'company_invite_decline', windowMs: 10 * 60 * 1000, max: 20 }),
    async (req, res) => {
        try {
            res.json(await invitationService.declineInvitation(req.params.token));
        } catch (error) {
            fail(res, error);
        }
    }
);

module.exports = router;
