/**
 * Search-as-you-type for the storefront, and the text search behind `GET /api/products`.
 *
 * Every keystroke in the search box asks for suggestions, so nothing here touches MongoDB
 * on a request. The searchable catalogue — published products of active, subscribed stores,
 * the active categories, the product brands, the car makes and models — is loaded into memory
 * and turned into an index: every word, normalised, pointing at the entries that contain it.
 * The index is rebuilt in the background once it is a minute old, so a request never waits
 * for it after the first one; a product published a moment ago turns up within that minute.
 *
 * "Normalised" is what makes Arabic searchable the way people type it: أ/إ/آ are ا, ة is ه,
 * ى is ي, diacritics and the tatweel are dropped, a leading "ال" does not matter, and Arabic
 * digits are digits. Every query word must match a word of the entry — whole, as the start
 * of it (the word still being typed), inside it, or within one or two typos. Part numbers and
 * SKUs also match with their dashes and spaces left out.
 */
const { Product } = require('../models/products');
const { Category } = require('../models/categories');
const { Brand } = require('../models/product_brands');
const { CarBrand } = require('../models/car_brands');
const { Seller } = require('../models/sellers');

const INDEX_TTL_MS = 60 * 1000;

// ── Normalisation ───────────────────────────────────────────────────────────────────────

const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const CHAR_MAP = {
    'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ى': 'ي', 'ئ': 'ي', 'ؤ': 'و', 'ة': 'ه',
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

/** Lower case, Arabic letter variants folded, everything that is not a letter or digit a space. */
const normalizeText = (value) => String(value || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // Citroën → citroen
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[أإآٱىئؤة٠-٩۰-۹]/g, (c) => CHAR_MAP[c])
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** "الفرامل" and "فرامل" are the same word to a searcher. */
const stripArticle = (word) => (word.length > 3 && word.startsWith('ال') ? word.slice(2) : word);

const tokenize = (value) => {
    const text = normalizeText(value);
    return text ? text.split(' ').map(stripArticle).filter(Boolean) : [];
};

/** Codes compared without separators: "04465-02220" is "0446502220". */
const compactCode = (value) => normalizeText(value).replace(/ /g, '');

// Car makes are stored by their English name; Arabic shoppers type them in Arabic.
const CAR_MAKE_ARABIC = {
    'toyota': ['تويوتا'], 'hyundai': ['هيونداي', 'هيوندا', 'هونداي'], 'kia': ['كيا'], 'nissan': ['نيسان'],
    'chevrolet': ['شيفروليه', 'شيفرولية', 'شفروليه', 'شيفرولي'], 'mercedes benz': ['مرسيدس', 'مرسيدس بنز'],
    'bmw': ['بي ام دبليو', 'بى ام', 'بي ام'], 'volkswagen': ['فولكس فاجن', 'فولكس', 'فولكسفاجن'],
    'skoda': ['سكودا'], 'renault': ['رينو'], 'peugeot': ['بيجو'], 'fiat': ['فيات'], 'mitsubishi': ['ميتسوبيشي', 'متسوبيشي'],
    'honda': ['هوندا'], 'mazda': ['مازدا'], 'suzuki': ['سوزوكي'], 'opel': ['اوبل'], 'ford': ['فورد'],
    'chery': ['شيري'], 'geely': ['جيلي'], 'byd': ['بي واي دي'], 'mg': ['ام جي'], 'seat': ['سيات'], 'audi': ['اودي'],
    'lada': ['لادا'], 'daewoo': ['دايو'], 'jeep': ['جيب'], 'land rover': ['لاند روفر', 'رنج روفر'], 'subaru': ['سوبارو'],
    'lexus': ['لكزس'], 'volvo': ['فولفو'], 'citroen': ['ستروين', 'سيتروين'], 'citreon': ['ستروين', 'سيتروين'],
    'proton': ['بروتون'], 'changan': ['شانجان'], 'haval': ['هافال'], 'jac': ['جاك'], 'dongfeng': ['دونج فينج', 'دونغ فنغ'],
    'speranza': ['اسبرانزا'], 'brilliance': ['بريليانس'], 'porsche': ['بورش'], 'jaguar': ['جاجوار'], 'mini': ['ميني'],
    'dodge': ['دودج'], 'chrysler': ['كرايسلر'], 'cadillac': ['كاديلاك'], 'tesla': ['تسلا'], 'isuzu': ['ايسوزو'],
    'daihatsu': ['دايهاتسو'], 'ssangyong': ['سانج يونج'], 'dacia': ['داسيا'], 'jetour': ['جيتور'], 'exeed': ['اكسيد'],
    'bestune': ['بيستون'], 'nasr': ['نصر'], 'gac': ['جاك موتورز'], 'baic': ['بايك'], 'dfsk': ['دي اف اس كي'],
};

// ── Edit distance (bounded) ──────────────────────────────────────────────────────────────

/**
 * Edit distance between a and b, counting two swapped neighbours ("braek" / "brake") as one
 * edit, or max + 1 as soon as it is known to exceed max.
 */
const boundedDistance = (a, b, max) => {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let before = null;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    let prevMin = 0;
    for (let i = 1; i <= a.length; i += 1) {
        const cur = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let value = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
            if (before && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                value = Math.min(value, before[j - 2] + 1);
            }
            cur[j] = value;
            if (value < rowMin) rowMin = value;
        }
        // A swap reaches back two rows, so stop only when both rows are past max.
        if (rowMin > max && prevMin > max) return max + 1;
        before = prev;
        prev = cur;
        prevMin = rowMin;
    }
    return prev[b.length];
};

