'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from '../../../../../components/LocaleLink';
import { useApp } from '../../../../../context/AppContext';
import { adminFinanceApi } from '../../../../../lib/api';
import {
    CARD, INPUT, Money, StatCard, Spinner, EmptyState, TableWrap, Th, Td,
    money, fmtDate,
} from '../../../../../components/dashboard/finance/FinanceUI';
import {
    Store, Search, Wallet, Clock, AlertTriangle, CalendarClock,
    ChevronRight, CheckCircle2, Banknote,
} from 'lucide-react';
import useRowLink from '../../../../../lib/useRowLink';

/**
 * Screen 1 — every vendor and what we owe them.
 *
 * Sorted by what is payable, because the list exists to answer "who do I pay today?".
 * Overdue vendors are flagged rather than pulled to the top by default: the admin can sort
 * by due date when they want that view, and a list that silently reorders itself is harder
 * to work down.
 */
export default function FinanceVendorsPage() {
    const rowLink = useRowLink();
    const { language, siteSettings } = useApp();
    const isAr = language === 'ar';
    const currency = siteSettings?.currency || 'EGP';
    const locale = isAr ? 'ar-EG' : 'en-US';

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState('payable');
    const [onlyOwed, setOnlyOwed] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setData(await adminFinanceApi.getVendors({ search, sort, onlyOwed }));
        } catch (err) {
            setError(err.message || 'Failed to load vendor balances');
        } finally {
            setLoading(false);
        }
    }, [search, sort, onlyOwed]);

    // Debounced so typing a store name does not fire a request per keystroke.
    useEffect(() => {
        const t = setTimeout(load, search ? 350 : 0);
        return () => clearTimeout(t);
    }, [load]);

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

    const vendors = data?.vendors || [];
    const totals = data?.totals || {};
    const schedule = data?.global_schedule;

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <StatCard
                    label={isAr ? 'إجمالي المستحق' : 'Total payable now'}
                    value={totals.payable}
                    currency={currency}
                    icon={Wallet}
                    tone={totals.payable > 0 ? 'brand' : 'neutral'}
                    sub={isAr ? `${totals.vendors_owed} تاجر` : `${totals.vendors_owed} vendor(s)`}
                />
                <StatCard
                    label={isAr ? 'محتجز في فترة الإرجاع' : 'Held in return window'}
                    value={totals.held}
                    currency={currency}
                    icon={Clock}
                />
                <StatCard
                    label={isAr ? 'تجار متأخرون' : 'Overdue vendors'}
                    value={String(totals.overdue || 0)}
                    icon={AlertTriangle}
                    tone={totals.overdue > 0 ? 'loss' : 'neutral'}
                    sub={isAr ? 'تخطّوا موعد الدفع المجدول' : 'past their scheduled payout date'}
                />
                <StatCard
                    label={isAr ? 'الدفعة القادمة' : 'Next payout'}
                    value={schedule?.upcoming?.[0] ? fmtDate(schedule.upcoming[0], isAr) : (isAr ? 'يدوي' : 'Manual')}
                    icon={CalendarClock}
                    sub={isAr ? schedule?.label?.ar : schedule?.label?.en}
                />
            </div>

            <div className={CARD}>
                <div className="p-4 flex flex-col lg:flex-row lg:items-center gap-3 border-b border-zinc-100 dark:border-white/5">
                    <div className="relative flex-1 min-w-[220px]">
                        <Search size={16} className={`absolute top-1/2 -translate-y-1/2 text-zinc-400 ${isAr ? 'right-3' : 'left-3'}`} />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={isAr ? 'ابحث باسم المتجر أو البريد…' : 'Search store, owner or email…'}
                            className={`${INPUT} w-full ${isAr ? 'pr-9' : 'pl-9'}`}
                        />
                    </div>

                    <select value={sort} onChange={(e) => setSort(e.target.value)} className={INPUT}>
                        <option value="payable">{isAr ? 'الأعلى استحقاقًا' : 'Most payable'}</option>
                        <option value="due">{isAr ? 'الأقرب لموعد الدفع' : 'Due soonest'}</option>
                        <option value="held">{isAr ? 'الأعلى احتجازًا' : 'Most held'}</option>
                        <option value="paid">{isAr ? 'الأعلى دفعًا' : 'Most paid'}</option>
                        <option value="name">{isAr ? 'الاسم' : 'Name'}</option>
                    </select>

                    <label className="flex items-center gap-2 text-sm font-bold text-zinc-600 dark:text-zinc-400 cursor-pointer whitespace-nowrap">
                        <input
                            type="checkbox"
                            checked={onlyOwed}
                            onChange={(e) => setOnlyOwed(e.target.checked)}
                            className="w-4 h-4 rounded accent-marine-cyan"
                        />
                        {isAr ? 'المستحق فقط' : 'Only vendors we owe'}
                    </label>
                </div>

                {loading ? (
                    <Spinner />
                ) : vendors.length === 0 ? (
                    <EmptyState
                        icon={Store}
                        title={isAr ? 'لا يوجد تجار' : 'No vendors to show'}
                        message={isAr
                            ? 'لم تُسجَّل أي أرباح بعد، أو لا يطابق البحث أي تاجر.'
                            : 'No earnings have been recorded yet, or no vendor matches this search.'}
                    />
                ) : (
                    <TableWrap>
                        <table className="w-full min-w-[820px]">
                            <thead className="bg-zinc-50 dark:bg-white/[0.02] border-b border-zinc-100 dark:border-white/5">
                                <tr>
                                    <Th>{isAr ? 'التاجر' : 'Vendor'}</Th>
                                    <Th align="right">{isAr ? 'مستحق الآن' : 'Payable now'}</Th>
                                    <Th align="right">{isAr ? 'محتجز' : 'Held'}</Th>
                                    <Th align="right">{isAr ? 'مدفوع' : 'Paid'}</Th>
                                    <Th align="right">{isAr ? 'عمولتنا' : 'Our commission'}</Th>
                                    <Th>{isAr ? 'موعد الدفع' : 'Payout date'}</Th>
                                    <Th />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                {vendors.map((v) => (
                                    <tr key={v.vendor_id} {...rowLink(`/admin/dashboard/finance/vendors/${v.vendor_id}`)} className="hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors cursor-pointer">
                                        <Td>
                                            <div className="flex items-center gap-3">
                                                <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-marine-cyan/10 text-marine-primary flex items-center justify-center font-black shrink-0">
                                                    {(v.store_name || '?').charAt(0).toUpperCase()}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="font-bold text-zinc-900 dark:text-white truncate">{v.store_name}</p>
                                                    <p className="text-xs text-zinc-500 truncate">{v.owner_name || v.email}</p>
                                                </div>
                                                {v.status === 'suspended' && (
                                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-200 dark:bg-white/10 text-zinc-500 shrink-0">
                                                        {isAr ? 'موقوف' : 'SUSPENDED'}
                                                    </span>
                                                )}
                                            </div>
                                        </Td>

                                        <Td align="right">
                                            <span className={`font-black tabular-nums ${v.payable_amount > 0 ? 'text-marine-primary' : 'text-zinc-400'}`} dir="ltr">
                                                {money(v.payable_amount, currency, locale)}
                                            </span>
                                            {v.payable_count > 0 && (
                                                <p className="text-[11px] text-zinc-500">
                                                    {isAr ? `${v.payable_count} طلب` : `${v.payable_count} order${v.payable_count === 1 ? '' : 's'}`}
                                                </p>
                                            )}
                                        </Td>

                                        <Td align="right">
                                            <Money value={v.held_amount} currency={currency} muted className="text-sm" />
                                            {v.held_count > 0 && (
                                                <p className="text-[11px] text-zinc-400">
                                                    {isAr ? `${v.held_count} في الانتظار` : `${v.held_count} waiting`}
                                                </p>
                                            )}
                                        </Td>

                                        <Td align="right"><Money value={v.paid_amount} currency={currency} muted className="text-sm" /></Td>

                                        <Td align="right">
                                            <span dir="ltr" className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                                                {money(v.lifetime_commission, currency, locale)}
                                            </span>
                                        </Td>

                                        <Td>
                                            {v.payable_amount > 0 ? (
                                                <div className="flex items-center gap-1.5">
                                                    {v.is_overdue && <AlertTriangle size={14} className="text-red-500 shrink-0" />}
                                                    <span className={`text-sm ${v.is_overdue ? 'text-red-600 dark:text-red-400 font-bold' : 'text-zinc-600 dark:text-zinc-400'}`}>
                                                        {fmtDate(v.due_at, isAr)}
                                                    </span>
                                                </div>
                                            ) : (
                                                <span className="text-sm text-zinc-400">
                                                    {v.held_amount > 0 ? (isAr ? 'بانتظار فترة الإرجاع' : 'Awaiting window') : '—'}
                                                </span>
                                            )}
                                            {v.schedule?.source === 'vendor' && (
                                                <p className="text-[10px] text-amber-600 dark:text-amber-400 font-bold mt-0.5">
                                                    {isAr ? 'جدول خاص' : 'CUSTOM SCHEDULE'}
                                                </p>
                                            )}
                                        </Td>

                                        <Td align="right">
                                            <Link
                                                href={`/admin/dashboard/finance/vendors/${v.vendor_id}`}
                                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${v.payable_amount > 0
                                                    ? 'bg-marine-cyan hover:bg-marine-cyan-dark text-white'
                                                    : 'bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-white/10'
                                                    }`}
                                            >
                                                {v.payable_amount > 0
                                                    ? <><Banknote size={13} />{isAr ? 'دفع' : 'Pay'}</>
                                                    : <><CheckCircle2 size={13} />{isAr ? 'عرض' : 'View'}</>}
                                                <ChevronRight size={13} className={isAr ? 'rotate-180' : ''} />
                                            </Link>
                                        </Td>
                                    </tr>
                                ))}
                            </tbody>

                            <tfoot className="bg-zinc-50 dark:bg-white/[0.02] border-t-2 border-zinc-200 dark:border-white/10">
                                <tr>
                                    <Td className="font-black text-zinc-900 dark:text-white">{isAr ? 'الإجمالي' : 'Total'}</Td>
                                    <Td align="right"><span dir="ltr" className="font-black text-marine-primary tabular-nums">{money(totals.payable, currency, locale)}</span></Td>
                                    <Td align="right"><span dir="ltr" className="font-black text-zinc-600 dark:text-zinc-400 tabular-nums">{money(totals.held, currency, locale)}</span></Td>
                                    <Td align="right"><span dir="ltr" className="font-black text-zinc-600 dark:text-zinc-400 tabular-nums">{money(totals.paid, currency, locale)}</span></Td>
                                    <Td align="right"><span dir="ltr" className="font-black text-emerald-600 dark:text-emerald-400 tabular-nums">{money(totals.commission, currency, locale)}</span></Td>
                                    <Td colSpan={2} />
                                </tr>
                            </tfoot>
                        </table>
                    </TableWrap>
                )}
            </div>
        </div>
    );
}
