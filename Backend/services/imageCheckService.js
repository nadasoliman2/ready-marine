const crypto = require('crypto');
const mongoose = require('mongoose');
const { Product } = require('../models/products');
const { ImageCheck } = require('../models/imageChecks');
const { ImageSuggestion } = require('../models/imageSuggestions');
const { analyzeBuffer } = require('./imageCheck/analyzeImage');

/**
 * The image check: every product whose pictures look wrong, worst first — the pictures'
 * twin of the fitment check (services/fitmentCheckService.js).
 *
 * Built to cost the shop nothing:
 *   - each picture is measured ONCE, in the background, one at a time with a rest after each
 *     (services/imageCheck/analyzeImage.js — sharp, no model, no paid service), and the
 *     result is kept by URL; only new pictures are measured afterwards;
 *   - the worklist only reads those measurements (a few thousand small rows) and is cached
 *     for a minute;
 *   - "the pictures are fine" is kept on the product with a signature of what was found, so
 *     the product stays off the list until its pictures (or the findings) change.
 */

const VERSION = 2;
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
const LIST_TTL_MS = 60 * 1000;
const SWEEP_EVERY_MS = 10 * 60 * 1000;
const RETRY_UNREACHABLE_MS = 12 * 60 * 60 * 1000;
const SHARED_MIN_PRODUCTS = 4;

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/* ------------------------------------------------------------------ */
/*  What counts as wrong                                               */
/* ------------------------------------------------------------------ */

/**
 * Sensitive on purpose (the owner asked for "high sensitivity"): anything short of a clean,
 * sharp, square product on white is listed, with a severity so the admin can start with
 * the worst. Thresholds were set against the shop's own pictures on 2026-10-21 (the cleaned
 * 1200² pictures: sharpness ≥ 52 for 95 %, fill 0.85, offset < 0.01).
 */
const ISSUES = {
    no_images: 'high',
    broken: 'high',
    shared_image: 'medium',
    low_resolution: null, // high / medium / low by size
    blurry: null,         // high / medium / low by sharpness
    background_not_white: null,
    small_in_frame: null,
    off_center: null,
    touches_edges: 'low',
    not_square: 'low',
    too_dark: 'low',
    washed_out: 'low',
    one_image: 'low',
    duplicate_in_gallery: 'low',
    clean_not_main: 'medium',
};
const ISSUE_TYPES = Object.keys(ISSUES);

const issuesOfImage = (c, { sharedCount = 0 } = {}) => {
    if (!c) return [];
    if (c.status === 'broken') return [{ type: 'broken', severity: 'high', detail: c.error || null }];
    if (c.status !== 'ok') return [];
    const out = [];
    const longSide = Math.max(c.width || 0, c.height || 0);
    if (longSide < 400) out.push({ type: 'low_resolution', severity: 'high', detail: `${c.width}×${c.height}` });
    else if (longSide < 700) out.push({ type: 'low_resolution', severity: 'medium', detail: `${c.width}×${c.height}` });
    else if (longSide < 1000) out.push({ type: 'low_resolution', severity: 'low', detail: `${c.width}×${c.height}` });

    if (c.sharpness < 35) out.push({ type: 'blurry', severity: 'high', detail: c.sharpness });
    else if (c.sharpness < 50) out.push({ type: 'blurry', severity: 'medium', detail: c.sharpness });
    else if (c.sharpness < 58) out.push({ type: 'blurry', severity: 'low', detail: c.sharpness });

    const onWhite = c.border_white >= 0.9;
    if (c.border_white < 0.6) out.push({ type: 'background_not_white', severity: 'medium', detail: c.border_white });
    else if (c.border_white < 0.97) out.push({ type: 'background_not_white', severity: 'low', detail: c.border_white });

    if (onWhite) {
        if (c.fill < 0.5) out.push({ type: 'small_in_frame', severity: 'medium', detail: c.fill });
        else if (c.fill < 0.7) out.push({ type: 'small_in_frame', severity: 'low', detail: c.fill });
        if (c.fill >= 0.995 && c.content > 0.05) out.push({ type: 'touches_edges', severity: 'low', detail: c.fill });
        if (c.offset > 0.3) out.push({ type: 'off_center', severity: 'medium', detail: c.offset });
        else if (c.offset > 0.12) out.push({ type: 'off_center', severity: 'low', detail: c.offset });
    }

    const ratio = (c.width || 1) / (c.height || 1);
    if (ratio < 0.95 || ratio > 1.05) out.push({ type: 'not_square', severity: 'low', detail: `${c.width}×${c.height}` });
    if (c.brightness < 35 && c.contrast < 28) out.push({ type: 'too_dark', severity: 'low', detail: c.brightness });
    if (c.contrast < 14 && c.content > 0.05) out.push({ type: 'washed_out', severity: 'low', detail: c.contrast });
    if (sharedCount >= SHARED_MIN_PRODUCTS) out.push({ type: 'shared_image', severity: 'medium', detail: sharedCount });
    return out;
};

