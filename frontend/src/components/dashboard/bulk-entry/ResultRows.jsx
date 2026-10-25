'use client';

import { useState } from 'react';
import {
    CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronUp, ExternalLink,
} from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { L } from './bulkEntryUtils';
import { localizeBulkError } from '../../../lib/dashboardLocalization';

export function SuccessRow({ item }) {
    return (
        <div className="flex items-center gap-3 px-4 py-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
            <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
                <span className="font-semibold text-emerald-600 dark:text-emerald-300 text-sm">#{item.row}</span>
                <span className="text-zinc-600 dark:text-zinc-300 text-sm mx-2 truncate">{item.title || item.sku}</span>
            </div>
            <span className="text-xs text-zinc-500 font-mono truncate max-w-[180px]">{String(item._id)}</span>
        </div>
    );
}

export function FailedRow({ item, editBase }) {
    const { language } = useApp();
    const [open, setOpen] = useState(false);
    return (
        <div className="border border-red-500/30 rounded-lg overflow-hidden">
            <button
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center gap-3 px-4 py-3 bg-red-500/10 hover:bg-red-500/15 transition-colors text-start"
            >
                <XCircle size={18} className="text-red-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                    <span className="font-semibold text-red-500 dark:text-red-300 text-sm">#{item.row}</span>
                    {item.sku && <span className="text-zinc-500 dark:text-zinc-400 text-sm mx-2">SKU: {item.sku}</span>}
                    {item.title && <span className="text-zinc-500 dark:text-zinc-400 text-sm mx-2 truncate">— {item.title}</span>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    {item.savedAsDraft && (
                        <span className="flex items-center gap-1 text-xs font-semibold bg-amber-500/20 text-amber-500 dark:text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full">
                            <AlertTriangle size={11} /> {L(language, 'Draft Saved', 'حُفظت كمسودة')}
                        </span>
                    )}
                    <span className="text-xs text-zinc-500">{item.errors.length}</span>
                    {open ? <ChevronUp size={16} className="text-zinc-400" /> : <ChevronDown size={16} className="text-zinc-400" />}
                </div>
            </button>

            {open && (
                <div className="px-4 py-3 bg-zinc-50 dark:bg-[#0E1012] space-y-2">
                    {item.errors.map((err, i) => {
                        const localizedError = localizeBulkError(err, language);
                        return (
                        <div key={i} className="flex gap-2 text-sm">
                            <span className="font-mono text-xs bg-red-500/20 text-red-500 dark:text-red-300 px-1.5 py-0.5 rounded flex-shrink-0">{localizedError.field}</span>
                            <span className="text-zinc-600 dark:text-zinc-300">{localizedError.message}</span>
                        </div>
                    )})}
                    {item.savedAsDraft && item.draftId && editBase && (
                        <a
                            href={`${editBase}/${item.draftId}/edit`}
                            className="mt-2 inline-flex items-center gap-1.5 text-xs text-amber-500 hover:text-amber-400 font-medium transition-colors"
                        >
                            <ExternalLink size={13} /> {L(language, 'Complete this draft manually', 'أكمل هذه المسودة يدوياً')}
                        </a>
                    )}
                </div>
            )}
        </div>
    );
}

export default function ResultsPanel({ result, editBase, onReset }) {
    const { language } = useApp();
    if (!result) return null;
    const succeeded = result.succeeded || [];
    const failed = result.failed || [];
    const total = succeeded.length + failed.length;

    return (
        <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5 space-y-5 mt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-4">
                    <h2 className="font-bold text-zinc-900 dark:text-white">{L(language, 'Results', 'النتائج')}</h2>
                    <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-500">
                            <CheckCircle2 size={16} /> {succeeded.length} {L(language, 'created', 'تم إنشاؤها')}
                        </span>
                        <span className="text-zinc-400">·</span>
                        <span className="flex items-center gap-1.5 text-sm font-semibold text-red-500">
                            <XCircle size={16} /> {failed.length} {L(language, 'failed', 'فشلت')}
                        </span>
                        <span className="text-xs text-zinc-500">{L(language, 'of', 'من')} {total}</span>
                    </div>
                </div>
                {onReset && (
                    <button onClick={onReset} className="text-xs font-semibold text-zinc-500 hover:text-marine-primary">
                        {L(language, 'Dismiss', 'إغلاق')}
                    </button>
                )}
            </div>

            {succeeded.length > 0 && (
                <div className="space-y-2">
                    <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{L(language, 'Created', 'تم الإنشاء')}</p>
                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {succeeded.map((item) => <SuccessRow key={String(item._id)} item={item} />)}
                    </div>
                </div>
            )}

            {failed.length > 0 && (
                <div className="space-y-2">
                    <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{L(language, 'Failed (kept in the grid to fix)', 'الفاشلة (تبقى في الجدول للإصلاح)')}</p>
                    <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                        {failed.map((item, i) => <FailedRow key={`${item.row}-${i}`} item={item} editBase={editBase} />)}
                    </div>
                </div>
            )}
        </div>
    );
}
