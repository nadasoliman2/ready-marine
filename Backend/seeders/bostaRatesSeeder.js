/**
 * Bosta rates seeder — turns `services/bostaTariff.js` into the shipping configuration the
 * checkout actually prices from.
 *
 *   node Backend/seeders/bostaRatesSeeder.js            # show what would change
 *   node Backend/seeders/bostaRatesSeeder.js --apply    # write it
 *
 * What it writes, and why it is shaped this way:
 *
 *   CLASSES — one per Bosta pricing size. A product's shipping class IS its Bosta size;
 *     there is no second vocabulary to keep in sync. Anything left unclassified is Normal,
 *     which is both the default and the overwhelming majority.
 *
 *   ZONES — one per Bosta sector, not one per country. Bosta's rate table is keyed on the
 *     destination sector, so a single "Egypt" zone cannot express the price: Cairo and
 *     Aswan differ by 72 EGP for the same parcel.
 *
 *   METHODS — one rule-engine method per zone. `base_cost` is the Normal rate, and one rule
 *     per larger size overrides it with `set_cost` + `stop_processing`. The rules run
 *     largest-first, so a parcel holding a Heavy Bulky item and three Normal ones prices as
 *     Heavy Bulky — which is how the courier will bill the box. `min_fee` stays 0 on
 *     purpose: a non-zero floor is re-applied AFTER policies run, which would quietly undo
 *     any free-shipping policy the admin later switches on.
 *
 *   POLICY — the extra-COD surcharge, global so it applies in all seven zones at once.
 *
 * Re-running is safe. Zones, methods and the policy are matched by name and updated in
 * place, so the ids survive and nothing that references them breaks.
 */

require("dotenv").config({ path: __dirname + "/../.env" });
const mongoose = require("mongoose");
const tariff = require("../services/bostaTariff");
const { City } = require("../models/cities");
const { ShippingClass } = require("../models/shipping_classes");
const { ShippingZone } = require("../models/shipping_zones");
const { ShippingMethod } = require("../models/shipping_methods");
const { ShippingPolicy } = require("../models/shipping_policies");

// Dry run unless told otherwise, because this rewrites live customer-facing prices.
// `seed({ apply: true })` is the programmatic equivalent of the `--apply` flag.
const APPLY_FROM_ARGV = process.argv.includes("--apply");
let APPLY = APPLY_FROM_ARGV;

// Names are the join key between runs, so they are constants rather than literals.
const ZONE_NAME = (sector) => `Egypt — ${sector.name}`;
const ZONE_NAME_AR = (sector) => `مصر — ${sector.name_ar}`;
const METHOD_NAME = "Bosta standard delivery";
const METHOD_NAME_AR = "توصيل بوسطة القياسي";
const COD_POLICY_NAME = "Bosta extra-COD surcharge";
const LEGACY_ZONE_NAME = "Egypt";

// Bosta quotes 1-3 working days inside Cairo/Giza and longer the further out the sector is.
const ETA_BY_SECTOR = {
    1: [1, 3], 2: [2, 4], 3: [2, 4], 4: [3, 5], 5: [3, 6], 6: [3, 6], 7: [4, 7],
};

const log = [];
const record = (line) => { log.push(line); console.log(line); };

/* ---------------------------------------------------------------- classes */

async function seedClasses() {
    const byKey = new Map();
    for (const size of tariff.SIZES) {
        let doc = await ShippingClass.findOne({ name: size.name }).collation({ locale: "en", strength: 2 });
        const fields = {
            name: size.name,
            name_ar: size.name_ar,
            description: size.description,
            default_handling_fee: 0,
            is_active: true,
        };
        if (!doc) {
            record(`  + class "${size.name}"`);
            if (APPLY) doc = await ShippingClass.create(fields);
            else doc = { _id: `new:${size.key}`, ...fields };
        } else if (doc.description !== size.description || doc.name_ar !== size.name_ar) {
            record(`  ~ class "${size.name}" (description/name_ar refreshed)`);
            if (APPLY) { Object.assign(doc, fields); await doc.save(); }
        }
        byKey.set(size.key, doc._id);
    }
    return byKey;
}

/* ------------------------------------------------------------------ cities */

async function stampCitySectors() {
    let changed = 0;
    for (const city of tariff.allCities()) {
        const doc = await City.findOne({ name: city.name });
        if (!doc) { record(`  ! city "${city.name}" is not in the City collection — run citySeeder first`); continue; }
        if (doc.bosta_sector === city.sector) continue;
        changed++;
        if (APPLY) { doc.bosta_sector = city.sector; await doc.save(); }
    }
    record(`  ${changed === 0 ? "=" : "~"} ${changed} city sector stamps`);
}

/* ------------------------------------------------------------------- zones */

