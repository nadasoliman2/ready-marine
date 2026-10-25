const { Order } = require('../models/orders');
const { Seller } = require('../models/sellers');
const { User } = require('../models/users');
const { Product } = require('../models/products');
const { SiteSettings } = require('../models/site_settings');
const { Category } = require('../models/categories');
const { createNotification } = require('../models/notifications');
const {
    applyCouponToPricedItems,
    consumeCouponUsage,
    normalizeCode,
} = require('./couponService');
const shippingEngine = require('./shippingEngine');
const loyaltyService = require('./loyaltyService');
const walletService = require('./walletService');
const subOrderService = require('./subOrderService');
const { isBostaDrivenStatus } = require('./bostaStatusMap');
const { Bundle } = require('../models/bundles');
const { computeBundlePricing, validateMemberInvariant } = require('./bundleService');
const mongoose = require('mongoose');

/**
 * Distribute an integer amount (cents) across members proportionally to their
 * weights using the largest-remainder method, so the parts sum to `totalCents`
 * EXACTLY (no penny drift between the bundle price and the order total).
 */
const allocateProportional = (totalCents, weights) => {
    const n = weights.length;
    if (n === 0) return [];
    const sum = weights.reduce((a, b) => a + b, 0);
    if (sum <= 0) {
        const base = Math.floor(totalCents / n);
        const out = weights.map(() => base);
        for (let i = 0; i < totalCents - base * n; i++) out[i]++;
        return out;
    }
    const raw = weights.map(w => (totalCents * w) / sum);
    const floor = raw.map(x => Math.floor(x));
    const remainder = totalCents - floor.reduce((a, b) => a + b, 0);
    const order = raw.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac);
    for (let k = 0; k < remainder; k++) floor[order[k % n].i]++;
    return floor;
};

const normalizeActor = (actor = {}) => ({
    role: actor.role || 'system',
    label: actor.label || actor.username || 'System',
});

const appendHistory = (order, action, title, details = '', metadata = {}, actor = {}) => {
    const normalizedActor = normalizeActor(actor);
    order.history = order.history || [];
    order.history.push({
        action,
        title,
        details,
        actor_role: normalizedActor.role,
        actor_label: normalizedActor.label,
        metadata,
        created_at: new Date(),
    });
};

const notifyVendorsAboutNewOrder = async (order) => {
    const reference = order.transaction?.reference || order._id;
    // A vendor whose parcels are all waiting in a company batch hears about them when the
    // batch closes, not now (feature 14).
    const heldOnly = (vendorId) => {
        const theirs = (order.sub_orders || []).filter((s) => String(s.vendor_id) === String(vendorId));
        return theirs.length > 0 && theirs.every((s) => s.status === 'held_in_batch');
    };
    const supervisions = (order.vendor_supervisions || []).filter((sv) => !heldOnly(sv.vendor_id));

    await Promise.allSettled(supervisions.map((supervision) => {
        const amount = Number(supervision.total_amount || 0);
        const itemCount = (order.items || []).filter(
            item => item.vendor_id && item.vendor_id.toString() === supervision.vendor_id.toString()
        ).length;

        // Not awaited: it never rejects, and checkout must not wait on the provider.
        require('./notificationService').sendNewOrderWhatsapp({
            vendorId: supervision.vendor_id,
            order,
            subOrders: (order.sub_orders || []).filter(
                (s) => String(s.vendor_id) === String(supervision.vendor_id) && s.status !== 'held_in_batch'
            ),
        });

        return createNotification(
            supervision.vendor_id,
            'new_order_received',
            'New Order Received',
            `Order #${reference} is waiting for your review. ${itemCount} item${itemCount === 1 ? '' : 's'} assigned to your store.`,
            {
                order_id: order._id,
                reference,
                vendor_total: amount,
                item_count: itemCount,
            }
        );
    }));
};

const getItemTitle = (item) => item.product_title || item.product_id?.title_en || item.product_id?.title_ar || 'Unknown item';

const snapshotItem = (item) => ({
    item_id: item._id?.toString(),
    product_id: item.product_id?._id?.toString?.() || item.product_id?.toString?.(),
    product_title: item.product_title,
    product_slug_en: item.product_slug_en,
    product_slug_ar: item.product_slug_ar,
    variant_id: item.variant_id?.toString?.(),
    variant_label: item.variant_label,
    quantity: item.quantity,
    unit_price: item.unit_price,
    vendor_id: item.vendor_id?._id?.toString?.() || item.vendor_id?.toString?.(),
    vendor_name: item.vendor_name,
    vendor_username: item.vendor_username,
    vendor_status: item.vendor_status,
    vendor_note: item.vendor_note,
});

const getItemHistorySnapshot = async (item, productDoc = null, vendorDoc = null) => {
    const plainItem = item.toObject?.() || item;
    const productId = item.product_id?._id || item.product_id;
    const vendorId = item.vendor_id?._id || item.vendor_id;
    const [product, vendor] = await Promise.all([
        productDoc || (productId ? Product.findById(productId).select('title_en title_ar slug_en slug_ar').lean() : null),
        vendorDoc || (vendorId ? Seller.findById(vendorId).select('store_name store_username').lean() : null),
    ]);

    return {
        ...snapshotItem({
            ...plainItem,
            product_slug_en: product?.slug_en,
            product_slug_ar: product?.slug_ar,
            vendor_name: vendor?.store_name,
            vendor_username: vendor?.store_username,
        }),
        product_title: item.product_title || product?.title_en || product?.title_ar || 'Unknown',
        product_slug_en: product?.slug_en,
        product_slug_ar: product?.slug_ar,
        vendor_name: vendor?.store_name,
        vendor_username: vendor?.store_username,
    };
};

const getPrimaryImageUrl = (product) => {
    const primary = product.images?.find(img => img.is_primary);
    return primary?.url || product.images?.[0]?.url || '';
};

const buildVariantSnapshot = (product, variantId) => {
    const variants = product.variants || [];
    let variant = null;

    if (variantId) {
        variant = variants.find(v => v._id.toString() === variantId.toString());
    }

    if (!variant && variants.length > 0) {
        variant = variants[0];
    }

    if (!variant) {
        return {
            variant_id: new mongoose.Types.ObjectId(),
            variant_label: 'Default',
            price: product.discount_price ?? product.price,
        };
    }

    const label = (variant.selected_options || [])
        .map(option => option.option_value)
        .filter(Boolean)
        .join(' / ') || 'Default';

    return {
        variant_id: variant._id,
        variant_label: label,
        price: (variant.discount_price ?? variant.price) ?? (product.discount_price ?? product.price),
    };
};

const recalculateOrderTotals = async (order) => {
    const previousSupervisions = new Map(
        (order.vendor_supervisions || []).map(s => [s.vendor_id.toString(), s.status])
    );
    const vendorTotals = {};
    const vendorPendingState = {};
    let total = 0;

    for (const item of order.items || []) {
        const vendorId = item.vendor_id?.toString();
        if (!vendorId) continue;

        const itemTotal = Number(item.unit_price || 0) * Number(item.quantity || 0);
        total += itemTotal;
        vendorTotals[vendorId] = (vendorTotals[vendorId] || 0) + itemTotal;
        if (item.vendor_status === 'pending') vendorPendingState[vendorId] = true;
    }

    order.vendor_supervisions = Object.entries(vendorTotals).map(([vendorId, amount]) => ({
        vendor_id: vendorId,
        total_amount: amount,
        status: vendorPendingState[vendorId] ? 'pending' : (previousSupervisions.get(vendorId) || 'pending'),
    }));

    const discountAmount = Number(order.coupon_discount_amount || 0);

    // Re-quote shipping off the frozen snapshot against the (possibly modified) items.
    if (order.shipping?.config_snapshot) {
        try {
            await shippingEngine.recomputeFromSnapshot(order);
        } catch (e) {
            // Keep the existing shipping cost if re-quoting fails for any reason.
        }
    } else {
        shippingEngine.assignVendorShippingCosts(order);
    }
    const shippingTotal = order.shipping?.enabled === false ? 0 : Number(order.shipping?.total_cost || 0);

    // The loyalty discount was funded by points that are already spent. Admin
    // edits re-price the merchandise, but they must not silently re-charge the
    // customer for the part their points already paid — it stays deducted, and
    // is clamped so shrinking an order can never make the discount exceed it.
    const merchandiseAfterCoupon = Math.max(0, total - discountAmount);
    const loyaltyDiscount = Math.min(
        Number(order.loyalty?.redemption_discount || 0),
        merchandiseAfterCoupon
    );

    order.total_price = Math.max(0, merchandiseAfterCoupon - loyaltyDiscount) + Math.max(0, shippingTotal);
    if (order.transaction) order.transaction.amount = order.total_price;

    // Re-split the new total across the parcels. A no-op once the allocation is frozen —
    // by then a COD is live at Bosta and these figures were shown to the customer, so the
    // guard lives inside `allocate` rather than at each call site.
    subOrderService.allocate(order);
};

const parseIncomingProductId = (item = {}) => {
    return item.product?._id || item.product?.id || item.product_id || null;
};

const parseIncomingBundleId = (item = {}) => {
    return item.bundle?._id || item.bundle?.id || item.bundle_id || null;
};

/**
 * Expand a bundle cart line into real per-member priced order items.
 * Server-authoritative: re-validates availability, recomputes the effective
 * price from members' CURRENT prices, and splits it across members pro-rata so
 * Σ(unit_price * quantity) === round2(effective * bundleQuantity) exactly.
 * All-or-nothing: throws BUNDLE_NOT_AVAILABLE if any member is unavailable.
 */
const expandBundleToPricedItems = async (bundleId, bundleQuantity) => {
    const q = Math.max(1, Number(bundleQuantity) || 1);

    const bundle = await Bundle.findById(bundleId)
        .populate({ path: 'members.product_id', populate: { path: 'vendor_id' } });

    if (!bundle) {
        const e = new Error('Bundle not found'); e.code = 'BUNDLE_NOT_AVAILABLE'; throw e;
    }
    if (bundle.status !== 'published' || bundle.is_active === false) {
        const e = new Error(`Bundle is not available for purchase: ${bundle.title_en || bundle.title_ar || bundle._id}`);
        e.code = 'BUNDLE_NOT_AVAILABLE'; throw e;
    }
    // Vendor suspension guard (all members share one vendor).
    const anyProduct = bundle.members.find(m => m.product_id)?.product_id;
    if (anyProduct?.vendor_id?.status === 'suspended') {
        const e = new Error('Bundle is not available because its vendor is suspended');
        e.code = 'BUNDLE_NOT_AVAILABLE'; throw e;
    }

    // All-or-nothing invariant: every member must still be a published, owned product.
    try {
        await validateMemberInvariant(
            bundle.vendor_id,
            bundle.members.map(m => ({
                product_id: m.product_id?._id || m.product_id,
                variant_id: m.variant_id,
                quantity: m.quantity,
            }))
        );
    } catch (err) {
        err.code = 'BUNDLE_NOT_AVAILABLE';
        throw err;
    }

    const mwp = bundle.members.map(m => ({ member: m, product: m.product_id }));
    const pricing = computeBundlePricing(
        { pricing_mode: bundle.pricing_mode, pricing_value: bundle.pricing_value },
        mwp
    );

    // Allocate the full group price across members at cent-level (exact sum).
    const targetCents = Math.round(pricing.effective * q * 100);
    const weights = pricing.memberBreakdown.map(mb => mb.line_total);
    const allocatedCents = allocateProportional(targetCents, weights);

    const bundleGroup = new mongoose.Types.ObjectId();
    return pricing.memberBreakdown.map((mb, i) => {
        const product = mb.product;
        const memberQty = mb.quantity * q;
        const lineTotal = allocatedCents[i] / 100;
        const unitPrice = memberQty > 0 ? lineTotal / memberQty : 0;
        const snap = buildVariantSnapshot(product, mb.variant_id);
        return {
            product_id: product._id,
            product_title: product.title_en || product.title_ar || 'Unknown',
            product_image: getPrimaryImageUrl(product),
            variant_id: snap.variant_id,
            variant_label: snap.variant_label,
            quantity: memberQty,
            unit_price: unitPrice,
            vendor_id: product.vendor_id?._id || product.vendor_id,
            vendor_status: 'pending',
            line_total: lineTotal,
            category_id: product.category_id,
            bundle_id: bundle._id,
            bundle_group: bundleGroup,
            bundle_title: bundle.title_en || bundle.title_ar || '',
            is_bundle_member: true,
        };
    });
};

const parseIncomingVariantData = (item = {}) => {
    const variantId = item.variant?._id || item.variant_id || null;
    const variantLabel = item.variant?.label || item.variant_label || null;
    return { variantId, variantLabel };
};

