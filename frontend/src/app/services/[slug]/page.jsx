'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from '../../../components/LocaleLink';
import { useRouter } from '../../../lib/navigation';
import { MapPin, Phone, MessageCircle, ExternalLink, ArrowLeft, Loader2, Image as ImageIcon } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { servicesApi } from '../../../lib/api';
import { getLocalizedServiceLocations } from '../../../lib/serviceLocations';
import { serviceWhatsappUrl } from '../../../lib/serviceWhatsapp';
import { trackAdAction } from '../../../lib/adTracking';

export default function ServiceDetailsPage({ params }) {
  const router = useRouter();
  const { language, siteSettings } = useApp();
  const isAr = language === 'ar';

  const [service, setService] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeImage, setActiveImage] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const data = await servicesApi.getServiceBySlug(params.slug);
        setService(data);
        const first = data?.images?.find(img => img.is_primary)?.url || data?.images?.[0]?.url || '';
        setActiveImage(first);
      } catch (err) {
        setError(err.message || 'Service not found');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [params.slug]);

  const title = useMemo(() => {
    if (!service) return '';
    return isAr ? (service.title_ar || service.title_en) : (service.title_en || service.title_ar);
  }, [service, isAr]);

  const description = useMemo(() => {
    if (!service) return '';
    return isAr ? (service.description_ar || service.description_en) : (service.description_en || service.description_ar);
  }, [service, isAr]);

  const vendorName = useMemo(() => {
    if (!service) return '';
    return isAr ? (service.vendor_name_ar || service.vendor_name_en) : (service.vendor_name_en || service.vendor_name_ar);
  }, [service, isAr]);

  const locations = useMemo(() => {
    if (!service) return [];
    return getLocalizedServiceLocations(service, language);
  }, [service, language]);

  const price = Number(service?.price);
  const showPrice = Number.isFinite(price) && price > 0;

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-marine-primary" />
      </div>
    );
  }

  if (error || !service) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="bg-red-500/10 border border-red-500/20 text-red-600 p-4 rounded-xl text-sm font-bold">
          {error || (isAr ? 'الخدمة غير موجودة' : 'Service not found')}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white min-h-screen" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-2 text-sm font-bold text-marine-outline hover:text-marine-primary"
        >
          <ArrowLeft size={16} className={isAr ? 'rotate-180' : ''} />
          {isAr ? 'رجوع' : 'Back'}
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-8">
          <div className="space-y-4">
            <div className="rounded-xl overflow-hidden border border-marine-teal/15 bg-marine-mist aspect-[16/10]">
              {activeImage ? (
                <img src={activeImage} alt={title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-marine-outline"><ImageIcon size={40} /></div>
              )}
            </div>

            {!!service.images?.length && (
              <div className="grid grid-cols-5 gap-2">
                {service.images.map((img, idx) => (
                  <button
                    key={idx}
                    onClick={() => setActiveImage(img.url)}
                    className={`rounded-xl overflow-hidden border ${activeImage === img.url ? 'border-marine-cyan' : 'border-marine-teal/15'}`}
                  >
                    <img src={img.url} alt={`${title}-${idx}`} className="w-full h-16 object-cover" />
                  </button>
                ))}
              </div>
            )}

            <div className="bg-marine-canvas rounded-xl border border-marine-teal/15 p-6">
              <h1 className="text-3xl font-bold text-marine-ink">{title}</h1>
              {showPrice && (
                <p className="text-xl font-bold text-marine-primary mt-2">{siteSettings?.currency || 'QAR'} {price.toFixed(2)}</p>
              )}
              <p className="text-marine-muted mt-3 leading-7 whitespace-pre-line">{description}</p>
            </div>
          </div>

          <aside className="space-y-4">
            <div className="bg-marine-navy text-white rounded-xl p-6 space-y-4 shadow-xl">
              <h2 className="text-xl font-bold">{vendorName || (isAr ? 'مزود الخدمة' : 'Service Provider')}</h2>
              <div className="space-y-2">
                {locations.length ? locations.map((location, idx) => (
                  location.link ? (
                    <a
                      key={idx}
                      href={location.link}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between gap-2 text-sm text-white/80 hover:text-white"
                    >
                      <span className="inline-flex items-center gap-2"><MapPin size={15} className="text-marine-primary" /> {location.name}</span>
                      <ExternalLink size={13} />
                    </a>
                  ) : (
                    <p key={idx} className="flex items-center gap-2 text-sm text-white/80">
                      <MapPin size={15} className="text-marine-primary" /> {location.name}
                    </p>
                  )
                )) : (
                  <p className="flex items-center gap-2 text-sm text-white/80"><MapPin size={15} className="text-marine-primary" /> -</p>
                )}
              </div>

              <div className="space-y-2 pt-2">
                {(service.phones || []).map((phone, idx) => (
                  <a
                    key={idx}
                    href={`tel:${phone}`}
                    onClick={() => trackAdAction('call', [service?._id, `/services/${params?.slug}`])}
                    className="w-full inline-flex items-center justify-between gap-2 px-4 py-3 rounded-xl bg-white/10 hover:bg-white/15 transition-colors text-sm font-bold"
                  >
                    <span className="inline-flex items-center gap-2"><Phone size={15} /> {isAr ? 'اتصال' : 'Call'}</span>
                    <span dir="ltr">{phone}</span>
                  </a>
                ))}

                {(service.whatsapp_numbers || []).map((wa, idx) => (
                  <a
                    key={idx}
                    href={serviceWhatsappUrl(wa, service, language)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => trackAdAction('whatsapp', [service?._id, `/services/${params?.slug}`])}
                    className="w-full inline-flex items-center justify-between gap-2 px-4 py-3 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 transition-colors text-sm font-bold text-emerald-200"
                  >
                    <span className="inline-flex items-center gap-2"><MessageCircle size={15} /> WhatsApp</span>
                    <span dir="ltr">{wa}</span>
                  </a>
                ))}
              </div>
            </div>

            {!!service.social_links?.length && (
              <div className="bg-white rounded-xl border border-marine-teal/15 p-5">
                <h3 className="text-sm font-bold text-marine-outline uppercase tracking-wider mb-3">
                  {isAr ? 'روابط التواصل' : 'Social Links'}
                </h3>
                <div className="space-y-2">
                  {service.social_links.map((link, idx) => (
                    <a
                      key={idx}
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="w-full inline-flex items-center justify-between gap-2 px-4 py-3 rounded-xl bg-marine-canvas hover:bg-marine-cyan/10 text-sm font-semibold text-marine-muted"
                    >
                      <span>{link.platform}</span>
                      <ExternalLink size={14} />
                    </a>
                  ))}
                </div>
              </div>
            )}

            <Link
              href="/services"
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-marine-teal/15 text-marine-muted hover:border-marine-cyan hover:text-marine-primary font-bold text-sm"
            >
              {isAr ? 'كل الخدمات' : 'All Services'}
            </Link>
          </aside>
        </div>
      </div>
    </div>
  );
}
