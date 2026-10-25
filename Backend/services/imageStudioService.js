const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { Product } = require('../models/products');
const { ImageSuggestion } = require('../models/imageSuggestions');
const { normalizeProductImages } = require('./shared/productImages');

/**
 * The image studio: cleaner product pictures, offered to the admin before anything changes.
 *
 *   - Every picture a vendor sends for approval is passed to the image service
 *     (imagetools/, its own container) which makes it white-background, square, centred and
 *     sharper. The result waits as a suggestion; the admin takes it or leaves it.
 *   - A product with no pictures can be given some from a web image search (Bing, no key).
 *     The admin picks; the picked picture is downloaded, cleaned the same way, and offered.
 *
 * No language model anywhere: the search query is built from the product's own brand, part
 * number and title, and the image service runs two small vision models on this machine.
 *
 * Built not to weigh on the shop: one picture at a time, a rest between pictures as long as
 * half the last one took, and the image service itself is capped (2 CPUs, 2 GB, low priority).
 */

const IMAGETOOLS_URL = (process.env.IMAGETOOLS_URL || 'http://imagetools:8000').replace(/\/+$/, '');
const UPLOADS_ROOT = path.join(__dirname, '../public/uploads');
const ENHANCED_DIR = path.join(UPLOADS_ROOT, 'products/enhanced');
const WEB_DIR = path.join(UPLOADS_ROOT, 'products/web');
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_WEB_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES_PER_PRODUCT = 10;
const MAX_ATTEMPTS = 3;
const MIN_PAUSE_MS = 500;
const ENHANCED_MARK = '/uploads/products/enhanced/';
const OUR_HOSTS = new Set(['readymarine.store', 'www.readymarine.store', 'localhost', '127.0.0.1']);
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

const fail = (message, status = 400, code) => Object.assign(new Error(message), { status, code });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const publicBase = () => (process.env.BACKEND_PUBLIC_URL || 'https://readymarine.store').replace(/\/+$/, '');
try { OUR_HOSTS.add(new URL(publicBase()).hostname); } catch (_) { /* default stays */ }

const workerEnabled = () => process.env.IMAGE_STUDIO_WORKER === '1'
    || (process.env.NODE_ENV !== 'test' && process.env.IMAGE_STUDIO_WORKER !== '0');
const autoEnabled = () => workerEnabled() && process.env.IMAGE_STUDIO_AUTO !== '0';

const isEnhancedUrl = (url) => typeof url === 'string' && url.includes(ENHANCED_MARK);

/* ------------------------------------------------------------------ */
/*  Safe fetching                                                      */
/* ------------------------------------------------------------------ */

/** Loopback, private, link-local, carrier-grade NAT, multicast — never fetched. */
const isBlockedIp = (ip) => {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split('.').map(Number);
        return a === 0 || a === 10 || a === 127 || a >= 224
            || (a === 100 && b >= 64 && b <= 127)
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || (a === 198 && (b === 18 || b === 19));
    }
    if (net.isIPv6(ip)) {
        const g = expandIPv6(ip);
        if (!g) return true;
        const v4 = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
        const zeros = (n) => g.slice(0, n).every((x) => x === 0);
        if (zeros(8) || (zeros(7) && g[7] === 1)) return true;                 // :: and ::1
        if (zeros(5) && g[5] === 0xffff) return isBlockedIp(v4(g[6], g[7]));   // ::ffff:a.b.c.d, any spelling
        if (zeros(6)) return isBlockedIp(v4(g[6], g[7]));                      // ::a.b.c.d
        if (g[0] === 0x64 && g[1] === 0xff9b && zeros(0)) return isBlockedIp(v4(g[6], g[7])); // NAT64
        if (g[0] === 0x2002) return isBlockedIp(v4(g[1], g[2]));                // 6to4
        return (g[0] & 0xfe00) === 0xfc00                                      // unique local
            || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0          // link / site local
            || (g[0] & 0xff00) === 0xff00;                                     // multicast
    }
    return true;
};

