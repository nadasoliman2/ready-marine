'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from '../../LocaleLink';
import { Loader2, Search, ImageOff, ImageDown, Tag, ExternalLink, CheckCircle2, AlertCircle } from 'lucide-react';
import { adminCatalogApi } from '../../../lib/api';
import { L } from '../../../lib/catalog';
import PaginationControls from '../PaginationControls';
import usePageSize from '../../../lib/usePageSize';

/**
 * Linked products still missing what their catalog entry could give them.
 *
 *   gap = 'images'  the product has no picture
 *   gap = 'brand'   the product has no brand
 *
 * A data-entry worklist: rows whose entry can fill the gap come first and carry a
 * one-press import; the rest say why not and link to the product so it can be fixed by
 * hand. A row disappears from the list the moment it is fixed.
 */
export default function LinkedGapsPanel({ language, gap, onDone }) {
    const isImages = gap === 'images';
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = usePageSize(`admin.catalog.gaps.${gap}`, 20);
    const [data, setData] = useState({ products: [], pagination: { pages: 1, total: 0 }, importable: 0 });
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setData(await adminCatalogApi.listLinkedGaps({ gap, q: search.trim(), page, limit: pageSize }));
        } catch (err) {
            setError(err.message || L(language, 'Could not load the list.', 'تعذر تحميل القائمة.'));
        } finally {
            setLoading(false);
        }
    }, [gap, search, page, pageSize, language]);

    useEffect(() => {
        const id = setTimeout(load, search ? 300 : 0);
        return () => clearTimeout(id);
    }, [load, search]);

    useEffect(() => { setPage(1); }, [gap, search]);

    const importOne = async (product) => {
        setBusyId(String(product._id));
        setError('');
        setNotice('');
        try {
            if (isImages) await adminCatalogApi.importProductImagesFromEntry(product._id);
            else await adminCatalogApi.importProductBrandFromEntry(product._id);
            const title = product.title_ar || product.title_en || '';
            setNotice(isImages
                ? L(language, `Images imported for "${title}".`, `تم استيراد الصور لـ "${title}".`)
                : L(language, `Brand imported for "${title}".`, `تم استيراد البراند لـ "${title}".`));
            await load();
            onDone?.();
        } catch (err) {
            setError(err.message || L(language, 'Import failed.', 'تعذر الاستيراد.'));
        } finally {
            setBusyId('');
        }
    };

    const titleOf = (p) => (language === 'ar' ? (p.title_ar || p.title_en) : (p.title_en || p.title_ar)) || '—';
    const entryPic = (e) => (e?.images || []).find((i) => i.is_primary)?.url || e?.images?.[0]?.url || '';

    return (
        <div>
            <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                <p className="text-sm text-zinc-500">
                    {isImages
                        ? L(language,
                            `Linked products with no picture. ${data.importable} of them can take the catalog image with one press.`,
                            `منتجات مربوطة بالكاتالوج ومفيهاش صور. ${data.importable} منهم ممكن ياخدوا صورة الكاتالوج بضغطة واحدة.`)
                        : L(language,
                            `Linked products with no brand. ${data.importable} of them can take the catalog brand with one press.`,
                            `منتجات مربوطة بالكاتالوج ومفيهاش ماركة. ${data.importable} منهم ممكن ياخدوا ماركة الكاتالوج بضغطة واحدة.`)}
                </p>
                <div className="relative min-w-[240px]">
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

            {error && (
                <div className="mb-4 flex items-center gap-2 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm">
                    <AlertCircle size={15} /> {error}
                </div>
            )}
            {notice && (
                <div className="mb-4 flex items-center gap-2 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-4 py-3 rounded-xl text-sm">
                    <CheckCircle2 size={15} /> {notice}
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-20"><Loader2 size={30} className="animate-spin text-marine-primary" /></div>
            ) : data.products.length === 0 ? (
                <div className="text-center py-16 bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl">
                    <CheckCircle2 size={30} className="text-emerald-400 mx-auto mb-3" />
                    <p className="font-bold text-zinc-900 dark:text-white">
                        {search
                            ? L(language, 'Nothing matches this search.', 'مفيش نتايج للبحث ده.')
                            : isImages
                                ? L(language, 'Every linked product has a picture.', 'كل المنتجات المربوطة عليها صور.')
                                : L(language, 'Every linked product has a brand.', 'كل المنتجات المربوطة عليها ماركة.')}
                    </p>
                </div>
            ) : (
                <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl divide-y divide-zinc-100 dark:divide-white/5">
                    {data.products.map((p) => {
                        const pic = p.images?.[0]?.url;
                        const ePic = entryPic(p.entry);
                        const busy = busyId === String(p._id);
                        return (
                            <div key={p._id} className="p-4 flex flex-col lg:flex-row lg:items-center gap-4">
                                {/* The product */}
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                    <div className="w-12 h-12 rounded-lg bg-zinc-100 dark:bg-white/5 flex items-center justify-center overflow-hidden flex-shrink-0">
                                        {pic ? <img src={pic} alt="" className="w-full h-full object-cover" /> : <ImageOff size={16} className="text-zinc-400" />}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-bold text-sm text-zinc-900 dark:text-white truncate">{titleOf(p)}</p>
                                        <p className="text-xs text-zinc-500 truncate">
                                            {[p.vendor?.store_name, p.sku, p.status === 'draft' ? L(language, 'draft', 'مسودة') : null].filter(Boolean).join(' · ')}
                                        </p>
                                    </div>
                                </div>

                                {/* What the entry can give */}
                                <div className="flex items-center gap-3 lg:w-72 min-w-0">
                                    {isImages ? (
                                        <div className="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-white/5 flex items-center justify-center overflow-hidden flex-shrink-0">
                                            {ePic ? <img src={ePic} alt="" className="w-full h-full object-cover" /> : <ImageOff size={14} className="text-zinc-400" />}
                                        </div>
                                    ) : (
                                        <Tag size={16} className={p.can_import ? 'text-emerald-500' : 'text-zinc-300'} />
                                    )}
                                    <div className="min-w-0">
                                        <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-400">{L(language, 'Catalog entry', 'بطاقة الكاتالوج')}</p>
                                        <p className="text-xs text-zinc-700 dark:text-zinc-300 truncate">
                                            {p.can_import
                                                ? (isImages
                                                    ? L(language, `${p.entry?.images?.length || 0} image(s) available`, `فيها ${p.entry?.images?.length || 0} صورة`)
                                                    : (p.entry?.brand_name || L(language, 'brand available', 'فيها ماركة')))
                                                : (isImages
                                                    ? L(language, 'has no image either', 'مفيهاش صور هي كمان')
                                                    : L(language, 'has no brand either', 'مفيهاش ماركة هي كمان'))}
                                        </p>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                                    <button
                                        type="button"
                                        disabled={!p.can_import || !!busyId}
                                        onClick={() => importOne(p)}
                                        title={!p.can_import ? L(language, 'The catalog entry has nothing to import', 'بطاقة الكاتالوج مفيهاش حاجة تتستورد') : undefined}
                                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-marine-cyan text-white hover:bg-marine-cyan-dark disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        {busy ? <Loader2 size={13} className="animate-spin" /> : isImages ? <ImageDown size={13} /> : <Tag size={13} />}
                                        {isImages ? L(language, 'Import image', 'استيراد الصورة') : L(language, 'Import brand', 'استيراد الماركة')}
                                    </button>
                                    <Link
                                        href={`/admin/dashboard/products/${p._id}`}
                                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan hover:text-marine-primary"
                                    >
                                        {L(language, 'Open product', 'فتح المنتج')} <ExternalLink size={12} />
                                    </Link>
                                    {p.entry?._id && (
                                        <Link
                                            href={`/admin/dashboard/catalog/${p.entry._id}`}
                                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan hover:text-marine-primary"
                                        >
                                            {L(language, 'Open entry', 'فتح البطاقة')} <ExternalLink size={12} />
                                        </Link>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {!loading && data.pagination?.pages > 1 && (
                <div className="mt-4">
                    <PaginationControls
                        page={data.pagination.page}
                        pageSize={pageSize}
                        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
                        total={data.pagination.total}
                        onPageChange={setPage}
                        labels={language === 'ar' ? { showing: 'عرض', of: 'من', previous: 'السابق', next: 'التالي' } : {}}
                    />
                </div>
            )}
        </div>
    );
}
