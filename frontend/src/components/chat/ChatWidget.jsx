'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Car, MessageCircle, Mic, RotateCcw, Sparkles, Square, Trash2, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import Overlay from '../Overlay';
import { usePathname } from '../../lib/navigation';
import { assistantApi } from '../../lib/api';
import { chatCopy } from './chatCopy';
import ChatMessage from './ChatMessage';
import { ChatBasket } from './ChatBasket';
import { flyToCart } from './flyToCart';
import {
    addedLines,
    basketLinesOf,
    basketSignature,
    chatBasketLines,
    ensureSession,
    forgetSession,
    noRefusals,
    refusalsOf,
    siteCartChanges,
    storedSession,
} from './chatCart';

/*
 * Ready Marine's own chat window, in place of EverySecond's embedded launcher. It
 * talks to /api/assistant (Backend/services/everysecond/assistant.js), which
 * holds the conversation with the same AI agent that answers on WhatsApp — so
 * the agent's memory, basket and orders are one, whichever door the customer
 * came in by.
 *
 * The chat basket and the website cart are kept in step both ways: what the
 * agent adds lands in the website cart (with a flight into the cart), and what
 * the customer adds on the site — including from a product card here — is put
 * into the agent's basket before they next write.
 */

const MAX_LENGTH = 1000;
const HANDOFF_POLL_MS = 10_000;
const MAX_RECORDING_MS = 120_000;
const TEASER_KEY = 'readycar-chat-teaser-seen';

const toLine = (m) => ({
    key: m.id != null ? `m-${m.id}` : `x-${Math.random().toString(36).slice(2)}`,
    id: m.id ?? null,
    from: m.from,
    author: m.author || '',
    text: m.text || '',
    image: m.image || null,
    audio: m.audio || null,
    transcript: null,
    products: m.products || [],
    order: null,
    state: 'sent',
});

const errorText = (err, copy) => (err?.message && !/fetch|network|timed out/i.test(err.message) ? err.message : copy.error);

const carLabel = (car) => {
    if (!car) return '';
    const brand = car.brand_name || car.car_brand_name || car.car_brand_id?.name || car.brand?.name || '';
    const model = car.model_name || car.car_model_name || car.car_model?.name || car.model?.name || '';
    return [brand, model, car.year].filter(Boolean).join(' ').trim();
};

/* ---------------------------------------------------------------- */
/* Pieces                                                           */
/* ---------------------------------------------------------------- */

function Launcher({ open, onToggle, count, copy, teaser, onDismissTeaser }) {
    return (
        // A phone: the corner just over the bottom bar (64px), a little smaller. From `md` up,
        // where there is no bottom bar, lower in the corner.
        <div className="fixed bottom-[calc(72px+env(safe-area-inset-bottom))] end-3 z-[90] flex flex-col items-end gap-2 md:bottom-6 md:end-5">
            {teaser && !open && (
                <div className="rc-chat-pop relative max-w-[230px] rounded-2xl rounded-ee-md bg-white px-3.5 py-2.5 text-[12.5px] font-semibold leading-5 text-zinc-800 shadow-[0_12px_32px_rgba(0,0,0,0.16)]">
                    <button
                        type="button"
                        onClick={onDismissTeaser}
                        aria-label={copy.close}
                        className="absolute -top-2 -start-2 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-white"
                    >
                        <X size={11} />
                    </button>
                    <button type="button" onClick={onToggle} className="text-start">{copy.teaser}</button>
                </div>
            )}
            <button
                type="button"
                onClick={onToggle}
                aria-label={open ? copy.close : copy.open}
                aria-expanded={open}
                className={`group relative flex h-12 w-12 md:h-14 md:w-14 items-center justify-center rounded-full text-white shadow-[0_12px_30px_rgba(0,166,206,0.35)] transition-all duration-300 hover:scale-105 active:scale-95 ${
                    open ? 'max-sm:hidden bg-zinc-900' : 'bg-gradient-to-br from-[#ef4444] via-marine-cyan to-[#991b1b]'
                }`}
            >
                {!open && <span className="rc-chat-ring absolute inset-0 rounded-full" aria-hidden="true" />}
                <span className={`absolute transition-all duration-300 ${open ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-50 opacity-0'}`}>
                    <X size={24} />
                </span>
                <span className={`absolute transition-all duration-300 ${open ? 'rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100'}`}>
                    <MessageCircle size={25} strokeWidth={2.2} />
                    <Sparkles size={11} className="absolute -end-1 -top-1 text-amber-200" />
                </span>
                {count > 0 && !open && (
                    <span className="absolute -end-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-zinc-900 px-1 text-[10px] font-extrabold" dir="ltr">
                        {count}
                    </span>
                )}
            </button>
        </div>
    );
}

