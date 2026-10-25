/**
 * Vendor Subscription Service
 * Handles the full subscription lifecycle: purchase, renew, expire, resubscribe.
 * Products are unpublished (not vendor suspended) when subscription ends.
 */
const { Product } = require('../models/products');
const { Bundle } = require('../models/bundles');
const { Seller } = require('../models/sellers');
const { SubscriptionPayment } = require('../models/subscriptionPayments');
const { VendorSubscription, createSubscription, getActiveSubscriptionForVendor, getAllSubscriptionsForVendor, expireSubscription, cancelSubscription, getAllExpiredSubscriptions, getAllSubscriptions } = require('../models/vendorSubscriptions');
const { SubscriptionPackage } = require('../models/subscriptionPackages');
const { sendSubscriptionNotification, sendExpiryReminders } = require('./notificationService');

/**
 * Calculate expiration date based on billing period.
 * @param {string} billingPeriod - 'monthly', 'yearly', or 'trial'
 * @param {number} fromDate - for 'trial', number of days; for others, optional Date to extend from
 */
const calcExpiresAt = (billingPeriod, fromDate = null) => {
    let base;
    if (billingPeriod === 'trial' && fromDate) {
        // fromDate is number of days for trial
        base = new Date();
        base.setDate(base.getDate() + Number(fromDate));
    } else {
        base = fromDate ? new Date(fromDate) : new Date();
        if (billingPeriod === 'yearly') {
            base.setFullYear(base.getFullYear() + 1);
        } else {
            base.setMonth(base.getMonth() + 1);
        }
    }
    return base;
};

/**
 * Get the count of published products for a vendor.
 * Draft and pending products do NOT count toward the limit.
 */
const getVendorPublishedProductCount = async (vendorId) => {
    return await Product.countDocuments({
        vendor_id: vendorId,
        status: 'published',
    });
};

/**
 * Unpublish all products for a vendor (set to draft, keep is_published=true).
 * Also tracks when each product was hidden for subscription-related reasons.
 */
const unpublishAllVendorProducts = async (vendorId) => {
    await Product.updateMany(
        { vendor_id: vendorId, status: 'published' },
        {
            status: 'draft',
            subscription_hidden_at: new Date(),
            modified_after_subscription_restore: false,
        }
    );
    // Bundles follow the same lifecycle so they don't stay live after a lapse.
    await Bundle.updateMany(
        { vendor_id: vendorId, status: 'published' },
        {
            status: 'draft',
            subscription_hidden_at: new Date(),
            modified_after_subscription_restore: false,
        }
    );
};

/**
 * Republish all products that were previously approved (is_published: true).
 * Only republishes products that:
 * - Are NOT currently pending admin review (modified_after_subscription_restore === false)
 * - Have subscription_hidden_at set (were hidden by subscription logic)
 *
 * Products edited after restore go back to pending review.
 */
const republishVendorProducts = async (vendorId) => {
    // Republish products that were approved before and were set to draft (subscription ended)
    // but NOT products that were edited by the vendor after restoration (those need re-review)
    await Product.updateMany(
        { vendor_id: vendorId, is_published: true, status: 'draft', modified_after_subscription_restore: false },
        {
            status: 'published',
            subscription_hidden_at: null,
        }
    );
    // Restore bundles hidden by the subscription lifecycle.
    await Bundle.updateMany(
        { vendor_id: vendorId, is_published: true, status: 'draft', modified_after_subscription_restore: false },
        {
            status: 'published',
            subscription_hidden_at: null,
        }
    );
};

/**
 * Apply a package's vendor-visibility perks to the seller when a subscription
 * to that package becomes active. The package "owns" these flags at activation
 * time (it overwrites them); an admin can still manually override afterwards.
 *
 * @param {ObjectId|string} vendorId
 * @param {object} pkg - the SubscriptionPackage (must include grants_* fields)
 */
const applyPackagePerks = async (vendorId, pkg) => {
    if (!pkg) return;
    await Seller.findByIdAndUpdate(vendorId, {
        public_show_on_vendors_page: pkg.grants_vendors_page !== false,
        public_show_on_home: pkg.grants_home_slider === true,
    });
};

/**
 * Reset the package-granted vendor-visibility perks when a subscription ends
 * (expired or cancelled): the vendor is removed from the vendors directory and
 * the homepage slider until they subscribe again.
 */
const resetPackagePerks = async (vendorId) => {
    await Seller.findByIdAndUpdate(vendorId, {
        public_show_on_vendors_page: false,
        public_show_on_home: false,
    });
};

