/**
 * What a product is, read off its title — the parts two listings must agree on to be the
 * same product.
 *
 *   identify({ title_ar, title_en, part_number, ... }) →
 *     codes      part numbers and the code-like words of the title ("D293", "5PK865")
 *     brand      the maker, from the brand field or the title ("… - GSP", "من DTR")
 *     cars       the cars it names (vehicleMentions.js), as model keys
 *     parts      what kind of part it is, as concepts both languages share ("تيل" = "pads")
 *     axes       front/rear, upper/lower, right/left, inner/outer, big/small … — two listings
 *                that disagree on one are two products, however alike the rest reads
 *     measures   numbers with a unit (500 ml, 150 W, 12 V, 1600 cc)
 *     words      everything else, folded, for the weighted word overlap
 *
 * The idea comes from the pharmacy matcher this project's owner built before: break a title
 * into typed slots, let a slot stated on both sides veto the pair when it disagrees, and let
 * silence on one side cost nothing.
 */

const { fold, words, stripArticle, compactCode, isArabic } = require('./text');
const { canonicalModelKey } = require('./vehicleMentions');

/* ── Part concepts: the same part, however it is written ──────────────────────────── */

const PART_CONCEPTS = {
    pads: ['تيل', 'فحمات', 'لقم', 'pads', 'pad'],
    shoes: ['قبقاب', 'shoes', 'shoe'],
    shock: ['مساعد', 'مساعدين', 'ممتص', 'shock', 'absorber', 'absorbers', 'شكمان مساعد'],
    cv_joint: ['كوبلن', 'كوبلين', 'cv'],
    belt: ['سير', 'سيور', 'belt', 'belts'],
    timing: ['كاتينه', 'كاتينة', 'timing'],
    pump: ['طلمبه', 'طرمبه', 'مضخه', 'pump'],
    spark_plug: ['بوجيه', 'بوجيهات', 'بوجى', 'شمعه', 'شمعات', 'plug', 'plugs'],
    coil: ['بوبينه', 'بوبينة', 'coil'],
    filter: ['فلتر', 'فلاتر', 'مصفاه', 'filter', 'filters'],
    cabin: ['تكييف', 'تكيف', 'كابينه', 'cabin'],
    air: ['هواء', 'هوا', 'air'],
    oil: ['زيت', 'oil'],
    fuel: ['بنزين', 'وقود', 'fuel', 'petrol'],
    alternator: ['دينامو', 'alternator', 'alternators'],
    starter: ['مارش', 'starter'],
    radiator: ['رادياتير', 'ردياتير', 'رديتاير', 'ريداتير', 'radiator'],
    elbow: ['كوعه', 'كوع', 'elbow'],
    hose: ['خرطوم', 'خراطيم', 'hose'],
    bushing: ['جلبه', 'جلب', 'bushing', 'bush'],
    rubber: ['كاوتش'],
    arm: ['مقص', 'arm'],
    ball_joint: ['بيضه', 'بيض', 'joint'],
    link: ['باره', 'باراه', 'تيش', 'link'],
    stabilizer: ['ميزان', 'stabilizer'],
    oil_seal: ['اويل سيل', 'اوسيل', 'اولسيل', 'seal'],
    gasket: ['جوان', 'جوانات', 'gasket'],
    disc: ['ديسك', 'طنبوره', 'disc', 'rotor'],
    drum: ['درام', 'drum'],
    bearing: ['بليه', 'بلي', 'bearing'],
    tensioner: ['شداد', 'tensioner'],
    pulley: ['بكره', 'طمبوره', 'pulley'],
    thermostat: ['ترموستات', 'ثرموستات', 'thermostat'],
    wiper: ['مساحه', 'مساحات', 'wiper', 'wipers'],
    freshener: ['معطر', 'فواحه', 'freshener', 'fragrance'],
    polish: ['ملمع', 'تلميع', 'polish', 'wax', 'واكس'],
    cleaner: ['منظف', 'تنظيف', 'cleaner', 'cleaning'],
    bulb: ['لمبه', 'لمبات', 'ليد', 'led', 'bulb', 'bulbs'],
    screen: ['شاشه', 'screen', 'display'],
    camera: ['كاميرا', 'camera'],
    charger: ['شاحن', 'charger'],
    cable: ['كابل', 'كابلات', 'cable'],
    holder: ['حامل', 'holder', 'mount'],
    mount: ['قاعده', 'قواعد'],
    battery: ['بطاريه', 'battery', 'batteries'],
    clutch: ['دبرياج', 'clutch'],
    mat: ['فرش', 'دواسات', 'mats', 'mat'],
    cover: ['غطاء', 'جراب', 'cover', 'case'],
    keychain: ['ميداليه', 'keychain', 'keyring'],
    sensor: ['حساس', 'سنسور', 'sensor'],
    injector: ['بخاخ', 'بخاخات', 'رشاش', 'injector', 'injectors'],
    compressor: ['كمبروسر', 'ضاغط', 'compressor'],
    drill: ['دريل', 'شنيور', 'drill'],
    master: ['ماستر'],
    cylinder: ['اسطوانه', 'سلندر', 'cylinder'],
    steam: ['تبخير', 'بخار'],
    manifold: ['منفول', 'مانفول', 'مانيفول', 'manifold'],
    water: ['مياه', 'مايه', 'water', 'coolant'],
    power_steering: ['باور'],
    lamp: ['فانوس', 'كشاف', 'lamp', 'headlight', 'taillight'],
    mirror: ['مرايه', 'مراه', 'mirror'],
};

