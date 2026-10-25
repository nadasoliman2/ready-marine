'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from '../../../components/LocaleLink';
import { vendorWalletApi } from '../../../lib/api';
import { useApp } from '../../../context/AppContext';
import {
  Loader2, Info, Wallet, Clock, Lock, CheckCircle2, ArrowRight, Snowflake, PauseCircle, Smartphone, Pencil, Send, X,
  Landmark, CreditCard,
} from 'lucide-react';
import Overlay from '../../../components/Overlay';

const STATUS_STYLES = {
  pending: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  available: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  reversed: 'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400',
  frozen: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  in_payout: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  paid: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
};

/** One word for where a parcel's money stands, from the vendor's side. */
const rowState = (e) => {
  if (e.payout_id) return ['requested', 'processing'].includes(e.payout_status) ? 'in_payout' : 'paid';
  if (e.frozen?.active && e.status !== 'reversed') return 'frozen';
  return e.status;
};

/**
 * How the vendor is paid — only what Paymob Payouts can send to, each with the fields it
 * requires. "Bank Account" is two saved types, `account` and `iban`, behind one tab.
 */
const METHOD_TABS = [
  { id: 'bank', types: ['account', 'iban'], icon: Landmark, en: 'Bank Account', ar: 'حساب بنكي' },
  { id: 'card', types: ['card'], icon: CreditCard, en: 'Card Number', ar: 'رقم الكارت' },
  { id: 'wallet', types: ['wallet'], icon: Wallet, en: 'Wallet Number', ar: 'رقم المحفظة' },
];

// `speed` is the bank channel (bank_card | instant_bank); `provider` is whose wallet it is.
const EMPTY_METHOD = { type: 'account', speed: 'bank_card', provider: '', msisdn: '', full_name: '', bank_code: '', bank_card_number: '', password: '' };

/** Whose wallet a number is most likely on — a starting choice the vendor can change. */
const walletOf = (msisdn) => ({ '010': 'vodafone', '011': 'etisalat', '012': 'orange' }[String(msisdn).replace(/\D/g, '').slice(0, 3)] || '');