/**
 * Check if vendor has already used a free trial.
 */
const hasUsedFreeTrial = async (vendorId) => {
    const subs = await getAllSubscriptionsForVendor(vendorId);
    return subs.some(sub => sub.is_free_trial === true);
};

/**
 * Assign the active free trial package to a newly-created vendor.
 * No-op when the platform has no active free trial package configured.
 */
const assignFreeTrialAfterSignup = async (vendorId) => {
    const freeTrialPackage = await SubscriptionPackage.findOne({
        status: 'active',
        is_free_trial: true,
    }).sort({ createdAt: 1 }).lean();

    if (!freeTrialPackage) return null;

    return await purchaseSubscription(vendorId, freeTrialPackage._id, 'trial');
};

/**
 * Get vendor's full subscription status with product counts and limits.
 */
const getVendorSubscriptionStatus = async (vendorId) => {
    const subscription = await getActiveSubscriptionForVendor(vendorId);
    const publishedCount = await getVendorPublishedProductCount(vendorId);

    if (!subscription) {
        const vendor = await Seller.findById(vendorId).select('subscription_status').lean();
        return {
            hasActive: false,
            subscription: null,
            package: null,
            publishedCount,
            maxProducts: 0,
            remaining: 0,
            subscriptionStatus: vendor?.subscription_status || 'not_subscribed',
            isExpiringSoon: false,
            daysUntilExpiry: null,
        };
    }

    const pkg = subscription.package_id;
    const maxProducts = pkg?.max_products || 0;
    const vendor = await Seller.findById(vendorId).select('subscription_status').lean();

    const expiresAt = new Date(subscription.expires_at);
    const now = new Date();
    const diffMs = expiresAt.getTime() - now.getTime();
    const daysUntilExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const isExpiringSoon = daysUntilExpiry <= 7 && daysUntilExpiry > 0;

    return {
        hasActive: true,
        subscription: {
            _id: subscription._id,
            started_at: subscription.started_at,
            expires_at: subscription.expires_at,
            status: subscription.status,
            is_free_trial: subscription.is_free_trial,
        },
        package: pkg ? {
            _id: pkg._id,
            name: pkg.name,
            description: pkg.description,
            price: pkg.price,
            billing_period: pkg.billing_period,
            max_products: pkg.max_products,
            is_free_trial: pkg.is_free_trial,
            trial_days: pkg.trial_days,
        } : null,
        publishedCount,
        maxProducts,
        remaining: Math.max(0, maxProducts - publishedCount),
        subscriptionStatus: vendor?.subscription_status || 'active',
        isExpiringSoon,
        daysUntilExpiry,
    };
};

/**
 * Check if vendor has an active subscription.
 * Throws if not.
 */
const requireActiveSubscription = async (vendorId) => {
    const subscription = await getActiveSubscriptionForVendor(vendorId);
    if (!subscription) {
        const err = new Error('No active subscription found. Please subscribe to a package to publish products.');
        err.code = 'NO_SUBSCRIPTION';
        throw err;
    }
    return subscription;
};

/**
 * Check if vendor can publish more products (limit not reached).
 * Throws if limit reached.
 */
const requireProductLimit = async (vendorId) => {
    const subscription = await requireActiveSubscription(vendorId);
    const pkg = subscription.package_id;
    if (!pkg) throw new Error('Package not found');

    const count = await getVendorPublishedProductCount(vendorId);
    if (count >= pkg.max_products) {
        const err = new Error(`Product limit reached. Your plan (${pkg.name}) allows ${pkg.max_products} published products. Upgrade or unpublish existing products to add more.`);
        err.code = 'PRODUCT_LIMIT_REACHED';
        err.maxProducts = pkg.max_products;
        err.currentCount = count;
        throw err;
    }
    return { subscription, remaining: pkg.max_products - count };
};

/**
 * Purchase a new subscription (vendor must not have active subscription).
 */