const buildPricedOrderItems = async (items = []) => {
    if (!Array.isArray(items) || items.length === 0) {
        throw new Error('Order must contain at least one item');
    }

    const pricedItems = [];

    for (const item of items) {
        // Bundle line → expand into real per-member priced items.
        const bundleId = parseIncomingBundleId(item);
        if (bundleId && !parseIncomingProductId(item)) {
            const expanded = await expandBundleToPricedItems(bundleId, item.quantity);
            pricedItems.push(...expanded);
            continue;
        }

        const productId = parseIncomingProductId(item);
        if (!productId) throw new Error('Order item is missing a product');

        const product = await Product.findById(productId)
            .populate('vendor_id')
            .select('title_en title_ar images discount_price price status vendor_id variants category_id');

        if (!product) throw new Error(`Product not found: ${productId}`);
        if (product.status === 'draft') {
            throw new Error(`Product is not available for purchase: ${product.title_en || product.title_ar || product._id}`);
        }

        const vendorId = product.vendor_id?._id || product.vendor_id;
        if (!vendorId) throw new Error(`Product ${product._id} has no vendor assigned`);
        if (product.vendor_id?.status === 'suspended') {
            throw new Error(`Product is not available because its vendor is suspended: ${product.title_en || product.title_ar || product._id}`);
        }

        const quantity = Number(item.quantity || 1);
        if (!Number.isFinite(quantity) || quantity < 1) {
            throw new Error('Invalid item quantity');
        }

        const { variantId, variantLabel } = parseIncomingVariantData(item);
        const variantSnapshot = buildVariantSnapshot(product, variantId);
        const unitPrice = Number(variantSnapshot.price);

        pricedItems.push({
            product_id: product._id,
            product_title: product.title_en || product.title_ar || 'Unknown',
            product_image: getPrimaryImageUrl(product),
            variant_id: variantSnapshot.variant_id,
            variant_label: variantLabel || variantSnapshot.variant_label,
            quantity,
            unit_price: unitPrice,
            vendor_id: vendorId,
            vendor_status: 'pending',
            line_total: unitPrice * quantity,
            category_id: product.category_id,
        });
    }

    return pricedItems;
};

const calculateCommissions = async (pricedItems, couponResult) => {
    const siteSettings = await SiteSettings.findOne() || {};
    const globalComm = siteSettings.commission_settings || { type: 'fixed', fixed_rate: 0, category_rates: [] };

    const vendorIds = [...new Set(pricedItems.map(i => i.vendor_id))];
    const vendors = await Seller.find({ _id: { $in: vendorIds } }).select('commission_settings').lean();
    const vendorMap = new Map(vendors.map(v => [v._id.toString(), v]));

    const allCategories = await Category.find().select('parent_id').lean();
    const categoryParentMap = new Map(allCategories.map(c => [c._id.toString(), c.parent_id?.toString()]));

    const eligibleSubtotal = Number(couponResult?.pricing?.eligible_subtotal || 0);
    const totalDiscountAmount = Number(couponResult?.pricing?.discount_amount || 0);
    const eligibleItemIds = new Set(couponResult?.eligible_item_ids || []);

    for (const item of pricedItems) {
        let postDiscountLineTotal = Number(item.line_total || 0);
        if (eligibleSubtotal > 0 && totalDiscountAmount > 0 && eligibleItemIds.has(item.product_id.toString())) {
            const itemShareOfDiscount = (postDiscountLineTotal / eligibleSubtotal) * totalDiscountAmount;
            postDiscountLineTotal = Math.max(0, postDiscountLineTotal - itemShareOfDiscount);
        }

        const vendor = vendorMap.get(item.vendor_id.toString());
        const vComm = vendor?.commission_settings;
        const activeComm = (vComm && vComm.is_custom) ? vComm : globalComm;

        let rate = 0;
        if (activeComm.type === 'category' && activeComm.category_rates && activeComm.category_rates.length > 0) {
            let currentCatId = item.category_id?.toString();
            let catRate = null;
            while (currentCatId) {
                catRate = activeComm.category_rates.find(c => c.category_id?.toString() === currentCatId);
                if (catRate) break;
                currentCatId = categoryParentMap.get(currentCatId);
            }
            rate = catRate ? Number(catRate.rate || 0) : Number(activeComm.fixed_rate || 0);
        } else {
            rate = Number(activeComm.fixed_rate || 0);
        }

        item.commission_rate = rate;
        item.commission_amount = Number((postDiscountLineTotal * (rate / 100)).toFixed(2));
    }
};

const buildVendorSupervisionsFromItems = (pricedItems = [], vendorMap = new Map()) => {
    const vendorTotals = {};
    const vendorCommissions = {};
    for (const item of pricedItems) {
        const vendorId = item.vendor_id?.toString();
        if (!vendorId) continue;
        vendorTotals[vendorId] = (vendorTotals[vendorId] || 0) + Number(item.line_total || 0);
        vendorCommissions[vendorId] = (vendorCommissions[vendorId] || 0) + Number(item.commission_amount || 0);
    }

    return Object.entries(vendorTotals).map(([vendorId, amount]) => {
        const vendor = vendorMap.get(vendorId);
        const defaultLocation = vendor?.locations?.find(loc => loc.is_default)?.address || null;
        
        return {
            vendor_id: vendorId,
            status: 'pending',
            total_amount: amount,
            total_commission: Number((vendorCommissions[vendorId] || 0).toFixed(2)),
            fulfillment_location: defaultLocation
        };
    });
};

/**
 * Price a checkout server-side.
 *
 * The order of operations is the confirmed business rule and is not negotiable
 * from the client: coupon first, then loyalty points, and shipping outside
 * both. `redeemPoints` is only ever a REQUEST — `computeRedemption` clamps it
 * by the live balance and the configured cap, and the clamped result is what
 * every downstream amount (total, commissions, provider charge) is built from.
 */
const getPricedOrderPreview = async ({
    userId,
    items,
    couponCode = '',
    shippingDestination = null,
    shippingMethodId = null,
    redeemPoints = 0,
    // Points already HELD for this checkout by an active hosted payment. They
    // have left `available`, so without counting them back the clamp below
    // would silently drop a discount the customer has already been charged for.
    reservedPoints = 0,
}) => {
    const pricedItems = await buildPricedOrderItems(items);
    const subtotal = pricedItems.reduce((sum, item) => sum + Number(item.line_total || 0), 0);

    let couponResult = null;
    if (normalizeCode(couponCode)) {
        couponResult = await applyCouponToPricedItems({
            code: couponCode,
            userId,
            items: pricedItems,
        });
    }

    const discountAmount = Number(couponResult?.pricing?.discount_amount || 0);
    const merchandiseAfterCoupon = Math.max(0, subtotal - discountAmount);

    // --- Loyalty (after coupon, merchandise only) ---
    const loyaltySettings = await loyaltyService.getLoyaltySettings();
    const balances = loyaltySettings.enabled ? await loyaltyService.getBalances(userId) : null;
    const spendableNow = (balances?.available_points || 0) + Math.max(0, Math.floor(Number(reservedPoints) || 0));
    const redemption = loyaltyService.computeRedemption({
        settings: loyaltySettings,
        availablePoints: spendableNow,
        eligibleMerchandise: merchandiseAfterCoupon,
        requestedPoints: redeemPoints,
        hasCoupon: !!couponResult,
    });

    const loyaltyDiscount = Number(redemption.discount || 0);
    const itemsTotal = Math.max(0, merchandiseAfterCoupon - loyaltyDiscount);

    // --- Shipping ---
    let shippingSnapshot = null;
    let shippingTotal = 0;
    if (shippingDestination) {
        const settings = await shippingEngine.getSettings();
        if (settings.enabled) {
            shippingSnapshot = await shippingEngine.computeShippingForOrder({
                items: pricedItems,
                destination: shippingDestination,
                method_id: shippingMethodId,
                mode: settings.multi_vendor_mode,
                // Free-shipping thresholds keep looking at the coupon only:
                // points are a wallet, not a promotion, and letting them push
                // an order under a threshold would let customers buy shipping
                // discounts with points we said cannot pay for shipping.
                couponDiscountTotal: discountAmount,
            });
            shippingTotal = Number(shippingSnapshot?.total_cost || 0);
        }
    }

    const total = itemsTotal + Math.max(0, shippingTotal);

    // Points this order will earn once delivered. Shipping earns nothing, and
    // the loyalty-funded part earns nothing either — otherwise points would
    // slowly regenerate themselves.
    const eligibleEarnAmount = itemsTotal;
    const estimatedEarnPoints = (loyaltySettings.enabled && loyaltySettings.earning_enabled)
        ? loyaltyService.calculateEarnedPoints(eligibleEarnAmount, loyaltySettings)
        : 0;

    // How this basket will physically arrive, and what each courier will collect. Computed
    // here — before payment — because the split is only disruptive when it is a surprise:
    // once the customer has read "3 parcels, these amounts" they have agreed to it, and
    // "why is the courier asking for a different number?" stops being a support call.
    const previewVendorIds = [...new Set(pricedItems.map(i => i.vendor_id?.toString()).filter(Boolean))];
    const previewVendors = await Seller.find({ _id: { $in: previewVendorIds } })
        .select('store_name store_username locations')
        .lean();
    const previewVendorMap = new Map(previewVendors.map(v => [v._id.toString(), v]));
    const parcelBreakdown = subOrderService.previewSubOrders({
        pricedItems,
        vendorMap: previewVendorMap,
        shippingSnapshot,
        couponDiscount: discountAmount,
        couponVendorSharePercent: Number(couponResult?.coupon?.vendor_share_percent || 0),
        loyaltyDiscount,
        total,
    });

    return {
        pricedItems,
        subtotal,
        discountAmount,
        itemsTotal,
        shippingSnapshot,
        shippingTotal,
        total,
        couponResult,
        vendorMap: previewVendorMap,
        parcels: parcelBreakdown.parcels,
        parcelCount: parcelBreakdown.parcel_count,
        loyalty: {
            settings: loyaltySettings,
            available_points: balances?.available_points || 0,
            pending_points: balances?.pending_points || 0,
            requested_points: Math.max(0, Math.floor(Number(redeemPoints) || 0)),
            redeemed_points: redemption.points,
            discount: loyaltyDiscount,
            max_points: redemption.max_points,
            max_discount: redemption.max_discount,
            blocked_reason: redemption.blocked_reason,
            eligible_amount: eligibleEarnAmount,
            estimated_earn_points: estimatedEarnPoints,
            point_value: Number(loyaltySettings.point_value),
            spend_per_point: Number(loyaltySettings.spend_per_point),
        },
    };
};

const removePurchasedItemsFromCart = async (userId, items = []) => {
    const purchasedKeys = new Set();
    const purchasedBundleIds = new Set();
    for (const item of (Array.isArray(items) ? items : [])) {
        const bundleId = parseIncomingBundleId(item);
        if (bundleId && !parseIncomingProductId(item)) {
            purchasedBundleIds.add(bundleId.toString());
            continue;
        }
        const productId = parseIncomingProductId(item);
        if (!productId) continue;
        const { variantId } = parseIncomingVariantData(item);
        purchasedKeys.add(`${productId.toString()}:${variantId ? variantId.toString() : ''}`);
    }

    if (purchasedKeys.size === 0 && purchasedBundleIds.size === 0) return;

    const user = await User.findById(userId).select('cart');
    if (!user?.cart?.items) return;

    user.cart.items = user.cart.items.filter(item => {
        if (item.bundle_id) return !purchasedBundleIds.has(item.bundle_id.toString());
        const key = `${item.product_id?.toString()}:${item.variant_id ? item.variant_id.toString() : ''}`;
        return !purchasedKeys.has(key);
    });
    user.cart.updated_at = new Date();
    await user.save();
};

/** Increment sold_count on each purchased bundle. */
const incrementBundleSoldCounts = async (items = []) => {
    const counts = new Map();
    for (const item of (Array.isArray(items) ? items : [])) {
        const bundleId = parseIncomingBundleId(item);
        if (!bundleId || parseIncomingProductId(item)) continue;
        const q = Math.max(1, Number(item.quantity) || 1);
        counts.set(bundleId.toString(), (counts.get(bundleId.toString()) || 0) + q);
    }
    const ops = [...counts.entries()].map(([id, q]) => ({
        updateOne: { filter: { _id: id }, update: { $inc: { sold_count: q } } },
    }));
    if (ops.length > 0) await Bundle.bulkWrite(ops);
};

const incrementProductSoldCounts = async (orderItems = []) => {
    const quantitiesByProduct = new Map();

    for (const item of orderItems || []) {
        const productId = item.product_id?.toString();
        if (!productId) continue;
        quantitiesByProduct.set(
            productId,
            (quantitiesByProduct.get(productId) || 0) + Number(item.quantity || 0)
        );
    }

    const operations = [...quantitiesByProduct.entries()]
        .filter(([, quantity]) => quantity > 0)
        .map(([productId, quantity]) => ({
            updateOne: {
                filter: { _id: productId },
                update: { $inc: { sold_count: quantity } },
            },
        }));

    if (operations.length > 0) {
        await Product.bulkWrite(operations);
    }
};

/**
 * Point the loyalty ledger at the order that was just created, and turn an
 * online reservation into a real spend.
 *
 * For COD the points were already spent (before the order existed, so no order
 * can exist with an unfunded discount) — this only back-fills `order_id` so the
 * customer's history links to something they recognise.
 *
 * Never throws: at this point the money side is settled, and losing a link is
 * an audit inconvenience, not a financial error.
 */
