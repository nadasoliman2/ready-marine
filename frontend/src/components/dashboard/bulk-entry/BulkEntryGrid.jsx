'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Plus, Copy, Trash2, Loader2, Upload, ChevronDown, Layers, Car, Truck,
    Image as ImageIcon, FileText, AlertCircle, CheckCircle2, Wand2,
} from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { brandsForCategory, indexCategoryTree } from '../../../lib/brandCategoryLink';
import { shippingApi } from '../../../lib/api';
import { PART_TYPES } from '../../../lib/partType';
import {
    L, blankRow, cloneRow, rowFromCatalogEntry, buildCategoryIndex, isRowEmpty, validateRow,
    buildSubmittable, rowToPayload,
} from './bulkEntryUtils';
import CatalogPickerModal from '../catalog/CatalogPickerModal';
import {
    CategoryModal, ContentModal, ImagesModal, CompatibilityModal, VariationsModal, ShippingModal, Modal,
} from './FieldModals';
import ResultsPanel from './ResultRows';
import SearchableSelect from '../../SearchableSelect';
import { brandOptions } from '../../../lib/pickerOptions';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
const MAX_ROWS = 200;
const DEFAULT_ROW_COUNT = 10;

const defaultRows = () => Array.from({ length: DEFAULT_ROW_COUNT }, () => blankRow());

const ci = 'w-full bg-transparent px-2 py-2 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:bg-red-50 dark:focus:bg-marine-cyan/10 rounded';

/* ── small inline editors ─────────────────────────────────────── */
function Req() { return <span className="text-red-500">*</span>; }

function Th({ children, w, req }) {
    return (
        <th style={{ minWidth: w }} className="px-2 py-2 text-start text-[11px] font-bold uppercase tracking-wider text-zinc-500 whitespace-nowrap border-b border-zinc-200 dark:border-white/10">
            {children}{req ? <> <Req /></> : null}
        </th>
    );
}

function GroupTh({ children, span, color }) {
    return (
        <th colSpan={span} className={`px-2 py-1 text-start text-[10px] font-extrabold uppercase tracking-wider text-white whitespace-nowrap ${color}`}>
            {children}
        </th>
    );
}

function Toggle({ checked, onChange, pink, amber }) {
    const onColor = pink ? 'bg-pink-500' : amber ? 'bg-amber-500' : 'bg-marine-cyan';
    return (
        <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" className="sr-only peer" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
            <div className={`w-9 h-5 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all ${checked ? onColor : 'bg-zinc-300 dark:bg-white/10'}`} />
        </label>
    );
}

function Chip({ label, placeholder, invalid, onClick, disabled }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={label || placeholder}
            className={`w-full text-start truncate px-2 py-2 text-sm rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${label ? 'text-zinc-900 dark:text-white' : 'text-zinc-400'} ${invalid ? 'ring-1 ring-red-400/70 bg-red-50 dark:bg-red-500/10' : 'hover:bg-zinc-100 dark:hover:bg-white/5'}`}
        >
            {label || placeholder}
        </button>
    );
}

/* ── chip summaries ───────────────────────────────────────────── */
function summaries(row, refs, language) {
    const cat = row.category_id ? (refs.pathLabel.get(String(row.category_id)) || L(language, 'Selected', 'محدد')) : '';
    const cars = row.compatible_cars || [];
    let compat = '';
    if (row.is_universal) compat = L(language, 'Universal', 'عام');
    else if (cars.length) {
        const names = cars.map((c) => refs.carBrandMap.get(String(c.brand_id))?.name || L(language, 'Car', 'سيارة'));
        compat = names.slice(0, 2).join(', ') + (names.length > 2 ? ` +${names.length - 2}` : '');
    }
    const vt = row.variation_types || [];
    const variations = vt.length ? `${vt.length} ${L(language, 'types', 'أنواع')} · ${(row.variants || []).length} ${L(language, 'variants', 'تنويعات')}` : '';
    const shipParts = [];
    if (str(row.weight)) shipParts.push(`${row.weight} ${L(language, 'kg', 'كجم')}`);
    if (row.shipping_class_id) shipParts.push(refs.shipMap.get(String(row.shipping_class_id)) || L(language, 'Class', 'فئة'));
    const shipping = shipParts.join(' · ');
    const images = (row.images || []).length ? `${(row.images || []).length} ${L(language, 'img', 'صورة')}` : '';
    const enSet = str(row.subtitle_en) && str(row.description_en);
    const arSet = str(row.subtitle_ar) && str(row.description_ar);
    const content = [
        enSet ? L(language, 'English ✓', 'الإنجليزية ✓') : '',
        arSet ? L(language, 'Arabic ✓', 'العربية ✓') : '',
    ].filter(Boolean).join(' · ');
    return { cat, compat, variations, shipping, images, content };
}
function str(v) { return v === null || v === undefined ? '' : String(v).trim(); }

