'use client';

import { useState, useEffect } from 'react';
import { useRouter } from '../../../../lib/navigation';
import Link from '../../../../components/LocaleLink';
import {
  ArrowLeft, Save, Send, Loader2, Info, Plus, ChevronDown, ChevronUp,
  ImageOff, RefreshCw,
} from 'lucide-react';
import { vendorApi, catalogApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import ProductFormSections from '../../../../components/dashboard/ProductFormSections';
import CatalogSearchResults from '../../../../components/dashboard/catalog/CatalogSearchResults';
import { validateDiscount } from '../../../../lib/productPricing';
import { partTypeRequiredText } from '../../../../lib/partType';
import PartTypePicker from '../../../../components/dashboard/PartTypePicker';
import { blankProductForm, fetchProductMetadata } from '../../../../lib/productForm';
import { entryTitle, entryImage, entryCategoryName, entryBrandName, entryToFormPatch, L } from '../../../../lib/catalog';

/**
 * "Add product" — the search gate, then the condensed form.
 *
 * The gate is not optional and not a field on the form: it is the whole page,
 * before any form exists. With two parallel buttons most vendors would click
 * "from scratch" out of habit, the catalog would stay empty, and the feature
 * would die — so search comes first, and the escape hatch ("Can't find it?") is
 * a sticky bar that is always visible without being the obvious first click.
 *
 * Once an entry is picked the vendor sees a summary card, Price and Stock, and
 * nothing else. The rest of the form is real and fully editable — it is just
 * folded away, because two required fields is the whole point.
 */
export default function AddProductPage() {
  const router = useRouter();
  const { language, siteSettings } = useApp();
  const isAr = language === 'ar';

  const [entry, setEntry] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [form, setForm] = useState(blankProductForm);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [partTypeInvalid, setPartTypeInvalid] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchProductMetadata()
      .then(setMetadata)
      .catch((err) => console.error('Failed to fetch metadata:', err));
  }, []);

  const goToNewProduct = () => router.push('/dashboard/products/add/new');

  const handleSelectEntry = async (selected) => {
    setError('');
    try {
      // Re-read the entry from the server: the search card carries only what a
      // result needs, and the form needs the description, compatibility and
      // variation types too.
      const { entry: full, vendor_product_id } = await catalogApi.getEntry(selected._id);
      if (vendor_product_id) {
        router.push(`/dashboard/products/${vendor_product_id}/edit`);
        return;
      }
      setEntry(full);
      setForm({ ...blankProductForm(), ...entryToFormPatch(full) });
      setDetailsOpen(false);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError(isAr ? 'تعذر فتح هذا المنتج. حاول مرة أخرى.' : 'Could not open that product. Please try again.');
    }
  };

  const handleSubmit = async (targetStatus) => {
    setLoading(true);
    setError('');

    if (!form.part_type) {
      setError(partTypeRequiredText(isAr));
      setPartTypeInvalid(true);
      setLoading(false);
      return;
    }
    if (!form.category_id) {
      setError(isAr ? 'الرجاء اختيار فئة من القائمة.' : 'Please select a leaf category from the nested selector.');
      setLoading(false);
      return;
    }
    if (form.images.length === 0) {
      setError(isAr
        ? 'هذا المنتج بلا صور في الكتالوج. افتح "تعديل باقي التفاصيل" وأضف صورة واحدة على الأقل.'
        : 'This catalog entry has no images. Open "Edit the rest of the details" and add at least one.');
      setDetailsOpen(true);
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
      await vendorApi.addProduct({ ...form, status: targetStatus, catalog_entry_id: entry._id });
      router.push('/dashboard/products');
    } catch (err) {
      if (err.code === 'DUPLICATE_CATALOG_PRODUCT' && err.productId) {
        router.push(`/dashboard/products/${err.productId}/edit`);
        return;
      }
      if (err.code === 'INCOMPLETE_PRODUCT') {
        setError(isAr ? 'بيانات المنتج غير مكتملة. يرجى مراجعة الحقول المطلوبة.' : err.message);
        setDetailsOpen(true);
      } else {
        setError(isAr ? 'تعذر إنشاء المنتج. يرجى مراجعة البيانات والمحاولة مرة أخرى.' : (err.message || 'Failed to create product.'));
      }
    } finally {
      setLoading(false);
    }
  };

  /* ── The gate ─────────────────────────────────────────────── */
  if (!entry) {
    return (
      <div className="max-w-2xl mx-auto pb-28 animate-in fade-in duration-300">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/dashboard/products" className="p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white bg-white dark:bg-[#14171A] rounded-lg border border-zinc-200 dark:border-white/10 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">
              {isAr ? 'ما المنتج الذي تريد إضافته؟' : 'Which product are you adding?'}
            </h1>
            <p className="text-sm text-zinc-500 mt-1">
              {isAr
                ? 'ابحث عنه أولاً — إن وجدته، لن تحتاج سوى إدخال السعر والكمية.'
                : 'Search for it first — if it is already there, all you enter is price and stock.'}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
            <Info size={16} /> {error}
          </div>
        )}

        <CatalogSearchResults
          language={language}
          onSelect={handleSelectEntry}
          onOpenExisting={(e) => router.push(`/dashboard/products/${e.vendor_product_id}/edit`)}
          onNewProduct={goToNewProduct}
        />

        {/* Sticky escape hatch. Not above the results (so the catalog is looked at
            first) and not at the end of the list (so it is never lost behind 50
            results) — and it keeps working when search itself is broken. */}
        <div className="fixed bottom-0 inset-x-0 z-30 border-t border-zinc-200 dark:border-white/10 bg-white/95 dark:bg-[#0E1012]/95 backdrop-blur px-4 py-3">
          <div className="max-w-2xl mx-auto">
            <button
              type="button"
              onClick={goToNewProduct}
              className="w-full flex items-center justify-center gap-2 border border-dashed border-zinc-300 dark:border-white/20 hover:border-marine-cyan hover:text-marine-primary text-zinc-700 dark:text-zinc-200 px-4 py-3 rounded-xl text-sm font-bold transition-colors"
            >
              <Plus size={16} /> {isAr ? 'لم تجده؟ أضف منتجاً جديداً' : "Can't find it? Add a new product"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── The condensed form ───────────────────────────────────── */
  const image = entryImage(entry);
  const category = entryCategoryName(entry, language);
  const brand = entryBrandName(entry);

  return (
    <div className="max-w-3xl mx-auto pb-12 animate-in fade-in duration-300">
      <div className="flex items-center gap-4 mb-6">
        <button
          type="button"
          onClick={() => { setEntry(null); setForm(blankProductForm()); setError(''); }}
          className="p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white bg-white dark:bg-[#14171A] rounded-lg border border-zinc-200 dark:border-white/10 transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">
            {isAr ? 'السعر والمخزون' : 'Price & stock'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {isAr ? 'نوع القطعة والسعر والكمية، ثم أرسله للمراجعة.' : 'Part type, price and stock, then send it for review.'}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
          <Info size={16} /> {error}
        </div>
      )}

      {/* Product summary card */}
      <div className="flex items-center gap-4 bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-4 mb-4">
        <div className="w-16 h-16 rounded-lg bg-zinc-100 dark:bg-white/5 flex items-center justify-center overflow-hidden flex-shrink-0">
          {image ? <img src={image} alt="" className="w-full h-full object-cover" /> : <ImageOff size={20} className="text-zinc-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-zinc-900 dark:text-white truncate">{entryTitle(entry, language)}</p>
          <p className="text-xs text-zinc-500 mt-0.5 truncate">{[category, brand].filter(Boolean).join(' · ')}</p>
        </div>
        <button
          type="button"
          onClick={() => { setEntry(null); setForm(blankProductForm()); setError(''); }}
          className="flex-shrink-0 flex items-center gap-1.5 text-xs font-bold text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-white/10 hover:border-marine-cyan hover:text-marine-primary px-3 py-2 rounded-lg transition-colors"
        >
          <RefreshCw size={13} /> {isAr ? 'تغيير المنتج' : 'Change product'}
        </button>
      </div>

      {/* The fields that are actually the vendor's. The part type is theirs too: the same
          catalog part can be sold as original by one store and as aftermarket by another. */}
      <div className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl p-6 mb-4 grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="sm:col-span-2">
          <PartTypePicker value={form.part_type} onChange={(v) => setForm({ ...form, part_type: v })} isAr={isAr} invalid={partTypeInvalid} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{isAr ? 'السعر' : 'Price'}</label>
          <div className="relative">
            <span className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">{siteSettings?.currency || 'QAR'}</span>
            <input
              type="number" min="0" step="0.01" autoFocus
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg ps-12 pe-3 py-3 text-sm focus:border-marine-cyan focus:outline-none dark:text-white"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{isAr ? 'الكمية' : 'Stock'}</label>
          {form.variation_types.length > 0 ? (
            <div className="flex items-center h-[46px] px-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg">
              <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                {isAr ? 'يُدار المخزون من خلال الخيارات بالأسفل' : 'Stock is managed per variant below'}
              </span>
            </div>
          ) : (
            <input
              type="number" min="0"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-3 text-sm focus:border-marine-cyan focus:outline-none dark:text-white"
            />
          )}
        </div>
      </div>

      {/* Everything the catalog pre-filled — editable without restriction, and
          the link survives whatever the vendor changes here. */}
      <div className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden mb-4">
        <button
          type="button"
          onClick={() => setDetailsOpen((o) => !o)}
          className="w-full flex items-center justify-between gap-3 px-6 py-4 text-start hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors"
        >
          <div>
            <p className="font-bold text-zinc-900 dark:text-white text-sm">
              {isAr ? 'تعديل باقي التفاصيل' : 'Edit the rest of the details'}
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">
              {isAr
                ? 'الوصف، الصور، التوافق، الخيارات، الشحن — كلها مملوءة مسبقاً ويمكنك تغييرها.'
                : 'Description, images, compatibility, options, shipping — all pre-filled, all editable.'}
            </p>
          </div>
          {detailsOpen ? <ChevronUp size={18} className="text-zinc-400" /> : <ChevronDown size={18} className="text-zinc-400" />}
        </button>
        {detailsOpen && (
          <div className="px-4 sm:px-6 pb-6 pt-2 border-t border-zinc-100 dark:border-white/5">
            <ProductFormSections
              form={form}
              setForm={setForm}
              metadata={metadata}
              except={['pricing']}
              numbered={false}
              hidePartType
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => handleSubmit('draft')}
          disabled={loading}
          className="flex items-center gap-2 bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400 px-6 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {isAr ? 'حفظ كمسودة' : 'Save as Draft'}
        </button>
        <button
          type="button"
          onClick={() => handleSubmit('published')}
          disabled={loading}
          className="flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white px-6 py-3 rounded-xl text-sm font-bold shadow-md transition-all disabled:opacity-50"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          {L(language, 'Submit for review', 'إرسال للمراجعة')}
        </button>
      </div>
    </div>
  );
}
