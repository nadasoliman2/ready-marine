/**
 * Company portal — what a company's managers use. Mounted at /api/company.
 *
 * A manager is an ordinary customer account with a manager membership, so every
 * route runs on a CUSTOMER session. Which company they manage is re-derived
 * from their membership on each call (companyService.requireManager) — no route
 * takes a company id from the client.
 */
const express = require('express');
const path = require('path');
const multer = require('multer');
const router = express.Router();
const { protect, denyUnclaimedGuest } = require('../middleware/authMiddleware');
const companyService = require('../services/companyService');
const invitationService = require('../services/companyInvitationService');
const importService = require('../services/companyImportService');

const fail = (res, error) => {
    if (!error.status) console.error('[Company portal]', error);
    return res.status(error.status || 500).json({ code: error.code || 'COMPANY_ERROR', message: error.message });
};

const requestLanguage = (req) => (req.body?.language === 'ar' || req.query?.language === 'ar' ? 'ar' : 'en');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (path.extname(file.originalname).toLowerCase() !== '.xlsx') {
            return cb(new Error('Only .xlsx files are accepted.'));
        }
        cb(null, true);
    },
});

// A transfer receipt (phase 4): an image or a PDF. The type and size are checked again
// where the file is stored (companyInvoiceService.saveReceiptFile).
const receiptUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const withReceipt = (req, res, next) => receiptUpload.single('receipt')(req, res, (err) => {
    if (err) return res.status(400).json({ code: 'INVALID_FILE', message: err.message });
    next();
});

// Every route below needs a signed-in customer who has claimed their account.
router.use(protect('user'), denyUnclaimedGuest);

// A manager of several companies says which one this request is about. The id only picks
// among the caller's OWN memberships (companyService.requireManager); an id they do not
// manage falls back to their first company, it never reaches someone else's.
const { runInCompanyScope } = require('../services/shared/companyScope');
// A file is downloaded by opening its link, which cannot carry a header: it names the
// company in `?company_id=` instead. Either way the id only selects among the caller's own.
router.use((req, res, next) => runInCompanyScope(req.get('X-Company-Id') || req.query.company_id || null, next));

/* ---------------- Home ---------------- */

/** @route GET /api/company/overview */
router.get('/overview', async (req, res) => {
    try {
        res.json(await companyService.getPortalOverview(req.user._id));
    } catch (error) {
        fail(res, error);
    }
});

/** @route POST /api/company/setup/:step  (office | default_limit | modes) */
router.post('/setup/:step', async (req, res) => {
    try {
        res.json(await companyService.confirmSetupStep(req.user._id, req.params.step));
    } catch (error) {
        fail(res, error);
    }
});

/* ---------------- Employees ---------------- */

router.get('/wallet', async (req, res) => {
    try {
        const { company } = await companyService.requireManager(req.user._id);
        res.json(await require('../services/companyWalletService').overview(company._id, req.query));
    } catch (error) { fail(res, error); }
});

router.post('/wallet/topups', async (req, res) => {
    try {
        const { company } = await companyService.requireManager(req.user._id);
        const topup = await require('../services/walletTopupService').createTopup({ userId: req.user._id, companyId: company._id, amount: req.body.amount });
        res.status(201).json({ topup: { _id: topup._id, payment_url: topup.payment_url, status: topup.status } });
    } catch (error) { fail(res, error); }
});

router.post('/wallet/topups/confirm', async (req, res) => {
    try {
        const { company } = await companyService.requireManager(req.user._id);
        const result = await require('../services/walletTopupService').confirmTopup({ userId: req.user._id, companyId: company._id, topupId: req.body.topupId });
        res.json({ status: result.status, already_credited: result.alreadyCredited || false });
    } catch (error) { fail(res, error); }
});

/** @route GET /api/company/employees */
router.get('/employees', async (req, res) => {
    try {
        res.json(await companyService.getPortalEmployees(req.user._id));
    } catch (error) {
        fail(res, error);
    }
});

/** @route POST /api/company/employees/invite  — one employee, by hand */
router.post('/employees/invite', async (req, res) => {
    try {
        const result = await invitationService.inviteEmployee(req.user._id, req.body || {}, { language: requestLanguage(req) });
        res.status(201).json(result);
    } catch (error) {
        fail(res, error);
    }
});

/** @route GET /api/company/employees/template  — the Excel template, with this company's groups and offices */
router.get('/employees/template', async (req, res) => {
    try {
        const { workbook, filename } = await importService.buildTemplateWorkbook(req.user._id);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        fail(res, error);
    }
});

/** @route POST /api/company/employees/import/preview  — reads the file, sends nothing */
router.post('/employees/import/preview', (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) return res.status(400).json({ code: 'INVALID_FILE', message: err.message });
        next();
    });
}, async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ code: 'NO_FILE', message: 'Attach an .xlsx file.' });
        res.json(await importService.previewImport(req.user._id, req.file.buffer));
    } catch (error) {
        fail(res, error);
    }
});

