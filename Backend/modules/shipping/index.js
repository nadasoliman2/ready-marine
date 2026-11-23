const express = require('express');
const { protect } = require('../../middleware/authMiddleware');
const shippingController = require('./shipping.controller');
const shippingService = require('./shipping.service');
const shippingEngine = require('./shipping.engine');
const { ShippingZone } = require('../../models/shipping_zones');
const { ShippingMethod } = require('../../models/shipping_methods');

// Public & user shipping router (/api/shipping)
const shippingRouter = express.Router();
shippingRouter.get('/zones', shippingController.getZonesTree);
shippingRouter.get('/cities', shippingController.getCities);
shippingRouter.get('/classes', shippingController.getClasses);
shippingRouter.post('/quote', protect('user'), shippingController.getQuote);

// Admin shipping router (/api/admin/shipping)
const adminShippingRouter = express.Router();
adminShippingRouter.use(protect('admin'));
adminShippingRouter.get('/zones', shippingController.listAdminZones);
adminShippingRouter.post('/zones', shippingController.createAdminZone);
adminShippingRouter.put('/zones/:id', shippingController.updateAdminZone);
adminShippingRouter.delete('/zones/:id', shippingController.deleteAdminZone);
adminShippingRouter.get('/subsidy', shippingController.getSubsidyReport);
adminShippingRouter.get('/settings', shippingController.getAdminSettings);
adminShippingRouter.put('/settings', shippingController.updateAdminSettings);

module.exports = {
    router: shippingRouter,
    shippingRouter,
    adminShippingRouter,
    ShippingZone,
    ShippingMethod,
    shippingService,
    shippingEngine,
    shippingController,
};
