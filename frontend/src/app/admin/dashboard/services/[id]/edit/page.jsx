'use client';

import { useEffect, useState } from 'react';
import { useRouter } from '../../../../../../lib/navigation';
import Link from '../../../../../../components/LocaleLink';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { adminApi } from '../../../../../../lib/api';
import { useApp } from '../../../../../../context/AppContext';
import ServiceForm from '../../../../../../components/dashboard/ServiceForm';

export default function AdminEditServicePage({ params }) {
  const router = useRouter();
  const { language } = useApp();
  const isAr = language === 'ar';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [service, setService] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const data = await adminApi.getServiceById(params.id);
        setService(data.service || null);
      } catch (err) {
        setError(err.message || 'Failed to load service');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [params.id]);

  const handleSubmit = async (payload) => {
    setSaving(true);
    try {
      await adminApi.updateService(params.id, payload);
      router.push('/admin/dashboard/services');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-marine-primary" />
      </div>
    );
  }

  if (error || !service) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-bold">
          {error || (isAr ? 'الخدمة غير موجودة' : 'Service not found')}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto pb-12 animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <Link href="/admin/dashboard/services" className="p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white bg-white dark:bg-[#14171A] rounded-lg border border-zinc-200 dark:border-white/10 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight">
              {isAr ? 'تعديل الخدمة' : 'Edit Service'}
            </h1>
            <p className="text-sm text-zinc-500 mt-1">
              {isAr ? 'حدّث بيانات الخدمة والتواصل بسهولة.' : 'Update service details and contact channels.'}
            </p>
          </div>
        </div>
      </div>

      <ServiceForm
        initialData={service}
        loading={saving}
        onSubmit={handleSubmit}
        onCancel={() => router.push('/admin/dashboard/services')}
        submitLabel={isAr ? 'حفظ كغير نشطة' : 'Save as Inactive'}
        publishLabel={isAr ? 'حفظ وتفعيل' : 'Save & Activate'}
      />
    </div>
  );
}
