// The catalog matcher's proposals in words (Backend services/matching/catalogMatcher.js):
// how sure a proposal is, why it was made, and — for a link under review — what contradicts it.

import { L } from './catalog';

export const MATCH_LEVELS = {
    strong: { ar: 'تطابق قوي', en: 'Strong match', cls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20' },
    likely: { ar: 'غالباً هو', en: 'Likely', cls: 'bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-500/20' },
    possible: { ar: 'محتمل', en: 'Possible', cls: 'bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-white/10' },
};

export const levelLabel = (level, lang) => (MATCH_LEVELS[level] ? L(lang, MATCH_LEVELS[level].en, MATCH_LEVELS[level].ar) : L(lang, 'Weak', 'ضعيف'));
export const levelClass = (level) => MATCH_LEVELS[level]?.cls || 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20';

/** "hyundai|verna" → "Hyundai Verna". */
export const carKeyName = (key) => String(key || '')
    .split('|')
    .filter(Boolean)
    .map((part) => part.replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(' ');

const PART_AR = {
    pads: 'تيل', shoes: 'قبقاب', shock: 'مساعد', cv_joint: 'كوبلن', belt: 'سير', timing: 'كاتينة', pump: 'طلمبة',
    spark_plug: 'بوجيهات', coil: 'بوبينة', filter: 'فلتر', alternator: 'دينامو', starter: 'مارش', radiator: 'ردياتير',
    elbow: 'كوعة', hose: 'خرطوم', bushing: 'جلبة', arm: 'مقص', ball_joint: 'بيضة', link: 'بارة', gasket: 'جوان',
    disc: 'ديسك', bearing: 'بلية', wiper: 'مساحات', freshener: 'معطر', polish: 'ملمع', cleaner: 'منظف', bulb: 'لمبة',
    screen: 'شاشة', camera: 'كاميرا', battery: 'بطارية', clutch: 'دبرياج', mat: 'فرش', sensor: 'حساس',
};

/** One reason a proposal was made, as a short phrase. */
export const reasonText = (reason, lang) => {
    const v = reason.value;
    switch (reason.key) {
        case 'code': return L(lang, `Same part number ${String(v).toUpperCase()}`, `نفس رقم القطعة ${String(v).toUpperCase()}`);
        case 'short_code': return L(lang, `Same short code ${v}`, `نفس الكود ${v}`);
        case 'code_variant': return L(lang, `Same base code ${String(v).toUpperCase()} (another variant)`, `نفس الكود الأساسي ${String(v).toUpperCase()} (نسخة تانية منه)`);
        case 'brand': return L(lang, `Same brand: ${v}`, `نفس الماركة: ${v}`);
        case 'cars': return L(lang, `Same car: ${(v || []).map(carKeyName).join('، ')}`, `نفس العربية: ${(v || []).map(carKeyName).join('، ')}`);
        case 'part': return L(lang, 'Same kind of part', `نفس نوع القطعة${(v || []).length ? ` (${(v || []).map((p) => PART_AR[p] || p).join(' ')})` : ''}`);
        case 'words': return L(lang, `Title ${Math.round(v * 100)}% alike`, `العنوان متشابه ${Math.round(v * 100)}%`);
        case 'category': return L(lang, 'Same category', 'نفس الفئة');
        case 'same_store': return L(lang, 'Same store — may be a duplicate listing', 'من نفس المتجر — ممكن يكون نفس المنتج متكرر');
        default: return reason.key;
    }
};

const AXIS_AR = {
    position: ['front / rear', 'أمامي / خلفي'], vertical: ['upper / lower', 'علوي / سفلي'], side: ['right / left', 'يمين / شمال'],
    depth: ['inner / outer', 'داخلي / خارجي'], flow: ['supply / return', 'صاعد / راجع'], size: ['size', 'كبير / وسط / صغير'],
    width: ['wide / thin', 'عريض / رفيع'], transmission: ['automatic / manual', 'أوتوماتيك / مانيوال'],
    fuel_kind: ['petrol / diesel', 'بنزين / ديزل'], fluid: ['what it carries (oil, water, air, fuel…)', 'نوعه (زيت، مياه، هواء، بنزين…)'],
    shape: ['shape (L / T …)', 'الشكل (حرف L / T …)'], socket: ['bulb type (H4, H7, 9005 …)', 'نوع اللمبة (H4، H7، 9005 …)'], finish: ['fine / coarse', 'ناعم / خشن'],
};
const UNIT_AR = {
    ml: ['volume', 'الحجم'], w: ['wattage', 'القدرة (وات)'], v: ['voltage', 'الفولت'], a: ['amperage', 'الأمبير'], ah: ['capacity', 'السعة'],
    inch: ['size (inches)', 'المقاس (بوصة)'], mm: ['size (mm)', 'المقاس (مم)'], g: ['weight', 'الوزن'], cc: ['engine size', 'سعة الموتور'],
    memory: ['memory', 'الذاكرة'], viscosity: ['oil grade', 'لزوجة الزيت'], km: ['service interval', 'عدد الكيلومترات'], pcs: ['count', 'العدد'],
};

/** What contradicts a link under review, as a short phrase. */
export const conflictText = (code, lang) => {
    if (code.startsWith('axis:')) {
        const [en, ar] = AXIS_AR[code.slice(5)] || [code.slice(5), code.slice(5)];
        return L(lang, `Different ${en}`, `${ar} مختلف`);
    }
    if (code.startsWith('measure:')) {
        const [en, ar] = UNIT_AR[code.slice(8)] || [code.slice(8), code.slice(8)];
        return L(lang, `Different ${en}`, `${ar} مختلف`);
    }
    const map = {
        brand: ['Another brand', 'ماركة مختلفة'],
        cars: ['Another car', 'عربية مختلفة'],
        generation: ['Another generation of the same car', 'جيل مختلف من نفس العربية'],
        code: ['Another part number', 'رقم قطعة مختلف'],
        part: ['Another kind of part', 'نوع قطعة مختلف'],
        grade: ['Another oil grade (API)', 'درجة زيت مختلفة (API)'],
        series: ['Another model in the range', 'موديل مختلف من نفس السلسلة'],
    };
    const [en, ar] = map[code] || [code, code];
    return L(lang, en, ar);
};
