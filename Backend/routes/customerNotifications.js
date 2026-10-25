/**
 * Customer Notifications Router — the in-app inbox behind the storefront bell.
 * Mounted at /api/users/notifications. Separate from the vendor notification
 * router so the two audiences never share an inbox or an unread count.
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
    getNotificationsForUser,
    getUnreadCountForUser,
    markNotificationRead,
    markAllNotificationsRead,
} = require('../services/customerNotificationService');

/** Render language: explicit query wins, otherwise the account preference. */
const resolveLanguage = (req) => {
    if (req.query.language === 'ar' || req.query.language === 'en') return req.query.language;
    return req.user?.preferred_language === 'ar' ? 'ar' : 'en';
};

/**
 * @desc    List the caller's notifications
 * @route   GET /api/users/notifications
 */
router.get('/', protect('user'), async (req, res) => {
    try {
        const result = await getNotificationsForUser(req.user._id, {
            page: req.query.page,
            limit: req.query.limit,
            read: req.query.read === undefined ? undefined : req.query.read === 'true',
            language: resolveLanguage(req),
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Unread badge count
 * @route   GET /api/users/notifications/count
 */
router.get('/count', protect('user'), async (req, res) => {
    try {
        res.json({ count: await getUnreadCountForUser(req.user._id) });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Mark one notification read
 * @route   PUT /api/users/notifications/:id/read
 */
router.put('/:id/read', protect('user'), async (req, res) => {
    try {
        const notification = await markNotificationRead(req.params.id, req.user._id);
        if (!notification) return res.status(404).json({ message: 'Notification not found' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Mark every notification read
 * @route   PUT /api/users/notifications/read-all
 */
router.put('/read-all', protect('user'), async (req, res) => {
    try {
        await markAllNotificationsRead(req.user._id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
