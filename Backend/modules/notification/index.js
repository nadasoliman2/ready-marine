const notificationRouter = require('./notification.router');
const customerNotificationsRouter = require('./customer_notification.router');
const notificationService = require('./notification.service');
const customerNotificationService = require('./customer_notification.service');
const notificationModel = require('../../models/notifications');

module.exports = {
    router: notificationRouter,
    notificationsRouter: notificationRouter,
    customerNotificationsRouter,
    notificationService,
    customerNotificationService,
    ...notificationModel
};
