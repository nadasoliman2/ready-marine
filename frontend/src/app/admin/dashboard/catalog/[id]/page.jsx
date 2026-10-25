'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from '../../../../../components/LocaleLink';
import { useParams, useRouter } from '../../../../../lib/navigation';
import {
    ArrowLeft, Loader2, ImageOff, Save, Pencil, Archive, ArchiveRestore, Trash2,
    Store, TrendingDown, TrendingUp, Sigma, Boxes, ShoppingBag, AlertCircle, X,
} from 'lucide-react';
import { adminCatalogApi } from '../../../../../lib/api';
import { useApp } from '../../../../../context/AppContext';
import { L, entryTitle, entryImage, entryCategoryName, entryBrandName } from '../../../../../lib/catalog';
import { fetchProductMetadata } from '../../../../../lib/productForm';
import CatalogEntryForm, { entryToFormState, formStateToPayload } from '../../../../../components/dashboard/catalog/CatalogEntryForm';
import useRowLink from '../../../../../lib/useRowLink';

/**
 * One catalog entry: what it is, and who sells it for how much.
 *
 * The vendors table is the reason the whole feature exists — "which merchants
 * carry this product, and at what price" — and it is admin-only on purpose:
 * showing it to vendors would invite a price war and give them a reason to stop
 * linking altogether.
 */

const STATUS_STYLES = {
    approved: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
    suggested: 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400',
    archived: 'bg-zinc-200 dark:bg-white/10 text-zinc-600 dark:text-zinc-300',
    merged: 'bg-zinc-200 dark:bg-white/10 text-zinc-600 dark:text-zinc-300',
};

function StatCard({ icon: Icon, label, value, tone = 'text-zinc-900 dark:text-white' }) {
    return (
        <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-xl px-4 py-3">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                <Icon size={12} /> {label}
            </p>
            <p className={`text-xl font-bold mt-1 tabular-nums ${tone}`}>{value}</p>
        </div>
    );
}

