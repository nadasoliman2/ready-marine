"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * Six boxes that LOOK like six fields and ARE one field.
 *
 * Split boxes are used rather than a plain input because a 6-digit code is read
 * off a phone in pairs, and a single input makes the customer lose their place.
 * The first version rebuilt that with six real inputs and hand-moved focus after
 * every keystroke, which is exactly what phone keyboards cannot cope with:
 * Android keeps a composition open on the box that had focus when the key went
 * down, so the next digit lands in the PREVIOUS box and replaces it. Reading a
 * code off WhatsApp and typing it in, the customer watched it wipe itself.
 *
 * So the row is one invisible real input stretched over six display boxes.
 * Typing, paste, Backspace and the OS "fill code from message" suggestion all
 * act on it natively, and nothing here ever moves focus. What survives from
 * the old design:
 *
 *  - `inputMode="numeric"` and `autoComplete="one-time-code"` are what let iOS
 *    and Android offer the code from the notification.
 *  - The row submits itself the moment it is full. Asking someone to press a
 *    button after typing the last digit is a step that never needed to exist.
 *  - A rejected code clears itself: the customer is going to retype all six
 *    anyway, and leaving the wrong ones in place makes them delete first.
 */
export default function OtpCodeInput({
    length = 6,
    onComplete,
    disabled = false,
    loading = false,
    error = "",
    autoFocus = true,
    dir = "ltr",
}) {
    const [code, setCode] = useState("");
    const [focused, setFocused] = useState(false);
    const inputRef = useRef(null);
    // Guards against re-firing while the parent is still verifying the code the
    // last keystroke already submitted.
    const submittedRef = useRef("");

    useEffect(() => {
        if (autoFocus) inputRef.current?.focus();
    }, [autoFocus]);

    useEffect(() => {
        if (!error) return;
        setCode("");
        submittedRef.current = "";
        inputRef.current?.focus();
    }, [error]);

    const handleChange = (event) => {
        const next = String(event.target.value || "").replace(/\D/g, "").slice(0, length);
        setCode(next);
        if (next.length < length) submittedRef.current = "";
        if (next.length === length && submittedRef.current !== next) {
            submittedRef.current = next;
            onComplete?.(next);
        }
    };

    // Wherever the caret is dropped, typing always appends: the boxes show no
    // caret, so a digit landing in the middle would be a surprise.
    const moveCaretToEnd = () => {
        const el = inputRef.current;
        if (!el) return;
        const end = el.value.length;
        try { el.setSelectionRange(end, end); } catch (_) { /* not a selectable type */ }
    };

    const isDisabled = disabled || loading;
    const activeIndex = Math.min(code.length, length - 1);

    return (
        <div>
            {/* The row is always laid out left-to-right, even in Arabic: a
                numeric code is read in the order it was sent, and mirroring it
                would put the first digit the customer types on the right. */}
            <div
                className="relative flex gap-2 justify-center"
                dir="ltr"
                onClick={() => inputRef.current?.focus()}
            >
                {Array.from({ length }, (_, index) => {
                    const digit = code[index] || "";
                    const active = focused && !isDisabled && index === activeIndex;
                    return (
                        <div
                            key={index}
                            aria-hidden="true"
                            className={`w-11 h-14 sm:w-12 sm:h-14 flex items-center justify-center text-xl font-bold rounded-xl border-2 transition-all
                                ${error
                                    ? "border-red-400 bg-red-50 text-red-700"
                                    : digit
                                        ? "border-marine-cyan bg-white text-marine-ink"
                                        : active
                                            ? "border-marine-cyan bg-white text-marine-ink ring-2 ring-marine-cyan/20"
                                            : "border-marine-teal/15 bg-white text-marine-ink"}
                                ${isDisabled ? "opacity-60" : ""}`}
                        >
                            {digit}
                            {active && !digit && <span className="w-0.5 h-6 bg-marine-cyan animate-pulse" />}
                        </div>
                    );
                })}
                <input
                    ref={inputRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="one-time-code"
                    maxLength={length}
                    value={code}
                    disabled={isDisabled}
                    onChange={handleChange}
                    onFocus={() => { setFocused(true); moveCaretToEnd(); }}
                    onBlur={() => setFocused(false)}
                    onSelect={moveCaretToEnd}
                    aria-label="Verification code"
                    // Invisible but present: hiding it with `display:none` would
                    // take the keyboard and the autofill suggestion away too.
                    // 16px keeps iOS from zooming the page on focus.
                    className="absolute inset-0 w-full h-full opacity-0 text-[16px] text-transparent caret-transparent bg-transparent border-0 outline-none cursor-text disabled:cursor-not-allowed"
                    style={{ WebkitTextFillColor: "transparent" }}
                />
            </div>

            {loading && (
                <div className="flex items-center justify-center gap-2 mt-3 text-sm text-marine-outline">
                    <Loader2 size={16} className="animate-spin" />
                </div>
            )}

            {error && (
                <p className="mt-3 text-sm text-red-600 text-center" dir={dir}>{error}</p>
            )}
        </div>
    );
}
