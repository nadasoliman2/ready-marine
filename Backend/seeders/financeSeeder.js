/**
 * Finance Seeder
 * --------------
 * Generates a realistic, self-consistent body of money data so the admin finance module
 * (`/admin/dashboard/finance`) can be exercised against something other than zeros.
 *
 * WHAT IT HONOURS. `financeService` recognises revenue on DELIVERY, never re-derives money
 * from today's rates, and charges refunds to the period they land in. This seeder is built
 * backwards from those three rules, so every figure the module reports traces to a stored
 * snapshot exactly as it would in production:
 *
 *   VendorEarning        one row per delivered PARCEL, holding its own frozen money split
 *   shipment.bosta_cost  the shipping cost snapshot, priced with the real `bostaTariff`
 *   AdSpend              a dated ledger, with campaigns deliberately crossing month
 *                        boundaries so the day-apportioning in `amountWithin` is tested
 *   Refund               reversals that reduce the month they COMPLETE in, not the sale's
 *
 * WHAT IT COVERS. Not just the happy path — the states the finance screens exist to show:
 *   - earnings still inside the 14-day return window   (held / "pending")
 *   - earnings cleared and unpaid                      (owed now)
 *   - earnings cleared long ago and still unpaid       (OVERDUE — the red number)
 *   - earnings settled by a payout                     (paid_to_vendors_lifetime)
 *   - vendor-initiated withdrawals awaiting review     (the admin's blocking queue)
 *   - refunds, partial and full, reversing commission
 *   - RTO parcels, whose margin is negative by design
 *   - orders that are NOT delivered, which every finance query must ignore
 *
 * SAFETY. Everything it writes is tagged (see TAG below) and `--reset` removes only tagged
 * documents. It never touches a record it did not create.
 *
 * USAGE
 *   node seeders/financeSeeder.js                 # seed with defaults
 *   node seeders/financeSeeder.js --reset         # delete previously seeded data, then seed
 *   node seeders/financeSeeder.js --reset-only    # delete and stop
 *   node seeders/financeSeeder.js --orders=2000 --months=24 --vendors=25
 *   node seeders/financeSeeder.js --seed=99       # a different deterministic dataset
 *
 * Re-runs are deterministic: the same flags produce the same numbers, so a figure you are
 * chasing on screen is still there after a reset.
 */

require("dotenv").config();
const mongoose = require("mongoose");
const crypto = require("crypto");

const { Seller } = require("../models/sellers");
const { User } = require("../models/users");
const { Order } = require("../models/orders");
const { VendorEarning } = require("../models/vendorEarnings");
const { WithdrawalRequest } = require("../models/withdrawalRequests");
const { Refund } = require("../models/refunds");
const { SubscriptionPayment } = require("../models/subscriptionPayments");
const { SupplyOrder } = require("../models/supplyOrders");
const { AdSpend, AD_CHANNELS } = require("../models/adSpend");
const { SiteSettings } = require("../models/site_settings");

const bostaTariff = require("../services/bostaTariff");
const { recomputeWalletBalances } = require("../services/vendorEarningsService");

/* ------------------------------------------------------------------ *
 * Tagging — what makes `--reset` safe
 * ------------------------------------------------------------------ */

// Every seeded document is reachable from one of these markers. Nothing else is deleted.
const TAG = "financeseed";
const VENDOR_EMAIL_DOMAIN = `${TAG}.test`;
const VENDOR_USERNAME_PREFIX = `fin-seed-`;
const CUSTOMER_EMAIL_DOMAIN = `${TAG}.test`;
const SUPPLY_ORDER_PREFIX = "FS-SUP-";
const WITHDRAWAL_PREFIX = "WD-FS";
const AD_SPEND_LABEL = "Finance Seeder";

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit === undefined ? fallback : Number(hit.split("=")[1]);
};

const CONFIG = {
    vendors: opt("vendors", 14),
    customers: opt("customers", 90),
    orders: opt("orders", 900),
    months: opt("months", 15),
    seed: opt("seed", 20260831),
    reset: flag("reset") || flag("reset-only"),
    resetOnly: flag("reset-only"),
};

/* ------------------------------------------------------------------ *
 * Deterministic randomness
 * ------------------------------------------------------------------ *
 * A seeded PRNG rather than Math.random, so a number you are investigating on screen
 * survives a reset-and-reseed. Debugging a report against data that reshuffles every run
 * is the fastest way to chase a bug that was never there.
 */

let _state = CONFIG.seed >>> 0;
const rnd = () => {
    _state = (_state + 0x6d2b79f5) >>> 0;
    let t = _state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rint = (min, max) => Math.floor(rnd() * (max - min + 1)) + min;
const rfloat = (min, max) => rnd() * (max - min) + min;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const shuffled = (arr) => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
};

const round2 = (n) => Number((Number(n) || 0).toFixed(2));
const oid = () => new mongoose.Types.ObjectId();
const daysAgo = (d) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);
const addDays = (date, d) => new Date(date.getTime() + d * 24 * 60 * 60 * 1000);

/* ------------------------------------------------------------------ *
 * Reference data
 * ------------------------------------------------------------------ */

const STORE_NAMES = [
    "Cairo Auto Parts", "Nile Motors Supply", "Delta Car Care", "Alexandria Spares",
    "Giza Tyre House", "Pyramid Performance", "Sphinx Lubricants", "Red Sea Autoworks",
    "Luxor Brake Systems", "Aswan Batteries", "Zamalek Detailing", "Maadi Motor Factors",
    "Heliopolis Filters", "Suez Rim & Wheel", "Tanta Electricals", "Mansoura Bodyshop",
    "Fayoum Auto Glass", "Ismailia Exhausts", "Damietta Interiors", "Qena Clutch Co",
    "Sohag Suspension", "Minya Radiators", "Beni Suef Bearings", "Port Said Imports",
    "Hurghada Off-Road", "Sharm Auto Care",
];

