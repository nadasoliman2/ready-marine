'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from '../../../../../lib/navigation';
import Link from '../../../../../components/LocaleLink';
import { useApp } from '../../../../../context/AppContext';
import { adminReturnsApi } from '../../../../../lib/api';
import { ArrowLeft, DollarSign, CheckCircle2, Loader2, Clock, AlertTriangle } from 'lucide-react';

const STATUS_COLORS = {
    pending: 'bg-amber-500/20 text-amber-500',
    processing: 'bg-blue-500/20 text-blue-500',
    completed: 'bg-emerald-500/20 text-emerald-500',
    failed: 'bg-red-500/20 text-red-500',
};

export default function AdminRefundDetailPage() {
    const { id } = useParams();
    const router = useRouter();
    const { language } = useApp();
    const isAr = language === 'ar';

    const [refund, setRefund] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [actionMsg, setActionMsg] = useState('');
    const [busy, setBusy] = useState(false);

    // Complete form
    const [bankName, setBankName] = useState('');
    const [accountHolder, setAccountHolder] = useState('');
    const [accountNumber, setAccountNumber] = useState('');
    const [completeNotes, setCompleteNotes] = useState('');
    const [failReason, setFailReason] = useState('');

    const showMsg = (msg) => {
        setActionMsg(msg);
        setTimeout(() => setActionMsg(''), 4000);
    };

    const loadRefund = useCallback(async () => {
        try {
            setLoading(true);
            const data = await adminReturnsApi.getRefundById(id);
            setRefund(data.refund);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => { loadRefund(); }, [loadRefund]);

    const handleProcess = async () => {
        if (!confirm(isAr ? 'بدء معالجة الاسترداد؟' : 'Start processing refund?')) return;
        try {
            setBusy(true);
            await adminReturnsApi.processRefund(id);
            showMsg(isAr ? 'تم بدء المعالجة' : 'Processing started');
            await loadRefund();
        } catch (err) { alert(err.message); } finally { setBusy(false); }
    };

    const handleComplete = async () => {
        if (!confirm(isAr ? 'تأكيد إتمام الاسترداد؟' : 'Confirm refund completed?')) return;
        try {
            setBusy(true);
            await adminReturnsApi.completeRefund(id, {
                payment_details: {
                    bank_name: bankName || undefined,
                    account_holder: accountHolder || undefined,
                    account_number: accountNumber || undefined,
                    notes: completeNotes || undefined,
                },
            });
            showMsg(isAr ? 'تم إتمام الاسترداد' : 'Refund completed');
            await loadRefund();
        } catch (err) { alert(err.message); } finally { setBusy(false); }
    };

    const handleFail = async () => {
        if (!failReason.trim()) { alert(isAr ? 'يرجى إدخال سبب الفشل' : 'Please enter a failure reason'); return; }
        try {
            setBusy(true);
            await adminReturnsApi.failRefund(id, { failure_reason: failReason });
            showMsg(isAr ? 'تم تحديث الحالة' : 'Status updated');
            await loadRefund();
        } catch (err) { alert(err.message); } finally { setBusy(false); }
    };

    if (loading) return <div className="flex items-center justify-center py-32"><Loader2 size={32} className="animate-spin text-marine-primary" /></div>;
    if (error || !refund) return <div className="bg-red-500/10 border border-red-500/20 text-red-600 p-6 rounded-xl">{error || 'Not found'}</div>;

    return (
        <div className="space-y-6">
            {actionMsg && (
                <div className="fixed top-6 end-6 z-[100] bg-emerald-500 text-white px-5 py-3 rounded-xl font-bold shadow-xl flex items-center gap-2">
                    <CheckCircle2 size={16} /> {actionMsg}
                </div>
            )}

            {/* Header */}
            <div className="flex items-center gap-4">
                <button onClick={() => router.push('/admin/dashboard/refunds')} className="p-2 rounded-xl border border-zinc-200 dark:border-white/10 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                    <ArrowLeft size={18} className={isAr ? 'rotate-180' : ''} />
                </button>
                <div className="flex-1">
                    <h1 className="text-2xl font-black text-zinc-900 dark:text-white flex items-center gap-3">
                        <DollarSign size={22} /> {refund.refund_number}
                    </h1>
                </div>
                <span className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest ${STATUS_COLORS[refund.status]}`}>
                    {refund.status}
                </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    {/* Financial Breakdown */}
                    <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                        <h2 className="text-sm font-bold text-zinc-900 dark:text-white mb-4">{isAr ? 'تفاصيل الاسترداد' : 'Refund Breakdown'}</h2>
                        <div className="space-y-2 text-sm">
                            {refund.line_items?.map((item, i) => (
                                <div key={i} className="flex justify-between p-3 bg-zinc-50 dark:bg-[#0E1012] rounded-xl">
                                    <div>
                                        <p className="font-bold text-zinc-900 dark:text-white">{item.product_title}</p>
                                        <p className="text-xs text-zinc-500">{item.quantity} x {item.unit_price} {isAr ? 'ج.م' : 'EGP'}</p>
                                    </div>
                                    <p className="font-bold text-zinc-900 dark:text-white">{item.refund_amount.toFixed(2)} {isAr ? 'ج.م' : 'EGP'}</p>
                                </div>
                            ))}
                        </div>
                        <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-white/5 space-y-2 text-sm">
                            <div className="flex justify-between text-zinc-500">
                                <span>{isAr ? 'المجموع الفرعي' : 'Subtotal'}</span>
                                <span>{refund.subtotal?.toFixed(2)} {isAr ? 'ج.م' : 'EGP'}</span>
                            </div>
                            {refund.discount_reversal > 0 && (
                                <div className="flex justify-between text-zinc-500">
                                    <span>{isAr ? 'خصم الكوبون (معكوس)' : 'Coupon Discount (reversed)'}</span>
                                    <span>-{refund.discount_reversal?.toFixed(2)} {isAr ? 'ج.م' : 'EGP'}</span>
                                </div>
                            )}
                            {refund.shipping_refund > 0 && (
                                <div className="flex justify-between text-zinc-500">
                                    <span>{isAr ? 'استرداد الشحن' : 'Shipping Refund'}</span>
                                    <span>+{refund.shipping_refund?.toFixed(2)} {isAr ? 'ج.م' : 'EGP'}</span>
                                </div>
                            )}
                            {refund.restocking_fee > 0 && (
                                <div className="flex justify-between text-red-500">
                                    <span>{isAr ? 'رسوم إعادة التخزين' : 'Restocking Fee'}</span>
                                    <span>-{refund.restocking_fee?.toFixed(2)} {isAr ? 'ج.م' : 'EGP'}</span>
                                </div>
                            )}
                            <div className="flex justify-between font-black text-zinc-900 dark:text-white text-base pt-2 border-t border-zinc-100 dark:border-white/5">
                                <span>{isAr ? 'إجمالي الاسترداد' : 'Total Refund'}</span>
                                <span>{refund.total_refund_amount?.toFixed(2)} {isAr ? 'ج.م' : 'EGP'}</span>
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    {refund.status === 'pending' && (
                        <div className="bg-white dark:bg-[#14171A] border border-blue-200 dark:border-blue-500/20 rounded-2xl p-5">
                            <h2 className="text-sm font-bold text-blue-600 mb-3">
                                {refund.refund_method === 'store_credit'
                                    ? (isAr ? 'إضافة المبلغ إلى المحفظة' : 'Credit the wallet')
                                    : refund.refund_method === 'company_account'
                                        ? (isAr ? 'خصم من حساب الجهة' : 'Credit the organisation account')
                                        : (isAr ? 'بدء المعالجة' : 'Start Processing')}
                            </h2>
                            <p className="text-xs text-zinc-500 mb-4">
                                {/* Store credit needs no external step and no second
                                    click — one action moves the money and completes
                                    the refund, so the copy says exactly that. */}
                                {refund.refund_method === 'store_credit'
                                    ? (isAr
                                        ? 'سيُضاف المبلغ إلى محفظة العميل فوراً ويصبح جاهزاً للاستخدام، ويكتمل الاسترداد في نفس الخطوة. لا حاجة لأي إجراء خارجي.'
                                        : 'The amount is added to the customer’s wallet immediately and is ready to use. The refund completes in the same step — no external action needed.')
                                    : refund.refund_method === 'company_account'
                                        ? (isAr
                                            ? 'أوردر على حساب جهة (شركة / هيئة / مدرسة / عقار): نصيب الجهة بيتشال من فاتورتها ويرجع لليميت صاحب الأوردر، والجزء اللي دفعه بنفسه (لو فيه) بيرجع لمحفظته — بنفس نسبة الأوردر. بيكتمل في نفس الخطوة.'
                                            : "An organisation-account order (company / authority / school / property): its share comes off its invoice and back to the person's limit, and any part they paid themselves goes back to their wallet — in the order's proportion. Completes in this step.")
                                    : refund.refund_method === 'original_payment'
                                        ? (isAr ? 'قم بمعالجة الاسترداد من لوحة فوتارك ثم عُد لتأكيد الإتمام' : 'Process the refund from Fawaterak dashboard, then come back to confirm completion')
                                        : (isAr ? 'قم بالتحويل البنكي للعميل ثم عُد لتأكيد الإتمام' : 'Process bank transfer to customer, then come back to confirm completion')}
                            </p>
                            <button onClick={handleProcess} disabled={busy}
                                className="w-full py-2.5 rounded-xl text-sm font-bold bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors">
                                {busy ? <Loader2 size={16} className="animate-spin mx-auto" /> : (
                                    refund.refund_method === 'store_credit'
                                        ? (isAr ? 'إضافة إلى المحفظة وإتمام الاسترداد' : 'Credit wallet & complete refund')
                                        : refund.refund_method === 'company_account'
                                            ? (isAr ? 'خصم من حساب الجهة وإتمام الاسترداد' : 'Credit organisation account & complete')
                                            : (isAr ? 'بدء المعالجة' : 'Start Processing')
                                )}
                            </button>
                        </div>
                    )}

                    {refund.status === 'processing' && (
                        <div className="bg-white dark:bg-[#14171A] border border-emerald-200 dark:border-emerald-500/20 rounded-2xl p-5 space-y-4">
                            <h2 className="text-sm font-bold text-emerald-600 mb-2">{isAr ? 'إتمام الاسترداد' : 'Complete Refund'}</h2>
                            {refund.refund_method === 'bank_transfer' && (
                                <div className="space-y-3">
                                    <input type="text" value={bankName} onChange={(e) => setBankName(e.target.value)}
                                        placeholder={isAr ? 'اسم البنك' : 'Bank Name'}
                                        className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl text-sm text-zinc-900 dark:text-white" />
                                    <input type="text" value={accountHolder} onChange={(e) => setAccountHolder(e.target.value)}
                                        placeholder={isAr ? 'اسم صاحب الحساب' : 'Account Holder'}
                                        className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl text-sm text-zinc-900 dark:text-white" />
                                    <input type="text" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)}
                                        placeholder={isAr ? 'رقم الحساب' : 'Account Number'}
                                        className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl text-sm text-zinc-900 dark:text-white" />
                                </div>
                            )}
                            <textarea value={completeNotes} onChange={(e) => setCompleteNotes(e.target.value)}
                                placeholder={isAr ? 'ملاحظات (اختياري)' : 'Notes (optional)'} rows={2}
                                className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl text-sm text-zinc-900 dark:text-white resize-none" />
                            <div className="flex gap-3">
                                <button onClick={handleComplete} disabled={busy}
                                    className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors">
                                    {busy ? <Loader2 size={16} className="animate-spin mx-auto" /> : (isAr ? 'تأكيد الإتمام' : 'Confirm Completed')}
                                </button>
                                <button onClick={() => document.getElementById('fail-section')?.scrollIntoView({ behavior: 'smooth' })}
                                    className="px-4 py-2.5 rounded-xl text-sm font-bold border border-red-200 dark:border-red-500/20 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">
                                    {isAr ? 'فشل' : 'Failed'}
                                </button>
                            </div>

                            <div id="fail-section" className="pt-4 border-t border-zinc-100 dark:border-white/5">
                                <h3 className="text-sm font-bold text-red-500 mb-2 flex items-center gap-2"><AlertTriangle size={14} /> {isAr ? 'تحديد كفشل' : 'Mark as Failed'}</h3>
                                <textarea value={failReason} onChange={(e) => setFailReason(e.target.value)}
                                    placeholder={isAr ? 'سبب الفشل...' : 'Failure reason...'} rows={2}
                                    className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-[#0E1012] border border-red-200 dark:border-red-500/20 rounded-xl text-sm text-zinc-900 dark:text-white resize-none mb-3" />
                                <button onClick={handleFail} disabled={busy}
                                    className="w-full py-2.5 rounded-xl text-sm font-bold bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors">
                                    {isAr ? 'تحديد كفشل' : 'Mark as Failed'}
                                </button>
                            </div>
                        </div>
                    )}

                    {refund.status === 'failed' && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-5">
                            <h2 className="text-sm font-bold text-red-600 mb-2 flex items-center gap-2"><AlertTriangle size={16} /> {isAr ? 'فشل الاسترداد' : 'Refund Failed'}</h2>
                            <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-4">{isAr ? 'يمكنك إعادة المحاولة' : 'You can retry processing'}</p>
                            <button onClick={handleProcess} disabled={busy}
                                className="px-4 py-2.5 rounded-xl text-sm font-bold bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors">
                                {isAr ? 'إعادة المعالجة' : 'Retry Processing'}
                            </button>
                        </div>
                    )}

                    {/* History */}
                    {refund.history?.length > 0 && (
                        <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                            <h2 className="text-sm font-bold text-zinc-900 dark:text-white mb-4 flex items-center gap-2"><Clock size={16} /> {isAr ? 'السجل' : 'History'}</h2>
                            <div className="space-y-4">
                                {[...refund.history].reverse().map((h, i) => (
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

                {/* Sidebar */}
                <div className="space-y-6">
                    <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                        <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">{isAr ? 'طريقة الاسترداد' : 'Refund Method'}</h3>
                        <p className="text-sm font-bold text-zinc-900 dark:text-white capitalize">{refund.refund_method?.replace('_', ' ')}</p>
                        <p className="text-xs text-zinc-500 mt-1">{isAr ? 'الدفع الأصلي:' : 'Original:'} {refund.original_payment_method?.replace('_', ' ')}</p>
                    </div>
                    <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                        <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">{isAr ? 'نوع الخطأ' : 'Fault Type'}</h3>
                        <p className={`text-sm font-bold ${refund.fault_type === 'vendor_fault' ? 'text-red-500' : 'text-amber-500'}`}>
                            {refund.fault_type === 'vendor_fault' ? (isAr ? 'خطأ البائع' : 'Vendor Fault') : (isAr ? 'خطأ العميل' : 'Customer Fault')}
                        </p>
                    </div>
                    <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                        <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">{isAr ? 'عكس العمولة' : 'Commission Reversal'}</h3>
                        <p className="text-sm font-bold text-zinc-900 dark:text-white">{refund.total_commission_reversal?.toFixed(2)} {isAr ? 'ج.م' : 'EGP'}</p>
                    </div>
                    {refund.return_request_id && (
                        <Link href={`/admin/dashboard/returns/${typeof refund.return_request_id === 'object' ? refund.return_request_id._id : refund.return_request_id}`}
                            className="block bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5 hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors">
                            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">{isAr ? 'طلب الإرجاع' : 'Return Request'}</h3>
                            <p className="text-sm font-bold text-marine-primary">{refund.return_request_id?.return_number || (isAr ? 'عرض ←' : 'View →')}</p>
                        </Link>
                    )}
                    <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                        <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">{isAr ? 'العميل' : 'Customer'}</h3>
                        <p className="text-sm font-bold text-zinc-900 dark:text-white">{refund.user_id?.name || '—'}</p>
                        <p className="text-xs text-zinc-500 mt-1">{refund.user_id?.email}</p>
                    </div>
                    <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
                        <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">{isAr ? 'البائع' : 'Vendor'}</h3>
                        <p className="text-sm font-bold text-zinc-900 dark:text-white">{refund.vendor_id?.store_name || '—'}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