/** @route POST /api/company/employees/import  — send the rows confirmed on the preview */
router.post('/employees/import', async (req, res) => {
    try {
        res.json(await invitationService.importEmployees(req.user._id, req.body?.rows || [], { language: requestLanguage(req) }));
    } catch (error) {
        fail(res, error);
    }
});

/** @route POST /api/company/employees/bulk  — { membership_ids, action: move_group|move_office|remove, group_id?, office_id? } */
router.post('/employees/bulk', async (req, res) => {
    try {
        res.json(await companyService.bulkUpdateEmployees(req.user._id, req.body || {}));
    } catch (error) {
        fail(res, error);
    }
});

/** @route PATCH /api/company/employees/:membershipId  — { group_id?, office_id?, limit_override? } */
router.patch('/employees/:membershipId', async (req, res) => {
    try {
        res.json(await companyService.updateEmployee(req.user._id, req.params.membershipId, req.body || {}));
    } catch (error) {
        fail(res, error);
    }
});

/** @route POST /api/company/employees/:membershipId/deactivate — pause their company ordering (reversible) */
router.post('/employees/:membershipId/deactivate', async (req, res) => {
    try {
        res.json(await companyService.setEmployeeActive(req.user._id, req.params.membershipId, false));
    } catch (error) {
        fail(res, error);
    }
});

/** @route POST /api/company/employees/:membershipId/reactivate */
router.post('/employees/:membershipId/reactivate', async (req, res) => {
    try {
        res.json(await companyService.setEmployeeActive(req.user._id, req.params.membershipId, true));
    } catch (error) {
        fail(res, error);
    }
});

/** @route GET /api/company/employees/:membershipId/history — who changed them, and when */
router.get('/employees/:membershipId/history', async (req, res) => {
    try {
        res.json(await companyService.getEmployeeHistory(req.user._id, req.params.membershipId));
    } catch (error) {
        fail(res, error);
    }
});

/** @route DELETE /api/company/employees/:membershipId */
router.delete('/employees/:membershipId', async (req, res) => {
    try {
        res.json(await companyService.removeEmployee(req.user._id, req.params.membershipId));
    } catch (error) {
        fail(res, error);
    }
});

/* ---------------- Invitations ---------------- */

/** @route POST /api/company/invitations/resend-expired */
router.post('/invitations/resend-expired', async (req, res) => {
    try {
        res.json(await invitationService.resendExpiredInvitations(req.user._id, { language: requestLanguage(req) }));
    } catch (error) {
        fail(res, error);
    }
});

/** @route POST /api/company/invitations/:id/resend */
router.post('/invitations/:id/resend', async (req, res) => {
    try {
        res.json(await invitationService.resendInvitation(req.user._id, req.params.id, { language: requestLanguage(req) }));
    } catch (error) {
        fail(res, error);
    }
});

/** @route DELETE /api/company/invitations/:id */
router.delete('/invitations/:id', async (req, res) => {
    try {
        res.json(await invitationService.revokeInvitation(req.user._id, req.params.id));
    } catch (error) {
        fail(res, error);
    }
});

/* ---------------- Groups ---------------- */

router.get('/groups', async (req, res) => {
    try {
        res.json(await companyService.listGroups(req.user._id));
    } catch (error) {
        fail(res, error);
    }
});

router.post('/groups', async (req, res) => {
    try {
        res.status(201).json(await companyService.createGroup(req.user._id, req.body || {}));
    } catch (error) {
        fail(res, error);
    }
});

router.patch('/groups/:id', async (req, res) => {
    try {
        res.json(await companyService.updateGroup(req.user._id, req.params.id, req.body || {}));
    } catch (error) {
        fail(res, error);
    }
});

router.delete('/groups/:id', async (req, res) => {
    try {
        res.json(await companyService.deleteGroup(req.user._id, req.params.id));
    } catch (error) {
        fail(res, error);
    }
});

/* ---------------- Offices ---------------- */

router.get('/offices', async (req, res) => {
    try {
        res.json(await companyService.listOffices(req.user._id));
    } catch (error) {
        fail(res, error);
    }
});

router.post('/offices', async (req, res) => {
    try {
        res.status(201).json(await companyService.createOffice(req.user._id, req.body || {}));
    } catch (error) {
        fail(res, error);
    }
});

router.patch('/offices/:id', async (req, res) => {
    try {
        res.json(await companyService.updateOffice(req.user._id, req.params.id, req.body || {}));
    } catch (error) {
        fail(res, error);
    }
});

router.delete('/offices/:id', async (req, res) => {
    try {
        res.json(await companyService.deleteOffice(req.user._id, req.params.id));
    } catch (error) {
        fail(res, error);
    }
});

/* ---------------- Company cars ---------------- */

