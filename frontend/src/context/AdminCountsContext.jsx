'use client';

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { adminApi } from '../lib/api';
import { useApp } from './AppContext';

const AdminCountsContext = createContext({
  counts: {},
  overview: {},
  totalAttentionCount: 0,
  attentionItems: [],
  loading: false,
  notificationAlert: null,
  clearNotificationAlert: () => {},
  refreshCounts: () => {},
  requestNotificationPermission: () => {},
  hasNotificationPermission: false,
});

export function AdminCountsProvider({ children }) {
  const { user, language } = useApp();
  const isAdmin = user?.role === 'admin';
  const isAr = language === 'ar';

  const [overview, setOverview] = useState({});
  const [loading, setLoading] = useState(false);
  const [notificationAlert, setNotificationAlert] = useState(null);
  const [hasNotificationPermission, setHasNotificationPermission] = useState(false);
  const prevCountsRef = useRef({});
  const isFirstLoadRef = useRef(true);

  // Check browser notification permission
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setHasNotificationPermission(Notification.permission === 'granted');
    }
  }, []);

  const requestNotificationPermission = useCallback(async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const permission = await Notification.requestPermission();
        setHasNotificationPermission(permission === 'granted');
        return permission === 'granted';
      } catch (err) {
        console.warn('[AdminCounts] Notification permission request error:', err);
      }
    }
    return false;
  }, []);

  const fetchCounts = useCallback(async () => {
    if (!isAdmin) return;
    try {
      setLoading(true);
      const res = await adminApi.getOverview();
      const sec = res?.sections || {};
      setOverview(sec);

      // Build current attention map
      const currentMap = {
        pending_products: Number(sec.products?.pending || 0),
        pending_orders: Number(sec.orders?.pending || 0),
        missing_orders: Number(sec.orders?.missing || 0),
        parcels_attention: Number(sec.parcels?.attention || 0),
        pending_verifications: Number(sec.verifications?.pending || 0),
        open_returns: Number(sec.returns?.open || 0) + Number(sec.returns?.refunds_pending || 0),
        pending_withdrawals: Number(sec.withdrawals?.pending || 0),
        pending_ads: Number(sec.ads?.pending || 0),
        open_tickets: Number(sec.tickets?.open || 0),
        new_inquiries: Number(sec.contact_inquiries?.new || 0),
        pending_reviews: Number(sec.reviews?.pending || 0),
        pending_supplies: Number(sec.supplies?.pending || 0),
      };

      // Check if any counts increased since last poll (skip on first mount)
      if (!isFirstLoadRef.current) {
        const prev = prevCountsRef.current;
        let newItemsText = [];

        if (currentMap.pending_orders > (prev.pending_orders || 0)) {
          newItemsText.push(isAr ? 'طلبات جديدة قيد الانتظار' : 'New pending orders');
        }
        if (currentMap.pending_products > (prev.pending_products || 0)) {
          newItemsText.push(isAr ? 'منتجات جديدة تنتظر الموافقة' : 'New products awaiting approval');
        }
        if (currentMap.open_tickets > (prev.open_tickets || 0)) {
          newItemsText.push(isAr ? 'تذاكر دعم فني جديدة' : 'New support tickets');
        }
        if (currentMap.pending_reviews > (prev.pending_reviews || 0)) {
          newItemsText.push(isAr ? 'تقييمات جديدة تحتاج مراجعة' : 'New reviews awaiting review');
        }
        if (currentMap.pending_withdrawals > (prev.pending_withdrawals || 0)) {
          newItemsText.push(isAr ? 'طلب سحب أرباح جديد' : 'New withdrawal request');
        }
        if (currentMap.pending_ads > (prev.pending_ads || 0)) {
          newItemsText.push(isAr ? 'طلب إعلان جديد' : 'New ad request');
        }
        if (currentMap.new_inquiries > (prev.new_inquiries || 0)) {
          newItemsText.push(isAr ? 'استفسار تواصل جديد' : 'New contact inquiry');
        }

        if (newItemsText.length > 0) {
          const alertMsg = newItemsText.join(' · ');
          setNotificationAlert(alertMsg);

          // Native browser notification if permitted
          if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification(isAr ? 'Ready Marine — تنبيه إداري' : 'Ready Marine Admin Alert', {
                body: alertMsg,
                icon: '/icons/icon-192.png',
              });
            } catch {}
          }
        }
      } else {
        isFirstLoadRef.current = false;
      }

      prevCountsRef.current = currentMap;
    } catch (err) {
      console.warn('[AdminCounts] failed to fetch counts:', err);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, isAr]);

  useEffect(() => {
    if (!isAdmin) return;
    fetchCounts();

    // Poll every 35 seconds
    const interval = setInterval(fetchCounts, 35000);

    // Refresh immediately when tab becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchCounts();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isAdmin, fetchCounts]);

  const sec = overview || {};

  // Map route paths to badge counts
  const counts = {
    '/admin/dashboard/pending-products': Number(sec.products?.pending || 0),
    '/admin/dashboard/verifications': Number(sec.verifications?.pending || 0),
    '/admin/dashboard/orders': Number(sec.orders?.pending || 0),
    '/admin/dashboard/parcels?reason=declined_items': Number(sec.orders?.missing || 0),
    '/admin/dashboard/parcels': Number(sec.parcels?.attention || 0),
    '/admin/dashboard/returns': Number(sec.returns?.open || 0) + Number(sec.returns?.refunds_pending || 0),
    '/admin/dashboard/withdrawals': Number(sec.withdrawals?.pending || 0),
    '/admin/dashboard/ad-requests': Number(sec.ads?.pending || 0),
    '/admin/dashboard/tickets': Number(sec.tickets?.open || 0),
    '/admin/dashboard/contact-inquiries': Number(sec.contact_inquiries?.new || 0),
    '/admin/dashboard/reviews': Number(sec.reviews?.pending || 0),
    '/admin/dashboard/supplies': Number(sec.supplies?.pending || 0),
  };

  const attentionItems = [
    {
      id: 'orders',
      title: isAr ? 'طلبات بانتظار التأكيد' : 'Pending Orders',
      count: Number(sec.orders?.pending || 0),
      href: '/admin/dashboard/orders',
      tone: 'blue',
    },
    {
      id: 'products',
      title: isAr ? 'منتجات بانتظار الموافقة' : 'Pending Products',
      count: Number(sec.products?.pending || 0),
      href: '/admin/dashboard/pending-products',
      tone: 'amber',
    },
    {
      id: 'tickets',
      title: isAr ? 'تذاكر دعم مفتوحة' : 'Open Support Tickets',
      count: Number(sec.tickets?.open || 0),
      href: '/admin/dashboard/tickets',
      tone: 'red',
    },
    {
      id: 'reviews',
      title: isAr ? 'تقييمات بانتظار المراجعة' : 'Pending Reviews',
      count: Number(sec.reviews?.pending || 0),
      href: '/admin/dashboard/reviews',
      tone: 'amber',
    },
    {
      id: 'withdrawals',
      title: isAr ? 'طلبات سحب أرباح' : 'Pending Withdrawals',
      count: Number(sec.withdrawals?.pending || 0),
      href: '/admin/dashboard/withdrawals',
      tone: 'emerald',
    },
    {
      id: 'ads',
      title: isAr ? 'طلبات إعلانات' : 'Pending Ad Requests',
      count: Number(sec.ads?.pending || 0),
      href: '/admin/dashboard/ad-requests',
      tone: 'purple',
    },
    {
      id: 'inquiries',
      title: isAr ? 'استفسارات تواصل جديدة' : 'New Inquiries',
      count: Number(sec.contact_inquiries?.new || 0),
      href: '/admin/dashboard/contact-inquiries',
      tone: 'blue',
    },
    {
      id: 'returns',
      title: isAr ? 'طلبات استرجاع مفتوحة' : 'Open Returns',
      count: Number(sec.returns?.open || 0) + Number(sec.returns?.refunds_pending || 0),
      href: '/admin/dashboard/returns',
      tone: 'red',
    },
    {
      id: 'verifications',
      title: isAr ? 'طلبات تأكيد الحسابات' : 'Pending Verifications',
      count: Number(sec.verifications?.pending || 0),
      href: '/admin/dashboard/verifications',
      tone: 'sky',
    },
    {
      id: 'parcels',
      title: isAr ? 'شحنات تحتاج تدخلك' : 'Parcels Needing You',
      count: Number(sec.parcels?.attention || 0),
      href: '/admin/dashboard/parcels',
      tone: 'amber',
    },
    {
      id: 'missing_orders',
      title: isAr ? 'طلبات ناقصة' : 'Incomplete Orders',
      count: Number(sec.orders?.missing || 0),
      href: '/admin/dashboard/parcels?reason=declined_items',
      tone: 'red',
    },
  ].filter(item => item.count > 0);

  const totalAttentionCount = attentionItems.reduce((acc, item) => acc + item.count, 0);

  return (
    <AdminCountsContext.Provider
      value={{
        counts,
        overview,
        totalAttentionCount,
        attentionItems,
        loading,
        notificationAlert,
        clearNotificationAlert: () => setNotificationAlert(null),
        refreshCounts: fetchCounts,
        requestNotificationPermission,
        hasNotificationPermission,
      }}
    >
      {children}
    </AdminCountsContext.Provider>
  );
}

export function useAdminCounts() {
  return useContext(AdminCountsContext);
}
