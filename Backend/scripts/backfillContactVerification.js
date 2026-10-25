/**
 * One-off backfill: mark existing customers' EMAIL as already verified.
 *
 * Why this is safe: before contact verification existed, the only ways to get a
 * `User` row were the emailed registration link and the family-invitation flow.
 * Both prove control of the mailbox, so every pre-existing account has in fact
 * verified its email — it simply predates the field.
 *
 * Phone is deliberately NOT backfilled: it was never proven for anyone, so
 * those accounts should be prompted.
 *
 * Run ONCE, at deploy, before customers start registering via WhatsApp:
 *   node scripts/backfillContactVerification.js            # dry run
 *   node scripts/backfillContactVerification.js --apply    # write
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { User } = require('../models/users');

const APPLY = process.argv.includes('--apply');

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`Database: ${process.env.MONGO_URI.replace(/\/\/[^@]*@/, '//***@')}`);

    const filter = { email_verified_at: null };
    const total = await User.countDocuments();
    const affected = await User.countDocuments(filter);

    console.log(`Customers total          : ${total}`);
    console.log(`Missing email_verified_at: ${affected}`);
    console.log(`Phone stays unverified   : ${await User.countDocuments({ phone_verified_at: null })} (prompted after login)`);

    if (!APPLY) {
        console.log('\nDry run — nothing written. Re-run with --apply to backfill.');
        await mongoose.disconnect();
        return;
    }

    // Stamp with the account's own creation time rather than "now", so the
    // record reflects when the mailbox was actually proven.
    const result = await User.updateMany(filter, [
        { $set: { email_verified_at: '$created_at' } },
    ]);

    console.log(`\nBackfilled ${result.modifiedCount} account(s).`);
    await mongoose.disconnect();
})().catch(async (err) => {
    console.error('Backfill failed:', err.message);
    try { await mongoose.disconnect(); } catch (_) {}
    process.exit(1);
});
