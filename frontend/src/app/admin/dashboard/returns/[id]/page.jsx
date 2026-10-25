'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from '../../../../../lib/navigation';
import Link from '../../../../../components/LocaleLink';
import { useApp } from '../../../../../context/AppContext';
import { adminReturnsApi } from '../../../../../lib/api';
import { ArrowLeft, RotateCcw, CheckCircle2, XCircle, Truck, Package, Clock, Loader2, RefreshCw, Image as ImageIcon } from 'lucide-react';

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
    pending_admin_review: { en: 'Pending Admin Review', ar: 'بانتظار مراجعة الإدارة' },
    approved: { en: 'Approved', ar: 'موافق عليه' },
    rejected: { en: 'Rejected', ar: 'مرفوض' },
    return_shipping: { en: 'Return Shipping', ar: 'شحن الإرجاع' },
    return_received: { en: 'Return Received', ar: 'تم استلام المرتجع' },
    refund_processing: { en: 'Refund Processing', ar: 'جاري الاسترداد' },
    completed: { en: 'Completed', ar: 'مكتمل' },
    cancelled: { en: 'Cancelled', ar: 'ملغى' },
};

const REASON_LABELS = {
    defective: { en: 'Defective Product', ar: 'منتج معيب' },
    wrong_item: { en: 'Wrong Item Received', ar: 'تم استلام منتج خاطئ' },
    not_as_described: { en: 'Not as Described', ar: 'غير مطابق للوصف' },
    changed_mind: { en: 'Changed Mind', ar: 'تغيير رأي' },
    other: { en: 'Other', ar: 'أخرى' },
};
const FAULT_TYPE_BY_REASON = {
    defective: 'vendor_fault',
    wrong_item: 'vendor_fault',
    not_as_described: 'vendor_fault',
    changed_mind: 'customer_fault',
};

/** How the customer paid, in words the admin screen can put in a sentence. */
const paymentMethodLabel = (method, isAr) => ({
    credit_card: isAr ? 'كارت أونلاين' : 'card',
    wallet: isAr ? 'المحفظة' : 'wallet',
    cash: isAr ? 'الدفع عند الاستلام' : 'cash on delivery',
    bank_transfer: isAr ? 'تحويل بنكي' : 'bank transfer',
    company_account: isAr ? 'حساب شركته' : 'their company account',
}[method] || (isAr ? 'طريقة غير معروفة' : 'an unknown method'));

const getEffectiveFaultType = (returnRequest) => {
    if (returnRequest?.fault_type && returnRequest.fault_type !== 'undetermined') return returnRequest.fault_type;
    return FAULT_TYPE_BY_REASON[returnRequest?.reason] || 'undetermined';
};

