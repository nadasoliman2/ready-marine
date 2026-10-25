'use client';

import { useEffect, useState } from 'react';
import Link from '../../../../components/LocaleLink';
import { useApp } from '../../../../context/AppContext';
import { adminReturnsApi } from '../../../../lib/api';
import { DollarSign, Loader2, ChevronLeft, ChevronRight, Eye, ArrowLeft } from 'lucide-react';
import useRowLink from '../../../../lib/useRowLink';

const STATUS_COLORS = {
    pending: 'bg-amber-500/20 text-amber-500',
    processing: 'bg-blue-500/20 text-blue-500',
    completed: 'bg-emerald-500/20 text-emerald-500',
    failed: 'bg-red-500/20 text-red-500',
};

const STATUS_LABELS = {
    pending: { en: 'Pending', ar: 'معلق' },
    processing: { en: 'Processing', ar: 'قيد المعالجة' },
    completed: { en: 'Completed', ar: 'مكتمل' },
    failed: { en: 'Failed', ar: 'فشل' },
};

export default function AdminRefundsPage() {
    const rowLink = useRowLink();
    const { language } = useApp();
    const isAr = language === 'ar';

    const [refunds, setRefunds] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('');
    const [page, setPage] = useState(1);
    const [pagination, setPagination] = useState({ total: 0, pages: 1 });
    const limit = 20;

    useEffect(() => {
        loadRefunds();
    }, [page, statusFilter]);

    const loadRefunds = async () => {
        try {
            setLoading(true);
            const data = await adminReturnsApi.getRefunds({ page, limit, status: statusFilter });
            setRefunds(data.refunds || []);
            setPagination(data.pagination || { total: 0, pages: 1 });
        } catch (_) {
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Link href="/admin/dashboard/returns" className="p-2 rounded-xl border border-zinc-200 dark:border-white/10 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                    <ArrowLeft size={18} className={isAr ? 'rotate-180' : ''} />
                </Link>
                <div>
                    <h1 className="text-2xl font-black text-zinc-900 dark:text-white flex items-center gap-3">
                        <DollarSign size={24} />
                        {isAr ? 'المبالغ المستردة' : 'Refunds'}
                    </h1>
                    <p className="text-sm text-zinc-500 mt-1">{isAr ? `${pagination.total} عملية استرداد` : `${pagination.total} refunds`}</p>
                </div>
            </div>

            {/* Filter */}
            <div className="flex gap-3">
                <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                    className="px-3 py-2.5 bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl text-sm text-zinc-900 dark:text-white">
                    <option value="">{isAr ? 'كل الحالات' : 'All Statuses'}</option>
                    {Object.keys(STATUS_LABELS).map((s) => (
                        <option key={s} value={s}>{STATUS_LABELS[s][isAr ? 'ar' : 'en']}</option>
                    ))}
                </select>
            </div>

            {/* Table */}
            <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[820px]">
                        <thead>
                            <tr className="border-b border-zinc-100 dark:border-white/5">
                                {[
                                    isAr ? 'رقم الاسترداد' : 'Refund #',
                                    isAr ? 'رقم الإرجاع' : 'Return #',
                                    isAr ? 'العميل' : 'Customer',
                                    isAr ? 'البائع' : 'Vendor',
                                    isAr ? 'المبلغ' : 'Amount',
                                    isAr ? 'الطريقة' : 'Method',
                                    isAr ? 'الحالة' : 'Status',
                                    '',
                                ].map((h, i) => (
                                    <th key={i} className="px-4 py-3 text-start text-xs font-bold text-zinc-400 uppercase tracking-widest">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={8} className="py-16 text-center"><Loader2 size={28} className="animate-spin text-marine-primary mx-auto" /></td></tr>
                            ) : refunds.length === 0 ? (
                                <tr><td colSpan={8} className="py-16 text-center">
                                    <DollarSign size={36} className="mx-auto text-zinc-200 dark:text-zinc-700 mb-3" />
                                    <p className="text-zinc-500 font-semibold">{isAr ? 'لا توجد عمليات استرداد' : 'No refunds found'}</p>
                                </td></tr>
                            ) : refunds.map((ref) => (
                                <tr key={ref._id} {...rowLink(`/admin/dashboard/refunds/${ref._id}`)} className="border-b border-zinc-50 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors cursor-pointer">
                                    <td className="px-4 py-3 font-bold text-zinc-900 dark:text-white">{ref.refund_number}</td>
                                    <td className="px-4 py-3 text-zinc-500">{ref.return_request_id?.return_number || '—'}</td>
                                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">{ref.user_id?.name || '—'}</td>
                                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">{ref.vendor_id?.store_name || '—'}</td>
                                    <td className="px-4 py-3 font-bold text-zinc-900 dark:text-white">{ref.total_refund_amount} {isAr ? 'ج.م' : 'EGP'}</td>
                                    <td className="px-4 py-3 text-zinc-500 capitalize">{ref.refund_method?.replace('_', ' ')}</td>
                                    <td className="px-4 py-3">
                                        <span className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${STATUS_COLORS[ref.status] || ''}`}>
                                            {STATUS_LABELS[ref.status]?.[isAr ? 'ar' : 'en'] || ref.status}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <Link href={`/admin/dashboard/refunds/${ref._id}`} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors inline-flex">
                                            <Eye size={16} className="text-zinc-400" />
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {pagination.pages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-100 dark:border-white/5">
                        <span className="text-xs text-zinc-500">{isAr ? `صفحة ${page} من ${pagination.pages}` : `Page ${page} of ${pagination.pages}`}</span>
                        <div className="flex gap-2">
                            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="p-2 rounded-lg border border-zinc-200 dark:border-white/10 disabled:opacity-30 hover:bg-zinc-50 dark:hover:bg-white/5"><ChevronLeft size={16} /></button>
                            <button onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page >= pagination.pages} className="p-2 rounded-lg border border-zinc-200 dark:border-white/10 disabled:opacity-30 hover:bg-zinc-50 dark:hover:bg-white/5"><ChevronRight size={16} /></button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
