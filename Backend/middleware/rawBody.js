/**
 * Read the request body as a Buffer, untouched.
 *
 * Express 4.16 has express.json() but not express.raw(). Two places need the
 * exact bytes: a signed webhook (the HMAC is over the bytes sent — mount it
 * before express.json(), which would otherwise consume a JSON body first) and a
 * voice note posted as a bare audio Blob (express.json() ignores audio types).
 *
 * Over `limit` the request is answered 413 with `message` and the socket left
 * to close; nothing is buffered past the limit.
 */
const rawBody = ({ limit = 2 * 1024 * 1024, message = 'Request body is too large' } = {}) => (req, res, next) => {
    if (Buffer.isBuffer(req.body)) return next();
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) return res.status(413).json({ message });

    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (err) => {
        if (done) return;
        done = true;
        if (err) return next(err);
        req.body = Buffer.concat(chunks);
        return next();
    };
    req.on('data', (chunk) => {
        if (done) return;
        size += chunk.length;
        if (size > limit) {
            done = true;
            res.status(413).json({ message });
            req.unpipe?.();
            return;
        }
        chunks.push(chunk);
    });
    req.on('end', () => finish());
    req.on('error', (err) => finish(err));
};

module.exports = rawBody;
