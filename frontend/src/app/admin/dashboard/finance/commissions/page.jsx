'use client';

import { useEffect, useState, useCallback, Fragment } from 'react';
import { useApp } from '../../../../../context/AppContext';
import { adminFinanceApi } from '../../../../../lib/api';
import usePageSize from '../../../../../lib/usePageSize';
import {
    CARD, INPUT, Money, StatCard, DateRangeFilter, Spinner, EmptyState,
    TableWrap, Th, Td, Pagination, money, fmtDate, toInputDate,
} from '../../../../../components/dashboard/finance/FinanceUI';
import {
    Percent, Search, Receipt, Truck, Package, ChevronDown, ChevronUp,
    TrendingUp, AlertTriangle, MapPin, CreditCard,
} from 'lucide-react';

/**
 * Screen 2 — our commission, order by order.
 *
 * Every row expands into the full arithmetic: what the customer paid, what the vendor
 * keeps, what we charged for shipping, what Bosta billed us, and what was left. The point
 * is that no figure on this page should require a second screen to explain.
 */
export default function CommissionsLedgerPage() {
    const { language, siteSettings } = useApp();
    const isAr = language === 'ar';
    const currency = siteSettings?.currency || 'EGP';
    const locale = isAr ? 'ar-EG' : 'en-US';

    const [range, setRange] = useState(() => {
        const now = new Date();
        return { from: toInputDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: toInputDate(now) };
    });
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = usePageSize('admin.finance.commissions', 25);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [expanded, setExpanded] = useState(new Set());

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setData(await adminFinanceApi.getCommissions({ ...range, search, page, limit: pageSize }));
        } catch (err) {
            setError(err.message || 'Failed to load the commission ledger');
        } finally {
            setLoading(false);
        }
    }, [range.from, range.to, search, page, pageSize]);

    useEffect(() => {
        const t = setTimeout(load, search ? 350 : 0);
        return () => clearTimeout(t);
    }, [load]);

    // Any filter change invalidates the current page number.
    useEffect(() => { setPage(1); }, [range.from, range.to, search]);

    const toggleExpand = (id) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    if (loading && !data) return <Spinner />;

    if (error) {
        return (
            <div className={`${CARD} p-6`}>
                <p className="text-red-600 dark:text-red-400 font-bold">{error}</p>
                <button onClick={load} className="mt-3 px-4 py-2 rounded-xl bg-marine-cyan text-white text-sm font-bold">
                    {isAr ? 'إعادة المحاولة' : 'Try again'}
                </button>
            </div>
        );
    }

    const rows = data?.rows || [];
    const totals = data?.totals || {};

    return (
        <div className="space-y-6">
            <DateRangeFilter from={range.from} to={range.to} onChange={setRange} isAr={isAr} />

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <StatCard
                    label={isAr ? 'صافي العمولة' : 'Net commission'}
                    value={totals.commission_net}
                    currency={currency}
                    icon={Percent}
                    tone="profit"
                    sub={totals.commission_reversed > 0
                        ? (isAr ? `بعد خصم ${money(totals.commission_reversed, currency, locale)} مرتجعات` : `after ${money(totals.commission_reversed, currency, locale)} reversed`)
                        : (isAr ? 'لا مرتجعات في هذه الفترة' : 'nothing reversed this period')}
                />
                <StatCard
                    label={isAr ? 'قيمة البضاعة' : 'Merchandise sold'}
                    value={totals.merchandise}
                    currency={currency}
                    icon={Package}
                    sub={isAr ? `${totals.parcels} شحنة` : `${totals.parcels} parcel(s)`}
                />
                <StatCard
                    label={isAr ? 'متوسط نسبة العمولة' : 'Average commission rate'}
                    value={`${totals.average_rate || 0}%`}
                    icon={TrendingUp}
                    sub={isAr ? 'محسوبة فعليًا لا من الإعدادات' : 'what was actually charged, not the configured rate'}
                />
                <StatCard
                    label={isAr ? 'صافي التجار' : 'Paid out to vendors'}
                    value={totals.vendor_net}
                    currency={currency}
                    icon={Receipt}
                    sub={isAr ? 'ليست تكلفة — أموال مرّت من خلالنا' : 'not a cost — money that passed through us'}
                />
            </div>

            <div className={CARD}>
                <div className="p-4 border-b border-zinc-100 dark:border-white/5">
                    <div className="relative max-w-md">
                        <Search size={16} className={`absolute top-1/2 -translate-y-1/2 text-zinc-400 ${isAr ? 'right-3' : 'left-3'}`} />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={isAr ? 'ابحث برقم الطلب أو العميل أو التاجر…' : 'Search order reference, customer or vendor…'}
                            className={`${INPUT} w-full ${isAr ? 'pr-9' : 'pl-9'}`}
                        />
                    </div>
                </div>

                {loading ? (
                    <Spinner />
                ) : rows.length === 0 ? (
                    <EmptyState
                        icon={Percent}
                        title={isAr ? 'لا توجد عمولات' : 'No commissions in this period'}
                        message={isAr
                            ? 'العمولة تُسجَّل عند تسليم الشحنة. جرّب فترة أوسع.'
                            : 'Commission is recorded when a parcel is delivered. Try a wider date range.'}
                    />
                ) : (
                    <TableWrap>
                        <table className="w-full min-w-[900px]">
                            <thead className="bg-zinc-50 dark:bg-white/[0.02] border-b border-zinc-100 dark:border-white/5">
                                <tr>
                                    <Th>{isAr ? 'الطلب' : 'Order'}</Th>
                                    <Th>{isAr ? 'التاجر' : 'Vendor'}</Th>
                                    <Th align="right">{isAr ? 'البضاعة' : 'Merchandise'}</Th>
                                    <Th align="right">{isAr ? 'عمولتنا' : 'Commission'}</Th>
                                    <Th align="right">{isAr ? 'هامش الشحن' : 'Shipping margin'}</Th>
                                    <Th align="right">{isAr ? 'إجمالي ربحنا' : 'Our total'}</Th>
                                    <Th>{isAr ? 'التسليم' : 'Delivered'}</Th>
                                    <Th className="w-10" />
                                </tr>
                            </thead>

                            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                {rows.map((r) => {
                                    const isOpen = expanded.has(r.earning_id);
                                    return (
                                        <Fragment key={r.earning_id}>
                                            <tr
                                                onClick={() => toggleExpand(r.earning_id)}
                                                className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors"
                                            >
                                                <Td>
                                                    <p className="font-bold text-zinc-900 dark:text-white">{r.reference}</p>
                                                    <p className="text-xs text-zinc-500">
                                                        {r.customer?.name || (isAr ? 'عميل محذوف' : 'deleted customer')}
                                                    </p>
                                                </Td>
                                                <Td>
                                                    <p className="text-sm text-zinc-800 dark:text-zinc-200">{r.vendor?.store_name || '—'}</p>
                                                    {r.city && <p className="text-xs text-zinc-500 flex items-center gap-1"><MapPin size={10} />{r.city}</p>}
                                                </Td>
                                                <Td align="right"><Money value={r.merchandise} currency={currency} className="text-sm" /></Td>
                                                <Td align="right">
                                                    <span dir="ltr" className="font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                                                        {money(r.commission_net, currency, locale)}
                                                    </span>
                                                    <p className="text-[11px] text-zinc-500">{r.effective_rate}%</p>
                                                </Td>
                                                <Td align="right">
                                                    <Money value={r.shipping_margin} currency={currency} signed className="text-sm font-bold" />
                                                    {r.shipping_cost_source === 'derived' && (
                                                        <p className="text-[10px] text-amber-600 dark:text-amber-400 font-bold">
                                                            {isAr ? 'تقديري' : 'ESTIMATE'}
                                                        </p>
                                                    )}
                                                </Td>
                                                <Td align="right">
                                                    <span dir="ltr" className={`font-black tabular-nums ${r.our_revenue >= 0 ? 'text-zinc-900 dark:text-white' : 'text-red-600 dark:text-red-400'}`}>
                                                        {money(r.our_revenue, currency, locale)}
                                                    </span>
                                                </Td>
                                                <Td>
                                                    <p className="text-sm text-zinc-600 dark:text-zinc-400">{fmtDate(r.delivered_at, isAr)}</p>
                                                    {r.is_paid_to_vendor && (
                                                        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">{isAr ? 'دُفع للتاجر' : 'vendor paid'}</p>
                                                    )}
                                                </Td>
                                                <Td align="right">
                                                    <span className="text-zinc-400">{isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
                                                </Td>
                                            </tr>

                                            {isOpen && (
                                                <tr className="bg-zinc-50 dark:bg-white/[0.02]">
                                                    <td colSpan={8} className="px-6 py-5">
                                                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                                            {/* Items */}
                                                            <div>
                                                                <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-2">
                                                                    {isAr ? 'الأصناف' : 'Items'}
                                                                </p>
                                                                <ul className="space-y-2">
                                                                    {r.items.map((it, i) => (
                                                                        <li key={i} className="text-sm">
                                                                            <div className="flex justify-between gap-3">
                                                                                <span className="text-zinc-800 dark:text-zinc-200 truncate">{it.title}</span>
                                                                                <Money value={it.line_total} currency={currency} className="text-sm shrink-0" />
                                                                            </div>
                                                                            <p className="text-xs text-zinc-500">
                                                                                {isAr ? `الكمية ${it.quantity}` : `qty ${it.quantity}`}
                                                                                {` · ${it.commission_rate || 0}% = `}
                                                                                <span className="text-emerald-600 dark:text-emerald-400">
                                                                                    {money(it.commission_amount, currency, locale)}
                                                                                </span>
                                                                            </p>
                                                                        </li>
                                                                    ))}
                                                                </ul>
                                                            </div>

                                                            {/* The money split */}
                                                            <div className="text-sm space-y-1.5">
                                                                <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-2">
                                                                    {isAr ? 'أين ذهبت الأموال' : 'Where the money went'}
                                                                </p>
                                                                <Split label={isAr ? 'قيمة البضاعة' : 'Merchandise'} value={r.merchandise} currency={currency} />
                                                                {r.coupon_total > 0 && (
                                                                    <>
                                                                        <Split label={isAr ? `كوبون على التاجر (${r.coupon_vendor_share_percent}% من الخصم)` : `Coupon, vendor's share (${r.coupon_vendor_share_percent}% of it)`} value={-r.coupon_vendor_share} currency={currency} tone="muted" />
                                                                        <Split label={isAr ? `كوبون علينا (${100 - r.coupon_vendor_share_percent}% من الخصم)` : `Coupon, our share (${100 - r.coupon_vendor_share_percent}% of it)`} value={-r.coupon_platform_share} currency={currency} tone="bad" />
                                                                    </>
                                                                )}
                                                                <Split label={isAr ? 'عمولتنا' : 'Our commission'} value={r.commission_charged} currency={currency} tone="good" />
                                                                {r.commission_reversed > 0 && (
                                                                    <Split label={isAr ? 'عمولة ملغاة بمرتجع' : 'Reversed by refund'} value={-r.commission_reversed} currency={currency} tone="bad" />
                                                                )}
                                                                <Split label={isAr ? 'صافي التاجر' : 'Vendor keeps'} value={r.vendor_net} currency={currency} tone="muted" />
                                                                <div className="pt-1.5 border-t border-zinc-200 dark:border-white/10">
                                                                    <Split label={isAr ? 'صافي عمولتنا' : 'Net commission'} value={r.commission_net} currency={currency} tone="good" bold />
                                                                </div>
                                                                <p className="text-[11px] text-zinc-400 pt-1 flex items-center gap-1.5">
                                                                    <CreditCard size={11} />
                                                                    {isAr ? 'الدفع: ' : 'Paid by '}{r.payment_method || '—'}
                                                                    {' · '}{isAr ? 'طُلب في ' : 'ordered '}{fmtDate(r.ordered_at, isAr)}
                                                                </p>
                                                            </div>

                                                            {/* Shipping — the one line that can go negative */}
                                                            <div className="text-sm space-y-1.5">
                                                                <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                                                                    <Truck size={12} />
                                                                    {isAr ? 'الشحن' : 'Shipping'}
                                                                </p>
                                                                <Split label={isAr ? 'محصّل من العميل' : 'Charged to customer'} value={r.shipping_charged} currency={currency} tone="good" />

                                                                {r.bosta_cost_breakdown ? (
                                                                    <>
                                                                        <Split label={isAr ? 'توصيل بوسطة' : 'Bosta delivery'} value={-r.bosta_cost_breakdown.send} currency={currency} tone="bad" />
                                                                        {r.bosta_cost_breakdown.extra_cod_fee > 0 && (
                                                                            <Split label={isAr ? 'رسوم تحصيل نقدي' : 'Extra COD fee'} value={-r.bosta_cost_breakdown.extra_cod_fee} currency={currency} tone="bad" />
                                                                        )}
                                                                        {r.bosta_cost_breakdown.pickup_share > 0 && (
                                                                            <Split label={isAr ? 'حصة رسوم الاستلام' : 'Pickup fee share'} value={-r.bosta_cost_breakdown.pickup_share} currency={currency} tone="bad" />
                                                                        )}
                                                                        {r.bosta_cost_breakdown.rto > 0 && (
                                                                            <Split label={isAr ? 'إرجاع للمصدر (رفض العميل)' : 'Return to origin (refused)'} value={-r.bosta_cost_breakdown.rto} currency={currency} tone="bad" />
                                                                        )}
                                                                    </>
                                                                ) : (
                                                                    <p className="text-xs text-zinc-500">{isAr ? 'لم تُسجَّل تكلفة شحن' : 'No shipping cost recorded'}</p>
                                                                )}

                                                                <div className="pt-1.5 border-t border-zinc-200 dark:border-white/10">
                                                                    <Split
                                                                        label={isAr ? 'هامش الشحن' : 'Shipping margin'}
                                                                        value={r.shipping_margin}
                                                                        currency={currency}
                                                                        tone={r.shipping_margin >= 0 ? 'good' : 'bad'}
                                                                        bold
                                                                    />
                                                                </div>

                                                                {r.shipping_cost_source === 'derived' && (
                                                                    <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5 pt-1">
                                                                        <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                                                                        {isAr
                                                                            ? 'التكلفة محسوبة من تعريفة بوسطة الحالية لأن الشحنة سُجّلت قبل حفظ التكاليف.'
                                                                            : 'Costed from today’s Bosta tariff — this parcel shipped before costs were being snapshotted.'}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </TableWrap>
                )}

                <Pagination pageSize={pageSize} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} page={data?.pagination?.page} pages={data?.pagination?.pages} total={data?.pagination?.total} onChange={setPage} isAr={isAr} />
            </div>
        </div>
    );
}

function Split({ label, value, currency, tone = 'neutral', bold = false }) {
    const colours = {
        good: 'text-emerald-600 dark:text-emerald-400',
        bad: 'text-red-600 dark:text-red-400',
        muted: 'text-zinc-500',
        neutral: 'text-zinc-800 dark:text-zinc-200',
    };
    return (
        <div className={`flex justify-between gap-3 ${bold ? 'font-black' : ''}`}>
            <span className="text-zinc-500">{label}</span>
            <span dir="ltr" className={`tabular-nums shrink-0 ${colours[tone]}`}>
                {value < 0 ? '−' : ''}{money(Math.abs(value), currency)}
            </span>
        </div>
    );
}
