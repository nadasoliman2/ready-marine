'use client';

import { useEffect, useMemo, useRef } from 'react';

/**
 * Brand and category filters that narrow each other — the client-side half of the rule the
 * catalog facets already apply on the server (`catalogService.applyBrandCategoryTags`).
 *
 * A brand carries the categories it makes things for (`brand.categories`). Two rules:
 *
 *   · A parent category stands for everything under it. A brand tagged "Brakes" fits every
 *     brake category, and also fits "Brakes" itself and the categories above it — a tree
 *     picker has to pass through the parents to reach the leaves.
 *   · An UNTAGGED brand fits everywhere. Tagging happens one brand at a time, and a filter
 *     that hid the thirty untagged brands would look broken, not strict.
 *
 * Everything here works on the nested `metadata.categories` tree (`subcategories`), which is
 * what every screen already holds, so no screen needs a new request.
 */

/** Flat lookup over the nested tree: each id's parent and its children. */
export function indexCategoryTree(categories = []) {
    const parentOf = new Map();
    const childrenOf = new Map();
    const walk = (nodes, parentId) => {
        for (const node of nodes || []) {
            const id = String(node._id);
            parentOf.set(id, parentId);
            childrenOf.set(id, (node.subcategories || []).map((c) => String(c._id)));
            walk(node.subcategories, id);
        }
    };
    walk(categories, null);
    return { parentOf, childrenOf };
}

/**
 * The set of category ids a brand fits, or null when the brand is untagged (fits all).
 * Tagged categories, everything under them, and everything above them.
 */
export function categoriesForBrand(brand, index) {
    const tags = (brand?.categories || []).map((c) => String(c?._id || c));
    if (!tags.length) return null;

    const allowed = new Set();
    const down = (id) => {
        if (allowed.has(id)) return;
        allowed.add(id);
        for (const child of index.childrenOf.get(id) || []) down(child);
    };
    const up = (id) => {
        let cur = index.parentOf.get(id);
        while (cur && !allowed.has(cur)) { allowed.add(cur); cur = index.parentOf.get(cur); }
    };
    for (const tag of tags) { down(tag); up(tag); }
    return allowed;
}

/** Does this brand fit this category? Untagged brands and "no category" always do. */
export function brandFitsCategory(brand, categoryId, index) {
    if (!categoryId) return true;
    const allowed = categoriesForBrand(brand, index);
    return !allowed || allowed.has(String(categoryId));
}

/** Only the brands that fit the chosen category (all of them when none is chosen). */
export function brandsForCategory(brands = [], categoryId, index) {
    if (!categoryId) return brands;
    return brands.filter((b) => brandFitsCategory(b, categoryId, index));
}

/** The nested tree with every node the brand does not fit cut out. */
export function pruneCategoryTree(categories = [], allowed) {
    if (!allowed) return categories;
    const prune = (nodes) => (nodes || [])
        .filter((n) => allowed.has(String(n._id)))
        .map((n) => ({ ...n, subcategories: prune(n.subcategories) }));
    return prune(categories);
}

/**
 * Wire a brand selection and a category selection together.
 *
 * Returns the two lists cut down to fit each other. When one selection changes and the
 * OTHER no longer fits, the other is cleared — only that one: the selection the user just
 * made is theirs.
 *
 * @param {object} args
 * @param {Array}  args.brands          metadata.productBrands
 * @param {Array}  args.categories      metadata.categories (nested tree)
 * @param {string} args.brandId
 * @param {string} args.categoryId
 * @param {(id: string) => void} args.setBrandId
 * @param {(id: string) => void} args.setCategoryId
 */
export function useLinkedBrandCategory({ brands = [], categories = [], brandId = '', categoryId = '', setBrandId, setCategoryId }) {
    const index = useMemo(() => indexCategoryTree(categories), [categories]);
    const brandRow = useMemo(
        () => (brands || []).find((b) => String(b._id) === String(brandId)) || null,
        [brands, brandId]
    );
    const allowedCategories = useMemo(() => (brandRow ? categoriesForBrand(brandRow, index) : null), [brandRow, index]);
    const visibleCategories = useMemo(() => pruneCategoryTree(categories, allowedCategories), [categories, allowedCategories]);
    const visibleBrands = useMemo(() => brandsForCategory(brands, categoryId, index), [brands, categoryId, index]);

    const setters = useRef({ setBrandId, setCategoryId });
    setters.current = { setBrandId, setCategoryId };
    const previous = useRef({ brandId, categoryId });

    useEffect(() => {
        const touchedCategory = previous.current.categoryId !== categoryId;
        const touchedBrand = previous.current.brandId !== brandId;
        previous.current = { brandId, categoryId };
        // Nothing to reconcile until both lists exist.
        if (!brands?.length || !categories?.length) return;

        if (touchedCategory && !touchedBrand && brandId && brandRow && !brandFitsCategory(brandRow, categoryId, index)) {
            setters.current.setBrandId?.('');
        } else if (touchedBrand && !touchedCategory && categoryId && allowedCategories && !allowedCategories.has(String(categoryId))) {
            setters.current.setCategoryId?.('');
        }
    }, [brandId, categoryId, brandRow, allowedCategories, index, brands?.length, categories?.length]);

    return { brands: visibleBrands, categories: visibleCategories, allowedCategoryIds: allowedCategories };
}