const linkLoyaltySpendToOrder = async ({ newOrder, codRedemption, loyaltyReservation, loyalty, userId }) => {
    try {
        const { LoyaltyTransaction } = require('../models/loyaltyTransactions');

        if (codRedemption?.transaction && !codRedemption.duplicate) {
            await LoyaltyTransaction.updateOne(
                { _id: codRedemption.transaction._id },
                { $set: { order_id: newOrder._id } }
            );
        }

        if (loyaltyReservation && loyaltyReservation.points > 0) {
            await loyaltyService.consumePoints({
                userId,
                points: loyaltyReservation.points,
                orderId: newOrder._id,
                paymentId: loyaltyReservation.paymentId,
                settings: loyalty?.settings,
                from: 'reserved',
            });
        }
    } catch (err) {
        console.error(`[Loyalty] Failed to link spend to order ${newOrder?._id}: ${err.message}`);
    }
};

/**
 * Place a new order
 * @param {string} userId - ID of the user placing the order
 * @param {Object} orderData - Order payload including shipping_address, items, and total_price
 * @returns {Object} The created order
 */
const placeOrder = async (userId, orderData, options = {}) => {
    const {
        shipping_address,
        items,
        payment_method,
        coupon_code,
        shipping_destination,
        shipping_method_id,
        checkout_source,
        // Family provenance — present only when converting a family order request.
        family_id,
        family_order_request_id,
        requested_by_user_id,
        // Friend provenance — present only for a "buy for a friend" order.
        friendship_id,
        paid_by_user_id,
        ordered_for_user_id,
        redeem_points,
    } = orderData;
    const transactionOverride = options.transaction || {};
    // Online orders already hold their points against the hosted invoice; the
    // reservation is consumed after the order exists rather than spent again.
    const loyaltyReservation = options.loyaltyReservation || null;
    // Company account (feature 14): the split agreed at checkout. The company's
    // share was already taken from the limit by companyOrderService before this
    // was called; this function records it and settles the employee's part.
    const company = options.company || null;
    // Only companyOrderService may place a company order — it is what checks the
    // limit and holds the company's share. Asked for without that, refuse rather
    // than create an order nobody is billed for.
    if (!company && (payment_method === 'company_account' || transactionOverride.payment_method === 'company_account')) {
        throw new Error('Company-account orders must go through company checkout');
    }

    if (!shipping_address) {
        throw new Error('Shipping address is required');
    }

    const {
        pricedItems,
        subtotal,
        discountAmount,
        shippingSnapshot,
        shippingTotal,
        total,
        couponResult,
        loyalty,
    } = await getPricedOrderPreview({
        userId,
        items,
        couponCode: coupon_code,
        shippingDestination: shipping_destination || null,
        shippingMethodId: shipping_method_id || null,
        // A reservation is authoritative for this order: the points were
        // already held and priced when the invoice was created, so re-clamping
        // them against a balance that no longer contains them would silently
        // drop the discount the customer already paid against.
        redeemPoints: loyaltyReservation ? loyaltyReservation.points : redeem_points,
        reservedPoints: loyaltyReservation ? loyaltyReservation.points : 0,
    });

    await calculateCommissions(pricedItems, couponResult);

    const vendorIds = [...new Set(pricedItems.map(i => i.vendor_id))];
    const vendors = await Seller.find({ _id: { $in: vendorIds } }).lean();
    const vendorMap = new Map(vendors.map(v => [v._id.toString(), v]));

    const vendor_supervisions = buildVendorSupervisionsFromItems(pricedItems, vendorMap);
    if (shippingSnapshot) {
        shippingEngine.assignVendorShippingCosts({ shipping: shippingSnapshot, vendor_supervisions });
    }

    const reference = transactionOverride.reference || ('REF-' + Math.random().toString(36).substring(2, 10).toUpperCase());

    // Split the basket into parcels — one per (vendor, pickup branch) — and stamp each line
    // with the parcel that will fulfil it. Membership is stored on the line rather than
    // derived from its vendor, because an admin resolving a declined item can move that line
    // to a different vendor entirely, and a derived membership would silently reassign it
    // while the money already allocated to the old parcel stayed behind.
    const subOrders = subOrderService.buildSubOrdersFromItems(pricedItems, vendorMap, reference);

    const orderItems = pricedItems.map(item => ({
        product_id: item.product_id,
        product_title: item.product_title,
        product_image: item.product_image,
        variant_id: item.variant_id,
        variant_label: item.variant_label,
        quantity: item.quantity,
        unit_price: item.unit_price,
        vendor_id: item.vendor_id,
        vendor_status: item.vendor_status,
        commission_rate: item.commission_rate,
        commission_amount: item.commission_amount,
        sub_order_id: item.sub_order_id || null,
        bundle_id: item.bundle_id || null,
        bundle_group: item.bundle_group || null,
        bundle_title: item.bundle_title || '',
        is_bundle_member: !!item.is_bundle_member,
    }));

    // Split shipping, the coupon and the loyalty discount across the parcels BEFORE the
    // order is written, so it is never persisted without the amounts the customer was
    // shown. The invariant: Σ sub_order.cod_amount === total_price, exactly.
    const shippingSettings = await shippingEngine.getSettings().catch(() => null);
    subOrderService.allocate({
        items: orderItems,
        sub_orders: subOrders,
        shipping: shippingSnapshot,
        coupon_discount_amount: discountAmount,
        coupon_vendor_share_percent: Number(couponResult?.coupon?.vendor_share_percent || 0),
        loyalty: { redemption_discount: Number(loyalty?.discount || 0) },
        total_price: total,
        allocation_frozen: false,
    });
    // Consolidate to office (feature 14, phase 3): the parcels wait in the company's
    // batches instead of going to the vendors now. Held after the split above, so each one
    // records the full shipping it was charged — the most it can ever cost.
    if (company?.delivery_mode === 'consolidate') {
        require('./companyBatchService').holdParcels(subOrders, { shipNowVendorIds: company.ship_now_vendor_ids || [] });
    }
    subOrderService.applyDeadlines(
        { created_at: new Date(), sub_orders: subOrders },
        shippingSettings?.vendor_action_deadline_hours ?? 48
    );
    const normalizedPaymentMethod = company
        ? 'company_account'
        : (transactionOverride.payment_method || payment_method || 'cash');

    // The split was agreed against the total the customer saw a moment ago. If the
    // price has moved since (a product repriced mid-checkout), the company would be
    // billed for one amount and the order would say another — refuse instead.
    if (company) {
        const agreed = Number(company.company_amount || 0) + Number(company.personal_amount || 0);
        if (Math.abs(agreed - Number(total)) > 0.01) {
            const err = new Error('The order total changed while you were checking out. Please review it again.');
            err.code = 'PRICE_CHANGED';
            throw err;
        }
    }

    // Cash on delivery is gated per customer. Checked HERE and not only at checkout: the
    // storefront hides the option, but the endpoint is the thing that has to be true, and a
    // request that arrives with `payment_method: "cash"` from anywhere else must meet the
    // same rule. `transactionOverride` marks an order already paid through a gateway, which
    // cannot be a cash order at all, so those skip the check.
    if (normalizedPaymentMethod === 'cash' && !transactionOverride.payment_method) {
        const codAllowed = await require('./codEligibilityService').isAllowed({
            userId,
            // The DELIVERY phone, not the account's: it is the number the courier calls and
            // the one the history is keyed on.
            phone: shipping_address?.phone || '',
        });
        if (!codAllowed) {
            throw new Error('Cash on delivery is not available for this account. Please pay online.');
        }
    }

    // Wallet orders are settled in full before the order exists, so they are
    // born paid — there is no provider round trip that could still fail.
    // A company order is settled as far as the customer is concerned: the company
    // is billed monthly, and any part above the limit was paid before this point.
    const transactionStatus = transactionOverride.status
        || (['credit_card', 'wallet', 'company_account'].includes(normalizedPaymentMethod) ? 'paid' : 'pending');

    // Cash on delivery has no hosted payment to reserve against, so its points
    // are spent here — atomically, and BEFORE the order exists. If the balance
    // moved since the preview the conditional spend fails and no order is
    // created, which is the only ordering that cannot produce an order whose
    // discount was never funded.
    const redeemedPoints = Number(loyalty?.redeemed_points || 0);
    let codRedemption = null;
    if (!loyaltyReservation && redeemedPoints > 0) {
        codRedemption = await loyaltyService.applyLedgerEntry({
            userId,
            type: 'redeem_consume',
            points: redeemedPoints,
            deltas: { available: -redeemedPoints },
            lifetime: { redeemed: redeemedPoints },
            // Reference-scoped: the reference is unique per placement attempt,
            // so a retried placement spends once and never twice.
            idempotencyKey: `checkout:${reference}:redeem-consume`,
            monetaryValue: loyalty.discount,
            settings: loyalty.settings,
            reason: 'Points redeemed at checkout',
        });
    }

    // Wallet checkout settles here, BEFORE the order exists, for the same
    // reason cash-on-delivery spends its points here: if the balance moved
    // since the price preview, the conditional debit fails and no order is
    // created. Creating the order first and charging afterwards can leave an
    // order nobody paid for, which is the one outcome that must be impossible.
    //
    // `userId` is the payer on every path — a friend or family order is owned
    // by whoever is buying — so the money always comes from the right wallet.
    const walletPayerId = paid_by_user_id || userId;
    // On a company order the wallet pays only the employee's own part.
    const walletAmount = company ? Number(company.personal_amount || 0) : total;
    const chargesWallet = normalizedPaymentMethod === 'wallet'
        || (company && company.personal_method === 'wallet' && walletAmount > 0);
    let walletCharge = null;
    if (chargesWallet) {
        try {
            const { transaction } = await walletService.chargeOrder({
                userId: walletPayerId,
                amountMinor: walletService.toMinor(walletAmount),
                reference,
                beneficiaryUserId: ordered_for_user_id || null,
                reason: 'Order paid from wallet',
            });
            walletCharge = transaction;
        } catch (err) {
            // The wallet refused. Hand back the points this attempt already
            // spent, otherwise a customer who is merely short of credit also
            // silently loses their loyalty balance.
            if (codRedemption?.transaction && !codRedemption.duplicate) {
                await loyaltyService.restorePoints({
                    userId,
                    points: redeemedPoints,
                    orderId: null,
                    reason: 'Wallet payment failed',
                    idempotencyKey: `checkout:${reference}:redeem-restore-wallet-failed`,
                }).catch((restoreErr) =>
                    console.error(`[Wallet] Point restore after failed charge: ${restoreErr.message}`));
            }
            throw err;
        }
    }

    /**
     * Undo everything this placement attempt already spent.
     *
     * Reached only when the order document itself could not be written. Both
     * halves are compensating LEDGER ENTRIES rather than deletions, so the
     * customer's statement shows the money leaving and coming back instead of
     * a charge that quietly disappears.
     */
    const compensateFailedPlacement = async (cause) => {
        if (walletCharge) {
            await walletService.reverseCharge({
                userId: walletPayerId,
                amountMinor: walletService.toMinor(walletAmount),
                reference,
                reason: 'Order could not be created',
            }).catch((err) => console.error(`[Wallet] Charge reversal failed for ${reference}: ${err.message}`));
        }
        if (codRedemption?.transaction && !codRedemption.duplicate) {
            await loyaltyService.restorePoints({
                userId,
                points: redeemedPoints,
                orderId: null,
                reason: 'Order could not be created',
                idempotencyKey: `checkout:${reference}:redeem-restore-failed`,
            }).catch((err) => console.error(`[Loyalty] Point restore failed for ${reference}: ${err.message}`));
        }
        throw cause;
    };

    // Read the placing account's standing at the moment of placement, not later.
    // An order placed by an unconfirmed guest stays flagged as one even after
    // that customer confirms and the account becomes a normal one — the flag
    // records what was true when the order was taken, which is the question ops
    // is actually asking of a cash order.
    const placingAccount = await User.findById(userId).select('account_status phone_verified_at').lean();
    const placedAsGuest = placingAccount?.account_status === 'guest' && !placingAccount?.phone_verified_at;

    const newOrder = await Order.create({
        ...(company?.order_id ? { _id: company.order_id } : {}),
        user_id: userId,
        status: 'pending',
        placed_as_guest: placedAsGuest,
        family_id: family_id || null,
        family_order_request_id: family_order_request_id || null,
        requested_by_user_id: requested_by_user_id || null,
        friendship_id: friendship_id || null,
        paid_by_user_id: paid_by_user_id || null,
        ordered_for_user_id: ordered_for_user_id || null,
        company: company ? {
            company_id: company.company_id,
            company_name: company.company_name || '',
            membership_id: company.membership_id || null,
            beneficiary: company.beneficiary,
            car_id: company.car_id || null,
            car_label: company.car_label || '',
            office_id: company.office_id || null,
            office_name: company.office_name || '',
            delivery_mode: company.delivery_mode || 'instant',
            month: company.month,
            company_amount: Number(company.company_amount || 0),
            billing_mode: company.billing_mode || 'monthly',
            personal_amount: Number(company.personal_amount || 0),
            personal_method: company.personal_method || null,
        } : null,
        shipping_address,
        items: orderItems,
        sub_orders: subOrders,
        vendor_supervisions,
        shipping: shippingSnapshot || undefined,
        total_price: total,
        coupon_code: couponResult?.coupon?.code,
        coupon_discount_type: couponResult?.coupon?.discount_type,
        coupon_discount_value: couponResult?.coupon?.discount_value,
        coupon_discount_amount: discountAmount,
        coupon_scope_type: couponResult?.coupon?.scope_type,
        coupon_vendor_share_percent: Number(couponResult?.coupon?.vendor_share_percent || 0),
        loyalty: {
            // `userId` is always the payer — a gift order keeps the buyer as
            // the order owner — so the points follow the money, not the parcel.
            payer_user_id: paid_by_user_id || userId,
            eligible_amount: Number(loyalty?.eligible_amount || 0),
            earn_points_pending: Number(loyalty?.estimated_earn_points || 0),
            earned_points_released: 0,
            earned_points_reversed: 0,
            redeemed_points: redeemedPoints,
            redemption_discount: Number(loyalty?.discount || 0),
            restored_points: 0,
            spend_per_point_snapshot: Number(loyalty?.spend_per_point || 0),
            point_value_snapshot: Number(loyalty?.point_value || 0),
        },
        transaction: {
            amount: total,
            payment_method: normalizedPaymentMethod,
            status: transactionStatus,
            reference,
            provider: transactionOverride.provider || (walletCharge ? 'wallet' : null),
            provider_mode: transactionOverride.provider_mode || null,
            payment_id: transactionOverride.payment_id || null,
            // The ledger row that funded this order. This is the link support
            // follows from "which order" to "which money", and back again.
            wallet_transaction_id: walletCharge?._id || null,
            invoice_id: transactionOverride.invoice_id || null,
            invoice_key: transactionOverride.invoice_key || null,
            payment_url: transactionOverride.payment_url || null,
            paid_at: transactionOverride.paid_at || (walletCharge ? new Date() : null),
            failure_reason: transactionOverride.failure_reason || null,
            provider_payload: transactionOverride.provider_payload || null,
        },
        history: [{
            action: 'order_created',
            title: 'Order placed',
            details: couponResult
                ? `Customer placed the order with coupon ${couponResult.coupon.code}.`
                : 'Customer placed the order.',
            actor_role: 'user',
            actor_label: shipping_address.recipient_name || 'Customer',
            metadata: {
                item_count: orderItems.length,
                subtotal,
                discount_amount: discountAmount,
                shipping_total: Number(shippingTotal || 0),
                total_price: total,
                coupon_code: couponResult?.coupon?.code || null,
                redeemed_points: redeemedPoints,
                loyalty_discount: Number(loyalty?.discount || 0),
            },
            created_at: new Date(),
        }],
    }).catch(compensateFailedPlacement);

    // Attach the ledger rows to the order they belong to. Done after creation
    // because the order id does not exist until now; the spend itself already
    // happened above, so a failure here costs traceability, not money.
    await linkLoyaltySpendToOrder({ newOrder, codRedemption, loyaltyReservation, loyalty, userId });
    await walletService.linkChargeToOrder(walletCharge?._id, newOrder._id)
        .catch((err) => console.error(`[Wallet] Could not link charge to order ${newOrder._id}: ${err.message}`));

    // The company's share, on its ledger. The limit was already taken at
    // checkout, so a failure here loses a statement line, never money — and it is
    // idempotent on the order, so it can simply be written again.
    if (company) {
        await require('./companyOrderService').recordCharge(newOrder)
            .catch((err) => console.error(`[Company] Could not book order ${newOrder._id} on the ledger: ${err.message}`));
    }

    if (couponResult?.coupon?._id) {
        await consumeCouponUsage({ couponId: couponResult.coupon._id, userId });
    }

    await incrementProductSoldCounts(orderItems);
    await incrementBundleSoldCounts(items);
    await notifyVendorsAboutNewOrder(newOrder);

    // Confirm to the customer as soon as the order exists. This is the single
    // funnel for both payment paths — cash on delivery lands here immediately,
    // card orders land here only after the provider confirms payment — so the
    // message is never sent for an order that was not actually placed.
    await sendOrderConfirmation(newOrder);

    // 'family_request' orders are hydrated from a durable request, not from the
    // organizer's cart — there is nothing of theirs to clear. Nor are 'chat' orders
    // (the AI assistant's basket): the website chat widget takes the ordered lines
    // out of the browser cart itself, and a WhatsApp order has nothing to do with it.
    if (checkout_source !== 'buy_now' && checkout_source !== 'family_request' && checkout_source !== 'chat') {
        await removePurchasedItemsFromCart(userId, items);
    }

    // Convenience save-back of a new delivery address — but ONLY when the buyer
    // is the recipient. On a friend order the address belongs to someone else,
    // and copying it into the payer's address book would leak it permanently.
    // Nor when it is a company office: that address is the company's, not theirs.
    const user = (ordered_for_user_id || company?.office_id) ? null : await User.findById(userId);
    if (user) {
        const addressExists = user.addresses.some(
            addr => addr.full_address.toLowerCase() === shipping_address.full_address.toLowerCase()
        );

        if (!addressExists) {
            user.addresses.push({
                recipient_name: shipping_address.recipient_name,
                phone: shipping_address.phone,
                full_address: shipping_address.full_address,
                shipping_country: shipping_destination?.country || null,
                shipping_city: shipping_destination?.city || null,
                is_default: user.addresses.length === 0,
            });
            await user.save();
        }
    }

    // Held parcels join their batches last, once everything else about the order is
    // settled: joining can fill a batch and close it, which re-reads and saves this order.
    // A failure here leaves the parcels held; the batch sweep joins them a moment later.
    if ((newOrder.sub_orders || []).some((s) => s.status === 'held_in_batch')) {
        const joined = await require('./companyBatchService').joinBatchesForOrder(newOrder._id)
            .catch((err) => {
                console.error(`[Company batch] Join failed for order ${newOrder._id}: ${err.message}`);
                return null;
            });
        if (joined?.joined) return (await Order.findById(newOrder._id)) || newOrder;
    }

    return newOrder;
};

