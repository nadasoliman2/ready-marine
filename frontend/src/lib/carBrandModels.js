'use client';

import { useEffect, useMemo, useState } from 'react';

/**
 * A car make's models and years, fetched when someone picks that make.
 *
 * The shared filters payload used to carry every make expanded — 115 makes, 3,439 models,
 * 111,438 model-years, 1.9MB of JSON — and the home page, the shop filters and the garage
 * all downloaded and parsed the lot to draw a list of make names. They now get the makes
 * alone and ask for one make's models here, which is a few kilobytes.
 *
 * Cached per make for the life of the page, and shared between components, so picking the
 * same make twice (or on two screens) is one request. The browser caches it for five
 * minutes on top of that.
 */
const cache = new Map(); // brandId -> Promise<models[]>
const NO_MODELS = [];

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

/**
 * Named models first, numbered ones after: Renault lists Alaskan, Arkana, Austral … and
 * then 5, 6, 7, 8, 9, rather than opening on a column of digits. Each group is in natural
 * order, so 9 comes before 11 and "E-Tech 5" sits among the E's.
 */
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const isNumbered = (model) => /^\d/.test(String(model?.name || '').trim());

export function sortModels(models) {
    return [...models].sort((a, b) =>
        isNumbered(a) - isNumbered(b) || collator.compare(String(a?.name || ''), String(b?.name || '')));
}

export function loadBrandModels(brandId) {
    if (!brandId) return Promise.resolve([]);
    const key = String(brandId);
    if (!cache.has(key)) {
        cache.set(key, fetch(`${API}/products/car-brands/${key}/models`)
            .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Could not load models'))))
            .then((data) => sortModels(data.models || []))
            // A failed fetch must not be cached as "this make has no models": drop it so the
            // next render tries again.
            .catch((err) => { cache.delete(key); throw err; }));
    }
    return cache.get(key);
}

/**
 * The models of the given make. Returns what the make already carries when the caller
 * happens to hold the full payload (the product forms do), so one hook serves both shapes.
 */
export function useBrandModels(brand) {
    const brandId = brand?._id ? String(brand._id) : '';
    const embedded = brand?.models;
    // The models are kept with the make they belong to: while another make's are on their
    // way, the answer is "none yet", never the previous make's list.
    const [loaded, setLoaded] = useState({ brandId: '', models: NO_MODELS });
    const sortedEmbedded = useMemo(() => (embedded?.length ? sortModels(embedded) : NO_MODELS), [embedded]);

    useEffect(() => {
        if (!brandId || embedded?.length) return undefined;
        let alive = true;
        loadBrandModels(brandId)
            .then((list) => { if (alive) setLoaded({ brandId, models: list }); })
            .catch(() => { if (alive) setLoaded({ brandId, models: NO_MODELS }); });
        return () => { alive = false; };
    }, [brandId, embedded]);

    if (!brandId) return NO_MODELS;
    if (embedded?.length) return sortedEmbedded;
    return loaded.brandId === brandId ? loaded.models : NO_MODELS;
}
