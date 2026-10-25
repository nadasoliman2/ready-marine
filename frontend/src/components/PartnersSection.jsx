'use client';

import { useApp } from '../context/AppContext';

/**
 * "All working together to serve you" — the companies behind Ready Marine's payments,
 * shipping, messaging and technology. Logos are the partners' own, from their sites,
 * kept in public/images/partners.
 */
const PARTNERS = [
  { name: 'Paymob', logo: '/images/partners/paymob.png', url: 'https://paymob.com' },
  { name: 'Fawaterak', logo: '/images/partners/fawaterak.png', url: 'https://www.fawaterak.com' },
  { name: 'Bosta', logo: '/images/partners/bosta.svg', url: 'https://bosta.co' },
  { name: 'Tech Oriented', logo: '/images/partners/tech-oriented.png', url: 'https://tech-oriented.digital' },
  { name: 'EverySecond AI', logo: '/images/partners/everysecond.png', url: 'https://everysecond.ai' },
];

export default function PartnersSection() {
  const { language } = useApp();
  const isAr = language === 'ar';

  return (
    <section className="py-16 bg-white" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="max-w-7xl mx-auto px-4">
        <div className="mb-10">
          <p className="text-marine-primary text-sm font-semibold uppercase tracking-widest mb-1">
            {isAr ? 'شركاؤنا' : 'Partners'}
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-marine-ink">
            {isAr ? 'كل هؤلاء يتعاونون لخدمتكم' : 'All working together to serve you'}
          </h2>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {PARTNERS.map((p) => {
            const card = (
              <div className="h-28 rounded-lg border border-marine-teal/15 bg-white shadow-sm flex items-center justify-center px-6 transition-all duration-300 group-hover:border-marine-cyan/30 group-hover:shadow-[0_8px_30px_rgb(0,0,0,0.06)] group-hover:-translate-y-0.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.logo} alt={p.name} title={p.name} loading="lazy" className="max-h-12 max-w-full object-contain" />
              </div>
            );
            return p.url ? (
              <a key={p.name} href={p.url} target="_blank" rel="noopener noreferrer" className="group block" aria-label={p.name}>
                {card}
              </a>
            ) : (
              <div key={p.name} className="group">{card}</div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
