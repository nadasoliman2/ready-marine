const { Product }  = require('../models/products');
const { Category } = require('../models/categories');
require('../models/product_brands');
const { Seller } = require('../models/sellers');
const { matchProductIds } = require('./searchSuggestService');
const carFit = require('./carFitService');
const { featuredIds } = require('./featuredOrderService');

const publicProductStatusQuery = { status: 'published' };

/**
 * The vendor fields a product may carry into a PUBLIC response.
 *
 * Explicit, because populating the seller without a projection sends the whole document —
 * which on this collection means the password hash, the contact email and phone, the payout
 * bank details and the wallet balances, on every product listing and product page. Only
 * what the storefront actually renders belongs here:
 *   store_name / store_username / store_image — the "sold by" card and its link
 *   status / subscription_status              — whether the store can currently be bought from
 *   completed_orders_count / rating / reviews_count — its public track record
 *   auto_publish_products                     — read server-side when a vendor edits a product
 *
 * Anything a new feature needs has to be added here deliberately, which is the point.
 */
const PUBLIC_VENDOR_FIELDS = 'store_name store_username store_slug store_image status subscription_status '
    + 'completed_orders_count rating reviews_count auto_publish_products created_at';

const productDetailPopulate = [
    { path: 'category_id', populate: { path: 'parent_id', populate: { path: 'parent_id' } } },
    { path: 'product_brand_id' },
    { path: 'vendor_id', select: PUBLIC_VENDOR_FIELDS }
];
const productListPopulate = [
    { path: 'category_id' },
    { path: 'product_brand_id' },
    { path: 'vendor_id', select: PUBLIC_VENDOR_FIELDS }
];

const getActiveVendorIds = async () => {
    return Seller.find({ status: { $ne: 'suspended' }, subscription_status: { $in: ['active', 'trial_active'] } }).distinct('_id');
};

/**
 * Load the live sponsored (product-visibility ad) products for a placement,
 * newest-first, as plain objects flagged { sponsored: true }. Only published
 * products from active vendors are returned; `excludeIds` are skipped.
 */
const loadSponsoredProducts = async (placement, { categoryIds = null, limit = 24, excludeIds = [] } = {}) => {
    const { getActiveProductAds } = require('./adService');
    const ads = await getActiveProductAds({ placement, categoryIds, limit });
    if (!ads.length) return [];

    const ids = ads.map(a => a.product_id).filter(Boolean);
    const activeVendorIds = await getActiveVendorIds();
    const prods = await Product.find({
        _id: { $in: ids },
        ...publicProductStatusQuery,
        vendor_id: { $in: activeVendorIds },
    }).populate(productListPopulate).lean();

    const byId = new Map(prods.map(p => [String(p._id), p]));
    const exclude = new Set(excludeIds.map(String));
    const out = [];
    for (const a of ads) { // preserve newest-first ad order
        const p = byId.get(String(a.product_id));
        if (p && !exclude.has(String(p._id))) {
            // The ad behind the placement travels with the product so the client can
            // report what the ad did (seen, clicked, bought), not just that it was sponsored.
            out.push({ ...p, sponsored: true, ad_id: String(a._id), ad_number: a.ad_number, ad_placement: placement });
            exclude.add(String(p._id));
        }
    }
    return out;
};

/**
 * Fetch all categories and organize into a nested tree structure.
 *
 * A subcategory carries the product types of every category above it as well as its own:
 * "Shock absorbers" under "Mechanical parts" is spare parts because its parent is, with
 * nobody ticking it by hand. The shop's type filter already reads it that way
 * (typeCategoryIds below); `type_ids` here says so to whoever reads the tree.
 */
const getCategories = async () => {
    const allCategories = await Category.find({ is_active: true }).sort({ sort_order: 1, name: 1 }).lean();

    const buildTree = (parentId = null, inheritedTypeIds = []) => {
        return allCategories
            .filter(cat => String(cat.parent_id || null) === String(parentId))
            .map(cat => {
                const typeIds = [...new Set([...inheritedTypeIds, ...(cat.type_ids || []).map(String)])];
                return {
                    ...cat,
                    type_ids: typeIds,
                    subcategories: buildTree(cat._id, typeIds)
                };
            });
    };

    return buildTree();
};

