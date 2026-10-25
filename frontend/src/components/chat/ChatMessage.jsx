'use client';

import { AlertCircle, Mic, RotateCw, Sparkles } from 'lucide-react';
import { chatCopy } from './chatCopy';
import ChatProductCards from './ChatProductCards';
import { ChatOrderCard } from './ChatBasket';

/*
 * One line of the conversation. The assistant writes plain text with a little
 * WhatsApp-style markup — **bold**, links, phone numbers, "- " bullets — which
 * is turned into React nodes here, never into HTML.
 */

const TOKEN = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|https?:\/\/[^\s<>()]+[^\s<>().,!?،؟]|(?:\+?20|0)1[0125]\d{8})/g;

function renderInline(text, keyPrefix) {
    const out = [];
    let last = 0;
    let match;
    let i = 0;
    TOKEN.lastIndex = 0;
    while ((match = TOKEN.exec(text))) {
        if (match.index > last) out.push(text.slice(last, match.index));
        const token = match[0];
        const key = `${keyPrefix}-${i += 1}`;
        if (token.startsWith('**')) {
            out.push(<strong key={key} className="font-extrabold">{token.slice(2, -2)}</strong>);
        } else if (token.startsWith('*')) {
            out.push(<strong key={key} className="font-bold">{token.slice(1, -1)}</strong>);
        } else if (/^https?:/.test(token)) {
            out.push(
                <a key={key} href={token} target="_blank" rel="noopener noreferrer" dir="ltr" className="break-all font-semibold underline decoration-2 underline-offset-2">
                    {token.replace(/^https?:\/\/(www\.)?/, '').slice(0, 42)}{token.length > 50 ? '…' : ''}
                </a>
            );
        } else {
            out.push(<a key={key} href={`tel:${token}`} dir="ltr" className="font-semibold underline">{token}</a>);
        }
        last = match.index + token.length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
}

/** Paragraphs and "- " / "• " / "1. " lists, each line's markup rendered inline. */
export function renderRich(text) {
    const blocks = [];
    let list = null;
    String(text || '').split('\n').forEach((raw, index) => {
        const line = raw.trimEnd();
        // "- item" / "• item" get a dot; "1. item" / "١) item" keep their number.
        const bullet = /^\s*(?:[-•*]|([0-9٠-٩]+)[.)])\s+(.*)$/.exec(line);
        if (bullet) {
            if (!list) {
                list = [];
                blocks.push({ type: 'list', items: list, key: `l${index}` });
            }
            list.push({ text: bullet[2], number: bullet[1] || null, key: `i${index}` });
            return;
        }
        list = null;
        if (line.trim()) blocks.push({ type: 'p', text: line, key: `p${index}` });
        else blocks.push({ type: 'gap', key: `g${index}` });
    });
    return blocks.map((block) => {
        if (block.type === 'list') {
            return (
                <ul key={block.key} className="my-1 space-y-1">
                    {block.items.map((item) => (
                        <li key={item.key} className="flex gap-2">
                            {item.number
                                ? <span className="shrink-0 font-bold opacity-60">{item.number}.</span>
                                : <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-50" />}
                            <span className="min-w-0">{renderInline(item.text, item.key)}</span>
                        </li>
                    ))}
                </ul>
            );
        }
        if (block.type === 'gap') return <span key={block.key} className="block h-1.5" />;
        return <p key={block.key}>{renderInline(block.text, block.key)}</p>;
    });
}

export default function ChatMessage({ line, language, signedIn, onAddCard, onNavigate, onRetry }) {
    const copy = chatCopy(language);
    const mine = line.from === 'customer';
    const hasText = Boolean(line.text?.trim());

    if (mine) {
        return (
            <div className="rc-chat-msg-in flex flex-col items-end">
                <div
                    dir="auto"
                    className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-ee-md px-3.5 py-2 text-[13.5px] leading-[21px] text-white shadow-[0_6px_16px_rgba(0,166,206,0.22)] ${
                        line.state === 'failed' ? 'bg-zinc-400' : 'bg-gradient-to-br from-[#ef4444] to-[#b91c1c]'
                    } ${line.state === 'sending' ? 'opacity-80' : ''}`}
                >
                    {line.audio ? (
                        <span className="flex items-center gap-2">
                            <Mic size={15} />
                            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                            <audio src={line.audio} controls preload="none" className="h-8 max-w-[200px]" />
                        </span>
                    ) : line.text}
                </div>
                {line.transcript && (
                    <p dir="auto" className="mt-1 max-w-[85%] text-[11px] italic text-zinc-500">{copy.heard} {line.transcript}</p>
                )}
                {line.state === 'failed' && (
                    <button type="button" onClick={() => onRetry(line)} className="mt-1 flex items-center gap-1 text-[11px] font-bold text-marine-primary">
                        <AlertCircle size={12} /> {line.error || copy.error} · <RotateCw size={11} /> {copy.retry}
                    </button>
                )}
            </div>
        );
    }

    const teammate = line.author && line.author !== 'agent' && line.author !== 'customer';
    return (
        <div className="rc-chat-msg-in">
            {(hasText || line.image) && (
                <div className="flex items-end gap-2">
                    <span className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-800 to-zinc-950 text-white shadow ring-2 ring-white">
                        <Sparkles size={13} className="text-red-400" />
                    </span>
                    <div className="min-w-0 max-w-[86%]">
                        {hasText && (
                            <div dir="auto" className="inline-block max-w-full break-words rounded-2xl rounded-es-md border border-zinc-100 bg-white px-3.5 py-2 text-[13.5px] leading-[21px] text-zinc-800 shadow-[0_4px_14px_rgba(0,0,0,0.05)]">
                                {teammate && <span className="mb-0.5 block text-[10.5px] font-bold text-emerald-600">Ready Marine</span>}
                                {renderRich(line.text)}
                            </div>
                        )}
                        {line.image && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={line.image} alt="" loading="lazy" className="mt-1.5 max-h-56 rounded-2xl border border-zinc-100 bg-white object-contain" />
                        )}
                    </div>
                </div>
            )}
            {/* Cards and the receipt take the full width of the conversation, not the bubble's column. */}
            <ChatProductCards cards={line.products} language={language} onAdd={onAddCard} onNavigate={onNavigate} />
            {line.order && <ChatOrderCard order={line.order} language={language} signedIn={signedIn} onNavigate={onNavigate} />}
        </div>
    );
}
