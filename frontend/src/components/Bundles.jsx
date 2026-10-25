'use client';

import { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import Link from './LocaleLink';
import { useApp } from '../context/AppContext';
import { bundlesApi } from '../lib/api';
import BundleCard from './BundleCard';

export default function Bundles() {
  const { language, t } = useApp();
  const isAr = language === 'ar';
  const [bundles, setBundles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await bundlesApi.getLanding(8);
        setBundles(data.bundles || []);
      } catch (error) {
        console.error('Fetch bundles error:', error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Hide the section entirely when there are no live bundles.
  if (loading || bundles.length === 0) return null;

  return (
    <section className="py-16 bg-white">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-end justify-between mb-10">
          <div>
            <div className="flex items-center gap-2 text-violet-600 text-sm font-semibold uppercase tracking-widest mb-1">
              <Package size={14} />
              <span>{isAr ? 'وفّر أكثر' : 'Save More'}</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-marine-ink">
              {isAr ? 'باقات العروض' : 'Bundle Offers'}
            </h2>
          </div>
          <Link
            href="/bundles"
            className="flex items-center gap-1.5 text-violet-600 hover:text-violet-500 font-semibold text-sm transition-colors"
          >
            {t?.viewAll || (isAr ? 'عرض الكل' : 'View all')} →
          </Link>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
          {bundles.map(bundle => (
            <BundleCard key={bundle._id} bundle={bundle} />
          ))}
        </div>
      </div>
    </section>
  );
}