const purchaseSubscription = async (vendorId, packageId, billingPeriod = 'monthly') => {
    // Check no existing active subscription
    const existing = await getActiveSubscriptionForVendor(vendorId);
    if (existing) {
        const err = new Error('You already have an active subscription. Please renew or cancel it first.');
        err.code = 'ALREADY_SUBSCRIBED';
        throw err;
    }

    // Validate package exists and is active
    const pkg = await SubscriptionPackage.findById(packageId).lean();
    if (!pkg) {
        const err = new Error('Package not found');
        err.code = 'PACKAGE_NOT_FOUND';
        throw err;
    }
    if (pkg.status !== 'active') {
        const err = new Error('This package is currently inactive');
        err.code = 'PACKAGE_INACTIVE';
        throw err;
    }

    // Check free trial eligibility
    if (pkg.is_free_trial) {
        const used = await hasUsedFreeTrial(vendorId);
        if (used) {
            const err = new Error('You have already used your free trial. Please select a paid plan.');
            err.code = 'FREE_TRIAL_ALREADY_USED';
            throw err;
        }
    }

    // Calculate expires_at based on trial_days or billing_period
    let expiresAt;
    if (pkg.is_free_trial && pkg.trial_days > 0) {
        expiresAt = calcExpiresAt('trial', pkg.trial_days);
    } else {
        expiresAt = calcExpiresAt(billingPeriod);
    }

    // Create subscription
    const subscription = await createSubscription(vendorId, packageId, expiresAt, pkg.is_free_trial);

    // Republish previously approved products
    await republishVendorProducts(vendorId);

    // Update seller — use 'trial_active' for free trials, 'active' for paid
    await Seller.findByIdAndUpdate(vendorId, {
        subscription_id: subscription._id,
        subscription_status: pkg.is_free_trial ? 'trial_active' : 'active',
        status: 'active',
        subscription_reason: null,
        subscription_date: null,
    });

    // Apply the package's vendor-visibility perks.
    await applyPackagePerks(vendorId, pkg);

    if (pkg.is_free_trial) {
        await sendSubscriptionNotification(vendorId, 'trial_activated', {
            packageName: pkg.name,
            packageNameAr: pkg.name_ar,
            price: pkg.price,
            trialDays: pkg.trial_days,
            expiresAt,
        });
    } else {
        await sendSubscriptionNotification(vendorId, 'subscription_activated', {
            packageName: pkg.name,
            packageNameAr: pkg.name_ar,
            price: pkg.price,
            billingPeriod,
            expiresAt,
            isTrial: false,
        });
    }

    return subscription;
};

/**
 * Renew an existing subscription (extends expiration from current expiry or now).
 * Products stay published during renewal.
 */
const renewSubscription = async (vendorId, billingPeriod = 'monthly') => {
    const existing = await getActiveSubscriptionForVendor(vendorId);
    if (!existing) {
        const err = new Error('No active subscription to renew');
        err.code = 'NO_SUBSCRIPTION';
        throw err;
    }

    const pkg = typeof existing.package_id === 'object' ? existing.package_id : await SubscriptionPackage.findById(existing.package_id).lean();
    if (!pkg) throw new Error('Package not found');

    const currentExpiry = new Date(existing.expires_at);
    const now = new Date();

    // Extend from current expiry if it's in the future; otherwise from now
    let extendedExpiresAt;
    if (currentExpiry > now) {
        extendedExpiresAt = calcExpiresAt(billingPeriod, currentExpiry);
    } else {
        extendedExpiresAt = calcExpiresAt(billingPeriod);
    }

    await VendorSubscription.findByIdAndUpdate(existing._id, {
        expires_at: extendedExpiresAt,
        status: 'active',
    });

    // Update seller subscription_status to active
    await Seller.findByIdAndUpdate(vendorId, {
        subscription_status: 'active',
        subscription_reason: null,
        subscription_date: null,
    });

    // Republish any products that might have been unpublished
    await republishVendorProducts(vendorId);

    await sendSubscriptionNotification(vendorId, 'renewal_successful', {
        packageName: pkg.name,
        packageNameAr: pkg.name_ar,
        expiresAt: extendedExpiresAt,
    });

    return { ...existing, expires_at: extendedExpiresAt };
};

/**
 * Resubscribe after subscription ended/cancelled.
 * If all previously approved products fit within the plan limit -> auto-republish.
 * If over limit -> require product selection.
 */