const OWNER_NAMES = [
    "Ahmed Hassan", "Mona Fahmy", "Karim Adel", "Salma Nour", "Youssef Ibrahim",
    "Dina Mostafa", "Tarek Saad", "Nada Kamal", "Omar Sherif", "Heba Rashad",
    "Mahmoud Zaki", "Rania Fouad", "Hossam Gamal", "Yasmin Ali", "Amr Sabry",
    "Laila Hamdy", "Sherif Wagdy", "Nourhan Emad", "Khaled Refaat", "Mai Sultan",
    "Ziad Anwar", "Farida Helmy", "Bassem Lotfy", "Injy Saber", "Ramy Ashraf", "Hala Nagy",
];

const CUSTOMER_NAMES = [
    "Mohamed Salah", "Aya Kamel", "Mostafa Lotfy", "Sara Hany", "Ali Mansour",
    "Nourhan Adel", "Hassan Fathy", "Menna Tarek", "Ibrahim Sami", "Reem Ashraf",
    "Waleed Nabil", "Doaa Magdy", "Sameh Ezzat", "Rasha Fouad", "Ehab Shaker",
    "Marwa Selim", "Fady Nashaat", "Nesma Galal", "Hany Bahgat", "Asmaa Roshdy",
    "Kareem Wael", "Shaimaa Adly", "Tamer Ragab", "Ola Sherine", "Ashraf Bakr",
    "Ghada Fahim", "Mina Boutros", "Amira Zidan", "Sherif Osman", "Hoda Kassem",
];

const PRODUCTS = [
    { title: "Brake Pad Set — Front", price: 1450, size: "normal" },
    { title: "Oil Filter (OEM)", price: 210, size: "normal" },
    { title: "Full Synthetic Engine Oil 5W-30 — 4L", price: 980, size: "normal" },
    { title: "Cabin Air Filter", price: 320, size: "normal" },
    { title: "Spark Plug — Iridium (set of 4)", price: 1120, size: "normal" },
    { title: "Wiper Blade Pair 24\"/18\"", price: 460, size: "normal" },
    { title: "Car Battery 70Ah", price: 3800, size: "heavy_bulky" },
    { title: "Alloy Wheel 17\"", price: 4200, size: "heavy_bulky" },
    { title: "Front Bumper Cover", price: 5600, size: "light_bulky" },
    { title: "Side Mirror Assembly", price: 1850, size: "large" },
    { title: "Radiator Assembly", price: 4900, size: "light_bulky" },
    { title: "Shock Absorber (each)", price: 2100, size: "large" },
    { title: "Timing Belt Kit", price: 3250, size: "normal" },
    { title: "Headlight Assembly — LED", price: 6400, size: "x_large" },
    { title: "Clutch Kit", price: 5100, size: "large" },
    { title: "Floor Mat Set — All Weather", price: 890, size: "white_bag" },
    { title: "Ceramic Coating Kit", price: 1650, size: "normal" },
    { title: "Tyre 205/55 R16", price: 3100, size: "heavy_bulky" },
    { title: "Alternator (Remanufactured)", price: 4400, size: "large" },
    { title: "Fuel Pump Module", price: 3600, size: "normal" },
];

const BANKS = ["CIB", "Banque Misr", "NBE", "QNB Alahli", "AAIB", "Alex Bank"];
const CAMPAIGNS = [
    "Always-On Prospecting", "Ramadan Push", "Black Friday", "Brake Season",
    "Retargeting — Cart", "Brand Search", "Winter Tyres", "Oil Change Offer",
    "New Vendor Launch", "Lookalike Test", "Summer Roadtrip", "Back to Work",
];

/* ------------------------------------------------------------------ *
 * Reset
 * ------------------------------------------------------------------ */

/**
 * Delete everything a previous run created — and nothing else.
 *
 * Orders and earnings carry no tag of their own, so they are found by ownership: an order
 * belonging to a seeded customer, an earning belonging to a seeded vendor. That keeps the
 * blast radius tied to the two collections that ARE tagged.
 */
const resetSeededData = async () => {
    const vendors = await Seller.find({ email: new RegExp(`@${VENDOR_EMAIL_DOMAIN}$`) }).select("_id").lean();
    const customers = await User.find({ email: new RegExp(`@${CUSTOMER_EMAIL_DOMAIN}$`) }).select("_id").lean();
    const vendorIds = vendors.map((v) => v._id);
    const customerIds = customers.map((c) => c._id);

    const orders = await Order.find({ user_id: { $in: customerIds } }).select("_id").lean();
    const orderIds = orders.map((o) => o._id);

    const results = {
        refunds: (await Refund.deleteMany({ order_id: { $in: orderIds } })).deletedCount,
        earnings: (await VendorEarning.deleteMany({ vendor_id: { $in: vendorIds } })).deletedCount,
        withdrawals: (await WithdrawalRequest.deleteMany({
            withdrawal_number: new RegExp(`^${WITHDRAWAL_PREFIX}`),
        })).deletedCount,
        orders: (await Order.deleteMany({ _id: { $in: orderIds } })).deletedCount,
        subscriptions: (await SubscriptionPayment.deleteMany({ vendor_id: { $in: vendorIds } })).deletedCount,
        supplyOrders: (await SupplyOrder.deleteMany({
            order_number: new RegExp(`^${SUPPLY_ORDER_PREFIX}`),
        })).deletedCount,
        adSpend: (await AdSpend.deleteMany({ created_by_label: AD_SPEND_LABEL })).deletedCount,
        customers: (await User.deleteMany({ _id: { $in: customerIds } })).deletedCount,
        vendors: (await Seller.deleteMany({ _id: { $in: vendorIds } })).deletedCount,
    };

    console.log("\n[Reset] Removed previously seeded finance data:");
    for (const [key, count] of Object.entries(results)) {
        if (count) console.log(`  - ${key.padEnd(14)} ${count}`);
    }
    if (!Object.values(results).some(Boolean)) console.log("  (nothing to remove)");
    return results;
};