const allowedTypos = (word) => (word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0);

// ── The index ────────────────────────────────────────────────────────────────────────────

/**
 * One searchable collection: entries, and every word → [entry index, field weight] postings.
 * `vocabulary` is the sorted word list, for prefix lookups by binary search.
 */
const createCollection = () => ({ entries: [], postings: new Map(), vocabulary: [] });

const addEntry = (collection, entry, fields) => {
    const at = collection.entries.length;
    collection.entries.push(entry);
    const best = new Map();
    for (const [value, weight] of fields) {
        for (const word of tokenize(value)) {
            if ((best.get(word) || 0) < weight) best.set(word, weight);
        }
    }
    for (const [word, weight] of best) {
        if (!collection.postings.has(word)) collection.postings.set(word, []);
        collection.postings.get(word).push([at, weight]);
    }
    entry._words = best;
    return at;
};

const sealCollection = (collection) => {
    collection.vocabulary = [...collection.postings.keys()].sort();
    return collection;
};

/** Index of the first vocabulary word ≥ prefix. */
const lowerBound = (sorted, prefix) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] < prefix) lo = mid + 1; else hi = mid;
    }
    return lo;
};

/**
 * Every vocabulary word one query word can stand for, with how good the match is:
 * 1 the same word, 0.85 its start, 0.5 inside it, 0.45 / 0.3 one / two typos away.
 * The last word of the query is the one being typed, so a prefix of it is as good as whole.
 */
const expandWord = (collection, word, { isLast }) => {
    const matches = new Map();
    const note = (candidate, quality) => {
        if ((matches.get(candidate) || 0) < quality) matches.set(candidate, quality);
    };

    if (collection.postings.has(word)) note(word, 1);
    const vocabulary = collection.vocabulary;
    for (let i = lowerBound(vocabulary, word); i < vocabulary.length && vocabulary[i].startsWith(word); i += 1) {
        note(vocabulary[i], isLast ? 0.95 : 0.85);
    }
    if (word.length >= 3) {
        for (const candidate of vocabulary) {
            if (candidate.length > word.length && candidate.includes(word)) note(candidate, 0.5);
        }
    }
    const typos = allowedTypos(word);
    if (typos && matches.size === 0) {
        for (const candidate of vocabulary) {
            if (candidate[0] !== word[0] && candidate[1] !== word[1]) continue;
            // Compare the typed word with the same length of the candidate as well, so a typo
            // in a word still being typed ("brak" for "brake…") is caught.
            const whole = boundedDistance(word, candidate, typos);
            const head = candidate.length > word.length ? boundedDistance(word, candidate.slice(0, word.length), typos) : whole;
            const distance = Math.min(whole, isLast ? head : whole);
            if (distance <= typos) note(candidate, distance === 1 ? 0.45 : 0.3);
        }
    }
    return matches;
};

/**
 * Entries that match every query word, scored. Each word contributes its best match in the
 * entry (quality × field weight). `corrected` tells whether any word only matched as a typo.
 */