const resubscribeAfterEnd = async (vendorId, packageId, billingPeriod = 'monthly', selectedProductIds = null) => {
    const pkg = await SubscriptionPackage.findById(packageId).lean();
    if (!pkg || pkg.status !== 'active') {
        const err = new Error('Package not found or inactive');
        err.code = 'PACKAGE_NOT_FOUND';
        throw err;
    }

    // Check free trial eligibility
    if (pkg.is_free_trial) {
        const used = await hasUsedFreeTrial(vendorId);
        if (used) {
            const err = new Error('You have already used your free trial. Please select a paid plan.');
            err.code = 'FREE_TRIAL_ALREADY_USED';
            throw err;
        }
    }

    // Get all previously-approved products (is_published: true)
    const allApproved = await Product.find({ vendor_id: vendorId, is_published: true })
        .select('_id title_en title_ar status').lean();

    const previouslyPublishedCount = allApproved.filter(p => p.status === 'published').length;

    if (previouslyPublishedCount > pkg.max_products) {
        if (!selectedProductIds || !Array.isArray(selectedProductIds) || selectedProductIds.length < 1 || selectedProductIds.length > pkg.max_products) {
            const err = new Error(`You have ${previouslyPublishedCount} products previously approved for publishing but this plan only allows ${pkg.max_products}. Please select up to ${pkg.max_products} products to keep published.`);
            err.code = 'SELECT_PRODUCTS_REQUIRED';
            err.excessCount = previouslyPublishedCount - pkg.max_products;
            err.maxProducts = pkg.max_products;
            err.allProducts = allApproved.map(p => ({
                _id: p._id.toString(),
                title: p.title_en || p.title_ar || 'Untitled',
            }));
            throw err;
        }

        // Unpublish products not selected (keep is_published: true so they can be republished later)
        const selectedSet = new Set(selectedProductIds.map(id => id.toString()));
        const toUnpublish = allApproved.filter(p => !selectedSet.has(p._id.toString()));

        if (toUnpublish.length > 0) {
            await Product.updateMany(
                { _id: { $in: toUnpublish.map(p => p._id) } },
                { status: 'draft', modified_after_subscription_restore: false }
            );
        }
    }
    // If previouslyPublishedCount <= max_products, ALL products are auto-republished (no selection needed)

    // Calculate expires_at
    let expiresAt;
    if (pkg.is_free_trial && pkg.trial_days > 0) {
        expiresAt = calcExpiresAt('trial', pkg.trial_days);
    } else {
        expiresAt = calcExpiresAt(billingPeriod);
    }

    // Create new subscription
    const subscription = await createSubscription(vendorId, packageId, expiresAt, pkg.is_free_trial);

    // Republish products: drafts with is_published=true get published back
    // (already handled above for unselected products)
    await republishVendorProducts(vendorId);

    // Count how many products were restored
    const restoredCount = await Product.countDocuments({
        vendor_id: vendorId,
        status: 'published',
        subscription_hidden_at: { $ne: null },
    });

    // Update seller — use 'trial_active' for free trials, 'active' for paid
    await Seller.findByIdAndUpdate(vendorId, {
        subscription_id: subscription._id,
        subscription_status: pkg.is_free_trial ? 'trial_active' : 'active',
        status: 'active',
        subscription_reason: null,
        subscription_date: null,
    });

    // Apply the (possibly new) package's vendor-visibility perks.
    await applyPackagePerks(vendorId, pkg);

    if (pkg.is_free_trial) {
        await sendSubscriptionNotification(vendorId, 'trial_activated', {
            packageName: pkg.name,
            packageNameAr: pkg.name_ar,
            price: pkg.price,
            trialDays: pkg.trial_days,
            expiresAt,
        });
    } else {
        await sendSubscriptionNotification(vendorId, 'subscription_activated', {
            packageName: pkg.name,
            packageNameAr: pkg.name_ar,
            price: pkg.price,
            billingPeriod,
            expiresAt,
            isTrial: false,
        });
    }

    if (restoredCount > 0) {
        await sendSubscriptionNotification(vendorId, 'product_visibility_restored', {
            productCount: restoredCount,
        });
    }

    return subscription;
};

/**
 * Change an active subscription to another package.
 * If the new package has a lower product limit, the vendor must choose which
 * currently published products stay published.
 */
