'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, ExternalLink, ImageOff, Loader2, Search, Wand2 } from 'lucide-react';
import Link from '../../../../components/LocaleLink';
import { adminImageStudioApi } from '../../../../lib/api';
import { thumbUrl } from '../../../../lib/assets';
import { useApp } from '../../../../context/AppContext';
import { L } from '../../../../lib/catalog';
import ImageStudioPanel from '../../../../components/dashboard/ImageStudioPanel';
import PaginationControls from '../../../../components/dashboard/PaginationControls';
import usePageSize from '../../../../lib/usePageSize';

const CARD = 'bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl';
const TABS = [
    { id: 'suggestions', en: 'Waiting for your OK', ar: 'مستنية موافقتك', count: 'suggestions' },
    { id: 'no_images', en: 'No pictures', ar: 'من غير صور', count: 'no_images' },
    { id: 'not_clean', en: 'Main picture not cleaned', ar: 'الصورة الأساسية لسه متنضفتش', count: 'not_clean' },
    { id: 'working', en: 'Being made / failed', ar: 'بتتعمل / فشلت', count: 'working' },
];
const STATUSES = [
    { id: 'all', ar: 'الكل', en: 'All' },
    { id: 'published', ar: 'منشورة', en: 'Published' },
    { id: 'pending', ar: 'في انتظار الموافقة', en: 'Pending approval' },
    { id: 'draft', ar: 'مسودات', en: 'Drafts' },
];
const STATUS_BADGE = {
    published: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
    pending: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
    draft: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
};

function useDebounced(value, ms = 300) {
    const [settled, setSettled] = useState(value);
    useEffect(() => {
        const id = setTimeout(() => setSettled(value), ms);
        return () => clearTimeout(id);
    }, [value, ms]);
    return settled;
}