router.get('/cars', async (req, res) => {
    try {
        res.json(await companyService.listCars(req.user._id));
    } catch (error) {
        fail(res, error);
    }
});

router.post('/cars', async (req, res) => {
    try {
        res.status(201).json(await companyService.createCar(req.user._id, req.body || {}));
    } catch (error) {
        fail(res, error);
    }
});

router.patch('/cars/:id', async (req, res) => {
    try {
        res.json(await companyService.updateCar(req.user._id, req.params.id, req.body || {}));
    } catch (error) {
        fail(res, error);
    }
});

router.delete('/cars/:id', async (req, res) => {
    try {
        res.json(await companyService.deleteCar(req.user._id, req.params.id));
    } catch (error) {
        fail(res, error);
    }
});

/* ---------------- Purchases (the company's ledger) ---------------- */

const sendWorkbook = async (res, { workbook, filename }) => {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
};

/** @route GET /api/company/purchases?month=YYYY-MM&user_id=&car_id= */
router.get('/purchases', async (req, res) => {
    try {
        res.json(await require('../services/companyOrderService').getPortalPurchases(req.user._id, req.query));
    } catch (error) {
        fail(res, error);
    }
});

/** @route GET /api/company/purchases/export?month=YYYY-MM  — Excel, with a per-employee totals sheet */
router.get('/purchases/export', async (req, res) => {
    try {
        await sendWorkbook(res, await require('../services/companyOrderService').exportPortalPurchases(req.user._id, req.query));
    } catch (error) {
        fail(res, error);
    }
});

/* ---------------- Settings & managers ---------------- */

router.get('/settings', async (req, res) => {
    try {
        res.json(await companyService.getPortalSettings(req.user._id));
    } catch (error) {
        fail(res, error);
    }
});

/** @route PATCH /api/company/settings  — { default_limit?, modes?: { consolidate, instant } } */
router.patch('/settings', async (req, res) => {
    try {
        res.json(await companyService.updatePortalSettings(req.user._id, req.body || {}));
    } catch (error) {
        fail(res, error);
    }
});

// The account's logo (raster, up to 2 MB). Its bytes are checked where it is stored.
const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

/** @route POST /api/company/logo  — multipart `file` */
router.post('/logo', (req, res, next) => logoUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ code: err.code === 'LIMIT_FILE_SIZE' ? 'LOGO_TOO_LARGE' : 'INVALID_FILE', message: err.code === 'LIMIT_FILE_SIZE' ? 'The logo is larger than 2 MB' : err.message });
    next();
}), async (req, res) => {
    try {
        res.json(await companyService.setPortalLogo(req.user._id, req.file));
    } catch (error) {
        fail(res, error);
    }
});

/** @route DELETE /api/company/logo */
router.delete('/logo', async (req, res) => {
    try {
        res.json(await companyService.removePortalLogo(req.user._id));
    } catch (error) {
        fail(res, error);
    }
});

/** @route POST /api/company/managers  — { name, identifier } */
router.post('/managers', async (req, res) => {
    try {
        const result = await invitationService.inviteManager(req.user._id, req.body || {}, { language: requestLanguage(req) });
        res.status(201).json(result);
    } catch (error) {
        fail(res, error);
    }
});

/** @route DELETE /api/company/managers/:membershipId */
router.delete('/managers/:membershipId', async (req, res) => {
    try {
        res.json(await companyService.removeManager(req.user._id, req.params.membershipId));
    } catch (error) {
        fail(res, error);
    }
});

/* ---------------- Invoices (phase 4) ---------------- */

const invoiceService = () => require('../services/companyInvoiceService');

/** @route GET /api/company/invoices — issued invoices, months still collecting, bank details */
router.get('/invoices', async (req, res) => {
    try {
        res.json(await invoiceService().portalInvoices(req.user._id));
    } catch (error) {
        fail(res, error);
    }
});

/** @route GET /api/company/invoices/:id — one invoice, its lines and its payments */
router.get('/invoices/:id', async (req, res) => {
    try {
        res.json(await invoiceService().portalInvoice(req.user._id, req.params.id));
    } catch (error) {
        fail(res, error);
    }
});

/** @route POST /api/company/invoices/:id/receipts — "we transferred it", with the receipt */
router.post('/invoices/:id/receipts', withReceipt, async (req, res) => {
    try {
        res.status(201).json(await invoiceService().submitReceipt(req.user._id, req.params.id, req.body || {}, req.file));
    } catch (error) {
        fail(res, error);
    }
});

/** @route GET /api/company/payments/:id/receipt — the uploaded receipt file */
router.get('/payments/:id/receipt', async (req, res) => {
    try {
        const file = await invoiceService().portalReceipt(req.user._id, req.params.id);
        res.setHeader('Content-Type', file.mime);
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
        res.sendFile(file.path);
    } catch (error) {
        fail(res, error);
    }
});

module.exports = router;
