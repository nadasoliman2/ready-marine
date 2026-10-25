'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Search, CheckCircle2, AlertTriangle, X, CreditCard, User, Calendar, Gift, UserX, Clock, Wallet, TrendingUp, ShieldCheck, Hourglass, Layers, RefreshCw } from 'lucide-react';
import { adminSubscriptionApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import PaginationControls from '../../../../components/dashboard/PaginationControls';
import usePageSize from '../../../../lib/usePageSize';
import Overlay from '../../../../components/Overlay';


const money = (n) => `${Number(n || 0).toLocaleString()} EGP`;

/**
 * What a statistics card lists when clicked. `segment` is the card's own query on the server
 * (subscriptionSegmentFilter / paymentSegmentFilter there), so the list holds its number.
 */
const SEGMENT_LABELS = {
    active: ['نشط الآن', 'Active now'],
    trial: ['تجريبي', 'Free trial'],
    admin_grant: ['منحة إدارية', 'Admin grant'],
    paid: ['اشتراك مدفوع', 'Paying'],
    expiring_7: ['ينتهي خلال ٧ أيام', 'Expiring in 7 days'],
    expiring_30: ['ينتهي خلال ٣٠ يوم', 'Expiring in 30 days'],
    expired: ['منتهي', 'Expired'],
    awaiting_sweep: ['نشط وتاريخه انتهى', 'Active past its expiry'],
    auto_renew: ['تجديد تلقائي مفعّل', 'Auto-renew on'],
    started_this_month: ['بدأت هذا الشهر', 'Started this month'],
};
const PAYMENT_SEGMENT_LABELS = {
    paid: ['المدفوعات المحصَّلة', 'Collected payments'],
    paid_this_month: ['تحصيل هذا الشهر', 'Collected this month'],
    pending: ['مدفوعات معلقة', 'Pending payments'],
};

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleDateString();
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString();
}

