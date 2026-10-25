'use client';

import { useEffect, useState } from 'react';
import { Bell, CheckCheck, Trash2, Loader2, CheckCircle2, AlertTriangle, CreditCard, Gift, RefreshCw, ShieldOff, AlertCircle, Package } from 'lucide-react';
import { notificationsApi } from '../../../lib/api';
import { useApp } from '../../../context/AppContext';
import PaginationControls from '../../../components/dashboard/PaginationControls';
import { localizeNotification } from '../../../lib/notificationLocalization';
import usePageSize from '../../../lib/usePageSize';


const typeIcons = {
    subscription_activated: { icon: CheckCircle2, cls: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10' },
    trial_activated: { icon: Gift, cls: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10' },
    subscription_expiring_soon: { icon: AlertTriangle, cls: 'text-amber-500 bg-amber-50 dark:bg-amber-500/10' },
    subscription_expired: { icon: AlertCircle, cls: 'text-red-500 bg-red-50 dark:bg-red-500/10' },
    subscription_cancelled: { icon: AlertCircle, cls: 'text-red-500 bg-red-50 dark:bg-red-500/10' },
    account_became_not_subscribed: { icon: AlertCircle, cls: 'text-red-500 bg-red-50 dark:bg-red-500/10' },
    account_suspended: { icon: ShieldOff, cls: 'text-red-500 bg-red-50 dark:bg-red-500/10' },
    account_reactivated: { icon: CheckCircle2, cls: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10' },
    product_visibility_restored: { icon: Package, cls: 'text-sky-500 bg-sky-50 dark:bg-sky-500/10' },
    renewal_successful: { icon: RefreshCw, cls: 'text-sky-500 bg-sky-50 dark:bg-sky-500/10' },
    product_limit_warning: { icon: CreditCard, cls: 'text-amber-500 bg-amber-50 dark:bg-amber-500/10' },
    new_order_received: { icon: Package, cls: 'text-marine-primary bg-red-50 dark:bg-red-500/10' },
};

function formatDate(dateStr, isAr) {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString(isAr ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function NotificationsPage() {
    const { language } = useApp();
    const isAr = language === 'ar';

    const [notifications, setNotifications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('vendor.notifications', 20);
    const [total, setTotal] = useState(0);
    const [filter, setFilter] = useState('all'); // 'all' | 'unread'
    const [actionId, setActionId] = useState(null);

    const loadNotifications = async () => {
        setLoading(true);
        try {
            const params = { page, limit: pageSize };
            if (filter === 'unread') params.read = 'false';
            const data = await notificationsApi.getAll(params);
            setNotifications(data.notifications || []);
            setTotal(data.pagination?.total || 0);
        } catch {} finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadNotifications(); }, [page, pageSize, filter]);

    const markAsRead = async (id) => {
        setActionId(id);
        try {
            await notificationsApi.markAsRead(id);
            setNotifications(prev => prev.map(n => n._id === id ? { ...n, read: true } : n));
            setTotal(prev => Math.max(0, prev - 1));
        } catch {} finally {
            setActionId(null);
        }
    };

    const markAllAsRead = async () => {
        setActionId('all');
        try {
            await notificationsApi.markAllAsRead();
            setNotifications(prev => prev.map(n => ({ ...n, read: true })));
            setTotal(prev => Math.max(0, prev - (prev - notifications.filter(n => !n.read).length)));
            if (filter === 'unread') {
                setNotifications([]);
                setTotal(0);
            }
        } catch {} finally {
            setActionId(null);
        }
    };

    const deleteNotification = async (id) => {
        setActionId(id);
        try {
            await notificationsApi.deleteNotification(id);
            setNotifications(prev => prev.filter(n => n._id !== id));
            setTotal(prev => Math.max(0, prev - 1));
        } catch {} finally {
            setActionId(null);
        }
    };

    const unreadCount = notifications.filter(n => !n.read).length;

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-wide">
                        {isAr ? 'الإشعارات' : 'Notifications'}
                    </h1>
                    <p className="text-sm text-zinc-500 mt-1">
                        {isAr ? 'جميع إشعارات حسابك.' : 'All notifications for your account.'}
                    </p>
                </div>
                {unreadCount > 0 && (
                    <button
                        onClick={markAllAsRead}
                        disabled={actionId === 'all'}
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 text-white rounded-xl font-bold transition-all"
                    >
                        {actionId === 'all' ? <Loader2 size={16} className="animate-spin" /> : <CheckCheck size={16} />}
                        {isAr ? 'قراءة الكل' : 'Mark All Read'}
                    </button>
                )}
            </div>

            {/* Filter Tabs */}
            <div className="flex gap-2">
                <button onClick={() => { setFilter('all'); setPage(1); }}
                    className={`px-5 py-2.5 text-sm font-black rounded-xl transition-colors ${filter === 'all' ? 'bg-marine-cyan text-white' : 'bg-white dark:bg-[#14171A] text-zinc-500 hover:text-zinc-900 dark:hover:text-white border border-zinc-200 dark:border-white/10'}`}>
                    {isAr ? 'الكل' : 'All'}
                </button>
                <button onClick={() => { setFilter('unread'); setPage(1); }}
                    className={`px-5 py-2.5 text-sm font-black rounded-xl transition-colors ${filter === 'unread' ? 'bg-marine-cyan text-white' : 'bg-white dark:bg-[#14171A] text-zinc-500 hover:text-zinc-900 dark:hover:text-white border border-zinc-200 dark:border-white/10'}`}>
                    {isAr ? 'غير المقروءة' : 'Unread'}
                </button>
            </div>

            {/* Notifications List */}
            <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm overflow-hidden">
                {loading ? (
                    <div className="py-16 flex justify-center"><Loader2 size={28} className="animate-spin text-marine-primary" /></div>
                ) : notifications.length === 0 ? (
                    <div className="py-16 text-center">
                        <Bell size={44} className="mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
                        <p className="font-bold text-zinc-900 dark:text-white">{isAr ? 'لا توجد إشعارات' : 'No notifications'}</p>
                    </div>
                ) : (
                    <div className="divide-y divide-zinc-100 dark:divide-white/5">
                        {notifications.map(notif => {
                            const iconConfig = typeIcons[notif.type] || { icon: Bell, cls: 'text-zinc-400 bg-zinc-50 dark:bg-white/5' };
                            const Icon = iconConfig.icon;
                            const localized = localizeNotification(notif, language);
                            return (
                                <div key={notif._id}
                                    className={`flex items-start gap-4 px-6 py-4 hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors ${!notif.read ? 'bg-marine-cyan/[0.02]' : ''}`}>
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${iconConfig.cls}`}>
                                        <Icon size={16} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex-1">
                                                <p className={`text-sm font-bold ${notif.read ? 'text-zinc-600 dark:text-zinc-300' : 'text-zinc-900 dark:text-white'}`}>{localized.title}</p>
                                                <p className="text-sm text-zinc-500 mt-0.5">{localized.message}</p>
                                                <p className="text-xs text-zinc-300 mt-1 font-bold">{formatDate(notif.createdAt, isAr)}</p>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                {!notif.read && (
                                                    <button onClick={() => markAsRead(notif._id)} disabled={actionId === notif._id}
                                                        className="p-1.5 text-zinc-400 hover:text-marine-primary transition-colors" title={isAr ? 'قراءة' : 'Mark as read'}>
                                                        {actionId === notif._id ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />}
                                                    </button>
                                                )}
                                                <button onClick={() => deleteNotification(notif._id)} disabled={actionId === notif._id}
                                                    className="p-1.5 text-zinc-400 hover:text-red-500 transition-colors" title={isAr ? 'حذف' : 'Delete'}>
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {!loading && total > pageSize && (
                    <div className="px-6 py-4 border-t border-zinc-100 dark:border-white/5">
                        <PaginationControls
                            page={page} pageSize={pageSize}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} total={total} onPageChange={setPage}
                            labels={{ showing: isAr ? 'عرض' : 'Showing', of: isAr ? 'من' : 'of', previous: isAr ? 'السابق' : 'Prev', next: isAr ? 'التالي' : 'Next' }}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
