'use client';

import { useState } from 'react';
import { Banknote, CheckCircle2, ChevronUp, Minus, PackageCheck, Plus, ShoppingBag, Trash2, Truck } from 'lucide-react';
import Link from '../LocaleLink';
import { chatCopy, formatMoney } from './chatCopy';

/*
 * The sale inside the chat: the basket the assistant is building with the
 * customer, docked above the composer, and the order it became, as a receipt in
 * the conversation. Both come from EverySecond with every reply — nothing here
 * reads the assistant's text. Names and prices are what it sold at; photos and
 * links are ours.
 */

const slugFor = (line, language) => (language === 'en' ? line.slugEn || line.slugAr : line.slugAr || line.slugEn);

function Thumb({ image }) {
    return (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-100 bg-white">
            {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="" loading="lazy" className="h-full w-full object-contain p-1" />
            ) : (
                <ShoppingBag size={15} className="text-zinc-300" />
            )}
        </span>
    );
}

/*
 * One basket or order line. In the basket (`onEdit` given) each of our products
 * gets − / + / remove: they change the website cart, which is put into the
 * agent's basket a moment later — the same path a change on the site takes.
 */
function Line({ line, language, onNavigate, onEdit }) {
    const copy = chatCopy(language);
    const slug = slugFor(line, language);
    const editable = Boolean(onEdit && line.cart?.product?._id);
    const name = <span dir="auto" className="line-clamp-2 text-[12px] font-semibold leading-4 text-zinc-900">{line.name}</span>;
    return (
        <li className="flex items-center gap-2.5">
            <Thumb image={line.image} />
            <span className="min-w-0 flex-1">
                {slug ? <Link href={`/product/${slug}`} onClick={onNavigate} className="hover:underline">{name}</Link> : name}
                {editable ? (
                    <span className="mt-1 flex items-center gap-1.5">
                        <span className="flex items-center rounded-lg border border-zinc-200 bg-zinc-50" dir="ltr">
                            <button type="button" onClick={() => onEdit(line, -1)} aria-label={copy.decrease} className="flex h-6 w-6 items-center justify-center text-zinc-600 hover:text-marine-primary">
                                <Minus size={12} strokeWidth={2.6} />
                            </button>
                            <span className="min-w-[18px] text-center text-[11px] font-bold text-zinc-900">{line.qty}</span>
                            <button type="button" onClick={() => onEdit(line, 1)} aria-label={copy.increase} className="flex h-6 w-6 items-center justify-center text-zinc-600 hover:text-marine-primary">
                                <Plus size={12} strokeWidth={2.6} />
                            </button>
                        </span>
                        {line.unitPrice != null && <span className="text-[10.5px] text-zinc-500" dir="auto">× {formatMoney(line.unitPrice, language)}</span>}
                        <button type="button" onClick={() => onEdit(line, -line.qty)} aria-label={copy.remove} title={copy.remove} className="ms-auto flex h-6 w-6 items-center justify-center rounded-lg text-zinc-400 hover:bg-red-50 hover:text-marine-primary">
                            <Trash2 size={13} />
                        </button>
                    </span>
                ) : line.unitPrice != null && (
                    <span className="block text-[10.5px] text-zinc-500" dir="auto">
                        {line.qty} × {formatMoney(line.unitPrice, language)}
                    </span>
                )}
            </span>
            {line.lineTotal != null && <span className="shrink-0 text-[12px] font-bold text-zinc-900">{formatMoney(line.lineTotal, language)}</span>}
        </li>
    );
}

function Totals({ itemsTotal, deliveryFee, total, language }) {
    const copy = chatCopy(language);
    return (
        <dl className="space-y-1 border-t border-dashed border-zinc-200 pt-2 text-[12px]">
            {itemsTotal != null && (
                <div className="flex justify-between gap-3">
                    <dt className="text-zinc-500">{copy.subtotal}</dt>
                    <dd className="font-semibold text-zinc-900">{formatMoney(itemsTotal, language)}</dd>
                </div>
            )}
            <div className="flex justify-between gap-3">
                <dt className="text-zinc-500">{copy.delivery}</dt>
                <dd className="font-semibold text-zinc-900">
                    {deliveryFee == null ? copy.deliveryLater : deliveryFee === 0 ? copy.deliveryFree : formatMoney(deliveryFee, language)}
                </dd>
            </div>
            {total != null && (
                <div className="flex justify-between gap-3 text-[13px]">
                    <dt className="font-bold text-zinc-900">{copy.total}</dt>
                    <dd className="font-extrabold text-marine-primary">{formatMoney(total, language)}</dd>
                </div>
            )}
        </dl>
    );
}

/**
 * Collapsed it is one line — how many items and what they come to — so the
 * conversation keeps the room. Open, it lists them with the two ways to finish:
 * ask the assistant to place it (cash on delivery), or pay on the website.
 */