/**
 * Build MongoDB filter object from query params.
 */
function buildOrderFilter(params) {
    const filter = {};

    if (params.status) filter.status = params.status;

    if (params.paymentStatus) {
        filter['transaction.status'] = params.paymentStatus;
    }

    // The phone-confirmation queue. `needs_call` and `no_answer` are the two states with
    // work left in them, so they are askable together as `open`.
    if (params.confirmation === 'open') {
        filter['customer_confirmation.status'] = { $in: ['needs_call', 'no_answer'] };
    } else if (params.confirmation) {
        filter['customer_confirmation.status'] = params.confirmation;
    }

    if (params.vendorId && mongoose.Types.ObjectId.isValid(params.vendorId)) {
        filter['items.vendor_id'] = new mongoose.Types.ObjectId(params.vendorId);
    }

    if (params.from || params.to) {
        filter.created_at = {};
        if (params.from) filter.created_at.$gte = new Date(params.from);
        if (params.to) {
            const end = new Date(params.to);
            end.setHours(23, 59, 59, 999);
            filter.created_at.$lte = end;
        }
    }

    if (params.search) {
        const q = params.search.trim();
        const orFilters = [
            { 'transaction.reference': { $regex: q, $options: 'i' } },
            { 'shipping_address.recipient_name': { $regex: q, $options: 'i' } },
            { 'shipping_address.phone': { $regex: q, $options: 'i' } },
        ];

        if (mongoose.Types.ObjectId.isValid(q)) {
            orFilters.unshift({ _id: new mongoose.Types.ObjectId(q) });
        }

        filter.$or = orFilters;
    }

    return filter;
}

/**
 * Get all orders for admin — with filters and pagination.
 */