/* ── Axes: one product per value ─────────────────────────────────────────────────── */

const AXES = {
    position: { front: ['امامي', 'امامى', 'اماميه', 'امام', 'front'], rear: ['خلفي', 'خلفى', 'خلفيه', 'rear', 'back'] },
    vertical: { upper: ['علوي', 'علوى', 'علويه', 'فوقاني', 'upper', 'top'], lower: ['سفلي', 'سفلى', 'سفليه', 'تحتاني', 'lower', 'bottom'] },
    side: { right: ['يمين', 'right'], left: ['شمال', 'يسار', 'left'] },
    depth: { inner: ['داخلي', 'داخلى', 'داخليه', 'inner', 'inside'], outer: ['خارجي', 'خارجى', 'خارجيه', 'outer', 'outside'] },
    flow: { supply: ['صاعد', 'upper hose'], return: ['راجع', 'return'] },
    size: { large: ['كبير', 'كبيره', 'large', 'big'], medium: ['وسط', 'medium'], small: ['صغير', 'صغيره', 'small', 'mini'] },
    width: { thin: ['رفيع', 'رفيعه', 'thin', 'narrow'], wide: ['عريض', 'عريضه', 'تخين', 'wide', 'thick'] },
    transmission: { automatic: ['اوتوماتيك', 'automatic'], manual: ['مانيوال', 'مانول', 'عاده', 'manual'] },
    fuel_kind: { petrol: ['بنزين', 'petrol', 'gasoline'], diesel: ['ديزل', 'سولار', 'diesel'] },
    // What the part carries or cleans: a fuel pump is not a water pump, an oil filter not an
    // air filter, a power-steering belt not an AC belt.
    fluid: {
        fuel: ['بنزين', 'سولار', 'ديزل', 'وقود', 'fuel'], water: ['مياه', 'مايه', 'water', 'coolant'],
        oil: ['زيت', 'oil'], air: ['هواء', 'هوا', 'air'], cabin: ['تكييف', 'تكيف', 'كابينه', 'cabin'],
        power_steering: ['باور', 'power'],
    },
    finish: { fine: ['ناعم', 'fine'], coarse: ['خشن', 'coarse'] },
};

/* ── Units ───────────────────────────────────────────────────────────────────────── */

