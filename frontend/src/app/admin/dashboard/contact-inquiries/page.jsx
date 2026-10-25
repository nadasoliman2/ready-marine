'use client';

import { useEffect, useState } from 'react';
import { Archive, CheckCircle2, Clock, Inbox, Loader2, Mail, Search, X } from 'lucide-react';
import { adminApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import usePageSize from '../../../../lib/usePageSize';
import { PageSizeSelect } from '../../../../components/dashboard/PaginationControls';
import useRowLink from '../../../../lib/useRowLink';
import Overlay from '../../../../components/Overlay';


const STATUS_OPTIONS = [
  { value: '', en: 'All Statuses', ar: 'كل الحالات' },
  { value: 'new', en: 'New', ar: 'جديد' },
  { value: 'read', en: 'Read', ar: 'مقروء' },
  { value: 'archived', en: 'Archived', ar: 'مؤرشف' },
];

const statusStyles = {
  new: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  read: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  archived: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
};

const statusIcons = {
  new: Clock,
  read: CheckCircle2,
  archived: Archive,
};

export default function ContactInquiriesPage() {
  const rowLink = useRowLink();
  const { language } = useApp();
  const isAr = language === 'ar';

  const [inquiries, setInquiries] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('admin.contactInquiries', 20);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchInquiries = async (overrides = {}) => {
    setLoading(true);
    setError('');
    try {
      const data = await adminApi.getContactInquiries({
        page: overrides.page ?? page,
        limit: pageSize,
        q: overrides.search ?? search,
        status: overrides.status ?? status,
      });
      setInquiries(data.inquiries || []);
      setTotal(data.pagination?.total || 0);
      setTotalPages(data.pagination?.pages || 1);
    } catch (err) {
      setError(err.message || 'Failed to load contact inquiries');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInquiries();
  }, [page, pageSize, status]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    fetchInquiries({ page: 1 });
  };

  const formatDate = (value) => {
    if (!value) return '-';
    return new Date(value).toLocaleString(isAr ? 'ar-EG' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const updateInquiry = async (id, payload) => {
    setSaving(true);
    try {
      const data = await adminApi.updateContactInquiry(id, payload);
      setSelected(data.inquiry);
      setInquiries(prev => prev.map(item => item._id === id ? data.inquiry : item));
    } catch (err) {
      setError(err.message || 'Failed to update inquiry');
    } finally {
      setSaving(false);
    }
  };

  const openInquiry = async (inquiry) => {
    setSelected(inquiry);
    if (inquiry.status === 'new') {
      await updateInquiry(inquiry._id, { status: 'read' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white">
            {isAr ? 'استفسارات اتصل بنا' : 'Contact Inquiries'}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            {isAr ? `${total} استفسار` : `${total} ${total === 1 ? 'inquiry' : 'inquiries'}`}
          </p>
        </div>
      </div>

      <div className="bg-white dark:bg-[#1a1d24] rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
        <form onSubmit={handleSearch} className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isAr ? 'ابحث بالاسم أو البريد أو الموضوع...' : 'Search name, email, subject...'}
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-[#0E1012] py-2 ps-10 pe-4 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-marine-cyan/50"
            />
          </div>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="rounded-lg border border-zinc-200 dark:border-zinc-600 bg-white dark:bg-[#0E1012] px-4 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-marine-cyan/50"
          >
            {STATUS_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{isAr ? option.ar : option.en}</option>
            ))}
          </select>
          <button type="submit" className="rounded-lg bg-marine-cyan px-5 py-2 text-sm font-bold text-white hover:bg-marine-cyan-dark">
            {isAr ? 'بحث' : 'Search'}
          </button>
        </form>
      </div>

      <div className="bg-white dark:bg-[#1a1d24] rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={32} className="animate-spin text-marine-primary" />
          </div>
        ) : error ? (
          <div className="py-16 text-center text-red-500">{error}</div>
        ) : inquiries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
            <Inbox size={44} className="mb-3 opacity-50" />
            <p className="font-medium">{isAr ? 'لا توجد استفسارات' : 'No inquiries found'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-700 bg-zinc-50 dark:bg-[#0E1012]/50">
                  <th className="text-start px-5 py-3 font-semibold text-zinc-600 dark:text-zinc-400">{isAr ? 'الاسم' : 'Name'}</th>
                  <th className="text-start px-5 py-3 font-semibold text-zinc-600 dark:text-zinc-400">{isAr ? 'البريد' : 'Email'}</th>
                  <th className="text-start px-5 py-3 font-semibold text-zinc-600 dark:text-zinc-400">{isAr ? 'الموضوع' : 'Subject'}</th>
                  <th className="text-start px-5 py-3 font-semibold text-zinc-600 dark:text-zinc-400">{isAr ? 'الحالة' : 'Status'}</th>
                  <th className="text-start px-5 py-3 font-semibold text-zinc-600 dark:text-zinc-400">{isAr ? 'التاريخ' : 'Date'}</th>
                  <th className="text-start px-5 py-3 font-semibold text-zinc-600 dark:text-zinc-400">{isAr ? 'إجراء' : 'Action'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {inquiries.map((inquiry) => {
                  const StatusIcon = statusIcons[inquiry.status] || Mail;
                  return (
                    <tr key={inquiry._id} {...rowLink(() => openInquiry(inquiry))} className="hover:bg-zinc-50 dark:hover:bg-[#0E1012]/50 cursor-pointer">
                      <td className="px-5 py-4 font-semibold text-zinc-900 dark:text-white">{inquiry.name}</td>
                      <td className="px-5 py-4 text-zinc-600 dark:text-zinc-300">{inquiry.email}</td>
                      <td className="px-5 py-4 text-zinc-700 dark:text-zinc-200 max-w-[300px] truncate">{inquiry.subject}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${statusStyles[inquiry.status] || statusStyles.new}`}>
                          <StatusIcon size={13} />
                          {isAr
                            ? ({ new: 'جديد', read: 'مقروء', archived: 'مؤرشف' }[inquiry.status] || inquiry.status)
                            : (inquiry.status || 'new')}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-zinc-500">{formatDate(inquiry.createdAt)}</td>
                      <td className="px-5 py-4">
                        <button
                          onClick={() => openInquiry(inquiry)}
                          className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-3 py-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-200 hover:border-marine-cyan hover:text-marine-primary"
                        >
                          {isAr ? 'عرض' : 'View'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && inquiries.length > 0 && (
        <div className="flex items-center justify-between text-sm text-zinc-500">
          <div className="flex items-center gap-3">
            <span>{isAr ? `صفحة ${page} من ${totalPages}` : `Page ${page} of ${totalPages}`}</span>
            <PageSizeSelect pageSize={pageSize} onChange={(n) => { setPageSize(n); setPage(1); }} label={isAr ? 'صفوف' : 'Rows'} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-4 py-2 disabled:opacity-40">
              {isAr ? 'السابق' : 'Previous'}
            </button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-4 py-2 disabled:opacity-40">
              {isAr ? 'التالي' : 'Next'}
            </button>
          </div>
        </div>
      )}

      {selected && (
        <Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white dark:bg-[#1a1d24] border border-zinc-200 dark:border-zinc-700 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-100 dark:border-zinc-700 p-5">
              <div>
                <h2 className="text-xl font-black text-zinc-900 dark:text-white">{selected.subject}</h2>
                <p className="text-sm text-zinc-500 mt-1">{selected.name} · {selected.email}</p>
              </div>
              <button onClick={() => setSelected(null)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/10 hover:text-zinc-900 dark:hover:text-white">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-5">
              <div>
                <p className="text-xs font-bold uppercase text-zinc-500 mb-2">{isAr ? 'الرسالة' : 'Message'}</p>
                <div className="min-h-[120px] rounded-lg bg-zinc-50 dark:bg-[#0E1012] border border-zinc-100 dark:border-zinc-700 p-4 text-sm leading-relaxed text-zinc-700 dark:text-zinc-200 whitespace-pre-wrap">
                  {selected.message || (isAr ? 'لا توجد رسالة إضافية.' : 'No additional message.')}
                </div>
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-zinc-500 mb-2 block">{isAr ? 'ملاحظة إدارية' : 'Admin note'}</label>
                <textarea
                  value={selected.admin_note || ''}
                  onChange={(e) => setSelected(prev => ({ ...prev, admin_note: e.target.value }))}
                  rows={3}
                  className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#0E1012] px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-marine-cyan/50"
                  placeholder={isAr ? 'أضف ملاحظة داخلية' : 'Add an internal note'}
                />
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-zinc-100 dark:border-zinc-700 p-5">
              <p className="text-xs text-zinc-500">{formatDate(selected.createdAt)}</p>
              <div className="flex flex-wrap gap-2">
                <button disabled={saving} onClick={() => updateInquiry(selected._id, { admin_note: selected.admin_note || '' })} className="rounded-lg border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-sm font-bold hover:border-marine-cyan hover:text-marine-primary disabled:opacity-50">
                  {isAr ? 'حفظ الملاحظة' : 'Save Note'}
                </button>
                <button disabled={saving} onClick={() => updateInquiry(selected._id, { status: 'read', admin_note: selected.admin_note || '' })} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                  {isAr ? 'تحديد كمقروء' : 'Mark Read'}
                </button>
                <button disabled={saving} onClick={() => updateInquiry(selected._id, { status: 'archived', admin_note: selected.admin_note || '' })} className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-900 disabled:opacity-50">
                  {isAr ? 'أرشفة' : 'Archive'}
                </button>
              </div>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}
