/**
 * What kind of part a product is — mirrors Backend/services/shared/partType.js.
 * Required on every product form and bulk upload.
 */
export const PART_TYPES = [
    { value: 'original', en: 'Original', ar: 'أصلي', hint_en: "The manufacturer's genuine part", hint_ar: 'قطعة الشركة المصنّعة الأصلية للقارب أو المحرك' },
    { value: 'oem', en: 'OEM', ar: 'OEM', hint_en: "By the manufacturer's supplier, same spec", hint_ar: 'من مورّد المصنّع بنفس المواصفات' },
    { value: 'aftermarket', en: 'Aftermarket', ar: 'تجاري', hint_en: 'A compatible aftermarket part made to fit', hint_ar: 'قطعة بديلة متوافقة تركب على القارب أو المحرك' },
];

export const partTypeLabel = (value, isAr) => {
    const t = PART_TYPES.find((p) => p.value === value);
    return t ? (isAr ? t.ar : t.en) : '';
};

export const partTypeRequiredText = (isAr) => (isAr
    ? 'اختار نوع القطعة: أصلي أو OEM أو تجاري.'
    : 'Choose the part type: Original, OEM or Aftermarket.');
