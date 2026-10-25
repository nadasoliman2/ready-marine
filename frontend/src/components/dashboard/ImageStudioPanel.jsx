'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, ExternalLink, Globe, ImageOff, ImagePlus, Loader2, RefreshCw, Search, Wand2, X } from 'lucide-react';
import { adminImageStudioApi } from '../../lib/api';
import { thumbUrl } from '../../lib/assets';
import { L } from '../../lib/catalog';

/**
 * The image studio on one product (Backend/services/imageStudioService.js): a cleaner version
 * of each picture — white background, square, centred, sharper — waiting for the admin to take
 * it or leave it, and a web image search when the product has no pictures. Nothing changes on
 * the product until the admin presses "Use"; the old picture then stays at the end of the
 * gallery.
 */

const ENHANCED = '/uploads/products/enhanced/';
const POLL_MS = 2500;
const POLL_FOR_MS = 5 * 60 * 1000;

const ISSUE_LABELS = {
    low_resolution: ['Small picture', 'صورة صغيرة'],
    background_not_white: ['Background not white', 'الخلفية مش بيضا'],
    product_small_in_frame: ['Product small in the frame', 'المنتج صغير جوه الصورة'],
    not_square: ['Not square', 'مش مربعة'],
    transparent_background: ['Transparent background', 'خلفية شفافة'],
};
const MODE_LABELS = {
    cutout: ['Background removed', 'الخلفية اتشالت'],
    pad: ['Whole picture on white', 'الصورة كاملة على أبيض'],
    white: ['White cleaned up', 'الأبيض اتظبط'],
    alpha: ['On white', 'على أبيض'],
};
const NOTE_LABELS = {
    cutout_uncertain: ['The cut-out may have missed a part — look before using it', 'القص ممكن يكون شال حتة من المنتج — بص عليها قبل ما تستخدمها'],
    cutout_not_possible: ['Could not cut the product out — the whole picture was kept', 'معرفناش نفصل المنتج — الصورة اتسابت كاملة'],
    source_very_small: ['The original is very small — a better photo from the vendor would be best', 'الصورة الأصلية صغيرة جدًا — الأحسن صورة أوضح من التاجر'],
};

const pair = (map, key, lang) => (map[key] ? L(lang, map[key][0], map[key][1]) : key);
const small = (url, w = 320) => thumbUrl(url, w);

function IssueChips({ report, language }) {
    if (!report) return null;
    const issues = report.issues || [];
    return (
        <div className="mt-1.5 flex flex-wrap gap-1">
            {issues.length === 0 && (
                <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">{L(language, 'Looks fine', 'شكلها كويس')}</span>
            )}
            {issues.map((i) => (
                <span key={i} className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold text-zinc-600 dark:bg-white/5 dark:text-zinc-300">{pair(ISSUE_LABELS, i, language)}</span>
            ))}
            {report.width && (
                <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold text-zinc-500 dark:bg-white/5 dark:text-zinc-400" dir="ltr">{report.width}×{report.height}</span>
            )}
        </div>
    );
}

