'use client';

import { useEffect, useState } from 'react';
import {
  Home, LayoutGrid, Wrench, Menu, User, ChevronLeft, ChevronDown, Briefcase, Store,
  Newspaper, Truck, Phone, Mail, ShieldCheck, FileText, PackageSearch, LayoutDashboard,
} from 'lucide-react';
import Link from './LocaleLink';
import Overlay from './Overlay';
import { usePathname } from '../lib/navigation';
import { useApp } from '../context/AppContext';
import { MobileCategoryItem, useCategoryNavigate, useNavItems } from './Navigation';
import SearchAutocomplete from './search/SearchAutocomplete';
import { SEARCH_FILTER_EVENT } from '../lib/categoryFilterEvents';
import { resolveAssetUrl } from '../lib/assets';

/** A row of the "More" page: an icon in its red tile, the label, and the arrow. */
function MenuRow({ href, onClick, icon: Icon, label, active = false, trailing = null }) {
  const body = (
    <>
      <span className="w-10 h-10 shrink-0 rounded-xl bg-marine-mist text-marine-primary flex items-center justify-center">
        <Icon size={18} />
      </span>
      <span className={`flex-1 min-w-0 text-[15px] font-bold ${active ? 'text-marine-primary' : 'text-marine-ink'}`}>{label}</span>
      {trailing || <ChevronLeft size={18} className="shrink-0 text-marine-line ltr:rotate-180" />}
    </>
  );
  const className = 'w-full flex items-center gap-3 px-4 py-3 text-start active:bg-marine-canvas transition-colors';
  return href
    ? <Link href={href} onClick={onClick} className={className}>{body}</Link>
    : <button type="button" onClick={onClick} className={className}>{body}</button>;
}

function MenuGroup({ title, children }) {
  return (
    <section>
      <h3 className="px-2 mb-2 text-xs font-bold text-marine-outline">{title}</h3>
      <div className="bg-white rounded-lg border border-marine-teal/15 shadow-sm overflow-hidden divide-y divide-zinc-100">
        {children}
      </div>
    </section>
  );
}

/**
 * "More": a page of its own on a phone, as in the app design — the account on top, then what
 * to shop and where to get help, the categories and the search box. The language is in the black bar at the top. Under the
 * bottom bar's layer (z-100), so the bar stays on screen and "More" closes it again.
 */
function MorePage({ onClose, openCategory }) {
  const { language, t, categories, user, isMounted, siteSettings } = useApp();
  const isAr = language === 'ar';
  const pathname = usePathname();
  const labelOf = Object.fromEntries(useNavItems().map((item) => [item.href, item.label]));
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const phone = siteSettings?.header_phone || '';

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  const isStaff = isMounted && (user?.role === 'vendor' || user?.role === 'admin');
  const signedIn = isMounted && user;
  const accountHref = !signedIn ? '/login' : isStaff ? (user.role === 'admin' ? '/admin/dashboard' : '/dashboard') : '/profile?tab=info';
  const row = (href, icon, label) => (
    <MenuRow key={href} href={href} onClick={onClose} icon={icon} label={label} active={pathname === href.split('?')[0]} />
  );

  return (
    <Overlay className="md:hidden fixed inset-0 z-[95] bg-marine-canvas flex flex-col animate-in fade-in duration-200" dir={isAr ? 'rtl' : 'ltr'}>
      <header className="bg-white border-b border-marine-teal/15 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 px-4 text-center">
        <h2 className="text-lg font-bold text-marine-ink">{isAr ? 'المزيد' : 'More'}</h2>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] space-y-5">
        {/* The account first: signing in, or the account / dashboard once signed in. */}
        <Link href={accountHref} onClick={onClose} className="flex items-center gap-3 bg-marine-navy text-white rounded-lg p-4 shadow-lg">
          <span className="w-12 h-12 shrink-0 rounded-xl bg-white/10 flex items-center justify-center overflow-hidden">
            {isStaff ? <LayoutDashboard size={22} />
              : signedIn && user.profile_image
                ? <img src={resolveAssetUrl(user.profile_image)} alt="" className="w-full h-full object-cover" />
                : <User size={22} />}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-bold truncate">
              {!signedIn
                ? (isAr ? 'تسجيل الدخول / إنشاء حساب' : 'Sign in / Create account')
                : isStaff ? (t.dashboard || (isAr ? 'لوحة التحكم' : 'Dashboard')) : user.name}
            </span>
            <span className="block text-xs text-white/60 mt-0.5">
              {!signedIn
                ? (isAr ? 'تابع طلباتك واحفظ عربياتك' : 'Track your orders and save your cars')
                : (isAr ? 'حسابي وطلباتي' : 'My account and orders')}
            </span>
          </span>
          <ChevronLeft size={18} className="shrink-0 text-white/50 ltr:rotate-180" />
        </Link>

        <div className="bg-white rounded-lg border border-marine-teal/15 shadow-sm p-3">
          <SearchAutocomplete
            placeholder={t.search}
            inputClassName="w-full bg-marine-mist border border-transparent text-marine-ink placeholder-zinc-500 rounded-xl px-4 py-3 pe-12 focus:outline-none focus:border-marine-cyan focus:bg-white text-base"
            buttonClassName="absolute end-3 top-1/2 -translate-y-1/2 text-marine-primary"
          />
        </div>

        <MenuGroup title={isAr ? 'تسوق' : 'Shop'}>
          {row('/products', PackageSearch, labelOf['/products'])}
          <MenuRow
            onClick={() => setCategoriesOpen((open) => !open)}
            icon={LayoutGrid}
            label={t.categories}
            trailing={<ChevronDown size={18} className={`shrink-0 text-marine-outline transition-transform duration-300 ${categoriesOpen ? 'rotate-180' : ''}`} />}
          />
          {categoriesOpen && (
            <div className="animate-in slide-in-from-top duration-300">
              {categories.length > 0
                ? categories.map((cat) => <MobileCategoryItem key={cat._id} cat={cat} level={1} onNavigate={openCategory} light />)
                : <p className="p-5 text-center text-sm text-marine-outline">{isAr ? 'مفيش أقسام' : 'No categories yet'}</p>}
            </div>
          )}
          {row('/trunk', Briefcase, labelOf['/trunk'])}
          {row('/vendors', Store, labelOf['/vendors'])}
          {row('/services', Wrench, labelOf['/services'])}
          {row('/articles', Newspaper, labelOf['/articles'])}
        </MenuGroup>

        <MenuGroup title={isAr ? 'المساعدة والمعلومات' : 'Help & information'}>
          {row('/delivery', Truck, labelOf['/delivery'])}
          {row('/contact', Mail, labelOf['/contact'])}
          {row('/shipping', Truck, t.shippingPolicy || (isAr ? 'سياسة الشحن' : 'Shipping Policy'))}
          {row('/privacy', ShieldCheck, t.privacyPolicy || (isAr ? 'سياسة الخصوصية' : 'Privacy Policy'))}
          {row('/terms', FileText, t.termsConditions || (isAr ? 'الشروط والأحكام' : 'Terms & Conditions'))}
          {phone && (
            <a href={`tel:${phone}`} className="w-full flex items-center gap-3 px-4 py-3 active:bg-marine-canvas">
              <span className="w-10 h-10 shrink-0 rounded-xl bg-marine-mist text-marine-primary flex items-center justify-center"><Phone size={18} /></span>
              <span className="flex-1 text-[15px] font-bold text-marine-ink">{isAr ? 'كلمنا' : 'Call us'}</span>
              <span dir="ltr" className="text-sm font-bold text-marine-outline">{phone}</span>
            </a>
          )}
        </MenuGroup>

      </div>
    </Overlay>
  );
}

