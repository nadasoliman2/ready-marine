/**
 * Bosta's live tariff, as it applies to THIS business account.
 *
 * Provenance — every number below was read from Bosta's own pricing API against the
 * production API key, not from a published price list or a sales quote:
 *
 *     GET /api/v2/pricing/calculator?tierIdSelector=c__CT4DU9I&pickupSectorId=1..7
 *     GET /api/v2/pricing/shipment/calculator?dropOffCity=..&pickupCity=..&cod=..&size=..
 *     GET /api/v2/cities                       (city -> sector)
 *
 *   Read on 2026-08-23. Tier `EGY-0A` (_id xstNYnWa4E3vMjWEJk1OT), country Egypt, VAT 14%.
 *
 * How Bosta prices a parcel — the four facts that shape everything here:
 *
 *   1. ONE PARCEL, ONE PRICE. Bosta bills per delivery, not per item and not per order.
 *      Our unit of fulfilment is the sub-order — one per (vendor, pickup branch) — and
 *      each one becomes exactly one Bosta delivery. So a basket from three vendors is
 *      three deliveries and three full charges. This is why shipping is quoted in "split"
 *      mode: the customer pays per parcel because we are charged per parcel.
 *
 *   2. PRICE DEPENDS ON THE DESTINATION SECTOR ONLY. Egypt's 28 governorates are grouped
 *      into 7 sectors. On this tier the pickup sector does not move the price at all —
 *      verified by pulling the full matrix for all 7 pickup sectors and finding the seven
 *      responses identical. Cairo->Cairo and Aswan->Cairo cost the same.
 *
 *   3. PRICE DEPENDS ON PARCEL SIZE, NOT WEIGHT. The tier's `weighting` is `FIXED_SIZES`.
 *      There are six size buckets. Only three of them can be DECLARED when creating a
 *      delivery (Normal, Light Bulky, Heavy Bulky); Large / X-Large / White Bag are
 *      upgrades Bosta applies when it measures the parcel at the hub. We carry all six so
 *      a quote can match a measured upgrade, but only the three declarable ones are ever
 *      sent to Bosta as a packageType.
 *
 *   4. EXTRAS SIT ON TOP, EACH WITH ITS OWN TRIGGER. Extra-COD, pickup, opening-package,
 *      material and extra-weight fees are separate line items, and VAT applies to all of
 *      them. Only the ones this account has switched on are modelled below.
 *
 * NOTE ON WHAT THE CUSTOMER PAYS: the tables below are our COST. Since 2026-08-31 the
 * customer is charged a flat 25 EGP per parcel instead — see `FLAT_RETAIL_RATE` under
 * "Retail price". The cost tables stay exact so the admin reporting stays honest.
 *
 * Everything the shipping engine charges a customer, and everything the admin is told a
 * dispatch will cost, is derived from this file. When Bosta changes the tariff, re-run
 * `node Backend/scripts/syncBostaTariff.js` to see the drift, update the tables here, then
 * re-run `node Backend/seeders/bostaRatesSeeder.js` to push it into the zones and methods.
 */

/* ------------------------------------------------------------------ *
 * Sectors
 * ------------------------------------------------------------------ */

