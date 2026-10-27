'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import Link from '../LocaleLink';
import { useApp } from '../../context/AppContext';
import { MARINE_HUBS } from '../../lib/marineHubs';

/*
 * The 3 lifestyle slider cards on the home page.
 * Keeps the EXACT layout from the design: 1 large dominant card + 2 stacked side cards.
 * Each card is an independent auto-slider that pauses when the user hovers over it.
 * All 8 target audiences from the marketing plan are organized inside these 3 cards.
 */

const SLIDER_CARDS_DATA = [
  // Card 1: Large Featured Card (occupies 2 cols & 2 rows on desktop)
  {
    id: 'large_featured',
    large: true,
    intervalMs: 4200,
    slides: [
      {
        slug: 'yacht-luxury',
        titleAr: 'مستلزمات اليخوت الفاخرة',
        titleEn: 'Premium Yacht Luxury',
      
        badgeEn: 'Ultra-Luxury VIP',
        descAr: 'يضم أنظمة الإضاءة الفاخرة تحت الماء، شاشات الملاحة الذكية، إكسسوارات الستانلس 316 المصقولة، والديكورات البحرية الراقية.',
        descEn: 'Underwater LED lights, smart chartplotters, polished 316 stainless fittings, and nautical decor.',
        image: '/images/hubs/yacht-luxury.png',
      },
      {
        slug: 'pro-angler',
        titleAr: 'قسم الصياد المحترف',
        titleEn: 'Pro-Angler Hub',
        
        badgeEn: 'Pro Performance',
        descAr: 'أجهزة السونار المتقدمة، قطع غيار المحركات الثقيلة (سوزوكي وهوندا)، ومعدات الصيد في المياه العميقة.',
        descEn: 'Advanced CHIRP sonars, heavy outboard parts, and deep-water big game tackle.',
        image: '/images/hubs/pro-angler.jpg',
      },
      {
        slug: 'diy-maintenance',
        titleAr: 'صيانتك بنفسك',
        titleEn: 'DIY Boat Maintenance',
        badgeEn: 'Cost-Saving DIY Kits',
        descAr: 'مجموعات جاهزة لتغيير الزيت، البويات البحرية، أطقم ريش طلمبات المياه، وأدوات إصلاح الفايبر جلاس.',
        descEn: 'Complete oil service kits, water pump impellers, zinc anodes, and fiberglass patch kits.',
        image: '/images/hubs/diy-maintenance.jpg',
      },
    ],
  },

  // Card 2: Top Small Card
  {
    id: 'small_top',
    large: false,
    intervalMs: 4800,
    slides: [
      {
        slug: 'lifestyle-comfort',
        titleAr: 'الرحلات والرفاهية',
        titleEn: 'Lifestyle & Comfort',
        badgeEn: 'Pure Leisure & Chill',
        descAr: 'كراسي قوارب مريحة، ثلاجات حفظ أطعمة ومشروبات، وأنظمة صوت بحرية مقاومة للماء.',
        descEn: 'Ergonomic helm seats, heavy-duty iceboxes, and waterproof marine audio.',
        image: '/images/hubs/lifestyle-comfort.jpg',
      },
      {
        slug: 'next-gen',
        titleAr: 'المبتدئين والشباب',
        titleEn: 'Next-Gen Boaters',
        badgeEn: 'Young & Active (20-35)',
        descAr: 'ألواح ويك بورد وتجديف، أطواق ومصايف، ومعدات صيد سهلة الاستخدام بأسعار اقتصادية.',
        descEn: 'Wakeboards, SUP boards, towables, and easy-to-use budget fishing gear.',
        image: '/images/hubs/next-gen.jpg',
      },
      {
        slug: 'saltwater-freshwater',
        titleAr: 'المياه المالحة والعذبة',
        titleEn: 'Saltwater & Freshwater',
        badgeEn: 'Specialized Waters',
        descAr: 'قطع غيار مقاومة للملوحة والصدأ، قوارب كاياك، ومعدات صيد نهرية وبحرية.',
        descEn: 'Corrosion-proof hardware, kayaks, and freshwater/saltwater tackle.',
        image: '/images/hubs/saltwater.jpg',
      },
    ],
  },

  // Card 3: Bottom Small Card
  {
    id: 'small_bottom',
    large: false,
    intervalMs: 5400,
    slides: [
      {
        slug: 'smart-eco',
        titleAr: 'الصيد الذكي والصديق للبيئة',
        titleEn: 'Smart & Eco-Friendly Marine',
        descAr: 'طائرات درون لإسقاط الطعوم، ساعات بحرية ذكية، كاميرات تصوير، ومنظفات صديقة للبيئة.',
        descEn: 'Bait drones, marine GPS watches, underwater cameras, and eco boat cleaners.',
        image: '/images/hubs/smart-gear.jpg',
      },
      {
        slug: 'family-safety',
        titleAr: 'أمان العائلة والأطفال',
        titleEn: 'Family & Kids Safety',
        badgeAr: 'أمان وراحة بال عائلية',
        badgeEn: 'Family Safety First',
        descAr: 'سترات نجاة معتمدة للأطفال، أطواق نجاة، أدوات صيد آمنة للصغار، وحقائب إسعافات.',
        descEn: 'Certified kids life vests, safety buoys, child-safe tackle, and marine first aid.',
        image: '/images/hubs/family-safety.jpg',
      },
      {
        slug: 'eco-friendly',
        titleAr: 'القسم الصديق للبيئة',
        titleEn: 'Eco-Friendly Marine',
        badgeAr: 'استدامة وحلول بيئية',
        badgeEn: 'Clean & Sustainable',
        descAr: 'طعوم صيد قابلة للتحلل، منظفات قوارب صديقة للبيئة، ومعدات طاقة شمسية وتجديف.',
        descEn: 'Biodegradable lures, eco boat wash, and lightweight paddle/solar equipment.',
        image: '/images/hubs/eco-friendly.jpg',
      },
    ],
  },
];

