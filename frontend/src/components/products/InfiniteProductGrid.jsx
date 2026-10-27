'use client';

import ProductCard from '../ProductCard';
import Link from '../LocaleLink';
import { PRODUCT_PAGE_SIZE } from '../../lib/productListPreload';

/**
 * The grid of an endless product list (lib/useInfiniteProducts.js): the first page's
 * placeholders, the cards, the marker that loads the next page while scrolling, the
 * "Show more" button, and what to say when nothing is there or a page did not load.
 *
 * Every page that lists products draws its list with this, in its own colours.
 *
 * @param list            what useInfiniteProducts returned
 * @param moreHref        the address of the next page — the "Show more" button is a real link
 *                        to it, for search engines; a press loads it in place
 * @param empty           what to show when no product matches
 * @param failed          optional: what to show when the first page did not load
 * @param onRestart       called by "Show products from the start", on a list opened at `?page=N`
 */
export default function InfiniteProductGrid({
  list = {},
  isAr,
  moreHref,
  empty,
  failed,
  onRestart,
  skeletonClassName = 'bg-marine-canvas rounded-xl',
  buttonClassName = 'bg-marine-navy hover:bg-marine-cyan',
  accentClassName = 'text-marine-primary',
}) {
  const safeList = list || {};
  const products = safeList.products || [];
  const retry = (
    <button type="button" onClick={safeList.loadMore} className={`font-bold hover:underline ${accentClassName}`}>
      {isAr ? 'إعادة المحاولة' : 'Try again'}
    </button>
  );

  return (
    <>
      {onRestart && safeList.startPage > 1 && (
        <button type="button" onClick={onRestart} className={`mb-4 text-sm font-bold hover:underline ${accentClassName}`}>
          {isAr ? 'عرض المنتجات من الأول' : 'Show products from the start'}
        </button>
      )}

      {safeList.initialLoading ? (
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-6">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className={`aspect-[4/5] animate-pulse ${skeletonClassName}`} />
          ))}
        </div>
      ) : safeList.failed && !products.length ? (
        failed || (
          <div role="alert" className="text-center py-20 space-y-3">
            <p className="text-red-500 font-bold">{isAr ? 'معرفناش نحمّل المنتجات.' : "We couldn't load the products."}</p>
            {retry}
          </div>
        )
      ) : products.length === 0 ? (
        empty
      ) : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-6">
            {products.map(product => (
              <ProductCard key={product._id} product={product} />
            ))}
            {safeList.loadingMore && [1, 2, 3].map(i => (
              <div key={`more-${i}`} className={`aspect-[4/5] animate-pulse ${skeletonClassName}`} aria-hidden="true" />
            ))}
          </div>

          {/* Reaching this marker loads the next page (it starts well before it shows). */}
          <div ref={safeList.sentinelRef} aria-hidden="true" className="h-px" />

          {list.showMoreButton && (
            <div className="flex justify-center pt-10">
              <Link
                href={moreHref}
                scroll={false}
                onClick={(event) => { event.preventDefault(); list.loadMore(); }}
                className={`inline-flex items-center gap-2 rounded-full px-8 py-4 text-sm font-bold text-white shadow-lg transition-colors ${buttonClassName}`}
              >
                {isAr ? 'عرض منتجات أكتر' : 'Show more products'}
                {list.total > products.length && (
                  <span className="text-white/60 font-medium">({list.total - products.length})</span>
                )}
              </Link>
            </div>
          )}

          {list.failed && (
            <div role="alert" className="flex flex-col items-center gap-2 pt-10 text-sm">
              <p className="text-marine-outline">{isAr ? 'معرفناش نحمّل منتجات أكتر.' : "Couldn't load more products."}</p>
              {retry}
            </div>
          )}

          {!list.hasMore && products.length > PRODUCT_PAGE_SIZE && (
            <p className="pt-10 text-center text-sm font-medium text-marine-outline">
              {isAr ? `دي كل المنتجات (${products.length})` : `You've seen all ${products.length} products`}
            </p>
          )}
        </>
      )}
    </>
  );
}