const changeSubscriptionPlan = async (vendorId, packageId, billingPeriod = 'monthly', selectedProductIds = null) => {
    const existing = await getActiveSubscriptionForVendor(vendorId);
    if (!existing) {
        const err = new Error('No active subscription found');
        err.code = 'NO_SUBSCRIPTION';
        throw err;
    }

    const pkg = await SubscriptionPackage.findById(packageId).lean();
    if (!pkg || pkg.status !== 'active') {
        const err = new Error('Package not found or inactive');
        err.code = 'PACKAGE_NOT_FOUND';
        throw err;
    }

    if (String(existing.package_id?._id || existing.package_id) === String(pkg._id)) {
        const err = new Error('This is already your current plan');
        err.code = 'SAME_PACKAGE';
        throw err;
    }

    if (pkg.is_free_trial && await hasUsedFreeTrial(vendorId)) {
        const err = new Error('You have already used your free trial. Please select a paid plan.');
        err.code = 'FREE_TRIAL_ALREADY_USED';
        throw err;
    }

    const publishedProducts = await Product.find({ vendor_id: vendorId, status: 'published' })
        .select('_id title_en title_ar status')
        .lean();

    if (publishedProducts.length > pkg.max_products) {
        if (!selectedProductIds || !Array.isArray(selectedProductIds) || selectedProductIds.length < 1 || selectedProductIds.length > pkg.max_products) {
            const err = new Error(`You have ${publishedProducts.length} published products but this plan only allows ${pkg.max_products}. Please select up to ${pkg.max_products} products to keep published.`);
            err.code = 'SELECT_PRODUCTS_REQUIRED';
            err.excessCount = publishedProducts.length - pkg.max_products;
            err.maxProducts = pkg.max_products;
            err.allProducts = publishedProducts.map(p => ({
                _id: p._id.toString(),
                title: p.title_en || p.title_ar || 'Untitled',
            }));
            throw err;
        }

        const selectedSet = new Set(selectedProductIds.map(id => id.toString()));
        const toUnpublish = publishedProducts.filter(p => !selectedSet.has(p._id.toString()));
        if (toUnpublish.length > 0) {
            await Product.updateMany(
                { _id: { $in: toUnpublish.map(p => p._id) } },
                {
                    status: 'draft',
                    subscription_hidden_at: new Date(),
                    modified_after_subscription_restore: false,
                }
            );
        }
    }

    const expiresAt = pkg.is_free_trial && pkg.trial_days > 0
        ? calcExpiresAt('trial', pkg.trial_days)
        : calcExpiresAt(billingPeriod);

    await VendorSubscription.findByIdAndUpdate(existing._id, {
        status: 'cancelled',
        cancelled_at: new Date(),
        cancellation_reason: 'Changed subscription plan',
    });

    const subscription = await createSubscription(vendorId, packageId, expiresAt, pkg.is_free_trial);

    await Seller.findByIdAndUpdate(vendorId, {
        subscription_id: subscription._id,
        subscription_status: pkg.is_free_trial ? 'trial_active' : 'active',
        status: 'active',
        subscription_reason: null,
        subscription_date: null,
    });

    // Apply the new package's vendor-visibility perks.
    await applyPackagePerks(vendorId, pkg);

    await sendSubscriptionNotification(vendorId, 'subscription_activated', {
        packageName: pkg.name,
        packageNameAr: pkg.name_ar,
        price: pkg.price,
        billingPeriod: pkg.is_free_trial ? 'trial' : billingPeriod,
        expiresAt,
        isTrial: pkg.is_free_trial,
    });

    return subscription;
};

/**
 * Expire old subscriptions and unpublish vendor products (called by cron).
 * Does NOT suspend vendor — sets subscription_status to 'expired'.
 */
/**
 * Every subscription that runs out is renewed with the free package for three months, as an
 * admin grant (the owner's decision, 2026-10-19 — "for now"). Turn `enabled` off to let them
 * lapse again. It runs AS a subscription ends, not before, so a vendor on a bigger package
 * keeps every day of it; their products stay published throughout. A suspended vendor is
 * left to lapse: a grant would make their account active again.
 */
const FREE_RENEWAL = { enabled: true, months: 3 };

/** The free package the renewal grants: the active one priced at nothing. */
const freeRenewalPackage = async () => (FREE_RENEWAL.enabled
    ? SubscriptionPackage.findOne({ status: 'active', price: 0 }).sort({ is_free_trial: -1, createdAt: 1 }).lean()
    : null);

