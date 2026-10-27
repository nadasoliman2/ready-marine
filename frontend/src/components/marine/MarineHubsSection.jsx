'use client';

import { ArrowRight, Sparkles } from 'lucide-react';
import Link from '../LocaleLink';
import { useApp } from '../../context/AppContext';
import { MARINE_HUBS, FEATURED_HUB_SLUGS } from '../../lib/marineHubs';

/*
 * The audience hubs on the home page (lib/marineHubs). Three of them sit right under the
 * hero, one large card and two beside it; every other hub is a wide banner of its own
 * between the product rows (<HubBanner slug="..." />), so they are spread down the page
 * rather than gathered in one block.
 */

function FeaturedHubCard({ hub, isAr, large }) {
  const Icon = hub.icon;
  return (
    <Link
      href={`/hub/${hub.slug}`}
      className={`group relative block overflow-hidden rounded-2xl bg-marine-navy shadow-lg hover:shadow-2xl transition-shadow duration-300 lg:h-full ${
        large ? 'h-80 sm:h-96' : 'h-52'
      }`}
    >
      <img
        src={hub.image}
        alt=""
        loading="lazy"
        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[#061826] via-[#061826]/55 to-transparent" />

      <div className={`absolute inset-x-0 bottom-0 ${large ? 'p-6 sm:p-8' : 'p-5'}`}>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 backdrop-blur-md border border-white/20 px-3 py-1 text-[11px] font-bold text-cyan-100 mb-3">
          <Icon size={13} className="text-cyan-300" />
          {isAr ? hub.badgeAr : hub.badgeEn}
        </span>
        <h3 className={`font-display font-black text-white leading-tight ${large ? 'text-2xl sm:text-4xl mb-2' : 'text-lg sm:text-xl mb-3'}`}>
          {isAr ? hub.titleAr : hub.titleEn}
        </h3>
        {large && (
          <p className="text-sm sm:text-base text-cyan-50/85 leading-relaxed max-w-lg mb-5 line-clamp-2">
            {isAr ? hub.descriptionAr : hub.descriptionEn}
          </p>
        )}
        <span className={`inline-flex items-center gap-2 rounded-lg font-bold text-white transition-colors ${
          large ? 'bg-marine-cyan group-hover:bg-marine-cyan-dark px-5 py-2.5 text-sm' : 'text-xs text-cyan-200 group-hover:text-white'
        }`}>
          {isAr ? 'تسوّق المجموعة' : 'Shop the collection'}
          <ArrowRight size={large ? 16 : 14} className="rtl:rotate-180 group-hover:translate-x-1 rtl:group-hover:-translate-x-1 transition-transform" />
        </span>
      </div>
    </Link>
  );
}

export default function FeaturedHubs() {
  const { language } = useApp();
  const isAr = language === 'ar';
  const hubs = FEATURED_HUB_SLUGS.map((slug) => MARINE_HUBS.find((h) => h.slug === slug)).filter(Boolean);
  if (!hubs.length) return null;

  return (
    <section className="py-10 sm:py-14">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-end justify-between gap-4 mb-6">
          <div>
            <p className="inline-flex items-center gap-1.5 font-display text-[11px] font-bold uppercase tracking-[0.08em] text-marine-primary">
              <Sparkles size={13} />{isAr ? 'مجموعات مختارة لك' : 'Curated for you'}
            </p>
            <h2 className="font-display text-2xl sm:text-[32px] sm:leading-10 font-semibold tracking-tight text-marine-ink">
              {isAr ? 'تسوّق حسب أسلوبك البحري' : 'Shop by Your Marine Lifestyle'}
            </h2>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 lg:grid-rows-2 lg:h-[520px] gap-3 sm:gap-4">
          {hubs.map((hub, i) => (
            <div key={hub.slug} className={i === 0 ? 'col-span-2 lg:col-span-2 lg:row-span-2' : 'col-span-1'}>
              <FeaturedHubCard hub={hub} isAr={isAr} large={i === 0} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** One hub as a wide banner, placed between the product rows of the home page. */
export function HubBanner({ slug }) {
  const { language } = useApp();
  const isAr = language === 'ar';
  const hub = MARINE_HUBS.find((h) => h.slug === slug);
  if (!hub) return null;
  const Icon = hub.icon;

  return (
    <section className="py-6 sm:py-8">
      <div className="max-w-7xl mx-auto px-4">
        <Link
          href={`/hub/${hub.slug}`}
          className="group relative block overflow-hidden rounded-2xl bg-marine-navy shadow-lg hover:shadow-2xl transition-shadow duration-300 min-h-[220px] sm:min-h-[260px]"
        >
          <img
            src={hub.image}
            alt=""
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
          />
          <div className="absolute inset-0 bg-gradient-to-r rtl:bg-gradient-to-l from-[#061826] via-[#061826]/80 to-transparent" />

          <div className="relative p-6 sm:p-10 max-w-xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 backdrop-blur-md border border-white/20 px-3 py-1 text-[11px] font-bold text-cyan-100 mb-3">
              <Icon size={13} className="text-cyan-300" />
              {isAr ? hub.badgeAr : hub.badgeEn}
            </span>
            <h3 className="font-display text-2xl sm:text-3xl font-black text-white leading-tight mb-2">
              {isAr ? hub.titleAr : hub.titleEn}
            </h3>
            <p className="text-sm text-cyan-50/80 leading-relaxed mb-5 line-clamp-2">
              {isAr ? hub.descriptionAr : hub.descriptionEn}
            </p>
            <span className="inline-flex items-center gap-2 rounded-lg bg-marine-cyan group-hover:bg-marine-cyan-dark px-5 py-2.5 text-sm font-bold text-white transition-colors">
              {isAr ? 'تسوّق المجموعة' : 'Shop the collection'}
              <ArrowRight size={16} className="rtl:rotate-180" />
            </span>
          </div>
        </Link>
      </div>
    </section>
  );
}
