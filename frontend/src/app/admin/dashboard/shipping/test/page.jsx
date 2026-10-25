'use client';

import { useEffect, useState } from 'react';
import { FlaskConical, Loader2, Play } from 'lucide-react';
import { adminApi, shippingApi } from '../../../../../lib/api';
import { useApp } from '../../../../../context/AppContext';
import { Field, inputCls, PrimaryButton } from '../../../../../components/dashboard/shipping/ShippingUI';

const SOURCE_COLORS = {
    base: 'bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300',
    per_item: 'bg-sky-500/10 text-sky-600',
    per_vendor: 'bg-sky-500/10 text-sky-600',
    weight: 'bg-amber-500/10 text-amber-600',
    class: 'bg-violet-500/10 text-violet-600',
    rule: 'bg-emerald-500/10 text-emerald-600',
    policy: 'bg-marine-cyan/10 text-marine-primary',
    clamp_min: 'bg-orange-500/10 text-orange-600',
    clamp_max: 'bg-orange-500/10 text-orange-600',
};

export default function ShippingTestPage() {
    const { language, siteSettings } = useApp();
    const isAr = language === 'ar';
    const currency = siteSettings?.currency || 'QAR';

    const [tree, setTree] = useState([]);
    const [methods, setMethods] = useState([]);
    const [country, setCountry] = useState('');
    const [city, setCity] = useState('');
    const [methodId, setMethodId] = useState('');
    const [mode, setMode] = useState('');
    const [itemsText, setItemsText] = useState('[\n  { "sku": "", "quantity": 1 }\n]');
    const [running, setRunning] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);

    useEffect(() => {
        (async () => {
            try {
                const [z, m] = await Promise.all([shippingApi.getZones(), adminApi.getShippingMethods()]);
                setTree(z.tree || []);
                setMethods(m.methods || []);
            } catch (e) { /* ignore */ }
        })();
    }, []);

    const countryEntry = tree.find((t) => t.country === country);

    const run = async (e) => {
        e.preventDefault();
        setError(''); setResult(null);
        let items;
        try {
            items = JSON.parse(itemsText);
            if (!Array.isArray(items)) throw new Error('Items must be a JSON array.');
        } catch (err) {
            setError(isAr ? 'صيغة JSON غير صحيحة للعناصر.' : 'Invalid JSON for items: ' + err.message);
            return;
        }
        setRunning(true);
        try {
            const res = await adminApi.testShippingCalculation({
                items,
                destination: { country: country || null, city: city || null },
                method_id: methodId || undefined,
                mode: mode || undefined,
            });
            setResult(res);
        } catch (err) { setError(err.message || 'Test failed'); }
        finally { setRunning(false); }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <form onSubmit={run} className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm p-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <Field label={isAr ? 'الدولة' : 'Country'}>
                        {tree.length ? (
                            <select value={country} onChange={(e) => { setCountry(e.target.value); setCity(''); }} className={inputCls}>
                                <option value="">{isAr ? '— اختر —' : '— select —'}</option>
                                {tree.map((t) => <option key={t.country} value={t.country}>{t.country}</option>)}
                            </select>
                        ) : <input value={country} onChange={(e) => setCountry(e.target.value)} className={inputCls} />}
                    </Field>
                    <Field label={isAr ? 'المدينة' : 'City'}>
                        {countryEntry ? (
                            <select value={city} onChange={(e) => setCity(e.target.value)} className={inputCls}>
                                <option value="">{countryEntry.has_whole_country_option ? (isAr ? 'أي مكان في الدولة' : 'Anywhere in country') : (isAr ? '— اختر —' : '— select —')}</option>
                                {countryEntry.cities.map((c) => <option key={c.city} value={c.city}>{c.city}</option>)}
                            </select>
                        ) : <input value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} />}
                    </Field>
                    <Field label={isAr ? 'طريقة محددة (اختياري)' : 'Specific method (optional)'}>
                        <select value={methodId} onChange={(e) => setMethodId(e.target.value)} className={inputCls}>
                            <option value="">{isAr ? 'كل الطرق' : 'All methods'}</option>
                            {methods.map((m) => <option key={m._id} value={m._id}>{m.name} — {m.zone_id?.name || ''}</option>)}
                        </select>
                    </Field>
                    <Field label={isAr ? 'الوضع' : 'Mode override'}>
                        <select value={mode} onChange={(e) => setMode(e.target.value)} className={inputCls}>
                            <option value="">{isAr ? 'افتراضي (من الإعدادات)' : 'Default (from settings)'}</option>
                            <option value="combined">{isAr ? 'مدمج' : 'Combined'}</option>
                            <option value="split">{isAr ? 'مقسّم' : 'Split'}</option>
                        </select>
                    </Field>
                </div>
                <Field label={isAr ? 'العناصر (JSON)' : 'Cart items (JSON)'} hint={isAr ? 'مصفوفة من { product_id أو sku, variant_id?, quantity }' : 'Array of { product_id or sku, variant_id?, quantity }'}>
                    <textarea value={itemsText} onChange={(e) => setItemsText(e.target.value)} rows={6} className={inputCls + ' font-mono text-xs resize-y'} />
                </Field>
                <div className="flex justify-end">
                    <PrimaryButton type="submit" loading={running}>{!running && <Play size={16} />} {isAr ? 'احسب' : 'Calculate'}</PrimaryButton>
                </div>
            </form>

            {error && <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-bold">{error}</div>}

            {result && (
                <div className="space-y-4">
                    <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm p-5 text-sm">
                        <div className="flex flex-wrap gap-x-6 gap-y-1">
                            <span><b className="text-zinc-500">{isAr ? 'محرك الشحن:' : 'Engine:'}</b> {result.enabled ? (isAr ? 'مفعّل' : 'enabled') : (isAr ? 'معطّل' : 'disabled')}</span>
                            <span><b className="text-zinc-500">{isAr ? 'الوضع:' : 'Mode:'}</b> {result.mode}</span>
                            <span><b className="text-zinc-500">{isAr ? 'المنطقة:' : 'Zone:'}</b> {result.resolved_zone?.name || (isAr ? 'لا توجد' : 'none')} {result.resolved_zone?.matched_by && result.resolved_zone.matched_by !== 'none' ? `(${result.resolved_zone.matched_by})` : ''}</span>
                            {result.blocked && <span className="text-marine-primary font-bold">{isAr ? 'محظور — لا شحن لهذه الوجهة' : 'Blocked — no shipping to this destination'}</span>}
                        </div>
                    </div>

                    {(result.methods || []).map((m) => (
                        <div key={m.id} className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm overflow-hidden">
                            <div className="flex items-center justify-between p-4 border-b border-zinc-100 dark:border-white/5">
                                <div>
                                    <h3 className="font-black text-zinc-900 dark:text-white">{m.name}</h3>
                                    <p className="text-xs text-zinc-500">{m.type}{(m.eta_min != null || m.eta_max != null) ? ` · ${m.eta_min ?? ''}–${m.eta_max ?? ''} ${isAr ? 'يوم' : 'days'}` : ''}</p>
                                </div>
                                <div className="text-xl font-black text-marine-primary">{currency} {Number(m.total_cost || 0).toFixed(2)}</div>
                            </div>
                            <div className="p-4 space-y-3">
                                {(m.adjustments || []).length > 0 && (
                                    <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <tbody>
                                            {m.adjustments.map((a, i) => (
                                                <tr key={i} className="border-b border-zinc-50 dark:border-white/5 last:border-0">
                                                    <td className="py-1.5 pr-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${SOURCE_COLORS[a.source] || 'bg-zinc-100 text-zinc-500'}`}>{a.source}</span></td>
                                                    <td className="py-1.5 text-zinc-600 dark:text-zinc-300">{a.label}</td>
                                                    <td className="py-1.5 text-right font-mono text-zinc-900 dark:text-white">{Number(a.amount || 0) >= 0 ? '+' : ''}{Number(a.amount || 0).toFixed(2)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    </div>
                                )}
                                {(m.policies_applied || []).length > 0 && (
                                    <div className="text-xs text-zinc-500">
                                        <b>{isAr ? 'السياسات المطبَّقة:' : 'Policies applied:'}</b> {m.policies_applied.map((p) => `${p.name} (${p.action} ${Number(p.amount || 0).toFixed(2)})`).join(', ')}
                                    </div>
                                )}
                                {(m.warnings || []).length > 0 && (
                                    <div className="text-xs text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">⚠ {m.warnings.join(' ')}</div>
                                )}
                                {(m.per_vendor || []).length > 1 && (
                                    <div className="text-xs text-zinc-500">{isAr ? 'لكل بائع:' : 'Per vendor:'} {m.per_vendor.map((pv) => `${pv.vendor_id || '—'}: ${Number(pv.cost || 0).toFixed(2)}`).join(' · ')}</div>
                                )}
                            </div>
                        </div>
                    ))}
                    {(result.methods || []).length === 0 && !result.blocked && (
                        <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm p-8 text-center text-zinc-500">
                            <FlaskConical size={32} className="mx-auto text-zinc-300 mb-2" />
                            {isAr ? 'لا توجد طرق شحن متاحة لهذه الوجهة.' : 'No shipping methods available for this destination.'}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
