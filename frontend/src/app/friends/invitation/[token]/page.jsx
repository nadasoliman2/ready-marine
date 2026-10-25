'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from '../../../../lib/navigation';
import Link from '../../../../components/LocaleLink';
import { Users, Loader2, CheckCircle2, XCircle, ShieldCheck, MapPin } from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { friendInvitationApi } from '../../../../lib/api';
import { inviteCopy, inviteErrorCopy } from '../../../../lib/inviteLocalization';
import OtpCodeInput from '../../../../components/checkout/OtpCodeInput';
import ShippingZoneSelect from '../../../../components/ShippingZoneSelect';
import { resolveAssetUrl } from '../../../../lib/assets';

/**
 * Friend invitation landing page — the destination of a WhatsApp invite link.
 *
 * Reached by someone who has, in the ordinary case, never had an account here.
 * The whole page is therefore built around one idea: they are answering a
 * person, not filling in a sign-up form. There is no password field anywhere,
 * the primary button names their friend rather than the account, and the code
 * is presented as confirming the number the link was sent to.
 *
 * Opening the link accepts nothing. A WhatsApp message can be forwarded, and
 * accepting grants read access to the inviter's saved addresses — so the code is
 * what separates "someone opened this link" from "the invited person is here".
 */
const Shell = ({ dir, children }) => (
    <div className="min-h-[70vh] flex items-center justify-center p-4 bg-zinc-50" dir={dir}>
        <div className="bg-white p-7 sm:p-8 rounded-3xl shadow-xl w-full max-w-md border border-zinc-100">
            {children}
        </div>
    </div>
);

