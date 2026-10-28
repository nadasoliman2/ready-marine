// Refresh sessions (services/sessionService.js) and how `protect` treats their access tokens.
// Needs a throwaway MongoDB: see tests/support/testServers.js.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { startMongo } = require('./support/testServers');

process.env.JWT_SECRET_USER = 'test-user-secret';
process.env.JWT_SECRET_VENDOR = 'test-vendor-secret';
process.env.JWT_SECRET_ADMIN = 'test-admin-secret';

let mongo, User, Session, sessions, protect;

// The part of an Express response these functions touch: cookies set or cleared, and the answer.
const fakeRes = () => ({
    cookies: {},
    cleared: [],
    statusCode: 200,
    body: null,
    cookie(name, value, options) { this.cookies[name] = { value, options }; return this; },
    clearCookie(name) { this.cleared.push(name); return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
});
const fakeReq = (cookies = {}) => ({ cookies, headers: { 'user-agent': 'test' }, ip: '127.0.0.1' });

const runProtect = (cookies, ...roles) => new Promise((resolve) => {
    const req = fakeReq(cookies);
    const res = fakeRes();
    res.json = function json(body) { this.body = body; resolve({ passed: false, req, res: this }); return this; };
    protect(...roles)(req, res, () => resolve({ passed: true, req, res }));
});

const longToken = (user, expiresIn = '1d') => jwt.sign({ id: user._id, role: 'user' }, process.env.JWT_SECRET_USER, { expiresIn });

const signIn = async (user, options) => {
    const res = fakeRes();
    await sessions.startSession(fakeReq(), res, longToken(user), options);
    return { token: res.cookies.token.value, refresh: res.cookies.refresh_token.value, res };
};

before(async () => {
    mongo = await startMongo('sessions_tests');
    await mongoose.connect(mongo.uri);
    ({ User } = require('../models/users'));
    ({ Session } = require('../models/sessions'));
    sessions = require('../services/sessionService');
    ({ protect } = require('../middleware/authMiddleware'));
});

after(async () => {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
    await mongo.stop();
});

beforeEach(async () => {
    await mongoose.connection.dropDatabase();
});

test('signing in sets a short access token and a refresh token kept to /api', async () => {
    const user = await User.create({ name: 'C', phone: '01000000201' });
    const { token, refresh, res } = await signIn(user, { persistent: true });

    const access = jwt.verify(token, process.env.JWT_SECRET_USER);
    assert.equal(access.exp - access.iat, sessions.ACCESS_TTL_SECONDS);
    assert.ok(access.sid);
    assert.equal(res.cookies.refresh_token.options.path, '/api');
    assert.ok(res.cookies.refresh_token.options.expires, 'remember me keeps the cookie after the browser closes');

    const stored = await Session.findById(access.sid).lean();
    assert.equal(stored.duration_ms, 24 * 60 * 60 * 1000);
    assert.ok(!stored.token_hash.includes(refresh.split('.')[1]), 'only the hash is stored');

    const { passed, req } = await runProtect({ token }, 'user');
    assert.ok(passed);
    assert.equal(String(req.user._id), String(user._id));
});

test('without remember me the cookies end with the browser', async () => {
    const user = await User.create({ name: 'C', phone: '01000000202' });
    const { res } = await signIn(user, { persistent: false });
    assert.equal(res.cookies.token.options.expires, undefined);
    assert.equal(res.cookies.refresh_token.options.expires, undefined);
});

const expiredAccess = (user, sid) => jwt.sign(
    { id: user._id, role: 'user', sid, iat: Math.floor(Date.now() / 1000) - 3600, exp: Math.floor(Date.now() / 1000) - 10 },
    process.env.JWT_SECRET_USER
);

test('an expired access token with a live refresh cookie is refreshed on the spot', async () => {
    const user = await User.create({ name: 'C', phone: '01000000203' });
    const { token, refresh } = await signIn(user);
    const sid = jwt.decode(token).sid;

    const { passed, req, res } = await runProtect({ token: expiredAccess(user, sid), refresh_token: refresh }, 'user');
    assert.ok(passed, 'the request goes through');
    assert.equal(String(req.user._id), String(user._id));
    assert.equal(jwt.verify(res.cookies.token.value, process.env.JWT_SECRET_USER).sid, sid);
    assert.notEqual(res.cookies.refresh_token.value, refresh, 'and the refresh token rotated');
});

test('a dropped access cookie is refreshed on the spot too', async () => {
    const user = await User.create({ name: 'C', phone: '01000000211' });
    const { refresh } = await signIn(user);
    const { passed } = await runProtect({ refresh_token: refresh }, 'user');
    assert.ok(passed);
});

test('an expired access token whose session is over answers 401 and clears the cookies', async () => {
    const user = await User.create({ name: 'C', phone: '01000000212' });
    const { token, refresh } = await signIn(user);
    await Session.updateOne({ _id: jwt.decode(token).sid }, { revoked_at: new Date() });

    const { passed, res } = await runProtect({ token: expiredAccess(user, jwt.decode(token).sid), refresh_token: refresh }, 'user');
    assert.equal(passed, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.message, 'Not authorized, session expired');
    assert.ok(res.cleared.includes('refresh_token'));
});

test('without a refresh cookie an expired access token answers ACCESS_EXPIRED', async () => {
    const user = await User.create({ name: 'C', phone: '01000000213' });
    const { token } = await signIn(user);
    const { passed, res } = await runProtect({ token: expiredAccess(user, jwt.decode(token).sid) }, 'user');
    assert.equal(passed, false);
    assert.equal(res.body.code, 'ACCESS_EXPIRED');
});

test('refresh swaps both tokens and pushes the end of the session out', async () => {
    const user = await User.create({ name: 'C', phone: '01000000204' });
    const { refresh } = await signIn(user);
    const sid = refresh.split('.')[0];
    await Session.updateOne({ _id: sid }, { expires_at: new Date(Date.now() + 60 * 1000) });

    const res = fakeRes();
    await sessions.refreshSession(fakeReq({ refresh_token: refresh }), res);
    assert.notEqual(res.cookies.refresh_token.value, refresh);
    assert.equal(jwt.verify(res.cookies.token.value, process.env.JWT_SECRET_USER).sid, sid);

    const stored = await Session.findById(sid).lean();
    assert.ok(stored.expires_at.getTime() > Date.now() + 23 * 60 * 60 * 1000, 'a session in use does not end');
});

test('two refreshes at once both get through; an old refresh token later ends the session', async () => {
    const user = await User.create({ name: 'C', phone: '01000000205' });
    const { refresh } = await signIn(user);
    const sid = refresh.split('.')[0];

    const first = fakeRes();
    await sessions.refreshSession(fakeReq({ refresh_token: refresh }), first);
    const second = fakeRes();
    await sessions.refreshSession(fakeReq({ refresh_token: refresh }), second);
    assert.ok(second.cookies.token, 'the second tab is let through on the previous token');
    assert.equal(second.cookies.refresh_token, undefined);

    // Past the grace window, the previous token can only be a copy.
    await Session.updateOne({ _id: sid }, { rotated_at: new Date(Date.now() - sessions.REUSE_GRACE_MS - 1000) });
    const stolen = fakeRes();
    await assert.rejects(sessions.refreshSession(fakeReq({ refresh_token: refresh }), stolen), { status: 401 });
    assert.ok(stolen.cleared.includes('refresh_token'));
    assert.ok((await Session.findById(sid).lean()).revoked_at, 'the whole session is revoked');

    // The real owner's newer token is dead too.
    const owner = fakeRes();
    await assert.rejects(sessions.refreshSession(fakeReq({ refresh_token: first.cookies.refresh_token.value }), owner), { status: 401 });
});

test('a password change ends sessions started before it', async () => {
    const user = await User.create({ name: 'C', phone: '01000000206' });
    const { refresh } = await signIn(user);
    await User.updateOne({ _id: user._id }, { password_changed_at: new Date(Date.now() + 1000) });

    await assert.rejects(sessions.refreshSession(fakeReq({ refresh_token: refresh }), fakeRes()), {
        status: 401,
        message: 'Not authorized, password was changed',
    });
});

test('an idle session past its length cannot be refreshed', async () => {
    const user = await User.create({ name: 'C', phone: '01000000207' });
    const { refresh } = await signIn(user);
    await Session.updateOne({ _id: refresh.split('.')[0] }, { expires_at: new Date(Date.now() - 1000) });
    await assert.rejects(sessions.refreshSession(fakeReq({ refresh_token: refresh }), fakeRes()), { status: 401 });
});

test('signing out revokes the session', async () => {
    const user = await User.create({ name: 'C', phone: '01000000208' });
    const { refresh } = await signIn(user);
    const res = fakeRes();
    await sessions.endSession(fakeReq({ refresh_token: refresh }), res);
    assert.ok(res.cleared.includes('refresh_token') && res.cleared.includes('token'));
    await assert.rejects(sessions.refreshSession(fakeReq({ refresh_token: refresh }), fakeRes()), { status: 401 });
});

test('a token from before sessions is moved onto one without signing out', async () => {
    const user = await User.create({ name: 'C', phone: '01000000209' });
    const legacy = longToken(user, '30d');

    const { passed, res } = await runProtect({ token: legacy }, 'user');
    assert.ok(passed);
    const access = jwt.verify(res.cookies.token.value, process.env.JWT_SECRET_USER);
    assert.ok(access.sid);
    const stored = await Session.findById(access.sid).lean();
    assert.equal(stored.persistent, true);
    assert.ok(res.cookies.refresh_token);
});

test('a dead token is dropped; a live one of another role is a 403 that keeps it', async () => {
    const user = await User.create({ name: 'C', phone: '01000000210' });
    const foreign = jwt.sign({ id: user._id, role: 'user' }, 'another-app-secret', { expiresIn: '1d' });
    const dead = await runProtect({ token: foreign }, 'user');
    assert.equal(dead.res.statusCode, 401);
    assert.ok(dead.res.cleared.includes('token'));

    const vendorToken = jwt.sign({ id: new mongoose.Types.ObjectId(), role: 'vendor', sid: 'x' }, process.env.JWT_SECRET_VENDOR, { expiresIn: 600 });
    const wrongRole = await runProtect({ token: vendorToken }, 'user');
    assert.equal(wrongRole.res.statusCode, 403);
    assert.deepEqual(wrongRole.res.cleared, []);
});
