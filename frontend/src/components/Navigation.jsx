'use client';

import { useState, useRef } from 'react';
import { ChevronDown, ChevronRight, Menu, X } from 'lucide-react';
import Link from './LocaleLink';
import { usePathname, useRouter } from '../lib/navigation';
import { useApp } from '../context/AppContext';
import { publishCategoryFilter } from '../lib/categoryFilterEvents';
import { productPageQuery, warmProductList } from '../lib/productListPreload';

function DesktopSubMenu({ categories, level = 0, onNavigate, onPreview }) {
  const { language } = useApp();
  const [activeId, setActiveId] = useState(null);

  if (!Array.isArray(categories)) return null;

  return (
    <div className={`${level === 0 ? 'absolute top-full start-0 bg-white shadow-2xl rounded-b-xl min-w-[220px] py-2 border-t-2 border-marine-cyan' : 'absolute top-0 start-full bg-white shadow-2xl rounded-xl min-w-[200px] py-2 border border-marine-teal/15'} z-50`}>
      {categories.map(cat => (
        <div
          key={cat._id}
          className="relative group/item"
          onMouseEnter={() => {
            setActiveId(cat._id);
            onPreview(cat._id);
          }}
          onMouseLeave={() => setActiveId(null)}
        >
          <Link
            href={`/products?category_id=${cat._id}`}
            onClick={(event) => onNavigate(cat._id, event)}
            onPointerDown={() => onPreview(cat._id)}
            onFocus={() => onPreview(cat._id)}
            className="flex items-center justify-between px-4 py-2.5 text-marine-ink hover:text-marine-primary hover:bg-marine-mist transition-colors text-sm font-medium group/link"
          >
            <span>{language === 'ar' ? (cat.name_ar || cat.name) : cat.name}</span>
            {cat.subcategories && cat.subcategories.length > 0 && (
              <ChevronRight size={14} className="text-zinc-400 group-hover/link:text-marine-primary rtl:rotate-180" />
            )}
          </Link>
          {cat.subcategories && cat.subcategories.length > 0 && activeId === cat._id && (
            <DesktopSubMenu categories={cat.subcategories} level={level + 1} onNavigate={onNavigate} onPreview={onPreview} />
          )}
        </div>
      ))}
    </div>
  );
}

