'use client';

import {
  ArrowRight, BadgeCheck, CalendarCheck, Cog, Cpu, MapPin, MessageCircle, Phone, Radar, Search,
  ShieldCheck, Ship, Siren, Star, Truck, Wrench, Activity,
} from 'lucide-react';
import Link from '../LocaleLink';
import { SECTION_EYEBROW, SECTION_TITLE } from './HomeSections';

/*
 * The services page of the Ready Marine design. The workbays list is the store's own
 * services when it has them; everything else is showcase copy.
 */

export function SosBar({ isAr, phone }) {
  return (
    <div className="bg-red-700 text-white">
      <div className="max-w-7xl mx-auto px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span className="flex items-center gap-1.5 font-display font-bold uppercase tracking-[0.06em]">
          <Siren size={14} />{isAr ? 'طوارئ 24/7 على المرسى — البحر الأحمر والمتوسط' : 'Red Sea & Mediterranean 24/7 Dockside Emergency SOS'}
        </span>
        <span className="hidden md:inline text-white/80">{isAr ? 'متوسط وصول الفني: 42 دقيقة في الإسكندرية وبورسعيد' : 'Average dispatch arrival: 42 mins in Alexandria & Port Said'}</span>
        <span className="ms-auto flex items-center gap-2">
          {phone && (
            <a href={`tel:${phone}`} className="flex items-center gap-1 bg-white/15 hover:bg-white/25 px-2.5 py-1 rounded-sm font-display font-bold" dir="ltr">
              <Phone size={12} />{phone}
            </a>
          )}
          <span className="flex items-center gap-1 bg-white text-red-700 px-2.5 py-1 rounded-sm font-display font-bold uppercase tracking-[0.06em]">
            <MessageCircle size={12} />WhatsApp SOS
          </span>
        </span>
      </div>
    </div>
  );
}

const DISTRICTS = [
  { en: 'All Hubs', ar: 'كل المراكز', q: '' },
  { en: 'Alexandria (Eastern Harbor & Smouha)', ar: 'الإسكندرية (الميناء الشرقي وسموحة)', q: 'Alexandria' },
  { en: 'Port Said Freezone & Suez Entry', ar: 'بورسعيد والسويس', q: 'Port Said' },
  { en: 'Cairo Central Workshops', ar: 'ورش القاهرة', q: 'Cairo' },
  { en: 'Hurghada & El Gouna Marinas', ar: 'مراسي الغردقة والجونة', q: 'Hurghada' },
];

