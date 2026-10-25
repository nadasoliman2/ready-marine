'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from '../../../../../../components/LocaleLink';
import { useParams } from 'next/navigation';
import { useApp } from '../../../../../../context/AppContext';
import { adminFinanceApi } from '../../../../../../lib/api';
import { CARD, INPUT, Spinner, fmtDateTime } from '../../../../../../components/dashboard/finance/FinanceUI';
import PayoutInvoice from '../../../../../../components/dashboard/finance/PayoutInvoice';
import { ArrowLeft, Printer, RefreshCw, Send, RotateCcw, XCircle, AlertTriangle, Loader2 } from 'lucide-react';
import Overlay from '../../../../../../components/Overlay';

/**
 * One payout: the invoice, the actions that can still change it, and every exchange with
 * Paymob. The actions shown depend on where the payout stands — nothing here can send the
 * same money twice (the server refuses), but the screen should not even offer it.
 */
export default function AdminPayoutPage() {
    const { id } = useParams();
    const { language, siteSettings } = useApp();
    const isAr = language === 'ar';
    const currency = siteSettings?.currency || 'EGP';

    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState('');
    const [message, setMessage] = useState('');
    const [resolveOpen, setResolveOpen] = useState(false);
    const [reason, setReason] = useState('');

    const load = useCallback(async () => {
        try {
            setData(await adminFinanceApi.getPayout(id));
        } catch (err) {
            setError(err.message || 'Failed to load payout');
        }
    }, [id]);

    useEffect(() => { load(); }, [load]);

    const run = async (key, fn, done) => {
        setBusy(key);
        setMessage('');
        try {
            const res = await fn();
            setMessage(done(res));
            await load();
        } catch (err) {
            setMessage(err.message || 'Action failed');
        } finally {
            setBusy('');
        }
    };

    if (error) return <div className={`${CARD} p-6 text-red-600 font-bold`}>{error}</div>;
    if (!data) return <Spinner />;

    const { invoice, gateway, history = [] } = data;
    const isPaymob = invoice.channel === 'paymob';
    const canRefresh = isPaymob && gateway?.sent_at && ['processing', 'paid'].includes(invoice.status);
    const canSend = isPaymob && invoice.status === 'approved' && !gateway?.sent_at;
    const canResolve = isPaymob && invoice.status === 'processing' && gateway?.outcome_unknown;
    const canRetry = isPaymob && invoice.status === 'failed';

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
                <Link href="/admin/dashboard/finance/payouts" className="inline-flex items-center gap-2 text-sm font-bold text-zinc-500 hover:text-marine-primary">
                    <ArrowLeft size={16} className={isAr ? 'rotate-180' : ''} /> {isAr ? 'كل التحويلات' : 'All payouts'}
                </Link>
                <div className="flex flex-wrap gap-2">
                    {canRefresh && (
                        <button onClick={() => run('refresh', () => adminFinanceApi.refreshPayout(id), (r) => r.found
                            ? (isAr ? 'تم التحديث من Paymob.' : 'Updated from Paymob.')
                            : (isAr ? 'Paymob لا يجد هذا التحويل حتى الآن.' : 'Paymob has no record of this transfer yet.'))}
                            disabled={!!busy} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-100 dark:bg-white/5 text-sm font-bold text-zinc-700 dark:text-zinc-300 disabled:opacity-50">
                            <RefreshCw size={15} className={busy === 'refresh' ? 'animate-spin' : ''} /> {isAr ? 'اسأل Paymob الآن' : 'Check with Paymob'}
                        </button>
                    )}
                    {canSend && (
                        <button onClick={() => run('send', () => adminFinanceApi.sendPayout(id), (r) => `${isAr ? 'النتيجة: ' : 'Result: '}${r.state}`)}
                            disabled={!!busy} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-marine-cyan text-white text-sm font-bold disabled:opacity-50">
                            <Send size={15} /> {isAr ? 'إرسال عبر Paymob' : 'Send via Paymob'}
                        </button>
                    )}
                    {canRetry && (
                        <button onClick={() => run('retry', () => adminFinanceApi.retryPayout(id), (r) => `${isAr ? 'تحويل جديد ' : 'New payout '}${r.payout?.withdrawal_number}: ${r.state}`)}
                            disabled={!!busy} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-marine-cyan text-white text-sm font-bold disabled:opacity-50">
                            <RotateCcw size={15} /> {isAr ? 'حاول تاني (تحويل جديد)' : 'Send again (new payout)'}
                        </button>
                    )}
                    {canResolve && (
                        <button onClick={() => setResolveOpen(true)} disabled={!!busy}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-red-300 text-red-600 text-sm font-bold disabled:opacity-50">
                            <XCircle size={15} /> {isAr ? 'اقفله كفاشل' : 'Close as failed'}
                        </button>
                    )}
                    <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-100 dark:bg-white/5 text-sm font-bold text-zinc-700 dark:text-zinc-300">
                        <Printer size={15} /> {isAr ? 'طباعة' : 'Print'}
                    </button>
                </div>
            </div>

            {message && <p className="p-4 rounded-xl bg-zinc-50 dark:bg-white/5 text-sm font-bold text-zinc-700 dark:text-zinc-300 print:hidden">{message}</p>}

            {gateway?.outcome_unknown && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 print:hidden">
                    <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-800 dark:text-amber-300">
                        {isAr
                            ? 'Paymob لم يرد وقت الإرسال، فمش معروف التحويل وصل ولا لأ. الفلوس محجوزة، والنظام بيسأل Paymob كل ١٠ دقايق ومش هيبعت مرة تانية أبدًا. لو عدّت نص ساعة وPaymob مش لاقيه، راجع لوحة Paymob ولو مش موجود اقفله كفاشل — الطلبات هترجع للمستحق.'
                            : 'Paymob did not answer when this was sent, so whether it went through is unknown. The money stays reserved; the system asks Paymob every 10 minutes and never re-sends. If Paymob still cannot find it after 30 minutes, check the Paymob dashboard and, if it is not there, close it as failed — the orders become payable again.'}
                    </p>
                </div>
            )}

            <PayoutInvoice data={data} isAr={isAr} currency={currency} />

            {isPaymob && gateway && (
                <div className={`${CARD} p-5 print:hidden`}>
                    <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-3">{isAr ? 'Paymob' : 'Paymob'}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                        <KV k={isAr ? 'رقم العملية' : 'Transaction'} v={gateway.transaction_id} mono />
                        <KV k={isAr ? 'مرجعنا' : 'Our reference'} v={gateway.client_reference_id} mono />
                        <KV k={isAr ? 'الحالة عند Paymob' : 'Paymob status'} v={[gateway.disbursement_status, gateway.status_code].filter(Boolean).join(' · ')} />
                        <KV k={isAr ? 'اتبعت' : 'Sent'} v={fmtDateTime(gateway.sent_at, isAr)} />
                        <KV k={isAr ? 'آخر مراجعة' : 'Last checked'} v={`${fmtDateTime(gateway.last_checked_at, isAr)}${gateway.check_count ? ` (${gateway.check_count})` : ''}`} />
                        <KV k={isAr ? 'رسوم Paymob (علينا)' : 'Paymob fee (ours)'} v={gateway.fees != null ? `${gateway.fees} + ${gateway.vat ?? 0} VAT` : '—'} />
                    </div>
                    {gateway.attempts?.length > 0 && (
                        <details className="mt-4">
                            <summary className="text-xs font-bold text-zinc-500 cursor-pointer">{isAr ? `سجل الاتصال (${gateway.attempts.length})` : `Exchange log (${gateway.attempts.length})`}</summary>
                            <ul className="mt-2 space-y-2">
                                {gateway.attempts.map((a, i) => (
                                    <li key={i} className="text-xs p-2 rounded-lg bg-zinc-50 dark:bg-white/[0.03]">
                                        <span className="font-bold">{a.kind}</span> · {fmtDateTime(a.at, isAr)}
                                        {a.http_status ? ` · HTTP ${a.http_status}` : ''}
                                        {a.disbursement_status ? ` · ${a.disbursement_status}` : ''}
                                        {a.status_code ? ` (${a.status_code})` : ''}
                                        {a.error ? <span className="text-red-600"> · {a.error}</span> : ''}
                                        {a.status_description ? <p className="text-zinc-500 mt-0.5" dir="auto">{a.status_description}</p> : null}
                                    </li>
                                ))}
                            </ul>
                        </details>
                    )}
                </div>
            )}

            {history.length > 0 && (
                <div className={`${CARD} p-5 print:hidden`}>
                    <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-3">{isAr ? 'السجل' : 'History'}</p>
                    <ol className="space-y-2">
                        {history.map((h, i) => (
                            <li key={i} className="text-sm">
                                <span className="font-bold text-zinc-900 dark:text-white">{h.title}</span>
                                <span className="text-zinc-500"> · {fmtDateTime(h.created_at, isAr)}{h.actor_label ? ` · ${h.actor_label}` : ''}</span>
                                {h.details && <p className="text-xs text-zinc-500">{h.details}</p>}
                            </li>
                        ))}
                    </ol>
                </div>
            )}

            {resolveOpen && (
                <Overlay className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => !busy && setResolveOpen(false)}>
                    <div className={`${CARD} w-full max-w-md p-6`} onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-black text-zinc-900 dark:text-white mb-2">{isAr ? 'اقفل التحويل كفاشل' : 'Close this transfer as failed'}</h3>
                        <p className="text-sm text-zinc-500 mb-4">
                            {isAr
                                ? 'اعمل ده بس بعد ما تتأكد من لوحة Paymob إن التحويل مش موجود. النظام هيسأل Paymob مرة أخيرة الأول — لو لقاه هياخد حالته الحقيقية.'
                                : 'Only after confirming in the Paymob dashboard that the transfer is not there. The system asks Paymob once more first — if it turns up, its real status wins.'}
                        </p>
                        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                            placeholder={isAr ? 'إيه اللي لقيته في لوحة Paymob؟' : 'What did the Paymob dashboard show?'}
                            className={`${INPUT} w-full resize-none mb-4`} />
                        <div className="flex gap-3">
                            <button onClick={() => setResolveOpen(false)} className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-100 dark:bg-white/5 font-bold text-sm">{isAr ? 'إلغاء' : 'Cancel'}</button>
                            <button disabled={!reason.trim() || !!busy}
                                onClick={() => run('resolve', () => adminFinanceApi.resolvePayoutFailed(id, { reason }), () => { setResolveOpen(false); return isAr ? 'اتقفل كفاشل والطلبات رجعت للمستحق.' : 'Closed as failed; the orders are payable again.'; })}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-marine-cyan text-white font-black text-sm disabled:opacity-50">
                                {busy === 'resolve' && <Loader2 size={15} className="animate-spin" />} {isAr ? 'تأكيد' : 'Confirm'}
                            </button>
                        </div>
                    </div>
                </Overlay>
            )}
        </div>
    );
}

function KV({ k, v, mono = false }) {
    return (
        <div className="flex justify-between gap-3 py-1 border-b border-zinc-100 dark:border-white/5">
            <span className="text-zinc-500">{k}</span>
            <span className={`text-zinc-900 dark:text-white text-end break-all ${mono ? 'font-mono text-xs' : ''}`}>{v || '—'}</span>
        </div>
    );
}