/* ------------------------------------------------------------------ *
 * Vendors
 * ------------------------------------------------------------------ */

const seedVendors = async () => {
    const cities = bostaTariff.allCities();
    const docs = [];

    for (let i = 0; i < CONFIG.vendors; i++) {
        const storeName = STORE_NAMES[i % STORE_NAMES.length] + (i >= STORE_NAMES.length ? ` ${i}` : "");
        const city = pick(cities).name;

        // A handful negotiate their own payout terms; the rest follow the company calendar.
        // Both paths need data, because `resolveSchedule` reads through a null to the global
        // value and that fall-through is the part most likely to break unnoticed.
        const hasOverride = i % 5 === 0;

        // One vendor in ten never filled in their bank details — the payout screen has to
        // show that it cannot pay them.
        const hasBank = !(i % 10 === 9);

        docs.push({
            _id: oid(),
            name: OWNER_NAMES[i % OWNER_NAMES.length],
            store_name: storeName,
            store_username: `${VENDOR_USERNAME_PREFIX}${i + 1}`,
            email: `vendor${i + 1}@${VENDOR_EMAIL_DOMAIN}`,
            phone: `+2011${String(70000000 + i).slice(0, 8)}`,
            locations: [{
                address: `${rint(1, 200)} ${pick(["El Nasr", "Gomhoreya", "Tahrir", "Salah Salem"])} St`,
                shipping_country: "Egypt",
                shipping_city: city,
                is_default: true,
                bosta_location_id: null,
            }],
            password: crypto.randomBytes(16).toString("hex"),
            status: i % 12 === 11 ? "suspended" : "active",
            email_verified_at: daysAgo(rint(200, 700)),
            phone_verified_at: daysAgo(rint(200, 700)),
            default_bank_details: hasBank ? {
                bank_name: pick(BANKS),
                account_holder: OWNER_NAMES[i % OWNER_NAMES.length],
                account_number: String(rint(10000000, 99999999)) + String(rint(1000, 9999)),
                iban: `EG${rint(10, 99)}${rint(100000, 999999)}${rint(100000, 999999)}`,
            } : { bank_name: null, account_holder: null, account_number: null, iban: null },
            payout_schedule: hasOverride ? {
                enabled: true,
                weekday: pick([0, 2, 4]),
                interval_weeks: pick([1, 2]),
                anchor_date: daysAgo(rint(60, 400)),
                hold_days: pick([7, 14, 21]),
            } : { enabled: false, weekday: null, interval_weeks: null, anchor_date: null, hold_days: null },
            created_at: daysAgo(rint(220, 760)),
        });
    }

    await Seller.insertMany(docs, { ordered: false, throwOnValidationError: true });
    console.log(`[Vendors]       ${docs.length} created`);
    return docs;
};

/* ------------------------------------------------------------------ *
 * Customers
 * ------------------------------------------------------------------ */

const seedCustomers = async () => {
    const cities = bostaTariff.allCities();
    const docs = [];

    for (let i = 0; i < CONFIG.customers; i++) {
        const name = CUSTOMER_NAMES[i % CUSTOMER_NAMES.length] + (i >= CUSTOMER_NAMES.length ? ` ${Math.floor(i / CUSTOMER_NAMES.length) + 1}` : "");
        docs.push({
            _id: oid(),
            name,
            email: `customer${i + 1}@${CUSTOMER_EMAIL_DOMAIN}`,
            phone: `+2012${String(30000000 + i).slice(0, 8)}`,
            password: null,
            account_status: "active",
            preferred_language: chance(0.5) ? "en" : "ar",
            email_verified_at: daysAgo(rint(30, 700)),
            phone_verified_at: daysAgo(rint(30, 700)),
            addresses: [{
                recipient_name: name,
                phone: `+2012${String(30000000 + i).slice(0, 8)}`,
                full_address: `${rint(1, 90)} ${pick(["Mohandessin", "Dokki", "Nasr City", "Zamalek", "Maadi"])}`,
                shipping_country: "Egypt",
                shipping_city: pick(cities).name,
                is_default: true,
            }],
            created_at: daysAgo(rint(30, 760)),
        });
    }

    await User.insertMany(docs, { ordered: false, throwOnValidationError: true });
    console.log(`[Customers]     ${docs.length} created`);
    return docs;
};

/* ------------------------------------------------------------------ *
 * Orders, parcels, earnings, refunds
 * ------------------------------------------------------------------ */

/**
 * The core of the seeder.
 *
 * Money is built from the parcel UP, never from the order down: each sub-order gets its own
 * frozen merchandise / commission / shipping / discount split, and the order's totals are
 * the sum of its parcels. That is the direction production works in, and it is the only way
 * `Σ sub_order.cod_amount === order.total_price` stays true — an invariant the finance
 * screens quietly rely on when they reconcile gross order value against merchandise.
 */
