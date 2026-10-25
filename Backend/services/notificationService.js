/**
 * Notification Service
 * Handles subscription-related notifications with DB persistence + console fallback.
 */
const { createNotification } = require('../models/notifications');

/**
 * Build notification content (title + message) for a given type.
 */
const buildContent = (type, data) => {
    switch (type) {
        case 'trial_activated':
            return {
                title: 'Free Trial Activated',
                message: `Your free trial for "${data.packageName}" has been activated. It expires on ${formatDate(data.expiresAt)}. Make the most of your ${data.trialDays} days!`,
            };
        case 'subscription_activated':
            return {
                title: 'Subscription Activated',
                message: `Your ${data.isTrial ? 'free trial' : 'subscription'} for "${data.packageName}" is now active. ${data.isTrial ? `Trial ends on ${formatDate(data.expiresAt)}.` : `Renews on ${formatDate(data.expiresAt)}.`}`,
            };
        case 'subscription_expiring_soon':
            return {
                title: `Subscription Expiring ${data.daysUntilExpiry === 1 ? 'Tomorrow' : 'Soon'}`,
                message: `Your subscription for "${data.packageName}" will expire in ${data.daysUntilExpiry} day${data.daysUntilExpiry > 1 ? 's' : ''} (${formatDate(data.expiresAt)}). Renew now to keep your products live.`,
            };
        case 'subscription_expired':
            return {
                title: 'Subscription Expired',
                message: `Your subscription for "${data.packageName}" has expired. All your products have been hidden. Resubscribe to restore visibility.`,
            };
        case 'subscription_cancelled':
            return {
                title: 'Subscription Cancelled',
                message: `Your subscription for "${data.packageName}" has been cancelled. All products are now hidden.`,
            };
        case 'account_became_not_subscribed':
            return {
                title: 'Account Not Subscribed',
                message: `Your account has no active subscription. You cannot publish or sell products until you resubscribe.`,
            };
        case 'account_suspended':
            return {
                title: 'Account Suspended',
                message: `Your account has been suspended. Reason: ${data.reason}. Contact support for more information.`,
            };
        case 'account_reactivated':
            return {
                title: 'Account Reactivated',
                message: `Your account has been reactivated. Welcome back!`,
            };
        case 'product_visibility_restored':
            return {
                title: 'Products Back Online',
                message: `Your products are now visible on the marketplace. ${data.productCount ? `${data.productCount} product${data.productCount > 1 ? 's' : ''} restored.` : ''}`,
            };
        case 'renewal_successful':
            return {
                title: 'Subscription Renewed',
                message: `Your subscription for "${data.packageName}" has been renewed. It now expires on ${formatDate(data.expiresAt)}.`,
            };
        case 'product_limit_warning':
            return {
                title: 'Product Limit Warning',
                message: `You have ${data.used} of ${data.max} published products. You have ${data.remaining} slot${data.remaining > 1 ? 's' : ''} remaining. Upgrade your plan to publish more.`,
            };
        case 'return_request_received':
            return {
                title: 'New Return Request',
                message: data.message || `Return ${data.return_number || ''}: A customer has requested a return. Please review.`,
            };
        case 'return_admin_approved':
            return {
                title: 'Return Approved',
                message: data.message || `Return ${data.return_number || ''} has been approved. Return shipment will be arranged.`,
            };
        case 'return_admin_rejected':
            return {
                title: 'Return Rejected',
                message: data.message || `Return ${data.return_number || ''} has been rejected.`,
            };
        case 'return_shipment_created':
            return {
                title: 'Return Shipment Created',
                message: data.message || `A return pickup has been scheduled for return ${data.return_number || ''}.`,
            };
        case 'return_received_by_vendor':
            return {
                title: 'Returned Items Received',
                message: data.message || `Returned items for ${data.return_number || ''} have been received. Refund will be processed.`,
            };
        case 'refund_processing':
            return {
                title: 'Refund Processing',
                message: data.message || `Refund for return ${data.return_number || ''} is being processed. Amount: ${data.amount || 'N/A'} EGP.`,
            };
        case 'refund_completed':
            return {
                title: 'Refund Completed',
                message: data.message || `Refund ${data.refund_number || ''} has been completed. ${data.commission_reversal ? `Commission adjustment: ${data.commission_reversal} EGP.` : ''}`,
            };
        default:
            return { title: 'Notification', message: data.message || 'You have a new notification.' };
    }
};

