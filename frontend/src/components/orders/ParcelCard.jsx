'use client';

import { useState } from 'react';
import Link from '../LocaleLink';
import {
    Store, Truck, CheckCircle2, Clock, AlertTriangle, XCircle,
    ChevronDown, Wallet, RotateCcw, MessageCircle, ExternalLink, Star, Loader2, Zap, Users,
} from 'lucide-react';
import ParcelJourney from './ParcelJourney';
import BatchProgress from '../company/BatchProgress';
import {
    getSubOrderStatusLabel,
    getSubOrderStatusColor,
    getReturnStateLabel,
    getReturnStateColor,
} from '../../lib/orderStatus';

/**
 * One parcel on the customer's order — one store, one branch, one box.
 *
 * The store's name is the loudest thing on the card. That is deliberate: an order arriving
 * in three pieces on three days only makes sense once the customer can see that three
 * different merchants are involved. Without it the same experience just reads as the site
 * behaving strangely.
 *
 * The amount due rides on the card for the same reason — a cash customer must never first
 * learn what this courier will ask for when the courier is already at the door.
 */
export default function ParcelCard({
    parcel,
    index,
    total,
    currency,
    isAr,
    onCancel,
    // A company order waiting in its batch can be sent on alone (feature 14).
    onShipNow = null,
    onRequestReturn,
    onContactSupport,
    // Rate this parcel. Offered on a delivered parcel that has not been rated yet.
    onReview,
    reviewing = false,
    busy = false,
    // Off when this is the order's only parcel: the order-level journey above says exactly
    // the same thing, and two identical ladders on one card is just noise.
    showJourney = true,
}) {
    // Open by default. The whole point of this list is that the customer can see every step
    // and where their parcel is without hunting for a toggle; collapsing is the exception,
    // for someone with several parcels who wants the cards short.
    const [showTimeline, setShowTimeline] = useState(true);
    // Bosta's raw event strings, underneath the journey. The journey says which STEP the
    // parcel reached; this says exactly what the courier's system called it, which is what
    // support needs when something went wrong.
    const [showRaw, setShowRaw] = useState(false);

    const status = parcel.status;
    const isDelivered = status === 'delivered';
    const isCancelled = status === 'cancelled';
    const isProblem = status === 'exception' || status === 'returned';
    const money = (n) => `${currency} ${Number(n || 0).toFixed(2)}`;
    // What has gone back out of this parcel. Empty for the common case where nothing has.
    const returnLabel = getReturnStateLabel(parcel.return_state, isAr);

    const StatusIcon = isDelivered ? CheckCircle2
        : isProblem ? AlertTriangle
        : isCancelled ? XCircle
        : ['pickup_scheduled', 'picked_up', 'in_transit', 'out_for_delivery'].includes(status) ? Truck
        : Clock;

    // The newest few events, newest first — enough to answer "where is it?" without
    // becoming a log.
    const timeline = [...(parcel.tracking_history || [])].reverse().slice(0, 6);

    return (
        <div
            className={`rounded-2xl border overflow-hidden transition ${
                isProblem ? 'border-red-500/40 bg-red-500/[0.03]'
                : isCancelled ? 'border-white/10 bg-white/[0.02] opacity-70'
                : 'border-white/10 bg-white/5'
            }`}
        >
            {/* Store name first — this is what tells the customer these are different shops */}
            <div className="flex items-start justify-between gap-3 p-4 pb-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <Store size={14} className="text-zinc-400 shrink-0" />
                        <p className="text-sm font-black text-white truncate">
                            {parcel.vendor_name || (isAr ? 'متجر' : 'Store')}
                        </p>
                    </div>
                    {parcel.fulfillment_location && (
                        <p className="text-xs text-zinc-500 mt-0.5 ps-6 truncate">
                            {parcel.fulfillment_location}
                        </p>
                    )}
                    {total > 1 && (
                        <p className="text-xs text-zinc-500 mt-1 ps-6">
                            {isAr ? `شحنة ${index + 1} من ${total}` : `Parcel ${index + 1} of ${total}`}
                        </p>
                    )}
                </div>

                {/* Delivery and return are two separate facts about the same parcel: it was
                    delivered, AND part of it has since gone back. Folding the second into
                    the first would lose one of them. */}
                <div className="shrink-0 flex flex-col items-end gap-1.5">
                    <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-wider ${getSubOrderStatusColor(status)}`}
                    >
                        <StatusIcon size={11} />
                        {getSubOrderStatusLabel(status, isAr)}
                    </span>
                    {returnLabel && (
                        <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${getReturnStateColor(parcel.return_state)}`}
                        >
                            <RotateCcw size={10} />
                            {returnLabel}
                        </span>
                    )}
                </div>
            </div>

            {/* What Bosta says went wrong, in words, plus a way out */}
            {isProblem && (
                <div className="mx-4 mb-3 rounded-xl bg-red-500/10 border border-red-500/25 p-3">
                    <p className="text-sm text-red-300 leading-relaxed">
                        {parcel.bosta_status
                            ? (isAr
                                ? `فيه مشكلة في الشحنة دي: ${parcel.bosta_status}`
                                : `There is a problem with this parcel: ${parcel.bosta_status}`)
                            : (isAr
                                ? 'فيه مشكلة في الشحنة دي وفريق الدعم بيتابعها.'
                                : 'There is a problem with this parcel and our team is following it up.')}
                    </p>
                    {onContactSupport && (
                        <button
                            onClick={() => onContactSupport(parcel)}
                            className="mt-2 inline-flex items-center gap-1.5 text-sm font-bold text-red-200 hover:text-white transition"
                        >
                            <MessageCircle size={12} />
                            {isAr ? 'تواصل مع الدعم' : 'Contact support'}
                        </button>
                    )}
                </div>
            )}

            {isCancelled && parcel.cancel_reason && (
                <p className="mx-4 mb-3 text-sm text-zinc-500">{parcel.cancel_reason}</p>
            )}

            {/* A company order consolidated to the office: where its batch stands, or the
                combined parcel it now travels in. */}
            {parcel.company_batch && !isCancelled && (
                <div className="mx-4 mb-3 rounded-xl bg-sky-500/10 border border-sky-500/20 p-3 space-y-2">
                    {parcel.company_batch.waiting ? (
                        <>
                            <p className="text-sm text-sky-200 leading-relaxed">
                                {isAr
                                    ? 'مستني زمايلك اللي طالبين من نفس المتجر عشان يتشحنوا مع بعض على نفس العنوان. اللي هيتوفر في الشحن بيرجعلك أول ما الدفعة تتقفل.'
                                    : 'Waiting for colleagues ordering from the same store, to ship together to the same address. What the batch saves on shipping comes back to you when it closes.'}
                            </p>
                            {parcel.company_batch.batch && (
                                <BatchProgress
                                    waiting={parcel.company_batch.batch.waiting_count}
                                    target={parcel.company_batch.batch.target_count}
                                    deadline={parcel.company_batch.batch.deadline_at}
                                    isAr={isAr}
                                />
                            )}
                            <div className="flex flex-wrap gap-2 pt-1">
                                {onShipNow && (
                                    <button
                                        onClick={() => onShipNow(parcel)}
                                        disabled={busy}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-sm font-bold text-white transition disabled:opacity-50"
                                    >
                                        <Zap size={12} />
                                        {isAr ? 'ابعته دلوقتي' : 'Ship it now'}
                                    </button>
                                )}
                                <Link href="/profile?tab=company" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold text-sky-300 hover:text-white transition">
                                    {isAr ? 'تابع الدفعة' : 'Follow the batch'}
                                </Link>
                            </div>
                        </>
                    ) : parcel.company_batch.role ? (
                        <p className="text-sm text-sky-200 flex items-start gap-2">
                            <Users size={14} className="mt-0.5 shrink-0" />
                            <span>
                                {isAr ? 'بيتشحن في طرد واحد مع أوردرات زمايلك على نفس العنوان.' : 'Ships in one parcel with your colleagues\u2019 orders to the same address.'}
                                {Number(parcel.company_batch.savings) > 0 && (
                                    <span className="font-bold text-emerald-300">
                                        {isAr ? ` وفّرت ${money(parcel.company_batch.savings)} في الشحن.` : ` You saved ${money(parcel.company_batch.savings)} on shipping.`}
                                    </span>
                                )}
                            </span>
                        </p>
                    ) : parcel.company_batch.left_reason === 'ship_now' ? (
                        <p className="text-sm text-sky-200">{isAr ? 'اتبعت لوحده بناءً على طلبك.' : 'Sent on its own, as you asked.'}</p>
                    ) : (
                        <p className="text-sm text-sky-200">{isAr ? 'الدفعة اتقفلت بيه لوحده، فبيتشحن زي أي أوردر.' : 'Its batch closed with it alone, so it ships like any order.'}</p>
                    )}
                </div>
            )}

            {/* Items */}
            <ul className="px-4 space-y-2">
                {(parcel.items || []).map((item, i) => (
                    <li key={item._id || i} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-zinc-200 truncate">
                            {item.product_title}
                            {item.variant_label && item.variant_label !== 'Default' && (
                                <span className="text-zinc-500"> ({item.variant_label})</span>
                            )}
                            <span className="text-zinc-500"> ×{item.quantity}</span>
                        </span>
                        {item.product_slug && (
                            <Link
                                href={`/product/${item.product_slug}`}
                                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-white/10 hover:bg-marine-cyan text-zinc-200 hover:text-white transition-colors"
                            >
                                <ExternalLink size={12} />
                                {isAr ? 'المنتج' : 'View'}
                            </Link>
                        )}
                    </li>
                ))}
            </ul>

            {/* Money and tracking */}
            <div className="px-4 py-3 mt-3 border-t border-white/5 flex flex-wrap items-center gap-x-4 gap-y-2">
                {Number(parcel.amount_due_on_delivery) > 0 && !isDelivered && !isCancelled && (
                    <span className="inline-flex items-center gap-1.5 text-sm font-bold text-amber-400">
                        <Wallet size={14} />
                        {isAr ? 'المطلوب للمندوب: ' : 'Courier collects: '}
                        {money(parcel.amount_due_on_delivery)}
                    </span>
                )}
                {Number(parcel.amount_due_on_delivery) > 0 && isDelivered && (
                    <span className="text-sm text-zinc-500">
                        {isAr ? 'المدفوع: ' : 'Paid: '}{money(parcel.amount_due_on_delivery)}
                    </span>
                )}
                {(parcel.tracking_number || parcel.bosta_tracking_number) && (
                    parcel.tracking_url ? (
                        <a href={parcel.tracking_url} target="_blank" rel="noreferrer" className="text-sm font-mono text-zinc-400 hover:text-white underline underline-offset-2">
                            {(isAr ? parcel.courier_label_ar : parcel.courier_label) ? `${(isAr ? parcel.courier_label_ar : parcel.courier_label)} · ` : ''}{parcel.tracking_number || parcel.bosta_tracking_number}
                        </a>
                    ) : (
                        <span className="text-sm font-mono text-zinc-400">
                            {(isAr ? parcel.courier_label_ar : parcel.courier_label) ? `${(isAr ? parcel.courier_label_ar : parcel.courier_label)} · ` : ''}{parcel.tracking_number || parcel.bosta_tracking_number}
                        </span>
                    )
                )}
            </div>

            {/* Every step of this parcel, ours and Bosta's, with where it is right now.
                On a single-parcel order the ladder is suppressed as a duplicate of the
                order's own — but the courier's raw updates are not in that ladder and are
                the one place an exception explains itself, so they stay either way. */}
            {((showJourney && parcel.journey?.steps?.length > 0) || timeline.length > 0) && (
                <div className="px-4 pb-3">
                    <button
                        onClick={() => setShowTimeline((v) => !v)}
                        className="inline-flex items-center gap-1 text-xs font-bold text-zinc-500 hover:text-zinc-300 transition"
                        aria-expanded={showTimeline}
                    >
                        {isAr ? 'تتبع الشحنة' : 'Track this parcel'}
                        <ChevronDown size={11} className={`transition-transform ${showTimeline ? 'rotate-180' : ''}`} />
                    </button>

                    {showTimeline && (
                        <div className="mt-3">
                            {showJourney && <ParcelJourney journey={parcel.journey} isAr={isAr} />}

                            {timeline.length > 0 && (
                                <div className={showJourney ? 'mt-3 pt-3 border-t border-white/5' : ''}>
                                    <button
                                        onClick={() => setShowRaw((v) => !v)}
                                        className="inline-flex items-center gap-1 text-xs font-bold text-zinc-500 hover:text-zinc-300 transition"
                                        aria-expanded={showRaw}
                                    >
                                        {isAr ? 'تفاصيل من شركة الشحن' : 'Courier updates'}
                                        <ChevronDown size={11} className={`transition-transform ${showRaw ? 'rotate-180' : ''}`} />
                                    </button>
                                    {showRaw && (
                                        <ol className="mt-2 space-y-1.5 border-s border-white/10 ps-3">
                                            {timeline.map((entry, i) => (
                                                <li key={i} className="text-xs">
                                                    <span className="text-zinc-300">{entry.state}</span>
                                                    {entry.notes && <span className="text-zinc-500"> — {entry.notes}</span>}
                                                    <span className="block text-zinc-600">
                                                        {entry.timestamp ? new Date(entry.timestamp).toLocaleString(isAr ? 'ar-EG' : 'en-GB') : ''}
                                                    </span>
                                                </li>
                                            ))}
                                        </ol>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Actions live INSIDE the card they act on, so it is impossible to cancel or
                return the wrong parcel. */}
            {(parcel.can_cancel || isDelivered) && (
                <div className="px-4 pb-4 pt-1 flex flex-wrap gap-2">
                    {isDelivered && onReview && parcel.review?.can_review && (
                        <button
                            onClick={() => onReview(parcel)}
                            disabled={reviewing}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-sm font-black text-zinc-900 transition disabled:opacity-60"
                        >
                            {reviewing ? <Loader2 size={12} className="animate-spin" /> : <Star size={12} />}
                            {isAr ? 'قيّم الطرد ده' : 'Rate this parcel'}
                        </button>
                    )}
                    {isDelivered && parcel.review?.submitted && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-sm font-bold text-emerald-400">
                            <CheckCircle2 size={12} />
                            {isAr ? 'اتقيّم — شكرًا' : 'Rated — thank you'}
                        </span>
                    )}
                    {isDelivered && onRequestReturn && (
                        <button
                            onClick={() => onRequestReturn(parcel)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-sm font-bold text-white transition"
                        >
                            <RotateCcw size={12} />
                            {isAr ? 'طلب إرجاع' : 'Request return'}
                        </button>
                    )}
                    {parcel.can_cancel && onCancel && (
                        <button
                            onClick={() => onCancel(parcel)}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 hover:bg-red-500/10 text-sm font-bold text-red-400 transition disabled:opacity-50"
                        >
                            <XCircle size={12} />
                            {isAr ? 'إلغاء الشحنة' : 'Cancel this parcel'}
                        </button>
                    )}
                </div>
            )}

            {/* Say WHY the option is gone, rather than silently omitting it */}
            {!parcel.can_cancel && !isDelivered && !isCancelled && parcel.cancel_blocked_reason && (
                <p className="px-4 pb-4 text-xs text-zinc-500">
                    {isAr ? (parcel.cancel_blocked_reason_ar || parcel.cancel_blocked_reason) : parcel.cancel_blocked_reason}
                </p>
            )}
        </div>
    );
}
