const mongoose = require('mongoose');
const { SiteSettings } = require('../../models/site_settings');
const { User } = require('../../models/users');
const { LoyaltyAccount } = require('../../models/loyaltyAccounts');
const { LoyaltyTransaction } = require('../../models/loyaltyTransactions');
const { recordAuditLog, AuditLog } = require('../../models/auditLog');
const loyaltyService = require('./loyalty.service');
const {
    getLoyaltySettings,
    validateSettingsPatch,
    getTransactionHistory,
    adminAdjustPoints,
    getBalances,
    getCustomerWallet,
    DEFAULT_LOYALTY_SETTINGS,
} = loyaltyService;
const { notifyCustomer } = require('../notification/customer_notification.service');

const getAdminActor = (req) => ({
    role: 'admin',
    label: req.user?.username || 'Admin',
});

const round2 = (n) => Number((Number(n) || 0).toFixed(2));

/**
 * Customer: GET /api/users/loyalty
 */
const getMyWallet = async (req, res) => {
    try {
        const wallet = await getCustomerWallet(req.user._id);
        res.json({ success: true, ...wallet });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * Customer: GET /api/users/loyalty/transactions
 */
const getMyTransactions = async (req, res) => {
    try {
        const { page, limit, type } = req.query;
        const result = await getTransactionHistory(req.user._id, { page, limit, type });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * Admin: GET /api/admin/loyalty/settings
 */
const getSettings = async (req, res) => {
    try {
        const settings = await getLoyaltySettings();
        res.json({ success: true, settings });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * Admin: PUT /api/admin/loyalty/settings
 */
const updateSettings = async (req, res) => {
    try {
        const patch = validateSettingsPatch(req.body || {});
        if (Object.keys(patch).length === 0) {
            return res.status(400).json({ success: false, message: 'No loyalty settings were provided' });
        }

        let doc = await SiteSettings.findOne();
        if (!doc) doc = new SiteSettings();

        const before = { ...DEFAULT_LOYALTY_SETTINGS, ...(doc.loyalty ? doc.loyalty.toObject?.() || doc.loyalty : {}) };

        doc.loyalty = { ...before, ...patch };
        if (patch.enabled === true && !before.activated_at) {
            doc.loyalty.activated_at = new Date();
        }
        await doc.save();

        const after = await getLoyaltySettings();

        const changed = Object.keys(patch).filter((key) => String(before[key]) !== String(patch[key]));
        await recordAuditLog({
            action: 'loyalty_settings_updated',
            actor: getAdminActor(req),
            target_type: 'loyalty_settings',
            target_id: doc._id,
            target_snapshot: { before, after: doc.loyalty },
            impact: { changed_fields: changed },
        });

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
};

/**
 * Admin: GET /api/admin/loyalty/stats
 */
const getStats = async (req, res) => {
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
                    lifetime_spent: { $sum: '$lifetime_spent_points' },
                },
            },
        ]);

        const settings = await getLoyaltySettings();
        const available = Number(balances?.available || 0);
        const pending = Number(balances?.pending || 0);

        res.json({
            success: true,
            stats: {
                total_accounts: Number(balances?.accounts || 0),
                total_available_points: available,
                total_pending_points: pending,
                total_reserved_points: Number(balances?.reserved || 0),
                lifetime_earned_points: Number(balances?.lifetime_earned || 0),
                lifetime_spent_points: Number(balances?.lifetime_spent || 0),
                outstanding_liability: round2((available + pending) * Number(settings.point_value)),
                currency: settings.currency,
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
/**
 * @desc    Search customer balances
 * @route   GET /api/admin/loyalty/accounts
 */
const getAcccounts = async(req,res)=>{
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
            success: true,accounts: accounts.map((a) => ({
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
}
/**
 * Admin: GET /api/admin/loyalty/accounts/:userId
 */
const getCustomerAccount = async (req, res) => {
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
};

/**
 * Admin: POST /api/admin/loyalty/accounts/:userId/adjust
 */
const adjustCustomerPoints = async (req, res) => {
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
};

/**
 * Admin: GET /api/admin/loyalty/audit
 */
const getAuditLogs = async (req, res) => {
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
};

module.exports = {
    getMyWallet,
    getMyTransactions,
    getSettings,
    updateSettings,
    getStats,
    getCustomerAccount,
    adjustCustomerPoints,
    getAuditLogs,
    getAcccounts
};
