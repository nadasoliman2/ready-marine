'use client';

import { Check, Circle, Minus, X, AlertTriangle, Store, Building2, Truck } from 'lucide-react';
import { SUB_ORDER_STATUS_META, ORDER_STATUS_META, formatOrderDate } from '../../lib/orderStatus';

/**
 * The whole journey of one parcel, every rung of it, with where it actually is now.
 *
 * Rendered from `parcel.journey`, which the SERVER builds — the vendor's copy and the
 * customer's copy are the same array, so the two can never disagree about where a parcel is.
 * This component only decides how it looks.
 *
 * FIVE STATES, and each looks different on purpose:
 *   done     ✓  it happened, with the time it happened
 *   current  ●  where the parcel is right now, pulsing, the only coloured row
 *   skipped  –  passed over, because it genuinely never happened (a courier who arrived
 *               before anyone booked one). Not a tick: nothing to tick.
 *   todo     ○  still to come, dimmed
 *   stopped  ✕  the parcel stopped here and is not climbing any further
 *
 * `owner` is shown as its own small label because "who are we waiting on?" is the question
 * behind almost every "where is my order?" — and a status word alone never answers it.
 */

const OWNER_META = {
    vendor: { icon: Store, label_en: 'Store', label_ar: 'المتجر' },
    platform: { icon: Building2, label_en: 'Ready Marine', label_ar: 'ريدي مارين' },
    // The server names the courier that actually carries the parcel, so these rungs no
    // longer claim Bosta for a parcel riding Arrive.
    bosta: { icon: Truck, label_en: 'Bosta', label_ar: 'بوسطة' },
    arrive: { icon: Truck, label_en: 'Arrive', label_ar: 'أرايف' },
};
const ownerMeta = (owner) => OWNER_META[owner] || OWNER_META.bosta;

/** What each rung means in plain words — the label alone is a name, not an explanation. */
const STEP_HINT = {
    held_in_batch: { en: 'Waits for colleagues ordering from the same store, to ship together to the same address', ar: 'مستني زمايلك اللي طالبين من نفس المتجر عشان يتشحنوا مع بعض على نفس العنوان' },
    pending_review: { en: 'The store checks every item is in stock', ar: 'المتجر بيراجع توفر كل منتج' },
    awaiting_tracking: { en: 'A waybill is attached to the parcel', ar: 'بوليصة الشحن بتتلزق على الشحنة' },
    awaiting_handover: { en: 'The store packs and seals the box', ar: 'المتجر بيغلّف الشحنة ويقفلها' },
    ready_for_pickup: { en: 'Sealed and waiting at the store', ar: 'مغلّفة ومستنية في المتجر' },
    pickup_scheduled: { en: 'A courier visit is booked', ar: 'اتحجز ميعاد للمندوب' },
    handed_to_courier: { en: 'The store gave the parcel to the courier', ar: 'المتجر سلّم الشحنة للمندوب' },
    picked_up: { en: 'The courier scanned it into their network', ar: 'شركة الشحن سجّلتها في شبكتها' },
    in_transit: { en: 'Moving between the courier\u2019s hubs', ar: 'بتتنقل بين فروع شركة الشحن' },
    out_for_delivery: { en: 'With the courier, on the way to you', ar: 'مع المندوب وفي طريقها ليك' },
    delivered: { en: 'Handed to the customer', ar: 'اتسلمت للعميل' },
};

function RowIcon({ state }) {
    if (state === 'done') {
        return (
            <span className="w-6 h-6 rounded-full bg-emerald-500 grid place-items-center shrink-0">
                <Check size={13} className="text-white" strokeWidth={3} />
            </span>
        );
    }
    if (state === 'current') {
        return (
            <span className="w-6 h-6 rounded-full bg-marine-cyan grid place-items-center shrink-0 ring-4 ring-marine-cyan/20 animate-pulse">
                <Circle size={9} className="text-white fill-white" />
            </span>
        );
    }
    if (state === 'stopped') {
        return (
            <span className="w-6 h-6 rounded-full bg-red-500 grid place-items-center shrink-0">
                <X size={13} className="text-white" strokeWidth={3} />
            </span>
        );
    }
    if (state === 'skipped') {
        return (
            <span className="w-6 h-6 rounded-full border-2 border-dashed border-zinc-300 dark:border-white/20 grid place-items-center shrink-0">
                <Minus size={11} className="text-zinc-400" />
            </span>
        );
    }
    return (
        <span className="w-6 h-6 rounded-full border-2 border-zinc-200 dark:border-white/10 grid place-items-center shrink-0">
            <Circle size={7} className="text-zinc-300 dark:text-zinc-600 fill-current" />
        </span>
    );
}

