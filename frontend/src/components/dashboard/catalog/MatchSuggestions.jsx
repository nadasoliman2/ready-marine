'use client';

import { useState } from 'react';
import { ImageOff, Loader2, Store, ChevronDown, ExternalLink } from 'lucide-react';
import Link from '../../LocaleLink';
import { L, entryTitle, entryImage } from '../../../lib/catalog';
import { levelLabel, levelClass, reasonText } from '../../../lib/catalogMatch';

/**
 * The catalog matcher's proposals for one product or suggestion: each entry with how sure the
 * match is and why — "same part number F5969", "same car: Hyundai Verna" — and one button to
 * act on it (link, or merge). "Possible" matches are kept folded away: they are worth a look
 * when nothing better exists, never worth a press without one.
 *
 * @param matches   the proposals, best first; null while they load
 * @param onPick    called with the entry the admin chose
 */
export default function MatchSuggestions({ matches, language, onPick, actionLabel, actionIcon: ActionIcon, busy = false, compact = false, emptyText = null }) {
    const [showWeak, setShowWeak] = useState(false);

    if (matches == null) {
        return (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
                <Loader2 size={13} className="animate-spin" /> {L(language, 'Looking for a match…', 'بندوّر على تطابق…')}
            </div>
        );
    }
    const sure = matches.filter((m) => m.level === 'strong' || m.level === 'likely');
    const weak = matches.filter((m) => m.level !== 'strong' && m.level !== 'likely');
    if (!matches.length) return emptyText ? <p className="text-xs text-zinc-500">{emptyText}</p> : null;

    const shown = showWeak ? [...sure, ...weak] : sure;
    return (
        <div className="space-y-2">
            {shown.map((m) => renderMatch(m, { language, onPick, actionLabel, ActionIcon, busy, compact }))}
            {weak.length > 0 && (
                <button
                    type="button"
                    onClick={() => setShowWeak((v) => !v)}
                    className="flex items-center gap-1 text-[11px] font-bold text-zinc-500 hover:text-marine-primary"
                >
                    <ChevronDown size={12} className={showWeak ? 'rotate-180' : ''} />
                    {showWeak
                        ? L(language, 'Hide weaker matches', 'إخفاء الاحتمالات الأضعف')
                        : L(language, `${weak.length} weaker match${weak.length === 1 ? '' : 'es'}`, `${weak.length} احتمال أضعف`)}
                </button>
            )}
        </div>
    );
}

/** One proposal. A plain function, not a component: it holds no state of its own. */
function renderMatch(m, { language, onPick, actionLabel, ActionIcon, busy, compact }) {
    return (
        <div key={m._id} className="flex items-start gap-2.5 bg-zinc-50 dark:bg-white/[0.02] border border-zinc-200 dark:border-white/5 rounded-lg p-2">
            <div className={`${compact ? 'w-9 h-9' : 'w-11 h-11'} rounded bg-zinc-100 dark:bg-white/5 flex items-center justify-center overflow-hidden flex-shrink-0`}>
                {entryImage(m)
                    ? <img src={entryImage(m)} alt="" className="w-full h-full object-cover" />
                    : <ImageOff size={13} className="text-zinc-400" />}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`px-1.5 py-0.5 rounded-full border text-[10px] font-extrabold ${levelClass(m.level)}`}>
                        {levelLabel(m.level, language)} · {Math.round((m.similarity || 0) * 100)}%
                    </span>
                    {m.status === 'suggested' && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400">
                            {L(language, 'Suggestion', 'اقتراح')}
                        </span>
                    )}
                    <span className="text-[11px] text-zinc-500 flex items-center gap-1"><Store size={10} /> {m.product_count} {L(language, 'products', 'منتج')}</span>
                </div>
                <p className="text-xs font-semibold text-zinc-900 dark:text-white mt-1 line-clamp-2" title={entryTitle(m, language)}>
                    {entryTitle(m, language)}
                </p>
                {m.part_number && <p dir="ltr" className="font-mono text-[10px] text-zinc-400 text-end">{m.part_number}</p>}
                {!compact && (m.reasons || []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                        {m.reasons.map((r) => (
                            <span key={r.key} className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${r.key === 'same_store' ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300'}`}>
                                {reasonText(r, language)}
                            </span>
                        ))}
                    </div>
                )}
            </div>
            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                {onPick && (
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => onPick(m)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 disabled:opacity-50"
                    >
                        {ActionIcon && <ActionIcon size={11} />} {actionLabel}
                    </button>
                )}
                <Link href={`/admin/dashboard/catalog/${m._id}`} target="_blank" className="flex items-center gap-1 text-[10px] font-bold text-zinc-400 hover:text-marine-primary">
                    {L(language, 'Open', 'فتح')} <ExternalLink size={10} />
                </Link>
            </div>
        </div>
    );
}
