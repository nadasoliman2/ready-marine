const familyRouter = require('./family.router');
const familyInvitationsRouter = require('./family_invitations.router');
const familyService = require('./family.service');
const familyOrderRequestService = require('./family_order_request.service');
const familyModel = require('../../models/families');

module.exports = {
    router: familyRouter,
    familyRouter,
    familyInvitationsRouter,
    familyService,
    familyOrderRequestService,
    ...familyModel
};
