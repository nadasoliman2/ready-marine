'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Car, Loader2, Package, Search, SlidersHorizontal, Store, X, Save, Plus, Upload, Table2 } from 'lucide-react';
import { useRouter } from '../../../../lib/navigation';
import { adminApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import ProductTable from '../../../../components/dashboard/ProductTable';
import NestedCategorySelector from '../../../../components/dashboard/NestedCategorySelector';
import PaginationControls from '../../../../components/dashboard/PaginationControls';
import DiscountFields from '../../../../components/dashboard/DiscountFields';
import { validateDiscount } from '../../../../lib/productPricing';
import { partTypeRequiredText } from '../../../../lib/partType';
import PartTypePicker from '../../../../components/dashboard/PartTypePicker';
import usePageSize from '../../../../lib/usePageSize';
import useStoredFilters from '../../../../lib/useStoredFilters';
import { searchOptions } from '../../../../lib/searchSuggest';
import { useLinkedBrandCategory } from '../../../../lib/brandCategoryLink';
import { useBrandModels } from '../../../../lib/carBrandModels';
import Overlay from '../../../../components/Overlay';
import SearchableSelect from '../../../../components/SearchableSelect';
import { brandOptions } from '../../../../lib/pickerOptions';

const inputClass = 'w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white';

export default function AdminProductsPage() {
  const router = useRouter();
  const { language, siteSettings } = useApp();
  const isAr = language === 'ar';
  const [products, setProducts] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, pages: 1 });
  const [vendors, setVendors] = useState([]);
  const [metadata, setMetadata] = useState(null);
  const [productsLoading, setProductsLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  // The text search applies with every letter, from the first one, like the other filters:
  // no pause to wait out. An older answer arriving late is dropped (requestRef).
  const searchTerm = search.trim();
  const [filterCategory, setFilterCategory] = useState('');
  const [filterBrand, setFilterBrand] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [vendorSearch, setVendorSearch] = useState('');
  const [filterVendor, setFilterVendor] = useState('');
  // Compatibility: universal / for specific cars / none set, and a car the product names.
  const [filterFitment, setFilterFitment] = useState('');
  const [filterCar, setFilterCar] = useState({ car_brand_id: '', car_model_id: '', car_year: '' });
  const [editingProduct, setEditingProduct] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('admin.products', 10);
  const requestRef = useRef(0);

  // The search, the filters and the page survive opening a product and coming back.
  const filtersReady = useStoredFilters(
    'admin.products',
    { search: searchTerm, filterCategory, filterBrand, filterStatus, filterVendor, filterFitment, filterCar, page },
    (saved) => {
      setSearch(typeof saved.search === 'string' ? saved.search : '');
      setFilterCategory(saved.filterCategory || '');
      setFilterBrand(saved.filterBrand || '');
      setFilterStatus(saved.filterStatus || '');
      setFilterVendor(saved.filterVendor || '');
      setFilterFitment(saved.filterFitment || '');
      setFilterCar({
        car_brand_id: saved.filterCar?.car_brand_id || '',
        car_model_id: saved.filterCar?.car_model_id || '',
        car_year: saved.filterCar?.car_year || '',
      });
      setPage(Math.max(1, Number(saved.page) || 1));
    },
  );

  // Vendors + filter metadata (categories/brands) load once: they are reference data for
  // the filter row, not the product list itself — so the table no longer waits for them,
  // and only the two lists this page actually draws are asked for. Asking for everything
  // dragged in the car makes as well: 2 MB of JSON, 111,438 model-years, needed by the
  // product FORM and by nothing on this screen.
  useEffect(() => {
    const load = async () => {
      try {
        const [vendorData, metaData] = await Promise.all([
          adminApi.getVendors(),
          // The makes without their models (slim); a make's models load when it is picked.
          adminApi.getFilterMetadata(['categories', 'productBrands', 'carBrands']),
        ]);
        setVendors(vendorData.vendors || []);
        setMetadata(metaData);
      } catch (err) {
        const message = err.message === 'Not Found'
          ? 'Admin products API was not found. Restart the backend server so the new /api/admin/products route is loaded.'
          : err.message || 'Failed to load the filters';
        setError(message);
      }
    };
    load();
  }, []);

  // Permanent delete, from the row's bin icon. Confirmed in words that say what actually
  // happens: orders keep their copy of the product, carts and bundles lose it.
  const deleteProduct = async (id) => {
    const product = products.find((p) => String(p._id) === String(id));
    const title = product?.title_ar || product?.title_en || '';
    const ok = window.confirm(
      isAr
        ? `حذف المنتج "${title}" نهائيًا؟\nالطلبات القديمة هتفضل زي ما هي، لكن المنتج هيتشال من كل السلات والباقات ومش هينفع يرجع.`
        : `Delete "${title}" permanently?\nPast orders keep their copy, but the product is removed from every cart and bundle and cannot be restored.`
    );
    if (!ok) return;
    setError('');
    try {
      await adminApi.deleteProductAdmin(id);
      setProducts((prev) => prev.filter((p) => String(p._id) !== String(id)));
      setPagination((prev) => ({ ...prev, total: Math.max(0, (prev.total || 1) - 1) }));
    } catch (err) {
      setError(err.message || (isAr ? 'تعذر حذف المنتج' : 'Could not delete the product'));
    }
  };

  // The actual product list: filtered, sorted and paginated by the server, not the
  // browser. Used to load every product in the catalog (1,500+ and growing) just to
  // filter and page through them client-side.
  const loadProducts = useCallback(async () => {
    const requestId = ++requestRef.current;
    setProductsLoading(true);
    try {
      const data = await adminApi.getProducts({
        page, limit: pageSize, status: filterStatus,
        category_id: filterCategory, product_brand_id: filterBrand, vendor_id: filterVendor,
        search: searchTerm,
        fitment: filterFitment, ...filterCar,
      });
      if (requestRef.current !== requestId) return;
      setProducts(data.products || []);
      setPagination(data.pagination || { total: 0, pages: 1 });
    } catch (err) {
      if (requestRef.current !== requestId) return;
      setError(err.message || 'Failed to load products');
    } finally {
      if (requestRef.current === requestId) setProductsLoading(false);
    }
  }, [page, pageSize, filterStatus, filterCategory, filterBrand, filterVendor, searchTerm, filterFitment, filterCar]);

  useEffect(() => { if (filtersReady) loadProducts(); }, [filtersReady, loadProducts]);

  // Category and brand filters narrow each other (lib/brandCategoryLink).
  const linkedFilters = useLinkedBrandCategory({
    brands: metadata?.productBrands || [],
    categories: metadata?.categories || [],
    brandId: filterBrand,
    categoryId: filterCategory,
    setBrandId: setFilterBrand,
    setCategoryId: setFilterCategory,
  });
  const flatCategories = useMemo(() => flattenCategories(linkedFilters.categories || []), [linkedFilters.categories]);

  // Best match first; each typed word has to start a word (lib/searchSuggest).
  const vendorOptions = useMemo(
    () => searchOptions(vendors, vendorSearch, (vendor) => [vendor.store_name, vendor.store_username, vendor.email, vendor.phone]),
    [vendors, vendorSearch],
  );

  // A changed filter starts again at page 1 — but not the filters arriving from last time,
  // which come with the page they were left on.
  const filterSignature = JSON.stringify([searchTerm, filterCategory, filterBrand, filterVendor, filterStatus, filterFitment, filterCar]);
  const lastSignatureRef = useRef(null);
  useEffect(() => {
    if (!filtersReady) return;
    if (lastSignatureRef.current !== null && lastSignatureRef.current !== filterSignature) setPage(1);
    lastSignatureRef.current = filterSignature;
  }, [filtersReady, filterSignature]);

  const carBrand = (metadata?.carBrands || []).find((b) => String(b._id) === String(filterCar.car_brand_id));
  const carModels = useBrandModels(carBrand);
  const carModel = carModels.find((m) => String(m._id) === String(filterCar.car_model_id));

  const handleProductUpdated = (updatedProduct) => {
    setProducts(prev => prev.map(product => product._id === updatedProduct._id ? updatedProduct : product));
  };

  const paginationProps = {
    page,
    pageSize,
    onPageSizeChange: (n) => { setPageSize(n); setPage(1); },
    total: pagination.total,
    onPageChange: setPage,
    labels: {
      showing: isAr ? 'عرض' : 'Showing',
      of: isAr ? 'من' : 'of',
      previous: isAr ? 'الصفحة السابقة' : 'Previous page',
      next: isAr ? 'الصفحة التالية' : 'Next page',
    },
  };

  return (
    <div className="h-full flex flex-col animate-in fade-in duration-300">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-wide">
            {isAr ? 'إدارة المنتجات' : 'Products'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {isAr ? 'عرض وتعديل منتجات كل التجار.' : 'View and edit products across all vendors.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MiniStat label={isAr ? 'عدد المنتجات' : 'Products'} value={pagination.total} />
          <button
            onClick={() => router.push('/admin/dashboard/products/bulk-upload')}
            className="border border-marine-cyan text-marine-primary hover:bg-marine-cyan/10 px-4 py-2.5 rounded-lg text-sm font-bold shadow-sm transition-colors flex items-center gap-2"
          >
            <Upload size={18} /> {isAr ? 'رفع جماعي بالإكسل' : 'Bulk Excel Upload'}
          </button>
          <button
            onClick={() => router.push('/admin/dashboard/products/bulk-entry')}
            className="border border-marine-cyan text-marine-primary hover:bg-marine-cyan/10 px-4 py-2.5 rounded-lg text-sm font-bold shadow-sm transition-colors flex items-center gap-2"
          >
            <Table2 size={18} /> {isAr ? 'رفع جماعي أونلاين' : 'Bulk Online Upload'}
          </button>
          <button
            onClick={() => router.push('/admin/dashboard/add-product')}
            className="bg-marine-cyan hover:bg-marine-cyan-dark text-white px-4 py-2.5 rounded-lg text-sm font-bold shadow-sm transition-colors flex items-center gap-2"
          >
            <Plus size={18} /> {isAr ? 'إضافة منتج' : 'Add Product'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-bold mb-6">
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-[#14171A] rounded-xl shadow-sm border border-zinc-200 dark:border-white/5 p-3 mb-6 space-y-3 overflow-visible">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-zinc-400 px-1">
          <SlidersHorizontal size={15} />
          {isAr ? 'الفلاتر' : 'Filters'}
          {productsLoading && <Loader2 size={13} className="animate-spin text-marine-primary" />}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr] gap-3">
          <div className="relative">
            <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder={isAr ? 'ابحث بالعنوان، SKU، أو رقم القطعة' : 'Search title, SKU, or part number'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/5 rounded-lg ps-9 pe-3 py-2 text-sm focus:outline-none focus:border-marine-cyan dark:text-white"
            />
          </div>

          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} className={inputClass}>
            <option value="">{isAr ? 'كل الفئات' : 'All Categories'}</option>
            {flatCategories.map(cat => (
              <option key={cat._id} value={cat._id}>
                {'\u00A0\u00A0'.repeat(cat.level)}{language === 'ar' ? (cat.name_ar || cat.name) : (cat.name_en || cat.name)}
              </option>
            ))}
          </select>

          <SearchableSelect value={filterBrand} onChange={setFilterBrand} options={brandOptions(linkedFilters.brands)} placeholder={isAr ? 'كل العلامات' : 'All Brands'} isAr={isAr} buttonClassName={inputClass} />

          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={inputClass}>
            <option value="">{isAr ? 'كل الحالات' : 'All Statuses'}</option>
            <option value="pending">{isAr ? 'معلق' : 'Pending'}</option>
            <option value="draft">{isAr ? 'مسودة' : 'Draft'}</option>
            <option value="published">{isAr ? 'منشور' : 'Published'}</option>
          </select>

          <VendorSearchSelect
            vendors={vendorOptions}
            selectedVendorId={filterVendor}
            search={vendorSearch}
            onSearchChange={setVendorSearch}
            onSelect={setFilterVendor}
            allVendors={vendors}
            isAr={isAr}
          />
        </div>

        {/* Compatibility */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[auto_1fr_1fr_1fr_1fr] gap-3 items-center">
          <span className="hidden lg:flex items-center gap-1.5 text-xs font-bold text-zinc-500 px-1">
            <Car size={14} /> {isAr ? 'التوافق' : 'Fitment'}
          </span>
          <select value={filterFitment} onChange={e => setFilterFitment(e.target.value)} className={inputClass}>
            <option value="">{isAr ? 'كل أنواع التوافق' : 'Any fitment'}</option>
            <option value="universal">{isAr ? 'عام (يناسب أي عربية)' : 'Universal (fits any car)'}</option>
            <option value="specific">{isAr ? 'لعربيات محددة' : 'For specific cars'}</option>
            <option value="none">{isAr ? 'من غير توافق متسجّل' : 'No fitment set'}</option>
          </select>
          {/* Searchable, the makes with their logos; the placeholder clears the choice. */}
          <SearchableSelect
            value={filterCar.car_brand_id}
            onChange={(v) => setFilterCar({ car_brand_id: v, car_model_id: '', car_year: '' })}
            options={(metadata?.carBrands || []).map(b => ({ value: b._id, label: b.name, keywords: (b.name_aliases || []).join(' '), image: b.image }))}
            placeholder={isAr ? 'كل الماركات' : 'Any car make'}
            isAr={isAr}
            buttonClassName={inputClass}
          />
          <SearchableSelect
            value={filterCar.car_model_id}
            onChange={(v) => setFilterCar(prev => ({ ...prev, car_model_id: v, car_year: '' }))}
            options={carModels.map(m => ({ value: m._id, label: m.name }))}
            placeholder={isAr ? 'كل الموديلات' : 'Any model'}
            disabled={!filterCar.car_brand_id}
            isAr={isAr}
            buttonClassName={inputClass}
          />
          <SearchableSelect
            value={filterCar.car_year}
            onChange={(v) => setFilterCar(prev => ({ ...prev, car_year: v }))}
            options={(carModel?.years || []).map(y => ({ value: String(y.year), label: String(y.year) }))}
            placeholder={isAr ? 'كل السنين' : 'Any year'}
            disabled={!filterCar.car_model_id}
            isAr={isAr}
            buttonClassName={inputClass}
          />
        </div>
      </div>

      <div className="rounded-xl overflow-hidden border border-zinc-200 dark:border-white/5">
        {/* The same bar as under the table: with many rows on a page, the next page is
            reachable without scrolling past all of them. */}
        <PaginationControls placement="top" {...paginationProps} />
        {/* First load only: the table's own "no products found" would otherwise flash
            before the first page of results arrives. */}
        {productsLoading && products.length === 0 ? (
          <div className="bg-white dark:bg-[#14171A] py-16 flex items-center justify-center">
            <Loader2 size={28} className="animate-spin text-marine-primary" />
          </div>
        ) : (
        // While the next results load, the rows on screen are the previous search's: they are
        // about to be replaced, so a click now would land on whatever row moves under it and
        // open the wrong product. They wait, dimmed, until the new rows are in.
        <div aria-busy={productsLoading} className={productsLoading ? 'opacity-50 pointer-events-none transition-opacity' : 'transition-opacity'}>
        <ProductTable
          products={products}
          language={language}
          onEdit={(product) => router.push(`/admin/dashboard/products/${product._id}/edit`)}
          onDelete={deleteProduct}
          updateProduct={(id, data) => adminApi.updateProduct(id, data).then(res => {
            handleProductUpdated(res.product);
            return res;
          })}
          reviewBasePath="/admin/dashboard/products"
          showVendor
          categories={metadata?.categories || null}
          // Every make with its models, for the fitment popup: fetched the first time it opens.
          loadCarBrands={() => adminApi.getFilterMetadata(['carBrands'], { detail: 'full' }).then((m) => m.carBrands || [])}
        />
        </div>
        )}
        <PaginationControls {...paginationProps} />
      </div>

      {editingProduct && (
        <ProductEditModal
          product={editingProduct}
          metadata={metadata}
          language={language}
          currency={siteSettings?.currency || 'QAR'}
          onClose={() => setEditingProduct(null)}
          onSaved={(product) => {
            handleProductUpdated(product);
            setEditingProduct(null);
          }}
        />
      )}
    </div>
  );
}

function VendorSearchSelect({ vendors, selectedVendorId, search, onSearchChange, onSelect, allVendors, isAr }) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const selectedVendor = allVendors.find(vendor => String(vendor._id) === String(selectedVendorId));

  return (
    <div className="relative" onBlur={() => setTimeout(() => setOpen(false), 120)}>
      <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400 z-10" />
      <input
        ref={inputRef}
        value={open ? search : (selectedVendor ? `${selectedVendor.store_name} (@${selectedVendor.store_username})` : search)}
        onFocus={() => setOpen(true)}
        onChange={e => {
          onSearchChange(e.target.value);
          setOpen(true);
          if (selectedVendorId) onSelect('');
        }}
        placeholder={isAr ? 'فلتر البائع: المتجر، المستخدم، البريد، الهاتف' : 'Vendor filter: store, username, email, phone'}
        className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg ps-9 pe-9 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white"
      />
      {(selectedVendorId || search) && (
        <button
          type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={() => {
            onSelect('');
            onSearchChange('');
            setOpen(false);
          }}
          className="absolute end-2 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded-md text-zinc-400 hover:text-red-500"
          aria-label={isAr ? 'مسح فلتر البائع' : 'Clear vendor filter'}
        >
          <X size={15} />
        </button>
      )}
      {open && (
        <div className="absolute z-40 mt-2 w-full max-h-72 overflow-y-auto rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#14171A] shadow-xl">
          <button
            type="button"
            onMouseDown={e => e.preventDefault()}
            onClick={() => {
              onSelect('');
              onSearchChange('');
              setOpen(false);
            }}
            className="w-full text-start px-4 py-3 text-sm font-bold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5"
          >
            {isAr ? 'كل التجار' : 'All Vendors'}
          </button>
          {vendors.map(vendor => (
            <button
              key={vendor._id}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                onSelect(vendor._id);
                onSearchChange('');
                setOpen(false);
                // Leave the box, so coming back to it opens the list on an empty search —
                // typing straight after a pick would otherwise add to the chosen name.
                inputRef.current?.blur();
              }}
              className={`w-full text-start px-4 py-3 hover:bg-red-50 dark:hover:bg-marine-cyan/10 border-t border-zinc-100 dark:border-white/5 ${String(selectedVendorId) === String(vendor._id) ? 'bg-red-50 dark:bg-marine-cyan/10' : ''}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-zinc-900 dark:text-white">{vendor.store_name}</p>
                  <p className="text-xs text-zinc-500">@{vendor.store_username} · {vendor.email}</p>
                </div>
                <span className="text-xs font-bold text-zinc-400" dir="ltr">{vendor.phone}</span>
              </div>
            </button>
          ))}
          {vendors.length === 0 && (
            <div className="px-4 py-6 text-center text-sm font-bold text-zinc-500">
              {isAr ? 'لا يوجد تجار مطابقون' : 'No vendors match these filters'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProductEditModal({ product, metadata, language, currency, onClose, onSaved }) {
  const isAr = language === 'ar';
  const [partTypeInvalid, setPartTypeInvalid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    title_en: product.title_en || '',
    title_ar: product.title_ar || '',
    subtitle_en: product.subtitle_en || '',
    subtitle_ar: product.subtitle_ar || '',
    sku: product.sku || '',
    part_number: product.part_number || '',
    gtin: product.gtin || '',
    // Empty on a product saved before the field existed: the form asks for it.
    part_type: product.part_type || '',
    price: product.price ?? '',
    discount_type: product.discount_type || '',
    discount_value: product.discount_value ?? '',
    status: product.status || 'draft',
    category_id: product.category_id?._id || product.category_id || '',
    product_brand_id: product.product_brand_id?._id || product.product_brand_id || '',
    stock_management: product.stock_management ?? true,
    quantity: product.quantity ?? 0,
  });
  // Brand and category narrow each other; changing one clears the other if it no longer fits.
  const linkedForm = useLinkedBrandCategory({
    brands: metadata?.productBrands || [],
    categories: metadata?.categories || [],
    brandId: form.product_brand_id,
    categoryId: form.category_id,
    setBrandId: (id) => setForm(prev => ({ ...prev, product_brand_id: id })),
    setCategoryId: (id) => setForm(prev => ({ ...prev, category_id: id })),
  });

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      if (!form.part_type) {
        setPartTypeInvalid(true);
        throw new Error(partTypeRequiredText(isAr));
      }
      const discountError = validateDiscount(form.price, form.discount_type || null, form.discount_value, isAr);
      if (discountError) throw new Error(discountError);

      const payload = {
        ...form,
        price: Number(form.price),
        discount_type: form.discount_type || null,
        discount_value: form.discount_type && form.discount_value !== '' ? Number(form.discount_value) : null,
        quantity: form.quantity === '' ? null : Number(form.quantity),
      };
      const data = await adminApi.updateProduct(product._id, payload);
      onSaved(data.product);
    } catch (err) {
      setError(err.message || 'Failed to update product');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Overlay className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-4xl bg-white dark:bg-[#14171A] rounded-2xl border border-zinc-200 dark:border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-zinc-100 dark:border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-red-50 dark:bg-marine-cyan/10 text-marine-primary flex items-center justify-center">
              <Package size={22} />
            </div>
            <div>
              <h2 className="text-lg font-black text-zinc-900 dark:text-white">{isAr ? 'تعديل المنتج' : 'Edit Product'}</h2>
              <p className="text-xs text-zinc-500 mt-1">
                <Store size={12} className="inline me-1" />
                {product.vendor_id?.store_name || 'Unknown vendor'} @{product.vendor_id?.store_username || '-'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-xl hover:bg-zinc-50 dark:hover:bg-white/5">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={save} className="p-5 space-y-5">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-3 rounded-xl text-sm font-bold">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Title (EN)" value={form.title_en} onChange={value => setForm({ ...form, title_en: value })} />
            <Field label="Title (AR)" value={form.title_ar} onChange={value => setForm({ ...form, title_ar: value })} dir="rtl" />
            <Field label="Subtitle (EN)" value={form.subtitle_en} onChange={value => setForm({ ...form, subtitle_en: value })} />
            <Field label="Subtitle (AR)" value={form.subtitle_ar} onChange={value => setForm({ ...form, subtitle_ar: value })} dir="rtl" />
            <div className="md:col-span-2">
              <PartTypePicker value={form.part_type} onChange={(v) => setForm({ ...form, part_type: v })} isAr={isAr} invalid={partTypeInvalid} />
            </div>
            <Field label="SKU" value={form.sku} onChange={value => setForm({ ...form, sku: value })} />
            <Field label="Part Number" value={form.part_number} onChange={value => setForm({ ...form, part_number: value })} required={false} />
            <Field label="GTIN" value={form.gtin} onChange={value => setForm({ ...form, gtin: value })} required={false} />
            <label className="block">
              <span className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">{isAr ? 'الحالة' : 'Status'}</span>
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className={inputClass}>
                <option value="draft">{isAr ? 'مسودة' : 'Draft'}</option>
                <option value="published">{isAr ? 'منشور' : 'Published'}</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">{isAr ? 'العلامة' : 'Brand'}</span>
              <SearchableSelect value={form.product_brand_id} onChange={(v) => setForm({ ...form, product_brand_id: v })} options={brandOptions(linkedForm.brands)} placeholder={isAr ? 'اختر علامة' : 'Select Brand'} isAr={isAr} buttonClassName={inputClass} />
            </label>
            <label className="block">
              <span className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">{isAr ? 'الفئة' : 'Category'}</span>
              <NestedCategorySelector categories={metadata?.categories || []} allowedIds={linkedForm.allowedCategoryIds} initialValue={form.category_id} onChange={categoryId => setForm({ ...form, category_id: categoryId })} />
            </label>
            <Field label={`${isAr ? 'السعر' : 'Price'} (${currency})`} type="number" value={form.price} onChange={value => setForm({ ...form, price: value })} />
            <DiscountFields form={form} setForm={setForm} isAr={isAr} labelCls="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2" inputCls={inputClass} />
            <Field label={isAr ? 'الكمية' : 'Quantity'} type="number" value={form.quantity} onChange={value => setForm({ ...form, quantity: value })} required={false} />
            <label className="flex items-center gap-3 pt-7 text-sm font-bold text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={form.stock_management} onChange={e => setForm({ ...form, stock_management: e.target.checked })} className="accent-marine-cyan" />
              {isAr ? 'تتبع المخزون' : 'Track stock'}
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 font-bold">
              {isAr ? 'إلغاء' : 'Cancel'}
            </button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 text-white rounded-xl font-bold">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {isAr ? 'حفظ المنتج' : 'Save Product'}
            </button>
          </div>
        </form>
      </div>
    </Overlay>
  );
}

function Field({ label, value, onChange, type = 'text', dir, required = true }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">{label}</span>
      <input
        required={required}
        type={type}
        min={type === 'number' ? '0' : undefined}
        step={type === 'number' ? '0.01' : undefined}
        value={value}
        dir={dir}
        onChange={e => onChange(e.target.value)}
        className={inputClass}
      />
    </label>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-xl px-4 py-3 min-w-[140px]">
      <p className="text-xs font-bold text-zinc-500">{label}</p>
      <p className="text-xl font-black text-zinc-900 dark:text-white">{value}</p>
    </div>
  );
}

function flattenCategories(cats, level = 0) {
  let result = [];
  cats.forEach(cat => {
    result.push({ ...cat, level });
    if (cat.subcategories && cat.subcategories.length > 0) {
      result = result.concat(flattenCategories(cat.subcategories, level + 1));
    }
  });
  return result;
}
