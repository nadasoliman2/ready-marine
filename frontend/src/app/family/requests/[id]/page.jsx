'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from '../../../../lib/navigation';
import Link from '../../../../components/LocaleLink';
import {
    ArrowLeft, ChevronRight, Loader2, AlertTriangle, CheckCircle2, XCircle, MapPin, Truck,
    CreditCard, Banknote, Package, Users, Trash2, Send, Wallet,
} from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { familyApi } from '../../../../lib/api';
import { resolveAssetUrl } from '../../../../lib/assets';
import { getOrderStatusLabel, getOrderStatusColor, getShipmentStatusLabel } from '../../../../lib/orderStatus';
import {
    familyCopy, getRelationshipLabel, getActorStatusLine, getChangeLabel, DECLINE_REASONS,
} from '../../../../lib/familyLocalization';
import { walletCopy } from '../../../../lib/walletLocalization';
import RequestStatusBadge from '../../../../components/family/RequestStatusBadge';
import Overlay from '../../../../components/Overlay';

/**
 * Family order request detail.
 *
 * Serves both sides of the request from one durable server-side record:
 *  - the MEMBER sees a read-only view plus withdraw and order tracking;
 *  - the ORGANIZER additionally gets live repricing, a change comparison, and
 *    the focused checkout that turns the request into a real order.
 */
