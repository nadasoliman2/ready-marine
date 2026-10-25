const mongoose = require('mongoose');

const { User } = require('../models/users');
const { Family, FamilyMembership } = require('../models/families');
const { FamilyOrderRequest } = require('../models/familyOrderRequests');
const { SiteSettings } = require('../models/site_settings');
const { Bundle } = require('../models/bundles');
const { recordAuditLog } = require('../models/auditLog');
const {
    getPricedOrderPreview,
    buildPricedOrderItems,
    placeOrder,
} = require('./orderService');
const shippingEngine = require('./shippingEngine');
const { notifyCustomer } = require('./customerNotificationService');
const {
    sendFamilyRequestReceivedEmail,
    sendFamilyRequestDeclinedEmail,
} = require('./emailService');
const { resolveFamilyContext, relationshipLabel, familyError } = require('./familyService');
const {
    claimConversion: claimConversionOnce,
    discardLosingOrder,
} = require('./shared/conversionGuard');
const { resolveSharedAddress } = require('./shared/addressAuthorization');
const walletService = require('./walletService');

/* ------------------------------------------------------------------ */
/* Config + helpers                                                    */
/* ------------------------------------------------------------------ */

const getRequestTtlHours = () => {
    const value = Number(process.env.FAMILY_REQUEST_EXPIRY_HOURS);
    return Number.isFinite(value) && value > 0 ? value : 48;
};

const buildExpiry = () => new Date(Date.now() + getRequestTtlHours() * 60 * 60 * 1000);

const round2 = (value) => Number((Number(value) || 0).toFixed(2));

const getCurrency = async () => {
    try {
        const settings = await SiteSettings.findOne().select('currency').lean();
        return settings?.currency || 'QAR';
    } catch (err) {
        return 'QAR';
    }
};

