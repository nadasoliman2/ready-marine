/**
 * Customer and store sessions: a short access token plus a rotating refresh token.
 *
 *  - `token` cookie: a JWT `{ id, role, sid }` that lives ACCESS_TTL_SECONDS. `protect` reads
 *    it without touching the database; when it has expired, `protect` refreshes the session
 *    itself and lets the request through, so no page (nor a tab still on old code) sees it.
 *  - `refresh_token` cookie: `<session id>.<secret>`, sent to /api only. Each refresh swaps
 *    in a new one and pushes the session's end `duration_ms` further out, so a session in use
 *    never ends and one left idle for its whole length does (models/sessions.js).
 *
 * The services keep signing their own long JWTs (1 day, 7 days for a guest, 30 with "remember
 * me"); `startSession` turns one of those into a session of the same length. The admin's
 * `admin_token` is not part of this.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Session } = require('../models/sessions');

const ACCESS_TTL_SECONDS = 15 * 60;
// Two tabs (or two requests) refreshing with the same refresh token at once: the second one is
// let through on the previous token for this long. After it, the previous token is a copy.
const REUSE_GRACE_MS = 30 * 1000;
const DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000;
const REFRESH_COOKIE_PATH = '/api';
// Where the refresh cookie lived at first. A copy left there would be sent ahead of the newer
// one and look like a stolen token, so it is cleared whenever the cookie is set.
const OLD_REFRESH_COOKIE_PATH = '/api/auth';

const secretFor = (role) => (role === 'vendor' ? process.env.JWT_SECRET_VENDOR : process.env.JWT_SECRET_USER);
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const newSecret = () => crypto.randomBytes(32).toString('base64url');

const sessionError = (message) => Object.assign(new Error(message), { status: 401 });

const cookieOptions = (session, extra = {}) => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    ...(session.persistent ? { expires: session.expires_at } : {}),
    ...extra,
});

const signAccess = (session) => jwt.sign(
    { id: String(session.account_id), role: session.role, sid: String(session._id) },
    secretFor(session.role),
    { expiresIn: ACCESS_TTL_SECONDS }
);

const setAccessCookie = (res, session) => {
    res.cookie('token', signAccess(session), cookieOptions(session));
};

const setRefreshCookie = (res, session, secret) => {
    res.clearCookie('refresh_token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: OLD_REFRESH_COOKIE_PATH });
    res.cookie('refresh_token', `${session._id}.${secret}`, cookieOptions(session, { path: REFRESH_COOKIE_PATH }));
};

const clearSessionCookies = (res) => {
    const base = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' };
    res.clearCookie('token', base);
    res.clearCookie('refresh_token', { ...base, path: REFRESH_COOKIE_PATH });
    res.clearCookie('refresh_token', { ...base, path: OLD_REFRESH_COOKIE_PATH });
};

const clientInfo = (req) => ({
    user_agent: String(req?.headers?.['user-agent'] || '').slice(0, 300),
    ip: String(req?.ip || '').slice(0, 64),
});

/**
 * Sign the browser in: turns a long JWT a service issued ({ id, role }, its own lifetime) into
 * a session of the same length and sets both cookies. `persistent` keeps the cookies after the
 * browser closes ("remember me").
 */
const startSession = async (req, res, longToken, { persistent = false } = {}) => {
    const decoded = jwt.decode(longToken);
    if (!decoded?.id || !['user', 'vendor'].includes(decoded.role)) {
        throw new Error('startSession needs a customer or store token');
    }
    const duration_ms = decoded.exp && decoded.iat ? (decoded.exp - decoded.iat) * 1000 : DEFAULT_DURATION_MS;
    const secret = newSecret();
    const session = await Session.create({
        account_id: decoded.id,
        role: decoded.role,
        token_hash: hash(secret),
        duration_ms,
        expires_at: new Date(Date.now() + duration_ms),
        persistent,
        ...clientInfo(req),
    });
    setAccessCookie(res, session);
    setRefreshCookie(res, session, secret);
    return session;
};

/**
 * A token from before sessions existed (no `sid`) that is still valid: move it onto a session
 * so the browser is not signed out by the switch. It keeps the time it had left.
 */
