#!/usr/bin/env node
/**
 * One-off: give every linked vendor branch on Bosta its store name.
 *
 * Branches were registered on Bosta under their street address alone, so an admin
 * searching Bosta's dashboard for a store found nothing — and created a second location
 * for the same branch by hand. New and edited branches now get "Store — address"
 * (bostaService.pickupLocationName); this brings the existing ones in line.
 *
 * Only the name changes. The address and the contact are sent back exactly as Bosta holds
 * them — someone may have corrected them on Bosta's side — so nothing else moves.
 *
 *   node scripts/renameBostaPickupLocations.js            # report only, changes nothing
 *   node scripts/renameBostaPickupLocations.js --apply    # rename on Bosta
 *   node scripts/renameBostaPickupLocations.js --apply --only=<bosta id>   # one branch first
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { Seller } = require('../models/sellers');
const { listPickupLocations, updatePickupLocation, pickupLocationName } = require('../services/bostaService');

const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length) || null;

/** The PUT body Bosta needs, rebuilt from what its list returned, with a new name. */
const sameLocationRenamed = (live, locationName) => {
  const [firstName, ...rest] = String(live.contactPerson?.name || '').trim().split(/\s+/);
  const address = live.address || {};
  return {
    locationName,
    contacts: live.contactPerson ? [{
      firstName: firstName || 'Vendor',
      lastName: rest.join(' ') || 'Store',
      phone: live.contactPerson.phone || '',
      ...(live.contactPerson.email ? { email: live.contactPerson.email } : {}),
      isDefault: true,
    }] : [],
    address: {
      city: address.city?.name || '',
      firstLine: address.firstLine || '',
      secondLine: address.secondLine || '',
      floor: address.floor || '',
      apartment: address.apartment || '',
      buildingNumber: address.buildingNumber || '',
      // Not the zone: Bosta refuses an update that names it ("not authorized to update
      // param address.zoneId") and keeps it when it is left out.
      ...(address.district?._id ? { districtId: address.district._id } : {}),
    },
  };
};

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');
  if (!process.env.BOSTA_API_KEY) throw new Error('BOSTA_API_KEY is not set');
  console.log(`Mode : ${APPLY ? 'APPLY — will rename locations on Bosta' : 'DRY RUN — no changes'}\n`);

  await mongoose.connect(uri);
  const live = new Map((await listPickupLocations()).map((l) => [String(l._id), l]));
  const vendors = await Seller.find({ 'locations.bosta_location_id': { $ne: null } }).select('store_name name locations').lean();

  const rename = [];
  const missing = [];
  let alreadyNamed = 0;
  for (const vendor of vendors) {
    for (const loc of vendor.locations || []) {
      if (!loc.bosta_location_id) continue;
      if (ONLY && String(loc.bosta_location_id) !== ONLY) continue;
      const onBosta = live.get(String(loc.bosta_location_id));
      if (!onBosta) {
        missing.push(`${vendor.store_name || vendor.name} / "${loc.address}" (${loc.bosta_location_id})`);
        continue;
      }
      const name = pickupLocationName(loc, { store_name: vendor.store_name || vendor.name });
      if (onBosta.locationName === name) { alreadyNamed += 1; continue; }
      rename.push({ id: String(loc.bosta_location_id), from: onBosta.locationName, to: name, body: sameLocationRenamed(onBosta, name) });
    }
  }

  console.log(`Linked branches on Bosta : ${rename.length + alreadyNamed}`);
  console.log(`  already named          : ${alreadyNamed}`);
  console.log(`  to rename              : ${rename.length}`);
  if (missing.length) {
    console.log(`\nLinked here but not on Bosta (the hourly sweep re-registers these): ${missing.length}`);
    for (const m of missing) console.log(`  ? ${m}`);
  }
  for (const r of rename) console.log(`  ${r.id}: "${r.from}"  →  "${r.to}"`);

  if (!APPLY) {
    console.log('\nDry run — re-run with --apply to rename these on Bosta.');
    await mongoose.disconnect();
    return;
  }

  let done = 0;
  const failed = [];
  for (const r of rename) {
    try {
      await updatePickupLocation(r.id, r.body);
      done += 1;
    } catch (err) {
      failed.push(`${r.id} ("${r.to}"): ${err.message}`);
    }
  }
  console.log(`\nRenamed ${done} of ${rename.length}.`);
  for (const f of failed) console.log(`  ✗ ${f}`);
  await mongoose.disconnect();
  if (failed.length) process.exitCode = 1;
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
