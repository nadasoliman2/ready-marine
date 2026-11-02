'use client';

import { useState } from 'react';
import { Anchor } from 'lucide-react';

export const BRAND_LOGO_SRC = '/images/ready-marine-brand-logo.png';

/**
 * Ready Marine's logo from public/images, or — until that file is there — the anchor and
 * the name in type. Used where the store has no logo uploaded in its settings.
 */
export default function BrandMark({ compact = false, className = '' }) {
  const [missing, setMissing] = useState(false);

  if (!missing) {
    return (
      <img
        src={BRAND_LOGO_SRC}
        alt="Ready Marine"
        onError={() => setMissing(true)}
        className={`${compact ? 'h-8 sm:h-9 w-auto object-contain max-w-[185px]' : 'h-10 w-auto object-contain max-w-[260px]'} ${className}`}
      />
    );
  }

  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <Anchor size={compact ? 24 : 28} strokeWidth={2.25} className="text-current flex-shrink-0" />
      <span>
        <span className="block font-display font-bold text-lg leading-tight tracking-tight text-current">READY MARINE</span>
        {!compact && (
          <span className="block font-display opacity-80 text-[10px] leading-tight tracking-[0.12em] uppercase">
            Yacht &amp; Marine Parts
          </span>
        )}
      </span>
    </span>
  );
}
