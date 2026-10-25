'use client';

import { storePath, storeKey } from '../../../lib/storeLink';
import { useEffect, useState, useMemo } from 'react';
import {
  ShoppingCart,
  Star,
  ShieldCheck,
  Truck,
  RotateCcw,
  CheckCircle2,
  Info,
  Store,
  ChevronRight,
  ArrowLeft,
  Car,
  Hash,
  Barcode,
  Settings,
  Gauge,
  Globe,
  Layers,
  Calendar,
  X,
  AlertTriangle,
  MessageCircle,
} from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import ProductReviews from '../../../components/reviews/ProductReviews';
import VendorTrustStats from '../../../components/reviews/VendorTrustStats';
import Link from '../../../components/LocaleLink';
import { useRouter } from '../../../lib/navigation';
import { resolveAssetUrl } from '../../../lib/assets';
import { variantPricing } from '../../../lib/productPricing';
import { trackAdAction } from '../../../lib/adTracking';
import ShareProductButton from '../../../components/products/ShareProductButton';
import useGarageCars from '../../../components/company/useGarageCars';
import RelatedProducts from '../../../components/marine/RelatedProducts';

const PART_TYPE_BADGE = {
  original: { en: 'Original part', ar: 'قطعة أصلية' },
  oem: { en: 'OEM part', ar: 'قطعة OEM' },
  aftermarket: { en: 'Aftermarket part', ar: 'قطعة تجارية' },
};

/* ─────────────────────────────────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────────────────────────────────── */

/**
 * Resolve compatibility reason for one garage car against a product.
 * Returns { isCompatible, reason, reasonKey }
 */
function resolveCompatibility(car, product) {
  if (!product) return { isCompatible: false, reason: '', reasonKey: '' };

  if (product.is_universal) {
    return { isCompatible: true, reasonKey: 'universal', brand: '', model: '' };
  }

  if (!product.compatible_cars || product.compatible_cars.length === 0) {
    return { isCompatible: false, reasonKey: '', brand: '', model: '' };
  }

  for (const pBrand of product.compatible_cars) {
    const brandMatches = String(car.car_brand_id) === String(pBrand.brand_id);
    if (!brandMatches) continue;

    // all_models → compatible with every model of this brand
    if (pBrand.all_models) {
      return { isCompatible: true, reasonKey: 'all_models', brand: pBrand.brand_name, model: '' };
    }

    // check models
    for (const pModel of pBrand.models) {
      const modelMatches = String(car.car_model_id) === String(pModel.model_id);
      if (!modelMatches) continue;

      // all_years → compatible with every year of this model
      if (pModel.all_years) {
        return { isCompatible: true, reasonKey: 'all_years', brand: pBrand.brand_name, model: pModel.model_name };
      }

      // specific year check
      if (pModel.years && pModel.years.includes(car.year)) {
        return { isCompatible: true, reasonKey: 'year_match', brand: pBrand.brand_name, model: pModel.model_name };
      }
    }
  }

  return { isCompatible: false, reasonKey: '', brand: '', model: '' };
}

/**
 * Build a human-readable compatibility reason string using translation keys.
 */
