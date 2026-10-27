'use client';

import { useState, useEffect } from 'react';
import { useRouter } from '../../../../../lib/navigation';
import { ArrowLeft, Save, Send, Loader2, Info, X, CheckCircle2 } from 'lucide-react';
import { adminApi, vendorApi } from '../../../../../lib/api';
import { useApp } from '../../../../../context/AppContext';
import AudiencePicker from '../../../../../components/dashboard/AudiencePicker';
import NestedCategorySelector from '../../../../../components/dashboard/NestedCategorySelector';
import ImageUploader from '../../../../../components/dashboard/ImageUploader';
import CompatibilityBuilder from '../../../../../components/dashboard/CompatibilityBuilder';
import VariationBuilder from '../../../../../components/dashboard/VariationBuilder';
import ProductShippingFields from '../../../../../components/dashboard/ProductShippingFields';
import DiscountFields from '../../../../../components/dashboard/DiscountFields';
import { validateDiscount } from '../../../../../lib/productPricing';
import { partTypeRequiredText } from '../../../../../lib/partType';
import PartTypePicker from '../../../../../components/dashboard/PartTypePicker';
import Link from '../../../../../components/LocaleLink';
import SearchableSelect from '../../../../../components/SearchableSelect';
import { brandOptions } from '../../../../../lib/pickerOptions';

/**
 * `onApprove` (admin review of a product waiting for approval): adds "Save and approve",
 * which saves the changes and then approves the product in the same press.
 */
