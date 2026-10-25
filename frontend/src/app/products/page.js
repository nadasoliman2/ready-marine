'use client';

import { useState, useEffect, useRef, useMemo, useSyncExternalStore, Suspense } from 'react';
import { useSearchParams, useRouter } from '../../lib/navigation';
import { useApp } from '../../context/AppContext';
import FilterSidebar from '../../components/products/FilterSidebar';
import SubcategorySlider from '../../components/products/SubcategorySlider';
import { Search, SlidersHorizontal, LayoutGrid, List, BadgeCheck, X, ChevronRight, Anchor } from 'lucide-react';
import Link from '../../components/LocaleLink';
import { FitmentGuaranteeBanner } from '../../components/marine/HomeSections';
import { CATEGORY_FILTER_EVENT, SEARCH_FILTER_EVENT } from '../../lib/categoryFilterEvents';
import useInfiniteProducts from '../../lib/useInfiniteProducts';
import InfiniteProductGrid from '../../components/products/InfiniteProductGrid';
import { indexCategoryTree, categoriesForBrand, pruneCategoryTree } from '../../lib/brandCategoryLink';
import { useBrandModels } from '../../lib/carBrandModels';
import GarageSaveCard from '../../components/garage/GarageSaveCard';
import SearchAutocomplete from '../../components/search/SearchAutocomplete';
import { MobileListingTop, MobileListingTools } from '../../components/products/MobileListingHeader';
import Overlay from '../../components/Overlay';

const filterKeys = [
  'page',
  'search',
  'type_id',
  'category_id',
  'product_brand_id',
  'car_brand_id',
  'car_model_id',
  'car_year',
  'min_price',
  'max_price',
  'garage_car_id',
  'sort',
];

const getFiltersFromParams = (searchParams) => ({
  page: searchParams.get('page') || 1,
  search: searchParams.get('search') || '',
  type_id: searchParams.get('type_id') || '',
  category_id: searchParams.get('category_id') || '',
  product_brand_id: searchParams.get('product_brand_id') || '',
  car_brand_id: searchParams.get('car_brand_id') || '',
  car_model_id: searchParams.get('car_model_id') || '',
  car_year: searchParams.get('car_year') || '',
  min_price: searchParams.get('min_price') || '',
  max_price: searchParams.get('max_price') || '',
  garage_car_id: searchParams.get('garage_car_id') || '',
  // Empty means the default order: best match for a search, otherwise the shop's own
  // ("featured": best sellers, then the categories in turn).
  sort: searchParams.get('sort') || '',
});

// Whether the filters sit beside the products (a computer, from `lg`) or open in a sheet.
const WIDE = '(min-width: 1024px)';
const subscribeWide = (onChange) => {
  const media = window.matchMedia(WIDE);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
};
const useWideScreen = () => useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => true);

const filtersAreEqual = (a, b) => filterKeys.every(key => String(a?.[key] ?? '') === String(b?.[key] ?? ''));

const getQueryFromFilters = (filters) => {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (!value) return;
    if (key === 'page' && String(value) === '1') return;
    params.set(key, value);
  });

  return params.toString();
};

const findCategoryTrail = (categories, categoryId, trail = []) => {
  if (!categoryId || !Array.isArray(categories)) return null;

  for (const category of categories) {
    const nextTrail = [...trail, category];
    if (String(category._id) === String(categoryId)) return nextTrail;

    const found = findCategoryTrail(category.subcategories, categoryId, nextTrail);
    if (found) return found;
  }

  return null;
};

const getVisibleCategoryCards = (categories, categoryId) => {
  const trail = findCategoryTrail(categories, categoryId);
  if (!trail) return [];

  const selected = trail[trail.length - 1];
  if (selected?.subcategories?.length > 0) return selected.subcategories;

  const parent = trail.length > 1 ? trail[trail.length - 2] : null;
  return parent?.subcategories?.length > 0 ? parent.subcategories : categories;
};

/**
 * Where the category cards stand: the title of the level they show, and the button that goes
 * up one level — to the parent of the chosen category, or out of categories from a top one.
 * The cards show the chosen category's children, or, for a category without any, its
 * siblings, so the title is the chosen category or its parent.
 */