const formatDate = (date) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
};

/**
 * Send a notification to a vendor — persists to DB and logs to console.
 * @param {string} vendorId - The vendor's ObjectId
 * @param {string} type - Notification type
 * @param {object} data - Additional data for the notification
 */
const sendSubscriptionNotification = async (vendorId, type, data) => {
    const { Seller } = require('../models/sellers');
    const vendor = await Seller.findById(vendorId).select('email name store_name').lean();

    if (!vendor) {
        console.warn(`[NotificationService] Vendor not found: ${vendorId}`);
        return null;
    }

    const { title, message } = buildContent(type, data);

    // Persist to DB
    try {
        await createNotification(vendorId, type, title, message, data);
    } catch (err) {
        console.error(`[NotificationService] Failed to persist notification: ${err.message}`);
    }

    // Console log for observability
    const typeIcons = {
        subscription_activated: '✅',
        trial_activated: '🎁',
        subscription_expiring_soon: '⚠️',
        subscription_expired: '❌',
        subscription_cancelled: '🚫',
        account_became_not_subscribed: '⚠️',
        account_suspended: '🚫',
        account_reactivated: '✅',
        product_visibility_restored: '🔄',
        renewal_successful: '🔄',
        product_limit_warning: '⚠️',
        return_request_received: '📦',
        return_admin_approved: '✅',
        return_admin_rejected: '❌',
        return_shipment_created: '🚚',
        return_received_by_vendor: '📬',
        refund_processing: '💳',
        refund_completed: '💰',
    };

    console.log(`[NotificationService] ${typeIcons[type] || '📬'} [${type}] for ${vendor.store_name} (${vendor.email}): ${title}`);

    return { vendorId, vendorEmail: vendor.email, vendorName: vendor.name, type, title, message, data, createdAt: new Date() };
};

/* ------------------------------------------------------------------ */
/* Vendor subscription expiry — WhatsApp reminder                      */
/* ------------------------------------------------------------------ */

/** EverySecond template `ready_car_vendor_reminder` (UTILITY, 4 variables). */
const VENDOR_REMINDER_TEMPLATE_ID = Number(process.env.WHATSAPP_VENDOR_REMINDER_TEMPLATE_ID || 41);

/**
 * Arabic phrase for a remaining-days count.
 *
 * Passed as a whole phrase rather than a bare number because Arabic does not
 * pluralize the way a `${n} أيام` interpolation assumes — "1 أيام" and
 * "2 أيام" are both wrong.
 */
const arabicDaysPhrase = (days) => {
    if (days === 1) return 'يوم واحد';
    if (days === 2) return 'يومين';
    if (days === 7) return 'أسبوع';
    if (days >= 3 && days <= 10) return `${days} أيام`;
    return `${days} يوم`;
};

const arabicDate = (value) => new Date(value).toLocaleDateString('ar-EG-u-ca-gregory', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
});

/**
 * WhatsApp the vendor that their subscription is about to lapse.
 *
 * Fail-safe: a provider outage must not stop the rest of the sweep, and must
 * not stop the in-app notification that already went out. Returns whether the
 * message was accepted so the caller can record the attempt.
 */
const sendExpiryWhatsapp = async ({ vendor, packageName, daysBeforeExpiry, expiresAt }) => {
    if (!vendor?.phone) return { skipped: 'no_phone' };

    try {
        const whatsappService = require('./whatsappService');
        const result = await whatsappService.sendTemplateMessage({
            phone: vendor.phone,
            templateId: VENDOR_REMINDER_TEMPLATE_ID,
            variables: {
                1: vendor.store_name || vendor.name || 'شريكنا العزيز',
                2: packageName,
                3: arabicDaysPhrase(daysBeforeExpiry),
                4: arabicDate(expiresAt),
            },
            campaignName: `Subscription reminder (${daysBeforeExpiry}d) — ${vendor.store_name || vendor._id}`,
            recipientName: vendor.store_name || vendor.name,
        });
        return { sent: true, campaignId: result?.campaignId || null, skipped: result?.skipped ? 'not_configured' : null };
    } catch (err) {
        const detail = err.details?.length ? ` [${err.details.join('; ')}]` : '';
        console.error(`[Subscription] WhatsApp reminder failed for vendor ${vendor?._id}: ${err.message}${detail}`);
        return { sent: false, error: err.message };
    }
};