/** "::ffff:7f00:1" -> [0,0,0,0,0,0xffff,0x7f00,1]; a trailing dotted IPv4 is folded in. */
function expandIPv6(ip) {
    let s = ip.toLowerCase().split('%')[0];
    const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) {
        const p = dotted[1].split('.').map(Number);
        s = s.slice(0, -dotted[1].length) + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16);
    }
    const [head, tail] = s.split('::');
    const h = head ? head.split(':') : [];
    const t = tail !== undefined ? (tail ? tail.split(':') : []) : null;
    const groups = t === null ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
    if (groups.length !== 8) return null;
    const out = groups.map((x) => parseInt(x || '0', 16));
    return out.some((x) => Number.isNaN(x) || x < 0 || x > 0xffff) ? null : out;
}

/**
 * DNS lookup that refuses internal addresses. Used as the socket's own lookup, so the address
 * checked is the address connected to — a name that resolves to the database cannot slip
 * through between a check and the connection.
 */
const safeLookup = (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err);
        const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }];
        if (!list.length || list.some((a) => isBlockedIp(a.address))) {
            return callback(Object.assign(new Error('That address is not allowed.'), { code: 'BLOCKED_ADDRESS' }));
        }
        if (options.all) return callback(null, list);
        return callback(null, list[0].address, list[0].family);
    });
};

/**
 * GET a public http(s) URL into memory: internal addresses refused, at most `redirects`
 * hops (each re-checked), a size cap enforced while reading, and a hard deadline.
 */
const fetchPublic = (rawUrl, { maxBytes, timeoutMs = 15000, redirects = 3, accept = '*/*' } = {}) => new Promise((resolve, reject) => {
    let url;
    try { url = new URL(rawUrl); } catch (_) { return reject(fail('Not a valid address.')); }
    if (!['http:', 'https:'].includes(url.protocol)) return reject(fail('Only http and https addresses can be fetched.'));
    if (url.port && !['80', '443'].includes(url.port)) return reject(fail('That address is not allowed.'));
    // An address written as a bare IP never goes through `lookup`, so it is checked here
    // ("[::1]" arrives with its brackets).
    const literal = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(literal) && isBlockedIp(literal)) return reject(fail('That address is not allowed.'));

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, {
        lookup: safeLookup,
        headers: { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' },
        timeout: timeoutMs,
    }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            if (redirects <= 0) return reject(fail('Too many redirects.'));
            let next;
            try { next = new URL(res.headers.location, url).toString(); } catch (_) { return reject(fail('Bad redirect.')); }
            return resolve(fetchPublic(next, { maxBytes, timeoutMs, redirects: redirects - 1, accept }));
        }
        if (res.statusCode !== 200) {
            res.resume();
            return reject(fail(`The site answered ${res.statusCode}.`, 502));
        }
        const declared = Number(res.headers['content-length'] || 0);
        if (declared && declared > maxBytes) {
            res.destroy();
            return reject(fail('The file is too large.', 413));
        }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
            size += c.length;
            if (size > maxBytes) {
                res.destroy();
                reject(fail('The file is too large.', 413));
                return;
            }
            chunks.push(c);
        });
        res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || '', finalUrl: url.toString() }));
        res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(fail('The site took too long to answer.', 504)));
    req.on('error', (e) => reject(e.status ? e : (e.code === 'BLOCKED_ADDRESS' ? fail(e.message) : fail(`Could not reach the site (${e.code || e.message}).`, 502))));
});

/** jpg / png / webp / gif by their first bytes — the claim in a header is not evidence. */
const sniffImage = (buf) => {
    if (!buf || buf.length < 12) return null;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
    if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
    if (buf.slice(0, 3).toString('ascii') === 'GIF') return 'gif';
    return null;
};

/** A picture the product holds: ours is read from disk, anyone else's fetched. */
const readSource = async (url) => {
    let parsed = null;
    try { parsed = new URL(url, publicBase()); } catch (_) { /* fall through */ }
    if (parsed && OUR_HOSTS.has(parsed.hostname) && parsed.pathname.startsWith('/uploads/')) {
        let rel;
        try { rel = decodeURIComponent(parsed.pathname.slice('/uploads/'.length)); } catch (_) { throw fail('Bad picture address.'); }
        const file = path.resolve(UPLOADS_ROOT, rel);
        if (!file.startsWith(UPLOADS_ROOT + path.sep)) throw fail('Bad picture address.');
        const buf = await fs.promises.readFile(file).catch(() => { throw fail('The picture file is missing.', 404); });
        if (buf.length > MAX_SOURCE_BYTES) throw fail('The picture is too large.', 413);
        return buf;
    }
    const { buffer } = await fetchPublic(url, { maxBytes: MAX_SOURCE_BYTES, accept: 'image/*' });
    return buffer;
};

