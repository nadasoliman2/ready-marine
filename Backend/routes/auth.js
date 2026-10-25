const express = require('express');
const router = express.Router();
const {
    registerUser,
    authenticateUser,
    registerVendor,
    authenticateVendor,
    verifyEmailRegistration,
    verifyRegistrationOtp,
    resendRegistrationOtp,
    requestPasswordReset,
    resetPasswordWithToken,
    requestPasswordResetOtp,
    resetPasswordWithOtp,
    authenticateWithGoogle,
    completeGoogleSignup,
} = require('../services/authService');
const { isGoogleConfigured } = require('../services/googleAuthService');
const {
    registerUserValidation,
    registerVendorValidation,
    loginValidation,
    forgotPasswordValidation,
    resetPasswordValidation,
} = require('../middleware/validators');
const { protect } = require('../middleware/authMiddleware');
const { rateLimit } = require('../middleware/rateLimit');
const {
    lookupPhone,
    startGuestSession,
    sendGuestConfirmation,
    confirmGuestPhone,
    setGuestPassword,
    startOtpLogin,
    verifyOtpLogin,
} = require('../services/guestCheckoutService');

/**
 * Helper to set auth cookie
 */
const setAuthCookie = (res, token, rememberMe = false) => {
    const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
    };
    if (rememberMe) {
        options.maxAge = 30 * 24 * 60 * 60 * 1000;
    }
    res.cookie('token', token, options);
};

const getErrorStatus = (error) => {
    if (
        error.message.includes('already in use') ||
        error.message.includes('invalid or expired') ||
        error.message.includes('at least 8 characters') ||
        error.message.includes('required')
    ) {
        return 400;
    }

    if (error.message.includes('Could not send verification email')) {
        return 502;
    }

    return 500;
};

const getFrontendLoginUrl = (verified, role = '') => {
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
    const params = new URLSearchParams({ verified: verified ? '1' : '0' });
    if (role) {
        params.set('role', role === 'vendor' ? 'vendor' : 'customer');
        params.set('auto', '1');
    }
    return `${frontendUrl}/login?${params.toString()}`;
};

const getRequestBaseUrl = (req) => {
    const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
    return `${proto}://${req.get('host')}`;
};

/**
 * @desc    Register a new user
 * @route   POST /api/auth/register-user
 */
router.post('/register-user', registerUserValidation, async (req, res) => {
    try {
        const result = await registerUser(req.body, {
            requestBaseUrl: getRequestBaseUrl(req),
            language: req.body.language,
            channel: req.body.verification_channel,
        });

        res.status(201).json({
            message: result.channel === 'whatsapp'
                ? 'We sent a 6-digit code to your WhatsApp number. Enter it to finish creating your account.'
                : 'Verification email sent. Please verify your email to complete registration.',
            verification: result,
        });
    } catch (error) {
        res.status(error.status || getErrorStatus(error)).json({
            code: error.code,
            message: error.message,
        });
    }
});

/**
 * @desc    Complete a WhatsApp-OTP registration and create the account
 * @route   POST /api/auth/verify-registration-otp
 */
router.post(
    '/verify-registration-otp',
    rateLimit({ name: 'register_otp_verify', windowMs: 10 * 60 * 1000, max: 30 }),
    async (req, res) => {
        try {
            const result = await verifyRegistrationOtp({
                verificationId: req.body?.verification_id,
                code: req.body?.code,
            });

            setAuthCookie(res, result.token, false);
            const { token, ...safeResult } = result;
            res.json({
                message: result.role === 'vendor'
                    ? 'Verified. Your store has been created.'
                    : 'Verified. Your account has been created.',
                ...safeResult,
            });
        } catch (error) {
            res.status(error.status || getErrorStatus(error)).json({
                code: error.code,
                message: error.message,
                ...(error.attemptsRemaining !== undefined ? { attempts_remaining: error.attemptsRemaining } : {}),
            });
        }
    }
);