function CardAutoSlider({ cardConfig, isAr }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  const slides = cardConfig.slides || [];
  const currentSlide = slides[currentIndex] || slides[0];
  const isLarge = cardConfig.large;

  // Auto-advance timer: continuously rotates unless the user hovers over this card
  useEffect(() => {
    if (isHovered || slides.length <= 1) return;

    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % slides.length);
    }, cardConfig.intervalMs || 4500);

    return () => clearInterval(timer);
  }, [isHovered, slides.length, cardConfig.intervalMs]);

  const handlePrev = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCurrentIndex((prev) => (prev - 1 + slides.length) % slides.length);
  };

  const handleNext = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCurrentIndex((prev) => (prev + 1) % slides.length);
  };

  const handleDotClick = (e, index) => {
    e.preventDefault();
    e.stopPropagation();
    setCurrentIndex(index);
  };

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`group relative block overflow-hidden rounded-2xl bg-marine-navy shadow-lg hover:shadow-2xl transition-all duration-300 ${
        isLarge ? 'h-80 sm:h-96 lg:h-full' : 'h-56 sm:h-60 lg:h-full'
      }`}
    >
      {/* Background Images with smooth cross-fade */}
      {slides.map((slide, idx) => (
        <img
          key={slide.slug}
          src={slide.image}
          alt={isAr ? slide.titleAr : slide.titleEn}
          loading="lazy"
          className={`absolute inset-0 w-full h-full object-cover transition-all duration-700 ease-in-out pointer-events-none select-none ${
            idx === currentIndex
              ? 'opacity-85 scale-100'
              : 'opacity-0 scale-105'
          }`}
        />
      ))}

      {/* Dark gradient overlay matching the exact design */}
      <div className="absolute inset-0 bg-gradient-to-t from-[#061826]/95 via-[#061826]/60 to-black/25 pointer-events-none" />

      {/* Top Controls: Interactive Dots and manual arrows on hover */}
      <div className="absolute top-3.5 inset-x-3.5 z-20 flex items-center justify-between pointer-events-none">
        {/* Subtle Pause indicator on hover */}
        {/* <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded-full backdrop-blur-md transition-opacity duration-300 ${
            isHovered
              ? 'bg-black/60 text-cyan-300 opacity-100'
              : 'opacity-0'
          }`}
        >
          {isAr ? 'موقّف مؤقتاً' : 'Paused'}
        </span> */}

        {/* Clickable Dots */}
        <div className="flex items-center gap-1.5 pointer-events-auto" dir="ltr">
          {slides.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={(e) => handleDotClick(e, idx)}
              aria-label={`Go to slide ${idx + 1}`}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                idx === currentIndex
                  ? 'w-5 bg-cyan-400 shadow-sm'
                  : 'w-1.5 bg-white/40 hover:bg-white/70'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Manual Arrow Controls (appear smoothly when hovering over the card) */}
      <div
        className={`absolute inset-y-0 inset-x-2 z-20 flex items-center justify-between pointer-events-none transition-opacity duration-300 ${
          isHovered ? 'opacity-100' : 'opacity-0'
        }`}
        dir="ltr"
      >
        <button
          type="button"
          onClick={handlePrev}
          aria-label="Previous slide"
          className="pointer-events-auto w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-black/50 hover:bg-black/80 text-white/90 hover:text-white border border-white/20 flex items-center justify-center transition-all shadow-md active:scale-95"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          onClick={handleNext}
          aria-label="Next slide"
          className="pointer-events-auto w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-black/50 hover:bg-black/80 text-white/90 hover:text-white border border-white/20 flex items-center justify-center transition-all shadow-md active:scale-95"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Bottom Content Body */}
      <div className={`absolute inset-x-0 bottom-0 z-10 ${isLarge ? 'p-6 sm:p-8 lg:p-9' : 'p-4 sm:p-5'}`}>
        {/* Badge */}
        {/* <div className="mb-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full bg-white/15 backdrop-blur-md border border-white/20 font-bold text-cyan-100 ${
              isLarge ? 'px-3 py-1 text-[11px]' : 'px-2.5 py-0.5 text-[10px]'
            }`}
          >
            <Sparkles size={isLarge ? 13 : 11} className="text-cyan-300" />
            {isAr ? currentSlide.badgeAr : currentSlide.badgeEn}
          </span>
        </div> */}

        {/* Title */}
        <h3
          className={`font-display font-black text-white leading-tight mb-2 ${
            isLarge
              ? 'text-2xl sm:text-3xl lg:text-4xl'
              : 'text-base sm:text-lg lg:text-xl'
          }`}
        >
          {isAr ? currentSlide.titleAr : currentSlide.titleEn}
        </h3>

        {/* Description (visible on large card, or compact on small cards) */}
        {isLarge && (
          <p className="text-xs sm:text-sm lg:text-[15px] text-cyan-50/85 leading-relaxed max-w-lg mb-5 line-clamp-2">
            {isAr ? currentSlide.descAr : currentSlide.descEn}
          </p>
        )}

        {/* Action Link / Button */}
        <div>
          <Link
            href={`/hub/${currentSlide.slug}`}
            className={`inline-flex items-center gap-2 rounded-lg font-bold transition-all ${
              isLarge
                ? 'bg-[#0099b8] hover:bg-[#00829e] active:scale-[0.98] text-white px-5 py-2.5 text-xs sm:text-sm shadow-md'
                : 'text-xs text-cyan-200 hover:text-white active:translate-x-0.5'
            }`}
          >
            <span>{isAr ? 'تسوّق المجموعة' : 'Shop the collection'}</span>
            <ArrowRight
              size={isLarge ? 15 : 13}
              className="rtl:rotate-180 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1"
            />
          </Link>
        </div>
      </div>
    </div>
  );
}

