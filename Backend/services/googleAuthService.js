/**
 * Google Sign-In — verifying the ID token issued to the browser by Google
 * Identity Services.
 *
 * Only the OAuth **client ID** is involved. The browser does the interactive
 * part and hands us a signed JWT (the "credential"); proving it is genuine only
 * needs Google's public signing keys, so there is no client secret, no
 * redirect URI, and no server-side code exchange anywhere in this flow.
 *
 * What the verification establishes:
 *   - signature made by one of Google's current RS256 keys (fetched from JWKS)
 *   - issued by Google (`iss`) FOR THIS APP (`aud` === our client ID) — the
 *     audience check is what stops a token minted for some other site from
 *     being replayed here
 *   - not expired (`exp`, with a small clock tolerance)
 *   - the email is one Google itself has verified
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

// Google rotates its signing keys, so the JWKS is cached only for as long as
// the response says it is fresh (falling back to an hour).
const DEFAULT_CERTS_TTL_MS = 60 * 60 * 1000;
let certsCache = { keys: null, expiresAt: 0 };

const googleError = (code, message, status = 401) => {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
};

const getGoogleClientId = () => {
    const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
    if (!clientId) {
        throw googleError(
            'GOOGLE_NOT_CONFIGURED',
            'Google sign-in is not configured on this server.',
            503
        );
    }
    return clientId;
};

const isGoogleConfigured = () => Boolean((process.env.GOOGLE_CLIENT_ID || '').trim());

const parseMaxAgeMs = (cacheControl) => {
    const match = /max-age=(\d+)/i.exec(cacheControl || '');
    if (!match) return DEFAULT_CERTS_TTL_MS;
    return Math.max(60, Number(match[1])) * 1000;
};

/**
 * Google's public signing keys, keyed by `kid`, cached until they go stale.
 */
const getGoogleSigningKeys = async () => {
    if (certsCache.keys && certsCache.expiresAt > Date.now()) {
        return certsCache.keys;
    }

    let response;
    try {
        response = await fetch(GOOGLE_CERTS_URL, {
            signal: AbortSignal.timeout(10000),
        });
    } catch (error) {
        throw googleError('GOOGLE_UNREACHABLE', `Could not reach Google to verify the sign-in: ${error.message}`, 502);
    }

    if (!response.ok) {
        throw googleError('GOOGLE_UNREACHABLE', `Google returned ${response.status} while fetching signing keys.`, 502);
    }

    const body = await response.json();
    const keys = new Map();
    for (const jwk of body.keys || []) {
        if (!jwk.kid) continue;
        try {
            keys.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
        } catch (_) {
            // A key we cannot parse is simply unusable; the others still verify.
        }
    }

    if (keys.size === 0) {
        throw googleError('GOOGLE_UNREACHABLE', 'Google returned no usable signing keys.', 502);
    }

    certsCache = {
        keys,
        expiresAt: Date.now() + parseMaxAgeMs(response.headers.get('cache-control')),
    };
    return keys;
};

/**
 * Verify a Google Identity Services credential and return the profile it
 * asserts. Throws with a `code`/`status` for anything that fails to check out.
 *
 * @param   {string} credential The ID token from `google.accounts.id`.
 * @returns {Promise<{sub: string, email: string, name: string, picture: string|null}>}
 */
const verifyGoogleIdToken = async (credential) => {
    const clientId = getGoogleClientId();

    if (!credential || typeof credential !== 'string') {
        throw googleError('GOOGLE_TOKEN_MISSING', 'Google sign-in token is missing.', 400);
    }

    const decoded = jwt.decode(credential, { complete: true });
    const kid = decoded?.header?.kid;
    if (!kid) {
        throw googleError('GOOGLE_TOKEN_INVALID', 'Google sign-in token is malformed.');
    }

    let keys = await getGoogleSigningKeys();
    let publicKey = keys.get(kid);

    // An unknown `kid` usually means Google rotated keys since we last cached;
    // one forced refresh separates that from a genuinely forged token.
    if (!publicKey) {
        certsCache = { keys: null, expiresAt: 0 };
        keys = await getGoogleSigningKeys();
        publicKey = keys.get(kid);
    }

    if (!publicKey) {
        throw googleError('GOOGLE_TOKEN_INVALID', 'Google sign-in token was not signed by a known Google key.');
    }

    let payload;
    try {
        payload = jwt.verify(credential, publicKey, {
            algorithms: ['RS256'],
            audience: clientId,
            issuer: GOOGLE_ISSUERS,
            clockTolerance: 60,
        });
    } catch (error) {
        const expired = error.name === 'TokenExpiredError';
        throw googleError(
            expired ? 'GOOGLE_TOKEN_EXPIRED' : 'GOOGLE_TOKEN_INVALID',
            expired
                ? 'This Google sign-in expired. Please try again.'
                : 'Google sign-in could not be verified. Please try again.'
        );
    }

    if (!payload.email) {
        throw googleError('GOOGLE_EMAIL_MISSING', 'Your Google account did not share an email address.', 400);
    }

    // `email_verified` false means Google itself does not vouch for the
    // address — treating it as proof of ownership would let it be used to
    // reach an existing account with the same email.
    if (payload.email_verified === false || payload.email_verified === 'false') {
        throw googleError('GOOGLE_EMAIL_UNVERIFIED', 'This Google account has an unverified email address.', 400);
    }

    return {
        sub: String(payload.sub),
        email: payload.email,
        name: (payload.name || payload.given_name || payload.email.split('@')[0] || '').trim(),
        picture: payload.picture || null,
    };
};

module.exports = {
    verifyGoogleIdToken,
    isGoogleConfigured,
};
