'use client';

import { Mail, Phone, MapPin, Clock, Facebook, Instagram, Twitter, Youtube, Linkedin, MessageCircle } from 'lucide-react';
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

  const footerPhones = (siteSettings?.footer_phones && siteSettings.footer_phones.length > 0)
    ? siteSettings.footer_phones
    : ['010155661614'];
  const footerEmails = (siteSettings?.footer_emails && siteSettings.footer_emails.length > 0)
    ? siteSettings.footer_emails
    : ['info@tech-oriented.digital'];
  const rawLocations = language === 'ar' ? (siteSettings?.locations_ar || []) : (siteSettings?.locations_en || []);
  const validLocations = rawLocations.filter(loc => loc && loc.trim());
  const footerLocations = validLocations.length > 0
    ? validLocations
    : [language === 'ar' ? 'الإسكندرية، مصر' : 'Alexandria, Egypt'];

  if (pathname.startsWith('/dashboard')) return null;

  const rawWhatsapp = siteSettings?.social_links?.whatsapp || (footerPhones[0] ? footerPhones[0].replace(/\D/g, '') : '2010155661614');
  const whatsappNum = rawWhatsapp ? (rawWhatsapp.startsWith('2') ? rawWhatsapp : '2' + rawWhatsapp.replace(/^0/, '')) : '';

  const socialLinks = [
    { icon: Facebook, href: siteSettings?.social_links?.facebook || 'https://facebook.com', label: 'Facebook' },
    { icon: Instagram, href: siteSettings?.social_links?.instagram || 'https://instagram.com', label: 'Instagram' },
    { icon: Twitter, href: siteSettings?.social_links?.twitter, label: 'Twitter' },
    { icon: Youtube, href: siteSettings?.social_links?.youtube, label: 'YouTube' },
    { icon: Linkedin, href: siteSettings?.social_links?.linkedin || 'https://linkedin.com', label: 'LinkedIn' },
    { icon: MessageCircle, href: whatsappNum ? `https://wa.me/${whatsappNum}` : '', label: 'WhatsApp' },
    { icon: TikTokIcon, href: siteSettings?.social_links?.tiktok, label: 'TikTok' },
  ].filter(link => Boolean(link.href));

  return (
    <footer className="bg-marine-mist text-marine-ink border-t border-marine-teal/10">
      <div className="max-w-7xl mx-auto px-4 pt-16 pb-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 mb-12">
          {/* العمود الأول: الشعار وهوية ريدي مارين (اليمين في العربي، اليسار في الإنجليزي) */}
          <div>
            <div className="mb-4">
              {(siteSettings?.logo_light_url || siteSettings?.logo_url) ? (
                <img
                  src={siteSettings.logo_light_url || siteSettings.logo_url}
                  alt="Ready Marine"
                  className="h-12 w-auto object-contain max-w-[200px]"
                />
              ) : (
                <BrandMark className="h-12 w-auto object-contain max-w-[220px]" />
              )}
            </div>
            <p className="text-marine-muted text-sm leading-relaxed mb-5">
              {language === 'ar'
                ? (siteSettings?.footer_text_ar || 'قطع غيار أصلية لليخوت والمراكب ومحركاتها من تجار موثّقين — بنتأكد من التوافق ونوصّل للمرسى أو المارينا في كل مصر.')
                : (siteSettings?.footer_text_en || 'Genuine yacht, boat and marine engine parts from verified vendors — fitment checked, delivered to your dock or marina across Egypt.')}
            </p>
            <div className="flex flex-wrap gap-2.5 mb-6">
              {socialLinks.map(({ icon: Icon, href, label }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="w-9 h-9 rounded-lg bg-white border border-marine-teal/15 flex items-center justify-center text-marine-teal hover:bg-marine-teal hover:border-marine-teal hover:text-white transition-all duration-200 shadow-xs"
                >
                  <Icon size={16} />
                </a>
              ))}
            </div>
            <div className="flex flex-col gap-2 pt-4 border-t border-marine-teal/10 max-w-[220px]">
              <span className="text-[11px] text-marine-outline font-medium tracking-wide">
                {t.poweredBy || (language === 'ar' ? 'مدعوم بواسطة' : 'Powered by')}
              </span>
              <a
                href="https://tech-oriented.digital/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Tech Oriented"
                className="inline-flex transition-transform hover:scale-[1.02]"
              >
                <img
                  src="/images/tech-oriented.png"
                  alt="Tech Oriented"
                  className="h-10 w-auto object-contain brightness-95"
                />
              </a>
            </div>
          </div>

          {/* العمود الثاني: روابط سريعة */}
          <div>
            <h3 className="font-display font-bold text-marine-ink mb-5 text-xs uppercase tracking-[0.08em]">
              {t.quickLinks || (language === 'ar' ? 'روابط سريعة' : 'Quick Links')}
            </h3>
            <ul className="space-y-2.5 text-sm text-marine-muted">
              {[
                { label: t.home || (language === 'ar' ? 'الرئيسية' : 'Home'), href: '/' },
                { label: t.allProducts || (language === 'ar' ? 'جميع المنتجات' : 'All Products'), href: '/products' },
                { label: t.categories || (language === 'ar' ? 'فئات المنتجات' : 'Categories'), href: '/categories' },
                { label: language === 'ar' ? 'مجموعات ريدي مارين' : 'Marine Hubs', href: '/hubs' },
                { label: language === 'ar' ? 'الماركات والتجار' : 'Vendors & Brands', href: '/vendors' },
              ].map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="hover:text-marine-primary transition-colors flex items-center gap-1.5 group"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-marine-cyan opacity-0 group-hover:opacity-100 transition-opacity" />
                    <span>{link.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* العمود الثالث: خدمة العملاء والسياسات */}
          <div>
            <h3 className="font-display font-bold text-marine-ink mb-5 text-xs uppercase tracking-[0.08em]">
              {language === 'ar' ? 'خدمة العملاء والسياسات' : 'Customer Care & Policies'}
            </h3>
            <ul className="space-y-2.5 text-sm text-marine-muted">
              {[
                { label: t.shippingPolicy || (language === 'ar' ? 'الشحن والتوصيل' : 'Shipping Policy'), href: '/shipping' },
                { label: t.deliveryReturn || (language === 'ar' ? 'سياسة الاستبدال والاسترجاع' : 'Returns & Refunds'), href: '/delivery' },
                { label: t.privacyPolicy || (language === 'ar' ? 'سياسة الخصوصية' : 'Privacy Policy'), href: '/privacy' },
                { label: t.termsConditions || (language === 'ar' ? 'الشروط والأحكام' : 'Terms & Conditions'), href: '/terms' },
                { label: t.contactUs || (language === 'ar' ? 'اتصل بنا' : 'Contact Us'), href: '/contact' },
              ].map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="hover:text-marine-primary transition-colors flex items-center gap-1.5 group"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-marine-cyan opacity-0 group-hover:opacity-100 transition-opacity" />
                    <span>{link.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* العمود الرابع: معلومات التواصل والمقر */}
          <div>
            <h3 className="font-display font-bold text-marine-ink mb-5 text-xs uppercase tracking-[0.08em]">
              {t.contactInfo || (language === 'ar' ? 'معلومات التواصل' : 'Contact Info')}
            </h3>
            <ul className="space-y-3 text-sm text-marine-muted">
              {footerPhones.map((phone, idx) => (
                <li key={`phone-${idx}`}>
                  <a href={`tel:${phone}`} className="flex items-start gap-3 hover:text-marine-primary transition-colors group">
                    <Phone size={15} className="mt-0.5 flex-shrink-0 text-marine-primary group-hover:text-marine-cyan transition-colors" />
                    <span dir="ltr">{phone}</span>
                  </a>
                </li>
              ))}
              {footerEmails.map((email, idx) => (
                <li key={`email-${idx}`}>
                  <a href={`mailto:${email}`} className="flex items-start gap-3 hover:text-marine-primary transition-colors group">
                    <Mail size={15} className="mt-0.5 flex-shrink-0 text-marine-primary group-hover:text-marine-cyan transition-colors" />
                    <span>{email}</span>
                  </a>
                </li>
              ))}
              {footerLocations.map((loc, idx) => (
                <li key={`loc-${idx}`} className="flex items-start gap-3">
                  <MapPin size={15} className="mt-0.5 flex-shrink-0 text-marine-primary" />
                  <span>{loc}</span>
                </li>
              ))}
              <li className="pt-2 border-t border-marine-teal/10">
                <div className="flex items-center gap-2.5 text-xs text-marine-outline">
                  <Clock size={14} className="flex-shrink-0 text-marine-teal" />
                  <span>{language === 'ar' ? 'دعم العملاء متاح طوال أيام الأسبوع' : 'Customer Support: 7 Days a Week'}</span>
                </div>
              </li>
            </ul>
          </div>
        </div>

        {/* الشريط السفلي وحقوق الملكية */}
        <div className="border-t border-marine-teal/10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-marine-outline">
          <p>&copy; {new Date().getFullYear()} Ready Marine. {t.allRightsReserved || (language === 'ar' ? 'جميع الحقوق محفوظة.' : 'All rights reserved.')}</p>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Link href="/privacy" className="hover:text-marine-primary transition-colors">{t.privacyPolicy || (language === 'ar' ? 'سياسة الخصوصية' : 'Privacy Policy')}</Link>
            <span className="text-marine-line">·</span>
            <Link href="/shipping" className="hover:text-marine-primary transition-colors">{t.shippingPolicy || (language === 'ar' ? 'الشحن والتوصيل' : 'Shipping Policy')}</Link>
            <span className="text-marine-line">·</span>
            <Link href="/terms" className="hover:text-marine-primary transition-colors">{t.termsConditions || (language === 'ar' ? 'الشروط والأحكام' : 'Terms & Conditions')}</Link>
            <span className="text-marine-line">·</span>
            <Link href="/delivery" className="hover:text-marine-primary transition-colors">{t.deliveryReturn || (language === 'ar' ? 'الاسترجاع والاستبدال' : 'Returns')}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
