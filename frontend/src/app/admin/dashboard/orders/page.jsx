'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from '../../../../lib/navigation';
import { Loader2, Search, ShoppingCart, Filter, X, ChevronDown, Calendar, PhoneCall } from 'lucide-react';
import { adminApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import PaginationControls from '../../../../components/dashboard/PaginationControls';
import { ORDER_STATUS_META, ORDER_STATUS_VALUES, getOrderStatusLabel, getOrderStatusColor } from '../../../../lib/orderStatus';
import usePageSize from '../../../../lib/usePageSize';
import { orgTerms } from '../../../../lib/orgTerms';


const STATUS_OPTIONS = [
    { value: '', label_en: 'All Statuses', label_ar: 'كل الحالات' },
    ...ORDER_STATUS_VALUES.map((value) => ({ value, label_en: ORDER_STATUS_META[value].label_en, label_ar: ORDER_STATUS_META[value].label_ar })),
];

/**
 * The phone-confirmation queue.
 *
 * Raised only when WhatsApp gave up on an order, so this filter is how the order team finds
 * the customers nobody has spoken to. "open" is the working set: never called, plus called
 * and nobody answered.
 */
const CONFIRMATION_OPTIONS = [
    { value: '', label_en: 'Any confirmation', label_ar: 'كل حالات التأكيد' },
    { value: 'open', label_en: 'Needs a call', label_ar: 'محتاج مكالمة' },
    { value: 'needs_call', label_en: 'Never called', label_ar: 'لسه محدش كلّمه' },
    { value: 'no_answer', label_en: 'No answer', label_ar: 'مردش' },
    { value: 'confirmed', label_en: 'Confirmed by phone', label_ar: 'مؤكد تليفونياً' },
    { value: 'refused', label_en: 'Refused', label_ar: 'رفض الأوردر' },
];

/** Row badge for a parcel whose customer WhatsApp could not reach. `pending` shows nothing:
 *  it is the normal state and a badge on every order would say nothing. */
const CONFIRMATION_BADGE = {
    needs_call: { cls: 'bg-red-500/15 text-red-600', en: 'Needs call', ar: 'محتاج مكالمة' },
    no_answer: { cls: 'bg-amber-500/15 text-amber-600', en: 'No answer', ar: 'مردش' },
    refused: { cls: 'bg-red-500/15 text-red-600', en: 'Refused', ar: 'رفض' },
    confirmed: { cls: 'bg-emerald-500/15 text-emerald-600', en: 'Confirmed by call', ar: 'مؤكد تليفونياً' },
};

const PAYMENT_OPTIONS = [
    { value: '', label_en: 'All Payments', label_ar: 'كل المدفوعات' },
    { value: 'pending', label_en: 'Pending', label_ar: 'قيد الانتظار' },
    { value: 'paid', label_en: 'Paid', label_ar: 'مدفوع' },
    { value: 'failed', label_en: 'Failed', label_ar: 'فشل' },
    { value: 'refunded', label_en: 'Refunded', label_ar: 'مرتجع' },
];

const PAYMENT_COLORS = {
    pending: 'bg-amber-500/20 text-amber-500',
    paid: 'bg-emerald-500/20 text-emerald-500',
    failed: 'bg-red-500/20 text-red-500',
    refunded: 'bg-zinc-500/20 text-zinc-500',
};

export default function AdminOrdersPage() {
    const router = useRouter();
    const { language, siteSettings } = useApp();
    const isAr = language === 'ar';
    const currency = siteSettings?.currency || 'QAR';

    const [orders, setOrders] = useState([]);
    const [vendors, setVendors] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [confirmationFilter, setConfirmationFilter] = useState('');
    const [paymentFilter, setPaymentFilter] = useState('');
    const [vendorFilter, setVendorFilter] = useState('');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('admin.orders', 20);
    const [totalCount, setTotalCount] = useState(0);
    // Counted by the server over every order the filters match, not the page on screen.
    const [stats, setStats] = useState(null);
    const [showFilters, setShowFilters] = useState(false);
    const [deletingId, setDeletingId] = useState('');

    const fetchOrders = async () => {
        setLoading(true);
        setError('');
        try {
            const params = { page, limit: pageSize };
            if (search) params.search = search;
            if (statusFilter) params.status = statusFilter;
            if (confirmationFilter) params.confirmation = confirmationFilter;
            if (paymentFilter) params.paymentStatus = paymentFilter;
            if (vendorFilter) params.vendorId = vendorFilter;
            if (fromDate) params.from = fromDate;
            if (toDate) params.to = toDate;

            const data = await adminApi.getOrders(params);
            setOrders(data.orders || []);
            setTotalCount(data.pagination?.total || 0);
            setStats(data.stats || null);
            setTotalPages(data.pagination?.pages || 1);
        } catch (err) {
            setError(err.message || 'Failed to load orders');
        } finally {
            setLoading(false);
        }
    };

    const fetchVendors = async () => {
        try {
            const data = await adminApi.getVendorsForFilter();
            setVendors(data.vendors || []);
        } catch (err) {
            console.error('Failed to load vendors for filter', err);
        }
    };

    useEffect(() => { fetchVendors(); }, []);
    useEffect(() => { fetchOrders(); }, [page, pageSize, statusFilter, confirmationFilter, paymentFilter, vendorFilter, fromDate, toDate]);

    useEffect(() => { setPage(1); }, [search]);

    const filteredBySearch = useMemo(() => {
        if (!search) return orders;
        const q = search.toLowerCase();
        return orders.filter(o =>
            o.reference?.toLowerCase().includes(q) ||
            o.user_name?.toLowerCase().includes(q) ||
            o.shipping_address?.recipient_name?.toLowerCase().includes(q) ||
            o.shipping_address?.phone?.includes(q)
        );
    }, [orders, search]);

    const deleteOrder = async (orderId) => {
        const ok = confirm(isAr ? 'هل تريد حذف هذا الطلب نهائياً؟' : 'Are you sure you want to delete this order?');
        if (!ok) return;

        // An order that already reached a courier has real parcels out there. Deleting it
        // here alone leaves those parcels alive at the courier, so the admin decides.
        const target = orders.find(o => o._id === orderId);
        const courierShipments = (target?.shipments || []).filter(s => s.tracking_number || s.bosta_tracking_number);
        let cancelAtCourier = false;
        if (courierShipments.length) {
            const numbers = courierShipments.map(s => s.tracking_number || s.bosta_tracking_number).join(', ');
            cancelAtCourier = confirm(isAr
                ? `الطلب ده ليه ${courierShipments.length} شحنة عند شركة الشحن (${numbers}).\nتحب نلغيها عندهم كمان؟\n\nموافق = احذف من عندنا ومن شركة الشحن\nإلغاء = احذف من عندنا بس`
                : `This order has ${courierShipments.length} shipment(s) at the courier (${numbers}).\nCancel them at the courier too?\n\nOK = delete here and at the courier\nCancel = delete here only`);
        }

        setDeletingId(orderId);
        try {
            const res = await adminApi.deleteOrder(orderId, { cancelAtCourier });
            setOrders(prev => prev.filter(o => o._id !== orderId));
            const results = res?.courier_results || [];
            const problems = results.filter(r => r.result !== 'cancelled');
            if (cancelAtCourier && results.length) {
                const lines = results.map(r => `${r.tracking_number || '-'}: ${r.result === 'cancelled'
                    ? (isAr ? 'اتلغت عند شركة الشحن' : 'cancelled at the courier')
                    : r.result === 'unsupported'
                        ? (isAr ? 'الشركة دي مفيش عندها إلغاء بالـ API — لازم تلغيها يدوي' : 'no cancellation API for this courier — cancel it manually')
                        : (isAr ? `الشركة رفضت الإلغاء: ${r.message}` : `the courier refused: ${r.message}`)}`);
                alert((problems.length
                    ? (isAr ? 'الطلب اتحذف من عندنا، لكن في شحنات محتاجة تدخل يدوي:\n' : 'Order deleted here, but some shipments need manual action:\n')
                    : (isAr ? 'الطلب اتحذف والشحنات اتلغت عند شركة الشحن:\n' : 'Order deleted and shipments cancelled at the courier:\n')) + lines.join('\n'));
            }
        } catch (err) {
            alert(err.message);
        } finally {
            setDeletingId('');
        }
    };

    // In the order the statuses happen; one the page does not know yet still gets its card.
    const statusesWithOrders = [
        ...ORDER_STATUS_VALUES,
        ...Object.keys(stats?.by_status || {}).filter((status) => !ORDER_STATUS_META[status]),
    ].filter((status) => stats?.by_status?.[status] > 0);

    const hasActiveFilters = statusFilter || confirmationFilter || paymentFilter || vendorFilter || fromDate || toDate;

    const clearFilters = () => {
        setStatusFilter('');
        setConfirmationFilter('');
        setPaymentFilter('');
        setVendorFilter('');
        setFromDate('');
        setToDate('');
    };

    const label = (opts, val) => opts.find(o => o.value === val)?.label_en || opts.find(o => o.value === val)?.label_ar || val;

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-wide">
                        {isAr ? 'إدارة الطلبات' : 'Orders'}
                    </h1>
                    <p className="text-sm text-zinc-500 mt-1">
                        {isAr ? 'عرض وتتبع جميع الطلبات على الموقع.' : 'View and track all orders across the platform.'}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowFilters(f => !f)}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${
                            showFilters ? 'bg-marine-cyan text-white border-marine-cyan' : 'bg-white dark:bg-[#14171A] text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-white/10 hover:border-marine-cyan/30'
                        }`}
                    >
                        <Filter size={15} />
                        {isAr ? 'تصفية' : 'Filter'}
                        {hasActiveFilters && (
                            <span className="w-2 h-2 rounded-full bg-white" />
                        )}
                    </button>
                    {hasActiveFilters && (
                        <button
                            onClick={clearFilters}
                            className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold text-red-500 bg-red-500/10 hover:bg-red-500/20 transition-colors"
                        >
                            <X size={13} />
                            {isAr ? 'مسح' : 'Clear'}
                        </button>
                    )}
                </div>
            </div>

            {/* Filters Panel */}
            {showFilters && (
                <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5 shadow-sm space-y-4 animate-in slide-in-from-top-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1.5">
                                {isAr ? 'حالة الطلب' : 'Order Status'}
                            </label>
                            <div className="relative">
                                <select
                                    value={statusFilter}
                                    onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
                                    className="w-full appearance-none bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:border-marine-cyan pr-8 cursor-pointer"
                                >
                                    {STATUS_OPTIONS.map(o => (
                                        <option key={o.value} value={o.value}>{isAr ? o.label_ar : o.label_en}</option>
                                    ))}
                                </select>
                                <ChevronDown size={14} className="absolute end-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1.5">
                                {isAr ? 'تأكيد العميل' : 'Customer Confirmation'}
                            </label>
                            <div className="relative">
                                <select
                                    value={confirmationFilter}
                                    onChange={e => { setConfirmationFilter(e.target.value); setPage(1); }}
                                    className="w-full appearance-none bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:border-marine-cyan pr-8 cursor-pointer"
                                >
                                    {CONFIRMATION_OPTIONS.map(o => (
                                        <option key={o.value} value={o.value}>{isAr ? o.label_ar : o.label_en}</option>
                                    ))}
                                </select>
                                <ChevronDown size={14} className="absolute end-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1.5">
                                {isAr ? 'حالة الدفع' : 'Payment Status'}
                            </label>
                            <div className="relative">
                                <select
                                    value={paymentFilter}
                                    onChange={e => { setPaymentFilter(e.target.value); setPage(1); }}
                                    className="w-full appearance-none bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:border-marine-cyan pr-8 cursor-pointer"
                                >
                                    {PAYMENT_OPTIONS.map(o => (
                                        <option key={o.value} value={o.value}>{isAr ? o.label_ar : o.label_en}</option>
                                    ))}
                                </select>
                                <ChevronDown size={14} className="absolute end-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1.5">
                                {isAr ? 'البائع' : 'Vendor'}
                            </label>
                            <div className="relative">
                                <select
                                    value={vendorFilter}
                                    onChange={e => { setVendorFilter(e.target.value); setPage(1); }}
                                    className="w-full appearance-none bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:border-marine-cyan pr-8 cursor-pointer"
                                >
                                    <option value="">{isAr ? 'كل التجار' : 'All Vendors'}</option>
                                    {vendors.map(v => (
                                        <option key={v._id} value={v._id}>
                                            {v.store_name || v.store_username}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown size={14} className="absolute end-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1.5">
                                    {isAr ? 'من تاريخ' : 'From Date'}
                                </label>
                                <div className="relative">
                                    <Calendar size={13} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                                    <input
                                        type="date"
                                        value={fromDate}
                                        onChange={e => { setFromDate(e.target.value); setPage(1); }}
                                        className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl ps-8 pe-3 py-2.5 text-xs focus:outline-none focus:border-marine-cyan"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1.5">
                                    {isAr ? 'إلى تاريخ' : 'To Date'}
                                </label>
                                <div className="relative">
                                    <Calendar size={13} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                                    <input
                                        type="date"
                                        value={toDate}
                                        onChange={e => { setToDate(e.target.value); setPage(1); }}
                                        className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl ps-8 pe-3 py-2.5 text-xs focus:outline-none focus:border-marine-cyan"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Stats */}
            <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                    <StatPill label={isAr ? 'إجمالي الطلبات' : 'Total Orders'} value={totalCount} tone="text-marine-primary" />
                    <StatPill label={isAr ? 'طلبات الأفراد' : 'Individuals'} value={stats?.individual ?? 0} />
                    <StatPill label={isAr ? 'طلبات الشركات' : 'Companies'} value={stats?.company ?? 0} />
                </div>
                {/* Every status that has orders in it: together they add up to the total. */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                    {statusesWithOrders.map((status) => (
                        <StatPill
                            key={status}
                            label={getOrderStatusLabel(status, isAr)}
                            value={stats.by_status[status]}
                            tone={getOrderStatusColor(status).split(' ').slice(1).join(' ')}
                        />
                    ))}
                </div>
            </div>

            {/* Search + Table */}
            <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-zinc-100 dark:border-white/5">
                    <div className="relative max-w-lg">
                        <Search size={17} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                        <input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder={isAr ? 'ابحث برقم الطلب أو اسم العميل أو الهاتف' : 'Search by order ID, customer name, or phone'}
                            className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl ps-10 pe-4 py-2.5 text-sm focus:outline-none focus:border-marine-cyan"
                        />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[900px]">
                        <thead>
                            <tr className="bg-zinc-50/80 dark:bg-white/[0.03] border-b border-zinc-100 dark:border-white/5">
                                <th className="text-start px-5 py-3 text-xs font-bold text-zinc-400 uppercase tracking-widest whitespace-nowrap">
                                    {isAr ? 'رقم الطلب' : 'Order ID'}
                                </th>
                                <th className="text-start px-4 py-3 text-xs font-bold text-zinc-400 uppercase tracking-widest whitespace-nowrap">
                                    {isAr ? 'العميل' : 'Customer'}
                                </th>
                                <th className="text-start px-4 py-3 text-xs font-bold text-zinc-400 uppercase tracking-widest whitespace-nowrap">
                                    {isAr ? 'إجمالي' : 'Total'}
                                </th>
                                <th className="text-start px-4 py-3 text-xs font-bold text-zinc-400 uppercase tracking-widest whitespace-nowrap">
                                    {isAr ? 'الدفع' : 'Payment'}
                                </th>
                                <th className="text-start px-4 py-3 text-xs font-bold text-zinc-400 uppercase tracking-widest whitespace-nowrap">
                                    {isAr ? 'الحالة' : 'Status'}
                                </th>
                                <th className="text-start px-4 py-3 text-xs font-bold text-zinc-400 uppercase tracking-widest whitespace-nowrap">
                                    {isAr ? 'التجار' : 'Vendors'}
                                </th>
                                <th className="text-start px-4 py-3 text-xs font-bold text-zinc-400 uppercase tracking-widest whitespace-nowrap">
                                    {isAr ? 'التاريخ' : 'Date'}
                                </th>
                                <th className="text-end px-4 py-3 text-xs font-bold text-zinc-400 uppercase tracking-widest">
                                    {isAr ? 'إجراء' : 'Action'}
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                            {loading ? (
                                <tr>
                                    <td colSpan={8} className="py-16 text-center">
                                        <Loader2 size={28} className="animate-spin text-marine-primary mx-auto" />
                                    </td>
                                </tr>
                            ) : filteredBySearch.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="py-16 text-center">
                                        <ShoppingCart size={36} className="mx-auto text-zinc-200 mb-3" />
                                        <p className="text-zinc-500 font-semibold">{isAr ? 'لا توجد طلبات مطابقة' : 'No orders found'}</p>
                                    </td>
                                </tr>
                            ) : (
                                filteredBySearch.map(order => (
                                    <tr
                                        key={order._id}
                                        onClick={() => router.push(`/admin/dashboard/orders/${order._id}`)}
                                        className="hover:bg-zinc-50/60 dark:hover:bg-white/[0.02] transition-colors cursor-pointer group"
                                    >
                                        <td className="px-5 py-4">
                                            <button
                                                onClick={() => router.push(`/admin/dashboard/orders/${order._id}`)}
                                                className="text-marine-primary font-bold hover:underline text-sm"
                                            >
                                                #{order.reference?.slice(-8).toUpperCase()}
                                            </button>
                                        </td>
                                        <td className="px-4 py-4">
                                            <div className="font-bold text-zinc-900 dark:text-white text-sm">{order.user_name}</div>
                                            <div className="text-zinc-400 text-xs">{order.user_phone}</div>
                                        </td>
                                        <td className="px-4 py-4">
                                            <span className="font-black text-zinc-900 dark:text-white">{currency} {order.total_price?.toFixed(2)}</span>
                                        </td>
                                        <td className="px-4 py-4">
                                            <span className={`inline-flex items-center text-[10px] px-2 py-1 rounded-full font-bold uppercase tracking-widest ${PAYMENT_COLORS[order.transaction?.status] || PAYMENT_COLORS.pending}`}>
                                                {order.transaction?.status || 'pending'}
                                            </span>
                                            <div className="text-[10px] text-zinc-400 mt-0.5">{order.transaction?.payment_method?.replace('_', ' ')}</div>
                                        </td>
                                        <td className="px-4 py-4">
                                            <span className={`inline-flex items-center text-[10px] px-2 py-1 rounded-full font-bold uppercase tracking-widest ${getOrderStatusColor(order.status)}`}>
                                                {getOrderStatusLabel(order.status, isAr)}
                                            </span>
                                            {/* A company order still collecting in its batch cannot be sent yet —
                                                said on the list, before anyone opens it to try. */}
                                            {order.company && (
                                                <div className="mt-1">
                                                    <span className="inline-flex items-center text-[10px] px-2 py-1 rounded-full font-bold bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">
                                                        {(order.sub_orders || []).some((s) => s.status === 'held_in_batch')
                                                            ? (isAr ? `طلب ${orgTerms(order.company.org_type, true).one} · بيتجمّع 🧺` : `${orgTerms(order.company.org_type, false).One} · collecting 🧺`)
                                                            : (isAr ? `طلب ${orgTerms(order.company.org_type, true).one}` : `${orgTerms(order.company.org_type, false).One} order`)}
                                                    </span>
                                                </div>
                                            )}
                                            {CONFIRMATION_BADGE[order.customer_confirmation?.status] && (
                                                <div className={`inline-flex items-center gap-1 mt-1 text-[10px] px-2 py-1 rounded-full font-bold ${CONFIRMATION_BADGE[order.customer_confirmation.status].cls}`}>
                                                    <PhoneCall size={9} />
                                                    {isAr
                                                        ? CONFIRMATION_BADGE[order.customer_confirmation.status].ar
                                                        : CONFIRMATION_BADGE[order.customer_confirmation.status].en}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-4">
                                            <span className="text-sm font-bold text-zinc-600 dark:text-zinc-300">{order.vendor_count}</span>
                                            <div className="text-[10px] text-zinc-400 mt-0.5">{order.item_count} {isAr ? 'منتج' : 'items'}</div>
                                        </td>
                                        <td className="px-4 py-4 whitespace-nowrap">
                                            <div className="text-xs font-medium text-zinc-500">
                                                {new Date(order.created_at).toLocaleDateString(isAr ? 'ar-u-ca-gregory' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 text-end">
                                            <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => router.push(`/admin/dashboard/orders/${order._id}`)}
                                                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-marine-cyan/10 text-marine-primary hover:bg-marine-cyan/20 transition-colors"
                                                >
                                                    {isAr ? 'عرض' : 'View'}
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); deleteOrder(order._id); }}
                                                    disabled={deletingId === order._id}
                                                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500/10 text-red-500 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
                                                >
                                                    {deletingId === order._id ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                <PaginationControls
                    page={page}
                    pageSize={pageSize}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
                    total={totalCount}
                    onPageChange={setPage}
                    labels={{
                        showing: isAr ? 'عرض' : 'Showing',
                        of: isAr ? 'من' : 'of',
                        previous: isAr ? 'السابق' : 'Previous',
                        next: isAr ? 'التالي' : 'Next',
                    }}
                />
            </div>
        </div>
    );
}

function StatPill({ label, value, tone = 'text-zinc-900 dark:text-white' }) {
    return (
        <div className="rounded-2xl border border-zinc-200 dark:border-white/5 bg-white dark:bg-[#14171A] p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1">{label}</p>
            <p className={`text-2xl font-black ${tone}`}>{value}</p>
        </div>
    );
}
