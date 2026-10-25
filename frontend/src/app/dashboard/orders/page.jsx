'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from '../../../lib/navigation';
import { vendorApi } from '../../../lib/api';
import { useApp } from '../../../context/AppContext';
import {
  Loader2, Package, ChevronRight, ChevronLeft, AlertTriangle, Clock, MapPin, CalendarDays,
  CalendarClock, Users, Printer,
} from 'lucide-react';
import Link from '../../../components/LocaleLink';
import {
  getSubOrderStatusLabel, getSubOrderStatusColor,
  getVendorReviewLabel, getVendorReviewColor, isVendorReviewWorthShowing,
  formatOrderDate, formatRelativeDate,
} from '../../../lib/orderStatus';

/**
 * The vendor's parcels, grouped by the action each one is waiting on.
 *
 * Tabs are named for what the vendor has to DO, not for an internal state, because the only
 * question this screen exists to answer is "what do I need to deal with next?". The page
 * opens on the leftmost tab that actually has work in it, so the answer is the first thing
 * on screen rather than something to hunt for.
 */
export default function VendorOrdersPage() {
  const router = useRouter();
  const { language, siteSettings } = useApp();
  const isAr = language === 'ar';
  const currency = siteSettings?.currency || 'QAR';
  const Chevron = isAr ? ChevronLeft : ChevronRight;

  const [tabs, setTabs] = useState([]);
  const [counts, setCounts] = useState({});
  const [activeTab, setActiveTab] = useState(null);
  const [subOrders, setSubOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Only true on the very first load, so landing on the busiest tab happens once and does
  // not yank the vendor away from a tab they deliberately opened.
  const [tabResolved, setTabResolved] = useState(false);

  const load = useCallback(async (tab) => {
    setLoading(true);
    setError('');
    try {
      const data = await vendorApi.getSubOrders(tab || undefined);
      setSubOrders(data.sub_orders || []);
      setCounts(data.counts || {});
      setTabs(data.tabs || []);
      return data;
    } catch (err) {
      setError(err.message || 'Failed to load parcels');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const data = await load(null);
      if (!data || tabResolved) return;
      // Land where the work is: the first tab with anything in it.
      const firstBusy = (data.tabs || []).find((t) => (data.counts || {})[t.key] > 0);
      setActiveTab(firstBusy?.key || data.tabs?.[0]?.key || null);
      setTabResolved(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tabResolved || !activeTab) return;
    load(activeTab);
  }, [activeTab, tabResolved, load]);

  const label = (t) => (isAr ? t.label_ar : t.label_en);

  // A combined company order (feature 14) is ONE parcel holding several customers'
  // orders: shown as one card with the orders inside, where the first of them appeared.
  const entries = [];
  const groupAt = new Map();
  for (const sub of subOrders) {
    const key = sub.batch?.batch_id ? String(sub.batch.batch_id) : null;
    if (!key) { entries.push({ kind: 'parcel', sub }); continue; }
    if (!groupAt.has(key)) {
      groupAt.set(key, entries.length);
      entries.push({ kind: 'batch', batch: sub.batch, subs: [] });
    }
    entries[groupAt.get(key)].subs.push(sub);
  }

  // One ordinary parcel on the list.
  const renderParcel = (sub) => (
    <Link
      key={sub._id}
      href={`/dashboard/orders/${sub.order_id}/parcels/${sub._id}`}
      className="block rounded-2xl bg-white dark:bg-white/5 border border-zinc-100 dark:border-white/5 p-4 hover:border-marine-cyan/40 transition-all group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-black text-zinc-900 dark:text-white">
            #{sub.order_reference}
            {sub.reference && sub.reference !== sub.order_reference && (
              <span className="text-zinc-400 font-mono text-xs ms-2">{sub.reference}</span>
            )}
          </p>
          {sub.fulfillment_location && (
            <p className="text-[11px] text-zinc-500 mt-1 flex items-center gap-1">
              <MapPin size={11} />
              {sub.fulfillment_location}
            </p>
          )}
        </div>
        {/* Two badges, because they answer two different questions: where the parcel
            is, and what this vendor decided about it. */}
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <span
            className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider ${getSubOrderStatusColor(sub.status)}`}
          >
            {getSubOrderStatusLabel(sub.status, isAr)}
          </span>
          {isVendorReviewWorthShowing(sub.status, sub.vendor_review) && (
            <span
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${getVendorReviewColor(sub.vendor_review)}`}
            >
              {getVendorReviewLabel(sub.vendor_review, isAr)}
            </span>
          )}
        </div>
      </div>

      {/* When the customer placed it. The age is what tells the vendor which parcel
          has been waiting too long, so it is shown beside the real date. */}
      {sub.order_created_at && (
        <p className="mt-2 text-[11px] text-zinc-500 flex items-center gap-1.5">
          <CalendarDays size={11} />
          <span>{formatOrderDate(sub.order_created_at, isAr)}</span>
          <span className="text-zinc-400">·</span>
          <span className="font-bold">{formatRelativeDate(sub.order_created_at, isAr)}</span>
        </p>
      )}

      {/* Why the button is not available yet, stated on the list so the vendor does
          not have to open the parcel to find out. */}
      {sub.progress?.blocked_reason && (
        <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
          <AlertTriangle size={11} />
          {sub.progress.blocked_reason}
        </p>
      )}

      {/* Packed inside another order's combined parcel: information, not a block. Its
          status is the main parcel's, so this says whether the box has left yet. */}
      {sub.progress?.rides_in_lead != null && (
        <p className="mt-2 text-[11px] text-indigo-600 dark:text-indigo-300 flex items-center gap-1.5">
          <Package size={11} />
          {['handed_to_courier', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered'].includes(sub.status)
            ? (isAr ? `اتشحن جوه الطرد المجمّع #${sub.progress.rides_in_lead}` : `Went out inside combined parcel #${sub.progress.rides_in_lead}`)
            : (isAr ? `بيتشحن جوه الطرد المجمّع #${sub.progress.rides_in_lead} — كمّل الخطوات من هناك` : `Ships inside combined parcel #${sub.progress.rides_in_lead} — continue from there`)}
        </p>
      )}

      <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-white/5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-zinc-500">
        <span>
          {isAr ? `${sub.item_count} منتج` : `${sub.item_count} item${sub.item_count === 1 ? '' : 's'}`}
        </span>
        <span className="font-bold text-zinc-700 dark:text-zinc-200">
          {isAr ? 'صافي ربحك: ' : 'You earn: '}
          {currency} {Number(sub.earning_estimate || 0).toFixed(2)}
        </span>
        {/* The row is one big link, so this button must swallow the click itself. */}
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push(`/dashboard/tickets/new?order=${sub.order_id}`); }}
          title={isAr ? 'إبلاغ الدعم الفني عن مشكلة في الطلب ده' : 'Report a problem with this order to support'}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md font-bold text-zinc-500 hover:bg-marine-cyan hover:text-white transition-colors"
        >
          {isAr ? 'بلّغ عن مشكلة' : 'Report a problem'}
        </button>
        {sub.is_overdue && (
          <span className="inline-flex items-center gap-1 font-bold text-red-500">
            <Clock size={11} />
            {isAr ? 'متأخرة' : 'Overdue'}
          </span>
        )}
        {/* When the courier is coming. On the list rather than only inside the
            parcel, because "am I needed at the branch tomorrow?" is a question
            about the whole day, not about one box. */}
        {sub.pickup && sub.pickup.status !== 'cancelled' && (
          <span className="inline-flex items-center gap-1 font-bold text-teal-600 dark:text-teal-400">
            <CalendarClock size={11} />
            {sub.pickup.scheduled_date} · {sub.pickup.scheduled_time_slot}
          </span>
        )}
        <Chevron
          size={14}
          className="ms-auto text-zinc-400 group-hover:text-marine-primary transition-colors"
        />
      </div>
    </Link>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight">
          {isAr ? 'الشحنات' : 'Parcels'}
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          {isAr
            ? 'كل شحنة من طلب مختلف — جهّزها على ثلاث خطوات'
            : 'Each parcel belongs to one order — prepare it in three steps'}
        </p>
      </div>

      {/* Tabs named for the action, with counts so nothing is hidden behind a click */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {tabs.map((t) => {
          const n = counts[t.key] || 0;
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`shrink-0 px-4 py-2.5 text-sm font-bold rounded-xl border transition-all ${
                active
                  ? 'bg-marine-cyan text-white border-marine-cyan shadow-md'
                  : 'bg-white dark:bg-white/5 text-zinc-600 dark:text-zinc-300 border-zinc-100 dark:border-white/5 hover:border-zinc-300'
              }`}
            >
              {label(t)}
              {n > 0 && (
                <span
                  className={`ms-2 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-black ${
                    active ? 'bg-white/25 text-white' : 'bg-marine-cyan/10 text-marine-primary'
                  }`}
                >
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
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-marine-primary" size={28} />
        </div>
      ) : subOrders.length === 0 ? (
        /* The tab's own message, not a generic empty state — "nothing here" is only useful
           when it says what "here" was. */
        <div className="text-center py-20 rounded-2xl bg-white dark:bg-white/5 border border-zinc-100 dark:border-white/5">
          <Package className="mx-auto text-zinc-300 dark:text-zinc-700" size={36} />
          <p className="mt-3 text-sm font-bold text-zinc-500">
            {isAr
              ? `مفيش شحنات في "${label(tabs.find((t) => t.key === activeTab) || { label_ar: '', label_en: '' })}"`
              : `Nothing in "${label(tabs.find((t) => t.key === activeTab) || { label_ar: '', label_en: '' })}"`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => entry.kind === 'batch' ? (
            <BatchGroupCard key={`batch-${entry.batch.batch_id}`} batch={entry.batch} subs={entry.subs} isAr={isAr} Chevron={Chevron} />
          ) : renderParcel(entry.sub))}
        </div>
      )}
    </div>
  );
}

