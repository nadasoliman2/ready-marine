/**
 * Copy for contact verification: choosing a registration channel, entering a
 * one-time code, and confirming email/phone after login.
 */

/** Maps a backend error code to copy that names the next useful action. */
export const verificationErrorCopy = (code, isAr, context = {}) => {
    const seconds = context.retryAfterSeconds;

    const messages = {
        OTP_INVALID_FORMAT: isAr ? 'أدخل الرمز المكوّن من 6 أرقام.' : 'Enter the 6-digit code.',
        OTP_INCORRECT: isAr ? 'الرمز غير صحيح.' : 'Incorrect code.',
        OTP_EXPIRED: isAr
            ? 'انتهت صلاحية الرمز. اطلب رمزاً جديداً.'
            : 'This code expired. Request a new one.',
        OTP_NOT_FOUND: isAr
            ? 'لا يوجد رمز نشط. اطلب رمزاً جديداً.'
            : 'No active code. Request a new one.',
        OTP_ALREADY_USED: isAr
            ? 'تم استخدام هذا الرمز بالفعل. اطلب رمزاً جديداً.'
            : 'This code was already used. Request a new one.',
        OTP_TOO_MANY_ATTEMPTS: isAr
            ? 'محاولات خاطئة كثيرة. اطلب رمزاً جديداً.'
            : 'Too many incorrect attempts. Request a new code.',
        OTP_RESEND_COOLDOWN: isAr
            ? `يرجى الانتظار ${seconds || 'قليلاً'} ثانية قبل طلب رمز جديد.`
            : `Please wait ${seconds || 'a moment'} seconds before requesting another code.`,
        OTP_RESEND_LIMIT: isAr
            ? 'تم طلب رموز كثيرة. حاول مرة أخرى لاحقاً.'
            : 'Too many codes requested. Please try again later.',
        OTP_DELIVERY_FAILED: isAr
            ? 'تعذّر إرسال الرمز. تحقّق من البيانات أو جرّب الطريقة الأخرى.'
            : 'Could not send the code. Check the details or try the other method.',
        VERIFICATION_EXPIRED: isAr
            ? 'انتهت صلاحية هذا التسجيل. يرجى التسجيل من جديد.'
            : 'This registration expired. Please register again.',
        VERIFICATION_NOT_FOUND: isAr
            ? 'لم يعد هذا التسجيل قائماً. يرجى التسجيل من جديد.'
            : 'This registration is no longer pending. Please register again.',
        EMAIL_IN_USE: isAr
            ? 'هذا البريد مستخدم بحساب آخر.'
            : 'That email is already used by another account.',
        PHONE_IN_USE: isAr
            ? 'رقم الهاتف مستخدم بحساب آخر.'
            : 'That phone number is already used by another account.',
        INVALID_EMAIL: isAr ? 'أدخل بريداً إلكترونياً صحيحاً.' : 'Enter a valid email address.',
        INVALID_PHONE: isAr ? 'أدخل رقم هاتف صحيحاً.' : 'Enter a valid phone number.',
        RATE_LIMITED: isAr
            ? 'محاولات كثيرة. حاول مرة أخرى بعد قليل.'
            : 'Too many attempts. Please try again shortly.',
    };

    return messages[code] || null;
};