/**
 * @param labels  Optional {key: {label_en, label_ar, hint_en, hint_ar}}. Supplied by the
 *                order-level journey, which speaks in seven customer words rather than the
 *                ten parcel statuses. Omitted for a parcel, which uses the shared status
 *                meta so its wording can never drift from the badge beside it.
 */
export default function ParcelJourney({ journey, isAr, showHints = true, showOwner = true, labels = null }) {
    const steps = journey?.steps || [];
    if (steps.length === 0) return null;
    const ending = journey?.ending || null;

    return (
        <div>
            <ol className="relative">
                {steps.map((step, i) => {
                    const custom = labels?.[step.key] || null;
                    const meta = custom || SUB_ORDER_STATUS_META[step.key] || {};
                    const owner = ownerMeta(step.owner) || OWNER_META.platform;
                    const OwnerIcon = owner.icon;
                    const hint = custom
                        ? { en: custom.hint_en, ar: custom.hint_ar }
                        : STEP_HINT[step.key];
                    const isLast = i === steps.length - 1;
                    const muted = step.state === 'todo' || step.state === 'skipped';

                    return (
                        <li key={step.key} className="flex gap-3 relative pb-4 last:pb-0">
                            {/* The rail. Green only as far as the parcel actually got. */}
                            {!isLast && (
                                <span
                                    className={`absolute top-6 bottom-0 w-0.5 ${
                                        step.state === 'done' ? 'bg-emerald-500' : 'bg-zinc-200 dark:bg-white/10'
                                    }`}
                                    style={{ insetInlineStart: '11px' }}
                                    aria-hidden
                                />
                            )}

                            <RowIcon state={step.state} />

                            <div className={`min-w-0 flex-1 -mt-0.5 ${muted ? 'opacity-45' : ''}`}>
                                <div className="flex items-baseline flex-wrap gap-x-2 gap-y-0.5">
                                    <span
                                        className={`text-[13px] font-black ${
                                            step.state === 'current'
                                                ? 'text-marine-primary'
                                                : step.state === 'stopped'
                                                ? 'text-red-500'
                                                : 'text-zinc-900 dark:text-white'
                                        }`}
                                    >
                                        {isAr ? meta.label_ar : meta.label_en}
                                    </span>

                                    {showOwner && (
                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-zinc-400">
                                            <OwnerIcon size={10} />
                                            {isAr ? owner.label_ar : owner.label_en}
                                        </span>
                                    )}

                                    {step.state === 'current' && (
                                        <span className="text-[10px] font-black text-marine-primary bg-marine-cyan/10 px-2 py-0.5 rounded-full">
                                            {isAr ? 'دلوقتي هنا' : 'You are here'}
                                        </span>
                                    )}
                                    {step.state === 'skipped' && (
                                        <span className="text-[10px] font-bold text-zinc-400">
                                            {isAr ? 'متخطّاة' : 'skipped'}
                                        </span>
                                    )}
                                </div>

                                {showHints && hint && (
                                    <p className="text-[11px] text-zinc-500 mt-0.5 leading-snug">
                                        {isAr ? hint.ar : hint.en}
                                    </p>
                                )}

                                {step.at && (
                                    <p className="text-[10px] text-zinc-400 mt-0.5">
                                        {formatOrderDate(step.at, isAr)}
                                    </p>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ol>

            {/* An ending is not a rung — the parcel stopped, it did not pass through. */}
            {ending && (
                <div
                    className={`mt-3 rounded-xl px-4 py-3 border ${
                        ending.tone === 'problem'
                            ? 'bg-red-500/10 border-red-500/20'
                            : 'bg-zinc-500/10 border-zinc-500/20'
                    }`}
                >
                    <p
                        className={`text-[13px] font-black flex items-center gap-2 ${
                            ending.tone === 'problem' ? 'text-red-500' : 'text-zinc-500'
                        }`}
                    >
                        <AlertTriangle size={14} />
                        {isAr
                            ? ORDER_STATUS_META[ending.key]?.label_ar || SUB_ORDER_STATUS_META[ending.key]?.label_ar || ending.key
                            : ORDER_STATUS_META[ending.key]?.label_en || SUB_ORDER_STATUS_META[ending.key]?.label_en || ending.key}
                    </p>
                    {ending.reason && <p className="text-[11px] text-zinc-500 mt-1">{ending.reason}</p>}
                    {ending.at && (
                        <p className="text-[10px] text-zinc-400 mt-1">{formatOrderDate(ending.at, isAr)}</p>
                    )}
                </div>
            )}
        </div>
    );
}