const expireOldSubscriptions = async () => {
    const expired = await getAllExpiredSubscriptions();
    const results = [];
    const freePkg = await freeRenewalPackage();
    const renewed = new Set();

    for (const sub of expired) {
        await expireSubscription(sub._id);

        // Renewed for free instead of lapsing (FREE_RENEWAL). The old row stays, expired, as
        // the record of what it was; the grant is a new one from today.
        const vendorId = sub.vendor_id?._id;
        // A second row of a vendor just renewed: nothing more to do for them.
        if (freePkg && vendorId && renewed.has(String(vendorId))) continue;
        if (freePkg && vendorId && sub.vendor_id.status !== 'suspended') {
            try {
                await grantAdminSubscription(vendorId, freePkg._id, FREE_RENEWAL.months);
                renewed.add(String(vendorId));
                results.push({ vendorId, subscriptionId: sub._id, status: 'renewed_free' });
                continue;
            } catch (err) {
                console.error(`[Subscriptions] Free renewal failed for vendor ${vendorId}: ${err.message}`);
            }
        }

        if (sub.vendor_id) {
            // Unpublish products (keep is_published for re-approval-less republish)
            await unpublishAllVendorProducts(sub.vendor_id._id);

            // Reset the package-granted visibility perks (off the vendors page + slider)
            await resetPackagePerks(sub.vendor_id._id);

            // Set subscription_status to not_subscribed (not suspended)
            await Seller.findByIdAndUpdate(sub.vendor_id._id, {
                subscription_status: 'not_subscribed',
                subscription_reason: 'Did not renew subscription',
                subscription_date: new Date(),
            });

            await sendSubscriptionNotification(sub.vendor_id._id, 'subscription_expired', {
                packageName: sub.package_id?.name || 'Unknown',
                packageNameAr: sub.package_id?.name_ar || '',
                expiredAt: sub.expires_at,
            });

            await sendSubscriptionNotification(sub.vendor_id._id, 'account_became_not_subscribed', {});

            results.push({
                vendorId: sub.vendor_id._id,
                subscriptionId: sub._id,
                status: 'expired',
            });
        }
    }

    return results;
};

/**
 * Cancel a vendor's subscription (admin action).
 */
const cancelVendorSubscription = async (vendorId) => {
    const sub = await getActiveSubscriptionForVendor(vendorId);
    if (!sub) throw new Error('No active subscription found');

    await cancelSubscription(sub._id);

    // Unpublish products
    await unpublishAllVendorProducts(vendorId);

    // Reset the package-granted visibility perks (off the vendors page + slider)
    await resetPackagePerks(vendorId);

    // Update seller
    await Seller.findByIdAndUpdate(vendorId, {
        subscription_status: 'cancelled',
        subscription_reason: 'Subscription cancelled',
        subscription_date: new Date(),
    });

    await sendSubscriptionNotification(vendorId, 'subscription_cancelled', {
        packageName: sub.package_id?.name || 'Unknown',
        packageNameAr: sub.package_id?.name_ar || '',
    });

    await sendSubscriptionNotification(vendorId, 'account_became_not_subscribed', {});

    return sub;
};

/**
 * Get all subscriptions for admin with full filtering.
 */

/**
 * The subscriptions behind each figure of the admin's statistics, as the query that finds
 * them. The cards count with it and a click on a card lists with it, so the list always holds
 * the number the card shows. Null for a name it does not know.
 */
const subscriptionSegmentFilter = (segment, now = new Date()) => {
    // "Live" means the row says active AND the clock agrees. The nightly sweep flips expired
    // rows, so anything active with a past expiry is a row it has not reached yet.
    const live = { status: 'active', expires_at: { $gte: now } };
    const within = (days) => ({ status: 'active', expires_at: { $gte: now, $lte: new Date(now.getTime() + days * 24 * 60 * 60 * 1000) } });
    switch (segment) {
        case 'active': return live;
        case 'trial': return { ...live, is_free_trial: true };
        case 'admin_grant': return { ...live, is_admin_grant: true, is_free_trial: { $ne: true } };
        // A paying subscription is one nobody was given: not a trial, not a grant.
        case 'paid': return { ...live, is_free_trial: { $ne: true }, is_admin_grant: { $ne: true } };
        case 'expiring_7': return within(7);
        case 'expiring_30': return within(30);
        case 'expired': return { status: 'expired' };
        case 'cancelled': return { status: 'cancelled' };
        case 'awaiting_sweep': return { status: 'active', expires_at: { $lt: now } };
        case 'auto_renew': return { ...live, auto_renew: true };
        case 'started_this_month': return { started_at: { $gte: new Date(now.getFullYear(), now.getMonth(), 1) } };
        default: return null;
    }
};

/** The same for the payment figures: what the transactions list shows from a money card. */
const paymentSegmentFilter = (segment, now = new Date()) => {
    switch (segment) {
        case 'paid': return { status: 'paid' };
        case 'paid_this_month': return { status: 'paid', paid_at: { $gte: new Date(now.getFullYear(), now.getMonth(), 1) } };
        case 'pending': return { status: 'pending' };
        default: return null;
    }
};

/** The vendors with a live subscription; every other vendor counts as not subscribed. */
const vendorIdsWithLiveSubscription = (now = new Date()) => VendorSubscription.distinct('vendor_id', subscriptionSegmentFilter('active', now));

