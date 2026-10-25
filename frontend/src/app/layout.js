import { Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';
import Providers from './providers';
import { cookies, headers } from 'next/headers';
import AppChrome from '../components/AppChrome';
import AnalyticsHead from '../components/AnalyticsHead';
import AnalyticsRouteTracker from '../components/AnalyticsRouteTracker';

// Inter for body text, Space Grotesk for headings, prices, labels and part numbers
// (Tailwind's `font-sans` / `font-display`).
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], display: 'swap', variable: '--font-space-grotesk' });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://readycar.store';

// Detail pages whose slug differs per language (`/en/product/brake-pads`,
// `/ar/product/تيل-فرامل`): the same path in the other language is not the same page, so
// they get no alternates here. Articles set their own.
const PER_LANGUAGE_SLUG = /^\/(product|bundle|services|articles)\/[^/]+/;

const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Ready Marine - Yacht & Marine Spare Parts',
    template: '%s | Ready Marine',
  },
  description: 'Your trusted source for genuine yacht, boat and marine engine spare parts. Verified fitment, delivered fast to your dock or marina.',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    alternateLocale: 'ar_SA',
    siteName: 'Ready Marine',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  other: {
    'geo.region': 'QA',
    'geo.placename': 'Qatar',
    // Meta domain verification — must be static in the server-delivered <head> source.
    'facebook-domain-verification': 'in6pbkimcdss22q2y8nbnqai5xeiuj',
  },
};

/**
 * The language comes from the URL (`/ar/...`): the middleware passes it, and the path without
 * it, in `x-locale` / `x-pathname`. Each page points at itself as canonical and at its other
 * language through hreflang.
 */
export async function generateMetadata() {
  const requestHeaders = headers();
  const locale = requestHeaders.get('x-locale') === 'ar' ? 'ar' : 'en';
  const path = requestHeaders.get('x-pathname') || '/';
  const suffix = path === '/' ? '' : path;

  const localized = {
    ...metadata,
    openGraph: {
      ...metadata.openGraph,
      locale: locale === 'ar' ? 'ar_SA' : 'en_US',
      alternateLocale: locale === 'ar' ? 'en_US' : 'ar_SA',
    },
  };
  if (PER_LANGUAGE_SLUG.test(path)) return localized;

  return {
    ...localized,
    alternates: {
      canonical: `/${locale}${suffix}`,
      languages: { en: `/en${suffix}`, ar: `/ar${suffix}`, 'x-default': `/en${suffix}` },
    },
  };
}

export default function RootLayout({ children }) {
  // Read language from cookie server-side so the first render is always correct
  const cookieStore = cookies();
  const initialLanguage = cookieStore.get('language')?.value === 'ar' ? 'ar' : 'en';
  const dir = initialLanguage === 'ar' ? 'rtl' : 'ltr';
  // Light unless the visitor switched to dark — and only the dashboards ever go dark;
  // the storefront stays light. The `dark` class itself is set by the head script below,
  // which knows the path before the first paint.
  const initialTheme = cookieStore.get('theme')?.value === 'dark' ? 'dark' : 'light';

  return (
    <html
      lang={initialLanguage}
      dir={dir}
      suppressHydrationWarning
    >
      <head>
        {/* Fallback: sync localStorage → cookie on client for older sessions */}
        <script dangerouslySetInnerHTML={{
          __html: `
            try {
              const lang = document.cookie.match(/(?:^|;\\s*)language=([^;]*)/)?.[1]
                        || localStorage.getItem('language')
                        || 'en';
              // Write back as cookie if not already set
              if (!document.cookie.includes('language=')) {
                document.cookie = 'language=' + lang + ';path=/;max-age=31536000';
              }
              document.documentElement.lang = lang;
              document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
              // Theme: the saved choice wins over the device; no choice means light.
              // Dashboards only — keep in step with lib/dashboardRoute.js.
              const theme = document.cookie.match(/(?:^|;\\s*)theme=([^;]*)/)?.[1]
                         || localStorage.getItem('theme')
                         || 'light';
              const p = location.pathname.replace(/^\\/(en|ar)(?=\\/|$)/, '') || '/';
              const inDashboard = p.startsWith('/dashboard') || p.startsWith('/admin')
                || (p.startsWith('/company') && !p.startsWith('/company/invitation'));
              document.documentElement.classList.toggle('dark', theme === 'dark' && inDashboard);
              if (!document.cookie.includes('theme=')) {
                document.cookie = 'theme=' + theme + ';path=/;max-age=31536000';
              }
            } catch (e) {}
          `
        }} />
      </head>
      <body className={`${inter.variable} ${spaceGrotesk.variable} font-sans`}>
        {/* Marketing tracking tags (GA4, Microsoft Clarity, Meta Pixel) via next/script */}
        <AnalyticsHead />
        {/* Meta Pixel <noscript> fallback (invalid inside <head>, valid here) */}
        <noscript>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            height="1"
            width="1"
            style={{ display: 'none' }}
            src="https://www.facebook.com/tr?id=1447711580456108&ev=PageView&noscript=1"
            alt=""
          />
        </noscript>
        <Providers initialLanguage={initialLanguage} initialTheme={initialTheme}>
          <AppChrome>{children}</AppChrome>
        </Providers>
        <AnalyticsRouteTracker />
      </body>
    </html>
  );
}
