'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, ExternalLink, Loader2, Save, X, AlertTriangle, Store } from 'lucide-react';
import Overlay from '../../Overlay';
import Link from '../../LocaleLink';
import { adminApi } from '../../../lib/api';
import NestedCategorySelector from '../NestedCategorySelector';
import PartTypePicker from '../PartTypePicker';
import DiscountFields from '../DiscountFields';
import CompatibilityBuilder from '../CompatibilityBuilder';
import { useLinkedBrandCategory } from '../../../lib/brandCategoryLink';
import { partTypeRequiredText } from '../../../lib/partType';
import { validateDiscount } from '../../../lib/productPricing';
import { thumbUrl, resolveAssetUrl } from '../../../lib/assets';
import { issueLabel } from '../../../lib/productReview';
import SearchableSelect from '../../SearchableSelect';
import { brandOptions } from '../../../lib/pickerOptions';

const INPUT = 'w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white';
const LABEL = 'block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1.5';

const idOf = (v) => (v && typeof v === 'object' ? v._id : v) || '';

// The fields the panel edits, as they are sent back.
const formOf = (p) => ({
  title_ar: p.title_ar || '',
  title_en: p.title_en || '',
  description_ar: p.description_ar || '',
  description_en: p.description_en || '',
  price: p.price ?? '',
  discount_type: p.discount_type || '',
  discount_value: p.discount_value ?? '',
  category_id: idOf(p.category_id),
  product_brand_id: idOf(p.product_brand_id),
  part_type: p.part_type || '',
  part_number: p.part_number || '',
  sku: p.sku || '',
  is_universal: !!p.is_universal,
  compatible_cars: p.compatible_cars || [],
});

/** Only what changed, so a quick edit never rewrites fields it did not touch. */
const changesOf = (initial, form) => {
  const out = {};
  for (const key of ['title_ar', 'title_en', 'description_ar', 'description_en', 'category_id', 'product_brand_id', 'part_type', 'part_number', 'sku']) {
    if (String(initial[key] ?? '') !== String(form[key] ?? '')) out[key] = form[key];
  }
  if (String(initial.price) !== String(form.price) || initial.discount_type !== form.discount_type || String(initial.discount_value ?? '') !== String(form.discount_value ?? '')) {
    out.price = Number(form.price);
    out.discount_type = form.discount_type || null;
    out.discount_value = form.discount_type && form.discount_value !== '' ? Number(form.discount_value) : null;
  }
  if (initial.is_universal !== form.is_universal || JSON.stringify(initial.compatible_cars) !== JSON.stringify(form.compatible_cars)) {
    out.is_universal = form.is_universal;
    out.compatible_cars = form.is_universal ? [] : form.compatible_cars;
  }
  return out;
};

/**
 * The review's quick edit: a side panel over the pending list with what usually needs
 * correcting, "Save" and "Save and publish → next". Ctrl+Enter publishes and moves on,
 * Alt+↓ / Alt+↑ go to the next / previous product, Esc closes.
 *
 * @param row       the product's line in the queue (its issues)
 * @param metadata  categories and brands; `carBrands` (full) for the fitment, loaded on demand
 */
