'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useApp } from '../../../../../context/AppContext';
import { adminFinanceApi } from '../../../../../lib/api';
import {
    CARD, INPUT, LABEL, Money, StatCard, Spinner, EmptyState,
    money, fmtDate, fmtDateTime, toInputDate, TableWrap, Th, Td,
} from '../../../../../components/dashboard/finance/FinanceUI';
import {
    Truck, Banknote, PackageCheck, AlertTriangle, RefreshCw, Package,
    CalendarClock, Trash2, Loader2, CheckCircle2, Clock,
} from 'lucide-react';

/**
 * Cash at the couriers, and the prepaid bundle we bought from one of them.
 *
 * WHY THESE TWO THINGS SHARE A SCREEN. They are the two directions of the same relationship.
 * On a cash order the customer pays the courier, so between delivery and the weekly transfer
 * there is a real pile of our money sitting somewhere else — and on Bosta we ALSO paid
 * up front for the trips themselves. One screen answers both: what we prepaid, and what has
 * not come back yet.
 *
 * THE NUMBER THAT MATTERS is "outstanding": delivered parcels whose cash has not been
 * matched to a bank transfer. It ignores date ranges on purpose — money collected in March
 * and still not transferred is outstanding today, and a month filter would report it as zero.
 */

const MODE_LABELS = {
    net: { ar: 'بيخصم رسومه من التحصيل', en: 'Deducts its fees from the COD' },
    gross: { ar: 'بيحوّل التحصيل كامل', en: 'Transfers the full COD' },
};

