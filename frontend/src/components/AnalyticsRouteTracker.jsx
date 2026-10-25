'use client';

import { useEffect } from 'react';
import { usePathname } from '../lib/navigation';

/**
 * The only place that fires Meta Pixel PageView events. This covers both the
 * initial page and client-side route changes. The URL guard is stored on window
 * so React Strict Mode, remounts, and the pixel-ready event cannot double-fire.
 *
 * GA4 is intentionally NOT fired here: GA4 Enhanced Measurement ("page changes
 * based on browser history events", enabled by default) already sends a page_view
 * on SPA navigations, so a manual gtag call would double-count. Microsoft Clarity
 * tracks SPA navigations automatically as well.
 */
export default function AnalyticsRouteTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const trackPageView = () => {
      if (typeof window.fbq !== 'function') return;

      const pageKey = `${window.location.pathname}${window.location.search}`;
      if (window.__readyCarLastMetaPageView === pageKey) return;

      window.__readyCarLastMetaPageView = pageKey;
      window.fbq('track', 'PageView');
    };

    // Register first so there is no race if next/script initializes the pixel
    // between checking window.fbq and attaching the listener.
    window.addEventListener('readycar:meta-pixel-ready', trackPageView);
    trackPageView();

    return () => {
      window.removeEventListener('readycar:meta-pixel-ready', trackPageView);
    };
  }, [pathname]);

  return null;
}
