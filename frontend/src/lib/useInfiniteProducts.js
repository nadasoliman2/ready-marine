'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { onForgetProductLists, preloadProductList, productPageQuery, warmProductList } from './productListPreload';
import { stripLocale } from './locale';

/**
 * The shop's endless product list.
 *
 * Pages of `PRODUCT_PAGE_SIZE` load one after another as the visitor scrolls: a marker under
 * the grid starts the next page well before it comes into view, so the list never seems to
 * stop. After `AUTO_PAGES` pages have loaded on their own, the list waits for a "Show more"
 * press — which keeps the footer reachable — and then scrolls on by itself again. The page
 * after the last one shown is fetched in the background as soon as the browser is idle, so
 * both the scroll and the press show it at once.
 *
 * The list is remembered for a few minutes, with how far down the visitor was: opening a
 * product and coming back returns to the same products at the same place, not to the top.
 *
 * Used by every page that lists products (the shop, the girls' and trunk collections, a
 * store), with components/products/InfiniteProductGrid.jsx drawing the list.
 */

const AUTO_PAGES = 2;
const AHEAD_PX = 1200;
const MEMORY_TTL_MS = 10 * 60 * 1000;
const MEMORY_LIMIT = 8;

// listKey -> { products, nextPage, pages, total, fitFor, autoLeft, scrollY, at }
const memory = new Map();
onForgetProductLists(() => memory.clear());

// Each state carries the `key` of the list it belongs to: for one render after the filters
// change, the state is still the previous list's, and must not be taken for the new one.
const emptyList = (key, startPage) => ({
  key, products: [], nextPage: startPage, pages: null, total: 0, fitFor: null, autoLeft: AUTO_PAGES, status: 'idle', error: null,
});

const remembered = (key) => {
  const snap = memory.get(key);
  if (!snap || Date.now() - snap.at > MEMORY_TTL_MS) return null;
  return { ...snap, key, status: 'idle', error: null };
};

const remember = (listKey, state) => {
  const previous = memory.get(listKey);
  memory.delete(listKey);
  memory.set(listKey, {
    products: state.products,
    nextPage: state.nextPage,
    pages: state.pages,
    total: state.total,
    fitFor: state.fitFor,
    autoLeft: state.autoLeft,
    scrollY: previous?.scrollY ?? 0,
    at: Date.now(),
  });
  if (memory.size > MEMORY_LIMIT) memory.delete(memory.keys().next().value);
};

/** Products of a new page not already on the list (a sponsored product can appear twice). */
const appendUnique = (current, incoming) => {
  const seen = new Set(current.map((p) => String(p._id)));
  const fresh = [];
  for (const p of incoming || []) {
    const id = String(p._id);
    if (seen.has(id)) continue;
    seen.add(id);
    fresh.push(p);
  }
  return fresh.length ? [...current, ...fresh] : current;
};

const whenIdle = (fn) => {
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(fn, { timeout: 2000 });
  else setTimeout(fn, 300);
};

const hasMoreOf = (s) => s.pages === null || s.nextPage <= s.pages;

/**
 * @param {string|null} filtersQuery the filters as a query string for `/api/products`, without
 *   the page (`for_girls=true&search=…`). `null` while it is not known yet — a store's id
 *   arrives with the store — and nothing loads until it is.
 * @param {number} startPage the page the list starts at (1, unless a `?page=` link was opened)
 */
