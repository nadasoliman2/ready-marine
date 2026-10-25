'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Six boxes that LOOK like six fields and ARE one field.
 *
 * The first version of this component was six real `<input>`s, each holding one digit,
 * moving focus forward by hand after every keystroke. That works on a desktop keyboard
 * and falls apart on a phone: Android keyboards keep a composition open on the box that
 * was focused when the key went down, so a digit typed after a programmatic focus move
 * lands in the previous box and REPLACES what was there. To the person typing the code
 * they just read off WhatsApp, the field wipes itself after every digit.
 *
 * So there is exactly one real input, invisible, stretched over the row. The keyboard,
 * paste, Backspace and the OS "fill code from message" suggestion all act on it natively,
 * and the six boxes only render what it holds. Nothing here ever moves focus.
 *
 * Kept always left-to-right even in Arabic: a numeric code is read in the order it was
 * sent, and mirroring the boxes under RTL makes people type it backwards.
 */
export default function OtpInput({ value, onChange, onComplete, disabled, autoFocus = true, length = 6 }) {
    const inputRef = useRef(null);
    const [focused, setFocused] = useState(false);
    // The code that was last handed to `onComplete`, so a re-render with the same six
    // digits (or the parent echoing the value back) does not submit it twice.
    const completedRef = useRef('');

    const code = String(value || '').replace(/\D/g, '').slice(0, length);

    useEffect(() => {
        if (autoFocus) inputRef.current?.focus();
    }, [autoFocus]);

    // A parent that clears the value (a rejected code, a resend) must be able to submit
    // the same six digits again afterwards.
    useEffect(() => {
        if (code.length < length) completedRef.current = '';
    }, [code, length]);

    const handleChange = (event) => {
        const cleaned = String(event.target.value || '').replace(/\D/g, '').slice(0, length);
        onChange(cleaned);
        if (cleaned.length === length && completedRef.current !== cleaned) {
            completedRef.current = cleaned;
            onComplete?.(cleaned);
        }
    };

    // Wherever the caret is dropped, typing always appends to the end: the boxes have no
    // visible caret, so a digit landing in the middle would be a surprise.
    const moveCaretToEnd = () => {
        const el = inputRef.current;
        if (!el) return;
        const end = el.value.length;
        try { el.setSelectionRange(end, end); } catch (_) { /* not a selectable type */ }
    };

    const activeIndex = Math.min(code.length, length - 1);

    return (
        <div
            className="relative flex items-center justify-center gap-2 sm:gap-3"
            dir="ltr"
            onClick={() => inputRef.current?.focus()}
        >
            {Array.from({ length }, (_, index) => {
                const digit = code[index] || '';
                const active = focused && !disabled && index === activeIndex;
                return (
                    <div
                        key={index}
                        aria-hidden="true"
                        className={`w-11 h-14 sm:w-12 sm:h-16 flex items-center justify-center text-2xl font-black rounded-xl bg-white/5 border-2 text-white transition-colors ${
                            active ? 'border-marine-cyan' : 'border-white/10'
                        } ${disabled ? 'opacity-50' : ''}`}
                    >
                        {digit}
                        {active && !digit && <span className="w-0.5 h-7 bg-marine-cyan animate-pulse" />}
                    </div>
                );
            })}
            <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                // Lets iOS/Android offer the code straight from the message.
                autoComplete="one-time-code"
                maxLength={length}
                disabled={disabled}
                value={code}
                onChange={handleChange}
                onFocus={() => { setFocused(true); moveCaretToEnd(); }}
                onBlur={() => setFocused(false)}
                onSelect={moveCaretToEnd}
                aria-label="Verification code"
                // Invisible but present: `display:none` or `visibility:hidden` would take the
                // keyboard and the autofill suggestion away with it. 16px keeps iOS from
                // zooming the page when it is focused.
                className="absolute inset-0 w-full h-full opacity-0 text-[16px] text-transparent caret-transparent bg-transparent border-0 outline-none cursor-text disabled:cursor-not-allowed"
                style={{ WebkitTextFillColor: 'transparent' }}
            />
        </div>
    );
}
