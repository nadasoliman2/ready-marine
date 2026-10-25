/**
 * Admin CRUD + read helpers for the shipping module.
 * Every create/update/delete invalidates the engine's in-process cache.
 */

const mongoose = require("mongoose");
const { ShippingZone } = require("../models/shipping_zones");
const { ShippingClass } = require("../models/shipping_classes");
const { ShippingMethod } = require("../models/shipping_methods");
const { ShippingPolicy } = require("../models/shipping_policies");
const { ShippingSettings } = require("../models/shipping_settings");
const { Product } = require("../models/products");
const engine = require("./shippingEngine");

const bump = () => engine.invalidateShippingCache();

/* ============================ Zones ============================ */

const listZones = () => ShippingZone.find().sort({ priority: 1, name: 1 }).lean();
const getZone = (id) => ShippingZone.findById(id).lean();

const createZone = async (data) => {
    const zone = await ShippingZone.create({
        name: data.name,
        name_ar: data.name_ar || "",
        is_active: data.is_active !== false,
        priority: Number(data.priority || 0),
        locations: Array.isArray(data.locations) ? data.locations : [],
    });
    bump();
    return zone;
};

const updateZone = async (id, data) => {
    const zone = await ShippingZone.findById(id);
    if (!zone) throw new Error("Zone not found");
    if (data.name !== undefined) zone.name = data.name;
    if (data.name_ar !== undefined) zone.name_ar = data.name_ar;
    if (data.is_active !== undefined) zone.is_active = !!data.is_active;
    if (data.priority !== undefined) zone.priority = Number(data.priority || 0);
    if (data.locations !== undefined) zone.locations = Array.isArray(data.locations) ? data.locations : [];
    await zone.save();
    bump();
    return zone;
};

const deleteZone = async (id) => {
    const methodCount = await ShippingMethod.countDocuments({ zone_id: id });
    if (methodCount > 0) {
        const err = new Error(`This zone has ${methodCount} shipping method(s). Delete or move them before deleting the zone.`);
        err.code = "ZONE_IN_USE";
        throw err;
    }
    const zone = await ShippingZone.findByIdAndDelete(id);
    if (!zone) throw new Error("Zone not found");
    bump();
    return zone;
};

/* ============================ Classes ============================ */

const listClasses = () => ShippingClass.find().sort({ name: 1 }).lean();
const getClass = (id) => ShippingClass.findById(id).lean();
const listActiveClasses = () => ShippingClass.find({ is_active: true }).sort({ name: 1 }).select("name name_ar description").lean();

const createClass = async (data) => {
    const cls = await ShippingClass.create({
        name: data.name,
        name_ar: data.name_ar || "",
        description: data.description || "",
        default_handling_fee: Number(data.default_handling_fee || 0),
        is_active: data.is_active !== false,
    });
    bump();
    return cls;
};

const updateClass = async (id, data) => {
    const cls = await ShippingClass.findById(id);
    if (!cls) throw new Error("Shipping class not found");
    if (data.name !== undefined) cls.name = data.name;
    if (data.name_ar !== undefined) cls.name_ar = data.name_ar;
    if (data.description !== undefined) cls.description = data.description;
    if (data.default_handling_fee !== undefined) cls.default_handling_fee = Number(data.default_handling_fee || 0);
    if (data.is_active !== undefined) cls.is_active = !!data.is_active;
    await cls.save();
    bump();
    return cls;
};

const deleteClass = async (id) => {
    const [productCount, methodCount, policyCount] = await Promise.all([
        Product.countDocuments({ shipping_class_id: id }),
        ShippingMethod.countDocuments({ "class_config.class_rates.shipping_class_id": id }),
        ShippingPolicy.countDocuments({ "applies_to.shipping_class_ids": id }),
    ]);
    if (productCount + methodCount + policyCount > 0) {
        const parts = [];
        if (productCount) parts.push(`${productCount} product(s)`);
        if (methodCount) parts.push(`${methodCount} shipping method rate(s)`);
        if (policyCount) parts.push(`${policyCount} policy filter(s)`);
        const err = new Error(`This class is referenced by ${parts.join(", ")}. Remove those references first.`);
        err.code = "CLASS_IN_USE";
        throw err;
    }
    const cls = await ShippingClass.findByIdAndDelete(id);
    if (!cls) throw new Error("Shipping class not found");
    bump();
    return cls;
};

