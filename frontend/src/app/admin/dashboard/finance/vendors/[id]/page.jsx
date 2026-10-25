'use client';

import { useEffect, useState, useCallback, useMemo, Fragment } from 'react';
import Link from '../../../../../../components/LocaleLink';
import { useParams } from 'next/navigation';
import { useApp } from '../../../../../../context/AppContext';
import { adminFinanceApi } from '../../../../../../lib/api';
import usePageSize from '../../../../../../lib/usePageSize';
import {
    CARD, INPUT, LABEL, Money, StatCard, Spinner, EmptyState, TableWrap, Th, Td, Pagination,
    money, fmtDate,
} from '../../../../../../components/dashboard/finance/FinanceUI';
import {
    ArrowLeft, Wallet, Clock, CheckCircle2, Banknote, X, Loader2, AlertTriangle,
    ChevronDown, ChevronUp, Package, CalendarClock, RotateCcw, Ban, Receipt, Mail, Phone,
    Snowflake, PauseCircle, PlayCircle, Send, Smartphone, Hourglass, FastForward,
} from 'lucide-react';
import { PayoutStatusBadge, destinationText } from '../../../../../../components/dashboard/finance/PayoutBits';
import Overlay from '../../../../../../components/Overlay';

/**
 * Screen 1, detail — one vendor's orders, and paying for them.
 *
 * The central interaction: rows that have cleared their return window are selectable and
 * fully lit; everything else is dimmed with the reason it cannot be paid. An admin should
 * be able to tell at a glance which money is theirs to move, without reading a status
 * column — which is why "payable" is carried by contrast rather than by a badge.
 */

/** Why a row cannot be paid, in words rather than a status code. */
/** Why a held row cannot be paid early, even with the toggle on. */
const EARLY_BLOCK = {
    not_delivered: { en: 'Cannot pay early: the parcel is no longer delivered', ar: 'مينفعش يتحوّل بدري: الطرد مابقاش متسلّم' },
    open_return: { en: 'Cannot pay early: a return is open', ar: 'مينفعش يتحوّل بدري: في طلب إرجاع مفتوح' },
    nothing: { en: 'Cannot pay early: nothing left after refunds', ar: 'مينفعش يتحوّل بدري: مفيش مبلغ بعد المرتجعات' },
};

const BLOCKED = {
    holding: { en: 'Still inside the settlement period', ar: 'لسه في فترة التسوية' },
    frozen: { en: 'Frozen by admin', ar: 'مجمّد من الإدارة' },
    in_payout: { en: 'In a payout that has not finished', ar: 'داخل تحويل لسه ما خلصش' },
    open_return: { en: 'An open return is blocking this parcel', ar: 'يوجد طلب إرجاع مفتوح' },
    reversed: { en: 'Reversed — refunded in full', ar: 'ملغى — تم استرداده بالكامل' },
    fully_refunded: { en: 'Nothing left after refunds', ar: 'لم يتبقَّ شيء بعد المرتجعات' },
    paid: { en: 'Already paid', ar: 'مدفوع بالفعل' },
};

