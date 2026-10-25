'use client';

import Link from '../LocaleLink';
import { MapPin, Phone, MessageCircle, ExternalLink } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { pickServiceLocation } from '../../lib/serviceLocations';
import { serviceWhatsappUrl } from '../../lib/serviceWhatsapp';
import { thumbUrl } from '../../lib/assets';

export default function ServiceCard({ service, compact = false }) {
  const { language, t, siteSettings } = useApp();
  const isAr = language === 'ar';

  const title = isAr ? (service.title_ar || service.title_en) : (service.title_en || service.title_ar);
  const description = isAr ? (service.description_ar || service.description_en) : (service.description_en || service.description_ar);
  const vendorName = isAr ? (service.vendor_name_ar || service.vendor_name_en) : (service.vendor_name_en || service.vendor_name_ar);
  const vendorLocation = pickServiceLocation(service, language);
  const slug = isAr ? (service.slug_ar || service.slug_en) : (service.slug_en || service.slug_ar);

  const primaryImage = service.images?.find(img => img.is_primary)?.url || service.images?.[0]?.url;
  const phone = service.phones?.[0] || '';
  const whatsapp = service.whatsapp_numbers?.[0] || '';
  const price = Number(service.price);
  const showPrice = Number.isFinite(price) && price > 0;

  return (
    <div className="group bg-white rounded-xl border border-marine-teal/15 shadow-sm hover:shadow-[0_16px_40px_rgba(0,0,0,0.08)] hover:-translate-y-1 transition-all duration-300 overflow-hidden">
      <Link href={`/services/${slug}`} className="block">
        <div className="relative aspect-[4/3] overflow-hidden bg-marine-mist">
          {primaryImage ? (
            <img src={thumbUrl(primaryImage, 480)} alt={title} loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-marine-outline">No Image</div>
          )}
          <div className="absolute top-3 start-3 px-2.5 py-1 rounded-full bg-black/60 text-white text-[10px] font-bold uppercase tracking-widest">
            {vendorName || 'Vendor'}
          </div>
        </div>
      </Link>

      <div className="p-5 space-y-3">
        <div>
          <h3 className="text-lg font-bold text-marine-ink line-clamp-1">{title}</h3>
          <p
            className="mt-1 break-words text-sm text-marine-outline"
            style={{
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: compact ? 2 : 3,
              overflow: 'hidden',
            }}
          >
            {description}
          </p>
          {showPrice && (
            <p className="text-sm font-bold text-marine-primary mt-2">
              {siteSettings?.currency || 'QAR'} {price.toFixed(2)}
            </p>
          )}
        </div>

        <div className="space-y-1 text-xs text-marine-outline">
          {vendorLocation?.link ? (
            <a
              href={vendorLocation.link}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 hover:text-marine-primary"
            >
              <MapPin size={13} className="text-marine-primary" /> {vendorLocation.name} <ExternalLink size={11} />
            </a>
          ) : (
            <p className="flex items-center gap-1.5"><MapPin size={13} className="text-marine-primary" /> {vendorLocation?.name || '-'}</p>
          )}
          {!!phone && <p className="flex items-center gap-1.5"><Phone size={13} className="text-marine-primary" /> <span dir="ltr">{phone}</span></p>}
        </div>

        <div className="flex items-center gap-2 pt-1">
          {!!whatsapp && (
            <a
              href={serviceWhatsappUrl(whatsapp, service, language)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 text-xs font-bold"
            >
              <MessageCircle size={13} /> {t.whatsappChat || 'WhatsApp Chat'}
            </a>
          )}

          <Link
            href={`/services/${slug}`}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-marine-cyan/10 hover:bg-marine-cyan/20 text-marine-primary text-xs font-bold"
          >
            {t.viewServiceDetails || (isAr ? 'عرض التفاصيل' : 'View Details')} <ExternalLink size={12} />
          </Link>
        </div>
      </div>
    </div>
  );
}
