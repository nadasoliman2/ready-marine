'use client';

import { useRef, useState } from 'react';
import { Bell, RefreshCw, ChevronLeft, ChevronRight, CheckCircle2, Megaphone, ShoppingCart, Package, Ticket, Star, Wallet, RotateCcw, UserCheck, Mail, AlertTriangle } from 'lucide-react';
import { useAdminCounts } from '../../context/AdminCountsContext';
import { useApp } from '../../context/AppContext';
import { useRouter } from '../../lib/navigation';
import useDismiss from '../../lib/useDismiss';

const ICON_MAP = {
  orders: ShoppingCart,
  products: Package,
  tickets: Ticket,
  reviews: Star,
  withdrawals: Wallet,
  ads: Megaphone,
  inquiries: Mail,
  returns: RotateCcw,
  verifications: UserCheck,
  parcels: AlertTriangle,
  missing_orders: AlertTriangle,
};

const TONE_CLASSES = {
  red: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  blue: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  purple: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
  sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
};

export default function AdminNotificationBell() {
  const { language } = useApp();
  const isAr = language === 'ar';
  const router = useRouter();
  const {
    totalAttentionCount,
    attentionItems,
    loading,
    refreshCounts,
    requestNotificationPermission,
    hasNotificationPermission,
  } = useAdminCounts();

  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useDismiss(containerRef, open, () => setOpen(false));

  const handleItemClick = (href) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <div ref={containerRef} className="relative">
      {/* <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={isAr ? 'تنبيهات الإدارة' : 'Admin Alerts'}
        className="relative p-2 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white rounded-xl hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors"
      >
        <Bell size={18} />
        {totalAttentionCount > 0 && (
          <span className="absolute top-1 end-1 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center ring-2 ring-white dark:ring-[#14171A] animate-in zoom-in-75">
            {totalAttentionCount > 99 ? '99+' : totalAttentionCount}
          </span>
        )}
      </button> */}

      {open && (
        <>
          {/* Mobile backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-xs sm:hidden"
            onClick={() => setOpen(false)}
          />

          {/* Dropdown Container */}
          <div className="fixed inset-x-3 top-16 sm:inset-x-auto sm:absolute sm:top-full sm:end-0 mt-2 sm:w-96 bg-white dark:bg-[#14171A] rounded-2xl shadow-2xl border border-zinc-200 dark:border-white/10 z-50 overflow-hidden flex flex-col max-h-[80vh] animate-in fade-in-50 slide-in-from-top-2 duration-150">
            {/* Header */}
            <div className="p-4 border-b border-zinc-100 dark:border-white/5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <h3 className="font-black text-sm text-zinc-900 dark:text-white">
                  {isAr ? 'تنبيهات الإدارة' : 'Admin Alerts'}
                </h3>
                {totalAttentionCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-red-500/10 text-red-600 dark:text-red-400">
                    {totalAttentionCount} {isAr ? 'تنبيه' : 'alerts'}
                  </span>
                )}
              </div>
              <button
                onClick={refreshCounts}
                disabled={loading}
                title={isAr ? 'تحديث' : 'Refresh'}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin text-marine-cyan' : ''} />
              </button>
            </div>

          {/* Browser Permission Prompt if not yet granted */}
          {!hasNotificationPermission && typeof window !== 'undefined' && 'Notification' in window && Notification.permission !== 'denied' && (
            <div className="p-3 bg-marine-cyan/5 border-b border-marine-cyan/10 flex items-center justify-between gap-2">
              <p className="text-[11px] text-zinc-600 dark:text-zinc-300 font-medium">
                {isAr ? 'فعّل إشعارات المتصفح لتصلك التنبيهات فوراً' : 'Enable browser notifications for instant alerts'}
              </p>
              <button
                onClick={requestNotificationPermission}
                className="px-2.5 py-1 text-[10px] font-bold bg-marine-cyan text-white rounded-lg hover:bg-marine-cyan-dark transition-colors shrink-0"
              >
                {isAr ? 'تفعيل' : 'Enable'}
              </button>
            </div>
          )}

          {/* Items List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-zinc-100 dark:divide-white/5 custom-scrollbar">
            {attentionItems.length === 0 ? (
              <div className="py-8 px-4 text-center">
                <CheckCircle2 size={32} className="mx-auto text-emerald-500 mb-2" />
                <p className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
                  {isAr ? 'لا توجد تنبيهات جديدة' : 'No urgent alerts'}
                </p>
                <p className="text-[11px] text-zinc-400 mt-1">
                  {isAr ? 'كل المهام والطلبات تحت السيطرة!' : 'All queues are caught up!'}
                </p>
              </div>
            ) : (
              attentionItems.map((item) => {
                const Icon = ICON_MAP[item.id] || Bell;
                const toneCls = TONE_CLASSES[item.tone] || TONE_CLASSES.red;

                return (
                  <button
                    key={item.id}
                    onClick={() => handleItemClick(item.href)}
                    className="w-full p-3.5 flex items-center justify-between gap-3 hover:bg-zinc-50 dark:hover:bg-white/[0.03] transition-colors text-start group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${toneCls}`}>
                        <Icon size={16} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-zinc-800 dark:text-zinc-200 group-hover:text-marine-primary transition-colors truncate">
                          {item.title}
                        </p>
                        <p className="text-[10px] text-zinc-400 mt-0.5">
                          {item.count} {isAr ? 'في الانتظار' : 'pending'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="min-w-[22px] h-5 px-1.5 rounded-full text-[10px] font-black bg-red-500 text-white flex items-center justify-center">
                        {item.count}
                      </span>
                      {isAr ? (
                        <ChevronLeft size={14} className="text-zinc-400 group-hover:-translate-x-0.5 transition-transform" />
                      ) : (
                        <ChevronRight size={14} className="text-zinc-400 group-hover:translate-x-0.5 transition-transform" />
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </>
    )}
  </div>
);
}