/**
 * The phone's bar along the bottom of the screen, as in the app design: home, the products,
 * the services and "More" — always under the thumb. The cart and the account are in the
 * header; everything else is in "More". On a phone the header scrolls away with the page;
 * this bar stays, and once the page scrolls the search box joins the pinned header above
 * the logo (Header's ScrollSearchRow).
 */
export default function MobileBottomNav() {
  const { language, t } = useApp();
  const isAr = language === 'ar';
  const pathname = usePathname();
  const [panel, setPanel] = useState(null); // 'more' | null
  const close = () => setPanel(null);
  const openCategory = useCategoryNavigate(close);

  // A page change closes whatever is open — and so does a search on the shop itself, which
  // filters in place without one.
  useEffect(() => { setPanel(null); }, [pathname]);
  useEffect(() => {
    const onSearch = () => setPanel(null);
    window.addEventListener(SEARCH_FILTER_EVENT, onSearch);
    return () => window.removeEventListener(SEARCH_FILTER_EVENT, onSearch);
  }, []);

  // Checkout has its own buttons at the bottom of the screen.
  if (pathname.startsWith('/checkout')) return null;

  const itemClass = (active) => `flex-1 flex flex-col items-center justify-center gap-1 pt-2 pb-1.5 text-[11px] font-bold transition-colors ${
    active ? 'text-marine-primary' : 'text-marine-outline active:text-marine-ink'
  }`;
  const onPage = (href) => !panel && (pathname === href || pathname.startsWith(`${href}/`));

  return (
    <>
      <nav
        aria-label={isAr ? 'القائمة السفلية' : 'Bottom menu'}
        className="md:hidden fixed bottom-0 inset-x-0 z-[100] bg-white border-t border-marine-teal/15 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex items-stretch h-16">
          <Link href="/" className={itemClass(!panel && pathname === '/')}>
            <Home size={22} />
            <span>{t.home}</span>
          </Link>
          <Link href="/products" className={itemClass(onPage('/products') || onPage('/product'))}>
            <LayoutGrid size={22} />
            <span>{isAr ? 'المنتجات' : 'Products'}</span>
          </Link>
          <Link href="/services" className={itemClass(onPage('/services'))}>
            <Wrench size={22} />
            <span>{t.services || (isAr ? 'الخدمات' : 'Services')}</span>
          </Link>
          <button type="button" onClick={() => setPanel(panel === 'more' ? null : 'more')} className={itemClass(panel === 'more')}>
            <Menu size={22} />
            <span>{isAr ? 'المزيد' : 'More'}</span>
          </button>
        </div>
      </nav>

      {panel === 'more' && <MorePage onClose={close} openCategory={openCategory} />}
    </>
  );
}
