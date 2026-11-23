/**
 * Which customers have a Socket.IO connection open right now, across every backend instance.
 *
 * `user:sockets:{userId}` is a Redis set with one member per open socket, so several tabs and
 * devices each count, and closing one leaves the others. A member is `{instanceId}#{socketId}`:
 * the instance that holds the socket is part of the name, because a socket id alone cannot
 * say whether the process that owned it is still alive.
 *
 * Stale members — left by a crash, a restart, or a disconnect Redis missed while it was down —
 * are recognised rather than trusted:
 *   - every instance keeps `presence:instance:{id}` alive with a short TTL; a member whose
 *     instance key has expired belongs to a dead process and is dropped when next read;
 *   - every instance also lists its own members in `presence:instance:{id}:sockets` and, on a
 *     heartbeat and whenever Redis reconnects, makes Redis match the sockets it really holds;
 *   - a member of THIS instance is checked against the sockets in memory.
 *
 * What "connected" means is deliberately narrow: some page of the site is open with the
 * customer signed in. It is not proof of shopping, and its absence is not proof of leaving —
 * see abandonedCartService, which keeps cart inactivity as its own, independent condition.
 *
 * Only customer sockets (role 'user') are tracked: they are the accounts that own carts.
 */
const crypto = require('crypto');
const redisClient = require('./redisClient');

const userKey = (userId) => `user:sockets:${userId}`;
const instanceKey = (instanceId) => `presence:instance:${instanceId}`;
const instancesKey = (instanceId) => `presence:instance:${instanceId}:sockets`;

const splitOnce = (value, sep) => {
    const i = value.indexOf(sep);
    return i === -1 ? [value, ''] : [value.slice(0, i), value.slice(i + 1)];
};

const createPresenceTracker = ({
    redis = redisClient,
    instanceId = crypto.randomUUID(),
    heartbeatMs = 20_000,
    instanceTtlSeconds = 60,
    userKeyTtlSeconds = 24 * 3600,
} = {}) => {
    // socketId → userId: the sockets this instance actually holds. The source of truth for
    // this instance; Redis is brought back in line with it whenever they may have diverged.
    const local = new Map();
    let timer = null;
    let lastWarning = null;

    const memberOf = (socketId) => `${instanceId}#${socketId}`;
    const entryOf = (userId, socketId) => `${userId}#${socketId}`;

    const warn = (action, err) => {
        const message = `[Presence] ${action} not written to Redis: ${err.message}`;
        if (message === lastWarning) return;
        lastWarning = message;
        console.error(message);
    };

    const track = async (socketId, userId) => {
        userId = String(userId);
        local.set(socketId, userId);
        try {
            await redis.requireRedis().multi()
                .sadd(userKey(userId), memberOf(socketId))
                .expire(userKey(userId), userKeyTtlSeconds)
                .sadd(instancesKey(instanceId), entryOf(userId, socketId))
                .expire(instancesKey(instanceId), userKeyTtlSeconds)
                .set(instanceKey(instanceId), '1', 'EX', instanceTtlSeconds)
                .exec();
        } catch (err) {
            warn('Connect', err); // the next reconcile writes it
        }
    };

    const untrack = async (socketId) => {
        const userId = local.get(socketId);
        if (!userId) return;
        local.delete(socketId);
        try {
            await redis.requireRedis().multi()
                .srem(userKey(userId), memberOf(socketId))
                .srem(instancesKey(instanceId), entryOf(userId, socketId))
                .exec();
        } catch (err) {
            warn('Disconnect', err); // the next reconcile removes it
        }
    };

    /** Make Redis hold exactly this instance's live sockets, and renew its liveness. */
    const reconcile = async () => {
        const r = redis.requireRedis();
        const desired = new Set([...local].map(([socketId, userId]) => entryOf(userId, socketId)));
        const current = new Set(await r.smembers(instancesKey(instanceId)));

        const tx = r.multi().set(instanceKey(instanceId), '1', 'EX', instanceTtlSeconds);
        for (const entry of current) {
            if (desired.has(entry)) continue;
            const [userId, socketId] = splitOnce(entry, '#');
            tx.srem(userKey(userId), memberOf(socketId)).srem(instancesKey(instanceId), entry);
        }
        for (const entry of desired) {
            const [userId, socketId] = splitOnce(entry, '#');
            tx.sadd(userKey(userId), memberOf(socketId)).expire(userKey(userId), userKeyTtlSeconds);
            tx.sadd(instancesKey(instanceId), entry);
        }
        tx.expire(instancesKey(instanceId), userKeyTtlSeconds);
        await tx.exec();
        lastWarning = null;
    };

    const safeReconcile = () => reconcile().catch((err) => warn('Heartbeat', err));

    /**
     * True when the customer has at least one live socket on any instance.
     * Throws when Redis cannot be asked — the caller must not read that as "disconnected".
     */
    const isUserConnected = async (userId) => {
        const r = redis.requireRedis();
        const key = userKey(String(userId));
        const members = await r.smembers(key);
        if (members.length === 0) return false;

        const parsed = members.map((member) => {
            const [owner, socketId] = splitOnce(member, '#');
            return { member, owner, socketId };
        });
        const others = [...new Set(parsed.map((p) => p.owner).filter((owner) => owner !== instanceId))];
        const alive = new Set([instanceId]);
        if (others.length > 0) {
            const results = await others.reduce((tx, owner) => tx.exists(instanceKey(owner)), r.multi()).exec();
            others.forEach((owner, i) => {
                const [err, exists] = results[i];
                if (err) throw err;
                if (exists) alive.add(owner);
            });
        }

        const live = [];
        const stale = [];
        for (const p of parsed) {
            const isLive = p.owner === instanceId ? local.has(p.socketId) : alive.has(p.owner);
            (isLive ? live : stale).push(p.member);
        }
        if (stale.length > 0) {
            await r.srem(key, ...stale).catch(() => { /* read again next time */ });
        }
        return live.length > 0;
    };

    /** Throws unless Redis can answer right now. */
    const ping = async () => {
        await redis.requireRedis().ping();
    };

    const start = () => {
        if (timer || !redis.isRedisConfigured()) return;
        redis.onReady(safeReconcile); // Redis restarted or came back: rebuild what it lost
        timer = setInterval(safeReconcile, heartbeatMs);
        timer.unref();
    };

    /** Stop the heartbeat and take this instance's sockets out of Redis. */
    const stop = async () => {
        if (timer) clearInterval(timer);
        timer = null;
        local.clear();
        try { await reconcile(); await redis.requireRedis().del(instanceKey(instanceId)); }
        catch (_) { /* its keys expire on their own */ }
    };

    return {
        instanceId,
        track,
        untrack,
        trackSocket: track,
        untrackSocket: untrack,
        reconcile,
        isUserConnected,
        ping,
        start,
        stop,
        localCount: () => local.size
    };
};

const defaultTracker = createPresenceTracker();

module.exports = {
    createPresenceTracker,
    defaultTracker,
    userKey,
    track: defaultTracker.track,
    untrack: defaultTracker.untrack,
    trackSocket: defaultTracker.track,
    untrackSocket: defaultTracker.untrack,
    isUserConnected: defaultTracker.isUserConnected,
    ping: defaultTracker.ping,
    startPresence: defaultTracker.start,
};
