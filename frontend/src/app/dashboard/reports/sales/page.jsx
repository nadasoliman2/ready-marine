'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, FileBarChart, Loader2, ShoppingCart, Receipt, Percent, Wallet } from 'lucide-react';
import Link from '../../../../components/LocaleLink';
import { vendorApi, downloadFile } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import { getSubOrderStatusLabel, getSubOrderStatusColor } from '../../../../lib/orderStatus';

// 'YYYY-MM-DD' in Cairo, for the date boxes.
const ymd = (d) => new Date(d.getTime() + 2 * 3600000).toISOString().slice(0, 10);

/** The period buttons: this month, last month, the last 3 months, everything. */
const presetRange = (key) => {
  const now = new Date();
  const first = (y, m) => new Date(Date.UTC(y, m, 1));
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (key === 'this_month') return { from: ymd(first(y, m)), to: ymd(now) };
  if (key === 'last_month') return { from: ymd(first(y, m - 1)), to: ymd(new Date(first(y, m).getTime() - 86400000)) };
  if (key === 'last_3_months') return { from: ymd(first(y, m - 2)), to: ymd(now) };
  return { from: '', to: '' };
};

const PRESETS = [
  { key: 'this_month', ar: 'الشهر ده', en: 'This month' },
  { key: 'last_month', ar: 'الشهر اللي فات', en: 'Last month' },
  { key: 'last_3_months', ar: 'آخر 3 شهور', en: 'Last 3 months' },
  { key: 'all', ar: 'كل الوقت', en: 'All time' },
];

const STATUS_FILTERS = [
  { id: 'all', ar: 'كل الحالات', en: 'All statuses' },
  { id: 'in_progress', ar: 'جارية', en: 'In progress' },
  { id: 'delivered', ar: 'اتسلّمت', en: 'Delivered' },
  { id: 'returned', ar: 'مرتجعة', en: 'Returned' },
  { id: 'cancelled', ar: 'ملغاة', en: 'Cancelled' },
];

const INPUT = 'bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-zinc-900 dark:text-white outline-none focus:border-marine-cyan';

/**
 * The vendor's sales report: every order of theirs with its value, Ready Marine's commission,
 * what is theirs, its date and status, the totals over a period, and the same as Excel
 * (Backend services/vendorSalesReportService.js).
 */
