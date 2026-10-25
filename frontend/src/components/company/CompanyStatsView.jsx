'use client';

import { useEffect, useState } from 'react';
import Link from '../LocaleLink';
import { Download, Printer, Receipt, ShoppingBag, Users, Truck, Lightbulb } from 'lucide-react';
import { formatMoney, formatMonth, errorText } from '../../lib/companyLocalization';
import { downloadFile } from '../../lib/api';
import {
    CARD, INPUT, Button, Notice, Spinner, EmptyState, TableWrap, Th, Td, StatCard, CompanyStatusPill,
} from './CompanyUI';
import { usePortalTerms } from './OrgTermsContext';
import useRowLink from '../../lib/useRowLink';

/**
 * Corporate-account statistics (feature 14, phase 5) — every company together, or one.
 *
 * Grouped by the four questions the feature is judged on: is the money coming in, are
 * companies and their employees actually ordering, is consolidation working (the figures
 * the admin tunes N and T with), and what do they buy. Exact numbers month by month,
 * like the rest of the finance screens; the Excel carries the same, and printing gives
 * the PDF.
 *
 * `load(params)` is the API call for the chosen scope, `exportUrl(params)` its Excel file.
 */

const pctLabel = (v, isAr) => (v === null || v === undefined
    ? '—'
    : isAr ? `${Number(v).toLocaleString('ar-EG', { maximumFractionDigits: 1 })}٪` : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`);
const num = (v, isAr) => (v === null || v === undefined ? '—' : Number(v).toLocaleString(isAr ? 'ar-EG' : 'en-US', { maximumFractionDigits: 1 }));

const TUNING_COPY = {
    mostly_alone: {
        ar: 'أغلب الدفعات بتقفل بأوردر واحد — الناس مش بيطلبوا من نفس المورد في نفس الوقت. زوّد ساعات الانتظار (T) أو قلّل العدد (N)، أو شجّع الحسابات على التجميع.',
        en: 'Most batches close with a single order — employees rarely order from the same store at the same time. Raise the wait (T) or lower the count (N), or encourage companies to consolidate.',
    },
    mostly_time: {
        ar: 'أغلب الدفعات بتقفل بالوقت مش بالعدد — العدد (N) كبير على نشاط الحسابات. قلّل N أو زوّد T.',
        en: 'Most batches close on time, not on count — N is high for how much companies order. Lower N or raise T.',
    },
    fills_fast: {
        ar: 'الدفعات بتكمل بسرعة (أقل من 6 ساعات في المتوسط) — ممكن تزوّد العدد (N) عشان الطرد الواحد يشيل أكتر ويوفّر أكتر.',
        en: 'Batches fill fast (under 6 hours on average) — you could raise N so each parcel carries more and saves more.',
    },
    balanced: {
        ar: 'الدفعات متوازنة بين القفل بالعدد والقفل بالوقت.',
        en: 'Batches close on count and on time in a healthy balance.',
    },
};

export default function CompanyStatsView({ isAr, load, exportUrl, scope = 'all' }) {
    const rowLink = useRowLink();
    // One account's words (a property's "residents"); the all-companies view stays generic.
    const ot = usePortalTerms(isAr);
    const [range, setRange] = useState({ from: '', to: '' });
    const [data, setData] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        load(range.from && range.to ? range : {})
            .then((res) => {
                if (cancelled) return;
                setData(res);
                if (!range.from) setRange({ from: res.from, to: res.to });
            })
            .catch((err) => !cancelled && setError(errorText(err, isAr)));
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [range.from, range.to, isAr]);

    const doExport = () => downloadFile(exportUrl({ from: data.from, to: data.to }));

    if (!data) return error ? <Notice>{error}</Notice> : <Spinner />;
    const pctText = (v) => pctLabel(v, isAr);
    const t = data.totals;
    const m = (v) => formatMoney(v, isAr);

    return (
        <div className="stats-print space-y-6">
            <style>{`@media print {
                body * { visibility: hidden; }
                .stats-print, .stats-print * { visibility: visible; }
                .stats-print { position: absolute; inset: 0 auto auto 0; width: 100%; }
                .no-print { display: none !important; }
                @page { size: A4 landscape; margin: 10mm; }
            }`}</style>

            {/* The range, in one row above everything it filters. */}
            <div className={`${CARD} p-4 flex flex-wrap items-end gap-3`}>
                <label className="text-xs font-bold text-zinc-500">
                    {isAr ? 'من شهر' : 'From'}
                    <input type="month" value={range.from} max={range.to || undefined} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className={`${INPUT} block mt-1`} dir="ltr" />
                </label>
                <label className="text-xs font-bold text-zinc-500">
                    {isAr ? 'لحد شهر' : 'To'}
                    <input type="month" value={range.to} min={range.from || undefined} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className={`${INPUT} block mt-1`} dir="ltr" />
                </label>
                <p className="text-xs text-zinc-500 pb-2">{isAr ? 'لحد 24 شهر. الشهر هو شهر الأوردر (نفس شهر الليميت والفاتورة).' : 'Up to 24 months. The month is the order month (the same as the limit and the invoice).'}</p>
                <div className="flex gap-2 ms-auto no-print">
                    <Button variant="secondary" icon={Download} onClick={doExport}>Excel</Button>
                    <Button variant="secondary" icon={Printer} onClick={() => window.print()}>{isAr ? 'اطبع / PDF' : 'Print / PDF'}</Button>
                </div>
            </div>
            {error && <Notice onClose={() => setError('')}>{error}</Notice>}

            {/* ---- Money ---- */}
            <Section icon={Receipt} title={isAr ? 'الفلوس' : 'Money'}>
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                    <StatCard label={isAr ? 'اتفوتر' : 'Invoiced'} value={m(t.invoiced)} />
                    <StatCard label={isAr ? 'اتدفع' : 'Paid'} value={m(t.paid)} tone="profit" />
                    <StatCard label={isAr ? 'متبقي' : 'Outstanding'} value={m(t.outstanding)} tone={t.outstanding > 0 ? 'warn' : 'neutral'} />
                    <StatCard label={isAr ? 'متأخر' : 'Overdue'} value={m(t.overdue)} tone={t.overdue > 0 ? 'loss' : 'neutral'} />
                    <StatCard label={isAr ? 'اتدفعت في ميعادها' : 'Paid on time'} value={pctText(t.on_time_rate)} sub={isAr ? 'من الفواتير اللي ميعادها جه' : 'of invoices already due'} />
                </div>
                <TableWrap>
                    <thead>
                        <tr>
                            <Th align="start">{isAr ? 'الشهر' : 'Month'}</Th>
                            <Th align="start">{isAr ? 'على الجهات' : 'Organisation share'}</Th>
                            <Th align="start">{isAr ? 'اتفوتر' : 'Invoiced'}</Th>
                            <Th align="start">{isAr ? 'اتدفع' : 'Paid'}</Th>
                            <Th align="start">{isAr ? 'متبقي' : 'Outstanding'}</Th>
                            <Th align="start">{isAr ? 'متأخر' : 'Overdue'}</Th>
                            <Th align="start">{isAr ? 'في الميعاد' : 'On time'}</Th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                        {data.months.map((r) => (
                            <tr key={r.month}>
                                <Td align="start" className="font-bold">
                                    {formatMonth(r.month, isAr)}
                                    <span className="block text-[11px] font-normal text-zinc-500">
                                        {{ invoiced: isAr ? 'اتفوتر' : 'invoiced', current: isAr ? 'الشهر الجاري' : 'this month', pending: isAr ? 'مستني الفاتورة' : 'awaiting invoice', none: '' }[r.money.state]}
                                    </span>
                                </Td>
                                <Td align="start"><Val>{m(r.money.company_share)}</Val></Td>
                                <Td align="start"><Val>{m(r.money.invoiced)}</Val></Td>
                                <Td align="start"><Val>{m(r.money.paid)}</Val></Td>
                                <Td align="start"><Val>{m(r.money.outstanding)}</Val></Td>
                                <Td align="start">
                                    <Val>{m(r.money.overdue)}</Val>
                                    {r.money.max_days_late > 0 && <span className="block text-[11px] text-red-600 dark:text-red-400">{isAr ? `لحد ${r.money.max_days_late} يوم` : `up to ${r.money.max_days_late} days`}</span>}
                                </Td>
                                <Td align="start"><Val>{pctText(r.money.on_time_rate)}</Val></Td>
                            </tr>
                        ))}
                    </tbody>
                </TableWrap>
            </Section>

            {/* ---- Activity ---- */}
            <Section icon={ShoppingBag} title={isAr ? 'النشاط' : 'Activity'}>
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                    <StatCard label={isAr ? 'الأوردرات' : 'Orders'} value={num(t.orders, isAr)} />
                    <StatCard label={isAr ? 'المبيعات' : 'Sales'} value={m(t.sales)} sub={isAr ? `منها على الجهات ${m(t.company_share)}` : `${m(t.company_share)} on company accounts`} />
                    <StatCard label={isAr ? 'متوسط الأوردر' : 'Average order'} value={m(t.avg_order)} />
                    <StatCard label={isAr ? `${ot.membersN} طلبوا` : `${ot.Members} who ordered`} value={`${num(t.active_employees, isAr)} / ${num(t.registered_employees, isAr)}`} sub={isAr ? 'من المسجلين دلوقتي' : 'of those registered now'} />
                    <StatCard label={isAr ? 'استهلاك الليميتات' : 'Limit usage'} value={pctText(t.limit_usage)} sub={isAr ? `استهلاك السقف ${pctText(t.cap_usage)}` : `Cap usage ${pctText(t.cap_usage)}`} />
                </div>
                <TableWrap>
                    <thead>
                        <tr>
                            <Th align="start">{isAr ? 'الشهر' : 'Month'}</Th>
                            <Th align="start">{isAr ? 'الأوردرات' : 'Orders'}</Th>
                            <Th align="start">{isAr ? 'منها عربيات' : 'Car orders'}</Th>
                            <Th align="start">{isAr ? 'المبيعات' : 'Sales'}</Th>
                            <Th align="start">{isAr ? 'متوسط الأوردر' : 'Avg order'}</Th>
                            <Th align="start">{isAr ? `دفعه ${ot.members}` : `Paid by ${ot.members}`}</Th>
                            <Th align="start">{isAr ? `${ot.membersN} طلبوا` : `Ordering ${ot.members}`}</Th>
                            <Th align="start">{isAr ? 'الليميتات' : 'Limits'}</Th>
                            <Th align="start">{isAr ? 'السقف' : 'Cap'}</Th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                        {data.months.map((r) => (
                            <tr key={r.month}>
                                <Td align="start" className="font-bold">{formatMonth(r.month, isAr)}</Td>
                                <Td align="start"><Val>{num(r.activity.orders, isAr)}</Val></Td>
                                <Td align="start"><Val>{num(r.activity.car_orders, isAr)}</Val></Td>
                                <Td align="start"><Val>{m(r.activity.sales)}</Val></Td>
                                <Td align="start"><Val>{m(r.activity.avg_order)}</Val></Td>
                                <Td align="start"><Val>{m(r.activity.employee_paid)}</Val></Td>
                                <Td align="start"><Val>{`${num(r.activity.active_employees, isAr)} (${pctText(r.activity.active_rate)})`}</Val></Td>
                                <Td align="start"><Val>{pctText(r.activity.limit_usage)}</Val></Td>
                                <Td align="start"><Val>{pctText(r.activity.cap_usage)}</Val></Td>
                            </tr>
                        ))}
                    </tbody>
                </TableWrap>
                <p className="text-[11px] text-zinc-500">{isAr ? 'نسب الليميتات والسقف محسوبة على الليميتات والسقوف الحالية.' : 'Limit and cap usage are measured against today’s limits and caps.'}</p>
            </Section>

            {/* ---- Consolidation ---- */}
            <Section icon={Truck} title={isAr ? 'الشحن والتجميع' : 'Shipping and consolidation'}>
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                    <StatCard label={isAr ? `على ${ot.theBranch}` : `To the ${ot.branch}`} value={pctText(t.office_rate)} sub={isAr ? `بالتجميع ${pctText(t.consolidated_rate)}` : `${pctText(t.consolidated_rate)} consolidated`} />
                    <StatCard label={isAr ? 'دفعات قفلت' : 'Batches closed'} value={num(t.batches, isAr)} sub={isAr ? `بالعدد ${num(t.by_count, true)} · بالوقت ${num(t.by_time, true)} · لوحدها ${num(t.alone, true)}` : `${t.by_count} on count · ${t.by_time} on time · ${t.alone} alone`} />
                    <StatCard label={isAr ? 'طرود اتوفرت' : 'Parcels saved'} value={num(t.parcels_saved, isAr)} sub={isAr ? `متوسط الدفعة ${num(t.avg_batch_size, true)} أوردر في ${num(t.avg_hours_to_close, true)} ساعة` : `Avg batch ${num(t.avg_batch_size)} orders in ${num(t.avg_hours_to_close)} h`} />
                    <StatCard label={isAr ? 'وفّرت الجهات' : 'Organisations saved'} value={m(t.savings)} tone="profit" />
                    <StatCard
                        label={isAr ? 'وفّرت Ready Marine (تقديري)' : 'Ready Marine saved (estimate)'}
                        value={t.subsidy_saved_estimate === null ? '—' : m(t.subsidy_saved_estimate)}
                        hint={t.avg_parcel_cost === null
                            ? (isAr ? 'محتاج طرود اتشحنت عشان نعرف تكلفة الطرد.' : 'Needs shipped parcels to know what a parcel costs.')
                            : (isAr ? `طرود اتوفرت × متوسط تكلفة الطرد (${m(t.avg_parcel_cost)}) − اللي رجع للجهات` : `Parcels saved × average parcel cost (${m(t.avg_parcel_cost)}) − what went back to companies`)}
                    />
                </div>

                {data.tuning && (
                    <div className="flex items-start gap-3 rounded-2xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200">
                        <Lightbulb size={18} className="shrink-0 mt-0.5" />
                        <div>
                            <p className="font-bold">
                                {isAr
                                    ? `الإعداد الحالي: ${data.consolidation_setting.order_count} أوردرات أو ${data.consolidation_setting.wait_hours} ساعة`
                                    : `Current rule: ${data.consolidation_setting.order_count} orders or ${data.consolidation_setting.wait_hours} hours`}
                            </p>
                            <p className="mt-1">{isAr ? TUNING_COPY[data.tuning.key].ar : TUNING_COPY[data.tuning.key].en}</p>
                            <p className="text-xs mt-1 opacity-80">
                                {isAr ? `قفلت بالوقت ${pctText(data.tuning.time_share)} · لوحدها ${pctText(data.tuning.alone_share)}` : `Closed on time ${pctText(data.tuning.time_share)} · alone ${pctText(data.tuning.alone_share)}`}
                            </p>
                            {scope === 'all' && (
                                <Link href="/admin/dashboard/companies/settings" className="no-print inline-block mt-2 text-xs font-bold underline">
                                    {isAr ? 'غيّر الإعداد' : 'Change the rule'}
                                </Link>
                            )}
                        </div>
                    </div>
                )}

                <TableWrap>
                    <thead>
                        <tr>
                            <Th align="start">{isAr ? 'الشهر' : 'Month'}</Th>
                            <Th align="start">{isAr ? `على ${ot.theBranch}` : ot.Branch}</Th>
                            <Th align="start">{isAr ? 'بالتجميع' : 'Consolidated'}</Th>
                            <Th align="start">{isAr ? 'دفعات' : 'Batches'}</Th>
                            <Th align="start">{isAr ? 'بالعدد / بالوقت / أدمن' : 'Count / time / admin'}</Th>
                            <Th align="start">{isAr ? 'لوحدها' : 'Alone'}</Th>
                            <Th align="start">{isAr ? 'متوسط الحجم' : 'Avg size'}</Th>
                            <Th align="start">{isAr ? 'متوسط ساعات القفل' : 'Avg hours'}</Th>
                            <Th align="start">{isAr ? 'طرود اتوفرت' : 'Parcels saved'}</Th>
                            <Th align="start">{isAr ? 'توفير الجهات' : 'Organisation savings'}</Th>
                            <Th align="start">{isAr ? 'الشحن المحصّل' : 'Shipping charged'}</Th>
                            <Th align="start">{isAr ? 'تكلفة الشحن علينا' : 'Courier cost'}</Th>
                            <Th align="start">{isAr ? 'دعم الشحن' : 'Subsidy'}</Th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                        {data.months.map((r) => {
                            const c = r.consolidation;
                            return (
                                <tr key={r.month}>
                                    <Td align="start" className="font-bold">{formatMonth(r.month, isAr)}</Td>
                                    <Td align="start"><Val>{pctText(c.office_rate)}</Val></Td>
                                    <Td align="start"><Val>{pctText(c.consolidated_rate)}</Val></Td>
                                    <Td align="start"><Val>{num(c.batches, isAr)}</Val></Td>
                                    <Td align="start"><Val>{`${c.by_count} / ${c.by_time} / ${c.by_admin}`}</Val></Td>
                                    <Td align="start"><Val>{num(c.alone, isAr)}</Val></Td>
                                    <Td align="start"><Val>{num(c.avg_size, isAr)}</Val></Td>
                                    <Td align="start"><Val>{num(c.avg_hours_to_close, isAr)}</Val></Td>
                                    <Td align="start"><Val>{num(c.parcels_saved, isAr)}</Val></Td>
                                    <Td align="start"><Val>{m(c.savings)}</Val></Td>
                                    <Td align="start"><Val>{m(c.shipping_charged)}</Val></Td>
                                    <Td align="start"><Val>{m(c.courier_cost)}</Val></Td>
                                    <Td align="start"><Val>{m(c.subsidy)}</Val></Td>
                                </tr>
                            );
                        })}
                    </tbody>
                </TableWrap>
                <p className="text-[11px] text-zinc-500">
                    {isAr
                        ? 'الدفعات بتتحسب في الشهر اللي قفلت فيه. "دعم الشحن" = تكلفة الشحن علينا − الشحن اللي اتحصّل من الجهات (بالموجب يعني Ready Marine بتدعم).'
                        : 'Batches count in the month they closed. "Subsidy" = what shipping cost us − what companies were charged (positive means Ready Marine is subsidising).'}
                </p>
            </Section>

            {/* ---- Companies side by side (every-company view only) ---- */}
            {data.companies && (
                <Section icon={Users} title={isAr ? 'الحسابات جنب بعض' : 'Accounts side by side'}>
                    {data.companies.length === 0 ? (
                        <EmptyState title={isAr ? 'مفيش حسابات' : 'No accounts'} />
                    ) : (
                        <TableWrap>
                            <thead>
                                <tr>
                                    <Th align="start">{isAr ? 'الجهة' : 'Account'}</Th>
                                    <Th align="start">{isAr ? 'الأوردرات' : 'Orders'}</Th>
                                    <Th align="start">{isAr ? 'المبيعات' : 'Sales'}</Th>
                                    <Th align="start">{isAr ? 'اتفوتر / اتدفع' : 'Invoiced / paid'}</Th>
                                    <Th align="start">{isAr ? 'متأخر' : 'Overdue'}</Th>
                                    <Th align="start">{isAr ? 'على الفرع / تجميع' : 'Branch / consolidated'}</Th>
                                    <Th align="start">{isAr ? 'التوفير' : 'Savings'}</Th>
                                    <Th align="start">{isAr ? 'أعضاء طلبوا' : 'Ordering members'}</Th>
                                    <Th align="start">{isAr ? 'السقف' : 'Cap'}</Th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                {data.companies.map((c) => (
                                    <tr key={c.company_id} {...rowLink(`/admin/dashboard/companies/${c.company_id}?tab=stats`)} className="hover:bg-zinc-50 dark:hover:bg-white/[0.02] cursor-pointer">
                                        <Td align="start">
                                            <Link href={`/admin/dashboard/companies/${c.company_id}?tab=stats`} className="font-bold text-zinc-900 dark:text-white hover:text-marine-primary">{c.name}</Link>
                                            <div className="mt-1"><CompanyStatusPill status={c.status} isAr={isAr} /></div>
                                        </Td>
                                        <Td align="start"><Val>{num(c.orders, isAr)}</Val></Td>
                                        <Td align="start"><Val>{m(c.sales)}</Val></Td>
                                        <Td align="start"><Val>{m(c.invoiced)}</Val><span className="block text-[11px] text-zinc-500" dir="ltr">{m(c.paid)}</span></Td>
                                        <Td align="start"><span className={c.overdue > 0 ? 'text-red-600 dark:text-red-400 font-bold' : ''}><Val>{m(c.overdue)}</Val></span></Td>
                                        <Td align="start"><Val>{`${pctText(c.office_rate)} / ${pctText(c.consolidated_rate)}`}</Val></Td>
                                        <Td align="start"><Val>{m(c.savings)}</Val></Td>
                                        <Td align="start"><Val>{`${num(c.active_employees, isAr)} / ${num(c.registered_employees, isAr)}`}</Val></Td>
                                        <Td align="start"><Val>{pctText(c.cap_usage)}</Val></Td>
                                    </tr>
                                ))}
                            </tbody>
                        </TableWrap>
                    )}
                </Section>
            )}

            {/* ---- What they buy ---- */}
            <div className="grid lg:grid-cols-2 gap-6">
                <TopList title={isAr ? 'أكتر الموردين' : 'Top vendors'} rows={data.top_vendors} isAr={isAr} m={m} />
                <TopList title={isAr ? 'أكتر المنتجات' : 'Top products'} rows={data.top_products} isAr={isAr} m={m} showQty />
            </div>
        </div>
    );
}

function Section({ icon: Icon, title, children }) {
    return (
        <section className="space-y-4">
            <h2 className="text-lg font-black text-zinc-900 dark:text-white flex items-center gap-2"><Icon size={18} className="text-marine-primary" />{title}</h2>
            {children}
        </section>
    );
}

function Val({ children }) {
    return <span dir="ltr" className="tabular-nums whitespace-nowrap">{children}</span>;
}

function TopList({ title, rows = [], isAr, m, showQty = false }) {
    return (
        <div className={`${CARD} p-5`}>
            <h3 className="font-black text-zinc-900 dark:text-white mb-3">{title}</h3>
            {rows.length === 0 ? (
                <p className="text-sm text-zinc-500">{isAr ? 'لسه مفيش أوردرات في الفترة دي.' : 'No orders in this range yet.'}</p>
            ) : (
                <ol className="divide-y divide-zinc-100 dark:divide-white/5">
                    {rows.map((r, i) => (
                        <li key={i} className="py-2 flex items-center justify-between gap-3 text-sm">
                            <span className="min-w-0 truncate text-zinc-800 dark:text-zinc-200"><span className="text-zinc-400 me-2 tabular-nums">{i + 1}.</span>{r.name || '—'}</span>
                            <span className="shrink-0 text-end">
                                <Val>{m(r.sales)}</Val>
                                <span className="block text-[11px] text-zinc-500">
                                    {isAr ? `${r.orders} أوردر` : `${r.orders} order(s)`}{showQty ? (isAr ? ` · ${r.quantity} قطعة` : ` · ${r.quantity} pcs`) : ''}
                                </span>
                            </span>
                        </li>
                    ))}
                </ol>
            )}
        </div>
    );
}
