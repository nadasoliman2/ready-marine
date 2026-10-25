'use client';

import EditProductPage from '../../../../../dashboard/products/[id]/edit/page';

export default function AdminEditProductPage({ params }) {
  return <EditProductPage params={params} mode="admin" />;
}
