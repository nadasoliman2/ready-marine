'use client';

import { useRef, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from './LocaleLink';
import { useApp } from '../context/AppContext';
import { resolveAssetUrl } from '../lib/assets';

export default function BrandsSlider() {
  const { language, t } = useApp();
  const trackRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBrands = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/products/filters`);
        if (res.ok) {
          const data = await res.json();
          const allBrands = data.carBrands || [];
          let featured = allBrands.filter(b => b.is_featured);
          if (featured.length === 0 && allBrands.length > 0) {
            featured = allBrands.slice(0, 15);
          }
          setBrands(featured);
        }
      } catch (err) {
        console.error('Failed to fetch brands:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchBrands();
  }, []);

  const VISIBLE = 5;
  const max = Math.max(0, brands.length - VISIBLE);

  const isRTL = language === 'ar';

  const scroll = (dir) => {
    setActiveIndex(prev => {
      if (isRTL) {
        if (dir === 'left') return Math.min(prev + 1, max);
        return Math.max(prev - 1, 0);
      } else {
        if (dir === 'right') return Math.min(prev + 1, max);
        return Math.max(prev - 1, 0);
      }
    });
  };

  useEffect(() => {
    if (isPaused || max === 0) return;
    const interval = setInterval(() => {
      setActiveIndex(prev => (prev >= max ? 0 : prev + 1));
    }, 2500);
    return () => clearInterval(interval);
  }, [isPaused, max]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || brands.length === 0) return;
    const itemWidth = track.scrollWidth / brands.length;
    const scrollTarget = isRTL ? -activeIndex * itemWidth : activeIndex * itemWidth;
    track.scrollTo({ left: scrollTarget, behavior: 'smooth' });
  }, [activeIndex, brands.length, isRTL]);

  if (loading || brands.length === 0) return null;

  return (
    <section className="py-16 bg-zinc-50">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-end justify-between mb-10">
          <div>
            <p className="text-marine-primary text-sm font-semibold uppercase tracking-widest mb-1">Brands</p>
            <h2 className="text-3xl sm:text-4xl font-black text-[#09090b]">{t.carBrands || 'Shop by Car Brand'}</h2>
          </div>
          <div className="flex items-center gap-4">
            <Link 
              href="/brands" 
              className="text-sm font-bold text-zinc-500 hover:text-marine-primary transition-colors"
            >
              {language === 'ar' ? 'عرض كل الماركات' : 'View All Brands'}
            </Link>
            <div className="flex items-center gap-2">
              <button
                onClick={() => scroll('left')}
                disabled={isRTL ? activeIndex >= max : activeIndex === 0}
                className="w-10 h-10 rounded-full border-2 border-zinc-200 flex items-center justify-center text-zinc-500 hover:border-marine-cyan hover:text-marine-primary disabled:opacity-30 transition-all"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={() => scroll('right')}
                disabled={isRTL ? activeIndex === 0 : activeIndex >= max}
                className="w-10 h-10 rounded-full border-2 border-zinc-200 flex items-center justify-center text-zinc-500 hover:border-marine-cyan hover:text-marine-primary disabled:opacity-30 transition-all"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </div>

        <div
          ref={trackRef}
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
          className="flex gap-5 overflow-x-hidden"
          style={{ scrollbarWidth: 'none' }}
        >
          {brands.map(brand => (
            <Link
              key={brand._id}
              href={`/products?car_brand_id=${brand._id}`}
              className="group flex-none w-44 sm:w-48"
            >
              <div className="bg-white rounded-2xl border border-zinc-100 hover:border-marine-cyan/40 shadow-sm hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:-translate-y-1 transition-all duration-400 overflow-hidden p-4 flex flex-col items-center gap-3">
                <div className="w-full aspect-video rounded-xl overflow-hidden bg-zinc-100 flex items-center justify-center">
                  {brand.image ? (
                    <img
                      src={resolveAssetUrl(brand.image)}
                      alt={brand.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <span className="text-zinc-400 font-bold uppercase tracking-wider">{brand.name.substring(0, 3)}</span>
                  )}
                </div>
                <span className="text-[#09090b] font-bold text-sm group-hover:text-marine-primary transition-colors">
                  {brand.name}
                </span>
              </div>
            </Link>
          ))}
        </div>

        {max > 0 && (
          <div className="flex justify-center gap-1.5 mt-6">
            {Array.from({ length: max + 1 }).map((_, i) => (
              <button
                key={i}
                onClick={() => setActiveIndex(i)}
                className={`transition-all duration-300 rounded-full ${i === activeIndex ? 'w-6 h-2 bg-marine-cyan' : 'w-2 h-2 bg-zinc-300 hover:bg-zinc-400'}`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
