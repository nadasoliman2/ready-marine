'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ShieldCheck, Mail, Phone, MessageCircle, Loader2, CheckCircle2, AlertCircle, X, Pencil,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { verificationApi } from '../../lib/api';
import { verificationCopy, verificationErrorCopy } from '../../lib/verificationLocalization';
import OtpInput from './OtpInput';
import Overlay from '../Overlay';

/** Remembered per browser so the modal does not reappear on every page change. */
const SNOOZE_KEY = 'readycar_verify_prompt_snoozed_at';
const SNOOZE_HOURS = 24;

const isSnoozed = () => {
    try {
        const at = Number(localStorage.getItem(SNOOZE_KEY) || 0);
        return at > 0 && Date.now() - at < SNOOZE_HOURS * 60 * 60 * 1000;
    } catch (_) {
        return false;
    }
};

/**
 * Asks a signed-in customer — or a store owner — to confirm their email and
 * phone number.
 *
 * Registration proves exactly one of the two: whichever channel the code went
 * to. This is what asks for the other. It matters more for a store, whose
 * email receives password resets, order notifications and payout
 * correspondence, and which until now had no way to prove it at all.
 *
 * Deliberately NOT a hard gate: an unverified account can still browse, buy,
 * and sell. It is a prompt because the cost of being wrong — locking someone
 * out of an account they already trade with — outweighs the benefit of forcing
 * it. Dismissing snoozes it for a day; it returns until both are confirmed.
 */
