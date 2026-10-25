'use client';

import { useEffect, useState, useCallback } from 'react';
import { useApp } from '../../../../context/AppContext';
import { adminAdApi } from '../../../../lib/api';
import { resolveAssetUrl } from '../../../../lib/assets';
import { Megaphone, Loader2, ChevronLeft, ChevronRight, X, Check, Ban, PowerOff, ExternalLink, Eye, MousePointerClick, BarChart3 } from 'lucide-react';
import AdAnalyticsPanel from '../../../../components/dashboard/AdAnalyticsPanel';
import Overlay from '../../../../components/Overlay';

const STATUS_COLORS = {
  pending: 'bg-amber-500/20 text-amber-500',
  approved: 'bg-emerald-500/20 text-emerald-500',
  rejected: 'bg-red-500/20 text-red-500',
  cancelled: 'bg-zinc-500/20 text-zinc-500',
  expired: 'bg-zinc-500/20 text-zinc-500',
};

const STATUS_LABELS = {
  pending: { en: 'Pending', ar: 'قيد المراجعة' },
  approved: { en: 'Live / Approved', ar: 'منشور' },
  rejected: { en: 'Rejected', ar: 'مرفوض' },
  cancelled: { en: 'Cancelled', ar: 'ملغي' },
  expired: { en: 'Expired', ar: 'منتهي' },
};

const TYPE_LABELS = {
  banner: { en: 'Banner', ar: 'بانر' },
  product_visibility: { en: 'Product Visibility', ar: 'إبراز منتج' },
  featured_vendor: { en: 'Featured Vendor', ar: 'بائع مميّز' },
};
const PLACEMENT_LABELS = {
  category_top: { en: 'Category top', ar: 'أعلى التصنيف' },
  shop_top: { en: 'All products top', ar: 'أعلى المنتجات' },
  promoted_section: { en: 'Promoted row', ar: 'صف مموّل' },
  most_sold: { en: 'Most Sold', ar: 'الأكثر مبيعًا' },
  new_arrivals: { en: 'New Arrivals', ar: 'وصل حديثًا' },
  special_offers: { en: 'Special Offers', ar: 'العروض' },
  home: { en: 'Homepage slider', ar: 'سلايدر الرئيسية' },
  vendors_page: { en: 'Vendors directory', ar: 'دليل البائعين' },
};
const typeText = (ad, isAr) => {
  if (ad.type === 'banner' && ad.subject_type === 'service') return isAr ? 'بانر خدمة' : 'Service Banner';
  return (isAr ? TYPE_LABELS[ad.type]?.ar : TYPE_LABELS[ad.type]?.en) || ad.type;
};
const placementText = (keys, isAr) => (keys || []).map((k) => (isAr ? PLACEMENT_LABELS[k]?.ar : PLACEMENT_LABELS[k]?.en) || k).join(', ');

// Local YYYY-MM-DD for date inputs.
const isoDay = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

