'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from '../../../../lib/navigation';
import { useApp } from '../../../../context/AppContext';
import { vendorReturnsApi } from '../../../../lib/api';
import { ArrowLeft, RotateCcw, CheckCircle2, XCircle, Package, Clock, Loader2, Truck, Image as ImageIcon } from 'lucide-react';
import { localizeReturnHistory, localizeShipmentStatus } from '../../../../lib/dashboardLocalization';

const STATUS_COLORS = {
    pending_vendor_review: 'bg-amber-500/20 text-amber-500',
    vendor_approved: 'bg-blue-500/20 text-blue-500',
    vendor_rejected: 'bg-orange-500/20 text-orange-500',
    pending_admin_review: 'bg-violet-500/20 text-violet-500',
    approved: 'bg-emerald-500/20 text-emerald-500',
    rejected: 'bg-red-500/20 text-red-500',
    return_shipping: 'bg-cyan-500/20 text-cyan-500',
    return_received: 'bg-indigo-500/20 text-indigo-500',
    refund_processing: 'bg-yellow-500/20 text-yellow-500',
    completed: 'bg-emerald-500/20 text-emerald-500',
    cancelled: 'bg-zinc-500/20 text-zinc-500',
};

const STATUS_LABELS = {
    pending_vendor_review: { en: 'Pending Vendor Review', ar: 'بانتظار مراجعة البائع' },
    vendor_approved: { en: 'Vendor Approved', ar: 'وافق البائع' },
    vendor_rejected: { en: 'Vendor Rejected', ar: 'رفض البائع' },
    pending_admin_review: { en: 'Pending Admin', ar: 'بانتظار الإدارة' },
    approved: { en: 'Approved', ar: 'موافق عليه' },
    rejected: { en: 'Rejected', ar: 'مرفوض' },
    return_shipping: { en: 'Return Shipping', ar: 'شحن الإرجاع' },
    return_received: { en: 'Received', ar: 'تم الاستلام' },
    refund_processing: { en: 'Refund Processing', ar: 'جاري الاسترداد' },
    completed: { en: 'Completed', ar: 'مكتمل' },
    cancelled: { en: 'Cancelled', ar: 'ملغى' },
};

const REASON_LABELS = {
    defective: { en: 'Defective Product', ar: 'منتج معيب' },
    wrong_item: { en: 'Wrong Item', ar: 'منتج خاطئ' },
    not_as_described: { en: 'Not as Described', ar: 'غير مطابق للوصف' },
    changed_mind: { en: 'Changed Mind', ar: 'تغيير رأي' },
    other: { en: 'Other', ar: 'أخرى' },
};

