'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from '../lib/navigation';
import { Bell, Loader2, CheckCheck } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { customerNotificationsApi } from '../lib/api';

const POLL_INTERVAL_MS = 60_000;

const relativeTime = (value, isAr) => {
    if (!value) return '';
    const diffMinutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
    if (diffMinutes < 1) return isAr ? 'الآن' : 'just now';
    if (diffMinutes < 60) return isAr ? `منذ ${diffMinutes} د` : `${diffMinutes}m ago`;
    const hours = Math.floor(diffMinutes / 60);
    if (hours < 24) return isAr ? `منذ ${hours} س` : `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return isAr ? `منذ ${days} ي` : `${days}d ago`;
};

/**
 * Storefront notification bell for CUSTOMER accounts.
 *
 * Kept separate from the vendor dashboard bell: the two inboxes and unread
 * counts never mix. Hidden entirely for signed-out visitors and staff sessions.
 */
export default function CustomerNotificationBell() {
    const router = useRouter();
    const { user, language, isMounted } = useApp();
    const isAr = language === 'ar';

    const [open, setOpen] = useState(false);
    const [count, setCount] = useState(0);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    // Where the panel starts on a phone: just under the bell. The header is sticky, so
    // the bell stays put while the page scrolls under the open panel.
    const [panelTop, setPanelTop] = useState(0);
    const containerRef = useRef(null);

    const isCustomer = !!user && user.role !== 'vendor' && user.role !== 'admin';

    useEffect(() => {
        if (!isMounted || !isCustomer) return;

        let cancelled = false;
        const poll = () => {
            customerNotificationsApi.getCount()
                .then((res) => { if (!cancelled) setCount(res.count || 0); })
                .catch(() => {});
        };

        poll();
        const timer = setInterval(poll, POLL_INTERVAL_MS);
        return () => { cancelled = true; clearInterval(timer); };
    }, [isMounted, isCustomer]);

    // Close on outside click / Escape so the panel never traps focus.
    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
        };
        const onKeyDown = (event) => { if (event.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    if (!isMounted || !isCustomer) return null;

    const togglePanel = async () => {
        const next = !open;
        if (next && containerRef.current) setPanelTop(containerRef.current.getBoundingClientRect().bottom + 8);
        setOpen(next);
        if (!next) return;

        setLoading(true);
        try {
            const res = await customerNotificationsApi.getAll({ limit: 12, language: isAr ? 'ar' : 'en' });
            setItems(res.notifications || []);
        } catch (err) {
            setItems([]);
        } finally {
            setLoading(false);
        }
    };

    const openNotification = async (notification) => {
        setOpen(false);
        if (!notification.read) {
            setCount((value) => Math.max(0, value - 1));
            customerNotificationsApi.markAsRead(notification._id).catch(() => {});
        }
        if (notification.link) router.push(notification.link);
    };

    const markAll = async () => {
        setCount(0);
        setItems((list) => list.map((item) => ({ ...item, read: true })));
        customerNotificationsApi.markAllAsRead().catch(() => {});
    };

    return (
        <div className="relative" ref={containerRef}>
            <button
                onClick={togglePanel}
                aria-label={isAr ? 'الإشعارات' : 'Notifications'}
                aria-expanded={open}
                className="relative flex items-center justify-center w-10 h-10 rounded-full text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition-all"
            >
                <Bell size={20} />
                {count > 0 && (
                    <span className="absolute -top-0.5 -end-0.5 bg-marine-cyan text-white text-[10px] font-black min-w-[18px] h-[18px] px-1 rounded-full border-2 border-white flex items-center justify-center">
                        {count > 9 ? '9+' : count}
                    </span>
                )}
            </button>

            {open && (
                <div
                    // On a phone the bell is at the start of the header, so a panel hung from it
                    // runs off the screen: there it spans the screen instead, 16px in from each side.
                    style={{ '--panel-top': `${panelTop}px` }}
                    className="fixed inset-x-4 top-[var(--panel-top)] md:absolute md:inset-x-auto md:top-full md:end-0 md:mt-2 md:w-[380px] md:max-w-[calc(100vw-2rem)] bg-white border border-zinc-200 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] z-[100] overflow-hidden"
                    dir={isAr ? 'rtl' : 'ltr'}
                >
                    <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
                        <p className="text-zinc-900 font-bold text-sm">{isAr ? 'الإشعارات' : 'Notifications'}</p>
                        {count > 0 && (
                            <button onClick={markAll} className="text-marine-primary text-xs font-bold hover:underline flex items-center gap-1">
                                <CheckCheck size={13} /> {isAr ? 'تعليم الكل كمقروء' : 'Mark all read'}
                            </button>
                        )}
                    </div>

                    <div className="max-h-[380px] overflow-y-auto">
                        {loading ? (
                            <div className="flex items-center justify-center py-10">
                                <Loader2 size={22} className="animate-spin text-marine-primary" />
                            </div>
                        ) : items.length === 0 ? (
                            <p className="text-zinc-500 text-sm text-center py-10 px-4">
                                {isAr ? 'لا توجد إشعارات بعد.' : 'No notifications yet.'}
                            </p>
                        ) : items.map((notification) => (
                            <button
                                key={notification._id}
                                onClick={() => openNotification(notification)}
                                className={`w-full text-start px-4 py-3 border-b border-zinc-50 last:border-0 hover:bg-zinc-50 transition-colors ${
                                    notification.read ? '' : 'bg-red-50/40'
                                }`}
                            >
                                <div className="flex items-start gap-2">
                                    {!notification.read && <span className="w-2 h-2 rounded-full bg-marine-cyan mt-1.5 flex-shrink-0" />}
                                    <div className="min-w-0 flex-1">
                                        <p className="text-zinc-900 font-bold text-sm">{notification.title}</p>
                                        {notification.message && (
                                            <p className="text-zinc-500 text-xs mt-0.5 leading-relaxed">{notification.message}</p>
                                        )}
                                        <p className="text-zinc-400 text-[11px] mt-1">{relativeTime(notification.createdAt, isAr)}</p>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
