'use client';

import { useEffect, useState } from 'react';
import Link from '../LocaleLink';
import {
  Store, MapPin, Check, AlertTriangle, Clock, Truck, XCircle, Loader2,
  FileDown, Camera, Send, Undo2, ChevronDown, ExternalLink, Search, Lock, Building2, PackageOpen,
} from 'lucide-react';
import {
  VENDOR_STAGES, getSubOrderStatusLabel, getSubOrderStatusColor, getSubOrderStage,
  getReturnStateLabel, getReturnStateColor,
} from '../../lib/orderStatus';
import { orgTerms } from '../../lib/orgTerms';
import Overlay from '../Overlay';

/** "1 day 3 hours" / "يوم و 3 ساعات" until `date`, or null once it has passed. */
function timeLeft(date, isAr) {
  const ms = new Date(date).getTime() - Date.now();
  if (!(ms > 0)) return null;
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (isAr) {
    const parts = [];
    if (d) parts.push(d === 1 ? 'يوم' : d === 2 ? 'يومين' : `${d} أيام`);
    if (h) parts.push(h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : `${h} ساعات`);
    if (!d && !h) parts.push(`${Math.max(1, m)} دقيقة`);
    return parts.join(' و ');
  }
  const parts = [];
  if (d) parts.push(`${d} day${d > 1 ? 's' : ''}`);
  if (h) parts.push(`${h} hour${h > 1 ? 's' : ''}`);
  if (!d && !h) parts.push(`${Math.max(1, m)} min`);
  return parts.join(' ');
}

/**
 * One parcel on the admin's order screen — everything about it, and every button that acts
 * on it, in one card.
 *
 * The actions live inside the card they apply to rather than in a page-level toolbar, so it
 * is structurally impossible to cancel or dispatch the wrong vendor's parcel on an order
 * that has three of them.
 */
