'use client';

import { useEffect, useState } from 'react';
import { useRouter } from '../../../lib/navigation';
import { Loader2, Plus, MessageSquare, AlertCircle, CheckCircle, Clock, XCircle, ChevronDown } from 'lucide-react';
import { ticketApi } from '../../../lib/api';
import { useApp } from '../../../context/AppContext';
import usePageSize from '../../../lib/usePageSize';
import { PageSizeSelect } from '../../../components/dashboard/PaginationControls';


const STATUS_OPTIONS = [
    { value: '', label_en: 'All Statuses', label_ar: 'كل الحالات' },
    { value: 'open', label_en: 'Open', label_ar: 'مفتوح' },
    { value: 'pending', label_en: 'Pending', label_ar: 'قيد الانتظار' },
    { value: 'resolved', label_en: 'Resolved', label_ar: 'تم الحل' },
    { value: 'closed', label_en: 'Closed', label_ar: 'مغلق' },
];

const STATUS_COLORS = {
    open: 'bg-amber-500/20 text-amber-500',
    pending: 'bg-blue-500/20 text-blue-500',
    resolved: 'bg-emerald-500/20 text-emerald-500',
    closed: 'bg-zinc-500/20 text-zinc-500',
};

const STATUS_ICONS = {
    open: AlertCircle,
    pending: Clock,
    resolved: CheckCircle,
    closed: XCircle,
};

const PRIORITY_COLORS = {
    low: 'bg-zinc-500/20 text-zinc-400',
    medium: 'bg-blue-500/20 text-blue-500',
    high: 'bg-red-500/20 text-red-500',
    urgent: 'bg-red-500/20 text-red-500',
};

const CATEGORY_LABELS_AR = {
    account: 'الحساب',
    order: 'الطلب',
    product: 'المنتج',
    payment: 'الدفع',
    technical: 'تقني',
    other: 'أخرى',
};

