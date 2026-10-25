/**
 * Pure (DB-free) helpers shared by the rule-engine method path and the policy path.
 *
 * A "context" (ctx) object has the shape produced by shippingEngine.buildContext():
 *   {
 *     cart_total, cart_total_after_discount, item_count, vendor_count,
 *     total_weight, has_null_weight,
 *     classes:   Set<string>,   // shipping_class_id values present
 *     categories:Set<string>,   // category_id values present
 *     vendors:   Set<string>,   // vendor_id values present
 *     country, city,            // destination strings (may be null)
 *   }
 *
 * Determinism: no Date.now(), no Math.random(), no unsorted iteration.
 */

const NUMERIC_FIELDS = new Set([
    "cart_total",
    "cart_total_after_discount",
    "total_weight",
    "item_count",
    "vendor_count",
]);

const MEMBERSHIP_FIELDS = new Set(["has_class", "has_category", "has_vendor"]);
const STRING_FIELDS = new Set(["country", "city"]);

function asNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function normStr(v) {
    return v === null || v === undefined ? "" : String(v).trim().toLowerCase();
}

function toIdSet(field, ctx) {
    if (field === "has_class") return ctx.classes || new Set();
    if (field === "has_category") return ctx.categories || new Set();
    if (field === "has_vendor") return ctx.vendors || new Set();
    return new Set();
}

function evaluateCondition(condition, ctx) {
    const { field, operator } = condition || {};
    if (!field || !operator) return false;
    const value = condition.value;

    // --- Membership fields (has_class / has_category / has_vendor) ---
    if (MEMBERSHIP_FIELDS.has(field)) {
        const idSet = toIdSet(field, ctx);
        const wanted = Array.isArray(value) ? value.map((x) => String(x)) : [String(value)];
        const present = wanted.some((id) => idSet.has(id));
        switch (operator) {
            case "eq":
            case "in":
            case "contains":
                return present;
            case "ne":
            case "not_in":
                return !present;
            default:
                return false;
        }
    }

    // --- String fields (country / city) ---
    if (STRING_FIELDS.has(field)) {
        const actual = normStr(ctx[field]);
        if (operator === "in" || operator === "not_in") {
            const list = (Array.isArray(value) ? value : [value]).map(normStr);
            const found = list.includes(actual);
            return operator === "in" ? found : !found;
        }
        const expected = normStr(value);
        switch (operator) {
            case "eq":
                return actual === expected;
            case "ne":
                return actual !== expected;
            case "contains":
                return expected.length > 0 && actual.includes(expected);
            default:
                return false;
        }
    }

    // --- Numeric fields ---
    if (NUMERIC_FIELDS.has(field)) {
        const actual = asNumber(ctx[field]);
        if (operator === "in" || operator === "not_in") {
            const list = (Array.isArray(value) ? value : [value]).map(asNumber);
            const found = list.includes(actual);
            return operator === "in" ? found : !found;
        }
        const expected = asNumber(value);
        switch (operator) {
            case "eq":
                return actual === expected;
            case "ne":
                return actual !== expected;
            case "gt":
                return actual > expected;
            case "gte":
                return actual >= expected;
            case "lt":
                return actual < expected;
            case "lte":
                return actual <= expected;
            default:
                return false;
        }
    }

    return false;
}

function evaluateConditions(conditions, logic, ctx) {
    const list = Array.isArray(conditions) ? conditions : [];
    if (list.length === 0) return true; // no conditions = always matches
    if (logic === "any") return list.some((c) => evaluateCondition(c, ctx));
    return list.every((c) => evaluateCondition(c, ctx));
}

/**
 * Apply a list of rule-engine actions to a running cost.
 * Returns { cost, stop } where `stop` is true when a free_shipping action fired.
 * Pushes adjustment records (`{ source, label, amount }`) into `sink`.
 * `clamp` is mutated by set_min_fee / set_max_fee.
 */
function applyRuleActions(cost, actions, clamp, sink, ruleName) {
    let stop = false;
    for (const action of Array.isArray(actions) ? actions : []) {
        const v = asNumber(action && action.value);
        const before = cost;
        switch (action && action.type) {
            case "add_fixed":
                cost += v;
                break;
            case "add_percent":
                cost += (cost * v) / 100;
                break;
            case "set_cost":
                cost = v;
                break;
            case "free_shipping":
                cost = 0;
                stop = true;
                break;
            case "set_min_fee":
                clamp.min = v;
                break;
            case "set_max_fee":
                clamp.max = v;
                break;
            default:
                continue;
        }
        sink.push({
            source: "rule",
            label: `${ruleName || "Rule"} · ${action.type}`,
            amount: Number((cost - before).toFixed(4)),
        });
    }
    return { cost, stop };
}

/**
 * Apply a list of policy actions to a running cost.
 * Returns { cost, freeShipping } and pushes both adjustment records (into `sink`)
 * and policy-applied records (into `policySink`). `clamp` is mutated.
 *
 * `ctx` is the leg context. Most actions only need the running cost; the one that reads
 * the basket (`surcharge_percent_above`) needs the context to do so. It is optional so a
 * caller that has no context still gets every other action.
 */
function applyPolicyActions(cost, actions, clamp, sink, policySink, policy, ctx = {}) {
    let freeShipping = false;
    for (const action of Array.isArray(actions) ? actions : []) {
        const v = asNumber(action && action.value);
        const before = cost;
        switch (action && action.type) {
            case "free_shipping":
                cost = 0;
                freeShipping = true;
                break;
            case "percent_discount":
                cost -= (cost * v) / 100;
                break;
            case "fixed_discount":
                cost -= v;
                break;
            case "surcharge_fixed":
                cost += v;
                break;
            case "surcharge_percent":
                cost += (cost * v) / 100;
                break;
            case "surcharge_percent_above": {
                // A percentage of the BASKET above a threshold, not of the shipping cost.
                // Measured on the post-coupon subtotal because that is what the courier
                // actually collects at the door, and in split mode the context is one
                // parcel's items — so the threshold applies per parcel, exactly as the
                // courier applies it per delivery.
                const basket = asNumber(ctx.cart_total_after_discount ?? ctx.cart_total);
                const excess = Math.max(0, basket - asNumber(action.threshold));
                cost += (excess * v) / 100;
                break;
            }
            case "set_min_fee":
                clamp.min = v;
                break;
            case "set_max_fee":
                clamp.max = v;
                break;
            case "override_cost":
                cost = v;
                break;
            default:
                continue;
        }
        cost = Math.max(0, cost);
        const delta = Number((cost - before).toFixed(4));
        sink.push({ source: "policy", label: `${policy.name || "Policy"} · ${action.type}`, amount: delta });
        policySink.push({
            policy_id: policy._id,
            name: policy.name || "Policy",
            action: action.type,
            amount: delta,
        });
    }
    return { cost, freeShipping };
}

module.exports = {
    evaluateCondition,
    evaluateConditions,
    applyRuleActions,
    applyPolicyActions,
};