function SuggestionCard({ suggestion, language, busy, mainIsClean, isMain, onApply, onDismiss, onRetry }) {
    const [choice, setChoice] = useState(suggestion.options?.[0]?.url || '');
    const [keep, setKeep] = useState(true);
    // In front of a main picture that is not clean yet; the admin can say otherwise.
    const [makeMain, setMakeMain] = useState(!mainIsClean);
    useEffect(() => { setMakeMain(!mainIsClean); }, [mainIsClean]);
    const isWeb = suggestion.kind === 'web';
    const working = suggestion.status === 'queued' || suggestion.status === 'processing';
    const warn = suggestion.confidence && suggestion.confidence !== 'high';

    useEffect(() => { setChoice(suggestion.options?.[0]?.url || ''); }, [suggestion._id, suggestion.options]);

    return (
        <div className={`rounded-xl border p-3 ${warn ? 'border-amber-200 dark:border-amber-500/30' : 'border-zinc-200 dark:border-white/10'}`}>
            <div className="flex flex-wrap items-start gap-3">
                <div className="w-28 shrink-0">
                    <p className="mb-1 text-[10px] font-black uppercase tracking-wider text-zinc-400">{isWeb ? L(language, 'From the web', 'من النت') : L(language, 'Now', 'دلوقتي')}</p>
                    <a href={suggestion.source_url} target="_blank" rel="noopener noreferrer" className="block aspect-square overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 dark:border-white/10 dark:bg-[#0E1012]">
                        <img src={small(suggestion.source_url)} alt="" loading="lazy" className="h-full w-full object-contain" />
                    </a>
                    <IssueChips report={suggestion.source_report} language={language} />
                </div>

                <div className="min-w-0 flex-1">
                    <p className="mb-1 text-[10px] font-black uppercase tracking-wider text-zinc-400">{L(language, 'Suggested', 'المقترح')}</p>
                    {working && (
                        <div className="flex h-28 items-center gap-2 text-sm font-bold text-zinc-500">
                            <Loader2 size={16} className="animate-spin text-marine-primary" />
                            {suggestion.status === 'queued' ? L(language, 'Waiting its turn…', 'مستنية دورها…') : L(language, 'Being made now…', 'بتتعمل دلوقتي…')}
                        </div>
                    )}
                    {suggestion.status === 'failed' && (
                        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 p-3 text-xs font-bold text-red-700 dark:bg-red-500/10 dark:text-red-400">
                            <AlertTriangle size={14} />
                            <span className="min-w-0 flex-1">{L(language, 'Could not be made', 'معرفناش نعملها')}: {suggestion.error}</span>
                            <button type="button" disabled={busy} onClick={() => onRetry(suggestion)} className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1 text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-500/30 dark:bg-transparent">
                                <RefreshCw size={12} /> {L(language, 'Try again', 'جرب تاني')}
                            </button>
                        </div>
                    )}
                    {suggestion.status === 'ready' && (
                        <div className="flex flex-wrap gap-2">
                            {suggestion.options.map((o) => {
                                const on = o.url === choice;
                                return (
                                    <button
                                        key={o.url}
                                        type="button"
                                        onClick={() => setChoice(o.url)}
                                        className={`w-28 shrink-0 rounded-lg border-2 p-0.5 text-start transition-colors ${on ? 'border-marine-cyan' : 'border-transparent hover:border-zinc-300 dark:hover:border-white/20'}`}
                                        aria-pressed={on}
                                    >
                                        <span className="relative block aspect-square overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-white/10">
                                            <img src={small(o.url)} alt="" loading="lazy" className="h-full w-full object-contain" />
                                            {on && <span className="absolute end-1 top-1 rounded-full bg-marine-cyan p-0.5 text-white"><Check size={10} /></span>}
                                        </span>
                                        <span className="mt-1 block text-[10px] font-bold leading-tight text-zinc-600 dark:text-zinc-300">
                                            {pair(MODE_LABELS, o.mode, language)}{o.upscaled ? ` · ${L(language, 'sharpened', 'متكبرة')}` : ''}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                    {suggestion.status === 'ready' && (suggestion.notes || []).length > 0 && (
                        <div className="mt-2 space-y-1">
                            {suggestion.notes.map((n) => (
                                <p key={n} className="flex items-start gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                                    <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {pair(NOTE_LABELS, n, language)}
                                </p>
                            ))}
                        </div>
                    )}
                    {isWeb && suggestion.web?.domain && (
                        <p className="mt-2 text-[11px] text-zinc-500">
                            {L(language, 'Found on', 'لقيناها على')}{' '}
                            {suggestion.web.page_url ? (
                                <a href={suggestion.web.page_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-bold text-marine-primary hover:underline">
                                    {suggestion.web.domain} <ExternalLink size={10} />
                                </a>
                            ) : <span className="font-bold">{suggestion.web.domain}</span>}
                        </p>
                    )}
                </div>
            </div>

            {(suggestion.status === 'ready' || working) && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 dark:border-white/5">
                    {suggestion.status === 'ready' && (
                        <button type="button" disabled={busy || !choice} onClick={() => onApply(suggestion, choice, keep, makeMain)} className="inline-flex items-center gap-1.5 rounded-lg bg-marine-cyan px-3 py-1.5 text-xs font-bold text-white hover:bg-marine-cyan-dark disabled:opacity-50">
                            {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                            {isWeb ? L(language, 'Add to the product', 'ضيفها للمنتج') : L(language, 'Use this picture', 'استخدم الصورة دي')}
                        </button>
                    )}
                    {suggestion.status === 'ready' && !isWeb && (
                        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="accent-marine-cyan" />
                            {L(language, 'Keep the old picture at the end', 'خلي الصورة القديمة في الآخر')}
                        </label>
                    )}
                    {suggestion.status === 'ready' && !isMain && (
                        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                            <input type="checkbox" checked={makeMain} onChange={(e) => setMakeMain(e.target.checked)} className="accent-marine-cyan" />
                            {L(language, 'Make it the main picture', 'خليها الصورة الأساسية')}
                        </label>
                    )}
                    <button type="button" disabled={busy} onClick={() => onDismiss(suggestion)} className="ms-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50 dark:hover:bg-white/5 dark:hover:text-white">
                        <X size={13} /> {L(language, 'Not this one', 'مش دي')}
                    </button>
                </div>
            )}
        </div>
    );
}

function WebResult({ result, language, state, onPick }) {
    const [broken, setBroken] = useState(false);
    if (broken) return null;
    return (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-white/10 dark:bg-[#0E1012]">
            <a href={result.page_url || result.image_url} target="_blank" rel="noopener noreferrer" className="block aspect-square bg-white">
                <img
                    src={result.thumb_url || result.image_url}
                    alt={result.title || ''}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={() => setBroken(true)}
                    className="h-full w-full object-contain"
                />
            </a>
            <div className="p-2">
                <p className="truncate text-[10px] font-bold text-zinc-500" title={result.title}>{result.domain}{result.width ? <span dir="ltr"> · {result.width}×{result.height}</span> : null}</p>
                <button
                    type="button"
                    disabled={state === 'busy' || state === 'done'}
                    onClick={() => onPick(result)}
                    className={`mt-1.5 inline-flex w-full items-center justify-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold ${state === 'done' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'border border-zinc-200 text-zinc-700 hover:border-marine-cyan hover:text-marine-primary dark:border-white/10 dark:text-zinc-200'} disabled:cursor-default`}
                >
                    {state === 'busy' ? <Loader2 size={11} className="animate-spin" /> : state === 'done' ? <Check size={11} /> : <ImagePlus size={11} />}
                    {state === 'done' ? L(language, 'Added below', 'اتضافت تحت') : L(language, 'Use this', 'استخدم دي')}
                </button>
                {typeof state === 'string' && state.startsWith('error:') && <p className="mt-1 text-[10px] font-semibold text-red-600">{state.slice(6)}</p>}
            </div>
        </div>
    );
}

export default function ImageStudioPanel({ productId, language, onChanged }) {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busyId, setBusyId] = useState(null);
    const [webOpen, setWebOpen] = useState(false);
    const [webQuery, setWebQuery] = useState('');
    const [web, setWeb] = useState({ loading: false, results: null, error: '' });
    const [picks, setPicks] = useState({});
    // Suggestions taken or turned down, hidden the moment the button is pressed — before the
    // server answers. Shown again only if the server refuses.
    const [hidden, setHidden] = useState(() => new Set());
    const pollUntil = useRef(0);
    const timer = useRef(null);

    const load = useCallback(async () => {
        try {
            const res = await adminImageStudioApi.product(productId);
            setData(res);
            setError('');
            return res;
        } catch (err) {
            setError(err.message || L(language, 'Could not load the pictures.', 'تعذر تحميل الصور.'));
            return null;
        }
    }, [productId, language]);

    // While anything is being made, look again every few seconds (for a few minutes at most).
    const poll = useCallback(async () => {
        clearTimeout(timer.current);
        const res = await load();
        const working = (res?.suggestions || []).some((s) => s.status === 'queued' || s.status === 'processing');
        if (working && Date.now() < pollUntil.current) timer.current = setTimeout(poll, POLL_MS);
    }, [load]);

    const startPolling = useCallback(() => {
        pollUntil.current = Date.now() + POLL_FOR_MS;
        poll();
    }, [poll]);

    useEffect(() => {
        load().then((res) => {
            if (!res) return;
            setWebQuery(res.web_query || '');
            if (!(res.product?.images || []).length) setWebOpen(true);
            if ((res.suggestions || []).some((s) => s.status === 'queued' || s.status === 'processing')) startPolling();
        });
        return () => clearTimeout(timer.current);
    }, [load, startPolling]);

    const act = async (id, fn, done) => {
        setBusyId(id);
        setNotice('');
        setError('');
        try {
            const res = await fn();
            if (done) setNotice(typeof done === 'function' ? done(res) : done);
            await load();
            return res;
        } catch (err) {
            // Reloaded first: a reload clears the message, and this one must stay on screen.
            await load();
            setError(err.message || L(language, 'Something went wrong.', 'حصلت مشكلة.'));
            return null;
        } finally {
            setBusyId(null);
        }
    };

    const suggest = (force = false) => act('suggest', () => adminImageStudioApi.suggest(productId, force), (r) => (
        r.queued
            ? L(language, `${r.queued} picture(s) are being made — they show up here in a few seconds.`, `بنعمل ${r.queued} صورة — هتظهر هنا خلال ثواني.`)
            : L(language, 'Every picture already has a suggestion or is already clean.', 'كل الصور عندها اقتراح أو نضيفة خلاص.')
    )).then((r) => { if (r?.queued) startPolling(); });

    const hide = (id, on) => setHidden((prev) => {
        const next = new Set(prev);
        if (on) next.add(id); else next.delete(id);
        return next;
    });

    /**
     * Tell the list what is left on this product after a change, so it can drop the row the
     * moment nothing is waiting there any more (the studio page) or refresh it (review page).
     */
    const report = (res) => {
        if (!res) return;
        const list = res.suggestions || [];
        const images = res.product?.images || [];
        onChanged?.({
            ready: list.filter((x) => x.status === 'ready').length,
            working: list.filter((x) => ['queued', 'processing', 'failed'].includes(x.status)).length,
            main_clean: !!images[0]?.url?.includes(ENHANCED),
            has_images: images.length > 0,
        });
    };

    /** Hide the card at once, then do it; on a refusal the card comes back with the reason. */
    const decide = async (s, fn, done) => {
        hide(s._id, true);
        setNotice('');
        setError('');
        try {
            await fn();
            if (done) setNotice(done);
            report(await load());
        } catch (err) {
            await load();
            hide(s._id, false);
            setError(err.message || L(language, 'Something went wrong.', 'حصلت مشكلة.'));
        }
    };

    const apply = (s, option_url, keep_original, make_main) => decide(s,
        () => adminImageStudioApi.apply(s._id, { option_url, keep_original, make_main }),
        L(language, 'Done — the product now uses the new picture.', 'تمام — المنتج بقى بالصورة الجديدة.'));
    const applyAll = () => act('all', () => adminImageStudioApi.applyAll(productId), (r) => (
        r.errors?.length
            ? L(language, `${r.applied} used; ${r.errors.length} could not be: ${r.errors[0]}`, `اتطبق ${r.applied}، و${r.errors.length} متطبقش: ${r.errors[0]}`)
            : L(language, `${r.applied} picture(s) used.`, `اتطبق ${r.applied} صورة.`)
    )).then(async (r) => { if (r?.applied) report(await load()); });
    const dismiss = (s) => decide(s, () => adminImageStudioApi.dismiss(s._id));
    const retry = (s) => act(s._id, () => adminImageStudioApi.retry(s._id)).then(() => startPolling());

    const search = async (e) => {
        e?.preventDefault();
        setWeb({ loading: true, results: null, error: '' });
        try {
            const res = await adminImageStudioApi.webSearch(productId, webQuery.trim());
            setWebQuery(res.query);
            setWeb({ loading: false, results: res.results, error: '' });
        } catch (err) {
            setWeb({ loading: false, results: null, error: err.message || L(language, 'The search did not work.', 'البحث مشتغلش.') });
        }
    };

    const pick = async (result) => {
        setPicks((p) => ({ ...p, [result.image_url]: 'busy' }));
        try {
            await adminImageStudioApi.webPick(productId, result, webQuery);
            setPicks((p) => ({ ...p, [result.image_url]: 'done' }));
            startPolling();
        } catch (err) {
            setPicks((p) => ({ ...p, [result.image_url]: `error:${err.message}` }));
        }
    };

    if (!data && !error) {
        return (
            <section className="mt-6 flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-white/5 dark:bg-[#14171A]">
                <Loader2 size={16} className="animate-spin" /> {L(language, 'Loading pictures…', 'بنحمل الصور…')}
            </section>
        );
    }

    const images = data?.product?.images || [];
    const suggestions = data?.suggestions || [];
    const open = suggestions.filter((s) => s.status !== 'applied' && !hidden.has(s._id));
    const ready = open.filter((s) => s.status === 'ready');
    const handled = new Set(suggestions.filter((s) => s.kind === 'enhance').map((s) => s.source_url));
    const appliedClean = new Set(suggestions.filter((s) => s.status === 'applied').map((s) => s.source_url));
    const uncleaned = images.filter((i) => i.url && !i.url.includes(ENHANCED) && !handled.has(i.url) && !appliedClean.has(i.url));
    const order = { ready: 0, processing: 1, queued: 2, failed: 3 };
    const sorted = [...open].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

    return (
        <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-white/5 dark:bg-[#14171A]">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="flex items-center gap-2 text-lg font-black text-zinc-900 dark:text-white">
                        <Wand2 size={17} className="text-marine-primary" />
                        {L(language, 'Product pictures', 'صور المنتج')}
                    </h2>
                    <p className="mt-1 text-xs text-zinc-500">
                        {L(language,
                            'Better versions: white background, square, centred, sharper. Nothing changes until you press "Use" — and the old picture stays at the end.',
                            'نسخ أفضل: خلفية بيضا، مربعة، المنتج في النص وأوضح. مفيش حاجة بتتغير غير لما تدوس "استخدم" — والصورة القديمة بتفضل في الآخر.')}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    {ready.length > 1 && (
                        <button type="button" disabled={!!busyId} onClick={applyAll} className="inline-flex items-center gap-1.5 rounded-lg bg-marine-cyan px-3 py-2 text-xs font-bold text-white hover:bg-marine-cyan-dark disabled:opacity-50">
                            {busyId === 'all' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                            {L(language, `Use all ${ready.length}`, `استخدم الـ ${ready.length} كلهم`)}
                        </button>
                    )}
                    {uncleaned.length > 0 && (
                        <button type="button" disabled={!!busyId} onClick={() => suggest(false)} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-bold text-zinc-700 hover:border-marine-cyan hover:text-marine-primary disabled:opacity-50 dark:border-white/10 dark:text-zinc-200">
                            {busyId === 'suggest' ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                            {L(language, `Suggest better pictures (${uncleaned.length})`, `اقترح صور أفضل (${uncleaned.length})`)}
                        </button>
                    )}
                </div>
            </div>

            {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700 dark:bg-red-500/10 dark:text-red-400">{error}</p>}
            {notice && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">{notice}</p>}

            {images.length > 0 && (
                <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
                    {images.map((img, i) => (
                        <a key={img._id || img.url} href={img.url} target="_blank" rel="noopener noreferrer" className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-white/10" title={i === 0 ? L(language, 'Main picture', 'الصورة الأساسية') : ''}>
                            <img src={small(img.url, 160)} alt="" loading="lazy" className="h-full w-full object-contain" />
                            {img.url.includes(ENHANCED) && <span className="absolute bottom-0.5 end-0.5 rounded-full bg-emerald-500 p-0.5 text-white" title={L(language, 'Clean', 'نضيفة')}><Check size={9} /></span>}
                            {i === 0 && <span className="absolute start-0.5 top-0.5 rounded bg-black/60 px-1 text-[8px] font-bold text-white">{L(language, 'Main', 'أساسية')}</span>}
                        </a>
                    ))}
                </div>
            )}

            {sorted.length > 0 ? (
                <div className="grid gap-3 xl:grid-cols-2">
                    {sorted.map((s) => (
                        <SuggestionCard key={s._id} suggestion={s} language={language} busy={busyId === s._id || busyId === 'all'}
                            mainIsClean={!!images[0]?.url?.includes(ENHANCED)} isMain={s.kind === 'enhance' && images[0]?.url === s.source_url}
                            onApply={apply} onDismiss={dismiss} onRetry={retry} />
                    ))}
                </div>
            ) : images.length > 0 && (
                <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-500 dark:bg-white/[0.03]">
                    {uncleaned.length
                        ? L(language, 'No suggestions yet — press "Suggest better pictures".', 'لسه مفيش اقتراحات — دوس "اقترح صور أفضل".')
                        : L(language, 'Every picture is clean or already decided.', 'كل الصور نضيفة أو اتاخد فيها قرار.')}
                </p>
            )}

            <div className="mt-5 border-t border-zinc-100 pt-4 dark:border-white/5">
                {images.length === 0 && (
                    <p className="mb-3 flex items-center gap-2 text-sm font-bold text-amber-700 dark:text-amber-400">
                        <ImageOff size={16} /> {L(language, 'This product has no pictures. Find some on the web:', 'المنتج ده من غير صور. دور على صور ليه في النت:')}
                    </p>
                )}
                {!webOpen ? (
                    <button type="button" onClick={() => setWebOpen(true)} className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-600 hover:text-marine-primary dark:text-zinc-300">
                        <Globe size={14} /> {L(language, 'Find more pictures on the web', 'دور على صور تانية في النت')}
                    </button>
                ) : (
                    <div>
                        <form onSubmit={search} className="flex flex-wrap gap-2">
                            <input
                                value={webQuery}
                                onChange={(e) => setWebQuery(e.target.value)}
                                maxLength={150}
                                dir="auto"
                                className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-marine-cyan dark:border-white/10 dark:bg-[#0E1012] dark:text-white"
                                placeholder={L(language, 'Brand, part number, name…', 'الماركة، رقم القطعة، الاسم…')}
                            />
                            <button type="submit" disabled={web.loading || webQuery.trim().length < 2} className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-bold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900">
                                {web.loading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                                {L(language, 'Search', 'دور')}
                            </button>
                        </form>
                        <p className="mt-1.5 text-[11px] text-zinc-500">
                            {L(language,
                                'Results from Bing image search. Make sure it is exactly this part before adding it — the picture is cleaned and shown above for your OK.',
                                'النتايج من بحث صور Bing. اتأكد إنها نفس القطعة بالظبط قبل ما تضيفها — الصورة بتتنضف وبتظهر فوق تستنى موافقتك.')}
                        </p>
                        {web.error && <p className="mt-2 text-xs font-bold text-red-600">{web.error}</p>}
                        {web.results && web.results.length === 0 && <p className="mt-2 text-xs font-semibold text-zinc-500">{L(language, 'Nothing found — try fewer words or the part number alone.', 'ملقيناش حاجة — جرب كلام أقل أو رقم القطعة لوحده.')}</p>}
                        {web.results && web.results.length > 0 && (
                            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                                {web.results.map((r) => (
                                    <WebResult key={r.image_url} result={r} language={language} state={picks[r.image_url]} onPick={pick} />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </section>
    );
}
