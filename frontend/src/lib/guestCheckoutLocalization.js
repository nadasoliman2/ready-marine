/**
 * Guest checkout copy (English / Arabic).
 *
 * The single rule this file exists to enforce: the customer is never told they
 * are creating an account, because from their side they are not. They are
 * buying something. An account happens to be how we remember them.
 *
 * So there is no "register", no "sign up", no "create your account", and no
 * checkbox offering one. Concretely:
 *
 *  - The code sent after an order says "confirm your order", never "activate
 *    your account". It is the same code either way; the framing is what decides
 *    whether it reads as part of the purchase or as a second task bolted on.
 *  - A password is offered ONLY after the order is done, and it is described as
 *    a convenience the customer may skip. It is never a field in the checkout.
 *  - A returning customer is greeted, not challenged. "This number has an
 *    account" is an offer to make things easier, and declining it must always
 *    be one tap away and cost them nothing.
 *  - Errors around identity never speculate. "We could not send the code" is
 *    honest; "this number is already registered" tells a stranger something
 *    about someone else.
 */

export const guestCopy = (isAr) => ({
    /* ---- Returning customer, detected from the phone field ---- */
    knownNumberTitle: isAr
        ? 'الرقم ده مسجّل عندنا 👋'
        : "We recognise this number 👋",
    knownNumberBody: isAr
        ? 'ابعتلك كود على الواتساب ونجيب عناوينك ورصيدك؟'
        : 'Send a WhatsApp code to bring back your addresses and balance?',
    // Used once the server has refused a guest session for this number. It is
    // phrased as the last easy step rather than as a refusal, and it never says
    // "you must sign in" — the customer is one tap and six digits away, which is
    // less work than the password they were about to be asked for.
    knownNumberRequired: isAr
        ? 'عشان نكمل الطلب على الرقم ده، أكّده بكود على الواتساب.'
        : 'To finish your order on this number, confirm it with a WhatsApp code.',
    sendCode: isAr ? 'ابعت الكود' : 'Send the code',
    continueAsGuest: isAr ? 'كمّل من غير تسجيل' : 'Continue without signing in',
    useAnotherNumber: isAr ? 'استخدم رقم تاني' : 'Use a different number',
    usePasswordInstead: isAr ? 'أدخل بكلمة السر' : 'Use my password instead',

    /* ---- The code box ---- */
    codeSentTo: (masked) => isAr
        ? `بعتنا كود من ٦ أرقام على واتساب ${masked}`
        : `We sent a 6-digit code to WhatsApp ${masked}`,
    codeLabel: isAr ? 'كود التأكيد' : 'Confirmation code',
    verify: isAr ? 'تأكيد' : 'Confirm',
    resend: isAr ? 'إعادة إرسال الكود' : 'Resend the code',
    resendIn: (seconds) => isAr
        ? `تقدر تطلب كود جديد بعد ${seconds} ثانية`
        : `You can request a new code in ${seconds}s`,
    changeNumber: isAr ? 'تعديل الرقم' : 'Change the number',
    attemptsLeft: (n) => isAr
        ? `فاضل ${n} ${n === 1 ? 'محاولة' : 'محاولات'}`
        : `${n} attempt${n === 1 ? '' : 's'} left`,

    /* ---- After the order: confirmation, not activation ---- */
    confirmOrderTitle: isAr ? 'أكّد طلبك' : 'Confirm your order',
    confirmOrderBody: (masked) => isAr
        ? `بعتنا كود على واتساب ${masked}. أكّده عشان نبدأ التجهيز على طول.`
        : `We sent a code to WhatsApp ${masked}. Confirm it so we can start preparing your order right away.`,
    confirmOrderWhy: isAr
        ? 'ده بيأكد إن رقمك صح قبل ما المندوب يتحرك — ومش هنكلمك تأكيد تاني.'
        : 'This checks we have the right number before a courier sets off — and saves you a confirmation call.',
    confirmed: isAr ? 'تم تأكيد طلبك ✅' : 'Your order is confirmed ✅',
    confirmLater: isAr ? 'هأكده بعدين' : "I'll confirm later",
    confirmLaterNote: isAr
        ? 'طلبك اتسجّل عندنا. هنكلمك على الرقم ده لتأكيده قبل الشحن.'
        : 'Your order is saved. We will call this number to confirm it before shipping.',

    /* ---- The optional password, offered last ---- */
    accountReadyTitle: isAr ? 'حسابك جاهز' : 'Your account is ready',
    accountReadyBody: (phone) => isAr
        ? `تقدر تتابع طلباتك في أي وقت برقم ${phone}. عايز تدخل بكلمة سر بدل الكود كل مرة؟`
        : `You can follow your orders any time with ${phone}. Want a password instead of a code each time?`,
    optional: isAr ? 'اختياري' : 'Optional',
    passwordLabel: isAr ? 'كلمة السر' : 'Password',
    passwordHint: isAr ? '٦ أحرف على الأقل' : 'At least 6 characters',
    savePassword: isAr ? 'حفظ' : 'Save',
    passwordSaved: isAr ? 'تم حفظ كلمة السر ✅' : 'Password saved ✅',
    skip: isAr ? 'مش دلوقتي' : 'Not now',

    /* ---- Earned points, shown as a reason to keep the account ---- */
    pointsEarned: (points) => isAr
        ? `كسبت ${points} نقطة في محفظتك 🎁`
        : `You earned ${points} points 🎁`,

    /* ---- Errors ---- */
    codeIncorrect: isAr ? 'الكود غلط. جرّب تاني.' : 'That code is not right. Try again.',
    codeExpired: isAr ? 'الكود انتهت صلاحيته. اطلب كود جديد.' : 'That code expired. Request a new one.',
    sendFailed: isAr
        ? 'تعذر إرسال الكود دلوقتي. تقدر تكمل عادي وهنكلمك.'
        : 'We could not send the code right now. You can carry on — we will call you.',
    nameRequired: isAr ? 'اكتب اسمك' : 'Please enter your name',
    phoneInvalid: isAr
        ? 'رقم غير صحيح. لازم يبدأ بـ 01 ويكون ١١ رقم.'
        : 'Invalid number. It should start with 01 and be 11 digits.',
});

/**
 * Map a backend error code to copy the customer can act on.
 *
 * Returns null for anything unrecognised so the caller falls back to the
 * server's own message rather than inventing one — a wrong explanation is
 * worse than a plain one.
 */
export const guestErrorCopy = (code, isAr) => {
    const c = guestCopy(isAr);
    switch (code) {
        case 'OTP_INCORRECT': return c.codeIncorrect;
        case 'OTP_EXPIRED':
        case 'OTP_NOT_FOUND': return c.codeExpired;
        case 'OTP_DELIVERY_FAILED': return c.sendFailed;
        case 'GUEST_NAME_REQUIRED': return c.nameRequired;
        case 'GUEST_PHONE_INVALID': return c.phoneInvalid;
        default: return null;
    }
};
