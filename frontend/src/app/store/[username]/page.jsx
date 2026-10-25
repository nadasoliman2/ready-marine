'use client';

import { storePath, decodeStoreParam } from '../../../lib/storeLink';
import { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from '../../../lib/navigation';
import { useApp } from '../../../context/AppContext';
import FilterSidebar from '../../../components/products/FilterSidebar';
import InfiniteProductGrid from '../../../components/products/InfiniteProductGrid';
import useInfiniteProducts from '../../../lib/useInfiniteProducts';
import { PRODUCT_PAGE_SIZE, filtersToQuery, productPageQuery, seedProductList } from '../../../lib/productListPreload';
import { vendorApi } from '../../../lib/api';
import VendorTrustStats from '../../../components/reviews/VendorTrustStats';
import ReviewFeed from '../../../components/reviews/ReviewFeed';
import { resolveAssetUrl } from '../../../lib/assets';
import { formatLocalizedDate } from '../../../lib/dateFormat';
import { trackAdAction } from '../../../lib/adTracking';
import { 
  Search, 
  MapPin, 
  Store, 
  Calendar, 
  Phone, 
  Mail,
  SlidersHorizontal,
  LayoutGrid
} from 'lucide-react';

// The stores opened in the last few minutes, by the name in their address: coming back from
// one of a store's products shows the store at once, its list where the visitor left it
// (lib/useInfiniteProducts.js remembers the list; it needs the store's id to find it).
const STORE_MEMORY_TTL_MS = 10 * 60 * 1000;
const storeMemory = new Map(); // username -> { vendor, reviews, at }

const rememberedStore = (username) => {
  const known = storeMemory.get(username);
  return known && Date.now() - known.at < STORE_MEMORY_TTL_MS ? known : null;
};

/** The store's products, as `/api/products` takes them. */
const storeProductsQuery = (vendorId, filters) => [`vendor_id=${vendorId}`, filtersToQuery(filters)].filter(Boolean).join('&');

function StoreContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { language, t, isMounted } = useApp();
  const isAr = language === 'ar';
  
  // Decoded: the segment can arrive percent-encoded ("x-turbo%20auto%20parts").
  const username = decodeStoreParam(params?.username);
  
  const [vendor, setVendor] = useState(() => rememberedStore(username)?.vendor || null);
  const [error, setError] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const [vendorReviews, setVendorReviews] = useState(() => rememberedStore(username)?.reviews || null);
  const [metadata, setMetadata] = useState({ categories: [], carBrands: [], productBrands: [] });
  const [loadingMetadata, setLoadingMetadata] = useState(true);
  const [errorMetadata, setErrorMetadata] = useState(false);

  // Initialize filters from URL
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
    garage_car_id: searchParams.get('garage_car_id') || '',
    // Empty: the shop's own order (best sellers, then the categories in turn).
    sort: searchParams.get('sort') || '',
  });

  // Sync state to URL and fetch data
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

  // The store: its profile and reviews, once per store. The products the store route sends
  // with them (page one of the filters in the link) go to the list below, so the page opens
  // in one round trip.
  const initialFiltersRef = useRef(filters);
  useEffect(() => {
    if (!username || rememberedStore(username)) return;
    let cancelled = false;
    const opened = initialFiltersRef.current;
    const startPage = Math.max(1, Number(opened.page) || 1);

    vendorApi.getPublicStore(username, { ...opened, page: startPage > 1 ? startPage : '', limit: PRODUCT_PAGE_SIZE })
      .then((data) => {
        if (cancelled || !data?.vendor) return;
        const vendorUsername = data.vendor.store_username || username;
        trackAdAction('visit_store', [vendorUsername, username, storePath(username), `/store/${vendorUsername}`]);
        seedProductList(productPageQuery(storeProductsQuery(data.vendor._id, opened), startPage), {
          products: data.products,
          pagination: data.pagination,
        });
        const known = { vendor: data.vendor, reviews: data.reviews || null, at: Date.now() };
        storeMemory.set(username, known);
        if (data.vendor.store_slug) storeMemory.set(data.vendor.store_slug, known);
        setVendor(data.vendor);
        // The store route ships page 1 of the store's own reviews with the vendor, so the
        // feed renders with the page instead of after a second round trip.
        if (data.reviews) setVendorReviews(data.reviews);
      })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [username]);

  // The filters in the address bar — always the clean address: an old link
  // (/store/x-turbo%20auto%20parts) is replaced by /store/x-turbo-auto-parts once the store
  // says what its slug is.
  useEffect(() => {
    if (!username) return;
    const canonical = vendor?.store_slug || username;
    const query = filtersToQuery(filters, { withPage: true });
    if (window.location.search !== (query ? `?${query}` : '') || canonical !== username) {
      router.replace(`${storePath(canonical)}${query ? `?${query}` : ''}`, { scroll: false });
    }
  }, [filters, vendor?.store_slug, username, router]);

  // The store's products: the shop's endless list, this store only.
  const filtersQuery = useMemo(() => (vendor?._id ? storeProductsQuery(vendor._id, filters) : null), [vendor?._id, filters]);
  const list = useInfiniteProducts(filtersQuery, Math.max(1, Number(filters.page) || 1));
  const products = list.products;

  const handleKeywordSearch = (e) => {
    e.preventDefault();
    const val = e.target.search.value;
    setFilters(prev => ({ ...prev, search: val, page: 1 }));
  };

  const defaultLocation = vendor?.locations?.find(loc => loc.is_default) || vendor?.locations?.[0] || null;
  const storeLocation = defaultLocation
    ? [
        defaultLocation.address,
        defaultLocation.shipping_city,
        defaultLocation.shipping_country,
      ].filter(Boolean).join(', ')
    : '';
  const storeImageUrl = resolveAssetUrl(vendor?.store_image);

  if (!isMounted) return null;

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-marine-canvas">
        <Store size={64} className="text-marine-line mb-4" />
        <h2 className="text-2xl font-bold text-marine-ink mb-2">{isAr ? 'عذراً، المتجر غير موجود' : 'Store Not Found'}</h2>
        <p className="text-marine-outline mb-6">{error}</p>
        <button 
          onClick={() => router.push('/')}
          className="bg-marine-cyan text-white px-8 py-3 rounded-lg font-bold"
        >
          {isAr ? 'العودة للرئيسية' : 'Back to Home'}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white min-h-screen" dir={isAr ? 'rtl' : 'ltr'}>
      
      {/* VENDOR HERO HEAD-ER */}
      <div className="relative bg-marine-navy pt-16 pb-10 md:pt-24 md:pb-16 overflow-hidden">
        {/* Background Effects */}
        <div className="absolute inset-0 z-0">
          <div className="absolute top-0 right-0 w-96 h-96 bg-marine-cyan rounded-full blur-[128px] opacity-10 translate-x-1/4 -translate-y-1/2" />
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-blue-500 rounded-full blur-[128px] opacity-5 -translate-x-1/4 translate-y-1/2" />
        </div>

        <div className="max-w-7xl mx-auto px-4 relative z-10">
          <div className="flex flex-col md:flex-row items-center md:items-start gap-8">
            {/* Store Logo / Image */}
            <div className="w-32 h-32 bg-white/5 border border-white/10 backdrop-blur-xl rounded-[2.5rem] flex items-center justify-center shadow-2xl shrink-0 group hover:border-marine-cyan/50 transition-colors overflow-hidden">
              {storeImageUrl ? (
                <img
                  src={storeImageUrl}
                  alt={vendor?.store_name || 'Store'}
                  className="w-full h-full object-cover"
                />
              ) : (
                <Store size={56} className="text-marine-primary group-hover:scale-110 transition-transform" />
              )}
            </div>

            <div className="flex-1 text-center md:text-start space-y-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-3">
                  <h1 className="text-3xl md:text-4xl font-bold text-white">{vendor?.store_name}</h1>
                  <span className="bg-marine-cyan text-white text-[10px] font-bold uppercase tracking-[0.2em] px-3 py-1 rounded-full border border-white/10">
                    {isAr ? 'متجر معتمد' : 'Verified Store'}
                  </span>
                </div>
                <p className="text-marine-primary font-bold text-lg">@{vendor?.store_username}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 pt-2">
                <div className="flex items-center justify-center md:justify-start gap-3 text-marine-outline">
                  <MapPin size={18} className="text-marine-primary" />
                  <span className="text-sm font-medium">{storeLocation || (isAr ? 'لم يتم تحديد الموقع' : 'Location not set')}</span>
                </div>
                <div className="flex items-center justify-center md:justify-start gap-3 text-marine-outline">
                  <Calendar size={18} className="text-marine-primary" />
                  <span className="text-sm font-medium">
                    {isAr ? 'عضو منذ' : 'Member since'} {vendor?.created_at ? formatLocalizedDate(vendor.created_at, isAr, { year: 'numeric', month: 'long' }) : '2024'}
                  </span>
                </div>
                <div className="flex items-center justify-center md:justify-start gap-3 text-marine-outline">
                   <LayoutGrid size={18} className="text-marine-primary" />
                   <span className="text-sm font-medium">
                     {list.total || 0} {isAr ? 'منتج' : 'products'}
                   </span>
                </div>
              </div>

              {/* The store's track record. Sits with the rest of the header facts rather
                  than beside the reviews, because it is what a visitor scans first. */}
              <VendorTrustStats
                completedOrders={vendor?.completed_orders_count}
                rating={vendor?.rating}
                reviewsCount={vendor?.reviews_count}
                isAr={isAr}
                tone="dark"
                className="justify-center md:justify-start pt-1"
              />
            </div>

            {/* Contact / Quick Info Box */}
            <div className="hidden lg:flex flex-col gap-3 min-w-[240px]">
              <div className="bg-white/5 border border-white/10 backdrop-blur-xl p-4 rounded-xl space-y-3">
                {vendor?.phone && (
                  <div className="flex items-center gap-3 text-xs font-bold text-white/70">
                    <Phone size={14} className="text-marine-primary" />
                    <span>{vendor.phone}</span>
                  </div>
                )}
                {vendor?.email && (
                  <div className="flex items-center gap-3 text-xs font-bold text-white/70">
                    <Mail size={14} className="text-marine-primary" />
                    <span className="truncate">{vendor.email}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SEARCH AND FILTERS */}
      <div className="max-w-7xl mx-auto px-4 -translate-y-1/2">
        <form onSubmit={handleKeywordSearch} className="relative group max-w-2xl mx-auto">
          <input 
            name="search"
            type="text"
            defaultValue={filters.search}
            placeholder={isAr ? 'ابحث في هذا المتجر...' : "Search in this store..."}
            className="w-full bg-white border border-marine-teal/15 shadow-2xl rounded-xl px-8 py-5 text-lg font-bold outline-none focus:border-marine-cyan transition-all duration-300 pr-16"
          />
          <button className="absolute end-4 top-1/2 -translate-y-1/2 bg-marine-cyan p-3 rounded-lg text-white hover:bg-marine-cyan-dark transition-colors shadow-lg">
            <Search size={22} />
          </button>
        </form>
      </div>

      <div className="max-w-7xl mx-auto px-4 pb-20">
        <div className="flex flex-col lg:flex-row gap-8">
          
          {/* Sidebar Toggle (Mobile) */}
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="lg:hidden flex items-center justify-center gap-2 bg-marine-navy text-white font-bold py-4 rounded-lg shadow-lg mb-4"
          >
            <SlidersHorizontal size={20} />
            <span>{t.showFilters || 'Filters & Categories'}</span>
          </button>

          {/* Sidebar (Desktop) */}
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
          <main className="flex-1">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-8 bg-marine-canvas/50 p-4 rounded-xl border border-marine-teal/15">
              <div className="flex items-center gap-4">
                <p className="text-sm font-bold text-marine-outline">
                  {isAr ? 'عرض' : 'Showing'} <span className="text-marine-ink">{(products || []).length}</span> {isAr ? 'من' : 'of'} <span className="text-marine-ink">{list.total || 0}</span> {isAr ? 'نتائج' : 'results'}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-marine-outline">{t.sortBy || 'Sort By'}:</span>
                <select 
                  value={filters.sort || ''}
                  onChange={(e) => setFilters(prev => ({ ...prev, sort: e.target.value, page: 1 }))}
                  className="bg-white border border-marine-teal/15 rounded-xl px-4 py-2 text-sm font-bold text-marine-ink outline-none focus:ring-2 focus:ring-marine-cyan/20"
                >
                  <option value="">{isAr ? 'المقترح' : 'Featured'}</option>
                  <option value="newest">{isAr ? 'الأحدث' : 'Newest First'}</option>
                  <option value="price_low">{isAr ? 'السعر: من الأقل للأعلى' : 'Price: Low to High'}</option>
                  <option value="price_high">{isAr ? 'السعر: من الأعلى للأقل' : 'Price: High to Low'}</option>
                  <option value="rating">{isAr ? 'الأعلى تقييماً' : 'Top Rated'}</option>
                </select>
              </div>
            </div>

            <InfiniteProductGrid
              list={list}
              isAr={isAr}
              moreHref={`${storePath(vendor?.store_slug || username)}?${filtersToQuery({ ...filters, page: list.nextPage }, { withPage: true })}`}
              onRestart={() => setFilters(prev => ({ ...prev, page: 1 }))}
              skeletonClassName="bg-marine-canvas rounded-[2.5rem]"
              empty={(
                <div className="text-center py-20 space-y-4">
                  <Search size={48} className="mx-auto text-marine-line" />
                  <h3 className="text-xl font-bold text-marine-ink">{isAr ? 'لا توجد منتجات' : 'No products found in this store'}</h3>
                  <p className="text-marine-outline">{isAr ? 'حاول تغيير معايير البحث أو الفلاتر.' : 'Try adjusting your filters or search terms.'}</p>
                  <button 
                    onClick={() => setFilters({ page: 1 })}
                    className="text-marine-primary font-bold hover:underline"
                  >
                    {isAr ? 'مسح جميع الفلاتر' : 'Clear all filters'}
                  </button>
                </div>
              )}
            />

            {/* What customers said about the STORE — its service, not its parts. Placed
                after the catalogue so the page leads with what is for sale and closes with
                the reason to trust who is selling it. */}
            {vendor?._id && (
              <ReviewFeed
                subject="vendor"
                subjectId={vendor._id}
                title={isAr ? 'تقييمات المتجر' : 'Store reviews'}
                emptyText={isAr ? 'لا توجد تقييمات بعد لهذا المتجر.' : 'No reviews yet for this store.'}
                initialData={vendorReviews}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

export default function StorePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-marine-canvas">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-marine-cyan"></div>
      </div>
    }>
      <StoreContent />
    </Suspense>
  );
}
