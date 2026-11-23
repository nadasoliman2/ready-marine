const bundlesRouter = require('./bundles.router');
const bundleService = require('./bundle.service');
const bundleModel = require('../../models/bundles');

module.exports = {
    router: bundlesRouter,
    bundlesRouter,
    bundleService,
    ...bundleModel
};