/**
 * Subscription statistics for the admin dashboard.
 *
 * Computed across the whole collection. The page used to derive its cards from
 * whatever rows the paginated list happened to return, so "Total" showed the
 * page size and every figure moved when a filter was applied.
 *
 * Two vocabularies meet here and they do not match, which is the other reason
 * the old cards were wrong: a SELLER carries subscription_status 'trial_active',
 * but a SUBSCRIPTION row only ever has 'active' | 'expired' | 'cancelled' and
 * marks a trial with is_free_trial. Counting subscriptions by 'trial_active'
 * therefore always returned zero. Trial is derived from is_free_trial below.
 */
const getSubscriptionStatsAdmin = async () => {
    const now = new Date();
    const seg = (name) => subscriptionSegmentFilter(name, now);
    const live = seg('active');

    const [
        total, activeLive, awaitingSweep, expired, cancelled,
        trialLive, grantLive, paidLive, expiring7, expiring30, startedThisMonth,
        autoRenew,
    ] = await Promise.all([
        VendorSubscription.countDocuments({}),
        VendorSubscription.countDocuments(live),
        VendorSubscription.countDocuments(seg('awaiting_sweep')),
        VendorSubscription.countDocuments(seg('expired')),
        VendorSubscription.countDocuments(seg('cancelled')),
        VendorSubscription.countDocuments(seg('trial')),
        VendorSubscription.countDocuments(seg('admin_grant')),
        VendorSubscription.countDocuments(seg('paid')),
        VendorSubscription.countDocuments(seg('expiring_7')),
        VendorSubscription.countDocuments(seg('expiring_30')),
        VendorSubscription.countDocuments(seg('started_this_month')),
        VendorSubscription.countDocuments(seg('auto_renew')),
    ]);

    /* ---- vendors ---- */
    // Counted among the vendors themselves, as the "Not subscribed" tab lists them: a
    // subscription of a vendor no longer there must not count anyone as subscribed.
    const liveVendorIds = await vendorIdsWithLiveSubscription(now);
    const [totalVendors, notSubscribed] = await Promise.all([
        Seller.countDocuments({}),
        Seller.countDocuments({ _id: { $nin: liveVendorIds } }),
    ]);

    /* ---- money ---- */
    const sumOf = (match) => SubscriptionPayment.aggregate([{ $match: match }, { $group: { _id: null, sum: { $sum: '$amount' }, n: { $sum: 1 } } }]);
    const [collectedAll, collectedMonth, pending] = await Promise.all([
        sumOf(paymentSegmentFilter('paid', now)),
        sumOf(paymentSegmentFilter('paid_this_month', now)),
        sumOf(paymentSegmentFilter('pending', now)),
    ]);

    /* ---- what the live paid book is worth, and who is on what ---- */
    const perPackage = await VendorSubscription.aggregate([
        { $match: live },
        { $group: { _id: '$package_id', total: { $sum: 1 }, trials: { $sum: { $cond: ['$is_free_trial', 1, 0] } } } },
        { $lookup: { from: 'subscriptionpackages', localField: '_id', foreignField: '_id', as: 'pkg' } },
        { $unwind: { path: '$pkg', preserveNullAndEmptyArrays: true } },
        {
            $project: {
                _id: 0,
                package_id: '$_id',
                name: '$pkg.name',
                name_ar: '$pkg.name_ar',
                price: { $ifNull: ['$pkg.price', 0] },
                billing_period: '$pkg.billing_period',
                total: 1,
                trials: 1,
            },
        },
        { $sort: { total: -1 } },
    ]);

    // Book value of the live paid subscriptions at their package's list price.
    // Not revenue — nothing here was necessarily collected — so it is labelled
    // as contract value, and grants and trials are excluded because they bill
    // nobody anything.
    const bookValue = await VendorSubscription.aggregate([
        { $match: seg('paid') },
        { $lookup: { from: 'subscriptionpackages', localField: 'package_id', foreignField: '_id', as: 'pkg' } },
        { $unwind: '$pkg' },
        { $group: { _id: null, sum: { $sum: '$pkg.price' } } },
    ]);

    const num = (rows, key = 'sum') => (rows[0]?.[key] || 0);

    return {
        subscriptions: {
            total,
            active: activeLive,
            trial: trialLive,
            paid: paidLive,
            admin_grant: grantLive,
            expired,
            cancelled,
            awaiting_sweep: awaitingSweep,
            auto_renew: autoRenew,
        },
        expiring: { in_7_days: expiring7, in_30_days: expiring30 },
        vendors: {
            total: totalVendors,
            subscribed: totalVendors - notSubscribed,
            not_subscribed: notSubscribed,
        },
        money: {
            collected_all_time: num(collectedAll),
            collected_this_month: num(collectedMonth),
            payments_paid: num(collectedAll, 'n'),
            pending_amount: num(pending),
            pending_count: num(pending, 'n'),
            active_contract_value: num(bookValue),
        },
        activity: { started_this_month: startedThisMonth },
        per_package: perPackage,
        generated_at: now,
    };
};

