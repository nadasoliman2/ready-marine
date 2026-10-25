'use client';

import Link from './LocaleLink';
import { Package, ShoppingCart } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { thumbUrl } from '../lib/assets';

export default function BundleCard({ bundle }) {
  const { addBundleToCart, setIsCartOpen, language, siteSettings, user } = useApp();
  const isAr = language === 'ar';
  const currency = siteSettings?.currency || 'QAR';

  const slug = isAr ? (bundle.slug_ar || bundle.slug_en) : (bundle.slug_en || bundle.slug_ar);
  const title = isAr ? (bundle.title_ar || bundle.title_en) : (bundle.title_en || bundle.title_ar);
  const primary = (bundle.images || []).find(i => i.is_primary);
  const image = primary?.url || bundle.images?.[0]?.url || '';
  const effective = bundle.pricing?.effective ?? 0;
  const combined = bundle.pricing?.combined ?? 0;
  const savings = bundle.pricing?.savings ?? 0;
  const memberCount = bundle.member_count ?? (bundle.members?.length || 0);
  const isStaff = user?.role === 'vendor' || user?.role === 'admin';
  const disabled = isStaff || bundle.is_purchasable === false;

  const handleAdd = () => {
    if (disabled) return;
    if (addBundleToCart(bundle)) setIsCartOpen(true);
  };

  return (
    <div className="group bg-white rounded-lg border border-marine-teal/15 overflow-hidden hover:shadow-xl transition-all flex flex-col">
      <Link href={`/bundle/${slug}`} className="relative block aspect-square bg-marine-canvas overflow-hidden">
        {image ? (
          <img src={thumbUrl(image, 480)} alt={title} loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-marine-line"><Package size={48} /></div>
        )}
        <span className="absolute top-2 start-2 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-violet-600 text-white">
          <Package size={11} /> {isAr ? `باقة · ${memberCount}` : `Bundle · ${memberCount}`}
        </span>
        {savings > 0 && (
          <span className="absolute top-2 end-2 px-2 py-1 rounded-lg text-[10px] font-bold bg-marine-cyan text-white">
            {isAr ? `وفّر ${currency} ${savings.toFixed(2)}` : `Save ${currency} ${savings.toFixed(2)}`}
          </span>
        )}
      </Link>

      <div className="p-3 flex flex-col flex-1">
        <Link href={`/bundle/${slug}`} className="font-bold text-marine-ink text-sm line-clamp-2 hover:text-marine-primary transition-colors">
          {title}
        </Link>

        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-marine-primary font-bold text-lg">{currency} {effective.toFixed(2)}</span>
          {combined > effective && (
            <span className="text-marine-outline text-sm line-through">{currency} {combined.toFixed(2)}</span>
          )}
        </div>

        <button
          onClick={handleAdd}
          disabled={disabled}
          className="mt-3 w-full inline-flex items-center justify-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-xl text-sm transition-colors"
        >
          <ShoppingCart size={16} />
          {bundle.is_purchasable === false
            ? (isAr ? 'غير متاح' : 'Unavailable')
            : (isAr ? 'أضف الباقة' : 'Add bundle')}
        </button>
      </div>
    </div>
  );
}