export const verificationCopy = (isAr) => (isAr ? {
    // ---- Channel choice at registration ----
    howToVerify: 'كيف تريد تأكيد حسابك؟',
    channelEmail: 'البريد الإلكتروني',
    channelEmailDesc: 'نرسل لك رابط تفعيل على بريدك.',
    channelWhatsapp: 'واتساب',
    channelWhatsappDesc: 'نرسل لك رمزاً من 6 أرقام على رقمك.',
    // A store owner gets a CODE by email, not a link — they are mid-form and a
    // link would send them out to an inbox to come back.
    howToVerifyStore: 'كيف تريد تأكيد متجرك؟',
    channelEmailCodeDesc: 'نرسل لك رمزاً من 6 أرقام على بريدك.',
    storeChannelNote: 'الرمز يثبت الوسيلة اللي اخترتها فقط، وهنطلب منك تأكيد التانية بعد الدخول.',

    // ---- OTP screen ----
    enterCode: 'أدخل رمز التحقق',
    codeSentTo: 'أرسلنا رمزاً مكوّناً من 6 أرقام إلى',
    verify: 'تأكيد',
    resendCode: 'إعادة إرسال الرمز',
    resendIn: (s) => `يمكنك إعادة الإرسال بعد ${s} ثانية`,
    codeExpiresIn: (m) => `ينتهي الرمز خلال ${m} دقائق`,
    changeMethod: 'استخدام البريد الإلكتروني بدلاً من ذلك',
    whatsappDelayNote: 'قد يستغرق وصول رمز واتساب حتى دقيقة. إذا لم يصلك، استخدم البريد الإلكتروني.',
    checkEmailTitle: 'تحقّق من بريدك الإلكتروني',
    checkEmailBody: 'أرسلنا رابط تفعيل إلى بريدك. افتحه لإكمال إنشاء الحساب.',

    // ---- Post-login prompt ----
    confirmYourDetails: 'أكّد بيانات التواصل',
    confirmIntro: 'نستخدم هذه البيانات لإرسال تأكيدات الطلبات وتحديثات الشحن. أكّدها لتصلك الإشعارات بشكل صحيح.',
    emailLabel: 'البريد الإلكتروني',
    phoneLabel: 'رقم الهاتف',
    verified: 'مؤكَّد',
    notVerified: 'غير مؤكَّد',
    sendCode: 'إرسال رمز',
    confirmNow: 'تأكيد الآن',
    edit: 'تعديل',
    saveAndSend: 'حفظ وإرسال الرمز',
    cancel: 'إلغاء',
    later: 'لاحقاً',
    done: 'تم',
    allConfirmed: 'تم تأكيد بريدك الإلكتروني ورقم هاتفك.',
    pendingChangeNote: (v) => `بانتظار تأكيد: ${v}`,
    whatsappNote: 'سيصلك الرمز على واتساب.',
    emailCodeNote: 'سيصلك الرمز على بريدك الإلكتروني.',
    verifyBannerText: 'أكّد بريدك الإلكتروني ورقم هاتفك لتصلك تأكيدات الطلبات.',
    verifyBannerCta: 'تأكيد الآن',
} : {
    // ---- Channel choice at registration ----
    howToVerify: 'How would you like to confirm your account?',
    channelEmail: 'Email',
    channelEmailDesc: 'We send a verification link to your inbox.',
    channelWhatsapp: 'WhatsApp',
    channelWhatsappDesc: 'We send a 6-digit code to your number.',
    howToVerifyStore: 'How would you like to confirm your store?',
    channelEmailCodeDesc: 'We send a 6-digit code to your inbox.',
    storeChannelNote: 'The code proves only the method you pick — we will ask you to confirm the other one after you sign in.',

    // ---- OTP screen ----
    enterCode: 'Enter your verification code',
    codeSentTo: 'We sent a 6-digit code to',
    verify: 'Verify',
    resendCode: 'Resend code',
    resendIn: (s) => `You can resend in ${s}s`,
    codeExpiresIn: (m) => `The code expires in ${m} minutes`,
    changeMethod: 'Use email instead',
    whatsappDelayNote: 'The WhatsApp code can take up to a minute to arrive. If it does not, use email instead.',
    checkEmailTitle: 'Check your email',
    checkEmailBody: 'We sent a verification link to your inbox. Open it to finish creating your account.',

    // ---- Post-login prompt ----
    confirmYourDetails: 'Confirm your contact details',
    confirmIntro: 'We use these to send order confirmations and delivery updates. Confirm them so your notifications reach you.',
    emailLabel: 'Email address',
    phoneLabel: 'Phone number',
    verified: 'Verified',
    notVerified: 'Not verified',
    sendCode: 'Send code',
    confirmNow: 'Confirm now',
    edit: 'Edit',
    saveAndSend: 'Save and send code',
    cancel: 'Cancel',
    later: 'Later',
    done: 'Done',
    allConfirmed: 'Your email and phone number are confirmed.',
    pendingChangeNote: (v) => `Awaiting confirmation: ${v}`,
    whatsappNote: 'The code arrives on WhatsApp.',
    emailCodeNote: 'The code arrives in your inbox.',
    verifyBannerText: 'Confirm your email and phone so order confirmations reach you.',
    verifyBannerCta: 'Confirm now',
});