const writeAtomic = async (file, buf) => {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(tmp, buf, { mode: 0o644 });
    await fs.promises.rename(tmp, file);
};

/* ------------------------------------------------------------------ */
/*  The image service                                                  */
/* ------------------------------------------------------------------ */

const callImagetools = (route, body, timeoutMs = 120000) => new Promise((resolve, reject) => {
    const url = new URL(IMAGETOOLS_URL + route);
    const req = http.request(url, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length } : {},
        timeout: timeoutMs,
    }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
            let json = null;
            try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { /* not json */ }
            if (res.statusCode === 200 && json) return resolve(json);
            const err = fail((json && json.error) || `image service answered ${res.statusCode}`, res.statusCode);
            err.retryable = res.statusCode === 503 || res.statusCode >= 500;
            reject(err);
        });
        res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(fail('image service timed out', 504), { retryable: true })));
    req.on('error', (e) => reject(e.status ? e : Object.assign(fail(`image service unreachable (${e.code || e.message})`, 503), { retryable: true })));
    if (body) req.end(body); else req.end();
});

const serviceHealth = async () => {
    try {
        return await callImagetools('/health', null, 3000);
    } catch (e) {
        return { ok: false, error: e.message };
    }
};

/* ------------------------------------------------------------------ */
/*  The queue — one picture at a time                                  */
/* ------------------------------------------------------------------ */

let running = false;
let laterTimer = null;

const kick = () => {
    if (running || !workerEnabled()) return;
    running = true;
    setImmediate(runQueue);
};

const scheduleLater = async () => {
    if (laterTimer) return;
    const next = await ImageSuggestion.findOne({ status: 'queued', run_after: { $gt: new Date() } })
        .sort({ run_after: 1 }).select('run_after').lean().catch(() => null);
    if (!next) return;
    const wait = Math.max(2000, new Date(next.run_after).getTime() - Date.now());
    laterTimer = setTimeout(() => { laterTimer = null; kick(); }, wait);
    if (laterTimer.unref) laterTimer.unref();
};

async function runQueue() {
    try {
        for (;;) {
            const job = await ImageSuggestion.findOneAndUpdate(
                { status: 'queued', $or: [{ run_after: null }, { run_after: { $lte: new Date() } }] },
                { $set: { status: 'processing' }, $inc: { attempts: 1 } },
                { sort: { created_at: 1 }, returnDocument: 'after' },
            );
            if (!job) break;
            const started = Date.now();
            await processJob(job);
            // Rest at least half as long as the picture took: the service never runs flat out.
            await sleep(Math.max(MIN_PAUSE_MS, (Date.now() - started) / 2));
        }
    } catch (e) {
        console.error('[imageStudio] queue stopped:', e.message);
    } finally {
        running = false;
        scheduleLater();
    }
}

const saveOption = async (job, n, base64) => {
    const name = `s-${job._id}-${n}.jpg`;
    await writeAtomic(path.join(ENHANCED_DIR, name), Buffer.from(base64, 'base64'));
    return `${publicBase()}/uploads/products/enhanced/${name}`;
};

async function processJob(job) {
    try {
        const bytes = await readSource(job.source_url);
        const first = await callImagetools('/enhance?mode=auto', bytes);
        const info = first.info || {};
        const options = [{ url: await saveOption(job, 1, first.image), mode: info.mode, upscaled: !!info.upscaled }];
        // A cut-out can go wrong, so the whole picture on white comes along as the safe pick —
        // and goes first (the one "use all" takes) when the cut-out is not sure of itself.
        if (info.mode === 'cutout') {
            const whole = await callImagetools('/enhance?mode=pad', bytes);
            const safe = { url: await saveOption(job, 2, whole.image), mode: 'pad', upscaled: !!whole.info?.upscaled };
            if (info.confidence && info.confidence !== 'high') options.unshift(safe); else options.push(safe);
        }
        job.set({
            status: 'ready',
            options,
            confidence: info.confidence || null,
            notes: info.notes || [],
            source_report: info.source || null,
            error: null,
            run_after: null,
        });
        await job.save();
    } catch (e) {
        const retry = e.retryable && job.attempts < MAX_ATTEMPTS;
        job.set({
            status: retry ? 'queued' : 'failed',
            error: e.message,
            run_after: retry ? new Date(Date.now() + 15000 * job.attempts) : null,
        });
        await job.save().catch(() => {});
        if (!retry) console.warn(`[imageStudio] ${job._id} failed: ${e.message}`);
    }
}

