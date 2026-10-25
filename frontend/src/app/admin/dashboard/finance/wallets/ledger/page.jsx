'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from '../../../../../../components/LocaleLink';
import { useApp } from '../../../../../../context/AppContext';
import { adminFinanceApi } from '../../../../../../lib/api';
import {
    CARD, INPUT, LABEL, Money, Spinner, EmptyState, Pagination,
    money, fmtDateTime, TableWrap, Th, Td,
} from '../../../../../../components/dashboard/finance/FinanceUI';
import { Search, Download, X, ReceiptText, ShieldAlert, ArrowUpRight, ArrowDownRight, Pause } from 'lucide-react';
import usePageSize from '../../../../../../lib/usePageSize';
import useRowLink from '../../../../../../lib/useRowLink';
import Overlay from '../../../../../../components/Overlay';

/**
 * The wallet ledger — every movement, across every customer.
 *
 * The rows are immutable by construction: nothing in the app updates or deletes a wallet
 * transaction, and a correction is a new compensating row. So this screen is the audit
 * trail, not a view onto one — what it shows is what happened, in the order it happened.
 */

const TYPES = [
    { v: 'topup', ar: 'شحن رصيد', en: 'Top-up' },
    { v: 'purchase', ar: 'دفع طلب', en: 'Order payment' },
    { v: 'purchase_reserve', ar: 'حجز عند الدفع', en: 'Checkout hold' },
    { v: 'purchase_release', ar: 'رجوع الحجز', en: 'Hold released' },
    { v: 'purchase_refund', ar: 'استرداد طلب', en: 'Order refunded' },
    { v: 'refund_credit', ar: 'استرداد مرتجع', en: 'Return refunded' },
    { v: 'admin_credit', ar: 'إضافة يدوية', en: 'Manual credit' },
    { v: 'admin_debit', ar: 'خصم يدوي', en: 'Manual debit' },
];

const DIRECTION_STYLE = {
    credit: { icon: ArrowUpRight, cls: 'text-emerald-600', sign: '+' },
    debit: { icon: ArrowDownRight, cls: 'text-red-600', sign: '−' },
    hold: { icon: Pause, cls: 'text-amber-600', sign: '' },
};

const EMPTY = { search: '', type: '', actor: '', from: '', to: '', minAmount: '', maxAmount: '', sort: 'newest' };

