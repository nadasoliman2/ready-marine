/**
 * The "Pending approval" review: the problems the server finds on a waiting product
 * (Backend services/productReviewService.js ISSUES), in words, and the category look-ups
 * the review's filters need.
 */

export const ISSUE_LABELS = {
    no_fitment: { ar: 'من غير توافق', en: 'No fitment' },
    fitment_mismatch: { ar: 'التوافق ناقص حسب العنوان', en: 'Fitment misses cars the title names' },
    no_title_ar: { ar: 'ناقصه عنوان عربي', en: 'No Arabic title' },
    no_title_en: { ar: 'ناقصه عنوان إنجليزي', en: 'No English title' },
    no_description: { ar: 'من غير وصف', en: 'No description' },
    no_category: { ar: 'من غير فئة', en: 'No category' },
    no_part_type: { ar: 'من غير نوع قطعة', en: 'No part type' },
    no_part_number: { ar: 'من غير رقم قطعة', en: 'No part number' },
    no_image: { ar: 'من غير صور', en: 'No images' },
    price_problem: { ar: 'السعر غلط', en: 'Price looks wrong' },
    price_outlier: { ar: 'السعر بعيد عن السوق', en: 'Price far from others' },
};

export const issueLabel = (code, isAr) => (ISSUE_LABELS[code] ? (isAr ? ISSUE_LABELS[code].ar : ISSUE_LABELS[code].en) : code);

/** Parent of every category id, from the nested tree the filters endpoint sends. */
export const categoryParents = (tree) => {
    const parents = new Map();
    const walk = (list, parent) => (list || []).forEach((c) => {
        parents.set(String(c._id), parent);
        walk(c.subcategories, String(c._id));
    });
    walk(tree, null);
    return parents;
};

/** Whether `categoryId` is `ancestorId` or under it. */
export const isUnder = (parents, categoryId, ancestorId) => {
    let current = categoryId ? String(categoryId) : null;
    for (let guard = 0; current && guard < 20; guard += 1) {
        if (current === String(ancestorId)) return true;
        current = parents.get(current) || null;
    }
    return false;
};

/** The categories of a product type: its assigned ones and everything under them. */
export const inType = (parents, categoryId, type) => (type?.category_ids || []).some((id) => isUnder(parents, categoryId, id));

/** The tree as one list with depth, for a <select>. */
export const flattenTree = (tree, level = 0, out = []) => {
    (tree || []).forEach((c) => {
        out.push({ _id: c._id, name: c.name, name_ar: c.name_ar, level });
        flattenTree(c.subcategories, level + 1, out);
    });
    return out;
};
