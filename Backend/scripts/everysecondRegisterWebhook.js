/**
 * Register this backend's webhook with the EverySecond agent.
 *
 *   node scripts/everysecondRegisterWebhook.js https://readycar.store/api/webhooks/everysecond
 *   node scripts/everysecondRegisterWebhook.js --list
 *
 * Prints the endpoint's secret (whsec_…) once: put it in Backend/.env as
 * EVERYSECOND_WEBHOOK_SECRET and restart the backend. EverySecond only delivers
 * to a public https host — never localhost or an IP.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { registerWebhook, listWebhooks, WEBHOOK_EVENTS } = require('../services/everysecond');

(async () => {
    if (!process.env.EVERYSECOND_API_KEY) throw new Error('EVERYSECOND_API_KEY is not set.');
    if (process.argv.includes('--list')) {
        console.log(JSON.stringify(await listWebhooks(), null, 2));
        return;
    }
    const url = process.argv.slice(2).find((a) => /^https:\/\//.test(a));
    if (!url) throw new Error('Pass the public https URL of /api/webhooks/everysecond.');
    const res = await registerWebhook(url);
    const secret = res?.secret || res?.data?.secret || res?.webhook?.secret;
    console.log(`Registered ${url} for ${WEBHOOK_EVENTS.join(', ')}.`);
    console.log(secret ? `EVERYSECOND_WEBHOOK_SECRET=${secret}` : JSON.stringify(res, null, 2));
})().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
