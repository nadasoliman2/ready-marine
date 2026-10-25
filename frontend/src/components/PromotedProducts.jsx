'use client';

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { adsApi } from '../lib/api';
import ProductCard from './ProductCard';
import ProductRail from './products/ProductRail';

export default function PromotedProducts() {
  const { language } = useApp();
  const isAr = language === 'ar';
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await adsApi.getPromotedProducts(8);
        if (!cancelled) setProducts(data.products || []);
      } catch {
        if (!cancelled) setProducts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading || products.length === 0) return null;

  return (
    <section className="py-10 sm:py-16 bg-marine-canvas" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-end justify-between gap-4 mb-6 sm:mb-10">
          <div>
            <div className="flex items-center gap-2 text-amber-500 text-sm font-semibold uppercase tracking-widest mb-1">
              <Sparkles size={14} />
              <span>{isAr ? 'مموّل' : 'Sponsored'}</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-marine-ink">
              {isAr ? 'منتجات مموّلة' : 'Promoted Products'}
            </h2>
          </div>
        </div>

        <ProductRail gridClassName="sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 sm:gap-6">
          {products.map((product) => (
            <ProductCard key={product._id} product={product} />
          ))}
        </ProductRail>
      </div>
    </section>
  );
}
