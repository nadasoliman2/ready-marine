'use client';

import { PAGE_SIZE_OPTIONS } from '../../../lib/usePageSize';

import { useMemo } from 'react';
import { Loader2, TrendingUp, TrendingDown, Info } from 'lucide-react';

/**
 * Shared furniture for the finance screens.
 *
 * Pulled out because all five pages show the same three things — a money figure, a stat
 * tile, and a date range — and money that formats differently on two screens reads as two
 * different numbers.
 */

export const CARD = 'bg-white dark:bg-[#09090b] rounded-xl border border-zinc-100 dark:border-white/5 shadow-sm';
export const INPUT = 'bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-3 py-2 text-sm focus:border-marine-cyan focus:ring-1 focus:ring-marine-cyan outline-none transition-colors';
export const LABEL = 'block text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-1.5';

/**
 * Money, always with two decimals and a thousands separator.
 *
 * Rendered `dir="ltr"` even in Arabic: a figure like "1,234.50 EGP" is a number, and
 * mirroring it puts the currency where the sign belongs and makes it briefly unreadable.
 */
export const money = (n, currency = 'EGP', locale = 'en-US') =>
    `${Number(n || 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

export const compactMoney = (n, currency = 'EGP') => {
    const v = Number(n || 0);
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M ${currency}`;
    if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}K ${currency}`;
    return `${v.toFixed(0)} ${currency}`;
};

export const fmtDate = (d, isAr = false) =>
    d ? new Date(d).toLocaleDateString(isAr ? 'ar-EG' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

export const fmtDateTime = (d, isAr = false) =>
    d ? new Date(d).toLocaleString(isAr ? 'ar-EG' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/** An ISO yyyy-mm-dd string for a date input, in LOCAL time so it does not slip a day. */
export const toInputDate = (d) => {
    if (!d) return '';
    const x = new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

export const Money = ({ value, currency = 'EGP', className = '', signed = false, muted = false }) => {
    const v = Number(value || 0);
    const tone = !signed
        ? (muted ? 'text-zinc-500' : 'text-zinc-900 dark:text-white')
        : v > 0
            ? 'text-emerald-600 dark:text-emerald-400'
            : v < 0
                ? 'text-red-600 dark:text-red-400'
                : 'text-zinc-500';
    return (
        <span dir="ltr" className={`tabular-nums ${tone} ${className}`}>
            {signed && v > 0 ? '+' : ''}{money(v, currency)}
        </span>
    );
};

/** A single headline figure. `tone` paints profit green and loss red. */
export const StatCard = ({ label, value, sub, icon: Icon, tone = 'neutral', currency = 'EGP', hint }) => {
    const tones = {
        neutral: 'text-zinc-900 dark:text-white',
        profit: 'text-emerald-600 dark:text-emerald-400',
        loss: 'text-red-600 dark:text-red-400',
        warn: 'text-amber-600 dark:text-amber-400',
        brand: 'text-marine-primary',
    };
    const chips = {
        neutral: 'bg-zinc-100 dark:bg-white/5 text-zinc-500',
        profit: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        loss: 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400',
        warn: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400',
        brand: 'bg-red-50 dark:bg-marine-cyan/10 text-marine-primary',
    };

    return (
        <div className={`${CARD} p-5`}>
            <div className="flex items-start justify-between gap-3">
                <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">{label}</p>
                {Icon && (
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${chips[tone] || chips.neutral}`}>
                        <Icon size={16} />
                    </div>
                )}
            </div>
            <p dir="ltr" className={`text-2xl font-black mt-2 tabular-nums ${tones[tone] || tones.neutral}`}>
                {typeof value === 'number' ? money(value, currency) : value}
            </p>
            {sub && <p className="text-xs text-zinc-500 mt-1">{sub}</p>}
            {hint && (
                <p className="text-[11px] text-zinc-400 mt-2 flex items-start gap-1.5">
                    <Info size={12} className="mt-0.5 shrink-0" />
                    <span>{hint}</span>
                </p>
            )}
        </div>
    );
};

/** Profit or loss, green or red, with its direction arrow. */
export const ProfitBadge = ({ value, currency = 'EGP', size = 'md' }) => {
    const v = Number(value || 0);
    const positive = v >= 0;
    const sizes = { sm: 'text-sm px-2 py-1', md: 'text-base px-3 py-1.5', lg: 'text-2xl px-4 py-2' };
    return (
        <span
            dir="ltr"
            className={`inline-flex items-center gap-2 rounded-xl font-black tabular-nums ${sizes[size]} ${positive
                ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400'
                }`}
        >
            {positive ? <TrendingUp size={size === 'lg' ? 22 : 16} /> : <TrendingDown size={size === 'lg' ? 22 : 16} />}
            {money(v, currency)}
        </span>
    );
};

/**
 * From / to inputs with presets.
 *
 * Presets exist because the two questions actually asked of this module are "how did this
 * month go?" and "how are we doing overall?", and both should be one click rather than
 * two date pickers.
 */
