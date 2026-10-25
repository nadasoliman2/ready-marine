'use client';

import { useEffect, useRef, useState } from 'react';

const STORAGE_PREFIX = 'readycar.filters.';

/**
 * A list's search and filters, kept while the tab is open: opening a row and coming back
 * finds the list as it was left, not reset.
 *
 * `snapshot` is what to remember (a plain object of the page's filter states); `restore` is
 * called once, on arrival, with what was remembered last time. Returns `ready`: false until
 * that has happened, so the page can hold its first request instead of asking for the
 * unfiltered list and then again for the filtered one.
 *
 * Restored in an effect, not during render, for the reason usePageSize gives: the server
 * and the first client render must agree.
 */
export default function useStoredFilters(key, snapshot, restore) {
    const [ready, setReady] = useState(false);
    const restoreRef = useRef(restore);
    restoreRef.current = restore;

    useEffect(() => {
        try {
            const saved = JSON.parse(window.sessionStorage.getItem(STORAGE_PREFIX + key) || 'null');
            if (saved && typeof saved === 'object') restoreRef.current(saved);
        } catch {
            // Private mode, or something unreadable left behind. The empty filters are correct.
        }
        setReady(true);
    }, [key]);

    const serialized = JSON.stringify(snapshot);
    useEffect(() => {
        if (!ready) return;
        try {
            window.sessionStorage.setItem(STORAGE_PREFIX + key, serialized);
        } catch {
            // Not being able to remember them must not stop the filters working now.
        }
    }, [ready, key, serialized]);

    return ready;
}