export default function ReviewPanel({
  row, position, total, metadata, loadCarBrands, carBrands, isAr, onClose, onNavigate, onSaved, onPublished,
}) {
  const [product, setProduct] = useState(null);
  const [initial, setInitial] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [partTypeInvalid, setPartTypeInvalid] = useState(false);
  const bodyRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    setPartTypeInvalid(false);
    adminApi.getProduct(row._id)
      .then((res) => {
        if (!alive) return;
        const p = res.product || res;
        setProduct(p);
        const f = formOf(p);
        setInitial(f);
        setForm(f);
        bodyRef.current?.scrollTo({ top: 0 });
      })
      .catch((err) => { if (alive) setError(err.message || (isAr ? 'تعذر تحميل المنتج.' : 'Could not load the product.')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [row._id, isAr]);

  // The fitment builder needs every make with its models: fetched the first time it shows.
  useEffect(() => {
    if (form && !form.is_universal && !carBrands) loadCarBrands();
  }, [form?.is_universal, carBrands, loadCarBrands]);

  const linked = useLinkedBrandCategory({
    brands: metadata?.productBrands || [],
    categories: metadata?.categories || [],
    brandId: form?.product_brand_id || '',
    categoryId: form?.category_id || '',
    setBrandId: (id) => setForm((f) => ({ ...f, product_brand_id: id })),
    setCategoryId: (id) => setForm((f) => ({ ...f, category_id: id })),
  });

  const changes = useMemo(() => (form && initial ? changesOf(initial, form) : {}), [form, initial]);
  const dirty = Object.keys(changes).length > 0;

  const check = () => {
    if (!form.part_type) { setPartTypeInvalid(true); return partTypeRequiredText(isAr); }
    if (!form.category_id) return isAr ? 'اختار فئة.' : 'Choose a category.';
    if (!form.is_universal && !(form.compatible_cars || []).length) return isAr ? 'اختار العربيات المناسبة، أو خليه عام.' : 'Choose the fitting cars, or make it universal.';
    return validateDiscount(form.price, form.discount_type || null, form.discount_value, isAr);
  };

  const save = async (publish) => {
    const problem = check();
    if (problem) { setError(problem); return; }
    setBusy(publish ? 'publish' : 'save');
    setError('');
    try {
      let saved = product;
      if (dirty) {
        const res = await adminApi.updateProduct(row._id, changes);
        saved = res.product;
        setProduct(saved);
        setInitial(formOf(saved));
        setForm(formOf(saved));
      }
      if (publish) {
        await adminApi.approveProducts([row._id]);
        onPublished(row._id);
      } else {
        onSaved(row._id, saved);
      }
    } catch (err) {
      setError(err.message || (isAr ? 'تعذر الحفظ.' : 'Could not save.'));
    } finally {
      setBusy('');
    }
  };

  // Keyboard: Ctrl/Cmd+Enter publish and next, Alt+↓/↑ next/previous, Esc close.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); if (!busy && form) save(true); }
      else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); onNavigate(1); }
      else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); onNavigate(-1); }
      else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const images = product?.images || [];

  return (
    <Overlay className="fixed inset-0 z-[90] flex justify-end" dir={isAr ? 'rtl' : 'ltr'}>
      <button type="button" aria-label={isAr ? 'إغلاق' : 'Close'} onClick={onClose} className="absolute inset-0 bg-black/40" />
      <aside className="relative h-full w-full max-w-xl bg-white dark:bg-[#14171A] shadow-2xl flex flex-col">
        {/* Head */}
        <div className="flex items-start gap-3 p-4 border-b border-zinc-100 dark:border-white/5">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-zinc-400">{isAr ? `منتج ${position} من ${total}` : `Product ${position} of ${total}`}</p>
            <h2 className="font-black text-zinc-900 dark:text-white truncate">{row.title_ar || row.title_en || (isAr ? 'منتج بدون عنوان' : 'Untitled product')}</h2>
            <p className="text-xs text-zinc-500 mt-0.5 flex items-center gap-1"><Store size={12} />{row.vendor?.store_name || '—'}</p>
          </div>
          <button type="button" onClick={() => onNavigate(-1)} title={isAr ? 'السابق (Alt+↑)' : 'Previous (Alt+↑)'} className="p-2 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5"><ArrowUp size={18} /></button>
          <button type="button" onClick={() => onNavigate(1)} title={isAr ? 'التالي (Alt+↓)' : 'Next (Alt+↓)'} className="p-2 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5"><ArrowDown size={18} /></button>
          <button type="button" onClick={onClose} title={isAr ? 'إغلاق (Esc)' : 'Close (Esc)'} className="p-2 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5"><X size={18} /></button>
        </div>

        {/* Body */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {row.issues?.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/20 p-3">
              <p className="text-xs font-black text-amber-800 dark:text-amber-300 flex items-center gap-1.5 mb-1.5"><AlertTriangle size={14} />{isAr ? 'محتاج يتصلّح' : 'Needs correcting'}</p>
              <div className="flex flex-wrap gap-1.5">
                {row.issues.map((code) => (
                  <span key={code} className="rounded-full bg-white/70 dark:bg-white/10 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:text-amber-300">{issueLabel(code, isAr)}</span>
                ))}
              </div>
              {row.market_price && row.issues.includes('price_outlier') && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1.5">{isAr ? `تجار تانيين بيبيعوا نفس القطعة بحوالي ${row.market_price} ج.م` : `Other vendors sell the same item for about ${row.market_price} EGP`}</p>
              )}
            </div>
          )}
          {error && <div className="rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-3 text-sm font-bold">{error}</div>}

          {loading || !form ? (
            <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin text-marine-primary" /></div>
          ) : (
            <>
              {images.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {images.map((img, i) => (
                    <img key={img.url || i} src={thumbUrl(resolveAssetUrl(img.url), 160)} alt="" className="h-20 w-20 shrink-0 rounded-lg object-cover border border-zinc-200 dark:border-white/10" />
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block sm:col-span-2"><span className={LABEL}>{isAr ? 'العنوان بالعربي' : 'Arabic title'}</span>
                  <input dir="rtl" value={form.title_ar} onChange={(e) => setForm((f) => ({ ...f, title_ar: e.target.value }))} className={INPUT} /></label>
                <label className="block sm:col-span-2"><span className={LABEL}>{isAr ? 'العنوان بالإنجليزي' : 'English title'}</span>
                  <input dir="ltr" value={form.title_en} onChange={(e) => setForm((f) => ({ ...f, title_en: e.target.value }))} className={INPUT} /></label>
                <label className="block"><span className={LABEL}>{isAr ? 'السعر' : 'Price'}</span>
                  <input type="number" min="0" step="0.01" dir="ltr" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} className={INPUT} /></label>
                <label className="block"><span className={LABEL}>{isAr ? 'رقم القطعة' : 'Part number'}</span>
                  <input dir="ltr" value={form.part_number} onChange={(e) => setForm((f) => ({ ...f, part_number: e.target.value }))} className={INPUT} /></label>
                <DiscountFields form={form} setForm={setForm} isAr={isAr} labelCls={LABEL} inputCls={INPUT} />
              </div>

              <PartTypePicker value={form.part_type} onChange={(v) => { setPartTypeInvalid(false); setForm((f) => ({ ...f, part_type: v })); }} isAr={isAr} invalid={partTypeInvalid} />

              <div>
                <span className={LABEL}>{isAr ? 'الفئة' : 'Category'}</span>
                <NestedCategorySelector
                  key={`${row._id}-cat`}
                  categories={linked.categories || []}
                  initialValue={form.category_id}
                  onChange={(id) => setForm((f) => ({ ...f, category_id: id }))}
                />
              </div>

              <div><span className={LABEL}>{isAr ? 'الماركة' : 'Brand'}</span>
                <SearchableSelect value={form.product_brand_id} onChange={(v) => setForm((f) => ({ ...f, product_brand_id: v }))} options={brandOptions(linked.brands)} placeholder={isAr ? 'من غير ماركة' : 'No brand'} isAr={isAr} buttonClassName={`${INPUT} pe-9`} /></div>

              {/* Fitment */}
              <div className="rounded-xl border border-zinc-200 dark:border-white/10 p-3 space-y-3">
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <span>
                    <span className="block text-sm font-bold text-zinc-900 dark:text-white">{isAr ? 'عام: يناسب أي عربية' : 'Universal: fits any car'}</span>
                    <span className="block text-xs text-zinc-500">{isAr ? 'اقفله علشان تحدد العربيات.' : 'Turn off to choose the cars.'}</span>
                  </span>
                  <input type="checkbox" className="w-5 h-5 accent-marine-cyan" checked={form.is_universal}
                    onChange={(e) => setForm((f) => ({ ...f, is_universal: e.target.checked }))} />
                </label>
                {!form.is_universal && (carBrands
                  ? <CompatibilityBuilder compatibleCars={form.compatible_cars} setCompatibleCars={(cars) => setForm((f) => ({ ...f, compatible_cars: cars }))} carBrands={carBrands} searchable allowCustomYears />
                  : <div className="flex justify-center py-4"><Loader2 size={20} className="animate-spin text-marine-primary" /></div>)}
              </div>

              <label className="block"><span className={LABEL}>{isAr ? 'الوصف بالعربي' : 'Arabic description'}</span>
                <textarea dir="rtl" rows={4} value={form.description_ar} onChange={(e) => setForm((f) => ({ ...f, description_ar: e.target.value }))} className={INPUT} /></label>
              <label className="block"><span className={LABEL}>{isAr ? 'الوصف بالإنجليزي' : 'English description'}</span>
                <textarea dir="ltr" rows={3} value={form.description_en} onChange={(e) => setForm((f) => ({ ...f, description_en: e.target.value }))} className={INPUT} /></label>

              <Link href={`/admin/dashboard/products/${row._id}?edit=1&from=pending`} className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-500 hover:text-marine-primary">
                <ExternalLink size={13} />{isAr ? 'التعديل الكامل (الصور، الخيارات، الشحن…)' : 'Full edit (images, options, shipping…)'}
              </Link>
            </>
          )}
        </div>

        {/* Foot */}
        <div className="border-t border-zinc-100 dark:border-white/5 p-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => save(false)} disabled={!!busy || loading || !dirty}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-sm font-bold text-zinc-700 dark:text-zinc-300 disabled:opacity-40">
            {busy === 'save' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}{isAr ? 'حفظ' : 'Save'}
          </button>
          <button type="button" onClick={() => save(true)} disabled={!!busy || loading}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold disabled:opacity-50">
            {busy === 'publish' ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
            {dirty ? (isAr ? 'حفظ ونشر ← التالي' : 'Save and publish → next') : (isAr ? 'نشر ← التالي' : 'Publish → next')}
          </button>
          <span className="w-full text-[10px] text-zinc-400 text-center">{isAr ? 'Ctrl+Enter نشر والتالي · Alt+↓ التالي · Esc إغلاق' : 'Ctrl+Enter publish & next · Alt+↓ next · Esc close'}</span>
        </div>
      </aside>
    </Overlay>
  );
}
