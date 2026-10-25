/**
 * Rebuild the users email index so accounts without an email are legal.
 *
 * Guest checkout creates accounts from a shipping form, which never asks for an
 * email. The existing index is a plain `unique` on `email`, and under that
 * index the FIRST emailless account inserted would claim the one "missing"
 * slot and every guest after it would fail with a duplicate-key error.
 *
 * A sparse index does not fix this: sparse skips only an ABSENT field, while an
 * explicit `null` is a value and is still indexed. The partial index below is
 * restricted to documents whose email is actually a string, so absent and null
 * are both simply outside the index.
 *
 * Idempotent — safe to re-run. Reports and stops if real duplicate emails exist,
 * because dropping a unique index over dirty data would silently permit them.
 *
 *   node scripts/migrateGuestCheckoutIndexes.js            # dry run
 *   node scripts/migrateGuestCheckoutIndexes.js --apply    # write
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { User } = require('../models/users');

const APPLY = process.argv.includes('--apply');
const TARGET_NAME = 'email_1';
const PARTIAL_FILTER = { email: { $type: 'string' } };

const isAlreadyPartial = (index) =>
    !!index.partialFilterExpression
    && JSON.stringify(index.partialFilterExpression) === JSON.stringify(PARTIAL_FILTER);

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`Database: ${String(process.env.MONGO_URI).replace(/\/\/[^@]*@/, '//***@')}`);

    const collection = User.collection;
    const indexes = await collection.indexes();
    const emailIndex = indexes.find((i) => i.name === TARGET_NAME || (i.key && i.key.email === 1 && Object.keys(i.key).length === 1));

    console.log(`\nCurrent email index: ${emailIndex ? JSON.stringify({ name: emailIndex.name, unique: !!emailIndex.unique, sparse: !!emailIndex.sparse, partial: emailIndex.partialFilterExpression || null }) : 'none'}`);

    if (emailIndex && isAlreadyPartial(emailIndex) && emailIndex.unique) {
        console.log('Already a unique partial index — nothing to do.');
        await mongoose.disconnect();
        return;
    }

    // A unique index is the only thing currently preventing duplicate emails.
    // Verify the data is clean BEFORE dropping it, or the drop is the moment
    // duplicates become possible and nobody finds out until much later.
    const duplicates = await collection.aggregate([
        { $match: { email: { $type: 'string' } } },
        { $group: { _id: '$email', count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $limit: 20 },
    ]).toArray();

    if (duplicates.length > 0) {
        console.error(`\nAborting: ${duplicates.length}+ duplicate email(s) already present.`);
        duplicates.forEach((d) => console.error(`  ${d._id} × ${d.count}`));
        console.error('Resolve these first — recreating a unique index over them will fail anyway.');
        await mongoose.disconnect();
        process.exitCode = 1;
        return;
    }

    const missingStatus = await User.countDocuments({ account_status: { $exists: false } });
    console.log(`Accounts total                  : ${await User.countDocuments()}`);
    console.log(`Accounts without account_status : ${missingStatus} (default to 'active')`);
    console.log(`Duplicate emails                : 0`);

    if (!APPLY) {
        console.log('\nDry run — nothing written. Re-run with --apply.');
        await mongoose.disconnect();
        return;
    }

    if (emailIndex) {
        console.log(`\nDropping ${emailIndex.name}…`);
        await collection.dropIndex(emailIndex.name);
    }

    console.log('Creating unique partial index on email…');
    await collection.createIndex({ email: 1 }, {
        unique: true,
        partialFilterExpression: PARTIAL_FILTER,
        name: TARGET_NAME,
    });

    // Existing rows predate the field. They are all real accounts, so 'active'
    // is the correct value — written explicitly rather than left to the schema
    // default so the index below actually covers them.
    if (missingStatus > 0) {
        const res = await User.updateMany(
            { account_status: { $exists: false } },
            { $set: { account_status: 'active' } }
        );
        console.log(`Stamped account_status='active' on ${res.modifiedCount} existing account(s).`);
    }

    await collection.createIndex({ account_status: 1 });

    console.log('\nDone. Final indexes:');
    (await collection.indexes()).forEach((i) => console.log(`  ${i.name} ${JSON.stringify(i.key)}${i.unique ? ' unique' : ''}${i.partialFilterExpression ? ' partial' : ''}`));

    await mongoose.disconnect();
})().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
});
