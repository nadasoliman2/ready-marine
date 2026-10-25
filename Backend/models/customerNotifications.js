const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * CustomerNotification — in-app notifications for CUSTOMER accounts.
 * Mirrors the vendor `Notification` model but keyed on `user_id`, so the two
 * audiences never share an inbox or an unread count.
 *
 * Titles/messages are stored bilingually and rendered from the recipient's
 * preferred language, not the sender's current browser language.
 */
const CUSTOMER_NOTIFICATION_TYPES = [
    'family_invitation_accepted',
    'family_invitation_declined',
    'family_member_removed',
    'family_member_left',
    'family_address_access_changed',
    'family_order_request_received',
    'family_order_request_approved',
    'family_order_request_declined',
    'family_order_request_withdrawn',
    'family_order_request_expiring',
    'family_order_request_expired',
    'family_order_payment_needed',
    'family_order_payment_failed',
    'family_order_placed',

    // ---- Friends ----
    'friend_invitation_received',
    'friend_invitation_accepted',
    'friend_invitation_declined',
    'friendship_removed',
    'friend_address_access_changed',
    'friend_order_paid',
    'friend_order_created',
    'friend_order_payment_failed',

    // ---- Loyalty ----
    'loyalty_points_available',
    'loyalty_points_adjusted',

    // ---- Wallet (store credit) ----
    // Money moving is the one thing a customer always wants told to them, so
    // every credit that did not originate from their own tap has a type here.
    'wallet_topped_up',
    'wallet_refund_credited',
    'wallet_order_paid',
    'wallet_order_refunded',
    'wallet_adjusted',
    'wallet_status_changed',

    // ---- Parcels ----
    // These two were being sent by subOrderSweepService long before they were listed here,
    // so every one of them failed the enum on save and was swallowed by the caller's
    // try/catch: no customer has ever received an out-for-delivery or delivered notice.
    'sub_order_out_for_delivery',
    'sub_order_delivered',
    'sub_order_cancelled',
    'sub_order_reactivated',

    // ---- Corporate accounts ----
    // To the company's managers: someone answered an invitation, or left.
    'company_invitation_accepted',
    'company_invitation_declined',
    'company_member_left',
    // To the person: the company removed them, or changed what they can do.
    'company_member_removed',
    'company_role_changed',
    // The manager paused or resumed the person's ordering on the company account.
    'company_member_deactivated',
    'company_member_reactivated',
    // Consolidation (phase 3): the person's waiting order left its batch for the
    // vendor, with what they saved on shipping.
    'company_batch_released',
    // Invoices (phase 4), to the company's managers.
    'company_invoice_issued',
    // An invoice issued by mistake was taken back (scripts/withdrawCompanyInvoice.js).
    'company_invoice_withdrawn',
    'company_cap_alert',
    'company_contract_ended',
    'company_refund_sent',
    'company_invoice_reminder',
    'company_invoice_overdue',
    'company_payment_recorded',
    'company_payment_rejected',
    'company_suspended',
    'company_billing_mode_changed',
    'company_reactivated',
];

const customerNotificationSchema = new Schema(
    {
        user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        type: { type: String, required: true, enum: CUSTOMER_NOTIFICATION_TYPES, index: true },
        title_en: { type: String, required: true },
        title_ar: { type: String, required: true },
        message_en: { type: String, default: '' },
        message_ar: { type: String, default: '' },
        // Deep link (frontend path) the bell entry should open.
        link: { type: String, default: '' },
        // Never store full address text here — notification previews stay minimal.
        data: { type: Schema.Types.Mixed, default: {} },
        read: { type: Boolean, default: false, index: true },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);

customerNotificationSchema.index({ user_id: 1, read: 1, createdAt: -1 });

const CustomerNotification = mongoose.model('CustomerNotification', customerNotificationSchema);

module.exports = { CustomerNotification, CUSTOMER_NOTIFICATION_TYPES };
