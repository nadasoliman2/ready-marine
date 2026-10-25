'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from '../../../../lib/navigation';
import Link from '../../../../components/LocaleLink';
import {
    Users, ShieldCheck, Loader2, CheckCircle2, XCircle, LogIn, UserPlus, Eye, EyeOff, AlertCircle,
} from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { familyInvitationApi, authApi } from '../../../../lib/api';
import { getRelationshipLabel, familyCopy } from '../../../../lib/familyLocalization';
import { inviteCopy, inviteErrorCopy } from '../../../../lib/inviteLocalization';
import OtpCodeInput from '../../../../components/checkout/OtpCodeInput';

/**
 * Family invitation landing page.
 *
 * Opening this link never accepts the invitation — acceptance is always an
 * explicit action, either from an already signed-in account whose email matches
 * the invited address, or from a shortened customer registration form.
 */
export default function FamilyInvitationPage() {
    const params = useParams();
    const router = useRouter();
    const { user, login, language, isMounted } = useApp();
    const isAr = language === 'ar';
    const copy = familyCopy(isAr);
    const token = String(params?.token || '');

    const [preview, setPreview] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState('');
    const [outcome, setOutcome] = useState(null); // 'joined' | 'declined'

    const [showRegister, setShowRegister] = useState(false);
    const [registerForm, setRegisterForm] = useState({ name: '', phone: '', password: '' });
    const [showPassword, setShowPassword] = useState(false);

    /* ---- WhatsApp invitations ----
       A different proof entirely. An emailed invitation is proved by the mailbox
       it reached; a WhatsApp one is proved by a code to the number, because a
       link in a chat can be forwarded and joining a family grants access to the
       organizer's shared addresses. No password is asked for on this path — a
       member orders against those shared addresses and never their own, so a
       name and six digits is genuinely everything we need. */
    const ic = inviteCopy(isAr);
    const [codeStage, setCodeStage] = useState('intro');
    const [claimName, setClaimName] = useState('');
    const [codeError, setCodeError] = useState('');
    const [codeMasked, setCodeMasked] = useState('');
    const [codeCooldown, setCodeCooldown] = useState(0);
    const [sendingCode, setSendingCode] = useState(false);
    const [verifyingCode, setVerifyingCode] = useState(false);

    const isStaffSession = user?.role === 'vendor' || user?.role === 'admin';

    const loadPreview = async () => {
        setLoading(true);
        try {
            setPreview(await familyInvitationApi.preview(token));
            setLoadError(null);
        } catch (err) {
            setLoadError({ code: err.code, message: err.message });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!isMounted || !token) return;
        loadPreview();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isMounted, token, user?.email]);

    const acceptWithCurrentAccount = async () => {
        setBusy(true);
        setActionError('');
        try {
            await familyInvitationApi.accept(token);
            setOutcome('joined');
            setTimeout(() => router.push('/profile?tab=family'), 2000);
        } catch (err) {
            setActionError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const acceptWithNewAccount = async (e) => {
        e.preventDefault();
        setBusy(true);
        setActionError('');
        try {
            const res = await familyInvitationApi.acceptWithRegistration(token, {
                ...registerForm,
                language: isAr ? 'ar' : 'en',
            });
            // The invitation proved control of the mailbox, so the backend signed
            // the new account in directly — mirror that into app state.
            login({ ...res.user, role: 'user' });
            setOutcome('joined');
            setTimeout(() => { router.push('/profile?tab=family'); router.refresh(); }, 2000);
        } catch (err) {
            setActionError(err.message);
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => {
        if (codeCooldown <= 0) return;
        const timer = setTimeout(() => setCodeCooldown((n) => n - 1), 1000);
        return () => clearTimeout(timer);
    }, [codeCooldown]);

    const secondsUntil = (iso) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000)) : 0);

    /**
     * Ask for the name first, then send the code.
     *
     * The code lives for ten minutes, and those minutes should be spent waiting
     * for the message rather than watching someone type their name — a code that
     * expires mid-form is a code the invitee has to request twice.
     */
    const startCodeStep = async () => {
        setActionError('');
        if (preview?.needs_account_setup && !claimName.trim()) {
            setActionError(ic.nameRequired);
            return;
        }
        setSendingCode(true);
        try {
            const res = await familyInvitationApi.sendCode(token, isAr ? 'ar' : 'en');
            setCodeMasked(res?.verification?.masked_destination || preview?.invitation?.phone_masked || '');
            setCodeCooldown(secondsUntil(res?.verification?.resend_available_at));
            setCodeStage('code');
        } catch (err) {
            if (err.code === 'OTP_RESEND_COOLDOWN') {
                setCodeCooldown(err.retryAfterSeconds || 60);
                setCodeStage('code');
            } else {
                setActionError(inviteErrorCopy(err.code, isAr) || err.message);
            }
        } finally {
            setSendingCode(false);
        }
    };

    const acceptWithCode = async (code) => {
        setVerifyingCode(true);
        setCodeError('');
        try {
            const res = await familyInvitationApi.acceptWithCode(token, {
                code,
                name: claimName.trim(),
                language: isAr ? 'ar' : 'en',
            });
            // Accepting signs them in. Without mirroring that into app state they
            // would land on a Family tab that believes nobody is signed in.
            if (res.user) login({ ...res.user, role: 'user' }, { rememberMe: true });
            setOutcome('joined');
            setTimeout(() => { router.push('/profile?tab=family'); router.refresh(); }, 2000);
        } catch (err) {
            const base = inviteErrorCopy(err.code, isAr) || err.message;
            setCodeError(err.attemptsRemaining !== undefined
                ? `${base} ${ic.attemptsLeft(err.attemptsRemaining)}`
                : base);
        } finally {
            setVerifyingCode(false);
        }
    };

    const decline = async () => {
        if (!confirm(isAr ? 'هل تريد رفض هذه الدعوة؟' : 'Decline this invitation?')) return;
        setBusy(true);
        setActionError('');
        try {
            await familyInvitationApi.decline(token);
            setOutcome('declined');
        } catch (err) {
            setActionError(err.message);
        } finally {
            setBusy(false);
        }
    };

    const switchAccount = async () => {
        try { await authApi.logout(); } catch (_) { /* already signed out */ }
        router.push(`/login?role=customer&email=${encodeURIComponent(preview?.invitation?.email || '')}&redirect=${encodeURIComponent(`/family/invitation/${token}`)}`);
    };

    if (!isMounted || loading) {
        return (
            <Shell isAr={isAr}>
                <div className="flex items-center justify-center py-16">
                    <Loader2 size={36} className="animate-spin text-marine-primary" />
                </div>
            </Shell>
        );
    }

    /* ---------------- Outcomes ---------------- */
    if (outcome === 'joined') {
        return (
            <Shell isAr={isAr}>
                <div className="text-center py-6">
                    <div className="w-16 h-16 bg-emerald-500/15 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-5">
                        <CheckCircle2 size={32} />
                    </div>
                    <h1 className="text-2xl font-black text-white mb-2">
                        {isAr ? 'تم الانضمام إلى العائلة' : 'You joined the family'}
                    </h1>
                    <p className="text-zinc-400 text-sm">
                        {isAr
                            ? 'يمكنك الآن تجهيز طلبات الشراء وإرسالها للموافقة عليها.'
                            : 'You can now prepare purchases and send them for approval.'}
                    </p>
                    <Link href="/profile?tab=family" className="inline-block mt-6 bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold px-6 py-3 rounded-xl transition-all">
                        {copy.family}
                    </Link>
                </div>
            </Shell>
        );
    }

    if (outcome === 'declined') {
        return (
            <Shell isAr={isAr}>
                <div className="text-center py-6">
                    <div className="w-16 h-16 bg-zinc-500/15 text-zinc-400 rounded-full flex items-center justify-center mx-auto mb-5">
                        <XCircle size={32} />
                    </div>
                    <h1 className="text-2xl font-black text-white mb-2">
                        {isAr ? 'تم رفض الدعوة' : 'Invitation declined'}
                    </h1>
                    <p className="text-zinc-400 text-sm">
                        {isAr ? 'لقد أبلغنا مسؤول العائلة.' : 'We let the family organizer know.'}
                    </p>
                    <Link href="/" className="inline-block mt-6 bg-white/5 hover:bg-white/10 text-zinc-300 font-bold px-6 py-3 rounded-xl transition-all">
                        {isAr ? 'العودة للرئيسية' : 'Back to home'}
                    </Link>
                </div>
            </Shell>
        );
    }

    /* ---------------- Unusable link ---------------- */
    if (loadError) {
        const messages = {
            INVITATION_EXPIRED: isAr
                ? 'انتهت صلاحية هذه الدعوة. اطلب من مسؤول العائلة إرسال دعوة جديدة.'
                : 'This invitation has expired. Ask the organizer to send a new one.',
            INVITATION_REVOKED: isAr
                ? 'تم إلغاء هذه الدعوة من قبل مسؤول العائلة.'
                : 'This invitation was cancelled by the organizer.',
            INVITATION_ALREADY_ACCEPTED: isAr
                ? 'تم قبول هذه الدعوة بالفعل.'
                : 'This invitation has already been accepted.',
            INVITATION_DECLINED: isAr ? 'تم رفض هذه الدعوة سابقاً.' : 'This invitation was already declined.',
        };

        return (
            <Shell isAr={isAr}>
                <div className="text-center py-6">
                    <div className="w-16 h-16 bg-red-500/15 text-red-400 rounded-full flex items-center justify-center mx-auto mb-5">
                        <AlertCircle size={32} />
                    </div>
                    <h1 className="text-xl font-black text-white mb-2">
                        {isAr ? 'لا يمكن استخدام هذا الرابط' : 'This link cannot be used'}
                    </h1>
                    <p className="text-zinc-400 text-sm max-w-sm mx-auto">
                        {messages[loadError.code] || loadError.message}
                    </p>
                    <Link href="/" className="inline-block mt-6 bg-white/5 hover:bg-white/10 text-zinc-300 font-bold px-6 py-3 rounded-xl transition-all">
                        {isAr ? 'العودة للرئيسية' : 'Back to home'}
                    </Link>
                </div>
            </Shell>
        );
    }

    const { invitation, organizer } = preview;
    const relationship = getRelationshipLabel(invitation.relationship, isAr).toLowerCase();
    const emailMatches = preview.signed_in_email_matches === true;
    // A WhatsApp invitation is answered with a code, not with a mailbox — and
    // the whole email branch below (sign in / register / wrong account) simply
    // does not apply, because the invited account may have no email at all.
    const overWhatsapp = invitation.channel === 'whatsapp';

    return (
        <Shell isAr={isAr}>
            <div className="text-center mb-8">
                <div className="w-16 h-16 bg-marine-cyan/15 text-marine-primary rounded-full flex items-center justify-center mx-auto mb-5">
                    <Users size={32} />
                </div>
                <h1 className="text-2xl font-black text-white leading-snug">
                    {isAr
                        ? `${organizer.name} يدعوك للانضمام إلى عائلته على Ready Marine بصفتك ${relationship}.`
                        : `${organizer.name} invited you to join their Ready Marine family as their ${relationship}.`}
                </h1>
                <p className="text-zinc-500 text-sm mt-3 break-all">
                    {overWhatsapp ? ic.invitedTo(invitation.phone_masked || '') : invitation.email}
                </p>
            </div>

            {/* What acceptance means — stated before any action. */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 mb-6">
                <p className="text-white text-xs font-black uppercase tracking-widest flex items-center gap-2 mb-3">
                    <ShieldCheck size={14} className="text-emerald-400" /> {copy.privacyTitle}
                </p>
                <ul className="text-zinc-400 text-sm space-y-2 list-disc list-inside">
                    <li>
                        {isAr
                            ? `يمكنك استخدام ${invitation.shared_address_count} عنوان توصيل شاركه معك فقط.`
                            : `You can use only the ${invitation.shared_address_count} delivery address${invitation.shared_address_count === 1 ? '' : 'es'} they shared with you.`}
                    </li>
                    <li>{copy.privacyCannotEdit}</li>
                    <li>{copy.privacyNoPayment}</li>
                    <li>
                        {isAr
                            ? 'كل طلب ترسله يحتاج إلى موافقة مسؤول العائلة، وهو من يختار طريقة الدفع.'
                            : 'Every request you send needs the organizer’s approval, and they choose how to pay.'}
                    </li>
                </ul>
            </div>

            {actionError && (
                <div className="p-4 mb-6 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm font-bold flex items-start gap-3">
                    <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
                    <span>{actionError}</span>
                </div>
            )}

            {/* ---- Invited over WhatsApp: a name and a code, no password ----
                 Checked before every branch below, all of which assume the
                 invitation is addressed to an email — an assumption that does
                 not hold here and would send the invitee to a sign-in box for
                 an account that has no email on it. */}
            {overWhatsapp && !isStaffSession ? (
                codeStage === 'intro' ? (
                    <div className="space-y-4">
                        {preview.needs_account_setup && (
                            <Field label={ic.yourName}>
                                <input
                                    type="text"
                                    value={claimName}
                                    onChange={(e) => setClaimName(e.target.value)}
                                    placeholder={ic.yourNamePlaceholder}
                                    autoComplete="name"
                                    className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan"
                                />
                            </Field>
                        )}
                        <button
                            onClick={startCodeStep}
                            disabled={sendingCode}
                            className="w-full bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold py-3.5 rounded-xl transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                        >
                            {sendingCode ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                            {ic.acceptFamily(organizer.name)}
                        </button>
                        <DeclineButton onClick={decline} busy={busy} isAr={isAr} />
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="text-center">
                            <p className="text-white font-bold flex items-center justify-center gap-2">
                                <ShieldCheck size={16} className="text-emerald-400" />
                                {ic.confirmNumberTitle}
                            </p>
                            <p className="text-zinc-400 text-sm mt-1">{ic.confirmNumberBody(codeMasked)}</p>
                        </div>

                        <OtpCodeInput
                            onComplete={acceptWithCode}
                            loading={verifyingCode}
                            error={codeError}
                            dir={isAr ? 'rtl' : 'ltr'}
                        />

                        <p className="text-xs text-zinc-500 text-center">{ic.whyCode}</p>

                        <div className="flex items-center justify-center">
                            <button
                                type="button"
                                onClick={startCodeStep}
                                disabled={codeCooldown > 0 || sendingCode}
                                className="text-sm text-zinc-400 hover:text-white disabled:text-zinc-600 disabled:cursor-not-allowed transition-colors"
                            >
                                {codeCooldown > 0 ? ic.resendIn(codeCooldown) : ic.resend}
                            </button>
                        </div>

                        <DeclineButton onClick={decline} busy={busy} isAr={isAr} />
                    </div>
                )
            ) : isStaffSession ? (
                <div className="space-y-4">
                    <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl text-sm font-bold">
                        {isAr
                            ? 'أنت مسجل الدخول بحساب بائع أو مسؤول. دعوات العائلة تعمل مع حسابات العملاء فقط.'
                            : 'You are signed in as a vendor or admin. Family invitations work with customer accounts only.'}
                    </div>
                    <button onClick={switchAccount} className="w-full bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold py-3.5 rounded-xl transition-all">
                        {isAr ? 'تبديل الحساب' : 'Switch account'}
                    </button>
                </div>
            ) : user && !emailMatches ? (
                /* ---- Signed in with the wrong customer account ---- */
                <div className="space-y-4">
                    <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl text-sm font-bold">
                        {isAr ? 'تم إرسال هذه الدعوة إلى بريد إلكتروني آخر.' : 'This invitation was sent to another email address.'}
                    </div>
                    <button onClick={switchAccount} className="w-full bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold py-3.5 rounded-xl transition-all">
                        {isAr ? 'تبديل الحساب' : 'Switch account'}
                    </button>
                    <DeclineButton onClick={decline} busy={busy} isAr={isAr} />
                </div>
            ) : user && emailMatches ? (
                /* ---- Signed in with the invited account ---- */
                <div className="space-y-4">
                    <button
                        onClick={acceptWithCurrentAccount} disabled={busy}
                        className="w-full bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold py-3.5 rounded-xl transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                    >
                        {busy ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                        {isAr ? 'قبول الدعوة' : 'Accept invitation'}
                    </button>
                    <DeclineButton onClick={decline} busy={busy} isAr={isAr} />
                </div>
            ) : preview.invited_account_exists && !showRegister ? (
                /* ---- Signed out, account already exists ---- */
                <div className="space-y-4">
                    <Link
                        href={`/login?role=customer&email=${encodeURIComponent(invitation.email)}&redirect=${encodeURIComponent(`/family/invitation/${token}`)}`}
                        className="w-full bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2"
                    >
                        <LogIn size={18} /> {isAr ? 'تسجيل الدخول للقبول' : 'Sign in to accept'}
                    </Link>
                    <DeclineButton onClick={decline} busy={busy} isAr={isAr} />
                </div>
            ) : (
                /* ---- Signed out, no account yet: shortened customer sign-up ----
                   No customer/vendor role selector, and the invited email is
                   locked because the invitation is what proves ownership of it. */
                <form onSubmit={acceptWithNewAccount} className="space-y-4">
                    <h2 className="text-white font-black text-lg flex items-center gap-2">
                        <UserPlus size={18} className="text-marine-primary" />
                        {isAr ? 'أنشئ حسابك للانضمام' : 'Create your account to join'}
                    </h2>

                    <Field label={isAr ? 'الاسم الكامل' : 'Full name'}>
                        <input
                            type="text" required value={registerForm.name}
                            onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })}
                            className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan"
                        />
                    </Field>

                    <Field label={isAr ? 'البريد الإلكتروني' : 'Email address'}>
                        <input
                            type="email" value={invitation.email} readOnly disabled
                            className="w-full bg-white/[0.03] border border-white/10 text-zinc-400 rounded-xl px-4 py-3 cursor-not-allowed"
                        />
                    </Field>

                    <Field label={isAr ? 'رقم الهاتف' : 'Phone number'}>
                        <input
                            type="tel" required value={registerForm.phone}
                            onChange={(e) => setRegisterForm({ ...registerForm, phone: e.target.value })}
                            placeholder="01xxxxxxxxx"
                            className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan"
                        />
                    </Field>

                    <Field label={isAr ? 'كلمة المرور' : 'Password'}>
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'} required minLength={8}
                                value={registerForm.password}
                                onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })}
                                className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 pe-11 focus:outline-none focus:border-marine-cyan"
                            />
                            <button
                                type="button" onClick={() => setShowPassword((v) => !v)}
                                className="absolute end-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                                aria-label={showPassword ? (isAr ? 'إخفاء كلمة المرور' : 'Hide password') : (isAr ? 'إظهار كلمة المرور' : 'Show password')}
                            >
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                    </Field>

                    <button
                        type="submit" disabled={busy}
                        className="w-full bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold py-3.5 rounded-xl transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                    >
                        {busy && <Loader2 size={18} className="animate-spin" />}
                        {isAr ? 'إنشاء الحساب وقبول الدعوة' : 'Create account and accept'}
                    </button>

                    <p className="text-center text-zinc-500 text-xs">
                        {isAr ? 'لديك حساب بالفعل؟' : 'Already have an account?'}{' '}
                        <Link
                            href={`/login?role=customer&email=${encodeURIComponent(invitation.email)}&redirect=${encodeURIComponent(`/family/invitation/${token}`)}`}
                            className="text-marine-primary font-bold hover:underline"
                        >
                            {isAr ? 'تسجيل الدخول' : 'Sign in'}
                        </Link>
                    </p>

                    <DeclineButton onClick={decline} busy={busy} isAr={isAr} />
                </form>
            )}
        </Shell>
    );
}

function Shell({ children, isAr }) {
    return (
        <div className="min-h-screen bg-[#111315] flex items-center justify-center px-4 py-12" dir={isAr ? 'rtl' : 'ltr'}>
            <div className="w-full max-w-lg bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl">
                {children}
            </div>
        </div>
    );
}

function Field({ label, children }) {
    return (
        <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{label}</label>
            {children}
        </div>
    );
}

function DeclineButton({ onClick, busy, isAr }) {
    return (
        <button
            type="button" onClick={onClick} disabled={busy}
            className="w-full bg-transparent text-zinc-500 hover:text-zinc-300 font-bold py-3 rounded-xl transition-all disabled:opacity-60 text-sm"
        >
            {isAr ? 'رفض الدعوة' : 'Decline'}
        </button>
    );
}
