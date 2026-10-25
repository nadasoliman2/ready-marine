'use client';

import { useState, useEffect } from 'react';
import { Plus, X, Layers, Tag, ChevronDown, ChevronUp } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { computeDiscountPrice, validateDiscount } from '../../lib/productPricing';

/**
 * Cartesian product of arrays of options.
 * e.g. [[Red, Blue], [S, M]] => [[Red,S],[Red,M],[Blue,S],[Blue,M]]
 */
function cartesianProduct(arrays) {
  if (!arrays || arrays.length === 0) return [[]];
  return arrays.reduce(
    (results, options) =>
      results.flatMap(combo => options.map(opt => [...combo, opt])),
    [[]]
  );
}

/**
 * Build variant combination labels + selected_options from variation types.
 * Does NOT generate ObjectIds — those are added by the backend on save.
 */
function buildVariants(variationTypes) {
  const typesWithOptions = variationTypes.filter(vt => vt.name.trim() && vt.options.length > 0);
  if (typesWithOptions.length === 0) return [];

  const optionArrays = typesWithOptions.map(vt =>
    vt.options.map(opt => ({
      type_name: vt.name,
      option_value: opt.value,
    }))
  );

  return cartesianProduct(optionArrays).map(combo => ({
    label: combo.map(o => o.option_value).join(' / '),
    selected_options: combo,
    price: null,
    discount_type: null,
    discount_value: null,
    stock: 0,
  }));
}

