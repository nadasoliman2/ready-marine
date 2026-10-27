'use client';

import { Mail, Phone, MapPin, Facebook, Instagram, Twitter, Youtube, Linkedin, MessageCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { usePathname } from '../lib/navigation';
import Link from './LocaleLink';
import BrandMark from './marine/BrandMark';

function TikTokIcon({ size = 16, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 448 512"
      fill="currentColor"
      className={className}
    >
      <path d="M448 209.91a210.06 210.06 0 0 1-122.77-39.25V349.38A162.55 162.55 0 1 1 185 188.31V278.2a74.62 74.62 0 1 0 52.23 71.18V0l88 0a121.18 121.18 0 0 0 1.86 22.17h.03a122.18 122.18 0 0 0 108.11 104.1V209.91z" />
    </svg>
  );
}

export default function Footer() {
  const { language, t, siteSettings } = useApp();
  const pathname = usePathname();
  const footerPhones = siteSettings?.footer_phones || [];
  const footerEmails = siteSettings?.footer_emails || [];
  const footerLocations = (language === 'ar' ? (siteSettings?.locations_ar || []) : (siteSettings?.locations_en || []))
    .filter(loc => loc && loc.trim());

  if (pathname.startsWith('/dashboard')) return null;

  return (
    <footer className="bg-marine-mist text-marine-ink border-t border-marine-teal/10">
      <div className="max-w-7xl mx-auto px-4 pt-16 pb-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 mb-12">
          <div>
            {siteSettings === null ? null : (siteSettings.logo_light_url || siteSettings.logo_url) ? (
              <img
                src={siteSettings.logo_light_url || siteSettings.logo_url}
                alt="Logo"
                className="h-12 w-auto object-contain max-w-[200px] mb-4"
              />
            ) : (
              <div className="mb-4"><BrandMark className="h-14 w-auto object-contain max-w-[240px]" /></div>
            )}
            <p className="text-marine-muted text-sm leading-relaxed mb-5">
              {language === 'ar' ? siteSettings?.footer_text_ar : siteSettings?.footer_text_en}
            </p>
            <div className="flex gap-3">
              {[
                { icon: Facebook, href: siteSettings?.social_links?.facebook, label: 'Facebook' },
                { icon: Instagram, href: siteSettings?.social_links?.instagram, label: 'Instagram' },
                { icon: Twitter, href: siteSettings?.social_links?.twitter, label: 'Twitter' },
                { icon: Youtube, href: siteSettings?.social_links?.youtube, label: 'YouTube' },
                { icon: Linkedin, href: siteSettings?.social_links?.linkedin, label: 'LinkedIn' },
                { icon: MessageCircle, href: siteSettings?.social_links?.whatsapp ? `https://wa.me/${siteSettings.social_links.whatsapp.replace(/\+/g, '')}` : '', label: 'WhatsApp' },
                { icon: TikTokIcon, href: siteSettings?.social_links?.tiktok, label: 'TikTok' },
              ].filter(link => link.href).map(({ icon: Icon, href, label }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="w-9 h-9 rounded bg-white border border-marine-teal/15 flex items-center justify-center text-marine-teal hover:bg-marine-cyan hover:border-marine-cyan hover:text-white transition-all duration-200"
                >
                  <Icon size={16} />
                </a>
              ))}
            </div>
            <div className="flex flex-col gap-2.5 mt-6 pt-6 border-t border-marine-teal/10 max-w-[200px]">
              <span className="text-xs text-marine-outline font-medium">{t.poweredBy || (language === 'ar' ? 'مدعوم بواسطة' : 'Powered by')}</span>
              <a
                href="https://tech-oriented.digital/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Tech Oriented"
                className="inline-flex"
              >
                <img
                  src="/images/tech-oriented.png"
                  alt="Tech Oriented"
                  className="h-12 w-auto object-contain brightness-95"
                />
              </a>
            </div>
          </div>

          <div>
            <h3 className="font-display font-bold text-marine-ink mb-5 text-xs uppercase tracking-[0.08em]">{t.contactInfo}</h3>
            <ul className="space-y-3 text-sm text-marine-muted">
              {footerPhones.map((phone, idx) => (
                <li key={`phone-${idx}`}>
                  <a href={`tel:${phone}`} className="flex items-start gap-3 hover:text-marine-primary transition-colors">
                    <Phone size={15} className="mt-0.5 flex-shrink-0 text-marine-primary" />
                    <span dir="ltr">{phone}</span>
                  </a>
                </li>
              ))}
              {footerEmails.map((email, idx) => (
                <li key={`email-${idx}`}>
                  <a href={`mailto:${email}`} className="flex items-start gap-3 hover:text-marine-primary transition-colors">
                    <Mail size={15} className="mt-0.5 flex-shrink-0 text-marine-primary" />
                    <span>{email}</span>
                  </a>
                </li>
              ))}
            </ul>

            <h3 className="font-display font-bold text-marine-ink mt-6 mb-3 text-xs uppercase tracking-[0.08em]">{t.locations}</h3>
            <ul className="space-y-3 text-sm text-marine-muted">
              {footerLocations.map((loc, idx) => (
                <li key={`loc-${idx}`} className="flex items-start gap-3">
                  <MapPin size={15} className="mt-0.5 flex-shrink-0 text-marine-primary" />
                  <span>{loc}</span>
                </li>
              ))}
            </ul>
          </div>



          <div>
            <h3 className="font-display font-bold text-marine-ink mb-5 text-xs uppercase tracking-[0.08em]">{t.quickLinks}</h3>
            <ul className="space-y-2.5 text-sm text-marine-muted">
              {[
                { label: t.home, href: '/' },
                { label: t.allProducts, href: '/products' },
                { label: t.services || (language === 'ar' ? 'الخدمات' : 'Services'), href: '/services' },
                { label: t.categories, href: '/products' },
                { label: t.deliveryReturn, href: '/delivery' },
                { label: t.contactUs, href: '/contact' },
                { label: t.privacyPolicy || (language === 'ar' ? 'سياسة الخصوصية' : 'Privacy Policy'), href: '/privacy' },
                { label: t.termsConditions || (language === 'ar' ? 'الشروط والأحكام' : 'Terms & Conditions'), href: '/terms' },
                { label: t.shippingPolicy || (language === 'ar' ? 'سياسة الشحن' : 'Shipping Policy'), href: '/shipping' },
              ].map(link => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="hover:text-marine-primary transition-colors flex items-center gap-1.5 group"
                  >
                    <span className="w-1 h-1 rounded-full bg-marine-cyan opacity-0 group-hover:opacity-100 transition-opacity" />
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
                  {/* <div>
            <h3 className="font-display font-bold text-marine-ink mb-5 text-xs uppercase tracking-[0.08em]">{language === 'ar' ? 'الدفع واللوجستيات' : 'Payment & Logistics'}</h3>
            <p className="text-sm text-marine-muted mb-4">
              {language === 'ar' ? 'دفع آمن وفوري في كل مصر عبر بوابات موثوقة.' : 'Secured instant settlements across Egypt and regional waters via trusted gateways.'}
            </p>
            <div className="flex flex-wrap gap-2 mb-6">
              {['PAYMOB', 'FAWATERAK', 'BOSTA COURIER'].map((name) => (
                <span key={name} className="font-display text-[10px] font-bold tracking-[0.06em] text-marine-teal bg-white border border-marine-teal/15 px-2 py-1 rounded-sm">{name}</span>
              ))}
            </div>
            <h3 className="font-display font-bold text-marine-ink mb-2 text-xs uppercase tracking-[0.08em]">{language === 'ar' ? 'مراكز التوزيع' : 'Hub Locations'}</h3>
            <p className="text-sm text-marine-muted">
              {language === 'ar' ? 'القاهرة • ميناء الإسكندرية • المنطقة الحرة ببورسعيد • مارينا الغردقة' : 'Cairo HQ • Alexandria Port • Port Said Freezone • Hurghada Marina'}
            </p>
          </div> */}
        </div>

        <div className="border-t border-marine-teal/10 pt-6 flex flex-col lg:flex-row items-center justify-between gap-4 text-xs text-marine-outline">
          <p>&copy; {new Date().getFullYear()} Ready Marine. {t.allRightsReserved}</p>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Link href="/privacy" className="hover:text-marine-primary transition-colors">{t.privacyPolicy}</Link>
            <span className="text-marine-line">·</span>
            <Link href="/shipping" className="hover:text-marine-primary transition-colors">{t.shippingPolicy || (language === 'ar' ? 'الشحن' : 'Shipping')}</Link>
            <span className="text-marine-line">·</span>
            <Link href="/terms" className="hover:text-marine-primary transition-colors">{t.termsConditions || (language === 'ar' ? 'الشروط' : 'Terms')}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