const categoryLevel = (categories, categoryId, isAr, goTo) => {
  const trail = findCategoryTrail(categories, categoryId);
  if (!trail) return {};
  const name = (cat) => (isAr ? (cat.name_ar || cat.name) : cat.name);
  const selected = trail[trail.length - 1];
  const parent = trail.length > 1 ? trail[trail.length - 2] : null;
  const shown = selected.subcategories?.length > 0 ? selected : parent;
  return {
    title: shown ? name(shown) : (isAr ? 'التصنيفات' : 'Categories'),
    back: {
      label: parent
        ? (isAr ? `رجوع إلى ${name(parent)}` : `Back to ${name(parent)}`)
        : (isAr ? 'رجوع إلى كل الفئات' : 'Back to all categories'),
      onClick: () => goTo(parent ? parent._id : ''),
    },
  };
};

const flattenTree = (nodes, acc = []) => {
  (nodes || []).forEach((node) => { acc.push(node); flattenTree(node.subcategories, acc); });
  return acc;
};

/**
 * The category cards for a chosen product type, and the title and back button that go with
 * them. The type's own level is its categories (in tree order); a type with a single category
 * opens straight onto that category's children rather than one lonely card. Inside, cards
 * behave as they do without a type, except that the top of the type goes back to the type
 * — "Back to Routine maintenance" — and a category without children there shows the type's
 * cards again with it selected. A category outside the type falls back to the plain view.
 */
const typeCategoryView = (categories, type, categoryId, isAr, goTo, clearType) => {
  const name = (item) => (isAr ? (item.name_ar || item.name) : item.name);
  const assignedIds = new Set((type.category_ids || []).map(String));
  const assigned = flattenTree(categories).filter((cat) => assignedIds.has(String(cat._id)));
  const roots = assigned.length === 1 && assigned[0].subcategories?.length ? assigned[0].subcategories : assigned;
  const typeName = name(type);
  const allBack = {
    label: isAr ? 'رجوع إلى كل الفئات' : 'Back to all categories',
    onClick: clearType,
  };

  const trail = categoryId ? findCategoryTrail(categories, categoryId) : null;
  const rootIndex = trail ? trail.findIndex((cat) => roots.some((r) => String(r._id) === String(cat._id))) : -1;
  if (!categoryId || !trail) return { subcategories: roots, title: typeName, back: allBack };
  if (rootIndex === -1) return null;

  const index = trail.length - 1;
  const selected = trail[index];
  const parent = index > rootIndex ? trail[index - 1] : null;
  let subcategories = roots;
  let title = typeName;
  if (selected.subcategories?.length) {
    subcategories = selected.subcategories;
    title = name(selected);
  } else if (parent) {
    subcategories = parent.subcategories;
    title = name(parent);
  }
  return {
    subcategories,
    title,
    back: parent
      ? { label: isAr ? `رجوع إلى ${name(parent)}` : `Back to ${name(parent)}`, onClick: () => goTo(parent._id) }
      : { label: isAr ? `رجوع إلى ${typeName}` : `Back to ${typeName}`, onClick: () => goTo('') },
  };
};

function ProductsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { language, t, isMounted, categories: appCategories } = useApp();
  const isAr = language === 'ar';
  const searchParamString = searchParams.toString();

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const isWide = useWideScreen();
  // Below a computer the filters open in a sheet over the page, as the big shops do on a
  // phone, instead of stacking above the products. The page behind does not scroll.
  const sheetOpen = isSidebarOpen && !isWide;
  useEffect(() => {
    if (!sheetOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event) => { if (event.key === 'Escape') setIsSidebarOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [sheetOpen]);

  const [metadata, setMetadata] = useState({ categories: appCategories || [], carBrands: [], productBrands: [] });
  const [loadingMetadata, setLoadingMetadata] = useState(true);
  const [errorMetadata, setErrorMetadata] = useState(false);


  // Initialize filters from URL
  const [filters, setFilters] = useState(() => getFiltersFromParams(searchParams));
  // The car the results are filtered by, named, for the "save it to your garage" card. Only
  // a complete car (make, model, year) picked by hand — one chosen from the garage is saved.
  const searchedBrand = (metadata.carBrands || []).find((b) => String(b._id) === String(filters.car_brand_id));
  const searchedModels = useBrandModels(searchedBrand);
  const searchedModel = searchedModels.find((m) => String(m._id) === String(filters.car_model_id));
  const searchedCar = !filters.garage_car_id && searchedBrand && searchedModel && filters.car_year
    ? { car_brand_id: searchedBrand._id, car_brand_name: searchedBrand.name, car_model_id: searchedModel._id, car_model_name: searchedModel.name, year: Number(filters.car_year) }
    : null;
  // The category cards above the grid follow the chosen brand, like the sidebar does.
  const visibleCategories = useMemo(() => {
    const brand = (metadata.productBrands || []).find(b => String(b._id) === String(filters.product_brand_id));
    if (!brand) return metadata.categories || [];
    return pruneCategoryTree(metadata.categories || [], categoriesForBrand(brand, indexCategoryTree(metadata.categories || [])));
  }, [metadata.categories, metadata.productBrands, filters.product_brand_id]);

  // The cards above the grid: the chosen type's categories, or the chosen category's level.
  const selectedType = (metadata.productTypes || []).find((type) => String(type._id) === String(filters.type_id));
  const goToCategory = (id) => setFilters(prev => ({ ...prev, category_id: id, page: 1 }));
  const categoryCards = (selectedType && typeCategoryView(
    visibleCategories, selectedType, filters.category_id, isAr, goToCategory,
    () => setFilters(prev => ({ ...prev, type_id: '', category_id: '', page: 1 })),
  )) || {
    subcategories: getVisibleCategoryCards(visibleCategories, filters.category_id),
    ...categoryLevel(visibleCategories, filters.category_id, isAr, goToCategory),
  };

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

  useEffect(() => {
    if (!appCategories?.length) return;
    setMetadata(prev => (
      prev.categories?.length > 0 ? prev : { ...prev, categories: appCategories }
    ));
  }, [appCategories]);

  // The filters and the URL, kept in step. While the visitor works the page the filters are
  // the truth and the URL follows them (router.replace). A URL this page did not write itself
  // — a link, the back button — is read back into the filters.
  //
  // Each replace lands a moment later. A URL arriving that this page wrote is not a change:
  // reading it back would undo whatever was changed in between (typing "750" into the price
  // gave 70, a filter picked right after a search lost the search). So the page remembers
  // the URLs it asked for, and `targetQueryRef` the one it last asked for or adopted.
  const writtenQueriesRef = useRef(new Set());
  const seenQueryRef = useRef(searchParamString);
  const targetQueryRef = useRef(searchParamString);

  useEffect(() => {
    if (searchParamString === seenQueryRef.current) return;
    seenQueryRef.current = searchParamString;
    if (writtenQueriesRef.current.delete(searchParamString)) return; // ours, arriving
    targetQueryRef.current = searchParamString;
    const nextFilters = getFiltersFromParams(new URLSearchParams(searchParamString));
    setFilters(prev => filtersAreEqual(prev, nextFilters) ? prev : nextFilters);
  }, [searchParamString]);

  useEffect(() => {
    const query = getQueryFromFilters(filters);
    if (query === targetQueryRef.current) return;
    targetQueryRef.current = query;
    if (writtenQueriesRef.current.size > 20) writtenQueriesRef.current.clear();
    writtenQueriesRef.current.add(query);
    router.replace(`/products${query ? `?${query}` : ''}`, { scroll: false });
  }, [filters, router]);

  // The top menu's categories and the header's search box, while this page is open, change
  // the filters directly — narrowing what is already chosen — instead of navigating.
  useEffect(() => {
    const handleCategoryFilter = (event) => {
      const categoryId = event.detail?.categoryId;
      if (!categoryId) return;

      setFilters(prev => (
        String(prev.category_id) === String(categoryId)
          ? prev
          : { ...prev, category_id: categoryId, page: 1 }
      ));
    };
    const handleSearchFilter = (event) => {
      const query = event.detail?.query;
      if (!query) return;
      setFilters(prev => (prev.search === query ? prev : { ...prev, search: query, page: 1 }));
    };

    window.addEventListener(CATEGORY_FILTER_EVENT, handleCategoryFilter);
    window.addEventListener(SEARCH_FILTER_EVENT, handleSearchFilter);
    return () => {
      window.removeEventListener(CATEGORY_FILTER_EVENT, handleCategoryFilter);
      window.removeEventListener(SEARCH_FILTER_EVENT, handleSearchFilter);
    };
  }, []);

  // The products: one endless list per set of filters, loading more as the visitor scrolls
  // (lib/useInfiniteProducts.js). A `?page=` link starts the list at that page.
  const filtersQuery = useMemo(() => getQueryFromFilters({ ...filters, page: 1 }), [filters]);
  const startPage = Math.max(1, Number(filters.page) || 1);
  const list = useInfiniteProducts(filtersQuery, startPage);
  const products = list.products;

  // The phone's title: the chosen category (or product type) by name, as in the app design,
  // else "All products".
  const categoryTrail = findCategoryTrail(metadata.categories, filters.category_id);
  const selectedCategory = categoryTrail ? categoryTrail[categoryTrail.length - 1] : null;
  const phoneTitle = selectedCategory
    ? (isAr ? (selectedCategory.name_ar || selectedCategory.name) : selectedCategory.name)
    : selectedType
      ? (isAr ? (selectedType.name_ar || selectedType.name) : selectedType.name)
      : (t.allProducts || (isAr ? 'كل المنتجات' : 'All Products'));

  // Handle keyword search from internal bar
  const handleKeywordSearch = (value) => {
    setFilters(prev => ({ ...prev, search: value, page: 1 }));
  };

  if (!isMounted) return null;

  return (
    <div className="bg-marine-canvas min-h-screen" dir={isAr ? 'rtl' : 'ltr'}>
      {/* A phone: the app design's top — back, title, count — then search, filters and the
          order. The search hero below is the wider screens'. */}
      <MobileListingTop
        isAr={isAr}
        title={phoneTitle}
        subtitle={list.total
          ? (selectedCategory
            ? (isAr ? `${list.total} منتج في الفئة` : `${list.total} products in this category`)
            : (isAr ? `${list.total} منتج` : `${list.total} products`))
          : (selectedCategory ? (isAr ? 'منتجات الفئة' : 'Category products') : '')}
      />
      <MobileListingTools
        isAr={isAr}
        search={filters.search}
        onSearch={handleKeywordSearch}
        searchPlaceholder={t.searchPrompt || (isAr ? 'ابحث بالاسم أو رقم القطعة…' : 'Search by name or part number…')}
        onFilters={() => setIsSidebarOpen(open => !open)}
        filtersOpen={isSidebarOpen}
        sort={filters.sort}
        onSort={(sort) => setFilters(prev => ({ ...prev, sort, page: 1 }))}
      />

      {/* Catalog header: where the visitor is, what the list is, and how it ships. */}
      <div className="hidden sm:block bg-marine-canvas border-b border-marine-teal/10 py-6">
        <div className="max-w-7xl mx-auto px-4">
          <nav className="flex items-center gap-2 text-[11px] text-marine-outline mb-3" aria-label="Breadcrumb">
            <Link href="/" className="hover:text-marine-primary">{t.home || (isAr ? 'الرئيسية' : 'Home')}</Link>
            <ChevronRight size={12} className="rtl:rotate-180" />
            <Link href="/products" className="hover:text-marine-primary">{isAr ? 'الكتالوج' : 'Catalog'}</Link>
            {selectedCategory && (<><ChevronRight size={12} className="rtl:rotate-180" /><span className="text-marine-ink">{phoneTitle}</span></>)}
          </nav>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl lg:text-[32px] lg:leading-10 font-semibold tracking-tight text-marine-ink inline">
                {selectedCategory ? phoneTitle : (isAr ? 'كتالوج قطع الغيار والمكونات' : 'Spare Parts & Components Catalog')}
              </h1>
              {list.total > 0 && (
                <span className="ms-3 align-middle font-display text-[11px] font-bold uppercase tracking-[0.08em] text-marine-primary">
                  {list.total.toLocaleString()} {isAr ? 'قطعة متاحة' : 'SKUs Active'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 bg-white border border-marine-teal/15 rounded-lg px-4 py-2.5">
              <span className="w-9 h-9 rounded bg-marine-mist text-marine-primary flex items-center justify-center"><Anchor size={18} /></span>
              <div>
                <div className="flex items-center gap-1.5 font-display text-[10px] font-bold uppercase tracking-[0.08em] text-marine-primary">
                  <span className="w-1.5 h-1.5 rounded-full bg-marine-success" />{isAr ? 'التوصيل للميناء شغّال' : 'Port Delivery Active'}
                </div>
                <div className="text-[11px] text-marine-outline">{isAr ? 'متوسط الشحن: 3.5 ساعة للسويس وموانئ الإسكندرية' : 'Avg. dispatch: 3.5 hrs to Suez & Alex docks'}</div>
              </div>
            </div>
          </div>
          <div className="max-w-2xl mt-5">
            <SearchAutocomplete
              defaultValue={filters.search}
              onSearch={handleKeywordSearch}
              placeholder={t.searchPrompt || (isAr ? 'ابحث بالاسم أو رقم القطعة…' : 'Search by title, OEM part number or vessel model…')}
              formClassName="relative group"
              inputClassName="w-full bg-white border border-marine-teal/20 rounded px-4 py-3 text-sm outline-none focus:border-marine-cyan focus:ring-[3px] focus:ring-marine-cyan/15 transition-all pe-28"
              buttonClassName="absolute end-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5 bg-marine-primary hover:bg-marine-teal text-white font-display text-[11px] font-bold uppercase tracking-[0.06em] px-3 py-2 rounded-sm transition-colors"
              buttonContent={<><Search size={14} />{isAr ? 'بحث' : 'Find Fit'}</>}
            />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 pt-2 pb-6 sm:py-8">
        <div className="flex flex-col lg:flex-row gap-6 sm:gap-8">
          
          {/* Sidebar Toggle (tablet; a phone has the filters button by the search box) */}
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="hidden sm:flex lg:hidden items-center justify-center gap-2 bg-marine-teal text-white font-display text-xs font-bold uppercase tracking-[0.06em] py-3.5 rounded"
          >
            <SlidersHorizontal size={20} />
            <span>{t.showFilters || 'Filters & Categories'}</span>
          </button>

          {/* Sidebar (Desktop) */}
          {isWide && (
            <aside className="w-72 flex-shrink-0">
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
          )}

          {/* Phone and tablet: the filters in a sheet from the bottom. Each choice applies at
              once; the button at the foot shows how many products are left and closes it. */}
          {sheetOpen && (
            <Overlay className="fixed inset-0 z-[110] flex flex-col justify-end" dir={isAr ? 'rtl' : 'ltr'}>
              <button
                type="button"
                aria-label={isAr ? 'إغلاق' : 'Close'}
                onClick={() => setIsSidebarOpen(false)}
                className="absolute inset-0 bg-black/40 animate-in fade-in duration-200"
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-label={t.filters || (isAr ? 'الفلاتر' : 'Filters')}
                className="relative bg-white rounded-t-3xl max-h-[88dvh] flex flex-col shadow-2xl animate-in slide-in-from-bottom duration-200"
              >
                <div className="relative flex justify-center pt-2.5 pb-1">
                  <span className="w-10 h-1.5 rounded-full bg-marine-frost" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => setIsSidebarOpen(false)}
                    aria-label={isAr ? 'إغلاق' : 'Close'}
                    className="absolute end-3 top-2 w-9 h-9 rounded-full bg-marine-mist text-marine-muted flex items-center justify-center"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pt-2 pb-4">
                  <FilterSidebar
                    filters={filters}
                    setFilters={setFilters}
                    language={language}
                    t={t}
                    metadata={metadata}
                    loading={loadingMetadata}
                    error={errorMetadata}
                  />
                </div>
                <div className="border-t border-marine-teal/15 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                  <button
                    type="button"
                    onClick={() => setIsSidebarOpen(false)}
                    className="w-full bg-marine-cyan text-white font-display font-bold uppercase tracking-[0.06em] py-3.5 rounded"
                  >
                    {list.initialLoading
                      ? (isAr ? 'عرض النتائج' : 'Show results')
                      : (isAr ? `عرض ${list.total || 0} منتج` : `Show ${list.total || 0} products`)}
                  </button>
                </div>
              </div>
            </Overlay>
          )}

          {/* Main Grid */}
          <main className="flex-1 min-w-0">
            {/* Subcategory Slider */}
            <SubcategorySlider 
              currentCategoryId={filters.category_id}
              setFilters={setFilters}
              language={language}
              {...categoryCards}
            />

            {/* Save the searched car to the garage — here, after the visitor has seen what
                fits it, rather than in the home page's search box. */}
            <GarageSaveCard car={searchedCar} />

            {/* Toolbar */}
            <div className="hidden sm:flex flex-wrap items-center justify-between gap-4 mb-6 bg-white px-4 py-3 rounded-lg border border-marine-teal/15">
              <div className="flex items-center gap-4">
                <p className="text-xs text-marine-muted">
                  {t.showing || 'Showing'} <span className="font-semibold text-marine-ink">{(products || []).length}</span> {t.of || 'of'} <span className="font-semibold text-marine-ink">{list.total || 0}</span> {t.results || 'results'}
                </p>
                <div className="hidden sm:flex items-center gap-1 border-s border-marine-teal/15 ps-4">
                  <button className="p-1.5 bg-marine-mist rounded-sm text-marine-primary"><LayoutGrid size={16} /></button>
                  <button className="p-1.5 text-marine-outline hover:text-marine-primary"><List size={16} /></button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="font-display text-[10px] font-bold uppercase tracking-[0.08em] text-marine-muted">{t.sortBy || 'Sort By'}:</span>
                <select 
                  value={filters.sort || (filters.search ? 'relevance' : 'featured')}
                  onChange={(e) => {
                    // The default order (best match when searching, else featured) is kept as no sort.
                    const value = e.target.value;
                    const isDefault = value === 'relevance' || value === 'featured';
                    setFilters(prev => ({ ...prev, sort: isDefault ? '' : value, page: 1 }));
                  }}
                  className="bg-marine-canvas border border-marine-teal/20 rounded px-3 py-2 text-sm text-marine-ink outline-none focus:border-marine-cyan focus:ring-[3px] focus:ring-marine-cyan/15"
                >
                  {filters.search
                    ? <option value="relevance">{isAr ? 'الأقرب للبحث' : 'Best match'}</option>
                    : <option value="featured">{isAr ? 'المقترح' : 'Featured'}</option>}
                  <option value="newest">{isAr ? 'الأحدث' : 'Newest First'}</option>
                  <option value="price_low">{isAr ? 'السعر: من الأقل للأعلى' : 'Price: Low to High'}</option>
                  <option value="price_high">{isAr ? 'السعر: من الأعلى للأقل' : 'Price: High to Low'}</option>
                  <option value="rating">{isAr ? 'الأعلى تقييمًا' : 'Top Rated'}</option>
                </select>
              </div>
            </div>

            {/* A signed-in customer's list starts with what fits their garage. */}
            {list.fitFor?.length > 0 && !filters.car_brand_id && (
              <p className="flex items-center gap-2 mb-6 rounded-lg border border-marine-success/25 bg-marine-success/10 px-4 py-3 text-sm font-semibold text-marine-teal">
                <BadgeCheck size={18} className="shrink-0" aria-hidden="true" />
                <span>
                  {isAr ? 'بنعرضلك الأول القطع اللي تناسب مركبك: ' : 'Showing what fits your vessel first: '}
                  {list.fitFor.join(isAr ? '، ' : ', ')}
                </span>
              </p>
            )}

            <InfiniteProductGrid
              list={list}
              isAr={isAr}
              moreHref={`/products?${getQueryFromFilters({ ...filters, page: list.nextPage })}`}
              onRestart={() => setFilters(prev => ({ ...prev, page: 1 }))}
              empty={(
                <div className="text-center py-20 space-y-4">
                  <Search size={48} className="mx-auto text-marine-frost" />
                  <h3 className="font-display text-xl font-semibold text-marine-ink">{isAr ? 'لا توجد منتجات' : 'No products found'}</h3>
                  <p className="text-marine-outline">{isAr ? 'جرّب تغيّر الفلاتر أو كلمة البحث.' : 'Try adjusting your filters or search terms.'}</p>
                  <button
                    onClick={() => setFilters({ page: 1 })}
                    className="text-marine-primary font-bold hover:underline"
                  >
                    {isAr ? 'مسح جميع الفلاتر' : 'Clear all filters'}
                  </button>
                </div>
              )}
            />
            <div className="mt-8"><FitmentGuaranteeBanner /></div>
          </main>
        </div>
      </div>
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-marine-cyan"></div>
      </div>
    }>
      <ProductsContent />
    </Suspense>
  );
}
