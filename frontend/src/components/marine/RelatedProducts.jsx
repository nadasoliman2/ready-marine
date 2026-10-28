'use client';

import { useEffect, useState } from 'react';
import ProductCard from '../ProductCard';
import { SECTION_EYEBROW, SECTION_TITLE } from './HomeSections';

/** Four other products from the same category — the product page's "compatible gear" row. */
export default function RelatedProducts({ categoryId, excludeId, isAr }) {
  const [products, setProducts] = useState([]);

  useEffect(() => {
    if (!categoryId) return undefined;
    let active = true;
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/products?category_id=${categoryId}&limit=8`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        setProducts((data.products || []).filter((p) => p._id !== excludeId).slice(0, 4));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [categoryId, excludeId]);

  if (!products.length) return null;

  return (
    <section className="mt-12 sm:mt-16">
      <p className={SECTION_EYEBROW}>{isAr ? 'منتجات مقترحة لك' : 'Recommended for You'}</p>
      <h2 className={`${SECTION_TITLE} mb-6`}>{isAr ? 'قطع ومستلزمات صيانة متوافقة' : 'Compatible Parts & Maintenance Gear'}</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
        {products.map((p) => <ProductCard key={p._id} product={p} />)}
      </div>
    </section>
  );
}
