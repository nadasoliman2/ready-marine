'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Eye, MousePointerClick, Zap, Users } from 'lucide-react';

/**
 * What one ad did: impressions, clicks, actions — by day, by placement, by device.
 * Shared by the admin's ad screen and the vendor's ad screen; `load(params)` is the only
 * thing that differs between them (which endpoint answers).
 *
 * Series colors are the validated three-slot categorical palette (blue / orange / aqua),
 * stepped separately for light and dark surfaces. Aqua sits below 3:1 on the light
 * surface, which is why every bar carries its number and a day table sits under the chart.
 */

const SERIES = [
  { key: 'impressions', en: 'Impressions', ar: 'مشاهدات', light: '#2a78d6', dark: '#3987e5' },
  { key: 'clicks', en: 'Clicks', ar: 'كليكات', light: '#eb6834', dark: '#d95926' },
  { key: 'actions', en: 'Actions', ar: 'إجراءات', light: '#1baf7a', dark: '#199e70' },
];

const ACTION_LABELS = {
  open: { en: 'Opened the ad', ar: 'فتح الإعلان' },
  view_product: { en: 'Viewed product', ar: 'شاف المنتج' },
  add_to_cart: { en: 'Added to cart', ar: 'أضاف للسلة' },
  buy_now: { en: 'Buy now', ar: 'اشتري الآن' },
  checkout: { en: 'Reached checkout', ar: 'وصل للدفع' },
  order_placed: { en: 'Placed an order', ar: 'عمل أوردر' },
  visit_store: { en: 'Visited store', ar: 'زار المتجر' },
  whatsapp: { en: 'WhatsApp', ar: 'واتساب' },
  call: { en: 'Phone call', ar: 'اتصال' },
  view_service: { en: 'Viewed service', ar: 'شاف الخدمة' },
};

const PLACEMENT_LABELS = {
  home_banner: { en: 'Home banner', ar: 'بانر الرئيسية' },
  services_banner: { en: 'Services banner', ar: 'بانر الخدمات' },
  banners: { en: 'Banner slot', ar: 'مكان البانر' },
  promoted_section: { en: 'Promoted section', ar: 'قسم المميز' },
  category_top: { en: 'Top of category', ar: 'أعلى الفئة' },
  shop_top: { en: 'Top of shop', ar: 'أعلى المتجر' },
  most_sold: { en: 'Most sold', ar: 'الأكثر مبيعاً' },
  new_arrivals: { en: 'New arrivals', ar: 'وصل حديثاً' },
  special_offers: { en: 'Special offers', ar: 'عروض خاصة' },
  home: { en: 'Home vendors strip', ar: 'شريط التجار بالرئيسية' },
  vendors_page: { en: 'Vendors page', ar: 'صفحة التجار' },
  unknown: { en: 'Other', ar: 'أخرى' },
};

const DEVICE_LABELS = {
  mobile: { en: 'Mobile', ar: 'موبايل' },
  tablet: { en: 'Tablet', ar: 'تابلت' },
  desktop: { en: 'Desktop', ar: 'كمبيوتر' },
  unknown: { en: 'Unknown', ar: 'غير معروف' },
};

const RANGES = [
  { key: '7d', en: 'Last 7 days', ar: 'آخر 7 أيام', days: 7 },
  { key: '30d', en: 'Last 30 days', ar: 'آخر 30 يوم', days: 30 },
  { key: 'all', en: 'Whole ad', ar: 'كل المدة', days: null },
];

const label = (map, key, isAr) => {
  const row = map[key];
  if (!row) return key || (isAr ? 'أخرى' : 'Other');
  return isAr ? row.ar : row.en;
};

const isoDay = (d) => d.toISOString().slice(0, 10);

