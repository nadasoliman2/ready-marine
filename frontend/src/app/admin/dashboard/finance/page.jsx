'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from '../../../../components/LocaleLink';
import { useApp } from '../../../../context/AppContext';
import { adminFinanceApi } from '../../../../lib/api';
import {
    CARD, Money, StatCard, ProfitBadge, DateRangeFilter, Spinner,
    money, compactMoney, fmtDate,
} from '../../../../components/dashboard/finance/FinanceUI';
import {
    Wallet, Clock, AlertTriangle, CalendarClock, Percent, Truck,
    CreditCard, Package, Megaphone, ArrowRight, TicketPercent, Sparkles,
    ShoppingCart, PackageOpen, HandCoins,
} from 'lucide-react';

/**
 * The parcel statuses this screen can show, in the words an admin uses rather than the
 * words the state machine uses. Anything not listed falls back to its raw key, so a status
 * added to the model later shows up as itself instead of vanishing from the breakdown.
 */
const PARCEL_STAGE_LABELS = {
    pending_review:    { ar: 'لسه ما راجعهاش',      en: 'Not reviewed yet' },
    awaiting_tracking: { ar: 'مستني رقم تتبع',      en: 'Awaiting tracking' },
    awaiting_handover: { ar: 'بيتجهّز للتسليم',     en: 'Being sealed' },
    ready_for_pickup:  { ar: 'جاهز ومستني مندوب',   en: 'Ready for pickup' },
    needs_admin:       { ar: 'محتاج تدخل الأدمن',   en: 'Needs admin' },
    handed_to_courier: { ar: 'اتسلّم للمندوب',      en: 'Handed to courier' },
    pickup_scheduled:  { ar: 'الاستلام متجدول',     en: 'Pickup scheduled' },
    picked_up:         { ar: 'المندوب استلمه',      en: 'Picked up' },
    in_transit:        { ar: 'في الطريق',           en: 'In transit' },
    out_for_delivery:  { ar: 'خارج للتسليم',        en: 'Out for delivery' },
    exception:         { ar: 'فيه مشكلة',           en: 'Exception' },
};

/**
 * Screen 4 — where the company stands.
 *
 * Split into POSITION (balances as of now) and PERIOD (what happened over a range),
 * because a balance and a flow are different kinds of number and a dashboard that lines
 * them up side by side invites the reader to compare them. The date filter greys out over
 * the position block for the same reason: it does not apply there.
 */
