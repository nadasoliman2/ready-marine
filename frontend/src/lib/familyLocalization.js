/**
 * Family feature copy and label helpers (English / Arabic).
 *
 * Kept out of the global `translations` map — like `orderStatus.js` — because
 * this copy is feature-scoped and needs helper functions (status → label +
 * tone + icon key) rather than flat strings.
 *
 * Terminology note: the UI says "Family Organizer" (مسؤول العائلة), never
 * "Head of Family". Relationship labels are descriptive only and never imply
 * permissions.
 */

export const RELATIONSHIPS = ['son', 'daughter', 'husband', 'wife', 'parent', 'sibling', 'other'];

const RELATIONSHIP_LABELS = {
    son: { en: 'Son', ar: 'ابن' },
    daughter: { en: 'Daughter', ar: 'ابنة' },
    husband: { en: 'Husband', ar: 'زوج' },
    wife: { en: 'Wife', ar: 'زوجة' },
    parent: { en: 'Parent', ar: 'والد / والدة' },
    sibling: { en: 'Sibling', ar: 'أخ / أخت' },
    other: { en: 'Other', ar: 'آخر' },
};

export const getRelationshipLabel = (relationship, isAr) =>
    (RELATIONSHIP_LABELS[relationship] || RELATIONSHIP_LABELS.other)[isAr ? 'ar' : 'en'];

/**
 * Request statuses. Every label names the ACTOR so family approval is never
 * confused with the separate vendor review that happens after the real order
 * is placed — "Waiting for approval" on its own is never shown.
 */
const REQUEST_STATUS = {
    pending_approval: {
        en: 'Waiting for approval', ar: 'بانتظار الموافقة',
        icon: 'clock', tone: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
    },
    approved_payment_needed: {
        en: 'Approved — payment needed', ar: 'تمت الموافقة — بانتظار الدفع',
        icon: 'card', tone: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    },
    payment_in_progress: {
        en: 'Payment in progress', ar: 'جاري الدفع',
        icon: 'spinner', tone: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
    },
    order_placed: {
        en: 'Order placed', ar: 'تم تنفيذ الطلب',
        icon: 'check', tone: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    },
    declined: {
        en: 'Declined', ar: 'مرفوض',
        icon: 'x', tone: 'bg-red-500/15 text-red-400 border-red-500/30',
    },
    withdrawn: {
        en: 'Withdrawn', ar: 'تم السحب',
        icon: 'archive', tone: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
    },
    expired: {
        en: 'Expired', ar: 'منتهي الصلاحية',
        icon: 'archive', tone: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
    },
};

export const getRequestStatusLabel = (status, isAr) =>
    (REQUEST_STATUS[status] || REQUEST_STATUS.pending_approval)[isAr ? 'ar' : 'en'];

export const getRequestStatusTone = (status) =>
    (REQUEST_STATUS[status] || REQUEST_STATUS.pending_approval).tone;

export const getRequestStatusIcon = (status) =>
    (REQUEST_STATUS[status] || REQUEST_STATUS.pending_approval).icon;

/**
 * Status line naming the actor, used on the request detail header. `who` is the
 * organizer's name; falls back to a neutral phrase when it is unknown.
 */
export const getActorStatusLine = (status, who, isAr) => {
    const name = who || (isAr ? 'مسؤول العائلة' : 'your organizer');
    switch (status) {
        case 'pending_approval':
            return isAr ? `بانتظار موافقة ${name}` : `Waiting for ${name}'s approval`;
        case 'approved_payment_needed':
            return isAr ? `وافق ${name} — بانتظار الدفع` : `Approved by ${name} — payment needed`;
        case 'payment_in_progress':
            return isAr ? `${name} يقوم بإتمام الدفع` : `${name} is completing payment`;
        case 'order_placed':
            return isAr ? 'تم تنفيذ الطلب — بانتظار مراجعة التاجر' : 'Order placed — awaiting vendor review';
        case 'declined':
            return isAr ? `رفض ${name} هذا الطلب` : `${name} declined this request`;
        case 'withdrawn':
            return isAr ? 'تم سحب الطلب' : 'Request withdrawn';
        case 'expired':
            return isAr ? 'انتهت صلاحية الطلب قبل الدفع' : 'Request expired before payment';
        default:
            return '';
    }
};

