/**
 * Copy shared across the corporate-accounts screens (English / Arabic): the
 * company portal, the employee's "My company" tab, the invitation page and the
 * admin section. Page-specific sentences stay inline in their page.
 */
import { orgTerms, orgType } from './orgTerms';

/**
 * The kind of account the person is looking at (company, authority, school, property), so
 * the labels and error sentences below use its words. Set by whichever screen knows it —
 * the portal layout, the admin's account page, "My company", checkout, the invitation.
 */
let activeOrgType = 'company';
export const setActiveOrgType = (type) => { activeOrgType = orgType(type); };
const activeTerms = (isAr) => orgTerms(activeOrgType, isAr);

/** A wallet account — prepaid, or with a credit line under it — tops up and is never invoiced. */
export const hasWallet = (mode) => mode === 'wallet' || mode === 'credit_wallet';

export const formatMoney = (value, isAr) => {
    const n = Number(value || 0);
    const formatted = n.toLocaleString(isAr ? 'ar-EG' : 'en-US', { maximumFractionDigits: 2 });
    return isAr ? `${formatted} ج.م` : `EGP ${formatted}`;
};

export const formatDate = (value, isAr) => {
    if (!value) return '';
    return new Date(value).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

export const formatDateTime = (value, isAr) => {
    if (!value) return '';
    return new Date(value).toLocaleString(isAr ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

/** "YYYY-MM" → "September 2026" / "سبتمبر ٢٠٢٦" */
export const formatMonth = (key, isAr) => {
    if (!key) return '';
    const [y, m] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', { month: 'long', year: 'numeric' });
};

export const memberStatusLabel = (status, isAr) => ({
    joined: isAr ? 'منضم' : 'Joined',
    pending: isAr ? 'مستني يقبل' : 'Pending',
    expired: isAr ? 'الدعوة انتهت' : 'Expired',
    declined: isAr ? 'رفض' : 'Declined',
    deactivated: isAr ? 'موقوف' : 'Paused',
}[status] || status);

export const memberStatusClass = (status) => ({
    joined: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
    pending: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
    expired: 'bg-zinc-100 text-zinc-600 dark:bg-white/5 dark:text-zinc-400',
    declined: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
    deactivated: 'bg-zinc-200 text-zinc-700 dark:bg-white/10 dark:text-zinc-300',
}[status] || 'bg-zinc-100 text-zinc-600');

/** An invoice's state as the reader sees it (phase 4). "Overdue" is time, not a stored state. */
export const invoiceStatusLabel = (status, isAr) => ({
    issued: isAr ? 'صدرت' : 'Issued',
    partially_paid: isAr ? 'مدفوعة جزئياً' : 'Partly paid',
    paid: isAr ? 'مدفوعة' : 'Paid',
    overdue: isAr ? 'متأخرة' : 'Overdue',
    collecting: isAr ? 'بتتجمّع' : 'Collecting',
    just_ended: isAr ? 'هتصدر قريب' : 'Issuing soon',
    card_payment_pending: isAr ? 'هتصدر قريب' : 'Issuing soon',
    issuing: isAr ? 'هتصدر قريب' : 'Issuing soon',
}[status] || status);

export const invoiceStatusClass = (status) => ({
    issued: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
    partially_paid: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
    paid: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
    overdue: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
}[status] || 'bg-zinc-100 text-zinc-600 dark:bg-white/5 dark:text-zinc-300');

export const paymentStatusLabel = (status, isAr) => ({
    pending: isAr ? 'مستني تأكيد Ready Marine' : 'Waiting for Ready Marine',
    confirmed: isAr ? 'اتأكد' : 'Confirmed',
    rejected: isAr ? 'اترفض' : 'Rejected',
}[status] || status);

export const paymentStatusClass = (status) => ({
    pending: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
    confirmed: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
    rejected: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
}[status] || 'bg-zinc-100 text-zinc-600');

/** An employee's limit for display: null means the company has switched employee limits off. */
export const formatLimit = (limit, isAr) => (limit === null || limit === undefined
    ? (isAr ? 'من غير ليميت' : 'No limit')
    : formatMoney(limit, isAr));

export const limitSourceLabel = (source, isAr) => ({
    none: isAr ? 'حد الشركة بس' : "Company's cap only",
    override: isAr ? 'ليميت خاص' : 'Personal limit',
    group: isAr ? 'ليميت الجروب' : 'Group limit',
    default: isAr ? 'الليميت الافتراضي' : 'Default limit',
}[source] || '');

export const importStatusLabel = (status, isAr) => {
    const ot = activeTerms(isAr);
    return ({
    valid: isAr ? 'سليم' : 'Valid',
    make_employee: isAr ? 'مدير هنا — هياخد ليميت' : 'A manager here — gets a limit',
    invalid_contact: isAr ? 'إيميل أو موبايل غلط' : 'Invalid email or mobile',
    duplicate: isAr ? 'متكرر في الملف' : 'Duplicate in file',
    already_member: isAr ? `${ot.member} بالفعل` : `Already ${ot.aMember}`,
    pending_invite: isAr ? 'عنده دعوة مستنية' : 'Invitation already waiting',
    other_company: isAr ? `في ${ot.one} ${ot.v('تانية', 'تاني')}` : `In another ${ot.one}`,
    unknown_group: isAr ? 'الجروب مش موجود' : 'Group not found',
    unknown_office: isAr ? `${ot.theBranch} مش موجود` : `${ot.Branch} not found`,
}[status] || status);
};

/**
 * Backend error code → a sentence the person can act on. Null for anything
 * unrecognised, so the caller falls back to the server's own message.
 */
export const companyErrorCopy = (code, isAr) => {
    const ot = activeTerms(isAr);
    return ({
    INVALID_IDENTIFIER: isAr ? 'اكتب إيميل صحيح أو رقم موبايل مصري.' : 'Enter a valid email or Egyptian mobile number.',
    ALREADY_MEMBER: isAr ? `الشخص ده ${ot.member} في ${ot.the} بالفعل.` : `This person is already ${ot.aMember}.`,
    ALREADY_MANAGER: isAr ? 'الشخص ده مدير للحساب بالفعل.' : `This person already manages the ${ot.one}.`,
    INVITATION_EXISTS: isAr ? 'فيه دعوة مستنية للشخص ده. ابعتها تاني بدل ما تعمل واحدة جديدة.' : 'An invitation is already waiting for this person. Resend it instead.',
    INVITE_DELIVERY_UNAVAILABLE: isAr ? 'دعوات الواتساب مش متاحة دلوقتي. جرّب بعد شوية أو استخدم الإيميل.' : 'WhatsApp invitations are unavailable right now. Try later or use an email.',
    LAST_MANAGER: isAr ? 'لازم يفضل مدير واحد على الأقل للحساب.' : `The ${ot.one} needs at least one manager.`,
    MANAGER_NOT_FOUND: isAr ? 'المدير ده مش موجود. حدّث الصفحة.' : 'This manager was not found. Refresh the page.',
    MANAGER_EMAIL_INVALID: isAr ? 'اكتب إيميل صحيح.' : 'Enter a valid email address.',
    MANAGER_EMAIL_TAKEN: isAr ? 'الإيميل ده مستخدم في حساب تاني.' : 'Another account already uses this email.',
    MANAGER_PHONE_INVALID: isAr ? 'اكتب رقم موبايل مصري صحيح.' : 'Enter a valid Egyptian mobile number.',
    MANAGER_PHONE_TAKEN: isAr ? 'رقم الموبايل ده مستخدم في حساب تاني.' : 'Another account already uses this mobile number.',
    LAST_OFFICE: isAr ? `لازم يفضل ${ot.branch} واحد على الأقل.` : `The ${ot.one} needs at least one ${ot.branch}.`,
    ONE_MODE_REQUIRED: isAr ? 'لازم مود توصيل واحد على الأقل يفضل شغال.' : 'Keep at least one delivery mode on.',
    GROUP_NAME_TAKEN: isAr ? 'فيه جروب بنفس الاسم.' : 'A group with this name already exists.',
    CAR_PLATE_TAKEN: isAr ? 'فيه عربية متسجلة بنفس رقم اللوحة.' : 'A car with this plate is already registered.',
    COMPANY_ENDED: isAr ? `العقد مع ${ot.the} ${ot.v('دي', 'ده')} انتهى.` : `This ${ot.one} contract has ended.`,
    COMPANY_HAS_HISTORY: isAr ? 'الحساب ده عليه أوردرات أو مدفوعات فمينفعش يتحذف. اقفله بـ"إنهاء التعاقد" من صفحة الحساب.' : 'This account has orders or payments on it and cannot be deleted. End its contract from the account page instead.',
    COMPANY_UNAVAILABLE: isAr ? `حساب ${ot.the} ده مابقاش متاح.` : `This ${ot.one} account is no longer available.`,
    CONTRACT_NOT_ENDED: isAr ? `التحويل ${ot.toThe} بيتسجل بعد إنهاء التعاقد بس.` : 'Refunds are recorded only after the contract has ended.',
    REFUND_TOO_LARGE: isAr ? `المبلغ أكبر من المستحق ${ot.toThe}.` : `The amount is more than what is owed to the ${ot.one}.`,
    CAR_MAKE_REQUIRED: isAr ? 'اختار الماركة والموديل من القايمة.' : 'Choose the make and model from the list.',
    CAR_YEAR_INVALID: isAr ? 'اختار سنة الصنع.' : 'Choose the model year.',
    CAR_PLATE_REQUIRED: isAr ? 'اكتب رقم اللوحة.' : 'Enter the plate number.',
    OFFICE_PHONE_INVALID: isAr ? `اكتب رقم موبايل صحيح ${ot.toTheBranch}.` : `Enter a valid mobile number for the ${ot.branch}.`,
    NOT_COMPANY_MANAGER: isAr ? `حسابك مش مدير لأي ${ot.one}.` : `Your account does not manage ${ot.aOne}.`,
    ALREADY_IN_COMPANY: isAr ? `حسابك تابع لحساب ${ot.one} ${ot.v('تانية', 'تاني')}. لازم تسيبه الأول من تاب "${ot.mine}".` : `Your account belongs to another ${ot.one}. Leave it first from the "${ot.mine}" tab.`,
    EMAIL_MISMATCH: isAr ? 'الدعوة دي متبعوتة لإيميل تاني.' : 'This invitation was sent to another email address.',
    ACCOUNT_MISMATCH: isAr ? 'الدعوة دي متبعوتة لرقم تاني.' : 'This invitation was sent to another number.',
    INVITATION_EXPIRED: isAr ? `الدعوة دي انتهت. اطلب من ${ot.the} ${ot.v('تبعت', 'يبعت')} واحدة جديدة.` : `This invitation has expired. Ask the ${ot.one} to send a new one.`,
    INVITATION_REVOKED: isAr ? `${ot.the} ${ot.v('لغت', 'لغى')} الدعوة دي.` : `The ${ot.one} cancelled this invitation.`,
    INVITATION_ALREADY_ACCEPTED: isAr ? 'الدعوة دي اتقبلت قبل كده.' : 'This invitation has already been accepted.',
    INVITATION_DECLINED: isAr ? 'الدعوة دي اترفضت قبل كده.' : 'This invitation was already declined.',
    INVITATION_NOT_FOUND: isAr ? 'اللينك ده مش صحيح.' : 'This invitation link is not valid.',
    COMPANY_UNAVAILABLE: isAr ? `حساب ${ot.the} ده مبقاش متاح.` : `This ${ot.one} account is no longer available.`,
    // ---- Ordering on the company account ----
    LIMIT_USED_UP: isAr ? 'الليميت بتاعك خلص الشهر ده.' : 'Your limit for this month is used up.',
    LIMIT_NOT_ENOUGH: isAr ? 'الأوردر أكبر من اللي فاضل في الليميت — اطلبه بطريقة دفع تانية من حسابك.' : 'The order is more than what is left on your limit — pay another way from your own account.',
    EMPLOYEE_DEACTIVATED: isAr ? `مدير حساب ${ot.the} وقّف طلبك على ${ot.v('حسابها', 'حسابه')}.` : `Your ${ot.one}'s manager has paused your ordering on its account.`,
    COMPANY_WALLET_INSUFFICIENT: isAr ? `رصيد محفظة ${ot.the} مش كافي لتغطية الأوردر بالكامل. اشحن المحفظة الأول.` : `The ${ot.one} wallet must cover the entire order. Top up first.`,
    COMPANY_ALLOCATION_EXCEEDED: isAr ? `حدود ${ot.members} المتبقية والدعوات أكبر من رصيد المحفظة. قلّل الحدود أو اشحن المحفظة.` : `Remaining ${ot.member} and invitation limits exceed the wallet balance. Reduce limits or top up.`,
    COMPANY_WALLET_BUSY: isAr ? `في عملية على محفظة ${ot.the} دلوقتي، حاول تاني بعد لحظة.` : `Another ${ot.one} wallet operation is in progress. Please retry.`,
    LOGO_REQUIRED: isAr ? 'اختار صورة اللوجو.' : 'Choose an image for the logo.',
    LOGO_TOO_LARGE: isAr ? 'اللوجو أكبر من 2 ميجا.' : 'The logo is larger than 2 MB.',
    LOGO_TYPE: isAr ? 'ارفع اللوجو صورة PNG أو JPG أو WebP.' : 'Upload the logo as a PNG, JPG or WebP image.',
    INVALID_BILLING_MODE: isAr ? 'اختار طريقة الحساب: فاتورة شهرية، محفظة مسبقة الدفع، أو محفظة بحد ائتماني.' : 'Choose monthly invoice, prepaid wallet or wallet with a credit limit.',
    COMPANY_NOT_WALLET: isAr ? `${ot.the} ${ot.v('دي', 'ده')} ${ot.v('بتتحاسب', 'بيتحاسب')} بفاتورة شهرية.` : `This ${ot.one} uses monthly invoices.`,
    COMPANY_CAP_REACHED: isAr ? `سقف ${ot.the} الشهري مايكفيش الأوردر ده.` : `The ${ot.one}'s monthly cap does not cover this order.`,
    COMPANY_LIMIT_CHANGED: isAr ? 'الليميت المتبقي اتغير. راجع الأوردر تاني — حدّثنا الأرقام.' : 'Your remaining limit changed. Review the order again — the figures are updated.',
    PRICE_CHANGED: isAr ? 'إجمالي الأوردر اتغير وإنت بتطلب. راجع الأرقام الجديدة واطلب تاني.' : 'The order total changed while you were checking out. Review the new figures and try again.',
    PERSONAL_PAYMENT_REQUIRED: isAr ? 'الأوردر أكبر من الليميت — اختار تدفع الفرق إزاي.' : 'The order is over your limit — choose how to pay the difference.',
    COMPANY_SUSPENDED: isAr ? `الطلب على حساب ${ot.the} موقوف مؤقتاً.` : `Ordering on the ${ot.one} account is temporarily paused.`,
    INSTANT_MODE_OFF: isAr ? `${ot.your} ${ot.v('مفعّلة', 'مفعّل')} التجميع على ${ot.theBranch} بس.` : `Your ${ot.one} allows only consolidated delivery to the ${ot.branch}.`,
    CONSOLIDATE_MODE_OFF: isAr ? `${ot.your} مش ${ot.v('مفعّلة', 'مفعّل')} التجميع على ${ot.theBranch} — اختار فوري.` : `Your ${ot.one} does not consolidate to the ${ot.branch} — choose instant.`,
    OFFICE_REQUIRED: isAr ? `اختار ${ot.theBranch} اللي هيوصل عليه الأوردر.` : `Choose the ${ot.branch} to deliver to.`,
    BATCH_CLOSING: isAr ? 'الدفعة بتتقفل دلوقتي — جرّب تاني بعد دقيقة.' : 'The batch is closing right now — try again in a minute.',
    NOT_WAITING: isAr ? 'الأوردر ده مابقاش مستني في الدفعة.' : 'This order is no longer waiting in a batch.',
    OFFICE_HAS_WAITING_ORDERS: isAr ? `فيه أوردرات مستنية تتجمّع على ${ot.theBranch} ده — تقدر تمسحه بعد ما تتشحن.` : `Orders are waiting to be consolidated to this ${ot.branch} — remove it once they have shipped.`,
    BATCH_NOT_OPEN: isAr ? 'الدفعة دي مابقتش مستنية.' : 'This batch is not waiting any more.',
    INVOICE_NOT_FOUND: isAr ? 'الفاتورة مش موجودة.' : 'Invoice not found.',
    INVOICE_PAID: isAr ? 'الفاتورة دي اتدفعت بالكامل.' : 'This invoice is already paid.',
    PAYMENT_TOO_LARGE: isAr ? 'المبلغ أكبر من المتبقي على الفاتورة.' : 'The amount is more than what is left on the invoice.',
    INVALID_AMOUNT: isAr ? 'اكتب المبلغ اللي اتحوّل.' : 'Enter the amount transferred.',
    INVALID_DATE: isAr ? 'اكتب تاريخ التحويل (مش في المستقبل).' : 'Enter the transfer date (not in the future).',
    RECEIPT_REQUIRED: isAr ? 'ارفع صورة إيصال التحويل.' : 'Attach the transfer receipt.',
    RECEIPT_TYPE: isAr ? 'الإيصال لازم يكون صورة (JPG / PNG / WEBP) أو PDF.' : 'The receipt must be an image (JPG / PNG / WEBP) or a PDF.',
    RECEIPT_TOO_LARGE: isAr ? 'الملف أكبر من 8 ميجا.' : 'The file is larger than 8 MB.',
    PAYMENT_NOT_PENDING: isAr ? 'الدفعة دي اتعاملت معاها قبل كده.' : 'This payment was already handled.',
    REASON_REQUIRED: isAr ? `اكتب السبب — ${ot.the} ${ot.v('هتشوفه', 'هيشوفه')}.` : `Give a reason — the ${ot.one} will read it.`,
    CAR_REQUIRED: isAr ? `اختار عربية ${ot.the}.` : `Choose the ${ot.one} car.`,
    CAR_NOT_FOUND: isAr ? 'العربية دي مش موجودة.' : 'That car does not exist.',
    NOT_EMPLOYEE: isAr ? `مالكش ليميت على حساب ${ot.the}.` : `You have no limit on the ${ot.one} account.`,
    NOTHING_TO_SETTLE: isAr ? `${ot.the} مش ${ot.v('عليها', 'عليه')} حاجة في الأوردر ده.` : `The ${ot.one} has nothing left to pay on this order.`,
    ORDER_NOT_PAID: isAr ? 'الأوردر لسه مستني الدفع يكمل.' : 'This order is still waiting for its payment to complete.',
    NOT_YOUR_COMPANY_ORDER: isAr ? 'اللي طلب الأوردر بس هو اللي يقدر يدفعه.' : 'Only the person who placed this order can pay it.',
    INSUFFICIENT_BALANCE: isAr ? 'رصيد محفظتك مش كفاية.' : 'Your wallet balance is not enough.',
}[code] || null);
};

export const errorText = (err, isAr) => companyErrorCopy(err?.code, isAr) || err?.message || (isAr ? 'حصلت مشكلة' : 'Something went wrong');
