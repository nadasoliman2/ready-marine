'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from '../LocaleLink';

export default function ProfileHeaderBar({
  title,
  subtitle,
  backHref,
  onBack,
  rightAction,
  isAr = true,
  className = '',
}) {
  const BackIcon = isAr ? ChevronRight : ChevronLeft;

  const backButton = onBack ? (
    <button
      type="button"
      onClick={onBack}
      className="w-10 h-10 rounded-full bg-zinc-100/90 hover:bg-marine-mist text-zinc-700 hover:text-marine-primary transition-all flex items-center justify-center shrink-0 border border-zinc-200/60 shadow-xs"
      aria-label={isAr ? 'رجوع' : 'Back'}
    >
      <BackIcon size={20} />
    </button>
  ) : backHref ? (
    <Link
      href={backHref}
      className="w-10 h-10 rounded-full bg-zinc-100/90 hover:bg-marine-mist text-zinc-700 hover:text-marine-primary transition-all flex items-center justify-center shrink-0 border border-zinc-200/60 shadow-xs"
      aria-label={isAr ? 'رجوع' : 'Back'}
    >
      <BackIcon size={20} />
    </Link>
  ) : null;

  return (
    <div
      className={`bg-white border border-zinc-200/90 rounded-2xl sm:rounded-3xl p-4 sm:px-6 sm:py-4.5 shadow-xs flex items-center justify-between gap-4 mb-6 ${className}`}
    >
      <div className="flex items-center gap-3.5 min-w-0">
        {backButton}
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-black text-zinc-900 truncate tracking-tight">{title}</h1>
          {subtitle && <p className="text-xs sm:text-sm text-zinc-500 truncate mt-0.5">{subtitle}</p>}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {rightAction}
      </div>
    </div>
  );
}
