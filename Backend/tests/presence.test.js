// Socket.IO online status in Redis (services/presenceService.js, services/socket.js).
// Needs a throwaway Redis and MongoDB: see tests/support/testServers.js.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { startMongo, startRedis, redisReady } = require('./support/testServers');

let mongo, redisServer, redisClient, presenceService, User;

before(async () => {
    [mongo, redisServer] = await Promise.all([startMongo('presence_tests'), startRedis(1)]);
    process.env.REDIS_URL = redisServer.url;
    process.env.JWT_SECRET_USER = 'test-user-secret';
    process.env.JWT_SECRET_VENDOR = 'test-vendor-secret';
    redisClient = require('../services/redisClient');
    presenceService = require('../services/presenceService');
    ({ User } = require('../models/users'));
    await redisReady(redisClient.getRedis());
    await mongoose.connect(mongo.uri);
});

after(async () => {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
    await redisClient.closeRedis();
    await Promise.all([mongo.stop(), redisServer.stop()]);
});

beforeEach(async () => {
    await redisClient.getRedis().flushdb();
});

/** A presence tracker whose Redis can be switched off, as an outage looks to the code. */
const flakyRedis = () => {
    const state = { down: false };
    return {
        state,
        isRedisConfigured: () => true,
        onReady: () => {},
        requireRedis: () => {
            if (state.down) throw new Error('Redis is not available (reconnecting)');
            return redisClient.requireRedis();
        },
    };
};

const tracker = (opts = {}) => presenceService.createPresenceTracker({ heartbeatMs: 60_000, ...opts });

test('a user is connected while a socket is open and disconnected after it closes', async () => {
    const instance = tracker();
    await instance.track('sock-1', 'u1');
    assert.equal(await instance.isUserConnected('u1'), true);
    assert.deepEqual(await redisClient.getRedis().smembers('user:sockets:u1'), [`${instance.instanceId}#sock-1`]);

    await instance.untrack('sock-1');
    assert.equal(await instance.isUserConnected('u1'), false);
    assert.equal(await redisClient.getRedis().scard('user:sockets:u1'), 0);
});

test('closing one of several tabs or devices leaves the user connected', async () => {
    const a = tracker();
    const b = tracker(); // a second backend instance holding the phone's socket
    await a.track('tab-1', 'u2');
    await a.track('tab-2', 'u2');
    await b.track('phone', 'u2');

    await a.untrack('tab-1');
    assert.equal(await a.isUserConnected('u2'), true);
    await b.untrack('phone');
    assert.equal(await b.isUserConnected('u2'), true, 'tab-2 is still open on instance a');
    await a.untrack('tab-2');
    assert.equal(await a.isUserConnected('u2'), false);
    assert.equal(await b.isUserConnected('u2'), false);
});

test('another instance sees the socket; a crashed instance stops counting once its heartbeat expires', async () => {
    const a = tracker();
    const crashed = tracker();
    await crashed.track('sock-x', 'u3');
    assert.equal(await a.isUserConnected('u3'), true);

    // The process died without cleaning up: only its liveness key expires.
    await redisClient.getRedis().del(`presence:instance:${crashed.instanceId}`);
    assert.equal(await a.isUserConnected('u3'), false);
    assert.equal(await redisClient.getRedis().scard('user:sockets:u3'), 0, 'the stale member is removed when read');
});

test('a member this instance no longer holds (restart, missed disconnect) is stale', async () => {
    const a = tracker();
    await redisClient.getRedis().sadd('user:sockets:u4', `${a.instanceId}#ghost`);
    assert.equal(await a.isUserConnected('u4'), false);
    assert.equal(await redisClient.getRedis().scard('user:sockets:u4'), 0);
});

test('a disconnect missed during a Redis outage is repaired by the next reconcile', async () => {
    const flaky = flakyRedis();
    const a = tracker({ redis: flaky });
    const other = tracker();
    await a.track('sock-1', 'u5');
    assert.equal(await other.isUserConnected('u5'), true);

    flaky.state.down = true;
    await a.untrack('sock-1'); // logged, not written
    flaky.state.down = false;
    assert.equal(await other.isUserConnected('u5'), true, 'still listed until a reconciles');

    await a.reconcile();
    assert.equal(await other.isUserConnected('u5'), false);
});

test('a connect during an outage, or a Redis restart, is rebuilt by reconcile', async () => {
    const flaky = flakyRedis();
    const a = tracker({ redis: flaky });
    flaky.state.down = true;
    await a.track('sock-1', 'u6');
    flaky.state.down = false;
    const other = tracker();
    assert.equal(await other.isUserConnected('u6'), false);
    await a.reconcile();
    assert.equal(await other.isUserConnected('u6'), true);

    await redisClient.getRedis().flushdb(); // Redis restarted empty
    assert.equal(await other.isUserConnected('u6'), false);
    await a.reconcile();
    assert.equal(await other.isUserConnected('u6'), true);
});

test('when Redis is unavailable the status is an error, never "disconnected"', async () => {
    const flaky = flakyRedis();
    const a = tracker({ redis: flaky });
    flaky.state.down = true;
    await assert.rejects(a.isUserConnected('u7'), /not available/);
    await assert.rejects(a.ping(), /not available/);
});

/* ------------------ Through Socket.IO itself ------------------ */

const loadClient = () => {
    try { return require(path.join(__dirname, '../../frontend/node_modules/socket.io-client')); }
    catch (_) { return null; }
};
const ioClient = loadClient();

test('real sockets: authenticated by the token cookie, tracked per connection', { skip: !ioClient && 'socket.io-client not installed (frontend/node_modules)' }, async () => {
    const { initSocket } = require('../services/socket');
    const server = http.createServer();
    const io = initSocket(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;

    const user = await User.create({ name: 'Socket Customer', phone: '+201000000001', email: 'socket@example.com' });
    const token = jwt.sign({ id: String(user._id), role: 'user' }, process.env.JWT_SECRET_USER);
    const open = (cookie) => new Promise((resolve, reject) => {
        const s = ioClient(url, { transports: ['websocket'], extraHeaders: { cookie }, reconnection: false, forceNew: true });
        s.once('connect', () => resolve(s));
        s.once('connect_error', (err) => { s.close(); reject(err); });
    });
    const settle = () => new Promise((r) => setTimeout(r, 150));
    const connected = () => presenceService.isUserConnected(String(user._id));

    try {
        const first = await open(`token=${token}`);
        const second = await open(`token=${token}`);
        await settle();
        assert.equal(await connected(), true);
        assert.equal(await redisClient.getRedis().scard(`user:sockets:${user._id}`), 2);

        first.close();
        await settle();
        assert.equal(await connected(), true, 'the second tab is still open');
        second.close();
        await settle();
        assert.equal(await connected(), false);

        // The user id comes from the verified token only; a forged one is refused.
        const forged = jwt.sign({ id: String(user._id), role: 'user' }, 'wrong-secret');
        await assert.rejects(open(`token=${forged}`), /Not authorized/);

        // A token issued before the last password change no longer counts.
        await User.updateOne({ _id: user._id }, { $set: { password_changed_at: new Date(Date.now() + 5000) } });
        await assert.rejects(open(`token=${token}`), /Not authorized/);
        assert.equal(await connected(), false);
    } finally {
        io.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
