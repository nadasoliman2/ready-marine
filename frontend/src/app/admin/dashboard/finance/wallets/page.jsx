'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from '../../../../../components/LocaleLink';
import { useApp } from '../../../../../context/AppContext';
import { adminFinanceApi } from '../../../../../lib/api';
import {
    CARD, Money, StatCard, DateRangeFilter, Spinner, EmptyState,
    money, fmtDateTime, TableWrap, Th, Td,
} from '../../../../../components/dashboard/finance/FinanceUI';
import {
    Wallet, TrendingDown, ShoppingBag, Users, Snowflake,
    ArrowRight, AlertTriangle, ShieldCheck, CreditCard, Undo2, RotateCcw,
} from 'lucide-react';
import useRowLink from '../../../../../lib/useRowLink';

/**
 * Wallet control & review.
 *
 * The customer prepaid balance, not the vendor payout ledger on the other tabs. The two
 * live in the same module because both are the company's money, and are never added
 * together because they are opposite kinds of liability: a wallet is cash already taken
 * and owed back in goods, a vendor balance is money owed out of future revenue.
 */

const BUCKET_LABELS = {
    zero: { ar: 'صفر', en: 'Empty' },
    under_50: { ar: 'أقل من ٥٠', en: 'Under 50' },
    '50_200': { ar: '٥٠ – ٢٠٠', en: '50 – 200' },
    '200_1000': { ar: '٢٠٠ – ١٠٠٠', en: '200 – 1,000' },
    over_1000: { ar: 'أكتر من ١٠٠٠', en: 'Over 1,000' },
};

const TYPE_LABELS = {
    topup: { ar: 'شحن رصيد', en: 'Top-up' },
    purchase: { ar: 'دفع طلب', en: 'Order payment' },
    purchase_reserve: { ar: 'حجز عند الدفع', en: 'Checkout hold' },
    purchase_release: { ar: 'رجوع الحجز', en: 'Hold released' },
    purchase_refund: { ar: 'استرداد طلب', en: 'Order refunded' },
    refund_credit: { ar: 'استرداد مرتجع', en: 'Return refunded' },
    admin_credit: { ar: 'إضافة يدوية', en: 'Manual credit' },
    admin_debit: { ar: 'خصم يدوي', en: 'Manual debit' },
};

const TOPUP_STATUS_LABELS = {
    paid: { ar: 'ناجحة', en: 'Paid', tone: 'text-emerald-600' },
    pending: { ar: 'معلّقة', en: 'Pending', tone: 'text-amber-600' },
    failed: { ar: 'فشلت', en: 'Failed', tone: 'text-red-600' },
    expired: { ar: 'انتهت مدتها', en: 'Expired', tone: 'text-zinc-500' },
    paid_credit_failed: { ar: 'اتدفعت وما اتضافتش', en: 'Paid, not credited', tone: 'text-red-600' },
};

