'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ImageOff, Link2Off, Search, Check, ShieldAlert, AlertCircle, X, ArrowLeft, Store, ExternalLink } from 'lucide-react';
import Link from '../../LocaleLink';
import { adminCatalogApi } from '../../../lib/api';
import { L, entryTitle, entryImage } from '../../../lib/catalog';
import { conflictText, levelClass, levelLabel, reasonText } from '../../../lib/catalogMatch';
import CatalogSinglePickerModal from './CatalogSinglePickerModal';
import PaginationControls from '../PaginationControls';

/**
 * Products linked to a catalog entry they do not read like — another brand, another car,
 * front against rear, another size, or simply nothing in common. Most were linked by hand
 * before the matcher existed; a few will be right after all.
 *
 * Three ways out, each one press: unlink, link to the right entry, or keep — "keep" takes a
 * link off this list until its entry is edited.
 */
export default function LinkReviewPanel({ language, onDone }) {
    const isAr = language === 'ar';
    const [page, setPage] = useState(1);
    const [data, setData] = useState({ links: [], pagination: { total: 0, page: 1, pages: 1 } });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busyId, setBusyId] = useState(null);
    const [picking, setPicking] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setData(await adminCatalogApi.linkReview({ page, limit: 20 }));
        } catch (err) {
            setError(err.message || L(language, 'Could not load the list.', 'تعذر تحميل القائمة.'));
        } finally {
            setLoading(false);
        }
    }, [page, language]);

    useEffect(() => { load(); }, [load]);

    const act = async (productId, fn, message) => {
        setBusyId(productId);
        setError('');
        try {
            await fn();
            setNotice(message);
            await load();
            onDone?.();
        } catch (err) {
            setError(err.message || L(language, 'That did not work.', 'لم تنجح العملية.'));
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div>
            <p className="text-xs text-zinc-500 mb-4 flex items-center gap-1.5">
                <ShieldAlert size={14} className="text-amber-500" />
                {L(language,
                    'Linked products that do not read like their catalog entry. Contradictions first, weak resemblances after.',
                    'منتجات مربوطة ببطاقة مش شبهها — التناقضات الواضحة الأول، وبعدها الشبه الضعيف.')}
            </p>

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
            ) : data.links.length === 0 ? (
                <div className="text-center py-16 bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl">
                    <Check size={30} className="text-emerald-500 mx-auto mb-3" />
                    <p className="font-bold text-zinc-900 dark:text-white">{L(language, 'Every link reads right.', 'كل الروابط سليمة.')}</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {data.links.map((row) => (
                        <div key={row.product._id} className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-4">
                            <div className="flex flex-wrap items-center gap-1.5 mb-3">
                                {row.conflicts.length > 0 ? row.conflicts.map((c) => (
                                    <span key={c} className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-500/20">
                                        {conflictText(c, language)}
                                    </span>
                                )) : (
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${levelClass(row.level)}`}>
                                        {L(language, 'Weak resemblance', 'شبه ضعيف')} · {Math.round(row.score * 100)}%
                                    </span>
                                )}
                                {row.reasons.map((r) => (
                                    <span key={r.key} className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-zinc-500">
                                        {reasonText(r, language)}
                                    </span>
                                ))}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-3">
                                {renderSide(row.product, { language, label: L(language, 'Vendor product', 'منتج التاجر'), href: `/admin/dashboard/products/${row.product._id}`, store: row.product.vendor?.store_name })}
                                <ArrowLeft size={16} className={`hidden md:block text-zinc-400 ${isAr ? '' : 'rotate-180'}`} />
                                {renderSide(row.entry, { language, label: L(language, 'Linked catalog entry', 'بطاقة الكتالوج المربوط بيها'), href: `/admin/dashboard/catalog/${row.entry._id}` })}
                            </div>

                            <div className="flex flex-wrap items-center justify-end gap-2 mt-3 pt-3 border-t border-zinc-100 dark:border-white/5">
                                <button
                                    type="button"
                                    disabled={busyId === row.product._id}
                                    onClick={() => act(row.product._id, () => adminCatalogApi.keepLink(row.product._id), L(language, 'Kept — it will not be questioned again.', 'تم الإبقاء — مش هيتسأل عنه تاني.'))}
                                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-emerald-500 hover:text-emerald-600 disabled:opacity-50"
                                >
                                    <Check size={13} /> {L(language, 'The link is right', 'الربط صح')}
                                </button>
                                <button
                                    type="button"
                                    disabled={busyId === row.product._id}
                                    onClick={() => setPicking(row.product)}
                                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan hover:text-marine-primary disabled:opacity-50"
                                >
                                    <Search size={13} /> {L(language, 'Link to another entry', 'اربط ببطاقة تانية')}
                                </button>
                                <button
                                    type="button"
                                    disabled={busyId === row.product._id}
                                    onClick={() => act(row.product._id, () => adminCatalogApi.relinkProduct(row.product._id, null), L(language, 'Unlinked.', 'تم إلغاء الربط.'))}
                                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-marine-cyan hover:bg-marine-cyan-dark text-white disabled:opacity-50"
                                >
                                    {busyId === row.product._id ? <Loader2 size={13} className="animate-spin" /> : <Link2Off size={13} />}
                                    {L(language, 'Unlink', 'إلغاء الربط')}
                                </button>
                            </div>
                        </div>
                    ))}

                    <PaginationControls
                        page={data.pagination.page}
                        pageSize={20}
                        total={data.pagination.total}
                        onPageChange={setPage}
                        labels={isAr ? { showing: 'عرض', of: 'من', previous: 'السابق', next: 'التالي' } : {}}
                    />
                </div>
            )}

            {picking && (
                <CatalogSinglePickerModal
                    language={language}
                    title={L(language, 'Link this product to…', 'اربط هذا المنتج بـ…')}
                    searchFn={(term, filters) => adminCatalogApi.list({ status: 'all', q: term, limit: 24, ...filters })}
                    facetsFn={(params) => adminCatalogApi.filters('', params)}
                    onPick={(entry) => act(picking._id, () => adminCatalogApi.relinkProduct(picking._id, String(entry._id)), L(language, 'Relinked.', 'تم تغيير الربط.'))}
                    onClose={() => setPicking(null)}
                />
            )}
        </div>
    );
}

/** One side of a link: the vendor's product, or the entry it points at. */
function renderSide(item, { language, label, href, store }) {
    return (
        <div className="flex items-center gap-3 min-w-0 rounded-xl bg-zinc-50 dark:bg-white/[0.03] p-3">
            <div className="w-12 h-12 rounded-lg bg-zinc-100 dark:bg-white/5 flex items-center justify-center overflow-hidden flex-shrink-0">
                {entryImage(item) ? <img src={entryImage(item)} alt="" className="w-full h-full object-cover" /> : <ImageOff size={15} className="text-zinc-400" />}
            </div>
            <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</p>
                <p className="text-sm font-semibold text-zinc-900 dark:text-white line-clamp-2" title={entryTitle(item, language)}>{entryTitle(item, language) || '—'}</p>
                <p className="text-[11px] text-zinc-500 flex items-center gap-2">
                    {store && <span className="flex items-center gap-1"><Store size={10} /> {store}</span>}
                    {item.part_number && <span className="font-mono">{item.part_number}</span>}
                </p>
            </div>
            <Link href={href} target="_blank" className="text-zinc-400 hover:text-marine-primary flex-shrink-0"><ExternalLink size={14} /></Link>
        </div>
    );
}