/* ============================ Methods ============================ */

const listMethods = (filter = {}) => {
    const q = {};
    if (filter.zone_id && mongoose.Types.ObjectId.isValid(filter.zone_id)) q.zone_id = filter.zone_id;
    return ShippingMethod.find(q).sort({ zone_id: 1, sort_order: 1, name: 1 }).populate("zone_id", "name name_ar").lean();
};
const getMethod = (id) => ShippingMethod.findById(id).populate("zone_id", "name name_ar").lean();

function pickMethodPayload(data = {}) {
    const out = {
        zone_id: data.zone_id,
        name: data.name,
        name_ar: data.name_ar || "",
        type: data.type,
        is_active: data.is_active !== false,
        sort_order: Number(data.sort_order || 0),
        delivery_time_min_days: data.delivery_time_min_days === "" || data.delivery_time_min_days === undefined ? null : Number(data.delivery_time_min_days),
        delivery_time_max_days: data.delivery_time_max_days === "" || data.delivery_time_max_days === undefined ? null : Number(data.delivery_time_max_days),
        base_cost: Number(data.base_cost || 0),
        min_fee: Number(data.min_fee || 0),
        max_fee: data.max_fee === "" || data.max_fee === undefined || data.max_fee === null ? null : Number(data.max_fee),
        flat_config: undefined,
        weight_config: undefined,
        class_config: undefined,
        rule_config: undefined,
    };
    if (data.type === "flat") {
        out.flat_config = {
            per_item_cost: Number(data.flat_config?.per_item_cost || 0),
            per_vendor_cost: Number(data.flat_config?.per_vendor_cost || 0),
        };
    } else if (data.type === "weight_tier") {
        out.weight_config = {
            tiers: (data.weight_config?.tiers || []).map((t) => ({
                min_weight: Number(t.min_weight || 0),
                max_weight: t.max_weight === "" || t.max_weight === undefined || t.max_weight === null ? null : Number(t.max_weight),
                cost: Number(t.cost || 0),
            })),
        };
    } else if (data.type === "class_based") {
        out.class_config = {
            default_class_cost: Number(data.class_config?.default_class_cost || 0),
            class_rates: (data.class_config?.class_rates || []).map((r) => ({
                shipping_class_id: r.shipping_class_id,
                cost: Number(r.cost || 0),
                handling_fee: Number(r.handling_fee || 0),
                surcharge_percent: Number(r.surcharge_percent || 0),
            })),
        };
    } else if (data.type === "rule_engine") {
        out.rule_config = { rules: data.rule_config?.rules || [] };
    }
    return out;
}

const createMethod = async (data) => {
    const method = await ShippingMethod.create(pickMethodPayload(data));
    bump();
    return method;
};

const updateMethod = async (id, data) => {
    const method = await ShippingMethod.findById(id);
    if (!method) throw new Error("Shipping method not found");
    const payload = pickMethodPayload({ ...method.toObject(), ...data });
    Object.assign(method, payload);
    // Ensure type-config swaps take effect (Mongoose may keep stale subdocs).
    method.flat_config = payload.flat_config;
    method.weight_config = payload.weight_config;
    method.class_config = payload.class_config;
    method.rule_config = payload.rule_config;
    await method.save();
    bump();
    return method;
};

const deleteMethod = async (id) => {
    const method = await ShippingMethod.findByIdAndDelete(id);
    if (!method) throw new Error("Shipping method not found");
    bump();
    return method;
};

/* ============================ Policies ============================ */

const listPolicies = () => ShippingPolicy.find().sort({ priority: 1, name: 1 }).populate("zone_id", "name name_ar").lean();
const getPolicy = (id) => ShippingPolicy.findById(id).populate("zone_id", "name name_ar").lean();

function pickPolicyPayload(data = {}) {
    return {
        name: data.name,
        name_ar: data.name_ar || "",
        is_active: data.is_active !== false,
        priority: Number(data.priority || 0),
        scope: data.scope === "zone" ? "zone" : "global",
        zone_id: data.scope === "zone" ? data.zone_id || null : null,
        applies_to: {
            shipping_class_ids: data.applies_to?.shipping_class_ids || [],
            vendor_ids: data.applies_to?.vendor_ids || [],
            category_ids: data.applies_to?.category_ids || [],
        },
        condition_logic: data.condition_logic === "any" ? "any" : "all",
        conditions: data.conditions || [],
        actions: data.actions || [],
    };
}

