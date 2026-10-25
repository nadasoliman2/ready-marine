'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, Store } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { vendorApi } from '../../lib/api';
import VendorCard from '../../components/VendorCard';

export default function VendorsPage() {
  const { language, isMounted } = useApp();
  const isAr = language === 'ar';
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let active = true;
    vendorApi.getPublicVendors({ placement: 'page', limit: 100 })
      .then(data => {
        if (active) setVendors(data.vendors || []);
      })
      .catch(() => {
        if (active) setVendors([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const filteredVendors = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(vendor => [
      vendor.store_name,
      vendor.store_username,
      vendor.locations?.[0]?.address,
      vendor.locations?.[0]?.shipping_city,
      vendor.locations?.[0]?.shipping_country,
    ].some(value => String(value || '').toLowerCase().includes(q)));
  }, [vendors, search]);

  if (!isMounted) return null;

  return (
    <main className="min-h-screen bg-marine-canvas" dir={isAr ? 'rtl' : 'ltr'}>
      <section className="bg-marine-navy text-white pt-16 pb-14">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
            <div>
              <p className="text-marine-primary text-sm font-semibold uppercase tracking-widest mb-2">
                {isAr ? 'التجار' : 'Vendors'}
              </p>
              <h1 className="text-4xl sm:text-5xl font-bold">
                {isAr ? 'التجار المتاحون' : 'Available Vendors'}
              </h1>
            </div>
            <div className="relative w-full lg:w-96">
              <Search size={18} className="absolute start-4 top-1/2 -translate-y-1/2 text-marine-outline" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={isAr ? 'ابحث عن تاجر' : 'Search vendors'}
                className="w-full bg-white text-marine-ink rounded-lg ps-11 pe-4 py-4 text-sm font-bold outline-none focus:ring-2 focus:ring-marine-cyan"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 py-12">
        {loading ? (
          <div className="min-h-[260px] flex items-center justify-center">
            <Loader2 size={32} className="animate-spin text-marine-primary" />
          </div>
        ) : filteredVendors.length === 0 ? (
          <div className="min-h-[260px] flex flex-col items-center justify-center text-center bg-white border border-marine-teal/15 rounded-lg">
            <Store size={44} className="text-marine-line mb-3" />
            <p className="font-bold text-marine-ink">{isAr ? 'لا يوجد تجار متاحون' : 'No vendors available'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredVendors.map(vendor => (
              <VendorCard key={vendor._id} vendor={vendor} isAr={isAr} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
