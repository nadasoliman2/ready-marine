'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useApp } from '../../../../../context/AppContext';
import { adminFinanceApi } from '../../../../../lib/api';
import {
    CARD, INPUT, LABEL, Money, StatCard, Spinner, EmptyState,
    money, fmtDate, fmtDateTime, toInputDate, TableWrap, Th, Td,
} from '../../../../../components/dashboard/finance/FinanceUI';
import PayoutsAccountCard from '../../../../../components/dashboard/finance/PayoutsAccountCard';
import {
    Wallet, CreditCard, Truck, Banknote, AlertTriangle, Loader2,
    Trash2, CheckCircle2, ArrowDownLeft, ArrowUpRight, Landmark, Building2,
} from 'lucide-react';

/**
 * Where the money is — and what came in, month by month.
 *
 * THE POINT OF THE SCREEN. The P&L says whether we made money. It never says where that
 * money physically is, and for this business it is in four places at once: customer wallets,
 * Fawaterak, Paymob, and the couriers' hands. Three of those owe us; one of them we owe.
 *
 * WHY NOTHING IS SUMMED INTO A SINGLE "TOTAL". Wallet balances are cash customers gave us
 * and can spend at any moment — a liability. Gateway and courier balances are money owed TO
 * us. One grand total would be the difference between two unrelated things, so the two
 * directions are shown apart and stay apart.
 */

const SOURCE_ICONS = { fawaterak: CreditCard, paymob: CreditCard };