const upgradeLegacyToken = async (req, res, decoded) => {
    const duration_ms = decoded.exp && decoded.iat ? (decoded.exp - decoded.iat) * 1000 : DEFAULT_DURATION_MS;
    const secret = newSecret();
    const session = await Session.create({
        account_id: decoded.id,
        role: decoded.role,
        token_hash: hash(secret),
        duration_ms,
        expires_at: decoded.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + duration_ms),
        persistent: duration_ms > DEFAULT_DURATION_MS,
        ...clientInfo(req),
    });
    setAccessCookie(res, session);
    setRefreshCookie(res, session, secret);
    return session;
};

const parseRefreshCookie = (raw) => {
    const [id, secret] = String(raw || '').split('.');
    if (!id || !secret || !/^[0-9a-f]{24}$/.test(id)) return null;
    return { id, secret };
};

const loadAccount = (session) => {
    const Model = session.role === 'vendor'
        ? require('../models/sellers').Seller
        : require('../models/users').User;
    return Model.findById(session.account_id).select('password_changed_at').lean();
};

/**
 * POST /api/auth/refresh: a new access token and a new refresh token for the same session.
 * Throws a 401 (and clears the cookies) when the session is over: unknown, revoked, idle past
 * its length, the account gone, the password changed since it started, or an old refresh
 * token presented again after the grace window (then the session is revoked as stolen).
 */
const refreshSession = async (req, res) => {
    const parsed = parseRefreshCookie(req.cookies?.refresh_token);
    const fail = async (message, sessionToRevoke) => {
        if (sessionToRevoke) {
            await Session.updateOne({ _id: sessionToRevoke._id, revoked_at: null }, { revoked_at: new Date() });
        }
        clearSessionCookies(res);
        throw sessionError(message);
    };
    if (!parsed) return fail('Not authorized, session expired');

    const session = await Session.findById(parsed.id);
    if (!session || session.revoked_at || session.expires_at < new Date()) {
        return fail('Not authorized, session expired');
    }

    const account = await loadAccount(session);
    if (!account) return fail('Not authorized, user not found', session);
    if (account.password_changed_at && account.password_changed_at > session.created_at) {
        return fail('Not authorized, password was changed', session);
    }

    const presented = hash(parsed.secret);
    if (presented !== session.token_hash) {
        const inGrace = presented === session.previous_hash
            && session.rotated_at && Date.now() - session.rotated_at.getTime() < REUSE_GRACE_MS;
        if (!inGrace) return fail('Not authorized, session expired', presented === session.previous_hash ? session : null);
        // The request that rotated first already sent the new refresh cookie.
        setAccessCookie(res, session);
        return session;
    }

    const secret = newSecret();
    const now = new Date();
    const rotated = await Session.findOneAndUpdate(
        { _id: session._id, token_hash: presented, revoked_at: null },
        {
            previous_hash: presented,
            token_hash: hash(secret),
            rotated_at: now,
            last_used_at: now,
            expires_at: new Date(now.getTime() + session.duration_ms),
            ...clientInfo(req),
        },
        { returnDocument: 'after' }
    );
    if (!rotated) {
        // Another request rotated it between the read and this write: same as the grace case.
        setAccessCookie(res, session);
        return session;
    }
    setAccessCookie(res, rotated);
    setRefreshCookie(res, rotated, secret);
    return rotated;
};

/** Sign out this browser: revoke its session and clear both cookies. */
const endSession = async (req, res) => {
    const parsed = parseRefreshCookie(req.cookies?.refresh_token);
    if (parsed) {
        await Session.updateOne(
            { _id: parsed.id, revoked_at: null, $or: [{ token_hash: hash(parsed.secret) }, { previous_hash: hash(parsed.secret) }] },
            { revoked_at: new Date() }
        ).catch(() => {});
    }
    clearSessionCookies(res);
};

module.exports = {
    ACCESS_TTL_SECONDS,
    REUSE_GRACE_MS,
    startSession,
    upgradeLegacyToken,
    refreshSession,
    endSession,
    clearSessionCookies,
};
