'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from '../../../../../../lib/navigation';
import { vendorApi } from '../../../../../../lib/api';
import { useApp } from '../../../../../../context/AppContext';
import {
  Loader2, Check, X, Package, ScanLine, FileDown, Camera, Trash2,
  AlertTriangle, CheckCircle2, ArrowLeft, ArrowRight, Wallet, Clock, MapPin,
  CalendarDays, CalendarClock, ExternalLink, Edit3,
} from 'lucide-react';
import Link from '../../../../../../components/LocaleLink';
import ParcelJourney from '../../../../../../components/orders/ParcelJourney';
import VendorBatchBanner from '../../../../../../components/company/VendorBatchBanner';
import {
  VENDOR_STAGES, getSubOrderStatusLabel, getSubOrderStatusColor,
  getVendorReviewLabel, getVendorReviewColor, isVendorReviewWorthShowing,
  formatOrderDate, formatRelativeDate,
} from '../../../../../../lib/orderStatus';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

/**
 * One parcel, worked through the vendor's four stages.
 *
 *   ① Confirm products   availability item by item, each saved on press
 *   ② Assign tracking    scan a Smart Label, or print the waybill Bosta minted
 *   ③ Seal the parcel    photograph it if they want to — photos are optional
 *   ④ Give to courier    confirm the courier actually took it, and see when it is coming
 *
 * Stage ④ exists because ③ used to end the story: the moment a vendor said "sealed", every
 * screen started saying the parcel had left the store, while it was still on the counter.
 * Nothing here claims the parcel moved until the vendor presses ④ or Bosta reports it.
 *
 * The active stage is the only one expanded, and its single action sits at the bottom —
 * always saying WHY it is disabled rather than leaving the vendor to work it out.
 */
