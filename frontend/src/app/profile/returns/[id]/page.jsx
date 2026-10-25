'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from '../../../../lib/navigation';
import Link from '../../../../components/LocaleLink';
import { useApp } from '../../../../context/AppContext';
import { returnsApi } from '../../../../lib/api';
import { ArrowLeft, RotateCcw, CheckCircle2, Package, Clock, Loader2, Truck, Image as ImageIcon } from 'lucide-react';

const STATUS_COLORS = {
    pending_vendor_review: 'bg-amber-500/20 text-amber-400',
    vendor_approved: 'bg-blue-500/20 text-blue-400',
    vendor_rejected: 'bg-orange-500/20 text-orange-400',
    pending_admin_review: 'bg-violet-500/20 text-violet-400',
    approved: 'bg-emerald-500/20 text-emerald-400',
    rejected: 'bg-red-500/20 text-red-400',
    return_shipping: 'bg-cyan-500/20 text-cyan-400',
    return_received: 'bg-indigo-500/20 text-indigo-400',
    refund_processing: 'bg-yellow-500/20 text-yellow-400',
    completed: 'bg-emerald-500/20 text-emerald-400',
    cancelled: 'bg-zinc-500/20 text-zinc-400',
};

const STATUS_LABELS = {
    pending_vendor_review: { en: 'Pending Vendor Review', ar: 'بانتظار مراجعة البائع' },
    vendor_approved: { en: 'Vendor Approved', ar: 'وافق البائع' },
    vendor_rejected: { en: 'Vendor Rejected', ar: 'رفض البائع' },
    pending_admin_review: { en: 'Under Review', ar: 'قيد المراجعة' },
    approved: { en: 'Approved', ar: 'موافق عليه' },
    rejected: { en: 'Rejected', ar: 'مرفوض' },
    return_shipping: { en: 'Return Shipping', ar: 'شحن الإرجاع' },
    return_received: { en: 'Items Received', ar: 'تم استلام المنتجات' },
    refund_processing: { en: 'Refund Processing', ar: 'جاري معالجة الاسترداد' },
    completed: { en: 'Refund Completed', ar: 'تم الاسترداد' },
    cancelled: { en: 'Cancelled', ar: 'ملغى' },
};

const REASON_LABELS = {
    defective: { en: 'Defective Product', ar: 'منتج معيب' },
    wrong_item: { en: 'Wrong Item', ar: 'منتج خاطئ' },
    not_as_described: { en: 'Not as Described', ar: 'غير مطابق للوصف' },
    changed_mind: { en: 'Changed Mind', ar: 'تغيير رأي' },
    other: { en: 'Other', ar: 'أخرى' },
};

