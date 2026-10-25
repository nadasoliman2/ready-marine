'use client';

import { useState, useEffect } from 'react';
import Link from '../../../../components/LocaleLink';
import { vendorWalletApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import { Loader2, Info, ArrowLeft, ArrowRight, Wallet, FileText } from 'lucide-react';
import { PayoutStatusBadge, destinationText } from '../../../../components/dashboard/finance/PayoutBits';
import useRowLink from '../../../../lib/useRowLink';

export default function VendorWithdrawalsPage() {
  const rowLink = useRowLink();
  const { language, siteSettings } = useApp();
  const isAr = language === 'ar';
  const currency = siteSettings?.currency || 'EGP';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [available, setAvailable] = useState(0);
  const [withdrawals, setWithdrawals] = useState([]);

  const fmt = (n) => `${Number(n || 0).toLocaleString(isAr ? 'ar-EG' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';


  const loadData = async () => {
    try {
      const [walletRes, listRes] = await Promise.all([
        vendorWalletApi.getWallet(),
        vendorWalletApi.getWithdrawals({ limit: 50 }),
      ]);
      // What a request made now would pay: every settled order, less what the wallet owes.
      setAvailable(walletRes.withdrawable?.amount || 0);
      setWithdrawals(listRes.withdrawals || []);
    } catch (err) {
      setError(isAr ? 'تعذر تحميل طلبات السحب.' : (err.message || 'Failed to load withdrawals.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const hasOpen = withdrawals.some((w) => ['pending', 'approved', 'processing'].includes(w.status));

  const cancel = async (id) => {
    try {
      await vendorWalletApi.cancelWithdrawal(id);
      setLoading(true);
      await loadData();
    } catch (err) {
      setError(isAr ? 'تعذر إلغاء طلب السحب.' : (err.message || 'Failed to cancel withdrawal.'));
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center min-h-[400px]">
        <Loader2 size={32} className="animate-spin text-marine-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto pb-12 animate-in fade-in duration-300" dir={isAr ? 'rtl' : 'ltr'}>
      <Link href="/dashboard/wallet" className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white mb-4">
        <ArrowLeft size={16} className={isAr ? 'rotate-180' : ''} /> {isAr ? 'العودة للمحفظة' : 'Back to Wallet'}
      </Link>

      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">{isAr ? 'التحويلات والفواتير' : 'Payouts & invoices'}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            {isAr ? 'تقدر تطلب دلوقتي: ' : 'You can request now: '}
            <span className="font-bold text-emerald-600 dark:text-emerald-400">{fmt(available)}</span>
          </p>
        </div>
        {/* Money is requested from the wallet page, where the payout method is saved: it goes
            only through Paymob, to that wallet or bank account. */}
        <Link
          href="/dashboard/wallet"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-marine-cyan text-white text-sm font-bold hover:bg-marine-cyan-dark transition-colors"
        >
          {isAr ? 'اطلب فلوسك' : 'Request your money'}
          <ArrowRight size={16} className={isAr ? 'rotate-180' : ''} />
        </Link>
      </div>

      {hasOpen && (
        <div className="mb-6 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 text-blue-600 dark:text-blue-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
          <Info size={16} /> {isAr ? 'لديك طلب سحب قيد المعالجة. لا يمكنك إنشاء طلب جديد حتى تتم معالجته.' : 'You have an open withdrawal request. You cannot create a new one until it is processed.'}
        </div>
      )}

      {error && (
        <div className="mb-6 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
          <Info size={16} /> {error}
        </div>
      )}

      <div className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl shadow-sm overflow-hidden">
        {withdrawals.length === 0 ? (
          <div className="p-12 text-center text-zinc-500">
            <Wallet size={32} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">{isAr ? 'لا توجد طلبات سحب بعد.' : 'No withdrawal requests yet.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="text-zinc-400 text-xs uppercase tracking-wider border-b border-zinc-100 dark:border-white/5">
                  <th className="text-start font-bold px-6 py-3">{isAr ? 'الرقم' : 'Number'}</th>
                  <th className="text-start font-bold px-6 py-3">{isAr ? 'المبلغ' : 'Amount'}</th>
                  <th className="text-start font-bold px-6 py-3">{isAr ? 'اتحوّل على' : 'Sent to'}</th>
                  <th className="text-start font-bold px-6 py-3">{isAr ? 'التاريخ' : 'Date'}</th>
                  <th className="text-start font-bold px-6 py-3">{isAr ? 'الحالة' : 'Status'}</th>
                  <th className="text-end font-bold px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                {withdrawals.map((w) => (
                  <tr key={w._id} {...rowLink(`/dashboard/wallet/payouts/${w._id}`)} className="hover:bg-zinc-50 dark:hover:bg-white/[0.01] cursor-pointer">
                    <td className="px-6 py-4 font-mono text-xs text-zinc-500">{w.withdrawal_number}</td>
                    <td className="px-6 py-4 font-black text-zinc-900 dark:text-white">{fmt(w.amount)}</td>
                    <td className="px-6 py-4 text-xs text-zinc-500" dir="auto">
                      {w.destination
                        ? destinationText(w.destination, isAr)
                        : [w.bank_details?.bank_name, w.bank_details?.account_number].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="px-6 py-4 text-zinc-500">{fmtDate(w.created_at)}</td>
                    <td className="px-6 py-4">
                      <PayoutStatusBadge status={w.status} isAr={isAr} unknown={w.gateway?.outcome_unknown} />
                      {w.status === 'rejected' && w.rejection_reason && (
                        <p className="text-xs text-red-500 mt-1">{w.rejection_reason}</p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-end whitespace-nowrap">
                      <Link href={`/dashboard/wallet/payouts/${w._id}`} className="inline-flex items-center gap-1 text-xs font-bold text-zinc-600 dark:text-zinc-300 hover:underline me-3">
                        <FileText size={14} /> {isAr ? 'الفاتورة' : 'Invoice'}
                      </Link>
                      {w.status === 'pending' && (
                        <button onClick={() => cancel(w._id)} className="text-xs font-bold text-red-500 hover:underline">
                          {isAr ? 'إلغاء' : 'Cancel'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
