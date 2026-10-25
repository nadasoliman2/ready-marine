'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Search, Tag, Pencil, Trash2, Ticket } from 'lucide-react';
import { useRouter } from '../../../../lib/navigation';
import { adminApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import PaginationControls from '../../../../components/dashboard/PaginationControls';
import usePageSize from '../../../../lib/usePageSize';
import useRowLink from '../../../../lib/useRowLink';


export default function AdminCouponsPage() {
  const rowLink = useRowLink();
  const router = useRouter();
  const { language } = useApp();
  const isAr = language === 'ar';

  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('admin.coupons', 10);
  const [deletingId, setDeletingId] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const data = await adminApi.getCoupons();
        setCoupons(data.coupons || []);
      } catch (err) {
        setError(err.message || 'Failed to load coupons');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return coupons.filter(coupon => {
      if (statusFilter === 'active' && !coupon.is_active) return false;
      if (statusFilter === 'inactive' && coupon.is_active) return false;
      if (!q) return true;

      return [coupon.code, coupon.name, coupon.description, coupon.scope_type, coupon.discount_type]
        .some(value => String(value || '').toLowerCase().includes(q));
    });
  }, [coupons, search, statusFilter]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const deleteCoupon = async (coupon) => {
    const ok = confirm(isAr ? 'هل تريد حذف هذا الكوبون؟' : 'Are you sure you want to delete this coupon?');
    if (!ok) return;

    setDeletingId(coupon._id);
    try {
      await adminApi.deleteCoupon(coupon._id);
      setCoupons(prev => prev.filter(item => item._id !== coupon._id));
    } catch (err) {
      setError(err.message || 'Failed to delete coupon');
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
            {isAr ? 'إدارة الكوبونات' : 'Coupons'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {isAr ? 'إنشاء وإدارة كوبونات الخصم.' : 'Create and manage discount coupons.'}
          </p>
        </div>
        <button
          onClick={() => router.push('/admin/dashboard/coupons/add')}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-marine-cyan hover:bg-marine-cyan-dark text-white rounded-xl font-bold"
        >
          <Plus size={18} />
          {isAr ? 'إضافة كوبون' : 'Add Coupon'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-bold">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard icon={Ticket} label={isAr ? 'كل الكوبونات' : 'Total Coupons'} value={coupons.length} />
        <StatCard icon={Tag} label={isAr ? 'النشطة' : 'Active'} value={coupons.filter(c => c.is_active).length} tone="green" />
        <StatCard icon={Tag} label={isAr ? 'غير النشطة' : 'Inactive'} value={coupons.filter(c => !c.is_active).length} tone="gray" />
      </div>

      <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-zinc-100 dark:border-white/5 grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-3">
          <div className="relative">
            <Search size={18} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={isAr ? 'ابحث بالكود أو الاسم أو النطاق' : 'Search by code, name, or scope'}
              className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl ps-10 pe-4 py-3 text-sm focus:outline-none focus:border-marine-cyan"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-marine-cyan"
          >
            <option value="">{isAr ? 'كل الحالات' : 'All statuses'}</option>
            <option value="active">{isAr ? 'نشط' : 'Active'}</option>
            <option value="inactive">{isAr ? 'غير نشط' : 'Inactive'}</option>
          </select>
        </div>

        <div className="divide-y divide-zinc-100 dark:divide-white/5">
          {paginated.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <Ticket size={36} className="mx-auto text-zinc-300 mb-3" />
              <p className="text-zinc-500 font-semibold">{isAr ? 'لا توجد كوبونات' : 'No coupons found'}</p>
            </div>
          ) : (
            paginated.map(coupon => (
              <div key={coupon._id} {...rowLink(`/admin/dashboard/coupons/${coupon._id}/edit`)} className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center gap-4 hover:bg-zinc-50 dark:hover:bg-white/[0.02] cursor-pointer">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h3 className="font-black text-zinc-900 dark:text-white uppercase tracking-wide">{coupon.code}</h3>
                    <span className="text-xs font-semibold text-zinc-500">{coupon.name}</span>
                    <span className={`inline-flex items-center text-[10px] px-2 py-1 rounded-full font-bold uppercase tracking-widest ${coupon.is_active ? 'bg-emerald-500/20 text-emerald-500' : 'bg-zinc-500/20 text-zinc-500'}`}>
                      {coupon.is_active ? (isAr ? 'نشط' : 'active') : (isAr ? 'غير نشط' : 'inactive')}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500">
                    {coupon.discount_type === 'percent' ? `${coupon.discount_value}%` : coupon.discount_value} · {coupon.scope_type}
                    {' · '}
                    {/* Who funds it — of the discount, not of the order. */}
                    <span className="font-semibold text-zinc-600 dark:text-zinc-300" dir="ltr">
                      {isAr
                        ? `التاجر ${Number(coupon.vendor_share_percent || 0)}% / الموقع ${100 - Number(coupon.vendor_share_percent || 0)}% من الخصم`
                        : `vendor ${Number(coupon.vendor_share_percent || 0)}% / platform ${100 - Number(coupon.vendor_share_percent || 0)}% of the discount`}
                    </span>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => router.push(`/admin/dashboard/coupons/${coupon._id}/edit`)}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-300"
                  >
                    <Pencil size={13} /> {isAr ? 'تعديل' : 'Edit'}
                  </button>
                  <button
                    onClick={() => deleteCoupon(coupon)}
                    disabled={deletingId === coupon._id}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold bg-red-500/10 text-red-500 hover:bg-red-500/20 disabled:opacity-50"
                  >
                    {deletingId === coupon._id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    {isAr ? 'حذف' : 'Delete'}
                  </button>
                </div>
              </div>
            ))
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
    green: 'bg-emerald-500/10 text-emerald-500',
    gray: 'bg-zinc-500/10 text-zinc-500',
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