export default function UserReturnDetailPage() {
    const { id } = useParams();
    const router = useRouter();
    const { language, user, isMounted } = useApp();
    const isAr = language === 'ar';

    const [ret, setRet] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [actionMsg, setActionMsg] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (isMounted && !user) router.push('/login');
    }, [isMounted, user]);

    const showMsg = (msg) => { setActionMsg(msg); setTimeout(() => setActionMsg(''), 4000); };

    const loadReturn = useCallback(async () => {
        try {
            setLoading(true);
            const data = await returnsApi.getById(id);
            setRet(data.return_request);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => { if (user) loadReturn(); }, [loadReturn, user]);

    const handleCancel = async () => {
        if (!confirm(isAr ? 'هل تريد إلغاء طلب الإرجاع؟' : 'Cancel this return request?')) return;
        try {
            setBusy(true);
            await returnsApi.cancel(id);
            showMsg(isAr ? 'تم الإلغاء' : 'Return cancelled');
            await loadReturn();
        } catch (err) { alert(err.message); } finally { setBusy(false); }
    };

    if (!isMounted || !user) return <div className="min-h-screen flex items-center justify-center bg-[#0E1012]"><Loader2 size={32} className="animate-spin text-marine-primary" /></div>;
    if (loading) return <div className="min-h-screen flex items-center justify-center bg-[#0E1012]"><Loader2 size={32} className="animate-spin text-marine-primary" /></div>;
    if (error || !ret) return <div className="min-h-screen bg-[#0E1012] p-8"><div className="max-w-3xl mx-auto bg-red-500/10 border border-red-500/20 text-red-400 p-6 rounded-xl">{error || 'Not found'}</div></div>;

    const canCancel = ret.status === 'pending_vendor_review';

    return (
        <div className="min-h-screen bg-[#0E1012] text-white" dir={isAr ? 'rtl' : 'ltr'}>
            <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
                {/* Toast */}
                {actionMsg && (
                    <div className="fixed top-6 end-6 z-[100] bg-emerald-500 text-white px-5 py-3 rounded-xl font-bold shadow-xl flex items-center gap-2">
                        <CheckCircle2 size={16} /> {actionMsg}
                    </div>
                )}

                {/* Header */}
                <div className="flex items-center gap-4">
                    <Link href="/profile/returns" className="p-2 rounded-xl border border-white/10 hover:bg-white/5 transition-colors">
                        <ArrowLeft size={18} className={isAr ? 'rotate-180' : ''} />
                    </Link>
                    <div className="flex-1">
                        <h1 className="text-xl font-black flex items-center gap-2">
                            <RotateCcw size={20} className="text-marine-primary" /> {ret.return_number}
                        </h1>
                        <p className="text-sm text-zinc-500 mt-0.5">{REASON_LABELS[ret.reason]?.[isAr ? 'ar' : 'en']}</p>
                    </div>
                    <span className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest ${STATUS_COLORS[ret.status]}`}>
                        {STATUS_LABELS[ret.status]?.[isAr ? 'ar' : 'en']}
                    </span>
                </div>

                {/* Items */}
                <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                    <h2 className="text-sm font-bold mb-4 flex items-center gap-2"><Package size={16} className="text-marine-primary" /> {isAr ? 'المنتجات' : 'Items'}</h2>
                    <div className="space-y-3">
                        {ret.items?.map((item, i) => (
                            <div key={i} className="flex items-center gap-4 p-3 bg-white/5 rounded-xl">
                                {item.product_image ? (
                                    <img src={item.product_image} alt="" className="w-12 h-12 rounded-lg object-cover border border-white/10" />
                                ) : (
                                    <div className="w-12 h-12 rounded-lg bg-white/5 flex items-center justify-center"><Package size={18} className="text-zinc-500" /></div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold truncate">{item.product_title}</p>
                                    {item.variant_label && <p className="text-xs text-zinc-500">{item.variant_label}</p>}
                                </div>
                                <div className="text-end">
                                    <p className="text-sm font-bold">{item.quantity_returning} x {item.unit_price} {isAr ? 'ج.م' : 'EGP'}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Evidence */}
                {ret.evidence?.length > 0 && (
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                        <h2 className="text-sm font-bold mb-4 flex items-center gap-2"><ImageIcon size={16} className="text-marine-primary" /> {isAr ? 'الصور المرفقة' : 'Evidence'}</h2>
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                            {ret.evidence.map((ev, i) => (
                                <a key={i} href={ev.url} target="_blank" rel="noopener noreferrer">
                                    <img src={ev.url} alt="" className="w-full h-20 rounded-xl object-cover border border-white/10 hover:opacity-80 transition-opacity" />
                                </a>
                            ))}
                        </div>
                    </div>
                )}

                {/* Reason Details */}
                {ret.reason_details && (
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                        <h2 className="text-sm font-bold mb-2">{isAr ? 'التفاصيل' : 'Details'}</h2>
                        <p className="text-sm text-zinc-400">{ret.reason_details}</p>
                    </div>
                )}

                {/* Return Shipment Tracking */}
                {ret.return_shipment?.bosta_tracking_number && (
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                        <h2 className="text-sm font-bold mb-3 flex items-center gap-2"><Truck size={16} className="text-marine-primary" /> {isAr ? 'تتبع شحنة الإرجاع' : 'Return Shipment'}</h2>
                        <div className="p-3 bg-white/5 rounded-xl">
                            <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">{isAr ? 'رقم التتبع' : 'Tracking Number'}</p>
                            <p className="text-sm font-bold font-mono">{ret.return_shipment.bosta_tracking_number}</p>
                            <p className="text-xs text-zinc-500 mt-1">{isAr ? 'الحالة:' : 'Status:'} {ret.return_shipment.bosta_status || '—'}</p>
                        </div>
                        {ret.return_shipment.tracking_history?.length > 0 && (
                            <div className="mt-4 space-y-2">
                                {ret.return_shipment.tracking_history.map((th, i) => (
                                    <div key={i} className="flex gap-3 text-xs">
                                        <div className="w-1.5 h-1.5 rounded-full bg-marine-cyan mt-1.5 shrink-0" />
                                        <div>
                                            <span className="font-bold text-zinc-300">{th.state}</span>
                                            <span className="text-zinc-500 ms-2">{new Date(th.timestamp).toLocaleString(isAr ? 'ar-u-ca-gregory' : 'en-US')}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Cancel Button */}
                {canCancel && (
                    <button onClick={handleCancel} disabled={busy}
                        className="w-full py-3 rounded-xl text-sm font-bold border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition-colors">
                        {busy ? <Loader2 size={16} className="animate-spin mx-auto" /> : (isAr ? 'إلغاء طلب الإرجاع' : 'Cancel Return Request')}
                    </button>
                )}

                {/* History */}
                {ret.history?.length > 0 && (
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                        <h2 className="text-sm font-bold mb-4 flex items-center gap-2"><Clock size={16} className="text-marine-primary" /> {isAr ? 'سجل الأحداث' : 'Timeline'}</h2>
                        <div className="space-y-3">
                            {[...ret.history].reverse().map((h, i) => (
                                <div key={i} className="flex gap-3">
                                    <div className="w-2 h-2 rounded-full bg-marine-cyan/50 mt-2 shrink-0" />
                                    <div>
                                        <p className="text-sm font-bold">{h.title}</p>
                                        {h.details && <p className="text-xs text-zinc-500 mt-0.5">{h.details}</p>}
                                        <p className="text-[10px] text-zinc-600 mt-1">
                                            {new Date(h.created_at).toLocaleString(isAr ? 'ar-u-ca-gregory' : 'en-US')}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