export const DECLINE_REASONS = [
    { value: 'too_expensive', en: 'Too expensive', ar: 'السعر مرتفع' },
    { value: 'wrong_products', en: 'Wrong products', ar: 'منتجات غير صحيحة' },
    { value: 'wrong_address', en: 'Wrong address', ar: 'عنوان غير صحيح' },
    { value: 'order_later', en: 'I will order later', ar: 'سأطلبها لاحقاً' },
    { value: 'other', en: 'Other', ar: 'سبب آخر' },
];

/** Human wording for a detected change between request time and now. */
export const getChangeLabel = (change, isAr) => {
    switch (change.type) {
        case 'item_unavailable':
            return isAr ? `${change.title}: لم يعد متاحاً` : `${change.title}: no longer available`;
        case 'price_changed':
            return isAr ? `${change.title}: تغيّر السعر` : `${change.title}: price changed`;
        case 'coupon_invalid':
            return isAr ? `الكوبون ${change.requested} لم يعد صالحاً` : `Coupon ${change.requested} is no longer valid`;
        case 'shipping_unavailable':
            return isAr ? 'لا توجد طريقة شحن متاحة لهذه الوجهة' : 'No shipping method is available for this destination';
        case 'shipping_method_changed':
            return isAr ? 'تغيّرت طريقة الشحن' : 'Shipping method changed';
        case 'shipping_cost_changed':
            return isAr ? 'تغيّرت تكلفة الشحن' : 'Shipping cost changed';
        case 'total_changed':
            return isAr ? 'تغيّر الإجمالي' : 'Total changed';
        default:
            return change.type;
    }
};

