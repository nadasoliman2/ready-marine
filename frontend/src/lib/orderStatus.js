/**
 * Shared order-status presentation helpers used by admin, customer, and vendor views
 * so the status shown is always consistent and in sync with the backend.
 *
 * Internal order statuses mirror the backend Order enum and Backend/services/bostaStatusMap.js.
 * Post-dispatch statuses (pickup_scheduled → completed/returned/exception) are driven by Bosta
 * and are NOT manually editable by the admin.
 */

export const ORDER_STATUS_META = {
    pending:             { label_en: 'Pending',            label_ar: 'قيد الانتظار',       color: 'bg-amber-500/20 text-amber-500' },
    processing:          { label_en: 'Processing',         label_ar: 'قيد التجهيز',        color: 'bg-blue-500/20 text-blue-500' },
    confirmed:           { label_en: 'Confirmed',          label_ar: 'مؤكد',               color: 'bg-indigo-500/20 text-indigo-500' },
    ready:               { label_en: 'Ready',              label_ar: 'جاهز',               color: 'bg-cyan-500/20 text-cyan-500' },
    pickup_scheduled:    { label_en: 'Pickup Scheduled',   label_ar: 'تم جدولة الاستلام',  color: 'bg-teal-500/20 text-teal-500' },
    picked_up:           { label_en: 'Picked Up',          label_ar: 'تم الاستلام',        color: 'bg-indigo-500/20 text-indigo-500' },
    in_transit:          { label_en: 'In Transit',         label_ar: 'قيد النقل',          color: 'bg-violet-500/20 text-violet-500' },
    out_for_delivery:    { label_en: 'Out for Delivery',   label_ar: 'خرج للتسليم',        color: 'bg-blue-500/20 text-blue-500' },
    // A multi-vendor order lives most of its life in one of these two. They exist because
    // one word cannot honestly describe three parcels in three different states — every
    // screen renders them beside the "1 of 3" counter.
    partially_shipped:   { label_en: 'Partly Shipped',     label_ar: 'شُحن جزئياً',        color: 'bg-sky-500/20 text-sky-500' },
    partially_delivered: { label_en: 'Partly Delivered',   label_ar: 'وصل جزئياً',         color: 'bg-lime-500/20 text-lime-600' },
    partially_cancelled: { label_en: 'Partly Cancelled',   label_ar: 'ملغى جزئياً',        color: 'bg-orange-500/20 text-orange-500' },
    completed:           { label_en: 'Completed',          label_ar: 'مكتمل',              color: 'bg-emerald-500/20 text-emerald-500' },
    // The journey back. Derived on the server from the items' own return_status, which is
    // written at every step, so the order says where the goods actually are instead of
    // going on calling itself completed. See models/orders.js for the full ladder.
    return_requested:    { label_en: 'Return requested',   label_ar: 'طلب إرجاع',          color: 'bg-amber-500/20 text-amber-600 dark:text-amber-500' },
    return_in_progress:  { label_en: 'Return on the way',  label_ar: 'المرتجع في الطريق',  color: 'bg-violet-500/20 text-violet-500' },
    partially_returned:  { label_en: 'Partly Returned',    label_ar: 'مرتجع جزئياً',       color: 'bg-orange-500/20 text-orange-500' },
    returned:            { label_en: 'Returned',           label_ar: 'تم الإرجاع',         color: 'bg-orange-500/20 text-orange-500' },
    refunded:            { label_en: 'Refunded',           label_ar: 'تم رد المبلغ',       color: 'bg-rose-500/20 text-rose-500' },
    exception:           { label_en: 'Exception',          label_ar: 'مشكلة',              color: 'bg-red-500/20 text-red-500' },
    cancelled:           { label_en: 'Cancelled',          label_ar: 'ملغى',               color: 'bg-zinc-500/20 text-zinc-500' },
};

/* ================================================================== */
/*  Sub-orders (parcels)                                              */
/* ================================================================== */

/**
 * A parcel's own status — one vendor, one branch, one box.
 *
 * `stage` is which of the vendor's three steps it sits on (null once Bosta has it), and is
 * what the progress bar reads.
 */