/**
 * Helper to get all IDs of a category and its descendants
 */
const getDescendantCategoryIds = async (categoryId) => {
    const allCategories = await Category.find().lean();
    const ids = [categoryId.toString()];

    const findChildren = (parentId) => {
        allCategories.forEach(cat => {
            const catParentId = cat.parent_id ? cat.parent_id.toString() : null;
            if (catParentId === parentId.toString()) {
                ids.push(cat._id.toString());
                findChildren(cat._id);
            }
        });
    };

    findChildren(categoryId);
    return ids;
};

/**
 * The categories a product type covers: the active categories it is assigned to, and every
 * category under them (inactive ones included, as the category filter does). `categories` is
 * the whole collection, read once by the caller.
 */
const typeCategoryIds = (typeId, categories) => {
    const children = new Map();
    for (const cat of categories) {
        const parent = cat.parent_id ? String(cat.parent_id) : null;
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(String(cat._id));
    }
    const assigned = categories
        .filter((cat) => cat.is_active !== false && (cat.type_ids || []).some((id) => String(id) === String(typeId)))
        .map((cat) => String(cat._id));
    const all = new Set();
    const stack = [...assigned];
    while (stack.length) {
        const id = stack.pop();
        if (all.has(id)) continue;
        all.add(id);
        stack.push(...(children.get(id) || []));
    }
    return { assigned, all: [...all] };
};

/**
 * The active product types that lead to something, for the home page's search and the shop:
 * each with the categories it is assigned to (its cards) and how many live products it holds.
 * A type with no products is left out, so it appears on its own once its categories fill up.
 */
const getProductTypes = async () => {
    const { ProductType } = require('../models/productTypes');
    const types = await ProductType.find({ is_active: true }).sort({ sort_order: 1, name: 1 }).lean();
    if (!types.length) return [];

    const [categories, activeVendorIds] = await Promise.all([
        Category.find().select('_id parent_id type_ids is_active').lean(),
        getActiveVendorIds(),
    ]);
    const counts = await Product.aggregate([
        { $match: { ...publicProductStatusQuery, vendor_id: { $in: activeVendorIds } } },
        { $group: { _id: '$category_id', count: { $sum: 1 } } },
    ]);
    const countByCategory = new Map(counts.map((c) => [String(c._id), c.count]));

    return types
        .map((type) => {
            const { assigned, all } = typeCategoryIds(type._id, categories);
            return {
                _id: type._id,
                name: type.name,
                name_ar: type.name_ar || '',
                image: type.image || '',
                sort_order: type.sort_order || 0,
                category_ids: assigned,
                product_count: all.reduce((sum, id) => sum + (countByCategory.get(id) || 0), 0),
            };
        })
        .filter((type) => type.product_count > 0);
};

/**
 * Advanced product search with filters and pagination.
 * Correctly handles all_models and all_years flags in compatibility.
 */
/**
 * @param filters  the listing's query (see below)
 * @param user     the signed-in customer, if any: the products that fit their garage's cars
 *                 come first (services/carFitService.js)
 */
/**
 * The ids matching `query`, cheapest first (`dir` 1) or dearest first (-1), by the price the
 * card shows: what is charged (`discount_price ?? price`), and for a product with variants the
 * cheapest variant's — the same as cardPricing() in the frontend's lib/productPricing.js.
 * Sorting on the stored `price` put a 1000 discounted to 300 among the thousands.
 */
const priceOrderedIds = async (query, dir) => {
    const rows = await Product.aggregate([
        { $match: query },
        { $project: { shown: { $cond: [
            { $gt: [{ $size: { $ifNull: ['$variants', []] } }, 0] },
            { $min: { $map: { input: '$variants', as: 'v', in: { $ifNull: [
                '$$v.discount_price',
                { $ifNull: ['$discount_price', { $ifNull: ['$$v.price', '$price'] }] },
            ] } } } },
            { $ifNull: ['$discount_price', '$price'] },
        ] } } },
        { $sort: { shown: dir, _id: 1 } },
        { $project: { _id: 1 } },
    ]);
    return rows.map((row) => String(row._id));
};