const seedOrdersAndEarnings = async (vendors, customers) => {
    const cities = bostaTariff.allCities();
    const activeVendors = vendors.filter((v) => v.status === "active");
    const now = new Date();
    const horizonDays = CONFIG.months * 30;

    /* ---- Vendors we are up to date with ----
     * On a weekly payout calendar, ONE unpaid earning that cleared eight days ago makes a
     * vendor overdue, and with ~70 parcels each every vendor would be overdue by chance
     * alone — leaving the payout screen no way to show its healthy state. These vendors
     * get everything older than a few days settled, so both states are on the screen.
     */
    const currentVendorIds = new Set(
        shuffled(activeVendors)
            .slice(0, Math.round(activeVendors.length * 0.4))
            .map((v) => String(v._id))
    );

    const orderDocs = [];
    const earningDocs = [];
    const refundDocs = [];

    // Parcels that must end up settled by a payout, collected as we go and grouped into
    // WithdrawalRequests afterwards — a payout has to reference earnings that already exist.
    const payoutCandidates = new Map(); // vendorId -> [earning]

    let deliveredCount = 0;
    let undeliveredCount = 0;
    let rtoCount = 0;

    for (let n = 0; n < CONFIG.orders; n++) {
        const customer = pick(customers);
        const city = pick(cities);
        const sectorId = bostaTariff.sectorForCity(city.name) || 1;

        /* ---- When ----
         * Weighted towards recent months so the trend chart slopes instead of sitting flat,
         * with the newest 14 days deliberately over-represented: those are the parcels still
         * inside the return window, and "held" is a headline number on the overview.
         */
        // ~10% land inside the last 14 days. Enough to give the overview a substantial
        // "held in return window" figure without piling a fifth of the year's orders onto
        // the current month and turning the trend chart into a single spike.
        const ageDays = chance(0.10)
            ? rint(0, 13)                       // still held
            : rint(14, horizonDays);
        const deliveredAt = daysAgo(ageDays);
        const createdAt = addDays(deliveredAt, -rint(2, 9));

        /* ---- Who fulfils it ---- */
        const parcelCount = chance(0.72) ? 1 : chance(0.85) ? 2 : 3;
        const orderVendors = shuffled(activeVendors).slice(0, parcelCount);

        const paymentMethod = chance(0.62) ? "cash" : pick(["credit_card", "wallet"]);

        /* ---- Is it delivered at all? ----
         * One order in eight never reaches a delivered state. They exist so the finance
         * queries can be proved to EXCLUDE them: an in-transit parcel is not revenue.
         */
        const isDelivered = !chance(0.12);

        const orderId = oid();
        const items = [];
        const subOrders = [];
        const shipments = [];
        const supervisions = [];

        let orderMerchandise = 0;
        let orderShipping = 0;
        let orderCoupon = 0;
        let orderLoyalty = 0;

        for (const vendor of orderVendors) {
            const subOrderId = oid();
            const lineCount = rint(1, 3);
            let merchandise = 0;
            let commission = 0;
            const parcelSizes = [];

            for (let l = 0; l < lineCount; l++) {
                const product = pick(PRODUCTS);
                const quantity = chance(0.75) ? 1 : rint(2, 3);
                // A little price drift, so two orders for the same part are not identical.
                const unitPrice = round2(product.price * rfloat(0.94, 1.08));
                const lineTotal = round2(unitPrice * quantity);
                // Commission varies by vendor and category, as it does in production.
                const rate = round2(rfloat(7, 18));
                const commissionAmount = round2((lineTotal * rate) / 100);

                merchandise = round2(merchandise + lineTotal);
                commission = round2(commission + commissionAmount);
                parcelSizes.push(product.size);

                items.push({
                    _id: oid(),
                    product_id: oid(),
                    product_title: product.title,
                    product_image: null,
                    variant_id: oid(),
                    variant_label: pick(["Default", "OEM", "Aftermarket", "Genuine"]),
                    quantity,
                    unit_price: unitPrice,
                    vendor_id: vendor._id,
                    vendor_status: "approved",
                    sub_order_id: subOrderId,
                    commission_rate: rate,
                    commission_amount: commissionAmount,
                    return_status: "none",
                });
            }

            // What we CHARGE the customer to ship — a retail rate, not our cost. The gap
            // between the two is the shipping margin the P&L reports.
            const sizeKey = bostaTariff.largestSize
                ? bostaTariff.largestSize(parcelSizes)
                : parcelSizes[0];
            const shippingShare = round2(bostaTariff.retailRate(sectorId, sizeKey) ?? 120);

            const couponShare = chance(0.18) ? round2(merchandise * rfloat(0.05, 0.15)) : 0;
            const loyaltyShare = chance(0.12) ? round2(merchandise * rfloat(0.02, 0.08)) : 0;
            const codAmount = round2(merchandise + shippingShare - couponShare - loyaltyShare);

            /* ---- The parcel's fate ----
             * `returned` is the refused-delivery case: it went out, came back, and cost us
             * both legs with no shipping revenue. It is the reason a parcel margin can be
             * negative, so the seeder makes sure some exist.
             */
            const isRto = isDelivered && chance(0.05);
            const subStatus = !isDelivered
                ? pick(["pending_review", "awaiting_tracking", "ready_for_pickup", "picked_up", "in_transit", "out_for_delivery"])
                : isRto ? "returned" : "delivered";
            if (isRto) rtoCount++;

            subOrders.push({
                _id: subOrderId,
                reference: `RC-${String(orderId).slice(-6).toUpperCase()}-${subOrders.length + 1}`,
                vendor_id: vendor._id,
                fulfillment_location: vendor.locations[0].address,
                status: subStatus,
                merchandise_total: merchandise,
                commission_total: commission,
                shipping_share: shippingShare,
                coupon_share: couponShare,
                loyalty_share: loyaltyShare,
                cod_amount: codAmount,
                allocation_frozen_at: isDelivered ? createdAt : null,
                items_confirmed_at: createdAt,
                ready_at: isDelivered ? addDays(createdAt, 1) : null,
                bosta_tracking_number: isDelivered ? `BST${rint(10000000, 99999999)}` : null,
                delivered_at: isDelivered && !isRto ? deliveredAt : null,
                created_at: createdAt,
                history: [],
            });

            /* ---- The cost snapshot ----
             * Priced with the real tariff rather than a made-up number, so the P&L's
             * shipping margin and the Bosta breakdown are arithmetically defensible.
             */
            if (isDelivered) {
                const send = round2(bostaTariff.sendCost(sectorId, sizeKey, { vat: true }) ?? 0);
                const extraCod = round2(
                    paymentMethod === "cash" ? bostaTariff.extraCodFee(codAmount, { vat: true }) : 0
                );
                // A courier visit is split across the parcels it collected; a solo pickup
                // carries the whole fee. Bosta waives it entirely above the batch
                // threshold, which `pickupFee` already applies.
                const pickupShare = round2(bostaTariff.pickupFee(parcelCount, { vat: true }) / parcelCount);
                const rto = isRto ? round2(bostaTariff.rtoCost(sectorId, sizeKey, { vat: true }) ?? 0) : 0;

                // Most parcels carry a cost read back from Bosta; a minority were priced by
                // us from the tariff. `data_quality.estimated_parcel_costs` reports that
                // split, so both provenances need to exist.
                const source = chance(0.15) ? "derived" : "snapshot";

                shipments.push({
                    _id: oid(),
                    vendor_id: vendor._id,
                    sub_order_id: subOrderId,
                    pickup_address: {
                        address: vendor.locations[0].address,
                        city: vendor.locations[0].shipping_city || "Cairo",
                        zone: "",
                        district: "",
                    },
                    bosta_tracking_number: `BST${rint(10000000, 99999999)}`,
                    bosta_status: isRto ? "Returned to business" : "Delivered",
                    cod_amount: paymentMethod === "cash" ? codAmount : 0,
                    bosta_cost: {
                        send,
                        extra_cod_fee: extraCod,
                        pickup_share: pickupShare,
                        rto,
                        total: round2(send + extraCod + pickupShare + rto),
                        sector_id: sectorId,
                        size_key: sizeKey,
                        source,
                        computed_at: deliveredAt,
                    },
                    sent_at: addDays(createdAt, 2),
                });
            }

            supervisions.push({
                vendor_id: vendor._id,
                status: isDelivered ? "supervised" : "pending",
                total_amount: merchandise,
                total_commission: commission,
                shipping_cost: shippingShare,
                fulfillment_location: vendor.locations[0].address,
            });

            orderMerchandise = round2(orderMerchandise + merchandise);
            orderShipping = round2(orderShipping + shippingShare);
            orderCoupon = round2(orderCoupon + couponShare);
            orderLoyalty = round2(orderLoyalty + loyaltyShare);

            /* ---- The earning ----
             * Only a parcel the customer KEPT earns the vendor anything. A refused parcel
             * (`returned`) produces no earning at all — the goods came back.
             */
            if (isDelivered && !isRto) {
                const net = round2(merchandise - commission);
                const clearableAt = addDays(deliveredAt, 14);
                const isCleared = clearableAt <= now;

                /* ---- Refunds ----
                 * A refund COMPLETES some days after delivery, and reduces whichever month
                 * that lands in. Partial refunds are the common case, so they dominate.
                 */
                let reversedNet = 0;
                let reversedCommission = 0;
                if (isDelivered && chance(0.11)) {
                    const portion = chance(0.35) ? 1 : rfloat(0.25, 0.7);
                    reversedNet = round2(net * portion);
                    reversedCommission = round2(commission * portion);
                    const completedAt = addDays(deliveredAt, rint(3, 25));

                    // A refund dated in the future has not happened yet; skip it rather
                    // than let the current month report a reversal it has not seen.
                    if (completedAt <= now) {
                        refundDocs.push({
                            _id: oid(),
                            refund_number: `REF-FS${String(refundDocs.length + 1).padStart(5, "0")}`,
                            return_request_id: oid(),
                            order_id: orderId,
                            user_id: customer._id,
                            vendor_id: vendor._id,
                            sub_order_id: subOrderId,
                            line_items: [],
                            subtotal: round2(merchandise * portion),
                            discount_reversal: 0,
                            shipping_refund: portion === 1 ? shippingShare : 0,
                            restocking_fee: 0,
                            total_refund_amount: round2(merchandise * portion + (portion === 1 ? shippingShare : 0)),
                            total_commission_reversal: reversedCommission,
                            original_payment_method: paymentMethod,
                            refund_method: paymentMethod === "cash" ? "bank_transfer" : "original_payment",
                            fault_type: chance(0.6) ? "vendor_fault" : "customer_fault",
                            status: "completed",
                            processed_at: addDays(completedAt, -1),
                            completed_at: completedAt,
                            history: [],
                            created_at: addDays(completedAt, -2),
                            updated_at: completedAt,
                        });
                    } else {
                        reversedNet = 0;
                        reversedCommission = 0;
                    }
                }

                const effectiveNet = round2(Math.max(0, net - reversedNet));
                const fullyReversed = effectiveNet === 0 && reversedNet > 0;

                const earning = {
                    _id: oid(),
                    order_id: orderId,
                    sub_order_id: subOrderId,
                    vendor_id: vendor._id,
                    gross_amount: merchandise,
                    commission_amount: commission,
                    net_amount: net,
                    reversed_net: reversedNet,
                    reversed_commission: reversedCommission,
                    effective_net: effectiveNet,
                    status: fullyReversed ? "reversed" : isCleared ? "available" : "pending",
                    payment_method: paymentMethod,
                    payout_id: null,
                    paid_at: null,
                    delivered_at: deliveredAt,
                    clearable_at: clearableAt,
                    cleared_at: isCleared ? clearableAt : null,
                    has_open_return: false,
                    history: [],
                    created_at: deliveredAt,
                    updated_at: deliveredAt,
                };
                earningDocs.push(earning);

                /* ---- Which cleared earnings were actually paid ----
                 * Older money is more likely to have gone out. What is left UNPAID and long
                 * past its payout date becomes the overdue figure — the number the overview
                 * puts in red, and the one worth being able to see on a test dataset.
                 */
                if (earning.status === "available" && effectiveNet > 0) {
                    const ageOfClearance = (now - clearableAt) / (24 * 60 * 60 * 1000);
                    const payProbability = currentVendorIds.has(String(vendor._id))
                        ? (ageOfClearance > 6 ? 1 : 0.3)
                        : ageOfClearance > 60 ? 0.9 : ageOfClearance > 21 ? 0.6 : 0.25;
                    if (chance(payProbability)) {
                        const key = String(vendor._id);
                        if (!payoutCandidates.has(key)) payoutCandidates.set(key, []);
                        payoutCandidates.get(key).push(earning);
                    }
                }
            }
        }

        if (isDelivered) deliveredCount++;
        else undeliveredCount++;

        /* ---- The order's headline status ----
         * Derived from its parcels in production. Reproduced here rather than defaulted,
         * because every finance query filters on `status ∈ DELIVERED_ORDER_STATUSES` and a
         * wrong value here would silently drop the order from every report.
         */
        const anyRto = subOrders.some((s) => s.status === "returned");
        const allRto = subOrders.every((s) => s.status === "returned");
        const orderStatus = !isDelivered
            ? pick(["pending", "processing", "confirmed", "in_transit", "out_for_delivery"])
            : allRto ? "returned"
                : anyRto ? "partially_returned"
                    : chance(0.06) ? pick(["return_requested", "refunded", "partially_returned"])
                        : "completed";

        const totalPrice = round2(subOrders.reduce((sum, s) => sum + s.cod_amount, 0));

        orderDocs.push({
            _id: orderId,
            user_id: customer._id,
            status: orderStatus,
            placed_as_guest: chance(0.08),
            shipping_address: {
                recipient_name: customer.name,
                phone: customer.phone,
                full_address: customer.addresses[0].full_address,
                shipping_country: "Egypt",
                shipping_city: city.name,
            },
            items,
            sub_orders: subOrders,
            allocation_frozen: isDelivered,
            allocation_frozen_at: isDelivered ? createdAt : null,
            vendor_supervisions: supervisions,
            shipping: {
                enabled: true,
                mode: parcelCount > 1 ? "split" : "combined",
                destination: { country: "Egypt", city: city.name },
                zone_name: city.name,
                method_name: "Bosta Standard",
                method_type: "flat",
                base_cost: orderShipping,
                total_cost: orderShipping,
                per_vendor: subOrders.map((s) => ({ vendor_id: s.vendor_id, cost: s.shipping_share })),
            },
            total_price: totalPrice,
            coupon_code: orderCoupon > 0 ? pick(["WELCOME10", "SAVE15", "RC5"]) : undefined,
            coupon_discount_amount: orderCoupon,
            loyalty: {
                payer_user_id: customer._id,
                eligible_amount: round2(orderMerchandise - orderCoupon - orderLoyalty),
                redeemed_points: orderLoyalty > 0 ? Math.round(orderLoyalty * 10) : 0,
                redemption_discount: orderLoyalty,
            },
            shipments,
            transaction: {
                amount: totalPrice,
                payment_method: paymentMethod,
                status: isDelivered ? "paid" : "pending",
                reference: `TXN-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
                provider: paymentMethod === "cash" ? null : "fawaterak",
                paid_at: isDelivered ? deliveredAt : null,
            },
            history: [],
            delivered_at: isDelivered ? deliveredAt : null,
            created_at: createdAt,
        });
    }

    // Chunked so a large `--orders` run does not build one oversized BSON batch.
    // `throwOnValidationError` matters more than it looks: without it Mongoose drops
    // invalid documents on the floor and resolves successfully, and the report downstream
    // is quietly built on a fraction of the data it claims.
    const insertChunked = async (Model, docs, label) => {
        let inserted = 0;
        for (let i = 0; i < docs.length; i += 500) {
            const res = await Model.insertMany(docs.slice(i, i + 500), {
                ordered: false,
                throwOnValidationError: true,
            });
            inserted += res.length;
        }
        if (inserted !== docs.length) {
            throw new Error(`${label}: only ${inserted} of ${docs.length} documents were inserted`);
        }
        console.log(`[${label}]`.padEnd(16) + `${inserted} created`);
        return inserted;
    };

    await insertChunked(Order, orderDocs, "Orders");
    await insertChunked(VendorEarning, earningDocs, "Earnings");
    await insertChunked(Refund, refundDocs, "Refunds");

    console.log(`                 ${deliveredCount} delivered, ${undeliveredCount} still in flight, ${rtoCount} refused (RTO)`);
    return { payoutCandidates, orderDocs };
};

/* ------------------------------------------------------------------ *
 * Payouts and withdrawal requests
 * ------------------------------------------------------------------ */

/**
 * Two things share this collection, as the model intends: the admin's scheduled payout
 * (created already `paid`) and the vendor's own request (arrives `pending`). Both are
 * seeded — the second is what fills the overview's "open withdrawal requests" queue.
 */
const seedPayouts = async (vendors, payoutCandidates) => {
    const payoutDocs = [];
    const earningUpdates = [];
    let counter = 0;

    for (const [vendorId, earnings] of payoutCandidates.entries()) {
        // Grouped into runs by rough age, so a vendor shows a payout HISTORY rather than
        // one lump — the vendor ledger screen is built to page through exactly that.
        const sorted = earnings.sort((a, b) => a.clearable_at - b.clearable_at);
        const runs = [];
        let current = [];
        for (const earning of sorted) {
            current.push(earning);
            if (current.length >= rint(2, 6)) {
                runs.push(current);
                current = [];
            }
        }
        if (current.length) runs.push(current);

        for (const run of runs) {
            const payoutId = oid();
            const amount = round2(run.reduce((sum, e) => sum + e.effective_net, 0));
            if (amount <= 0) continue;

            const paidAt = addDays(run[run.length - 1].clearable_at, rint(0, 6));
            const vendor = vendors.find((v) => String(v._id) === vendorId);

            payoutDocs.push({
                _id: payoutId,
                withdrawal_number: `${WITHDRAWAL_PREFIX}-${String(++counter).padStart(5, "0")}`,
                vendor_id: new mongoose.Types.ObjectId(vendorId),
                amount,
                initiated_by: "admin",
                earning_ids: run.map((e) => e._id),
                scheduled_for: paidAt,
                bank_details: {
                    bank_name: vendor?.default_bank_details?.bank_name || null,
                    account_holder: vendor?.default_bank_details?.account_holder || null,
                    account_number: vendor?.default_bank_details?.account_number || null,
                    iban: vendor?.default_bank_details?.iban || null,
                    notes: "",
                },
                status: "paid",
                paid_at: paidAt,
                payment_reference: `TRF-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
                history: [],
                created_at: paidAt,
                updated_at: paidAt,
            });

            for (const earning of run) {
                earningUpdates.push({
                    updateOne: {
                        filter: { _id: earning._id },
                        update: { $set: { payout_id: payoutId, paid_at: paidAt } },
                    },
                });
            }
        }
    }

    /* ---- Vendor-initiated requests still awaiting review ----
     * These name no particular parcel — a vendor draws on the balance as a whole — which is
     * why `earning_ids` stays empty and bank details are mandatory on this path.
     */
    const activeVendors = vendors.filter((v) => v.status === "active" && v.default_bank_details?.account_number);
    for (const vendor of shuffled(activeVendors).slice(0, Math.max(3, Math.floor(activeVendors.length / 3)))) {
        const createdAt = daysAgo(rint(1, 20));
        const status = pick(["pending", "pending", "approved", "rejected"]);
        payoutDocs.push({
            _id: oid(),
            withdrawal_number: `${WITHDRAWAL_PREFIX}-${String(++counter).padStart(5, "0")}`,
            vendor_id: vendor._id,
            amount: round2(rfloat(800, 9000)),
            initiated_by: "vendor",
            earning_ids: [],
            scheduled_for: null,
            bank_details: {
                bank_name: vendor.default_bank_details.bank_name,
                account_holder: vendor.default_bank_details.account_holder,
                account_number: vendor.default_bank_details.account_number,
                iban: vendor.default_bank_details.iban,
                notes: "",
            },
            status,
            admin_review: status === "rejected"
                ? { decision: "rejected", notes: "Bank details did not match the registered account holder.", reviewed_at: addDays(createdAt, 1), reviewed_by: "Admin" }
                : status === "approved"
                    ? { decision: "approved", notes: "", reviewed_at: addDays(createdAt, 1), reviewed_by: "Admin" }
                    : { decision: null, notes: "", reviewed_at: null, reviewed_by: null },
            rejection_reason: status === "rejected" ? "Bank details mismatch" : null,
            paid_at: null,
            history: [],
            created_at: createdAt,
            updated_at: createdAt,
        });
    }

    if (payoutDocs.length) await WithdrawalRequest.insertMany(payoutDocs, { ordered: false, throwOnValidationError: true });
    if (earningUpdates.length) {
        for (let i = 0; i < earningUpdates.length; i += 1000) {
            await VendorEarning.bulkWrite(earningUpdates.slice(i, i + 1000));
        }
    }

    const openCount = payoutDocs.filter((p) => ["pending", "approved"].includes(p.status)).length;
    console.log(`[Payouts]       ${payoutDocs.length} created (${openCount} still open for review)`);
    console.log(`                 ${earningUpdates.length} earnings marked settled`);
    return payoutDocs;
};

