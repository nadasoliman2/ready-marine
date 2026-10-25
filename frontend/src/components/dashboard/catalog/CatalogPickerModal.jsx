'use client';

import { useState } from 'react';
import { X, Plus, Loader2 } from 'lucide-react';
import { catalogApi } from '../../../lib/api';
import { L, entryTitle } from '../../../lib/catalog';
import CatalogSearchResults from './CatalogSearchResults';
import Overlay from '../../Overlay';

/**
 * The catalog picker that "Add row" opens in the bulk grid.
 *
 * A popup rather than a column in the grid, because a column would simply be
 * ignored — the vendor has to be interrupted and walked past the catalog. And
 * multi-select rather than one-at-a-time, because a vendor adding 20 products
 * must not open and close this 20 times: selections survive across searches and
 * the footer counts them.
 */
export default function CatalogPickerModal({ language, onAdd, onNewRow, onClose, roomLeft = Infinity }) {
    // Map<id, entry> — ordered, so the rows land in the order they were ticked.
    const [picked, setPicked] = useState(new Map());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const toggle = (entry) => {
        const id = String(entry._id);
        setPicked((prev) => {
            const next = new Map(prev);
            if (next.has(id)) next.delete(id);
            else if (next.size < roomLeft) next.set(id, entry);
            return next;
        });
    };

    const handleAdd = async () => {
        if (picked.size === 0) return;
        setLoading(true);
        setError('');
        try {
            // Result cards carry only what a card needs; the grid rows need the
            // description, compatibility and variation types too.
            const full = await Promise.all(
                [...picked.keys()].map((id) => catalogApi.getEntry(id).then((r) => r.entry)),
            );
            onAdd(full.filter(Boolean));
            onClose();
        } catch (err) {
            setError(L(language, 'Could not load the selected products. Try again.', 'تعذر تحميل المنتجات المحددة. حاول مرة أخرى.'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <Overlay className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onMouseDown={onClose}>
            <div
                className="w-full max-w-2xl max-h-[88vh] flex flex-col bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-zinc-100 dark:border-white/5">
                    <div>
                        <h3 className="font-bold text-zinc-900 dark:text-white">
                            {L(language, 'Pick the products you are adding', 'اختر المنتجات التي تضيفها')}
                        </h3>
                        <p className="text-xs text-zinc-500 mt-0.5">
                            {L(language,
                                'Each one becomes a pre-filled row — you only enter price and stock.',
                                'كل منتج يصبح صفاً مملوءاً مسبقاً — تدخل السعر والكمية فقط.')}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5">
                        <X size={18} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4">
                    <CatalogSearchResults
                        language={language}
                        multiSelect
                        selectedIds={new Set(picked.keys())}
                        onSelect={toggle}
                        onNewProduct={() => { onNewRow(); onClose(); }}
                    />
                    {picked.size > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2">
                            {[...picked.values()].map((entry) => (
                                <span key={entry._id} className="flex items-center gap-1.5 bg-red-50 dark:bg-marine-cyan/10 text-marine-primary text-xs font-semibold px-2.5 py-1.5 rounded-lg">
                                    {entryTitle(entry, language)}
                                    <button onClick={() => toggle(entry)} className="hover:opacity-70"><X size={12} /></button>
                                </span>
                            ))}
                        </div>
                    )}
                    {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
                </div>

                {/* Footer: the escape hatch and the counter, side by side — the same
                    two choices the standalone search gate offers. */}
                <div className="flex items-center gap-3 px-5 py-4 border-t border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
                    <button
                        type="button"
                        onClick={() => { onNewRow(); onClose(); }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border border-dashed border-zinc-300 dark:border-white/20 text-zinc-700 dark:text-zinc-200 hover:border-marine-cyan hover:text-marine-primary transition-colors"
                    >
                        <Plus size={15} /> {L(language, 'New product', 'منتج جديد')}
                    </button>
                    <div className="flex-1" />
                    <span className="text-xs text-zinc-500 tabular-nums">
                        {picked.size} {L(language, 'selected', 'محدد')}
                    </span>
                    <button
                        type="button"
                        onClick={handleAdd}
                        disabled={picked.size === 0 || loading}
                        className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold bg-marine-cyan hover:bg-marine-cyan-dark text-white disabled:opacity-50"
                    >
                        {loading ? <Loader2 size={15} className="animate-spin" /> : null}
                        {L(language, 'Add to grid', 'إضافة للجدول')}
                    </button>
                </div>
            </div>
        </Overlay>
    );
}