/**
 * Send expiry reminders (called by the daily scheduled job).
 *
 * Fires an in-app notification and a WhatsApp message for every active
 * subscription expiring exactly `daysBeforeExpiry` days from now.
 */
const sendExpiryReminders = async (daysBeforeExpiry) => {
    const { VendorSubscription } = require('../models/vendorSubscriptions');

    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + daysBeforeExpiry);

    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const expiringSubs = await VendorSubscription.find({
        status: 'active',
        expires_at: { $gte: startOfDay, $lte: endOfDay },
        // Skip any this threshold has already reminded, so re-running the sweep
        // on the same day cannot message a vendor twice.
        expiry_reminders_sent: { $ne: daysBeforeExpiry },
    })
        // `phone` is required to reach the vendor on WhatsApp, and `package_id`
        // must be populated or the package name renders as "Unknown".
        .populate('vendor_id', 'email name store_name phone')
        .populate('package_id', 'name name_ar')
        .lean();

    let notified = 0;
    let messaged = 0;

    for (const sub of expiringSubs) {
        if (!sub.vendor_id) continue;

        const packageNameEn = sub.package_id?.name || 'Unknown';
        // The WhatsApp template is Arabic, so prefer the Arabic package name.
        const packageNameAr = sub.package_id?.name_ar || sub.package_id?.name || 'باقتك';

        await sendSubscriptionNotification(sub.vendor_id._id, 'subscription_expiring_soon', {
            packageName: packageNameEn,
            packageNameAr,
            daysUntilExpiry: daysBeforeExpiry,
            expiresAt: sub.expires_at,
        });
        notified += 1;

        const outcome = await sendExpiryWhatsapp({
            vendor: sub.vendor_id,
            packageName: packageNameAr,
            daysBeforeExpiry,
            expiresAt: sub.expires_at,
        });
        if (outcome.sent) messaged += 1;

        // Record the attempt regardless of the WhatsApp outcome: the in-app
        // notification already fired, and retrying the whole reminder tomorrow
        // would land on the wrong day-threshold anyway.
        await VendorSubscription.updateOne(
            { _id: sub._id },
            { $addToSet: { expiry_reminders_sent: daysBeforeExpiry } }
        );
    }

    return { sent: notified, whatsapp_sent: messaged };
};

/* ------------------------------------------------------------------ */
/* Vendor new order — WhatsApp                                         */
/* ------------------------------------------------------------------ */

/**
 * EverySecond template `readycar_invitation` (UTILITY, ar, dynamic url button):
 *
 *     مرحباً 👋
 *     {{1}} {{2}}.
 *     اضغط الزر تحت تشوف التفاصيل وترد.
 *
 * Borrowed rather than purpose-built: its body is two free-text slots and a
 * button whose URL is supplied per message, which is everything a "you have a
 * new order, open it" message needs — and a new template would have to wait on
 * Meta's approval. Override to point at a dedicated one once it exists; it must
 * keep the same shape (two variables, dynamic url button).
 */
const VENDOR_ORDER_TEMPLATE_ID = Number(process.env.WHATSAPP_VENDOR_ORDER_TEMPLATE_ID || 47);

const getFrontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

/** The vendor's page for one parcel — where they review and confirm it. */
const vendorParcelPath = (orderId, subOrderId) => (
    orderId && subOrderId ? `/dashboard/orders/${orderId}/parcels/${subOrderId}` : '/dashboard/orders'
);

/**
 * WhatsApp a vendor that an order is waiting for them, with a button that opens it.
 *
 * `headline` and `detail` fill the template's two slots and read as one sentence
 * (the template adds the full stop). `path` is the dashboard page the button opens.
 *
 * Fail-safe: never throws. The in-app notification is the record that the vendor
 * was told; this is the nudge that reaches them when the dashboard is closed, so
 * losing it must not cost the order anything.
 */
