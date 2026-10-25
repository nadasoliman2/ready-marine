'use client';

import { PART_TYPES } from '../../lib/partType';

/**
 * Original / OEM / Aftermarket, as three buttons — required on every product form.
 * `invalid` outlines it in red when a save was refused for want of it.
 */
export default function PartTypePicker({ value, onChange, isAr, invalid = false }) {
    return (
        <div className="space-y-1.5">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                {isAr ? 'نوع القطعة' : 'Part type'} <span className="text-marine-primary">*</span>
            </label>
            <div className={`grid grid-cols-3 gap-2 rounded-xl ${invalid && !value ? 'ring-2 ring-marine-cyan/60 ring-offset-2 dark:ring-offset-[#09090b]' : ''}`}>
                {PART_TYPES.map((t) => {
                    const on = value === t.value;
                    return (
                        <button
                            key={t.value}
                            type="button"
                            aria-pressed={on}
                            onClick={() => onChange(t.value)}
                            className={`rounded-xl border px-2 py-2 text-center transition ${on
                                ? 'border-marine-cyan bg-marine-cyan/10 text-marine-primary'
                                : 'border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#0E1012] text-zinc-700 dark:text-zinc-200 hover:border-zinc-300 dark:hover:border-white/20'}`}
                        >
                            <span className="block text-sm font-black">{isAr ? t.ar : t.en}</span>
                            <span className="block text-[10px] font-medium text-zinc-400 leading-tight mt-0.5">{isAr ? t.hint_ar : t.hint_en}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
