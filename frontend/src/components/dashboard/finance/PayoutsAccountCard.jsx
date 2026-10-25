'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    Send, RefreshCw, Loader2, CheckCircle2, AlertTriangle, ArrowDownLeft, ArrowUpRight, Trash2, Banknote,
} from 'lucide-react';
import { adminFinanceApi } from '../../../lib/api';
import {
    CARD, INPUT, LABEL, Money, Spinner, EmptyState, money, fmtDateTime, toInputDate, TableWrap, Th, Td,
} from './FinanceUI';

/**
 * The Paymob Payouts account — the budget vendors are paid from — on the treasury screen.
 *
 * Its balance as our records add it up (top-ups in; transfers, their fees, and the fee of a
 * transfer the bank refused, out) beside Paymob's own. Equal, the books are right. Top-ups
 * are copied from Paymob every 30 minutes (and on "Sync"); one Paymob has not listed yet can
 * be entered by hand, and is linked rather than doubled when Paymob lists it.
 */

const SOURCE_LABELS = {
    bank_transfer: ['تحويل بنكي', 'Bank transfer'],
    bank_deposit: ['إيداع في البنك', 'Bank deposit'],
    accept_balance: ['من رصيد Paymob Accept', 'From the Paymob Accept balance'],
    other: ['أخرى', 'Other'],
};

const emptyForm = () => ({ amount: '', topped_up_at: toInputDate(new Date()), source: 'bank_transfer', reference: '', notes: '' });

