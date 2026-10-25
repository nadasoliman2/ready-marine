'use client';

import { ImageOff, Check, ExternalLink, Clock } from 'lucide-react';
import { L, entryTitle, entryImage, entryCategoryName, entryBrandName } from '../../../lib/catalog';

/**
 * One catalog entry as a result card: image, title, category, brand.
 *
 * Two states matter beyond the plain one:
 *  · the entry is a suggestion still awaiting admin review — badged, but fully
 *    selectable, because a vendor finding another vendor's suggestion is the
 *    only thing suppressing duplicates at the source;
 *  · this vendor already has a product on it — the action turns into "Open your
 *    product", since one product per (vendor + entry) is enforced server-side.
 */
export default function CatalogEntryCard({
    entry,
    language,
    onSelect,
    onOpenExisting,
    selectable = true,
    selected = false,
    multiSelect = false,
}) {
    const image = entryImage(entry);
    const title = entryTitle(entry, language);
    const category = entryCategoryName(entry, language);
    const brand = entryBrandName(entry);
    const owned = !!entry.vendor_product_id;

    const handleClick = () => {
        if (owned && !multiSelect) return onOpenExisting?.(entry);
        if (selectable) onSelect?.(entry);
    };

    return (
        <button
            type="button"
            onClick={handleClick}
            className={`w-full text-start flex items-center gap-4 p-3 rounded-xl border transition-all ${selected
                ? 'border-marine-cyan bg-red-50 dark:bg-marine-cyan/10'
                : 'border-zinc-200 dark:border-white/10 bg-white dark:bg-[#14171A] hover:border-marine-cyan/60 hover:shadow-sm'
                }`}
        >
            {multiSelect && (
                <span className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border ${selected ? 'bg-marine-cyan border-marine-cyan text-white' : 'border-zinc-300 dark:border-white/20'}`}>
                    {selected ? <Check size={13} /> : null}
                </span>
            )}

            <div className="w-16 h-16 rounded-lg bg-zinc-100 dark:bg-white/5 flex items-center justify-center overflow-hidden flex-shrink-0">
                {image
                    ? <img src={image} alt="" className="w-full h-full object-cover" />
                    : <ImageOff size={20} className="text-zinc-400" />}
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-zinc-900 dark:text-white truncate">{title}</span>
                    {entry.status === 'suggested' && (
                        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded">
                            <Clock size={10} /> {L(language, 'Under review', 'قيد المراجعة')}
                        </span>
                    )}
                </div>
                <p className="text-xs text-zinc-500 mt-0.5 truncate">
                    {[category, brand, entry.part_number].filter(Boolean).join(' · ')}
                </p>
                {owned && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold mt-1">
                        {L(language, 'You already have a product on this', 'لديك منتج على هذا بالفعل')}
                    </p>
                )}
            </div>

            {!multiSelect && (
                <span className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold ${owned
                    ? 'border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300'
                    : 'bg-marine-cyan text-white'
                    }`}>
                    {owned
                        ? <><ExternalLink size={12} /> {L(language, 'Open your product', 'افتح منتجك')}</>
                        : L(language, 'Select', 'اختيار')}
                </span>
            )}
        </button>
    );
}
