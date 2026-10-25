/**
 * Vendor Notifications Router
 * In-app notification management for vendors.
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
    getNotificationsForVendor,
    markAsRead,
    markAllAsRead,
    getUnreadCount,
    deleteNotification,
} = require('../models/notifications');

/**
 * Get vendor's notifications
 * @route   GET /api/vendors/notifications
 * @access  Private (Vendor)
 */
router.get('/', protect('vendor'), async (req, res) => {
    try {
        const { page = 1, limit = 20, read } = req.query;
        const readFilter = read !== undefined ? read === 'true' : undefined;
        const result = await getNotificationsForVendor(req.user._id, {
            page: Number(page),
            limit: Number(limit),
            read: readFilter,
        });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Get unread notification count
 * @route   GET /api/vendors/notifications/count
 * @access  Private (Vendor)
 */
router.get('/count', protect('vendor'), async (req, res) => {
    try {
        const count = await getUnreadCount(req.user._id);
        res.json({ success: true, unreadCount: count });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Mark a single notification as read
 * @route   PUT /api/vendors/notifications/:id/read
 * @access  Private (Vendor)
 */
router.put('/:id/read', protect('vendor'), async (req, res) => {
    try {
        const notification = await markAsRead(req.params.id, req.user._id);
        if (!notification) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }
        res.json({ success: true, notification });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Mark all notifications as read
 * @route   PUT /api/vendors/notifications/read-all
 * @access  Private (Vendor)
 */
router.put('/read-all', protect('vendor'), async (req, res) => {
    try {
        await markAllAsRead(req.user._id);
        res.json({ success: true, message: 'All notifications marked as read' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * Delete a notification
 * @route   DELETE /api/vendors/notifications/:id
 * @access  Private (Vendor)
 */
router.delete('/:id', protect('vendor'), async (req, res) => {
    try {
        const result = await deleteNotification(req.params.id, req.user._id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }
        res.json({ success: true, message: 'Notification deleted' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;