const getAllProducts = async (filters = {}, { user = null } = {}) => {
    const {
        page = 1,
        limit = 12,
        search,
        category_id,
        type_id,
        product_brand_id,
        vendor_id,
        car_brand_id,
        car_model_id,
        car_year,
        min_price,
        max_price,
        for_trunk,
        audience,
        target_audience,
    } = filters;
    // Unless a sort was asked for: a search by how well each product matches, anything else
    // in the shop's own order — best sellers, then the categories in turn
    // (services/featuredOrderService.js).
    const sort = filters.sort || (search ? 'relevance' : 'featured');

    const query = { ...publicProductStatusQuery };

    // 1. Text Search — the same matching as the search box's suggestions
    //    (services/searchSuggestService.js): Arabic letter variants, word order, typos and
    //    part numbers without their dashes. It narrows by id, so it combines with the car
    //    filter below instead of competing with it for `$or`.
    let searchRank = null;
    if (search) {
        searchRank = await matchProductIds(search);
        if (searchRank) {
            query._id = { $in: searchRank };
        } else {
            // The index could not be built: fall back to a plain, escaped text match.
            const pattern = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            query.$and = [{ $or: ['title_en', 'title_ar', 'subtitle_en', 'subtitle_ar', 'sku', 'part_number']
                .map((field) => ({ [field]: { $regex: pattern, $options: 'i' } })) }];
        }
    }

    // 2. Category Filter (includes descendants), and the product type's categories. With both,
    //    the category inside the type: a card opened from the type's list.
    let scopedCategoryIds = null;
    if (category_id) {
        scopedCategoryIds = await getDescendantCategoryIds(category_id);
    }
    if (type_id) {
        const mongoose = require('mongoose');
        const { ProductType } = require('../models/productTypes');
        const type = mongoose.Types.ObjectId.isValid(String(type_id))
            ? await ProductType.findOne({ _id: type_id, is_active: true }).select('_id').lean()
            : null;
        const inType = type ? typeCategoryIds(type._id, await Category.find().select('_id parent_id type_ids is_active').lean()).all : [];
        scopedCategoryIds = scopedCategoryIds ? scopedCategoryIds.filter((id) => inType.includes(String(id))) : inType;
    }
    if (scopedCategoryIds) {
        query.category_id = { $in: scopedCategoryIds };
    }


    // 3. Product Brand Filter
    if (product_brand_id) {
        query.product_brand_id = product_brand_id;
    }

    // 3b. Car Trunk essentials
    if (for_trunk === 'true' || for_trunk === true) {
        query.for_trunk = true;
    }
    // 3c. Marine audience hubs: one key, or several comma-separated for a hub that
    // gathers two audiences (saltwater,freshwater).
    const audiences = String(audience || target_audience || '').split(',').map((a) => a.trim()).filter(Boolean);
    if (audiences.length) {
        query.target_audiences = { $in: audiences };
    }

    const minPrice = min_price !== undefined && min_price !== '' ? Number(min_price) : null;
    const maxPrice = max_price !== undefined && max_price !== '' ? Number(max_price) : null;
    if ((minPrice !== null && Number.isFinite(minPrice)) || (maxPrice !== null && Number.isFinite(maxPrice))) {
        const priceExpr = { $ifNull: ['$discount_price', '$price'] };
        const priceClauses = [];
        if (minPrice !== null && Number.isFinite(minPrice)) {
            priceClauses.push({ $gte: [priceExpr, minPrice] });
        }
        if (maxPrice !== null && Number.isFinite(maxPrice)) {
            priceClauses.push({ $lte: [priceExpr, maxPrice] });
        }
        query.$expr = priceClauses.length === 1 ? priceClauses[0] : { $and: priceClauses };
    }

    // 3b. Vendor / Seller Filter (for public listings and store page)
    // Public product feeds should only expose published products from active vendors.
    if (vendor_id) {
        const activeVendor = await Seller.findOne({
            _id: vendor_id,
            status: { $ne: 'suspended' },
            subscription_status: { $in: ['active', 'trial_active'] }
        }).select('_id').lean();

        if (!activeVendor) {
            return {
                products: [],
                pagination: {
                    total: 0,
                    page: Number(page),
                    pages: 0,
                    limit: Number(limit)
                }
            };
        }

        query.vendor_id = vendor_id;
    } else {
        const activeVendorIds = await getActiveVendorIds();
        query.vendor_id = { $in: activeVendorIds };
    }

    // 4. Car Compatibility Filter
    //    A product matches if ANY of the following is true:
    //      a) is_universal = true
    //      b) compatible_cars has a brand entry where:
    //           - brand_id matches  AND
    //           - (all_models = true  OR  models array has an entry where:
    //                model_id matches  AND
    //                (all_years = true  OR  year is in years array))
    if (car_brand_id || car_model_id || car_year) {
        query.$or = [{ is_universal: true }, ...carFit.carClauses({ car_brand_id, car_model_id, car_year })];
    }

    // 5. Sorting
    let sortOptions = { created_at: -1 };
    if (sort === 'rating')     sortOptions = { rating: -1 };
    if (sort === 'newest')     sortOptions = { created_at: -1 };
    if (sort === 'sold')       sortOptions = { sold_count: -1, created_at: -1 };

    // 6. Execute. With a car to fit (picked in the filters, or the customer's garage), the
    //    products made for it and the universal ones come first, mixed 60/40, then the rest
    //    (services/carFitService.js) — each part in the order asked for.
    const skip = (Number(page) - 1) * Number(limit);
    const end = Number(limit) ? skip + Number(limit) : Infinity;
    // A price order asked for is the whole list in price order: the products that fit the
    // customer's car are not put first, nor the sponsored ones on top (step 7).
    const priceSort = sort === 'price_low' || sort === 'price_high';
    const fit = priceSort ? null : await carFit.tiersFor({ car_brand_id, car_model_id, car_year }, user);
    const within = (cond) => ({ $and: [query, cond] });
    const idsOf = async (cond) => new Set((await Product.find(cond).select('_id').lean()).map((p) => String(p._id)));
    // One page of an order worked out in memory (ids), loaded in that order.
    const loadPage = async (ordered) => {
        const pageIds = ordered.slice(skip, end);
        const docs = await Product.find({ _id: { $in: pageIds } }).populate(productListPopulate).lean();
        const byId = new Map(docs.map((d) => [String(d._id), d]));
        return pageIds.map((id) => byId.get(id)).filter(Boolean);
    };
    let products;
    let total;
    const fitById = new Map();
    if (priceSort) {
        const ordered = await priceOrderedIds(query, sort === 'price_low' ? 1 : -1);
        products = await loadPage(ordered);
        total = ordered.length;
    } else if (sort === 'relevance' && searchRank) {
        // Keep the search's order: find which ranked ids pass the other filters, page through
        // them, and load only that page.
        const passing = await idsOf(query);
        let ordered = searchRank.filter((id) => passing.has(id));
        if (fit) {
            const [onCar, onAny] = await Promise.all([idsOf(within(fit.car)), idsOf(within(fit.universal))]);
            const mixed = carFit.blendLists(ordered.filter((id) => onCar.has(id)), ordered.filter((id) => onAny.has(id)));
            for (const row of mixed) fitById.set(row.item, row.fit);
            ordered = [...mixed.map((row) => row.item), ...ordered.filter((id) => !fitById.has(id))];
        }
        products = await loadPage(ordered);
        total = ordered.length;
    } else if (fit && sort === 'featured') {
        // The shop's own order inside each part: best sellers, then the categories in turn.
        const [onCar, onAny, rest] = await Promise.all([
            featuredIds(within(fit.car)), featuredIds(within(fit.universal)), featuredIds(within(fit.rest)),
        ]);
        const mixed = carFit.blendLists(onCar, onAny);
        for (const row of mixed) fitById.set(row.item, row.fit);
        const ordered = [...mixed.map((row) => row.item), ...rest];
        products = await loadPage(ordered);
        total = ordered.length;
    } else if (fit) {
        const [carCount, universalCount, all] = await Promise.all([
            Product.countDocuments(within(fit.car)),
            Product.countDocuments(within(fit.universal)),
            Product.countDocuments(query),
        ]);
        total = all;
        // Which part each position of this page comes from, and how far into each part it is.
        const plan = carFit.blendPlan(carCount, universalCount, end);
        const before = { car: 0, universal: 0 };
        for (const part of plan.slice(0, skip)) before[part] += 1;
        const onPage = plan.slice(skip);
        const take = (part) => onPage.filter((x) => x === part).length;
        const mixedCount = carCount + universalCount;
        const restSkip = Math.max(0, skip - mixedCount);
        const restTake = Math.max(0, Math.min(end, all) - Math.max(skip, mixedCount));
        const load = (cond, from, count) => (count > 0
            ? Product.find(within(cond)).sort(sortOptions).skip(from).limit(count).populate(productListPopulate).lean()
            : []);
        const [onCar, onAny, rest] = await Promise.all([
            load(fit.car, before.car, take('car')),
            load(fit.universal, before.universal, take('universal')),
            load(fit.rest, restSkip, restTake),
        ]);
        let c = 0;
        let u = 0;
        products = onPage.map((part) => (part === 'car' ? onCar[c++] : onAny[u++])).filter(Boolean);
        onCar.forEach((p) => fitById.set(String(p._id), 'car'));
        onAny.forEach((p) => fitById.set(String(p._id), 'universal'));
        products.push(...rest);
    } else if (sort === 'featured') {
        const ordered = await featuredIds(query);
        products = await loadPage(ordered);
        total = ordered.length;
    } else {
        [products, total] = await Promise.all([
            Product.find(query)
                .sort(sortOptions)
                .skip(skip)
                .limit(Number(limit))
                .populate(productListPopulate)
                .lean(),
            Product.countDocuments(query)
        ]);
    }

    // 7. Sponsored injection — pin live product-visibility ads to the top of
    //    page 1 of the general/category listing (not vendor store pages).
    let items = products;
    if (Number(page) === 1 && !vendor_id && !priceSort) {
        const placement = (category_id || type_id) ? 'category_top' : 'shop_top';
        const live = await loadSponsoredProducts(placement, {
            categoryIds: scopedCategoryIds,
            limit: Number(limit),
        });
        // On a search, only the sponsored products that match it. With a car to fit, only
        // the ones that fit it: an ad for another car's part would sit above the customer's.
        const matched = searchRank ? new Set(searchRank) : null;
        let sponsored = matched ? live.filter((p) => matched.has(String(p._id))) : live;
        if (fit && sponsored.length) {
            const ids = sponsored.map((p) => p._id);
            const [onCar, onAny] = await Promise.all([
                idsOf({ $and: [{ _id: { $in: ids } }, fit.car] }),
                idsOf({ $and: [{ _id: { $in: ids } }, fit.universal] }),
            ]);
            sponsored = sponsored.filter((p) => onCar.has(String(p._id)) || onAny.has(String(p._id)));
            sponsored.forEach((p) => fitById.set(String(p._id), onCar.has(String(p._id)) ? 'car' : 'universal'));
        }
        if (sponsored.length) {
            const sponsoredIds = new Set(sponsored.map(p => String(p._id)));
            items = [...sponsored, ...products.filter(p => !sponsoredIds.has(String(p._id)))].slice(0, Number(limit));
        }
    }

    // Each product put first for the car says so: 'car' (made for it) or 'universal'.
    if (fit) {
        items = items.map((p) => (fitById.has(String(p._id)) ? { ...p, fit: fitById.get(String(p._id)) } : p));
    }

    return {
        products: items,
        pagination: {
            total,
            page:  Number(page),
            pages: Math.ceil(total / Number(limit)),
            limit: Number(limit)
        },
        // The garage cars the list was ordered for, named, so the shop can say so.
        ...(fit?.cars.length ? { fit_for: fit.cars } : {}),
    };
};

