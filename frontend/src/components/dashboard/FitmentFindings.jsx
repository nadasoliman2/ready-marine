'use client';

import { useMemo, useState } from 'react';
import { Check, Loader2, EyeOff, Wrench } from 'lucide-react';
import { adminFitmentApi } from '../../lib/api';
import { L } from '../../lib/catalog';
import { SEVERITY, findingText, findingTypeLabel, proposedChanges } from '../../lib/fitmentCheck';

/**
 * What the fitment check found on one product, and the fix it proposes — each change a tick
 * box, the sure ones ticked. "Apply" writes only the ticked changes to the fitment; nothing
 * else on the product moves. "The fitment is right" takes the product off the worklist until
 * its title or fitment changes.
 *
 * @param onChanged  called after an apply or a dismiss, with the server's answer
 */
export default function FitmentFindings({ productId, findings, language, onChanged }) {
    const changes = useMemo(() => findings.flatMap((f) => proposedChanges(f, language).map((c) => ({ ...c, severity: f.severity }))), [findings, language]);
    const [picked, setPicked] = useState(() => Object.fromEntries(changes.map((c) => [c.key, { checked: c.checked, allYears: false }])));
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');

    const toggle = (key, field) => setPicked((prev) => ({ ...prev, [key]: { ...prev[key], [field]: !prev[key]?.[field] } }));
    const chosen = changes.filter((c) => picked[c.key]?.checked);

    const apply = async () => {
        setBusy('apply');
        setError('');
        try {
            const payload = chosen.map((c) => (picked[c.key]?.allYears ? { ...c.change, years: [], all_years: true } : c.change));
            onChanged?.(await adminFitmentApi.apply(productId, payload));
        } catch (err) {
            setError(err.message || L(language, 'Could not update the fitment.', 'تعذر تعديل التوافق.'));
        } finally {
            setBusy('');
        }
    };

    const dismiss = async () => {
        setBusy('dismiss');
        setError('');
        try {
            onChanged?.(await adminFitmentApi.dismiss(productId));
        } catch (err) {
            setError(err.message || L(language, 'That did not work.', 'لم تنجح العملية.'));
        } finally {
            setBusy('');
        }
    };

    return (
        <div className="space-y-2">
            {findings.map((f, i) => (
                <div key={`${f.type}-${i}`} className="flex items-start gap-2 text-xs">
                    <span className={`px-1.5 py-0.5 rounded-full border text-[10px] font-extrabold flex-shrink-0 ${(SEVERITY[f.severity] || SEVERITY.info).cls}`}>
                        {L(language, (SEVERITY[f.severity] || SEVERITY.info).en, (SEVERITY[f.severity] || SEVERITY.info).ar)}
                    </span>
                    <p className="text-zinc-700 dark:text-zinc-200 leading-relaxed">
                        <span className="font-bold">{findingTypeLabel(f.type, language)}: </span>
                        {findingText(f, language)}
                    </p>
                </div>
            ))}

            {changes.length > 0 && (
                <div className="mt-3 rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/[0.02] p-3 space-y-1.5">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1">
                        <Wrench size={11} /> {L(language, 'Proposed fix', 'التصحيح المقترح')}
                    </p>
                    {changes.map((c) => (
                        <div key={c.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <label className="flex items-center gap-2 text-xs font-semibold text-zinc-800 dark:text-zinc-100 cursor-pointer">
                                <input type="checkbox" checked={!!picked[c.key]?.checked} onChange={() => toggle(c.key, 'checked')} className="w-4 h-4 accent-marine-cyan" />
                                {c.label}
                            </label>
                            {c.canAllYears && (
                                <label className="flex items-center gap-1.5 text-[11px] text-zinc-500 cursor-pointer">
                                    <input type="checkbox" checked={!!picked[c.key]?.allYears} onChange={() => toggle(c.key, 'allYears')} className="w-3.5 h-3.5 accent-zinc-500" />
                                    {L(language, 'all years instead', 'كل السنين بدل كده')}
                                </label>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                    type="button"
                    disabled={!!busy}
                    onClick={dismiss}
                    title={L(language, 'Off this list until the title or the fitment changes', 'يختفي من القايمة لحد ما العنوان أو التوافق يتغير')}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-zinc-200 dark:border-white/10 text-zinc-500 hover:border-zinc-400 disabled:opacity-50"
                >
                    {busy === 'dismiss' ? <Loader2 size={13} className="animate-spin" /> : <EyeOff size={13} />}
                    {L(language, 'The fitment is right', 'التوافق صح كده')}
                </button>
                {changes.length > 0 && (
                    <button
                        type="button"
                        disabled={!!busy || !chosen.length}
                        onClick={apply}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-marine-cyan hover:bg-marine-cyan-dark text-white disabled:opacity-50"
                    >
                        {busy === 'apply' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                        {L(language, `Apply ${chosen.length} change${chosen.length === 1 ? '' : 's'}`, `طبّق ${chosen.length} تعديل`)}
                    </button>
                )}
            </div>
        </div>
    );
}
