const { Product } = require('../models/products');
const { attachProductLinks } = require('./orderItemLinks');
const { Seller } = require('../models/sellers');
const { ensurePickupLocation, deletePickupLocation, listPickupLocations, MIN_FIRST_LINE } = require('./bostaService');
const mongoose = require('mongoose');
const { normalizePartType, PART_TYPE_REQUIRED } = require('./shared/partType');
const shippingEngine = require('./shippingEngine');
const { normalizePricing } = require('./shared/productPricing');
const { normalizeProductImages } = require('./shared/productImages');

// Held to the stricter of Bosta's two rules. A pickup location alone would accept 5
// characters, but a vendor with no Bosta location falls back to sending the address as a
// delivery pickupAddress, which needs 6 — so a 5-character branch would pass every gate
// and then be undispatchable.
const MIN_LOCATION_ADDRESS = MIN_FIRST_LINE;

// Units left across all of a published product's variants below which the
// dashboard calls it "low stock". A warning the vendor can still act on: at
// zero the listing is already unbuyable and the moment to restock has passed.
const LOW_STOCK_THRESHOLD = 5;

/**
 * Validate the locations on a vendor payload before anything is written.
 *
 * A location Bosta can't accept is a vendor no courier can ever be sent to, so every route
 * that writes locations — signup, admin create/edit, the vendor's own profile — runs this.
 *
 * @throws {Error} with a message meant for the person filling the form
 */
const isKnownCity = async (name) => {
    if (!name) return false;
    const { City } = require('../models/cities');
    return !!(await City.findOne({ name }).select('_id').lean());
};

const assertVendorLocationsAreShippable = async (locations) => {
    if (!Array.isArray(locations) || locations.length === 0) return;

    const { City } = require('../models/cities');
    const known = new Set((await City.find().select('name').lean()).map((c) => c.name));

    for (const loc of locations) {
        const address = (loc.address || '').trim();
        if (!address) throw new Error('Every location needs an address.');
        if (address.length < MIN_LOCATION_ADDRESS) {
            throw new Error(`Address "${address}" is too short — Bosta needs at least ${MIN_LOCATION_ADDRESS} characters.`);
        }
        if (!loc.shipping_city) {
            throw new Error(`Location "${address}" has no city. Pick the city it ships from.`);
        }
        if (!known.has(loc.shipping_city)) {
            throw new Error(`"${loc.shipping_city}" is not a supported shipping city.`);
        }
    }
};

/**
 * Register a vendor's locations as Bosta pickup locations and persist the ids.
 *
 * A location without a Bosta id can never have a courier sent to it, so this runs at
 * signup, whenever a vendor edits their addresses, and from the reconciliation sweep that
 * catches anyone the first two missed (typically a Bosta outage at the wrong moment).
 * Persisting is done with a targeted update per location so it cannot clobber a concurrent
 * edit elsewhere on the vendor document.
 *
 * `liveLocationIds`, when given, is the set of pickup-location ids Bosta actually has. A
 * stored id missing from it is treated as unlinked and registered again. Without this an
 * id that never existed at Bosta — mistyped from the dashboard, or left behind by a
 * different Bosta account — reads as "linked" for ever: the sweep skips it on sight, and
 * the vendor only finds out when a courier is due and nothing can be booked.
 *
 * @returns {{ linked: number, relinked: number, skipped: Array<{address: string, reason: string}> }}
 */
const linkVendorLocationsToBosta = async (vendor, { liveLocationIds = null } = {}) => {
    if (!vendor?._id) return { linked: 0, skipped: [] };

    const contact = { name: vendor.name || vendor.store_name || '', phone: vendor.phone || '', store_name: vendor.store_name || '' };
    const skipped = [];
    let linked = 0;
    let relinked = 0;

    const locations = vendor.locations || [];
    for (let i = 0; i < locations.length; i++) {
        const loc = locations[i];
        // An id Bosta does not have is worse than no id: it silently passes every check
        // that only asks whether the field is set.
        const stale = !!loc.bosta_location_id
            && !!liveLocationIds
            && !liveLocationIds.has(String(loc.bosta_location_id));
        if (loc.bosta_location_id && !stale) continue;
        // Checked here rather than letting Bosta reject it: these can only be fixed by a
        // human editing the address, so re-asking Bosta every hour would be pure noise.
        if (!loc.shipping_city) {
            skipped.push({ address: loc.address, reason: 'no city set' });
            continue;
        }
        // Bosta does not reject an unknown city — it silently files the location under
        // Cairo, so an Alexandria branch with a typo'd city gets a courier sent to the
        // wrong governorate. Verified against the API. Check it before sending.
        if (!(await isKnownCity(loc.shipping_city))) {
            skipped.push({ address: loc.address, reason: `"${loc.shipping_city}" is not a Bosta city` });
            continue;
        }
        if ((loc.address || '').trim().length < MIN_LOCATION_ADDRESS) {
            skipped.push({ address: loc.address, reason: `address is under ${MIN_LOCATION_ADDRESS} characters; Bosta rejects it` });
            continue;
        }
        try {
            // Register from scratch when the stored id is a dead one. Passing it through
            // would make ensurePickupLocation try to UPDATE a location Bosta has never
            // heard of, swallow the failure, and hand the same dead id straight back.
            //
            // Rebuilt field by field rather than spread: `loc` is a Mongoose subdocument,
            // and spreading one copies its internals instead of its schema fields — the
            // address arrives empty and Bosta rejects the whole call.
            const locationId = await ensurePickupLocation(
                stale
                    ? {
                        address: loc.address,
                        shipping_city: loc.shipping_city,
                        shipping_country: loc.shipping_country,
                        is_default: loc.is_default,
                        bosta_location_id: null,
                    }
                    : loc,
                contact
            );
            if (!locationId) {
                skipped.push({ address: loc.address, reason: 'Bosta returned no location id' });
                continue;
            }
            // Address it by index, not by matching on `locations.address`. Two branches can
            // share an address string ("Cairo", "Maadi"), and the positional `$` binds to
            // the FIRST match — which overwrote branch 1's id while leaving branch 2 null,
            // so every sweep created another orphan Bosta location for the same vendor.
            const res = await Seller.updateOne(
                { _id: vendor._id, [`locations.${i}.address`]: loc.address },
                { $set: { [`locations.${i}.bosta_location_id`]: locationId } }
            );
            if (res.matchedCount === 0) {
                // The array shifted under us (a concurrent edit). Don't guess at an index —
                // leave it for the next sweep rather than stamping the wrong branch.
                skipped.push({ address: loc.address, reason: 'locations changed during sync; will retry' });
                try { await deletePickupLocation(locationId); } catch (_) {}
                continue;
            }
            const was = loc.bosta_location_id;
            loc.bosta_location_id = locationId;
            if (stale) relinked++; else linked++;
            console.log(
                stale
                    ? `[Bosta] Re-linked "${loc.address}" (${vendor.store_name || vendor.name}): dead id ${was} -> ${locationId}`
                    : `[Bosta] Linked "${loc.address}" (${vendor.store_name || vendor.name}) -> ${locationId}`
            );
        } catch (err) {
            skipped.push({ address: loc.address, reason: err.message });
            console.error(`[Bosta] Could not link "${loc.address}" (${vendor.store_name || vendor.name}): ${err.message}`);
        }
    }

    return { linked, relinked, skipped };
};

/**
 * Reconciliation sweep: link any vendor location Bosta cannot currently collect from.
 *
 * Two kinds of broken, and the second is the one that used to hide. A location with NO id
 * was never registered. A location with a DEAD id — mistyped from the Bosta dashboard, or
 * inherited from another Bosta account — looks linked to every check that only asks whether
 * the field is set, so it survived every sweep and only surfaced when a courier was due.
 * The live list from Bosta is what tells the two apart.
 *
 * Runs on a cron so an outage self-heals instead of leaving a vendor permanently unbookable.
 */
const sweepUnlinkedVendorLocations = async () => {
    // One call, reused for every vendor below.
    let liveLocationIds = null;
    try {
        const live = await listPickupLocations();
        // An empty list is not evidence that nothing is registered — it is what a bad token
        // or a changed response shape also looks like. Acting on it would declare all 91
        // locations dead and register every one of them again. Only a list with something
        // in it is allowed to condemn an id.
        if (Array.isArray(live) && live.length > 0) {
            liveLocationIds = new Set(live.map((l) => String(l._id)));
        } else {
            console.warn('[Bosta] Location sweep: Bosta returned no pickup locations; checking only unset ids this run.');
        }
    } catch (err) {
        console.warn(`[Bosta] Location sweep: could not read pickup locations (${err.message}); checking only unset ids this run.`);
    }

    // Deliberately not filtered down to the locations that *can* be linked: a branch with
    // no city is the one most in need of attention, and filtering it out here is what made
    // such vendors invisible. They come back in `problems` for someone to fix by hand.
    const vendors = liveLocationIds
        ? await Seller.find({
            locations: { $elemMatch: { bosta_location_id: { $nin: [...liveLocationIds] } } },
        })
        : await Seller.find({ 'locations.bosta_location_id': null });

    let linked = 0;
    let relinked = 0;
    const problems = [];
    for (const vendor of vendors) {
        const result = await linkVendorLocationsToBosta(vendor, { liveLocationIds });
        linked += result.linked;
        relinked += result.relinked;
        for (const s of result.skipped) {
            problems.push(`${vendor.store_name || vendor.name} / "${s.address}": ${s.reason}`);
        }
    }
    return { checked: vendors.length, linked, relinked, problems };
};


