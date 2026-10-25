'use client';

import { useState } from 'react';
import { resolveAssetUrl, thumbUrl } from '../lib/assets';

/**
 * A car make's or a product brand's logo, small. Without one — or when its link is dead, as
 * a few brands' pictures hosted on other sites are — the brand's first letter in a circle
 * (or `fallback`), so the names in a list still line up and no broken-picture icon shows.
 */
export default function BrandLogo({ image, name, className = 'w-7 h-7', letterClassName = 'text-xs', fallback }) {
  const src = image ? thumbUrl(resolveAssetUrl(image), 160) : '';
  const [brokenSrc, setBrokenSrc] = useState(null);

  if (!src || brokenSrc === src) {
    if (fallback) return fallback;
    return (
      <span aria-hidden="true" className={`${className} shrink-0 rounded-full bg-zinc-100 text-zinc-400 ${letterClassName} font-bold flex items-center justify-center`}>
        {String(name || '').trim().charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setBrokenSrc(src)}
      className={`${className} shrink-0 object-contain`}
    />
  );
}
