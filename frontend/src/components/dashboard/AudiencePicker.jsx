'use client';

import { useState, useEffect } from 'react';
import { Check } from 'lucide-react';
import { AUDIENCE_OPTIONS } from '../../lib/marineHubs';
import { audienceApi } from '../../lib/api';

/**
 * The audience hubs a product shows up in (Product.target_audiences).
 * Dynamically loads target audiences from the database, falling back to AUDIENCE_OPTIONS.
 * Supports both ObjectId ref matching and legacy key matching.
 */
export default function AudiencePicker({ value, onChange, isAr, options = null }) {
  const [dbAudiences, setDbAudiences] = useState(null);

  useEffect(() => {
    if (options && options.length > 0) return;
    audienceApi.getAll()
      .then((res) => {
        if (res && res.audiences && Array.isArray(res.audiences)) {
          setDbAudiences(res.audiences);
        }
      })
      .catch(() => {});
  }, [options]);

  const rawList = options && options.length > 0
    ? options
    : (dbAudiences && dbAudiences.length > 0 ? dbAudiences : AUDIENCE_OPTIONS);

  // Normalize audience items to have _id, key, label
  const audienceItems = rawList.map((item) => ({
    _id: item._id ? String(item._id) : null,
    key: item.key || item.slug || '',
    ar: item.name_ar || item.ar || item.titleAr || item.key,
    en: item.name_en || item.en || item.titleEn || item.key,
  }));

  const selected = Array.isArray(value) ? value.map(v => typeof v === 'object' && v !== null ? String(v._id || v.key) : String(v)) : [];

  const isSelected = (opt) => {
    return selected.some((s) => {
      if (opt._id && s === opt._id) return true;
      if (opt.key && s.toLowerCase() === opt.key.toLowerCase()) return true;
      return false;
    });
  };

  const toggle = (opt) => {
    const active = isSelected(opt);
    const identifier = opt._id || opt.key;
    if (active) {
      onChange(selected.filter((s) => {
        if (opt._id && s === opt._id) return false;
        if (opt.key && s.toLowerCase() === opt.key.toLowerCase()) return false;
        return true;
      }));
    } else {
      onChange([...selected, identifier]);
    }
  };

  return (
    <div className="flex flex-wrap gap-2 sm:gap-2.5">
      {audienceItems.map((opt, idx) => {
        const on = isSelected(opt);
        return (
          <button
            key={opt._id || opt.key || idx}
            type="button"
            onClick={() => toggle(opt)}
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
