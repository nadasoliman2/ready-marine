/**
 * Reading the cars a product's text names.
 *
 *   const reader = createVehicleReader(carBrands);
 *   reader.read([{ field: 'title_ar', text: 'تيل خلفى قبقاب كورولا 2001 - ياريس 2006 - HI Q' }])
 *     → mentions: Toyota Corolla 2001, Toyota Yaris 2006
 *
 * The aliases (vehicleLexicon.js) are matched longest first over the folded words. An alias
 * that is also an ordinary word only counts with its make named in the text (`ctx`) or next
 * to it (`near`). Years are read after the cars: a year, a range ("2008-2015", "2010.2012",
 * "94 / 99", "من 2010 الى 2015") or an open range ("2009-...") belongs to the car named just
 * before it, and never jumps over another car.
 *
 * Every mention is resolved against the car list the caller passes (the `carbrands`
 * collection), so the make and model ids are the ones a fitment stores.
 */

const { fold, words, isArabic } = require('./text');
const { MAKES, MODELS, EQUIVALENT_MODELS, MAKE_FAMILIES, UNIVERSAL_WORDS, NOT_FITMENT_WORDS } = require('./vehicleLexicon');

const TOKEN = /\d+(?:\.\d+)+|\.{2,}|[\p{L}\p{N}]+|[-/+]/gu;
const YEAR4 = /^(19[5-9]\d|20[0-3]\d)$/;
const YEAR2 = /^\d{2}$/;
const YEAR_DOTTED = /^((?:19|20)\d\d)\.((?:19|20)\d\d)$/;
const RANGE_WORDS_FROM = new Set(['من', 'from']);
const RANGE_WORDS_TO = new Set(['الي', 'الى', 'حتي', 'لحد', 'to', 'till', 'until']);
const ENGINE_AFTER = new Set(['cc', 'سي', 'سى', 'cm3']);
// The same vendor wording, prefixed: "وفيرنا", "لمرسيدس", "بالنترا".
const PREFIXES = ['وال', 'بال', 'لل', 'و', 'ل', 'ب'];
// How far a year may sit after its car, and how far `near` reaches, in words.
const YEAR_REACH = 4;
const NEAR_REACH = 2;

const key = (make, model) => `${fold(make)}|${fold(model || '')}`;
const phrases = (list) => list.map((w) => ` ${words(w).join(' ')} `);
const UNIVERSAL_PHRASES = phrases(UNIVERSAL_WORDS);
const NOT_FITMENT_PHRASES = phrases(NOT_FITMENT_WORDS);

/** Every alias, keyed by its first word, longest first. */
const buildAliasIndex = () => {
    const index = new Map();
    const add = (entry, kind) => {
        for (const alias of entry.aliases) {
            const w = words(alias);
            if (!w.length) continue;
            const list = index.get(w[0]) || [];
            list.push({ words: w, alias, kind, entry });
            index.set(w[0], list);
        }
    };
    MAKES.forEach((e) => add(e, 'make'));
    MODELS.forEach((e) => add(e, 'model'));
    for (const list of index.values()) list.sort((a, b) => b.words.length - a.words.length);
    return index;
};

const tokenize = (text) => {
    const out = [];
    for (const m of fold(text).matchAll(TOKEN)) {
        const t = m[0];
        out.push({ t, sep: /^[-/+]$|^\.{2,}$/.test(t) });
    }
    return out;
};

/**
 * The car list, indexed for resolving a lexicon name to the stored make and model.
 * A stored model named "Atos / Santro" answers to either half.
 */
const indexCarBrands = (carBrands = []) => {
    const makes = new Map();
    for (const brand of carBrands) {
        const models = new Map();
        for (const model of brand.models || []) {
            const years = (model.years || []).map((y) => Number(y.year ?? y)).filter(Number.isFinite);
            const doc = {
                _id: model._id, name: model.name,
                minYear: years.length ? Math.min(...years) : null,
                maxYear: years.length ? Math.max(...years) : null,
            };
            const names = [model.name, ...String(model.name).split('/').map((s) => s.replace(/\(.*?\)/g, ''))];
            for (const n of names) {
                const k = fold(n).replace(/\s+/g, ' ').trim();
                if (k && !models.has(k)) models.set(k, doc);
            }
        }
        makes.set(fold(brand.name), { _id: brand._id, name: brand.name, models });
    }
    return makes;
};