export default function VendorWalletPage() {
  const { language, siteSettings } = useApp();
  const isAr = language === 'ar';
  const currency = siteSettings?.currency || 'EGP';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [summary, setSummary] = useState(null);
  const [earnings, setEarnings] = useState([]);

  const [methodOpen, setMethodOpen] = useState(false);
  const [methodInfo, setMethodInfo] = useState(null);
  const [methodForm, setMethodForm] = useState(EMPTY_METHOD);
  const [methodSaving, setMethodSaving] = useState(false);
  const [methodError, setMethodError] = useState('');

  const [requesting, setRequesting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const fmt = (n) => `${Number(n || 0).toLocaleString(isAr ? 'ar-EG' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

  const statusLabel = (s) => {
    if (isAr) return { pending: 'في فترة التسوية', available: 'متاح', reversed: 'مُسترد', frozen: 'مجمّد', in_payout: 'جاري تحويله', paid: 'اتحوّل' }[s] || s;
    return { pending: 'Settling', available: 'Available', reversed: 'Reversed', frozen: 'On hold', in_payout: 'Being paid', paid: 'Paid out' }[s] || s;
  };

  const load = useCallback(async () => {
    try {
      const [walletRes, earningsRes] = await Promise.all([
        vendorWalletApi.getWallet(),
        vendorWalletApi.getEarnings({ limit: 50 }),
      ]);
      setSummary(walletRes);
      setEarnings(earningsRes.earnings || []);
    } catch (err) {
      setError(isAr ? 'تعذر تحميل بيانات المحفظة.' : (err.message || 'Failed to load wallet.'));
    } finally {
      setLoading(false);
    }
  }, [isAr]);

  useEffect(() => { load(); }, [load]);

  const openMethod = async () => {
    setMethodError('');
    setMethodOpen(true);
    try {
      const res = await vendorWalletApi.getPayoutMethod();
      setMethodInfo(res);
      const m = res.method || {};
      setMethodForm({
        ...EMPTY_METHOD,
        type: m.type || 'account',
        speed: m.issuer === 'instant_bank' ? 'instant_bank' : 'bank_card',
        provider: m.type === 'wallet' ? m.issuer : '',
        msisdn: m.msisdn || '',
        full_name: m.full_name || '',
        bank_code: m.bank_code || '',
        // The IBAN field shows "EG" in front of the box, so only the digits go in it.
        bank_card_number: (m.bank_card_number || '').replace(/^EG/, ''),
      });
    } catch (err) {
      setMethodError(err.message || 'Failed to load');
    }
  };

  const saveMethod = async (e) => {
    e.preventDefault();
    let f = methodForm;
    // Paymob's fast transfer takes an IBAN only. Saving an account number "fast" offers the
    // standard transfer instead of an error from the bank later.
    if (f.type === 'account' && f.speed === 'instant_bank') {
      const ok = window.confirm(isAr
        ? 'انت مدخل رقم حساب عادي مش IBAN، والتحويل السريع مش بيقبل غير IBAN.\nنحوّله لتحويل عادي (خلال يومي عمل) ونحفظ؟'
        : 'You entered an account number, not an IBAN, and a fast transfer takes an IBAN only.\nSwitch to the standard transfer (~2 working days) and save?');
      if (!ok) return;
      f = { ...f, speed: 'bank_card' };
      setMethodForm(f);
    }
    setMethodSaving(true);
    setMethodError('');
    try {
      const bank = { full_name: f.full_name, bank_code: f.bank_code, bank_card_number: f.bank_card_number };
      await vendorWalletApi.setPayoutMethod({
        type: f.type,
        ...({
          account: { ...bank, issuer: f.speed },
          iban: { ...bank, issuer: f.speed, bank_card_number: `EG${f.bank_card_number}` },
          card: { ...bank, issuer: 'bank_card' },
          wallet: { msisdn: f.msisdn, issuer: f.provider || walletOf(f.msisdn) },
        }[f.type]),
        password: f.password,
      });
      setMethodOpen(false);
      setNotice(isAr ? 'تم حفظ وسيلة استلام الفلوس.' : 'Payout method saved.');
      setTimeout(() => setNotice(''), 5000);
      await load();
    } catch (err) {
      setMethodError(err.message || 'Could not save');
    } finally {
      setMethodSaving(false);
    }
  };

  const requestPayout = async () => {
    setRequesting(true);
    setError('');
    try {
      await vendorWalletApi.createWithdrawal({ channel: 'paymob' });
      setConfirmOpen(false);
      setNotice(isAr ? 'تم إرسال طلبك. هيتحوّل أول ما الإدارة توافق.' : 'Request sent. It is transferred as soon as it is approved.');
      setTimeout(() => setNotice(''), 8000);
      await load();
    } catch (err) {
      setConfirmOpen(false);
      setError(err.message || 'Failed to request payout');
    } finally {
      setRequesting(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center min-h-[400px]">
        <Loader2 size={32} className="animate-spin text-marine-primary" />
      </div>
    );
  }

  const wallet = summary?.wallet;
  const withdrawable = summary?.withdrawable;
  const hold = summary?.payout_hold;
  const method = summary?.payout_method;
  const openRequest = (summary?.counts?.open_withdrawals || 0) > 0;
  const settlementDays = summary?.settlement_days || 14;
  const isBankAccount = ['account', 'iban'].includes(methodForm.type);
  // The two bank channels take different bank lists; a card only travels on `bank_card`.
  const bankChannel = isBankAccount ? methodForm.speed : 'bank_card';
  const bankCodes = methodInfo?.options?.bank_codes?.[bankChannel] || {};
  const issuerOptions = methodInfo?.options?.issuers || [];
  const walletIssuers = issuerOptions.filter((o) => (methodInfo?.options?.wallet_issuers || []).includes(o.id));
  const fastMinimum = methodInfo?.options?.min_amount?.instant_bank;
  const setMethod = (patch) => setMethodForm((f) => ({ ...f, ...patch }));
  // One number box serves account, IBAN and card; a number typed for one is not carried to another.
  // Paymob's fast transfer takes an IBAN only: an account number goes by the standard one.
  const pickType = (type) => setMethodForm((f) => (f.type === type ? f : { ...f, type, bank_card_number: '' }));
  // An account number on the fast transfer cannot be paid (it takes an IBAN only).
  const fastNeedsIban = methodForm.type === 'account' && methodForm.speed === 'instant_bank';
  // An IBAN typed into the account number box ("EG38…", or its 27 digits) belongs in the IBAN box.
  const typeAccountNumber = (value) => {
    const compact = String(value).replace(/[\s-]/g, '');
    if (/^EG\d{0,27}$/i.test(compact) && compact.length > 2 || /^\d{27}$/.test(compact)) {
      setMethodForm((f) => ({ ...f, type: 'iban', bank_card_number: compact.replace(/^EG/i, '') }));
      return;
    }
    setMethod({ bank_card_number: value });
  };

  const cards = [
    { key: 'available', label: isAr ? 'الرصيد المتاح' : 'Available', value: wallet?.available_balance, icon: Wallet },
    { key: 'pending', label: isAr ? 'في فترة التسوية' : 'Settling', value: wallet?.pending_balance, icon: Clock },
    { key: 'reserved', label: isAr ? 'جاري تحويله' : 'Being paid out', value: wallet?.reserved_balance, icon: Lock },
    { key: 'withdrawn', label: isAr ? 'إجمالي اللي اتحوّل' : 'Total paid out', value: wallet?.total_withdrawn, icon: CheckCircle2 },
  ];
  if ((wallet?.frozen_balance || 0) > 0) {
    cards.splice(2, 0, { key: 'frozen', label: isAr ? 'مجمّد من الإدارة' : 'On hold by Ready Marine', value: wallet.frozen_balance, icon: Snowflake });
  }

  return (
    <div className="max-w-5xl mx-auto pb-12 animate-in fade-in duration-300" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">
            {isAr ? 'المحفظة والأرباح' : 'Wallet & Earnings'}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            {isAr
              ? `فلوس كل طلب بتدخل محفظتك بعد ${settlementDays} يوم من استلام العميل (فترة التسوية)، وبعدها بتتحوّل لمحفظتك أو حسابك البنكي.`
              : `Each order's money reaches your wallet ${settlementDays} days after the customer receives it (the settlement period), then it is transferred to your wallet or bank account.`}
          </p>
        </div>
        <Link
          href="/dashboard/wallet/withdrawals"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-200 text-sm font-bold hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
        >
          {isAr ? 'التحويلات والفواتير' : 'Payouts & invoices'}
          <ArrowRight size={16} className={isAr ? 'rotate-180' : ''} />
        </Link>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
          <Info size={16} /> {error}
        </div>
      )}
      {notice && (
        <div className="mb-6 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-4 py-3 rounded-xl text-sm font-bold">
          {notice}
        </div>
      )}
      {hold && (
        <div className="mb-6 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-800 dark:text-amber-300 px-4 py-3 rounded-xl text-sm flex items-start gap-2">
          <PauseCircle size={18} className="shrink-0 mt-0.5" />
          <span>
            <b>{isAr ? 'التحويلات لمتجرك موقوفة مؤقتًا من الإدارة. ' : 'Payouts to your store are on hold. '}</b>
            {hold.reason}
          </span>
        </div>
      )}

      {/* Summary cards */}
      <div className={`grid grid-cols-2 ${cards.length > 4 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-4 mb-6`}>
        {cards.map((c) => (
          <div key={c.key} className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-2 text-zinc-400 mb-3">
              <c.icon size={16} />
              <span className="text-xs font-bold uppercase tracking-wider">{c.label}</span>
            </div>
            <div className={`text-xl font-black ${c.key === 'available' ? 'text-emerald-600 dark:text-emerald-400' : c.key === 'frozen' ? 'text-sky-600 dark:text-sky-400' : 'text-zinc-900 dark:text-white'}`}>
              {fmt(c.value)}
            </div>
          </div>
        ))}
      </div>

      {/* Payout method + request */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        <div className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <Smartphone size={18} className="text-zinc-400 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">{isAr ? 'فلوسك بتتحوّل على' : 'Your money is sent to'}</p>
                {method ? (
                  <>
                    <p className="font-bold text-zinc-900 dark:text-white mt-1">{isAr ? method.label?.ar : method.label?.en}</p>
                    <p className="text-sm text-zinc-500 break-all" dir="ltr">{[method.bank_name, method.account].filter(Boolean).join(' · ')}</p>
                  </>
                ) : (
                  <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                    {isAr ? 'لسه ماحددتش محفظة أو حساب بنكي — ضيفه علشان نقدر نحوّلك فلوسك.' : 'You have not added a wallet or bank account yet — add one so we can pay you.'}
                  </p>
                )}
              </div>
            </div>
            <button onClick={openMethod} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-100 dark:bg-white/5 text-xs font-bold text-zinc-700 dark:text-zinc-300 shrink-0">
              <Pencil size={14} /> {method ? (isAr ? 'تغيير' : 'Change') : (isAr ? 'إضافة' : 'Add')}
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">{isAr ? 'تقدر تطلب دلوقتي' : 'You can request now'}</p>
            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{fmt(withdrawable?.amount)}</p>
            <p className="text-xs text-zinc-500">
              {isAr ? `${withdrawable?.orders || 0} طلب خلصت تسويته` : `${withdrawable?.orders || 0} settled order(s)`}
              {withdrawable?.deductions > 0 && (isAr
                ? ` · بعد خصم ${fmt(withdrawable.deductions)} مستحقة على المحفظة`
                : ` · after ${fmt(withdrawable.deductions)} the wallet owes`)}
              {withdrawable?.deductions < 0 && (isAr
                ? ` · + ${fmt(-withdrawable.deductions)} رصيد لصالحك`
                : ` · + ${fmt(-withdrawable.deductions)} credit in your favour`)}
            </p>
          </div>
          <button
            onClick={() => setConfirmOpen(true)}
            disabled={!method || hold || openRequest || !(withdrawable?.amount > 0)}
            title={openRequest ? (isAr ? 'عندك طلب شغال بالفعل' : 'You already have a request in progress') : ''}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-marine-cyan text-white text-sm font-bold hover:bg-marine-cyan-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            <Send size={16} /> {isAr ? 'اطلب فلوسك' : 'Request payout'}
          </button>
        </div>
      </div>
      {openRequest && (
        <p className="-mt-5 mb-8 text-xs text-zinc-500">
          {isAr ? 'عندك طلب شغال — تابعه من ' : 'You have a request in progress — follow it in '}
          <Link href="/dashboard/wallet/withdrawals" className="font-bold text-marine-primary hover:underline">{isAr ? 'التحويلات والفواتير' : 'Payouts & invoices'}</Link>.
        </p>
      )}

      {/* Earnings ledger */}
      <div className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
          <h3 className="font-bold text-zinc-900 dark:text-white">{isAr ? 'سجل الأرباح' : 'Earnings Ledger'}</h3>
        </div>

        {earnings.length === 0 ? (
          <div className="p-12 text-center text-zinc-500">
            <Wallet size={32} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">{isAr ? 'لا توجد أرباح بعد.' : 'No earnings yet.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="text-zinc-400 text-xs uppercase tracking-wider border-b border-zinc-100 dark:border-white/5">
                  <th className="text-start font-bold px-6 py-3">{isAr ? 'الطلب' : 'Order'}</th>
                  <th className="text-start font-bold px-6 py-3">{isAr ? 'الصافي' : 'Net'}</th>
                  <th className="text-start font-bold px-6 py-3">{isAr ? 'تاريخ التسليم' : 'Delivered'}</th>
                  <th className="text-start font-bold px-6 py-3">{isAr ? 'يُتاح في' : 'Clears on'}</th>
                  <th className="text-start font-bold px-6 py-3">{isAr ? 'الحالة' : 'Status'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                {earnings.map((e) => {
                  const state = rowState(e);
                  return (
                    <tr key={e._id} className="hover:bg-zinc-50 dark:hover:bg-white/[0.01]">
                      <td className="px-6 py-4 font-mono text-xs text-zinc-500">#{String(e.order_id).slice(-8)}</td>
                      <td className="px-6 py-4 font-black text-zinc-900 dark:text-white">{fmt(e.effective_net)}</td>
                      <td className="px-6 py-4 text-zinc-500">{fmtDate(e.delivered_at)}</td>
                      <td className="px-6 py-4 text-zinc-500">{fmtDate(e.clearable_at)}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold ${STATUS_STYLES[state] || ''}`}>
                          {statusLabel(state)}
                        </span>
                        {state === 'frozen' && e.frozen?.reason && (
                          <p className="text-[11px] text-sky-600 dark:text-sky-400 mt-1">{e.frozen.reason}</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-6 text-xs text-zinc-400 italic text-center">
        {isAr
          ? '* الصافي = إجمالي منتجاتك في الطلب − نصيبك من كوبون الخصم (لو الكوبون بيتحمّله التاجر جزئيًا أو كليًا) − العمولة (لا يشمل الشحن). تُخصم المبالغ المستردة من رصيدك. رسوم التحويل على Ready Marine.'
          : '* Net = your item subtotal − your share of any coupon (when a coupon is partly or fully vendor-funded) − commission (shipping excluded). Refunds are deducted from your balance. Transfer fees are paid by Ready Marine.'}
      </p>

      {/* Confirm request */}
      {confirmOpen && (
        <Overlay className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !requesting && setConfirmOpen(false)}>
          <div className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/10 rounded-2xl w-full max-w-md p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg text-zinc-900 dark:text-white mb-2">{isAr ? 'تأكيد طلب الفلوس' : 'Confirm your payout request'}</h3>
            <p className="text-sm text-zinc-500 mb-4">
              {isAr
                ? `هنطلب تحويل ${fmt(withdrawable?.amount)} (${withdrawable?.orders} طلب) على ${method?.label?.ar} ${method?.account || ''}. بعد موافقة الإدارة الفلوس بتتحوّل على طول.`
                : `We will ask to transfer ${fmt(withdrawable?.amount)} (${withdrawable?.orders} orders) to ${method?.label?.en} ${method?.account || ''}. It is sent as soon as it is approved.`}
            </p>
            <div className="flex gap-2">
              <button disabled={requesting} onClick={requestPayout}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-marine-cyan text-white text-sm font-bold hover:bg-marine-cyan-dark disabled:opacity-50">
                {requesting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} {isAr ? 'تأكيد' : 'Confirm'}
              </button>
              <button onClick={() => setConfirmOpen(false)} className="px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-sm font-bold text-zinc-600 dark:text-zinc-300">
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
            </div>
          </div>
        </Overlay>
      )}

      {/* Payout method form */}
      {methodOpen && (
        <Overlay className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !methodSaving && setMethodOpen(false)}>
          <form onSubmit={saveMethod} className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/10 rounded-2xl w-full max-w-lg p-6 shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg text-zinc-900 dark:text-white">{isAr ? 'فين نحوّلك فلوسك؟' : 'Where should we send your money?'}</h3>
              <button type="button" onClick={() => setMethodOpen(false)} className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white"><X size={20} /></button>
            </div>

            {!methodInfo && !methodError ? (
              <Loader2 size={24} className="animate-spin text-zinc-400 mx-auto my-8" />
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-bold text-zinc-900 dark:text-white mb-2">{isAr ? 'هتستلم فلوسك إزاي؟' : 'How will you be paid?'}</p>
                  <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                    {METHOD_TABS.map((t) => {
                      const active = t.types.includes(methodForm.type);
                      return (
                        <button key={t.id} type="button" onClick={() => !active && pickType(t.types[0])}
                          className={`shrink-0 min-w-[104px] flex flex-col items-center gap-2 px-3 py-3 rounded-xl border text-xs font-bold transition-colors ${active
                            ? 'border-marine-cyan bg-red-50 dark:bg-marine-cyan/10 text-marine-primary'
                            : 'border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300'}`}>
                          <t.icon size={20} />
                          {isAr ? t.ar : t.en}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {isBankAccount && (
                  <div className="grid grid-cols-2 gap-1 p-1 rounded-xl border border-zinc-200 dark:border-white/10">
                    {[{ id: 'account', en: 'Account', ar: 'رقم حساب' }, { id: 'iban', en: 'IBAN', ar: 'IBAN' }].map((o) => (
                      <button key={o.id} type="button" onClick={() => pickType(o.id)}
                        className={`py-2 rounded-lg text-sm font-bold transition-colors ${methodForm.type === o.id
                          ? 'bg-marine-cyan text-white'
                          : 'text-zinc-600 dark:text-zinc-300'}`}>
                        {isAr ? o.ar : o.en}
                      </button>
                    ))}
                  </div>
                )}

                {isBankAccount && (
                  <Field label={isAr ? 'اسم المستفيد' : "Beneficiary's name"}>
                    <input required value={methodForm.full_name} onChange={(e) => setMethod({ full_name: e.target.value })}
                      placeholder={isAr ? 'ادخل اسم المستفيد' : "Enter the beneficiary's name"} className={INPUT} />
                  </Field>
                )}

                {methodForm.type === 'card' && (
                  <>
                    <Field label={isAr ? 'رقم الكارت' : 'Card Number'}>
                      <input required value={methodForm.bank_card_number} onChange={(e) => setMethod({ bank_card_number: e.target.value })}
                        placeholder={isAr ? 'رقم الكارت' : 'Card Number'} inputMode="numeric" className={INPUT} />
                    </Field>
                    <Field label={isAr ? 'اسم صاحب الكارت' : 'Card holder name'}>
                      <input required value={methodForm.full_name} onChange={(e) => setMethod({ full_name: e.target.value })}
                        placeholder={isAr ? 'اسم صاحب الكارت' : 'Card holder name'} className={INPUT} />
                    </Field>
                  </>
                )}

                {isBankAccount && (
                  <Field label={isAr ? 'سرعة التحويل' : 'Transfer speed'}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {issuerOptions.filter((o) => ['bank_card', 'instant_bank'].includes(o.id)).map((o) => (
                        <button key={o.id} type="button" onClick={() => setMethod({ speed: o.id })}
                          className={`text-start px-3 py-2.5 rounded-xl border text-sm font-bold transition-colors ${methodForm.speed === o.id
                            ? 'border-marine-cyan bg-red-50 dark:bg-marine-cyan/10 text-marine-primary'
                            : 'border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300'}`}>
                          {isAr ? o.label.ar : o.label.en}
                        </button>
                      ))}
                    </div>
                    {fastNeedsIban && (
                      <div role="alert" className="mt-2 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/30 p-3 space-y-2">
                        <p className="text-xs font-bold text-amber-800 dark:text-amber-300">
                          {isAr
                            ? 'انت مدخل رقم حساب عادي مش IBAN، والتحويل السريع مش بيقبل غير IBAN.'
                            : 'You entered an account number, not an IBAN, and a fast transfer takes an IBAN only.'}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => setMethod({ speed: 'bank_card' })}
                            className="rounded-lg bg-marine-cyan px-3 py-1.5 text-xs font-bold text-white hover:bg-marine-cyan-dark">
                            {isAr ? 'اقلبه لتحويل عادي' : 'Switch to standard transfer'}
                          </button>
                          <button type="button" onClick={() => pickType('iban')}
                            className="rounded-lg border border-amber-300 dark:border-amber-500/40 px-3 py-1.5 text-xs font-bold text-amber-800 dark:text-amber-300">
                            {isAr ? 'هكتب الـ IBAN' : "I'll enter the IBAN"}
                          </button>
                        </div>
                      </div>
                    )}
                    {methodForm.speed === 'instant_bank' && fastMinimum && !fastNeedsIban && (
                      <span className="block text-xs text-zinc-500 mt-1.5">
                        {isAr ? `التحويل السريع أقل مبلغ فيه ${fastMinimum} جنيه.` : `Fast transfers have a ${fastMinimum} EGP minimum.`}
                      </span>
                    )}
                  </Field>
                )}

                {methodForm.type !== 'wallet' && (
                  <Field label={isAr ? 'اسم البنك' : 'Bank name'}>
                    <select required value={bankCodes[methodForm.bank_code] ? methodForm.bank_code : ''} onChange={(e) => setMethod({ bank_code: e.target.value })} className={INPUT}>
                      <option value="">{isAr ? 'اختار البنك' : 'Choose bank'}</option>
                      {Object.entries(bankCodes).sort((a, b) => a[1].localeCompare(b[1])).map(([code, name]) => (
                        <option key={code} value={code}>{name}</option>
                      ))}
                    </select>
                  </Field>
                )}

                {methodForm.type === 'account' && (
                  <Field label={isAr ? 'رقم الحساب' : 'Account number'}>
                    <input required value={methodForm.bank_card_number} onChange={(e) => typeAccountNumber(e.target.value)}
                      placeholder={isAr ? 'ادخل رقم الحساب' : 'Enter account number'} inputMode="numeric" className={INPUT} />
                  </Field>
                )}

                {methodForm.type === 'iban' && (
                  <Field label={isAr ? 'رقم الـ IBAN' : 'IBAN number'}>
                    <div dir="ltr" className="flex items-center rounded-xl border border-zinc-200 dark:border-white/10">
                      <span className="px-3 text-sm font-bold text-zinc-900 dark:text-white border-e border-zinc-200 dark:border-white/10">EG</span>
                      <input required value={methodForm.bank_card_number}
                        onChange={(e) => setMethod({ bank_card_number: e.target.value.replace(/^\s*EG/i, '') })}
                        placeholder={isAr ? 'ادخل رقم الـ IBAN' : 'Enter IBAN number'} inputMode="numeric"
                        className="flex-1 min-w-0 px-3 py-2.5 bg-transparent text-zinc-900 dark:text-white text-sm outline-none" />
                    </div>
                  </Field>
                )}

                {methodForm.type === 'wallet' && (
                  <>
                    <Field label={isAr ? 'رقم الموبايل' : 'Mobile number'}>
                      <input required value={methodForm.msisdn} onChange={(e) => setMethod({ msisdn: e.target.value })}
                        placeholder={isAr ? 'رقم الموبايل' : 'Mobile number'} inputMode="tel" className={INPUT} />
                    </Field>
                    <Field label={isAr ? 'نوع المحفظة' : 'Wallet provider'}>
                      <select required value={methodForm.provider || walletOf(methodForm.msisdn)} onChange={(e) => setMethod({ provider: e.target.value })} className={INPUT}>
                        <option value="">{isAr ? 'اختار المحفظة' : 'Choose the wallet'}</option>
                        {walletIssuers.map((o) => <option key={o.id} value={o.id}>{isAr ? o.label.ar : o.label.en}</option>)}
                      </select>
                    </Field>
                  </>
                )}

                <Field label={isAr ? 'ادخل كلمة سر متجرك كتاجر للتأكيد' : 'Enter your store (vendor) password to confirm'}>
                  <input required type="password" value={methodForm.password} onChange={(e) => setMethod({ password: e.target.value })}
                    autoComplete="current-password" className={INPUT} />
                </Field>

                {methodError && <p className="text-sm text-red-500">{methodError}</p>}

                <button type="submit" disabled={methodSaving}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-marine-cyan text-white text-sm font-bold hover:bg-marine-cyan-dark disabled:opacity-50">
                  {methodSaving && <Loader2 size={16} className="animate-spin" />}
                  {isAr ? 'حفظ' : 'Save'}
                </button>
              </div>
            )}
          </form>
        </Overlay>
      )}
    </div>
  );
}

const INPUT = 'w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-transparent text-zinc-900 dark:text-white text-sm';

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-zinc-500 mb-1.5">{label}</span>
      {children}
    </label>
  );
}