export function ChatBasket({ cart, language, busy, onComplete, onCheckout, onNavigate, onEdit, onEmpty }) {
    const copy = chatCopy(language);
    const [open, setOpen] = useState(false);
    if (!cart?.items?.length) return null;
    const count = cart.items.reduce((s, l) => s + l.qty, 0);
    const amount = cart.total ?? cart.itemsTotal;
    return (
        <div className="rc-chat-pop mx-3 mb-2 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_-6px_24px_rgba(0,0,0,0.06)]">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-start"
            >
                <span data-chat-basket-target="" className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-white">
                    <ShoppingBag size={17} />
                    <span className="absolute -end-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-marine-cyan px-1 text-[9.5px] font-extrabold" dir="ltr">
                        {count}
                    </span>
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-bold text-zinc-900">{copy.basket(count)}</span>
                    {amount != null && <span className="block text-[11.5px] font-semibold text-marine-primary">{formatMoney(amount, language)}</span>}
                </span>
                <ChevronUp size={17} className={`text-zinc-400 transition-transform duration-300 ${open ? '' : 'rotate-180'}`} />
            </button>
            <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                <div className="overflow-hidden">
                    <div className="space-y-2.5 px-3 pb-3">
                        <ul className="max-h-44 space-y-2 overflow-y-auto pe-1">
                            {cart.items.map((line, i) => (
                                <Line key={`${line.externalId || line.name}-${i}`} line={line} language={language} onNavigate={onNavigate} onEdit={onEdit} />
                            ))}
                        </ul>
                        {onEmpty && cart.items.some((l) => l.cart?.product?._id) && (
                            <button type="button" onClick={onEmpty} className="flex items-center gap-1 text-[11px] font-semibold text-zinc-400 hover:text-marine-primary">
                                <Trash2 size={12} /> {copy.emptyBasket}
                            </button>
                        )}
                        <Totals itemsTotal={cart.itemsTotal} deliveryFee={cart.deliveryFee} total={cart.total} language={language} />
                        <div className="flex gap-2">
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => { setOpen(false); onComplete(); }}
                                className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-marine-cyan text-[12.5px] font-bold text-white shadow-[0_8px_18px_rgba(0,166,206,0.3)] transition-all hover:bg-marine-cyan-dark active:scale-95 disabled:opacity-60"
                            >
                                <Banknote size={15} /> {copy.completeInChat}
                            </button>
                            <button
                                type="button"
                                onClick={onCheckout}
                                className="flex h-10 flex-1 items-center justify-center rounded-xl border border-zinc-900 text-[12.5px] font-bold text-zinc-900 transition-colors hover:bg-zinc-900 hover:text-white"
                            >
                                {copy.checkoutOnSite}
                            </button>
                        </div>
                        <p className="text-center text-[10.5px] text-zinc-400">{copy.cod}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

const STATUS_STYLE = {
    cancelled: 'bg-zinc-100 text-zinc-500',
    delivered: 'bg-emerald-50 text-emerald-700',
    out_for_delivery: 'bg-sky-50 text-sky-700',
};

/** The order a turn placed — a receipt in the conversation, with our own order number. */
export function ChatOrderCard({ order, language, signedIn, onNavigate }) {
    const copy = chatCopy(language);
    const status = copy.orderStatus[order.status] || order.status;
    return (
        <div className="rc-chat-pop mt-2 overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-[0_8px_24px_rgba(16,185,129,0.10)]">
            <div className="flex items-center gap-2.5 bg-gradient-to-l from-emerald-500 to-emerald-600 px-3 py-2.5 text-white rtl:bg-gradient-to-r">
                <span className="rc-chat-check flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
                    <CheckCircle2 size={18} />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-extrabold">{copy.orderTitle}</span>
                    {order.reference && (
                        <span className="block text-[11px] opacity-90" dir="auto">
                            {copy.orderRef}: <span dir="ltr" className="font-mono font-bold">{order.reference}</span>
                        </span>
                    )}
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[order.status] || 'bg-white text-emerald-700'}`}>
                    {status}
                </span>
            </div>
            <div className="space-y-2.5 p-3">
                <ul className="space-y-2">
                    {order.items.slice(0, 3).map((line, i) => (
                        <Line key={`${line.externalId || line.name}-${i}`} line={line} language={language} onNavigate={onNavigate} />
                    ))}
                </ul>
                {order.items.length > 3 && <p className="text-[11px] text-zinc-500">+{order.items.length - 3}</p>}
                <Totals itemsTotal={order.itemsTotal} deliveryFee={order.deliveryFee} total={order.total} language={language} />
                <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                    <Banknote size={14} className="text-emerald-600" /> {copy.cod}
                </div>
                {(signedIn || order.trackingUrl) && (
                    <div className="flex gap-2">
                        {signedIn && (
                            <Link
                                href="/profile?tab=orders"
                                onClick={onNavigate}
                                className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-zinc-900 text-[12px] font-bold text-white hover:bg-zinc-800"
                            >
                                <PackageCheck size={14} /> {copy.viewOrders}
                            </Link>
                        )}
                        {order.trackingUrl && (
                            <a
                                href={order.trackingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-200 text-[12px] font-bold text-zinc-900 hover:border-zinc-900"
                            >
                                <Truck size={14} /> {copy.track}
                            </a>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
