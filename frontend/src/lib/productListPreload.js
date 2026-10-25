// Product list pages fetched (or being fetched) by query string, so a page asked for twice —
// warmed by a category link on pointer-down, then opened; prefetched for the next scroll, then
// shown — is fetched once. Entries go stale after a few minutes (prices and stock move) and
// the oldest are dropped past a cap, since endless scrolling asks for many pages.
const productListCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_LIMIT = 80;

/** Products per page of the shop's endless list. */
export const PRODUCT_PAGE_SIZE = 24;

const getApiBase = () => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

/**
 * The query string for one page of the shop: the filters (`category_id=…&search=…`, as the
 * shop builds them), the page, and the page size. Everything that warms or loads a shop page
 * goes through here, so they all share one cache entry.
 */
export function productPageQuery(filtersQuery = '', page = 1) {
  return [filtersQuery, Number(page) > 1 ? `page=${Number(page)}` : '', `limit=${PRODUCT_PAGE_SIZE}`]
    .filter(Boolean)
    .join('&');
}

/**
 * A page's filters as a query string: the ones that are set, without the page unless
 * `withPage` (for the address bar, where `?page=3` opens the list at page 3).
 */
export function filtersToQuery(filters, { withPage = false } = {}) {
  const params = new URLSearchParams();
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (!value) return;
    if (key === 'page' && (!withPage || Number(value) <= 1)) return;
    params.set(key, value);
  });
  return params.toString();
}

/** A page of products that arrived some other way (with a store's profile), kept as fetched. */
export function seedProductList(query, data) {
  if (!data || !Array.isArray(data.products)) return;
  const key = query || '';
  productListCache.delete(key);
  productListCache.set(key, { at: Date.now(), data, error: null, promise: null });
  if (productListCache.size > CACHE_LIMIT) productListCache.delete(productListCache.keys().next().value);
}

export function preloadProductList(query = '') {
  const key = query || '';
  const cached = productListCache.get(key);
  if (cached?.promise || (cached?.data && Date.now() - cached.at < CACHE_TTL_MS)) return cached;

  const url = `${getApiBase()}/products${key ? `?${key}` : ''}`;
  const entry = {
    at: Date.now(),
    data: null,
    error: null,
    promise: fetch(url)
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch products');
        return res.json();
      })
      .then(data => {
        entry.data = data;
        entry.at = Date.now();
        return data;
      })
      .catch(error => {
        entry.error = error;
        // A failed page is not kept: the next ask tries again.
        if (productListCache.get(key) === entry) productListCache.delete(key);
        throw error;
      })
      .finally(() => {
        entry.promise = null;
      }),
  };

  productListCache.delete(key);
  productListCache.set(key, entry);
  if (productListCache.size > CACHE_LIMIT) productListCache.delete(productListCache.keys().next().value);
  return entry;
}

// Others that keep product lists (lib/useInfiniteProducts.js), told when they go stale.
const forgetListeners = new Set();

export function onForgetProductLists(fn) {
  forgetListeners.add(fn);
  return () => forgetListeners.delete(fn);
}

/**
 * Drop every product list fetched so far. A signed-in customer's list puts what fits their
 * garage first, so signing in or out, or a garage car added or removed, makes them stale.
 */
export function forgetProductLists() {
  productListCache.clear();
  forgetListeners.forEach((fn) => fn());
}

export function getPreloadedProductList(query = '') {
  return productListCache.get(query || '');
}

export function warmProductList(query = '') {
  const entry = preloadProductList(query);
  entry.promise?.catch(() => {});
  return entry;
}
