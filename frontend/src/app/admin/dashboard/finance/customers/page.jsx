'use client';

import { useEffect, useState, useCallback } from 'react';
import { useApp } from '../../../../../context/AppContext';
import { adminFinanceApi } from '../../../../../lib/api';
import usePageSize from '../../../../../lib/usePageSize';
import {
    CARD, INPUT, LABEL, Money, StatCard, ProfitBadge, DateRangeFilter, Spinner,
    EmptyState, TableWrap, Th, Td, Pagination, money, fmtDate, toInputDate,
} from '../../../../../components/dashboard/finance/FinanceUI';
import {
    Users, Search, Megaphone, TrendingUp, ShoppingBag, Truck,
    Percent, RotateCcw, Loader2, Info, AlertTriangle,
} from 'lucide-react';

/**
 * Screen 3 — who pays us, what it costs, and what is left.
 *
 * The ad-spend box is the one input on the page. It is a WHAT-IF: it overrides the ledger
 * for this view only and never writes anything, so the profit figure can be stress-tested
 * without corrupting the record. Real spend is entered on the Settings tab, and the page
 * says plainly which of the two it is currently showing.
 */
export default function CustomersProfitPage() {
    const { language, siteSettings } = useApp();
    const isAr = language === 'ar';
    const currency = siteSettings?.currency || 'EGP';
    const locale = isAr ? 'ar-EG' : 'en-US';

    const [range, setRange] = useState(() => {
        const now = new Date();
        return { from: toInputDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: toInputDate(now) };
    });
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState('revenue');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = usePageSize('admin.finance.customers', 25);

    // Held apart from the applied value so typing does not fire a request per keystroke.
    const [adSpendInput, setAdSpendInput] = useState('');
    const [adSpendApplied, setAdSpendApplied] = useState('');

    const [customers, setCustomers] = useState(null);
    const [profit, setProfit] = useState(null);
    const [loading, setLoading] = useState(true);
    const [profitLoading, setProfitLoading] = useState(false);
    const [error, setError] = useState('');

    const loadCustomers = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setCustomers(await adminFinanceApi.getCustomers({ ...range, search, sort, page, limit: pageSize }));
        } catch (err) {
            setError(err.message || 'Failed to load customers');
        } finally {
            setLoading(false);
        }
    }, [range.from, range.to, search, sort, page, pageSize]);

    const loadProfit = useCallback(async () => {
        setProfitLoading(true);
        try {
            setProfit(await adminFinanceApi.getProfit({ ...range, adSpend: adSpendApplied }));
        } catch (_) {
            // The customer table below still stands on its own if this fails.
        } finally {
            setProfitLoading(false);
        }
    }, [range.from, range.to, adSpendApplied]);

    useEffect(() => {
        const t = setTimeout(loadCustomers, search ? 350 : 0);
        return () => clearTimeout(t);
    }, [loadCustomers]);

    useEffect(() => { loadProfit(); }, [loadProfit]);
    useEffect(() => { setPage(1); }, [range.from, range.to, search, sort]);

    if (loading && !customers) return <Spinner />;

    const rows = customers?.rows || [];
    const totals = customers?.totals || {};

    return (
        <div className="space-y-6">
            <DateRangeFilter from={range.from} to={range.to} onChange={setRange} isAr={isAr} />

            {/* ---------------- Profit panel ---------------- */}
            {profit && (
                <div className={`${CARD} p-6`}>
                    <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-6">
                        <div>
                            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">
                                {profit.result.is_profit ? (isAr ? 'صافي الربح' : 'Net profit') : (isAr ? 'صافي الخسارة' : 'Net loss')}
                            </p>
                            <div className="mt-2 flex items-center gap-3">
                                <ProfitBadge value={profit.result.net_profit} currency={currency} size="lg" />
                                {profitLoading && <Loader2 size={18} className="animate-spin text-zinc-400" />}
                            </div>
                            <p className="text-xs text-zinc-500 mt-2">
                                {money(profit.revenue.total, currency, locale)} {isAr ? 'إيراد' : 'revenue'}
                                {' − '}
                                {money(profit.costs.total, currency, locale)} {isAr ? 'تكاليف' : 'costs'}
                                {` · ${profit.result.margin_percent}% ${isAr ? 'هامش' : 'margin'}`}
                            </p>
                        </div>

                        {/* The ad-spend what-if. */}
                        <div className="w-full xl:w-80 shrink-0">
                            <label className={`${LABEL} flex items-center gap-1.5`}>
                                <Megaphone size={13} />
                                {isAr ? 'الإنفاق الإعلاني' : 'Ad spend'}
                            </label>
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={adSpendInput}
                                    onChange={(e) => setAdSpendInput(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && setAdSpendApplied(adSpendInput)}
                                    placeholder={money(profit.ad_spend_detail.total, currency, locale)}
                                    className={`${INPUT} flex-1`}
                                    dir="ltr"
                                />
                                <button
                                    onClick={() => setAdSpendApplied(adSpendInput)}
                                    className="px-4 py-2 rounded-xl bg-marine-cyan hover:bg-marine-cyan-dark text-white text-sm font-bold transition-colors"
                                >
                                    {isAr ? 'تطبيق' : 'Apply'}
                                </button>
                                {adSpendApplied !== '' && (
                                    <button
                                        onClick={() => { setAdSpendInput(''); setAdSpendApplied(''); }}
                                        className="px-3 py-2 rounded-xl bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-400 text-sm font-bold"
                                    >
                                        {isAr ? 'إعادة' : 'Reset'}
                                    </button>
                                )}
                            </div>

                            <p className="text-[11px] text-zinc-400 mt-2 flex items-start gap-1.5">
                                <Info size={12} className="mt-0.5 shrink-0" />
                                {profit.costs.ad_spend_is_override
                                    ? (isAr
                                        ? 'قيمة افتراضية للتجربة — لا تُحفظ. السجل الفعلي: ' + money(profit.ad_spend_detail.total, currency, locale)
                                        : `What-if value, not saved. The ledger says ${money(profit.ad_spend_detail.total, currency, locale)}.`)
                                    : (isAr
                                        ? `من سجل الإنفاق (${profit.ad_spend_detail.count} إدخال). أضف إنفاقًا فعليًا من تبويب الإعدادات.`
                                        : `From the spend ledger (${profit.ad_spend_detail.count} entr${profit.ad_spend_detail.count === 1 ? 'y' : 'ies'}). Record real spend on the Settings tab.`)}
                            </p>

                            {Object.keys(profit.ad_spend_detail.by_channel || {}).length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    {Object.entries(profit.ad_spend_detail.by_channel).map(([channel, amount]) => (
                                        <span key={channel} className="text-[10px] font-bold px-2 py-1 rounded-lg bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-400">
                                            {channel} · {money(amount, currency, locale)}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Revenue and cost lines. */}
                    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-4 mt-6 pt-6 border-t border-zinc-100 dark:border-white/5">
                        <Metric label={isAr ? 'عمولة' : 'Commission'} value={profit.revenue.commission_net} currency={currency} tone="good" />
                        <Metric label={isAr ? 'شحن محصّل' : 'Shipping in'} value={profit.revenue.shipping_charged} currency={currency} tone="good" />
                        <Metric label={isAr ? 'اشتراكات' : 'Subscriptions'} value={profit.revenue.subscriptions} currency={currency} tone="good" />
                        <Metric label={isAr ? 'مستلزمات' : 'Supplies'} value={profit.revenue.supplies} currency={currency} tone="good" />
                        <Metric label={isAr ? 'بوسطة' : 'Bosta'} value={-profit.costs.shipping_paid_to_bosta} currency={currency} tone="bad" />
                        <Metric label={isAr ? 'كوبونات' : 'Coupons'} value={-profit.costs.coupon_discounts} currency={currency} tone="bad" />
                        <Metric label={isAr ? 'ولاء' : 'Loyalty'} value={-profit.costs.loyalty_discounts} currency={currency} tone="bad" />
                        <Metric label={isAr ? 'إعلانات' : 'Ads'} value={-profit.costs.ad_spend} currency={currency} tone="bad" />
                    </div>

                    {/* Prepaid shipping that expired unused. Shown on its own, and only when
                        it happened, because it belongs to no order and is the one cost line
                        that is fixed by buying differently rather than by selling more. */}
                    {profit.costs.bundle_waste > 0 && (
                        <div className="mt-4 flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 text-xs font-bold">
                            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                            <span>
                                {isAr
                                    ? `شحنات باقة ضاعت: ${profit.costs.bundle_waste_orders} شحنة مدفوعة ومستخدمتش قبل ما الباقة تخلص مدتها — ${money(profit.costs.bundle_waste, currency, locale)}`
                                    : `Bundle parcels wasted: ${profit.costs.bundle_waste_orders} prepaid parcels expired unused — ${money(profit.costs.bundle_waste, currency, locale)}`}
                            </span>
                        </div>
                    )}

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-zinc-100 dark:border-white/5">
                        <StatCard label={isAr ? 'هامش الشحن' : 'Shipping margin'} value={profit.result.shipping_margin} currency={currency}
                            icon={Truck} tone={profit.result.shipping_margin >= 0 ? 'profit' : 'loss'} />
                        <StatCard label="ROAS" value={profit.result.roas !== null ? `${profit.result.roas}×` : '—'} icon={TrendingUp}
                            sub={isAr ? 'إيراد لكل جنيه إعلاني' : 'revenue per pound of ad spend'} />
                        <StatCard label={isAr ? 'ربح لكل طلب' : 'Profit per order'} value={profit.result.profit_per_order} currency={currency}
                            icon={ShoppingBag} tone={profit.result.profit_per_order >= 0 ? 'profit' : 'loss'} />
                        <StatCard label={isAr ? 'مرتجعات' : 'Refunds'} value={profit.pass_through.refunds_to_customers} currency={currency}
                            icon={RotateCcw} tone={profit.pass_through.refunds_to_customers > 0 ? 'warn' : 'neutral'}
                            sub={isAr ? `${profit.pass_through.refund_count} مرتجع` : `${profit.pass_through.refund_count} refund(s)`} />
                    </div>
                </div>
            )}

            {/* ---------------- Customers ---------------- */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <StatCard label={isAr ? 'عملاء دافعون' : 'Paying customers'} value={String(totals.customers || 0)} icon={Users}
                    sub={isAr ? `${totals.orders || 0} طلب مُسلَّم` : `${totals.orders || 0} delivered order(s)`} />
                <StatCard label={isAr ? 'إجمالي المدفوع' : 'Total they paid'} value={totals.gross_paid} currency={currency} icon={ShoppingBag} />
                <StatCard label={isAr ? 'صافي إيرادنا' : 'Our net revenue'} value={totals.net_revenue} currency={currency} icon={Percent}
                    tone={totals.net_revenue >= 0 ? 'profit' : 'loss'}
                    sub={isAr ? 'عمولة + هامش شحن − خصومات' : 'commission + shipping margin − discounts'} />
                <StatCard label={isAr ? 'مستحق للتجار' : 'Owed to vendors'} value={totals.vendor_payable} currency={currency} icon={Truck}
                    sub={isAr ? 'ليست أموالنا' : 'never ours — passes through'} />
            </div>

            <div className={CARD}>
                <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 border-b border-zinc-100 dark:border-white/5">
                    <div className="relative flex-1 min-w-[220px]">
                        <Search size={16} className={`absolute top-1/2 -translate-y-1/2 text-zinc-400 ${isAr ? 'right-3' : 'left-3'}`} />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={isAr ? 'ابحث بالاسم أو البريد أو الهاتف…' : 'Search name, email or phone…'}
                            className={`${INPUT} w-full ${isAr ? 'pr-9' : 'pl-9'}`}
                        />
                    </div>
                    <select value={sort} onChange={(e) => setSort(e.target.value)} className={INPUT}>
                        <option value="revenue">{isAr ? 'الأعلى ربحية لنا' : 'Most profitable to us'}</option>
                        <option value="spend">{isAr ? 'الأعلى إنفاقًا' : 'Highest spend'}</option>
                        <option value="orders">{isAr ? 'الأكثر طلبات' : 'Most orders'}</option>
                        <option value="recent">{isAr ? 'الأحدث' : 'Most recent'}</option>
                    </select>
                </div>

                {loading ? (
                    <Spinner />
                ) : error ? (
                    <div className="p-6"><p className="text-red-600 dark:text-red-400 font-bold">{error}</p></div>
                ) : rows.length === 0 ? (
                    <EmptyState
                        icon={Users}
                        title={isAr ? 'لا عملاء في هذه الفترة' : 'No paying customers in this period'}
                        message={isAr
                            ? 'يُحتسب العميل عند تسليم طلبه. جرّب فترة أوسع.'
                            : 'A customer counts once their order is delivered. Try a wider date range.'}
                    />
                ) : (
                    <TableWrap>
                        <table className="w-full min-w-[900px]">
                            <thead className="bg-zinc-50 dark:bg-white/[0.02] border-b border-zinc-100 dark:border-white/5">
                                <tr>
                                    <Th>{isAr ? 'العميل' : 'Customer'}</Th>
                                    <Th align="right">{isAr ? 'طلبات' : 'Orders'}</Th>
                                    <Th align="right">{isAr ? 'دفعوا' : 'They paid'}</Th>
                                    <Th align="right">{isAr ? 'عمولتنا' : 'Our commission'}</Th>
                                    <Th align="right">{isAr ? 'هامش الشحن' : 'Shipping margin'}</Th>
                                    <Th align="right">{isAr ? 'خصومات' : 'Discounts'}</Th>
                                    <Th align="right">{isAr ? 'صافي لنا' : 'Net to us'}</Th>
                                    <Th>{isAr ? 'آخر طلب' : 'Last order'}</Th>
                                </tr>
                            </thead>

                            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                {rows.map((c) => (
                                    <tr key={c.customer_id} className="hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors">
                                        <Td>
                                            <p className="font-bold text-zinc-900 dark:text-white">{c.name}</p>
                                            <p className="text-xs text-zinc-500 truncate max-w-[200px]">{c.email || c.phone}</p>
                                        </Td>
                                        <Td align="right">
                                            <span className="font-bold text-zinc-900 dark:text-white tabular-nums">{c.orders}</span>
                                            <p className="text-[11px] text-zinc-500" dir="ltr">
                                                {isAr ? 'متوسط ' : 'avg '}{money(c.average_order_value, currency, locale)}
                                            </p>
                                        </Td>
                                        <Td align="right"><Money value={c.gross_paid} currency={currency} className="text-sm" /></Td>
                                        <Td align="right">
                                            <span dir="ltr" className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                                                {money(c.commission_net, currency, locale)}
                                            </span>
                                        </Td>
                                        <Td align="right"><Money value={c.shipping_margin} currency={currency} signed className="text-sm" /></Td>
                                        <Td align="right">
                                            <span dir="ltr" className="text-sm text-red-600 dark:text-red-400 tabular-nums">
                                                {c.coupon_discount + c.loyalty_discount > 0 ? '−' : ''}
                                                {money(c.coupon_discount + c.loyalty_discount, currency, locale)}
                                            </span>
                                            {c.refunded > 0 && (
                                                <p className="text-[11px] text-amber-600 dark:text-amber-400" dir="ltr">
                                                    {isAr ? 'مرتجع ' : 'refunded '}{money(c.refunded, currency, locale)}
                                                </p>
                                            )}
                                        </Td>
                                        <Td align="right">
                                            <span dir="ltr" className={`font-black tabular-nums ${c.net_revenue >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                                {money(c.net_revenue, currency, locale)}
                                            </span>
                                        </Td>
                                        <Td><span className="text-sm text-zinc-600 dark:text-zinc-400">{fmtDate(c.last_order_at, isAr)}</span></Td>
                                    </tr>
                                ))}
                            </tbody>

                            <tfoot className="bg-zinc-50 dark:bg-white/[0.02] border-t-2 border-zinc-200 dark:border-white/10">
                                <tr>
                                    <Td className="font-black text-zinc-900 dark:text-white">{isAr ? 'الإجمالي' : 'Total'}</Td>
                                    <Td align="right" className="font-black tabular-nums text-zinc-900 dark:text-white">{totals.orders}</Td>
                                    <Td align="right"><span dir="ltr" className="font-black tabular-nums text-zinc-900 dark:text-white">{money(totals.gross_paid, currency, locale)}</span></Td>
                                    <Td align="right"><span dir="ltr" className="font-black tabular-nums text-emerald-600 dark:text-emerald-400">{money(totals.commission_net, currency, locale)}</span></Td>
                                    <Td align="right"><Money value={totals.shipping_margin} currency={currency} signed className="font-black" /></Td>
                                    <Td align="right"><span dir="ltr" className="font-black tabular-nums text-red-600 dark:text-red-400">−{money(totals.coupon_discount + totals.loyalty_discount, currency, locale)}</span></Td>
                                    <Td align="right">
                                        <span dir="ltr" className={`font-black tabular-nums ${totals.net_revenue >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                            {money(totals.net_revenue, currency, locale)}
                                        </span>
                                    </Td>
                                    <Td />
                                </tr>
                            </tfoot>
                        </table>
                    </TableWrap>
                )}

                <Pagination pageSize={pageSize} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} page={customers?.pagination?.page} pages={customers?.pagination?.pages} total={customers?.pagination?.total} onChange={setPage} isAr={isAr} />
            </div>
        </div>
    );
}

function Metric({ label, value, currency, tone }) {
    const colour = tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
    return (
        <div>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide truncate">{label}</p>
            <p dir="ltr" className={`text-sm font-black tabular-nums mt-1 ${colour}`}>
                {value < 0 ? '−' : ''}{money(Math.abs(value), currency)}
            </p>
        </div>
    );
}
