const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const reports = require('../services/customerReportsService');
const abandonedCart = require('../services/abandonedCartService');
const { SiteSettings } = require('../models/site_settings');
const { recordAuditLog } = require('../models/auditLog');

/**
 * Admin reports on customers' accounts (services/customerReportsService.js).
 *
 * Mounted at /api/admin/users/reports — ahead of the main admin router, whose
 * `/users/:id` would otherwise take "reports" for a customer id — so the path puts these
 * under the Customers permission (services/adminAccessService.js): an admin who may see the
 * customers may see what is in their carts and garages.
 */
const router = express.Router();

const sendWorkbook = async (res, { workbook, filename }) => {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
};

/**
 * @desc    Products in customers' carts: one row per cart line, with the vendor, the customer
 *          and their governorate
 * @route   GET /api/admin/users/reports/carts?search=&vendor_id=
 */
router.get('/carts', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await reports.buildCartReport(req.query)) });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    The same report as an Excel file
 * @route   GET /api/admin/users/reports/carts/export (same query)
 */
router.get('/carts/export', protect('admin'), async (req, res) => {
    try {
        await sendWorkbook(res, await reports.buildCartReportWorkbook(req.query));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Abandoned-cart reminder emails, newest first, with the order (if any) that followed
 * @route   GET /api/admin/users/reports/cart-reminders?search=&status=sent|failed
 */
router.get('/cart-reminders', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await reports.buildCartReminderReport(req.query)) });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    The same report as an Excel file
 * @route   GET /api/admin/users/reports/cart-reminders/export (same query)
 */
router.get('/cart-reminders/export', protect('admin'), async (req, res) => {
    try {
        await sendWorkbook(res, await reports.buildCartReminderReportWorkbook(req.query));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    The reminder schedule: on/off, the daily send time, the idle hours, the next and
 *          last run
 * @route   GET /api/admin/users/reports/cart-reminders/settings
 */
router.get('/cart-reminders/settings', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, settings: await abandonedCart.getScheduleSettings() });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Change the schedule: { enabled, send_time 'HH:MM', inactivity_hours }. Applies at
 *          once — no restart.
 * @route   PUT /api/admin/users/reports/cart-reminders/settings
 */
router.put('/cart-reminders/settings', protect('admin'), async (req, res) => {
    try {
        const { before, after } = await abandonedCart.updateScheduleSettings(req.body || {});
        const doc = await SiteSettings.findOne().select('_id').lean();
        await recordAuditLog({
            action: 'abandoned_cart_schedule_updated',
            actor: { role: 'admin', label: req.user?.username || 'Admin' },
            target_type: 'site_settings',
            target_id: doc._id,
            impact: {
                before: { enabled: before.enabled, send_time: before.send_time, inactivity_hours: before.inactivity_hours },
                after: { enabled: after.enabled, send_time: after.send_time, inactivity_hours: after.inactivity_hours },
            },
        }).catch((err) => console.error(`[AbandonedCart] Audit log failed: ${err.message}`));
        res.json({ success: true, settings: after });
    } catch (error) {
        res.status(error.code === 'INVALID' ? 400 : 500).json({ message: error.message });
    }
});

/**
 * @desc    One reminder email as the customer received it: { to, sent_at, status, subject, html }
 * @route   GET /api/admin/users/reports/cart-reminders/:id/preview
 */
router.get('/cart-reminders/:id/preview', protect('admin'), async (req, res) => {
    try {
        const preview = await reports.buildCartReminderPreview(req.params.id);
        if (!preview) return res.status(404).json({ message: 'Email not found' });
        res.json({ success: true, ...preview });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    Customers' cars, grouped by make: model, year, the customer, their governorate,
 *          company and sign-up date
 * @route   GET /api/admin/users/reports/cars?search=&brand=
 */
router.get('/cars', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await reports.buildCarsReport(req.query)) });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @desc    The same report as an Excel file, a header line per make
 * @route   GET /api/admin/users/reports/cars/export (same query)
 */
router.get('/cars/export', protect('admin'), async (req, res) => {
    try {
        await sendWorkbook(res, await reports.buildCarsReportWorkbook(req.query));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
