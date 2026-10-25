/**
 * Friends feature copy (English / Arabic).
 *
 * Kept feature-scoped alongside `familyLocalization.js`. The two features are
 * deliberately distinct in language: Family speaks of an organizer approving a
 * request; Friends speaks of peers buying gifts for each other. Nothing here
 * implies one side outranks the other.
 */

/** Maps a backend error code to copy that names the next useful action. */
export const friendErrorCopy = (code, isAr, context = {}) => {
    const name = context.name || (isAr ? 'صديقك' : 'your friend');

    const messages = {
        INVALID_IDENTIFIER: isAr
            ? 'أدخل بريداً إلكترونياً صحيحاً أو رقم هاتف صحيح.'
            : 'Enter a valid email address or phone number.',
        CANNOT_INVITE_SELF: isAr
            ? 'لا يمكنك إرسال طلب صداقة إلى نفسك.'
            : 'You cannot send a friend request to yourself.',
        ALREADY_FRIENDS: isAr
            ? 'هذا الشخص موجود بالفعل في قائمة أصدقائك.'
            : 'This person is already in your friends list.',
        INCOMING_REQUEST_EXISTS: isAr
            ? 'أرسل لك هذا الشخص طلب صداقة بالفعل. اقبله من قائمة الطلبات الواردة أعلاه.'
            : 'This person already sent you a friend request. Accept it from Incoming requests above.',
        NO_SAVED_ADDRESS: isAr
            ? 'أضف عنوان توصيل إلى حسابك أولاً، ثم عد إلى هنا.'
            : 'Add a delivery address to your account first, then come back here.',
        SHARE_ADDRESS_REQUIRED: isAr
            ? 'اختر عنواناً واحداً على الأقل لمشاركته.'
            : 'Select at least one address to share.',
        ADDRESS_NOT_OWNED: isAr
            ? 'أحد العناوين المختارة لا يخصك.'
            : 'One of the selected addresses does not belong to you.',
        FRIEND_LIMIT_REACHED: isAr
            ? 'وصلت إلى الحد الأقصى لعدد الأصدقاء.'
            : 'You have reached the maximum number of friends.',
        INVITATION_EXPIRED: isAr
            ? 'انتهت صلاحية طلب الصداقة. اطلب من صاحبه إرساله من جديد.'
            : 'This friend request expired. Ask them to send it again.',
        INVITATION_NOT_PENDING: isAr
            ? 'تمت معالجة طلب الصداقة هذا بالفعل.'
            : 'This friend request has already been handled.',
        FRIENDSHIP_NOT_FOUND: isAr
            ? 'لم يعد بإمكانك الشراء لهذا الشخص.'
            : 'You can no longer buy for this person.',
        NO_SHARED_ADDRESS: isAr
            ? `اطلب من ${name} مشاركة عنوان توصيل معك أولاً.`
            : `Ask ${name} to share a delivery address with you first.`,
        ADDRESS_NOT_SHARED: isAr
            ? `لم يعد ${name} يشارك هذا العنوان معك. اختر عنواناً آخر.`
            : `${name} is no longer sharing that address with you. Pick another one.`,
        ADDRESS_UNAVAILABLE: isAr
            ? 'لم يعد هذا العنوان متاحاً. اختر عنواناً آخر.'
            : 'That address is no longer available. Pick another one.',
        FRIEND_ORDER_ONLINE_ONLY: isAr
            ? 'الطلبات المرسلة للأصدقاء تُدفع أونلاين فقط.'
            : 'Orders placed for a friend must be paid online.',
        SHIPPING_METHOD_INVALID: isAr
            ? 'اختر طريقة شحن متاحة.'
            : 'Please choose an available shipping method.',
        RATE_LIMITED: isAr
            ? 'محاولات كثيرة. حاول مرة أخرى بعد قليل.'
            : 'Too many attempts. Please try again shortly.',
    };

    return messages[code] || null;
};

