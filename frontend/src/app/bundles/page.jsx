'use client';

import { useEffect, useState } from 'react';
import { Package, Loader2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { bundlesApi } from '../../lib/api';
import BundleCard from '../../components/BundleCard';

export default function BundlesPage() {
  const { language } = useApp();
  const isAr = language === 'ar';
  const [bundles, setBundles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await bundlesApi.getLanding(24);
        setBundles(data.bundles || []);
      } catch (_) {
        setBundles([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-zinc-50 py-12 px-4" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Package className="text-violet-600" size={28} />
          <h1 className="text-3xl font-black text-[#09090b]">{isAr ? 'باقات العروض' : 'Bundle Offers'}</h1>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin text-violet-600" size={32} /></div>
        ) : bundles.length === 0 ? (
          <div className="bg-white rounded-3xl p-16 text-center border border-dashed border-zinc-200">
            <Package size={48} className="text-zinc-300 mx-auto mb-4" />
            <p className="text-zinc-500 font-bold">{isAr ? 'لا توجد باقات متاحة حالياً.' : 'No bundles available right now.'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
            {bundles.map(bundle => (
              <BundleCard key={bundle._id} bundle={bundle} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
