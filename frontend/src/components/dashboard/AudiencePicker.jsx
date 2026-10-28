'use client';

import { Check } from 'lucide-react';
import { AUDIENCE_OPTIONS } from '../../lib/marineHubs';

/**
 * The audience hubs a product shows up in (Product.target_audiences), independent of its
 * category — the same idea as the Onboard Essentials flag, but several at once. Each chip
 * toggles one key in `value`.
 */
export default function AudiencePicker({ value, onChange, isAr }) {
  const selected = Array.isArray(value) ? value : [];
  const toggle = (key) => onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);

  return (
    <div className="flex flex-wrap gap-2 sm:gap-2.5">
      {AUDIENCE_OPTIONS.map((opt) => {
        const on = selected.includes(opt.key);
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => toggle(opt.key)}
            aria-pressed={on}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-bold transition-all duration-200 cursor-pointer ${
              on
                ? 'bg-marine-cyan border-marine-cyan text-white shadow-sm shadow-marine-cyan/30 transform scale-[1.02]'
                : 'bg-white dark:bg-white/5 border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-200 hover:border-marine-cyan/60 hover:text-marine-primary hover:bg-marine-mist/40'
            }`}
          >
            {on && <Check size={13} strokeWidth={2.5} />}
            <span>{isAr ? opt.ar : opt.en}</span>
          </button>
        );
      })}
    </div>
  );
}
