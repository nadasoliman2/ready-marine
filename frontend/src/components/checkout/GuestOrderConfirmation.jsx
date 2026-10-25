"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, MessageCircle, ShieldCheck } from "lucide-react";
import OtpCodeInput from "./OtpCodeInput";
import { guestCopy, guestErrorCopy } from "../../lib/guestCheckoutLocalization";
import { guestApi } from "../../lib/api";

/**
 * The panel on the order-success screen that confirms a guest's phone.
 *
 * This is where the conversion argument for the whole feature lives, so the
 * ordering matters more than the code does:
 *
 *  1. The order is ALREADY PLACED before this renders. Nothing here can fail in
 *     a way that costs the sale. A customer who closes the tab now still has an
 *     order; they get a phone call instead of a code, which is what would have
 *     happened anyway.
 *  2. The code is framed as confirming the ORDER, never as activating an
 *     account. Same code, same effect on the backend — but a customer who has
 *     just bought something will answer "confirm your order", and would read
 *     "finish creating your account" as a chore they did not sign up for.
 *  3. "I'll confirm later" is always visible and never penalised. A dismissable
 *     ask converts better than a trapped one, and trapping someone after taking
 *     their money is how a store earns a chargeback.
 *  4. The password appears LAST, after the code is confirmed, described as
 *     optional. By then the customer has a placed order and points sitting in a
 *     named account — a reason to want one, which they did not have at checkout.
 */
