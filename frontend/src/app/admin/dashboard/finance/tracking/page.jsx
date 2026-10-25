'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useApp } from '../../../../../context/AppContext';
import { adminFinanceApi } from '../../../../../lib/api';
import usePageSize from '../../../../../lib/usePageSize';
import {
    CARD, Money, StatCard, DateRangeFilter, Spinner, EmptyState, TableWrap, Th, Td, Pagination,
    fmtDate, toInputDate,
} from '../../../../../components/dashboard/finance/FinanceUI';
import {
    FileSpreadsheet, Download, ClipboardList, Wallet, TrendingUp, Landmark, Store, Info, AlertTriangle,
} from 'lucide-react';

/**
 * The tracking report — the finance team's order-by-order sheet, on screen and as Excel.
 *
 * One row per order that FINISHED inside the period (every parcel delivered, cancelled or
 * refused, the last of them inside the dates). Two figures belong to the period rather than
 * to any order — money that reached our bank, money we sent to vendors — so they sit above
 * the table instead of being repeated down every row. The export reproduces the team's own
 * layout, with those two as merged cells beside the table.
 */
export default function TrackingReportPage() {
    const { language, siteSettings } = useApp();
    const isAr = language === 'ar';
    const currency = siteSettings?.currency || 'EGP';

    const [range, setRange] = useState(() => {
        const now = new Date();
        return { from: toInputDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: toInputDate(now) };
    });
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = usePageSize('admin.finance.tracking', 25);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await adminFinanceApi.getTrackingReport({ ...range, language: isAr ? 'ar' : 'en' });
            setReport(res.report);
        } catch (err) {
            setError(err.message || (isAr ? 'تعذر تحميل التقرير' : 'Could not load the report'));
        } finally {
            setLoading(false);
        }
    }, [range.from, range.to, isAr]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { setPage(1); }, [range.from, range.to, pageSize]);

    // A plain link to the export: the server sends the file as an attachment and the
    // browser saves it natively — the one way that works in every browser, including the
    // in-app ones on iPhone.
    const exportUrl = adminFinanceApi.trackingReportExportUrl(range);

    const rows = report?.rows || [];
    const totals = report?.totals || {};
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    const visible = useMemo(() => rows.slice((page - 1) * pageSize, page * pageSize), [rows, page, pageSize]);

    const statusTone = (s) => ({
        delivered: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
        partial: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
        cancelled: 'bg-zinc-100 text-zinc-600 dark:bg-white/5 dark:text-zinc-400',
        refused: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
    }[s] || 'bg-zinc-100 text-zinc-600');

    // The template's 21 per-order columns (V and W are period figures, shown as cards).
    const COLS = [
        { key: 'order_number', ar: 'رقم الطلب', en: 'Order' },
        { key: 'customer_name', ar: 'اسم العميل', en: 'Customer' },
        { key: 'ordered_at', ar: 'تاريخ الطلب', en: 'Ordered', date: true },
        { key: 'last_delivered_at', ar: 'تاريخ اخر استلام', en: 'Last delivered', date: true },
        { key: 'status_label', ar: 'حالة الطلب', en: 'Status', status: true },
        { key: 'merchandise', ar: 'مبلغ الطلب', en: 'Order amount', money: true },
        { key: 'coupon', ar: 'خصم', en: 'Discount', money: true },
        { key: 'loyalty', ar: 'ولاء العملاء', en: 'Loyalty', money: true },
        { key: 'net', ar: 'صافي الطلب', en: 'Net', money: true },
        { key: 'shipping', ar: 'قيمة الشحن', en: 'Shipping charged', money: true },
        { key: 'total', ar: 'الإجمالي', en: 'Total', money: true, bold: true },
        { key: 'commission', ar: 'عمولة ريدي مارين', en: 'Commission', money: true },
        { key: 'vendor_net', ar: 'صافي التاجر', en: 'Vendor net', money: true },
        { key: 'shipping_cost', ar: 'تكلفة الشحن', en: 'Shipping cost', money: true },
        { key: 'shipping_margin', ar: 'هامش الشحن', en: 'Shipping margin', money: true, signed: true },
        { key: 'profit', ar: 'إجمالي ربح ريدي مارين', en: 'Ready Marine profit', money: true, signed: true, bold: true },
        { key: 'payment_method', ar: 'طريقة الدفع', en: 'Payment' },
        { key: 'collector', ar: 'الجهة المسؤولة عن التحصيل', en: 'Collected by' },
        { key: 'collected', ar: 'المبلغ المحصل', en: 'Collected', money: true },
        { key: 'collection_fee', ar: 'عمولة التحصيل', en: 'Collection fee', money: true },
    ];

    const bank = report?.transfers?.to_bank;
    const vendors = report?.transfers?.to_vendors;

    return (
        <div className="space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
                <div>
                    <h2 className="text-lg font-black text-zinc-900 dark:text-white flex items-center gap-2">
                        <FileSpreadsheet size={18} className="text-marine-primary" />
                        {isAr ? 'تقرير التتبع' : 'Tracking report'}
                    </h2>
                    <p className="text-sm text-zinc-500 mt-1">
                        {isAr
                            ? 'الطلبات المنفّذة خلال الفترة بس — اللي كل طرودها اتسلمت أو اتلغت أو رجعت، وآخر حدث فيها جوه الفترة.'
                            : 'Only orders executed within the period — every parcel delivered, cancelled or returned, the last of them inside the dates.'}
                    </p>
                    <p className="text-xs text-zinc-400 mt-1">
                        {isAr
                            ? 'ملف الإكسل فيه شيتين: تقرير التتبع للفترة، و«تحليل المبيعات والمدفوعات» — تراكمي لحد آخر يوم في الفترة.'
                            : 'The Excel file has two sheets: this report for the period, and "Sales & payments analysis" — cumulative to the last day of the period.'}
                    </p>
                </div>
                <a
                    href={exportUrl}
                    download={`readycar-tracking-report_${range.from || 'start'}_${range.to || 'today'}.xlsx`}
                    className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shrink-0"
                >
                    <Download size={16} />
                    {isAr ? 'تصدير إلى إكسل' : 'Export to Excel'}
                </a>
            </div>

            <DateRangeFilter from={range.from} to={range.to} onChange={setRange} isAr={isAr} />

            {error && (
                <div className="flex items-center gap-2 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm">
                    <AlertTriangle size={15} /> {error}
                </div>
            )}

            {loading ? (
                <Spinner className="py-20" />
            ) : !report ? null : (
                <>
                    <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
                        <StatCard label={isAr ? 'طلبات منفّذة' : 'Orders executed'} value={String(totals.orders || 0)} icon={ClipboardList} />
                        <StatCard label={isAr ? 'المبلغ المحصل' : 'Collected'} value={totals.collected || 0} currency={currency} icon={Wallet} />
                        <StatCard
                            label={isAr ? 'ربح ريدي مارين' : 'Ready Marine profit'}
                            value={totals.profit || 0}
                            currency={currency}
                            icon={TrendingUp}
                            tone={(totals.profit || 0) >= 0 ? 'profit' : 'loss'}
                            hint={isAr ? 'الإجمالي − صافي التاجر − تكلفة الشحن − عمولة التحصيل' : 'Total − vendor net − shipping cost − collection fee'}
                        />
                        <StatCard
                            label={isAr ? 'مبلغ التحويل للبنك' : 'Transferred to our bank'}
                            value={bank?.amount || 0}
                            currency={currency}
                            icon={Landmark}
                            tone="brand"
                            sub={(bank?.breakdown || []).length
                                ? bank.breakdown.map((b) => `${b.label}: ${b.amount}`).join(' · ')
                                : (isAr ? 'مفيش تحويلات مسجلة في الفترة' : 'No transfers recorded in the period')}
                            hint={isAr ? 'الأموال المحوّلة لريدي مارين خلال الفترة فقط' : 'Money transferred to Ready Marine within the period only'}
                        />
                        <StatCard
                            label={isAr ? 'مبلغ التحويل للتاجر' : 'Transferred to vendors'}
                            value={vendors?.amount || 0}
                            currency={currency}
                            icon={Store}
                            sub={isAr ? `${vendors?.count || 0} تحويل` : `${vendors?.count || 0} payout(s)`}
                            hint={isAr ? 'الأموال المحوّلة للتجار خلال الفترة فقط' : 'Money paid out to vendors within the period only'}
                        />
                    </div>

                    {report.truncated && (
                        <p className="text-sm text-amber-600 flex items-center gap-2">
                            <AlertTriangle size={14} />
                            {isAr ? 'التقرير اتقصّ عند 5000 طلب — ضيّق الفترة.' : 'Capped at 5,000 orders — narrow the period.'}
                        </p>
                    )}

                    {rows.length === 0 ? (
                        <EmptyState
                            icon={ClipboardList}
                            title={isAr ? 'مفيش طلبات منفّذة في الفترة دي' : 'No orders executed in this period'}
                            message={isAr ? 'جرّب فترة أوسع.' : 'Try a wider period.'}
                        />
                    ) : (
                        <div className={CARD}>
                            <TableWrap>
                                <table className="w-full text-sm whitespace-nowrap">
                                    <thead className="bg-zinc-50 dark:bg-white/[0.02]">
                                        <tr>
                                            <Th>{isAr ? 'م' : '#'}</Th>
                                            {COLS.map((c) => (
                                                <Th key={c.key} align={c.money ? 'right' : 'left'}>{isAr ? c.ar : c.en}</Th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                        {visible.map((r, i) => (
                                            <tr key={r.order_id} className="hover:bg-zinc-50/60 dark:hover:bg-white/[0.02]">
                                                <Td className="text-xs text-zinc-400">{(page - 1) * pageSize + i + 1}</Td>
                                                {COLS.map((c) => (
                                                    <Td key={c.key} align={c.money ? 'right' : 'left'}>
                                                        {c.status ? (
                                                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold ${statusTone(r.status)}`}>{r.status_label}</span>
                                                        ) : c.date ? (
                                                            <span className="text-xs text-zinc-600 dark:text-zinc-400">{r[c.key] ? fmtDate(r[c.key], isAr) : '—'}</span>
                                                        ) : c.money ? (
                                                            <Money value={r[c.key]} currency={currency} signed={c.signed} className={`text-sm ${c.bold ? 'font-black' : ''}`} />
                                                        ) : (
                                                            <span className={`text-sm ${c.key === 'order_number' ? 'font-bold text-zinc-900 dark:text-white' : 'text-zinc-700 dark:text-zinc-300'}`}>{r[c.key] || '—'}</span>
                                                        )}
                                                    </Td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot className="bg-zinc-50 dark:bg-white/[0.02] border-t-2 border-zinc-200 dark:border-white/10">
                                        <tr>
                                            <Td />
                                            {COLS.map((c, i) => (
                                                <Td key={c.key} align={c.money ? 'right' : 'left'}>
                                                    {i === 0
                                                        ? <span className="font-black text-zinc-900 dark:text-white">{isAr ? 'الإجمالي' : 'Total'}</span>
                                                        : c.money
                                                            ? <Money value={totals[c.key] || 0} currency={currency} signed={c.signed} className="text-sm font-black" />
                                                            : null}
                                                </Td>
                                            ))}
                                        </tr>
                                    </tfoot>
                                </table>
                            </TableWrap>
                            <Pagination
                                page={page}
                                pages={pages}
                                total={rows.length}
                                onChange={setPage}
                                isAr={isAr}
                                pageSize={pageSize}
                                onPageSizeChange={setPageSize}
                            />
                        </div>
                    )}

                    <div className={`${CARD} p-4 text-xs text-zinc-500 space-y-1.5`}>
                        <p className="font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5"><Info size={13} /> {isAr ? 'طريقة الحساب' : 'How it is calculated'}</p>
                        <p>{isAr ? '• المبالغ محسوبة على الطرود المسلّمة. الطلب الملغي بيظهر بتكلفته الفعلية بس، والطرد المرفوض بتكلفة الذهاب والرجوع.' : '• Money counts delivered parcels. A cancelled order shows only what it really cost; a refused parcel carries its outbound and return legs.'}</p>
                        <p>{isAr ? '• الخصم = إجمالي خصم الكوبون؛ نصيب التاجر منه داخل في صافي التاجر، ونصيب ريدي مارين داخل في الربح.' : "• Discount is the whole coupon; the vendor's share is inside vendor net, ours is inside profit."}</p>
                        <p>{isAr ? '• عمولة التحصيل: الدفع عند الاستلام = رسوم التحصيل عند شركة الشحن، البطاقة = عمولة بوابة الدفع، المحفظة = صفر.' : '• Collection fee: cash on delivery = the courier\'s COD fee, card = the gateway\'s cut, wallet = nothing.'}</p>
                        <p>{isAr ? '• العمولة وصافي التاجر = المسجلين وقت التسليم؛ المرتجعات بعد التسليم في شاشة المرتجعات.' : '• Commission and vendor net are as recorded at delivery; returns after delivery are on the refunds screen.'}</p>
                    </div>
                </>
            )}
        </div>
    );
}
