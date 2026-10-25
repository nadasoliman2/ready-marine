'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { useRouter } from '../../../../lib/navigation';
import { Calendar, Eye, Hash, Loader2, Mail, MapPin, Phone, Search, User, Users } from 'lucide-react';
import { adminApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import PaginationControls from '../../../../components/dashboard/PaginationControls';
import usePageSize from '../../../../lib/usePageSize';
import useRowLink from '../../../../lib/useRowLink';


export default function AdminUsersPage() {
  const rowLink = useRowLink();
  const router = useRouter();
  const { language } = useApp();
  const isAr = language === 'ar';
  
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('admin.users', 10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalUsers, setTotalUsers] = useState(0);
  const [successMsg, setSuccessMsg] = useState('');

  // Show a confirmation banner after a redirect from a successful hard delete.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const deleted = new URLSearchParams(window.location.search).get('deleted');
    if (deleted) {
      setSuccessMsg(
        isAr ? `تم حذف الحساب نهائياً: ${deleted}` : `Account permanently deleted: ${deleted}`
      );
      window.history.replaceState(null, '', window.location.pathname);
      const t = setTimeout(() => setSuccessMsg(''), 6000);
      return () => clearTimeout(t);
    }
  }, [isAr]);

  const fetchUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await adminApi.getUsers({ page, limit: pageSize, q: search });
      setUsers(data.users || []);
      setTotalPages(data.pagination?.pages || 1);
      setTotalUsers(data.pagination?.total || 0);
    } catch (err) {
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [page, pageSize, search]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  };

  if (loading && users.length === 0) {
    return (
      <div className="h-full flex items-center justify-center min-h-[60vh]">
        <Loader2 size={32} className="animate-spin text-marine-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-wide">
            {isAr ? 'إدارة المستخدمين' : 'Users Management'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {isAr ? 'عرض بيانات المستخدمين وسجل طلباتهم.' : 'View user details and their order history.'}
          </p>
        </div>
      </div>

      {successMsg && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 p-4 rounded-xl text-sm font-bold">
          {successMsg}
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-bold">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard icon={Users} label={isAr ? 'إجمالي المستخدمين' : 'Total Users'} value={totalUsers} />
      </div>

      <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-zinc-100 dark:border-white/5">
          <form onSubmit={handleSearch} className="relative max-w-xl flex gap-2">
            <div className="relative flex-1">
              <Search size={18} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder={isAr ? 'ابحث بالاسم، البريد، أو الهاتف' : 'Search by name, email, or phone'}
                className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl ps-10 pe-4 py-3 text-sm focus:outline-none focus:border-marine-cyan"
              />
            </div>
            <button type="submit" className="px-5 py-3 bg-marine-cyan hover:bg-marine-cyan-dark text-white rounded-xl font-bold transition-all">
              {isAr ? 'بحث' : 'Search'}
            </button>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-zinc-50 dark:bg-white/[0.02] border-b border-zinc-200 dark:border-white/5">
              <tr className={isAr ? 'text-right' : 'text-left'}>
                <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'المستخدم' : 'User'}</th>
                <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'التواصل' : 'Contact'}</th>
                <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px] hidden lg:table-cell">{isAr ? 'تاريخ التسجيل' : 'Registered'}</th>
                <th className={`px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px] ${isAr ? 'text-left' : 'text-right'}`}>{isAr ? 'إجراءات' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
              {users.map(user => (
                <tr key={user._id} {...rowLink(`/admin/dashboard/users/${user._id}`)} className="hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors cursor-pointer">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center font-black bg-red-50 text-marine-primary dark:bg-marine-cyan/10">
                        {(user.name || 'U').charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-black text-zinc-900 dark:text-white">{user.name}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="space-y-1">
                      <p className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300"><Mail size={14} className="text-zinc-400" /> {user.email}</p>
                      <p className="flex items-center gap-2 text-zinc-500"><Phone size={14} className="text-zinc-400" /> <span dir="ltr">{user.phone}</span></p>
                    </div>
                  </td>
                  <td className="px-6 py-4 hidden lg:table-cell">
                    <p className="text-xs font-bold text-zinc-600 dark:text-zinc-300">{formatDate(user.created_at)}</p>
                  </td>
                  <td className={`px-6 py-4 ${isAr ? 'text-left' : 'text-right'}`}>
                    <button
                      onClick={() => router.push(`/admin/dashboard/users/${user._id}`)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black bg-marine-cyan/10 text-marine-primary hover:bg-marine-cyan/20 transition-colors"
                    >
                      <Eye size={14} />
                      {isAr ? 'عرض الملف' : 'View Profile'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {users.length > 0 && (
          <PaginationControls
            page={page}
            pageSize={pageSize}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
            total={totalUsers}
            onPageChange={setPage}
            labels={{
              showing: isAr ? 'عرض' : 'Showing',
              of: isAr ? 'من' : 'of',
              previous: isAr ? 'الصفحة السابقة' : 'Previous page',
              next: isAr ? 'الصفحة التالية' : 'Next page',
            }}
          />
        )}

        {!loading && users.length === 0 && (
          <div className="py-16 text-center">
            <Users size={44} className="mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
            <p className="font-bold text-zinc-900 dark:text-white">{isAr ? 'لا يوجد مستخدمين' : 'No users found'}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(value, withTime = false) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

function StatCard({ icon: Icon, label, value, tone = 'orange' }) {
  const color = 'bg-red-50 text-marine-primary dark:bg-marine-cyan/10';
  return (
    <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 p-5 shadow-sm">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${color}`}>
        <Icon size={20} />
      </div>
      <p className="text-sm font-bold text-zinc-500">{label}</p>
      <p className="text-2xl font-black text-zinc-900 dark:text-white mt-1">{value}</p>
    </div>
  );
}
