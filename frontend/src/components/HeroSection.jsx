'use client';

import { useState, useEffect, useSyncExternalStore } from 'react';
import { Search, ArrowRight, CarFront } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { garageCarLabel } from './company/useGarageCars';
import SearchableSelect from './SearchableSelect';
import useCarFinder from './carFinder/useCarFinder';
import SearchAutocomplete from './search/SearchAutocomplete';

/*
 * The home page's hero: the dark, full-height design on a computer or a tablet, and the
 * app design (banner, search, "choose your car" card) on a phone. Both draw the same form
 * (carFinder/useCarFinder): make → model → year → product type, each opening the next.
 */

// The phone form's fields: light, as in the app design.
const FIELD = 'bg-zinc-50 border border-zinc-200 rounded-xl ps-3 pe-8 py-2.5 sm:py-3 text-sm font-bold text-zinc-900 focus:outline-none focus:border-marine-cyan focus:bg-white transition-colors';

const HERO_IMAGES = ['/images/banner-2.jpg', '/images/banner-ready-car-1.jpg'];

// Below this width the phone design shows (Tailwind's `md`).
const WIDE_QUERY = '(min-width: 768px)';
const subscribeWide = (onChange) => {
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
};

// Every hero dropdown can be searched inside it: the car makes, models and years, the
// product types, the garage.
function SelectField(props) {
  const { language } = useApp();
  return <SearchableSelect {...props} isAr={language === 'ar'} />;
}

