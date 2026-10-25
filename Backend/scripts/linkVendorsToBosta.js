#!/usr/bin/env node
/**
 * Backfill: register every vendor location that has no Bosta pickup location yet.
 *
 * A location with no `bosta_location_id` can never have a courier sent to it — the order
 * ships, but nobody is dispatched to collect it. Signup links new vendors automatically
 * and an hourly sweep catches stragglers; this script is for the ones that predate both.
 *
 * Run against whichever environment the env vars point at — the Bosta ids it writes belong
 * to that account, so a staging run must use a staging database.
 *
 *   node scripts/linkVendorsToBosta.js            # report only, changes nothing
 *   node scripts/linkVendorsToBosta.js --apply    # create the locations and save the ids
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { Seller } = require('../models/sellers');
const { City } = require('../models/cities');

const APPLY = process.argv.includes('--apply');
const { MIN_FIRST_LINE } = require('../services/bostaService');

(async () => {
  const uri = process.env.MONGO_URI;
  const bostaBase = process.env.BOSTA_BASE_URL || 'https://app.bosta.co';
  if (!uri) throw new Error('MONGO_URI is not set');
  if (!process.env.BOSTA_API_KEY) throw new Error('BOSTA_API_KEY is not set');

  console.log(`Database : ${uri.replace(/\/\/[^@]*@/, '//***@')}`);
  console.log(`Bosta    : ${bostaBase}`);
  console.log(`Mode     : ${APPLY ? 'APPLY — will create locations on Bosta' : 'DRY RUN — no changes'}\n`);

  await mongoose.connect(uri);

  const vendors = await Seller.find({ 'locations.bosta_location_id': null });
  const cityNames = new Set((await City.find().select('name').lean()).map((c) => c.name));

  const linkable = [];
  const blocked = [];
  for (const vendor of vendors) {
    for (const loc of vendor.locations || []) {
      if (loc.bosta_location_id) continue;
      const label = `${vendor.store_name || vendor.name} / "${loc.address}"`;
      if (!loc.shipping_city) blocked.push(`${label} — no city set`);
      else if (!cityNames.has(loc.shipping_city)) blocked.push(`${label} — "${loc.shipping_city}" is not a known Bosta city`);
      else if ((loc.address || '').trim().length < MIN_FIRST_LINE) blocked.push(`${label} — address is under ${MIN_FIRST_LINE} characters`);
      else linkable.push({ vendor, loc });
    }
  }

  console.log(`Unlinked locations : ${linkable.length + blocked.length}`);
  console.log(`  linkable now     : ${linkable.length}`);
  console.log(`  needs a human    : ${blocked.length}`);
  if (blocked.length) {
    console.log('\nCannot be linked automatically:');
    for (const b of blocked) console.log(`  ✗ ${b}`);
  }

  if (!APPLY) {
    console.log('\nDry run — re-run with --apply to create these on Bosta.');
    if (linkable.length) {
      console.log('\nWould link:');
      for (const { vendor, loc } of linkable) {
        console.log(`  • ${vendor.store_name || vendor.name} / "${loc.address}" (${loc.shipping_city})`);
      }
    }
    await mongoose.disconnect();
    return;
  }

  // Grouped per vendor so one vendor's failure doesn't strand the rest.
  const { linkVendorLocationsToBosta } = require('../services/vendorService');
  const byVendor = new Map();
  for (const { vendor } of linkable) byVendor.set(vendor._id.toString(), vendor);

  let linked = 0;
  const failures = [];
  for (const vendor of byVendor.values()) {
    const result = await linkVendorLocationsToBosta(vendor);
    linked += result.linked;
    for (const s of result.skipped) failures.push(`${vendor.store_name || vendor.name} / "${s.address}": ${s.reason}`);
  }

  console.log(`\nLinked ${linked} location(s).`);
  if (failures.length) {
    console.log('Failed:');
    for (const f of failures) console.log(`  ✗ ${f}`);
  }

  const stillUnlinked = await Seller.countDocuments({ 'locations.bosta_location_id': null });
  console.log(`Vendors still holding an unlinked location: ${stillUnlinked}`);

  await mongoose.disconnect();
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
