'use client';

import { useState } from 'react';
import {
    ImageOff, Loader2, Check, GitMerge, Ban, Pencil, X, ChevronRight,
} from 'lucide-react';
import { L, entryTitle, entryImage, entryCategoryName, entryBrandName } from '../../../lib/catalog';
import CatalogEntryForm, { entryToFormState, formStateToPayload } from './CatalogEntryForm';
import MatchSuggestions from './MatchSuggestions';

/**
 * One suggestion, with everything the decision needs on screen at once: the
 * vendor's data on the left and the entries it might duplicate on the right —
 * the catalog matcher's candidates, each with how sure it is, why (same part
 * number, same car, same maker …) and its vendor count.
 *
 * Both outcomes leave the vendor's product completely untouched. Merging moves
 * the link and nothing else; approving adds the entry to the catalog and the
 * originating product simply stays attached to it.
 */
/**
 * @param similar  the entries it may duplicate, fetched by the page for all its cards in one
 *                 request; null while they load
 */
export default function SuggestionReviewCard({ entry, similar = null, language, onApprove, onMerge, onReject, metadata }) {
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState(() => entryToFormState(entry));
    const [busy, setBusy] = useState(false);

    const run = async (fn) => {
        setBusy(true);
        try { await fn(); } finally { setBusy(false); }
    };

    const vendorName = entry.created_by_vendor_id?.store_name
        || entry.created_by_vendor_id?.store_username
        || L(language, 'a vendor', 'أحد التجار');

    return (
        <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden">
            <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x rtl:lg:divide-x-reverse divide-zinc-100 dark:divide-white/5">

                {/* The suggestion itself */}
                <div className="p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-2">
                        {L(language, 'Suggested by', 'اقترحه')} {vendorName}
                    </p>
                    <div className="flex items-start gap-3">
                        <div className="w-16 h-16 rounded-lg bg-zinc-100 dark:bg-white/5 flex items-center justify-center overflow-hidden flex-shrink-0">
                            {entryImage(entry)
                                ? <img src={entryImage(entry)} alt="" className="w-full h-full object-cover" />
                                : <ImageOff size={18} className="text-zinc-400" />}
                        </div>
                        <div className="min-w-0">
                            <p className="font-bold text-sm text-zinc-900 dark:text-white">{entryTitle(entry, language)}</p>
                            <p className="text-xs text-zinc-500 mt-0.5">
                                {[entryCategoryName(entry, language), entryBrandName(entry), entry.part_number].filter(Boolean).join(' · ')}
                            </p>
                            {(entry.description_en || entry.description_ar) && (
                                <p className="text-xs text-zinc-500 mt-2 line-clamp-3">
                                    {language === 'ar' ? (entry.description_ar || entry.description_en) : (entry.description_en || entry.description_ar)}
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Entries it might be a duplicate of */}
                <div className="p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
                        {L(language, 'Similar entries', 'بطاقات مشابهة')}
                    </p>
                    <MatchSuggestions
                        matches={similar}
                        language={language}
                        busy={busy}
                        actionLabel={L(language, 'Merge into this', 'دمج في هذه')}
                        actionIcon={GitMerge}
                        onPick={(candidate) => run(() => onMerge(candidate._id))}
                        emptyText={L(language, 'Nothing similar found — this looks like a genuinely new product.', 'لم نجد ما يشبهه — يبدو منتجاً جديداً فعلاً.')}
                    />
                </div>
            </div>

            {/* Edit-before-approve. The vendor's product is not affected either way. */}
            {editing && (
                <div className="border-t border-zinc-100 dark:border-white/5 p-4 bg-zinc-50 dark:bg-white/[0.02]">
                    <CatalogEntryForm form={form} setForm={setForm} metadata={metadata} language={language} />
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => setEditing((o) => !o)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan hover:text-marine-primary disabled:opacity-50"
                >
                    {editing ? <X size={13} /> : <Pencil size={13} />}
                    {editing ? L(language, 'Cancel edits', 'إلغاء التعديلات') : L(language, 'Edit before approving', 'تعديل قبل الموافقة')}
                </button>
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                        if (!window.confirm(L(language, 'Reject this suggestion? It will not be offered again.', 'رفض الاقتراح؟ مش هيظهر تاني.'))) return;
                        run(() => onReject());
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-red-500 hover:text-red-600 disabled:opacity-50"
                >
                    <Ban size={13} /> {L(language, 'Reject', 'رفض')}
                </button>
                <div className="flex-1" />
                {entry.source_product_id && (
                    <a
                        href={`/admin/dashboard/products/${entry.source_product_id}`}
                        className="flex items-center gap-1 text-xs font-semibold text-zinc-500 hover:text-marine-primary"
                    >
                        {L(language, 'View the product it came from', 'عرض المنتج الذي جاء منه')} <ChevronRight size={12} className="rtl:rotate-180" />
                    </a>
                )}
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => onApprove(editing ? formStateToPayload(form) : null))}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-marine-cyan hover:bg-marine-cyan-dark text-white disabled:opacity-50"
                >
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                    {L(language, 'Approve as new entry', 'الموافقة كبطاقة جديدة')}
                </button>
            </div>
        </div>
    );
}