const searchCollection = (collection, words, { requireAll = true } = {}) => {
    const scores = new Map(); // entry index -> { score, matched }
    let corrected = false;
    const corrections = [];

    words.forEach((word, position) => {
        const expanded = expandWord(collection, word, { isLast: position === words.length - 1 });
        let bestCandidate = null;
        let bestQuality = 0;
        const perEntry = new Map();
        for (const [candidate, quality] of expanded) {
            if (quality > bestQuality) { bestQuality = quality; bestCandidate = candidate; }
            for (const [at, weight] of collection.postings.get(candidate) || []) {
                const value = quality * weight;
                if ((perEntry.get(at) || 0) < value) perEntry.set(at, value);
            }
        }
        if (bestQuality > 0 && bestQuality < 0.5) { corrected = true; corrections.push([word, bestCandidate]); }
        for (const [at, value] of perEntry) {
            const current = scores.get(at) || { score: 0, matched: 0 };
            current.score += value;
            current.matched += 1;
            scores.set(at, current);
        }
    });

    const needed = requireAll ? words.length : 1;
    const results = [];
    for (const [at, { score, matched }] of scores) {
        if (matched >= needed) results.push({ at, score: score / words.length, matched });
    }
    return { results, corrected, corrections };
};

let index = null;
let building = null;

const primaryImage = (product) => {
    const images = product.images || [];
    return (images.find((img) => img.is_primary) || images[0] || {}).url || null;
};

const buildIndex = async () => {
    const activeVendors = await Seller.find({ status: { $ne: 'suspended' }, subscription_status: { $in: ['active', 'trial_active'] } })
        .select('_id store_name').lean();
    const storeNames = new Map(activeVendors.map((v) => [String(v._id), v.store_name]));

    const [products, categories, brands, carBrands] = await Promise.all([
        Product.find({ status: 'published', vendor_id: { $in: activeVendors.map((v) => v._id) } })
            .select('title_en title_ar subtitle_en subtitle_ar slug_en slug_ar sku part_number gtin price discount_price images sold_count rating vendor_id category_id product_brand_id created_at')
            .lean(),
        Category.find({ is_active: true }).select('name name_ar parent_id image').lean(),
        Brand.find().select('name image').lean(),
        CarBrand.find().select('name image models._id models.name').lean(),
    ]);

    const categoryById = new Map(categories.map((c) => [String(c._id), c]));
    const brandById = new Map([...brands, ...carBrands].map((b) => [String(b._id), b]));

    // How many live products each category (with its ancestors) and each brand holds, so
    // suggestions only offer what leads somewhere, and can say how much.
    const categoryCount = new Map();
    const brandCount = new Map();
    for (const product of products) {
        let cat = categoryById.get(String(product.category_id));
        const seen = new Set();
        while (cat && !seen.has(String(cat._id))) {
            seen.add(String(cat._id));
            categoryCount.set(String(cat._id), (categoryCount.get(String(cat._id)) || 0) + 1);
            cat = cat.parent_id ? categoryById.get(String(cat.parent_id)) : null;
        }
        if (product.product_brand_id) {
            const key = String(product.product_brand_id);
            brandCount.set(key, (brandCount.get(key) || 0) + 1);
        }
    }

    const productCollection = createCollection();
    const codes = [];
    for (const product of products) {
        const category = categoryById.get(String(product.category_id));
        const brand = brandById.get(String(product.product_brand_id));
        addEntry(productCollection, {
            _id: String(product._id),
            title_en: product.title_en || '',
            title_ar: product.title_ar || '',
            slug_en: product.slug_en || '',
            slug_ar: product.slug_ar || '',
            image: primaryImage(product),
            price: product.price,
            discount_price: product.discount_price ?? null,
            store_name: storeNames.get(String(product.vendor_id)) || '',
            sold_count: product.sold_count || 0,
            rating: product.rating || 0,
            created_at: product.created_at,
            normalizedTitles: [normalizeText(product.title_en), normalizeText(product.title_ar)].filter(Boolean),
        }, [
            [product.title_en, 1], [product.title_ar, 1],
            [product.subtitle_en, 0.6], [product.subtitle_ar, 0.6],
            [brand?.name, 0.7],
            [category?.name, 0.5], [category?.name_ar, 0.5],
            [product.sku, 0.8], [product.part_number, 0.8], [product.gtin, 0.8],
        ]);
        codes.push([product.sku, product.part_number, product.gtin].map(compactCode).filter((c) => c.length >= 3));
    }
    sealCollection(productCollection);

    const categoryCollection = createCollection();
    for (const category of categories) {
        const count = categoryCount.get(String(category._id)) || 0;
        if (!count) continue;
        const parent = category.parent_id ? categoryById.get(String(category.parent_id)) : null;
        addEntry(categoryCollection, {
            _id: String(category._id),
            name: category.name,
            name_ar: category.name_ar || '',
            parent_name: parent?.name || null,
            parent_name_ar: parent?.name_ar || null,
            image: category.image || null,
            count,
        }, [[category.name, 1], [category.name_ar, 1]]);
    }
    sealCollection(categoryCollection);

    const brandCollection = createCollection();
    for (const brand of brands) {
        const count = brandCount.get(String(brand._id)) || 0;
        if (!count) continue;
        addEntry(brandCollection, { _id: String(brand._id), name: brand.name, image: brand.image || null, count }, [[brand.name, 1]]);
    }
    sealCollection(brandCollection);

    // Car makes and their models: "toyota corolla" leads to the shop filtered for that car.
    const carCollection = createCollection();
    for (const make of carBrands) {
        const arabic = CAR_MAKE_ARABIC[normalizeText(make.name)] || [];
        const makeFields = [[make.name, 1], ...arabic.map((name) => [name, 1])];
        const makeWords = new Set(makeFields.flatMap(([name]) => tokenize(name)));
        addEntry(carCollection, {
            car_brand_id: String(make._id), car_model_id: null, brand_name: make.name, model_name: null, image: make.image || null,
        }, makeFields);
        for (const model of make.models || []) {
            addEntry(carCollection, {
                car_brand_id: String(make._id), car_model_id: String(model._id), brand_name: make.name, model_name: model.name, image: make.image || null,
                _makeWords: makeWords, _modelName: normalizeText(model.name),
            }, [...makeFields.map(([name]) => [name, 0.6]), [model.name, 1]]);
        }
    }
    sealCollection(carCollection);

    return {
        builtAt: Date.now(),
        products: productCollection,
        productCodes: codes,
        categories: categoryCollection,
        brands: brandCollection,
        cars: carCollection,
    };
};

