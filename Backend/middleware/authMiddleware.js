const jwt = require('jsonwebtoken');
const { User } = require('../models/users');
const { Seller } = require('../models/sellers');
const adminAccess = require('../services/adminAccessService');

const isTokenStaleAfterPasswordChange = (account, decoded) => {
    if (!account?.password_changed_at || !decoded?.iat) return false;
    return Math.floor(account.password_changed_at.getTime() / 1000) > decoded.iat;
};

/**
 * A guest-checkout account whose owner has not proved the phone number yet.
 *
 * Such an account is addressed by phone alone, so a session on it proves only
 * that someone typed a number into a shipping form. It may therefore hold data
 * — orders, addresses, points — but must disclose none of it until the number
 * is confirmed. The flag is computed here, on every authenticated request, so
 * the disclosure guards downstream cannot be reached by a route that forgot to
 * ask; see `guestDisclosureBlocked` in guestCheckoutService for the rule itself.
 */
const markGuestDisclosure = (req) => {
    req.isUnclaimedGuest = req.userRole === 'user'
        && req.user?.account_status === 'guest'
        && !req.user?.phone_verified_at;
};

/**
 * Refuse a route outright to an unconfirmed guest.
 *
 * Mount AFTER `protect`. Used for routes whose entire purpose is to hand back
 * accumulated account data; routes that merely include some are expected to
 * redact around `req.isUnclaimedGuest` instead of 403ing, so that checkout —
 * which legitimately runs on a guest session — keeps working.
 */
const denyUnclaimedGuest = (req, res, next) => {
    if (req.isUnclaimedGuest) {
        return res.status(403).json({
            code: 'GUEST_NOT_CONFIRMED',
            message: 'Confirm the code we sent to your WhatsApp to access your account.',
        });
    }
    return next();
};

/**
 * Turn a verified admin token into the acting admin, and decide whether they may make THIS
 * request.
 *
 * Every admin route in the app goes through `protect('admin')` — the only two that do not
 * are `/login` and `/logout`, which must be public — so this function is the single place
 * dashboard permissions are enforced. A new admin route is covered the moment it is written,
 * because it cannot work without `protect` in the first place. See
 * `services/adminAccessService.js` for the module table and the fail-closed rule.
 *
 * @returns {{ ok: true, admin: object } | { ok: false, status: number, body: object }}
 */
const resolveAdmin = async (decoded, req) => {
    let admin;

    if (decoded.sa === true) {
        // The super admin is the environment credential pair, never a database row. The
        // username is re-checked against the environment rather than trusted from the token:
        // rotating ADMIN_USERNAME must retire tokens minted for the old one, and a token
        // that outlives its account is exactly the hole this whole file exists to avoid.
        if (!process.env.ADMIN_USERNAME || decoded.username !== process.env.ADMIN_USERNAME) {
            return { ok: false, status: 401, body: { message: 'Not authorized, admin credentials changed' } };
        }
        admin = {
            username: decoded.username,
            role: 'admin',
            is_super: true,
            permissions: [],
        };
    } else {
        // Read fresh on every request. A revoked permission or a deactivated account has to
        // take effect now, not when a 7-day token happens to expire.
        const doc = await adminAccess.loadActiveAdmin(decoded.aid);
        if (!doc) {
            return { ok: false, status: 401, body: { message: 'Not authorized, this admin account is no longer active' } };
        }
        if (isTokenStaleAfterPasswordChange(doc, decoded)) {
            return { ok: false, status: 401, body: { message: 'Not authorized, password was changed' } };
        }
        admin = {
            _id: doc._id,
            username: doc.username,
            name: doc.name || '',
            role: 'admin',
            is_super: false,
            permissions: doc.permissions || [],
        };
    }

    const verdict = adminAccess.checkAccess(admin, req.method, req.originalUrl || req.url);
    if (!verdict.allowed) {
        return {
            ok: false,
            status: 403,
            body: { message: verdict.message, code: verdict.code, module: verdict.module || null },
        };
    }

    return { ok: true, admin };
};

/**
 * Middleware to protect routes and verify the JWT from cookies.
 * role: single string ('admin'|'vendor'|'user') OR array ['vendor', 'user'] for multi-role routes.
 */
