// The fitment check's findings in words (Backend services/matching/fitmentCheck.js), and the
// changes each one proposes, in the shape the apply endpoint takes.

import { L } from './catalog';

export const FINDING_TYPES = {
    universal_but_named: { en: 'Marked for every car, title names one', ar: 'متسجل لأي عربية والعنوان بيحدد عربية' },
    missing_car: { en: 'Car named, not in the fitment', ar: 'عربية مذكورة ومش متسجلة' },
    model_without_years: { en: 'Model with no years', ar: 'موديل من غير سنين' },
    years_not_covered: { en: 'Years named, not in the fitment', ar: 'سنين مذكورة ومش متسجلة' },
    years_narrower: { en: 'Title gives years, fitment says all', ar: 'العنوان بيحدد سنين والتوافق لكل السنين' },
    generation_only: { en: 'Title names a generation', ar: 'العنوان بيحدد جيل' },
    not_in_text: { en: 'In the fitment, not in the title', ar: 'في التوافق ومش في العنوان' },
};

export const findingTypeLabel = (type, lang) => (FINDING_TYPES[type] ? L(lang, FINDING_TYPES[type].en, FINDING_TYPES[type].ar) : type);

export const SEVERITY = {
    high: { en: 'Sure', ar: 'أكيد', cls: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20' },
    medium: { en: 'Likely', ar: 'غالباً', cls: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20' },
    low: { en: 'Worth a look', ar: 'يستاهل نظرة', cls: 'bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-500/20' },
    info: { en: 'Note', ar: 'ملاحظة', cls: 'bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-white/10' },
};

/** "Mitsubishi Lancer" — the make alone when no model was named. */
export const carName = (car) => [car.make, car.model].filter(Boolean).join(' ');

/** "2008–2015" / "كل السنين". */
export const yearsText = (car, lang) => {
    if (!car.model_id) return L(lang, 'make only', 'الماركة بس');
    if (car.all_years || !(car.years || []).length) return L(lang, 'all years', 'كل السنين');
    const ys = car.years;
    return ys.length > 2 && ys[ys.length - 1] - ys[0] === ys.length - 1 ? `${ys[0]}–${ys[ys.length - 1]}` : ys.join('، ');
};

/** What the vendor wrote, and the market name behind it: «شارك» (جيل من Lancer). */
const writtenNote = (car, lang) => {
    const parts = [];
    if (car.written) parts.push(L(lang, `written “${car.written}”`, `مكتوبة «${car.written}»`));
    if ((car.gens || []).length) parts.push(L(lang, `market name: ${car.gens.join(', ')}`, `اسمها في السوق: ${car.gens.join('، ')}`));
    if (car.typo) parts.push(L(lang, `a misspelt “${car.typo}”`, `غلطة إملائية في «${car.typo}»`));
    return parts.length ? ` (${parts.join(' — ')})` : '';
};

/** One finding as a sentence. */
export const findingText = (f, lang) => {
    switch (f.type) {
        case 'universal_but_named':
            return L(lang,
                `Marked as fitting every car, but the title names: ${f.cars.map((c) => carName(c) + writtenNote(c, lang)).join(', ')}.`,
                `المنتج متسجل إنه يركب على أي عربية، بس العنوان بيذكر: ${f.cars.map((c) => carName(c) + writtenNote(c, lang)).join('، ')}.`);
        case 'missing_car':
            return L(lang,
                `The ${f.source === 'title' ? 'title' : 'description'} names ${carName(f.car)}${writtenNote(f.car, lang)}, and the fitment does not have it.`,
                `${f.source === 'title' ? 'العنوان' : 'الوصف'} بيذكر ${carName(f.car)}${writtenNote(f.car, lang)}، ومش متسجلة في التوافق.`);
        case 'model_without_years':
            return L(lang,
                `${carName(f.car)} is ticked with no year — a customer searching by their car's year never sees this product.`,
                `${carName(f.car)} متسجلة من غير أي سنة — العميل اللي بيدور بسنة عربيته مش هيلاقي المنتج.`);
        case 'years_not_covered':
            return L(lang,
                `The title gives ${f.car.years_label} for ${carName(f.car)}; the fitment leaves out ${(f.uncovered || []).join(', ')}.`,
                `العنوان بيذكر ${f.car.years_label} لـ ${carName(f.car)}، والتوافق ناقصه ${(f.uncovered || []).join('، ')}.`);
        case 'years_narrower':
            return L(lang,
                `The title limits ${carName(f.car)} to ${f.car.years_label}${writtenNote(f.car, lang)}; the fitment says every year.`,
                `العنوان بيحدد ${carName(f.car)} بـ ${f.car.years_label}${writtenNote(f.car, lang)}، والتوافق مسجلها لكل السنين.`);
        case 'generation_only':
            return L(lang,
                `The title names one generation of ${carName(f.car)} (${f.car.gens.join(', ')}); the fitment covers every year. Check which years it is.`,
                `العنوان بيحدد جيل معين من ${carName(f.car)} (${f.car.gens.join('، ')})، والتوافق متسجل لكل السنين — اتأكد من السنين.`);
        case 'not_in_text':
            return L(lang,
                `${carName(f.car)} is in the fitment, but the title and description never name it.`,
                `${carName(f.car)} موجودة في التوافق، بس العنوان والوصف مش بيذكروها — راجعها.`);
        default:
            return f.type;
    }
};

/**
 * The changes a finding proposes, each with a key, a label and whether it is ticked by default.
 * Sure findings are ticked; "worth a look" ones wait for the admin.
 */
export const proposedChanges = (f, lang) => {
    const tick = f.severity === 'high' || f.severity === 'medium';
    const one = (car, verb) => (car.make_id ? [{
        key: `${f.type}:${car.make_id}:${car.model_id || ''}`,
        change: { make_id: car.make_id, model_id: car.model_id || null, years: car.years || [], all_years: !!car.all_years },
        canAllYears: !!car.model_id && !car.all_years && (car.years || []).length > 0,
        label: `${verb} ${carName(car)} — ${yearsText(car, lang)}`,
        checked: tick,
    }] : []);
    switch (f.type) {
        case 'universal_but_named': return f.cars.flatMap((c) => one(c, L(lang, 'Fits only', 'يركب على')));
        case 'missing_car': return one(f.car, L(lang, 'Add', 'أضف'));
        case 'model_without_years': return one(f.car, L(lang, 'Set', 'سجّل'));
        case 'years_not_covered':
        case 'years_narrower': return one(f.car, L(lang, 'Set years:', 'سجّل السنين:'));
        default: return [];
    }
};