export default function useInfiniteProducts(filtersQuery, startPage = 1) {
  const listKey = `${filtersQuery}#${startPage}`;
  const [state, setState] = useState(() => remembered(listKey) || emptyList(listKey, startPage));

  const stateRef = useRef(state);
  stateRef.current = state;
  const paramsRef = useRef({ listKey, filtersQuery });
  const inFlightRef = useRef(null);
  const sentinelNodeRef = useRef(null);
  const observerRef = useRef(null);
  const restoreScrollRef = useRef(remembered(listKey)?.scrollY || null);

  // New filters: their remembered list, or a fresh one. A list whose filters were not known
  // when the page opened is, for the visitor, the one the page opened on: back to its place.
  useEffect(() => {
    if (paramsRef.current.listKey === listKey) return;
    const wasWaiting = paramsRef.current.filtersQuery == null;
    paramsRef.current = { listKey, filtersQuery };
    inFlightRef.current = null;
    const snap = remembered(listKey);
    if (wasWaiting) restoreScrollRef.current = snap?.scrollY || null;
    setState(snap || emptyList(listKey, startPage));
  }, [listKey, filtersQuery, startPage]);

  /** Load the next page. `pressed`: the visitor asked for it, so scrolling may load again. */
  const load = useCallback((pressed) => {
    const s = stateRef.current;
    const { listKey: key, filtersQuery: query } = paramsRef.current;
    if (query == null || s.key !== key || !hasMoreOf(s)) return;
    const page = s.nextPage;
    const flight = `${key}@${page}`;
    if (inFlightRef.current === flight) return;
    inFlightRef.current = flight;

    setState((prev) => ({ ...prev, status: 'loading', error: null }));
    const entry = preloadProductList(productPageQuery(query, page));
    Promise.resolve(entry.data || entry.promise)
      .then((data) => {
        if (paramsRef.current.listKey !== key) return;
        inFlightRef.current = null;
        const pages = data.pagination?.pages ?? page;
        setState((prev) => ({
          ...prev,
          products: appendUnique(prev.products, data.products),
          nextPage: page + 1,
          pages,
          total: data.pagination?.total ?? prev.total,
          fitFor: data.fit_for || prev.fitFor || null,
          // The first page is free; each page after it that loaded on its own uses one.
          autoLeft: pressed ? AUTO_PAGES : (prev.products.length === 0 ? prev.autoLeft : Math.max(0, prev.autoLeft - 1)),
          status: 'idle',
          error: null,
        }));
        if (page + 1 <= pages) whenIdle(() => warmProductList(productPageQuery(query, page + 1)));
      })
      .catch((err) => {
        if (paramsRef.current.listKey !== key) return;
        inFlightRef.current = null;
        setState((prev) => ({ ...prev, status: 'error', error: err.message || 'Failed to fetch products' }));
      });
  }, []);

  /** A page by scrolling, while the "Show more" budget lasts. */
  const autoLoad = useCallback(() => {
    const s = stateRef.current;
    if (s.status !== 'idle' || !s.products.length || s.autoLeft <= 0 || !hasMoreOf(s)) return;
    load(false);
  }, [load]);

  // The first page.
  useEffect(() => {
    if (filtersQuery == null || state.key !== listKey) return;
    if (state.products.length === 0 && state.status === 'idle' && state.pages === null) load(false);
  }, [listKey, filtersQuery, state.key, state.products.length, state.status, state.pages, load]);

  // The marker under the grid: once it comes within reach, the next page starts loading.
  const sentinelRef = useCallback((node) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    sentinelNodeRef.current = node;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) autoLoad(); },
      { rootMargin: `${AHEAD_PX}px 0px` },
    );
    observer.observe(node);
    observerRef.current = observer;
  }, [autoLoad]);
  useEffect(() => () => observerRef.current?.disconnect(), []);

  // A page that did not push the marker out of reach (a tall screen, a short page) would never
  // fire the observer again; check after every page instead of waiting for a scroll.
  useEffect(() => {
    const node = sentinelNodeRef.current;
    if (!node || state.status !== 'idle') return;
    if (node.getBoundingClientRect().top < window.innerHeight + AHEAD_PX) autoLoad();
  }, [state.products.length, state.status, state.autoLeft, autoLoad]);

  // Remember the list and how far down the visitor is.
  useEffect(() => {
    if (state.products.length && state.key === listKey) remember(listKey, state);
  }, [listKey, state]);
  useEffect(() => {
    // Opening a product scrolls the new page to the top while this one is still mounted;
    // that scroll belongs to the product page, and must not overwrite where the list was.
    const ownPath = stripLocale(window.location.pathname);
    let frame = null;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (stripLocale(window.location.pathname) !== ownPath) return;
        const snap = memory.get(paramsRef.current.listKey);
        if (snap) snap.scrollY = window.scrollY;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); if (frame) cancelAnimationFrame(frame); };
  }, []);

  // Coming back to a remembered list: back to where the visitor was — at once, not with the
  // site's smooth scrolling, which would sweep down the whole list to get there.
  useLayoutEffect(() => {
    const y = restoreScrollRef.current;
    if (!y || !state.products.length) return;
    restoreScrollRef.current = null;
    const jump = () => window.scrollTo({ top: y, behavior: 'instant' });
    jump();
    requestAnimationFrame(jump);
  }, [state.products.length]);

  const hasMore = hasMoreOf(state);
  return {
    products: state.products,
    total: state.total,
    // The signed-in customer's garage cars the list puts first ("Toyota Corolla 2020"), or null.
    fitFor: state.fitFor,
    initialLoading: state.products.length === 0 && state.status !== 'error' && (state.status === 'loading' || state.pages === null),
    loadingMore: state.status === 'loading' && state.products.length > 0,
    failed: state.status === 'error',
    error: state.error,
    hasMore,
    showMoreButton: hasMore && state.products.length > 0 && state.autoLeft === 0 && state.status === 'idle',
    nextPage: state.nextPage,
    startPage,
    loadMore: () => load(true),
    sentinelRef,
  };
}
