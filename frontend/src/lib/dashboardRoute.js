import { stripLocale } from './locale';

// The screens that live in a dashboard (admin, store owner, company portal) rather than
// the storefront. Only these follow the light/dark switch — the storefront is always light.
// The company invitation landing page is opened from a message and belongs to the store.
// Takes the browser's path as it is, with or without the language in front (/ar/dashboard).
// Sign-in and sign-up (app/(auth)): their own full-screen layout, without the store's
// header, menu, footer, chat and bottom bar.
export function isAuthPath(pathname) {
  if (!pathname) return false;
  const path = stripLocale(pathname);
  return path === '/login' || path === '/register';
}

export function isDashboardPath(pathname) {
  if (!pathname) return false;
  const path = stripLocale(pathname);
  if (path.startsWith('/dashboard') || path.startsWith('/admin')) return true;
  return path.startsWith('/company') && !path.startsWith('/company/invitation');
}