/* ── one row ──────────────────────────────────────────────────── */
function Row({ row, idx, refs, language, selected, onSelect, onChange, onDuplicate, onDelete, openModal }) {
    const errors = useMemo(() => (isRowEmpty(row) ? [] : validateRow(row, refs)), [row, refs]);
    const errFields = new Set(errors.map((e) => e.field));
    const empty = isRowEmpty(row);
    const dot = empty ? 'bg-zinc-300 dark:bg-zinc-600' : (errors.length === 0 ? 'bg-emerald-500' : 'bg-amber-500');
    const dotTitle = empty ? L(language, 'Empty', 'فارغ') : (errors.length === 0 ? L(language, 'Ready', 'جاهز') : errors.map((e) => '• ' + e.message).join('\n'));
    const s = summaries(row, refs, language);
    const set = (patch) => onChange(row._id, patch);
    const td = 'border-b border-zinc-100 dark:border-white/5 align-middle';

    return (
        <tr className={`${selected ? 'bg-red-50/40 dark:bg-marine-cyan/5' : ''} ${row._serverErrors ? 'bg-red-50/60 dark:bg-red-500/[0.06]' : ''}`}>
            {/* pin (not frozen — scrolls with the table in LTR & RTL) */}
            <td className={`${td} px-2`}>
                <div className="flex items-center gap-1.5">
                    <input type="checkbox" checked={selected} onChange={(e) => onSelect(row._id, e.target.checked)} className="rounded text-marine-primary focus:ring-marine-cyan" />
                    <span className={`w-2.5 h-2.5 rounded-full ${dot}`} title={dotTitle} />
                    <span className="text-[11px] text-zinc-400 w-5 tabular-nums">{idx + 1}</span>
                    <button onClick={() => onDuplicate(row._id)} title={L(language, 'Duplicate', 'تكرار')} className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-white"><Copy size={13} /></button>
                    <button onClick={() => onDelete(row._id)} title={L(language, 'Delete', 'حذف')} className="p-1 text-zinc-400 hover:text-red-500"><Trash2 size={13} /></button>
                </div>
            </td>
            {/* SKU */}
            <td className={td}><input className={`${ci} ${errFields.has('SKU') ? 'ring-1 ring-red-400/70 rounded' : ''}`} value={row.sku} onChange={(e) => set({ sku: e.target.value })} placeholder="SKU" /></td>
            {/* Part type — required */}
            <td className={td}>
                <select className={`${ci} ${errFields.has('Part Type') ? 'ring-1 ring-red-400/70 rounded' : ''}`} value={row.part_type || ''} onChange={(e) => set({ part_type: e.target.value })}>
                    <option value="">{L(language, '— Choose —', '— اختار —')}</option>
                    {PART_TYPES.map((t) => <option key={t.value} value={t.value}>{language === 'ar' ? t.ar : t.en}</option>)}
                </select>
            </td>
            {/* Part # */}
            <td className={td}><input className={ci} value={row.part_number} onChange={(e) => set({ part_number: e.target.value })} placeholder={L(language, 'Part #', 'رقم القطعة')} /></td>
            {/* GTIN */}
            <td className={td}><input className={ci} value={row.gtin} onChange={(e) => set({ gtin: e.target.value })} placeholder="GTIN" /></td>
            {/* Titles */}
            <td className={td}><input className={ci} value={row.title_en} onChange={(e) => set({ title_en: e.target.value })} placeholder={L(language, 'Title EN', 'العنوان إنجليزي')} /></td>
            <td className={td}><input dir="rtl" className={ci} value={row.title_ar} onChange={(e) => set({ title_ar: e.target.value })} placeholder={L(language, 'Title AR', 'العنوان عربي')} /></td>
            {/* Content */}
            <td className={td}><Chip label={s.content} placeholder={L(language, '+ Content', '+ المحتوى')} invalid={errFields.has('Content')} onClick={() => openModal('content', row._id)} /></td>
            {/* Price / Discount */}
            <td className={td}><input type="number" min="0" step="0.01" className={`${ci} ${errFields.has('Price') ? 'ring-1 ring-red-400/70 rounded' : ''}`} value={row.price} onChange={(e) => set({ price: e.target.value })} placeholder="0.00" /></td>
            <td className={td}>
                <select className={`${ci} ${errFields.has('Discount') ? 'ring-1 ring-red-400/70 rounded' : ''}`} value={row.discount_type || ''}
                    onChange={(e) => set({ discount_type: e.target.value, discount_value: e.target.value ? row.discount_value : '' })}>
                    <option value="">{L(language, 'None', 'بدون')}</option>
                    <option value="fixed">{L(language, 'Fixed', 'مبلغ ثابت')}</option>
                    <option value="percentage">{L(language, 'Percent %', 'نسبة %')}</option>
                </select>
            </td>
            <td className={td}><input type="number" min="0" step="0.01" disabled={!row.discount_type} className={`${ci} disabled:opacity-40 ${errFields.has('Discount') ? 'ring-1 ring-red-400/70 rounded' : ''}`} value={row.discount_value} onChange={(e) => set({ discount_value: e.target.value })} placeholder={row.discount_type === 'percentage' ? '%' : '—'} /></td>
            {/* Category */}
            <td className={td}><Chip label={s.cat} placeholder={L(language, '+ Category', '+ الفئة')} invalid={errFields.has('Category')} onClick={() => openModal('category', row._id)} /></td>
            {/* Brand */}
            <td className={td}>
                <SearchableSelect value={row.product_brand_id || ''} onChange={(v) => set({ product_brand_id: v })} options={brandOptions(brandsForCategory(refs.metadata?.productBrands || [], row.category_id, refs.categoryIndex))} placeholder={L(language, 'Brand', 'الماركة')} isAr={language === 'ar'} buttonClassName={`${ci} pe-7`} />
            </td>
            {/* Fitment — universal toggle with the compatibility editor beside it */}
            <td className={td}>
                <div className="flex items-center gap-2 px-2">
                    <Toggle checked={row.is_universal} onChange={(v) => {
                        if (v) set({ is_universal: true, compatible_cars: [] });
                        else { set({ is_universal: false }); openModal('compatibility', row._id); }
                    }} />
                    {row.is_universal
                        ? <span className="text-xs text-zinc-400 whitespace-nowrap">{L(language, 'Universal', 'عام')}</span>
                        : <button type="button" onClick={() => openModal('compatibility', row._id)} title={s.compat || ''}
                            className={`flex-1 min-w-0 truncate text-start text-sm px-2 py-1 rounded ${s.compat ? 'text-zinc-900 dark:text-white' : 'text-zinc-400'} ${errFields.has('Compatibility') ? 'ring-1 ring-red-400/70 bg-red-50 dark:bg-red-500/10' : 'hover:bg-zinc-100 dark:hover:bg-white/5'}`}>
                            {s.compat || L(language, '+ Add cars', '+ أضف سيارات')}
                        </button>}
                </div>
            </td>
            {/* Stock mgmt */}
            <td className={`${td} text-center`}><Toggle checked={row.stock_management} onChange={(v) => set({ stock_management: v })} /></td>
            {/* Qty */}
            <td className={td}>
                {(row.variants || []).length > 0
                    ? <span className="text-[11px] text-zinc-400 px-2">{L(language, 'per variant', 'حسب التنويع')}</span>
                    : <input type="number" min="0" disabled={!row.stock_management} className={`${ci} disabled:opacity-40 ${errFields.has('Quantity') ? 'ring-1 ring-red-400/70 rounded' : ''}`} value={row.quantity} onChange={(e) => set({ quantity: e.target.value })} />}
            </td>
            {/* Stock status */}
            <td className={td}>
                <select className={ci} value={row.stock_status} disabled={!row.stock_management} onChange={(e) => set({ stock_status: e.target.value })}>
                    <option value="instock">{L(language, 'In stock', 'متوفر')}</option>
                    <option value="outofstock">{L(language, 'Out of stock', 'نفد')}</option>
                    <option value="onbackorder">{L(language, 'Backorder', 'طلب مسبق')}</option>
                </select>
            </td>
            {/* Status */}
            <td className={td}>
                <select className={ci} value={row.status} onChange={(e) => set({ status: e.target.value })}>
                    <option value="draft">{L(language, 'Draft', 'مسودة')}</option>
                    <option value="published">{L(language, 'Publish', 'نشر')}</option>
                </select>
            </td>
            {/* Trunk essential */}
            <td className={`${td} text-center`}><Toggle checked={row.for_trunk} onChange={(v) => set({ for_trunk: v })} amber /></td>
            {/* Images */}
            <td className={td}><Chip label={s.images} placeholder={L(language, '+ Images', '+ الصور')} invalid={errFields.has('Images')} onClick={() => openModal('images', row._id)} /></td>
            {/* Variations */}
            <td className={td}><Chip label={s.variations} placeholder={L(language, '+ Options', '+ خيارات')} onClick={() => openModal('variations', row._id)} /></td>
            {/* Shipping */}
            <td className={td}><Chip label={s.shipping} placeholder={L(language, '+ Shipping', '+ الشحن')} onClick={() => openModal('shipping', row._id)} /></td>
        </tr>
    );
}

