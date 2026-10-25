'use client';

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowRight, Search, SlidersHorizontal } from 'lucide-react';
import { useRouter } from '../../lib/navigation';

/**
 * A product list's top on a phone, as in the app design — two pieces, so a page can keep
 * something of its own between them (the Car Trunk's essentials):
 *
 *  - MobileListingTop: a back button, the title with the count under it, and an optional
 *    banner (a picture or a colour, a line above the heading, the heading, a sentence);
 *  - MobileListingTools: the search box with the filters button beside it, and the order
 *    as chips — all, newest, top rated, price (a second tap turns the price around).
 *
 * Both are `sm:hidden`: a page keeps its own header and toolbar from `sm` up.
 */

export function MobileListingTop({ title, subtitle, banner, isAr }) {
  const router = useRouter();
  const back = () => {
    const fromHere = typeof document !== 'undefined' && document.referrer.startsWith(window.location.origin);
    if (fromHere && window.history.length > 1) router.back();
    else router.push('/');
  };

  return (
    <div className="sm:hidden bg-white">
      <div className="relative flex items-center justify-center px-4 py-3 border-b border-marine-teal/15">
        <button
          type="button"
          onClick={back}
          aria-label={isAr ? 'رجوع' : 'Back'}
          className="absolute start-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-marine-mist text-marine-muted flex items-center justify-center"
        >
          <ArrowRight size={18} className="ltr:rotate-180" />
        </button>
        <div className="text-center px-14 min-w-0">
          <h1 className="text-lg font-bold text-marine-ink leading-tight truncate">{title}</h1>
          {subtitle && <p className="text-[11px] text-marine-outline mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>

      {banner && (
        <div className="px-4 pt-4">
          <div className={`relative h-40 rounded-xl overflow-hidden shadow-sm ${banner.className || 'bg-zinc-900'}`}>
            {banner.image && <img src={banner.image} alt="" className="absolute inset-0 w-full h-full object-cover" />}
            <div className="absolute inset-0 bg-gradient-to-l rtl:bg-gradient-to-r from-transparent via-black/40 to-black/80" />
            <div className="absolute inset-y-0 start-0 w-[85%] flex flex-col justify-center p-5 text-white">
              {banner.eyebrow && <span className="text-[11px] font-bold text-amber-300">{banner.eyebrow}</span>}
              <span className="text-[22px] font-bold leading-tight mt-1">{banner.heading}</span>
              {banner.text && <span className="text-[11px] text-white/80 mt-1.5 leading-relaxed line-clamp-2">{banner.text}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const SORTS = [
  { id: '', ar: 'الكل', en: 'All' },
  { id: 'newest', ar: 'الأحدث', en: 'Newest' },
  { id: 'rating', ar: 'الأعلى تقييمًا', en: 'Top rated' },
  { id: 'price', ar: 'السعر', en: 'Price' },
];

export function MobileListingTools({ search, onSearch, searchPlaceholder, onFilters, filtersOpen, sort, onSort, isAr }) {
  const [draft, setDraft] = useState(search || '');
  // A search set from elsewhere (the header, a link) shows here too.
  useEffect(() => { setDraft(search || ''); }, [search]);

  const isPrice = sort === 'price_low' || sort === 'price_high';
  const pick = (id) => {
    if (id !== 'price') { onSort(id); return; }
    // Price: low to high first; tapped again, high to low.
    onSort(sort === 'price_low' ? 'price_high' : 'price_low');
  };
  const active = (id) => (id === 'price' ? isPrice : (sort || '') === id);

  return (
    <div className="sm:hidden bg-white px-4 pt-4 pb-3 space-y-3">
      <form
        role="search"
        onSubmit={(e) => { e.preventDefault(); onSearch(draft.trim()); }}
        className="flex items-center gap-2"
      >
        <div className="relative flex-1 min-w-0">
          <Search size={18} className="absolute start-3.5 top-1/2 -translate-y-1/2 text-marine-outline pointer-events-none" />
          <input
            type="search"
            enterKeyHint="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full bg-white border border-marine-teal/15 rounded-lg ps-10 pe-3 py-3 text-base text-marine-ink placeholder-zinc-400 focus:outline-none focus:border-marine-cyan [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
        <button
          type="button"
          onClick={onFilters}
          aria-expanded={filtersOpen}
          aria-label={isAr ? 'الفلاتر' : 'Filters'}
          className={`w-12 h-12 shrink-0 rounded-lg flex items-center justify-center transition-colors ${filtersOpen ? 'bg-marine-cyan text-white' : 'bg-marine-navy text-white'}`}
        >
          <SlidersHorizontal size={20} />
        </button>
      </form>

      <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4">
        {SORTS.map(({ id, ar, en }) => (
          <button
            key={id || 'all'}
            type="button"
            onClick={() => pick(id)}
            className={`shrink-0 flex items-center gap-1 px-4 py-2 rounded-full text-xs font-bold border transition-colors ${
              active(id) ? 'bg-marine-navy border-[#09090b] text-white' : 'bg-white border-marine-teal/15 text-marine-muted'
            }`}
          >
            {isAr ? ar : en}
            {id === 'price' && isPrice && (sort === 'price_low' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
          </button>
        ))}
      </div>
    </div>
  );
}
