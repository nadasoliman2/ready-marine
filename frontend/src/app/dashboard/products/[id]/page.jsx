'use client';

import ProductReviewPage from '../../../../components/dashboard/ProductReviewPage';

export default function VendorProductReviewPage({ params }) {
  return <ProductReviewPage productId={params.id} mode="vendor" />;
}
