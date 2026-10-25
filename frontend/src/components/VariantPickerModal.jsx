'use client';

import { useState, useEffect } from 'react';
import { X, ShoppingCart } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useRouter } from '../lib/navigation';
import { variantPricing } from '../lib/productPricing';
import Overlay from './Overlay';

export default function VariantPickerModal({ product, isOpen, onClose, mode = 'cart' }) {
  const { addToCart, buyNow, language, siteSettings } = useApp();
  const router = useRouter();
  const isAr = language === 'ar';

  const [selected, setSelected] = useState({});
  const [added, setAdded] = useState(false);

  // Reset on open
  useEffect(() => {
    if (isOpen) { setSelected({}); setAdded(false); }
  }, [isOpen]);

  // Lock body scroll while open
  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen || !product) return null;

  const variationTypes = product.variation_types || [];

  // Find matching variant from selected options
  const activeVariant = product.variants?.find(v =>
    v.selected_options?.every(o => selected[o.type_name] === o.option_value)
  ) ?? null;

  const allSelected = variationTypes.every(vt => selected[vt.name]);
  const { price, original, hasDiscount } = variantPricing(product, allSelected ? activeVariant : null);

  const primaryImage = product.images?.find(i => i.is_primary)?.url || product.images?.[0]?.url || '';
  const title = isAr ? (product.title_ar || product.title_en) : product.title_en;
  const isDraft = product.status === 'draft';
  const isVendorSuspended = product.vendor_id?.status === 'suspended';
  const purchaseBlocked = isDraft || isVendorSuspended;
  const purchaseBlockedMessage = isDraft
    ? (isAr ? 'هذا المنتج مسودة وغير متاح للشراء.' : 'This product is a draft and cannot be purchased.')
    : (isAr ? 'هذا المتجر موقوف حالياً. المنتج غير متاح للشراء.' : 'This store is currently suspended. This product cannot be purchased.');

  // Check if an option combo is unavailable (out of stock)
  const isOptionUnavailable = (typeName, optionValue) => {
    if (!product.stock_management) return false;
    // Build a partial selection with this option applied
    const testSelection = { ...selected, [typeName]: optionValue };
    const typesSelected = Object.keys(testSelection);
    // Check if ALL variants that would match this partial selection are out of stock
    const matchingVariants = product.variants?.filter(v =>
      typesSelected.every(tn =>
        v.selected_options?.some(o => o.type_name === tn && o.option_value === testSelection[tn])
      )
    ) ?? [];
    return matchingVariants.length > 0 && matchingVariants.every(v => v.stock <= 0);
  };

  const handleConfirm = () => {
    if (!allSelected || purchaseBlocked) return;
    if (mode === 'buyNow') {
      if (buyNow(product, activeVariant)) {
        onClose();
        router.push('/checkout?buy_now=1');
      }
      return;
    }
    addToCart(product, activeVariant);
    setAdded(true);
    setTimeout(() => { onClose(); }, 900);
  };

  return (
    <>
      {/* Backdrop */}
      <Overlay
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Modal */}
      <Overlay
        className="fixed bottom-0 left-0 right-0 sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-w-md w-full bg-white dark:bg-marine-navy rounded-t-3xl sm:rounded-xl shadow-2xl z-[201] overflow-hidden animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-300"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-marine-teal/15 dark:border-white/5">
          <h3 className="font-bold text-marine-ink dark:text-white text-base">
            {isAr ? 'اختر المواصفات' : 'Select Options'}
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-marine-mist dark:bg-white/10 text-marine-outline dark:text-white/60 hover:text-marine-ink dark:hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Product summary */}
          <div className="flex gap-4">
            {primaryImage && (
              <div className="w-20 h-20 rounded-lg overflow-hidden bg-marine-mist flex-shrink-0 border border-marine-teal/15 dark:border-white/5">
                <img src={primaryImage} alt={title} className="w-full h-full object-cover" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-bold text-marine-ink dark:text-white text-sm leading-snug line-clamp-2">{title}</p>
              <div className="flex items-baseline gap-2 mt-2">
                <span className="text-marine-primary font-bold text-2xl">
                  {siteSettings?.currency || 'QAR'} {price.toFixed(2)}
                </span>
                {hasDiscount && (
                  <span className="text-marine-outline text-sm line-through">
                    {siteSettings?.currency || 'QAR'} {original.toFixed(2)}
                  </span>
                )}
              </div>
              {!allSelected && (
                <p className="text-xs text-marine-outline mt-1">
                  {isAr ? 'اختر جميع الخيارات' : 'Select all options to see price'}
                </p>
              )}
            </div>
          </div>

          {purchaseBlocked && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
              {purchaseBlockedMessage}
            </div>
          )}

          {/* Variation pickers */}
          {variationTypes.map(vt => (
            <div key={vt.name} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-marine-outline uppercase tracking-widest">{vt.name}</span>
                {selected[vt.name] && (
                  <span className="text-xs text-marine-primary font-bold bg-red-50 dark:bg-red-500/10 px-2 py-0.5 rounded-lg">
                    {selected[vt.name]}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {(vt.options || []).map(opt => {
                  const isSelected = selected[vt.name] === opt.value;
                  const unavailable = isOptionUnavailable(vt.name, opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={unavailable}
                      onClick={() => setSelected(prev => ({ ...prev, [vt.name]: opt.value }))}
                      className={`px-4 py-2 rounded-xl text-sm font-bold border-2 transition-all duration-200 ${
                        unavailable
                          ? 'border-marine-teal/15 text-marine-line line-through cursor-not-allowed dark:border-white/5 dark:text-white/20'
                          : isSelected
                          ? 'border-marine-cyan bg-marine-cyan text-white shadow-md shadow-red-200 dark:shadow-marine-cyan/20 scale-105'
                          : 'border-marine-teal/15 dark:border-white/10 text-marine-muted dark:text-white hover:border-marine-cyan/50 hover:text-marine-primary dark:hover:border-marine-cyan/50'
                      }`}
                    >
                      {opt.value}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Active variant stock note */}
          {allSelected && activeVariant && product.stock_management && (
            <div className={`flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl ${
              activeVariant.stock > 0
                ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-red-50 dark:bg-red-500/10 text-red-500'
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${activeVariant.stock > 0 ? 'bg-emerald-500' : 'bg-red-500'}`} />
              {activeVariant.stock > 0
                ? (isAr ? 'متوفر في المخزون' : 'In Stock')
                : (isAr ? 'نفذت الكمية' : 'Out of Stock')}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="px-5 pb-6 pt-2 flex flex-col gap-3 border-t border-marine-teal/15 dark:border-white/5">
          <button
            onClick={handleConfirm}
            disabled={purchaseBlocked || !allSelected || added || (allSelected && activeVariant && product.stock_management && activeVariant.stock <= 0)}
            className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-lg font-bold text-base transition-all duration-300 ${
              added
                ? 'bg-emerald-500 text-white'
                : purchaseBlocked || !allSelected || (allSelected && activeVariant && product.stock_management && activeVariant.stock <= 0)
                ? 'bg-marine-mist dark:bg-white/5 text-marine-line cursor-not-allowed'
                : 'bg-marine-cyan hover:bg-marine-cyan-dark text-white shadow-lg shadow-red-200 dark:shadow-marine-cyan/20'
            }`}
          >
            <ShoppingCart size={18} />
            <span>
              {added
                ? (isAr ? '✓ تمت الإضافة' : '✓ Added!')
                : mode === 'buyNow'
                ? (isAr ? 'اشتري الآن' : 'Buy Now')
                : (isAr ? 'إضافة إلى السلة' : 'Add to Cart')}
            </span>
          </button>
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg border border-marine-teal/15 dark:border-white/10 text-sm text-marine-outline dark:text-white/40 font-semibold hover:bg-marine-canvas dark:hover:bg-white/5 transition-colors"
          >
            {isAr ? 'إلغاء' : 'Cancel'}
          </button>
        </div>
      </Overlay>
    </>
  );
}