/** On boot: a job a restart interrupted goes back in line. */
const start = async () => {
    if (!workerEnabled()) return;
    try {
        await ImageSuggestion.updateMany({ status: 'processing' }, { $set: { status: 'queued', run_after: null } });
    } catch (e) {
        console.error('[imageStudio] could not reset jobs:', e.message);
    }
    kick();
};

/* ------------------------------------------------------------------ */
/*  Suggestions                                                        */
/* ------------------------------------------------------------------ */

const productOr404 = async (productId, select = 'images') => {
    if (!mongoose.isValidObjectId(productId)) throw fail('Product not found', 404);
    const product = await Product.findById(productId).select(select).lean();
    if (!product) throw fail('Product not found', 404);
    return product;
};

/**
 * Queue a cleaner version of each of the product's pictures that does not have one yet.
 * Pictures already clean, already suggested, or kept on purpose as the original behind a
 * clean one are skipped; `force` asks again for ones dismissed or failed before.
 */
const queueProduct = async (productId, { by = 'auto', force = false } = {}) => {
    const product = await productOr404(productId);
    const urls = [...new Set((product.images || []).map((i) => i && i.url).filter(Boolean))];
    const candidates = urls.filter((u) => !isEnhancedUrl(u)).slice(0, MAX_IMAGES_PER_PRODUCT);
    if (!candidates.length) return { queued: 0, skipped: urls.length };

    const existing = await ImageSuggestion.find({
        product_id: product._id, kind: 'enhance', source_url: { $in: candidates },
    }).select('source_url status').lean();
    const always = new Set(['queued', 'processing', 'ready', 'applied']);
    const blocked = new Set(existing.filter((e) => always.has(e.status) || !force).map((e) => e.source_url));

    const fresh = candidates.filter((u) => !blocked.has(u));
    if (fresh.length) {
        await ImageSuggestion.insertMany(fresh.map((source_url) => ({
            product_id: product._id, kind: 'enhance', source_url, requested_by: by,
        })));
        kick();
    }
    return { queued: fresh.length, skipped: urls.length - fresh.length };
};

/** Fire-and-forget from the vendor's save: never slows it, never fails it. */
const queueProductSoon = (productId) => {
    if (!autoEnabled() || !productId) return;
    const t = setTimeout(() => {
        queueProduct(productId, { by: 'auto' }).catch((e) => console.warn('[imageStudio] auto-queue:', e.message));
    }, 2000);
    if (t.unref) t.unref();
};

const PRODUCT_FIELDS = 'title_en title_ar status sku part_number images vendor_id product_brand_id product_brand_source';

const forProduct = async (productId) => {
    if (!mongoose.isValidObjectId(productId)) throw fail('Product not found', 404);
    const product = await Product.findById(productId).select(PRODUCT_FIELDS)
        .populate('vendor_id', 'store_name').populate('product_brand_id', 'name name_en name_ar').lean();
    if (!product) throw fail('Product not found', 404);
    const suggestions = await ImageSuggestion.find({ product_id: product._id, status: { $ne: 'dismissed' } })
        .sort({ created_at: -1 }).limit(60).lean();
    return { product, suggestions, web_query: buildQuery(product) };
};

/**
 * Take a suggestion. A cleaned picture replaces its original in the same place, and the
 * original moves to the end of the gallery (the owner's rule: old pictures stay as
 * secondary ones). A web picture is added at the end — first, if the product had none.
 * Refused if the product's pictures changed since the suggestion was made.
 */
