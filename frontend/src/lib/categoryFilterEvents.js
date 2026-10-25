export const CATEGORY_FILTER_EVENT = 'readycar:category-filter';

export function publishCategoryFilter(categoryId) {
  if (typeof window === 'undefined' || !categoryId) return;

  window.dispatchEvent(new CustomEvent(CATEGORY_FILTER_EVENT, {
    detail: { categoryId },
  }));
}

/**
 * A search typed in the header while the shop is open: the shop takes it into its filters
 * at once — keeping the ones already chosen — instead of waiting for a navigation that a
 * quick click on a filter could overtake.
 */
export const SEARCH_FILTER_EVENT = 'readycar:search-filter';

export function publishSearchFilter(query) {
  if (typeof window === 'undefined' || !query) return;

  window.dispatchEvent(new CustomEvent(SEARCH_FILTER_EVENT, {
    detail: { query },
  }));
}
