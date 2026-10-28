'use client';

import { useEffect, useState } from 'react';
import Link from '../LocaleLink';
import { usePathname } from '../../lib/navigation';
import { LayoutDashboard, Package, PackageOpen, ShoppingCart, Settings, LogOut, X, Ticket, CreditCard, Bell, RotateCcw, Wallet, Megaphone, Boxes, FileBarChart, ExternalLink } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { vendorApi } from '../../lib/api';

export default function Sidebar({ isOpen, setIsOpen }) {
  const pathname = usePathname();
  const { t, logout, language, siteSettings } = useApp();
  const isAr = language === 'ar';
  const [pendingOrders, setPendingOrders] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const loadOrderCounts = async () => {
      try {
        const data = await vendorApi.getOrderCounts();
        if (!cancelled) setPendingOrders(Number(data?.counts?.pending || 0));
      } catch {
        if (!cancelled) setPendingOrders(0);
      }
    };

    loadOrderCounts();
    const intervalId = window.setInterval(loadOrderCounts, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [pathname]);

  const menuItems = [
    { name: t.dashboard || 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
    { name: t.myProducts || 'Products', icon: Package, href: '/dashboard/products' },
    { name: t.bundles || 'Bundles', icon: Boxes, href: '/dashboard/bundles' },
    { name: t.subscription || 'Subscription', icon: CreditCard, href: '/dashboard/subscription' },
    { name: t.orders || 'Orders', icon: ShoppingCart, href: '/dashboard/orders', badge: pendingOrders },
    { name: t.returns || 'Returns', icon: RotateCcw, href: '/dashboard/returns' },
    { name: isAr ? 'تقرير المبيعات' : 'Sales report', icon: FileBarChart, href: '/dashboard/reports/sales' },
    { name: t.commissions || 'Commissions', icon: CreditCard, href: '/dashboard/commissions' },
    { name: t.wallet || 'Wallet', icon: Wallet, href: '/dashboard/wallet' },
    { name: isAr ? 'مستلزمات الشحن' : 'Packaging', icon: PackageOpen, href: '/dashboard/supplies' },
    { name: t.advertising || 'Advertising', icon: Megaphone, href: '/dashboard/ads' },
    { name: t.supportTickets || t.support || 'Support', icon: Ticket, href: '/dashboard/tickets' },
    { name: t.notifications || 'Notifications', icon: Bell, href: '/dashboard/notifications' },
    { name: t.settings || 'Settings', icon: Settings, href: '/dashboard/settings' },
  ];

  return (
    <aside className={`
      fixed lg:static inset-y-0 ${isAr ? 'right-0' : 'left-0'} z-50
      w-72 shrink-0 bg-white dark:bg-[#14171A] border-${isAr ? 'l' : 'r'} border-zinc-200 dark:border-white/5
      flex flex-col transition-transform duration-300 ease-in-out
      ${isOpen ? 'translate-x-0' : (isAr ? 'translate-x-full lg:translate-x-0' : '-translate-x-full lg:translate-x-0')}
    `}>
      {/* Logo Area */}
      <div className="h-16 flex items-center justify-between px-6 border-b border-zinc-100 dark:border-white/5">
        <Link
          href="/dashboard"
          onClick={() => setIsOpen(false)}
          title={isAr ? 'لوحة البائع' : 'Vendor Dashboard'}
          className="flex items-center gap-2 min-h-[40px] hover:opacity-85 transition-opacity"
        >
          {siteSettings === null ? null : (siteSettings.logo_url || siteSettings.logo_light_url) ? (
            <img src={siteSettings.logo_url || siteSettings.logo_light_url} alt={isAr ? 'شعار الموقع' : 'Site logo'} className="h-8 w-auto object-contain" />
          ) : (
            <>
              <div className="w-8 h-8 rounded bg-marine-cyan flex items-center justify-center">
                <span className="text-white font-black text-sm">V</span>
              </div>
              <span className="font-bold text-zinc-900 dark:text-white tracking-tight">
                {isAr ? 'لوحة البائع' : <>Vendor<span className="text-marine-primary">Panel</span></>}
              </span>
            </>
          )}
        </Link>
        <button 
          onClick={() => setIsOpen(false)}
          className="lg:hidden p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
        {menuItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
          
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setIsOpen(false)}
              className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-bold transition-all duration-200 ${
                isActive 
                  ? 'bg-marine-mist dark:bg-marine-cyan/10 text-marine-primary shadow-sm' 
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-marine-primary dark:hover:text-white hover:bg-marine-mist/50 dark:hover:bg-white/5'
              }`}
            >
              <item.icon size={20} className={isActive ? 'text-marine-primary' : 'text-zinc-400 dark:text-zinc-500'} />
              <span className="flex-1 truncate">{item.name}</span>
              {item.badge > 0 && (
                <span
                  className={`min-w-[1.35rem] h-[1.35rem] px-1.5 rounded-full bg-marine-cyan text-white text-[10px] font-black leading-none flex items-center justify-center shadow-sm shadow-marine-cyan/20 ring-2 ${
                    isActive ? 'ring-marine-mist dark:ring-marine-cyan/20' : 'ring-white dark:ring-[#14171A]'
                  }`}
                  aria-label={isAr ? `${item.badge} طلبات جديدة` : `${item.badge} new orders`}
                  title={isAr ? `${item.badge} طلبات جديدة` : `${item.badge} new orders`}
                >
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User Area / Footer */}
      <div className="p-4 border-t border-zinc-100 dark:border-white/5 space-y-1">
        <Link
          href="/"
          onClick={() => setIsOpen(false)}
          className="flex items-center gap-3 px-4 py-2.5 text-sm font-bold text-zinc-600 dark:text-zinc-400 hover:text-marine-primary hover:bg-marine-cyan/10 rounded-xl transition-all duration-200 group"
        >
          <div className="p-1 rounded-lg group-hover:bg-marine-cyan/20 transition-colors">
            <ExternalLink size={18} />
          </div>
          <span>{isAr ? 'الرجوع للمتجر' : 'Back to Store'}</span>
        </Link>
        <button 
          onClick={logout}
          className="flex w-full items-center gap-3 px-4 py-2.5 text-sm font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-all duration-200 group"
        >
          <div className="p-1 rounded-lg group-hover:bg-red-400/20 transition-colors">
            <LogOut size={18} />
          </div>
          <span>{t.logout || 'Log Out'}</span>
        </button>
      </div>
    </aside>
  );
}
