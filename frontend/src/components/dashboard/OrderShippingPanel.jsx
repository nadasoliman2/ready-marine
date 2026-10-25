'use client';

import { Truck } from 'lucide-react';

const SOURCE_LABELS = {
    base: { en: 'Base', ar: 'أساسي' },
    per_item: { en: 'Per item', ar: 'لكل عنصر' },
    per_vendor: { en: 'Per vendor', ar: 'لكل بائع' },
    weight: { en: 'Weight', ar: 'الوزن' },
    class: { en: 'Class', ar: 'الفئة' },
    rule: { en: 'Rule', ar: 'قاعدة' },
    policy: { en: 'Policy', ar: 'سياسة' },
    clamp_min: { en: 'Min fee', ar: 'حد أدنى' },
    clamp_max: { en: 'Max fee', ar: 'حد أقصى' },
    company_batch: { en: 'Company batch', ar: 'تجميع الشركة' },
};

/**
 * Renders the `order.shipping` snapshot. Compact, theme-neutral (works in both
 * admin/vendor dark dashboards and the customer profile). `dark` prop tweaks colors.
 */
export default function OrderShippingPanel({ order, isAr = false, currency = 'QAR', dark = false }) {
    const s = order?.shipping;
    if (!s) {
        return (
            <div className={`rounded-xl border ${dark ? 'border-white/5 bg-[#14171A]' : 'border-zinc-200 bg-white'} p-4 text-sm ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                <div className="flex items-center gap-2 font-bold mb-1"><Truck size={16} className="text-marine-primary" /> {isAr ? 'الشحن' : 'Shipping'}</div>
                {isAr ? 'لا توجد بيانات شحن لهذا الطلب (شحن مجاني).' : 'No shipping details recorded for this order (free shipping).'}
            </div>
        );
    }
    if (s.enabled === false) {
        return (
            <div className={`rounded-xl border ${dark ? 'border-white/5 bg-[#14171A]' : 'border-zinc-200 bg-white'} p-4 text-sm ${dark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                <div className="flex items-center gap-2 font-bold mb-1"><Truck size={16} className="text-marine-primary" /> {isAr ? 'الشحن' : 'Shipping'}</div>
                {isAr ? 'كان محرك الشحن معطّلاً وقت الطلب — شحن مجاني.' : 'Shipping engine was disabled when this order was placed — free shipping.'}
            </div>
        );
    }
    const lbl = (src) => { const v = SOURCE_LABELS[src]; return v ? (isAr ? v.ar : v.en) : src; };
    const muted = dark ? 'text-zinc-400' : 'text-zinc-500';
    const fg = dark ? 'text-white' : 'text-zinc-900';

    return (
        <div className={`rounded-xl border ${dark ? 'border-white/5 bg-[#14171A]' : 'border-zinc-200 bg-white'} overflow-hidden`}>
            <div className={`px-4 py-3 border-b ${dark ? 'border-white/5 bg-white/[0.02]' : 'border-zinc-100 bg-zinc-50'} flex items-center justify-between`}>
                <div className="flex items-center gap-2 font-bold text-sm"><Truck size={16} className="text-marine-primary" /> <span className={fg}>{isAr ? 'الشحن' : 'Shipping'}</span></div>
                <div className="text-lg font-black text-marine-primary">{Number(s.total_cost || 0) === 0 ? (isAr ? 'مجاني' : 'Free') : `${currency} ${Number(s.total_cost || 0).toFixed(2)}`}</div>
            </div>
            <div className="p-4 space-y-3 text-sm">
                <div className={`flex flex-wrap gap-x-6 gap-y-1 ${muted}`}>
                    {s.method_name && <span>{isAr ? 'الطريقة:' : 'Method:'} <span className={fg}>{s.method_name}</span></span>}
                    {(s.destination?.country) && <span>{isAr ? 'الوجهة:' : 'Destination:'} <span className={fg}>{s.destination.country}{s.destination.city ? ` / ${s.destination.city}` : ''}</span></span>}
                    {s.zone_name && <span>{isAr ? 'المنطقة:' : 'Zone:'} <span className={fg}>{s.zone_name}</span></span>}
                    {s.mode === 'split' && <span className="text-amber-500 font-bold">{isAr ? 'شحن مقسّم لكل بائع' : 'Split per vendor'}</span>}
                    {!!s.total_weight && <span>{isAr ? 'الوزن:' : 'Weight:'} <span className={fg}>{s.total_weight} kg</span></span>}
                </div>

                {Array.isArray(s.adjustments) && s.adjustments.length > 0 && (
                    <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <tbody>
                            {s.adjustments.map((a, i) => (
                                <tr key={i} className={`border-b last:border-0 ${dark ? 'border-white/5' : 'border-zinc-50'}`}>
                                    <td className={`py-1 pr-2 ${muted}`}><span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-zinc-500/10">{lbl(a.source)}</span></td>
                                    <td className={`py-1 ${muted}`}>{a.label}</td>
                                    <td className={`py-1 text-right font-mono ${fg}`}>{Number(a.amount || 0) >= 0 ? '+' : ''}{Number(a.amount || 0).toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>
                )}

                {Array.isArray(s.policies_applied) && s.policies_applied.length > 0 && (
                    <div className={`text-xs ${muted}`}><b>{isAr ? 'السياسات:' : 'Policies:'}</b> {s.policies_applied.map((p) => `${p.name} (${p.action}${p.amount ? ' ' + Number(p.amount).toFixed(2) : ''})`).join(', ')}</div>
                )}
                {Array.isArray(s.warnings) && s.warnings.length > 0 && (
                    <div className="text-xs text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">⚠ {s.warnings.join(' ')}</div>
                )}
                {Array.isArray(s.per_vendor) && s.per_vendor.length > 1 && (
                    <div className={`text-xs ${muted}`}><b>{isAr ? 'لكل بائع:' : 'Per vendor:'}</b> {s.per_vendor.map((pv) => `${pv.vendor_id || '—'}: ${currency} ${Number(pv.cost || 0).toFixed(2)}`).join(' · ')}</div>
                )}
            </div>
        </div>
    );
}
