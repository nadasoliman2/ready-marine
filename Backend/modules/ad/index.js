const adsRouter = require('./ads.router');
const adService = require('./ad.service');
const adAnalyticsService = require('./ad_analytics.service');
const bannerRotationService = require('./banner_rotation.service');
const adModel = require('../../models/ads');

module.exports = {
    router: adsRouter,
    adsRouter,
    adService,
    adAnalyticsService,
    bannerRotationService,
    ...adModel
};
