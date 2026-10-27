const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/authMiddleware');
const { SiteSettings } = require('../models/site_settings');
const { Seller } = require('../models/sellers');
const { AD_CHANNELS } = require('../models/adSpend');
const { recordAuditLog } = require('../models/auditLog');
const financeService = require('../services/financeService');
const walletAnalytics = require('../services/walletAnalyticsService');
const payoutSchedule = require('../services/payoutScheduleService');
const { RETURN_WINDOW_DAYS } = require('../services/returnService');
const courierSettlements = require('../services/courierSettlementService');
const bostaBundles = require('../services/bostaBundleService');
const treasury = require('../services/treasuryService');
const vendorPayouts = require('../services/vendorPayoutService');
const payoutsAccount = require('../services/payouts/payoutsAccountService');

/**
 * Admin finance.
 *
 * Read-only everywhere except the payout endpoints (paying, freezing, holding — which move
 * or stop real money and are all written by vendorPayoutService), editing the payout
 * calendar, and the ad-spend ledger. Everything else is a projection of money that was
 * decided elsewhere: an earning is created by delivery, a commission by the order that
 * charged it. This module reports, it does not price.
 */

const adminLabel = (req) => req.user?.username || 'Admin';

/** Map a service error's `code` onto an HTTP status. */
const statusFor = (error) => ({
    NOT_FOUND: 404,
    INVALID_INPUT: 400,
    BELOW_MINIMUM: 400,
    INVALID_STATUS: 409,
    PAYOUTS_ON_HOLD: 409,
    NO_PAYOUT_METHOD: 409,
    NOTHING_PAYABLE: 409,
    NOTHING_TO_TRANSFER: 409,
    BUSY: 409,
    THROTTLED: 429,
    NOT_CONFIGURED: 503,
}[error.code] || 500);

const fail = (res, error) =>
    res.status(statusFor(error)).json({
        success: false,
        message: error.message,
        code: error.code,
        ...(error.blocked_ids ? { blocked_ids: error.blocked_ids } : {}),
    });

/* ------------------------------------------------------------------ */
/*  Overview — screen 4                                               */
/* ------------------------------------------------------------------ */

/**
 * @desc    Company-wide money position and period result
 * @route   GET /api/admin/finance/overview
 */
