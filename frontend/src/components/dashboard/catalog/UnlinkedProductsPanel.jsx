'use client';

import { useCallback, useEffect, useState } from 'react';
import useDependentFacets from './useDependentFacets';
import {
    Loader2, Search, ImageOff, Link2, Sparkles, AlertCircle, X, Save, Store, Tag, ArrowLeft, SlidersHorizontal, EyeOff, Wand2,
} from 'lucide-react';
import { adminCatalogApi } from '../../../lib/api';
import { L } from '../../../lib/catalog';
import CatalogEntryForm, { formStateToPayload } from './CatalogEntryForm';
import CatalogSinglePickerModal from './CatalogSinglePickerModal';
import PaginationControls from '../PaginationControls';
import usePageSize from '../../../lib/usePageSize';
import SearchableSelect from '../../SearchableSelect';
import MatchSuggestions from './MatchSuggestions';

/**
 * Vendor products that never got attached to a catalog entry.
 *
 * Two ways out of this list, and they are deliberately different jobs:
 *
 *   Publish as template — this product IS a product the catalog is missing. Its
 *       data is loaded into the entry form, the admin fixes whatever is wrong,
 *       and publishing mints an approved entry and links the product to it.
 *   Link to existing   — the catalog already describes this; just attach it.
 *
 * Either way, a DRAFT product has its blank fields topped up from the entry and
 * stays a draft. Completing a listing is a favour to the vendor; publishing it
 * is their decision, so nothing here changes a product's status.
 *
 * Each product carries the catalog matcher's proposals (services/catalogMatchService.js):
 * the entries it most likely is, how sure, and why — linked with one press. "Sure matches
 * first" narrows the list to the products that have one, the surest on top.
 *
 * The gap chips separate what the catalog can fix from what only the vendor can.
 * A product with no price will not go live no matter what template it gets, and
 * showing that as "one more missing field" would send the admin on an errand
 * that cannot succeed.
 */
