'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Anchor, ArrowRight, BadgeCheck, ChevronLeft, ChevronRight, Cog, Droplets, Filter, Gauge, LifeBuoy, Search, ShieldCheck,
  Ship, Siren, Sparkles, Star, Wrench, Zap, MessageCircle, CreditCard,
} from 'lucide-react';
import Link from '../LocaleLink';
import { useApp } from '../../context/AppContext';
import { resolveAssetUrl, thumbUrl } from '../../lib/assets';
import useCarFinder from '../carFinder/useCarFinder';

/*
 * The home page sections of the Ready Marine design. Wherever the store has the data
 * (categories, makes and models, products) the section reads it; the rest — the workshop
 * partners, the brands strip, the payment partners — is showcase copy until those modules
 * get their own content.
 */

export const SECTION_EYEBROW = 'font-display text-[11px] font-bold uppercase tracking-[0.08em] text-marine-primary';
export const SECTION_TITLE = 'font-display text-2xl sm:text-[32px] sm:leading-10 font-semibold tracking-tight text-marine-ink';

const FIELD = 'w-full bg-white border border-marine-teal/20 rounded px-3 py-2.5 text-sm text-marine-ink focus:outline-none focus:border-marine-cyan focus:ring-[3px] focus:ring-marine-cyan/15 disabled:bg-marine-canvas disabled:text-marine-outline';
const FIELD_LABEL = 'block font-display text-[10px] font-bold uppercase tracking-[0.08em] text-marine-muted mb-1.5';

/** The dark strip under the menu: what the platform is, in one running line. */
export function AnnouncementBar() {
  const { language } = useApp();
  const isAr = language === 'ar';
  return (
    <div className="bg-marine-navy text-white">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-4 text-[11px] font-display tracking-[0.06em] uppercase">
        <span className="bg-marine-cyan px-1.5 py-0.5 rounded-sm font-bold flex-shrink-0">{isAr ? 'جديد' : 'New'}</span>
        <span className="truncate flex-1">
          {isAr
            ? 'أول منصة متعددة التجار لقطع غيار اليخوت والمراكب في مصر — توصيل في نفس اليوم للمراسي والموانئ'
            : "Egypt's first multi-vendor yacht & marine spare parts platform — same-day marina & port delivery"}
        </span>
        <span className="hidden lg:flex items-center gap-1.5 flex-shrink-0 normal-case tracking-normal">
          <ShieldCheck size={14} className="text-marine-cyan" />{isAr ? '100% قطع أصلية معتمدة' : '100% Genuine Certified'}
        </span>
        <span className="hidden lg:flex items-center gap-1.5 flex-shrink-0 normal-case tracking-normal">
          <Anchor size={14} className="text-marine-cyan" />{isAr ? 'توصيل للمرسى والورشة' : 'Direct Dock & Workshop Dispatch'}
        </span>
      </div>
    </div>
  );
}