// `cities` are Bosta's own city names — the same strings the City collection stores in
// `name` and sends as `dropOffCity`, so a destination can be matched without translation.
const SECTORS = [
    {
        id: 1,
        name: "Cairo & Giza",
        name_ar: "القاهرة والجيزة",
        cities: [
            { name: "Cairo", name_ar: "القاهره" },
            { name: "Giza", name_ar: "الجيزه" },
        ],
    },
    {
        id: 2,
        name: "Alexandria & Behira",
        name_ar: "الإسكندرية والبحيرة",
        cities: [
            { name: "Alexandria", name_ar: "الاسكندريه" },
            { name: "Behira", name_ar: "البحيره" },
        ],
    },
    {
        id: 3,
        name: "Delta & Canal",
        name_ar: "الدلتا والقناة",
        cities: [
            { name: "Dakahlia", name_ar: "الدقهليه" },
            { name: "Damietta", name_ar: "دمياط" },
            { name: "El Kalioubia", name_ar: "القليوبيه" },
            { name: "Gharbia", name_ar: "الغربيه" },
            { name: "Ismailia", name_ar: "الاسماعيليه" },
            { name: "Kafr Alsheikh", name_ar: "كفر الشيخ" },
            { name: "Monufia", name_ar: "المنوفيه" },
            { name: "Port Said", name_ar: "بور سعيد" },
            { name: "Sharqia", name_ar: "الشرقيه" },
            { name: "Suez", name_ar: "السويس" },
        ],
    },
    {
        id: 4,
        name: "Near Upper Egypt",
        name_ar: "صعيد مصر القريب",
        cities: [
            { name: "Assuit", name_ar: "اسيوط" },
            { name: "Bani Suif", name_ar: "بني سويف" },
            { name: "Fayoum", name_ar: "الفيوم" },
            { name: "Menya", name_ar: "المنيا" },
            { name: "Sohag", name_ar: "سوهاج" },
        ],
    },
    {
        id: 5,
        name: "Far Upper Egypt & Matrouh",
        name_ar: "صعيد مصر البعيد ومطروح",
        cities: [
            { name: "Aswan", name_ar: "اسوان" },
            { name: "Luxor", name_ar: "الاقصر" },
            { name: "Matrouh", name_ar: "مرسي مطروح" },
            { name: "Qena", name_ar: "قنا" },
            { name: "Red Sea", name_ar: "البحر الاحمر" },
        ],
    },
    {
        id: 6,
        name: "North Coast",
        name_ar: "الساحل الشمالي",
        cities: [{ name: "North Coast", name_ar: "الساحل الشمالي" }],
    },
    {
        id: 7,
        name: "Sinai & New Valley",
        name_ar: "سيناء والوادي الجديد",
        cities: [
            { name: "New Valley", name_ar: "الوادي الجديد" },
            // Bosta reports dropOffAvailability:false for North Sinai. It stays in the
            // sector so the rate is right if Bosta reopens it; whether we sell to it is a
            // separate decision, made by activating or deactivating the zone.
            { name: "North Sinai", name_ar: "شمال سيناء" },
            { name: "South Sinai", name_ar: "جنوب سيناء" },
        ],
    },
];

/* ------------------------------------------------------------------ *
 * Sizes
 * ------------------------------------------------------------------ */

/**
 * Bosta's six pricing sizes, largest-priced first — the order the rate rules are written
 * in, so that a parcel holding items of several sizes is priced at its largest, which is
 * how the courier will actually bill it.
 *
 * `deliveryPackageType` is the value sent as `specs.packageType` when the delivery is
 * created. Its enum is NOT the pricing enum: it accepts Small / Medium / Large /
 * Light Bulky / Heavy Bulky and rejects "Normal" and "X-Large". `null` means "let the
 * item count decide" (Small / Medium / Large), which is the right call for a Normal parcel.
 */
const SIZES = [
    { key: "heavy_bulky", pricingSize: "Heavy Bulky", name: "Heavy Bulky", name_ar: "ضخم ثقيل", deliveryPackageType: "Heavy Bulky", declarable: true, description: "Oversized and heavy — Bosta's most expensive bracket (e.g. a full body panel, a bumper, a set of tyres)." },
    { key: "light_bulky", pricingSize: "Light Bulky", name: "Light Bulky", name_ar: "ضخم خفيف", deliveryPackageType: "Light Bulky", declarable: true, description: "Oversized but light (e.g. a bumper trim, an air-filter box, a plastic cover)." },
    { key: "white_bag", pricingSize: "White Bag", name: "White Bag (XXL)", name_ar: "شنطة بيضاء (XXL)", deliveryPackageType: "Large", declarable: false, description: "Up to 100 x 50 cm. Bosta applies this bracket when it measures the parcel at the hub." },
    { key: "x_large", pricingSize: "X-Large", name: "X-Large", name_ar: "كبير جداً", deliveryPackageType: "Large", declarable: false, description: "Up to 55 x 60 cm. Bosta applies this bracket when it measures the parcel at the hub." },
    { key: "large", pricingSize: "Large", name: "Large", name_ar: "كبير", deliveryPackageType: "Large", declarable: false, description: "Up to 45 x 50 cm. Bosta applies this bracket when it measures the parcel at the hub." },
    { key: "normal", pricingSize: "Normal", name: "Normal", name_ar: "عادي", deliveryPackageType: null, declarable: true, description: "Up to 35 x 40 cm. The default — anything not classified ships and prices as Normal." },
];

const DEFAULT_SIZE_KEY = "normal";

/* ------------------------------------------------------------------ *
 * The rate table
 * ------------------------------------------------------------------ */