const applySuggestion = async (id, { option_url, keep_original = true, make_main } = {}, by = 'admin') => {
    if (!mongoose.isValidObjectId(id)) throw fail('Suggestion not found', 404);
    const s = await ImageSuggestion.findById(id);
    if (!s) throw fail('Suggestion not found', 404);
    if (s.status !== 'ready') throw fail('This suggestion is not ready to apply.', 409);
    const chosen = option_url ? s.options.find((o) => o.url === option_url) : s.options[0];
    if (!chosen) throw fail('Pick one of the suggested pictures.');

    const product = await productOr404(s.product_id);
    const before = (product.images || []).map((i) => i.url);
    let images = (product.images || []).map((i) => ({ _id: i._id, url: i.url, is_primary: !!i.is_primary }));

    // A clean picture goes in front of a main picture that is not clean (an ad, a photo on a
    // carpet) — otherwise the customer keeps seeing the old one. `make_main` overrides.
    const makeMain = make_main === undefined ? !isEnhancedUrl(before[0]) : !!make_main;
    let placed;
    if (s.kind === 'enhance') {
        const at = before.indexOf(s.source_url);
        if (at === -1) throw fail('The product\'s pictures changed since this was suggested. Ask for a new suggestion.', 409, 'PRODUCT_CHANGED');
        images[at] = { ...images[at], url: chosen.url };
        placed = at;
        if (keep_original && !images.some((i) => i.url === s.source_url)) {
            images.push({ url: s.source_url, is_primary: false });
        }
    } else {
        if (before.includes(chosen.url)) throw fail('The product already has this picture.', 409);
        images.push({ url: chosen.url, is_primary: false });
        placed = images.length - 1;
    }
    if (makeMain || images.length === 1) {
        images.unshift(images.splice(placed, 1)[0]);
    }
    images = normalizeProductImages(images.map((img, i) => ({ ...img, is_primary: i === 0 })));

    const res = await Product.updateOne(
        { _id: product._id, $expr: { $eq: [{ $map: { input: { $ifNull: ['$images', []] }, in: '$$this.url' } }, before] } },
        { $set: { images } },
    );
    if (!res.modifiedCount) throw fail('The product changed while you were looking. Reload and try again.', 409, 'PRODUCT_CHANGED');

    s.set({ status: 'applied', chosen_url: chosen.url, kept_original: s.kind === 'enhance' ? !!keep_original : null, decided_by: by, decided_at: new Date() });
    await s.save();
    // The image check sees the new picture now rather than on its next round.
    const imageCheck = require('./imageCheckService');
    imageCheck.invalidate();
    imageCheck.kick();
    return { suggestion: s.toObject(), images };
};

/** Every ready suggestion on the product, each with its first (recommended) picture. */
const applyAll = async (productId, by) => {
    const ready = await ImageSuggestion.find({ product_id: productId, status: 'ready' }).sort({ created_at: 1 }).select('_id').lean();
    let applied = 0;
    const errors = [];
    for (const s of ready) {
        try {
            await applySuggestion(s._id, {}, by);
            applied += 1;
        } catch (e) {
            errors.push(e.message);
        }
    }
    return { applied, errors };
};

const dismissSuggestion = async (id, by) => {
    if (!mongoose.isValidObjectId(id)) throw fail('Suggestion not found', 404);
    const s = await ImageSuggestion.findOneAndUpdate(
        { _id: id, status: { $in: ['ready', 'failed', 'queued'] } },
        { $set: { status: 'dismissed', decided_by: by, decided_at: new Date() } },
        { returnDocument: 'after' },
    ).lean();
    if (!s) throw fail('This suggestion can no longer be dismissed.', 409);
    return s;
};

const retrySuggestion = async (id) => {
    if (!mongoose.isValidObjectId(id)) throw fail('Suggestion not found', 404);
    const s = await ImageSuggestion.findOneAndUpdate(
        { _id: id, status: 'failed' },
        { $set: { status: 'queued', attempts: 0, error: null, run_after: null } },
        { returnDocument: 'after' },
    ).lean();
    if (!s) throw fail('Only a failed suggestion can be retried.', 409);
    kick();
    return s;
};

/* ------------------------------------------------------------------ */
/*  Web pictures                                                       */
/* ------------------------------------------------------------------ */

const brandName = (product) => {
    const b = product.product_brand_id;
    return b && typeof b === 'object' ? (b.name_en || b.name || b.name_ar || '') : '';
};

/** A part number worth searching for: real-looking, not one the system made up. */
const searchablePartNumber = (pn) => {
    const v = String(pn || '').trim();
    if (v.length < 4 || !/\d/.test(v) || /^(PN|SKU|GTIN)-/i.test(v)) return '';
    return v;
};

