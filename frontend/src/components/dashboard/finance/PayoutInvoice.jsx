'use client';

import { PayoutStatusBadge, destinationText, CHANNEL_LABEL } from './PayoutBits';

/**
 * A payout as an invoice — what the vendor was paid for, order by order, what was deducted,
 * and where the money went. The same component serves the vendor and the admin, so both see
 * the same numbers; the lines are the snapshot taken when the payout was made.
 *
 * Printable as it stands: the surrounding page hides its own chrome with `print:hidden`.
 */
export default function PayoutInvoice({ data, isAr, currency = 'EGP' }) {
    const { invoice, vendor, lines = [], gateway } = data;
    const locale = isAr ? 'ar-EG' : 'en-US';
    const m = (n) => `${Number(n || 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
    const d = (v) => (v ? new Date(v).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

    return (
        <div className="bg-white dark:bg-[#09090b] text-zinc-900 dark:text-white rounded-2xl border border-zinc-200 dark:border-white/5 p-6 sm:p-8 print:border-0 print:p-0 print:bg-white print:text-black" dir={isAr ? 'rtl' : 'ltr'}>
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-6 border-b border-zinc-200 dark:border-white/10">
                <div>
                    <p className="text-2xl font-black tracking-tight">Ready Marine</p>
                    <p className="text-sm text-zinc-500">{isAr ? 'فاتورة تحويل مستحقات' : 'Payout invoice'}</p>
                </div>
                <div className="sm:text-end space-y-1">
                    <p className="font-mono font-black text-lg">{invoice.number}</p>
                    <p className="text-sm text-zinc-500">{isAr ? 'تاريخ الإصدار: ' : 'Issued: '}{d(invoice.issued_at)}</p>
                    {invoice.paid_at && <p className="text-sm text-zinc-500">{isAr ? 'تاريخ الدفع: ' : 'Paid: '}{d(invoice.paid_at)}</p>}
                    <PayoutStatusBadge status={invoice.status} isAr={isAr} unknown={gateway?.outcome_unknown} />
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 py-6 border-b border-zinc-200 dark:border-white/10 text-sm">
                <div>
                    <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-1">{isAr ? 'التاجر' : 'Vendor'}</p>
                    <p className="font-bold">{vendor?.store_name || '—'}</p>
                    <p className="text-zinc-500">{vendor?.name}</p>
                    {vendor?.email && <p className="text-zinc-500">{vendor.email}</p>}
                    {vendor?.phone && <p className="text-zinc-500" dir="ltr">{vendor.phone}</p>}
                </div>
                <div>
                    <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-1">{isAr ? 'اتحولت إلى' : 'Paid to'}</p>
                    <p className="font-bold break-all" dir="auto">{destinationText(invoice.destination, isAr) || '—'}</p>
                    {invoice.destination?.full_name && <p className="text-zinc-500">{invoice.destination.full_name}</p>}
                    <p className="text-zinc-500">
                        {isAr ? CHANNEL_LABEL[invoice.channel || 'manual'].ar : CHANNEL_LABEL[invoice.channel || 'manual'].en}
                        {invoice.payment_reference ? ` · ${isAr ? 'مرجع' : 'ref'} ${invoice.payment_reference}` : ''}
                    </p>
                </div>
            </div>

            {lines.length > 0 ? (
                <div className="py-6 overflow-x-auto">
                    <table className="w-full text-sm min-w-[560px]">
                        <thead>
                            <tr className="text-[11px] text-zinc-500 uppercase tracking-wide border-b border-zinc-200 dark:border-white/10">
                                <th className="text-start font-bold py-2">{isAr ? 'الطلب' : 'Order'}</th>
                                <th className="text-start font-bold py-2">{isAr ? 'التسليم' : 'Delivered'}</th>
                                <th className="text-end font-bold py-2">{isAr ? 'البضاعة' : 'Goods'}</th>
                                <th className="text-end font-bold py-2">{isAr ? 'العمولة' : 'Commission'}</th>
                                <th className="text-end font-bold py-2">{isAr ? 'خصومات' : 'Coupon / refunds'}</th>
                                <th className="text-end font-bold py-2">{isAr ? 'الصافي' : 'Net'}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                            {lines.map((l, i) => (
                                <tr key={l.earning_id || i}>
                                    <td className="py-2 font-mono text-xs">
                                        {l.reference}
                                        {l.paid_early && (
                                            <span className="ms-1.5 font-sans text-[10px] font-bold text-amber-600">
                                                {isAr ? 'قبل التسوية' : 'early'}
                                            </span>
                                        )}
                                    </td>
                                    <td className="py-2 text-zinc-500">{d(l.delivered_at)}</td>
                                    <td className="py-2 text-end tabular-nums" dir="ltr">{m(l.gross_amount)}</td>
                                    <td className="py-2 text-end tabular-nums text-zinc-500" dir="ltr">−{m(l.commission_amount)}</td>
                                    <td className="py-2 text-end tabular-nums text-zinc-500" dir="ltr">
                                        {(l.coupon_share || 0) + (l.reversed_net || 0) > 0 ? `−${m((l.coupon_share || 0) + (l.reversed_net || 0))}` : '—'}
                                    </td>
                                    <td className="py-2 text-end tabular-nums font-bold" dir="ltr">{m(l.amount)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <p className="py-6 text-sm text-zinc-500">
                    {isAr ? 'طلب سحب قديم لرصيد المحفظة — لا يحدد طلبات بعينها.' : 'An older withdrawal of the wallet balance — it names no particular orders.'}
                </p>
            )}

            <div className="flex justify-end">
                <div className="w-full sm:w-80 space-y-2 text-sm">
                    <div className="flex justify-between">
                        <span className="text-zinc-500">{isAr ? 'إجمالي صافي الطلبات' : 'Orders total'}</span>
                        <span className="tabular-nums" dir="ltr">{m(invoice.gross_amount)}</span>
                    </div>
                    {invoice.deductions > 0 && (
                        <div className="flex justify-between">
                            <span className="text-zinc-500">{isAr ? 'مستحق على المحفظة (مرتجعات مدفوعة / مستلزمات / سحب سابق)' : 'Owed by the wallet (refunds on paid orders, packaging, earlier withdrawals)'}</span>
                            <span className="tabular-nums text-red-600" dir="ltr">−{m(invoice.deductions)}</span>
                        </div>
                    )}
                    {invoice.deductions < 0 && (
                        <div className="flex justify-between">
                            <span className="text-zinc-500">{isAr ? 'رصيد لصالحك مش مربوط بطلبات' : 'Wallet credit not tied to any order'}</span>
                            <span className="tabular-nums text-emerald-600" dir="ltr">+{m(-invoice.deductions)}</span>
                        </div>
                    )}
                    <div className="flex justify-between pt-2 border-t border-zinc-200 dark:border-white/10 text-base font-black">
                        <span>{isAr ? 'المبلغ المحوّل' : 'Amount transferred'}</span>
                        <span className="tabular-nums" dir="ltr">{m(invoice.amount)}</span>
                    </div>
                    {invoice.channel === 'paymob' && (
                        <p className="text-[11px] text-zinc-400">
                            {isAr ? 'رسوم التحويل تتحملها Ready Marine — المبلغ يصل كاملًا.' : 'Transfer fees are paid by Ready Marine — the full amount is received.'}
                        </p>
                    )}
                </div>
            </div>

            {gateway?.transaction_id && (
                <p className="mt-6 text-[11px] text-zinc-400 break-all">
                    Paymob {isAr ? 'رقم العملية' : 'transaction'}: <span className="font-mono">{gateway.transaction_id}</span>
                    {gateway.status_description ? ` · ${gateway.status_description}` : ''}
                </p>
            )}
            {invoice.rejection_reason && (
                <p className="mt-4 text-sm text-red-600">{isAr ? 'سبب الرفض: ' : 'Rejected: '}{invoice.rejection_reason}</p>
            )}
        </div>
    );
}