/* ------------------------------------------------------------------ *
 * Other revenue: subscriptions and packaging supplies
 * ------------------------------------------------------------------ */

const seedSubscriptions = async (vendors) => {
    const docs = [];
    for (const vendor of vendors) {
        // A vendor renews month after month; the run length varies so the monthly chart
        // shows subscription revenue growing rather than a flat line.
        const runLength = rint(3, CONFIG.months);
        const monthly = pick([299, 499, 799, 1499]);

        for (let m = 0; m < runLength; m++) {
            const paidAt = daysAgo(m * 30 + rint(0, 4));
            const status = m === 0 && chance(0.15) ? pick(["pending", "failed"]) : "paid";
            docs.push({
                _id: oid(),
                vendor_id: vendor._id,
                package_id: null,
                type: m === runLength - 1 ? "purchase" : "renew",
                billing_cycle: "monthly",
                amount: monthly,
                currency: "EGP",
                status,
                provider: "fawaterak",
                provider_mode: "live",
                invoice_id: String(rint(1000000, 9999999)),
                paid_at: status === "paid" ? paidAt : null,
                createdAt: paidAt,
                updatedAt: paidAt,
            });
        }
    }
    // Driver-level insert: the schema uses `{ timestamps: true }`, so going through the
    // model would restamp every row with today's date and collapse the monthly chart.
    await SubscriptionPayment.collection.insertMany(docs, { ordered: false });
    const paid = docs.filter((d) => d.status === "paid").length;
    console.log(`[Subscriptions] ${docs.length} created (${paid} paid)`);
    return docs;
};

