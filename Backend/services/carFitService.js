/**
 * "Fits your car": which products are made for the customer's car, which fit any car, and
 * the order a list shows them in.
 *
 * A product is one of three:
 *   car        made for the car — its compatible_cars name the make, the model, the year
 *   universal  fits any car (`is_universal`: car care, accessories, tools)
 *   rest       everything else, and anything the customer bought in the last
 *              RECENT_PURCHASE_DAYS: a part they have just fitted is not worth pushing again
 *
 * The car's products and the universal ones come first, mixed CAR_SHARE to the rest — 6
 * parts for the car in every 10, then 4 for any car — and the rest after them, each part in
 * the order the visitor sorted by. When one of the two runs out, the other carries on.
 *
 * Which car: the one picked in the filters (the hero search, the shop's car filter, a garage
 * car), or else every car in the signed-in customer's garage.
 */

const { Order } = require('../models/orders');

const CAR_SHARE = 60; // percent
const RECENT_PURCHASE_DAYS = 30;

/** The compatible_cars clauses one car matches — the same rules as the shop's car filter. */
const carClauses = ({ car_brand_id, car_model_id, car_year } = {}) => {
    if (!car_brand_id) return [];
    const brand_id = car_brand_id;
    if (!car_model_id) return [{ compatible_cars: { $elemMatch: { brand_id } } }];
    const model_id = car_model_id;
    const year = Number(car_year);
    if (!car_year || !Number.isFinite(year)) {
        return [
            { compatible_cars: { $elemMatch: { brand_id, all_models: true } } },
            { compatible_cars: { $elemMatch: { brand_id, models: { $elemMatch: { model_id } } } } },
        ];
    }
    return [
        { compatible_cars: { $elemMatch: { brand_id, all_models: true } } },
        { compatible_cars: { $elemMatch: { brand_id, models: { $elemMatch: { model_id, all_years: true } } } } },
        { compatible_cars: { $elemMatch: { brand_id, models: { $elemMatch: { model_id, years: year } } } } },
    ];
};

/** A garage car in the shape the filters use. */
const fromGarage = (car) => ({ car_brand_id: car.car_brand_id, car_model_id: car.car_model_id, car_year: car.year });

const garageLabel = (car) => [car.car_brand_name, car.car_model_name, car.year].filter(Boolean).join(' ');

/** Products the customer ordered in the last RECENT_PURCHASE_DAYS (cancelled orders and declined lines left out). */
const recentlyBoughtIds = async (userId) => {
    if (!userId) return [];
    const since = new Date(Date.now() - RECENT_PURCHASE_DAYS * 86400000);
    const orders = await Order.find({
        $or: [{ user_id: userId }, { ordered_for_user_id: userId }],
        created_at: { $gte: since },
        status: { $ne: 'cancelled' },
    }).select('items.product_id items.vendor_status').lean();
    const ids = new Map();
    for (const order of orders) {
        for (const item of order.items || []) {
            if (item.product_id && item.vendor_status !== 'declined') ids.set(String(item.product_id), item.product_id);
        }
    }
    return [...ids.values()];
};

/**
 * The three parts of a list, as query conditions, or null when there is no car to fit.
 *
 * @param filters  the listing's filters (a car picked there wins over the garage)
 * @param user     the signed-in customer, if any (their garage, their recent orders)
 * @returns {{ car, universal, rest, cars: string[] } | null}  `cars`: the garage cars used,
 *          named, when the order comes from the garage
 */
const tiersFor = async (filters = {}, user = null) => {
    let cars = [];
    let named = [];
    if (filters.car_brand_id) {
        cars = [filters];
    } else if (user?.cars?.length) {
        const garage = user.cars.filter((car) => car.car_brand_id && car.car_model_id);
        cars = garage.map(fromGarage);
        named = garage.map(garageLabel);
    }
    const clauses = cars.flatMap(carClauses);
    if (!clauses.length) return null;

    const recent = await module.exports.recentlyBoughtIds(user?._id);
    const notRecent = recent.length ? [{ _id: { $nin: recent } }] : [];
    const fits = { $or: clauses };
    const car = { $and: [fits, ...notRecent] };
    const universal = { $and: [{ is_universal: true }, { $nor: [fits] }, ...notRecent] };
    return { car, universal, rest: { $nor: [car, universal] }, cars: named };
};

/**
 * Which part each position of the mixed list comes from: 'car' or 'universal', for positions
 * [0, end), given how many of each there are. CAR_SHARE of every ten are the car's, spread
 * through rather than bunched (car, car, universal, car, universal, …).
 */
const blendPlan = (carCount, universalCount, end = Infinity) => {
    const plan = [];
    let car = 0;
    let universal = 0;
    const length = Math.min(end, carCount + universalCount);
    for (let k = 0; k < length; k += 1) {
        // Car parts due by this position: ceil(CAR_SHARE% of k+1), in whole numbers.
        const due = Math.floor((CAR_SHARE * (k + 1) + 99) / 100);
        const takeCar = car < carCount && (universal >= universalCount || car < due);
        if (takeCar) { plan.push('car'); car += 1; } else { plan.push('universal'); universal += 1; }
    }
    return plan;
};

/** Two ordered lists mixed by blendPlan, tagged with the part each came from. */
const blendLists = (carList, universalList, end = Infinity) => {
    const out = [];
    let c = 0;
    let u = 0;
    for (const part of blendPlan(carList.length, universalList.length, end)) {
        out.push(part === 'car' ? { item: carList[c++], fit: 'car' } : { item: universalList[u++], fit: 'universal' });
    }
    return out;
};

module.exports = {
    CAR_SHARE,
    RECENT_PURCHASE_DAYS,
    carClauses,
    recentlyBoughtIds,
    tiersFor,
    blendPlan,
    blendLists,
};