function StatusBadge({ status, isAr }) {
    const map = {
        active:         { label: isAr ? 'نشط' : 'Active',          cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400', icon: <CheckCircle2 size={12} /> },
        trial_active:   { label: isAr ? 'تجريبي' : 'Trial Active', cls: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400',                 icon: <Gift size={12} /> },
        expired:        { label: isAr ? 'منتهي' : 'Expired',       cls: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400',                  icon: <AlertTriangle size={12} /> },
        cancelled:      { label: isAr ? 'ملغي' : 'Cancelled',      cls: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400',                  icon: <AlertTriangle size={12} /> },
        not_subscribed: { label: isAr ? 'غير مشترك' : 'Not Subscribed', cls: 'bg-zinc-100 text-zinc-500 dark:bg-white/5 dark:text-zinc-400',            icon: <UserX size={12} /> },
        suspended:      { label: isAr ? 'معلق' : 'Suspended',      cls: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',          icon: <AlertTriangle size={12} /> },
    };
    const s = map[status] || { label: status, cls: 'bg-zinc-100 text-zinc-500', icon: null };
    return (
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase ${s.cls}`}>
            {s.icon}{s.label}
        </span>
    );
}

function PaymentStatusBadge({ status }) {
    const cls = status === 'paid'
        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
        : status === 'pending'
            ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'
            : 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400';
    return <span className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${cls}`}>{status || 'pending'}</span>;
}

export default function AdminSubscriptionsPage() {
    const { language } = useApp();
    const isAr = language === 'ar';

    /* --- active subscriptions tab state --- */
    const [subscriptions, setSubscriptions] = useState([]);
    const [packages, setPackages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [packageFilter, setPackageFilter] = useState('');
    const [trialFilter, setTrialFilter] = useState('');   // '' | 'true' | 'false'
    const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('admin.subscriptions', 10);
    const [total, setTotal] = useState(0);
    const [stats, setStats] = useState(null);
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [cancelVendorId, setCancelVendorId] = useState('');
    const [cancelling, setCancelling] = useState(false);

    /* --- not-subscribed tab state --- */
    const [activeTab, setActiveTab] = useState('subscriptions'); // 'subscriptions' | 'transactions' | 'not_subscribed'
    const [nsVendors, setNsVendors] = useState([]);
    const [nsLoading, setNsLoading] = useState(false);
    const [nsSearch, setNsSearch] = useState('');
    const [nsPage, setNsPage] = useState(1);
    const [nsTotal, setNsTotal] = useState(0);
    const [transactions, setTransactions] = useState([]);
    const [txLoading, setTxLoading] = useState(false);
    const [txSearch, setTxSearch] = useState('');
    const [txStatus, setTxStatus] = useState('');
    const [txAction, setTxAction] = useState('');
    const [txPage, setTxPage] = useState(1);
    const [txTotal, setTxTotal] = useState(0);

    /* --- the statistics card being listed --- */
    const [segment, setSegment] = useState('');      // the subscriptions a card counts
    const [txSegment, setTxSegment] = useState('');  // the payments a money card counts
    const [pickedCard, setPickedCard] = useState('');
    const listRef = useRef(null);

    // A click on a number lists what it counts: that card's query and no other filter.
    const pickCard = (card) => {
        setPickedCard(card.key);
        setActiveTab(card.tab);
        if (card.tab === 'subscriptions') {
            setSegment(card.segment || '');
            setPackageFilter(card.packageId || '');
            setStatusFilter('');
            setTrialFilter('');
            setSearch('');
            setPage(1);
        } else if (card.tab === 'transactions') {
            setTxSegment(card.segment || '');
            setTxStatus('');
            setTxAction('');
            setTxSearch('');
            setTxPage(1);
        } else {
            setNsSearch('');
            setNsPage(1);
        }
        listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const loadSubscriptions = async () => {
        setLoading(true);
        try {
            const params = { page, limit: pageSize };
            if (statusFilter) params.status = statusFilter;
            if (packageFilter) params.package_id = packageFilter;
            if (trialFilter !== '') params.is_free_trial = trialFilter;
            if (segment) params.segment = segment;

            const [subData, pkgData] = await Promise.all([
                adminSubscriptionApi.getAllSubscriptions(params),
                adminSubscriptionApi.getPackages(),
            ]);

            setSubscriptions(subData.subscriptions || []);
            setPackages(pkgData.packages || []);
            setTotal(subData.pagination?.total || 0);

            // Statistics are their own query on purpose: they describe the whole
            // collection, so they must not move when a filter or page changes.
            adminSubscriptionApi.getStats()
                .then((res) => setStats(res.stats || null))
                .catch(() => setStats(null));
        } catch (err) {
            setError(err.message || 'Failed to load subscriptions');
        } finally {
            setLoading(false);
        }
    };

    const loadNotSubscribed = async () => {
        setNsLoading(true);
        try {
            const params = { page: nsPage, limit: pageSize };
            if (nsSearch.trim()) params.q = nsSearch.trim();
            const data = await adminSubscriptionApi.getNotSubscribedVendors(params);
            setNsVendors(data.vendors || []);
            setNsTotal(data.pagination?.total || 0);
        } catch (err) {
            setError(err.message || 'Failed to load vendors');
        } finally {
            setNsLoading(false);
        }
    };

    const loadTransactions = async () => {
        setTxLoading(true);
        try {
            const params = { page: txPage, limit: pageSize };
            if (txSearch.trim()) params.q = txSearch.trim();
            if (txStatus) params.status = txStatus;
            if (txAction) params.action = txAction;
            if (txSegment) params.segment = txSegment;
            const data = await adminSubscriptionApi.getSubscriptionPayments(params);
            setTransactions(data.payments || []);
            setTxTotal(data.pagination?.total || 0);
        } catch (err) {
            setError(err.message || 'Failed to load subscription transactions');
        } finally {
            setTxLoading(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'subscriptions') loadSubscriptions();
    }, [page, pageSize, statusFilter, packageFilter, trialFilter, segment, activeTab]);

    useEffect(() => {
        if (activeTab === 'not_subscribed') loadNotSubscribed();
    }, [nsPage, pageSize, nsSearch, activeTab]);

    useEffect(() => {
        if (activeTab === 'transactions') loadTransactions();
    }, [txPage, pageSize, txSearch, txStatus, txAction, txSegment, activeTab]);

    const filtered = subscriptions.filter(sub => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        const vendor = sub.vendor_id;
        return (vendor?.store_name || '').toLowerCase().includes(q)
            || (vendor?.store_username || '').toLowerCase().includes(q)
            || (vendor?.email || '').toLowerCase().includes(q);
    });

    const cancelSubscription = async () => {
        if (!cancelVendorId) return;
        setCancelling(true);
        try {
            await adminSubscriptionApi.cancelVendorSubscription(cancelVendorId);
            setShowCancelModal(false);
            setCancelVendorId('');
            loadSubscriptions();
        } catch (err) {
            setError(err.message || 'Failed to cancel subscription');
        } finally {
            setCancelling(false);
        }
    };


    const selectClass = 'bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-3 text-sm focus:outline-none';

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <div>
                <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-wide">
                    {isAr ? 'اشتراكات التجار' : 'Vendor Subscriptions'}
                </h1>
                <p className="text-sm text-zinc-500 mt-1">
                    {isAr ? 'مراقبة جميع اشتراكات التجار.' : 'Monitor all vendor subscriptions.'}
                </p>
            </div>

            <SubscriptionStats stats={stats} isAr={isAr} picked={pickedCard} onPick={pickCard} />

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-bold">
                    {error}
                </div>
            )}

            {/* Tabs */}
            <div ref={listRef} className="flex gap-2 border-b border-zinc-200 dark:border-white/5 scroll-mt-4">
                <button
                    onClick={() => setActiveTab('subscriptions')}
                    className={`px-5 py-2.5 text-sm font-black rounded-t-xl transition-colors ${activeTab === 'subscriptions' ? 'bg-marine-cyan text-white' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'}`}
                >
                    {isAr ? 'الاشتراكات' : 'Subscriptions'}
                </button>
                <button
                    onClick={() => setActiveTab('transactions')}
                    className={`inline-flex items-center gap-2 px-5 py-2.5 text-sm font-black rounded-t-xl transition-colors ${activeTab === 'transactions' ? 'bg-marine-cyan text-white' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'}`}
                >
                    <CreditCard size={14} />
                    {isAr ? 'المعاملات' : 'Transactions'}
                </button>
                <button
                    onClick={() => setActiveTab('not_subscribed')}
                    className={`inline-flex items-center gap-2 px-5 py-2.5 text-sm font-black rounded-t-xl transition-colors ${activeTab === 'not_subscribed' ? 'bg-marine-cyan text-white' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'}`}
                >
                    <UserX size={14} />
                    {isAr ? 'غير مشتركين' : 'Not Subscribed'}
                </button>
            </div>

            {/* ── Subscriptions Tab ── */}
            {activeTab === 'subscriptions' && (
                <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm overflow-hidden">
                    {segment && SEGMENT_LABELS[segment] && (
                        <SegmentChip label={SEGMENT_LABELS[segment][isAr ? 0 : 1]} count={total} isAr={isAr}
                            onClear={() => { setSegment(''); setPackageFilter(''); setPickedCard(''); setPage(1); }} />
                    )}
                    <div className="p-4 border-b border-zinc-100 dark:border-white/5 flex flex-col md:flex-row gap-3 flex-wrap">
                        <div className="relative flex-1 max-w-md">
                            <Search size={18} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                                placeholder={isAr ? 'ابحث باسم المتجر...' : 'Search by store name...'}
                                className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl ps-10 pe-4 py-3 text-sm focus:outline-none focus:border-marine-cyan" />
                        </div>
                        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className={selectClass}>
                            <option value="">{isAr ? 'كل الحالات' : 'All Status'}</option>
                            <option value="active">{isAr ? 'نشط' : 'Active'}</option>
                            <option value="trial_active">{isAr ? 'تجريبي' : 'Trial Active'}</option>
                            <option value="expired">{isAr ? 'منتهي' : 'Expired'}</option>
                            <option value="cancelled">{isAr ? 'ملغي' : 'Cancelled'}</option>
                        </select>
                        <select value={packageFilter} onChange={e => { setPackageFilter(e.target.value); setPage(1); }} className={selectClass}>
                            <option value="">{isAr ? 'كل الباقات' : 'All Packages'}</option>
                            {packages.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
                        </select>
                        <select value={trialFilter} onChange={e => { setTrialFilter(e.target.value); setPage(1); }} className={selectClass}>
                            <option value="">{isAr ? 'كل أنواع الباقات' : 'All Plan Types'}</option>
                            <option value="true">{isAr ? 'تجريبي فقط' : 'Trial Only'}</option>
                            <option value="false">{isAr ? 'مدفوع فقط' : 'Paid Only'}</option>
                        </select>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-sm whitespace-nowrap">
                            <thead className="bg-zinc-50 dark:bg-white/[0.02] border-b border-zinc-200 dark:border-white/5">
                                <tr className={isAr ? 'text-right' : 'text-left'}>
                                    <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'البائع' : 'Vendor'}</th>
                                    <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'الباقة' : 'Package'}</th>
                                    <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'يبدأ' : 'Started'}</th>
                                    <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'ينتهي' : 'Expires'}</th>
                                    <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'الحالة' : 'Status'}</th>
                                    <th className={`px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px] ${isAr ? 'text-left' : 'text-right'}`}>{isAr ? 'إجراءات' : 'Actions'}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                {filtered.map(sub => {
                                    const pkg = sub.package_id;
                                    const vendor = sub.vendor_id;
                                    const isActive = sub.status === 'active' || sub.status === 'trial_active';
                                    const isExpired = new Date(sub.expires_at) < new Date();

                                    return (
                                        <tr key={sub._id} className="hover:bg-zinc-50 dark:hover:bg-white/[0.02]">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-9 h-9 rounded-xl bg-marine-cyan/10 text-marine-primary flex items-center justify-center font-black text-xs">
                                                        {(vendor?.store_name || 'V').charAt(0).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <p className="font-black text-zinc-900 dark:text-white">{vendor?.store_name || '-'}</p>
                                                        <p className="text-xs text-zinc-500">@{vendor?.store_username}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    {sub.is_free_trial && <Gift size={13} className="text-emerald-500 flex-shrink-0" />}
                                                    <div>
                                                        <p className="font-bold text-zinc-700 dark:text-zinc-200">{pkg?.name || '-'}</p>
                                                        <p className="text-xs text-zinc-400">{pkg?.max_products} {isAr ? 'منتج' : 'products'}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className="text-xs font-bold text-zinc-600 dark:text-zinc-300">{formatDate(sub.started_at)}</p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className={`text-xs font-bold ${isActive && isExpired ? 'text-red-600' : 'text-zinc-600 dark:text-zinc-300'}`}>
                                                    {formatDate(sub.expires_at)}
                                                </p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <StatusBadge status={sub.status} isAr={isAr} />
                                            </td>
                                            <td className={`px-6 py-4 ${isAr ? 'text-left' : 'text-right'}`}>
                                                {isActive && (
                                                    <button onClick={() => { setCancelVendorId(vendor?._id); setShowCancelModal(true); }}
                                                        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-black bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400">
                                                        {isAr ? 'إلغاء الاشتراك' : 'Cancel Sub'}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {filtered.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-16 text-center">
                                            <p className="font-bold text-zinc-900 dark:text-white">{isAr ? 'لا توجد اشتراكات' : 'No subscriptions found'}</p>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    <PaginationControls
                        page={page} pageSize={pageSize}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} total={total} onPageChange={setPage}
                        labels={{ showing: isAr ? 'عرض' : 'Showing', of: isAr ? 'من' : 'of', previous: isAr ? 'السابق' : 'Prev', next: isAr ? 'التالي' : 'Next' }}
                    />
                </div>
            )}

            {/* ── Transactions Tab ── */}
            {activeTab === 'transactions' && (
                <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm overflow-hidden">
                    {txSegment && PAYMENT_SEGMENT_LABELS[txSegment] && (
                        <SegmentChip label={PAYMENT_SEGMENT_LABELS[txSegment][isAr ? 0 : 1]} count={txTotal} isAr={isAr}
                            onClear={() => { setTxSegment(''); setPickedCard(''); setTxPage(1); }} />
                    )}
                    <div className="p-4 border-b border-zinc-100 dark:border-white/5 flex flex-col md:flex-row gap-3 flex-wrap">
                        <div className="relative flex-1 max-w-md">
                            <Search size={18} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                            <input value={txSearch} onChange={e => { setTxSearch(e.target.value); setTxPage(1); }}
                                placeholder={isAr ? 'ابحث بالبائع أو الفاتورة...' : 'Search vendor or invoice...'}
                                className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl ps-10 pe-4 py-3 text-sm focus:outline-none focus:border-marine-cyan" />
                        </div>
                        <select value={txStatus} onChange={e => { setTxStatus(e.target.value); setTxPage(1); }} className={selectClass}>
                            <option value="">{isAr ? 'كل حالات الدفع' : 'All Payment Status'}</option>
                            <option value="pending">{isAr ? 'قيد الانتظار' : 'Pending'}</option>
                            <option value="paid">{isAr ? 'مدفوع' : 'Paid'}</option>
                            <option value="failed">{isAr ? 'فشل' : 'Failed'}</option>
                            <option value="expired">{isAr ? 'منتهي' : 'Expired'}</option>
                        </select>
                        <select value={txAction} onChange={e => { setTxAction(e.target.value); setTxPage(1); }} className={selectClass}>
                            <option value="">{isAr ? 'كل العمليات' : 'All Actions'}</option>
                            <option value="purchase">{isAr ? 'شراء' : 'Purchase'}</option>
                            <option value="renew">{isAr ? 'تجديد' : 'Renew'}</option>
                            <option value="resubscribe">{isAr ? 'إعادة اشتراك' : 'Resubscribe'}</option>
                            <option value="change_plan">{isAr ? 'تغيير خطة' : 'Change Plan'}</option>
                        </select>
                    </div>

                    {txLoading ? (
                        <div className="py-16 flex justify-center"><Loader2 size={28} className="animate-spin text-marine-primary" /></div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm whitespace-nowrap">
                                <thead className="bg-zinc-50 dark:bg-white/[0.02] border-b border-zinc-200 dark:border-white/5">
                                    <tr className={isAr ? 'text-right' : 'text-left'}>
                                        <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'البائع' : 'Vendor'}</th>
                                        <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'الباقة' : 'Package'}</th>
                                        <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'العملية' : 'Action'}</th>
                                        <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'المبلغ' : 'Amount'}</th>
                                        <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'الحالة' : 'Status'}</th>
                                        <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'الفاتورة' : 'Invoice'}</th>
                                        <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'الدفع' : 'Payment'}</th>
                                        <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'التاريخ' : 'Date'}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                    {transactions.map(tx => (
                                        <tr key={tx._id} className="hover:bg-zinc-50 dark:hover:bg-white/[0.02]">
                                            <td className="px-6 py-4">
                                                <p className="font-black text-zinc-900 dark:text-white">{tx.vendor_id?.store_name || '-'}</p>
                                                <p className="text-xs text-zinc-500">@{tx.vendor_id?.store_username || '-'}</p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className="font-bold text-zinc-700 dark:text-zinc-200">{tx.package_id?.name || '-'}</p>
                                                <p className="text-xs text-zinc-400">{tx.billing_period}</p>
                                            </td>
                                            <td className="px-6 py-4 text-xs font-black uppercase text-zinc-600 dark:text-zinc-300">{tx.action}</td>
                                            <td className="px-6 py-4 font-black text-zinc-900 dark:text-white">{tx.currency} {Number(tx.amount || 0).toFixed(2)}</td>
                                            <td className="px-6 py-4">
                                                <PaymentStatusBadge status={tx.status} />
                                                {tx.activation_error && <p className="text-[10px] text-red-500 mt-1 max-w-[220px] truncate">{tx.activation_error}</p>}
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className="text-xs font-mono text-zinc-700 dark:text-zinc-200">{tx.invoice_id || '-'}</p>
                                                <p className="text-[10px] font-mono text-zinc-400">{tx.invoice_key || '-'}</p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className="text-xs font-bold text-zinc-700 dark:text-zinc-200">{tx.payment_method || '-'}</p>
                                                <p className="text-[10px] text-zinc-400">{tx.provider || 'fawaterak'} · {tx.provider_mode || '-'}</p>
                                            </td>
                                            <td className="px-6 py-4">
                                                <p className="text-xs font-bold text-zinc-600 dark:text-zinc-300">{formatDateTime(tx.paid_at || tx.createdAt)}</p>
                                                <p className="text-[10px] text-zinc-400">{tx.paid_at ? (isAr ? 'مدفوع' : 'paid') : (isAr ? 'تم الإنشاء' : 'created')}</p>
                                            </td>
                                        </tr>
                                    ))}
                                    {transactions.length === 0 && (
                                        <tr>
                                            <td colSpan={8} className="px-6 py-16 text-center">
                                                <p className="font-bold text-zinc-900 dark:text-white">{isAr ? 'لا توجد معاملات' : 'No transactions found'}</p>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <PaginationControls
                        page={txPage} pageSize={pageSize} total={txTotal} onPageChange={setTxPage}
                        onPageSizeChange={(n) => { setPageSize(n); setTxPage(1); }}
                        labels={{ showing: isAr ? 'عرض' : 'Showing', of: isAr ? 'من' : 'of', previous: isAr ? 'السابق' : 'Prev', next: isAr ? 'التالي' : 'Next' }}
                    />
                </div>
            )}

            {/* ── Not Subscribed Tab ── */}
            {activeTab === 'not_subscribed' && (
                <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-zinc-100 dark:border-white/5">
                        <div className="relative max-w-md">
                            <Search size={18} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                            <input value={nsSearch} onChange={e => { setNsSearch(e.target.value); setNsPage(1); }}
                                placeholder={isAr ? 'ابحث باسم المتجر...' : 'Search by store name...'}
                                className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl ps-10 pe-4 py-3 text-sm focus:outline-none focus:border-marine-cyan" />
                        </div>
                    </div>

                    {nsLoading ? (
                        <div className="py-16 flex justify-center"><Loader2 size={28} className="animate-spin text-marine-primary" /></div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm whitespace-nowrap">
                                <thead className="bg-zinc-50 dark:bg-white/[0.02] border-b border-zinc-200 dark:border-white/5">
                                    <tr className={isAr ? 'text-right' : 'text-left'}>
                                        <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'المتجر' : 'Store'}</th>
                                        <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'البريد' : 'Email'}</th>
                                        <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'حالة الاشتراك' : 'Sub Status'}</th>
                                        <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'تاريخ الإنشاء' : 'Joined'}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                    {nsVendors.map(vendor => (
                                        <tr key={vendor._id} className="hover:bg-zinc-50 dark:hover:bg-white/[0.02]">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-white/5 text-zinc-500 flex items-center justify-center font-black text-xs">
                                                        {(vendor.store_name || 'V').charAt(0).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <p className="font-black text-zinc-900 dark:text-white">{vendor.store_name}</p>
                                                        <p className="text-xs text-zinc-500">@{vendor.store_username}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-xs text-zinc-600 dark:text-zinc-300">{vendor.email}</td>
                                            <td className="px-6 py-4">
                                                <StatusBadge status={vendor.subscription_status} isAr={isAr} />
                                            </td>
                                            <td className="px-6 py-4 text-xs font-bold text-zinc-600 dark:text-zinc-300">
                                                {formatDate(vendor.created_at)}
                                            </td>
                                        </tr>
                                    ))}
                                    {nsVendors.length === 0 && (
                                        <tr>
                                            <td colSpan={4} className="px-6 py-16 text-center">
                                                <p className="font-bold text-zinc-900 dark:text-white">{isAr ? 'لا يوجد تجار غير مشتركين' : 'No unsubscribed vendors found'}</p>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <PaginationControls
                        page={nsPage} pageSize={pageSize} total={nsTotal} onPageChange={setNsPage}
                        onPageSizeChange={(n) => { setPageSize(n); setNsPage(1); }}
                        labels={{ showing: isAr ? 'عرض' : 'Showing', of: isAr ? 'من' : 'of', previous: isAr ? 'السابق' : 'Prev', next: isAr ? 'التالي' : 'Next' }}
                    />
                </div>
            )}

            {showCancelModal && (
                <Overlay className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-sm bg-white dark:bg-[#14171A] rounded-2xl border border-zinc-200 dark:border-white/10 shadow-2xl p-6">
                        <h2 className="text-lg font-black text-zinc-900 dark:text-white mb-2">
                            {isAr ? 'إلغاء الاشتراك' : 'Cancel Subscription'}
                        </h2>
                        <p className="text-sm text-zinc-500 mb-6">
                            {isAr ? 'هل أنت متأكد من إلغاء اشتراك هذا البائع؟ لا يمكن التراجع عن هذا.' : "Are you sure you want to cancel this vendor's subscription? This cannot be undone."}
                        </p>
                        <div className="flex justify-end gap-3">
                            <button onClick={() => setShowCancelModal(false)}
                                className="px-5 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 font-bold">
                                {isAr ? 'إلغاء' : 'Cancel'}
                            </button>
                            <button onClick={cancelSubscription} disabled={cancelling}
                                className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl font-bold">
                                {cancelling ? <Loader2 size={16} className="animate-spin" /> : null}
                                {isAr ? 'نعم، إلغاء' : 'Yes, Cancel'}
                            </button>
                        </div>
                    </div>
                </Overlay>
            )}
        </div>
    );
}


/**
 * The subscription dashboard.
 *
 * Every figure is computed server-side over the whole collection. These cards
 * used to be derived from the current page of the list, so "Total" reported the
 * page size and each number changed as soon as a filter was touched.
 *
 * Grouped by the question being asked: how many subscriptions and of what kind,
 * what is about to run out, and what any of it is worth.
 */
function SubscriptionStats({ stats, isAr, picked = '', onPick }) {
    if (!stats) {
        return (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-[118px] bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 animate-pulse" />
                ))}
            </div>
        );
    }

    const { subscriptions: sub, expiring, vendors, money: cash, activity, per_package: perPackage } = stats;
    // A card's click: which list it opens, and whether it is the one listed now.
    const at = (key, target) => ({ onClick: () => onPick?.({ key, ...target }), active: picked === key });
    const subs = (segment) => ({ tab: 'subscriptions', segment });
    const payments = (segment) => ({ tab: 'transactions', segment });

    return (
        <div className="space-y-4">
            {/* What exists */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon={CreditCard} label={isAr ? 'إجمالي الاشتراكات' : 'Total subscriptions'} value={sub.total} {...at('total', subs(''))} />
                <StatCard icon={CheckCircle2} label={isAr ? 'نشط الآن' : 'Active now'} value={sub.active} tone="green" {...at('active', subs('active'))} />
                <StatCard icon={Gift} label={isAr ? 'تجريبي' : 'Free trial'} value={sub.trial} tone="sky" {...at('trial', subs('trial'))} />
                <StatCard icon={ShieldCheck} label={isAr ? 'منحة إدارية' : 'Admin grant'} value={sub.admin_grant} tone="sky" {...at('admin_grant', subs('admin_grant'))} />
            </div>

            {/* Who is actually paying, and what is running out */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon={Wallet} label={isAr ? 'اشتراك مدفوع' : 'Paying'} value={sub.paid} tone={sub.paid > 0 ? 'green' : 'red'} {...at('paid', subs('paid'))} />
                <StatCard icon={Clock} label={isAr ? 'ينتهي خلال ٧ أيام' : 'Expiring in 7 days'} value={expiring.in_7_days} tone={expiring.in_7_days > 0 ? 'red' : 'green'} {...at('expiring_7', subs('expiring_7'))} />
                <StatCard icon={Hourglass} label={isAr ? 'ينتهي خلال ٣٠ يوم' : 'Expiring in 30 days'} value={expiring.in_30_days} {...at('expiring_30', subs('expiring_30'))} />
                <StatCard icon={AlertTriangle} label={isAr ? 'منتهي' : 'Expired'} value={sub.expired} tone="red" {...at('expired', subs('expired'))} />
            </div>

            {/* Vendors and money */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {/* A subscribed vendor is one with a live subscription: those are listed. */}
                <StatCard icon={User} label={isAr ? 'تجار مشتركون' : 'Subscribed vendors'} value={`${vendors.subscribed} / ${vendors.total}`} tone="green" {...at('subscribed_vendors', subs('active'))} />
                <StatCard icon={UserX} label={isAr ? 'تجار بلا اشتراك' : 'Not subscribed'} value={vendors.not_subscribed} tone="red" {...at('not_subscribed', { tab: 'not_subscribed' })} />
                <StatCard icon={TrendingUp} label={isAr ? 'تحصيل هذا الشهر' : 'Collected this month'} value={money(cash.collected_this_month)} tone="green" {...at('paid_this_month', payments('paid_this_month'))} />
                <StatCard icon={Hourglass} label={isAr ? 'مدفوعات معلقة' : 'Pending payments'} value={`${money(cash.pending_amount)} · ${cash.pending_count}`} tone={cash.pending_count > 0 ? 'red' : 'green'} {...at('pending', payments('pending'))} />
            </div>

            {/* The two figures that need a sentence, not a number */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 p-5">
                    <div className="flex items-center gap-2 text-sm font-bold text-zinc-500 mb-3">
                        <Layers size={16} /> {isAr ? 'التوزيع على الباقات (النشط)' : 'Active by package'}
                    </div>
                    {perPackage.length === 0 ? (
                        <p className="text-sm text-zinc-400">{isAr ? 'لا يوجد' : 'Nothing active.'}</p>
                    ) : (
                        <div className="space-y-2.5">
                            {perPackage.map((p) => {
                                const share = sub.active ? Math.round((p.total / sub.active) * 100) : 0;
                                const key = `package:${p.package_id}`;
                                return (
                                    <button key={String(p.package_id)} type="button"
                                        onClick={() => onPick?.({ key, tab: 'subscriptions', segment: 'active', packageId: String(p.package_id) })}
                                        className={`block w-full text-start rounded-lg -mx-2 px-2 py-1 transition-colors hover:bg-zinc-50 dark:hover:bg-white/5 ${picked === key ? 'ring-2 ring-marine-cyan' : ''}`}>
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="font-bold text-zinc-900 dark:text-white">
                                                {(isAr && p.name_ar) ? p.name_ar : (p.name || (isAr ? 'باقة محذوفة' : 'Deleted package'))}
                                                {p.price > 0 && <span className="text-zinc-400 font-normal"> · {money(p.price)}</span>}
                                            </span>
                                            <span className="tabular-nums font-black text-zinc-900 dark:text-white">{p.total}</span>
                                        </div>
                                        <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-white/5 mt-1.5 overflow-hidden">
                                            <div className="h-full bg-marine-cyan rounded-full" style={{ width: `${share}%` }} />
                                        </div>
                                        {p.trials > 0 && (
                                            <p className="text-[11px] text-zinc-400 mt-1">
                                                {isAr ? `منهم ${p.trials} تجريبي` : `${p.trials} of these are trials`}
                                            </p>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 p-5 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-bold text-zinc-500">
                        <Wallet size={16} /> {isAr ? 'الإيرادات' : 'Revenue'}
                    </div>
                    <Row label={isAr ? 'إجمالي المُحصَّل' : 'Collected all time'} value={money(cash.collected_all_time)} {...at('paid_all', payments('paid'))} />
                    <Row label={isAr ? 'عدد المدفوعات المحصَّلة' : 'Paid transactions'} value={cash.payments_paid} {...at('paid_count', payments('paid'))} />
                    <Row
                        label={isAr ? 'قيمة الاشتراكات المدفوعة النشطة' : 'Active paid contract value'}
                        value={money(cash.active_contract_value)}
                        hint={isAr
                            ? 'سعر الباقة للاشتراكات المدفوعة النشطة — ليس مبلغاً محصَّلاً.'
                            : 'List price of live paying subscriptions — not money collected.'}
                        {...at('contract_value', subs('paid'))}
                    />
                    <Row label={isAr ? 'اشتراكات بدأت هذا الشهر' : 'Started this month'} value={activity.started_this_month} {...at('started_this_month', subs('started_this_month'))} />
                    <Row label={isAr ? 'تجديد تلقائي مفعّل' : 'Auto-renew on'} value={sub.auto_renew} {...at('auto_renew', subs('auto_renew'))} />
                    {sub.awaiting_sweep > 0 && (
                        <button type="button" onClick={at('awaiting_sweep', subs('awaiting_sweep')).onClick}
                            className="w-full text-start flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 hover:bg-amber-100 dark:hover:bg-amber-500/20 rounded-lg px-3 py-2">
                            <RefreshCw size={13} className="mt-0.5 shrink-0" />
                            {isAr
                                ? `${sub.awaiting_sweep} اشتراك مكتوب أنه نشط لكن تاريخه انتهى — لم تمر عليه مهمة الإنهاء اليومية بعد.`
                                : `${sub.awaiting_sweep} subscription(s) still marked active past their expiry — the nightly sweep has not reached them.`}
                        </button>
                    )}
                    {sub.paid === 0 && sub.active > 0 && (
                        <p className="text-xs text-zinc-500 bg-zinc-50 dark:bg-white/5 rounded-lg px-3 py-2">
                            {isAr
                                ? 'كل اشتراك نشط حالياً إما تجريبي أو منحة إدارية — لا يوجد اشتراك مدفوع.'
                                : 'Every live subscription is a trial or an admin grant — nothing is being paid for.'}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}

/** A line of figures; with `onClick`, a click lists what it counts. */
function Row({ label, value, hint, onClick, active = false }) {
    return (
        <button type="button" onClick={onClick} disabled={!onClick}
            className={`w-full text-start flex items-start justify-between gap-4 rounded-lg -mx-2 px-2 py-1 transition-colors enabled:hover:bg-zinc-50 dark:enabled:hover:bg-white/5 ${active ? 'ring-2 ring-marine-cyan' : ''}`}>
            <div>
                <p className="text-sm text-zinc-600 dark:text-zinc-300">{label}</p>
                {hint && <p className="text-[11px] text-zinc-400 mt-0.5 max-w-[15rem]">{hint}</p>}
            </div>
            <span className="text-sm font-black text-zinc-900 dark:text-white tabular-nums shrink-0">{value}</span>
        </button>
    );
}

/** Above a list opened from a card: which card, how many it holds, and the way back to all. */
function SegmentChip({ label, count, isAr, onClear }) {
    return (
        <div className="px-4 pt-4">
            <span className="inline-flex items-center gap-2 rounded-full bg-red-50 dark:bg-marine-cyan/10 text-marine-primary ps-3 pe-1.5 py-1 text-xs font-black">
                {isAr ? `معروض: ${label} (${count})` : `Showing: ${label} (${count})`}
                <button type="button" onClick={onClear} title={isAr ? 'عرض الكل' : 'Show all'}
                    className="p-0.5 rounded-full hover:bg-red-100 dark:hover:bg-marine-cyan/20">
                    <X size={13} />
                </button>
            </span>
        </div>
    );
}

/** A figure; with `onClick`, a click lists what it counts (`active`: the one listed now). */
function StatCard({ icon: Icon, label, value, tone = 'orange', onClick, active = false }) {
    const color = tone === 'green' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
        : tone === 'red' ? 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400'
        : tone === 'sky' ? 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400'
        : 'bg-red-50 text-marine-primary dark:bg-marine-cyan/10';
    return (
        <button type="button" onClick={onClick} disabled={!onClick}
            className={`w-full text-start bg-white dark:bg-[#14171A] rounded-xl border p-5 shadow-sm transition-all enabled:hover:border-marine-cyan/40 enabled:hover:shadow-md ${active ? 'border-marine-cyan ring-2 ring-marine-cyan/30' : 'border-zinc-200 dark:border-white/5'}`}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${color}`}><Icon size={20} /></div>
            <p className="text-sm font-bold text-zinc-500">{label}</p>
            <p className="text-2xl font-black text-zinc-900 dark:text-white mt-1">{value}</p>
        </button>
    );
}
