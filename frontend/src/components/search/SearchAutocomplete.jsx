'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, Clock, X, Tag, Layers, Car, Loader2, CornerDownLeft, Sparkles } from 'lucide-react';
import Link from '../LocaleLink';
import { useRouter, usePathname } from '../../lib/navigation';
import { useApp } from '../../context/AppContext';
import { resolveAssetUrl, thumbUrl } from '../../lib/assets';
import {
  addRecentSearch,
  fetchSuggestions,
  getRecentSearches,
  highlightSegments,
  peekSuggestions,
  removeRecentSearch,
} from '../../lib/searchSuggest';
import { publishSearchFilter } from '../../lib/categoryFilterEvents';

// Long enough to skip the keystrokes of a word typed quickly, short enough to feel instant.
const DEBOUNCE_MS = 120;

const COPY = {
  en: {
    products: 'Products', categories: 'Categories', brands: 'Brands', cars: 'Cars', recent: 'Recent searches',
    seeAll: (n, q) => `See all ${n} results for “${q}”`, searchFor: (q) => `Search for “${q}”`,
    didYouMean: 'Did you mean', noResults: (q) => `No results for “${q}”. Try another word or a part number.`,
    items: (n) => `${n} item${n === 1 ? '' : 's'}`, clear: 'Remove', allCar: 'All parts',
  },
  ar: {
    products: 'المنتجات', categories: 'الأقسام', brands: 'الماركات', cars: 'السيارات', recent: 'عمليات البحث الأخيرة',
    seeAll: (n, q) => `عرض كل النتائج (${n}) لـ «${q}»`, searchFor: (q) => `ابحث عن «${q}»`,
    didYouMean: 'هل تقصد', noResults: (q) => `مفيش نتائج لـ «${q}». جرّب كلمة تانية أو رقم القطعة.`,
    items: (n) => `${n} منتج`, clear: 'حذف', allCar: 'كل القطع',
  },
};

/** The typed words in bold inside a suggestion. */
function Highlight({ text, query }) {
  return highlightSegments(text, query).map((part, i) => (
    part.hit
      ? <mark key={i} className="bg-transparent text-marine-primary font-bold">{part.text}</mark>
      : <span key={i}>{part.text}</span>
  ));
}

function SectionTitle({ children }) {
  return (
    <div className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-marine-outline">{children}</div>
  );
}