export default function WalletAnalyticsPage() {
    const rowLink = useRowLink();
    const { language, siteSettings } = useApp();
    const isAr = language === 'ar';
    const currency = siteSettings?.currency || 'EGP';
    const locale = isAr ? 'ar-EG' : 'en-US';
    const L = (map, key) => map[key]?.[isAr ? 'ar' : 'en'] || key;

    const [range, setRange] = useState(() => {
        const to = new Date();
        const from = new Date();
        from.setMonth(from.getMonth() - 1);
        return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
    });
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setData(await adminFinanceApi.getWallets({ from: range.from, to: range.to, months: 12 }));
        } catch (err) {
            setError(err.message || 'Failed to load wallet analytics.');
        } finally {
            setLoading(false);
        }
    }, [range.from, range.to]);

    useEffect(() => { load(); }, [load]);

    if (loading) return <div className="py-20 flex justify-center"><Spinner /></div>;
    if (error) {
        return (
            <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-bold">
                {error}
            </div>
        );
    }
    if (!data) return null;

    const { overview: o, topups: t, consumption: c, trend, reconciliation: rec, flow } = data;
    const maxTrend = Math.max(1, ...trend.map((m) => Math.max(m.credited, m.debited)));
    const maxBucket = Math.max(1, ...o.distribution.map((b) => b.wallets));

    return (
        <div className="space-y-8">
            {/* ─────────── POSITION: what the wallets hold right now ─────────── */}
            <section className="space-y-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-lg font-black text-zinc-900 dark:text-white">
                        {isAr ? 'أرصدة المحافظ الآن' : 'Wallet balances now'}
                    </h2>
                    <p className="text-xs text-zinc-500">
                        {isAr
                            ? 'أرصدة لحظية — فلتر التاريخ تحت لا ينطبق عليها'
                            : 'Live balances — the date range below does not apply here'}
                    </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    <StatCard
                        label={isAr ? 'الرصيد المتاح' : 'Available balance'}
                        value={o.available}
                        currency={currency}
                        icon={Wallet}
                        tone={o.available > 0 ? 'brand' : 'neutral'}
                        sub={isAr
                            ? `في ${o.wallets_with_balance} محفظة من ${o.accounts}`
                            : `across ${o.wallets_with_balance} of ${o.accounts} wallets`}
                    />
                    <StatCard
                        label={isAr ? 'التزام على الشركة' : 'Outstanding liability'}
                        value={o.outstanding_liability}
                        currency={currency}
                        icon={AlertTriangle}
                        sub={isAr ? `منها ${money(o.reserved, currency, locale)} محجوزة` : `${money(o.reserved, currency, locale)} of it held`}
                        hint={isAr
                            ? 'فلوس العملاء اللي الشركة شايلاها. مش إيراد — دين مستحق يتصرف بضاعة.'
                            : 'Customer money the company is holding. Not revenue — a debt owed back in goods.'}
                    />
                    <StatCard
                        label={isAr ? 'متوسط الرصيد' : 'Average balance'}
                        value={o.average_balance}
                        currency={currency}
                        icon={Users}
                        sub={isAr ? `${o.active_accounts} محفظة اتحركت آخر ${o.idle_after_days} يوم` : `${o.active_accounts} active in ${o.idle_after_days} days`}
                    />
                    <StatCard
                        label={isAr ? 'نسبة الاستخدام' : 'Utilisation rate'}
                        value={o.utilisation_rate === null ? (isAr ? 'لا يوجد شحن' : 'No top-ups') : `${o.utilisation_rate}%`}
                        icon={TrendingDown}
                        sub={isAr ? 'من كل اللي اتشحن، اتصرف كام' : 'Of everything ever loaded, how much was spent'}
                    />
                </div>

                {/* ─── Balance lifecycle, read left to right ─── */}
                <div className={`${CARD} p-5`}>
                    <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-4">
                        {isAr ? 'دورة حياة الرصيد (منذ البداية)' : 'Balance lifecycle (lifetime)'}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
                        {[
                            [isAr ? 'اتشحن' : 'Purchased', flow.purchased, 'text-emerald-600'],
                            [isAr ? 'رجع استرداد' : 'Refunded in', flow.refunded_in, 'text-emerald-600'],
                            [isAr ? 'اتصرف' : 'Spent', flow.spent, 'text-red-600'],
                            [isAr ? 'محجوز' : 'Held', flow.reserved, 'text-amber-600'],
                            [isAr ? 'الباقي' : 'Remaining', flow.remaining, 'text-zinc-900 dark:text-white'],
                        ].map(([label, value, tone], i, arr) => (
                            <div key={label} className="flex items-center gap-2">
                                <div>
                                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide">{label}</p>
                                    <p className={`text-lg font-black ${tone}`}>{money(value, currency, locale)}</p>
                                </div>
                                {i < arr.length - 1 && <ArrowRight size={14} className="text-zinc-300 dark:text-zinc-600 shrink-0 rtl:rotate-180" />}
                            </div>
                        ))}
                    </div>
                </div>

                {/* ─── Distribution ─── */}
                <div className={`${CARD} p-5`}>
                    <div className="flex items-baseline justify-between mb-4">
                        <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">
                            {isAr ? 'توزيع الأرصدة' : 'Balance distribution'}
                        </p>
                        {o.frozen_accounts > 0 && (
                            <span className="text-xs font-bold text-blue-600 flex items-center gap-1">
                                <Snowflake size={12} /> {o.frozen_accounts} {isAr ? 'موقوفة' : 'frozen'}
                            </span>
                        )}
                    </div>
                    <div className="space-y-2">
                        {o.distribution.map((b) => (
                            <div key={b.bucket} className="flex items-center gap-3">
                                <span className="text-xs text-zinc-500 w-28 shrink-0">{L(BUCKET_LABELS, b.bucket)}</span>
                                <div className="flex-1 h-5 bg-zinc-100 dark:bg-white/5 rounded-md overflow-hidden min-w-0">
                                    <div
                                        className="h-full bg-marine-cyan/70 rounded-md transition-all"
                                        style={{ width: `${(b.wallets / maxBucket) * 100}%` }}
                                    />
                                </div>
                                <span className="text-xs font-bold text-zinc-600 dark:text-zinc-300 w-12 shrink-0 text-end">{b.wallets}</span>
                                <span className="text-xs text-zinc-400 w-24 shrink-0 text-end hidden sm:block">
                                    <Money value={b.balance} currency={currency} />
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ─────────── PERIOD ─────────── */}
            <section className="space-y-4">
                <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
                    <h2 className="text-lg font-black text-zinc-900 dark:text-white">
                        {isAr ? 'حركة الفترة' : 'Activity for the period'}
                    </h2>
                    <DateRangeFilter from={range.from} to={range.to} onChange={setRange} isAr={isAr} />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    <StatCard
                        label={isAr ? 'رصيد اتباع' : 'Balance sold'}
                        value={t.collected}
                        currency={currency}
                        icon={CreditCard}
                        tone="brand"
                        sub={isAr ? `${t.count} عملية · متوسط ${money(t.average_value, currency, locale)}` : `${t.count} payment(s) · avg ${money(t.average_value, currency, locale)}`}
                        hint={isAr
                            ? 'كاش دخل فعلاً. مش إيراد لحد ما العميل يصرفه على طلب.'
                            : 'Cash actually received. Not revenue until the customer spends it on an order.'}
                    />
                    <StatCard
                        label={isAr ? 'رصيد اتصرف' : 'Balance spent'}
                        value={c.spent}
                        currency={currency}
                        icon={ShoppingBag}
                        sub={isAr ? `${c.count} عملية · متوسط ${money(c.average_value, currency, locale)}` : `${c.count} payment(s) · avg ${money(c.average_value, currency, locale)}`}
                    />
                    <StatCard
                        label={isAr ? 'صافي الفترة' : 'Net for the period'}
                        value={c.net_change}
                        currency={currency}
                        icon={c.net_change >= 0 ? Wallet : TrendingDown}
                        tone={c.net_change >= 0 ? 'profit' : 'loss'}
                        sub={isAr ? 'الداخل ناقص الخارج' : 'In minus out'}
                    />
                    <StatCard
                        label={isAr ? 'نجاح عمليات الشحن' : 'Top-up success rate'}
                        value={t.success_rate === null ? '—' : `${t.success_rate}%`}
                        icon={ShieldCheck}
                        tone={t.success_rate !== null && t.success_rate < 70 ? 'loss' : 'neutral'}
                        sub={isAr ? `${t.count} نجحت من ${t.attempted} محاولة` : `${t.count} of ${t.attempted} attempts`}
                        hint={isAr
                            ? 'لو الرقم واطي، المشكلة في بوابة الدفع نفسها مش في الطلب على الرصيد.'
                            : 'A low number is a payment-gateway problem, not a demand problem.'}
                    />
                </div>

                {/* ─── Purchase vs consumption, month by month ─── */}
                <div className={`${CARD} p-5`}>
                    <div className="flex items-baseline justify-between mb-1">
                        <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">
                            {isAr ? 'الشحن مقابل الصرف — ١٢ شهر' : 'Loaded vs spent — 12 months'}
                        </p>
                        <div className="flex items-center gap-3 text-[10px] font-bold">
                            <span className="flex items-center gap-1 text-emerald-600"><i className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" />{isAr ? 'داخل' : 'In'}</span>
                            <span className="flex items-center gap-1 text-red-600"><i className="w-2 h-2 rounded-sm bg-red-500 inline-block" />{isAr ? 'خارج' : 'Out'}</span>
                        </div>
                    </div>
                    <p className="text-[10px] text-zinc-400 mb-4">
                        {isAr
                            ? 'خط الرصيد مشتق من الحركات — مفيش تاريخ محفوظ للرصيد، فهو تقريبي لكل شهر ومضبوط عند آخر شهر.'
                            : 'The balance line is derived from movements — no monthly balance is stored, so it approximates each month and is exact at the last.'}
                    </p>
                    <TableWrap>
                        <div className="flex items-end gap-3 min-w-max pb-2">
                            {trend.map((m) => (
                                <div key={m.month} className="flex flex-col items-center gap-2 w-14 group">
                                    <div className="flex items-end gap-1 h-32 w-full justify-center">
                                        <div
                                            className="w-1/2 bg-emerald-500/80 rounded-t group-hover:bg-emerald-500 transition-colors"
                                            style={{ height: `${Math.max(2, (m.credited / maxTrend) * 100)}%` }}
                                            title={`${isAr ? 'داخل' : 'In'}: ${money(m.credited, currency, locale)}`}
                                        />
                                        <div
                                            className="w-1/2 bg-red-500/80 rounded-t group-hover:bg-red-500 transition-colors"
                                            style={{ height: `${Math.max(2, (m.debited / maxTrend) * 100)}%` }}
                                            title={`${isAr ? 'خارج' : 'Out'}: ${money(m.debited, currency, locale)}`}
                                        />
                                    </div>
                                    <span className="text-[9px] text-zinc-400 font-bold">{m.month.slice(2)}</span>
                                    <span className="text-[9px] text-zinc-500 font-black">{m.closing_balance}</span>
                                </div>
                            ))}
                        </div>
                    </TableWrap>
                </div>

                {/* ─── Where the money came from and where it went ─── */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className={`${CARD} p-5`}>
                        <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-3">
                            {isAr ? 'حالات عمليات الشحن' : 'Top-up outcomes'}
                        </p>
                        {Object.keys(t.by_status).length === 0 ? (
                            <p className="text-xs text-zinc-400">{isAr ? 'لا يوجد' : 'Nothing in this period'}</p>
                        ) : Object.entries(t.by_status).map(([status, v]) => (
                            <div key={status} className="flex items-center justify-between gap-3 py-1.5 border-b border-zinc-100 dark:border-white/5 last:border-0">
                                <span className={`text-xs font-bold ${TOPUP_STATUS_LABELS[status]?.tone || 'text-zinc-500'}`}>
                                    {L(TOPUP_STATUS_LABELS, status)}
                                </span>
                                <span className="text-xs text-zinc-500 shrink-0">
                                    {v.count} · <Money value={v.amount} currency={currency} />
                                </span>
                            </div>
                        ))}
                        {t.by_payment_method.length > 0 && (
                            <>
                                <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mt-5 mb-3">
                                    {isAr ? 'وسيلة الدفع' : 'Payment method'}
                                </p>
                                {t.by_payment_method.map((m) => (
                                    <div key={m.method} className="flex items-center justify-between gap-3 py-1.5 border-b border-zinc-100 dark:border-white/5 last:border-0">
                                        <span className="text-xs text-zinc-600 dark:text-zinc-300">{m.method}</span>
                                        <span className="text-xs text-zinc-500 shrink-0">{m.count} · <Money value={m.amount} currency={currency} /></span>
                                    </div>
                                ))}
                            </>
                        )}
                    </div>

                    <div className={`${CARD} p-5`}>
                        <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-3">
                            {isAr ? 'أنواع الحركات' : 'Movement types'}
                        </p>
                        {Object.keys(c.by_type).length === 0 ? (
                            <p className="text-xs text-zinc-400">{isAr ? 'لا يوجد' : 'Nothing in this period'}</p>
                        ) : Object.entries(c.by_type).map(([type, v]) => (
                            <div key={type} className="flex items-center justify-between gap-3 py-1.5 border-b border-zinc-100 dark:border-white/5 last:border-0">
                                <span className="text-xs text-zinc-600 dark:text-zinc-300 truncate">{L(TYPE_LABELS, type)}</span>
                                <span className="text-xs text-zinc-500 shrink-0">{v.count} · <Money value={v.amount} currency={currency} /></span>
                            </div>
                        ))}
                        {c.released_holds.count > 0 && (
                            <p className="text-[10px] text-amber-600 mt-3 pt-3 border-t border-zinc-100 dark:border-white/5 flex items-start gap-1.5">
                                <Undo2 size={12} className="mt-0.5 shrink-0" />
                                {isAr
                                    ? `${c.released_holds.count} حجز رجع للعميل بقيمة ${money(c.released_holds.amount, currency, locale)} — دفع ابتدى وما كملش. مش محسوب كصرف.`
                                    : `${c.released_holds.count} hold(s) worth ${money(c.released_holds.amount, currency, locale)} were returned — checkouts started and abandoned. Not counted as spending.`}
                            </p>
                        )}
                    </div>
                </div>

                {/* ─── Top customers, both directions ─── */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {[
                        [isAr ? 'أكتر العملاء شحناً' : 'Top by balance bought', t.top_customers],
                        [isAr ? 'أكتر العملاء صرفاً' : 'Top by balance spent', c.top_customers],
                    ].map(([title, rows]) => (
                        <div key={title} className={CARD}>
                            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide p-4 pb-2">{title}</p>
                            {rows.length === 0 ? (
                                <p className="text-xs text-zinc-400 px-4 pb-4">{isAr ? 'لا يوجد' : 'Nothing in this period'}</p>
                            ) : (
                                <TableWrap>
                                    <table className="w-full min-w-[520px]">
                                        <tbody>
                                            {rows.map((r) => (
                                                <tr key={r.user_id} {...rowLink(`/admin/dashboard/users/${r.user_id}`)} className="border-t border-zinc-100 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/[0.02] cursor-pointer">
                                                    <Td>
                                                        <Link href={`/admin/dashboard/users/${r.user_id}`} className="font-bold text-zinc-900 dark:text-white hover:text-marine-primary transition-colors">
                                                            {r.name}
                                                        </Link>
                                                        <span className="block text-[10px] text-zinc-400">{r.phone}</span>
                                                    </Td>
                                                    <Td align="right"><span className="text-xs text-zinc-500">{r.count}</span></Td>
                                                    <Td align="right"><Money value={r.amount} currency={currency} /></Td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </TableWrap>
                            )}
                        </div>
                    ))}
                </div>
            </section>

            {/* ─────────── CONTROL ─────────── */}
            <section className="space-y-4">
                <h2 className="text-lg font-black text-zinc-900 dark:text-white">
                    {isAr ? 'الرقابة' : 'Control'}
                </h2>

                {/* The check that an audit log cannot make: a log records what asked to
                    happen, this records whether the money agrees. */}
                <div className={`${CARD} p-5`}>
                    <div className="flex items-start gap-3">
                        {rec.mismatched === 0
                            ? <ShieldCheck size={20} className="text-emerald-500 mt-0.5 shrink-0" />
                            : <AlertTriangle size={20} className="text-red-500 mt-0.5 shrink-0" />}
                        <div className="flex-1 min-w-0">
                            <p className={`text-sm font-black ${rec.mismatched === 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                                {rec.mismatched === 0
                                    ? (isAr ? 'كل الأرصدة مطابقة لسجل الحركات' : 'Every balance matches its own ledger')
                                    : (isAr ? `${rec.mismatched} محفظة رصيدها مش مطابق لحركاتها` : `${rec.mismatched} wallet(s) disagree with their own ledger`)}
                            </p>
                            <p className="text-xs text-zinc-500 mt-0.5">
                                {isAr
                                    ? `اتفحص ${rec.checked} محفظة عليها حركات. كل حركة اتجمعت من الأول واتقارنت بالرصيد المخزّن — أي فرق معناه فلوس اتحركت من غير سطر يفسرها.`
                                    : `${rec.checked} wallet(s) with movements checked. Every movement re-added and compared with the stored balance — a difference means money moved with no row explaining it.`}
                            </p>
                            {rec.wallets.length > 0 && (
                                <div className="mt-3">
                                    <TableWrap>
                                        <table className="w-full min-w-[520px]">
                                            <thead><tr>
                                                <Th>{isAr ? 'العميل' : 'Customer'}</Th>
                                                <Th align="right">{isAr ? 'المخزّن' : 'Stored'}</Th>
                                                <Th align="right">{isAr ? 'من السجل' : 'From ledger'}</Th>
                                                <Th align="right">{isAr ? 'الفرق' : 'Drift'}</Th>
                                            </tr></thead>
                                            <tbody>
                                                {rec.wallets.map((w) => (
                                                    <tr key={String(w.user_id)} className="border-t border-zinc-100 dark:border-white/5">
                                                        <Td>{w.customer?.name || String(w.user_id)}</Td>
                                                        <Td align="right"><Money value={w.stored_balance} currency={currency} /></Td>
                                                        <Td align="right"><Money value={w.ledger_balance} currency={currency} /></Td>
                                                        <Td align="right"><span className="text-red-600 font-black"><Money value={w.drift} currency={currency} signed /></span></Td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </TableWrap>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap gap-3">
                    <Link
                        href="/admin/dashboard/finance/wallets/ledger"
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-marine-cyan text-white text-sm font-bold hover:bg-[#b91c1c] transition-colors"
                    >
                        {isAr ? 'كل حركات المحافظ' : 'Full wallet ledger'} <ArrowRight size={15} className="rtl:rotate-180" />
                    </Link>
                    {/* Freezing, manual adjustment and the failed-credit queue already live on
                        the wallets screen; this links there instead of duplicating them. */}
                    <Link
                        href="/admin/dashboard/wallets"
                        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-sm font-bold text-zinc-700 dark:text-zinc-200 hover:border-marine-cyan transition-colors"
                    >
                        <RotateCcw size={15} />
                        {isAr ? 'إدارة المحافظ والتسويات' : 'Manage wallets & adjustments'}
                    </Link>
                </div>
            </section>
        </div>
    );
}
