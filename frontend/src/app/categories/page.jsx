'use client';

import { useState, useMemo } from 'react';
import { LayoutGrid, Search, ChevronRight, ArrowRight, Package, FolderTree } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import Link from '../../components/LocaleLink';
import { resolveAssetUrl } from '../../lib/assets';

export default function CategoriesPage() {
  const { language, categories, t } = useApp();
  const isAr = language === 'ar';
  const [search, setSearch] = useState('');

  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories || [];
    return (categories || []).filter((cat) => {
      const name = String(cat.name || '').toLowerCase();
      const nameAr = String(cat.name_ar || '').toLowerCase();
      const subs = (cat.subcategories || []).some((sub) =>
        String(sub.name || '').toLowerCase().includes(q) ||
        String(sub.name_ar || '').toLowerCase().includes(q)
      );
      return name.includes(q) || nameAr.includes(q) || subs;
    });
  }, [categories, search]);

  return (
    <div className="bg-marine-canvas min-h-screen py-6 sm:py-10" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-4">
          <ol className="flex items-center gap-2 text-xs text-marine-outline">
            <li>
              <Link href="/" className="hover:text-marine-primary transition-colors">
                {t.home || (isAr ? 'الرئيسية' : 'Home')}
              </Link>
            </li>
            <li className="select-none text-slate-300">/</li>
            <li className="font-bold text-marine-ink">
              {t.categories || (isAr ? 'الفئات' : 'Categories')}
            </li>
          </ol>
        </nav>

        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 text-marine-primary font-bold text-xs uppercase tracking-wider mb-1">
              <FolderTree size={16} />
              <span>{isAr ? 'تصفح الكتالوج' : 'Browse Catalog'}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-marine-ink font-display">
              {isAr ? 'فئات وأقسام المتجر' : 'Product Categories'}
            </h1>
            <p className="text-sm text-marine-muted mt-1 max-w-xl">
              {isAr
                ? 'استعرض جميع أقسام قطع الغيار والمعدات البحرية ومستلزمات اليخوت والقوارب.'
                : 'Browse all categories of marine spare parts, equipment, boat and yacht supplies.'}
            </p>
          </div>

          {/* Search Categories */}
          <div className="relative w-full md:w-72">
            <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-marine-outline" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isAr ? 'ابحث في الفئات والأقسام…' : 'Search categories…'}
              className="w-full bg-white border border-marine-teal/20 rounded-xl ps-9 pe-4 py-2.5 text-sm text-marine-ink placeholder-slate-400 outline-none focus:border-marine-cyan focus:ring-2 focus:ring-marine-cyan/15 transition-all shadow-xs"
            />
          </div>
        </div>

        {/* Categories Grid */}
        {filteredCategories.length === 0 ? (
          <div className="bg-white border border-marine-teal/15 rounded-2xl p-12 text-center max-w-md mx-auto shadow-xs my-8">
            <div className="w-16 h-16 rounded-2xl bg-marine-mist text-marine-primary flex items-center justify-center mx-auto mb-4">
              <Package size={28} />
            </div>
            <h3 className="font-display text-lg font-bold text-marine-ink mb-1">
              {isAr ? 'لا توجد فئات مطابقة' : 'No categories found'}
            </h3>
            <p className="text-xs text-marine-outline">
              {isAr ? 'جرّب كتابة اسم فئة أخرى في مربع البحث.' : 'Try searching with a different term.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
            {filteredCategories.map((cat) => {
              const displayName = isAr ? (cat.name_ar || cat.name) : (cat.name || cat.name_ar);
              const subs = cat.subcategories || [];
              const imageUrl = cat.image ? resolveAssetUrl(cat.image) : null;

              return (
                <div
                  key={cat._id}
                  className="group bg-white border border-marine-teal/15 hover:border-marine-cyan rounded-2xl p-5 flex flex-col justify-between shadow-xs hover:shadow-md transition-all duration-200"
                >
                  <div>
                    {/* Header: Image/Icon + Name */}
                    <div className="flex items-center gap-3.5 mb-4">
                      {imageUrl ? (
                        <div className="w-14 h-14 rounded-xl bg-marine-mist/60 border border-marine-teal/10 overflow-hidden shrink-0 flex items-center justify-center p-1">
                          <img
                            src={imageUrl}
                            alt={displayName}
                            className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-200"
                          />
                        </div>
                      ) : (
                        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-marine-primary/10 to-marine-cyan/20 border border-marine-teal/15 text-marine-primary flex items-center justify-center shrink-0 shadow-2xs group-hover:scale-105 transition-transform duration-200">
                          <LayoutGrid size={24} />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/products?category_id=${cat._id}`}
                          className="font-display font-bold text-base text-marine-ink group-hover:text-marine-primary transition-colors block truncate"
                        >
                          {displayName}
                        </Link>
                      </div>
                    </div>

                    {/* Subcategories list */}
                    {subs.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-4 pt-2.5 border-t border-slate-100">
                        {subs.map((sub) => {
                          const subName = isAr ? (sub.name_ar || sub.name) : (sub.name || sub.name_ar);
                          return (
                            <Link
                              key={sub._id}
                              href={`/products?category_id=${sub._id}`}
                              className="text-[11px] font-medium text-slate-700 bg-slate-50 hover:bg-marine-mist hover:text-marine-primary hover:border-marine-cyan/30 border border-slate-200/80 px-2.5 py-1 rounded-lg transition-colors"
                            >
                              {subName}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Bottom Action Link */}
                  <div className="pt-3 border-t border-slate-100 mt-2">
                    <Link
                      href={`/products?category_id=${cat._id}`}
                      className="flex items-center justify-between text-xs font-bold text-marine-primary group-hover:text-cyan-600 transition-colors"
                    >
                      <span>{isAr ? 'عرض منتجات القسم' : 'View Products'}</span>
                      <ArrowRight size={14} className="rtl:rotate-180 group-hover:translate-x-1 rtl:group-hover:-translate-x-1 transition-transform" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}