export default function CourierCashPage() {
    const { language, siteSettings } = useApp();
    const isAr = language === 'ar';
    const currency = siteSettings?.currency || 'EGP';

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [data, setData] = useState(null);
    const [bundle, setBundle] = useState(null);

    const [openProvider, setOpenProvider] = useState(null);
    const [parcels, setParcels] = useState(null);
    const [parcelsLoading, setParcelsLoading] = useState(false);
    const [selected, setSelected] = useState(() => new Set());

    const [settlements, setSettlements] = useState([]);
    const [form, setForm] = useState({ amount: '', received_at: toInputDate(new Date()), reference: '', notes: '' });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const load = useCallback(async ({ refresh = false } = {}) => {
        if (refresh) setRefreshing(true);
        try {
            const [cash, list] = await Promise.all([
                adminFinanceApi.getCourierCash(refresh ? { refresh: 'true' } : {}),
                adminFinanceApi.getCourierSettlements({ limit: 25 }),
            ]);
            setData(cash);
            setBundle(cash?.bundle || null);
            setSettlements(list?.settlements || []);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // Fetching and toggling are separate on purpose: after recording a transfer the panel
    // must RELOAD without closing, and a single toggling function would close it instead —
    // leaving the admin looking at the parcels they just settled.
    const loadParcels = useCallback(async (provider) => {
        setParcelsLoading(true);
        setSelected(new Set());
        try {
            const res = await adminFinanceApi.getCourierParcels(provider, { limit: 500 });
            setParcels(res);
        } catch (err) {
            setError(err.message);
        } finally {
            setParcelsLoading(false);
        }
    }, []);

    const openParcels = async (provider) => {
        if (openProvider === provider) { setOpenProvider(null); setParcels(null); setSelected(new Set()); return; }
        setOpenProvider(provider);
        await loadParcels(provider);
    };

    const toggle = (id) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    // Selecting every parcel is the common case — a courier transfers a whole cycle at once —
    // so it is one click, and the amount box is prefilled with what those parcels add up to.
    const selectAll = () => {
        const all = (parcels?.parcels || []).map((p) => String(p.sub_order_id));
        setSelected((prev) => (prev.size === all.length ? new Set() : new Set(all)));
    };

    const selectedTotal = useMemo(() => {
        const rows = parcels?.parcels || [];
        return rows
            .filter((p) => selected.has(String(p.sub_order_id)))
            .reduce((sum, p) => sum + Number(p.owed || 0), 0);
    }, [parcels, selected]);

    useEffect(() => {
        // The expected figure is the default, not the answer: the admin overwrites it with
        // what the bank actually shows, and the gap becomes the settlement's `difference`.
        if (selected.size > 0) setForm((f) => ({ ...f, amount: selectedTotal.toFixed(2) }));
    }, [selectedTotal, selected.size]);

    const submit = async () => {
        if (!openProvider || selected.size === 0) return;
        setSaving(true);
        setError('');
        try {
            await adminFinanceApi.recordCourierSettlement({
                provider: openProvider,
                amount: Number(form.amount),
                received_at: form.received_at,
                reference: form.reference,
                notes: form.notes,
                parcels: [...selected],
            });
            setSelected(new Set());
            setForm({ amount: '', received_at: toInputDate(new Date()), reference: '', notes: '' });
            // Both halves: the headline figures, and the list the settled parcels just left.
            await Promise.all([load(), loadParcels(openProvider)]);
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const removeSettlement = async (id) => {
        if (!window.confirm(isAr
            ? 'هيترجع الشحنات دي تاني لقائمة المستحق. متأكد؟'
            : 'The parcels it closed go back to outstanding. Are you sure?')) return;
        try {
            await adminFinanceApi.deleteCourierSettlement(id);
            await load();
            if (openProvider) await loadParcels(openProvider);
        } catch (err) {
            setError(err.message);
        }
    };

    if (loading) return <Spinner />;

    const couriers = data?.couriers || [];
    const totals = data?.totals || {};
    const active = bundle?.active || null;

    // Two separate warnings because they need two different reactions: buying the next
    // bundle, and shipping what is already paid for before it expires. Both thresholds come
    // from the same setting the notification sweep reads, so the screen and the alert fire
    // at the same moment — Admin -> Shipping -> Settings changes them.
    const lowOrders = bundle?.thresholds?.low_orders ?? 5;
    const lowDays = bundle?.thresholds?.low_days ?? 5;
    const lowBalance = active && lowOrders > 0 && active.remaining_orders <= lowOrders;
    const expiringSoon = active && lowDays > 0 && active.days_left !== null
        && active.days_left <= lowDays && active.remaining_orders > 0;

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h2 className="text-lg font-black text-zinc-900 dark:text-white">
                        {isAr ? 'شركات الشحن' : 'Couriers'}
                    </h2>
                    <p className="text-sm text-zinc-500 mt-1">
                        {isAr
                            ? 'الكاش اللي محصّلينه ولسه ما وصلش البنك، وحالة باقة بوسطة المدفوعة مقدّم.'
                            : 'Cash collected and not yet in the bank, and the state of the prepaid Bosta bundle.'}
                    </p>
                </div>
                <button
                    onClick={() => load({ refresh: true })}
                    disabled={refreshing}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-white/10 transition-colors disabled:opacity-50"
                >
                    {refreshing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                    {isAr ? 'تحديث من بوسطة' : 'Refresh from Bosta'}
                </button>
            </div>

            {error && (
                <div className="flex items-start gap-2 p-4 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 text-sm">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {/* ---- Headline: what is sitting at the couriers ---- */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <StatCard
                    label={isAr ? 'مستحق لك عند شركات الشحن' : 'Owed by couriers'}
                    value={totals.outstanding || 0}
                    currency={currency}
                    icon={Banknote}
                    tone="brand"
                    sub={isAr ? `${totals.parcels || 0} شحنة اتسلّمت ولسه فلوسها ما وصلتش` : `${totals.parcels || 0} delivered parcels not yet transferred`}
                    hint={isAr
                        ? 'ده الكاش اللي هيوصل إيدك من الشركة — مش ربح. جواه مستحقات التجار وتمن الشحن اللي دفعته من جيبك.'
                        : 'The cash that will physically arrive — not profit. It still contains the vendors\' money and the shipping you paid for.'}
                />
                <StatCard
                    label={isAr ? 'إجمالي المحصّل' : 'Collected'}
                    value={totals.collected || 0}
                    currency={currency}
                    icon={PackageCheck}
                    sub={isAr ? 'الكاش اللي الطيار خده من العملاء' : 'Cash taken at the door'}
                />
                <StatCard
                    label={isAr ? 'رسوم بتتخصم من الكاش' : 'Deducted from the cash'}
                    value={totals.fees_kept || 0}
                    currency={currency}
                    icon={Truck}
                    tone="loss"
                    hint={isAr
                        ? `اللي الشركة بتشيله فعلاً من الفلوس قبل ما تحوّلها. شحن الشحنات اللي على الباقة مش هنا — اتدفع مقدّم (${money(totals.prepaid_shipping || 0, currency)}).`
                        : `What the courier actually keeps before transferring. Shipping on bundle parcels is not here — it was prepaid (${money(totals.prepaid_shipping || 0, currency)}).`}
                />
                <StatCard
                    label={isAr ? 'اتحوّل للبنك' : 'Transferred to bank'}
                    value={totals.settled || 0}
                    currency={currency}
                    icon={CheckCircle2}
                    tone="profit"
                    sub={isAr ? 'إجمالي التحويلات المسجلة' : 'All recorded transfers'}
                />
            </div>

            {/* ---- The prepaid bundle ---- */}
            <div className={`${CARD} overflow-hidden`}>
                <div className="px-5 py-4 border-b border-zinc-100 dark:border-white/5 flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <h3 className="font-black text-zinc-900 dark:text-white">
                            {isAr ? 'باقة بوسطة المدفوعة مقدّم' : 'Prepaid Bosta bundle'}
                        </h3>
                        <p className="text-xs text-zinc-500 mt-0.5">
                            {isAr
                                ? 'الشحنة بتاكل نقطة واحدة من الباقة مهما كانت المحافظة أو حجم الشحنة.'
                                : 'One parcel burns one credit, whatever the governorate or the parcel size.'}
                        </p>
                    </div>
                    {active?.synced_at && (
                        <span className="text-[11px] text-zinc-400">
                            {isAr ? 'آخر تحديث ' : 'Synced '}{fmtDateTime(active.synced_at, isAr)}
                        </span>
                    )}
                </div>

                {!active ? (
                    <div className="p-5">
                        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300">
                            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                            <div>
                                <p className="font-bold text-sm">{isAr ? 'مفيش باقة فعّالة' : 'No active bundle'}</p>
                                <p className="text-xs mt-1">
                                    {isAr
                                        ? 'الشحن عند بوسطة هيقف لحد ما تشتري باقة جديدة من لوحة بوسطة.'
                                        : 'Bosta will not accept new parcels until a bundle is bought from the Bosta dashboard.'}
                                </p>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="p-5 space-y-4">
                        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                            <Figure label={isAr ? 'الباقة' : 'Bundle'} value={active.name} />
                            <Figure
                                label={isAr ? 'فاضل' : 'Remaining'}
                                value={`${active.remaining_orders} / ${active.total_orders}`}
                                tone={lowBalance ? 'loss' : 'neutral'}
                            />
                            <Figure
                                label={isAr ? 'فاضل أيام' : 'Days left'}
                                value={active.days_left ?? '—'}
                                tone={expiringSoon ? 'warn' : 'neutral'}
                                sub={fmtDate(active.expires_at, isAr)}
                            />
                            <Figure
                                label={isAr ? 'تكلفة الشحنة' : 'Cost per parcel'}
                                value={money(active.credit_price, currency)}
                                sub={isAr ? `${money(active.paid_amount, currency)} ÷ ${active.total_orders}` : `${money(active.paid_amount, currency)} ÷ ${active.total_orders}`}
                            />
                            <Figure
                                label={isAr ? 'قيمة معرّضة للضياع' : 'At risk'}
                                value={money(active.value_at_risk, currency)}
                                tone={expiringSoon ? 'loss' : 'neutral'}
                                sub={isAr ? 'لو الباقة خلصت مدتها' : 'If the bundle expires unused'}
                            />
                        </div>

                        {/* A bar rather than a number: "17 of 20" is read instantly, "85%" is not. */}
                        <div>
                            <div className="h-2 rounded-full bg-zinc-100 dark:bg-white/5 overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all ${lowBalance ? 'bg-red-500' : 'bg-emerald-500'}`}
                                    style={{ width: `${active.total_orders ? Math.min(100, (active.consumed_orders / active.total_orders) * 100) : 0}%` }}
                                />
                            </div>
                            <p className="text-[11px] text-zinc-500 mt-1.5">
                                {isAr
                                    ? `استخدمت ${active.consumed_orders} شحنة من ${active.total_orders}`
                                    : `${active.consumed_orders} of ${active.total_orders} parcels used`}
                            </p>
                        </div>

                        {(lowBalance || expiringSoon || !active.auto_renewal) && (
                            <div className="space-y-2">
                                {lowBalance && (
                                    <Warning tone="loss" icon={AlertTriangle}>
                                        {isAr
                                            ? `فاضل ${active.remaining_orders} شحنة بس. اشتري الباقة الجاية قبل ما الشحن يقف.`
                                            : `Only ${active.remaining_orders} parcels left. Buy the next bundle before shipping stops.`}
                                    </Warning>
                                )}
                                {expiringSoon && (
                                    <Warning tone="warn" icon={CalendarClock}>
                                        {isAr
                                            ? `فاضل ${active.days_left} يوم على انتهاء الباقة ولسه عندك ${active.remaining_orders} شحنة متستخدمتش (${money(active.value_at_risk, currency)}). الشحنات دي بتضيع ومش بتترحّل.`
                                            : `${active.days_left} days left and ${active.remaining_orders} parcels unused (${money(active.value_at_risk, currency)}). They are lost, not carried over.`}
                                    </Warning>
                                )}
                                {!active.auto_renewal && (
                                    <Warning tone="neutral" icon={Clock}>
                                        {isAr
                                            ? 'التجديد التلقائي مقفول — الباقة مش هتتجدد لوحدها.'
                                            : 'Auto-renewal is off — this bundle will not renew itself.'}
                                    </Warning>
                                )}
                            </div>
                        )}

                        {bundle?.lifetime?.wasted_amount > 0 && (
                            <div className="pt-4 border-t border-zinc-100 dark:border-white/5">
                                <p className="text-xs text-zinc-500">
                                    {isAr
                                        ? `على مدار ${bundle.lifetime.cycles} باقة خلصت: ضاع ${bundle.lifetime.wasted_orders} شحنة بقيمة `
                                        : `Across ${bundle.lifetime.cycles} closed bundles: ${bundle.lifetime.wasted_orders} parcels expired unused, worth `}
                                    <Money value={bundle.lifetime.wasted_amount} currency={currency} className="font-bold" />
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {/* Past cycles: the only place the REAL cost per parcel shows up. */}
                {bundle?.history?.length > 1 && (
                    <TableWrap>
                        <table className="w-full border-t border-zinc-100 dark:border-white/5">
                            <thead className="bg-zinc-50 dark:bg-white/[0.02]">
                                <tr>
                                    <Th>{isAr ? 'الباقة' : 'Bundle'}</Th>
                                    <Th>{isAr ? 'المدة' : 'Period'}</Th>
                                    <Th align="center">{isAr ? 'مستخدم' : 'Used'}</Th>
                                    <Th align="center">{isAr ? 'ضاع' : 'Wasted'}</Th>
                                    <Th align="right">{isAr ? 'المدفوع' : 'Paid'}</Th>
                                    <Th align="right">{isAr ? 'التكلفة الحقيقية للشحنة' : 'Real cost per parcel'}</Th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                {bundle.history.map((h) => (
                                    <tr key={h.subscription_id}>
                                        <Td className="font-bold text-zinc-800 dark:text-zinc-200">{h.name}</Td>
                                        <Td className="text-zinc-500 text-xs">
                                            {fmtDate(h.started_at, isAr)} → {fmtDate(h.expires_at, isAr)}
                                        </Td>
                                        <Td align="center">{h.consumed_orders} / {h.total_orders}</Td>
                                        <Td align="center">
                                            {h.wasted_orders > 0 ? (
                                                <span className="text-red-600 dark:text-red-400 font-bold">
                                                    {h.wasted_orders} <span className="text-[11px] font-normal">({money(h.wasted_amount, currency)})</span>
                                                </span>
                                            ) : '—'}
                                        </Td>
                                        <Td align="right"><Money value={h.paid_amount} currency={currency} /></Td>
                                        <Td align="right">
                                            {h.effective_credit_price !== null ? (
                                                <span className={h.effective_credit_price > h.credit_price * 1.2 ? 'text-red-600 dark:text-red-400 font-bold' : ''}>
                                                    <Money value={h.effective_credit_price} currency={currency} />
                                                </span>
                                            ) : '—'}
                                        </Td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </TableWrap>
                )}
            </div>

            {/* ---- Per courier ---- */}
            <div className="space-y-4">
                {couriers.map((c) => (
                    <div key={c.provider} className={`${CARD} overflow-hidden`}>
                        <div className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-white/5 flex items-center justify-center">
                                    <Truck size={18} className="text-zinc-500" />
                                </div>
                                <div>
                                    <p className="font-black text-zinc-900 dark:text-white">{c.label}</p>
                                    <p className="text-[11px] text-zinc-500">
                                        {MODE_LABELS[c.cod_mode]?.[isAr ? 'ar' : 'en']}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-6 flex-wrap">
                                <Figure label={isAr ? 'شحنات' : 'Parcels'} value={c.parcels} compact />
                                <Figure label={isAr ? 'محصّل' : 'Collected'} value={money(c.collected, currency)} compact />
                                <Figure label={isAr ? 'بيخصموا' : 'They deduct'} value={money(c.fees_kept, currency)} compact tone="loss" />
                                {c.prepaid_shipping > 0 && (
                                    <Figure
                                        label={isAr ? 'شحن مدفوع مقدّم' : 'Shipping prepaid'}
                                        value={money(c.prepaid_shipping, currency)}
                                        sub={isAr ? 'تكلفة عليك، مش متخصومة من الكاش' : 'a cost to you, not deducted here'}
                                        compact
                                    />
                                )}
                                <Figure label={isAr ? 'المستحق لك' : 'Owed to you'} value={money(c.outstanding, currency)} compact tone="brand" />
                                {c.oldest_delivered_at && (
                                    <Figure
                                        label={isAr ? 'أقدم شحنة' : 'Oldest'}
                                        value={fmtDate(c.oldest_delivered_at, isAr)}
                                        compact
                                    />
                                )}
                                <button
                                    onClick={() => openParcels(c.provider)}
                                    disabled={c.parcels === 0}
                                    className="px-4 py-2 rounded-xl text-sm font-bold bg-marine-cyan text-white hover:bg-[#b91c1c] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    {openProvider === c.provider
                                        ? (isAr ? 'إخفاء' : 'Hide')
                                        : (isAr ? 'تسجيل تحويل' : 'Record transfer')}
                                </button>
                            </div>
                        </div>

                        {openProvider === c.provider && (
                            <div className="border-t border-zinc-100 dark:border-white/5">
                                {parcelsLoading ? (
                                    <Spinner />
                                ) : !parcels?.parcels?.length ? (
                                    <EmptyState
                                        icon={Package}
                                        title={isAr ? 'مفيش شحنات مستحقة' : 'Nothing outstanding'}
                                        message={isAr ? 'كل الفلوس المحصّلة اتسجل استلامها.' : 'Every collected pound has been matched to a transfer.'}
                                    />
                                ) : (
                                    <>
                                        <div className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap bg-zinc-50 dark:bg-white/[0.02]">
                                            <button
                                                onClick={selectAll}
                                                className="text-xs font-bold text-marine-primary hover:underline"
                                            >
                                                {selected.size === parcels.parcels.length
                                                    ? (isAr ? 'إلغاء التحديد' : 'Clear selection')
                                                    : (isAr ? 'تحديد الكل' : 'Select all')}
                                            </button>
                                            <p className="text-xs text-zinc-500">
                                                {isAr
                                                    ? `محدد ${selected.size} شحنة — إجمالي ${money(selectedTotal, currency)}`
                                                    : `${selected.size} selected — ${money(selectedTotal, currency)}`}
                                            </p>
                                        </div>

                                        <TableWrap>
                                            <table className="w-full">
                                                <thead className="bg-zinc-50 dark:bg-white/[0.02]">
                                                    <tr>
                                                        <Th className="w-10" />
                                                        <Th>{isAr ? 'الأوردر' : 'Order'}</Th>
                                                        <Th>{isAr ? 'التتبع' : 'Tracking'}</Th>
                                                        <Th>{isAr ? 'اتسلّم' : 'Delivered'}</Th>
                                                        <Th>{isAr ? 'موعد التحويل' : 'Cashout due'}</Th>
                                                        <Th align="right">{isAr ? 'محصّل' : 'Collected'}</Th>
                                                        <Th align="right">{isAr ? 'خصموا' : 'Kept'}</Th>
                                                        <Th align="right">{isAr ? 'ليك' : 'Owed'}</Th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                                    {parcels.parcels.map((p) => {
                                                        const id = String(p.sub_order_id);
                                                        return (
                                                            <tr
                                                                key={id}
                                                                onClick={() => toggle(id)}
                                                                className={`cursor-pointer transition-colors ${selected.has(id) ? 'bg-red-50/60 dark:bg-marine-cyan/5' : 'hover:bg-zinc-50 dark:hover:bg-white/[0.02]'}`}
                                                            >
                                                                <Td>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={selected.has(id)}
                                                                        onChange={() => toggle(id)}
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        className="accent-marine-cyan w-4 h-4"
                                                                    />
                                                                </Td>
                                                                <Td className="font-bold text-zinc-800 dark:text-zinc-200">#{p.order_number}</Td>
                                                                <Td className="text-xs text-zinc-500" dir="ltr">{p.tracking_number || '—'}</Td>
                                                                <Td className="text-xs text-zinc-500">{fmtDate(p.delivered_at, isAr)}</Td>
                                                                <Td className="text-xs text-zinc-500">{fmtDate(p.expected_at, isAr)}</Td>
                                                                <Td align="right"><Money value={p.cod} currency={currency} /></Td>
                                                                <Td align="right">
                                                                    <span className="text-zinc-500">{money(p.fees_kept, currency)}</span>
                                                                    {p.billing_mode === 'bundle' && (
                                                                        <span className="block text-[10px] text-emerald-600 dark:text-emerald-400">
                                                                            {isAr ? 'الشحن مدفوع بالباقة' : 'Delivery prepaid'}
                                                                        </span>
                                                                    )}
                                                                </Td>
                                                                <Td align="right" className="font-bold"><Money value={p.owed} currency={currency} /></Td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </TableWrap>

                                        {/* The transfer itself. Amount is prefilled from the selection and
                                            meant to be overwritten with what the bank really shows. */}
                                        {selected.size > 0 && (
                                            <div className="p-5 border-t border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
                                                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                                    <div>
                                                        <label className={LABEL}>{isAr ? 'المبلغ اللي وصل البنك' : 'Amount received'}</label>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            value={form.amount}
                                                            onChange={(e) => setForm({ ...form, amount: e.target.value })}
                                                            className={`${INPUT} w-full`}
                                                            dir="ltr"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className={LABEL}>{isAr ? 'تاريخ الاستلام' : 'Received on'}</label>
                                                        <input
                                                            type="date"
                                                            value={form.received_at}
                                                            onChange={(e) => setForm({ ...form, received_at: e.target.value })}
                                                            className={`${INPUT} w-full`}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className={LABEL}>{isAr ? 'رقم التحويل' : 'Reference'}</label>
                                                        <input
                                                            value={form.reference}
                                                            onChange={(e) => setForm({ ...form, reference: e.target.value })}
                                                            className={`${INPUT} w-full`}
                                                            placeholder={isAr ? 'رقم العملية في كشف البنك' : 'Bank statement reference'}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className={LABEL}>{isAr ? 'ملاحظات' : 'Notes'}</label>
                                                        <input
                                                            value={form.notes}
                                                            onChange={(e) => setForm({ ...form, notes: e.target.value })}
                                                            className={`${INPUT} w-full`}
                                                        />
                                                    </div>
                                                </div>

                                                {Number(form.amount) !== Number(selectedTotal.toFixed(2)) && form.amount !== '' && (
                                                    <p className="text-xs mt-3 text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                                                        <AlertTriangle size={13} />
                                                        {isAr
                                                            ? `فرق ${money(Number(form.amount) - selectedTotal, currency)} عن المتوقع — هيتسجل عشان تسأل عنه.`
                                                            : `${money(Number(form.amount) - selectedTotal, currency)} away from expected — recorded so it can be chased.`}
                                                    </p>
                                                )}

                                                <button
                                                    onClick={submit}
                                                    disabled={saving || !form.amount}
                                                    className="mt-4 flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-marine-cyan text-white hover:bg-[#b91c1c] transition-colors disabled:opacity-50"
                                                >
                                                    {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                                                    {isAr ? `تأكيد استلام ${selected.size} شحنة` : `Confirm ${selected.size} parcels received`}
                                                </button>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* ---- Transfers already recorded ---- */}
            <div className={`${CARD} overflow-hidden`}>
                <div className="px-5 py-4 border-b border-zinc-100 dark:border-white/5">
                    <h3 className="font-black text-zinc-900 dark:text-white">
                        {isAr ? 'التحويلات المسجلة' : 'Recorded transfers'}
                    </h3>
                </div>
                {settlements.length === 0 ? (
                    <EmptyState
                        icon={Banknote}
                        title={isAr ? 'لسه مفيش تحويلات مسجلة' : 'No transfers recorded yet'}
                        message={isAr ? 'لما تحويل يوصل البنك، سجّله من فوق عشان يتقفل على شحناته.' : 'When a transfer lands, record it above so its parcels close.'}
                    />
                ) : (
                    <TableWrap>
                        <table className="w-full">
                            <thead className="bg-zinc-50 dark:bg-white/[0.02]">
                                <tr>
                                    <Th>{isAr ? 'الشركة' : 'Courier'}</Th>
                                    <Th>{isAr ? 'التاريخ' : 'Date'}</Th>
                                    <Th>{isAr ? 'المرجع' : 'Reference'}</Th>
                                    <Th align="center">{isAr ? 'شحنات' : 'Parcels'}</Th>
                                    <Th align="right">{isAr ? 'المتوقع' : 'Expected'}</Th>
                                    <Th align="right">{isAr ? 'اللي وصل' : 'Received'}</Th>
                                    <Th align="right">{isAr ? 'الفرق' : 'Difference'}</Th>
                                    <Th align="center" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                {settlements.map((s) => (
                                    <tr key={s._id}>
                                        <Td className="font-bold text-zinc-800 dark:text-zinc-200">
                                            {couriers.find((c) => c.provider === s.provider)?.label || s.provider}
                                        </Td>
                                        <Td className="text-xs text-zinc-500">{fmtDate(s.received_at, isAr)}</Td>
                                        <Td className="text-xs text-zinc-500" dir="ltr">{s.reference || '—'}</Td>
                                        <Td align="center">{s.parcels_count}</Td>
                                        <Td align="right" className="text-zinc-500">{money(s.expected_amount, currency)}</Td>
                                        <Td align="right"><Money value={s.amount} currency={currency} /></Td>
                                        <Td align="right">
                                            {Math.abs(Number(s.difference || 0)) < 0.01
                                                ? <span className="text-emerald-600 dark:text-emerald-400 text-xs font-bold">{isAr ? 'مظبوط' : 'Matched'}</span>
                                                : <Money value={s.difference} currency={currency} signed />}
                                        </Td>
                                        <Td align="center">
                                            <button
                                                onClick={() => removeSettlement(s._id)}
                                                className="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                                                title={isAr ? 'تراجع' : 'Undo'}
                                            >
                                                <Trash2 size={15} />
                                            </button>
                                        </Td>
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

/** A small labelled figure — used both in the bundle card and on each courier's row. */
function Figure({ label, value, sub, tone = 'neutral', compact = false }) {
    const tones = {
        neutral: 'text-zinc-900 dark:text-white',
        loss: 'text-red-600 dark:text-red-400',
        warn: 'text-amber-600 dark:text-amber-400',
        brand: 'text-marine-primary',
    };
    return (
        <div>
            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">{label}</p>
            <p dir="ltr" className={`${compact ? 'text-sm' : 'text-lg'} font-black tabular-nums mt-0.5 ${tones[tone]}`}>
                {value}
            </p>
            {sub && <p className="text-[11px] text-zinc-400 mt-0.5">{sub}</p>}
        </div>
    );
}

function Warning({ tone, icon: Icon, children }) {
    const tones = {
        loss: 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300',
        warn: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300',
        neutral: 'bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-300',
    };
    return (
        <div className={`flex items-start gap-2 p-3 rounded-xl text-xs font-bold ${tones[tone]}`}>
            <Icon size={15} className="mt-0.5 shrink-0" />
            <span>{children}</span>
        </div>
    );
}
