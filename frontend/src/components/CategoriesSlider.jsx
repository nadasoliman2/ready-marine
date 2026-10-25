'use client';

import { useRef, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, ArrowRight, Briefcase, Sparkles } from 'lucide-react';
import Link from './LocaleLink';
import { useApp } from '../context/AppContext';
import { resolveAssetUrl } from '../lib/assets';

export default function CategoriesSlider() {
  const { language, t, categories } = useApp();
  const trackRef = useRef(null);
  const isRTL = language === 'ar';
  const [canScrollLeft, setCanScrollLeft] = useState(isRTL);
  const [canScrollRight, setCanScrollRight] = useState(!isRTL);

  const scroll = (dir) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: dir === 'left' ? -320 : 320, behavior: 'smooth' });
  };

  const handleScroll = () => {
    const track = trackRef.current;
    if (!track) return;

    const scrollLeft = track.scrollLeft;
    const maxScroll = track.scrollWidth - track.clientWidth;

    if (isRTL) {
      setCanScrollRight(scrollLeft < -10);
      setCanScrollLeft(scrollLeft > -maxScroll + 10);
    } else {
      setCanScrollLeft(scrollLeft > 10);
      setCanScrollRight(scrollLeft < maxScroll - 10);
    }
  };

  useEffect(() => {
    handleScroll();
    const timer = setTimeout(handleScroll, 100);
    return () => clearTimeout(timer);
  }, [categories]);

  if (categories.length === 0) return null;

  const isAr = language === 'ar';
  const nameOf = (cat) => (isAr && (cat.name_ar || cat.name)) || cat.name;

  return (
    <>
    {/* ── A phone: the app design — small square tiles in a row, the name under each, and the
        two collections (Car Trunk, Girls) as cards. The slider below is the wide screens'. ── */}
    <section className="sm:hidden bg-white pt-5 pb-6">
      <div className="px-4 flex items-center justify-between mb-3">
        <h2 className="text-xl font-black text-[#09090b]">{t.shopByCategory || (isAr ? 'تسوق حسب الفئة' : 'Shop by Category')}</h2>
        <Link href="/products" className="flex items-center gap-1 text-xs font-bold text-marine-primary">
          {t.viewAll || (isAr ? 'عرض الكل' : 'View all')}
          <ArrowRight size={14} className="rtl:rotate-180" />
        </Link>
      </div>
      <div className="flex gap-3 overflow-x-auto scrollbar-hide px-4 snap-x snap-mandatory scroll-px-4">
        {categories.map(cat => (
          <Link key={cat._id} href={`/products?category_id=${cat._id}`} className="flex-none w-[78px] snap-start text-center">
            <span className="block w-[78px] h-[78px] rounded-2xl overflow-hidden bg-zinc-100 shadow-sm">
              {cat.image
                ? <img src={resolveAssetUrl(cat.image)} alt="" loading="lazy" className="w-full h-full object-cover" />
                : <span className="w-full h-full flex items-center justify-center text-lg font-black text-zinc-400">{nameOf(cat).charAt(0)}</span>}
            </span>
            <span className="mt-1.5 block text-[11px] font-bold leading-tight text-zinc-800 line-clamp-2">{nameOf(cat)}</span>
          </Link>
        ))}
      </div>

      <div className="px-4 mt-6 grid grid-cols-2 gap-3">
        <Link href="/trunk" className="relative h-36 rounded-2xl overflow-hidden bg-zinc-900 shadow-sm">
          <img src="/images/trunk/road-ready-hero.jpg" alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
          <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
          <span className="absolute bottom-0 inset-x-0 p-3 text-white">
            <span className="block text-[10px] font-bold text-white/70">{isAr ? 'جاهز للطريق' : 'Road ready'}</span>
            <span className="block text-base font-black leading-tight">{t.trunkProducts || (isAr ? 'مستلزمات على المركب' : 'Onboard Essentials')}</span>
            <span className="block text-[10px] text-white/70 mt-0.5">{isAr ? 'كل الأساسيات' : 'All the essentials'}</span>
          </span>
          <Briefcase size={18} className="absolute top-3 end-3 text-white/80" />
        </Link>
        <Link href="/girls" className="relative h-36 rounded-2xl overflow-hidden bg-gradient-to-br from-fuchsia-900 via-purple-800 to-pink-700 shadow-sm">
          <span className="absolute -top-6 -start-6 w-24 h-24 rounded-full bg-pink-400/30 blur-2xl" />
          <span className="absolute bottom-0 inset-x-0 p-3 text-white">
            <span className="block text-[10px] font-bold text-white/70">{isAr ? 'مختارة ليكي' : 'Picked for you'}</span>
            <span className="block text-base font-black leading-tight">{t.girlsProducts || (isAr ? 'منتجات البنات' : 'Girls Products')}</span>
            <span className="block text-[10px] text-white/70 mt-0.5">{isAr ? 'اكتشفي المجموعة' : 'Explore the collection'}</span>
          </span>
          <Sparkles size={18} className="absolute top-3 end-3 text-white/80" />
        </Link>
      </div>
    </section>

    <section className="hidden sm:block py-16 bg-zinc-50">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-end justify-between mb-10">
          <div>
            <p className="text-marine-primary text-sm font-semibold uppercase tracking-widest mb-1">Browse</p>
            <h2 className="text-3xl sm:text-4xl font-black text-[#09090b]">{t.shopByCategory || 'Shop by Category'}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => scroll('left')}
              disabled={!canScrollLeft}
              className="w-10 h-10 rounded-full border-2 border-zinc-200 flex items-center justify-center text-zinc-500 hover:border-marine-cyan hover:text-marine-primary disabled:opacity-30 transition-all"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={() => scroll('right')}
              disabled={!canScrollRight}
              className="w-10 h-10 rounded-full border-2 border-zinc-200 flex items-center justify-center text-zinc-500 hover:border-marine-cyan hover:text-marine-primary disabled:opacity-30 transition-all"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        <div
          ref={trackRef}
          onScroll={handleScroll}
          className="flex gap-5 overflow-x-auto scrollbar-hide pb-2 snap-x snap-mandatory"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {categories.map(cat => (
            <Link
              key={cat._id}
              href={`/products?category_id=${cat._id}`}
              className="group flex-none snap-start w-56"
            >
              <div className="relative overflow-hidden rounded-2xl aspect-[4/3] bg-zinc-200 mb-3 shadow-md group-hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)] group-hover:-translate-y-1 transition-all duration-400 flex items-center justify-center">
                {cat.image ? (
                  <img
                    src={resolveAssetUrl(cat.image)}
                    alt={cat.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-zinc-300 to-zinc-400 flex items-center justify-center text-zinc-500 font-bold group-hover:scale-105 transition-transform duration-500">
                    {(language === 'ar' && (cat.name_ar || cat.name)) || cat.name}
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[#09090b]/80 via-[#09090b]/20 to-transparent" />
                <div className="absolute bottom-0 inset-x-0 p-4">
                  <h3 className="text-white font-bold text-lg leading-tight drop-shadow-md">
                    {(language === 'ar' && (cat.name_ar || cat.name)) || cat.name}
                  </h3>
                  {cat.subcategories && cat.subcategories.length > 0 && (
                    <p className="text-zinc-300 text-xs mt-0.5">
                      {cat.subcategories.length} subcategories
                    </p>
                  )}
                </div>
                <div className="absolute top-3 end-3 w-8 h-8 rounded-full bg-marine-cyan flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-2 group-hover:translate-x-0">
                  <ArrowRight size={14} className="text-white rtl:rotate-180" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
    </>
  );
}
