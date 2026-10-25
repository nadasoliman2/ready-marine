'use client';

import { useEffect, useState } from 'react';
import Link from '../LocaleLink';
import { ArrowRight, ChevronLeft, ChevronRight, MapPin, Sparkles } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { adsApi } from '../../lib/api';
import { resolveAssetUrl } from '../../lib/assets';
import { pickServiceLocation } from '../../lib/serviceLocations';
import { useAdImpression, trackAdClick } from '../../lib/adTracking';

function getServiceImage(service) {
  const primary = service.images?.find(image => image.is_primary);
  return resolveAssetUrl(primary?.url || service.images?.[0]?.url || '');
}

function getSlideImage(slide) {
  if (!slide) return '';
  return slide.kind === 'ad' ? resolveAssetUrl(slide.image) : getServiceImage(slide.service);
}

// Wrap banner content in the correct link element: internal paths use Next
// <Link>, absolute URLs open in a new tab.
function BannerLink({ href, className, children, ariaLabel, onClick }) {
  if (!href) return <div className={className}>{children}</div>;
  const isInternal = href.startsWith('/');
  if (isInternal) {
    return <Link href={href} className={className} aria-label={ariaLabel} onClick={onClick}>{children}</Link>;
  }
  return <a href={href} target="_blank" rel="noreferrer" className={className} aria-label={ariaLabel} onClick={onClick}>{children}</a>;
}

// A vendor's banner ad: reports that it was seen, and that it was followed.
function AdBanner({ slide, isAr }) {
  const ref = useAdImpression(slide.id, { placement: 'home_banner' });
  return (
    <div ref={ref} className="absolute inset-0">
      <BannerLink
        href={slide.link}
        className="absolute inset-0 block"
        ariaLabel={isAr ? 'إعلان' : 'Advertisement'}
        onClick={() => trackAdClick(slide.id, { placement: 'home_banner', target: slide.link, subjects: [slide.link] })}
      >
        <img key={slide.id} src={getSlideImage(slide)} alt="" loading="eager" fetchPriority="high" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      </BannerLink>
    </div>
  );
}