export function ServicesHero({ isAr, search, onSearch }) {
  return (
    <section className="bg-gradient-to-b from-marine-mist to-marine-canvas border-b border-marine-teal/10">
      <div className="max-w-7xl mx-auto px-4 py-10 sm:py-14">
        <div className="grid lg:grid-cols-[1fr_360px] gap-8 items-start mb-8">
          <div>
            <span className="inline-flex items-center gap-1.5 bg-white border border-marine-teal/15 text-marine-teal font-display text-[10px] font-bold uppercase tracking-[0.08em] px-2.5 py-1 rounded-sm mb-4">
              <BadgeCheck size={12} className="text-marine-cyan" />{isAr ? 'شبكة الصيانة البحرية المعتمدة في مصر' : 'Egypt Certified Marine & Fleet Network'}
            </span>
            <h1 className="font-display text-[28px] leading-9 sm:text-[40px] sm:leading-[48px] font-bold tracking-[-0.02em] text-marine-ink mb-3">
              {isAr ? 'تركيب معتمد، فحص إلكتروني للمحركات، وخدمة طوارئ على المرسى' : 'Certified Installation, Engine Diagnostics & Emergency Dockside Service'}
            </h1>
            <p className="text-marine-muted max-w-2xl">
              {isAr
                ? 'اتواصل مباشرة مع ميكانيكية بحريين معتمدين، ومتخصصين في الإلكترونيات، وفنيين على المراسي في الإسكندرية وبورسعيد والقاهرة والغردقة.'
                : 'Directly connect with certified naval mechanics, marine electronics specialists, and harbor technicians across Alexandria, Port Said, Cairo, and Hurghada marinas.'}
            </p>
          </div>
          <div className="bg-white border border-marine-teal/15 rounded-lg shadow-pod p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="font-display text-[10px] font-bold uppercase tracking-[0.08em] text-marine-muted">{isAr ? 'النبض المباشر للشبكة' : 'Network Real-Time Pulse'}</span>
              <span className="flex items-center gap-1 font-display text-[10px] font-bold uppercase tracking-[0.08em] text-marine-success">
                <Activity size={12} />{isAr ? 'نشط' : 'Active Dispatch'}
              </span>
            </div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-marine-muted">{isAr ? 'فنيين متاحين' : 'Technicians Mobile'}</span>
              <span className="font-display font-bold text-marine-ink">38 {isAr ? 'متاح' : 'On-Call'}</span>
            </div>
            <div className="h-1.5 bg-marine-mist rounded-full overflow-hidden mb-4"><div className="h-full w-[76%] bg-marine-cyan" /></div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ['98.4%', isAr ? 'إصلاح من أول مرة' : 'First-Fix Rate'],
                ['< 45m', isAr ? 'السويس / بورسعيد' : 'Suez / Port Said'],
                ['100%', isAr ? 'معايرة OEM' : 'OEM Calibrated'],
              ].map(([v, l]) => (
                <div key={l} className="bg-marine-canvas rounded px-2 py-2">
                  <div className="font-display font-bold text-marine-primary">{v}</div>
                  <div className="text-[10px] text-marine-outline">{l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white border border-marine-teal/15 rounded-lg p-4 flex flex-col lg:flex-row lg:items-center gap-3">
          <span className="flex items-center gap-2 font-display text-[10px] font-bold uppercase tracking-[0.08em] text-marine-muted flex-shrink-0">
            <MapPin size={14} className="text-marine-primary" />{isAr ? 'اختار الميناء أو المنطقة:' : 'Select port or metro district:'}
          </span>
          <div className="flex flex-wrap gap-2 flex-1">
            {DISTRICTS.map((d) => {
              const active = search === d.q;
              return (
                <button
                  key={d.en}
                  type="button"
                  onClick={() => onSearch(d.q)}
                  className={`font-display text-[10px] font-bold uppercase tracking-[0.06em] px-3 py-2 rounded-sm border transition-colors ${active ? 'bg-marine-teal border-marine-teal text-white' : 'bg-marine-canvas border-marine-teal/15 text-marine-muted hover:border-marine-cyan'}`}
                >
                  {isAr ? d.ar : d.en}
                </button>
              );
            })}
          </div>
          <div className="relative lg:w-64">
            <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-marine-outline" />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={isAr ? 'ابحث بالمركب أو المحرك…' : 'Search by vessel/engine code…'}
              className="w-full bg-marine-canvas border border-marine-teal/20 rounded ps-9 pe-3 py-2 text-sm outline-none focus:border-marine-cyan focus:ring-[3px] focus:ring-marine-cyan/15"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

const SOPS = [
  { code: 'SVC-ENG-01', icon: Cog, tag: 'Heavy Overhaul', en: 'Outboard & Inboard Engine Overhaul', ar: 'عَمرة محركات أوتبورد وإنبورد',
    d_en: 'Complete disassembly, cylinder block boring, valve seat regrinding, compression validation, and heat-exchanger descaling for Mercury, Yamaha, Yanmar, and Volvo Penta blocks.',
    d_ar: 'فك كامل، خراطة البلوك، تجليخ البلوف، اختبار الضغط، وتنظيف المبادل الحراري لمحركات Mercury وYamaha وYanmar وVolvo Penta.',
    foot_en: 'Dockside or Bay', foot_ar: 'على المرسى أو في الورشة' },
  { code: 'SVC-ECU-02', icon: Cpu, tag: 'CAN-Bus & NMEA', en: 'Computerized Engine Diagnostics & Telemetry', ar: 'فحص إلكتروني للمحرك والتليمتري',
    d_en: 'Live CAN bus stream logging, marine electronic control module flashing, injection timing calibration, and fault-code eradication with licensed OEM software.',
    d_ar: 'قراءة مباشرة للـ CAN bus، برمجة وحدة التحكم البحرية، معايرة توقيت الحقن، ومسح الأعطال ببرامج OEM مرخّصة.',
    foot_en: 'Real-Time Waveform', foot_ar: 'قراءة لحظية' },
  { code: 'SVC-RAD-03', icon: Radar, tag: 'Avionics & GPS', en: 'Marine Electrical & Radar Calibration', ar: 'كهرباء بحرية ومعايرة الرادار',
    d_en: 'NMEA 2000 network troubleshooting, chirp sonar array mounting, auto-pilot compass swinging, AIS transponder validation, and galvanic corrosion testing.',
    d_ar: 'إصلاح شبكات NMEA 2000، تركيب السونار، معايرة البوصلة والأوتوبايلوت، اختبار AIS، وفحص التآكل الجلفاني.',
    foot_en: 'Raymarine • Garmin • Furuno', foot_ar: 'Raymarine • Garmin • Furuno' },
  { code: 'SVC-HUL-04', icon: Wrench, tag: 'Haul-Out', en: 'Hull, Propeller & Shaft Service', ar: 'صيانة الهيكل والرفاص وعمود الإدارة',
    d_en: 'Antifouling, propeller balancing, shaft alignment, cutless bearing replacement, and zinc anode refresh during haul-out.',
    d_ar: 'دهان مانع للحشف، موازنة الرفاص، ضبط استقامة العمود، تغيير الجلب، وتجديد الزنك أثناء الرفع.',
    foot_en: 'Alexandria & Port Said Yards', foot_ar: 'ترسانات الإسكندرية وبورسعيد' },
];

export function SopGrid({ isAr }) {
  return (
    <section className="py-10 sm:py-14">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <p className={SECTION_EYEBROW}>{isAr ? 'إجراءات تشغيل قياسية' : 'Standard Operating Procedures'}</p>
            <h2 className={SECTION_TITLE}>{isAr ? 'هندسة بحرية وفحص متخصص' : 'Specialized Diagnostic & Field Engineering'}</h2>
          </div>
          <p className="text-xs text-marine-muted max-w-sm">
            {isAr ? 'معتمدة وفق بروتوكولات Lloyd’s Register وBureau Veritas للعمليات البحرية.' : 'Certified by Lloyd’s Register & Bureau Veritas protocols for marine operations.'}
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {SOPS.map((sop) => {
            const Icon = sop.icon;
            return (
              <div key={sop.code} className="group bg-white border border-marine-teal/15 rounded-lg overflow-hidden flex flex-col hover:border-marine-cyan hover:shadow-aura transition-all">
                <div className="relative h-32 bg-gradient-to-br from-marine-teal to-marine-navy flex items-center justify-center">
                  <Icon size={44} className="text-marine-cyan/80" strokeWidth={1.5} />
                  <span className="absolute top-3 end-3 bg-white/95 text-marine-teal font-display text-[10px] font-bold px-1.5 py-0.5 rounded-sm">{sop.tag}</span>
                  <span className="absolute top-3 start-3 font-display text-[10px] tracking-[0.04em] text-white/70">{sop.code}</span>
                </div>
                <div className="p-4 flex flex-col flex-1">
                  <h3 className="font-semibold text-marine-ink mb-2">{isAr ? sop.ar : sop.en}</h3>
                  <p className="text-xs text-marine-muted leading-relaxed flex-1">{isAr ? sop.d_ar : sop.d_en}</p>
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-marine-teal/10">
                    <span className="font-display text-[10px] font-bold uppercase tracking-[0.08em] text-marine-primary">{isAr ? sop.foot_ar : sop.foot_en}</span>
                    <ArrowRight size={14} className="text-marine-primary rtl:rotate-180 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 bg-marine-mist border border-marine-teal/15 rounded-lg p-5 flex flex-col md:flex-row md:items-center gap-4">
          <span className="w-11 h-11 rounded bg-white text-marine-primary flex items-center justify-center flex-shrink-0"><Ship size={22} /></span>
          <div className="flex-1">
            <span className="inline-block bg-marine-teal text-white font-display text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded-sm mb-1">{isAr ? 'أساطيل تجارية وتشارتر' : 'Commercial & Charter Fleets'}</span>
            <h3 className="font-semibold text-marine-ink">{isAr ? 'عقود صيانة دورية للأساطيل' : 'Periodic Fleet Maintenance & SLA Contracts'}</h3>
            <p className="text-xs text-marine-muted">
              {isAr ? 'استجابة مضمونة على المرسى لمراكب الغوص، القاطرات، ومراكب السفاري — تحليل زيت، ضبط استقامة العمود، وجدولة تغيير الريشة والفلاتر.' : 'Guaranteed dockside response times for dive boats, harbor tugs, safari vessels and support transport — oil analysis, shaft alignment and scheduled impeller & filter turnarounds.'}
            </p>
          </div>
          <Link href="/contact" className="font-display text-[11px] font-bold uppercase tracking-[0.06em] text-marine-primary border border-marine-teal/25 bg-white px-4 py-2.5 rounded hover:bg-marine-canvas transition-colors flex-shrink-0">
            {isAr ? 'أسعار الشركات' : 'Tailored Corporate SLA Pricing'}
          </Link>
        </div>
      </div>
    </section>
  );
}

const MOCK_WORKBAYS = [
  { name: 'Pharos Marine Overhaul Works', loc_en: 'Eastern Harbor Marina, Alexandria', loc_ar: 'مارينا الميناء الشرقي، الإسكندرية', rating: 4.9, reviews: 184, brands: ['Yamaha Marine', 'Volvo Penta Inboard', 'Mercury Racing'], status_en: '3 slots available today', status_ar: '3 مواعيد متاحة النهارده' },
  { name: 'Canal Zone Turbo & Marine ECU', loc_en: 'Port Said Freezone Drydock Berth 14', loc_ar: 'الحوض الجاف رصيف 14، بورسعيد', rating: 4.8, reviews: 142, brands: ['Caterpillar (CAT)', 'Cummins Marine', 'MAN Industrial'], status_en: 'Emergency team standby', status_ar: 'فريق طوارئ جاهز' },
  { name: 'Red Sea Yacht Specialists & Rigging', loc_en: 'Abu Tig Marina, El Gouna', loc_ar: 'مارينا أبو تيج، الجونة', rating: 4.95, reviews: 210, brands: ['Mercury Verado', 'Suzuki Marine', 'Garmin Marine'], status_en: '2 mobile tenders operating', status_ar: '2 لنش متنقل شغال' },
  { name: 'Delta Powertrain & Dyno Diagnostics', loc_en: 'Industrial Zone 3, 6th of October', loc_ar: 'المنطقة الصناعية 3، 6 أكتوبر', rating: 4.86, reviews: 98, brands: ['Bosch Diesel', 'Detroit Diesel', 'ZF Marine Gears'], status_en: 'Dyno testing slot open', status_ar: 'متاح اختبار داينو' },
];

export function MockWorkbays({ isAr }) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {MOCK_WORKBAYS.map((w) => (
        <div key={w.name} className="bg-white border border-marine-teal/15 rounded-lg p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h3 className="font-semibold text-marine-ink flex items-center gap-1.5">{w.name}<BadgeCheck size={14} className="text-marine-cyan" /></h3>
              <p className="text-[11px] text-marine-outline flex items-center gap-1"><MapPin size={11} />{isAr ? w.loc_ar : w.loc_en}</p>
            </div>
            <div className="text-end flex-shrink-0">
              <span className="inline-flex items-center gap-0.5 bg-marine-mist text-marine-primary font-display text-xs font-bold px-1.5 py-0.5 rounded-sm">
                <Star size={11} className="fill-current" />{w.rating}
              </span>
              <div className="text-[10px] text-marine-outline mt-0.5">{w.reviews} {isAr ? 'تقييم' : 'reviews'}</div>
            </div>
          </div>
          <p className="font-display text-[10px] font-bold uppercase tracking-[0.08em] text-marine-muted mb-2">{isAr ? 'الماركات والمحركات المعتمدة:' : 'Certified brands & engines:'}</p>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {w.brands.map((b) => (
              <span key={b} className="text-[11px] text-marine-teal bg-marine-canvas border border-marine-teal/15 px-2 py-0.5 rounded-sm">{b}</span>
            ))}
          </div>
          <p className="flex items-center gap-1.5 text-xs text-marine-success font-medium mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-marine-success" />{isAr ? w.status_ar : w.status_en}
          </p>
          <div className="flex gap-2">
            <Link href="/contact" className="flex-1 flex items-center justify-center gap-1.5 bg-marine-teal hover:bg-marine-navy text-white font-display text-[10px] font-bold uppercase tracking-[0.06em] py-2.5 rounded transition-colors">
              <CalendarCheck size={13} />{isAr ? 'احجز خدمة في الموقع' : 'Book On-Site Service'}
            </Link>
            <span className="px-3 flex items-center gap-1 border border-marine-teal/25 text-marine-teal font-display text-[10px] font-bold uppercase rounded">
              <MessageCircle size={12} />WhatsApp
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ServiceValues({ isAr }) {
  const items = [
    { icon: ShieldCheck, en: '12-Month Fitment Warranty', ar: 'ضمان تركيب 12 شهر',
      d_en: 'Every rebuild or diagnostic repair executed by Ready Marine vetted workshops carries a direct component and labor warranty.',
      d_ar: 'كل عَمرة أو إصلاح من ورش Ready Marine المعتمدة عليه ضمان مباشر على القطعة والمصنعية.' },
    { icon: Wrench, en: 'OEM Certified Tooling', ar: 'معدات OEM معتمدة',
      d_en: 'Our service partners utilize authentic proprietary scanners, torque-angle calibrators, and OEM flash programmers.',
      d_ar: 'شركاؤنا بيستخدموا أجهزة فحص أصلية، ومعايرات عزم، وبرامج OEM.' },
    { icon: Truck, en: 'Instant Spares Integration', ar: 'قطع الغيار فوراً',
      d_en: 'Workshops source replacement gaskets, impellers and electronics directly from the Ready Marine parts warehouse with 2-hour courier priority.',
      d_ar: 'الورش بتسحب الجوانات والريش والإلكترونيات مباشرة من مخزن Ready Marine بأولوية توصيل ساعتين.' },
  ];
  return (
    <section className="pb-10 sm:pb-14">
      <div className="max-w-7xl mx-auto px-4 grid md:grid-cols-3 gap-4">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <div key={it.en} className="bg-marine-mist border border-marine-teal/10 rounded-lg p-5 flex gap-3">
              <span className="w-10 h-10 rounded bg-white text-marine-primary flex items-center justify-center flex-shrink-0"><Icon size={18} /></span>
              <div>
                <h3 className="font-semibold text-sm text-marine-ink mb-1">{isAr ? it.ar : it.en}</h3>
                <p className="text-xs text-marine-muted leading-relaxed">{isAr ? it.d_ar : it.d_en}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function PartnerProgramBanner({ isAr }) {
  return (
    <section className="pb-12 sm:pb-16">
      <div className="max-w-7xl mx-auto px-4">
        <div className="rounded-xl bg-gradient-to-br from-marine-navy to-marine-teal text-white p-6 sm:p-10">
          <span className="inline-block bg-marine-cyan font-display text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-1 rounded-sm mb-4">
            {isAr ? 'برنامج توسع الورش' : 'Workshop Expansion Program'}
          </span>
          <h2 className="font-display text-2xl sm:text-[32px] sm:leading-10 font-semibold mb-3 max-w-2xl">
            {isAr ? 'إنت ميكانيكي بحري معتمد أو مركز صيانة يخوت في مصر؟' : 'Are you a Certified Marine Mechanic or Yacht Service Center in Egypt?'}
          </h2>
          <p className="text-white/75 text-sm max-w-2xl mb-6">
            {isAr ? 'انضم لدليل الهندسة البحرية الموحّد. استقبل حجوزات مباشرة من أصحاب المراكب، وخصومات جملة على القطع، وعقود صيانة أساطيل.' : 'Join Egypt’s unified marine engineering directory. Receive direct bookings from vessel owners, access wholesale parts discounts, and expand into commercial marina fleet contracts.'}
          </p>
          <div className="flex flex-wrap gap-3 mb-5">
            <Link href="/register" className="bg-marine-cyan hover:bg-marine-cyan-dark font-display text-[11px] font-bold uppercase tracking-[0.06em] px-5 py-3 rounded transition-colors">
              {isAr ? 'سجّل كشريك خدمة' : 'Apply as Service Partner'}
            </Link>
            <Link href="/contact" className="bg-white/10 hover:bg-white/20 border border-white/20 font-display text-[11px] font-bold uppercase tracking-[0.06em] px-5 py-3 rounded transition-colors">
              {isAr ? 'اطلب شروط الانضمام' : 'Partner Requirements'}
            </Link>
          </div>
          <div className="flex flex-wrap gap-5 text-xs text-white/80">
            <span className="flex items-center gap-1.5"><BadgeCheck size={14} className="text-marine-cyan" />{isAr ? 'بدون رسوم إدراج للمراسي المرخّصة' : 'Zero listing fees for licensed docks'}</span>
            <span className="flex items-center gap-1.5"><BadgeCheck size={14} className="text-marine-cyan" />{isAr ? 'تحويلات تلقائية عبر Paymob' : 'Automated Paymob escrow payouts'}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