/**
 * @desc    Re-send the registration OTP
 * @route   POST /api/auth/resend-registration-otp
 */
router.post(
    '/resend-registration-otp',
    rateLimit({ name: 'register_otp_resend', windowMs: 60 * 60 * 1000, max: 10 }),
    async (req, res) => {
        try {
            const result = await resendRegistrationOtp({
                verificationId: req.body?.verification_id,
                language: req.body?.language,
            });
            res.json({ message: 'A new code is on its way.', verification: result });
        } catch (error) {
            const status = error.status || getErrorStatus(error);
            if (error.retryAfterSeconds) res.set('Retry-After', String(error.retryAfterSeconds));
            res.status(status).json({ code: error.code, message: error.message });
        }
    }
);

/**
 * @desc    Login user
 * @route   POST /api/auth/login-user
 */
router.post('/login-user', loginValidation, async (req, res) => {
    try {
        const { identifier, password, remember_me } = req.body;
        const rememberMe = remember_me === true || remember_me === 'true';
        const { token, user } = await authenticateUser(identifier, password, { rememberMe });
        
        setAuthCookie(res, token, rememberMe);
        
        res.json({
            message: 'Login successful',
            user
        });
    } catch (error) {
        const status = error.message === 'Invalid credentials' ? 401 : error.message.includes('suspended') ? 403 : 500;
        res.status(status).json({ message: error.message });
    }
});

/**
 * @desc    Get current user/vendor from auth cookie
 * @route   GET /api/auth/me
 */
router.get('/me', protect('user', 'vendor'), (req, res) => {
    if (req.userRole === 'vendor') {
        return res.json({
            role: 'vendor',
            vendor: {
                id: req.user._id,
                store_name: req.user.store_name,
                store_username: req.user.store_username,
                email: req.user.email,
                phone: req.user.phone,
                status: req.user.status || 'active',
                role: 'vendor',
                // Drives the dashboard prompt asking the owner to confirm
                // whichever contact detail they have not proved yet.
                email_verified: !!req.user.email_verified_at,
                phone_verified: !!req.user.phone_verified_at,
            },
        });
    }

    res.json({
        role: 'user',
        user: {
            id: req.user._id,
            name: req.user.name,
            email: req.user.email,
            phone: req.user.phone,
            profile_image: req.user.profile_image || null,
            role: 'user',
            cars: req.user.cars || [],
            // Drives the post-login prompt asking the customer to confirm
            // whichever contact detail they have not proved yet.
            email_verified: !!req.user.email_verified_at,
            phone_verified: !!req.user.phone_verified_at,
        },
    });
});

/**
 * @desc    Register a new vendor
 * @route   POST /api/auth/register-vendor
 */
router.post('/register-vendor', registerVendorValidation, async (req, res) => {
    try {
        const result = await registerVendor(req.body, {
            requestBaseUrl: getRequestBaseUrl(req),
            language: req.body.language,
            channel: req.body.verification_channel,
        });
        res.status(201).json({
            message: result.channel === 'whatsapp'
                ? 'We sent a 6-digit code to your WhatsApp number. Enter it to finish creating your store.'
                : 'We sent a 6-digit code to your email. Enter it to finish creating your store.',
            verification: result
        });
    } catch (error) {
        res.status(getErrorStatus(error)).json({ message: error.message });
    }
});

/**
 * @desc    Verify email and create account from pending registration
 * @route   GET /api/auth/verify-email
 */
router.get('/verify-email', async (req, res) => {
    try {
        const result = await verifyEmailRegistration(req.query.token);
        setAuthCookie(res, result.token, false);
        res.redirect(getFrontendLoginUrl(true, result.role));
    } catch (error) {
        res.redirect(getFrontendLoginUrl(false));
    }
});

/**
 * @desc    Verify email and create account from pending registration (API clients)
 * @route   POST /api/auth/verify-email
 */