export default function AdminCatalogEntryPage() {
    const rowLink = useRowLink();
    const { id } = useParams();
    const router = useRouter();
    const { language, siteSettings } = useApp();
    const isAr = language === 'ar';
    const currency = siteSettings?.currency || 'QAR';

    const [detail, setDetail] = useState(null);
    const [metadata, setMetadata] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState(null);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await adminCatalogApi.get(id);
            setDetail(data);
            setForm(entryToFormState(data.entry));
        } catch (err) {
            setError(err.message || L(language, 'Could not load this entry.', 'تعذر تحميل هذه البطاقة.'));
        } finally {
            setLoading(false);
        }
    }, [id, language]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        fetchProductMetadata().then(setMetadata).catch(() => { /* form degrades gracefully */ });
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

    const handleSave = async () => {
        setSaving(true);
        setError('');
        try {
            await adminCatalogApi.update(id, formStateToPayload(form));
            setEditing(false);
            setNotice(L(language,
                'Saved. Products already linked keep the copy they were created with.',
                'تم الحفظ. المنتجات المرتبطة تحتفظ بالنسخة التي أُنشئت بها.'));
            await load();
        } catch (err) {
            setError(err.message || L(language, 'Could not save.', 'تعذر الحفظ.'));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="flex items-center justify-center py-24"><Loader2 size={30} className="animate-spin text-marine-primary" /></div>;
    }
    if (!detail) {
        return (
            <div className="text-center py-20">
                <p className="text-zinc-500">{error || L(language, 'Entry not found.', 'البطاقة غير موجودة.')}</p>
                <Link href="/admin/dashboard/catalog" className="text-marine-primary font-bold text-sm mt-3 inline-block">
                    {L(language, 'Back to the catalog', 'العودة للكتالوج')}
                </Link>
            </div>
        );
    }

    const { entry, vendors, stats } = detail;
    const money = (value) => (value === null || value === undefined ? '—' : `${currency} ${Number(value).toLocaleString()}`);

    return (
        <div className="animate-in fade-in duration-300 pb-10">
            <div className="flex items-start gap-4 mb-6">
                <Link href="/admin/dashboard/catalog" className="p-2 mt-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-white bg-white dark:bg-[#14171A] rounded-lg border border-zinc-200 dark:border-white/10">
                    <ArrowLeft size={18} className="rtl:rotate-180" />
                </Link>
                <div className="w-16 h-16 rounded-xl bg-zinc-100 dark:bg-white/5 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {entryImage(entry)
                        ? <img src={entryImage(entry)} alt="" className="w-full h-full object-cover" />
                        : <ImageOff size={20} className="text-zinc-400" />}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <h1 className="text-xl font-bold text-zinc-900 dark:text-white truncate">{entryTitle(entry, language)}</h1>
                        <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${STATUS_STYLES[entry.status]}`}>
                            {entry.status}
                        </span>
                    </div>
                    <p className="text-sm text-zinc-500 mt-0.5">
                        {[entryCategoryName(entry, language), entryBrandName(entry), entry.part_number, entry.gtin].filter(Boolean).join(' · ')}
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    {editing ? (
                        <>
                            <button onClick={() => { setEditing(false); setForm(entryToFormState(entry)); }} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 disabled:opacity-50">
                                {L(language, 'Cancel', 'إلغاء')}
                            </button>
                            <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-marine-cyan hover:bg-marine-cyan-dark text-white disabled:opacity-50">
                                {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                                {L(language, 'Save', 'حفظ')}
                            </button>
                        </>
                    ) : (
                        <>
                            <button onClick={() => setEditing(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan hover:text-marine-primary">
                                <Pencil size={14} /> {L(language, 'Edit', 'تعديل')}
                            </button>
                            {entry.status === 'archived' ? (
                                <button onClick={() => act(() => adminCatalogApi.restore(id), L(language, 'Restored.', 'تمت الاستعادة.'))} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-emerald-500 hover:text-emerald-600">
                                    <ArchiveRestore size={14} /> {L(language, 'Restore', 'استعادة')}
                                </button>
                            ) : entry.status !== 'merged' && (
                                <button onClick={() => act(() => adminCatalogApi.archive(id), L(language, 'Archived.', 'تمت الأرشفة.'))} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-amber-500 hover:text-amber-600">
                                    <Archive size={14} /> {L(language, 'Archive', 'أرشفة')}
                                </button>
                            )}
                            {stats.product_count === 0 && (
                                <button
                                    onClick={async () => {
                                        if (!confirm(L(language, 'Delete this entry permanently?', 'حذف هذه البطاقة نهائياً؟'))) return;
                                        try {
                                            await adminCatalogApi.remove(id);
                                            router.push('/admin/dashboard/catalog');
                                        } catch (err) {
                                            setError(err.message);
                                        }
                                    }}
                                    className="p-2.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
                                >
                                    <Trash2 size={15} />
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>

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

            {entry.status === 'merged' && entry.merged_into && (
                <div className="mb-4 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-zinc-600 dark:text-zinc-300">
                    {L(language, 'This entry was merged into', 'تم دمج هذه البطاقة في')}{' '}
                    <Link href={`/admin/dashboard/catalog/${entry.merged_into._id || entry.merged_into}`} className="font-bold text-marine-primary">
                        {entryTitle(entry.merged_into, language) || L(language, 'another entry', 'بطاقة أخرى')}
                    </Link>.
                </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-6">
                <StatCard icon={Store} label={L(language, 'Vendors', 'التجار')} value={stats.vendor_count} />
                <StatCard icon={TrendingDown} label={L(language, 'Lowest', 'الأقل')} value={money(stats.min_price)} tone="text-emerald-600 dark:text-emerald-400" />
                <StatCard icon={Sigma} label={L(language, 'Average', 'المتوسط')} value={money(stats.avg_price)} />
                <StatCard icon={TrendingUp} label={L(language, 'Highest', 'الأعلى')} value={money(stats.max_price)} />
                <StatCard icon={Boxes} label={L(language, 'Total stock', 'إجمالي المخزون')} value={stats.total_stock} />
                <StatCard icon={ShoppingBag} label={L(language, 'Total sales', 'إجمالي المبيعات')} value={stats.total_sold} />
            </div>

            {editing ? (
                <>
                    <p className="mb-3 text-xs text-zinc-500">
                        {L(language,
                            'Editing this entry changes what future products are pre-filled with. Products already linked are not touched.',
                            'تعديل هذه البطاقة يغيّر ما تُملأ به المنتجات مستقبلاً. المنتجات المرتبطة بالفعل لا تتأثر.')}
                    </p>
                    <CatalogEntryForm form={form} setForm={setForm} metadata={metadata} language={language} />
                </>
            ) : (
                <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
                        <h3 className="font-bold text-sm text-zinc-900 dark:text-white">
                            {L(language, 'Who sells this', 'من يبيع هذا')}
                        </h3>
                        <p className="text-xs text-zinc-500 mt-0.5">
                            {L(language, 'Sorted by price, cheapest first.', 'مرتّبة حسب السعر، الأرخص أولاً.')}
                        </p>
                    </div>
                    {vendors.length === 0 ? (
                        <p className="px-5 py-10 text-center text-sm text-zinc-500">
                            {L(language, 'No vendor has listed this product yet.', 'لم يعرض أي تاجر هذا المنتج بعد.')}
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm min-w-[720px]">
                                <thead>
                                    <tr className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-100 dark:border-white/5">
                                        <th className="text-start px-5 py-2.5">{L(language, 'Vendor', 'التاجر')}</th>
                                        <th className="text-start px-3 py-2.5">{L(language, 'Price', 'السعر')}</th>
                                        <th className="text-start px-3 py-2.5">{L(language, 'Stock', 'المخزون')}</th>
                                        <th className="text-start px-3 py-2.5">{L(language, 'Sold', 'المُباع')}</th>
                                        <th className="text-start px-3 py-2.5">{L(language, 'Status', 'الحالة')}</th>
                                        <th className="px-3 py-2.5" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                    {vendors.map((row) => (
                                        <tr key={row.product_id} {...rowLink(`/admin/dashboard/products/${row.product_id}`)} className="hover:bg-zinc-50 dark:hover:bg-white/[0.02] cursor-pointer">
                                            <td className="px-5 py-3">
                                                <p className="font-semibold text-zinc-900 dark:text-white">{row.vendor_name}</p>
                                                <p className="text-xs text-zinc-500 truncate max-w-[240px]">{row.title}</p>
                                            </td>
                                            <td className="px-3 py-3 tabular-nums font-semibold text-zinc-900 dark:text-white">
                                                {money(row.effective_price)}
                                                {row.effective_price < row.price && (
                                                    <span className="text-xs text-zinc-400 line-through ms-1.5">{money(row.price)}</span>
                                                )}
                                            </td>
                                            <td className="px-3 py-3 tabular-nums text-zinc-600 dark:text-zinc-300">{row.stock}</td>
                                            <td className="px-3 py-3 tabular-nums text-zinc-600 dark:text-zinc-300">{row.sold_count}</td>
                                            <td className="px-3 py-3">
                                                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${row.status === 'published'
                                                    ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                                                    : row.status === 'pending'
                                                        ? 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400'
                                                        : 'bg-zinc-200 dark:bg-white/10 text-zinc-600 dark:text-zinc-300'
                                                    }`}>
                                                    {row.status}
                                                </span>
                                            </td>
                                            <td className="px-3 py-3 text-end">
                                                <Link href={`/admin/dashboard/products/${row.product_id}`} className="text-xs font-bold text-marine-primary hover:underline">
                                                    {L(language, 'Open', 'فتح')}
                                                </Link>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
