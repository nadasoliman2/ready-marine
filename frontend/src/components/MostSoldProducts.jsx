'use client';

import { useEffect, useState } from 'react';
import Link from './LocaleLink';
import { useApp } from '../context/AppContext';
import ProductCard from './ProductCard';
import ProductRail from './products/ProductRail';
import { SECTION_EYEBROW, SECTION_TITLE } from './marine/HomeSections';

export default function MostSoldProducts() {
  const { language } = useApp();
  const isAr = language === 'ar';
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/products/landing/most-sold?limit=8`);
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

  if (loading) return null;

  return (
    <section className="py-10 sm:py-16 bg-white border-y border-marine-teal/10">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6 sm:mb-8">
          <div>
            <p className={SECTION_EYEBROW}>{isAr ? 'قطع سريعة الدوران' : 'High Turnaround Spares'}</p>
            <h2 className={SECTION_TITLE}>{isAr ? 'الأكثر مبيعاً والعروض' : 'Most Sold Products & Hot Deals'}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { label: isAr ? 'كل المميز' : 'All Highlights', href: '/products?sort=sold', active: true },
              { label: isAr ? 'أوتبورد' : 'Marine Outboard', href: '/products?search=outboard' },
              { label: isAr ? 'الإشعال' : 'Ignition', href: '/products?search=ignition' },
              { label: isAr ? 'الزيوت' : 'Lubricants', href: '/products?search=oil' },
            ].map((tab) => (
              <Link
                key={tab.label}
                href={tab.href}
                className={`font-display text-[10px] font-bold uppercase tracking-[0.08em] px-3 py-2 rounded-sm border transition-colors ${tab.active ? 'bg-marine-cyan border-marine-cyan text-white' : 'bg-white border-marine-teal/20 text-marine-muted hover:border-marine-cyan hover:text-marine-primary'}`}
              >
                {tab.label}
              </Link>
            ))}
          </div>
        </div>

        <ProductRail gridClassName="sm:grid-cols-3 lg:grid-cols-4 sm:gap-5">
          {products.map(product => (
            <ProductCard key={product._id} product={product} showBadge="hot" />
          ))}
        </ProductRail>
      </div>
    </section>
  );
}
