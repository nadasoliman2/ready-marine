// Helpers shared by every screen that touches the master catalog.
//
// The vendor never sees the link itself — no badge on their product list, no
// "unlink" button. What they see is the catalog *before* the product exists:
// the search gate, the summary card on the condensed form, the picker popup.
// Everything here serves those three, plus the admin catalog screens.

export const L = (lang, en, ar) => (lang === 'ar' ? ar : en);

/** The entry's title in the reader's language, falling back to the other one. */
export function entryTitle(entry, lang) {
    if (!entry) return '';
    return (lang === 'ar'
        ? (entry.title_ar || entry.title_en)
        : (entry.title_en || entry.title_ar)) || '';
}

export function entrySubtitle(entry, lang) {
    if (!entry) return '';
    return (lang === 'ar'
        ? (entry.subtitle_ar || entry.subtitle_en)
        : (entry.subtitle_en || entry.subtitle_ar)) || '';
}

/** Primary image URL, or the first one, or null. */
export function entryImage(entry) {
    const images = entry?.images || [];
    if (!images.length) return null;
    return (images.find((img) => img.is_primary) || images[0])?.url || null;
}

export function entryCategoryName(entry, lang) {
    const category = entry?.category_id;
    if (!category || typeof category !== 'object') return '';
    return (lang === 'ar' ? (category.name_ar || category.name) : category.name) || '';
}

export function entryBrandName(entry) {
    const brand = entry?.product_brand_id;
    if (!brand || typeof brand !== 'object') return '';
    return brand.name || '';
}

/**
 * The catalog-owned half of a product form, taken from an entry.
 *
 * Mirrors `buildPrefillFromEntry` on the server, because the vendor form is
 * filled here on the client the moment they pick an entry — the server sees the
 * finished payload, not the entry. Price, discount, stock, SKU and status are
 * absent on purpose: those belong to the vendor and start empty.
 */
export function entryToFormPatch(entry) {
    if (!entry) return {};
    const categoryId = entry.category_id?._id || entry.category_id || '';
    const brandId = entry.product_brand_id?._id || entry.product_brand_id || '';

    return {
        title_en: entry.title_en || '',
        title_ar: entry.title_ar || '',
        subtitle_en: entry.subtitle_en || '',
        subtitle_ar: entry.subtitle_ar || '',
        description_en: entry.description_en || '',
        description_ar: entry.description_ar || '',
        category_id: categoryId ? String(categoryId) : '',
        product_brand_id: brandId ? String(brandId) : '',
        part_number: entry.part_number || '',
        gtin: entry.gtin || '',
        images: (entry.images || []).map((img) => ({ url: img.url, is_primary: !!img.is_primary })),
        is_universal: entry.is_universal !== false,
        compatible_cars: JSON.parse(JSON.stringify(entry.compatible_cars || [])),
        // Variation *shapes* come from the catalog; the price and stock behind
        // each combination are the vendor's, so no variants are pre-created.
        variation_types: (entry.variation_types || []).map((vt) => ({
            name: vt.name,
            options: (vt.options || []).map((o) => ({ value: o.value })),
        })),
    };
}
