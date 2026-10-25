"use client";

import { useEffect, useState } from "react";
import { Loader2, UserCheck, X } from "lucide-react";
import OtpCodeInput from "./OtpCodeInput";
import { guestCopy, guestErrorCopy } from "../../lib/guestCheckoutLocalization";
import { otpLoginApi } from "../../lib/api";

/**
 * Shown inline under the phone field when the number entered already has an
 * account.
 *
 * Everything about the placement is deliberate. It appears UNDER the field the
 * customer just left, not as a modal, because a modal at this point reads as a
 * login wall arriving late — the exact thing guest checkout exists to avoid. It
 * never steals focus, and dismissing it is one tap that costs nothing: the
 * checkout underneath stays filled in and the customer carries on as a guest.
 *
 * The offer is framed as a convenience ("bring back your addresses"), never as
 * a requirement, because it genuinely is one. A customer who ignores this can
 * still complete the same order.
 */
export default function KnownNumberPrompt({
    phone,
    canUsePassword,
    isAr,
    language,
    // True once the server has actually refused a guest session for this number.
    // The offer then stops being optional — not as a policy choice, but because
    // a session for someone else's account is the one thing guest checkout must
    // never hand out. The escape hatch becomes "use a different number", which
    // is honest, rather than "continue", which would do nothing.
    blocking = false,
    onSignedIn,
    onDismiss,
    onUseAnotherNumber,
}) {
    const c = guestCopy(isAr);
    // 'offer' → the one-line invitation; 'code' → the six boxes.
    const [stage, setStage] = useState("offer");
    const [sending, setSending] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [error, setError] = useState("");
    const [masked, setMasked] = useState("");
    const [cooldown, setCooldown] = useState(0);

    useEffect(() => {
        if (cooldown <= 0) return;
        const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
        return () => clearTimeout(timer);
    }, [cooldown]);

    const secondsUntil = (iso) => {
        if (!iso) return 0;
        return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000));
    };

    const sendCode = async () => {
        setSending(true);
        setError("");
        try {
            const res = await otpLoginApi.send({ phone, language });
            setMasked(res?.verification?.masked_destination || "");
            setCooldown(secondsUntil(res?.verification?.resend_available_at));
            setStage("code");
        } catch (err) {
            // A cooldown is not a failure — the code is already on its way from
            // a previous request, so move to the boxes rather than blocking.
            if (err.code === "OTP_RESEND_COOLDOWN") {
                setCooldown(err.retryAfterSeconds || 60);
                setStage("code");
            } else {
                setError(guestErrorCopy(err.code, isAr) || err.message);
            }
        } finally {
            setSending(false);
        }
    };

    const verify = async (code) => {
        setVerifying(true);
        setError("");
        try {
            const res = await otpLoginApi.verify({ phone, code, remember_me: true });
            onSignedIn?.(res.user);
        } catch (err) {
            const base = guestErrorCopy(err.code, isAr) || err.message;
            setError(err.attemptsRemaining !== undefined
                ? `${base} ${c.attemptsLeft(err.attemptsRemaining)}`
                : base);
        } finally {
            setVerifying(false);
        }
    };

    return (
        <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50/60 p-4">
            <div className="flex items-start gap-3">
                <div className="shrink-0 w-9 h-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                    <UserCheck size={18} />
                </div>

                <div className="flex-1 min-w-0">
                    <p className="font-semibold text-marine-ink text-sm">{c.knownNumberTitle}</p>

                    {stage === "offer" ? (
                        <>
                            <p className="text-sm text-marine-muted mt-0.5">
                                {blocking ? c.knownNumberRequired : c.knownNumberBody}
                            </p>
                            <div className="flex flex-wrap items-center gap-2 mt-3">
                                <button
                                    type="button"
                                    onClick={sendCode}
                                    disabled={sending}
                                    className="inline-flex items-center gap-2 bg-marine-navy text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-marine-teal transition-colors disabled:opacity-60"
                                >
                                    {sending && <Loader2 size={14} className="animate-spin" />}
                                    {c.sendCode}
                                </button>
                                <button
                                    type="button"
                                    onClick={blocking ? onUseAnotherNumber : onDismiss}
                                    className="text-sm text-marine-outline hover:text-marine-ink px-2 py-2 transition-colors"
                                >
                                    {blocking ? c.useAnotherNumber : c.continueAsGuest}
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <p className="text-sm text-marine-muted mt-0.5 mb-3">
                                {c.codeSentTo(masked || phone.slice(-4).padStart(phone.length, "*"))}
                            </p>
                            <OtpCodeInput
                                onComplete={verify}
                                loading={verifying}
                                error={error}
                                dir={isAr ? "rtl" : "ltr"}
                            />
                            <div className="flex flex-wrap items-center justify-center gap-3 mt-3">
                                <button
                                    type="button"
                                    onClick={sendCode}
                                    disabled={cooldown > 0 || sending}
                                    className="text-sm text-marine-muted hover:text-marine-ink disabled:text-marine-outline disabled:cursor-not-allowed transition-colors"
                                >
                                    {cooldown > 0 ? c.resendIn(cooldown) : c.resend}
                                </button>
                                <span className="text-marine-line">·</span>
                                <button
                                    type="button"
                                    onClick={blocking ? onUseAnotherNumber : onDismiss}
                                    className="text-sm text-marine-outline hover:text-marine-ink transition-colors"
                                >
                                    {blocking ? c.useAnotherNumber : c.continueAsGuest}
                                </button>
                            </div>
                        </>
                    )}

                    {stage === "offer" && error && (
                        <p className="mt-2 text-sm text-red-600">{error}</p>
                    )}

                    {canUsePassword && stage === "offer" && (
                        <a
                            href={`/login?redirect=${encodeURIComponent("/checkout")}`}
                            className="inline-block mt-2 text-xs text-marine-outline hover:text-marine-ink underline underline-offset-2 transition-colors"
                        >
                            {c.usePasswordInstead}
                        </a>
                    )}
                </div>

                {!blocking && (
                    <button
                        type="button"
                        onClick={onDismiss}
                        aria-label={c.continueAsGuest}
                        className="shrink-0 text-marine-outline hover:text-marine-muted transition-colors"
                    >
                        <X size={16} />
                    </button>
                )}
            </div>
        </div>
    );
}
