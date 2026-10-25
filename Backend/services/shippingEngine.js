/**
 * Shipping calculation engine.
 *
 * Public API:
 *   - getQuoteForDestination({ items, destination, mode, useCache }) -> available methods + costs (for checkout)
 *   - computeShippingForOrder({ items, destination, method_id, mode, couponDiscountTotal }) -> full order `shipping` snapshot
 *   - recomputeFromSnapshot(order)                  -> re-quotes an order off its frozen config_snapshot (mutates)
 *   - resolveZoneForDestination(destination)        -> best-match active zone or null
 *   - getActivePoliciesForZone(zoneId)              -> active global + zone-scoped policies, sorted
 *   - assignVendorShippingCosts(order)              -> sets vendor_supervisions[].shipping_cost from order.shipping
 *   - invalidateShippingCache()                     -> clears the in-process quote cache
 *
 * Determinism: no Date.now()/Math.random() inside cost math; every collection is sorted by an
 * explicit key before iteration; rounding happens once, at the end of computeLeg.
 */

const mongoose = require("mongoose");
const { ShippingZone } = require("../models/shipping_zones");
const { ShippingMethod } = require("../models/shipping_methods");
const { ShippingPolicy } = require("../models/shipping_policies");
const { ShippingClass } = require("../models/shipping_classes");
const { ShippingSettings } = require("../models/shipping_settings");
const { Product } = require("../models/products");
const { Bundle } = require("../models/bundles");
const { evaluateConditions, applyRuleActions, applyPolicyActions } = require("./shippingRules");

/* ============================ in-process cache ============================ */

const _cache = new Map(); // key -> { value, expiresAt }
let _configVersion = 1;
const CACHE_MAX_ENTRIES = 5000;

function invalidateShippingCache() {
    _cache.clear();
    _configVersion++;
    _settingsMemo = null;
}

function _cacheGet(key) {
    const hit = _cache.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expiresAt) {
        _cache.delete(key);
        return undefined;
    }
    return hit.value;
}

function _cacheSet(key, value, ttlSeconds) {
    if (!ttlSeconds || ttlSeconds <= 0) return;
    if (_cache.size >= CACHE_MAX_ENTRIES) {
        const oldest = _cache.keys().next().value;
        if (oldest !== undefined) _cache.delete(oldest);
    }
    _cache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/* ============================ small helpers ============================ */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function normalizeDestination(destination = {}) {
    const country = destination && destination.country ? String(destination.country).trim() : null;
    let city = destination && destination.city ? String(destination.city).trim() : null;
    if (city === "") city = null;
    return { country: country || null, city };
}

function idStr(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "object" && v._id) return String(v._id);
    return String(v);
}

function stableStringify(obj) {
    if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
    if (obj && typeof obj === "object") {
        const keys = Object.keys(obj).sort();
        return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
    }
    return JSON.stringify(obj === undefined ? null : obj);
}

/** A stable signature of the raw cart items (before enrichment), for caching. */
function rawItemSignature(items = []) {
    const sig = (Array.isArray(items) ? items : [])
        .map((it) => ({
            p: idStr(it.product?._id || it.product?.id || it.product_id || it.product),
            v: idStr(it.variant?._id || it.variant_id || null),
            q: Number(it.quantity || it.qty || 1),
        }))
        .sort((a, b) => (a.p || "").localeCompare(b.p || "") || (a.v || "").localeCompare(b.v || ""));
    return stableStringify(sig);
}

/* ============================ settings & class names ============================ */

