'use client';

import { memo, useState } from 'react';
import Link from './LocaleLink';
import { BadgeCheck, ShoppingCart, Star } from 'lucide-react';
import { useApp } from '../context/AppContext';
import VariantPickerModal from './VariantPickerModal';
import { useRouter } from '../lib/navigation';
import { cardPricing } from '../lib/productPricing';
import { useAdImpression, trackAdClick, trackAdAction } from '../lib/adTracking';
import { thumbUrl } from '../lib/assets';

function ProductCard({ product, showBadge }) {
  const { addToCart, setIsCartOpen, buyNow, language, t, user, siteSettings } = useApp();
  const router = useRouter();
  const isAr = language === 'ar';
  const isStaffAccount = user?.role === 'vendor' || user?.role === 'admin';

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState('cart');

  const productSlug = isAr ? (product.slug_ar || product.slug_en) : (product.slug_en || product.slug_ar);
  const isOutOfStock = product.stock_management && (product.quantity <= 0);
  const isDraft = product.status === 'draft';
  const isVendorSuspended = product.vendor_id?.status === 'suspended';

  // Lowest price across variants (for display). The crossed-out figure is only
  // ever the higher one — see resolvePricing() in lib/productPricing.
  const {
    price: displayPrice,
    original: originalDisplayPrice,
    hasDiscount,
    hasVariants,
  } = cardPricing(product);

  // A sponsored card is an ad: report that it was seen, followed, and bought from.
  const adId = product.ad_id || '';
  const adPlacement = product.ad_placement || 'product';
  const adRef = useAdImpression(adId, { placement: adPlacement });
  const adSubjects = [product._id, `/product/${productSlug}`];
  const reportAdClick = () => { if (adId) trackAdClick(adId, { placement: adPlacement, target: `/product/${productSlug}`, subjects: adSubjects }); };
  const reportAdAction = (action) => { if (adId) trackAdAction(action, adSubjects, { adId, placement: adPlacement }); };

  const disabled = isStaffAccount || isOutOfStock || isDraft || isVendorSuspended;
  const disabledTitle = isStaffAccount
    ? (isAr ? 'حسابات الإدارة والبائعين لا يمكنها الشراء' : 'Admin and vendor accounts cannot purchase')
    : isDraft ? (isAr ? 'هذا المنتج مسودة وغير متاح للشراء' : 'This product is a draft and cannot be purchased')
    : isVendorSuspended ? (isAr ? 'هذا المتجر موقوف حالياً' : 'This store is currently suspended')
    : isOutOfStock ? (isAr ? 'نفذت الكمية' : 'Out of Stock') : '';

  const handleAddToCart = (e) => {
    e.preventDefault();
    if (disabled) return;
    reportAdAction('add_to_cart');
    if (hasVariants) {
      setPickerMode('cart');
      setPickerOpen(true);
      return;
    }
    addToCart(product, null);
    setIsCartOpen(true);
  };

  const handleBuyNow = (e) => {
    e.preventDefault();
    if (disabled) return;
    reportAdAction('buy_now');
    if (hasVariants) {
      setPickerMode('buyNow');
      setPickerOpen(true);
      return;
    }
    if (buyNow(product, null)) {
      router.push('/checkout?buy_now=1');
    }
  };

  const title = isAr ? (product.title_ar || product.title_en) : product.title_en;
  const currency = siteSettings?.currency || 'EGP';
  const partCode = product.part_number || product.sku || '';
  const brandName = product.product_brand_id?.name_en || product.product_brand_id?.name || product.vendor_id?.store_name || '';
  // The first vessel/engine the part is listed for — the card's fitment chip.
  const fitment = product.is_universal
    ? (isAr ? 'مناسب لكل الموديلات' : 'Universal fit')
    : (product.compatible_cars || []).slice(0, 2)
        .map((car) => [car.brand_name, car.models?.[0]?.model_name].filter(Boolean).join(' '))
        .filter(Boolean).join(' & ');
  const stockLabel = isOutOfStock
    ? (isAr ? 'نفذت الكمية' : 'Out of stock')
    : product.stock_management && product.quantity > 0
      ? (isAr ? `متاح: ${product.quantity}` : `${product.quantity} in stock`)
      : (isAr ? 'متاح' : 'In stock');

  return (
    <>
      <div ref={adRef} className="group bg-white rounded-lg border border-marine-teal/15 hover:border-marine-cyan hover:shadow-aura overflow-hidden hover:-translate-y-0.5 transition-all duration-300 flex flex-col h-full">
        <div className="relative">
        <Link href={`/product/${productSlug}`} className="block" onClick={reportAdClick} tabIndex={-1} aria-hidden="true">
          <div className="relative overflow-hidden aspect-square sm:aspect-[4/3] bg-marine-canvas">
            <img
              src={thumbUrl(product.images?.[0]?.url || product.image, 480)}
              alt={title}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-contain p-3 group-hover:scale-105 transition-transform duration-500"
            />
            {/* The part number and the maker, stamped on the photo like an OEM tag. */}
            {partCode && (
              <div className="absolute top-2 start-2 max-w-[60%] truncate bg-white/95 border border-marine-teal/15 text-marine-teal font-display text-[10px] font-medium tracking-[0.04em] px-1.5 py-0.5 rounded-sm">
                OEM #{partCode}
              </div>
            )}
            {product.sponsored ? (
              <div className="absolute top-2 end-2 bg-marine-warning text-white font-display text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded-sm">
                {isAr ? 'مموّل' : 'Sponsored'}
              </div>
            ) : hasDiscount ? (
              <div className="absolute top-2 end-2 bg-red-600 text-white font-display text-[10px] font-bold px-1.5 py-0.5 rounded-sm">
                -{Math.round((1 - displayPrice / originalDisplayPrice) * 100)}%
              </div>
            ) : brandName ? (
              <div className="absolute top-2 end-2 max-w-[40%] truncate bg-marine-teal text-white font-display text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded-sm">
                {brandName}
              </div>
            ) : null}
            {hasVariants && (
              <div className="absolute bottom-2 end-2 bg-white/95 text-marine-primary font-display text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded-sm border border-marine-cyan/30">
                {isAr ? 'متعدد الخيارات' : 'Options'}
              </div>
            )}
            {/* Set by the shop and the recommendations: a part made for the customer's vessel. */}
            {product.fit === 'car' && (
              <div className="absolute bottom-2 start-2 flex items-center gap-1 bg-marine-success text-white font-display text-[10px] font-bold px-1.5 py-0.5 rounded-sm">
                <BadgeCheck size={12} aria-hidden="true" />
                {isAr ? 'مضمون التوافق' : 'Guaranteed fit'}
              </div>
            )}
          </div>
        </Link>
        </div>

        <Link href={`/product/${productSlug}`} className="flex flex-col flex-1" onClick={reportAdClick}>
          <div className="p-3 sm:p-4 flex flex-col flex-1">
            <div className="flex items-center gap-1 mb-1.5">
              <div className="flex">
                {[...Array(5)].map((_, i) => (
                  <Star
                    key={i}
                    size={11}
                    className={i < Math.round(product.rating) ? 'text-amber-400 fill-amber-400' : 'text-marine-frost fill-marine-frost'}
                  />
                ))}
              </div>
              <span className="text-marine-outline text-[11px]">({product.reviews_count || 0} {isAr ? 'تقييم' : 'reviews'})</span>
            </div>

            <h3 className="text-marine-ink font-semibold text-xs sm:text-sm leading-snug mb-2 line-clamp-2 min-h-[2rem] sm:min-h-[2.5rem]">
              {title}
            </h3>

            {fitment && (
              <div className="flex items-start gap-1 mb-3 bg-marine-mist border border-marine-cyan/20 text-marine-primary font-display text-[10px] font-medium tracking-[0.04em] px-2 py-1 rounded-sm line-clamp-2">
                <BadgeCheck size={11} className="flex-shrink-0 mt-px" aria-hidden="true" />
                <span>{isAr ? 'متوافق مع: ' : 'Fits: '}{fitment}</span>
              </div>
            )}

            <div className="flex items-end justify-between gap-2 mt-auto">
              <div className="min-w-0">
                {hasDiscount && (
                  <div className="text-marine-outline text-[11px] line-through font-display">
                    {originalDisplayPrice.toLocaleString()} {currency}
                  </div>
                )}
                <div className="flex items-baseline gap-1">
                  {hasVariants && <span className="text-marine-outline text-[11px]">{isAr ? 'من' : 'From'}</span>}
                  <span className="font-display text-marine-navy font-bold text-base sm:text-xl">{displayPrice.toLocaleString()}</span>
                  <span className="font-display text-marine-muted text-[11px]">{currency}</span>
                </div>
              </div>
              <span className={`hidden sm:inline-block flex-shrink-0 font-display text-[9px] font-bold uppercase tracking-[0.06em] px-1.5 py-1 rounded-sm border ${isOutOfStock ? 'text-red-600 border-red-200 bg-red-50' : 'text-marine-success border-marine-success/25 bg-marine-success/10'}`}>
                {stockLabel}
              </span>
            </div>
          </div>
        </Link>

        <div className="grid gap-2 px-3 pb-3 sm:px-4 sm:pb-4">
          <button
            type="button"
            onClick={handleAddToCart}
            disabled={disabled}
            title={disabledTitle}
            className={`flex items-center justify-center gap-1.5 font-display font-bold text-[11px] uppercase tracking-[0.06em] py-2.5 rounded border transition-colors ${
              disabled
                ? 'bg-marine-haze text-marine-line cursor-not-allowed'
                : 'bg-marine-cyan hover:bg-marine-cyan-dark text-white'
            }`}
          >
            <ShoppingCart size={14} />
            <span > {isAr ? 'أضف' : 'Add'}</span>
          </button>
          {/* <button
            type="button"
            onClick={handleBuyNow}
            disabled={disabled}
            title={disabledTitle}
            className={`font-display font-bold text-[11px] uppercase tracking-[0.06em] py-2.5 rounded transition-colors ${
              disabled
                ? 'bg-marine-haze text-marine-line cursor-not-allowed'
                : 'bg-marine-cyan hover:bg-marine-cyan-dark text-white'
            }`}
          >
            {t.buyNow}
          </button> */}
        </div>
      </div>

      {/* Variant picker popup */}
      <VariantPickerModal
        product={product}
        isOpen={pickerOpen}
        mode={pickerMode}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );
}

// The shop's endless list adds pages under cards already on screen; a card only redraws when
// its own product (or the app's language, cart or user, through useApp) changes.
export default memo(ProductCard);
