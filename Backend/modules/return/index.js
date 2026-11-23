const returnsRouter = require('./returns.router');
const returnService = require('./return.service');
const returnLogisticsService = require('./return_logistics.service');
const refundService = require('./refund.service');
const returnModel = require('../../models/returnRequests');

module.exports = {
    router: returnsRouter,
    returnsRouter,
    returnService,
    returnLogisticsService,
    refundService,
    ...returnModel
};