const getLandingProducts = async (section, limit = 8) => {
    const safeLimit = Math.min(Math.max(Number(limit) || 8, 1), 24);
    const activeVendorIds = await getActiveVendorIds();
    const baseMatch = {
        ...publicProductStatusQuery,
        vendor_id: { $in: activeVendorIds },
    };

    // Map landing section keys to ad placement keys, then pin sponsored picks.
    const SECTION_PLACEMENT = { 'most-sold': 'most_sold', 'new-arrivals': 'new_arrivals', 'special-offers': 'special_offers' };
    const withSponsored = async (organic) => {
        const placement = SECTION_PLACEMENT[section];
        const list = (organic || []).map(p => (p.toObject ? p.toObject() : p));
        if (!placement) return list;
        const sponsored = await loadSponsoredProducts(placement, { limit: safeLimit });
        if (!sponsored.length) return list;
        const ids = new Set(sponsored.map(p => String(p._id)));
        return [...sponsored, ...list.filter(p => !ids.has(String(p._id)))].slice(0, safeLimit);
    };

    if (section === 'most-sold') {
        const organic = await Product.find(baseMatch)
            .sort({ sold_count: -1, created_at: -1 })
            .limit(safeLimit)
            .populate(productListPopulate)
            .lean();
        return withSponsored(organic);
    }

    if (section === 'new-arrivals') {
        const organic = await Product.find(baseMatch)
            .sort({ created_at: -1 })
            .limit(safeLimit)
            .populate(productListPopulate)
            .lean();
        return withSponsored(organic);
    }

    if (section === 'special-offers') {
        const products = await Product.aggregate([
            { $match: baseMatch },
            {
                $addFields: {
                    base_discount_percentage: {
                        $cond: [
                            {
                                $and: [
                                    { $gt: ['$price', 0] },
                                    { $ne: ['$discount_price', null] },
                                    { $lt: ['$discount_price', '$price'] },
                                ],
                            },
                            { $multiply: [{ $divide: [{ $subtract: ['$price', '$discount_price'] }, '$price'] }, 100] },
                            0,
                        ],
                    },
                    variant_discount_percentages: {
                        $map: {
                            input: { $ifNull: ['$variants', []] },
                            as: 'variant',
                            in: {
                                $let: {
                                    vars: {
                                        variantPrice: { $ifNull: ['$$variant.price', '$price'] },
                                        variantDiscount: { $ifNull: ['$$variant.discount_price', '$discount_price'] },
                                    },
                                    in: {
                                        $cond: [
                                            {
                                                $and: [
                                                    { $gt: ['$$variantPrice', 0] },
                                                    { $ne: ['$$variantDiscount', null] },
                                                    { $lt: ['$$variantDiscount', '$$variantPrice'] },
                                                ],
                                            },
                                            { $multiply: [{ $divide: [{ $subtract: ['$$variantPrice', '$$variantDiscount'] }, '$$variantPrice'] }, 100] },
                                            0,
                                        ],
                                    },
                                },
                            },
                        },
                    },
                },
            },
            {
                $addFields: {
                    variant_discount_percentage: { $ifNull: [{ $max: '$variant_discount_percentages' }, 0] },
                },
            },
            {
                $addFields: {
                    discount_percentage: { $max: ['$base_discount_percentage', '$variant_discount_percentage'] },
                },
            },
            { $match: { discount_percentage: { $gt: 0 } } },
            { $sort: { discount_percentage: -1, created_at: -1 } },
            { $limit: safeLimit },
        ]);

        // `productListPopulate` is a list of populate specs, so it is passed as the whole
        // options argument — wrapping it in `{ path: ... }` would populate nothing.
        const organic = await Product.populate(products, productListPopulate);
        return withSponsored(organic);
    }

    return [];
};

