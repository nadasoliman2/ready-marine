'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, Wrench } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { servicesApi } from '../../lib/api';
import ServiceCard from '../../components/services/ServiceCard';
import { getServiceLocationSearchValues } from '../../lib/serviceLocations';
import Link from '../../components/LocaleLink';

const PAGE_SIZE = 9;

export default function ServicesPage() {
  const { language, t } = useApp();
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
              {t.services || (isAr ? 'الخدمات' : 'Services')}
            </li>
          </ol>
        </nav>

        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-marine-ink font-display">
              {t.services || (isAr ? 'الخدمات' : 'Services')}
            </h1>
            <p className="text-sm text-marine-muted mt-1 max-w-xl">
              {isAr
                ? 'استعرض وتواصل مع مزودي الخدمات المتاحين.'
                : 'Browse and connect with available service providers.'}
            </p>
          </div>

          {/* Search input (only visible if there are services) */}
          {services.length > 0 && (
            <div className="relative w-full md:w-72">
              <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-marine-outline" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isAr ? 'ابحث في الخدمات…' : 'Search services…'}
                className="w-full bg-white border border-marine-teal/20 rounded-xl ps-9 pe-4 py-2.5 text-sm text-marine-ink placeholder-slate-400 outline-none focus:border-marine-cyan focus:ring-2 focus:ring-marine-cyan/15 transition-all shadow-xs"
              />
            </div>
          )}
        </div>

        {/* Content */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="aspect-[4/5] bg-white border border-marine-teal/15 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-20 text-red-500 font-bold">{error}</div>
        ) : services.length === 0 ? (
          <div className="bg-white border border-marine-teal/15 rounded-2xl p-12 text-center max-w-md mx-auto shadow-xs my-12">
            <div className="w-16 h-16 rounded-2xl bg-marine-mist text-marine-primary flex items-center justify-center mx-auto mb-4">
              <Wrench size={28} />
            </div>
            <h3 className="font-display text-xl font-bold text-marine-ink mb-2">
              {isAr ? 'لا توجد خدمات متاحة حالياً' : 'No services available yet'}
            </h3>
            <p className="text-sm text-marine-muted leading-relaxed">
              {isAr
                ? 'لم يتم إضافة أي خدمات بعد.'
                : 'No services have been added yet.'}
            </p>
          </div>
        ) : paginated.length === 0 ? (
          <div className="text-center py-20 space-y-4">
            <Search size={48} className="mx-auto text-marine-line" />
            <h3 className="text-xl font-bold text-marine-ink">{isAr ? 'لا توجد نتائج مطابقة' : 'No services found'}</h3>
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
    </div>
  );
}
