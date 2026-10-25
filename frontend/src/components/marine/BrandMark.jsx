'use client';

import { useState } from 'react';
import { Anchor } from 'lucide-react';

export const BRAND_LOGO_SRC = '/images/ready-marine-logo.png';

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
        className={className || (compact ? 'h-7 w-auto object-contain max-w-[170px]' : 'h-9 w-auto object-contain max-w-[260px]')}
      />
    );
  }

  return (
    <span className="flex items-center gap-2">
      <Anchor size={compact ? 24 : 28} strokeWidth={2.25} className="text-marine-primary flex-shrink-0" />
      <span>
        <span className="block font-display text-marine-primary font-bold text-lg leading-tight tracking-tight">READY MARINE</span>
        {!compact && (
          <span className="block font-display text-marine-muted text-[10px] leading-tight tracking-[0.12em] uppercase">
            Yacht &amp; Marine Parts
          </span>
        )}
      </span>
    </span>
  );
}