const hamming = (a, b) => {
    if (!a || !b || a.length !== b.length) return 64;
    let d = 0;
    for (let i = 0; i < a.length; i += 2) {
        let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
        while (x) { d += x & 1; x >>= 1; }
    }
    return d;
};

/* ------------------------------------------------------------------ */
/*  The background measuring                                           */
/* ------------------------------------------------------------------ */

let sweeping = false;
let sweepTimer = null;
const progress = { running: false, done: 0, todo: 0, last_run_at: null, last_error: null };

const workerEnabled = () => process.env.IMAGE_CHECK_WORKER === '1'
    || (process.env.NODE_ENV !== 'test' && process.env.IMAGE_CHECK_WORKER !== '0');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Picture URLs on products that have no current measurement (or one due a retry). */
const pendingUrls = async () => {
    const urls = (await Product.distinct('images.url')).filter((u) => typeof u === 'string' && u);
    const fresh = new Set((await ImageCheck.find({
        url: { $in: urls },
        version: VERSION,
        $or: [{ status: { $ne: 'unreachable' } }, { retry_at: { $gt: new Date() } }],
    }).select('url').lean()).map((c) => c.url));
    return urls.filter((u) => !fresh.has(u));
};

const measure = async (url) => {
    const { readSource } = require('./imageStudioService');
    let buffer;
    try {
        buffer = await readSource(url);
    } catch (e) {
        // 404 / 410, a missing file, or a page that is not a picture: the picture is broken.
        // Anything else (timeout, DNS, 5xx) may be someone else's server having a bad day.
        const status = Number(e.status) || 0;
        const broken = status === 404 || status === 410 || /missing|not a picture|answered 4\d\d/i.test(e.message || '');
        return broken ? { status: 'broken', error: e.message } : { status: 'unreachable', error: e.message };
    }
    try {
        return { status: 'ok', error: null, ...(await analyzeBuffer(buffer)) };
    } catch (e) {
        return { status: 'broken', error: `not a readable picture (${e.message})` };
    }
};

/** Measure what is new, one picture at a time; a rest after each as long as half its time. */
const sweep = async ({ limit = 5000 } = {}) => {
    if (sweeping) return progress;
    sweeping = true;
    progress.running = true;
    progress.last_error = null;
    try {
        const todo = (await pendingUrls()).slice(0, limit);
        progress.todo = todo.length;
        progress.done = 0;
        for (const url of todo) {
            const started = Date.now();
            const result = await measure(url);
            const prev = await ImageCheck.findOne({ url }).select('attempts status').lean();
            const attempts = result.status === 'unreachable' && prev?.status === 'unreachable' ? (prev.attempts || 0) + 1 : 1;
            // Unreachable three times, twelve hours apart: it is not coming back — broken.
            const status = result.status === 'unreachable' && attempts >= 3 ? 'broken' : result.status;
            await ImageCheck.updateOne({ url }, {
                $set: {
                    ...result,
                    status,
                    version: VERSION,
                    attempts,
                    analyzed_at: new Date(),
                    retry_at: status === 'unreachable' ? new Date(Date.now() + RETRY_UNREACHABLE_MS) : null,
                },
            }, { upsert: true });
            progress.done += 1;
            await sleep(Math.max(25, (Date.now() - started) / 2));
        }
        if (todo.length) listCache.clear();
    } catch (e) {
        progress.last_error = e.message;
        console.error('[ImageCheck] sweep stopped:', e.message);
    } finally {
        sweeping = false;
        progress.running = false;
        progress.last_run_at = new Date();
    }
    return progress;
};

const kick = () => {
    if (!workerEnabled() || sweeping) return;
    setImmediate(() => sweep().catch(() => {}));
};

