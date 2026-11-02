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
  const brandName = product.product_brand_id?.name_en || product.product_brand_id?.name || '';
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

  const reasonBadge = (() => {
    switch (product.reason) {
      case 'interest':
        return { text: isAr ? 'حسب اهتماماتك' : 'For your interests', icon: '✨', cls: 'bg-marine-cyan/10 text-marine-primary border-marine-cyan/20' };
      case 'popular':
        return { text: isAr ? 'الأكثر طلباً' : 'Best seller', icon: '🔥', cls: 'bg-amber-500/10 text-amber-700 border-amber-500/20' };
      case 'new':
        return { text: isAr ? 'وصل حديثاً' : 'New arrival', icon: '🆕', cls: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' };
      case 'cart':
        return { text: isAr ? 'مكمل لسلتك' : 'Matches cart', icon: '🛒', cls: 'bg-indigo-500/10 text-indigo-700 border-indigo-500/20' };
      case 'vessel':
        return { text: isAr ? 'مناسب لمركبك' : 'Fits boat', icon: '🛥️', cls: 'bg-marine-success/10 text-marine-success border-marine-success/20' };
      default:
        return null;
    }
  })();

  return (
    <>
      <div ref={adRef} className="group bg-white rounded-xl sm:rounded-2xl border border-zinc-200/80 hover:border-marine-cyan hover:shadow-md overflow-hidden hover:-translate-y-0.5 transition-all duration-200 flex flex-col h-full shadow-2xs">
        <div className="relative">
          <Link href={`/product/${productSlug}`} className="block" onClick={reportAdClick} tabIndex={-1} aria-hidden="true">
            <div className="relative overflow-hidden aspect-[4/3] bg-marine-canvas/70">
              <img
                src={thumbUrl(product.images?.[0]?.url || product.image, 480)}
                alt={title}
                loading="lazy"
                decoding="async"
                className="w-full h-full object-contain p-2 sm:p-2.5 group-hover:scale-105 transition-transform duration-300"
              />
              {/* Part code badge */}
              {partCode && (
                <div className="absolute top-1.5 start-1.5 max-w-[55%] truncate bg-white/90 border border-marine-teal/15 text-marine-teal font-display text-[9px] font-medium px-1.5 py-0.5 rounded shadow-xs">
                  OEM #{partCode}
                </div>
              )}
              {product.sponsored ? (
                <div className="absolute top-1.5 end-1.5 bg-amber-500 text-white font-display text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shadow-xs">
                  {isAr ? 'مموّل' : 'Sponsored'}
                </div>
              ) : hasDiscount ? (
                <div className="absolute top-1.5 end-1.5 bg-red-600 text-white font-display text-[9px] font-bold px-1.5 py-0.5 rounded shadow-xs">
                  -{Math.round((1 - displayPrice / originalDisplayPrice) * 100)}%
                </div>
              ) : brandName ? (
                <div className="absolute top-1.5 end-1.5 max-w-[45%] truncate bg-marine-teal text-white font-display text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shadow-xs">
                  {brandName}
                </div>
              ) : null}
              {hasVariants && (
                <div className="absolute bottom-1.5 end-1.5 bg-white/90 text-marine-primary font-display text-[9px] font-bold px-1.5 py-0.5 rounded border border-marine-cyan/30 shadow-xs">
                  {isAr ? 'خيارات' : 'Options'}
                </div>
              )}
              {product.fit === 'car' && (
                <div className="absolute bottom-1.5 start-1.5 flex items-center gap-1 bg-marine-success text-white font-display text-[9px] font-bold px-1.5 py-0.5 rounded shadow-xs">
                  <BadgeCheck size={11} aria-hidden="true" />
                  {isAr ? 'مضمون' : 'Fits'}
                </div>
              )}
            </div>
          </Link>
        </div>

        <div className="p-2.5 sm:p-3 flex flex-col flex-1 justify-between">
          <Link href={`/product/${productSlug}`} className="block flex-1" onClick={reportAdClick}>
            {reasonBadge && (
              <div className="mb-1">
                <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded border ${reasonBadge.cls}`}>
                  <span>{reasonBadge.icon}</span>
                  <span>{reasonBadge.text}</span>
                </span>
              </div>
            )}
            <div className="flex items-center gap-1 mb-1 text-[11px] text-zinc-500">
              <Star size={11} className="text-amber-400 fill-amber-400 shrink-0" />
              <span className="font-semibold text-zinc-700">{product.rating ? Number(product.rating).toFixed(1) : '5.0'}</span>
              <span className="text-[10px] text-zinc-400">({product.reviews_count || 0})</span>
            </div>

            <h3 className="text-marine-ink font-bold text-xs sm:text-[13px] leading-tight line-clamp-2 mb-1 min-h-[2rem]">
              {title}
            </h3>

            {fitment && (
              <p className="text-[10px] text-marine-outline truncate flex items-center gap-1 mb-1">
                <BadgeCheck size={11} className="text-marine-cyan shrink-0" aria-hidden="true" />
                <span className="truncate">{fitment}</span>
              </p>
            )}
          </Link>

          {/* Bottom row: Price and Add-to-cart button */}
          <div className="pt-2 mt-auto flex flex-col gap-1.5 border-t border-zinc-100">
            <div className="flex items-baseline justify-between gap-1">
              <div>
                {hasDiscount && (
                  <span className="text-zinc-400 text-[10px] line-through font-display me-1.5 leading-none">
                    {originalDisplayPrice.toLocaleString()} {currency}
                  </span>
                )}
                <span className="font-display text-marine-navy font-black text-sm sm:text-base leading-none">
                  {displayPrice.toLocaleString()}
                </span>
                <span className="font-display text-zinc-500 text-[10px] font-medium ms-0.5">{currency}</span>
              </div>
              {hasVariants && <span className="text-zinc-400 text-[9px] font-medium">{isAr ? 'متعدد الخيارات' : 'Options'}</span>}
            </div>

            <button
              type="button"
              onClick={handleAddToCart}
              disabled={disabled}
              title={disabledTitle}
              className={`w-full h-8 sm:h-8.5 rounded-lg flex items-center justify-center gap-1.5 text-xs font-bold transition-all shadow-xs active:scale-98 ${
                disabled
                  ? 'bg-zinc-100 text-zinc-400 border border-zinc-200 cursor-not-allowed'
                  : 'bg-marine-cyan hover:bg-marine-cyan-dark text-white'
              }`}
            >
              <ShoppingCart size={13} />
              <span>{isAr ? 'أضف إلى السلة' : 'Add to cart'}</span>
            </button>
          </div>
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
