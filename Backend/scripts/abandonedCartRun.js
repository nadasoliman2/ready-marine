/**
 * Run the abandoned-cart reminder sweep once, now, outside the schedule.
 *
 *   node scripts/abandonedCartRun.js --dry-run   # who would be emailed; sends and records nothing
 *   node scripts/abandonedCartRun.js             # a real run, same rules as the cron
 *
 * Reads MONGO_URI, REDIS_URL, RESEND_TOKEN from the environment, and the schedule settings the
 * admin saved (falling back to ABANDONED_CART_*). Being switched on is not required here:
 * running the script is the decision.
 * This process holds no sockets, so online status comes from the server's entries in Redis.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { effectiveConfig, runAbandonedCartReminders } = require('../services/abandonedCartService');
const { closeRedis, getRedis } = require('../services/redisClient');

const main = async () => {
    const dryRun = process.argv.includes('--dry-run');
    await mongoose.connect(process.env.MONGO_URI);
    // The admin's saved settings over the environment, as the schedule uses them.
    const { config, errors } = await effectiveConfig();
    if (errors.length > 0) throw new Error(errors.join('; '));

    const redis = getRedis();
    if (redis && redis.status !== 'ready') {
        await new Promise((resolve) => { redis.once('ready', resolve); setTimeout(resolve, 5000); });
    }
    const result = await runAbandonedCartReminders({ config, dryRun });
    console.log(JSON.stringify(result, null, 2));
};

main()
    .catch((err) => { console.error(err.message); process.exitCode = 1; })
    .finally(async () => { await closeRedis(); await mongoose.disconnect(); });