function PanelHeader({ copy, handoff, canReset, onReset, onClose }) {
    return (
        <div className="relative overflow-hidden bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-800 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] text-white">
            <span className="pointer-events-none absolute -end-10 -top-16 h-40 w-40 rounded-full bg-marine-cyan/40 blur-3xl" aria-hidden="true" />
            <span className="pointer-events-none absolute -bottom-20 start-6 h-32 w-32 rounded-full bg-red-500/20 blur-3xl" aria-hidden="true" />
            <div className="relative flex items-center gap-3">
                <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#ef4444] to-[#991b1b] shadow-[0_8px_20px_rgba(0,166,206,0.45)]">
                    <Car size={21} />
                    <Sparkles size={11} className="absolute end-1 top-1 text-amber-200" />
                    <span className="absolute -bottom-0.5 -end-0.5 h-3.5 w-3.5 rounded-full border-[2.5px] border-zinc-900 bg-emerald-400" />
                </span>
                <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-extrabold tracking-tight">{copy.title}</p>
                    <p className="flex items-center gap-1.5 text-[11.5px] text-zinc-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
                        {handoff ? copy.handoffStatus : copy.status}
                    </p>
                </div>
                {canReset && (
                    <button
                        type="button"
                        onClick={onReset}
                        title={copy.reset}
                        aria-label={copy.reset}
                        className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                    >
                        <RotateCcw size={17} />
                    </button>
                )}
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={copy.close}
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                >
                    <X size={20} />
                </button>
            </div>
        </div>
    );
}

function Welcome({ copy, chips, onPick }) {
    return (
        <div className="rc-chat-pop space-y-3">
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-white to-red-50/60 p-4 shadow-[0_8px_26px_rgba(0,0,0,0.06)] ring-1 ring-zinc-100">
                <span className="pointer-events-none absolute -end-6 -top-6 h-24 w-24 rounded-full bg-marine-cyan/10 blur-2xl" aria-hidden="true" />
                <p className="relative text-[16px] font-extrabold text-zinc-900">{copy.welcomeTitle}</p>
                <p className="relative mt-1.5 text-[13px] leading-[21px] text-zinc-600">{copy.welcomeBody}</p>
            </div>
            <div className="flex flex-wrap gap-2">
                {chips.map((chip, i) => (
                    <button
                        key={chip}
                        type="button"
                        onClick={() => onPick(chip)}
                        className="rc-chat-card-in rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-zinc-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-marine-cyan hover:text-marine-primary active:scale-95"
                        style={{ animationDelay: `${120 + i * 60}ms` }}
                    >
                        {chip}
                    </button>
                ))}
            </div>
        </div>
    );
}