async function seedZone(sector) {
    const locations = sector.cities.map((c) => ({
        country: "Egypt", country_ar: "مصر", city: c.name, city_ar: c.name_ar,
    }));
    let zone = await ShippingZone.findOne({ name: ZONE_NAME(sector) });
    if (!zone) {
        record(`  + zone "${ZONE_NAME(sector)}" (${locations.length} cities)`);
        if (!APPLY) return { _id: `new:zone:${sector.id}` };
        return ShippingZone.create({
            name: ZONE_NAME(sector),
            name_ar: ZONE_NAME_AR(sector),
            is_active: true,
            // Every city belongs to exactly one sector, so no two zones can both claim a
            // destination and the priority never has to break a tie. It mirrors the sector
            // id purely so the admin list reads in Bosta's own order.
            priority: sector.id,
            locations,
        });
    }
    const same = zone.locations.length === locations.length
        && locations.every((l) => zone.locations.some((z) => z.city === l.city));
    if (!same || zone.priority !== sector.id || !zone.is_active) {
        record(`  ~ zone "${ZONE_NAME(sector)}" (cities/priority refreshed)`);
        if (APPLY) {
            zone.locations = locations;
            zone.name_ar = ZONE_NAME_AR(sector);
            zone.priority = sector.id;
            zone.is_active = true;
            await zone.save();
        }
    }
    return zone;
}

/* ----------------------------------------------------------------- methods */

/**
 * Every shipping class in the database that denotes a size, grouped by the size it denotes.
 * Read from the collection rather than from the tariff so that a legacy class an admin is
 * still using (`Heavy`) gets the same rate as the Bosta class it is declared as
 * (`Heavy Bulky`) — otherwise we would charge for a Normal parcel and be billed for a bulky
 * one. Classes that say nothing about size (Fragile, Perishable, Light) are simply absent,
 * which leaves anything carrying only those priced as Normal.
 */
async function sizeClassGroups(seeded) {
    const groups = new Map();
    const add = (key, id, name) => {
        if (!groups.has(key)) groups.set(key, []);
        if (!groups.get(key).some((c) => c.id === id)) groups.get(key).push({ id, name });
    };
    // The canonical Bosta class for each size first, so a dry run (where those classes do
    // not exist yet) still shows the rules the apply would write.
    for (const size of tariff.SIZES) add(size.key, String(seeded.get(size.key)), size.name);
    for (const cls of await ShippingClass.find().select("name").lean()) {
        const key = tariff.sizeKeyForClassName(cls.name);
        if (key) add(key, String(cls._id), cls.name);
    }
    return groups;
}

/**
 * The rate rules for one sector: every size ABOVE Normal, largest first, each one setting
 * the whole cost and stopping. Normal itself is the method's `base_cost`, so a parcel that
 * matches no rule is already priced.
 */
function buildRules(sector, groups) {
    return tariff.SIZES
        .filter((size) => size.key !== tariff.DEFAULT_SIZE_KEY)
        .map((size, index) => ({ size, index, classes: groups.get(size.key) || [] }))
        .filter(({ classes }) => classes.length > 0)
        .map(({ size, index, classes }) => ({
            name: `${size.name} parcel`,
            priority: index,          // SIZES is ordered largest-priced first
            stop_processing: true,    // the biggest size present wins; nothing stacks
            condition_logic: "all",
            conditions: [{ field: "has_class", operator: "in", value: classes.map((c) => c.id) }],
            actions: [{ type: "set_cost", value: tariff.retailRate(sector.id, size.key) }],
        }));
}

async function seedMethod(sector, zone, groups) {
    const [etaMin, etaMax] = ETA_BY_SECTOR[sector.id] || [2, 5];
    const fields = {
        zone_id: zone._id,
        name: METHOD_NAME,
        name_ar: METHOD_NAME_AR,
        type: "rule_engine",
        is_active: true,
        sort_order: 0,
        delivery_time_min_days: etaMin,
        delivery_time_max_days: etaMax,
        base_cost: tariff.retailRate(sector.id, tariff.DEFAULT_SIZE_KEY),
        // Left at 0 deliberately — see the header note on free-shipping policies.
        min_fee: 0,
        max_fee: null,
        rule_config: { rules: buildRules(sector, groups) },
    };

    if (!APPLY && String(zone._id).startsWith("new:")) {
        record(`  + method "${METHOD_NAME}" in ${ZONE_NAME(sector)} — base ${fields.base_cost}`);
        return;
    }

    const existing = await ShippingMethod.findOne({ zone_id: zone._id, name: METHOD_NAME });
    if (!existing) {
        record(`  + method "${METHOD_NAME}" in ${ZONE_NAME(sector)} — base ${fields.base_cost}`);
        if (APPLY) await ShippingMethod.create(fields);
        return;
    }
    record(`  ~ method "${METHOD_NAME}" in ${ZONE_NAME(sector)} — base ${existing.base_cost} -> ${fields.base_cost}`);
    if (APPLY) { Object.assign(existing, fields); await existing.save(); }
}

