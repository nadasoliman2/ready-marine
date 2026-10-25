const { Product } = require('../models/products');
const { Seller } = require('../models/sellers');
const { SubscriptionPackage } = require('../models/subscriptionPackages');
const { SubscriptionPayment } = require('../models/subscriptionPayments');
const { getActiveSubscriptionForVendor } = require('../models/vendorSubscriptions');
const {
    purchaseSubscription,
    renewSubscription,
    resubscribeAfterEnd,
    changeSubscriptionPlan,
    hasUsedFreeTrial,
} = require('./vendorSubscriptionService');
const gateway = require('./paymentGateway');

const getFrontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
const getBackendUrl = () => (
    process.env.BACKEND_PUBLIC_URL ||
    process.env.BACKEND_URL ||
    process.env.API_PUBLIC_URL ||
    `http://localhost:${process.env.PORT || 4000}`
).replace(/\/api\/?$/, '').replace(/\/$/, '');

const splitName = (name = '') => {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return {
        first_name: parts[0] || 'Vendor',
        last_name: parts.slice(1).join(' ') || 'Account',
    };
};

const normalizeBillingPeriod = (billingPeriod) => billingPeriod === 'yearly' ? 'yearly' : 'monthly';

const calculateAmount = (pkg) => Number(pkg.price || 0);

const validatePurchase = async (vendorId, packageId) => {
    const existing = await getActiveSubscriptionForVendor(vendorId);
    if (existing) {
        const err = new Error('You already have an active subscription. Please renew or cancel it first.');
        err.code = 'ALREADY_SUBSCRIBED';
        throw err;
    }

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

    if (pkg.is_free_trial && await hasUsedFreeTrial(vendorId)) {
        const err = new Error('You have already used your free trial. Please select a paid plan.');
        err.code = 'FREE_TRIAL_ALREADY_USED';
        throw err;
    }

    return pkg;
};

const validateRenew = async (vendorId) => {
    const existing = await getActiveSubscriptionForVendor(vendorId);
    if (!existing) {
        const err = new Error('No active subscription to renew');
        err.code = 'NO_SUBSCRIPTION';
        throw err;
    }

    const pkg = typeof existing.package_id === 'object'
        ? existing.package_id
        : await SubscriptionPackage.findById(existing.package_id).lean();
    if (!pkg) throw new Error('Package not found');

    return pkg;
};

const validateResubscribe = async (vendorId, packageId, selectedProductIds = null) => {
    const pkg = await SubscriptionPackage.findById(packageId).lean();
    if (!pkg || pkg.status !== 'active') {
        const err = new Error('Package not found or inactive');
        err.code = 'PACKAGE_NOT_FOUND';
        throw err;
    }

    if (pkg.is_free_trial && await hasUsedFreeTrial(vendorId)) {
        const err = new Error('You have already used your free trial. Please select a paid plan.');
        err.code = 'FREE_TRIAL_ALREADY_USED';
        throw err;
    }

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
    }

    return pkg;
};

const validateChangePlan = async (vendorId, packageId, selectedProductIds = null) => {
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
    }

    return pkg;
};

/**
 * Where the vendor lands after paying.
 *
 * Exported because the shared Paymob return route has to rebuild it: Paymob
 * redirects every payment to one endpoint, and that endpoint is what sends the
 * vendor back to their subscription page.
 */
const buildReturnUrl = (payment, status) =>
    `${getFrontendUrl()}/dashboard/subscription?payment=${status}&paymentId=${payment._id.toString()}`;

const buildPaymentRequest = ({ payment, vendor, pkg }) => {
    const { first_name, last_name } = splitName(vendor.name || vendor.store_name);

    return {
        flow: 'sub',
        recordId: payment._id,
        amount: Number(payment.amount),
        currency: payment.currency,
        customer: {
            first_name,
            last_name,
            email: vendor.email,
            phone: vendor.phone,
            address: vendor.locations?.[0]?.address || '',
            city: vendor.locations?.[0]?.shipping_city || '',
            unique_id: vendor._id.toString(),
        },
        items: [{
            name: `ReadyCar subscription - ${pkg.name}`,
            price: Number(payment.amount),
            quantity: 1,
        }],
        returnUrls: {
            success: buildReturnUrl(payment, 'success'),
            fail: buildReturnUrl(payment, 'failed'),
            pending: buildReturnUrl(payment, 'pending'),
        },
        webhookUrl: `${getBackendUrl()}/api/vendors/subscription/fawaterak/webhook_json`,
        extras: {
            subscriptionPaymentId: payment._id.toString(),
            vendorId: vendor._id.toString(),
            action: payment.action,
        },
    };
};

