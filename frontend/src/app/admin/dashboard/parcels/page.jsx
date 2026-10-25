'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from '../../../../components/LocaleLink';
import {
  Loader2, AlertTriangle, Clock, XCircle, Package, Store, MapPin, Phone,
  ChevronRight, ChevronLeft, RefreshCw,
} from 'lucide-react';
import { adminApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import { getSubOrderStatusLabel, getSubOrderStatusColor } from '../../../../lib/orderStatus';

/**
 * Every parcel waiting on a human, across all orders — the single queue the admin works
 * from each morning.
 *
 * Four things land here, and the reason is always on the card:
 *   · a vendor marked something unavailable and the customer has to be phoned
 *   · a vendor has gone past their deadline
 *   · Bosta has flagged a delivery problem
 *   · a vendor has asked for their parcel to be cancelled
 *
 * The customer's phone number is on the card deliberately. The conversation that resolves a
 * declined item happens off-platform — "it is out of stock, I can get it from another store
 * at this price" — and making the admin dig for the number just slows that down.
 */
const REASON_META = {
  declined_items: {
    label_en: 'Unavailable items', label_ar: 'منتجات غير متاحة',
    color: 'bg-red-500/15 text-red-500', Icon: AlertTriangle,
  },
  overdue: {
    label_en: 'Vendor is late', label_ar: 'التاجر متأخر',
    color: 'bg-amber-500/15 text-amber-600', Icon: Clock,
  },
  delivery_exception: {
    label_en: 'Delivery problem', label_ar: 'مشكلة في التسليم',
    color: 'bg-orange-500/15 text-orange-600', Icon: AlertTriangle,
  },
  cancellation_requested: {
    label_en: 'Cancellation asked for', label_ar: 'طلب إلغاء',
    color: 'bg-purple-500/15 text-purple-500', Icon: XCircle,
  },
  dispatch_uncertain: {
    label_en: 'Send did not finish — check courier portal', label_ar: 'الإرسال ماكملش — راجع بورتال الشركة',
    color: 'bg-amber-500/15 text-amber-700', Icon: AlertTriangle,
  },
  courier_cancel_pending: {
    label_en: 'Cancel it at the courier by hand', label_ar: 'ألغيها عند شركة الشحن يدويًا',
    color: 'bg-red-500/15 text-red-600', Icon: XCircle,
  },
};

const FILTERS = [
  { key: '', label_en: 'Everything', label_ar: 'الكل' },
  { key: 'declined_items', label_en: 'Unavailable items', label_ar: 'منتجات غير متاحة' },
  { key: 'overdue', label_en: 'Late vendors', label_ar: 'تجار متأخرين' },
  { key: 'delivery_exception', label_en: 'Delivery problems', label_ar: 'مشاكل تسليم' },
  { key: 'cancellation_requested', label_en: 'Cancellation requests', label_ar: 'طلبات إلغاء' },
  { key: 'dispatch_uncertain', label_en: 'Unfinished sends', label_ar: 'إرسال ماكملش' },
  { key: 'courier_cancel_pending', label_en: 'Cancel at courier', label_ar: 'إلغاء عند الشركة' },
];

export default function AdminParcelsQueuePage() {
  const { language, siteSettings } = useApp();
  const isAr = language === 'ar';
  const currency = siteSettings?.currency || 'QAR';
  const Chevron = isAr ? ChevronLeft : ChevronRight;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await adminApi.getSubOrdersNeedingAttention();
      setRows(data.sub_orders || []);
    } catch (err) {
      setError(err.message || 'Failed to load the queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = filter ? rows.filter((r) => (r.reasons || []).includes(filter)) : rows;
  const countFor = (key) => (key ? rows.filter((r) => (r.reasons || []).includes(key)).length : rows.length);

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight">
            {isAr ? 'شحنات محتاجة تدخلك' : 'Parcels needing you'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {isAr
              ? 'كل شحنة واقفة مستنية قرار — والسبب مكتوب على كل واحدة'
              : 'Every parcel that is stuck, with the reason on each one'}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan/40 transition disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          {isAr ? 'تحديث' : 'Refresh'}
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => {
          const n = countFor(f.key);
          const active = filter === f.key;
          return (
            <button
              key={f.key || 'all'}
              onClick={() => setFilter(f.key)}
              className={`shrink-0 px-4 py-2 text-xs font-bold rounded-xl border transition ${
                active
                  ? 'bg-marine-cyan text-white border-marine-cyan'
                  : 'bg-white dark:bg-white/5 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-white/10 hover:border-zinc-300'
              }`}
            >
              {isAr ? f.label_ar : f.label_en}
              {n > 0 && (
                <span className={`ms-2 px-1.5 py-0.5 rounded-full text-[10px] font-black ${active ? 'bg-white/25' : 'bg-marine-cyan/10 text-marine-primary'}`}>
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-600">{error}</div>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-marine-primary" size={28} /></div>
      ) : visible.length === 0 ? (
        <div className="text-center py-20 rounded-2xl bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5">
          <Package className="mx-auto text-zinc-300 dark:text-zinc-700" size={36} />
          <p className="mt-3 text-sm font-bold text-zinc-500">
            {isAr ? 'مفيش حاجة مستنية قرار — كل الشحنات ماشية.' : 'Nothing is waiting on you — every parcel is moving.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((row) => (
            <div
              key={row._id}
              className="rounded-2xl bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-black text-zinc-900 dark:text-white">
                    #{row.order_reference}
                    <span className="ms-2 font-mono text-[11px] text-zinc-400">{row.reference}</span>
                  </p>
                  <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1.5">
                    <Store size={11} />{row.vendor_name}
                    {row.fulfillment_location && (
                      <>
                        <MapPin size={11} className="ms-1" />{row.fulfillment_location}
                      </>
                    )}
                  </p>
                </div>
                <span className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider shrink-0 ${getSubOrderStatusColor(row.status)}`}>
                  {getSubOrderStatusLabel(row.status, isAr)}
                </span>
              </div>

              {/* Why it is here — one chip per distinct reason */}
              <div className="flex flex-wrap gap-1.5 mt-3">
                {(row.reasons || []).map((r) => {
                  const meta = REASON_META[r];
                  if (!meta) return null;
                  const { Icon } = meta;
                  return (
                    <span key={r} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black ${meta.color}`}>
                      <Icon size={10} />{isAr ? meta.label_ar : meta.label_en}
                    </span>
                  );
                })}
              </div>

              {row.needs_admin_reason && (
                <p className="mt-2 text-[11px] text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-white/5 rounded-lg p-2.5">
                  {row.needs_admin_reason}
                </p>
              )}
              {row.cancel_request?.reason && (
                <p className="mt-2 text-[11px] text-purple-600 dark:text-purple-400">
                  {isAr ? 'سبب طلب الإلغاء: ' : 'Cancellation reason: '}{row.cancel_request.reason}
                </p>
              )}

              {/* The numbers the admin needs for the phone call that fixes this */}
              <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-white/5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
                <span className="text-zinc-600 dark:text-zinc-300 font-bold">{row.customer_name}</span>
                {row.customer_phone && row.customer_phone !== '-' && (
                  <a href={`tel:${row.customer_phone}`} className="inline-flex items-center gap-1 text-marine-primary font-bold hover:underline">
                    <Phone size={11} />{row.customer_phone}
                  </a>
                )}
                {row.vendor_phone && (
                  <a href={`tel:${row.vendor_phone}`} className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-700">
                    <Phone size={11} />{isAr ? 'التاجر' : 'Vendor'}
                  </a>
                )}
                <span className="text-zinc-500">
                  {currency} {Number(row.cod_amount || 0).toFixed(2)}
                </span>
                <Link
                  href={`/admin/dashboard/orders/${row.order_id}`}
                  className="ms-auto inline-flex items-center gap-1 font-black text-marine-primary hover:underline"
                >
                  {isAr ? 'افتح الطلب' : 'Open the order'}
                  <Chevron size={12} />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