/**
 * Normalize the optional shipping attributes on a product payload:
 * empty strings -> null, numeric coercion, drop an all-null dimensions object.
 */
function normalizeShippingFields(data) {
    if (!data || typeof data !== 'object') return;
    if (data.shipping_class_id === '') data.shipping_class_id = null;
    if (data.weight === '') {
        data.weight = null;
    } else if (data.weight !== undefined && data.weight !== null) {
        const n = Number(data.weight);
        data.weight = Number.isFinite(n) && n >= 0 ? n : null;
    }
    if (data.dimensions && typeof data.dimensions === 'object') {
        let allNull = true;
        for (const k of ['length', 'width', 'height']) {
            const v = data.dimensions[k];
            if (v === '' || v === undefined || v === null) {
                data.dimensions[k] = null;
            } else {
                const n = Number(v);
                data.dimensions[k] = Number.isFinite(n) && n >= 0 ? n : null;
            }
            if (data.dimensions[k] !== null) allNull = false;
        }
        if (allNull) data.dimensions = undefined;
    }
}

/**
 * Get vendor profile
 */
const getVendorProfile = async (vendorId) => {
    const vendor = await Seller.findById(vendorId).select('-password');
    if (!vendor) throw new Error('Vendor not found');
    return vendor;
};

/**
 * Update vendor profile
 */
const updateVendorProfile = async (vendorId, updateData) => {
    const allowedFields = ['name', 'store_name', 'store_username', 'email', 'phone', 'store_image', 'locations'];
    const sanitizedData = {};
    for (const field of allowedFields) {
        if (updateData[field] !== undefined) {
            sanitizedData[field] = updateData[field];
        }
    }

    if (sanitizedData.locations && Array.isArray(sanitizedData.locations)) {
        let defaultCount = 0;
        for (const loc of sanitizedData.locations) {
            if (loc.is_default) defaultCount++;
        }
        if (sanitizedData.locations.length > 0 && defaultCount !== 1) {
            throw new Error('Exactly one location must be set as default.');
        }

        await assertVendorLocationsAreShippable(sanitizedData.locations);

        // Auto-sync vendor locations to Bosta pickup locations
        const { ensurePickupLocation, deletePickupLocation, MIN_FIRST_LINE } = require('./bostaService');
        const vendor = await Seller.findById(vendorId).select('name store_name phone email').lean();
        const vendorContact = {
            name: sanitizedData.name || vendor?.name || vendor?.store_name || "",
            phone: sanitizedData.phone || vendor?.phone || "",
            store_name: sanitizedData.store_name || vendor?.store_name || "",
        };
        for (const loc of sanitizedData.locations) {
            if (loc.shipping_city) {
                try {
                    loc.bosta_location_id = await ensurePickupLocation(loc, vendorContact);
                    console.log(`[Bosta] Synced location "${loc.address}" → ${loc.bosta_location_id}`);
                } catch (err) {
                    console.error(`[Bosta] Failed to sync location "${loc.address}" (city: ${loc.shipping_city}):`, err.message);
                }
            }
        }
    }

    if (sanitizedData.store_username) {
        sanitizedData.store_username = sanitizedData.store_username.toLowerCase().trim();
        const existing = await Seller.findOne({ store_username: sanitizedData.store_username, _id: { $ne: vendorId } });
        if (existing) throw new Error('Store username is already taken');
    }

    if (sanitizedData.email) {
        sanitizedData.email = require('./shared/emailIdentity').canonicalEmail(sanitizedData.email);
        const existing = await Seller.findOne({ email: sanitizedData.email, _id: { $ne: vendorId } });
        if (existing) throw new Error('Email is already taken');
    }

    if (sanitizedData.phone) {
        sanitizedData.phone = sanitizedData.phone.trim();
        const existing = await Seller.findOne({ phone: sanitizedData.phone, _id: { $ne: vendorId } });
        if (existing) throw new Error('Phone number is already taken');
    }

    const vendor = await Seller.findByIdAndUpdate(
        vendorId,
        { $set: sanitizedData },
        { returnDocument: "after", runValidators: true }
    ).select('-password');

    if (!vendor) throw new Error('Vendor not found');
    return vendor;
};

/**
 * Generate a unique slug
 */
const generateSlug = async (title, vendorName, lang = 'en', productId = null) => {
    if (!title) return '';
    let slug = `${title}-${vendorName}`.toLowerCase();
    if (lang === 'en') {
        slug = slug.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    } else {
        slug = slug.replace(/[^ء-ي0-9a-z]+/g, '-').replace(/^-+|-+$/g, '');
    }

    let isUnique = false;
    let uniqueSlug = slug;
    let counter = 1;

    while (!isUnique) {
        const query = lang === 'en' ? { slug_en: uniqueSlug } : { slug_ar: uniqueSlug };
        if (productId) {
            query._id = { $ne: productId };
        }
        const existing = await Product.findOne(query);
        if (!existing) {
            isUnique = true;
        } else {
            uniqueSlug = `${slug}-${counter}`;
            counter++;
        }
    }

    return uniqueSlug;
};

/**
 * Get all products for a specific vendor
 */
const getVendorProducts = async (vendorId) => {
    return await Product.find({ vendor_id: vendorId })
        .populate('category_id product_brand_id')
        .sort({ created_at: -1 });
};

const getVendorProductById = async (vendorId, productId) => {
    return await Product.findOne({ _id: productId, vendor_id: vendorId })
        .populate('category_id product_brand_id vendor_id');
};

/**
 * Helper: Cross-reference variant selected_options with variation_types
 * to populate type_id and option_id ObjectId fields.
 */
function linkVariantIds(productData) {
    productData.variation_types.forEach(vt => {
        if (!vt._id) vt._id = new mongoose.Types.ObjectId();
        (vt.options || []).forEach(opt => {
            if (!opt._id) opt._id = new mongoose.Types.ObjectId();
        });
    });

    (productData.variants || []).forEach(variant => {
        (variant.selected_options || []).forEach(so => {
            const matchedType = productData.variation_types.find(vt => vt.name === so.type_name);
            if (matchedType) {
                so.type_id = matchedType._id;
                const matchedOpt = (matchedType.options || []).find(o => o.value === so.option_value);
                if (matchedOpt) {
                    so.option_id = matchedOpt._id;
                }
            }
        });
    });
}

/**
 * Coerce the discount type/value pair and re-derive discount_price for the
 * product and its variants. Throws a vendor-facing error if the discount is
 * inconsistent (e.g. a fixed amount larger than the price).
 *
 * `existing` matters on edit: a vendor may change only the discount (validated
 * against the stored price) or only the price (the stored discount is then
 * re-derived against the new price).
 */
function applyPricing(data, existing = null) {
    const errors = normalizePricing(data, { existing });
    if (errors.length > 0) {
        const err = new Error(errors.map(e => e.message).join(' '));
        err.code = 'INVALID_DISCOUNT';
        throw err;
    }
}

/**
 * Validate required fields before publishing.
 * At least one complete language set (EN or AR) is required.
 * Throws with a descriptive error if validation fails.
 */
function validateForPublish(productData) {
    if (!normalizePartType(productData.part_type)) {
        const err = new Error(PART_TYPE_REQUIRED);
        err.code = 'INCOMPLETE_PRODUCT';
        throw err;
    }

    const hasEnglish =
        !!(productData.title_en?.trim()) &&
        !!(productData.subtitle_en?.trim()) &&
        !!(productData.description_en?.trim());

    const hasArabic =
        !!(productData.title_ar?.trim()) &&
        !!(productData.subtitle_ar?.trim()) &&
        !!(productData.description_ar?.trim());

    if (!hasEnglish && !hasArabic) {
        const err = new Error('Please fill in all required fields in at least one language (English or Arabic): title, subtitle, and description.');
        err.code = 'INCOMPLETE_PRODUCT';
        throw err;
    }

    if (!productData.price || Number(productData.price) <= 0) {
        const err = new Error('Price is required and must be greater than zero.');
        err.code = 'INCOMPLETE_PRODUCT';
        throw err;
    }

    if (!productData.category_id) {
        const err = new Error('Category is required.');
        err.code = 'INCOMPLETE_PRODUCT';
        throw err;
    }

    if (!productData.images || productData.images.length === 0) {
        const err = new Error('At least one product image is required.');
        err.code = 'INCOMPLETE_PRODUCT';
        throw err;
    }
}

/**
 * Add a new product (always goes to pending — vendor cannot publish directly)
 */
