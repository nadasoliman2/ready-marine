'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from '../../../../lib/navigation';
import { Loader2, Plus, Search, Wrench, MapPin, Phone, MessageCircle, Pencil, Trash2, Star, Megaphone } from 'lucide-react';
import { adminApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import PaginationControls from '../../../../components/dashboard/PaginationControls';
import { getLocalizedServiceLocations, getServiceLocationSearchValues } from '../../../../lib/serviceLocations';
import usePageSize from '../../../../lib/usePageSize';
import useRowLink from '../../../../lib/useRowLink';


export default function AdminServicesPage() {
  const rowLink = useRowLink();
  const router = useRouter();
  const { language } = useApp();
  const isAr = language === 'ar';

  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('admin.services', 10);
  const [deletingId, setDeletingId] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const data = await adminApi.getServices();
        setServices(data.services || []);
      } catch (err) {
        setError(err.message || 'Failed to load services');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return services;
    return services.filter(service => [
      service.title_en,
      service.title_ar,
      service.vendor_name_en,
      service.vendor_name_ar,
      ...getServiceLocationSearchValues(service),
      ...(service.phones || []),
      ...(service.whatsapp_numbers || []),
    ].some(v => String(v || '').toLowerCase().includes(q)));
  }, [services, search]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const deleteService = async (service) => {
    const ok = confirm(isAr ? 'هل تريد حذف هذه الخدمة؟' : 'Are you sure you want to delete this service?');
    if (!ok) return;

    setDeletingId(service._id);
    setError('');
    try {
      await adminApi.deleteService(service._id);
      setServices(prev => prev.filter(item => item._id !== service._id));
    } catch (err) {
      setError(err.message || 'Failed to delete service');
    } finally {
      setDeletingId('');
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-marine-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-wide">
            {isAr ? 'إدارة الخدمات' : 'Services'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {isAr ? 'عرض وتعديل وحذف خدمات الموقع.' : 'Create, edit, and manage website services.'}
          </p>
        </div>
        <button
          onClick={() => router.push('/admin/dashboard/services/add')}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-marine-cyan hover:bg-marine-cyan-dark text-white rounded-xl font-bold shadow-lg shadow-red-500/20"
        >
          <Plus size={18} />
          {isAr ? 'إضافة خدمة' : 'Add Service'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-bold">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard icon={Wrench} label={isAr ? 'كل الخدمات' : 'Total Services'} value={services.length} />
        <StatCard icon={Star} label={isAr ? 'مميزة' : 'Featured'} value={services.filter(s => s.featured).length} tone="yellow" />
        <StatCard icon={Wrench} label={isAr ? 'نشطة' : 'Active'} value={services.filter(s => s.status === 'active').length} tone="green" />
      </div>

      <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-zinc-100 dark:border-white/5">
          <div className="relative max-w-xl">
            <Search size={18} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={isAr ? 'ابحث بعنوان الخدمة، اسم البائع، الموقع، أو الهاتف' : 'Search by title, vendor, location, or phone'}
              className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl ps-10 pe-4 py-3 text-sm focus:outline-none focus:border-marine-cyan"
            />
          </div>
        </div>

        <div className="divide-y divide-zinc-100 dark:divide-white/5">
          {paginated.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <Wrench size={36} className="mx-auto text-zinc-300 mb-3" />
              <p className="text-zinc-500 font-semibold">{isAr ? 'لا توجد خدمات مطابقة' : 'No services found'}</p>
            </div>
          ) : (
            paginated.map(service => {
              const title = isAr ? (service.title_ar || service.title_en) : (service.title_en || service.title_ar);
              const vendorName = isAr ? (service.vendor_name_ar || service.vendor_name_en) : (service.vendor_name_en || service.vendor_name_ar);
              const locations = getLocalizedServiceLocations(service, language);
              const vendorLocation = locations.map(location => location.name).join(', ');

              return (
                <div key={service._id} {...rowLink(`/admin/dashboard/services/${service._id}/edit`)} className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center gap-4 hover:bg-zinc-50 dark:hover:bg-white/[0.02] cursor-pointer">
                  <div className="w-full lg:w-20 h-16 rounded-xl overflow-hidden bg-zinc-100 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10">
                    {service.images?.[0]?.url ? (
                      <img src={service.images[0].url} alt={title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-400"><Wrench size={18} /></div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h3 className="font-black text-zinc-900 dark:text-white truncate">{title || (isAr ? 'بدون عنوان' : 'Untitled')}</h3>
                      {service.featured && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-amber-500/20 text-amber-500 font-bold uppercase tracking-widest">
                          <Star size={10} /> Featured
                        </span>
                      )}
                      {service.show_in_banner_ad_slider && (
                        <span className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-red-500/15 text-marine-primary font-bold uppercase tracking-widest">
                          <Megaphone size={10} /> Banner Ad
                        </span>
                      )}
                      <span className={`inline-flex items-center text-[10px] px-2 py-1 rounded-full font-bold uppercase tracking-widest ${service.status === 'active' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-zinc-500/20 text-zinc-500'}`}>
                        {service.status || 'active'}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-500 space-y-1">
                      <p className="flex items-center gap-1.5"><Wrench size={12} /> {vendorName || '-'}</p>
                      <p className="flex items-center gap-1.5"><MapPin size={12} /> {vendorLocation || '-'}</p>
                      <div className="flex flex-wrap items-center gap-3">
                        {(service.phones || []).slice(0, 2).map((phone, idx) => (
                          <span key={idx} className="inline-flex items-center gap-1"><Phone size={11} /> {phone}</span>
                        ))}
                        {(service.whatsapp_numbers || []).slice(0, 2).map((wa, idx) => (
                          <span key={idx} className="inline-flex items-center gap-1"><MessageCircle size={11} /> {wa}</span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 lg:self-center">
                    <button
                      onClick={() => router.push(`/admin/dashboard/services/${service._id}/edit`)}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-white/10"
                    >
                      <Pencil size={13} /> {isAr ? 'تعديل' : 'Edit'}
                    </button>
                    <button
                      onClick={() => deleteService(service)}
                      disabled={deletingId === service._id}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold bg-red-500/10 text-red-500 hover:bg-red-500/20 disabled:opacity-50"
                    >
                      {deletingId === service._id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      {isAr ? 'حذف' : 'Delete'}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <PaginationControls
          page={page}
          pageSize={pageSize}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
          total={filtered.length}
          onPageChange={setPage}
          labels={{
            showing: isAr ? 'عرض' : 'Showing',
            of: isAr ? 'من' : 'of',
            previous: isAr ? 'الصفحة السابقة' : 'Previous page',
            next: isAr ? 'الصفحة التالية' : 'Next page',
          }}
        />
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone = 'default' }) {
  const toneMap = {
    default: 'bg-marine-cyan/10 text-marine-primary',
    yellow: 'bg-amber-500/10 text-amber-500',
    green: 'bg-emerald-500/10 text-emerald-500',
  };

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-white/5 bg-white dark:bg-[#14171A] p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${toneMap[tone] || toneMap.default}`}>
          <Icon size={18} />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">{label}</p>
          <p className="text-2xl font-black text-zinc-900 dark:text-white">{value}</p>
        </div>
      </div>
    </div>
  );
}