/**
 * Products for the dedicated homepage "Promoted Products" row — live
 * product-visibility ads with the 'promoted_section' placement, newest-first.
 */
const getPromotedSectionProducts = async (limit = 8) => {
    const safeLimit = Math.min(Math.max(Number(limit) || 8, 1), 24);
    return loadSponsoredProducts('promoted_section', { limit: safeLimit });
};

/**
 * Fetch all available filter metadata for the frontend
 */
/**
 * Cache for `getFilterMetadata`.
 *
 * This is the categories + car brands + product brands payload every product-facing
 * screen (customer, vendor and admin alike) loads before it can render a filter or a
 * form. Car brands alone carry ~3,400 models and ~110,000 model-years, so building this
 * from scratch is a multi-megabyte read and JSON build every time — and with no cache it
 * ran on nearly every product-related page view, which is what actually made "opening a
 * products page" feel slow everywhere at once. Reference data like this barely changes
 * (an admin editing a category or a car brand, at most a few times a day), so a short
 * TTL plus explicit invalidation on the write side (see `invalidateFilterMetadataCache`,
 * called from the admin category/brand/car-brand routes) is a safe trade: at most a few
 * minutes of staleness, in exchange for not rebuilding this on every page view.
 */
const FILTER_METADATA_TTL_MS = 5 * 60 * 1000;
const filterMetadataCache = new Map(); // parts key -> { data, expiresAt }