router.post('/verify-email', async (req, res) => {
    try {
        const result = await verifyEmailRegistration(req.body.token);
        setAuthCookie(res, result.token, false);
        const { token, ...safeResult } = result;
        res.json({
            message: 'Email verified successfully. Your account has been created.',
            ...safeResult
        });
    } catch (error) {
        res.status(getErrorStatus(error)).json({ message: error.message });
    }
});

/**
 * @desc    Request a password reset email for a user or vendor account
 * @route   POST /api/auth/forgot-password
 */
router.post('/forgot-password', forgotPasswordValidation, async (req, res) => {
    try {
        const result = await requestPasswordReset({
            role: req.body.role,
            email: req.body.email,
            language: req.body.language,
        });
        res.json(result);
    } catch (error) {
        res.status(getErrorStatus(error)).json({ message: error.message });
    }
});

/**
 * @desc    Send a password-reset code to the account's WhatsApp (alternative to email)
 * @route   POST /api/auth/forgot-password/otp
 *
 * Same answer whether or not the number has an account — see requestPasswordResetOtp.
 */
router.post(
    '/forgot-password/otp',
    rateLimit({ name: 'password_reset_otp_send', windowMs: 60 * 60 * 1000, max: 10 }),
    async (req, res) => {
        try {
            const verification = await requestPasswordResetOtp({
                role: req.body?.role,
                phone: req.body?.phone,
                language: req.body?.language,
            });
            res.json({ success: true, verification });
        } catch (error) {
            sendGuestError(res, error);
        }
    }
);

/**
 * @desc    Set a new password with the WhatsApp code
 * @route   POST /api/auth/reset-password/otp
 */
router.post(
    '/reset-password/otp',
    rateLimit({ name: 'password_reset_otp_verify', windowMs: 10 * 60 * 1000, max: 30 }),
    async (req, res) => {
        try {
            const result = await resetPasswordWithOtp({
                role: req.body?.role,
                phone: req.body?.phone,
                code: req.body?.code,
                password: req.body?.password,
            });
            res.json({ success: true, ...result });
        } catch (error) {
            sendGuestError(res, error);
        }
    }
);

/**
 * @desc    Reset user or vendor password with a one-time email token
 * @route   POST /api/auth/reset-password
 */
router.post('/reset-password', resetPasswordValidation, async (req, res) => {
    try {
        const result = await resetPasswordWithToken({
            token: req.body.token,
            password: req.body.password,
        });
        res.json(result);
    } catch (error) {
        res.status(getErrorStatus(error)).json({ message: error.message });
    }
});

/**
 * @desc    Login vendor
 * @route   POST /api/auth/login-vendor
 */
router.post('/login-vendor', loginValidation, async (req, res) => {
    try {
        const { identifier, password, remember_me } = req.body;
        const rememberMe = remember_me === true || remember_me === 'true';
        const { token, vendor } = await authenticateVendor(identifier, password, { rememberMe });
        
        setAuthCookie(res, token, rememberMe);
        
        res.json({
            message: 'Login successful',
            vendor
        });
    } catch (error) {
        const status = error.message === 'Invalid credentials' ? 401 : 500;
        res.status(status).json({ message: error.message });
    }
});

/* ------------------------------------------------------------------ */
/* Google Sign-In                                                      */
/* ------------------------------------------------------------------ */

const googleFail = (res, error) => {
    res.status(error.status || 500).json({
        code: error.code || 'GOOGLE_AUTH_ERROR',
        message: error.message,
    });
};

/**
 * @desc    Tell the client whether Google sign-in can be offered
 * @route   GET /api/auth/google/config
 */
router.get('/google/config', (req, res) => {
    res.json({ enabled: isGoogleConfigured() });
});

/**
 * @desc    Sign in (or start a signup) with a Google ID token
 * @route   POST /api/auth/google
 *
 * A brand-new customer comes back as `signup_required` plus a short-lived
 * signup token: Google never supplies a phone number, and the account cannot
 * be created without one.
 */