export default function GuestOrderConfirmation({
    isAr,
    language,
    phone,
    pointsEarned = 0,
    onConfirmed,
}) {
    const c = guestCopy(isAr);
    // 'sending' → issuing the first code; 'code' → six boxes; 'password' →
    // the optional offer; 'done' → nothing left to ask for.
    const [stage, setStage] = useState("sending");
    const [masked, setMasked] = useState("");
    const [error, setError] = useState("");
    const [verifying, setVerifying] = useState(false);
    const [cooldown, setCooldown] = useState(0);
    const [dismissed, setDismissed] = useState(false);

    const [password, setPassword] = useState("");
    const [savingPassword, setSavingPassword] = useState(false);
    const [passwordError, setPasswordError] = useState("");

    // The first code is sent automatically, exactly once. Under React's strict
    // double-invoke in development a plain effect would send two, and the
    // second would retire the first — leaving the customer holding a code that
    // no longer works and no idea why.
    const sentRef = useRef(false);

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
        setError("");
        try {
            const res = await guestApi.sendConfirmation({ language });
            setMasked(res?.verification?.masked_destination || "");
            setCooldown(secondsUntil(res?.verification?.resend_available_at));
            setStage("code");
        } catch (err) {
            if (err.code === "OTP_RESEND_COOLDOWN") {
                setCooldown(err.retryAfterSeconds || 60);
                setStage("code");
                return;
            }
            // The number is already confirmed — this customer signed in with a
            // code earlier in the same checkout. Skip straight to the password.
            if (err.code === "PHONE_ALREADY_VERIFIED") {
                setStage("password");
                onConfirmed?.();
                return;
            }
            // Delivery failed. Say so plainly and stop asking: the order is
            // placed, and ops will call. Nagging for a code that cannot arrive
            // is the worst possible last impression.
            setError(guestErrorCopy(err.code, isAr) || err.message);
            setStage("failed");
        }
    };

    useEffect(() => {
        if (sentRef.current) return;
        sentRef.current = true;
        sendCode();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const verify = async (code) => {
        setVerifying(true);
        setError("");
        try {
            await guestApi.confirm({ code });
            onConfirmed?.();
            setStage("password");
        } catch (err) {
            const base = guestErrorCopy(err.code, isAr) || err.message;
            setError(err.attemptsRemaining !== undefined
                ? `${base} ${c.attemptsLeft(err.attemptsRemaining)}`
                : base);
        } finally {
            setVerifying(false);
        }
    };

    const savePassword = async () => {
        if (password.length < 6) {
            setPasswordError(c.passwordHint);
            return;
        }
        setSavingPassword(true);
        setPasswordError("");
        try {
            await guestApi.setPassword({ password });
            setStage("done");
        } catch (err) {
            setPasswordError(guestErrorCopy(err.code, isAr) || err.message);
        } finally {
            setSavingPassword(false);
        }
    };

    if (dismissed) {
        return (
            <div className="w-full rounded-lg border border-marine-teal/15 bg-marine-canvas p-4 text-sm text-marine-muted text-center">
                {c.confirmLaterNote}
            </div>
        );
    }

    if (stage === "done") {
        return (
            <div className="w-full rounded-lg border border-green-200 bg-green-50 p-4 flex items-center justify-center gap-2 text-sm font-medium text-green-800">
                <CheckCircle2 size={18} />
                {c.passwordSaved}
            </div>
        );
    }

    /* ---- The optional password, offered only after the code succeeded ---- */
    if (stage === "password") {
        return (
            <div className="w-full rounded-lg border border-marine-teal/15 bg-white p-5 text-start">
                <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 size={18} className="text-green-600" />
                    <p className="font-semibold text-marine-ink">{c.confirmed}</p>
                </div>

                {pointsEarned > 0 && (
                    <p className="text-sm text-marine-primary font-medium mb-3">{c.pointsEarned(pointsEarned)}</p>
                )}

                <div className="border-t border-marine-teal/15 pt-4 mt-3">
                    <div className="flex items-center gap-2 mb-1">
                        <ShieldCheck size={16} className="text-marine-outline" />
                        <p className="font-semibold text-marine-ink text-sm">{c.accountReadyTitle}</p>
                        <span className="text-[11px] uppercase tracking-wide text-marine-outline border border-marine-teal/15 rounded px-1.5 py-0.5">
                            {c.optional}
                        </span>
                    </div>
                    <p className="text-sm text-marine-muted mb-3">{c.accountReadyBody(phone)}</p>

                    <div className="flex gap-2">
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder={c.passwordLabel}
                            autoComplete="new-password"
                            className="flex-1 px-4 py-2.5 rounded-lg border border-marine-teal/15 focus:border-marine-cyan focus:ring-2 focus:ring-marine-cyan/20 outline-none transition-all text-sm"
                        />
                        <button
                            type="button"
                            onClick={savePassword}
                            disabled={savingPassword}
                            className="inline-flex items-center gap-2 bg-marine-navy text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-marine-teal transition-colors disabled:opacity-60"
                        >
                            {savingPassword && <Loader2 size={14} className="animate-spin" />}
                            {c.savePassword}
                        </button>
                    </div>

                    {passwordError
                        ? <p className="mt-2 text-sm text-red-600">{passwordError}</p>
                        : <p className="mt-2 text-xs text-marine-outline">{c.passwordHint}</p>}

                    <button
                        type="button"
                        onClick={() => setStage("done")}
                        className="mt-3 text-sm text-marine-outline hover:text-marine-ink transition-colors"
                    >
                        {c.skip}
                    </button>
                </div>
            </div>
        );
    }

    /* ---- Delivery failed: state it once, then get out of the way ---- */
    if (stage === "failed") {
        return (
            <div className="w-full rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 text-center">
                {error || c.sendFailed}
            </div>
        );
    }

    /* ---- The code itself ---- */
    return (
        <div className="w-full rounded-lg border border-marine-teal/15 bg-white p-5">
            <div className="flex items-center justify-center gap-2 mb-1">
                <MessageCircle size={18} className="text-green-600" />
                <p className="font-semibold text-marine-ink">{c.confirmOrderTitle}</p>
            </div>
            <p className="text-sm text-marine-muted text-center mb-4">
                {stage === "sending"
                    ? <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /></span>
                    : c.confirmOrderBody(masked || phone)}
            </p>

            {stage === "code" && (
                <>
                    <OtpCodeInput
                        onComplete={verify}
                        loading={verifying}
                        error={error}
                        dir={isAr ? "rtl" : "ltr"}
                    />
                    <p className="text-xs text-marine-outline text-center mt-3">{c.confirmOrderWhy}</p>
                    <div className="flex flex-wrap items-center justify-center gap-3 mt-3">
                        <button
                            type="button"
                            onClick={sendCode}
                            disabled={cooldown > 0}
                            className="text-sm text-marine-muted hover:text-marine-ink disabled:text-marine-outline disabled:cursor-not-allowed transition-colors"
                        >
                            {cooldown > 0 ? c.resendIn(cooldown) : c.resend}
                        </button>
                        <span className="text-marine-line">·</span>
                        <button
                            type="button"
                            onClick={() => setDismissed(true)}
                            className="text-sm text-marine-outline hover:text-marine-ink transition-colors"
                        >
                            {c.confirmLater}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
