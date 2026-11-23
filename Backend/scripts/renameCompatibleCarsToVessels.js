/**
 * One-off migration: rename the fitment field `compatible_cars` → `compatible_vessels`
 * on products and catalog entries. The code now reads and writes only
 * `compatible_vessels`, so until this runs, existing documents look like they have no fitment.
 *
 * Safe to re-run: it only touches documents that still carry the old field.
 *
 *   node scripts/renameCompatibleCarsToVessels.js            # dry run — counts, writes nothing
 *   node scripts/renameCompatibleCarsToVessels.js --apply    # write
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const COLLECTIONS = ['products', 'catalogentries'];

const run = async () => {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    const db = mongoose.connection.db;
    console.log(`Connected to ${db.databaseName}. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

    for (const name of COLLECTIONS) {
        const col = db.collection(name);
        const filter = { compatible_cars: { $exists: true } };
        const pending = await col.countDocuments(filter);
        // A doc carrying both fields (written by new code before the migration) keeps the new one.
        const both = await col.countDocuments({ ...filter, compatible_vessels: { $exists: true } });
        console.log(`${name}: ${pending} doc(s) with compatible_cars (${both} already have compatible_vessels)`);
        if (!APPLY) continue;

        if (both) {
            const r = await col.updateMany({ ...filter, compatible_vessels: { $exists: true } }, { $unset: { compatible_cars: '' } });
            console.log(`  dropped old field on ${r.modifiedCount}`);
        }
        const r = await col.updateMany(filter, { $rename: { compatible_cars: 'compatible_vessels' } });
        console.log(`  renamed on ${r.modifiedCount}`);
    }

    await mongoose.disconnect();
};

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
