'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { servicesApi } from '../../lib/api';
import ServiceCard from '../../components/services/ServiceCard';
import { getServiceLocationSearchValues } from '../../lib/serviceLocations';
import { SosBar, ServicesHero, SopGrid, MockWorkbays, ServiceValues, PartnerProgramBanner } from '../../components/marine/ServicesSections';
import { SECTION_EYEBROW, SECTION_TITLE } from '../../components/marine/HomeSections';

const PAGE_SIZE = 9;

export default function ServicesPage() {
  const { language, siteSettings } = useApp();
  const isAr = language === 'ar';

  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await servicesApi.getServices({ limit: 60, sort: 'featured' });
        setServices(data.services || []);
      } catch (err) {
        setError(err.message || 'Failed to load services');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return services;
    return services.filter(service => [
      service.title_en,
      service.title_ar,
      service.description_en,
      service.description_ar,
      service.vendor_name_en,
      service.vendor_name_ar,
      ...getServiceLocationSearchValues(service),
    ].some(v => String(v || '').toLowerCase().includes(q)));
  }, [services, search]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const pages = Math.ceil(filtered.length / PAGE_SIZE) || 1;

  return (
    <div className="bg-marine-canvas min-h-screen" dir={isAr ? 'rtl' : 'ltr'}>
      <SosBar isAr={isAr} phone={siteSettings?.header_phone} />
      <ServicesHero isAr={isAr} search={search} onSearch={setSearch} />
      <SopGrid isAr={isAr} />

      <div className="max-w-7xl mx-auto px-4 pb-12">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <p className={SECTION_EYEBROW}>{isAr ? 'مراكز خدمة معتمدة' : 'Authorized Service Centers'}</p>
            <h2 className={SECTION_TITLE}>{isAr ? 'ورش بحرية موثّقة' : 'Vetted Marine Workbays'}</h2>
          </div>
        </div>
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="aspect-[4/5] bg-marine-canvas rounded-xl animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-20 text-red-500 font-bold">{error}</div>
        ) : services.length === 0 ? (
          <MockWorkbays isAr={isAr} />
        ) : paginated.length === 0 ? (
          <div className="text-center py-20 space-y-4">
            <Search size={48} className="mx-auto text-marine-line" />
            <h3 className="text-xl font-bold text-marine-ink">{isAr ? 'لا توجد خدمات' : 'No services found'}</h3>
            <p className="text-marine-outline">{isAr ? 'جرّب تعديل كلمات البحث.' : 'Try adjusting your search keywords.'}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {paginated.map(service => (
                <ServiceCard key={service._id} service={service} />
              ))}
            </div>

            {pages > 1 && (
              <div className="mt-10 flex items-center justify-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-4 py-2 rounded border border-marine-teal/15 text-sm font-semibold text-marine-muted disabled:opacity-40"
                >
                  {isAr ? 'السابق' : 'Previous'}
                </button>
                {Array.from({ length: pages }, (_, i) => i + 1).map(p => (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`w-10 h-10 rounded font-display text-sm font-bold ${page === p ? 'bg-marine-cyan text-white' : 'border border-marine-teal/15 text-marine-muted'}`}
                  >
                    {p}
                  </button>
                ))}
                <button
                  onClick={() => setPage(p => Math.min(pages, p + 1))}
                  disabled={page === pages}
                  className="px-4 py-2 rounded border border-marine-teal/15 text-sm font-semibold text-marine-muted disabled:opacity-40"
                >
                  {isAr ? 'التالي' : 'Next'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
      <ServiceValues isAr={isAr} />
      <PartnerProgramBanner isAr={isAr} />
    </div>
  );
}