const addProduct = async (vendorId, productData) => {
    // Subscription gate: check active subscription
    const { requireActiveSubscription, requireProductLimit } = require('./vendorSubscriptionService');
    await requireActiveSubscription(vendorId);

    const vendor = await Seller.findById(vendorId);
    if (!vendor) throw new Error('Vendor not found');

    /* ---- Master catalog ----
       The entry the vendor picked in the search gate, if any. It is not a product
       field the client may set directly: it is pulled out here, validated, and
       written back only after the product saves. */
    const catalogService = require('./catalogService');
    const requestedEntryId = productData.catalog_entry_id || null;
    delete productData.catalog_entry_id;

    if (requestedEntryId) {
        // One product per (vendor + entry). Checked against the entry the link
        // will actually land on — following a merge, so a vendor who selected
        // the folded-away duplicate is still caught.
        const resolved = await catalogService.getSelectableEntry(requestedEntryId);
        const existingId = resolved
            ? await catalogService.findVendorProductOnEntry(vendorId, resolved._id)
            : null;
        if (existingId) {
            const err = new Error('You already have a product on this catalog entry.');
            err.code = 'DUPLICATE_CATALOG_PRODUCT';
            err.productId = existingId;
            throw err;
        }
    }

    // If vendor is submitting (status is set to something), validate required fields
    if (productData.status !== undefined && productData.status !== 'draft') {
        validateForPublish(productData);
        // Also check product limit
        await requireProductLimit(vendorId);

        if (vendor.auto_publish_products) {
            productData.status = 'published';
            productData.is_published = true;
        } else {
            productData.status = 'pending';
            productData.is_published = false;
        }
    } else {
        productData.status = 'draft';
        productData.is_published = false;
    }

    // Force vendor_id from auth — frontend cannot override
    productData.vendor_id = vendorId;
    productData.part_type = normalizePartType(productData.part_type);

    const vendorName = vendor.store_name || vendor.store_username;

    if (productData.title_en) {
        productData.slug_en = await generateSlug(productData.title_en, vendorName, 'en');
    }
    if (productData.title_ar) {
        productData.slug_ar = await generateSlug(productData.title_ar, vendorName, 'ar');
    }

    if (!productData.sku) productData.sku = 'SKU-' + Date.now().toString(36).toUpperCase();

    if (!productData.is_universal && (!productData.compatible_cars || productData.compatible_cars.length === 0)) {
        productData.is_universal = true;
    }

    if (productData.product_brand_id === '') productData.product_brand_id = null;

    if (productData.variation_types && productData.variants) {
        linkVariantIds(productData);
    }

    applyPricing(productData);
    normalizeShippingFields(productData);
    productData.images = normalizeProductImages(productData.images);

    const newProduct = new Product(productData);
    await newProduct.save();

    // Linked after the save, never during it: a vendor picking an entry gets that
    // link, a vendor authoring from scratch mints a suggestion for admin review —
    // and either way a catalog failure leaves the product itself intact.
    await catalogService.linkProductAfterSave(newProduct, vendorId, requestedEntryId);

    shippingEngine.invalidateShippingCache();
    return newProduct;
};

/**
 * Update an existing product (vendor must belong to the product)
 */
const updateProduct = async (vendorId, productId, updateData) => {
    // Prevent vendor reassignment or manual toggling of is_published
    delete updateData.vendor_id;
    delete updateData.is_published;
    // The catalog link is admin territory. A vendor editing a linked product may
    // change every field it pre-filled — but not what it is linked to.
    delete updateData.catalog_entry_id;

    if (updateData.product_brand_id === '') updateData.product_brand_id = null;
    // Sent by the edit form, which requires it; a product cannot be cleared back to "unknown".
    if (updateData.part_type !== undefined) {
        updateData.part_type = normalizePartType(updateData.part_type);
        if (!updateData.part_type) {
            const err = new Error(PART_TYPE_REQUIRED);
            err.code = 'INCOMPLETE_PRODUCT';
            throw err;
        }
    }

    const productBefore = await Product.findOne({ _id: productId, vendor_id: vendorId }).populate('vendor_id');
    if (!productBefore) throw new Error('Product not found or unauthorized');

    const vendorName = productBefore.vendor_id.store_name || productBefore.vendor_id.store_username;

    // Regenerate slugs on title change
    if (updateData.title_en !== undefined) {
        if (updateData.title_en && (updateData.title_en !== productBefore.title_en || !productBefore.slug_en)) {
            updateData.slug_en = await generateSlug(updateData.title_en, vendorName, 'en', productId);
        }
    } else if (!productBefore.slug_en && productBefore.title_en) {
        updateData.slug_en = await generateSlug(productBefore.title_en, vendorName, 'en', productId);
    }

    if (updateData.title_ar !== undefined) {
        if (updateData.title_ar && (updateData.title_ar !== productBefore.title_ar || !productBefore.slug_ar)) {
            updateData.slug_ar = await generateSlug(updateData.title_ar, vendorName, 'ar', productId);
        }
    } else if (!productBefore.slug_ar && productBefore.title_ar) {
        updateData.slug_ar = await generateSlug(productBefore.title_ar, vendorName, 'ar', productId);
    }

    if (updateData.variation_types && updateData.variants) {
        linkVariantIds(updateData);
    }

    updateData.images = normalizeProductImages(updateData.images);

    // findOneAndUpdate below bypasses document middleware, so the discount must
    // be derived here rather than relying on the model's pre-validate hook.
    applyPricing(updateData, productBefore);
    normalizeShippingFields(updateData);

    // ---- Publish guard: re-approval required if product was admin-approved ----
    if (updateData.status === 'published' || updateData.status === 'pending') {
        // Validate required fields before allowing publish
        const mergedData = { ...productBefore.toObject(), ...updateData };
        validateForPublish(mergedData);

        if (productBefore.vendor_id.auto_publish_products) {
            updateData.status = 'published';
            updateData.is_published = true;
        } else {
            // Always pending; admin must approve before going live
            updateData.status = 'pending';
        }
    }

    // ---- Subscription modification tracking ----
    // If product was hidden due to subscription expiry (subscription_hidden_at is set),
    // any edit means it needs re-review. This prevents auto-restoration skipping review
    // for products that were edited before re-subscription.
    if (productBefore.subscription_hidden_at && !productBefore.modified_after_subscription_restore) {
        updateData.modified_after_subscription_restore = true;
    }
    // Also flag for re-review if editing an already-approved (is_published) product
    // that was previously hidden, even if vendor just tries to re-submit for review
    if (productBefore.is_published && productBefore.subscription_hidden_at) {
        updateData.modified_after_subscription_restore = true;
    }

    const product = await Product.findOneAndUpdate(
        { _id: productId, vendor_id: vendorId },
        { $set: updateData },
        { returnDocument: 'after', runValidators: true }
    );

    shippingEngine.invalidateShippingCache();

    // Who took a product off the shop, or put it back. Recorded because nothing else does,
    // and a product that quietly went to `draft` answers "not found" on its own page.
    if (product && product.status !== productBefore.status) {
        await require('./shared/productAudit').recordProductStatusChange({
            product,
            from: productBefore.status,
            to: product.status,
            actor: {
                role: 'vendor',
                label: productBefore.vendor_id?.store_name || productBefore.vendor_id?.store_username || 'Vendor',
            },
        });
    }

    // A product that just went live (auto-publish) and has no catalog entry becomes a
    // suggestion now — the create path only did this for products born published.
    if (product?.status === 'published' && !product.catalog_entry_id) {
        await require('./catalogService').suggestProductIfEligible(product._id);
    }
    return product;
};

/**
 * Delete a product
 */
const deleteProduct = async (vendorId, productId) => {
    const product = await Product.findOneAndDelete({ _id: productId, vendor_id: vendorId });
    if (!product) throw new Error('Product not found or unauthorized');
    return product;
};

const { Order } = require('../models/orders');
const { AT_VENDOR_STATUSES, IN_TRANSIT_STATUSES } = require('./subOrderService');

const appendOrderHistory = (order, action, title, details, metadata, actor) => {
    order.history = order.history || [];
    order.history.push({
        action,
        title,
        details,
        actor_role: actor.role,
        actor_label: actor.label,
        metadata,
        created_at: new Date(),
    });
};

/* ------------------------------------------------------------------ */
/*  Sub-orders — the vendor's own parcels                             */
/* ------------------------------------------------------------------ */

/**
 * The tabs the vendor's order list is grouped by, in the order they are shown.
 *
 * Named for the ACTION each one is waiting on rather than for an internal state, because
 * the whole point of the list is to answer "what do I have to do next?" in one glance.
 */
const VENDOR_STAGE_TABS = [
    { key: 'needs_review',   label_en: 'Needs review',      label_ar: 'محتاج مراجعة',    statuses: ['pending_review'] },
    { key: 'needs_tracking', label_en: 'Needs tracking',    label_ar: 'محتاج رقم تتبع',  statuses: ['awaiting_tracking'] },
    { key: 'needs_sealing',  label_en: 'Needs sealing',     label_ar: 'محتاج تغليف',      statuses: ['awaiting_handover'] },
    // Sealed and sitting at the branch. The parcel is STILL WITH THE VENDOR here — this tab
    // is their to-do list for handing it over, not a record that it went.
    { key: 'waiting_pickup', label_en: 'Waiting for pickup', label_ar: 'بانتظار المندوب',  statuses: ['ready_for_pickup', 'pickup_scheduled'] },
    { key: 'on_the_way',     label_en: 'On the way',        label_ar: 'في الطريق',        statuses: ['handed_to_courier', 'picked_up', 'in_transit', 'out_for_delivery'] },
    { key: 'delivered',      label_en: 'Delivered',         label_ar: 'تم التسليم',       statuses: ['delivered'] },
    { key: 'blocked',        label_en: 'With the website team', label_ar: 'مع إدارة الموقع', statuses: ['needs_admin', 'exception', 'returned'] },
];

const stageTabFor = (status) =>
    VENDOR_STAGE_TABS.find((t) => t.statuses.includes(status))?.key || 'blocked';

/**
 * The parcel's status AS THE VENDOR'S OWN DECISION — separate from `status`, which describes
 * where the parcel is in the pipeline.
 *
 * The two answer different questions and a vendor needs both: `status` says "with the website
 * team", which is true but says nothing about whether that happened because they refused it;
 * this says "you refused this parcel". Derived from the item reviews on every read rather
 * than stored, so it can never drift out of sync with the decisions it summarises.
 */