export default function ServiceBannerAdSlider() {
  const { language, t, siteSettings } = useApp();
  const [slides, setSlides] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const isAr = language === 'ar';

  useEffect(() => {
    let cancelled = false;
    let refreshTimer;
    let hasLoaded = false;

    const load = async () => {
      try {
        const data = await adsApi.getHomepageBanners(25);
        if (!cancelled) {
          const nextSlides = data.slides || [];
          hasLoaded = true;
          setSlides(nextSlides);
          setActiveIndex(nextSlides.length ? Math.floor(Date.now() / 6500) % nextSlides.length : 0);

          const nextShiftAt = new Date(data.next_shift_at).getTime();
          if (Number.isFinite(nextShiftAt)) {
            refreshTimer = setTimeout(load, Math.max(1000, nextShiftAt - Date.now() + 1000));
          }
        }
      } catch {
        if (!cancelled) {
          if (!hasLoaded) setSlides([]);
          refreshTimer = setTimeout(load, 60000);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, []);

  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = setInterval(() => {
      setActiveIndex(index => (index + 1) % slides.length);
    }, 6500);
    return () => clearInterval(timer);
  }, [slides.length]);

  useEffect(() => {
    if (slides.length <= 1) return undefined;
    const nextImage = getSlideImage(slides[(activeIndex + 1) % slides.length]);
    if (!nextImage) return undefined;

    const preload = () => {
      const image = new Image();
      image.decoding = 'async';
      image.src = nextImage;
    };
    const idleId = typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback(preload, { timeout: 2000 })
      : window.setTimeout(preload, 250);

    return () => {
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleId);
      else window.clearTimeout(idleId);
    };
  }, [activeIndex, slides]);

  if (!slides.length) return null;

  const slide = slides[activeIndex];

  const goToSlide = (direction) => {
    setActiveIndex(index => {
      if (direction === 'prev') return (index - 1 + slides.length) % slides.length;
      return (index + 1) % slides.length;
    });
  };

  // Shared chrome: nav arrows + compact progress for large shifts.
  const navArrows = slides.length > 1 && (
    <div className="hidden items-center gap-2 sm:flex">
      <button type="button" onClick={() => goToSlide('prev')}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20"
        aria-label={isAr ? 'السابق' : 'Previous'}>
        <ChevronLeft size={18} className="rtl:rotate-180" />
      </button>
      <button type="button" onClick={() => goToSlide('next')}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20"
        aria-label={isAr ? 'التالي' : 'Next'}>
        <ChevronRight size={18} className="rtl:rotate-180" />
      </button>
    </div>
  );

  const pagination = slides.length > 1 && (
    <div className="mt-2 flex items-center gap-3 sm:mt-8">
      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-white/35" aria-hidden="true">
        <div
          className="h-full rounded-full bg-marine-cyan transition-[width] duration-300"
          style={{ width: `${((activeIndex + 1) / slides.length) * 100}%` }}
        />
      </div>
      <span className="rounded-full border border-white/15 bg-black/25 px-2.5 py-1 text-xs font-bold tabular-nums text-white backdrop-blur" aria-live="polite">
        {activeIndex + 1} / {slides.length}
      </span>
    </div>
  );

  // --- Vendor ad slide: full-bleed image, whole banner clickable ---
  if (slide.kind === 'ad') {
    return (
      <section className="w-full bg-white py-10 sm:py-12" dir={isAr ? 'rtl' : 'ltr'}>
        <div className="mx-auto max-w-5xl px-0 sm:px-4">
          <div className="relative aspect-[16/10] overflow-hidden rounded-none bg-marine-navy shadow-[0_24px_70px_rgba(9,9,11,0.18)] sm:rounded-xl">
            <AdBanner slide={slide} isAr={isAr} />
            {slides.length > 1 && (
              <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-6 sm:p-8 lg:p-10">
                <div className="flex justify-end"><div className="pointer-events-auto">{navArrows}</div></div>
                <div className="pointer-events-auto">{pagination}</div>
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  // --- Service slide: existing rich overlay ---
  const service = slide.service;
  const title = isAr ? (service.title_ar || service.title_en) : (service.title_en || service.title_ar);
  const description = isAr ? (service.description_ar || service.description_en) : (service.description_en || service.description_ar);
  const vendorName = isAr ? (service.vendor_name_ar || service.vendor_name_en) : (service.vendor_name_en || service.vendor_name_ar);
  const slug = isAr ? (service.slug_ar || service.slug_en) : (service.slug_en || service.slug_ar);
  const location = pickServiceLocation(service, language);
  const price = Number(service.price);
  const showPrice = Number.isFinite(price) && price > 0;

  return (
    <section className="w-full bg-white py-10 sm:py-12" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="mx-auto max-w-5xl px-0 sm:px-4">
        <div className="relative aspect-[16/10] overflow-hidden rounded-none bg-marine-navy shadow-[0_24px_70px_rgba(9,9,11,0.18)] sm:rounded-xl">
          <img key={service._id} src={getServiceImage(service)} alt={title} loading="eager" fetchPriority="high" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#09090b]/95 via-[#09090b]/76 to-[#09090b]/22 rtl:bg-gradient-to-l" />
          <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#09090b]/90 to-transparent" />

          <div className="absolute inset-0 z-10 flex flex-col justify-between p-4 sm:p-8 lg:p-10">
            <div className="flex items-center justify-between gap-4">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white backdrop-blur">
                <Sparkles size={14} className="text-[#FBBF24]" />
                <span>{isAr ? 'خدمة مميزة' : 'Featured Service'}</span>
              </div>
              {navArrows}
            </div>

            <div className="max-w-2xl">
              {vendorName && (
                <p className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-red-200 sm:mb-3 sm:text-sm">{vendorName}</p>
              )}
              <h2 className="max-w-xl line-clamp-2 text-2xl font-bold leading-tight text-white sm:text-5xl">
                {title}
              </h2>
              {description && (
                <div className="mt-4 hidden max-w-lg sm:block">
                  <p
                    className="break-words text-sm leading-6 text-marine-line sm:text-base"
                    style={{
                      display: '-webkit-box',
                      WebkitBoxOrient: 'vertical',
                      WebkitLineClamp: 2,
                      overflow: 'hidden',
                    }}
                  >
                    {description}
                  </p>
                </div>
              )}

              <div className="mt-6 hidden flex-wrap items-center gap-3 text-sm font-semibold text-marine-line sm:flex">
                {location?.name && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-2 backdrop-blur">
                    <MapPin size={15} className="text-marine-primary" />
                    {location.name}
                  </span>
                )}
                {showPrice && (
                  <span className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-2 text-white backdrop-blur">
                    {siteSettings?.currency || 'QAR'} {price.toFixed(2)}
                  </span>
                )}
              </div>

              <Link
                href={`/services/${slug}`}
                className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-marine-cyan px-4 py-2 text-xs font-bold text-white shadow-lg shadow-red-950/30 transition-all hover:-translate-y-0.5 hover:bg-marine-cyan-dark sm:mt-6 sm:min-h-12 sm:px-6 sm:py-3 sm:text-sm"
              >
                <span>{t.viewServiceDetails || (isAr ? 'عرض تفاصيل الخدمة' : 'View Service Details')}</span>
                <ArrowRight size={17} className="rtl:rotate-180" />
              </Link>
            </div>

            {pagination}
          </div>
        </div>
      </div>
    </section>
  );
}
