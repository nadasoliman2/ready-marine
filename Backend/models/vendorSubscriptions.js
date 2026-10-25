const mongoose = require("mongoose");
const { Schema } = mongoose;

/* ------------------ VendorSubscription Schema ------------------ */
const vendorSubscriptionSchema = new Schema(
    {
        vendor_id: {
            type: Schema.Types.ObjectId,
            ref: "Seller",
            required: true,
            index: true,
        },
        package_id: {
            type: Schema.Types.ObjectId,
            ref: "SubscriptionPackage",
            required: true,
        },
        started_at: {
            type: Date,
            required: true,
            default: Date.now,
        },
        expires_at: {
            type: Date,
            required: true,
            index: true,
        },
        status: {
            type: String,
            enum: ['active', 'expired', 'cancelled'],
            default: 'active',
            index: true,
        },
        auto_renew: {
            type: Boolean,
            default: false,
        },
        is_free_trial: {
            type: Boolean,
            default: false,
        },
        // Day-thresholds (7, 3, 1) whose expiry reminder has already gone out.
        // The daily sweep matches a one-day window, so a restart or a second
        // run on the same day would otherwise message the vendor twice.
        expiry_reminders_sent: {
            type: [Number],
            default: [],
        },
        is_admin_grant: {
            type: Boolean,
            default: false,
        },
        cancelled_at: {
            type: Date,
            default: null,
        },
        cancellation_reason: {
            type: String,
            default: null,
        },
    },
    {
        timestamps: { createdAt: true, updatedAt: true },
    }
);

vendorSubscriptionSchema.index({ vendor_id: 1, status: 1 });

const VendorSubscription = mongoose.model("VendorSubscription", vendorSubscriptionSchema);

const createSubscription = async (vendorId, packageId, expiresAt, isFreeTrial = false) => {
    return await VendorSubscription.create({
        vendor_id: vendorId,
        package_id: packageId,
        started_at: new Date(),
        expires_at: expiresAt,
        status: 'active',
        is_free_trial: isFreeTrial,
    });
};

const getActiveSubscriptionForVendor = async (vendorId) => {
    return await VendorSubscription.findOne({
        vendor_id: vendorId,
        status: 'active',
    })
    .populate('package_id')
    .lean();
};

const getAllSubscriptionsForVendor = async (vendorId) => {
    return await VendorSubscription.find({ vendor_id: vendorId })
        .populate('package_id')
        .sort({ createdAt: -1 })
        .lean();
};

const expireSubscription = async (subscriptionId) => {
    return await VendorSubscription.findByIdAndUpdate(
        subscriptionId,
        { status: 'expired' },
        { returnDocument: "after" }
    );
};

const cancelSubscription = async (subscriptionId, reason = null) => {
    return await VendorSubscription.findByIdAndUpdate(
        subscriptionId,
        {
            status: 'cancelled',
            cancelled_at: new Date(),
            cancellation_reason: reason,
        },
        { returnDocument: "after" }
    );
};

const getAllExpiredSubscriptions = async () => {
    return await VendorSubscription.find({
        status: 'active',
        expires_at: { $lt: new Date() },
    }).populate('vendor_id package_id').lean();
};

/**
 * @param match  a further query the rows must also meet (an admin statistics card's own);
 *               kept apart so a status filter narrows it rather than replacing its status
 * @param sort   newest first unless given
 */
const getAllSubscriptions = async ({ vendorId, packageId, status, is_free_trial, match = null, sort = null, page = 1, limit = 20 } = {}) => {
    const own = {};
    if (vendorId) own.vendor_id = vendorId;
    if (packageId) own.package_id = packageId;
    if (status) own.status = status;
    // The admin route has always accepted this filter; it used to be dropped on
    // the floor here, so "Trial only" quietly returned everything.
    if (is_free_trial !== undefined) own.is_free_trial = is_free_trial;
    const filter = match ? { $and: [own, match] } : own;

    const total = await VendorSubscription.countDocuments(filter);
    const subscriptions = await VendorSubscription.find(filter)
        .populate('vendor_id package_id')
        .sort(sort || { createdAt: -1 })
        .skip((Math.max(1, page) - 1) * limit)
        .limit(limit)
        .lean();

    return {
        subscriptions,
        pagination: {
            total,
            page: Number(page),
            pages: Math.ceil(total / limit),
            limit: Number(limit),
        },
    };
};

module.exports = {
    VendorSubscription,
    createSubscription,
    getActiveSubscriptionForVendor,
    getAllSubscriptionsForVendor,
    expireSubscription,
    cancelSubscription,
    getAllExpiredSubscriptions,
    getAllSubscriptions,
};