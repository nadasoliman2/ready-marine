'use client';

import { useEffect, useState } from 'react';
import { Loader2, Truck, MapPin, Calendar, RefreshCw, X, Clock, Package, Plus, ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';
import { adminApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import usePageSize from '../../../../lib/usePageSize';
import { PageSizeSelect } from '../../../../components/dashboard/PaginationControls';
import Overlay from '../../../../components/Overlay';

const STATUS_COLORS = {
    scheduled: 'bg-blue-500/20 text-blue-500',
    picked_up: 'bg-emerald-500/20 text-emerald-500',
    cancelled: 'bg-zinc-500/20 text-zinc-500',
    failed: 'bg-red-500/20 text-red-500',
};

const TIME_SLOTS = [
    { value: '10:00 to 13:00', label: '10:00 - 13:00' },
    { value: '13:00 to 16:00', label: '13:00 - 16:00' },
];


export default function AdminPickupsPage() {
    const { language } = useApp();
    const isAr = language === 'ar';

    // Summary data (for "needs pickup" section)
    const [summaryDate, setSummaryDate] = useState(() => new Date().toISOString().split('T')[0]);
    const [summary, setSummary] = useState([]);
    const [summaryLoading, setSummaryLoading] = useState(true);
    // Finished parcels this screen cannot book a courier for (branch not linked to Bosta,
    // vendor deleted). Shown rather than dropped: a parcel vanishing in silence is exactly
    // how finished parcels went missing from here before.
    const [unbookable, setUnbookable] = useState([]);
    const [otherCourier, setOtherCourier] = useState([]);
    // Parcels the vendor said a courier took, with no courier booked and no Bosta scan since.
    const [handedOver, setHandedOver] = useState([]);
    const [summaryError, setSummaryError] = useState('');
    // Parcels the admin dropped from today's booking after looking at the photos.
    const [excludedParcels, setExcludedParcels] = useState(new Set());
    const [photoLightbox, setPhotoLightbox] = useState(null);

    // Pickups list with pagination
    const [filterDate, setFilterDate] = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const [pickups, setPickups] = useState([]);
    const [pickupsTotal, setPickupsTotal] = useState(0);
    const [pickupsPage, setPickupsPage] = useState(1);
    const [pageSize, setPageSize] = usePageSize('admin.pickups', 10);
    const [pickupsLoading, setPickupsLoading] = useState(true);

    const [actionLoading, setActionLoading] = useState('');

    // Schedule modal
    const [scheduleModal, setScheduleModal] = useState(null);
    const [scheduleForm, setScheduleForm] = useState({ date: '', time_slot: '10:00 to 13:00' });

    // Reschedule modal
    const [rescheduleModal, setRescheduleModal] = useState(null);
    const [rescheduleForm, setRescheduleForm] = useState({ date: '', time_slot: '10:00 to 13:00' });

    const loadSummary = async () => {
        setSummaryLoading(true);
        setSummaryError('');
        try {
            const res = await adminApi.getPickupSummary(summaryDate);
            setSummary(res.summary || []);
            setUnbookable(res.unbookable_parcels || []);
            setOtherCourier(res.other_courier_parcels || []);
            setHandedOver(res.handed_over_parcels || []);
        } catch (err) {
            // An empty screen and a failed request look identical to the admin, and that
            // ambiguity is what let a broken summary pass for "nothing to collect".
            setSummary([]);
            setUnbookable([]);
            setHandedOver([]);
            setSummaryError(err?.message || 'Could not load the pickup summary');
        }
        finally { setSummaryLoading(false); }
    };

    const loadPickups = async () => {
        setPickupsLoading(true);
        try {
            const params = { page: pickupsPage, limit: pageSize };
            if (filterDate) params.date = filterDate;
            if (filterStatus) params.status = filterStatus;
            const res = await adminApi.getPickups(params);
            setPickups(res.pickups || []);
            setPickupsTotal(res.total || 0);
        } catch (_) {}
        finally { setPickupsLoading(false); }
    };

    useEffect(() => { loadSummary(); }, [summaryDate]);
    useEffect(() => { loadPickups(); }, [filterDate, filterStatus, pickupsPage, pageSize]);

    const reloadAll = () => { loadSummary(); loadPickups(); };

    const handleCancel = async (pickup) => {
        if (!confirm(isAr ? 'إلغاء هذا الاستلام؟' : 'Cancel this pickup?')) return;
        setActionLoading(pickup._id);
        try { await adminApi.cancelPickup(pickup._id); reloadAll(); }
        catch (err) { alert(err.message); }
        finally { setActionLoading(''); }
    };

    const handleRefresh = async (pickup) => {
        setActionLoading(pickup._id);
        try { await adminApi.refreshPickup(pickup._id); reloadAll(); }
        catch (err) { alert(err.message); }
        finally { setActionLoading(''); }
    };

    /**
     * Which parcels this booking is for.
     *
     * Defaults to every sealed, photographed parcel at the branch, and the admin can drop
     * one whose photos did not convince them — booking a courier is a real-world commitment,
     * so the evidence is reviewed BEFORE the driver is sent, not after.
     */
    const toggleParcel = (subOrderId) => {
        setExcludedParcels((prev) => {
            const next = new Set(prev);
            if (next.has(subOrderId)) next.delete(subOrderId);
            else next.add(subOrderId);
            return next;
        });
    };

    const handleSchedule = async () => {
        if (!scheduleModal || !scheduleForm.date || !scheduleForm.time_slot) return;
        setActionLoading('schedule');
        try {
            const included = (scheduleModal.ready_parcels || [])
                .filter((p) => !excludedParcels.has(String(p.sub_order_id)))
                .map((p) => String(p.sub_order_id));
            const res = await adminApi.schedulePickup({
                bosta_location_id: scheduleModal.bosta_location_id,
                scheduled_date: scheduleForm.date,
                scheduled_time_slot: scheduleForm.time_slot,
                vendor_id: scheduleModal.vendor_id,
                // Explicit: a parcel the admin dropped must not be collected.
                ...(included.length > 0 ? { sub_order_ids: included } : {}),
            });
            setScheduleModal(null);
            setExcludedParcels(new Set());
            // A branch gets one courier visit a day: the parcels joined the one already booked.
            if (res?.joined_existing) {
                alert(isAr
                    ? `فيه مندوب محجوز للفرع ده يوم ${res.pickup.scheduled_date} (${res.pickup.scheduled_time_slot}) — الطرود اتضافت على نفس الزيارة.`
                    : `A courier is already booked for this branch on ${res.pickup.scheduled_date} (${res.pickup.scheduled_time_slot}) — the parcels were added to that visit.`);
            }
            reloadAll();
        } catch (err) { alert(err.message); }
        finally { setActionLoading(''); }
    };

    const handleReschedule = async () => {
        if (!rescheduleModal || !rescheduleForm.date || !rescheduleForm.time_slot) return;
        setActionLoading('reschedule');
        try {
            await adminApi.reschedulePickup(rescheduleModal._id, {
                scheduled_date: rescheduleForm.date,
                scheduled_time_slot: rescheduleForm.time_slot,
            });
            setRescheduleModal(null);
            reloadAll();
        } catch (err) { alert(err.message); }
        finally { setActionLoading(''); }
    };

    const openScheduleModal = (item) => {
        setScheduleForm({ date: summaryDate, time_slot: '10:00 to 13:00' });
        setScheduleModal(item);
    };

    // Only branches with parcels actually sealed and photographed. A branch whose vendor is
    // still packing has nothing for a courier to collect yet.
    const needsPickup = summary.filter(s => (s.ready_parcel_count || 0) > 0 && !s.pickup);

    // The unconfirmed handovers, one group per branch — a courier is booked per branch.
    const handedGroups = [...handedOver.reduce((groups, p) => {
        const key = `${p.vendor_id}|${p.bosta_location_id || p.location_address}`;
        if (!groups.has(key)) {
            groups.set(key, {
                vendor_id: p.vendor_id,
                vendor_name: p.vendor_name,
                location_address: p.location_address,
                bosta_location_id: p.bosta_location_id,
                handed_over: true,
                ready_parcels: [],
            });
        }
        groups.get(key).ready_parcels.push(p);
        return groups;
    }, new Map()).values()];
    const totalPages = Math.ceil(pickupsTotal / pageSize);

    return (
        <div className="space-y-6 animate-in fade-in duration-300 pb-12">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-black text-zinc-900 dark:text-white flex items-center gap-3">
                    <Truck size={24} className="text-marine-primary" />
                    {isAr ? 'إدارة الاستلام' : 'Pickup Management'}
                </h1>
                <p className="text-sm text-zinc-500 mt-1">{isAr ? 'جدولة وإدارة استلام الشحنات من البائعين' : 'Schedule and manage courier pickups from vendor locations'}</p>
            </div>

            {/* ====== Needs Pickup Section ====== */}
            <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl shadow-sm">
                <div className="px-5 py-4 border-b border-zinc-100 dark:border-white/5 flex items-center justify-between gap-3 flex-wrap">
                    <h2 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-wide flex items-center gap-2">
                        <Clock size={14} className="text-amber-500" />
                        {isAr ? 'طلبات بحاجة لاستلام' : 'Orders Needing Pickup'}
                    </h2>
                    <input type="date" value={summaryDate} onChange={(e) => setSummaryDate(e.target.value)}
                        className="bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-marine-cyan" />
                </div>

                {summaryError && (
                    <div className="mx-5 mt-4 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-xs font-bold text-red-600">
                        {isAr ? 'تعذر تحميل قائمة الاستلام: ' : 'Could not load the pickup list: '}{summaryError}
                    </div>
                )}

                {otherCourier.length > 0 && (
                    <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4 space-y-2">
                        <p className="text-sm font-bold text-sky-700 dark:text-sky-400">
                            {isAr
                                ? `${otherCourier.length} طرد جاهز هيستلمه مندوب أرايف من فرع التاجر (مش بيتحجز من هنا)`
                                : `${otherCourier.length} ready parcel(s) will be collected by Arrive from the vendor branch (not booked here)`}
                        </p>
                        <ul className="text-xs text-zinc-600 dark:text-zinc-300 space-y-1">
                            {otherCourier.map((p) => (
                                <li key={String(p.sub_order_id)} className="flex flex-wrap gap-x-3">
                                    <span className="font-mono">{p.reference}</span>
                                    <span>{p.vendor_name}</span>
                                    <span className="text-zinc-400">{p.fulfillment_location}</span>
                                    {p.tracking_number && <span className="font-mono text-zinc-400">{p.tracking_number}</span>}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {unbookable.length > 0 && (
                    <div className="mx-5 mt-4 rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3">
                        <p className="text-xs font-black text-amber-600">
                            {isAr
                                ? `${unbookable.length} طرد جاهز لا يمكن حجز مندوب له من هنا`
                                : `${unbookable.length} ready parcel(s) cannot be booked from here`}
                        </p>
                        <ul className="mt-2 space-y-1">
                            {unbookable.map((p) => (
                                <li key={p.sub_order_id} className="text-[11px] text-amber-700 dark:text-amber-400">
                                    {p.reference} — {p.vendor_name || (isAr ? 'تاجر محذوف' : 'deleted vendor')}
                                    {' · '}
                                    {p.reason === 'vendor_deleted'
                                        ? (isAr ? 'التاجر لم يعد موجوداً' : 'the vendor no longer exists')
                                        : p.reason === 'vendor_has_no_location'
                                            ? (isAr ? 'التاجر ليس له فرع مسجل' : 'the vendor has no branch on file')
                                            : (isAr ? 'الفرع غير مرتبط ببوسطة' : 'the branch is not linked to Bosta')}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* The vendor pressed "the courier took it" with no courier booked, and Bosta
                    has not scanned the parcel since. It usually means the box is still on the
                    counter, and it is not in the list below any more — so it is booked here. */}
                {handedGroups.length > 0 && (
                    <div className="mx-5 mt-4 rounded-xl bg-orange-500/10 border border-orange-500/20 px-4 py-3 space-y-3">
                        <div>
                            <p className="text-xs font-black text-orange-600">
                                {isAr
                                    ? `${handedOver.length} طرد التاجر قال إن المندوب استلمه — وبوسطة لسه ما أكدتش`
                                    : `${handedOver.length} parcel(s) the vendor says a courier took — Bosta has not confirmed`}
                            </p>
                            <p className="text-[11px] text-orange-700/80 dark:text-orange-400/80 mt-1">
                                {isAr
                                    ? 'مكانش فيه مندوب محجوز ليها. كلّم التاجر: لو الطرد لسه عنده احجزله مندوب من هنا. لو المندوب أخده فعلاً، هيختفي من هنا لوحده أول ما بوسطة تسجّل الاستلام.'
                                    : 'No courier was booked for them. Call the vendor: if the parcel is still there, book a courier here. If a courier really took it, it leaves this list by itself once Bosta scans it.'}
                            </p>
                        </div>
                        {handedGroups.map((group) => (
                            <div key={`${group.vendor_id}|${group.bosta_location_id || group.location_address}`} className="rounded-xl bg-white/60 dark:bg-white/5 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold text-zinc-900 dark:text-white">{group.vendor_name || (isAr ? 'تاجر محذوف' : 'deleted vendor')}</p>
                                        <p className="text-xs text-zinc-400 flex items-center gap-1 mt-0.5"><MapPin size={10} /> {group.location_address}</p>
                                    </div>
                                    {group.bosta_location_id ? (
                                        <button onClick={() => openScheduleModal(group)} className="px-3 py-1.5 rounded-xl text-xs font-bold bg-orange-600 text-white hover:bg-orange-500 transition-colors flex items-center gap-1.5">
                                            <Plus size={12} /> {isAr ? `احجز مندوب (${group.ready_parcels.length})` : `Book courier (${group.ready_parcels.length})`}
                                        </button>
                                    ) : (
                                        <span className="text-[11px] font-bold text-orange-700 dark:text-orange-400">
                                            {isAr ? 'الفرع غير مرتبط ببوسطة' : 'The branch is not linked to Bosta'}
                                        </span>
                                    )}
                                </div>
                                <ul className="mt-2 space-y-1">
                                    {group.ready_parcels.map((p) => (
                                        <li key={String(p.sub_order_id)} className="text-[11px] text-zinc-600 dark:text-zinc-300 flex flex-wrap gap-x-3">
                                            <span className="font-bold">#{p.order_reference}</span>
                                            {p.tracking_number && <span className="font-mono text-zinc-400">{p.tracking_number}</span>}
                                            {p.handed_over_at && (
                                                <span className="text-zinc-400">
                                                    {isAr ? 'قال إنه اتسلم ' : 'Marked handed over '}
                                                    {new Date(p.handed_over_at).toLocaleString(isAr ? 'ar-EG' : 'en-GB')}
                                                </span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                )}

                {summaryLoading ? (
                    <div className="p-8 flex justify-center"><Loader2 size={24} className="animate-spin text-marine-primary" /></div>
                ) : needsPickup.length === 0 ? (
                    <div className="p-8 text-center text-sm text-zinc-400 font-bold">{isAr ? 'لا توجد طلبات بحاجة لاستلام' : 'No orders need pickup scheduling'}</div>
                ) : (
                    <div className="divide-y divide-zinc-100 dark:divide-white/5">
                        {needsPickup.map((item, i) => (
                            <div key={i} className="px-5 py-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold text-zinc-900 dark:text-white">{item.vendor_name}</p>
                                        <p className="text-xs text-zinc-400 flex items-center gap-1 mt-0.5"><MapPin size={10} /> {item.location_address}</p>
                                    </div>
                                    <div className="flex items-center gap-3 flex-shrink-0">
                                        <span className="text-xs font-bold text-emerald-600 bg-emerald-500/10 px-2 py-1 rounded-lg">
                                            {item.ready_parcel_count} {isAr ? 'طرد جاهز' : 'ready'}
                                        </span>
                                        {item.not_ready_count > 0 && (
                                            <span className="text-xs font-bold text-zinc-400 bg-zinc-500/10 px-2 py-1 rounded-lg">
                                                {item.not_ready_count} {isAr ? 'لسه بيتجهز' : 'still packing'}
                                            </span>
                                        )}
                                        {item.ready_parcel_count === 1 && (
                                            <span
                                                className="text-xs font-bold text-rose-500 bg-rose-500/10 px-2 py-1 rounded-lg"
                                                title={isAr ? 'استنى لحد ما يبقى فيه طردين والزيارة تبقى ببلاش.' : 'Wait until a second parcel is ready and the visit costs nothing.'}
                                            >
                                                {isAr ? 'طرد واحد — رسوم مندوب على الموقع' : 'Single parcel — platform pays the courier fee'}
                                            </span>
                                        )}
                                        <button onClick={() => openScheduleModal(item)} className="px-3 py-1.5 rounded-xl text-xs font-bold bg-marine-cyan text-white hover:bg-marine-cyan-dark transition-colors flex items-center gap-1.5">
                                            <Plus size={12} /> {isAr ? `احجز مندوب (${item.ready_parcel_count})` : `Book courier (${item.ready_parcel_count})`}
                                        </button>
                                    </div>
                                </div>

                                {/* The parcels themselves, with the photos the vendor took.
                                    Listed rather than counted, because a bare number tells the
                                    admin nothing they can act on — the whole point of the
                                    photo step is that somebody looks at them before a driver
                                    is committed. */}
                                {(item.ready_parcels || []).length > 0 && (
                                    <ul className="mt-3 space-y-2">
                                        {item.ready_parcels.map((p) => (
                                            <li key={p.sub_order_id} className="flex items-center gap-3 rounded-xl bg-zinc-50 dark:bg-white/5 p-2.5">
                                                <div className="flex gap-1 shrink-0">
                                                    {(p.parcel_photos || []).slice(0, 3).map((ph) => (
                                                        <button
                                                            key={ph._id}
                                                            onClick={() => setPhotoLightbox(ph.url)}
                                                            className="w-10 h-10 rounded-lg overflow-hidden border border-zinc-200 dark:border-white/10 hover:border-marine-cyan transition"
                                                        >
                                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                                            <img src={ph.url} alt="" className="w-full h-full object-cover" />
                                                        </button>
                                                    ))}
                                                    {(p.parcel_photos || []).length === 0 && (
                                                        <span className="w-10 h-10 rounded-lg grid place-items-center bg-zinc-200 dark:bg-white/10 text-zinc-400">
                                                            <ImageOff size={13} />
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-xs font-bold text-zinc-800 dark:text-zinc-100 truncate">
                                                        #{p.order_reference}
                                                    </p>
                                                    <p className="text-[10px] font-mono text-zinc-400">{p.tracking_number || '—'}</p>
                                                </div>
                                                <span className="text-[10px] text-zinc-500 shrink-0">
                                                    {p.item_count} {isAr ? 'منتج' : 'items'}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ====== All Pickups List with Pagination ====== */}
            <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl shadow-sm">
                <div className="px-5 py-4 border-b border-zinc-100 dark:border-white/5 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-wide flex items-center gap-2">
                        <Calendar size={14} className="text-marine-primary" />
                        {isAr ? 'كل الاستلامات' : 'All Pickups'}
                        <span className="text-xs font-bold text-zinc-400 ms-1">({pickupsTotal})</span>
                    </h2>
                    <div className="flex items-center gap-2">
                        <input type="date" value={filterDate} onChange={(e) => { setFilterDate(e.target.value); setPickupsPage(1); }}
                            className="bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-marine-cyan" />
                        <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPickupsPage(1); }}
                            className="bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-marine-cyan">
                            <option value="">{isAr ? 'كل الحالات' : 'All statuses'}</option>
                            <option value="scheduled">{isAr ? 'مجدول' : 'Scheduled'}</option>
                            <option value="picked_up">{isAr ? 'تم الاستلام' : 'Picked Up'}</option>
                            <option value="cancelled">{isAr ? 'ملغى' : 'Cancelled'}</option>
                            <option value="failed">{isAr ? 'فشل' : 'Failed'}</option>
                        </select>
                        {(filterDate || filterStatus) && (
                            <button onClick={() => { setFilterDate(''); setFilterStatus(''); setPickupsPage(1); }}
                                className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
                                <X size={14} />
                            </button>
                        )}
                        <button onClick={loadPickups} disabled={pickupsLoading} className="p-1.5 rounded-lg bg-zinc-100 dark:bg-white/5 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-white/10 disabled:opacity-50">
                            <RefreshCw size={14} className={pickupsLoading ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </div>

                {pickupsLoading ? (
                    <div className="p-8 flex justify-center"><Loader2 size={24} className="animate-spin text-marine-primary" /></div>
                ) : pickups.length === 0 ? (
                    <div className="p-10 text-center">
                        <Package size={32} className="text-zinc-300 mx-auto mb-3" />
                        <p className="text-sm text-zinc-400 font-bold">{isAr ? 'لا توجد استلامات' : 'No pickups found'}</p>
                    </div>
                ) : (
                    <>
                        <div className="divide-y divide-zinc-100 dark:divide-white/5">
                            {pickups.map((pickup) => (
                                <div key={pickup._id} className="p-5">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <p className="text-sm font-bold text-zinc-900 dark:text-white">{pickup.vendor_name}</p>
                                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-widest ${STATUS_COLORS[pickup.status] || STATUS_COLORS.scheduled}`}>
                                                    {pickup.status}
                                                </span>
                                            </div>
                                            <p className="text-xs text-zinc-400 flex items-center gap-1"><MapPin size={10} /> {pickup.location_address}</p>
                                            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-zinc-500">
                                                <span className="flex items-center gap-1"><Calendar size={10} /> {pickup.scheduled_date}</span>
                                                <span className="flex items-center gap-1"><Clock size={10} /> {pickup.scheduled_time_slot}</span>
                                                <span className="flex items-center gap-1"><Package size={10} /> {pickup.order_ids?.length || 0} {isAr ? 'طلب' : 'order(s)'}</span>
                                                {pickup.parcel_count > 0 && <span>{pickup.parcel_count} {isAr ? 'طرد' : 'parcel(s)'}</span>}
                                                {pickup.has_fragile && <span className="text-[10px] font-bold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">{isAr ? 'يحتوي على أغراض هشة' : 'Fragile items'}</span>}
                                                {pickup.has_big_items && <span className="text-[10px] font-bold text-orange-500 bg-orange-500/10 px-1.5 py-0.5 rounded">{isAr ? 'يحتوي على أغراض كبيرة' : 'Heavy/Big items'}</span>}
                                                {pickup.pickup_fee > 0 && (
                                                    <span
                                                        className="text-[10px] font-bold text-rose-500 bg-rose-500/10 px-1.5 py-0.5 rounded"
                                                        title={isAr ? 'بوسطة بتحاسبنا على المندوب لما يشيل أقل من طردين. الموقع بيتحمّلها، مش العميل.' : 'Bosta bills for a courier that collects fewer than two parcels. The platform absorbs it — never the customer.'}
                                                    >
                                                        {isAr ? `رسوم مندوب ${pickup.pickup_fee} ج (على الموقع)` : `Courier fee ${pickup.pickup_fee} EGP (platform)`}
                                                    </span>
                                                )}
                                                {pickup.bosta_pickup_id && <span className="font-mono text-zinc-400">#{pickup.bosta_pickup_id}</span>}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            {pickup.status === 'scheduled' && (
                                                <>
                                                    <button onClick={() => { setRescheduleForm({ date: pickup.scheduled_date, time_slot: pickup.scheduled_time_slot }); setRescheduleModal(pickup); }}
                                                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-white/10 transition-colors">
                                                        {isAr ? 'إعادة جدولة' : 'Reschedule'}
                                                    </button>
                                                    <button onClick={() => handleCancel(pickup)} disabled={actionLoading === pickup._id}
                                                        className="px-3 py-1.5 rounded-lg text-xs font-bold text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50">
                                                        {actionLoading === pickup._id ? <Loader2 size={12} className="animate-spin" /> : (isAr ? 'إلغاء' : 'Cancel')}
                                                    </button>
                                                </>
                                            )}
                                            <button onClick={() => handleRefresh(pickup)} disabled={actionLoading === pickup._id}
                                                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
                                                title={isAr ? 'تحديث الحالة' : 'Refresh status'}>
                                                <RefreshCw size={14} className={actionLoading === pickup._id ? 'animate-spin' : ''} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Pagination */}
                        {(totalPages > 1 || pickupsTotal > 0) && (
                            <div className="px-5 py-3 border-t border-zinc-100 dark:border-white/5 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <p className="text-xs text-zinc-400">
                                        {isAr ? `عرض ${(pickupsPage - 1) * pageSize + 1}-${Math.min(pickupsPage * pageSize, pickupsTotal)} من ${pickupsTotal}` : `Showing ${(pickupsPage - 1) * pageSize + 1}-${Math.min(pickupsPage * pageSize, pickupsTotal)} of ${pickupsTotal}`}
                                    </p>
                                    <PageSizeSelect pageSize={pageSize} onChange={(n) => { setPageSize(n); setPickupsPage(1); }} label={isAr ? 'صفوف' : 'Rows'} />
                                </div>
                                <div className="flex items-center gap-1">
                                    <button onClick={() => setPickupsPage(p => Math.max(1, p - 1))} disabled={pickupsPage <= 1}
                                        className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/5 disabled:opacity-30">
                                        <ChevronLeft size={16} />
                                    </button>
                                    <span className="text-xs font-bold text-zinc-500 px-2">{pickupsPage} / {totalPages}</span>
                                    <button onClick={() => setPickupsPage(p => Math.min(totalPages, p + 1))} disabled={pickupsPage >= totalPages}
                                        className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/5 disabled:opacity-30">
                                        <ChevronRight size={16} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Schedule Modal */}
            {scheduleModal && (
                <Overlay className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-[#14171A] rounded-2xl border border-zinc-200 dark:border-white/10 shadow-2xl w-full max-w-md p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-black text-zinc-900 dark:text-white">{isAr ? 'جدولة استلام' : 'Schedule Pickup'}</h3>
                            <button onClick={() => setScheduleModal(null)} className="p-1 text-zinc-400 hover:text-zinc-600"><X size={18} /></button>
                        </div>
                        <p className="text-sm text-zinc-500">{scheduleModal.vendor_name} — {scheduleModal.location_address}</p>
                        {scheduleModal.handed_over && (
                            <p className="rounded-xl bg-orange-500/10 border border-orange-500/20 px-3 py-2 text-xs font-bold text-orange-700 dark:text-orange-400">
                                {isAr
                                    ? 'التاجر قال إن المندوب استلم الطرود دي. احجز بس لو اتأكدت إنها لسه عنده — هترجع عنده لـ"مستني المندوب" ويوصله ميعاد الزيارة.'
                                    : 'The vendor said a courier took these parcels. Book only once you have confirmed they are still there — they go back to "waiting for the courier" and the vendor is told when it comes.'}
                            </p>
                        )}
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">{isAr ? 'التاريخ' : 'Date'}</label>
                                <input type="date" value={scheduleForm.date} onChange={(e) => setScheduleForm(p => ({ ...p, date: e.target.value }))} className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-marine-cyan" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">{isAr ? 'الفترة' : 'Time Slot'}</label>
                                <select value={scheduleForm.time_slot} onChange={(e) => setScheduleForm(p => ({ ...p, time_slot: e.target.value }))} className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-marine-cyan">
                                    {TIME_SLOTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                            <button onClick={() => setScheduleModal(null)} className="px-4 py-2 rounded-xl text-sm font-bold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5">{isAr ? 'إلغاء' : 'Cancel'}</button>
                            <button onClick={handleSchedule} disabled={actionLoading === 'schedule' || !scheduleForm.date} className="px-4 py-2 rounded-xl text-sm font-bold bg-marine-cyan text-white hover:bg-marine-cyan-dark flex items-center gap-2 disabled:opacity-50">
                                {actionLoading === 'schedule' ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
                                {isAr ? 'جدولة' : 'Schedule'}
                            </button>
                        </div>
                    </div>
                </Overlay>
            )}

            {/* Reschedule Modal */}
            {rescheduleModal && (
                <Overlay className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-[#14171A] rounded-2xl border border-zinc-200 dark:border-white/10 shadow-2xl w-full max-w-md p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-black text-zinc-900 dark:text-white">{isAr ? 'إعادة جدولة' : 'Reschedule Pickup'}</h3>
                            <button onClick={() => setRescheduleModal(null)} className="p-1 text-zinc-400 hover:text-zinc-600"><X size={18} /></button>
                        </div>
                        <p className="text-sm text-zinc-500">{rescheduleModal.vendor_name} — {rescheduleModal.location_address}</p>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">{isAr ? 'التاريخ الجديد' : 'New Date'}</label>
                                <input type="date" value={rescheduleForm.date} onChange={(e) => setRescheduleForm(p => ({ ...p, date: e.target.value }))} className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-marine-cyan" />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">{isAr ? 'الفترة الجديدة' : 'New Time Slot'}</label>
                                <select value={rescheduleForm.time_slot} onChange={(e) => setRescheduleForm(p => ({ ...p, time_slot: e.target.value }))} className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-marine-cyan">
                                    {TIME_SLOTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                            <button onClick={() => setRescheduleModal(null)} className="px-4 py-2 rounded-xl text-sm font-bold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5">{isAr ? 'إلغاء' : 'Cancel'}</button>
                            <button onClick={handleReschedule} disabled={actionLoading === 'reschedule' || !rescheduleForm.date} className="px-4 py-2 rounded-xl text-sm font-bold bg-marine-cyan text-white hover:bg-marine-cyan-dark flex items-center gap-2 disabled:opacity-50">
                                {actionLoading === 'reschedule' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                                {isAr ? 'إعادة جدولة' : 'Reschedule'}
                            </button>
                        </div>
                    </div>
                </Overlay>
            )}

            {/* Photos, full size — the admin has to be able to actually look at them */}
            {photoLightbox && (
                <Overlay
                    className="fixed inset-0 z-50 bg-black/80 grid place-items-center p-6"
                    onClick={() => setPhotoLightbox(null)}
                >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoLightbox} alt="" className="max-w-full max-h-full rounded-xl" />
                </Overlay>
            )}
        </div>
    );
}
