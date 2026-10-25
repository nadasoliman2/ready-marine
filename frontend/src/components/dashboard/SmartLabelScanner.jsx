'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, ScanLine, Camera, X, CheckCircle2, Link2Off, AlertTriangle } from 'lucide-react';
import Overlay from '../Overlay';

/**
 * Smart Label scanning panel.
 *
 * Built for someone standing in a warehouse holding a parcel, not sitting at a desk:
 * the field is always focused so a Bluetooth scanner types straight into it, Enter submits
 * (that is what scanners send), and the field clears and refocuses itself after a success
 * so parcels can be done back to back without touching the screen. Success and failure
 * have different sounds because nobody is looking at the screen while holding a box.
 *
 * The camera is the fallback, not the default: these are 1D barcodes, which a phone camera
 * reads far less reliably than a scanner does — especially in warehouse lighting.
 */

/** Short WebAudio blips — no asset to load, and they work with the screen off-axis. */
function playTone(pattern) {
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        let at = ctx.currentTime;
        for (const [freq, duration] of pattern) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = freq;
            osc.type = 'sine';
            gain.gain.setValueAtTime(0.12, at);
            gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
            osc.connect(gain).connect(ctx.destination);
            osc.start(at);
            osc.stop(at + duration);
            at += duration;
        }
        setTimeout(() => ctx.close().catch(() => {}), (at - ctx.currentTime + 0.1) * 1000);
    } catch (_) {
        // Audio is a nicety; a browser that refuses it must not break scanning.
    }
}

const beepSuccess = () => playTone([[880, 0.09], [1320, 0.11]]);
const beepError = () => playTone([[220, 0.18], [180, 0.22]]);

