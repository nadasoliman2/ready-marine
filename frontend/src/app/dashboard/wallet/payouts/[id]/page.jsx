'use client';

import { useEffect, useState } from 'react';
import Link from '../../../../../components/LocaleLink';
import { useParams } from 'next/navigation';
import { vendorWalletApi } from '../../../../../lib/api';
import { useApp } from '../../../../../context/AppContext';
import PayoutInvoice from '../../../../../components/dashboard/finance/PayoutInvoice';
import { Loader2, ArrowLeft, Printer } from 'lucide-react';

/** One of the vendor's payouts, as a printable invoice. */
export default function VendorPayoutInvoicePage() {
  const { id } = useParams();
  const { language, siteSettings } = useApp();
  const isAr = language === 'ar';
  const currency = siteSettings?.currency || 'EGP';

  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    vendorWalletApi.getPayout(id)
      .then(setData)
      .catch((err) => setError(err.message || 'Failed to load the invoice'));
  }, [id]);

  return (
    <div className="max-w-4xl mx-auto pb-12" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between gap-3 mb-4 print:hidden">
        <Link href="/dashboard/wallet/withdrawals" className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white">
          <ArrowLeft size={16} className={isAr ? 'rotate-180' : ''} /> {isAr ? 'التحويلات والفواتير' : 'Payouts & invoices'}
        </Link>
        {data && (
          <button onClick={() => window.print()} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-100 dark:bg-white/5 text-sm font-bold text-zinc-700 dark:text-zinc-300">
            <Printer size={15} /> {isAr ? 'طباعة / PDF' : 'Print / PDF'}
          </button>
        )}
      </div>

      {error ? (
        <p className="p-6 rounded-2xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 font-bold">{error}</p>
      ) : !data ? (
        <div className="flex items-center justify-center min-h-[300px]"><Loader2 size={32} className="animate-spin text-marine-primary" /></div>
      ) : (
        <PayoutInvoice data={data} isAr={isAr} currency={currency} />
      )}
    </div>
  );
}
