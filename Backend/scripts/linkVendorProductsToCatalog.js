#!/usr/bin/env node
/* ------------------ Link a vendor's products to the central catalog ------------------
 *
 *   node scripts/linkVendorProductsToCatalog.js            # dry run
 *   node scripts/linkVendorProductsToCatalog.js --apply
 *
 * Scope: the 79 X-Turbo Auto Parts products whose title names their maker
 * ("… - AGO", "… - BOSCH"). Everything else this vendor sells is left alone.
 *
 * The decisions live in ./vendorCatalogLinks.js and were made by reading each
 * title against each catalog entry, not by matching part numbers — see the note
 * at the top of that file for why the numbers cannot be trusted here.
 *
 * This script ONLY sets catalog_entry_id on products. It never creates, edits,
 * merges or renames a catalog entry — the catalog is the template library that
 * products attach to, and a product with no counterpart there stays unlinked
 * rather than having one minted from its own title.
 *
 * Linking goes through catalogService.relinkProduct so the entry is validated as
 * selectable rather than writing catalog_entry_id straight onto the product.
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { CatalogEntry } = require('../models/catalogEntries');
const { Product } = require('../models/products');
const { Brand } = require('../models/product_brands');
const catalogService = require('../services/catalogService');
const { LINK, BOSCH_BY_PART, UNRESOLVED, NO_CATALOG_MATCH } = require('./vendorCatalogLinks');

const APPLY = process.argv.includes('--apply');
const norm = (s) => (s || '').toString().toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim();
const say = (...a) => console.log(...a);

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    say(`MODE: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (nothing will be written)'}\n`);

    const boschBrand = await Brand.findOne({ name: 'bosch' });

    /* ---- link ---- */
    say('--- Linking products to entries the catalog already has ---');
    const targets = { ...LINK };

    // Bosch: resolve by the normalised part number, then confirm the entry exists.
    for (const [vendorPn, catalogPn] of Object.entries(BOSCH_BY_PART)) {
        const product = await Product.findOne({ part_number: vendorPn }, { _id: 1, title_ar: 1 }).lean();
        const entry = await CatalogEntry.findOne({ product_brand_id: boschBrand._id, part_number: catalogPn, status: 'approved' }, { _id: 1, title_en: 1 }).lean();
        if (!product) { say(`  ! no product with part number ${vendorPn}`); continue; }
        if (!entry) { say(`  ! no Bosch entry ${catalogPn}`); continue; }
        say(`  ${product.title_ar}\n      → ${entry.title_en}`);
        targets[product._id.toString()] = entry._id;
    }

    let linked = 0, failed = 0, shown = 0;
    for (const [productId, entryId] of Object.entries(targets)) {
        try {
            if (APPLY) await catalogService.relinkProduct(productId, entryId.toString());
            else {
                const e = await catalogService.getSelectableEntry(entryId.toString());
                if (!e) throw new Error('entry not selectable');
            }
            linked++;
            if (shown++ < 3) {
                const p = await Product.findById(productId, { title_ar: 1 }).lean();
                const e = await CatalogEntry.findById(entryId, { title_ar: 1 }).lean();
                say(`  ${p?.title_ar}  →  ${e?.title_ar}`);
            }
        } catch (err) { failed++; say(`  FAILED ${productId}: ${err.message}`); }
    }

    /* ---- report ---- */
    say('\n--- Summary ---');
    say(`Products linked                : ${linked}`);
    say(`No counterpart in the catalog  : ${NO_CATALOG_MATCH.length}  (left unlinked on purpose)`);
    if (failed) say(`Failed                         : ${failed}`);
    for (const pn of UNRESOLVED) {
        const p = await Product.findOne({ part_number: pn }, { title_ar: 1 }).lean();
        say(`Left unlinked on purpose       : ${p ? p.title_ar : pn}`);
    }

    if (APPLY) {
        const vendorId = (await Product.findOne({ title_ar: /AGO/i }, { vendor_id: 1 }).lean())?.vendor_id;
        say(`\nThis vendor's products now linked: ${await Product.countDocuments({ vendor_id: vendorId, catalog_entry_id: { $ne: null } })}`);
    } else say('\nDry run — nothing was written. Re-run with --apply.');

    await mongoose.disconnect();
})().catch((err) => { console.error(err); process.exit(1); });
