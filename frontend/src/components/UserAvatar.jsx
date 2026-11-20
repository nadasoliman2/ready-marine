'use client';

import { useState, useEffect } from 'react';
import { User } from 'lucide-react';
import { resolveAssetUrl } from '../lib/assets';

/**
 * Universal resilient UserAvatar:
 * - Sends `referrerPolicy="no-referrer"` so Google Avatars and external CDNs do not return 403 / 429.
 * - Handles image load error gracefully: falls back to user initials or clean User icon instead of a broken image placeholder.
 * - Resolves local asset URLs with correct backend origin.
 */
export default function UserAvatar({
  src,
  name = '',
  alt = '',
  size,
  iconSize = 19,
  className = '',
  imageClassName = 'w-full h-full object-cover',
  fallback = 'icon', // 'icon' | 'initials'
  fallbackClassName = '',
}) {
  const [hasError, setHasError] = useState(false);

  // Reset error when src changes (e.g. user updates photo or switches user)
  useEffect(() => {
    setHasError(false);
  }, [src]);

  const resolvedUrl = src ? resolveAssetUrl(src) : '';
  const initial = (name || '').trim().charAt(0).toUpperCase() || 'U';

  const showImage = Boolean(resolvedUrl && !hasError);

  const style = size ? { width: size, height: size } : undefined;

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 overflow-hidden select-none ${className}`}
      style={style}
    >
      {showImage ? (
        <img
          src={resolvedUrl}
          alt={alt || name || 'Avatar'}
          referrerPolicy="no-referrer"
          onError={() => setHasError(true)}
          className={imageClassName}
        />
      ) : fallback === 'initials' && name ? (
        <span className={`font-bold uppercase ${fallbackClassName || 'text-sm'}`}>
          {initial}
        </span>
      ) : (
        <User size={iconSize} className={fallbackClassName} />
      )}
    </div>
  );
}