export default function VariationBuilder({ variationTypes, variants, onChange, language, stockManagement = true, basePrice = '', baseDiscountType = '', baseDiscountValue = '' }) {
  const { siteSettings } = useApp();
  const isAr = language === 'ar';

  // Internal types state with temp keys for React keying (NOT DB ObjectIds)
  const [types, setTypes] = useState(() =>
    variationTypes?.length
      ? variationTypes.map(vt => ({
          key: vt._id || `type-${Math.random().toString(36).slice(2)}`,
          name: vt.name,
          options: (vt.options || []).map(o => ({
            key: o._id || `opt-${Math.random().toString(36).slice(2)}`,
            value: o.value,
          })),
        }))
      : []
  );

  // Variant overrides keyed by label
  const [variantData, setVariantData] = useState(() => {
    const map = {};
    (variants || []).forEach(v => {
      const label = (v.selected_options || []).map(o => o.option_value).join(' / ');
      map[label] = {
        price: v.price ?? '',
        discount_type: v.discount_type ?? '',
        discount_value: v.discount_value ?? '',
        stock: v.stock ?? 0,
      };
    });
    return map;
  });

  const [newOptionInput, setNewOptionInput] = useState({});
  const [collapsed, setCollapsed] = useState({});

  // Compute generated variants whenever types change
  const generatedVariants = buildVariants(types);

  // Emit changes upward — output format matches DB schema exactly
  useEffect(() => {
    // Output variation_types without temp keys — only name + options[{value}]
    const outTypes = types
      .filter(vt => vt.name.trim())
      .map(vt => ({
        name: vt.name,
        options: vt.options.map(o => ({ value: o.value })),
      }));

    const outVariants = generatedVariants.map(gv => {
      const override = variantData[gv.label] || {};

      const price = override.price !== '' && override.price != null ? parseFloat(override.price) : null;
      const discount_type = override.discount_type || null;
      const discount_value = discount_type && override.discount_value !== '' && override.discount_value != null
        ? parseFloat(override.discount_value)
        : null;

      return {
        // selected_options matches DB: [{type_name, option_value}]
        selected_options: gv.selected_options,
        price,
        discount_type,
        discount_value,
        stock: stockManagement ? (parseInt(override.stock) || 0) : 0,
      };
    });

    onChange({ variation_types: outTypes, variants: outVariants });
  }, [types, variantData, stockManagement]);

  const addType = () => {
    setTypes(prev => [...prev, { key: `type-${Date.now()}`, name: '', options: [] }]);
  };

  const removeType = (typeKey) => {
    setTypes(prev => prev.filter(t => t.key !== typeKey));
  };

  const updateTypeName = (typeKey, name) => {
    setTypes(prev => prev.map(t => t.key === typeKey ? { ...t, name } : t));
  };

  const addOption = (typeKey) => {
    const val = (newOptionInput[typeKey] || '').trim();
    if (!val) return;
    setTypes(prev => prev.map(t =>
      t.key === typeKey
        ? { ...t, options: [...t.options, { key: `opt-${Date.now()}`, value: val }] }
        : t
    ));
    setNewOptionInput(prev => ({ ...prev, [typeKey]: '' }));
  };

  const removeOption = (typeKey, optKey) => {
    setTypes(prev => prev.map(t =>
      t.key === typeKey ? { ...t, options: t.options.filter(o => o.key !== optKey) } : t
    ));
  };

  const updateVariantField = (label, field, value) => {
    setVariantData(prev => ({
      ...prev,
      [label]: { ...(prev[label] || {}), [field]: value },
    }));
  };

  // Clearing a variant's discount type clears its value too, so a leftover
  // number can never be silently re-applied by picking a type again.
  const updateVariantDiscountType = (label, value) => {
    setVariantData(prev => ({
      ...prev,
      [label]: { ...(prev[label] || {}), discount_type: value, discount_value: value ? (prev[label]?.discount_value ?? '') : '' },
    }));
  };

  /** A variant's discount applies to its own price, or to the product's when it has none. */
  const effectivePriceOf = (data) =>
    data.price !== '' && data.price != null ? data.price : basePrice;

  // What "no type selected" means for a variant depends on the product: with a
  // product-level discount the variant simply follows it, otherwise it has none.
  const baseDiscountLabel = baseDiscountType && baseDiscountValue !== '' && baseDiscountValue != null
    ? (baseDiscountType === 'percentage'
        ? (isAr ? `من المنتج (${baseDiscountValue}%)` : `From product (${baseDiscountValue}%)`)
        : (isAr ? `من المنتج (${baseDiscountValue})` : `From product (${baseDiscountValue})`))
    : (isAr ? 'بدون خصم' : 'No discount');

  return (
    <div className="space-y-5">
      {/* Variation Types */}
      <div className="space-y-3">
        {types.map((vt) => (
          <div key={vt.key} className="border border-zinc-200 dark:border-white/10 rounded-xl overflow-hidden bg-zinc-50 dark:bg-[#0E1012]">
            {/* Type Header */}
            <div className="flex items-center gap-2 p-3">
              <Layers size={14} className="text-marine-primary flex-shrink-0" />
              <input
                type="text"
                value={vt.name}
                onChange={e => updateTypeName(vt.key, e.target.value)}
                placeholder={isAr ? 'اسم الخيار (مثال: اللون)' : 'Option name (e.g. Color)'}
                className="flex-1 bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-sm font-bold text-zinc-900 dark:text-white placeholder-zinc-400 focus:border-marine-cyan focus:outline-none transition-all"
              />
              <button
                type="button"
                onClick={() => setCollapsed(c => ({ ...c, [vt.key]: !c[vt.key] }))}
                className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-white transition-colors"
              >
                {collapsed[vt.key] ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              </button>
              <button
                type="button"
                onClick={() => removeType(vt.key)}
                className="p-1 text-zinc-400 hover:text-red-500 transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            {!collapsed[vt.key] && (
              <div className="px-3 pb-3 space-y-2">
                {/* Options Tags */}
                <div className="flex flex-wrap gap-2 min-h-[28px]">
                  {vt.options.map(opt => (
                    <span
                      key={opt.key}
                      className="inline-flex items-center gap-1.5 bg-white dark:bg-white/10 border border-zinc-200 dark:border-white/10 px-2.5 py-1 rounded-lg text-xs font-bold text-zinc-800 dark:text-white"
                    >
                      <Tag size={10} className="text-marine-primary" />
                      {opt.value}
                      <button type="button" onClick={() => removeOption(vt.key, opt.key)} className="text-zinc-400 hover:text-red-500 transition-colors ml-0.5">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>

                {/* Add Option Input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newOptionInput[vt.key] || ''}
                    onChange={e => setNewOptionInput(prev => ({ ...prev, [vt.key]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOption(vt.key); } }}
                    placeholder={isAr ? 'أضف قيمة واضغط Enter' : 'Add value & press Enter'}
                    className="flex-1 bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs focus:border-marine-cyan focus:outline-none dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => addOption(vt.key)}
                    className="bg-marine-cyan/10 text-marine-primary font-bold text-xs px-3 py-1.5 rounded-lg hover:bg-marine-cyan/20 transition-colors"
                  >
                    {isAr ? 'إضافة' : 'Add'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={addType}
          className="w-full border-2 border-dashed border-zinc-200 dark:border-white/10 hover:border-marine-cyan/40 text-zinc-400 hover:text-marine-primary text-sm font-bold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          <Plus size={16} /> {isAr ? 'إضافة خيار جديد' : 'Add Option'}
        </button>
      </div>

      {/* Generated Variants Grid */}
      {generatedVariants.length > 0 && (
        <div className="animate-in fade-in duration-300">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
              {isAr ? `${generatedVariants.length} تنويع تم إنشاؤه` : `${generatedVariants.length} Variant Combinations`}
            </span>
          </div>

          {/* Responsive table */}
          <div className="border border-zinc-200 dark:border-white/10 rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="text-[10px] font-black text-zinc-400 uppercase tracking-widest bg-zinc-50 dark:bg-white/[0.02] border-b border-zinc-200 dark:border-white/5">
                  <th className="text-start px-4 py-2.5">{isAr ? 'التنويع' : 'Variant'}</th>
                  <th className="text-center px-2 py-2.5 w-28">{isAr ? `السعر (${siteSettings?.currency || 'QAR'})` : `Price (${siteSettings?.currency || 'QAR'})`}</th>
                  <th className="text-center px-2 py-2.5 w-32">{isAr ? 'نوع الخصم' : 'Discount Type'}</th>
                  <th className="text-center px-2 py-2.5 w-32">{isAr ? 'قيمة الخصم' : 'Discount Value'}</th>
                  {stockManagement && (
                    <th className="text-center px-2 py-2.5 w-20">{isAr ? 'المخزون' : 'Stock'}</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-white/5 bg-white dark:bg-[#14171A]">
                {generatedVariants.map(gv => {
                  const data = variantData[gv.label] || {};
                  const variantPrice = effectivePriceOf(data);
                  const discountError = validateDiscount(variantPrice, data.discount_type || null, data.discount_value, isAr);
                  const salePrice = computeDiscountPrice(variantPrice, data.discount_type || null, data.discount_value);
                  return (
                    <tr key={gv.label} className="hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-2.5 font-bold text-zinc-900 dark:text-white whitespace-nowrap">{gv.label}</td>

                      <td className="px-2 py-2">
                        <input
                          type="number" min="0" step="0.01"
                          placeholder={basePrice ? `${basePrice}` : (isAr ? 'من المنتج' : 'Base')}
                          value={data.price ?? ''}
                          onChange={e => updateVariantField(gv.label, 'price', e.target.value)}
                          className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-center focus:border-marine-cyan focus:outline-none dark:text-white placeholder:text-zinc-300"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          value={data.discount_type ?? ''}
                          onChange={e => updateVariantDiscountType(gv.label, e.target.value)}
                          className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-xs text-center focus:border-marine-cyan focus:outline-none dark:text-white"
                        >
                          <option value="">{baseDiscountLabel}</option>
                          <option value="fixed">{isAr ? 'مبلغ ثابت' : 'Fixed'}</option>
                          <option value="percentage">{isAr ? 'نسبة %' : 'Percent %'}</option>
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        <input
                          type="number" min="0" step="0.01"
                          disabled={!data.discount_type}
                          placeholder={data.discount_type === 'percentage' ? '%' : (isAr ? 'المبلغ' : 'Amount')}
                          value={data.discount_value ?? ''}
                          onChange={e => updateVariantField(gv.label, 'discount_value', e.target.value)}
                          className={`w-full bg-zinc-50 dark:bg-[#0E1012] disabled:opacity-40 border rounded-lg px-2.5 py-1.5 text-xs text-center focus:outline-none dark:text-white placeholder:text-zinc-300 ${discountError ? 'border-red-400' : 'border-zinc-200 dark:border-white/10 focus:border-marine-cyan'}`}
                          title={discountError || ''}
                        />
                        {discountError
                          ? <p className="mt-1 text-[10px] font-semibold text-red-500 text-center">{discountError}</p>
                          : salePrice !== null
                            ? <p className="mt-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 text-center">{`${siteSettings?.currency || 'QAR'} ${salePrice}`}</p>
                            : null}
                      </td>

                      {stockManagement && (
                        <td className="px-2 py-2">
                          <input
                            type="number" min="0"
                            value={data.stock ?? 0}
                            onChange={e => updateVariantField(gv.label, 'stock', parseInt(e.target.value) || 0)}
                            className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-center focus:border-marine-cyan focus:outline-none dark:text-white"
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {types.length === 0 && (
        <div className="text-center py-8 text-zinc-400 text-sm">
          <Layers size={32} className="mx-auto mb-2 text-zinc-300 dark:text-zinc-600" />
          <p className="font-medium">
            {isAr ? 'لا توجد خيارات بعد. اضغط "إضافة خيار جديد" للبدء.' : 'No options yet. Click "Add Option" to start.'}
          </p>
        </div>
      )}
    </div>
  );
}
