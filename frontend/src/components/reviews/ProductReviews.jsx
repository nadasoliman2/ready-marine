'use client';

/**
 * Approved customer reviews for a product.
 *
 * A thin wrapper over `ReviewFeed`, which renders the identical feed for a store. Keeping
 * one implementation is what stops the two drifting into slightly different layouts for
 * what is, to a reader, the same thing.
 */
import ReviewFeed from './ReviewFeed';

export default function ProductReviews({ productId }) {
    return <ReviewFeed subject="product" subjectId={productId} />;
}
