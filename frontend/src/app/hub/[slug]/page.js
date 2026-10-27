'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from '../../../lib/navigation';
import { useApp } from '../../../context/AppContext';
import FilterSidebar from '../../../components/products/FilterSidebar';
import InfiniteProductGrid from '../../../components/products/InfiniteProductGrid';
import useInfiniteProducts from '../../../lib/useInfiniteProducts';
import { filtersToQuery } from '../../../lib/productListPreload';
import Link from '../../../components/LocaleLink';
import { Search, ChevronRight, SlidersHorizontal, ArrowUpRight, CheckCircle2 } from 'lucide-react';
import { MobileListingTop, MobileListingTools } from '../../../components/products/MobileListingHeader';
import { getHubBySlug, MARINE_HUBS } from '../../../lib/marineHubs';

function HubDetailContent({ slug }) {
  const hub = getHubBySlug(slug);
  const searchParams = useSearchParams();
  const router = useRouter();
  const { language, t, isMounted } = useApp();
  const isAr = language === 'ar';

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [metadata, setMetadata] = useState({ categories: [], carBrands: [], productBrands: [] });
  const [loadingMetadata, setLoadingMetadata] = useState(true);

  const [filters, setFilters] = useState({
    page: searchParams.get('page') || 1,
    search: searchParams.get('search') || '',
    category_id: searchParams.get('category_id') || '',
    type_id: searchParams.get('type_id') || '',
    product_brand_id: searchParams.get('product_brand_id') || '',
    car_brand_id: searchParams.get('car_brand_id') || '',
    car_model_id: searchParams.get('car_model_id') || '',
    car_year: searchParams.get('car_year') || '',
    min_price: searchParams.get('min_price') || '',
    max_price: searchParams.get('max_price') || '',
    sort: searchParams.get('sort') || '',
  });

  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/products/filters`);
        if (res.ok) setMetadata(await res.json());
      } catch (err) {
        console.error('Failed to fetch filters:', err);
      } finally {
        setLoadingMetadata(false);
      }
    };
    fetchMetadata();
  }, []);

  useEffect(() => {
    const query = filtersToQuery(filters, { withPage: true });
    router.replace(`/hub/${slug}${query ? `?${query}` : ''}`, { scroll: false });
  }, [filters, router, slug]);

  const filtersQuery = useMemo(() => {
    return [filtersToQuery(filters), `audience=${hub.audienceKey}`].filter(Boolean).join('&');
  }, [filters, hub.audienceKey]);

  const list = useInfiniteProducts(filtersQuery, Math.max(1, Number(filters.page) || 1));
  const products = list.products;

  if (!isMounted) return null;

  const Icon = hub.icon;
  const title = isAr ? hub.titleAr : hub.titleEn;
  const badge = isAr ? hub.badgeAr : hub.badgeEn;
  const target = isAr ? hub.targetAr : hub.targetEn;
  const desc = isAr ? hub.descriptionAr : hub.descriptionEn;
  const checklist = isAr ? hub.checklistAr : hub.checklistEn;

  return (
    <div className="bg-slate-50 min-h-screen pb-16" dir={isAr ? 'rtl' : 'ltr'}>
      {/* Mobile Top Header */}
      <MobileListingTop
        isAr={isAr}
        title={title}
        subtitle={list.total ? (isAr ? `${list.total} منتج متاح في هذا القسم` : `${list.total} products available in this hub`) : ''}
        banner={{
          image: hub.image,
          eyebrow: badge,
          heading: title,
          text: target,
        }}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
        {/* Desktop Breadcrumbs */}
        <nav aria-label="Breadcrumb" className="hidden sm:flex items-center gap-2 text-xs text-slate-500 mb-6 font-medium">
          <Link href="/" className="hover:text-slate-900">{isAr ? 'الرئيسية' : 'Home'}</Link>
          <ChevronRight size={13} className="rtl:rotate-180 text-slate-400" />
          <Link href="/products" className="hover:text-slate-900">{isAr ? 'مجموعات ريدي مارين' : 'Marine Hubs'}</Link>
          <ChevronRight size={13} className="rtl:rotate-180 text-slate-400" />
          <span className="text-slate-900 font-bold">{title}</span>
        </nav>

        {/* Desktop Hero Showcase Banner */}
        <div className="hidden sm:block relative overflow-hidden rounded-3xl bg-slate-950 text-white shadow-xl mb-10 border border-slate-800">
          <img
            src={hub.image}
            alt={title}
            className="absolute inset-0 w-full h-full object-cover opacity-45 pointer-events-none select-none"
          />
          <div className="absolute inset-0 bg-gradient-to-r rtl:bg-gradient-to-l from-slate-950/95 via-slate-950/80 to-transparent pointer-events-none" />

          <div className="relative z-10 p-8 lg:p-12 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-400/30 mb-4">
              <Icon size={14} className="text-cyan-400" />
              <span>{badge}</span>
            </div>
            <h1 className="text-3xl lg:text-5xl font-black font-display tracking-tight text-white mb-4 leading-tight">
              {title}
            </h1>
            <p className="text-sm lg:text-base text-cyan-100/90 leading-relaxed font-medium mb-4">
              {target}
            </p>
            <p className="text-xs lg:text-sm text-slate-300/80 leading-relaxed max-w-xl mb-6">
              {desc}
            </p>
            <a
              href="#hub-products"
              className="inline-flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs uppercase tracking-wider px-6 py-3 rounded-xl transition-all shadow-md"
            >
              <span>{isAr ? 'تصفح منتجات القسم' : 'Browse Hub Products'}</span>
              <ArrowUpRight size={16} className="rtl:-rotate-90" />
            </a>
          </div>
        </div>

        {/* 4-Item Equipment Checklist (Like ReadyCar Trunk Essentials Guide) */}
        <div className="mb-10 bg-white rounded-2xl p-6 sm:p-8 border border-slate-200/90 shadow-sm">
          <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-900 font-display">
                {isAr ? 'دليل المعدات الأساسية لهذا القسم' : 'Essential Gear Checklist for this Hub'}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {isAr ? 'قائمة مرجعية بأهم ما يجب توافره معك' : 'Recommended essentials you should have on board'}
              </p>
            </div>
            <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <CheckCircle2 size={14} />
              <span>{isAr ? 'جاهز للانطلاق' : 'Ready to Cruise'}</span>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {checklist.map((item, idx) => (
              <div key={idx} className="bg-slate-50/80 rounded-xl p-4 border border-slate-200/70 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-5 h-5 rounded-full bg-cyan-600 text-white text-[10px] font-black flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <h3 className="font-bold text-xs sm:text-sm text-slate-900 leading-snug">
                      {item.title}
                    </h3>
                  </div>
                  <p className="text-[11px] sm:text-xs text-slate-600 leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Main Product Listing with Sidebar */}
        <div id="hub-products" className="pt-2">
          {/* Mobile Tools Bar */}
          <MobileListingTools
            isAr={isAr}
            search={filters.search}
            onSearch={(value) => setFilters(prev => ({ ...prev, search: value, page: 1 }))}
            searchPlaceholder={isAr ? 'ابحث في هذا القسم…' : 'Search within this hub…'}
            onFilters={() => setIsSidebarOpen(open => !open)}
            sort={filters.sort}
            onSort={(value) => setFilters(prev => ({ ...prev, sort: value, page: 1 }))}
            total={list.total}
          />

          <div className="flex items-start gap-8">
            {/* Desktop Filter Sidebar */}
            <aside className="hidden lg:block w-64 shrink-0">
              <FilterSidebar
                filters={filters}
                setFilters={setFilters}
                language={language}
                t={t}
                metadata={metadata}
                loading={loadingMetadata}
              />
            </aside>

            {/* Product Grid */}
            <main className="flex-1 min-w-0">
              <InfiniteProductGrid
                list={list}
                isAr={isAr}
                moreHref={`/hub/${slug}?${filtersToQuery({ ...filters, page: list.nextPage }, { withPage: true })}`}
                onRestart={() => setFilters(prev => ({ ...prev, page: 1 }))}
                skeletonClassName="bg-slate-200/60 rounded-2xl"
                buttonClassName="bg-slate-900 hover:bg-cyan-600"
                accentClassName="text-cyan-700"
              />
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HubPage({ params }) {
  const slug = params?.slug || '';
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm font-semibold text-slate-500">جاري التحميل...</div>}>
      <HubDetailContent slug={slug} />
    </Suspense>
  );
}
