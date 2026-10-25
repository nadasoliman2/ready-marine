'use client';

import { useEffect, useState } from 'react';
import { shippingApi } from '../lib/api';
import { useApp } from '../context/AppContext';

/* Module-level cache so multiple instances don't each hit /shipping/zones. */
let _zonesPromise = null;
function loadZones() {
    if (!_zonesPromise) {
        _zonesPromise = shippingApi.getZones().catch(() => ({ tree: [], config: {} }));
    }
    return _zonesPromise;
}
/** Call after a shipping-zone admin change if you need fresh data within the same session. */
export function invalidateZonesCache() { _zonesPromise = null; }

/**
 * Country + City/Region selector for address forms.
 *
 * Props:
 *  - country, city     : current values (strings; city '' = "anywhere in country")
 *  - onChange({country, city})
 *  - dark              : use dark-theme styling (dashboards / profile)
 *  - variant           : "light" | "dark" | "dashboard"
 *  - required          : marks fields required
 *  - className         : wrapper class
 *
 * Behavior:
 *  - no shipping zones configured  -> renders nothing
 *  - exactly one country           -> hides the country field, auto-fills it, shows only the city
 *  - multiple countries            -> country select + dependent city select
 */
export default function ShippingZoneSelect({ country = '', city = '', onChange, dark = false, variant, required = false, className = '' }) {
    const { language } = useApp();
    const isAr = language === 'ar';
    const [tree, setTree] = useState(null); // null = loading
    const styleVariant = variant || (dark ? 'dark' : 'light');

    useEffect(() => {
        let cancelled = false;
        loadZones().then((data) => { if (!cancelled) setTree(data?.tree || []); });
        return () => { cancelled = true; };
    }, []);

    const single = Array.isArray(tree) && tree.length === 1 ? tree[0] : null;

    // Auto-fill the country when there's only one.
    useEffect(() => {
        if (single && country !== single.country) {
            onChange?.({ country: single.country, city: city || '' });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [single?.country]);

    if (tree === null) return null;          // still loading
    if (tree.length === 0) return null;       // shipping disabled / no zones — nothing to ask

    const countryEntry = single || tree.find((z) => z.country === country) || null;

    const inputCls = styleVariant === 'dashboard'
        ? 'w-full bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-marine-cyan transition-colors dark:[color-scheme:dark]'
        : styleVariant === 'dark'
            ? 'w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-marine-cyan [color-scheme:dark]'
            : 'w-full px-4 py-3 rounded-lg border border-zinc-200 focus:border-marine-cyan focus:ring-2 focus:ring-marine-cyan/20 outline-none transition-all';
    const optionCls = 'bg-white text-zinc-900 dark:bg-[#18181b] dark:text-zinc-100';
    const labelCls = styleVariant === 'dashboard'
        ? 'block text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5'
        : styleVariant === 'dark'
            ? 'block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1.5'
            : 'text-xs font-semibold text-zinc-500 uppercase';

    return (
        <div className={`grid ${single ? 'grid-cols-1' : 'sm:grid-cols-2'} gap-4 ${className}`}>
            {!single && (
                <div className="space-y-1">
                    <label className={labelCls}>{isAr ? 'الدولة' : 'Country'} {required ? '*' : ''}</label>
                    <select
                        value={country || ''}
                        onChange={(e) => onChange?.({ country: e.target.value, city: '' })}
                        className={inputCls}
                        required={required}
                    >
                        <option className={optionCls} value="">{isAr ? '— اختر الدولة —' : '— select country —'}</option>
                        {tree.map((z) => <option className={optionCls} key={z.country} value={z.country}>{isAr ? (z.country_ar || z.country) : z.country}</option>)}
                    </select>
                </div>
            )}
            <div className="space-y-1">
                <label className={labelCls}>{isAr ? 'المدينة / المنطقة' : 'City / Region'}</label>
                <select
                    value={city || ''}
                    disabled={!countryEntry}
                    onChange={(e) => onChange?.({ country: countryEntry ? countryEntry.country : country, city: e.target.value })}
                    className={inputCls + (!countryEntry ? ' opacity-60' : '')}
                >
                    {!countryEntry && <option className={optionCls} value="">{isAr ? '— اختر الدولة أولاً —' : '— select a country first —'}</option>}
                    {countryEntry && (countryEntry.has_whole_country_option
                        ? <option className={optionCls} value="">{isAr ? `أي مكان في ${countryEntry.country_ar || countryEntry.country}` : `Anywhere in ${countryEntry.country}`}</option>
                        : <option className={optionCls} value="">{isAr ? '— اختر المدينة —' : '— select city —'}</option>)}
                    {countryEntry && (countryEntry.cities || []).map((c) => <option className={optionCls} key={c.city} value={c.city}>{isAr ? (c.city_ar || c.city) : c.city}</option>)}
                </select>
            </div>
        </div>
    );
}
