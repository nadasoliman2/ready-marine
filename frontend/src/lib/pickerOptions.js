/**
 * Options for SearchableSelect, built the same way on every screen that picks a car or a
 * brand: a car make answers to its Arabic name too and shows its logo; a product brand
 * shows its logo; models and years are plain. One place, so the lists look and search the
 * same across the site.
 */

/** Car makes (`/products/filters` carBrands). */
export const makeOptions = (makes) => (makes || []).map((b) => ({
  value: b._id,
  label: b.name,
  keywords: (b.name_aliases || []).join(' '),
  image: b.image || null,
}));

/** A make's models. */
export const modelOptions = (models) => (models || []).map((m) => ({ value: m._id, label: m.name }));

/** A model's years, in the list's order, as strings (what a <select> gave). */
export const yearOptions = (years) => (years || [])
  .map((y) => (typeof y === 'object' ? y.year : y))
  .map((y) => ({ value: String(y), label: String(y) }));

/** Product brands (hand-entered brands and car makes, `productBrands`). */
export const brandOptions = (brands) => (brands || []).map((b) => ({
  value: b._id,
  label: b.name,
  keywords: [b.name_ar, ...(b.name_aliases || [])].filter(Boolean).join(' '),
  image: b.image || b.logo || null,
}));