const vendorReviewState = (order, sub) => {
    const subOrderService = require('./subOrderService');
    const items = subOrderService.subOrderItems(order, sub);
    const total = items.length;
    const approved = items.filter((i) => i.vendor_status === 'approved').length;
    const declined = items.filter((i) => i.vendor_status === 'declined').length;
    const pending = total - approved - declined;

    let key;
    if (total === 0) key = 'awaiting_review';
    else if (pending === total) key = 'awaiting_review';
    else if (pending > 0) key = 'in_progress';
    else if (declined === 0) key = 'accepted';
    else if (approved === 0) key = 'rejected';
    else key = 'partially_accepted';

    return { key, total, approved, declined, pending };
};

/**
 * Which of the three stages this parcel is on, and what is still missing before its button
 * unlocks. The vendor screen renders the progress bar straight from this, so the reason a
 * button is disabled is always stated rather than left to be guessed.
 */
const stageProgress = (order, sub, smartLabelEnabled, batch = null) => {
    const subOrderService = require('./subOrderService');
    const items = subOrderService.subOrderItems(order, sub);
    const reviewed = items.filter((i) => i.vendor_status !== 'pending').length;
    const declined = items.filter((i) => i.vendor_status === 'declined').length;
    const photos = (sub.parcel_photos || []).length;
    // A company-batch rider is wherever its combined parcel is.
    const status = subOrderService.effectiveStatus(sub);

    const stageIndex =
        status === 'pending_review' || status === 'needs_admin' ? 1
        : status === 'awaiting_tracking' ? 2
        : status === 'awaiting_handover' ? 3
        // Stage 4 is the handover the vendor still owes; anything past it is stage 5, done.
        : ['ready_for_pickup', 'pickup_scheduled'].includes(status) ? 4
        : 5;

    let blockedReason = null;
    if (stageIndex === 1 && reviewed < items.length) {
        blockedReason = `${items.length - reviewed} item(s) still need a decision`;
    } else if (stageIndex === 1 && declined > 0) {
        blockedReason = 'Unavailable items — the website team will take it from here';
    } else if (sub.company_batch?.role === 'rider' && stageIndex >= 2) {
        // Nothing to do on this order past its confirmation: it ships inside the lead. Not a
        // block — said as `rides_in_lead`, which the screens word as information. As a
        // "blocked" warning it stayed on the order after the box had left, and read as an
        // order refusing to be handed over.
    } else if (stageIndex === 2 && sub.company_batch?.role === 'lead' && batch && batch.confirmed_count < batch.order_count) {
        blockedReason = `${batch.order_count - batch.confirmed_count} of the ${batch.order_count} orders in this combined parcel still need to be confirmed`;
    } else if (stageIndex === 2 && smartLabelEnabled && !(sub.tracking_number || sub.bosta_tracking_number)) {
        // Either one unlocks the button; the sticker is optional when a waybill exists and
        // the waybill is optional when a sticker does. Only having neither blocks.
        blockedReason = 'A Smart Sticker or a waybill (بوليصة) must exist on this parcel — scan the sticker, or create the shipment and print its waybill';
    }
    // Stage 3 no longer has a blocker. Photos used to be one; they are optional now, so a
    // sealed parcel with no camera to hand is not held back from being offered for pickup.

    return {
        stage: stageIndex,
        items_total: items.length,
        items_reviewed: reviewed,
        items_declined: declined,
        photo_count: photos,
        // What stage ② asks of the vendor. Once a shipment exists — Bosta minted the number,
        // whether at the end of stage ① or because the vendor chose the printed route — the
        // only thing left is to print it, whatever the Smart Label setting says.
        tracking_mode: (sub.tracking_number || sub.bosta_tracking_number) || !smartLabelEnabled ? 'print_awb' : 'scan_label',
        // A sticker can still be scanned onto a shipment that exists but carries none —
        // the printed route, or a first sticker Bosta refused. Bosta parcels only.
        can_scan_label: smartLabelEnabled
            && (sub.courier || 'bosta') === 'bosta'
            && !sub.smart_label_barcode
            // A rider carries the combined parcel's sticker, never one of its own.
            && sub.company_batch?.role !== 'rider',
        // The combined parcel this order is packed inside, once confirmed (feature 14).
        rides_in_lead: sub.company_batch?.role === 'rider' && stageIndex >= 2
            ? (sub.company_batch.lead_reference || '')
            : null,
        blocked_reason: blockedReason,
        can_advance: !blockedReason,
    };
};

/**
 * The courier appointment for a set of parcels, keyed by sub-order id.
 *
 * Read from BostaPickup rather than copied onto the parcel when it was booked, because the
 * appointment MOVES — an admin reschedules, Bosta cancels a visit — and a copy taken at
 * booking time would go on showing a vendor a day the courier is no longer coming.
 *
 * Batched: the parcel list would otherwise issue one query per parcel.
 */
const pickupsForSubs = async (subs = []) => {
    const { BostaPickup } = require('../models/bostaPickups');
    const ids = [...new Set(subs.filter((s) => s.pickup_id).map((s) => String(s.pickup_id)))];
    if (ids.length === 0) return new Map();

    const docs = await BostaPickup.find({ _id: { $in: ids } })
        .select('scheduled_date scheduled_time_slot status location_address bosta_pickup_id')
        .lean()
        .catch(() => []);
    const byId = new Map(docs.map((d) => [String(d._id), d]));

    const out = new Map();
    for (const sub of subs) {
        const doc = sub.pickup_id ? byId.get(String(sub.pickup_id)) : null;
        if (!doc) continue;
        out.set(String(sub._id), {
            scheduled_date: doc.scheduled_date,
            scheduled_time_slot: doc.scheduled_time_slot,
            status: doc.status,
            location_address: doc.location_address || '',
            reference: doc.bosta_pickup_id || null,
        });
    }
    return out;
};

/**
 * Every parcel that belongs to this vendor, shaped for their dashboard.
 *
 * Scoped to the vendor's own sub-orders — a vendor never sees another store's items, its
 * totals, or the order total. With parcels that isolation is structural rather than a
 * filter applied at read time.
 */
const getVendorSubOrders = async (vendorId, { tab = null } = {}) => {
    const subOrderService = require('./subOrderService');
    const smartLabelService = require('./smartLabelService');

    const orders = await Order.find({ 'sub_orders.vendor_id': vendorId })
        .sort({ created_at: -1 })
        .lean();
    await attachProductLinks(orders);

    const smartLabelEnabled = await smartLabelService.isEnabled().catch(() => false);
    const defaultCourier = await require('./couriers').getDefaultCourier();
    const smartFor = (s) => smartLabelEnabled && (s.courier || defaultCourier) === 'bosta';
    const wanted = tab ? VENDOR_STAGE_TABS.find((t) => t.key === tab)?.statuses : null;

    const rows = [];
    const counts = Object.fromEntries(VENDOR_STAGE_TABS.map((t) => [t.key, 0]));

    const mySubs = orders.flatMap((o) =>
        (o.sub_orders || []).filter((s) => s.vendor_id?.toString() === vendorId.toString())
    );
    const pickupBySub = await pickupsForSubs(mySubs);
    const batchBySub = await require('./companyBatchService').vendorBatchSummaries(mySubs);
    // How many orders of each combined parcel are confirmed, from the parcels in hand.
    const batchProgress = new Map();
    for (const sub of mySubs) {
        const info = batchBySub.get(String(sub._id));
        if (!info || sub.status === 'cancelled') continue;
        const key = String(info.batch_id);
        const p = batchProgress.get(key) || { order_count: 0, confirmed_count: 0 };
        p.order_count += 1;
        if (!['pending_review', 'needs_admin', 'held_in_batch'].includes(sub.status)) p.confirmed_count += 1;
        batchProgress.set(key, p);
    }

    for (const order of orders) {
        for (const sub of order.sub_orders || []) {
            if (sub.vendor_id?.toString() !== vendorId.toString()) continue;
            if (sub.status === 'cancelled') continue;
            // Still waiting in a company batch: not the vendor's yet (feature 14).
            if (sub.status === 'held_in_batch') continue;

            const status = subOrderService.effectiveStatus(sub);
            counts[stageTabFor(status)] += 1;
            if (wanted && !wanted.includes(status)) continue;

            const batch = batchBySub.get(String(sub._id)) || null;
            const view = subOrderService.toPublicSubOrder(order, sub, { audience: 'vendor' });
            rows.push({
                ...view,
                order_id: order._id,
                order_reference: order.transaction?.reference || order._id.toString(),
                order_created_at: order.created_at,
                payment_method: order.transaction?.payment_method,
                tab: stageTabFor(status),
                // A combined company order this parcel is part of — the list groups them.
                batch: batch ? { ...batch, ...(batchProgress.get(String(batch.batch_id)) || {}) } : null,
                progress: stageProgress(order, sub, smartFor(sub), batch ? batchProgress.get(String(batch.batch_id)) : null),
                courier: sub.courier || defaultCourier,
                vendor_review: vendorReviewState(order, sub),
                // When the courier is coming for this box, or null if none is booked yet.
                pickup: pickupBySub.get(String(sub._id)) || null,
                // What this parcel earns the vendor, shown on the parcel itself rather than
                // only on the wallet page — it is the number they actually care about.
                // Goods at list price, less the vendor's share of the coupon, less commission:
                // the same formula the earning is recorded with on delivery.
                earning_estimate: Number(
                    (Number(sub.merchandise_total || 0) - Number(sub.coupon_vendor_share || 0) - Number(sub.commission_total || 0)).toFixed(2)
                ),
            });
        }
    }

    return { sub_orders: rows, counts, tabs: VENDOR_STAGE_TABS, smart_label_enabled: smartLabelEnabled };
};

