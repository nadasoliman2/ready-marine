/**
 * A vendor's public reputation numbers: how many orders they have actually completed, and
 * what customers thought of them.
 *
 * Both are DERIVED, never incremented. A parcel delivered today can be returned next week,
 * a review approved this morning can be rejected this afternoon, and an import can create
 * history that no counter ever saw. Recomputing the whole figure for one vendor is a single
 * scoped aggregation, and it is the only approach where every one of those paths lands on
 * the right number instead of a slightly wrong one that gets worse over time.
 *
 * The cached values live on the Seller document so the storefront can read them without an
 * aggregation per page view.
 */

const mongoose = require('mongoose');
const { Seller } = require('../models/sellers');

const RETURNED_STATUSES = ['returned', 'refunded'];

/**
 * How many parcels this vendor delivered and the customer kept.
 *
 * A "completed successful order" is one sub-order — one vendor's parcel from one order,
 * which is the unit the vendor actually fulfils — that:
 *   - reached `delivered`, and
 *   - still has at least one item the customer did not send back.
 *
 * A partial return leaves the order completed: the customer kept something and the vendor
 * delivered it. Only a parcel returned in full stops counting, because then nothing about
 * it succeeded. Cancelled, in-transit and exception parcels never counted in the first
 * place.
 */
const recomputeCompletedOrders = async (vendorId) => {
    if (!mongoose.Types.ObjectId.isValid(String(vendorId))) return 0;
    const { Order } = require('../models/orders');
    const vendorObjectId = new mongoose.Types.ObjectId(String(vendorId));

    const [summary] = await Order.aggregate([
        // Narrow to orders that have such a parcel BEFORE unwinding, so the pipeline never
        // expands the whole collection.
        { $match: { sub_orders: { $elemMatch: { vendor_id: vendorObjectId, status: 'delivered' } } } },
        { $project: { items: 1, sub_orders: 1 } },
        { $unwind: '$sub_orders' },
        { $match: { 'sub_orders.vendor_id': vendorObjectId, 'sub_orders.status': 'delivered' } },
        {
            $addFields: {
                parcel_items: {
                    $filter: {
                        input: { $ifNull: ['$items', []] },
                        as: 'item',
                        cond: { $eq: ['$$item.sub_order_id', '$sub_orders._id'] },
                    },
                },
            },
        },
        {
            $addFields: {
                kept_items: {
                    $filter: {
                        input: '$parcel_items',
                        as: 'item',
                        cond: { $not: [{ $in: [{ $ifNull: ['$$item.return_status', 'none'] }, RETURNED_STATUSES] }] },
                    },
                },
            },
        },
        {
            $match: {
                $expr: {
                    $or: [
                        { $gt: [{ $size: '$kept_items' }, 0] },
                        // A parcel whose items carry no `sub_order_id` predates the
                        // sub-order split. We cannot tell what came back, and refusing to
                        // count a delivery we have no evidence against would quietly erase
                        // every vendor's history at launch.
                        { $eq: [{ $size: '$parcel_items' }, 0] },
                    ],
                },
            },
        },
        { $count: 'completed' },
    ]);

    const completed = summary?.completed || 0;
    await Seller.updateOne({ _id: vendorId }, { completed_orders_count: completed });
    return completed;
};

/**
 * The store's public star rating, from APPROVED reviews written about the VENDOR.
 *
 * Product reviews are deliberately excluded. A seller who ships fast is not made better by
 * selling a good part, and averaging the two would leave a customer unable to tell which
 * they were looking at.
 */
const recomputeVendorRating = async (vendorId) => {
    if (!mongoose.Types.ObjectId.isValid(String(vendorId))) return { rating: 0, reviews_count: 0 };
    const { Review } = require('../models/reviews');

    const [summary] = await Review.aggregate([
        {
            $match: {
                vendor_id: new mongoose.Types.ObjectId(String(vendorId)),
                target_type: 'vendor',
                status: 'approved',
            },
        },
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);

    const rating = summary ? Number(summary.avg.toFixed(2)) : 0;
    const reviews_count = summary ? summary.count : 0;

    await Seller.updateOne({ _id: vendorId }, { rating, reviews_count });
    return { rating, reviews_count };
};

/**
 * Recompute for every vendor a set of orders touched. Used by the delivery and return
 * hooks, where one order can move the numbers of several sellers at once.
 * Fail-safe: a reputation counter must never be the reason a delivery fails to record.
 */
const refreshCompletedOrdersForOrder = async (order) => {
    const vendorIds = new Set(
        (order?.sub_orders || []).map((sub) => String(sub.vendor_id)).filter(Boolean)
    );
    for (const vendorId of vendorIds) {
        await recomputeCompletedOrders(vendorId).catch((err) =>
            console.error(`[VendorStats] completed-order recount failed for ${vendorId}: ${err.message}`)
        );
    }
};

/** Backfill every vendor. Safe to re-run; returns what changed. */
const recomputeAllVendors = async ({ onProgress } = {}) => {
    const vendors = await Seller.find().select('_id store_name completed_orders_count rating reviews_count').lean();
    const changed = [];
    for (const vendor of vendors) {
        const completed = await recomputeCompletedOrders(vendor._id);
        const { rating, reviews_count } = await recomputeVendorRating(vendor._id);
        if (
            completed !== (vendor.completed_orders_count || 0)
            || rating !== (vendor.rating || 0)
            || reviews_count !== (vendor.reviews_count || 0)
        ) {
            changed.push({ vendor: vendor.store_name, completed, rating, reviews_count });
        }
        if (onProgress) onProgress(vendor, { completed, rating, reviews_count });
    }
    return { total: vendors.length, changed };
};

module.exports = {
    recomputeCompletedOrders,
    recomputeVendorRating,
    refreshCompletedOrdersForOrder,
    recomputeAllVendors,
};
