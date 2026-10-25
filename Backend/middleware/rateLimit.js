/**
 * Minimal in-process rate limiter.
 *
 * Deliberately dependency-free and per-instance: it is a guard against
 * double-clicks, retry storms, and casual enumeration of the family invitation
 * and payment endpoints — not a distributed quota system. Behind multiple app
 * instances each process enforces its own bucket, which is acceptable for the
 * abuse shapes this protects against.
 */
const buckets = new Map();
const MAX_TRACKED_KEYS = 20000;

const sweep = (now) => {
    for (const [key, entry] of buckets) {
        if (entry.resetAt <= now) buckets.delete(key);
    }
};

/**
 * @param {object}   options
 * @param {number}   options.windowMs  Rolling window length.
 * @param {number}   options.max       Allowed requests per window.
 * @param {string}   options.name      Bucket namespace (keeps routes independent).
 * @param {Function} [options.keyOf]   Custom key extractor; defaults to user id or IP.
 */
const rateLimit = ({ windowMs = 60_000, max = 10, name = 'default', keyOf } = {}) => {
    return (req, res, next) => {
        const now = Date.now();
        if (buckets.size > MAX_TRACKED_KEYS) sweep(now);

        const identity = keyOf
            ? keyOf(req)
            : (req.user?._id ? `u:${req.user._id}` : `ip:${req.ip}`);
        const key = `${name}:${identity}`;

        const entry = buckets.get(key);
        if (!entry || entry.resetAt <= now) {
            buckets.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }

        entry.count += 1;
        if (entry.count > max) {
            const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
            res.set('Retry-After', String(retryAfter));
            return res.status(429).json({
                code: 'RATE_LIMITED',
                message: `Too many requests. Please try again in ${retryAfter} second${retryAfter === 1 ? '' : 's'}.`,
            });
        }

        return next();
    };
};

module.exports = { rateLimit };