/** All static Friends copy, resolved for one language. */
export const friendCopy = (isAr) => (isAr ? {
    friends: 'الأصدقاء',
    inviteFriend: 'دعوة صديق',
    friendRequest: 'طلب صداقة',
    buyForFriend: 'اشتري لصديق',
    buyForThisFriend: 'اشترِ لهذا الصديق',
    payer: 'الدافع',
    recipient: 'المستلم',
    sharedAddresses: 'العناوين المشتركة',
    onlinePaymentOnly: 'الدفع أونلاين فقط',

    incomingRequests: 'طلبات الصداقة الواردة',
    myFriends: 'أصدقائي',
    pendingInvitations: 'الدعوات المعلقة',
    ordersForMe: 'طلبات لي',

    emailOrPhone: 'رقم الموبايل أو البريد الإلكتروني',
    inviteNoAccountHint: 'مش لازم يكون عنده حساب — هيوصله لينك على الواتساب.',
    addressesToShare: 'العناوين التي تشاركها معه',
    manageMySharedAddresses: 'إدارة عناويني المشتركة',
    removeFriend: 'إزالة الصديق',
    block: 'حظر',
    accept: 'قبول',
    decline: 'رفض',
    cancel: 'إلغاء',
    save: 'حفظ',
    send: 'إرسال الدعوة',

    emptyFriends: 'ادعُ أصدقاءك حتى تتمكنوا من شراء قطع الغيار لبعضكم البعض. كل طرف يختار العناوين التي يشاركها.',
    noIncoming: 'لا توجد طلبات صداقة واردة.',
    noOrdersForMe: 'لم يشترِ لك أي صديق شيئاً بعد.',
    needAddressFirst: 'أضف عنوان توصيل إلى حسابك قبل دعوة الأصدقاء أو قبول طلباتهم.',

    genericInviteSent: 'إذا كان لهذا الشخص حساب في Ready Marine، فسيصله طلب الصداقة.',
    // A phone invitation always reaches the person — a WhatsApp link if they are
    // new, an in-app request if they already have an account — so it is reported
    // as sent. Which of the two carried it is deliberately NOT said: that would
    // tell the sender whether the number has an account here.
    inviteSentToNumber: 'تمام — الدعوة اتبعتت، وهيوصله لينك يقبل منه.',
    acceptPickAddresses: 'اختر العناوين التي تسمح لهذا الصديق باستخدامها عند الشراء لك.',
    invitePickAddresses: 'اختر العناوين التي تسمح لهذا الصديق باستخدامها عند الشراء لك.',
    sharingIsDirectional: 'المشاركة في اتجاه واحد: هذه عناوينك أنت. يختار صديقك عناوينه بشكل منفصل.',
    theyCanOnlySelect: 'يمكنه رؤية واختيار هذه العناوين فقط عند الشراء لك.',
    theyCannotEdit: 'لا يمكنه تعديل أو حذف عناوينك.',
    noPaymentShared: 'لن تتم مشاركة أي معلومات دفع.',

    sharedWithYou: 'يشاركك',
    youShare: 'تشاركه',
    addressCount: (n) => `${n} عنوان`,
    cannotBuyForThem: 'لم يشارك معك أي عنوان بعد',
    askToShare: (name) => `اطلب من ${name} مشاركة عنوان توصيل معك أولاً.`,

    whoIsThisFor: 'لمن هذا الطلب؟',
    myself: 'لنفسي',
    payOnlineFor: (name) => `ادفع أونلاين لصالح ${name}`,
    orderedFor: (name) => `تم الطلب لصالح ${name}`,
    paidByYou: 'بدفع منك',
    paidBy: (name) => `دفعها ${name}`,
    paidOnline: 'مدفوع أونلاين',
    deliveringTo: 'التوصيل إلى',
    friendOnlineOnlyNotice: 'الطلبات المرسلة للأصدقاء تُدفع أونلاين فقط. الدفع عند الاستلام غير متاح.',
    trackOnly: 'للعرض والتتبع فقط — يتولى الدافع الإرجاع والاسترداد والإلغاء.',
} : {
    friends: 'Friends',
    inviteFriend: 'Invite a friend',
    friendRequest: 'Friend request',
    buyForFriend: 'Buy for a friend',
    buyForThisFriend: 'Buy for this friend',
    payer: 'Paying customer',
    recipient: 'Recipient',
    sharedAddresses: 'Shared addresses',
    onlinePaymentOnly: 'Online payment only',

    incomingRequests: 'Incoming friend requests',
    myFriends: 'Friends',
    pendingInvitations: 'Pending invitations',
    ordersForMe: 'Orders for me',

    emailOrPhone: 'Mobile number or email',
    inviteNoAccountHint: 'They don\'t need an account — we\'ll send them a WhatsApp link.',
    addressesToShare: 'Addresses to share with them',
    manageMySharedAddresses: 'Manage my shared addresses',
    removeFriend: 'Remove friend',
    block: 'Block',
    accept: 'Accept',
    decline: 'Decline',
    cancel: 'Cancel',
    save: 'Save',
    send: 'Send invitation',

    emptyFriends: 'Invite your friends so you can buy parts for each other. Each of you chooses which addresses to share.',
    noIncoming: 'No incoming friend requests.',
    noOrdersForMe: 'No friend has bought anything for you yet.',
    needAddressFirst: 'Add a delivery address to your account before inviting friends or accepting their requests.',

    genericInviteSent: 'If this person has a Ready Marine account, they will receive your invitation.',
    inviteSentToNumber: 'Sent — they will get a link to accept.',
    acceptPickAddresses: 'Choose which of your addresses this friend may use when buying for you.',
    invitePickAddresses: 'Choose which of your addresses this friend may use when buying for you.',
    sharingIsDirectional: 'Sharing is one-way: these are your own addresses. Your friend chooses theirs separately.',
    theyCanOnlySelect: 'They can view and select only these addresses when buying for you.',
    theyCannotEdit: 'They cannot edit or delete your addresses.',
    noPaymentShared: 'No payment information is shared.',

    sharedWithYou: 'shares with you',
    youShare: 'you share',
    addressCount: (n) => `${n} address${n === 1 ? '' : 'es'}`,
    cannotBuyForThem: 'has not shared an address with you yet',
    askToShare: (name) => `Ask ${name} to share a delivery address with you first.`,

    whoIsThisFor: 'Who is this order for?',
    myself: 'Myself',
    payOnlineFor: (name) => `Pay online for ${name}`,
    orderedFor: (name) => `Ordered for ${name}`,
    paidByYou: 'Paid by you',
    paidBy: (name) => `Paid by ${name}`,
    paidOnline: 'Paid online',
    deliveringTo: 'Delivering to',
    friendOnlineOnlyNotice: 'Orders placed for a friend are online payment only. Cash on delivery is not available.',
    trackOnly: 'View and tracking only — the payer handles returns, refunds, and cancellation.',
});