/** `light`: on a white page (the phone's "More"); dark otherwise. */
export function MobileCategoryItem({ cat, level = 0, onNavigate, light = false }) {
  const { language } = useApp();
  const [isOpen, setIsOpen] = useState(false);
  const hasSub = cat.subcategories && cat.subcategories.length > 0;

  return (
    <div className="w-full">
      <div className={`flex items-center justify-between border-b ${light ? 'border-zinc-100' : 'border-white/5'}`}>
        <Link
          href={`/products?category_id=${cat._id}`}
          onClick={(event) => onNavigate(cat._id, event)}
          onPointerDown={() => warmProductList(productPageQuery(`category_id=${cat._id}`))}
          className={`flex-1 py-4 text-sm font-bold transition-colors ${light ? 'text-marine-ink hover:text-marine-primary' : 'text-white/90 hover:text-white'}`}
          style={{ paddingInlineStart: `${level * 1.5 + 1}rem` }}
        >
          {language === 'ar' ? (cat.name_ar || cat.name) : cat.name}
        </Link>
        {hasSub && (
          <button 
            onClick={() => setIsOpen(!isOpen)}
            className={`p-4 transition-all transform ${light ? 'text-zinc-400 hover:text-zinc-900' : 'text-white/60 hover:text-white'}`}
          >
            <ChevronDown size={18} className={`transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
      {hasSub && isOpen && (
        <div className={`overflow-hidden animate-in slide-in-from-top duration-300 ${light ? 'bg-zinc-50' : 'bg-black/10'}`}>
          {cat.subcategories.map(sub => (
            <MobileCategoryItem key={sub._id} cat={sub} level={level + 1} onNavigate={onNavigate} light={light} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The site's pages, in menu order: the red bar on a wide screen, the "More" sheet on a phone. */
export function useNavItems() {
  const { language, t } = useApp();
  return [
    { label: t.home, href: '/' },
    { label: t.allProducts, href: '/products' },
    { label: t.trunkProducts || (language === 'ar' ? 'مستلزمات على المركب' : 'Onboard Essentials'), href: '/trunk' },
    { label: t.services || (language === 'ar' ? 'الخدمات' : 'Services'), href: '/services' },
    { label: language === 'ar' ? 'التجار' : 'Vendors', href: '/vendors' },
    { label: t.deliveryReturn, href: '/delivery' },
    { label: t.articles || (language === 'ar' ? 'المقالات' : 'Articles'), href: '/articles' },
    { label: t.contactUs, href: '/contact' },
  ];
}

/**
 * Opening a category from a menu: the shop is told at once, its first page warmed, and `done`
 * closes the menu. On the shop itself the event is the whole change — the shop adds the
 * category to the filters it has (a search included) and writes the URL; navigating to the
 * bare category link as well raced that write and could drop the search.
 */
export function useCategoryNavigate(done) {
  const pathname = usePathname();
  return (categoryId, event) => {
    publishCategoryFilter(categoryId);
    warmProductList(productPageQuery(`category_id=${categoryId}`));
    done?.();
    if (pathname === '/products') event?.preventDefault();
  };
}

export default function Navigation() {
  const { t, categories } = useApp();
  const pathname = usePathname();
  const router = useRouter();
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const closeTimer = useRef(null);

  const handleMouseEnter = () => {
    if (window.innerWidth >= 768) {
      clearTimeout(closeTimer.current);
      setCategoriesOpen(true);
      router.prefetch('/products');
    }
  };

  const handleMouseLeave = () => {
    if (window.innerWidth >= 768) {
      closeTimer.current = setTimeout(() => setCategoriesOpen(false), 150);
    }
  };

  const toggleMobileMenu = () => {
    router.prefetch('/products');
    setMobileMenuOpen(prev => !prev);
  };

  const prefetchCategory = (categoryId) => {
    router.prefetch(`/products?category_id=${categoryId}`);
    warmProductList(productPageQuery(`category_id=${categoryId}`));
  };

  const handleCategoryNavigate = useCategoryNavigate(() => {
    setCategoriesOpen(false);
    setMobileMenuOpen(false);
  });
  const navItems = useNavItems();

  if (pathname.startsWith('/dashboard')) return null;

  return (
    // From a tablet up. On a phone the bottom bar (MobileBottomNav) carries the same links
    // and categories, so this strip would only repeat them under the search box.
    <nav className="hidden md:block bg-marine-canvas border-b border-marine-teal/10 relative z-40">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center h-11 font-display text-[11px] font-semibold uppercase tracking-[0.08em]">
          {/* Categories Dropdown (Desktop) */}
          <div
            className="relative h-full flex-shrink-0 hidden md:block"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <button 
              className="flex items-center gap-2 h-8 my-1.5 px-4 rounded bg-marine-teal text-white hover:bg-marine-navy transition-colors"
              onClick={() => setCategoriesOpen(!categoriesOpen)}
            >
              <Menu size={18} />
              <span>{t.categories}</span>
              <ChevronDown size={14} className={`transition-transform duration-200 ${categoriesOpen ? 'rotate-180' : ''}`} />
            </button>
            {categoriesOpen && categories.length > 0 && <DesktopSubMenu categories={categories} level={0} onNavigate={handleCategoryNavigate} onPreview={prefetchCategory} />}
          </div>

          {/* Mobile Menu Toggle */}
          <button 
            onClick={toggleMobileMenu}
            className="md:hidden flex items-center gap-2 h-full px-4 text-marine-ink hover:text-marine-primary transition-colors"
          >
            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
            <span>{t.categories}</span>
          </button>

          <div className="h-5 w-px bg-marine-teal/15 mx-2 flex-shrink-0" />

          {/* Scrollable Nav Items */}
          <div className="flex-1 relative h-full overflow-hidden">
            <div className="flex items-center overflow-x-auto scrollbar-hide h-full">
              <div className="flex items-center">
                {navItems.map(item => {
                  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={`flex items-center h-8 px-3 rounded transition-colors whitespace-nowrap ${active ? 'bg-marine-cyan text-white' : 'text-marine-muted hover:text-marine-primary hover:bg-marine-mist'}`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Sidebar Categories */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-marine-navy border-t border-white/10 max-h-[70vh] overflow-y-auto w-full animate-in slide-in-from-top duration-300 shadow-2xl">
          <div className="flex flex-col">
            {categories.length > 0 ? (
              categories.map(cat => (
                <MobileCategoryItem key={cat._id} cat={cat} onNavigate={handleCategoryNavigate} />
              ))
            ) : (
              <div className="p-8 text-center text-zinc-500 italic text-sm">
                No categories found. Please restart backend.
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
