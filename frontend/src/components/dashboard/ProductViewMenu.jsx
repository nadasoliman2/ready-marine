'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Eye, ExternalLink, FileSearch } from 'lucide-react';
import Link from '../LocaleLink';
import { createPortal } from 'react-dom';

export default function ProductViewMenu({ product, reviewHref, language = 'en', compact = false }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const isAr = language === 'ar';
  const slug = isAr ? (product.slug_ar || product.slug_en) : (product.slug_en || product.slug_ar);
  const canViewLive = product.status === 'published' && Boolean(slug);

  useEffect(() => {
    if (!open) return;

    const placeMenu = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuWidth = 256;
      setPosition({
        top: rect.bottom + 8,
        left: Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.right - menuWidth)),
      });
    };
    const closeOnOutsideClick = event => {
      if (!buttonRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    placeMenu();
    document.addEventListener('mousedown', closeOnOutsideClick);
    window.addEventListener('resize', placeMenu);
    window.addEventListener('scroll', placeMenu, true);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      window.removeEventListener('resize', placeMenu);
      window.removeEventListener('scroll', placeMenu, true);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(value => !value)}
        className={compact
          ? 'inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold text-zinc-500 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-500/10'
          : 'inline-flex items-center gap-1 rounded-xl p-2 text-zinc-400 transition-colors hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-500/10'}
        title={isAr ? 'خيارات عرض المنتج' : 'Product view options'}
        aria-label={isAr ? 'خيارات عرض المنتج' : 'Product view options'}
        aria-expanded={open}
      >
        <Eye size={compact ? 14 : 16} />
        {compact && (isAr ? 'عرض المنتج' : 'View product')}
        <ChevronDown size={compact ? 12 : 11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          style={{ top: position.top, left: position.left }}
          className="fixed z-[200] w-64 overflow-hidden rounded-xl border border-zinc-200 bg-white p-1.5 text-start shadow-xl dark:border-white/10 dark:bg-[#1A1D20]"
          dir={isAr ? 'rtl' : 'ltr'}
        >
          <Link
            href={reviewHref}
            className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-zinc-100 dark:hover:bg-white/5"
          >
            <FileSearch size={17} className="mt-0.5 shrink-0 text-marine-primary" />
            <span>
              <span className="block text-xs font-black text-zinc-900 dark:text-white">
                {isAr ? 'مراجعة تفاصيل المنتج' : 'Review product details'}
              </span>
              <span className="mt-0.5 block text-[10px] font-medium leading-4 text-zinc-500">
                {isAr ? 'عرض داخلي يعمل للمسودات والمنتجات المعلقة.' : 'Internal view for drafts and pending products.'}
              </span>
            </span>
          </Link>

          {canViewLive ? (
            <Link
              href={`/product/${slug}`}
              target="_blank"
              className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-zinc-100 dark:hover:bg-white/5"
            >
              <ExternalLink size={17} className="mt-0.5 shrink-0 text-blue-500" />
              <span>
                <span className="block text-xs font-black text-zinc-900 dark:text-white">
                  {isAr ? 'عرض صفحة المتجر المباشرة' : 'View live storefront'}
                </span>
                <span className="mt-0.5 block text-[10px] font-medium leading-4 text-zinc-500">
                  {isAr ? 'افتح الصفحة التي يراها العملاء.' : 'Open the page customers currently see.'}
                </span>
              </span>
            </Link>
          ) : (
            <div
              className="flex cursor-not-allowed items-start gap-3 rounded-lg px-3 py-2.5 opacity-45"
              title={isAr ? 'يتوفر بعد نشر المنتج' : 'Available after the product is published'}
            >
              <ExternalLink size={17} className="mt-0.5 shrink-0 text-zinc-400" />
              <span>
                <span className="block text-xs font-black text-zinc-700 dark:text-zinc-300">
                  {isAr ? 'عرض صفحة المتجر المباشرة' : 'View live storefront'}
                </span>
                <span className="mt-0.5 block text-[10px] font-medium leading-4 text-zinc-500">
                  {isAr ? 'غير متاح حتى يتم نشر المنتج.' : 'Available after this product is published.'}
                </span>
              </span>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