const createSubscriptionPayment = async ({ vendorId, packageId, action, billingPeriod = 'monthly', selectedProductIds = [] }) => {
    const vendor = await Seller.findById(vendorId).lean();
    if (!vendor) throw new Error('Vendor not found');

    let pkg;
    if (action === 'purchase') pkg = await validatePurchase(vendorId, packageId);
    else if (action === 'renew') pkg = await validateRenew(vendorId);
    else if (action === 'resubscribe') pkg = await validateResubscribe(vendorId, packageId, selectedProductIds);
    else if (action === 'change_plan') pkg = await validateChangePlan(vendorId, packageId, selectedProductIds);
    else throw new Error('Invalid payment action');

    const amount = calculateAmount(pkg);
    const normalizedBillingPeriod = normalizeBillingPeriod(billingPeriod);

    if (pkg.is_free_trial) {
        if (action === 'purchase') return { activated: true, subscription: await purchaseSubscription(vendorId, pkg._id, normalizedBillingPeriod) };
        if (action === 'resubscribe') return { activated: true, subscription: await resubscribeAfterEnd(vendorId, pkg._id, normalizedBillingPeriod, selectedProductIds) };
        if (action === 'change_plan') return { activated: true, subscription: await changeSubscriptionPlan(vendorId, pkg._id, normalizedBillingPeriod, selectedProductIds) };
        const err = new Error('Renewal package amount must be greater than zero');
        err.code = 'INVALID_AMOUNT';
        throw err;
    }

    if (amount <= 0) {
        const err = new Error('Paid subscription package price must be greater than zero.');
        err.code = 'INVALID_AMOUNT';
        throw err;
    }

    // Frozen onto the record before the provider is called, so every later step
    // reads the gateway that actually holds this money rather than the switch.
    const provider = await gateway.resolveProvider();

    const payment = await SubscriptionPayment.create({
        vendor_id: vendorId,
        package_id: pkg._id,
        action,
        billing_period: normalizedBillingPeriod,
        selected_product_ids: selectedProductIds || [],
        amount,
        currency: gateway.getCurrencyFor(provider),
        provider,
        provider_mode: gateway.getModeFor(provider),
    });

    let hosted;
    try {
        hosted = await gateway.createHostedPayment({
            ...buildPaymentRequest({ payment, vendor, pkg }),
            provider,
        });
    } catch (err) {
        payment.status = 'failed';
        payment.activation_error = err.message;
        await payment.save();
        throw err;
    }

    payment.invoice_id = hosted.invoice_id;
    payment.invoice_key = hosted.invoice_key;
    payment.payment_url = hosted.payment_url;
    payment.provider_reference = hosted.provider_reference;
    payment.raw_response = hosted.raw_response;
    await payment.save();

    if (!payment.payment_url) {
        const err = new Error(`${provider} did not return a payment URL`);
        err.code = 'PAYMENT_URL_MISSING';
        throw err;
    }

    return { payment };
};

const findPaymentFromWebhook = async (payload = {}) => {
    if (payload.pay_load?.subscriptionPaymentId) {
        const byPayload = await SubscriptionPayment.findById(payload.pay_load.subscriptionPaymentId);
        if (byPayload) return byPayload;
    }

    if (typeof payload.pay_load === 'string') {
        try {
            const parsed = JSON.parse(payload.pay_load);
            if (parsed?.subscriptionPaymentId) {
                const byParsedPayload = await SubscriptionPayment.findById(parsed.subscriptionPaymentId);
                if (byParsedPayload) return byParsedPayload;
            }
        } catch (error) {}
    }

    const or = [];
    if (payload.invoice_id) or.push({ invoice_id: String(payload.invoice_id) });
    if (payload.invoice_key) or.push({ invoice_key: payload.invoice_key });
    if (!or.length) return null;

    return await SubscriptionPayment.findOne({ $or: or });
};

const activatePaidPayment = async (payment, webhookPayload = null) => {
    if (!payment) throw new Error('Payment not found');
    if (payment.status === 'paid') return payment;

    try {
        let subscription;
        if (payment.action === 'purchase') {
            subscription = await purchaseSubscription(payment.vendor_id, payment.package_id, payment.billing_period);
        } else if (payment.action === 'renew') {
            subscription = await renewSubscription(payment.vendor_id, payment.billing_period);
        } else if (payment.action === 'resubscribe') {
            subscription = await resubscribeAfterEnd(
                payment.vendor_id,
                payment.package_id,
                payment.billing_period,
                payment.selected_product_ids?.map(id => id.toString()) || []
            );
        } else if (payment.action === 'change_plan') {
            subscription = await changeSubscriptionPlan(
                payment.vendor_id,
                payment.package_id,
                payment.billing_period,
                payment.selected_product_ids?.map(id => id.toString()) || []
            );
        }

        payment.status = 'paid';
        payment.paid_at = new Date();
        if (webhookPayload?.payment_method) payment.payment_method = webhookPayload.payment_method;
        if (webhookPayload?.invoice_id) payment.invoice_id = String(webhookPayload.invoice_id);
        if (webhookPayload?.invoice_key) payment.invoice_key = webhookPayload.invoice_key;
        payment.provider_reference = payment.invoice_id || payment.invoice_key || payment.provider_reference || null;
        payment.activation_error = null;
        if (webhookPayload) payment.webhook_payloads.push(webhookPayload);
        await payment.save();

        return { payment, subscription };
    } catch (err) {
        payment.activation_error = err.message;
        if (webhookPayload) payment.webhook_payloads.push(webhookPayload);
        await payment.save();
        throw err;
    }
};