const invalidateFilterMetadataCache = () => { filterMetadataCache.clear(); };

const FILTER_PARTS = ['categories', 'carBrands', 'productBrands', 'productTypes'];

/**
 * One make's models, with their years. Fetched when a customer picks a make, instead of
 * shipping every make's models to every visitor.
 */
const getCarBrandModels = async (brandId) => {
    const mongoose = require('mongoose');
    const { CarBrand } = require('../models/car_brands');
    if (!mongoose.Types.ObjectId.isValid(String(brandId))) return null;
    const brand = await CarBrand.findById(brandId).select('name name_ar models').lean();
    if (!brand) return null;
    return { _id: brand._id, name: brand.name, name_ar: brand.name_ar || '', models: brand.models || [] };
};

/**
 * @param {string[]|null} parts  which sections the caller needs, or null for all three.
 *
 * Asking for less matters more than it looks: `carBrands` is 2 MB of JSON on this
 * install — 115 makes, 3,439 models, 111,438 model-years — while `categories` and
 * `productBrands` together are under 90 KB. A screen that only draws a category and a
 * brand filter (the product LISTS) was waiting on all of it before it rendered anything,
 * which is what made "publish a product, land on the products page" feel stuck. Only the
 * product FORMS, where a vendor picks which cars a part fits, actually need the makes.
 */