const protect = (...args) => {
    // Normalize: support protect('vendor', 'user') → protect(['vendor', 'user'])
    const roles = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;

    return async (req, res, next) => {
        let token;
        const primaryRole = roles[0];

        // Check for token in cookies
        if (roles.includes('admin') && req.cookies && req.cookies.admin_token) {
            token = req.cookies.admin_token;
        } else if (req.cookies && req.cookies.token) {
            token = req.cookies.token;
        }

        if (!token) {
            return res.status(401).json({ message: 'Not authorized, no token provided' });
        }

        try {
            // Determine secret based on actual role encoded in token
            let secret;
            if (req.cookies.admin_token) {
                secret = process.env.JWT_SECRET_ADMIN;
            } else {
                // Heuristic: try to decode without verification to guess role
                // We'll decode fully per-role below
                secret = process.env.JWT_SECRET_USER;
            }

            // Verify token
            const decoded = jwt.verify(token, secret);

            // Attach user/seller/admin to request
            if (decoded.role === 'admin' && roles.includes('admin')) {
                const resolved = await resolveAdmin(decoded, req);
                if (!resolved.ok) return res.status(resolved.status).json(resolved.body);
                req.user = resolved.admin;
                req.userRole = 'admin';
                // `protect` normally falls through to the shared checks below, but those read
                // `password_changed_at` off a Mongoose document the super admin does not have.
                // The admin branch has already done its own staleness check inside
                // `resolveAdmin`, so it returns here rather than being re-examined.
                markGuestDisclosure(req);
                return next();
            } else if (decoded.role === 'vendor' && roles.includes('vendor')) {
                req.user = await Seller.findById(decoded.id).select('-password');
                req.userRole = 'vendor';
            } else if (decoded.role === 'user' && roles.includes('user')) {
                req.user = await User.findById(decoded.id).select('-password');
                req.userRole = 'user';
            } else {
                return res.status(403).json({ message: 'Not authorized for this role' });
            }

            if (!req.user) {
                return res.status(401).json({ message: 'Not authorized, user not found' });
            }

            if (isTokenStaleAfterPasswordChange(req.user, decoded)) {
                return res.status(401).json({ message: 'Not authorized, password was changed' });
            }

            markGuestDisclosure(req);
            next();
        } catch (error) {
            // Token verification failed — try other secrets based on allowed roles
            if (roles.length >= 1) {
                for (const r of roles) {
                    try {
                        let secret;
                        if (r === 'admin') secret = process.env.JWT_SECRET_ADMIN;
                        else if (r === 'vendor') secret = process.env.JWT_SECRET_VENDOR;
                        else secret = process.env.JWT_SECRET_USER;

                        const decoded = jwt.verify(token, secret);

                        if (decoded.role === r) {
                            if (r === 'admin') {
                                const resolved = await resolveAdmin(decoded, req);
                                if (!resolved.ok) return res.status(resolved.status).json(resolved.body);
                                req.user = resolved.admin;
                                req.userRole = 'admin';
                                markGuestDisclosure(req);
                                return next();
                            } else if (r === 'vendor') {
                                req.user = await Seller.findById(decoded.id).select('-password');
                                req.userRole = 'vendor';
                            } else {
                                req.user = await User.findById(decoded.id).select('-password');
                                req.userRole = 'user';
                            }
                            if (!req.user) return res.status(401).json({ message: 'Not authorized, user not found' });
                            if (isTokenStaleAfterPasswordChange(req.user, decoded)) {
                                return res.status(401).json({ message: 'Not authorized, password was changed' });
                            }
                            markGuestDisclosure(req);
                            return next();
                        }
                    } catch (_) { /* try next role */ }
                }
            }
            res.status(401).json({ message: 'Not authorized, token failed' });
        }
    };
};

/**
 * Attach `req.user` when a valid CUSTOMER session cookie is present, but never
 * reject. Used by the family-invitation landing page, which must render for
 * signed-out visitors, signed-in customers, and signed-in staff alike.
 *
 * A vendor/admin session is deliberately left unattached: those accounts cannot
 * participate in families and must be prompted to switch to a customer account.
 */
const optionalUser = async (req, res, next) => {
    req.user = null;
    req.userRole = null;

    const token = req.cookies?.token;
    if (!token) return next();

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET_USER);
        if (decoded.role !== 'user') return next();

        const user = await User.findById(decoded.id).select('-password');
        if (!user) return next();
        if (isTokenStaleAfterPasswordChange(user, decoded)) return next();

        req.user = user;
        req.userRole = 'user';
        markGuestDisclosure(req);
    } catch (_) {
        // Not a customer session (vendor/admin/expired) — continue anonymously.
    }

    return next();
};

module.exports = { protect, optionalUser, denyUnclaimedGuest, isTokenStaleAfterPasswordChange };