// Every slide of the three desktop cards, in order, for the phone's single carousel.
const ALL_SLIDES = SLIDER_CARDS_DATA.flatMap((card) => card.slides);

/*
 * A phone: one row of tall cards like noon's home carousel — the current card centred with
 * its neighbours peeking in, always advancing on its own (a swipe or a dot only moves it
 * along). Moves by measuring where the next card sits, so it works the same in RTL.
 */
function MobileHubsCarousel({ isAr }) {
  const trackRef = useRef(null);
  const [active, setActive] = useState(0);

  const goTo = useCallback((index) => {
    const track = trackRef.current;
    const card = track?.children[index];
    if (!card) return;
    const t = track.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    track.scrollBy({ left: (c.left + c.width / 2) - (t.left + t.width / 2), behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const timer = setInterval(() => goTo((active + 1) % ALL_SLIDES.length), 4000);
    return () => clearInterval(timer);
  }, [active, goTo]);

  // The card nearest the middle is the current one.
  const onScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    const mid = track.getBoundingClientRect().left + track.clientWidth / 2;
    let best = 0;
    let bestDist = Infinity;
    Array.from(track.children).forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - mid);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    if (best !== active) setActive(best);
  };

  return (
    <div className="md:hidden">
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="flex gap-3 overflow-x-auto scrollbar-hide snap-x snap-mandatory -mx-4 px-[11vw]"
      >
        {ALL_SLIDES.map((slide, i) => (
          <Link
            key={slide.slug}
            href={`/hub/${slide.slug}`}
            className="relative flex-none w-[78vw] aspect-[3/4] snap-center overflow-hidden rounded-2xl bg-marine-navy shadow-lg"
          >
            <img src={slide.image} alt="" loading={i < 2 ? 'eager' : 'lazy'} className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#061826]/95 via-[#061826]/30 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-5 text-center">
              <h3 className="font-display text-2xl font-black text-white leading-tight mb-1.5">{isAr ? slide.titleAr : slide.titleEn}</h3>
              <p className="text-xs text-cyan-50/85 leading-relaxed line-clamp-2 mb-4">{isAr ? slide.descAr : slide.descEn}</p>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#0099b8] px-4 py-2 text-xs font-bold text-white">
                {isAr ? 'تسوّق المجموعة' : 'Shop the collection'}
                <ArrowRight size={13} className="rtl:rotate-180" />
              </span>
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-center gap-3">
        <div className="flex items-center gap-1.5">
          {ALL_SLIDES.map((slide, i) => (
            <button
              key={slide.slug}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${i === active ? 'w-5 bg-marine-cyan' : 'w-1.5 bg-marine-teal/25'}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function FeaturedHubs() {
  const { language } = useApp();
  const isAr = language === 'ar';

  const largeCard = SLIDER_CARDS_DATA[0];
  const smallCardTop = SLIDER_CARDS_DATA[1];
  const smallCardBottom = SLIDER_CARDS_DATA[2];

  return (
    <section id="marine-hubs" className="py-10 sm:py-14">
      <div className="max-w-7xl mx-auto px-4">
        {/* Section Header */}
        <div className="flex items-end justify-between gap-4 mb-6">
          <div>
            <p className="inline-flex items-center gap-1.5 font-display text-[11px] font-bold uppercase tracking-[0.08em] text-marine-primary">
              <Sparkles size={13} />
              {isAr ? 'مجموعات مختارة لك' : 'Curated for you'}
            </p>
            <h2 className="font-display text-2xl sm:text-[32px] sm:leading-10 font-semibold tracking-tight text-marine-ink">
              {isAr ? 'تسوّق حسب أسلوبك البحري' : 'Shop by Your Marine Lifestyle'}
            </h2>
          </div>
        </div>

        {/* The Exact 3-Cards Layout: 1 Large Dominant Card + 2 Stacked Cards */}
        <MobileHubsCarousel isAr={isAr} />

        <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 lg:grid-rows-2 lg:h-[520px] gap-3 sm:gap-4">
          {/* Large Card: occupies 2 columns & 2 rows on desktop */}
          <div className="md:col-span-2 lg:col-span-2 lg:row-span-2">
            <CardAutoSlider cardConfig={largeCard} isAr={isAr} />
          </div>

          {/* Top Small Card */}
          <div className="md:col-span-1 lg:col-span-1 lg:row-span-1">
            <CardAutoSlider cardConfig={smallCardTop} isAr={isAr} />
          </div>

          {/* Bottom Small Card */}
          <div className="md:col-span-1 lg:col-span-1 lg:row-span-1">
            <CardAutoSlider cardConfig={smallCardBottom} isAr={isAr} />
          </div>
        </div>
      </div>
    </section>
  );
}

// Keep HubBanner export for backwards compatibility (no-op)
export function HubBanner() {
  return null;
}