/** One parcel in full, with its live earnings state attached. */
const getVendorSubOrder = async (vendorId, orderId, subOrderId) => {
    const subOrderService = require('./subOrderService');
    const smartLabelService = require('./smartLabelService');
    const { VendorEarning } = require('../models/vendorEarnings');

    const order = await Order.findById(orderId).lean();
    if (!order) throw new Error('Order not found');
    await attachProductLinks([order]);

    const sub = (order.sub_orders || []).find((s) => s._id.toString() === subOrderId.toString());
    if (!sub) throw new Error('Parcel not found');
    if (sub.vendor_id?.toString() !== vendorId.toString()) throw new Error('This parcel belongs to another vendor');
    if (sub.status === 'held_in_batch') throw new Error('Parcel not found');

    // The combined company order around this parcel, with every person's order in it.
    const batch = sub.company_batch?.role
        ? await require('./companyBatchService').vendorBatchView(vendorId, sub.company_batch.batch_id).catch(() => null)
        : null;

    const smartLabelEnabled = await smartLabelService.isEnabled().catch(() => false);
    const defaultCourier = await require('./couriers').getDefaultCourier();
    const smartFor = (s) => smartLabelEnabled && (s.courier || defaultCourier) === 'bosta';
    const earning = await VendorEarning.findOne({ order_id: order._id, sub_order_id: sub._id }).lean();

    return {
        ...subOrderService.toPublicSubOrder(order, sub, { audience: 'vendor' }),
        order_id: order._id,
        order_reference: order.transaction?.reference || order._id.toString(),
        order_created_at: order.created_at,
        payment_method: order.transaction?.payment_method,
        // The delivery contact is withheld until the parcel is actually being prepared —
        // the existing rule, unchanged.
        shipping_address: ['pending_review', 'needs_admin'].includes(sub.status)
            ? null
            : order.shipping_address,
        tab: stageTabFor(subOrderService.effectiveStatus(sub)),
        batch,
        progress: stageProgress(order, sub, smartFor(sub), batch),
        courier: sub.courier || defaultCourier,
        courier_label: require('./couriers').labelOf(sub.courier || defaultCourier),
        vendor_review: vendorReviewState(order, sub),
        pickup: (await pickupsForSubs([sub])).get(String(sub._id)) || null,
        smart_label_enabled: smartFor(sub),
        earning: earning
            ? {
                status: earning.status,
                gross_amount: earning.gross_amount,
                coupon_share: Number(earning.coupon_share || 0),
                commission_amount: earning.commission_amount,
                net_amount: earning.net_amount,
                effective_net: earning.effective_net,
                clearable_at: earning.clearable_at,
                has_open_return: earning.has_open_return,
            }
            // Not yet delivered, so nothing is recorded — show what it will be worth,
            // computed exactly as the earning will be.
            : {
                status: 'not_yet_earned',
                gross_amount: Number(sub.merchandise_total || 0),
                coupon_share: Number(sub.coupon_vendor_share || 0),
                commission_amount: Number(sub.commission_total || 0),
                net_amount: Number(
                    (Number(sub.merchandise_total || 0) - Number(sub.coupon_vendor_share || 0) - Number(sub.commission_total || 0)).toFixed(2)
                ),
                effective_net: 0,
                clearable_at: null,
                has_open_return: false,
            },
    };
};

/**
 * Get orders for a specific vendor
 */
const getVendorOrders = async (vendorId, isRevised = false) => {
    const statusFilter = isRevised ? 'supervised' : 'pending';

    const found = await Order.find({
        'vendor_supervisions': {
            $elemMatch: {
                vendor_id: vendorId,
                status: statusFilter
            }
        }
    }).sort({ created_at: -1 }).lean();
    // An order whose parcels for this vendor are all still waiting in a company batch is
    // not the vendor's yet (feature 14) — it appears when the batch closes.
    const orders = found.filter((o) => {
        const theirs = (o.sub_orders || []).filter((s) => String(s.vendor_id) === String(vendorId));
        return !(theirs.length > 0 && theirs.every((s) => s.status === 'held_in_batch'));
    });
    await attachProductLinks(orders);

    // Smart Label state travels with the order so the vendor's list can show "needs a
    // label" at a glance, without a second round trip per order.
    const smartLabelService = require('./smartLabelService');
    const [labelsByKey, smartLabelEnabled, defaultCourier] = await Promise.all([
        smartLabelService.labelsForOrders(orders.map(o => o._id)),
        smartLabelService.isEnabled(),
        require('./couriers').getDefaultCourier(),
    ]);

    return orders.map(order => {
        const vendorSupervision = order.vendor_supervisions.find(s => s.vendor_id.toString() === vendorId.toString());

        // Filter shipments belonging to this vendor
        const vendorShipments = (order.shipments || []).filter(
            s => s.vendor_id && s.vendor_id.toString() === vendorId.toString()
        );

        const approvedCount = order.items.filter(
            item => item.vendor_id?.toString() === vendorId.toString() && item.vendor_status === 'approved'
        ).length;
        const smartLabel = labelsByKey.get(`${order._id}:${vendorId}`) || null;

        return {
            _id: order._id,
            status: order.status,
            reference: order.transaction?.reference || order._id,
            created_at: order.created_at,
            vendor_total: vendorSupervision?.total_amount || 0,
            vendor_supervision_status: vendorSupervision?.status || 'pending',
            fulfillment_location: vendorSupervision?.fulfillment_location || null,
            items: order.items.filter(item => item.vendor_id && item.vendor_id.toString() === vendorId.toString()),
            shipments: vendorShipments,
            smart_label_enabled: smartLabelEnabled,
            smart_label: smartLabel && {
                tracking_number: smartLabel.tracking_number,
                status: smartLabel.status,
                scanned_at: smartLabel.scanned_at,
                scanned_by_label: smartLabel.scanned_by_label,
            },
            // The vendor can scan once they have reviewed their items and something is
            // actually going out, and only until the parcel is on its way to the courier.
            // A Smart Label is a Bosta number, so the scanner is offered only when this
            // vendor's parcel is actually going out with Bosta — reserving one for an Arrive
            // parcel burns the sticker (dispatch never releases it).
            smart_label_scannable:
                smartLabelEnabled &&
                require('./couriers').capabilities(
                    (order.sub_orders || []).find(s => s.vendor_id?.toString() === vendorId.toString())?.courier
                    || defaultCourier
                ).smartLabel &&
                vendorSupervision?.status === 'supervised' &&
                approvedCount > 0 &&
                // A shipment without a sticker can still take one (see `can_scan_label`).
                // Retired rows (a reactivated parcel's old deliveries) are history, not the
                // shipment in play, so a sticker on one of them does not freeze the scanner.
                !vendorShipments.some(s => s.smart_label_barcode && !s.superseded_at),
        };
    });
};

/**
 * The ranges the dashboard (and its PDF report) can be read over.
 *
 * `days` is what makes a comparison possible: the preceding window of the same
 * length is what "+18% vs previous period" is measured against. `all` has no
 * such window, so it reports no growth rather than an invented one.
 */
const STATS_RANGES = {
    '7d': { days: 7, granularity: 'day' },
    '30d': { days: 30, granularity: 'day' },
    '90d': { days: 90, granularity: 'week' },
    '12m': { days: 365, granularity: 'month' },
    all: { days: null, granularity: 'month' },
};

const DEFAULT_STATS_RANGE = '30d';

/* ------------------------------------------------------------------ */
/*  Dashboard summary                                                 */
/* ------------------------------------------------------------------ */

/**
 * Every number on the vendor's landing screen — and in the PDF report it
 * exports — in one round trip.
 *
 * Four rules decide what counts, and all four are chosen so the figure never
 * flatters the vendor:
 *
 *  · ONLY MONEY THAT ARRIVED COUNTS. Every sales, order, customer, product and
 *    chart figure is built from this vendor's DELIVERED parcels, dated by the day
 *    they were delivered. A parcel still in the store, on the road, stuck, or
 *    cancelled at the courier has earned nothing and may never earn anything —
 *    counting it from the day it was ordered put a parcel that never left in
 *    Domora's sales for over a week (Sep 2026). What is on its way is reported
 *    on its own, under `in_flight`, and never mixed into these totals.
 *  · money that came back is taken off again: a customer refund reverses part
 *    of the parcel on the earning ledger, and that reversal is subtracted here,
 *    so the dashboard agrees with the wallet. Cancelled and returned orders are
 *    reported separately, as counts, so the vendor can still see what they lost.
 *  · every amount is THIS vendor's parcel share (`sub_orders.merchandise_total`),
 *    never the order total — a basket split across three stores must not show
 *    all three the same number.
 *  · a line item declined by the vendor is not theirs to claim, so it is left
 *    out of the units and top-product figures.
 *
 * Lifetime figures ignore `range`; everything under `period` honours it, and is
 * paired with the preceding window of equal length so growth is a comparison
 * rather than a decoration.
 *
 * Earnings come from the cached wallet rather than a recompute: this screen is
 * a glance, and the wallet page recomputes when the vendor goes there to act.
 *
 * @param {string} vendorId
 * @param {{ range?: keyof STATS_RANGES }} [options]
 */