const UNITS = {
    ml: ['مل', 'ملي', 'مللي', 'ml'], l: ['لتر', 'l', 'liter', 'litre', 'ltr'],
    w: ['وات', 'واط', 'w', 'watt'], v: ['فولت', 'v', 'volt'], a: ['امبير', 'a', 'amp'], ah: ['ah'],
    inch: ['بوصه', 'inch', 'in'], mm: ['مم', 'mm'], cm: ['سم', 'cm'], kg: ['كجم', 'كيلو', 'kg'], g: ['جم', 'جرام', 'g', 'gm'],
    cc: ['cc', 'سي'], pcs: ['قطعه', 'قطع', 'pcs', 'pieces', 'pc'], bar: ['بار', 'bar'], nm: ['نيوتن', 'nm'],
    km: ['كم', 'km'],
};
const TO_BASE = { l: ['ml', 1000], kg: ['g', 1000], cm: ['mm', 10] };

/* ── Words that say nothing about which product it is ────────────────────────────── */

const STOP = new Set(words([
    'من ل في على علي الى الي مع و او ب عن الخاص خاص جديد اصلي اصليه original genuine new for with and the of to in by',
    'سياره سيارة السياره سيارات للسيارات للسياره منتج car cars auto vehicle قطعه غيار part parts',
    'عالي الجوده جوده high quality premium فاخر ممتاز طقم set kit عدد',
    'لون اسود ابيض احمر ازرق فضي ذهبي black white red blue silver gold',
].join(' ')));

const lookup = (table) => {
    const map = new Map();
    for (const [key, list] of Object.entries(table)) for (const w of list) map.set(words(w).join(' '), key);
    return map;
};
const PART_OF = lookup(PART_CONCEPTS);
const UNIT_OF = lookup(UNITS);
// One word can say several things: "بنزين" is petrol (not diesel) and fuel (not water).
const AXIS_OF = new Map();
for (const [axis, values] of Object.entries(AXES)) {
    for (const [value, list] of Object.entries(values)) {
        for (const w of list) {
            const k = words(w).join(' ');
            AXIS_OF.set(k, [...(AXIS_OF.get(k) || []), [axis, value]]);
        }
    }
}

const BULB_SOCKETS = new Set(['h1', 'h3', 'h4', 'h7', 'h8', 'h9', 'h11', 'h13', 'h15', 'h16', 'h27', '880', '881', '9003', '9004', '9005', '9006', '9007', '9008', '9012', 'd1s', 'd2s', 'd3s', 'd4s', 'd2r', 't10', 't15', 't20', 'p21w', 'w5w']);

// Letters as vendors write them: "حرف تي" is "حرف T".
const LETTER = {
    t: 't', 'تي': 't', 'ت': 't', l: 'l', 'ال': 'l', 'ل': 'l', u: 'u', 'يو': 'u', i: 'i', 'ا': 'i', 'اي': 'i',
    s: 's', 'اس': 's', h: 'h', 'اتش': 'h', y: 'y', 'واي': 'y', j: 'j', 'جي': 'j', z: 'z', 'زد': 'z',
};

const YEAR = /^(19[5-9]\d|20[0-3]\d)$/;
const CODE_SHAPE = /^(?=.*\d)[a-z0-9]{4,}$/;

// Number-and-unit words are sizes, not codes: "500ml", "150w", "12v", "2.4a".
const MEASURE_TOKEN = /^\d+(\.\d+)?(ml|l|ltr|w|v|a|ah|mah|mm|cm|kg|g|gm|cc|nm|bar|pcs|pc|in|inch|hp|km|m|x|k|gb|tb|mb|hz|rpm|fps|p)$/;
// A count glued to a word ("2-piece", "4in1", "1280x720") is not a part number either.
const COUNT_WORD = /^\d+([a-z]{3,}|in\d+|x\d+)$/;
// Engine-oil grades: "20W50", "5W-30".
const VISCOSITY = /^\d{1,2}w-?\d{2}$/;
// A store's own row id, not a maker's number (CGS: "Z5BE2E78C4E2108636EA9Z").
const SKU_LIKE = /^z[0-9a-f]{12,}z$/;
const YEAR_RANGE = /^(19|20)\d\d[-/.](19|20)\d\d$/;