/** All static family copy, resolved for one language. */
export const familyCopy = (isAr) => (isAr ? {
    family: 'العائلة',
    organizer: 'مسؤول العائلة',
    member: 'فرد العائلة',
    orderRequest: 'طلب شراء',
    requestsNeedingAttention: 'طلبات تحتاج إلى مراجعتك',
    sendForApproval: 'إرسال للموافقة',
    approveAndPay: 'الموافقة والمتابعة للدفع',
    declineRequest: 'رفض الطلب',
    sharedAddresses: 'العناوين المشتركة',
    familyMembers: 'أفراد العائلة',
    pendingInvitations: 'الدعوات المعلقة',
    familySettings: 'إعدادات العائلة',
    inviteMember: 'دعوة فرد من العائلة',
    emailOrPhone: 'رقم الموبايل أو البريد الإلكتروني',
    // Stated at the point of entry, because an organizer who does not know this
    // will keep hunting for an email address a parent may not have.
    inviteNoAccountHint: 'مش لازم يكون عنده حساب — هيوصله لينك على الواتساب.',
    sendInvitation: 'إرسال الدعوة',
    relationshipQuestion: 'ما صلة هذا الشخص بك؟',
    emailAddress: 'البريد الإلكتروني',
    addressesToShare: 'العناوين التي تريد مشاركتها',
    emptyStateBody: 'ادعُ أفراد عائلتك الموثوقين ليتمكنوا من تجهيز الطلبات نيابة عنك. أنت تراجع كل طلب وتختار طريقة الدفع.',
    privacyTitle: 'ماذا تتم مشاركته؟',
    privacyCanView: 'يمكن للفرد رؤية واختيار العناوين المشتركة فقط.',
    privacyCannotEdit: 'لا يمكنه تعديل أو حذف عناوينك.',
    privacyNoPayment: 'لن تتم مشاركة أي معلومات دفع.',
    invitationSent: 'تم إرسال الدعوة. سنخبرك عند انضمامهم.',
    resend: 'إعادة الإرسال',
    cancelInvitation: 'إلغاء الدعوة',
    sentOn: 'تاريخ الإرسال',
    expiresOn: 'تنتهي في',
    noPendingRequests: 'لا توجد طلبات بانتظار موافقتك.',
    noSharedAddressesMember: 'لم يشارك مسؤول العائلة أي عنوان توصيل معك بعد.',
    leaveFamily: 'مغادرة العائلة',
    removeMember: 'إزالة الفرد',
    manageSharedAddresses: 'إدارة العناوين المشتركة',
    save: 'حفظ',
    cancel: 'إلغاء',
    whoIsThisFor: 'لمن هذا الطلب؟',
    myself: 'لنفسي',
    estimatedTotal: 'الإجمالي التقديري',
    noPaymentNow: 'لن يتم خصم أي مبلغ الآن. سيتم التحقق من الأسعار والتوفر والخصومات والشحن مرة أخرى قبل الدفع.',
    optionalNote: 'ملاحظة اختيارية',
    myFamilyRequests: 'طلبات عائلتي',
    viewRequest: 'عرض الطلب',
    continueShopping: 'متابعة التسوق',
    withdraw: 'سحب الطلب',
    requestedBy: 'مقدَّم من',
    submittedOn: 'تاريخ الإرسال',
    requested: 'المطلوب',
    current: 'الحالي',
    changesTitle: 'تغييرات منذ إرسال الطلب',
    acknowledgeChanges: 'أقر بالاطلاع على هذه التغييرات',
    placeOrderCod: 'تأكيد الطلب مع الدفع عند الاستلام',
    paySecurely: 'ادفع الآن بأمان',
    resumePayment: 'متابعة الدفع',
    orderedFor: 'تم الطلب لصالح',
    requestedByYou: 'بطلب منك',
    trackOrder: 'تتبع الطلب',
} : {
    family: 'Family',
    organizer: 'Family Organizer',
    member: 'Family Member',
    orderRequest: 'Order Request',
    requestsNeedingAttention: 'Requests needing attention',
    sendForApproval: 'Send for approval',
    approveAndPay: 'Approve and continue to payment',
    declineRequest: 'Decline request',
    sharedAddresses: 'Shared addresses',
    familyMembers: 'Family members',
    pendingInvitations: 'Pending invitations',
    familySettings: 'Family settings',
    inviteMember: 'Invite family member',
    emailOrPhone: 'Mobile number or email',
    inviteNoAccountHint: 'They don\'t need an account — we\'ll send them a WhatsApp link.',
    sendInvitation: 'Send invitation',
    relationshipQuestion: "What is this person's relationship to you?",
    emailAddress: 'Email address',
    addressesToShare: 'Addresses to share',
    emptyStateBody: 'Invite trusted family members so they can prepare orders for you. You review every request and choose how to pay.',
    privacyTitle: 'What gets shared?',
    privacyCanView: 'They can view and select only the addresses you share.',
    privacyCannotEdit: 'They cannot edit or delete your addresses.',
    privacyNoPayment: 'No payment method will be shared.',
    invitationSent: 'Invitation sent. We will let you know when they join.',
    resend: 'Resend',
    cancelInvitation: 'Cancel invitation',
    sentOn: 'Sent',
    expiresOn: 'Expires',
    noPendingRequests: 'You have no requests waiting for approval.',
    noSharedAddressesMember: 'Your organizer has not shared a delivery address with you yet.',
    leaveFamily: 'Leave family',
    removeMember: 'Remove member',
    manageSharedAddresses: 'Manage shared addresses',
    save: 'Save',
    cancel: 'Cancel',
    whoIsThisFor: 'Who is this order for?',
    myself: 'Myself',
    estimatedTotal: 'Estimated total',
    noPaymentNow: 'No payment will be taken now. Prices, availability, discounts, and shipping will be checked again before payment.',
    optionalNote: 'Optional note',
    myFamilyRequests: 'My family requests',
    viewRequest: 'View request',
    continueShopping: 'Continue shopping',
    withdraw: 'Withdraw request',
    requestedBy: 'Requested by',
    submittedOn: 'Submitted',
    requested: 'Requested',
    current: 'Current',
    changesTitle: 'Changes since this request was sent',
    acknowledgeChanges: 'I have reviewed these changes',
    placeOrderCod: 'Place order with cash on delivery',
    paySecurely: 'Pay securely now',
    resumePayment: 'Resume payment',
    orderedFor: 'Ordered for',
    requestedByYou: 'Requested by you',
    trackOrder: 'Track order',
});
