'use client';

/**
 * Who the signed-in admin is, and which dashboard modules they may open.
 *
 * READ FROM THE SERVER, ALWAYS. `AppContext` keeps a copy of the logged-in user in
 * localStorage, which is fine for "show me a name" and useless for permissions — anyone can
 * edit localStorage. So this provider asks `GET /admin/me` on mount and believes only that.
 *
 * And to be clear about what this file is and is not: it decides what the sidebar SHOWS. It
 * is not the security boundary. Every admin route is refused server-side by
 * `services/adminAccessService.js` whatever the browser thinks — hiding a link is a courtesy
 * to the user, not a lock on the door.
 */

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { SESSION_ENDED_EVENT } from '../lib/api';

const AdminAccessContext = createContext(null);

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export function AdminAccessProvider({ children }) {
    const [state, setState] = useState({
        loading: true,
        error: '',
        isSuper: false,
        username: '',
        name: '',
        permissions: [],
        modules: [],
    });

    const load = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/admin/me`, { credentials: 'include' });
            // The admin session is over (expired, or the account was turned off): AppContext
            // signs out and opens the admin login instead of an empty dashboard.
            if (res.status === 401) window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
            if (!res.ok) throw new Error('Not signed in');
            const data = await res.json();
            setState({
                loading: false,
                error: '',
                isSuper: !!data.admin?.is_super,
                username: data.admin?.username || '',
                name: data.admin?.name || '',
                permissions: data.admin?.permissions || [],
                modules: data.modules || [],
            });
        } catch (err) {
            // Failing closed here too: an admin we could not identify sees an empty sidebar
            // rather than the full one.
            setState((s) => ({ ...s, loading: false, error: err.message || 'Failed to load permissions' }));
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const value = useMemo(() => {
        const byModule = new Map((state.permissions || []).map((p) => [p.module, p.access]));
        return {
            ...state,
            reload: load,
            /**
             * @param moduleKey the module to test
             * @param level     'view' (default) or 'manage'
             */
            can(moduleKey, level = 'view') {
                if (state.isSuper) return true;
                const access = byModule.get(moduleKey);
                if (!access) return false;
                return level === 'view' ? true : access === 'manage';
            },
        };
    }, [state, load]);

    return <AdminAccessContext.Provider value={value}>{children}</AdminAccessContext.Provider>;
}

export function useAdminAccess() {
    const ctx = useContext(AdminAccessContext);
    if (!ctx) {
        // A page rendered outside the dashboard layout has no provider. Returning a
        // deny-everything shape keeps it from crashing and from showing anything.
        return {
            loading: false, error: '', isSuper: false, username: '', name: '',
            permissions: [], modules: [], reload: () => {}, can: () => false,
        };
    }
    return ctx;
}