/* ---------------------------------------------------------------- policies */

async function seedCodPolicy() {
    const fee = tariff.FEES.extra_cod;
    // Bosta charges 1% of the excess and then VAT on that fee, so the customer-facing
    // percentage is the fee grossed up — 1.14%, not 1%.
    const percent = Number((fee.percentage * 100 * (1 + tariff.VAT_RATE)).toFixed(4));
    const fields = {
        name: COD_POLICY_NAME,
        name_ar: "رسوم بوسطة الإضافية للتحصيل",
        is_active: fee.enabled,
        // Runs after any free-shipping or discount policy, so the surcharge lands on the
        // final figure rather than on one a later policy will discard.
        priority: 100,
        scope: "global",
        zone_id: null,
        applies_to: { shipping_class_ids: [], vendor_ids: [], category_ids: [] },
        condition_logic: "all",
        conditions: [{ field: "cart_total_after_discount", operator: "gt", value: fee.free_up_to }],
        actions: [{ type: "surcharge_percent_above", value: percent, threshold: fee.free_up_to }],
    };
    const existing = await ShippingPolicy.findOne({ name: COD_POLICY_NAME });
    if (!existing) {
        record(`  + policy "${COD_POLICY_NAME}" — ${percent}% above ${fee.free_up_to} EGP`);
        if (APPLY) await ShippingPolicy.create(fields);
        return;
    }
    record(`  ~ policy "${COD_POLICY_NAME}" — ${percent}% above ${fee.free_up_to} EGP`);
    if (APPLY) { Object.assign(existing, fields); await existing.save(); }
}

/* ------------------------------------------------------------------ legacy */

/**
 * The old single "Egypt" zone covered all 28 cities at one flat rate. It is deactivated
 * rather than deleted: orders keep a frozen `config_snapshot`, but the zone id is still
 * worth keeping resolvable for anything that reads history. An inactive zone is invisible
 * to `resolveZoneForDestination`, so it cannot shadow the sector zones.
 */
async function retireLegacyZone() {
    const zone = await ShippingZone.findOne({ name: LEGACY_ZONE_NAME });
    if (!zone) return;
    if (!zone.is_active) { record(`  = legacy zone "${LEGACY_ZONE_NAME}" already retired`); return; }
    record(`  ~ legacy zone "${LEGACY_ZONE_NAME}" -> inactive (and its methods)`);
    if (!APPLY) return;
    zone.is_active = false;
    zone.name = `${LEGACY_ZONE_NAME} (legacy — replaced by Bosta sectors)`;
    await zone.save();
    await ShippingMethod.updateMany({ zone_id: zone._id }, { $set: { is_active: false } });
}

/* -------------------------------------------------------------------- main */

async function seed({ apply = APPLY_FROM_ARGV } = {}) {
    APPLY = apply;
    let shouldDisconnect = false;
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(process.env.MONGO_URI);
        shouldDisconnect = true;
    }

    console.log(APPLY ? "APPLYING Bosta rates\n" : "DRY RUN — nothing is written. Re-run with --apply.\n");

    console.log("Shipping classes (Bosta sizes)");
    const seededClassIds = await seedClasses();
    const groups = await sizeClassGroups(seededClassIds);
    for (const [key, classes] of groups) {
        const extra = classes.filter((c) => tariff.getSize(key)?.name !== c.name);
        if (extra.length) record(`  = ${key}: also priced for legacy class(es) ${extra.map((c) => `"${c.name}"`).join(", ")}`);
    }

    console.log("\nCity sectors");
    await stampCitySectors();

    console.log("\nZones and methods");
    for (const sector of tariff.SECTORS) {
        const zone = await seedZone(sector);
        await seedMethod(sector, zone, groups);
    }

    console.log("\nPolicies");
    await seedCodPolicy();

    console.log("\nLegacy");
    await retireLegacyZone();

    console.log(`\nRate card written (EGP per parcel) — flat ${tariff.FLAT_RETAIL_RATE} EGP, so the sector and size columns are informational only:`);
    const header = ["sector", ...tariff.SIZES.map((s) => s.name)];
    console.log(header.map((h, i) => (i === 0 ? h.padEnd(28) : h.padStart(13))).join(""));
    for (const sector of tariff.SECTORS) {
        const cells = tariff.SIZES.map((s) => String(tariff.retailRate(sector.id, s.key)).padStart(13));
        console.log(`${sector.id}. ${sector.name}`.padEnd(28) + cells.join(""));
    }

    if (APPLY) {
        // The engine memoises quotes and settings; without this the old flat rate would keep
        // being served until the TTL expired or the process restarted.
        require("../services/shippingEngine").invalidateShippingCache();
        console.log("\nShipping cache invalidated.");
    }

    if (shouldDisconnect) await mongoose.disconnect();
    return log;
}

if (require.main === module) {
    seed().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { seed };
