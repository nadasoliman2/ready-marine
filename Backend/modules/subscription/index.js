const subscriptionsRouter = require('./subscriptions.router');
const subscriptionPackagesRouter = require('./subscription_packages.router');
const subscriptionService = require('./subscription.service');
const subscriptionPaymentService = require('./subscription_payment.service');
const vendorSubscriptionService = require('./vendor_subscription.service');
const subscriptionModel = require('../../models/subscriptionPackages');

module.exports = {
    router: subscriptionsRouter,
    subscriptionsRouter,
    subscriptionPackagesRouter,
    subscriptionService,
    subscriptionPaymentService,
    vendorSubscriptionService,
    ...subscriptionModel
};
