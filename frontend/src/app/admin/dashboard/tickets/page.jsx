'use client';

import { useEffect, useState } from 'react';
import { useRouter } from '../../../../lib/navigation';
import { Loader2, Search, Plus, MessageSquare, AlertCircle, CheckCircle, Clock, XCircle, ChevronDown, X } from 'lucide-react';
import { adminApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import usePageSize from '../../../../lib/usePageSize';
import { PageSizeSelect } from '../../../../components/dashboard/PaginationControls';
import Overlay from '../../../../components/Overlay';


const STATUS_OPTIONS = [
    { value: '', label_en: 'All Statuses', label_ar: 'كل الحالات' },
    { value: 'open', label_en: 'Open', label_ar: 'مفتوح' },
    { value: 'pending', label_en: 'Pending', label_ar: 'قيد الانتظار' },
    { value: 'resolved', label_en: 'Resolved', label_ar: 'تم الحل' },
    { value: 'closed', label_en: 'Closed', label_ar: 'مغلق' },
];

const PRIORITY_OPTIONS = [
    { value: '', label_en: 'All Priorities', label_ar: 'كل الأولويات' },
    { value: 'low', label_en: 'Low', label_ar: 'منخفض' },
    { value: 'medium', label_en: 'Medium', label_ar: 'متوسط' },
    { value: 'high', label_en: 'High', label_ar: 'عالي' },
    { value: 'urgent', label_en: 'Urgent', label_ar: 'عاجل' },
];

const ROLE_OPTIONS = [
    { value: '', label_en: 'All Roles', label_ar: 'كل الأدوار' },
    { value: 'vendor', label_en: 'Vendor', label_ar: 'بائع' },
    { value: 'user', label_en: 'User', label_ar: 'مستخدم' },
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

export default function AdminTicketsPage() {
    const router = useRouter();
    const { language, siteSettings, user } = useApp();
    const isAr = language === 'ar';

    const [tickets, setTickets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [priorityFilter, setPriorityFilter] = useState('');
    const [roleFilter, setRoleFilter] = useState('');

    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = usePageSize('admin.tickets', 20);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);

    // New conversation modal
    const [showNewModal, setShowNewModal] = useState(false);
    const [vendors, setVendors] = useState([]);
    const [vendorsLoading, setVendorsLoading] = useState(false);
    const [newConv, setNewConv] = useState({ vendorId: '', title: '', message: '', priority: 'medium' });
    const [creating, setCreating] = useState(false);

    const openNewModal = async () => {
        setNewConv({ vendorId: '', title: '', message: '', priority: 'medium' });
        setShowNewModal(true);
        if (vendors.length === 0) {
            setVendorsLoading(true);
            try {
                const data = await adminApi.getVendors();
                setVendors(data.vendors || data.sellers || data || []);
            } catch (err) {
                alert(err.message || 'Failed to load vendors');
            } finally {
                setVendorsLoading(false);
            }
        }
    };

    const handleCreateConversation = async (e) => {
        e.preventDefault();
        if (!newConv.vendorId || !newConv.title.trim() || !newConv.message.trim()) return;
        setCreating(true);
        try {
            const data = await adminApi.startVendorConversation(newConv);
            setShowNewModal(false);
            router.push(`/admin/dashboard/tickets/${data.ticket._id}`);
        } catch (err) {
            alert(err.message || 'Failed to start conversation');
        } finally {
            setCreating(false);
        }
    };

    const fetchTickets = async (params = {}) => {
        setLoading(true);
        setError('');
        try {
            const data = await adminApi.getTickets({
                page,
                limit: pageSize,
                q: search,
                status: statusFilter,
                priority: priorityFilter,
                authorRole: roleFilter,
            });
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
    }, [page, pageSize, statusFilter, priorityFilter, roleFilter]);

    const handleSearchSubmit = (e) => {
        e.preventDefault();
        setPage(1);
        fetchTickets({ q: search });
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
        });
    };

    const getMessageCount = (ticket) => {
        return (ticket.messages?.length || 0) + 1; // +1 for initial description
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
                        {isAr ? 'تذاكر الدعم' : 'Support Tickets'}
                    </h1>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                        {isAr ? `${total} تذكرة` : `${total} ticket${total !== 1 ? 's' : ''}`}
                    </p>
                </div>
                <button
                    onClick={openNewModal}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-marine-cyan hover:bg-[#b55d16] text-white rounded-lg text-sm font-medium transition-colors"
                >
                    <Plus size={16} />
                    {isAr ? 'محادثة جديدة' : 'New Conversation'}
                </button>
            </div>

            {/* Filters */}
            <div className="bg-white dark:bg-[#1a1d24] rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 space-y-4">
                <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-3">
                    {/* Search */}
                    <div className="flex-1 relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                        <input
                            type="text"
                            placeholder={isAr ? 'البحث في التذاكر...' : 'Search tickets...'}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearchSubmit(e)}
                            className="w-full pl-10 pr-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-[#0E1012] text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-marine-cyan/50"
                        />
                    </div>

                    {/* Status Filter */}
                    <div className="relative min-w-[160px]">
                        <select
                            value={statusFilter}
                            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                            className="w-full appearance-none px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-[#0E1012] text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-marine-cyan/50 pr-8"
                        >
                            {STATUS_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>
                                    {isAr ? opt.label_ar : opt.label_en}
                                </option>
                            ))}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                    </div>

                    {/* Priority Filter */}
                    <div className="relative min-w-[160px]">
                        <select
                            value={priorityFilter}
                            onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); }}
                            className="w-full appearance-none px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-[#0E1012] text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-marine-cyan/50 pr-8"
                        >
                            {PRIORITY_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>
                                    {isAr ? opt.label_ar : opt.label_en}
                                </option>
                            ))}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                    </div>

                    {/* Role Filter */}
                    <div className="relative min-w-[160px]">
                        <select
                            value={roleFilter}
                            onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
                            className="w-full appearance-none px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-[#0E1012] text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-marine-cyan/50 pr-8"
                        >
                            {ROLE_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>
                                    {isAr ? opt.label_ar : opt.label_en}
                                </option>
                            ))}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                    </div>

                    <button
                        type="submit"
                        className="px-5 py-2 bg-marine-cyan hover:bg-[#b55d16] text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        {isAr ? 'بحث' : 'Search'}
                    </button>
                </form>
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
                        <p className="text-base font-medium">
                            {isAr ? 'لا توجد تذاكر' : 'No tickets found'}
                        </p>
                        <p className="text-sm mt-1">
                            {isAr ? 'لم يتم العثور على تذاكر تطابق معايير البحث.' : 'No tickets match your search criteria.'}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm min-w-[900px]">
                            <thead>
                                <tr className="border-b border-zinc-100 dark:border-zinc-700 bg-zinc-50 dark:bg-[#0E1012]/50">
                                    <th className="text-left px-5 py-3 font-semibold text-zinc-600 dark:text-zinc-400">
                                        {isAr ? 'العنوان' : 'Title'}
                                    </th>
                                    <th className="text-left px-5 py-3 font-semibold text-zinc-600 dark:text-zinc-400">
                                        {isAr ? 'المؤلف' : 'Author'}
                                    </th>
                                    <th className="text-left px-5 py-3 font-semibold text-zinc-600 dark:text-zinc-400">
                                        {isAr ? 'الدور' : 'Role'}
                                    </th>
                                    <th className="text-left px-5 py-3 font-semibold text-zinc-600 dark:text-zinc-400">
                                        {isAr ? 'الأولوية' : 'Priority'}
                                    </th>
                                    <th className="text-left px-5 py-3 font-semibold text-zinc-600 dark:text-zinc-400">
                                        {isAr ? 'الحالة' : 'Status'}
                                    </th>
                                    <th className="text-left px-5 py-3 font-semibold text-zinc-600 dark:text-zinc-400">
                                        {isAr ? 'الرسائل' : 'Messages'}
                                    </th>
                                    <th className="text-left px-5 py-3 font-semibold text-zinc-600 dark:text-zinc-400">
                                        {isAr ? 'تاريخ الإنشاء' : 'Created'}
                                    </th>
                                    <th className="text-left px-5 py-3 font-semibold text-zinc-600 dark:text-zinc-400">
                                        {isAr ? 'إجراء' : 'Action'}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {tickets.map((ticket) => {
                                    const StatusIconForTicket = STATUS_ICONS[ticket.status] || MessageSquare;
                                    return (
                                        <tr
                                            key={ticket._id}
                                            className="border-b border-zinc-50 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-[#0E1012]/50 transition-colors cursor-pointer"
                                            onClick={() => router.push(`/admin/dashboard/tickets/${ticket._id}`)}
                                        >
                                            <td className="px-5 py-4">
                                                <p className="font-medium text-zinc-900 dark:text-zinc-100 line-clamp-1">
                                                    {ticket.title}
                                                </p>
                                                <p className="text-xs text-zinc-400 mt-0.5 capitalize">
                                                    {ticket.category}
                                                    {ticket.order_reference && <span className="ms-2 font-mono text-marine-primary">#{ticket.order_reference}</span>}
                                                </p>
                                            </td>
                                            <td className="px-5 py-4">
                                                <p className="font-medium text-zinc-900 dark:text-zinc-100 text-sm">
                                                    {ticket.authorName}
                                                </p>
                                            </td>
                                            <td className="px-5 py-4">
                                                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                                                    ticket.authorRole === 'vendor'
                                                        ? 'bg-violet-500/20 text-violet-500'
                                                        : 'bg-cyan-500/20 text-cyan-500'
                                                }`}>
                                                    {ticket.authorRole === 'vendor'
                                                        ? (isAr ? 'بائع' : 'Vendor')
                                                        : (isAr ? 'مستخدم' : 'User')
                                                    }
                                                </span>
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
                                                    <StatusIconForTicket size={12} />
                                                    {isAr
                                                        ? { open: 'مفتوح', pending: 'قيد الانتظار', resolved: 'تم الحل', closed: 'مغلق' }[ticket.status]
                                                        : (ticket.status || 'open').charAt(0).toUpperCase() + (ticket.status || 'open').slice(1)
                                                    }
                                                </span>
                                            </td>
                                            <td className="px-5 py-4 text-center text-zinc-500 dark:text-zinc-400">
                                                {getMessageCount(ticket)}
                                            </td>
                                            <td className="px-5 py-4 text-zinc-400 dark:text-zinc-500 text-xs">
                                                {formatDate(ticket.createdAt)}
                                            </td>
                                            <td className="px-5 py-4">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); router.push(`/admin/dashboard/tickets/${ticket._id}`); }}
                                                    className="px-3 py-1.5 bg-marine-cyan/10 text-marine-primary hover:bg-marine-cyan/20 rounded-lg text-xs font-medium transition-colors"
                                                >
                                                    {isAr ? 'عرض' : 'View'}
                                                </button>
                                            </td>
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
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        {isAr
                            ? `عرض ${((page - 1) * pageSize) + 1} - ${Math.min(page * pageSize, total)} من ${total}`
                            : `Showing ${((page - 1) * pageSize) + 1} – ${Math.min(page * pageSize, total)} of ${total}`
                        }
                    </p>
                        <PageSizeSelect pageSize={pageSize} onChange={(n) => { setPageSize(n); setPage(1); }} label={isAr ? 'صفوف' : 'Rows'} />
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1}
                            className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-[#1a1d24] text-zinc-700 dark:text-zinc-300 text-sm disabled:opacity-40 hover:bg-zinc-50 dark:hover:bg-[#0E1012] transition-colors disabled:cursor-not-allowed"
                        >
                            {isAr ? 'السابق' : 'Previous'}
                        </button>
                        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(p => (
                            <button
                                key={p}
                                onClick={() => setPage(p)}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                    page === p
                                        ? 'bg-marine-cyan text-white'
                                        : 'border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-[#1a1d24] text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-[#0E1012]'
                                }`}
                            >
                                {p}
                            </button>
                        ))}
                        <button
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages}
                            className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-[#1a1d24] text-zinc-700 dark:text-zinc-300 text-sm disabled:opacity-40 hover:bg-zinc-50 dark:hover:bg-[#0E1012] transition-colors disabled:cursor-not-allowed"
                        >
                            {isAr ? 'التالي' : 'Next'}
                        </button>
                    </div>
                </div>
            )}

            {/* New Conversation Modal */}
            {showNewModal && (
                <Overlay className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowNewModal(false)}>
                    <div
                        className="w-full max-w-lg bg-white dark:bg-[#1a1d24] rounded-2xl border border-zinc-200 dark:border-zinc-700 shadow-xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 dark:border-zinc-700">
                            <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
                                {isAr ? 'بدء محادثة مع بائع' : 'Start Conversation with Vendor'}
                            </h2>
                            <button onClick={() => setShowNewModal(false)} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-[#0E1012] transition-colors">
                                <X size={18} className="text-zinc-500" />
                            </button>
                        </div>

                        <form onSubmit={handleCreateConversation} className="px-6 py-5 space-y-4">
                            {/* Vendor */}
                            <div>
                                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                                    {isAr ? 'البائع' : 'Vendor'}
                                </label>
                                <select
                                    value={newConv.vendorId}
                                    onChange={(e) => setNewConv(c => ({ ...c, vendorId: e.target.value }))}
                                    required
                                    disabled={vendorsLoading}
                                    className="w-full px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-[#0E1012] text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-marine-cyan/50"
                                >
                                    <option value="">
                                        {vendorsLoading ? (isAr ? 'جاري التحميل...' : 'Loading...') : (isAr ? 'اختر بائعاً' : 'Select a vendor')}
                                    </option>
                                    {vendors.map((v) => (
                                        <option key={v._id} value={v._id}>
                                            {v.store_name || v.name} {v.email ? `(${v.email})` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Title */}
                            <div>
                                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                                    {isAr ? 'العنوان' : 'Title'}
                                </label>
                                <input
                                    type="text"
                                    value={newConv.title}
                                    onChange={(e) => setNewConv(c => ({ ...c, title: e.target.value }))}
                                    required
                                    placeholder={isAr ? 'موضوع المحادثة' : 'Conversation subject'}
                                    className="w-full px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-[#0E1012] text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-marine-cyan/50"
                                />
                            </div>

                            {/* Priority */}
                            <div>
                                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                                    {isAr ? 'الأولوية' : 'Priority'}
                                </label>
                                <select
                                    value={newConv.priority}
                                    onChange={(e) => setNewConv(c => ({ ...c, priority: e.target.value }))}
                                    className="w-full px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-[#0E1012] text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-marine-cyan/50"
                                >
                                    {PRIORITY_OPTIONS.filter(o => o.value).map(opt => (
                                        <option key={opt.value} value={opt.value}>
                                            {isAr ? opt.label_ar : opt.label_en}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Message */}
                            <div>
                                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                                    {isAr ? 'الرسالة' : 'Message'}
                                </label>
                                <textarea
                                    value={newConv.message}
                                    onChange={(e) => setNewConv(c => ({ ...c, message: e.target.value }))}
                                    required
                                    rows={4}
                                    placeholder={isAr ? 'اكتب رسالتك...' : 'Write your message...'}
                                    className="w-full resize-none px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-[#0E1012] text-zinc-900 dark:text-zinc-100 text-sm focus:outline-none focus:ring-2 focus:ring-marine-cyan/50"
                                />
                            </div>

                            <div className="flex justify-end gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowNewModal(false)}
                                    className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 text-sm hover:bg-zinc-50 dark:hover:bg-[#0E1012] transition-colors"
                                >
                                    {isAr ? 'إلغاء' : 'Cancel'}
                                </button>
                                <button
                                    type="submit"
                                    disabled={creating || !newConv.vendorId || !newConv.title.trim() || !newConv.message.trim()}
                                    className="inline-flex items-center gap-2 px-5 py-2 bg-marine-cyan hover:bg-[#b55d16] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                                >
                                    {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                                    {isAr ? 'بدء المحادثة' : 'Start Conversation'}
                                </button>
                            </div>
                        </form>
                    </div>
                </Overlay>
            )}
        </div>
    );
}