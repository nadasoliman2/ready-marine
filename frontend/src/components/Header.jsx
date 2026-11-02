'use client';

import { useEffect, useRef, useState } from 'react';
import { ShoppingCart, User, Users, Phone, LogOut, LifeBuoy } from 'lucide-react';
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

/** EN · العربية side by side in the top bar, the current one highlighted. */
function LanguagePicker() {
  const { language, setLanguage } = useApp();
  const option = (lang, label) => (
    <button
      type="button"
      onClick={() => setLanguage(lang)}
      aria-pressed={language === lang}
      className={`px-1.5 py-0.5 rounded transition-colors text-[11px] font-bold ${
        language === lang ? 'text-marine-primary font-black' : 'text-marine-muted hover:text-marine-ink'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex items-center gap-1 font-display text-[11px] tracking-wider uppercase">
      {option('ar', 'العربية')}
      <span className="text-slate-300">|</span>
      {option('en', 'EN')}
    </div>
  );
}

export function TopBar() {
  const { language, siteSettings } = useApp();
  const pathname = usePathname();
  const headerPhone = siteSettings?.header_phone || '010155661614';
  const isAr = language === 'ar';
  const headerText = isAr ? siteSettings?.header_text_ar : siteSettings?.header_text_en;

  if (pathname.startsWith('/dashboard') || pathname.startsWith('/admin')) return null;

  return (
    <div className="bg-marine-mist text-marine-muted py-1.5 px-4 text-xs border-b border-marine-teal/10 relative z-[60]">
      {/* Mobile Top Strip: Phone on start (right in RTL), LanguagePicker on end (left in RTL) */}
      <div className="md:hidden max-w-7xl mx-auto flex items-center justify-between text-[11px]">
        {headerPhone && (
          <a href={`tel:${headerPhone}`} className="flex items-center gap-1.5 text-marine-ink hover:text-marine-primary transition-colors font-medium">
            <Phone size={12} className="text-marine-primary" />
            <span dir="ltr">{headerPhone}</span>
          </a>
        )}
        <LanguagePicker />
      </div>

      {/* Desktop TopBar */}
      <div className="hidden md:flex max-w-7xl mx-auto py-1.5 items-center justify-between">
        <div className="flex items-center gap-5">
          {headerPhone && (
            <a href={`tel:${headerPhone}`} className="flex items-center gap-1.5 hover:text-marine-primary transition-colors text-marine-ink font-medium">
              <Phone size={13} className="text-marine-primary" />
              <span dir="ltr">{headerPhone}</span>
            </a>
          )}
          {headerText && (
            <span className="flex items-center gap-1.5 text-marine-ink font-medium">
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
export function SiteLogo({ siteSettings, compact = false, className = '', dark = false }) {
  const chosenUrl = dark
    ? (siteSettings?.logo_light_url || siteSettings?.logo_url)
    : (siteSettings?.logo_url || siteSettings?.logo_light_url);
  if (chosenUrl) {
    return (
      <img
        src={chosenUrl}
        alt="Logo"
        className={`${compact ? 'h-8 sm:h-9 w-auto object-contain max-w-[185px]' : 'h-10 sm:h-12 w-auto object-contain max-w-[250px] sm:max-w-[300px]'} ${className}`}
      />
    );
  }
  return <BrandMark compact={compact} className={className} />;
}

const MENU_LINK = 'flex items-center gap-3 px-4 py-2.5 text-sm text-marine-muted hover:text-marine-ink hover:bg-marine-mist transition-colors';
const ICON_BUTTON = 'flex flex-col items-center gap-0.5 text-marine-ink hover:text-marine-primary px-2 sm:px-3 py-1 transition-colors';
const ICON_LABEL = 'font-display text-[10px] font-semibold tracking-[0.06em] uppercase text-marine-muted';

/**
 * A phone's search box that pins into the header once the user scrolls past the hero (ReadyCar style).
 * Two thresholds: SHOW_AFTER prevents premature appearance, HIDE_BEFORE prevents flicker.
 * It also remains shown while active/focused so opening the keyboard doesn't dismiss it.
 */
function ScrollSearchRow({ isAr, placeholder }) {
  const [shown, setShown] = useState(false);
  const rowRef = useRef(null);
  const pathname = usePathname();
  const isHome = pathname === '/' || pathname === '';

  useEffect(() => {
    const SHOW_AFTER = isHome ? 120 : 50;
    const HIDE_BEFORE = isHome ? 60 : 20;

    const update = () => {
      if (rowRef.current?.contains(document.activeElement)) return;
      const y = window.scrollY;
      setShown((was) => (was ? y > HIDE_BEFORE : y > SHOW_AFTER));
    };

    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [isHome]);

  if (!shown) return null;

  return (
    <div
      ref={rowRef}
      className="md:hidden px-3.5 pb-2.5 pt-1 animate-in fade-in slide-in-from-top-2 duration-200 border-t border-slate-100 bg-white"
    >
      <SearchAutocomplete
        placeholder={placeholder || (isAr ? 'ابحث برقم القطعة، الاسم، الماركة...' : 'Search by part number, name, brand...')}
        inputClassName="w-full bg-slate-50 border border-slate-200 text-marine-ink placeholder-slate-400 rounded-xl px-4 py-2.5 pe-10 text-xs sm:text-sm focus:outline-none focus:border-marine-cyan focus:bg-white shadow-2xs transition-all"
        buttonClassName="absolute end-3 top-1/2 -translate-y-1/2 text-marine-primary"
      />
    </div>
  );
}

export default function Header() {
  const { cartCount, setIsCartOpen, user, logout, isMounted, language, t, siteSettings } = useApp();
  const pathname = usePathname();
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMobileSearchOpen(false);
  }, [pathname]);

  if (pathname.startsWith('/dashboard') || pathname.startsWith('/admin')) return null;

  const isAr = language === 'ar';
  const cartLabel = isAr ? 'السلة' : 'Cart';
  const accountLabel = t.profile || (isAr ? 'حسابي' : 'Account');
  const isHome = pathname === '/' || pathname === '';

  return (
    <>
      {/* z-50 sits above Navigation's z-40, so the account menu opens over the nav bar. */}
      <header className="bg-white/95 backdrop-blur-md border-b border-slate-200/80 md:border-marine-teal/10 relative z-50 pointer-events-auto">
        {/* Mobile Navbar: Cart on right (start), Logo centered, User on left (end) in RTL */}
        <div className="md:hidden relative px-4 py-2.5 min-h-[58px] flex items-center justify-between z-10">
          {/* Start (Right in RTL): Cart (🛒) */}
          <div className="flex items-center z-20">
            {!(isMounted && (user?.role === 'vendor' || user?.role === 'admin')) && (
              <button
                type="button"
                onClick={() => setIsCartOpen(true)}
                data-cart-target=""
                aria-label={cartLabel}
                className="relative w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 text-[#0a2540] flex items-center justify-center transition-colors shadow-2xs"
              >
                <ShoppingCart size={19} />
                {isMounted && cartCount > 0 && (
                  <span className="absolute -top-1 -end-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#009bb3] text-white text-[10px] font-bold leading-none flex items-center justify-center shadow-xs">
                    {cartCount}
                  </span>
                )}
              </button>
            )}
          </div>

          {/* Center: Exactly centered Logo */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <Link href="/" className="pointer-events-auto flex items-center justify-center min-h-[38px] px-2">
              <SiteLogo siteSettings={siteSettings} compact />
            </Link>
          </div>

          {/* End (Left in RTL): Profile (👤) */}
          <div className="flex items-center z-20">
            <Link
              href={!isMounted || !user ? '/login' : (user.role === 'admin' ? '/admin/dashboard' : user.role === 'vendor' ? '/dashboard' : '/profile')}
              aria-label={user ? accountLabel : t.signIn}
              className="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 text-[#0a2540] flex items-center justify-center overflow-hidden transition-colors shadow-2xs"
            >
              {isMounted && user?.profile_image ? (
                <img src={resolveAssetUrl(user.profile_image)} alt="" className="w-full h-full object-cover" />
              ) : (
                <User size={19} />
              )}
            </Link>
          </div>
        </div>

        {/* Mobile Scrolled Fixed Search: Joins the sticky header when scrolled past hero (ReadyCar style) */}
        {!pathname.startsWith('/checkout') && (
          <ScrollSearchRow
            isAr={isAr}
            placeholder={isAr ? 'ابحث برقم القطعة، الاسم، الماركة...' : 'Search by part number, name, brand...'}
          />
        )}

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
                        <Link href="/profile" className={MENU_LINK}>
                          <User size={16} />
                          <span>{t.profile || (language === 'ar' ? 'الملف الشخصي' : 'Profile')}</span>
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
