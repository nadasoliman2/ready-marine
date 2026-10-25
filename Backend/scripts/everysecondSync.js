/**
 * Push the catalogue to the EverySecond agent's menu now.
 *
 *   node scripts/everysecondSync.js              only what changed since the last push
 *   node scripts/everysecondSync.js --reconcile  compare with what EverySecond holds first
 *
 * Uses EVERYSECOND_API_KEY from Backend/.env — make sure it is the agent you mean
 * (a test agent for a local database, never the live one).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { syncCatalog } = require('../services/everysecond');

(async () => {
    if (!process.env.EVERYSECOND_API_KEY) {
        console.error('EVERYSECOND_API_KEY is not set.');
        process.exit(1);
    }
    await mongoose.connect(process.env.MONGO_URI);
    try {
        const result = await syncCatalog({ reconcile: process.argv.includes('--reconcile') });
        console.log(JSON.stringify(result, null, 2));
    } finally {
        await mongoose.disconnect();
    }
})().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
