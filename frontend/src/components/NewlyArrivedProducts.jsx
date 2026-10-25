'use client';

import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import Link from './LocaleLink';
import { useApp } from '../context/AppContext';
import ProductCard from './ProductCard';
import ProductRail from './products/ProductRail';

export default function NewlyArrivedProducts() {
  const { language, t } = useApp();
  const isAr = language === 'ar';
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/products/landing/new-arrivals?limit=8`);
        const data = await res.json();
        setProducts(data.products || []);
      } catch (error) {
        console.error('Fetch error:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchProducts();
  }, []);

  if (loading || products.length === 0) return null;

  return (
    <section className="py-10 sm:py-16 bg-marine-canvas">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-end justify-between gap-4 mb-6 sm:mb-10">
          <div>
            <div className="flex items-center gap-2 text-marine-primary text-sm font-semibold uppercase tracking-widest mb-1">
              <Clock3 size={14} />
              <span>{isAr ? 'وصل حديثاً' : 'Fresh Arrivals'}</span>
            </div>
            <h2 className="text-2xl sm:text-4xl font-bold text-marine-ink">
              {isAr ? 'وصل حديثاً' : 'Newly Arrived'}
            </h2>
          </div>
          <Link
            href="/products?sort=newest"
            className="shrink-0 whitespace-nowrap flex items-center gap-1.5 text-marine-primary hover:text-red-600 font-semibold text-sm transition-colors group"
          >
            {t.viewAll}
            <span className="group-hover:translate-x-0.5 transition-transform rtl:-translate-x-0.5">→</span>
          </Link>
        </div>

        <ProductRail gridClassName="sm:grid-cols-3 lg:grid-cols-4 sm:gap-5">
          {products.map(product => (
            <ProductCard key={product._id} product={product} />
          ))}
        </ProductRail>
      </div>
    </section>
  );
}