const createVehicleReader = (carBrands = []) => {
    const aliasIndex = buildAliasIndex();
    const cars = indexCarBrands(carBrands);

    const brandNameOf = (make) => cars.get(fold(make))?.name || make;
    const resolve = (make, model) => {
        const brand = cars.get(fold(make));
        if (!brand) return { brand: null, model: null };
        if (!model) return { brand, model: null };
        return { brand, model: brand.models.get(fold(model)) || null };
    };

    /** Lexicon hits in one field, before the ctx / near / not checks. */
    const scanField = (field, text) => {
        const tokens = tokenize(text);
        const wordAt = [];
        tokens.forEach((tok, i) => { if (!tok.sep) wordAt.push(i); });
        const wordTokens = wordAt.map((i) => tokens[i].t);
        const hits = [];
        const consumed = new Array(wordTokens.length).fill(false);

        // Every alias that matches at `wi`, of the longest length that matches: one word can be
        // several cars ("a4" is an Audi, or an Octavia generation next to Skoda), and which
        // one is decided once the whole text is known.
        const tryAt = (wi, first) => {
            let found = null;
            for (const cand of aliasIndex.get(first) || []) {
                const n = cand.words.length;
                if (found && n < found[0].words.length) break;
                if (wi + n > wordTokens.length) continue;
                let ok = true;
                for (let k = 1; k < n; k += 1) if (wordTokens[wi + k] !== cand.words[k]) { ok = false; break; }
                if (ok) (found = found || []).push(cand);
            }
            return found;
        };

        for (let wi = 0; wi < wordTokens.length; wi += 1) {
            if (consumed[wi]) continue;
            const w = wordTokens[wi];
            // No guessing at misspellings: one letter away, "ميزان" (a part) reads as "ميجان" and
            // "نوبيتا" (a cartoon) as "نوبيرا". The misspellings vendors really use are aliases.
            let cand = tryAt(wi, w);
            if (!cand && isArabic(w[0])) {
                for (const p of PREFIXES) {
                    if (w.startsWith(p) && w.length - p.length >= 3) {
                        cand = tryAt(wi, w.slice(p.length));
                        if (cand) break;
                    }
                }
            }
            if (!cand) continue;
            const n = cand[0].words.length;
            for (let k = 0; k < n; k += 1) consumed[wi + k] = true;
            const lastTok = wordAt[wi + n - 1];
            hits.push({
                field, alts: cand, kind: cand[0].kind, entry: cand[0].entry, alias: wordTokens.slice(wi, wi + n).join(' '),
                start: wi, end: wi + n - 1, next: wordTokens[wi + n] || '',
                // "CS35+" is the CS35 Plus.
                plus: tokens[lastTok + 1]?.t === '+',
            });
        }
        return { tokens, wordAt, wordTokens, hits };
    };

    /** Years after each accepted model hit, read off the field's tokens. */
    const readYears = (scan, accepted) => {
        const { tokens, wordAt, wordTokens } = scan;
        const tokIndexOfWord = (wi) => wordAt[wi];
        const wordIndexOfTok = new Map(wordAt.map((ti, wi) => [ti, wi]));
        const modelHits = accepted.filter((h) => h.kind === 'model').sort((a, b) => a.start - b.start);
        const out = new Map();

        const ownerOf = (wi) => {
            let owner = null;
            for (const h of modelHits) {
                if (h.end < wi) owner = h;
                else break;
            }
            if (owner && wi - owner.end <= YEAR_REACH) return owner;
            return null;
        };
        const taken = new Set(accepted.flatMap((h) => Array.from({ length: h.end - h.start + 1 }, (_, k) => h.start + k)));
        const expand = (y) => {
            if (y >= 100) return y;
            // Two digits only right after the car, or inside a range: "شارك 97", "21-22".
            return y >= 50 ? 1900 + y : 2000 + y;
        };

        for (let wi = 0; wi < wordTokens.length; wi += 1) {
            if (taken.has(wi)) continue;
            const w = wordTokens[wi];
            let from = null;
            let to = null;
            let span = 1;
            const dotted = w.match(YEAR_DOTTED);
            if (dotted) {
                from = Number(dotted[1]); to = Number(dotted[2]);
            } else if (YEAR4.test(w) || YEAR2.test(w)) {
                const ti = tokIndexOfWord(wi);
                const twoDigit = YEAR2.test(w);
                if (ENGINE_AFTER.has(wordTokens[wi + 1])) continue;
                from = Number(w);
                // A range: Y - Y, Y / Y, Y Y, من Y الى Y
                const sep = tokens[ti + 1];
                const nextWi = wordIndexOfTok.get(ti + 2);
                const nextWord = nextWi != null ? wordTokens[nextWi] : null;
                if (sep && sep.sep && /^[-/]$/.test(sep.t) && nextWord && (YEAR4.test(nextWord) || (twoDigit && YEAR2.test(nextWord)))) {
                    to = Number(nextWord); span = 3;
                } else if (sep && sep.sep && sep.t === '-' && tokens[ti + 2] && /^\.{2,}$/.test(tokens[ti + 2].t)) {
                    to = Infinity; span = 2;
                } else if (!sep?.sep && wordTokens[wi + 1] && RANGE_WORDS_TO.has(wordTokens[wi + 1]) && YEAR4.test(wordTokens[wi + 2] || '')) {
                    to = Number(wordTokens[wi + 2]); span = 3;
                } else if (!sep?.sep && YEAR4.test(wordTokens[wi + 1] || '') && !twoDigit && Number(wordTokens[wi + 1]) > from) {
                    to = Number(wordTokens[wi + 1]); span = 2;
                } else {
                    to = from;
                }
                if (twoDigit) {
                    // Bare two digits are a year only straight after the car ("شارك 97") or as
                    // a range ("21-22", "94 / 99").
                    const owner = ownerOf(wi);
                    const adjacent = owner && (wi - owner.end === 1 || RANGE_WORDS_FROM.has(wordTokens[wi - 1]));
                    if (!(adjacent || to !== from)) continue;
                }
            } else {
                continue;
            }
            const start = RANGE_WORDS_FROM.has(wordTokens[wi - 1]) ? wi - 1 : wi;
            const owner = ownerOf(start);
            if (!owner) { wi += span - 1; continue; }
            const a = expand(from);
            const b = to === Infinity ? Infinity : expand(to);
            const lastYear = new Date().getFullYear() + 1;
            if (!Number.isFinite(a) || a > lastYear || (b !== Infinity && (b < 1950 || b > lastYear))) { wi += span - 1; continue; }
            const range = b === Infinity ? { from: a, to: null } : { from: Math.min(a, b), to: Math.max(a, b) };
            const list = out.get(owner) || [];
            list.push(range);
            out.set(owner, list);
            wi += span - 1;
        }
        return out;
    };

    /**
     * @param fields  [{ field, text }] — every field of one product, read together so a make
     *                named in the title vouches for a code in the description
     * @param options.makes  makes the caller already knows the product is for (its fitment):
     *                they vouch for a code like "RB" the way a make named in the text would
     * @returns {{ mentions, universal, not_fitment, makes_named }}
     */
    const read = (fields, { makes: hintMakes = [] } = {}) => {
        const hinted = new Set(hintMakes.map((m) => brandNameOf(m)));
        // A file name pasted into a description ("New C GLC 2 pin cable connection.jpg") is not a claim.
        const clean = (text) => String(text || '').replace(/\S+\.(jpe?g|png|webp|gif|pdf)\b/gi, ' ');
        const scans = (fields || []).filter((f) => f && f.text).map((f) => ({ field: f.field, ...scanField(f.field, clean(f.text)) }));
        const all = scans.flatMap((s) => s.hits.map((h) => ({ ...h, scan: s })));

        const makesNamed = new Set();
        for (const h of all) {
            for (const alt of h.alts) if (!alt.entry.ctx && !alt.entry.near) makesNamed.add(alt.entry.make);
        }
        const familyOf = (make) => MAKE_FAMILIES.find((f) => f.includes(make)) || [make];

        const accepted = new Set();
        const valid = (h, entry) => {
            if (entry.not && entry.not.map(fold).includes(h.next)) return false;
            if (entry.unlessText && entry.unlessText.some((w) => h.scan.wordTokens.includes(fold(w)))) return false;
            if (entry.ctx && !entry.ctx.some((m) => familyOf(m).some((x) => makesNamed.has(x) || hinted.has(x)))
                && !(YEAR4.test(h.next) && Number(h.next) >= 1980)) return false;
            if (entry.near) {
                const neighbours = h.scan.hits.filter((o) => o.start !== h.start
                    && Math.min(Math.abs(o.start - h.end), Math.abs(h.start - o.end)) <= NEAR_REACH);
                const satisfied = entry.near.some((tag) => neighbours.some((o) => o.alts.some((alt) => {
                    if (tag === 'gen:lancer') return !!alt.entry.lancerGen;
                    if (tag.startsWith('model:')) return alt.kind === 'model' && alt.entry.model === tag.slice(6);
                    return alt.kind === 'make' && alt.entry.make === tag;
                })));
                if (!satisfied) return false;
            }
            return true;
        };
        for (const h of all) {
            const alt = h.alts.find((a) => valid(h, a.entry));
            if (alt) accepted.add(Object.assign(h, { entry: alt.entry, kind: alt.kind }));
        }

        const has = (s, list) => { const t = ` ${s.wordTokens.join(' ')} `; return list.some((w) => t.includes(w)); };
        const universal = scans.some((s) => /title|subtitle/.test(s.field) && has(s, UNIVERSAL_PHRASES));
        const notFitment = scans.some((s) => /title/.test(s.field) && has(s, NOT_FITMENT_PHRASES));

        // Years, per field.
        const yearsOf = new Map();
        for (const s of scans) {
            const ys = readYears(s, [...accepted].filter((a) => a.field === s.field));
            for (const [h, list] of ys) yearsOf.set(h, list);
        }

        // Mentions: each accepted model hit, plus each make named with none of its models.
        const mentions = [];
        const modelMakes = new Set([...accepted].filter((h) => h.kind === 'model').map((h) => h.entry.make));
        const makeHits = [...accepted].filter((h) => h.kind === 'make');
        for (const h of accepted) {
            if (h.kind === 'make' && familyOf(h.entry.make).some((m) => modelMakes.has(m))) continue;
            let { brand, model } = resolve(h.entry.make, h.entry.model);
            if (h.plus && model) {
                const plus = resolve(h.entry.make, `${model.name} Plus`);
                if (plus.model) model = plus.model;
            }
            // "دايو لانوس" is the Daewoo-badged Lanos: the make written right before the model
            // wins over the lexicon's default, when the car list has the model under it.
            const before = makeHits.find((m) => m.field === h.field && h.start - m.end >= 1 && h.start - m.end <= 2);
            if (h.kind === 'model' && before && before.entry.make !== h.entry.make) {
                const other = resolve(before.entry.make, h.entry.model);
                if (other.model) ({ brand, model } = other);
            }
            mentions.push({
                field: h.field,
                make: brand?.name || h.entry.make,
                make_id: brand?._id || null,
                model: h.kind === 'model' ? (model?.name || h.entry.model) : null,
                model_id: model?._id || null,
                model_years: model ? { from: model.minYear, to: model.maxYear } : null,
                written: h.alias,
                years: yearsOf.get(h) || [],
                gen: h.entry.gen || null,
                lancer_gen: !!h.entry.lancerGen,
                typo: h.entry.typo || null,
                conditional: !!(h.entry.ctx || h.entry.near || h.entry.weak),
                position: h.start,
            });
        }
        const makesNamedInText = new Set([...accepted].map((h) => brandNameOf(h.entry.make)));
        return { mentions, universal, not_fitment: notFitment, makes_named: makesNamedInText };
    };

    return { read, resolve, cars };
};

/** The key two mentions or fitment rows share when they are the same car under another badge. */
const EQUIVALENT_KEYS = new Map(EQUIVALENT_MODELS.flatMap((group) => group.map(([mk, md]) => [key(mk, md), key(...group[0])])));
const canonicalModelKey = (make, model) => {
    const k = key(make, model);
    return EQUIVALENT_KEYS.get(k) || k;
};

module.exports = { createVehicleReader, canonicalModelKey, indexCarBrands, tokenize };