export default function TreasuryPage() {
    const { language, siteSettings } = useApp();
    const isAr = language === 'ar';
    const currency = siteSettings?.currency || 'EGP';
    const locale = isAr ? 'ar-EG' : 'en-US';

    const [loading, setLoading] = useState(true);
    const [map, setMap] = useState(null);
    const [monthly, setMonthly] = useState(null);
    const [months, setMonths] = useState(12);
    const [view, setView] = useState('sold');
    const [error, setError] = useState('');

    const [openGateway, setOpenGateway] = useState(null);
    const [ledger, setLedger] = useState(null);
    const [ledgerLoading, setLedgerLoading] = useState(false);
    const [form, setForm] = useState({ amount: '', received_at: toInputDate(new Date()), reference: '', notes: '' });
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        try {
            const [treasury, monthlyData] = await Promise.all([
                adminFinanceApi.getTreasury(),
                adminFinanceApi.getTreasuryMonthly({ months }),
            ]);
            setMap(treasury);
            setMonthly(monthlyData);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [months]);

    useEffect(() => { load(); }, [load]);

    const loadLedger = useCallback(async (provider) => {
        setLedgerLoading(true);
        try {
            setLedger(await adminFinanceApi.getGatewayLedger(provider, { limit: 60 }));
        } catch (err) {
            setError(err.message);
        } finally {
            setLedgerLoading(false);
        }
    }, []);

    const openLedger = async (provider) => {
        if (openGateway === provider) { setOpenGateway(null); setLedger(null); return; }
        setOpenGateway(provider);
        await loadLedger(provider);
    };

    const submitPayout = async () => {
        if (!openGateway || !form.amount) return;
        setSaving(true);
        setError('');
        try {
            await adminFinanceApi.recordGatewayPayout({
                provider: openGateway,
                amount: Number(form.amount),
                received_at: form.received_at,
                reference: form.reference,
                notes: form.notes,
            });
            setForm({ amount: '', received_at: toInputDate(new Date()), reference: '', notes: '' });
            await Promise.all([load(), loadLedger(openGateway)]);
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const removePayout = async (id) => {
        if (!window.confirm(isAr
            ? 'هيترجع المبلغ ده للرصيد اللي عندهم. متأكد؟'
            : 'The amount goes back onto their balance. Are you sure?')) return;
        try {
            await adminFinanceApi.deleteGatewayPayout(id);
            await Promise.all([load(), loadLedger(openGateway)]);
        } catch (err) {
            setError(err.message);
        }
    };

    // The payment methods that actually appear in the window, so the table never carries an
    // empty "Bank transfer" column for a shop that has never taken one.
    const methodColumns = useMemo(() => {
        if (!monthly) return [];
        const seen = new Set();
        for (const m of monthly.months) {
            Object.keys(view === 'sold' ? m.sold.by_method : m.collected.by_method).forEach((k) => seen.add(k));
        }
        const order = ['cash', 'card_fawaterak', 'card_paymob', 'card_other', 'wallet', 'bank_transfer'];
        return order.filter((k) => seen.has(k));
    }, [monthly, view]);

    if (loading) return <Spinner />;

    const totals = map?.totals || {};
    const wallets = map?.wallets || {};

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-lg font-black text-zinc-900 dark:text-white">
                    {isAr ? 'الفلوس فين' : 'Money map'}
                </h2>
                <p className="text-sm text-zinc-500 mt-1">
                    {isAr
                        ? 'كل اللي اتدفع، قد إيه منه نزل البنك وقد إيه لسه برّه، ومنين بتيجي الفلوس كل شهر.'
                        : 'Everything paid, how much of it is in the bank and how much is still outside, and where money comes from each month.'}
                </p>
            </div>

            {error && (
                <div className="flex items-start gap-2 p-4 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 text-sm">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {/* ---- Everything ever paid, and where it is now ----
                 Total = in the bank + outside the bank + the fees kept on the way. */}
            {map?.paid && (
                <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                        <StatCard
                            label={isAr ? 'إجمالي اللي اتدفع' : 'Total paid'}
                            value={map.paid.total || 0}
                            currency={currency}
                            icon={Banknote}
                            tone="brand"
                            sub={isAr ? 'كل اللي العملاء دفعوه لحد دلوقتي، بأي طريقة' : 'Everything customers have paid so far, by any method'}
                            hint={isAr
                                ? 'كروت وكاش عند الاستلام وتحويلات الشركات. طلبات المحفظة مش متحسبة تاني، لأن فلوسها دخلت وقت شحن المحفظة.'
                                : 'Cards, cash on delivery and company transfers. Wallet-paid orders are not counted again — that money came in when the wallet was topped up.'}
                        />
                        <StatCard
                            label={isAr ? 'منها نزل البنك' : 'Of which in the bank'}
                            value={map.paid.in_bank || 0}
                            currency={currency}
                            icon={Landmark}
                            tone="profit"
                            sub={isAr ? 'تحويلات البوابات وشركات الشحن والشركات' : 'Transfers from gateways, couriers and companies'}
                        />
                        <StatCard
                            label={isAr ? 'منها لسه برّه البنك' : 'Of which outside the bank'}
                            value={map.paid.outside_bank || 0}
                            currency={currency}
                            icon={Truck}
                            tone={map.paid.outside_bank > 0 ? 'warn' : 'neutral'}
                            sub={isAr ? 'عند البوابات + عند شركات الشحن' : 'At the gateways + at the couriers'}
                        />
                        <StatCard
                            label={isAr ? 'عمولات اتخصمت في الطريق' : 'Fees kept on the way'}
                            value={map.paid.fees_kept || 0}
                            currency={currency}
                            icon={CreditCard}
                            sub={isAr ? 'عمولة البوابات + مصاريف شركات الشحن' : 'Gateway fees + courier charges'}
                            hint={isAr
                                ? 'الإجمالي = اللي في البنك + اللي برّه البنك + العمولات دي.'
                                : 'Total = in the bank + outside the bank + these fees.'}
                        />
                    </div>

                    <div className={`${CARD} overflow-x-auto`}>
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-[11px] uppercase tracking-wide text-zinc-500 border-b border-zinc-100 dark:border-white/5">
                                    <th className="px-5 py-3 text-start font-bold">{isAr ? 'اتدفع عن طريق' : 'Paid through'}</th>
                                    <th className="px-5 py-3 text-start font-bold">{isAr ? 'اتدفع' : 'Paid'}</th>
                                    <th className="px-5 py-3 text-start font-bold">{isAr ? 'في البنك' : 'In the bank'}</th>
                                    <th className="px-5 py-3 text-start font-bold">{isAr ? 'برّه البنك' : 'Outside the bank'}</th>
                                    <th className="px-5 py-3 text-start font-bold">{isAr ? 'عمولات' : 'Fees'}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                {[
                                    { key: 'gateways', label: isAr ? 'بوابات الدفع (كروت ومحافظ)' : 'Payment gateways (cards)', c: map.paid.by_channel.gateways },
                                    { key: 'couriers', label: isAr ? 'كاش عند الاستلام (شركات الشحن)' : 'Cash on delivery (couriers)', c: map.paid.by_channel.couriers },
                                    { key: 'company', label: isAr ? 'تحويلات فواتير الشركات' : 'Company invoice transfers', c: { ...map.paid.by_channel.company_invoices, in_bank: map.paid.by_channel.company_invoices.collected } },
                                    ...(map.paid.by_channel.bank_transfers.collected > 0
                                        ? [{ key: 'bank', label: isAr ? 'أوردرات بتحويل بنكي' : 'Orders by bank transfer', c: { ...map.paid.by_channel.bank_transfers, in_bank: map.paid.by_channel.bank_transfers.collected } }]
                                        : []),
                                ].map((row) => (
                                    <tr key={row.key}>
                                        <td className="px-5 py-3 font-bold text-zinc-900 dark:text-white">{row.label}</td>
                                        <td className="px-5 py-3 tabular-nums" dir="ltr">{money(row.c.collected || 0, currency, locale)}</td>
                                        <td className="px-5 py-3 tabular-nums text-emerald-600" dir="ltr">{money(row.c.in_bank || 0, currency, locale)}</td>
                                        <td className="px-5 py-3 tabular-nums" dir="ltr">{money(row.c.outside_bank || 0, currency, locale)}</td>
                                        <td className="px-5 py-3 tabular-nums text-zinc-500" dir="ltr">{money(row.c.fees || 0, currency, locale)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ---- The two directions, never added together ---- */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <StatCard
                    label={isAr ? 'مستحق لك برّه البنك' : 'Owed to you, outside the bank'}
                    value={totals.owed_to_us || 0}
                    currency={currency}
                    icon={Landmark}
                    tone="brand"
                    sub={isAr ? 'عند البوابات + عند شركات الشحن' : 'At the gateways + at the couriers'}
                />
                <StatCard
                    label={isAr ? 'عند بوابات الدفع' : 'At the payment gateways'}
                    value={totals.at_gateways || 0}
                    currency={currency}
                    icon={CreditCard}
                    sub={isAr ? 'اتحصّل ولسه ما اتحوّلش' : 'Collected, not yet transferred'}
                />
                <StatCard
                    label={isAr ? 'عند شركات الشحن' : 'At the couriers'}
                    value={totals.at_couriers || 0}
                    currency={currency}
                    icon={Truck}
                    sub={isAr ? 'كاش الأوردرات المسلّمة' : 'COD on delivered parcels'}
                />
                <StatCard
                    label={isAr ? 'رصيد محافظ العملاء' : 'Customer wallet balances'}
                    value={totals.owed_to_customers || 0}
                    currency={currency}
                    icon={Wallet}
                    tone="warn"
                    hint={isAr
                        ? 'ده التزام عليك مش فلوس ليك: كاش العملاء دفعوه وليهم يصرفوه أي وقت. عشان كده مش بيتجمع مع اللي فوق.'
                        : 'A liability, not an asset: cash customers paid and can spend at any time. Never added to the figures above.'}
                />
            </div>

            {/* ---- Company accounts (feature 14): credit we extended, billed monthly ----
                 On its own line and never inside "owed to you, outside the bank": that is money
                 a third party is holding for us, this is money a customer has not paid yet. */}
            {map?.companies && (map.companies.invoices_count > 0 || map.companies.not_yet_invoiced > 0) && (
                <div className="space-y-2">
                    <p className="text-sm font-black text-zinc-900 dark:text-white flex items-center gap-2">
                        <Building2 size={16} className="text-zinc-500" />
                        {isAr ? 'فواتير الشركات والجهات' : 'Corporate account invoices'}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
                        <StatCard
                            label={isAr ? 'إجمالي الفواتير' : 'Invoiced in total'}
                            value={map.companies.invoiced_total || 0}
                            currency={currency}
                            sub={isAr ? `${map.companies.invoices_count || 0} فاتورة` : `${map.companies.invoices_count || 0} invoice(s)`}
                        />
                        <StatCard
                            label={isAr ? 'اتدفع' : 'Paid'}
                            value={map.companies.paid_total || 0}
                            currency={currency}
                            tone="profit"
                            sub={isAr ? `${map.companies.invoices_paid || 0} فاتورة اتدفعت بالكامل` : `${map.companies.invoices_paid || 0} invoice(s) paid in full`}
                        />
                        <StatCard
                            label={isAr ? 'لسه ما اتدفعش' : 'Not paid yet'}
                            value={map.companies.invoiced_outstanding || 0}
                            currency={currency}
                            tone={map.companies.invoiced_outstanding > 0 ? 'warn' : 'neutral'}
                            sub={isAr ? `${map.companies.invoices_unpaid || 0} فاتورة لسه عليها فلوس` : `${map.companies.invoices_unpaid || 0} invoice(s) with a balance`}
                        />
                        <StatCard
                            label={isAr ? 'منها متأخر' : 'Of which overdue'}
                            value={map.companies.overdue || 0}
                            currency={currency}
                            tone={map.companies.overdue > 0 ? 'loss' : 'neutral'}
                        />
                        <StatCard
                            label={isAr ? 'لسه ما اتفوترش' : 'Not invoiced yet'}
                            value={map.companies.not_yet_invoiced || 0}
                            currency={currency}
                            sub={isAr ? 'أوردرات بتتفوتر في الشهر اللي تتسلّم فيه' : 'Orders invoiced in the month they are delivered'}
                        />
                    </div>
                </div>
            )}

            {/* ---- Each gateway, and its statement ---- */}
            <div className="space-y-4">
                {(map?.gateways || []).map((g) => {
                    const Icon = SOURCE_ICONS[g.provider] || CreditCard;
                    return (
                        <div key={g.provider} className={`${CARD} overflow-hidden`}>
                            <div className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-white/5 flex items-center justify-center">
                                        <Icon size={18} className="text-zinc-500" />
                                    </div>
                                    <div>
                                        <p className="font-black text-zinc-900 dark:text-white">{g.label}</p>
                                        <p className="text-[11px] text-zinc-500">
                                            {isAr ? `${g.payments} عملية دفع` : `${g.payments} payments`}
                                            {g.last_payout_at && (isAr
                                                ? ` · آخر تحويل ${fmtDate(g.last_payout_at, isAr)}`
                                                : ` · last transfer ${fmtDate(g.last_payout_at, isAr)}`)}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-6 flex-wrap">
                                    <Figure label={isAr ? 'محصّل' : 'Collected'} value={money(g.collected, currency, locale)} />
                                    <Figure label={isAr ? 'عمولتهم' : 'Their fees'} value={money(g.fees, currency, locale)} tone="loss" />
                                    <Figure label={isAr ? 'اتحوّل لك' : 'Transferred'} value={money(g.paid_out, currency, locale)} tone="good" />
                                    <Figure label={isAr ? 'لسه عندهم' : 'Still held'} value={money(g.held, currency, locale)} tone="brand" />
                                    <button
                                        onClick={() => openLedger(g.provider)}
                                        className="px-4 py-2 rounded-xl text-sm font-bold bg-marine-cyan text-white hover:bg-[#b91c1c] transition-colors"
                                    >
                                        {openGateway === g.provider
                                            ? (isAr ? 'إخفاء' : 'Hide')
                                            : (isAr ? 'كشف حساب' : 'Statement')}
                                    </button>
                                </div>
                            </div>

                            {g.estimated_fees > 0 && (
                                <p className="px-5 pb-4 -mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                                    {isAr
                                        ? `${g.estimated_fees} عملية ما جاش معاها رقم العمولة من البوابة، فاتحسبت بتعريفة فواتيرك (2% + 2 جنيه + ضريبة) وهي محسوبة في الرصيد.`
                                        : `${g.estimated_fees} payment(s) arrived without a fee figure and were priced at Fawaterak's rate (2% + 2 EGP, VAT included); they are in this balance.`}
                                </p>
                            )}
                            {g.unpriced_fees > 0 && (
                                <p className="px-5 pb-4 -mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                                    {isAr
                                        ? `${g.unpriced_fees} عملية ما جاش معاها رقم العمولة ومفيش تعريفة معروفة للبوابة دي — فالرصيد ده الحد الأدنى، ممكن يقل شوية.`
                                        : `${g.unpriced_fees} payment(s) arrived without a fee figure and this gateway has no known rate — this balance is a floor, the real one may be slightly lower.`}
                                </p>
                            )}

                            {openGateway === g.provider && (
                                <div className="border-t border-zinc-100 dark:border-white/5">
                                    {/* Record a transfer. A gateway pays in one lump against a stream of
                                        payments, so it is an amount against the balance, not a match
                                        against chosen rows the way a courier transfer is. */}
                                    <div className="p-5 bg-zinc-50 dark:bg-white/[0.02]">
                                        <p className="text-xs font-bold text-zinc-600 dark:text-zinc-300 mb-3">
                                            {isAr ? 'سجّل تحويل نزل البنك' : 'Record a transfer that reached the bank'}
                                        </p>
                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                            <div>
                                                <label className={LABEL}>{isAr ? 'المبلغ' : 'Amount'}</label>
                                                <input
                                                    type="number" step="0.01" dir="ltr"
                                                    value={form.amount}
                                                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                                                    className={`${INPUT} w-full`}
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
                                                    placeholder={isAr ? 'من كشف البنك' : 'From the bank statement'}
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
                                        <button
                                            onClick={submitPayout}
                                            disabled={saving || !form.amount}
                                            className="mt-4 flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-marine-cyan text-white hover:bg-[#b91c1c] transition-colors disabled:opacity-50"
                                        >
                                            {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                                            {isAr ? 'تسجيل التحويل' : 'Record transfer'}
                                        </button>
                                    </div>

                                    {ledgerLoading ? <Spinner /> : !ledger?.rows?.length ? (
                                        <EmptyState
                                            icon={Banknote}
                                            title={isAr ? 'مفيش حركات' : 'No movements'}
                                            message={isAr ? 'مفيش عمليات دفع اتسجلت على البوابة دي لسه.' : 'No payments have been recorded through this gateway yet.'}
                                        />
                                    ) : (
                                        <TableWrap>
                                            <table className="w-full">
                                                <thead className="bg-zinc-50 dark:bg-white/[0.02]">
                                                    <tr>
                                                        <Th>{isAr ? 'التاريخ' : 'Date'}</Th>
                                                        <Th>{isAr ? 'الحركة' : 'Movement'}</Th>
                                                        <Th align="right">{isAr ? 'المبلغ' : 'Amount'}</Th>
                                                        <Th align="right">{isAr ? 'العمولة' : 'Fee'}</Th>
                                                        <Th align="right">{isAr ? 'الصافي' : 'Net'}</Th>
                                                        <Th align="right">{isAr ? 'الرصيد بعدها' : 'Balance'}</Th>
                                                        <Th align="center" />
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                                    {ledger.rows.map((r, i) => (
                                                        <tr key={r.id || `${r.kind}-${i}`}>
                                                            <Td className="text-xs text-zinc-500">{fmtDateTime(r.at, isAr)}</Td>
                                                            <Td>
                                                                <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${r.kind === 'in' ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-600 dark:text-zinc-300'}`}>
                                                                    {r.kind === 'in' ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}
                                                                    {r.kind === 'in'
                                                                        ? (monthly?.source_labels?.[r.source]?.[isAr ? 'ar' : 'en'] || r.source)
                                                                        : r.destination === 'paymob_payouts'
                                                                            ? (isAr ? 'اتحوّل لرصيد Paymob Payouts' : 'Moved to the Paymob Payouts budget')
                                                                            : (isAr ? 'تحويل للبنك' : 'Transfer to bank')}
                                                                </span>
                                                                {r.reference && <span className="block text-[10px] text-zinc-400" dir="ltr">{r.reference}</span>}
                                                            </Td>
                                                            <Td align="right"><Money value={r.amount} currency={currency} /></Td>
                                                            <Td align="right" className="text-zinc-500 text-xs">
                                                                {r.kind === 'out'
                                                                    ? '—'
                                                                    : r.fee === null
                                                                        ? (isAr ? 'غير معروفة' : 'unknown')
                                                                        : r.fee_estimated
                                                                            ? (
                                                                                <span title={isAr ? 'محسوبة بتعريفة فواتيرك (2% + 2 جنيه + ضريبة) — البوابة ما بعتتش الرقم' : "Priced at Fawaterak's rate (2% + 2 EGP, VAT included) — the gateway sent no figure"}>
                                                                                    ≈ {money(r.fee, currency, locale)}
                                                                                </span>
                                                                            )
                                                                            : money(r.fee, currency, locale)}
                                                            </Td>
                                                            <Td align="right"><Money value={r.net} currency={currency} signed /></Td>
                                                            <Td align="right" className="font-bold"><Money value={r.balance} currency={currency} /></Td>
                                                            <Td align="center">
                                                                {/* A move to Payouts belongs to its top-up, and is undone there. */}
                                                                {r.kind === 'out' && !r.locked && (
                                                                    <button
                                                                        onClick={() => removePayout(r.id)}
                                                                        className="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                                                                        title={isAr ? 'تراجع' : 'Undo'}
                                                                    >
                                                                        <Trash2 size={14} />
                                                                    </button>
                                                                )}
                                                            </Td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </TableWrap>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* ---- The budget vendors are paid from: topped up by us, spent on their transfers ---- */}
            <PayoutsAccountCard isAr={isAr} currency={currency} locale={locale} onChanged={load} />

            {/* ---- Wallets, stated as what they are ---- */}
            <div className={`${CARD} p-5`}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <h3 className="font-black text-zinc-900 dark:text-white flex items-center gap-2">
                            <Wallet size={16} className="text-amber-500" />
                            {isAr ? 'محافظ العملاء' : 'Customer wallets'}
                        </h3>
                        <p className="text-xs text-zinc-500 mt-1 max-w-xl">
                            {isAr
                                ? 'الفلوس دي وصلتك فعلاً عن طريق البوابات لما العميل شحن، بس هي التزام عليك: العميل ليه يصرفها في أي أوردر، أو يطلب استردادها.'
                                : 'This cash did reach you through the gateways when customers topped up — but it is a liability: they can spend it on any order.'}
                        </p>
                    </div>
                    <div className="flex items-center gap-6 flex-wrap">
                        <Figure label={isAr ? 'متاح للصرف' : 'Spendable'} value={money(wallets.available, currency, locale)} tone="warn" />
                        <Figure label={isAr ? 'محجوز في أوردرات جارية' : 'Held by checkouts'} value={money(wallets.reserved, currency, locale)} />
                        <Figure label={isAr ? 'محافظ فيها رصيد' : 'Funded wallets'} value={String(wallets.funded_accounts || 0)} />
                    </div>
                </div>
            </div>

            {/* ---- Month by month ---- */}
            <div className={`${CARD} overflow-hidden`}>
                <div className="px-5 py-4 border-b border-zinc-100 dark:border-white/5 flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <h3 className="font-black text-zinc-900 dark:text-white">
                            {isAr ? 'شهر بشهر' : 'Month by month'}
                        </h3>
                        <p className="text-xs text-zinc-500 mt-0.5">
                            {view === 'sold'
                                ? (isAr ? 'الأوردرات اللي اتعملت في الشهر، بتاريخ الأوردر.' : 'Orders placed in the month, by order date.')
                                : (isAr ? 'الفلوس اللي وصلت فعلاً: الكارت وقت الدفع، والكاش وقت تسليم الشحنة.' : 'Money that actually arrived: card when paid, cash when the parcel was delivered.')}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex rounded-xl bg-zinc-100 dark:bg-white/5 p-1">
                            {[
                                { key: 'sold', ar: 'المبيعات', en: 'Sales' },
                                { key: 'collected', ar: 'الفلوس اللي دخلت', en: 'Cash in' },
                            ].map((t) => (
                                <button
                                    key={t.key}
                                    onClick={() => setView(t.key)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${view === t.key ? 'bg-white dark:bg-[#09090b] text-marine-primary shadow-sm' : 'text-zinc-500'}`}
                                >
                                    {isAr ? t.ar : t.en}
                                </button>
                            ))}
                        </div>
                        <select
                            value={months}
                            onChange={(e) => { setMonths(Number(e.target.value)); setLoading(true); }}
                            className={INPUT}
                        >
                            {[6, 12, 24, 36].map((n) => (
                                <option key={n} value={n} className="dark:bg-[#14171A]">
                                    {isAr ? `آخر ${n} شهر` : `Last ${n} months`}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {!monthly?.months?.length ? (
                    <EmptyState icon={Banknote} title={isAr ? 'مفيش بيانات' : 'No data'} />
                ) : (
                    <TableWrap>
                        <table className="w-full">
                            <thead className="bg-zinc-50 dark:bg-white/[0.02]">
                                <tr>
                                    <Th>{isAr ? 'الشهر' : 'Month'}</Th>
                                    {view === 'sold' && <Th align="center">{isAr ? 'أوردرات' : 'Orders'}</Th>}
                                    <Th align="right">{isAr ? 'الإجمالي' : 'Total'}</Th>
                                    {methodColumns.map((key) => (
                                        <Th key={key} align="right">
                                            {monthly.method_labels?.[key]?.[isAr ? 'ar' : 'en'] || key}
                                        </Th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                {[...monthly.months].reverse().map((m) => {
                                    const block = view === 'sold' ? m.sold : m.collected;
                                    return (
                                        <tr key={m.month} className="hover:bg-zinc-50 dark:hover:bg-white/[0.02]">
                                            <Td className="font-bold text-zinc-800 dark:text-zinc-200" dir="ltr">{m.month}</Td>
                                            {view === 'sold' && <Td align="center">{m.sold.orders}</Td>}
                                            <Td align="right" className="font-bold"><Money value={block.total} currency={currency} /></Td>
                                            {methodColumns.map((key) => {
                                                const cell = block.by_method[key];
                                                return (
                                                    <Td key={key} align="right">
                                                        {cell ? (
                                                            <>
                                                                <Money value={cell.amount} currency={currency} />
                                                                <span className="block text-[10px] text-zinc-400">
                                                                    {view === 'sold'
                                                                        ? (isAr ? `${cell.orders} أوردر` : `${cell.orders} orders`)
                                                                        : (isAr ? `${cell.payments} عملية` : `${cell.payments} payments`)}
                                                                </span>
                                                            </>
                                                        ) : <span className="text-zinc-300 dark:text-zinc-700">—</span>}
                                                    </Td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </TableWrap>
                )}

                <div className="px-5 py-3 border-t border-zinc-100 dark:border-white/5 text-[11px] text-zinc-500">
                    {view === 'sold'
                        ? (isAr
                            ? 'الأوردر المدفوع من المحفظة بيتحسب هنا كمبيعات، بس فلوسه مش بتتعد تاني في «الفلوس اللي دخلت» — لأنها دخلت قبل كده وقت شحن المحفظة.'
                            : 'A wallet-paid order counts as a sale here, but its money is not counted again under "Cash in" — it arrived earlier, at top-up.')
                        : (isAr
                            ? 'ده كل الفلوس اللي وصلت البوابات وشركات الشحن: أوردرات، شحن محافظ، اشتراكات تجار، ومستلزمات تغليف.'
                            : 'Every pound that reached a gateway or a courier: orders, wallet top-ups, vendor subscriptions and packaging supplies.')}
                </div>
            </div>
        </div>
    );
}

/** A small labelled figure, matching the courier screen so the two read as one module. */
function Figure({ label, value, tone = 'neutral' }) {
    const tones = {
        neutral: 'text-zinc-900 dark:text-white',
        loss: 'text-red-600 dark:text-red-400',
        good: 'text-emerald-600 dark:text-emerald-400',
        warn: 'text-amber-600 dark:text-amber-400',
        brand: 'text-marine-primary',
    };
    return (
        <div>
            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">{label}</p>
            <p dir="ltr" className={`text-sm font-black tabular-nums mt-0.5 ${tones[tone]}`}>{value}</p>
        </div>
    );
}
