/**
 * Wallet copy (English / Arabic).
 *
 * Kept feature-scoped alongside `loyaltyLocalization.js`. What this copy is
 * careful about:
 *
 *  - Wallet credit is the customer's MONEY, not a reward. It is never called
 *    points, and it is never described in language that implies the store is
 *    being generous — a refund landing here is the customer getting back what
 *    was already theirs.
 *  - The store-credit limitation is stated plainly, up front, wherever a
 *    balance is shown. A customer who discovers only at the point of asking
 *    that credit cannot be withdrawn has been misled by omission.
 *  - A shortfall is always phrased as an amount to add, never as a refusal.
 *    "You need 45.00 more" is actionable; "insufficient balance" is a wall.
 */

export const walletCopy = (isAr) => ({
    myWallet: isAr ? 'محفظتي' : 'My Wallet',
    balance: isAr ? 'الرصيد المتاح' : 'Available balance',
    balanceHint: isAr
        ? 'جاهز للاستخدام في أي طلب على ريدي مارين.'
        : 'Ready to use on any Ready Marine order.',
    reserved: isAr ? 'محجوز' : 'On hold',
    reservedHint: isAr
        ? 'محجوز مؤقتاً لعملية شراء جارية. يعود إليك تلقائياً إذا لم تكتمل.'
        : 'Held for a purchase in progress. It comes back automatically if it does not complete.',

    // ---- Top-up ----
    topUp: isAr ? 'شحن المحفظة' : 'Top up',
    topUpTitle: isAr ? 'اشحن محفظتك' : 'Top up your wallet',
    topUpAmount: isAr ? 'المبلغ' : 'Amount',
    topUpCustom: isAr ? 'أو اكتب المبلغ الذي تريده' : 'Or enter your own amount',
    topUpAction: isAr ? 'متابعة الدفع' : 'Continue to payment',
    topUpNote: isAr
        ? 'سيتم تحويلك إلى بوابة الدفع الآمنة، ثم يُضاف الرصيد إلى محفظتك فوراً.'
        : 'You will be taken to the secure payment gateway, then the credit is added to your wallet right away.',
    topUpSuccess: (amount, currency) => isAr
        ? `تم إضافة ${currency} ${amount} إلى محفظتك.`
        : `${currency} ${amount} was added to your wallet.`,
    topUpPending: isAr
        ? 'لم يتم تأكيد الدفع بعد. إذا تم خصم المبلغ فسيصل إلى محفظتك خلال لحظات.'
        : 'The payment is not confirmed yet. If you were charged, it will reach your wallet shortly.',
    topUpFailed: isAr
        ? 'لم تكتمل عملية الشحن ولم يتم خصم أي مبلغ.'
        : 'The top-up did not complete and nothing was charged.',
    amountRequired: isAr ? 'أدخل مبلغاً أكبر من صفر.' : 'Enter an amount greater than zero.',

    // ---- Checkout ----
    payWithWallet: isAr ? 'الدفع من المحفظة' : 'Pay from wallet',
    payWithWalletDesc: (balance, currency) => isAr
        ? `رصيدك الحالي: ${currency} ${balance}`
        : `Your balance: ${currency} ${balance}`,
    // Deliberately framed as a gap to close, not as a rejection.
    shortfall: (amount, currency) => isAr
        ? `تحتاج ${currency} ${amount} إضافية لإتمام هذا الطلب.`
        : `You need ${currency} ${amount} more to complete this order.`,
    topUpShortfall: (amount, currency) => isAr
        ? `اشحن ${currency} ${amount} الآن`
        : `Top up ${currency} ${amount} now`,
    topUpOther: isAr ? 'اشحن مبلغاً آخر' : 'Top up a different amount',
    afterTopUpNote: isAr
        ? 'ستعود إلى هذه الصفحة بعد الدفع وسلتك كما هي.'
        : 'You will come back to this page after paying, with your basket as it is.',
    walletCovers: isAr ? 'سيتم خصم كامل المبلغ من محفظتك.' : 'The full amount will be taken from your wallet.',
    // The way out of a shortfall that is not "go and top up first". Deliberately
    // the quietest button in the panel: topping up stays the main road.
    payOnlineInstead: isAr ? 'أو ادفع أونلاين' : 'Or pay online',
    payOnline: isAr ? 'الدفع الإلكتروني' : 'Online payment',
    payOnlineDesc: isAr
        ? 'ادفع الآن عبر بوابة الدفع الآمنة.'
        : 'Pay now through the secure payment gateway.',
    // Truthful about a destination the admin decides per refund: it promises a
    // review, not a route.
    refundNote: isAr
        ? 'المرتجعات تتم مراجعتها وبترجع لرصيدك أو لطريقة دفعك.'
        : 'Refunds are reviewed and returned to your balance or to the way you paid.',
    onlinePaymentDisabled: isAr
        ? 'الدفع الإلكتروني غير متاح حالياً. اختر طريقة دفع أخرى.'
        : 'Online payment is unavailable right now. Please choose another payment method.',
    // ---- Family approval ----
    approveAndPayWallet: isAr ? 'وافق وادفع من المحفظة' : 'Approve and pay from wallet',
    approveAndPayOnline: isAr ? 'وافق وادفع أونلاين' : 'Approve and pay online',
    balanceAfter: (amount, currency) => isAr
        ? `الرصيد بعد الطلب: ${currency} ${amount}`
        : `Balance after this order: ${currency} ${amount}`,

    // ---- Status ----
    frozen: isAr ? 'المحفظة موقوفة مؤقتاً' : 'Wallet on hold',
    frozenHint: isAr
        ? 'رصيدك في أمان، لكن لا يمكن استخدامه حالياً. يرجى التواصل مع الدعم.'
        : 'Your balance is safe but cannot be used right now. Please contact support.',
    walletDisabled: isAr
        ? 'الدفع بالمحفظة غير متاح حالياً.'
        : 'Wallet payment is currently unavailable.',

    // ---- Rules ----
    howItWorks: isAr ? 'كيف تعمل المحفظة' : 'How the wallet works',
    ruleTopUp: isAr
        ? 'اشحن محفظتك عبر بوابة الدفع، ثم ادفع من رصيدك بضغطة واحدة.'
        : 'Top up through the payment gateway, then pay for orders in one tap.',
    ruleRefunds: isAr
        ? 'أي مبلغ مسترد إلى محفظتك يصلك فوراً وجاهز للاستخدام.'
        : 'Any money returned to your wallet arrives instantly, ready to use.',
    ruleNoExpiry: isAr
        ? 'رصيد المحفظة لا تنتهي صلاحيته.'
        : 'Wallet credit never expires.',
    // Stated wherever a balance appears, not buried in the terms.
    ruleNoWithdrawal: isAr
        ? 'يُستخدم رصيد المحفظة في الشراء من ريدي مارين فقط ولا يمكن سحبه نقداً أو تحويله إلى حساب بنكي.'
        : 'Wallet credit can be spent on Ready Marine only. It cannot be withdrawn as cash or transferred to a bank account.',

    // ---- History ----
    history: isAr ? 'سجل المحفظة' : 'Wallet history',
    noHistory: isAr ? 'لا توجد عمليات بعد.' : 'No transactions yet.',
    topupHistory: isAr ? 'عمليات الشحن' : 'Top-ups',
    order: isAr ? 'طلب' : 'Order',
    loadMore: isAr ? 'عرض المزيد' : 'Load more',
    balanceAfterLabel: isAr ? 'الرصيد بعدها' : 'Balance after',
    emptyWallet: isAr
        ? 'محفظتك فارغة. اشحنها لتدفع بسرعة في طلبك القادم.'
        : 'Your wallet is empty. Top it up to check out faster next time.',
});