export default function VerifyContactPrompt() {
    const { user, language, isMounted } = useApp();
    const isAr = language === 'ar';
    const vc = useMemo(() => verificationCopy(isAr), [isAr]);

    const [status, setStatus] = useState(null);
    const [open, setOpen] = useState(false);
    const [dismissed, setDismissed] = useState(true);

    // Per-target UI state: 'idle' | 'editing' | 'code'
    const [stage, setStage] = useState({ email: 'idle', phone: 'idle' });
    const [drafts, setDrafts] = useState({ email: '', phone: '' });
    const [codes, setCodes] = useState({ email: '', phone: '' });
    const [busy, setBusy] = useState('');
    const [feedback, setFeedback] = useState({ type: '', text: '', target: '' });

    // Admins have no customer-facing contact details to prove; everyone else
    // signed in does. The API decides which account the code belongs to from
    // the session, so this component needs no role branch beyond that.
    const isEligible = !!user && user.role !== 'admin';

    const load = useCallback(async () => {
        try {
            const data = await verificationApi.getStatus();
            setStatus(data);
            setDrafts({ email: data.pending_email || data.email || '', phone: data.pending_phone || data.phone || '' });
            return data;
        } catch (_) {
            return null;
        }
    }, []);

    useEffect(() => {
        if (!isMounted || !isEligible) return;
        let cancelled = false;
        load().then((data) => {
            if (cancelled || !data || data.fully_verified) return;
            setDismissed(isSnoozed());
            if (!isSnoozed()) setOpen(true);
        });
        return () => { cancelled = true; };
    }, [isMounted, isEligible, load]);

    if (!isMounted || !isEligible || !status || status.fully_verified) return null;

    const snooze = () => {
        try { localStorage.setItem(SNOOZE_KEY, String(Date.now())); } catch (_) { /* private mode */ }
        setOpen(false);
        setDismissed(true);
    };

    const sendCode = async (target, withValue = false) => {
        setBusy(target);
        setFeedback({ type: '', text: '', target: '' });
        try {
            await verificationApi.send({
                target,
                value: withValue ? drafts[target] : undefined,
                language,
            });
            setStage((s) => ({ ...s, [target]: 'code' }));
            setCodes((c) => ({ ...c, [target]: '' }));
            await load();
        } catch (err) {
            setFeedback({
                type: 'error',
                target,
                text: verificationErrorCopy(err.code, isAr, { retryAfterSeconds: err.retryAfterSeconds }) || err.message,
            });
        } finally {
            setBusy('');
        }
    };

    const confirmCode = async (target, submitted) => {
        const code = String(submitted ?? codes[target]);
        if (code.length !== 6) return;

        setBusy(target);
        setFeedback({ type: '', text: '', target: '' });
        try {
            const result = await verificationApi.confirm({ target, code });
            setStage((s) => ({ ...s, [target]: 'idle' }));
            setFeedback({ type: 'success', target, text: vc.verified });
            const fresh = await load();
            if (fresh?.fully_verified) setTimeout(() => setOpen(false), 1200);
            return result;
        } catch (err) {
            setCodes((c) => ({ ...c, [target]: '' }));
            setFeedback({
                type: 'error',
                target,
                text: verificationErrorCopy(err.code, isAr, { retryAfterSeconds: err.retryAfterSeconds }) || err.message,
            });
        } finally {
            setBusy('');
        }
    };

    const cancelEdit = async (target) => {
        setStage((s) => ({ ...s, [target]: 'idle' }));
        setFeedback({ type: '', text: '', target: '' });
        if (status[`pending_${target}`]) {
            try { await verificationApi.cancelPending(target); } catch (_) { /* nothing staged */ }
        }
        await load();
    };

    // A plain render helper, called as a function. Declared as a component in
    // here it would be a new type on every render, so React would rebuild the
    // inputs on each keystroke and the mobile keyboard would close.
    const renderRow = (target) => {
        const verified = target === 'email' ? status.email_verified : status.phone_verified;
        const liveValue = target === 'email' ? status.email : status.phone;
        const pending = target === 'email' ? status.pending_email : status.pending_phone;
        const label = target === 'email' ? vc.emailLabel : vc.phoneLabel;
        const Icon = target === 'email' ? Mail : Phone;
        const current = stage[target];
        const rowBusy = busy === target;

        return (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                <div className="flex items-center gap-3 mb-3">
                    <Icon size={16} className="text-marine-primary flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                        <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest">{label}</p>
                        <p className="text-white text-sm font-bold truncate" dir="ltr">{liveValue}</p>
                        {pending && pending !== liveValue && (
                            <p className="text-amber-400 text-[11px] mt-0.5 truncate" dir="ltr">
                                {vc.pendingChangeNote(pending)}
                            </p>
                        )}
                    </div>
                    <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full flex items-center gap-1 flex-shrink-0 ${
                        verified
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                            : 'bg-amber-500/15 text-amber-400 border border-amber-500/25'
                    }`}>
                        {verified ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                        {verified ? vc.verified : vc.notVerified}
                    </span>
                </div>

                {feedback.target === target && feedback.text && (
                    <p className={`text-xs font-bold mb-3 ${feedback.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {feedback.text}
                    </p>
                )}

                {!verified && current === 'idle' && (
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => sendCode(target)}
                            disabled={rowBusy}
                            className="flex items-center gap-1.5 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all"
                        >
                            {rowBusy ? <Loader2 size={13} className="animate-spin" /> : <MessageCircle size={13} />}
                            {vc.sendCode}
                        </button>
                        <button
                            onClick={() => setStage((s) => ({ ...s, [target]: 'editing' }))}
                            className="flex items-center gap-1.5 text-zinc-400 hover:text-white text-xs font-bold transition-colors"
                        >
                            <Pencil size={12} /> {vc.edit}
                        </button>
                    </div>
                )}

                {current === 'editing' && (
                    <div className="space-y-3">
                        <input
                            type={target === 'email' ? 'email' : 'tel'}
                            dir="ltr"
                            value={drafts[target]}
                            onChange={(e) => setDrafts((d) => ({ ...d, [target]: e.target.value }))}
                            placeholder={target === 'email' ? 'name@example.com' : '01xxxxxxxxx'}
                            className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-marine-cyan"
                        />
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => sendCode(target, true)}
                                disabled={rowBusy || !drafts[target]}
                                className="flex items-center gap-1.5 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all"
                            >
                                {rowBusy && <Loader2 size={13} className="animate-spin" />}
                                {vc.saveAndSend}
                            </button>
                            <button
                                onClick={() => cancelEdit(target)}
                                className="text-zinc-400 hover:text-white text-xs font-bold transition-colors"
                            >
                                {vc.cancel}
                            </button>
                        </div>
                    </div>
                )}

                {current === 'code' && (
                    <div className="space-y-3">
                        <p className="text-zinc-400 text-xs">
                            {target === 'email' ? vc.emailCodeNote : vc.whatsappNote}
                            {target === 'phone' && (
                                <span className="block text-zinc-500 mt-1">{vc.whatsappDelayNote}</span>
                            )}
                        </p>
                        <OtpInput
                            value={codes[target]}
                            onChange={(v) => setCodes((c) => ({ ...c, [target]: v }))}
                            onComplete={(v) => confirmCode(target, v)}
                            disabled={rowBusy}
                            autoFocus={false}
                        />
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => confirmCode(target)}
                                disabled={rowBusy || codes[target].length !== 6}
                                className="flex items-center gap-1.5 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all"
                            >
                                {rowBusy && <Loader2 size={13} className="animate-spin" />}
                                {vc.confirmNow}
                            </button>
                            <button
                                onClick={() => sendCode(target)}
                                disabled={rowBusy}
                                className="text-zinc-400 hover:text-white text-xs font-bold transition-colors disabled:opacity-50"
                            >
                                {vc.resendCode}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <>
            {/* Persistent banner once the modal is dismissed — the reminder stays
                visible without blocking anything. */}
            {dismissed && !open && (
                <div className="bg-amber-50 border-b border-amber-200" dir={isAr ? 'rtl' : 'ltr'}>
                    <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center gap-3 flex-wrap">
                        <AlertCircle size={15} className="text-amber-600 flex-shrink-0" />
                        <p className="text-zinc-800 text-xs font-bold flex-1 min-w-0">{vc.verifyBannerText}</p>
                        <button
                            onClick={() => setOpen(true)}
                            className="bg-marine-cyan hover:bg-marine-cyan-dark text-white text-xs font-black px-3 py-1.5 rounded-lg shadow-sm transition-colors flex-shrink-0"
                        >
                            {vc.verifyBannerCta}
                        </button>
                    </div>
                </div>
            )}

            {open && (
                <Overlay className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4" dir={isAr ? 'rtl' : 'ltr'}>
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={snooze} />
                    <div className="relative bg-[#09090b] border border-white/10 w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl p-6 sm:p-8 shadow-2xl max-h-[90vh] overflow-y-auto">
                        <button
                            onClick={snooze}
                            aria-label={vc.later}
                            className="absolute top-4 end-4 text-zinc-500 hover:text-white transition-colors"
                        >
                            <X size={18} />
                        </button>

                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-11 h-11 rounded-full bg-marine-cyan/15 text-marine-primary flex items-center justify-center flex-shrink-0">
                                <ShieldCheck size={22} />
                            </div>
                            <h3 className="text-xl font-black text-white">{vc.confirmYourDetails}</h3>
                        </div>
                        <p className="text-zinc-400 text-sm mb-6 leading-relaxed">{vc.confirmIntro}</p>

                        <div className="space-y-3">
                            {renderRow('phone')}
                            {renderRow('email')}
                        </div>

                        <button
                            onClick={snooze}
                            className="w-full mt-6 bg-white/5 hover:bg-white/10 text-zinc-400 py-3 rounded-xl font-bold text-sm transition-all"
                        >
                            {vc.later}
                        </button>
                    </div>
                </Overlay>
            )}
        </>
    );
}