const start = () => {
    if (!workerEnabled() || sweepTimer) return;
    // A little after boot, then every ten minutes: only new pictures are ever measured.
    setTimeout(kick, 2 * 60 * 1000).unref?.();
    sweepTimer = setInterval(kick, SWEEP_EVERY_MS);
    sweepTimer.unref?.();
};

/* ------------------------------------------------------------------ */
/*  Findings per product                                               */
/* ------------------------------------------------------------------ */

const FIELDS = 'title_ar title_en sku part_number status vendor_id images image_check_dismissed';

/**
 * The originals kept on purpose behind a cleaned picture (the owner's rule: old pictures
 * stay as secondary ones) are not findings — they are known and intended.
 */
const keptOriginals = async (productIds) => {
    const rows = await ImageSuggestion.find({ product_id: { $in: productIds }, status: 'applied', kind: 'enhance' })
        .select('product_id source_url chosen_url').lean();
    const map = new Map();
    for (const r of rows) {
        const key = String(r.product_id);
        if (!map.has(key)) map.set(key, new Map());
        map.get(key).set(r.source_url, r.chosen_url);
    }
    return map;
};

const signatureOf = (images, findings) => crypto.createHash('sha1')
    .update(JSON.stringify([images.map((i) => i.url), findings.map((f) => `${f.image || ''}|${f.type}|${f.severity}`).sort()]))
    .digest('hex').slice(0, 16);