export default function VendorPayoutDetailPage() {
    const { id } = useParams();
    const { language, siteSettings } = useApp();
    const isAr = language === 'ar';
    const currency = siteSettings?.currency || 'EGP';
    const locale = isAr ? 'ar-EG' : 'en-US';

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = usePageSize('admin.finance.vendorLedger', 25);

    const [selected, setSelected] = useState(new Set());
    // The admin's override: let orders still inside their settlement period be selected and
    // paid now. Off whenever the page opens, so it is always a deliberate choice.
    const [earlyMode, setEarlyMode] = useState(false);
    const [earlyReason, setEarlyReason] = useState('');
    const [expanded, setExpanded] = useState(new Set());

    const [payOpen, setPayOpen] = useState(false);
    const [channel, setChannel] = useState('paymob');
    const [preview, setPreview] = useState(null);
    const [previewError, setPreviewError] = useState('');
    const [reference, setReference] = useState('');
    const [notes, setNotes] = useState('');
    const [paying, setPaying] = useState(false);
    const [payError, setPayError] = useState('');
    const [success, setSuccess] = useState('');
    const [actionError, setActionError] = useState('');

    // Freeze / hold dialogs share one small prompt: { kind, earning?, reason }.
    const [prompt, setPrompt] = useState(null);
    const [promptBusy, setPromptBusy] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await adminFinanceApi.getVendorLedger(id, { status: statusFilter, page, limit: pageSize });
            setData(res);
            // Selections are cleared on every reload: a row that was payable when the page
            // rendered may have been refunded since, and a stale selection would send ids
            // the server is about to reject.
            setSelected(new Set());
        } catch (err) {
            setError(err.message || 'Failed to load vendor ledger');
        } finally {
            setLoading(false);
        }
    }, [id, statusFilter, page, pageSize]);

    useEffect(() => { load(); }, [load]);

    const rows = data?.rows || [];
    const payableRows = useMemo(() => rows.filter((r) => r.is_payable), [rows]);
    const earlyRows = useMemo(() => rows.filter((r) => r.can_release_early), [rows]);
    // What can be ticked right now: settled orders, plus held ones when the override is on.
    const selectableRows = useMemo(() => (earlyMode ? [...payableRows, ...earlyRows] : payableRows), [earlyMode, payableRows, earlyRows]);
    const isSelectable = (r) => r.is_payable || (earlyMode && r.can_release_early);
    const earlySelected = useMemo(() => earlyRows.filter((r) => selected.has(r.earning_id)).map((r) => r.earning_id), [earlyRows, selected]);
    const payableSelected = useMemo(() => payableRows.filter((r) => selected.has(r.earning_id)).map((r) => r.earning_id), [payableRows, selected]);

    const setEarly = (on) => {
        setEarlyMode(on);
        // Switching it off drops any held orders already ticked: they must not ride along
        // into a payout once the admin has said "only settled ones".
        if (!on) setSelected((prev) => new Set([...prev].filter((id) => payableRows.some((r) => r.earning_id === id))));
    };

    const selectedTotal = useMemo(
        () => rows.filter((r) => selected.has(r.earning_id)).reduce((s, r) => s + r.effective_net, 0),
        [rows, selected]
    );

    const toggle = (earningId) => {
        setSelected((prev) => {
            const next = new Set(prev);
            next.has(earningId) ? next.delete(earningId) : next.add(earningId);
            return next;
        });
    };

    const toggleAll = () => {
        setSelected((prev) =>
            prev.size === selectableRows.length ? new Set() : new Set(selectableRows.map((r) => r.earning_id))
        );
    };

    const toggleExpand = (earningId) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            next.has(earningId) ? next.delete(earningId) : next.add(earningId);
            return next;
        });
    };

    // The server nets what the wallet already owes, so the dialog shows ITS figure, not the
    // sum of the selected rows.
    const openPay = async () => {
        setPayOpen(true);
        setPayError('');
        setPreview(null);
        setPreviewError('');
        const canPaymob = data?.paymob?.configured && data?.vendor?.payout_method;
        setChannel(canPaymob ? 'paymob' : 'manual');
        try {
            const res = await adminFinanceApi.previewVendorPay(id, selected.size
                ? { earning_ids: payableSelected, early_ids: earlySelected }
                : { earning_ids: null });
            setPreview(res.preview);
        } catch (err) {
            setPreviewError(err.message || 'Could not work out the amount');
        }
    };

    const submitPayment = async () => {
        setPaying(true);
        setPayError('');
        try {
            const res = await adminFinanceApi.payVendor(id, {
                // No selection = the wallet credit alone (see the "pay balance" button).
                earning_ids: selected.size ? payableSelected : null,
                early_ids: earlySelected,
                early_reason: earlySelected.length ? earlyReason : undefined,
                channel,
                payment_reference: channel === 'manual' ? (reference || null) : null,
                notes,
            });
            setPayOpen(false);
            setReference('');
            setNotes('');
            setEarlyReason('');
            const amount = money(res.amount, currency, locale);
            const msg = {
                paid: isAr ? `تم تحويل ${amount} للتاجر بنجاح عبر Paymob.` : `${amount} sent to the vendor via Paymob.`,
                processing: isAr ? `تم إرسال ${amount} — التحويل البنكي جاري وهيتحدّث تلقائيًا.` : `${amount} sent — the bank transfer is under way and will update by itself.`,
                failed: isAr ? `Paymob رفض التحويل. الطلبات رجعت للمستحق. افتح الفاتورة للتفاصيل.` : 'Paymob refused the transfer. The orders are payable again — open the invoice for the reason.',
                unknown: isAr ? 'لم يصل رد من Paymob. التحويل محجوز وهيتراجع تلقائيًا — لن يُرسل مرة تانية.' : 'No answer from Paymob. The payout is held and will be checked automatically — it is never sent twice.',
            }[res.state] || (isAr
                ? `تم تسجيل دفعة ${amount} لـ ${res.paid_count} طلب.`
                : `Recorded a ${amount} payout covering ${res.paid_count} order(s).`);
            if (res.state === 'failed') setActionError(msg); else setSuccess(msg);
            setTimeout(() => { setSuccess(''); setActionError(''); }, 9000);
            await load();
        } catch (err) {
            setPayError(err.message || 'Payment failed');
        } finally {
            setPaying(false);
        }
    };

    const submitPrompt = async () => {
        setPromptBusy(true);
        setActionError('');
        try {
            if (prompt.kind === 'freeze') await adminFinanceApi.freezeEarning(prompt.earning.earning_id, { reason: prompt.reason });
            else if (prompt.kind === 'unfreeze') await adminFinanceApi.unfreezeEarning(prompt.earning.earning_id, { note: prompt.reason });
            else if (prompt.kind === 'hold') await adminFinanceApi.setVendorPayoutHold(id, { active: true, reason: prompt.reason });
            else if (prompt.kind === 'resume') await adminFinanceApi.setVendorPayoutHold(id, { active: false });
            setPrompt(null);
            await load();
        } catch (err) {
            setActionError(err.message || 'Action failed');
            setPrompt(null);
        } finally {
            setPromptBusy(false);
        }
    };

    if (loading && !data) return <Spinner />;

    if (error) {
        return (
            <div className={`${CARD} p-6`}>
                <p className="text-red-600 dark:text-red-400 font-bold">{error}</p>
                <Link href="/admin/dashboard/finance/vendors" className="inline-block mt-3 text-sm font-bold text-marine-primary">
                    {isAr ? 'العودة للقائمة' : 'Back to the list'}
                </Link>
            </div>
        );
    }

    if (!data) return null;

    const { vendor, schedule, summary, pagination } = data;

    return (
        <div className="space-y-6">
            <Link
                href="/admin/dashboard/finance/vendors"
                className="inline-flex items-center gap-2 text-sm font-bold text-zinc-500 hover:text-marine-primary transition-colors"
            >
                <ArrowLeft size={16} className={isAr ? 'rotate-180' : ''} />
                {isAr ? 'كل التجار' : 'All vendors'}
            </Link>

            {actionError && (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
                    <AlertTriangle size={18} className="text-red-600 dark:text-red-400 shrink-0" />
                    <p className="text-sm font-bold text-red-700 dark:text-red-400">{actionError}</p>
                </div>
            )}

            {vendor.payout_hold && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                    <div className="flex items-start gap-3">
                        <PauseCircle size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-black text-amber-800 dark:text-amber-300">
                                {isAr ? 'كل التحويلات لهذا التاجر موقوفة' : 'All payouts to this vendor are on hold'}
                            </p>
                            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                                {vendor.payout_hold.reason} · {vendor.payout_hold.by} · {fmtDate(vendor.payout_hold.at, isAr)}
                            </p>
                        </div>
                    </div>
                    <button onClick={() => setPrompt({ kind: 'resume', reason: '' })}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold shrink-0">
                        <PlayCircle size={16} /> {isAr ? 'استئناف التحويلات' : 'Resume payouts'}
                    </button>
                </div>
            )}

            {success && (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
                    <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">{success}</p>
                </div>
            )}

            {/* ---- Vendor header ---- */}
            <div className={`${CARD} p-5`}>
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                    <div className="flex items-center gap-4 min-w-0">
                        <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-marine-cyan/10 text-marine-primary flex items-center justify-center text-xl font-black shrink-0">
                            {(vendor.store_name || '?').charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-xl font-black text-zinc-900 dark:text-white truncate">{vendor.store_name}</h2>
                            <p className="text-sm text-zinc-500 truncate">{vendor.owner_name}</p>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-zinc-500">
                                {vendor.email && <span className="flex items-center gap-1.5"><Mail size={12} />{vendor.email}</span>}
                                {vendor.phone && <span className="flex items-center gap-1.5" dir="ltr"><Phone size={12} />{vendor.phone}</span>}
                            </div>
                        </div>
                    </div>

                    <div className={`p-4 rounded-xl shrink-0 ${schedule.source === 'vendor' ? 'bg-amber-50 dark:bg-amber-500/10' : 'bg-zinc-50 dark:bg-white/[0.03]'}`}>
                        <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide flex items-center gap-1.5">
                            <CalendarClock size={13} />
                            {isAr ? 'جدول الدفع' : 'Payout schedule'}
                            {schedule.source === 'vendor' && (
                                <span className="text-amber-600 dark:text-amber-400">· {isAr ? 'خاص' : 'custom'}</span>
                            )}
                        </p>
                        <p className="font-black text-zinc-900 dark:text-white mt-1">{isAr ? schedule.label.ar : schedule.label.en}</p>
                        <p className="text-xs text-zinc-500 mt-0.5">
                            {isAr ? 'التالي: ' : 'Next: '}{fmtDate(schedule.next_payout_at, isAr)}
                            {' · '}
                            {isAr
                                ? `تسوية ${Math.max(14, schedule.hold_days || 14)} يوم`
                                : `${Math.max(14, schedule.hold_days || 14)}-day settlement`}
                        </p>
                    </div>
                </div>

                <div className="mt-5 pt-5 border-t border-zinc-100 dark:border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                        <Smartphone size={18} className="text-zinc-400 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">
                                {isAr ? 'وسيلة استلام الفلوس (Paymob)' : 'Payout method (Paymob)'}
                            </p>
                            {vendor.payout_method ? (
                                <>
                                    <p className="font-bold text-zinc-900 dark:text-white break-all" dir="auto">
                                        {destinationText(vendor.payout_method, isAr)}
                                        {vendor.payout_method.full_name ? ` · ${vendor.payout_method.full_name}` : ''}
                                    </p>
                                    {vendor.payout_method_updated_at && (Date.now() - new Date(vendor.payout_method_updated_at).getTime()) < 2 * 86400000 && (
                                        <p className="text-[11px] text-amber-600 dark:text-amber-400 font-bold">
                                            {isAr ? 'اتغيّرت خلال آخر ٤٨ ساعة — اتأكد من التاجر قبل التحويل.' : 'Changed in the last 48 hours — confirm with the vendor before paying.'}
                                        </p>
                                    )}
                                </>
                            ) : (
                                <p className="text-sm text-amber-600 dark:text-amber-400">
                                    {isAr ? 'التاجر لم يحدد محفظة أو حساب بنكي بعد.' : 'The vendor has not saved a wallet or bank account yet.'}
                                </p>
                            )}
                            {!data.paymob?.configured ? (
                                <p className="text-[11px] text-zinc-400">{isAr ? 'Paymob Payouts غير مُعد على السيرفر.' : 'Paymob Payouts is not configured on the server.'}</p>
                            ) : data.paymob.environment === 'staging' && (
                                <p className="text-[11px] text-amber-600 dark:text-amber-400 font-bold">{isAr ? 'Paymob في وضع التجربة (staging).' : 'Paymob is in STAGING mode.'}</p>
                            )}
                        </div>
                    </div>
                    {!vendor.payout_hold && (
                        <button onClick={() => setPrompt({ kind: 'hold', reason: '' })}
                            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-amber-300 dark:border-amber-500/30 text-amber-700 dark:text-amber-400 text-sm font-bold hover:bg-amber-50 dark:hover:bg-amber-500/10 shrink-0">
                            <PauseCircle size={16} /> {isAr ? 'إيقاف كل التحويلات' : 'Stop all payouts'}
                        </button>
                    )}
                </div>
            </div>

            {/* ---- Balances ---- */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <StatCard label={isAr ? 'مستحق الآن' : 'Payable now'} value={summary.payable} currency={currency} icon={Wallet}
                    tone={summary.payable > 0 ? 'brand' : 'neutral'}
                    sub={summary.deductions > 0
                        ? (isAr
                            ? `يتحول ${money(summary.net_payable, currency, locale)} بعد خصم ${money(summary.deductions, currency, locale)} مستحقة على المحفظة`
                            : `${money(summary.net_payable, currency, locale)} after ${money(summary.deductions, currency, locale)} the wallet owes`)
                        : summary.deductions < 0
                            ? (isAr
                                ? `+ ${money(-summary.deductions, currency, locale)} رصيد لصالح التاجر مش مربوط بطلبات`
                                : `+ ${money(-summary.deductions, currency, locale)} wallet credit not tied to orders`)
                            : undefined} />
                <StatCard label={isAr ? 'محتجز' : 'Held'} value={summary.held} currency={currency} icon={Clock}
                    sub={isAr ? 'لسه في فترة التسوية' : 'Settlement period still running'} />
                <StatCard label={isAr ? 'مدفوع سابقًا' : 'Paid to date'} value={summary.paid} currency={currency} icon={CheckCircle2}
                    sub={(summary.in_payout > 0 || summary.frozen > 0)
                        ? [
                            summary.in_payout > 0 ? `${isAr ? 'جاري' : 'under way'} ${money(summary.in_payout, currency, locale)}` : null,
                            summary.frozen > 0 ? `${isAr ? 'مجمّد' : 'frozen'} ${money(summary.frozen, currency, locale)}` : null,
                        ].filter(Boolean).join(' · ')
                        : undefined} />
                <StatCard label={isAr ? 'عمولتنا' : 'Our commission'} value={summary.lifetime_commission} currency={currency} icon={Receipt}
                    tone="profit" sub={isAr ? `من ${money(summary.lifetime_gross, currency, locale)} مبيعات` : `on ${money(summary.lifetime_gross, currency, locale)} of sales`} />
            </div>

            {/* ---- Selection bar. Sticky so it stays reachable while scrolling a long ledger. ---- */}
            {selected.size > 0 && (
                <div className="sticky top-2 z-20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-marine-cyan text-white shadow-lg shadow-red-500/20">
                    <div>
                        <p className="font-black text-lg tabular-nums" dir="ltr">{money(selectedTotal, currency, locale)}</p>
                        <p className="text-xs text-red-100">
                            {isAr ? `${selected.size} طلب محدد` : `${selected.size} order${selected.size === 1 ? '' : 's'} selected`}
                            {earlySelected.length > 0 && (isAr
                                ? ` · منهم ${earlySelected.length} قبل انتهاء التسوية`
                                : ` · ${earlySelected.length} before settlement ends`)}
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => setSelected(new Set())} className="px-4 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-sm font-bold transition-colors">
                            {isAr ? 'إلغاء التحديد' : 'Clear'}
                        </button>
                        <button onClick={openPay} disabled={!!vendor.payout_hold} className="flex items-center gap-2 px-5 py-2 rounded-xl bg-white text-marine-primary text-sm font-black hover:bg-red-50 transition-colors disabled:opacity-50">
                            <Banknote size={16} />
                            {isAr ? 'تحويل للتاجر' : 'Pay vendor'}
                        </button>
                    </div>
                </div>
            )}

            {/* ---- The ledger ---- */}
            <div className={CARD}>
                <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 border-b border-zinc-100 dark:border-white/5">
                    <div className="flex flex-wrap gap-1.5 flex-1">
                        {[
                            { key: '', en: 'All', ar: 'الكل' },
                            { key: 'payable', en: 'Payable', ar: 'مستحق' },
                            { key: 'held', en: 'Held', ar: 'محتجز' },
                            { key: 'frozen', en: 'Frozen', ar: 'مجمّد' },
                            { key: 'in_payout', en: 'Under way', ar: 'جاري تحويله' },
                            { key: 'paid', en: 'Paid', ar: 'مدفوع' },
                            { key: 'reversed', en: 'Reversed', ar: 'ملغى' },
                        ].map((f) => (
                            <button
                                key={f.key}
                                onClick={() => { setStatusFilter(f.key); setPage(1); }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${statusFilter === f.key
                                    ? 'bg-marine-cyan text-white'
                                    : 'bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-white/10'
                                    }`}
                            >
                                {isAr ? f.ar : f.en}
                            </button>
                        ))}
                    </div>

                    {payableRows.length === 0 && summary.payable === 0 && summary.net_payable > 0 && !vendor.payout_hold && (
                        <button onClick={openPay} className="text-xs font-bold text-marine-primary hover:underline whitespace-nowrap">
                            {isAr ? `حوّل رصيد المحفظة (${money(summary.net_payable, currency, locale)})` : `Pay the wallet balance (${money(summary.net_payable, currency, locale)})`}
                        </button>
                    )}
                    {selectableRows.length > 0 && (
                        <button onClick={toggleAll} className="text-xs font-bold text-marine-primary hover:underline whitespace-nowrap">
                            {selected.size === selectableRows.length
                                ? (isAr ? 'إلغاء تحديد الكل' : 'Deselect all')
                                : (isAr ? `تحديد الكل (${selectableRows.length})` : `Select all (${selectableRows.length})`)}
                        </button>
                    )}
                </div>

                {/* The override: pay orders before their settlement period ends. */}
                <div className={`px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-100 dark:border-white/5 ${earlyMode ? 'bg-amber-50 dark:bg-amber-500/10' : ''}`}>
                    <label className="flex items-center gap-3 cursor-pointer select-none">
                        <button
                            type="button"
                            role="switch"
                            aria-checked={earlyMode}
                            onClick={() => setEarly(!earlyMode)}
                            disabled={!!vendor.payout_hold}
                            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${earlyMode ? 'bg-amber-500' : 'bg-zinc-300 dark:bg-white/15'}`}
                        >
                            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${earlyMode ? (isAr ? '-translate-x-5' : 'translate-x-5') : (isAr ? '-translate-x-0.5' : 'translate-x-0.5')}`} />
                        </button>
                        <span>
                            <span className="flex items-center gap-1.5 text-sm font-bold text-zinc-900 dark:text-white">
                                <FastForward size={15} className="text-amber-500" />
                                {isAr ? 'تحويل قبل انتهاء فترة التسوية' : 'Pay before the settlement period ends'}
                            </span>
                            <span className="block text-[11px] text-zinc-500">
                                {earlyMode
                                    ? (isAr
                                        ? `تقدر تختار ${earlyRows.length} طلب لسه في فترة التسوية في الصفحة دي. لو العميل رجّع حاجة بعد التحويل، مبلغها بيتخصم من التحويل الجاي.`
                                        : `${earlyRows.length} order(s) on this page still in their settlement period can be selected. A return after payment is taken off the vendor's next payout.`)
                                    : (isAr ? 'مقفول: بس الطلبات اللي خلصت تسويتها تتحوّل.' : 'Off: only orders whose settlement period has ended can be paid.')}
                            </span>
                        </span>
                    </label>
                    {earlyMode && statusFilter !== 'held' && (
                        <button onClick={() => { setStatusFilter('held'); setPage(1); }} className="text-xs font-bold text-amber-700 dark:text-amber-400 hover:underline whitespace-nowrap">
                            {isAr ? 'اعرض المحتجز بس' : 'Show held orders only'}
                        </button>
                    )}
                </div>

                {loading ? (
                    <Spinner />
                ) : rows.length === 0 ? (
                    <EmptyState
                        icon={Package}
                        title={isAr ? 'لا توجد سجلات' : 'Nothing here'}
                        message={isAr ? 'لا توجد أرباح مطابقة لهذا الفلتر.' : 'No earnings match this filter.'}
                    />
                ) : (
                    <TableWrap>
                        <table className="w-full min-w-[900px]">
                            <thead className="bg-zinc-50 dark:bg-white/[0.02] border-b border-zinc-100 dark:border-white/5">
                                <tr>
                                    <Th className="w-10" />
                                    <Th>{isAr ? 'الطلب' : 'Order'}</Th>
                                    <Th align="right">{isAr ? 'قيمة البضاعة' : 'Merchandise'}</Th>
                                    <Th align="right">{isAr ? 'عمولتنا' : 'Commission'}</Th>
                                    <Th align="right">{isAr ? 'صافي التاجر' : 'Vendor net'}</Th>
                                    <Th>{isAr ? 'التسليم' : 'Delivered'}</Th>
                                    <Th>{isAr ? 'موعد الدفع' : 'Pay on'}</Th>
                                    <Th className="w-10" />
                                </tr>
                            </thead>

                            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                {rows.map((r) => {
                                    const isSelected = selected.has(r.earning_id);
                                    const isOpen = expanded.has(r.earning_id);
                                    const blocked = r.blocked_reason ? BLOCKED[r.blocked_reason] : null;

                                    return (
                                        // A row and its expanded detail are two <tr>s that must stay
                                        // siblings inside <tbody>, so the key belongs on the fragment.
                                        <Fragment key={r.earning_id}>
                                            <tr
                                                onClick={() => isSelectable(r) && toggle(r.earning_id)}
                                                className={`transition-colors ${isSelectable(r)
                                                    ? `cursor-pointer ${isSelected ? (r.is_payable ? 'bg-red-50/70 dark:bg-marine-cyan/10' : 'bg-amber-50 dark:bg-amber-500/10') : 'hover:bg-zinc-50 dark:hover:bg-white/[0.02]'}`
                                                    // Dimmed, not hidden: the admin still needs to see the money
                                                    // that is coming and why it has not arrived.
                                                    : 'opacity-50'
                                                    }`}
                                            >
                                                <Td>
                                                    {isSelectable(r) ? (
                                                        <input
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            onChange={() => toggle(r.earning_id)}
                                                            onClick={(e) => e.stopPropagation()}
                                                            className={`w-4 h-4 rounded cursor-pointer ${r.is_payable ? 'accent-marine-cyan' : 'accent-amber-500'}`}
                                                        />
                                                    ) : r.blocked_reason === 'paid' ? (
                                                        <CheckCircle2 size={16} className="text-emerald-500" />
                                                    ) : r.blocked_reason === 'frozen' ? (
                                                        <Snowflake size={16} className="text-sky-500" />
                                                    ) : r.blocked_reason === 'in_payout' ? (
                                                        <Hourglass size={16} className="text-sky-500" />
                                                    ) : r.blocked_reason === 'open_return' ? (
                                                        <RotateCcw size={16} className="text-amber-500" />
                                                    ) : r.blocked_reason === 'holding' ? (
                                                        <Clock size={16} className="text-zinc-400" />
                                                    ) : (
                                                        <Ban size={16} className="text-zinc-400" />
                                                    )}
                                                </Td>

                                                <Td>
                                                    <p className="font-bold text-zinc-900 dark:text-white">{r.reference}</p>
                                                    <p className="text-xs text-zinc-500">
                                                        {r.customer?.name || (isAr ? 'عميل محذوف' : 'deleted customer')}
                                                        {r.items.length > 0 && ` · ${r.items.length} ${isAr ? 'صنف' : r.items.length === 1 ? 'item' : 'items'}`}
                                                    </p>
                                                    {blocked && !(earlyMode && r.can_release_early) && (
                                                        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                                                            {isAr ? blocked.ar : blocked.en}
                                                            {r.frozen?.reason ? `: ${r.frozen.reason}` : ''}
                                                        </p>
                                                    )}
                                                    {earlyMode && r.can_release_early && (
                                                        <p className="text-[11px] text-amber-700 dark:text-amber-400 font-bold mt-0.5 flex items-center gap-1">
                                                            <FastForward size={11} />
                                                            {isAr ? `ينفع يتحوّل بدري (باقي ${r.days_until_clear} يوم)` : `Can be paid early (${r.days_until_clear} day${r.days_until_clear === 1 ? '' : 's'} left)`}
                                                        </p>
                                                    )}
                                                    {earlyMode && r.early_block && EARLY_BLOCK[r.early_block] && (
                                                        <p className="text-[11px] text-red-500 mt-0.5">{isAr ? EARLY_BLOCK[r.early_block].ar : EARLY_BLOCK[r.early_block].en}</p>
                                                    )}
                                                    {r.early_release && (
                                                        <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
                                                            {r.early_release.undone_at
                                                                ? (isAr ? 'اتحوّل بدري ورجع للتسوية (التحويل ماتمش)' : 'Released early, then back to settlement (payout did not go through)')
                                                                : (isAr ? `اتحوّل قبل التسوية · ${r.early_release.by}: ${r.early_release.reason}` : `Paid before settlement · ${r.early_release.by}: ${r.early_release.reason}`)}
                                                        </p>
                                                    )}
                                                </Td>

                                                <Td align="right"><Money value={r.gross_amount} currency={currency} className="text-sm" /></Td>

                                                <Td align="right">
                                                    <span dir="ltr" className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                                                        {money(r.commission_amount, currency, locale)}
                                                    </span>
                                                    {r.reversed_commission > 0 && (
                                                        <p className="text-[11px] text-red-500" dir="ltr">−{money(r.reversed_commission, currency, locale)}</p>
                                                    )}
                                                </Td>

                                                <Td align="right">
                                                    <span dir="ltr" className="font-black text-zinc-900 dark:text-white tabular-nums">
                                                        {money(r.effective_net, currency, locale)}
                                                    </span>
                                                    {r.reversed_net > 0 && (
                                                        <p className="text-[11px] text-red-500" dir="ltr">
                                                            {isAr ? 'مرتجع ' : 'refunded '}−{money(r.reversed_net, currency, locale)}
                                                        </p>
                                                    )}
                                                </Td>

                                                <Td>
                                                    <p className="text-sm text-zinc-600 dark:text-zinc-400">{fmtDate(r.delivered_at, isAr)}</p>
                                                    {r.days_until_clear > 0 && (
                                                        <p className="text-[11px] text-amber-600 dark:text-amber-400">
                                                            {isAr ? `${r.days_until_clear} يوم متبقٍ` : `${r.days_until_clear} day${r.days_until_clear === 1 ? '' : 's'} left`}
                                                        </p>
                                                    )}
                                                </Td>

                                                <Td>
                                                    {r.payout ? (
                                                        <Link href={`/admin/dashboard/finance/payouts/${r.payout.id}`} onClick={(e) => e.stopPropagation()} className="block hover:underline">
                                                            {r.payout.status && r.payout.status !== 'paid'
                                                                ? <PayoutStatusBadge status={r.payout.status} isAr={isAr} />
                                                                : <p className="text-sm text-emerald-600 dark:text-emerald-400 font-bold">{fmtDate(r.payout.paid_at, isAr)}</p>}
                                                            <p className="text-[11px] text-zinc-500">{r.payout.withdrawal_number}</p>
                                                        </Link>
                                                    ) : (
                                                        <p className="text-sm text-zinc-600 dark:text-zinc-400">{fmtDate(r.scheduled_payout_at, isAr)}</p>
                                                    )}
                                                </Td>

                                                <Td align="right">
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); toggleExpand(r.earning_id); }}
                                                        className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-400 transition-colors"
                                                        aria-label={isAr ? 'تفاصيل' : 'Details'}
                                                    >
                                                        {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                                    </button>
                                                </Td>
                                            </tr>

                                            {isOpen && (
                                                <tr className="bg-zinc-50 dark:bg-white/[0.02]">
                                                    <td colSpan={8} className="px-6 py-4">
                                                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                                            <div className="lg:col-span-2">
                                                                <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-2">
                                                                    {isAr ? 'الأصناف' : 'Items in this parcel'}
                                                                </p>
                                                                <ul className="space-y-2">
                                                                    {r.items.map((it, i) => (
                                                                        <li key={i} className="flex items-center justify-between gap-3 text-sm">
                                                                            <div className="min-w-0">
                                                                                <p className="text-zinc-800 dark:text-zinc-200 truncate">{it.title}</p>
                                                                                <p className="text-xs text-zinc-500">
                                                                                    {it.variant ? `${it.variant} · ` : ''}
                                                                                    {isAr ? `الكمية ${it.quantity}` : `qty ${it.quantity}`}
                                                                                    {it.commission_rate ? ` · ${it.commission_rate}% ${isAr ? 'عمولة' : 'commission'}` : ''}
                                                                                    {it.return_status && it.return_status !== 'none'
                                                                                        ? ` · ${isAr ? 'مرتجع' : it.return_status.replace(/_/g, ' ')}`
                                                                                        : ''}
                                                                                </p>
                                                                            </div>
                                                                            <Money value={it.line_total} currency={currency} className="text-sm shrink-0" />
                                                                        </li>
                                                                    ))}
                                                                </ul>
                                                            </div>

                                                            <div className="space-y-1.5 text-sm">
                                                                <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-2">
                                                                    {isAr ? 'تفصيل المبلغ' : 'How the money breaks down'}
                                                                </p>
                                                                <Row label={isAr ? 'قيمة البضاعة' : 'Merchandise'} value={r.gross_amount} currency={currency} />
                                                                {r.coupon_share > 0 && (
                                                                    <Row label={isAr ? 'نصيب التاجر من الكوبون' : "Vendor's share of the coupon"} value={-r.coupon_share} currency={currency} tone="commission" />
                                                                )}
                                                                <Row label={isAr ? 'عمولتنا' : 'Our commission'} value={-r.commission_amount} currency={currency} tone="commission" />
                                                                {r.reversed_net > 0 && <Row label={isAr ? 'مرتجعات' : 'Refund reversal'} value={-r.reversed_net} currency={currency} tone="negative" />}
                                                                <div className="pt-1.5 border-t border-zinc-200 dark:border-white/10 flex justify-between font-black">
                                                                    <span className="text-zinc-900 dark:text-white">{isAr ? 'صافي التاجر' : 'Vendor net'}</span>
                                                                    <Money value={r.effective_net} currency={currency} />
                                                                </div>
                                                                {r.shipping_charged !== null && (
                                                                    <p className="text-[11px] text-zinc-400 pt-2">
                                                                        {isAr
                                                                            ? `الشحن (${money(r.shipping_charged, currency, locale)}) ليس من نصيب التاجر — يدفعه العميل لنا ونحن ندفعه لبوسطة.`
                                                                            : `Shipping (${money(r.shipping_charged, currency, locale)}) is not the vendor's — the customer paid it to us and we paid Bosta.`}
                                                                    </p>
                                                                )}
                                                                <p className="text-[11px] text-zinc-400 pt-1">
                                                                    {isAr ? 'طريقة الدفع: ' : 'Paid by: '}{r.payment_method || '—'}
                                                                    {' · '}
                                                                    {isAr ? 'تُصرف في ' : 'clears '}{fmtDate(r.clearable_at, isAr)}
                                                                    {r.hold_days ? ` (${r.hold_days} ${isAr ? 'يوم تسوية' : 'day settlement'})` : ''}
                                                                </p>
                                                                {r.frozen ? (
                                                                    <div className="pt-3">
                                                                        <p className="text-[11px] text-sky-600 dark:text-sky-400 mb-2">
                                                                            {isAr ? 'مجمّد بواسطة ' : 'Frozen by '}{r.frozen.by} · {fmtDate(r.frozen.at, isAr)}
                                                                        </p>
                                                                        <button onClick={() => setPrompt({ kind: 'unfreeze', earning: r, reason: '' })}
                                                                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold">
                                                                            <PlayCircle size={14} /> {isAr ? 'فك التجميد' : 'Unfreeze'}
                                                                        </button>
                                                                    </div>
                                                                ) : (!r.payout && r.status !== 'reversed') && (
                                                                    <div className="pt-3">
                                                                        <button onClick={() => setPrompt({ kind: 'freeze', earning: r, reason: '' })}
                                                                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-sky-300 dark:border-sky-500/30 text-sky-700 dark:text-sky-400 text-xs font-bold hover:bg-sky-50 dark:hover:bg-sky-500/10">
                                                                            <Snowflake size={14} /> {isAr ? 'تجميد فلوس الطلب ده' : 'Freeze this order’s money'}
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </TableWrap>
                )}

                <Pagination pageSize={pageSize} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} page={pagination?.page} pages={pagination?.pages} total={pagination?.total} onChange={setPage} isAr={isAr} />
            </div>

            {/* ---- Pay modal ---- */}
            {payOpen && (
                <Overlay className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !paying && setPayOpen(false)}>
                    <div className={`${CARD} w-full max-w-lg p-6`} onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-start justify-between gap-4 mb-5">
                            <div>
                                <h3 className="text-lg font-black text-zinc-900 dark:text-white">
                                    {isAr ? 'تحويل للتاجر' : 'Pay the vendor'}
                                </h3>
                                <p className="text-sm text-zinc-500 mt-1">{vendor.store_name}</p>
                            </div>
                            <button onClick={() => !paying && setPayOpen(false)} className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-400">
                                <X size={18} />
                            </button>
                        </div>

                        {/* How the money leaves */}
                        <div className="grid grid-cols-2 gap-2 mb-5">
                            {[
                                { key: 'paymob', icon: Send, en: 'Send via Paymob', ar: 'تحويل عبر Paymob', disabled: !data.paymob?.configured || !vendor.payout_method },
                                { key: 'manual', icon: Banknote, en: 'Record a manual transfer', ar: 'تسجيل تحويل يدوي', disabled: false },
                            ].map((c) => (
                                <button key={c.key} type="button" disabled={c.disabled || paying} onClick={() => setChannel(c.key)}
                                    className={`flex items-center gap-2 p-3 rounded-xl border text-sm font-bold transition-colors disabled:opacity-40 ${channel === c.key
                                        ? 'border-marine-cyan bg-red-50 dark:bg-marine-cyan/10 text-marine-primary'
                                        : 'border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300'}`}>
                                    <c.icon size={16} /> {isAr ? c.ar : c.en}
                                </button>
                            ))}
                        </div>

                        <div className="p-4 rounded-xl bg-zinc-50 dark:bg-white/[0.03] mb-5">
                            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">{isAr ? 'المبلغ اللي هيتحول' : 'Amount to transfer'}</p>
                            {!preview && !previewError ? (
                                <Loader2 size={20} className="animate-spin text-zinc-400 mt-2" />
                            ) : previewError ? (
                                <p className="text-sm text-red-600 dark:text-red-400 font-bold mt-1">{previewError}</p>
                            ) : (
                                <>
                                    <p dir="ltr" className="text-3xl font-black text-zinc-900 dark:text-white tabular-nums mt-1">
                                        {money(preview.amount, currency, locale)}
                                    </p>
                                    <p className="text-xs text-zinc-500 mt-1">
                                        {isAr ? `يغطي ${preview.earning_count} طلب` : `covering ${preview.earning_count} order${preview.earning_count === 1 ? '' : 's'}`}
                                    </p>
                                    {preview.deductions !== 0 && (
                                        <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-white/10 space-y-1 text-xs">
                                            <Row label={isAr ? 'صافي الطلبات' : 'Orders'} value={preview.gross} currency={currency} />
                                            {preview.deductions > 0
                                                ? <Row label={isAr ? 'مستحق على المحفظة (مرتجعات مدفوعة / مستلزمات / سحب قديم)' : 'Owed by the wallet (refunds on paid orders, packaging, older withdrawals)'} value={-preview.deductions} currency={currency} tone="negative" />
                                                : <Row label={isAr ? 'رصيد لصالح التاجر مش مربوط بطلبات' : 'Wallet credit not tied to any order'} value={-preview.deductions} currency={currency} tone="commission" />}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        {channel === 'paymob' ? (
                            <div className="p-4 rounded-xl bg-zinc-50 dark:bg-white/[0.03] mb-5 text-sm">
                                <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-2">{isAr ? 'هيتحول إلى' : 'Sending to'}</p>
                                <p className="text-zinc-800 dark:text-zinc-200 font-bold break-all" dir="auto">{destinationText(vendor.payout_method, isAr)}</p>
                                {vendor.payout_method?.full_name && <p className="text-zinc-600 dark:text-zinc-400">{vendor.payout_method.full_name}</p>}
                                <p className="text-[11px] text-zinc-400 mt-2">
                                    {isAr ? 'رسوم Paymob على Ready Marine — التاجر يستلم المبلغ كامل.' : 'Paymob’s fee is paid by Ready Marine — the vendor receives the full amount.'}
                                </p>
                            </div>
                        ) : vendor.bank_details?.account_number ? (
                            <div className="p-4 rounded-xl bg-zinc-50 dark:bg-white/[0.03] mb-5 text-sm">
                                <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide mb-2">{isAr ? 'بيانات الحساب' : 'Bank details'}</p>
                                <p className="text-zinc-800 dark:text-zinc-200 font-bold">{vendor.bank_details.account_holder}</p>
                                <p className="text-zinc-600 dark:text-zinc-400">{vendor.bank_details.bank_name}</p>
                                <p className="text-zinc-600 dark:text-zinc-400" dir="ltr">{vendor.bank_details.account_number}</p>
                                {vendor.bank_details.iban && <p className="text-zinc-500 text-xs" dir="ltr">IBAN {vendor.bank_details.iban}</p>}
                            </div>
                        ) : (
                            <div className="flex items-start gap-2.5 p-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 mb-5">
                                <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                                <p className="text-xs text-amber-700 dark:text-amber-400">
                                    {isAr
                                        ? 'لم يضف هذا التاجر بيانات حسابه البنكي. يمكنك تسجيل الدفعة، لكن تأكد أنك تعرف وجهة التحويل.'
                                        : 'This vendor has not saved any bank details. You can still record the payout, but make sure you know where the money is going.'}
                                </p>
                            </div>
                        )}

                        {earlySelected.length > 0 && (
                            <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 mb-5">
                                <p className="text-sm font-black text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                                    <FastForward size={15} />
                                    {isAr
                                        ? `${earlySelected.length} طلب هيتحوّل قبل ما فترة التسوية تخلص${preview?.early_amount ? ` (${money(preview.early_amount, currency, locale)})` : ''}`
                                        : `${earlySelected.length} order(s) paid before their settlement period ends${preview?.early_amount ? ` (${money(preview.early_amount, currency, locale)})` : ''}`}
                                </p>
                                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                                    {isAr
                                        ? 'لو العميل رجّع حاجة منهم بعد كده، مبلغها هيتخصم من تحويل التاجر الجاي. ولو التحويل ده فشل، الطلبات دي بترجع تستنى ميعاد تسويتها الأصلي.'
                                        : 'If the customer returns any of them later, it comes off the vendor’s next payout. If this transfer fails, these orders go back to waiting for their original settlement date.'}
                                </p>
                                <textarea value={earlyReason} onChange={(e) => setEarlyReason(e.target.value)} rows={2}
                                    placeholder={isAr ? 'سبب التحويل المبكر (مطلوب — بيتسجل في السجل)' : 'Why pay early? (required — kept in the audit trail)'}
                                    className={`${INPUT} w-full resize-none mt-3`} />
                            </div>
                        )}

                        <div className="space-y-4">
                            {channel === 'manual' && (
                                <div>
                                    <label className={LABEL}>{isAr ? 'مرجع التحويل' : 'Payment reference'}</label>
                                    <input
                                        value={reference}
                                        onChange={(e) => setReference(e.target.value)}
                                        placeholder={isAr ? 'رقم التحويل البنكي (اختياري)' : 'Bank transfer number (optional)'}
                                        className={`${INPUT} w-full`}
                                    />
                                </div>
                            )}
                            <div>
                                <label className={LABEL}>{isAr ? 'ملاحظات' : 'Notes'}</label>
                                <textarea
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    rows={2}
                                    placeholder={isAr ? 'ملاحظات داخلية (اختياري)' : 'Internal notes (optional)'}
                                    className={`${INPUT} w-full resize-none`}
                                />
                            </div>
                        </div>

                        {payError && (
                            <p className="mt-4 text-sm text-red-600 dark:text-red-400 font-bold">{payError}</p>
                        )}

                        <p className="text-[11px] text-zinc-400 mt-4 leading-relaxed">
                            {channel === 'paymob'
                                ? (isAr
                                    ? 'ده بيحوّل الفلوس فعلاً دلوقتي. الطلبات دي بتتقفل على التحويل ده ومستحيل تتدفع مرتين، ولو التحويل فشل بترجع للمستحق تلقائيًا.'
                                    : 'This moves real money now. These orders are locked to this payout and can never be paid twice; if the transfer fails they become payable again automatically.')
                                : (isAr
                                    ? 'هذا يسجّل تحويلًا قمت به بالفعل — لا يرسل أموالًا. سيُخصم المبلغ من رصيد التاجر وسيصله إشعار.'
                                    : 'This records a transfer you have already made — it does not send money. The amount is deducted from the vendor’s balance and they are notified.')}
                        </p>

                        <div className="flex gap-3 mt-5">
                            <button
                                onClick={() => setPayOpen(false)}
                                disabled={paying}
                                className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-300 font-bold text-sm disabled:opacity-50"
                            >
                                {isAr ? 'إلغاء' : 'Cancel'}
                            </button>
                            <button
                                onClick={submitPayment}
                                disabled={paying || !preview || (earlySelected.length > 0 && !earlyReason.trim())}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-marine-cyan hover:bg-marine-cyan-dark text-white font-black text-sm disabled:opacity-60 transition-colors"
                            >
                                {paying ? <Loader2 size={16} className="animate-spin" /> : channel === 'paymob' ? <Send size={16} /> : <Banknote size={16} />}
                                {channel === 'paymob'
                                    ? (isAr ? 'حوّل الآن' : 'Send now')
                                    : (isAr ? 'تأكيد الدفع' : 'Confirm payout')}
                            </button>
                        </div>
                    </div>
                </Overlay>
            )}

            {/* ---- Freeze / hold prompt ---- */}
            {prompt && (
                <Overlay className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !promptBusy && setPrompt(null)}>
                    <div className={`${CARD} w-full max-w-md p-6`} onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-black text-zinc-900 dark:text-white mb-1">
                            {{
                                freeze: isAr ? 'تجميد فلوس الطلب' : 'Freeze this order’s money',
                                unfreeze: isAr ? 'فك التجميد' : 'Unfreeze',
                                hold: isAr ? 'إيقاف كل التحويلات للتاجر' : 'Stop all payouts to this vendor',
                                resume: isAr ? 'استئناف التحويلات' : 'Resume payouts',
                            }[prompt.kind]}
                        </h3>
                        <p className="text-sm text-zinc-500 mb-4">
                            {{
                                freeze: isAr
                                    ? `${money(prompt.earning?.effective_net, currency, locale)} للطلب ${prompt.earning?.reference} مش هتدخل المحفظة ولا هتتحول لحد ما تفك التجميد. التاجر هيشوف السبب.`
                                    : `${money(prompt.earning?.effective_net, currency, locale)} for ${prompt.earning?.reference} will not reach the wallet or be paid until you unfreeze it. The vendor sees the reason.`,
                                unfreeze: isAr ? 'الفلوس هتدخل المحفظة فورًا لو فترة التسوية خلصت.' : 'The money reaches the wallet at once if its settlement period has ended.',
                                hold: isAr ? 'الأرباح هتفضل تتحسب، لكن مفيش أي تحويل (منك أو بطلب من التاجر) لحد ما تستأنف. التاجر هيشوف السبب.' : 'Earnings keep clearing, but nothing can be paid out — by you or on the vendor’s request — until you resume. The vendor sees the reason.',
                                resume: isAr ? 'التحويلات هترجع عادي للتاجر.' : 'Payouts to this vendor go back to normal.',
                            }[prompt.kind]}
                        </p>
                        {prompt.kind !== 'resume' && (
                            <textarea value={prompt.reason} onChange={(e) => setPrompt({ ...prompt, reason: e.target.value })} rows={2}
                                placeholder={prompt.kind === 'unfreeze' ? (isAr ? 'ملاحظة (اختياري)' : 'Note (optional)') : (isAr ? 'السبب (مطلوب)' : 'Reason (required)')}
                                className={`${INPUT} w-full resize-none mb-4`} />
                        )}
                        <div className="flex gap-3">
                            <button onClick={() => setPrompt(null)} disabled={promptBusy}
                                className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-300 font-bold text-sm">
                                {isAr ? 'إلغاء' : 'Cancel'}
                            </button>
                            <button onClick={submitPrompt}
                                disabled={promptBusy || ((prompt.kind === 'freeze' || prompt.kind === 'hold') && !prompt.reason.trim())}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-marine-cyan hover:bg-marine-cyan-dark text-white font-black text-sm disabled:opacity-50">
                                {promptBusy && <Loader2 size={16} className="animate-spin" />}
                                {isAr ? 'تأكيد' : 'Confirm'}
                            </button>
                        </div>
                    </div>
                </Overlay>
            )}
        </div>
    );
}

function Row({ label, value, currency, tone }) {
    const colour = tone === 'commission'
        ? 'text-emerald-600 dark:text-emerald-400'
        : tone === 'negative'
            ? 'text-red-600 dark:text-red-400'
            : 'text-zinc-700 dark:text-zinc-300';
    return (
        <div className="flex justify-between">
            <span className="text-zinc-500">{label}</span>
            <span dir="ltr" className={`tabular-nums ${colour}`}>
                {value < 0 ? '−' : ''}{money(Math.abs(value), currency)}
            </span>
        </div>
    );
}
