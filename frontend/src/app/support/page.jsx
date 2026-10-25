'use client';

import { useEffect, useState } from 'react';
import { useRouter } from '../../lib/navigation';
import { Loader2, Plus, MessageSquare, AlertCircle, CheckCircle, Clock, XCircle, ChevronDown } from 'lucide-react';
import { ticketApi } from '../../lib/api';
import { useApp } from '../../context/AppContext';

const PAGE_SIZE = 20;

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

export default function UserSupportPage() {
    const router = useRouter();
    const { language, user } = useApp();
    const isAr = language === 'ar';

    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);

    const fetchTickets = async () => {
        setLoading(true);
        setError('');
        try {
            const data = await ticketApi.getTickets({ page, limit: PAGE_SIZE, status: statusFilter });
            setTickets(data.tickets || []);
            setTotalPages(data.pagination?.pages || 1);
            setTotal(data.pagination?.total || 0);
        } catch (err) {
            setError(err.message || 'Failed to load tickets');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTickets();
    }, [page, statusFilter]);

    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
        });
    };

    return (
        <div className="min-h-screen bg-zinc-50 dark:bg-[#0E1012]">
            <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
                            {isAr ? 'الدعم الفني' : 'Support Center'}
                        </h1>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                            {isAr
                                ? `لديك ${total} تذكرة${total !== 1 ? '' : ''}`
                                : `You have ${total} ticket${total !== 1 ? 's' : ''}`
                            }
                        </p>
                    </div>
                    <button
                        onClick={() => router.push('/support/tickets/new')}
                        className="flex items-center gap-2 px-5 py-2.5 bg-marine-cyan hover:bg-[#b55d16] text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        <Plus size={16} />
                        {isAr ? 'انشا طلبا للدعم' : 'New Ticket'}
                    </button>
                </div>

                {/* Filter */}
                <div className="bg-white dark:bg-[#1a1d24] rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 flex items-center gap-3">
                    <select
                        value={statusFilter}
                        onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                        className="appearance-none px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-[#0E1012] text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-marine-cyan/50"
                    >
                        {STATUS_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>
                                {isAr ? opt.label_ar : opt.label_en}
                            </option>
                        ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                </div>

                {/* Tickets */}
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
                            <p className="text-sm mt-1">{isAr ? 'انشا طلبا للدعم للتواصل مع فريق الدعم.' : 'Create a ticket to contact support.'}</p>
                            <button
                                onClick={() => router.push('/support/tickets/new')}
                                className="mt-4 px-5 py-2 bg-marine-cyan text-white rounded-lg text-sm font-medium"
                            >
                                {isAr ? 'انشا طلبا للدعم' : 'Create Ticket'}
                            </button>
                        </div>
                    ) : (
                        <div className="divide-y divide-zinc-50 dark:divide-zinc-800">
                            {tickets.map((ticket) => {
                                const StatusIcon = STATUS_ICONS[ticket.status] || MessageSquare;
                                return (
                                    <div
                                        key={ticket._id}
                                        onClick={() => router.push(`/support/tickets/${ticket._id}`)}
                                        className="px-6 py-5 hover:bg-zinc-50 dark:hover:bg-[#0E1012]/50 transition-colors cursor-pointer"
                                    >
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-3 mb-1">
                                                    <p className="font-semibold text-zinc-900 dark:text-white line-clamp-1">{ticket.title}</p>
                                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[ticket.status] || ''}`}>
                                                        <StatusIcon size={12} />
                                                        {isAr
                                                            ? { open: 'مفتوح', pending: 'قيد الانتظار', resolved: 'تم الحل', closed: 'مغلق' }[ticket.status]
                                                            : (ticket.status || 'open').charAt(0).toUpperCase() + (ticket.status || 'open').slice(1)
                                                        }
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-3 text-xs text-zinc-400">
                                                    <span className="capitalize">{ticket.category}</span>
                                                    <span>•</span>
                                                    <span>{ticket.messages?.length || 0} {isAr ? 'رسالة' : 'messages'}</span>
                                                    <span>•</span>
                                                    <span>{formatDate(ticket.createdAt)}</span>
                                                </div>
                                            </div>
                                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium shrink-0 ${PRIORITY_COLORS[ticket.priority] || ''}`}>
                                                {isAr
                                                    ? { low: 'منخفض', medium: 'متوسط', high: 'عالي', urgent: 'عاجل' }[ticket.priority]
                                                    : (ticket.priority || 'medium').charAt(0).toUpperCase() + (ticket.priority || 'medium').slice(1)
                                                }
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Pagination */}
                {!loading && tickets.length > 0 && (
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-zinc-500">
                            {isAr ? `صفحة ${page} من ${totalPages}` : `Page ${page} of ${totalPages}`}
                        </p>
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
        </div>
    );
}
