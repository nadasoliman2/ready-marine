/**
 * Contact Verification Router — confirming a signed-in account's email and
 * phone number. Serves customers and store owners alike; mounted at
 * /api/users/verification.
 *
 * Both the account id AND its role come from the session, never from the body,
 * so a code can only ever verify the caller's own details on the caller's own
 * kind of account.
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { rateLimit } = require('../middleware/rateLimit');
const service = require('../services/contactVerificationService');

const fail = (res, error) => {
    if (error.retryAfterSeconds) res.set('Retry-After', String(error.retryAfterSeconds));
    return res.status(error.status || 400).json({
        code: error.code || 'VERIFICATION_ERROR',
        message: error.message,
        ...(error.attemptsRemaining !== undefined ? { attempts_remaining: error.attemptsRemaining } : {}),
    });
};

/**
 * @desc    What the caller still needs to confirm
 * @route   GET /api/users/verification/status
 */
router.get('/status', protect('user', 'vendor'), async (req, res) => {
    try {
        res.json(await service.getVerificationStatus(req.user._id, req.userRole));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Send a code. `value` optionally corrects the email/phone first.
 * @route   POST /api/users/verification/send
 */
router.post(
    '/send',
    protect('user', 'vendor'),
    rateLimit({ name: 'contact_verify_send', windowMs: 60 * 60 * 1000, max: 15 }),
    async (req, res) => {
        try {
            const result = await service.sendVerificationCode(req.user._id, {
                target: req.body?.target,
                value: req.body?.value || null,
                language: req.body?.language === 'ar' ? 'ar' : 'en',
                // From the session, never from the body — a customer cannot
                // ask for a code against a store account.
                role: req.userRole,
            });
            res.json({ message: 'Verification code sent.', ...result });
        } catch (error) {
            fail(res, error);
        }
    }
);

/**
 * @desc    Confirm a code and mark the contact detail verified
 * @route   POST /api/users/verification/confirm
 */
router.post(
    '/confirm',
    protect('user', 'vendor'),
    rateLimit({ name: 'contact_verify_confirm', windowMs: 10 * 60 * 1000, max: 30 }),
    async (req, res) => {
        try {
            const result = await service.confirmVerificationCode(req.user._id, {
                target: req.body?.target,
                code: req.body?.code,
                role: req.userRole,
            });
            res.json({ message: 'Verified successfully.', ...result });
        } catch (error) {
            fail(res, error);
        }
    }
);

/**
 * @desc    Discard a staged email/phone change without verifying it
 * @route   POST /api/users/verification/cancel
 */
router.post('/cancel', protect('user', 'vendor'), async (req, res) => {
    try {
        res.json(await service.cancelPendingChange(req.user._id, req.body?.target, req.userRole));
    } catch (error) {
        fail(res, error);
    }
});

module.exports = router;