function Typing({ hint }) {
    return (
        <div className="rc-chat-msg-in flex items-end gap-2">
            <span className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-800 to-zinc-950 text-white shadow ring-2 ring-white">
                <Sparkles size={13} className="text-red-400" />
            </span>
            <div className="flex items-center gap-2.5 rounded-2xl rounded-es-md border border-zinc-100 bg-white px-3.5 py-2.5 shadow-[0_4px_14px_rgba(0,0,0,0.05)]">
                <span className="flex gap-1" aria-hidden="true">
                    <span className="rc-chat-dot h-1.5 w-1.5 rounded-full bg-marine-cyan" />
                    <span className="rc-chat-dot h-1.5 w-1.5 rounded-full bg-marine-cyan" style={{ animationDelay: '150ms' }} />
                    <span className="rc-chat-dot h-1.5 w-1.5 rounded-full bg-marine-cyan" style={{ animationDelay: '300ms' }} />
                </span>
                <span key={hint} className="rc-chat-fade text-[11.5px] font-medium text-zinc-500">{hint}</span>
            </div>
        </div>
    );
}

function Composer({ copy, value, onChange, onSubmit, disabled, inputRef, recording, recordMs, onStartRecording, onStopRecording, onCancelRecording, canRecord }) {
    if (recording) {
        const s = Math.floor(recordMs / 1000);
        return (
            <div className="flex items-center gap-2 px-3 pb-3 pt-2">
                <button
                    type="button"
                    onClick={onCancelRecording}
                    aria-label={copy.cancelRecord}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                >
                    <Trash2 size={18} />
                </button>
                <div className="flex h-11 flex-1 items-center gap-2.5 rounded-2xl bg-red-50 px-3 text-[13px] font-semibold text-marine-primary">
                    <span className="rc-chat-rec h-2.5 w-2.5 rounded-full bg-marine-cyan" />
                    {copy.recording}
                    <span className="ms-auto font-mono" dir="ltr">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</span>
                </div>
                <button
                    type="button"
                    onClick={onStopRecording}
                    aria-label={copy.stopRecord}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-marine-cyan text-white shadow-[0_8px_18px_rgba(0,166,206,0.35)]"
                >
                    <Square size={15} fill="currentColor" />
                </button>
            </div>
        );
    }
    const empty = !value.trim();
    return (
        <form
            className="flex items-end gap-2 px-3 pb-3 pt-2"
            onSubmit={(e) => {
                e.preventDefault();
                onSubmit();
            }}
        >
            <div className="flex min-h-[44px] flex-1 items-end rounded-2xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 transition-colors focus-within:border-marine-cyan focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(0,166,206,0.08)]">
                <textarea
                    ref={inputRef}
                    rows={1}
                    value={value}
                    maxLength={MAX_LENGTH}
                    dir="auto"
                    placeholder={copy.placeholder}
                    aria-label={copy.placeholder}
                    onChange={(e) => {
                        onChange(e.target.value);
                        e.target.style.height = 'auto';
                        e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            onSubmit();
                        }
                    }}
                    className="max-h-[120px] w-full resize-none bg-transparent text-base leading-6 text-zinc-900 placeholder-zinc-400 outline-none sm:text-[13.5px] sm:leading-[22px]"
                />
            </div>
            {empty && canRecord ? (
                <button
                    type="button"
                    onClick={onStartRecording}
                    disabled={disabled}
                    aria-label={copy.record}
                    title={copy.record}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-900 text-white transition-all hover:bg-zinc-800 active:scale-90 disabled:opacity-50"
                >
                    <Mic size={18} />
                </button>
            ) : (
                <button
                    type="submit"
                    disabled={disabled || empty}
                    aria-label={copy.send}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-marine-cyan text-white shadow-[0_8px_18px_rgba(0,166,206,0.35)] transition-all hover:bg-marine-cyan-dark active:scale-90 disabled:opacity-40 disabled:shadow-none"
                >
                    <ArrowUp size={19} strokeWidth={2.6} />
                </button>
            )}
        </form>
    );
}

/* ---------------------------------------------------------------- */
/* The widget                                                       */
/* ---------------------------------------------------------------- */