export default function EditProductPage({ params, mode = 'vendor', reviewMode = false, onCancel, onSaved, onApprove }) {
  const router = useRouter();
  const { language, t, siteSettings } = useApp();
  const isAr = language === 'ar';
  const isAdmin = mode === 'admin';
  const productsPath = isAdmin ? '/admin/dashboard/products' : '/dashboard/products';
  const getProduct = isAdmin ? adminApi.getProduct : vendorApi.getProduct;
  const updateProduct = isAdmin ? adminApi.updateProduct : vendorApi.updateProduct;

  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [metadata, setMetadata] = useState(null);
  const [form, setForm] = useState(null);
  const [partTypeInvalid, setPartTypeInvalid] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [meta, productData] = await Promise.all([
          // Full: the compatibility builder needs every make's models expanded.
          adminApi.getFilterMetadata(null, { detail: 'full' }),
          getProduct(params.id)
        ]);
        const prod = productData.product || productData;
        setMetadata(meta);
        setForm({
          title_en: prod.title_en || '',
          title_ar: prod.title_ar || '',
          subtitle_en: prod.subtitle_en || '',
          subtitle_ar: prod.subtitle_ar || '',
          description_en: prod.description_en || '',
          description_ar: prod.description_ar || '',
          sku: prod.sku || '',
          part_number: prod.part_number || '',
          gtin: prod.gtin || '',
          // Empty on a product saved before the field existed: the form asks for it.
          part_type: prod.part_type || '',
          status: prod.status || 'draft',
          price: prod.price || '',
          discount_type: prod.discount_type || '',
          discount_value: prod.discount_value ?? '',
          category_id: typeof prod.category_id === 'object' ? prod.category_id?._id : prod.category_id,
          product_brand_id: (typeof prod.product_brand_id === 'object' ? prod.product_brand_id?._id : prod.product_brand_id) || '',
          is_universal: prod.is_universal ?? true,
          for_girls: prod.for_girls ?? false,
          for_trunk: prod.for_trunk ?? false,
          target_audiences: prod.target_audiences || [],
          stock_management: prod.stock_management ?? true,
          stock_status: prod.stock_status || 'instock',
          quantity: prod.quantity || 0,
          images: prod.images || [],
          compatible_cars: prod.compatible_cars || [],
          variation_types: prod.variation_types || [],
          variants: prod.variants || [],
          weight: prod.weight ?? '',
          dimensions: prod.dimensions || { length: '', width: '', height: '' },
          shipping_class_id: typeof prod.shipping_class_id === 'object' ? (prod.shipping_class_id?._id || null) : (prod.shipping_class_id || null),
          vendor_id: prod.vendor_id || null,
          is_published: prod.is_published ?? false,
        });
      } catch (err) {
        setError(isAr ? 'تعذر تحميل بيانات المنتج.' : 'Failed to load product data.');
      } finally {
        setFetching(false);
      }
    };
    if (params.id) load();
  }, [params.id, getProduct]);

  const handleSubmit = async (targetStatus, { approve = false } = {}) => {
    setLoading(true);
    setError('');
    if (!form.part_type) {
      setError(partTypeRequiredText(isAr));
      setPartTypeInvalid(true);
      setLoading(false);
      return;
    }
    if (!form.category_id) {
      setError(isAr ? 'الرجاء اختيار فئة.' : 'Please select a category.');
      setLoading(false);
      return;
    }
    const discountError = validateDiscount(form.price, form.discount_type || null, form.discount_value, isAr);
    if (discountError) {
      setError(discountError);
      setLoading(false);
      return;
    }
    try {
      const payload = { ...form };
      delete payload.vendor_id;
      delete payload.is_published;
      const result = await updateProduct(params.id, { ...payload, status: targetStatus });

      if (approve && onApprove) {
        try {
          await onApprove(result.product);
        } catch (approveErr) {
          // The changes are saved; only the approval did not go through.
          setError(isAr
            ? `التعديلات اتحفظت، بس الموافقة ماتمتش: ${approveErr.message || 'حاول تاني'}`
            : `The changes were saved, but the approval failed: ${approveErr.message || 'try again'}`);
        }
        return;
      }
      if (reviewMode && onSaved) {
        await onSaved(result.product);
        return;
      }

      if (result.product?.status === 'pending') {
        // Product was re-submitted for review
        setError(isAr
          ? 'تم حفظ المنتج وإرساله للمراجعة. سينشر بعد موافقة الأدمن.'
          : 'Product saved and submitted for review. It will be published once approved by admin.');
        setTimeout(() => router.push(productsPath), 2000);
      } else {
        router.push(productsPath);
      }
    } catch (err) {
      if (err.code === 'INCOMPLETE_PRODUCT') {
        setError(isAr ? 'بيانات المنتج غير مكتملة. يرجى مراجعة الحقول المطلوبة.' : err.message);
      } else {
        setError(isAr ? 'تعذر تحديث المنتج. يرجى مراجعة البيانات والمحاولة مرة أخرى.' : (err.message || 'Failed to update product.'));
      }
    } finally {
      setLoading(false);
    }
  };

  if (fetching) return <div className="flex h-[50vh] items-center justify-center"><Loader2 size={32} className="text-marine-primary animate-spin" /></div>;
  if (!form) return <div className="p-8 text-center"><h2 className="text-xl font-bold text-zinc-900 dark:text-white">{isAr ? 'المنتج غير موجود.' : 'Product not found.'}</h2><Link href={productsPath} className="text-marine-primary mt-4 inline-block">{isAr ? 'العودة إلى المنتجات' : 'Return to Products'}</Link></div>;

  const inputCls = 'w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white';

  return (
    <div className="max-w-4xl mx-auto pb-12 animate-in fade-in duration-300">

      {/* Header */}
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div className="flex items-center gap-4">
          {reviewMode ? (
            <button type="button" onClick={onCancel} className="p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white bg-white dark:bg-[#14171A] rounded-lg border border-zinc-200 dark:border-white/10 transition-colors">
              <ArrowLeft size={18} />
            </button>
          ) : (
            <Link href={productsPath} className="p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white bg-white dark:bg-[#14171A] rounded-lg border border-zinc-200 dark:border-white/10 transition-colors">
              <ArrowLeft size={18} />
            </Link>
          )}
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">{isAr ? 'تعديل المنتج' : 'Edit Product'}</h1>
            <p className="text-sm text-zinc-500 mt-1">{isAr ? 'تحديث تفاصيل المنتج.' : 'Update your product details and parameters.'}</p>
            {isAdmin && form.vendor_id && (
              <p className="text-xs font-bold text-marine-primary mt-1">
                {isAr ? 'البائع: ' : 'Vendor: '}
                {form.vendor_id.store_name || 'Unknown vendor'} @{form.vendor_id.store_username || '-'}
              </p>
            )}
          </div>
        </div>
        {reviewMode ? (
          <div className="flex items-center gap-3">
            <button type="button" onClick={onCancel} disabled={loading} className="flex items-center gap-2 bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 px-5 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50">
              <X size={15} />
              {isAr ? 'إلغاء' : 'Cancel'}
            </button>
            <button type="button" onClick={() => handleSubmit(form.status)} disabled={loading} className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50 ${onApprove ? 'bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400' : 'bg-marine-cyan hover:bg-marine-cyan-dark text-white shadow-md'}`}>
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {isAr ? 'حفظ التغييرات' : 'Save changes'}
            </button>
            {onApprove && (
              <button type="button" onClick={() => handleSubmit(form.status, { approve: true })} disabled={loading} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-md transition-all disabled:opacity-50">
                {loading ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                {isAr ? 'حفظ وموافقة' : 'Save and approve'}
              </button>
            )}
          </div>
        ) : <div className="flex items-center gap-3">
          <button type="button" onClick={() => handleSubmit('draft')} disabled={loading} className="flex items-center gap-2 bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-white/30 px-5 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {isAr ? 'حفظ كمسودة' : 'Save as Draft'}
          </button>
          <button type="button" onClick={() => handleSubmit('published')} disabled={loading} className="flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-md transition-all disabled:opacity-50">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {isAr ? 'نشر الآن' : 'Publish Now'}
          </button>
        </div>}
      </div>

      {error && (
        <div className="mb-6 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
          <Info size={16} /> {error}
        </div>
      )}

      <div className="space-y-6">

        {/* Section 1: Core Info */}
        <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
            <h3 className="font-bold text-zinc-900 dark:text-white">{isAr ? '1. المعلومات الأساسية' : '1. Core Information'}</h3>
          </div>
          <div className="p-6 grid grid-cols-2 gap-6">
            <div className="space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.titleEn || 'Title (EN)'}</label><input type="text" value={form.title_en} onChange={e => setForm({ ...form, title_en: e.target.value })} className={inputCls} /></div>
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
          <div className="p-6"><ImageUploader images={form.images} onChange={(imgs) => setForm({ ...form, images: imgs })} /></div>
        </section>

        {/* Section 3: Organization */}
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
                <SearchableSelect value={form.product_brand_id} onChange={(v) => setForm({ ...form, product_brand_id: v })} options={brandOptions(metadata?.productBrands)} placeholder={t.selectBrandPlaceholder || 'Select Manufacturer Brand'} isAr={isAr} buttonClassName={`${inputCls} pe-9`} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.productCategory || 'Category'}</label>
                <NestedCategorySelector categories={metadata?.categories || []} initialValue={form.category_id} onChange={(leafId) => setForm({ ...form, category_id: leafId })} />
              </div>
            </div>
            <div className="space-y-4 border-l border-zinc-100 dark:border-white/5 pl-8">
              <div className="space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">SKU</label><input type="text" value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} className={inputCls} /></div>
              <div className="space-y-1"><label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.partNumberMpn || 'Part Number (MPN)'}</label><input type="text" value={form.part_number} onChange={e => setForm({ ...form, part_number: e.target.value })} className={inputCls} /></div>
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
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.regularPrice || 'Regular Price'}</label>
              <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">{siteSettings?.currency || 'QAR'}</span><input type="number" min="0" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg pl-12 pr-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white" /></div>
            </div>
            <DiscountFields form={form} setForm={setForm} isAr={isAr} />
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.stockQuantity || 'Stock Quantity'}</label>
              {form.variation_types.length > 0 && form.variation_types.some(vt => vt.options?.length > 0 || vt.name) ? (
                <div className="flex items-center gap-2 py-2 px-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg">
                  <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                    {isAr ? 'يُدار المخزون من خلال الخيارات أدناه' : 'Stock is managed per variant below'}
                  </span>
                </div>
              ) : (
                <input type="number" min="0" value={form.quantity} disabled={!form.stock_management} onChange={e => setForm({ ...form, quantity: e.target.value })} className="w-full bg-zinc-50 dark:bg-[#0E1012] disabled:opacity-50 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white" />
              )}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{isAr ? 'حالة المخزون' : 'Stock Status'}</label>
              <select
                value={form.stock_status}
                disabled={!form.stock_management}
                onChange={e => setForm({ ...form, stock_status: e.target.value })}
                className="w-full bg-zinc-50 dark:bg-[#0E1012] disabled:opacity-50 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white transition-colors"
              >
                <option value="instock">{isAr ? 'متوفر' : 'In Stock'}</option>
                <option value="outofstock">{isAr ? 'نفذ المخزون' : 'Out of Stock'}</option>
                <option value="onbackorder">{isAr ? 'طلب مسبق (Backorder)' : 'On Backorder'}</option>
              </select>
            </div>
          </div>
        </section>

        {/* Section 4b: Shipping */}
        <ProductShippingFields form={form} setForm={setForm} isAr={isAr} />

        {/* Section 5: Variations */}
        <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
            <h3 className="font-bold text-zinc-900 dark:text-white">{isAr ? '5. الخيارات' : '5. Options (Color, Size…)'}</h3>
            <p className="text-xs text-zinc-500 mt-0.5">{isAr ? 'أنشئ خيارات للمنتج مع تسعير وكميات مستقلة.' : 'Build product options with independent pricing and stock per combination.'}</p>
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
              <p className="text-xs text-zinc-500 mt-0.5">{isAr ? 'حدد المركبات التي تناسب هذه القطعة.' : 'Define exactly which vehicles this part fits.'}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{isAr ? 'قطعة عامة' : 'Set as Universal'}</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={form.is_universal} onChange={e => setForm({ ...form, is_universal: e.target.checked })} />
                <div className="w-11 h-6 bg-zinc-300 peer-focus:outline-none rounded-full peer dark:bg-white/10 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-zinc-600 peer-checked:bg-marine-cyan"></div>
              </label>
            </div>
          </div>
          <div className="p-6">
            {!form.is_universal ? (
              <CompatibilityBuilder compatibleCars={form.compatible_cars} setCompatibleCars={(cars) => setForm({ ...form, compatible_cars: cars })} carBrands={metadata?.carBrands || []} allowCustomYears={isAdmin} />
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 bg-red-50 dark:bg-red-500/10 text-marine-primary rounded-full flex items-center justify-center mx-auto mb-3"><Info size={24} /></div>
                <h4 className="font-bold text-zinc-900 dark:text-white">{isAr ? 'هذه قطعة عامة' : 'This is a Universal Part'}</h4>
                <p className="text-sm text-zinc-500 mt-1">{isAr ? 'تناسب جميع المركبات.' : 'It fits all vehicles. Toggle off to specify models.'}</p>
              </div>
            )}
          </div>
        </section>

        {/* Bottom Save Bar */}
        {reviewMode ? (
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onCancel} disabled={loading} className="flex items-center gap-2 bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 px-6 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-50">
              <X size={15} /> {isAr ? 'إلغاء' : 'Cancel'}
            </button>
            <button type="button" onClick={() => handleSubmit(form.status)} disabled={loading} className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-50 ${onApprove ? 'bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400' : 'bg-marine-cyan hover:bg-marine-cyan-dark text-white shadow-md'}`}>
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {isAr ? 'حفظ التغييرات' : 'Save changes'}
            </button>
            {onApprove && (
              <button type="button" onClick={() => handleSubmit(form.status, { approve: true })} disabled={loading} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl text-sm font-bold shadow-md transition-all disabled:opacity-50">
                {loading ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                {isAr ? 'حفظ وموافقة' : 'Save and approve'}
              </button>
            )}
          </div>
        ) : <div className="flex items-center justify-end gap-3 pt-2">
          <button type="button" onClick={() => handleSubmit('draft')} disabled={loading} className="flex items-center gap-2 bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400 px-6 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-50">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {isAr ? 'حفظ كمسودة' : 'Save as Draft'}
          </button>
          <button type="button" onClick={() => handleSubmit('published')} disabled={loading} className="flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white px-6 py-3 rounded-xl text-sm font-bold shadow-md transition-all disabled:opacity-50">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {isAr ? 'نشر الآن' : 'Publish Now'}
          </button>
        </div>}

      </div>
    </div>
  );
}
