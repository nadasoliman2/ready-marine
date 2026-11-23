'use client';

import { useState, useEffect } from 'react';
import {
  Sparkles, Anchor, Wrench, ShieldCheck, Compass, Coffee, Waves, Cpu,
  Leaf, ArrowRight,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import Link from '../../components/LocaleLink';
import { audienceApi } from '../../lib/api';

// The 9 official marine lifestyle collections
const FALLBACK_NINE_HUBS = [
  {
    slug: 'yacht-luxury',
    titleAr: 'مستلزمات اليخوت الفاخرة',
    titleEn: 'Premium Yacht Luxury',
    badgeAr: 'فخامة واعتناء فائق',
    badgeEn: 'Ultra-Luxury VIP',
    descAr: 'أنظمة إضاءة تحت الماء، شاشات ملاحة ذكية، إكسسوارات ستانلس 316 بحري، وديكورات صالونات اليخوت.',
    descEn: 'Underwater LED illumination, smart chartplotters, marine 316 stainless fittings, and high-end yacht decor.',
    image: '/images/hubs/yacht-luxury.jpg',
    icon: Sparkles,
  },
  {
    slug: 'pro-angler',
    titleAr: 'قسم الصياد المحترف',
    titleEn: 'Pro-Angler Hub',
    badgeAr: 'احتراف وأداء فائق',
    badgeEn: 'Pro Performance',
    descAr: 'أجهزة سونار CHIRP متقدمة، قطع غيار محركات أوتبورد ثقيلة، رفاصات ستانلس، ومعدات صيد الأعماق.',
    descEn: 'Advanced CHIRP sonars, heavy outboard parts, stainless propellers, and deep-water big-game tackle.',
    image: '/images/hubs/pro-angler.jpg',
    icon: Anchor,
  },
  {
    slug: 'diy-maintenance',
    titleAr: 'صيانتك بنفسك',
    titleEn: 'DIY Boat Maintenance',
    badgeAr: 'أطقم توفير وصيانة ذاتية',
    badgeEn: 'Cost-Saving DIY Kits',
    descAr: 'باقات متكاملة لتغيير الزيت والفلاتر، ريش طلمبات التبريد، أنودات الزنك لمنع التآكل، وبويات الحماية البحرية.',
    descEn: 'Complete engine oil service kits, water pump impellers, zinc anodes, and marine anti-fouling paint.',
    image: '/images/hubs/diy-maintenance.jpg',
    icon: Wrench,
  },
  {
    slug: 'lifestyle-comfort',
    titleAr: 'الرحلات والرفاهية',
    titleEn: 'Lifestyle & Comfort',
    badgeAr: 'استجمام وراحة تامة',
    badgeEn: 'Pure Leisure & Chill',
    descAr: 'كراسي قوارب مريحة، ثلاجات آيس بوكس معزولة لحفظ الأغذية، وأنظمة صوت بحرية مقاومة للملوحة والرذاذ.',
    descEn: 'Ergonomic helm lounge seats, deep-insulated marine coolers, and salt-resistant waterproof sound systems.',
    image: '/images/hubs/lifestyle-comfort.jpg',
    icon: Coffee,
  },
  {
    slug: 'next-gen',
    titleAr: 'المبتدئين والشباب',
    titleEn: 'Next-Gen Boaters',
    badgeAr: 'شباب ونشاط (20-35)',
    badgeEn: 'Young & Active (20-35)',
    descAr: 'ألواح تجديف وويك بورد، قوارب كاياك سهلة النقل، ماسكات سنوركل بانورامية، ومعدات صيد ترفيهية اقتصادية.',
    descEn: 'Wakeboards, recreational kayaks, full-face snorkel masks, and user-friendly budget fishing gear.',
    image: '/images/hubs/next-gen.jpg',
    icon: Compass,
  },
  {
    slug: 'saltwater',
    titleAr: 'المياه المالحة والعذبة',
    titleEn: 'Saltwater & Freshwater',
    badgeAr: 'معدات بيئات متخصصة',
    badgeEn: 'Specialized Waters',
    descAr: 'معادن ومسامير معالجة ضد الملوحة، ماكينات صيد مياه مفتوحة، وقوارب كاياك لصيد البحيرات والأنهار.',
    descEn: 'Corrosion-proof saltwater alloys, high-capacity reels, and lightweight kayaks for tranquil inland lakes.',
    image: '/images/hubs/saltwater.jpg',
    icon: Waves,
  },
  {
    slug: 'smart-eco',
    titleAr: 'الصيد الذكي والتقنية',
    titleEn: 'Smart Marine Tech',
    badgeAr: 'تكنولوجيا ذكية',
    badgeEn: 'Smart Tech & Marine',
    descAr: 'طائرات درون لإسقاط الطعوم، ساعات بحرية ذكية بـ GPS، كاميرات تحت الماء، ومستشعرات حرارة المياه.',
    descEn: 'Bait-casting drones, marine GPS watches, high-definition underwater cameras, and smart sensors.',
    image: '/images/hubs/smart-gear.jpg',
    icon: Cpu,
  },
  {
    slug: 'family-safety',
    titleAr: 'أمان العائلة والأطفال',
    titleEn: 'Family & Kids Safety',
    badgeAr: 'أمان وراحة بال عائلية',
    badgeEn: 'Family Safety First',
    descAr: 'سترات نجاة أصلية للأطفال بألوان واضحة، أطواق إنقاذ بحبال عائمة، سنارات آمنة، وحقائب إسعافات أولية.',
    descEn: 'Certified high-visibility youth life vests, emergency lifebuoys, child-safe fishing rods, and marine first aid.',
    image: '/images/hubs/family-safety.jpg',
    icon: ShieldCheck,
  },
  {
    slug: 'eco-friendly',
    titleAr: 'القسم الصديق للبيئة',
    titleEn: 'Eco-Friendly Marine',
    badgeAr: 'استدامة وحلول بيئية',
    badgeEn: 'Clean & Sustainable',
    descAr: 'منظفات قوارب خالية من الفوسفات لحماية الشعب، طعوم قابلة للتحلل، ومعدات طاقة شمسية وتجديف نظيفة.',
    descEn: 'Phosphate-free eco boat washes, biodegradable lures, and clean solar and human-powered marine gear.',
    image: '/images/hubs/eco-friendly.jpg',
    icon: Leaf,
  },
];

export default function MarineHubsPage() {
  const { language, t } = useApp();
  const isAr = language === 'ar';

  const [hubs, setHubs] = useState(FALLBACK_NINE_HUBS);

  // Sync with database audiences if edited from Admin Dashboard
  useEffect(() => {
    audienceApi.getAll()
      .then((res) => {
        if (res?.success && Array.isArray(res.audiences)) {
          const activeList = res.audiences.filter((a) => a.is_active && a.card_position !== 'hidden');
          if (activeList.length > 0) {
            const mapped = activeList.map((aud) => {
              const fallback = FALLBACK_NINE_HUBS.find((f) => f.slug === aud.slug) || {};
              return {
                slug: aud.slug,
                titleAr: aud.name_ar || fallback.titleAr || aud.name_en,
                titleEn: aud.name_en || fallback.titleEn || aud.name_ar,
                badgeAr: aud.badge_ar || fallback.badgeAr || '',
                badgeEn: aud.badge_en || fallback.badgeEn || '',
                descAr: aud.description_ar || fallback.descAr || '',
                descEn: aud.description_en || fallback.descEn || '',
                image: aud.image || fallback.image || '/images/hubs/yacht-luxury.jpg',
                icon: fallback.icon || Sparkles,
              };
            });
            // If the database has the 9 audiences, use them
            if (mapped.length >= 8) {
              setHubs(mapped);
            }
          }
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="bg-marine-canvas min-h-screen py-6 sm:py-10" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-4">
          <ol className="flex items-center gap-2 text-xs text-marine-outline">
            <li>
              <Link href="/" className="hover:text-marine-primary transition-colors">
                {t.home || (isAr ? 'الرئيسية' : 'Home')}
              </Link>
            </li>
            <li className="select-none text-slate-300">/</li>
            <li className="font-bold text-marine-ink">
              {isAr ? 'مجموعات ريدي مارين' : 'Marine Hubs'}
            </li>
          </ol>
        </nav>

        {/* Clean, Elegant Header */}
        <div className="mb-8 sm:mb-10">
          <div className="flex items-center gap-2 text-marine-primary font-bold text-xs uppercase tracking-wider mb-1.5">
            <Sparkles size={16} />
            <span>{isAr ? 'تسوّق حسب أسلوب إبحارك' : 'Curated for Your Lifestyle'}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-marine-ink font-display tracking-tight">
            {isAr ? 'مجموعات ريدي مارين المتخصصة' : 'Ready Marine Specialized Hubs'}
          </h1>
          <p className="text-sm text-marine-muted mt-1.5 max-w-2xl">
            {isAr
              ? 'استكشف مجموعاتنا الـ ٩ المتخصصة، حيث تم تجميع قطع الغيار والمعدات بدقة لتناسب كل احتياج بحري وأسلوب إبحار.'
              : 'Explore our 9 specialized marine collections, thoughtfully organized to match every boating discipline and on-water need.'}
          </p>
        </div>

        {/* The 9 Hubs Grid: 3x3 on Desktop, 2xCols on Tablet, 1xCol on Mobile */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {hubs.map((hub) => {
            const HubIcon = hub.icon || Sparkles;
            const title = isAr ? hub.titleAr : hub.titleEn;
            const badge = isAr ? hub.badgeAr : hub.badgeEn;
            const desc = isAr ? hub.descAr : hub.descEn;

            return (
              <div
                key={hub.slug}
                className="group relative h-[360px] sm:h-[390px] rounded-3xl overflow-hidden shadow-md hover:shadow-2xl transition-all duration-300 bg-marine-navy flex flex-col justify-between border border-white/10 hover:border-cyan-400/40 hover:-translate-y-1.5"
              >
                {/* Background Image with Zoom on Hover */}
                <img
                  src={hub.image}
                  alt={title}
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105 pointer-events-none select-none"
                  onError={(e) => {
                    e.currentTarget.src = '/images/hubs/yacht-luxury.jpg';
                  }}
                />

                {/* Dark Marine Gradient Overlay (Exact match to Hero Slider style) */}
                <div className="absolute inset-0 bg-gradient-to-t from-[#061826]/95 via-[#061826]/60 to-black/25 pointer-events-none" />

                {/* Top Badge */}
                <div className="relative z-10 p-5 sm:p-6 flex items-start justify-between">
                  {badge && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-black/50 backdrop-blur-md border border-white/20 text-cyan-200 text-xs font-bold px-3 py-1 shadow-sm">
                      <HubIcon size={13} className="text-cyan-300" />
                      <span>{badge}</span>
                    </span>
                  )}
                </div>

                {/* Bottom Content Body */}
                <div className="relative z-10 p-5 sm:p-6 space-y-3">
                  {/* Title */}
                  <h3 className="font-display font-black text-white text-xl sm:text-2xl leading-tight group-hover:text-cyan-300 transition-colors drop-shadow-sm">
                    {title}
                  </h3>

                  {/* Description */}
                  <p className="text-xs sm:text-sm text-cyan-50/85 leading-relaxed line-clamp-2">
                    {desc}
                  </p>

                  {/* Action Link / Button */}
                  <div className="pt-2">
                    <Link
                      href={`/hub/${hub.slug}`}
                      className="inline-flex items-center justify-center gap-2 bg-[#0099b8] hover:bg-[#00829e] active:scale-95 text-white text-xs sm:text-sm font-bold px-5 py-2.5 rounded-xl shadow-md transition-all w-full sm:w-auto text-center"
                    >
                      <span>{isAr ? 'تسوّق المجموعة' : 'Shop the Collection'}</span>
                      <ArrowRight size={14} className="rtl:rotate-180 group-hover:translate-x-1 rtl:group-hover:-translate-x-1 transition-transform" />
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
