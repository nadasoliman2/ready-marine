'use client';

import { useCallback, useEffect, useState } from 'react';
import useDependentFacets from '../../../../components/dashboard/catalog/useDependentFacets';
import Link from '../../../../components/LocaleLink';
import {
    Library, Loader2, Plus, Search, X, Save, ImageOff, Archive, ArchiveRestore,
    Trash2, Store, AlertCircle, SlidersHorizontal,
} from 'lucide-react';
import { adminCatalogApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import { L, entryTitle, entryImage, entryCategoryName, entryBrandName } from '../../../../lib/catalog';
import { fetchProductMetadata } from '../../../../lib/productForm';
import CatalogEntryForm, { blankCatalogEntry, formStateToPayload } from '../../../../components/dashboard/catalog/CatalogEntryForm';
import SuggestionReviewCard from '../../../../components/dashboard/catalog/SuggestionReviewCard';
import UnlinkedProductsPanel from '../../../../components/dashboard/catalog/UnlinkedProductsPanel';
import LinkedGapsPanel from '../../../../components/dashboard/catalog/LinkedGapsPanel';
import LinkReviewPanel from '../../../../components/dashboard/catalog/LinkReviewPanel';
import PaginationControls from '../../../../components/dashboard/PaginationControls';
import usePageSize from '../../../../lib/usePageSize';
import useRowLink from '../../../../lib/useRowLink';
import Overlay from '../../../../components/Overlay';
import SearchableSelect from '../../../../components/SearchableSelect';

/**
 * The master catalog, admin side.
 *
 * Four tabs, because the four things an admin does here are different jobs:
 * curating the catalog proper, working through what vendors suggested, looking
 * at what has been retired, and clearing the backlog of vendor products that
 * never got attached to an entry at all. The badges are plain counters, not
 * notifications — nobody, vendor or admin, is notified about catalog work.
 */
export default function AdminCatalogPage() {
    const rowLink = useRowLink();
    const { language } = useApp();
    const isAr = language === 'ar';

    const [tab, setTab] = useState('approved');
    const [search, setSearch] = useState('');
    // Same optional narrowing the vendor's search gate has, reading the same facets
    // endpoint — so a brand only ever appears here if picking it can show something.
    const [categoryId, setCategoryId] = useState('');
    const [brandId, setBrandId] = useState('');
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = usePageSize('admin.catalog', 20);
    const [data, setData] = useState({ entries: [], pagination: { pages: 1, total: 0 } });
    const [counts, setCounts] = useState({ approved: 0, suggested: 0, archived: 0, rejected: 0 });
    const [unlinkedCount, setUnlinkedCount] = useState(0);
    // Linked products still missing a picture / a brand — the two data-entry tabs.
    const [gapCounts, setGapCounts] = useState({ images: 0, brand: 0 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const [metadata, setMetadata] = useState(null);
    const [creating, setCreating] = useState(false);
    const [form, setForm] = useState(blankCatalogEntry);
    const [saving, setSaving] = useState(false);

    const loadUnlinkedCount = useCallback(async () => {
        try {
            const res = await adminCatalogApi.listUnlinked({ limit: 1 });
            setUnlinkedCount(res.counts?.all || 0);
        } catch { /* the badge is decoration; a failure here must not break the page */ }
    }, []);

    useEffect(() => { loadUnlinkedCount(); }, [loadUnlinkedCount]);

    const loadGapCounts = useCallback(async () => {
        try {
            const res = await adminCatalogApi.listLinkedGaps({ gap: 'images', limit: 1 });
            setGapCounts(res.counts || { images: 0, brand: 0 });
        } catch { /* badges only */ }
    }, []);

    useEffect(() => { loadGapCounts(); }, [loadGapCounts]);

    // Linked products that do not read like their entry (the catalog matcher's check).
    const [linkReviewCount, setLinkReviewCount] = useState(0);
    const loadLinkReviewCount = useCallback(async () => {
        try {
            const res = await adminCatalogApi.linkReview({ limit: 1 });
            setLinkReviewCount(res.total || 0);
        } catch { /* badge only */ }
    }, []);
    useEffect(() => { loadLinkReviewCount(); }, [loadLinkReviewCount]);

    // Tabs that are product worklists rather than entry lists: they load themselves.
    const isWorklist = tab === 'unlinked' || tab === 'gap_images' || tab === 'gap_brand' || tab === 'link_review';

    const load = useCallback(async () => {
        // The worklist tabs are product lists, not entry lists — they load themselves.
        if (tab === 'unlinked' || tab === 'gap_images' || tab === 'gap_brand' || tab === 'link_review') { setLoading(false); return; }
        setLoading(true);
        setError('');
        try {
            const [list, statusCounts] = await Promise.all([
                adminCatalogApi.list({
                    status: tab,
                    q: search.trim(),
                    category_id: categoryId || undefined,
                    product_brand_id: brandId || undefined,
                    page,
                    limit: pageSize,
                }),
                adminCatalogApi.getCounts(),
            ]);
            setData(list);
            setCounts(statusCounts);
        } catch (err) {
            setError(err.message || L(language, 'Could not load the catalog.', 'تعذر تحميل الكتالوج.'));
        } finally {
            setLoading(false);
        }
    }, [tab, search, categoryId, brandId, page, language, pageSize]);

    useEffect(() => { load(); }, [load]);

    // What each suggestion on the page may duplicate, in one request for all of them: a
    // request per card sent up to 200 at once, and nginx (10 a second per address) refused
    // them, the page's own list with them.
    const [similarById, setSimilarById] = useState({});
    useEffect(() => {
        const ids = tab === 'suggested' ? (data?.entries || []).map((e) => e._id) : [];
        setSimilarById({});
        if (!ids.length) return undefined;
        let alive = true;
        adminCatalogApi.getSimilarMany(ids)
            .then((res) => { if (alive) setSimilarById(res.similar || {}); })
            .catch(() => { if (alive) setSimilarById(Object.fromEntries(ids.map((id) => [id, []]))); });
        return () => { alive = false; };
    }, [tab, data]);
    useEffect(() => { setPage(1); }, [tab, search, categoryId, brandId]);

    // Reloaded per tab, so the counts describe the tab being viewed and never promise rows
    // that live under a different status — and per selection, so each list narrows to fit
    // the other.
    const facets = useDependentFacets({
        load: (params) => adminCatalogApi.filters(isWorklist ? '' : tab, params),
        categoryId,
        brandId,
        setCategoryId,
        setBrandId,
        enabled: !isWorklist,
        reloadKey: tab,
    });
    useEffect(() => {
        fetchProductMetadata().then(setMetadata).catch(() => { /* the form degrades to text fields */ });
    }, []);

    const act = async (fn, successMessage) => {
        setError('');
        setNotice('');
        try {
            await fn();
            setNotice(successMessage);
            await load();
        } catch (err) {
            setError(err.message || L(language, 'That did not work.', 'لم تنجح العملية.'));
        }
    };

    const handleCreate = async () => {
        if (!form.title_en?.trim() && !form.title_ar?.trim()) {
            setError(L(language, 'A title in English or Arabic is required.', 'العنوان مطلوب بالإنجليزية أو العربية.'));
            return;
        }
        if (!form.category_id) {
            setError(L(language, 'Pick a final category.', 'اختر فئة نهائية.'));
            return;
        }
        setSaving(true);
        try {
            await adminCatalogApi.create(formStateToPayload(form));
            setCreating(false);
            setForm(blankCatalogEntry());
            setTab('approved');
            await load();
        } catch (err) {
            setError(err.message || L(language, 'Could not create the entry.', 'تعذر إنشاء البطاقة.'));
        } finally {
            setSaving(false);
        }
    };

    const TABS = [
        { key: 'approved', label: L(language, 'All entries', 'كل البطاقات'), badge: counts.approved },
        { key: 'suggested', label: L(language, 'Suggestions', 'الاقتراحات'), badge: counts.suggested, highlight: true },
        { key: 'archived', label: L(language, 'Archived', 'المؤرشفة'), badge: counts.archived },
        { key: 'rejected', label: L(language, 'Rejected', 'المرفوضة'), badge: counts.rejected },
        {
            key: 'unlinked',
            label: L(language, 'Unlinked products', 'منتجات غير مربوطة'),
            badge: unlinkedCount,
            highlight: true,
        },
        {
            key: 'gap_images',
            label: L(language, 'Linked, no images', 'مربوطة بدون صور'),
            badge: gapCounts.images,
            highlight: true,
        },
        {
            key: 'gap_brand',
            label: L(language, 'Linked, no brand', 'مربوطة بدون ماركة'),
            badge: gapCounts.brand,
            highlight: true,
        },
        {
            key: 'link_review',
            label: L(language, 'Links to review', 'روابط للمراجعة'),
            badge: linkReviewCount,
            highlight: true,
        },
    ];

    const activeFilters = (categoryId ? 1 : 0) + (brandId ? 1 : 0);

    return (
        <div className="animate-in fade-in duration-300 pb-10">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-marine-cyan/10 text-marine-primary flex items-center justify-center">
                        <Library size={20} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">
                            {L(language, 'Catalog', 'الكتالوج')}
                        </h1>
                        <p className="text-sm text-zinc-500 mt-0.5">
                            {L(language,
                                'What each product is — vendors attach their price and stock to these.',
                                'ما هو كل منتج — يربط التجار أسعارهم ومخزونهم بهذه البطاقات.')}
                        </p>
                    </div>
                </div>
                <button
                    onClick={() => { setCreating(true); setForm(blankCatalogEntry()); }}
                    className="flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white px-4 py-2.5 rounded-lg text-sm font-bold shadow-sm transition-colors"
                >
                    <Plus size={17} /> {L(language, 'New entry', 'بطاقة جديدة')}
                </button>
            </div>

            {/* Tabs */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
                {TABS.map((item) => (
                    <button
                        key={item.key}
                        onClick={() => setTab(item.key)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${tab === item.key
                            ? 'bg-marine-cyan text-white'
                            : 'bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan/60'
                            }`}
                    >
                        {item.label}
                        {item.badge > 0 && (
                            <span className={`text-[11px] font-extrabold px-1.5 py-0.5 rounded-full tabular-nums ${tab === item.key
                                ? 'bg-white/20'
                                : item.highlight ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400' : 'bg-zinc-100 dark:bg-white/10'
                                }`}>
                                {item.badge}
                            </span>
                        )}
                    </button>
                ))}
                <div className="flex-1" />
                {!isWorklist && (
                    <div className="relative min-w-[220px]">
                        <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-zinc-400" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={L(language, 'Search title or part number…', 'ابحث بالعنوان أو رقم القطعة…')}
                            className="w-full bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg ps-9 pe-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white"
                        />
                    </div>
                )}
            </div>

            {/* Optional narrowing, collapsed by default so the tabs and the box stay the
                obvious things to do. The button carries a count when a filter is on, so an
                active filter is never hidden behind a closed panel. */}
            {!isWorklist && facets && (facets.categories?.length > 0 || facets.brands?.length > 0) && (
                <div className="mb-4">
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setFiltersOpen((v) => !v)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${
                                activeFilters > 0
                                    ? 'border-marine-cyan text-marine-primary bg-red-50 dark:bg-marine-cyan/10'
                                    : 'border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan'
                            }`}
                        >
                            <SlidersHorizontal size={14} />
                            {L(language, 'Filters', 'الفلاتر')}
                            {activeFilters > 0 && (
                                <span className="bg-marine-cyan text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]">
                                    {activeFilters}
                                </span>
                            )}
                        </button>
                        {activeFilters > 0 && (
                            <button
                                type="button"
                                onClick={() => { setCategoryId(''); setBrandId(''); }}
                                className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-xs font-bold text-zinc-500 hover:text-marine-primary"
                            >
                                <X size={13} /> {L(language, 'Clear', 'مسح')}
                            </button>
                        )}
                        <span className="text-[11px] text-zinc-400">
                            {L(language, 'Optional — narrows the list', 'اختياري — بيضيّق القايمة')}
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

            {error && (
                <div className="mb-4 flex items-center gap-2 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm">
                    <AlertCircle size={16} /> {error}
                </div>
            )}
            {notice && (
                <div className="mb-4 flex items-center justify-between gap-2 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-4 py-3 rounded-xl text-sm">
                    <span>{notice}</span>
                    <button onClick={() => setNotice('')}><X size={15} /></button>
                </div>
            )}

            {tab === 'unlinked' ? (
                <UnlinkedProductsPanel
                    language={language}
                    metadata={metadata}
                    onDone={() => { loadUnlinkedCount(); loadGapCounts(); }}
                />
            ) : tab === 'link_review' ? (
                <LinkReviewPanel language={language} onDone={() => { loadLinkReviewCount(); loadUnlinkedCount(); }} />
            ) : tab === 'gap_images' || tab === 'gap_brand' ? (
                <LinkedGapsPanel
                    key={tab}
                    language={language}
                    gap={tab === 'gap_images' ? 'images' : 'brand'}
                    onDone={loadGapCounts}
                />
            ) : loading ? (
                <div className="flex items-center justify-center py-20"><Loader2 size={30} className="animate-spin text-marine-primary" /></div>
            ) : data.entries.length === 0 ? (
                <div className="text-center py-16 bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl">
                    <Library size={30} className="text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
                    <p className="font-bold text-zinc-900 dark:text-white">
                        {activeFilters > 0
                            ? L(language, 'Nothing matches with these filters on.', 'مفيش نتايج مع الفلاتر دي.')
                            : tab === 'suggested'
                                ? L(language, 'No suggestions waiting.', 'لا توجد اقتراحات في الانتظار.')
                                : L(language, 'Nothing here yet.', 'لا يوجد شيء هنا بعد.')}
                    </p>
                    <p className="text-sm text-zinc-500 mt-1">
                        {tab === 'suggested'
                            ? L(language, 'Suggestions appear here when a vendor adds a product the catalog does not have.',
                                'تظهر الاقتراحات هنا عندما يضيف تاجر منتجاً غير موجود في الكتالوج.')
                            : L(language, 'Create an entry, or wait for vendor suggestions to arrive.',
                                'أنشئ بطاقة، أو انتظر وصول اقتراحات التجار.')}
                    </p>
                    {activeFilters > 0 && (
                        <button
                            type="button"
                            onClick={() => { setCategoryId(''); setBrandId(''); }}
                            className="mt-3 text-sm font-bold text-marine-primary hover:underline"
                        >
                            {L(language, 'Clear the filters', 'امسح الفلاتر')}
                        </button>
                    )}
                </div>
            ) : tab === 'suggested' ? (
                <div className="space-y-3">
                    {data.entries.map((entry) => (
                        <SuggestionReviewCard
                            key={entry._id}
                            entry={entry}
                            similar={similarById[entry._id]}
                            language={language}
                            onApprove={(edits) => act(
                                () => adminCatalogApi.approve(entry._id, edits),
                                L(language, 'Approved and added to the catalog.', 'تمت الموافقة وأُضيفت إلى الكتالوج.'),
                            )}
                            onMerge={(targetId) => act(
                                () => adminCatalogApi.merge(entry._id, targetId),
                                L(language, 'Merged — the vendor products moved across.', 'تم الدمج — انتقلت منتجات التجار.'),
                            )}
                            onReject={() => act(
                                () => adminCatalogApi.reject(entry._id),
                                L(language, 'Rejected — it will not be suggested again.', 'تم الرفض — مش هيتقترح تاني.'),
                            )}
                            metadata={metadata}
                        />
                    ))}
                </div>
            ) : (
                <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl divide-y divide-zinc-100 dark:divide-white/5 overflow-hidden">
                    {data.entries.map((entry) => (
                        <div key={entry._id} {...rowLink(`/admin/dashboard/catalog/${entry._id}`)} className="flex items-center gap-4 p-4 hover:bg-zinc-50 dark:hover:bg-white/[0.02] cursor-pointer">
                            <div className="w-14 h-14 rounded-lg bg-zinc-100 dark:bg-white/5 flex items-center justify-center overflow-hidden flex-shrink-0">
                                {entryImage(entry)
                                    ? <img src={entryImage(entry)} alt="" className="w-full h-full object-cover" />
                                    : <ImageOff size={18} className="text-zinc-400" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <Link href={`/admin/dashboard/catalog/${entry._id}`} className="font-semibold text-sm text-zinc-900 dark:text-white hover:text-marine-primary truncate block">
                                    {entryTitle(entry, language)}
                                </Link>
                                <p className="text-xs text-zinc-500 mt-0.5 truncate">
                                    {[entryCategoryName(entry, language), entryBrandName(entry), entry.part_number].filter(Boolean).join(' · ')}
                                </p>
                            </div>
                            <span className="hidden sm:flex items-center gap-1.5 text-xs font-semibold text-zinc-500 flex-shrink-0">
                                <Store size={13} /> {entry.product_count} {L(language, 'products', 'منتج')}
                            </span>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                                {tab === 'archived' || tab === 'rejected' ? (
                                    <button
                                        onClick={() => act(() => adminCatalogApi.restore(entry._id), tab === 'rejected' ? L(language, 'Back in the suggestions queue.', 'رجع لقائمة الاقتراحات.') : L(language, 'Restored.', 'تمت الاستعادة.'))}
                                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-emerald-500 hover:text-emerald-600"
                                    >
                                        <ArchiveRestore size={13} /> {L(language, 'Restore', 'استعادة')}
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => act(() => adminCatalogApi.archive(entry._id), L(language, 'Archived.', 'تمت الأرشفة.'))}
                                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-amber-500 hover:text-amber-600"
                                    >
                                        <Archive size={13} /> {L(language, 'Archive', 'أرشفة')}
                                    </button>
                                )}
                                {/* Hard delete only for an entry nothing points at —
                                    one click must never drop products out of analytics. */}
                                {entry.product_count === 0 && (
                                    <button
                                        onClick={() => {
                                            if (!confirm(L(language, 'Delete this entry permanently?', 'حذف هذه البطاقة نهائياً؟'))) return;
                                            act(() => adminCatalogApi.remove(entry._id), L(language, 'Entry deleted.', 'تم حذف البطاقة.'));
                                        }}
                                        className="p-2 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {data.pagination?.pages > 1 && (
                <div className="mt-4">
                    <PaginationControls
                        page={page}
                        pageSize={pageSize}
                        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
                        total={data.pagination.total}
                        onPageChange={setPage}
                        labels={isAr ? { showing: 'عرض', of: 'من', previous: 'السابق', next: 'التالي' } : {}}
                    />
                </div>
            )}

            {/* Create modal */}
            {creating && (
                <Overlay className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto" onMouseDown={() => !saving && setCreating(false)}>
                    <div className="w-full max-w-3xl my-8 bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-2xl shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-zinc-100 dark:border-white/5">
                            <h3 className="font-bold text-zinc-900 dark:text-white">{L(language, 'New catalog entry', 'بطاقة كتالوج جديدة')}</h3>
                            <button onClick={() => setCreating(false)} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-white"><X size={18} /></button>
                        </div>
                        <div className="p-5">
                            <CatalogEntryForm form={form} setForm={setForm} metadata={metadata} language={language} />
                        </div>
                        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-zinc-100 dark:border-white/5">
                            <button onClick={() => setCreating(false)} disabled={saving} className="px-5 py-2.5 rounded-xl text-sm font-semibold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 disabled:opacity-50">
                                {L(language, 'Cancel', 'إلغاء')}
                            </button>
                            <button onClick={handleCreate} disabled={saving} className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold bg-marine-cyan hover:bg-marine-cyan-dark text-white disabled:opacity-50">
                                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                                {L(language, 'Create entry', 'إنشاء البطاقة')}
                            </button>
                        </div>
                    </div>
                </Overlay>
            )}
        </div>
    );
}
