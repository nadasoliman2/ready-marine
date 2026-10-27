'use client';

import { useEffect, useRef, useState } from 'react';
import { ShoppingCart, User, Users, Phone, LogOut, LifeBuoy, Globe, ChevronDown, Check } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { usePathname } from '../lib/navigation';
import Link from './LocaleLink';
import CartDrawer from './CartDrawer';
import SearchAutocomplete from './search/SearchAutocomplete';
import CustomerNotificationBell from './CustomerNotificationBell';
import CompanyBadge, { CompanyPortalMenuLink } from './company/CompanyBadge';
import { familyCopy } from '../lib/familyLocalization';
import { resolveAssetUrl } from '../lib/assets';
import BrandMark from './marine/BrandMark';

const LANGUAGES = [
  { code: 'ar', label: 'العربية' },
  { code: 'en', label: 'English' },
];

/** The top bar's language dropdown: the current language, the other one in the menu. */
function LanguagePicker() {
  const { language, setLanguage } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = LANGUAGES.find((l) => l.code === language) || LANGUAGES[0];

  // Closes on a click anywhere else or on Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 px-2 py-1 rounded font-bold text-marine-primary hover:bg-white/70 transition-colors"
      >
        <Globe size={13} />
        {current.label}
        <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul role="listbox" className="absolute top-full mt-1 end-0 min-w-[130px] bg-white border border-marine-teal/15 rounded-lg shadow-lg py-1 z-[70]">
          {LANGUAGES.map((l) => (
            <li key={l.code}>
              <button
                type="button"
                role="option"
                aria-selected={l.code === language}
                onClick={() => { setLanguage(l.code); setOpen(false); }}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-xs text-start transition-colors ${
                  l.code === language ? 'text-marine-primary font-bold bg-marine-mist' : 'text-marine-ink hover:bg-marine-canvas'
                }`}
              >
                {l.label}
                {l.code === language && <Check size={13} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TopBar() {
  const { language, siteSettings } = useApp();
  const pathname = usePathname();
  const headerPhone = siteSettings?.header_phone || '';
  const headerText = language === 'ar' ? siteSettings?.header_text_ar : siteSettings?.header_text_en;

  if (pathname.startsWith('/dashboard') || pathname.startsWith('/admin')) return null;

  return (
    <div className="bg-marine-mist text-marine-muted py-1.5 px-4 text-xs border-b border-marine-teal/10 relative z-[60]">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-5">
          {headerPhone && (
            <a href={`tel:${headerPhone}`} className="flex items-center gap-1.5 hover:text-marine-primary transition-colors">
              <Phone size={13} className="text-marine-primary" />
              <span dir="ltr">{headerPhone}</span>
            </a>
          )}
          {headerText && (
            <span className="hidden sm:flex items-center gap-1.5">
              <LifeBuoy size={13} className="text-marine-primary" />
              {headerText}
            </span>
          )}
        </div>
        <LanguagePicker />
      </div>
    </div>
  );
}

/** The site's logo from its settings, or Ready Marine's own when none is uploaded. */
function SiteLogo({ siteSettings, compact = false }) {
  if (siteSettings?.logo_light_url || siteSettings?.logo_url) {
    return (
      <img
        src={siteSettings.logo_light_url || siteSettings.logo_url}
        alt="Logo"
        className={compact ? 'h-9 w-auto object-contain max-w-[200px]' : 'h-10 sm:h-12 w-auto object-contain max-w-[180px] sm:max-w-[300px]'}
      />
    );
  }
  return <BrandMark compact={compact} />;
}

/**
 * A phone's search box, above the logo once the page is scrolled. The header is pinned
 * (AppChrome), so the row joins it on top of the logo and leaves again back at the top of
 * the page. Two thresholds, not one: the row's own height moves the page, and a single line
 * would make it flicker in and out right at the edge. It also stays while its box has the
 * focus — the keyboard opening can move the page, and it must not vanish mid-typing.
 */
function ScrollSearchRow({ placeholder }) {
  const [shown, setShown] = useState(false);
  const rowRef = useRef(null);

  useEffect(() => {
    const SHOW_AFTER = 120;
    const HIDE_BEFORE = 40;
    const update = () => {
      if (rowRef.current?.contains(document.activeElement)) return;
      const y = window.scrollY;
      setShown((was) => (was ? y > HIDE_BEFORE : y > SHOW_AFTER));
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  return (
    <div ref={rowRef} className={shown ? 'md:hidden px-4 pt-2.5 animate-in fade-in slide-in-from-top-2 duration-200' : 'hidden'}>
      <SearchAutocomplete
        placeholder={placeholder}
        inputClassName="w-full bg-white border border-marine-teal/20 text-marine-ink placeholder-marine-outline rounded px-4 py-2.5 pe-12 focus:outline-none focus:border-marine-cyan focus:ring-[3px] focus:ring-marine-cyan/15 text-base"
        buttonClassName="absolute end-3 top-1/2 -translate-y-1/2 text-marine-primary"
      />
    </div>
  );
}

const MENU_LINK = 'flex items-center gap-3 px-4 py-2.5 text-sm text-marine-muted hover:text-marine-ink hover:bg-marine-mist transition-colors';
const ICON_BUTTON = 'flex flex-col items-center gap-0.5 text-marine-ink hover:text-marine-primary px-2 sm:px-3 py-1 transition-colors';
const ICON_LABEL = 'font-display text-[10px] font-semibold tracking-[0.06em] uppercase text-marine-muted';

export default function Header() {
  const { cartCount, setIsCartOpen, user, logout, isMounted, language, t, siteSettings } = useApp();
  const pathname = usePathname();

  if (pathname.startsWith('/dashboard') || pathname.startsWith('/admin')) return null;

  const cartLabel = language === 'ar' ? 'السلة' : 'Cart';
  const accountLabel = t.profile || (language === 'ar' ? 'حسابي' : 'Account');

  return (
    <>
      {/* z-50 sits above Navigation's z-40, so the account menu opens over the nav bar. */}
      <header className="bg-white/90 backdrop-blur-md border-b border-marine-teal/10 relative z-50">
        {/* A phone, scrolled: the search box on top of the logo (ScrollSearchRow). */}
        {!pathname.startsWith('/checkout') && <ScrollSearchRow placeholder={t.search} />}

        {/* A phone: the account on one side, the logo in the middle, the cart on the other.
            Signing in and the rest live in "More" too. */}
        <div className="md:hidden px-4 py-2.5 grid grid-cols-[1fr_auto_1fr] items-center">
          <div className="flex items-center gap-2 justify-self-start">
            <Link
              href={!isMounted || !user ? '/login' : (user.role === 'admin' ? '/admin/dashboard' : user.role === 'vendor' ? '/dashboard' : '/profile?tab=info')}
              aria-label={user ? accountLabel : t.signIn}
              className="w-10 h-10 rounded-md bg-marine-mist text-marine-teal flex items-center justify-center overflow-hidden"
            >
              {isMounted && user?.profile_image
                ? <img src={resolveAssetUrl(user.profile_image)} alt="" className="w-full h-full object-cover" />
                : <User size={20} />}
            </Link>
            <CustomerNotificationBell />
          </div>
          <Link href="/" className="flex items-center gap-2 justify-self-center min-h-[40px]">
            <SiteLogo siteSettings={siteSettings} compact />
          </Link>
          <div className="flex items-center gap-2 justify-self-end">
            <CompanyBadge />
            {!(isMounted && (user?.role === 'vendor' || user?.role === 'admin')) && (
              <button
                type="button"
                onClick={() => setIsCartOpen(true)}
                // Where the chat's "add to cart" flight lands; the visible one of the two is used.
                data-cart-target=""
                aria-label={cartLabel}
                className="relative w-10 h-10 rounded-md bg-marine-mist text-marine-teal flex items-center justify-center"
              >
                <ShoppingCart size={20} />
                {isMounted && cartCount > 0 && (
                  <span className="absolute -top-1 -end-1 min-w-[18px] h-[18px] px-1 rounded-full bg-marine-cyan text-white text-[10px] font-bold leading-none flex items-center justify-center">
                    {cartCount}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>

        <div className="hidden md:flex max-w-7xl mx-auto px-4 py-3 items-center gap-4">
          <Link href="/" className="flex items-center gap-2 flex-shrink-0 min-h-[40px]">
            <SiteLogo siteSettings={siteSettings} />
          </Link>

          <div className="flex-1 max-w-2xl mx-4 hidden md:block">
            <SearchAutocomplete
              placeholder={t.search}
              inputClassName="w-full bg-white border border-marine-teal/20 text-marine-ink placeholder-marine-outline rounded px-4 py-2.5 pe-12 focus:outline-none focus:border-marine-cyan focus:ring-[3px] focus:ring-marine-cyan/15 transition-all text-sm"
              buttonClassName="absolute end-1.5 top-1/2 -translate-y-1/2 w-9 h-8 rounded-sm bg-marine-primary text-white flex items-center justify-center hover:bg-marine-teal transition-colors"
            />
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 ms-auto">
            {isMounted ? (
              user ? (
                <div className="relative group/user py-2">
                  <button className={ICON_BUTTON}>
                    {user.profile_image ? (
                      <img src={resolveAssetUrl(user.profile_image)} alt={user.name || 'Profile'} className="w-6 h-6 rounded-sm object-cover" />
                    ) : (
                      <User size={20} />
                    )}
                    <span className={ICON_LABEL}>{accountLabel}</span>
                  </button>

                  {/* Invisible bridge */}
                  <div className="absolute top-full right-0 w-full h-2 z-[95]" />

                  <div className="absolute top-full end-0 mt-0 w-56 bg-white border border-marine-teal/15 rounded-lg shadow-pod py-2 z-[100] hidden group-hover/user:block animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="px-5 py-3 border-b border-marine-teal/10 mb-1">
                      <p className="text-marine-ink font-semibold text-sm truncate">{user.name}</p>
                      <p className="font-display text-marine-primary text-[10px] font-bold uppercase tracking-[0.08em] mt-0.5 truncate">{user.role || 'User'}</p>
                    </div>

                    {user.role === 'vendor' || user.role === 'admin' ? (
                      <Link href={user.role === 'admin' ? '/admin/dashboard' : '/dashboard'} className={MENU_LINK}>
                        <User size={16} />
                        <span>{t.dashboard || 'Dashboard'}</span>
                      </Link>
                    ) : (
                      <>
                        <Link href="/profile?tab=info" className={MENU_LINK}>
                          <User size={16} />
                          <span>{t.profile}</span>
                        </Link>
                        <Link href="/profile?tab=family" className={MENU_LINK}>
                          <Users size={16} />
                          <span>{familyCopy(language === 'ar').family}</span>
                        </Link>
                        <CompanyPortalMenuLink className={MENU_LINK} />
                        <Link href="/support" className={MENU_LINK}>
                          <LifeBuoy size={16} />
                          <span>{t.support || (language === 'ar' ? 'الدعم الفني' : 'Support')}</span>
                        </Link>
                      </>
                    )}

                    <button
                      onClick={logout}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <LogOut size={16} />
                      <span>{t.logout}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Signing up is the call to action, so it carries the cyan button and stays on
                      one line; signing in, for people who already have an account, is the quiet
                      link, and on a narrow phone it may wrap so the row fits. */}
                  {pathname !== '/login' && (
                    <Link href="/login" className="flex items-center gap-1.5 text-center leading-tight sm:whitespace-nowrap text-marine-ink hover:text-marine-primary px-2 sm:px-3 py-2 rounded transition-colors hover:bg-marine-mist text-xs sm:text-sm font-medium">
                      {t.signIn}
                    </Link>
                  )}

                  {pathname !== '/register' && (
                    <Link href="/register" className="flex items-center justify-center whitespace-nowrap bg-marine-cyan hover:bg-marine-cyan-dark text-white px-3.5 sm:px-5 py-2.5 rounded font-display font-bold uppercase tracking-[0.06em] transition-colors text-xs">
                      {t.signUp}
                    </Link>
                  )}
                </>
              )
            ) : (
              <div className="w-24 h-10 bg-marine-mist animate-pulse rounded" />
            )}

            {/* Company balance — renders itself only for employees of a company account */}
            <CompanyBadge />

            {/* Customer notification bell — renders itself only for customers */}
            <CustomerNotificationBell />

            {/* Hide cart for staff accounts */}
            {!(isMounted && (user?.role === 'vendor' || user?.role === 'admin')) && (
              <button
                onClick={() => setIsCartOpen(true)}
                // Where the chat assistant's "add to cart" flight lands (components/chat/flyToCart).
                data-cart-target=""
                className={ICON_BUTTON}
              >
                {/* The count sits on the icon's corner, sized to fit "12" as well as "3". */}
                <span className="relative">
                  <ShoppingCart size={20} />
                  {isMounted && cartCount > 0 && (
                    <span className="absolute -top-2 -end-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-marine-cyan text-white text-[10px] font-bold leading-none flex items-center justify-center">
                      {cartCount}
                    </span>
                  )}
                </span>
                <span className={ICON_LABEL}>{cartLabel}</span>
              </button>
            )}
          </div>
        </div>

      </header>

      <CartDrawer />
    </>
  );
}
