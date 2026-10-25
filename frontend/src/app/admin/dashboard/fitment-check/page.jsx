'use client';

import { useCallback, useEffect, useState } from 'react';
import { CarFront, Loader2, Search, ImageOff, Store, ExternalLink, AlertCircle, X, CheckCircle2 } from 'lucide-react';
import Link from '../../../../components/LocaleLink';
import { adminFitmentApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import { L } from '../../../../lib/catalog';
import { findingTypeLabel } from '../../../../lib/fitmentCheck';
import FitmentFindings from '../../../../components/dashboard/FitmentFindings';
import PaginationControls from '../../../../components/dashboard/PaginationControls';
import usePageSize from '../../../../lib/usePageSize';
import ProductChecksTabs from '../../../../components/dashboard/ProductChecksTabs';

const CARD = 'bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl';
const STATUSES = [
    { id: 'published', ar: 'منشورة', en: 'Published' },
    { id: 'pending', ar: 'في انتظار الموافقة', en: 'Pending approval' },
    { id: 'draft', ar: 'مسودات', en: 'Drafts' },
    { id: 'all', ar: 'الكل', en: 'All' },
];
const TYPES = ['universal_but_named', 'missing_car', 'model_without_years', 'years_not_covered', 'years_narrower'];

/** Typing settles for a moment before the list is asked again. */
function useDebounced(value, ms = 300) {
    const [settled, setSettled] = useState(value);
    useEffect(() => {
        const id = setTimeout(() => setSettled(value), ms);
        return () => clearTimeout(id);
    }, [value, ms]);
    return settled;
}

/** The fitment as it is now, in one line: "Toyota Corolla, Yaris · Kia Rio". */
const fitmentLine = (product, lang) => {
    if (product.is_universal) return L(lang, 'Universal — fits any car', 'عام — يركب على أي عربية');
    const cars = (product.compatible_cars || []).map((c) => {
        const models = (c.models || []).map((m) => m.model_name);
        return models.length ? `${c.brand_name} ${models.join('، ')}` : c.brand_name;
    });
    return cars.length ? cars.join(' · ') : L(lang, 'No fitment', 'من غير توافق');
};

/**
 * Fitment check: products whose own title or description names cars their fitment does not —
 * a car ticked nowhere, a part for one car marked for every car, a model with no year. Read
 * from the text the way Egyptian vendors write it ("لانسر بومة", "شارك", "N16", "النترا HD",
 * "ix35"), each proposal with the words it came from and a one-press fix.
 */
export default function FitmentCheckPage() {
    const { language } = useApp();
    const isAr = language === 'ar';
    const [status, setStatus] = useState('published');
    const [type, setType] = useState('');
    const [severity, setSeverity] = useState('medium');
    const [search, setSearch] = useState('');
    const q = useDebounced(search);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = usePageSize('admin.fitmentCheck', 25);
    const [data, setData] = useState({ rows: [], counts: { total: 0, by_type: {}, by_status: {} }, pagination: { total: 0, page: 1, pages: 1 } });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setData(await adminFitmentApi.list({ status, type, severity, q, page, limit: pageSize }));
        } catch (err) {
            setError(err.message || L(language, 'Could not load the list.', 'تعذر تحميل القائمة.'));
        } finally {
            setLoading(false);
        }
    }, [status, type, severity, q, page, pageSize, language]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { setPage(1); }, [status, type, severity, q]);

    const afterChange = (res) => {
        const remaining = res?.check?.actionable;
        setNotice(res?.check
            ? (remaining
                ? L(language, `Fitment updated — ${remaining} finding(s) left on this product.`, `تم تعديل التوافق — فاضل ${remaining} ملاحظة على المنتج ده.`)
                : L(language, 'Fitment updated.', 'تم تعديل التوافق.'))
            : L(language, 'Marked as right — off the list.', 'اتسجل إنه صح — اختفى من القايمة.'));
        load();
    };

    return (
        <div className="animate-in fade-in duration-300 pb-10">
            <ProductChecksTabs active="fitment" language={language} />
            <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-marine-cyan/10 text-marine-primary flex items-center justify-center"><CarFront size={20} /></div>
                <div>
                    <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">{L(language, 'Fitment check', 'مراجعة التوافق')}</h1>
                    <p className="text-sm text-zinc-500 mt-0.5">
                        {L(language,
                            'Products whose title or description names cars the fitment does not have — read the way vendors write car names (Lancer Boma, Shark, N16, Elantra HD, ix35…).',
                            'منتجات العنوان أو الوصف بتاعها بيذكر عربيات مش متسجلة في التوافق — بنقرا أسماء العربيات زي ما التجار بيكتبوها (لانسر بومة، شارك، N16، النترا HD، ix35…).')}
                    </p>
                </div>
            </div>

            {/* Which products: by status, then by what was found. */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
                {STATUSES.map((s) => (
                    <button key={s.id} type="button" onClick={() => setStatus(s.id)}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${status === s.id ? 'bg-marine-cyan text-white' : 'bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan/60'}`}>
                        {L(language, s.en, s.ar)}
                    </button>
                ))}
                <div className="flex-1" />
                <div className="relative min-w-[220px]">
                    <Search size={15} className="absolute top-1/2 -translate-y-1/2 start-3 text-zinc-400" />
                    <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                        placeholder={L(language, 'Search title, SKU or part number…', 'ابحث بالعنوان أو SKU أو رقم القطعة…')}
                        className="w-full bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg ps-9 pe-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white" />
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-5">
                <button type="button" onClick={() => setType('')}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold border ${!type ? 'border-marine-cyan text-marine-primary bg-red-50 dark:bg-marine-cyan/10' : 'border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300'}`}>
                    {L(language, 'Everything', 'الكل')} ({data.counts.total})
                </button>
                {TYPES.filter((t) => data.counts.by_type[t]).map((t) => (
                    <button key={t} type="button" onClick={() => setType(t)}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold border ${type === t ? 'border-marine-cyan text-marine-primary bg-red-50 dark:bg-marine-cyan/10' : 'border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300'}`}>
                        {findingTypeLabel(t, language)} ({data.counts.by_type[t]})
                    </button>
                ))}
                <div className="flex-1" />
                <select value={severity} onChange={(e) => setSeverity(e.target.value)}
                    className="bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-200 focus:border-marine-cyan focus:outline-none">
                    <option value="high">{L(language, 'Sure only', 'الأكيد بس')}</option>
                    <option value="medium">{L(language, 'Sure and likely', 'الأكيد والغالب')}</option>
                    <option value="low">{L(language, 'Everything, worth-a-look too', 'كله، حتى اللي يستاهل نظرة')}</option>
                </select>
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

            {loading ? (
                <div className="flex items-center justify-center py-20"><Loader2 size={30} className="animate-spin text-marine-primary" /></div>
            ) : data.rows.length === 0 ? (
                <div className={`${CARD} text-center py-16`}>
                    <CheckCircle2 size={30} className="text-emerald-500 mx-auto mb-3" />
                    <p className="font-bold text-zinc-900 dark:text-white">{L(language, 'Every fitment here matches its title.', 'كل التوافقات هنا مطابقة للعنوان.')}</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {data.rows.map((row) => (
                        <div key={`${row.product._id}-${row.signature}`} className={`${CARD} p-4`}>
                            <div className="flex items-start gap-3 mb-3">
                                <div className="w-14 h-14 shrink-0 rounded-xl overflow-hidden bg-zinc-100 dark:bg-white/5 flex items-center justify-center">
                                    {row.product.image ? <img src={row.product.image} alt="" className="w-full h-full object-cover" /> : <ImageOff size={18} className="text-zinc-400" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <Link href={`/admin/dashboard/products/${row.product._id}`} target="_blank" className="font-bold text-zinc-900 dark:text-white hover:text-marine-primary flex items-center gap-1.5">
                                        <span className="truncate">{(isAr ? (row.product.title_ar || row.product.title_en) : (row.product.title_en || row.product.title_ar)) || '—'}</span>
                                        <ExternalLink size={12} className="shrink-0 text-zinc-400" />
                                    </Link>
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-zinc-500">
                                        <span className="flex items-center gap-1"><Store size={12} />{row.product.vendor?.store_name || '—'}</span>
                                        {(row.product.sku || row.product.part_number) && <span className="font-mono">{row.product.sku || row.product.part_number}</span>}
                                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300">
                                            {L(language, (STATUSES.find((s) => s.id === row.product.status) || {}).en || row.product.status, (STATUSES.find((s) => s.id === row.product.status) || {}).ar || row.product.status)}
                                        </span>
                                    </div>
                                    <p className="text-xs text-zinc-500 mt-1">
                                        <span className="font-bold text-zinc-600 dark:text-zinc-300">{L(language, 'Fitment now: ', 'التوافق دلوقتي: ')}</span>
                                        {fitmentLine(row.product, language)}
                                    </p>
                                </div>
                            </div>
                            <FitmentFindings productId={row.product._id} findings={row.findings} language={language} onChanged={afterChange} />
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
        </div>
    );
}
