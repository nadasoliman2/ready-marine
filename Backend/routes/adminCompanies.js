/**
 * Admin — corporate accounts. Mounted at /api/admin/companies.
 *
 * Only the ReadyCar admin creates a company, and only the admin sets what we
 * lend it: the monthly cap, the payment terms, the overdue grace period and the
 * consolidation override. Everything a company decides for itself lives in the
 * company portal (routes/company.js).
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const companyService = require('../services/companyService');
const invitationService = require('../services/companyInvitationService');

const getAdminActor = (req) => ({
    role: 'admin',
    label: req.user?.username || 'Admin',
});

const multer = require('multer');
const receiptUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const withReceipt = (req, res, next) => receiptUpload.single('receipt')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, code: 'INVALID_FILE', message: err.message });
    next();
});
const invoiceService = () => require('../services/companyInvoiceService');

const fail = (res, error) => res.status(error.status || 500).json({
    success: false,
    code: error.code || 'COMPANY_ERROR',
    message: error.message,
});

const requestLanguage = (req) => (req.body?.language === 'ar' || req.query?.language === 'ar' ? 'ar' : 'en');

/**
 * @desc    The global consolidation rule and the defaults stamped on new companies
 * @route   GET /api/admin/companies/settings
 */
router.get('/:id/wallet', protect('admin'), async (req, res) => {
    try { res.json(await require('../services/companyWalletService').overview(req.params.id, req.query)); }
    catch (error) { fail(res, error); }
});

router.get('/settings', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, settings: await companyService.getCorporateSettings() });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Update the global consolidation rule / defaults
 * @route   PUT /api/admin/companies/settings
 */
router.put('/settings', protect('admin'), async (req, res) => {
    try {
        const settings = await companyService.updateCorporateSettings(req.body || {}, getAdminActor(req));
        res.json({ success: true, settings });
    } catch (error) {
        fail(res, error);
    }
});

/* ---- Statistics (phase 5) — declared before `/:id` so "stats" is not read as an id ---- */

const statsService = () => require('../services/companyStatsService');
const sendWorkbook = async (res, { workbook, filename }) => {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
};

/**
 * @desc    Every company together, month by month
 * @route   GET /api/admin/companies/stats?from=YYYY-MM&to=YYYY-MM
 */
router.get('/stats', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await statsService().overallStats(req.query)) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    The same as an Excel workbook
 * @route   GET /api/admin/companies/stats/export?from=&to=
 */
