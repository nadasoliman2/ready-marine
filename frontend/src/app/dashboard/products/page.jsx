'use client';

import { useState, useEffect, useMemo, useRef, Suspense } from 'react';
import { vendorApi } from '../../../lib/api';
import { Plus, Loader2, Upload, Table2, Search, X, Clock, CheckCircle2 } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import ProductTable from '../../../components/dashboard/ProductTable';
import { resolveAssetUrl } from '../../../lib/assets';
import { useRouter, useSearchParams } from '../../../lib/navigation';
import { useLinkedBrandCategory } from '../../../lib/brandCategoryLink';
import SearchableSelect from '../../../components/SearchableSelect';
import { brandOptions } from '../../../lib/pickerOptions';

/**
 * Fold the spellings Arabic treats as the same word.
 *
 * A literal substring match makes searching an Arabic catalogue feel broken:
 * "فلتر زيت" typed with a bare alef never finds a title written with hamza,
 * and "فلتره" never finds "فلترة" — both are the same word to the person
 * typing. Tashkeel and tatweel are decoration and are dropped for the same
 * reason. Latin text is unaffected beyond lowercasing.
 */
const foldForSearch = (value) => String(value || '')
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0624/g, '\u0648')
    .replace(/\u0626/g, '\u064A')
    .trim();

/** Does this product answer to what was typed? Title in either language, or SKU. */
const productMatchesQuery = (product, folded) => {
    if (!folded) return true;
    return foldForSearch(product.title_en).includes(folded)
        || foldForSearch(product.title_ar).includes(folded)
        || foldForSearch(product.sku).includes(folded);
};

const MAX_SUGGESTIONS = 8;