/**
 * The maker's numbers in a text: whole words that carry digits ("28113-26000", "CBM-36",
 * "D293", "5PK865"), and the spaced forms makers print ("F 5969", "0 986 452 041").
 * Not codes: years and year ranges, sizes, oil grades, store row ids, and the car codes the
 * vehicle reader already took ("W204", "N16", "ix35").
 *
 * @param fromField  the text is a part-number field: shorter codes count ("151", AGO's)
 */
const codeTokens = (text, { carWords = new Set(), fromField = false } = {}) => {
    const out = new Set();
    const raw = String(text || '');
    for (const m of raw.matchAll(/(^|[^A-Za-z0-9])([A-Za-z]{1,2}) (\d{3,6})(?![A-Za-z0-9])/g)) {
        const c = `${m[2]}${m[3]}`.toLowerCase();
        if (!YEAR.test(m[3]) && !carWords.has(m[2].toLowerCase())) out.add(c);
    }
    for (const m of raw.matchAll(/(^|[^0-9])(\d{1,4}(?: \d{3}){2,})(?![0-9])/g)) out.add(m[2].replace(/ /g, ''));
    const pieces = fromField ? fold(raw).split(/\s+-\s+|[\s/\\,+|]+/) : fold(raw).split(/\s+/);
    for (const piece of pieces) {
        const t = piece.replace(/^[-./+]+|[-./+]+$/g, '');
        if (!t || YEAR_RANGE.test(t) || VISCOSITY.test(t) || /^\d+(\.\d+)?$/.test(t) && !fromField) continue;
        const c = t.replace(/[-./+]/g, '');
        if (!/\d/.test(c) || !/^[a-z0-9]+$/.test(c)) continue;
        if (YEAR.test(c) || MEASURE_TOKEN.test(c) || (!fromField && COUNT_WORD.test(c)) || SKU_LIKE.test(c) || carWords.has(c)) continue;
        if (c.length < (fromField ? 3 : 4)) continue;
        // A bare number in a title is a size or a count far more often than a part number.
        if (!fromField && /^\d+$/.test(c) && c.length < 6) continue;
        out.add(c);
    }
    return out;
};

/** Leading zeros dropped and added back: the vendor's "580454140" is Bosch's "0580454140". */
const codeVariants = (code) => {
    const out = new Set([code]);
    if (/^\d+$/.test(code)) { out.add(code.replace(/^0+/, '')); out.add(`0${code}`); }
    return out;
};

/**
 * How two sets of codes relate:
 *   same       a code in common
 *   variant    one is the other plus a letter or two ("D303" / "D303B": a scent of one polish)
 *   different  both have codes, none related
 *   unknown    one side has none
 */
const relateCodes = (a, b) => {
    if (!a.size || !b.size) return { relation: 'unknown' };
    for (const x of a) if (b.has(x)) return { relation: 'same', code: x };
    for (const x of a) {
        for (const y of b) {
            const [short, long] = x.length <= y.length ? [x, y] : [y, x];
            if (short.length >= 3 && /\d/.test(short) && long.startsWith(short) && /^[a-z]{1,2}$/.test(long.slice(short.length))) return { relation: 'variant', code: short };
        }
    }
    return { relation: 'different' };
};

