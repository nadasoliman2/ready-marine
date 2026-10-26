'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from '../../lib/navigation';
import { useApp } from '../../context/AppContext';
import FilterSidebar from '../../components/products/FilterSidebar';
import InfiniteProductGrid from '../../components/products/InfiniteProductGrid';
import useInfiniteProducts from '../../lib/useInfiniteProducts';
import { filtersToQuery } from '../../lib/productListPreload';
import { MobileListingTop, MobileListingTools } from '../../components/products/MobileListingHeader';
import { Search, SlidersHorizontal, LayoutGrid, List, Heart, Sparkles } from 'lucide-react';

function GirlsProductsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { language, t, isMounted } = useApp();
  const isAr = language === 'ar';

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const [metadata, setMetadata] = useState({ categories: [], carBrands: [], productBrands: [] });
  const [loadingMetadata, setLoadingMetadata] = useState(true);
  const [errorMetadata, setErrorMetadata] = useState(false);

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
    // Empty: the shop's own order (best sellers, then the categories in turn).
    sort: searchParams.get('sort') || '',
  });

  // Fetch Metadata
  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/products/filters`);
        if (res.ok) {
          const data = await res.json();
          setMetadata(data);
        } else {
          setErrorMetadata(true);
        }
      } catch (err) {
        console.error('Failed to fetch filters:', err);
        setErrorMetadata(true);
      } finally {
        setLoadingMetadata(false);
      }
    };
    fetchMetadata();
  }, []);

  // The filters in the address bar.
  useEffect(() => {
    const query = filtersToQuery(filters, { withPage: true });
    router.replace(`/girls${query ? `?${query}` : ''}`, { scroll: false });
  }, [filters, router]);

  // The collection's products: the shop's endless list, girls' products only.
  const filtersQuery = useMemo(() => [filtersToQuery(filters), 'for_girls=true'].filter(Boolean).join('&'), [filters]);
  const list = useInfiniteProducts(filtersQuery, Math.max(1, Number(filters.page) || 1));
  const products = list.products;

  const handleKeywordSearch = (e) => {
    e.preventDefault();
    const val = e.target.search.value;
    setFilters(prev => ({ ...prev, search: val, page: 1 }));
  };

  if (!isMounted) return null;

  return (
    <div className="bg-white min-h-screen" dir={isAr ? 'rtl' : 'ltr'}>
      {/* A phone: the app design's top — back, title, count, banner — then search, filters and
          the order. The pink hero below is the wider screens'. */}
      <MobileListingTop
        isAr={isAr}
        title={t.girlsProducts || (isAr ? 'منتجات البنات' : 'Girls Products')}
        subtitle={list.total ? (isAr ? `${list.total} منتج مختار ليكي` : `${list.total} products picked for you`) : ''}
        banner={{
          className: 'bg-gradient-to-br from-fuchsia-950 via-purple-800 to-pink-700',
          eyebrow: isAr ? 'مجموعة البنات' : 'The girls collection',
          heading: isAr ? 'تفاصيلك وأناقتك على المركب' : 'Your style onboard',
          text: isAr ? 'إكسسوارات وعناية مختارة لأسلوبك.' : 'Accessories and care picked for your style.',
        }}
      />
      <MobileListingTools
        isAr={isAr}
        search={filters.search}
        onSearch={(value) => setFilters(prev => ({ ...prev, search: value, page: 1 }))}
        searchPlaceholder={isAr ? 'ابحثي في المنتجات…' : 'Search the products…'}
        onFilters={() => setIsSidebarOpen(open => !open)}
        filtersOpen={isSidebarOpen}
        sort={filters.sort}
        onSort={(sort) => setFilters(prev => ({ ...prev, sort, page: 1 }))}
      />

      {/* Hero Header — Pink/Rose themed */}
      <div className="hidden sm:block relative bg-gradient-to-br from-pink-50 via-rose-50 to-fuchsia-50 border-b border-pink-100 py-6 sm:py-16 overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute top-4 start-8 text-pink-200 opacity-50 animate-pulse"><Sparkles size={32} /></div>
        <div className="absolute bottom-8 end-12 text-rose-200 opacity-40"><Heart size={40} /></div>
        <div className="absolute top-12 end-1/4 text-pink-100 opacity-60"><Sparkles size={20} /></div>

        <div className="max-w-7xl mx-auto px-4 relative z-10">
          <div className="max-w-3xl mx-auto text-center space-y-3 sm:space-y-6">
            <div className="inline-flex items-center gap-2 bg-pink-100/80 text-pink-600 px-4 py-1.5 rounded-full text-sm font-bold mb-2">
              <Heart size={14} className="fill-pink-500 text-pink-500" />
              <span>{t.forGirls || (isAr ? 'للبنات' : 'For Girls')}</span>
            </div>
            <h1 className="text-2xl sm:text-4xl lg:text-5xl font-black text-pink-950 tracking-tight">
              {t.girlsProductsTitle || (isAr ? 'مجموعة البنات' : 'Girls Collection')}
            </h1>
            <p className="text-pink-600/70 font-medium text-sm sm:text-lg max-w-xl mx-auto">
              {t.girlsProductsSubtitle || (isAr ? 'استكشفي مجموعتنا المختارة من إكسسوارات السيارات والقطع المصممة للبنات' : 'Explore our curated collection of car accessories and parts designed for girls')}
            </p>
            <form onSubmit={handleKeywordSearch} className="relative group max-w-2xl mx-auto">
              <input
                name="search"
                type="text"
                defaultValue={filters.search}
                placeholder={t.searchPrompt || (isAr ? 'ابحثي عن المنتجات...' : 'Search products...')}
                className="w-full bg-white border-2 border-transparent shadow-xl shadow-pink-200/30 rounded-[2rem] px-5 sm:px-8 py-3.5 sm:py-5 text-base sm:text-lg font-bold outline-none focus:border-pink-400 transition-all duration-300 pe-16"
              />
              <button className="absolute end-4 top-1/2 -translate-y-1/2 bg-gradient-to-r from-pink-500 to-rose-500 p-2 sm:p-3 rounded-xl sm:rounded-2xl text-white hover:from-pink-600 hover:to-rose-600 transition-colors shadow-lg shadow-pink-500/20">
                <Search size={24} />
              </button>
            </form>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 pt-2 pb-12 sm:py-12">
        <div className="flex flex-col lg:flex-row gap-6 sm:gap-8">

          {/* Sidebar Toggle (tablet; a phone has the filters button by the search box) */}
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="hidden sm:flex lg:hidden items-center justify-center gap-2 bg-pink-600 text-white font-bold py-4 rounded-2xl shadow-lg"
          >
            <SlidersHorizontal size={20} />
            <span>{t.showFilters || (isAr ? 'الفلاتر والتصنيفات' : 'Filters & Categories')}</span>
          </button>

          {/* Sidebar */}
          <aside className={`w-full lg:w-72 flex-shrink-0 ${isSidebarOpen ? 'block' : 'hidden lg:block'}`}>
            <FilterSidebar
              filters={filters}
              setFilters={setFilters}
              language={language}
              t={t}
              metadata={metadata}
              loading={loadingMetadata}
              error={errorMetadata}
            />
          </aside>

          {/* Main Grid */}
          <main className="flex-1 min-w-0">
            {/* Toolbar */}
            <div className="hidden sm:flex flex-wrap items-center justify-between gap-4 mb-8 bg-pink-50/50 p-4 rounded-3xl border border-pink-100">
              <div className="flex items-center gap-4">
                <p className="text-sm font-bold text-zinc-500">
                  {t.showing || 'Showing'} <span className="text-pink-900">{(products || []).length}</span> {t.of || 'of'} <span className="text-pink-900">{list.total || 0}</span> {t.results || 'results'}
                </p>
                <div className="hidden sm:flex items-center gap-1 border-s border-pink-200 ps-4">
                  <button className="p-2 bg-white rounded-lg text-pink-500 shadow-sm"><LayoutGrid size={18} /></button>
                  <button className="p-2 text-zinc-400 hover:text-pink-500"><List size={18} /></button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-zinc-400">{t.sortBy || 'Sort By'}:</span>
                <select
                  value={filters.sort || ''}
                  onChange={(e) => setFilters(prev => ({ ...prev, sort: e.target.value, page: 1 }))}
                  className="bg-white border border-pink-100 rounded-xl px-4 py-2 text-sm font-bold text-pink-900 outline-none focus:ring-2 focus:ring-pink-300/40"
                >
                  <option value="">{isAr ? 'المقترح' : 'Featured'}</option>
                  <option value="newest">{isAr ? 'الأحدث' : 'Newest First'}</option>
                  <option value="price_low">{isAr ? 'السعر: من الأقل' : 'Price: Low to High'}</option>
                  <option value="price_high">{isAr ? 'السعر: من الأعلى' : 'Price: High to Low'}</option>
                  <option value="rating">{isAr ? 'الأعلى تقييماً' : 'Top Rated'}</option>
                </select>
              </div>
            </div>

            <InfiniteProductGrid
              list={list}
              isAr={isAr}
              moreHref={`/girls?${filtersToQuery({ ...filters, page: list.nextPage }, { withPage: true })}`}
              onRestart={() => setFilters(prev => ({ ...prev, page: 1 }))}
              skeletonClassName="bg-pink-50 rounded-[2rem]"
              buttonClassName="bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 shadow-pink-500/20"
              accentClassName="text-pink-500"
              empty={(
                <div className="text-center py-20 space-y-4">
                  <Heart size={48} className="mx-auto text-pink-200" />
                  <h3 className="text-xl font-black text-pink-900">{isAr ? 'لا توجد منتجات' : 'No products found'}</h3>
                  <p className="text-zinc-400">{isAr ? 'جربي تعديل الفلاتر أو البحث.' : 'Try adjusting your filters or search terms.'}</p>
                  <button
                    onClick={() => setFilters({ page: 1, search: '', category_id: '', product_brand_id: '', car_brand_id: '', car_model_id: '', car_year: '', min_price: '', max_price: '', sort: '' })}
                    className="text-pink-500 font-bold hover:underline"
                  >
                    {isAr ? 'مسح جميع الفلاتر' : 'Clear all filters'}
                  </button>
                </div>
              )}
            />
          </main>
        </div>
      </div>
    </div>
  );
}

export default function GirlsProductsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-pink-500"></div>
      </div>
    }>
      <GirlsProductsContent />
    </Suspense>
  );
}
