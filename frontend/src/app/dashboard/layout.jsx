'use client';

import Sidebar from '../../components/dashboard/Sidebar';
import TopBar from '../../components/dashboard/TopBar';
import SubscriptionBanner from '../../components/dashboard/SubscriptionBanner';
import VendorEducationModal from '../../components/vendor/VendorEducationModal';
import { useApp } from '../../context/AppContext';
import { vendorApi } from '../../lib/api';
import { stripLocale } from '../../lib/locale';
import { useRouter, usePathname } from '../../lib/navigation';
import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import Overlay from '../../components/Overlay';

export default function DashboardLayout({ children }) {
  const { user, isMounted, language, login } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [educationOpen, setEducationOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const isAr = language === 'ar';
  // Printable pages (the combined company order's packing labels) render without the
  // dashboard around them, so the printer gets the labels and nothing else.
  const isPrintPage = !!pathname?.endsWith('/labels');

  useEffect(() => {
    if (isMounted) {
      if (!user) {
        // Keep where they were headed: a vendor opening an order from its WhatsApp
        // link is usually signed out in that browser, and must land on the order.
        const target = `${stripLocale(window.location.pathname)}${window.location.search}`;
        router.push(target === '/dashboard'
          ? '/login?role=vendor'
          : `/login?role=vendor&redirect=${encodeURIComponent(target)}`);
      } else if (user.role !== 'vendor') {
        router.push('/profile?tab=info');
      }
    }
  }, [user, isMounted, router]);

  // Close sidebar on navigation (for mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [router.pathname]);

  useEffect(() => {
    if (!isMounted || !user || user.role !== 'vendor' || profileLoaded) return;

    setProfileLoaded(true);
    vendorApi.getProfile()
      .then(profile => {
        login({
          ...user,
          ...profile,
          id: profile._id || profile.id || user.id,
          role: 'vendor',
        });
      })
      .catch(() => {});
  }, [isMounted, user, profileLoaded, login]);

  useEffect(() => {
    if (!isMounted || !user || user.role !== 'vendor') return;
    if (sessionStorage.getItem('readycar_show_vendor_education') !== '1') return;

    sessionStorage.removeItem('readycar_show_vendor_education');
    setEducationOpen(true);
  }, [isMounted, user]);

  if (!isMounted || !user || user.role !== 'vendor') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#0E1012]">
        <Loader2 size={40} className="text-marine-primary animate-spin" />
      </div>
    );
  }

  if (isPrintPage) {
    return <div className="min-h-screen bg-white text-zinc-900" dir={isAr ? 'rtl' : 'ltr'}>{children}</div>;
  }

  return (
    <div className="flex h-screen-safe bg-zinc-50 dark:bg-[#0E1012] font-sans antialiased text-zinc-900 dark:text-zinc-100 overflow-hidden" dir={isAr ? 'rtl' : 'ltr'}>
      {/* Sidebar Overlay */}
      {sidebarOpen && (
        <Overlay 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm transition-opacity" 
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <Sidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
      
      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
        {/* Top Navigation */}
        <TopBar
          onMenuClick={() => setSidebarOpen(true)}
          onEducationClick={() => setEducationOpen(true)}
        />
        
        {/* Page Content - Scrollable */}
        <main className="flex-1 min-h-0 overflow-x-auto overflow-y-auto bg-zinc-50 dark:bg-[#0E1012] p-4 lg:p-8">
          <div className="max-w-[1600px] mx-auto w-full">
            {user.status === 'suspended' && (
              <div className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                <AlertTriangle size={22} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-black">{isAr ? 'حساب البائع موقوف' : 'Vendor Account Suspended'}</p>
                  <p className="mt-1 text-sm font-semibold">
                    {isAr
                      ? 'منتجاتك غير ظاهرة للعملاء ولا يمكن شراؤها حالياً. يرجى التواصل مع الدعم لإعادة تفعيل الحساب.'
                      : 'Your products are hidden from customers and cannot be purchased right now. Please contact support to reactivate your account.'}
                  </p>
                </div>
              </div>
            )}
            <SubscriptionBanner />
            {children}
          </div>
        </main>
      </div>

      <VendorEducationModal
        open={educationOpen}
        onClose={() => setEducationOpen(false)}
        language={language}
      />

      {/* Popups render here (see components/Overlay.jsx): on the screen, yet still
          inside the shell, so they keep its text colour and font. */}
      <div id="overlay-root" />
    </div>
  );
}
