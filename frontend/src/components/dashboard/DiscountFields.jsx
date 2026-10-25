'use client';

import { useApp } from '../../context/AppContext';
import { computeDiscountPrice, validateDiscount } from '../../lib/productPricing';

/**
 * The discount editor used by every product form (vendor add/edit, admin
 * add/edit). Two inputs — a type and a value — plus a live preview of the price
 * the customer will actually pay, so the seller never has to do the arithmetic
 * or wonder what "20" meant.
 *
 * Controlled: reads `discount_type` / `discount_value` off `form` and writes
 * back through `setForm`.
 */
export default function DiscountFields({ form, setForm, isAr, labelCls, inputCls }) {
  const { siteSettings } = useApp();
  const currency = siteSettings?.currency || 'QAR';

  const label = labelCls || 'text-xs font-bold text-zinc-500 uppercase tracking-wider';
  const field = inputCls || 'w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white';

  const type = form.discount_type || '';
  const value = form.discount_value ?? '';

  const error = validateDiscount(form.price, type || null, value, isAr);
  const finalPrice = computeDiscountPrice(form.price, type || null, value);

  // Clearing the type clears the value too, so a stale number can never be
  // re-applied by simply picking a type again.
  const onTypeChange = (next) =>
    setForm((f) => ({ ...f, discount_type: next, discount_value: next ? f.discount_value : '' }));

  return (
    <>
      <div className="space-y-1">
        <label className={label}>{isAr ? 'نوع الخصم' : 'Discount Type'}</label>
        <select
          value={type}
          onChange={(e) => onTypeChange(e.target.value)}
          className={field}
        >
          <option value="">{isAr ? 'بدون خصم' : 'No discount'}</option>
          <option value="fixed">{isAr ? `مبلغ ثابت (${currency})` : `Fixed amount (${currency})`}</option>
          <option value="percentage">{isAr ? 'نسبة مئوية (%)' : 'Percentage (%)'}</option>
        </select>
      </div>

      <div className="space-y-1">
        <label className={label}>{isAr ? 'قيمة الخصم' : 'Discount Value'}</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm pointer-events-none">
            {type === 'percentage' ? '%' : currency}
          </span>
          <input
            type="number"
            min="0"
            step="0.01"
            disabled={!type}
            value={value}
            onChange={(e) => setForm((f) => ({ ...f, discount_value: e.target.value }))}
            placeholder={type ? (type === 'percentage' ? '10' : '25') : (isAr ? 'اختر النوع أولاً' : 'Pick a type first')}
            className={`w-full bg-zinc-50 dark:bg-[#0E1012] disabled:opacity-50 border rounded-lg pl-12 pr-3 py-2 text-sm focus:outline-none dark:text-white ${error ? 'border-red-400 focus:border-red-500' : 'border-zinc-200 dark:border-white/10 focus:border-marine-cyan'}`}
          />
        </div>
        {error ? (
          <p className="text-[11px] font-semibold text-red-500">{error}</p>
        ) : finalPrice !== null ? (
          <p className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            {isAr ? `سعر البيع: ${currency} ${finalPrice}` : `Sale price: ${currency} ${finalPrice}`}
          </p>
        ) : null}
      </div>
    </>
  );
}
