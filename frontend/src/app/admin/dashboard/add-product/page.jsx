'use client';

import { useEffect, useState } from 'react';
import { useRouter } from '../../../../lib/navigation';
import {
  ArrowLeft, Save, Send, Loader2, Info, Search, X, CheckCircle2, PlusCircle
} from 'lucide-react';
import { adminApi } from '../../../../lib/api';
import { searchOptions } from '../../../../lib/searchSuggest';
import { useApp } from '../../../../context/AppContext';
import AudiencePicker from '../../../../components/dashboard/AudiencePicker';
import NestedCategorySelector from '../../../../components/dashboard/NestedCategorySelector';
import ImageUploader from '../../../../components/dashboard/ImageUploader';
import CompatibilityBuilder from '../../../../components/dashboard/CompatibilityBuilder';
import VariationBuilder from '../../../../components/dashboard/VariationBuilder';
import ProductShippingFields from '../../../../components/dashboard/ProductShippingFields';
import DiscountFields from '../../../../components/dashboard/DiscountFields';
import { validateDiscount } from '../../../../lib/productPricing';
import { partTypeRequiredText } from '../../../../lib/partType';
import PartTypePicker from '../../../../components/dashboard/PartTypePicker';
import Link from '../../../../components/LocaleLink';
import { useLinkedBrandCategory } from '../../../../lib/brandCategoryLink';
import SearchableSelect from '../../../../components/SearchableSelect';
import { brandOptions } from '../../../../lib/pickerOptions';