const createPolicy = async (data) => {
    const policy = await ShippingPolicy.create(pickPolicyPayload(data));
    bump();
    return policy;
};

const updatePolicy = async (id, data) => {
    const policy = await ShippingPolicy.findById(id);
    if (!policy) throw new Error("Shipping policy not found");
    Object.assign(policy, pickPolicyPayload({ ...policy.toObject(), ...data }));
    await policy.save();
    bump();
    return policy;
};

const deletePolicy = async (id) => {
    const policy = await ShippingPolicy.findByIdAndDelete(id);
    if (!policy) throw new Error("Shipping policy not found");
    bump();
    return policy;
};

/* ============================ Settings ============================ */

const getSettingsDoc = async () => {
    let s = await ShippingSettings.findOne();
    if (!s) s = await ShippingSettings.create({});
    return s;
};

const updateSettings = async (data) => {
    const s = await getSettingsDoc();
    if (data.enabled !== undefined) s.enabled = !!data.enabled;
    if (data.multi_vendor_mode !== undefined) s.multi_vendor_mode = data.multi_vendor_mode;
    if (data.no_zone_behavior !== undefined) s.no_zone_behavior = data.no_zone_behavior;
    if (data.no_zone_flat_cost !== undefined) s.no_zone_flat_cost = Number(data.no_zone_flat_cost || 0);
    if (data.default_weight_unit !== undefined) s.default_weight_unit = data.default_weight_unit;
    if (data.cache_ttl_seconds !== undefined) s.cache_ttl_seconds = Number(data.cache_ttl_seconds || 0);
    if (data.auto_pickup_enabled !== undefined) s.auto_pickup_enabled = !!data.auto_pickup_enabled;
    if (data.default_pickup_time_slot !== undefined) s.default_pickup_time_slot = data.default_pickup_time_slot;
    if (data.pickup_batch_threshold !== undefined) s.pickup_batch_threshold = Math.max(1, Number(data.pickup_batch_threshold) || 1);
    if (data.pickup_cutoff_hour !== undefined) s.pickup_cutoff_hour = Math.min(23, Math.max(0, Number(data.pickup_cutoff_hour) || 16));
    if (data.pickup_skip_fridays !== undefined) s.pickup_skip_fridays = !!data.pickup_skip_fridays;
    if (data.smart_label_enabled !== undefined) s.smart_label_enabled = !!data.smart_label_enabled;
    if (data.courier_provider !== undefined) {
        const couriers = require("./couriers");
        if (!couriers.isProvider(data.courier_provider)) throw new Error(`Unknown courier "${data.courier_provider}"`);
        if (data.courier_provider === "arrive" && !require("./couriers/arrive/client").isConfigured()) {
            throw new Error("Arrive cannot be the default courier until ARRIVE_API_USER / ARRIVE_API_PASSWORD are configured");
        }
        s.courier_provider = data.courier_provider;
        couriers.invalidateDefaultCourier();
    }
    // Sub-order deadlines. Whitelisted here for the same reason as everything above: a field
    // omitted from this list silently cannot be changed from the admin screen.
    if (data.vendor_action_deadline_hours !== undefined) {
        s.vendor_action_deadline_hours = Math.max(1, Number(data.vendor_action_deadline_hours) || 48);
    }
    if (data.vendor_deadline_reminder_hours !== undefined) {
        s.vendor_deadline_reminder_hours = Math.max(0, Number(data.vendor_deadline_reminder_hours) || 0);
    }
    // When to warn that the prepaid Bosta bundle is about to end — on parcels left and on
    // days left, because either one ending strands the other.
    if (data.bundle_low_orders_threshold !== undefined) {
        s.bundle_low_orders_threshold = Math.max(0, Number(data.bundle_low_orders_threshold) || 0);
    }
    if (data.bundle_low_days_threshold !== undefined) {
        s.bundle_low_days_threshold = Math.max(0, Number(data.bundle_low_days_threshold) || 0);
    }
    // How each courier settles COD. Replaced wholesale rather than merged: the screen sends
    // the full list, and a merge would leave a courier that was removed from it behind.
    if (Array.isArray(data.courier_cod_settlement)) {
        const couriers = require("./couriers");
        s.courier_cod_settlement = data.courier_cod_settlement
            .filter((row) => row?.provider && couriers.isProvider(row.provider))
            .map((row) => ({
                provider: row.provider,
                cod_mode: row.cod_mode === "gross" ? "gross" : "net",
            }));
    }
    await s.save();
    bump();
    return s;
};