router.get('/stats/export', protect('admin'), async (req, res) => {
    try {
        await sendWorkbook(res, await statsService().exportOverall(req.query));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    One company, month by month
 * @route   GET /api/admin/companies/:id/stats?from=&to=
 */
router.get('/:id/stats', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await statsService().companyStats(req.params.id, req.query)) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    One company's figures as an Excel workbook
 * @route   GET /api/admin/companies/:id/stats/export?from=&to=
 */
router.get('/:id/stats/export', protect('admin'), async (req, res) => {
    try {
        await sendWorkbook(res, await statsService().exportCompany(req.params.id, req.query));
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    List companies
 * @route   GET /api/admin/companies?search=&status=&page=&limit=
 */
router.get('/', protect('admin'), async (req, res) => {
    try {
        const result = await companyService.listCompanies({
            search: req.query.search || '',
            status: req.query.status || '',
            page: req.query.page,
            limit: req.query.limit,
        });
        res.json({ success: true, ...result });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Create a company and invite its first manager
 * @route   POST /api/admin/companies
 */
router.post('/', protect('admin'), async (req, res) => {
    try {
        const result = await companyService.createCompany(req.body || {}, getAdminActor(req), {
            language: requestLanguage(req),
        });
        res.status(201).json({ success: true, ...result });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    One company: settings, head-counts, managers
 * @route   GET /api/admin/companies/:id
 */
router.get('/:id', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await companyService.getCompanyForAdmin(req.params.id)) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    The company's employees and their open invitations
 * @route   GET /api/admin/companies/:id/employees
 */
router.get('/:id/employees', protect('admin'), async (req, res) => {
    try {
        const company = await companyService.loadCompanyById(req.params.id);
        res.json({ success: true, ...(await companyService.listEmployees(company)) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Who changed one employee (limit, group, office, paused, resumed) and when
 * @route   GET /api/admin/companies/:id/employees/:membershipId/history
 */
router.get('/:id/employees/:membershipId/history', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await companyService.adminEmployeeHistory(req.params.id, req.params.membershipId)) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    One month of the company's account — every charge and credit
 * @route   GET /api/admin/companies/:id/purchases?month=YYYY-MM&user_id=&car_id=
 */
router.get('/:id/purchases', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await require('../services/companyOrderService').getAdminPurchases(req.params.id, req.query)) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    The same month as an Excel workbook
 * @route   GET /api/admin/companies/:id/purchases/export?month=YYYY-MM
 */
router.get('/:id/purchases/export', protect('admin'), async (req, res) => {
    try {
        const { workbook, filename } = await require('../services/companyOrderService').exportAdminPurchases(req.params.id, req.query);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Edit what ReadyCar sets for this company
 * @route   PATCH /api/admin/companies/:id
 */
router.patch('/:id', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await companyService.updateCompanyByAdmin(req.params.id, req.body || {}, getAdminActor(req))) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Delete an account that has no orders, invoices or payments on it
 * @route   DELETE /api/admin/companies/:id
 */
router.delete('/:id', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await companyService.deleteCompanyByAdmin(req.params.id, getAdminActor(req))) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    The company's consolidation batches (waiting, closed) and this month's savings
 * @route   GET /api/admin/companies/:id/batches?status=open
 */
router.get('/:id/batches', protect('admin'), async (req, res) => {
    try {
        const batchService = require('../services/companyBatchService');
        const company = await companyService.loadCompanyById(req.params.id);
        const [batches, overview] = await Promise.all([
            batchService.adminCompanyBatches(company._id, { status: req.query.status || null }),
            batchService.companyBatchOverview(company._id),
        ]);
        res.json({
            success: true,
            batches,
            month: {
                key: overview.month,
                savings: overview.savings,
                parcels_saved: overview.parcels_saved,
                combined_parcels: overview.combined_parcels,
            },
        });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Close a waiting batch now and send it to the vendor with whatever it holds
 * @route   POST /api/admin/companies/:id/batches/:batchId/close
 */
router.post('/:id/batches/:batchId/close', protect('admin'), async (req, res) => {
    try {
        const batch = await require('../services/companyBatchService')
            .closeNowByAdmin(req.params.id, req.params.batchId, getAdminActor(req));
        res.json({ success: true, batch });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    The company's invoices, months still collecting, and what it owes
 * @route   GET /api/admin/companies/:id/invoices
 */
router.get('/:id/invoices', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await invoiceService().adminInvoices(req.params.id)) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    One invoice with its lines and payments
 * @route   GET /api/admin/companies/:id/invoices/:invoiceId
 */
router.get('/:id/invoices/:invoiceId', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await invoiceService().adminInvoice(req.params.id, req.params.invoiceId)) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Record a bank transfer that reached us (confirmed at once)
 * @route   POST /api/admin/companies/:id/invoices/:invoiceId/payments
 */
router.post('/:id/invoices/:invoiceId/payments', protect('admin'), withReceipt, async (req, res) => {
    try {
        res.status(201).json({ success: true, ...(await invoiceService().recordPaymentByAdmin(req.params.id, req.params.invoiceId, req.body || {}, req.file, getAdminActor(req))) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Confirm a receipt the company uploaded (amount/date may be corrected)
 * @route   POST /api/admin/companies/:id/payments/:paymentId/confirm
 */
router.post('/:id/payments/:paymentId/confirm', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await invoiceService().confirmPayment(req.params.id, req.params.paymentId, req.body || {}, getAdminActor(req))) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Reject an uploaded receipt, saying why
 * @route   POST /api/admin/companies/:id/payments/:paymentId/reject
 */
router.post('/:id/payments/:paymentId/reject', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await invoiceService().rejectPayment(req.params.id, req.params.paymentId, req.body?.reason, getAdminActor(req))) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    A payment's receipt file
 * @route   GET /api/admin/companies/:id/payments/:paymentId/receipt
 */
router.get('/:id/payments/:paymentId/receipt', protect('admin'), async (req, res) => {
    try {
        const file = await invoiceService().adminReceipt(req.params.id, req.params.paymentId);
        res.setHeader('Content-Type', file.mime);
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
        res.sendFile(file.path);
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Stop new orders on the company account (waiting batches still ship)
 * @route   POST /api/admin/companies/:id/suspend
 */
router.post('/:id/suspend', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await companyService.suspendCompany(req.params.id, req.body || {}, getAdminActor(req))) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    End the contract for good: no new orders, employees released, the final
 *          invoice issued at once, credit set against what is unpaid
 * @route   POST /api/admin/companies/:id/end-contract   { note? }
 */
router.post('/:id/end-contract', protect('admin'), async (req, res) => {
    try {
        const { endContract } = require('../services/companyContractService');
        res.json({ success: true, ...(await endContract(req.params.id, req.body || {}, getAdminActor(req))) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Record the transfer of what ReadyCar owed a company whose contract ended
 * @route   POST /api/admin/companies/:id/refunds   { amount, paid_on, reference?, note? }
 */
router.post('/:id/refunds', protect('admin'), async (req, res) => {
    try {
        const { recordRefund } = require('../services/companyInvoiceService');
        res.json({ success: true, settlement: await recordRefund(req.params.id, req.body || {}, getAdminActor(req)) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Lift a suspension
 * @route   POST /api/admin/companies/:id/reactivate
 */
router.post('/:id/reactivate', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await companyService.reactivateCompany(req.params.id, getAdminActor(req))) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Invite a manager (e.g. the first one never accepted, or every manager left)
 * @route   POST /api/admin/companies/:id/managers
 */
router.post('/:id/managers', protect('admin'), async (req, res) => {
    try {
        const result = await invitationService.adminInviteManager(req.params.id, req.body || {}, getAdminActor(req), {
            language: requestLanguage(req),
        });
        res.status(201).json({ success: true, ...result });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Correct a manager's email or mobile
 * @route   PATCH /api/admin/companies/:id/managers/:membershipId   { email?, phone? }
 */
router.patch('/:id/managers/:membershipId', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await companyService.updateManagerContactByAdmin(req.params.id, req.params.membershipId, req.body || {}, getAdminActor(req))) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Remove a manager (the last one too — invite the next from here)
 * @route   DELETE /api/admin/companies/:id/managers/:membershipId
 */
router.delete('/:id/managers/:membershipId', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await companyService.removeManagerByAdmin(req.params.id, req.params.membershipId, getAdminActor(req))) });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Pending and expired manager invitations of a company
 * @route   GET /api/admin/companies/:id/manager-invitations
 */
router.get('/:id/manager-invitations', protect('admin'), async (req, res) => {
    try {
        const company = await companyService.loadCompanyById(req.params.id);
        await companyService.expireStaleInvitations(company._id);
        const { CompanyInvitation } = require('../models/companies');
        const invitations = await CompanyInvitation.find({
            company_id: company._id, role: 'manager', status: { $in: ['pending', 'expired'] },
        }).sort({ created_at: -1 }).lean();
        res.json({
            success: true,
            invitations: invitations.map((inv) => ({
                _id: inv._id,
                name: inv.name || '',
                email: inv.email || null,
                phone: inv.phone || null,
                status: inv.status,
                expires_at: inv.expires_at,
                last_sent_at: inv.last_sent_at,
            })),
        });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Resend a company invitation
 * @route   POST /api/admin/companies/:id/invitations/:invitationId/resend
 */
router.post('/:id/invitations/:invitationId/resend', protect('admin'), async (req, res) => {
    try {
        const result = await invitationService.adminResendInvitation(req.params.id, req.params.invitationId, {
            language: requestLanguage(req),
        });
        res.json({ success: true, ...result });
    } catch (error) {
        fail(res, error);
    }
});

/**
 * @desc    Cancel a company invitation
 * @route   DELETE /api/admin/companies/:id/invitations/:invitationId
 */
router.delete('/:id/invitations/:invitationId', protect('admin'), async (req, res) => {
    try {
        res.json({ success: true, ...(await invitationService.adminRevokeInvitation(req.params.id, req.params.invitationId)) });
    } catch (error) {
        fail(res, error);
    }
});

module.exports = router;