export default function FinanceOverviewPage() {
    const { language, siteSettings } = useApp();
    const isAr = language === 'ar';
    const currency = siteSettings?.currency || 'EGP';
    const locale = isAr ? 'ar-EG' : 'en-US';

    const [range, setRange] = useState(() => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return { from: iso(start), to: iso(now) };
    });

    const [data, setData] = useState(null);
    const [trend, setTrend] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const [overview, trendRes] = await Promise.all([
                adminFinanceApi.getOverview(range),
                adminFinanceApi.getTrend({ months: 12 }),
            ]);
            setData(overview);
            setTrend(trendRes.trend || []);
        } catch (err) {
            setError(err.message || 'Failed to load finance overview');
        } finally {
            setLoading(false);
        }
    }, [range.from, range.to]);

    useEffect(() => { load(); }, [load]);

    if (loading && !data) return <Spinner />;

    if (error) {
        return (
            <div className={`${CARD} p-6 border-red-200 dark:border-red-500/20`}>
                <p className="text-red-600 dark:text-red-400 font-bold">{error}</p>
                <button onClick={load} className="mt-3 px-4 py-2 rounded-xl bg-marine-cyan text-white text-sm font-bold">
                    {isAr ? 'إعادة المحاولة' : 'Try again'}
                </button>
            </div>
        );
    }

    if (!data) return null;

    const { position, period, lifetime, schedule, pipeline } = data;
    const maxTrend = Math.max(1, ...trend.map((t) => Math.max(Math.abs(t.revenue), Math.abs(t.costs))));

    return (
        <div className="space-y-8">
            {/* ---------------- POSITION: true right now ---------------- */}
            <section className="space-y-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-lg font-black text-zinc-900 dark:text-white">
                        {isAr ? 'الوضع الحالي' : 'Where we stand now'}
                    </h2>
                    <p className="text-xs text-zinc-500">
                        {isAr ? 'أرصدة لحظية — لا تتأثر بالفترة المختارة' : 'Live balances — the date range below does not apply here'}
                    </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    <StatCard
                        label={isAr ? 'مستحق للتجار الآن' : 'Owed to vendors now'}
                        value={position.owed_to_vendors_now}
                        currency={currency}
                        icon={Wallet}
                        tone={position.owed_to_vendors_now > 0 ? 'brand' : 'neutral'}
                        sub={isAr ? 'انتهت فترة الإرجاع ولم تُدفع بعد' : 'Cleared the return window, not yet paid'}
                    />
                    <StatCard
                        label={isAr ? 'محتجز في فترة الإرجاع' : 'Held in return window'}
                        value={position.held_in_return_window}
                        currency={currency}
                        icon={Clock}
                        sub={isAr ? 'مكتسب لكن لم تُغلق فترة الإرجاع' : 'Earned, window still open'}
                    />
                    <StatCard
                        label={isAr ? 'متأخر عن موعده' : 'Overdue'}
                        value={position.overdue.amount}
                        currency={currency}
                        icon={AlertTriangle}
                        tone={position.overdue.amount > 0 ? 'loss' : 'neutral'}
                        sub={
                            position.overdue.vendors > 0
                                ? (isAr ? `${position.overdue.vendors} تاجر تخطّى موعد الدفع` : `${position.overdue.vendors} vendor(s) past their payout date`)
                                : (isAr ? 'لا يوجد متأخرات' : 'Nothing past its date')
                        }
                    />
                    <StatCard
                        label={isAr ? 'الدفعة القادمة' : 'Next payout'}
                        value={position.next_payout_at ? fmtDate(position.next_payout_at, isAr) : (isAr ? 'يدوي' : 'Manual')}
                        icon={CalendarClock}
                        sub={isAr ? position.schedule_label.ar : position.schedule_label.en}
                    />
                </div>

                {/* Cash the couriers are still holding from cash orders. Our money, and not
                    here — so it stands beside the vendor balances and is added to none of
                    them. The tab it links to is where it gets matched to a bank transfer. */}
                {position.cash_at_couriers && (
                    <Link
                        href="/admin/dashboard/finance/couriers"
                        className={`${CARD} p-5 flex items-center justify-between gap-4 flex-wrap hover:border-marine-cyan/30 transition-colors`}
                    >
                        <div>
                            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">
                                {isAr ? 'كاش عند شركات الشحن' : 'Cash held by couriers'}
                            </p>
                            <p dir="ltr" className="text-2xl font-black mt-1 tabular-nums text-marine-primary">
                                {money(position.cash_at_couriers.total, currency, locale)}
                            </p>
                            <p className="text-xs text-zinc-500 mt-1">
                                {isAr
                                    ? `${position.cash_at_couriers.parcels} شحنة اتسلّمت ولسه فلوسها ما وصلتش البنك`
                                    : `${position.cash_at_couriers.parcels} delivered parcels whose cash has not reached the bank`}
                            </p>
                        </div>
                        <div className="flex items-center gap-6 flex-wrap">
                            {position.cash_at_couriers.by_courier.map((c) => (
                                <div key={c.provider}>
                                    <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">{c.label}</p>
                                    <p dir="ltr" className="text-sm font-black tabular-nums mt-0.5 text-zinc-900 dark:text-white">
                                        {money(c.amount, currency, locale)}
                                    </p>
                                    <p className="text-[10px] text-zinc-400">
                                        {isAr ? `${c.parcels} شحنة` : `${c.parcels} parcels`}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </Link>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className={`${CARD} p-5 lg:col-span-2`}>
                        <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-4">
                            {isAr ? 'إجمالي الالتزام تجاه التجار' : 'Total vendor liability'}
                        </p>
                        <p dir="ltr" className="text-3xl font-black text-zinc-900 dark:text-white tabular-nums">
                            {money(position.total_vendor_liability, currency, locale)}
                        </p>

                        {/* The split between what is due now and what is still holding. */}
                        <div className="mt-4 h-2.5 rounded-full bg-zinc-100 dark:bg-white/5 overflow-hidden flex">
                            <div
                                className="bg-marine-cyan h-full"
                                style={{ width: `${position.total_vendor_liability > 0 ? (position.owed_to_vendors_now / position.total_vendor_liability) * 100 : 0}%` }}
                            />
                            <div
                                className="bg-amber-400 h-full"
                                style={{ width: `${position.total_vendor_liability > 0 ? (position.held_in_return_window / position.total_vendor_liability) * 100 : 0}%` }}
                            />
                        </div>
                        <div className="flex flex-wrap gap-4 mt-3 text-xs">
                            <span className="flex items-center gap-1.5 text-zinc-500">
                                <span className="w-2.5 h-2.5 rounded-full bg-marine-cyan" />
                                {isAr ? 'مستحق الآن' : 'Payable now'} — <Money value={position.owed_to_vendors_now} currency={currency} />
                            </span>
                            <span className="flex items-center gap-1.5 text-zinc-500">
                                <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                                {isAr ? 'محتجز' : 'Held'} — <Money value={position.held_in_return_window} currency={currency} />
                            </span>
                        </div>

                        <Link
                            href="/admin/dashboard/finance/vendors"
                            className="inline-flex items-center gap-2 mt-5 px-4 py-2 rounded-xl bg-marine-cyan hover:bg-marine-cyan-dark text-white text-sm font-bold transition-colors"
                        >
                            {isAr ? 'دفع مستحقات التجار' : 'Pay vendors'}
                            <ArrowRight size={15} className={isAr ? 'rotate-180' : ''} />
                        </Link>
                    </div>

                    <div className={`${CARD} p-5`}>
                        <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-3">
                            {isAr ? 'مواعيد الدفع القادمة' : 'Upcoming payout dates'}
                        </p>
                        {schedule.upcoming?.length > 0 ? (
                            <ul className="space-y-2">
                                {schedule.upcoming.map((d, i) => (
                                    <li key={d} className="flex items-center justify-between text-sm">
                                        <span className={i === 0 ? 'font-bold text-zinc-900 dark:text-white' : 'text-zinc-500'}>
                                            {fmtDate(d, isAr)}
                                        </span>
                                        {i === 0 && (
                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 dark:bg-marine-cyan/10 text-marine-primary">
                                                {isAr ? 'التالي' : 'NEXT'}
                                            </span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-sm text-zinc-500">
                                {isAr ? 'الجدول متوقف — الدفع يدوي.' : 'Schedule is off — payouts are manual.'}
                            </p>
                        )}
                        {position.open_withdrawal_requests.count > 0 && (
                            <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-white/5">
                                <p className="text-xs text-zinc-500">{isAr ? 'طلبات سحب من التجار' : 'Vendor withdrawal requests'}</p>
                                <p className="text-sm font-bold text-amber-600 dark:text-amber-400 mt-1">
                                    {position.open_withdrawal_requests.count} · <Money value={position.open_withdrawal_requests.amount} currency={currency} />
                                </p>
                                <Link href="/admin/dashboard/withdrawals" className="text-xs text-marine-primary font-bold hover:underline">
                                    {isAr ? 'مراجعة الطلبات' : 'Review requests'}
                                </Link>
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {/* ---------------- PIPELINE: committed, not landed ---------------- */}
            {pipeline && (
            <section className="space-y-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-lg font-black text-zinc-900 dark:text-white">
                        {isAr ? 'في الطريق' : 'On its way'}
                    </h2>
                    <p className="text-xs text-zinc-500">
                        {isAr
                            ? 'مبالغ لسه ما وصلتش — مش جزء من الأرباح ولا من المستحق للتجار'
                            : 'Committed but not landed — part of neither profit nor vendor liability'}
                    </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    <StatCard
                        label={isAr ? 'في السلات' : 'Sitting in carts'}
                        value={pipeline.carts.value}
                        currency={currency}
                        icon={ShoppingCart}
                        tone="neutral"
                        sub={isAr
                            ? `${pipeline.carts.count} سلة · ${pipeline.carts.units} قطعة`
                            : `${pipeline.carts.count} cart(s) · ${pipeline.carts.units} item(s)`}
                        hint={isAr
                            ? `منها ${money(pipeline.carts.active_value, currency, locale)} في ${pipeline.carts.active_count} سلة اتحركت آخر ${pipeline.carts.active_window_days} يوم. السلة مش بتخزن سعر — القيمة محسوبة بأسعار النهاردة.`
                            : `Of which ${money(pipeline.carts.active_value, currency, locale)} across ${pipeline.carts.active_count} cart(s) touched in the last ${pipeline.carts.active_window_days} days. Carts store no price — this is valued at today's prices.`}
                    />

                    <StatCard
                        label={isAr ? 'لسه عند التاجر' : 'Still with the vendor'}
                        value={pipeline.at_vendor.merchandise}
                        currency={currency}
                        icon={PackageOpen}
                        tone={pipeline.at_vendor.parcels > 0 ? 'brand' : 'neutral'}
                        sub={isAr
                            ? `${pipeline.at_vendor.parcels} طرد · ${pipeline.at_vendor.orders} أوردر · ${pipeline.at_vendor.vendors} تاجر`
                            : `${pipeline.at_vendor.parcels} parcel(s) · ${pipeline.at_vendor.orders} order(s) · ${pipeline.at_vendor.vendors} vendor(s)`}
                        hint={isAr
                            ? `قيمة البضاعة. التحصيل من العميل ${money(pipeline.at_vendor.collectable, currency, locale)} بالشحن.`
                            : `Merchandise value. ${money(pipeline.at_vendor.collectable, currency, locale)} collectable from customers including shipping.`}
                    />

                    <StatCard
                        label={isAr ? 'خرجت ولسه ما وصلتش' : 'Shipped, not delivered'}
                        value={pipeline.in_transit.merchandise}
                        currency={currency}
                        icon={Truck}
                        tone={pipeline.in_transit.parcels > 0 ? 'brand' : 'neutral'}
                        sub={isAr
                            ? `${pipeline.in_transit.parcels} طرد · ${pipeline.in_transit.orders} أوردر · ${pipeline.in_transit.vendors} تاجر`
                            : `${pipeline.in_transit.parcels} parcel(s) · ${pipeline.in_transit.orders} order(s) · ${pipeline.in_transit.vendors} vendor(s)`}
                        hint={isAr
                            ? `قيمة البضاعة. التحصيل من العميل ${money(pipeline.in_transit.collectable, currency, locale)} بالشحن.`
                            : `Merchandise value. ${money(pipeline.in_transit.collectable, currency, locale)} collectable from customers including shipping.`}
                    />
                </div>

                {/* The headline is one number, but a parcel nobody reviewed and a parcel
                    sealed waiting for a courier are two different phone calls. */}
                <div className={`${CARD} p-4`}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
                        {[
                            ['at_vendor', isAr ? 'لسه عند التاجر' : 'Still with the vendor'],
                            ['in_transit', isAr ? 'في الشحن' : 'Out for delivery'],
                        ].map(([key, title]) => {
                            const rows = Object.entries(pipeline[key].by_status);
                            return (
                                <div key={key}>
                                    <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-2">{title}</p>
                                    {rows.length === 0 ? (
                                        <p className="text-xs text-zinc-400">{isAr ? 'لا يوجد' : 'Nothing here'}</p>
                                    ) : rows.map(([status, v]) => (
                                        <div key={status} className="flex items-center justify-between gap-3 py-1 border-b border-zinc-100 dark:border-white/5 last:border-0">
                                            <span className="text-xs text-zinc-600 dark:text-zinc-300 truncate">
                                                {PARCEL_STAGE_LABELS[status]?.[isAr ? 'ar' : 'en'] || status}
                                            </span>
                                            <span className="text-xs text-zinc-500 shrink-0">
                                                {v.parcels} · <Money value={v.merchandise} currency={currency} />
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </div>

                    {(pipeline.carts.stale_count > 0 || pipeline.carts.unpriced_bundle_lines > 0) && (
                        <p className="text-[11px] text-zinc-400 mt-3 pt-3 border-t border-zinc-100 dark:border-white/5">
                            {pipeline.carts.stale_count > 0 && (isAr
                                ? `${pipeline.carts.stale_count} سلة كل اللي فيها منتجات اتشالت — مش محسوبة فوق. `
                                : `${pipeline.carts.stale_count} cart(s) hold only removed products — not counted above. `)}
                            {pipeline.carts.unpriced_bundle_lines > 0 && (isAr
                                ? `${pipeline.carts.unpriced_bundle_lines} سطر باقة مش متسعّر، فالرقم "على الأقل".`
                                : `${pipeline.carts.unpriced_bundle_lines} bundle line(s) could not be priced, so the cart figure is a floor.`)}
                        </p>
                    )}
                </div>
            </section>
            )}

            {/* ---------------- PERIOD: what happened ---------------- */}
            <section className="space-y-4">
                <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
                    <h2 className="text-lg font-black text-zinc-900 dark:text-white">
                        {isAr ? 'نتيجة الفترة' : 'Result for the period'}
                    </h2>
                    <DateRangeFilter from={range.from} to={range.to} onChange={setRange} isAr={isAr} />
                </div>

                {/* The bottom line, green or red, before anything that explains it. */}
                <div className={`${CARD} p-6`}>
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                        <div>
                            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">
                                {period.result.is_profit ? (isAr ? 'صافي الربح' : 'Net profit') : (isAr ? 'صافي الخسارة' : 'Net loss')}
                            </p>
                            <div className="mt-2">
                                <ProfitBadge value={period.result.net_profit} currency={currency} size="lg" />
                            </div>
                            <p className="text-xs text-zinc-500 mt-2">
                                {isAr
                                    ? `${period.revenue.total.toLocaleString(locale)} إيراد − ${period.costs.total.toLocaleString(locale)} تكلفة · هامش ${period.result.margin_percent}%`
                                    : `${money(period.revenue.total, currency, locale)} revenue − ${money(period.costs.total, currency, locale)} costs · ${period.result.margin_percent}% margin`}
                            </p>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 lg:text-right">
                            <div>
                                <p className="text-[11px] font-bold text-zinc-500 uppercase">{isAr ? 'طلبات اتسلمت' : 'Delivered orders'}</p>
                                <p className="text-xl font-black text-zinc-900 dark:text-white tabular-nums">{period.result.orders}</p>
                                {period.result.refused_parcels > 0 && (
                                    <p className="text-[11px] text-red-500 mt-0.5">
                                        {isAr ? `+ ${period.result.refused_parcels} طرد اترفض (تكلفة بس)` : `+ ${period.result.refused_parcels} refused parcel(s) (cost only)`}
                                    </p>
                                )}
                            </div>
                            <div>
                                <p className="text-[11px] font-bold text-zinc-500 uppercase">{isAr ? 'ربح/طلب' : 'Per order'}</p>
                                <p dir="ltr" className={`text-xl font-black tabular-nums ${period.result.profit_per_order >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                    {compactMoney(period.result.profit_per_order, currency)}
                                </p>
                            </div>
                            <div>
                                <p className="text-[11px] font-bold text-zinc-500 uppercase">{isAr ? 'قيمة اللي اتسلم' : 'Delivered value'}</p>
                                <p dir="ltr" className="text-xl font-black text-zinc-900 dark:text-white tabular-nums">
                                    {compactMoney(period.result.gross_order_value, currency)}
                                </p>
                            </div>
                            <div>
                                <p className="text-[11px] font-bold text-zinc-500 uppercase">ROAS</p>
                                <p dir="ltr" className="text-xl font-black text-zinc-900 dark:text-white tabular-nums">
                                    {period.result.roas !== null ? `${period.result.roas}×` : '—'}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Revenue and costs, each broken to its last line. */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className={`${CARD} p-5`}>
                        <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide mb-4">
                            {isAr ? 'الإيرادات' : 'Revenue'}
                        </p>
                        <ul className="space-y-3">
                            <LedgerLine icon={Percent} label={isAr ? 'عمولة الطلبات' : 'Order commission'} value={period.revenue.commission_net} currency={currency}
                                note={period.revenue.commission_reversed > 0
                                    ? (isAr ? `بعد خصم ${money(period.revenue.commission_reversed, currency, locale)} مرتجعات` : `after ${money(period.revenue.commission_reversed, currency, locale)} reversed by refunds`)
                                    : null} />
                            <LedgerLine icon={Truck} label={isAr ? 'شحن محصّل من العملاء' : 'Shipping charged to customers'} value={period.revenue.shipping_charged} currency={currency} />
                            <LedgerLine icon={CreditCard} label={isAr ? 'اشتراكات التجار' : 'Vendor subscriptions'} value={period.revenue.subscriptions} currency={currency}
                                note={isAr ? `${period.revenue.subscription_count} دفعة` : `${period.revenue.subscription_count} payment(s)`} />
                            <LedgerLine icon={Package} label={isAr ? 'مستلزمات التغليف' : 'Packaging supplies'} value={period.revenue.supplies} currency={currency}
                                note={isAr ? `${period.revenue.supply_order_count} طلب` : `${period.revenue.supply_order_count} order(s)`} />
                        </ul>
                        <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-white/5 flex items-center justify-between">
                            <span className="font-black text-zinc-900 dark:text-white">{isAr ? 'إجمالي الإيرادات' : 'Total revenue'}</span>
                            <span dir="ltr" className="font-black text-emerald-600 dark:text-emerald-400 tabular-nums text-lg">
                                {money(period.revenue.total, currency, locale)}
                            </span>
                        </div>
                    </div>

                    <div className={`${CARD} p-5`}>
                        <p className="text-[11px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wide mb-4">
                            {isAr ? 'التكاليف' : 'Costs'}
                        </p>
                        <ul className="space-y-3">
                            <LedgerLine
                                icon={Truck}
                                label={isAr ? 'شحن مدفوع لبوسطة' : 'Shipping paid to Bosta'}
                                value={period.costs.shipping_paid_to_bosta}
                                currency={currency}
                                note={isAr
                                    ? `توصيل ${money(period.costs.bosta_breakdown.send, currency, locale)} · استلام ${money(period.costs.bosta_breakdown.pickup_share, currency, locale)} · مرتجع ${money(period.costs.bosta_breakdown.rto, currency, locale)}`
                                    : `send ${money(period.costs.bosta_breakdown.send, currency, locale)} · pickup ${money(period.costs.bosta_breakdown.pickup_share, currency, locale)} · RTO ${money(period.costs.bosta_breakdown.rto, currency, locale)}`}
                            />
                            {/* The price of getting paid, on either rail. The Bosta half
                                is on the same invoice as the shipping line above; it is
                                split out because carrying cash and carrying a box are two
                                different charges. */}
                            {period.costs.collection && (
                            <LedgerLine
                                icon={HandCoins}
                                label={isAr ? 'تكلفة التحصيل' : 'Collection fees'}
                                value={period.costs.collection.total}
                                currency={currency}
                                note={(() => {
                                    const c = period.costs.collection;
                                    const bosta = isAr
                                        ? `بوسطة (كاش) ${money(c.bosta_cod, currency, locale)} · ${c.bosta_cod_parcels} طرد فوق 2000 جنيه`
                                        : `Bosta (COD) ${money(c.bosta_cod, currency, locale)} · ${c.bosta_cod_parcels} parcel(s) over 2000 EGP`;
                                    const gateway = isAr
                                        ? `فواتيرك ${money(c.gateway, currency, locale)} · ${c.gateway_payments} دفعة`
                                        : `Fawaterak ${money(c.gateway, currency, locale)} · ${c.gateway_payments} payment(s)`;
                                    // A payment whose confirmation stored no fee figure is priced
                                    // off Fawaterak's published rate; it is IN the total, and this
                                    // says so. Only a payment with no rate to go by is a gap.
                                    const estimated = c.gateway_estimated > 0
                                        ? (isAr
                                            ? ` (منها ${c.gateway_estimated} محسوبة بتعريفة فواتيرك: 2% + 2 جنيه + ضريبة)`
                                            : ` (${c.gateway_estimated} priced at Fawaterak's 2% + 2 EGP rate, VAT included)`)
                                        : '';
                                    const unpriced = c.gateway_unpriced > 0
                                        ? (isAr ? ` (${c.gateway_unpriced} بدون رسوم مسجلة)` : ` (${c.gateway_unpriced} without a recorded fee)`)
                                        : '';
                                    return `${bosta} · ${gateway}${estimated}${unpriced}`;
                                })()}
                            />
                            )}
                            {/* Our share only. What vendors funded came off their payout, not our profit. */}
                            <LedgerLine
                                icon={TicketPercent}
                                label={isAr ? 'خصومات الكوبونات (نصيب الموقع)' : 'Coupon discounts (our share)'}
                                value={period.costs.coupon_discounts}
                                currency={currency}
                                note={Number(period.costs.coupon_vendor_funded) > 0
                                    ? (isAr
                                        ? `التجار تحملوا ${money(period.costs.coupon_vendor_funded, currency, locale)} كمان من نفس الكوبونات — اتخصمت من أرباحهم مش من أرباحنا`
                                        : `Vendors funded a further ${money(period.costs.coupon_vendor_funded, currency, locale)} of the same coupons — taken off their payout, not our profit`)
                                    : undefined}
                            />
                            <LedgerLine icon={Sparkles} label={isAr ? 'خصومات نقاط الولاء' : 'Loyalty discounts'} value={period.costs.loyalty_discounts} currency={currency} />
                            <LedgerLine
                                icon={Megaphone}
                                label={isAr ? 'الإنفاق الإعلاني' : 'Ad spend'}
                                value={period.costs.ad_spend}
                                currency={currency}
                                note={period.costs.ad_spend_is_override
                                    ? (isAr ? 'قيمة افتراضية — ليست من السجل' : 'what-if value, not from the ledger')
                                    : (isAr ? `${period.ad_spend_detail.count} إدخال` : `${period.ad_spend_detail.count} entr${period.ad_spend_detail.count === 1 ? 'y' : 'ies'}`)}
                            />
                        </ul>
                        <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-white/5 flex items-center justify-between">
                            <span className="font-black text-zinc-900 dark:text-white">{isAr ? 'إجمالي التكاليف' : 'Total costs'}</span>
                            <span dir="ltr" className="font-black text-red-600 dark:text-red-400 tabular-nums text-lg">
                                {money(period.costs.total, currency, locale)}
                            </span>
                        </div>

                        <p className="text-[11px] text-zinc-400 mt-4 leading-relaxed">
                            {isAr
                                ? 'مستحقات التجار ليست تكلفة — لم تكن أموالنا في أي وقت، مرّت من خلالنا فقط.'
                                : `Vendor earnings (${money(period.pass_through.vendor_earnings, currency, locale)}) are not a cost — that money was never ours, it only passed through us.`}
                        </p>
                    </div>
                </div>

                {/* Shipping is the one line that can be negative, so it gets its own tile. */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <StatCard
                        label={isAr ? 'هامش الشحن' : 'Shipping margin'}
                        value={period.result.shipping_margin}
                        currency={currency}
                        icon={Truck}
                        tone={period.result.shipping_margin >= 0 ? 'profit' : 'loss'}
                        sub={isAr ? 'المحصّل من العملاء ناقص تكلفة بوسطة' : 'Charged to customers minus what Bosta billed'}
                        hint={period.data_quality.estimated_parcel_costs > 0
                            ? (isAr
                                ? `${period.data_quality.estimated_parcel_costs} شحنة تكلفتها تقديرية من التعريفة الحالية.`
                                : `${period.data_quality.estimated_parcel_costs} parcel(s) costed from today's tariff rather than a snapshot — treat as an estimate.`)
                            : null}
                    />
                    <StatCard
                        label={isAr ? 'المرتجعات للعملاء' : 'Refunds to customers'}
                        value={period.pass_through.refunds_to_customers}
                        currency={currency}
                        icon={AlertTriangle}
                        tone={period.pass_through.refunds_to_customers > 0 ? 'warn' : 'neutral'}
                        sub={isAr ? `${period.pass_through.refund_count} مرتجع` : `${period.pass_through.refund_count} refund(s)`}
                    />
                    <StatCard
                        label={isAr ? 'ربح مدى الحياة' : 'Lifetime profit'}
                        value={lifetime.result.net_profit}
                        currency={currency}
                        icon={Wallet}
                        tone={lifetime.result.net_profit >= 0 ? 'profit' : 'loss'}
                        sub={isAr ? `${lifetime.result.orders} طلب اتسلم على الإطلاق` : `across ${lifetime.result.orders} delivered orders ever`}
                    />
                </div>
            </section>

            {/* ---------------- TREND ---------------- */}
            {trend.length > 0 && (
                <section className={`${CARD} p-5`}>
                    <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-5">
                        {isAr ? 'آخر ١٢ شهرًا' : 'Last 12 months'}
                    </p>

                    <div className="overflow-x-auto">
                        <div className="flex items-end gap-3 min-w-max h-52 px-1">
                            {trend.map((m) => {
                                const revH = Math.max(2, (m.revenue / maxTrend) * 100);
                                const costH = Math.max(2, (m.costs / maxTrend) * 100);
                                return (
                                    <div key={m.month} className="flex flex-col items-center gap-2 w-16 group">
                                        <div className="flex items-end gap-1 h-40 w-full justify-center">
                                            <div
                                                className="w-4 rounded-t bg-emerald-500/80 group-hover:bg-emerald-500 transition-colors"
                                                style={{ height: `${revH}%` }}
                                                title={`${isAr ? 'إيراد' : 'Revenue'}: ${money(m.revenue, currency, locale)}`}
                                            />
                                            <div
                                                className="w-4 rounded-t bg-red-500/70 group-hover:bg-red-500 transition-colors"
                                                style={{ height: `${costH}%` }}
                                                title={`${isAr ? 'تكلفة' : 'Costs'}: ${money(m.costs, currency, locale)}`}
                                            />
                                        </div>
                                        <p className="text-[10px] font-bold text-zinc-500">{m.month.slice(2)}</p>
                                        <p dir="ltr" className={`text-[10px] font-black tabular-nums ${m.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                            {compactMoney(m.profit, '')}
                                        </p>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex gap-4 mt-4 text-xs text-zinc-500">
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/80" />{isAr ? 'إيرادات' : 'Revenue'}</span>
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-red-500/70" />{isAr ? 'تكاليف' : 'Costs'}</span>
                        <span className="text-zinc-400">{isAr ? 'الرقم أسفل كل عمود هو صافي الربح' : 'The figure under each column is net profit'}</span>
                    </div>
                </section>
            )}
        </div>
    );
}

/** One line of a revenue or cost list. */
function LedgerLine({ icon: Icon, label, value, currency, note }) {
    return (
        <li className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
                <Icon size={15} className="text-zinc-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">{label}</p>
                    {note && <p className="text-[11px] text-zinc-400 mt-0.5">{note}</p>}
                </div>
            </div>
            <Money value={value} currency={currency} className="text-sm font-bold shrink-0" />
        </li>
    );
}
