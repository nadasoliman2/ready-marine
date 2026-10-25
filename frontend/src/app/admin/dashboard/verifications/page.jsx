'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Loader2, Mail, Phone, Search, Store, User, UserCheck, XCircle } from 'lucide-react';
import { adminApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';

const ROLE_FILTERS = ['all', 'user', 'vendor'];

export default function AdminVerificationsPage() {
  const { language } = useApp();
  const isAr = language === 'ar';

  const [verifications, setVerifications] = useState([]);
  const [roleFilter, setRoleFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [verifyingId, setVerifyingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const fetchVerifications = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await adminApi.getPendingVerifications(roleFilter === 'all' ? {} : { role: roleFilter });
      setVerifications(data.verifications || []);
    } catch (err) {
      setError(err.message || (isAr ? 'فشل تحميل الحسابات المعلقة' : 'Failed to load pending accounts'));
    } finally {
      setLoading(false);
    }
  }, [isAr, roleFilter]);

  useEffect(() => {
    fetchVerifications();
  }, [fetchVerifications]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return verifications;
    return verifications.filter((item) => [
      item.name,
      item.store_name,
      item.email,
      item.phone,
      item.store_username,
      item.role,
    ].some((value) => String(value || '').toLowerCase().includes(q)));
  }, [verifications, search]);

  const stats = useMemo(() => ({
    total: verifications.length,
    users: verifications.filter((item) => item.role === 'user').length,
    vendors: verifications.filter((item) => item.role === 'vendor').length,
    expired: verifications.filter((item) => item.expired).length,
  }), [verifications]);

  const verifyAccount = async (item) => {
    const label = accountLabel(item);
    const ok = window.confirm(isAr
      ? `هل تريد تأكيد حساب ${label}؟`
      : `Verify the account for ${label}?`);
    if (!ok) return;

    setVerifyingId(item._id);
    setError('');
    setNotice('');
    try {
      await adminApi.verifyPendingAccount(item._id);
      setVerifications((prev) => prev.filter((entry) => entry._id !== item._id));
      setNotice(isAr ? 'تم تأكيد الحساب بنجاح.' : 'Account verified successfully.');
    } catch (err) {
      setError(err.message || (isAr ? 'فشل تأكيد الحساب' : 'Failed to verify account'));
    } finally {
      setVerifyingId('');
    }
  };

  if (loading && verifications.length === 0) {
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
            {isAr ? 'تأكيد الحسابات' : 'Account Verification'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {isAr ? 'الحسابات التي سجلت ولم تكتمل بعد.' : 'Registrations waiting for account creation.'}
          </p>
        </div>
        <button
          type="button"
          onClick={fetchVerifications}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-white   bg-marine-cyan dark:bg-white dark:text-zinc-950 text-sm font-black disabled:opacity-60"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Clock size={16} />}
          {isAr ? 'تحديث' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-bold">
          <XCircle size={18} /> {error}
        </div>
      )}

      {notice && (
        <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 p-4 rounded-xl text-sm font-bold">
          <CheckCircle2 size={18} /> {notice}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon={UserCheck} label={isAr ? 'المعلق' : 'Pending'} value={stats.total} />
        <StatCard icon={User} label={isAr ? 'مستخدمون' : 'Users'} value={stats.users} />
        <StatCard icon={Store} label={isAr ? 'تجار' : 'Vendors'} value={stats.vendors} />
        <StatCard icon={AlertTriangle} label={isAr ? 'منتهي' : 'Expired'} value={stats.expired} tone="amber" />
      </div>

      <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-zinc-100 dark:border-white/5 flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-xl">
            <Search size={18} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isAr ? 'ابحث بالاسم، البريد، الهاتف، أو اسم المتجر' : 'Search by name, email, phone, or store'}
              className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl ps-10 pe-4 py-3 text-sm focus:outline-none focus:border-marine-cyan"
            />
          </div>

          <div className="flex p-1 rounded-xl bg-zinc-100 dark:bg-black/20 border border-zinc-200 dark:border-white/5">
            {ROLE_FILTERS.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => setRoleFilter(role)}
                className={`px-4 py-2 rounded-lg text-xs font-black transition-colors ${roleFilter === role ? 'bg-marine-cyan text-white' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'}`}
              >
                {roleLabel(role, isAr)}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="bg-zinc-50 dark:bg-white/[0.02] border-b border-zinc-200 dark:border-white/5">
              <tr className={isAr ? 'text-right' : 'text-left'}>
                <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'الحساب' : 'Account'}</th>
                <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'التواصل' : 'Contact'}</th>
                <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]">{isAr ? 'الحالة' : 'Status'}</th>
                <th className="px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px] hidden lg:table-cell">{isAr ? 'التواريخ' : 'Dates'}</th>
                <th className={`px-6 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px] ${isAr ? 'text-left' : 'text-right'}`}>{isAr ? 'إجراءات' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
              {filtered.map((item) => (
                <tr key={item._id} className="hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${item.role === 'vendor' ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400' : 'bg-red-50 text-marine-primary dark:bg-marine-cyan/10'}`}>
                        {item.role === 'vendor' ? <Store size={20} /> : <User size={20} />}
                      </div>
                      <div>
                        <p className="font-black text-zinc-900 dark:text-white">{accountLabel(item)}</p>
                        <p className="text-xs font-bold text-zinc-500">{roleLabel(item.role, isAr)}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="space-y-1">
                      <p className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300"><Mail size={14} className="text-zinc-400" /> {item.email}</p>
                      <p className="flex items-center gap-2 text-zinc-500"><Phone size={14} className="text-zinc-400" /> <span dir="ltr">{item.phone}</span></p>
                      {item.store_username && <p className="text-xs font-bold text-zinc-400">@{item.store_username}</p>}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <StatusBadge expired={item.expired} isAr={isAr} />
                  </td>
                  <td className="px-6 py-4 hidden lg:table-cell">
                    <div className="space-y-1 text-xs font-bold text-zinc-500">
                      <p>{isAr ? 'سجل:' : 'Created:'} {formatDate(item.created_at)}</p>
                      <p>{isAr ? 'ينتهي:' : 'Expires:'} {formatDate(item.expires_at, true)}</p>
                    </div>
                  </td>
                  <td className={`px-6 py-4 ${isAr ? 'text-left' : 'text-right'}`}>
                    <button
                      type="button"
                      onClick={() => verifyAccount(item)}
                      disabled={verifyingId === item._id}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black bg-marine-cyan text-white hover:bg-marine-cyan-dark transition-colors disabled:opacity-60"
                    >
                      {verifyingId === item._id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                      {isAr ? 'تأكيد الحساب' : 'Verify Account'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!loading && filtered.length === 0 && (
          <div className="py-16 text-center">
            <UserCheck size={44} className="mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
            <p className="font-bold text-zinc-900 dark:text-white">{isAr ? 'لا توجد حسابات معلقة' : 'No pending accounts'}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function roleLabel(role, isAr) {
  if (role === 'user') return isAr ? 'مستخدم' : 'User';
  if (role === 'vendor') return isAr ? 'بائع' : 'Vendor';
  return isAr ? 'الكل' : 'All';
}

function accountLabel(item) {
  return item.store_name || item.name || item.email || '-';
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

function StatusBadge({ expired, isAr }) {
  const cls = expired
    ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
    : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400';

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-black ${cls}`}>
      {expired ? <AlertTriangle size={13} /> : <Clock size={13} />}
      {expired ? (isAr ? 'منتهي' : 'Expired') : (isAr ? 'بانتظار التأكيد' : 'Pending')}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, tone = 'red' }) {
  const color = tone === 'amber'
    ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
    : 'bg-red-50 text-marine-primary dark:bg-marine-cyan/10';

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
