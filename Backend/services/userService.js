const { User } = require('../models/users');
const { Order } = require('../models/orders');
const { hashPassword, comparePassword } = require('./authService');

/**
 * Get user profile and addresses
 */
const getUserProfile = async (userId) => {
    return await User.findById(userId).select('-password');
};

/**
 * Update user basic info
 */
const updateProfile = async (userId, data) => {
    const { name, email, phone, preferred_language } = data;
    const { canonicalEmail } = require('./shared/emailIdentity');
    const cleanEmail = email ? canonicalEmail(email) : email;
    // Another spelling of an address someone else already uses (dots or a +alias on
    // Gmail) is the SAME inbox — refused in words rather than by a raw index error.
    if (cleanEmail && await User.exists({ email: cleanEmail, _id: { $ne: userId } })) {
        const err = new Error('This email is already used by another account');
        err.status = 409;
        throw err;
    }
    const update = { name, email: cleanEmail, phone };
    // Drives the language of this account's emails and in-app notifications.
    if (preferred_language === 'en' || preferred_language === 'ar') {
        update.preferred_language = preferred_language;
    }
    return await User.findByIdAndUpdate(
        userId,
        update,
        { returnDocument: "after", runValidators: true }
    ).select('-password');
};

/**
 * Change user password
 */
const changePassword = async (userId, oldPassword, newPassword) => {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    const isMatch = await comparePassword(oldPassword, user.password);
    if (!isMatch) throw new Error('Incorrect old password');

    const hashedPassword = await hashPassword(newPassword);
    user.password = hashedPassword;
    user.password_changed_at = new Date();
    await user.save();
    return true;
};

/**
 * Add a new address
 */
const addAddress = async (userId, addressData) => {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    // If this is the first address or marked as default, unset other defaults
    if (addressData.is_default || user.addresses.length === 0) {
        if (user.addresses.length === 0) addressData.is_default = true;
        user.addresses.forEach(addr => addr.is_default = false);
    }

    user.addresses.push(addressData);
    await user.save();
    return user.addresses;
};

/**
 * Update an existing address
 */
const updateAddress = async (userId, addressId, addressData) => {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    const address = user.addresses.id(addressId);
    if (!address) throw new Error('Address not found');

    if (addressData.is_default) {
        user.addresses.forEach(addr => addr.is_default = false);
    }

    Object.assign(address, addressData);
    await user.save();
    return user.addresses;
};

/**
 * Delete an address
 */
const deleteAddress = async (userId, addressId) => {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    user.addresses.pull(addressId);
    
    // Ensure at least one default if addresses remain
    if (user.addresses.length > 0 && !user.addresses.some(a => a.is_default)) {
        user.addresses[0].is_default = true;
    }

    await user.save();
    return user.addresses;
};

/**
 * Get user cart with populated product data
 */
const getCart = async (userId) => {
    const { getPublicBundleById } = require('./bundleService');
    const user = await User.findById(userId).populate({
        path: 'cart.items.product_id',
        select: 'title_en title_ar price discount_price images slug_en slug_ar variants status vendor_id',
        populate: { path: 'vendor_id', select: 'status' }
    });

    if (!user || !user.cart) return [];

    const results = [];
    for (const item of user.cart.items) {
        // ---- Bundle line ----
        if (item.bundle_id) {
            const bundle = await getPublicBundleById(item.bundle_id);
            // Drop if no longer published / purchasable.
            if (!bundle || !bundle.is_purchasable) continue;
            const primary = (bundle.images || []).find(i => i.is_primary);
            results.push({
                is_bundle: true,
                bundle_id: String(bundle._id),
                bundle: {
                    _id: bundle._id,
                    title_en: bundle.title_en,
                    title_ar: bundle.title_ar,
                    slug_en: bundle.slug_en,
                    slug_ar: bundle.slug_ar,
                    image: primary?.url || bundle.images?.[0]?.url || '',
                    price: bundle.pricing?.effective ?? 0,
                    member_count: bundle.member_count,
                },
                quantity: item.quantity,
            });
            continue;
        }

        // ---- Product line ----
        const product = item.product_id;
        if (!product) continue;
        if (product.status === 'draft' || product.vendor_id?.status === 'suspended') continue;

        // Robust image extraction
        let imageUrl = '';
        if (product.images && product.images.length > 0) {
            const primary = product.images.find(img => img.is_primary);
            imageUrl = primary ? primary.url : product.images[0].url;
        }

        // Resolve variant info (used for label display)
        let variantInfo = null;
        if (item.variant_id) {
            const fullProduct = item.product_id; // already populated
            const matchedVariant = (fullProduct.variants || []).find(
                v => String(v._id) === String(item.variant_id)
            );
            if (matchedVariant) {
                const label = (matchedVariant.selected_options || []).map(o => o.option_value).join(' / ');
                const resolvedPrice = (matchedVariant.discount_price ?? matchedVariant.price) ?? (product.discount_price ?? product.price);
                variantInfo = { _id: matchedVariant._id, label, price: resolvedPrice };
            }
        }

        const resolvedPrice = variantInfo?.price ?? (product.discount_price ?? product.price);

        results.push({
            product: {
                _id: product._id,
                title_en: product.title_en,
                title_ar: product.title_ar,
                price: resolvedPrice,
                image: imageUrl,
                slug_en: product.slug_en,
                slug_ar: product.slug_ar
            },
            variant: variantInfo,
            quantity: item.quantity
        });
    }
    return results;
};

