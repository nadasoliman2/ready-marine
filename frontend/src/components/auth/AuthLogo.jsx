'use client';

import Link from '../LocaleLink';
import { useApp } from '../../context/AppContext';
import { SiteLogo } from '../Header';

/** The site's logo at the top of the sign-in and sign-up cards, back to the home page. */
export default function AuthLogo() {
  const { siteSettings, language } = useApp();
  return (
    <Link
      href="/"
      aria-label={language === 'ar' ? 'الصفحة الرئيسية' : 'Home'}
      className="inline-flex items-center justify-center mb-5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-marine-cyan/40"
    >
      <SiteLogo siteSettings={siteSettings} />
    </Link>
  );
}
