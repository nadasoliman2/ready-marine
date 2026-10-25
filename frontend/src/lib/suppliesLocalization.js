/**
 * Shared vocabulary for the packaging-and-labels module.
 *
 * Both dashboards read from here so a status never means one thing to the vendor and
 * something slightly different to the admin — the two are looking at the same order and
 * often talking to each other about it on the phone.
 */

export const SUPPLY_CATEGORIES = [
    { value: 'all', en: 'All', ar: 'الكل' },
    { value: 'poly_mailer', en: 'Poly mailers', ar: 'الفليرات' },
    { value: 'box', en: 'Boxes', ar: 'الصناديق' },
    { value: 'sticker', en: 'Stickers', ar: 'الملصقات' },
    { value: 'label', en: 'Labels', ar: 'ملصقات الشحن' },
    { value: 'other', en: 'Other', ar: 'أخرى' },
];

/** Fulfilment stages, in the order the admin walks them. */
export const ORDER_STATUSES = {
    pending:   { en: 'Awaiting review', ar: 'بانتظار المراجعة', tone: 'amber' },
    approved:  { en: 'Being prepared',  ar: 'جاري التجهيز',    tone: 'blue' },
    sent:      { en: 'On its way',      ar: 'في الطريق',        tone: 'indigo' },
    delivered: { en: 'Delivered',       ar: 'تم التسليم',       tone: 'emerald' },
    rejected:  { en: 'Rejected',        ar: 'مرفوض',            tone: 'red' },
    cancelled: { en: 'Cancelled',       ar: 'ملغي',             tone: 'zinc' },
};

export const PAYMENT_STATUSES = {
    unpaid:          { en: 'Unpaid',          ar: 'غير مدفوع',        tone: 'zinc' },
    awaiting_online: { en: 'Awaiting payment', ar: 'بانتظار الدفع',   tone: 'amber' },
    paid:            { en: 'Paid',            ar: 'مدفوع',            tone: 'emerald' },
    failed:          { en: 'Payment failed',  ar: 'فشل الدفع',        tone: 'red' },
    cancelled:       { en: 'Refunded',        ar: 'تم الاسترداد',     tone: 'zinc' },
};

export const DELIVERY_METHODS = {
    with_pickup: { en: 'With the next courier pickup', ar: 'مع أقرب مندوب استلام' },
    courier:     { en: 'Sent by courier',              ar: 'شحن بمندوب' },
    handover:    { en: 'Collected in person',          ar: 'استلام من المقر' },
};

/** What the admin may do next, mirroring the server's own transition table. */
export const NEXT_ACTIONS = {
    pending: ['approved', 'rejected'],
    approved: ['sent', 'cancelled'],
    sent: ['delivered'],
    delivered: [],
    rejected: [],
    cancelled: [],
};

export const label = (map, key, isAr) => {
    const entry = map[key];
    if (!entry) return key;
    return isAr ? entry.ar : entry.en;
};

export const toneClasses = (tone) => ({
    amber: 'bg-amber-100 text-amber-700 border-amber-200',
    blue: 'bg-blue-100 text-blue-700 border-blue-200',
    indigo: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    emerald: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    red: 'bg-red-100 text-red-700 border-red-200',
    zinc: 'bg-zinc-100 text-zinc-600 border-zinc-200',
}[tone] || 'bg-zinc-100 text-zinc-600 border-zinc-200');

/**
 * How one line of the catalogue reads: "3.5 EGP / 10 pieces", or just "3.5 EGP" for
 * something sold singly, where "/ 1 piece" is noise.
 */
export const packLabel = (product, isAr) => {
    const unit = isAr ? (product.unit_label_ar || 'قطعة') : (product.unit_label || 'piece');
    if (Number(product.pack_size) <= 1) return isAr ? `للـ${unit}` : `per ${unit}`;
    return isAr ? `لكل ${product.pack_size} ${unit}` : `per ${product.pack_size} ${unit}s`;
};

export const suppliesCopy = (isAr) => (isAr ? {
    vendorTitle: 'مستلزمات الشحن والتغليف',
    vendorIntro: 'اطلب الفليرات والصناديق والملصقات. الفلوس بتتخصم من محفظتك، ولو مش مكفية بتكمّل أونلاين.',
    adminTitle: 'مستلزمات الشحن والتغليف',
    catalogue: 'الكتالوج',
    orders: 'الطلبات',
    cart: 'طلبك',
    emptyCart: 'لسه مضفتش حاجة.',
    addToCart: 'إضافة',
    packs: 'عبوة',
    total: 'الإجمالي',
    fromWallet: 'من المحفظة',
    payOnline: 'يُدفع أونلاين',
    walletBalance: 'رصيد المحفظة',
    placeOrder: 'تأكيد الطلب',
    placing: 'جاري الإرسال...',
    payNow: 'ادفع الباقي',
    myOrders: 'طلباتي',
    noOrders: 'مفيش طلبات لسه.',
    orderNumber: 'رقم الطلب',
    cancel: 'إلغاء',
    items: 'أصناف',
} : {
    vendorTitle: 'Packaging & labels',
    vendorIntro: 'Order mailers, boxes and labels. Your wallet pays what it can, and anything left over is paid online.',
    adminTitle: 'Packaging & labels',
    catalogue: 'Catalogue',
    orders: 'Orders',
    cart: 'Your order',
    emptyCart: 'Nothing added yet.',
    addToCart: 'Add',
    packs: 'pack',
    total: 'Total',
    fromWallet: 'From wallet',
    payOnline: 'To pay online',
    walletBalance: 'Wallet balance',
    placeOrder: 'Place order',
    placing: 'Placing...',
    payNow: 'Pay the balance',
    myOrders: 'My orders',
    noOrders: 'No orders yet.',
    orderNumber: 'Order',
    cancel: 'Cancel',
    items: 'items',
});
