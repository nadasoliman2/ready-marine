'use client';

import { X, Plus } from 'lucide-react';
import { L } from '../../../lib/catalog';
import CatalogSearchResults from './CatalogSearchResults';
import Overlay from '../../Overlay';

/**
 * Pick one entry and close — the "Change" action on the Excel review screen,
 * where the vendor is correcting a single row's proposed match rather than
 * collecting products.
 */
export default function CatalogSinglePickerModal({ language, title, onPick, onNewProduct, onClose, searchFn = null, facetsFn = null }) {
    return (
        <Overlay className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onMouseDown={onClose}>
            <div
                className="w-full max-w-2xl max-h-[88vh] flex flex-col bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-zinc-100 dark:border-white/5">
                    <h3 className="font-bold text-zinc-900 dark:text-white">
                        {title || L(language, 'Which product is this row?', 'ما هو منتج هذا الصف؟')}
                    </h3>
                    <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5">
                        <X size={18} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4">
                    <CatalogSearchResults
                        language={language}
                        searchFn={searchFn}
                        facetsFn={facetsFn}
                        onSelect={(entry) => { onPick(entry); onClose(); }}
                        // A row already belongs to this vendor's upload, so "you
                        // already have a product on this" is not a dead end here —
                        // picking it is still how they say what the row is.
                        onOpenExisting={(entry) => { onPick(entry); onClose(); }}
                        onNewProduct={() => { onNewProduct?.(); onClose(); }}
                    />
                </div>

                {onNewProduct && (
                    <div className="px-5 py-4 border-t border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
                        <button
                            type="button"
                            onClick={() => { onNewProduct(); onClose(); }}
                            className="w-full flex items-center justify-center gap-2 border border-dashed border-zinc-300 dark:border-white/20 hover:border-marine-cyan hover:text-marine-primary text-zinc-700 dark:text-zinc-200 px-4 py-2.5 rounded-xl text-sm font-bold transition-colors"
                        >
                            <Plus size={15} /> {L(language, "It's a new product", 'إنه منتج جديد')}
                        </button>
                    </div>
                )}
            </div>
        </Overlay>
    );
}
