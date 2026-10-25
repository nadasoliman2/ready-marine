import { redirect } from 'next/navigation';

export default function ShippingIndexPage() {
    redirect('/admin/dashboard/shipping/zones');
}