const sendVendorOrderWhatsapp = async ({ vendorId, headline, detail, path, campaignName }) => {
    try {
        const { Seller } = require('../models/sellers');
        const vendor = await Seller.findById(vendorId).select('phone name store_name').lean();
        if (!vendor?.phone) return { skipped: 'no_phone' };

        const whatsappService = require('./whatsappService');
        const result = await whatsappService.sendTemplateMessage({
            phone: vendor.phone,
            templateId: VENDOR_ORDER_TEMPLATE_ID,
            variables: { 1: headline, 2: detail },
            // The provider only accepts a complete public URL here, and the template's
            // base gets prepended to it on delivery — `frontend/src/middleware.js`
            // forwards that shape to the real page. See `shared/guestInvites.js`.
            buttonUrl: `${getFrontendUrl()}${path || '/dashboard/orders'}`,
            campaignName,
            recipientName: vendor.store_name || vendor.name,
        });
        if (result?.skipped) return { skipped: 'not_configured' };
        return { sent: true, campaignId: result?.campaignId || null };
    } catch (err) {
        const detailText = err.details?.length ? ` [${err.details.join('; ')}]` : '';
        console.error(`[WhatsApp] New-order message failed for vendor ${vendorId}: ${err.message}${detailText}`);
        return { sent: false, error: err.message };
    }
};

/**
 * The new-order message for one vendor's share of an order.
 *
 * `subOrders` are the vendor's parcels being announced now. One parcel opens its
 * own page; a vendor with several in the same order (two branches) lands on the
 * orders list, where all of them are waiting.
 */
const sendNewOrderWhatsapp = async ({ vendorId, order, subOrders = [] }) => {
    // Callers fire this without awaiting it, so nothing here may reject.
    try {
        return await sendVendorOrderWhatsapp(buildNewOrderMessage({ vendorId, order, subOrders }));
    } catch (err) {
        console.error(`[WhatsApp] Could not build the new-order message for vendor ${vendorId}: ${err.message}`);
        return { sent: false, error: err.message };
    }
};

const buildNewOrderMessage = ({ vendorId, order, subOrders }) => {
    const subIds = new Set(subOrders.map((s) => String(s._id)));
    const items = (order.items || []).filter((i) => (
        subIds.size > 0
            ? subIds.has(String(i.sub_order_id))
            : String(i.vendor_id?._id || i.vendor_id) === String(vendorId)
    ));
    const itemsSummary = items
        .map((i) => {
            const label = i.variant_label && i.variant_label !== 'Default' ? ` (${i.variant_label})` : '';
            return `${i.product_title}${label} x${i.quantity}`;
        })
        .join('، ');
    const total = Math.round(
        subOrders.length > 0
            ? subOrders.reduce((sum, s) => sum + Number(s.merchandise_total || 0), 0)
            : items.reduce((sum, i) => sum + Number(i.unit_price || 0) * Number(i.quantity || 0), 0)
    );

    const single = subOrders.length === 1 ? subOrders[0] : null;
    const reference = single?.reference || order.transaction?.reference || String(order._id);

    return {
        vendorId,
        headline: `وصلك أوردر جديد رقم #${reference} على ReadyCar`,
        detail: `فيه: ${itemsSummary || 'منتجات من متجرك'} — بإجمالي ${total} ج.م، ومستني تأكيدك`,
        path: single ? vendorParcelPath(order._id, single._id) : '/dashboard/orders',
        campaignName: `Vendor new order #${reference}`,
    };
};

module.exports = {
    sendSubscriptionNotification,
    sendExpiryReminders,
    sendExpiryWhatsapp,
    sendVendorOrderWhatsapp,
    sendNewOrderWhatsapp,
    buildNewOrderMessage,
    vendorParcelPath,
    VENDOR_ORDER_TEMPLATE_ID,
    arabicDaysPhrase,
    arabicDate,
    VENDOR_REMINDER_TEMPLATE_ID,
};
