const bostaWebhookRouter = require('./bosta_webhook.router');
const arriveWebhookRouter = require('./arrive_webhook.router');
const paymobWebhookRouter = require('./paymob_webhook.router');
const paymobPayoutWebhookRouter = require('./paymob_payout_webhook.router');
const everysecondWebhookRouter = require('./everysecond_webhook.router');

module.exports = {
    bostaWebhookRouter,
    arriveWebhookRouter,
    paymobWebhookRouter,
    paymobPayoutWebhookRouter,
    everysecondWebhookRouter,
};
