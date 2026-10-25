'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, Globe, ImageOff, Loader2, RefreshCw, Search, Store, Undo2, Wand2, X } from 'lucide-react';
import Link from '../../../../components/LocaleLink';
import { adminImageCheckApi, adminImageStudioApi } from '../../../../lib/api';
import { thumbUrl } from '../../../../lib/assets';
import { useApp } from '../../../../context/AppContext';
import { L } from '../../../../lib/catalog';
import PaginationControls from '../../../../components/dashboard/PaginationControls';
import ProductChecksTabs from '../../../../components/dashboard/ProductChecksTabs';
import ImageStudioPanel from '../../../../components/dashboard/ImageStudioPanel';
import usePageSize from '../../../../lib/usePageSize';

const CARD = 'bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl';
const STATUSES = [
    { id: 'published', ar: 'منشورة', en: 'Published' },
    { id: 'pending', ar: 'في انتظار الموافقة', en: 'Pending approval' },
    { id: 'draft', ar: 'مسودات', en: 'Drafts' },
    { id: 'all', ar: 'الكل', en: 'All' },
];
const ISSUES = {
    no_images: ['No pictures', 'من غير صور'],
    broken: ['Picture does not open', 'صورة مش بتفتح'],
    shared_image: ['Same picture on many products', 'نفس الصورة على منتجات كتير'],
    low_resolution: ['Small picture', 'صورة صغيرة'],
    blurry: ['Not sharp', 'مش واضحة'],
    background_not_white: ['Background not white', 'الخلفية مش بيضا'],
    small_in_frame: ['Product small in the picture', 'المنتج صغير في الصورة'],
    off_center: ['Product not centred', 'المنتج مش في النص'],
    touches_edges: ['Product touches the edges', 'المنتج لازق في الحواف'],
    not_square: ['Not square', 'مش مربعة'],
    too_dark: ['Too dark', 'غامقة'],
    washed_out: ['Washed out', 'باهتة'],
    one_image: ['Only one picture', 'صورة واحدة بس'],
    duplicate_in_gallery: ['Same picture twice', 'نفس الصورة متكررة'],
    clean_not_main: ['Clean picture is not the main one', 'الصورة النضيفة مش هي الأساسية'],
};
const ORDER = Object.keys(ISSUES);
const SEVERITY_STYLE = {
    high: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/30',
    medium: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30',
    low: 'bg-zinc-50 text-zinc-600 border-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:border-white/10',
};
const RING = { high: 'ring-2 ring-red-400', medium: 'ring-2 ring-amber-400', low: 'ring-1 ring-zinc-300 dark:ring-white/20' };
const RANK = { high: 0, medium: 1, low: 2 };

// The product's admin page, opened on its pictures (ProductReviewPage scrolls there).
const productImagesPath = (productId) => `/admin/dashboard/products/${productId}?show=images`;

const issueLabel = (type, lang) => (ISSUES[type] ? L(lang, ISSUES[type][0], ISSUES[type][1]) : type);

function useDebounced(value, ms = 300) {
    const [settled, setSettled] = useState(value);
    useEffect(() => {
        const id = setTimeout(() => setSettled(value), ms);
        return () => clearTimeout(id);
    }, [value, ms]);
    return settled;
}

