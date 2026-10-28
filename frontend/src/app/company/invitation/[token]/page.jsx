'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from '../../../../lib/navigation';
import Link from '../../../../components/LocaleLink';
import {
    Building2, ShieldCheck, Loader2, CheckCircle2, XCircle, LogIn, UserPlus, Eye, EyeOff, AlertCircle, Wallet, MapPin,
} from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { companyInvitationApi, authApi } from '../../../../lib/api';
import { inviteCopy, inviteErrorCopy } from '../../../../lib/inviteLocalization';
import { companyErrorCopy, formatMoney, formatLimit } from '../../../../lib/companyLocalization';
import { invalidateMyCompany } from '../../../../components/company/useMyCompany';
import OtpCodeInput from '../../../../components/checkout/OtpCodeInput';
import { orgTerms } from '../../../../lib/orgTerms';
import { useActiveOrgType } from '../../../../components/company/OrgTermsContext';

/**
 * Company invitation landing page — an employee or a manager joining a company.
 *
 * Opening the link never accepts. An emailed invitation is accepted by the
 * account that owns that address (or by registering it); a WhatsApp invitation
 * by the account that owns the number, proved with a code when not signed in.
 */
export default function CompanyInvitationPage() {
    const params = useParams();
    const router = useRouter();
    const { user, login, language, isMounted } = useApp();
    const isAr = language === 'ar';
    const ic = inviteCopy(isAr);
    const token = String(params?.token || '');

    const [preview, setPreview] = useState(null);
    const ot = orgTerms(preview?.company?.org_type, isAr);
    useActiveOrgType(preview?.company?.org_type);
    const [loadError, setLoadError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState('');
    const [outcome, setOutcome] = useState(null); // { kind: 'joined', redirect } | { kind: 'declined' }

    const [registerForm, setRegisterForm] = useState({ name: '', phone: '', password: '' });
    const [showPassword, setShowPassword] = useState(false);

    const [codeStage, setCodeStage] = useState('intro');
    const [claimName, setClaimName] = useState('');
    const [codeError, setCodeError] = useState('');
    const [codeMasked, setCodeMasked] = useState('');
    const [codeCooldown, setCodeCooldown] = useState(0);
    const [sendingCode, setSendingCode] = useState(false);
    const [verifyingCode, setVerifyingCode] = useState(false);

    const isStaffSession = user?.role === 'vendor' || user?.role === 'admin';
    const errText = (err) => companyErrorCopy(err.code, isAr) || inviteErrorCopy(err.code, isAr) || err.message;

    const loadPreview = async () => {
        setLoading(true);
        try {
            setPreview(await companyInvitationApi.preview(token));
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
    }, [isMounted, token, user?.email, user?.id]);

    useEffect(() => {
        if (codeCooldown <= 0) return undefined;
        const timer = setTimeout(() => setCodeCooldown((n) => n - 1), 1000);
        return () => clearTimeout(timer);
    }, [codeCooldown]);

    const joined = (res) => {
        invalidateMyCompany();
        const redirect = res?.redirect || '/profile?tab=company';
        setOutcome({ kind: 'joined', redirect, role: res?.role });
        setTimeout(() => { router.push(redirect); router.refresh(); }, 2000);
    };

    const acceptWithCurrentAccount = async () => {
        setBusy(true);
        setActionError('');
        try {
            joined(await companyInvitationApi.accept(token));
        } catch (err) {
            setActionError(errText(err));
        } finally {
            setBusy(false);
        }
    };

    const acceptWithNewAccount = async (e) => {
        e.preventDefault();
        setBusy(true);
        setActionError('');
        try {
            const res = await companyInvitationApi.acceptWithRegistration(token, { ...registerForm, language: isAr ? 'ar' : 'en' });
            login({ ...res.user, role: 'user' });
            joined(res);
        } catch (err) {
            setActionError(errText(err));
        } finally {
            setBusy(false);
        }
    };

    const secondsUntil = (iso) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000)) : 0);

    const startCodeStep = async () => {
        setActionError('');
        if (preview?.needs_account_setup && !claimName.trim()) {
            setActionError(ic.nameRequired);
            return;
        }
        setSendingCode(true);
        try {
            const res = await companyInvitationApi.sendCode(token, isAr ? 'ar' : 'en');
            setCodeMasked(res?.verification?.masked_destination || preview?.invitation?.phone_masked || '');
            setCodeCooldown(secondsUntil(res?.verification?.resend_available_at));
            setCodeStage('code');
        } catch (err) {
            if (err.code === 'OTP_RESEND_COOLDOWN') {
                setCodeCooldown(err.retryAfterSeconds || 60);
                setCodeStage('code');
            } else {
                setActionError(errText(err));
            }
        } finally {
            setSendingCode(false);
        }
    };

    const acceptWithCode = async (code) => {
        setVerifyingCode(true);
        setCodeError('');
        try {
            const res = await companyInvitationApi.acceptWithCode(token, { code, name: claimName.trim(), language: isAr ? 'ar' : 'en' });
            if (res.user) login({ ...res.user, role: 'user' }, { rememberMe: true });
            joined(res);
        } catch (err) {
            const base = errText(err);
            setCodeError(err.attemptsRemaining !== undefined ? `${base} ${ic.attemptsLeft(err.attemptsRemaining)}` : base);
        } finally {
            setVerifyingCode(false);
        }
    };

    const decline = async () => {
        if (!confirm(isAr ? 'ترفض الدعوة؟' : 'Decline this invitation?')) return;
        setBusy(true);
        setActionError('');
        try {
            await companyInvitationApi.decline(token);
            setOutcome({ kind: 'declined' });
        } catch (err) {
            setActionError(errText(err));
        } finally {
            setBusy(false);
        }
    };

    const loginHref = () => {
        const email = preview?.invitation?.email ? `&email=${encodeURIComponent(preview.invitation.email)}` : '';
        return `/login?role=customer${email}&redirect=${encodeURIComponent(`/company/invitation/${token}`)}`;
    };

    const switchAccount = async () => {
        try { await authApi.logout(); } catch (_) { /* already signed out */ }
        router.push(loginHref());
    };

    if (!isMounted || loading) {
        return (
            <Shell isAr={isAr}>
                <div className="flex items-center justify-center py-16"><Loader2 size={36} className="animate-spin text-marine-primary" /></div>
            </Shell>
        );
    }

    if (outcome?.kind === 'joined') {
        const manager = outcome.role === 'manager';
        return (
            <Shell isAr={isAr}>
                <div className="text-center py-6">
                    <div className="w-16 h-16 bg-emerald-500/15 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-5"><CheckCircle2 size={32} /></div>
                    <h1 className="text-2xl font-black text-white mb-2">
                        {manager ? (isAr ? 'بقيت مدير الحساب' : 'You now manage the account') : (isAr ? `انضممت لحساب ${ot.the}` : `You joined the ${ot.one} account`)}
                    </h1>
                    <p className="text-zinc-400 text-sm">
                        {manager
                            ? (isAr ? `هنوديك على لوحة ${ot.the}.` : `Taking you to the ${ot.one} portal.`)
                            : (isAr ? `تقدر دلوقتي تطلب على حساب ${ot.the} في حدود الليميت بتاعك.` : `You can now order on the ${ot.one} account within your limit.`)}
                    </p>
                    <Link href={outcome.redirect} className="inline-block mt-6 bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold px-6 py-3 rounded-xl transition-all">
                        {manager ? (isAr ? `لوحة ${ot.the}` : `${ot.One} portal`) : ot.mine}
                    </Link>
                </div>
            </Shell>
        );
    }

    if (outcome?.kind === 'declined') {
        return (
            <Shell isAr={isAr}>
                <div className="text-center py-6">
                    <div className="w-16 h-16 bg-zinc-500/15 text-zinc-400 rounded-full flex items-center justify-center mx-auto mb-5"><XCircle size={32} /></div>
                    <h1 className="text-2xl font-black text-white mb-2">{isAr ? 'رفضت الدعوة' : 'Invitation declined'}</h1>
                    <p className="text-zinc-400 text-sm">{isAr ? `بلغنا ${ot.the}.` : `We let the ${ot.one} know.`}</p>
                    <Link href="/" className="inline-block mt-6 bg-white/5 hover:bg-white/10 text-zinc-300 font-bold px-6 py-3 rounded-xl transition-all">{isAr ? 'الرئيسية' : 'Back to home'}</Link>
                </div>
            </Shell>
        );
    }

    if (loadError) {
        return (
            <Shell isAr={isAr}>
                <div className="text-center py-6">
                    <div className="w-16 h-16 bg-red-500/15 text-red-400 rounded-full flex items-center justify-center mx-auto mb-5"><AlertCircle size={32} /></div>
                    <h1 className="text-xl font-black text-white mb-2">{isAr ? 'اللينك ده مش شغال' : 'This link cannot be used'}</h1>
                    <p className="text-zinc-400 text-sm max-w-sm mx-auto">{companyErrorCopy(loadError.code, isAr) || loadError.message}</p>
                    <Link href="/" className="inline-block mt-6 bg-white/5 hover:bg-white/10 text-zinc-300 font-bold px-6 py-3 rounded-xl transition-all">{isAr ? 'الرئيسية' : 'Back to home'}</Link>
                </div>
            </Shell>
        );
    }

    const { invitation, company, employee_terms: terms } = preview;
    const manager = invitation.role === 'manager';
    const overWhatsapp = invitation.channel === 'whatsapp';
    const signedInMatches = preview.signed_in_matches === true;

    return (
        <Shell isAr={isAr}>
            <div className="text-center mb-8">
                <div className="w-16 h-16 bg-marine-cyan/15 text-marine-primary rounded-full flex items-center justify-center mx-auto mb-5"><Building2 size={32} /></div>
                <h1 className="text-2xl font-black text-zinc-900 leading-snug">
                    {manager
                        ? (isAr ? `دعوة لإدارة حساب ${company.name} على Ready Marine` : `You're invited to manage ${company.name} on Ready Marine`)
                        : (isAr ? `${company.name} ${ot.v('ضافتك', 'ضافك')} لحساب ${ot.the} على Ready Marine` : `${company.name} added you to its Ready Marine ${ot.one} account`)}
                </h1>
                <p className="text-zinc-500 text-sm mt-3 break-all">
                    {overWhatsapp ? ic.invitedTo(invitation.phone_masked || '') : invitation.email}
                </p>
            </div>

            <div className="bg-zinc-50 border border-zinc-200 rounded-2xl p-5 mb-6 space-y-3">
                {manager ? (
                    <p className="text-zinc-600 text-sm">
                        {isAr
                            ? `هتقدر تضيف ${ot.members} وتحدد ليميت كل واحد، وتتابع المشتريات والفواتير، وتطلب قطع غيار لعربيات ${ot.the}.`
                            : `You will add ${ot.members} and set their limits, follow purchases and invoices, and order parts for ${ot.one} cars.`}
                    </p>
                ) : (
                    <>
                        {terms && (
                            <div className="grid grid-cols-2 gap-3">
                                <div className="rounded-xl bg-white border border-zinc-200/80 p-3">
                                    <p className="text-[11px] font-bold text-zinc-500 uppercase flex items-center gap-1.5"><Wallet size={12} />{isAr ? 'ليميتك الشهري' : 'Your monthly limit'}</p>
                                    <p className="text-zinc-900 font-black mt-1 tabular-nums" dir="ltr">{formatLimit(terms.limit, isAr)}</p>
                                </div>
                                <div className="rounded-xl bg-white border border-zinc-200/80 p-3">
                                    <p className="text-[11px] font-bold text-zinc-500 uppercase flex items-center gap-1.5"><MapPin size={12} />{isAr ? `${ot.theBranch}` : `${ot.Branch}`}</p>
                                    <p className="text-zinc-900 font-black mt-1 truncate">{terms.office_name || '—'}</p>
                                </div>
                            </div>
                        )}
                        <p className="text-zinc-900 text-xs font-black uppercase tracking-widest flex items-center gap-2">
                            <ShieldCheck size={14} className="text-emerald-600" /> {isAr ? 'الخصوصية' : 'Privacy'}
                        </p>
                        <ul className="text-zinc-600 text-sm space-y-2 list-disc list-inside">
                            <li>{isAr ? `${ot.the} ${ot.v('هتشوف', 'هيشوف')} الأوردرات اللي بتطلبها على ${ot.v('حسابها', 'حسابه')} بس: إيه وبكام وامتى.` : `The ${ot.one} sees only the orders you place on its account: what, how much and when.`}</li>
                            <li>{isAr ? 'مشترياتك الشخصية اللي بتدفعها بنفسك مش هتظهرلها خالص.' : 'Purchases you pay for yourself are never shown to it.'}</li>
                            <li>{isAr ? 'الليميت بيتجدد أول كل شهر وشامل الشحن.' : 'The limit renews on the 1st of every month and includes shipping.'}</li>
                        </ul>
                    </>
                )}
            </div>

            {preview.signed_in_other_company && (
                <div className="p-4 mb-6 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl text-sm font-bold">
                    {isAr ? `حسابك تابع لحساب ${ot.one} ${ot.v('تانية', 'تاني')}. لازم تسيبه الأول من تاب "${ot.mine}" قبل ما تقبل الدعوة دي.` : `Your account belongs to another ${ot.one}. Leave it from the "My ${ot.one}" tab before accepting this one.`}
                </div>
            )}

            {actionError && (
                <div className="p-4 mb-6 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm font-bold flex items-start gap-3">
                    <AlertCircle size={18} className="flex-shrink-0 mt-0.5" /><span>{actionError}</span>
                </div>
            )}

            {isStaffSession ? (
                <div className="space-y-4">
                    <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl text-sm font-bold">
                        {isAr ? `إنت داخل بحساب بائع أو أدمن. دعوات ${ot.plural} بتشتغل مع حسابات العملاء بس.` : `You are signed in as a vendor or admin. ${ot.One} invitations work with customer accounts only.`}
                    </div>
                    <button onClick={switchAccount} className="w-full bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold py-3.5 rounded-xl transition-all">{isAr ? 'تبديل الحساب' : 'Switch account'}</button>
                </div>
            ) : user && signedInMatches ? (
                <div className="space-y-4">
                    <button onClick={acceptWithCurrentAccount} disabled={busy || preview.signed_in_other_company}
                        className="w-full bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold py-3.5 rounded-xl transition-all disabled:opacity-60 flex items-center justify-center gap-2">
                        {busy ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                        {isAr ? 'قبول الدعوة' : 'Accept invitation'}
                    </button>
                    <DeclineButton onClick={decline} busy={busy} isAr={isAr} />
                </div>
            ) : overWhatsapp ? (
                codeStage === 'intro' ? (
                    <div className="space-y-4">
                        {user && !signedInMatches && (
                            <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl text-sm font-bold">
                                {isAr ? 'الدعوة دي متبعوتة لرقم تاني غير حسابك الحالي. أكد بالكود اللي هيوصل على الرقم ده.' : 'This invitation was sent to a different number from your current account. Confirm with the code sent to that number.'}
                            </div>
                        )}
                        {preview.needs_account_setup && (
                            <Field label={ic.yourName}>
                                <input type="text" value={claimName} onChange={(e) => setClaimName(e.target.value)} placeholder={ic.yourNamePlaceholder} autoComplete="name"
                                    className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan" />
                            </Field>
                        )}
                        <button onClick={startCodeStep} disabled={sendingCode}
                            className="w-full bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold py-3.5 rounded-xl transition-all disabled:opacity-60 flex items-center justify-center gap-2">
                            {sendingCode ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
                            {isAr ? `انضم لحساب ${company.name}` : `Join ${company.name}`}
                        </button>
                        {preview.invited_account_exists && !user && (
                            <Link href={loginHref()} className="block text-center text-sm text-zinc-400 hover:text-white">{isAr ? 'أو سجل دخول بحسابك' : 'Or sign in to your account'}</Link>
                        )}
                        <DeclineButton onClick={decline} busy={busy} isAr={isAr} />
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="text-center">
                            <p className="text-white font-bold flex items-center justify-center gap-2"><ShieldCheck size={16} className="text-emerald-400" />{ic.confirmNumberTitle}</p>
                            <p className="text-zinc-400 text-sm mt-1">{ic.confirmNumberBody(codeMasked)}</p>
                        </div>
                        <OtpCodeInput onComplete={acceptWithCode} loading={verifyingCode} error={codeError} dir={isAr ? 'rtl' : 'ltr'} />
                        <div className="flex items-center justify-center">
                            <button type="button" onClick={startCodeStep} disabled={codeCooldown > 0 || sendingCode}
                                className="text-sm text-zinc-400 hover:text-white disabled:text-zinc-600 disabled:cursor-not-allowed transition-colors">
                                {codeCooldown > 0 ? ic.resendIn(codeCooldown) : ic.resend}
                            </button>
                        </div>
                        <DeclineButton onClick={decline} busy={busy} isAr={isAr} />
                    </div>
                )
            ) : user && !signedInMatches ? (
                <div className="space-y-4">
                    <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl text-sm font-bold">
                        {isAr ? 'الدعوة دي متبعوتة لإيميل تاني.' : 'This invitation was sent to another email address.'}
                    </div>
                    <button onClick={switchAccount} className="w-full bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold py-3.5 rounded-xl transition-all">{isAr ? 'تبديل الحساب' : 'Switch account'}</button>
                    <DeclineButton onClick={decline} busy={busy} isAr={isAr} />
                </div>
            ) : preview.invited_account_exists ? (
                <div className="space-y-4">
                    <Link href={loginHref()} className="w-full bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2">
                        <LogIn size={18} /> {isAr ? 'سجل دخول عشان تقبل' : 'Sign in to accept'}
                    </Link>
                    <DeclineButton onClick={decline} busy={busy} isAr={isAr} />
                </div>
            ) : (
                <form onSubmit={acceptWithNewAccount} className="space-y-4">
                    <h2 className="text-white font-black text-lg flex items-center gap-2"><UserPlus size={18} className="text-marine-primary" />{isAr ? 'اعمل حسابك عشان تنضم' : 'Create your account to join'}</h2>
                    <Field label={isAr ? 'الاسم بالكامل' : 'Full name'}>
                        <input type="text" required value={registerForm.name} onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })}
                            className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan" />
                    </Field>
                    <Field label={isAr ? 'الإيميل' : 'Email address'}>
                        <input type="email" value={invitation.email} readOnly disabled className="w-full bg-white/[0.03] border border-white/10 text-zinc-400 rounded-xl px-4 py-3 cursor-not-allowed" />
                    </Field>
                    <Field label={isAr ? 'رقم الموبايل' : 'Mobile number'}>
                        <input type="tel" required value={registerForm.phone} onChange={(e) => setRegisterForm({ ...registerForm, phone: e.target.value })} placeholder="01xxxxxxxxx"
                            className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan" />
                    </Field>
                    <Field label={isAr ? 'كلمة السر' : 'Password'}>
                        <div className="relative">
                            <input type={showPassword ? 'text' : 'password'} required minLength={8} value={registerForm.password}
                                onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })}
                                className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 pe-11 focus:outline-none focus:border-marine-cyan" />
                            <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute end-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                                aria-label={showPassword ? (isAr ? 'إخفاء كلمة السر' : 'Hide password') : (isAr ? 'إظهار كلمة السر' : 'Show password')}>
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                    </Field>
                    <button type="submit" disabled={busy}
                        className="w-full bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold py-3.5 rounded-xl transition-all disabled:opacity-60 flex items-center justify-center gap-2">
                        {busy && <Loader2 size={18} className="animate-spin" />}
                        {isAr ? 'اعمل الحساب واقبل الدعوة' : 'Create account and accept'}
                    </button>
                    <p className="text-center text-zinc-500 text-xs">
                        {isAr ? 'عندك حساب؟' : 'Already have an account?'}{' '}
                        <Link href={loginHref()} className="text-marine-primary font-bold hover:underline">{isAr ? 'سجل دخول' : 'Sign in'}</Link>
                    </p>
                    <DeclineButton onClick={decline} busy={busy} isAr={isAr} />
                </form>
            )}
        </Shell>
    );
}

function Shell({ children, isAr }) {
    return (
        <div className="min-h-screen bg-marine-canvas flex items-center justify-center px-4 py-12" dir={isAr ? 'rtl' : 'ltr'}>
            <div className="w-full max-w-lg bg-white border border-zinc-200/80 rounded-3xl p-6 sm:p-8 shadow-xl">{children}</div>
        </div>
    );
}

function Field({ label, children }) {
    return (
        <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-700 uppercase tracking-widest">{label}</label>
            {children}
        </div>
    );
}

function DeclineButton({ onClick, busy, isAr }) {
    return (
        <button type="button" onClick={onClick} disabled={busy} className="w-full bg-transparent text-zinc-500 hover:text-zinc-300 font-bold py-3 rounded-xl transition-all disabled:opacity-60 text-sm">
            {isAr ? 'رفض الدعوة' : 'Decline'}
        </button>
    );
}
