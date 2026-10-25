/**
 * Copy for invitations sent to someone who has no account (English / Arabic).
 *
 * The same rule the guest-checkout copy follows: the person being invited is
 * never told they are creating an account. They were invited by someone they
 * know, and they are answering that person — the account is how we remember
 * them afterwards, not a task we hand them first.
 *
 * So: no "register", no "sign up", no password field, and the primary button
 * says what the invitation is for ("Join Baba's family", "Add Ziad as a
 * friend"), never "Create your account".
 *
 * The code is framed as confirming the NUMBER the invitation was sent to, which
 * is honest about why it exists: a WhatsApp link can be forwarded, and accepting
 * gives the accepter access to the inviter's saved addresses.
 */

export const inviteCopy = (isAr) => ({
    /* ---- Shared ---- */
    loading: isAr ? 'جارٍ فتح الدعوة...' : 'Opening the invitation…',
    invitedTo: (masked) => isAr
        ? `الدعوة دي متبعوتة للرقم ${masked}`
        : `This invitation was sent to ${masked}`,
    yourName: isAr ? 'اسمك' : 'Your name',
    yourNamePlaceholder: isAr ? 'الاسم اللي هيوصلك بيه الطلب' : 'The name deliveries should be addressed to',
    decline: isAr ? 'رفض الدعوة' : 'Decline',
    declined: isAr ? 'تم رفض الدعوة.' : 'Invitation declined.',
    expiresOn: (date) => isAr ? `الدعوة صالحة لحد ${date}` : `Valid until ${date}`,

    /* ---- The code step ---- */
    confirmNumberTitle: isAr ? 'أكّد رقمك' : 'Confirm your number',
    confirmNumberBody: (masked) => isAr
        ? `بعتنا كود من ٦ أرقام على واتساب ${masked}.`
        : `We sent a 6-digit code to WhatsApp ${masked}.`,
    whyCode: isAr
        ? 'بنتأكد إن الرقم رقمك فعلاً، لأن قبول الدعوة بيديك وصول لعناوين اللي دعاك.'
        : 'We check the number is really yours, because accepting gives you access to the addresses your inviter shared.',
    sendCode: isAr ? 'ابعتلي الكود' : 'Send me the code',
    resend: isAr ? 'إعادة إرسال الكود' : 'Resend the code',
    resendIn: (seconds) => isAr ? `تقدر تطلب كود جديد بعد ${seconds} ثانية` : `You can request a new code in ${seconds}s`,
    attemptsLeft: (n) => isAr
        ? `فاضل ${n} ${n === 1 ? 'محاولة' : 'محاولات'}`
        : `${n} attempt${n === 1 ? '' : 's'} left`,

    /* ---- Friends ---- */
    friendTitle: (name) => isAr ? `${name} عايز يضيفك كصديق` : `${name} wants to add you as a friend`,
    friendBody: isAr
        ? 'لما تقبلوا، كل واحد فيكم يقدر يطلب قطع غيار ويبعتها لعنوان التاني — وهو اللي بيدفع.'
        : 'Once you accept, each of you can order parts and have them delivered to the other — whoever orders pays.',
    friendShares: (n) => isAr
        ? `بيشارك معاك ${n} ${n === 1 ? 'عنوان' : 'عناوين'}`
        : `Sharing ${n} address${n === 1 ? '' : 'es'} with you`,
    friendAddressTitle: isAr ? 'عنوانك' : 'Your address',
    friendAddressWhy: isAr
        ? 'محتاجينه عشان صاحبك يقدر يبعتلك حاجة. تقدر تغيّره في أي وقت.'
        : 'Needed so your friend can send things to you. You can change it any time.',
    addressPlaceholder: isAr ? 'اسم الشارع، رقم العمارة، المنطقة...' : 'Street, building number, area…',
    acceptFriend: (name) => isAr ? `اقبل صداقة ${name}` : `Accept ${name}'s request`,
    friendJoined: (name) => isAr ? `بقيتوا أصحاب على ريدي مارين 🎉` : `You and ${name} are now connected 🎉`,
    friendJoinedBody: isAr
        ? 'تقدروا دلوقتي تشتروا قطع لبعض.'
        : 'You can now buy parts for each other.',

    /* ---- Family ---- */
    familyTitle: (name, relationship) => isAr
        ? `${name} ضامّك لعيلته كـ${relationship}`
        : `${name} is adding you to their family as their ${relationship}`,
    familyBody: isAr
        ? 'تختار اللي محتاجه وتبعتله الطلب، وهو اللي بيراجع ويدفع. مش هيتخصم منك أي حاجة.'
        : 'You pick what you need and send them the request; they review it and pay. Nothing is ever charged to you.',
    acceptFamily: (name) => isAr ? `انضم لعيلة ${name}` : `Join ${name}'s family`,
    familyJoined: (name) => isAr ? `انضممت لعيلة ${name} ✅` : `You joined ${name}'s family ✅`,
    familyJoinedBody: isAr
        ? 'تقدر تبعتله طلبات شراء من أي صفحة منتج.'
        : 'You can send them order requests from any product page.',

    /* ---- Errors ---- */
    expired: isAr
        ? 'الدعوة دي انتهت صلاحيتها. اطلب من اللي دعاك يبعت واحدة جديدة.'
        : 'This invitation has expired. Ask the person who invited you to send a new one.',
    alreadyAccepted: isAr ? 'الدعوة دي اتقبلت قبل كده.' : 'This invitation has already been accepted.',
    notFound: isAr ? 'اللينك ده مش صحيح.' : 'This invitation link is not valid.',
    closed: isAr ? 'الدعوة دي مابقتش متاحة.' : 'This invitation is no longer available.',
    alreadyInFamily: isAr
        ? 'حسابك منضم لعيلة تانية بالفعل. لازم تسيبها الأول.'
        : 'Your account already belongs to another family. Leave that one first.',
    nameRequired: isAr ? 'اكتب اسمك' : 'Please enter your name',
    addressRequired: isAr ? 'اكتب عنوانك' : 'Please enter your address',
    codeIncorrect: isAr ? 'الكود غلط. جرّب تاني.' : 'That code is not right. Try again.',
    codeExpired: isAr ? 'الكود انتهت صلاحيته. اطلب كود جديد.' : 'That code expired. Request a new one.',
    // Names the way out. A code that cannot be delivered is the one failure on
    // this page with no alternative path — the link alone deliberately cannot
    // accept — so the message has to hand the invitee something to do instead
    // of leaving them staring at six empty boxes.
    sendFailed: isAr
        ? 'تعذر إرسال الكود على الواتساب دلوقتي. جرّب تاني بعد شوية، أو اطلب من اللي دعاك يبعتلك الدعوة من جديد.'
        : 'We could not send the WhatsApp code right now. Try again shortly, or ask the person who invited you to send the invitation again.',
});

/**
 * Map a backend code to copy the invitee can act on. Returns null for anything
 * unrecognised so the caller falls back to the server's own message — a wrong
 * explanation is worse than a plain one.
 */
export const inviteErrorCopy = (code, isAr) => {
    const c = inviteCopy(isAr);
    switch (code) {
        case 'INVITATION_EXPIRED': return c.expired;
        case 'INVITATION_ALREADY_ACCEPTED': return c.alreadyAccepted;
        case 'INVITATION_NOT_FOUND': return c.notFound;
        case 'INVITATION_CLOSED': return c.closed;
        case 'ALREADY_IN_FAMILY': return c.alreadyInFamily;
        case 'NAME_REQUIRED': return c.nameRequired;
        case 'ADDRESS_REQUIRED': return c.addressRequired;
        case 'OTP_INCORRECT': return c.codeIncorrect;
        case 'OTP_EXPIRED':
        case 'OTP_NOT_FOUND': return c.codeExpired;
        case 'OTP_DELIVERY_FAILED': return c.sendFailed;
        default: return null;
    }
};