/** The index, built on first use and refreshed in the background once it is a minute old. */
const getIndex = async () => {
    if (index && Date.now() - index.builtAt < INDEX_TTL_MS) return index;
    if (!building) {
        building = buildIndex()
            .then((built) => { index = built; return built; })
            .catch((err) => { console.error('[Search] index build failed:', err.message); return index; })
            .finally(() => { building = null; });
    }
    return index || building;
};

/** The Arabic names people type for a car make ("Toyota" → ["تويوتا"]), or []. */
const carMakeArabicNames = (name) => CAR_MAKE_ARABIC[normalizeText(name)] || [];

/** Drop the index so the next search rebuilds it (for writes that must show at once). */
const invalidateSearchIndex = () => { if (index) index.builtAt = 0; };

// ── Ranking ──────────────────────────────────────────────────────────────────────────────

const rankProducts = (idx, query) => {
    const words = tokenize(query);
    const code = compactCode(query);
    if (!words.length && !code) return { ranked: [], corrected: null };

    let { results, corrected, corrections } = searchCollection(idx.products, words);
    let relaxed = false;
    // Nothing has every word: show what has most of them rather than nothing.
    if (!results.length && words.length > 1) {
        ({ results, corrected, corrections } = searchCollection(idx.products, words, { requireAll: false }));
        results = results.filter((r) => r.matched >= Math.ceil(words.length / 2));
        relaxed = true;
    }

    const byAt = new Map(results.map((r) => [r.at, r]));
    // A part number or SKU typed with or without its dashes.
    if (code.length >= 3) {
        idx.productCodes.forEach((list, at) => {
            const hit = list.some((c) => c === code) ? 3 : list.some((c) => c.startsWith(code)) ? 2 : list.some((c) => c.includes(code)) ? 1 : 0;
            if (!hit) return;
            const current = byAt.get(at) || { at, score: 0, matched: words.length };
            current.score += hit;
            current.code = true;
            byAt.set(at, current);
        });
    }

    const phrase = normalizeText(query);
    const ranked = [...byAt.values()].map((r) => {
        const entry = idx.products.entries[r.at];
        let score = r.score;
        if (phrase.length >= 2) {
            if (entry.normalizedTitles.some((t) => t.startsWith(phrase))) score += 1.2;
            else if (entry.normalizedTitles.some((t) => t.includes(phrase))) score += 0.6;
        }
        // Among equally good matches, what sells comes first.
        score += Math.log1p(entry.sold_count) * 0.08 + entry.rating * 0.02;
        return { entry, score };
    }).sort((a, b) => b.score - a.score || b.entry.sold_count - a.entry.sold_count);

    const correctedQuery = corrected
        ? words.map((w) => (corrections.find(([from]) => from === w) || [w, w])[1]).join(' ')
        : null;
    return { ranked, corrected: correctedQuery, relaxed };
};

