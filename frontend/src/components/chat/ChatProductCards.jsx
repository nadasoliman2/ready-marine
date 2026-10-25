'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, ImageOff, ShoppingCart } from 'lucide-react';
import Link from '../LocaleLink';
import { chatCopy, formatMoney } from './chatCopy';

/*
 * The products the assistant recommended, under its reply: a swipeable row of
 * cards. Everything on a card comes from the agent's menu — this store's own
 * catalogue, synced — so the price and the photo are the real ones. "Add to
 * cart" puts it in the website cart (and so in the chat basket) and flies it
 * there.
 */

const slugFor = (card, language) => (language === 'en' ? card.slugEn || card.slugAr : card.slugAr || card.slugEn);

function ChatProductCard({ card, language, onAdd, onNavigate, index }) {
    const copy = chatCopy(language);
    const imageRef = useRef(null);
    const [added, setAdded] = useState(false);
    const [broken, setBroken] = useState(false);
    const slug = slugFor(card, language);
    const canAdd = Boolean(card.cart) && card.inStock;
    const onOffer = card.originalPrice != null && card.price != null && card.originalPrice > card.price;
    const discount = onOffer ? Math.round((1 - card.price / card.originalPrice) * 100) : 0;

    useEffect(() => {
        if (!added) return undefined;
        const timer = setTimeout(() => setAdded(false), 2200);
        return () => clearTimeout(timer);
    }, [added]);

    const add = () => {
        if (!canAdd || added) return;
        if (onAdd(card, imageRef.current)) setAdded(true);
    };

    const photo = (
        <span
            ref={imageRef}
            className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-zinc-50 to-white"
        >
            {card.image && !broken ? (
                // Product photos are served from EverySecond's storage or our uploads host,
                // outside next/image's allow-list.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={card.image}
                    alt={card.name}
                    loading="lazy"
                    onError={() => setBroken(true)}
                    className={`h-full w-full object-contain p-2 transition-transform duration-500 group-hover:scale-105 ${card.inStock ? '' : 'grayscale opacity-60'}`}
                />
            ) : (
                <ImageOff size={26} className="text-zinc-300" />
            )}
            {onOffer && (
                <span className="absolute start-1.5 top-1.5 rounded-full bg-marine-cyan px-2 py-0.5 text-[10px] font-extrabold text-white shadow-sm">
                    {card.offerName || copy.offer} {discount > 0 ? `-${discount}%` : ''}
                </span>
            )}
            {!card.inStock && (
                <span className="absolute inset-x-2 bottom-2 rounded-lg bg-zinc-900/80 py-1 text-center text-[10px] font-bold text-white">
                    {copy.outOfStock}
                </span>
            )}
        </span>
    );

    return (
        <li
            className="rc-chat-card-in group flex w-[172px] shrink-0 snap-start flex-col rounded-2xl border border-zinc-100 bg-white p-2 shadow-[0_6px_20px_rgba(0,0,0,0.06)] transition-shadow hover:shadow-[0_10px_28px_rgba(0,0,0,0.10)]"
            style={{ animationDelay: `${index * 70}ms` }}
            data-chat-card={card.externalId || undefined}
        >
            {slug ? (
                <Link href={`/product/${slug}`} onClick={onNavigate} className="block">{photo}</Link>
            ) : card.url ? (
                <a href={card.url} target="_blank" rel="noopener noreferrer" className="block">{photo}</a>
            ) : photo}

            <div className="flex flex-1 flex-col px-0.5 pt-2">
                <p dir="auto" className="line-clamp-2 min-h-[34px] text-[12.5px] font-bold leading-[17px] text-zinc-900">{card.name}</p>
                {(card.options || card.description) && (
                    <p dir="auto" className="mt-0.5 line-clamp-1 text-[10.5px] leading-4 text-zinc-500">{card.options || card.description}</p>
                )}
                <div className="mt-1.5 flex items-baseline gap-1.5">
                    <span className="text-[14px] font-extrabold text-zinc-900">
                        {card.price != null ? formatMoney(card.price, language) : card.priceText}
                    </span>
                    {onOffer && (
                        <span className="text-[10.5px] font-semibold text-zinc-400 line-through">{formatMoney(card.originalPrice, language)}</span>
                    )}
                </div>
                <div className="mt-2 flex gap-1.5">
                    <button
                        type="button"
                        onClick={add}
                        disabled={!canAdd}
                        className={`flex h-8 flex-1 items-center justify-center gap-1 rounded-xl text-[11.5px] font-bold transition-all active:scale-95 ${
                            added
                                ? 'bg-emerald-500 text-white'
                                : canAdd
                                    ? 'bg-marine-cyan text-white shadow-[0_6px_14px_rgba(0,166,206,0.28)] hover:bg-marine-cyan-dark'
                                    : 'cursor-not-allowed bg-zinc-100 text-zinc-400'
                        }`}
                    >
                        {added ? <Check size={14} strokeWidth={3} /> : <ShoppingCart size={14} />}
                        <span>{added ? copy.added : copy.addToCart}</span>
                    </button>
                    {slug && (
                        <Link
                            href={`/product/${slug}`}
                            onClick={onNavigate}
                            title={copy.view}
                            aria-label={copy.view}
                            className="flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-200 text-zinc-600 transition-colors hover:border-zinc-900 hover:text-zinc-900"
                        >
                            {language === 'en' ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
                        </Link>
                    )}
                </div>
            </div>
        </li>
    );
}

export default function ChatProductCards({ cards, language, onAdd, onNavigate }) {
    const rowRef = useRef(null);
    if (!cards?.length) return null;
    const scrollBy = (dir) => {
        const el = rowRef.current;
        if (!el) return;
        const rtl = getComputedStyle(el).direction === 'rtl';
        el.scrollBy({ left: dir * (rtl ? -1 : 1) * 176, behavior: 'smooth' });
    };
    return (
        <div className="relative mt-2.5">
            <ul ref={rowRef} className="scrollbar-hide flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-0.5 pb-2 pt-0.5">
                {cards.map((card, i) => (
                    <ChatProductCard
                        key={`${card.externalId || card.name}-${i}`}
                        card={card}
                        index={i}
                        language={language}
                        onAdd={onAdd}
                        onNavigate={onNavigate}
                    />
                ))}
            </ul>
            {cards.length > 1 && (
                <>
                    <button
                        type="button"
                        aria-hidden="true"
                        tabIndex={-1}
                        onClick={() => scrollBy(-1)}
                        className="absolute start-0 top-[70px] hidden h-8 w-8 -translate-x-1/3 items-center justify-center rounded-full border border-zinc-200 bg-white/95 text-zinc-700 shadow-md backdrop-blur hover:text-marine-primary sm:flex rtl:translate-x-1/3"
                    >
                        <ChevronLeft size={16} className="rtl:rotate-180" />
                    </button>
                    <button
                        type="button"
                        aria-hidden="true"
                        tabIndex={-1}
                        onClick={() => scrollBy(1)}
                        className="absolute end-0 top-[70px] hidden h-8 w-8 translate-x-1/3 items-center justify-center rounded-full border border-zinc-200 bg-white/95 text-zinc-700 shadow-md backdrop-blur hover:text-marine-primary sm:flex rtl:-translate-x-1/3"
                    >
                        <ChevronRight size={16} className="rtl:rotate-180" />
                    </button>
                </>
            )}
        </div>
    );
}