const getVendorDashboardStats = async (vendorId, { range = DEFAULT_STATS_RANGE } = {}) => {
    const { ReturnRequest } = require('../models/returnRequests');
    const { Review } = require('../models/reviews');

    const id = new mongoose.Types.ObjectId(String(vendorId));
    // `hasOwnProperty`, not a truthiness check: `?range=constructor` would
    // otherwise resolve against Object.prototype, leave `days` undefined, and
    // send the bucket loop walking back to the epoch one day at a time.
    const rangeKey = Object.prototype.hasOwnProperty.call(STATS_RANGES, range) ? range : DEFAULT_STATS_RANGE;
    const { days: rangeDays, granularity } = STATS_RANGES[rangeKey];

    const now = new Date();

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // The series is bucketed in the store's own timezone, and the day keys below
    // are built in that same zone. Mixing the two — local midnight for the range
    // but UTC keys for the labels — silently shifts the whole row by a day for
    // anyone east of UTC, which is to say for this store.
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    // `all` starts at the epoch: an open-ended $gte keeps one code path for
    // every range instead of branching the whole aggregation in two.
    const periodStart = new Date(0);
    if (rangeDays) {
        periodStart.setTime(now.getTime());
        periodStart.setHours(0, 0, 0, 0);
        periodStart.setDate(periodStart.getDate() - (rangeDays - 1));
    }

    // The window of equal length immediately before this one. Undefined for
    // `all`, which has nothing behind it to compare against.
    const previousStart = rangeDays ? new Date(periodStart) : null;
    if (previousStart) previousStart.setDate(previousStart.getDate() - rangeDays);

    // This vendor's DELIVERED parcels — the only money that counts as earned. Each row is
    // one parcel, dated by when it was delivered (`at`), with what a refund has since
    // taken back subtracted, read off the earning ledger so the dashboard and the wallet
    // can never disagree. `sales` is the goods' value after refunds; `commission` the
    // platform's cut of it.
    const earnedParcels = [
        { $match: { 'sub_orders.vendor_id': id, 'sub_orders.status': 'delivered' } },
        { $unwind: '$sub_orders' },
        { $match: { 'sub_orders.vendor_id': id, 'sub_orders.status': 'delivered' } },
        {
            $lookup: {
                from: 'vendorearnings',
                let: { sid: '$sub_orders._id' },
                pipeline: [
                    { $match: { $expr: { $eq: ['$sub_order_id', '$$sid'] } } },
                    { $project: { reversed_net: 1, reversed_commission: 1, reversed_coupon: 1 } },
                ],
                as: 'earning',
            },
        },
        {
            $addFields: {
                at: { $ifNull: ['$sub_orders.delivered_at', { $ifNull: ['$delivered_at', '$created_at'] }] },
                // The goods value a refund took back, at list price: the net the vendor
                // returned plus the commission and coupon share that went with it.
                refundedGross: {
                    $add: [
                        { $ifNull: [{ $first: '$earning.reversed_net' }, 0] },
                        { $ifNull: [{ $first: '$earning.reversed_commission' }, 0] },
                        { $ifNull: [{ $first: '$earning.reversed_coupon' }, 0] },
                    ],
                },
                refundedCommission: { $ifNull: [{ $first: '$earning.reversed_commission' }, 0] },
                refundedCoupon: { $ifNull: [{ $first: '$earning.reversed_coupon' }, 0] },
            },
        },
        {
            $addFields: {
                sales: { $max: [0, { $subtract: [{ $ifNull: ['$sub_orders.merchandise_total', 0] }, '$refundedGross'] }] },
                // The vendor's share of the coupon on the goods that stayed sold.
                coupon: { $max: [0, { $subtract: [{ $ifNull: ['$sub_orders.coupon_vendor_share', 0] }, '$refundedCoupon'] }] },
                commission: { $max: [0, { $subtract: [{ $ifNull: ['$sub_orders.commission_total', 0] }, '$refundedCommission'] }] },
                shipping: { $ifNull: ['$sub_orders.shipping_share', 0] },
            },
        },
    ];

    // Bucket boundaries for the series, on the delivery date. A week bucket is labelled
    // by its Monday so 90 days reads as 13 bars rather than 90 slivers.
    const seriesGroupId = {
        day: { $dateToString: { format: '%Y-%m-%d', date: '$at', timezone } },
        week: {
            $dateToString: {
                format: '%Y-%m-%d',
                date: { $dateTrunc: { date: '$at', unit: 'week', startOfWeek: 'monday', timezone } },
                timezone,
            },
        },
        month: { $dateToString: { format: '%Y-%m', date: '$at', timezone } },
    }[granularity];

    // Orders are counted distinct: a vendor shipping one order from two branches has two
    // parcels but made one sale.
    const earnedGroup = (extra = {}) => ({
        $group: { _id: null, sales: { $sum: '$sales' }, orderIds: { $addToSet: '$_id' }, ...extra },
    });
    const withOrderCount = { $addFields: { orders: { $size: '$orderIds' } } };

    const [orderStats] = await Order.aggregate([
        ...earnedParcels,
        {
            $facet: {
                lifetime: [earnedGroup(), withOrderCount],
                // Everything above is already delivered, so "completed" and "lifetime" are
                // the same figure; both names stay because the report reads both.
                completed: [earnedGroup(), withOrderCount],
                thisMonth: [
                    { $match: { at: { $gte: startOfMonth } } },
                    earnedGroup(), withOrderCount,
                ],
                period: [
                    { $match: { at: { $gte: periodStart } } },
                    earnedGroup({ commission: { $sum: '$commission' }, coupon: { $sum: '$coupon' }, shipping: { $sum: '$shipping' } }),
                    withOrderCount,
                ],
                // The equal-length window before this one, for the growth figure.
                previous: previousStart
                    ? [
                        { $match: { at: { $gte: previousStart, $lt: periodStart } } },
                        earnedGroup(), withOrderCount,
                    ]
                    // `all` has nothing behind it. An impossible match rather
                    // than `$limit: 0`, which MongoDB rejects outright.
                    : [{ $match: { _id: null } }],
                // How many distinct buyers received something this period, and how many of
                // them more than once — the cheapest honest loyalty signal.
                customers: [
                    { $match: { at: { $gte: periodStart } } },
                    { $group: { _id: '$user_id', orderIds: { $addToSet: '$_id' } } },
                    {
                        $group: {
                            _id: null,
                            total: { $sum: 1 },
                            repeat: { $sum: { $cond: [{ $gt: [{ $size: '$orderIds' }, 1] }, 1, 0] } },
                        },
                    },
                ],
                // One row per bucket over the selected range.
                series: [
                    { $match: { at: { $gte: periodStart } } },
                    { $group: { _id: seriesGroupId, sales: { $sum: '$sales' }, orderIds: { $addToSet: '$_id' } } },
                    { $addFields: { orders: { $size: '$orderIds' } } },
                    { $project: { orderIds: 0 } },
                    { $sort: { _id: 1 } },
                ],
                // The lines inside the delivered parcels, for units sold and the top sellers.
                items: [
                    { $match: { at: { $gte: periodStart } } },
                    {
                        $project: {
                            items: {
                                $filter: {
                                    input: '$items',
                                    as: 'i',
                                    cond: {
                                        $and: [
                                            { $eq: ['$$i.sub_order_id', '$sub_orders._id'] },
                                            { $ne: ['$$i.vendor_status', 'declined'] },
                                        ],
                                    },
                                },
                            },
                        },
                    },
                    { $unwind: '$items' },
                    {
                        $group: {
                            _id: '$items.product_id',
                            title: { $first: '$items.product_title' },
                            image: { $first: '$items.product_image' },
                            units: { $sum: '$items.quantity' },
                            revenue: { $sum: { $multiply: ['$items.quantity', '$items.unit_price'] } },
                        },
                    },
                    { $sort: { revenue: -1 } },
                ],
            },
        },
    ]);

    // The latest orders, whatever state they are in. This is an activity list, not a sum —
    // a vendor wants to see the order that arrived an hour ago — so it is the one place
    // that reads orders that have not delivered yet. Each row carries its own status badge.
    const recentRows = await Order.aggregate([
        { $match: { 'vendor_supervisions.vendor_id': id } },
        { $sort: { created_at: -1 } },
        { $limit: 5 },
        {
            $project: {
                _id: 1,
                status: 1,
                created_at: 1,
                reference: '$transaction.reference',
                total: {
                    $let: {
                        vars: {
                            mine: {
                                $first: {
                                    $filter: { input: '$vendor_supervisions', as: 's', cond: { $eq: ['$$s.vendor_id', id] } },
                                },
                            },
                        },
                        in: '$$mine.total_amount',
                    },
                },
            },
        },
    ]);
    if (orderStats) orderStats.recent = recentRows;

    // Counted apart from everything above, which excludes them by design: the
    // vendor still needs to see what fell over, they just must not see it as
    // revenue.
    const lostOrders = Order.aggregate([
        {
            $match: {
                'vendor_supervisions.vendor_id': id,
                status: { $in: ['cancelled', 'returned'] },
                created_at: { $gte: periodStart },
            },
        },
        { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    // Where this vendor's parcels stand right now, across every live order.
    // Read off sub-orders rather than the order status because the order's is
    // derived from all vendors' parcels, not just this one's.
    const parcelStates = Order.aggregate([
        { $match: { 'sub_orders.vendor_id': id } },
        { $unwind: '$sub_orders' },
        { $match: { 'sub_orders.vendor_id': id, 'sub_orders.created_at': { $gte: periodStart } } },
        { $group: { _id: '$sub_orders.status', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
    ]);

    // Money that is committed but has not landed: this vendor's parcels that are
    // still in the store, and the ones that have left it and not been delivered.
    // Deliberately NOT bounded by `range` — a parcel sealed six weeks ago and
    // still waiting for a courier is exactly the one the vendor needs to see.
    // Same partition as the admin finance page (`AT_VENDOR_STATUSES` /
    // `IN_TRANSIT_STATUSES`), so the two screens can never disagree.
    const inFlightRows = Order.aggregate([
        { $match: { 'sub_orders.vendor_id': id, status: { $nin: ['cancelled'] } } },
        { $unwind: '$sub_orders' },
        {
            $match: {
                'sub_orders.vendor_id': id,
                'sub_orders.status': { $in: [...AT_VENDOR_STATUSES, ...IN_TRANSIT_STATUSES] },
            },
        },
        {
            $group: {
                _id: {
                    stage: {
                        $cond: [{ $in: ['$sub_orders.status', AT_VENDOR_STATUSES] }, 'at_vendor', 'in_transit'],
                    },
                    status: '$sub_orders.status',
                },
                parcels: { $sum: 1 },
                orders: { $addToSet: '$_id' },
                merchandise: { $sum: { $ifNull: ['$sub_orders.merchandise_total', 0] } },
                collectable: { $sum: { $ifNull: ['$sub_orders.cod_amount', 0] } },
            },
        },
    ]);

    const returnRows = ReturnRequest.aggregate([
        { $match: { vendor_id: id, created_at: { $gte: periodStart } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    // The vendor's own service rating, split by star so a 4.2 built from
    // fives and ones is not mistaken for a 4.2 built from fours.
    const reviewRows = Review.aggregate([
        { $match: { vendor_id: id, target_type: 'vendor', status: 'approved' } },
        { $group: { _id: '$rating', count: { $sum: 1 } } },
    ]);

    const [productRows, stockRows, orderCounts, seller, lost, parcels, inFlight, returns, reviews] = await Promise.all([
        Product.aggregate([
            { $match: { vendor_id: id } },
            { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        // Stock is per variant, so a product is out of stock only when every
        // variant is — and low when the total left is small but not yet zero.
        // A product with no variants keeps its stock in `quantity` instead, the
        // same fallback `catalogService.productStock` applies; summing an empty
        // variants array would report every such product as out of stock.
        Product.aggregate([
            { $match: { vendor_id: id, status: 'published', stock_management: true } },
            {
                $addFields: {
                    stock_left: {
                        $cond: [
                            { $gt: [{ $size: { $ifNull: ['$variants', []] } }, 0] },
                            { $sum: '$variants.stock' },
                            { $ifNull: ['$quantity', 0] },
                        ],
                    },
                },
            },
            {
                $group: {
                    _id: null,
                    out_of_stock: { $sum: { $cond: [{ $lte: ['$stock_left', 0] }, 1, 0] } },
                    low_stock: {
                        $sum: {
                            $cond: [
                                { $and: [{ $gt: ['$stock_left', 0] }, { $lte: ['$stock_left', LOW_STOCK_THRESHOLD] }] },
                                1,
                                0,
                            ],
                        },
                    },
                },
            },
        ]),
        getVendorOrderCounts(vendorId),
        Seller.findById(id).select('wallet store_name name rating reviews_count completed_orders_count created_at').lean(),
        lostOrders,
        parcelStates,
        inFlightRows,
        returnRows,
        reviewRows,
    ]);

    const products = productRows.reduce((acc, row) => {
        acc[row._id || 'unknown'] = row.count;
        acc.total += row.count;
        return acc;
    }, { total: 0 });

    const first = (rows) => rows?.[0] || {};
    const num = (value) => Number(value) || 0;
    const round2 = (value) => Number((Number(value) || 0).toFixed(2));

    const period = first(orderStats?.period);
    const previous = first(orderStats?.previous);
    const customers = first(orderStats?.customers);
    const stock = first(stockRows);

    /**
     * Percentage change, or null when there is nothing to compare against.
     *
     * Null rather than 0 or 100: a first-ever sale is not "+100% growth", and
     * the screen renders the null as "no comparable period" instead of a
     * number the vendor might repeat to someone.
     */
    const growth = (current, before) => {
        if (!previousStart || !num(before)) return null;
        return Number((((num(current) - num(before)) / num(before)) * 100).toFixed(1));
    };

    const countsByKey = (rows) => (rows || []).reduce((acc, row) => {
        acc[row._id || 'unknown'] = row.count;
        return acc;
    }, {});

    const lostCounts = countsByKey(lost);
    const returnCounts = countsByKey(returns);

    // Still on somebody's desk. Split out because the first bucket is the only
    // one the vendor can act on today.
    const returnsAwaitingVendor = returnCounts.pending_vendor_review || 0;
    const returnsInFlight = ['vendor_approved', 'pending_admin_review', 'approved', 'return_shipping', 'return_received', 'refund_processing']
        .reduce((sum, key) => sum + (returnCounts[key] || 0), 0);
    const returnsCompleted = returnCounts.completed || 0;
    const returnsRejected = (returnCounts.rejected || 0) + (returnCounts.vendor_rejected || 0);

    // The four buckets above and nothing else, so the total the vendor reads is
    // the total of the rows underneath it. A request the customer withdrew was
    // never a return against this store and is counted in neither.
    const returnsTotal = returnsAwaitingVendor + returnsInFlight + returnsCompleted + returnsRejected;

    // The two in-flight stages, folded from their per-status rows. An order can
    // have one parcel at each stage, so orders are counted distinct per stage.
    const emptyStage = () => ({ parcels: 0, orders: new Set(), merchandise: 0, collectable: 0, by_status: {} });
    const stages = { at_vendor: emptyStage(), in_transit: emptyStage() };
    for (const row of inFlight || []) {
        const stage = stages[row._id.stage];
        stage.parcels += row.parcels;
        stage.merchandise += num(row.merchandise);
        stage.collectable += num(row.collectable);
        row.orders.forEach((orderId) => stage.orders.add(String(orderId)));
        stage.by_status[row._id.status] = {
            parcels: row.parcels,
            merchandise: round2(row.merchandise),
            collectable: round2(row.collectable),
        };
    }
    const shapeStage = (stage) => ({
        parcels: stage.parcels,
        orders: stage.orders.size,
        merchandise: round2(stage.merchandise),
        collectable: round2(stage.collectable),
        by_status: stage.by_status,
    });

    const ratingCounts = countsByKey(reviews);
    const ratingTotal = Object.values(ratingCounts).reduce((a, b) => a + b, 0);

    // Every bucket in the range appears, including the quiet ones — a gap in
    // the row would read as "no data" rather than "no sales that day".
    const bucketKey = (date) => (granularity === 'month'
        ? date.toLocaleDateString('en-CA', { timeZone: timezone }).slice(0, 7)
        : date.toLocaleDateString('en-CA', { timeZone: timezone }));

    const bySeriesKey = new Map((orderStats?.series || []).map((row) => [row._id, row]));
    const series = [];

    if (granularity === 'month') {
        // `all` has no fixed length, so its months run from the store's first
        // order — or from this month, for a store that has none yet.
        const firstKey = (orderStats?.series || [])[0]?._id;
        const start = rangeDays
            ? new Date(periodStart)
            : (firstKey ? new Date(`${firstKey}-01T00:00:00`) : new Date(now));
        start.setDate(1);
        start.setHours(0, 0, 0, 0);

        for (let cursor = new Date(start); cursor <= now; cursor.setMonth(cursor.getMonth() + 1)) {
            const key = bucketKey(cursor);
            const row = bySeriesKey.get(key);
            series.push({ date: key, sales: round2(row?.sales), orders: row?.orders || 0 });
        }
    } else {
        const step = granularity === 'week' ? 7 : 1;
        const cursor = new Date(periodStart);
        if (granularity === 'week') {
            // Align to the Monday the aggregation truncated to, or the first
            // bucket lands between two labels and every bar is off by a day.
            const weekday = (cursor.getDay() + 6) % 7;
            cursor.setDate(cursor.getDate() - weekday);
        }
        for (; cursor <= now; cursor.setDate(cursor.getDate() + step)) {
            const key = bucketKey(cursor);
            const row = bySeriesKey.get(key);
            series.push({ date: key, sales: round2(row?.sales), orders: row?.orders || 0 });
        }
    }

    const itemRows = orderStats?.items || [];
    const unitsSold = itemRows.reduce((sum, row) => sum + num(row.units), 0);

    return {
        range: {
            key: rangeKey,
            days: rangeDays,
            granularity,
            from: rangeDays ? periodStart : null,
            to: now,
            comparable: Boolean(previousStart),
        },
        store: {
            name: seller?.store_name || seller?.name || '',
            member_since: seller?.created_at || null,
        },
        // Earned money only — delivered parcels, net of refunds. What has not arrived yet
        // is under `in_flight`, never in here.
        sales: {
            basis: 'delivered',
            lifetime: round2(first(orderStats?.lifetime).sales),
            completed: round2(first(orderStats?.completed).sales),
            this_month: round2(first(orderStats?.thisMonth).sales),
            period: round2(period.sales),
            previous_period: round2(previous.sales),
            growth_pct: growth(period.sales, previous.sales),
            // Commission is the platform's cut of this period's sales; the coupon share is
            // the part of customers' coupons this vendor agreed to fund; net is what the
            // vendor keeps before shipping.
            commission: round2(period.commission),
            coupon_share: round2(period.coupon),
            net: round2(num(period.sales) - num(period.coupon) - num(period.commission)),
            shipping: round2(period.shipping),
            avg_order_value: num(period.orders) ? round2(num(period.sales) / num(period.orders)) : 0,
        },
        // Delivered orders. Orders still moving are counted under `in_flight` and
        // `awaiting_action`; lost ones under `cancelled` and `returned`.
        orders: {
            basis: 'delivered',
            lifetime: num(first(orderStats?.lifetime).orders),
            completed: num(first(orderStats?.completed).orders),
            this_month: num(first(orderStats?.thisMonth).orders),
            period: num(period.orders),
            previous_period: num(previous.orders),
            growth_pct: growth(period.orders, previous.orders),
            // Waiting on the vendor to review their items.
            awaiting_action: orderCounts.pending,
            cancelled: lostCounts.cancelled || 0,
            returned: lostCounts.returned || 0,
            units_sold: unitsSold,
        },
        parcels: (parcels || []).map((row) => ({ status: row._id, count: row.count })),
        // Right now, across every live order, regardless of `range`. `merchandise`
        // is the goods' value; `collectable` is what the customer pays for the
        // parcel including shipping, which is the figure on the courier's slip.
        in_flight: {
            at_vendor: shapeStage(stages.at_vendor),
            in_transit: shapeStage(stages.in_transit),
        },
        customers: {
            unique: num(customers.total),
            repeat: num(customers.repeat),
            repeat_pct: num(customers.total)
                ? Number(((num(customers.repeat) / num(customers.total)) * 100).toFixed(1))
                : 0,
        },
        products: {
            total: products.total,
            published: products.published || 0,
            pending: products.pending || 0,
            draft: products.draft || 0,
            rejected: products.rejected || 0,
            out_of_stock: num(stock.out_of_stock),
            low_stock: num(stock.low_stock),
        },
        earnings: {
            available: round2(seller?.wallet?.available_balance),
            pending: round2(seller?.wallet?.pending_balance),
            reserved: round2(seller?.wallet?.reserved_balance),
            withdrawn: round2(seller?.wallet?.total_withdrawn),
        },
        returns: {
            total: returnsTotal,
            awaiting_vendor: returnsAwaitingVendor,
            in_progress: returnsInFlight,
            completed: returnsCompleted,
            rejected: returnsRejected,
            // Against orders in the same window, which is the comparison a
            // vendor actually reads it as.
            rate_pct: num(period.orders)
                ? Number(((returnsTotal / num(period.orders)) * 100).toFixed(1))
                : 0,
        },
        reviews: {
            rating: round2(seller?.rating),
            count: num(seller?.reviews_count),
            // Lifetime, like the rating it explains — a star split over one
            // month is too thin to mean anything.
            distribution: [5, 4, 3, 2, 1].map((star) => ({
                star,
                count: ratingCounts[star] || 0,
                pct: ratingTotal ? Math.round(((ratingCounts[star] || 0) / ratingTotal) * 100) : 0,
            })),
        },
        top_products: itemRows.slice(0, 5).map((row) => ({
            product_id: row._id,
            title: row.title,
            image: row.image || null,
            units: num(row.units),
            revenue: round2(row.revenue),
        })),
        series,
        recent_orders: (orderStats?.recent || []).map((order) => ({
            _id: order._id,
            reference: order.reference || String(order._id),
            status: order.status,
            created_at: order.created_at,
            total: round2(order.total),
        })),
    };
};

/**
 * How many orders are waiting on this vendor, and how many they have already
 * dealt with.
 *
 * Cancelled and returned orders are excluded from both. They are counted
 * nowhere the vendor is being asked to act: an order that will never ship has
 * nothing left to supervise, and counting it only sends the vendor to a list
 * where there is nothing to do.
 */
const getVendorOrderCounts = async (vendorId) => {
    // Orders still waiting in a company batch are not the vendor's yet (feature 14).
    const live = {
        status: { $nin: ['cancelled', 'returned'] },
        sub_orders: { $not: { $elemMatch: { vendor_id: vendorId, status: 'held_in_batch' } } },
    };

    const [pending, supervised] = await Promise.all([
        Order.countDocuments({
            ...live,
            vendor_supervisions: {
                $elemMatch: {
                    vendor_id: vendorId,
                    status: 'pending',
                },
            },
        }),
        Order.countDocuments({
            ...live,
            vendor_supervisions: {
                $elemMatch: {
                    vendor_id: vendorId,
                    status: 'supervised',
                },
            },
        }),
    ]);

    return {
        pending,
        supervised,
        total: pending + supervised,
    };
};

/**
 * Update the status of order items for a specific vendor
 */
const updateVendorOrderStatus = async (vendorId, orderId, itemUpdates, fulfillmentLocation = null) => {
    const order = await Order.findById(orderId);
    if (!order) throw new Error('Order not found');

    // An order with parcels is reviewed through the three-stage parcel flow, which is what
    // creates the shipment, records the reason for a decline and routes an unavailable item
    // to the website team. Letting this older bulk endpoint write item statuses as well would
    // silently skip all of that.
    if (Array.isArray(order.sub_orders) && order.sub_orders.length > 0) {
        throw new Error(
            'This order is organised into parcels. Open the parcel you want and confirm its items there.'
        );
    }

    const vendor = await Seller.findById(vendorId).select('store_name store_username').lean();
    const actor = {
        role: 'vendor',
        label: vendor?.store_name || vendor?.store_username || 'Vendor',
    };

    let isModified = false;
    let advancedToProcessing = false;

    order.items.forEach(item => {
        if (item.vendor_id && item.vendor_id.toString() === vendorId.toString()) {
            const update = itemUpdates.find(u => u.itemId === item._id.toString());
            if (update) {
                const oldStatus = item.vendor_status;
                const oldNote = item.vendor_note || '';
                if (update.status) item.vendor_status = update.status;
                if (update.note !== undefined) item.vendor_note = update.note;
                const newNote = item.vendor_note || '';

                if (oldStatus !== item.vendor_status || oldNote !== newNote) {
                    appendOrderHistory(
                        order,
                        'vendor_item_reviewed',
                        'Vendor reviewed item',
                        `${actor.label} changed ${item.product_title} from ${oldStatus} to ${item.vendor_status}.`,
                        {
                            item_id: item._id.toString(),
                            product_title: item.product_title,
                            vendor_id: vendorId.toString(),
                            vendor_name: actor.label,
                            status_from: oldStatus,
                            status_to: item.vendor_status,
                            note_from: oldNote,
                            note_to: newNote,
                            variant_label: item.variant_label,
                            quantity: item.quantity,
                        },
                        actor
                    );
                    isModified = true;
                }
            }
        }
    });

    if (isModified || fulfillmentLocation !== null) {
        const vendorItems = order.items.filter(item => item.vendor_id && item.vendor_id.toString() === vendorId.toString());
        const allReviewed = vendorItems.every(item => item.vendor_status !== 'pending');
        
        const supervision = order.vendor_supervisions.find(s => s.vendor_id.toString() === vendorId.toString());
        
        if (supervision && fulfillmentLocation !== null && supervision.fulfillment_location !== fulfillmentLocation) {
             supervision.fulfillment_location = fulfillmentLocation;
             isModified = true;
        }

        if (allReviewed && isModified) {
            if (supervision && supervision.status !== 'supervised') {
                supervision.status = 'supervised';
                appendOrderHistory(
                    order,
                    'vendor_supervision_completed',
                    'Vendor completed review',
                    `${actor.label} reviewed all assigned items.`,
                    { vendor_id: vendorId.toString(), vendor_name: actor.label },
                    actor
                );
            }

            // Once every item on the order is approved, auto-advance to processing.
            const { autoAdvanceToProcessing } = require('./orderService');
            if (autoAdvanceToProcessing(order, actor)) {
                isModified = true;
                advancedToProcessing = true;
            }
        }

        if (isModified) {
            // Declining the last approved item leaves nothing to ship, so a label scanned
            // earlier is handed back rather than left reserved on a shipment that will
            // never exist. Never fatal: label bookkeeping must not block a review.
            try {
                await require('./smartLabelService').releaseUnshippableReservations(order, actor);
            } catch (err) {
                console.error(`[Smart Label] Release check failed for order ${orderId}: ${err.message}`);
            }
            await order.save();
        }

        if (advancedToProcessing) {
            const { sendProcessingConfirmation } = require('./orderService');
            await sendProcessingConfirmation(order);
        }
    }

    return order;
};

module.exports = {
    VENDOR_STAGE_TABS,
    getVendorSubOrders,
    getVendorSubOrder,
    getVendorProfile,
    updateVendorProfile,
    getVendorProducts,
    getVendorProductById,
    addProduct,
    updateProduct,
    generateSlug,
    linkVariantIds,
    deleteProduct,
    getVendorOrders,
    getVendorOrderCounts,
    getVendorDashboardStats,
    STATS_RANGES,
    DEFAULT_STATS_RANGE,
    updateVendorOrderStatus,
    linkVendorLocationsToBosta,
    sweepUnlinkedVendorLocations,
    assertVendorLocationsAreShippable
};
