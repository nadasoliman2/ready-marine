const fs = require('fs');
const path = require('path');

/**
 * Resized copies of uploaded images, on request: `/uploads/products/x.webp?w=480`.
 *
 * Product photos are uploaded at full camera size (1300px+, ~180KB) and shown in cards
 * about 300px wide, so every listing page downloaded several megabytes of pixels it threw
 * away. A card now asks for `?w=480` and gets a copy a fraction of the size.
 *
 * Built to be impossible to break a page with:
 *   - only a fixed set of widths, so nobody can make the server render arbitrary sizes;
 *   - the first request renders the copy and stores it on disk, every later one is a file read;
 *   - ANY failure (no sharp, unreadable file, odd format) falls through to the original
 *     image, which is exactly what the page showed before this existed.
 */

const ALLOWED_WIDTHS = new Set([160, 320, 480, 800]);
const RESIZABLE = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const CACHE_HEADER = 'public, max-age=2592000, immutable';

let sharp = null;
try { sharp = require('sharp'); } catch (_) { sharp = null; }

module.exports = function imageThumbnails(uploadsRoot) {
    const root = path.resolve(uploadsRoot);
    const thumbsRoot = path.join(root, '.thumbs');
    const inFlight = new Map();

    return async function thumbnailMiddleware(req, res, next) {
        const width = Number(req.query.w);
        if (!sharp || req.method !== 'GET' || !ALLOWED_WIDTHS.has(width)) return next();

        let relative;
        try { relative = decodeURIComponent(req.path); } catch (_) { return next(); }
        const source = path.resolve(root, '.' + relative);
        // Never outside the uploads folder, never the thumbnails themselves.
        if (!source.startsWith(root + path.sep) || source.startsWith(thumbsRoot)) return next();
        if (!RESIZABLE.has(path.extname(source).toLowerCase())) return next();

        const target = path.join(thumbsRoot, String(width), path.relative(root, source)) + '.webp';

        try {
            if (!fs.existsSync(target)) {
                if (!fs.existsSync(source)) return next();
                // Two visitors asking for the same new thumbnail at once render it once.
                if (!inFlight.has(target)) {
                    inFlight.set(target, (async () => {
                        await fs.promises.mkdir(path.dirname(target), { recursive: true });
                        const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
                        await sharp(source)
                            .rotate()
                            .resize({ width, withoutEnlargement: true })
                            .webp({ quality: 78 })
                            .toFile(tmp);
                        await fs.promises.rename(tmp, target);
                    })().finally(() => inFlight.delete(target)));
                }
                await inFlight.get(target);
            }
            res.set('Cache-Control', CACHE_HEADER);
            res.type('image/webp');
            return res.sendFile(target, (err) => { if (err && !res.headersSent) next(); });
        } catch (err) {
            console.error(`[thumbnails] ${relative} @${width}: ${err.message}`);
            return next();
        }
    };
};
