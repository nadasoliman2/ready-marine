'use client';

import { useCallback, useEffect, useState } from 'react';
import { myCompanyApi } from '../../lib/api';
import { useApp } from '../../context/AppContext';

/**
 * The signed-in customer's company memberships, shared by every component that
 * shows them (the header badge, the "My company" tab, the portal guard, checkout).
 * A person may belong to several companies: `memberships` lists them all and
 * `membership` is the first, for screens that show one.
 *
 * One request per user per page load: the promise is cached at module level
 * and handed to whoever asks. `refreshMyCompany()` re-reads it and pushes the
 * new value to every mounted component — after an order on the company account
 * the header's "X left" must move without a page reload.
 */
let cache = { userId: null, promise: null };
const listeners = new Set();

const load = (userId, force = false) => {
    if (force || cache.userId !== userId || !cache.promise) {
        const promise = myCompanyApi.get()
            .then((res) => ({ membership: res?.membership || null, memberships: res?.memberships || (res?.membership ? [res.membership] : []) }))
            .catch(() => {
                // A failed read (an expired session, a blip) is not remembered: the next
                // screen that asks — after signing in again — reads it afresh.
                if (cache.promise === promise) cache = { userId: null, promise: null };
                return { membership: null, memberships: [] };
            });
        cache = { userId, promise };
    }
    return cache.promise;
};

export function invalidateMyCompany() {
    cache = { userId: null, promise: null };
}

/** Re-read the memberships and update every component showing them. */
export async function refreshMyCompany() {
    if (!cache.userId) return null;
    const data = await load(cache.userId, true);
    listeners.forEach((notify) => notify(data));
    return data.membership;
}

export default function useMyCompany() {
    const { user, isMounted } = useApp();
    // Only a cache key: the server decides whose membership comes back.
    const userId = user?.role === 'user' ? String(user.id || user._id || user.email || user.phone || 'me') : '';
    const [data, setData] = useState({ membership: null, memberships: [] });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isMounted) return undefined;
        if (!userId) {
            setData({ membership: null, memberships: [] });
            setLoading(false);
            return undefined;
        }
        let cancelled = false;
        setLoading(true);
        load(userId).then((d) => {
            if (!cancelled) {
                setData(d);
                setLoading(false);
            }
        });
        const notify = (d) => { if (!cancelled) setData(d); };
        listeners.add(notify);
        return () => {
            cancelled = true;
            listeners.delete(notify);
        };
    }, [isMounted, userId]);

    const refresh = useCallback(async () => {
        if (!userId) return null;
        return refreshMyCompany();
    }, [userId]);

    return { membership: data.membership, memberships: data.memberships, loading, refresh };
}