const getFrontendUrl = () => (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

const requestUrl = (requestId) => `${getFrontendUrl()}/family/requests/${requestId}`;

const userLanguage = (user) => (user?.preferred_language === 'ar' ? 'ar' : 'en');

/** Request line → the payload shape `buildPricedOrderItems` understands. */
const toPricingItem = (item) => (item.bundle_id && !item.product_id)
    ? { bundle_id: item.bundle_id, quantity: item.quantity }
    : { product_id: item.product_id, variant_id: item.variant_id || null, quantity: item.quantity };

const DECLINE_REASONS = ['too_expensive', 'wrong_products', 'wrong_address', 'order_later', 'other'];

const DECLINE_REASON_LABELS = {
    too_expensive: { en: 'Too expensive', ar: 'السعر مرتفع' },
    wrong_products: { en: 'Wrong products', ar: 'منتجات غير صحيحة' },
    wrong_address: { en: 'Wrong address', ar: 'عنوان غير صحيح' },
    order_later: { en: 'I will order later', ar: 'سأطلبها لاحقاً' },
    other: { en: 'Other', ar: 'سبب آخر' },
};

/* ------------------------------------------------------------------ */
/* Authorization                                                       */
/* ------------------------------------------------------------------ */

/**
 * Load a request the caller is genuinely party to, and say which side they are.
 * Membership is re-resolved on every call, so a removed member immediately
 * loses access even to a request they created.
 */
const loadRequestForUser = async (userId, requestId) => {
    if (!mongoose.Types.ObjectId.isValid(requestId)) {
        throw familyError('REQUEST_NOT_FOUND', 'Order request not found', 404);
    }

    const request = await FamilyOrderRequest.findById(requestId);
    if (!request) throw familyError('REQUEST_NOT_FOUND', 'Order request not found', 404);

    const isOrganizer = request.organizer_user_id.toString() === userId.toString();
    const isRequester = request.requester_user_id.toString() === userId.toString();
    if (!isOrganizer && !isRequester) {
        throw familyError('REQUEST_NOT_FOUND', 'Order request not found', 404);
    }

    return { request, role: isOrganizer ? 'organizer' : 'member' };
};

/**
 * Resolve one of the ORGANIZER's addresses, enforcing both ownership and (for a
 * member-driven flow) the per-member sharing permission. Never trust an address
 * id that arrives from the client without this check.
 */
const resolveOrganizerAddress = async (organizerUserId, addressId, { membership = null } = {}) => {
    // The organizer paying for their own request needs ownership only; a member
    // selecting an address additionally needs it to be shared with them.
    const owner = await User.findById(organizerUserId).select('addresses');
    const permitted = membership
        ? new Set(membership.shared_address_ids.map(String))
        : new Set((owner?.addresses || []).map((a) => a._id.toString()));

    const { owner: organizer, address } = await resolveSharedAddress(organizerUserId, addressId, permitted);
    return { organizer, address };
};

/* ------------------------------------------------------------------ */
/* Pricing + change detection                                          */
/* ------------------------------------------------------------------ */

/**
 * Re-price a request against LIVE catalogue data.
 *
 * Each line is priced on its own first so a single unavailable product marks
 * only itself unavailable instead of failing the whole request; the surviving
 * lines are then priced together so coupon and shipping math stay correct.
 */
const repriceRequest = async ({ request, organizerUserId, addressId, shippingMethodId, couponCode }) => {
    const lines = [];
    for (const item of request.items) {
        if (item.removed_at_approval) continue;
        try {
            const [priced] = await buildPricedOrderItems([toPricingItem(item)]);
            lines.push({
                item,
                available: true,
                current_unit_price: round2(priced.unit_price),
                current_title: priced.product_title,
                current_image: priced.product_image,
                current_variant_label: priced.variant_label,
            });
        } catch (err) {
            lines.push({
                item,
                available: false,
                unavailable_reason: err.message,
                current_unit_price: null,
            });
        }
    }

    const availableLines = lines.filter((l) => l.available);
    const { organizer, address } = await resolveOrganizerAddress(organizerUserId, addressId);

    const destination = {
        country: address.shipping_country || request.shipping_destination?.country || null,
        city: address.shipping_city || request.shipping_destination?.city || null,
    };

    let quote = null;
    let selectedMethod = null;
    let preview = null;
    let shippingAvailable = true;

    if (availableLines.length > 0) {
        const pricingItems = availableLines.map((l) => toPricingItem(l.item));

        if (destination.country) {
            quote = await shippingEngine.getQuoteForDestination({
                items: pricingItems,
                destination,
                useCache: true,
            });
            const methods = quote?.available_methods || [];
            selectedMethod = methods.find((m) => String(m.id) === String(shippingMethodId))
                // Fall back to the cheapest still-offered method when the requested
                // one disappeared, and surface it as a change.
                || methods.reduce((min, m) => (min && Number(min.total_cost) <= Number(m.total_cost) ? min : m), null);
            shippingAvailable = !!selectedMethod;
        }

        preview = await getPricedOrderPreview({
            userId: organizerUserId,
            items: pricingItems,
            couponCode: couponCode || '',
            shippingDestination: selectedMethod ? destination : null,
            shippingMethodId: selectedMethod ? selectedMethod.id : null,
        }).catch(() => null);
    }

    // A coupon entered by the member is re-validated against the ORGANIZER, who
    // is the paying customer — ownership and usage limits can differ.
    const couponApplied = !!preview?.couponResult;
    const currentSubtotal = round2(preview?.subtotal || 0);
    const currentDiscount = round2(preview?.discountAmount || 0);
    const currentShipping = round2(selectedMethod ? Number(selectedMethod.total_cost || 0) : 0);
    const currentTotal = round2(Math.max(0, currentSubtotal - currentDiscount) + currentShipping);

    const changes = [];
    for (const line of lines) {
        if (!line.available) {
            changes.push({
                type: 'item_unavailable',
                item_id: line.item._id,
                title: line.item.product_title_snapshot,
                detail: line.unavailable_reason,
            });
            continue;
        }
        const requested = round2(line.item.estimated_unit_price);
        if (Math.abs(requested - line.current_unit_price) > 0.009) {
            changes.push({
                type: 'price_changed',
                item_id: line.item._id,
                title: line.item.product_title_snapshot,
                requested,
                current: line.current_unit_price,
            });
        }
    }

    if (couponCode && !couponApplied) {
        changes.push({ type: 'coupon_invalid', requested: couponCode });
    }
    if (!shippingAvailable && availableLines.length > 0) {
        changes.push({ type: 'shipping_unavailable' });
    } else if (selectedMethod && String(selectedMethod.id) !== String(shippingMethodId)) {
        changes.push({
            type: 'shipping_method_changed',
            requested: request.shipping_method_snapshot?.name || '',
            current: selectedMethod.name,
        });
    } else if (Math.abs(round2(request.estimated_shipping) - currentShipping) > 0.009) {
        changes.push({
            type: 'shipping_cost_changed',
            requested: round2(request.estimated_shipping),
            current: currentShipping,
        });
    }

    if (Math.abs(round2(request.estimated_total) - currentTotal) > 0.009) {
        changes.push({
            type: 'total_changed',
            requested: round2(request.estimated_total),
            current: currentTotal,
        });
    }

    return {
        organizer,
        address,
        destination,
        lines,
        available_lines: availableLines,
        quote,
        selected_method: selectedMethod,
        shipping_available: shippingAvailable,
        coupon_applied: couponApplied,
        current: {
            subtotal: currentSubtotal,
            discount: currentDiscount,
            shipping: currentShipping,
            total: currentTotal,
        },
        changes,
        // Every material change must be acknowledged before payment is enabled.
        has_material_changes: changes.length > 0,
        // A request with nothing purchasable left can only be declined.
        purchasable: availableLines.length > 0 && shippingAvailable,
    };
};

/* ------------------------------------------------------------------ */
/* Serialization                                                       */
/* ------------------------------------------------------------------ */

const serializeRequest = (request, { organizer = null, requester = null } = {}) => ({
    _id: request._id,
    status: request.status,
    family_id: request.family_id,
    organizer: organizer ? {
        _id: organizer._id,
        name: organizer.name,
        profile_image: organizer.profile_image || null,
    } : null,
    requester: requester ? {
        _id: requester._id,
        name: requester.name,
        profile_image: requester.profile_image || null,
    } : null,
    items: request.items.map((item) => ({
        _id: item._id,
        product_id: item.product_id,
        variant_id: item.variant_id,
        bundle_id: item.bundle_id,
        quantity: item.quantity,
        title: item.product_title_snapshot,
        image: item.product_image_snapshot,
        variant_label: item.variant_label_snapshot,
        estimated_unit_price: item.estimated_unit_price,
        removed_at_approval: !!item.removed_at_approval,
    })),
    shipping_address: request.shipping_address_snapshot,
    organizer_address_id: request.organizer_address_id,
    shipping_destination: request.shipping_destination,
    shipping_method_id: request.shipping_method_id,
    shipping_method: request.shipping_method_snapshot,
    coupon_code: request.coupon_code || '',
    estimated_subtotal: request.estimated_subtotal,
    estimated_discount: request.estimated_discount,
    estimated_shipping: request.estimated_shipping,
    estimated_total: request.estimated_total,
    member_note: request.member_note || '',
    decline_reason: request.decline_reason || '',
    decline_note: request.decline_note || '',
    converted_order_id: request.converted_order_id || null,
    expires_at: request.expires_at,
    approved_at: request.approved_at,
    declined_at: request.declined_at,
    withdrawn_at: request.withdrawn_at,
    created_at: request.created_at,
});

/* ------------------------------------------------------------------ */
/* Journey 3 — member submits a request                                */
/* ------------------------------------------------------------------ */

/**
 * Create a durable family order request from a member's checkout selection.
 *
 * Deliberately does NOT create an Order, OrderPayment, vendor supervision,
 * shipment, or earnings record — only an approval object. Every amount is
 * recomputed server-side; the client's totals are ignored entirely.
 */
const submitOrderRequest = async (memberUserId, payload = {}) => {
    const { membership, family, role } = await resolveFamilyContext(memberUserId);
    if (!family || role !== 'member') {
        throw familyError('NOT_FAMILY_MEMBER', 'You are not part of a family', 403);
    }

    const items = Array.isArray(payload.items) ? payload.items : [];
    if (items.length === 0) {
        throw familyError('EMPTY_REQUEST', 'A request must contain at least one item', 400);
    }

    const { organizer, address } = await resolveOrganizerAddress(
        family.organizer_user_id,
        payload.organizer_address_id,
        { membership }
    );

    // Server-authoritative snapshots, built one source line at a time. Pricing a
    // whole cart at once would not work here: a bundle line expands into several
    // priced items, so a positional map back onto `items` would desync.
    const requestItems = [];
    for (const source of items) {
        const bundleId = source.bundle_id || source.bundle?._id || null;
        const productId = source.product_id || source.product?._id || null;
        const priced = await buildPricedOrderItems([source]);

        if (bundleId && !productId) {
            const quantity = Math.max(1, Number(source.quantity) || 1);
            const groupTotal = priced.reduce((sum, line) => sum + line.unit_price * line.quantity, 0);
            const bundle = await Bundle.findById(bundleId).select('title_en title_ar images').lean();
            const primaryImage = (bundle?.images || []).find((img) => img.is_primary) || bundle?.images?.[0];
            requestItems.push({
                product_id: null,
                variant_id: null,
                bundle_id: bundleId,
                quantity,
                product_title_snapshot: bundle?.title_en || bundle?.title_ar || priced[0]?.bundle_title || 'Bundle',
                product_image_snapshot: primaryImage?.url || priced[0]?.product_image || '',
                variant_label_snapshot: '',
                // Price per bundle, not per expanded member line.
                estimated_unit_price: round2(groupTotal / quantity),
            });
            continue;
        }

        const line = priced[0];
        requestItems.push({
            product_id: line.product_id,
            variant_id: line.variant_id,
            bundle_id: null,
            quantity: line.quantity,
            product_title_snapshot: line.product_title,
            product_image_snapshot: line.product_image,
            variant_label_snapshot: line.variant_label || '',
            estimated_unit_price: round2(line.unit_price),
        });
    }

    const destination = {
        country: address.shipping_country || payload.shipping_destination?.country || null,
        city: address.shipping_city || payload.shipping_destination?.city || null,
    };

    let selectedMethod = null;
    if (destination.country) {
        const quote = await shippingEngine.getQuoteForDestination({
            items,
            destination,
            useCache: true,
        });
        const methods = quote?.available_methods || [];
        selectedMethod = methods.find((m) => String(m.id) === String(payload.shipping_method_id)) || null;
        if (!selectedMethod && methods.length > 0) {
            throw familyError('SHIPPING_METHOD_INVALID', 'Please choose an available shipping method', 400);
        }
    }

    const preview = await getPricedOrderPreview({
        // Coupon eligibility is evaluated for the member here only as an
        // estimate; it is re-checked against the organizer before payment.
        userId: memberUserId,
        items,
        couponCode: payload.coupon_code || '',
        shippingDestination: selectedMethod ? destination : null,
        shippingMethodId: selectedMethod ? selectedMethod.id : null,
    });

    const request = await FamilyOrderRequest.create({
        family_id: family._id,
        organizer_user_id: organizer._id,
        requester_user_id: memberUserId,
        items: requestItems,
        organizer_address_id: address._id,
        shipping_address_snapshot: {
            recipient_name: address.recipient_name,
            phone: address.phone,
            full_address: address.full_address,
            label: address.label || '',
        },
        shipping_destination: destination,
        shipping_method_id: selectedMethod ? selectedMethod.id : null,
        shipping_method_snapshot: selectedMethod ? {
            id: selectedMethod.id,
            name: selectedMethod.name,
            name_ar: selectedMethod.name_ar || '',
            total_cost: Number(selectedMethod.total_cost || 0),
        } : null,
        coupon_code: payload.coupon_code || '',
        estimated_subtotal: round2(preview.subtotal),
        estimated_discount: round2(preview.discountAmount),
        estimated_shipping: round2(selectedMethod ? selectedMethod.total_cost : 0),
        estimated_total: round2(preview.total),
        member_note: String(payload.member_note || '').slice(0, 200),
        status: 'pending_approval',
        expires_at: buildExpiry(),
    });

    // Only after the durable record exists do we touch the member's cart.
    if (payload.checkout_source !== 'buy_now') {
        await removeRequestedItemsFromCart(memberUserId, items);
    }

    await notifyOrganizerOfNewRequest(request, organizer, memberUserId);

    return { request: serializeRequest(request) };
};

/** Remove only the submitted lines from the member's own cart. */
const removeRequestedItemsFromCart = async (userId, items = []) => {
    const productKeys = new Set();
    const bundleIds = new Set();
    for (const item of items) {
        const bundleId = item.bundle_id || item.bundle?._id;
        const productId = item.product_id || item.product?._id;
        if (bundleId && !productId) {
            bundleIds.add(String(bundleId));
            continue;
        }
        if (!productId) continue;
        const variantId = item.variant_id || item.variant?._id || '';
        productKeys.add(`${String(productId)}:${variantId ? String(variantId) : ''}`);
    }
    if (productKeys.size === 0 && bundleIds.size === 0) return;

    const user = await User.findById(userId).select('cart');
    if (!user?.cart?.items) return;

    user.cart.items = user.cart.items.filter((line) => {
        if (line.bundle_id) return !bundleIds.has(line.bundle_id.toString());
        const key = `${line.product_id?.toString()}:${line.variant_id ? line.variant_id.toString() : ''}`;
        return !productKeys.has(key);
    });
    user.cart.updated_at = new Date();
    await user.save();
};

const notifyOrganizerOfNewRequest = async (request, organizer, memberUserId) => {
    const [requester, currency] = await Promise.all([
        User.findById(memberUserId).select('name'),
        getCurrency(),
    ]);
    const itemCount = request.items.length;

    await notifyCustomer(
        organizer._id,
        'family_order_request_received',
        {
            title_en: 'New order request',
            title_ar: 'طلب شراء جديد',
            message_en: `${requester?.name || 'A family member'} sent an order request with ${itemCount} item${itemCount === 1 ? '' : 's'}, estimated ${currency} ${request.estimated_total.toFixed(2)}.`,
            message_ar: `أرسل ${requester?.name || 'أحد أفراد العائلة'} طلب شراء يحتوي على ${itemCount} منتج بإجمالي تقديري ${currency} ${request.estimated_total.toFixed(2)}.`,
        },
        { link: `/family/requests/${request._id}`, data: { request_id: request._id } }
    );

    try {
        await sendFamilyRequestReceivedEmail({
            to: organizer.email,
            organizerName: organizer.name,
            requesterName: requester?.name || 'A family member',
            itemCount,
            estimatedTotal: request.estimated_total,
            currency,
            requestUrl: requestUrl(request._id),
            language: userLanguage(organizer),
        });
    } catch (err) {
        console.error('[Family] request email failed:', err.message);
    }
};

/* ------------------------------------------------------------------ */
/* Listing + detail                                                    */
/* ------------------------------------------------------------------ */

/** Requests visible to the caller, split by the side they are on. */
const listRequestsForUser = async (userId, { status } = {}) => {
    const filter = {
        $or: [{ organizer_user_id: userId }, { requester_user_id: userId }],
    };
    if (status) filter.status = status;

    const requests = await FamilyOrderRequest.find(filter).sort({ created_at: -1 }).limit(100);

    const userIds = new Set();
    requests.forEach((r) => {
        userIds.add(r.organizer_user_id.toString());
        userIds.add(r.requester_user_id.toString());
    });
    const users = await User.find({ _id: { $in: [...userIds] } }).select('name profile_image');
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const serialized = requests.map((r) => ({
        ...serializeRequest(r, {
            organizer: userMap.get(r.organizer_user_id.toString()),
            requester: userMap.get(r.requester_user_id.toString()),
        }),
        viewer_role: r.organizer_user_id.toString() === userId.toString() ? 'organizer' : 'member',
    }));

    return {
        incoming: serialized.filter((r) => r.viewer_role === 'organizer'),
        outgoing: serialized.filter((r) => r.viewer_role === 'member'),
    };
};

/**
 * Request detail. For the organizer this also re-prices against live data so
 * the review screen can show requested-versus-current before approval.
 */
const getRequestDetail = async (userId, requestId) => {
    const { request, role } = await loadRequestForUser(userId, requestId);

    const [organizer, requester, currency] = await Promise.all([
        User.findById(request.organizer_user_id).select('name profile_image'),
        User.findById(request.requester_user_id).select('name profile_image'),
        getCurrency(),
    ]);

    const membership = await FamilyMembership.findOne({
        family_id: request.family_id,
        user_id: request.requester_user_id,
    });

    const payload = {
        request: serializeRequest(request, { organizer, requester }),
        viewer_role: role,
        relationship: membership?.relationship || 'other',
        currency,
    };

    // Once converted, BOTH sides get read-only order + shipment tracking. Only
    // the organizer can act on it financially — that is enforced by the
    // existing order/return/refund routes, which are keyed on `user_id`.
    if (request.converted_order_id) {
        payload.order = await buildTrackableOrderSummary(request.converted_order_id);
    }

    const needsReprice = role === 'organizer'
        && ['pending_approval', 'approved_payment_needed'].includes(request.status);

    if (needsReprice) {
        try {
            payload.revalidation = await buildRevalidationPayload(request);
        } catch (err) {
            payload.revalidation = { error: err.message, code: err.code || 'REVALIDATION_FAILED' };
        }

        // The organizer chooses how to pay right here on the approval screen,
        // so the same two facts the checkout screen needs travel with it: what
        // is on offer, and whether their own balance covers this total.
        payload.payment_methods = await walletService.getAvailablePaymentMethods();
        payload.wallet = (await walletService.isWalletEnabled())
            ? await (async () => {
                const check = await walletService.evaluateOrderPayment({
                    userId: request.organizer_user_id,
                    total: Number(payload.revalidation?.current?.total || 0),
                });
                return {
                    enabled: true,
                    available: check.available,
                    shortfall: check.shortfall,
                    sufficient: check.sufficient,
                    status: check.status,
                    currency: check.currency,
                };
            })()
            : { enabled: false };
    }

    return payload;
};

/**
 * Read-only view of the resulting order, safe for the requesting member.
 * Deliberately omits payment, commission, vendor, and earnings detail — the
 * member can track the order but performs no financial action on it.
 */
const buildTrackableOrderSummary = async (orderId) => {
    const { Order } = require('../models/orders');
    const order = await Order.findById(orderId).lean();
    if (!order) return null;

    return {
        _id: order._id,
        reference: order.transaction?.reference || order._id.toString(),
        status: order.status,
        created_at: order.created_at,
        delivered_at: order.delivered_at || null,
        total_price: order.total_price,
        // Recipient + city only — never the full address in a shared view.
        delivery_summary: {
            recipient_name: order.shipping_address?.recipient_name || '',
            city: order.shipping?.destination?.city || null,
            country: order.shipping?.destination?.country || null,
        },
        items: (order.items || []).map((item) => ({
            product_title: item.product_title,
            product_image: item.product_image,
            variant_label: item.variant_label,
            quantity: item.quantity,
            unit_price: item.unit_price,
            return_status: item.return_status,
        })),
        shipments: (order.shipments || []).map((s) => ({
            provider: s.provider || 'bosta',
            tracking_number: s.tracking_number || s.bosta_tracking_number,
            bosta_tracking_number: s.bosta_tracking_number,
            bosta_status: s.bosta_status,
            tracking_history: s.tracking_history || [],
        })),
    };
};

/** Shape the reprice result for the UI, without leaking internals. */
const buildRevalidationPayload = async (request, overrides = {}) => {
    const result = await repriceRequest({
        request,
        organizerUserId: request.organizer_user_id,
        addressId: overrides.address_id || request.organizer_address_id,
        shippingMethodId: overrides.shipping_method_id || request.shipping_method_id,
        couponCode: request.coupon_code,
    });

    const organizer = result.organizer;
    // Members can only ever be offered addresses still shared with them; the
    // organizer sees all of their own.
    const addresses = (organizer.addresses || []).map((a) => ({
        _id: a._id,
        label: a.label || '',
        recipient_name: a.recipient_name,
        phone: a.phone,
        full_address: a.full_address,
        shipping_country: a.shipping_country || null,
        shipping_city: a.shipping_city || null,
        is_default: !!a.is_default,
    }));

    return {
        address: {
            _id: result.address._id,
            label: result.address.label || '',
            recipient_name: result.address.recipient_name,
            phone: result.address.phone,
            full_address: result.address.full_address,
        },
        available_addresses: addresses,
        destination: result.destination,
        available_methods: result.quote?.available_methods || [],
        selected_method: result.selected_method,
        shipping_available: result.shipping_available,
        coupon_applied: result.coupon_applied,
        items: result.lines.map((line) => ({
            item_id: line.item._id,
            title: line.item.product_title_snapshot,
            image: line.item.product_image_snapshot,
            variant_label: line.item.variant_label_snapshot,
            quantity: line.item.quantity,
            requested_unit_price: round2(line.item.estimated_unit_price),
            current_unit_price: line.current_unit_price,
            available: line.available,
            unavailable_reason: line.unavailable_reason || '',
        })),
        requested: {
            subtotal: round2(request.estimated_subtotal),
            discount: round2(request.estimated_discount),
            shipping: round2(request.estimated_shipping),
            total: round2(request.estimated_total),
        },
        current: result.current,
        changes: result.changes,
        has_material_changes: result.has_material_changes,
        purchasable: result.purchasable,
    };
};

/* ------------------------------------------------------------------ */
/* Member actions                                                      */
/* ------------------------------------------------------------------ */

const withdrawRequest = async (memberUserId, requestId) => {
    const { request, role } = await loadRequestForUser(memberUserId, requestId);
    if (role !== 'member') {
        throw familyError('NOT_REQUESTER', 'Only the requester can withdraw this request', 403);
    }
    // Withdrawal is only safe before money is in flight.
    if (!['pending_approval', 'approved_payment_needed'].includes(request.status)) {
        throw familyError('REQUEST_NOT_WITHDRAWABLE', 'This request can no longer be withdrawn', 409);
    }

    request.status = 'withdrawn';
    request.withdrawn_at = new Date();
    await request.save();

    const requester = await User.findById(memberUserId).select('name');
    await notifyCustomer(
        request.organizer_user_id,
        'family_order_request_withdrawn',
        {
            title_en: 'Order request withdrawn',
            title_ar: 'تم سحب طلب الشراء',
            message_en: `${requester?.name || 'A family member'} withdrew their order request.`,
            message_ar: `قام ${requester?.name || 'أحد أفراد العائلة'} بسحب طلب الشراء.`,
        },
        { link: `/family/requests/${request._id}`, data: { request_id: request._id } }
    );

    return { request: serializeRequest(request) };
};

/* ------------------------------------------------------------------ */
/* Journey 4 — organizer reviews                                       */
/* ------------------------------------------------------------------ */

const declineRequest = async (organizerId, requestId, { reason = 'other', note = '' } = {}) => {
    const { request, role } = await loadRequestForUser(organizerId, requestId);
    if (role !== 'organizer') {
        throw familyError('NOT_ORGANIZER', 'Only the organizer can decline this request', 403);
    }
    if (!['pending_approval', 'approved_payment_needed'].includes(request.status)) {
        throw familyError('REQUEST_ALREADY_HANDLED', 'This request has already been handled', 409);
    }

    request.status = 'declined';
    request.declined_at = new Date();
    request.decline_reason = DECLINE_REASONS.includes(reason) ? reason : 'other';
    request.decline_note = String(note || '').slice(0, 300);
    await request.save();

    const [organizer, requester] = await Promise.all([
        User.findById(organizerId).select('name'),
        User.findById(request.requester_user_id).select('name email preferred_language'),
    ]);
    const memberLang = userLanguage(requester);
    const reasonLabel = DECLINE_REASON_LABELS[request.decline_reason][memberLang];

    await notifyCustomer(
        request.requester_user_id,
        'family_order_request_declined',
        {
            title_en: 'Your request was declined',
            title_ar: 'تم رفض طلبك',
            message_en: `${organizer?.name || 'Your organizer'} declined your order request. Reason: ${DECLINE_REASON_LABELS[request.decline_reason].en}.`,
            message_ar: `قام ${organizer?.name || 'مسؤول العائلة'} برفض طلب الشراء. السبب: ${DECLINE_REASON_LABELS[request.decline_reason].ar}.`,
        },
        { link: `/family/requests/${request._id}`, data: { request_id: request._id } }
    );

    if (requester?.email) {
        try {
            await sendFamilyRequestDeclinedEmail({
                to: requester.email,
                memberName: requester.name,
                organizerName: organizer?.name || 'Your family organizer',
                reasonLabel,
                note: request.decline_note,
                requestUrl: requestUrl(request._id),
                language: memberLang,
            });
        } catch (err) {
            console.error('[Family] decline email failed:', err.message);
        }
    }

    await recordAuditLog({
        action: 'family_order_request_declined',
        actor: { role: 'user', label: organizer?.name || 'Organizer' },
        target_type: 'family_order_request',
        target_id: request._id,
        target_snapshot: { requester_user_id: request.requester_user_id, estimated_total: request.estimated_total },
        impact: { reason: request.decline_reason },
    });

    return { request: serializeRequest(request) };
};

/**
 * Approve a request. This moves it to `approved_payment_needed` — it does NOT
 * create an order. Idempotent: approving twice (or in two tabs) leaves the
 * request in the same state instead of erroring or duplicating anything.
 */
const approveRequest = async (organizerId, requestId, { remove_item_ids = [], acknowledged_changes = false } = {}) => {
    const { request, role } = await loadRequestForUser(organizerId, requestId);
    if (role !== 'organizer') {
        throw familyError('NOT_ORGANIZER', 'Only the organizer can approve this request', 403);
    }

    if (request.status === 'approved_payment_needed') {
        return { request: serializeRequest(request), alreadyApproved: true };
    }
    if (request.status !== 'pending_approval') {
        throw familyError('REQUEST_ALREADY_HANDLED', 'This request has already been handled', 409);
    }
    if (request.expires_at && request.expires_at <= new Date()) {
        request.status = 'expired';
        await request.save();
        throw familyError('REQUEST_EXPIRED', 'This request expired. Ask for it to be sent again.', 410);
    }

    // Organizer may drop items that became unavailable before approving.
    const removeSet = new Set((remove_item_ids || []).map(String));
    if (removeSet.size > 0) {
        for (const item of request.items) {
            if (removeSet.has(item._id.toString())) item.removed_at_approval = true;
        }
    }
    if (request.items.every((i) => i.removed_at_approval)) {
        throw familyError('EMPTY_REQUEST', 'Nothing is left to buy. Decline the request instead.', 409);
    }

    const revalidation = await buildRevalidationPayload(request);
    if (!revalidation.purchasable) {
        throw familyError(
            'REQUEST_NOT_PURCHASABLE',
            'Some items or shipping options are no longer available. Remove them or decline the request.',
            409
        );
    }
    if (revalidation.has_material_changes && !acknowledged_changes) {
        const err = familyError(
            'CHANGES_NEED_ACKNOWLEDGEMENT',
            'Prices, availability, or shipping changed since this request was sent. Please review the changes.',
            409
        );
        err.details = { changes: revalidation.changes, current: revalidation.current };
        throw err;
    }

    request.status = 'approved_payment_needed';
    request.approved_at = new Date();
    // Extend the payment window from the approval moment.
    request.expires_at = buildExpiry();
    await request.save();

    const [organizer, requester] = await Promise.all([
        User.findById(organizerId).select('name'),
        User.findById(request.requester_user_id).select('name'),
    ]);

    await notifyCustomer(
        request.requester_user_id,
        'family_order_request_approved',
        {
            title_en: 'Request approved — payment needed',
            title_ar: 'تمت الموافقة — بانتظار الدفع',
            message_en: `${organizer?.name || 'Your organizer'} approved your request and is choosing how to pay.`,
            message_ar: `وافق ${organizer?.name || 'مسؤول العائلة'} على طلبك ويقوم الآن باختيار طريقة الدفع.`,
        },
        { link: `/family/requests/${request._id}`, data: { request_id: request._id } }
    );

    await recordAuditLog({
        action: 'family_order_request_approved',
        actor: { role: 'user', label: organizer?.name || 'Organizer' },
        target_type: 'family_order_request',
        target_id: request._id,
        target_snapshot: { requester_user_id: request.requester_user_id, requester_name: requester?.name },
        impact: { current_total: revalidation.current.total, changes: revalidation.changes.length },
    });

    return { request: serializeRequest(request), revalidation };
};

/* ------------------------------------------------------------------ */
/* Journey 5 — approval → payment → real order                         */
/* ------------------------------------------------------------------ */

/** Focused organizer checkout data, re-priced against live catalogue data. */
const getCheckoutPreview = async (organizerId, requestId, overrides = {}) => {
    const { request, role } = await loadRequestForUser(organizerId, requestId);
    if (role !== 'organizer') {
        throw familyError('NOT_ORGANIZER', 'Only the organizer can pay for this request', 403);
    }
    if (request.status === 'order_placed') {
        return { request: serializeRequest(request), already_placed: true };
    }
    if (!['approved_payment_needed', 'payment_in_progress'].includes(request.status)) {
        throw familyError('REQUEST_NOT_PAYABLE', 'This request is not ready for payment', 409);
    }

    const [requester, currency] = await Promise.all([
        User.findById(request.requester_user_id).select('name profile_image'),
        getCurrency(),
    ]);
    const membership = await FamilyMembership.findOne({
        family_id: request.family_id,
        user_id: request.requester_user_id,
    });

    const revalidation = await buildRevalidationPayload(request, overrides);

    return {
        request: serializeRequest(request, { requester }),
        revalidation,
        // The organizer chooses the route here, so the screen needs both what
        // is on offer and whether their own balance covers this total.
        payment_methods: await walletService.getAvailablePaymentMethods(),
        wallet: (await walletService.isWalletEnabled())
            ? await (async () => {
                const check = await walletService.evaluateOrderPayment({
                    userId: request.organizer_user_id,
                    total: Number(revalidation.current?.total || 0),
                });
                return {
                    enabled: true,
                    available: check.available,
                    shortfall: check.shortfall,
                    sufficient: check.sufficient,
                    status: check.status,
                    currency: check.currency,
                };
            })()
            : { enabled: false },
        requester: { name: requester?.name || '', profile_image: requester?.profile_image || null },
        relationship: membership?.relationship || 'other',
        relationship_label: {
            en: relationshipLabel(membership?.relationship, 'en'),
            ar: relationshipLabel(membership?.relationship, 'ar'),
        },
        currency,
    };
};

/**
 * Shared conversion tail: build the real order payload from the re-priced
 * request. Called by both the COD and the online-payment paths so the two can
 * never drift apart.
 */
const buildOrderPayloadFromRequest = async (request, overrides = {}) => {
    const result = await repriceRequest({
        request,
        organizerUserId: request.organizer_user_id,
        addressId: overrides.address_id || request.organizer_address_id,
        shippingMethodId: overrides.shipping_method_id || request.shipping_method_id,
        couponCode: request.coupon_code,
    });

    if (!result.purchasable) {
        throw familyError(
            'REQUEST_NOT_PURCHASABLE',
            'Some items or shipping options are no longer available. Review the request before paying.',
            409
        );
    }

    return {
        payload: {
            shipping_address: {
                recipient_name: result.address.recipient_name,
                phone: result.address.phone,
                full_address: result.address.full_address,
            },
            items: result.available_lines.map((l) => toPricingItem(l.item)),
            checkout_source: 'family_request',
            coupon_code: request.coupon_code || undefined,
            shipping_destination: result.selected_method ? result.destination : null,
            shipping_method_id: result.selected_method ? result.selected_method.id : null,
            family_id: request.family_id,
            family_order_request_id: request._id,
            requested_by_user_id: request.requester_user_id,
        },
        total: result.current.total,
        address_id: result.address._id,
        method: result.selected_method,
        destination: result.destination,
    };
};

/** Notify both sides once a family request became a real order. */
const notifyOrderPlaced = async (request, order) => {
    const [organizer, requester, currency] = await Promise.all([
        User.findById(request.organizer_user_id).select('name'),
        User.findById(request.requester_user_id).select('name'),
        getCurrency(),
    ]);
    const reference = order.transaction?.reference || order._id.toString();
    const amount = `${currency} ${Number(order.total_price || 0).toFixed(2)}`;

    await Promise.all([
        notifyCustomer(
            request.requester_user_id,
            'family_order_placed',
            {
                title_en: 'Your requested order was placed',
                title_ar: 'تم تنفيذ طلبك',
                message_en: `${organizer?.name || 'Your organizer'} placed order #${reference} (${amount}). You can track it from your family requests.`,
                message_ar: `قام ${organizer?.name || 'مسؤول العائلة'} بتنفيذ الطلب رقم ${reference} (${amount}). يمكنك متابعته من طلبات عائلتك.`,
            },
            { link: `/family/requests/${request._id}`, data: { request_id: request._id, order_id: order._id } }
        ),
        notifyCustomer(
            request.organizer_user_id,
            'family_order_placed',
            {
                title_en: 'Order placed',
                title_ar: 'تم تنفيذ الطلب',
                message_en: `Order #${reference} (${amount}) requested by ${requester?.name || 'a family member'} was placed successfully.`,
                message_ar: `تم تنفيذ الطلب رقم ${reference} (${amount}) المطلوب من ${requester?.name || 'أحد أفراد العائلة'} بنجاح.`,
            },
            { link: '/profile?tab=orders', data: { request_id: request._id, order_id: order._id } }
        ),
    ]);
};

/**
 * Mark a request converted, guarded by an atomic conditional update.
 *
 * Only the caller whose update matches (`converted_order_id: null`) wins; a
 * duplicate webhook, refresh, or double-click sees `won === false` and must
 * discard its order instead of leaving two orders behind.
 */
const claimConversion = async (requestId, orderId) => {
    const { won, document } = await claimConversionOnce(
        FamilyOrderRequest,
        requestId,
        { converted_order_id: orderId, status: 'order_placed' }
    );
    return { won, request: document };
};

/** Cash on delivery — creates the real order immediately. */
const placeCodOrder = async (organizerId, requestId, overrides = {}) => {
    const { request, role } = await loadRequestForUser(organizerId, requestId);
    if (role !== 'organizer') {
        throw familyError('NOT_ORGANIZER', 'Only the organizer can pay for this request', 403);
    }

    // Idempotency: a second click on an already-converted request returns the
    // same order rather than creating another one.
    if (request.converted_order_id) {
        return { order_id: request.converted_order_id, alreadyPlaced: true };
    }
    if (request.status !== 'approved_payment_needed') {
        throw familyError('REQUEST_NOT_PAYABLE', 'This request is not ready for payment', 409);
    }
    if (request.expires_at && request.expires_at <= new Date()) {
        request.status = 'expired';
        await request.save();
        throw familyError('REQUEST_EXPIRED', 'This request expired before payment', 410);
    }

    const { payload } = await buildOrderPayloadFromRequest(request, overrides);
    const order = await placeOrder(request.organizer_user_id, { ...payload, payment_method: 'cash' });

    const { won } = await claimConversion(request._id, order._id);
    if (!won) {
        // Another tab or retry already converted this request — undo ours so
        // the family never ends up with two real orders for one request.
        await discardLosingOrder(order._id);
        const fresh = await FamilyOrderRequest.findById(request._id);
        return { order_id: fresh.converted_order_id, alreadyPlaced: true };
    }

    const fresh = await FamilyOrderRequest.findById(request._id);
    await notifyOrderPlaced(fresh, order);
    await recordAuditLog({
        action: 'family_order_placed_cod',
        actor: { role: 'user', label: 'Organizer' },
        target_type: 'family_order_request',
        target_id: request._id,
        target_snapshot: { order_id: order._id },
        impact: { total_price: order.total_price },
    });

    return { order_id: order._id, order, request: serializeRequest(fresh) };
};

/**
 * Online/card payment — creates only a payment record and hands the organizer
 * to the hosted provider. The real order is created later, exactly once, when
 * the payment is confirmed.
 */
const createRequestPayment = async (organizerId, requestId, overrides = {}) => {
    const { request, role } = await loadRequestForUser(organizerId, requestId);
    if (role !== 'organizer') {
        throw familyError('NOT_ORGANIZER', 'Only the organizer can pay for this request', 403);
    }
    if (request.converted_order_id) {
        return { alreadyPlaced: true, order_id: request.converted_order_id };
    }
    if (!['approved_payment_needed', 'payment_in_progress'].includes(request.status)) {
        throw familyError('REQUEST_NOT_PAYABLE', 'This request is not ready for payment', 409);
    }
    if (request.expires_at && request.expires_at <= new Date()) {
        request.status = 'expired';
        await request.save();
        throw familyError('REQUEST_EXPIRED', 'This request expired before payment', 410);
    }

    const { payload } = await buildOrderPayloadFromRequest(request, overrides);

    // The organizer picks the route on the approval screen. An older client
    // sends nothing and still gets the wallet wherever it is live, which is
    // what this flow did before the gateway rejoined it.
    const walletEnabled = await walletService.isWalletEnabled();
    const requested = overrides.payment_method || (walletEnabled ? 'wallet' : 'credit_card');

    if (requested === 'wallet' && !walletEnabled) {
        throw familyError('WALLET_DISABLED', 'Wallet checkout is currently unavailable', 409);
    }

    if (requested === 'credit_card' && !(await walletService.isOnlinePaymentAllowed())) {
        throw familyError(
            'ONLINE_PAYMENT_DISABLED',
            'Online payment is unavailable right now. Please choose another payment method.',
            409
        );
    }

    // ---- Wallet path: the order exists before this call returns ----
    //
    // The hosted-invoice path below has to defer conversion until a provider
    // confirms, which is why `payment_in_progress` and the whole redirect dance
    // exist. Wallet credit settles synchronously, so this behaves like the cash
    // path instead: place, then claim.
    if (requested === 'wallet') {
        const order = await placeOrder(request.organizer_user_id, {
            ...payload,
            payment_method: 'wallet',
        });

        const { won } = await claimConversion(request._id, order._id);
        if (!won) {
            // Another tab already converted this request. Discard our duplicate
            // — and hand back what it charged, or a double click would quietly
            // cost the organizer the price of the order.
            await discardLosingOrder(order._id);
            await walletService.refundOrder({
                userId: request.organizer_user_id,
                amountMinor: walletService.toMinor(order.total_price),
                orderId: order._id,
                reason: 'Duplicate family order discarded',
                idempotencyKey: `order:${order._id}:wallet-refund-duplicate`,
            }).catch((err) =>
                console.error(`[Wallet] Duplicate family refund failed for order ${order._id}: ${err.message}`));

            const existing = await FamilyOrderRequest.findById(request._id);
            return { alreadyPlaced: true, order_id: existing.converted_order_id };
        }

        const fresh = await FamilyOrderRequest.findById(request._id);
        await notifyOrderPlaced(fresh, order);
        await recordAuditLog({
            action: 'family_order_placed_wallet',
            actor: { role: 'user', label: 'Organizer' },
            target_type: 'family_order_request',
            target_id: request._id,
            target_snapshot: { order_id: order._id },
            impact: { total_price: order.total_price },
        });

        return { mode: 'wallet', order_id: order._id, order, request: serializeRequest(fresh) };
    }

    const { createOrderPayment } = require('./orderPaymentService');
    const { payment } = await createOrderPayment({
        // The payment customer is ALWAYS the organizer.
        userId: request.organizer_user_id,
        orderData: payload,
        familyOrderRequestId: request._id,
    });

    request.status = 'payment_in_progress';
    request.payment_id = payment._id;
    await request.save();

    return { payment };
};

/**
 * Called by the payment layer once a family payment settles. Converts the
 * request exactly once; a replayed webhook simply finds it already converted.
 */
const onFamilyPaymentConverted = async (requestId, order) => {
    const { won } = await claimConversion(requestId, order._id);
    if (!won) return { converted: false };

    const fresh = await FamilyOrderRequest.findById(requestId);
    await notifyOrderPlaced(fresh, order);
    await recordAuditLog({
        action: 'family_order_placed_online',
        actor: { role: 'system', label: 'Payment provider' },
        target_type: 'family_order_request',
        target_id: requestId,
        target_snapshot: { order_id: order._id },
        impact: { total_price: order.total_price },
    });
    return { converted: true };
};

/** Payment failed or was abandoned — return the request so it can be resumed. */
const onFamilyPaymentFailed = async (requestId, reason = '') => {
    const request = await FamilyOrderRequest.findById(requestId);
    if (!request || request.converted_order_id) return;
    if (request.status !== 'payment_in_progress') return;

    request.status = 'approved_payment_needed';
    request.payment_id = null;
    await request.save();

    await notifyCustomer(
        request.organizer_user_id,
        'family_order_payment_failed',
        {
            title_en: 'Payment did not complete',
            title_ar: 'لم تكتمل عملية الدفع',
            message_en: `The payment for this family order request was not completed${reason ? `: ${reason}` : ''}. No order was created — you can resume payment.`,
            message_ar: `لم تكتمل عملية الدفع الخاصة بطلب العائلة${reason ? `: ${reason}` : ''}. لم يتم إنشاء أي طلب — يمكنك متابعة الدفع.`,
        },
        { link: `/family/requests/${request._id}`, data: { request_id: request._id } }
    );
};

/* ------------------------------------------------------------------ */
/* Lifecycle maintenance                                               */
/* ------------------------------------------------------------------ */

/**
 * Cancel every request still awaiting approval or payment for a membership
 * that just ended. Requests already converted to a real order are untouched —
 * a completed purchase outlives the relationship that produced it.
 */
const cancelOpenRequestsForMembership = async (membership) => {
    const result = await FamilyOrderRequest.updateMany(
        {
            family_id: membership.family_id,
            requester_user_id: membership.user_id,
            status: { $in: ['pending_approval', 'approved_payment_needed'] },
            converted_order_id: null,
        },
        {
            status: 'withdrawn',
            withdrawn_at: new Date(),
            updated_at: new Date(),
        }
    );
    return result.modifiedCount || 0;
};

/**
 * Cron sweep: expire requests past their window and warn about ones expiring
 * soon. Runs after the daily jobs; safe to run repeatedly.
 */
const expireStaleRequests = async () => {
    const now = new Date();
    const expiring = await FamilyOrderRequest.find({
        status: { $in: ['pending_approval', 'approved_payment_needed'] },
        converted_order_id: null,
        expires_at: { $lte: now },
    }).limit(500);

    for (const request of expiring) {
        request.status = 'expired';
        await request.save();

        await notifyCustomer(
            request.requester_user_id,
            'family_order_request_expired',
            {
                title_en: 'Order request expired',
                title_ar: 'انتهت صلاحية طلب الشراء',
                message_en: 'Your family order request expired before it was paid. You can create it again at any time.',
                message_ar: 'انتهت صلاحية طلب الشراء قبل إتمام الدفع. يمكنك إنشاؤه من جديد في أي وقت.',
            },
            { link: `/family/requests/${request._id}`, data: { request_id: request._id } }
        );
    }

    // Warn organizers about requests entering their final six hours.
    const soon = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    const expiringSoon = await FamilyOrderRequest.find({
        status: { $in: ['pending_approval', 'approved_payment_needed'] },
        converted_order_id: null,
        expires_at: { $gt: now, $lte: soon },
    }).limit(500);

    for (const request of expiringSoon) {
        await notifyCustomer(
            request.organizer_user_id,
            'family_order_request_expiring',
            {
                title_en: 'Order request expiring soon',
                title_ar: 'طلب شراء على وشك الانتهاء',
                message_en: 'A family order request is about to expire. Review it before it does.',
                message_ar: 'هناك طلب شراء عائلي على وشك انتهاء صلاحيته. يرجى مراجعته.',
            },
            { link: `/family/requests/${request._id}`, data: { request_id: request._id } }
        );
    }

    return { expired: expiring.length, warned: expiringSoon.length };
};

module.exports = {
    DECLINE_REASONS,
    submitOrderRequest,
    listRequestsForUser,
    getRequestDetail,
    withdrawRequest,
    declineRequest,
    approveRequest,
    getCheckoutPreview,
    placeCodOrder,
    createRequestPayment,
    onFamilyPaymentConverted,
    onFamilyPaymentFailed,
    cancelOpenRequestsForMembership,
    expireStaleRequests,
};
