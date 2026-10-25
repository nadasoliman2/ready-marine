'use client';

import { forwardRef } from 'react';
import NextLink from 'next/link';
import { useLocale } from '../lib/navigation';
import { localizeHref } from '../lib/locale';

/**
 * `next/link` with the current language on the path: `href="/products"` goes to
 * `/ar/products`. Outside URLs, `#anchors`, `?query` and files are left alone. Import it
 * instead of `next/link` everywhere on the site.
 */
const LocaleLink = forwardRef(function LocaleLink({ href, ...props }, ref) {
  const locale = useLocale();
  return <NextLink ref={ref} href={localizeHref(href, locale)} {...props} />;
});

export default LocaleLink;
