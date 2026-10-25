const { CustomerNotification } = require('../models/customerNotifications');

/**
 * Create an in-app notification for a CUSTOMER account.
 *
 * Copy is stored bilingually and picked at render time from the recipient's
 * `preferred_language`, so a notification never inherits the sender's locale.
 * Never fails the caller — a notification is never worth breaking a purchase.
 */
const notifyCustomer = async (userId, type, copy = {}, { link = '', data = {} } = {}) => {
    if (!userId) return null;
    try {
        return await CustomerNotification.create({
            user_id: userId,
            type,
            title_en: copy.title_en || '',
            title_ar: copy.title_ar || copy.title_en || '',
            message_en: copy.message_en || '',
            message_ar: copy.message_ar || copy.message_en || '',
            link,
            data,
        });
    } catch (err) {
        console.error(`[CustomerNotification] failed to create "${type}":`, err.message);
        return null;
    }
};

/** Localize a stored notification for one recipient language. */
const localizeNotification = (notification, language = 'en') => {
    const isAr = language === 'ar';
    const plain = notification.toObject?.() || notification;
    return {
        _id: plain._id,
        type: plain.type,
        title: (isAr ? plain.title_ar : plain.title_en) || plain.title_en,
        message: (isAr ? plain.message_ar : plain.message_en) || plain.message_en,
        link: plain.link || '',
        data: plain.data || {},
        read: !!plain.read,
        createdAt: plain.createdAt,
    };
};

const getNotificationsForUser = async (userId, { page = 1, limit = 20, read, language = 'en' } = {}) => {
    const filter = { user_id: userId };
    if (read !== undefined) filter.read = read;

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));

    const [total, notifications] = await Promise.all([
        CustomerNotification.countDocuments(filter),
        CustomerNotification.find(filter)
            .sort({ createdAt: -1 })
            .skip((safePage - 1) * safeLimit)
            .limit(safeLimit)
            .lean(),
    ]);

    return {
        notifications: notifications.map((n) => localizeNotification(n, language)),
        pagination: {
            total,
            page: safePage,
            limit: safeLimit,
            pages: Math.ceil(total / safeLimit),
        },
    };
};

const getUnreadCountForUser = async (userId) => {
    return await CustomerNotification.countDocuments({ user_id: userId, read: false });
};

const markNotificationRead = async (notificationId, userId) => {
    return await CustomerNotification.findOneAndUpdate(
        { _id: notificationId, user_id: userId },
        { read: true },
        { returnDocument: 'after' }
    );
};

const markAllNotificationsRead = async (userId) => {
    return await CustomerNotification.updateMany({ user_id: userId, read: false }, { read: true });
};

module.exports = {
    notifyCustomer,
    localizeNotification,
    getNotificationsForUser,
    getUnreadCountForUser,
    markNotificationRead,
    markAllNotificationsRead,
};
