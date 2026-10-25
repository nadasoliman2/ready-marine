'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { vendorApi } from '../../../../../lib/api';
import BundleBuilder from '../../../../../components/dashboard/BundleBuilder';

export default function EditBundlePage() {
  const { id } = useParams();
  const [initial, setInitial] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await vendorApi.getBundle(id);
        const b = res.bundle;
        setInitial({
          title_en: b.title_en || '', title_ar: b.title_ar || '',
          subtitle_en: b.subtitle_en || '', subtitle_ar: b.subtitle_ar || '',
          description_en: b.description_en || '', description_ar: b.description_ar || '',
          images: b.images || [],
          members: (b.members || []).map(m => ({
            product_id: m.product_id?._id || m.product_id || '',
            variant_id: m.variant_id || '',
            quantity: m.quantity || 1,
          })),
          pricing_mode: b.pricing_mode || 'fixed',
          pricing_value: b.pricing_value ?? '',
        });
      } catch (_) {
        setInitial(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-marine-primary" size={32} /></div>;
  if (!initial) return <div className="text-center py-20 text-zinc-500 font-bold">Bundle not found.</div>;

  return <BundleBuilder bundleId={id} initial={initial} />;
}
