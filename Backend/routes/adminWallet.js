const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/authMiddleware');
const { SiteSettings } = require('../models/site_settings');
const { User } = require('../models/users');
const { WalletAccount } = require('../models/walletAccounts');
const { WalletTransaction } = require('../models/walletTransactions');
const { WalletTopup } = require('../models/walletTopups');
const { recordAuditLog, AuditLog } = require('../models/auditLog');
const walletService = require('../services/walletService');
const walletTopupService = require('../services/walletTopupService');
const { notifyCustomer } = require('../services/customerNotificationService');

const getAdminActor = (req) => ({
    role: 'admin',
    label: req.user?.username || 'Admin',
});

const toMajor = walletService.toMajor;

/**
 * Admin wallet control.
 *
 * Everything that moves money here writes two records, not one: the wallet
 * ledger entry the customer can see, and an `AuditLog` row the customer cannot.
 * The first explains the balance; the second explains who decided to change it.
 */

/**
 * @desc    Read the wallet configuration
 * @route   GET /api/admin/wallet/settings
 */
router.get('/settings', protect('admin'), async (req, res) => {
    try {
        const settings = await walletService.getWalletSettings();
        res.json({ success: true, settings });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Read the cash-on-delivery policy — who is allowed to pay at the door
 * @route   GET /api/admin/wallet/cod-policy
 *
 * It lives beside the wallet settings because the COD switch it qualifies is on the same
 * screen: one is "do we offer cash at all", the other is "and to whom".
 */
router.get('/cod-policy', protect('admin'), async (req, res) => {
    try {
        const policy = await require('../services/codEligibilityService').getPolicy();
        res.json({ success: true, policy });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Update the cash-on-delivery policy
 * @route   PUT /api/admin/wallet/cod-policy
 */
router.put('/cod-policy', protect('admin'), async (req, res) => {
    try {
        const policy = await require('../services/codEligibilityService').updatePolicy(req.body || {});
        res.json({ success: true, policy });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Update the wallet configuration
 * @route   PUT /api/admin/wallet/settings
 *
 * Turning `enabled` on for the first time stamps `activated_at`. Turning it off
 * is a checkout-level fallback to gateway payments only — balances, history,
 * and refunds into the wallet all keep working, because a switch flipped by an
 * admin must never make a customer's money unreachable.
 */
router.put('/settings', protect('admin'), async (req, res) => {
    try {
        const patch = walletService.validateSettingsPatch(req.body || {});
        if (Object.keys(patch).length === 0) {
            return res.status(400).json({ success: false, message: 'No wallet settings were provided' });
        }

        let doc = await SiteSettings.findOne();
        if (!doc) doc = new SiteSettings();

        const before = {
            ...walletService.DEFAULT_WALLET_SETTINGS,
            ...(doc.wallet ? doc.wallet.toObject?.() || doc.wallet : {}),
        };

        doc.wallet = { ...before, ...patch };
        if (patch.enabled && !before.activated_at) {
            doc.wallet.activated_at = new Date();
        }
        doc.markModified('wallet');
        await doc.save();

        const settings = await walletService.getWalletSettings();

        await recordAuditLog({
            action: 'wallet_settings_updated',
            actor: getAdminActor(req),
            target_type: 'site_settings',
            target_id: doc._id,
            impact: { before, after: patch },
        });

        res.json({ success: true, settings });
    } catch (err) {
        const status = err.code === 'INVALID_SETTINGS' ? 400 : 500;
        res.status(status).json({ success: false, code: err.code, message: err.message });
    }
});

/**
 * @desc    Store-wide wallet totals
 * @route   GET /api/admin/wallet/stats
 *
 * `outstanding_liability` is the number that matters commercially: money
 * customers have paid for but not yet spent. It is a debt the store owes in
 * goods, so it is reported plainly rather than buried among the counters.
 */
router.get('/stats', protect('admin'), async (req, res) => {
    try {
        const [balances] = await WalletAccount.aggregate([
            {
                $group: {
                    _id: null,
                    accounts: { $sum: 1 },
                    available: { $sum: '$available_minor' },
                    reserved: { $sum: '$reserved_minor' },
                    topped_up: { $sum: '$lifetime_topped_up_minor' },
                    spent: { $sum: '$lifetime_spent_minor' },
                    refunded: { $sum: '$lifetime_refunded_minor' },
                    frozen: { $sum: { $cond: [{ $eq: ['$status', 'frozen'] }, 1, 0] } },
                },
            },
        ]);

        const byType = await WalletTransaction.aggregate([
            { $group: { _id: '$type', count: { $sum: 1 }, amount: { $sum: '$amount_minor' } } },
        ]);

        const settings = await walletService.getWalletSettings();

        res.json({
            success: true,
            stats: {
                accounts: balances?.accounts || 0,
                frozen_accounts: balances?.frozen || 0,
                available: toMajor(balances?.available || 0),
                reserved: toMajor(balances?.reserved || 0),
                lifetime_topped_up: toMajor(balances?.topped_up || 0),
                lifetime_spent: toMajor(balances?.spent || 0),
                lifetime_refunded: toMajor(balances?.refunded || 0),
                outstanding_liability: toMajor((balances?.available || 0) + (balances?.reserved || 0)),
                currency: settings.currency,
                by_type: byType.reduce((acc, row) => {
                    acc[row._id] = { count: row.count, amount: toMajor(row.amount) };
                    return acc;
                }, {}),
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Search customer wallets
 * @route   GET /api/admin/wallet/accounts
 */
router.get('/accounts', protect('admin'), async (req, res) => {
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
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    One customer's wallet, statement, and top-up history
 * @route   GET /api/admin/wallet/accounts/:userId
 */
router.get('/accounts/:userId', protect('admin'), async (req, res) => {
    try {
        const { userId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: 'Invalid customer id' });
        }

        const [user, balances, history, topups] = await Promise.all([
            User.findById(userId).select('name email phone created_at').lean(),
            walletService.getBalances(userId),
            walletService.getTransactionHistory(userId, { page: req.query.page, limit: req.query.limit || 50 }),
            WalletTopup.find({ user_id: userId }).sort({ createdAt: -1 }).limit(20).lean(),
        ]);

        if (!user) return res.status(404).json({ success: false, message: 'Customer not found' });

        res.json({
            success: true,
            customer: user,
            balances,
            topups: topups.map((t) => ({
                _id: t._id,
                amount: toMajor(t.amount_minor),
                currency: t.currency,
                status: t.status,
                payment_method: t.payment_method,
                invoice_id: t.invoice_id,
                created_at: t.createdAt,
                paid_at: t.paid_at,
                credited_at: t.credited_at,
                error_message: t.error_message,
            })),
            ...history,
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Manually credit or debit a customer's wallet
 * @route   POST /api/admin/wallet/accounts/:userId/adjust
 *
 * There is no endpoint that SETS a balance. An adjustment is an ordinary ledger
 * entry with a mandatory reason and a named admin, so it appears in the
 * customer's own statement alongside everything else — and the customer is told
 * it happened, because money changing with no notice is indistinguishable from
 * a bug.
 */
router.post('/accounts/:userId/adjust', protect('admin'), async (req, res) => {
    try {
        const { userId } = req.params;
        const { amount, reason, direction } = req.body || {};

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: 'Invalid customer id' });
        }
        const customer = await User.findById(userId).select('name email').lean();
        if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

        const actor = getAdminActor(req);
        const { transaction, before, after } = await walletService.adminAdjust({
            userId,
            amount,
            reason,
            direction,
            actor,
        });

        const settings = await walletService.getWalletSettings();
        const magnitude = toMajor(transaction.amount_minor).toFixed(2);
        const trimmedReason = String(reason).trim();

        await recordAuditLog({
            action: direction === 'credit' ? 'wallet_admin_credit' : 'wallet_admin_debit',
            actor,
            target_type: 'wallet_account',
            target_id: userId,
            target_snapshot: { customer: { name: customer.name, email: customer.email } },
            impact: {
                amount: Number(magnitude),
                reason: trimmedReason,
                transaction_id: transaction._id,
                balance_before: before,
                balance_after: after,
            },
        });

        notifyCustomer(userId, 'wallet_adjusted', {
            title_en: direction === 'credit' ? 'Credit added to your wallet' : 'Credit removed from your wallet',
            title_ar: direction === 'credit' ? 'تمت إضافة رصيد إلى محفظتك' : 'تم خصم رصيد من محفظتك',
            message_en: `${settings.currency} ${magnitude} ${direction === 'credit' ? 'added to' : 'removed from'} your wallet by our support team. Reason: ${trimmedReason}`,
            message_ar: `${settings.currency} ${magnitude} ${direction === 'credit' ? 'تمت إضافتها إلى' : 'تم خصمها من'} محفظتك من قِبل فريق الدعم. السبب: ${trimmedReason}`,
        }, { link: '/profile?tab=wallet', data: { amount: Number(magnitude), direction } });

        res.json({ success: true, transaction, before, after });
    } catch (err) {
        const status = ['INVALID_AMOUNT', 'REASON_REQUIRED', 'INVALID_DIRECTION'].includes(err.code) ? 400
            : err.code === 'INSUFFICIENT_BALANCE' ? 409
            : 500;
        res.status(status).json({ success: false, code: err.code, message: err.message });
    }
});

/**
 * @desc    Freeze or unfreeze a wallet
 * @route   POST /api/admin/wallet/accounts/:userId/status
 *
 * A freeze stops spending and top-ups. It does NOT stop refunds or admin
 * corrections from landing — an investigation is a reason to pause activity,
 * not a reason to withhold money the customer is already owed.
 */
router.post('/accounts/:userId/status', protect('admin'), async (req, res) => {
    try {
        const { userId } = req.params;
        const { status, reason = '' } = req.body || {};

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ success: false, message: 'Invalid customer id' });
        }
        if (status === 'frozen' && !String(reason).trim()) {
            return res.status(400).json({ success: false, code: 'REASON_REQUIRED', message: 'A reason is required to freeze a wallet' });
        }
        const customer = await User.findById(userId).select('name email').lean();
        if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

        const actor = getAdminActor(req);
        const account = await walletService.setAccountStatus({ userId, status, reason, actor });

        await recordAuditLog({
            action: status === 'frozen' ? 'wallet_frozen' : 'wallet_unfrozen',
            actor,
            target_type: 'wallet_account',
            target_id: userId,
            target_snapshot: { customer: { name: customer.name, email: customer.email } },
            impact: { status, reason: String(reason).trim(), balance: toMajor(account.available_minor) },
        });

        notifyCustomer(userId, 'wallet_status_changed', {
            title_en: status === 'frozen' ? 'Your wallet is on hold' : 'Your wallet is active again',
            title_ar: status === 'frozen' ? 'تم إيقاف محفظتك مؤقتاً' : 'تم تفعيل محفظتك مرة أخرى',
            message_en: status === 'frozen'
                ? `Your wallet has been placed on hold. Reason: ${String(reason).trim()}. Your balance is safe — please contact support.`
                : 'Your wallet is active again and your balance is ready to use.',
            message_ar: status === 'frozen'
                ? `تم إيقاف محفظتك مؤقتاً. السبب: ${String(reason).trim()}. رصيدك في أمان — يرجى التواصل مع الدعم.`
                : 'تم تفعيل محفظتك مرة أخرى ورصيدك جاهز للاستخدام.',
        }, { link: '/profile?tab=wallet', data: { status } });

        res.json({
            success: true,
            account: walletService.toPublicAccount(account),
        });
    } catch (err) {
        const status = err.code === 'INVALID_STATUS' ? 400 : 500;
        res.status(status).json({ success: false, code: err.code, message: err.message });
    }
});

/**
 * @desc    Top-ups that were paid but never credited
 * @route   GET /api/admin/wallet/exceptions
 *
 * The one screen support needs when a customer says "I paid and nothing
 * happened". These are real captures with no matching credit, and they cannot
 * be found by looking at wallets — only by looking at what failed.
 */
router.get('/exceptions', protect('admin'), async (req, res) => {
    try {
        const topups = await WalletTopup.find({ status: 'paid_credit_failed' })
            .sort({ createdAt: -1 })
            .limit(100)
            .populate('user_id', 'name email phone')
            .lean();

        res.json({
            success: true,
            exceptions: topups.map((t) => ({
                _id: t._id,
                user: t.user_id
                    ? { _id: t.user_id._id, name: t.user_id.name, email: t.user_id.email, phone: t.user_id.phone }
                    : null,
                amount: toMajor(t.amount_minor),
                currency: t.currency,
                invoice_id: t.invoice_id,
                paid_at: t.paid_at,
                error_message: t.error_message,
                created_at: t.createdAt,
            })),
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Re-verify a captured-but-uncredited top-up and credit it
 * @route   POST /api/admin/wallet/exceptions/:topupId/retry
 *
 * The one-click resolution for the screen above. It re-reads the invoice from
 * the provider before crediting — an admin cannot tell a real capture from a
 * glitch by looking at a failed row, and crediting on assumption mints money.
 */
router.post('/exceptions/:topupId/retry', protect('admin'), async (req, res) => {
    try {
        const { topupId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(topupId)) {
            return res.status(400).json({ success: false, message: 'Invalid top-up id' });
        }

        const actor = getAdminActor(req);
        const result = await walletTopupService.retryFailedTopup(topupId, actor);
        const amount = toMajor(result.topup.amount_minor);

        await recordAuditLog({
            action: 'wallet_topup_retried',
            actor,
            target_type: 'wallet_account',
            target_id: result.topup.user_id,
            impact: {
                topup_id: result.topup._id,
                invoice_id: result.topup.invoice_id,
                amount,
                already_credited: !!result.alreadyCredited,
            },
        });

        if (!result.alreadyCredited) {
            const settings = await walletService.getWalletSettings();
            notifyCustomer(result.topup.user_id, 'wallet_topped_up', {
                title_en: 'Your top-up has been added',
                title_ar: 'تمت إضافة رصيد الشحن إلى محفظتك',
                message_en: `${settings.currency} ${amount.toFixed(2)} has been added to your wallet and is ready to use. Sorry for the delay.`,
                message_ar: `تمت إضافة ${settings.currency} ${amount.toFixed(2)} إلى محفظتك وهي جاهزة للاستخدام. نعتذر عن التأخير.`,
            }, { link: '/profile?tab=wallet', data: { amount } });
        }

        res.json({
            success: true,
            alreadyCredited: !!result.alreadyCredited,
            amount,
            message: result.alreadyCredited
                ? 'This top-up had already been credited'
                : 'Top-up verified with the provider and credited to the wallet',
        });
    } catch (err) {
        const status = err.code === 'TOPUP_NOT_FOUND' ? 404
            : ['TOPUP_NOT_PAID', 'TOPUP_NOT_VERIFIABLE'].includes(err.code) ? 409
            : 500;
        res.status(status).json({ success: false, code: err.code, message: err.message });
    }
});

/**
 * @desc    Audit trail of wallet settings changes and manual interventions
 * @route   GET /api/admin/wallet/audit
 */
router.get('/audit', protect('admin'), async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
        const filter = {
            action: {
                $in: ['wallet_settings_updated', 'wallet_admin_credit', 'wallet_admin_debit', 'wallet_frozen', 'wallet_unfrozen'],
            },
        };

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
            pagination: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) },
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