let _settingsMemo = null;
let _settingsMemoAt = 0;
async function getSettings() {
    // Short memo: settings change rarely; invalidated implicitly by the 5s window.
    if (_settingsMemo && Date.now() - _settingsMemoAt < 5000) return _settingsMemo;
    let s = await ShippingSettings.findOne().lean();
    if (!s) s = {};
    _settingsMemo = {
        enabled: s.enabled !== false,
        // "split" prices each (vendor, branch) parcel on its own leg; "combined" prices the
        // basket once and apportions it afterwards. Both feed `per_vendor[]`, so the COD
        // split works either way — the choice is purely how the shipping TOTAL is arrived at.
        // The stored value wins; the fallback only applies before the settings row exists.
        multi_vendor_mode: ["combined", "split"].includes(s.multi_vendor_mode) ? s.multi_vendor_mode : "split",
        no_zone_behavior: ["free", "block", "flat"].includes(s.no_zone_behavior) ? s.no_zone_behavior : "free",
        no_zone_flat_cost: Number(s.no_zone_flat_cost || 0),
        default_weight_unit: s.default_weight_unit || "kg",
        cache_ttl_seconds: Number(s.cache_ttl_seconds ?? 300),
        // Bosta pickup scheduling. This memo whitelists fields, so anything omitted here
        // reads as undefined at the call site — which is how these five silently did
        // nothing. Defaults mirror the schema.
        auto_pickup_enabled: s.auto_pickup_enabled === true,
        default_pickup_time_slot: s.default_pickup_time_slot || "10:00 to 13:00",
        pickup_batch_threshold: Number(s.pickup_batch_threshold ?? 1),
        pickup_cutoff_hour: Number(s.pickup_cutoff_hour ?? 16),
        pickup_skip_fridays: s.pickup_skip_fridays !== false,
        // Smart Label master switch. Same whitelist caveat as above: omitting it here would
        // make the feature read as permanently off.
        smart_label_enabled: s.smart_label_enabled === true,
        // How long a vendor has to carry a parcel to "ready for pickup", and how long
        // before that they are reminded. Same whitelist caveat as above.
        vendor_action_deadline_hours: Number(s.vendor_action_deadline_hours ?? 48),
        vendor_deadline_reminder_hours: Number(s.vendor_deadline_reminder_hours ?? 12),
    };
    _settingsMemoAt = Date.now();
    return _settingsMemo;
}
function _invalidateSettingsMemo() {
    _settingsMemo = null;
}

async function getClassNameMap() {
    const classes = await ShippingClass.find().select("name name_ar").lean();
    const map = new Map();
    for (const c of classes) map.set(String(c._id), { name: c.name, name_ar: c.name_ar || c.name });
    return map;
}

/* ============================ item enrichment ============================ */

/**
 * Turn caller-supplied items (any of: { product:{_id}, variant:{_id}, quantity },
 * { product_id, variant_id, quantity }, or already-priced order items) into fully
 * resolved "leg items": { product_id, variant_id, quantity, unit_price, vendor_id,
 * category_id, weight, shipping_class_id }. Invalid/missing products are skipped.
 */
/**
 * Replace any bundle line ({ bundle_id | bundle:{_id}, quantity } with no
 * product) by its member { product_id, variant_id, quantity } entries so the
 * shipping engine quotes every real product. Bundle price is irrelevant here —
 * only weight/vendor/class matter. Single source of truth for both the checkout
 * quote and order-time re-quote paths.
 */
async function expandBundlesForShipping(items = []) {
    const list = Array.isArray(items) ? items : [];
    const idOf = (it) => idStr(it.bundle?._id || it.bundle?.id || it.bundle_id || null);
    const hasProduct = (it) => !!(it.product?._id || it.product_id || it.product);
    const bundleIds = list
        .filter(it => idOf(it) && !hasProduct(it))
        .map(idOf)
        .filter(id => mongoose.Types.ObjectId.isValid(id));
    if (!bundleIds.length) return list;

    const ids = [...new Set(bundleIds)];
    const bundles = await Bundle.find({ _id: { $in: ids } }).select('members').lean();
    const byId = new Map(bundles.map(b => [String(b._id), b]));

    const out = [];
    for (const it of list) {
        const bundleId = idOf(it);
        if (bundleId && !hasProduct(it) && byId.has(bundleId)) {
            const bundleQty = Math.max(1, Number(it.quantity || it.qty || 1) || 1);
            for (const m of (byId.get(bundleId).members || [])) {
                out.push({
                    product_id: m.product_id,
                    variant_id: m.variant_id || null,
                    quantity: (Math.max(1, Number(m.quantity) || 1)) * bundleQty,
                });
            }
        } else {
            out.push(it);
        }
    }
    return out;
}

async function enrichItems(rawItems = []) {
    const items = await expandBundlesForShipping(rawItems);
    const list = Array.isArray(items) ? items : [];
    const wanted = [];
    const parsed = list.map((it) => {
        const productId = idStr(it.product?._id || it.product?.id || it.product_id || it.product);
        const variantId = idStr(it.variant?._id || it.variant_id || null);
        const quantity = Math.max(1, Number(it.quantity || it.qty || 1) || 1);
        const unitPrice = Number.isFinite(Number(it.unit_price)) ? Number(it.unit_price) : null;
        if (productId && mongoose.Types.ObjectId.isValid(productId)) wanted.push(productId);
        return { productId, variantId, quantity, unitPrice };
    });

    const uniqueIds = [...new Set(wanted)];
    const products = uniqueIds.length
        ? await Product.find({ _id: { $in: uniqueIds } })
              .select("price discount_price variants vendor_id category_id weight shipping_class_id")
              .lean()
        : [];
    const pMap = new Map(products.map((p) => [String(p._id), p]));

    const out = [];
    for (const it of parsed) {
        if (!it.productId) continue;
        const p = pMap.get(it.productId);
        if (!p) continue;

        let unitPrice = it.unitPrice;
        if (unitPrice === null) {
            let variant = null;
            if (it.variantId) variant = (p.variants || []).find((v) => String(v._id) === it.variantId) || null;
            if (!variant && (p.variants || []).length) variant = p.variants[0];
            const variantPrice = variant ? (variant.discount_price ?? variant.price) : null;
            const basePrice = p.discount_price ?? p.price;
            unitPrice = Number(variantPrice ?? basePrice ?? 0);
        }

        out.push({
            product_id: it.productId,
            variant_id: it.variantId,
            quantity: it.quantity,
            unit_price: Number(unitPrice) || 0,
            vendor_id: idStr(p.vendor_id),
            category_id: idStr(p.category_id),
            weight: p.weight === null || p.weight === undefined ? null : Number(p.weight),
            shipping_class_id: idStr(p.shipping_class_id),
        });
    }
    return out;
}