export default function AdminParcelCard({
  parcel,
  currency,
  isAr,
  // company | authority | school | property — the words for a corporate-account order.
  orgType = 'company',
  busy = '',
  onDispatch,
  onRelease,
  onCancel,
  onReactivate,
  onOverride,
  onPrintAWB,
  // Courier choice: which courier is the default, set one on this parcel, pick an Arrive
  // area, and resolve a send whose outcome was unknown.
  defaultCourier = 'bosta',
  courierOptions = [],
  onSetCourier,
  onTransferCourier,
  onSearchSectors,
  onResolveDispatch,
  onCourierCancelDone,
  // The parcel has its shipment (printed waybill or sticker) but is still at the label
  // stage because nobody pressed continue. This moves it on; the sticker is optional.
  onConfirmWaybill,
  // Stage ③ on the vendor's behalf: sealed, waiting for a courier. Until this is pressed
  // the Pickups screen only counts the parcel as "still packing".
  onMarkReady,
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [sectorQuery, setSectorQuery] = useState('');
  const [sectorResults, setSectorResults] = useState([]);
  const [sectorSearching, setSectorSearching] = useState(false);
  const [transferTarget, setTransferTarget] = useState('');
  const [transferSector, setTransferSector] = useState(null);
  const [sourceRemoved, setSourceRemoved] = useState(false);

  // Search Arrive areas as the admin types (debounced), only while the picker is relevant.
  useEffect(() => {
    if (!onSearchSectors || !sectorQuery.trim()) { setSectorResults([]); setSectorSearching(false); return undefined; }
    let alive = true;
    setSectorSearching(true);
    const t = setTimeout(async () => {
      try { const rows = await onSearchSectors(sectorQuery.trim()); if (alive) setSectorResults(rows || []); }
      catch (_) { if (alive) setSectorResults([]); }
      finally { if (alive) setSectorSearching(false); }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [sectorQuery, onSearchSectors]);

  const money = (n) => `${currency} ${Number(n || 0).toFixed(2)}`;
  const stage = getSubOrderStage(parcel.status);
  const parked = parcel.status === 'needs_admin';
  const cancelled = parcel.status === 'cancelled';
  const problem = parcel.status === 'exception' || parcel.status === 'returned';
  const trackingNumber = parcel.tracking_number || parcel.bosta_tracking_number || null;
  const dispatched = !!trackingNumber;
  const effectiveCourier = parcel.courier || parcel.courier_override || defaultCourier;
  const courierName = (key) => {
    const opt = courierOptions.find((o) => o.key === key);
    if (opt) return isAr ? (opt.label_ar || opt.label) : opt.label;
    return key === 'arrive' ? (isAr ? 'أرايف' : 'Arrive') : (isAr ? 'بوسطة' : 'Bosta');
  };
  const canChangeCourier = parcel.can_change_courier !== false && !dispatched && !cancelled && !parcel.dispatch_attempt && !parcel.courier_transfer && !!onSetCourier;
  const needsSector = effectiveCourier === 'arrive' && !parcel.courier_sector_id;
  const attempt = parcel.dispatch_attempt?.at ? parcel.dispatch_attempt : null;
  const isBusy = busy === parcel._id;
  const sourceNeedsManualRemoval = dispatched && courierOptions.find((o) => o.key === effectiveCourier)?.capabilities?.cancelApi === false;
  const transferBlocked = (isAr && parcel.courier_transfer_blocked_reason_ar) || parcel.courier_transfer_blocked_reason;

  useEffect(() => {
    setTransferTarget('');
    setTransferSector(null);
    setSourceRemoved(false);
  }, [effectiveCourier, trackingNumber]);

  // Company consolidation (feature 14). A parcel still collecting in its batch, one that
  // rides inside a colleague's box, or the box itself while some of its orders are still
  // unconfirmed — none of these may be sent on their own. The server refuses all three;
  // the card says so up front instead of offering a button that fails.
  const cb = parcel.company_batch || null;
  const ot = orgTerms(orgType, isAr);
  const batch = cb?.batch || null;
  const batchWaiting = !!cb?.waiting;
  const batchRider = cb?.role === 'rider' || parcel.status === 'in_batch_parcel';
  const batchLeadPending = cb?.role === 'lead' && Number(batch?.awaiting_confirmation) > 0;
  const sendLocked = batchWaiting || batchRider || batchLeadPending;
  const closesIn = batch?.deadline_at ? timeLeft(batch.deadline_at, isAr) : null;
  const closesAt = batch?.deadline_at
    ? new Date(batch.deadline_at).toLocaleString(isAr ? 'ar-EG' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })
    : null;

  const photos = parcel.parcel_photos || [];

  return (
    <div
      className={`rounded-2xl border overflow-hidden ${
        parked || problem ? 'border-amber-500/40 bg-amber-500/[0.03]'
        : cancelled ? 'border-zinc-200 dark:border-white/10 opacity-60'
        : 'border-zinc-100 dark:border-white/5 bg-white dark:bg-white/5'
      }`}
    >
      {/* Identity */}
      <div className="p-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-black text-zinc-900 dark:text-white flex items-center gap-1.5">
            <Store size={13} className="text-zinc-400" />
            {parcel.vendor_name || (isAr ? 'تاجر' : 'Vendor')}
          </p>
          {parcel.fulfillment_location && (
            <p className="text-[11px] text-zinc-500 mt-1 flex items-center gap-1">
              <MapPin size={10} />{parcel.fulfillment_location}
            </p>
          )}
          <p className="text-[10px] font-mono text-zinc-400 mt-1">{parcel.reference}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider ${getSubOrderStatusColor(parcel.status)}`}>
            {getSubOrderStatusLabel(parcel.status, isAr)}
          </span>
          {/* What has gone back out of this parcel — the admin is the one who resolves it. */}
          {getReturnStateLabel(parcel.return_state, isAr) && (
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${getReturnStateColor(parcel.return_state)}`}>
              <Undo2 size={10} />
              {getReturnStateLabel(parcel.return_state, isAr)}
            </span>
          )}
          {parcel.is_overdue && (
            <span className="inline-flex items-center gap-1 text-[10px] font-black text-red-500">
              <Clock size={10} />{isAr ? 'متأخرة' : 'Overdue'}
            </span>
          )}
        </div>
      </div>

      {/* Where the vendor is in their three stages */}
      {stage && !cancelled && (
        <div className="px-4 pb-3 flex items-center gap-1">
          {VENDOR_STAGES.map((s, i) => (
            <div key={s.step} className="flex items-center flex-1">
              <div
                className={`w-5 h-5 rounded-full grid place-items-center text-[9px] font-black shrink-0 ${
                  s.step < stage ? 'bg-emerald-500 text-white'
                  : s.step === stage ? 'bg-marine-cyan text-white'
                  : 'bg-zinc-200 dark:bg-white/10 text-zinc-400'
                }`}
              >
                {s.step < stage ? <Check size={9} /> : s.step}
              </div>
              {i < VENDOR_STAGES.length - 1 && (
                <div className={`h-0.5 flex-1 mx-1 ${s.step < stage ? 'bg-emerald-500' : 'bg-zinc-200 dark:bg-white/10'}`} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* A company consolidation order (feature 14): waiting in its batch, or one of the
          orders inside a combined parcel — so the admin knows why it does not ship alone. */}
      {cb && (
        <div className="mx-4 mb-3 rounded-xl bg-indigo-500/10 border border-indigo-500/25 p-3 text-xs text-indigo-800 dark:text-indigo-200 space-y-1.5">
          <p className="font-black text-[13px] flex items-center gap-1.5">
            <Building2 size={14} />
            {batchWaiting
              ? (isAr ? `طلب ${ot.one} بيتجمّع على ${ot.theBranch} 🧺` : `${ot.One} order, collecting for the ${ot.branch} 🧺`)
              : cb.role === 'lead'
                ? (isAr ? `الطرد المجمّع لطلبات ${ot.the} 📦` : `The combined ${ot.one} parcel 📦`)
                : cb.role === 'rider'
                  ? (isAr ? `طلب ${ot.one} جوه طرد مجمّع 📦` : `${ot.One} order inside a combined parcel 📦`)
                  : (isAr ? `طلب ${ot.one} خرج من التجميع` : `${ot.One} order that left its batch`)}
          </p>

          {(batch?.company_name || batch?.office_name) && (
            <p className="text-indigo-700/80 dark:text-indigo-300/80">
              {[batch.company_name, batch.office_name && (isAr ? `فرع ${batch.office_name}` : `${batch.office_name} branch`)].filter(Boolean).join(' · ')}
            </p>
          )}

          {batchWaiting ? (
            <>
              <p className="leading-relaxed">
                {isAr
                  ? 'الطلب ده مستني طلبات زمايله من نفس التاجر عشان يتشحنوا كلهم في طرد واحد على نفس العنوان ويوفّروا في الشحن. التاجر لسه مش شايفه.'
                  : "This order is waiting for colleagues' orders from the same vendor so they all ship to the same address in one parcel and save on shipping. The vendor cannot see it yet."}
              </p>
              {batch && (
                <>
                  <div className="flex items-center gap-2 pt-0.5">
                    <div className="flex-1 h-1.5 rounded-full bg-indigo-500/15 overflow-hidden">
                      <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, (Number(batch.order_count) / Math.max(1, Number(batch.target_count))) * 100)}%` }} />
                    </div>
                    <span className="font-black tabular-nums" dir="ltr">{batch.order_count}/{batch.target_count}</span>
                  </div>
                  <p>
                    {isAr
                      ? <>الدفعة بتقفل لوحدها لما توصل <b>{batch.target_count} طلبات</b> أو <b>{closesAt}</b>{closesIn ? <> (باقي <b>{closesIn}</b>)</> : null} — أيهما أقرب.</>
                      : <>The batch closes by itself at <b>{batch.target_count} orders</b> or on <b>{closesAt}</b>{closesIn ? <> (<b>{closesIn}</b> left)</> : null} — whichever comes first.</>}
                  </p>
                </>
              )}
            </>
          ) : cb.role === 'lead' ? (
            <p className="leading-relaxed">
              {isAr
                ? `شحنة الطرد ده بتشيل ${batch?.order_count || 'كل'} طلبات زمايله على نفس العنوان.`
                : `This parcel's shipment carries ${batch?.order_count || 'all the'} colleagues' orders to the same address.`}
              {batchLeadPending && (
                <b className="block mt-1">
                  {isAr
                    ? `مستنيين التاجر يأكّد ${batch.awaiting_confirmation} من ${batch.order_count} طلبات قبل ما الطرد يتبعت.`
                    : `Waiting for the vendor to confirm ${batch.awaiting_confirmation} of ${batch.order_count} orders before it can be sent.`}
                </b>
              )}
            </p>
          ) : cb.role === 'rider' ? (
            <p className="leading-relaxed">
              {isAr ? `بيتشحن جوه الطرد المجمّع #${cb.lead_reference} — مالوش شحنة لوحده.` : `Ships inside the combined parcel #${cb.lead_reference} — it has no shipment of its own.`}
            </p>
          ) : (
            <p>{isAr ? 'خرج من الدفعة وبيتشحن لوحده زي أي طلب عادي.' : 'Left its batch and ships on its own like any order.'}</p>
          )}

          {Number(cb.savings) > 0 && (
            <p className="font-bold text-emerald-700 dark:text-emerald-400">{isAr ? `وفّر ${Number(cb.savings).toFixed(2)} في الشحن` : `Saved ${Number(cb.savings).toFixed(2)} on shipping`}</p>
          )}

          {batchWaiting && batch?.company_id && (
            <Link href={`/admin/dashboard/companies/${batch.company_id}`} className="inline-flex items-center gap-1 font-bold underline underline-offset-2 hover:no-underline">
              {isAr ? `مستعجل؟ تقدر تقفل الدفعة بدري من صفحة ${ot.the}` : `In a hurry? Close the batch early from the ${ot.one} page`}
              <ExternalLink size={11} />
            </Link>
          )}
        </div>
      )}

      {/* Why it is parked — the words the admin repeats to the customer on the phone */}
      {parked && parcel.needs_admin_reason && (
        <div className="mx-4 mb-3 rounded-xl bg-amber-500/10 border border-amber-500/25 p-3">
          <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <AlertTriangle size={11} />{isAr ? 'المنتجات غير المتاحة' : 'Unavailable items'}
          </p>
          <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80 mt-1">{parcel.needs_admin_reason}</p>
        </div>
      )}

      {parcel.cancel_request?.requested_at && !cancelled && (
        <div className="mx-4 mb-3 rounded-xl bg-orange-500/10 border border-orange-500/25 p-3">
          <p className="text-[11px] font-bold text-orange-700 dark:text-orange-400">
            {isAr ? 'التاجر طلب إلغاء الشحنة' : 'The vendor asked to cancel this parcel'}
          </p>
          <p className="text-[11px] text-orange-700/80 dark:text-orange-300/80 mt-1">{parcel.cancel_request.reason}</p>
        </div>
      )}

      {!cancelled && parcel.reactivation_count > 0 && (
        <p className="mx-4 mb-3 text-[11px] text-emerald-600 font-bold">
          {isAr
            ? `أُعيد تفعيلها ${parcel.reactivation_count > 1 ? `${parcel.reactivation_count} مرات` : ''} — هتتبعت لبوسطة بشحنة جديدة`
            : `Reinstated${parcel.reactivation_count > 1 ? ` ×${parcel.reactivation_count}` : ''} — ships on a new Bosta delivery`}
        </p>
      )}

      {parcel.courier_cancel_pending && (
        <div className="mx-4 mb-3 rounded-xl bg-red-500/10 border border-red-500/25 p-3 space-y-2">
          <p className="text-[11px] font-bold text-red-600 flex items-center gap-1.5">
            <AlertTriangle size={11} />
            {isAr
              ? `البوليصة ${parcel.courier_cancel_pending.tracking_number} لسه شغالة عند ${courierName(parcel.courier_cancel_pending.provider)}.`
              : `Waybill ${parcel.courier_cancel_pending.tracking_number} is still live at ${courierName(parcel.courier_cancel_pending.provider)}.`}
          </p>
          {/* Arrive has no cancellation, so "cancel it by hand" was never an instruction
              anyone could follow. The server works out what CAN be done — delete the record
              while the parcel is still on the shelf, or ask for it back once a courier has
              it — and says so here, with what it is expected to cost. */}
          {(isAr ? parcel.courier_cancel_pending.instruction_ar : parcel.courier_cancel_pending.instruction) && (
            <p className="text-[11px] leading-relaxed text-red-700 dark:text-red-400">
              {isAr ? parcel.courier_cancel_pending.instruction_ar : parcel.courier_cancel_pending.instruction}
            </p>
          )}
          {parcel.courier_cancel_pending.expected_fee > 0 && (
            <p className="text-[11px] font-black text-red-600">
              {isAr
                ? `متوقع تتحاسب: ${parcel.courier_cancel_pending.expected_fee} ج.م`
                : `Expected charge: ${parcel.courier_cancel_pending.expected_fee} EGP`}
            </p>
          )}
          {onCourierCancelDone && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => onCourierCancelDone(parcel)}
              className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 text-[10px] font-black hover:bg-emerald-500/20 disabled:opacity-40"
            >
              {isAr ? 'تم الإلغاء عند الشركة' : 'Done — cancelled at the courier'}
            </button>
          )}
        </div>
      )}

      {cancelled && parcel.cancel_reason && (
        <p className="mx-4 mb-3 text-[11px] text-zinc-500">
          {parcel.cancel_reason}
          {parcel.refunded_amount > 0 && (
            <span className="text-emerald-600 font-bold"> · {isAr ? 'رُد ' : 'refunded '}{money(parcel.refunded_amount)}</span>
          )}
        </p>
      )}

      {/* Courier — chosen per parcel until a shipment exists; stamped on the shipment after */}
      {!cancelled && (
        <div className="mx-4 mb-3 rounded-xl border border-zinc-100 dark:border-white/10 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-wider flex items-center gap-1">
              <Truck size={10} />{isAr ? 'شركة الشحن' : 'Courier'}
            </span>
            {canChangeCourier ? (
              <select
                value={parcel.courier_override || ''}
                disabled={!!busy}
                onChange={(e) => onSetCourier(parcel, e.target.value || null)}
                className="text-[11px] font-bold rounded-lg border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#14171A] px-2 py-1"
              >
                <option value="">{isAr ? `الافتراضي (${courierName(defaultCourier)})` : `Default (${courierName(defaultCourier)})`}</option>
                {(courierOptions.length ? courierOptions : [{ key: 'bosta' }, { key: 'arrive' }]).map((o) => (
                  <option key={o.key} value={o.key} disabled={o.configured === false}>
                    {courierName(o.key)}{o.configured === false ? (isAr ? ' — غير مُعدّ' : ' — not configured') : ''}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-[11px] font-black text-zinc-800 dark:text-zinc-100">{courierName(effectiveCourier)}</span>
            )}
          </div>

          {/* Arrive addresses by district: the area is chosen here, or matched from the address */}
          {effectiveCourier === 'arrive' && !dispatched && (
            <div className="space-y-1.5">
              {parcel.courier_sector_name ? (
                <p className="text-[11px] text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                  <MapPin size={10} className="text-emerald-500" />
                  {isAr ? 'المنطقة: ' : 'Area: '}<b>{parcel.courier_sector_name}</b>
                  <span className="text-zinc-400">#{parcel.courier_sector_id}</span>
                </p>
              ) : (
                <p className="text-[11px] text-amber-600 flex items-center gap-1.5">
                  <AlertTriangle size={10} />
                  {isAr ? 'اختار منطقة التوصيل عند أرايف قبل الإرسال.' : 'Choose the Arrive delivery area before sending.'}
                </p>
              )}
              {canChangeCourier && (
                <div className="relative">
                  <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-white/10 px-2 py-1">
                    {sectorSearching ? <Loader2 size={11} className="animate-spin text-zinc-400" /> : <Search size={11} className="text-zinc-400" />}
                    <input
                      value={sectorQuery}
                      onChange={(e) => setSectorQuery(e.target.value)}
                      placeholder={isAr ? 'ابحث عن المنطقة (مثلاً المعادي)' : 'Search area (e.g. Maadi / المعادي)'}
                      className="flex-1 bg-transparent text-[11px] outline-none"
                    />
                  </div>
                  {sectorResults.length > 0 && (
                    <ul className="absolute z-20 mt-1 w-full max-h-48 overflow-auto rounded-lg border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#14171A] shadow-lg">
                      {sectorResults.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            disabled={!r.serviceable || !!busy}
                            onClick={() => { onSetCourier(parcel, 'arrive', r.id); setSectorQuery(''); setSectorResults([]); }}
                            className="w-full text-start px-2 py-1.5 text-[11px] hover:bg-zinc-50 dark:hover:bg-white/5 disabled:opacity-40 flex items-center justify-between gap-2"
                          >
                            <span className="font-bold">{r.name}</span>
                            <span className="text-zinc-400">{r.group}{!r.serviceable ? (isAr ? ' · غير مخدومة' : ' · not served') : ''}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {/* A send whose outcome is unknown blocks further sends until a person looks */}
          {attempt && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/25 p-2 space-y-1.5">
              <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1">
                <AlertTriangle size={11} />
                {isAr
                  ? `إرسال سابق لـ ${courierName(attempt.provider)} ماكملش. راجع بورتال الشركة على المرجع ${attempt.reference}.`
                  : `A previous send to ${courierName(attempt.provider)} did not finish. Check the courier portal for reference ${attempt.reference}.`}
              </p>
              {onResolveDispatch && (
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => onResolveDispatch(parcel, 'attach')}
                    className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 text-[10px] font-black hover:bg-emerald-500/20 disabled:opacity-40"
                  >
                    {isAr ? 'لقيت الشحنة — أدخل رقم البوليصة' : 'Found it — enter the waybill'}
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => onResolveDispatch(parcel, 'clear')}
                    className="px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 text-[10px] font-black hover:bg-zinc-200 disabled:opacity-40"
                  >
                    {isAr ? 'مفيش شحنة — امسح المحاولة' : 'Nothing was created — clear'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Items */}
      <ul className="px-4 space-y-1">
        {(parcel.items || []).map((item, i) => (
          <li key={item._id || i} className="flex items-center justify-between gap-3 text-[11px]">
            <span className="text-zinc-600 dark:text-zinc-300 truncate">
              {item.product_title}
              {item.variant_label && item.variant_label !== 'Default' && (
                <span className="text-zinc-400"> ({item.variant_label})</span>
              )}
              <span className="text-zinc-400"> ×{item.quantity}</span>
            </span>
            <span
              className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${
                item.vendor_status === 'approved' ? 'bg-emerald-500/15 text-emerald-600'
                : item.vendor_status === 'declined' ? 'bg-red-500/15 text-red-500'
                : 'bg-amber-500/15 text-amber-600'
              }`}
            >
              {item.vendor_status}
            </span>
          </li>
        ))}
      </ul>

      {/* Money — the split this parcel carries */}
      <div className="mx-4 my-3 rounded-xl bg-zinc-50 dark:bg-white/5 p-3 grid grid-cols-2 gap-y-1.5 text-[11px]">
        <span className="text-zinc-500">{isAr ? 'البضاعة' : 'Merchandise'}</span>
        <span className="text-end font-bold text-zinc-800 dark:text-zinc-100">{money(parcel.merchandise_total)}</span>
        <span className="text-zinc-500">{isAr ? 'نصيبها من الشحن' : 'Shipping share'}</span>
        <span className="text-end text-zinc-700 dark:text-zinc-200">{money(parcel.shipping_share)}</span>
        {Number(parcel.coupon_share) > 0 && (
          <>
            <span className="text-zinc-500">{isAr ? 'نصيبها من الكوبون' : 'Coupon share'}</span>
            <span className="text-end text-emerald-600">− {money(parcel.coupon_share)}</span>
            {/* Who funded it: the vendor's part comes off their earning, ours is our cost. */}
            <span className="text-[10px] text-zinc-400 ps-3">{isAr ? 'منها على التاجر' : 'of which vendor'}</span>
            <span className="text-end text-[10px] text-zinc-500">{money(parcel.coupon_vendor_share || 0)}</span>
            <span className="text-[10px] text-zinc-400 ps-3">{isAr ? 'ومنها على الموقع' : 'of which platform'}</span>
            <span className="text-end text-[10px] text-zinc-500">{money(parcel.coupon_platform_share ?? (Number(parcel.coupon_share || 0) - Number(parcel.coupon_vendor_share || 0)))}</span>
          </>
        )}
        {Number(parcel.loyalty_share) > 0 && (
          <>
            <span className="text-zinc-500">{isAr ? 'نصيبها من النقاط' : 'Points share'}</span>
            <span className="text-end text-emerald-600">− {money(parcel.loyalty_share)}</span>
          </>
        )}
        <span className="text-zinc-500 pt-1.5 border-t border-zinc-200 dark:border-white/10">
          {isAr ? 'المطلوب للمندوب' : 'Courier collects'}
        </span>
        <span className="text-end font-black text-marine-primary pt-1.5 border-t border-zinc-200 dark:border-white/10">
          {money(parcel.cod_amount)}
        </span>
        <span className="text-zinc-500">{isAr ? 'العمولة' : 'Commission'}</span>
        <span className="text-end text-zinc-700 dark:text-zinc-200">{money(parcel.commission_total)}</span>
      </div>

      {/* The vendor's evidence — reviewed here and again in Pickups */}
      {photos.length > 0 && (
        <div className="px-4 pb-3">
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <Camera size={10} />{isAr ? `صور الشحنة (${photos.length})` : `Parcel photos (${photos.length})`}
          </p>
          <div className="flex gap-1.5 flex-wrap">
            {photos.map((p) => (
              <button
                key={p._id}
                onClick={() => setLightbox(p.url)}
                className="w-14 h-14 rounded-lg overflow-hidden border border-zinc-200 dark:border-white/10 hover:border-marine-cyan transition"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
      {dispatched && photos.length === 0 && (
        <p className="px-4 pb-3 text-[10px] text-zinc-400">
          {isAr ? 'مفيش صور — الطلب من قبل الفيتشر دي' : 'No photos — this order predates the feature'}
        </p>
      )}

      {/* Tracking */}
      {trackingNumber && (
        <div className="px-4 pb-3 flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300">
            <Truck size={9} />{courierName(parcel.courier || effectiveCourier)}
          </span>
          <span className="text-[11px] font-mono font-bold text-zinc-700 dark:text-zinc-200">
            {trackingNumber}
          </span>
          {parcel.tracking_url && (
            <a href={parcel.tracking_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-bold text-zinc-500 hover:text-marine-primary">
              <ExternalLink size={10} />{isAr ? 'تتبع' : 'Track'}
            </a>
          )}
          {parcel.bosta_status && (
            <span className="text-[10px] text-zinc-500">{parcel.bosta_status}</span>
          )}
          {onPrintAWB && parcel.shipment_id && (
            <button
              onClick={() => onPrintAWB(parcel)}
              className="inline-flex items-center gap-1 text-[10px] font-bold text-zinc-500 hover:text-marine-primary transition"
            >
              <FileDown size={11} />{isAr ? 'بوليصة الشحن' : 'Waybill'}
            </button>
          )}
        </div>
      )}

      {transferTarget && (
        <div className="mx-4 mb-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-3">
          <p className="text-xs font-bold">
            {isAr ? `تحويل الشحنة إلى ${courierName(transferTarget)}` : `Transfer to ${courierName(transferTarget)}`}
          </p>
          <p className="text-[11px] text-zinc-500">
            {dispatched
              ? (isAr ? 'البوليصة الحالية هتتشال قبل إرسال الجديدة. التاجر لازم يغيّر البوليصة ويجهّز الشحنة تاني.' : 'The current waybill is removed before sending the replacement. The vendor must replace the label and mark the parcel ready again.')
              : (isAr ? 'الشحنة هتتحول للشركة دي وتتبعت لو مراجعة المنتجات اكتملت.' : 'The parcel will use this courier and will be sent once its items are confirmed.')}
          </p>
          {transferTarget === 'arrive' && (
            <div className="space-y-2">
              {transferSector && <p className="text-xs font-bold text-emerald-600">{transferSector.name}</p>}
              <input
                value={sectorQuery}
                onChange={(e) => setSectorQuery(e.target.value)}
                placeholder={isAr ? 'ابحث واختار منطقة أرايف' : 'Search and select the Arrive area'}
                className="w-full rounded-lg border border-zinc-200 dark:border-white/10 bg-transparent p-2 text-xs"
              />
              {sectorSearching && <Loader2 size={12} className="animate-spin" />}
              {sectorResults.length > 0 && (
                <ul className="max-h-40 overflow-auto rounded-lg bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/10">
                  {sectorResults.map((r) => (
                    <li key={r.id}><button type="button" disabled={!r.serviceable || !!busy}
                      onClick={() => { setTransferSector(r); setSectorQuery(''); setSectorResults([]); }}
                      className="w-full text-start p-2 text-xs hover:bg-zinc-100 dark:hover:bg-white/5 disabled:opacity-40">
                      {r.name} · {r.group}
                    </button></li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {sourceNeedsManualRemoval && (
            <label className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
              <input type="checkbox" checked={sourceRemoved} onChange={(e) => setSourceRemoved(e.target.checked)} disabled={!!busy} />
              <span>{isAr
                ? `حذفت البوليصة ${trackingNumber} نهائيًا من بوابة ${courierName(effectiveCourier)} (الشحنات ← اختيار البوليصة ← حذف)، والطرد لسه عند التاجر.`
                : `I deleted waybill ${trackingNumber} from the ${courierName(effectiveCourier)} portal (Shipments → select waybill → Delete). The parcel is still at the vendor.`}</span>
            </label>
          )}
          <div className="flex gap-2">
            <button type="button"
              disabled={!!busy || !!transferBlocked || (transferTarget === 'arrive' && !transferSector) || (sourceNeedsManualRemoval && !sourceRemoved)}
              onClick={() => onTransferCourier(parcel, {
                courier: transferTarget,
                ...(transferSector ? { sector_id: transferSector.id } : {}),
                ...(sourceNeedsManualRemoval && sourceRemoved ? { removed_tracking: trackingNumber } : {}),
              })}
              className="rounded-lg bg-marine-cyan text-white px-3 py-2 text-xs font-bold disabled:opacity-40">
              {isBusy ? (isAr ? 'جاري التحويل…' : 'Transferring…') : (isAr ? 'تأكيد التحويل' : 'Confirm transfer')}
            </button>
            <button type="button" disabled={!!busy} onClick={() => setTransferTarget('')} className="px-3 py-2 text-xs text-zinc-500">
              {isAr ? 'إغلاق' : 'Close'}
            </button>
          </div>
        </div>
      )}

      {/* Actions, inside the card they act on */}
      <div className="px-4 py-3 border-t border-zinc-100 dark:border-white/5 flex flex-wrap gap-2">
        {parked && onRelease && (
          <button
            onClick={() => onRelease(parcel)}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 text-[11px] font-black hover:bg-emerald-500/20 transition disabled:opacity-40"
          >
            {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Undo2 size={11} />}
            {isAr ? 'رجّعها للتاجر' : 'Return to vendor'}
          </button>
        )}

        {!dispatched && !cancelled && !parked && onDispatch && sendLocked && (
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 text-[11px] font-black cursor-not-allowed"
            title={isAr ? `طلبات ${ot.the} المجمّعة بتتبعت مع بعض — مش لوحدها` : `Combined ${ot.one} orders ship together, not one by one`}
          >
            <Lock size={11} />
            {batchWaiting
              ? (isAr ? `الإرسال لـ ${courierName(effectiveCourier)} بيتفتح لما الدفعة تقفل` : `Sending to ${courierName(effectiveCourier)} opens when the batch closes`)
              : batchRider
                ? (isAr ? `بيتبعت مع الطرد المجمّع #${cb?.lead_reference || ''}` : `Goes with combined parcel #${cb?.lead_reference || ''}`)
                : (isAr ? `مستني تأكيد ${batch?.awaiting_confirmation} طلب قبل الإرسال` : `Waiting on ${batch?.awaiting_confirmation} confirmation(s) before sending`)}
          </span>
        )}

        {!cancelled && onDispatch && !sendLocked && (
          <button
            onClick={() => onDispatch(parcel)}
            disabled={!!busy || dispatched || parked || needsSector || !!attempt || !!parcel.courier_transfer}
            title={needsSector ? (isAr ? 'اختار المنطقة الأول' : 'Choose the Arrive area first') : undefined}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-marine-cyan/10 text-marine-primary text-[11px] font-black hover:bg-marine-cyan/20 transition disabled:opacity-40"
          >
            {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
            {dispatched
              ? (isAr ? `اتبعتت بالفعل لـ ${courierName(effectiveCourier)}` : `Already sent to ${courierName(effectiveCourier)}`)
              : (isAr ? `ابعتها لـ ${courierName(effectiveCourier)}` : `Send to ${courierName(effectiveCourier)}`)}
          </button>
        )}

        {onTransferCourier && courierOptions.filter((o) => o.key !== effectiveCourier).map((o) => (
          <button key={o.key} type="button"
            disabled={!!busy || !!transferBlocked || o.configured === false || (!!parcel.courier_transfer && parcel.courier_transfer.to !== o.key)}
            title={o.configured === false ? (isAr ? 'الشركة غير مُعدّة' : 'Courier is not configured') : transferBlocked || undefined}
            onClick={() => { setTransferTarget(o.key); setTransferSector(null); setSourceRemoved(false); setSectorQuery(''); setSectorResults([]); }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 text-[11px] font-black hover:bg-indigo-500/20 disabled:opacity-40">
            <Truck size={11} />{isAr ? `حوّلها لـ ${courierName(o.key)}` : `Transfer to ${courierName(o.key)}`}
          </button>
        ))}
        {parcel.courier_transfer && (
          <p className="w-full text-[11px] text-amber-600">{isAr
            ? 'التحويل ماكملش. راجع حذف البوليصة القديمة واضغط تحويل لنفس الشركة لإكماله.'
            : 'Transfer unfinished. Check removal of the old waybill and retry the same transfer.'}</p>
        )}
        {transferBlocked && !cancelled && <p className="w-full text-[11px] text-zinc-500">{transferBlocked}</p>}

        {/* Shipment exists, parcel still at stage ②: the vendor never pressed "continue".
            Without this the admin had no button at all here — a parcel with a perfectly
            good waybill looked stuck waiting for a Smart Sticker it does not need. */}
        {dispatched && !cancelled && !parked && parcel.status === 'awaiting_tracking' && onConfirmWaybill && (
          <button
            onClick={() => onConfirmWaybill(parcel)}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 text-[11px] font-black hover:bg-emerald-500/20 transition disabled:opacity-40"
          >
            {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
            {isAr ? 'البوليصة متلزقة — كمّل للمرحلة الجاية' : 'Waybill attached — next stage'}
          </button>
        )}

        {dispatched && !cancelled && !parked && parcel.status === 'awaiting_handover' && onMarkReady && (
          <button
            onClick={() => onMarkReady(parcel)}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 text-[11px] font-black hover:bg-emerald-500/20 transition disabled:opacity-40"
          >
            {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Truck size={11} />}
            {isAr ? 'جاهزة للاستلام — اعرضها في البيك أب' : 'Ready for pickup — list on Pickups'}
          </button>
        )}

        {cancelled && onReactivate && (
          <button
            onClick={() => onReactivate(parcel)}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 text-[11px] font-black hover:bg-emerald-500/20 transition disabled:opacity-40"
          >
            {isBusy ? <Loader2 size={11} className="animate-spin" /> : <Undo2 size={11} />}
            {isAr ? 'إعادة تفعيل الشحنة' : 'Reactivate parcel'}
          </button>
        )}

        {!cancelled && onCancel && (
          <button
            onClick={() => onCancel(parcel)}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 text-red-500 text-[11px] font-black hover:bg-red-500/10 transition disabled:opacity-40"
          >
            <XCircle size={11} />{isAr ? 'إلغاء الشحنة' : 'Cancel parcel'}
          </button>
        )}

        {/* Narrow by design — for a parcel Bosta has stopped moving */}
        {dispatched && !cancelled && parcel.status !== 'delivered' && onOverride && (
          <button
            onClick={() => onOverride(parcel)}
            disabled={!!busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 text-[11px] font-black hover:bg-zinc-200 transition disabled:opacity-40"
          >
            <Truck size={11} />{isAr ? 'إقفال يدوي' : 'Close manually'}
          </button>
        )}

        {(parcel.history || []).length > 0 && (
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="ms-auto inline-flex items-center gap-1 text-[10px] font-bold text-zinc-400 hover:text-zinc-600 transition"
          >
            {isAr ? 'السجل' : 'History'}
            <ChevronDown size={10} className={`transition-transform ${showHistory ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {showHistory && (
        <ol className="px-4 pb-4 space-y-1.5 border-t border-zinc-100 dark:border-white/5 pt-3">
          {[...(parcel.history || [])].reverse().map((h, i) => (
            <li key={i} className="text-[10px]">
              <span className="font-bold text-zinc-700 dark:text-zinc-200">{h.title}</span>
              {h.details && <span className="text-zinc-500"> — {h.details}</span>}
              <span className="block text-zinc-400">
                {h.actor_label} · {h.created_at ? new Date(h.created_at).toLocaleString(isAr ? 'ar-EG' : 'en-GB') : ''}
              </span>
            </li>
          ))}
        </ol>
      )}

      {lightbox && (
        <Overlay
          className="fixed inset-0 z-50 bg-black/80 grid place-items-center p-6"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="" className="max-w-full max-h-full rounded-xl" />
        </Overlay>
      )}
    </div>
  );
}