export default function AdminReturnDetailPage() {
    const { id } = useParams();
    const router = useRouter();
    const { language } = useApp();
    const isAr = language === 'ar';

    const [ret, setRet] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [actionMsg, setActionMsg] = useState('');
    const [busy, setBusy] = useState(false);

    // Review form
    const [reviewDecision, setReviewDecision] = useState('');
    const [reviewFaultType, setReviewFaultType] = useState('');
    const [reviewNotes, setReviewNotes] = useState('');

    // Refund form
    const [restockingFee, setRestockingFee] = useState(0);
    const [refundNotes, setRefundNotes] = useState('');
    // Where the money goes. Empty means "whatever the server defaults to" —
    // filled in from the return as soon as it loads, so the admin sees the
    // destination that matches how the customer actually paid.
    const [refundMethod, setRefundMethod] = useState('');

    const showMsg = (msg) => {
        setActionMsg(msg);
        setTimeout(() => setActionMsg(''), 4000);
    };

    const loadReturn = useCallback(async () => {
        try {
            setLoading(true);
            const data = await adminReturnsApi.getById(id);
            const returnRequest = data.return_request;
            setRet(returnRequest);
            const effectiveFaultType = getEffectiveFaultType(returnRequest);
            if (effectiveFaultType !== 'undetermined') {
                setReviewFaultType(effectiveFaultType);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => { loadReturn(); }, [loadReturn]);

    const handleReview = async () => {
        if (!reviewDecision) return;
        if (reviewDecision === 'approved' && !reviewFaultType) {
            alert(isAr ? 'يرجى تحديد نوع الخطأ' : 'Please select a fault type');
            return;
        }
        try {
            setBusy(true);
            await adminReturnsApi.review(id, {
                decision: reviewDecision,
                fault_type: reviewFaultType,
                notes: reviewNotes,
            });
            showMsg(isAr ? 'تم تحديث المراجعة' : 'Review submitted');
            await loadReturn();
            setReviewDecision('');
            setReviewNotes('');
            setReviewFaultType('');
        } catch (err) {
            alert(err.message);
        } finally {
            setBusy(false);
        }
    };

    const handleShip = async () => {
        if (!confirm(isAr ? 'هل تريد إنشاء شحنة إرجاع عبر بوسطة؟' : 'Create return shipment via Bosta?')) return;
        try {
            setBusy(true);
            await adminReturnsApi.ship(id);
            showMsg(isAr ? 'تم إنشاء شحنة الإرجاع' : 'Return shipment created');
            await loadReturn();
        } catch (err) {
            alert(err.message);
        } finally {
            setBusy(false);
        }
    };

    const handleConfirmReceipt = async () => {
        if (!confirm(isAr ? 'تأكيد استلام المرتجعات؟' : 'Confirm goods received?')) return;
        try {
            setBusy(true);
            await adminReturnsApi.confirmReceipt(id);
            showMsg(isAr ? 'تم تأكيد الاستلام' : 'Receipt confirmed');
            await loadReturn();
        } catch (err) {
            alert(err.message);
        } finally {
            setBusy(false);
        }
    };

    const handleRefreshTracking = async () => {
        try {
            setBusy(true);
            await adminReturnsApi.refreshTracking(id);
            showMsg(isAr ? 'تم تحديث التتبع' : 'Tracking refreshed');
            await loadReturn();
        } catch (err) {
            alert(err.message);
        } finally {
            setBusy(false);
        }
    };

    const handleCreateRefund = async () => {
        if (!confirm(isAr ? 'إنشاء طلب استرداد؟' : 'Create refund?')) return;
        try {
            setBusy(true);
            await adminReturnsApi.createRefund(id, {
                restocking_fee: Number(restockingFee) || 0,
                notes: refundNotes,
                refund_method: refundMethod || undefined,
            });
            showMsg(isAr ? 'تم إنشاء الاسترداد' : 'Refund created');
            await loadReturn();
        } catch (err) {
            alert(err.message);
        } finally {
            setBusy(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-32">
                <Loader2 size={32} className="animate-spin text-marine-primary" />
            </div>
        );
    }

    if (error || !ret) {
        return (
            <div className="bg-red-500/10 border border-red-500/20 text-red-600 p-6 rounded-xl text-sm">
                {error || (isAr ? 'طلب الإرجاع غير موجود' : 'Return request not found')}
            </div>
        );
    }

    const canReview = ret.status === 'pending_admin_review';
    const canShip = ret.status === 'approved';
    const canConfirmReceipt = ret.status === 'return_shipping' || ret.status === 'approved';
    const effectiveFaultType = getEffectiveFaultType(ret);
    const canCreateRefund = (ret.status === 'return_received' || ret.status === 'approved') && !ret.refund_id && effectiveFaultType !== 'undetermined';

    return (
        <div className="space-y-6">
            {/* Toast */}
            {actionMsg && (
                <div className="fixed top-6 end-6 z-[100] bg-emerald-500 text-white px-5 py-3 rounded-xl font-bold shadow-xl animate-in slide-in-from-top-2 flex items-center gap-2">
                    <CheckCircle2 size={16} /> {actionMsg}
                </div>
            )}

            {/* Header */}
            <div className="flex items-center gap-4">
                <button onClick={() => router.push('/admin/dashboard/returns')} className="p-2 rounded-xl border border-zinc-200 dark:border-white/10 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                    <ArrowLeft size={18} className={isAr ? 'rotate-180' : ''} />
                </button>
                <div className="flex-1">
                    <h1 className="text-2xl font-black text-zinc-900 dark:text-white flex items-center gap-3">
                        <RotateCcw size={22} />
                        {ret.return_number}
                    </h1>
                    <p className="text-sm text-zinc-500 mt-0.5">
                        {isAr ? 'طلب إرجاع' : 'Return Request'} — {REASON_LABELS[ret.reason]?.[isAr ? 'ar' : 'en']}
                    </p>
                </div>
                <span className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest ${STATUS_COLORS[ret.status]}`}>
                    {STATUS_LABELS[ret.status]?.[isAr ? 'ar' : 'en']}
                </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Main Content */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Items */}
                    <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                        <h2 className="text-sm font-bold text-zinc-900 dark:text-white mb-4 flex items-center gap-2">
                            <Package size={16} /> {isAr ? 'المنتجات المراد إرجاعها' : 'Items to Return'}
                        </h2>
                        <div className="space-y-3">
                            {ret.items?.map((item, i) => (
                                <div key={i} className="flex items-center gap-4 p-3 bg-zinc-50 dark:bg-[#0E1012] rounded-xl">
                                    {item.product_image ? (
                                        <img src={item.product_image} alt="" className="w-14 h-14 rounded-lg object-cover border border-zinc-200 dark:border-white/10" />
                                    ) : (
                                        <div className="w-14 h-14 rounded-lg bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center">
                                            <Package size={20} className="text-zinc-400" />
                                        </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold text-zinc-900 dark:text-white truncate">{item.product_title}</p>
                                        {item.variant_label && <p className="text-xs text-zinc-500">{item.variant_label}</p>}
                                        <p className="text-xs text-zinc-400 mt-1">
                                            {isAr ? 'الكمية:' : 'Qty:'} {item.quantity_returning} / {item.quantity_purchased}
                                            {' · '}
                                            {item.unit_price} {isAr ? 'ج.م' : 'EGP'}
                                        </p>
                                    </div>
                                    <div className="text-end">
                                        <p className="text-sm font-bold text-zinc-900 dark:text-white">{(item.quantity_returning * item.unit_price).toFixed(2)} {isAr ? 'ج.م' : 'EGP'}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Evidence */}
                    {ret.evidence?.length > 0 && (
                        <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                            <h2 className="text-sm font-bold text-zinc-900 dark:text-white mb-4 flex items-center gap-2">
                                <ImageIcon size={16} /> {isAr ? 'الأدلة المرفقة' : 'Evidence'}
                            </h2>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                {ret.evidence.map((ev, i) => (
                                    <a key={i} href={ev.url} target="_blank" rel="noopener noreferrer" className="block">
                                        <img src={ev.url} alt={`Evidence ${i + 1}`} className="w-full h-24 rounded-xl object-cover border border-zinc-200 dark:border-white/10 hover:opacity-80 transition-opacity" />
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Reason Details */}
                    {ret.reason_details && (
                        <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                            <h2 className="text-sm font-bold text-zinc-900 dark:text-white mb-2">{isAr ? 'تفاصيل السبب' : 'Reason Details'}</h2>
                            <p className="text-sm text-zinc-600 dark:text-zinc-300">{ret.reason_details}</p>
                        </div>
                    )}

                    {/* Vendor Review */}
                    {ret.vendor_review?.decision && (
                        <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                            <h2 className="text-sm font-bold text-zinc-900 dark:text-white mb-2">{isAr ? 'مراجعة البائع' : 'Vendor Review'}</h2>
                            <div className="flex items-center gap-2 mb-2">
                                {ret.vendor_review.decision === 'approved' ? (
                                    <CheckCircle2 size={16} className="text-emerald-500" />
                                ) : (
                                    <XCircle size={16} className="text-red-500" />
                                )}
                                <span className="text-sm font-bold text-zinc-900 dark:text-white capitalize">{ret.vendor_review.decision}</span>
                            </div>
                            {ret.vendor_review.notes && <p className="text-sm text-zinc-500">{ret.vendor_review.notes}</p>}
                        </div>
                    )}

                    {/* Admin Review Action */}
                    {canReview && (
                        <div className="bg-white dark:bg-[#14171A] border border-violet-200 dark:border-violet-500/20 rounded-2xl p-5">
                            <h2 className="text-sm font-bold text-violet-600 dark:text-violet-400 mb-4">{isAr ? 'مراجعة الإدارة' : 'Admin Review'}</h2>
                            <div className="space-y-4">
                                <div className="flex gap-3">
                                    <button onClick={() => setReviewDecision('approved')}
                                        className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors ${reviewDecision === 'approved' ? 'bg-emerald-500 text-white' : 'bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-300'}`}>
                                        {isAr ? 'موافقة' : 'Approve'}
                                    </button>
                                    <button onClick={() => setReviewDecision('rejected')}
                                        className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors ${reviewDecision === 'rejected' ? 'bg-red-500 text-white' : 'bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-300'}`}>
                                        {isAr ? 'رفض' : 'Reject'}
                                    </button>
                                </div>
                                {reviewDecision === 'approved' && (
                                    <select value={reviewFaultType} onChange={(e) => setReviewFaultType(e.target.value)}
                                        className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl text-sm text-zinc-900 dark:text-white">
                                        <option value="">{isAr ? 'تحديد نوع الخطأ' : 'Select Fault Type'}</option>
                                        <option value="vendor_fault">{isAr ? 'خطأ البائع' : 'Vendor Fault'}</option>
                                        <option value="customer_fault">{isAr ? 'خطأ العميل' : 'Customer Fault'}</option>
                                    </select>
                                )}
                                <textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)}
                                    placeholder={isAr ? 'ملاحظات (اختياري)' : 'Notes (optional)'}
                                    rows={3}
                                    className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl text-sm text-zinc-900 dark:text-white resize-none"
                                />
                                <button onClick={handleReview} disabled={busy || !reviewDecision}
                                    className="w-full py-2.5 rounded-xl text-sm font-bold bg-marine-cyan text-white hover:bg-marine-cyan-dark disabled:opacity-50 transition-colors">
                                    {busy ? <Loader2 size={16} className="animate-spin mx-auto" /> : (isAr ? 'إرسال المراجعة' : 'Submit Review')}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Ship / Confirm Receipt / Refresh Tracking Actions */}
                    {(canShip || canConfirmReceipt || ret.return_shipment) && (
                        <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                            <h2 className="text-sm font-bold text-zinc-900 dark:text-white mb-4 flex items-center gap-2">
                                <Truck size={16} /> {isAr ? 'شحن الإرجاع' : 'Return Shipping'}
                            </h2>
                            {ret.return_shipment?.bosta_tracking_number && (
                                <div className="mb-4 p-3 bg-zinc-50 dark:bg-[#0E1012] rounded-xl">
                                    <p className="text-xs text-zinc-400 mb-1">{isAr ? 'رقم التتبع' : 'Tracking Number'}</p>
                                    <p className="text-sm font-bold text-zinc-900 dark:text-white">{ret.return_shipment.bosta_tracking_number}</p>
                                    <p className="text-xs text-zinc-500 mt-1">{isAr ? 'الحالة:' : 'Status:'} {ret.return_shipment.bosta_status || '—'}</p>
                                </div>
                            )}
                            <div className="flex flex-wrap gap-2">
                                {canShip && (
                                    <div className="w-full space-y-1.5">
                                        <button onClick={handleShip} disabled={busy}
                                            className="px-4 py-2.5 rounded-xl text-sm font-bold bg-cyan-500 text-white hover:bg-cyan-600 disabled:opacity-50 transition-colors">
                                            {isAr ? 'إنشاء شحنة إرجاع' : 'Create Return Shipment'}
                                        </button>
                                        <p className="text-xs text-zinc-400">
                                            {isAr
                                                ? 'يتم إنشاء شحنة الإرجاع تلقائياً عند موافقة البائع والإدارة. استخدم هذا الزر فقط إذا لم يتم إنشاؤها تلقائياً.'
                                                : 'The return shipment is created automatically once both the vendor and admin approve. Use this button only if it was not created automatically.'}
                                        </p>
                                    </div>
                                )}
                                {canConfirmReceipt && (
                                    <button onClick={handleConfirmReceipt} disabled={busy}
                                        className="px-4 py-2.5 rounded-xl text-sm font-bold bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50 transition-colors">
                                        {isAr ? 'تأكيد الاستلام' : 'Confirm Receipt'}
                                    </button>
                                )}
                                {ret.return_shipment?.bosta_tracking_number && (
                                    <button onClick={handleRefreshTracking} disabled={busy}
                                        className="px-4 py-2.5 rounded-xl text-sm font-bold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5 disabled:opacity-50 transition-colors flex items-center gap-2">
                                        <RefreshCw size={14} /> {isAr ? 'تحديث التتبع' : 'Refresh'}
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Create Refund */}
                    {canCreateRefund && (
                        <div className="bg-white dark:bg-[#14171A] border border-emerald-200 dark:border-emerald-500/20 rounded-2xl p-5">
                            <h2 className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mb-4">{isAr ? 'إنشاء استرداد' : 'Create Refund'}</h2>
                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1 block">{isAr ? 'رسوم إعادة التخزين (ج.م)' : 'Restocking Fee (EGP)'}</label>
                                    <input type="number" min="0" step="0.01" value={restockingFee} onChange={(e) => setRestockingFee(e.target.value)}
                                        className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl text-sm text-zinc-900 dark:text-white" />
                                </div>
                                {/* Destination. Preselected to match how the
                                    customer paid — the choice the admin makes
                                    in almost every case — but never forced. */}
                                <div>
                                    <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1 block">
                                        {isAr ? 'وجهة الاسترداد' : 'Refund destination'}
                                    </label>
                                    <select
                                        value={refundMethod || ret.default_refund_method || ''}
                                        onChange={(e) => setRefundMethod(e.target.value)}
                                        className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl text-sm text-zinc-900 dark:text-white"
                                    >
                                        {ret.original_payment_method === 'company_account' ? (
                                            // The company paid; the refund is the company's. No other destination is honest.
                                            <option value="company_account">{isAr ? 'حساب الجهة — شركة/هيئة/مدرسة/عقار (والفرق لمحفظة العميل) — فوري' : 'The company account (and the difference to the employee wallet) — instant'}</option>
                                        ) : (
                                            <>
                                                <option value="store_credit">{isAr ? 'رصيد في محفظة العميل — فوري' : "Customer's wallet — instant"}</option>
                                                {ret.original_payment_method === 'credit_card' && (
                                                    <option value="original_payment">{isAr ? 'استرداد على الكارت — يدوي عبر فواترك' : 'Back to the card — manual via Fawaterak'}</option>
                                                )}
                                                <option value="bank_transfer">{isAr ? 'تحويل بنكي — يدوي' : 'Bank transfer — manual'}</option>
                                            </>
                                        )}
                                    </select>
                                    <p className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">
                                        {isAr
                                            ? `دفع العميل بـ ${paymentMethodLabel(ret.original_payment_method, true)}. الاسترداد اليدوي يفضل «قيد التنفيذ» لحد ما تنفّذه وتأكّده.`
                                            : `The customer paid by ${paymentMethodLabel(ret.original_payment_method, false)}. A manual refund stays in "processing" until you carry it out and confirm it.`}
                                    </p>
                                </div>

                                <textarea value={refundNotes} onChange={(e) => setRefundNotes(e.target.value)}
                                    placeholder={isAr ? 'ملاحظات (اختياري)' : 'Notes (optional)'}
                                    rows={2}
                                    className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl text-sm text-zinc-900 dark:text-white resize-none" />
                                <button onClick={handleCreateRefund} disabled={busy}
                                    className="w-full py-2.5 rounded-xl text-sm font-bold bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors">
                                    {busy ? <Loader2 size={16} className="animate-spin mx-auto" /> : (isAr ? 'إنشاء الاسترداد' : 'Create Refund')}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Refund Link */}
                    {ret.refund_id && (
                        <Link href={`/admin/dashboard/refunds/${ret.refund_id}`}
                            className="block bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 text-sm font-bold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors">
                            {isAr ? 'عرض تفاصيل الاسترداد ←' : 'View Refund Details →'}
                        </Link>
                    )}

                    {/* History Timeline */}
                    {ret.history?.length > 0 && (
                        <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                            <h2 className="text-sm font-bold text-zinc-900 dark:text-white mb-4 flex items-center gap-2">
                                <Clock size={16} /> {isAr ? 'سجل الأحداث' : 'History'}
                            </h2>
                            <div className="space-y-4">
                                {[...ret.history].reverse().map((h, i) => (
                                    <div key={i} className="flex gap-3">
                                        <div className="w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-600 mt-2 shrink-0" />
                                        <div>
                                            <p className="text-sm font-bold text-zinc-900 dark:text-white">{h.title}</p>
                                            {h.details && <p className="text-xs text-zinc-500 mt-0.5">{h.details}</p>}
                                            <p className="text-[10px] text-zinc-400 mt-1">
                                                {new Date(h.created_at).toLocaleString(isAr ? 'ar-u-ca-gregory' : 'en-US')}
                                                {h.actor_label && ` · ${h.actor_label}`}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Sidebar Info */}
                <div className="space-y-6">
                    {/* Customer Info */}
                    <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                        <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">{isAr ? 'العميل' : 'Customer'}</h3>
                        <p className="text-sm font-bold text-zinc-900 dark:text-white">{ret.user_id?.name || '—'}</p>
                        <p className="text-xs text-zinc-500 mt-1">{ret.user_id?.email}</p>
                        {ret.user_id?.phone && <p className="text-xs text-zinc-500">{ret.user_id.phone}</p>}
                    </div>

                    {/* Vendor Info */}
                    <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                        <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">{isAr ? 'البائع' : 'Vendor'}</h3>
                        <p className="text-sm font-bold text-zinc-900 dark:text-white">{ret.vendor_id?.store_name || ret.vendor_id?.name || '—'}</p>
                        <p className="text-xs text-zinc-500 mt-1">{ret.vendor_id?.email}</p>
                    </div>

                    {/* Order Link */}
                    <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                        <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">{isAr ? 'الطلب' : 'Order'}</h3>
                        <Link href={`/admin/dashboard/orders/${ret.order_id}`} className="text-sm font-bold text-marine-primary hover:underline">
                            {isAr ? 'عرض الطلب ←' : 'View Order →'}
                        </Link>
                    </div>

                    {/* Fault Type */}
                    <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                        <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">{isAr ? 'نوع الخطأ' : 'Fault Type'}</h3>
                        <p className={`text-sm font-bold ${effectiveFaultType === 'vendor_fault' ? 'text-red-500' : effectiveFaultType === 'customer_fault' ? 'text-amber-500' : 'text-zinc-400'}`}>
                            {effectiveFaultType === 'vendor_fault' ? (isAr ? 'خطأ البائع' : 'Vendor Fault')
                                : effectiveFaultType === 'customer_fault' ? (isAr ? 'خطأ العميل' : 'Customer Fault')
                                : (isAr ? 'غير محدد' : 'Undetermined')}
                        </p>
                    </div>

                    {/* Return Window */}
                    <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                        <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">{isAr ? 'نافذة الإرجاع' : 'Return Window'}</h3>
                        <p className="text-sm text-zinc-600 dark:text-zinc-300">
                            {isAr ? 'حتى' : 'Until'}: {ret.return_window_deadline ? new Date(ret.return_window_deadline).toLocaleDateString(isAr ? 'ar-u-ca-gregory' : 'en-US') : '—'}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