const VAT_RATE = 0.14;

/**
 * SEND (a normal outbound delivery) — cost in EGP, BEFORE VAT, by [sector][size key].
 * Straight from `tierServiceTypes[typeName=SEND].tierSizes[].cost`.
 */
const SEND_RATES = {
    1: { normal: 97,  large: 102, x_large: 107, white_bag: 112, light_bulky: 197, heavy_bulky: 564 },
    2: { normal: 102, large: 107, x_large: 112, white_bag: 117, light_bulky: 202, heavy_bulky: 614 },
    3: { normal: 110, large: 115, x_large: 120, white_bag: 125, light_bulky: 210, heavy_bulky: 694 },
    4: { normal: 124, large: 129, x_large: 134, white_bag: 139, light_bulky: 224, heavy_bulky: 834 },
    5: { normal: 140, large: 145, x_large: 150, white_bag: 155, light_bulky: 240, heavy_bulky: 994 },
    6: { normal: 144, large: 149, x_large: 154, white_bag: 159, light_bulky: 244, heavy_bulky: 1034 },
    7: { normal: 160, large: 165, x_large: 170, white_bag: 175, light_bulky: 260, heavy_bulky: 1194 },
};

/**
 * RTO — what a refused parcel costs to bring back. We never quote this to a customer; it
 * is here so the admin's returns reporting can price a failed delivery honestly.
 */
const RTO_RATES = {
    1: { normal: 87,  large: 92,  x_large: 97,  white_bag: 102, light_bulky: 187, heavy_bulky: 554 },
    2: { normal: 92,  large: 97,  x_large: 102, white_bag: 107, light_bulky: 192, heavy_bulky: 604 },
    3: { normal: 100, large: 105, x_large: 110, white_bag: 115, light_bulky: 200, heavy_bulky: 684 },
    4: { normal: 114, large: 119, x_large: 124, white_bag: 129, light_bulky: 214, heavy_bulky: 824 },
    5: { normal: 130, large: 135, x_large: 140, white_bag: 145, light_bulky: 230, heavy_bulky: 984 },
    6: { normal: 134, large: 139, x_large: 144, white_bag: 149, light_bulky: 234, heavy_bulky: 1024 },
    7: { normal: 150, large: 155, x_large: 160, white_bag: 165, light_bulky: 250, heavy_bulky: 1184 },
};

/**
 * CUSTOMER_RETURN_PICKUP — collecting a return from the customer's door. Flat across every
 * sector, which is why the table has no per-sector rows.
 */
const CUSTOMER_RETURN_RATES = {
    normal: 107, large: 112, x_large: 117, white_bag: 122, light_bulky: 207, heavy_bulky: 574,
};

/* ------------------------------------------------------------------ *
 * Extras
 * ------------------------------------------------------------------ */

/**
 * `enabled` mirrors `tier.configurations` — Bosta only bills a fee whose switch is on for
 * this account. A fee that is off is still listed so that turning it on later is a data
 * change here rather than a hunt through the codebase.
 */
const FEES = {
    /**
     * Charged when a courier is sent to a branch and collects FEWER than
     * `orders_threshold` parcels. It is the price of dispatching a near-empty pickup.
     *
     * READY CAR ABSORBS THIS. It is never added to a customer's shipping: choosing to send
     * a courier for one parcel rather than waiting for a second is the admin's operational
     * call, made after the customer has already been quoted, so the customer cannot be the
     * one who pays for it. `Admin -> Shipping -> Settings -> pickup_batch_threshold` is the
     * lever that avoids the fee — set it to `orders_threshold` and pickups wait for a full
     * batch. It is recorded per pickup on `BostaPickup.pickup_fee` so the cost of dispatching
     * early is visible rather than silently eaten.
     */
    pickup: { enabled: true, amount: 70, orders_threshold: 2 },

    /**
     * 1% of the part of the COD that exceeds 2000 EGP. Verified against the live estimator:
     * COD 2500 -> 5.00, COD 5000 -> 30.00, COD <= 2000 -> nothing.
     */
    extra_cod: { enabled: true, percentage: 0.01, free_up_to: 2000, minimum: 0 },

    /** Per delivery that permits the customer to open the box before paying. */
    opening_package: { enabled: true, amount: 7 },

    /** Charged only when the parcel goes out in Bosta's own flyer. Our vendors pack their own. */
    material: { enabled: true, amount: 55 },

    /**
     * On a FIXED_SIZES tier the size brackets carry the price and weight only tops it up
     * past the threshold. Kept for completeness; not quoted, because 1322 of our 1354
     * products have no weight recorded and a fee derived from a blank field is a guess.
     */
    extra_weight: { enabled: true, threshold_kg: 5, cost_at_threshold: 2, cost_per_extra_kg: 1 },

    /** Off on this tier (`configurations.insuranceFee: false`), so it never applies. */
    insurance: { enabled: false, percentage: 0, minimum: 0 },

    /** Off on this tier (`configurations.expediteFee: false`). */
    expedite: { enabled: false, percentage: 0.01, minimum: 13 },
};

