'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from '../../components/LocaleLink';
import {
  Loader2, TrendingUp, TrendingDown, ShoppingBag, Package, Wallet, AlertCircle, ArrowRight,
  Clock, FileDown, Users, RotateCcw, Star, Boxes, Receipt, Minus, PackageOpen, Truck,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { vendorApi } from '../../lib/api';
import { getOrderStatusLabel, getOrderStatusColor } from '../../lib/orderStatus';
import { exportVendorReportPdf } from '../../lib/vendorReportPdf';

/**
 * The vendor's landing screen.
 *
 * Everything here is the store's own figure, read from its orders — nothing is
 * illustrative. Two consequences follow, and both are deliberate:
 *
 *  · a brand-new store sees zeros with an explanation, not fake momentum;
 *  · a number that cannot be loaded says so, rather than rendering as 0. A
 *    silent zero on a sales figure is the one failure a vendor would act on.
 *
 * The period selector reloads from the server rather than slicing something
 * already held here: growth is measured against the window before the one on
 * screen, which the client has no data for.
 */

const RANGES = [
  { key: '7d', ar: '7 أيام', en: '7 days' },
  { key: '30d', ar: '30 يوم', en: '30 days' },
  { key: '90d', ar: '90 يوم', en: '90 days' },
  { key: '12m', ar: '12 شهر', en: '12 months' },
  { key: 'all', ar: 'الكل', en: 'All' },
];

const PARCEL_LABELS = {
  pending_review: { ar: 'بانتظار مراجعتك', en: 'Pending your review' },
  awaiting_tracking: { ar: 'بانتظار رقم التتبع', en: 'Awaiting tracking' },
  awaiting_handover: { ar: 'جاري التغليف', en: 'Being sealed' },
  ready_for_pickup: { ar: 'في انتظار المندوب', en: 'Waiting for courier' },
  handed_to_courier: { ar: 'اتسلمت للمندوب', en: 'Given to courier' },
  pickup_scheduled: { ar: 'تم جدولة الاستلام', en: 'Pickup scheduled' },
  picked_up: { ar: 'تم الاستلام', en: 'Picked up' },
  in_transit: { ar: 'في الطريق', en: 'In transit' },
  out_for_delivery: { ar: 'خارج للتوصيل', en: 'Out for delivery' },
  delivered: { ar: 'تم التوصيل', en: 'Delivered' },
  returned: { ar: 'مرتجع', en: 'Returned' },
  exception: { ar: 'مشكلة', en: 'Exception' },
  needs_admin: { ar: 'يحتاج الإدارة', en: 'Needs admin' },
  cancelled: { ar: 'ملغي', en: 'Cancelled' },
};

const cardClass =
  'bg-white dark:bg-[#14171A] p-5 rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm';

/** Percentage change beside a headline figure, or an honest blank. */
function Delta({ value, isAr }) {
  if (value === null || value === undefined) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500">
        <Minus size={11} />
        {isAr ? 'لا توجد فترة سابقة' : 'no comparable period'}
      </span>
    );
  }

  const up = value >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
      <Icon size={12} />
      {Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 1 })}%
      <span className="font-medium text-zinc-500 dark:text-zinc-400">
        {isAr ? 'عن السابق' : 'vs prev'}
      </span>
    </span>
  );
}