function buildReason(result, t) {
  switch (result.reasonKey) {
    case 'universal':
      return t.reasonUniversal;
    case 'all_models':
      return (t.reasonAllModels || 'Compatible with all {brand} models').replace('{brand}', result.brand);
    case 'all_years':
      return (t.reasonAllYears || 'Compatible with all {brand} {model} years')
        .replace('{brand}', result.brand)
        .replace('{model}', result.model);
    case 'year_match':
      return t.reasonYearMatch || 'Exact year match';
    default:
      return '';
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   GARAGE FITMENT SECTION  (new premium component)
───────────────────────────────────────────────────────────────────────────── */
function GarageFitmentSection({ garageCompatibility, t, isAr, user }) {
  if (!user) {
    return (
      <div className="relative overflow-hidden rounded-lg sm:rounded-xl border border-dashed border-marine-teal/15 bg-marine-canvas p-4 sm:p-8 text-center">
        <Car size={36} className="mx-auto mb-2 sm:mb-3 text-marine-line w-7 h-7 sm:w-9 sm:h-9" />
        <p className="font-bold text-marine-outline text-sm uppercase tracking-widest">{isAr ? 'قم بتسجيل الدخول لفحص التوافق' : 'Log in to check compatibility'}</p>
        <Link
          href="/login"
          className="mt-2 sm:mt-4 inline-flex items-center gap-2 text-xs font-bold text-marine-primary hover:underline uppercase tracking-widest"
        >
          {isAr ? 'تسجيل الدخول' : 'Sign In'}
          <ChevronRight size={12} className={isAr ? 'rotate-180' : ''} />
        </Link>
      </div>
    );
  }

  if (!garageCompatibility || garageCompatibility.length === 0) {
    return (
      <div className="relative overflow-hidden rounded-lg sm:rounded-xl border border-dashed border-marine-teal/15 bg-marine-canvas p-4 sm:p-8 text-center">
        <Car size={36} className="mx-auto mb-2 sm:mb-3 text-marine-line w-7 h-7 sm:w-9 sm:h-9" />
        <p className="font-bold text-marine-outline text-sm uppercase tracking-widest">{t.noGarageCars}</p>
        <Link
          href="/profile?tab=garage"
          className="mt-2 sm:mt-4 inline-flex items-center gap-2 text-xs font-bold text-marine-primary hover:underline uppercase tracking-widest"
        >
          {t.addCarToGarage}
          <ChevronRight size={12} className={isAr ? 'rotate-180' : ''} />
        </Link>
      </div>
    );
  }

  const compatibleCars    = garageCompatibility.filter(c => c.isCompatible);
  const notCompatibleCars = garageCompatibility.filter(c => !c.isCompatible);

  return (
    <div className="relative group overflow-hidden rounded-lg sm:rounded-[2.5rem] bg-gradient-to-br from-[#09090b] via-[#232830] to-[#09090b] border border-white/5 shadow-2xl">
      {/* Background glow */}
      <div className="pointer-events-none absolute -top-16 -right-16 w-64 h-64 rounded-full bg-marine-cyan opacity-10 blur-[80px]" />
      <div className="pointer-events-none absolute -bottom-16 -left-16 w-64 h-64 rounded-full bg-blue-500 opacity-5 blur-[80px]" />

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between gap-3 px-4 pt-4 sm:px-8 sm:pt-8 pb-3 sm:pb-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-marine-cyan shadow-lg shadow-marine-cyan/20">
            <Car size={22} className="text-white" />
          </div>
          <div>
            <h4 className="font-bold text-white text-lg leading-tight">{t.garageReport}</h4>
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-[0.18em]">
              {t.verifiedForYourVehicles}
            </p>
          </div>
        </div>
        <Link
          href="/profile?tab=garage"
          className="rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-2 text-[10px] font-bold text-marine-primary uppercase tracking-widest transition-colors"
        >
          {t.manageGarage}
        </Link>
      </div>

      {/* Compatible cars */}
      {compatibleCars.length > 0 && (
        <div className="relative z-10 px-4 sm:px-8 pb-4">
          <p className="mb-3 flex items-center gap-2 text-[10px] font-bold text-emerald-400 uppercase tracking-widest">
            <CheckCircle2 size={12} />
            {t.compatibleCarsHeader}
          </p>
          <div className="grid gap-3">
            {compatibleCars.map((car, idx) => (
              <CarCompatibilityCard key={idx} car={car} isCompatible={true} t={t} isAr={isAr} />
            ))}
          </div>
        </div>
      )}

      {/* Not compatible cars */}
      {notCompatibleCars.length > 0 && (
        <div className="relative z-10 px-4 sm:px-8 pb-4 sm:pb-8">
          {compatibleCars.length > 0 && (
            <div className="my-4 border-t border-white/5" />
          )}
          <p className="mb-3 flex items-center gap-2 text-[10px] font-bold text-red-400 uppercase tracking-widest">
            <X size={12} />
            {t.notCompatibleCarsHeader}
          </p>
          <div className="grid gap-3">
            {notCompatibleCars.map((car, idx) => (
              <CarCompatibilityCard key={idx} car={car} isCompatible={false} t={t} isAr={isAr} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CarCompatibilityCard({ car, isCompatible, t, isAr }) {
  const reason = buildReason({ isCompatible: car.isCompatible, reasonKey: car.reasonKey, brand: car.reasonBrand, model: car.reasonModel }, t);

  return (
    <div
      className={`group/card relative flex items-center justify-between gap-3 sm:gap-4 rounded-lg border p-3 sm:p-4 transition-all duration-300 ${
        isCompatible
          ? 'bg-emerald-500/10 border-emerald-500/20 hover:border-emerald-400/40'
          : 'bg-white/5 border-white/10 hover:border-white/20'
      }`}
    >
      {/* Left: car info */}
      <div className="flex items-center gap-4 min-w-0">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl shadow-inner transition-transform duration-300 group-hover/card:scale-105 ${
            isCompatible ? 'bg-emerald-500 text-white' : 'bg-white/10 text-white/40'
          }`}
        >
          {isCompatible ? <ShieldCheck size={20} /> : <X size={20} />}
        </div>
        <div className="min-w-0">
          <p className="font-bold text-white text-sm truncate">
            {car.year} {car.car_brand_name}
          </p>
          <p className="text-[11px] font-bold text-white/50 truncate">
            {car.car_model_name}
            {car.kind === 'company' && ` · ${car.plate} · ${isAr ? 'عربية' : ''} ${car.company_name}`}
          </p>
          {isCompatible && reason && (
            <p className="mt-1 text-[10px] font-bold text-emerald-400 flex items-center gap-1">
              <Gauge size={9} />
              {reason}
            </p>
          )}
        </div>
      </div>

      {/* Right: badge */}
      <div
        className={`shrink-0 rounded-xl px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest ${
          isCompatible
            ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-900/40'
            : 'bg-white/10 text-white/50'
        }`}
      >
        {isCompatible ? t.exactFit : t.noFit}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   GENERAL COMPATIBILITY SECTION
───────────────────────────────────────────────────────────────────────────── */
function GeneralCompatibilitySection({ product, t, isAr }) {
  if (product.is_universal) {
    return (
      <div className="bg-marine-navy rounded-lg sm:rounded-[2.5rem] p-5 sm:p-10 relative overflow-hidden shadow-2xl">
        <div className="pointer-events-none absolute top-0 right-0 w-96 h-96 bg-emerald-500 rounded-full blur-[150px] opacity-10 -translate-y-1/2 translate-x-1/2" />
        <div className="relative z-10 flex flex-col items-center text-center gap-4 sm:gap-6">
          <div className="flex h-14 w-14 sm:h-20 sm:w-20 items-center justify-center rounded-lg sm:rounded-xl bg-emerald-500/20 border border-emerald-500/30 shadow-lg">
            <Globe size={36} className="text-emerald-400" />
          </div>
          <div>
            <span className="block text-[10px] font-bold text-emerald-400 uppercase tracking-widest mb-2">
              {t.universalFit}
            </span>
            <h3 className="text-white font-bold text-xl sm:text-3xl mb-1 sm:mb-2">{t.universalCompatible}</h3>
            <p className="text-marine-outline font-bold text-sm sm:text-base">{t.universalCompatibleSub}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2 sm:gap-3">
            {['Toyota', 'Honda', 'BMW', 'Mercedes', 'Nissan', 'Hyundai'].map(brand => (
              <div key={brand} className="rounded-lg bg-white/5 border border-white/10 px-5 py-2 text-sm font-bold text-marine-line">
                {brand}
              </div>
            ))}
            <div className="rounded-lg bg-marine-cyan/20 border border-marine-cyan/30 px-5 py-2 text-sm font-bold text-marine-primary">
              + {isAr ? 'وأكثر' : 'and more'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!product.compatible_cars || product.compatible_cars.length === 0) return null;

  return (
    <div className="bg-marine-navy rounded-lg sm:rounded-[2.5rem] p-4 sm:p-10 space-y-8 relative overflow-hidden shadow-2xl">
      <div className="pointer-events-none absolute top-0 right-0 w-96 h-96 bg-blue-600 rounded-full blur-[150px] opacity-10 -translate-y-1/2 translate-x-1/2" />
      <div className="relative z-10">
        {/* Section Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-8">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="bg-marine-cyan text-white p-3 sm:p-4 rounded-xl sm:rounded-lg shadow-lg shadow-marine-cyan/20 [&>svg]:w-5 [&>svg]:h-5 sm:[&>svg]:w-7 sm:[&>svg]:h-7">
              <Car size={28} />
            </div>
            <div>
              <h3 className="text-white font-bold text-lg sm:text-2xl">{t.vehicleFitment}</h3>
              <p className="text-marine-outline text-xs sm:text-sm font-bold">{t.vehicleFitmentSub}</p>
            </div>
          </div>
          <div className="px-4 py-1.5 sm:px-5 sm:py-2 bg-emerald-500/10 text-emerald-400 rounded-full border border-emerald-500/20 text-[10px] font-bold uppercase tracking-widest">
            {t.guaranteedFit}
          </div>
        </div>

        {/* Brand Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-5">
          {product.compatible_cars.map((carEntry, idx) => (
            <BrandCompatibilityCard key={idx} carEntry={carEntry} t={t} isAr={isAr} />
          ))}
        </div>
      </div>
    </div>
  );
}

function BrandCompatibilityCard({ carEntry, t, isAr }) {
  return (
    <div className="bg-white/5 backdrop-blur-md rounded-lg sm:rounded-xl border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300 overflow-hidden">
      {/* Brand header */}
      <div className="flex items-center gap-3 p-3 sm:p-5 border-b border-white/5 bg-white/5">
        <Car size={20} className="text-marine-primary" />
        <span className="font-bold text-white text-base sm:text-lg">{carEntry.brand_name}</span>
      </div>

      {/* Models / Tags */}
      <div className="p-3 sm:p-5">
        {carEntry.all_models ? (
          /* All models badge */
          <div className="flex items-center gap-2 rounded-lg bg-marine-cyan/20 border border-marine-cyan/30 px-4 py-3">
            <Layers size={14} className="text-marine-primary shrink-0" />
            <span className="text-sm font-bold text-marine-primary">
              {isAr ? `جميع موديلات ${carEntry.brand_name}` : `All ${carEntry.brand_name} Models`}
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {carEntry.models.map((model, midx) => (
              <ModelTag key={midx} model={model} t={t} isAr={isAr} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ModelTag({ model, t, isAr }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-white/10 border border-white/10 hover:bg-marine-cyan/20 hover:border-marine-cyan/30 transition-colors cursor-default px-3 py-2 text-xs">
      <span className="font-bold text-white/90">{model.model_name}</span>
      <span className="text-white/20 text-[10px]">|</span>
      {model.all_years ? (
        <span className="flex items-center gap-1 font-bold text-marine-primary">
          <Calendar size={10} />
          {t.allYears}
        </span>
      ) : (
        <span className="font-bold text-white/50">{model.years.join(', ')}</span>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────────────────────── */
export default function ProductDetailsPage({ params }) {
  const { user, addToCart, buyNow, setIsCartOpen, language, isMounted, t, siteSettings } = useApp();
  const router = useRouter();
  const isAr = language === 'ar';
  const isStaffAccount = user?.role === 'vendor' || user?.role === 'admin';

  const slug = params?.slug;

  const [product, setProduct]         = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [selectedImage, setSelectedImage] = useState(0);
  const [selectedOptions, setSelectedOptions] = useState({});

  useEffect(() => {
    if (!slug) return;

    const fetchProduct = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/products/slug/${slug}`);
        if (!res.ok) throw new Error('Failed to fetch product');
        const data = await res.json();
        setProduct(data);
        trackAdAction('view_product', [data?._id, `/product/${slug}`]);

        if (data.variation_types?.length > 0) {
          const initialOptions = {};
          data.variation_types.forEach(type => {
            if (type.options?.length > 0) {
              initialOptions[type.name] = type.options[0].value;
            }
          });
          setSelectedOptions(initialOptions);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchProduct();
  }, [slug]);

  // Language switch — redirect to correct slug. The language itself comes from the URL
  // (/ar/product/…), which is how a shared link opens in the language it was shared in.
  useEffect(() => {
    if (product && isMounted) {
      const correctSlug = isAr ? product.slug_ar : product.slug_en;
      if (correctSlug && slug !== correctSlug) {
        router.push(`/product/${correctSlug}`);
      }
    }
  }, [language, product, isMounted, slug, isAr, router]);

  // Determine active variant
  const activeVariant = useMemo(() => {
    if (!product || !product.variants || product.variants.length === 0) return null;
    return product.variants.find(variant =>
      variant.selected_options.every(opt => selectedOptions[opt.type_name] === opt.option_value)
    );
  }, [product, selectedOptions]);

  // ── Garage compatibility algorithm ──────────────────────────────────────────
  // The garage, plus the company's cars for someone who manages a company account.
  const garageCars = useGarageCars();
  const garageCompatibility = useMemo(() => {
    const userCars = garageCars;
    if (userCars.length === 0 || !product) return null;

    return userCars.map(car => {
      const result = resolveCompatibility(car, product);
      return {
        ...car,
        isCompatible: result.isCompatible,
        reasonKey:    result.reasonKey,
        reasonBrand:  result.brand,
        reasonModel:  result.model,
      };
    });
  }, [garageCars, product]);

  // Quick summary for price box badge
  const hasAnyCompatible = useMemo(() =>
    garageCompatibility?.some(c => c.isCompatible) ?? false,
  [garageCompatibility]);

  /* ── Render states ── */
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-marine-canvas">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-marine-cyan" />
      </div>
    );
  }

  if (error || !product) {
    // A product that is not published answers 404 here, which is not a fault the reader can
    // do anything about — and "error loading product" sends them to support over a product
    // the shop simply took down. Say which of the two it is.
    const missing = !product && /not found/i.test(String(error || ''));
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-marine-canvas px-6 text-center">
        <p className={`font-bold ${missing ? 'text-marine-muted' : 'text-red-500'}`}>
          {missing
            ? (isAr ? 'المنتج ده مش متاح دلوقتي.' : 'This product is not available right now.')
            : (t.error || 'Error loading product')}
        </p>
        {missing && (
          <Link href="/products" className="text-sm font-bold text-marine-primary hover:underline">
            {isAr ? 'تصفح باقي المنتجات' : 'Browse other products'}
          </Link>
        )}
      </div>
    );
  }

  const primaryImage   = product.images?.find(img => img.is_primary)?.url || product.images?.[0]?.url || '';
  // Variant price is an absolute override, not a modifier. null = use product base.
  const {
    price: currentPrice,
    original: originalPrice,
    hasDiscount,
    discountPct,
  } = variantPricing(product, activeVariant);

  const handleOptionSelect = (typeName, value) =>
    setSelectedOptions(prev => ({ ...prev, [typeName]: value }));

  // Check if all variation types have a selection
  const allOptionsSelected = !product.variation_types?.length ||
    product.variation_types.every(vt => selectedOptions[vt.name]);

  const displayTitle       = isAr ? (product.title_ar       || product.title_en)       : product.title_en;
  const displaySubtitle    = isAr ? (product.subtitle_ar    || product.subtitle_en)    : product.subtitle_en;
  const displayDescription = isAr ? (product.description_ar || product.description_en) : product.description_en;

  const stockQty = activeVariant?.stock ?? product.quantity ?? 0;
  const isDraftPreview = product.status === 'draft';
  const isVendorSuspended = product.vendor_id?.status === 'suspended';
  const purchaseBlocked = isDraftPreview || isVendorSuspended;
  const purchaseBlockedMessage = isDraftPreview
    ? (isAr
        ? 'هذا المنتج في وضع المسودة. يمكنك معاينة صفحة المنتج من الرابط المباشر، لكنه مخفي من الموقع ولا يمكن شراؤه حتى يتم نشره.'
        : 'This product is a draft preview. It is hidden from the public website and cannot be purchased until it is published.')
    : (isAr
        ? 'هذا المتجر موقوف حالياً. المنتج مخفي من الموقع ولا يمكن إضافته إلى السلة أو شراؤه.'
        : 'This store is currently suspended. This product is hidden from the website and cannot be added to cart or purchased.');
  const actionDisabled = (product.stock_management && stockQty <= 0) || isStaffAccount || !allOptionsSelected || purchaseBlocked;

  const handleAddToCart = () => {
    if (actionDisabled) return;
    trackAdAction('add_to_cart', [product?._id, `/product/${slug}`]);
    const added = addToCart(product, activeVariant || null);
    if (added) setIsCartOpen(true);
  };

  const handleBuyNow = () => {
    if (actionDisabled) return;
    trackAdAction('buy_now', [product?._id, `/product/${slug}`]);
    if (buyNow(product, activeVariant || null)) {
      router.push('/checkout?buy_now=1');
    }
  };

  const getCategoryHierarchy = (cat) => {
    const list = [];
    let current = cat;
    // Walk up the parent chain using populated objects
    while (current && (current.name || current.name_ar)) {
      list.unshift(current);
      if (current.parent_id && typeof current.parent_id === 'object') {
        current = current.parent_id;
      } else {
        break;
      }
    }
    return list;
  };
  const categoryHierarchy = product.category_id ? getCategoryHierarchy(product.category_id) : [];

  const fullCategoryPath = categoryHierarchy
    .map(cat => (isAr ? (cat.name_ar || cat.name) : (cat.name || cat.name_ar)))
    .join(' > ');

  return (
    <div className="bg-marine-canvas min-h-screen pb-20" dir={isAr ? 'rtl' : 'ltr'}>

      {/* ── Back (phone) ─────────────────────────────────────────────────────── */}
      {/* Back to where the visitor came from — the list, with its search — or to the shop
          when the product was opened straight from a link. */}
      <div className="lg:hidden max-w-7xl mx-auto px-4 py-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            const fromThisSite = typeof document !== 'undefined' && document.referrer.startsWith(window.location.origin);
            if (fromThisSite && window.history.length > 1) router.back();
            else router.push('/products');
          }}
          aria-label={isAr ? 'رجوع' : 'Back'}
          className="w-10 h-10 -ms-2 flex items-center justify-center rounded-full text-marine-ink hover:bg-marine-mist transition-colors"
        >
          <ArrowLeft size={22} className={isAr ? 'rotate-180' : ''} />
        </button>
        <ShareProductButton product={product} language={language} />
      </div>

      {/* ── Breadcrumbs ───────────────────────────────────────────────────────── */}
      <nav className="hidden sm:flex max-w-7xl mx-auto px-4 py-4 items-center gap-2 text-[11px] text-marine-outline overflow-x-auto whitespace-nowrap scrollbar-hide">
        <Link href="/" className="hover:text-marine-primary transition-colors">{t.home}</Link>
        <ChevronRight size={12} className={isAr ? 'rotate-180' : ''} />
        {categoryHierarchy.map((cat, idx) => (
          <div key={cat._id} className="flex items-center gap-2">
            <Link
              href={`/products?category_id=${cat._id}`}
              className="hover:text-marine-primary transition-colors"
            >
              {isAr ? (cat.name_ar || cat.name) : (cat.name || cat.name_ar)}
            </Link>
            <ChevronRight size={12} className={isAr ? 'rotate-180' : ''} />
          </div>
        ))}
        <span className="text-marine-ink truncate">{displayTitle}</span>
      </nav>

      <div className="max-w-7xl mx-auto px-4">
        {/* A phone, as DeFacto's: the picture across the screen, then a small title, the price
            on a line and the buttons — every section after them tighter than on wide screens. */}
        <div className="flex flex-col lg:flex-row gap-4 sm:gap-12 sm:mt-4">

          {/* ── LEFT: Image Gallery ─────────────────────────────────────────── */}
          <div className="-mx-4 sm:mx-0 sm:w-full lg:w-[520px] flex-shrink-0">
            <div className="lg:sticky lg:top-24 space-y-2 sm:space-y-4">
              <div className="relative aspect-square sm:rounded-xl overflow-hidden bg-white sm:bg-marine-canvas sm:border sm:border-marine-teal/15 group cursor-zoom-in">
                <img
                  src={product.images?.[selectedImage]?.url || primaryImage}
                  alt={displayTitle}
                  className="w-full h-full object-contain group-hover:scale-110 transition-transform duration-700"
                />
                {discountPct && (
                  <div className="absolute top-3 start-3 sm:top-6 sm:start-6 bg-red-600 text-white text-xs sm:text-sm font-bold px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl sm:rounded-lg shadow-xl">
                    {t.save} {discountPct}%
                  </div>
                )}
              </div>

              {product.images && product.images.length > 1 && (
                <div className="flex gap-2 sm:gap-4 overflow-x-auto scrollbar-hide py-2 px-4 sm:px-0">
                  {product.images.map((img, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedImage(idx)}
                      className={`relative w-16 h-16 sm:w-24 sm:h-24 rounded-xl sm:rounded-lg overflow-hidden border-2 flex-shrink-0 transition-all duration-300 ${
                        selectedImage === idx
                          ? 'border-marine-cyan shadow-lg -translate-y-1'
                          : 'border-transparent opacity-60 hover:opacity-100'
                      }`}
                    >
                      <img src={img.url} className="w-full h-full object-contain p-2" alt="thumb" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT: Details ──────────────────────────────────────────────── */}
          <div className="flex-1 space-y-4 sm:space-y-8">

            {/* Part number and maker over the title, like the stamp on the box. */}
            {(product.part_number || product.sku) && (
              <div className="flex items-center justify-between gap-3">
                <span className="font-display text-[13px] font-medium tracking-[0.04em] text-marine-primary bg-marine-mist border border-marine-cyan/20 px-2 py-0.5 rounded-sm">
                  OEM: {product.part_number || product.sku}
                </span>
                {product.product_brand_id?.name && (
                  <span className="hidden sm:flex items-center gap-1 font-display text-[10px] font-bold uppercase tracking-[0.08em] text-marine-muted">
                    <ShieldCheck size={13} className="text-marine-cyan" />{product.product_brand_id.name} {isAr ? 'معتمد' : 'Certified'}
                  </span>
                )}
              </div>
            )}

            {/* Title */}
            <h1 className="font-display text-xl sm:text-[32px] sm:leading-10 font-semibold tracking-tight text-marine-ink">
              {displayTitle}
            </h1>
            {/* A phone and a tablet share from the bar at the top. */}
            <div className="hidden lg:block">
              <ShareProductButton product={product} language={language} />
            </div>

            {displaySubtitle && (
              <p className="text-sm sm:text-xl text-marine-outline font-medium">{displaySubtitle}</p>
            )}

            {/* Identity chips (Restored) */}
            <div className="flex flex-wrap gap-2 sm:gap-3 sm:pt-1">
              {product.sku && (
                <div className="flex items-center gap-2 font-display text-[11px] font-medium tracking-[0.04em] text-marine-muted bg-white px-2.5 py-1 rounded-sm border border-marine-teal/15">
                  <Hash size={14} className="text-marine-primary" />
                  <span>SKU: {product.sku}</span>
                </div>
              )}
              {product.part_number && (
                <div className="flex items-center gap-2 font-display text-[11px] font-medium tracking-[0.04em] text-marine-muted bg-white px-2.5 py-1 rounded-sm border border-marine-teal/15">
                  <Settings size={14} className="text-marine-primary" />
                  <span>Part: {product.part_number}</span>
                </div>
              )}
              {product.gtin && (
                <div className="flex items-center gap-2 font-display text-[11px] font-medium tracking-[0.04em] text-marine-muted bg-white px-2.5 py-1 rounded-sm border border-marine-teal/15">
                  <Barcode size={14} className="text-marine-primary" />
                  <span>GTIN: {product.gtin}</span>
                </div>
              )}
            </div>

            {purchaseBlocked && (
              <div className={`flex items-start gap-3 rounded-lg border px-5 py-4 ${
                isVendorSuspended
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}>
                <AlertTriangle size={20} className="mt-0.5 shrink-0" />
                <p className="text-sm font-bold leading-relaxed">{purchaseBlockedMessage}</p>
              </div>
            )}

            {/* Rating + stock */}
            <div className="flex flex-wrap items-center gap-3 sm:gap-6 sm:pt-1">
              {/* Only shown once real approved reviews exist — a product with
                  none used to display a hardcoded 5.0 it had not earned. */}
              {product.reviews_count > 0 ? (
                <div className="flex items-center gap-1.5 bg-amber-50 px-3 py-1.5 rounded-xl border border-amber-100">
                  <Star size={18} className="text-amber-500 fill-amber-500" />
                  <span className="text-amber-900 font-bold text-sm">
                    {Number(product.rating || 0).toFixed(1)}
                  </span>
                  <span className="text-amber-700/60 text-xs font-bold">
                    ({product.reviews_count} {isAr ? 'تقييم' : 'reviews'})
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 bg-marine-canvas px-3 py-1.5 rounded-xl border border-marine-teal/15">
                  <Star size={18} className="text-marine-line" />
                  <span className="text-marine-outline text-xs font-bold">
                    {isAr ? 'لا توجد تقييمات بعد' : 'No reviews yet'}
                  </span>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <div className={`flex items-center gap-1.5 font-bold text-sm ${
                  (!product.stock_management || product.stock_status === 'instock' || (product.stock_status === 'onbackorder' && product.stock_management)) 
                    ? 'text-emerald-600' 
                    : 'text-red-500'
                }`}>
                  <CheckCircle2 size={18} />
                  {(!product.stock_management || product.stock_status === 'instock')
                    ? <span>{t.inStock}</span>
                    : product.stock_status === 'onbackorder'
                      ? <span>{isAr ? 'طلب مسبق' : 'On Backorder'}</span>
                      : <span>{t.outOfStock}</span>
                  }
                </div>
                {product.stock_management && product.stock_status === 'onbackorder' && (
                  <p className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-100 max-w-xs">
                    {isAr 
                      ? 'هذا المنتج غير متوفر حالياً ولكن عند توفره سيتم شحنه إليك' 
                      : 'It is currently unavailable but when it will be available it will be shipped to you'}
                  </p>
                )}
              </div>
            </div>

            {/* Pricing */}
            <div className="sm:bg-white sm:border sm:border-marine-teal/15 sm:rounded-lg sm:p-6 relative">
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-1">
                  <span className="hidden sm:inline font-display text-[10px] font-bold uppercase tracking-[0.08em] text-marine-muted">{t.totalPrice}</span>
                  {hasAnyCompatible && (
                    <div className="flex items-center gap-1.5 bg-marine-success/10 text-marine-success px-2 py-1 rounded-sm font-display text-[10px] font-bold uppercase tracking-[0.08em] border border-marine-success/25">
                      <ShieldCheck size={12} />
                      {t.guaranteedFit}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-baseline gap-x-3 sm:gap-4 mt-1">
                  <span className="font-display text-2xl sm:text-[40px] sm:leading-[48px] font-bold text-marine-navy">{currentPrice.toLocaleString()} <span className="text-sm font-semibold text-marine-muted">{siteSettings?.currency || 'EGP'}</span></span>
                  {hasDiscount && (
                    <span className="font-display text-sm sm:text-base text-marine-outline line-through">
                      {originalPrice.toLocaleString()} {siteSettings?.currency || 'EGP'}
                    </span>
                  )}
                </div>
                <div className="mt-2 sm:mt-4 flex items-center gap-2 text-marine-muted text-xs bg-marine-canvas sm:px-3 sm:py-2 rounded-sm">
                  <Info size={16} className="text-marine-primary" />
                  <span>{isAr ? `شحن مجاني للطلبات فوق 500 ${siteSettings?.currency || 'EGP'}` : `Free shipping on orders over 500 ${siteSettings?.currency || 'EGP'}`}</span>
                </div>
              </div>
            </div>

            {/* Variations */}
            {product.variation_types?.length > 0 && (
              <div className="space-y-4 sm:space-y-6 bg-marine-canvas/50 p-4 sm:p-8 rounded-lg sm:rounded-xl border border-marine-teal/15">
                <h3 className="text-marine-ink font-bold text-base sm:text-xl flex items-center gap-2">
                  <span className="w-2 h-6 bg-marine-cyan rounded-full" />
                  {t.options}
                </h3>
                <div className="grid gap-6">
                  {product.variation_types.map(type => (
                    <div key={type._id} className="space-y-3">
                      <label className="text-sm font-bold text-marine-outline uppercase tracking-widest">
                        {type.name}
                      </label>
                      <div className="flex flex-wrap gap-3">
                        {type.options.map(opt => (
                          <button
                            key={opt._id}
                            onClick={() => handleOptionSelect(type.name, opt.value)}
                            className={`px-4 py-2 sm:px-6 sm:py-3 rounded-xl sm:rounded-lg font-bold text-sm transition-all duration-300 transform ${
                              selectedOptions[type.name] === opt.value
                                ? 'bg-white text-marine-primary shadow-lg border-2 border-marine-cyan -translate-y-1'
                                : 'bg-white border-2 border-marine-teal/15 text-marine-ink hover:border-marine-teal/25'
                            }`}
                          >
                            {opt.value}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
              {/* Prompt to select options if not all chosen */}
              {product.variation_types?.length > 0 && !allOptionsSelected && (
                <div className="col-span-2 flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 px-4 py-2.5 rounded-xl text-sm font-semibold">
                  <Info size={16} />
                  {isAr ? 'يرجى اختيار جميع الخيارات أولاً' : 'Please select all options before adding to cart'}
                </div>
              )}
              <button
                onClick={handleAddToCart}
                disabled={actionDisabled}
                title={
                  isStaffAccount ? (isAr ? 'حسابات الإدارة والبائعين لا يمكنها الشراء' : 'Admin and vendor accounts cannot purchase')
                  : !allOptionsSelected ? (isAr ? 'اختر جميع الخيارات أولاً' : 'Select all options first')
                  : isDraftPreview ? (isAr ? 'هذا المنتج مسودة وغير متاح للشراء' : 'This product is a draft and cannot be purchased')
                  : isVendorSuspended ? (isAr ? 'هذا المتجر موقوف حالياً' : 'This store is currently suspended')
                  : (product.stock_management && stockQty <= 0) ? (isAr ? 'نفذت الكمية' : 'Out of Stock') : ''
                }
                className="flex-1 bg-marine-cyan hover:bg-marine-cyan-dark disabled:bg-marine-frost disabled:text-marine-outline disabled:cursor-not-allowed text-white font-display font-bold uppercase tracking-[0.06em] text-sm py-3.5 sm:py-4 rounded transition-colors flex items-center justify-center gap-2"
              >
                <ShoppingCart size={20} />
                <span>{t.addToCart}</span>
              </button>
              <button
                onClick={handleBuyNow}
                disabled={actionDisabled}
                title={
                  isStaffAccount ? (isAr ? 'حسابات الإدارة والبائعين لا يمكنها الشراء' : 'Admin and vendor accounts cannot purchase')
                  : !allOptionsSelected ? (isAr ? 'اختر جميع الخيارات أولاً' : 'Select all options first')
                  : isDraftPreview ? (isAr ? 'هذا المنتج مسودة وغير متاح للشراء' : 'This product is a draft and cannot be purchased')
                  : isVendorSuspended ? (isAr ? 'هذا المتجر موقوف حالياً' : 'This store is currently suspended')
                  : (product.stock_management && stockQty <= 0) ? (isAr ? 'نفذت الكمية' : 'Out of Stock') : ''
                }
                className="flex-1 bg-marine-teal hover:bg-marine-navy disabled:bg-marine-frost disabled:text-marine-outline disabled:cursor-not-allowed text-white font-display font-bold uppercase tracking-[0.06em] text-sm py-3.5 sm:py-4 rounded transition-colors"
              >
                {t.buyNow}
              </button>
            </div>

            {/* A question about fitment goes straight to the technical desk. */}
            {siteSettings?.social_links?.whatsapp && (
              <a
                href={`https://wa.me/${siteSettings.social_links.whatsapp.replace(/\+/g, '')}?text=${encodeURIComponent(displayTitle)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 bg-marine-mist border border-marine-teal/15 text-marine-teal font-display text-[11px] font-bold uppercase tracking-[0.06em] py-3 rounded hover:border-marine-cyan transition-colors"
              >
                <MessageCircle size={15} />{isAr ? 'استفسار فني عن التوافق عبر واتساب' : 'Technical Fleet Inquiry via WhatsApp'}
              </a>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="flex items-start gap-3 bg-white border border-marine-teal/15 rounded-lg p-3">
                <Store size={18} className="text-marine-primary flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-marine-ink">{isAr ? 'الاستلام من المخزن' : 'Pickup from the hub'}</div>
                  <div className="text-[11px] text-marine-outline">{isAr ? 'جاهز للاستلام الفوري أو الشحن' : 'Ready for immediate pickup or dispatch'}</div>
                </div>
              </div>
              <div className="flex items-start gap-3 bg-white border border-marine-teal/15 rounded-lg p-3">
                <Truck size={18} className="text-marine-primary flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-marine-ink">{isAr ? 'شحن سريع في نفس اليوم' : 'Same-Day Express Dispatch'}</div>
                  <div className="text-[11px] text-marine-outline">{isAr ? 'القاهرة، الإسكندرية، بورسعيد والسويس' : 'Cairo, Alexandria, Port Said & Suez marinas'}</div>
                </div>
              </div>
            </div>

            {/* Vendor */}
            {product.vendor_id && (
              <div className="bg-marine-canvas rounded-lg sm:rounded-xl p-4 sm:p-6 border border-marine-teal/15">
                <div className="flex items-center gap-3 sm:gap-5">
                  <div className="w-12 h-12 sm:w-16 sm:h-16 bg-marine-navy text-marine-primary rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg overflow-hidden border border-marine-teal/15">
                    {product.vendor_id.store_image ? (
                      <img src={resolveAssetUrl(product.vendor_id.store_image)} alt={product.vendor_id.store_name} className="w-full h-full object-cover" />
                    ) : (
                      <Store size={32} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 text-start">
                    <p className="text-[10px] sm:text-xs font-bold text-marine-outline uppercase tracking-widest mb-0.5 sm:mb-1">{t.soldBy}</p>
                    <h4 className="text-base sm:text-xl font-bold text-marine-ink mb-1 sm:mb-2 truncate">{product.vendor_id.store_name}</h4>
                    {/* How much this seller has actually shipped, next to their name — the
                        question a buyer is really asking when they read "sold by". */}
                    <VendorTrustStats
                      completedOrders={product.vendor_id.completed_orders_count}
                      rating={product.vendor_id.rating}
                      reviewsCount={product.vendor_id.reviews_count}
                      isAr={isAr}
                      size="sm"
                      className="justify-start mb-1 sm:mb-2"
                    />
                    <div className="flex items-center justify-start gap-3 sm:gap-4 text-xs sm:text-sm">
                      <div className="flex items-center gap-1 text-emerald-600 font-bold text-sm">
                        <CheckCircle2 size={16} />
                        {isAr ? 'متجر موثوق' : 'Verified Store'}
                      </div>
                      <span className="text-marine-line">|</span>
                      <Link
                        href={storePath(storeKey(product.vendor_id))}
                        className="text-marine-primary font-bold text-sm hover:underline"
                      >
                        {t.viewStore}
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Trust badges */}
            <div className={`grid ${product.part_type ? 'grid-cols-4' : 'grid-cols-3'} gap-1 sm:gap-4 py-3 sm:py-8 border-y border-marine-teal/15`}>
              {[
                { icon: <Truck size={24} />, label: t.fastDelivery },
                { icon: <RotateCcw size={24} />, label: t.easyReturns },
                // What the part actually is, as its seller declared it. This used to say
                // "Genuine Part" on every product, OEM and aftermarket included; a product
                // with no part type set yet says nothing rather than guess.
                product.part_type && { icon: <ShieldCheck size={24} />, label: PART_TYPE_BADGE[product.part_type]?.[isAr ? 'ar' : 'en'] },
                { icon: <CheckCircle2 size={24} />, label: t.qualityTested },
              ].filter(Boolean).map((item, i) => (
                <div key={i} className="flex flex-col items-center gap-1.5 sm:gap-3 p-1.5 sm:p-4 rounded-lg hover:bg-marine-canvas transition-colors group">
                  <div className="p-2 sm:p-3 bg-marine-mist text-marine-primary rounded group-hover:scale-110 transition-transform [&>svg]:w-5 [&>svg]:h-5 sm:[&>svg]:w-6 sm:[&>svg]:h-6">
                    {item.icon}
                  </div>
                  <span className="text-[10px] sm:text-xs font-bold text-marine-ink uppercase tracking-wider text-center leading-tight">
                    {item.label}
                  </span>
                </div>
              ))}
            </div>

            {/* ── GARAGE FITMENT SECTION ───────────────────────────────────── */}
            {isMounted && !isStaffAccount && (
              <GarageFitmentSection
                garageCompatibility={garageCompatibility}
                t={t}
                isAr={isAr}
                user={user}
              />
            )}


            {/* Technical Specs */}
            <div className="space-y-3 sm:space-y-6 sm:pt-4">
              <h3 className="font-display text-marine-ink font-semibold text-lg sm:text-2xl flex items-center gap-2 sm:gap-3">
                <Settings size={22} className="text-marine-primary" />
                {t.technicalSpecs}
              </h3>
              <div className="bg-white rounded-lg border border-marine-teal/15 overflow-hidden divide-y divide-marine-teal/10">
                {[
                  { label: 'SKU',         value: product.sku,                    icon: <Hash size={16} /> },
                  { label: isAr ? 'رقم القطعة' : 'Part Number', value: product.part_number,             icon: <Settings size={16} /> },
                  { label: 'GTIN',        value: product.gtin,                   icon: <Barcode size={16} /> },
                  { label: isAr ? 'العلامة التجارية' : 'Brand',       value: product.product_brand_id?.name, icon: <Store size={16} /> },
                  { label: isAr ? 'الفئة' : 'Category',    value: fullCategoryPath, icon: <Layers size={16} /> },
                ].filter(s => s.value).map((spec, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 px-4 py-3 odd:bg-white even:bg-marine-canvas"
                  >
                    <div className="flex items-center gap-3">
                      <div className="text-marine-primary">{spec.icon}</div>
                      <span className="text-sm text-marine-muted">{spec.label}</span>
                    </div>
                    <span className="font-display text-sm font-medium tracking-[0.02em] text-marine-ink ltr:text-right rtl:text-left">{spec.spec_value || spec.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Description */}
            <div className="space-y-3 sm:space-y-4 sm:pt-4">
              <h3 className="font-display text-marine-ink font-semibold text-lg sm:text-2xl">{t.description}</h3>
              <div className="bg-white p-4 sm:p-6 rounded-lg border border-marine-teal/15">
                <p className="text-marine-muted leading-relaxed whitespace-pre-line text-sm sm:text-base">
                  {displayDescription}
                </p>
              </div>
            </div>

            {/* ── GENERAL COMPATIBILITY SECTION ────────────────────────────── */}
            <GeneralCompatibilitySection product={product} t={t} isAr={isAr} />

            {/* ── CUSTOMER REVIEWS ─────────────────────────────────────────── */}
            <ProductReviews productId={product._id} />

          </div>
        </div>
        <RelatedProducts
          categoryId={product.category_id?._id || product.category_id}
          excludeId={product._id}
          isAr={isAr}
        />
      </div>
    </div>
  );
}