/* ------------------------------------------------------------------ *
 * Retail price
 * ------------------------------------------------------------------ */

/**
 * WHAT THE CUSTOMER PAYS IS A FLAT 25 EGP PER PARCEL — it is no longer derived from the
 * tariff above.
 *
 * This is a deliberate commercial decision, not a modelling one: Ready Car subsidises
 * shipping and absorbs the gap between this 25 and the real Bosta cost, which the tables
 * above still hold in full. Every sector and every size costs the customer the same,
 * so the destination no longer moves the price.
 *
 * It stays PER PARCEL, not per order. `multi_vendor_mode` is "split", so each
 * (vendor, branch) sub-order is priced on its own leg — a basket from three vendors is
 * three parcels and 75 EGP, because it is three deliveries we actually pay Bosta for.
 *
 * Nothing on the COST side is touched. `sendCost`, `rtoCost`, `customerReturnCost`,
 * `pickupFee` and `extraCodFee` keep returning the real Bosta figures, so the admin's
 * dispatch, returns and margin reporting still tells the truth about what a delivery costs.
 * To go back to cost-based retail pricing, restore `retailRate` to the rounded `sendCost`
 * below and re-run the seeder.
 */
const FLAT_RETAIL_RATE = 25;

/**
 * The step the old cost-derived retail price was rounded up to. Unused while the flat rate
 * is in force; kept because `roundUpTo` and the restore path above both refer to it.
 */
const RETAIL_ROUNDING_STEP = 5;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const withVat = (n) => round2(Number(n || 0) * (1 + VAT_RATE));
const roundUpTo = (n, step) => (step > 0 ? Math.ceil(Number(n || 0) / step) * step : round2(n));

/* ------------------------------------------------------------------ *
 * Lookups
 * ------------------------------------------------------------------ */

const _sectorByCity = new Map();
for (const sector of SECTORS) {
    for (const city of sector.cities) {
        _sectorByCity.set(city.name.trim().toLowerCase(), sector.id);
        if (city.name_ar) _sectorByCity.set(city.name_ar.trim().toLowerCase(), sector.id);
    }
}

/** Bosta sector id for a city name (English or Arabic, case-insensitive), or null. */
function sectorForCity(city) {
    if (!city) return null;
    return _sectorByCity.get(String(city).trim().toLowerCase()) ?? null;
}

function getSector(sectorId) {
    return SECTORS.find((s) => s.id === Number(sectorId)) || null;
}

function getSize(sizeKey) {
    return SIZES.find((s) => s.key === sizeKey) || null;
}

/** All 28 city names, in sector order. */
function allCities() {
    return SECTORS.flatMap((s) => s.cities.map((c) => ({ ...c, sector: s.id })));
}

/**
 * What Bosta charges us to deliver one parcel.
 * @param {number} sectorId  1..7
 * @param {string} sizeKey   a SIZES key
 * @param {{ vat?: boolean }} opts  vat:true (default) returns the VAT-inclusive figure
 */
function sendCost(sectorId, sizeKey = DEFAULT_SIZE_KEY, { vat = true } = {}) {
    const row = SEND_RATES[Number(sectorId)];
    if (!row) return null;
    const base = row[sizeKey];
    if (base === undefined) return null;
    return vat ? withVat(base) : round2(base);
}

/**
 * What we charge the customer for one parcel: a flat `FLAT_RETAIL_RATE`, whatever the
 * sector or the size. The arguments are still validated against the cost table so that an
 * unknown sector or size returns null rather than a price — the seeder relies on that to
 * skip a cell it has no rate for.
 */
function retailRate(sectorId, sizeKey = DEFAULT_SIZE_KEY) {
    const cost = sendCost(sectorId, sizeKey, { vat: true });
    return cost === null ? null : FLAT_RETAIL_RATE;
}