export default function AdAnalyticsPanel({ load, isAr = false, compact = false }) {
  const [range, setRange] = useState('30d');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hover, setHover] = useState(null);

  const params = useMemo(() => {
    if (range === 'custom') return { from: custom.from, to: custom.to };
    const r = RANGES.find((x) => x.key === range);
    if (!r?.days) return {};
    const to = new Date();
    const from = new Date(Date.now() - (r.days - 1) * 86400000);
    return { from: isoDay(from), to: isoDay(to) };
  }, [range, custom]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    load(params)
      .then((data) => { if (alive) setReport(data); })
      .catch((e) => { if (alive) setError(e?.message || 'Failed'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [load, params]);

  const totals = report?.totals || {};
  const days = report?.by_day || [];
  const max = Math.max(1, ...days.flatMap((d) => SERIES.map((s) => d[s.key] || 0)));

  const tiles = [
    { icon: Eye, en: 'Impressions', ar: 'مشاهدات', value: totals.impressions || 0, sub: `${totals.unique_viewers || 0} ${isAr ? 'شخص' : 'people'}` },
    { icon: MousePointerClick, en: 'Clicks', ar: 'كليكات', value: totals.clicks || 0, sub: `${totals.unique_clickers || 0} ${isAr ? 'شخص' : 'people'}` },
    { icon: Zap, en: 'Actions', ar: 'إجراءات', value: totals.actions || 0, sub: isAr ? 'بعد الكليك' : 'after the click' },
    { icon: Users, en: 'CTR', ar: 'نسبة النقر', value: `${totals.ctr ?? 0}%`, sub: `${isAr ? 'تفاعل' : 'engagement'} ${totals.engagement_rate ?? 0}%` },
  ];

  return (
    <div className="space-y-5">
      {/* Range */}
      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${range === r.key ? 'bg-marine-cyan text-white' : 'bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-white/10'}`}
          >
            {isAr ? r.ar : r.en}
          </button>
        ))}
        <div className="flex items-center gap-1.5">
          <input type="date" value={custom.from} onChange={(e) => { setCustom((c) => ({ ...c, from: e.target.value })); setRange('custom'); }} className="text-xs rounded-lg border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0E1012] px-2 py-1.5 dark:text-white" />
          <span className="text-zinc-400 text-xs">→</span>
          <input type="date" value={custom.to} onChange={(e) => { setCustom((c) => ({ ...c, to: e.target.value })); setRange('custom'); }} className="text-xs rounded-lg border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0E1012] px-2 py-1.5 dark:text-white" />
        </div>
        {loading && <Loader2 size={14} className="animate-spin text-zinc-400" />}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Headline numbers */}
      <div className={`grid gap-3 ${compact ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-4'}`}>
        {tiles.map((t) => (
          <div key={t.en} className="rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/[0.03] p-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-500 uppercase tracking-wide">
              <t.icon size={13} /> {isAr ? t.ar : t.en}
            </div>
            <p className="text-2xl font-black text-zinc-900 dark:text-white mt-1">{t.value}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{t.sub}</p>
          </div>
        ))}
      </div>

      {/* By day */}
      <div className="rounded-xl border border-zinc-200 dark:border-white/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h4 className="text-sm font-bold text-zinc-900 dark:text-white">{isAr ? 'يوم بيوم' : 'Day by day'}</h4>
          <ul className="flex items-center gap-3">
            {SERIES.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
                <span className="inline-block w-2.5 h-2.5 rounded-sm dark:hidden" style={{ background: s.light }} />
                <span className="hidden dark:inline-block w-2.5 h-2.5 rounded-sm" style={{ background: s.dark }} />
                {isAr ? s.ar : s.en}
              </li>
            ))}
          </ul>
        </div>
        {days.length === 0 ? (
          <p className="text-sm text-zinc-500 py-6 text-center">{isAr ? 'لا توجد بيانات في الفترة دي' : 'No data in this period'}</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="flex items-end gap-2 h-40 min-w-max px-1" dir="ltr">
              {days.map((d) => (
                <div
                  key={d.day}
                  className="flex flex-col items-center gap-1 relative"
                  onMouseEnter={() => setHover(d.day)}
                  onMouseLeave={() => setHover(null)}
                >
                  {hover === d.day && (
                    <div className="absolute -top-16 z-10 rounded-lg bg-zinc-900 text-white text-[11px] px-2 py-1.5 whitespace-nowrap shadow-lg">
                      <div className="font-bold">{d.day}</div>
                      {SERIES.map((s) => <div key={s.key}>{isAr ? s.ar : s.en}: {d[s.key] || 0}</div>)}
                    </div>
                  )}
                  <div className="flex items-end gap-[2px] h-32">
                    {SERIES.map((s) => {
                      const v = d[s.key] || 0;
                      const h = Math.max(v ? 3 : 0, Math.round((v / max) * 120));
                      return (
                        <div key={s.key} className="flex flex-col items-center justify-end w-3 h-full">
                          {v > 0 && <span className="text-[9px] text-zinc-500 leading-none mb-0.5">{v}</span>}
                          <div className="w-3 rounded-t-[4px] dark:hidden" style={{ height: h, background: s.light }} />
                          <div className="w-3 rounded-t-[4px] hidden dark:block" style={{ height: h, background: s.dark }} />
                        </div>
                      );
                    })}
                  </div>
                  <span className="text-[10px] text-zinc-500">{d.day.slice(5)}</span>
                </div>
              ))}
            </div>
            <table className="mt-3 w-full text-xs">
              <thead>
                <tr className="text-zinc-500">
                  <th className="text-start font-bold py-1">{isAr ? 'اليوم' : 'Day'}</th>
                  {SERIES.map((s) => <th key={s.key} className="text-end font-bold py-1">{isAr ? s.ar : s.en}</th>)}
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.day} className="border-t border-zinc-100 dark:border-white/5 text-zinc-700 dark:text-zinc-200">
                    <td className="py-1 font-mono">{d.day}</td>
                    {SERIES.map((s) => <td key={s.key} className="py-1 text-end">{d[s.key] || 0}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={`grid gap-4 ${compact ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'}`}>
        {/* By placement */}
        <Section title={isAr ? 'حسب مكان العرض' : 'By placement'} isAr={isAr}>
          <Table
            rows={report?.by_placement || []}
            cols={[
              { key: 'placement', en: 'Placement', ar: 'المكان', render: (r) => label(PLACEMENT_LABELS, r.placement, isAr) },
              { key: 'impressions', en: 'Views', ar: 'مشاهدات', num: true },
              { key: 'clicks', en: 'Clicks', ar: 'كليكات', num: true },
              { key: 'ctr', en: 'CTR', ar: 'نسبة', num: true, render: (r) => `${r.ctr}%` },
            ]}
            isAr={isAr}
          />
        </Section>

        {/* What people did */}
        <Section title={isAr ? 'إيه اللي الناس عملته' : 'What people did'} isAr={isAr}>
          <Table
            rows={report?.by_action || []}
            cols={[
              { key: 'action', en: 'Action', ar: 'الإجراء', render: (r) => label(ACTION_LABELS, r.action, isAr) },
              { key: 'count', en: 'Times', ar: 'مرات', num: true },
            ]}
            isAr={isAr}
          />
        </Section>

        {/* Devices + audience */}
        <Section title={isAr ? 'الأجهزة' : 'Devices'} isAr={isAr}>
          <Table
            rows={report?.by_device || []}
            cols={[
              { key: 'device', en: 'Device', ar: 'الجهاز', render: (r) => label(DEVICE_LABELS, r.device, isAr) },
              { key: 'impressions', en: 'Views', ar: 'مشاهدات', num: true },
              { key: 'clicks', en: 'Clicks', ar: 'كليكات', num: true },
            ]}
            isAr={isAr}
          />
          {report?.audience && (
            <p className="text-xs text-zinc-500 mt-3">
              {isAr ? 'مسجلين دخول: ' : 'Signed in: '}
              <strong className="text-zinc-800 dark:text-zinc-100">{report.audience.signed_in.impressions}</strong> {isAr ? 'مشاهدة' : 'views'}, {report.audience.signed_in.clicks} {isAr ? 'كليك' : 'clicks'}
              {' · '}
              {isAr ? 'زوار: ' : 'Guests: '}
              <strong className="text-zinc-800 dark:text-zinc-100">{report.audience.guest.impressions}</strong> {isAr ? 'مشاهدة' : 'views'}, {report.audience.guest.clicks} {isAr ? 'كليك' : 'clicks'}
            </p>
          )}
        </Section>

        {/* Pages */}
        <Section title={isAr ? 'الصفحات اللي اتشاف فيها' : 'Pages it was seen on'} isAr={isAr}>
          <Table
            rows={report?.by_page || []}
            cols={[
              { key: 'page', en: 'Page', ar: 'الصفحة', render: (r) => <span dir="ltr" className="font-mono">{r.page || '/'}</span> },
              { key: 'impressions', en: 'Views', ar: 'مشاهدات', num: true },
            ]}
            isAr={isAr}
          />
        </Section>
      </div>

      {totals.last_event_at && (
        <p className="text-xs text-zinc-500">
          {isAr ? 'آخر حدث: ' : 'Last event: '}{new Date(totals.last_event_at).toLocaleString(isAr ? 'ar-EG' : 'en-GB')}
        </p>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-white/10 p-4">
      <h4 className="text-sm font-bold text-zinc-900 dark:text-white mb-2">{title}</h4>
      {children}
    </div>
  );
}

function Table({ rows, cols, isAr }) {
  if (!rows.length) return <p className="text-xs text-zinc-500 py-3">{isAr ? 'لا توجد بيانات' : 'No data yet'}</p>;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-zinc-500">
          {cols.map((c) => <th key={c.key} className={`font-bold py-1 ${c.num ? 'text-end' : 'text-start'}`}>{isAr ? c.ar : c.en}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-zinc-100 dark:border-white/5 text-zinc-700 dark:text-zinc-200">
            {cols.map((c) => <td key={c.key} className={`py-1.5 ${c.num ? 'text-end' : ''}`}>{c.render ? c.render(r) : r[c.key]}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
