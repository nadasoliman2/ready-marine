'use client';

import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { resolveAssetUrl } from '../lib/assets';

/**
 * "Ready Marine's corporate clients" — the logos of the corporate accounts whose managers
 * uploaded one and chose to show it (company portal → Settings). Nothing is shown for an
 * account that did not, so the section stays hidden until at least one has.
 */
export default function CorporateClientsSection() {
  const { language } = useApp();
  const isAr = language === 'ar';
  const [clients, setClients] = useState([]);

  useEffect(() => {
    let alive = true;
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/corporate-clients`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (alive) setClients(data?.clients || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (clients.length === 0) return null;

  return (
    <section className="py-16 bg-white border-t border-marine-teal/15" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="max-w-7xl mx-auto px-4">
        <div className="mb-10">
          <p className="text-marine-primary text-sm font-semibold uppercase tracking-widest mb-1">
            {isAr ? 'عملاؤنا' : 'Clients'}
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-marine-ink">
            {isAr ? 'عملاء ريدي مارين من المؤسسات' : "Ready Marine's corporate clients"}
          </h2>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {clients.map((c) => (
            <div key={c._id} className="h-28 rounded-lg border border-marine-teal/15 bg-white shadow-sm flex items-center justify-center px-6" title={c.name}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={resolveAssetUrl(c.logo)} alt={c.name} loading="lazy" className="max-h-16 max-w-full object-contain" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