export default function WalletLedgerPage() {
    const rowLink = useRowLink();
    const { language, siteSettings } = useApp();
    const isAr = language === 'ar';
    const currency = siteSettings?.currency || 'EGP';
    const locale = isAr ? 'ar-EG' : 'en-US';

    const [filters, setFilters] = useState(EMPTY);
    // Only the submitted filters drive the request, so typing in the search box does not
    // fire a query per keystroke against a ledger that only grows.
    const [applied, setApplied] = useState(EMPTY);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = usePageSize('admin.finance.walletLedger', 25);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [detail, setDetail] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setData(await adminFinanceApi.getWalletLedger({ ...applied, page, limit: pageSize }));
        } catch (err) {
            setError(err.message || 'Failed to load the ledger.');
        } finally {
            setLoading(false);
        }
    }, [applied, page, pageSize]);

    useEffect(() => { load(); }, [load]);

    const apply = () => { setPage(1); setApplied(filters); };
    const clear = () => { setFilters(EMPTY); setApplied(EMPTY); setPage(1); };
    const dirty = JSON.stringify(applied) !== JSON.stringify(EMPTY);

    const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                    <h2 className="text-lg font-black text-zinc-900 dark:text-white flex items-center gap-2">
                        <ReceiptText size={18} /> {isAr ? 'حركات المحافظ' : 'Wallet ledger'}
                    </h2>
                    <p className="text-xs text-zinc-500 mt-1">
                        {isAr
                            ? 'سجل ثابت — مفيش سطر بيتعدّل أو بيتمسح، والتصحيح بيتعمل بسطر جديد مقابل.'
                            : 'An immutable record — no row is ever edited or deleted; a correction is a new offsetting row.'}
                    </p>
                </div>
                <a
                    href={adminFinanceApi.walletLedgerExportUrl(applied)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-sm font-bold text-zinc-700 dark:text-zinc-200 hover:border-marine-cyan transition-colors"
                >
                    <Download size={15} /> {isAr ? 'تصدير CSV' : 'Export CSV'}
                </a>
            </div>

            {/* ─── Filters ─── */}
            <div className={`${CARD} p-4`}>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="lg:col-span-2">
                        <label className={LABEL}>{isAr ? 'بحث' : 'Search'}</label>
                        <div className="relative">
                            <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                            <input
                                type="text"
                                value={filters.search}
                                onChange={set('search')}
                                onKeyDown={(e) => e.key === 'Enter' && apply()}
                                placeholder={isAr ? 'اسم، تليفون، إيميل، سبب، أو مرجع' : 'Name, phone, email, reason or reference'}
                                className={`${INPUT} w-full ps-9`}
                            />
                        </div>
                    </div>
                    <div>
                        <label className={LABEL}>{isAr ? 'النوع' : 'Type'}</label>
                        <select value={filters.type} onChange={set('type')} className={`${INPUT} w-full`}>
                            <option value="">{isAr ? 'كل الأنواع' : 'All types'}</option>
                            {TYPES.map((t) => <option key={t.v} value={t.v}>{isAr ? t.ar : t.en}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className={LABEL}>{isAr ? 'مين عملها' : 'Made by'}</label>
                        <select value={filters.actor} onChange={set('actor')} className={`${INPUT} w-full`}>
                            <option value="">{isAr ? 'الكل' : 'Anyone'}</option>
                            <option value="system">{isAr ? 'النظام' : 'The system'}</option>
                            <option value="admin">{isAr ? 'الأدمن (يدوي)' : 'An admin (manual)'}</option>
                        </select>
                    </div>
                    <div>
                        <label className={LABEL}>{isAr ? 'من تاريخ' : 'From'}</label>
                        <input type="date" value={filters.from} onChange={set('from')} className={`${INPUT} w-full`} />
                    </div>
                    <div>
                        <label className={LABEL}>{isAr ? 'إلى تاريخ' : 'To'}</label>
                        <input type="date" value={filters.to} onChange={set('to')} className={`${INPUT} w-full`} />
                    </div>
                    <div>
                        <label className={LABEL}>{isAr ? 'مبلغ من' : 'Amount from'}</label>
                        <input type="number" min="0" step="any" value={filters.minAmount} onChange={set('minAmount')} className={`${INPUT} w-full`} />
                    </div>
                    <div>
                        <label className={LABEL}>{isAr ? 'الترتيب' : 'Sort'}</label>
                        <select value={filters.sort} onChange={set('sort')} className={`${INPUT} w-full`}>
                            <option value="newest">{isAr ? 'الأحدث' : 'Newest'}</option>
                            <option value="oldest">{isAr ? 'الأقدم' : 'Oldest'}</option>
                            <option value="largest">{isAr ? 'الأكبر مبلغاً' : 'Largest amount'}</option>
                            <option value="smallest">{isAr ? 'الأصغر مبلغاً' : 'Smallest amount'}</option>
                        </select>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-4">
                    <button onClick={apply} className="px-4 py-2 rounded-xl bg-marine-cyan text-white text-sm font-bold hover:bg-[#b91c1c] transition-colors">
                        {isAr ? 'تطبيق' : 'Apply'}
                    </button>
                    {dirty && (
                        <button onClick={clear} className="px-4 py-2 rounded-xl border border-zinc-200 dark:border-white/10 text-sm font-bold text-zinc-600 dark:text-zinc-300 inline-flex items-center gap-1.5">
                            <X size={14} /> {isAr ? 'مسح الفلاتر' : 'Clear'}
                        </button>
                    )}
                </div>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-bold">{error}</div>
            )}

            {loading ? (
                <div className="py-20 flex justify-center"><Spinner /></div>
            ) : !data || data.transactions.length === 0 ? (
                <EmptyState
                    icon={ReceiptText}
                    title={isAr ? 'مفيش حركات' : 'No movements'}
                    message={isAr ? 'مفيش حركة مطابقة للفلاتر دي.' : 'No wallet movement matches these filters.'}
                />
            ) : (
                <>
                    {/* Totals for the WHOLE filtered set, not the page on screen. */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        {[
                            [isAr ? 'داخل' : 'In', data.totals.credited, 'text-emerald-600'],
                            [isAr ? 'خارج' : 'Out', data.totals.debited, 'text-red-600'],
                            [isAr ? 'الصافي' : 'Net', data.totals.net, data.totals.net >= 0 ? 'text-emerald-600' : 'text-red-600'],
                            [isAr ? 'حجوزات' : 'Holds', data.totals.held, 'text-amber-600'],
                        ].map(([label, value, tone]) => (
                            <div key={label} className={`${CARD} p-3`}>
                                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide">{label}</p>
                                <p className={`text-lg font-black ${tone}`}>{money(value, currency, locale)}</p>
                            </div>
                        ))}
                    </div>
                    <p className="text-[11px] text-zinc-400 -mt-3">
                        {isAr
                            ? `الإجماليات دي لكل نتائج الفلتر (${data.pagination.total} حركة)، مش للصفحة المعروضة بس.`
                            : `These totals cover the whole filtered set (${data.pagination.total} movements), not just this page.`}
                    </p>

                    <div className={CARD}>
                        <TableWrap>
                            <table className="w-full min-w-[900px]">
                                <thead className="bg-zinc-50 dark:bg-white/[0.02] border-b border-zinc-100 dark:border-white/5">
                                    <tr>
                                        <Th>{isAr ? 'التاريخ' : 'Date'}</Th>
                                        <Th>{isAr ? 'العميل' : 'Customer'}</Th>
                                        <Th>{isAr ? 'النوع' : 'Type'}</Th>
                                        <Th align="right">{isAr ? 'المبلغ' : 'Amount'}</Th>
                                        <Th align="right">{isAr ? 'قبل' : 'Before'}</Th>
                                        <Th align="right">{isAr ? 'بعد' : 'After'}</Th>
                                        <Th>{isAr ? 'مين عملها' : 'By'}</Th>
                                        <Th />
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.transactions.map((t) => {
                                        const dir = DIRECTION_STYLE[t.direction];
                                        const DirIcon = dir.icon;
                                        const typeLabel = TYPES.find((x) => x.v === t.type);
                                        return (
                                            <tr key={t._id} {...rowLink(() => setDetail(t))} className="border-t border-zinc-100 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors cursor-pointer">
                                                <Td><span className="text-xs text-zinc-500 whitespace-nowrap">{fmtDateTime(t.created_at, isAr)}</span></Td>
                                                <Td>
                                                    {t.customer ? (
                                                        <Link href={`/admin/dashboard/users/${t.customer._id}`} className="font-bold text-zinc-900 dark:text-white hover:text-marine-primary transition-colors">
                                                            {t.customer.name}
                                                            <span className="block text-[10px] font-normal text-zinc-400">{t.customer.phone}</span>
                                                        </Link>
                                                    ) : <span className="text-zinc-400">—</span>}
                                                </Td>
                                                <Td>
                                                    <span className="text-xs text-zinc-600 dark:text-zinc-300 whitespace-nowrap">
                                                        {typeLabel ? (isAr ? typeLabel.ar : typeLabel.en) : t.type}
                                                    </span>
                                                </Td>
                                                <Td align="right">
                                                    <span className={`font-black whitespace-nowrap inline-flex items-center gap-1 ${dir.cls}`}>
                                                        <DirIcon size={13} />{dir.sign}{money(t.amount, currency, locale)}
                                                    </span>
                                                </Td>
                                                <Td align="right"><span className="text-xs text-zinc-400">{money(t.balance_before, currency, locale)}</span></Td>
                                                <Td align="right"><span className="text-xs font-bold text-zinc-700 dark:text-zinc-200">{money(t.balance_after, currency, locale)}</span></Td>
                                                <Td>
                                                    {t.is_manual ? (
                                                        <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 whitespace-nowrap">
                                                            <ShieldAlert size={10} /> {t.actor.label}
                                                        </span>
                                                    ) : (
                                                        <span className="text-[10px] text-zinc-400">{t.actor.label}</span>
                                                    )}
                                                </Td>
                                                <Td align="right">
                                                    <button onClick={() => setDetail(t)} className="text-[11px] font-bold text-marine-primary hover:underline whitespace-nowrap">
                                                        {isAr ? 'تفاصيل' : 'Details'}
                                                    </button>
                                                </Td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </TableWrap>
                    </div>

                    <Pagination
pageSize={pageSize} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}                         page={data.pagination.page}
                        pages={data.pagination.pages}
                        total={data.pagination.total}
                        onChange={setPage}
                        isAr={isAr}
                    />
                </>
            )}

            {/* ─── Detail drawer ─── */}
            {detail && (
                <Overlay className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4" onClick={() => setDetail(null)}>
                    <div
                        className="w-full sm:max-w-lg max-h-[85vh] overflow-y-auto bg-white dark:bg-[#14171A] rounded-t-2xl sm:rounded-2xl border border-zinc-200 dark:border-white/10 shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between p-4 border-b border-zinc-100 dark:border-white/5 sticky top-0 bg-white dark:bg-[#14171A]">
                            <p className="font-black text-zinc-900 dark:text-white">{isAr ? 'تفاصيل الحركة' : 'Movement detail'}</p>
                            <button onClick={() => setDetail(null)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-white"><X size={18} /></button>
                        </div>
                        <div className="p-4 space-y-2">
                            {[
                                [isAr ? 'رقم الحركة' : 'Transaction ID', String(detail._id)],
                                [isAr ? 'التاريخ' : 'Date', fmtDateTime(detail.created_at, isAr)],
                                [isAr ? 'العميل' : 'Customer', detail.customer ? `${detail.customer.name} · ${detail.customer.phone}` : '—'],
                                [isAr ? 'النوع' : 'Type', (() => { const x = TYPES.find((y) => y.v === detail.type); return x ? (isAr ? x.ar : x.en) : detail.type; })()],
                                [isAr ? 'المبلغ' : 'Amount', `${DIRECTION_STYLE[detail.direction].sign}${money(detail.amount, currency, locale)}`],
                                [isAr ? 'الرصيد قبل' : 'Balance before', money(detail.balance_before, currency, locale)],
                                [isAr ? 'الرصيد بعد' : 'Balance after', money(detail.balance_after, currency, locale)],
                                [isAr ? 'تغيّر المتاح' : 'Available delta', money(detail.deltas.available, currency, locale)],
                                [isAr ? 'تغيّر المحجوز' : 'Reserved delta', money(detail.deltas.reserved, currency, locale)],
                                [isAr ? 'السبب' : 'Reason', detail.reason || '—'],
                                [isAr ? 'مين عملها' : 'Made by', `${detail.actor.label} (${detail.actor.role})`],
                                [isAr ? 'يدوية؟' : 'Manual?', detail.is_manual ? (isAr ? 'أيوة — تسوية أدمن' : 'Yes — admin adjustment') : (isAr ? 'لأ — النظام' : 'No — system')],
                                [isAr ? 'المرجع' : 'Reference', detail.reference],
                            ].map(([k, v]) => (
                                <div key={k} className="flex items-start justify-between gap-4 py-1.5 border-b border-zinc-100 dark:border-white/5 last:border-0">
                                    <span className="text-xs text-zinc-500 shrink-0">{k}</span>
                                    <span className="text-xs font-bold text-zinc-900 dark:text-white text-end break-all">{v}</span>
                                </div>
                            ))}

                            {(detail.order_id || detail.topup_id || detail.refund_id) && (
                                <div className="pt-3 flex flex-wrap gap-2">
                                    {detail.order_id && (
                                        <Link href={`/admin/dashboard/orders/${detail.order_id}`} className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-200 hover:text-marine-primary">
                                            {isAr ? 'الطلب المرتبط' : 'Related order'}
                                        </Link>
                                    )}
                                    {detail.topup_id && (
                                        <span className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-white/5 text-zinc-500">
                                            {isAr ? 'شحنة رصيد' : 'Top-up'}: {String(detail.topup_id).slice(-8)}
                                        </span>
                                    )}
                                    {detail.refund_id && (
                                        <span className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-zinc-100 dark:bg-white/5 text-zinc-500">
                                            {isAr ? 'استرداد' : 'Refund'}: {String(detail.refund_id).slice(-8)}
                                        </span>
                                    )}
                                </div>
                            )}

                            <p className="text-[10px] text-zinc-400 pt-3">
                                {isAr
                                    ? 'المرجع هو هوية العملية — هو اللي بيمنع إن نفس الحركة تتسجل مرتين لو البوابة بعتت الرد مرتين، وهو اللي بترجع بيه أي تغيّر في الرصيد لمصدره.'
                                    : 'The reference is the movement\'s business identity — it is what stops the same movement being recorded twice when the gateway replies twice, and what traces any balance change back to its source.'}
                            </p>
                        </div>
                    </div>
                </Overlay>
            )}
        </div>
    );
}