/**
 * Sync (replace) entire user cart
 */
const syncCart = async (userId, items) => {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    const { Product } = require('../models/products');
    const formattedItems = [];

    const { getPublicBundleById } = require('./bundleService');

    for (const item of Array.isArray(items) ? items : []) {
        // ---- Bundle line ----
        const bundleId = item.bundle?._id || item.bundle?.id || item.bundle_id;
        if (bundleId && !(item.product?._id || item.product?.id || item.product_id)) {
            const bundle = await getPublicBundleById(bundleId);
            if (!bundle || !bundle.is_purchasable) continue; // drop unavailable bundles
            formattedItems.push({
                bundle_id: bundle._id,
                quantity: Math.max(1, Number(item.quantity) || 1),
            });
            continue;
        }

        // ---- Product line ----
        const productId = item.product?._id || item.product?.id || item.product_id;
        if (!productId) continue;

        const product = await Product.findById(productId)
            .select('status vendor_id')
            .populate('vendor_id', 'status');

        if (!product || product.status === 'draft' || product.vendor_id?.status === 'suspended') {
            continue;
        }

        formattedItems.push({
            product_id: product._id,
            // Support both old (variant_id) and new (variant._id) structures
            variant_id: item.variant?._id || item.variant_id || null,
            quantity: item.quantity
        });
    }

    user.cart = {
        updated_at: new Date(),
        items: formattedItems
    };

    await user.save();
    return await getCart(userId);
};

/**
 * Get user order history
 */
/**
 * The customer's orders, each with a card per PARCEL.
 *
 * The vendor's name is attached to every parcel deliberately: the customer must be able to
 * see that these are different merchants delivering on different days, otherwise one order
 * arriving in three pieces just reads as the site behaving strangely. The amount each
 * courier will collect rides along for the same reason — so nothing about the split is
 * first discovered at the door.
 */
const getUserOrders = async (userId) => {
    const subOrderService = require('./subOrderService');
    const { Seller } = require('../models/sellers');

    const orders = await Order.find({ user_id: userId }).sort({ created_at: -1 }).lean();
    await require('./orderItemLinks').attachProductLinks(orders);

    const vendorIds = new Set();
    for (const o of orders) for (const s of o.sub_orders || []) vendorIds.add(String(s.vendor_id));
    const vendors = await Seller.find({ _id: { $in: [...vendorIds] } })
        .select('store_name store_username')
        .lean();
    const vendorMap = new Map(vendors.map((v) => [v._id.toString(), v]));
    const reviewState = await require('./reviewService').reviewStateForOrders(orders);
    // Company orders waiting to be consolidated (feature 14): how full each batch is.
    const waitingBySub = await require('./companyBatchService')
        .waitingInfoForSubs(orders.flatMap((o) => o.sub_orders || []))
        .catch(() => new Map());

    return orders.map((order) => {
        const isCOD = order.transaction?.payment_method === 'cash';
        const parcels = (order.sub_orders || []).map((sub) => {
            const view = subOrderService.toPublicSubOrder(order, sub, {
                audience: 'customer',
                vendor: vendorMap.get(String(sub.vendor_id)),
            });
            if (view.company_batch && waitingBySub.has(String(sub._id))) {
                view.company_batch.batch = waitingBySub.get(String(sub._id));
            }
            // A delivered parcel can be rated from the order page; once rated, the button
            // says so instead. An order rated as a whole before parcels were separate counts.
            const reviewed = reviewState.has(`${order._id}:${sub._id}`) || reviewState.has(`${order._id}:*`);
            return {
                ...view,
                amount_due_on_delivery: isCOD ? view.cod_amount : 0,
                review: sub.status === 'delivered' ? { can_review: !reviewed, submitted: reviewed } : null,
            };
        });
        const live = (order.sub_orders || []).filter(subOrderService.isLive);

        return {
            ...order,
            parcels,
            parcel_summary: {
                total: live.length,
                delivered: live.filter((s) => s.status === 'delivered').length,
                cancelled: (order.sub_orders || []).length - live.length,
            },
            // The order's own journey in the customer's seven words, sitting at whichever
            // parcel is furthest behind. Null on legacy orders that have no parcels.
            journey: subOrderService.buildOrderJourney(order),
        };
    });
};

/**
 * Add a car to user's garage
 */
const addCar = async (userId, carData) => {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    const { car_brand_id, car_brand_name, car_model_id, car_model_name, year } = carData;
    
    // Check if limit reached (optional, say 5 cars max)
    if (user.cars.length >= 5) {
        throw new Error('Maximum of 5 cars allowed');
    }

    // Check for duplicates
    const isDuplicate = user.cars.some(c => 
        String(c.car_model_id) === String(car_model_id) && c.year === Number(year)
    );
    if (isDuplicate) throw new Error('This car is already in your garage');

    user.cars.push({
        car_brand_id,
        car_brand_name,
        car_model_id,
        car_model_name,
        year: Number(year)
    });

    await user.save();
    return user.cars;
};

/**
 * Remove a car from user's garage
 */
const deleteCar = async (userId, carId) => {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    user.cars.pull(carId);
    await user.save();
    
    return user.cars;
};

module.exports = {
    getUserProfile,
    updateProfile,
    changePassword,
    addAddress,
    updateAddress,
    deleteAddress,
    getUserOrders,
    getCart,
    syncCart,
    addCar,
    deleteCar
};