/** The computer and tablet hero: dark, full height, the search panel beside the title. */
function DesktopHero({ finder, slide, buttonRef }) {
  const { language, t } = useApp();
  const {
    metadata, filters, garageCars, brandModels, selectedModel, openNext,
    handleBrandChange, handleModelChange, handleYearChange, handleTypeChange, handleGarageCarChange,
    dropQueued, handleSearch,
  } = finder;
  const heroImages = HERO_IMAGES;
  return (
    <section className="relative min-h-[92vh] flex items-center overflow-hidden bg-[#09090b]">
      {/* === LAYERED BACKGROUND === */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-[#09090b] via-[#0d0d0d] to-[#111111]" />
        {heroImages.map((src, index) => (
          <img
            key={src}
            src={src}
            alt=""
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ease-in-out ${index === slide ? 'opacity-80' : 'opacity-0'
              }`}
          />
        ))}
        <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/25 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-red-600/5 via-transparent to-transparent" />

        {/* Static red glow orbs */}
        <div className="absolute -top-40 -right-40 w-[600px] h-[600px] bg-red-600/10 rounded-full blur-[150px]" />
        <div className="absolute bottom-20 -left-40 w-[500px] h-[500px] bg-red-600/8 rounded-full blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-red-600/5 rounded-full blur-[200px]" />

        {/* Grid overlay */}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: `linear-gradient(rgba(0,166,206,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(0,166,206,0.3) 1px, transparent 1px)`,
          backgroundSize: '80px 80px',
        }} />
      </div>

      {/* Red accent line */}
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-red-600 to-transparent opacity-60" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 w-full">
        <div className="grid lg:grid-cols-2 gap-12 items-center">

          {/* LEFT: Content */}
          <div className="space-y-8">


            <div className="space-y-2">
              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black text-white leading-[1.05] tracking-tight">
                {t.heroTitle}
              </h1>
              {t.heroSubtitle && (
                <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black leading-[1.05] tracking-tight">
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-600 to-red-400">{t.heroSubtitle}</span>
                </h2>
              )}
            </div>

            <p className="text-zinc-400 text-lg leading-relaxed max-w-lg font-light">
              {t.heroDesc}
            </p>


          </div>

          {/* RIGHT: Search Panel */}
          <div className="relative">
            <div className="absolute -top-3 -left-3 w-12 h-12 border-t-2 border-l-2 border-red-600/40 rounded-tl-xl" />
            <div className="absolute -bottom-3 -right-3 w-12 h-12 border-b-2 border-r-2 border-red-600/40 rounded-br-xl" />

            <div className="bg-white/12 backdrop-blur-xl border border-white/15 rounded-3xl p-8 space-y-6 relative overflow-hidden shadow-2xl shadow-black/20">
              <div className="absolute top-0 left-8 right-8 h-[1px] bg-gradient-to-r from-transparent via-red-600/40 to-transparent" />

              <div className="text-center mb-2">
                <h3 className="text-white font-bold text-lg mb-1">
                  {language === 'ar' ? 'ابحث عن قطع غيار سيارتك' : 'Find Your Car Parts'}
                </h3>
                <p className="text-zinc-500 text-sm">
                  {language === 'ar' ? 'اختر سيارتك وابدأ البحث' : 'Select your vehicle to get started'}
                </p>
              </div>

              {garageCars.length > 0 && (
                <SelectField
                  value={filters.garage_car_id}
                  onChange={handleGarageCarChange}
                  options={garageCars.map(car => ({
                    value: car._id,
                    label: garageCarLabel(car, language === 'ar'),
                  }))}
                  placeholder={language === 'ar' ? 'اختر من جراجي' : 'Choose from my garage'}
                  onOpen={dropQueued}
                />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <SelectField
                  value={filters.car_brand_id}
                  onChange={handleBrandChange}
                  options={metadata?.carBrands?.map(b => ({ value: b._id, label: b.name, keywords: (b.name_aliases || []).join(' '), image: b.image })) || []}
                  placeholder={t.selectBrand}
                  onOpen={dropQueued}
                />
                <SelectField
                  value={filters.car_model_id}
                  onChange={handleModelChange}
                  options={brandModels.map(m => ({ value: m._id, label: m.name }))}
                  placeholder={t.selectModel}
                  disabled={!filters.car_brand_id}
                  autoOpen={openNext === 'model'}
                  onOpen={dropQueued}
                />
                <SelectField
                  value={filters.car_year}
                  onChange={handleYearChange}
                  options={selectedModel?.years?.map(y => ({ value: y.year, label: y.year })) || []}
                  placeholder={t.selectYear}
                  disabled={!filters.car_model_id}
                  autoOpen={openNext === 'year'}
                  onOpen={dropQueued}
                />
              </div>

              {/* What kind of thing, rather than which part of the car: a shopper who does
                  not know where a part belongs picks "Spare parts" or "Routine maintenance",
                  and the shop shows that type's categories to choose from. */}
              <SelectField
                value={filters.type_id}
                onChange={handleTypeChange}
                options={(metadata?.productTypes || []).map(type => ({
                  value: type._id,
                  label: language === 'ar' ? (type.name_ar || type.name) : type.name,
                  keywords: [type.name, type.name_ar].filter(Boolean).join(' '),
                }))}
                placeholder={language === 'ar' ? 'نوع المنتج' : 'Product type'}
                disabled={!metadata?.productTypes?.length}
                autoOpen={openNext === 'type'}
                onOpen={dropQueued}
              />


              <button
                ref={buttonRef}
                onClick={handleSearch}
                className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-bold px-8 py-4 rounded-xl transition-all duration-300 text-base shadow-[0_0_15px_rgba(0,166,206,0.3)] hover:shadow-[0_0_30px_rgba(0,166,206,0.5)] group relative overflow-hidden"
              >
                <Search size={20} className="group-hover:scale-110 transition-transform" />
                <span>{t.searchParts}</span>
                <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform duration-300 rtl:rotate-180" />
              </button>

              <div className="text-center">
                <p className="text-zinc-500 text-xs">
                  {language === 'ar' ? 'أو تصفح جميع المنتجات →' : 'Or browse all products →'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#09090b] to-transparent" />
    </section>
  );
}

/** The phone hero: the app design — an image banner, the search box, then "choose your car". */
function PhoneHero({ finder, slide, buttonRef }) {
  const { language, t } = useApp();
  const {
    metadata, filters, garageCars, brandModels, selectedModel, openNext,
    handleBrandChange, handleModelChange, handleYearChange, handleTypeChange, handleGarageCarChange,
    dropQueued, handleSearch,
  } = finder;
  const heroImages = HERO_IMAGES;
  return (
    <>
    {/* The app design, on every screen: the search box, an image banner, then "choose your
        car" in a white card. A phone stacks them; a wide screen puts the banner beside the
        card. The header carries the search from `md` up. */}
    <section className="bg-white">
      <div className="max-w-7xl mx-auto px-4 pt-3 pb-2 sm:pt-8 sm:pb-6 grid gap-3 sm:gap-4 lg:grid-cols-[1.35fr_1fr] lg:gap-6 lg:items-stretch">
      <div className="space-y-3 sm:space-y-4 flex flex-col">
      {/* The search box first, right under the logo: it is what most visitors came for. */}
      <SearchAutocomplete
        placeholder={t.search}
        formClassName="relative md:hidden"
        inputClassName="w-full bg-white border border-zinc-200 shadow-sm rounded-2xl ps-4 pe-12 py-2.5 sm:py-3.5 text-base text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-marine-cyan"
        buttonClassName="absolute end-4 top-1/2 -translate-y-1/2 text-marine-primary"
      />

      <div className="relative h-40 sm:h-72 lg:h-auto lg:flex-1 lg:min-h-[360px] rounded-3xl overflow-hidden bg-zinc-900 shadow-sm">
        {heroImages.map((src, index) => (
          <img
            key={src}
            src={src}
            alt=""
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${index === slide ? 'opacity-100' : 'opacity-0'}`}
          />
        ))}
        {/* The banners' people stand on the right and the left is empty dark space, so the
            words sit on the left in both languages (shaded behind them), and the person
            stays clear — in Arabic too. */}
        <div className="absolute inset-0 bg-gradient-to-l from-transparent via-black/45 to-black/80" />
        <div className="absolute inset-y-0 left-0 w-4/5 lg:w-3/4 flex flex-col justify-center p-5 sm:p-10">
          <h1 className="text-[22px] sm:text-4xl lg:text-5xl font-black text-white leading-tight">{t.heroTitle}</h1>
          <p className="mt-2 sm:mt-4 text-[11px] sm:text-base leading-relaxed text-white/80 line-clamp-3 max-w-xl">{t.heroDesc}</p>
        </div>
      </div>

      </div>

      <div className="bg-white rounded-3xl border border-zinc-100 shadow-[0_8px_30px_rgba(0,0,0,0.06)] p-3.5 sm:p-6 space-y-2.5 sm:space-y-4 lg:self-center">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 sm:w-11 sm:h-11 shrink-0 rounded-2xl bg-marine-cyan text-white flex items-center justify-center shadow-md shadow-red-600/20">
            <CarFront size={22} />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-black text-zinc-900 leading-tight">{language === 'ar' ? 'اختار عربيتك' : 'Choose your car'}</h2>
            <p className="text-xs text-zinc-500">{language === 'ar' ? 'وشوف القطع المناسبة ليها' : 'and see the parts that fit it'}</p>
          </div>
        </div>
        {garageCars.length > 0 && (
          <SelectField
            buttonClassName={FIELD}
            value={filters.garage_car_id}
            onChange={handleGarageCarChange}
            options={garageCars.map(car => ({ value: car._id, label: garageCarLabel(car, language === 'ar') }))}
            placeholder={language === 'ar' ? 'اختار من جراجي' : 'Choose from my garage'}
            onOpen={dropQueued}
          />
        )}
        <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
          <SelectField
            buttonClassName={FIELD}
            value={filters.car_brand_id}
            onChange={handleBrandChange}
            options={metadata?.carBrands?.map(b => ({ value: b._id, label: b.name, keywords: (b.name_aliases || []).join(' '), image: b.image })) || []}
            placeholder={language === 'ar' ? 'الماركة' : 'Make'}
            onOpen={dropQueued}
          />
          <SelectField
            buttonClassName={FIELD}
            value={filters.car_model_id}
            onChange={handleModelChange}
            options={brandModels.map(m => ({ value: m._id, label: m.name }))}
            placeholder={language === 'ar' ? 'الموديل' : 'Model'}
            disabled={!filters.car_brand_id}
            autoOpen={openNext === 'model'}
            onOpen={dropQueued}
          />
          <SelectField
            buttonClassName={FIELD}
            value={filters.car_year}
            onChange={handleYearChange}
            options={selectedModel?.years?.map(y => ({ value: y.year, label: y.year })) || []}
            placeholder={language === 'ar' ? 'السنة' : 'Year'}
            disabled={!filters.car_model_id}
            autoOpen={openNext === 'year'}
            onOpen={dropQueued}
          />
          <SelectField
            buttonClassName={FIELD}
            value={filters.type_id}
            onChange={handleTypeChange}
            options={(metadata?.productTypes || []).map(type => ({
              value: type._id,
              label: language === 'ar' ? (type.name_ar || type.name) : type.name,
              keywords: [type.name, type.name_ar].filter(Boolean).join(' '),
            }))}
            placeholder={language === 'ar' ? 'نوع المنتج' : 'Product type'}
            disabled={!metadata?.productTypes?.length}
            autoOpen={openNext === 'type'}
            onOpen={dropQueued}
          />
        </div>
        <button
          ref={buttonRef}
          type="button"
          onClick={handleSearch}
          className="w-full flex items-center justify-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold py-3 sm:py-3.5 rounded-2xl transition-colors shadow-lg shadow-red-600/20"
        >
          <span>{language === 'ar' ? 'عرض النتائج' : 'Show results'}</span>
          <ArrowRight size={18} className="rtl:rotate-180" />
        </button>
      </div>
      </div>
    </section>

    </>
  );
}

export default function HeroSection() {
  // One form for both designs, so what is picked stays picked across a resize.
  const finder = useCarFinder();
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSlide((s) => (s + 1) % HERO_IMAGES.length), 5000);
    return () => clearInterval(timer);
  }, []);

  // null on the server and while hydrating: both designs are drawn and CSS shows the right
  // one, so nothing jumps. Once known, only that one is mounted — a hidden form must not
  // open its lists (they open by themselves as the fields fill in).
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE_QUERY).matches, () => null);

  if (wide === null) {
    return (
      <>
        <div className="md:hidden"><PhoneHero finder={finder} slide={slide} /></div>
        <div className="hidden md:block"><DesktopHero finder={finder} slide={slide} /></div>
      </>
    );
  }
  return wide
    ? <DesktopHero finder={finder} slide={slide} buttonRef={finder.searchButtonRef} />
    : <PhoneHero finder={finder} slide={slide} buttonRef={finder.searchButtonRef} />;
}