router.post(
    '/google',
    rateLimit({ name: 'google_auth', windowMs: 10 * 60 * 1000, max: 30 }),
    async (req, res) => {
        try {
            const rememberMe = req.body?.remember_me === true || req.body?.remember_me === 'true';
            const result = await authenticateWithGoogle({
                credential: req.body?.credential,
                role: req.body?.role === 'vendor' ? 'vendor' : 'user',
                rememberMe,
            });

            if (result.status === 'signup_required') {
                return res.json(result);
            }

            setAuthCookie(res, result.token, rememberMe);
            const { token, ...safeResult } = result;
            res.json({ message: 'Login successful', ...safeResult });
        } catch (error) {
            googleFail(res, error);
        }
    }
);

/**
 * @desc    Create the account for a Google signup once the phone is supplied
 * @route   POST /api/auth/google/complete
 */
router.post(
    '/google/complete',
    rateLimit({ name: 'google_signup_complete', windowMs: 10 * 60 * 1000, max: 20 }),
    async (req, res) => {
        try {
            // Which of these matter is decided by the role inside the signed
            // signup token, not by what the caller chooses to send.
            const result = await completeGoogleSignup({
                signupToken: req.body?.signup_token,
                phone: req.body?.phone,
                password: req.body?.password,
                language: req.body?.language,
                store_name: req.body?.store_name,
                store_username: req.body?.store_username,
                address: req.body?.address,
                shipping_country: req.body?.shipping_country,
                shipping_city: req.body?.shipping_city,
            });

            setAuthCookie(res, result.token, false);
            const { token, ...safeResult } = result;
            res.status(201).json({
                message: 'Your account has been created.',
                ...safeResult,
            });
        } catch (error) {
            googleFail(res, error);
        }
    }
);

/* ================================================================== */
/* Guest checkout                                                      */
/* ================================================================== */

/**
 * A guest-checkout failure is always a coded one. `error.status` carries the
 * intended HTTP code and `error.code` the reason the screen switches on;
 * anything without them is a genuine fault and is reported as a 500 rather than
 * flattened into a 400 the customer cannot act on.
 */
const sendGuestError = (res, error) => {
    if (error.retryAfterSeconds) res.set('Retry-After', String(error.retryAfterSeconds));
    return res.status(error.status || 500).json({
        success: false,
        code: error.code || 'GUEST_CHECKOUT_FAILED',
        message: error.message,
        ...(error.attemptsRemaining !== undefined ? { attempts_remaining: error.attemptsRemaining } : {}),
    });
};

/**
 * @desc    Does this number already have an account to sign in to?
 * @route   POST /api/auth/guest/lookup
 *
 * Called as the customer leaves the phone field at checkout, so a returning
 * customer is offered their own account instead of silently starting a second
 * identity. It answers with a bare boolean pair and never a name, an avatar, or
 * a masked email: "does this number shop here" is exactly what an enumeration
 * sweep is after, so the answer is kept useless for building a list and the
 * rate limit is the tightest in this file.
 */
router.post(
    '/guest/lookup',
    rateLimit({ name: 'guest_phone_lookup', windowMs: 10 * 60 * 1000, max: 20 }),
    async (req, res) => {
        try {
            res.json(await lookupPhone(req.body?.phone));
        } catch (error) {
            // Never surface a lookup failure as one — the screen carries on as
            // though the number were new, which is the safe default: it offers
            // nothing, discloses nothing, and the checkout still completes.
            res.json({ exists: false, can_use_password: false });
        }
    }
);

/**
 * @desc    Create (or resume) the account this checkout belongs to
 * @route   POST /api/auth/guest/session
 *
 * Refuses when the number belongs to a real account, with a code the screen
 * turns into "send me a sign-in code" rather than a dead end. Handing out a
 * session for an existing account on nothing but a typed phone number would be
 * this feature's one catastrophic failure mode.
 */