export default function UnlinkedProductsPanel({ language, metadata, onDone }) {
    const isAr = language === 'ar';

    // The worklist only ever holds published, complete products now (the server enforces
    // it); the chip row is gone and this stays fixed for the API's sake.
    const [status] = useState('published');
    const [search, setSearch] = useState('');
    // Optional narrowing, same shape as the catalog tabs — but the lists come from the
    // products on this worklist, not from catalog entries.
    const [categoryId, setCategoryId] = useState('');
    const [brandId, setBrandId] = useState('');
    const [filtersOpen, setFiltersOpen] = useState(false);
    // '' = every product, newest first; 'likely' = only those with a sure proposal, surest first.
    const [withMatch, setWithMatch] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = usePageSize('admin.catalog.unlinked', 20);
    const [data, setData] = useState({ products: [], pagination: { pages: 1, total: 0 }, counts: {} });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    // The product being turned into a template, with the form the admin edits.
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(null);
    const [saving, setSaving] = useState(false);

    // The product being attached to an entry that already exists.
    const [picking, setPicking] = useState(null);

    // The matcher's proposals for the products on this page, in one request: { productId: [entry…] }.
    const [matchesById, setMatchesById] = useState({});
    const [linkingId, setLinkingId] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setData(await adminCatalogApi.listUnlinked({
                status,
                q: search.trim(),
                category_id: categoryId || undefined,
                product_brand_id: brandId || undefined,
                with_match: withMatch || undefined,
                page,
                limit: pageSize,
            }));
        } catch (err) {
            setError(err.message || L(language, 'Could not load the list.', 'تعذر تحميل القائمة.'));
        } finally {
            setLoading(false);
        }
    }, [status, search, categoryId, brandId, withMatch, page, language, pageSize]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { setPage(1); }, [status, search, categoryId, brandId, withMatch]);

    useEffect(() => {
        const ids = (data.products || []).map((p) => p._id);
        setMatchesById({});
        if (!ids.length) return undefined;
        let alive = true;
        adminCatalogApi.matchProducts(ids)
            .then((res) => { if (alive) setMatchesById(res.matches || {}); })
            .catch(() => { if (alive) setMatchesById(Object.fromEntries(ids.map((id) => [id, []]))); });
        return () => { alive = false; };
    }, [data.products]);

    // Reloaded per status chip so the counts describe the list being looked at, and per
    // selection so each list narrows to fit the other.
    const facets = useDependentFacets({
        load: (params) => adminCatalogApi.unlinkedFilters(status, params),
        categoryId,
        brandId,
        setCategoryId,
        setBrandId,
        reloadKey: status,
    });

    const title = (p) => (isAr ? (p.title_ar || p.title_en) : (p.title_en || p.title_ar)) || '—';

    /* ---- open the "publish as template" form, prefilled from the product ---- */
    const startPublish = async (product) => {
        setError('');
        try {
            const { draft } = await adminCatalogApi.getProductDraft(product._id);
            setForm(draft);
            setEditing(product);
        } catch (err) {
            setError(err.message || L(language, 'Could not open that product.', 'تعذر فتح هذا المنتج.'));
        }
    };

    const confirmPublish = async () => {
        if (!form.title_en?.trim() && !form.title_ar?.trim()) {
            setError(L(language, 'A title in English or Arabic is required.', 'العنوان مطلوب بالإنجليزية أو العربية.'));
            return;
        }
        if (!form.category_id) {
            setError(L(language, 'A category is required.', 'التصنيف مطلوب.'));
            return;
        }
        setSaving(true);
        setError('');
        try {
            const res = await adminCatalogApi.publishProductAsEntry(editing._id, formStateToPayload(form));
            setNotice(describeResult(res, language));
            setEditing(null);
            setForm(null);
            await load();
            onDone?.();
        } catch (err) {
            setError(err.message || L(language, 'Could not publish the template.', 'تعذر نشر البطاقة.'));
        } finally {
            setSaving(false);
        }
    };

    /* ---- attach to an entry the catalog already has ---- */
    const linkToExisting = async (product, entry) => {
        setError('');
        setLinkingId(product._id);
        try {
            const res = await adminCatalogApi.linkUnlinkedProduct(product._id, entry._id);
            setNotice(describeResult(res, language));
            await load();
            onDone?.();
        } catch (err) {
            setError(err.message || L(language, 'Could not link the product.', 'تعذر ربط المنتج.'));
        } finally {
            setLinkingId(null);
        }
    };

    const dismiss = async (p) => {
        if (!window.confirm(L(language, 'Hide this product from the worklist for good?', 'إخفاء المنتج ده من القائمة نهائياً؟'))) return;
        setError('');
        try {
            await adminCatalogApi.dismissUnlinkedProduct(p._id);
            setNotice(L(language, 'Dismissed — it will not be offered again.', 'تم التجاهل — مش هيظهر تاني.'));
            load();
            onDone?.();
        } catch (err) {
            setError(err.message || L(language, 'Could not dismiss the product.', 'تعذر تجاهل المنتج.'));
        }
    };

    /* ---- the entry form, shown in place of the list ---- */
    if (editing && form) {
        return (
            <div>
                <button
                    onClick={() => { setEditing(null); setForm(null); setError(''); }}
                    className="flex items-center gap-2 text-sm font-bold text-zinc-500 hover:text-marine-primary mb-4"
                >
                    <ArrowLeft size={16} className={isAr ? 'rotate-180' : ''} />
                    {L(language, 'Back to the list', 'رجوع للقائمة')}
                </button>

                <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5 mb-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-white mb-1">
                        <Sparkles size={16} className="text-marine-primary" />
                        {L(language, 'Publishing this product as a catalog template', 'نشر هذا المنتج كبطاقة في الكتالوج')}
                    </div>
                    <p className="text-sm text-zinc-500">
                        {L(language,
                            'Edit anything that is wrong before publishing. The template goes live approved and this product is linked to it. The vendor’s own listing is not rewritten — if it is a draft, only its empty fields are filled in, and it stays a draft for the vendor to submit.',
                            'عدّل أي شيء غير صحيح قبل النشر. تُنشر البطاقة معتمدة ويُربط بها هذا المنتج. لا يُعاد كتابة منتج التاجر — إن كان مسودة تُملأ حقوله الفارغة فقط، ويظل مسودة ليرسله التاجر بنفسه.')}
                    </p>
                    <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
                        <Store size={13} /> {editing.vendor_id?.store_name || editing.vendor_id?.name || '—'}
                        <span className="text-zinc-300 dark:text-zinc-700">·</span>
                        <span className="font-mono">{editing.sku || editing.part_number || '—'}</span>
                    </div>
                </div>

                {error && (
                    <div className="mb-4 flex items-center gap-2 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm">
                        <AlertCircle size={16} /> {error}
                    </div>
                )}

                <CatalogEntryForm form={form} setForm={setForm} metadata={metadata} language={language} />

                <div className="flex items-center justify-end gap-2 mt-5">
                    <button
                        onClick={() => { setEditing(null); setForm(null); setError(''); }}
                        className="px-4 py-2.5 rounded-lg text-sm font-bold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300"
                    >
                        {L(language, 'Cancel', 'إلغاء')}
                    </button>
                    <button
                        onClick={confirmPublish}
                        disabled={saving}
                        className="flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-60 text-white px-5 py-2.5 rounded-lg text-sm font-bold shadow-sm"
                    >
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        {L(language, 'Publish template & link', 'انشر البطاقة واربط')}
                    </button>
                </div>
            </div>
        );
    }

    /* ---- the worklist ---- */
    const activeFilters = (categoryId ? 1 : 0) + (brandId ? 1 : 0);

    return (
        <div>
            <div className="flex flex-wrap items-center gap-2 mb-4">
                <p className="text-xs text-zinc-500">
                    {L(language, 'Published products with complete data and no catalog entry', 'منتجات منشورة وبياناتها كاملة وليس لها بطاقة في الكتالوج')}
                    {data.counts?.all > 0 && <span className="tabular-nums font-bold text-zinc-700 dark:text-zinc-200 ms-1">({data.counts.all})</span>}
                </p>
                <div className="flex-1" />
                <button
                    type="button"
                    onClick={() => setWithMatch((v) => (v ? '' : 'likely'))}
                    title={L(language, 'Only the products the catalog has a sure match for, surest first', 'المنتجات اللي ليها تطابق أكيد في الكتالوج بس، الأقوى الأول')}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${
                        withMatch
                            ? 'border-marine-cyan text-marine-primary bg-red-50 dark:bg-marine-cyan/10'
                            : 'border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan'
                    }`}
                >
                    <Wand2 size={14} /> {L(language, 'Sure matches first', 'التطابقات الأكيدة الأول')}
                </button>
                <div className="relative min-w-[220px]">
                    <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-zinc-400" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={L(language, 'Search title, SKU or part number…', 'ابحث بالعنوان أو SKU أو رقم القطعة…')}
                        className="w-full bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg ps-9 pe-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white"
                    />
                </div>
            </div>

            {/* Optional narrowing. Collapsed by default, with the count on the button so an
                active filter is never hidden behind a closed panel. */}
            {facets && (facets.categories?.length > 0 || facets.brands?.length > 0) && (
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

            {loading ? (
                <div className="flex items-center justify-center py-20"><Loader2 size={30} className="animate-spin text-marine-primary" /></div>
            ) : data.products.length === 0 ? (
                <div className="text-center py-16 bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl">
                    <Link2 size={30} className="text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
                    <p className="font-bold text-zinc-900 dark:text-white">
                        {L(language, 'Everything here is linked.', 'كل شيء هنا مربوط.')}
                    </p>
                    <p className="text-sm text-zinc-500 mt-1">
                        {L(language, 'Vendor products with no catalog entry show up in this list.',
                            'تظهر هنا منتجات التجار غير المرتبطة ببطاقة في الكتالوج.')}
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {data.products.map((p) => (
                        <div key={p._id} className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-4">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                            <div className="w-14 h-14 shrink-0 rounded-xl overflow-hidden bg-zinc-100 dark:bg-white/5 flex items-center justify-center">
                                {p.images?.[0]?.url
                                    ? <img src={p.images[0].url} alt="" className="w-full h-full object-cover" />
                                    : <ImageOff size={18} className="text-zinc-400" />}
                            </div>

                            <div className="flex-1 min-w-0">
                                <p className="font-bold text-zinc-900 dark:text-white truncate">{title(p)}</p>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-zinc-500">
                                    <span className="flex items-center gap-1"><Store size={12} />{p.vendor_id?.store_name || p.vendor_id?.name || '—'}</span>
                                    {p.category_id?.name && <span className="flex items-center gap-1"><Tag size={12} />{isAr ? (p.category_id.name_ar || p.category_id.name) : p.category_id.name}</span>}
                                    {(p.sku || p.part_number) && <span className="font-mono">{p.sku || p.part_number}</span>}
                                    <StatusChip status={p.status} language={language} />
                                </div>
                                <GapChips gaps={p.gaps} language={language} />
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    onClick={() => setPicking(p)}
                                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-200 hover:border-marine-cyan/60"
                                >
                                    <Link2 size={14} /> {L(language, 'Link to existing', 'اربط ببطاقة موجودة')}
                                </button>
                                <button
                                    onClick={() => startPublish(p)}
                                    className="flex items-center gap-1.5 bg-marine-cyan hover:bg-marine-cyan-dark text-white px-3 py-2 rounded-lg text-xs font-bold"
                                >
                                    <Sparkles size={14} /> {L(language, 'Publish as template', 'انشر كبطاقة')}
                                </button>
                                <button
                                    onClick={() => dismiss(p)}
                                    title={L(language, 'Not catalog material — hide for good', 'مش للكتالوج — إخفاء نهائي')}
                                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-zinc-200 dark:border-white/10 text-zinc-500 hover:border-red-500 hover:text-red-600"
                                >
                                    <EyeOff size={14} /> {L(language, 'Dismiss', 'تجاهل')}
                                </button>
                            </div>
                        </div>
                        {/* The catalog matcher's proposals for this product, ready to link. */}
                        {(matchesById[p._id] == null || matchesById[p._id].length > 0) && (
                            <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-white/5">
                                <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2 flex items-center gap-1">
                                    <Wand2 size={11} />
                                    {matchesById[p._id] == null
                                        ? L(language, 'Link suggestions', 'اقتراحات الربط')
                                        : matchesById[p._id].some((m) => m.level === 'strong' || m.level === 'likely')
                                            ? L(language, 'Probably this catalog entry', 'غالباً هو البطاقة دي')
                                            : L(language, 'No sure match — only weak possibilities', 'مفيش تطابق أكيد — احتمالات ضعيفة بس')}
                                </p>
                                <MatchSuggestions
                                    matches={matchesById[p._id] ?? null}
                                    language={language}
                                    busy={linkingId === p._id}
                                    actionLabel={L(language, 'Link', 'اربط')}
                                    actionIcon={Link2}
                                    onPick={(entry) => linkToExisting(p, entry)}
                                />
                            </div>
                        )}
                        </div>
                    ))}

                    <PaginationControls
                        page={data.pagination.page}
                        pageSize={pageSize}
                        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
                        total={data.pagination.total}
                        onPageChange={setPage}
                        labels={isAr ? { showing: 'عرض', of: 'من', previous: 'السابق', next: 'التالي' } : {}}
                    />
                </div>
            )}

            {picking && (
                <CatalogSinglePickerModal
                    language={language}
                    title={L(language, 'Which catalog entry is this product?', 'أي بطاقة في الكتالوج يقابلها هذا المنتج؟')}
                    searchFn={(term, filters) => adminCatalogApi.list({ status: 'all', q: term, limit: 24, ...filters })}
                    facetsFn={(params) => adminCatalogApi.filters('', params)}
                    onPick={(entry) => linkToExisting(picking, entry)}
                    onClose={() => setPicking(null)}
                />
            )}
        </div>
    );
}

/** What the link actually did, in the admin's terms. */
function describeResult(res, language) {
    const filled = res.filled?.length || 0;
    if (!filled) return L(language, 'Product linked.', 'تم ربط المنتج.');
    return L(language,
        `Product linked, and ${filled} empty field${filled === 1 ? '' : 's'} filled from the template. It stays a draft for the vendor to submit.`,
        `تم ربط المنتج وملء ${filled} حقل فارغ من البطاقة. يظل مسودة ليرسله التاجر.`);
}

function StatusChip({ status, language }) {
    const map = {
        draft: { label: L(language, 'Draft', 'مسودة'), cls: 'bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300' },
        pending: { label: L(language, 'Pending', 'قيد المراجعة'), cls: 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400' },
        published: { label: L(language, 'Published', 'منشور'), cls: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' },
    };
    const s = map[status] || map.draft;
    return <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold ${s.cls}`}>{s.label}</span>;
}

/**
 * What is still missing, split by who owns it. The vendor-owned column is the
 * important half: a template cannot supply a price, so an admin should not go
 * looking for one here.
 */
function GapChips({ gaps, language }) {
    if (!gaps) return null;
    const names = {
        text: L(language, 'title / subtitle / description', 'العنوان / الوصف'),
        category: L(language, 'category', 'التصنيف'),
        images: L(language, 'images', 'الصور'),
        price: L(language, 'price', 'السعر'),
    };

    if (gaps.ready_to_publish) {
        return (
            <p className="mt-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                {L(language, 'Complete — waiting on the vendor to submit it.', 'مكتمل — بانتظار إرسال التاجر له.')}
            </p>
        );
    }

    return (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {gaps.missing_from_catalog.map((k) => (
                <span key={k} className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400">
                    {L(language, `missing ${names[k]} — a template fills this`, `ناقص ${names[k]} — البطاقة تملؤه`)}
                </span>
            ))}
            {gaps.missing_from_vendor.map((k) => (
                <span key={k} className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400">
                    {L(language, `missing ${names[k]} — only the vendor can set this`, `ناقص ${names[k]} — لا يضبطه إلا التاجر`)}
                </span>
            ))}
        </div>
    );
}
