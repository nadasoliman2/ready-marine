'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Brand and category filter lists that narrow to fit each other.
 *
 * Every time either selection changes the lists are fetched again with the current pair,
 * so with a category chosen the brand list holds only brands that work in it, and with a
 * brand chosen the category list holds only what that brand makes.
 *
 * One rule decides what happens when the lists come back: the selection the user did NOT
 * just touch is checked against its new list, and dropped if it fell out. Only that one —
 * checking both would let a stale response for the touched list clear the very choice the
 * user just made. The one they touched is theirs; the other is adjusted to fit it.
 *
 * `load` is read through a ref so an inline arrow from a parent cannot restart the effect
 * on every render.
 *
 * @param {object} args
 * @param {(params: {category_id?: string, product_brand_id?: string}) => Promise<object>} args.load
 * @param {string} args.categoryId
 * @param {string} args.brandId
 * @param {(id: string) => void} args.setCategoryId
 * @param {(id: string) => void} args.setBrandId
 * @param {boolean} [args.enabled]
 * @param {*} [args.reloadKey]  anything else that should refetch the lists (a tab, a status)
 */
export default function useDependentFacets({
    load,
    categoryId,
    brandId,
    setCategoryId,
    setBrandId,
    enabled = true,
    reloadKey = null,
}) {
    const [facets, setFacets] = useState(null);
    const loadRef = useRef(load);
    loadRef.current = load;
    const settersRef = useRef({ setCategoryId, setBrandId });
    settersRef.current = { setCategoryId, setBrandId };
    const previous = useRef({ categoryId, brandId });

    useEffect(() => {
        if (!enabled) return undefined;

        const touched = previous.current.categoryId !== categoryId
            ? 'category'
            : previous.current.brandId !== brandId ? 'brand' : null;
        previous.current = { categoryId, brandId };

        let alive = true;
        loadRef.current({
            category_id: categoryId || undefined,
            product_brand_id: brandId || undefined,
        })
            .then((data) => {
                if (!alive) return;
                setFacets(data);
                const has = (list, id) => (list || []).some((row) => String(row._id) === String(id));
                if (touched === 'category' && brandId && !has(data?.brands, brandId)) {
                    settersRef.current.setBrandId('');
                }
                if (touched === 'brand' && categoryId && !has(data?.categories, categoryId)) {
                    settersRef.current.setCategoryId('');
                }
            })
            // The filters are a convenience. If their lists fail to load the screen they
            // sit on is untouched, so this stays silent rather than raising an error over
            // a working list.
            .catch(() => {});

        return () => { alive = false; };
    }, [enabled, categoryId, brandId, reloadKey]);

    return facets;
}
