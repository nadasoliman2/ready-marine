const mongoose = require('mongoose');
const { Schema } = mongoose;

const notificationSchema = new Schema(
    {
        vendor_id: {
            type: Schema.Types.ObjectId,
            ref: 'Seller',
            required: true,
            index: true,
        },
        type: {
            type: String,
            required: true,
            enum: [
                'subscription_activated',
                'trial_activated',
                'subscription_expiring_soon',
                'subscription_expired',
                'subscription_cancelled',
                'account_became_not_subscribed',
                'account_suspended',
                'account_reactivated',
                'product_visibility_restored',
                'renewal_successful',
                'product_limit_warning',
                // Products the admin approved, with what was corrected on them (data.fixes).
                'products_published',
                'new_order_received',
                // A company consolidation batch closed: several orders, one combined parcel.
                'company_batch_received',
                // To the admins: a company uploaded a transfer receipt, or an invoice is late.
                'company_receipt_uploaded',
                'company_cap_alert',
                'company_invoice_overdue',
                'return_request_received',
                'return_admin_approved',
                'return_admin_rejected',
                'return_shipment_created',
                'return_received_by_vendor',
                'refund_processing',
                'refund_completed',
                'earnings_available',
                'earnings_clawback',
                'withdrawal_approved',
                'withdrawal_rejected',
                'withdrawal_paid',
                'ad_approved',
                'ad_rejected',
                // Parcel deadline chasers. These were being SENT but not listed, so the
                // model rejected every one and the callers' try/catch swallowed it — the
                // vendor and admin reminders about a late parcel never actually arrived.
                'sub_order_needs_admin',
                // A parcel the vendor was preparing, or had sealed and offered for pickup,
                // was cancelled by the customer or the website team.
                'sub_order_cancelled',
                'courier_transferred',
                'sub_order_overdue',
                'sub_order_deadline_soon',
                // When a courier is booked, and the day and time slot it is booked for.
                // A vendor who does not know the appointment cannot be at the branch for it.
                'pickup_scheduled',
                // Packaging and label orders.
                'supply_order_placed',
                'supply_order_approved',
                'supply_order_rejected',
                'supply_order_sent',
                'supply_order_delivered',
                // Prepaid Bosta bundle: running low, about to expire with parcels still on
                // it, or finished — the last one stops shipping entirely.
                'bosta_bundle_low',
                'bosta_bundle_expiring',
                'bosta_bundle_depleted',
                // Vendor payouts. `payout_paid` was being SENT by the admin Pay button
                // long before it was listed here, so every one of those notices was
                // rejected by the model and never reached the vendor.
                'payout_paid',
                'payout_processing',
                'payout_failed',
                'payout_method_changed',
                'earning_frozen',
                'earning_unfrozen',
                'payouts_paused',
                'payouts_resumed',
            ],
            index: true,
        },
        title: {
            type: String,
            required: true,
        },
        message: {
            type: String,
            required: true,
        },
        data: {
            type: Schema.Types.Mixed,
            default: {},
        },
        read: {
            type: Boolean,
            default: false,
            index: true,
        },
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
    }
);

notificationSchema.index({ vendor_id: 1, read: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);

const createNotification = async (vendorId, type, title, message, data = {}) => {
    return await Notification.create({
        vendor_id: vendorId,
        type,
        title,
        message,
        data,
    });
};

const getNotificationsForVendor = async (vendorId, { page = 1, limit = 20, read } = {}) => {
    const filter = { vendor_id: vendorId };
    if (read !== undefined) filter.read = read;

    const total = await Notification.countDocuments(filter);
    const notifications = await Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((Math.max(1, Number(page)) - 1) * Number(limit))
        .limit(Number(limit))
        .lean();

    return {
        notifications,
        pagination: {
            total,
            page: Number(page),
            pages: Math.ceil(total / Number(limit)),
            limit: Number(limit),
        },
    };
};

const markAsRead = async (notificationId, vendorId) => {
    return await Notification.findOneAndUpdate(
        { _id: notificationId, vendor_id: vendorId },
        { read: true },
        { returnDocument: "after" }
    );
};

const markAllAsRead = async (vendorId) => {
    return await Notification.updateMany(
        { vendor_id: vendorId, read: false },
        { read: true }
    );
};

const getUnreadCount = async (vendorId) => {
    return await Notification.countDocuments({ vendor_id: vendorId, read: false });
};

const deleteNotification = async (notificationId, vendorId) => {
    return await Notification.findOneAndDelete({ _id: notificationId, vendor_id: vendorId });
};

const deleteAllNotifications = async (vendorId) => {
    return await Notification.deleteMany({ vendor_id: vendorId });
};

module.exports = {
    Notification,
    createNotification,
    getNotificationsForVendor,
    markAsRead,
    markAllAsRead,
    getUnreadCount,
    deleteNotification,
    deleteAllNotifications,
};
