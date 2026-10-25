/**
 * The language is the first segment of every page's URL: `/ar/products`, `/en/product/<slug>`.
 *
 * The app's routes themselves have no language segment. The middleware serves `/ar/...` from
 * the route at `/...`, after setting the `language` cookie the layout renders with; the link
 * and router wrappers in `lib/navigation.js` put the segment back on every link. These helpers
 * are shared by both sides, including the edge middleware, so they use nothing but strings.
 */
export const LOCALES = ['en', 'ar'];
export const DEFAULT_LOCALE = 'en';

const PREFIX = /^\/(en|ar)(?=\/|$)/;

export const isLocale = (value) => value === 'en' || value === 'ar';

/** `/ar/products` → `ar`; a path without a language → `null`. */
export const localeOfPath = (pathname) => {
  const match = typeof pathname === 'string' ? pathname.match(PREFIX) : null;
  return match ? match[1] : null;
};

/** `/ar/products` → `/products`, `/ar` → `/`. A path without a language is returned as is. */
export const stripLocale = (pathname) => {
  if (typeof pathname !== 'string') return pathname;
  const rest = pathname.replace(PREFIX, '');
  return rest === '' ? '/' : rest;
};

/**
 * Whether a path is a page that carries a language: not a file (`/logo.png`, `/sitemap.xml`),
 * not the API, not an uploaded file, not Next's own assets.
 */
export const isPagePath = (pathname) =>
  !/^\/(_next|api|uploads)(\/|$)/.test(pathname) && !/\.[A-Za-z0-9]+$/.test(pathname);

/**
 * Put the language on a site path: `/products?x=1` → `/ar/products?x=1`. Anything else —
 * an outside URL, `//host`, `?tab=x`, `#top`, a file, or a path that already has a language —
 * is returned unchanged.
 */
export const localizePath = (href, locale) => {
  if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//') || !isLocale(locale)) return href;
  const cut = href.search(/[?#]/);
  const path = cut === -1 ? href : href.slice(0, cut);
  const rest = cut === -1 ? '' : href.slice(cut);
  if (localeOfPath(path) || !isPagePath(path)) return href;
  return `/${locale}${path === '/' ? '' : path}${rest}`;
};

/** The same page in another language: `/en/products` → `/ar/products`. */
export const switchLocale = (pathname, locale) => {
  if (!isPagePath(stripLocale(pathname))) return pathname;
  return localizePath(stripLocale(pathname), locale);
};

/** `localizePath` for a `next/link` href, which may also be `{ pathname, query }`. */
export const localizeHref = (href, locale) => {
  if (typeof href === 'string') return localizePath(href, locale);
  if (href && typeof href === 'object' && typeof href.pathname === 'string') {
    return { ...href, pathname: localizePath(href.pathname, locale) };
  }
  return href;
};
