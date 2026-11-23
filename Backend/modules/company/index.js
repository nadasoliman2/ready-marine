const companyRouter = require('./company.router');
const myCompanyRouter = require('./my_company.router');
const adminCompaniesRouter = require('./admin_companies.router');
const companyInvitationsRouter = require('./company_invitations.router');
const corporateClientsRouter = require('./corporate_clients.router');
const companyService = require('./company.service');

module.exports = {
    router: companyRouter,
    companyRouter,
    myCompanyRouter,
    adminCompaniesRouter,
    companyInvitationsRouter,
    corporateClientsRouter,
    companyService,
};
