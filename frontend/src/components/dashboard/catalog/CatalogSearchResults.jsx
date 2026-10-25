'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import useDependentFacets from './useDependentFacets';
import { Search, Loader2, AlertCircle, RotateCcw, PackageSearch, SlidersHorizontal, X } from 'lucide-react';
import { catalogApi } from '../../../lib/api';
import { L } from '../../../lib/catalog';
import CatalogEntryCard from './CatalogEntryCard';
import SearchableSelect from '../../SearchableSelect';

/**
 * The search box and its results — shared by the standalone search gate and the
 * bulk-grid picker popup, so both behave identically.
 *
 * Two behaviours are deliberate rather than incidental:
 *  · results load inside the results area and the field keeps focus, so typing
 *    is never interrupted by the page moving under the cursor;
 *  · a failed search renders an error WITH a retry and leaves the surrounding
 *    "add a new product" action untouched — a broken catalog search must never
 *    be the thing that stops a vendor listing a product.
 *
 * The brand and category filters are optional and independent of the term. Both are
 * populated from what the catalog ACTUALLY holds, so no choice in either list can return
 * nothing. Selecting one with an empty box is a legitimate way to browse.
 */
export default function CatalogSearchResults({
    language,
    autoFocus = true,
    multiSelect = false,
    selectedIds = new Set(),
    onSelect,
    onOpenExisting,
    onNewProduct,
    emptyAction = null,
    // Defaults to the vendor-scoped search. The admin screens pass their own,
    // because their endpoint is a different one and "you already have a product
    // on this" is meaningless when you are not a vendor. It receives the filters as a
    // second argument so an admin screen narrows by brand and category exactly as a
    // vendor does.
    searchFn = null,
    // Where the filter lists come from. Admin screens pass their own endpoint.
    facetsFn = null,
    showFilters = true,
}) {
    const [query, setQuery] = useState('');
    const [categoryId, setCategoryId] = useState('');
    const [brandId, setBrandId] = useState('');
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searched, setSearched] = useState(false);
    const inputRef = useRef(null);
    // Guards against a slow early request overwriting a fast later one.
    const requestRef = useRef(0);

    const runSearch = useCallback(async (term, filters) => {
        const requestId = ++requestRef.current;
        setLoading(true);
        setError('');
        try {
            const data = searchFn
                ? await searchFn(term, filters)
                : await catalogApi.search({ q: term, limit: 24, ...filters });
            if (requestRef.current !== requestId) return;
            setEntries(data.entries || []);
        } catch (err) {
            if (requestRef.current !== requestId) return;
            setError(L(language, 'We could not search the catalog right now.', 'تعذر البحث في الكتالوج الآن.'));
        } finally {
            if (requestRef.current === requestId) {
                setLoading(false);
                setSearched(true);
            }
        }
    }, [language, searchFn]);

    useEffect(() => {
        const filters = {};
        if (categoryId) filters.category_id = categoryId;
        if (brandId) filters.product_brand_id = brandId;
        // A filter change is a click, not typing, so it applies at once; only the term
        // waits out the debounce.
        const id = setTimeout(() => runSearch(query.trim(), filters), query.trim() ? 300 : 0);
        return () => clearTimeout(id);
    }, [query, categoryId, brandId, runSearch]);

    // The two lists narrow to fit each other: pick a category and only the brands that
    // work in it remain, pick a brand and only its categories remain.
    const facets = useDependentFacets({
        load: facetsFn || catalogApi.filters,
        categoryId,
        brandId,
        setCategoryId,
        setBrandId,
        enabled: showFilters,
    });

    useEffect(() => {
        if (autoFocus) inputRef.current?.focus();
    }, [autoFocus]);

    const activeCount = (categoryId ? 1 : 0) + (brandId ? 1 : 0);

    return (
        <div className="space-y-4">
            <div className="relative">
                <Search size={20} className="absolute top-1/2 -translate-y-1/2 start-4 text-zinc-400 pointer-events-none" />
                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={L(language, 'Search for the product — name, part number…', 'ابحث عن المنتج — الاسم أو رقم القطعة…')}
                    className="w-full bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-2xl ps-12 pe-12 py-4 text-base text-zinc-900 dark:text-white placeholder-zinc-400 focus:border-marine-cyan focus:outline-none shadow-sm"
                />
                {loading && (
                    <Loader2 size={18} className="absolute top-1/2 -translate-y-1/2 end-4 animate-spin text-marine-primary" />
                )}
            </div>

            {/* Optional narrowing. Collapsed by default so the box stays the one obvious
                thing to do, and the button carries a count so an active filter is never
                hidden behind a closed panel — an empty result with a forgotten filter on
                is the failure this guards against. */}
            {showFilters && facets && (facets.categories?.length > 0 || facets.brands?.length > 0) && (
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setFiltersOpen((v) => !v)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${
                                activeCount > 0
                                    ? 'border-marine-cyan text-marine-primary bg-red-50 dark:bg-marine-cyan/10'
                                    : 'border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan'
                            }`}
                        >
                            <SlidersHorizontal size={14} />
                            {L(language, 'Filters', 'الفلاتر')}
                            {activeCount > 0 && (
                                <span className="bg-marine-cyan text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]">
                                    {activeCount}
                                </span>
                            )}
                        </button>
                        {activeCount > 0 && (
                            <button
                                type="button"
                                onClick={() => { setCategoryId(''); setBrandId(''); }}
                                className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-xs font-bold text-zinc-500 hover:text-marine-primary"
                            >
                                <X size={13} /> {L(language, 'Clear', 'مسح')}
                            </button>
                        )}
                        <span className="text-[11px] text-zinc-400">
                            {L(language, 'Optional — narrows the search', 'اختياري — بيضيّق نتايج البحث')}
                        </span>
                    </div>

                    {filtersOpen && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 p-3 rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/[0.02]">
                            <div>
                                <label className="block text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-1.5">
                                    {L(language, 'Category', 'التصنيف')}
                                </label>
                                <select
                                    value={categoryId}
                                    onChange={(e) => setCategoryId(e.target.value)}
                                    className="w-full bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-white focus:border-marine-cyan focus:outline-none"
                                >
                                    <option value="">{L(language, 'All categories', 'كل التصنيفات')}</option>
                                    {(facets.categories || []).map((c) => (
                                        <option key={c._id} value={c._id}>
                                            {(language === 'ar' ? c.name_ar : c.name_en) || c.name_en || c.name_ar} ({c.count})
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-1.5">
                                    {L(language, 'Brand', 'الماركة')}
                                </label>
                                <SearchableSelect
                                    value={brandId}
                                    onChange={setBrandId}
                                    options={(facets.brands || []).map((b) => ({ value: b._id, label: `${(language === 'ar' ? b.name_ar : b.name_en) || b.name_en} (${b.count})`, keywords: [b.name_en, b.name_ar].filter(Boolean).join(' '), image: b.image || null }))}
                                    placeholder={L(language, 'All brands', 'كل الماركات')}
                                    isAr={language === 'ar'}
                                    buttonClassName="w-full bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg ps-3 pe-9 py-2 text-sm text-zinc-900 dark:text-white capitalize focus:border-marine-cyan focus:outline-none"
                                />
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Results area — the only thing that changes while searching, so the
                page never jumps and the field never loses focus. */}
            <div className="min-h-[220px]">
                {error ? (
                    <div className="flex flex-col items-center justify-center text-center gap-3 py-10">
                        <AlertCircle size={28} className="text-red-500" />
                        <p className="text-sm text-zinc-600 dark:text-zinc-300">{error}</p>
                        <button
                            type="button"
                            onClick={() => runSearch(query.trim())}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-200 hover:border-marine-cyan hover:text-marine-primary"
                        >
                            <RotateCcw size={14} /> {L(language, 'Try again', 'حاول مرة أخرى')}
                        </button>
                        <p className="text-xs text-zinc-500 max-w-sm">
                            {L(language,
                                'You can still add a new product while search is down.',
                                'ما زال بإمكانك إضافة منتج جديد أثناء تعطل البحث.')}
                        </p>
                    </div>
                ) : loading && entries.length === 0 ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 size={26} className="animate-spin text-marine-primary" />
                    </div>
                ) : entries.length === 0 && searched ? (
                    /* The dominant state for the catalog's first months — it must
                       read as normal, not as a failure the vendor caused. */
                    <div className="flex flex-col items-center justify-center text-center gap-3 py-10 px-4">
                        <div className="w-14 h-14 rounded-full bg-zinc-100 dark:bg-white/5 flex items-center justify-center">
                            <PackageSearch size={26} className="text-zinc-400" />
                        </div>
                        <p className="font-bold text-zinc-900 dark:text-white">
                            {activeCount > 0
                                ? L(language, 'Nothing matches with these filters on.', 'مفيش نتايج مع الفلاتر دي.')
                                : L(language, "We couldn't find a product by that name — that's completely normal.",
                                    'لم نجد منتجاً بهذا الاسم — وهذا أمر طبيعي تماماً.')}
                        </p>
                        {/* Without this an empty result reads as "the catalog has nothing",
                            when the real cause is a filter the vendor set and forgot. */}
                        {activeCount > 0 && (
                            <button
                                type="button"
                                onClick={() => { setCategoryId(''); setBrandId(''); }}
                                className="text-sm font-bold text-marine-primary hover:underline"
                            >
                                {L(language, 'Clear the filters and search again', 'امسح الفلاتر وابحث تاني')}
                            </button>
                        )}
                        <p className="text-sm text-zinc-500 max-w-md">
                            {L(language, "Add it and it'll be available to everyone from now on.",
                                'أضفه وسيصبح متاحاً للجميع من الآن فصاعداً.')}
                        </p>
                        {emptyAction || (
                            <button
                                type="button"
                                onClick={onNewProduct}
                                className="mt-1 bg-marine-cyan hover:bg-marine-cyan-dark text-white px-6 py-3 rounded-xl text-sm font-bold shadow-sm"
                            >
                                {L(language, 'Add a new product', 'إضافة منتج جديد')}
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="space-y-2">
                        {entries.map((entry) => (
                            <CatalogEntryCard
                                key={entry._id}
                                entry={entry}
                                language={language}
                                multiSelect={multiSelect}
                                selected={selectedIds.has(String(entry._id))}
                                onSelect={onSelect}
                                onOpenExisting={onOpenExisting}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
