const mongoose = require('mongoose');
const { User } = require('../../models/users');
const { WalletAccount } = require('../../models/walletAccounts');
const { WalletTransaction } = require('../../models/walletTransactions');
const { WalletTopup } = require('../../models/walletTopups');
const { SiteSettings } = require('../../models/site_settings');
const { recordAuditLog, AuditLog } = require('../../models/auditLog');
const walletService = require('./wallet.service');
const walletTopupService = require('./wallet_topup.service');
const { notifyCustomer } = require('../notification/customer_notification.service');

const getAdminActor = (req) => ({
    role: 'admin',
    label: req.user?.username || 'Admin',
});

const statusForCode = (code) => ({
    TOPUP_NOT_FOUND: 404,
    USER_NOT_FOUND: 404,
    TOPUP_REFERENCE_REQUIRED: 400,
    INVALID_AMOUNT: 400,
    TOPUP_DISABLED: 409,
    WALLET_FROZEN: 423,
    INSUFFICIENT_BALANCE: 402,
}[code] || 400);

/**
 * Customer: GET /api/users/wallet
 */
const getMyWallet = async (req, res) => {
    try {
        const wallet = await walletService.getCustomerWallet(req.user._id);
        res.json({ success: true, ...wallet });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * Customer: GET /api/users/wallet/transactions
 */
const getMyTransactions = async (req, res) => {
    try {
        const { page, limit, type } = req.query;
        const result = await walletService.getTransactionHistory(req.user._id, { page, limit, type });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * Customer: POST /api/users/wallet/topup/initiate
 */
const initiateTopup = async (req, res) => {
    try {
        const { amount, method } = req.body || {};
        const result = await walletTopupService.initiateTopup({
            userId: req.user._id,
            amount,
            method,
            userIp: req.ip,
        });
        res.json({ success: true, ...result });
    } catch (err) {
        const status = statusForCode(err.code);
        res.status(status).json({ success: false, code: err.code, message: err.message });
    }
};

/**
 * Customer: GET /api/users/wallet/topup/:reference/status
 */
const getTopupStatus = async (req, res) => {
    try {
        const result = await walletTopupService.getTopupStatus(req.params.reference, req.user._id);
        res.json({ success: true, ...result });
    } catch (err) {
        const status = statusForCode(err.code);
        res.status(status).json({ success: false, code: err.code, message: err.message });
    }
};

/**
 * Admin: GET /api/admin/wallet/settings
 */
const getSettings = async (req, res) => {
    try {
        const settings = await walletService.getWalletSettings();
        res.json({ success: true, settings });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * Admin: PUT /api/admin/wallet/settings
 */
const updateSettings = async (req, res) => {
    try {
        const patch = walletService.validateSettingsPatch(req.body || {});
        if (Object.keys(patch).length === 0) {
            return res.status(400).json({ success: false, message: 'No wallet settings were provided' });
        }

        let doc = await SiteSettings.findOne();
        if (!doc) doc = new SiteSettings();

        const before = { ...walletService.DEFAULT_WALLET_SETTINGS, ...(doc.wallet ? doc.wallet.toObject?.() || doc.wallet : {}) };
        doc.wallet = { ...before, ...patch };
        if (patch.enabled === true && !before.activated_at) {
            doc.wallet.activated_at = new Date();
        }
        await doc.save();

        const after = await walletService.getWalletSettings();
        const changed = Object.keys(patch).filter((key) => String(before[key]) !== String(patch[key]));

        await recordAuditLog({
            action: 'wallet_settings_updated',
            actor: getAdminActor(req),
            target_type: 'wallet_settings',
            target_id: doc._id,
            target_snapshot: { before, after: doc.wallet },
            impact: { changed_fields: changed },
        });

        res.json({ success: true, settings: after, changed_fields: changed });
    } catch (err) {
        const status = err.code === 'INVALID_WALLET_SETTINGS' ? 400 : 500;
        res.status(status).json({ success: false, code: err.code, message: err.message });
    }
};

/**
 * Admin: GET /api/admin/wallet/stats
 */
const getStats = async (req, res) => {
    try {
        const [totals] = await WalletAccount.aggregate([
            {
                $group: {
                    _id: null,
                    accounts: { $sum: 1 },
                    frozen: { $sum: { $cond: ['$is_frozen', 1, 0] } },
                    balance: { $sum: '$balance' },
                    lifetime_topups: { $sum: '$lifetime_topup_amount' },
                    lifetime_spent: { $sum: '$lifetime_spent_amount' },
                    lifetime_refunds: { $sum: '$lifetime_refund_amount' },
                },
            },
        ]);

        const settings = await walletService.getWalletSettings();
        res.json({
            success: true,
            stats: {
                total_accounts: Number(totals?.accounts || 0),
                frozen_accounts: Number(totals?.frozen || 0),
                outstanding_liability: walletService.toMajor(totals?.balance || 0),
                lifetime_topups: walletService.toMajor(totals?.lifetime_topups || 0),
                lifetime_spent: walletService.toMajor(totals?.lifetime_spent || 0),
                lifetime_refunds: walletService.toMajor(totals?.lifetime_refunds || 0),
                currency: settings.currency,
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

//admin/wallet/accounts
const getAllAccounts= async (req, res) => {
    try {
        const { q = '', page = 1, limit = 20, sort = 'available', status } = req.query;
        const safePage = Math.max(1, Number(page) || 1);
        const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));

        const filter = {};
        if (status && ['active', 'frozen'].includes(status)) filter.status = status;

        const search = String(q).trim();
        if (search) {
            // Resolve the search against USERS first — an admin searches for a
            // person, not for a wallet id they have never seen.
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
            available: { available_minor: -1 },
            topped_up: { lifetime_topped_up_minor: -1 },
            spent: { lifetime_spent_minor: -1 },
            recent: { updated_at: -1 },
        };
 const [total, accounts] = await Promise.all([
            WalletAccount.countDocuments(filter),
            WalletAccount.find(filter)
                .sort(sortMap[sort] || sortMap.available)
                .skip((safePage - 1) * safeLimit)
                .limit(safeLimit)
                .populate('user_id', 'name email phone')
                .lean(),
        ]);

        const settings = await walletService.getWalletSettings();

        res.json({
            success: true,
            accounts: accounts.map((a) => ({
                _id: a._id,
                user: a.user_id
                    ? { _id: a.user_id._id, name: a.user_id.name, email: a.user_id.email, phone: a.user_id.phone }
                    : null,
                available: toMajor(a.available_minor),
                reserved: toMajor(a.reserved_minor),
                lifetime_topped_up: toMajor(a.lifetime_topped_up_minor),
                lifetime_spent: toMajor(a.lifetime_spent_minor),
                lifetime_refunded: toMajor(a.lifetime_refunded_minor),
                status: a.status,
                frozen_reason: a.frozen_reason || '',
                updated_at: a.updated_at,
            })),
            pagination: { total, page: safePage, limit: safeLimit, pages: Math.max(1, Math.ceil(total / safeLimit)) },
            currency: settings.currency,
        });  } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
}
/**
 * Admin: GET /api/admin/wallet/accounts/:userId
 */
const getCustomerAccount = async (req, res) => {
    try {
        const { userId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: 'Invalid customer id' });
        }

        const [user, account, history, settings] = await Promise.all([
            User.findById(userId).select('name email phone createdAt').lean(),
            walletService.getAccount(userId),
            walletService.getTransactionHistory(userId, { page: req.query.page, limit: req.query.limit || 50 }),
            walletService.getWalletSettings(),
        ]);

        if (!user) return res.status(404).json({ success: false, message: 'Customer not found' });

        res.json({
            success: true,
            customer: user,
            balance: walletService.toMajor(account.balance),
            is_frozen: account.is_frozen,
            freeze_reason: account.freeze_reason,
            currency: settings.currency,
            ...history,
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * Admin: POST /api/admin/wallet/accounts/:userId/adjust
 */
const adjustCustomerBalance = async (req, res) => {
    try {
        const { userId } = req.params;
        const { amount, reason, direction } = req.body || {};

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: 'Invalid customer id' });
        }
        const customer = await User.findById(userId).select('name email').lean();
        if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

        const actor = getAdminActor(req);
        const { transaction, before, after } = await walletService.adminAdjustBalance({
            userId,
            amount,
            reason,
            direction,
            actor,
        });

        await recordAuditLog({
            action: direction === 'credit' ? 'wallet_admin_credit' : 'wallet_admin_debit',
            actor,
            target_type: 'wallet_account',
            target_id: userId,
            target_snapshot: { customer: { name: customer.name, email: customer.email } },
            impact: {
                amount: Number(amount),
                reason: String(reason).trim(),
                transaction_id: transaction._id,
                balance_before: walletService.toMajor(before),
                balance_after: walletService.toMajor(after),
            },
        });

        res.json({
            success: true,
            transaction,
            balance_before: walletService.toMajor(before),
            balance_after: walletService.toMajor(after),
        });
    } catch (err) {
        const status = ['INVALID_AMOUNT', 'REASON_REQUIRED', 'INVALID_DIRECTION'].includes(err.code) ? 400
            : err.code === 'INSUFFICIENT_BALANCE' ? 409
            : 500;
        res.status(status).json({ success: false, code: err.code, message: err.message });
    }
};

module.exports = {
    getMyWallet,
    getMyTransactions,
    initiateTopup,
    getTopupStatus,
    getSettings,
    updateSettings,
    getStats,
    getCustomerAccount,
    adjustCustomerBalance,
    getAllAccounts
};