export default function AdminAdRequestsPage() {
  const { language } = useApp();
  const isAr = language === 'ar';

  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1 });
  const [selected, setSelected] = useState(null);
  const selectedId = selected?._id;
  const loadAnalytics = useCallback((params) => adminAdApi.getAnalytics(selectedId, params), [selectedId]);
  const [mode, setMode] = useState(null); // 'approve' | 'reject'
  const [startDate, setStartDate] = useState(isoDay(0));
  const [endDate, setEndDate] = useState(isoDay(7));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const limit = 20;

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

  useEffect(() => { load(); }, [page, statusFilter]);

  const load = async () => {
    try {
      setLoading(true);
      const data = await adminAdApi.getAll({ page, limit, status: statusFilter });
      setAds(data.ads || []);
      setPagination(data.pagination || { total: 0, pages: 1 });
    } catch (_) {
    } finally {
      setLoading(false);
    }
  };

  const openDetail = (ad) => {
    setSelected(ad);
    setMode(null);
    setReason('');
    setStartDate(isoDay(0));
    setEndDate(isoDay(7));
    setError('');
  };

  const runAction = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      setSelected(null);
      setMode(null);
      await load();
    } catch (err) {
      setError(err.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const approve = (ad) => runAction(() => adminAdApi.approve(ad._id, { start_date: startDate, end_date: endDate }));
  const reject = (ad) => runAction(() => adminAdApi.reject(ad._id, { reason }));
  const takedown = (ad) => runAction(() => adminAdApi.takedown(ad._id));

  return (
    <div className="space-y-6" dir={isAr ? 'rtl' : 'ltr'}>
      <div>
        <h1 className="text-2xl font-black text-zinc-900 dark:text-white flex items-center gap-3">
          <Megaphone size={24} />
          {isAr ? 'طلبات الإعلانات' : 'Ad Requests'}
        </h1>
        <p className="text-sm text-zinc-500 mt-1">{isAr ? `${pagination.total} طلب` : `${pagination.total} requests`}</p>
      </div>

      <div className="flex gap-3">
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2.5 bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl text-sm text-zinc-900 dark:text-white">
          <option value="">{isAr ? 'كل الحالات' : 'All Statuses'}</option>
          {Object.keys(STATUS_LABELS).map((s) => (
            <option key={s} value={s}>{isAr ? STATUS_LABELS[s].ar : STATUS_LABELS[s].en}</option>
          ))}
        </select>
      </div>

      <div className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-16 flex items-center justify-center"><Loader2 size={28} className="animate-spin text-marine-primary" /></div>
        ) : ads.length === 0 ? (
          <div className="p-12 text-center text-zinc-500">
            <Megaphone size={32} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">{isAr ? 'لا توجد طلبات إعلانات.' : 'No ad requests.'}</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-white/5">
            {ads.map((ad) => (
              <div key={ad._id} className="flex items-center gap-4 px-5 py-4 hover:bg-zinc-50 dark:hover:bg-white/[0.01]">
                <div className="w-28 h-16 rounded-lg overflow-hidden bg-zinc-100 dark:bg-white/5 flex-shrink-0 flex items-center justify-center text-zinc-300">
                  {ad.banner_image ? <img src={resolveAssetUrl(ad.banner_image)} alt="" className="w-full h-full object-cover" /> : <Megaphone size={20} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold bg-zinc-500/15 text-zinc-600 dark:text-zinc-300">{typeText(ad, isAr)}</span>
                    <span className="font-mono text-xs text-zinc-500">{ad.ad_number}</span>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold ${STATUS_COLORS[ad.status] || ''}`}>
                      {isAr ? STATUS_LABELS[ad.status]?.ar : STATUS_LABELS[ad.status]?.en}
                    </span>
                  </div>
                  <p className="text-sm font-bold text-zinc-900 dark:text-white mt-1">{ad.vendor_id?.store_name || ad.vendor_id?.name || '—'}</p>
                  {ad.status === 'approved' && <p className="text-xs text-zinc-400 mt-0.5">{fmtDate(ad.start_date)} → {fmtDate(ad.end_date)}</p>}
                  {ad.stats && (ad.status === 'approved' || ad.status === 'expired' || ad.stats.impressions > 0) && (
                    <p className="text-xs text-zinc-500 mt-1 flex items-center gap-3">
                      <span><Eye size={12} className="inline me-1" />{ad.stats.impressions} {isAr ? 'مشاهدة' : 'views'}</span>
                      <span><MousePointerClick size={12} className="inline me-1" />{ad.stats.clicks} {isAr ? 'كليك' : 'clicks'}</span>
                      <span>{isAr ? 'نسبة النقر' : 'CTR'} {ad.stats.ctr}%</span>
                    </p>
                  )}
                </div>
                <button onClick={() => openDetail(ad)} className="text-xs font-bold text-marine-primary hover:underline flex-shrink-0">
                  {isAr ? 'التفاصيل' : 'Details'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {pagination.pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
            className="p-2 rounded-lg border border-zinc-200 dark:border-white/10 disabled:opacity-40"><ChevronLeft size={16} className={isAr ? 'rotate-180' : ''} /></button>
          <span className="text-sm text-zinc-500">{page} / {pagination.pages}</span>
          <button disabled={page >= pagination.pages} onClick={() => setPage((p) => p + 1)}
            className="p-2 rounded-lg border border-zinc-200 dark:border-white/10 disabled:opacity-40"><ChevronRight size={16} className={isAr ? 'rotate-180' : ''} /></button>
        </div>
      )}

      {/* Detail / action modal */}
      {selected && (
        <Overlay className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto" onClick={() => setSelected(null)}>
          <div className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/10 rounded-2xl w-full max-w-2xl p-6 shadow-xl my-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg text-zinc-900 dark:text-white">{selected.ad_number}</h3>
              <button onClick={() => setSelected(null)} className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white"><X size={20} /></button>
            </div>

            {selected.banner_image && (
              <div className="w-full h-40 rounded-xl overflow-hidden bg-zinc-100 dark:bg-white/5 mb-4">
                <img src={resolveAssetUrl(selected.banner_image)} alt="" className="w-full h-full object-contain" />
              </div>
            )}

            <div className="space-y-2 text-sm mb-5">
              <Row label={isAr ? 'النوع' : 'Type'} value={typeText(selected, isAr)} />
              <Row label={isAr ? 'البائع' : 'Vendor'} value={selected.vendor_id?.store_name || selected.vendor_id?.name} />
              <Row label={isAr ? 'الحالة' : 'Status'} value={isAr ? STATUS_LABELS[selected.status]?.ar : STATUS_LABELS[selected.status]?.en} />

              {selected.type === 'banner' && (
                <>
                  <Row label={isAr ? 'يُعلن عن' : 'Advertises'} value={selected.subject_type} />
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-zinc-400 text-xs font-bold uppercase tracking-wider">{isAr ? 'الرابط' : 'Link'}</span>
                    <a href={selected.link_url} target="_blank" rel="noreferrer" className="text-marine-primary font-medium text-end inline-flex items-center gap-1 truncate max-w-[60%]">
                      <span className="truncate">{selected.link_url}</span><ExternalLink size={13} />
                    </a>
                  </div>
                </>
              )}
              {selected.type === 'product_visibility' && (
                <>
                  <Row label={isAr ? 'المنتج' : 'Product'} value={selected.product_id?.title || selected.product_id?.title_en || selected.product_id?._id} />
                  <Row label={isAr ? 'الأماكن' : 'Placements'} value={placementText(selected.placements, isAr)} />
                </>
              )}
              {selected.type === 'featured_vendor' && (
                <Row label={isAr ? 'الأماكن' : 'Placements'} value={placementText(selected.vendor_placements, isAr)} />
              )}

              {selected.vendor_note && <Row label={isAr ? 'ملاحظة' : 'Note'} value={selected.vendor_note} />}
              {selected.status === 'approved' && <Row label={isAr ? 'الفترة' : 'Window'} value={`${fmtDate(selected.start_date)} → ${fmtDate(selected.end_date)}`} />}
              {selected.rejection_reason && <Row label={isAr ? 'سبب الرفض' : 'Rejection Reason'} value={selected.rejection_reason} />}
            </div>

            {(selected.status === 'approved' || selected.status === 'expired' || selected.stats?.impressions > 0) && (
              <div className="mb-5">
                <h4 className="flex items-center gap-2 text-sm font-black text-zinc-900 dark:text-white uppercase tracking-wide mb-3">
                  <BarChart3 size={15} className="text-marine-primary" /> {isAr ? 'أداء الإعلان' : 'Ad performance'}
                </h4>
                <AdAnalyticsPanel load={loadAnalytics} isAr={isAr} compact />
              </div>
            )}

            {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

            {mode === 'approve' ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 mb-1.5">{isAr ? 'تاريخ البدء' : 'Start date'}</label>
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-transparent text-zinc-900 dark:text-white text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 mb-1.5">{isAr ? 'تاريخ الانتهاء' : 'End date'}</label>
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-transparent text-zinc-900 dark:text-white text-sm" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button disabled={busy} onClick={() => approve(selected)}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50">
                    {busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {isAr ? 'تأكيد النشر' : 'Confirm & Publish'}
                  </button>
                  <button onClick={() => setMode(null)} className="px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-sm font-bold text-zinc-600 dark:text-zinc-300">{isAr ? 'إلغاء' : 'Cancel'}</button>
                </div>
              </div>
            ) : mode === 'reject' ? (
              <div className="space-y-3">
                <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder={isAr ? 'سبب الرفض' : 'Rejection reason'}
                  className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-transparent text-zinc-900 dark:text-white text-sm" />
                <div className="flex gap-2">
                  <button disabled={busy} onClick={() => reject(selected)}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-marine-cyan text-white text-sm font-bold hover:bg-marine-cyan-dark disabled:opacity-50">
                    {busy ? <Loader2 size={16} className="animate-spin" /> : null} {isAr ? 'تأكيد الرفض' : 'Confirm Reject'}
                  </button>
                  <button onClick={() => setMode(null)} className="px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-sm font-bold text-zinc-600 dark:text-zinc-300">{isAr ? 'إلغاء' : 'Cancel'}</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {selected.status === 'pending' && (
                  <>
                    <button onClick={() => setMode('approve')}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700">
                      <Check size={16} /> {isAr ? 'موافقة ونشر' : 'Approve'}
                    </button>
                    <button onClick={() => setMode('reject')}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 text-sm font-bold hover:bg-red-50 dark:hover:bg-red-500/10">
                      <Ban size={16} /> {isAr ? 'رفض' : 'Reject'}
                    </button>
                  </>
                )}
                {selected.status === 'approved' && (
                  <button disabled={busy} onClick={() => takedown(selected)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-700 text-white text-sm font-bold hover:bg-zinc-800 disabled:opacity-50">
                    <PowerOff size={16} /> {isAr ? 'إيقاف الإعلان' : 'Take down'}
                  </button>
                )}
              </div>
            )}
          </div>
        </Overlay>
      )}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-zinc-400 text-xs font-bold uppercase tracking-wider">{label}</span>
      <span className="text-zinc-900 dark:text-white font-medium text-end">{value || '—'}</span>
    </div>
  );
}