/** Human label for a wallet ledger entry type. */
export const walletTypeLabel = (type, isAr) => ({
    topup: isAr ? 'شحن المحفظة' : 'Wallet top-up',
    purchase: isAr ? 'دفع طلب' : 'Order payment',
    purchase_reserve: isAr ? 'حجز لعملية شراء' : 'Held for a purchase',
    purchase_release: isAr ? 'إلغاء الحجز' : 'Hold released',
    purchase_refund: isAr ? 'استرداد بعد إلغاء الطلب' : 'Returned after cancellation',
    refund_credit: isAr ? 'مبلغ مسترد' : 'Refund credited',
    admin_credit: isAr ? 'إضافة من الدعم' : 'Added by support',
    admin_debit: isAr ? 'خصم من الدعم' : 'Removed by support',
}[type] || type);

/**
 * Sign of a ledger entry from the CUSTOMER's point of view.
 *
 * Derived from the type rather than from the balance delta, so the row reads
 * the way the customer experienced it — a hold leaves their spendable balance
 * even though the money has not left the wallet.
 */
export const walletTypeSign = (type) => {
    if (['topup', 'purchase_release', 'purchase_refund', 'refund_credit', 'admin_credit'].includes(type)) return '+';
    if (['purchase', 'purchase_reserve', 'admin_debit'].includes(type)) return '-';
    return '';
};

/** Status label for a top-up attempt. */
export const topupStatusLabel = (status, isAr) => ({
    pending: isAr ? 'قيد الانتظار' : 'Pending',
    paid: isAr ? 'تم' : 'Completed',
    failed: isAr ? 'فشل' : 'Failed',
    expired: isAr ? 'منتهي' : 'Expired',
    // The customer paid and the credit did not land. Named plainly so support
    // can be pointed at it, rather than hidden behind a generic failure.
    paid_credit_failed: isAr ? 'تم الدفع — بانتظار الإضافة' : 'Paid — awaiting credit',
}[status] || status);
