'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from '../../../../../components/LocaleLink';
import { useApp } from '../../../../../context/AppContext';
import { adminFinanceApi } from '../../../../../lib/api';
import usePageSize from '../../../../../lib/usePageSize';
import {
    CARD, INPUT, Money, Spinner, EmptyState, TableWrap, Th, Td, Pagination, fmtDate, money,
} from '../../../../../components/dashboard/finance/FinanceUI';
import { PayoutStatusBadge, destinationText, CHANNEL_LABEL } from '../../../../../components/dashboard/finance/PayoutBits';
import { Banknote, AlertTriangle, RefreshCw, Landmark } from 'lucide-react';
import useRowLink from '../../../../../lib/useRowLink';

/**
 * Every transfer to a vendor — the invoice history.
 *
 * Admin transfers and vendor requests live in the same list because they are the same thing
 * once money moves. "Needs a look" isolates Paymob transfers whose outcome is still unknown
 * half an hour after sending: those are the only ones that need a human.
 */
export default function PayoutsPage() {
    const rowLink = useRowLink();
    const { language, siteSettings } = useApp();
    const isAr = language === 'ar';
    const currency = siteSettings?.currency || 'EGP';
    const locale = isAr ? 'ar-EG' : 'en-US';

    const [rows, setRows] = useState([]);
    const [pagination, setPagination] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');
    const [channel, setChannel] = useState('');
    const [needsReview, setNeedsReview] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = usePageSize('admin.finance.payouts', 25);

    const [budget, setBudget] = useState(null);
    const [budgetBusy, setBudgetBusy] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await adminFinanceApi.getPayouts({ status, channel, needsReview: needsReview ? 'true' : '', page, limit: pageSize });
            setRows(res.withdrawals || []);
            setPagination(res.pagination);
        } catch (err) {
            setError(err.message || 'Failed to load payouts');
        } finally {
            setLoading(false);
        }
    }, [status, channel, needsReview, page, pageSize]);

    useEffect(() => { load(); }, [load]);

    // Paymob allows 5 balance reads a minute, so it is read on demand rather than on load.
    const loadBudget = async () => {
        setBudgetBusy(true);
        try {
            setBudget(await adminFinanceApi.getPaymobBudget());
        } catch (err) {
            setBudget({ error: err.message });
        } finally {
            setBudgetBusy(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className={`${CARD} p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4`}>
                <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-red-50 dark:bg-marine-cyan/10 text-marine-primary flex items-center justify-center">
                        <Landmark size={20} />
                    </div>
                    <div>
                        <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">{isAr ? 'رصيدنا في Paymob Payouts' : 'Our Paymob Payouts balance'}</p>
                        {budget?.error ? (
                            <p className="text-sm text-red-600 dark:text-red-400 font-bold">{budget.error}</p>
                        ) : budget?.configured === false ? (
                            <p className="text-sm text-zinc-500">{isAr ? 'غير مُعد على السيرفر' : 'Not configured on the server'}</p>
                        ) : budget ? (
                            <p className="text-xl font-black text-zinc-900 dark:text-white" dir="ltr">
                                {money(budget.balance, budget.currency || currency, locale)}
                                {budget.environment === 'staging' && <span className="ms-2 text-xs text-amber-600 font-bold">STAGING</span>}
                            </p>
                        ) : (
                            <p className="text-sm text-zinc-500">—</p>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {/* Top-ups in, transfers and fees out: the account's statement, on the treasury screen. */}
                    <Link href="/admin/dashboard/finance/treasury#payouts-account"
                        className="px-4 py-2 rounded-xl text-sm font-bold text-marine-primary hover:bg-red-50 dark:hover:bg-marine-cyan/10">
                        {isAr ? 'كشف الحساب' : 'Statement'}
                    </Link>
                    <button onClick={loadBudget} disabled={budgetBusy}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-100 dark:bg-white/5 text-sm font-bold text-zinc-700 dark:text-zinc-300 disabled:opacity-50">
                        <RefreshCw size={15} className={budgetBusy ? 'animate-spin' : ''} />
                        {isAr ? 'اعرض الرصيد' : 'Check balance'}
                    </button>
                </div>
            </div>

            <div className={CARD}>
                <div className="p-4 flex flex-wrap items-center gap-3 border-b border-zinc-100 dark:border-white/5">
                    <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={INPUT}>
                        <option value="">{isAr ? 'كل الحالات' : 'All statuses'}</option>
                        {['pending', 'approved', 'processing', 'paid', 'failed', 'rejected', 'cancelled'].map((s) => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                    <select value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }} className={INPUT}>
                        <option value="">{isAr ? 'كل الطرق' : 'All channels'}</option>
                        <option value="paymob">Paymob</option>
                        <option value="manual">{isAr ? 'تحويل يدوي' : 'Manual'}</option>
                    </select>
                    <button onClick={() => { setNeedsReview(!needsReview); setPage(1); }}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold ${needsReview
                            ? 'bg-amber-500 text-white'
                            : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>
                        <AlertTriangle size={15} /> {isAr ? 'محتاج مراجعة' : 'Needs a look'}
                    </button>
                </div>

                {error ? (
                    <p className="p-6 text-red-600 dark:text-red-400 font-bold">{error}</p>
                ) : loading ? (
                    <Spinner />
                ) : rows.length === 0 ? (
                    <EmptyState icon={Banknote} title={isAr ? 'لا توجد تحويلات' : 'No payouts'} message={isAr ? 'لا شيء يطابق هذا الفلتر.' : 'Nothing matches this filter.'} />
                ) : (
                    <TableWrap>
                        <table className="w-full min-w-[860px]">
                            <thead className="bg-zinc-50 dark:bg-white/[0.02] border-b border-zinc-100 dark:border-white/5">
                                <tr>
                                    <Th>{isAr ? 'الفاتورة' : 'Invoice'}</Th>
                                    <Th>{isAr ? 'التاجر' : 'Vendor'}</Th>
                                    <Th>{isAr ? 'الطريقة' : 'Channel'}</Th>
                                    <Th align="right">{isAr ? 'المبلغ' : 'Amount'}</Th>
                                    <Th>{isAr ? 'التاريخ' : 'Date'}</Th>
                                    <Th>{isAr ? 'الحالة' : 'Status'}</Th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                {rows.map((p) => (
                                    <tr key={p._id} {...rowLink(`/admin/dashboard/finance/payouts/${p._id}`)} className="hover:bg-zinc-50 dark:hover:bg-white/[0.02] cursor-pointer">
                                        <Td>
                                            <Link href={`/admin/dashboard/finance/payouts/${p._id}`} className="font-mono text-xs font-bold text-marine-primary hover:underline">
                                                {p.withdrawal_number}
                                            </Link>
                                            <p className="text-[11px] text-zinc-500">
                                                {p.initiated_by === 'vendor' ? (isAr ? 'طلب من التاجر' : 'vendor request') : (isAr ? 'تحويل من الإدارة' : 'admin transfer')}
                                            </p>
                                        </Td>
                                        <Td>
                                            {p.vendor_id?._id ? (
                                                <Link href={`/admin/dashboard/finance/vendors/${p.vendor_id._id}`} className="font-bold text-zinc-900 dark:text-white hover:underline">
                                                    {p.vendor_id.store_name}
                                                </Link>
                                            ) : '—'}
                                        </Td>
                                        <Td>
                                            <p className="text-sm text-zinc-700 dark:text-zinc-300">{isAr ? CHANNEL_LABEL[p.channel || 'manual'].ar : CHANNEL_LABEL[p.channel || 'manual'].en}</p>
                                            {p.channel === 'paymob' && p.payout_method?.issuer && (
                                                <p className="text-[11px] text-zinc-500">{destinationText({ label: null, issuer: p.payout_method.issuer, bank_name: p.payout_method.bank_name }, isAr)}</p>
                                            )}
                                        </Td>
                                        <Td align="right">
                                            <Money value={p.amount} currency={currency} />
                                            {p.deductions > 0 && (
                                                <p className="text-[11px] text-zinc-500" dir="ltr">{isAr ? 'بعد خصم ' : 'after −'}{money(p.deductions, currency, locale)}</p>
                                            )}
                                            {p.deductions < 0 && (
                                                <p className="text-[11px] text-emerald-600" dir="ltr">{isAr ? 'شامل رصيد ' : 'incl. credit +'}{money(-p.deductions, currency, locale)}</p>
                                            )}
                                        </Td>
                                        <Td><p className="text-sm text-zinc-600 dark:text-zinc-400">{fmtDate(p.paid_at || p.created_at, isAr)}</p></Td>
                                        <Td>
                                            <PayoutStatusBadge status={p.status} isAr={isAr} unknown={p.gateway?.outcome_unknown} />
                                            {p.gateway?.needs_review && (
                                                <p className="text-[11px] text-amber-600 dark:text-amber-400 font-bold mt-1">{isAr ? 'محتاج مراجعة' : 'Needs a look'}</p>
                                            )}
                                        </Td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </TableWrap>
                )}

                <Pagination pageSize={pageSize} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} page={pagination?.page} pages={pagination?.pages} total={pagination?.total} onChange={setPage} isAr={isAr} />
            </div>
        </div>
    );
}