export default function VendorSalesReportPage() {
  const { language, siteSettings } = useApp();
  const isAr = language === 'ar';
  const currency = siteSettings?.currency || 'EGP';
  const fmt = (n) => `${Number(n || 0).toLocaleString(isAr ? 'ar-EG' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

  const [preset, setPreset] = useState('last_3_months');
  const [filters, setFilters] = useState(() => ({ ...presetRange('last_3_months'), status: 'all' }));
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReport(await vendorApi.getSalesReport(filters));
    } catch (err) {
      setError(isAr ? 'تعذر تحميل التقرير.' : (err.message || 'Could not load the report.'));
    } finally {
      setLoading(false);
    }
  }, [filters, isAr]);

  useEffect(() => { load(); }, [load]);

  const pickPreset = (key) => {
    setPreset(key);
    setFilters((f) => ({ ...f, ...presetRange(key) }));
  };
  const setDate = (patch) => {
    setPreset('');
    setFilters((f) => ({ ...f, ...patch }));
  };

  const rows = report?.rows || [];
  const totals = report?.totals || {};
  const withDeductions = rows.some((r) => Math.abs(r.deductions) > 0.004);
  const cards = [
    { label: isAr ? 'عدد الطلبات' : 'Orders', value: (totals.orders || 0).toLocaleString(isAr ? 'ar-EG' : 'en-US'), icon: ShoppingCart, note: totals.cancelled ? (isAr ? `من غير ${totals.cancelled} ملغي` : `excluding ${totals.cancelled} cancelled`) : '' },
    { label: isAr ? 'قيمة المبيعات' : 'Sales value', value: fmt(totals.value), icon: Receipt },
    { label: isAr ? 'عمولة ريدي مارين' : 'Ready Marine commission', value: fmt(totals.commission), icon: Percent },
    { label: isAr ? 'الصافي ليك' : 'Your net', value: fmt(totals.net), icon: Wallet, strong: true },
  ];

  const itemsText = (r) => r.items.map((i) => `${i.title}${i.variant ? ` (${i.variant})` : ''} × ${i.quantity}`).join('، ');

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white flex items-center gap-2">
            <FileBarChart className="text-marine-primary" /> {isAr ? 'تقرير المبيعات' : 'Sales report'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {isAr
              ? 'كل طلب ليك: قيمته، وعمولة ريدي مارين، والصافي ليك، وتاريخه، وحالته. التاريخ هو يوم الطلب.'
              : "Every order of yours: its value, Ready Marine's commission, your net, its date and status. Dates are order dates."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadFile(vendorApi.salesReportUrl(filters))}
          disabled={!rows.length}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-marine-cyan text-white text-sm font-bold hover:bg-marine-cyan-dark transition-colors disabled:opacity-50"
        >
          <Download size={16} /> {isAr ? 'تحميل Excel' : 'Download Excel'}
        </button>
      </div>

      {/* Period and status */}
      <div className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl p-4 mb-6 space-y-3">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" onClick={() => pickPreset(p.key)} aria-pressed={preset === p.key}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${preset === p.key
                ? 'border-marine-cyan bg-marine-cyan text-white'
                : 'border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan'}`}>
              {isAr ? p.ar : p.en}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-bold text-zinc-500 space-y-1">
            <span className="block">{isAr ? 'من' : 'From'}</span>
            <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setDate({ from: e.target.value })} className={INPUT} />
          </label>
          <label className="text-xs font-bold text-zinc-500 space-y-1">
            <span className="block">{isAr ? 'إلى' : 'To'}</span>
            <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setDate({ to: e.target.value })} className={INPUT} />
          </label>
          <label className="text-xs font-bold text-zinc-500 space-y-1">
            <span className="block">{isAr ? 'الحالة' : 'Status'}</span>
            <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className={INPUT}>
              {STATUS_FILTERS.map((s) => <option key={s.id} value={s.id}>{isAr ? s.ar : s.en}</option>)}
            </select>
          </label>
          {loading && <Loader2 size={18} className="animate-spin text-marine-primary mb-2" />}
        </div>
      </div>

      {error && <div className="mb-6 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 p-4 text-sm font-bold">{error}</div>}

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {cards.map((c) => (
          <div key={c.label} className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl p-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5"><c.icon size={13} />{c.label}</p>
            <p className={`mt-1 font-black tabular-nums ${c.strong ? 'text-xl text-emerald-600 dark:text-emerald-400' : 'text-lg text-zinc-900 dark:text-white'}`}>{c.value}</p>
            {c.note && <p className="text-[11px] text-zinc-400 mt-0.5">{c.note}</p>}
          </div>
        ))}
      </div>

      {/* Orders */}
      <div className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl shadow-sm overflow-hidden">
        {!loading && rows.length === 0 ? (
          <div className="p-12 text-center text-zinc-500">
            <FileBarChart size={32} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">{isAr ? 'مفيش طلبات في الفترة دي.' : 'No orders in this period.'}</p>
          </div>
        ) : (
          <>
            {/* Phone: one card per order */}
            <ul className="md:hidden divide-y divide-zinc-100 dark:divide-white/5">
              {rows.map((r) => (
                <li key={r.sub_order_id} className={`p-4 space-y-2 ${r.status === 'cancelled' ? 'opacity-60' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/dashboard/orders/${r.order_id}`} className="font-mono text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:text-marine-primary">{r.reference}</Link>
                    <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-bold ${getSubOrderStatusColor(r.status)}`}>{getSubOrderStatusLabel(r.status, isAr)}</span>
                  </div>
                  <p className="text-xs text-zinc-500 line-clamp-2">{itemsText(r)}</p>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div><p className="text-zinc-400">{isAr ? 'القيمة' : 'Value'}</p><p className="font-bold text-zinc-900 dark:text-white tabular-nums">{fmt(r.value)}</p></div>
                    <div><p className="text-zinc-400">{isAr ? 'العمولة' : 'Commission'}</p><p className="font-bold text-zinc-900 dark:text-white tabular-nums">{fmt(r.commission)}</p></div>
                    <div><p className="text-zinc-400">{isAr ? 'الصافي' : 'Net'}</p><p className="font-black text-emerald-600 dark:text-emerald-400 tabular-nums">{fmt(r.net)}</p></div>
                  </div>
                  <p className="text-[11px] text-zinc-400">{fmtDate(r.created_at)}{r.deductions > 0.004 ? ` · ${isAr ? 'خصومات' : 'Deductions'} ${fmt(r.deductions)}` : ''}</p>
                </li>
              ))}
            </ul>

            {/* Wider screens: a table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className="text-zinc-400 text-xs uppercase tracking-wider border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
                    <th className="text-start font-bold px-4 py-3">{isAr ? 'تاريخ الطلب' : 'Order date'}</th>
                    <th className="text-start font-bold px-4 py-3">{isAr ? 'رقم الطلب' : 'Order'}</th>
                    <th className="text-start font-bold px-4 py-3">{isAr ? 'المنتجات' : 'Products'}</th>
                    <th className="text-start font-bold px-4 py-3">{isAr ? 'الحالة' : 'Status'}</th>
                    <th className="text-end font-bold px-4 py-3">{isAr ? 'قيمة الطلب' : 'Value'}</th>
                    <th className="text-end font-bold px-4 py-3">{isAr ? 'العمولة' : 'Commission'}</th>
                    {withDeductions && <th className="text-end font-bold px-4 py-3">{isAr ? 'خصومات' : 'Deductions'}</th>}
                    <th className="text-end font-bold px-4 py-3">{isAr ? 'الصافي ليك' : 'Your net'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                  {rows.map((r) => (
                    <tr key={r.sub_order_id} className={`hover:bg-zinc-50 dark:hover:bg-white/[0.01] ${r.status === 'cancelled' ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3 text-zinc-500 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/orders/${r.order_id}`} className="whitespace-nowrap font-mono text-xs font-bold text-zinc-700 dark:text-zinc-300 hover:text-marine-primary">{r.reference}</Link>
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-500 max-w-[260px]"><span className="line-clamp-2" title={itemsText(r)}>{itemsText(r)}</span></td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap ${getSubOrderStatusColor(r.status)}`}>{getSubOrderStatusLabel(r.status, isAr)}</span>
                      </td>
                      <td className="px-4 py-3 text-end tabular-nums text-zinc-900 dark:text-white">{fmt(r.value)}</td>
                      <td className="px-4 py-3 text-end tabular-nums text-zinc-500">{fmt(r.commission)}</td>
                      {withDeductions && <td className="px-4 py-3 text-end tabular-nums text-zinc-500">{fmt(r.deductions)}</td>}
                      <td className="px-4 py-3 text-end tabular-nums font-black text-emerald-600 dark:text-emerald-400">{fmt(r.net)}</td>
                    </tr>
                  ))}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-zinc-200 dark:border-white/10 font-black text-zinc-900 dark:text-white">
                      <td className="px-4 py-3" colSpan={4}>{isAr ? 'الإجمالي' : 'Total'}{totals.cancelled ? <span className="text-xs font-medium text-zinc-400"> {isAr ? `(من غير ${totals.cancelled} ملغي)` : `(excluding ${totals.cancelled} cancelled)`}</span> : null}</td>
                      <td className="px-4 py-3 text-end tabular-nums">{fmt(totals.value)}</td>
                      <td className="px-4 py-3 text-end tabular-nums">{fmt(totals.commission)}</td>
                      {withDeductions && <td className="px-4 py-3 text-end tabular-nums">{fmt(totals.deductions)}</td>}
                      <td className="px-4 py-3 text-end tabular-nums text-emerald-600 dark:text-emerald-400">{fmt(totals.net)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}
      </div>
      {withDeductions && (
        <p className="text-xs text-zinc-400 mt-3">
          {isAr ? 'الخصومات: نصيبك من كوبون الخصم، أو اللي اترد في مرتجع.' : 'Deductions: your share of a discount coupon, or what a return refunded.'}
        </p>
      )}
    </div>
  );
}
