const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/authMiddleware');
const { SiteSettings } = require('../models/site_settings');
const { User } = require('../models/users');
const { LoyaltyAccount } = require('../models/loyaltyAccounts');
const { LoyaltyTransaction } = require('../models/loyaltyTransactions');
const { recordAuditLog, AuditLog } = require('../models/auditLog');
const {
    getLoyaltySettings,
    validateSettingsPatch,
    getTransactionHistory,
    adminAdjustPoints,
    getBalances,
    DEFAULT_LOYALTY_SETTINGS,
} = require('../services/loyaltyService');
const { notifyCustomer } = require('../services/customerNotificationService');

const getAdminActor = (req) => ({
    role: 'admin',
    label: req.user?.username || 'Admin',
});

const round2 = (n) => Number((Number(n) || 0).toFixed(2));

/**
 * @desc    Read the loyalty configuration
 * @route   GET /api/admin/loyalty/settings
 */
router.get('/settings', protect('admin'), async (req, res) => {
    try {
        const settings = await getLoyaltySettings();
        res.json({ success: true, settings });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Update the loyalty configuration
 * @route   PUT /api/admin/loyalty/settings
 *
 * Two things are deliberate here. Changing `point_value` re-values EVERY
 * existing balance (the customer keeps their points, those points are worth
 * something different) — the response reports the impact so the UI can warn
 * before and confirm after. And nothing here rewrites history: past
 * transactions keep the snapshot they were computed with.
 */
router.put('/settings', protect('admin'), async (req, res) => {
    try {
        const patch = validateSettingsPatch(req.body || {});
        if (Object.keys(patch).length === 0) {
            return res.status(400).json({ success: false, message: 'No loyalty settings were provided' });
        }

        let doc = await SiteSettings.findOne();
        if (!doc) doc = new SiteSettings();

        const before = { ...DEFAULT_LOYALTY_SETTINGS, ...(doc.loyalty ? doc.loyalty.toObject?.() || doc.loyalty : {}) };

        doc.loyalty = { ...before, ...patch };
        // Stamp the go-live moment the first time the program is switched on.
        // It is the cut-off that makes "no retroactive points" enforceable.
        if (patch.enabled === true && !before.activated_at) {
            doc.loyalty.activated_at = new Date();
        }
        await doc.save();

        const after = await getLoyaltySettings();

        // Every settings change is audit logged, including who and what moved.
        const changed = Object.keys(patch).filter((key) => String(before[key]) !== String(patch[key]));
        await recordAuditLog({
            action: 'loyalty_settings_updated',
            actor: getAdminActor(req),
            target_type: 'loyalty_settings',
            target_id: doc._id,
            target_snapshot: { before, after: doc.loyalty },
            impact: { changed_fields: changed },
        });

        // Quantify the re-valuation so the admin sees what they just did to
        // outstanding balances rather than only to a config field.
        let revaluation = null;
        if (patch.point_value !== undefined && Number(before.point_value) !== Number(patch.point_value)) {
            const [totals] = await LoyaltyAccount.aggregate([
                { $group: { _id: null, available: { $sum: '$available_points' }, pending: { $sum: '$pending_points' } } },
            ]);
            const points = Number(totals?.available || 0) + Number(totals?.pending || 0);
            revaluation = {
                outstanding_points: points,
                value_before: round2(points * Number(before.point_value)),
                value_after: round2(points * Number(patch.point_value)),
            };
        }

        res.json({ success: true, settings: after, changed_fields: changed, revaluation });
    } catch (err) {
        const status = err.code === 'INVALID_LOYALTY_SETTINGS' ? 400 : 500;
        res.status(status).json({ success: false, code: err.code, message: err.message });
    }
});

/**
 * @desc    Program-wide totals for the admin overview
 * @route   GET /api/admin/loyalty/stats
 */
router.get('/stats', protect('admin'), async (req, res) => {
    try {
        const [balances] = await LoyaltyAccount.aggregate([
            {
                $group: {
                    _id: null,
                    accounts: { $sum: 1 },
                    available: { $sum: '$available_points' },
                    pending: { $sum: '$pending_points' },
                    reserved: { $sum: '$reserved_points' },
                    lifetime_earned: { $sum: '$lifetime_earned_points' },
                    lifetime_redeemed: { $sum: '$lifetime_redeemed_points' },
                },
            },
        ]);

        const byType = await LoyaltyTransaction.aggregate([
            { $group: { _id: '$type', count: { $sum: 1 }, points: { $sum: '$points' } } },
        ]);

        const settings = await getLoyaltySettings();
        const outstanding = Number(balances?.available || 0) + Number(balances?.pending || 0);

        res.json({
            success: true,
            stats: {
                accounts: balances?.accounts || 0,
                available_points: balances?.available || 0,
                pending_points: balances?.pending || 0,
                reserved_points: balances?.reserved || 0,
                lifetime_earned_points: balances?.lifetime_earned || 0,
                lifetime_redeemed_points: balances?.lifetime_redeemed || 0,
                // The company's outstanding liability at today's rate.
                outstanding_value: round2(outstanding * Number(settings.point_value)),
                currency: settings.currency,
                by_type: byType.reduce((acc, row) => {
                    acc[row._id] = { count: row.count, points: row.points };
                    return acc;
                }, {}),
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Search customer balances
 * @route   GET /api/admin/loyalty/accounts
 */
router.get('/accounts', protect('admin'), async (req, res) => {
    try {
        const { q = '', page = 1, limit = 20, sort = 'available' } = req.query;
        const safePage = Math.max(1, Number(page) || 1);
        const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));

        const filter = {};
        const search = String(q).trim();
        if (search) {
            // Resolve the search against USERS first — an admin searches by the
            // person, not by an account id they have never seen.
            const users = await User.find({
                $or: [
                    { name: { $regex: search, $options: 'i' } },
                    { email: { $regex: search, $options: 'i' } },
                    { phone: { $regex: search, $options: 'i' } },
                ],
            }).select('_id').limit(500).lean();
            filter.user_id = { $in: users.map((u) => u._id) };
        }

        const sortMap = {
            available: { available_points: -1 },
            pending: { pending_points: -1 },
            earned: { lifetime_earned_points: -1 },
            redeemed: { lifetime_redeemed_points: -1 },
            recent: { updated_at: -1 },
        };

        const [total, accounts] = await Promise.all([
            LoyaltyAccount.countDocuments(filter),
            LoyaltyAccount.find(filter)
                .sort(sortMap[sort] || sortMap.available)
                .skip((safePage - 1) * safeLimit)
                .limit(safeLimit)
                .populate('user_id', 'name email phone')
                .lean(),
        ]);

        const settings = await getLoyaltySettings();

        res.json({
            success: true,
            accounts: accounts.map((a) => ({
                _id: a._id,
                user: a.user_id
                    ? { _id: a.user_id._id, name: a.user_id.name, email: a.user_id.email, phone: a.user_id.phone }
                    : null,
                available_points: a.available_points,
                pending_points: a.pending_points,
                reserved_points: a.reserved_points,
                lifetime_earned_points: a.lifetime_earned_points,
                lifetime_redeemed_points: a.lifetime_redeemed_points,
                available_value: round2(a.available_points * Number(settings.point_value)),
                updated_at: a.updated_at,
            })),
            pagination: { total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) },
            currency: settings.currency,
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    One customer's account and ledger
 * @route   GET /api/admin/loyalty/accounts/:userId
 */
router.get('/accounts/:userId', protect('admin'), async (req, res) => {
    try {
        const { userId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: 'Invalid customer id' });
        }

        const [user, balances, history, settings] = await Promise.all([
            User.findById(userId).select('name email phone createdAt').lean(),
            getBalances(userId),
            getTransactionHistory(userId, { page: req.query.page, limit: req.query.limit || 50 }),
            getLoyaltySettings(),
        ]);

        if (!user) return res.status(404).json({ success: false, message: 'Customer not found' });

        res.json({
            success: true,
            customer: user,
            balances,
            value: {
                available: round2(balances.available_points * Number(settings.point_value)),
                pending: round2(balances.pending_points * Number(settings.point_value)),
                currency: settings.currency,
            },
            ...history,
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Manually credit or debit a customer
 * @route   POST /api/admin/loyalty/accounts/:userId/adjust
 *
 * There is no endpoint that sets a balance — an adjustment is an ordinary
 * ledger entry with a mandatory reason and a named admin, so it appears in the
 * customer's own history alongside everything else.
 */
router.post('/accounts/:userId/adjust', protect('admin'), async (req, res) => {
    try {
        const { userId } = req.params;
        const { points, reason, direction } = req.body || {};

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: 'Invalid customer id' });
        }
        const customer = await User.findById(userId).select('name email').lean();
        if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

        const actor = getAdminActor(req);
        const { transaction, before, after } = await adminAdjustPoints({
            userId,
            points,
            reason,
            direction,
            actor,
        });

        await recordAuditLog({
            action: direction === 'credit' ? 'loyalty_admin_credit' : 'loyalty_admin_debit',
            actor,
            target_type: 'loyalty_account',
            target_id: userId,
            target_snapshot: { customer: { name: customer.name, email: customer.email } },
            impact: {
                points: Number(points),
                reason: String(reason).trim(),
                transaction_id: transaction._id,
                balance_before: before,
                balance_after: after,
            },
        });

        const magnitude = Math.abs(Number(points));
        notifyCustomer(userId, 'loyalty_points_adjusted', {
            title_en: direction === 'credit' ? 'Points added to your account' : 'Points removed from your account',
            title_ar: direction === 'credit' ? 'تمت إضافة نقاط إلى حسابك' : 'تم خصم نقاط من حسابك',
            message_en: `${magnitude} point${magnitude === 1 ? '' : 's'} ${direction === 'credit' ? 'added' : 'removed'} by our support team. Reason: ${String(reason).trim()}`,
            message_ar: `${magnitude} نقطة ${direction === 'credit' ? 'تمت إضافتها' : 'تم خصمها'} من قِبل فريق الدعم. السبب: ${String(reason).trim()}`,
        }, { link: '/profile?tab=points', data: { points: magnitude, direction } });

        res.json({ success: true, transaction, before, after });
    } catch (err) {
        const status = ['INVALID_POINTS', 'REASON_REQUIRED', 'INVALID_DIRECTION'].includes(err.code) ? 400
            : err.code === 'INSUFFICIENT_POINTS' ? 409
            : 500;
        res.status(status).json({ success: false, code: err.code, message: err.message });
    }
});

/**
 * @desc    Audit trail of loyalty settings changes and manual adjustments
 * @route   GET /api/admin/loyalty/audit
 */
router.get('/audit', protect('admin'), async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
        const filter = { action: { $in: ['loyalty_settings_updated', 'loyalty_admin_credit', 'loyalty_admin_debit'] } };

        const [total, entries] = await Promise.all([
            AuditLog.countDocuments(filter),
            AuditLog.find(filter)
                .sort({ created_at: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
        ]);

        res.json({
            success: true,
            entries,
            pagination: { total, page, limit, pages: Math.ceil(total / limit) },
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