function ProductsManagementContent() {
  const { language } = useApp();
  const isAr = language === 'ar';
  const [products, setProducts] = useState([]);
  const [metadata, setMetadata] = useState(null);
  const [loading, setLoading] = useState(true);
  
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlSearch = searchParams.get('search');
  const statusNotice = searchParams.get('status_notice');
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  
  // Ribbon Filters
  const [search, setSearch] = useState(urlSearch || '');

  useEffect(() => {
    if (urlSearch !== null && urlSearch !== undefined) setSearch(urlSearch);
  }, [urlSearch]);
  // Auto-complete on the name/SKU box. A vendor with hundreds of products
  // knows the name but not where it sits in the list, so the box suggests as
  // they type instead of making them scan the table.
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const searchBoxRef = useRef(null);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterBrand, setFilterBrand] = useState('');

  // Combine hand-entered product brands and boat/vessel brands so both are available in filters.
  const combinedBrands = useMemo(() => {
    const prodBrands = metadata?.productBrands || [];
    const boatBrands = (metadata?.vesselBrands || metadata?.carBrands || []).map(cb => ({
      ...cb,
      source: 'VesselBrand',
      is_vessel_brand: true,
      categories: cb.categories || []
    }));
    const seenIds = new Set();
    const seenNames = new Set();
    const list = [];
    for (const b of [...prodBrands, ...boatBrands]) {
      const id = String(b._id || '');
      const name = String(b.name || '').trim().toLowerCase();
      if (id && seenIds.has(id)) continue;
      if (name && seenNames.has(name)) continue;
      if (id) seenIds.add(id);
      if (name) seenNames.add(name);
      list.push(b);
    }
    return list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
  }, [metadata?.productBrands, metadata?.carBrands]);

  // Category and brand filters narrow each other (lib/brandCategoryLink).
  const linkedFilters = useLinkedBrandCategory({
    brands: combinedBrands,
    categories: metadata?.categories || [],
    brandId: filterBrand,
    categoryId: filterCategory,
    setBrandId: setFilterBrand,
    setCategoryId: setFilterCategory,
  });
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPhotos, setFilterPhotos] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [prodData, metaRes] = await Promise.all([
          vendorApi.getProducts(),
          fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:2000/api'}/products/filters`)
        ]);
        const metaData = await metaRes.json();
        setProducts(prodData);
        setMetadata(metaData);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleDelete = async (id) => {
    if (!confirm(isAr ? 'هل أنت متأكد من حذف هذا المنتج؟' : 'Are you sure you want to delete this product?')) return;
    try {
      await vendorApi.deleteProduct(id);
      setProducts(p => p.filter(x => x._id !== id));
    } catch (err) {
      alert(isAr ? 'تعذر حذف المنتج.' : 'Failed to delete product.');
    }
  };

  const flattenCategories = (cats, level = 0) => {
    let result = [];
    cats.forEach(c => {
      result.push({ ...c, level });
      if (c.subcategories && c.subcategories.length > 0) {
        result = result.concat(flattenCategories(c.subcategories, level + 1));
      }
    });
    return result;
  };

  const checkCategoryMatch = (productCatId, selectedCatId) => {
    if (!selectedCatId) return true;
    if (!productCatId) return false;
    
    // exact match
    if (String(productCatId._id) === String(selectedCatId)) return true;
    
    // check if product category is a child of selected category
    let current = productCatId;
    while (current.parent_id) {
      if (typeof current.parent_id === 'object') {
        if (String(current.parent_id._id) === String(selectedCatId)) return true;
        current = current.parent_id;
      } else {
        if (String(current.parent_id) === String(selectedCatId)) return true;
        break;
      }
    }
    return false;
  };

  const filteredProducts = products.filter(p => {
    let match = true;

    if (search) {
      match = match && productMatchesQuery(p, foldForSearch(search));
    }

    if (filterCategory) {
      match = match && checkCategoryMatch(p.category_id, filterCategory);
    }

    if (filterBrand) {
      match = match && String(p.product_brand_id?._id) === String(filterBrand);
    }

    if (filterStatus) {
      match = match && p.status === filterStatus;
    }

    if (filterPhotos) {
      const hasPhotos = (Array.isArray(p.images) && p.images.some(img => typeof img === 'string' ? !!img : !!img?.url)) || !!p.image;
      match = match && (filterPhotos === 'uploaded' ? hasPhotos : !hasPhotos);
    }

    return match;
  });

  // Suggestions answer the query alone — the other ribbon filters deliberately
  // do not narrow them, so a product hidden by a stale category filter is still
  // findable by name instead of silently missing.
  const suggestions = useMemo(() => {
    const folded = foldForSearch(search);
    if (!folded) return [];
    return products.filter((p) => productMatchesQuery(p, folded)).slice(0, MAX_SUGGESTIONS);
  }, [products, search]);

  // Close on a click anywhere else, the one behaviour a dropdown cannot do
  // without listening outside itself.
  useEffect(() => {
    if (!suggestOpen) return;
    const onPointerDown = (event) => {
      if (!searchBoxRef.current?.contains(event.target)) setSuggestOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [suggestOpen]);

  const productLabel = (p) => (isAr ? (p.title_ar || p.title_en) : (p.title_en || p.title_ar)) || (isAr ? 'بدون اسم' : 'Untitled');

  const productThumb = (p) => {
    const first = Array.isArray(p.images) ? p.images[0] : null;
    const url = typeof first === 'string' ? first : first?.url;
    return resolveAssetUrl(url || p.image || '');
  };

  /** Picking a suggestion narrows the table to it — the row is where the work is. */
  const chooseSuggestion = (product) => {
    setSearch(productLabel(product));
    setSuggestOpen(false);
    setActiveSuggestion(-1);
  };

  const onSearchKeyDown = (event) => {
    if (!suggestOpen || suggestions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveSuggestion((i) => (i + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveSuggestion((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === 'Enter') {
      if (activeSuggestion >= 0) {
        event.preventDefault();
        chooseSuggestion(suggestions[activeSuggestion]);
      } else {
        setSuggestOpen(false);
      }
    } else if (event.key === 'Escape') {
      setSuggestOpen(false);
      setActiveSuggestion(-1);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-marine-primary" />
      </div>
    );
  }

  const flatCats = flattenCategories(linkedFilters.categories || []);

  return (
    <div className="h-full flex flex-col animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">{isAr ? 'المنتجات' : 'Products'}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{isAr ? 'إدارة الكتالوج والمخزون والتوافق.' : 'Manage your catalog, inventory, and compatibility.'}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/dashboard/products/bulk-upload')}
            className="border border-marine-cyan text-marine-primary hover:bg-marine-cyan/10 px-4 py-2.5 rounded-lg text-sm font-bold shadow-sm transition-colors flex items-center gap-2"
          >
            <Upload size={18} /> {isAr ? 'رفع جماعي عبر Excel' : 'Bulk Excel Upload'}
          </button>
          <button
            onClick={() => router.push('/dashboard/products/bulk-entry')}
            className="border border-marine-cyan text-marine-primary hover:bg-marine-cyan/10 px-4 py-2.5 rounded-lg text-sm font-bold shadow-sm transition-colors flex items-center gap-2"
          >
            <Table2 size={18} /> {isAr ? 'إدخال جماعي مباشر' : 'Bulk Online Upload'}
          </button>
          <button 
            onClick={() => router.push('/dashboard/products/add')}
            className="bg-marine-cyan hover:bg-marine-cyan-dark text-white px-4 py-2.5 rounded-lg text-sm font-bold shadow-sm transition-colors flex items-center gap-2"
          >
            <Plus size={18} /> {isAr ? 'منتج جديد' : 'New Product'}
          </button>
        </div>
      </div>

      {/* Status Notice Banner */}
      {!noticeDismissed && statusNotice === 'pending' && (
        <div className="mb-6 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 flex items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
              <Clock size={20} className="text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h4 className="font-bold text-sm">{isAr ? 'تم إرسال المنتج للمراجعة بنجاح' : 'Product Submitted for Review'}</h4>
              <p className="text-xs opacity-90 mt-0.5">
                {isAr
                  ? 'المنتج الآن قيد المراجعة من قِبل إدارة Ready Marine. ستجده أدناه بالحالة "قيد المراجعة" وسيُنشر في المتجر فور اعتماده.'
                  : 'Your product is currently under review by Ready Marine admin. It is listed below as "Pending Review" and will appear in the shop once approved.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setNoticeDismissed(true)}
            className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg text-xs font-bold transition-colors shrink-0"
          >
            {isAr ? 'إغلاق' : 'Close'}
          </button>
        </div>
      )}

      {!noticeDismissed && statusNotice === 'published' && (
        <div className="mb-6 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 flex items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
              <CheckCircle2 size={20} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h4 className="font-bold text-sm">{isAr ? 'تم نشر المنتج بنجاح' : 'Product Published Successfully'}</h4>
              <p className="text-xs opacity-90 mt-0.5">
                {isAr ? 'تمت إضافة المنتج ونشره مباشرة في متجرك.' : 'Your product has been published directly to your store.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setNoticeDismissed(true)}
            className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg text-xs font-bold transition-colors shrink-0"
          >
            {isAr ? 'إغلاق' : 'Close'}
          </button>
        </div>
      )}

      {/* Ribbon Filters */}
      <div className="flex flex-wrap gap-3 mb-6 bg-white dark:bg-[#14171A] p-2 rounded-xl shadow-sm border border-zinc-200 dark:border-white/5">
        <div ref={searchBoxRef} className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-zinc-400 pointer-events-none" />
          <input
            type="text"
            role="combobox"
            aria-expanded={suggestOpen && suggestions.length > 0}
            aria-autocomplete="list"
            autoComplete="off"
            placeholder={isAr ? 'ابحث بالاسم أو SKU...' : 'Search by name or SKU...'}
            value={search}
            onChange={e => { setSearch(e.target.value); setSuggestOpen(true); setActiveSuggestion(-1); }}
            onFocus={() => setSuggestOpen(true)}
            onKeyDown={onSearchKeyDown}
            className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/5 rounded-lg ps-9 pe-8 py-2 text-sm focus:outline-none focus:border-marine-cyan"
          />
          {search && (
            <button
              type="button"
              onClick={() => { setSearch(''); setSuggestOpen(false); setActiveSuggestion(-1); }}
              aria-label={isAr ? 'مسح البحث' : 'Clear search'}
              className="absolute top-1/2 -translate-y-1/2 end-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            >
              <X size={14} />
            </button>
          )}

          {suggestOpen && suggestions.length > 0 && (
            <ul
              role="listbox"
              className="absolute z-30 top-full mt-1 w-full max-h-80 overflow-y-auto bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/10 rounded-lg shadow-lg py-1"
            >
              {suggestions.map((p, index) => (
                <li key={p._id} role="option" aria-selected={index === activeSuggestion}>
                  <button
                    type="button"
                    // mousedown, not click: the input's blur would otherwise
                    // close the list before the click ever lands.
                    onMouseDown={(e) => { e.preventDefault(); chooseSuggestion(p); }}
                    onMouseEnter={() => setActiveSuggestion(index)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-start transition-colors ${
                      index === activeSuggestion ? 'bg-zinc-100 dark:bg-white/5' : ''
                    }`}
                  >
                    {productThumb(p) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={productThumb(p)} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0 bg-zinc-100 dark:bg-white/5" />
                    ) : (
                      <span className="w-8 h-8 rounded bg-zinc-100 dark:bg-white/5 flex-shrink-0" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-zinc-900 dark:text-white">{productLabel(p)}</span>
                      <span className="block truncate text-[11px] text-zinc-500">{p.sku}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <select 
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/5 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-marine-cyan"
        >
          <option value="">{isAr ? 'كل الفئات' : 'All Categories'}</option>
          {flatCats.map(cat => (
             <option key={cat._id} value={cat._id}>
               {"\u00A0\u00A0".repeat(cat.level)}{language === 'ar' ? (cat.name_ar || cat.name) : (cat.name_en || cat.name)}
             </option>
          ))}
        </select>
        <SearchableSelect value={filterBrand} onChange={setFilterBrand} options={brandOptions(linkedFilters.brands)} placeholder={isAr ? 'كل الماركات' : 'All Brands'} isAr={isAr} buttonClassName={"bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/5 rounded-lg ps-3 pe-9 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-marine-cyan"} className="sm:max-w-[220px]" />
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/5 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-marine-cyan"
        >
          <option value="">{language === 'ar' ? 'كل الحالات' : 'All Statuses'}</option>
          <option value="published">{language === 'ar' ? 'منشور' : 'Published'}</option>
          <option value="pending">{language === 'ar' ? 'قيد المراجعة' : 'Pending'}</option>
          <option value="draft">{language === 'ar' ? 'مسودة' : 'Draft'}</option>
          <option value="rejected">{language === 'ar' ? 'مرفوض' : 'Rejected'}</option>
        </select>
        <select
          value={filterPhotos}
          onChange={e => setFilterPhotos(e.target.value)}
          className="bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/5 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-marine-cyan"
        >
          <option value="">{language === 'ar' ? 'كل الصور' : 'All Photos'}</option>
          <option value="uploaded">{language === 'ar' ? 'بها صور' : 'Photos Uploaded'}</option>
          <option value="missing">{language === 'ar' ? 'بدون صور' : 'No Photos'}</option>
        </select>
      </div>

      {/* Main Table Content */}
      <ProductTable 
        key={filteredProducts.map(p => p._id + p.status).join(',')}
        products={filteredProducts} 
        language={language}
        onEdit={(prod) => router.push(`/dashboard/products/${prod._id}/edit`)}
        onDelete={handleDelete}
        onUpdate={(saved) => {
          setProducts(prev => prev.map(p => p._id === saved._id ? { ...p, ...saved } : p));
        }}
      />
    </div>
  );
}

export default function ProductsManagementPage() {
  return (
    <Suspense fallback={<div className="h-full flex items-center justify-center"><Loader2 size={32} className="animate-spin text-marine-primary" /></div>}>
      <ProductsManagementContent />
    </Suspense>
  );
}