/* ── main grid ────────────────────────────────────────────────── */
/**
 * `catalogPicker` gates the master-catalog popup behind "Add row". It is on for
 * the vendor grid and off for the admin one, where the grid is used to enter
 * products on a chosen vendor's behalf and the catalog search endpoint (scoped
 * to the signed-in vendor) does not apply.
 */
export default function BulkEntryGrid({ submit, disabled, disabledHint, storageKey, editBase, catalogPicker = true }) {
    const { language } = useApp();
    const [rows, setRows] = useState(defaultRows);
    const [selected, setSelected] = useState(() => new Set());
    const [metadata, setMetadata] = useState(null);
    const [shippingClasses, setShippingClasses] = useState([]);
    const [modal, setModal] = useState(null); // { type, target }  target = rowId | '__bulk__'
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [applyOpen, setApplyOpen] = useState(false);
    const [savedDraft, setSavedDraft] = useState(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    const restoredRef = useRef(false);

    /* reference data */
    useEffect(() => {
        (async () => {
            // Full: pasted rows name their car models in text, and matching them needs
            // every make's models, not just the make list.
            try { const res = await fetch(`${API}/products/filters?detail=full`); setMetadata(await res.json()); } catch (e) { /* ignore */ }
            try { const d = await shippingApi.getClasses(); setShippingClasses(d?.classes || []); } catch (e) { /* ignore */ }
        })();
    }, []);

    const refs = useMemo(() => {
        const idx = buildCategoryIndex(metadata?.categories || [], language);
        const shipMap = new Map((shippingClasses || []).map((c) => [String(c._id), language === 'ar' ? (c.name_ar || c.name) : c.name]));
        const carBrandMap = new Map((metadata?.carBrands || []).map((b) => [String(b._id), b]));
        return { metadata, language, leafIds: idx.leafIds, pathLabel: idx.pathLabel, shipMap, carBrandMap, categoryIndex: indexCategoryTree(metadata?.categories || []) };
    }, [metadata, shippingClasses, language]);

    /* autosave + restore */
    useEffect(() => {
        if (!storageKey) return;
        try {
            const raw = localStorage.getItem(storageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.some((r) => !isRowEmpty(r))) setSavedDraft(parsed);
            }
        } catch (e) { /* ignore */ }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storageKey]);

    useEffect(() => {
        if (!storageKey) return;
        const id = setTimeout(() => {
            try {
                if (rows.some((r) => !isRowEmpty(r))) localStorage.setItem(storageKey, JSON.stringify(rows));
                else localStorage.removeItem(storageKey);
            } catch (e) { /* ignore */ }
        }, 600);
        return () => clearTimeout(id);
    }, [rows, storageKey]);

    /* unsaved-changes guard */
    useEffect(() => {
        const handler = (e) => {
            if (rows.some((r) => !isRowEmpty(r))) { e.preventDefault(); e.returnValue = ''; }
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [rows]);

    /* row ops */
    const updateRow = (id, patch) => setRows((prev) => prev.map((r) => (r._id === id ? { ...r, ...patch, _serverErrors: null } : r)));
    const addRows = (n = 1) => setRows((prev) => {
        const room = Math.max(0, MAX_ROWS - prev.length);
        return [...prev, ...Array.from({ length: Math.min(n, room) }, () => blankRow())];
    });
    /* Catalog picks land in the empty rows the grid already has before any new
       rows are appended — otherwise a vendor who picks 3 products ends up
       scrolling past 10 blank rows to reach them. */
    const addRowsFromCatalog = (entries) => setRows((prev) => {
        const incoming = entries.map(rowFromCatalogEntry);
        const next = [];
        let cursor = 0;
        for (const row of prev) {
            if (cursor < incoming.length && isRowEmpty(row)) next.push(incoming[cursor++]);
            else next.push(row);
        }
        const room = Math.max(0, MAX_ROWS - next.length);
        return [...next, ...incoming.slice(cursor, cursor + room)];
    });
    const duplicateRow = (id) => setRows((prev) => {
        if (prev.length >= MAX_ROWS) return prev;
        const i = prev.findIndex((r) => r._id === id);
        if (i === -1) return prev;
        const copy = cloneRow(prev[i]);
        return [...prev.slice(0, i + 1), copy, ...prev.slice(i + 1)];
    });
    const deleteRow = (id) => setRows((prev) => {
        const next = prev.filter((r) => r._id !== id);
        return next.length ? next : [blankRow()];
    });
    const onSelect = (id, checked) => setSelected((prev) => {
        const next = new Set(prev);
        if (checked) next.add(id); else next.delete(id);
        return next;
    });
    const selectAll = (checked) => setSelected(checked ? new Set(rows.map((r) => r._id)) : new Set());

    /* modal save — applies to a single row OR all selected (bulk) */
    const handleModalSave = (patch) => {
        if (modal?.target === '__bulk__') {
            setRows((prev) => prev.map((r) => (selected.has(r._id) ? { ...r, ...patch, _serverErrors: null } : r)));
        } else if (modal?.target) {
            updateRow(modal.target, patch);
        }
    };
    const modalRow = modal?.target === '__bulk__' ? blankRow() : (rows.find((r) => r._id === modal?.target) || blankRow());

    /* bulk apply (inline) */
    const applyToSelected = (patch) => {
        setRows((prev) => prev.map((r) => (selected.has(r._id) ? { ...r, ...patch, _serverErrors: null } : r)));
        setApplyOpen(false);
    };
    const copyFirstToSelected = () => {
        const ids = rows.filter((r) => selected.has(r._id)).map((r) => r._id);
        if (ids.length < 2) return;
        const src = rows.find((r) => r._id === ids[0]);
        const fields = ['category_id', 'product_brand_id', 'is_universal', 'compatible_cars', 'shipping_class_id', 'weight', 'dimensions', 'status', 'stock_management', 'stock_status'];
        const patch = {};
        fields.forEach((f) => { patch[f] = JSON.parse(JSON.stringify(src[f])); });
        setRows((prev) => prev.map((r) => (selected.has(r._id) && r._id !== src._id ? { ...r, ...patch, _serverErrors: null } : r)));
        setApplyOpen(false);
    };

    /* submit */
    const handleSubmit = async () => {
        setError('');
        const submittable = buildSubmittable(rows);
        if (!submittable.length) { setError(L(language, 'Add at least one product (SKU, price, category, image…).', 'أضف منتجاً واحداً على الأقل (SKU، السعر، الفئة، صورة…).')); return; }
        setSubmitting(true);
        try {
            const data = await submit(submittable.map(rowToPayload));
            const succeededIds = new Set();
            (data.succeeded || []).forEach((sx) => { const r = submittable[sx.row - 1]; if (r) succeededIds.add(r._id); });
            const failMap = new Map();
            (data.failed || []).forEach((f) => { const r = submittable[f.row - 1]; if (r) failMap.set(r._id, f); });
            setRows((prev) => {
                const next = prev
                    .filter((r) => !succeededIds.has(r._id))
                    .map((r) => (failMap.has(r._id) ? { ...r, _serverErrors: failMap.get(r._id).errors } : r));
                return next.length ? next : [blankRow()];
            });
            setSelected(new Set());
            setResult(data);
            if ((data.failed || []).length === 0 && storageKey) { try { localStorage.removeItem(storageKey); } catch (e) { /* ignore */ } }
        } catch (e) {
            setError(language === 'ar' ? 'فشل إرسال المنتجات. يرجى المحاولة مرة أخرى.' : (e.message || 'Submission failed.'));
        } finally {
            setSubmitting(false);
        }
    };

    /* aggregate counts */
    const stats = useMemo(() => {
        let ready = 0, attention = 0, filled = 0;
        rows.forEach((r) => {
            if (isRowEmpty(r)) return;
            filled += 1;
            if (validateRow(r, refs).length === 0) ready += 1; else attention += 1;
        });
        return { ready, attention, filled };
    }, [rows, refs]);

    const allSelected = rows.length > 0 && rows.every((r) => selected.has(r._id));
    const ModalCmp = { category: CategoryModal, content: ContentModal, images: ImagesModal, compatibility: CompatibilityModal, variations: VariationsModal, shipping: ShippingModal }[modal?.type];

    return (
        <div className="space-y-4">
            {/* restore banner */}
            {savedDraft && !restoredRef.current && (
                <div className="flex items-center justify-between gap-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
                        <AlertCircle size={16} />
                        {L(language, `Restore ${savedDraft.filter((r) => !isRowEmpty(r)).length} unsaved product(s) from your last session?`, `استعادة ${savedDraft.filter((r) => !isRowEmpty(r)).length} منتج غير محفوظ من جلستك السابقة؟`)}
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => { setRows(savedDraft); setSavedDraft(null); restoredRef.current = true; }} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500 text-white hover:bg-amber-600">{L(language, 'Restore', 'استعادة')}</button>
                        <button onClick={() => { setSavedDraft(null); restoredRef.current = true; try { localStorage.removeItem(storageKey); } catch (e) { /* ignore */ } }} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-amber-300 dark:border-amber-500/40 text-amber-700 dark:text-amber-300">{L(language, 'Discard', 'تجاهل')}</button>
                    </div>
                </div>
            )}

            {/* toolbar */}
            <div className="flex flex-wrap items-center gap-2 bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-xl p-3">
                {/* Opens the catalog picker rather than appending a blank row: a
                    grid cell would be ignored, a popup cannot be. */}
                <button onClick={() => (catalogPicker ? setPickerOpen(true) : addRows(1))} disabled={disabled} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-white/10 disabled:opacity-50"><Plus size={15} /> {L(language, 'Add row', 'إضافة صف')}</button>
                <button onClick={() => addRows(10)} disabled={disabled} className="px-3 py-2 rounded-lg text-sm font-semibold bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-white/10 disabled:opacity-50">+10</button>

                <div className="relative">
                    <button onClick={() => setApplyOpen((o) => !o)} disabled={disabled || selected.size === 0} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-white/10 disabled:opacity-50">
                        <Wand2 size={15} /> {L(language, 'Apply to selected', 'تطبيق على المحدد')} ({selected.size}) <ChevronDown size={13} />
                    </button>
                    {applyOpen && selected.size > 0 && (
                        <div className="absolute z-30 mt-1 w-60 bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/10 rounded-xl shadow-xl p-1.5 text-sm">
                            <button onClick={() => { setModal({ type: 'category', target: '__bulk__' }); setApplyOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-700 dark:text-zinc-200"><Layers size={14} /> {L(language, 'Set category…', 'تعيين الفئة…')}</button>
                            <button onClick={() => { setModal({ type: 'compatibility', target: '__bulk__' }); setApplyOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-700 dark:text-zinc-200"><Car size={14} /> {L(language, 'Set compatibility…', 'تعيين التوافق…')}</button>
                            <button onClick={() => { setModal({ type: 'shipping', target: '__bulk__' }); setApplyOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-700 dark:text-zinc-200"><Truck size={14} /> {L(language, 'Set shipping…', 'تعيين الشحن…')}</button>
                            <div className="my-1 border-t border-zinc-100 dark:border-white/10" />
                            <button onClick={() => applyToSelected({ is_universal: true, compatible_cars: [] })} className="w-full text-start px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-700 dark:text-zinc-200">{L(language, 'Mark Universal', 'تعيين كـ عام')}</button>
                            <button onClick={() => applyToSelected({ is_universal: false })} className="w-full text-start px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-700 dark:text-zinc-200">{L(language, 'Not universal', 'ليس عاماً')}</button>
                            <button onClick={() => applyToSelected({ status: 'published' })} className="w-full text-start px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-700 dark:text-zinc-200">{L(language, 'Set status: Publish', 'الحالة: نشر')}</button>
                            <button onClick={() => applyToSelected({ status: 'draft' })} className="w-full text-start px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-700 dark:text-zinc-200">{L(language, 'Set status: Draft', 'الحالة: مسودة')}</button>
                            <div className="my-1 border-t border-zinc-100 dark:border-white/10" />
                            <button onClick={copyFirstToSelected} className="w-full text-start px-3 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-700 dark:text-zinc-200">{L(language, 'Copy 1st row → selected', 'نسخ أول صف → المحدد')}</button>
                            <button onClick={() => { setRows((prev) => { const next = prev.filter((r) => !selected.has(r._id)); return next.length ? next : [blankRow()]; }); setSelected(new Set()); setApplyOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-red-600"><Trash2 size={14} /> {L(language, 'Delete selected', 'حذف المحدد')}</button>
                        </div>
                    )}
                </div>

                <div className="flex-1" />

                <div className="flex items-center gap-3 text-xs text-zinc-500">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> {stats.ready} {L(language, 'ready', 'جاهز')}</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> {stats.attention} {L(language, 'to fix', 'للإصلاح')}</span>
                </div>
                <button onClick={handleSubmit} disabled={disabled || submitting || stats.filled === 0} className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold bg-marine-cyan hover:bg-marine-cyan-dark text-white disabled:opacity-50">
                    {submitting ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                    {L(language, 'Submit all', 'إرسال الكل')} ({stats.filled})
                </button>
            </div>

            {disabled && disabledHint && (
                <div className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-2"><AlertCircle size={15} /> {disabledHint}</div>
            )}
            {error && (
                <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2"><AlertCircle size={16} /> {error}</div>
            )}

            {/* grid */}
            <div className={`overflow-auto max-h-[70vh] bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/5 rounded-xl ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                <table className="min-w-max w-full border-collapse">
                    <thead className="sticky top-0 z-20 bg-zinc-50 dark:bg-[#14171A]">
                        {/* group band */}
                        <tr>
                            <GroupTh span={5} color="bg-[#D32F2F]">{L(language, 'Identifiers', 'المعرّفات')}</GroupTh>
                            <GroupTh span={3} color="bg-[#1565C0]">{L(language, 'Content', 'المحتوى')}</GroupTh>
                            <GroupTh span={3} color="bg-[#00695C]">{L(language, 'Pricing', 'التسعير')}</GroupTh>
                            <GroupTh span={2} color="bg-[#558B2F]">{L(language, 'Classification', 'التصنيف')}</GroupTh>
                            <GroupTh span={1} color="bg-[#E65100]">{L(language, 'Fitment', 'التوافق')}</GroupTh>
                            <GroupTh span={3} color="bg-[#4527A0]">{L(language, 'Inventory', 'المخزون')}</GroupTh>
                            <GroupTh span={3} color="bg-[#37474F]">{L(language, 'Publishing', 'النشر')}</GroupTh>
                            <GroupTh span={1} color="bg-[#00838F]">{L(language, 'Media', 'الوسائط')}</GroupTh>
                            <GroupTh span={1} color="bg-[#AD1457]">{L(language, 'Options', 'الخيارات')}</GroupTh>
                            <GroupTh span={1} color="bg-[#00695C]">{L(language, 'Shipping', 'الشحن')}</GroupTh>
                        </tr>
                        {/* column headers */}
                        <tr className="bg-zinc-50 dark:bg-[#14171A]">
                            <Th w={120}><div className="flex items-center gap-2"><input type="checkbox" checked={allSelected} onChange={(e) => selectAll(e.target.checked)} className="rounded text-marine-primary" />#</div></Th>
                            <Th w={120} req>SKU</Th>
                            <Th w={130} req>{L(language, 'Part type', 'نوع القطعة')}</Th>
                            <Th w={120}>{L(language, 'Part #', 'رقم القطعة')}</Th>
                            <Th w={120}>GTIN</Th>
                            <Th w={150}>{L(language, 'Title EN', 'العنوان (EN)')}</Th>
                            <Th w={150}>{L(language, 'Title AR', 'العنوان (AR)')}</Th>
                            <Th w={120} req>{L(language, 'Content', 'المحتوى')}</Th>
                            <Th w={90} req>{L(language, 'Price', 'السعر')}</Th>
                            <Th w={110}>{L(language, 'Discount type', 'نوع الخصم')}</Th>
                            <Th w={90}>{L(language, 'Discount value', 'قيمة الخصم')}</Th>
                            <Th w={190} req>{L(language, 'Category', 'الفئة')}</Th>
                            <Th w={130}>{L(language, 'Brand', 'الماركة')}</Th>
                            <Th w={200}>{L(language, 'Fitment', 'التوافق')}</Th>
                            <Th w={70}>{L(language, 'Stock', 'مخزون')}</Th>
                            <Th w={70}>{L(language, 'Qty', 'الكمية')}</Th>
                            <Th w={120}>{L(language, 'Stock status', 'حالة المخزون')}</Th>
                            <Th w={110}>{L(language, 'Status', 'الحالة')}</Th>
                            <Th w={70}>{L(language, 'Trunk', 'شنطة')}</Th>
                            <Th w={110} req>{L(language, 'Images', 'الصور')}</Th>
                            <Th w={150}>{L(language, 'Options', 'الخيارات')}</Th>
                            <Th w={150}>{L(language, 'Shipping', 'الشحن')}</Th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, idx) => (
                            <Row
                                key={row._id}
                                row={row}
                                idx={idx}
                                refs={refs}
                                language={language}
                                selected={selected.has(row._id)}
                                onSelect={onSelect}
                                onChange={updateRow}
                                onDuplicate={duplicateRow}
                                onDelete={deleteRow}
                                openModal={(type, target) => setModal({ type, target })}
                            />
                        ))}
                    </tbody>
                </table>
            </div>

            {/* server-error hint under grid */}
            {rows.some((r) => r._serverErrors) && (
                <div className="text-xs text-red-500 flex items-center gap-2"><AlertCircle size={14} /> {L(language, 'Some rows failed and were kept above with details below. Fix and submit again.', 'فشلت بعض الصفوف وبقيت بالأعلى مع التفاصيل بالأسفل. أصلحها وأعد الإرسال.')}</div>
            )}

            <ResultsPanel result={result} editBase={editBase} onReset={() => setResult(null)} />

            {/* active modal */}
            {ModalCmp && (
                <ModalCmp row={modalRow} refs={refs} onSave={handleModalSave} onClose={() => setModal(null)} />
            )}

            {pickerOpen && catalogPicker && (
                <CatalogPickerModal
                    language={language}
                    roomLeft={Math.max(0, MAX_ROWS - rows.filter((r) => !isRowEmpty(r)).length)}
                    onAdd={addRowsFromCatalog}
                    onNewRow={() => addRows(1)}
                    onClose={() => setPickerOpen(false)}
                />
            )}
        </div>
    );
}
