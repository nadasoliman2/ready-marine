'use client';

import { useEffect, useState } from 'react';
import { Tag } from 'lucide-react';
import Link from './LocaleLink';
import { useApp } from '../context/AppContext';
import ProductCard from './ProductCard';
import ProductRail from './products/ProductRail';

export default function SpecialOffers() {
  const { language, t } = useApp();
  const isAr = language === 'ar';
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOffers = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/products/landing/special-offers?limit=8`);
        const data = await res.json();
        setProducts(data.products || []);
      } catch (error) {
        console.error('Fetch error:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchOffers();
  }, []);

  if (loading || products.length === 0) return null;

  return (
    <section className="py-10 sm:py-16 bg-white border-y from-[#09090b] via-zinc-900 to-[#09090b] relative overflow-hidden">
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-0 start-0 w-96 h-96 bg-marine-cyan rounded-full -translate-x-1/2 -translate-y-1/2 blur-3xl" />
        <div className="absolute bottom-0 end-0 w-96 h-96 bg-marine-cyan rounded-full translate-x-1/2 translate-y-1/2 blur-3xl" />
      </div>

      <div className="max-w-7xl mx-auto px-4 relative z-10">
        <div className="flex items-end justify-between gap-4 mb-6 sm:mb-10">
          <div>
            <div className="flex items-center gap-2 text-marine-primary text-sm font-semibold uppercase tracking-widest mb-1">
              <Tag size={14} />
              <span>{isAr ? 'أعلى الخصومات' : 'Top Discounts'}</span>
            </div>
            <h2 className="font-display text-2xl sm:text-[32px] sm:leading-10 font-semibold tracking-tight text-marine-ink">{t.specialOffers}</h2>
          </div>
          <Link
            href="/products?filter=offers"
            className="shrink-0 whitespace-nowrap flex items-center gap-1.5 text-marine-primary hover:text-red-400 font-semibold text-sm transition-colors"
          >
            {t.viewAll} →
          </Link>
        </div>

        <ProductRail gridClassName="sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 sm:gap-5">
          {products.map(product => (
            <ProductCard key={product._id} product={product} showBadge="offer" />
          ))}
        </ProductRail>
      </div>
    </section>
  );
}