export default function FamilyRequestPage() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user, language, isMounted, siteSettings } = useApp();
    const isAr = language === 'ar';
    const copy = useMemo(() => familyCopy(isAr), [isAr]);
    const wal = useMemo(() => walletCopy(isAr), [isAr]);
    const requestId = String(params?.id || '');

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');

    const [removedItemIds, setRemovedItemIds] = useState([]);
    const [acknowledged, setAcknowledged] = useState(false);
    const [showDecline, setShowDecline] = useState(false);
    const [declineForm, setDeclineForm] = useState({ reason: 'too_expensive', note: '' });

    // Focused-checkout selections; default to whatever the reprice resolved.
    const [checkoutAddressId, setCheckoutAddressId] = useState('');
    const [checkoutMethodId, setCheckoutMethodId] = useState('');

    const currency = data?.currency || siteSettings?.currency || 'QAR';

    const load = useCallback(async () => {
        try {
            const result = await familyApi.getRequest(requestId);
            setData(result);
            setError('');
            const method = result.revalidation?.selected_method;
            setCheckoutAddressId(String(result.revalidation?.address?._id || result.request.organizer_address_id || ''));
            setCheckoutMethodId(String(method?.id || result.request.shipping_method_id || ''));
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [requestId]);

    useEffect(() => {
        if (!isMounted) return;
        if (!user) {
            router.push(`/login?redirect=${encodeURIComponent(`/family/requests/${requestId}`)}`);
            return;
        }
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isMounted, user, requestId]);

    // Returning from the hosted payment provider. Confirmation is idempotent —
    // a refresh or a duplicate webhook can never produce a second order.
    useEffect(() => {
        if (!isMounted || !user || !requestId) return;
        const status = searchParams.get('payment');
        if (!status) return;

        const paymentId = searchParams.get('paymentId');
        const invoiceId = searchParams.get('invoice_id');

        const clearQuery = () => router.replace(`/family/requests/${requestId}`);

        if (status === 'success' && paymentId) {
            setBusy(true);
            familyApi.confirmPayment(requestId, { paymentId, invoice_id: invoiceId })
                .then((res) => {
                    setNotice(res.status === 'paid'
                        ? (isAr ? 'تم تأكيد الدفع وإنشاء الطلب.' : 'Payment confirmed and the order was created.')
                        : (isAr ? 'لم يتم تأكيد الدفع بعد.' : 'Payment is not confirmed yet.'));
                })
                .catch((err) => setError(err.message))
                .finally(() => { setBusy(false); clearQuery(); load(); });
        } else {
            // Failed or abandoned — reopen the request so payment can be resumed.
            familyApi.reportPaymentFailed(requestId, status)
                .catch(() => {})
                .finally(() => {
                    setError(isAr
                        ? 'لم تكتمل عملية الدفع. لم يتم إنشاء أي طلب — يمكنك متابعة الدفع.'
                        : 'The payment did not complete. No order was created — you can resume payment.');
                    clearQuery();
                    load();
                });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isMounted, user, requestId, searchParams]);

    // Re-price whenever the organizer changes address or shipping method in the
    // focused checkout, so totals always reflect the live selection.
    const refreshPreview = async (addressId, methodId) => {
        setBusy(true);
        try {
            const preview = await familyApi.getCheckoutPreview(requestId, {
                addressId: addressId || checkoutAddressId,
                shippingMethodId: methodId || checkoutMethodId,
            });
            setData((prev) => ({ ...prev, revalidation: preview.revalidation }));
            const method = preview.revalidation?.selected_method;
            if (method) setCheckoutMethodId(String(method.id));
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const run = async (action, successText) => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            const result = await action();
            if (successText) setNotice(successText);
            await load();
            return result;
        } catch (err) {
            setError(err.message);
            // A change since submission needs an explicit acknowledgement.
            if (err.code === 'CHANGES_NEED_ACKNOWLEDGEMENT') setAcknowledged(false);
            return null;
        } finally {
            setBusy(false);
        }
    };

    if (!isMounted || loading) {
        return (
            <div className="min-h-screen bg-[#111315] flex items-center justify-center">
                <Loader2 size={36} className="animate-spin text-marine-primary" />
            </div>
        );
    }

    if (!data) {
        return (
            <div className="min-h-screen bg-[#111315] flex items-center justify-center px-4" dir={isAr ? 'rtl' : 'ltr'}>
                <div className="max-w-md w-full bg-white/5 border border-white/10 rounded-3xl p-8 text-center">
                    <AlertTriangle size={40} className="text-red-400 mx-auto mb-4" />
                    <p className="text-white font-bold mb-6">{error || (isAr ? 'تعذر تحميل الطلب.' : 'Could not load this request.')}</p>
                    <Link href="/profile?tab=family" className="inline-block bg-marine-cyan text-white font-bold px-6 py-3 rounded-xl">
                        {copy.family}
                    </Link>
                </div>
            </div>
        );
    }

    const { request, viewer_role: viewerRole, revalidation, relationship } = data;
    const isOrganizer = viewerRole === 'organizer';

    // ---- How the organizer may pay ----
    // Both facts come from the server: the wallet no longer replaces the
    // gateway, so which routes exist is the store's setting, not a rule this
    // screen can infer.
    const payMethods = Array.isArray(data.payment_methods) && data.payment_methods.length
        ? data.payment_methods
        : ['credit_card'];
    const walletState = data.wallet || {};
    const walletEnabled = !!walletState.enabled;
    const walletFrozen = walletState.status === 'frozen';
    const walletSufficient = !!walletState.sufficient;

    const payRequest = async (method) => {
        setBusy(true);
        setError('');
        try {
            const result = await familyApi.createPayment(requestId, {
                address_id: checkoutAddressId,
                shipping_method_id: checkoutMethodId,
                payment_method: method,
            });
            if (result.alreadyPlaced) { await load(); return; }
            // Paying from the wallet settles server-side — the order already
            // exists, so reload the request rather than looking for a redirect
            // that will never come.
            if (result.requiresPayment === false) { await load(); return; }
            window.location.href = result.paymentUrl;
        } catch (err) {
            // A shortfall is fixable: point the organizer at their wallet
            // instead of stopping at the error.
            setError(err.code === 'INSUFFICIENT_BALANCE'
                ? `${err.message}. ${isAr ? 'اشحن محفظتك من صفحة الحساب ثم أعد المحاولة.' : 'Top up your wallet from your profile, then try again.'}`
                : err.message);
        } finally {
            setBusy(false);
        }
    };
    const organizerName = request.organizer?.name || '';
    const requesterName = request.requester?.name || '';
    const activeItems = request.items.filter((i) => !i.removed_at_approval);

    const canApprove = isOrganizer && request.status === 'pending_approval';
    const canDecline = isOrganizer && ['pending_approval', 'approved_payment_needed'].includes(request.status);
    const canPay = isOrganizer && ['approved_payment_needed', 'payment_in_progress'].includes(request.status) && !request.converted_order_id;
    const canWithdraw = !isOrganizer && ['pending_approval', 'approved_payment_needed'].includes(request.status);

    const changes = revalidation?.changes || [];
    const current = revalidation?.current;

    return (
        <div className="min-h-screen bg-[#111315] py-10 px-4" dir={isAr ? 'rtl' : 'ltr'}>
            <div className="max-w-4xl mx-auto">
                <Link href="/profile?tab=family" className="inline-flex items-center gap-1.5 text-zinc-500 hover:text-white text-sm font-medium mb-6 transition-colors">
                    {isAr ? <ChevronRight size={16} /> : <ArrowLeft size={16} />} {copy.family}
                </Link>

                {/* ---------- Header ---------- */}
                <div className="bg-white/5 border border-white/10 rounded-3xl p-6 mb-6">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-4 min-w-0">
                            <Avatar user={isOrganizer ? request.requester : request.organizer} />
                            <div className="min-w-0">
                                <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest">
                                    {isOrganizer ? copy.requestedBy : copy.organizer}
                                </p>
                                <h1 className="text-white font-black text-xl truncate">
                                    {isOrganizer ? requesterName : organizerName}
                                </h1>
                                {isOrganizer && (
                                    <p className="text-zinc-400 text-xs mt-0.5">
                                        {isAr
                                            ? `${getRelationshipLabel(relationship, isAr)} لديك`
                                            : `Your ${getRelationshipLabel(relationship, isAr).toLowerCase()}`}
                                    </p>
                                )}
                            </div>
                        </div>
                        <RequestStatusBadge status={request.status} isAr={isAr} />
                    </div>

                    {/* Actor-named status — never a bare "waiting for approval". */}
                    <p className="text-zinc-300 text-sm font-bold mt-5">
                        {getActorStatusLine(request.status, organizerName, isAr)}
                    </p>
                    <p className="text-zinc-500 text-xs mt-1">
                        {copy.submittedOn}: {new Date(request.created_at).toLocaleString(isAr ? 'ar-u-ca-gregory' : 'en-US')}
                    </p>

                    {request.member_note && (
                        <div className="mt-4 p-3 bg-white/5 border border-white/10 rounded-xl">
                            <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mb-1">
                                {isAr ? 'ملاحظة' : 'Note'}
                            </p>
                            <p className="text-zinc-300 text-sm italic">“{request.member_note}”</p>
                        </div>
                    )}

                    {request.status === 'declined' && (
                        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                            <p className="text-red-300 text-sm font-bold">
                                {isAr ? 'سبب الرفض: ' : 'Decline reason: '}
                                {DECLINE_REASONS.find((r) => r.value === request.decline_reason)?.[isAr ? 'ar' : 'en'] || request.decline_reason}
                            </p>
                            {request.decline_note && <p className="text-red-200/70 text-xs mt-1 italic">“{request.decline_note}”</p>}
                        </div>
                    )}
                </div>

                {notice && (
                    <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-sm font-bold flex items-start gap-3">
                        <CheckCircle2 size={18} className="flex-shrink-0 mt-0.5" /> <span>{notice}</span>
                    </div>
                )}
                {error && (
                    <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm font-bold flex items-start gap-3">
                        <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" /> <span>{error}</span>
                    </div>
                )}

                {/* ---------- Resulting order (both sides, read-only for the member) ---------- */}
                {data.order && (
                    <section className="bg-white/5 border border-white/10 rounded-3xl p-6 mb-6">
                        <h2 className="text-white font-black text-lg flex items-center gap-2 mb-4">
                            <Package size={18} className="text-marine-primary" />
                            {isAr ? 'الطلب الناتج' : 'Resulting order'}
                        </h2>

                        <p className="text-zinc-400 text-xs mb-4">
                            {isOrganizer
                                ? (isAr ? `تم الطلب لصالحك · ${copy.requestedBy} ${requesterName}` : `${copy.orderedFor} you · ${copy.requestedBy} ${requesterName}`)
                                : (isAr ? `تم الطلب لصالح ${organizerName} · ${copy.requestedByYou}` : `${copy.orderedFor} ${organizerName} · ${copy.requestedByYou}`)}
                        </p>

                        <div className="flex flex-wrap items-center gap-4 mb-4">
                            <Stat label={isAr ? 'رقم الطلب' : 'Order ID'} value={`#${data.order.reference}`} />
                            <Stat label={isAr ? 'الإجمالي' : 'Total'} value={`${currency} ${Number(data.order.total_price).toFixed(2)}`} />
                            <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.1em] ${getOrderStatusColor(data.order.status)}`}>
                                {getOrderStatusLabel(data.order.status, isAr)}
                            </span>
                        </div>

                        {data.order.shipments?.length > 0 && (
                            <div className="space-y-2 pt-4 border-t border-white/5">
                                <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                                    <Truck size={12} className="text-marine-primary" /> {isAr ? 'تتبع الشحنة' : 'Shipment tracking'}
                                </p>
                                {data.order.shipments.map((shipment, index) => (
                                    <div key={index} className="bg-white/5 border border-white/10 rounded-xl p-3 flex items-center justify-between gap-3">
                                        <p className="text-xs font-mono text-white">{shipment.tracking_number || shipment.bosta_tracking_number || '—'}</p>
                                        <p className="text-[11px] text-zinc-400">{getShipmentStatusLabel(shipment.bosta_status, isAr)}</p>
                                    </div>
                                ))}
                            </div>
                        )}

                        {isOrganizer ? (
                            <Link href="/profile?tab=orders" className="inline-block mt-5 bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold px-5 py-2.5 rounded-xl text-sm transition-all">
                                {isAr ? 'إدارة الطلب' : 'Manage order'}
                            </Link>
                        ) : (
                            <p className="text-zinc-600 text-[11px] mt-5 italic">
                                {isAr
                                    ? 'للعرض والتتبع فقط — يتولى مسؤول العائلة الدفع والإلغاء والإرجاع والاسترداد.'
                                    : 'View and tracking only — your organizer handles payment, cancellation, returns, and refunds.'}
                            </p>
                        )}
                    </section>
                )}

                {/* ---------- Items ---------- */}
                <section className="bg-white/5 border border-white/10 rounded-3xl p-6 mb-6">
                    <h2 className="text-white font-black text-lg flex items-center gap-2 mb-5">
                        <Package size={18} className="text-marine-primary" /> {isAr ? 'المنتجات المطلوبة' : 'Requested items'}
                    </h2>

                    <div className="space-y-4">
                        {request.items.map((item) => {
                            const live = (revalidation?.items || []).find((entry) => String(entry.item_id) === String(item._id));
                            const dropped = item.removed_at_approval || removedItemIds.includes(String(item._id));
                            return (
                                <div key={item._id} className={`flex items-center gap-4 ${dropped ? 'opacity-40' : ''}`}>
                                    <div className="w-16 h-16 bg-white/10 rounded-xl overflow-hidden flex-shrink-0 border border-white/10">
                                        {item.image && <img src={item.image} alt={item.title} className="w-full h-full object-cover" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-white font-bold text-sm truncate">{item.title}</p>
                                        <p className="text-zinc-500 text-xs mt-0.5">
                                            {item.variant_label ? `${item.variant_label} · ` : ''}× {item.quantity}
                                        </p>
                                        {live && !live.available && (
                                            <p className="text-red-400 text-[11px] font-bold mt-1">
                                                {isAr ? 'غير متاح حالياً' : 'No longer available'}
                                            </p>
                                        )}
                                    </div>
                                    <div className="text-end flex-shrink-0">
                                        <p className={`font-bold text-sm ${live && live.available && live.current_unit_price !== live.requested_unit_price ? 'text-zinc-500 line-through' : 'text-white'}`}>
                                            {currency} {Number(item.estimated_unit_price).toFixed(2)}
                                        </p>
                                        {live?.available && live.current_unit_price !== live.requested_unit_price && (
                                            <p className="text-amber-400 font-bold text-sm">
                                                {currency} {Number(live.current_unit_price).toFixed(2)}
                                            </p>
                                        )}
                                    </div>
                                    {canApprove && live && !live.available && !dropped && (
                                        <button
                                            onClick={() => setRemovedItemIds((ids) => [...ids, String(item._id)])}
                                            className="text-red-400 hover:text-red-300 flex-shrink-0"
                                            aria-label={isAr ? 'إزالة المنتج غير المتاح' : 'Remove unavailable item'}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {removedItemIds.length > 0 && (
                        <button
                            onClick={() => setRemovedItemIds([])}
                            className="text-zinc-400 hover:text-white text-xs font-bold mt-4"
                        >
                            {isAr ? 'التراجع عن الإزالة' : 'Undo removals'}
                        </button>
                    )}
                </section>

                {/* ---------- Delivery ---------- */}
                <section className="bg-white/5 border border-white/10 rounded-3xl p-6 mb-6 space-y-5">
                    <h2 className="text-white font-black text-lg flex items-center gap-2">
                        <MapPin size={18} className="text-marine-primary" /> {isAr ? 'التوصيل' : 'Delivery'}
                    </h2>

                    {/* The organizer can switch address/method inside the focused
                        checkout; everyone else sees the stored snapshot. */}
                    {canPay && revalidation ? (
                        <>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
                                    {isAr ? 'عنوان التوصيل' : 'Delivery address'}
                                </label>
                                <select
                                    value={checkoutAddressId}
                                    onChange={(e) => { setCheckoutAddressId(e.target.value); refreshPreview(e.target.value, ''); }}
                                    className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan"
                                >
                                    {(revalidation.available_addresses || []).map((address) => (
                                        <option key={address._id} value={String(address._id)} className="text-zinc-900">
                                            {[address.label, address.recipient_name, address.shipping_city].filter(Boolean).join(' · ')}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-zinc-500 text-xs">{revalidation.address?.full_address}</p>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
                                    {isAr ? 'طريقة الشحن' : 'Shipping method'}
                                </label>
                                {(revalidation.available_methods || []).length === 0 ? (
                                    <p className="text-red-400 text-sm font-bold">
                                        {isAr ? 'لا توجد طرق شحن متاحة لهذه الوجهة.' : 'No shipping methods available for this destination.'}
                                    </p>
                                ) : (revalidation.available_methods || []).map((method) => (
                                    <label
                                        key={method.id}
                                        className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                                            String(checkoutMethodId) === String(method.id) ? 'border-marine-cyan bg-marine-cyan/10' : 'border-white/10 bg-white/5 hover:border-white/20'
                                        }`}
                                    >
                                        <input
                                            type="radio" name="family_shipping_method"
                                            checked={String(checkoutMethodId) === String(method.id)}
                                            onChange={() => { setCheckoutMethodId(String(method.id)); refreshPreview('', String(method.id)); }}
                                            className="accent-marine-cyan"
                                        />
                                        <span className="flex-1 text-white text-sm font-bold">{isAr ? (method.name_ar || method.name) : method.name}</span>
                                        <span className="text-marine-primary font-bold text-sm">
                                            {Number(method.total_cost) === 0 ? (isAr ? 'مجاني' : 'Free') : `${currency} ${Number(method.total_cost).toFixed(2)}`}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </>
                    ) : (
                        <>
                            <div>
                                {request.shipping_address?.label && (
                                    <span className="inline-block bg-white/10 text-zinc-300 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md mb-2">
                                        {request.shipping_address.label}
                                    </span>
                                )}
                                <p className="text-white font-bold text-sm">{request.shipping_address?.recipient_name}</p>
                                <p className="text-zinc-400 text-xs mt-0.5">{request.shipping_address?.phone}</p>
                                <p className="text-zinc-500 text-xs mt-1">{request.shipping_address?.full_address}</p>
                            </div>
                            {request.shipping_method && (
                                <p className="text-zinc-400 text-sm flex items-center gap-2">
                                    <Truck size={14} className="text-marine-primary" />
                                    {isAr ? (request.shipping_method.name_ar || request.shipping_method.name) : request.shipping_method.name}
                                </p>
                            )}
                        </>
                    )}
                </section>

                {/* ---------- Changes since submission ---------- */}
                {isOrganizer && changes.length > 0 && (
                    <section className="bg-amber-500/10 border border-amber-500/25 rounded-3xl p-6 mb-6">
                        <h2 className="text-amber-300 font-black text-lg flex items-center gap-2 mb-4">
                            <AlertTriangle size={18} /> {copy.changesTitle}
                        </h2>

                        <div className="overflow-x-auto">
                            <table className="w-full text-sm min-w-[380px]">
                                <thead>
                                    <tr className="text-amber-200/70 text-[10px] font-black uppercase tracking-widest">
                                        <th className="text-start pb-2">{isAr ? 'البند' : 'Item'}</th>
                                        <th className="text-end pb-2">{copy.requested}</th>
                                        <th className="text-end pb-2">{copy.current}</th>
                                    </tr>
                                </thead>
                                <tbody className="text-amber-100">
                                    {changes.map((change, index) => (
                                        <tr key={index} className="border-t border-amber-500/15">
                                            <td className="py-2 pe-3">{getChangeLabel(change, isAr)}</td>
                                            <td className="py-2 text-end whitespace-nowrap">
                                                {change.requested != null && typeof change.requested === 'number'
                                                    ? `${currency} ${Number(change.requested).toFixed(2)}`
                                                    : (change.requested || '—')}
                                            </td>
                                            <td className="py-2 text-end whitespace-nowrap font-bold">
                                                {change.current != null && typeof change.current === 'number'
                                                    ? `${currency} ${Number(change.current).toFixed(2)}`
                                                    : (change.current || '—')}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {canApprove && (
                            <label className="flex items-center gap-3 mt-5 cursor-pointer">
                                <input
                                    type="checkbox" checked={acknowledged}
                                    onChange={(e) => setAcknowledged(e.target.checked)}
                                    className="w-4 h-4 rounded accent-marine-cyan"
                                />
                                <span className="text-amber-100 text-sm font-bold">{copy.acknowledgeChanges}</span>
                            </label>
                        )}
                    </section>
                )}

                {/* ---------- Totals ---------- */}
                <section className="bg-white/5 border border-white/10 rounded-3xl p-6 mb-6">
                    <h2 className="text-white font-black text-lg mb-5">{isAr ? 'الملخص' : 'Summary'}</h2>
                    <div className="space-y-2.5 text-sm">
                        <Row label={isAr ? 'إجمالي المنتجات' : 'Product subtotal'}
                             requested={request.estimated_subtotal} current={current?.subtotal} currency={currency} showCurrent={isOrganizer && !!current} />
                        <Row label={isAr ? 'الخصم' : 'Discount'}
                             requested={-request.estimated_discount} current={current ? -current.discount : undefined} currency={currency} showCurrent={isOrganizer && !!current} />
                        <Row label={isAr ? 'الشحن' : 'Shipping'}
                             requested={request.estimated_shipping} current={current?.shipping} currency={currency} showCurrent={isOrganizer && !!current} />
                        <div className="pt-3 border-t border-white/10">
                            <Row bold
                                 label={canPay ? (isAr ? 'الإجمالي' : 'Total') : copy.estimatedTotal}
                                 requested={request.estimated_total} current={current?.total} currency={currency} showCurrent={isOrganizer && !!current} />
                        </div>
                    </div>

                    {request.coupon_code && (
                        <p className="text-zinc-400 text-xs mt-4">
                            {isAr ? 'الكوبون: ' : 'Coupon: '}<span className="font-bold text-white">{request.coupon_code}</span>
                            {isOrganizer && revalidation && !revalidation.coupon_applied && (
                                <span className="text-amber-400 font-bold">
                                    {' '}· {isAr ? 'غير صالح لحسابك' : 'not valid for your account'}
                                </span>
                            )}
                        </p>
                    )}

                    {!canPay && ['pending_approval', 'approved_payment_needed'].includes(request.status) && (
                        <p className="text-zinc-500 text-xs mt-4 leading-relaxed">{copy.noPaymentNow}</p>
                    )}
                </section>

                {/* ---------- Actions ---------- */}
                <div className="space-y-3">
                    {canApprove && (
                        <button
                            disabled={busy || (changes.length > 0 && !acknowledged) || revalidation?.purchasable === false}
                            onClick={() => run(
                                () => familyApi.approveRequest(requestId, {
                                    remove_item_ids: removedItemIds,
                                    acknowledged_changes: acknowledged,
                                }),
                                isAr ? 'تمت الموافقة على الطلب. اختر طريقة الدفع.' : 'Request approved. Choose how you would like to pay.'
                            )}
                            className="w-full bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold py-4 rounded-xl transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {busy ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                            {copy.approveAndPay}
                        </button>
                    )}

                    {canPay && (
                        <>
                            {/* Requester context stays visible through payment. */}
                            <p className="text-zinc-400 text-sm text-center flex items-center justify-center gap-2 pb-1">
                                <Users size={14} className="text-marine-primary" />
                                {isAr
                                    ? `بطلب من ${requesterName}، ${getRelationshipLabel(relationship, isAr)} لديك`
                                    : `Requested by ${requesterName}, your ${getRelationshipLabel(relationship, isAr).toLowerCase()}`}
                            </p>

                            <button
                                disabled={busy || revalidation?.purchasable === false}
                                onClick={async () => {
                                    const result = await run(
                                        () => familyApi.placeCod(requestId, {
                                            address_id: checkoutAddressId,
                                            shipping_method_id: checkoutMethodId,
                                        })
                                    );
                                    if (result?.order_id) {
                                        setNotice(isAr
                                            ? `تم تنفيذ الطلب بنجاح. يمكن لـ ${requesterName} تتبعه الآن من طلبات العائلة.`
                                            : `Order placed successfully. ${requesterName} can now track it from their family requests.`);
                                    }
                                }}
                                className="w-full bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold py-4 rounded-xl transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {busy ? <Loader2 size={18} className="animate-spin" /> : <Banknote size={18} />}
                                {copy.placeOrderCod}
                            </button>

                            {/* One decision, one press. The organizer reviews
                                many requests quickly, so the route is part of
                                the approval rather than a separate step. */}
                            {payMethods.map((method) => (
                                <button
                                    key={method}
                                    disabled={busy || revalidation?.purchasable === false
                                        || (method === 'wallet' && (walletFrozen || !walletSufficient))}
                                    onClick={() => payRequest(method)}
                                    className={method === 'wallet'
                                        ? 'w-full bg-white/10 hover:bg-white/15 border border-white/10 text-white font-bold py-4 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2'
                                        : 'w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold py-4 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2'}
                                >
                                    {method === 'wallet' ? <Wallet size={18} /> : <CreditCard size={18} />}
                                    {request.status === 'payment_in_progress' && method !== 'wallet'
                                        ? copy.resumePayment
                                        : (method === 'wallet' ? wal.approveAndPayWallet : wal.approveAndPayOnline)}
                                </button>
                            ))}

                            {/* The organizer's own balance against this total.
                                Shown only when it is the thing standing in the
                                way, so it never nags a funded wallet. */}
                            {walletEnabled && !walletSufficient && !walletFrozen && (
                                <p className="text-amber-300/80 text-xs text-center leading-relaxed">
                                    {wal.shortfall(Number(walletState.shortfall || 0).toFixed(2), currency)}{' '}
                                    <Link href="/profile?tab=wallet" className="underline underline-offset-4 font-bold">
                                        {wal.topUp}
                                    </Link>
                                </p>
                            )}
                            {walletEnabled && walletFrozen && (
                                <p className="text-amber-300/80 text-xs text-center leading-relaxed">{wal.frozenHint}</p>
                            )}
                        </>
                    )}

                    {canDecline && (
                        <button
                            disabled={busy}
                            onClick={() => setShowDecline(true)}
                            className="w-full bg-transparent border border-red-500/30 text-red-400 hover:bg-red-500/10 font-bold py-3.5 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            <XCircle size={18} /> {copy.declineRequest}
                        </button>
                    )}

                    {canWithdraw && (
                        <button
                            disabled={busy}
                            onClick={() => {
                                if (!confirm(isAr ? 'هل تريد سحب هذا الطلب؟' : 'Withdraw this request?')) return;
                                run(() => familyApi.withdrawRequest(requestId));
                            }}
                            className="w-full bg-transparent border border-white/10 text-zinc-400 hover:text-white hover:bg-white/5 font-bold py-3.5 rounded-xl transition-all disabled:opacity-50"
                        >
                            {copy.withdraw}
                        </button>
                    )}

                    {!isOrganizer && ['declined', 'expired', 'withdrawn'].includes(request.status) && (
                        <Link
                            href="/products"
                            className="block w-full text-center bg-white/5 hover:bg-white/10 text-zinc-300 font-bold py-3.5 rounded-xl transition-all"
                        >
                            <Send size={16} className="inline me-2" />
                            {isAr ? 'تجهيز طلب جديد' : 'Prepare a new request'}
                        </Link>
                    )}
                </div>
            </div>

            {/* ---------- Decline dialog: one step, low friction ---------- */}
            {showDecline && (
                <Overlay className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowDecline(false)} />
                    <div className="relative bg-[#09090b] border border-white/10 w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-6 sm:p-8 shadow-2xl">
                        <h3 className="text-xl font-black text-white mb-5">{copy.declineRequest}</h3>

                        <div className="space-y-2 mb-5">
                            {DECLINE_REASONS.map((reason) => (
                                <label
                                    key={reason.value}
                                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                                        declineForm.reason === reason.value ? 'border-marine-cyan bg-marine-cyan/10' : 'border-white/10 bg-white/5 hover:border-white/20'
                                    }`}
                                >
                                    <input
                                        type="radio" name="decline_reason" checked={declineForm.reason === reason.value}
                                        onChange={() => setDeclineForm({ ...declineForm, reason: reason.value })}
                                        className="accent-marine-cyan"
                                    />
                                    <span className="text-white text-sm font-bold">{isAr ? reason.ar : reason.en}</span>
                                </label>
                            ))}
                        </div>

                        <textarea
                            rows={3} maxLength={300} value={declineForm.note}
                            onChange={(e) => setDeclineForm({ ...declineForm, note: e.target.value })}
                            placeholder={isAr ? `ملاحظة اختيارية لـ ${requesterName}...` : `Optional note for ${requesterName}...`}
                            className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan resize-none mb-5"
                        />

                        <div className="flex gap-3">
                            <button
                                disabled={busy}
                                onClick={async () => {
                                    const ok = await run(() => familyApi.declineRequest(requestId, declineForm));
                                    if (ok !== null) setShowDecline(false);
                                }}
                                className="flex-1 bg-marine-cyan text-white py-3 rounded-xl font-bold hover:bg-marine-cyan-dark transition-all disabled:opacity-50"
                            >
                                {copy.declineRequest}
                            </button>
                            <button
                                onClick={() => setShowDecline(false)}
                                className="flex-1 bg-white/5 text-zinc-400 py-3 rounded-xl font-bold hover:bg-white/10 transition-all"
                            >
                                {copy.cancel}
                            </button>
                        </div>
                    </div>
                </Overlay>
            )}
        </div>
    );
}

function Avatar({ user }) {
    return (
        <div className="w-12 h-12 rounded-full bg-marine-cyan flex items-center justify-center text-white font-black overflow-hidden flex-shrink-0">
            {user?.profile_image
                ? <img src={resolveAssetUrl(user.profile_image)} alt={user?.name || ''} className="w-full h-full object-cover" />
                : (user?.name?.[0]?.toUpperCase() || '?')}
        </div>
    );
}

function Stat({ label, value }) {
    return (
        <div>
            <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest">{label}</p>
            <p className="text-white font-bold text-sm mt-0.5">{value}</p>
        </div>
    );
}

/** Summary row that shows the requested amount and, for the organizer, the current one. */
function Row({ label, requested, current, currency, showCurrent, bold }) {
    const changed = showCurrent && current != null && Math.abs(Number(requested) - Number(current)) > 0.009;
    return (
        <div className={`flex justify-between items-baseline gap-4 ${bold ? 'text-white font-black text-base' : 'text-zinc-400'}`}>
            <span>{label}</span>
            <span className="flex items-baseline gap-2 whitespace-nowrap">
                <span className={changed ? 'text-zinc-600 line-through text-xs' : ''}>
                    {currency} {Number(requested || 0).toFixed(2)}
                </span>
                {changed && (
                    <span className={bold ? 'text-marine-primary' : 'text-amber-400 font-bold'}>
                        {currency} {Number(current).toFixed(2)}
                    </span>
                )}
            </span>
        </div>
    );
}
