'use client';

import { useState, useEffect } from 'react';
import Link from '../../components/LocaleLink';
import { useApp } from '../../context/AppContext';
import { resolveAssetUrl } from '../../lib/assets';
import { Car, Loader2, Search } from 'lucide-react';

export default function BrandsPage() {
  const { language, t } = useApp();
  const isAr = language === 'ar';
  
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const fetchBrands = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/products/filters`);
        if (res.ok) {
          const data = await res.json();
          // Sort brands alphabetically
          const sorted = (data.carBrands || []).sort((a, b) => a.name.localeCompare(b.name));
          setBrands(sorted);
        }
      } catch (err) {
        console.error('Failed to fetch brands:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchBrands();
  }, []);

  const filteredBrands = brands.filter(brand => 
    brand.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-marine-canvas pt-6 pb-12 sm:pt-20 md:pt-32 md:pb-24">
      <div className="max-w-7xl mx-auto px-4">
        <div className="mb-5 sm:mb-12 text-center max-w-2xl mx-auto">
          <h1 className="text-2xl sm:text-5xl font-bold text-marine-ink mb-2 sm:mb-4">
            {isAr ? 'كل ماركات السيارات' : 'All Car Brands'}
          </h1>
          <p className="text-marine-outline text-sm sm:text-lg">
            {isAr ? 'تصفح منتجاتنا حسب ماركة سيارتك المفضلة' : 'Browse our products by your favorite car brand'}
          </p>
        </div>

        <div className="mb-6 sm:mb-10 max-w-md mx-auto relative">
          <Search size={20} className="absolute start-4 top-1/2 -translate-y-1/2 text-marine-outline" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isAr ? 'ابحث عن ماركة...' : 'Search for a brand...'}
            className="w-full bg-white border border-marine-teal/15 rounded-lg py-3 sm:py-4 ps-12 pe-4 focus:outline-none focus:border-marine-cyan focus:ring-1 focus:ring-marine-cyan transition-all shadow-sm"
          />
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-marine-outline">
            <Loader2 size={40} className="animate-spin mb-4 text-marine-primary" />
            <p>{isAr ? 'جاري تحميل الماركات...' : 'Loading brands...'}</p>
          </div>
        ) : filteredBrands.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-marine-outline bg-white rounded-xl border border-marine-teal/15 shadow-sm">
            <Car size={48} className="mb-4 opacity-50" />
            <p className="text-lg font-bold text-marine-muted">{isAr ? 'لم يتم العثور على ماركات' : 'No brands found'}</p>
            <p className="text-sm mt-1">{isAr ? 'حاول استخدام كلمات بحث مختلفة' : 'Try adjusting your search terms'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
            {filteredBrands.map(brand => (
              <Link
                key={brand._id}
                href={`/products?car_brand_id=${brand._id}`}
                className="group bg-white rounded-xl border border-marine-teal/15 hover:border-marine-cyan/40 shadow-sm hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] hover:-translate-y-1 transition-all duration-300 overflow-hidden p-5 flex flex-col items-center gap-4"
              >
                <div className="w-full aspect-[4/3] rounded-lg overflow-hidden bg-marine-canvas flex items-center justify-center relative">
                  {brand.image ? (
                    <img
                      src={resolveAssetUrl(brand.image)}
                      alt={brand.name}
                      className="w-full h-full object-contain p-4 group-hover:scale-110 transition-transform duration-500"
                    />
                  ) : (
                    <span className="text-marine-line font-bold text-2xl uppercase tracking-wider">
                      {brand.name.substring(0, 3)}
                    </span>
                  )}
                </div>
                <div className="text-center w-full">
                  <span className="text-marine-ink font-bold text-base block truncate group-hover:text-marine-primary transition-colors">
                    {brand.name}
                  </span>
                  <span className="text-xs text-marine-outline font-semibold mt-1">
                    {brand.model_count ?? brand.models?.length ?? 0} {isAr ? 'موديل' : 'models'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