function FinderSelect({ label, value, onChange, onOpen, options, placeholder, disabled }) {
  return (
    <label className="block">
      <span className={FIELD_LABEL}>{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onMouseDown={onOpen}
        className={FIELD}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** "Select your vessel": the store's makes, models and years, then the shop filtered by them. */
function VesselSelector() {
  const { language } = useApp();
  const isAr = language === 'ar';
  const {
    metadata, filters, brandModels, selectedModel, searchButtonRef,
    handleBrandChange, handleModelChange, handleYearChange, handleTypeChange, dropQueued, handleSearch,
  } = useCarFinder();
  const name = (item) => (isAr ? (item.name_ar || item.name) : item.name) || item.name_en || '';

  return (
    <div className="bg-white rounded-lg border border-marine-teal/15 shadow-pod p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h2 className="font-display text-lg font-semibold text-marine-ink">{isAr ? 'اختار مركبك' : 'Select Your Vessel'}</h2>
          <p className="text-xs text-marine-outline">{isAr ? 'فلتر التوافق الفوري' : 'Instant compatibility filter engine'}</p>
        </div>
        <span className="flex items-center gap-1 bg-marine-cyan text-white font-display text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-1 rounded-sm">
          <Ship size={12} />{isAr ? 'بحري' : 'Marine'}
        </span>
      </div>

      <div className="space-y-4">
        <FinderSelect
          label={isAr ? 'الماركة / الصانع' : 'Make / Brand'}
          value={filters.car_brand_id}
          onChange={handleBrandChange}
          onOpen={dropQueued}
          placeholder={isAr ? 'اختار الصانع (مثلاً Yamaha، Mercury)' : 'Select manufacturer (e.g. Yamaha, Mercury)'}
          options={(metadata?.carBrands || []).map((b) => ({ value: b._id, label: name(b) }))}
        />
        <div className="grid grid-cols-2 gap-3">
          <FinderSelect
            label={isAr ? 'الموديل / الهيكل' : 'Model / Hull'}
            value={filters.car_model_id}
            onChange={handleModelChange}
            onOpen={dropQueued}
            disabled={!filters.car_brand_id}
            placeholder={isAr ? 'اختار الموديل' : 'Choose model'}
            options={brandModels.map((m) => ({ value: m._id, label: name(m) }))}
          />
          <FinderSelect
            label={isAr ? 'السنة' : 'Year'}
            value={filters.car_year}
            onChange={handleYearChange}
            onOpen={dropQueued}
            disabled={!selectedModel?.years?.length}
            placeholder={isAr ? 'السنة' : 'Year'}
            options={(selectedModel?.years || []).map((y) => ({ value: y.year, label: y.year }))}
          />
        </div>
        <FinderSelect
          label={isAr ? 'نوع القطعة' : 'Part Category'}
          value={filters.type_id}
          onChange={handleTypeChange}
          onOpen={dropQueued}
          placeholder={isAr ? 'كل القطع والأنظمة' : 'All spare parts & systems'}
          options={(metadata?.productTypes || []).map((p) => ({ value: p._id, label: name(p) }))}
        />
        <button
          ref={searchButtonRef}
          type="button"
          onClick={handleSearch}
          className="w-full flex items-center justify-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white font-display text-xs font-bold uppercase tracking-[0.06em] py-3 rounded transition-colors"
        >
          <Search size={15} />{isAr ? 'ابحث عن القطع المضمونة' : 'Search Guaranteed Parts'}
        </button>
      </div>
      <div className="flex items-center justify-between mt-4 text-xs">
        <Link href="/products" className="text-marine-primary font-medium hover:underline flex items-center gap-1">
          {isAr ? 'أو تصفّح الكتالوج كله' : 'Or browse entire catalog'}<ArrowRight size={12} className="rtl:rotate-180" />
        </Link>
        <span className="text-marine-outline">{isAr ? 'بحث برقم الهيكل HIN' : 'HIN Lookup'}</span>
      </div>
    </div>
  );
}

export function MarineHero() {
  const { language } = useApp();
  const isAr = language === 'ar';


  // The yacht sails in the lower right of the photo, so the copy sits centred in the sky above it.
  return (
    <section className="relative overflow-hidden bg-marine-mist h-[560px] sm:h-[600px]">
      <img
        src="/images/hero-yacht.png"
        alt=""
        fetchPriority="high"
        className="absolute inset-0 w-full h-full object-cover object-[72%_center]"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-white/60 via-white/20 to-transparent" />
      <div className="relative max-w-3xl mx-auto px-4 pt-14 sm:pt-24 text-center">
        <h1 className="font-display text-[32px] leading-[42px] sm:text-[52px] sm:leading-[62px] font-bold tracking-[-0.02em] text-marine-navy mb-4">
          {isAr ? <>كل مستلزمات <span className="text-marine-cyan">البحر</span> في مكان واحد</> : <>Everything for the <span className="text-marine-cyan">Sea</span>, in One Place</>}
        </h1>
        <p className="text-marine-ink/80 text-base sm:text-lg leading-relaxed max-w-xl mx-auto mb-8">
          {isAr
            ? 'مستلزمات قوارب وصيد ورياضات مائية مختارة بعناية لتجربة أكثر أماناً ومتعة.'
            : 'Boating, fishing and water-sports essentials, carefully selected for a safer, more enjoyable time on the water.'}
        </p>
        <Link
          href="/products"
          className="inline-flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white font-display text-sm font-bold tracking-[0.04em] px-8 py-3.5 rounded shadow-aura transition-colors"
        >
          {isAr ? 'تسوّق الآن' : 'Shop Now'}<ArrowRight size={16} className="rtl:rotate-180" />
        </Link>
      </div>
    </section>
  );
}

const CATEGORY_ICONS = [Cog, Droplets, Filter, Gauge, Zap, Anchor, Sparkles, Wrench, LifeBuoy];

export function CoreCategories() {
  const { language, categories } = useApp();
  const isAr = language === 'ar';
  const list = categories || [];
  const trackRef = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  // Which arrows still have somewhere to go. In RTL scrollLeft runs from 0 down to
  // -max, so the start of the row is on the right instead of the left.
  const updateEdges = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const max = track.scrollWidth - track.clientWidth;
    const fromStart = Math.abs(track.scrollLeft);
    const atStart = fromStart < 8;
    const atEnd = fromStart > max - 8;
    setEdges(isAr ? { left: !atEnd, right: !atStart } : { left: !atStart, right: !atEnd });
  }, [isAr]);

  useEffect(() => {
    updateEdges();
    window.addEventListener('resize', updateEdges);
    return () => window.removeEventListener('resize', updateEdges);
  }, [updateEdges, list.length]);

  const scrollBy = (dir) => {
    const track = trackRef.current;
    if (track) track.scrollBy({ left: dir * track.clientWidth * 0.8, behavior: 'smooth' });
  };

  if (!list.length) return null;

  return (
    <section className="py-10 sm:py-14">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-end justify-between gap-4 mb-6">
          <div>
            <p className={SECTION_EYEBROW}>{isAr ? 'مكونات هندسية' : 'Engineered Components'}</p>
            <h2 className={SECTION_TITLE}>{isAr ? 'تصفّح حسب القسم' : 'Explore by Core Category'}</h2>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <Link href="/products" className="font-display text-[11px] font-bold uppercase tracking-[0.08em] text-marine-primary hover:underline flex items-center gap-1">
              {isAr ? `كل الأقسام (${categories.length})` : `All ${categories.length} Categories`}<ArrowRight size={12} className="rtl:rotate-180" />
            </Link>
            <div className="hidden sm:flex gap-2" dir="ltr">
              {[[-1, ChevronLeft, edges.left], [1, ChevronRight, edges.right]].map(([dir, Arrow, enabled]) => (
                <button
                  key={dir}
                  type="button"
                  onClick={() => scrollBy(dir)}
                  disabled={!enabled}
                  aria-label={dir < 0 ? 'Scroll left' : 'Scroll right'}
                  className="w-9 h-9 rounded-full border border-marine-teal/20 bg-white text-marine-primary flex items-center justify-center hover:bg-marine-cyan hover:text-white hover:border-marine-cyan disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  <Arrow size={18} />
                </button>
              ))}
            </div>
          </div>
        </div>
        <div
          ref={trackRef}
          onScroll={updateEdges}
          className="flex gap-3 overflow-x-auto scrollbar-hide snap-x snap-mandatory -mx-4 px-4 scroll-px-4 pb-2"
        >
          {list.map((cat, i) => {
            const Icon = CATEGORY_ICONS[i % CATEGORY_ICONS.length];
            const subs = (cat.subcategories || []).slice(0, 2).map((s) => (isAr ? (s.name_ar || s.name) : s.name)).join(' / ');
            return (
              <Link
                key={cat._id}
                href={`/products?category_id=${cat._id}`}
                className="group flex-none w-[150px] sm:w-[170px] snap-start bg-white border border-marine-teal/15 rounded-lg overflow-hidden text-center hover:border-marine-cyan hover:shadow-aura hover:-translate-y-0.5 transition-all"
              >
                {cat.image ? (
                  <span className="block aspect-square overflow-hidden bg-gradient-to-b from-white to-marine-mist p-4">
                    <img
                      src={thumbUrl(resolveAssetUrl(cat.image), 320)}
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                    />
                  </span>
                ) : (
                  <span className="aspect-square bg-marine-mist text-marine-primary flex items-center justify-center group-hover:bg-marine-cyan group-hover:text-white transition-colors">
                    <Icon size={32} />
                  </span>
                )}
                <div className="p-3">
                  <div className="text-sm font-semibold text-marine-ink line-clamp-1">{isAr ? (cat.name_ar || cat.name) : cat.name}</div>
                  {subs && <div className="text-[11px] text-marine-outline mt-0.5 line-clamp-1">{subs}</div>}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function ServiceSpotlight() {
  const { language } = useApp();
  const isAr = language === 'ar';
  return (
    <section className="pb-10 sm:pb-14">
      <div className="max-w-7xl mx-auto px-4">
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-marine-navy via-marine-teal to-marine-primary text-white p-6 sm:p-10 grid lg:grid-cols-[1fr_340px] gap-8 items-center">
          <div>
            <span className="inline-block bg-marine-cyan font-display text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-1 rounded-sm mb-4">
              {isAr ? 'شريك مميّز' : 'Verified Partner Spotlight'}
            </span>
            <h2 className="font-display text-2xl sm:text-[32px] sm:leading-10 font-semibold mb-3">
              {isAr ? 'متجر وخدمات الفحص البحري' : 'Marine Store & Diagnostic Services'}
            </h2>
            <p className="text-white/75 text-sm leading-relaxed max-w-2xl mb-6">
              {isAr
                ? 'محتاج تركيب معتمد؟ احجز مهندسين بحريين معتمدين في الإسكندرية وبورسعيد والغردقة. فحص إلكتروني للمحركات، عَمرة أوتبورد، وعقود صيانة للأساطيل.'
                : 'Need certified installation? Book our vetted marine engineers in Alexandria, Port Said and Hurghada. Computerized engine diagnostics, outboard rebuilding, and fleet maintenance contracts.'}
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/services" className="flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark font-display text-[11px] font-bold uppercase tracking-[0.06em] px-4 py-3 rounded transition-colors">
                <Wrench size={14} />{isAr ? 'احجز فني بحري' : 'Book Marine Technician'}
              </Link>
              <Link href="/contact" className="flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 font-display text-[11px] font-bold uppercase tracking-[0.06em] px-4 py-3 rounded transition-colors">
                <Siren size={14} />{isAr ? 'طوارئ SOS' : 'Emergency Dispatch SOS'}
              </Link>
            </div>
          </div>
          <div className="bg-white/10 backdrop-blur border border-white/15 rounded-lg p-6 text-center">
            <ShieldCheck size={32} className="mx-auto text-marine-cyan mb-3" />
            <div className="font-display text-lg font-semibold mb-1">{isAr ? 'ضمان Ready' : 'Ready Guarantee'}</div>
            <p className="text-white/70 text-xs mb-4">
              {isAr ? '30 يوم ضمان استرجاع على كل قطع التجار المعتمدين في مصر.' : '30-day money-back fitment assurance on all certified vendor parts across Egypt.'}
            </p>
            <div className="bg-white/10 rounded px-3 py-2 font-display text-[11px] tracking-[0.04em]">{isAr ? 'مستودع بورسعيد #44-A' : 'Port Said Depot #44-A'}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

const WORKSHOPS = [
  {
    name: 'Suez Canal Marine Tech', area_en: 'Port Said Freezone Area', area_ar: 'المنطقة الحرة - بورسعيد', rating: 4.9, icon: Anchor,
    desc_en: 'Official warranty repairs, outboard/inboard mechanical overhaul, and certified impeller & gearbox swap within 24h.',
    desc_ar: 'إصلاحات ضمان رسمية، عَمرة محركات أوتبورد وإنبورد، وتغيير الريشة والجيربوكس خلال 24 ساعة.',
    tags: ['Yamaha', 'Mercury', 'Caterpillar'],
  },
  {
    name: 'Alexandria Marina Service Center', area_en: 'Eastern Harbour, Alexandria', area_ar: 'الميناء الشرقي - الإسكندرية', rating: 4.8, icon: Wrench,
    desc_en: 'Computerized diagnostics, hull & propeller service, and instant oil & filter fast-lane services at the berth.',
    desc_ar: 'فحص إلكتروني، صيانة الهيكل والرفاص، وتغيير زيت وفلاتر سريع على المرسى.',
    tags: ['Volvo Penta', 'Suzuki', 'Honda'],
  },
  {
    name: 'Red Sea Avionics & Radar', area_en: 'Hurghada & El Gouna', area_ar: 'الغردقة والجونة', rating: 5.0, icon: Gauge,
    desc_en: 'Specialized marine electricians: GPS chartplotter calibration, sonar transponder installation, and solar battery setups.',
    desc_ar: 'كهربائية بحرية متخصصة: معايرة الـ GPS، تركيب السونار، وأنظمة البطاريات بالطاقة الشمسية.',
    tags: ['Garmin', 'Raymarine', 'Simrad'],
  },
];

export function WorkshopPartners() {
  const { language } = useApp();
  const isAr = language === 'ar';
  return (
    <section className="py-10 sm:py-16 bg-marine-mist/60 border-y border-marine-teal/10">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <p className={SECTION_EYEBROW}>{isAr ? 'مراكز فنية معتمدة' : 'Certified Technical Centers'}</p>
            <h2 className={SECTION_TITLE}>{isAr ? 'ورش الصيانة البحرية الشريكة' : 'Marine Workshop Partners'}</h2>
            <p className="text-sm text-marine-muted mt-1 max-w-2xl">
              {isAr ? 'محتاج تركيب على المرسى؟ اتواصل فوراً مع فنيين بحريين معتمدين بأسعار واضحة.' : 'Need parts installed on-site or at berth? Connect immediately with certified marine technicians with transparent labor rates.'}
            </p>
          </div>
          <Link href="/register" className="flex items-center gap-1.5 bg-marine-teal hover:bg-marine-navy text-white font-display text-[11px] font-bold uppercase tracking-[0.06em] px-4 py-2.5 rounded transition-colors">
            {isAr ? 'انضم كشريك خدمة' : 'Become a Service Partner'}<ArrowRight size={13} className="rtl:rotate-180" />
          </Link>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {WORKSHOPS.map((w) => {
            const Icon = w.icon;
            return (
              <div key={w.name} className="bg-white border border-marine-teal/15 rounded-lg p-5 flex flex-col">
                <div className="flex items-start gap-3 mb-3">
                  <span className="w-11 h-11 rounded bg-marine-mist text-marine-primary flex items-center justify-center flex-shrink-0"><Icon size={20} /></span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-marine-ink text-sm">{w.name}</h3>
                      <span className="flex items-center gap-0.5 bg-marine-mist text-marine-primary font-display text-[11px] font-bold px-1.5 py-0.5 rounded-sm flex-shrink-0">
                        {w.rating}<Star size={10} className="fill-current" />
                      </span>
                    </div>
                    <p className="text-[11px] text-marine-outline">{isAr ? w.area_ar : w.area_en}</p>
                  </div>
                </div>
                <p className="text-xs text-marine-muted leading-relaxed mb-3 flex-1">{isAr ? w.desc_ar : w.desc_en}</p>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {w.tags.map((tag) => (
                    <span key={tag} className="font-display text-[9px] font-bold uppercase tracking-[0.08em] text-marine-teal bg-marine-canvas border border-marine-teal/15 px-1.5 py-0.5 rounded-sm">{tag}</span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Link href="/services" className="flex-1 flex items-center justify-center gap-1.5 bg-marine-cyan hover:bg-marine-cyan-dark text-white font-display text-[10px] font-bold uppercase tracking-[0.06em] py-2.5 rounded transition-colors">
                    <MessageCircle size={13} />{isAr ? 'احجز واتساب' : 'WhatsApp Booking'}
                  </Link>
                  <Link href="/services" className="px-3 flex items-center border border-marine-teal/25 text-marine-teal text-[11px] font-semibold rounded hover:bg-marine-mist transition-colors">
                    {isAr ? 'التفاصيل' : 'Details'}
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

const BRANDS = [
  { name: 'YAMAHA', tag_en: 'Marine Official', tag_ar: 'وكيل بحري' },
  { name: 'MERCURY', tag_en: 'Outboards OEM', tag_ar: 'محركات أوتبورد' },
  { name: 'VOLVO PENTA', tag_en: 'Inboard / Marine', tag_ar: 'إنبورد بحري' },
  { name: 'SUZUKI', tag_en: 'Marine Outboards', tag_ar: 'أوتبورد' },
  { name: 'GARMIN', tag_en: 'Marine Electronics', tag_ar: 'إلكترونيات بحرية' },
  { name: 'QUICKSILVER', tag_en: 'Marine Lubricants', tag_ar: 'زيوت بحرية' },
];

export function AuthorizedBrands() {
  const { language } = useApp();
  const isAr = language === 'ar';
  return (
    <section className="py-10 sm:py-16">
      <div className="max-w-7xl mx-auto px-4 text-center">
        <p className={SECTION_EYEBROW}>{isAr ? 'مصنّعين معتمدين' : 'Certified Manufacturers'}</p>
        <h2 className={`${SECTION_TITLE} mb-2`}>{isAr ? 'تسوّق من الماركات المعتمدة' : 'Shop by Authorized Brands'}</h2>
        <p className="text-sm text-marine-muted mb-8">
          {isAr ? 'شراكات توريد مباشرة بضمان المصنع وأرقام تسلسلية أصلية.' : 'Direct sourcing partnerships ensuring factory warranty & authentic serial numbers.'}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {BRANDS.map((b) => (
            <Link key={b.name} href={`/products?search=${encodeURIComponent(b.name)}`} className="bg-white border border-marine-teal/15 rounded-lg py-6 px-3 hover:border-marine-cyan hover:shadow-aura transition-all">
              <div className="font-display font-bold text-marine-ink tracking-[0.04em]">{b.name}</div>
              <div className="font-display text-[9px] font-bold uppercase tracking-[0.08em] text-marine-primary mt-1">{isAr ? b.tag_ar : b.tag_en}</div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

const PAYMENT_PARTNERS = ['PAYMOB', 'FAWATERAK', 'BOSTA COURIER', 'VALU', isAr => (isAr ? 'الدفع عند الاستلام' : 'CASH ON DOCK')];

export function PaymentPartners() {
  const { language } = useApp();
  const isAr = language === 'ar';
  return (
    <section className="pb-10 sm:pb-14">
      <div className="max-w-7xl mx-auto px-4">
        <div className="bg-white border border-marine-teal/15 rounded-lg p-5 flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex items-center gap-3 flex-1">
            <span className="w-10 h-10 rounded bg-marine-cyan text-white flex items-center justify-center flex-shrink-0"><CreditCard size={18} /></span>
            <div>
              <div className="font-display text-xs font-bold uppercase tracking-[0.06em] text-marine-ink">{isAr ? 'شغالين مع بعض عشان نخدمك' : 'All working together to serve you'}</div>
              <div className="text-xs text-marine-muted">{isAr ? 'دفع موحّد وتوصيل مضمون لليوم التالي للمرسى أو لباب البيت في كل مصر.' : 'Unified billing and guaranteed next-day dock and door courier delivery across Egypt.'}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_PARTNERS.map((p) => {
              const label = typeof p === 'function' ? p(isAr) : p;
              return (
                <span key={label} className="font-display text-[10px] font-bold tracking-[0.06em] text-marine-teal border border-marine-teal/20 bg-marine-canvas px-3 py-2 rounded-sm">
                  {label}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

export function FitmentGuaranteeBanner() {
  const { language } = useApp();
  const isAr = language === 'ar';
  return (
    <div className="bg-marine-mist border border-marine-cyan/25 rounded-lg p-5 flex flex-col sm:flex-row sm:items-center gap-4">
      <span className="w-11 h-11 rounded bg-marine-cyan text-white flex items-center justify-center flex-shrink-0"><BadgeCheck size={22} /></span>
      <div className="flex-1">
        <div className="font-semibold text-marine-ink">{isAr ? 'ضمان توافق 100% من Ready Marine' : 'Ready Marine 100% Fitment Guarantee'}</div>
        <p className="text-xs text-marine-muted">
          {isAr ? 'كل طلب بيتراجع مجاناً على رقم هيكل مركبك (HIN) قبل الشحن.' : 'Every order includes free cross-referencing against your vessel hull ID (HIN) before dock dispatch.'}
        </p>
      </div>
      <Link href="/contact" className="font-display text-[11px] font-bold uppercase tracking-[0.06em] text-marine-primary border border-marine-teal/25 bg-white px-4 py-2.5 rounded hover:bg-marine-canvas transition-colors">
        {isAr ? 'اتأكد مع فني بحري' : 'Check Fit with Marine Tech'}
      </Link>
    </div>
  );
}
