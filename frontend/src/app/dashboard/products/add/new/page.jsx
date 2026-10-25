'use client';

import { useState, useEffect } from 'react';
import { useRouter } from '../../../../../lib/navigation';
import { ArrowLeft, Save, Send, Loader2, Info, Library } from 'lucide-react';
import Link from '../../../../../components/LocaleLink';
import { vendorApi } from '../../../../../lib/api';
import { useApp } from '../../../../../context/AppContext';
import ProductFormSections from '../../../../../components/dashboard/ProductFormSections';
import { validateDiscount } from '../../../../../lib/productPricing';
import { partTypeRequiredText } from '../../../../../lib/partType';
import { blankProductForm, fetchProductMetadata } from '../../../../../lib/productForm';

/**
 * Adding a product the catalog doesn't have yet.
 *
 * Reached only from the "Can't find it? Add a new product" bar on the search
 * gate, so a vendor never lands here without having looked at the catalog first.
 * Saving creates the vendor's product exactly as before AND a suggested catalog
 * entry from the same data — the notice below is where the vendor is told that,
 * and it is the only place the catalog is mentioned to them.
 */
export default function AddNewProductPage() {
  const router = useRouter();
  const { language } = useApp();
  const isAr = language === 'ar';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [metadata, setMetadata] = useState(null);
  const [form, setForm] = useState(blankProductForm);
  const [partTypeInvalid, setPartTypeInvalid] = useState(false);

  useEffect(() => {
    fetchProductMetadata()
      .then(setMetadata)
      .catch((err) => console.error('Failed to fetch metadata:', err));
  }, []);

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
      setError(isAr ? 'الرجاء رفع صورة واحدة على الأقل.' : 'Please upload at least one product image.');
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
      await vendorApi.addProduct({ ...form, status: targetStatus });
      router.push('/dashboard/products');
    } catch (err) {
      if (err.code === 'INCOMPLETE_PRODUCT') {
        setError(isAr ? 'بيانات المنتج غير مكتملة. يرجى مراجعة الحقول المطلوبة.' : err.message);
      } else {
        setError(isAr ? 'تعذر إنشاء المنتج. يرجى مراجعة البيانات والمحاولة مرة أخرى.' : (err.message || 'Failed to create product. Check backend logs.'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto pb-12 animate-in fade-in duration-300">

      {/* Header */}
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/products/add" className="p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white bg-white dark:bg-[#14171A] rounded-lg border border-zinc-200 dark:border-white/10 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">
              {isAr ? 'إضافة منتج جديد' : 'Add New Product'}
            </h1>
            <p className="text-sm text-zinc-500 mt-1">
              {isAr ? 'املأ الأقسام أدناه ثم اختر النشر أو الحفظ كمسودة.' : 'Fill out the sections below, then publish or save as draft.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => handleSubmit('draft')}
            disabled={loading}
            className="flex items-center gap-2 bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-white/30 px-5 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {isAr ? 'حفظ كمسودة' : 'Save as Draft'}
          </button>
          <button
            type="button"
            onClick={() => handleSubmit('published')}
            disabled={loading}
            className="flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-md transition-all disabled:opacity-50"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {isAr ? 'نشر الآن' : 'Publish Now'}
          </button>
        </div>
      </div>

      {/* The one place a vendor is told their data joins the platform catalog. */}
      <div className="mb-6 flex items-start gap-3 bg-zinc-50 dark:bg-white/[0.03] border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-3">
        <Library size={16} className="text-zinc-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
          {isAr
            ? 'المنتج الذي تضيفه هنا غير موجود في كتالوج المنصة بعد. سيتم إنشاء بطاقة منتج في الكتالوج من البيانات والصور التي تدخلها، لتصبح متاحة لبقية التجار بعد مراجعة الإدارة. منتجك وسعرك ومخزونك تبقى ملكك وحدك.'
            : 'This product is not in the platform catalog yet. A catalog entry will be created from the data and images you enter here, so other merchants can find it once an admin reviews it. Your product, your price and your stock stay entirely yours.'}
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2 animate-in slide-in-from-top-2">
          <Info size={16} /> {error}
        </div>
      )}

      <ProductFormSections form={form} setForm={setForm} metadata={metadata} partTypeInvalid={partTypeInvalid} />

      {/* Bottom Save Bar */}
      <div className="flex items-center justify-end gap-3 pt-6">
        <button type="button" onClick={() => handleSubmit('draft')} disabled={loading} className="flex items-center gap-2 bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400 px-6 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-50">
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {isAr ? 'حفظ كمسودة' : 'Save as Draft'}
        </button>
        <button type="button" onClick={() => handleSubmit('published')} disabled={loading} className="flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white px-6 py-3 rounded-xl text-sm font-bold shadow-md transition-all disabled:opacity-50">
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          {isAr ? 'نشر الآن' : 'Publish Now'}
        </button>
      </div>
    </div>
  );
}
