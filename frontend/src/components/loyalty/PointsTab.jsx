'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from '../LocaleLink';
import { Sparkles, Loader2, AlertCircle, Clock, Lock, Info, ArrowRight } from 'lucide-react';
import { loyaltyApi } from '../../lib/api';
import { loyaltyCopy, loyaltyTypeLabel, loyaltyTypeSign } from '../../lib/loyaltyLocalization';

const formatDate = (value, isAr) => value
    ? new Date(value).toLocaleDateString(isAr ? 'ar-u-ca-gregory' : 'en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
    })
    : '—';

/**
 * Profile → My Points.
 *
 * The three balances are shown as three separate cards on purpose. Collapsing
 * them into one "points" number is the single most misleading thing this
 * screen could do: pending points cannot be spent, reserved points are already
 * committed to a payment in flight, and only `available` is money in hand.
 */
export default function PointsTab({ isAr }) {
    const copy = useMemo(() => loyaltyCopy(isAr), [isAr]);

    const [wallet, setWallet] = useState(null);
    const [history, setHistory] = useState([]);
    const [pagination, setPagination] = useState(null);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const [walletData, historyData] = await Promise.all([
                    loyaltyApi.getWallet(),
                    loyaltyApi.getTransactions({ page: 1, limit: 20 }),
                ]);
                if (cancelled) return;
                setWallet(walletData);
                setHistory(historyData?.transactions || []);
                setPagination(historyData?.pagination || null);
            } catch (err) {
                if (!cancelled) setError(err.message || 'Could not load your points');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const loadMore = async () => {
        if (loadingMore || !pagination || page >= pagination.pages) return;
        setLoadingMore(true);
        try {
            const next = page + 1;
            const data = await loyaltyApi.getTransactions({ page: next, limit: 20 });
            setHistory((prev) => [...prev, ...(data?.transactions || [])]);
            setPagination(data?.pagination || pagination);
            setPage(next);
        } catch (err) {
            setError(err.message || 'Could not load more');
        } finally {
            setLoadingMore(false);
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
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start gap-3">
                <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-300">{error}</p>
            </div>
        );
    }

    // The program can be switched off without deleting anything. If this
    // customer still holds a balance, keep showing it — their points did not
    // stop existing just because earning did.
    const balances = wallet?.balances || {};
    const rules = wallet?.rules || {};
    const value = wallet?.value || {};
    const currency = rules.currency || value.currency || 'EGP';
    const hasAnyPoints = (balances.available_points || 0) + (balances.pending_points || 0) + (balances.reserved_points || 0) > 0;

    if (!wallet?.enabled && !hasAnyPoints) {
        return (
            <div className="space-y-6 animate-in fade-in duration-500">
                <h3 className="text-2xl font-black text-white flex items-center gap-3">
                    <Sparkles className="text-marine-primary" /> {copy.myPoints}
                </h3>
                <div className="p-6 bg-white/5 border border-white/10 rounded-2xl text-center">
                    <p className="text-zinc-400 text-sm">{copy.noPointsYet}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <h3 className="text-2xl font-black text-white flex items-center gap-3">
                <Sparkles className="text-marine-primary" /> {copy.myPoints}
            </h3>

            {/* ---- Balances ---- */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <BalanceCard
                    tone="primary"
                    label={copy.available}
                    points={balances.available_points || 0}
                    valueLabel={`${currency} ${Number(value.available || 0).toFixed(2)}`}
                    hint={copy.availableHint}
                    unit={copy.points}
                />
                <BalanceCard
                    tone="muted"
                    icon={Clock}
                    label={copy.pending}
                    points={balances.pending_points || 0}
                    valueLabel={`${currency} ${Number(value.pending || 0).toFixed(2)}`}
                    hint={copy.pendingHint(rules.return_window_days || 14)}
                    unit={copy.points}
                />
                {/* Reserved is shown only when it is non-zero — a permanent
                    "0 reserved" card is noise the customer cannot act on. */}
                {(balances.reserved_points || 0) > 0 && (
                    <BalanceCard
                        tone="muted"
                        icon={Lock}
                        label={copy.reserved}
                        points={balances.reserved_points}
                        valueLabel={`${currency} ${Number(value.reserved || 0).toFixed(2)}`}
                        hint={copy.reservedHint}
                        unit={copy.points}
                    />
                )}
            </div>

            {/* ---- Rules ---- */}
            <div className="p-5 bg-white/5 border border-white/10 rounded-2xl">
                <p className="text-white font-bold mb-3 flex items-center gap-2">
                    <Info size={16} className="text-marine-primary" />{copy.howItWorks}
                </p>
                <ul className="space-y-1.5 text-sm text-zinc-400">
                    <li>· {copy.earnRule(rules.spend_per_point, currency)}</li>
                    <li>· {copy.valueRule(Number(rules.point_value || 0).toFixed(2), currency)}</li>
                    <li>· {copy.capRule(rules.max_redemption_percent)}</li>
                    <li>· {copy.minRule(rules.min_redeem_points)}</li>
                    <li>· {copy.shippingExcluded}</li>
                    <li>· {rules.points_expiry_days ? copy.expiryRule(rules.points_expiry_days) : copy.noExpiry}</li>
                </ul>
                {wallet?.enabled && rules.redemption_enabled && (balances.available_points || 0) > 0 && (
                    <Link href="/products" className="inline-flex items-center gap-1.5 mt-4 text-sm font-bold text-marine-primary hover:underline">
                        {isAr ? 'تسوق الآن' : 'Shop now'}<ArrowRight size={14} className={isAr ? 'rotate-180' : ''} />
                    </Link>
                )}
            </div>

            {/* ---- Ledger ---- */}
            <div>
                <p className="text-white font-bold mb-4">{copy.history}</p>
                {history.length === 0 ? (
                    <div className="p-6 bg-white/5 border border-white/10 rounded-2xl text-center">
                        <p className="text-zinc-500 text-sm">{copy.noHistory}</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {history.map((entry) => {
                            const sign = loyaltyTypeSign(entry.type);
                            return (
                                <div
                                    key={entry._id}
                                    className="flex items-start justify-between gap-4 p-4 bg-white/5 border border-white/10 rounded-xl"
                                >
                                    <div className="min-w-0">
                                        <p className="text-white text-sm font-bold">{loyaltyTypeLabel(entry.type, isAr)}</p>
                                        <p className="text-zinc-500 text-xs mt-0.5">{formatDate(entry.created_at, isAr)}</p>
                                        {entry.order && (
                                            <p className="text-zinc-500 text-xs mt-1">
                                                {copy.order} #{entry.order.reference}
                                            </p>
                                        )}
                                        {/* The reason matters most on a manual adjustment — it is
                                            the only explanation the customer will ever get. */}
                                        {entry.reason && (
                                            <p className="text-zinc-400 text-xs mt-1 leading-relaxed">{entry.reason}</p>
                                        )}
                                        {entry.type === 'earn_pending' && entry.available_at && (
                                            <p className="text-amber-400/80 text-[11px] mt-1">
                                                {isAr ? 'متاحة في' : 'Available on'} {formatDate(entry.available_at, isAr)}
                                            </p>
                                        )}
                                    </div>
                                    <div className="text-end flex-shrink-0">
                                        <p className={`font-black text-sm ${sign === '+' ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {sign}{entry.points} {copy.points}
                                        </p>
                                        {entry.monetary_value > 0 && (
                                            <p className="text-zinc-500 text-[11px] mt-0.5">
                                                {currency} {Number(entry.monetary_value).toFixed(2)}
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
                                className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-zinc-300 font-bold text-sm hover:bg-white/10 transition-colors disabled:opacity-50"
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

function BalanceCard({ tone, icon: Icon, label, points, valueLabel, hint, unit }) {
    const isPrimary = tone === 'primary';
    return (
        <div className={`p-5 rounded-2xl border ${isPrimary ? 'bg-marine-cyan/10 border-marine-cyan/30' : 'bg-white/5 border-white/10'}`}>
            <p className="text-zinc-400 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                {Icon ? <Icon size={12} /> : <Sparkles size={12} className="text-marine-primary" />}
                {label}
            </p>
            <p className={`text-3xl font-black mt-2 ${isPrimary ? 'text-white' : 'text-zinc-300'}`}>
                {points} <span className="text-sm font-bold text-zinc-500">{unit}</span>
            </p>
            <p className="text-zinc-500 text-sm mt-1">≈ {valueLabel}</p>
            <p className="text-zinc-500 text-[11px] mt-3 leading-relaxed">{hint}</p>
        </div>
    );
}