export default function VendorTicketsPage() {
    const router = useRouter();
    const { language, user } = useApp();
    const isAr = language === 'ar';

    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = usePageSize('vendor.tickets', 20);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);

    const fetchTickets = async () => {
        setLoading(true);
        setError('');
        try {
            const data = await ticketApi.getTickets({ page, limit: pageSize, status: statusFilter });
            setTickets(data.tickets || []);
            setTotalPages(data.pagination?.pages || 1);
            setTotal(data.pagination?.total || 0);
        } catch (err) {
            setError(isAr ? 'تعذر تحميل تذاكر الدعم.' : (err.message || 'Failed to load tickets.'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTickets();
    }, [page, pageSize, statusFilter]);

    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
        });
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
                        {isAr ? 'الدعم الفني' : 'Support Tickets'}
                    </h1>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        {isAr ? `${total} تذكرة` : `${total} ticket${total !== 1 ? 's' : ''}`}
                    </p>
                </div>
                <button
                    onClick={() => router.push('/dashboard/tickets/new')}
                    className="flex items-center gap-2 px-5 py-2.5 bg-marine-cyan hover:bg-[#b55d16] text-white rounded-lg text-sm font-medium transition-colors"
                >
                    <Plus size={16} />
                    {isAr ? 'إنشاء تذكرة دعم' : 'New Ticket'}
                </button>
            </div>

            {/* Filter */}
            <div className="bg-white dark:bg-[#1a1d24] rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                <div className="flex items-center gap-3">
                    <select
                        value={statusFilter}
                        onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                        className="appearance-none px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-[#0E1012] text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-marine-cyan/50 pr-8"
                    >
                        {STATUS_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>
                                {isAr ? opt.label_ar : opt.label_en}
                            </option>
                        ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                </div>
            </div>

            {/* Tickets Table */}
            <div className="bg-white dark:bg-[#1a1d24] rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 size={32} className="text-marine-primary animate-spin" />
                    </div>
                ) : error ? (
                    <div className="flex items-center justify-center py-20">
                        <p className="text-red-500">{error}</p>
                    </div>
                ) : tickets.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
                        <MessageSquare size={48} className="mb-3 opacity-40" />
                        <p className="text-base font-medium">{isAr ? 'لا توجد تذاكر' : 'No tickets yet'}</p>
                        <p className="text-sm mt-1">{isAr ? 'أنشئ تذكرة للتواصل مع فريق الدعم.' : 'Create a new ticket to contact support.'}</p>
                        <button
                            onClick={() => router.push('/dashboard/tickets/new')}
                            className="mt-4 px-5 py-2 bg-marine-cyan text-white rounded-lg text-sm font-medium"
                        >
                            {isAr ? 'إنشاء تذكرة دعم' : 'Create Ticket'}
                        </button>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm min-w-[720px]">
                            <thead>
                                <tr className="border-b border-zinc-100 dark:border-zinc-700 bg-zinc-50 dark:bg-[#0E1012]/50">
                                    <th className="text-left px-5 py-3 font-semibold text-zinc-600 dark:text-zinc-400">{isAr ? 'العنوان' : 'Title'}</th>
                                    <th className="text-left px-5 py-3 font-semibold text-zinc-600 dark:text-zinc-400">{isAr ? 'الفئة' : 'Category'}</th>
                                    <th className="text-left px-5 py-3 font-semibold text-zinc-600 dark:text-zinc-400">{isAr ? 'الأولوية' : 'Priority'}</th>
                                    <th className="text-left px-5 py-3 font-semibold text-zinc-600 dark:text-zinc-400">{isAr ? 'الحالة' : 'Status'}</th>
                                    <th className="text-left px-5 py-3 font-semibold text-zinc-600 dark:text-zinc-400">{isAr ? 'الرسائل' : 'Messages'}</th>
                                    <th className="text-left px-5 py-3 font-semibold text-zinc-600 dark:text-zinc-400">{isAr ? 'تاريخ الإنشاء' : 'Created'}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {tickets.map((ticket) => {
                                    const StatusIcon = STATUS_ICONS[ticket.status] || MessageSquare;
                                    return (
                                        <tr
                                            key={ticket._id}
                                            className="border-b border-zinc-50 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-[#0E1012]/50 transition-colors cursor-pointer"
                                            onClick={() => router.push(`/dashboard/tickets/${ticket._id}`)}
                                        >
                                            <td className="px-5 py-4">
                                                <p className="font-medium text-zinc-900 dark:text-white">{ticket.title}</p>
                                            </td>
                                            <td className="px-5 py-4 text-zinc-500 dark:text-zinc-400 capitalize">
                                                {isAr ? (CATEGORY_LABELS_AR[ticket.category] || 'أخرى') : ticket.category}
                                            </td>
                                            <td className="px-5 py-4">
                                                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${PRIORITY_COLORS[ticket.priority] || ''}`}>
                                                    {isAr
                                                        ? { low: 'منخفض', medium: 'متوسط', high: 'عالي', urgent: 'عاجل' }[ticket.priority]
                                                        : (ticket.priority || 'medium').charAt(0).toUpperCase() + (ticket.priority || 'medium').slice(1)
                                                    }
                                                </span>
                                            </td>
                                            <td className="px-5 py-4">
                                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[ticket.status] || ''}`}>
                                                    <StatusIcon size={12} />
                                                    {isAr
                                                        ? { open: 'مفتوح', pending: 'قيد الانتظار', resolved: 'تم الحل', closed: 'مغلق' }[ticket.status]
                                                        : (ticket.status || 'open').charAt(0).toUpperCase() + (ticket.status || 'open').slice(1)
                                                    }
                                                </span>
                                            </td>
                                            <td className="px-5 py-4 text-center text-zinc-500 dark:text-zinc-400">{ticket.messages?.length || 0}</td>
                                            <td className="px-5 py-4 text-zinc-400 dark:text-zinc-500 text-xs">{formatDate(ticket.createdAt)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Pagination */}
            {!loading && tickets.length > 0 && (
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <p className="text-sm text-zinc-500">
                            {isAr ? `صفحة ${page} من ${totalPages}` : `Page ${page} of ${totalPages}`}
                        </p>
                        <PageSizeSelect pageSize={pageSize} onChange={(n) => { setPageSize(n); setPage(1); }} label={isAr ? 'صفوف' : 'Rows'} />
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                            className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-[#1a1d24] text-sm disabled:opacity-40">
                            {isAr ? 'السابق' : 'Previous'}
                        </button>
                        <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                            className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-[#1a1d24] text-sm disabled:opacity-40">
                            {isAr ? 'التالي' : 'Next'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
