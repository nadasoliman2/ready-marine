'use client';

import { useState } from 'react';
import { useRouter } from '../../../../../lib/navigation';
import Link from '../../../../../components/LocaleLink';
import { ArrowLeft, Ticket } from 'lucide-react';
import { adminApi } from '../../../../../lib/api';
import { useApp } from '../../../../../context/AppContext';
import CouponForm from '../../../../../components/dashboard/CouponForm';

export default function AdminAddCouponPage() {
  const router = useRouter();
  const { language } = useApp();
  const isAr = language === 'ar';
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (payload) => {
    setSaving(true);
    try {
      await adminApi.addCoupon(payload);
      router.push('/admin/dashboard/coupons');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto pb-12 animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Link href="/admin/dashboard/coupons" className="p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white bg-white dark:bg-[#14171A] rounded-lg border border-zinc-200 dark:border-white/10 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight">
              {isAr ? 'إضافة كوبون جديد' : 'Add New Coupon'}
            </h1>
            <p className="text-sm text-zinc-500 mt-1">
              {isAr ? 'أنشئ كوبون خصم وحدد النطاق والتواريخ والقيود.' : 'Create a new discount coupon with scope, schedule, and limits.'}
            </p>
          </div>
        </div>
        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-marine-cyan/10 text-marine-primary text-xs font-bold uppercase tracking-wider">
          <Ticket size={14} /> Coupon Setup
        </div>
      </div>

      <CouponForm
        initialData={null}
        loading={saving}
        onSubmit={handleSubmit}
        onCancel={() => router.push('/admin/dashboard/coupons')}
        submitLabel={isAr ? 'حفظ كغير نشط' : 'Save as Inactive'}
        publishLabel={isAr ? 'حفظ وتفعيل' : 'Save & Activate'}
      />
    </div>
  );
}
