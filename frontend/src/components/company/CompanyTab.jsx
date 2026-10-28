'use client';

import { storeUrl } from '../../lib/storeLink';
import { useEffect, useState } from 'react';
import Link from '../LocaleLink';
import { useSearchParams } from 'next/navigation';
import { Building2, Wallet, MapPin, Layers, Loader2, LayoutDashboard, Truck, Zap, AlertCircle, ShoppingBag, Share2, XCircle, Users, PauseCircle, CheckCircle2, CreditCard } from 'lucide-react';
import { myCompanyApi, userApi, walletApi, COMPANY_SCOPE_KEY } from '../../lib/api';
import { formatMoney, formatDate, errorText, limitSourceLabel, formatLimit } from '../../lib/companyLocalization';
import useMyCompany from './useMyCompany';
import BatchProgress from './BatchProgress';
import { orgTerms } from '../../lib/orgTerms';
import { useActiveOrgType } from './OrgTermsContext';

/**
 * "My company" — the person's view of every company they belong to: for each, the
 * limit, what is left of it this month and when it renews, and the way into the
 * company portal for a manager. There is no "leave": when someone leaves the job,
 * the company's manager deactivates them.
 */
export default function CompanyTab({ isAr }) {
    const { membership, memberships, loading, refresh } = useMyCompany();
    // The words of the person's (first) account: a property's residents, a company's employees.
    const ot = orgTerms(membership?.company?.org_type, isAr);
    useActiveOrgType(membership?.company?.org_type);
    const [error, setError] = useState('');
    const [orders, setOrders] = useState(null);
    const [batchRows, setBatchRows] = useState(null);
    const [busyParcel, setBusyParcel] = useState('');

    const loadBatches = () => myCompanyApi.getBatches().then((res) => setBatchRows(res.rows || [])).catch(() => setBatchRows([]));

    const isEmployeeAnywhere = (memberships || []).some((m) => m.is_employee);
    const loadOrders = () => myCompanyApi.getOrders().then((res) => setOrders(res.rows || [])).catch(() => setOrders([]));
    useEffect(() => {
        if (!isEmployeeAnywhere) return;
        loadOrders();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEmployeeAnywhere]);

    /* ---- Paying a company order yourself ("settle") ----
     * From the wallet; if it is short, the difference is topped up by card first and the
     * payment page brings the person back here (?settle=<order>) to finish. If they never
     * come back the money simply waits in their wallet. */
    const searchParams = useSearchParams();
    const [settling, setSettling] = useState(null); // { orderId, amount, wallet }
    const [settleBusy, setSettleBusy] = useState(false);
    const [notice, setNotice] = useState('');

    const openSettle = async (order) => {
        setError('');
        setNotice('');
        try {
            const wallet = await walletApi.get();
            setSettling({ orderId: order._id, amount: order.settle.amount, wallet });
        } catch (err) {
            setError(errorText(err, isAr));
        }
    };

    const settleNow = async (orderId) => {
        setSettleBusy(true);
        setError('');
        try {
            const res = await myCompanyApi.settle(orderId);
            const paid = formatMoney(res.amount, isAr);
            setNotice(res.limit_restored
                ? (isAr ? `دفعت ${paid} من محفظتك، والمبلغ رجع لليميت بتاعك.` : `You paid ${paid} from your wallet, and it is back on your limit.`)
                : (isAr ? `دفعت ${paid} من محفظتك، والمبلغ هيتخصم من فاتورة ${ot.the} الجاية.` : `You paid ${paid} from your wallet; it comes off the ${ot.one}'s next invoice.`));
            setSettling(null);
            await Promise.all([loadOrders(), refresh()]);
        } catch (err) {
            setError(errorText(err, isAr));
        } finally {
            setSettleBusy(false);
        }
    };

    const topUpAndSettle = async (orderId, shortfall) => {
        setSettleBusy(true);
        setError('');
        try {
            const result = await walletApi.createTopup({ amount: shortfall, origin: 'wallet', return_path: `/profile?tab=company&settle=${orderId}` });
            if (result?.paymentUrl) {
                window.location.href = result.paymentUrl;
                return;
            }
            setError(isAr ? 'مقدرناش نفتح صفحة الدفع. جرّب تاني.' : 'Could not open the payment page. Try again.');
        } catch (err) {
            setError(errorText(err, isAr));
        }
        setSettleBusy(false);
    };

    // Back from the payment page: confirm the top-up, then finish the settlement.
    useEffect(() => {
        const orderId = searchParams.get('settle');
        if (!orderId || !isEmployeeAnywhere) return;
        const status = searchParams.get('topup');
        const topupId = searchParams.get('topupId');
        const clean = () => {
            const url = new URL(window.location.href);
            ['settle', 'topup', 'topupId'].forEach((k) => url.searchParams.delete(k));
            window.history.replaceState({}, '', url.toString());
        };
        clean();
        (async () => {
            if (status !== 'success' || !topupId) {
                setError(isAr ? 'الدفع ماكملش، ومفيش حاجة اتخصمت.' : 'The payment did not go through; nothing was charged.');
                return;
            }
            try {
                const res = await walletApi.confirmTopup({ topupId });
                if (res?.status !== 'paid') {
                    setNotice(isAr ? 'الدفع لسه بيتأكد. أول ما الفلوس توصل محفظتك اضغط "ادفعه أنا" تاني.' : 'The payment is still being confirmed. Once it reaches your wallet, press "Pay it myself" again.');
                    return;
                }
                await settleNow(orderId);
            } catch (err) {
                setError(errorText(err, isAr));
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEmployeeAnywhere]);

    useEffect(() => {
        if (!membership) return;
        loadBatches();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [membership?.company?._id]);

    const parcelAction = async (row, action) => {
        const text = action === 'ship'
            ? (isAr ? 'تبعته دلوقتي لوحده؟ هيخرج من الدفعة ويتحرك فوراً بالشحن الكامل، ومش هيرجعلك توفير.' : 'Send it now on its own? It leaves the batch at full shipping — no saving comes back.')
            : (isAr ? 'تلغي الأوردر ده؟ المبلغ كله هيرجع لليميت.' : 'Cancel this order? The whole amount goes back to your limit.');
        if (!confirm(text)) return;
        setBusyParcel(String(row.sub_order_id));
        setError('');
        try {
            if (action === 'ship') await myCompanyApi.shipNow(row.order_id, row.sub_order_id);
            else await userApi.cancelParcel(row.order_id, row.sub_order_id);
            await Promise.all([loadBatches(), refresh()]);
        } catch (err) {
            setError(errorText(err, isAr));
        } finally {
            setBusyParcel('');
        }
    };

    const shareWithColleagues = (row) => {
        // Encoded: a username with a space ("x-turbo auto parts") cut the link short in WhatsApp.
        const key = row.vendor_slug || row.vendor_username;
        const link = key ? storeUrl(key, window.location.origin) : window.location.origin;
        const text = isAr
            ? `أنا طالب من ${row.vendor_name || 'المتجر ده'} على حساب ${ot.the}. لو محتاج حاجة منه اطلبها دلوقتي بالتجميع على ${ot.theBranch} عشان نتشحن مع بعض ونوفّر في الشحن: ${link}`
            : `I ordered from ${row.vendor_name || 'this store'} on the ${ot.one} account. Need anything from it? Order now with "consolidate to ${ot.branch}" so we ship together and save: ${link}`;
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    };

    if (loading) {
        return <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-marine-primary" /></div>;
    }

    if (!membership) {
        return (
            <div className="text-center py-12">
                <Building2 size={40} className="text-zinc-400 mx-auto mb-3" />
                <p className="text-zinc-900 font-bold">{isAr ? `مش تابع لحساب ${ot.one}` : `You are not part of ${ot.aOne} account`}</p>
                <p className="text-zinc-500 text-sm mt-1">{isAr ? `لو ${ot.your} ${ot.v('مشتركة', 'مشترك')} في Ready Marine، هتوصلك دعوة على الإيميل أو الواتساب.` : `If your ${ot.one} uses Ready Marine, you will get an invitation by email or WhatsApp.`}</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-600 rounded-xl text-sm font-bold flex items-start gap-3">
                    <AlertCircle size={18} className="mt-0.5 shrink-0" /> {error}
                </div>
            )}

            {notice && (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 rounded-xl text-sm font-bold flex items-start gap-3">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> {notice}
                </div>
            )}

            {memberships.map((m) => <MembershipCard key={m.company._id} membership={m} isAr={isAr} />)}

            {batchRows && batchRows.some((r) => r.waiting) && (
                <div className="bg-zinc-50/70 border border-sky-500/20 rounded-2xl p-5">
                    <p className="text-zinc-900 font-bold mb-1 flex items-center gap-2"><Users size={16} className="text-sky-500" />{isAr ? 'أوردرات مستنية زمايلك' : 'Orders waiting for colleagues'}</p>
                    <p className="text-xs text-zinc-500 mb-4">{isAr ? 'كل ما الدفعة تكمل أسرع، بتتحرك أسرع وبتوفّر أكتر.' : 'The sooner a batch fills, the sooner it ships and the more you save.'}</p>
                    <ul className="space-y-4">
                        {batchRows.filter((r) => r.waiting).map((row) => {
                            const busy = busyParcel === String(row.sub_order_id);
                            return (
                                <li key={row.sub_order_id} className="rounded-xl bg-white border border-zinc-200 p-4 space-y-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-sm font-bold text-zinc-900 truncate">{row.vendor_name}</p>
                                            <p className="text-[11px] text-zinc-500 truncate">{row.items.map((i) => `${i.title} × ${i.quantity}`).join('، ')}</p>
                                        </div>
                                        <span className="text-[11px] text-zinc-500 shrink-0" dir="ltr">{row.reference}</span>
                                    </div>
                                    {row.batch && (
                                        <BatchProgress waiting={row.batch.waiting_count} target={row.batch.target_count} deadline={row.batch.deadline_at} isAr={isAr} />
                                    )}
                                    <div className="flex flex-wrap gap-2">
                                        <button onClick={() => shareWithColleagues(row)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-bold text-white transition">
                                            <Share2 size={12} />{isAr ? 'قول لزمايلك' : 'Tell colleagues'}
                                        </button>
                                        <button onClick={() => parcelAction(row, 'ship')} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-sm font-bold text-zinc-800 transition disabled:opacity-50">
                                            {busy ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}{isAr ? 'ابعته دلوقتي' : 'Ship it now'}
                                        </button>
                                        <button onClick={() => parcelAction(row, 'cancel')} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 hover:bg-red-500/10 text-sm font-bold text-red-500 transition disabled:opacity-50">
                                            <XCircle size={12} />{isAr ? 'إلغاء' : 'Cancel'}
                                        </button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}

            {batchRows && batchRows.some((r) => !r.waiting && r.savings > 0) && (
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-5">
                    <p className="text-zinc-900 font-bold flex items-center gap-2"><Truck size={16} className="text-emerald-600" />{isAr ? 'وفّرت بالتجميع' : 'Saved by consolidating'}</p>
                    <p className="text-2xl font-black text-emerald-600 mt-1 tabular-nums" dir="ltr">
                        {formatMoney(batchRows.filter((r) => !r.waiting).reduce((sum, r) => sum + Number(r.savings || 0), 0), isAr)}
                    </p>
                    <p className="text-xs text-zinc-500 mt-1">{isAr ? 'في آخر أوردراتك المجمّعة — رجعولك لليميت.' : 'On your recent consolidated orders — back on your limit.'}</p>
                </div>
            )}

            {isEmployeeAnywhere && (
                <div className="bg-zinc-50/70 border border-zinc-200/80 rounded-2xl p-5">
                    <p className="text-zinc-900 font-bold mb-3 flex items-center gap-2"><ShoppingBag size={16} className="text-marine-primary" />{isAr ? `أوردراتي على حساب ${ot.the}` : `My orders on the ${ot.one} account`}</p>
                    {orders === null ? (
                        <Loader2 size={18} className="animate-spin text-zinc-500" />
                    ) : orders.length === 0 ? (
                        <p className="text-sm text-zinc-500">{isAr ? `لسه ماطلبتش حاجة على حساب ${ot.the}.` : `Nothing ordered on the ${ot.one} account yet.`}</p>
                    ) : (
                        <ul className="divide-y divide-zinc-200/80">
                            {orders.map((row) => (
                                <li key={row._id} className="py-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-sm text-zinc-900 truncate">
                                            {(row.order?.items || []).map((i) => `${i.title} × ${i.quantity}`).join('، ') || '—'}
                                        </p>
                                        <p className="text-[11px] text-zinc-500">
                                            {memberships.length > 1 && row.company_name ? `${row.company_name} · ` : ''}
                                            {formatDate(row.created_at, isAr)} · <span dir="ltr">{row.order?.reference}</span>
                                            {row.kind === 'credit' && <span className="text-emerald-600"> · {isAr ? 'مرتجع / إلغاء' : 'Return / cancellation'}</span>}
                                        </p>
                                    </div>
                                    <div className="text-end shrink-0">
                                        <p className={`text-sm font-bold tabular-nums ${row.kind === 'credit' ? 'text-emerald-600' : 'text-zinc-900'}`} dir="ltr">{formatMoney(row.amount, isAr)}</p>
                                        {row.personal_amount ? <p className="text-[11px] text-zinc-500" dir="ltr">+ {formatMoney(row.personal_amount, isAr)} {isAr ? 'منك' : 'by you'}</p> : null}
                                        {row.order?.settle && !row.order.settle.blocked && settling?.orderId !== row.order._id && (
                                            <button onClick={() => openSettle(row.order)} className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-[11px] font-bold text-zinc-800 transition">
                                                <Wallet size={11} />{isAr ? 'ادفعه أنا' : 'Pay it myself'}
                                            </button>
                                        )}
                                        {row.order?.settle?.settled && row.order.settle.blocked === 'NOTHING_TO_SETTLE' && (
                                            <p className="mt-1 text-[11px] font-bold text-emerald-600">{isAr ? 'دفعته إنت' : 'Paid by you'}</p>
                                        )}
                                    </div>
                                </div>
                                {settling && settling.orderId === row.order?._id && (
                                    <SettlePanel settling={settling} busy={settleBusy} isAr={isAr} ot={ot}
                                        onPay={() => settleNow(settling.orderId)}
                                        onTopUp={(shortfall) => topUpAndSettle(settling.orderId, shortfall)}
                                        onClose={() => setSettling(null)} />
                                )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

        </div>
    );
}

/** The confirm step of "Pay it myself": from the wallet, or top up the difference first. */
function SettlePanel({ settling, busy, isAr, ot, onPay, onTopUp, onClose }) {
    const amount = Number(settling.amount || 0);
    const balance = Number(settling.wallet?.balances?.spendable || 0);
    const shortfall = Math.max(0, Math.ceil((amount - balance) * 100) / 100);
    const canTopUp = !!settling.wallet?.topup_enabled;
    return (
        <div className="mt-3 rounded-xl bg-zinc-50 border border-zinc-200 p-4 space-y-3 text-sm">
            <p className="text-zinc-900 font-bold">{isAr ? `هتدفع ${formatMoney(amount, isAr)} بنفسك بدل ${ot.the}` : `You pay ${formatMoney(amount, isAr)} yourself instead of the ${ot.one}`}</p>
            <p className="text-xs text-zinc-600 leading-relaxed">
                {isAr
                    ? `المبلغ ده بيرجع لليميت بتاعك وبيتشال من حساب ${ot.the}. ولو الأوردر اتلغى أو رجع بعد كده، الفلوس بترجع لمحفظتك إنت.`
                    : `It goes back onto your limit and off the ${ot.one}'s account. If the order is later cancelled or returned, the money comes back to your wallet.`}
            </p>
            <p className="text-xs text-zinc-600">{isAr ? 'رصيد محفظتك:' : 'Your wallet balance:'} <span className="text-zinc-900 font-bold" dir="ltr">{formatMoney(balance, isAr)}</span></p>
            <div className="flex flex-wrap gap-2">
                {shortfall <= 0 ? (
                    <button onClick={onPay} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-marine-cyan hover:bg-marine-cyan-dark text-sm font-bold text-white transition disabled:opacity-50">
                        {busy ? <Loader2 size={12} className="animate-spin" /> : <Wallet size={12} />}{isAr ? 'ادفع من المحفظة' : 'Pay from wallet'}
                    </button>
                ) : canTopUp ? (
                    <button onClick={() => onTopUp(shortfall)} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-marine-cyan hover:bg-marine-cyan-dark text-sm font-bold text-white transition disabled:opacity-50">
                        {busy ? <Loader2 size={12} className="animate-spin" /> : <CreditCard size={12} />}
                        {isAr ? `ادفع ${formatMoney(shortfall, isAr)} بالكارت أو أي وسيلة دفع` : `Pay ${formatMoney(shortfall, isAr)} by card or another method`}
                    </button>
                ) : (
                    <p className="text-xs text-amber-700">{isAr ? 'رصيدك مش كفاية، وشحن المحفظة مقفول دلوقتي.' : 'Your balance is short and wallet top-ups are off right now.'}</p>
                )}
                <button onClick={onClose} disabled={busy} className="px-3 py-1.5 rounded-lg text-sm text-zinc-500 hover:text-zinc-900">{isAr ? 'رجوع' : 'Back'}</button>
            </div>
            {shortfall > 0 && balance > 0 && canTopUp && (
                <p className="text-[11px] text-zinc-500">{isAr ? `الـ ${formatMoney(balance, isAr)} اللي في محفظتك هتتحسب، وهتدفع الباقي بس.` : `The ${formatMoney(balance, isAr)} already in your wallet counts; you pay only the rest.`}</p>
            )}
        </div>
    );
}

/** One company the person belongs to: roles, their limit there, office, group, delivery options. */
function MembershipCard({ membership, isAr }) {
    const ot = orgTerms(membership.company?.org_type, isAr);
    // No limit of their own (the company switched employee limits off): only its cap stands.
    const noLimit = membership.limit === null || membership.limit === undefined;
    const used = !noLimit && membership.limit > 0 ? Math.min(100, Math.round((membership.spent / membership.limit) * 100)) : 0;
    const suspended = membership.company.status === 'suspended';
    const openPortal = () => {
        try { window.localStorage.setItem(COMPANY_SCOPE_KEY, membership.company._id); } catch (_) { /* private mode */ }
    };

    return (
        <div className="space-y-4 rounded-3xl border border-zinc-200/80 bg-zinc-50/70 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-marine-cyan/15 text-marine-primary flex items-center justify-center"><Building2 size={24} /></div>
                    <div>
                        <h2 className="text-xl font-black text-zinc-900">{membership.company.name}</h2>
                        <p className="text-xs text-zinc-500">
                            {[membership.is_employee && (isAr ? `${ot.member}` : `${ot.Member}`), membership.is_manager && (isAr ? 'مدير الحساب' : 'Account manager')].filter(Boolean).join(' · ')}
                        </p>
                    </div>
                </div>
                {membership.is_manager && (
                    <Link href="/company" onClick={openPortal} className="inline-flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold px-4 py-2.5 rounded-xl text-sm transition-all shadow-sm">
                        <LayoutDashboard size={16} /> {isAr ? `لوحة ${ot.the}` : `${ot.One} portal`}
                    </Link>
                )}
            </div>

            {suspended && (
                <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-amber-800 rounded-xl text-sm font-bold">
                    {isAr ? `الطلب على حساب ${ot.the} موقوف مؤقتاً.` : `Ordering on the ${ot.one} account is temporarily paused.`}
                </div>
            )}
            {membership.company.status === 'ended' && (
                <div className="p-4 bg-zinc-100 border border-zinc-200 text-zinc-700 rounded-xl text-sm font-bold">
                    {isAr ? `العقد مع Ready Marine انتهى — لوحة ${ot.the} مفتوحة للفواتير والسداد بس.` : 'The contract with Ready Marine has ended — the portal stays open for invoices and payments only.'}
                </div>
            )}
            {membership.is_employee && membership.deactivated && (
                <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-amber-800 rounded-xl text-sm font-bold flex items-start gap-2">
                    <PauseCircle size={18} className="shrink-0 mt-0.5" />
                    {isAr
                        ? `مدير حساب ${ot.the} وقّف طلبك على ${ot.v('حسابها', 'حسابه')}. كلّمه لو ده غلط. الأوردرات اللي طلبتها قبل كده بتكمل عادي.`
                        : `Your ${ot.one}'s manager has paused your ordering on its account. Contact them if this is a mistake. Orders already placed continue.`}
                </div>
            )}

            {membership.is_employee && !membership.deactivated && (
                <div className="bg-white border border-zinc-200/80 rounded-2xl p-5 shadow-sm">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-1.5"><Wallet size={12} />{isAr ? 'فاضلك الشهر ده' : 'Left this month'}</p>
                            <p className="text-3xl font-black text-zinc-900 mt-1 tabular-nums" dir="ltr">{noLimit ? formatLimit(null, isAr) : formatMoney(membership.remaining, isAr)}</p>
                        </div>
                        <p className="text-xs text-zinc-600">
                            {noLimit
                                ? (isAr ? `مفيش ليميت خاص بيك — بتطلب لحد السقف الشهري ${ot.toThe}.` : `No limit of your own — you may order up to the ${ot.one}'s monthly cap.`)
                                : isAr
                                    ? `من ${formatMoney(membership.limit, true)} — ${limitSourceLabel(membership.limit_source, true)}`
                                    : `of ${formatMoney(membership.limit, false)} — ${limitSourceLabel(membership.limit_source, false)}`}
                        </p>
                    </div>
                    {!noLimit && (
                        <div className="mt-4 h-2 rounded-full bg-zinc-200 overflow-hidden">
                            <div className="h-full bg-marine-cyan rounded-full" style={{ width: `${used}%` }} />
                        </div>
                    )}
                    <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-zinc-500">
                        <span>{isAr ? `صرفت ${formatMoney(membership.spent, true)}` : `Spent ${formatMoney(membership.spent, false)}`}</span>
                        <span>{isAr ? `بيتجدد ${formatDate(membership.renews_on, true)}` : `Renews ${formatDate(membership.renews_on, false)}`}</span>
                    </div>
                    <p className="text-xs text-zinc-500 mt-3">
                        {isAr
                            ? 'الليميت شامل الشحن، واللي مايتصرفش في الشهر مش بيتنقل للشهر الجاي. لو الأوردر أكبر من اللي فاضل، اطلبه من حسابك بطريقة دفع تانية.'
                            : 'The limit includes shipping; whatever is unspent does not carry over. An order bigger than what is left is placed from your own account with another payment method.'}
                    </p>
                </div>
            )}

            <div className="grid sm:grid-cols-2 gap-4">
                {membership.office && (
                    <InfoCard icon={MapPin} label={isAr ? `${ot.theBranch}` : `${ot.Branch}`} value={membership.office.name} sub={membership.office.full_address} />
                )}
                {membership.is_employee && (
                    <InfoCard icon={Layers} label={isAr ? 'الجروب' : 'Group'} value={membership.group?.name || (isAr ? 'من غير جروب' : 'No group')} />
                )}
            </div>

            {membership.is_employee && !membership.deactivated && (
                <div className="bg-white border border-zinc-200/80 rounded-2xl p-5 shadow-sm">
                    <p className="text-zinc-900 font-bold mb-3">{isAr ? 'طرق التوصيل المتاحة' : 'Delivery options'}</p>
                    <ul className="space-y-3 text-sm">
                        {membership.modes.consolidate && (
                            <li className="flex items-start gap-3 text-zinc-600">
                                <Truck size={18} className="text-emerald-600 mt-0.5 shrink-0" />
                                <span>
                                    <strong className="text-zinc-900">{isAr ? `تجميع على ${ot.theBranch} — أوفر` : `Consolidate to ${ot.branch} — cheaper`}</strong><br />
                                    {isAr ? `أوردرك بيستنى زمايلك اللي طالبين من نفس المورد، ويتشحن معاهم طرد واحد على ${ot.theBranch} والشحن بيتقسم عليكم.` : `Your order waits for colleagues ordering from the same vendor and ships with them as one parcel to the ${ot.branch}, splitting the shipping.`}
                                </span>
                            </li>
                        )}
                        {membership.modes.instant && (
                            <li className="flex items-start gap-3 text-zinc-600">
                                <Zap size={18} className="text-amber-500 mt-0.5 shrink-0" />
                                <span>
                                    <strong className="text-zinc-900">{isAr ? 'فوري' : 'Instant'}</strong><br />
                                    {isAr ? `بيتحرك على طول بشحن كامل، على البيت أو ${ot.theBranch}.` : `Ships right away with full shipping, to home or the ${ot.branch}.`}
                                </span>
                            </li>
                        )}
                    </ul>
                </div>
            )}
        </div>
    );
}

function InfoCard({ icon: Icon, label, value, sub }) {
    return (
        <div className="bg-white border border-zinc-200/80 rounded-2xl p-4 shadow-sm">
            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-1.5"><Icon size={12} />{label}</p>
            <p className="text-zinc-900 font-bold mt-1">{value}</p>
            {sub && <p className="text-xs text-zinc-500 mt-0.5">{sub}</p>}
        </div>
    );
}
