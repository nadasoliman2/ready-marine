/**
 * The shop's default order ("featured"): the best sellers first, then every other product
 * mixed across the categories, one category at a time.
 *
 * Sorted by date alone, a list showed whatever was uploaded last, and a vendor uploads a
 * catalogue at once: the first page was 24 transmission parts in a row. Here a page reads
 * like a shop window instead:
 *
 *   1. products that have sold, most sold first (then newest);
 *   2. the rest, taking turns between the top-level categories (accessories, mechanical
 *      parts, engine, car care, …) and, inside each, between its own categories (brakes
 *      pads, then discs, then …); newest first inside a category.
 *
 * The order of a list is worked out once and kept for a minute, so the pages of one list
 * all come from the same order (nothing repeated, nothing skipped while scrolling).
 */

const { Product } = require('../models/products');
const { Category } = require('../models/categories');

const CACHE_TTL_MS = 60 * 1000;
const CACHE_LIMIT = 50;
const cache = new Map(); // query key -> { ids, at }

/** Take one from each queue in turn until all are empty. */
const takeTurns = (queues) => {
    const out = [];
    const live = queues.filter((q) => q.length).map((q) => ({ q, i: 0 }));
    while (live.length) {
        for (let k = 0; k < live.length; k += 1) {
            const entry = live[k];
            out.push(entry.q[entry.i]);
            entry.i += 1;
            if (entry.i >= entry.q.length) { live.splice(k, 1); k -= 1; }
        }
    }
    return out;
};

/** Group items by a key, keeping their order, biggest group first (ties: first seen). */
const groupsOf = (items, keyOf) => {
    const groups = new Map();
    for (const item of items) {
        const key = keyOf(item);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
    }
    return [...groups.values()].sort((a, b) => b.length - a.length);
};

/**
 * The featured order of some products.
 * @param rows        { _id, category_id, sold_count, created_at }
 * @param categories  { _id, parent_id } — the whole tree, to find each category's top level
 * @returns the ids, in order (strings)
 */
const featuredOrder = (rows, categories) => {
    const parentOf = new Map(categories.map((c) => [String(c._id), c.parent_id ? String(c.parent_id) : null]));
    const topOf = (id) => {
        let current = id ? String(id) : null;
        for (let guard = 0; current && parentOf.get(current) && guard < 20; guard += 1) current = parentOf.get(current);
        return current || 'none';
    };
    const newestFirst = (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0) || String(b._id).localeCompare(String(a._id));

    const sold = rows.filter((p) => (p.sold_count || 0) > 0)
        .sort((a, b) => (b.sold_count || 0) - (a.sold_count || 0) || newestFirst(a, b));
    const rest = rows.filter((p) => !((p.sold_count || 0) > 0)).sort(newestFirst);

    // Turns between the top-level categories; inside each, turns between its categories.
    const mixed = takeTurns(groupsOf(rest, (p) => topOf(p.category_id))
        .map((top) => takeTurns(groupsOf(top, (p) => String(p.category_id || 'none')))));

    return [...sold, ...mixed].map((p) => String(p._id));
};

/** The featured order of the products matching a listing query, kept for a minute. */
const featuredIds = async (query) => {
    const key = JSON.stringify(query);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.ids;

    const [rows, categories] = await Promise.all([
        Product.find(query).select('_id category_id sold_count created_at').lean(),
        Category.find().select('_id parent_id').lean(),
    ]);
    const ids = featuredOrder(rows, categories);
    cache.delete(key);
    cache.set(key, { ids, at: Date.now() });
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return ids;
};

module.exports = { featuredIds, featuredOrder, takeTurns };
