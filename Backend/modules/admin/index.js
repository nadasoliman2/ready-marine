const adminRouter = require('./admin.router');
const adminCatalogRouter = require('./admin_catalog.router');
const adminEverysecondRouter = require('./admin_everysecond.router');
const adminFinanceRouter = require('./admin_finance.router');
const adminFitmentRouter = require('./admin_fitment.router');
const adminImageCheckRouter = require('./admin_image_check.router');
const adminImageStudioRouter = require('./admin_image_studio.router');
const adminPaymentsRouter = require('./admin_payments.router');
const adminReportsRouter = require('./admin_reports.router');
const { vendorRouter: vendorSuppliesRouter, adminRouter: adminSuppliesRouter } = require('./supplies.router');

const adminAccessService = require('./admin_access.service');
const adminOverviewService = require('./admin_overview.service');
const financeService = require('./finance.service');
const customerReportsService = require('./customer_reports.service');
const imageCheckService = require('./image_check.service');
const imageStudioService = require('./image_studio.service');
const supplyService = require('./supply.service');
const salesPaymentsAnalysisService = require('./sales_payments_analysis.service');
const trackingReportService = require('./tracking_report.service');
const bulkUploadService = require('./bulk_upload.service');

module.exports = {
    router: adminRouter,
    adminRouter,
    adminCatalogRouter,
    adminEverysecondRouter,
    adminFinanceRouter,
    adminFitmentRouter,
    adminImageCheckRouter,
    adminImageStudioRouter,
    adminPaymentsRouter,
    adminReportsRouter,
    adminSuppliesRouter,
    vendorSuppliesRouter,
    adminAccessService,
    adminOverviewService,
    financeService,
    customerReportsService,
    imageCheckService,
    imageStudioService,
    supplyService,
    salesPaymentsAnalysisService,
    trackingReportService,
    bulkUploadService
};
