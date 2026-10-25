/**
 * The one Redis connection this process shares, and a lock built on it.
 *
 * Redis holds state that is only ever an approximation — which customers have a socket
 * open right now — so nothing here may stall the app when it is away. The client keeps
 * no offline queue: a command issued while Redis is down fails at once instead of waiting
 * for a reconnect, and every caller decides for itself what "unknown" means. ioredis keeps
 * reconnecting in the background, and `onReady` lets a caller rebuild what Redis lost.
 *
 * REDIS_URL unset means "not configured": `getRedis()` returns null and callers treat it
 * exactly like an outage.
 */
const crypto = require('crypto');
const Redis = require('ioredis');

let client = null;
let lastErrorLogged = null;

const isRedisConfigured = () => Boolean(process.env.REDIS_URL);

const getRedis = () => {
    if (!isRedisConfigured()) return null;
    if (client) return client;

    client = new Redis(process.env.REDIS_URL, {
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 5000,
        // A Redis that hangs instead of refusing must not hang the caller either.
        commandTimeout: 2000,
        retryStrategy: (times) => Math.min(times * 500, 5000),
    });
    // ioredis repeats the same error on every reconnect attempt; say it once per outage.
    client.on('error', (err) => {
        if (lastErrorLogged === err.message) return;
        lastErrorLogged = err.message;
        console.error(`[Redis] ${err.message}`);
    });
    client.on('ready', () => {
        if (lastErrorLogged) console.log('[Redis] Connected again.');
        lastErrorLogged = null;
    });
    return client;
};

/** Run `fn` every time the connection becomes usable, including the first time. */
const onReady = (fn) => {
    const redis = getRedis();
    if (!redis) return;
    redis.on('ready', fn);
    if (redis.status === 'ready') fn();
};

/** The client, if it can take a command right now; throws otherwise. */
const requireRedis = () => {
    const redis = getRedis();
    if (!redis) throw new Error('Redis is not configured (REDIS_URL)');
    if (redis.status !== 'ready') throw new Error(`Redis is not available (${redis.status})`);
    return redis;
};

// Deletes the key only while it still holds this holder's token, so a holder whose lock
// already expired cannot release the next holder's.
const RELEASE_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/**
 * Take `key` for `ttlMs`, across every instance sharing this Redis. Returns a release
 * function, or null when someone else holds it. Throws when Redis cannot be asked.
 *
 * The TTL is a ceiling, not a promise: a holder that outlives it loses the lock silently.
 * Use it to avoid duplicated work, never as the only guard against duplicated effects.
 */
const acquireLock = async (key, ttlMs) => {
    const redis = requireRedis();
    const token = crypto.randomUUID();
    const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
    if (ok !== 'OK') return null;
    return async () => {
        try { await redis.eval(RELEASE_SCRIPT, 1, key, token); }
        catch (err) { console.error(`[Redis] Could not release ${key}: ${err.message}`); }
    };
};

/** Tests only: close the shared connection so the process can exit. */
const closeRedis = async () => {
    if (!client) return;
    const c = client;
    client = null;
    await c.quit().catch(() => c.disconnect());
};

module.exports = { isRedisConfigured, getRedis, onReady, requireRedis, acquireLock, closeRedis };
