'use client';

import { useEffect } from 'react';
import { usePathname } from '../lib/navigation';
import Header, { TopBar } from './Header';
import Navigation from './Navigation';
import Footer from './Footer';
import VerifyContactPrompt from './verification/VerifyContactPrompt';
import ChatWidget from './chat/ChatWidget';
import MobileBottomNav from './MobileBottomNav';
import { useApp } from '../context/AppContext';
import { isAuthPath, isDashboardPath } from '../lib/dashboardRoute';

export default function AppChrome({ children }) {
  const pathname = usePathname();
  const { siteSettings, theme } = useApp();

  useEffect(() => {
    const faviconUrl = siteSettings?.favicon_url;
    if (!faviconUrl) return;
    let link = document.querySelector("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = faviconUrl;
  }, [siteSettings?.favicon_url]);

  const isDashboardRoute = isDashboardPath(pathname);

  // Dark only inside a dashboard — the storefront is always light, whatever was chosen.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark' && isDashboardRoute);
  }, [theme, isDashboardRoute]);

  if (isDashboardRoute) {
    return (
      <div className="min-h-screen bg-zinc-50">
        {/* A store owner confirms their contact details here, on the only
            screens they actually use. Silent for admins and for anyone
            already confirmed. */}
        <VerifyContactPrompt />
        {children}
      </div>
    );
  }

  // Sign-in and sign-up bring their own layout (app/(auth)/layout.js) — none of the store's.
  if (isAuthPath(pathname)) return children;

  return (
    // On a phone the page ends above the bottom bar, so the footer is not hidden under it.
    <div className="min-h-screen flex flex-col bg-marine-canvas pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
      {/* Pinned on every screen. On a phone that is the black bar and the app bar — plus the
          search box above the logo once the page is scrolled (Header) — and no red menu. */}
      <div className="sticky top-0 z-50 shadow-pod bg-white">
        <TopBar />
        <Header />
        <Navigation />
      </div>
      {/* Renders itself only for a signed-in customer with an unconfirmed
          email or phone; silent for everyone else. */}
      <VerifyContactPrompt />
      <main className="flex-1">
        {children}
      </main>
      <Footer />
      {/* The AI assistant — storefront only, never on the dashboards. */}
      <ChatWidget />
      <MobileBottomNav />
    </div>
  );
}
