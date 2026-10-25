'use client';

/**
 * Shipping subsidy — what customers paid for carriage against what Bosta actually billed.
 *
 * Retail shipping is a flat 25 EGP per parcel while the courier still charges the real
 * tariff, so every parcel runs at a loss by design. This page is where that decision stops
 * being invisible: the figures come from `courier_cost`, frozen onto each parcel the day it
 * shipped, so the page reports history rather than re-pricing it.
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2, TrendingDown, Wallet, Truck, PackageX, AlertTriangle } from 'lucide-react';
import { adminApi } from '../../../../../lib/api';
import { useApp } from '../../../../../context/AppContext';
import { inputCls } from '../../../../../components/dashboard/shipping/ShippingUI';

const egp = (n) =>
    `${Number(n || 0).toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP`;

/** ISO yyyy-mm-dd for a date `days` ago — the value an <input type="date"> expects. */
const daysAgo = (days) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
};

const RANGES = [
    { days: 30, label: 'آخر ٣٠ يوم', label_en: 'Last 30 days' },
    { days: 90, label: 'آخر ٣ شهور', label_en: 'Last 3 months' },
    { days: 365, label: 'آخر سنة', label_en: 'Last year' },
    { days: null, label: 'من البداية', label_en: 'All time' },
];

function Stat({ icon: Icon, label, value, sub, tone = 'gray' }) {
    const tones = {
        gray: 'bg-zinc-500/10 text-zinc-500',
        green: 'bg-emerald-500/10 text-emerald-500',
        red: 'bg-marine-cyan/10 text-marine-primary',
        blue: 'bg-sky-500/10 text-sky-500',
    };
    return (
        <div className="rounded-2xl border border-zinc-200 dark:border-white/5 bg-white dark:bg-[#14171A] p-5 shadow-sm">
            <div className="flex items-start gap-3">
                <div className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center ${tones[tone]}`}>
                    <Icon size={18} />
                </div>
                <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">{label}</p>
                    <p className="text-2xl font-black text-zinc-900 dark:text-white break-words">{value}</p>
                    {sub && <p className="text-[11px] text-zinc-400 mt-1">{sub}</p>}
                </div>
            </div>
        </div>
    );
}

function BreakdownTable({ title, rows, isAr, keyLabel }) {
    if (!rows || rows.length === 0) return null;
    // The widest subsidy sets the bar scale, so the worst row is always full-width and the
    // rest are read against it rather than against an arbitrary maximum.
    const worst = Math.max(...rows.map((r) => Math.abs(r.subsidy)), 1);
    return (
        <div className="rounded-2xl border border-zinc-200 dark:border-white/5 bg-white dark:bg-[#14171A] overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-100 dark:border-white/5">
                <h3 className="text-sm font-black text-zinc-900 dark:text-white">{title}</h3>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                    <thead>
                        <tr className="text-[11px] uppercase tracking-wider text-zinc-400 border-b border-zinc-100 dark:border-white/5">
                            <th className={`px-5 py-3 font-bold ${isAr ? 'text-right' : 'text-left'}`}>{keyLabel}</th>
                            <th className="px-3 py-3 font-bold text-center">{isAr ? 'شحنات' : 'Parcels'}</th>
                            <th className="px-3 py-3 font-bold text-center">{isAr ? 'المحصّل' : 'Collected'}</th>
                            <th className="px-3 py-3 font-bold text-center">{isAr ? 'تكلفة بوسطة' : 'Bosta cost'}</th>
                            <th className={`px-5 py-3 font-bold ${isAr ? 'text-left' : 'text-right'}`}>{isAr ? 'الدعم' : 'Subsidy'}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r) => (
                            <tr key={r.key} className="border-b border-zinc-50 dark:border-white/5 last:border-0">
                                <td className={`px-5 py-3 font-bold text-zinc-900 dark:text-white ${isAr ? 'text-right' : 'text-left'}`}>
                                    {isAr ? r.name_ar : r.name}
                                </td>
                                <td className="px-3 py-3 text-center text-zinc-500">{r.parcels}</td>
                                <td className="px-3 py-3 text-center text-zinc-500">{egp(r.collected)}</td>
                                <td className="px-3 py-3 text-center text-zinc-500">{egp(r.paid)}</td>
                                <td className={`px-5 py-3 ${isAr ? 'text-left' : 'text-right'}`}>
                                    <div className={`flex items-center gap-2 ${isAr ? 'justify-start' : 'justify-end'}`}>
                                        <div className="hidden sm:block w-24 h-1.5 rounded-full bg-zinc-100 dark:bg-white/5 overflow-hidden">
                                            <div
                                                className="h-full rounded-full bg-marine-cyan"
                                                style={{ width: `${Math.min(100, (Math.abs(r.subsidy) / worst) * 100)}%` }}
                                            />
                                        </div>
                                        <span className="font-black text-marine-primary whitespace-nowrap">−{egp(r.subsidy)}</span>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default function ShippingSubsidyPage() {
    const { language } = useApp();
    const isAr = language === 'ar';

    const [range, setRange] = useState(30);
    const [from, setFrom] = useState(daysAgo(30));
    const [to, setTo] = useState('');
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = async (params) => {
        setLoading(true); setError('');
        try {
            const data = await adminApi.getShippingSubsidy(params);
            setReport(data.report || null);
        } catch (err) { setError(err.message || 'Failed to load the report'); }
        finally { setLoading(false); }
    };

    useEffect(() => { load({ from: daysAgo(30) }); }, []);

    const pickRange = (days) => {
        setRange(days);
        const f = days ? daysAgo(days) : '';
        setFrom(f); setTo('');
        load(f ? { from: f } : {});
    };

    const m = report?.money;
    // Per-parcel is the number that makes the decision concrete: "every parcel we ship
    // costs us X out of pocket" lands where a period total does not.
    //
    // Divided by the PRICED count, not the total: the money above covers only parcels the
    // tariff could price, so dividing by all of them would spread a partial cost over a
    // full denominator and understate the average.
    const perParcel = useMemo(() => {
        if (!report || !report.parcels?.priced) return 0;
        return m.subsidy / report.parcels.priced;
    }, [report, m]);

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-lg font-black text-zinc-900 dark:text-white">
                    {isAr ? 'دعم الشحن' : 'Shipping subsidy'}
                </h2>
                <p className="text-sm text-zinc-500 mt-1">
                    {isAr
                        ? 'اللي حصّلناه من العملاء مقابل اللي بوسطة حاسبتنا عليه فعلاً. الأرقام متجمّدة على كل شحنة يوم ما اتشحنت.'
                        : 'What customers paid for carriage against what Bosta actually billed. Figures are frozen on each parcel the day it shipped.'}
                </p>
            </div>

            {/* range picker */}
            <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-wrap gap-1 rounded-xl bg-zinc-100 dark:bg-white/5 p-1">
                    {RANGES.map((r) => (
                        <button
                            key={String(r.days)}
                            onClick={() => pickRange(r.days)}
                            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                                range === r.days
                                    ? 'bg-white dark:bg-[#14171A] text-marine-primary shadow-sm'
                                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                            }`}
                        >
                            {isAr ? r.label : r.label_en}
                        </button>
                    ))}
                </div>
                <div className="flex items-end gap-2">
                    <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputCls} w-auto py-2`} />
                    <span className="text-zinc-400 text-sm pb-2.5">→</span>
                    <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputCls} w-auto py-2`} />
                    <button
                        onClick={() => { setRange('custom'); load({ from, to }); }}
                        className="px-4 py-2.5 text-sm font-bold rounded-xl bg-marine-cyan text-white hover:bg-[#B91C1C] transition-colors"
                    >
                        {isAr ? 'عرض' : 'Apply'}
                    </button>
                </div>
            </div>

            {error && (
                <div className="rounded-xl bg-marine-cyan/10 border border-marine-cyan/20 px-4 py-3 text-sm text-marine-primary font-bold">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-20 text-zinc-400">
                    <Loader2 className="animate-spin" size={28} />
                </div>
            ) : !report || report.parcels.total === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-white/10 py-16 text-center">
                    <PackageX className="mx-auto text-zinc-300 dark:text-zinc-600" size={36} />
                    <p className="mt-3 text-sm font-bold text-zinc-500">
                        {isAr ? 'مفيش شحنات في الفترة دي' : 'No parcels shipped in this period'}
                    </p>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                        <Stat
                            icon={Wallet} tone="green"
                            label={isAr ? 'محصّل من العملاء' : 'Collected from customers'}
                            value={egp(m.collected)}
                            sub={isAr ? `${report.parcels.priced} شحنة` : `${report.parcels.priced} parcels`}
                        />
                        <Stat
                            icon={Truck} tone="blue"
                            label={isAr ? 'مدفوع لبوسطة' : 'Billed by Bosta'}
                            value={egp(m.paid)}
                            sub={
                                isAr
                                    ? `شحن ${egp(m.send)} · مرتجع ${egp(m.rto)} · بيك أب ${egp(m.pickup)}`
                                    : `send ${egp(m.send)} · RTO ${egp(m.rto)} · pickup ${egp(m.pickup)}`
                            }
                        />
                        <Stat
                            icon={TrendingDown} tone="red"
                            label={isAr ? 'الدعم (خسارة الشحن)' : 'Subsidy (shipping loss)'}
                            value={`−${egp(m.subsidy)}`}
                            sub={isAr ? 'ريدي مارين بتتحمله' : 'absorbed by Ready Marine'}
                        />
                        <Stat
                            icon={TrendingDown} tone="red"
                            label={isAr ? 'متوسط الدعم للشحنة' : 'Subsidy per parcel'}
                            value={`−${egp(perParcel)}`}
                            sub={
                                isAr
                                    ? `${report.parcels.returned} شحنة رجعت · ${report.pickup_visits} زيارة بيك أب`
                                    : `${report.parcels.returned} returned · ${report.pickup_visits} pickup visits`
                            }
                        />
                    </div>

                    {report.parcels.unpriced > 0 && (
                        <div className="flex items-start gap-3 rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3">
                            <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                            <p className="text-sm text-amber-700 dark:text-amber-400 font-bold">
                                {isAr
                                    ? `${report.parcels.unpriced} شحنة مش متسعّرة — مدينة الوصول بتاعتها مش في تسعيرة بوسطة، فهي مستبعدة من كل الأرقام فوق وتحت. يعني الدعم الحقيقي أكبر من المعروض.`
                                    : `${report.parcels.unpriced} parcels are unpriced — their destination is not in the courier's tariff, so they are excluded from every figure here. The real subsidy is larger than shown.`}
                            </p>
                        </div>
                    )}

                    {Array.isArray(report.by_courier) && report.by_courier.length > 0 && (
                        <BreakdownTable
                            title={isAr ? 'حسب شركة الشحن' : 'By courier'}
                            rows={report.by_courier}
                            isAr={isAr}
                            keyLabel={isAr ? 'الشركة' : 'Courier'}
                        />
                    )}
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        <BreakdownTable
                            title={isAr ? 'حسب المنطقة' : 'By sector / area'}
                            rows={report.by_sector}
                            isAr={isAr}
                            keyLabel={isAr ? 'المنطقة' : 'Sector'}
                        />
                        <BreakdownTable
                            title={isAr ? 'حسب حجم الشحنة' : 'By parcel size'}
                            rows={report.by_size}
                            isAr={isAr}
                            keyLabel={isAr ? 'الحجم' : 'Size'}
                        />
                    </div>
                </>
            )}
        </div>
    );
}