function splitLegItemsByVendor(legItems = []) {
    const groups = new Map(); // vendorId -> legItems[]
    for (const it of legItems) {
        const vid = it.vendor_id || "__unknown__";
        if (!groups.has(vid)) groups.set(vid, []);
        groups.get(vid).push(it);
    }
    // Stable order by vendor id.
    return [...groups.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

function legSubtotal(legItems = []) {
    return legItems.reduce((s, it) => s + Number(it.unit_price || 0) * Number(it.quantity || 0), 0);
}

/* ============================ context ============================ */

function buildContext(legItems = [], destination = {}, couponDiscountForLeg = 0) {
    const cartTotal = legSubtotal(legItems);
    const classes = new Set();
    const categories = new Set();
    const vendors = new Set();
    let itemCount = 0;
    let totalWeight = 0;
    let hasNullWeight = false;
    let hasUnclassed = false;

    for (const it of legItems) {
        itemCount += Number(it.quantity || 0);
        if (it.weight === null || it.weight === undefined) {
            hasNullWeight = true;
        } else {
            totalWeight += Number(it.weight) * Number(it.quantity || 0);
        }
        if (it.shipping_class_id) classes.add(String(it.shipping_class_id));
        else hasUnclassed = true;
        if (it.category_id) categories.add(String(it.category_id));
        if (it.vendor_id) vendors.add(String(it.vendor_id));
    }

    return {
        cart_total: round2(cartTotal),
        cart_total_after_discount: round2(Math.max(0, cartTotal - Number(couponDiscountForLeg || 0))),
        item_count: itemCount,
        vendor_count: vendors.size,
        total_weight: round2(totalWeight),
        has_null_weight: hasNullWeight,
        classes,
        categories,
        vendors,
        country: destination.country || null,
        city: destination.city || null,
        _has_unclassed: hasUnclassed,
    };
}

/* ============================ leg computation ============================ */

/**
 * Compute the shipping cost for one "leg" (the whole cart in combined mode,
 * or one vendor's items in split mode).
 * @returns { base_cost, adjustments, policies_applied, warnings, total_cost, total_weight }
 */
function computeLeg({ legItems, destination, methodDoc, policyDocs = [], couponDiscountForLeg = 0, classNameMap = new Map() }) {
    const m = methodDoc && methodDoc.toObject ? methodDoc.toObject() : methodDoc || {};
    const ctx = buildContext(legItems, destination, couponDiscountForLeg);

    const adjustments = [];
    const policies_applied = [];
    const warnings = [];
    const clamp = {
        min: m.min_fee === null || m.min_fee === undefined ? 0 : Number(m.min_fee),
        max: m.max_fee === null || m.max_fee === undefined ? Infinity : Number(m.max_fee),
    };

    // 1. Base cost.
    let cost = Number(m.base_cost || 0);
    adjustments.push({ source: "base", label: "Base cost", amount: round2(cost) });

    // 2. Type-specific computation.
    if (m.type === "flat") {
        const cfg = m.flat_config || {};
        const perItem = Number(cfg.per_item_cost || 0);
        const perVendor = Number(cfg.per_vendor_cost || 0);
        if (perItem) {
            const add = perItem * ctx.item_count;
            cost += add;
            adjustments.push({ source: "per_item", label: `Per item × ${ctx.item_count}`, amount: round2(add) });
        }
        if (perVendor) {
            const add = perVendor * ctx.vendor_count;
            cost += add;
            adjustments.push({ source: "per_vendor", label: `Per vendor × ${ctx.vendor_count}`, amount: round2(add) });
        }
    } else if (m.type === "weight_tier") {
        const tiers = [...((m.weight_config && m.weight_config.tiers) || [])].sort(
            (a, b) => Number(a.min_weight || 0) - Number(b.min_weight || 0)
        );
        const w = ctx.total_weight;
        let tier = tiers.find((t) => {
            const max = t.max_weight === null || t.max_weight === undefined ? Infinity : Number(t.max_weight);
            return w >= Number(t.min_weight || 0) && w < max;
        });
        if (!tier && tiers.length) tier = tiers[tiers.length - 1];
        if (tier) {
            cost += Number(tier.cost || 0);
            const maxLabel = tier.max_weight === null || tier.max_weight === undefined ? "∞" : tier.max_weight;
            adjustments.push({
                source: "weight",
                label: `Weight ${tier.min_weight || 0}–${maxLabel} ${"kg"}`,
                amount: round2(tier.cost || 0),
            });
        }
        if (ctx.has_null_weight) warnings.push("Some items have no weight set; treated as 0 kg for shipping.");
    } else if (m.type === "class_based") {
        const cfg = m.class_config || {};
        const rateMap = new Map();
        for (const r of cfg.class_rates || []) rateMap.set(idStr(r.shipping_class_id), r);
        let surchargePct = 0;
        const classIds = [...ctx.classes].sort();
        for (const cid of classIds) {
            const r = rateMap.get(cid);
            if (!r) continue;
            const add = Number(r.cost || 0) + Number(r.handling_fee || 0);
            if (add) {
                cost += add;
                const cn = classNameMap.get(cid);
                adjustments.push({ source: "class", label: cn ? cn.name : "Class", amount: round2(add) });
            }
            surchargePct += Number(r.surcharge_percent || 0);
        }
        if (ctx._has_unclassed) {
            const add = Number(cfg.default_class_cost || 0);
            if (add) {
                cost += add;
                adjustments.push({ source: "class", label: "Default class cost", amount: round2(add) });
            }
        }
        if (surchargePct) {
            const before = cost;
            cost *= 1 + surchargePct / 100;
            adjustments.push({ source: "class", label: `Class surcharges +${surchargePct}%`, amount: round2(cost - before) });
        }
    } else if (m.type === "rule_engine") {
        const rules = [...((m.rule_config && m.rule_config.rules) || [])]
            .map((r, i) => ({ r, i }))
            .sort((a, b) => Number(a.r.priority || 0) - Number(b.r.priority || 0) || a.i - b.i);
        for (const { r } of rules) {
            if (!evaluateConditions(r.conditions, r.condition_logic, ctx)) continue;
            const res = applyRuleActions(cost, r.actions, clamp, adjustments, r.name);
            cost = res.cost;
            if (res.stop || r.stop_processing) break;
        }
    }

    // 3. Clamp #1 (post-method).
    {
        const clamped = Math.min(Math.max(cost, clamp.min), clamp.max);
        if (clamped !== cost) {
            adjustments.push({
                source: clamped === clamp.min ? "clamp_min" : "clamp_max",
                label: "Method min/max fee",
                amount: round2(clamped - cost),
            });
            cost = clamped;
        }
    }

    // 4. Policies (global + zone-scoped), sorted by priority then array index.
    const sortedPolicies = [...(policyDocs || [])]
        .map((p, i) => ({ p: p && p.toObject ? p.toObject() : p, i }))
        .sort((a, b) => Number(a.p.priority || 0) - Number(b.p.priority || 0) || a.i - b.i);
    for (const { p } of sortedPolicies) {
        const at = p.applies_to || {};
        const classFilter = (at.shipping_class_ids || []).map(idStr);
        const vendorFilter = (at.vendor_ids || []).map(idStr);
        const categoryFilter = (at.category_ids || []).map(idStr);
        if (classFilter.length && !classFilter.some((id) => ctx.classes.has(id))) continue;
        if (vendorFilter.length && !vendorFilter.some((id) => ctx.vendors.has(id))) continue;
        if (categoryFilter.length && !categoryFilter.some((id) => ctx.categories.has(id))) continue;
        if (!evaluateConditions(p.conditions, p.condition_logic, ctx)) continue;
        const res = applyPolicyActions(cost, p.actions, clamp, adjustments, policies_applied, p, ctx);
        cost = Math.max(0, res.cost);
    }

    // 5. Clamp #2 (final) + round once.
    {
        const clamped = Math.min(Math.max(cost, clamp.min), clamp.max);
        if (clamped !== cost) {
            adjustments.push({
                source: clamped === clamp.min ? "clamp_min" : "clamp_max",
                label: "Method min/max fee",
                amount: round2(clamped - cost),
            });
            cost = clamped;
        }
    }
    cost = Math.max(0, cost);

    return {
        base_cost: round2(Number(m.base_cost || 0)),
        adjustments,
        policies_applied,
        warnings,
        total_cost: round2(cost),
        total_weight: ctx.total_weight,
    };
}

/* ============================ zone resolution ============================ */

async function resolveZoneForDestination(destination) {
    const dest = normalizeDestination(destination);
    if (!dest.country) return null;
    const country = dest.country.toLowerCase();
    const city = dest.city ? dest.city.toLowerCase() : null;

    const zones = await ShippingZone.find({ is_active: true }).lean();
    let best = null; // { zone, exact:boolean }
    for (const z of zones) {
        let exact = false;
        let wildcard = false;
        for (const loc of z.locations || []) {
            if (!loc.country) continue;
            if (loc.country.toLowerCase() !== country) continue;
            if (loc.city && city && loc.city.toLowerCase() === city) exact = true;
            else if (!loc.city) wildcard = true;
        }
        if (!exact && !wildcard) continue;
        const cand = { zone: z, exact };
        if (!best) {
            best = cand;
            continue;
        }
        // Prefer exact over wildcard; then lower priority; then lower _id.
        if (cand.exact !== best.exact) {
            if (cand.exact) best = cand;
            continue;
        }
        const pa = Number(cand.zone.priority || 0);
        const pb = Number(best.zone.priority || 0);
        if (pa < pb) best = cand;
        else if (pa === pb && String(cand.zone._id) < String(best.zone._id)) best = cand;
    }
    return best ? best.zone : null;
}

async function getActivePoliciesForZone(zoneId) {
    return ShippingPolicy.find({
        is_active: true,
        $or: [{ scope: "global" }, { scope: "zone", zone_id: zoneId }],
    }).lean();
}

/* ============================ per-vendor allocation ============================ */

/** Allocate a combined-mode total proportionally to each vendor's subtotal; last vendor absorbs the remainder. */
function proportionalVendorSplit(legItems, totalCost) {
    const groups = splitLegItemsByVendor(legItems);
    const subtotals = groups.map(([vid, items]) => [vid, legSubtotal(items)]);
    const grand = subtotals.reduce((s, [, v]) => s + v, 0);
    const out = [];
    let allocated = 0;
    for (let i = 0; i < subtotals.length; i++) {
        const [vid, sub] = subtotals[i];
        let share;
        if (i === subtotals.length - 1) {
            share = round2(totalCost - allocated);
        } else {
            share = grand > 0 ? round2((sub / grand) * totalCost) : 0;
            allocated += share;
        }
        out.push({ vendor_id: vid === "__unknown__" ? null : vid, cost: share, adjustments: [] });
    }
    return out;
}

/** Set vendor_supervisions[].shipping_cost from the order's shipping snapshot. */
function assignVendorShippingCosts(order) {
    if (!order || !Array.isArray(order.vendor_supervisions)) return;
    const snap = order.shipping;
    if (!snap) {
        for (const sup of order.vendor_supervisions) sup.shipping_cost = 0;
        return;
    }
    if (snap.mode === "split" && Array.isArray(snap.per_vendor) && snap.per_vendor.length) {
        const map = new Map(snap.per_vendor.map((pv) => [String(pv.vendor_id), Number(pv.cost || 0)]));
        for (const sup of order.vendor_supervisions) {
            sup.shipping_cost = map.get(String(sup.vendor_id)) || 0;
        }
        return;
    }
    // Combined: proportional to total_amount.
    const grand = order.vendor_supervisions.reduce((s, sup) => s + Number(sup.total_amount || 0), 0);
    const total = Number(snap.total_cost || 0);
    let allocated = 0;
    for (let i = 0; i < order.vendor_supervisions.length; i++) {
        const sup = order.vendor_supervisions[i];
        if (i === order.vendor_supervisions.length - 1) {
            sup.shipping_cost = round2(total - allocated);
        } else {
            sup.shipping_cost = grand > 0 ? round2((Number(sup.total_amount || 0) / grand) * total) : 0;
            allocated += sup.shipping_cost;
        }
    }
}

/* ============================ synthetic (no-zone) options ============================ */

function syntheticMethod(behavior, flatCost) {
    if (behavior === "flat") {
        return {
            id: "__no_zone_flat__",
            name: "Standard shipping",
            name_ar: "الشحن القياسي",
            type: "flat",
            total_cost: round2(flatCost),
            eta_min: null,
            eta_max: null,
            adjustments: [{ source: "base", label: "Flat rate", amount: round2(flatCost) }],
            policies_applied: [],
            warnings: [],
            per_vendor: [],
        };
    }
    return {
        id: "__free__",
        name: "Free shipping",
        name_ar: "شحن مجاني",
        type: "flat",
        total_cost: 0,
        eta_min: null,
        eta_max: null,
        adjustments: [{ source: "base", label: "Free shipping", amount: 0 }],
        policies_applied: [],
        warnings: [],
        per_vendor: [],
    };
}

/* ============================ quote (checkout) ============================ */

async function getQuoteForDestination({ items, destination, mode, useCache = true } = {}) {
    const settings = await getSettings();
    if (!settings.enabled) {
        return {
            enabled: false,
            zone: null,
            mode: settings.multi_vendor_mode,
            available_methods: [],
            settings: { enabled: false, multi_vendor_mode: settings.multi_vendor_mode },
        };
    }

    const dest = normalizeDestination(destination);
    const effMode = mode === "split" ? "split" : settings.multi_vendor_mode;

    const cacheKey = useCache
        ? stableStringify({ kind: "quote", sig: rawItemSignature(items), dest, mode: effMode, cv: _configVersion })
        : null;
    if (cacheKey) {
        const cached = _cacheGet(cacheKey);
        if (cached) return cached;
    }

    const legItems = await enrichItems(items);
    const classNameMap = await getClassNameMap();
    const zone = await resolveZoneForDestination(dest);

    let result;
    if (!zone) {
        if (settings.no_zone_behavior === "block") {
            result = { enabled: true, blocked: true, zone: null, mode: effMode, available_methods: [], settings: { enabled: true, multi_vendor_mode: settings.multi_vendor_mode } };
        } else {
            result = {
                enabled: true,
                zone: null,
                mode: effMode,
                available_methods: [syntheticMethod(settings.no_zone_behavior, settings.no_zone_flat_cost)],
                settings: { enabled: true, multi_vendor_mode: settings.multi_vendor_mode },
            };
        }
    } else {
        const methods = (await ShippingMethod.find({ zone_id: zone._id, is_active: true }).lean())
            .map((m, i) => ({ m, i }))
            .sort((a, b) => Number(a.m.sort_order || 0) - Number(b.m.sort_order || 0) || String(a.m._id).localeCompare(String(b.m._id)))
            .map(({ m }) => m);
        const policies = await getActivePoliciesForZone(zone._id);

        const available_methods = methods.map((m) => {
            let total = 0;
            let adjustments = [];
            let policies_applied = [];
            const warnSet = new Set();
            let per_vendor = [];
            if (effMode === "split") {
                const groups = splitLegItemsByVendor(legItems);
                for (const [vid, vItems] of groups) {
                    const leg = computeLeg({ legItems: vItems, destination: dest, methodDoc: m, policyDocs: policies, couponDiscountForLeg: 0, classNameMap });
                    total += leg.total_cost;
                    per_vendor.push({ vendor_id: vid === "__unknown__" ? null : vid, cost: leg.total_cost, adjustments: leg.adjustments });
                    leg.warnings.forEach((w) => warnSet.add(w));
                }
                adjustments = per_vendor.map((pv) => ({ source: "base", label: "Vendor shipping", amount: pv.cost }));
            } else {
                const leg = computeLeg({ legItems, destination: dest, methodDoc: m, policyDocs: policies, couponDiscountForLeg: 0, classNameMap });
                total = leg.total_cost;
                adjustments = leg.adjustments;
                policies_applied = leg.policies_applied;
                leg.warnings.forEach((w) => warnSet.add(w));
                per_vendor = proportionalVendorSplit(legItems, total);
            }
            return {
                id: String(m._id),
                name: m.name,
                name_ar: m.name_ar || m.name,
                type: m.type,
                total_cost: round2(total),
                eta_min: m.delivery_time_min_days ?? null,
                eta_max: m.delivery_time_max_days ?? null,
                adjustments,
                policies_applied,
                warnings: [...warnSet],
                per_vendor,
            };
        });

        result = {
            enabled: true,
            zone: { _id: String(zone._id), name: zone.name, name_ar: zone.name_ar || zone.name },
            mode: effMode,
            available_methods,
            settings: { enabled: true, multi_vendor_mode: settings.multi_vendor_mode },
        };
    }

    if (cacheKey) _cacheSet(cacheKey, result, settings.cache_ttl_seconds);
    return result;
}

/* ============================ order computation ============================ */

function buildLegResult({ legItems, dest, methodDoc, policies, mode, couponDiscountTotal, classNameMap }) {
    if (mode === "split") {
        const groups = splitLegItemsByVendor(legItems);
        const grandSubtotal = legSubtotal(legItems);
        const per_vendor = [];
        const policies_applied = [];
        const warnSet = new Set();
        let total = 0;
        let baseCost = 0;
        let totalWeight = 0;
        for (const [vid, vItems] of groups) {
            const sub = legSubtotal(vItems);
            const couponForLeg = grandSubtotal > 0 ? (sub / grandSubtotal) * Number(couponDiscountTotal || 0) : 0;
            const leg = computeLeg({ legItems: vItems, destination: dest, methodDoc, policyDocs: policies, couponDiscountForLeg: couponForLeg, classNameMap });
            per_vendor.push({ vendor_id: vid === "__unknown__" ? null : vid, cost: leg.total_cost, adjustments: leg.adjustments });
            policies_applied.push(...leg.policies_applied);
            leg.warnings.forEach((w) => warnSet.add(w));
            total += leg.total_cost;
            baseCost += leg.base_cost;
            totalWeight += leg.total_weight;
        }
        return {
            base_cost: round2(baseCost),
            adjustments: per_vendor.map((pv) => ({ source: "base", label: "Vendor shipping", amount: pv.cost })),
            policies_applied,
            warnings: [...warnSet],
            total_cost: round2(total),
            total_weight: round2(totalWeight),
            per_vendor,
        };
    }
    const leg = computeLeg({ legItems, destination: dest, methodDoc, policyDocs: policies, couponDiscountForLeg: Number(couponDiscountTotal || 0), classNameMap });
    return { ...leg, per_vendor: proportionalVendorSplit(legItems, leg.total_cost) };
}

/**
 * Compute the full `shipping` snapshot object stored on an Order.
 * Throws if no_zone_behavior is 'block' and the destination matches no zone,
 * or if a given method_id does not belong to the resolved active zone.
 */
async function computeShippingForOrder({ items, destination, method_id, mode, couponDiscountTotal = 0 } = {}) {
    const settings = await getSettings();
    const dest = normalizeDestination(destination);
    const effMode = mode === "split" ? "split" : settings.multi_vendor_mode;

    if (!settings.enabled) {
        return {
            enabled: false,
            mode: effMode,
            destination: dest,
            zone_id: null,
            zone_name: "",
            method_id: null,
            method_name: "",
            method_type: "",
            total_weight: 0,
            base_cost: 0,
            adjustments: [],
            policies_applied: [],
            warnings: [],
            total_cost: 0,
            per_vendor: [],
            config_snapshot: null,
            quote_signature: stableStringify({ kind: "order", sig: rawItemSignature(items), dest, mode: effMode, enabled: false }),
        };
    }

    const legItems = await enrichItems(items);
    const classNameMap = await getClassNameMap();
    const zone = await resolveZoneForDestination(dest);

    if (!zone) {
        if (settings.no_zone_behavior === "block") {
            const err = new Error("We do not ship to the selected location yet.");
            err.code = "SHIPPING_NO_ZONE";
            throw err;
        }
        const flatCost = settings.no_zone_behavior === "flat" ? Number(settings.no_zone_flat_cost || 0) : 0;
        const hasNullWeight = legItems.some((it) => it.weight === null || it.weight === undefined);
        const totalWeight = round2(legItems.reduce((s, it) => s + (it.weight === null || it.weight === undefined ? 0 : Number(it.weight)) * Number(it.quantity || 0), 0));
        const syntheticConfig = { type: "flat", base_cost: flatCost, min_fee: 0, max_fee: null, flat_config: { per_item_cost: 0, per_vendor_cost: 0 } };
        return {
            enabled: true,
            mode: effMode,
            destination: dest,
            zone_id: null,
            zone_name: "",
            method_id: null,
            method_name: settings.no_zone_behavior === "flat" ? "Standard shipping" : "Free shipping",
            method_type: "flat",
            total_weight: totalWeight,
            base_cost: round2(flatCost),
            adjustments: [{ source: "base", label: settings.no_zone_behavior === "flat" ? "Flat rate" : "Free shipping", amount: round2(flatCost) }],
            policies_applied: [],
            warnings: hasNullWeight ? ["Some items have no weight set; treated as 0 kg for shipping."] : [],
            total_cost: round2(flatCost),
            per_vendor: proportionalVendorSplit(legItems, round2(flatCost)),
            config_snapshot: { method: syntheticConfig, policies: [] },
            quote_signature: stableStringify({ kind: "order", sig: rawItemSignature(items), dest, mode: effMode, method: "synthetic" }),
        };
    }

    // Resolve the chosen method.
    let methodDoc = null;
    if (method_id && mongoose.Types.ObjectId.isValid(String(method_id))) {
        methodDoc = await ShippingMethod.findOne({ _id: method_id, zone_id: zone._id, is_active: true }).lean();
        if (!methodDoc) {
            const err = new Error("The selected shipping method is no longer available. Please re-select your shipping option.");
            err.code = "SHIPPING_METHOD_UNAVAILABLE";
            throw err;
        }
    } else {
        // No method picked — fall back to the cheapest active method in the zone.
        const methods = await ShippingMethod.find({ zone_id: zone._id, is_active: true }).lean();
        if (!methods.length) {
            // No methods configured for this zone — treat like no-zone "free".
            methodDoc = { type: "flat", base_cost: 0, min_fee: 0, max_fee: null, flat_config: { per_item_cost: 0, per_vendor_cost: 0 }, name: "Free shipping", name_ar: "شحن مجاني", _id: null };
        } else {
            const policiesTmp = await getActivePoliciesForZone(zone._id);
            let cheapest = null;
            for (const m of methods) {
                const r = buildLegResult({ legItems, dest, methodDoc: m, policies: policiesTmp, mode: effMode, couponDiscountTotal, classNameMap });
                if (!cheapest || r.total_cost < cheapest.cost) cheapest = { method: m, cost: r.total_cost };
            }
            methodDoc = cheapest.method;
        }
    }

    const policies = await getActivePoliciesForZone(zone._id);
    const r = buildLegResult({ legItems, dest, methodDoc, policies, mode: effMode, couponDiscountTotal, classNameMap });

    return {
        enabled: true,
        mode: effMode,
        destination: dest,
        zone_id: zone._id,
        zone_name: zone.name,
        method_id: methodDoc._id || null,
        method_name: methodDoc.name || "",
        method_type: methodDoc.type || "",
        total_weight: r.total_weight,
        base_cost: r.base_cost,
        adjustments: r.adjustments,
        policies_applied: r.policies_applied,
        warnings: r.warnings,
        total_cost: r.total_cost,
        per_vendor: r.per_vendor,
        config_snapshot: { method: methodDoc, policies },
        quote_signature: stableStringify({ kind: "order", sig: rawItemSignature(items), dest, mode: effMode, method: String(methodDoc._id || "synthetic") }),
    };
}

/**
 * Re-quote an order's shipping using its frozen config_snapshot against the order's
 * (possibly modified) items. Mutates order.shipping and order.vendor_supervisions[].shipping_cost.
 * No-ops when the order has no shipping snapshot / config_snapshot (legacy or shipping-disabled orders).
 */
async function recomputeFromSnapshot(order) {
    if (!order || !order.shipping || !order.shipping.config_snapshot || !order.shipping.config_snapshot.method) return;
    const snap = order.shipping;
    const methodDoc = snap.config_snapshot.method;
    const policies = snap.config_snapshot.policies || [];
    const dest = normalizeDestination(snap.destination || {});
    const mode = snap.mode === "split" ? "split" : "combined";
    const classNameMap = await getClassNameMap();

    const couponDiscountTotal = Number(order.coupon_discount_amount || 0);
    const legItems = await enrichItems(order.items || []);
    const r = buildLegResult({ legItems, dest, methodDoc, policies, mode, couponDiscountTotal, classNameMap });

    snap.total_weight = r.total_weight;
    snap.base_cost = r.base_cost;
    snap.adjustments = r.adjustments;
    snap.policies_applied = r.policies_applied;
    snap.warnings = r.warnings;
    snap.total_cost = r.total_cost;
    snap.per_vendor = r.per_vendor;
    if (typeof order.markModified === "function") order.markModified("shipping");

    assignVendorShippingCosts(order);
}

/**
 * Price an arbitrary set of order items with an existing order's frozen shipping rules
 * (method, policies, destination) — the rules its customer was quoted with.
 *
 * Company consolidation (feature 14) uses it to price a batch's combined parcel: every
 * member ordered to the same office under the same rules, so the first member's snapshot
 * prices the whole box consistently with what each of them was shown.
 *
 * @returns {Promise<number|null>} the parcel's shipping, or null when the snapshot cannot price it
 */
async function quoteAgainstSnapshot(snapshot, items = []) {
    if (!snapshot) return null;
    if (snapshot.enabled === false) return 0;
    if (!snapshot.config_snapshot || !snapshot.config_snapshot.method) return null;
    const dest = normalizeDestination(snapshot.destination || {});
    const classNameMap = await getClassNameMap();
    const legItems = await enrichItems(items);
    const r = buildLegResult({
        legItems,
        dest,
        methodDoc: snapshot.config_snapshot.method,
        policies: snapshot.config_snapshot.policies || [],
        mode: "combined",
        couponDiscountTotal: 0,
        classNameMap,
    });
    return round2(r.total_cost);
}

module.exports = {
    quoteAgainstSnapshot,
    invalidateShippingCache,
    _invalidateSettingsMemo,
    getSettings,
    resolveZoneForDestination,
    getActivePoliciesForZone,
    getQuoteForDestination,
    computeShippingForOrder,
    recomputeFromSnapshot,
    assignVendorShippingCosts,
    // exposed for tests/debugging
    computeLeg,
    buildContext,
    enrichItems,
};
