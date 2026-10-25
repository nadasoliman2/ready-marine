'use client';

import { useEffect, useState } from 'react';
import Link from '../../../components/LocaleLink';
import { useRouter } from '../../../lib/navigation';
import { useApp } from '../../../context/AppContext';
import { returnsApi } from '../../../lib/api';
import { RotateCcw, Loader2, ChevronLeft, ChevronRight, Package, ArrowLeft } from 'lucide-react';

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
    pending_vendor_review: { en: 'Pending Review', ar: 'بانتظار المراجعة' },
    vendor_approved: { en: 'Vendor Approved', ar: 'وافق البائع' },
    vendor_rejected: { en: 'Vendor Rejected', ar: 'رفض البائع' },
    pending_admin_review: { en: 'Under Review', ar: 'قيد المراجعة' },
    approved: { en: 'Approved', ar: 'موافق عليه' },
    rejected: { en: 'Rejected', ar: 'مرفوض' },
    return_shipping: { en: 'Shipping', ar: 'الشحن' },
    return_received: { en: 'Received', ar: 'تم الاستلام' },
    refund_processing: { en: 'Refund Processing', ar: 'جاري الاسترداد' },
    completed: { en: 'Completed', ar: 'مكتمل' },
    cancelled: { en: 'Cancelled', ar: 'ملغى' },
};

const REASON_LABELS = {
    defective: { en: 'Defective', ar: 'معيب' },
    wrong_item: { en: 'Wrong Item', ar: 'منتج خاطئ' },
    not_as_described: { en: 'Not as Described', ar: 'غير مطابق' },
    changed_mind: { en: 'Changed Mind', ar: 'تغيير رأي' },
    other: { en: 'Other', ar: 'أخرى' },
};

export default function UserReturnsPage() {
    const { language, user, isMounted } = useApp();
    const isAr = language === 'ar';
    const router = useRouter();

    const [returns, setReturns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [pagination, setPagination] = useState({ total: 0, pages: 1 });

    useEffect(() => {
        if (isMounted && !user) router.push('/login');
    }, [isMounted, user]);

    useEffect(() => { if (user) loadReturns(); }, [page, user]);

    const loadReturns = async () => {
        try {
            setLoading(true);
            const data = await returnsApi.getAll({ page, limit: 20 });
            setReturns(data.returns || []);
            setPagination(data.pagination || { total: 0, pages: 1 });
        } catch (_) {
        } finally {
            setLoading(false);
        }
    };

    if (!isMounted || !user) {
        return <div className="min-h-screen flex items-center justify-center bg-[#0E1012]"><Loader2 size={32} className="animate-spin text-marine-primary" /></div>;
    }

    return (
        <div className="min-h-screen bg-[#0E1012] text-white" dir={isAr ? 'rtl' : 'ltr'}>
            <div className="max-w-3xl mx-auto px-4 py-8">
                {/* Header */}
                <div className="flex items-center gap-4 mb-8">
                    <Link href="/profile?tab=orders" className="p-2 rounded-xl border border-white/10 hover:bg-white/5 transition-colors">
                        <ArrowLeft size={18} className={isAr ? 'rotate-180' : ''} />
                    </Link>
                    <div>
                        <h1 className="text-2xl font-black flex items-center gap-3">
                            <RotateCcw size={22} className="text-marine-primary" />
                            {isAr ? 'طلبات الإرجاع' : 'My Returns'}
                        </h1>
                        <p className="text-sm text-zinc-500 mt-1">{isAr ? `${pagination.total} طلب` : `${pagination.total} requests`}</p>
                    </div>
                </div>

                {/* List */}
                {loading ? (
                    <div className="py-16 text-center"><Loader2 size={28} className="animate-spin text-marine-primary mx-auto" /></div>
                ) : returns.length === 0 ? (
                    <div className="py-16 text-center bg-white/5 border border-white/10 rounded-2xl">
                        <RotateCcw size={36} className="mx-auto text-zinc-600 mb-3" />
                        <p className="text-zinc-400 font-semibold">{isAr ? 'لا توجد طلبات إرجاع' : 'No return requests yet'}</p>
                        <Link href="/profile?tab=orders" className="text-marine-primary mt-2 inline-block hover:underline font-bold text-sm">
                            {isAr ? 'العودة لحسابي' : 'Back to my account'}
                        </Link>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {returns.map((ret) => (
                            <Link key={ret._id} href={`/profile/returns/${ret._id}`}
                                className="block bg-white/5 border border-white/10 rounded-2xl p-4 hover:bg-white/[0.07] transition-colors">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                                        <Package size={20} className="text-zinc-500" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-sm font-bold text-white">{ret.return_number}</span>
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest ${STATUS_COLORS[ret.status]}`}>
                                                {STATUS_LABELS[ret.status]?.[isAr ? 'ar' : 'en']}
                                            </span>
                                        </div>
                                        <p className="text-xs text-zinc-500 mt-1">
                                            {REASON_LABELS[ret.reason]?.[isAr ? 'ar' : 'en']} · {ret.items?.length || 0} {isAr ? 'منتج' : 'item(s)'}
                                            {ret.vendor_id?.store_name ? ` · ${ret.vendor_id.store_name}` : ''}
                                        </p>
                                    </div>
                                    <div className="text-end shrink-0">
                                        <p className="text-xs text-zinc-500">
                                            {new Date(ret.created_at).toLocaleDateString(isAr ? 'ar-u-ca-gregory' : 'en-US', { month: 'short', day: 'numeric' })}
                                        </p>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}

                {/* Pagination */}
                {pagination.pages > 1 && (
                    <div className="flex items-center justify-between mt-6">
                        <span className="text-xs text-zinc-500">{isAr ? `صفحة ${page} من ${pagination.pages}` : `Page ${page} of ${pagination.pages}`}</span>
                        <div className="flex gap-2">
                            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                                className="p-2 rounded-lg border border-white/10 disabled:opacity-30 hover:bg-white/5"><ChevronLeft size={16} /></button>
                            <button onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page >= pagination.pages}
                                className="p-2 rounded-lg border border-white/10 disabled:opacity-30 hover:bg-white/5"><ChevronRight size={16} /></button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