export default function ReturnDetailPage() {
    const { id } = useParams();
    const router = useRouter();
    const { language } = useApp();
    const isAr = language === 'ar';

    const [ret, setRet] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [actionMsg, setActionMsg] = useState('');
    const [busy, setBusy] = useState(false);

    // Vendor review
    const [reviewNotes, setReviewNotes] = useState('');

    const showMsg = (msg) => { setActionMsg(msg); setTimeout(() => setActionMsg(''), 4000); };

    const loadReturn = useCallback(async () => {
        try {
            setLoading(true);
            const data = await vendorReturnsApi.getById(id);
            setRet(data.return_request);
        } catch (err) {
            setError(isAr ? 'تعذر تحميل تفاصيل طلب الإرجاع.' : (err.message || 'Failed to load return details.'));
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => { loadReturn(); }, [loadReturn]);

    const handleVendorReview = async (decision) => {
        if (decision === 'rejected' && !reviewNotes.trim()) {
            alert(isAr ? 'يرجى إدخال سبب الرفض' : 'Please provide a reason for rejection');
            return;
        }
        if (!confirm(isAr ? `هل تريد ${decision === 'approved' ? 'الموافقة على' : 'رفض'} الإرجاع؟` : `${decision === 'approved' ? 'Approve' : 'Reject'} this return?`)) return;
        try {
            setBusy(true);
            await vendorReturnsApi.review(id, { decision, notes: reviewNotes });
            showMsg(isAr ? 'تم إرسال المراجعة' : 'Review submitted');
            await loadReturn();
        } catch (err) { alert(isAr ? 'تعذر تحديث طلب الإرجاع.' : (err.message || 'Failed to update the return request.')); } finally { setBusy(false); }
    };

    const handleVendorConfirmReceipt = async () => {
        if (!confirm(isAr ? 'تأكيد استلام المرتجعات؟' : 'Confirm returned goods received?')) return;
        try {
            setBusy(true);
            await vendorReturnsApi.confirmReceipt(id);
            showMsg(isAr ? 'تم تأكيد الاستلام' : 'Receipt confirmed');
            await loadReturn();
        } catch (err) { alert(isAr ? 'تعذر تأكيد استلام المنتجات المرتجعة.' : (err.message || 'Failed to confirm receipt of returned items.')); } finally { setBusy(false); }
    };

    if (loading) return <div className="flex items-center justify-center py-32"><Loader2 size={32} className="animate-spin text-marine-primary" /></div>;
    if (error || !ret) return <div className="bg-red-500/10 border border-red-500/20 text-red-600 p-6 rounded-xl">{error || (isAr ? 'طلب الإرجاع غير موجود.' : 'Return request not found.')}</div>;

    const canVendorReview = ret.status === 'pending_vendor_review';
    const canVendorConfirm = ret.status === 'return_shipping' || ret.status === 'approved';

    return (
        <div className="space-y-6">
            {actionMsg && (
                <div className="fixed top-6 end-6 z-[100] bg-emerald-500 text-white px-5 py-3 rounded-xl font-bold shadow-xl flex items-center gap-2">
                    <CheckCircle2 size={16} /> {actionMsg}
                </div>
            )}

            {/* Header */}
            <div className="flex items-center gap-4">
                <button onClick={() => router.push('/dashboard/returns')} className="p-2 rounded-xl border border-zinc-200 dark:border-white/10 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                    <ArrowLeft size={18} className={isAr ? 'rotate-180' : ''} />
                </button>
                <div className="flex-1">
                    <h1 className="text-xl font-black text-zinc-900 dark:text-white flex items-center gap-2">
                        <RotateCcw size={20} /> {ret.return_number}
                    </h1>
                    <p className="text-sm text-zinc-500 mt-0.5">{REASON_LABELS[ret.reason]?.[isAr ? 'ar' : 'en']}</p>
                </div>
                <span className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest ${STATUS_COLORS[ret.status]}`}>
                    {STATUS_LABELS[ret.status]?.[isAr ? 'ar' : 'en']}
                </span>
            </div>

            {/* Items */}
            <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                <h2 className="text-sm font-bold text-zinc-900 dark:text-white mb-4 flex items-center gap-2">
                    <Package size={16} /> {isAr ? 'المنتجات' : 'Items'}
                </h2>
                <div className="space-y-3">
                    {ret.items?.map((item, i) => (
                        <div key={i} className="flex items-center gap-4 p-3 bg-zinc-50 dark:bg-[#0E1012] rounded-xl">
                            {item.product_image ? (
                                <img src={item.product_image} alt="" className="w-12 h-12 rounded-lg object-cover border border-zinc-200 dark:border-white/10" />
                            ) : (
                                <div className="w-12 h-12 rounded-lg bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center">
                                    <Package size={18} className="text-zinc-400" />
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-zinc-900 dark:text-white truncate">{item.product_title}</p>
                                {item.variant_label && <p className="text-xs text-zinc-500">{item.variant_label}</p>}
                            </div>
                            <div className="text-end">
                                <p className="text-sm font-bold text-zinc-900 dark:text-white">{item.quantity_returning} x {item.unit_price} {isAr ? 'ج.م' : 'EGP'}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Evidence */}
            {ret.evidence?.length > 0 && (
                <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                    <h2 className="text-sm font-bold text-zinc-900 dark:text-white mb-4 flex items-center gap-2">
                        <ImageIcon size={16} /> {isAr ? 'الصور' : 'Evidence'}
                    </h2>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                        {ret.evidence.map((ev, i) => (
                            <a key={i} href={ev.url} target="_blank" rel="noopener noreferrer">
                                <img src={ev.url} alt="" className="w-full h-20 rounded-xl object-cover border border-zinc-200 dark:border-white/10 hover:opacity-80 transition-opacity" />
                            </a>
                        ))}
                    </div>
                </div>
            )}

            {/* Reason Details */}
            {ret.reason_details && (
                <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                    <h2 className="text-sm font-bold text-zinc-900 dark:text-white mb-2">{isAr ? 'التفاصيل' : 'Details'}</h2>
                    <p className="text-sm text-zinc-600 dark:text-zinc-300">{ret.reason_details}</p>
                </div>
            )}

            {/* Return Shipment Tracking */}
            {ret.return_shipment?.bosta_tracking_number && (
                <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                    <h2 className="text-sm font-bold text-zinc-900 dark:text-white mb-3 flex items-center gap-2">
                        <Truck size={16} /> {isAr ? 'تتبع شحنة الإرجاع' : 'Return Shipment Tracking'}
                    </h2>
                    <div className="p-3 bg-zinc-50 dark:bg-[#0E1012] rounded-xl">
                        <p className="text-xs text-zinc-400 mb-1">{isAr ? 'رقم التتبع' : 'Tracking'}</p>
                        <p className="text-sm font-bold text-zinc-900 dark:text-white">{ret.return_shipment.bosta_tracking_number}</p>
                        <p className="text-xs text-zinc-500 mt-1">{isAr ? 'الحالة:' : 'Status:'} {localizeShipmentStatus(ret.return_shipment.bosta_status, language)}</p>
                    </div>
                    {ret.return_shipment.tracking_history?.length > 0 && (
                        <div className="mt-4 space-y-2">
                            {ret.return_shipment.tracking_history.map((th, i) => (
                                <div key={i} className="flex gap-3 text-xs">
                                    <div className="w-1.5 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600 mt-1.5 shrink-0" />
                                    <div>
                                        <span className="font-bold text-zinc-700 dark:text-zinc-300">{localizeShipmentStatus(th.state, language)}</span>
                                        <span className="text-zinc-400 ms-2">{new Date(th.timestamp).toLocaleString(isAr ? 'ar-u-ca-gregory' : 'en-US')}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Vendor Review Action */}
            {canVendorReview && (
                <div className="bg-white dark:bg-[#14171A] border border-amber-200 dark:border-amber-500/20 rounded-2xl p-5">
                    <h2 className="text-sm font-bold text-amber-600 dark:text-amber-400 mb-4">{isAr ? 'مراجعة طلب الإرجاع' : 'Review Return Request'}</h2>
                    <textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)}
                        placeholder={isAr ? 'ملاحظات (مطلوبة للرفض)' : 'Notes (required for rejection)'}
                        rows={3}
                        className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl text-sm text-zinc-900 dark:text-white resize-none mb-4" />
                    <div className="flex gap-3">
                        <button onClick={() => handleVendorReview('approved')} disabled={busy}
                            className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors">
                            {isAr ? 'موافقة' : 'Approve'}
                        </button>
                        <button onClick={() => handleVendorReview('rejected')} disabled={busy}
                            className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors">
                            {isAr ? 'رفض' : 'Reject'}
                        </button>
                    </div>
                </div>
            )}

            {/* Vendor Confirm Receipt */}
            {canVendorConfirm && (
                <button onClick={handleVendorConfirmReceipt} disabled={busy}
                    className="w-full py-3 rounded-xl text-sm font-bold bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50 transition-colors">
                    {busy ? <Loader2 size={16} className="animate-spin mx-auto" /> : (isAr ? 'تأكيد استلام المرتجعات' : 'Confirm Goods Received')}
                </button>
            )}

            {/* History */}
            {ret.history?.length > 0 && (
                <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                    <h2 className="text-sm font-bold text-zinc-900 dark:text-white mb-4 flex items-center gap-2">
                        <Clock size={16} /> {isAr ? 'سجل الأحداث' : 'History'}
                    </h2>
                    <div className="space-y-3">
                        {[...ret.history].reverse().map((h, i) => {
                            const localizedHistory = localizeReturnHistory(h, language);
                            return (
                            <div key={i} className="flex gap-3">
                                <div className="w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-600 mt-2 shrink-0" />
                                <div>
                                    <p className="text-sm font-bold text-zinc-900 dark:text-white">{localizedHistory.title}</p>
                                    {localizedHistory.details && <p className="text-xs text-zinc-500 mt-0.5">{localizedHistory.details}</p>}
                                    <p className="text-[10px] text-zinc-400 mt-1">
                                        {new Date(h.created_at).toLocaleString(isAr ? 'ar-u-ca-gregory' : 'en-US')}
                                    </p>
                                </div>
                            </div>
                        )})}
                    </div>
                </div>
            )}
        </div>
    );
}