router.post(
    '/guest/session',
    rateLimit({ name: 'guest_session', windowMs: 10 * 60 * 1000, max: 10 }),
    async (req, res) => {
        try {
            const result = await startGuestSession({
                name: req.body?.name,
                phone: req.body?.phone,
                language: req.body?.language,
            });
            // Persistent on purpose: the confirmation code arrives on WhatsApp,
            // and answering it often means leaving the tab and coming back.
            setAuthCookie(res, result.token, true);
            res.status(201).json({ success: true, user: result.user });
        } catch (error) {
            sendGuestError(res, error);
        }
    }
);

/**
 * @desc    Send the WhatsApp code that confirms a guest's order
 * @route   POST /api/auth/guest/confirm/send
 */
router.post(
    '/guest/confirm/send',
    protect('user'),
    rateLimit({ name: 'guest_confirm_send', windowMs: 60 * 60 * 1000, max: 10 }),
    async (req, res) => {
        try {
            const verification = await sendGuestConfirmation({
                user: req.user,
                language: req.body?.language,
            });
            res.json({ success: true, verification });
        } catch (error) {
            sendGuestError(res, error);
        }
    }
);

/**
 * @desc    Confirm the code — which is also what claims the account
 * @route   POST /api/auth/guest/confirm
 */
router.post(
    '/guest/confirm',
    protect('user'),
    rateLimit({ name: 'guest_confirm_verify', windowMs: 10 * 60 * 1000, max: 30 }),
    async (req, res) => {
        try {
            const result = await confirmGuestPhone({ user: req.user, code: req.body?.code });
            res.json({ success: true, ...result });
        } catch (error) {
            sendGuestError(res, error);
        }
    }
);

/**
 * @desc    Optionally set a password, from the order-confirmation screen
 * @route   POST /api/auth/guest/password
 *
 * Refused until the phone is confirmed. Without that gate this route would be a
 * complete account-takeover primitive: type a stranger's number into checkout,
 * take the session, set a password, keep the account.
 */
router.post(
    '/guest/password',
    protect('user'),
    rateLimit({ name: 'guest_set_password', windowMs: 60 * 60 * 1000, max: 10 }),
    async (req, res) => {
        try {
            await setGuestPassword({ user: req.user, password: req.body?.password });
            res.json({ success: true, message: 'Password set. You can now sign in with it.' });
        } catch (error) {
            sendGuestError(res, error);
        }
    }
);

/* ================================================================== */
/* Sign in with a code instead of a password                           */
/* ================================================================== */

/**
 * @desc    Send a sign-in code to an existing account's number
 * @route   POST /api/auth/otp-login/send
 *
 * Reports success whether or not the number resolves. This is reachable from an
 * open checkout page, so a truthful "no such account" would turn it into a
 * phone-number oracle for anyone who opened it.
 */
router.post(
    '/otp-login/send',
    rateLimit({ name: 'otp_login_send', windowMs: 60 * 60 * 1000, max: 10 }),
    async (req, res) => {
        try {
            const verification = await startOtpLogin({
                phone: req.body?.phone,
                language: req.body?.language,
            });
            res.json({ success: true, verification });
        } catch (error) {
            sendGuestError(res, error);
        }
    }
);

/**
 * @desc    Complete a code sign-in
 * @route   POST /api/auth/otp-login/verify
 */
router.post(
    '/otp-login/verify',
    rateLimit({ name: 'otp_login_verify', windowMs: 10 * 60 * 1000, max: 30 }),
    async (req, res) => {
        try {
            const result = await verifyOtpLogin({
                phone: req.body?.phone,
                code: req.body?.code,
                rememberMe: !!req.body?.remember_me,
            });
            setAuthCookie(res, result.token, !!req.body?.remember_me);
            res.json({ success: true, user: result.user });
        } catch (error) {
            sendGuestError(res, error);
        }
    }
);

/**
 * @desc    Logout post
 * @route   POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
    res.cookie('token', '', {
        httpOnly: true,
        expires: new Date(0)
    });
    res.status(200).json({ message: 'Logged out successfully' });
});

module.exports = router;