export default function ChatWidget() {
    const { language, user, isMounted, cartItems, addToCart, applyCartChanges, orderedSeq, setIsCartOpen } = useApp();
    const pathname = usePathname();
    const copy = chatCopy(language);
    const locale = language === 'en' ? 'en' : 'ar';
    const signedIn = user?.role === 'user';
    const identity = signedIn ? `u:${user._id || user.id}` : 'anon';

    const [open, setOpen] = useState(false);
    const [teaser, setTeaser] = useState(false);
    const [enabled, setEnabled] = useState(true);
    const [lines, setLines] = useState([]);
    const [loadedFor, setLoadedFor] = useState(null);
    const [input, setInput] = useState('');
    const [pending, setPending] = useState(false);
    const [notice, setNotice] = useState(null); // 'handoff' | 'held' | null
    const [cart, setCart] = useState(null);
    const [cartSync, setCartSync] = useState(false);
    const [hint, setHint] = useState(0);
    const [recording, setRecording] = useState(false);
    const [recordMs, setRecordMs] = useState(0);

    const scrollRef = useRef(null);
    const inputRef = useRef(null);
    const linesRef = useRef(lines);
    const openRef = useRef(open);
    const recorderRef = useRef(null);
    const recordTimerRef = useRef(null);
    const cancelRecordingRef = useRef(false);

    useEffect(() => { linesRef.current = lines; }, [lines]);
    useEffect(() => { openRef.current = open; }, [open]);

    const sessionFor = useCallback((create) => (create ? ensureSession() : storedSession() || undefined), []);

    /* ---------- the two carts ---------- */

    const cartRef = useRef(null);
    const setChatCart = useCallback((next) => {
        cartRef.current = next;
        setCart(next);
    }, []);
    const siteLines = useMemo(() => basketLinesOf(cartItems), [cartItems]);
    const siteLinesRef = useRef(siteLines);
    const pushedRef = useRef(null);
    const refusalsRef = useRef(noRefusals());
    const pushQueue = useRef(Promise.resolve());
    const cartSyncRef = useRef(cartSync);
    const orderedSeqRef = useRef(orderedSeq);

    useEffect(() => {
        siteLinesRef.current = siteLines;
        cartSyncRef.current = cartSync;
    }, [siteLines, cartSync]);

    const resetCartSync = useCallback(() => {
        pushedRef.current = null;
        refusalsRef.current = noRefusals();
    }, []);

    /* Website cart → chat basket. One push at a time, so a message never overtakes the cart it should see. */
    const pushSiteCart = useCallback((create) => {
        const run = async () => {
            if (!cartSyncRef.current || !isMounted) return;
            const items = siteLinesRef.current;
            const signature = basketSignature(items, refusalsRef.current);
            if (signature === basketSignature(chatBasketLines(cartRef.current)) || signature === pushedRef.current) return;
            const sessionId = sessionFor(create);
            if (!signedIn && !sessionId) return;
            pushedRef.current = signature;
            try {
                const res = await assistantApi.syncCart({ sessionId, locale, create, items });
                refusalsRef.current = refusalsOf(res);
                pushedRef.current = basketSignature(items, refusalsRef.current);
                if (res.synced && !res.unchanged && res.cart !== undefined) setChatCart(res.cart);
            } catch {
                pushedRef.current = null; // try again on the next change
            }
        };
        pushQueue.current = pushQueue.current.then(run, run);
        return pushQueue.current;
    }, [isMounted, locale, sessionFor, setChatCart, signedIn]);

    /*
     * What the agent's turn changed: applied to the website cart, and every
     * product it added flies from its card (or the reply) into the cart.
     */
    const receiveCart = useCallback((next) => {
        const previous = cartRef.current;
        const added = addedLines(previous, next);
        applyCartChanges(siteCartChanges(previous, next));
        setChatCart(next);
        if (!openRef.current || !added.length) return;
        requestAnimationFrame(() => {
            const panel = scrollRef.current;
            added.slice(0, 4).forEach((line, i) => {
                const card = line.externalId && panel?.querySelector(`[data-chat-card="${CSS.escape(line.externalId)}"] img`);
                const fallback = panel?.querySelector('[data-chat-last-reply]') || panel;
                flyToCart({ fromEl: card || fallback, imageUrl: line.image, qty: line.qty, delay: i * 140 });
            });
        });
    }, [applyCartChanges, setChatCart]);

    /* ---------- load the conversation once per identity, the first time the panel opens ---------- */

    useEffect(() => {
        if (!open || !isMounted || loadedFor === identity) return undefined;
        let cancelled = false;
        (async () => {
            try {
                const data = await assistantApi.history({ sessionId: signedIn ? undefined : storedSession() || undefined });
                if (cancelled) return;
                setEnabled(data.enabled !== false);
                setLines((data.messages || []).map(toLine));
                setChatCart(data.cart ?? null);
                setCartSync(data.cartSync === true);
            } catch {
                if (cancelled) return;
                setEnabled(true); // history is a convenience; the customer can still write
                setLines([]);
                setChatCart(null);
            }
            resetCartSync();
            setNotice(null);
            setLoadedFor(identity);
        })();
        return () => { cancelled = true; };
    }, [open, isMounted, identity, loadedFor, signedIn, setChatCart, resetCartSync]);

    /*
     * Website → chat while a conversation exists, a moment after the cart changes —
     * almost at once when the change was made in the chat's own basket, where the
     * customer is watching the numbers.
     */
    const chatExists = lines.length > 0 || cart !== null;
    const urgentPushRef = useRef(false);
    useEffect(() => {
        if (!cartSync || loadedFor !== identity || !chatExists || pending) return undefined;
        const delay = urgentPushRef.current ? 150 : 900;
        urgentPushRef.current = false;
        const timer = setTimeout(() => void pushSiteCart(false), delay);
        return () => clearTimeout(timer);
    }, [cartSync, loadedFor, identity, chatExists, pending, siteLines, cart, pushSiteCart]);

    /* An order placed on the website closes the agent's basket, so it does not offer it again. */
    useEffect(() => {
        if (orderedSeq === orderedSeqRef.current) return;
        orderedSeqRef.current = orderedSeq;
        const sessionId = signedIn ? undefined : storedSession() || undefined;
        if (!signedIn && !sessionId) return;
        pushedRef.current = basketSignature(siteLinesRef.current, refusalsRef.current);
        assistantApi.closeCart({ sessionId })
            .then((res) => { if (res?.closed) setChatCart(null); })
            .catch(() => {});
    }, [orderedSeq, signedIn, setChatCart]);

    /* ---------- panel behaviour ---------- */

    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: loadedFor ? 'smooth' : 'auto' });
    }, [lines, pending, notice, open, loadedFor]);

    useEffect(() => {
        if (open && window.matchMedia('(min-width: 640px)').matches) inputRef.current?.focus();
    }, [open, loadedFor]);

    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('keydown', onKey);
        // Full screen on a phone: the page behind should not scroll.
        const phone = window.matchMedia('(max-width: 639px)').matches;
        const previous = document.body.style.overflow;
        if (phone) document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            if (phone) document.body.style.overflow = previous;
        };
    }, [open]);

    useEffect(() => {
        if (!pending) return undefined;
        setHint(0);
        const timer = setInterval(() => setHint((h) => (h + 1) % copy.typing.length), 2200);
        return () => clearInterval(timer);
    }, [pending, copy.typing.length]);

    /* The teaser bubble, once per browser session, never on checkout. */
    useEffect(() => {
        if (!isMounted || pathname?.startsWith('/checkout')) return undefined;
        let seen = false;
        try { seen = sessionStorage.getItem(TEASER_KEY) === '1'; } catch { /* private mode */ }
        if (seen) return undefined;
        const timer = setTimeout(() => setTeaser(true), 9000);
        return () => clearTimeout(timer);
    }, [isMounted, pathname]);

    const dismissTeaser = useCallback(() => {
        setTeaser(false);
        try { sessionStorage.setItem(TEASER_KEY, '1'); } catch { /* private mode */ }
    }, []);

    const toggle = useCallback(() => {
        setOpen((v) => !v);
        dismissTeaser();
    }, [dismissTeaser]);

    /* A teammate took over: their replies only reach us by asking, so ask while the panel is open. */
    useEffect(() => {
        if (!open || notice !== 'handoff') return undefined;
        const timer = setInterval(async () => {
            const lastId = [...linesRef.current].reverse().find((l) => l.id != null)?.id ?? null;
            try {
                const data = await assistantApi.history({ sessionId: signedIn ? undefined : storedSession() || undefined, after: lastId });
                const fresh = (data.messages || []).filter((m) => m.from === 'assistant').map(toLine);
                if (fresh.length) setLines((prev) => [...prev, ...fresh.filter((f) => !prev.some((p) => p.key === f.key))]);
            } catch {
                // next tick
            }
        }, HANDOFF_POLL_MS);
        return () => clearInterval(timer);
    }, [open, notice, signedIn]);

    /* ---------- sending ---------- */

    const applyReply = useCallback((res, localKey, extra = {}) => {
        setLines((prev) => {
            const next = prev.map((l) => (l.key === localKey ? { ...l, ...extra, id: res.messageId ?? l.id, state: 'sent' } : l));
            if (res.reply) {
                next.push({ ...toLine(res.reply), order: res.order || null });
            } else if (res.order) {
                next.push({ ...toLine({ id: null, from: 'assistant', text: '' }), order: res.order });
            }
            return next;
        });
        if ('cart' in res) receiveCart(res.cart);
        else if (res.order) receiveCart(null);
        setNotice(res.status === 'handoff' ? 'handoff' : ['held', 'media_ticket'].includes(res.status) ? 'held' : null);
    }, [receiveCart]);

    const failLine = useCallback((localKey, err) => {
        setLines((prev) => prev.map((l) => (l.key === localKey ? { ...l, state: 'failed', error: errorText(err, copy) } : l)));
    }, [copy]);

    const submit = useCallback(async (raw) => {
        const text = String(raw || '').trim().slice(0, MAX_LENGTH);
        if (!text || pending) return;
        const key = `local-${Date.now()}`;
        setLines((prev) => [...prev.filter((l) => l.state !== 'failed'), { ...toLine({ id: null, from: 'customer', text }), key, state: 'sending' }]);
        setInput('');
        if (inputRef.current) inputRef.current.style.height = 'auto';
        setPending(true);
        setNotice(null);
        try {
            await pushSiteCart(true); // the agent answers from the cart the customer is looking at
            const res = await assistantApi.send({ sessionId: ensureSession(), message: text, locale });
            applyReply(res, key);
        } catch (err) {
            failLine(key, err);
        } finally {
            setPending(false);
        }
    }, [pending, pushSiteCart, locale, applyReply, failLine]);

    const submitVoice = useCallback(async (blob) => {
        if (!blob || pending) return;
        const key = `local-voice-${Date.now()}`;
        const url = URL.createObjectURL(blob);
        setLines((prev) => [...prev.filter((l) => l.state !== 'failed'), { ...toLine({ id: null, from: 'customer', text: copy.voiceNote }), key, audio: url, blob, state: 'sending' }]);
        setPending(true);
        setNotice(null);
        try {
            await pushSiteCart(true);
            const res = await assistantApi.sendVoice({ sessionId: ensureSession(), locale, blob });
            applyReply(res, key, { transcript: res.transcript || null });
        } catch (err) {
            failLine(key, err);
        } finally {
            setPending(false);
        }
    }, [pending, pushSiteCart, locale, applyReply, failLine, copy.voiceNote]);

    const retry = useCallback((line) => {
        setLines((prev) => prev.filter((l) => l.key !== line.key));
        if (line.blob) submitVoice(line.blob);
        else submit(line.text);
    }, [submit, submitVoice]);

    /* ---------- voice notes ---------- */

    const canRecord = isMounted && typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

    const stopTracks = (recorder) => recorder?.stream?.getTracks().forEach((t) => t.stop());

    const startRecording = useCallback(async () => {
        if (recording || pending) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => window.MediaRecorder.isTypeSupported?.(t));
            const recorder = new window.MediaRecorder(stream, type ? { mimeType: type } : undefined);
            const chunks = [];
            const startedAt = Date.now();
            cancelRecordingRef.current = false;
            recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
            recorder.onstop = () => {
                stopTracks(recorder);
                clearInterval(recordTimerRef.current);
                setRecording(false);
                if (cancelRecordingRef.current || Date.now() - startedAt < 700) return;
                submitVoice(new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' }));
            };
            recorderRef.current = recorder;
            recorder.start();
            setRecordMs(0);
            setRecording(true);
            recordTimerRef.current = setInterval(() => {
                const ms = Date.now() - startedAt;
                setRecordMs(ms);
                if (ms >= MAX_RECORDING_MS && recorder.state === 'recording') recorder.stop();
            }, 250);
        } catch {
            window.alert(copy.micDenied);
        }
    }, [recording, pending, submitVoice, copy.micDenied]);

    const stopRecording = useCallback(() => {
        if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    }, []);

    const cancelRecording = useCallback(() => {
        cancelRecordingRef.current = true;
        stopRecording();
    }, [stopRecording]);

    useEffect(() => () => {
        clearInterval(recordTimerRef.current);
        stopTracks(recorderRef.current);
    }, []);

    /* ---------- actions from inside the chat ---------- */

    const closeOnPhone = useCallback(() => {
        if (window.matchMedia('(max-width: 639px)').matches) setOpen(false);
    }, []);

    const addCard = useCallback((card, imageEl) => {
        if (!card?.cart?.product) return false;
        const ok = addToCart(card.cart.product, card.cart.variant || null, 1, { openDrawer: false });
        if (ok) flyToCart({ fromEl: imageEl, imageUrl: card.image, qty: 1 });
        return ok;
    }, [addToCart]);

    /*
     * − / + / remove / empty in the chat's basket. They change the website cart,
     * and the cart goes into the agent's basket a moment later — a basket the
     * agent itself cannot empty (EverySecond keeps the last line), but this can.
     */
    const editBasketLine = useCallback((line, delta) => {
        if (!line?.cart?.product?._id || !delta) return;
        urgentPushRef.current = true;
        applyCartChanges([{ ref: line.cart, delta }]);
    }, [applyCartChanges]);

    const emptyBasket = useCallback(() => {
        const ours = (cartRef.current?.items || []).filter((l) => l.cart?.product?._id);
        if (!ours.length || !window.confirm(copy.emptyConfirm)) return;
        urgentPushRef.current = true;
        applyCartChanges(ours.map((l) => ({ ref: l.cart, delta: -l.qty })));
    }, [applyCartChanges, copy.emptyConfirm]);

    const checkoutOnSite = useCallback(() => {
        setOpen(false);
        setIsCartOpen(true);
    }, [setIsCartOpen]);

    const reset = useCallback(async () => {
        if (!window.confirm(copy.resetConfirm)) return;
        try {
            await assistantApi.reset({ sessionId: signedIn ? undefined : storedSession() || undefined });
        } catch {
            // start over locally either way
        }
        if (!signedIn) forgetSession();
        setLines([]);
        setChatCart(null);
        setNotice(null);
        resetCartSync();
    }, [copy.resetConfirm, signedIn, setChatCart, resetCartSync]);

    const chips = useMemo(() => {
        const car = carLabel(user?.cars?.[0]);
        return car ? [copy.myCarChip(car), ...copy.chips.slice(1)] : copy.chips;
    }, [user, copy]);

    if (!isMounted) return null;

    const basketCount = (cart?.items || []).reduce((s, l) => s + l.qty, 0);
    const lastAssistant = [...lines].reverse().find((l) => l.from === 'assistant')?.key;

    return (
        <>
            <Launcher open={open} onToggle={toggle} count={basketCount} copy={copy} teaser={teaser} onDismissTeaser={dismissTeaser} />

            <Overlay
                role="dialog"
                aria-label={copy.title}
                aria-hidden={!open}
                // Closed, nothing inside can take focus (React 18 needs the string form).
                {...(!open ? { inert: '' } : {})}
                dir={locale === 'ar' ? 'rtl' : 'ltr'}
                // Full screen on a phone, so above the bottom bar (MobileBottomNav, z-100) — under it,
                // the bar covered the message box. "Check out on the site" closes the chat first,
                // so the cart drawer (z-101) is never under it.
                className={`fixed z-[105] sm:z-[95] flex flex-col overflow-hidden bg-zinc-50 shadow-[0_24px_70px_rgba(0,0,0,0.28)] transition-[opacity,transform] duration-300 ease-[cubic-bezier(.2,.8,.2,1)]
                    inset-0 h-[100dvh]
                    sm:inset-auto sm:bottom-[92px] sm:end-5 sm:h-[min(680px,calc(100dvh-120px))] sm:w-[400px] sm:rounded-[28px] sm:ring-1 sm:ring-black/5
                    ${open ? 'pointer-events-auto translate-y-0 scale-100 opacity-100' : 'pointer-events-none translate-y-6 scale-[.97] opacity-0'}
                    sm:origin-bottom-right rtl:sm:origin-bottom-left`}
            >
                <PanelHeader copy={copy} handoff={notice === 'handoff'} canReset={lines.length > 0} onReset={reset} onClose={() => setOpen(false)} />

                <div ref={scrollRef} className="rc-chat-scroll flex-1 space-y-3 overflow-y-auto overscroll-contain px-3.5 py-4">
                    {loadedFor !== identity && open ? (
                        <div className="space-y-3">
                            <div className="h-24 animate-pulse rounded-3xl bg-zinc-200/70" />
                            <div className="h-10 w-2/3 animate-pulse rounded-2xl bg-zinc-200/70" />
                        </div>
                    ) : lines.length === 0 ? (
                        <Welcome copy={copy} chips={chips} onPick={submit} />
                    ) : (
                        lines.map((line) => (
                            <div key={line.key} {...(line.key === lastAssistant ? { 'data-chat-last-reply': '' } : {})}>
                                <ChatMessage
                                    line={line}
                                    language={locale}
                                    signedIn={signedIn}
                                    onAddCard={addCard}
                                    onNavigate={closeOnPhone}
                                    onRetry={retry}
                                />
                            </div>
                        ))
                    )}
                    {pending && <Typing hint={copy.typing[hint]} />}
                    {notice && (
                        <p className="rc-chat-pop mx-auto w-fit max-w-[90%] rounded-full bg-zinc-900 px-3 py-1.5 text-center text-[11.5px] font-semibold text-white">
                            {notice === 'handoff' ? copy.handoff : copy.held}
                        </p>
                    )}
                    {!enabled && <p className="text-center text-[12px] text-zinc-500">{copy.offline}</p>}
                </div>

                <div className="border-t border-zinc-200/70 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur">
                    <div className="pt-2">
                        <ChatBasket
                            cart={cart}
                            language={locale}
                            busy={pending}
                            onComplete={() => submit(copy.completeMessage)}
                            onCheckout={checkoutOnSite}
                            onNavigate={closeOnPhone}
                            onEdit={editBasketLine}
                            onEmpty={emptyBasket}
                        />
                    </div>
                    <Composer
                        copy={copy}
                        value={input}
                        onChange={setInput}
                        onSubmit={() => submit(input)}
                        disabled={pending || !enabled}
                        inputRef={inputRef}
                        recording={recording}
                        recordMs={recordMs}
                        onStartRecording={startRecording}
                        onStopRecording={stopRecording}
                        onCancelRecording={cancelRecording}
                        canRecord={canRecord}
                    />
                    <p className="pb-2 text-center text-[10px] text-zinc-400">{copy.footer}</p>
                </div>
            </Overlay>
        </>
    );
}