/**
 * One combined company order: several customers, one parcel, one office. The orders
 * inside are confirmed one by one; the main one carries the waybill for the whole box.
 */
function BatchGroupCard({ batch, subs, isAr, Chevron }) {
  const lead = subs.find((s) => s.batch?.role === 'lead');
  return (
    <div className="rounded-2xl border-2 border-indigo-300 dark:border-indigo-500/40 bg-indigo-50/60 dark:bg-indigo-500/10 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-black text-indigo-900 dark:text-indigo-200 flex items-center gap-2">
            <Package size={15} />
            {isAr
              ? `أوردر مجمّع — ${batch.order_count} عملاء بيستلموا من مكان واحد`
              : `Combined order — ${batch.order_count} customers, one delivery place`}
          </p>
          <p className="text-[11px] text-indigo-800/80 dark:text-indigo-300/80 mt-1">
            {batch.company_name}{batch.office_name ? ` — ${batch.office_name}` : ''}
            {' · '}
            {isAr ? `${batch.confirmed_count || 0} من ${batch.order_count} اتأكدوا` : `${batch.confirmed_count || 0} of ${batch.order_count} confirmed`}
          </p>
        </div>
        <Link
          href={`/dashboard/orders/batches/${batch.batch_id}/labels`}
          target="_blank"
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-black"
        >
          <Printer size={12} />{isAr ? 'ليبلات العملاء' : 'Customer labels'}
        </Link>
      </div>
      <p className="text-[11px] font-bold text-indigo-900 dark:text-indigo-200">
        {isAr
          ? 'غلّف حاجة كل عميل لوحدها بليبل باسمه، وبعدين الكل في باكيدج واحد عليه السمارت ليبل أو البوليصة.'
          : "Pack each customer's items apart with their label, then everything in ONE package with the Smart Label or waybill."}
      </p>
      <ul className="space-y-2">
        {subs.map((sub) => (
          <li key={sub._id}>
            <Link
              href={`/dashboard/orders/${sub.order_id}/parcels/${sub._id}`}
              className="flex items-center justify-between gap-3 rounded-xl bg-white dark:bg-white/5 border border-indigo-100 dark:border-white/5 px-3 py-2.5 hover:border-marine-cyan/40 transition-all group"
            >
              <span className="min-w-0 flex items-center gap-2 text-xs">
                <Users size={12} className="text-indigo-500 shrink-0" />
                <span className="font-black text-zinc-900 dark:text-white">#{sub.order_reference}</span>
                <span className="text-zinc-500">{isAr ? `${sub.item_count} منتج` : `${sub.item_count} item(s)`}</span>
                {sub.batch?.role === 'lead' && (
                  <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-300">{isAr ? '· الطرد الرئيسي' : '· main parcel'}</span>
                )}
              </span>
              <span className="shrink-0 flex items-center gap-2">
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-black ${getSubOrderStatusColor(sub.status)}`}>
                  {getSubOrderStatusLabel(sub.status, isAr)}
                </span>
                <Chevron size={13} className="text-zinc-400 group-hover:text-marine-primary" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {!lead && batch.lead_sub_order_id && (
        <Link href={`/dashboard/orders/${batch.lead_order_id}/parcels/${batch.lead_sub_order_id}`} className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300 hover:underline">
          {isAr ? 'افتح الطرد الرئيسي' : 'Open the main parcel'}
        </Link>
      )}
    </div>
  );
}