function ProductRow({ row, language, open, selected, selectable, onToggle, onSelect, onChanged }) {
    const isAr = language === 'ar';
    const title = isAr ? (row.title_ar || row.title_en) : (row.title_en || row.title_ar);
    const s = row.suggestions || {};
    const status = STATUSES.find((x) => x.id === row.status);
    return (
        <div className="border-b border-zinc-100 last:border-0 dark:border-white/5">
            <div className="flex items-center gap-3 p-3">
                {selectable && (
                    <input type="checkbox" checked={selected} onChange={() => onSelect(row._id)} className="h-4 w-4 shrink-0 accent-marine-cyan" aria-label={L(language, 'Select', 'اختار')} />
                )}
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-white/10">
                    {row.image
                        ? <img src={thumbUrl(row.image, 160)} alt="" loading="lazy" className="h-full w-full object-contain" />
                        : <div className="flex h-full items-center justify-center text-zinc-300"><ImageOff size={18} /></div>}
                </div>
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-zinc-900 dark:text-white" title={title}>{title || '—'}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className={`rounded-full px-2 py-0.5 font-bold ${STATUS_BADGE[row.status] || STATUS_BADGE.draft}`}>{status ? L(language, status.en, status.ar) : row.status}</span>
                        {row.vendor && <span className="font-semibold text-zinc-500">{row.vendor}</span>}
                        <span className="text-zinc-400">{row.images_count} {L(language, 'pictures', 'صور')}</span>
                        {row.clean_main && <span className="inline-flex items-center gap-0.5 font-bold text-emerald-600"><CheckCircle2 size={11} />{L(language, 'clean main', 'الأساسية نضيفة')}</span>}
                        {s.ready > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 font-bold text-marine-primary dark:bg-red-500/10">{s.ready} {L(language, 'to decide', 'مستنية قرار')}</span>}
                        {(s.queued || 0) + (s.processing || 0) > 0 && <span className="inline-flex items-center gap-1 font-bold text-zinc-500"><Loader2 size={10} className="animate-spin" />{(s.queued || 0) + (s.processing || 0)}</span>}
                        {s.failed > 0 && <span className="font-bold text-red-600">{s.failed} {L(language, 'failed', 'فشلت')}</span>}
                    </div>
                </div>
                <Link href={`/admin/dashboard/products/${row._id}`} className="hidden shrink-0 rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-800 sm:inline-flex dark:hover:bg-white/5 dark:hover:text-white" title={L(language, 'Open the product', 'افتح المنتج')}>
                    <ExternalLink size={15} />
                </Link>
                <button type="button" onClick={() => onToggle(row._id)} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-bold text-zinc-700 hover:border-marine-cyan hover:text-marine-primary dark:border-white/10 dark:text-zinc-200">
                    {open ? L(language, 'Close', 'اقفل') : L(language, 'Pictures', 'الصور')}
                    <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
            </div>
            {open && (
                <div className="px-3 pb-4">
                    <ImageStudioPanel productId={row._id} language={language} onChanged={onChanged} />
                </div>
            )}
        </div>
    );
}

/**
 * Product pictures: cleaner versions waiting for the admin's OK, products with no pictures
 * (find some on the web), and products whose main picture was never cleaned. Everything is
 * made on our own server, one picture at a time (Backend/services/imageStudioService.js).
 */
export default function ImageStudioPage() {
    const { language } = useApp();
    const isAr = language === 'ar';
    const [tab, setTab] = useState('suggestions');
    const [status, setStatus] = useState('all');
    const [search, setSearch] = useState('');
    const q = useDebounced(search);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = usePageSize('admin.imageStudio', 25);
    const [summary, setSummary] = useState(null);
    const [data, setData] = useState({ rows: [], pagination: { total: 0, page: 1, pages: 1 } });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [openId, setOpenId] = useState(null);
    const [selected, setSelected] = useState([]);
    const [queueing, setQueueing] = useState(false);

    const loadSummary = useCallback(() => {
        adminImageStudioApi.summary(status).then(setSummary).catch(() => setSummary(null));
    }, [status]);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setData(await adminImageStudioApi.list({ tab, status, q, page, limit: pageSize }));
        } catch (err) {
            setError(err.message || L(language, 'Could not load the list.', 'تعذر تحميل القائمة.'));
        } finally {
            setLoading(false);
        }
    }, [tab, status, q, page, pageSize, language]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { loadSummary(); }, [loadSummary]);
    useEffect(() => { setPage(1); setSelected([]); setOpenId(null); }, [tab, status, q]);

    const refresh = () => { load(); loadSummary(); };

    // Does a product still belong on this tab after a change? Decided from what the panel
    // reports, so the row goes the moment it is done — no reload, other open rows untouched.
    const stillHere = (left) => {
        if (!left) return true;
        if (tab === 'suggestions') return left.ready > 0;
        if (tab === 'working') return left.working > 0;
        if (tab === 'not_clean') return !left.main_clean;
        if (tab === 'no_images') return !left.has_images;
        return true;
    };
    const afterChange = (productId, left) => {
        if (!stillHere(left)) {
            setData((d) => ({
                ...d,
                rows: d.rows.filter((r) => r._id !== productId),
                pagination: { ...d.pagination, total: Math.max(0, (d.pagination.total || 1) - 1) },
            }));
            setOpenId((id) => (id === productId ? null : id));
            setSelected((sel) => sel.filter((id) => id !== productId));
        }
        loadSummary();
    };
    const toggleSelect = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    const selectable = tab === 'not_clean';
    const allOnPage = data.rows.map((r) => r._id);

    const queueSelected = async () => {
        setQueueing(true);
        setNotice('');
        setError('');
        try {
            const res = await adminImageStudioApi.queueMany(selected.slice(0, 50));
            setNotice(L(language,
                `${res.queued} picture(s) from ${res.products} product(s) are being made, one at a time. They will wait under "Waiting for your OK".`,
                `بنعمل ${res.queued} صورة من ${res.products} منتج، واحدة واحدة. هتستناك في "مستنية موافقتك".`));
            setSelected([]);
            refresh();
        } catch (err) {
            setError(err.message);
        } finally {
            setQueueing(false);
        }
    };

    const service = summary?.service;

    return (
        <div className="mx-auto max-w-6xl space-y-5 pb-12">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-black text-zinc-900 dark:text-white">
                        <Wand2 size={22} className="text-marine-primary" />
                        {L(language, 'Product pictures', 'صور المنتجات')}
                    </h1>
                    <p className="mt-1 max-w-2xl text-sm text-zinc-500">
                        {L(language,
                            'Better pictures — white background, square, centred, sharper — wait here for your OK before anything changes. Products with no pictures can get some from a web search. All made on our own server, one picture at a time.',
                            'صور أفضل — خلفية بيضا، مربعة، المنتج في النص وأوضح — بتستنى موافقتك هنا قبل ما أي حاجة تتغير. والمنتجات اللي من غير صور تقدر تجيبلها صور من بحث في النت. كله بيتعمل على السيرفر بتاعنا، صورة صورة.')}
                    </p>
                </div>
                {summary && (
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${service?.ok ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'}`}>
                        <span className={`h-2 w-2 rounded-full ${service?.ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
                        {service?.ok
                            ? (service.busy ? L(language, 'Image service working', 'خدمة الصور شغالة دلوقتي') : L(language, 'Image service ready', 'خدمة الصور جاهزة'))
                            : L(language, 'Image service is off — suggestions wait until it is back', 'خدمة الصور واقفة — الاقتراحات هتستنى لحد ما ترجع')}
                    </span>
                )}
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1">
                {TABS.map((t) => {
                    const n = summary ? summary[t.count] : null;
                    const on = tab === t.id;
                    return (
                        <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition-colors ${on ? 'border-marine-cyan bg-red-50 text-marine-primary dark:bg-red-500/10' : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 dark:border-white/10 dark:bg-[#14171A] dark:text-zinc-300'}`}>
                            {L(language, t.en, t.ar)}
                            {n !== null && n !== undefined && <span className={`rounded-full px-2 py-0.5 text-[11px] ${on ? 'bg-marine-cyan text-white' : 'bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300'}`}>{Number(n).toLocaleString(isAr ? 'ar-EG' : 'en-US')}</span>}
                        </button>
                    );
                })}
            </div>

            <div className={`${CARD} flex flex-wrap items-center gap-2 p-3`}>
                <div className="relative min-w-[12rem] flex-1">
                    <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} dir="auto" placeholder={L(language, 'Name, SKU or part number…', 'الاسم أو SKU أو رقم القطعة…')} className="w-full rounded-lg border border-zinc-200 bg-white py-2 pe-3 ps-9 text-sm outline-none focus:border-marine-cyan dark:border-white/10 dark:bg-[#0E1012] dark:text-white" />
                </div>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold dark:border-white/10 dark:bg-[#0E1012] dark:text-white">
                    {STATUSES.map((s) => <option key={s.id} value={s.id}>{L(language, s.en, s.ar)}</option>)}
                </select>
                {selectable && (
                    <>
                        <button type="button" onClick={() => setSelected(selected.length === allOnPage.length ? [] : allOnPage)} className="rounded-lg px-3 py-2 text-xs font-bold text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/5">
                            {selected.length === allOnPage.length && allOnPage.length ? L(language, 'Clear', 'شيل الاختيار') : L(language, 'Select page', 'اختار الصفحة')}
                        </button>
                        <button type="button" disabled={!selected.length || queueing} onClick={queueSelected} className="inline-flex items-center gap-1.5 rounded-lg bg-marine-cyan px-3 py-2 text-xs font-bold text-white hover:bg-marine-cyan-dark disabled:opacity-50">
                            {queueing ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                            {L(language, `Suggest better pictures (${selected.length})`, `اقترح صور أفضل (${selected.length})`)}
                        </button>
                    </>
                )}
            </div>

            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-700 dark:bg-red-500/10 dark:text-red-400">{error}</p>}
            {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">{notice}</p>}

            <div className={CARD}>
                {loading ? (
                    <div className="flex items-center justify-center gap-2 p-10 text-sm text-zinc-500"><Loader2 size={18} className="animate-spin" /> {L(language, 'Loading…', 'بنحمل…')}</div>
                ) : data.rows.length === 0 ? (
                    <p className="p-10 text-center text-sm font-semibold text-zinc-500">
                        {tab === 'suggestions' ? L(language, 'Nothing waiting — every suggestion has been decided.', 'مفيش حاجة مستنية — كل الاقتراحات اتاخد فيها قرار.') : L(language, 'Nothing here.', 'مفيش حاجة هنا.')}
                    </p>
                ) : (
                    data.rows.map((row) => (
                        <ProductRow
                            key={row._id}
                            row={row}
                            language={language}
                            open={openId === row._id}
                            selectable={selectable}
                            selected={selected.includes(row._id)}
                            onToggle={(id) => setOpenId(openId === id ? null : id)}
                            onSelect={toggleSelect}
                            onChanged={(left) => afterChange(row._id, left)}
                        />
                    ))
                )}
            </div>

            {data.pagination.total > 0 && (
                <PaginationControls
                    page={data.pagination.page}
                    pageSize={pageSize}
                    onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
                    total={data.pagination.total}
                    onPageChange={setPage}
                    labels={isAr ? { showing: 'عرض', of: 'من', previous: 'السابق', next: 'التالي' } : {}}
                />
            )}
        </div>
    );
}
