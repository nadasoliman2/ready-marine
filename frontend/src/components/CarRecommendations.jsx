'use client';

import { useEffect, useState } from 'react';
import { CarFront } from 'lucide-react';
import Link from './LocaleLink';
import { useApp } from '../context/AppContext';
import { userApi } from '../lib/api';
import ProductCard from './ProductCard';
import ProductRail from './products/ProductRail';

/**
 * The home page's "for your car" row: Ready Marine's recommendations for a signed-in customer
 * with cars in their garage — parts made for those cars and products for any car, 60/40,
 * nothing they bought in the last month (Backend services/carFitService.js). Nothing at all
 * for a visitor, a customer without a car, or when there is nothing to recommend.
 */
export default function CarRecommendations() {
  const { language, user } = useApp();
  const isAr = language === 'ar';
  const isCustomer = user?.role === 'user';
  const [data, setData] = useState({ products: [], cars: [] });

  useEffect(() => {
    if (!isCustomer) { setData({ products: [], cars: [] }); return undefined; }
    let alive = true;
    userApi.getRecommendations(8)
      .then((res) => { if (alive) setData({ products: res?.products || [], cars: res?.cars || [] }); })
      .catch(() => { if (alive) setData({ products: [], cars: [] }); });
    return () => { alive = false; };
  }, [isCustomer, user?._id]);

  if (!isCustomer || !data.products.length) return null;

  return (
    <section className="py-10 sm:py-16 bg-white">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-end justify-between gap-4 mb-6 sm:mb-10">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-marine-primary text-sm font-semibold uppercase tracking-widest mb-1">
              <CarFront size={14} />
              <span>{isAr ? 'ترشيحات ريدي مارين' : 'Ready Marine picks'}</span>
            </div>
            <h2 className="text-2xl sm:text-4xl font-bold text-marine-ink">{isAr ? 'مختارة لعربيتك' : 'Picked for your car'}</h2>
            {data.cars.length > 0 && (
              <p className="mt-2 text-sm font-medium text-marine-outline truncate">{data.cars.join(isAr ? '، ' : ', ')}</p>
            )}
          </div>
          <Link
            href="/products"
            className="shrink-0 whitespace-nowrap flex items-center gap-1.5 text-marine-primary hover:text-red-600 font-semibold text-sm transition-colors group"
          >
            {isAr ? 'عرض الكل' : 'View all'}
            <span className="group-hover:translate-x-0.5 transition-transform rtl:-translate-x-0.5">→</span>
          </Link>
        </div>

        <ProductRail gridClassName="sm:grid-cols-3 lg:grid-cols-4 sm:gap-5">
          {data.products.map(product => (
            <ProductCard key={product._id} product={product} />
          ))}
        </ProductRail>
      </div>
    </section>
  );
}