const getAllOrders = async (params = {}) => {
    const filter = buildOrderFilter(params);
    const page = Math.max(1, parseInt(params.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(params.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [orders, total, byStatus] = await Promise.all([
        Order.find(filter)
            .sort({ created_at: -1 })
            .skip(skip)
            .limit(limit)
            .populate('user_id', 'name email phone')
            .populate('items.vendor_id', 'store_name store_username')
            .lean(),
        Order.countDocuments(filter),
        // The figures above the table, over every order the filters match — not only the
        // page on screen — so the statuses always add up to the total.
        Order.aggregate([
            { $match: filter },
            { $group: {
                _id: '$status',
                count: { $sum: 1 },
                company: { $sum: { $cond: [{ $ifNull: ['$company.company_id', false] }, 1, 0] } },
            } },
        ]),
    ]);
    const companyOrders = byStatus.reduce((sum, row) => sum + row.company, 0);

    const enriched = orders.map(order => {
        const uniqueVendorIds = [...new Set(
            (order.items || [])
                .filter(i => i.vendor_id)
                .map(i => i.vendor_id._id ? i.vendor_id._id.toString() : i.vendor_id.toString())
        )];

        return {
            ...order,
            vendor_count: uniqueVendorIds.length,
            item_count: (order.items || []).length,
            reference: order.transaction?.reference || order._id.toString(),
            user_name: order.user_id?.name || order.shipping_address?.recipient_name || '-',
            user_phone: order.user_id?.phone || order.shipping_address?.phone || '-',
        };
    });

    return {
        orders: enriched,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        stats: {
            by_status: Object.fromEntries(byStatus.map((row) => [row._id, row.count])),
            company: companyOrders,
            individual: byStatus.reduce((sum, row) => sum + row.count, 0) - companyOrders,
        },
    };
};

/**
 * Get single order for admin, grouped by vendor.
 */
/**
 * Put the batch's state beside each company parcel on the admin view: whether the batch is
 * still collecting, how many orders it holds of how many it waits for, when it closes on its
 * own, and — for the parcel that carries the combined box — how many of its orders the
 * vendor has not confirmed yet. Read-only; never throws into the order page.
 */
const attachCompanyBatchDetail = async (order, publicSubs) => {
    try {
        const ids = [...new Set((order.sub_orders || [])
            .map((s) => s.company_batch?.batch_id).filter(Boolean).map(String))];
        if (ids.length === 0) return;
        const { CompanyBatch } = require('../models/companyBatches');
        const batches = await CompanyBatch.find({ _id: { $in: ids } })
            .select('status company_id office_name target_count deadline_at close_reason closed_at members')
            .lean();
        const byId = new Map(batches.map((b) => [String(b._id), b]));

        // Members the vendor has not confirmed yet, for batches that already closed.
        const NOT_CONFIRMED = ['held_in_batch', 'pending_review', 'needs_admin'];
        const pendingByBatch = new Map();
        for (const b of batches) {
            if (b.status !== 'closed') continue;
            const live = (b.members || []).filter((mb) => mb.status !== 'left');
            const orders = await Order.find({ _id: { $in: live.map((mb) => mb.order_id) } }).select('sub_orders._id sub_orders.status').lean();
            const statusOf = new Map();
            for (const o of orders) for (const so of o.sub_orders || []) statusOf.set(String(so._id), so.status);
            pendingByBatch.set(String(b._id), live.filter((mb) => NOT_CONFIRMED.includes(statusOf.get(String(mb.sub_order_id)))).length);
        }

        for (const sub of publicSubs) {
            const b = sub.company_batch?.batch_id ? byId.get(String(sub.company_batch.batch_id)) : null;
            if (!b) continue;
            sub.company_batch.batch = {
                status: b.status,
                company_id: b.company_id,
                company_name: order.company?.company_name || '',
                office_name: b.office_name || order.company?.office_name || '',
                order_count: (b.members || []).filter((mb) => mb.status !== 'left').length,
                target_count: b.target_count,
                deadline_at: b.deadline_at,
                close_reason: b.close_reason || null,
                closed_at: b.closed_at || null,
                awaiting_confirmation: pendingByBatch.get(String(b._id)) ?? null,
            };
        }
    } catch (err) {
        console.error(`[Orders] Could not attach batch detail to ${order?._id}: ${err.message}`);
    }
};

const getOrderById = async (orderId) => {
    const order = await Order.findById(orderId)
        .populate('user_id', 'name email phone')
        .populate('items.vendor_id', 'store_name store_username email phone')
        .populate('items.product_id', 'title_en title_ar images slug_en slug_ar sku part_number')
        .lean();

    if (!order) throw new Error('Order not found');

    // Smart labels ride along on the vendor group so the admin sees, in one place, which
    // parcels are already labelled and which still need one before pressing "ready".
    const smartLabelService = require('./smartLabelService');
    const [smartLabels, smartLabelEnabled] = await Promise.all([
        smartLabelService.labelsForOrder(order._id),
        smartLabelService.isEnabled(),
    ]);
    const labelByVendor = new Map(smartLabels.map(l => [l.vendor_id.toString(), l]));

    const vendorGroups = {};
    for (const item of order.items || []) {
        const vendorDoc = item.vendor_id;
        if (!vendorDoc) continue;

        const vid = (vendorDoc._id || vendorDoc).toString();
        if (!vendorGroups[vid]) {
            vendorGroups[vid] = {
                vendor: vendorDoc,
                items: [],
                supervision: order.vendor_supervisions?.find(
                    s => s.vendor_id.toString() === vid
                ) || null,
                smart_label: labelByVendor.get(vid) || null,
            };
        }
        vendorGroups[vid].items.push(item);
    }

    // Parcels are what the admin now acts on: each card carries its stage, its photos, its
    // tracking and its own buttons. `vendor_groups` is kept beside them because commissions
    // and the financial rollup are still per VENDOR — a vendor with two branches has two
    // parcels but one supervision.
    const vendorById = new Map();
    for (const item of order.items || []) {
        const v = item.vendor_id;
        if (v && v._id) vendorById.set(v._id.toString(), v);
    }

    const subOrders = (order.sub_orders || []).map((sub) =>
        subOrderService.toPublicSubOrder(order, sub, {
            audience: 'admin',
            vendor: vendorById.get(sub.vendor_id?.toString()),
        })
    );

    const live = (order.sub_orders || []).filter(subOrderService.isLive);

    // Company consolidation (feature 14): where each parcel's batch stands, so the admin
    // screen can say "waiting — closes at 3 orders or on Thursday" instead of offering a
    // Send button the server will refuse.
    await attachCompanyBatchDetail(order, subOrders);

    return {
        ...order,
        reference: order.transaction?.reference || order._id.toString(),
        history: (order.history || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
        vendor_groups: Object.values(vendorGroups),
        sub_orders: subOrders,
        // The counter every screen renders beside the status word, because one word cannot
        // honestly describe three parcels in three different states.
        parcel_summary: {
            total: live.length,
            delivered: live.filter((s) => s.status === 'delivered').length,
            cancelled: (order.sub_orders || []).length - live.length,
            needs_admin: live.filter((s) => s.status === 'needs_admin').length,
            overdue: live.filter((s) => s.is_overdue).length,
        },
        journey: subOrderService.buildOrderJourney(order),
        allocation_frozen: !!order.allocation_frozen,
        edit_blocked_reason: subOrderService.editBlockedReason(order),
        smart_label_enabled: smartLabelEnabled,
    };
};

/**
 * A vendor whose items were all declined (or deleted) has nothing to ship. Any smart label
 * they scanned goes back so the number isn't stuck on a shipment that will never exist —
 * the label is still on the parcel and perfectly usable elsewhere.
 *
 * Mutates `order` (history only); the caller saves. Never throws: a label bookkeeping
 * problem must not fail an item review.
 */
const releaseLabelsWithNothingToShip = async (order, actor = {}) => {
    try {
        await require('./smartLabelService').releaseUnshippableReservations(order, actor);
    } catch (err) {
        console.error(`[Smart Label] Release check failed for order ${order?._id}: ${err.message}`);
    }
};

/**
 * Auto-advance a still-pending order to "processing" once every item has been
 * approved (none pending, none declined). Mutates the order in memory; the
 * caller is responsible for saving. Returns true if the status changed.
 */
const autoAdvanceToProcessing = (order, actor = {}) => {
    if (!order || order.status !== 'pending') return false;
    const items = order.items || [];
    if (items.length === 0) return false;

    const allApproved = items.every((item) => item.vendor_status === 'approved');
    if (!allApproved) return false;

    for (const sup of order.vendor_supervisions || []) {
        sup.status = 'supervised';
    }
    order.status = 'processing';
    appendHistory(
        order,
        'order_auto_processing',
        'Order moved to processing',
        'All items were approved, so the order automatically advanced to processing.',
        {},
        actor
    );
    return true;
};

/**
 * Who should receive the order-confirmation message.
 *
 * Normally that is the delivery contact on the order. NOT so for a
 * "buy for a friend" order: there the shipping address belongs to the
 * recipient, while the confirmation states the amount paid. Sending it to the
 * recipient would tell them exactly what their gift cost, so a friend order
 * confirms to the PAYER — the customer who actually placed and paid for it.
 */
const resolveConfirmationRecipient = async (order) => {
    // A company order delivered to an office carries the OFFICE's receiving mobile on its
    // address — that is who the courier calls. But the order belongs to the employee (or
    // the manager ordering for a company car) who placed it, so the confirmation goes to
    // them; the office reception is not the one who ordered or who asks where it is.
    if (order.company?.company_id && order.user_id) {
        const orderer = await User.findById(order.user_id).select('name phone');
        if (orderer?.phone) return { phone: orderer.phone, name: orderer.name };
        // No phone on the account: the office number is still better than nothing.
    }

    if (order.ordered_for_user_id) {
        const payer = await User.findById(order.paid_by_user_id || order.user_id).select('name phone');
        if (!payer?.phone) return null;
        return { phone: payer.phone, name: payer.name };
    }

    const phone = order.shipping_address?.phone;
    if (!phone) return null;
    return { phone, name: order.shipping_address?.recipient_name };
};

/**
 * How hard the WhatsApp confirmation is tried before a human has to step in.
 *
 * Three attempts twenty minutes apart — an hour in total. The shape is deliberate: a
 * provider that is merely rebooting is back well inside it, so the order team is not sent
 * to the phone for an outage that fixed itself, while a real failure (a dead template, a
 * number the account cannot send from) is admitted within the hour rather than discovered
 * when the courier arrives.
 */
const WHATSAPP_MAX_ATTEMPTS = 3;
const WHATSAPP_RETRY_AFTER_MINUTES = 20;
/**
 * After this, an order is never retried again — so it is also the point past which a
 * failure has to raise the flag immediately instead of waiting for attempts that will
 * never come. The retry sweep and the delivery poll read the SAME constant on purpose:
 * when they disagreed, a failed message older than the window was recorded as failed and
 * then quietly left `pending` forever, which is the exact silence this whole flag exists
 * to break.
 */
const WHATSAPP_RETRY_WINDOW_HOURS = 24;

/**
 * Orders where a confirmation call would be asking about something already settled — the
 * goods arrived, went back, or the order is dead. Everything else is still in flight and
 * still worth a call.
 *
 * Written as the EXCLUDED list rather than the included one so a status added later is
 * treated as still-worth-confirming by default. The failure directions are not equal: an
 * extra row in the call queue is noise somebody clears in a second, a missing one is a
 * customer nobody ever rang.
 */
const CONFIRMATION_MOOT_STATUSES = [
    'completed', 'cancelled', 'partially_cancelled', 'partially_delivered',
    'refunded', 'returned', 'partially_returned', 'return_requested', 'return_in_progress',
];

/**
 * Record one failed attempt, and raise the phone-call flag once they are exhausted.
 *
 * Written with `updateOne` rather than through the in-memory document: this runs inside
 * checkout and inside a sweep, and neither may clobber a concurrent write to the order.
 */
const recordConfirmationFailure = async (order, message, { final = false } = {}) => {
    const attempts = Number(order.customer_confirmation?.whatsapp_attempts || 0) + 1;
    // `final` is for a failure nothing will retry — the provider gave a settled verdict on
    // an order already past the retry window. Counting to three would just mean counting
    // to three forever.
    const exhausted = final || attempts >= WHATSAPP_MAX_ATTEMPTS;
    const now = new Date();

    const set = {
        'customer_confirmation.whatsapp_attempts': attempts,
        'customer_confirmation.last_attempt_at': now,
        'customer_confirmation.last_error': String(message || '').slice(0, 500),
    };
    if (!order.customer_confirmation?.first_attempt_at) {
        set['customer_confirmation.first_attempt_at'] = now;
    }

    const update = { $set: set };

    // Only the LAST attempt raises the flag, and only from `pending`: an order a human has
    // already spoken about must never be dragged back into the queue by a late retry.
    if (exhausted && (order.customer_confirmation?.status || 'pending') === 'pending') {
        set['customer_confirmation.status'] = 'needs_call';
        set['customer_confirmation.flagged_at'] = now;
        update.$push = {
            history: {
                action: 'customer_confirmation_needs_call',
                title: 'Needs a phone confirmation',
                details: `WhatsApp could not reach the customer after ${attempts} attempts. Last error: ${message}`,
                actor_role: 'system',
                actor_label: 'System',
                metadata: { attempts, last_error: String(message || '').slice(0, 500) },
                created_at: now,
            },
        };
    }

    await Order.updateOne({ _id: order._id }, update).catch((err) => {
        console.error(`[WhatsApp] Could not record failed attempt for ${order._id}: ${err.message}`);
    });

    // Keep the in-memory copy honest for anything still holding it.
    order.customer_confirmation = {
        ...(order.customer_confirmation?.toObject?.() || order.customer_confirmation || {}),
        whatsapp_attempts: attempts,
        last_attempt_at: now,
        ...(exhausted ? { status: 'needs_call', flagged_at: now } : {}),
    };
};

/**
 * Send the customer their WhatsApp order confirmation.
 *
 * Fires as soon as the order EXISTS — which is on placement for cash on
 * delivery, and immediately after the provider confirms payment for card
 * orders, because `placeOrder` is the single funnel for both. It deliberately
 * does not wait for vendor review: the customer expects a receipt for the
 * action they just took, not for an internal approval step they cannot see.
 *
 * Idempotent (once per order via `whatsapp_confirmation_sent_at`) and fail-safe
 * — never throws, so a provider outage cannot break checkout. Because the guard
 * is only written after a SUCCESSFUL send, the later status-change call sites
 * act as a free retry if the first attempt failed.
 */
const sendOrderConfirmation = async (order) => {
    try {
        if (!order) return;
        if (order.whatsapp_confirmation_sent_at) return;

        const recipient = await resolveConfirmationRecipient(order);
        // An order with no reachable phone can never be confirmed by message, so it is a
        // failure and not a no-op. Returning quietly here left it `pending` — indistinguishable
        // from an order whose confirmation went out perfectly.
        if (!recipient) {
            await recordConfirmationFailure(order, 'No phone number to send the confirmation to', { final: true });
            return;
        }
        const { phone } = recipient;

        const whatsappService = require('./whatsappService');

        const itemsSummary = (order.items || [])
            .map((i) => {
                // "Default" is the placeholder label for a product with no real
                // variants — showing "(Default)" to a customer looks broken.
                const label = i.variant_label && i.variant_label !== 'Default' ? ` (${i.variant_label})` : '';
                const linePrice = Math.round(Number(i.unit_price || 0) * Number(i.quantity || 0));
                return `${i.product_title}${label} x${i.quantity} - ${linePrice} ج.م`;
            })
            .join('، ');

        const reference = order.transaction?.reference || order._id.toString();
        const variables = {
            1: recipient.name || 'عميلنا العزيز',
            2: reference,
            3: itemsSummary,
            4: `${Math.round(Number(order.total_price || 0))} ج.م`,
        };

        const result = await whatsappService.sendTemplateMessage({
            phone,
            variables,
            // Campaign label in the provider dashboard — per-order, so a support
            // agent can find this exact message instead of scrolling a list of
            // identically-named campaigns.
            campaignName: `Order confirmation #${reference}`,
            // Whoever the message is actually going to — not the office label on a company order.
            recipientName: recipient.name || order.shipping_address?.recipient_name,
        });

        // A skipped send is a send that did not happen. It used to be recorded as
        // delivered, which quietly marked every order confirmed while the provider was
        // unconfigured — exactly the silence this flag exists to break.
        if (result?.skipped) {
            await recordConfirmationFailure(order, 'WhatsApp is not configured (no API key)');
            return;
        }

        // Persist the guard + audit entry atomically without clobbering concurrent writes.
        await Order.updateOne(
            { _id: order._id },
            {
                $set: {
                    whatsapp_confirmation_sent_at: new Date(),
                    // The provider has no delivery webhooks: polling this
                    // campaign id is the only way to learn whether the message
                    // actually reached the customer.
                    whatsapp_campaign_id: result?.campaignId || null,
                },
                $push: {
                    history: {
                        action: 'whatsapp_confirmation_sent',
                        title: 'WhatsApp confirmation queued',
                        // "queued", not "delivered" — a 2xx from the provider
                        // only means it accepted the campaign for dispatch.
                        details: `Order confirmation queued for ${phone}.`,
                        actor_role: 'system',
                        actor_label: 'System',
                        metadata: {
                            campaign_id: result?.campaignId || null,
                            provider_status: result?.status || null,
                            skipped: !!result?.skipped,
                        },
                        created_at: new Date(),
                    },
                },
            }
        );
        order.whatsapp_confirmation_sent_at = new Date();
    } catch (err) {
        // Never fatal: a missed notification must not break an order. Log the
        // provider's `details` too — on a 422 that is the only text saying what
        // to fix (wrong variable count, bad number, template mismatch).
        const detail = err.details?.length ? ` [${err.details.join('; ')}]` : '';
        console.error(`[WhatsApp] Order confirmation failed for ${order?._id}: ${err.message}${detail}`);
        if (order?._id) await recordConfirmationFailure(order, `${err.message}${detail}`);
    }
};

/**
 * Retry the confirmations that have not gone out yet, and flag the ones that never will.
 *
 * Placement is one attempt; this is the other two. Runs on a timer rather than a chain of
 * in-process retries so a checkout is never held open waiting for a provider, and so an
 * order placed during an outage is still chased after the process restarts.
 *
 * @returns {{ retried: number, flagged: number }}
 */
const sweepUnconfirmedOrders = async () => {
    const now = Date.now();
    const dueBefore = new Date(now - WHATSAPP_RETRY_AFTER_MINUTES * 60 * 1000);
    // A day-old order is not worth another attempt: by then either somebody has called, or
    // the parcel is already moving and a confirmation message is noise.
    const notOlderThan = new Date(now - WHATSAPP_RETRY_WINDOW_HOURS * 60 * 60 * 1000);

    const candidates = await Order.find({
        whatsapp_confirmation_sent_at: null,
        'customer_confirmation.status': 'pending',
        'customer_confirmation.whatsapp_attempts': { $lt: WHATSAPP_MAX_ATTEMPTS },
        status: { $nin: ['cancelled'] },
        created_at: { $gte: notOlderThan },
        $or: [
            { 'customer_confirmation.last_attempt_at': null },
            { 'customer_confirmation.last_attempt_at': { $lte: dueBefore } },
        ],
    }).limit(50);

    let flagged = 0;
    for (const order of candidates) {
        await sendOrderConfirmation(order);
        if (order.customer_confirmation?.status === 'needs_call') flagged += 1;
    }

    // The orders that fell out of the window with nothing ever sent. They are past every
    // retry above, so without this they would sit at `pending` — "all fine" — forever,
    // which is the same silence as a message the provider swallowed. A confirmation that
    // was never sent and never will be is a call somebody has to make.
    const abandoned = await Order.find({
        whatsapp_confirmation_sent_at: null,
        'customer_confirmation.status': 'pending',
        created_at: { $lt: notOlderThan },
        status: { $nin: CONFIRMATION_MOOT_STATUSES },
    }).limit(50);

    for (const order of abandoned) {
        await recordConfirmationFailure(
            order,
            'The confirmation was never sent, and the order is past the retry window',
            { final: true }
        );
        if (order.customer_confirmation?.status === 'needs_call') flagged += 1;
    }

    return { retried: candidates.length, abandoned: abandoned.length, flagged };
};

/**
 * Ask the provider what actually happened to each confirmation message.
 *
 * `POST /send` returning 2xx means EverySecond QUEUED a campaign, nothing more. The message
 * can still fail after that — and it does: three of the first four confirmations this store
 * ever sent were reported `failed` by the provider while every one of them looked
 * successful here, because nothing ever asked. There are no delivery webhooks, so polling
 * `GET /campaigns/{id}` is the only way to know, and this is the thing that polls it.
 *
 * A campaign that failed is treated as a failed ATTEMPT, not as a dead end: the send guard
 * is cleared so the retry sweep tries again, and only when the attempts are gone (or the
 * order is past the retry window, where no attempt is coming) is the phone-call flag raised.
 * A provider that is merely down should not send the order team to the phone.
 *
 * @returns {{ checked: number, delivered: number, failed: number, flagged: number }}
 */
const sweepConfirmationDeliveries = async () => {
    const whatsappService = require('./whatsappService');
    const now = Date.now();
    const retryDeadline = new Date(now - WHATSAPP_RETRY_WINDOW_HOURS * 60 * 60 * 1000);

    const candidates = await Order.find({
        whatsapp_campaign_id: { $ne: null },
        whatsapp_delivered_at: null,
        'customer_confirmation.status': 'pending',
        // A week is long past the point where anything can be done about a message; polling
        // older campaigns forever would grow into a standing bill against the provider.
        created_at: { $gte: new Date(now - 7 * 24 * 60 * 60 * 1000) },
    }).limit(50);

    let delivered = 0;
    let failed = 0;
    let flagged = 0;

    for (const order of candidates) {
        let report;
        try {
            report = await whatsappService.getCampaignStatus(order.whatsapp_campaign_id);
        } catch (err) {
            // The provider being unreachable says nothing about the message. Record the
            // check and move on, rather than punishing the order for our own outage.
            console.error(`[WhatsApp] Could not poll campaign ${order.whatsapp_campaign_id}: ${err.message}`);
            await Order.updateOne({ _id: order._id }, { $set: { whatsapp_delivery_checked_at: new Date() } });
            continue;
        }
        // Not configured — every later poll would say the same thing, so stop the sweep
        // instead of walking the whole list to learn it fifty times.
        if (report?.skipped) break;

        const checkedAt = new Date();
        const state = report.status || null;

        if (Number(report.delivered) > 0) {
            delivered += 1;
            await Order.updateOne(
                { _id: order._id },
                {
                    $set: {
                        whatsapp_delivered_at: checkedAt,
                        whatsapp_delivery_status: state,
                        whatsapp_delivery_checked_at: checkedAt,
                    },
                    $push: {
                        history: {
                            action: 'whatsapp_confirmation_delivered',
                            title: 'WhatsApp confirmation delivered',
                            details: report.read > 0
                                ? 'The customer received and read the confirmation.'
                                : 'The customer received the confirmation.',
                            actor_role: 'system',
                            actor_label: 'System',
                            metadata: { campaign_id: order.whatsapp_campaign_id, read: report.read || 0 },
                            created_at: checkedAt,
                        },
                    },
                }
            );
            continue;
        }

        // A settled campaign that delivered nothing, or one still stuck in the queue long
        // after any retry could help. Both mean the same thing to the customer: it never
        // arrived.
        const settledFailure = state === 'failed' || Number(report.failed) > 0;
        const stuckTooLong = order.created_at <= retryDeadline;
        if (!settledFailure && !stuckTooLong) {
            await Order.updateOne(
                { _id: order._id },
                { $set: { whatsapp_delivery_status: state, whatsapp_delivery_checked_at: checkedAt } }
            );
            continue;
        }

        failed += 1;
        const beyondRetries = order.created_at <= retryDeadline;
        const reason = settledFailure
            ? `EverySecond reported the message as failed (campaign ${order.whatsapp_campaign_id})`
            : `EverySecond never delivered the message (campaign ${order.whatsapp_campaign_id}, still "${state}")`;

        await Order.updateOne(
            { _id: order._id },
            {
                $set: {
                    whatsapp_delivery_status: state,
                    whatsapp_delivery_checked_at: checkedAt,
                    // Clear the once-per-order send guard so the retry sweep may try again.
                    // Pointless past the retry window, but harmless, and leaving a campaign
                    // id behind would have this poll re-examine a campaign already judged.
                    whatsapp_confirmation_sent_at: null,
                    whatsapp_campaign_id: null,
                },
            }
        );
        order.whatsapp_confirmation_sent_at = null;

        await recordConfirmationFailure(order, reason, { final: beyondRetries });
        if (order.customer_confirmation?.status === 'needs_call') flagged += 1;
    }

    return { checked: candidates.length, delivered, failed, flagged };
};

/** The outcomes a person can record after ringing the customer. */
const CALL_OUTCOMES = ['confirmed', 'no_answer', 'refused'];

/**
 * Record what happened on the phone.
 *
 * Deliberately does nothing to the order beyond the record itself — not even on `refused`.
 * By the time anyone rings, a vendor may already have packed the parcel and a courier may
 * be booked, so cancelling is a decision with money attached and it stays the admin's to
 * make explicitly.
 */
const recordCustomerConfirmationCall = async (orderId, { outcome, note = '', actor = {} }) => {
    if (!CALL_OUTCOMES.includes(outcome)) {
        throw new Error(`Unknown call outcome "${outcome}"`);
    }

    const order = await Order.findById(orderId);
    if (!order) throw new Error('Order not found');

    const now = new Date();
    const label = actor.label || 'Admin';
    const attempts = Number(order.customer_confirmation?.call_attempts || 0) + 1;
    const text = String(note || '').trim().slice(0, 1000);

    const TITLES = {
        confirmed: 'Customer confirmed by phone',
        no_answer: 'No answer on the phone',
        refused: 'Customer refused the order',
    };

    order.customer_confirmation = {
        ...(order.customer_confirmation?.toObject?.() || order.customer_confirmation || {}),
        status: outcome,
        call_attempts: attempts,
        resolved_at: now,
        resolved_by: label,
        note: text || null,
    };

    order.history = order.history || [];
    order.history.push({
        action: `customer_confirmation_${outcome}`,
        title: TITLES[outcome],
        details: text
            ? `${TITLES[outcome]} (call ${attempts}): ${text}`
            : `${TITLES[outcome]} (call ${attempts}).`,
        actor_role: actor.role || 'admin',
        actor_label: label,
        metadata: { outcome, call_attempts: attempts, note: text || null },
        created_at: now,
    });

    await order.save();
    return order;
};

/**
 * Retained name for the status-change call sites (vendor approval, admin status
 * change, item edits). Same function: those points are now a free retry when
 * the send at placement failed, and no-op otherwise thanks to the guard.
 */
const sendProcessingConfirmation = sendOrderConfirmation;

/**
 * Cancel an order that has parcels.
 *
 * Cancels every parcel that has NOT been delivered, each through the normal per-parcel path
 * so it terminates its own Bosta delivery, releases its label, refunds its own frozen share
 * and returns its own points. Delivered parcels are untouched: the customer is holding
 * those goods, and taking them back is a return, not a cancellation.
 *
 * The order therefore ends up `cancelled` when nothing was delivered, and
 * `partially_cancelled` when something was.
 */
const cancelWholeOrder = async (order, actor = {}) => {
    const subOrderFlow = require('./subOrderFlowService');

    const targets = (order.sub_orders || []).filter(
        (s) => s.status !== 'cancelled' && s.status !== 'delivered'
    );
    if (targets.length === 0) {
        throw new Error(
            'Every parcel on this order is already delivered or cancelled. Use a return for delivered parcels.'
        );
    }

    const cancelled = [];
    const failures = [];
    for (const sub of targets) {
        try {
            // The window check is skipped deliberately: an admin cancelling the whole order
            // is exercising authority the vendor and customer do not have, and a booked
            // pickup is a phone call to Bosta rather than a reason to refuse.
            const result = await subOrderFlow.cancelSubOrder({
                orderId: order._id,
                subOrderId: sub._id,
                reason: 'The whole order was cancelled',
                actor,
                byRole: actor.role || 'admin',
                skipWindowCheck: true,
            });
            cancelled.push({
                sub_order_id: sub._id.toString(),
                refunded: result.refunded,
                stranded_tracking: result.stranded_tracking,
            });
        } catch (err) {
            failures.push({ sub_order_id: sub._id.toString(), message: err.message });
            console.error(`[Order] Could not cancel parcel ${sub._id}: ${err.message}`);
        }
    }

    // Re-read: each per-parcel cancellation saved the document, so the copy loaded here is
    // stale by now.
    const fresh = await Order.findById(order._id);
    appendHistory(
        fresh,
        'order_cancelled',
        failures.length ? 'Order partially cancelled' : 'Order cancelled',
        `${cancelled.length} parcel(s) cancelled` +
        (failures.length ? `; ${failures.length} could not be cancelled` : '') +
        `. Delivered parcels were left in place.`,
        { cancelled: cancelled.length, failed: failures.length },
        actor
    );
    subOrderService.syncOrderStatus(fresh, actor.label || 'Admin');
    await fresh.save();

    if (failures.length > 0) {
        throw Object.assign(
            new Error(
                `Cancelled ${cancelled.length} parcel(s), but ${failures.length} failed: ` +
                failures.map((f) => f.message).join('; ')
            ),
            { partial: true, cancelled, failures }
        );
    }

    return fresh;
};

/**
 * Reverse a cancellation across the whole order.
 *
 * The mirror of `cancelWholeOrder`: every cancelled parcel goes back through the normal
 * per-parcel reactivation, so each one re-charges its own refund, takes back its own
 * points and retires its own dead Bosta delivery. Parcels that were never cancelled are
 * untouched. A parcel that cannot be reinstated (the customer already spent the refund)
 * is reported, and the others still come back — the admin sees exactly which one needs a
 * phone call.
 */
const reactivateWholeOrder = async (orderId, { reason, actor = {} } = {}) => {
    const subOrderFlow = require('./subOrderFlowService');
    const order = await Order.findById(orderId);
    if (!order) throw new Error('Order not found');
    if (!Array.isArray(order.sub_orders) || order.sub_orders.length === 0) {
        throw new Error('This order has no parcels. Only orders with parcels can be reactivated.');
    }
    if (!String(reason || '').trim()) throw new Error('A written reason is required to reactivate an order');

    const targets = order.sub_orders.filter((s) => s.status === 'cancelled');
    if (targets.length === 0) throw new Error('No parcel on this order is cancelled.');

    const reactivated = [];
    const failures = [];
    for (const sub of targets) {
        try {
            const result = await subOrderFlow.reactivateSubOrder({
                orderId: order._id,
                subOrderId: sub._id,
                reason,
                actor,
            });
            reactivated.push({
                sub_order_id: sub._id.toString(),
                reference: sub.reference,
                restored_status: result.restored_status,
                recharged: result.recharged,
                points_reconsumed: result.points_reconsumed,
                stranded_tracking: result.stranded_tracking,
            });
        } catch (err) {
            failures.push({ sub_order_id: sub._id.toString(), reference: sub.reference, code: err.code, message: err.message });
            console.error(`[Order] Could not reactivate parcel ${sub._id}: ${err.message}`);
        }
    }

    // Re-read: each per-parcel reactivation saved the document.
    const fresh = await Order.findById(order._id);
    appendHistory(
        fresh,
        'order_reactivated',
        failures.length ? 'Order partially reactivated' : 'Order reactivated',
        `${reactivated.length} parcel(s) reinstated` +
        (failures.length ? `; ${failures.length} could not be reinstated` : '') +
        `. Reason: ${String(reason).trim()}`,
        { reactivated: reactivated.length, failed: failures.length, reason: String(reason).trim() },
        actor
    );
    subOrderService.syncOrderStatus(fresh, actor.label || 'Admin');
    await fresh.save();

    return { order: fresh, reactivated, failures };
};

/**
 * Admin overrides order status.
 */
const updateOrderStatus = async (orderId, newStatus, actor = {}) => {
    const valid = ['pending', 'processing', 'confirmed', 'ready', 'cancelled'];
    if (!valid.includes(newStatus)) {
        throw new Error('Invalid order status');
    }

    const order = await Order.findById(orderId);
    if (!order) throw new Error('Order not found');

    const oldStatus = order.status;

    // With sub-orders the order's status is DERIVED, so setting it directly would just be
    // overwritten by the next parcel event. Cancellation is the one order-level verb left,
    // and it is really a loop over the parcels — see `onOrderCancelled`.
    if (Array.isArray(order.sub_orders) && order.sub_orders.length > 0 && newStatus !== 'cancelled') {
        throw new Error(
            "This order's status is worked out from its parcels. Act on the parcel you mean — " +
            'confirm it, send it to Bosta, or cancel it — and the order will follow.'
        );
    }

    // Cancelling an order with parcels is a loop over those parcels, not a flag on the
    // order: each one terminates its own Bosta delivery and refunds its own frozen share.
    // A parcel already in the customer's hands is left alone — they have the goods, and a
    // return is the honest route back.
    if (newStatus === 'cancelled' && Array.isArray(order.sub_orders) && order.sub_orders.length > 0) {
        return cancelWholeOrder(order, actor);
    }

    // Legacy orders (never migrated) keep the old rule: once anything is with Bosta, Bosta
    // owns the status.
    const dispatched = (order.shipments || []).some((s) => s.bosta_tracking_number) ||
        isBostaDrivenStatus(oldStatus);
    if (dispatched && newStatus !== 'cancelled') {
        throw new Error(
            'This order has been dispatched to Bosta. Its status is now controlled by Bosta delivery tracking and cannot be changed manually.'
        );
    }
    order.status = newStatus;
    if (newStatus === 'completed' && !order.delivered_at) {
        order.delivered_at = new Date();
    }
    if (oldStatus !== newStatus) {
        appendHistory(
            order,
            'order_status_changed',
            'Order status changed',
            `Order status changed from ${oldStatus} to ${newStatus}.`,
            { from: oldStatus, to: newStatus },
            actor
        );
    }
    await order.save();
    if (newStatus === 'processing' && oldStatus !== 'processing') {
        await sendProcessingConfirmation(order);
    }
    if (newStatus === 'completed' && oldStatus !== 'completed') {
        await onOrderCompleted(order);
    }
    if (newStatus === 'cancelled' && oldStatus !== 'cancelled') {
        await onOrderCancelled(order, actor);
    }
    return order;
};

/**
 * Delivery hook — the order earned its points, held for the return window.
 *
 * Idempotent by design: "delivered" reaches us from a Bosta webhook, the
 * 20-minute polling sweep, and an admin status change, frequently all three
 * for the same order.
 */
const onOrderCompleted = async (order) => {
    try {
        await loyaltyService.createPendingEarn({ order });
    } catch (err) {
        // Loyalty must never block a delivery from being recorded.
        console.error(`[Loyalty] Pending earn failed for order ${order?._id}: ${err.message}`);
    }
};

/**
 * One parcel reached the customer.
 *
 * This is where a vendor's money starts clearing and where that parcel's return window
 * opens — both counted from THIS delivery, not from whenever the slowest vendor on the
 * order eventually arrives. A vendor delivering on Monday is no longer paid on Friday
 * because someone else was late.
 *
 * Loyalty stays order-level: there is one loyalty snapshot on the order, so the points are
 * earned once, when the last parcel lands.
 *
 * Idempotent throughout — "delivered" reaches us from a Bosta webhook, the polling sweep,
 * and an admin override, frequently all three for the same parcel.
 */
const onSubOrderDelivered = async (order, subOrder) => {
    try {
        const vendorEarningsService = require('./vendorEarningsService');
        await vendorEarningsService.ensureEarningForSubOrder(order, subOrder);
    } catch (err) {
        console.error(`[Earnings] Failed for parcel ${subOrder?._id}: ${err.message}`);
    }

    // The loyalty earn is taken once every live parcel has stopped moving — arrived or
    // came back. It is deliberately not "every parcel delivered": an order where two
    // parcels landed and a third went back to the vendor still earned on the two the
    // customer received, and waiting for a delivery that is never coming would mean
    // earning nothing at all on it. `createPendingEarn` decides the amount from the
    // parcels that actually arrived, and refuses while anything is still in motion.
    try {
        const live = (order.sub_orders || []).filter(subOrderService.isLive);
        const settled = live.every((s) => s.status === 'delivered' || s.status === 'returned');
        if (live.length > 0 && settled) {
            await onOrderCompleted(order);
        }
    } catch (err) {
        console.error(`[Loyalty] Order completion check failed for ${order?._id}: ${err.message}`);
    }

    // The vendor's public "orders completed" number. Recomputed rather than incremented,
    // so a redelivery or a later return converges instead of double-counting. Never allowed
    // to throw: a reputation figure must not be the reason a delivery fails to record.
    try {
        const vendorStatsService = require('./vendorStatsService');
        if (subOrder?.vendor_id) await vendorStatsService.recomputeCompletedOrders(subOrder.vendor_id);
    } catch (err) {
        console.error(`[VendorStats] Completed-order recount failed for parcel ${subOrder?._id}: ${err.message}`);
    }
};

/**
 * Cancellation hook — the loyalty ledger is put back the way it was.
 *
 * Both directions, because a cancelled order can owe points in either:
 * points the customer SPENT on it come back to them (cash on delivery can be
 * cancelled long after the points were consumed, and this is what keeps a
 * cancelled order from quietly eating a balance), and points the order EARNED
 * are taken away again.
 */
const onOrderCancelled = async (order, actor = {}) => {
    // Money first. A cancelled order will never ship, so anything the customer
    // paid from their wallet goes straight back — no return request, no admin
    // step, no waiting. Keyed on the order, so cancelling twice refunds once.
    try {
        const paidFromWallet = order.transaction?.payment_method === 'wallet'
            && order.transaction?.status === 'paid';
        const paidAmount = Number(order.transaction?.amount || 0);

        if (paidFromWallet && paidAmount > 0) {
            const { duplicate } = await walletService.refundOrder({
                userId: order.paid_by_user_id || order.user_id,
                amountMinor: walletService.toMinor(paidAmount),
                orderId: order._id,
                reason: 'Order cancelled',
                idempotencyKey: `order:${order._id}:wallet-refund-cancel`,
                actor,
            });

            if (!duplicate) {
                await Order.updateOne(
                    { _id: order._id },
                    {
                        $set: { 'transaction.status': 'refunded' },
                        $push: {
                            history: {
                                action: 'wallet_refunded',
                                title: 'Refunded to wallet',
                                details: `${paidAmount.toFixed(2)} returned to the customer's wallet after cancellation.`,
                                actor_role: actor.role || 'system',
                                actor_label: actor.label || 'System',
                                metadata: { amount: paidAmount },
                                created_at: new Date(),
                            },
                        },
                    }
                );

                const { notifyCustomer } = require('./customerNotificationService');
                notifyCustomer(order.paid_by_user_id || order.user_id, 'wallet_order_refunded', {
                    title_en: 'Order cancelled — money returned to your wallet',
                    title_ar: 'تم إلغاء الطلب — تمت إعادة المبلغ إلى محفظتك',
                    message_en: `Your order was cancelled and ${paidAmount.toFixed(2)} has been returned to your wallet. It is ready to use right away.`,
                    message_ar: `تم إلغاء طلبك وتمت إعادة ${paidAmount.toFixed(2)} إلى محفظتك، وهي جاهزة للاستخدام فوراً.`,
                }, { link: '/profile?tab=wallet', data: { amount: paidAmount, order_id: order._id } });
            }
        }
    } catch (err) {
        // Never let a refund failure block the cancellation itself — the order
        // must still be cancelled, and the money is recoverable by support.
        console.error(`[Wallet] Refund on cancellation failed for order ${order?._id}: ${err.message}`);
    }

    // A cancelled order will never ship, so any label held for it goes back. The label
    // itself is untouched — it gets peeled off the parcel and used on the next one.
    try {
        const smartLabelService = require('./smartLabelService');
        const released = await smartLabelService.releaseReservations(order, {
            reason: 'order cancelled',
            actor,
        });
        if (released > 0) await order.save();
    } catch (err) {
        console.error(`[Smart Label] Release on cancellation failed for order ${order?._id}: ${err.message}`);
    }

    // Points the order EARNED go back the other way. A cancellation can land
    // after delivery, and the earn is then already sitting in the customer's
    // pending balance waiting out the return window — leaving it there would
    // show points for an order that no longer exists, and the daily sweep would
    // not look at it until the window closed. Reverse it now instead.
    try {
        await loyaltyService.reverseOutstandingEarn({
            order,
            reason: 'Order cancelled',
            idempotencyKey: `order:${order._id}:earn-reverse-cancel`,
        });
    } catch (err) {
        console.error(`[Loyalty] Earn reversal on cancellation failed for order ${order?._id}: ${err.message}`);
    }

    try {
        const spent = Number(order.loyalty?.redeemed_points || 0);
        const alreadyRestored = Number(order.loyalty?.restored_points || 0);
        const outstanding = spent - alreadyRestored;
        if (outstanding <= 0) return;

        const restored = await loyaltyService.restorePoints({
            userId: order.loyalty?.payer_user_id || order.user_id,
            points: outstanding,
            orderId: order._id,
            reason: 'Order cancelled',
            idempotencyKey: `order:${order._id}:redeem-restore-cancel`,
        });
        if (!restored) return;

        await Order.updateOne(
            { _id: order._id },
            {
                $inc: { 'loyalty.restored_points': outstanding },
                $push: {
                    history: {
                        action: 'loyalty_points_restored',
                        title: 'Loyalty points returned',
                        details: `${outstanding} point${outstanding === 1 ? '' : 's'} returned after cancellation.`,
                        actor_role: actor.role || 'system',
                        actor_label: actor.label || 'System',
                        metadata: { points: outstanding },
                        created_at: new Date(),
                    },
                },
            }
        );
    } catch (err) {
        console.error(`[Loyalty] Restore on cancellation failed for order ${order?._id}: ${err.message}`);
    }
};

/**
 * Admin updates individual item statuses/notes.
 */
const updateOrderItems = async (orderId, itemUpdates, actor = {}, fulfillmentLocations = null) => {
    const order = await Order.findById(orderId);
    if (!order) throw new Error('Order not found');

    for (const update of itemUpdates || []) {
        const item = order.items.id(update.itemId);
        if (item) {
            const oldStatus = item.vendor_status;
            const oldNote = item.vendor_note || '';

            if (update.status) item.vendor_status = update.status;
            if (update.note !== undefined) item.vendor_note = update.note;

            if (oldStatus !== item.vendor_status || oldNote !== (item.vendor_note || '')) {
                appendHistory(
                    order,
                    'item_review_changed',
                    'Item review changed',
                    `${getItemTitle(item)} changed from ${oldStatus} to ${item.vendor_status}.`,
                    {
                        item_id: item._id.toString(),
                        product_title: getItemTitle(item),
                        status_from: oldStatus,
                        status_to: item.vendor_status,
                        note_from: oldNote,
                        note_to: item.vendor_note || '',
                    },
                    actor
                );
            }
        }
    }

    // Update fulfillment locations if provided
    if (fulfillmentLocations && Array.isArray(fulfillmentLocations)) {
        for (const loc of fulfillmentLocations) {
            const vs = order.vendor_supervisions.find(
                (v) => v.vendor_id.toString() === loc.vendor_id
            );
            if (vs && loc.fulfillment_location !== undefined) {
                vs.fulfillment_location = loc.fulfillment_location;
            }
        }
    }

    // Auto-mark vendor_supervisions as "supervised" when all their items are reviewed (not pending)
    for (const vs of order.vendor_supervisions || []) {
        const vendorItems = order.items.filter(
            (item) => item.vendor_id && item.vendor_id.toString() === vs.vendor_id.toString()
        );
        const allReviewed = vendorItems.length > 0 && vendorItems.every(
            (item) => item.vendor_status !== 'pending'
        );
        if (allReviewed && vs.status === 'pending') {
            vs.status = 'supervised';
            appendHistory(
                order,
                'vendor_supervision_completed',
                'Vendor supervision completed (by admin)',
                `All items for vendor reviewed by admin.`,
                { vendor_id: vs.vendor_id.toString() },
                actor
            );
        }
    }

    autoAdvanceToProcessing(order, actor);
    await releaseLabelsWithNothingToShip(order, actor);

    await order.save();
    await sendProcessingConfirmation(order);
    return order;
};

/**
 * Lock order for fulfillment.
 */
const lockOrderForFulfillment = async (orderId, actor = {}) => {
    const order = await Order.findById(orderId);
    if (!order) throw new Error('Order not found');

    if (order.status !== 'pending') {
        throw new Error(`Order can only be locked from pending status. Current status is ${order.status}`);
    }

    if (!order.items || order.items.length === 0) {
        throw new Error('Order has no items to fulfill');
    }

    const pendingItems = order.items.filter(item => item.vendor_status === 'pending');
    if (pendingItems.length > 0) {
        throw new Error('Cannot lock order while items are still pending review');
    }

    const declinedItems = order.items.filter(item => item.vendor_status === 'declined');
    if (declinedItems.length > 0) {
        throw new Error('Cannot lock order while items are declined. Replace or approve the declined items first.');
    }

    for (const sup of order.vendor_supervisions || []) {
        sup.status = 'supervised';
    }

    order.status = 'processing';
    appendHistory(
        order,
        'order_locked',
        'Order locked for fulfillment',
        'Vendor supervision was marked as complete and the order moved to processing.',
        {},
        actor
    );
    await order.save();
    await sendProcessingConfirmation(order);
    return order;
};

/**
 * Admin replaces a single order item with another product.
 */
const replaceOrderItem = async (orderId, itemId, replacementData, actor = {}) => {
    const order = await Order.findById(orderId);
    if (!order) throw new Error('Order not found');

    // Once the first parcel is with Bosta the money split is fixed — a COD is live and the
    // figures were shown to the customer before they paid — so the contents can no longer
    // change. Cancelling a parcel is still available.
    const blocked = subOrderService.editBlockedReason(order);
    if (blocked) throw new Error(blocked);

    const item = order.items.id(itemId);
    if (!item) throw new Error('Order item not found');
    if (item.is_bundle_member) throw new Error('Bundle items cannot be individually replaced. Remove the bundle instead.');

    const product = await Product.findById(replacementData.product_id).populate('vendor_id');
    if (!product) throw new Error('Replacement product not found');
    if (product.status !== 'published') throw new Error('Replacement product must be published');
    if (product.vendor_id?.status === 'suspended') throw new Error('Replacement product vendor is suspended');

    const oldSnapshot = await getItemHistorySnapshot(item);
    const variant = buildVariantSnapshot(product, replacementData.variant_id);
    const quantity = Number(replacementData.quantity || item.quantity || 1);
    const unitPrice = replacementData.unit_price !== undefined && replacementData.unit_price !== ''
        ? Number(replacementData.unit_price)
        : Number(variant.price);

    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('Invalid replacement unit price');
    if (!Number.isFinite(quantity) || quantity < 1) throw new Error('Invalid replacement quantity');

    const vendorId = product.vendor_id?._id || product.vendor_id;
    const previousVendorId = item.vendor_id?.toString();
    const previousSubOrderId = item.sub_order_id;

    item.product_id = product._id;
    item.product_title = product.title_en || product.title_ar || 'Unknown';
    item.product_image = getPrimaryImageUrl(product);
    item.variant_id = variant.variant_id;
    item.variant_label = replacementData.variant_label || variant.variant_label;
    item.quantity = quantity;
    item.unit_price = unitPrice;
    item.vendor_id = vendorId;
    item.vendor_status = 'pending';
    item.vendor_note = replacementData.reason ? `Replacement reason: ${replacementData.reason}` : undefined;

    // A replacement sourced from a DIFFERENT vendor is a different parcel: it will be
    // collected from another branch, on another day, by another courier. So the line leaves
    // its old parcel and joins — or opens — the new vendor's, starting at stage 1 there.
    let movedToSubOrder = null;
    if (Array.isArray(order.sub_orders) && order.sub_orders.length > 0) {
        if (previousVendorId !== vendorId.toString()) {
            const newVendor = await Seller.findById(vendorId).select('locations store_name').lean();
            const location = newVendor?.locations?.find(l => l.is_default)?.address
                || newVendor?.locations?.[0]?.address
                || '';
            movedToSubOrder = subOrderService.attachItemToSubOrder(order, item, {
                vendorId,
                location,
                actor,
            });
        } else {
            // Same vendor: the line stays on its parcel, but that parcel now holds something
            // unreviewed, so it goes back to the vendor for confirmation.
            const sameSub = subOrderService.findSubOrder(order, previousSubOrderId);
            if (sameSub && sameSub.status !== 'cancelled' && !subOrderService.isDispatched(sameSub)) {
                sameSub.status = 'pending_review';
                subOrderService.appendSubHistory(
                    sameSub, 'item_replaced', 'Item replaced',
                    `${item.product_title} replaced the unavailable item and needs your confirmation.`,
                    { item_id: item._id.toString() }, actor
                );
            }
        }
    }

    const shippingBefore = Number(order.shipping?.total_cost || 0);
    await recalculateOrderTotals(order);
    const shippingAfter = Number(order.shipping?.total_cost || 0);

    // The parcel the line came from may now be free of declined items, in which case the
    // intervention that parked it is over.
    clearInterventionIfResolved(order, previousSubOrderId, actor);

    const newSnapshot = await getItemHistorySnapshot(item, product, product.vendor_id);
    appendHistory(
        order,
        'item_replaced',
        'Order item replaced',
        `${oldSnapshot.product_title} was replaced with ${newSnapshot.product_title}.`,
        {
            reason: replacementData.reason || '',
            old_item: oldSnapshot,
            new_item: newSnapshot,
            price_difference: (newSnapshot.unit_price * newSnapshot.quantity) - (oldSnapshot.unit_price * oldSnapshot.quantity),
            shipping_difference: Number((shippingAfter - shippingBefore).toFixed(2)),
        },
        actor
    );

    subOrderService.syncOrderStatus(order, actor.label || 'Admin');
    await order.save();
    return order;
};

/**
 * A parcel parked for admin intervention is released the moment nothing on it is still
 * declined — whether the admin replaced the item, moved it to another vendor, or removed it.
 * Mutates in memory; the caller saves.
 */
const clearInterventionIfResolved = (order, subOrderId, actor = {}) => {
    if (!subOrderId) return;
    const sub = subOrderService.findSubOrder(order, subOrderId);
    if (!sub || sub.status !== 'needs_admin') return;

    const items = subOrderService.subOrderItems(order, sub);
    if (items.length === 0) {
        // Nothing left to ship. The parcel is not cancelled here — that would move money
        // without the admin saying so — but it stops claiming to need a decision.
        sub.needs_admin_reason = 'Every item was removed from this parcel. Cancel it to close it off.';
        return;
    }
    if (items.some((i) => i.vendor_status === 'declined')) return;

    sub.status = 'pending_review';
    sub.needs_admin_reason = '';
    sub.needs_admin_since = null;
    subOrderService.appendSubHistory(
        sub, 'intervention_resolved', 'Returned to the vendor',
        'The unavailable items were dealt with; this parcel is back with its vendor.',
        {}, actor
    );
};

/**
 * Admin deletes a single declined order item.
 */
const deleteOrderItem = async (orderId, itemId, actor = {}) => {
    const order = await Order.findById(orderId);
    if (!order) throw new Error('Order not found');

    const blocked = subOrderService.editBlockedReason(order);
    if (blocked) throw new Error(blocked);

    // Legacy orders without parcels keep the original dispatch guard.
    const dispatched = (order.shipments || []).some((s) => s.bosta_tracking_number) ||
        isBostaDrivenStatus(order.status);
    if (dispatched) {
        throw new Error('This order has been dispatched to Bosta and its items can no longer be changed.');
    }

    const item = order.items.id(itemId);
    if (!item) throw new Error('Order item not found');
    if (item.vendor_status !== 'declined') {
        throw new Error('Only declined items can be deleted. Replace the item instead.');
    }

    const snapshot = await getItemHistorySnapshot(item);
    const vendorId = item.vendor_id ? item.vendor_id.toString() : null;
    const ownerSubOrderId = item.sub_order_id;

    item.deleteOne();

    // Drop the vendor supervision if this vendor no longer has any items on the order.
    if (vendorId) {
        const vendorStillHasItems = order.items.some(
            (it) => it.vendor_id && it.vendor_id.toString() === vendorId
        );
        if (!vendorStillHasItems) {
            const vs = (order.vendor_supervisions || []).find(
                (s) => s.vendor_id.toString() === vendorId
            );
            if (vs) vs.deleteOne();
        }
    }

    const shippingBefore = Number(order.shipping?.total_cost || 0);
    await recalculateOrderTotals(order);
    const shippingAfter = Number(order.shipping?.total_cost || 0);

    appendHistory(
        order,
        'item_deleted',
        'Order item deleted',
        `${snapshot.product_title} was removed from the order.`,
        {
            deleted_item: snapshot,
            shipping_difference: Number((shippingAfter - shippingBefore).toFixed(2)),
        },
        actor
    );

    clearInterventionIfResolved(order, ownerSubOrderId, actor);
    autoAdvanceToProcessing(order, actor);
    await releaseLabelsWithNothingToShip(order, actor);
    subOrderService.syncOrderStatus(order, actor.label || 'Admin');

    await order.save();
    await sendProcessingConfirmation(order);
    return order;
};

/**
 * Delete order.
 */
/**
 * Try to cancel every courier shipment on an order. Done BEFORE the order is deleted,
 * because the shipment ids live on it. Never throws: each parcel reports its own outcome
 * so the admin sees exactly which ones the courier refused (a parcel already in the
 * courier's warehouse cannot be cancelled by API — Bosta refuses it).
 */
const cancelCourierShipments = async (order) => {
    const couriers = require('./couriers');
    const bostaService = require('./bostaService');
    const results = [];
    for (const s of order.shipments || []) {
        const provider = s.provider || 'bosta';
        const id = s.provider_shipment_id || s.bosta_delivery_id || null;
        const tracking = s.tracking_number || s.bosta_tracking_number || null;
        if (!id && !tracking) continue;
        const row = { provider, tracking_number: tracking, result: '', message: '' };
        if (!couriers.capabilities(provider).cancelApi) {
            row.result = 'unsupported';
            row.message = `${couriers.labelOf(provider)} has no cancellation API`;
        } else {
            try {
                await bostaService.terminateDelivery(id || tracking);
                row.result = 'cancelled';
            } catch (err) {
                row.result = 'failed';
                row.message = err.message || 'Cancellation refused';
            }
        }
        results.push(row);
    }
    return results;
};

const deleteOrder = async (orderId, { cancelAtCourier = false } = {}) => {
    const existing = await Order.findById(orderId).lean();
    if (!existing) throw new Error('Order not found');

    // An order's money outlives the order document unless it is taken down with it. Left
    // behind, a delivered order's earning kept counting as owed to its vendor — on the admin
    // finance screen, in vendor balances and payouts — for an order nobody could open
    // (Sep 2026: 4.25 EGP "overdue" to a vendor that no longer existed). Money already PAID
    // to the vendor cannot be quietly erased, so that case is refused outright.
    const { VendorEarning } = require('../models/vendorEarnings');
    const earnings = await VendorEarning.find({ order_id: existing._id }).lean();
    const paidOut = earnings.filter((e) => e.payout_id || e.paid_at);
    if (paidOut.length) {
        throw new Error(
            `This order cannot be deleted: its vendor has already been paid for it (${paidOut.length} parcel(s)). ` +
            'Cancel or return it instead, so the payment is reversed on the books.'
        );
    }

    const courierResults = cancelAtCourier ? await cancelCourierShipments(existing) : [];

    const order = await Order.findByIdAndDelete(orderId);
    if (!order) throw new Error('Order not found');
    order.courier_results = courierResults;

    if (earnings.length) {
        try {
            await VendorEarning.deleteMany({ order_id: existing._id, payout_id: null, paid_at: null });
            const { recomputeWalletBalances } = require('./vendorEarningsService');
            for (const vendorId of new Set(earnings.map((e) => String(e.vendor_id)))) {
                await recomputeWalletBalances(vendorId);
            }
        } catch (err) {
            console.error(`[Earnings] Cleanup after deleting order ${orderId} failed: ${err.message}`);
        }
    }

    // Points the order earned and the customer has not lost yet go with it.
    try {
        await loyaltyService.reverseOutstandingEarn({ order: existing, reason: 'Order deleted' });
    } catch (err) {
        console.error(`[Loyalty] Reversal after deleting order ${orderId} failed: ${err.message}`);
    }
    // The order is gone, so any label reserved against it would be locked to nothing —
    // released here because there is no longer an order to record the release on.
    try {
        const { SmartLabel } = require('../models/smartLabels');
        await SmartLabel.deleteMany({ order_id: orderId, status: 'reserved' });
    } catch (err) {
        console.error(`[Smart Label] Cleanup after deleting order ${orderId} failed: ${err.message}`);
    }
    return order;
};

/**
 * Vendors list for filter dropdown.
 */
const getVendorsForFilter = async () => {
    return Seller.find({ status: 'active' })
        .select('_id store_name store_username')
        .sort({ store_name: 1 })
        .lean();
};

module.exports = {
    placeOrder,
    getPricedOrderPreview,
    buildPricedOrderItems,
    getAllOrders,
    getOrderById,
    updateOrderStatus,
    updateOrderItems,
    replaceOrderItem,
    deleteOrderItem,
    lockOrderForFulfillment,
    autoAdvanceToProcessing,
    sendOrderConfirmation,
    sendProcessingConfirmation,
    sweepUnconfirmedOrders,
    sweepConfirmationDeliveries,
    recordCustomerConfirmationCall,
    CALL_OUTCOMES,
    WHATSAPP_MAX_ATTEMPTS,
    onOrderCompleted,
    onSubOrderDelivered,
    onOrderCancelled,
    cancelWholeOrder,
    reactivateWholeOrder,
    clearInterventionIfResolved,
    deleteOrder,
    getVendorsForFilter,
};