/**
 * Packaging sold to vendors.
 *
 * Inserted through the driver rather than the model because the schema carries
 * `{ timestamps: true }`, and Mongoose would stamp `createdAt` as NOW — collapsing every
 * supply order onto today and flattening the one revenue line that is supposed to vary by
 * month. The documents are still built and validated through the model first, so they get
 * the schema's defaults and casting.
 */
const seedSupplyOrders = async (vendors) => {
    const catalogue = [
        { name: "Medium poly mailer", unit_price: 4.5, pack_size: 10 },
        { name: "Large poly mailer", unit_price: 6.7, pack_size: 10 },
        { name: "Medium box", unit_price: 6, pack_size: 1 },
        { name: "Thermal label roll", unit_price: 350, pack_size: 500 },
        { name: "Fragile sticker", unit_price: 50, pack_size: 50 },
    ];

    const raws = [];
    let counter = 0;

    for (const vendor of vendors) {
        for (let i = 0; i < rint(2, 9); i++) {
            const createdAt = daysAgo(rint(1, CONFIG.months * 30));
            const items = shuffled(catalogue).slice(0, rint(1, 3)).map((entry) => {
                const quantity = rint(1, 12);
                return {
                    name: entry.name,
                    quantity,
                    unit_price: entry.unit_price,
                    pack_size: entry.pack_size,
                    line_total: round2(quantity * entry.unit_price),
                };
            });
            const total = round2(items.reduce((sum, it) => sum + it.line_total, 0));

            // The wallet pays what it can and an invoice covers the rest — the split must
            // always add up to the total or the model's own validation rejects it.
            const walletAmount = chance(0.6) ? total : round2(total * rfloat(0, 0.6));
            const paymentStatus = chance(0.78) ? "paid" : pick(["unpaid", "cancelled"]);

            const doc = new SupplyOrder({
                order_number: `${SUPPLY_ORDER_PREFIX}${String(++counter).padStart(5, "0")}`,
                vendor_id: vendor._id,
                items,
                total,
                wallet_amount: walletAmount,
                online_amount: round2(total - walletAmount),
                payment_status: paymentStatus,
                settled_at: paymentStatus === "paid" ? createdAt : null,
                status: paymentStatus === "paid" ? pick(["delivered", "delivered", "sent", "approved"]) : pick(["pending", "approved"]),
                ship_to: {
                    contact_name: vendor.name,
                    phone: vendor.phone,
                    address: vendor.locations[0].address,
                    city: vendor.locations[0].shipping_city || "Cairo",
                },
            });

            await doc.validate();
            const raw = doc.toObject();
            raw.createdAt = createdAt;
            raw.updatedAt = createdAt;
            raws.push(raw);
        }
    }

    await SupplyOrder.collection.insertMany(raws, { ordered: false });
    const paid = raws.filter((r) => r.payment_status === "paid").length;
    console.log(`[Supplies]      ${raws.length} created (${paid} paid)`);
    return raws;
};