function IssueChip({ issue, language }) {
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-bold ${SEVERITY_STYLE[issue.severity]}`}>
            {issueLabel(issue.type, language)}
        </span>
    );
}

function ImageTile({ image, language, busy, onMakeMain }) {
    const worst = image.issues.length ? image.issues.reduce((w, f) => (RANK[f.severity] < RANK[w] ? f.severity : w), 'low') : null;
    return (
        <div className="w-28 shrink-0">
            <a href={image.url} target="_blank" rel="noopener noreferrer"
                className={`relative block aspect-square rounded-lg overflow-hidden bg-white border border-zinc-200 dark:border-white/10 ${worst ? RING[worst] : ''}`}>
                <img src={thumbUrl(image.url, 160)} alt="" loading="lazy" className="w-full h-full object-contain" />
                {image.main && <span className="absolute top-1 start-1 rounded bg-black/60 px-1 text-[9px] font-bold text-white">{L(language, 'Main', 'أساسية')}</span>}
                {image.kept_original && <span className="absolute bottom-1 start-1 rounded bg-zinc-700/70 px-1 text-[9px] font-bold text-white">{L(language, 'Old, kept', 'قديمة متسابة')}</span>}
                {!image.measured && <span className="absolute inset-0 flex items-center justify-center bg-white/60"><Loader2 size={14} className="animate-spin text-zinc-500" /></span>}
            </a>
            <div className="mt-1 flex flex-wrap gap-1">
                {image.issues.map((f, i) => <IssueChip key={`${f.type}-${i}`} issue={f} language={language} />)}
                {image.width && <span className="text-[10px] text-zinc-400" dir="ltr">{image.width}×{image.height}</span>}
            </div>
            {!image.main && (
                <button type="button" disabled={busy} onClick={() => onMakeMain(image.url)}
                    className="mt-1 w-full rounded-md border border-zinc-200 dark:border-white/10 px-1.5 py-1 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan hover:text-marine-primary disabled:opacity-50">
                    {L(language, 'Make main', 'خليها الأساسية')}
                </button>
            )}
        </div>
    );
}

/**
 * Image check: every product whose pictures look wrong — missing, broken, small, soft, not
 * on white, badly framed, reused across many products — worst first. "The pictures are
 * fine" takes a product off the list until its pictures change. The pictures are measured
 * once, in the background, on our own server (Backend/services/imageCheckService.js).
 */
export default function ImageCheckPage() {
    const { language } = useApp();
    const isAr = language === 'ar';
    const [status, setStatus] = useState('published');
    const [type, setType] = useState('');
    const [severity, setSeverity] = useState('low');
    const [search, setSearch] = useState('');
    const q = useDebounced(search);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = usePageSize('admin.imageCheck', 25);
    const [data, setData] = useState({ rows: [], counts: { total: 0, by_type: {}, by_severity: {}, dismissed: 0, unmeasured: 0 }, progress: {}, pagination: { total: 0, page: 1, pages: 1 } });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState(null);
    const [busy, setBusy] = useState(null);
    // Products whose suggestions are open right here under the row, so they are approved
    // without leaving the list.
    const [studioOpen, setStudioOpen] = useState(() => new Set());
    const setStudio = (productId, on) => setStudioOpen((prev) => {
        const next = new Set(prev);
        if (on) next.add(productId); else next.delete(productId);
        return next;
    });

    const load = useCallback(async ({ quiet = false } = {}) => {
        if (!quiet) setLoading(true);
        setError('');
        try {
            setData(await adminImageCheckApi.list({ status, type, severity, q, page, limit: pageSize }));
        } catch (err) {
            setError(err.message || L(language, 'Could not load the list.', 'تعذر تحميل القائمة.'));
        } finally {
            setLoading(false);
        }
    }, [status, type, severity, q, page, pageSize, language]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { setPage(1); }, [status, type, severity, q]);

    // While pictures are still being measured, look again every few seconds.
    const measuring = data.progress?.running || data.counts.unmeasured > 0;
    useEffect(() => {
        if (!measuring) return undefined;
        const id = setTimeout(() => load({ quiet: true }), 8000);
        return () => clearTimeout(id);
    }, [measuring, data, load]);

    // Off the list the moment the button is pressed; a refusal brings it back with the reason.
    const dropRow = (productId) => setData((d) => ({
        ...d,
        rows: d.rows.filter((r) => r.product._id !== productId),
        counts: { ...d.counts, total: Math.max(0, (d.counts.total || 1) - 1) },
        pagination: { ...d.pagination, total: Math.max(0, (d.pagination.total || 1) - 1) },
    }));

    const markGood = async (row) => {
        setBusy(row.product._id);
        setError('');
        dropRow(row.product._id);
        try {
            await adminImageCheckApi.dismiss(row.product._id, row.signature);
            setNotice({ text: L(language, 'Marked as fine — off the list until its pictures change.', 'اتسجلت إن صورها كويسة — هتختفي من القايمة لحد ما صورها تتغير.'), undo: row.product._id });
            await load({ quiet: true });
        } catch (err) {
            setError(err.message);
            await load({ quiet: true });
        } finally {
            setBusy(null);
        }
    };

    const undo = async (productId) => {
        setBusy(productId);
        try {
            await adminImageCheckApi.restore(productId);
            setNotice({ text: L(language, 'Back on the list.', 'رجعت للقايمة.') });
            await load({ quiet: true });
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(null);
        }
    };

    // Asks for the missing suggestions, then opens them under the row: the ones already made
    // show at once, and the new ones appear there as they are finished.
    const suggest = async (row) => {
        setBusy(row.product._id);
        setError('');
        try {
            await adminImageStudioApi.suggest(row.product._id);
            setStudio(row.product._id, true);
        } catch (err) {
            setError(err.message);
        } finally {
            setBusy(null);
        }
    };

    const makeMain = async (row, url) => {
        setBusy(row.product._id);
        setError('');
        // A clean picture made main means the product is done: it leaves the list now.
        if (url.includes('/uploads/products/enhanced/')) dropRow(row.product._id);
        try {
            await adminImageCheckApi.makeMain(row.product._id, url, row.signature);
            setNotice({ text: L(language, 'Done — that picture is now the main one.', 'تمام — الصورة دي بقت الأساسية.') });
            await load({ quiet: true });
        } catch (err) {
            setError(err.message);
            await load({ quiet: true });
        } finally {
            setBusy(null);
        }
    };

    const rescan = async () => {
        try {
            await adminImageCheckApi.scan();
            setNotice({ text: L(language, 'Checking new pictures now…', 'بنفحص الصور الجديدة دلوقتي…') });
            setTimeout(() => load({ quiet: true }), 3000);
        } catch (err) {
            setError(err.message);
        }
    };

    const counts = data.counts;
    const doneLine = counts.done > 0
        ? L(language, `${counts.done} products are done (clean main picture) and are not listed.`, `${counts.done} منتج خلصوا (صورتهم الأساسية نضيفة) ومش ظاهرين هنا.`)
        : null;
    return (
        <div className="animate-in fade-in duration-300 pb-10">
            <ProductChecksTabs active="images" language={language} />
            <div className="flex flex-wrap items-start gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-marine-cyan/10 text-marine-primary flex items-center justify-center"><ImageOff size={20} /></div>
                <div className="flex-1 min-w-0">
                    <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">{L(language, 'Image check', 'مراجعة الصور')}</h1>
                    <p className="text-sm text-zinc-500 mt-0.5">
                        {L(language,
                            'Products whose pictures need a look: missing or broken, small, not sharp, not on white, badly framed, or the same picture on many products. Worst first.',
                            'منتجات صورها محتاجة نظرة: مش موجودة أو مش بتفتح، صغيرة، مش واضحة، خلفيتها مش بيضا، المنتج مش متظبط فيها، أو نفس الصورة على منتجات كتير. الأسوأ الأول.')}
                    </p>
                    {doneLine && <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mt-1">{doneLine}</p>}
                </div>
                <button type="button" onClick={rescan} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-white/10 px-3 py-2 text-xs font-bold text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan hover:text-marine-primary">
                    <RefreshCw size={13} className={data.progress?.running ? 'animate-spin' : ''} /> {L(language, 'Check new pictures', 'افحص الصور الجديدة')}
                </button>
            </div>

            {measuring && (
                <div className="mb-4 flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/[0.03] px-4 py-3 text-sm text-zinc-600 dark:text-zinc-300">
                    <Loader2 size={15} className="animate-spin text-marine-primary" />
                    {data.progress?.todo
                        ? L(language, `Checking pictures: ${data.progress.done} of ${data.progress.todo}. The list fills in as they are done.`, `بنفحص الصور: ${data.progress.done} من ${data.progress.todo}. القايمة بتكمل أول بأول.`)
                        : L(language, 'Some pictures have not been checked yet — they will be within minutes.', 'في صور لسه متفحصتش — هتتفحص خلال دقايق.')}
                </div>
            )}

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
                    {L(language, 'Everything', 'الكل')} ({counts.total})
                </button>
                {ORDER.filter((t) => counts.by_type?.[t]).map((t) => (
                    <button key={t} type="button" onClick={() => setType(t)}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold border ${type === t ? 'border-marine-cyan text-marine-primary bg-red-50 dark:bg-marine-cyan/10' : 'border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300'}`}>
                        {issueLabel(t, language)} ({counts.by_type[t]})
                    </button>
                ))}
                <div className="flex-1" />
                <select value={severity} onChange={(e) => setSeverity(e.target.value)}
                    className="bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-200 focus:border-marine-cyan focus:outline-none">
                    <option value="high">{L(language, 'Serious only', 'المشاكل الكبيرة بس')}</option>
                    <option value="medium">{L(language, 'Serious and clear', 'الكبيرة والواضحة')}</option>
                    <option value="low">{L(language, 'Everything, even small things', 'كله، حتى الحاجات الصغيرة')}</option>
                </select>
            </div>

            {error && (
                <div className="mb-4 flex items-center gap-2 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm">
                    <AlertCircle size={16} /> {error}
                </div>
            )}
            {notice && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-4 py-3 rounded-xl text-sm">
                    <span>{notice.text}</span>
                    <span className="flex items-center gap-2">
                        {notice.undo && (
                            <button type="button" onClick={() => undo(notice.undo)} disabled={busy === notice.undo} className="inline-flex items-center gap-1 font-bold hover:underline disabled:opacity-50">
                                <Undo2 size={14} /> {L(language, 'Undo', 'تراجع')}
                            </button>
                        )}
                        <button type="button" onClick={() => setNotice(null)} aria-label={L(language, 'Close', 'اقفل')}><X size={15} /></button>
                    </span>
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-20"><Loader2 size={30} className="animate-spin text-marine-primary" /></div>
            ) : data.rows.length === 0 ? (
                <div className={`${CARD} text-center py-16`}>
                    <CheckCircle2 size={30} className="text-emerald-500 mx-auto mb-3" />
                    <p className="font-bold text-zinc-900 dark:text-white">{L(language, 'Nothing to look at here.', 'مفيش حاجة محتاجة نظرة هنا.')}</p>
                    {counts.dismissed > 0 && <p className="text-xs text-zinc-500 mt-1">{L(language, `${counts.dismissed} marked as fine.`, `${counts.dismissed} متسجلين إن صورهم كويسة.`)}</p>}
                    {counts.done > 0 && <p className="text-xs text-zinc-500 mt-1">{L(language, `${counts.done} done — their main picture is the clean one.`, `${counts.done} خلصوا — صورتهم الأساسية هي النضيفة.`)}</p>}
                </div>
            ) : (
                <div className="space-y-3">
                    {data.rows.map((row) => {
                        const name = (isAr ? (row.product.title_ar || row.product.title_en) : (row.product.title_en || row.product.title_ar)) || '—';
                        const productIssues = row.findings.filter((f) => !f.image);
                        const st = STATUSES.find((s) => s.id === row.product.status);
                        return (
                            <div key={`${row.product._id}-${row.signature}`} className={`${CARD} p-4`}>
                                <div className="flex flex-wrap items-start gap-3 mb-3">
                                    <div className="flex-1 min-w-0">
                                        <Link href={productImagesPath(row.product._id)} className="font-bold text-zinc-900 dark:text-white hover:text-marine-primary flex items-center gap-1.5">
                                            <span className="truncate" title={name}>{name}</span>
                                        </Link>
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-zinc-500">
                                            <span className="flex items-center gap-1"><Store size={12} />{row.product.vendor?.store_name || '—'}</span>
                                            {row.product.sku && <span className="font-mono">{row.product.sku}</span>}
                                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-extrabold bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300">
                                                {st ? L(language, st.en, st.ar) : row.product.status}
                                            </span>
                                            {productIssues.map((f, i) => <IssueChip key={`p-${f.type}-${i}`} issue={f} language={language} />)}
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {studioOpen.has(row.product._id) ? (
                                            <button type="button" onClick={() => setStudio(row.product._id, false)}
                                                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-white/10 px-3 py-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-200 hover:border-marine-cyan hover:text-marine-primary">
                                                <ChevronDown size={13} className="rotate-180" /> {L(language, 'Close suggestions', 'اقفل الاقتراحات')}
                                            </button>
                                        ) : row.images.length > 0 ? (
                                            <button type="button" onClick={() => suggest(row)} disabled={busy === row.product._id}
                                                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-white/10 px-3 py-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-200 hover:border-marine-cyan hover:text-marine-primary disabled:opacity-50">
                                                {busy === row.product._id ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                                                {L(language, 'Suggest better pictures', 'اقترح صور أفضل')}
                                            </button>
                                        ) : (
                                            <button type="button" onClick={() => setStudio(row.product._id, true)}
                                                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-white/10 px-3 py-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-200 hover:border-marine-cyan hover:text-marine-primary">
                                                <Globe size={13} /> {L(language, 'Find pictures on the web', 'دور على صور في النت')}
                                            </button>
                                        )}
                                        <button type="button" onClick={() => markGood(row)} disabled={busy === row.product._id}
                                            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                                            {busy === row.product._id ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                                            {L(language, 'The pictures are fine', 'الصور كويسة')}
                                        </button>
                                    </div>
                                </div>
                                {row.images.length > 0 ? (
                                    <div className="flex gap-3 overflow-x-auto pb-1">
                                        {row.images.map((img) => (
                                            <ImageTile key={`${img.url}-${img.index}`} image={img} language={language}
                                                busy={busy === row.product._id} onMakeMain={(url) => makeMain(row, url)} />
                                        ))}
                                    </div>
                                ) : !studioOpen.has(row.product._id) && (
                                    <p className="text-xs font-semibold text-red-600 dark:text-red-400">
                                        {L(language, 'No pictures yet.', 'مفيش صور لسه.')}
                                    </p>
                                )}
                                {studioOpen.has(row.product._id) && (
                                    <ImageStudioPanel productId={row.product._id} language={language} onChanged={() => load({ quiet: true })} />
                                )}
                            </div>
                        );
                    })}

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
