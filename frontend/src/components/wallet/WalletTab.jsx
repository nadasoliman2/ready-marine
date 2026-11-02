'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from '../../lib/navigation';
import {
  Wallet,
  Loader2,
  AlertCircle,
  Plus,
  Info,
  Lock,
  CheckCircle2,
  Clock,
  ArrowRight,
  ShieldCheck,
  CreditCard,
} from 'lucide-react';
import { walletApi } from '../../lib/api';
import { walletCopy, walletTypeLabel, walletTypeSign, topupStatusLabel } from '../../lib/walletLocalization';

const formatDate = (value, isAr) =>
  value
    ? new Date(value).toLocaleDateString(isAr ? 'ar-u-ca-gregory' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '—';

const money = (value) => Number(value || 0).toFixed(2);

export default function WalletTab({ isAr }) {
  const copy = useMemo(() => walletCopy(isAr), [isAr]);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [wallet, setWallet] = useState(null);
  const [history, setHistory] = useState([]);
  const [topups, setTopups] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);

  // Top-up form
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const [walletData, historyData, topupData] = await Promise.all([
      walletApi.get(),
      walletApi.getTransactions({ page: 1, limit: 20 }),
      walletApi.getTopups({ page: 1, limit: 5 }),
    ]);
    setWallet(walletData);
    setHistory(historyData?.transactions || []);
    setPagination(historyData?.pagination || null);
    setTopups(topupData?.topups || []);
    setPage(1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (err) {
        if (!cancelled) setError(err.message || (isAr ? 'تعذر تحميل بيانات المحفظة' : 'Could not load your wallet'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, isAr]);

  useEffect(() => {
    const status = searchParams.get('topup');
    const topupId = searchParams.get('topupId');
    if (!status) return;

    let cancelled = false;
    (async () => {
      try {
        if (status === 'success' && topupId) {
          const result = await walletApi.confirmTopup({ topupId });
          if (cancelled) return;
          if (result.status === 'paid') {
            setNotice({
              tone: 'success',
              text: copy.topUpSuccess(money(result.amount), result.balances?.currency || 'EGP'),
            });
            await load();
          } else {
            setNotice({
              tone: 'pending',
              text: isAr ? 'عملية الشحن قيد التأكيد من بوابة الدفع.' : 'Top-up is being confirmed by the payment gateway.',
            });
          }
        } else if (status === 'cancel') {
          setNotice({
            tone: 'error',
            text: isAr ? 'تم إلغاء عملية الشحن.' : 'Top-up was cancelled.',
          });
        }
      } catch (err) {
        if (!cancelled) setNotice({ tone: 'error', text: err.message || copy.topUpFailed });
      } finally {
        const url = new URL(window.location.href);
        url.searchParams.delete('topup');
        url.searchParams.delete('topupId');
        window.history.replaceState({}, '', url.toString());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, copy, load, isAr]);

  const loadMore = async () => {
    if (loadingMore || !pagination || page >= pagination.pages) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const data = await walletApi.getTransactions({ page: next, limit: 20 });
      setHistory((prev) => [...prev, ...(data?.transactions || [])]);
      setPagination(data?.pagination || pagination);
      setPage(next);
    } catch (err) {
      setError(err.message || (isAr ? 'تعذر تحميل المزيد' : 'Could not load more'));
    } finally {
      setLoadingMore(false);
    }
  };

  const startTopup = async (value) => {
    const requested = Number(value);
    if (!Number.isFinite(requested) || requested <= 0) {
      setNotice({ tone: 'error', text: copy.amountRequired });
      return;
    }

    setSubmitting(true);
    setNotice(null);
    try {
      const result = await walletApi.createTopup({
        amount: requested,
        origin: 'wallet',
        return_path: '/profile?view=wallet',
      });
      if (result?.paymentUrl) {
        window.location.href = result.paymentUrl;
        return;
      }
      setNotice({ tone: 'error', text: copy.topUpFailed });
    } catch (err) {
      setNotice({ tone: 'error', text: err.message || copy.topUpFailed });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 bg-white border border-zinc-200/90 rounded-3xl p-8 shadow-xs">
        <Loader2 size={36} className="text-marine-primary animate-spin mb-3" />
        <p className="text-xs font-bold text-zinc-500">{isAr ? 'جاري تجهيز رصيد المحفظة...' : 'Loading wallet balance...'}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-5 bg-red-50 border border-red-200 rounded-3xl flex items-start gap-3 shadow-xs">
        <AlertCircle size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold text-red-700">{isAr ? 'حدث خطأ في المحفظة' : 'Wallet error'}</p>
          <p className="text-xs text-red-600 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  const balances = wallet?.balances || {};
  const currency = balances.currency || 'EGP';
  const isFrozen = balances.status === 'frozen';
  const canTopUp = wallet?.topup_enabled && !isFrozen;
  const suggestions = wallet?.topup_suggestions || [100, 250, 500, 1000];

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-300">
      {notice && (
        <div
          className={`p-4 rounded-2xl border flex items-start gap-3 shadow-xs ${
            notice.tone === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : notice.tone === 'pending'
              ? 'bg-amber-50 border-amber-200 text-amber-700'
              : 'bg-red-50 border-red-200 text-red-600'
          }`}
        >
          {notice.tone === 'success' ? (
            <CheckCircle2 size={18} className="text-emerald-500 flex-shrink-0 mt-0.5" />
          ) : notice.tone === 'pending' ? (
            <Clock size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          )}
          <p className="text-sm font-medium">{notice.text}</p>
        </div>
      )}

      {isFrozen && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3 shadow-xs">
          <Lock size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-amber-800 font-bold text-sm">{copy.frozen}</p>
            <p className="text-amber-700 text-xs mt-1 leading-relaxed">
              {balances.frozen_reason || copy.frozenHint}
            </p>
          </div>
        </div>
      )}

      {/* 2-COLUMN DESKTOP GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (5 cols): Balance Card + Top Up + Rules */}
        <div className="lg:col-span-5 space-y-6">
          {/* Hero Balance Card */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0E2A38] via-[#0C384D] to-[#006781] text-white p-6 sm:p-7 shadow-pod border border-white/10">
            <div className="absolute top-0 end-0 -mt-8 -me-8 w-48 h-48 rounded-full bg-marine-cyan/20 blur-2xl pointer-events-none" />

            <div className="relative z-10 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-cyan-200 flex items-center gap-1.5">
                  <Wallet size={15} />
                  {copy.balance}
                </span>
                <span className="px-3 py-1 rounded-full text-[11px] font-bold bg-white/10 border border-white/15 text-white backdrop-blur-md">
                  {isFrozen ? (isAr ? 'مجمدة' : 'Frozen') : (isAr ? 'نشطة وجاهزة' : 'Active')}
                </span>
              </div>

              <div>
                <p className="text-3xl sm:text-4xl font-black font-mono tracking-tight text-white">
                  {money(balances.available)}{' '}
                  <span className="text-lg font-bold text-cyan-200">{currency}</span>
                </p>
                <p className="text-xs text-white/70 mt-2 leading-relaxed">
                  {copy.balanceHint}
                </p>
              </div>

              {Number(balances.reserved || 0) > 0 && (
                <div className="pt-3 border-t border-white/15 flex items-center justify-between text-xs">
                  <span className="text-white/70 flex items-center gap-1">
                    <Lock size={12} /> {copy.reserved}
                  </span>
                  <span className="font-mono font-bold text-amber-300">
                    {currency} {money(balances.reserved)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Top Up Card */}
          {canTopUp && (
            <div className="bg-white border border-zinc-200/90 rounded-3xl p-6 shadow-xs space-y-4">
              <div className="flex items-center gap-2.5 pb-3 border-b border-zinc-100">
                <div className="w-8 h-8 rounded-xl bg-marine-mist text-marine-primary flex items-center justify-center">
                  <Plus size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-zinc-900">{copy.topUpTitle}</h3>
                  <p className="text-[11px] text-zinc-500">{copy.topUpNote}</p>
                </div>
              </div>

              {suggestions.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {suggestions.map((val) => (
                    <button
                      key={val}
                      type="button"
                      disabled={submitting}
                      onClick={() => setAmount(String(val))}
                      className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all disabled:opacity-50 ${
                        String(val) === amount
                          ? 'border-marine-cyan bg-marine-cyan text-white shadow-xs'
                          : 'border-zinc-200 bg-zinc-50/70 hover:bg-zinc-100 text-zinc-800'
                      }`}
                    >
                      {val} {currency}
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-zinc-600 uppercase tracking-wider">
                  {copy.topUpCustom}
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={copy.topUpAmount}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-50 border border-zinc-200 text-zinc-900 outline-none focus:border-marine-cyan focus:bg-white transition-colors text-xs font-mono"
                  />
                  <button
                    type="button"
                    disabled={submitting || !amount}
                    onClick={() => startTopup(amount)}
                    className="px-5 py-2.5 rounded-xl bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold text-xs transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-sm shrink-0"
                  >
                    {submitting ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
                    <span>{copy.topUpAction}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Rules Card */}
          <div className="bg-white border border-zinc-200/90 rounded-3xl p-5 shadow-xs space-y-3">
            <p className="text-zinc-900 font-bold text-xs flex items-center gap-2">
              <Info size={14} className="text-marine-primary" />
              {copy.howItWorks}
            </p>
            <ul className="space-y-2 text-xs text-zinc-600">
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-marine-cyan mt-1.5 shrink-0" />
                <span>{copy.ruleTopUp}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-marine-cyan mt-1.5 shrink-0" />
                <span>{copy.ruleRefunds}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-marine-cyan mt-1.5 shrink-0" />
                <span>{copy.ruleNoExpiry}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                <span>{copy.ruleNoWithdrawal}</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Right Column (7 cols): Transactions History & Topups */}
        <div className="lg:col-span-7 space-y-6">
          {/* Recent Top-ups if any */}
          {topups.length > 0 && (
            <div className="bg-white border border-zinc-200/90 rounded-3xl p-6 shadow-xs space-y-3">
              <h3 className="text-sm font-black text-zinc-900 pb-2 border-b border-zinc-100">
                {copy.topupHistory}
              </h3>
              <div className="space-y-2">
                {topups.map((t) => (
                  <div
                    key={t._id}
                    className="flex items-center justify-between gap-4 p-3.5 bg-zinc-50/70 border border-zinc-200/80 rounded-2xl"
                  >
                    <div className="min-w-0">
                      <p className="text-zinc-900 text-xs font-bold font-mono">
                        {currency} {money(t.amount)}
                      </p>
                      <p className="text-zinc-500 text-[11px] mt-0.5">{formatDate(t.created_at, isAr)}</p>
                    </div>
                    <div className="text-end shrink-0">
                      <p
                        className={`text-xs font-bold ${
                          t.status === 'paid'
                            ? 'text-emerald-600'
                            : t.status === 'pending'
                            ? 'text-amber-600'
                            : 'text-zinc-500'
                        }`}
                      >
                        {topupStatusLabel(t.status, isAr)}
                      </p>
                      {t.status === 'pending' && t.payment_url && (
                        <a
                          href={t.payment_url}
                          className="text-[11px] text-marine-primary hover:underline font-bold block mt-0.5"
                        >
                          {copy.topUpAction}
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ledger History */}
          <div className="bg-white border border-zinc-200/90 rounded-3xl p-6 shadow-xs">
            <div className="flex items-center justify-between pb-3 mb-4 border-b border-zinc-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-marine-mist text-marine-primary flex items-center justify-center">
                  <Wallet size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-black text-zinc-900">{copy.history}</h3>
                  <p className="text-[11px] text-zinc-500">{isAr ? 'كشف حركات الرصيد' : 'Wallet activity'}</p>
                </div>
              </div>
              {history.length > 0 && (
                <span className="text-xs font-bold text-zinc-500">
                  {history.length} {isAr ? 'معاملة' : 'entries'}
                </span>
              )}
            </div>

            {history.length === 0 ? (
              <div className="py-12 px-6 text-center space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-marine-mist text-marine-primary flex items-center justify-center mx-auto border border-marine-cyan/20">
                  <Wallet size={28} />
                </div>
                <h4 className="text-sm font-black text-zinc-800">
                  {copy.emptyWallet}
                </h4>
                <p className="text-xs text-zinc-500 max-w-xs mx-auto leading-relaxed">
                  {isAr
                    ? 'اشحن رصيد محفظتك لتسريع عمليات الدفع المستقبلية بنقرة واحدة.'
                    : 'Top up your wallet to enable one-click checkout on your next orders.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {history.map((entry) => {
                  const sign = walletTypeSign(entry.type);
                  return (
                    <div
                      key={entry._id}
                      className="flex items-start justify-between gap-4 p-3.5 bg-zinc-50/70 hover:bg-zinc-50 border border-zinc-200/80 rounded-2xl transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-zinc-900 text-xs font-bold">{walletTypeLabel(entry.type, isAr)}</p>
                        <p className="text-zinc-500 text-[11px] mt-0.5">{formatDate(entry.created_at, isAr)}</p>
                        {entry.reason && (
                          <p className="text-zinc-600 text-xs mt-1 leading-relaxed">{entry.reason}</p>
                        )}
                        {entry.order && (
                          <p className="text-zinc-500 text-[11px] mt-0.5">
                            {copy.order} #{entry.order.reference}
                          </p>
                        )}
                      </div>
                      <div className="text-end shrink-0">
                        <p
                          className={`font-black text-xs font-mono ${
                            sign === '+' ? 'text-emerald-600' : 'text-red-500'
                          }`}
                        >
                          {sign}{currency} {money(entry.amount)}
                        </p>
                        {entry.balance_after != null && (
                          <p className="text-zinc-400 text-[10px] mt-0.5 font-mono">
                            {currency} {money(entry.balance_after)}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}

                {pagination && page < pagination.pages && (
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="w-full py-2.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 border border-zinc-200 text-zinc-700 font-bold text-xs transition-colors disabled:opacity-50 mt-3"
                  >
                    {loadingMore ? <Loader2 size={14} className="animate-spin mx-auto" /> : copy.loadMore}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
