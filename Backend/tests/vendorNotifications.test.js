const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { startMongo } = require('./support/testServers');
const notificationRouter = require('../modules/notification/notification.router');
const {
    Notification,
    createNotification,
    getNotificationsForVendor,
    markAsRead,
    markAllAsRead,
    getUnreadCount,
    deleteNotification,
} = require('../models/notifications');

test.describe('Vendor In-App Notifications API', () => {
    let mongo;

    test.before(async () => {
        mongo = await startMongo();
        await mongoose.connect(mongo.uri);
    });

    test.after(async () => {
        await mongoose.disconnect();
        if (mongo) await mongo.stop();
    });

    test('getUnreadCount and getNotificationsForVendor execute without error', async () => {
        const vendorId = new mongoose.Types.ObjectId();

        // 1. Initial count is 0
        const initialCount = await getUnreadCount(vendorId);
        assert.strictEqual(initialCount, 0, 'Unread count should initially be 0');

        // 2. Create a notification
        const created = await createNotification(
            vendorId,
            'products_published',
            'تمت الموافقة على منتجاتك',
            'تم نشر 5 منتجات جديدة في متجرك بنجاح.'
        );
        assert.ok(created._id, 'Notification must be created with an ID');
        assert.strictEqual(created.read, false, 'Notification must be unread by default');

        // 3. Count is now 1
        const countAfter = await getUnreadCount(vendorId);
        assert.strictEqual(countAfter, 1, 'Unread count should now be 1');

        // 4. Fetch list
        const list = await getNotificationsForVendor(vendorId, { page: 1, limit: 10 });
        assert.strictEqual(list.notifications.length, 1, 'Should return 1 notification');
        assert.strictEqual(list.pagination.total, 1, 'Total pagination should be 1');

        // 5. Mark as read
        const updated = await markAsRead(created._id, vendorId);
        assert.strictEqual(updated.read, true, 'Notification should now be marked read');

        // 6. Unread count goes back to 0
        const finalCount = await getUnreadCount(vendorId);
        assert.strictEqual(finalCount, 0, 'Unread count should be 0 after reading');
    });
});
