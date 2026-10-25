/**
 * Loyalty points copy (English / Arabic).
 *
 * Kept feature-scoped alongside `familyLocalization.js` and
 * `friendLocalization.js`. Two things this copy is careful about:
 *
 *  - Points shown before an order settles are ESTIMATES. The wording says so,
 *    because the backend is authoritative and a returned item changes the
 *    number after the fact.
 *  - "Pending" and "Available" are never used interchangeably. A customer who
 *    thinks pending points are spendable will hit a wall at checkout.
 */

export const loyaltyCopy = (isAr) => ({
    myPoints: isAr ? 'نقاطي' : 'My Points',
    points: isAr ? 'نقطة' : 'points',
    available: isAr ? 'النقاط المتاحة' : 'Available points',
    pending: isAr ? 'النقاط قيد الانتظار' : 'Pending points',
    reserved: isAr ? 'النقاط المحجوزة' : 'Reserved points',
    currentValue: isAr ? 'القيمة الحالية' : 'Current value',
    availableHint: isAr ? 'جاهزة للاستخدام في طلبك القادم.' : 'Ready to use on your next order.',
    pendingHint: (days) => isAr
        ? `تُضاف إلى رصيدك بعد انتهاء فترة الإرجاع (${days} يوماً من التسليم).`
        : `Added to your balance after the return window closes (${days} days from delivery).`,
    reservedHint: isAr
        ? 'محجوزة مؤقتاً لعملية دفع جارية. تعود إليك تلقائياً إذا لم تكتمل.'
        : 'Held for a payment in progress. They come back automatically if it does not complete.',

    // ---- Checkout ----
    useMyPoints: isAr ? 'استخدم نقاطي' : 'Use my points',
    useMaximum: isAr ? 'استخدم الحد الأقصى' : 'Use maximum',
    pointsApplied: (points) => isAr
        ? `نقاط الولاء (${points} نقطة)`
        : `Loyalty points (${points} ${points === 1 ? 'point' : 'points'})`,
    youHave: (points) => isAr
        ? `لديك ${points} نقطة متاحة`
        : `You have ${points} available ${points === 1 ? 'point' : 'points'}`,
    maxUsable: (points, amount, currency) => isAr
        ? `يمكنك استخدام ${points} نقطة كحد أقصى في هذا الطلب (${currency} ${amount}).`
        : `You can use up to ${points} points on this order (${currency} ${amount}).`,
    earnEstimate: (points) => isAr
        ? `ستكسب حوالي ${points} نقطة بعد تسليم هذا الطلب.`
        : `Earn approximately ${points} ${points === 1 ? 'point' : 'points'} after this order is delivered.`,
    estimateNote: isAr
        ? 'النقاط المعروضة قبل التسليم تقديرية.'
        : 'Points shown before delivery are an estimate.',
    noPointsYet: isAr
        ? 'لا توجد نقاط بعد. اطلب من ريدي مارين لتبدأ في جمع النقاط.'
        : 'No points yet. Place an order with Ready Marine to start earning.',
    notOnShipping: isAr
        ? 'لا يمكن استخدام النقاط لدفع قيمة الشحن.'
        : 'Points cannot be used to pay for shipping.',

    // ---- Rules panel ----
    howItWorks: isAr ? 'كيف تعمل النقاط' : 'How points work',
    earnRule: (spend, currency) => isAr
        ? `كل ${currency} ${spend} من قيمة المنتجات = 1 نقطة.`
        : `Every ${currency} ${spend} of product value earns 1 point.`,
    valueRule: (value, currency) => isAr
        ? `كل نقطة = خصم ${currency} ${value}.`
        : `1 point = ${currency} ${value} discount.`,
    capRule: (percent) => isAr
        ? `يمكن دفع ما يصل إلى ${percent}% من قيمة المنتجات بالنقاط.`
        : `Up to ${percent}% of the product value can be paid with points.`,
    minRule: (min) => isAr
        ? `الحد الأدنى للاستخدام: ${min} نقطة.`
        : `Minimum redemption: ${min} points.`,
    noExpiry: isAr ? 'النقاط لا تنتهي صلاحيتها.' : 'Points do not expire.',
    expiryRule: (days) => isAr
        ? `تنتهي صلاحية النقاط بعد ${days} يوماً.`
        : `Points expire after ${days} days.`,
    shippingExcluded: isAr
        ? 'الشحن والخصومات لا تكسب نقاطاً.'
        : 'Shipping and discounts do not earn points.',

    // ---- History ----
    history: isAr ? 'سجل النقاط' : 'Points history',
    noHistory: isAr ? 'لا توجد عمليات بعد.' : 'No transactions yet.',
    order: isAr ? 'طلب' : 'Order',
    loadMore: isAr ? 'عرض المزيد' : 'Load more',
});

/** Human label for a ledger entry type. */
export const loyaltyTypeLabel = (type, isAr) => ({
    earn_pending: isAr ? 'نقاط مكتسبة (قيد الانتظار)' : 'Points earned (pending)',
    earn_release: isAr ? 'أصبحت النقاط متاحة' : 'Points became available',
    earn_reverse: isAr ? 'استرجاع نقاط مكتسبة' : 'Earned points reversed',
    redeem_reserve: isAr ? 'حجز نقاط للدفع' : 'Points held for payment',
    redeem_release: isAr ? 'إلغاء حجز النقاط' : 'Hold released',
    redeem_consume: isAr ? 'استخدام النقاط' : 'Points redeemed',
    redeem_restore: isAr ? 'إعادة النقاط' : 'Points returned',
    admin_credit: isAr ? 'إضافة من الدعم' : 'Added by support',
    admin_debit: isAr ? 'خصم من الدعم' : 'Removed by support',
    expire: isAr ? 'انتهاء صلاحية' : 'Expired',
}[type] || type);

/**
 * Sign of a ledger entry from the CUSTOMER's point of view.
 *
 * Deliberately not `balance_deltas.available`: a pending earn adds nothing to
 * the available balance, but the customer has still gained points and the row
 * must read as a gain.
 */
export const loyaltyTypeSign = (type) => {
    if (['earn_pending', 'earn_release', 'redeem_release', 'redeem_restore', 'admin_credit'].includes(type)) return '+';
    if (['earn_reverse', 'redeem_reserve', 'redeem_consume', 'admin_debit', 'expire'].includes(type)) return '-';
    return '';
};

/** Why the server refused a redemption, in words the customer can act on. */
export const loyaltyBlockedCopy = (reason, isAr, context = {}) => {
    if (!reason) return '';
    return {
        REDEMPTION_DISABLED: isAr
            ? 'استخدام النقاط غير متاح حالياً.'
            : 'Redeeming points is currently unavailable.',
        COUPON_STACKING_DISABLED: isAr
            ? 'لا يمكن استخدام النقاط مع كوبون الخصم في نفس الطلب.'
            : 'Points cannot be combined with a coupon on the same order.',
        BELOW_MINIMUM: isAr
            ? `الحد الأدنى لاستخدام النقاط هو ${context.min || 1} نقطة.`
            : `You need at least ${context.min || 1} points to redeem.`,
    }[reason] || '';
};