const getFilterMetadata = async (parts = null, { detail = 'slim' } = {}) => {
    const wanted = Array.isArray(parts) && parts.length
        ? FILTER_PARTS.filter((k) => parts.includes(k))
        : FILTER_PARTS;
    const full = detail === 'full';
    const key = `${wanted.join(',')}|${full ? 'full' : 'slim'}`;

    const cached = filterMetadataCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const { CarBrand } = require('../models/car_brands');
    const { Brand }    = require('../models/product_brands');

    // Slim by default: the makes WITHOUT their models and years. That nesting is the whole
    // weight of this payload (111,438 model-years on this install), and the screens that
    // load it — the home page, the shop filters, the garage — only draw a list of makes
    // until someone picks one. The models for the picked make are then one small request
    // (`getCarBrandModels`). `detail=full` is for the product forms, which need every make
    // expanded at once to render the compatibility builder.
    const [categories, carBrands, productBrands] = await Promise.all([
        wanted.includes('categories') ? getCategories() : null,
        wanted.includes('carBrands')
            ? CarBrand.find().select(full ? undefined : '-models').lean()
            : null,
        // Hand-entered brands AND the car makes, as one list: a part made by the car maker
        // is branded with that maker, and the maker already exists — see brandRef.js.
        wanted.includes('productBrands')
            ? Brand.find().lean().then((rows) => require('./shared/brandRef').mergedProductBrands(rows))
            : null,
    ]);
    if (carBrands && !full) {
        // Kept so a caller can still say "12 models" without asking for them.
        const counts = await CarBrand.aggregate([
            { $project: { model_count: { $size: { $ifNull: ['$models', []] } } } },
        ]);
        const byId = new Map(counts.map((c) => [String(c._id), c.model_count]));
        for (const brand of carBrands) brand.model_count = byId.get(String(brand._id)) || 0;
    }

    if (carBrands) {
        // Makes are stored by their English name; these let a picker find "تويوتا" too.
        const { carMakeArabicNames } = require('./searchSuggestService');
        for (const brand of carBrands) {
            const aliases = carMakeArabicNames(brand.name);
            if (aliases.length) brand.name_aliases = aliases;
        }
    }

    const data = {};
    if (categories) data.categories = categories;
    if (wanted.includes('productTypes')) data.productTypes = await getProductTypes();
    if (carBrands) data.carBrands = carBrands;
    if (productBrands) data.productBrands = productBrands;

    filterMetadataCache.set(key, { data, expiresAt: Date.now() + FILTER_METADATA_TTL_MS });
    return data;
};

