'use client';

import { useMemo, useState } from 'react';
import { FileSpreadsheet, ShoppingBag, Car, User, RotateCcw, Building2 } from 'lucide-react';
import { formatMoney, formatMonth, formatDate } from '../../lib/companyLocalization';
import { CARD, INPUT, Button, StatCard, EmptyState, TableWrap, Th, Td, Pill } from './CompanyUI';
import { usePortalTerms } from './OrgTermsContext';

/**
 * One month of a company's account — who took what, for how much, and when —
 * shared by the company portal and the admin's company page. Every figure comes
 * from the ledger the server keeps; nothing is added up here except the
 * client-side filter by person.
 */
export default function PurchasesView({ data, isAr, month, onMonthChange, onExport }) {
    const ot = usePortalTerms(isAr);
    const [tab, setTab] = useState('lines');
    const [person, setPerson] = useState('all');

    const rows = useMemo(() => {
        if (!data) return [];
        if (person === 'all') return data.rows;
        if (person.startsWith('car:')) return data.rows.filter((r) => r.beneficiary === 'car' && r.car_label === person.slice(4));
        return data.rows.filter((r) => r.beneficiary === 'employee' && String(r.user?._id) === person);
    }, [data, person]);

    if (!data) return null;

    const tabs = [
        { id: 'lines', label: isAr ? 'كل العمليات' : 'All lines' },
        { id: 'employees', label: isAr ? `ملخص ${ot.members}` : `By ${ot.member}` },
        ...(data.by_car.length ? [{ id: 'cars', label: isAr ? `عربيات ${ot.the}` : `${ot.One} cars` }] : []),
    ];

    return (
        <div>
            <div className={`${CARD} p-4 mb-4 flex flex-col sm:flex-row sm:items-end gap-3`}>
                <label className="flex-1 max-w-xs">
                    <span className="block text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-1.5">{isAr ? 'الشهر' : 'Month'}</span>
                    <select className={`${INPUT} w-full`} value={month} onChange={(e) => onMonthChange(e.target.value)}>
                        {data.months.map((m) => <option key={m} value={m}>{formatMonth(m, isAr)}</option>)}
                    </select>
                </label>
                <label className="flex-1 max-w-xs">
                    <span className="block text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-1.5">{isAr ? 'مين' : 'Who'}</span>
                    <select className={`${INPUT} w-full`} value={person} onChange={(e) => setPerson(e.target.value)}>
                        <option value="all">{isAr ? 'الكل' : 'Everyone'}</option>
                        {data.by_employee.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
                        {data.by_car.map((c) => <option key={c.key} value={`car:${c.key}`}>{isAr ? `عربية: ${c.name}` : `Car: ${c.name}`}</option>)}
                    </select>
                </label>
                <div className="sm:ms-auto">
                    <Button variant="success" icon={FileSpreadsheet} onClick={onExport}>{isAr ? 'تصدير Excel' : 'Export to Excel'}</Button>
                </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-4 mb-4">
                <StatCard label={isAr ? `الصافي على ${ot.the}` : `Net on the ${ot.one}`} value={formatMoney(data.totals.net, isAr)} icon={Building2} tone="brand" />
                <StatCard label={isAr ? 'الطلبات' : 'Orders'} value={formatMoney(data.totals.charged, isAr)} icon={ShoppingBag} />
                <StatCard label={isAr ? 'المرتجع والإلغاء' : 'Returns & cancellations'} value={formatMoney(data.totals.credited, isAr)} icon={RotateCcw} tone={data.totals.credited ? 'profit' : 'neutral'} />
            </div>

            <div className="flex gap-1 border-b border-zinc-200 dark:border-white/10 mb-4 overflow-x-auto">
                {tabs.map((t) => (
                    <button key={t.id} type="button" onClick={() => setTab(t.id)}
                        className={`px-4 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 -mb-px ${tab === t.id ? 'border-marine-cyan text-marine-primary' : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white'}`}>
                        {t.label}
                    </button>
                ))}
            </div>

            <div className={CARD}>
                {tab === 'lines' && (rows.length === 0 ? (
                    <EmptyState icon={ShoppingBag} title={isAr ? 'مفيش مشتريات في الشهر ده' : 'No purchases this month'} />
                ) : (
                    <TableWrap>
                        <table className="w-full min-w-[860px]">
                            <thead className="border-b border-zinc-100 dark:border-white/5">
                                <tr>
                                    <Th align="start">{isAr ? 'التاريخ' : 'Date'}</Th>
                                    <Th align="start">{isAr ? 'مين' : 'Who'}</Th>
                                    <Th align="start">{isAr ? 'أخد إيه' : 'What'}</Th>
                                    <Th align="start">{isAr ? `على ${ot.the}` : `On the ${ot.one}`}</Th>
                                    <Th align="start">{isAr ? 'دفعه بنفسه' : 'Paid personally'}</Th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                {rows.map((r) => (
                                    <tr key={r._id} className={r.kind === 'credit' ? 'bg-emerald-50/40 dark:bg-emerald-500/[0.03]' : ''}>
                                        <Td align="start" className="whitespace-nowrap text-zinc-500">
                                            {formatDate(r.created_at, isAr)}
                                            <p className="text-[11px] text-zinc-400" dir="ltr">{r.order?.reference}</p>
                                        </Td>
                                        <Td align="start">
                                            <p className="font-bold text-zinc-900 dark:text-white flex items-center gap-1.5">
                                                {r.beneficiary === 'car' ? <Car size={14} className="text-marine-primary" /> : <User size={14} className="text-zinc-400" />}
                                                {r.beneficiary === 'car' ? r.car_label : (r.user?.name || '—')}
                                            </p>
                                            <p className="text-[11px] text-zinc-500">
                                                {r.beneficiary === 'car' ? (isAr ? `طلبها ${r.user?.name || ''}` : `Ordered by ${r.user?.name || ''}`) : (r.group_name || '')}
                                            </p>
                                        </Td>
                                        <Td align="start">
                                            {r.kind === 'credit' && (
                                                <Pill className="bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 mb-1">
                                                    {isAr ? 'مرتجع / إلغاء' : 'Return / cancellation'}
                                                </Pill>
                                            )}
                                            {/* The order's own month was already invoiced, so this lands on this month's invoice. */}
                                            {r.for_month && (
                                                <Pill className="bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300 mb-1 ms-1">
                                                    {isAr ? `عن أوردر ${formatMonth(r.for_month, true)}` : `For a ${formatMonth(r.for_month, false)} order`}
                                                </Pill>
                                            )}
                                            <ul className="text-xs text-zinc-600 dark:text-zinc-300 space-y-0.5">
                                                {(r.order?.items || []).map((i, idx) => (
                                                    <li key={idx}>{i.title}{i.variant && i.variant !== 'Default' ? ` (${i.variant})` : ''} × {i.quantity}</li>
                                                ))}
                                            </ul>
                                            {r.order?.office_name && <p className="text-[11px] text-zinc-400 mt-1">{isAr ? `على ${ot.branch} ${r.order.office_name}` : `To ${r.order.office_name}`}</p>}
                                        </Td>
                                        <Td align="start">
                                            <span dir="ltr" className={`tabular-nums font-bold ${r.kind === 'credit' ? 'text-emerald-600' : 'text-zinc-900 dark:text-white'}`}>{formatMoney(r.amount, isAr)}</span>
                                        </Td>
                                        <Td align="start">
                                            {r.personal_amount ? <span dir="ltr" className="tabular-nums text-zinc-600 dark:text-zinc-300">{formatMoney(r.personal_amount, isAr)}</span> : <span className="text-zinc-400">—</span>}
                                        </Td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </TableWrap>
                ))}

                {tab === 'employees' && (data.by_employee.length === 0 ? (
                    <EmptyState icon={User} title={isAr ? `مفيش ${ot.membersN} طلبوا الشهر ده` : `No ${ot.member} ordered this month`} />
                ) : (
                    <TableWrap>
                        <table className="w-full min-w-[640px]">
                            <thead className="border-b border-zinc-100 dark:border-white/5">
                                <tr>
                                    <Th align="start">{isAr ? `${ot.theMember}` : `${ot.Member}`}</Th>
                                    <Th align="start">{isAr ? 'الجروب' : 'Group'}</Th>
                                    <Th align="start">{isAr ? 'الأوردرات' : 'Orders'}</Th>
                                    <Th align="start">{isAr ? `على ${ot.the}` : 'Charged'}</Th>
                                    <Th align="start">{isAr ? 'مرتجع' : 'Returned'}</Th>
                                    <Th align="start">{isAr ? 'الصافي' : 'Net'}</Th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                {data.by_employee.map((p) => (
                                    <tr key={p.key}>
                                        <Td align="start">
                                            <p className="font-bold text-zinc-900 dark:text-white">{p.name}</p>
                                            <p className="text-[11px] text-zinc-500" dir="ltr">{p.email || p.phone}</p>
                                        </Td>
                                        <Td align="start">{p.group_name || '—'}</Td>
                                        <Td align="start" className="tabular-nums">{p.orders}</Td>
                                        <Td align="start"><span dir="ltr" className="tabular-nums">{formatMoney(p.charged, isAr)}</span></Td>
                                        <Td align="start"><span dir="ltr" className="tabular-nums text-emerald-600">{p.credited ? formatMoney(p.credited, isAr) : '—'}</span></Td>
                                        <Td align="start"><span dir="ltr" className="tabular-nums font-black">{formatMoney(p.net, isAr)}</span></Td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </TableWrap>
                ))}

                {tab === 'cars' && (
                    <TableWrap>
                        <table className="w-full min-w-[520px]">
                            <thead className="border-b border-zinc-100 dark:border-white/5">
                                <tr>
                                    <Th align="start">{isAr ? 'العربية' : 'Car'}</Th>
                                    <Th align="start">{isAr ? 'الأوردرات' : 'Orders'}</Th>
                                    <Th align="start">{isAr ? `على ${ot.the}` : 'Charged'}</Th>
                                    <Th align="start">{isAr ? 'الصافي' : 'Net'}</Th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                {data.by_car.map((c) => (
                                    <tr key={c.key}>
                                        <Td align="start" className="font-bold text-zinc-900 dark:text-white">{c.name}</Td>
                                        <Td align="start" className="tabular-nums">{c.orders}</Td>
                                        <Td align="start"><span dir="ltr" className="tabular-nums">{formatMoney(c.charged, isAr)}</span></Td>
                                        <Td align="start"><span dir="ltr" className="tabular-nums font-black">{formatMoney(c.net, isAr)}</span></Td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </TableWrap>
                )}
            </div>
        </div>
    );
}
