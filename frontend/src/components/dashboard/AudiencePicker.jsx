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
    <div className="flex flex-wrap gap-2">
      {AUDIENCE_OPTIONS.map((opt) => {
        const on = selected.includes(opt.key);
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => toggle(opt.key)}
            aria-pressed={on}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
              on
                ? 'bg-marine-cyan border-marine-cyan text-white'
                : 'bg-zinc-50 dark:bg-white/5 border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan'
            }`}
          >
            {on && <Check size={13} />}
            {isAr ? opt.ar : opt.en}
          </button>
        );
      })}
    </div>
  );
}
