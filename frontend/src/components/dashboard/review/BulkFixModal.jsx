'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Save, Wrench, X } from 'lucide-react';
import Overlay from '../../Overlay';
import NestedCategorySelector from '../NestedCategorySelector';
import CompatibilityBuilder from '../CompatibilityBuilder';
import { PART_TYPES } from '../../../lib/partType';

const INPUT = 'w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white';
const LABEL = 'block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1.5';

/**
 * One correction for many products at once: the category, the part type, the fitting cars.
 * Anything left on "no change" is not touched. "Save and publish" publishes them too.
 */
export default function BulkFixModal({ count, metadata, carBrands, loadCarBrands, isAr, onClose, onApply }) {
  const [categoryId, setCategoryId] = useState('');
  const [partType, setPartType] = useState('');
  const [fitment, setFitment] = useState(''); // '' | 'universal' | 'cars'
  const [cars, setCars] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { if (fitment === 'cars' && !carBrands) loadCarBrands(); }, [fitment, carBrands, loadCarBrands]);

  const set = {
    ...(categoryId ? { category_id: categoryId } : {}),
    ...(partType ? { part_type: partType } : {}),
    ...(fitment === 'universal' ? { fitment: { is_universal: true } } : {}),
    ...(fitment === 'cars' ? { fitment: { is_universal: false, compatible_cars: cars } } : {}),
  };
  const nothing = Object.keys(set).length === 0;

  const apply = async (publish) => {
    if (fitment === 'cars' && !cars.length) { setError(isAr ? 'اختار عربية واحدة على الأقل.' : 'Choose at least one car.'); return; }
    setBusy(publish ? 'publish' : 'save');
    setError('');
    try {
      await onApply(set, publish);
    } catch (err) {
      setError(err.message || (isAr ? 'تعذر التطبيق.' : 'Could not apply.'));
      setBusy('');
    }
  };

  return (
    <Overlay className="fixed inset-0 z-[95] bg-black/50 flex items-center justify-center p-4" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col bg-white dark:bg-[#14171A] rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 p-4 border-b border-zinc-100 dark:border-white/5">
          <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-marine-cyan/10 text-marine-primary flex items-center justify-center"><Wrench size={20} /></div>
          <div className="flex-1">
            <h2 className="font-black text-zinc-900 dark:text-white">{isAr ? `تصليح ${count} منتج مرة واحدة` : `Correct ${count} products at once`}</h2>
            <p className="text-xs text-zinc-500">{isAr ? 'اللي هتسيبه "من غير تغيير" مش هيتلمس.' : 'Anything left on "no change" is not touched.'}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && <div className="rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 p-3 text-sm font-bold">{error}</div>}

          <div>
            <span className={LABEL}>{isAr ? 'الفئة' : 'Category'}</span>
            <NestedCategorySelector categories={metadata?.categories || []} initialValue={categoryId} onChange={setCategoryId} />
            {!categoryId && <p className="text-[11px] text-zinc-400 mt-1">{isAr ? 'من غير تغيير' : 'No change'}</p>}
          </div>

          <label className="block"><span className={LABEL}>{isAr ? 'نوع القطعة' : 'Part type'}</span>
            <select value={partType} onChange={(e) => setPartType(e.target.value)} className={INPUT}>
              <option value="">{isAr ? 'من غير تغيير' : 'No change'}</option>
              {PART_TYPES.map((t) => <option key={t.value} value={t.value}>{isAr ? t.ar : t.en}</option>)}
            </select></label>

          <div>
            <span className={LABEL}>{isAr ? 'العربيات المناسبة' : 'Fitting cars'}</span>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: '', ar: 'من غير تغيير', en: 'No change' },
                { id: 'universal', ar: 'عام (أي عربية)', en: 'Universal' },
                { id: 'cars', ar: 'عربيات محددة', en: 'Specific cars' },
              ].map((o) => (
                <button key={o.id || 'none'} type="button" onClick={() => setFitment(o.id)}
                  className={`rounded-xl border px-3 py-2 text-xs font-bold ${fitment === o.id ? 'border-marine-cyan bg-red-50 dark:bg-marine-cyan/10 text-marine-primary' : 'border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300'}`}>
                  {isAr ? o.ar : o.en}
                </button>
              ))}
            </div>
            {fitment === 'cars' && (
              <div className="mt-3">
                {carBrands
                  ? <CompatibilityBuilder compatibleCars={cars} setCompatibleCars={setCars} carBrands={carBrands} searchable allowCustomYears />
                  : <div className="flex justify-center py-4"><Loader2 size={20} className="animate-spin text-marine-primary" /></div>}
                <p className="text-[11px] text-zinc-400 mt-1">{isAr ? 'العربيات دي هتحل محل اللي متسجّل على المنتجات.' : 'These cars replace what the products have.'}</p>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-zinc-100 dark:border-white/5 p-3 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => apply(false)} disabled={!!busy || nothing}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-sm font-bold text-zinc-700 dark:text-zinc-300 disabled:opacity-40">
            {busy === 'save' ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}{isAr ? 'حفظ بس' : 'Save only'}
          </button>
          <button type="button" onClick={() => apply(true)} disabled={!!busy}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold disabled:opacity-50">
            {busy === 'publish' ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
            {nothing ? (isAr ? `نشر الـ ${count}` : `Publish the ${count}`) : (isAr ? `حفظ ونشر الـ ${count}` : `Save and publish the ${count}`)}
          </button>
        </div>
      </div>
    </Overlay>
  );
}
