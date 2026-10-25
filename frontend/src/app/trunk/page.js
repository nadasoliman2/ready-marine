'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from '../../lib/navigation';
import { useApp } from '../../context/AppContext';
import FilterSidebar from '../../components/products/FilterSidebar';
import InfiniteProductGrid from '../../components/products/InfiniteProductGrid';
import useInfiniteProducts from '../../lib/useInfiniteProducts';
import { filtersToQuery } from '../../lib/productListPreload';
import Image from 'next/image';
import Link from '../../components/LocaleLink';
import { Search, SlidersHorizontal, ShieldCheck, ArrowUpRight, ArrowDown, ChevronRight, BatteryCharging, Wrench, PackageCheck, RotateCcw } from 'lucide-react';
import styles from './trunk.module.css';
import { MobileListingTop, MobileListingTools } from '../../components/products/MobileListingHeader';

const ESSENTIAL_GROUPS = [
  { icon: ShieldCheck, ar: 'الأمان أولًا', en: 'Safety first', detailAr: 'مثلث تحذير وشنطة إسعافات وطفاية', detailEn: 'Warning triangle, first aid & extinguisher' },
  { icon: BatteryCharging, ar: 'طاقة تكمل بيها', en: 'Keep moving', detailAr: 'كابلات شحن وكشاف للطوارئ', detailEn: 'Jump leads & an emergency torch' },
  { icon: Wrench, ar: 'جاهز لأي عطل', en: 'Handle the unexpected', detailAr: 'كوريك ومفتاح عجل وحبل سحب', detailEn: 'Jack, wheel brace & tow rope' },
  { icon: PackageCheck, ar: 'كل حاجة في مكانها', en: 'A place for everything', detailAr: 'منظم شنطة وأدوات العناية بالعربية', detailEn: 'Trunk organizers & car care essentials' },
];

function TrunkProductsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { language, t, isMounted } = useApp();
  const isAr = language === 'ar';

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState(searchParams.get('search') || '');

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

  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/products/filters`);
        if (res.ok) setMetadata(await res.json());
        else setErrorMetadata(true);
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
    router.replace(`/trunk${query ? `?${query}` : ''}`, { scroll: false });
  }, [filters, router]);

  // The products: the shop's endless list, trunk essentials only (for_trunk, the page's
  // whole point).
  const filtersQuery = useMemo(() => [filtersToQuery(filters), 'for_trunk=true'].filter(Boolean).join('&'), [filters]);
  const list = useInfiniteProducts(filtersQuery, Math.max(1, Number(filters.page) || 1));
  const products = list.products;

  useEffect(() => {
    setSearchDraft(filters.search || '');
  }, [filters.search]);

  const handleKeywordSearch = (e) => {
    e.preventDefault();
    setFilters(prev => ({ ...prev, search: e.target.search.value, page: 1 }));
  };

  if (!isMounted) return null;

  return (
    <div className={styles.page} dir={isAr ? 'rtl' : 'ltr'}>
      {/* A phone: the app design's top — back, title, count, the trunk banner. The checklist
          of essentials stays under it; search, filters and the order sit over the products. */}
      <MobileListingTop
        isAr={isAr}
        title={isAr ? 'مستلزمات على المركب' : 'Onboard Essentials'}
        subtitle={list.total ? (isAr ? `${list.total} منتج أساسي لكل مشوار` : `${list.total} essentials for every trip`) : ''}
        banner={{
          image: '/images/trunk/road-ready-hero.jpg',
          eyebrow: isAr ? 'أساسيات كل مشوار' : 'Every trip\'s essentials',
          heading: isAr ? 'جهز شنطتك. وسوق مطمّن.' : 'Pack your trunk. Drive with confidence.',
          text: isAr ? 'كل الأدوات ومستلزمات الطوارئ اللي تحتاجها في متناول إيدك.' : 'The tools and emergency kit you need, within reach.',
        }}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="hidden sm:block">
        <nav aria-label={isAr ? 'مسار الصفحة' : 'Breadcrumb'} className={styles.breadcrumb}>
          <Link href="/">{isAr ? 'الرئيسية' : 'Home'}</Link>
          <ChevronRight size={13} className={isAr ? 'rotate-180' : ''} aria-hidden="true" />
          <span aria-current="page">{isAr ? 'مستلزمات على المركب' : 'Onboard essentials'}</span>
        </nav>

        <section className={styles.hero} aria-labelledby="trunk-title">
          <div className={styles.heroCopy}>
            <div className={styles.eyebrow}>
              <span className={styles.statusDot} />
              {isAr ? 'أساسيات كل مشوار' : 'THE EVERYDAY ESSENTIALS'}
            </div>
            <h1 id="trunk-title" className={styles.title}>
              {isAr ? 'جهّز شنطتك.' : 'Pack your trunk.'}
              <br />
              <span>{isAr ? 'وسوق مطمّن.' : 'Drive with confidence.'}</span>
            </h1>
            <p className={styles.description}>
              {isAr
                ? 'من أول مشوار لآخر الطريق، خلي كل اللي ممكن تحتاجه معاك. أدوات للطوارئ، أساسيات للعربية، وراحة بال في كل رحلة.'
                : 'From the everyday commute to the open road. Keep the tools, emergency essentials, and peace of mind you need within reach.'}
            </p>
            <a href="#trunk-products" className={styles.primaryAction}>
              {isAr ? 'جهّز شنطة عربيتك' : 'Explore the essentials'}
              <ArrowUpRight size={19} className={isAr ? '-rotate-90' : ''} aria-hidden="true" />
            </a>
            <div className={styles.heroNote}>
              <ShieldCheck size={17} aria-hidden="true" />
              <span>{isAr ? 'حاجات بسيطة. فرق كبير وقت اللزوم.' : 'Small essentials. A big difference when it matters.'}</span>
            </div>
          </div>
          <figure className={styles.heroVisual}>
            <Image
              src="/images/trunk/road-ready-hero.jpg"
              alt={isAr
                ? 'شنطة عربية مفتوحة فيها منظم أدوات وكابلات شحن وكوريك وكمبروسر وشنطة إسعافات ومثلث تحذير'
                : 'An open car trunk neatly packed with an organizer, jump leads, jack, tire inflator, first-aid kit and warning triangle'}
              fill
              priority
              sizes="(max-width: 767px) 100vw, (max-width: 1280px) 56vw, 700px"
              className={styles.heroImage}
            />
            <figcaption className={styles.imageCaption}>
              <span className={styles.captionLine} />
              <span>{isAr ? 'كل حاجة جاهزة. لأي طريق.' : 'EVERYTHING IN PLACE. EVERY ROAD AHEAD.'}</span>
            </figcaption>
          </figure>
        </section>
        </div>

        <section className={styles.essentials} aria-label={isAr ? 'دليل أساسيات الشنطة' : 'Your trunk essentials checklist'}>
          {ESSENTIAL_GROUPS.map(({ icon: Icon, ar, en, detailAr, detailEn }, index) => (
            <div key={en} className={styles.essential}>
              <div className={styles.essentialIcon}><Icon size={21} strokeWidth={1.6} aria-hidden="true" /></div>
              <div>
                <h2>{isAr ? ar : en}</h2>
                <p>{isAr ? detailAr : detailEn}</p>
              </div>
              <span className={styles.essentialNumber} aria-hidden="true">0{index + 1}</span>
            </div>
          ))}
        </section>
      </div>

      <MobileListingTools
        isAr={isAr}
        search={filters.search}
        onSearch={(value) => setFilters(prev => ({ ...prev, search: value, page: 1 }))}
        searchPlaceholder={isAr ? 'بتدور على إيه لشنطتك؟' : 'Search trunk essentials…'}
        onFilters={() => setIsSidebarOpen(open => !open)}
        filtersOpen={isSidebarOpen}
        sort={filters.sort}
        onSort={(sort) => setFilters(prev => ({ ...prev, sort, page: 1 }))}
      />

      <section id="trunk-products" aria-labelledby="products-title" className="max-w-7xl mx-auto px-4 sm:px-6 pt-2 sm:pt-10 pb-16 scroll-mt-28">
        <div className="hidden sm:block">
        <div className={styles.catalogHeading}>
          <div>
            <div className={styles.sectionLabel}>{isAr ? 'جاهز للطريق' : 'READY FOR THE ROAD'}<ArrowDown size={12} aria-hidden="true" /></div>
            <h2 id="products-title">{isAr ? 'كمّل أساسيات شنطتك' : 'A little preparation. A better journey.'}</h2>
            <p>{isAr ? 'اختار اللي ناقص عربيتك، وخليك مستعد للمشوار الجاي.' : 'Find what your car is missing, and be ready for the next trip.'}</p>
          </div>
          <form onSubmit={handleKeywordSearch} className={styles.search} role="search">
            <label htmlFor="trunk-search" className="sr-only">{isAr ? 'ابحث في أساسيات الشنطة' : 'Search trunk essentials'}</label>
            <input id="trunk-search" name="search" type="search" value={searchDraft} onChange={e => setSearchDraft(e.target.value)} placeholder={isAr ? 'بتدور على إيه لشنطتك؟' : 'Search trunk essentials…'} />
            <button type="submit" aria-label={isAr ? 'بحث' : 'Search'}><Search size={19} /></button>
          </form>
        </div>
        </div>
        <div className="flex flex-col lg:flex-row gap-8">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            aria-expanded={isSidebarOpen}
            aria-controls="trunk-filters"
            className="hidden sm:flex lg:hidden items-center justify-center gap-2 border border-zinc-200 bg-white text-zinc-800 font-bold py-3 rounded-xl"
          >
            <SlidersHorizontal size={20} />
            <span>{t.showFilters || (isAr ? 'الفلاتر والتصنيفات' : 'Filters & Categories')}</span>
          </button>

          <aside id="trunk-filters" className={`bg-white border border-zinc-200/80 rounded-2xl p-5 w-full lg:w-64 flex-shrink-0 ${isSidebarOpen ? 'block' : 'hidden lg:block'}`}>
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

          <div className="flex-1 min-w-0">
            <div className="hidden sm:flex flex-wrap items-center justify-between gap-4 mb-6 pb-5 border-b border-zinc-200">
              <div className="flex items-center gap-4">
                <p className="text-sm font-bold text-zinc-500">
                  {t.showing || 'Showing'} <span className="text-zinc-900">{(products || []).length}</span> {t.of || 'of'} <span className="text-zinc-900">{list.total || 0}</span> {t.results || 'results'}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="trunk-sort" className="text-sm text-zinc-500">{t.sortBy || 'Sort By'}:</label>
                <select
                  id="trunk-sort"
                  value={filters.sort || ''}
                  onChange={(e) => setFilters(prev => ({ ...prev, sort: e.target.value, page: 1 }))}
                  className="bg-white border border-zinc-200 rounded-lg px-4 py-2 text-sm font-bold text-zinc-900 outline-none focus:ring-2 focus:ring-amber-300/40"
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
              moreHref={`/trunk?${filtersToQuery({ ...filters, page: list.nextPage }, { withPage: true })}`}
              onRestart={() => setFilters(prev => ({ ...prev, page: 1 }))}
              skeletonClassName="bg-zinc-200/60 rounded-2xl"
              buttonClassName="bg-zinc-900 hover:bg-amber-600"
              accentClassName="text-amber-700"
              failed={(
                <div role="alert" className="text-center py-16 px-6 bg-white rounded-2xl border border-zinc-200 space-y-3">
                  <PackageCheck size={36} className="mx-auto text-zinc-400" aria-hidden="true" />
                  <h3 className="text-lg font-bold text-zinc-900">{isAr ? 'مش قادرين نحمّل المنتجات دلوقتي' : 'We couldn’t load the essentials'}</h3>
                  <p className="text-sm text-zinc-500">{isAr ? 'جرّب تاني بعد لحظات.' : 'Please try again in a moment.'}</p>
                  <button type="button" onClick={list.loadMore} className="inline-flex items-center gap-2 text-sm font-bold text-amber-700 hover:text-amber-800 py-2">
                    <RotateCcw size={15} aria-hidden="true" />{isAr ? 'حاول تاني' : 'Try again'}
                  </button>
                </div>
              )}
              empty={(
                <div className="text-center py-20 space-y-4">
                  <ShieldCheck size={48} className="mx-auto text-zinc-300" />
                  <h3 className="text-xl font-black text-zinc-900">{isAr ? 'لا توجد منتجات' : 'No products found'}</h3>
                  <p className="text-zinc-400">{isAr ? 'جرب تعديل الفلاتر أو البحث.' : 'Try adjusting your filters or search terms.'}</p>
                  <button
                    onClick={() => setFilters({ page: 1, search: '', category_id: '', product_brand_id: '', car_brand_id: '', car_model_id: '', car_year: '', min_price: '', max_price: '', sort: '' })}
                    className="text-amber-600 font-bold hover:underline"
                  >
                    {isAr ? 'مسح جميع الفلاتر' : 'Clear all filters'}
                  </button>
                </div>
              )}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

export default function TrunkProductsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500"></div>
      </div>
    }>
      <TrunkProductsContent />
    </Suspense>
  );
}
