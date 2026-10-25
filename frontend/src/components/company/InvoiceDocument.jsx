'use client';

import { formatMoney, formatDate, formatMonth, invoiceStatusLabel } from '../../lib/companyLocalization';
import { usePortalTerms } from './OrgTermsContext';

/**
 * A company's monthly invoice as a printable page (feature 14, phase 4) — the same paper
 * for the company's managers and for the admin, saved as PDF from the browser's print
 * dialog (the vendor-report approach, which renders Arabic correctly).
 *
 * Always white, whatever the dashboard theme: it is a document, not a screen.
 */

const LINE_TITLE = {
    late_credit: { ar: 'مرتجع/إلغاء لأوردر من شهر سابق', en: 'Return/cancellation — earlier month' },
    late_charge: { ar: 'تحصيل على أوردر من شهر سابق', en: 'Charge — earlier month' },
    late_savings: { ar: 'توفير تجميع لأوردر من شهر سابق', en: 'Consolidation saving — earlier month' },
    shipping_difference: { ar: 'فرق شحن على الحساب', en: 'Shipping difference absorbed' },
    carried_credit: { ar: 'رصيد دائن من فاتورة سابقة', en: 'Credit carried from an earlier invoice' },
};
// The wallet of an account that used to pay from one: its balance off the invoice, or what it owed on it.
const walletLineTitle = (line, isAr) => (line.amount < 0
    ? (isAr ? 'رصيد المحفظة — مخصوم من الفاتورة' : 'Wallet balance, taken off this invoice')
    : (isAr ? 'مستحق على المحفظة' : 'Amount owed on the wallet'));