export default function FriendInvitationPage() {
    const params = useParams();
    const router = useRouter();
    const { user, login, language, isMounted } = useApp();
    const isAr = language === 'ar';
    const dir = isAr ? 'rtl' : 'ltr';
    const c = inviteCopy(isAr);
    const token = String(params?.token || '');

    const [preview, setPreview] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [outcome, setOutcome] = useState(null); // 'joined' | 'declined'

    // 'intro' → who invited you and what it means; 'code' → the six boxes.
    const [stage, setStage] = useState('intro');
    const [form, setForm] = useState({ name: '', full_address: '', shipping_country: '', shipping_city: '' });
    const [formError, setFormError] = useState('');

    const [sending, setSending] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [codeError, setCodeError] = useState('');
    const [masked, setMasked] = useState('');
    const [cooldown, setCooldown] = useState(0);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!isMounted || !token) return;
        (async () => {
            try {
                setPreview(await friendInvitationApi.preview(token));
                setLoadError(null);
            } catch (err) {
                setLoadError(inviteErrorCopy(err.code, isAr) || err.message);
            } finally {
                setLoading(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isMounted, token]);

    useEffect(() => {
        if (cooldown <= 0) return;
        const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
        return () => clearTimeout(timer);
    }, [cooldown]);

    const secondsUntil = (iso) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000)) : 0);

    const inviterName = preview?.inviter?.name || (isAr ? 'صاحبك' : 'Your friend');
    const needsSetup = preview?.needs_account_setup;
    const needsAddress = needsSetup && !preview?.recipient_has_address;

    /**
     * Collect the name and address BEFORE sending the code.
     *
     * Deliberately this order. The details are what the invitee is here to
     * provide, and a code that arrives while they are still typing is a code
     * that may expire before they finish. Sending it as the last thing before
     * they need it keeps the ten-minute window pointed at the ten minutes that
     * matter.
     */
    const startCodeStep = async () => {
        setFormError('');
        if (needsSetup && !form.name.trim()) { setFormError(c.nameRequired); return; }
        if (needsAddress && !form.full_address.trim()) { setFormError(c.addressRequired); return; }

        setSending(true);
        try {
            const res = await friendInvitationApi.sendCode(token, language);
            setMasked(res?.verification?.masked_destination || preview?.invited_masked || '');
            setCooldown(secondsUntil(res?.verification?.resend_available_at));
            setStage('code');
        } catch (err) {
            if (err.code === 'OTP_RESEND_COOLDOWN') {
                setCooldown(err.retryAfterSeconds || 60);
                setStage('code');
            } else {
                setFormError(inviteErrorCopy(err.code, isAr) || err.message);
            }
        } finally {
            setSending(false);
        }
    };

    const accept = async (code) => {
        setVerifying(true);
        setCodeError('');
        try {
            const res = await friendInvitationApi.accept(token, {
                code,
                name: form.name.trim(),
                address: needsAddress ? {
                    full_address: form.full_address.trim(),
                    shipping_country: form.shipping_country || null,
                    shipping_city: form.shipping_city || null,
                } : undefined,
                language,
            });
            // Accepting signs them in, so the app has to know about it — without
            // this they would land on a Friends tab that believes nobody is here.
            if (res.user) login(res.user, { rememberMe: true });
            setOutcome('joined');
            setTimeout(() => router.push('/profile?tab=friends'), 2200);
        } catch (err) {
            const base = inviteErrorCopy(err.code, isAr) || err.message;
            setCodeError(err.attemptsRemaining !== undefined
                ? `${base} ${c.attemptsLeft(err.attemptsRemaining)}`
                : base);
        } finally {
            setVerifying(false);
        }
    };

    const decline = async () => {
        setBusy(true);
        try {
            await friendInvitationApi.decline(token);
            setOutcome('declined');
        } catch (err) {
            setCodeError(inviteErrorCopy(err.code, isAr) || err.message);
        } finally {
            setBusy(false);
        }
    };

    /* ---------------------------------------------------------------- */

    if (!isMounted || loading) {
        return (
            <Shell dir={dir}>
                <div className="flex flex-col items-center gap-3 py-8 text-zinc-500">
                    <Loader2 size={28} className="animate-spin" />
                    <p className="text-sm">{c.loading}</p>
                </div>
            </Shell>
        );
    }

    if (loadError) {
        return (
            <Shell dir={dir}>
                <div className="flex flex-col items-center text-center gap-4">
                    <div className="w-16 h-16 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
                        <XCircle size={30} />
                    </div>
                    <p className="text-zinc-700">{loadError}</p>
                    <Link href="/" className="w-full bg-[#09090b] text-white font-medium py-3 rounded-xl hover:bg-zinc-800 transition-colors text-center">
                        {isAr ? 'الصفحة الرئيسية' : 'Go to homepage'}
                    </Link>
                </div>
            </Shell>
        );
    }

    if (outcome === 'joined') {
        return (
            <Shell dir={dir}>
                <div className="flex flex-col items-center text-center gap-3">
                    <div className="w-16 h-16 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
                        <CheckCircle2 size={30} />
                    </div>
                    <h1 className="text-xl font-bold text-zinc-900">{c.friendJoined(inviterName)}</h1>
                    <p className="text-sm text-zinc-500">{c.friendJoinedBody}</p>
                </div>
            </Shell>
        );
    }

    if (outcome === 'declined') {
        return (
            <Shell dir={dir}>
                <div className="flex flex-col items-center text-center gap-3">
                    <div className="w-16 h-16 rounded-full bg-zinc-100 text-zinc-500 flex items-center justify-center">
                        <XCircle size={30} />
                    </div>
                    <p className="text-zinc-700">{c.declined}</p>
                    <Link href="/products" className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors">
                        {isAr ? 'اتفرج على المنتجات' : 'Browse products'}
                    </Link>
                </div>
            </Shell>
        );
    }

    return (
        <Shell dir={dir}>
            {/* Who is asking. Named and pictured before anything is asked of the
                visitor — an invitation from a person reads differently from a
                form, and this is the only thing that makes it one. */}
            <div className="flex flex-col items-center text-center gap-3 mb-6">
                {preview?.inviter?.profile_image ? (
                    <img
                        src={resolveAssetUrl(preview.inviter.profile_image)}
                        alt={inviterName}
                        className="w-16 h-16 rounded-full object-cover border border-zinc-200"
                    />
                ) : (
                    <div className="w-16 h-16 rounded-full bg-red-50 text-marine-primary flex items-center justify-center">
                        <Users size={28} />
                    </div>
                )}
                <h1 className="text-xl font-bold text-zinc-900">{c.friendTitle(inviterName)}</h1>
                <p className="text-sm text-zinc-500">{c.friendBody}</p>
                {preview?.sender_shared_address_count > 0 && (
                    <p className="text-xs text-zinc-400">{c.friendShares(preview.sender_shared_address_count)}</p>
                )}
            </div>

            {stage === 'intro' ? (
                <div className="space-y-4">
                    {needsSetup && (
                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-zinc-500 uppercase">{c.yourName}</label>
                            <input
                                type="text"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                placeholder={c.yourNamePlaceholder}
                                autoComplete="name"
                                className="w-full px-4 py-3 rounded-lg border border-zinc-200 focus:border-marine-cyan focus:ring-2 focus:ring-marine-cyan/20 outline-none transition-all"
                            />
                        </div>
                    )}

                    {needsAddress && (
                        <div className="space-y-3 rounded-xl border border-zinc-200 p-4">
                            <div className="flex items-center gap-2">
                                <MapPin size={15} className="text-marine-primary" />
                                <p className="font-semibold text-zinc-800 text-sm">{c.friendAddressTitle}</p>
                            </div>
                            <p className="text-xs text-zinc-500">{c.friendAddressWhy}</p>
                            <ShippingZoneSelect
                                country={form.shipping_country}
                                city={form.shipping_city}
                                onChange={({ country, city }) => setForm((f) => ({ ...f, shipping_country: country, shipping_city: city }))}
                            />
                            <textarea
                                rows={3}
                                value={form.full_address}
                                onChange={(e) => setForm({ ...form, full_address: e.target.value })}
                                placeholder={c.addressPlaceholder}
                                className="w-full px-4 py-3 rounded-lg border border-zinc-200 focus:border-marine-cyan focus:ring-2 focus:ring-marine-cyan/20 outline-none transition-all resize-none text-sm"
                            />
                        </div>
                    )}

                    {formError && <p className="text-sm text-red-600">{formError}</p>}

                    <button
                        type="button"
                        onClick={startCodeStep}
                        disabled={sending}
                        className="w-full inline-flex items-center justify-center gap-2 bg-[#09090b] text-white font-medium py-3 rounded-xl hover:bg-zinc-800 transition-colors disabled:opacity-60"
                    >
                        {sending && <Loader2 size={16} className="animate-spin" />}
                        {c.acceptFriend(inviterName)}
                    </button>

                    <p className="text-[11px] text-zinc-400 text-center">{c.invitedTo(preview?.invited_masked || '')}</p>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="text-center">
                        <div className="inline-flex items-center gap-2 mb-1">
                            <ShieldCheck size={16} className="text-zinc-400" />
                            <p className="font-semibold text-zinc-900">{c.confirmNumberTitle}</p>
                        </div>
                        <p className="text-sm text-zinc-500">{c.confirmNumberBody(masked)}</p>
                    </div>

                    <OtpCodeInput onComplete={accept} loading={verifying} error={codeError} dir={dir} />

                    <p className="text-xs text-zinc-400 text-center">{c.whyCode}</p>

                    <div className="flex items-center justify-center gap-3">
                        <button
                            type="button"
                            onClick={startCodeStep}
                            disabled={cooldown > 0 || sending}
                            className="text-sm text-zinc-600 hover:text-zinc-900 disabled:text-zinc-400 disabled:cursor-not-allowed transition-colors"
                        >
                            {cooldown > 0 ? c.resendIn(cooldown) : c.resend}
                        </button>
                    </div>
                </div>
            )}

            <button
                type="button"
                onClick={decline}
                disabled={busy}
                className="w-full mt-5 text-sm text-zinc-400 hover:text-zinc-700 transition-colors"
            >
                {c.decline}
            </button>
        </Shell>
    );
}
