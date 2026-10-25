'use client';

import { useEffect, useState } from 'react';
import Link from '../../../../components/LocaleLink';
import { useApp } from '../../../../context/AppContext';
import { adminReturnsApi, adminApi } from '../../../../lib/api';
import { RotateCcw, Search, Loader2, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import useRowLink from '../../../../lib/useRowLink';

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

const REASON_LABELS = {
    defective: { en: 'Defective', ar: 'معيب' },
    wrong_item: { en: 'Wrong Item', ar: 'منتج خاطئ' },
    not_as_described: { en: 'Not as Described', ar: 'غير مطابق للوصف' },
    changed_mind: { en: 'Changed Mind', ar: 'تغيير رأي' },
    other: { en: 'Other', ar: 'أخرى' },
};

const STATUS_LABELS = {
    pending_vendor_review: { en: 'Pending Vendor', ar: 'بانتظار البائع' },
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

export default function AdminReturnsPage() {
    const rowLink = useRowLink();
    const { language } = useApp();
    const isAr = language === 'ar';

    const [returns, setReturns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [vendorFilter, setVendorFilter] = useState('');
    const [vendors, setVendors] = useState([]);
    const [page, setPage] = useState(1);
    const [pagination, setPagination] = useState({ total: 0, pages: 1 });
    const [counts, setCounts] = useState({});
    const limit = 20;

    useEffect(() => {
        loadReturns();
    }, [page, statusFilter, vendorFilter]);

    useEffect(() => {
        loadVendors();
        loadCounts();
    }, []);

    const loadReturns = async () => {
        try {
            setLoading(true);
            const data = await adminReturnsApi.getAll({
                page, limit,
                status: statusFilter,
                vendorId: vendorFilter,
                search: search || undefined,
            });
            setReturns(data.returns || []);
            setPagination(data.pagination || { total: 0, pages: 1 });
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const loadVendors = async () => {
        try {
            const data = await adminApi.getVendorsForFilter();
            setVendors(data.vendors || data || []);
        } catch (_) {}
    };

    const loadCounts = async () => {
        try {
            const data = await adminReturnsApi.getCounts();
            setCounts(data.counts || {});
        } catch (_) {}
    };

    const handleSearch = (e) => {
        e.preventDefault();
        setPage(1);
        loadReturns();
    };

    const statusOptions = Object.keys(STATUS_LABELS);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                    <h1 className="text-2xl font-black text-zinc-900 dark:text-white flex items-center gap-3">
                        <RotateCcw size={24} />
                        {isAr ? 'الإرجاع والاسترداد' : 'Returns & Refunds'}
                    </h1>
                    <p className="text-sm text-zinc-500 mt-1">
                        {isAr ? `${pagination.total} طلب إرجاع` : `${pagination.total} return requests`}
                    </p>
                </div>
                <Link
                    href="/admin/dashboard/refunds"
                    className="px-4 py-2.5 rounded-xl text-sm font-bold bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-white/10 transition-colors"
                >
                    {isAr ? 'عرض المبالغ المستردة' : 'View Refunds'}
                </Link>
            </div>

            {/* Stats */}
            {counts.total > 0 && (
                <div className="flex flex-wrap gap-2">
                    {[
                        { key: 'pending_admin_review', color: 'bg-violet-500/20 text-violet-600' },
                        { key: 'approved', color: 'bg-emerald-500/20 text-emerald-600' },
                        { key: 'return_shipping', color: 'bg-cyan-500/20 text-cyan-600' },
                        { key: 'refund_processing', color: 'bg-yellow-500/20 text-yellow-600' },
                        { key: 'completed', color: 'bg-emerald-500/20 text-emerald-600' },
                    ].map(({ key, color }) => counts[key] > 0 && (
                        <span key={key} className={`px-3 py-1.5 rounded-full text-xs font-bold ${color}`}>
                            {STATUS_LABELS[key]?.[isAr ? 'ar' : 'en']} ({counts[key]})
                        </span>
                    ))}
                </div>
            )}

            {/* Filters */}
            <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-4">
                <div className="flex flex-wrap gap-3">
                    <form onSubmit={handleSearch} className="flex-1 min-w-[200px]">
                        <div className="relative">
                            <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder={isAr ? 'بحث برقم الإرجاع...' : 'Search by return number...'}
                                className="w-full ps-9 pe-3 py-2.5 bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400"
                            />
                        </div>
                    </form>
                    <select
                        value={statusFilter}
                        onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                        className="px-3 py-2.5 bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl text-sm text-zinc-900 dark:text-white"
                    >
                        <option value="">{isAr ? 'كل الحالات' : 'All Statuses'}</option>
                        {statusOptions.map((s) => (
                            <option key={s} value={s}>{STATUS_LABELS[s]?.[isAr ? 'ar' : 'en']}</option>
                        ))}
                    </select>
                    <select
                        value={vendorFilter}
                        onChange={(e) => { setVendorFilter(e.target.value); setPage(1); }}
                        className="px-3 py-2.5 bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl text-sm text-zinc-900 dark:text-white"
                    >
                        <option value="">{isAr ? 'كل البائعين' : 'All Vendors'}</option>
                        {vendors.map((v) => (
                            <option key={v._id} value={v._id}>{v.store_name || v.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-600 p-4 rounded-xl text-sm">{error}</div>
            )}

            {/* Table */}
            <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[820px]">
                        <thead>
                            <tr className="border-b border-zinc-100 dark:border-white/5">
                                {[
                                    isAr ? 'رقم الإرجاع' : 'Return #',
                                    isAr ? 'العميل' : 'Customer',
                                    isAr ? 'البائع' : 'Vendor',
                                    isAr ? 'السبب' : 'Reason',
                                    isAr ? 'المنتجات' : 'Items',
                                    isAr ? 'الحالة' : 'Status',
                                    isAr ? 'التاريخ' : 'Date',
                                    '',
                                ].map((h, i) => (
                                    <th key={i} className="px-4 py-3 text-start text-xs font-bold text-zinc-400 uppercase tracking-widest">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={8} className="py-16 text-center">
                                        <Loader2 size={28} className="animate-spin text-marine-primary mx-auto" />
                                    </td>
                                </tr>
                            ) : returns.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="py-16 text-center">
                                        <RotateCcw size={36} className="mx-auto text-zinc-200 dark:text-zinc-700 mb-3" />
                                        <p className="text-zinc-500 font-semibold">{isAr ? 'لا توجد طلبات إرجاع' : 'No return requests found'}</p>
                                    </td>
                                </tr>
                            ) : returns.map((ret) => (
                                <tr key={ret._id} {...rowLink(`/admin/dashboard/returns/${ret._id}`)} className="border-b border-zinc-50 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors cursor-pointer">
                                    <td className="px-4 py-3 font-bold text-zinc-900 dark:text-white">{ret.return_number}</td>
                                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">{ret.user_id?.name || ret.user_id?.email || '—'}</td>
                                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">{ret.vendor_id?.store_name || '—'}</td>
                                    <td className="px-4 py-3">
                                        <span className="text-zinc-600 dark:text-zinc-300">{REASON_LABELS[ret.reason]?.[isAr ? 'ar' : 'en'] || ret.reason}</span>
                                    </td>
                                    <td className="px-4 py-3 text-zinc-500">{ret.items?.length || 0}</td>
                                    <td className="px-4 py-3">
                                        <span className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${STATUS_COLORS[ret.status] || 'bg-zinc-500/20 text-zinc-500'}`}>
                                            {STATUS_LABELS[ret.status]?.[isAr ? 'ar' : 'en'] || ret.status}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-zinc-500">
                                        {new Date(ret.created_at).toLocaleDateString(isAr ? 'ar-u-ca-gregory' : 'en-US', { month: 'short', day: 'numeric' })}
                                    </td>
                                    <td className="px-4 py-3">
                                        <Link href={`/admin/dashboard/returns/${ret._id}`} className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors inline-flex">
                                            <Eye size={16} className="text-zinc-400" />
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {pagination.pages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-100 dark:border-white/5">
                        <span className="text-xs text-zinc-500">
                            {isAr ? `صفحة ${page} من ${pagination.pages}` : `Page ${page} of ${pagination.pages}`}
                        </span>
                        <div className="flex gap-2">
                            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                                className="p-2 rounded-lg border border-zinc-200 dark:border-white/10 disabled:opacity-30 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                                <ChevronLeft size={16} />
                            </button>
                            <button onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page >= pagination.pages}
                                className="p-2 rounded-lg border border-zinc-200 dark:border-white/10 disabled:opacity-30 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                                <ChevronRight size={16} />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