export default function SmartLabelScanner({
    label,              // the scanned label, or null
    canScan,            // scanning allowed right now
    dispatched,         // the shipment is already on Bosta — the label is frozen
    waybill = null,     // tracking number of a live shipment that carries NO sticker (printed route)
    onScan,             // async (trackingNumber) => void; throws Error with a readable message
    onUnlink,           // async () => void
    isAr,
    vendorName = '',    // shown on the admin side, where several vendors share the panel
}) {
    const [value, setValue] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [flash, setFlash] = useState('');
    const [cameraOpen, setCameraOpen] = useState(false);
    const [cameraError, setCameraError] = useState('');

    const inputRef = useRef(null);
    const videoRef = useRef(null);

    const focusInput = useCallback(() => {
        // Deferred: on mobile the keyboard/camera sheet is still closing on this tick.
        setTimeout(() => inputRef.current?.focus(), 50);
    }, []);

    useEffect(() => {
        if (canScan && !label && !cameraOpen) focusInput();
    }, [canScan, label, cameraOpen, focusInput]);

    const submit = useCallback(async (raw) => {
        const number = String(raw || '').trim();
        if (!number || busy) return;

        setBusy(true);
        setError('');
        try {
            await onScan(number);
            beepSuccess();
            setValue('');
            setFlash(isAr ? `تم تسجيل الملصق ${number}` : `Label ${number} saved`);
            setTimeout(() => setFlash(''), 4000);
            focusInput();
        } catch (err) {
            beepError();
            setError(err?.message || (isAr ? 'تعذر تسجيل الملصق.' : 'Could not save the label.'));
            // Kept in the field on failure so a mistyped number can be corrected rather
            // than re-scanned from a parcel the vendor may have already put down.
            focusInput();
        } finally {
            setBusy(false);
        }
    }, [busy, onScan, isAr, focusInput]);

    const unlink = async () => {
        if (busy) return;
        const ok = window.confirm(isAr
            ? 'سيتم فك ربط الملصق ويمكن استخدامه مرة أخرى. متابعة؟'
            : 'This releases the label so it can be used again. Continue?');
        if (!ok) return;

        setBusy(true);
        setError('');
        try {
            await onUnlink();
            setValue('');
            focusInput();
        } catch (err) {
            beepError();
            setError(err?.message || (isAr ? 'تعذر فك الربط.' : 'Could not unlink the label.'));
        } finally {
            setBusy(false);
        }
    };

    /* ---------------- Camera fallback ---------------- */
    useEffect(() => {
        if (!cameraOpen) return undefined;

        let stream = null;
        let timer = null;
        let stopped = false;

        const stop = () => {
            stopped = true;
            if (timer) clearTimeout(timer);
            if (stream) stream.getTracks().forEach((t) => t.stop());
        };

        (async () => {
            if (typeof window === 'undefined' || !('BarcodeDetector' in window)) {
                setCameraError(isAr
                    ? 'المتصفح ده مش بيدعم المسح بالكاميرا — استخدم قارئ الباركود أو اكتب الرقم.'
                    : 'This browser cannot scan with the camera — use a barcode scanner or type the number.');
                return;
            }
            try {
                const detector = new window.BarcodeDetector();
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: 'environment' } },
                });
                if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }

                const video = videoRef.current;
                if (!video) return;
                video.srcObject = stream;
                await video.play();

                // Polled rather than per-frame: detection is expensive and five looks a
                // second is more than enough to catch a barcode being held up.
                const tick = async () => {
                    if (stopped) return;
                    try {
                        const codes = await detector.detect(video);
                        const found = codes?.[0]?.rawValue?.trim();
                        if (found) {
                            stop();
                            setCameraOpen(false);
                            submit(found);
                            return;
                        }
                    } catch (_) {
                        // A frame that can't be decoded is the normal case, not an error.
                    }
                    timer = setTimeout(tick, 200);
                };
                tick();
            } catch (err) {
                setCameraError(
                    err?.name === 'NotAllowedError' || err?.name === 'SecurityError'
                        ? (isAr
                            ? 'مفيش إذن للكاميرا — استخدم قارئ الباركود أو اكتب الرقم.'
                            : 'Camera permission denied — use a barcode scanner or type the number.')
                        : (err?.message || (isAr ? 'تعذر تشغيل الكاميرا.' : 'Could not start the camera.'))
                );
            }
        })();

        return stop;
    }, [cameraOpen, isAr, submit]);

    const openCamera = () => { setCameraError(''); setCameraOpen(true); };

    /* ---------------- Render ---------------- */
    const frozen = dispatched || label?.status === 'dispatched';
    // A printed waybill already covers this parcel. The sticker is then OPTIONAL: the panel
    // must not shout "needs a label" at a box that is fully labelled with a waybill.
    const hasWaybill = !label && !!waybill;

    return (
        <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-zinc-50/60 dark:bg-white/[0.02] p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                    <ScanLine size={16} className="text-marine-primary" />
                    <span className="text-xs font-black text-zinc-900 dark:text-white uppercase tracking-widest">
                        {isAr ? 'ملصق بوسطة' : 'Bosta Label'}
                    </span>
                    {vendorName && <span className="text-xs text-zinc-400">— {vendorName}</span>}
                </div>

                {label ? (
                    <span className="inline-flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-widest bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 size={12} />
                        {frozen ? (isAr ? 'تم الإرسال' : 'Dispatched') : (isAr ? 'تم المسح' : 'Scanned')}
                    </span>
                ) : hasWaybill ? (
                    <span className="inline-flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-widest bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 size={12} />
                        {isAr ? 'بوليصة جاهزة' : 'Waybill ready'}
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-widest bg-amber-500/15 text-amber-600 dark:text-amber-400">
                        <AlertTriangle size={12} />
                        {isAr ? 'محتاج ملصق أو بوليصة' : 'Needs a sticker or a waybill'}
                    </span>
                )}
            </div>

            {label ? (
                <div className="space-y-2">
                    <p className="font-mono font-black text-lg text-zinc-900 dark:text-white break-all">
                        {label.tracking_number}
                    </p>
                    <p className="text-[11px] text-zinc-400">
                        {label.scanned_by_label ? `${label.scanned_by_label} · ` : ''}
                        {label.scanned_at
                            ? new Date(label.scanned_at).toLocaleString(isAr ? 'ar-u-ca-gregory' : 'en-US', {
                                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                            })
                            : ''}
                    </p>
                    {frozen ? (
                        <p className="text-[11px] text-zinc-500">
                            {isAr
                                ? 'الشحنة اتبعتت لبوسطة — الربط اتقفل. لفك الربط لازم تلغي الشحنة على بوسطة.'
                                : 'The shipment is on Bosta — the link is locked. Cancel it on Bosta to release the number.'}
                        </p>
                    ) : (
                        <button
                            type="button"
                            onClick={unlink}
                            disabled={busy}
                            className="inline-flex items-center gap-2 text-xs font-bold text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-xl px-3 py-2 transition-colors disabled:opacity-50"
                        >
                            {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2Off size={14} />}
                            {isAr ? 'فك الربط' : 'Unlink'}
                        </button>
                    )}
                </div>
            ) : canScan ? (
                <div className="space-y-3">
                    {hasWaybill && (
                        <p className="text-xs text-zinc-500 leading-relaxed">
                            {isAr
                                ? `الشحنة معاها بوليصة رقم ${waybill}. الملصق الذكي اختياري — لو عندك واحد اسكنه وهيتربط بالشحنة دي، ولو مفيش كمّل بالبوليصة المطبوعة.`
                                : `This parcel already has waybill ${waybill}. The Smart Sticker is optional — scan one to link it to this shipment, or carry on with the printed waybill.`}
                        </p>
                    )}
                    <div className="flex gap-2">
                        <input
                            ref={inputRef}
                            type="text"
                            inputMode="text"
                            autoComplete="off"
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            onKeyDown={(e) => {
                                // Barcode scanners finish with Enter — this is the main path.
                                if (e.key === 'Enter') { e.preventDefault(); submit(value); }
                            }}
                            placeholder={isAr ? 'امسح الملصق أو اكتب الرقم' : 'Scan the label or type the number'}
                            disabled={busy}
                            className="flex-1 min-w-0 font-mono text-base bg-white dark:bg-[#0E1012] border-2 border-marine-cyan/40 focus:border-marine-cyan text-zinc-900 dark:text-white rounded-xl px-3 py-3 focus:outline-none transition-colors disabled:opacity-60"
                        />
                        <button
                            type="button"
                            onClick={openCamera}
                            disabled={busy}
                            title={isAr ? 'المسح بالكاميرا' : 'Scan with the camera'}
                            className="w-14 flex items-center justify-center rounded-xl bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan hover:text-marine-primary transition-colors disabled:opacity-50"
                        >
                            <Camera size={22} />
                        </button>
                    </div>
                    <button
                        type="button"
                        onClick={() => submit(value)}
                        disabled={busy || !value.trim()}
                        className="w-full bg-marine-cyan text-white font-bold py-3 rounded-xl hover:bg-marine-cyan-dark transition-colors text-sm flex items-center justify-center gap-2 disabled:opacity-40"
                    >
                        {busy ? <Loader2 size={16} className="animate-spin" /> : <ScanLine size={16} />}
                        {isAr ? 'تسجيل الملصق' : 'Save label'}
                    </button>
                </div>
            ) : hasWaybill ? (
                <p className="text-xs text-zinc-500">
                    {isAr
                        ? `الشحنة معاها بوليصة رقم ${waybill} — مفيش حاجة مطلوبة هنا.`
                        : `This parcel already has waybill ${waybill} — nothing is needed here.`}
                </p>
            ) : (
                <p className="text-xs text-zinc-500">
                    {isAr
                        ? 'المسح متاح بعد ما توافق على أصنافك في الأوردر.'
                        : 'Scanning opens once the items on this order have been reviewed.'}
                </p>
            )}

            {flash && (
                <p className="flex items-center gap-2 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 size={14} /> {flash}
                </p>
            )}
            {error && (
                <p className="flex items-start gap-2 text-xs font-bold text-red-600 dark:text-red-400 bg-red-500/10 rounded-xl p-3">
                    <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {error}
                </p>
            )}

            {cameraOpen && (
                <Overlay className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-[#14171A] rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-white/5">
                            <span className="text-sm font-black text-zinc-900 dark:text-white">
                                {isAr ? 'وجّه الكاميرا على الباركود' : 'Point the camera at the barcode'}
                            </span>
                            <button
                                type="button"
                                onClick={() => setCameraOpen(false)}
                                className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        {cameraError ? (
                            <p className="p-6 text-sm font-bold text-red-600 dark:text-red-400">{cameraError}</p>
                        ) : (
                            <video
                                ref={videoRef}
                                playsInline
                                muted
                                className="w-full aspect-[4/3] object-cover bg-black"
                            />
                        )}
                        <div className="px-4 py-3 border-t border-zinc-100 dark:border-white/5">
                            <p className="text-[11px] text-zinc-500">
                                {isAr
                                    ? 'الباركود الخطي محتاج إضاءة كويسة ومحاذاة — لو صعب، استخدم قارئ الباركود أو اكتب الرقم.'
                                    : 'A 1D barcode needs good light and alignment — if it will not read, use a scanner or type the number.'}
                            </p>
                        </div>
                    </div>
                </Overlay>
            )}
        </div>
    );
}
