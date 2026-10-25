// The shape the vendor product form holds, in one place, so the from-scratch
// form and the catalog-prefilled condensed form always start from the same state.

export function blankProductForm() {
    return {
        title_en: '', title_ar: '',
        subtitle_en: '', subtitle_ar: '',
        description_en: '', description_ar: '',
        sku: '',
        part_number: '', gtin: '', status: 'draft',
        // Original / OEM / Aftermarket — required (lib/partType).
        part_type: '',
        price: '', discount_type: '', discount_value: '',
        category_id: '', product_brand_id: '',
        is_universal: true, for_girls: false, for_trunk: false, stock_management: true,
        stock_status: 'instock',
        quantity: 1,
        images: [],
        compatible_cars: [],
        variation_types: [],
        variants: [],
        weight: '',
        dimensions: { length: '', width: '', height: '' },
        shipping_class_id: '',
    };
}

/**
 * The filter metadata (categories, car brands, product brands) both forms need.
 *
 * `detail=full` because the compatibility builder lets a vendor tick models and years
 * across several makes at once, so it genuinely needs them all expanded. Every other
 * screen takes the slim default and fetches one make's models when it is picked.
 */
export async function fetchProductMetadata() {
    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
    const res = await fetch(`${base}/products/filters?detail=full`);
    if (!res.ok) throw new Error('Could not load product metadata');
    return res.json();
}
