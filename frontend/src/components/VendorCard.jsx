'use client';

import { storePath as storePathFor, storeKey } from '../lib/storeLink';
import Link from './LocaleLink';
import { CheckCircle2, MapPin, Package, Store } from 'lucide-react';
import { resolveAssetUrl } from '../lib/assets';
import VendorTrustStats from './reviews/VendorTrustStats';
import { useAdImpression, trackAdClick } from '../lib/adTracking';

export default function VendorCard({ vendor, isAr = false, compact = false }) {
  // A featured card is an ad: report that it was seen and followed.
  const adId = vendor?.ad_id || '';
  const adPlacement = vendor?.ad_placement || 'vendors';
  const adRef = useAdImpression(adId, { placement: adPlacement });
  const storePath = storePathFor(storeKey(vendor));
  const reportAdClick = () => { if (adId) trackAdClick(adId, { placement: adPlacement, target: storePath, subjects: [vendor?.store_username, storePath] }); };
  const defaultLocation = vendor?.locations?.find(loc => loc.is_default) || vendor?.locations?.[0] || null;
  const location = defaultLocation
    ? [defaultLocation.shipping_city, defaultLocation.shipping_country].filter(Boolean).join(', ') || defaultLocation.address
    : '';
  const imageUrl = resolveAssetUrl(vendor?.store_image);

  return (
    <Link
      ref={adRef}
      href={storePath}
      onClick={reportAdClick}
      className={`group block bg-white border border-marine-teal/15 rounded-lg overflow-hidden shadow-sm hover:shadow-[0_14px_40px_rgba(0,0,0,0.08)] hover:border-marine-cyan/40 hover:-translate-y-1 transition-all duration-300 ${compact ? 'w-[230px] sm:w-64 flex-none h-full' : ''}`}
    >
      <div className="relative aspect-[16/9] bg-marine-mist overflow-hidden flex items-center justify-center">
        {vendor.sponsored && (
          <div className="absolute top-2 end-2 z-10 bg-amber-400/95 text-marine-ink text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg shadow-sm">
            {isAr ? 'مميّز' : 'Featured'}
          </div>
        )}
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={vendor.store_name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <Store size={44} className="text-marine-primary" />
        )}
      </div>
      <div className={compact ? 'p-4 sm:p-5 space-y-3 sm:space-y-4' : 'p-5 space-y-4'}>
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className={`${compact ? 'text-base sm:text-lg' : 'text-lg'} font-bold text-marine-ink leading-tight group-hover:text-marine-primary transition-colors`}>
              {vendor.store_name}
            </h3>
            <CheckCircle2 size={18} className="text-emerald-500 shrink-0 mt-0.5" />
          </div>
          <p className="text-xs font-bold text-marine-outline">@{vendor.store_username}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-marine-outline">
          <span className="inline-flex items-center gap-1.5">
            <Package size={14} className="text-marine-primary" />
            {(vendor.product_count || 0).toLocaleString(isAr ? 'ar-u-nu-latn' : 'en-US')} {isAr ? 'منتج' : 'products'}
          </span>
          {location && (
            <span className="inline-flex items-center gap-1.5 min-w-0">
              <MapPin size={14} className="text-marine-primary shrink-0" />
              <span className="truncate">{location}</span>
            </span>
          )}
        </div>

        <VendorTrustStats
          completedOrders={vendor.completed_orders_count}
          rating={vendor.rating}
          reviewsCount={vendor.reviews_count}
          isAr={isAr}
          size="sm"
          className="pt-1 border-t border-marine-teal/15"
        />
      </div>
    </Link>
  );
}
