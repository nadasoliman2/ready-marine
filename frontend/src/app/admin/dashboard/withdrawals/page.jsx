'use client';

import { useEffect, useState } from 'react';
import { useApp } from '../../../../context/AppContext';
import { adminWithdrawalsApi } from '../../../../lib/api';
import { Wallet, Loader2, ChevronLeft, ChevronRight, X, Check, Ban, Banknote, Send, ExternalLink } from 'lucide-react';
import Link from '../../../../components/LocaleLink';
import { PayoutStatusBadge, CHANNEL_LABEL } from '../../../../components/dashboard/finance/PayoutBits';
import useRowLink from '../../../../lib/useRowLink';
import Overlay from '../../../../components/Overlay';

const STATUS_LABELS = {
  pending: { en: 'Pending', ar: 'قيد المراجعة' },
  approved: { en: 'Approved', ar: 'تمت الموافقة' },
  processing: { en: 'On its way', ar: 'جاري التحويل' },
  paid: { en: 'Paid', ar: 'مدفوع' },
  failed: { en: 'Failed', ar: 'فشل' },
  rejected: { en: 'Rejected', ar: 'مرفوض' },
  cancelled: { en: 'Cancelled', ar: 'ملغي' },
};

// What approving a Paymob request came back with.
const SEND_RESULT = {
  paid: { en: 'Approved and sent — the vendor has the money.', ar: 'تمت الموافقة والتحويل — الفلوس وصلت للتاجر.' },
  processing: { en: 'Approved and sent — the bank transfer is under way.', ar: 'تمت الموافقة والتحويل — التحويل البنكي جاري.' },
  failed: { en: 'Approved, but Paymob refused the transfer. The money is back in the vendor’s wallet.', ar: 'تمت الموافقة لكن Paymob رفض التحويل. الفلوس رجعت لمحفظة التاجر.' },
  unknown: { en: 'Sent, but Paymob did not answer. It is held and checked automatically — never sent twice.', ar: 'اتبعت لكن Paymob ما ردش. التحويل محجوز وبيتراجع تلقائيًا — مش هيتبعت مرتين.' },
};