export default function VendorParcelPage() {
  // The route segment is `[id]` (shared with the legacy order page), so it is read
  // under that name and used as the order id throughout.
  const { id: orderId, subOrderId } = useParams();
  const router = useRouter();
  const { language, siteSettings } = useApp();
  const isAr = language === 'ar';
  const currency = siteSettings?.currency || 'QAR';
  const Back = isAr ? ArrowRight : ArrowLeft;

  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [declineFor, setDeclineFor] = useState(null);
  const [declineReason, setDeclineReason] = useState('');
  // The parcel-level refusal is a separate box from the per-item one: one reason covers
  // every line, and pressing it confirms straight away.
  const [rejectAllOpen, setRejectAllOpen] = useState(false);
  const [rejectAllReason, setRejectAllReason] = useState('');
  const [trackingInput, setTrackingInput] = useState('');
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await vendorApi.getSubOrder(orderId, subOrderId);
      setSub(data.sub_order);
    } catch (err) {
      setError(err.message || 'Failed to load this parcel');
    } finally {
      setLoading(false);
    }
  }, [orderId, subOrderId]);

  useEffect(() => { load(); }, [load]);

  /** Every action funnels through here so one failure can never leave a stuck spinner. */
  const run = async (key, fn, successMessage = '') => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      const res = await fn();
      if (res?.sub_order) setSub(res.sub_order);
      else await load();
      if (successMessage || res?.message) setNotice(res?.message || successMessage);
      return res;
    } catch (err) {
      setError(err.message || 'Something went wrong');
      return null;
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="animate-spin text-marine-primary" size={28} />
      </div>
    );
  }

  if (!sub) {
    return (
      <div className="rounded-2xl bg-red-500/10 border border-red-500/20 p-6 text-sm text-red-600">
        {error || (isAr ? 'الشحنة غير موجودة' : 'Parcel not found')}
      </div>
    );
  }

  const stage = sub.progress?.stage || 1;
  const parked = sub.status === 'needs_admin';
  // Sealed and offered for pickup — the parcel is finished, but it is STILL AT THE STORE.
  const sealed = ['ready_for_pickup', 'pickup_scheduled'].includes(sub.status);
  // The booked courier visit, or null while none exists. Read live from the pickup, so a
  // rescheduled visit shows its new day rather than the one booked first.
  const pickup = sub.pickup || null;
  // Actually gone: either the vendor confirmed the courier took it, or Bosta scanned it.
  // `done` used to include `ready_for_pickup`, which is why this screen announced that a
  // parcel had "left your hands" while it was still sitting on the counter.
  const done = ['handed_to_courier', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered'].includes(sub.status);
  const items = sub.items || [];
  const photos = sub.parcel_photos || [];
  // A combined company order's rider: once confirmed, it ships inside the main parcel and
  // has no shipping steps of its own (feature 14).
  const ridesInLead = sub.company_batch?.role === 'rider' && stage >= 2;

  /* ---------- Stage 1 ---------- */

  const setAvailability = (item, available, reason = '') =>
    run(`item:${item._id}`, () =>
      vendorApi.reviewSubOrderItem(orderId, subOrderId, item._id, available, reason));

  const submitDecline = async () => {
    if (!declineReason.trim()) return;
    const ok = await setAvailability(declineFor, false, declineReason.trim());
    if (ok) { setDeclineFor(null); setDeclineReason(''); }
  };

  /* ---------- Stage 1, whole parcel ----------
     Both order-level actions finish stage ① in a single press. A vendor who has everything,
     or has nothing, should never have to walk the list item by item first. */

  const acceptWholeParcel = () =>
    run(
      'approve-all',
      () => vendorApi.approveAllSubOrderItems(orderId, subOrderId, true),
      isAr ? 'تم تأكيد كل المنتجات' : 'All products confirmed'
    );

  const rejectWholeParcel = async () => {
    if (!rejectAllReason.trim()) return;
    const ok = await run(
      'decline-all',
      () => vendorApi.declineAllSubOrderItems(orderId, subOrderId, rejectAllReason.trim()),
      isAr
        ? 'تم — إدارة الموقع هتتواصل مع العميل بخصوص الشحنة دي.'
        : 'Done — the website team will contact the customer about this parcel.'
    );
    if (ok) { setRejectAllOpen(false); setRejectAllReason(''); }
  };

  /* ---------- Stage 2 ---------- */

  // Which courier carries this parcel — the copy below names it instead of assuming Bosta.
  const courierName = (isAr ? sub?.courier_label_ar : sub?.courier_label) || (sub?.courier === 'arrive' ? (isAr ? 'أرايف' : 'Arrive') : (isAr ? 'بوسطة' : 'Bosta'));

  const downloadAWB = async () => {
    setBusy('awb');
    setError('');
    try {
      const blob = await vendorApi.getSubOrderAWB(orderId, subOrderId);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setError(err.message || 'Could not load the waybill');
    } finally {
      setBusy('');
    }
  };

  /* ---------- Stage 3 ---------- */

  const uploadPhotos = async (files) => {
    if (!files?.length) return;
    setBusy('photos');
    setError('');
    try {
      const form = new FormData();
      for (const f of files) form.append('images', f);
      const res = await fetch(`${API_BASE}/upload`, {
        method: 'POST', credentials: 'include', body: form,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Upload failed');
      const data = await res.json();
      const urls = (data.files || data.images || []).map((f) => f.url || f).filter(Boolean);
      if (urls.length === 0) throw new Error('Upload returned no files');
      const saved = await vendorApi.addSubOrderPhotos(orderId, subOrderId, urls);
      if (saved?.sub_order) setSub(saved.sub_order);
    } catch (err) {
      setError(err.message || 'Could not upload the photos');
    } finally {
      setBusy('');
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  /* ---------- Render ---------- */

  const stageHeader = (
    <div className="flex items-center gap-1 sm:gap-2">
      {VENDOR_STAGES.map((s, i) => {
        const state = done ? 'done' : s.step < stage ? 'done' : s.step === stage ? 'active' : 'todo';
        return (
          <div key={s.step} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
              <div
                className={`w-8 h-8 rounded-full grid place-items-center text-xs font-black shrink-0 transition ${
                  state === 'done' ? 'bg-emerald-500 text-white'
                  : state === 'active' ? 'bg-marine-cyan text-white ring-4 ring-marine-cyan/20'
                  : 'bg-zinc-200 dark:bg-white/10 text-zinc-500'
                }`}
              >
                {state === 'done' ? <Check size={14} /> : s.step}
              </div>
              <span
                className={`text-[10px] font-bold text-center leading-tight truncate w-full ${
                  state === 'active' ? 'text-marine-primary' : 'text-zinc-500'
                }`}
              >
                {isAr ? s.label_ar : s.label_en}
              </span>
            </div>
            {i < VENDOR_STAGES.length - 1 && (
              <div className={`h-0.5 flex-1 mx-1 ${s.step < stage || done ? 'bg-emerald-500' : 'bg-zinc-200 dark:bg-white/10'}`} />
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-5 animate-in fade-in duration-500 max-w-3xl">
      <button
        onClick={() => router.push('/dashboard/orders')}
        className="inline-flex items-center gap-2 text-sm font-bold text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition"
      >
        <Back size={16} />
        {isAr ? 'كل الشحنات' : 'All parcels'}
      </button>

      {/* Identity */}
      <div className="rounded-2xl bg-white dark:bg-white/5 border border-zinc-100 dark:border-white/5 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-black text-zinc-900 dark:text-white">#{sub.order_reference}</h1>
            <p className="text-xs text-zinc-500 mt-1 font-mono">{sub.reference}</p>
            {sub.fulfillment_location && (
              <p className="text-[11px] text-zinc-500 mt-1.5 flex items-center gap-1">
                <MapPin size={11} />{sub.fulfillment_location}
              </p>
            )}
          </div>
          {/* Where the parcel is, and — separately — what this vendor decided about it. */}
          <div className="shrink-0 flex flex-col items-end gap-1.5">
            <span className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider ${getSubOrderStatusColor(sub.status)}`}>
              {getSubOrderStatusLabel(sub.status, isAr)}
            </span>
            {isVendorReviewWorthShowing(sub.status, sub.vendor_review) && (
              <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${getVendorReviewColor(sub.vendor_review)}`}>
                {getVendorReviewLabel(sub.vendor_review, isAr)}
              </span>
            )}
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-white/5 flex flex-wrap gap-x-5 gap-y-2 text-[11px]">
          {sub.order_created_at && (
            <span className="inline-flex items-center gap-1.5 text-zinc-500">
              <CalendarDays size={12} />
              {isAr ? 'تاريخ الطلب: ' : 'Ordered '}
              <span className="font-bold text-zinc-700 dark:text-zinc-200">
                {formatOrderDate(sub.order_created_at, isAr)}
              </span>
              <span className="text-zinc-400">({formatRelativeDate(sub.order_created_at, isAr)})</span>
            </span>
          )}
          <span className="font-bold text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-1.5">
            <Wallet size={12} className="text-emerald-500" />
            {isAr ? 'صافي ربحك: ' : 'You earn: '}
            {currency} {Number(sub.earning?.net_amount || 0).toFixed(2)}
            {/* How it was reached — the coupon line only when this parcel carried one the
                vendor helped fund, so nobody wonders why the net is below list price. */}
            {Number(sub.earning?.coupon_share) > 0 && (
              <span className="text-zinc-400 font-normal" dir="ltr">
                {' '}({currency} {Number(sub.earning?.gross_amount || 0).toFixed(2)} − {isAr ? 'كوبون' : 'coupon'} {Number(sub.earning?.coupon_share || 0).toFixed(2)} − {isAr ? 'عمولة' : 'commission'} {Number(sub.earning?.commission_amount || 0).toFixed(2)})
              </span>
            )}
            {sub.earning?.status === 'pending' && (
              <span className="text-zinc-400 font-normal">
                {isAr ? ' (محجوز لحد قفل نافذة الإرجاع)' : ' (held until the return window closes)'}
              </span>
            )}
            {sub.earning?.status === 'available' && (
              <span className="text-emerald-500 font-normal">{isAr ? ' (متاح للسحب)' : ' (withdrawable)'}</span>
            )}
          </span>
          {sub.deadline_at && !done && (
            <span className={`inline-flex items-center gap-1.5 font-bold ${sub.is_overdue ? 'text-red-500' : 'text-zinc-500'}`}>
              <Clock size={12} />
              {sub.is_overdue
                ? (isAr ? 'متأخرة عن موعدها' : 'Past its deadline')
                : `${isAr ? 'الموعد: ' : 'Due '}${new Date(sub.deadline_at).toLocaleString(isAr ? 'ar-EG' : 'en-GB')}`}
            </span>
          )}
        </div>
      </div>

      <VendorBatchBanner batch={sub.batch} sub={sub} isAr={isAr} />

      {/* Progress bar */}
      <div className="rounded-2xl bg-white dark:bg-white/5 border border-zinc-100 dark:border-white/5 p-5">
        {stageHeader}
      </div>

      {notice && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-sm text-emerald-600">{notice}</div>
      )}
      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-600">{error}</div>
      )}

      {/* Parked with the website team */}
      {parked && (
        <div className="rounded-2xl bg-amber-500/10 border border-amber-500/25 p-5">
          <p className="text-sm font-black text-amber-700 dark:text-amber-400 flex items-center gap-2">
            <AlertTriangle size={16} />
            {isAr ? 'مع إدارة الموقع' : 'With the website team'}
          </p>
          <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-2 leading-relaxed">
            {isAr
              ? 'إدارة الموقع بتتواصل مع العميل بخصوص المنتجات غير المتاحة. هترجعلك الشحنة أول ما يتحدد البديل.'
              : 'The website team is contacting the customer about the unavailable items. This parcel comes back to you once that is settled.'}
          </p>
          {sub.needs_admin_reason && (
            <p className="text-[11px] text-amber-700/70 dark:text-amber-300/70 mt-2">{sub.needs_admin_reason}</p>
          )}
        </div>
      )}

      {/* ---- The full journey ----
           The stepper above is the vendor's TO-DO list: four steps, only theirs, and it
           stops the moment the parcel leaves. This is the whole life of the parcel, ours
           and Bosta's together, so a vendor answering "where is it?" never has to leave
           their own screen to find out. */}
      <div className="rounded-2xl bg-white dark:bg-white/5 border border-zinc-100 dark:border-white/5 p-5">
        <h2 className="text-sm font-black text-zinc-900 dark:text-white mb-4">
          {isAr ? 'رحلة الشحنة بالكامل' : 'The full journey'}
        </h2>
        <ParcelJourney journey={sub.journey} isAr={isAr} />
      </div>

      {/* ---- Stage 1 ---- */}
      {(stage === 1 || parked) && (
        <div className="rounded-2xl bg-white dark:bg-white/5 border border-zinc-100 dark:border-white/5 overflow-hidden">
          <div className="p-5 pb-3">
            <h2 className="text-sm font-black text-zinc-900 dark:text-white">
              {isAr ? '① تأكيد المنتجات' : '① Confirm products'}
            </h2>

            {/* The two answers that cover almost every parcel, offered before the list so the
                vendor with all of it — or none of it — never walks the items one by one.
                Each finishes stage ① in a single press. */}
            {!parked && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={acceptWholeParcel}
                  disabled={!!busy}
                  className="flex-1 min-w-[150px] inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-emerald-500 text-white text-[12px] font-black hover:bg-emerald-600 transition disabled:opacity-50"
                >
                  {busy === 'approve-all'
                    ? <Loader2 size={13} className="animate-spin" />
                    : <><Check size={13} />{isAr ? 'قبول كل الأصناف وتأكيد' : 'Accept all & confirm'}</>}
                </button>
                <button
                  onClick={() => { setRejectAllOpen(true); setDeclineFor(null); }}
                  disabled={!!busy}
                  className="flex-1 min-w-[150px] inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-red-500/10 text-red-600 text-[12px] font-black hover:bg-red-500/20 transition disabled:opacity-50"
                >
                  <X size={13} />
                  {isAr ? 'رفض كل الأصناف' : 'Refuse all items'}
                </button>
              </div>
            )}

            {/* One reason for the whole parcel. The website team reads this exact sentence to
                the customer, so it is required here just as it is on a single item. */}
            {rejectAllOpen && !parked && (
              <div className="mt-3 rounded-xl bg-red-500/5 border border-red-500/20 p-3">
                <label className="block text-[11px] font-bold text-red-600 mb-1.5">
                  {isAr
                    ? 'ليه مش هتقدر تجهّز الشحنة دي؟ (إجباري)'
                    : 'Why can this parcel not be fulfilled? (required)'}
                </label>
                <input
                  autoFocus
                  value={rejectAllReason}
                  onChange={(e) => setRejectAllReason(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && rejectWholeParcel()}
                  placeholder={isAr ? 'مثال: الفرع مقفول الأسبوع ده' : 'e.g. the branch is closed this week'}
                  className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-red-500/25 text-sm outline-none focus:border-red-500"
                />
                <p className="mt-2 text-[11px] text-red-600/70">
                  {isAr
                    ? 'هيتعلّم كل الأصناف غير متاحة والشحنة تروح لإدارة الموقع علطول.'
                    : 'Every item is marked unavailable and the parcel goes to the website team right away.'}
                </p>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={rejectWholeParcel}
                    disabled={!rejectAllReason.trim() || !!busy}
                    className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-[11px] font-black disabled:opacity-40"
                  >
                    {busy === 'decline-all'
                      ? <Loader2 size={11} className="animate-spin" />
                      : (isAr ? 'تأكيد الرفض' : 'Confirm refusal')}
                  </button>
                  <button
                    onClick={() => { setRejectAllOpen(false); setRejectAllReason(''); }}
                    className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-white/10 text-[11px] font-black text-zinc-600 dark:text-zinc-300"
                  >
                    {isAr ? 'إلغاء' : 'Cancel'}
                  </button>
                </div>
              </div>
            )}

            {!parked && (
              <p className="mt-3 text-[11px] text-zinc-400">
                {isAr ? 'أو راجع الأصناف واحد واحد:' : 'Or review the items one by one:'}
              </p>
            )}
          </div>

          <ul className="divide-y divide-zinc-100 dark:divide-white/5">
            {items.map((item) => {
              const isBusy = busy === `item:${item._id}`;
              return (
                <li key={item._id} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <ParcelItemSummary item={item} isAr={isAr} />

                    {/* Two buttons, saving on press. No submit step means nothing already
                        decided can be lost by navigating away. */}
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => setAvailability(item, true)}
                        disabled={!!busy || parked}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-black transition disabled:opacity-40 ${
                          item.vendor_status === 'approved'
                            ? 'bg-emerald-500 text-white'
                            : 'bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 hover:bg-emerald-500/20'
                        }`}
                      >
                        {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                      </button>
                      <button
                        onClick={() => { setDeclineFor(item); setDeclineReason(item.vendor_note || ''); }}
                        disabled={!!busy || parked}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-black transition disabled:opacity-40 ${
                          item.vendor_status === 'declined'
                            ? 'bg-red-500 text-white'
                            : 'bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 hover:bg-red-500/20'
                        }`}
                      >
                        <X size={11} />
                      </button>
                    </div>
                  </div>

                  {item.vendor_status === 'declined' && item.vendor_note && (
                    <p className="mt-2 text-[11px] text-red-500">{item.vendor_note}</p>
                  )}

                  {/* A decline needs a reason — the website team says this exact sentence to
                      the customer on the phone. */}
                  {declineFor?._id === item._id && (
                    <div className="mt-3 rounded-xl bg-red-500/5 border border-red-500/20 p-3">
                      <label className="block text-[11px] font-bold text-red-600 mb-1.5">
                        {isAr ? 'ليه مش متوفر؟ (إجباري)' : 'Why is it unavailable? (required)'}
                      </label>
                      <input
                        autoFocus
                        value={declineReason}
                        onChange={(e) => setDeclineReason(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && submitDecline()}
                        placeholder={isAr ? 'مثال: خلص من المخزن' : 'e.g. out of stock'}
                        className="w-full px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-red-500/25 text-sm outline-none focus:border-red-500"
                      />
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={submitDecline}
                          disabled={!declineReason.trim() || !!busy}
                          className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-[11px] font-black disabled:opacity-40"
                        >
                          {isAr ? 'تأكيد' : 'Save'}
                        </button>
                        <button
                          onClick={() => { setDeclineFor(null); setDeclineReason(''); }}
                          className="px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-white/10 text-[11px] font-black text-zinc-600 dark:text-zinc-300"
                        >
                          {isAr ? 'إلغاء' : 'Cancel'}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {!parked && (
            <div className="p-5 pt-4 border-t border-zinc-100 dark:border-white/5">
              <button
                onClick={() => run('confirm', () => vendorApi.confirmSubOrderItems(orderId, subOrderId))}
                disabled={!sub.progress?.can_advance || !!busy}
                className="w-full py-3 rounded-xl bg-marine-cyan text-white text-sm font-black hover:bg-[#B91C1C] transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy === 'confirm'
                  ? <Loader2 size={16} className="animate-spin mx-auto" />
                  : (isAr ? 'تأكيد إتاحة المنتجات' : 'Confirm product availability')}
              </button>
              {sub.progress?.blocked_reason && (
                <p className="mt-2 text-[11px] text-amber-600 text-center">{sub.progress.blocked_reason}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---- What is in the box ----
          After stage 1 the review list is gone, but this is exactly when the vendor is
          picking and packing — so the products stay on screen, each one a click away. */}
      {stage !== 1 && !parked && items.length > 0 && (
        <div className="rounded-2xl bg-white dark:bg-white/5 border border-zinc-100 dark:border-white/5">
          <h2 className="text-sm font-black text-zinc-900 dark:text-white px-5 pt-5 pb-3">
            {isAr ? 'المنتجات في الشحنة دي' : 'Products in this parcel'}
          </h2>
          <ul className="divide-y divide-zinc-100 dark:divide-white/5">
            {items
              .filter((item) => item.vendor_status !== 'declined')
              .map((item) => (
                <li key={item._id} className="px-5 py-3">
                  <ParcelItemSummary item={item} isAr={isAr} />
                </li>
              ))}
          </ul>
        </div>
      )}

      {/* ---- Stage 2 ---- */}
      {stage === 2 && !parked && !ridesInLead && (
        <div className="rounded-2xl bg-white dark:bg-white/5 border border-zinc-100 dark:border-white/5 p-5 space-y-4">
          <h2 className="text-sm font-black text-zinc-900 dark:text-white">
            {isAr ? '② تعيين رقم التتبع' : '② Assign the tracking number'}
          </h2>

          {sub.progress?.tracking_mode === 'scan_label' ? (
            /* Smart Label on: the sticker is already on the box, so its number becomes the
               shipment rather than a second number being minted. */
            <>
              <p className="text-xs text-zinc-500 leading-relaxed">
                {isAr
                  ? 'امسح الـ Smart Label الملزوق على الشحنة، أو اكتب رقمه.'
                  : 'Scan the Smart Label stuck on this parcel, or type its number.'}
              </p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <ScanLine className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                  <input
                    autoFocus
                    value={trackingInput}
                    onChange={(e) => setTrackingInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && trackingInput.trim()) {
                        run('tracking', () => vendorApi.assignSubOrderTracking(orderId, subOrderId, trackingInput.trim()));
                      }
                    }}
                    placeholder={isAr ? 'رقم اللابيل' : 'Label number'}
                    className="w-full ps-10 pe-3 py-3 rounded-xl bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-sm font-mono outline-none focus:border-marine-cyan"
                  />
                </div>
                <button
                  onClick={() => run('tracking', () => vendorApi.assignSubOrderTracking(orderId, subOrderId, trackingInput.trim()))}
                  disabled={!trackingInput.trim() || !!busy}
                  className="px-5 rounded-xl bg-marine-cyan text-white text-sm font-black disabled:opacity-40"
                >
                  {busy === 'tracking' ? <Loader2 size={16} className="animate-spin" /> : (isAr ? 'تأكيد' : 'Confirm')}
                </button>
              </div>

              {/* The other route, always offered: no sticker to hand, or one Bosta refuses,
                  must not leave the vendor stuck at a scanner. Bosta mints the number and
                  the waybill is printed instead. */}
              <div className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                <span className="flex-1 h-px bg-zinc-200 dark:bg-white/10" />
                {isAr ? 'أو' : 'or'}
                <span className="flex-1 h-px bg-zinc-200 dark:bg-white/10" />
              </div>
              <div className="rounded-xl border border-dashed border-zinc-200 dark:border-white/10 p-4 space-y-3">
                <p className="text-xs text-zinc-500 leading-relaxed">
                  {isAr
                    ? `مفيش لابيل؟ اعمل الشحنة برقم من ${courierName}، وحمّل البوليصة واطبعها والزقها على الشحنة.`
                    : `No label? Create the shipment with a ${courierName} number, then download and print the waybill and stick it on the parcel.`}
                </p>
                <button
                  onClick={() => run(
                    'shipment',
                    () => vendorApi.createSubOrderShipment(orderId, subOrderId),
                    isAr ? 'اتعملت الشحنة — حمّل البوليصة واطبعها.' : 'Shipment created — download and print the waybill.'
                  )}
                  disabled={!!busy}
                  className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-zinc-100 dark:bg-white/10 text-sm font-black text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 transition disabled:opacity-40"
                >
                  {busy === 'shipment' ? <Loader2 size={15} className="animate-spin" /> : <FileDown size={15} />}
                  {isAr ? 'اعمل الشحنة واطبع البوليصة' : 'Create shipment and print waybill'}
                </button>
              </div>
            </>
          ) : (
            /* Smart Label off: Bosta minted the number when stage 1 finished, so the waybill
               is downloadable right now. */
            <>
              <p className="text-xs text-zinc-500 leading-relaxed">
                {isAr
                  ? 'حمّل بوليصة الشحن، اطبعها والزقها على الشحنة، وبعدين أكّد.'
                  : 'Download the waybill, print it, stick it on the parcel, then confirm.'}
              </p>
              {(sub.tracking_number || sub.bosta_tracking_number) && (
                <p className="text-xs font-mono font-bold text-zinc-700 dark:text-zinc-200">
                  {sub.tracking_number || sub.bosta_tracking_number}
                  {sub.smart_label_barcode && (
                    <span className="ms-2 font-sans font-medium text-zinc-500">
                      {isAr ? `ملصق ${sub.smart_label_barcode}` : `sticker ${sub.smart_label_barcode}`}
                    </span>
                  )}
                </p>
              )}
              {/* The shipment exists but carries no sticker — printed route, or a sticker
                  Bosta refused. A sticker can still be linked to it, the way Bosta's own
                  dashboard lets you try the next one. */}
              {sub.progress?.can_scan_label && (
                <div className="rounded-xl border border-dashed border-zinc-200 dark:border-white/10 p-3 space-y-2">
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    {isAr
                      ? 'اختياري — عندك ملصق ذكي؟ اسكنه وهيتربط بالشحنة دي بدل ما تطبع. لو مفيش، كمّل بالبوليصة.'
                      : 'Optional — have a Smart Sticker? Scan it and it links to this shipment instead of printing. Otherwise carry on with the waybill.'}
                  </p>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <ScanLine className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                      <input
                        value={trackingInput}
                        onChange={(e) => setTrackingInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && trackingInput.trim()) {
                            run('tracking', () => vendorApi.assignSubOrderTracking(orderId, subOrderId, trackingInput.trim()));
                          }
                        }}
                        placeholder={isAr ? 'رقم الملصق' : 'Sticker number'}
                        className="w-full ps-10 pe-3 py-2.5 rounded-xl bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-sm font-mono outline-none focus:border-marine-cyan"
                      />
                    </div>
                    <button
                      onClick={() => run('tracking', () => vendorApi.assignSubOrderTracking(orderId, subOrderId, trackingInput.trim()))}
                      disabled={!trackingInput.trim() || !!busy}
                      className="px-4 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-black disabled:opacity-40"
                    >
                      {busy === 'tracking' ? <Loader2 size={16} className="animate-spin" /> : (isAr ? 'اربط' : 'Link')}
                    </button>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={downloadAWB}
                  disabled={!!busy}
                  className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-zinc-100 dark:bg-white/10 text-sm font-black text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 transition disabled:opacity-40"
                >
                  {busy === 'awb' ? <Loader2 size={15} className="animate-spin" /> : <FileDown size={15} />}
                  {isAr ? 'حمّل بوليصة الشحن' : 'Download waybill'}
                </button>
                <button
                  onClick={() => run('tracking', () => vendorApi.assignSubOrderTracking(orderId, subOrderId, null))}
                  disabled={!!busy}
                  className="flex-1 min-w-[160px] py-3 rounded-xl bg-marine-cyan text-white text-sm font-black hover:bg-[#B91C1C] transition disabled:opacity-40"
                >
                  {busy === 'tracking'
                    ? <Loader2 size={16} className="animate-spin mx-auto" />
                    : (isAr ? 'لزقتها — كمّل' : 'It is attached — continue')}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---- Stage 3 ---- */}
      {(stage === 3 || sealed || (done && photos.length > 0)) && !parked && !ridesInLead && (
        <div className="rounded-2xl bg-white dark:bg-white/5 border border-zinc-100 dark:border-white/5 p-5 space-y-4">
          <h2 className="text-sm font-black text-zinc-900 dark:text-white">
            {isAr ? '③ جاهز للاستلام' : '③ Ready for pickup'}
          </h2>
          <p className="text-xs text-zinc-500 leading-relaxed">
            {isAr
              ? 'اقفل الشحنة وخلّي اللابيل باين عليها. الصور اختيارية بس بننصح بيها — هي دليلك لو العميل اعترض على اللي وصله.'
              : 'Seal the parcel with the label visible. Photos are optional but recommended — they are your evidence if the customer later disputes what arrived.'}
          </p>

          {photos.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {photos.map((p) => (
                <div key={p._id} className="relative aspect-square rounded-xl overflow-hidden border border-zinc-200 dark:border-white/10 group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="w-full h-full object-cover" />
                  {!done && (
                    <button
                      onClick={() => run('rm-photo', () => vendorApi.removeSubOrderPhoto(orderId, subOrderId, p._id))}
                      disabled={!!busy}
                      className="absolute top-1 end-1 p-1 rounded-lg bg-black/60 text-white opacity-0 group-hover:opacity-100 transition"
                      aria-label={isAr ? 'حذف الصورة' : 'Remove photo'}
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {!done && !sealed && photos.length < 5 && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                capture="environment"
                className="hidden"
                onChange={(e) => uploadPhotos(Array.from(e.target.files || []))}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={!!busy}
                className="w-full py-3 rounded-xl border-2 border-dashed border-zinc-200 dark:border-white/10 text-sm font-bold text-zinc-500 hover:border-marine-cyan/40 hover:text-marine-primary transition disabled:opacity-40 inline-flex items-center justify-center gap-2"
              >
                {busy === 'photos' ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
                {isAr ? `أضف صور (${photos.length}/5)` : `Add photos (${photos.length}/5)`}
              </button>
            </>
          )}

          {!done && !sealed && (
            <div>
              <button
                onClick={() => run('ready', () => vendorApi.markSubOrderReady(orderId, subOrderId))}
                disabled={!!busy}
                className="w-full py-3 rounded-xl bg-marine-cyan text-white text-sm font-black hover:bg-[#B91C1C] transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy === 'ready'
                  ? <Loader2 size={16} className="animate-spin mx-auto" />
                  : (isAr ? 'الشحنة جاهزة للاستلام' : 'The parcel is ready for pickup')}
              </button>
              {photos.length === 0 && (
                <p className="mt-2 text-[11px] text-zinc-400 text-center">
                  {isAr
                    ? 'تقدر تكمّل من غير صور — بس الصور بتحميك لو حصل خلاف.'
                    : 'You can continue without photos — but they protect you if anything is disputed.'}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---- Stage 4: the parcel is sealed and still here. Did the courier take it? ----
           This step is the whole point of the change: nothing anywhere may say the parcel
           left the store until the vendor presses this, or Bosta reports the collection. */}
      {sealed && !parked && !ridesInLead && (
        <div className="rounded-2xl bg-white dark:bg-white/5 border border-zinc-100 dark:border-white/5 p-5 space-y-4">
          <h2 className="text-sm font-black text-zinc-900 dark:text-white">
            {isAr ? '④ تسليم الشحنة للمندوب' : '④ Give the parcel to the courier'}
          </h2>
          <p className="text-xs text-zinc-500 leading-relaxed">
            {isAr
              ? `الشحنة لسه عندك في الفرع. أول ما مندوب ${courierName} ياخدها بإيده، اضغط الزرار ده. متضغطش قبل ما يستلمها فعلاً.`
              : `The parcel is still with you at the branch. The moment a ${courierName} courier physically takes it, press this. Do not press it before they actually have it.`}
          </p>

          {/* The appointment. It used to live only on admin screens, which left the one
              person who has to be standing there with the box not knowing when to be. */}
          {pickup ? (
            <div className="rounded-xl bg-teal-500/10 border border-teal-500/20 p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400 flex items-center gap-1.5">
                <CalendarClock size={13} />
                {isAr ? 'ميعاد المندوب' : 'Courier appointment'}
              </p>
              <p className="mt-1.5 text-sm font-black text-zinc-900 dark:text-white">
                {pickup.scheduled_date}
                <span className="text-zinc-400 font-bold"> · </span>
                {pickup.scheduled_time_slot}
              </p>
              {pickup.location_address && (
                <p className="text-[11px] text-zinc-500 mt-1">{pickup.location_address}</p>
              )}
              {pickup.status === 'cancelled' && (
                <p className="text-[11px] font-bold text-red-500 mt-2">
                  {isAr ? 'الميعاد ده اتلغى — استنى ميعاد جديد.' : 'This visit was cancelled — wait for a new appointment.'}
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-xl bg-zinc-50 dark:bg-white/5 border border-zinc-100 dark:border-white/10 p-4">
              <p className="text-[11px] text-zinc-500 flex items-center gap-1.5">
                <CalendarClock size={13} />
                {isAr
                  ? 'لسه متحددش ميعاد للمندوب. هيوصلك إشعار أول ما إدارة الموقع تحجزه.'
                  : 'No courier appointment yet. You will be notified as soon as the website team books one.'}
              </p>
            </div>
          )}

          <button
            onClick={() => {
              // With no courier booked, this is almost always pressed by running through the
              // steps, not by a courier standing at the counter — and once pressed the parcel
              // leaves the admin's pickup list. One question first.
              // Arrive collects without a booking from us, so only a Bosta parcel is asked.
              if (sub.courier !== 'arrive' && (!pickup || pickup.status === 'cancelled') && !window.confirm(isAr
                ? `مفيش ميعاد مندوب محجوز للشحنة دي لسه.\n\nمتأكد إن مندوب ${courierName} أخدها منك بإيده دلوقتي؟ لو لسه عندك، اضغط "إلغاء" واستنى إدارة الموقع تحجزلك مندوب.`
                : `No courier is booked for this parcel yet.\n\nAre you sure a ${courierName} courier has physically taken it just now? If it is still with you, press Cancel and wait for the website team to book a courier.`)) return;
              run(
                'handover',
                () => vendorApi.confirmSubOrderHandover(orderId, subOrderId),
                isAr ? 'تم تأكيد تسليم الشحنة للمندوب' : 'Handover confirmed'
              );
            }}
            disabled={!!busy}
            className="w-full py-3 rounded-xl bg-marine-cyan text-white text-sm font-black hover:bg-[#B91C1C] transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy === 'handover'
              ? <Loader2 size={16} className="animate-spin mx-auto" />
              : (isAr ? 'المندوب استلم الشحنة' : 'The courier took the parcel')}
          </button>
        </div>
      )}

      {/* ---- After handover ---- */}
      {done && (
        <div className="rounded-2xl bg-white dark:bg-white/5 border border-zinc-100 dark:border-white/5 p-5">
          <p className="text-sm font-black text-zinc-900 dark:text-white flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-500" />
            {sub.status === 'delivered'
              ? (isAr ? 'تم تسليم الشحنة للعميل' : 'Delivered to the customer')
              : (isAr ? 'الشحنة خرجت من عندك' : 'This parcel has left your hands')}
          </p>
          {sub.handed_over_at && (
            <p className="text-[11px] text-zinc-400 mt-1">
              {isAr
                ? `أكدت تسليمها للمندوب في ${new Date(sub.handed_over_at).toLocaleString('ar-EG')}`
                : `You confirmed the handover on ${new Date(sub.handed_over_at).toLocaleString('en-GB')}`}
            </p>
          )}
          {(sub.tracking_number || sub.bosta_tracking_number) && (
            <p className="text-xs font-mono text-zinc-500 mt-2">{sub.tracking_number || sub.bosta_tracking_number}</p>
          )}
          {(sub.tracking_history || []).length > 0 && (
            <ol className="mt-4 space-y-2 border-s-2 border-zinc-100 dark:border-white/10 ps-4">
              {[...sub.tracking_history].reverse().slice(0, 8).map((e, i) => (
                <li key={i} className="text-[11px]">
                  <span className="font-bold text-zinc-700 dark:text-zinc-200">{e.state}</span>
                  {e.notes && <span className="text-zinc-500"> — {e.notes}</span>}
                  <span className="block text-zinc-400">
                    {e.timestamp ? new Date(e.timestamp).toLocaleString(isAr ? 'ar-EG' : 'en-GB') : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* Cancellation is a REQUEST, and only while no courier is booked */}
      {sub.can_cancel && !sub.cancel_request?.requested_at && (
        <button
          onClick={() => {
            const reason = window.prompt(isAr ? 'سبب طلب الإلغاء؟' : 'Why should this parcel be cancelled?');
            if (reason?.trim()) {
              run('cancel-req', () => vendorApi.requestSubOrderCancel(orderId, subOrderId, reason.trim()),
                isAr ? 'تم إرسال الطلب لإدارة الموقع.' : 'Your request was sent to the website team.');
            }
          }}
          disabled={!!busy}
          className="text-[11px] font-bold text-zinc-400 hover:text-red-500 transition disabled:opacity-40"
        >
          {isAr ? 'اطلب إلغاء الشحنة دي' : 'Request cancellation of this parcel'}
        </button>
      )}
      {sub.cancel_request?.requested_at && (
        <p className="text-[11px] text-amber-600">
          {isAr
            ? 'طلب الإلغاء مع إدارة الموقع.'
            : 'Your cancellation request is with the website team.'}
        </p>
      )}
      {!sub.can_cancel && sub.cancel_blocked_reason && !done && (
        <p className="text-[11px] text-zinc-400">{isAr ? (sub.cancel_blocked_reason_ar || sub.cancel_blocked_reason) : sub.cancel_blocked_reason}</p>
      )}
    </div>
  );
}

/**
 * One product line on the vendor's parcel screen: picture, name, option and quantity, and
 * the two ways into the product — its public page (new tab, exactly what the customer
 * bought) and the vendor's own edit screen. Same pair the customer and admin screens
 * offer. A product deleted since the order was placed has no slug, so its link is hidden
 * and the line still shows what was ordered.
 */
function ParcelItemSummary({ item, isAr }) {
  const productId = item.product_id?._id || item.product_id;
  const publicHref = item.product_slug ? `/product/${item.product_slug}` : null;

  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="w-12 h-12 rounded-lg bg-zinc-100 dark:bg-white/5 border border-zinc-100 dark:border-white/10 overflow-hidden shrink-0 grid place-items-center">
        {item.product_image
          ? <img src={item.product_image} alt="" className="w-full h-full object-cover" />
          : <Package size={16} className="text-zinc-300" />}
      </div>
      <div className="min-w-0">
        {publicHref ? (
          <Link
            href={publicHref}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-sm font-bold text-zinc-900 dark:text-white truncate hover:text-marine-primary hover:underline"
          >
            {item.product_title}
          </Link>
        ) : (
          <p className="text-sm font-bold text-zinc-900 dark:text-white truncate">{item.product_title}</p>
        )}
        <p className="text-[11px] text-zinc-500 mt-0.5">
          {item.variant_label && item.variant_label !== 'Default' ? `${item.variant_label} · ` : ''}
          ×{item.quantity}
          {item.product_sku ? ` · ${item.product_sku}` : ''}
        </p>
        {(publicHref || productId) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
            {publicHref && (
              <Link
                href={publicHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-bold text-marine-primary hover:underline"
              >
                <ExternalLink size={11} />
                {isAr ? 'صفحة المنتج' : 'Product page'}
              </Link>
            )}
            {productId && (
              <Link
                href={`/dashboard/products/${productId}`}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:underline"
              >
                <Edit3 size={11} />
                {isAr ? 'تعديل المنتج' : 'Edit product'}
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