router.get('/overview', protect('admin'), async (req, res) => {
    try {
        const { from, to } = req.query;
        const overview = await financeService.getFinanceOverview({ from, to });
        res.json({ success: true, ...overview });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Revenue / cost / profit by month, for the overview chart
 * @route   GET /api/admin/finance/trend
 */
router.get('/trend', protect('admin'), async (req, res) => {
    try {
        const trend = await financeService.getMonthlyTrend({ months: req.query.months });
        res.json({ success: true, trend });
    } catch (error) {
        fail(res, error);
    }
});

/* ------------------------------------------------------------------ */
/*  Vendor payouts — screen 1                                         */
/* ------------------------------------------------------------------ */

/**
 * @desc    Every vendor with money in the system: held, payable, paid
 * @route   GET /api/admin/finance/vendors
 */
/**
 * @desc    Money committed but not landed: carts, parcels still at the vendor, parcels out
 *          for delivery. Also returned inside /overview — this route is for refreshing the
 *          section on its own without recomputing the whole P&L behind it.
 * @route   GET /api/admin/finance/pipeline
 */
/* ══════════════════════════════════════════════════════════════════════════ *
 * Wallets — the customer prepaid balance, reported inside Finance.
 *
 * This is NOT the vendor payout ledger above. A customer wallet is cash the store already
 * holds and owes back as goods; a vendor balance is money owed out of future revenue. They
 * are reported in the same module because both are the company's money, and never in the
 * same total because they are opposite kinds of liability.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * @desc    Everything the wallet dashboard needs in one call
 * @route   GET /api/admin/finance/wallets
 */
router.get('/wallets', protect('admin'), async (req, res) => {
    try {
        const { from, to, months } = req.query;
        const data = await walletAnalytics.getWalletDashboard({ from, to, months: months || 12 });
        res.json({ success: true, ...data });
    } catch (err) {
        console.error('[Finance] wallets:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    The wallet ledger across every customer, filtered and paged
 * @route   GET /api/admin/finance/wallets/ledger
 */
router.get('/wallets/ledger', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await walletAnalytics.listWalletLedger(req.query)) });
    } catch (err) {
        console.error('[Finance] wallet ledger:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    The same ledger as a CSV download
 * @route   GET /api/admin/finance/wallets/ledger/export
 */
router.get('/wallets/ledger/export', protect('admin'), async (req, res) => {
    try {
        // The export is the whole filtered set, not the page being looked at — an export
        // that silently gave you 25 rows would be worse than no export. Capped so one click
        // cannot pull an unbounded collection into memory.
        const { transactions } = await walletAnalytics.listWalletLedger({ ...req.query, page: 1, limit: 200 });

        const cell = (v) => {
            const str = v === null || v === undefined ? '' : String(v);
            // Quote everything and double any inner quote: reasons are free text written by
            // admins and will eventually contain a comma or a newline.
            return `"${str.replace(/"/g, '""')}"`;
        };
        const header = [
            'Transaction ID', 'Date', 'Type', 'Direction', 'Customer', 'Phone',
            'Amount', 'Balance before', 'Balance after', 'Currency',
            'Order', 'Top-up', 'Refund', 'Reason', 'Actor role', 'Actor', 'Manual', 'Reference',
        ];
        const rows = transactions.map((t) => [
            t._id, new Date(t.created_at).toISOString(), t.type, t.direction,
            t.customer?.name || '', t.customer?.phone || '',
            t.amount, t.balance_before, t.balance_after, t.currency,
            t.order_id || '', t.topup_id || '', t.refund_id || '',
            t.reason, t.actor.role, t.actor.label, t.is_manual ? 'yes' : 'no', t.reference,
        ]);

        const csv = [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="wallet-ledger-${Date.now()}.csv"`);
        // A BOM, so Excel opens Arabic customer names as Arabic instead of mojibake.
        res.send('﻿' + csv);
    } catch (err) {
        console.error('[Finance] wallet export:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    Wallets whose stored balance disagrees with their own ledger
 * @route   GET /api/admin/finance/wallets/reconcile
 */
router.get('/wallets/reconcile', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await walletAnalytics.reconcileWallets({ limit: req.query.limit })) });
    } catch (err) {
        console.error('[Finance] wallet reconcile:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get('/pipeline', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, pipeline: await financeService.getPipelineSnapshot() });
    } catch (err) {
        console.error('[Finance] pipeline:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get('/vendors', protect('admin'), async (req, res) => {
    try {
        const { search, sort, onlyOwed } = req.query;
        const result = await financeService.listVendorBalances({
            search,
            sort,
            onlyOwed: onlyOwed === 'true' || onlyOwed === '1',
        });
        res.json({ success: true, ...result });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    One vendor's order-by-order ledger with payout dates
 * @route   GET /api/admin/finance/vendors/:id
 */
router.get('/vendors/:id', protect('admin'), async (req, res) => {
    try {
        const { status, from, to, page, limit } = req.query;
        const ledger = await financeService.getVendorLedger(req.params.id, { status, from, to, page, limit });
        res.json({ success: true, ...ledger });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Pay a chosen set of the vendor's settled orders.
 *          channel "paymob" sends it now to the vendor's saved wallet / bank account;
 *          channel "manual" (default) records a transfer already made elsewhere.
 *          early_ids (+ early_reason, required) pays orders still inside their settlement
 *          period; if the payout fails they go back to waiting for their date.
 *          `state` in the answer: paid | processing | failed | unknown (Paymob only).
 * @route   POST /api/admin/finance/vendors/:id/pay
 */
router.post('/vendors/:id/pay', protect('admin'), async (req, res) => {
    try {
        const { earning_ids, payment_reference, notes, channel, early_ids, early_reason } = req.body;
        const result = await financeService.payEarnings(req.params.id, earning_ids, {
            channel: channel === 'paymob' ? 'paymob' : 'manual',
            payment_reference,
            notes,
            adminLabel: adminLabel(req),
            early_ids: Array.isArray(early_ids) ? early_ids : [],
            early_reason,
        });
        res.json({ success: true, ...result });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    What paying these orders would transfer, after the wallet's deductions — shown
 *          in the confirm dialog before anything moves. Omit earning_ids for "all payable".
 * @route   POST /api/admin/finance/vendors/:id/pay/preview
 */
router.post('/vendors/:id/pay/preview', protect('admin'), async (req, res) => {
    try {
        const earlyIds = Array.isArray(req.body?.early_ids) ? req.body.early_ids : [];
        const given = Array.isArray(req.body?.earning_ids) ? req.body.earning_ids : null;
        // No orders named and none early = "everything payable"; early orders alone = just those.
        const ids = given && (given.length || earlyIds.length) ? given : null;
        res.json({ success: true, preview: await vendorPayouts.previewPayout(req.params.id, ids, { earlyIds }) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Stop, or resume, every payout to one vendor
 * @route   PUT /api/admin/finance/vendors/:id/payout-hold   { active, reason }
 */
router.put('/vendors/:id/payout-hold', protect('admin'), async (req, res) => {
    try {
        const hold = await vendorPayouts.setVendorHold(req.params.id, {
            active: !!req.body?.active,
            reason: req.body?.reason,
            actor: { label: adminLabel(req) },
        });
        res.json({ success: true, payout_hold: hold });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Freeze one order's money (it will not clear or be paid until released)
 * @route   POST /api/admin/finance/earnings/:id/freeze   { reason }
 */
router.post('/earnings/:id/freeze', protect('admin'), async (req, res) => {
    try {
        const earning = await vendorPayouts.freezeEarning(req.params.id, { reason: req.body?.reason, actor: { label: adminLabel(req) } });
        res.json({ success: true, earning });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Release a frozen order's money
 * @route   POST /api/admin/finance/earnings/:id/unfreeze   { note }
 */
router.post('/earnings/:id/unfreeze', protect('admin'), async (req, res) => {
    try {
        const earning = await vendorPayouts.unfreezeEarning(req.params.id, { note: req.body?.note, actor: { label: adminLabel(req) } });
        res.json({ success: true, earning });
    } catch (error) {
        fail(res, error);
    }
});

/* ------------------------------------------------------------------ */
/*  Payouts (invoices) and Paymob                                     */
/* ------------------------------------------------------------------ */

/**
 * @desc    Our remaining balance at Paymob Payouts (Paymob allows 5 reads a minute)
 * @route   GET /api/admin/finance/paymob/budget
 */
router.get('/paymob/budget', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await vendorPayouts.getPaymobBudget()) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    The Paymob Payouts account's statement: top-ups in, transfers to vendors and their
 *          fees out, the running balance, and Paymob's own balance beside it.
 *          ?fresh=1 reads Paymob's balance now instead of the last minute's reading.
 * @route   GET /api/admin/finance/paymob-payouts/statement
 */
router.get('/paymob-payouts/statement', protect('admin'), async (req, res) => {
    try {
        const { page = 1, limit = 60, fresh } = req.query;
        res.json({ success: true, ...(await payoutsAccount.getStatement({
            page: Number(page) || 1,
            limit: Math.min(Number(limit) || 60, 200),
            freshBalance: fresh === '1' || fresh === 'true',
        })) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Copy the top-ups Paymob lists now (the server also does it every 30 minutes)
 * @route   POST /api/admin/finance/paymob-payouts/sync
 */
router.post('/paymob-payouts/sync', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, sync: await payoutsAccount.syncTopups() });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Enter a top-up Paymob has not listed yet. Linked, not doubled, when it does.
 * @route   POST /api/admin/finance/paymob-payouts/topups   { amount, topped_up_at, source, reference, notes }
 */
router.post('/paymob-payouts/topups', protect('admin'), async (req, res) => {
    try {
        const { amount, topped_up_at, source, reference, notes } = req.body || {};
        const topup = await payoutsAccount.recordTopup({
            amount: Number(amount), topped_up_at, source, reference, notes,
            adminId: req.user?._id || null,
            adminLabel: adminLabel(req),
        });
        res.status(201).json({ success: true, topup });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Undo a top-up entered by hand (one Paymob lists cannot be removed)
 * @route   DELETE /api/admin/finance/paymob-payouts/topups/:id
 */
router.delete('/paymob-payouts/topups/:id', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await payoutsAccount.deleteTopup(req.params.id, { adminLabel: adminLabel(req) })) });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Every payout — admin transfers and vendor requests — newest first: the invoice history.
 *          Filters: status, channel, vendorId, initiatedBy, needsReview, from, to.
 * @route   GET /api/admin/finance/payouts
 */
router.get('/payouts', protect('admin'), async (req, res) => {
    try {
        const { listAllWithdrawals } = require('../services/withdrawalService');
        const { page, limit, status, channel, vendorId, initiatedBy, needsReview, from, to } = req.query;
        const result = await listAllWithdrawals({
            page, limit, status, channel, vendorId, initiatedBy,
            needsReview: needsReview === 'true' || needsReview === '1',
            from, to,
        });
        res.json({ success: true, ...result });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    One payout as an invoice, with its Paymob trail
 * @route   GET /api/admin/finance/payouts/:id
 */
router.get('/payouts/:id', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await vendorPayouts.getPayoutInvoice(req.params.id, { forAdmin: true })) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Ask Paymob where this transfer stands now, and apply the answer
 * @route   POST /api/admin/finance/payouts/:id/refresh
 */
router.post('/payouts/:id/refresh', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await vendorPayouts.refreshPayout(req.params.id)) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Send an approved Paymob payout that was never sent (e.g. interrupted)
 * @route   POST /api/admin/finance/payouts/:id/send
 */
router.post('/payouts/:id/send', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await vendorPayouts.sendViaPaymob(req.params.id, { label: adminLabel(req) })) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Close a transfer whose outcome is unknown and which Paymob cannot find, after
 *          checking the Paymob dashboard. Its orders go back to the wallet.
 * @route   POST /api/admin/finance/payouts/:id/resolve-failed   { reason }
 */
router.post('/payouts/:id/resolve-failed', protect('admin'), async (req, res) => {
    try {
        const payout = await vendorPayouts.resolveUnknownAsFailed(req.params.id, {
            reason: req.body?.reason,
            actor: { label: adminLabel(req) },
        });
        res.json({ success: true, payout });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Send a failed Paymob payout's orders again, as a new payout
 * @route   POST /api/admin/finance/payouts/:id/retry
 */
router.post('/payouts/:id/retry', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await vendorPayouts.retryFailedPayout(req.params.id, { actor: { label: adminLabel(req) } })) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    A vendor's payout history
 * @route   GET /api/admin/finance/vendors/:id/payouts
 */
router.get('/vendors/:id/payouts', protect('admin'), async (req, res) => {
    try {
        const { page, limit } = req.query;
        const result = await financeService.listVendorPayouts(req.params.id, { page, limit });
        res.json({ success: true, ...result });
    } catch (error) {
        fail(res, error);
    }
});

/* ------------------------------------------------------------------ */
/*  Payout schedule                                                   */
/* ------------------------------------------------------------------ */

/**
 * @desc    The global payout calendar and the next few dates it produces
 * @route   GET /api/admin/finance/payout-schedule
 */
router.get('/payout-schedule', protect('admin'), async (req, res) => {
    try {
        const schedule = await payoutSchedule.getGlobalSchedule();
        res.json({
            success: true,
            schedule: {
                ...schedule,
                label: payoutSchedule.describeSchedule(schedule),
                upcoming: payoutSchedule.upcomingPayouts(schedule, { count: 8 }),
            },
            weekdays: payoutSchedule.WEEKDAY_LABELS,
        });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Update the global payout calendar
 * @route   PUT /api/admin/finance/payout-schedule
 *
 * Changing this re-dates FUTURE payouts only. Each earning carries its own `clearable_at`,
 * frozen at delivery, so money already inside its return window keeps the window it was
 * given — shortening the hold period cannot retroactively make held money payable.
 */
router.put('/payout-schedule', protect('admin'), async (req, res) => {
    try {
        const { enabled, frequency, weekday, interval_weeks, anchor_date, hold_days } = req.body;

        const update = {};
        if (enabled !== undefined) update['payout_schedule.enabled'] = !!enabled;
        if (frequency !== undefined) {
            if (!['daily', 'weekly'].includes(frequency)) {
                return res.status(400).json({ success: false, message: 'Frequency must be daily or weekly.' });
            }
            update['payout_schedule.frequency'] = frequency;
        }
        if (weekday !== undefined) {
            const day = Number(weekday);
            if (!Number.isInteger(day) || day < 0 || day > 6) {
                return res.status(400).json({ success: false, message: 'Weekday must be 0 (Sunday) to 6 (Saturday).' });
            }
            update['payout_schedule.weekday'] = day;
        }
        if (interval_weeks !== undefined) {
            const weeks = Number(interval_weeks);
            if (!Number.isInteger(weeks) || weeks < 1 || weeks > 12) {
                return res.status(400).json({ success: false, message: 'The interval must be between 1 and 12 weeks.' });
            }
            update['payout_schedule.interval_weeks'] = weeks;
        }
        if (anchor_date !== undefined) {
            update['payout_schedule.anchor_date'] = anchor_date ? new Date(anchor_date) : null;
        }
        if (hold_days !== undefined) {
            const days = Number(hold_days);
            // Never under the customer return window: money must not leave for goods that
            // can still come back.
            if (!Number.isInteger(days) || days < RETURN_WINDOW_DAYS || days > 90) {
                return res.status(400).json({
                    success: false,
                    message: `The settlement period must be between ${RETURN_WINDOW_DAYS} (the return window) and 90 days.`,
                });
            }
            update['payout_schedule.hold_days'] = days;
        }

        const settings = await SiteSettings.findOneAndUpdate({}, { $set: update }, { new: true, upsert: true });
        const schedule = payoutSchedule.resolveSchedule(settings.payout_schedule, null);

        recordAuditLog({
            action: 'payout_schedule_updated',
            actor: { role: 'admin', label: adminLabel(req) },
            target_type: 'payout_schedule',
            target_id: settings._id,
            target_snapshot: settings.payout_schedule,
        });

        res.json({
            success: true,
            schedule: {
                ...schedule,
                label: payoutSchedule.describeSchedule(schedule),
                upcoming: payoutSchedule.upcomingPayouts(schedule, { count: 8 }),
            },
        });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Set or clear one vendor's schedule override
 * @route   PUT /api/admin/finance/vendors/:id/payout-schedule
 *
 * A null field reads through to the global calendar, so a vendor who overrode only their
 * weekday still follows the company-wide hold period when it changes.
 */
router.put('/vendors/:id/payout-schedule', protect('admin'), async (req, res) => {
    try {
        const { enabled, frequency, weekday, interval_weeks, anchor_date, hold_days } = req.body;

        const nullable = (value, min, max) => {
            if (value === null || value === undefined || value === '') return null;
            const n = Number(value);
            if (!Number.isInteger(n) || n < min || n > max) {
                const err = new Error(`Value must be between ${min} and ${max}.`);
                err.code = 'INVALID_INPUT';
                throw err;
            }
            return n;
        };

        const vendor = await Seller.findByIdAndUpdate(
            req.params.id,
            {
                $set: {
                    'payout_schedule.enabled': !!enabled,
                    'payout_schedule.frequency': ['daily', 'weekly'].includes(frequency) ? frequency : null,
                    'payout_schedule.weekday': nullable(weekday, 0, 6),
                    'payout_schedule.interval_weeks': nullable(interval_weeks, 1, 12),
                    'payout_schedule.anchor_date': anchor_date ? new Date(anchor_date) : null,
                    'payout_schedule.hold_days': nullable(hold_days, RETURN_WINDOW_DAYS, 90),
                },
            },
            { new: true }
        ).select('store_name payout_schedule');

        if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

        const schedule = await payoutSchedule.getScheduleForVendor(req.params.id);

        res.json({
            success: true,
            vendor: { _id: vendor._id, store_name: vendor.store_name, payout_schedule: vendor.payout_schedule },
            schedule: {
                ...schedule,
                label: payoutSchedule.describeSchedule(schedule),
                upcoming: payoutSchedule.upcomingPayouts(schedule, { count: 6 }),
            },
        });
    } catch (error) {
        fail(res, error);
    }
});

/* ------------------------------------------------------------------ */
/*  Commissions — screen 2                                            */
/* ------------------------------------------------------------------ */

/**
 * @desc    Our commission order by order, with the shipping margin beside it
 * @route   GET /api/admin/finance/commissions
 */
router.get('/commissions', protect('admin'), async (req, res) => {
    try {
        const { from, to, vendorId, search, page, limit } = req.query;
        const result = await financeService.getCommissionLedger({ from, to, vendorId, search, page, limit });
        res.json({ success: true, ...result });
    } catch (error) {
        fail(res, error);
    }
});

/* ------------------------------------------------------------------ */
/*  Customers and profit — screen 3                                   */
/* ------------------------------------------------------------------ */

/**
 * @desc    Paying customers over a period, with what we kept from each
 * @route   GET /api/admin/finance/customers
 */
router.get('/customers', protect('admin'), async (req, res) => {
    try {
        const { from, to, search, sort, page, limit } = req.query;
        const result = await financeService.getCustomerRevenue({ from, to, search, sort, page, limit });
        res.json({ success: true, ...result });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Full profit and loss for a period
 * @route   GET /api/admin/finance/profit
 *
 * `adSpend` overrides the ledger for what-if questions ("what if we had spent 20k?").
 * The response flags an overridden figure so no one screenshots a hypothetical as fact.
 */
router.get('/profit', protect('admin'), async (req, res) => {
    try {
        const { from, to, adSpend } = req.query;
        const result = await financeService.getProfitAndLoss({
            from,
            to,
            adSpendOverride: adSpend !== undefined && adSpend !== '' ? Number(adSpend) : null,
        });
        res.json({ success: true, ...result });
    } catch (error) {
        fail(res, error);
    }
});

/* ------------------------------------------------------------------ */
/*  Ad spend ledger                                                   */
/* ------------------------------------------------------------------ */

/**
 * @desc    Ad spend overlapping a period, apportioned by day
 * @route   GET /api/admin/finance/ad-spend
 */
router.get('/ad-spend', protect('admin'), async (req, res) => {
    try {
        const { from, to } = req.query;
        const result = await financeService.getAdSpendForPeriod({ from, to });
        res.json({ success: true, ...result, channels: AD_CHANNELS });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Record ad spend
 * @route   POST /api/admin/finance/ad-spend
 */
router.post('/ad-spend', protect('admin'), async (req, res) => {
    try {
        const { channel, campaign, amount, start_date, end_date, notes } = req.body;

        if (amount === undefined || Number(amount) < 0 || Number.isNaN(Number(amount))) {
            return res.status(400).json({ success: false, message: 'Enter a spend amount of zero or more.' });
        }
        if (!start_date) {
            return res.status(400).json({ success: false, message: 'A start date is required.' });
        }
        if (channel && !AD_CHANNELS.includes(channel)) {
            return res.status(400).json({ success: false, message: `Channel must be one of: ${AD_CHANNELS.join(', ')}` });
        }

        const entry = await financeService.createAdSpend(
            { channel, campaign, amount: Number(amount), start_date, end_date, notes },
            adminLabel(req)
        );
        res.status(201).json({ success: true, entry });
    } catch (error) {
        // A Mongoose validation failure here is the model's end-before-start guard.
        if (error.name === 'ValidationError') {
            return res.status(400).json({ success: false, message: Object.values(error.errors)[0]?.message || error.message });
        }
        fail(res, error);
    }
});

/**
 * @desc    Update an ad spend entry
 * @route   PUT /api/admin/finance/ad-spend/:id
 */
router.put('/ad-spend/:id', protect('admin'), async (req, res) => {
    try {
        const { channel } = req.body;
        if (channel && !AD_CHANNELS.includes(channel)) {
            return res.status(400).json({ success: false, message: `Channel must be one of: ${AD_CHANNELS.join(', ')}` });
        }
        const entry = await financeService.updateAdSpend(req.params.id, req.body, adminLabel(req));
        res.json({ success: true, entry });
    } catch (error) {
        if (error.name === 'ValidationError') {
            return res.status(400).json({ success: false, message: Object.values(error.errors)[0]?.message || error.message });
        }
        fail(res, error);
    }
});

/**
 * @desc    Delete an ad spend entry
 * @route   DELETE /api/admin/finance/ad-spend/:id
 */
router.delete('/ad-spend/:id', protect('admin'), async (req, res) => {
    try {
        await financeService.deleteAdSpend(req.params.id, adminLabel(req));
        res.json({ success: true });
    } catch (error) {
        fail(res, error);
    }
});

/* ------------------------------------------------------------------ */
/*  Couriers — the cash they hold and the bundle we prepaid            */
/* ------------------------------------------------------------------ */

/**
 * @desc    What each courier is holding for us in COD, and the state of the Bosta bundle
 * @route   GET /api/admin/finance/couriers
 *
 * The two belong on one screen because they are the two halves of the same relationship:
 * what we paid the courier up front, and what it has not paid us back yet.
 */
router.get('/couriers', protect('admin'), async (req, res) => {
    try {
        const [cash, bundle] = await Promise.all([
            courierSettlements.getCashPositions(),
            // `refresh` re-reads Bosta. The screen asks for it on an explicit refresh only,
            // so opening the page does not wait on a third-party call.
            bostaBundles.getBundleOverview({ refresh: req.query.refresh === 'true' }).catch((err) => {
                console.error('[AdminFinance] Bundle overview failed:', err.message);
                return null;
            }),
        ]);
        res.json({ success: true, ...cash, bundle });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    The parcels behind one courier's outstanding cash, oldest first
 * @route   GET /api/admin/finance/couriers/:provider/parcels
 */
router.get('/couriers/:provider/parcels', protect('admin'), async (req, res) => {
    try {
        const { page = 1, limit = 100 } = req.query;
        const data = await courierSettlements.listOutstandingParcels(req.params.provider, {
            page: Number(page) || 1,
            limit: Math.min(Number(limit) || 100, 500),
        });
        res.json({ success: true, ...data });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Transfers already received from couriers
 * @route   GET /api/admin/finance/couriers/settlements
 */
router.get('/couriers/settlements', protect('admin'), async (req, res) => {
    try {
        const { provider = '', page = 1, limit = 25 } = req.query;
        const data = await courierSettlements.listSettlements({
            provider,
            page: Number(page) || 1,
            limit: Math.min(Number(limit) || 25, 100),
        });
        res.json({ success: true, ...data });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Record a transfer that reached the bank and close the parcels it paid for
 * @route   POST /api/admin/finance/couriers/settlements
 */
router.post('/couriers/settlements', protect('admin'), async (req, res) => {
    try {
        const { provider, amount, received_at, reference, notes, parcels } = req.body;
        const settlement = await courierSettlements.recordSettlement(provider, {
            amount: Number(amount),
            received_at,
            reference,
            notes,
            parcels,
            adminId: req.user?._id || null,
            adminLabel: adminLabel(req),
        });
        res.status(201).json({ success: true, settlement });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Undo a settlement, putting its parcels back on the outstanding list
 * @route   DELETE /api/admin/finance/couriers/settlements/:id
 */
router.delete('/couriers/settlements/:id', protect('admin'), async (req, res) => {
    try {
        await courierSettlements.deleteSettlement(req.params.id, {
            adminId: req.user?._id || null,
            adminLabel: adminLabel(req),
        });
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

/* ------------------------------------------------------------------ */
/*  Treasury — where the money is sitting, and what came in each month  */
/* ------------------------------------------------------------------ */

/**
 * @desc    Every place money is right now: wallets, each gateway, each courier
 * @route   GET /api/admin/finance/treasury
 */
/**
 * @desc    Tracking report: every order that finished inside the period, with the money
 *          split, costs and collector — plus money into our bank and out to vendors.
 * @route   GET /api/admin/finance/tracking-report?from=&to=&language=
 */
router.get('/tracking-report', protect('admin'), async (req, res) => {
    try {
        const { getTrackingReport } = require('../services/trackingReportService');
        res.json({ success: true, report: await getTrackingReport(req.query) });
    } catch (err) {
        console.error('[Finance] tracking report:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

/**
 * @desc    The same report as an Excel file, in the finance team's layout.
 * @route   GET /api/admin/finance/tracking-report/export?from=&to=
 */
router.get('/tracking-report/export', protect('admin'), async (req, res) => {
    try {
        const { getTrackingReport } = require('../services/trackingReportService');
        const { buildTrackingReportWorkbook } = require('../services/trackingReportExcel');
        // The sheet is Arabic, like the template it follows.
        const report = await getTrackingReport({ ...req.query, language: 'ar' });
        // The second sheet, "تحليل المبيعات والمدفوعات", is cumulative to the end of the
        // period. With no `from` the report above already is, and is reused.
        const { getSalesPaymentsAnalysis } = require('../services/salesPaymentsAnalysisService');
        const analysis = await getSalesPaymentsAnalysis({ to: req.query.to, sales: req.query.from ? null : report });
        const wb = await buildTrackingReportWorkbook(report, analysis);
        const safe = (v) => String(v || '').replace(/[^0-9-]/g, '');
        const name = `readymarine-tracking-report_${safe(req.query.from) || 'start'}_${safe(req.query.to) || 'today'}.xlsx`;
        // Built in memory and sent whole, with its length: the page now NAVIGATES here
        // (see the tracking page), and a phone's browser decides how to handle a download
        // from these headers alone.
        const buffer = Buffer.from(await wb.xlsx.writeBuffer());
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Cache-Control', 'no-store');
        res.end(buffer);
    } catch (err) {
        console.error('[Finance] tracking report export:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get('/treasury', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await treasury.getMoneyMap()) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Month by month: what was sold by payment method, and what money actually arrived
 * @route   GET /api/admin/finance/treasury/monthly
 */
router.get('/treasury/monthly', protect('admin'), async (req, res) => {
    try {
        const data = await treasury.getMonthlyIntake({ months: Number(req.query.months) || 12 });
        res.json({ success: true, ...data });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    One gateway's statement — every payment in, every transfer out, running balance
 * @route   GET /api/admin/finance/treasury/gateways/:provider/ledger
 */
router.get('/treasury/gateways/:provider/ledger', protect('admin'), async (req, res) => {
    try {
        const { page = 1, limit = 50 } = req.query;
        const data = await treasury.getGatewayLedger(req.params.provider, {
            page: Number(page) || 1,
            limit: Math.min(Number(limit) || 50, 200),
        });
        res.json({ success: true, ...data });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Transfers received from the gateways
 * @route   GET /api/admin/finance/treasury/gateway-payouts
 */
router.get('/treasury/gateway-payouts', protect('admin'), async (req, res) => {
    try {
        const { provider = '', page = 1, limit = 25 } = req.query;
        const data = await treasury.listGatewayPayouts({
            provider,
            page: Number(page) || 1,
            limit: Math.min(Number(limit) || 25, 100),
        });
        res.json({ success: true, ...data });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Record a transfer that arrived from a gateway
 * @route   POST /api/admin/finance/treasury/gateway-payouts
 */
router.post('/treasury/gateway-payouts', protect('admin'), async (req, res) => {
    try {
        const { provider, amount, received_at, reference, notes } = req.body;
        const payout = await treasury.recordGatewayPayout(provider, {
            amount: Number(amount),
            received_at,
            reference,
            notes,
            adminId: req.user?._id || null,
            adminLabel: adminLabel(req),
        });
        res.status(201).json({ success: true, payout });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

/**
 * @desc    Undo a gateway transfer entered by mistake
 * @route   DELETE /api/admin/finance/treasury/gateway-payouts/:id
 */
router.delete('/treasury/gateway-payouts/:id', protect('admin'), async (req, res) => {
    try {
        await treasury.deleteGatewayPayout(req.params.id, {
            adminId: req.user?._id || null,
            adminLabel: adminLabel(req),
        });
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

module.exports = router;
