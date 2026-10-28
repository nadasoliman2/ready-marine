'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from '../../lib/navigation';
import { Wallet, Loader2, AlertCircle, Plus, Info, Lock, CheckCircle2, Clock } from 'lucide-react';
import { walletApi } from '../../lib/api';
import { walletCopy, walletTypeLabel, walletTypeSign, topupStatusLabel } from '../../lib/walletLocalization';

const formatDate = (value, isAr) => value
    ? new Date(value).toLocaleDateString(isAr ? 'ar-u-ca-gregory' : 'en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
    })
    : '—';

const money = (value) => Number(value || 0).toFixed(2);

/**
 * Profile → My Wallet.
 *
 * The balance is the customer's own money, so this screen is built to be
 * checkable rather than merely pretty: every row carries the balance it left
 * behind, so a customer who disputes a number can follow the arithmetic
 * themselves instead of having to ask support to explain it.
 *
 * The "credit cannot be withdrawn" rule sits next to the balance, not in a
 * terms page — it is the one fact that changes what this money is worth to
 * them, and burying it would be a dark pattern.
 */
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
                if (!cancelled) setError(err.message || 'Could not load your wallet');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [load]);

    /**
     * Settle a gateway return.
     *
     * The query string says what the gateway *claims* happened; the server is
     * asked to confirm it against the provider before anything is shown as
     * successful. The params are then stripped from the URL so a refresh — or a
     * shared link — cannot replay a stale "success" banner.
     */
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
                        setNotice({ tone: 'pending', text: copy.topUpPending });
                    }
                } else if (status === 'pending') {
                    setNotice({ tone: 'pending', text: copy.topUpPending });
                } else if (status === 'failed') {
                    setNotice({ tone: 'error', text: copy.topUpFailed });
                }
            } catch (err) {
                if (!cancelled) setNotice({ tone: 'error', text: err.message || copy.topUpFailed });
            } finally {
                if (!cancelled) router.replace('/profile?tab=wallet', { scroll: false });
            }
        })();

        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);

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
            setError(err.message || 'Could not load more');
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
                return_path: '/profile?tab=wallet',
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
            <div className="flex items-center justify-center py-20">
                <Loader2 size={32} className="text-marine-primary animate-spin" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-3">
                <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-600">{error}</p>
            </div>
        );
    }

    const balances = wallet?.balances || {};
    const currency = balances.currency || 'EGP';
    const isFrozen = balances.status === 'frozen';
    const canTopUp = wallet?.topup_enabled && !isFrozen;
    const suggestions = wallet?.topup_suggestions || [];

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <h3 className="text-2xl font-black text-zinc-900 flex items-center gap-3">
                <Wallet className="text-marine-primary" /> {copy.myWallet}
            </h3>

            {notice && (
                <div className={`p-4 rounded-2xl border flex items-start gap-3 ${
                    notice.tone === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : notice.tone === 'pending' ? 'bg-amber-50 border-amber-200 text-amber-700'
                            : 'bg-red-50 border-red-200 text-red-600'
                }`}>
                    {notice.tone === 'success'
                        ? <CheckCircle2 size={18} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                        : notice.tone === 'pending'
                            ? <Clock size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
                            : <AlertCircle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />}
                    <p className="text-sm font-medium">{notice.text}</p>
                </div>
            )}

            {isFrozen && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
                    <Lock size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-amber-800 font-bold text-sm">{copy.frozen}</p>
                        <p className="text-amber-700 text-xs mt-1 leading-relaxed">
                            {balances.frozen_reason || copy.frozenHint}
                        </p>
                    </div>
                </div>
            )}

            {/* ---- Balance ---- */}
            <div className="p-6 rounded-2xl border bg-gradient-to-br from-marine-mist/60 to-marine-canvas border-marine-cyan/25">
                <p className="text-zinc-500 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                    <Wallet size={12} className="text-marine-primary" />{copy.balance}
                </p>
                <p className="text-3xl sm:text-4xl font-black text-zinc-900 mt-2">
                    <span className="text-lg font-bold text-zinc-500 me-2">{currency}</span>
                    {money(balances.available)}
                </p>
                <p className="text-zinc-500 text-[11px] mt-3 leading-relaxed">{copy.balanceHint}</p>

                {/* Shown only when non-zero — a permanent "0 on hold" row is
                    noise the customer cannot act on. */}
                {Number(balances.reserved || 0) > 0 && (
                    <div className="mt-4 pt-4 border-t border-zinc-200">
                        <p className="text-zinc-500 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                            <Lock size={12} />{copy.reserved}
                        </p>
                        <p className="text-xl font-black text-zinc-800 mt-1">{currency} {money(balances.reserved)}</p>
                        <p className="text-zinc-500 text-[11px] mt-1 leading-relaxed">{copy.reservedHint}</p>
                    </div>
                )}
            </div>

            {/* ---- Top up ---- */}
            {canTopUp && (
                <div className="p-5 bg-zinc-50/70 border border-zinc-200/80 rounded-2xl">
                    <p className="text-zinc-900 font-bold mb-1 flex items-center gap-2">
                        <Plus size={16} className="text-marine-primary" />{copy.topUpTitle}
                    </p>
                    <p className="text-zinc-500 text-xs mb-4 leading-relaxed">{copy.topUpNote}</p>

                    {suggestions.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-4">
                            {suggestions.map((value) => (
                                <button
                                    key={value}
                                    type="button"
                                    disabled={submitting}
                                    onClick={() => setAmount(String(value))}
                                    className={`px-4 py-2 rounded-xl border text-sm font-bold transition-colors disabled:opacity-50 ${
                                        String(value) === amount
                                            ? 'border-marine-cyan bg-marine-cyan text-white shadow-sm'
                                            : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
                                    }`}
                                >
                                    {currency} {value}
                                </button>
                            ))}
                        </div>
                    )}

                    <label className="text-xs font-semibold text-zinc-700 uppercase tracking-wider">{copy.topUpCustom}</label>
                    <div className="flex flex-col sm:flex-row gap-3 mt-2">
                        <input
                            type="number"
                            min="1"
                            step="0.01"
                            inputMode="decimal"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder={copy.topUpAmount}
                            className="flex-1 px-4 py-3 rounded-xl bg-white border border-zinc-200 text-zinc-900 outline-none focus:border-marine-cyan transition-colors text-sm"
                        />
                        <button
                            type="button"
                            disabled={submitting || !amount}
                            onClick={() => startTopup(amount)}
                            className="px-6 py-3 rounded-xl bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-[0_4px_14px_0_rgba(0,166,206,0.35)]"
                        >
                            {submitting ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                            {copy.topUpAction}
                        </button>
                    </div>
                </div>
            )}

            {/* ---- Rules ---- */}
            <div className="p-5 bg-zinc-50/70 border border-zinc-200/80 rounded-2xl">
                <p className="text-zinc-900 font-bold mb-3 flex items-center gap-2">
                    <Info size={16} className="text-marine-primary" />{copy.howItWorks}
                </p>
                <ul className="space-y-1.5 text-sm text-zinc-600">
                    <li>· {copy.ruleTopUp}</li>
                    <li>· {copy.ruleRefunds}</li>
                    <li>· {copy.ruleNoExpiry}</li>
                    <li>· {copy.ruleNoWithdrawal}</li>
                </ul>
            </div>

            {/* ---- Recent top-ups ---- */}
            {topups.length > 0 && (
                <div>
                    <p className="text-zinc-900 font-bold mb-4">{copy.topupHistory}</p>
                    <div className="space-y-2">
                        {topups.map((t) => (
                            <div key={t._id} className="flex items-center justify-between gap-4 p-4 bg-white border border-zinc-200/80 rounded-xl shadow-xs">
                                <div className="min-w-0">
                                    <p className="text-zinc-900 text-sm font-bold">{currency} {money(t.amount)}</p>
                                    <p className="text-zinc-500 text-xs mt-0.5">{formatDate(t.created_at, isAr)}</p>
                                </div>
                                <div className="text-end flex-shrink-0">
                                    <p className={`text-xs font-bold ${
                                        t.status === 'paid' ? 'text-emerald-600'
                                            : t.status === 'pending' ? 'text-amber-600' : 'text-zinc-500'
                                    }`}>
                                        {topupStatusLabel(t.status, isAr)}
                                    </p>
                                    {/* An unpaid invoice is still payable — offering the
                                        link back is cheaper for everyone than starting over. */}
                                    {t.status === 'pending' && t.payment_url && (
                                        <a
                                            href={t.payment_url}
                                            className="text-[11px] text-marine-primary hover:underline font-bold"
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

            {/* ---- Ledger ---- */}
            <div>
                <p className="text-zinc-900 font-bold mb-4">{copy.history}</p>
                {history.length === 0 ? (
                    <div className="p-6 bg-zinc-50 border border-zinc-200 rounded-2xl text-center">
                        <p className="text-zinc-500 text-sm">{copy.emptyWallet}</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {history.map((entry) => {
                            const sign = walletTypeSign(entry.type);
                            return (
                                <div
                                    key={entry._id}
                                    className="flex items-start justify-between gap-4 p-4 bg-white border border-zinc-200/80 rounded-xl shadow-xs"
                                >
                                    <div className="min-w-0">
                                        <p className="text-zinc-900 text-sm font-bold">{walletTypeLabel(entry.type, isAr)}</p>
                                        <p className="text-zinc-500 text-xs mt-0.5">{formatDate(entry.created_at, isAr)}</p>
                                        {entry.order?.reference && (
                                            <p className="text-zinc-500 text-xs mt-1">
                                                {copy.order} #{entry.order.reference}
                                            </p>
                                        )}
                                        {/* The reason matters most on a support adjustment —
                                            it is the only explanation the customer will get. */}
                                        {entry.reason && (
                                            <p className="text-zinc-600 text-xs mt-1 leading-relaxed">{entry.reason}</p>
                                        )}
                                    </div>
                                    <div className="text-end flex-shrink-0">
                                        <p className={`font-black text-sm ${sign === '+' ? 'text-emerald-600' : 'text-red-500'}`}>
                                            {sign}{currency} {money(entry.amount)}
                                        </p>
                                        <p className="text-zinc-500 text-[11px] mt-0.5">
                                            {copy.balanceAfterLabel} {money(entry.balance_after)}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}

                        {pagination && page < pagination.pages && (
                            <button
                                type="button"
                                onClick={loadMore}
                                disabled={loadingMore}
                                className="w-full py-3 rounded-xl bg-zinc-100 border border-zinc-200 text-zinc-700 font-bold text-sm hover:bg-zinc-200 transition-colors disabled:opacity-50"
                            >
                                {loadingMore ? <Loader2 size={16} className="animate-spin mx-auto" /> : copy.loadMore}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