export default function PayoutsAccountCard({ isAr, currency = 'EGP', locale = 'en-US', onChanged }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [open, setOpen] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const label = (key) => (SOURCE_LABELS[key] || SOURCE_LABELS.other)[isAr ? 0 : 1];

    const load = useCallback(async ({ fresh = false } = {}) => {
        try {
            setData(await adminFinanceApi.getPayoutsStatement({ limit: 100, ...(fresh ? { fresh: 1 } : {}) }));
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // Opened from the payouts screen's "Statement" link (#payouts-account): the card arrives
    // after the page, so the browser could not scroll to it — open the statement and go there.
    const arrived = useRef(false);
    useEffect(() => {
        if (!data || arrived.current || window.location.hash !== '#payouts-account') return;
        arrived.current = true;
        setOpen(true);
        document.getElementById('payouts-account')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [data]);

    const sync = async () => {
        setSyncing(true);
        setError('');
        setNotice('');
        try {
            const { sync: r } = await adminFinanceApi.syncPayoutsTopups();
            if (r?.ok === false) setError(r.error);
            else if (r?.configured === false) setError(isAr ? 'Paymob Payouts مش متظبط على السيرفر.' : 'Paymob Payouts is not configured on the server.');
            else {
                const added = (r?.created || 0) + (r?.linked || 0) + (r?.updated || 0);
                setNotice(added
                    ? (isAr ? `اتسجّل ${added} شحنة جديدة أو اتحدّثت.` : `${added} top-up(s) added or updated.`)
                    : (isAr ? 'مفيش شحنات جديدة عند Paymob.' : 'No new top-ups at Paymob.'));
            }
            await load({ fresh: true });
            onChanged?.();
        } catch (err) {
            setError(err.message);
        } finally {
            setSyncing(false);
        }
    };

    const submit = async () => {
        if (!form.amount) return;
        setSaving(true);
        setError('');
        setNotice('');
        try {
            await adminFinanceApi.recordPayoutsTopup({ ...form, amount: Number(form.amount) });
            setForm(emptyForm());
            await load();
            onChanged?.();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const remove = async (id) => {
        if (!window.confirm(isAr ? 'هتتشال الشحنة دي من الكشف. متأكد؟' : 'This top-up leaves the statement. Are you sure?')) return;
        try {
            await adminFinanceApi.deletePayoutsTopup(id);
            await load();
            onChanged?.();
        } catch (err) {
            setError(err.message);
        }
    };

    if (loading) return <div className={CARD}><Spinner /></div>;
    if (!data) return null;

    const live = data.live || {};
    const diff = data.difference;
    const matched = diff === 0;

    return (
        <div id="payouts-account" className={`${CARD} overflow-hidden scroll-mt-4`}>
            <div className="px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-white/5 flex items-center justify-center">
                        <Send size={18} className="text-zinc-500" />
                    </div>
                    <div>
                        <p className="font-black text-zinc-900 dark:text-white">
                            {isAr ? 'Paymob Payouts — رصيد تحويلات التجار' : 'Paymob Payouts — vendor transfers budget'}
                            {live.environment === 'staging' && <span className="ms-2 text-xs text-amber-600 font-bold">STAGING</span>}
                        </p>
                        <p className="text-[11px] text-zinc-500">
                            {isAr
                                ? 'بيزيد بالشحن، وبيقل بكل تحويل لتاجر وعمولته.'
                                : 'Grows with each top-up, shrinks with each vendor transfer and its fee.'}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-6 flex-wrap">
                    <Figure label={isAr ? 'رصيد Paymob الفعلي' : "Paymob's balance"}
                        value={live.balance == null ? '—' : money(live.balance, currency, locale)} tone="brand" />
                    <Figure label={isAr ? 'حسب سجلاتنا' : 'By our records'} value={money(data.balance, currency, locale)} />
                    <Figure label={isAr ? 'الفرق' : 'Difference'}
                        value={diff == null ? '—' : matched ? (isAr ? 'مطابق ✓' : 'Matches ✓') : money(diff, currency, locale)}
                        tone={diff == null ? 'neutral' : matched ? 'good' : 'warn'} />
                    <button onClick={sync} disabled={syncing}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/5 disabled:opacity-50">
                        <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
                        {isAr ? 'مزامنة مع Paymob' : 'Sync with Paymob'}
                    </button>
                    <button onClick={() => setOpen(!open)}
                        className="px-4 py-2 rounded-xl text-sm font-bold bg-marine-cyan text-white hover:bg-[#b91c1c] transition-colors">
                        {open ? (isAr ? 'إخفاء' : 'Hide') : (isAr ? 'كشف حساب' : 'Statement')}
                    </button>
                </div>
            </div>

            <div className="px-5 pb-4 -mt-1 space-y-1.5 text-[11px]">
                {live.error && (
                    <p className="text-red-600 dark:text-red-400">{isAr ? `تعذّر قراءة رصيد Paymob: ${live.error}` : `Could not read Paymob's balance: ${live.error}`}</p>
                )}
                {(data.waiting || []).map((w) => (
                    <p key={w.id} className="text-amber-600 dark:text-amber-400">
                        {isAr
                            ? `شحنة ${money(w.amount, currency, locale)} (${label(w.source)}) مستنية موافقة Paymob — هتدخل الرصيد أول ما تتوافق.`
                            : `A ${money(w.amount, currency, locale)} top-up (${label(w.source)}) awaits Paymob's approval — it joins the balance once approved.`}
                    </p>
                ))}
                {diff != null && !matched && (
                    <p className="text-amber-600 dark:text-amber-400">
                        {diff > 0
                            ? (isAr
                                ? `رصيد Paymob أكتر من سجلاتنا بـ ${money(diff, currency, locale)}: غالبًا شحنة لسه مش متسجّلة هنا، أو فلوس كانت في الحساب قبل ما السجلات تبدأ. لو ليها شحنة عند Paymob اعمل مزامنة، ولو لأ سجّلها بإيدك من «كشف حساب».`
                                : `Paymob holds ${money(diff, currency, locale)} more than our records: most likely a top-up not recorded here, or money in the account before these records start. Sync if Paymob lists it; otherwise enter it under "Statement".`)
                            : (isAr
                                ? `رصيد Paymob أقل من سجلاتنا بـ ${money(-diff, currency, locale)}: غالبًا شحنة اتسجّلت هنا بإيدك ولسه ما وصلتش Paymob، أو عمولة مش متسجّلة.`
                                : `Paymob holds ${money(-diff, currency, locale)} less than our records: most likely a top-up entered here that has not reached Paymob yet, or a fee not recorded.`)}
                    </p>
                )}
                {data.totals?.fees_unknown > 0 && (
                    <p className="text-zinc-500">
                        {isAr ? `${data.totals.fees_unknown} تحويل ما جاش معاه رقم العمولة من Paymob.` : `${data.totals.fees_unknown} transfer(s) came without a fee figure from Paymob.`}
                    </p>
                )}
                {data.last_sync && (
                    <p className={data.last_sync.ok === false ? 'text-red-600 dark:text-red-400' : 'text-zinc-400'}>
                        {data.last_sync.ok === false
                            ? (isAr ? `آخر مزامنة فشلت: ${data.last_sync.error}` : `The last sync failed: ${data.last_sync.error}`)
                            : (isAr ? `آخر مزامنة: ${fmtDateTime(data.last_sync.at, isAr)}` : `Last sync: ${fmtDateTime(data.last_sync.at, isAr)}`)}
                    </p>
                )}
                {notice && <p className="text-emerald-600 dark:text-emerald-400 font-bold">{notice}</p>}
                {error && (
                    <p className="flex items-start gap-1.5 text-red-600 dark:text-red-400 font-bold">
                        <AlertTriangle size={13} className="mt-0.5 shrink-0" />{error}
                    </p>
                )}
            </div>

            {open && (
                <div className="border-t border-zinc-100 dark:border-white/5">
                    <div className="p-5 bg-zinc-50 dark:bg-white/[0.02]">
                        <p className="text-xs font-bold text-zinc-600 dark:text-zinc-300">
                            {isAr ? 'سجّل شحنة بإيدك' : 'Enter a top-up by hand'}
                        </p>
                        <p className="text-[11px] text-zinc-500 mt-1 mb-3">
                            {isAr
                                ? 'الشحنات اللي Paymob بتسجّلها بتتنقل هنا لوحدها كل نص ساعة. سجّل بإيدك بس اللي لسه ما ظهرش عندهم — ولما يظهر، هيتربط بالسطر ده ومش هيتحسب مرتين.'
                                : 'Top-ups Paymob records are copied here on their own every 30 minutes. Enter only one that has not appeared there yet — when it does, it is linked to this row, never counted twice.'}
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                            <div>
                                <label className={LABEL}>{isAr ? 'المبلغ' : 'Amount'}</label>
                                <input type="number" step="0.01" min="0" dir="ltr" value={form.amount}
                                    onChange={(e) => setForm({ ...form, amount: e.target.value })} className={`${INPUT} w-full`} />
                            </div>
                            <div>
                                <label className={LABEL}>{isAr ? 'تاريخ الشحن' : 'Topped up on'}</label>
                                <input type="date" value={form.topped_up_at}
                                    onChange={(e) => setForm({ ...form, topped_up_at: e.target.value })} className={`${INPUT} w-full`} />
                            </div>
                            <div>
                                <label className={LABEL}>{isAr ? 'منين' : 'From'}</label>
                                <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className={`${INPUT} w-full`}>
                                    {Object.keys(SOURCE_LABELS).map((k) => <option key={k} value={k}>{label(k)}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className={LABEL}>{isAr ? 'رقم العملية' : 'Reference'}</label>
                                <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })}
                                    className={`${INPUT} w-full`} placeholder={isAr ? 'من البنك أو البورتال' : 'From the bank or the portal'} />
                            </div>
                            <div>
                                <label className={LABEL}>{isAr ? 'ملاحظات' : 'Notes'}</label>
                                <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={`${INPUT} w-full`} />
                            </div>
                        </div>
                        {form.source === 'accept_balance' && (
                            <p className="text-[11px] text-zinc-500 mt-2">
                                {isAr
                                    ? 'من رصيد Accept: المبلغ هيتخصم كمان من رصيد Paymob اللي فوق (اللي بنحصّل عليه)، لأنه اتنقل منه.'
                                    : 'From the Accept balance: the amount also leaves the Paymob balance above (the one we collect through), since it moved from there.'}
                            </p>
                        )}
                        <button onClick={submit} disabled={saving || !form.amount}
                            className="mt-4 flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-marine-cyan text-white hover:bg-[#b91c1c] transition-colors disabled:opacity-50">
                            {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                            {isAr ? 'سجّل الشحنة' : 'Record top-up'}
                        </button>
                    </div>

                    {!data.rows?.length ? (
                        <EmptyState icon={Banknote} title={isAr ? 'مفيش حركات' : 'No movements'}
                            message={isAr ? 'مفيش شحن ولا تحويلات متسجّلة على الحساب ده لسه.' : 'No top-ups or transfers are recorded on this account yet.'} />
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
                                    {data.rows.map((r) => (
                                        <tr key={`${r.kind}-${r.id || r.payout_id}`}>
                                            <Td className="text-xs text-zinc-500">{fmtDateTime(r.at, isAr)}</Td>
                                            <Td>{renderMovement(r, isAr, label)}</Td>
                                            <Td align="right">{r.kind === 'fee' ? <span className="text-xs text-zinc-400">—</span> : <Money value={r.amount} currency={currency} />}</Td>
                                            <Td align="right" className="text-zinc-500 text-xs">
                                                {r.kind === 'topup' ? '—' : r.fee_unknown ? (isAr ? 'غير معروفة' : 'unknown') : money(r.fee, currency, locale)}
                                            </Td>
                                            <Td align="right"><Money value={r.net} currency={currency} signed /></Td>
                                            <Td align="right" className="font-bold"><Money value={r.balance} currency={currency} /></Td>
                                            <Td align="center">
                                                {r.kind === 'topup' && r.origin === 'manual' && !r.paymob_topup_id && (
                                                    <button onClick={() => remove(r.id)} title={isAr ? 'تراجع' : 'Undo'}
                                                        className="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">
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
}

/** What a statement line is: a top-up, a transfer to a vendor, or the fee of one refused. */
function renderMovement(r, isAr, label) {
    if (r.kind === 'topup') {
        return (
            <>
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    <ArrowDownLeft size={13} />
                    {isAr ? `شحن رصيد · ${label(r.source)}` : `Top-up · ${label(r.source)}`}
                </span>
                <span className="block text-[10px] text-zinc-400">
                    {r.paymob_topup_id
                        ? (isAr ? `من Paymob #${r.paymob_topup_id}` : `From Paymob #${r.paymob_topup_id}`)
                        : (isAr ? 'متسجّل بإيد — لسه ما ظهرش عند Paymob' : 'Entered by hand — not listed by Paymob yet')}
                    {r.reference ? ` · ${r.reference}` : ''}
                    {r.notes ? ` · ${r.notes}` : ''}
                </span>
            </>
        );
    }
    return (
        <>
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-600 dark:text-zinc-300">
                <ArrowUpRight size={13} />
                {r.kind === 'fee'
                    ? (isAr ? `عمولة تحويل البنك رفضه · ${r.vendor}` : `Fee of a transfer the bank refused · ${r.vendor}`)
                    : (isAr ? `تحويل لتاجر · ${r.vendor}` : `Transfer to vendor · ${r.vendor}`)}
            </span>
            <span className="block text-[10px] text-zinc-400" dir="ltr">
                {r.payout_number}
                {r.kind === 'fee' && (isAr ? ' · المبلغ رجع للرصيد، العمولة لأ' : ' · the amount came back, the fee did not')}
            </span>
        </>
    );
}

/** A small labelled figure, as on the gateway cards above it. */
function Figure({ label, value, tone = 'neutral' }) {
    const tones = {
        neutral: 'text-zinc-900 dark:text-white',
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
