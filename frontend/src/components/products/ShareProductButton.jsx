'use client';

import { useState } from 'react';
import { Share2, Check } from 'lucide-react';

/**
 * The product's link in the language on screen, as people read it: the Arabic slug in
 * Arabic letters, not percent-encoded. The language in the path (`/ar/product/…`) makes it
 * open in that language for whoever receives it — without it, a visitor whose saved
 * language differs (every first-time visitor is English) is sent to the other slug.
 */
export const readableProductLink = (product, lang) => {
  const slug = lang === 'ar' ? (product.slug_ar || product.slug_en) : (product.slug_en || product.slug_ar);
  return `${window.location.origin}/${lang === 'ar' ? 'ar' : 'en'}/product/${slug}`;
};

/** Copy text; the textarea route is for in-app browsers that block the clipboard API. */
const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
};

export default function ShareProductButton({ product, language }) {
  const isAr = language === 'ar';
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const link = readableProductLink(product, isAr ? 'ar' : 'en');
    if (await copyText(link)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } else {
      // Nothing could write to the clipboard: show the link so it can be copied by hand.
      window.prompt(isAr ? 'انسخ اللينك:' : 'Copy the link:', link);
    }
  };

  return (
    <button
      type="button"
      onClick={share}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-bold transition-colors ${copied
        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
        : 'border-marine-teal/15 bg-white text-marine-muted hover:border-marine-cyan hover:text-marine-primary'}`}
      aria-live="polite"
    >
      {copied ? <Check size={16} /> : <Share2 size={16} />}
      {copied ? (isAr ? 'اتنسخ اللينك' : 'Link copied') : (isAr ? 'مشاركة' : 'Share')}
    </button>
  );
}