/** brand + part number + title, each word once, no longer than a search engine reads. */
const buildQuery = (product) => {
    const parts = [brandName(product), searchablePartNumber(product.part_number), product.title_en || product.title_ar || ''];
    const seen = new Set();
    const words = [];
    for (const part of parts) {
        for (const w of String(part).replace(/[|()[\]{}"']/g, ' ').split(/\s+/)) {
            const key = w.toLowerCase();
            if (!w || seen.has(key)) continue;
            seen.add(key);
            words.push(w);
        }
    }
    return words.join(' ').slice(0, 140).trim();
};

const unescapeHtml = (s) => s
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');

/** Bing's image results page: one `a.iusc` per picture with its data in `m`, size after it. */
const parseBing = (html) => {
    const anchors = [...html.matchAll(/<a\b[^>]*class="iusc"[^>]*>/g)];
    const out = [];
    anchors.forEach((match, i) => {
        const m = match[0].match(/\bm="([^"]+)"/);
        if (!m) return;
        let data;
        try { data = JSON.parse(unescapeHtml(m[1])); } catch (_) { return; }
        if (!/^https?:\/\//i.test(data.murl || '')) return;
        const tail = html.slice(match.index + match[0].length, anchors[i + 1] ? anchors[i + 1].index : match.index + 4000);
        const dims = tail.match(/(\d{2,5})\s*(?:&#215;|×)\s*(\d{2,5})/);
        let domain = '';
        try { domain = new URL(data.purl || data.murl).hostname.replace(/^www\./, ''); } catch (_) { /* none */ }
        out.push({
            image_url: data.murl,
            thumb_url: data.turl || null,
            page_url: data.purl || null,
            title: unescapeHtml(String(data.t || '')).replace(/<[^>]+>/g, '').slice(0, 200),
            domain,
            width: dims ? Number(dims[1]) : null,
            height: dims ? Number(dims[2]) : null,
        });
    });
    return out;
};

const searchCache = new Map();
const SEARCH_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Bing's lightweight results endpoint first, its full results page second. From a server
 * address Bing sometimes answers the first with an empty or challenge page that the second
 * still gets through — and an empty page there is not "no pictures exist", it is "not this
 * time".
 */
const BING_PAGES = [
    (q) => `https://www.bing.com/images/async?q=${encodeURIComponent(q)}&first=0&count=35&mmasync=1&setlang=en-US&cc=EG`,
    (q) => `https://www.bing.com/images/search?q=${encodeURIComponent(q)}&form=HDRSC2&first=1&setlang=en-US&cc=EG`,
];

const searchWebImages = async (query) => {
    const q = String(query || '').trim().slice(0, 150);
    if (q.length < 2) throw fail('Type what to search for.');
    const hit = searchCache.get(q);
    if (hit && hit.at > Date.now() - SEARCH_TTL_MS) return hit.results;

    let parsed = [];
    let lastError = null;
    let answered = false;
    for (const page of BING_PAGES) {
        try {
            const { buffer } = await fetchPublic(page(q), { maxBytes: 8 * 1024 * 1024, timeoutMs: 15000, accept: 'text/html' });
            const html = buffer.toString('utf8');
            parsed = parseBing(html);
            if (parsed.length) break;
            // A page with no result anchors at all is Bing refusing, not Bing finding nothing.
            answered = answered || /dgControl|imgpt/.test(html);
            console.warn(`[ImageStudio] Bing gave no pictures for "${q}" (${page(q).split('?')[0]}, ${html.length} bytes)`);
        } catch (err) {
            lastError = err;
            console.warn(`[ImageStudio] Bing search failed for "${q}": ${err.message}`);
        }
    }
    if (!parsed.length && !answered) {
        throw fail(lastError
            ? `The image search could not be reached (${lastError.message}). Try again in a minute.`
            : 'The image search refused this request. Try again in a minute.', 502);
    }

    const seen = new Set();
    const results = parsed.filter((r) => {
        if (seen.has(r.image_url)) return false;
        seen.add(r.image_url);
        // Too small to make a product picture of.
        return !(r.width && r.height && Math.max(r.width, r.height) < 300);
    }).slice(0, 30);

    // Only a real answer is remembered: caching an empty one would keep showing "nothing
    // found" for six hours after Bing had recovered.
    if (results.length) {
        if (searchCache.size > 300) searchCache.delete(searchCache.keys().next().value);
        searchCache.set(q, { at: Date.now(), results });
    }
    return results;
};

const webSearchForProduct = async (productId, q) => {
    const product = await Product.findById(productId).select(PRODUCT_FIELDS).populate('product_brand_id', 'name name_en name_ar').lean();
    if (!product) throw fail('Product not found', 404);
    const query = String(q || '').trim() || buildQuery(product);
    return { query, results: await searchWebImages(query) };
};

/**
 * The admin picked a web picture: download it (public addresses only, 10 MB, real image
 * bytes), keep our own copy, and queue it to be cleaned like any other picture.
 */
const pickWebImage = async (productId, { image_url, page_url, title, query } = {}, by = 'admin') => {
    const product = await productOr404(productId, '_id images');
    const open = await ImageSuggestion.countDocuments({ product_id: product._id, kind: 'web', status: { $in: ['queued', 'processing', 'ready'] } });
    if (open >= 12) throw fail('This product already has 12 web pictures waiting. Apply or dismiss some first.', 429);
    const dup = await ImageSuggestion.findOne({ product_id: product._id, kind: 'web', 'web.image_url': image_url, status: { $in: ['queued', 'processing', 'ready', 'applied'] } }).lean();
    if (dup) return dup;

    const { buffer } = await fetchPublic(image_url, { maxBytes: MAX_WEB_BYTES, accept: 'image/*' });
    const ext = sniffImage(buffer);
    if (!ext) throw fail('That link is not a picture (JPG, PNG, WebP or GIF).', 422);
    const name = `web-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    await writeAtomic(path.join(WEB_DIR, name), buffer);

    let domain = '';
    try { domain = new URL(page_url || image_url).hostname.replace(/^www\./, ''); } catch (_) { /* none */ }
    const s = await ImageSuggestion.create({
        product_id: product._id,
        kind: 'web',
        source_url: `${publicBase()}/uploads/products/web/${name}`,
        requested_by: by,
        web: {
            image_url: String(image_url).slice(0, 2000),
            page_url: page_url ? String(page_url).slice(0, 2000) : null,
            title: title ? String(title).slice(0, 300) : null,
            domain,
            query: query ? String(query).slice(0, 200) : null,
        },
    });
    kick();
    return s.toObject();
};

/* ------------------------------------------------------------------ */
/*  The studio's lists                                                 */
/* ------------------------------------------------------------------ */

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const STATUS_FILTERS = new Set(['published', 'pending', 'draft']);

const productFilter = ({ status, q }) => {
    const filter = {};
    if (STATUS_FILTERS.has(status)) filter.status = status;
    if (q && String(q).trim()) {
        const rx = new RegExp(escapeRegex(String(q).trim().slice(0, 80)), 'i');
        filter.$or = [{ title_en: rx }, { title_ar: rx }, { sku: rx }, { part_number: rx }];
    }
    return filter;
};

const NO_IMAGES = { $or: [{ images: { $exists: false } }, { images: { $size: 0 } }] };
const NOT_CLEAN = { 'images.0': { $exists: true }, 'images.0.url': { $not: /\/uploads\/products\/enhanced\// } };

const countsFor = async (ids) => {
    const rows = await ImageSuggestion.aggregate([
        { $match: { product_id: { $in: ids } } },
        { $group: { _id: { p: '$product_id', s: '$status' }, n: { $sum: 1 } } },
    ]);
    const out = {};
    for (const r of rows) {
        const key = String(r._id.p);
        out[key] = out[key] || {};
        out[key][r._id.s] = r.n;
    }
    return out;
};

const shapeRow = (p, counts) => ({
    _id: p._id,
    title_en: p.title_en,
    title_ar: p.title_ar,
    sku: p.sku,
    status: p.status,
    vendor: p.vendor_id && typeof p.vendor_id === 'object' ? p.vendor_id.store_name : null,
    image: p.images && p.images[0] ? p.images[0].url : null,
    images_count: (p.images || []).length,
    clean_main: isEnhancedUrl(p.images && p.images[0] && p.images[0].url),
    suggestions: counts[String(p._id)] || {},
});

/**
 * tab: 'suggestions' — products with cleaner pictures waiting for a decision
 *      'working'     — being made now, or failed
 *      'no_images'   — products with no picture at all (find some on the web)
 *      'not_clean'   — products whose main picture was never cleaned
 */
const listStudio = async ({ tab = 'suggestions', status = 'all', q = '', page = 1, limit = 20 } = {}) => {
    const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const pg = Math.max(parseInt(page, 10) || 1, 1);
    const base = productFilter({ status, q });

    if (tab === 'suggestions' || tab === 'working') {
        const statuses = tab === 'suggestions' ? ['ready'] : ['queued', 'processing', 'failed'];
        let productIds = null;
        if (Object.keys(base).length) {
            productIds = (await Product.find(base).select('_id').lean()).map((p) => p._id);
        }
        const match = { status: { $in: statuses }, ...(productIds ? { product_id: { $in: productIds } } : {}) };
        const [agg] = await ImageSuggestion.aggregate([
            { $match: match },
            { $group: { _id: '$product_id', latest: { $max: '$updated_at' } } },
            { $sort: { latest: -1 } },
            { $facet: { total: [{ $count: 'n' }], rows: [{ $skip: (pg - 1) * lim }, { $limit: lim }] } },
        ]);
        const total = agg.total[0] ? agg.total[0].n : 0;
        const ids = agg.rows.map((r) => r._id);
        const products = await Product.find({ _id: { $in: ids } }).select(PRODUCT_FIELDS).populate('vendor_id', 'store_name').lean();
        const byId = new Map(products.map((p) => [String(p._id), p]));
        const counts = await countsFor(ids);
        const rows = ids.map((id) => byId.get(String(id))).filter(Boolean).map((p) => shapeRow(p, counts));
        return { rows, pagination: { total, page: pg, pages: Math.max(1, Math.ceil(total / lim)) } };
    }

    // $and keeps the search's $or and the "no images" $or from overwriting each other.
    const filter = { $and: [base, tab === 'no_images' ? NO_IMAGES : NOT_CLEAN] };
    const [total, products] = await Promise.all([
        Product.countDocuments(filter),
        Product.find(filter).select(PRODUCT_FIELDS).populate('vendor_id', 'store_name')
            .sort({ status: 1, created_at: -1 }).skip((pg - 1) * lim).limit(lim).lean(),
    ]);
    const counts = await countsFor(products.map((p) => p._id));
    return { rows: products.map((p) => shapeRow(p, counts)), pagination: { total, page: pg, pages: Math.max(1, Math.ceil(total / lim)) } };
};

const summary = async ({ status = 'all' } = {}) => {
    const base = productFilter({ status });
    const scoped = Object.keys(base).length ? (await Product.find(base).select('_id').lean()).map((p) => p._id) : null;
    const sMatch = (statuses) => ({ status: { $in: statuses }, ...(scoped ? { product_id: { $in: scoped } } : {}) });
    const [suggestions, working, noImages, notClean, service] = await Promise.all([
        ImageSuggestion.distinct('product_id', sMatch(['ready'])).then((a) => a.length),
        ImageSuggestion.countDocuments(sMatch(['queued', 'processing', 'failed'])),
        Product.countDocuments({ ...base, ...NO_IMAGES }),
        Product.countDocuments({ ...base, ...NOT_CLEAN }),
        serviceHealth(),
    ]);
    return { suggestions, working, no_images: noImages, not_clean: notClean, service };
};

const queueMany = async (productIds, by) => {
    const ids = [...new Set((Array.isArray(productIds) ? productIds : []).map(String))].filter((id) => mongoose.isValidObjectId(id));
    if (!ids.length) throw fail('Choose the products first.');
    if (ids.length > 50) throw fail('At most 50 products at a time.');
    let queued = 0;
    for (const id of ids) {
        try {
            queued += (await queueProduct(id, { by })).queued;
        } catch (_) { /* a deleted product is just skipped */ }
    }
    return { products: ids.length, queued };
};

module.exports = {
    start,
    kick,
    queueProduct,
    queueProductSoon,
    queueMany,
    forProduct,
    applySuggestion,
    applyAll,
    dismissSuggestion,
    retrySuggestion,
    webSearchForProduct,
    pickWebImage,
    listStudio,
    summary,
    serviceHealth,
    // exposed for tests
    // a product picture's bytes: ours from disk, anyone else's through the safe fetch
    readSource,
    _internal: { isBlockedIp, parseBing, buildQuery, sniffImage, fetchPublic, readSource, searchablePartNumber },
};
