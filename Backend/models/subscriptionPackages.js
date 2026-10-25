const mongoose = require("mongoose");
const { Schema } = mongoose;

/* ------------------ SubscriptionPackage Schema ------------------ */
const subscriptionPackageSchema = new Schema(
    {
        name: { type: String, required: true, trim: true },
        name_ar: { type: String, default: '', trim: true },
        description: { type: String, default: '', trim: true },
        description_ar: { type: String, default: '', trim: true },
        price: { type: Number, required: true, min: 0 },
        billing_period: {
            type: String,
            enum: ['monthly', 'yearly', 'trial'],
            required: false,
            default: null,
        },
        max_products: {
            type: Number,
            required: true,
            min: 1,
        },
        status: {
            type: String,
            enum: ['active', 'inactive'],
            default: 'active',
            index: true,
        },
        is_free_trial: {
            type: Boolean,
            default: false,
        },
        trial_days: {
            type: Number,
            default: 0,
            min: 0,
        },

        // ---- Vendor visibility perks granted by this package ----
        // Applied to the vendor when a subscription to this package becomes
        // active (see applyPackagePerks); reset when the subscription ends.
        // Admin can still manually override a vendor's flags afterwards.
        grants_vendors_page: {
            // Show the vendor on the public vendors directory page.
            type: Boolean,
            default: true,
        },
        grants_home_slider: {
            // Feature the vendor in the homepage vendors slider.
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true,
    }
);

/* Free trial packages always have price=0 and billing_period='trial' */
subscriptionPackageSchema.pre('validate', function () {
    if (this.is_free_trial) {
        this.billing_period = 'trial';
        this.price = 0;
    } else if (!this.billing_period) {
        this.invalidate('billing_period', 'billing_period is required for non-trial packages');
    }
});

/* ------------------ SubscriptionPackage Model Methods ------------------ */
const SubscriptionPackage = mongoose.model("SubscriptionPackage", subscriptionPackageSchema);

const getActivePackages = async () => {
    return await SubscriptionPackage.find({ status: 'active' }).sort({ price: 1 }).lean();
};

const getAllPackages = async () => {
    return await SubscriptionPackage.find().sort({ createdAt: -1 }).lean();
};

const getPackageById = async (id) => {
    return await SubscriptionPackage.findById(id).lean();
};

const createPackage = async (data) => {
    return await SubscriptionPackage.create(data);
};

const updatePackage = async (id, data) => {
    return await SubscriptionPackage.findByIdAndUpdate(id, data, { returnDocument: "after", runValidators: true });
};

const deletePackage = async (id) => {
    return await SubscriptionPackage.findByIdAndDelete(id);
};

const togglePackageStatus = async (id) => {
    const pkg = await SubscriptionPackage.findById(id);
    if (!pkg) return null;
    pkg.status = pkg.status === 'active' ? 'inactive' : 'active';
    await pkg.save();
    return pkg;
};

module.exports = {
    SubscriptionPackage,
    getActivePackages,
    getAllPackages,
    getPackageById,
    createPackage,
    updatePackage,
    deletePackage,
    togglePackageStatus,
};