export const SUB_ORDER_STATUS_META = {
    pending_review:    { stage: 1, label_en: 'Confirming products',  label_ar: 'تأكيد المنتجات',      color: 'bg-amber-500/20 text-amber-500' },
    awaiting_tracking: { stage: 2, label_en: 'Needs tracking number', label_ar: 'محتاج رقم تتبع',     color: 'bg-blue-500/20 text-blue-500' },
    awaiting_handover: { stage: 3, label_en: 'Being sealed',        label_ar: 'جاري التغليف',        color: 'bg-indigo-500/20 text-indigo-500' },
    // Still physically AT THE STORE. Both of these say a courier has not been yet, which is
    // why neither of them may be worded as though the parcel has gone anywhere.
    ready_for_pickup:  { stage: 4, label_en: 'Waiting for courier',  label_ar: 'في انتظار المندوب',   color: 'bg-cyan-500/20 text-cyan-500' },
    pickup_scheduled:  { stage: 4, label_en: 'Courier booked',       label_ar: 'تم حجز المندوب',      color: 'bg-teal-500/20 text-teal-500' },
    // The vendor's word that the courier took it, before Bosta has confirmed. Worded as the
    // claim it is — "the store says it went" — so it never gets read as a Bosta scan.
    handed_to_courier: { stage: null, label_en: 'Given to courier',  label_ar: 'اتسلمت للمندوب',      color: 'bg-indigo-500/20 text-indigo-500' },
    picked_up:         { stage: null, label_en: 'Collected',         label_ar: 'تم الاستلام',         color: 'bg-indigo-500/20 text-indigo-500' },
    in_transit:        { stage: null, label_en: 'In transit',        label_ar: 'قيد النقل',           color: 'bg-violet-500/20 text-violet-500' },
    out_for_delivery:  { stage: null, label_en: 'Out for delivery',  label_ar: 'خرج للتسليم',         color: 'bg-blue-500/20 text-blue-500' },
    delivered:         { stage: null, label_en: 'Delivered',         label_ar: 'تم التسليم',          color: 'bg-emerald-500/20 text-emerald-500' },
    returned:          { stage: null, label_en: 'Returned',          label_ar: 'تم الإرجاع',          color: 'bg-orange-500/20 text-orange-500' },
    exception:         { stage: null, label_en: 'Problem',           label_ar: 'مشكلة',               color: 'bg-red-500/20 text-red-500' },
    needs_admin:       { stage: 1, label_en: 'With the website team', label_ar: 'مع إدارة الموقع',    color: 'bg-red-500/20 text-red-500' },
    cancelled:         { stage: null, label_en: 'Cancelled',         label_ar: 'ملغاة',               color: 'bg-zinc-500/20 text-zinc-500' },
    // Company consolidation (feature 14): waiting for colleagues ordering from the same
    // store, before the store sees it. A rider inside a combined parcel is reported with
    // its parcel's status by the server, so it needs no label of its own here.
    held_in_batch:     { stage: null, label_en: 'Waiting for colleagues', label_ar: 'مستني زمايلك',     color: 'bg-sky-500/20 text-sky-500' },
    in_batch_parcel:   { stage: null, label_en: 'In a combined parcel', label_ar: 'في طرد مجمّع',       color: 'bg-indigo-500/20 text-indigo-500' },
};

/**
 * The parcel as the vendor's OWN DECISION, which is a different question from where the
 * parcel is in the pipeline.
 *
 * "With the website team" is honest about the pipeline and silent about the vendor: it reads
 * the same whether they refused the parcel or an admin pulled it for another reason. This
 * badge sits beside the status and answers only "what did I decide?". Derived on the server
 * from the item reviews (`sub.vendor_review`), never stored.
 */