/** What bringing a refused parcel back costs us. */
function rtoCost(sectorId, sizeKey = DEFAULT_SIZE_KEY, { vat = true } = {}) {
    const row = RTO_RATES[Number(sectorId)];
    if (!row) return null;
    const base = row[sizeKey];
    if (base === undefined) return null;
    return vat ? withVat(base) : round2(base);
}

/** What collecting a return from the customer's door costs us. Flat across sectors. */
function customerReturnCost(sizeKey = DEFAULT_SIZE_KEY, { vat = true } = {}) {
    const base = CUSTOMER_RETURN_RATES[sizeKey];
    if (base === undefined) return null;
    return vat ? withVat(base) : round2(base);
}

/**
 * The pickup fee for a courier visit that collects `parcelCount` parcels.
 * Returns 0 once the visit carries enough parcels to be free.
 */
function pickupFee(parcelCount, { vat = true } = {}) {
    const fee = FEES.pickup;
    if (!fee.enabled) return 0;
    if (Number(parcelCount || 0) >= fee.orders_threshold) return 0;
    return vat ? withVat(fee.amount) : round2(fee.amount);
}

/** 1% of the COD above 2000 EGP. Returns 0 for a COD at or under the threshold. */
function extraCodFee(codAmount, { vat = true } = {}) {
    const fee = FEES.extra_cod;
    if (!fee.enabled) return 0;
    const excess = Math.max(0, Number(codAmount || 0) - fee.free_up_to);
    if (excess <= 0) return 0;
    const raw = Math.max(excess * fee.percentage, fee.minimum);
    return vat ? withVat(raw) : round2(raw);
}

/**
 * Shipping classes that predate the Bosta size classes but already changed what we declared
 * to the courier. `Heavy` / `ثقيل` was being sent as packageType "Heavy Bulky" long before
 * this table existed, so it keeps meaning that — dropping it would have us declare a Normal
 * parcel, get billed for the Heavy Bulky one Bosta measures at the hub, and eat the gap.
 * The seeder gives every alias the matching rate rule, so the price and the declaration
 * stay the same statement.
 *
 * `Fragile` and `Perishable` are absent on purpose: they describe handling, not size, and
 * they travel as delivery notes rather than as a price bracket.
 */
const LEGACY_CLASS_ALIASES = [
    { pattern: /heavy|ثقيل|big|كبير/, size: "heavy_bulky" },
];

/**
 * The Bosta size a shipping-class name stands for, or null when the class says nothing
 * about size. Exact matches on a Bosta size class win over the legacy aliases, so
 * "Heavy Bulky" resolves as itself rather than through the /heavy/ alias.
 */
function sizeKeyForClassName(className) {
    const name = String(className || "").trim().toLowerCase();
    if (!name) return null;
    for (const size of SIZES) {
        if (name === size.name.toLowerCase() || name === size.name_ar.trim().toLowerCase()) return size.key;
    }
    for (const alias of LEGACY_CLASS_ALIASES) {
        if (alias.pattern.test(name)) return alias.size;
    }
    return null;
}

/**
 * The size a parcel prices at, given the size keys its items carry. The largest wins,
 * because the courier bills the box, not its contents. An empty list is Normal.
 */
function largestSize(sizeKeys = []) {
    const present = new Set((sizeKeys || []).filter(Boolean));
    for (const size of SIZES) {
        if (present.has(size.key)) return size.key;
    }
    return DEFAULT_SIZE_KEY;
}

/** The `specs.packageType` to declare for a parcel of this size, or null to let item count decide. */
function deliveryPackageType(sizeKey) {
    return getSize(sizeKey)?.deliveryPackageType ?? null;
}

module.exports = {
    VAT_RATE,
    FLAT_RETAIL_RATE,
    RETAIL_ROUNDING_STEP,
    DEFAULT_SIZE_KEY,
    SECTORS,
    SIZES,
    LEGACY_CLASS_ALIASES,
    SEND_RATES,
    RTO_RATES,
    CUSTOMER_RETURN_RATES,
    FEES,
    withVat,
    roundUpTo,
    sectorForCity,
    getSector,
    getSize,
    allCities,
    sendCost,
    retailRate,
    rtoCost,
    customerReturnCost,
    pickupFee,
    extraCodFee,
    largestSize,
    sizeKeyForClassName,
    deliveryPackageType,
};
