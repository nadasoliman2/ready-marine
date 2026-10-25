'use client';

import AdminSidebar from '../../../components/dashboard/AdminSidebar';
import TopBar from '../../../components/dashboard/TopBar';
import { useApp } from '../../../context/AppContext';
import { AdminAccessProvider } from '../../../context/AdminAccessContext';
import { useRouter } from '../../../lib/navigation';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import Overlay from '../../../components/Overlay';

export default function AdminDashboardLayout({ children }) {
  const { user, isMounted, language } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();
  const isAr = language === 'ar';

  useEffect(() => {
    if (isMounted) {
      if (!user) {
        router.push('/admin/login');
      } else if (user.role !== 'admin') {
        router.push('/');
      }
    }
  }, [user, isMounted, router]);

  // Close sidebar on navigation (for mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, []); // Only on mount/unmount or we can track pathname if needed

  if (!isMounted || !user || user.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#0E1012]">
        <Loader2 size={40} className="text-marine-primary animate-spin" />
      </div>
    );
  }

  return (
    <AdminAccessProvider>
    <div className="flex h-screen-safe bg-zinc-50 dark:bg-[#0E1012] font-sans antialiased text-zinc-900 dark:text-zinc-100 overflow-hidden" dir={isAr ? 'rtl' : 'ltr'}>
      {/* Sidebar Overlay */}
      {sidebarOpen && (
        <Overlay 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm transition-opacity" 
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Admin Sidebar */}
      <AdminSidebar isOpen={sidebarOpen} setIsOpen={setSidebarOpen} />
      
      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
        {/* Top Navigation */}
        <TopBar onMenuClick={() => setSidebarOpen(true)} />
        
        {/* Page Content - Scrollable */}
        <main className="flex-1 min-h-0 overflow-x-auto overflow-y-auto bg-zinc-50 dark:bg-[#0E1012] p-4 lg:p-8">
          <div className="max-w-[1600px] mx-auto w-full">
            {children}
          </div>
        </main>
      </div>

      {/* Popups render here (see components/Overlay.jsx): on the screen, yet still
          inside the shell, so they keep its text colour and font. */}
      <div id="overlay-root" />
    </div>
    </AdminAccessProvider>
  );
}
