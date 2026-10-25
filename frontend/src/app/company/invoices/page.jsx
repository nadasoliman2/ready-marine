'use client';

import { useEffect, useState } from 'react';
import Link from '../../../components/LocaleLink';
import { Receipt, Clock, AlertTriangle, ArrowLeft, ArrowRight } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { companyPortalApi } from '../../../lib/api';
import {
    formatMoney, formatDate, formatMonth, invoiceStatusLabel, invoiceStatusClass, errorText,
} from '../../../lib/companyLocalization';
import {
    CARD, PageHeader, Notice, Spinner, EmptyState, TableWrap, Th, Td, Pill, StatCard,
} from '../../../components/company/CompanyUI';
import { usePortalTerms } from '../../../components/company/OrgTermsContext';
import useRowLink from '../../../lib/useRowLink';

/**
 * The company's invoices (feature 14, phase 4): one per month, issued on the 1st of the
 * next month for every order placed in it. What is still collecting this month is shown above
 * the list, so the next invoice is never a surprise.
 */
export default function CompanyInvoicesPage() {
    const rowLink = useRowLink();
    const { language } = useApp();
    const isAr = language === 'ar';
    const ot = usePortalTerms(isAr);
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const Arrow = isAr ? ArrowLeft : ArrowRight;

    useEffect(() => {
        companyPortalApi.getInvoices().then(setData).catch((err) => setError(errorText(err, isAr)));
    }, [isAr]);

    if (!data) return error ? <Notice>{error}</Notice> : <Spinner />;

    return (
        <div>
            <PageHeader
                title={isAr ? 'الفواتير' : 'Invoices'}
                subtitle={isAr
                    ? 'فاتورة واحدة لكل شهر، بتصدر أول يوم في الشهر اللي بعده بكل الأوردرات اللي اتطلبت فيه. السداد بتحويل بنكي.'
                    : 'One invoice per month, issued on the 1st of the next month for every order placed in it. Paid by bank transfer.'}
            />
            {error && <Notice onClose={() => setError('')}>{error}</Notice>}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <StatCard label={isAr ? 'المتبقي عليكم' : 'Outstanding'} value={formatMoney(data.totals.outstanding, isAr)} icon={Receipt} tone={data.totals.outstanding > 0 ? 'warn' : 'neutral'} />
                <StatCard label={isAr ? 'متأخر' : 'Overdue'} value={formatMoney(data.totals.overdue, isAr)} icon={AlertTriangle} tone={data.totals.overdue > 0 ? 'loss' : 'neutral'} />
                <StatCard label={isAr ? 'اتدفع لحد دلوقتي' : 'Paid so far'} value={formatMoney(data.totals.paid, isAr)} tone="profit" />
            </div>

            {data.pending_months.length > 0 && (
                <div className="grid md:grid-cols-2 gap-4 mb-6">
                    {data.pending_months.map((m) => (
                        <div key={m.month} className={`${CARD} p-5`}>
                            <div className="flex items-center justify-between gap-3">
                                <p className="font-black text-zinc-900 dark:text-white">{formatMonth(m.month, isAr)}</p>
                                <Pill className="bg-zinc-100 text-zinc-600 dark:bg-white/5 dark:text-zinc-300">{invoiceStatusLabel(m.state, isAr)}</Pill>
                            </div>
                            <p className="text-2xl font-black mt-2 tabular-nums" dir="ltr">{formatMoney(m.completed_total ?? m.running_total, isAr)}</p>
                            <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1.5">
                                <Clock size={12} />
                                {m.state === 'collecting'
                                    ? (isAr ? 'أوردرات مكتملة لحد دلوقتي — الفاتورة بتصدر أول يوم في الشهر الجاي.' : 'Completed orders so far — the invoice is issued on the 1st of next month.')
                                    : (isAr ? 'هتصدر خلال ساعات.' : 'Issuing within hours.')}
                            </p>
                            {m.waiting_total > 0 && (
                                <p className="text-xs text-zinc-500 mt-1.5">
                                    {isAr
                                        ? `+ ${formatMoney(m.waiting_total, true)} على ${m.waiting_orders} أوردر لسه ماوصلش — بيتفوتر في الشهر اللي يوصل فيه.`
                                        : `+ ${formatMoney(m.waiting_total, false)} on ${m.waiting_orders} order(s) not delivered yet — invoiced in the month they arrive.`}
                                </p>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {data.invoices.length === 0 ? (
                <EmptyState icon={Receipt} title={isAr ? 'لسه مفيش فواتير' : 'No invoices yet'} message={isAr ? `أول فاتورة بتصدر بعد أول شهر فيه أوردرات اتسلّمت على حساب ${ot.the}.` : `The first invoice is issued after the first month with ${ot.one} orders.`} />
            ) : (
                <TableWrap>
                    <thead>
                        <tr>
                            <Th align="start">{isAr ? 'الفاتورة' : 'Invoice'}</Th>
                            <Th align="start">{isAr ? 'الشهر' : 'Month'}</Th>
                            <Th align="start">{isAr ? 'المطلوب' : 'Due'}</Th>
                            <Th align="start">{isAr ? 'اتدفع' : 'Paid'}</Th>
                            <Th align="start">{isAr ? 'المتبقي' : 'Left'}</Th>
                            <Th align="start">{isAr ? 'آخر ميعاد' : 'Due date'}</Th>
                            <Th align="start">{isAr ? 'الحالة' : 'Status'}</Th>
                            <Th align="start" />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                        {data.invoices.map((inv) => (
                            <tr key={inv._id} {...rowLink(`/company/invoices/${inv._id}`)} className="hover:bg-zinc-50 dark:hover:bg-white/[0.02] cursor-pointer">
                                <Td align="start" className="font-mono font-bold"><span dir="ltr">{inv.number}</span></Td>
                                <Td align="start">{formatMonth(inv.month, isAr)}{inv.contract_stage && <span className="block text-[11px] font-bold text-marine-primary">{inv.contract_stage === 'final' ? (isAr ? 'ختامية' : 'Final') : (isAr ? 'تسوية بعد النهاية' : 'After the end')}</span>}</Td>
                                <Td align="start" className="tabular-nums"><span dir="ltr">{formatMoney(inv.amount_due, isAr)}</span></Td>
                                <Td align="start" className="tabular-nums"><span dir="ltr">{formatMoney(inv.amount_paid, isAr)}</span></Td>
                                <Td align="start" className="tabular-nums font-bold"><span dir="ltr">{formatMoney(inv.balance, isAr)}</span></Td>
                                <Td align="start">
                                    {formatDate(inv.due_at, isAr)}
                                    {inv.days_overdue > 0 && <span className="block text-[11px] text-red-600 dark:text-red-400">{isAr ? `متأخرة ${inv.days_overdue} يوم` : `${inv.days_overdue} day(s) late`}</span>}
                                </Td>
                                <Td align="start">
                                    <Pill className={invoiceStatusClass(inv.display_status)}>{invoiceStatusLabel(inv.display_status, isAr)}</Pill>
                                    {inv.pending_receipts > 0 && <span className="block text-[11px] text-amber-600 mt-1">{isAr ? 'إيصال مستني تأكيد' : 'Receipt awaiting confirmation'}</span>}
                                </Td>
                                <Td align="start">
                                    <Link href={`/company/invoices/${inv._id}`} className="inline-flex items-center gap-1 text-sm font-bold text-marine-primary hover:underline">
                                        {isAr ? 'افتح' : 'Open'} <Arrow size={14} />
                                    </Link>
                                </Td>
                            </tr>
                        ))}
                    </tbody>
                </TableWrap>
            )}
        </div>
    );
}
