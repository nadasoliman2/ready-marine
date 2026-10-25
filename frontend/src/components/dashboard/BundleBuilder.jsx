'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from '../../lib/navigation';
import Link from '../LocaleLink';
import { ArrowLeft, Save, Send, Loader2, Plus, Trash2, Info } from 'lucide-react';
import { vendorApi } from '../../lib/api';
import { useApp } from '../../context/AppContext';
import ImageUploader from './ImageUploader';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const memberUnit = (product, variantId) => {
  if (!product) return 0;
  const variants = product.variants || [];
  let v = variantId ? variants.find(x => String(x._id) === String(variantId)) : null;
  if (!v && variants.length) v = variants[0];
  if (!v) return Number(product.discount_price ?? product.price) || 0;
  return Number((v.discount_price ?? v.price) ?? (product.discount_price ?? product.price)) || 0;
};

export default function BundleBuilder({ bundleId = null, initial = null }) {
  const router = useRouter();
  const { language, siteSettings } = useApp();
  const isAr = language === 'ar';
  const currency = siteSettings?.currency || 'QAR';

  const [eligible, setEligible] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState(initial || {
    title_en: '', title_ar: '',
    subtitle_en: '', subtitle_ar: '',
    description_en: '', description_ar: '',
    images: [],
    members: [{ product_id: '', variant_id: '', quantity: 1 }, { product_id: '', variant_id: '', quantity: 1 }],
    pricing_mode: 'fixed',
    pricing_value: '',
  });

  useEffect(() => {
    (async () => {
      try {
        const res = await vendorApi.getBundleEligibleProducts();
        setEligible(res.products || []);
      } catch (_) { setEligible([]); }
    })();
  }, []);

  const productById = useMemo(() => {
    const m = new Map();
    eligible.forEach(p => m.set(String(p._id), p));
    return m;
  }, [eligible]);

  // Live pricing preview (server is authoritative; this is only guidance).
  const preview = useMemo(() => {
    let combined = 0;
    for (const mem of form.members) {
      const p = productById.get(String(mem.product_id));
      if (!p) continue;
      combined += memberUnit(p, mem.variant_id) * (Number(mem.quantity) || 1);
    }
    combined = round2(combined);
    const val = Number(form.pricing_value) || 0;
    let effective;
    if (form.pricing_mode === 'percent') effective = round2(combined * (1 - Math.min(Math.max(val, 0), 100) / 100));
    else if (form.pricing_mode === 'amount') effective = round2(Math.max(0, combined - val));
    else effective = round2(Math.max(0, val));
    return { combined, effective, savings: round2(Math.max(0, combined - effective)) };
  }, [form.members, form.pricing_mode, form.pricing_value, productById]);

  const setMember = (i, patch) => setForm(f => ({
    ...f, members: f.members.map((m, idx) => idx === i ? { ...m, ...patch } : m),
  }));
  const addMember = () => setForm(f => ({ ...f, members: [...f.members, { product_id: '', variant_id: '', quantity: 1 }] }));
  const removeMember = (i) => setForm(f => ({ ...f, members: f.members.filter((_, idx) => idx !== i) }));

  const submit = async (targetStatus) => {
    setError('');
    // Basic client checks for a submit (server validates authoritatively).
    const validMembers = form.members.filter(m => m.product_id);
    if (targetStatus !== 'draft') {
      if (validMembers.length < 2) { setError(isAr ? 'اختر منتجين على الأقل.' : 'Select at least two products.'); return; }
      if (!form.title_en?.trim() && !form.title_ar?.trim()) { setError(isAr ? 'العنوان مطلوب.' : 'A title is required.'); return; }
      if (!form.images?.length) { setError(isAr ? 'أضف صورة واحدة على الأقل.' : 'Add at least one image.'); return; }
      if (form.pricing_value === '' || Number(form.pricing_value) < 0) { setError(isAr ? 'أدخل سعرًا صحيحًا.' : 'Enter a valid price.'); return; }
    }

    const payload = {
      ...form,
      members: validMembers.map(m => ({
        product_id: m.product_id,
        variant_id: m.variant_id || null,
        quantity: Math.max(1, Number(m.quantity) || 1),
      })),
      pricing_value: Number(form.pricing_value) || 0,
      status: targetStatus,
    };

    setLoading(true);
    try {
      if (bundleId) await vendorApi.updateBundle(bundleId, payload);
      else await vendorApi.addBundle(payload);
      router.push('/dashboard/bundles');
    } catch (err) {
      setError(err.message || 'Failed to save bundle');
    } finally {
      setLoading(false);
    }
  };

  const inputCls = 'w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-marine-cyan';

  return (
    <div className="max-w-4xl mx-auto pb-24" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard/bundles" className="p-2 rounded-xl bg-zinc-100 dark:bg-white/5"><ArrowLeft size={18} /></Link>
        <h1 className="text-2xl font-black text-zinc-900 dark:text-white">
          {bundleId ? (isAr ? 'تعديل الباقة' : 'Edit Bundle') : (isAr ? 'إنشاء باقة' : 'Create Bundle')}
        </h1>
      </div>

      {error && <div className="mb-4 p-3 rounded-xl bg-red-50 text-red-700 text-sm font-semibold">{error}</div>}

      <div className="space-y-6">
        {/* Content */}
        <div className="grid md:grid-cols-2 gap-4">
          <div><label className="text-xs font-bold text-zinc-500 uppercase">{isAr ? 'العنوان (EN)' : 'Title (EN)'}</label>
            <input className={inputCls} value={form.title_en} onChange={e => setForm({ ...form, title_en: e.target.value })} /></div>
          <div><label className="text-xs font-bold text-zinc-500 uppercase">{isAr ? 'العنوان (AR)' : 'Title (AR)'}</label>
            <input dir="rtl" className={inputCls} value={form.title_ar} onChange={e => setForm({ ...form, title_ar: e.target.value })} /></div>
          <div><label className="text-xs font-bold text-zinc-500 uppercase">{isAr ? 'العنوان الفرعي (EN)' : 'Subtitle (EN)'}</label>
            <input className={inputCls} value={form.subtitle_en} onChange={e => setForm({ ...form, subtitle_en: e.target.value })} /></div>
          <div><label className="text-xs font-bold text-zinc-500 uppercase">{isAr ? 'العنوان الفرعي (AR)' : 'Subtitle (AR)'}</label>
            <input dir="rtl" className={inputCls} value={form.subtitle_ar} onChange={e => setForm({ ...form, subtitle_ar: e.target.value })} /></div>
          <div className="md:col-span-2"><label className="text-xs font-bold text-zinc-500 uppercase">{isAr ? 'الوصف (EN)' : 'Description (EN)'}</label>
            <textarea rows={3} className={inputCls} value={form.description_en} onChange={e => setForm({ ...form, description_en: e.target.value })} /></div>
          <div className="md:col-span-2"><label className="text-xs font-bold text-zinc-500 uppercase">{isAr ? 'الوصف (AR)' : 'Description (AR)'}</label>
            <textarea rows={3} dir="rtl" className={inputCls} value={form.description_ar} onChange={e => setForm({ ...form, description_ar: e.target.value })} /></div>
        </div>

        {/* Images */}
        <div>
          <label className="text-xs font-bold text-zinc-500 uppercase mb-2 block">{isAr ? 'الصور' : 'Images'}</label>
          <ImageUploader images={form.images} onChange={(imgs) => setForm({ ...form, images: imgs })} />
        </div>

        {/* Members */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-bold text-zinc-500 uppercase">{isAr ? 'منتجات الباقة (منتجاتك المنشورة)' : 'Bundle products (your published products)'}</label>
            <button onClick={addMember} className="inline-flex items-center gap-1 text-xs font-bold text-marine-primary"><Plus size={14} /> {isAr ? 'إضافة' : 'Add'}</button>
          </div>
          <div className="space-y-3">
            {form.members.map((mem, i) => {
              const p = productById.get(String(mem.product_id));
              const variants = p?.variants || [];
              return (
                <div key={i} className="grid grid-cols-12 gap-2 items-center bg-zinc-50 dark:bg-white/5 rounded-xl p-2">
                  <select className={`${inputCls} col-span-12 sm:col-span-6`} value={mem.product_id}
                    onChange={e => setMember(i, { product_id: e.target.value, variant_id: '' })}>
                    <option value="">{isAr ? 'اختر منتجًا' : 'Select product'}</option>
                    {eligible.map(prod => (
                      <option key={prod._id} value={prod._id}>{isAr ? (prod.title_ar || prod.title_en) : (prod.title_en || prod.title_ar)}</option>
                    ))}
                  </select>
                  <select className={`${inputCls} col-span-6 sm:col-span-3`} value={mem.variant_id || ''} disabled={!variants.length}
                    onChange={e => setMember(i, { variant_id: e.target.value })}>
                    <option value="">{variants.length ? (isAr ? 'المتغير' : 'Variant') : (isAr ? 'بدون' : 'None')}</option>
                    {variants.map(v => (
                      <option key={v._id} value={v._id}>{(v.selected_options || []).map(o => o.option_value).join(' / ') || 'Default'}</option>
                    ))}
                  </select>
                  <input type="number" min="1" className={`${inputCls} col-span-4 sm:col-span-2`} value={mem.quantity}
                    onChange={e => setMember(i, { quantity: e.target.value })} />
                  <button onClick={() => removeMember(i)} className="col-span-2 sm:col-span-1 flex justify-center items-center min-h-[40px] text-red-500"><Trash2 size={16} /></button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Pricing */}
        <div className="rounded-2xl border border-zinc-200 dark:border-white/10 p-4">
          <label className="text-xs font-bold text-zinc-500 uppercase">{isAr ? 'تسعير الباقة' : 'Bundle Pricing'}</label>
          <div className="mt-3 flex flex-wrap gap-2">
            {[['fixed', isAr ? 'سعر إجمالي ثابت' : 'Fixed total'], ['percent', isAr ? 'نسبة خصم %' : 'Percent off'], ['amount', isAr ? 'مبلغ خصم' : 'Amount off']].map(([mode, label]) => (
              <button key={mode} type="button" onClick={() => setForm({ ...form, pricing_mode: mode })}
                className={`px-3 py-2 rounded-xl text-sm font-bold border ${form.pricing_mode === mode ? 'bg-marine-cyan text-white border-marine-cyan' : 'bg-zinc-50 dark:bg-white/5 border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="mt-3 max-w-xs">
            <input type="number" min="0" step="0.01" className={inputCls} value={form.pricing_value}
              placeholder={form.pricing_mode === 'percent' ? '20' : (form.pricing_mode === 'amount' ? '150' : '500')}
              onChange={e => setForm({ ...form, pricing_value: e.target.value })} />
          </div>

          {form.pricing_mode === 'fixed' && (
            <p className="mt-2 text-xs text-amber-600 flex items-center gap-1"><Info size={12} /> {isAr ? 'السعر الثابت لن يتغيّر تلقائيًا عند تغيّر أسعار المنتجات.' : "A fixed total won't auto-adjust when member prices change."}</p>
          )}

          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <span className="text-zinc-500">{isAr ? 'مجموع المنتجات:' : 'Combined:'} <b className="text-zinc-800 dark:text-white">{currency} {preview.combined.toFixed(2)}</b></span>
            <span className="text-zinc-500">{isAr ? 'سعر الباقة:' : 'Bundle price:'} <b className="text-marine-primary">{currency} {preview.effective.toFixed(2)}</b></span>
            <span className="text-zinc-500">{isAr ? 'التوفير:' : 'Savings:'} <b className="text-emerald-600">{currency} {preview.savings.toFixed(2)}</b></span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button disabled={loading} onClick={() => submit('draft')}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl border border-zinc-200 dark:border-white/10 font-bold text-zinc-700 dark:text-zinc-200 disabled:opacity-50">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {isAr ? 'حفظ كمسودة' : 'Save draft'}
          </button>
          <button disabled={loading} onClick={() => submit('pending')}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold disabled:opacity-50">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} {isAr ? 'نشر' : 'Publish'}
          </button>
        </div>
      </div>
    </div>
  );
}