export default function InvoiceDocument({ invoice, isAr }) {
    const ot = usePortalTerms(isAr);
    if (!invoice) return null;
    const m = (v) => formatMoney(v, isAr);
    const lines = invoice.lines || [];
    const orderLines = lines.filter((l) => l.kind === 'order' || l.kind === 'car_order');
    const otherLines = lines.filter((l) => !(l.kind === 'order' || l.kind === 'car_order'));
    const t = invoice.totals || {};
    const bank = invoice.bank_details || {};
    const hasBank = bank.bank_name || bank.account_number || bank.iban;

    return (
        <div className="invoice-print bg-white text-zinc-900 rounded-2xl border border-zinc-200 p-6 sm:p-10 text-sm" dir={isAr ? 'rtl' : 'ltr'}>
            <div className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-zinc-900 pb-5">
                <div>
                    <p className="text-2xl font-black tracking-tight">Ready<span className="text-marine-primary">Car</span></p>
                    <p className="text-xs text-zinc-500 mt-1">{isAr ? 'كشف حساب / مطالبة — مش فاتورة ضريبية' : 'Statement of account — not a tax invoice'}</p>
                </div>
                <div className="text-end space-y-0.5">
                    <p className="text-lg font-black" dir="ltr">{invoice.number}</p>
                    <p className="font-bold">{isAr ? `فاتورة ${formatMonth(invoice.month, true)}` : `Invoice for ${formatMonth(invoice.month, false)}`}</p>
                    {invoice.contract_stage && (
                        <p className="text-xs font-black text-marine-primary">
                            {invoice.contract_stage === 'final'
                                ? (isAr ? 'فاتورة ختامية — نهاية التعاقد' : 'Final invoice — end of contract')
                                : (isAr ? 'كشف تسوية بعد نهاية التعاقد' : 'Settlement after the end of the contract')}
                        </p>
                    )}
                    <p className="text-xs text-zinc-600">{isAr ? 'تاريخ الإصدار: ' : 'Issued: '}{formatDate(invoice.issued_at, isAr)}</p>
                    <p className="text-xs text-zinc-600">{isAr ? 'آخر ميعاد للسداد: ' : 'Due by: '}<span className="font-bold text-zinc-900">{formatDate(invoice.due_at, isAr)}</span></p>
                    <p className="text-xs font-black mt-1">{invoiceStatusLabel(invoice.display_status, isAr)}</p>
                </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-6 py-5 border-b border-zinc-200">
                <div>
                    <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">{isAr ? 'فاتورة لـ' : 'Billed to'}</p>
                    <p className="font-black text-base mt-1">{invoice.company_snapshot?.name}</p>
                    {invoice.company_snapshot?.address && <p className="text-xs text-zinc-600 mt-0.5">{invoice.company_snapshot.address}</p>}
                    <p className="text-xs text-zinc-600 mt-0.5">
                        {[invoice.company_snapshot?.commercial_registration && `${isAr ? 'س.ت' : 'CR'} ${invoice.company_snapshot.commercial_registration}`,
                          invoice.company_snapshot?.tax_card && `${isAr ? 'ب.ض' : 'Tax card'} ${invoice.company_snapshot.tax_card}`].filter(Boolean).join(' · ')}
                    </p>
                </div>
                <div className="sm:text-end">
                    <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">{isAr ? 'المطلوب' : 'Amount due'}</p>
                    <p className="text-3xl font-black mt-1 tabular-nums" dir="ltr">{m(invoice.amount_due)}</p>
                    {invoice.amount_paid > 0 && (
                        <p className="text-xs text-zinc-600 mt-1">
                            {isAr ? 'اتدفع ' : 'Paid '}{m(invoice.amount_paid)} · {isAr ? 'المتبقي ' : 'Left '}<span className="font-black text-zinc-900">{m(invoice.balance)}</span>
                        </p>
                    )}
                </div>
            </div>

            <div className="mt-5 overflow-x-auto print:overflow-visible">
            <table className="w-full min-w-[640px] print:min-w-0 text-xs">
                <thead>
                    <tr className="border-b border-zinc-300 text-zinc-500">
                        <th className="py-2 text-start font-bold">{isAr ? 'التاريخ' : 'Date'}</th>
                        <th className="py-2 text-start font-bold">{isAr ? 'الأوردر' : 'Order'}</th>
                        <th className="py-2 text-start font-bold">{isAr ? 'لمين' : 'For'}</th>
                        <th className="py-2 text-end font-bold">{isAr ? 'اتحسب' : 'Charged'}</th>
                        <th className="py-2 text-end font-bold">{isAr ? 'توفير الشحن' : 'Shipping saved'}</th>
                        <th className="py-2 text-end font-bold">{isAr ? 'رجع' : 'Returned'}</th>
                        <th className="py-2 text-end font-bold">{isAr ? `على ${ot.the}` : `${ot.One} pays`}</th>
                    </tr>
                </thead>
                <tbody>
                    {orderLines.map((l, i) => (
                        <tr key={`o-${i}`} className="border-b border-zinc-100 align-top" style={{ pageBreakInside: 'avoid' }}>
                            <td className="py-2 whitespace-nowrap">{formatDate(l.date, isAr)}</td>
                            <td className="py-2 font-mono whitespace-nowrap" dir="ltr">{l.order_reference}</td>
                            <td className="py-2">{l.kind === 'car_order' ? `${isAr ? 'عربية' : 'Car'} ${l.car_label}` : l.name}</td>
                            <td className="py-2 text-end tabular-nums" dir="ltr">{m(l.charged)}</td>
                            <td className="py-2 text-end tabular-nums text-emerald-700" dir="ltr">{l.saved ? `− ${m(l.saved)}` : '—'}</td>
                            <td className="py-2 text-end tabular-nums" dir="ltr">{l.returned ? `− ${m(l.returned)}` : '—'}</td>
                            <td className="py-2 text-end tabular-nums font-bold" dir="ltr">{m(l.amount)}</td>
                        </tr>
                    ))}
                    {orderLines.length === 0 && (
                        <tr><td colSpan={7} className="py-3 text-zinc-500">{isAr ? 'مفيش أوردرات الشهر ده.' : 'No orders this month.'}</td></tr>
                    )}
                </tbody>
            </table>
            </div>

            {otherLines.length > 0 && (
                <table className="w-full mt-4 text-xs">
                    <tbody>
                        {otherLines.map((l, i) => (
                            <tr key={`x-${i}`} className="border-b border-zinc-100 align-top">
                                <td className="py-2">
                                    <span className="font-bold">{l.kind === 'wallet_balance' ? walletLineTitle(l, isAr) : (isAr ? LINE_TITLE[l.kind]?.ar : LINE_TITLE[l.kind]?.en) || l.kind}</span>
                                    {l.order_reference && <span className="font-mono text-zinc-500 ms-2" dir="ltr">{l.order_reference}</span>}
                                    {l.for_month && <span className="text-zinc-500 ms-2">({formatMonth(l.for_month, isAr)})</span>}
                                    {l.name && <span className="text-zinc-500 ms-2">— {l.name}</span>}
                                </td>
                                <td className="py-2 text-end tabular-nums font-bold whitespace-nowrap" dir="ltr">{m(l.amount)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            <div className="mt-5 flex justify-end">
                <dl className="w-full sm:w-80 text-xs space-y-1.5">
                    <Row label={isAr ? 'الأوردرات' : 'Orders'} value={m(t.orders)} />
                    {!!t.adjustments && <Row label={isAr ? 'تسويات شهور سابقة' : 'Earlier-month adjustments'} value={m(t.adjustments)} />}
                    {!!t.shipping_differences && <Row label={isAr ? 'فروق الشحن' : 'Shipping differences'} value={m(t.shipping_differences)} />}
                    {!!t.carried_credit && <Row label={isAr ? 'رصيد سابق' : 'Carried credit'} value={m(t.carried_credit)} />}
                    {!!t.wallet_balance && <Row label={isAr ? 'المحفظة' : 'Wallet'} value={m(t.wallet_balance)} />}
                    <div className="border-t-2 border-zinc-900 pt-2 flex justify-between font-black text-base">
                        <dt>{isAr ? 'الإجمالي' : 'Total'}</dt>
                        <dd className="tabular-nums" dir="ltr">{m(t.total)}</dd>
                    </div>
                    {t.total < 0 && (
                        <p className="text-[11px] text-zinc-600">{isAr ? 'الرصيد لصالحكم وهيتخصم من الفاتورة الجاية.' : 'The balance is in your favour and comes off the next invoice.'}</p>
                    )}
                </dl>
            </div>

            <div className="mt-6 grid sm:grid-cols-2 gap-4">
                {Number(t.shipping_savings) > 0 && (
                    <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
                        <p className="font-black text-emerald-800">{isAr ? `وفّرتوا ${m(t.shipping_savings)} في الشحن` : `You saved ${m(t.shipping_savings)} on shipping`}</p>
                        <p className="text-xs text-emerald-800/80 mt-1">{isAr ? `بتجميع الأوردرات على ${ot.theBranch} الشهر ده.` : `By consolidating orders to the ${ot.branch} this month.`}</p>
                    </div>
                )}
                {Number(t.employee_paid) > 0 && (
                    <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-4">
                        <p className="font-bold">{isAr ? `${ot.members} دفعوا ${m(t.employee_paid)} من جيبهم` : `${ot.Members} paid ${m(t.employee_paid)} themselves`}</p>
                        <p className="text-xs text-zinc-600 mt-1">{isAr ? `فوق الليميت — مش مطلوب من ${ot.the}.` : `Above their limits — not billed to the ${ot.one}.`}</p>
                    </div>
                )}
            </div>

            {hasBank && (
                <div className="mt-6 rounded-xl border border-zinc-300 p-4">
                    <p className="font-black mb-2">{isAr ? 'السداد بتحويل بنكي' : 'Pay by bank transfer'}</p>
                    <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
                        {bank.bank_name && <Row label={isAr ? 'البنك' : 'Bank'} value={bank.bank_name} />}
                        {bank.account_name && <Row label={isAr ? 'اسم الحساب' : 'Account name'} value={bank.account_name} />}
                        {bank.account_number && <Row label={isAr ? 'رقم الحساب' : 'Account number'} value={bank.account_number} ltr />}
                        {bank.iban && <Row label="IBAN" value={bank.iban} ltr />}
                    </dl>
                    <p className="text-xs text-zinc-600 mt-2">
                        {isAr ? `اكتبوا رقم الفاتورة ${invoice.number} في بيان التحويل.` : `Write invoice number ${invoice.number} as the transfer reference.`}
                        {bank.instructions ? ` ${bank.instructions}` : ''}
                    </p>
                </div>
            )}
        </div>
    );
}

function Row({ label, value, ltr = false }) {
    return (
        <div className="flex justify-between gap-3">
            <dt className="text-zinc-600">{label}</dt>
            <dd className="font-bold tabular-nums" dir={ltr ? 'ltr' : undefined}>{value}</dd>
        </div>
    );
}

/** Only the invoice reaches the printer — not the dashboard around it. */
export function InvoicePrintStyle() {
    return (
        <style>{`@media print {
            body * { visibility: hidden; }
            .invoice-print, .invoice-print * { visibility: visible; }
            .invoice-print { position: absolute; inset: 0 auto auto 0; width: 100%; border: 0 !important; border-radius: 0 !important; }
            @page { size: A4; margin: 12mm; }
        }`}</style>
    );
}