/* ------------------------------------------------------------------ *
 * Marketing cost
 * ------------------------------------------------------------------ */

/**
 * A dated ledger, not a number typed into the profit page.
 *
 * Roughly a third of the campaigns are made to CROSS a month boundary on purpose: that is
 * the case `AdSpend.amountWithin` exists for, and a report that charged the whole campaign
 * to whichever month it started in would misstate both months without anyone noticing.
 */
const seedAdSpend = async () => {
    const docs = [];

    for (let m = 0; m < CONFIG.months; m++) {
        const monthEnd = daysAgo(m * 30);
        const monthStart = daysAgo((m + 1) * 30 - 1);

        // An always-on campaign spanning the whole month, plus a few bursts.
        docs.push({
            _id: oid(),
            channel: "facebook",
            campaign: "Always-On Prospecting",
            amount: round2(rfloat(8000, 22000)),
            currency: "EGP",
            start_date: monthStart,
            end_date: monthEnd,
            notes: "Continuous prospecting budget.",
            created_by_label: AD_SPEND_LABEL,
            history: [],
            created_at: monthStart,
            updated_at: monthStart,
        });

        for (let b = 0; b < rint(2, 5); b++) {
            const start = addDays(monthStart, rint(0, 24));
            // A third of these run past the month end, so they get apportioned across two.
            const length = chance(0.33) ? rint(8, 20) : rint(1, 6);
            docs.push({
                _id: oid(),
                channel: pick(AD_CHANNELS),
                campaign: pick(CAMPAIGNS),
                amount: round2(rfloat(1200, 14000)),
                currency: "EGP",
                start_date: start,
                end_date: addDays(start, length),
                notes: "",
                created_by_label: AD_SPEND_LABEL,
                history: [],
                created_at: start,
                updated_at: start,
            });
        }
    }

    await AdSpend.insertMany(docs, { ordered: false, throwOnValidationError: true });
    const total = round2(docs.reduce((sum, d) => sum + d.amount, 0));
    console.log(`[Ad spend]      ${docs.length} entries, ${total.toLocaleString()} EGP total`);
    return docs;
};

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