/**
 * The admin's subscriptions list. `segment` is a statistics card's own query (see
 * subscriptionSegmentFilter), so the list holds what the card counts.
 */
const getAllSubscriptionsAdmin = async ({ segment, ...params } = {}) => {
    const match = segment ? subscriptionSegmentFilter(segment) : null;
    if (segment && !match) throw new Error(`Unknown segment: ${segment}`);
    // What is running out reads soonest first.
    const sort = ['expiring_7', 'expiring_30', 'awaiting_sweep'].includes(segment) ? { expires_at: 1 } : undefined;
    return await getAllSubscriptions({ ...params, match, sort });
};

/**
 * Admin grants a free subscription to a vendor for N months.
 * - If vendor has no active subscription: creates a new one.
 * - If vendor already has an active subscription: extends its expiry by N months.
 * Products are republished in both cases.
 */
const grantAdminSubscription = async (vendorId, packageId, months) => {
    months = Number(months);
    if (!Number.isInteger(months) || months < 1 || months > 24) {
        throw new Error('Months must be a whole number between 1 and 24');
    }

    const pkg = await SubscriptionPackage.findById(packageId).lean();
    if (!pkg) throw new Error('Package not found');
    if (pkg.status !== 'active') throw new Error('Package is inactive');

    const existing = await getActiveSubscriptionForVendor(vendorId);

    // Calculate new expiry: extend from existing expiry (if in the future) or from now
    const base = existing && new Date(existing.expires_at) > new Date()
        ? new Date(existing.expires_at)
        : new Date();
    const expiresAt = new Date(base);
    expiresAt.setMonth(expiresAt.getMonth() + months);

    let subscription;
    if (existing) {
        subscription = await VendorSubscription.findByIdAndUpdate(
            existing._id,
            { expires_at: expiresAt, status: 'active', is_admin_grant: true },
            { new: true }
        );
    } else {
        subscription = await VendorSubscription.create({
            vendor_id: vendorId,
            package_id: packageId,
            started_at: new Date(),
            expires_at: expiresAt,
            status: 'active',
            is_free_trial: false,
            is_admin_grant: true,
        });
    }

    await Seller.findByIdAndUpdate(vendorId, {
        subscription_id: subscription._id,
        subscription_status: 'active',
        status: 'active',
        subscription_reason: null,
        subscription_date: null,
    });

    // Apply the granted package's vendor-visibility perks.
    await applyPackagePerks(vendorId, pkg);

    await republishVendorProducts(vendorId);

    await sendSubscriptionNotification(vendorId, 'subscription_activated', {
        packageName: pkg.name,
        packageNameAr: pkg.name_ar,
        price: 0,
        billingPeriod: `${months} month${months > 1 ? 's' : ''} (admin grant)`,
        expiresAt,
        isTrial: false,
    });

    return { subscription, expires_at: expiresAt, extended: !!existing };
};

module.exports = {
    getVendorPublishedProductCount,
    getVendorSubscriptionStatus,
    requireActiveSubscription,
    requireProductLimit,
    purchaseSubscription,
    renewSubscription,
    resubscribeAfterEnd,
    changeSubscriptionPlan,
    expireOldSubscriptions,
    cancelVendorSubscription,
    getAllSubscriptionsAdmin,
    getSubscriptionStatsAdmin,
    paymentSegmentFilter,
    vendorIdsWithLiveSubscription,
    hasUsedFreeTrial,
    assignFreeTrialAfterSignup,
    grantAdminSubscription,
    applyPackagePerks,
    resetPackagePerks,
    // Re-exported for app.js cron. Silent while FREE_RENEWAL is on: "your subscription ends
    // in 3 days" is not true of a subscription that renews itself.
    sendExpiryReminders: (days) => (FREE_RENEWAL.enabled ? Promise.resolve([]) : sendExpiryReminders(days)),
    FREE_RENEWAL,
};