function StatCard({ icon: Icon, title, value, hint, delta, tone = 'default', href, cta }) {
  const toneClass = {
    default: 'text-zinc-900 dark:text-white',
    money: 'text-emerald-600 dark:text-emerald-400',
    warn: 'text-amber-600 dark:text-amber-400',
  }[tone];

  const body = (
    <>
      <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
        <Icon size={15} />
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <p className={`mt-2 text-3xl font-black tracking-tight ${toneClass}`}>{value}</p>
      {delta && <p className="mt-1.5">{delta}</p>}
      {hint && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
      {cta && (
        <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-marine-primary">
          {cta} <ArrowRight size={12} className="rtl:rotate-180" />
        </span>
      )}
    </>
  );

  if (!href) return <div className={cardClass}>{body}</div>;

  return (
    <Link href={href} className={`${cardClass} block transition-colors hover:border-marine-cyan/40`}>
      {body}
    </Link>
  );
}

/**
 * The inside of a stat card, for panels that want the same headline but need
 * to put something else underneath it (a per-status breakdown, say).
 */
function StatCardBody({ icon: Icon, title, value, sub, hint, tone = 'default' }) {
  const toneClass = {
    default: 'text-zinc-900 dark:text-white',
    brand: 'text-marine-primary',
  }[tone];

  return (
    <>
      <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
        <Icon size={15} />
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <p className={`mt-2 text-3xl font-black tracking-tight ${toneClass}`}>{value}</p>
      {sub && <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-300">{sub}</p>}
      {hint && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </>
  );
}

/** A label-and-number list. The shape most of the smaller panels want. */
function Rows({ items }) {
  return (
    <dl className="space-y-2.5">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline justify-between gap-3">
          <dt className="text-sm text-zinc-500 dark:text-zinc-400 min-w-0 truncate">{item.label}</dt>
          <dd className={`text-sm font-bold tabular-nums whitespace-nowrap ${item.tone || 'text-zinc-900 dark:text-white'}`}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function DashboardIndex() {
  const { siteSettings, language, user } = useApp();
  const isAr = language === 'ar';
  const currency = siteSettings?.currency || 'EGP';

  const [range, setRange] = useState('30d');
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  // Told apart from `loading` so switching period dims the numbers already on
  // screen instead of replacing the whole dashboard with a spinner.
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // Latin digits throughout: these are figures a vendor reconciles against
  // invoices and bank statements, in either language.
  const money = useCallback(
    (amount) => `${currency} ${Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    [currency]
  );
  const count = useCallback((value) => Number(value || 0).toLocaleString('en-US'), []);

  useEffect(() => {
    let cancelled = false;
    setError('');
    setRefreshing(true);

    (async () => {
      try {
        const res = await vendorApi.getStats(range);
        if (!cancelled) setStats(res.stats);
      } catch (err) {
        if (!cancelled) setError(err.message || (isAr ? 'تعذر تحميل الإحصائيات.' : 'Could not load your statistics.'));
      } finally {
        if (!cancelled) { setLoading(false); setRefreshing(false); }
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  // Memoised so the fresh `[]` a missing series falls back to does not
  // re-run the peak calculation on every render.
  const series = useMemo(() => stats?.series || [], [stats]);
  const granularity = stats?.range?.granularity || 'day';

  // The busiest bucket sets the scale, so a quiet week still reads as a shape
  // rather than a row of identical stubs.
  const peak = useMemo(
    () => Math.max(1, ...series.map((point) => Number(point.sales) || 0)),
    [series]
  );

  const bucketLabel = useCallback((key) => {
    const locale = isAr ? 'ar-EG-u-nu-latn' : 'en-GB';
    if (granularity === 'month') {
      return new Date(`${key}-01T00:00:00`).toLocaleDateString(locale, { month: 'short' });
    }
    const date = new Date(`${key}T00:00:00`);
    // A weekday name is only unique inside a single week. Over 30 days the same
    // four labels would repeat across the axis with nothing to tell them apart.
    if (granularity === 'day' && series.length <= 7) {
      return date.toLocaleDateString(locale, { weekday: 'short' });
    }
    return date.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  }, [granularity, isAr, series.length]);

  // A long range would otherwise print a label under every bar and read as a
  // smear, so labels thin out while the bars stay.
  const labelEvery = Math.max(1, Math.ceil(series.length / 12));

  const handleExport = () => {
    if (!stats) return;
    exportVendorReportPdf(stats, {
      language,
      currency,
      storeName: stats.store?.name || user?.store_name || user?.name || '',
    });
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-marine-primary" />
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="p-2">
        <div className="bg-white dark:bg-[#14171A] rounded-xl border border-red-200 dark:border-red-500/20 p-8 text-center">
          <AlertCircle size={26} className="text-red-500 mx-auto mb-3" />
          <p className="text-sm text-zinc-700 dark:text-zinc-200">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 rounded-lg text-sm font-bold border border-zinc-200 dark:border-white/10 hover:border-marine-cyan hover:text-marine-primary transition-colors"
          >
            {isAr ? 'حاول مرة أخرى' : 'Try again'}
          </button>
        </div>
      </div>
    );
  }

  const noSalesYet = stats.orders.lifetime === 0;
  const rangeName = (RANGES.find((r) => r.key === range) || RANGES[1])[isAr ? 'ar' : 'en'];

  return (
    <div className="p-2 animate-in fade-in duration-300">
      {/* ---- Header: period + export ---- */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white mb-1">
            {isAr ? 'ملخص لوحة التحكم' : 'Dashboard Summary'}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {isAr
              ? 'الأرقام دي من طلبات متجرك فعلياً. الطلبات الملغية والمرتجعة مش محسوبة في المبيعات.'
              : "Your store's own figures. Cancelled and returned orders are not counted in sales."}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg border border-zinc-200 dark:border-white/10 p-0.5 bg-white dark:bg-[#14171A]">
            {RANGES.map((option) => (
              <button
                key={option.key}
                onClick={() => setRange(option.key)}
                disabled={refreshing}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors disabled:opacity-60 ${
                  range === option.key
                    ? 'bg-marine-cyan text-white'
                    : 'text-zinc-600 dark:text-zinc-300 hover:text-marine-primary'
                }`}
              >
                {isAr ? option.ar : option.en}
              </button>
            ))}
          </div>

          <button
            onClick={handleExport}
            disabled={refreshing}
            title={isAr ? 'يفتح نافذة الطباعة — اختر "حفظ كـ PDF"' : 'Opens the print dialog — choose "Save as PDF"'}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <FileDown size={14} />
            {isAr ? 'تصدير PDF' : 'Export PDF'}
          </button>
        </div>
      </div>

      {/* A failed refresh keeps the last good numbers on screen and says so,
          rather than throwing away a dashboard the vendor was reading. */}
      {error && stats && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
          <AlertCircle size={15} /> {error}
        </div>
      )}

      <div className={refreshing ? 'opacity-60 transition-opacity pointer-events-none' : 'transition-opacity'}>
        {/* ---- Headline numbers for the period ---- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
          <StatCard
            icon={TrendingUp}
            // Delivered parcels only, by delivery date. What has not arrived yet is in the
            // "On its way" section below and is never added in here.
            title={`${isAr ? 'مبيعات اتسلمت' : 'Delivered sales'} · ${rangeName}`}
            value={money(stats.sales.period)}
            delta={<Delta value={stats.sales.growth_pct} isAr={isAr} />}
            hint={isAr
              ? `صافي ${money(stats.sales.net)} بعد عمولة ${money(stats.sales.commission)}${Number(stats.sales.coupon_share) > 0 ? ` ونصيبك من الكوبونات ${money(stats.sales.coupon_share)}` : ''} · اللي لسه ماتسلمش مش محسوب`
              : `${money(stats.sales.net)} net after ${money(stats.sales.commission)} commission${Number(stats.sales.coupon_share) > 0 ? ` and ${money(stats.sales.coupon_share)} your share of coupons` : ''} · undelivered orders not counted`}
            tone="money"
          />
          <StatCard
            icon={Receipt}
            title={`${isAr ? 'طلبات اتسلمت' : 'Delivered orders'} · ${rangeName}`}
            value={count(stats.orders.period)}
            delta={<Delta value={stats.orders.growth_pct} isAr={isAr} />}
            hint={isAr
              ? `متوسط الطلب ${money(stats.sales.avg_order_value)} · ${count(stats.orders.units_sold)} قطعة`
              : `${money(stats.sales.avg_order_value)} average · ${count(stats.orders.units_sold)} units`}
          />
          <StatCard
            icon={Wallet}
            title={isAr ? 'رصيد قابل للسحب' : 'Available to withdraw'}
            value={money(stats.earnings.available)}
            hint={isAr
              ? `${money(stats.earnings.pending)} قيد الانتظار · ${money(stats.earnings.reserved)} محجوز`
              : `${money(stats.earnings.pending)} pending · ${money(stats.earnings.reserved)} reserved`}
            href="/dashboard/wallet"
            cta={isAr ? 'المحفظة' : 'Wallet'}
          />
          <StatCard
            icon={ShoppingBag}
            title={isAr ? 'طلبات تنتظر مراجعتك' : 'Orders awaiting you'}
            value={count(stats.orders.awaiting_action)}
            hint={isAr
              ? `${count(stats.orders.lifetime)} طلب اتسلم إجمالاً`
              : `${count(stats.orders.lifetime)} delivered in total`}
            tone={stats.orders.awaiting_action > 0 ? 'warn' : 'default'}
            href="/dashboard/orders"
            cta={stats.orders.awaiting_action > 0 ? (isAr ? 'راجعها الآن' : 'Review them') : (isAr ? 'الطلبات' : 'Orders')}
          />
        </div>

        {/* ---- Second row: the softer signals ---- */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <StatCard
            icon={Users}
            title={isAr ? 'عملاء الفترة' : 'Customers'}
            value={count(stats.customers.unique)}
            hint={isAr
              ? `${count(stats.customers.repeat)} متكرر (${stats.customers.repeat_pct}%)`
              : `${count(stats.customers.repeat)} repeat (${stats.customers.repeat_pct}%)`}
          />
          <StatCard
            icon={RotateCcw}
            title={isAr ? 'المرتجعات' : 'Returns'}
            value={count(stats.returns.total)}
            hint={isAr
              ? `${stats.returns.rate_pct}% من الطلبات اللي اتسلمت في الفترة`
              : `${stats.returns.rate_pct}% of orders delivered in the period`}
            tone={stats.returns.awaiting_vendor > 0 ? 'warn' : 'default'}
            href="/dashboard/returns"
            cta={stats.returns.awaiting_vendor > 0
              ? (isAr ? `${count(stats.returns.awaiting_vendor)} بانتظارك` : `${count(stats.returns.awaiting_vendor)} awaiting you`)
              : (isAr ? 'المرتجعات' : 'Returns')}
          />
          <StatCard
            icon={Star}
            title={isAr ? 'تقييم المتجر' : 'Store rating'}
            value={stats.reviews.count ? `${stats.reviews.rating.toFixed(1)} / 5` : '—'}
            hint={stats.reviews.count
              ? (isAr ? `${count(stats.reviews.count)} تقييم معتمد` : `${count(stats.reviews.count)} approved reviews`)
              : (isAr ? 'لا توجد تقييمات بعد' : 'No reviews yet')}
          />
          <StatCard
            icon={Package}
            title={isAr ? 'منتجات منشورة' : 'Published products'}
            value={count(stats.products.published)}
            hint={isAr
              ? `${count(stats.products.pending)} قيد المراجعة · ${count(stats.products.draft)} مسودة`
              : `${count(stats.products.pending)} pending · ${count(stats.products.draft)} draft`}
            href="/dashboard/products"
            cta={isAr ? 'المنتجات' : 'Products'}
          />
        </div>

        {/* ---- In flight: committed, not landed. Not bounded by the range —
            a parcel sealed six weeks ago and still waiting for a courier is the
            one the vendor most needs to see. ---- */}
        <div className="mb-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h2 className="text-base font-black text-zinc-900 dark:text-white">
              {isAr ? 'في الطريق' : 'On its way'}
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {isAr
                ? 'مبالغ لسه ما وصلتش — دلوقتي، مش حسب الفترة المختارة'
                : 'Committed but not landed — as of now, not the selected period'}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              {
                key: 'at_vendor',
                icon: PackageOpen,
                title: isAr ? 'لسه عندك' : 'Still with you',
              },
              {
                key: 'in_transit',
                icon: Truck,
                title: isAr ? 'خرجت ولسه ما وصلتش' : 'Shipped, not delivered',
              },
            ].map((stage) => {
              const data = stats.in_flight?.[stage.key] || { parcels: 0, orders: 0, merchandise: 0, collectable: 0, by_status: {} };
              // Which statuses fall in which stage is the server's call, so the
              // split here is read off the response rather than re-declared.
              const breakdown = Object.entries(data.by_status || {})
                .filter(([, v]) => v.parcels > 0)
                .sort(([, a], [, b]) => b.parcels - a.parcels)
                .map(([status, v]) => ({
                  label: (PARCEL_LABELS[status] || { ar: status, en: status })[isAr ? 'ar' : 'en'],
                  value: `${count(v.parcels)} · ${money(v.merchandise)}`,
                }));
              return (
                <div key={stage.key} className={cardClass}>
                  <StatCardBody
                    icon={stage.icon}
                    title={stage.title}
                    value={money(data.merchandise)}
                    tone={data.parcels > 0 ? 'brand' : 'default'}
                    sub={isAr
                      ? `${count(data.parcels)} طرد · ${count(data.orders)} أوردر`
                      : `${count(data.parcels)} parcel(s) · ${count(data.orders)} order(s)`}
                    hint={isAr
                      ? `قيمة البضاعة. التحصيل من العميل ${money(data.collectable)} بالشحن.`
                      : `Merchandise value. ${money(data.collectable)} collectable from the customer including shipping.`}
                  />
                  {breakdown.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-white/5">
                      <Rows items={breakdown} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Stock is the one figure here that costs money by the hour, so it is
            raised out of the catalogue panel and shown as something to act on. */}
        {(stats.products.out_of_stock > 0 || stats.products.low_stock > 0) && (
          <Link
            href="/dashboard/products"
            className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-5 py-3.5 text-sm dark:border-amber-500/20 dark:bg-amber-500/10 transition-colors hover:border-amber-400"
          >
            <span className="inline-flex items-center gap-2 font-bold text-amber-700 dark:text-amber-300">
              <Boxes size={16} />
              {isAr ? 'تنبيه المخزون' : 'Stock alert'}
            </span>
            {stats.products.out_of_stock > 0 && (
              <span className="text-amber-700 dark:text-amber-300">
                {isAr
                  ? `${count(stats.products.out_of_stock)} منتج نفد مخزونه`
                  : `${count(stats.products.out_of_stock)} out of stock`}
              </span>
            )}
            {stats.products.low_stock > 0 && (
              <span className="text-amber-700 dark:text-amber-300">
                {isAr
                  ? `${count(stats.products.low_stock)} منتج مخزونه على وشك النفاد`
                  : `${count(stats.products.low_stock)} running low`}
              </span>
            )}
            <ArrowRight size={14} className="text-amber-700 dark:text-amber-300 rtl:rotate-180 ms-auto" />
          </Link>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          {/* ---- Trend ---- */}
          <div className={`${cardClass} lg:col-span-2`}>
            <div className="flex items-baseline justify-between mb-5">
              <h2 className="font-bold text-zinc-900 dark:text-white">
                {isAr ? 'اتجاه المبيعات' : 'Sales trend'}
              </h2>
              <span className="text-xs text-zinc-500">
                {isAr ? 'حسب تاريخ التسليم' : 'by delivery date'}
              </span>
            </div>

            <div className="flex items-end justify-between gap-1 h-44">
              {series.map((point, index) => (
                <div key={point.date} className="flex-1 flex flex-col items-center gap-2 min-w-0">
                  <div
                    title={`${bucketLabel(point.date)} · ${money(point.sales)} · ${count(point.orders)} ${isAr ? 'طلب' : 'orders'}`}
                    className={`w-full rounded-t transition-all ${point.sales > 0 ? 'bg-marine-cyan' : 'bg-zinc-200 dark:bg-white/10'}`}
                    // A bucket with no sales keeps a 2px stub so the row reads
                    // as a period rather than as missing data.
                    style={{ height: `${point.sales > 0 ? Math.max(4, (point.sales / peak) * 100) : 2}%` }}
                  />
                  <span className="text-[10px] text-zinc-500 truncate w-full text-center h-3">
                    {index % labelEvery === 0 ? bucketLabel(point.date) : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* ---- Top products ---- */}
          <div className={cardClass}>
            <h2 className="font-bold text-zinc-900 dark:text-white mb-4">
              {isAr ? 'الأكثر مبيعاً' : 'Top products'}
            </h2>

            {stats.top_products.length === 0 ? (
              <div className="py-8 text-center">
                <Package size={22} className="text-zinc-300 dark:text-zinc-600 mx-auto mb-2" />
                <p className="text-sm text-zinc-500">
                  {isAr ? 'مفيش منتجات اتسلمت في الفترة دي.' : 'Nothing delivered in this period.'}
                </p>
              </div>
            ) : (
              <ol className="space-y-3">
                {stats.top_products.map((product, index) => (
                  <li key={product.product_id}>
                    <Link
                      href={`/dashboard/products/${product.product_id}`}
                      className="flex items-center justify-between gap-3 group"
                    >
                      <span className="min-w-0 flex items-baseline gap-2">
                        <span className="text-xs font-black text-zinc-300 dark:text-zinc-600 tabular-nums">
                          {index + 1}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-bold text-zinc-900 dark:text-white truncate group-hover:text-marine-primary transition-colors">
                            {product.title}
                          </span>
                          <span className="block text-[11px] text-zinc-500">
                            {count(product.units)} {isAr ? 'قطعة' : 'units'}
                          </span>
                        </span>
                      </span>
                      <span className="text-sm font-bold text-zinc-700 dark:text-zinc-200 whitespace-nowrap tabular-nums">
                        {money(product.revenue)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {/* ---- Returns breakdown ---- */}
          <div className={cardClass}>
            <h2 className="font-bold text-zinc-900 dark:text-white mb-4">
              {isAr ? 'تفاصيل المرتجعات' : 'Returns breakdown'}
            </h2>
            <Rows items={[
              { label: isAr ? 'بانتظار مراجعتك' : 'Awaiting your review', value: count(stats.returns.awaiting_vendor), tone: stats.returns.awaiting_vendor > 0 ? 'text-amber-600 dark:text-amber-400' : undefined },
              { label: isAr ? 'قيد التنفيذ' : 'In progress', value: count(stats.returns.in_progress) },
              { label: isAr ? 'مكتملة' : 'Completed', value: count(stats.returns.completed) },
              { label: isAr ? 'مرفوضة' : 'Rejected', value: count(stats.returns.rejected) },
              { label: isAr ? 'طلبات ملغية' : 'Cancelled orders', value: count(stats.orders.cancelled) },
            ]} />
          </div>

          {/* ---- Parcels ---- */}
          <div className={cardClass}>
            <h2 className="font-bold text-zinc-900 dark:text-white mb-4">
              {isAr ? 'حالة الشحنات' : 'Parcel status'}
            </h2>
            {stats.parcels.length === 0 ? (
              <p className="text-sm text-zinc-500 py-4">
                {isAr ? 'لا توجد شحنات في هذه الفترة.' : 'No parcels in this period.'}
              </p>
            ) : (
              <Rows items={stats.parcels.map((parcel) => ({
                label: (PARCEL_LABELS[parcel.status] || { ar: parcel.status, en: parcel.status })[isAr ? 'ar' : 'en'],
                value: count(parcel.count),
              }))} />
            )}
          </div>

          {/* ---- Rating distribution ---- */}
          <div className={cardClass}>
            <h2 className="font-bold text-zinc-900 dark:text-white mb-4">
              {isAr ? 'توزيع التقييمات' : 'Rating breakdown'}
            </h2>
            {stats.reviews.count === 0 ? (
              <p className="text-sm text-zinc-500 py-4">
                {isAr ? 'لا توجد تقييمات معتمدة بعد.' : 'No approved reviews yet.'}
              </p>
            ) : (
              <div className="space-y-2">
                {stats.reviews.distribution.map((bucket) => (
                  <div key={bucket.star} className="flex items-center gap-2">
                    <span className="w-8 text-xs text-zinc-500 tabular-nums shrink-0">
                      {bucket.star} ★
                    </span>
                    <span className="flex-1 h-2 rounded-full bg-zinc-100 dark:bg-white/10 overflow-hidden">
                      <span className="block h-full rounded-full bg-amber-400" style={{ width: `${bucket.pct}%` }} />
                    </span>
                    <span className="w-6 text-xs font-bold text-zinc-700 dark:text-zinc-200 tabular-nums text-end shrink-0">
                      {count(bucket.count)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ---- Recent orders ---- */}
          <div className={cardClass}>
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="font-bold text-zinc-900 dark:text-white">
                {isAr ? 'أحدث الطلبات' : 'Recent orders'}
              </h2>
              {stats.recent_orders.length > 0 && (
                <Link href="/dashboard/orders" className="text-xs font-bold text-marine-primary">
                  {isAr ? 'الكل' : 'All'}
                </Link>
              )}
            </div>

            {stats.recent_orders.length === 0 ? (
              <div className="py-8 text-center">
                <Clock size={22} className="text-zinc-300 dark:text-zinc-600 mx-auto mb-2" />
                <p className="text-sm text-zinc-500">
                  {isAr ? 'لا توجد طلبات بعد.' : 'No orders yet.'}
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {stats.recent_orders.map((order) => (
                  <li key={order._id}>
                    <Link href="/dashboard/orders" className="flex items-center justify-between gap-3 group">
                      <span className="min-w-0">
                        <span className="block text-sm font-bold text-zinc-900 dark:text-white truncate group-hover:text-marine-primary transition-colors">
                          {order.reference}
                        </span>
                        <span className={`inline-block mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded ${getOrderStatusColor(order.status)}`}>
                          {getOrderStatusLabel(order.status, isAr)}
                        </span>
                      </span>
                      <span className="text-sm font-bold text-zinc-700 dark:text-zinc-200 whitespace-nowrap tabular-nums">
                        {money(order.total)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* A new store must not be left staring at zeros wondering what broke. */}
        {noSalesYet && (
          <div className="mt-6 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/5 rounded-xl p-5 text-center">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              {isAr
                ? 'لسه مفيش طلبات — الأرقام هتتحرك أول ما يوصلك أول طلب.'
                : 'No orders yet — these figures start moving with your first one.'}
            </p>
            {stats.products.published === 0 && (
              <Link
                href="/dashboard/products/add"
                className="inline-flex items-center gap-2 mt-3 bg-marine-cyan hover:bg-marine-cyan-dark text-white px-5 py-2.5 rounded-lg text-sm font-bold transition-colors"
              >
                {isAr ? 'أضف أول منتج' : 'Add your first product'}
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
