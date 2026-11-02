'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from '../LocaleLink';
import {
  Sparkles,
  Loader2,
  AlertCircle,
  Clock,
  Lock,
  Info,
  ArrowRight,
  Gift,
  ShieldCheck,
  Crown,
  ShoppingBag,
  CheckCircle2,
  HelpCircle,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import { loyaltyApi } from '../../lib/api';
import { loyaltyCopy, loyaltyTypeLabel, loyaltyTypeSign } from '../../lib/loyaltyLocalization';

const formatDate = (value, isAr) =>
  value
    ? new Date(value).toLocaleDateString(isAr ? 'ar-u-ca-gregory' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '—';

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
        if (!cancelled) setError(err.message || (isAr ? 'تعذر تحميل بيانات النقاط' : 'Could not load your points'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAr]);

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
      setError(err.message || (isAr ? 'تعذر تحميل المزيد' : 'Could not load more'));
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 bg-white border border-zinc-200/90 rounded-3xl p-8 shadow-xs">
        <Loader2 size={36} className="text-marine-primary animate-spin mb-3" />
        <p className="text-xs font-bold text-zinc-500">{isAr ? 'جاري تجهيز بيانات نقاطك ومكافآتك...' : 'Loading your points & rewards...'}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-5 bg-red-50 border border-red-200 rounded-3xl flex items-start gap-3 shadow-xs">
        <AlertCircle size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold text-red-700">{isAr ? 'حدث خطأ أثناء تحميل النقاط' : 'Error loading points'}</p>
          <p className="text-xs text-red-600 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  const balances = wallet?.balances || {};
  const rules = wallet?.rules || {};
  const value = wallet?.value || {};
  const currency = rules.currency || value.currency || 'EGP';

  const availablePoints = balances.available_points || 0;
  const pendingPoints = balances.pending_points || 0;
  const reservedPoints = balances.reserved_points || 0;

  const spendPerPoint = rules.spend_per_point || 25;
  const pointValue = Number(rules.point_value || 0.5);
  const maxRedemptionPercent = rules.max_redemption_percent || 50;
  const availableEgp = Number(value.available || availablePoints * pointValue).toFixed(2);
  const pendingEgp = Number(value.pending || pendingPoints * pointValue).toFixed(2);
  const reservedEgp = Number(value.reserved || reservedPoints * pointValue).toFixed(2);

  // Dynamic Gamified Tier Calculation
  let tierName = isAr ? 'المستوى البرونزي' : 'Bronze Tier';
  let tierBadgeBg = 'bg-amber-600/30 text-amber-200 border-amber-400/40';
  let nextTierName = isAr ? 'المستوى الفضي' : 'Silver Tier';
  let nextTierPoints = 100;

  if (availablePoints >= 1000) {
    tierName = isAr ? 'المستوى البلاتيني VIP' : 'Platinum VIP';
    tierBadgeBg = 'bg-purple-500/30 text-purple-200 border-purple-400/40';
    nextTierName = isAr ? 'الحد الأقصى' : 'Max Tier Reached';
    nextTierPoints = 1000;
  } else if (availablePoints >= 500) {
    tierName = isAr ? 'المستوى الذهبي' : 'Gold Tier';
    tierBadgeBg = 'bg-yellow-500/30 text-yellow-200 border-yellow-400/40';
    nextTierName = isAr ? 'المستوى البلاتيني' : 'Platinum Tier';
    nextTierPoints = 1000;
  } else if (availablePoints >= 100) {
    tierName = isAr ? 'المستوى الفضي' : 'Silver Tier';
    tierBadgeBg = 'bg-slate-300/30 text-slate-100 border-slate-300/40';
    nextTierName = isAr ? 'المستوى الذهبي' : 'Gold Tier';
    nextTierPoints = 500;
  }

  const progressPercent = Math.min(100, Math.max(0, Math.round((availablePoints / nextTierPoints) * 100)));
  const pointsRemaining = Math.max(0, nextTierPoints - availablePoints);

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-300">
      {/* 1. HERO GAMIFIED REWARDS CARD */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0E2A38] via-[#0C384D] to-[#006781] text-white p-6 sm:p-8 shadow-pod border border-white/10">
        {/* Decorative background glows */}
        <div className="absolute top-0 end-0 -mt-8 -me-8 w-64 h-64 rounded-full bg-marine-cyan/20 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 start-12 -mb-10 w-48 h-48 rounded-full bg-teal-400/10 blur-2xl pointer-events-none" />

        <div className="relative z-10 space-y-6">
          {/* Header row: Status + Tier Badge */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-white/10 backdrop-blur-md text-marine-cyan">
                <Sparkles size={20} />
              </span>
              <div>
                <p className="text-xs font-bold text-cyan-200/90 uppercase tracking-wider">
                  {isAr ? 'برنامج مكافآت ريدي مارين' : 'Ready Marine Rewards'}
                </p>
                <p className="text-sm font-semibold text-white/80">
                  {isAr ? 'اجمع النقاط واستبدلها بخصومات فورية' : 'Earn points & redeem instant discounts'}
                </p>
              </div>
            </div>

            <div className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-xs font-black backdrop-blur-md ${tierBadgeBg}`}>
              <Crown size={14} />
              <span>{tierName}</span>
            </div>
          </div>

          {/* Points & Monetary Value */}
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pt-2 border-t border-white/10">
            <div>
              <p className="text-xs text-white/70 font-medium mb-1">
                {isAr ? 'النقاط المتاحة للاستخدام الآن' : 'Available points for checkout'}
              </p>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl sm:text-5xl font-black tracking-tight text-white font-mono">
                  {availablePoints.toLocaleString(isAr ? 'ar-EG' : 'en-US')}
                </span>
                <span className="text-base sm:text-lg font-bold text-cyan-200">
                  {copy.points}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="bg-white/10 backdrop-blur-md border border-white/15 px-4 py-2 rounded-2xl">
                <p className="text-[10px] text-white/70 font-semibold uppercase">{isAr ? 'القيمة الشرائية' : 'Monetary Value'}</p>
                <p className="text-base sm:text-lg font-black text-cyan-300 font-mono">
                  ≈ {currency} {availableEgp}
                </p>
              </div>

              <Link
                href="/products"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-marine-cyan hover:bg-marine-cyan-dark text-white font-black text-xs sm:text-sm transition-all shadow-md hover:scale-[1.02] active:scale-[0.98]"
              >
                <ShoppingBag size={16} />
                <span>{isAr ? 'تسوق واكسب نقاط' : 'Shop & Earn'}</span>
              </Link>
            </div>
          </div>

          {/* Gamified Tier Progress Bar */}
          {nextTierPoints > availablePoints && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs text-white/80">
                <span className="font-medium flex items-center gap-1.5">
                  <TrendingUp size={14} className="text-cyan-300" />
                  {isAr
                    ? `اجمع ${pointsRemaining} نقطة إضافية للترقية إلى ${nextTierName}`
                    : `Earn ${pointsRemaining} more points to reach ${nextTierName}`}
                </span>
                <span className="font-mono font-bold text-cyan-200">{progressPercent}%</span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-white/15 overflow-hidden p-0.5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-teal-300 to-marine-cyan transition-all duration-700 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 2. THREE BALANCES CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Available */}
        <div className="p-5 rounded-3xl bg-white border border-zinc-200/90 shadow-xs hover:border-marine-cyan/40 transition-colors">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
              <CheckCircle2 size={15} className="text-emerald-500" />
              {copy.available}
            </span>
            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
              {isAr ? 'جاهزة للخصم' : 'Ready'}
            </span>
          </div>
          <p className="text-3xl font-black text-zinc-900 font-mono">
            {availablePoints.toLocaleString(isAr ? 'ar-EG' : 'en-US')}{' '}
            <span className="text-sm font-bold text-zinc-500">{copy.points}</span>
          </p>
          <p className="text-xs font-semibold text-zinc-500 mt-1">≈ {currency} {availableEgp}</p>
          <p className="text-[11px] text-zinc-500 mt-3 pt-3 border-t border-zinc-100 leading-relaxed">
            {copy.availableHint}
          </p>
        </div>

        {/* Pending */}
        <div className="p-5 rounded-3xl bg-white border border-zinc-200/90 shadow-xs hover:border-amber-400/40 transition-colors">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
              <Clock size={15} className="text-amber-500" />
              {copy.pending}
            </span>
            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200/60">
              {isAr ? 'قيد المراجعة' : 'Pending'}
            </span>
          </div>
          <p className="text-3xl font-black text-zinc-900 font-mono">
            {pendingPoints.toLocaleString(isAr ? 'ar-EG' : 'en-US')}{' '}
            <span className="text-sm font-bold text-zinc-500">{copy.points}</span>
          </p>
          <p className="text-xs font-semibold text-zinc-500 mt-1">≈ {currency} {pendingEgp}</p>
          <p className="text-[11px] text-zinc-500 mt-3 pt-3 border-t border-zinc-100 leading-relaxed">
            {copy.pendingHint(rules.return_window_days || 14)}
          </p>
        </div>

        {/* Reserved (Shown always or if > 0) */}
        <div className="p-5 rounded-3xl bg-white border border-zinc-200/90 shadow-xs hover:border-zinc-300 transition-colors">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
              <Lock size={15} className="text-zinc-400" />
              {copy.reserved}
            </span>
            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-zinc-100 text-zinc-600 border border-zinc-200/60">
              {reservedPoints > 0 ? (isAr ? 'محجوزة مؤقتاً' : 'Reserved') : (isAr ? 'لا يوجد حجز' : 'None')}
            </span>
          </div>
          <p className="text-3xl font-black text-zinc-900 font-mono">
            {reservedPoints.toLocaleString(isAr ? 'ar-EG' : 'en-US')}{' '}
            <span className="text-sm font-bold text-zinc-500">{copy.points}</span>
          </p>
          <p className="text-xs font-semibold text-zinc-500 mt-1">≈ {currency} {reservedEgp}</p>
          <p className="text-[11px] text-zinc-500 mt-3 pt-3 border-t border-zinc-100 leading-relaxed">
            {copy.reservedHint}
          </p>
        </div>
      </div>

      {/* 3. DESKTOP 2-COLUMN SECTION: HOW IT WORKS + LEDGER */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (5 cols): How Points Work & Rules */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white border border-zinc-200/90 rounded-3xl p-6 shadow-xs space-y-5">
            <div className="flex items-center gap-2.5 pb-4 border-b border-zinc-100">
              <div className="w-9 h-9 rounded-xl bg-marine-mist text-marine-primary flex items-center justify-center">
                <Info size={18} />
              </div>
              <div>
                <h3 className="text-base font-black text-zinc-900">{copy.howItWorks}</h3>
                <p className="text-xs text-zinc-500">{isAr ? 'قواعد كسب واستبدال النقاط' : 'Earning & redemption guidelines'}</p>
              </div>
            </div>

            <ul className="space-y-3.5 text-xs text-zinc-700">
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-marine-cyan/15 text-marine-cyan flex items-center justify-center shrink-0 mt-0.5 font-black text-[10px]">
                  1
                </span>
                <span className="leading-relaxed">
                  <strong>{isAr ? 'كسب النقاط:' : 'Earn points:'}</strong>{' '}
                  {copy.earnRule(spendPerPoint, currency)}
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-marine-cyan/15 text-marine-cyan flex items-center justify-center shrink-0 mt-0.5 font-black text-[10px]">
                  2
                </span>
                <span className="leading-relaxed">
                  <strong>{isAr ? 'قيمة الخصم:' : 'Discount value:'}</strong>{' '}
                  {copy.valueRule(pointValue.toFixed(2), currency)}
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-marine-cyan/15 text-marine-cyan flex items-center justify-center shrink-0 mt-0.5 font-black text-[10px]">
                  3
                </span>
                <span className="leading-relaxed">
                  <strong>{isAr ? 'الحد الأقصى للخصم:' : 'Max redemption:'}</strong>{' '}
                  {copy.capRule(maxRedemptionPercent)}
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-marine-cyan/15 text-marine-cyan flex items-center justify-center shrink-0 mt-0.5 font-black text-[10px]">
                  4
                </span>
                <span className="leading-relaxed">
                  <strong>{isAr ? 'الحد الأدنى:' : 'Min points:'}</strong>{' '}
                  {copy.minRule(rules.min_redeem_points || 1)}
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-amber-500/15 text-amber-700 flex items-center justify-center shrink-0 mt-0.5 font-black text-[10px]">
                  5
                </span>
                <span className="leading-relaxed">
                  <strong>{isAr ? 'ملاحظة الشحن:' : 'Shipping note:'}</strong>{' '}
                  {copy.shippingExcluded}
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-zinc-200 text-zinc-600 flex items-center justify-center shrink-0 mt-0.5 font-black text-[10px]">
                  6
                </span>
                <span className="leading-relaxed">
                  <strong>{isAr ? 'صلاحية النقاط:' : 'Expiration:'}</strong>{' '}
                  {rules.points_expiry_days ? copy.expiryRule(rules.points_expiry_days) : copy.noExpiry}
                </span>
              </li>
            </ul>

            <div className="pt-2">
              <Link
                href="/products"
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-marine-mist hover:bg-marine-cyan/15 text-marine-primary font-bold text-xs transition-colors border border-marine-cyan/20"
              >
                <span>{isAr ? 'تصفح منتجات ريدي مارين واكسب نقاط' : 'Explore Ready Marine Products'}</span>
                <ArrowRight size={14} className={isAr ? 'rotate-180' : ''} />
              </Link>
            </div>
          </div>
        </div>

        {/* Right Column (7 cols): Ledger & History */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white border border-zinc-200/90 rounded-3xl p-6 shadow-xs">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-zinc-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-marine-mist text-marine-primary flex items-center justify-center">
                  <Sparkles size={18} />
                </div>
                <div>
                  <h3 className="text-base font-black text-zinc-900">{copy.history}</h3>
                  <p className="text-xs text-zinc-500">{isAr ? 'سجل العمليات وحركات النقاط' : 'All rewards transactions'}</p>
                </div>
              </div>

              {history.length > 0 && (
                <span className="text-xs font-bold text-zinc-500">
                  {history.length} {isAr ? 'معاملة' : 'entries'}
                </span>
              )}
            </div>

            {history.length === 0 ? (
              <div className="py-12 px-6 text-center space-y-4">
                <div className="w-16 h-16 rounded-3xl bg-marine-mist text-marine-primary flex items-center justify-center mx-auto shadow-xs border border-marine-cyan/20">
                  <Gift size={32} />
                </div>
                <div className="max-w-sm mx-auto space-y-1.5">
                  <h4 className="text-base font-black text-zinc-900">
                    {isAr ? 'لم تجمع أي نقاط بعد' : 'No Points Yet'}
                  </h4>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    {isAr
                      ? 'كل طلب تقوم به على منصة ريدي مارين يمنحك نقاط ولاء تلقائياً، يمكنك استبدالها بخصومات مباشرة على طلباتك القادمة!'
                      : 'Place orders on Ready Marine to automatically earn loyalty points that you can redeem for instant discounts!'}
                  </p>
                </div>
                <div className="pt-2">
                  <Link
                    href="/products"
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-marine-cyan hover:bg-marine-cyan-dark text-white text-xs font-bold transition-all shadow-sm"
                  >
                    <ShoppingBag size={14} />
                    <span>{isAr ? 'ابدأ التسوق الآن' : 'Start Shopping Now'}</span>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {history.map((entry) => {
                  const sign = loyaltyTypeSign(entry.type);
                  return (
                    <div
                      key={entry._id}
                      className="flex items-start justify-between gap-4 p-4 bg-zinc-50/70 hover:bg-zinc-50 border border-zinc-200/80 rounded-2xl transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-zinc-900 text-sm font-bold">{loyaltyTypeLabel(entry.type, isAr)}</p>
                        <p className="text-zinc-500 text-xs mt-0.5">{formatDate(entry.created_at, isAr)}</p>
                        {entry.order && (
                          <p className="text-zinc-500 text-xs mt-1">
                            {copy.order} #{entry.order.reference}
                          </p>
                        )}
                        {entry.reason && (
                          <p className="text-zinc-600 text-xs mt-1 leading-relaxed">{entry.reason}</p>
                        )}
                        {entry.type === 'earn_pending' && entry.available_at && (
                          <p className="text-amber-600 text-[11px] mt-1 font-semibold">
                            {isAr ? 'متاحة في' : 'Available on'} {formatDate(entry.available_at, isAr)}
                          </p>
                        )}
                      </div>
                      <div className="text-end flex-shrink-0">
                        <p className={`font-black text-sm font-mono ${sign === '+' ? 'text-emerald-600' : 'text-red-500'}`}>
                          {sign}{entry.points} {copy.points}
                        </p>
                        {entry.monetary_value > 0 && (
                          <p className="text-zinc-500 text-[11px] mt-0.5 font-mono">
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
                    className="w-full py-3 rounded-2xl bg-zinc-100 hover:bg-zinc-200 border border-zinc-200 text-zinc-700 font-bold text-xs transition-colors disabled:opacity-50 mt-4"
                  >
                    {loadingMore ? <Loader2 size={16} className="animate-spin mx-auto" /> : copy.loadMore}
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
