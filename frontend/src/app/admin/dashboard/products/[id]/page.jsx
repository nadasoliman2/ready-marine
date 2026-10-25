'use client';

import ProductReviewPage from '../../../../../components/dashboard/ProductReviewPage';

export default function AdminProductReviewPage({ params }) {
  return <ProductReviewPage productId={params.id} mode="admin" />;
}