const describeProduct = (p, checks, sharedByHash, kept) => {
    const images = (p.images || []).filter((i) => i && i.url);
    const findings = [];
    if (!images.length) findings.push({ type: 'no_images', severity: 'high', image: null });
    else if (images.length === 1) findings.push({ type: 'one_image', severity: 'low', image: null });

    const keptHere = kept.get(String(p._id)) || new Map();
    const clean = new Set(keptHere.values());
    const perImage = [];
    let unmeasured = 0;
    images.forEach((img, index) => {
        const c = checks.get(img.url);
        const intended = keptHere.has(img.url) && images.some((x) => clean.has(x.url));
        if (!c) unmeasured += 1;
        let issues = intended ? [] : issuesOfImage(c, { sharedCount: c?.dhash ? (sharedByHash.get(c.dhash) || 0) : 0 });
        // Pictures behind the main one matter less to a customer: one step down.
        if (index > 0) issues = issues.map((f) => ({ ...f, severity: f.severity === 'high' ? 'medium' : 'low' }));
        perImage.push({
            url: img.url,
            index,
            main: index === 0,
            kept_original: intended,
            measured: !!c,
            width: c?.width || null,
            height: c?.height || null,
            sharpness: c?.sharpness ?? null,
            issues,
        });
        for (const f of issues) findings.push({ ...f, image: img.url, index });
    });

    // The same picture twice in one gallery (ignoring a cleaned copy beside its original).
    for (let i = 0; i < images.length; i += 1) {
        for (let j = i + 1; j < images.length; j += 1) {
            const a = checks.get(images[i].url);
            const b = checks.get(images[j].url);
            const pair = keptHere.get(images[i].url) === images[j].url || keptHere.get(images[j].url) === images[i].url;
            if (!pair && a?.dhash && b?.dhash && hamming(a.dhash, b.dhash) <= 4) {
                findings.push({ type: 'duplicate_in_gallery', severity: 'low', image: images[j].url, index: j });
            }
        }
    }

    // A clean picture sits further down while an unclean one is shown first: the customer
    // never sees the better picture.
    const cleanAt = images.findIndex((img) => /\/uploads\/products\/enhanced\//.test(img.url));
    if (cleanAt > 0 && !/\/uploads\/products\/enhanced\//.test(images[0].url)) {
        findings.push({ type: 'clean_not_main', severity: 'medium', image: images[cleanAt].url, index: cleanAt });
    }

    // Done: the main picture is a cleaned one. Off the list — the owner's rule — unless a
    // picture in its gallery does not open, which a customer would still see broken.
    const done = images.length > 0 && /\/uploads\/products\/enhanced\//.test(images[0].url);
    if (done) {
        for (let i = findings.length - 1; i >= 0; i -= 1) if (findings[i].type !== 'broken') findings.splice(i, 1);
        for (const img of perImage) img.issues = img.issues.filter((f) => f.type === 'broken');
    }

    findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
    const signature = signatureOf(images, findings);
    const dismissed = !!(p.image_check_dismissed?.signature && p.image_check_dismissed.signature === signature);
    return {
        findings,
        images: perImage,
        signature,
        done,
        dismissed,
        unmeasured,
        top: findings.length ? SEVERITY_RANK[findings[0].severity] : null,
    };
};

/** Every measurement, and how many products use each look-alike picture. */
const loadChecks = async (urls) => {
    const rows = await ImageCheck.find({ url: { $in: urls }, version: VERSION })
        .select('url status error width height border_white content fill offset sharpness brightness contrast dhash').lean();
    return new Map(rows.map((r) => [r.url, r]));
};

let sharedCache = { at: 0, map: new Map() };
const sharedCounts = async () => {
    if (Date.now() - sharedCache.at < LIST_TTL_MS) return sharedCache.map;
    const products = await Product.find({ 'images.0': { $exists: true } }).select('images.url').lean();
    const urls = [...new Set(products.flatMap((p) => p.images.map((i) => i.url)))];
    const checks = await loadChecks(urls);
    const byHash = new Map();
    for (const p of products) {
        const hashes = new Set(p.images.map((i) => checks.get(i.url)?.dhash).filter(Boolean));
        for (const h of hashes) byHash.set(h, (byHash.get(h) || 0) + 1);
    }
    sharedCache = { at: Date.now(), map: byHash };
    return byHash;
};

const listCache = new Map();

/**
 * Products with something wrong in their pictures, worst first.
 *
 * @param status    'published' | 'pending' | 'draft' | 'all'
 * @param severity  'high' | 'medium' | 'low' — the lowest shown (default low: everything)
 * @param type      one issue type, or '' for any
 */
const listImageIssues = async ({ status = 'published', severity = 'low', type = '', vendor_id = '', q = '', page = 1, limit = 20 } = {}) => {
    const key = JSON.stringify({ status, severity, type, vendor_id, q: String(q || '').trim() });
    let built = listCache.get(key);
    if (!built || Date.now() - built.at > LIST_TTL_MS) {
        const query = {};
        if (['published', 'pending', 'draft'].includes(status)) query.status = status;
        if (vendor_id && mongoose.Types.ObjectId.isValid(String(vendor_id))) query.vendor_id = vendor_id;
        const term = String(q || '').trim().slice(0, 80);
        if (term) {
            const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            query.$or = [{ title_ar: rx }, { title_en: rx }, { sku: rx }, { part_number: rx }];
        }
        const products = await Product.find(query).select(FIELDS).populate('vendor_id', 'store_name').lean();
        const urls = [...new Set(products.flatMap((p) => (p.images || []).map((i) => i?.url).filter(Boolean)))];
        const [checks, shared, kept] = await Promise.all([loadChecks(urls), sharedCounts(), keptOriginals(products.map((p) => p._id))]);

        const floor = SEVERITY_RANK[severity] ?? SEVERITY_RANK.low;
        const counts = { total: 0, by_type: {}, by_severity: { high: 0, medium: 0, low: 0 }, dismissed: 0, done: 0, unmeasured: 0 };
        const rows = [];
        for (const p of products) {
            const d = describeProduct(p, checks, shared, kept);
            counts.unmeasured += d.unmeasured;
            if (d.done) counts.done += 1;
            if (d.dismissed) { if (d.findings.length) counts.dismissed += 1; continue; }
            const shown = d.findings.filter((f) => SEVERITY_RANK[f.severity] <= floor);
            if (!shown.length) continue;
            counts.total += 1;
            counts.by_severity[shown[0].severity] += 1;
            for (const t of new Set(shown.map((f) => f.type))) counts.by_type[t] = (counts.by_type[t] || 0) + 1;
            if (type && !shown.some((f) => f.type === type)) continue;
            rows.push({
                product: {
                    _id: p._id, title_ar: p.title_ar, title_en: p.title_en, sku: p.sku, status: p.status,
                    vendor: p.vendor_id ? { _id: p.vendor_id._id, store_name: p.vendor_id.store_name } : null,
                },
                findings: shown,
                images: d.images,
                signature: d.signature,
                top: SEVERITY_RANK[shown[0].severity],
                score: shown.reduce((s, f) => s + (f.severity === 'high' ? 9 : f.severity === 'medium' ? 3 : 1), 0),
            });
        }
        rows.sort((a, b) => a.top - b.top || b.score - a.score);
        built = { at: Date.now(), rows, counts };
        listCache.set(key, built);
        if (listCache.size > 50) listCache.delete(listCache.keys().next().value);
        if (counts.unmeasured) kick();
    }

    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);
    return {
        rows: built.rows.slice((safePage - 1) * safeLimit, safePage * safeLimit),
        counts: built.counts,
        progress: { ...progress },
        pagination: { total: built.rows.length, page: safePage, pages: Math.max(1, Math.ceil(built.rows.length / safeLimit)), limit: safeLimit },
    };
};