export const DateRangeFilter = ({ from, to, onChange, isAr, extra }) => {
    const presets = useMemo(() => {
        const now = new Date();
        const iso = toInputDate;
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
        const last30 = new Date(now); last30.setDate(last30.getDate() - 29);
        const startOfYear = new Date(now.getFullYear(), 0, 1);

        return [
            { key: 'month', label: { en: 'This month', ar: 'هذا الشهر' }, from: iso(startOfMonth), to: iso(now) },
            { key: 'last30', label: { en: 'Last 30 days', ar: 'آخر ٣٠ يوم' }, from: iso(last30), to: iso(now) },
            { key: 'lastMonth', label: { en: 'Last month', ar: 'الشهر الماضي' }, from: iso(startOfLastMonth), to: iso(endOfLastMonth) },
            { key: 'year', label: { en: 'This year', ar: 'هذا العام' }, from: iso(startOfYear), to: iso(now) },
            // Empty dates mean "no range" to every endpoint, which is lifetime.
            { key: 'all', label: { en: 'Lifetime', ar: 'كل الفترات' }, from: '', to: '' },
        ];
    }, []);

    return (
        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
            <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => {
                    const active = from === p.from && to === p.to;
                    return (
                        <button
                            key={p.key}
                            type="button"
                            onClick={() => onChange({ from: p.from, to: p.to })}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${active
                                ? 'bg-marine-cyan text-white'
                                : 'bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-white/10'
                                }`}
                        >
                            {isAr ? p.label.ar : p.label.en}
                        </button>
                    );
                })}
            </div>

            <div className="flex items-end gap-2">
                <div>
                    <label className={LABEL}>{isAr ? 'من' : 'From'}</label>
                    <input type="date" value={from || ''} onChange={(e) => onChange({ from: e.target.value, to })} className={INPUT} />
                </div>
                <div>
                    <label className={LABEL}>{isAr ? 'إلى' : 'To'}</label>
                    <input type="date" value={to || ''} onChange={(e) => onChange({ from, to: e.target.value })} className={INPUT} />
                </div>
                {extra}
            </div>
        </div>
    );
};

export const Spinner = ({ className = '' }) => (
    <div className={`flex items-center justify-center py-16 ${className}`}>
        <Loader2 className="animate-spin text-marine-primary" size={28} />
    </div>
);

export const EmptyState = ({ icon: Icon, title, message }) => (
    <div className="flex flex-col items-center justify-center py-16 text-center px-6">
        {Icon && <Icon size={36} className="text-zinc-300 dark:text-zinc-700 mb-3" />}
        <p className="font-bold text-zinc-700 dark:text-zinc-300">{title}</p>
        {message && <p className="text-sm text-zinc-500 mt-1 max-w-md">{message}</p>}
    </div>
);

export const Pagination = ({ page, pages, total, onChange, isAr, pageSize = null, onPageSizeChange = null }) => {
    // Kept on screen for a single page whenever the size selector is present: hiding the bar
    // would hide the only way back to a smaller page size.
    if ((!pages || pages <= 1) && !onPageSizeChange) return null;
    return (
        <div className="flex items-center justify-between gap-4 px-4 py-3 border-t border-zinc-100 dark:border-white/5">
            <div className="flex items-center gap-3 flex-wrap">
                <p className="text-xs text-zinc-500">
                    {isAr ? `صفحة ${page} من ${pages} — ${total} سجل` : `Page ${page} of ${pages} — ${total} records`}
                </p>
                {onPageSizeChange && (
                    <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                        <span className="hidden sm:inline">{isAr ? 'صفوف' : 'Rows'}</span>
                        <select
                            value={pageSize}
                            onChange={(e) => onPageSizeChange(Number(e.target.value))}
                            className="bg-transparent border border-zinc-200 dark:border-white/10 rounded-lg px-2 py-1 text-xs font-bold text-zinc-700 dark:text-zinc-200 focus:border-marine-cyan focus:outline-none cursor-pointer"
                        >
                            {PAGE_SIZE_OPTIONS.map((n) => (
                                <option key={n} value={n} className="dark:bg-[#14171A]">{n}</option>
                            ))}
                        </select>
                    </label>
                )}
            </div>
            <div className="flex gap-2">
                <button
                    onClick={() => onChange(page - 1)}
                    disabled={page <= 1}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-400 disabled:opacity-40 hover:bg-zinc-200 dark:hover:bg-white/10 transition-colors"
                >
                    {isAr ? 'السابق' : 'Previous'}
                </button>
                <button
                    onClick={() => onChange(page + 1)}
                    disabled={page >= pages}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-400 disabled:opacity-40 hover:bg-zinc-200 dark:hover:bg-white/10 transition-colors"
                >
                    {isAr ? 'التالي' : 'Next'}
                </button>
            </div>
        </div>
    );
};

/** Wide tables must scroll inside themselves — the page body never scrolls sideways. */
export const TableWrap = ({ children }) => (
    <div className="overflow-x-auto">{children}</div>
);

export const Th = ({ children, align = 'left', className = '' }) => (
    <th className={`px-4 py-3 text-[11px] font-bold text-zinc-500 uppercase tracking-wide text-${align} whitespace-nowrap ${className}`}>
        {children}
    </th>
);

export const Td = ({ children, align = 'left', className = '' }) => (
    <td className={`px-4 py-3 text-sm text-${align} ${className}`}>{children}</td>
);