/** One row of the list: a link when it goes somewhere, the keyboard's current row in red. */
function OptionRow({ id, active, href, onPick, onHover, children }) {
  const className = `flex items-center gap-3 px-4 py-2.5 text-sm text-start w-full transition-colors ${
    active ? 'bg-marine-mist text-marine-ink' : 'text-marine-muted hover:bg-marine-canvas'
  }`;
  if (href) {
    return (
      <Link id={id} role="option" aria-selected={active} href={href} onClick={onPick} onMouseEnter={onHover} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button id={id} type="button" role="option" aria-selected={active} onClick={onPick} onMouseEnter={onHover} className={className}>
      {children}
    </button>
  );
}

const productHref = (product, isAr) => {
  const slug = isAr ? (product.slug_ar || product.slug_en) : (product.slug_en || product.slug_ar);
  return slug ? `/product/${slug}` : `/products?search=${encodeURIComponent(product.title_en || product.title_ar)}`;
};

const carHref = (car) => {
  const params = new URLSearchParams({ car_brand_id: car.car_brand_id });
  if (car.car_model_id) params.set('car_model_id', car.car_model_id);
  return `/products?${params.toString()}`;
};

/**
 * The site's search box, with suggestions while typing: matching products (with picture and
 * price), categories, brands and cars, a "did you mean" when a word looks mistyped, and the
 * visitor's recent searches when the box is empty. Arrow keys move through the list, Enter
 * opens the row (or searches), Escape closes it.
 *
 * By default a search opens the shop (`/products?search=`); a page that is the shop itself
 * passes `onSearch` to filter in place.
 */
export default function SearchAutocomplete({
  defaultValue = '',
  placeholder,
  onSearch,
  formClassName = 'relative',
  inputClassName = '',
  buttonClassName = '',
  buttonContent,
}) {
  const { language, siteSettings } = useApp();
  const isAr = language === 'ar';
  const copy = COPY[isAr ? 'ar' : 'en'];
  const router = useRouter();
  const pathname = usePathname();
  const listId = useId();

  const [query, setQuery] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState([]);
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  const trimmed = query.trim();

  // A new value from the page (the shop's own box after a search) replaces what is typed.
  useEffect(() => { setQuery(defaultValue); }, [defaultValue]);

  // Ask for suggestions a moment after the typing pauses; a newer keystroke cancels the
  // request for the older one, so answers can never arrive out of order.
  useEffect(() => {
    setActive(-1);
    if (!trimmed) { setData(null); setLoading(false); return undefined; }
    const known = peekSuggestions(trimmed);
    if (known) { setData(known); setLoading(false); return undefined; }

    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchSuggestions(trimmed, controller.signal)
        .then((result) => { setData(result); setLoading(false); })
        .catch((err) => { if (err.name !== 'AbortError') setLoading(false); });
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [trimmed]);

  // Closes on a click anywhere else, and when the page changes.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => { if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); };
  }, [open]);
  useEffect(() => { setOpen(false); }, [pathname]);

  const close = () => { setOpen(false); setActive(-1); inputRef.current?.blur(); };

  const runSearch = (value) => {
    const q = value.trim();
    if (!q) return;
    addRecentSearch(q);
    setQuery(q);
    close();
    if (onSearch) onSearch(q);
    // Already in the shop: hand it the search to narrow what is open, at once.
    else if (pathname === '/products') publishSearchFilter(q);
    else router.push(`/products?search=${encodeURIComponent(q)}`);
  };

  // Every row of the list, in order, so the arrow keys can walk them.
  const items = useMemo(() => {
    if (!trimmed) {
      return recent.map((q) => ({ key: `recent:${q}`, kind: 'recent', value: q }));
    }
    if (!data) return [];
    const list = [];
    if (data.corrected && data.total > 0) list.push({ key: 'corrected', kind: 'corrected', value: data.corrected });
    data.products.forEach((p) => list.push({ key: `p:${p._id}`, kind: 'product', product: p, href: productHref(p, isAr) }));
    data.categories.forEach((c) => list.push({ key: `c:${c._id}`, kind: 'category', category: c, href: `/products?category_id=${c._id}` }));
    data.brands.forEach((b) => list.push({ key: `b:${b._id}`, kind: 'brand', brand: b, href: `/products?product_brand_id=${b._id}` }));
    data.cars.forEach((car) => list.push({ key: `car:${car.car_brand_id}:${car.car_model_id || ''}`, kind: 'car', car, href: carHref(car) }));
    if (data.total > 0) list.push({ key: 'all', kind: 'all', value: trimmed });
    return list;
  }, [trimmed, data, recent, isAr]);

  const pick = (item) => {
    if (item.kind === 'recent' || item.kind === 'corrected' || item.kind === 'all') {
      runSearch(item.value);
      return;
    }
    addRecentSearch(trimmed);
    close();
    router.push(item.href);
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      if (!items.length) return;
      // The positions are the box itself (-1) and every row; the keys cycle through them.
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const positions = items.length + 1;
      setActive((current) => ((current + 1 + step + positions) % positions) - 1);
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  };

  const activeIndex = active >= items.length ? -1 : active;

  const onSubmit = (event) => {
    event.preventDefault();
    if (open && activeIndex >= 0) pick(items[activeIndex]);
    else runSearch(query);
  };

  const onFocus = () => {
    setRecent(getRecentSearches());
    setOpen(true);
  };

  const currency = siteSettings?.currency || 'EGP';
  const optionId = (i) => `${listId}-option-${i}`;
  const showPanel = open && (items.length > 0 || (trimmed && data && !loading));

  // Rows grouped under their section titles, keeping their place in `items`.
  const renderRows = () => {
    const rows = [];
    let lastKind = null;
    items.forEach((item, i) => {
      const titleFor = { recent: copy.recent, product: copy.products, category: copy.categories, brand: copy.brands, car: copy.cars }[item.kind];
      if (item.kind !== lastKind && titleFor) rows.push(<SectionTitle key={`title:${item.kind}`}>{titleFor}</SectionTitle>);
      lastKind = item.kind;
      const shared = { id: optionId(i), active: i === activeIndex, onHover: () => setActive(i) };

      if (item.kind === 'recent') {
        rows.push(
          <div key={item.key} className="flex items-center">
            <OptionRow {...shared} onPick={() => pick(item)}>
              <Clock size={16} className="text-marine-outline shrink-0" />
              <span className="truncate">{item.value}</span>
            </OptionRow>
            <button
              type="button"
              aria-label={copy.clear}
              onClick={() => { removeRecentSearch(item.value); setRecent(getRecentSearches()); }}
              className="px-3 py-2 text-marine-line hover:text-marine-muted"
            >
              <X size={14} />
            </button>
          </div>,
        );
      } else if (item.kind === 'corrected') {
        rows.push(
          <OptionRow key={item.key} {...shared} onPick={() => pick(item)}>
            <Sparkles size={16} className="text-marine-primary shrink-0" />
            <span>{copy.didYouMean}: <strong className="text-marine-ink">{item.value}</strong></span>
          </OptionRow>,
        );
      } else if (item.kind === 'product') {
        const p = item.product;
        const title = (isAr ? (p.title_ar || p.title_en) : (p.title_en || p.title_ar)) || '';
        const hasDiscount = p.discount_price != null && p.discount_price < p.price;
        rows.push(
          <OptionRow key={item.key} {...shared} href={item.href} onPick={() => { addRecentSearch(trimmed); setOpen(false); }}>
            <span className="w-11 h-11 rounded-lg bg-marine-mist overflow-hidden shrink-0 flex items-center justify-center">
              {p.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbUrl(resolveAssetUrl(p.image), 160)} alt="" className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <Search size={16} className="text-marine-line" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block line-clamp-2 leading-snug"><Highlight text={title} query={trimmed} /></span>
              <span className="block text-xs text-marine-outline mt-0.5 truncate">
                <span className="font-bold text-marine-ink">{currency} {(hasDiscount ? p.discount_price : p.price)?.toFixed(2)}</span>
                {hasDiscount && <span className="line-through ms-1.5">{p.price.toFixed(2)}</span>}
                {p.store_name && <span className="ms-2">· {p.store_name}</span>}
              </span>
            </span>
          </OptionRow>,
        );
      } else if (item.kind === 'category') {
        const c = item.category;
        const name = isAr ? (c.name_ar || c.name) : c.name;
        const parent = isAr ? (c.parent_name_ar || c.parent_name) : c.parent_name;
        rows.push(
          <OptionRow key={item.key} {...shared} href={item.href} onPick={() => { addRecentSearch(trimmed); setOpen(false); }}>
            <Layers size={16} className="text-marine-outline shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              <Highlight text={name} query={trimmed} />
              {parent && <span className="text-xs text-marine-outline ms-2">{parent}</span>}
            </span>
            <span className="text-xs text-marine-outline shrink-0">{copy.items(c.count)}</span>
          </OptionRow>,
        );
      } else if (item.kind === 'brand') {
        const b = item.brand;
        rows.push(
          <OptionRow key={item.key} {...shared} href={item.href} onPick={() => { addRecentSearch(trimmed); setOpen(false); }}>
            <Tag size={16} className="text-marine-outline shrink-0" />
            <span className="min-w-0 flex-1 truncate capitalize"><Highlight text={b.name} query={trimmed} /></span>
            <span className="text-xs text-marine-outline shrink-0">{copy.items(b.count)}</span>
          </OptionRow>,
        );
      } else if (item.kind === 'car') {
        const car = item.car;
        rows.push(
          <OptionRow key={item.key} {...shared} href={item.href} onPick={() => { addRecentSearch(trimmed); setOpen(false); }}>
            <Car size={16} className="text-marine-outline shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              <Highlight text={[car.brand_name, car.model_name].filter(Boolean).join(' ')} query={trimmed} />
            </span>
            <span className="text-xs text-marine-outline shrink-0">{copy.allCar}</span>
          </OptionRow>,
        );
      } else if (item.kind === 'all') {
        rows.push(
          <div key="all:border" className="border-t border-marine-teal/15 mt-1" />,
          <OptionRow key={item.key} {...shared} onPick={() => pick(item)}>
            <Search size={16} className="text-marine-primary shrink-0" />
            <span className="flex-1 font-bold text-marine-primary truncate">{copy.seeAll(data.total, trimmed)}</span>
            <CornerDownLeft size={14} className="text-marine-line shrink-0 rtl:-scale-x-100" />
          </OptionRow>,
        );
      }
    });
    return rows;
  };

  return (
    <div ref={boxRef} className="relative w-full">
      <form onSubmit={onSubmit} className={formClassName} role="search">
        <input
          ref={inputRef}
          type="search"
          name="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          enterKeyHint="search"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          className={`${inputClassName} [&::-webkit-search-cancel-button]:hidden`}
        />
        <button type="submit" aria-label={copy.searchFor(trimmed)} className={buttonClassName}>
          {loading && trimmed ? <Loader2 size={18} className="animate-spin" /> : (buttonContent || <Search size={18} />)}
        </button>
      </form>

      {showPanel && (
        <div
          id={listId}
          role="listbox"
          className="absolute top-full start-0 end-0 mt-2 z-[120] bg-white border border-marine-teal/15 rounded-lg shadow-[0_20px_50px_rgba(0,0,0,0.15)] overflow-hidden"
        >
          <div className="max-h-[70vh] overflow-y-auto overscroll-contain pb-1">
            {items.length > 0 ? renderRows() : (
              <div className="px-4 py-5 text-sm text-marine-outline text-center">{copy.noResults(trimmed)}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
