'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, X, AlertTriangle, CreditCard, Gift, CheckCircle2, ShieldOff, RefreshCw, Package, AlertCircle, Truck, CalendarClock } from 'lucide-react';
import { notificationsApi } from '../../lib/api';
import { useApp } from '../../context/AppContext';
import { useRouter } from '../../lib/navigation';
import { localizeNotification } from '../../lib/notificationLocalization';

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
    // The prepaid shipping bundle. Depleted is red because shipping actually stops.
    bosta_bundle_low: { icon: Truck, cls: 'text-amber-500 bg-amber-50 dark:bg-amber-500/10' },
    bosta_bundle_expiring: { icon: CalendarClock, cls: 'text-amber-500 bg-amber-50 dark:bg-amber-500/10' },
    bosta_bundle_depleted: { icon: AlertCircle, cls: 'text-red-500 bg-red-50 dark:bg-red-500/10' },
};

function timeAgo(dateStr, isAr) {
    const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return isAr ? 'الآن' : 'just now';
    if (diff < 3600) {
        const minutes = Math.floor(diff / 60);
        return isAr ? `منذ ${minutes} د` : `${minutes}m ago`;
    }
    if (diff < 86400) {
        const hours = Math.floor(diff / 3600);
        return isAr ? `منذ ${hours} س` : `${hours}h ago`;
    }
    const days = Math.floor(diff / 86400);
    return isAr ? `منذ ${days} ي` : `${days}d ago`;
}

export default function NotificationBell({ variant = 'icon' }) {
    const { user, language } = useApp();
    const isAr = language === 'ar';
    const router = useRouter();

    const [open, setOpen] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const dropdownRef = useRef(null);

    const isVendor = user?.role === 'vendor';

    useEffect(() => {
        if (!isVendor) return;
        fetchUnreadCount();
        // Poll every 60s
        const interval = setInterval(fetchUnreadCount, 60000);
        return () => clearInterval(interval);
    }, [isVendor]);

    useEffect(() => {
        if (open && isVendor) loadNotifications();
    }, [open, isVendor]);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const fetchUnreadCount = async () => {
        try {
            const data = await notificationsApi.getCount();
            setUnreadCount(data.unreadCount || 0);
        } catch {}
    };

    const loadNotifications = async () => {
        setLoading(true);
        try {
            const data = await notificationsApi.getAll({ limit: 10 });
            setNotifications(data.notifications || []);
        } catch {}
        setLoading(false);
    };

    const markAsRead = async (id) => {
        try {
            await notificationsApi.markAsRead(id);
            setNotifications(prev => prev.map(n => n._id === id ? { ...n, read: true } : n));
            setUnreadCount(prev => Math.max(0, prev - 1));
        } catch {}
    };

    const markAllAsRead = async () => {
        try {
            await notificationsApi.markAllAsRead();
            setNotifications(prev => prev.map(n => ({ ...n, read: true })));
            setUnreadCount(0);
        } catch {}
    };

    const goToNotifications = () => {
        setOpen(false);
        router.push('/dashboard/notifications');
    };

    if (!isVendor) return null;

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setOpen(!open)}
                className="relative p-2 text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-white/5 rounded-full transition-colors"
            >
                <Bell size={18} />
                {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -end-0.5 min-w-[18px] h-[18px] bg-marine-cyan text-white text-[10px] font-black rounded-full flex items-center justify-center px-1 shadow-md">
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </button>

            {open && (
                <div className="absolute top-full end-0 mt-1 w-[360px] bg-white dark:bg-[#14171A] rounded-2xl shadow-2xl border border-zinc-200 dark:border-white/10 z-[100] overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-white/5">
                        <p className="font-black text-zinc-900 dark:text-white text-sm">{isAr ? 'الإشعارات' : 'Notifications'}</p>
                        <div className="flex items-center gap-2">
                            {unreadCount > 0 && (
                                <button onClick={markAllAsRead}
                                    className="flex items-center gap-1 text-[11px] font-bold text-marine-primary hover:text-red-700 transition-colors">
                                    <CheckCheck size={12} />
                                    {isAr ? 'قراءة الكل' : 'Mark all read'}
                                </button>
                            )}
                            <button onClick={goToNotifications}
                                className="text-[11px] font-bold text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors">
                                {isAr ? 'عرض الكل' : 'View all'}
                            </button>
                        </div>
                    </div>

                    {/* Notification List */}
                    <div className="max-h-[360px] overflow-y-auto">
                        {loading ? (
                            <div className="py-8 text-center text-zinc-400 text-sm">{isAr ? 'جاري التحميل...' : 'Loading...'}</div>
                        ) : notifications.length === 0 ? (
                            <div className="py-8 text-center">
                                <Bell size={28} className="mx-auto text-zinc-300 mb-2" />
                                <p className="text-sm font-bold text-zinc-500">{isAr ? 'لا توجد إشعارات' : 'No notifications yet'}</p>
                            </div>
                        ) : (
                            notifications.map(notif => {
                                const iconConfig = typeIcons[notif.type] || { icon: Bell, cls: 'text-zinc-400 bg-zinc-50 dark:bg-white/5' };
                                const Icon = iconConfig.icon;
                                const localized = localizeNotification(notif, language);
                                return (
                                    <div key={notif._id}
                                        className={`flex items-start gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-white/[0.02] cursor-pointer transition-colors border-b border-zinc-100 dark:border-white/5 last:border-0 ${!notif.read ? 'bg-marine-cyan/[0.02]' : ''}`}
                                        onClick={() => !notif.read && markAsRead(notif._id)}
                                    >
                                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${iconConfig.cls}`}>
                                            <Icon size={14} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-start justify-between gap-2">
                                                <p className={`text-sm font-bold leading-tight ${notif.read ? 'text-zinc-600 dark:text-zinc-300' : 'text-zinc-900 dark:text-white'}`}>{localized.title}</p>
                                                {!notif.read && (
                                                    <span className="w-2 h-2 bg-marine-cyan rounded-full shrink-0 mt-1.5" />
                                                )}
                                            </div>
                                            <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2">{localized.message}</p>
                                            <p className="text-[10px] text-zinc-300 mt-1 font-bold">{timeAgo(notif.createdAt, isAr)}</p>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