export default function AdminWithdrawalsPage() {
  const rowLink = useRowLink();
  const { language, siteSettings } = useApp();
  const isAr = language === 'ar';
  const currency = siteSettings?.currency || 'EGP';

  const [withdrawals, setWithdrawals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1 });
  const [selected, setSelected] = useState(null); // withdrawal for detail/action modal
  const [actionType, setActionType] = useState(null); // 'reject' | 'paid'
  const [actionInput, setActionInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const limit = 20;

  const fmt = (n) => `${Number(n || 0).toLocaleString(isAr ? 'ar-EG' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

  useEffect(() => { load(); }, [page, statusFilter]);

  const load = async () => {
    try {
      setLoading(true);
      const data = await adminWithdrawalsApi.getAll({ page, limit, status: statusFilter });
      setWithdrawals(data.withdrawals || []);
      setPagination(data.pagination || { total: 0, pages: 1 });
    } catch (_) {
    } finally {
      setLoading(false);
    }
  };

  const runAction = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      setSelected(null);
      setActionType(null);
      setActionInput('');
      await load();
    } catch (err) {
      setError(err.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const approve = (w) => runAction(async () => {
    const res = await adminWithdrawalsApi.approve(w._id);
    const state = res.withdrawal?.state;
    if (SEND_RESULT[state]) {
      setNotice(isAr ? SEND_RESULT[state].ar : SEND_RESULT[state].en);
      setTimeout(() => setNotice(''), 10000);
    }
  });
  const reject = (w) => runAction(() => adminWithdrawalsApi.reject(w._id, { reason: actionInput }));
  const markPaid = (w) => runAction(() => adminWithdrawalsApi.markPaid(w._id, { payment_reference: actionInput }));

  return (
    <div className="space-y-6" dir={isAr ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-zinc-900 dark:text-white flex items-center gap-3">
          <Wallet size={24} />
          {isAr ? 'طلبات السحب' : 'Withdrawal Requests'}
        </h1>
        <p className="text-sm text-zinc-500 mt-1">{isAr ? `${pagination.total} طلب` : `${pagination.total} requests`}</p>
      </div>

      {notice && (
        <div className="p-4 rounded-xl bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-sm font-bold text-zinc-800 dark:text-zinc-200">{notice}</div>
      )}

      {/* Filter */}
      <div className="flex gap-3">
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2.5 bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl text-sm text-zinc-900 dark:text-white">
          <option value="">{isAr ? 'كل الحالات' : 'All Statuses'}</option>
          {Object.keys(STATUS_LABELS).map((s) => (
            <option key={s} value={s}>{isAr ? STATUS_LABELS[s].ar : STATUS_LABELS[s].en}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-16 flex items-center justify-center"><Loader2 size={28} className="animate-spin text-marine-primary" /></div>
        ) : withdrawals.length === 0 ? (
          <div className="p-12 text-center text-zinc-500">
            <Wallet size={32} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">{isAr ? 'لا توجد طلبات سحب.' : 'No withdrawal requests.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-zinc-400 text-xs uppercase tracking-wider border-b border-zinc-100 dark:border-white/5">
                  <th className="text-start font-bold px-6 py-3">{isAr ? 'الرقم' : 'Number'}</th>
                  <th className="text-start font-bold px-6 py-3">{isAr ? 'البائع' : 'Vendor'}</th>
                  <th className="text-start font-bold px-6 py-3">{isAr ? 'المبلغ' : 'Amount'}</th>
                  <th className="text-start font-bold px-6 py-3">{isAr ? 'الطريقة' : 'Channel'}</th>
                  <th className="text-start font-bold px-6 py-3">{isAr ? 'التاريخ' : 'Date'}</th>
                  <th className="text-start font-bold px-6 py-3">{isAr ? 'الحالة' : 'Status'}</th>
                  <th className="text-end font-bold px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                {withdrawals.map((w) => (
                  <tr key={w._id} {...rowLink(() => { setSelected(w); setActionType(null); setActionInput(''); setError(''); })} className="hover:bg-zinc-50 dark:hover:bg-white/[0.01] cursor-pointer">
                    <td className="px-6 py-4 font-mono text-xs text-zinc-500">{w.withdrawal_number}</td>
                    <td className="px-6 py-4 text-zinc-900 dark:text-white font-bold">{w.vendor_id?.store_name || w.vendor_id?.name || '—'}</td>
                    <td className="px-6 py-4 font-black text-zinc-900 dark:text-white">{fmt(w.amount)}</td>
                    <td className="px-6 py-4 text-zinc-500 text-xs font-bold">{isAr ? CHANNEL_LABEL[w.channel || 'manual'].ar : CHANNEL_LABEL[w.channel || 'manual'].en}</td>
                    <td className="px-6 py-4 text-zinc-500">{fmtDate(w.created_at)}</td>
                    <td className="px-6 py-4">
                      <PayoutStatusBadge status={w.status} isAr={isAr} unknown={w.gateway?.outcome_unknown} />
                    </td>
                    <td className="px-6 py-4 text-end">
                      <button onClick={() => { setSelected(w); setActionType(null); setActionInput(''); setError(''); }}
                        className="text-xs font-bold text-marine-primary hover:underline">
                        {isAr ? 'التفاصيل' : 'Details'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
            className="p-2 rounded-lg border border-zinc-200 dark:border-white/10 disabled:opacity-40"><ChevronLeft size={16} className={isAr ? 'rotate-180' : ''} /></button>
          <span className="text-sm text-zinc-500">{page} / {pagination.pages}</span>
          <button disabled={page >= pagination.pages} onClick={() => setPage((p) => p + 1)}
            className="p-2 rounded-lg border border-zinc-200 dark:border-white/10 disabled:opacity-40"><ChevronRight size={16} className={isAr ? 'rotate-180' : ''} /></button>
        </div>
      )}

      {/* Detail / action modal */}
      {selected && (
        <Overlay className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelected(null)}>
          <div className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/10 rounded-2xl w-full max-w-lg p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg text-zinc-900 dark:text-white">{selected.withdrawal_number}</h3>
              <button onClick={() => setSelected(null)} className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white"><X size={20} /></button>
            </div>

            <div className="space-y-2 text-sm mb-5">
              <Row label={isAr ? 'البائع' : 'Vendor'} value={selected.vendor_id?.store_name || selected.vendor_id?.name} />
              <Row label={isAr ? 'المبلغ' : 'Amount'} value={fmt(selected.amount)} />
              {selected.deductions > 0 && (
                <Row label={isAr ? 'بعد خصم مستحق على المحفظة' : 'After wallet deductions of'} value={fmt(selected.deductions)} />
              )}
              <Row label={isAr ? 'عدد الطلبات' : 'Orders covered'} value={selected.earning_ids?.length || (isAr ? 'رصيد عام' : 'balance')} />
              <Row label={isAr ? 'الحالة' : 'Status'} value={isAr ? STATUS_LABELS[selected.status]?.ar : STATUS_LABELS[selected.status]?.en} />
              {selected.vendor_id?.payout_hold?.active && (
                <p className="text-xs font-bold text-amber-600 dark:text-amber-400">
                  {isAr ? 'تحويلات التاجر ده موقوفة: ' : 'Payouts to this vendor are on hold: '}{selected.vendor_id.payout_hold.reason}
                </p>
              )}
              <div className="pt-2 border-t border-zinc-100 dark:border-white/5" />
              {selected.channel === 'paymob' ? (
                <>
                  <Row label={isAr ? 'هيتحول إلى' : 'Paid to'} value={[selected.payout_method?.issuer, selected.payout_method?.bank_name, selected.payout_method?.msisdn || selected.payout_method?.bank_card_number].filter(Boolean).join(' · ')} />
                  {selected.payout_method?.full_name && <Row label={isAr ? 'الاسم' : 'Name'} value={selected.payout_method.full_name} />}
                  {selected.gateway?.transaction_id && <Row label="Paymob" value={selected.gateway.transaction_id} />}
                </>
              ) : (
                <>
                  <Row label={isAr ? 'البنك' : 'Bank'} value={selected.bank_details?.bank_name} />
                  <Row label={isAr ? 'صاحب الحساب' : 'Account Holder'} value={selected.bank_details?.account_holder} />
                  <Row label={isAr ? 'رقم الحساب' : 'Account Number'} value={selected.bank_details?.account_number} />
                  {selected.bank_details?.iban && <Row label="IBAN" value={selected.bank_details.iban} />}
                </>
              )}
              {selected.bank_details?.notes && <Row label={isAr ? 'ملاحظات' : 'Notes'} value={selected.bank_details.notes} />}
              {selected.payment_reference && <Row label={isAr ? 'مرجع الدفع' : 'Payment Ref'} value={selected.payment_reference} />}
              {selected.rejection_reason && <Row label={isAr ? 'سبب الرفض' : 'Rejection Reason'} value={selected.rejection_reason} />}
            </div>

            {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

            {/* Action area */}
            {actionType === 'reject' || actionType === 'paid' ? (
              <div className="space-y-3">
                <input type="text" value={actionInput} onChange={(e) => setActionInput(e.target.value)}
                  placeholder={actionType === 'reject' ? (isAr ? 'سبب الرفض' : 'Rejection reason') : (isAr ? 'مرجع التحويل البنكي' : 'Bank transfer reference')}
                  className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-transparent text-zinc-900 dark:text-white text-sm" />
                <div className="flex gap-2">
                  <button disabled={busy} onClick={() => actionType === 'reject' ? reject(selected) : markPaid(selected)}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-marine-cyan text-white text-sm font-bold hover:bg-marine-cyan-dark disabled:opacity-50">
                    {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                    {isAr ? 'تأكيد' : 'Confirm'}
                  </button>
                  <button onClick={() => { setActionType(null); setActionInput(''); }}
                    className="px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-sm font-bold text-zinc-600 dark:text-zinc-300">
                    {isAr ? 'إلغاء' : 'Cancel'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {selected.status === 'pending' && (
                  <button disabled={busy} onClick={() => approve(selected)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
                    {busy ? <Loader2 size={16} className="animate-spin" /> : selected.channel === 'paymob' ? <Send size={16} /> : <Check size={16} />}
                    {selected.channel === 'paymob'
                      ? (isAr ? 'موافقة وتحويل عبر Paymob' : 'Approve & send via Paymob')
                      : (isAr ? 'موافقة' : 'Approve')}
                  </button>
                )}
                {((selected.status === 'pending') || (selected.status === 'approved' && !selected.gateway?.sent_at)) && (
                  <button disabled={busy} onClick={() => setActionType('reject')}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 text-sm font-bold hover:bg-red-50 dark:hover:bg-red-500/10">
                    <Ban size={16} /> {isAr ? 'رفض' : 'Reject'}
                  </button>
                )}
                {selected.status !== 'pending' && (
                  <Link href={`/admin/dashboard/finance/payouts/${selected._id}`}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-sm font-bold text-zinc-600 dark:text-zinc-300">
                    <ExternalLink size={16} /> {isAr ? 'الفاتورة وتفاصيل Paymob' : 'Invoice & Paymob details'}
                  </Link>
                )}
                {selected.status === 'approved' && selected.channel !== 'paymob' && (
                  <button disabled={busy} onClick={() => setActionType('paid')}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50">
                    <Banknote size={16} /> {isAr ? 'تحديد كمدفوع' : 'Mark Paid'}
                  </button>
                )}
              </div>
            )}
          </div>
        </Overlay>
      )}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-zinc-400 text-xs font-bold uppercase tracking-wider">{label}</span>
      <span className="text-zinc-900 dark:text-white font-medium text-end">{value || '—'}</span>
    </div>
  );
}