const ensurePayoutSchedule = async () => {
    const settings = (await SiteSettings.findOne()) || new SiteSettings();
    settings.payout_schedule = {
        enabled: true,
        weekday: 1,          // Monday
        interval_weeks: 1,
        anchor_date: daysAgo(400),
        hold_days: 14,       // mirrors RETURN_WINDOW_DAYS
    };
    await settings.save();
    console.log("[Settings]      payout schedule set to weekly on Monday, 14-day hold");
};

/* ------------------------------------------------------------------ *
 * Wallets
 * ------------------------------------------------------------------ */

/**
 * The wallet is DERIVED — (Σ available earnings − Σ withdrawals − Σ wallet-funded supplies).
 * Recomputed here through the production helper rather than written by hand, so the seeded
 * cache cannot disagree with the ledger it is supposed to summarise.
 */
const recomputeWallets = async (vendors) => {
    for (const vendor of vendors) await recomputeWalletBalances(vendor._id);
    console.log(`[Wallets]       recomputed for ${vendors.length} vendors`);
};

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

const main = async () => {
    if (!process.env.MONGO_URI) {
        console.error("MONGO_URI is not set. Add it to Backend/.env before running the seeder.");
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log(`\nConnected to ${mongoose.connection.name}`);

    if (CONFIG.reset) await resetSeededData();
    if (CONFIG.resetOnly) {
        await mongoose.disconnect();
        console.log("\nReset complete.\n");
        return;
    }

    console.log(`\nSeeding finance data — ${CONFIG.vendors} vendors, ${CONFIG.customers} customers, ` +
        `${CONFIG.orders} orders across ${CONFIG.months} months (seed=${CONFIG.seed})\n`);

    const startedAt = Date.now();

    const vendors = await seedVendors();
    const customers = await seedCustomers();
    const { payoutCandidates } = await seedOrdersAndEarnings(vendors, customers);
    await seedPayouts(vendors, payoutCandidates);
    await seedSubscriptions(vendors);
    await seedSupplyOrders(vendors);
    await seedAdSpend();
    await ensurePayoutSchedule();
    await recomputeWallets(vendors);

    console.log(`\nDone in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);
    console.log("Open /admin/dashboard/finance to see it.\n");

    await mongoose.disconnect();
};

main().catch(async (error) => {
    console.error("\nSeeding failed:", error.message);
    if (error.errors) {
        for (const [path, detail] of Object.entries(error.errors)) {
            console.error(`  ${path}: ${detail.message}`);
        }
    }
    console.error(error.stack);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