export default function AdminAddProductPage() {
  const router = useRouter();
  const { language, t, siteSettings } = useApp();
  const isAr = language === 'ar';
  const currency = siteSettings?.currency || 'QAR';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [metadata, setMetadata] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [vendorSearch, setVendorSearch] = useState('');
  const [showVendorDropdown, setShowVendorDropdown] = useState(false);
  const [savingStatus, setSavingStatus] = useState(null); // 'draft' | 'published' | null
  const [partTypeInvalid, setPartTypeInvalid] = useState(false);

  const [form, setForm] = useState({
    vendor_id: '',
    title_en: '', title_ar: '',
    subtitle_en: '', subtitle_ar: '',
    description_en: '', description_ar: '',
    sku: '',
    part_number: '', gtin: '',
    // Original / OEM / Aftermarket — required (lib/partType).
    part_type: '',
    price: '', discount_type: '', discount_value: '',
    category_id: '', product_brand_id: '',
    is_universal: true, for_girls: false, for_trunk: false, target_audiences: [], stock_management: true, quantity: 1,
    images: [],
    compatible_cars: [],
    variation_types: [],
    variants: [],
    weight: '',
    dimensions: { length: '', width: '', height: '' },
    shipping_class_id: '',
  });
  // Brand and category narrow each other; changing one clears the other if it no longer fits.
  // After `form`: it reads the form, and a const read before its line throws on every render.
  const linked = useLinkedBrandCategory({
    brands: metadata?.productBrands || [],
    categories: metadata?.categories || [],
    brandId: form.product_brand_id,
    categoryId: form.category_id,
    setBrandId: (id) => setForm(prev => ({ ...prev, product_brand_id: id })),
    setCategoryId: (id) => setForm(prev => ({ ...prev, category_id: id })),
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [metaData, vendorData] = await Promise.all([
          fetch(`${process.env.NEXT_PUBLIC_API_URL || `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}`}/products/filters`).then(r => r.json()),
          adminApi.getVendors(),
        ]);
        setMetadata(metaData);
        setVendors(vendorData.vendors || []);
      } catch (err) {
        console.error('Failed to fetch metadata:', err);
      }
    };
    fetchData();
  }, []);

  const inputCls = 'w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white';

  const selectedVendor = vendors.find(v => v._id === form.vendor_id);

  // Best match first; each typed word has to start a word (lib/searchSuggest).
  const filteredVendors = searchOptions(vendors, vendorSearch, (v) => [v.store_name, v.store_username, v.email, v.phone]);

  const handleSubmit = async (targetStatus) => {
    setSavingStatus(targetStatus);
    setError('');
    setSuccess('');

    if (!form.vendor_id) {
      setError(isAr ? 'الرجاء اختيار بائع.' : 'Please select a vendor.');
      setSavingStatus(null);
      return;
    }
    if (!form.part_type) {
      setError(partTypeRequiredText(isAr));
      setPartTypeInvalid(true);
      setSavingStatus(null);
      return;
    }
    const discountError = validateDiscount(form.price, form.discount_type || null, form.discount_value, isAr);
    if (discountError) {
      setError(discountError);
      setSavingStatus(null);
      return;
    }
    if (!form.category_id) {
      setError(isAr ? 'الرجاء اختيار فئة.' : 'Please select a category.');
      setSavingStatus(null);
      return;
    }
    if (!form.price) {
      setError(isAr ? 'السعر مطلوب.' : 'Price is required.');
      setSavingStatus(null);
      return;
    }
    if (form.images.length === 0) {
      setError(isAr ? 'الرجاء رفع صورة واحدة على الأقل.' : 'Please upload at least one product image.');
      setSavingStatus(null);
      return;
    }

    try {
      await adminApi.addProduct({ ...form, status: targetStatus });
      setSuccess(
        targetStatus === 'published'
          ? (isAr ? 'تم إنشاء المنتج ونشره بنجاح!' : 'Product created and published successfully!')
          : (isAr ? 'تم حفظ المنتج كمسودة بنجاح!' : 'Product saved as draft successfully!')
      );
      setTimeout(() => router.push('/admin/dashboard/products'), 1500);
    } catch (err) {
      setError(err.message || 'Failed to create product.');
    } finally {
      setSavingStatus(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto pb-12 animate-in fade-in duration-300">

      {/* Header */}
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Link href="/admin/dashboard/products" className="p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white bg-white dark:bg-[#14171A] rounded-lg border border-zinc-200 dark:border-white/10 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight">
              {isAr ? 'إضافة منتج جديد' : 'Add New Product'}
            </h1>
            <p className="text-sm text-zinc-500 mt-1">
              {isAr ? 'أنشئ منتجًا مباشرة وأضفه إلى متجر البائع.' : 'Create a product directly and assign it to a vendor.'}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2 animate-in slide-in-from-top-2">
          <Info size={16} /> {error}
        </div>
      )}

      {success && (
        <div className="mb-6 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-600 dark:text-emerald-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2 animate-in slide-in-from-top-2">
          <CheckCircle2 size={16} /> {success}
        </div>
      )}

      <div className="space-y-6">

        {/* Section 0: Vendor Selector */}
        <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl shadow-sm overflow-visible">
          <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
            <h3 className="font-bold text-zinc-900 dark:text-white">
              {isAr ? '0. اختيار البائع' : '0. Select Vendor'}
              <span className="text-red-500 ms-1">*</span>
            </h3>
          </div>
          <div className="p-6">
            {form.vendor_id && selectedVendor ? (
              <div className="flex items-center justify-between bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-marine-cyan text-white flex items-center justify-center text-sm font-black">
                    {selectedVendor.store_name?.charAt(0)?.toUpperCase() || 'V'}
                  </div>
                  <div>
                    <p className="font-black text-zinc-900 dark:text-white text-sm">{selectedVendor.store_name}</p>
                    <p className="text-xs text-zinc-500">@{selectedVendor.store_username}</p>
                  </div>
                </div>
                <button
                  onClick={() => setForm({ ...form, vendor_id: '' })}
                  className="p-2 text-zinc-400 hover:text-red-500 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="relative z-30" onBlur={() => setTimeout(() => setShowVendorDropdown(false), 120)}>
                <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400 z-10" />
                <input
                  value={vendorSearch}
                  onFocus={() => setShowVendorDropdown(true)}
                  onChange={e => { setVendorSearch(e.target.value); setShowVendorDropdown(true); }}
                  placeholder={isAr ? 'ابحث عن التاجر بالاسم أو اسم المتجر...' : 'Search vendor by name or store...'}
                  className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg ps-9 px-3 py-2.5 text-sm focus:border-marine-cyan focus:outline-none dark:text-white"
                />
                {showVendorDropdown && (
                  <div className="absolute z-[120] mt-2 w-full max-h-72 overflow-y-auto rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#14171A] shadow-2xl">
                    {filteredVendors.length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm font-bold text-zinc-500">
                        {isAr ? 'لا يوجد تجار مطابقون' : 'No vendors found'}
                      </div>
                    ) : (
                      filteredVendors.map(v => (
                        <button
                          key={v._id}
                          onMouseDown={e => e.preventDefault()}
                          onClick={() => {
                            setForm({ ...form, vendor_id: v._id });
                            setVendorSearch('');
                            setShowVendorDropdown(false);
                          }}
                          className="w-full text-start px-4 py-3 hover:bg-red-50 dark:hover:bg-marine-cyan/10 border-t border-zinc-100 dark:border-white/5 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-black text-zinc-900 dark:text-white">{v.store_name}</p>
                              <p className="text-xs text-zinc-500">@{v.store_username} · {v.email}</p>
                            </div>
                            <span className={`text-[10px] font-black px-2 py-1 rounded-full ${v.status === 'active'
                              ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
                              : 'bg-red-50 text-red-500 dark:bg-red-500/10 dark:text-red-400'
                              }`}>
                              {v.status}
                            </span>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Section 1: Core Info */}
        <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
            <h3 className="font-bold text-zinc-900 dark:text-white">{isAr ? '1. المعلومات الأساسية' : '1. Core Information'}</h3>
          </div>
          <div className="p-6 grid grid-cols-2 gap-6">
            <div className="space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.titleEn || 'Title (EN)'} <span className="text-red-500">*</span></label><input type="text" value={form.title_en} onChange={e => setForm({ ...form, title_en: e.target.value })} className={inputCls} /></div>
            <div className="space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.titleAr || 'Title (AR)'}</label><input type="text" value={form.title_ar} onChange={e => setForm({ ...form, title_ar: e.target.value })} dir="rtl" className={inputCls} /></div>
            <div className="space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.subtitleEn || 'Subtitle (EN)'}</label><input type="text" value={form.subtitle_en} onChange={e => setForm({ ...form, subtitle_en: e.target.value })} className={inputCls} /></div>
            <div className="space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.subtitleAr || 'Subtitle (AR)'}</label><input type="text" value={form.subtitle_ar} onChange={e => setForm({ ...form, subtitle_ar: e.target.value })} dir="rtl" className={inputCls} /></div>
            <div className="col-span-2 space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.descriptionEn || 'Description (EN)'}</label><textarea rows="4" value={form.description_en} onChange={e => setForm({ ...form, description_en: e.target.value })} className={inputCls} /></div>
            <div className="col-span-2 space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.descriptionAr || 'Description (AR)'}</label><textarea rows="4" value={form.description_ar} onChange={e => setForm({ ...form, description_ar: e.target.value })} dir="rtl" className={inputCls} /></div>
          </div>
        </section>

        {/* Section 2: Media */}
        <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
            <h3 className="font-bold text-zinc-900 dark:text-white">{isAr ? '2. صور المنتج' : '2. Product Media'}</h3>
          </div>
          <div className="p-6">
            <ImageUploader images={form.images} onChange={(imgs) => setForm({ ...form, images: imgs })} />
          </div>
        </section>

        {/* Section 3: Organization & Codes */}
        <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
            <h3 className="font-bold text-zinc-900 dark:text-white">{isAr ? '3. التصنيف والرموز' : '3. Organization & Codes'}</h3>
          </div>
          <div className="px-6 pt-6">
            <PartTypePicker value={form.part_type} onChange={(v) => setForm({ ...form, part_type: v })} isAr={isAr} invalid={partTypeInvalid} />
          </div>
          <div className="p-6 grid grid-cols-2 gap-8">
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.manufacturerBrand || 'Manufacturer Brand'}</label>
                <SearchableSelect value={form.product_brand_id} onChange={(v) => setForm({ ...form, product_brand_id: v })} options={brandOptions(linked.brands)} placeholder={t.selectBrandPlaceholder || 'Select Manufacturer Brand'} isAr={language === 'ar'} buttonClassName={`${inputCls} pe-9`} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.productCategory || 'Category'} <span className="text-red-500">*</span></label>
                <NestedCategorySelector categories={metadata?.categories || []} allowedIds={linked.allowedCategoryIds} initialValue={form.category_id} onChange={(leafId) => setForm({ ...form, category_id: leafId })} />
              </div>
            </div>
            <div className="space-y-4 border-l border-zinc-100 dark:border-white/5 pl-8">
              <div className="space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">SKU</label><input type="text" value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} className={inputCls} placeholder={isAr ? 'سيُولَّد تلقائيًا' : 'Auto-generated if empty'} /></div>
              <div className="space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.partNumberMpn || 'Part Number (MPN)'}</label><input type="text" value={form.part_number} onChange={e => setForm({ ...form, part_number: e.target.value })} className={inputCls} /></div>
              <div className="space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">GTIN</label><input type="text" value={form.gtin} onChange={e => setForm({ ...form, gtin: e.target.value })} className={inputCls} /></div>
            </div>
          </div>
        </section>

        {/* Section 4: Pricing & Inventory */}
        <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02] flex items-center justify-between">
            <h3 className="font-bold text-zinc-900 dark:text-white">{isAr ? '4. التسعير والمخزون' : '4. Pricing & Inventory'}</h3>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-700 dark:text-zinc-300 font-semibold">
              <input type="checkbox" checked={form.stock_management} onChange={e => setForm({ ...form, stock_management: e.target.checked })} className="text-marine-primary rounded focus:ring-marine-cyan" />
              <span>{isAr ? 'تتبع المخزون' : 'Track Stock'}</span>
            </label>
          </div>
          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.regularPrice || 'Regular Price'} <span className="text-red-500">*</span></label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">{currency}</span>
                <input type="number" min="0" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg pl-12 pr-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white" />
              </div>
            </div>
            <DiscountFields form={form} setForm={setForm} isAr={isAr} />
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.stockQuantity || 'Stock Quantity'}</label>
              {form.variation_types.length > 0 && form.variation_types.some(vt => vt.options?.length > 0) ? (
                <div className="flex items-center gap-2 py-2 px-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg">
                  <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                    {isAr ? 'يُدار من خلال الخيارات' : 'Managed via options'}
                  </span>
                </div>
              ) : (
                <input type="number" min="0" value={form.quantity} disabled={!form.stock_management} onChange={e => setForm({ ...form, quantity: e.target.value })} className="w-full bg-zinc-50 dark:bg-[#0E1012] disabled:opacity-50 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white" />
              )}
            </div>
          </div>
        </section>

        {/* Section 4b: Shipping */}
        <ProductShippingFields form={form} setForm={setForm} isAr={isAr} />

        {/* Section 5: Variations */}
        <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
            <h3 className="font-bold text-zinc-900 dark:text-white">{isAr ? '5. الخيارات (الألوان، المقاسات...)' : '5. Options (Color, Size…)'}</h3>
            <p className="text-xs text-zinc-500 mt-0.5">{isAr ? 'أنشئ خيارات للمنتج.' : 'Build product options.'}</p>
          </div>
          <div className="p-6">
            <VariationBuilder
              language={language}
              variationTypes={form.variation_types}
              variants={form.variants}
              stockManagement={form.stock_management}
              basePrice={form.price}
              baseDiscountType={form.discount_type}
              baseDiscountValue={form.discount_value}
              onChange={({ variation_types, variants }) => setForm(f => ({ ...f, variation_types, variants }))}
            />
          </div>
        </section>

        {/* Girls Collection Toggle */}
        <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02] flex items-center justify-between">
            <div>
              <h3 className="font-bold text-zinc-900 dark:text-white">{isAr ? 'مجموعة البنات' : 'Girls Collection'}</h3>
              <p className="text-xs text-zinc-500 mt-0.5">{t.forGirlsDesc || (isAr ? 'حدد هذا المنتج كجزء من مجموعة البنات' : 'Mark this product as part of the Girls collection')}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t.forGirls || (isAr ? 'للبنات' : 'For Girls')}</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={form.for_girls} onChange={e => setForm({ ...form, for_girls: e.target.checked })} />
                <div className="w-11 h-6 bg-zinc-300 peer-focus:outline-none rounded-full peer dark:bg-white/10 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-zinc-600 peer-checked:bg-pink-500"></div>
              </label>
            </div>
          </div>
        </section>

        {/* Car Trunk essentials toggle */}
        <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02] flex items-center justify-between">
            <div>
              <h3 className="font-bold text-zinc-900 dark:text-white">{isAr ? 'مستلزمات على المركب' : 'Onboard Essentials'}</h3>
              <p className="text-xs text-zinc-500 mt-0.5">{t.forTrunkDesc || (isAr ? 'حدد المنتج ده كحاجة لازم تكون في كل عربية — هيظهر في صفحة شنطة العربية' : 'Mark this product as something every car should carry — it appears on the Car Trunk page')}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t.forTrunk || (isAr ? 'من أساسيات الشنطة' : 'Trunk essential')}</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={!!form.for_trunk} onChange={e => setForm({ ...form, for_trunk: e.target.checked })} />
                <div className="w-11 h-6 bg-zinc-300 peer-focus:outline-none rounded-full peer dark:bg-white/10 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-zinc-600 peer-checked:bg-amber-500"></div>
              </label>
            </div>
          </div>
        </section>

        {/* Audience hubs (lib/marineHubs): where the product shows on the home page */}
        <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
            <h3 className="font-bold text-zinc-900 dark:text-white">{isAr ? 'المجموعات المخصصة' : 'Audience Hubs'}</h3>
            <p className="text-xs text-zinc-500 mt-0.5">{isAr ? 'اختار المجموعات اللي المنتج يظهر فيها على الصفحة الرئيسية، بغض النظر عن القسم بتاعه.' : 'Pick the hubs this product appears in on the home page, whatever its category.'}</p>
          </div>
          <div className="p-6">
            <AudiencePicker value={form.target_audiences} onChange={(v) => setForm(prev => ({ ...prev, target_audiences: v }))} isAr={isAr} />
          </div>
        </section>


        {/* Section 6: Vehicle Compatibility */}
        <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02] flex items-center justify-between">
            <div>
              <h3 className="font-bold text-zinc-900 dark:text-white">{isAr ? '6. توافق المركبات' : '6. Vehicle Compatibility'}</h3>
              <p className="text-xs text-zinc-500 mt-0.5">{isAr ? 'حدد المركبات المتوافقة.' : 'Define compatible vehicles.'}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{isAr ? 'قطعة عامة' : 'Universal'}</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={form.is_universal} onChange={e => setForm({ ...form, is_universal: e.target.checked })} />
                <div className="w-11 h-6 bg-zinc-300 peer-focus:outline-none rounded-full peer dark:bg-white/10 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-zinc-600 peer-checked:bg-marine-cyan"></div>
              </label>
            </div>
          </div>
          <div className="p-6">
            {!form.is_universal ? (
              <CompatibilityBuilder compatibleCars={form.compatible_cars} setCompatibleCars={(cars) => setForm({ ...form, compatible_cars: cars })} carBrands={metadata?.carBrands || []} searchable allowCustomYears />
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 bg-red-50 dark:bg-red-500/10 text-marine-primary rounded-full flex items-center justify-center mx-auto mb-3"><Info size={24} /></div>
                <h4 className="font-bold text-zinc-900 dark:text-white">{isAr ? 'قطعة عامة' : 'Universal Part'}</h4>
                <p className="text-sm text-zinc-500 mt-1">{isAr ? 'تناسب جميع المركبات.' : 'Fits all vehicles. Toggle off to define specific models.'}</p>
              </div>
            )}
          </div>
        </section>

        {/* Bottom Save Bar */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => handleSubmit('draft')}
            disabled={!!savingStatus}
            className="flex items-center gap-2 bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400 px-6 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
          >
            {savingStatus === 'draft' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {isAr ? 'حفظ كمسودة' : 'Save as Draft'}
          </button>
          <button
            type="button"
            onClick={() => handleSubmit('published')}
            disabled={!!savingStatus}
            className="flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white px-6 py-3 rounded-xl text-sm font-bold shadow-md transition-all disabled:opacity-50"
          >
            {savingStatus === 'published' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {isAr ? 'حفظ ونشر' : 'Save & Publish'}
          </button>
        </div>

      </div>
    </div>
  );
}