const confirmSubscriptionPayment = async ({ vendorId, paymentId, invoiceId }) => {
    if (!paymentId && !invoiceId) {
        const err = new Error('paymentId or invoice_id is required');
        err.code = 'PAYMENT_REFERENCE_REQUIRED';
        throw err;
    }

    const filter = { vendor_id: vendorId };
    const or = [];
    if (paymentId) or.push({ _id: paymentId });
    if (invoiceId) or.push({ invoice_id: String(invoiceId) });
    if (!or.length) return null;
    filter.$or = or;

    const payment = await SubscriptionPayment.findOne(filter);
    if (!payment) {
        const err = new Error('Payment not found');
        err.code = 'PAYMENT_NOT_FOUND';
        throw err;
    }

    if (invoiceId && payment.invoice_id && String(payment.invoice_id) !== String(invoiceId)) {
        const err = new Error('Invoice does not match this payment');
        err.code = 'INVOICE_MISMATCH';
        throw err;
    }

    if (payment.status === 'paid') {
        return { status: 'paid', alreadyPaid: true, payment };
    }

    const confirmation = await gateway.readPayment({
        provider: payment.provider,
        invoice_id: payment.invoice_id || invoiceId,
        invoice_key: payment.invoice_key,
        provider_reference: payment.provider_reference,
    });

    payment.raw_response = {
        ...(payment.raw_response || {}),
        confirmation: confirmation.envelope,
    };

    if (!confirmation.paid) {
        await payment.save();
        return { status: 'pending', payment, invoice: confirmation.raw };
    }

    const result = await activatePaidPayment(payment, gateway.buildConfirmationPayload(confirmation, {
        source: 'redirect_confirmation',
    }));

    return { status: 'paid', ...result, invoice: confirmation.raw };
};

const getSubscriptionPaymentsAdmin = async ({
    status,
    action,
    vendorId,
    packageId,
    q = '',
    from,
    to,
    match = null,
    page = 1,
    limit = 20,
} = {}) => {
    const filter = {};
    if (status) filter.status = status;
    if (action) filter.action = action;
    if (vendorId) filter.vendor_id = vendorId;
    if (packageId) filter.package_id = packageId;
    if (from || to) {
        filter.createdAt = {};
        if (from) filter.createdAt.$gte = new Date(from);
        if (to) {
            const end = new Date(to);
            end.setHours(23, 59, 59, 999);
            filter.createdAt.$lte = end;
        }
    }

    const search = String(q || '').trim();
    if (search) {
        const [vendors, packages] = await Promise.all([
            Seller.find({
                $or: [
                    { store_name: { $regex: search, $options: 'i' } },
                    { store_username: { $regex: search, $options: 'i' } },
                    { email: { $regex: search, $options: 'i' } },
                ],
            }).select('_id').lean(),
            SubscriptionPackage.find({
                name: { $regex: search, $options: 'i' },
            }).select('_id').lean(),
        ]);
        filter.$or = [
            { invoice_id: { $regex: search, $options: 'i' } },
            { invoice_key: { $regex: search, $options: 'i' } },
            { provider_reference: { $regex: search, $options: 'i' } },
            ...(vendors.length ? [{ vendor_id: { $in: vendors.map(v => v._id) } }] : []),
            ...(packages.length ? [{ package_id: { $in: packages.map(pkg => pkg._id) } }] : []),
        ];
    }

    // A statistics card's own query (`match`), kept apart so the filters above narrow it.
    const query = match ? { $and: [filter, match] } : filter;

    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    const safePage = Math.max(1, Number(page) || 1);
    const [payments, total] = await Promise.all([
        SubscriptionPayment.find(query)
            .populate('vendor_id', 'store_name store_username email phone')
            .populate('package_id', 'name price max_products is_free_trial')
            .sort({ createdAt: -1 })
            .skip((safePage - 1) * safeLimit)
            .limit(safeLimit)
            .lean(),
        SubscriptionPayment.countDocuments(query),
    ]);

    return {
        payments,
        pagination: {
            total,
            page: safePage,
            pages: Math.ceil(total / safeLimit),
            limit: safeLimit,
        },
    };
};

module.exports = {
    createSubscriptionPayment,
    findPaymentFromWebhook,
    activatePaidPayment,
    confirmSubscriptionPayment,
    buildReturnUrl,
    getSubscriptionPaymentsAdmin,
};