const topOf = (collection, words, limit) => {
    if (!words.length) return [];
    const { results } = searchCollection(collection, words);
    return results
        .map((r) => ({ entry: collection.entries[r.at], score: r.score }))
        .sort((a, b) => b.score - a.score || (b.entry.count || 0) - (a.entry.count || 0))
        .slice(0, limit)
        .map(({ entry }) => entry);
};

/** An entry as the client sees it: without the index's own fields (`_…`, normalised text). */
const publicEntry = (entry) => Object.fromEntries(
    Object.entries(entry).filter(([key]) => !key.startsWith('_') && key !== 'normalizedTitles'),
);

// ── Public API ───────────────────────────────────────────────────────────────────────────

/**
 * Suggestions for what has been typed so far: products, categories, brands and cars.
 * `total` is how many products the full search would return.
 */
const suggest = async (query, { limit = 6 } = {}) => {
    const q = String(query || '').slice(0, 100);
    const empty = { query: q, products: [], categories: [], brands: [], cars: [], total: 0, corrected: null };
    if (!normalizeText(q)) return empty;

    const idx = await getIndex();
    if (!idx) return empty;

    const words = tokenize(q);
    const { ranked, corrected } = rankProducts(idx, q);
    const safeLimit = Math.min(Math.max(Number(limit) || 6, 1), 12);

    return {
        query: q,
        products: ranked.slice(0, safeLimit).map(({ entry }) => publicEntry(entry)),
        categories: topOf(idx.categories, words, 3).map(publicEntry),
        brands: topOf(idx.brands, words, 2).map(publicEntry),
        cars: suggestCars(idx.cars, words),
        total: ranked.length,
        corrected,
    };
};

/**
 * Car makes and models for the words typed. A model is offered only when the words name the
 * model — "toyota" alone is the make, not three of its models — and either name its make
 * too ("toyota corolla") or start like the model ("corolla", not "brake" for the
 * "Shooting Brake"). Words shorter than two letters do not mean a car yet.
 */
const namesModel = (entry, carWords, score) => {
    // A model entry carries its make at weight 0.6, so a score at or under that means only
    // the make matched.
    if (score <= 0.6) return false;
    const makeNamed = carWords.some((w) => [...entry._makeWords].some((m) => m.startsWith(w)));
    return makeNamed || entry._modelName.startsWith(carWords[0]);
};

const suggestCars = (collection, words) => {
    const carWords = words.filter((w) => w.length >= 2 || /\d/.test(w));
    if (!carWords.length) return [];
    const { results } = searchCollection(collection, carWords);
    return results
        .map((r) => ({ entry: collection.entries[r.at], score: r.score }))
        .filter(({ entry, score }) => !entry.car_model_id || namesModel(entry, carWords, score))
        .sort((a, b) => b.score - a.score || (a.entry.model_name ? 1 : 0) - (b.entry.model_name ? 1 : 0))
        .slice(0, 3)
        .map(({ entry }) => publicEntry(entry));
};

/**
 * Ids of the products the text search matches, best first — the `search` filter of
 * `GET /api/products`. `null` when the index cannot be had, so the caller can fall back.
 */
const matchProductIds = async (query) => {
    const idx = await getIndex();
    if (!idx) return null;
    return rankProducts(idx, query).ranked.map(({ entry }) => entry._id);
};

module.exports = {
    suggest,
    matchProductIds,
    invalidateSearchIndex,
    getIndex,
    carMakeArabicNames,
    // exported for tests
    normalizeText,
    tokenize,
    boundedDistance,
    _test: { createCollection, addEntry, sealCollection, searchCollection },
};
