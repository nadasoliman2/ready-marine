/**
 * EverySecond chat commerce — Backend/docs/EVERYSECOND_CHAT_COMMERCE.md.
 *
 *   catalogue → agent   catalogSync.syncCatalog()   every EVERYSECOND_SYNC_MINUTES
 *   agent → store       orders.validateOrder()      order.validate webhook, ≤ 4 s
 *                       orders.receiveEvent()       order.created / failed / cancelled
 *   store → customer    orders.sweepStatusAnnouncements()
 *   website chat        assistant.*                 /api/assistant
 */
const { api, isConfigured } = require('./client');
const { syncCatalog, getLastSync } = require('./catalogSync');
const orders = require('./orders');
const { EverySecondEvent, EverySecondMenuItem } = require('../../models/everysecond');
const { Order } = require('../../models/orders');

const WEBHOOK_EVENTS = ['order.validate', 'order.created', 'order.failed', 'order.cancelled'];

async function getStatus() {
    const [byStatus, recentEvents, menuItems, menuErrors, chatOrders] = await Promise.all([
        EverySecondEvent.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
        EverySecondEvent.find({}).sort({ created_at: -1 }).limit(15).select('-payload').lean(),
        EverySecondMenuItem.countDocuments({ error: '' }),
        EverySecondMenuItem.countDocuments({ error: { $ne: '' } }),
        Order.countDocuments({ source: 'everysecond' }),
    ]);
    return {
        configured: isConfigured(),
        webhook_secret_set: Boolean(process.env.EVERYSECOND_WEBHOOK_SECRET),
        sync_every_minutes: Number(process.env.EVERYSECOND_SYNC_MINUTES ?? 10),
        last_sync: getLastSync(),
        menu: { items: menuItems, errors: menuErrors },
        chat_orders: chatOrders,
        events: Object.fromEntries(byStatus.map((row) => [row._id, row.count])),
        recent_events: recentEvents,
    };
}

/** Register the endpoint EverySecond delivers to. The answer carries the whsec_ secret. */
const registerWebhook = (url) => api('POST', '/webhooks', { name: 'Ready Marine store backend', url, events: WEBHOOK_EVENTS });
const listWebhooks = () => api('GET', '/webhooks');

module.exports = {
    isConfigured,
    syncCatalog,
    getStatus,
    registerWebhook,
    listWebhooks,
    WEBHOOK_EVENTS,
    ...orders,
};
