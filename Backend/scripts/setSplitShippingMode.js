/**
 * Switch shipping to per-parcel pricing ("split").
 *
 * ── Why this script exists ────────────────────────────────────────────────────────────
 * `ShippingSettings` is a singleton, and the seeder used to write `multi_vendor_mode:
 * 'combined'` into it EXPLICITLY. A stored value always beats a schema default, so raising
 * the default to "split" changed nothing for any installation that had already been seeded.
 * The stored row has to be rewritten, and this is that rewrite.
 *
 * ── What actually changes ─────────────────────────────────────────────────────────────
 * "combined" prices the whole basket once, then apportions that one figure across the
 * parcels. "split" prices each (vendor, branch) parcel on its own leg and sums the legs.
 *
 * That means the shipping method's `base_cost`, `min_fee` and `max_fee` apply PER PARCEL.
 * A three-vendor basket therefore pays roughly three times what it paid before. That is the
 * point — three parcels are three real deliveries and Bosta bills the store for all three —
 * but it IS a customer-facing price rise on multi-vendor orders, so the script prints the
 * exact before/after for your live methods and makes you pass --apply.
 *
 * Only NEW orders are affected. Existing orders carry a frozen shipping snapshot and are
 * never re-quoted.
 *
 * Run:
 *   node scripts/setSplitShippingMode.js              # show the impact, write nothing
 *   node scripts/setSplitShippingMode.js --apply      # switch to split
 *   node scripts/setSplitShippingMode.js --apply --combined   # switch back
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { ShippingSettings } = require('../models/shipping_settings');
const { ShippingMethod } = require('../models/shipping_methods');
const { ShippingZone } = require('../models/shipping_zones');

const APPLY = process.argv.includes('--apply');
const TARGET = process.argv.includes('--combined') ? 'combined' : 'split';

const money = (n) => Number(n || 0).toFixed(2);

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`Database: ${String(process.env.MONGO_URI).replace(/\/\/[^@]*@/, '//***@')}`);

    let settings = await ShippingSettings.findOne();
    if (!settings) {
        console.log('\nNo shipping settings row exists yet — the seeder will create one, and it');
        console.log('now takes the schema default ("split"). Nothing to do here.');
        await mongoose.disconnect();
        process.exit(0);
    }

    const current = settings.multi_vendor_mode || '(unset)';
    console.log(`\nCurrent mode : ${current}`);
    console.log(`Target mode  : ${TARGET}`);

    if (current === TARGET) {
        console.log('\nAlready set — nothing to change.');
        await mongoose.disconnect();
        process.exit(0);
    }

    // ---- Show what this does to real prices, using the live method config ----
    const methods = await ShippingMethod.find({ is_active: true }).lean();
    const zones = await ShippingZone.find().select('_id name').lean();
    const zoneName = new Map(zones.map((z) => [String(z._id), z.name]));

    if (methods.length === 0) {
        console.log('\nNo active shipping methods configured — cannot illustrate the impact.');
    } else {
        console.log('\nWhat a multi-vendor basket pays, per active method');
        console.log('(base cost only — real quotes also apply weight, rules and policies)\n');
        console.log('  method                          zone            1 parcel  2 parcels  3 parcels');
        console.log('  ' + '-'.repeat(76));
        for (const m of methods) {
            const base = Number(m.base_cost || 0);
            const min = m.min_fee == null ? 0 : Number(m.min_fee);
            const max = m.max_fee == null ? Infinity : Number(m.max_fee);
            const clamp = (v) => Math.min(max, Math.max(min, v));

            // combined: one leg for the basket. split: one leg per parcel, each clamped.
            const perCount = [1, 2, 3].map((n) =>
                TARGET === 'split' ? clamp(base) * n : clamp(base)
            );
            const name = String(m.name || '').slice(0, 30).padEnd(30);
            const zn = String(zoneName.get(String(m.zone_id)) || '—').slice(0, 14).padEnd(14);
            console.log(`  ${name}  ${zn}  ${money(perCount[0]).padStart(8)}  ${money(perCount[1]).padStart(9)}  ${money(perCount[2]).padStart(9)}`);
        }
        console.log('');
        if (TARGET === 'split') {
            console.log('  ⚠ These are the AFTER figures. Before the switch, every column reads the');
            console.log('    same as the "1 parcel" one, because the basket was priced once.');
        }
    }

    console.log('\nOnly NEW orders are affected — existing orders keep their frozen shipping snapshot.');

    if (!APPLY) {
        console.log('\nDry run — nothing was written. Re-run with --apply to switch.');
        await mongoose.disconnect();
        process.exit(0);
    }

    settings.multi_vendor_mode = TARGET;
    await settings.save();

    // The engine memoises settings for 5 seconds and caches quotes for longer, so a running
    // server would otherwise keep quoting the old mode until both expire.
    try {
        require('../services/shippingEngine').invalidateShippingCache();
    } catch (_) { /* not loaded in this process — a running server clears its own on next save */ }

    console.log(`\nDone — shipping is now priced "${TARGET}".`);
    console.log('If the API is running, restart it (or save the shipping settings screen once)');
    console.log('so its in-process quote cache is cleared.');

    await mongoose.disconnect();
    process.exit(0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
