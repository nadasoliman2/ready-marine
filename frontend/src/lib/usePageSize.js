'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * How many rows a table shows, remembered per table.
 *
 * Remembered rather than reset each visit, because the choice is about the person and their
 * screen, not about the page: someone on a large monitor who wants 100 rows wants it on
 * every visit, and a control that forgets is one nobody uses twice.
 *
 * Scoped by `key` rather than shared, because the right number genuinely differs — 10 rows
 * of orders and 10 rows of categories are not the same amount of screen, and one global
 * setting would be wrong for most tables it touched.
 */

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const STORAGE_PREFIX = 'readycar.pageSize.';

export default function usePageSize(key, fallback = 10) {
    // Starts at the fallback on both server and first client render, then corrects from
    // storage in an effect. Reading storage during render would make the two disagree and
    // React would throw away the markup it just sent.
    const [pageSize, setSize] = useState(fallback);

    useEffect(() => {
        try {
            const saved = Number(window.localStorage.getItem(STORAGE_PREFIX + key));
            // Only a value we still offer. A number left behind by an older build, or edited
            // by hand, would otherwise be sent to the API as a limit nobody validated.
            if (PAGE_SIZE_OPTIONS.includes(saved)) setSize(saved);
        } catch {
            // Private mode, or storage disabled. The fallback is already correct.
        }
    }, [key]);

    const setPageSize = useCallback((next) => {
        const value = Number(next);
        if (!PAGE_SIZE_OPTIONS.includes(value)) return;
        setSize(value);
        try {
            window.localStorage.setItem(STORAGE_PREFIX + key, String(value));
        } catch {
            // Not being able to remember it must not stop it applying now.
        }
    }, [key]);

    return [pageSize, setPageSize];
}
