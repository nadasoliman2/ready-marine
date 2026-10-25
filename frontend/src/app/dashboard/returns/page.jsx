'use client';

import { useEffect, useState } from 'react';
import Link from '../../../components/LocaleLink';
import { useApp } from '../../../context/AppContext';
import { vendorReturnsApi } from '../../../lib/api';
import { RotateCcw, Loader2, ChevronLeft, ChevronRight, Eye, Package } from 'lucide-react';

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
    pending_vendor_review: { en: 'Pending Review', ar: 'بانتظار المراجعة' },
    vendor_approved: { en: 'Approved', ar: 'موافق عليه' },
    vendor_rejected: { en: 'Rejected', ar: 'مرفوض' },
    pending_admin_review: { en: 'Pending Admin', ar: 'بانتظار الإدارة' },
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

export default function ReturnsListPage() {
    const { language } = useApp();
    const isAr = language === 'ar';

    const [returns, setReturns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('');
    const [page, setPage] = useState(1);
    const [pagination, setPagination] = useState({ total: 0, pages: 1 });
    const [counts, setCounts] = useState({});

    useEffect(() => { loadReturns(); }, [page, statusFilter]);
    useEffect(() => { loadCounts(); }, []);

    const loadReturns = async () => {
        try {
            setLoading(true);
            const data = await vendorReturnsApi.getAll({ page, limit: 20, status: statusFilter });
            setReturns(data.returns || []);
            setPagination(data.pagination || { total: 0, pages: 1 });
        } catch (_) {
        } finally {
            setLoading(false);
        }
    };

    const loadCounts = async () => {
        try {
            const data = await vendorReturnsApi.getCounts();
            setCounts(data.counts || {});
        } catch (_) {}
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                    <h1 className="text-2xl font-black text-zinc-900 dark:text-white flex items-center gap-3">
                        <RotateCcw size={22} />
                        {isAr ? 'طلبات الإرجاع' : 'Return Requests'}
                    </h1>
                    <p className="text-sm text-zinc-500 mt-1">{isAr ? `${pagination.total} طلب` : `${pagination.total} requests`}</p>
                </div>
            </div>

            {/* Vendor counts */}
            {counts.pending_vendor_review > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-sm font-bold text-amber-600 dark:text-amber-400">
                    {isAr ? `لديك ${counts.pending_vendor_review} طلب إرجاع بانتظار مراجعتك` : `You have ${counts.pending_vendor_review} return request(s) pending your review`}
                </div>
            )}

            {/* Filter */}
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                className="px-3 py-2.5 bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl text-sm text-zinc-900 dark:text-white">
                <option value="">{isAr ? 'كل الحالات' : 'All Statuses'}</option>
                {Object.keys(STATUS_LABELS).map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s][isAr ? 'ar' : 'en']}</option>
                ))}
            </select>

            {/* List */}
            {loading ? (
                <div className="py-16 text-center"><Loader2 size={28} className="animate-spin text-marine-primary mx-auto" /></div>
            ) : returns.length === 0 ? (
                <div className="py-16 text-center bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl">
                    <RotateCcw size={36} className="mx-auto text-zinc-200 dark:text-zinc-700 mb-3" />
                    <p className="text-zinc-500 font-semibold">{isAr ? 'لا توجد طلبات إرجاع' : 'No return requests'}</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {returns.map((ret) => (
                        <Link key={ret._id} href={`/dashboard/returns/${ret._id}`}
                            className="block bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-4 hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-xl bg-zinc-100 dark:bg-[#0E1012] flex items-center justify-center shrink-0">
                                    <Package size={20} className="text-zinc-400" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-sm font-bold text-zinc-900 dark:text-white">{ret.return_number}</span>
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest ${STATUS_COLORS[ret.status]}`}>
                                            {STATUS_LABELS[ret.status]?.[isAr ? 'ar' : 'en']}
                                        </span>
                                    </div>
                                    <p className="text-xs text-zinc-500 mt-1">
                                        {REASON_LABELS[ret.reason]?.[isAr ? 'ar' : 'en']} · {ret.items?.length || 0} {isAr ? 'منتج' : 'item(s)'}
                                        {ret.user_id?.name ? ` · ${ret.user_id.name}` : ''}
                                    </p>
                                </div>
                                <div className="text-end shrink-0">
                                    <p className="text-xs text-zinc-400">
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
                <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500">{isAr ? `صفحة ${page} من ${pagination.pages}` : `Page ${page} of ${pagination.pages}`}</span>
                    <div className="flex gap-2">
                        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                            className="p-2 rounded-lg border border-zinc-200 dark:border-white/10 disabled:opacity-30 hover:bg-zinc-50 dark:hover:bg-white/5"><ChevronLeft size={16} /></button>
                        <button onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page >= pagination.pages}
                            className="p-2 rounded-lg border border-zinc-200 dark:border-white/10 disabled:opacity-30 hover:bg-zinc-50 dark:hover:bg-white/5"><ChevronRight size={16} /></button>
                    </div>
                </div>
            )}
        </div>
    );
}