/** One product's findings (the product page). */
const checkProductImages = async (productId) => {
    if (!mongoose.Types.ObjectId.isValid(String(productId))) throw fail('Product not found', 404);
    const p = await Product.findById(productId).select(FIELDS).lean();
    if (!p) throw fail('Product not found', 404);
    const urls = (p.images || []).map((i) => i?.url).filter(Boolean);
    const [checks, shared, kept] = await Promise.all([loadChecks(urls), sharedCounts(), keptOriginals([p._id])]);
    const d = describeProduct(p, checks, shared, kept);
    if (d.unmeasured) kick();
    return { product_id: p._id, ...d };
};

/**
 * "The pictures are fine": off the list until they change. The signature is taken from
 * what the admin was looking at (sent back by the screen) when it still matches, so a
 * picture changed meanwhile by the vendor is not waved through unseen.
 */
const dismissImageIssues = async (productId, { signature } = {}, by = 'admin') => {
    const d = await checkProductImages(productId);
    if (signature && signature !== d.signature) {
        throw fail('The pictures changed since this list was loaded. Reload and look again.', 409);
    }
    await Product.updateOne({ _id: productId }, { $set: { image_check_dismissed: { at: new Date(), signature: d.signature, by } } });
    listCache.clear();
    return { product_id: productId, signature: d.signature };
};

/**
 * Put one of the product's own pictures first. Refused when the pictures changed since the
 * admin's list was loaded (the same guard as "the pictures are fine").
 */
const makeMainImage = async (productId, { url, signature } = {}) => {
    if (!mongoose.Types.ObjectId.isValid(String(productId))) throw fail('Product not found', 404);
    if (!url || typeof url !== 'string') throw fail('Choose the picture to make main.');
    const p = await Product.findById(productId).select('images').lean();
    if (!p) throw fail('Product not found', 404);
    if (signature) {
        const d = await checkProductImages(productId);
        if (d.signature !== signature) throw fail('The pictures changed since this list was loaded. Reload and look again.', 409);
    }
    const before = (p.images || []).map((i) => i.url);
    const at = before.indexOf(url);
    if (at === -1) throw fail('That picture is not on this product any more.', 409);
    if (at === 0) return { product_id: p._id, images: p.images };
    const images = [...p.images];
    images.unshift(images.splice(at, 1)[0]);
    const next = images.map((img, i) => ({ ...img, is_primary: i === 0 }));
    const res = await Product.updateOne(
        { _id: p._id, $expr: { $eq: [{ $map: { input: { $ifNull: ['$images', []] }, in: '$$this.url' } }, before] } },
        { $set: { images: next } },
    );
    if (!res.modifiedCount) throw fail('The product changed while you were looking. Reload and try again.', 409);
    invalidate();
    return { product_id: p._id, images: next };
};

const restoreImageIssues = async (productId) => {
    if (!mongoose.Types.ObjectId.isValid(String(productId))) throw fail('Product not found', 404);
    await Product.updateOne({ _id: productId }, { $unset: { image_check_dismissed: '' } });
    listCache.clear();
    return { product_id: productId };
};

/** A product's pictures changed (studio, vendor edit): its list rows are stale. */
const invalidate = () => { listCache.clear(); sharedCache.at = 0; };

module.exports = {
    VERSION,
    ISSUE_TYPES,
    start,
    kick,
    sweep,
    listImageIssues,
    checkProductImages,
    dismissImageIssues,
    restoreImageIssues,
    makeMainImage,
    invalidate,
    progress: () => ({ ...progress }),
    _internal: { issuesOfImage, hamming, describeProduct, pendingUrls },
};