/**
 * Recommendations for a signed-in customer: the profile's recommendations tab.
 *
 * Works with or without a vessel in the garage. Several sources, taken in turn so each
 * gets a share of the list, each product once:
 *   vessel    parts made for a garage vessel (services/carFitService.js) — only with one
 *   cart      the categories of what is in the cart
 *   interest  the audience hubs the customer picked, plus those of their cart's products
 *   new       the newest arrivals
 *   popular   best sellers
 * Never what is already in the cart or was bought in the last 30 days. Only published
 * products from active vendors.
 *
 * @returns {{ products, cars }}  each product with `reason` (and `fit: 'car'` for a vessel
 *          part); `cars`: the garage vessels used, named — empty with none.
 */
const getRecommendationsForUser = async (userId, limit = 5) => {
    const { User } = require('../models/users');
    const { cleanAudiences } = require('./shared/audiences');
    const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 20);

    const user = await User.findById(userId).select('cars cart.items.product_id interests').lean();
    if (!user) return { products: [], cars: [] };

    const cartIds = (user.cart?.items || []).map((i) => i.product_id).filter(Boolean);
    const [recent, cartProducts, fit, vendorIds] = await Promise.all([
        carFit.recentlyBoughtIds(user._id),
        cartIds.length ? Product.find({ _id: { $in: cartIds } }).select('category_id target_audiences').lean() : [],
        carFit.tiersFor({}, user),
        getActiveVendorIds(),
    ]);
    const cartCategories = [...new Map(cartProducts.filter((p) => p.category_id).map((p) => [String(p.category_id), p.category_id])).values()];
    const interests = cleanAudiences([...(user.interests || []), ...cartProducts.flatMap((p) => p.target_audiences || [])]);

    const exclude = [...cartIds, ...recent];
    const base = { ...publicProductStatusQuery, vendor_id: { $in: vendorIds }, ...(exclude.length ? { _id: { $nin: exclude } } : {}) };
    const bestFirst = { sold_count: -1, created_at: -1 };
    const sources = [
        fit && { reason: 'vessel', cond: fit.car, sort: bestFirst },
        cartCategories.length && { reason: 'cart', cond: { category_id: { $in: cartCategories } }, sort: bestFirst },
        interests.length && { reason: 'interest', cond: { target_audiences: { $in: interests } }, sort: bestFirst },
        { reason: 'new', cond: {}, sort: { created_at: -1 } },
        { reason: 'popular', cond: {}, sort: bestFirst },
    ].filter(Boolean);

    const lists = await Promise.all(sources.map((s) => Product.find({ $and: [base, s.cond] })
        .sort(s.sort)
        .limit(safeLimit)
        .populate(productListPopulate)
        .lean()));

    const seen = new Set();
    const products = [];
    for (let i = 0; products.length < safeLimit && lists.some((list) => i < list.length); i += 1) {
        for (const [k, list] of lists.entries()) {
            const item = list[i];
            if (!item || seen.has(String(item._id))) continue;
            seen.add(String(item._id));
            const { reason } = sources[k];
            products.push({ ...item, reason, ...(reason === 'vessel' ? { fit: 'car' } : {}) });
            if (products.length >= safeLimit) break;
        }
    }
    return { products, cars: fit?.cars || [] };
};

const getProductById = async (id, options = {}) => {
    const query = { _id: id };

    if (options.publicOnly) {
        query.status = publicProductStatusQuery.status;
        query.vendor_id = { $in: await getActiveVendorIds() };
    }

    return await Product.findOne(query).populate(productDetailPopulate);
};

const getProductBySlug = async (slug) => {
    const activeVendorIds = await getActiveVendorIds();

    return await Product.findOne({
        ...publicProductStatusQuery,
        vendor_id: { $in: activeVendorIds },
        $or: [
            { slug_en: slug },
            { slug_ar: slug }
        ]
    }).populate(productDetailPopulate);
};

module.exports = {
    invalidateFilterMetadataCache,
    getDescendantCategoryIds,
    getAllProducts,
    getLandingProducts,
    getPromotedSectionProducts,
    getProductById,
    getProductBySlug,
    getCategories,
    getFilterMetadata,
    getCarBrandModels,
    getRecommendationsForUser,
    getActiveVendorIds,
};
