'use client';

import { useMemo, useState } from 'react';
import {
    ArrowRight, Check, Plus, Loader2, Search, ImageOff, Clock, AlertCircle,
} from 'lucide-react';
import { L, entryTitle } from '../../../lib/catalog';
import CatalogSinglePickerModal from './CatalogSinglePickerModal';
import { partTypeLabel } from '../../../lib/partType';

const PAGE_SIZE = 50;

/**
 * "Review links" — the screen between an Excel upload and the save.
 *
 * The template gained no new column and the vendor did no extra work in the
 * file: the server proposes an entry per row from part number, brand and title,
 * and this screen is where those proposals become decisions. Nothing is ever
 * auto-linked, because a wrong link that passes unnoticed is precisely the
 * failure this screen exists to prevent.
 *
 * Rows also gain whatever the catalog knows and the file did not — that happens
 * server-side on save, which is why a file of nothing but SKU, price and stock
 * can still pass validation.
 */
export default function ReviewLinksPanel({ language, preview, onCancel, onSave, saving }) {
    const isAr = language === 'ar';
    const [decisions, setDecisions] = useState(() => (preview.rows || []).map((row) => ({
        // A proposal starts accepted — the vendor's job is to spot the wrong one,
        // not to re-tick 38 correct ones.
        mode: row.match ? 'linked' : 'new',
        entryId: row.match?.entry_id || null,
        label: row.match?.title || '',
        image: row.match?.image || null,
        status: row.match?.status || null,
        touched: false,
    })));
    const [picking, setPicking] = useState(null); // row index
    const [visible, setVisible] = useState(PAGE_SIZE);

    const rows = preview.rows || [];

    const counts = useMemo(() => ({
        total: rows.length,
        linked: decisions.filter((d) => d.mode === 'linked').length,
        needsYou: decisions.filter((d) => d.mode === 'new' && !d.touched).length,
    }), [rows, decisions]);

    const setDecision = (index, patch) => setDecisions((prev) => prev.map((d, i) => (
        i === index ? { ...d, ...patch, touched: true } : d
    )));

    const handleSave = () => {
        // Row order is preserved end to end so the server's 1-based row numbers
        // still point at the vendor's original spreadsheet rows.
        onSave(rows.map((row, i) => ({
            ...row.data,
            catalog_entry_id: decisions[i].mode === 'linked' ? decisions[i].entryId : null,
        })));
    };

    return (
        <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="font-bold text-zinc-900 dark:text-white">{L(language, 'Review links', 'مراجعة الربط')}</h2>
                    <p className="text-xs text-zinc-500 mt-0.5 max-w-lg">
                        {L(language,
                            'We matched each row to a product in the catalog. Anything the row left blank is filled in from the match when you save.',
                            'طابقنا كل صف مع منتج في الكتالوج. أي حقل تركته فارغاً في الصف سيُملأ من المنتج المطابق عند الحفظ.')}
                    </p>
                </div>
                <div className="flex items-center gap-2 text-sm">
                    <span className="font-semibold text-zinc-700 dark:text-zinc-200 tabular-nums">
                        {counts.total} {L(language, 'rows', 'صف')}
                    </span>
                    <span className="text-zinc-400">·</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {counts.linked} {L(language, 'matched', 'مطابق')}
                    </span>
                    <span className="text-zinc-400">·</span>
                    <span className="font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                        {counts.needsYou} {L(language, 'need you', 'بحاجة إليك')}
                    </span>
                </div>
            </div>

            <div className="space-y-2 max-h-[520px] overflow-y-auto pe-1">
                {rows.slice(0, visible).map((row, index) => {
                    const decision = decisions[index];
                    const linked = decision.mode === 'linked';
                    return (
                        <div
                            key={row.row}
                            className={`rounded-xl border px-3 py-3 ${linked
                                ? 'border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0E1012]'
                                : 'border-amber-200 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/[0.06]'
                                }`}
                        >
                            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                                {/* What the vendor wrote */}
                                <div className="flex-1 min-w-0">
                                    <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                                        {L(language, 'Row', 'الصف')} {row.row}
                                    </p>
                                    <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
                                        {row.summary.title || <span className="text-zinc-400">{L(language, '(no title in the file)', '(لا يوجد عنوان في الملف)')}</span>}
                                    </p>
                                    <p className="text-xs text-zinc-500 truncate">
                                        {[row.summary.sku, row.summary.part_number].filter(Boolean).join(' · ')}
                                    </p>
                                    {/* Required, and only in the sheet — the catalog cannot fill it. Said here, before saving. */}
                                    {row.summary.part_type
                                        ? <p className="text-[11px] text-zinc-500 mt-0.5">{L(language, 'Part type', 'نوع القطعة')}: <span className="font-bold">{partTypeLabel(row.summary.part_type, language === 'ar')}</span></p>
                                        : <p className="text-[11px] font-bold text-red-500 mt-0.5">{L(language, 'No part type — this row will not be imported. Fill the Part Type column (the last one) and upload again.', 'نوع القطعة ناقص — الصف ده مش هيترفع. املا عمود "نوع القطعة" (آخر عمود) وارفع الشيت تاني.')}</p>}
                                </div>

                                <ArrowRight size={16} className="hidden lg:block text-zinc-300 dark:text-zinc-600 flex-shrink-0 rtl:rotate-180" />

                                {/* The proposed entry */}
                                <div className="flex-1 min-w-0 flex items-center gap-2">
                                    {linked ? (
                                        <>
                                            <div className="w-9 h-9 rounded-lg bg-zinc-100 dark:bg-white/5 flex items-center justify-center overflow-hidden flex-shrink-0">
                                                {decision.image
                                                    ? <img src={decision.image} alt="" className="w-full h-full object-cover" />
                                                    : <ImageOff size={14} className="text-zinc-400" />}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{decision.label}</p>
                                                {decision.status === 'suggested' && (
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-amber-600 dark:text-amber-400">
                                                        <Clock size={9} /> {L(language, 'Under review', 'قيد المراجعة')}
                                                    </span>
                                                )}
                                            </div>
                                        </>
                                    ) : (
                                        <p className="text-sm font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                                            <Plus size={14} /> {L(language, 'Will be added as a new product', 'ستتم إضافته كمنتج جديد')}
                                        </p>
                                    )}
                                </div>

                                {/* The decision */}
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => setPicking(index)}
                                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan hover:text-marine-primary"
                                    >
                                        <Search size={12} /> {L(language, 'Change', 'تغيير')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setDecision(index, { mode: 'new', entryId: null, label: '', image: null, status: null })}
                                        disabled={!linked}
                                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan hover:text-marine-primary disabled:opacity-40 disabled:hover:border-zinc-200 disabled:hover:text-zinc-600"
                                    >
                                        <Plus size={12} /> {L(language, 'New product', 'منتج جديد')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setDecision(index, {})}
                                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold ${decision.touched
                                            ? 'bg-emerald-600 text-white'
                                            : 'bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-300 hover:bg-emerald-600 hover:text-white'
                                            }`}
                                    >
                                        <Check size={12} /> {L(language, 'Confirm', 'تأكيد')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* No silent truncation: the vendor is told the list is partial. */}
            {visible < rows.length && (
                <button
                    type="button"
                    onClick={() => setVisible((v) => v + PAGE_SIZE)}
                    className="w-full border border-zinc-200 dark:border-white/10 hover:border-marine-cyan/60 text-zinc-500 dark:text-zinc-400 hover:text-marine-primary py-2.5 rounded-xl text-sm font-semibold transition-colors"
                >
                    {L(language,
                        `Showing ${visible} of ${rows.length} — show ${Math.min(PAGE_SIZE, rows.length - visible)} more`,
                        `يتم عرض ${visible} من ${rows.length} — عرض ${Math.min(PAGE_SIZE, rows.length - visible)} إضافية`)}
                </button>
            )}

            {counts.needsYou > 0 && (
                <p className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                    <AlertCircle size={14} />
                    {L(language,
                        `${counts.needsYou} row(s) had no match. Saving now adds them as new products.`,
                        `${counts.needsYou} صف بلا مطابقة. الحفظ الآن يضيفها كمنتجات جديدة.`)}
                </p>
            )}

            <div className="flex items-center justify-end gap-3 pt-1">
                <button
                    type="button"
                    onClick={onCancel}
                    disabled={saving}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-zinc-400 disabled:opacity-50"
                >
                    {L(language, 'Cancel', 'إلغاء')}
                </button>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold bg-marine-cyan hover:bg-marine-cyan-dark text-white disabled:opacity-50"
                >
                    {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                    {L(language, 'Approve all and save', 'اعتماد الكل والحفظ')}
                </button>
            </div>

            {picking !== null && (
                <CatalogSinglePickerModal
                    language={language}
                    title={isAr
                        ? `الصف ${rows[picking].row}: ${rows[picking].summary.title || rows[picking].summary.sku}`
                        : `Row ${rows[picking].row}: ${rows[picking].summary.title || rows[picking].summary.sku}`}
                    onPick={(entry) => setDecision(picking, {
                        mode: 'linked',
                        entryId: String(entry._id),
                        label: entryTitle(entry, language),
                        image: (entry.images || [])[0]?.url || null,
                        status: entry.status,
                    })}
                    onNewProduct={() => setDecision(picking, { mode: 'new', entryId: null, label: '', image: null, status: null })}
                    onClose={() => setPicking(null)}
                />
            )}
        </div>
    );
}
