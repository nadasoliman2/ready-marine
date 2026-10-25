/**
 * What kind of part a product is — mirrors Backend/services/shared/partType.js.
 * Required on every product form and bulk upload.
 */
export const PART_TYPES = [
    { value: 'original', en: 'Original', ar: 'أصلي', hint_en: "The car maker's own part", hint_ar: 'قطعة الشركة المصنّعة للعربية' },
    { value: 'oem', en: 'OEM', ar: 'OEM', hint_en: "By the maker's supplier, same spec", hint_ar: 'من مورّد المصنّع بنفس المواصفات' },
    { value: 'aftermarket', en: 'Aftermarket', ar: 'تجاري', hint_en: 'A third-party part made to fit', hint_ar: 'قطعة من شركة تانية بتركب على العربية' },
];

export const partTypeLabel = (value, isAr) => {
    const t = PART_TYPES.find((p) => p.value === value);
    return t ? (isAr ? t.ar : t.en) : '';
};

export const partTypeRequiredText = (isAr) => (isAr
    ? 'اختار نوع القطعة: أصلي أو OEM أو تجاري.'
    : 'Choose the part type: Original, OEM or Aftermarket.');
