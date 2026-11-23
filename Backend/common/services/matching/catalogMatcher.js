/**
 * Which catalog entry is this product?
 *
 *   const matcher = buildCatalogMatcher({ entries, brands, categories, carBrands });
 *   matcher.match(product, { limit: 3 })
 *     → [{ entry, score, level, reasons, conflicts }]
 *
 * Every entry is read once into an identity (productIdentity.js) and indexed by its codes,
 * its rarer words and its cars. A product is matched in two steps: the index proposes a few
 * hundred entries that share anything worth sharing, then `judge` reads each pair slot by
 * slot. A slot both sides state and disagree on rejects the pair outright — another brand,
 * another car, front against rear, 500 ml against 250 ml — because a wrong link offered with
 * confidence is worse than no link at all. What survives is scored, and the score comes with
 * the reasons for it, so the admin sees why a link is proposed before pressing it.
 *
 * Nothing here touches the database: the service (catalogMatchService.js) loads the inputs
 * and keeps a built matcher in memory.
 */

const { createVehicleReader } = require('./vehicleMentions');
const { createIdentityReader, relateCodes } = require('./productIdentity');

// A word in more entries than this says nothing about which one ("فلتر", "بوش").
const MAX_POSTING = 1500;
// How many entries the index proposes for the full judgement.
const SHORTLIST = 250;

const LEVELS = [
    ['strong', 0.72],
    ['likely', 0.55],
    ['possible', 0.4],
];
const levelOf = (score) => (LEVELS.find(([, min]) => score >= min) || [null])[0];

const overlap = (a, b) => {
    let n = 0;
    for (const x of a) if (b.has(x)) n += 1;
    return n;
};

/**
 * Whether two lists of model years can be the same generation. A single year is read as the
 * generation around it (±2): "كورولا 2001" and "كورولا 2003" meet, "سيفيك 2016" and
 * "سيفيك 2025" do not. Years on one side only say nothing.
 */
const yearsMeet = (a, b) => {
    if (!a?.length || !b?.length) return true;
    const span = (r) => (r.to == null ? [r.from, 9999] : r.from === r.to ? [r.from - 2, r.from + 2] : [r.from, r.to]);
    return a.some((x) => b.some((y) => { const [a1, a2] = span(x); const [b1, b2] = span(y); return a1 <= b2 && b1 <= a2; }));
};

// What a result carries of its entry: enough to show it, not the fitment lists Bosch entries
// run to thousands of rows with.
const SLIM_FIELDS = ['_id', 'title_en', 'title_ar', 'part_number', 'status', 'category_id', 'product_brand_id', 'created_by_vendor_id', 'source_product_id'];
const slim = (entry) => {
    const out = {};
    for (const f of SLIM_FIELDS) if (entry[f] !== undefined) out[f] = entry[f];
    const image = (entry.images || []).find((i) => i.is_primary) || (entry.images || [])[0];
    if (image) out.images = [{ url: image.url, is_primary: true }];
    return out;
};

/** The readers the matcher needs, built once from the reference lists. */
const prepare = ({ brands = [], categories = [], carBrands = [] }) => {
    const reader = createVehicleReader(carBrands);
    const { identify } = createIdentityReader({ reader, brands });
    const parentOf = new Map(categories.map((c) => [String(c._id), c.parent_id ? String(c.parent_id) : null]));
    const rootOf = (id) => {
        let cur = id;
        for (let guard = 0; cur && parentOf.get(cur) && guard < 10; guard += 1) cur = parentOf.get(cur);
        return cur || null;
    };
    return { identify, rootOf };
};

const buildCatalogMatcher = (inputs) => {
    const ctx = prepare(inputs);
    return assemble(ctx, (inputs.entries || []).map((entry) => ({ entry: slim(entry), id: ctx.identify(entry) })));
};

/**
 * The same matcher, read a few hundred entries at a time with the event loop let go in
 * between: 38,000 entries take seconds to read, and a server that stops answering for that
 * long is a server that is down.
 */
const buildCatalogMatcherAsync = async (inputs, { chunk = 400 } = {}) => {
    const ctx = prepare(inputs);
    const entries = inputs.entries || [];
    const items = [];
    for (let i = 0; i < entries.length; i += chunk) {
        for (const entry of entries.slice(i, i + chunk)) items.push({ entry: slim(entry), id: ctx.identify(entry) });
        await new Promise((resolve) => setImmediate(resolve));
    }
    return assemble(ctx, items);
};