/* ============================ Read helpers (checkout) ============================ */

/** Build the country -> cities tree for the checkout zone picker, from active zones. */
const getZonePickerTree = async () => {
    const zones = await ShippingZone.find({ is_active: true }).lean();
    const byCountry = new Map(); // key (lowercased country) -> { country, country_ar, hasWildcard, cities: Map(lowerCity -> {city, city_ar}) }
    for (const z of zones) {
        for (const loc of z.locations || []) {
            if (!loc.country) continue;
            const key = loc.country.trim().toLowerCase();
            if (!byCountry.has(key)) {
                byCountry.set(key, { country: loc.country.trim(), country_ar: loc.country_ar || "", hasWildcard: false, cities: new Map() });
            }
            const entry = byCountry.get(key);
            if (!entry.country_ar && loc.country_ar) entry.country_ar = loc.country_ar;
            if (!loc.city) {
                entry.hasWildcard = true;
            } else {
                const ck = loc.city.trim().toLowerCase();
                if (!entry.cities.has(ck)) entry.cities.set(ck, { city: loc.city.trim(), city_ar: loc.city_ar || "" });
                else if (!entry.cities.get(ck).city_ar && loc.city_ar) entry.cities.get(ck).city_ar = loc.city_ar;
            }
        }
    }
    return [...byCountry.values()]
        .map((e) => ({
            country: e.country,
            country_ar: e.country_ar,
            has_whole_country_option: e.hasWildcard,
            cities: [...e.cities.values()].sort((a, b) => a.city.localeCompare(b.city)),
        }))
        .sort((a, b) => a.country.localeCompare(b.country));
};

/* ============================ Admin test console ============================ */

const runTestCalculation = async ({ items, destination, method_id, mode } = {}) => {
    // Resolve any { sku, quantity } rows to product ids.
    const resolved = [];
    for (const it of Array.isArray(items) ? items : []) {
        if (it && it.sku && !it.product_id && !it.product) {
            const p = await Product.findOne({ sku: String(it.sku).trim() }).select("_id").lean();
            if (p) resolved.push({ product_id: String(p._id), variant_id: it.variant_id || null, quantity: Number(it.quantity || 1) });
        } else {
            resolved.push(it);
        }
    }

    const dest = { country: destination?.country || null, city: destination?.city || null };
    const zone = await engine.resolveZoneForDestination(dest);
    let matched_by = "none";
    if (zone) {
        const country = (dest.country || "").toLowerCase();
        const city = (dest.city || "").toLowerCase();
        for (const loc of zone.locations || []) {
            if (loc.country && loc.country.toLowerCase() === country) {
                if (loc.city && city && loc.city.toLowerCase() === city) { matched_by = "city"; break; }
                if (!loc.city) matched_by = "country_wildcard";
            }
        }
    }

    const quote = await engine.getQuoteForDestination({ items: resolved, destination: dest, mode, useCache: false });
    let methods = quote.available_methods || [];
    if (method_id) methods = methods.filter((m) => String(m.id) === String(method_id));

    return {
        enabled: quote.enabled,
        blocked: !!quote.blocked,
        resolved_zone: zone ? { id: String(zone._id), name: zone.name, name_ar: zone.name_ar || zone.name, matched_by } : { id: null, name: null, matched_by: "none" },
        mode: quote.mode,
        settings: quote.settings,
        methods,
    };
};

module.exports = {
    // zones
    listZones, getZone, createZone, updateZone, deleteZone,
    // classes
    listClasses, getClass, listActiveClasses, createClass, updateClass, deleteClass,
    // methods
    listMethods, getMethod, createMethod, updateMethod, deleteMethod,
    // policies
    listPolicies, getPolicy, createPolicy, updatePolicy, deletePolicy,
    // settings
    getSettingsDoc, updateSettings,
    // read helpers
    getZonePickerTree,
    resolveZoneForDestination: engine.resolveZoneForDestination,
    getActivePoliciesForZone: engine.getActivePoliciesForZone,
    // test
    runTestCalculation,
};
