import { useMemo } from 'react';
import { useRouter as useNextRouter, usePathname as useNextPathname } from 'next/navigation';
import { useAppLanguage } from '../context/AppContext';
import { DEFAULT_LOCALE, localeOfPath, localizePath, stripLocale } from './locale';

/**
 * `next/navigation`, aware of the language segment every page URL starts with
 * (`lib/locale.js`). Import from here instead of `next/navigation`:
 *
 * - `usePathname()` returns the path without the language (`/products`, not `/ar/products`),
 *   so the checks written against routes (`pathname === '/'`, `startsWith('/dashboard')`)
 *   keep working.
 * - `useRouter()` puts the current language on every path it is given.
 *
 * Everything else is `next/navigation` itself.
 */
export * from 'next/navigation';

/** The language links should carry: the app's, else the URL's. */
export function useLocale() {
  const language = useAppLanguage();
  const pathname = useNextPathname();
  return language || localeOfPath(pathname) || DEFAULT_LOCALE;
}

export function usePathname() {
  return stripLocale(useNextPathname());
}

export function useRouter() {
  const router = useNextRouter();
  const locale = useLocale();
  return useMemo(() => ({
    ...router,
    push: (href, options) => router.push(localizePath(href, locale), options),
    replace: (href, options) => router.replace(localizePath(href, locale), options),
    prefetch: (href, options) => router.prefetch(localizePath(href, locale), options),
  }), [router, locale]);
}