const assemble = ({ identify, rootOf }, items) => {
    const N = items.length || 1;

    const df = new Map();
    const byWord = new Map();
    const byCode = new Map();
    const byCar = new Map();
    const push = (map, key, i) => { const l = map.get(key); if (l) l.push(i); else map.set(key, [i]); };
    items.forEach(({ id }, i) => {
        for (const w of id.words) { df.set(w, (df.get(w) || 0) + 1); push(byWord, w, i); }
        for (const c of id.codes) push(byCode, c, i);
        for (const car of id.cars) push(byCar, car, i);
    });
    const idf = (w) => Math.log((N + 1) / ((df.get(w) || 0) + 1)) + 1;
    const weight = (ws) => ws.reduce((s, w) => s + idf(w), 0);

    /**
     * How alike two identities are, slot by slot.
     * @returns {{ score: number, reasons: object[], conflicts: string[] }}
     *          `conflicts` non-empty means the pair is rejected, whatever the score
     */
    const judge = (q, e) => {
        const reasons = [];
        const conflicts = [];
        let score = 0;

        // Brand: two makers are two products.
        const qb = q.brand.id || q.brand.name;
        const eb = e.brand.id || e.brand.name;
        let sameBrand = false;
        if (qb && eb) {
            sameBrand = !!((q.brand.id && q.brand.id === e.brand.id) || (q.brand.name && q.brand.name === e.brand.name));
            if (sameBrand) { score += 0.15; reasons.push({ key: 'brand', value: e.brand.name || q.brand.name }); } else conflicts.push('brand');
        } else score += 0.03;

        // Codes: a shared part number is the strongest evidence there is — unless it is short
        // ("151"): AGO reuses its short codes across unrelated parts. Two different numbers from
        // the same maker are two products ("6PK955" and "4PK850" are two DONGIL belts).
        const codes = relateCodes(q.codes, e.codes);
        // The same long part number, character for character, even with no digit in it
        // ("INT-FLOOR-MATS-UNI"): one product entered twice.
        if (codes.relation !== 'same' && q.part_number && q.part_number.length >= 6 && q.part_number === e.part_number) Object.assign(codes, { relation: 'same', code: q.part_number });
        const strongCode = codes.relation === 'same' && (codes.code.length >= 5 || (/[a-z]/.test(codes.code) && codes.code.length >= 4));
        if (strongCode) { score += 0.5; reasons.push({ key: 'code', value: codes.code }); } else if (codes.relation === 'same') {
            // A short number means more from the same maker: AGO's "147" among AGO's parts.
            score += sameBrand ? 0.3 : 0.15; reasons.push({ key: 'short_code', value: codes.code });
        } else if (codes.relation === 'variant') {
            score += 0.3; reasons.push({ key: 'code_variant', value: codes.code });
        } else if (codes.relation === 'different') {
            // Same maker, or the same store's own numbering: two numbers, two products.
            if (sameBrand || (q.vendor && q.vendor === e.vendor)) conflicts.push('code'); else score -= 0.1;
        }

        // Cars: a part for a Verna is not a part for a Lanos. Except that one maker's part number
        // is one part, whatever its fitment list says: Bosch's lists are the US market's and
        // name no BYD, while the vendor's "فلتر بنزين BYD - BOSCH" is that very filter.
        const identified = strongCode && sameBrand;
        if (q.cars.size && e.cars.size) {
            // A model both name, in generations that do not clash ("N16" is not "N17").
            const agree = [...q.cars].filter((c) => e.cars.has(c)
                && !(q.carGens.get(c) && e.carGens.get(c) && !overlap(q.carGens.get(c), e.carGens.get(c)))
                && yearsMeet(q.carYears.get(c), e.carYears.get(c)));
            const makeOf = (k) => k.split('|')[0];
            const byMake = [...e.cars].some((k) => q.makeOnly.has(makeOf(k))) || [...q.cars].some((k) => e.makeOnly.has(makeOf(k)));
            if (agree.length) { score += 0.15 * Math.min(1, agree.length / Math.min(q.cars.size, e.cars.size) + 0.25); reasons.push({ key: 'cars', value: agree }); } else if (byMake) score += 0.03;
            else if (!identified) conflicts.push(overlap(q.cars, e.cars) ? 'generation' : 'cars');
        } else if (q.carMakes.size && e.carMakes.size && !overlap(q.carMakes, e.carMakes)) {
            if (!identified) conflicts.push('cars');
        } else if (q.universal && e.universal) {
            score += 0.04;
        } else if (q.cars.size !== e.cars.size) {
            score -= 0.06;
        }

        // Oil grades, series names.
        if (q.grades.size && e.grades.size && !overlap(q.grades, e.grades)) conflicts.push('grade');
        for (const x of q.modelNumbers) {
            const prefix = x.replace(/\d+$/, '');
            const rival = [...e.modelNumbers].find((y) => y !== x && y.replace(/\d+$/, '') === prefix);
            if (rival && !e.modelNumbers.has(x)) { conflicts.push('series'); break; }
        }

        // Front/rear, upper/lower, right/left … disagreeing rules a pair out; agreeing is a
        // little more evidence for it.
        let agreeing = 0;
        for (const axis of Object.keys(q.axes)) {
            if (!e.axes[axis]) continue;
            if (overlap(q.axes[axis], e.axes[axis])) agreeing += 1; else conflicts.push(`axis:${axis}`);
        }
        score += 0.03 * Math.min(agreeing, 3);
        // Sizes and ratings stated on both sides.
        for (const unit of Object.keys(q.measures)) {
            if (!e.measures[unit]) continue;
            const near = (a, b) => (typeof a === 'number' ? Math.abs(a - b) <= Math.max(0.01 * Math.max(a, b), 0.001) : a === b);
            const agree = [...q.measures[unit]].some((a) => [...e.measures[unit]].some((b) => near(a, b)));
            if (!agree) conflicts.push(`measure:${unit}`);
        }

        // What kind of part: pads and filters share no word worth sharing.
        if (q.parts.size && e.parts.size) {
            const n = overlap(q.parts, e.parts);
            const union = new Set([...q.parts, ...e.parts]).size;
            if (n) { score += 0.15 * (n / union); reasons.push({ key: 'part', value: [...q.parts].filter((p) => e.parts.has(p)) }); } else if (!strongCode) conflicts.push('part'); else if (!identified) score -= 0.2;
        }

        // The words left, weighted by how rare they are in the catalog.
        const qs = new Set(q.words);
        const es = new Set(e.words);
        const both = [...qs].filter((w) => es.has(w));
        const union = new Set([...qs, ...es]);
        if (union.size) {
            const sim = weight(both) / weight([...union]);
            // The shorter title fully inside the longer one is one product said at two lengths.
            const contained = Math.min(qs.size, es.size) >= 2 && both.length === Math.min(qs.size, es.size);
            const words = Math.max(sim, contained ? 0.6 : 0);
            score += 0.35 * words;
            if (words >= 0.3) reasons.push({ key: 'words', value: Math.round(words * 100) / 100, shared: both.slice(0, 6) });
        }

        // One store's two listings are two products far more often than one listed twice.
        if (q.vendor && q.vendor === e.vendor && !strongCode) { score -= 0.2; reasons.push({ key: 'same_store' }); }

        // Category: the same branch of the tree.
        if (q.category_id && e.category_id) {
            if (q.category_id === e.category_id) { score += 0.06; reasons.push({ key: 'category' }); } else if (rootOf(q.category_id) === rootOf(e.category_id)) score += 0.03;
            else score -= 0.08;
        }

        return { score: Math.max(0, Math.min(1, score)), reasons, conflicts };
    };

    /** The few hundred entries worth judging for `q`. */
    const shortlist = (q, exclude) => {
        const acc = new Map();
        const add = (i, v) => acc.set(i, (acc.get(i) || 0) + v);
        for (const c of q.codes) for (const i of byCode.get(c) || []) add(i, 10);
        for (const w of q.words) {
            const list = byWord.get(w);
            if (!list || list.length > MAX_POSTING) continue;
            const v = idf(w);
            for (const i of list) add(i, v);
        }
        for (const car of q.cars) {
            const list = byCar.get(car);
            if (!list || list.length > MAX_POSTING * 2) continue;
            for (const i of list) add(i, 1);
        }
        return [...acc.entries()]
            .filter(([i]) => !exclude.has(String(items[i].entry._id)))
            .sort((a, b) => b[1] - a[1])
            .slice(0, SHORTLIST)
            .map(([i]) => i);
    };

    /**
     * The entries `doc` most likely is, best first.
     * @param doc  a product, or a catalog entry (to find what a suggestion duplicates)
     * @param options.exclude  entry ids never to propose (the entry itself, its own suggestion)
     * @param options.min      lowest score returned (default: the "possible" level)
     * @param options.withConflicts  also return pairs a conflict rejects (for the explain view)
     */
    const match = (doc, { limit = 5, exclude = [], min = LEVELS[2][1], withConflicts = false } = {}) => {
        const q = identify(doc);
        const skip = new Set(exclude.map(String));
        const out = [];
        for (const i of shortlist(q, skip)) {
            const r = judge(q, items[i].id);
            if (r.conflicts.length && !withConflicts) continue;
            if (r.score < min && !withConflicts) continue;
            out.push({ entry: items[i].entry, score: Math.round(r.score * 100) / 100, level: r.conflicts.length ? null : levelOf(r.score), reasons: r.reasons, conflicts: r.conflicts });
        }
        out.sort((a, b) => (a.conflicts.length - b.conflicts.length) || (b.score - a.score));
        return out.slice(0, limit);
    };

    /** How well `doc` fits one given entry — the check behind "this link looks wrong". */
    const check = (doc, entry) => {
        const r = judge(identify(doc), identify(entry));
        return { score: Math.round(r.score * 100) / 100, level: r.conflicts.length ? null : levelOf(r.score), reasons: r.reasons, conflicts: r.conflicts };
    };

    return { match, check, identify, size: items.length };
};

module.exports = { buildCatalogMatcher, buildCatalogMatcherAsync, LEVELS, levelOf };