const createIdentityReader = ({ reader, brands = [] }) => {
    // Brands by every way they are written. Only multi-letter names: "a", "g" are not brands.
    const brandWords = new Map();
    for (const b of brands) {
        const name = words(b.name).join(' ');
        if (name.length >= 3) brandWords.set(name, String(b._id));
        const squashed = name.replace(/ /g, '');
        if (squashed.length >= 3) brandWords.set(squashed, String(b._id));
    }
    const BRAND_AR = { 'بوش': 'bosch', 'دنسو': 'denso', 'كاسترول': 'castrol', 'موبيل': 'mobil 1', 'شل': 'shell', 'توتال': 'total', 'ام توب': 'emtop', 'انجكو': 'ingco' };
    const brandNameToId = new Map(brands.map((b) => [words(b.name).join(' '), String(b._id)]));
    const brandIdToName = new Map(brands.map((b) => [String(b._id), words(b.name).join(' ')]));
    // A maker named by the first word of its name: "AGO" is "ago parts pro", "CPC" is "cpc oils".
    // Only when no other brand starts with that word, and no brand is that word exactly
    // ("total" is the oil, not "total tools").
    const firstWordCount = new Map();
    for (const name of brandNameToId.keys()) firstWordCount.set(name.split(' ')[0], (firstWordCount.get(name.split(' ')[0]) || 0) + 1);
    const resolveBrandName = (name) => {
        if (!name) return null;
        if (brandNameToId.has(name)) return brandNameToId.get(name);
        if (brandWords.has(name.replace(/ /g, ''))) return brandWords.get(name.replace(/ /g, ''));
        if (!name.includes(' ') && firstWordCount.get(name) === 1) {
            for (const [full, id] of brandNameToId) if (full.split(' ')[0] === name) return id;
        }
        return null;
    };

    /**
     * The brand an Arabic title names: "… - GSP" at its end, or "من DTR". Only a Latin word or
     * two with no digits counts — "– 2-Piece Set" and "– Black" are not makers.
     */
    const NOT_BRAND = new Set(words('set pack piece pieces black white red blue silver gold new original large small medium pro max plus multicolor'));
    const titleBrand = (title) => {
        const t = String(title || '');
        const tail = t.match(/\s[-–]\s*([A-Za-z][A-Za-z.\- ]{1,24})\s*$/);
        const pick = (raw) => {
            const w = words(raw);
            return w.length && w.length <= 3 && !w.some((x) => NOT_BRAND.has(x) || /\d/.test(x)) ? w.join(' ') : null;
        };
        if (tail && pick(tail[1])) return pick(tail[1]);
        const by = fold(t).match(/(?:^|\s)(?:من|by)\s+([a-z][a-z\-]{1,20})(?:\s|$)/);
        if (by && pick(by[1])) return pick(by[1]);
        return null;
    };

    const brandOf = (doc, ws) => {
        const field = doc.product_brand_id?._id || doc.product_brand_id;
        if (field) {
            const name = doc.product_brand_id?.name ? words(doc.product_brand_id.name).join(' ') : brandIdToName.get(String(field));
            // A car make as the brand ("Hyundai" genuine parts) is named, not looked up.
            if (doc.product_brand_source === 'CarBrand') return { id: null, name: name || null };
            return { id: String(field), name: name || null };
        }
        // "… - GSP" at the end of the Arabic title, or a Latin maker leading straight into
        // Arabic: "Mitzu سير كاتينه فيرنا", "DONGIL سير كاتينة", "GY كاوتش ميزان".
        const lead = [doc.title_ar, doc.title_en].map((t) => String(t || '').match(/^\s*([A-Za-z][A-Za-z.\-]{1,15}(?: [A-Za-z][A-Za-z.\-]{1,15})?)\s+[\u0600-\u06FF]/)).find(Boolean);
        const tail = titleBrand(doc.title_ar) || (lead && words(lead[1]).join(' '));
        if (tail && !NOT_BRAND.has(tail)) {
            const id = resolveBrandName(tail);
            return { id, name: id ? brandIdToName.get(id) : tail };
        }
        for (let n = 3; n >= 1; n -= 1) {
            for (let i = 0; i + n <= ws.length; i += 1) {
                const phrase = ws.slice(i, i + n).join(' ');
                const id = brandWords.get(phrase) || brandNameToId.get(BRAND_AR[phrase]);
                if (id) return { id, name: phrase };
            }
        }
        return { id: null, name: null };
    };

    /**
     * @param doc  a product or a catalog entry
     * @param options.cars  read cars from the text (default) — entries also carry them structured
     */
    const identify = (doc) => {
        const text = [doc.title_ar, doc.title_en, doc.subtitle_ar, doc.subtitle_en].filter(Boolean).join(' \n ');
        const ws = words(text);

        // Cars: from the text, and from the structured fitment when there is one.
        const { mentions } = reader.read([{ field: 'title_ar', text: doc.title_ar }, { field: 'title_en', text: doc.title_en }],
            { makes: (doc.compatible_cars || []).map((c) => c.brand_name) });
        const cars = new Set(mentions.filter((m) => m.model).map((m) => canonicalModelKey(m.make, m.model)));
        const carMakes = new Set(mentions.map((m) => fold(m.make)));
        // Makes named with no model of theirs ("اسبرانزا 510"): any of that make's models fits.
        const makeOnly = new Set(mentions.filter((m) => !m.model).map((m) => fold(m.make)));
        for (const c of doc.compatible_cars || []) {
            carMakes.add(fold(c.brand_name));
            for (const m of c.models || []) cars.add(canonicalModelKey(c.brand_name, m.model_name));
        }
        const carWords = new Set(mentions.flatMap((m) => words(m.written)));
        // Generations named per model: "لانسر بومة" and "لانسر شارك" are both Lancer, and not
        // the same Lancer.
        const carGens = new Map();
        for (const m of mentions) {
            if (!m.model || !m.gen) continue;
            const k = canonicalModelKey(m.make, m.model);
            if (!carGens.has(k)) carGens.set(k, new Set());
            carGens.get(k).add(fold(m.gen));
        }

        const parts = new Set();
        const axes = {};
        const measures = {};
        const add = (unit, value) => { (measures[unit] = measures[unit] || new Set()).add(value); };
        const rawTitle = `${doc.title_ar || ''} \n ${doc.title_en || ''}`;
        // 18" is 18 inches; "4+64" and "2GB RAM + 32GB" are a screen's memory.
        for (const m of rawTitle.matchAll(/(\d+(?:\.\d+)?)\s*(?:"|”|″|'')/g)) add('inch', Number(m[1]));
        for (const m of fold(rawTitle).matchAll(/(?:^|\s)(\d{1,2})\s*(?:gb)?\s*(?:ram)?\s*(?:\+|و|&)\s*(\d{2,3})\s*(?:gb)?(?=\s|$)/g)) add('memory', `${m[1]}+${m[2]}`);
        // Bulb sockets: H4, H7, 9005 … a list of them is one bulb that fits them all.
        const sockets = new Set(words(rawTitle).filter((w) => BULB_SOCKETS.has(w) && !carWords.has(w)));
        if (sockets.size) axes.socket = sockets;
        const grades = new Set();
        const modelNumbers = new Set();
        const rest = [];
        for (let i = 0; i < ws.length; i += 1) {
            const w = ws[i];
            // Engine oil: the grade and the API class say which oil it is.
            if (VISCOSITY.test(w)) { (measures.viscosity = measures.viscosity || new Set()).add(w.replace('-', '')); continue; }
            if (w === 'api') {
                while (/^(s[a-p]|c[a-k]|gl\d)$/.test(ws[i + 1] || '')) { grades.add(ws[i + 1]); i += 1; }
                continue;
            }
            // A short series name: "HX5" and "HX6" are two Shell oils, "D302" and "D303" two DTR polishes.
            if (/^[a-z]{1,3}\d{1,2}$/.test(w) && !carWords.has(w) && !BULB_SOCKETS.has(w)) modelNumbers.add(w);
            const two = i + 1 < ws.length ? `${w} ${ws[i + 1]}` : null;
            if (two && PART_OF.has(two)) { parts.add(PART_OF.get(two)); i += 1; continue; }
            // A number and its unit: "500 مل", "150 وات", "1600 cc".
            if (/^\d+(\.\d+)?$/.test(w) && ws[i + 1] && UNIT_OF.has(ws[i + 1])) {
                let unit = UNIT_OF.get(ws[i + 1]);
                let value = Number(w);
                if (TO_BASE[unit]) { value *= TO_BASE[unit][1]; unit = TO_BASE[unit][0]; }
                (measures[unit] = measures[unit] || new Set()).add(value);
                i += 1;
                continue;
            }
            const glued = w.match(/^(\d+(?:\.\d+)?)([a-z]+)$/);
            if (glued && UNIT_OF.has(glued[2])) {
                let unit = UNIT_OF.get(glued[2]);
                let value = Number(glued[1]);
                if (TO_BASE[unit]) { value *= TO_BASE[unit][1]; unit = TO_BASE[unit][0]; }
                (measures[unit] = measures[unit] || new Set()).add(value);
                continue;
            }
            // "حرف L" / "حرف T" / "حرف تي": the shape of a hose.
            if (w === 'حرف' && ws[i + 1] && LETTER[ws[i + 1]]) { axes.shape = new Set([LETTER[ws[i + 1]]]); i += 1; continue; }
            const bare = stripArticle(w);
            const axis = AXIS_OF.get(w) || AXIS_OF.get(bare);
            if (axis) {
                for (const [name, value] of axis) (axes[name] = axes[name] || new Set()).add(value);
                // "بنزين" is also what the part works on ("فلتر بنزين"): it stays a part word.
                if (PART_OF.has(w)) parts.add(PART_OF.get(w));
                continue;
            }
            if (PART_OF.has(w) || PART_OF.has(bare)) { parts.add(PART_OF.get(w) || PART_OF.get(bare)); continue; }
            if (STOP.has(w) || STOP.has(bare) || carWords.has(w) || YEAR.test(w) || BULB_SOCKETS.has(w)) continue;
            if (w.length < 2 && !/\d/.test(w)) continue;
            rest.push(isArabic(w[0]) ? bare : w);
        }
        // An axis with two values on one side ("يمين / شمال", "علوي وسفلي") is a pair: it
        // says nothing against either side. Sockets are a list, not a pair.
        for (const [axis, values] of Object.entries(axes)) if (values.size > 1 && axis !== 'socket') delete axes[axis];

        const codes = new Set();
        for (const field of [doc.part_number, doc.gtin]) {
            for (const c of codeTokens(field, { carWords, fromField: true })) for (const v of codeVariants(c)) codes.add(v);
        }
        for (const c of codeTokens(`${doc.title_ar || ''} \n ${doc.title_en || ''}`, { carWords })) for (const v of codeVariants(c)) codes.add(v);
        const pn = compactCode(doc.part_number);

        const brand = brandOf(doc, ws);
        const brandWordsSet = new Set(brand.name ? brand.name.split(' ') : []);
        const words_ = [...new Set(rest.filter((w) => !brandWordsSet.has(w) && !codes.has(w)))];

        // The years named per model, for telling generations apart ("سيفيك 2016" / "سيفيك 2025").
        const carYears = new Map();
        for (const m of mentions) {
            if (!m.model || !m.years.length) continue;
            const k = canonicalModelKey(m.make, m.model);
            if (!carYears.has(k)) carYears.set(k, []);
            carYears.get(k).push(...m.years);
        }

        return {
            vendor: String(doc.vendor_id?._id || doc.vendor_id || doc.created_by_vendor_id?._id || doc.created_by_vendor_id || ''),
            codes, part_number: pn && !SKU_LIKE.test(pn) ? pn : null, brand, cars, carGens, carYears, carMakes, makeOnly, parts, axes, measures, grades, modelNumbers,
            words: words_, universal: doc.is_universal !== false && !(doc.compatible_cars || []).length,
            category_id: String(doc.category_id?._id || doc.category_id || ''),
        };
    };

    return { identify };
};

module.exports = { createIdentityReader, relateCodes, PART_CONCEPTS, AXES, codeTokens };
