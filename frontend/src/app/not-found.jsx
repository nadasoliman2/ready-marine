'use client';

import { useState } from 'react';
import { useRouter } from '../lib/navigation';
import Link from '../components/LocaleLink';
import { useApp } from '../context/AppContext';
import {
  Compass, Anchor, Home, Search, ArrowRight, ArrowLeft,
  LifeBuoy, Ship, Sparkles, Navigation, Layers
} from 'lucide-react';
import BrandMark from '../components/marine/BrandMark';

export default function NotFound() {
  const router = useRouter();
  const { language } = useApp();
  const isAr = language === 'ar';
  const [searchQuery, setSearchQuery] = useState('');

  const handleSearch = (e) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (q) {
      router.push(`/products?search=${encodeURIComponent(q)}`);
    } else {
      router.push('/products');
    }
  };

  const popularHubs = [
    { ar: 'مستلزمات اليخوت الفاخرة', en: 'Yacht Luxury', slug: 'yacht-luxury' },
    { ar: 'قسم الصياد المحترف', en: 'Pro-Angler', slug: 'pro-angler' },
    { ar: 'صيانتك بنفسك', en: 'DIY Maintenance', slug: 'diy-maintenance' },
    { ar: 'الرحلات والرفاهية', en: 'Lifestyle & Comfort', slug: 'lifestyle-comfort' },
  ];

  return (
    <div
      className="min-h-[80vh] flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-marine-canvas via-white to-marine-mist/30 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950 transition-colors"
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <div className="max-w-3xl w-full text-center space-y-8 animate-in fade-in duration-500">
        
        {/* Visual Nautical Anchor & Compass Graphic */}
        <div className="relative inline-flex items-center justify-center">
          {/* Radial animated glow */}
          <div className="absolute w-44 h-44 rounded-full bg-marine-cyan/15 dark:bg-marine-cyan/10 blur-2xl animate-pulse" />
          
          <div className="relative flex items-center justify-center w-28 h-28 sm:w-32 sm:h-32 rounded-3xl bg-gradient-to-br from-marine-ink to-marine-navy dark:from-gray-800 dark:to-gray-900 border border-marine-teal/20 dark:border-white/10 shadow-xl shadow-marine-navy/15">
            <Compass className="w-14 h-14 sm:w-16 sm:h-16 text-marine-cyan animate-[spin_20s_linear_infinite]" strokeWidth={1.5} />
            <div className="absolute inset-0 flex items-center justify-center">
              <Anchor className="w-7 h-7 sm:w-8 sm:h-8 text-white drop-shadow-md" />
            </div>
          </div>

          <span className="absolute -top-2 -end-2 flex h-6 w-6">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-marine-cyan opacity-75"></span>
            <span className="relative inline-flex rounded-full h-6 w-6 bg-marine-primary items-center justify-center text-[10px] font-black text-white">
              !
            </span>
          </span>
        </div>

        {/* 404 Numbers with Marine Gradient */}
        <div>
          <div className="text-7xl sm:text-8xl md:text-9xl font-black font-display tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-marine-primary via-marine-cyan to-teal-400 select-none">
            404
          </div>
          <h1 className="mt-2 text-2xl sm:text-3xl md:text-4xl font-extrabold text-marine-ink dark:text-white tracking-tight">
            {isAr ? 'ضللت طريقك في عُرض البحر؟' : 'Lost in Open Waters?'}
          </h1>
          <p className="mt-3 text-sm sm:text-base text-gray-600 dark:text-gray-300 max-w-xl mx-auto leading-relaxed">
            {isAr
              ? 'يبدو أن الإحداثيات التي تبحث عنها غير موجودة على الخريطة الملاحية، أو أن الصفحة قد غادرت المرسى إلى وجهة أخرى.'
              : 'The coordinates you navigated to do not exist on our nautical chart, or this page has drifted away to another marina.'}
          </p>
        </div>

        {/* Search Bar on 404 */}
        <div className="max-w-md mx-auto">
          <form onSubmit={handleSearch} className="relative flex items-center">
            <Search className="w-5 h-5 text-gray-400 absolute start-4 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isAr ? 'ابحث عن قطع غيار، ماركة، أو كود القطعة...' : 'Search for parts, brands, or SKUs...'}
              className="w-full ps-11 pe-24 py-3.5 bg-white dark:bg-gray-800/90 border border-gray-200 dark:border-gray-700 rounded-2xl text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-marine-cyan dark:text-white transition-all placeholder:text-gray-400"
            />
            <button
              type="submit"
              className="absolute end-2 px-4 py-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white text-xs font-bold rounded-xl transition-colors shadow-xs"
            >
              {isAr ? 'بحث' : 'Search'}
            </button>
          </form>
        </div>

        {/* Quick Navigation Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4 pt-2">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-marine-primary hover:bg-marine-primary/95 text-white font-bold text-sm shadow-md shadow-marine-primary/20 transition-all hover:scale-[1.02]"
          >
            <Home size={16} />
            <span>{isAr ? 'العودة للمرسى (الرئيسية)' : 'Return to Port (Home)'}</span>
          </Link>

          <Link
            href="/products"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700/80 text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700 font-bold text-sm shadow-xs transition-all hover:scale-[1.02]"
          >
            <Ship size={16} className="text-marine-cyan" />
            <span>{isAr ? 'تصفح كل المنتجات' : 'Browse All Parts'}</span>
          </Link>

          <Link
            href="/contact"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-800/60 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 font-semibold text-sm transition-colors"
          >
            <LifeBuoy size={16} />
            <span>{isAr ? 'المساعدة والدعم' : 'Get Help'}</span>
          </Link>
        </div>

        {/* Popular Hubs / Collections Quick Links */}
        <div className="pt-6 border-t border-gray-200/60 dark:border-gray-800/80">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            {isAr ? 'أو تصفح أشهر المجموعات البحرية:' : 'Or explore popular marine hubs:'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {popularHubs.map((hub) => (
              <Link
                key={hub.slug}
                href={`/hub/${hub.slug}`}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-marine-mist/60 dark:bg-gray-800/80 text-marine-ink dark:text-gray-200 hover:bg-marine-cyan hover:text-white transition-colors"
              >
                <Sparkles size={12} className="text-marine-primary" />
                <span>{isAr ? hub.ar : hub.en}</span>
              </Link>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