export const VENDOR_REVIEW_META = {
    awaiting_review:    { label_en: 'Awaiting your review', label_ar: 'بانتظار مراجعتك',  color: 'bg-amber-500/20 text-amber-600 dark:text-amber-500' },
    in_progress:        { label_en: 'Review in progress',   label_ar: 'مراجعة جارية',      color: 'bg-blue-500/20 text-blue-600 dark:text-blue-500' },
    accepted:           { label_en: 'You accepted it',      label_ar: 'قبلتها بالكامل',    color: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-500' },
    partially_accepted: { label_en: 'Partly accepted',      label_ar: 'مقبولة جزئياً',     color: 'bg-orange-500/20 text-orange-600 dark:text-orange-500' },
    rejected:           { label_en: 'You refused it',       label_ar: 'رفضتها بالكامل',    color: 'bg-red-500/20 text-red-600 dark:text-red-500' },
};

export function getVendorReviewLabel(review, isAr) {
    const meta = VENDOR_REVIEW_META[review?.key];
    if (!meta) return '';
    const base = isAr ? meta.label_ar : meta.label_en;
    // A mixed decision is meaningless without the split — "partly accepted" alone never
    // says how much of the parcel is actually shipping.
    if (review.key === 'partially_accepted' && review.total) {
        return isAr
            ? `${base} (${review.approved} من ${review.total})`
            : `${base} (${review.approved} of ${review.total})`;
    }
    return base;
}

/**
 * Whether the decision badge says anything the pipeline status does not.
 *
 * While the parcel is still in stage ① it always does. Once it has moved on, "you accepted
 * it" is just a second way of saying "in transit" — but a partial acceptance or a refusal
 * stays worth showing, because the pipeline status never mentions it.
 */
export function isVendorReviewWorthShowing(status, review) {
    if (!review?.key) return false;
    if (status === 'pending_review' || status === 'needs_admin') return true;
    return review.key !== 'accepted';
}

export function getVendorReviewColor(review) {
    return (VENDOR_REVIEW_META[review?.key] || VENDOR_REVIEW_META.awaiting_review).color;
}

/** Absolute date and time of an order, in the reader's own locale. */
export function formatOrderDate(value, isAr, { withTime = true } = {}) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(isAr ? 'ar-EG' : 'en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    });
}

/**
 * "2 days ago" — the half of the date that carries the urgency.
 *
 * A vendor scanning a list does not subtract dates; the age of the order is what tells them
 * which parcel has been sitting too long, so it is shown as words beside the real date
 * rather than instead of it.
 */
export function formatRelativeDate(value, isAr) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';

    const minutes = Math.floor((Date.now() - d.getTime()) / 60000);
    if (minutes < 1) return isAr ? 'الآن' : 'just now';
    if (minutes < 60) return isAr ? `منذ ${minutes} دقيقة` : `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return isAr ? `منذ ${hours} ساعة` : `${hours}h ago`;

    const days = Math.floor(hours / 24);
    if (days < 30) return isAr ? `منذ ${days} يوم` : `${days}d ago`;

    const months = Math.floor(days / 30);
    if (months < 12) return isAr ? `منذ ${months} شهر` : `${months}mo ago`;

    const years = Math.floor(months / 12);
    return isAr ? `منذ ${years} سنة` : `${years}y ago`;
}

/**
 * The vendor's four steps, in order, for the progress bar.
 *
 * Step 4 is the one that was missing. Without it the parcel went from "I sealed it" straight
 * to screens saying it had left the store, with nobody having said a courier came.
 */
export const VENDOR_STAGES = [
    { step: 1, label_en: 'Confirm products',  label_ar: 'تأكيد المنتجات' },
    { step: 2, label_en: 'Tracking number',   label_ar: 'رقم التتبع' },
    { step: 3, label_en: 'Seal the parcel',   label_ar: 'تغليف الشحنة' },
    { step: 4, label_en: 'Give to courier',   label_ar: 'تسليم للمندوب' },
];

export function getSubOrderStatusLabel(status, isAr) {
    const meta = SUB_ORDER_STATUS_META[status];
    if (!meta) return status || '';
    return isAr ? meta.label_ar : meta.label_en;
}

export function getSubOrderStatusColor(status) {
    return (SUB_ORDER_STATUS_META[status] || SUB_ORDER_STATUS_META.pending_review).color;
}

export function getSubOrderStage(status) {
    return SUB_ORDER_STATUS_META[status]?.stage ?? null;
}

/**
 * The sentence that goes beside the order's status badge.
 *
 * Always a counter, never a bare word: "1 of 3 delivered" is the only honest way to
 * describe an order whose parcels are in different places. Returns '' for a single-parcel
 * order, where there is nothing to explain.
 */
export function getParcelCounterLabel(summary, isAr) {
    if (!summary || !summary.total || summary.total < 2) return '';
    const { delivered = 0, total } = summary;
    return isAr ? `${delivered} من ${total} تم تسليمها` : `${delivered} of ${total} delivered`;
}

/** "Your order arrives as N separate parcels" — the line that makes the split unsurprising. */
export function getParcelCountLabel(count, isAr) {
    if (!count || count < 2) return '';
    return isAr
        ? `طلبك هيوصل في ${count} شحنات منفصلة`
        : `Your order arrives as ${count} separate parcels`;
}

/* ================================================================== */
/*  The customer's journey                                            */
/* ================================================================== */

/**
 * The seven words the CUSTOMER sees for their order, with a line under each saying what it
 * actually means. Rendered from `order.journey`, which the server rolls up.
 *
 * Seven, not the parcel ladder's ten. Two of those ten are conversations the customer is not
 * part of: "a waybill still has to be attached" is between us and the store, and the split
 * between the store's word that the courier took the box and Bosta's own scan of it is a
 * distinction we need in order not to overclaim — to the buyer both mean the courier has it.
 *
 * "مع شركة الشحن" is the sentence that started all of this, back when it appeared on parcels
 * still sitting on a shop counter. It stays, because it is the true thing to say — it just
 * cannot be said until somebody has actually confirmed it.
 */
export const CUSTOMER_JOURNEY_META = {
    placed: {
        label_en: 'Order placed', label_ar: 'الطلب اتسجّل',
        hint_en: 'We received your order', hint_ar: 'استلمنا طلبك',
    },
    preparing: {
        label_en: 'The store is preparing it', label_ar: 'المتجر بيجهّز طلبك',
        hint_en: 'Checking stock and packing your items', hint_ar: 'بيتأكد من توفر المنتجات وبيغلّفها',
    },
    ready: {
        label_en: 'Packed, waiting for the courier', label_ar: 'جاهز ومستني المندوب',
        hint_en: 'Sealed at the store, a courier is on the way to collect it',
        hint_ar: 'مغلّف في المتجر ومستني المندوب ييجي ياخده',
    },
    with_courier: {
        label_en: 'With the courier', label_ar: 'مع شركة الشحن',
        hint_en: 'The courier has collected it from the store', hint_ar: 'شركة الشحن استلمته من المتجر',
    },
    in_transit: {
        label_en: 'On the way', label_ar: 'في الطريق',
        hint_en: 'Moving through the courier\u2019s network towards your city', hint_ar: 'بيتنقل جوه شركة الشحن ناحية مدينتك',
    },
    out_for_delivery: {
        label_en: 'Out for delivery', label_ar: 'المندوب في الطريق ليك',
        hint_en: 'With the courier today — keep your phone nearby',
        hint_ar: 'مع المندوب النهاردة — خلي موبايلك جنبك',
    },
    delivered: {
        label_en: 'Delivered', label_ar: 'وصل',
        hint_en: 'Everything in this order has arrived', hint_ar: 'كل حاجة في الطلب ده وصلت',
    },
};

/* ================================================================== */
/*  Returns                                                           */
/* ================================================================== */

/**
 * The order statuses that describe a return rather than a delivery. Used to decide when a
 * screen should show a return icon instead of the delivery one.
 */
export const RETURN_ORDER_STATUSES = [
    'return_requested', 'return_in_progress', 'partially_returned', 'returned', 'refunded',
];

export function isReturnStatus(status) {
    return RETURN_ORDER_STATUSES.includes(status);
}

/**
 * A parcel's own return state (`parcel.return_state`), which uses the same vocabulary as the
 * order statuses above — so the two read the same way and there is only one set of words to
 * learn. Returns '' when nothing came back, which is the common case.
 */
export function getReturnStateLabel(state, isAr) {
    const meta = ORDER_STATUS_META[state?.key];
    if (!meta) return '';
    const base = isAr ? meta.label_ar : meta.label_en;
    if (state.key === 'partially_returned' && state.total) {
        return isAr
            ? `${base} (${state.returned} من ${state.total})`
            : `${base} (${state.returned} of ${state.total})`;
    }
    return base;
}

export function getReturnStateColor(state) {
    return (ORDER_STATUS_META[state?.key] || ORDER_STATUS_META.returned).color;
}

/**
 * The order statuses that mean nothing is moving any more: every live parcel arrived, the
 * whole order was cancelled, or the goods already came back. Everything else — including a
 * return that is still on its way — is an order the customer is still waiting on, which is
 * the split the profile draws between "Active orders" and "Order history".
 */
export const CLOSED_ORDER_STATUSES = [
    'completed', 'cancelled', 'partially_cancelled', 'partially_returned', 'returned', 'refunded',
];

export function isActiveOrderStatus(status) {
    return !CLOSED_ORDER_STATUSES.includes(status);
}

export const ORDER_STATUS_VALUES = Object.keys(ORDER_STATUS_META);

// Statuses the admin can manually set (pre-dispatch). Everything else is Bosta-driven.
// With parcels, the order's status is DERIVED from them — the only order-level verb left
// is cancelling, which is itself a loop over the parcels. Everything else is done on the
// parcel you mean.
export const ADMIN_SETTABLE_STATUSES = ['pending', 'processing', 'confirmed', 'ready', 'cancelled'];

/** Statuses an admin may close a single parcel into, always with a written reason. */
export const ADMIN_SUB_ORDER_OVERRIDES = ['delivered', 'returned', 'cancelled'];

// Statuses controlled by Bosta delivery tracking once an order is dispatched.
export const BOSTA_DRIVEN_STATUSES = [
    'ready', 'pickup_scheduled', 'picked_up', 'in_transit', 'out_for_delivery', 'completed', 'returned', 'exception',
];

export function isBostaDrivenStatus(status) {
    return BOSTA_DRIVEN_STATUSES.includes(status);
}

export function getOrderStatusLabel(status, isAr) {
    const meta = ORDER_STATUS_META[status];
    if (!meta) return status || '';
    return isAr ? meta.label_ar : meta.label_en;
}

export function getOrderStatusColor(status) {
    return (ORDER_STATUS_META[status] || ORDER_STATUS_META.pending).color;
}

/**
 * Raw Bosta delivery `state.value` (lowercased) → Arabic label.
 * For English we display Bosta's raw value as-is.
 */
export const BOSTA_STATE_LABELS_AR = {
    'pending': 'قيد الانتظار',
    'pickup requested': 'تم طلب الاستلام',
    'waiting for route': 'بانتظار المسار',
    'route assigned': 'تم تعيين المسار',
    'waiting for pickup': 'بانتظار الاستلام',
    'picking up': 'في الطريق للعميل',
    'picking up from consignee': 'جاري الاستلام من العميل',
    'picked up from consignee': 'تم الاستلام من العميل',
    'picked up from business': 'تم الاستلام من التاجر',
    'picked up': 'تم الاستلام',
    'received at warehouse': 'تم الاستلام في المخزن',
    'fulfilled': 'تم التجهيز',
    'in transit between hubs': 'قيد النقل بين الفروع',
    'delivering': 'خرج للتسليم',
    'arrived at customer': 'وصل إلى العميل',
    'delivered': 'تم التسليم',
    'delivery confirmed': 'تم تأكيد التسليم',
    'returned to business': 'تم الإرجاع للتاجر',
    'returned to stock': 'تم الإرجاع للمخزون',
    'canceled': 'ملغى',
    'cancelled': 'ملغى',
    'terminated': 'تم الإنهاء',
    'exception': 'مشكلة',
    'investigation': 'قيد التحقق',
    'awaiting your action': 'بانتظار إجراء منك',
    'on hold': 'معلّق',
    'archived': 'مؤرشف',
    'lost': 'مفقود',
    'damaged': 'تالف',
};

/*
 * Arrive writes its state as "<courier's words> (#<code>)" (see the backend's
 * `couriers/arrive/statusMap.rawLabel`). Its words are usually English and its codes are
 * numeric, so without the two helpers below an Arabic customer read "Delivered (#5)" and a
 * delivered Arrive parcel wore the amber "pending" chip — the Bosta vocabulary below matches
 * none of it. Only the code is trusted here; the trailing "(#n)" is never shown to anyone.
 */
const ARRIVE_CODE_RE = /\(#(\d+)\)\s*$/;

// Arabic wording + colour family per Arrive code. Mirrors the backend map; codes missing here
// simply fall through to the raw text and the neutral bucket rather than being mislabelled.
const ARRIVE_STATES = {
    1: ['طلب بيك أب', 'amber'], 330: ['تخصيص البيك أب', 'amber'],
    2: ['تم استلام البيك أب', 'indigo'], 16: ['في الطريق للمخزن', 'indigo'],
    3: ['تم الاستلام في المخزن', 'indigo'], 125: ['تم الاستلام في الفرع', 'indigo'],
    600: ['تم الاستلام في فرع المنطقة', 'indigo'],
    24: ['في الطريق', 'blue'], 39: ['تحويل بين الفروع', 'blue'], 26: ['في الطريق للفرع', 'blue'],
    450: ['توجيه من منطقة التوزيع', 'blue'], 34: ['إعادة توزيع', 'blue'],
    4: ['قيد التوصيل', 'blue'], 45: ['المحاولة الأولى', 'blue'],
    46: ['المحاولة الثانية', 'blue'], 47: ['المحاولة الثالثة', 'blue'],
    5: ['تم التسليم', 'emerald'], 33: ['تم التسليم', 'emerald'],
    18: ['تسليم جزئي', 'emerald'],
    6: ['مؤجلة', 'red'], 900: ['مؤجلة (واتساب)', 'red'], 1200: ['تأجيل غير مؤكد', 'red'],
    13: ['مشكلة في التسليم', 'red'], 19: ['تهرب بعد التنسيق', 'red'],
    20: ['رفض الاستلام', 'red'], 25: ['رفض الاستلام ورفض الدفع', 'red'],
    1100: ['رفض ورفض الدفع', 'red'], 1150: ['رفض غير مؤكد', 'red'],
    100: ['معلقة', 'red'], 110: ['خرجت ولم تصل', 'red'], 120: ['وصلت لمخزن خطأ', 'red'],
    150: ['مرتجعات معلقة', 'red'],
    43: ['جاري التعويض', 'red'], 220: ['تم التعويض', 'red'],
    7: ['ارتجاع للفرع', 'red'], 27: ['في الطريق للتاجر', 'red'], 28: ['مرتجعات للفروع', 'red'],
    31: ['مرتجعات بالفرع', 'red'], 135: ['مرتجعات للرئيسي', 'red'],
    14: ['تم الارتجاع للراسل', 'red'], 8: ['تقفيل المرتجع', 'red'], 105: ['مرتجعات', 'red'],
    800: ['تم الإلغاء', 'red'], 1250: ['إلغاء غير مؤكد', 'red'],
    17: ['استبدال / استلام طرد', 'red'], 22: ['مرتجع استبدال', 'red'], 21: ['مرتجع جزئي', 'red'],
};

const ARRIVE_BUCKETS = {
    emerald: 'bg-emerald-500/20 text-emerald-500',
    blue: 'bg-blue-500/20 text-blue-500',
    indigo: 'bg-indigo-500/20 text-indigo-500',
    red: 'bg-red-500/20 text-red-500',
    amber: 'bg-amber-500/20 text-amber-500',
};

/** The Arrive code in a raw state string, or null when it is not an Arrive state. */
const arriveCodeOf = (rawState) => {
    const m = ARRIVE_CODE_RE.exec(String(rawState || ''));
    return m ? Number(m[1]) : null;
};

/**
 * Human label for a shipment's raw courier status. Arabic when isAr, else the raw value.
 */
export function getShipmentStatusLabel(rawState, isAr) {
    if (!rawState) return isAr ? 'قيد الانتظار' : 'Pending';

    const code = arriveCodeOf(rawState);
    if (code !== null) {
        // Never show the bare "(#n)" — it means nothing to a customer.
        const text = String(rawState).replace(ARRIVE_CODE_RE, '').trim();
        if (isAr) return ARRIVE_STATES[code]?.[0] || text;
        return text;
    }

    if (!isAr) return rawState;
    return BOSTA_STATE_LABELS_AR[String(rawState).trim().toLowerCase()] || rawState;
}

/**
 * Coarse color bucket for a shipment's raw courier status.
 */
export function getShipmentStatusColor(rawState) {
    const code = arriveCodeOf(rawState);
    if (code !== null) return ARRIVE_BUCKETS[ARRIVE_STATES[code]?.[1] || 'amber'];

    const k = String(rawState || '').trim().toLowerCase();
    if (['delivered', 'delivery confirmed'].includes(k)) return 'bg-emerald-500/20 text-emerald-500';
    if (['delivering', 'arrived at customer', 'picking up', 'picked up', 'in transit between hubs'].includes(k)) return 'bg-blue-500/20 text-blue-500';
    if (['picked up from business', 'picked up from consignee', 'picking up from consignee', 'received at warehouse', 'fulfilled'].includes(k)) return 'bg-indigo-500/20 text-indigo-500';
    if (['canceled', 'cancelled', 'terminated', 'returned to business', 'returned to stock', 'exception', 'lost', 'damaged', 'investigation', 'awaiting your action', 'on hold'].includes(k)) return 'bg-red-500/20 text-red-500';
    return 'bg-amber-500/20 text-amber-500';
}
