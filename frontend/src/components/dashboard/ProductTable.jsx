'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Edit2, Trash2, LayoutGrid, ToggleLeft, ToggleRight, Loader2, Bell, Columns3, Check, X, Pencil, Star, RotateCcw } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { vendorApi } from '../../lib/api';
import ProductViewMenu from './ProductViewMenu';
import { thumbUrl } from '../../lib/assets';
import useRowLink from '../../lib/useRowLink';
import { PART_TYPES, partTypeLabel } from '../../lib/partType';
import { computeDiscountPrice, validateDiscount } from '../../lib/productPricing';
import { formatLocalizedDate } from '../../lib/dateFormat';
import { CompatibilityModal } from './bulk-entry/FieldModals';

/*
 * The products table of the admin and the vendor dashboards.
 *
 * Columns: each person picks what the rows show ("Columns", kept in this browser per
 * screen through `columnsKey`). The product's name and the actions are always there.
 *
 * Fitment: as on the online bulk upload — a "universal" switch, and the cars it fits beside
 * it; a click on them (or turning "universal" off) opens the same "Vehicle Compatibility"
 * popup, and its "Done" saves.
 *
 * Quick edit: a cell with a pencil is edited where it is — click it, change it, Enter (or ✓)
 * saves through `updateProduct`, Esc (or ✕) leaves it. Which cells can be edited is the
 * screen's choice (`editable`): the admin edits everything here; a vendor only the price, the
 * discount and the stock, which change day to day — a title or a category goes through the
 * product form and its review.
 */

// key → { ar, en, default (shown when nothing is saved), admin (admin screens only) }
const COLUMNS = [
  { key: 'status', ar: 'الحالة', en: 'Status', default: true },
  { key: 'price', ar: 'السعر', en: 'Price', default: true },
  { key: 'discount', ar: 'الخصم', en: 'Discount', default: false },
  { key: 'stock', ar: 'المخزون', en: 'Stock', default: true },
  { key: 'vendor', ar: 'التاجر', en: 'Vendor', default: true, admin: true },
  { key: 'category', ar: 'الفئة', en: 'Category', default: true },
  { key: 'brand', ar: 'الماركة', en: 'Brand', default: false },
  { key: 'part_type', ar: 'نوع القطعة', en: 'Part type', default: false },
  { key: 'part_number', ar: 'رقم القطعة', en: 'Part number', default: false },
  { key: 'sku', ar: 'SKU', en: 'SKU', default: false },
  { key: 'fitment', ar: 'التوافق', en: 'Fitment', default: true, admin: true },
  { key: 'sold', ar: 'المبيعات', en: 'Sold', default: false },
  { key: 'rating', ar: 'التقييم', en: 'Rating', default: false },
  { key: 'created', ar: 'تاريخ الإضافة', en: 'Added', default: false },
];

const TH = 'px-4 py-4 font-bold text-zinc-400 uppercase tracking-widest text-[10px]';
const TD = 'px-4 py-3 text-xs';
const EDIT_INPUT = 'bg-white dark:bg-[#0E1012] border border-zinc-300 dark:border-white/15 rounded-md px-2 py-1 text-xs text-zinc-900 dark:text-white focus:border-marine-cyan outline-none';

const idOf = (v) => (v && typeof v === 'object' ? v._id : v) || '';

/** The tree as one list with depth, for the category picker. */
const flatten = (tree, level = 0, out = []) => {
  (tree || []).forEach((c) => { out.push({ _id: c._id, name: c.name, name_ar: c.name_ar, level }); flatten(c.subcategories, level + 1, out); });
  return out;
};

/** A saved product merged over the row: an answer with bare ids keeps the row's names for them. */
const mergeSaved = (row, saved) => {
  if (!saved) return row;
  const out = { ...row, ...saved };
  for (const key of ['category_id', 'product_brand_id', 'vendor_id']) {
    const value = saved[key];
    if (value && typeof value !== 'object' && row[key] && typeof row[key] === 'object' && String(row[key]._id) === String(value)) out[key] = row[key];
  }
  return out;
};

/** Which columns show, kept in this browser per screen. */
function useColumns(storageKey, isAdmin) {
  const available = useMemo(() => COLUMNS.filter((c) => isAdmin || !c.admin), [isAdmin]);
  const defaults = useMemo(() => available.filter((c) => c.default).map((c) => c.key), [available]);
  const [shown, setShown] = useState(defaults);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`readycar.columns.${storageKey}`) || 'null');
      if (Array.isArray(saved)) setShown(saved.filter((k) => available.some((c) => c.key === k)));
    } catch (_) { /* private mode */ }
  }, [storageKey, available]);
  const save = (next) => {
    setShown(next);
    try { localStorage.setItem(`readycar.columns.${storageKey}`, JSON.stringify(next)); } catch (_) { /* private mode */ }
  };
  const toggle = (key) => save(shown.includes(key) ? shown.filter((k) => k !== key) : [...shown, key]);
  return { available, shown, toggle, reset: () => save(defaults) };
}

/** The "Columns" menu. */
function ColumnsMenu({ columns, isAr }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#14171A] px-3 py-1.5 text-xs font-bold text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan hover:text-marine-primary">
        <Columns3 size={14} />{isAr ? 'الأعمدة' : 'Columns'}
      </button>
      {open && (
        <div className="absolute z-30 mt-2 end-0 w-60 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#1A1D20] p-2 shadow-xl">
          <p className="px-2 pb-1 text-[10px] font-black uppercase tracking-wider text-zinc-400">{isAr ? 'اعرض في الصفوف' : 'Show in the rows'}</p>
          <div className="max-h-80 overflow-y-auto">
            {columns.available.map((c) => (
              <label key={c.key} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/5 cursor-pointer">
                <input type="checkbox" checked={columns.shown.includes(c.key)} onChange={() => columns.toggle(c.key)} className="w-4 h-4 accent-marine-cyan" />
                {isAr ? c.ar : c.en}
              </label>
            ))}
          </div>
          <button type="button" onClick={columns.reset} className="mt-1 w-full inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold text-zinc-500 hover:text-marine-primary">
            <RotateCcw size={12} />{isAr ? 'رجّع الافتراضي' : 'Back to default'}
          </button>
        </div>
      )}
    </div>
  );
}

/** The inputs of a cell being edited, by kind: text, number, select, discount, stock. */
function CellEditor({ kind, draft, setDraft, options = [], dir = 'ltr', width = 'w-32', placeholder = '—', currency, basePrice, isAr }) {
  if (kind === 'text') {
    return <input autoFocus dir={dir} value={draft} onChange={(e) => setDraft(e.target.value)} className={`${EDIT_INPUT} ${width}`} />;
  }
  if (kind === 'number') {
    return <input autoFocus type="number" min="0" step="0.01" dir="ltr" value={draft} onChange={(e) => setDraft(e.target.value)} className={`${EDIT_INPUT} ${width}`} />;
  }
  if (kind === 'select') {
    return (
      <select autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} className={`${EDIT_INPUT} ${width}`}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{'\u00A0\u00A0'.repeat(o.level || 0)}{o.label}</option>)}
      </select>
    );
  }
  if (kind === 'discount') {
    return (
      <span className="inline-flex items-center gap-1">
        <select autoFocus value={draft.type} onChange={(e) => setDraft({ type: e.target.value, value: e.target.value ? draft.value : '' })} className={EDIT_INPUT}>
          <option value="">{isAr ? 'بدون' : 'None'}</option>
          <option value="percentage">%</option>
          <option value="fixed">{currency}</option>
        </select>
        <input type="number" min="0" step="0.01" dir="ltr" disabled={!draft.type} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} className={`${EDIT_INPUT} w-20 disabled:opacity-40`} />
        {draft.type && draft.value !== '' && (
          <span className="text-[10px] text-zinc-500">= {currency} {Number(computeDiscountPrice(basePrice, draft.type, draft.value) || 0).toLocaleString(isAr ? 'ar-EG' : 'en-US', { maximumFractionDigits: 2 })}</span>
        )}
      </span>
    );
  }
  // stock
  return (
    <span className="inline-flex items-center gap-1.5">
      <label className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
        <input type="checkbox" checked={draft.tracked} onChange={(e) => setDraft({ ...draft, tracked: e.target.checked })} className="accent-marine-cyan" />
        {isAr ? 'تتبع' : 'Track'}
      </label>
      <input autoFocus type="number" min="0" step="1" dir="ltr" disabled={!draft.tracked} value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} className={`${EDIT_INPUT} w-20 disabled:opacity-40`} />
    </span>
  );
}

/**
 * A cell edited where it is. `kind` (and its settings) picks the inputs for the draft;
 * `toPatch(draft)` gives what is sent, nothing when unchanged, or a string to say what is
 * wrong. Enter saves, Esc leaves.
 */
function EditableCell({ canEdit, display, initial, toPatch, onSave, isAr, align = 'start', ...editor }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = () => { setDraft(initial); setError(''); setEditing(true); };
  const save = async () => {
    const patch = toPatch(draft);
    if (typeof patch === 'string') { setError(patch); return; }
    if (!patch) { setEditing(false); return; }
    setBusy(true);
    setError('');
    try {
      await onSave(patch);
      setEditing(false);
    } catch (err) {
      setError(err.message || (isAr ? 'تعذر الحفظ' : 'Could not save'));
    } finally {
      setBusy(false);
    }
  };
  const onKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
  };

  if (!canEdit) return display;
  if (!editing) {
    return (
      <button type="button" onClick={start} title={isAr ? 'تعديل سريع' : 'Quick edit'}
        className={`group/cell inline-flex max-w-full items-center gap-1.5 rounded-md px-1 -mx-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-white/5 ${align === 'end' ? 'justify-end' : ''}`}>
        <span className="min-w-0">{display}</span>
        <Pencil size={11} className="shrink-0 text-zinc-300 group-hover/cell:text-marine-primary" />
      </button>
    );
  }
  return (
    <div data-no-row-link="" className="space-y-1" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-1">
        <CellEditor {...editor} draft={draft} setDraft={setDraft} isAr={isAr} />
        <button type="button" onClick={save} disabled={busy} title={isAr ? 'حفظ (Enter)' : 'Save (Enter)'} className="p-1 rounded-md bg-emerald-600 text-white disabled:opacity-50">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
        </button>
        <button type="button" onClick={() => setEditing(false)} disabled={busy} title={isAr ? 'إلغاء (Esc)' : 'Cancel (Esc)'} className="p-1 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5"><X size={13} /></button>
      </div>
      {error && <p className="text-[10px] font-bold text-red-500 whitespace-normal max-w-[220px]">{error}</p>}
    </div>
  );
}

/** The online bulk upload's switch. */
function Switch({ checked, onChange, disabled }) {
  return (
    <label className={`relative inline-flex items-center ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input type="checkbox" className="sr-only peer" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <div className={`w-9 h-5 rounded-full after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all ${checked ? 'bg-marine-cyan after:translate-x-4 rtl:after:-translate-x-4' : 'bg-zinc-300 dark:bg-white/10'}`} />
    </label>
  );
}

/** "Toyota Corolla, Kia +2": the cars a product fits, short. */
const carsSummary = (cars) => {
  const names = (cars || []).map((c) => (c.all_models || !(c.models || []).length
    ? c.brand_name
    : `${c.brand_name} ${(c.models || []).slice(0, 2).map((m) => m.model_name).join('/')}${(c.models || []).length > 2 ? '…' : ''}`)).filter(Boolean);
  return names.slice(0, 2).join('، ') + (names.length > 2 ? ` +${names.length - 2}` : '');
};

/** The fitment cell: the universal switch and, when not universal, the cars as a button. */
function FitmentCell({ product, canEdit, isAr, busy, error, onUniversal, onOpen }) {
  const summary = carsSummary(product.compatible_cars);
  if (!canEdit) {
    return <span className="text-zinc-600 dark:text-zinc-300">{product.is_universal ? (isAr ? 'عام: أي عربية' : 'Universal') : (summary || (isAr ? 'من غير توافق' : 'No fitment'))}</span>;
  }
  return (
    <div data-no-row-link="" className="space-y-1">
      <div className="flex items-center gap-2">
        <Switch checked={product.is_universal} disabled={busy} onChange={onUniversal} />
        {busy && <Loader2 size={13} className="animate-spin text-marine-primary" />}
        {product.is_universal
          ? <span className="text-zinc-400">{isAr ? 'عام' : 'Universal'}</span>
          : (
            <button type="button" onClick={onOpen} title={summary || ''}
              className={`max-w-[180px] truncate text-start px-2 py-1 rounded ${summary ? 'text-zinc-900 dark:text-white hover:bg-zinc-100 dark:hover:bg-white/5' : 'text-red-500 ring-1 ring-red-300/70 bg-red-50 dark:bg-red-500/10'}`}>
              {summary || (isAr ? '+ أضف عربيات' : '+ Add cars')}
            </button>
          )}
      </div>
      {error && <p className="text-[10px] font-bold text-red-500 whitespace-normal max-w-[220px]">{error}</p>}
    </div>
  );
}

/**
 * @param columnsKey  where this screen keeps its column choice ('admin.products', 'vendor.products')
 * @param editable    the fields that can be edited in place: title, price, discount, stock, sku,
 *                    part_number, part_type, category
 * @param categories  the category tree, for editing the category in place
 * @param loadCarBrands  () => Promise<car makes with their models>, for the fitment popup
 *                       (fetched the first time it opens)
 */
export default function ProductTable({
  products: initialProducts, onEdit, onDelete, language, updateProduct = vendorApi.updateProduct, showVendor = false,
  reviewBasePath = '/dashboard/products', columnsKey = showVendor ? 'admin.products' : 'vendor.products',
  editable = showVendor ? ['title', 'price', 'discount', 'stock', 'sku', 'part_number', 'part_type', 'category', 'fitment'] : ['price', 'discount', 'stock'],
  categories = null, loadCarBrands = null,
}) {
  const rowLink = useRowLink();
  const { t, siteSettings } = useApp();
  const isAr = language === 'ar';
  const currency = siteSettings?.currency || 'QAR';
  const columns = useColumns(columnsKey, showVendor);
  const show = (key) => columns.shown.includes(key) && (key !== 'vendor' || showVendor);
  const can = (field) => editable.includes(field);
  const flatCategories = useMemo(() => flatten(categories || []), [categories]);
  const categoryOptions = useMemo(() => flatCategories.map((c) => ({ value: c._id, level: c.level, label: isAr ? (c.name_ar || c.name) : c.name })), [flatCategories, isAr]);
  const partTypeOptions = useMemo(() => PART_TYPES.map((p) => ({ value: p.value, label: isAr ? p.ar : p.en })), [isAr]);
  const money = (n) => `${currency} ${Number(n || 0).toLocaleString(isAr ? 'ar-EG' : 'en-US', { maximumFractionDigits: 2 })}`;

  const [products, setProducts] = useState(initialProducts);
  const [togglingId, setTogglingId] = useState(null);
  // The fitment popup: which product, the makes it needs, and each row's save in progress.
  const [fitmentFor, setFitmentFor] = useState(null);
  const [carBrands, setCarBrands] = useState(null);
  const [fitmentBusy, setFitmentBusy] = useState({});
  const [fitmentError, setFitmentError] = useState({});

  useEffect(() => {
    if (togglingId === null) {
      setProducts(initialProducts);
    }
  }, [initialProducts, togglingId]);

  const handleToggleStatus = async (product) => {
    const newStatus = product.status === 'published' ? 'draft' : 'published';
    // Taking a live product down is not a display setting: its page stops opening for
    // anyone holding the link, and putting it back needs the admin's approval again.
    if (newStatus === 'draft' && !window.confirm(
      isAr
        ? 'هتخفي المنتج ده من المتجر. صفحته مش هتفتح لحد، وعشان يرجع منشور هيحتاج موافقة الإدارة تاني. متأكد؟'
        : 'This hides the product from the shop. Its page stops opening for anyone, and publishing it again needs admin approval. Continue?'
    )) return;
    setTogglingId(product._id);
    try {
      await updateProduct(product._id, { status: newStatus });
      setProducts(prev => prev.map(p => p._id === product._id ? { ...p, status: newStatus } : p));
    } catch (err) {
      alert(isAr ? 'تعذر تحديث حالة المنتج.' : 'Failed to update product status.');
    } finally {
      setTogglingId(null);
    }
  };

  // Save one quick edit, and show what the server kept.
  const saveField = (product) => async (patch) => {
    const res = await updateProduct(product._id, patch);
    const saved = { ...(res?.product || { ...product, ...patch }) };
    // An answer with the category as a bare id: name it from the list, so the cell is not blank.
    if (saved.category_id && typeof saved.category_id !== 'object') {
      const c = flatCategories.find((x) => String(x._id) === String(saved.category_id));
      if (c) saved.category_id = { _id: c._id, name: c.name, name_ar: c.name_ar };
    }
    setProducts((prev) => prev.map((p) => (p._id === product._id ? mergeSaved(p, saved) : p)));
  };

  const openFitment = (product) => {
    setFitmentFor(product);
    if (!carBrands && loadCarBrands) loadCarBrands().then((list) => setCarBrands(list || [])).catch(() => setCarBrands([]));
  };

  const saveFitment = async (product, patch) => {
    if (!patch.is_universal && !(patch.compatible_cars || []).length) {
      setFitmentError((e) => ({ ...e, [product._id]: isAr ? 'اختار عربية واحدة على الأقل، أو خليه عام.' : 'Choose at least one car, or make it universal.' }));
      return;
    }
    setFitmentBusy((b) => ({ ...b, [product._id]: true }));
    setFitmentError((e) => ({ ...e, [product._id]: '' }));
    try {
      await saveField(product)(patch);
    } catch (err) {
      setFitmentError((e) => ({ ...e, [product._id]: err.message || (isAr ? 'تعذر الحفظ' : 'Could not save') }));
    } finally {
      setFitmentBusy((b) => ({ ...b, [product._id]: false }));
    }
  };

  if (!products || products.length === 0) {
    return (
      <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 py-16 text-center shadow-sm">
        <LayoutGrid size={48} className="mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
        <h3 className="text-lg font-bold text-zinc-900 dark:text-white">{t.noProductsFound || 'No products found'}</h3>
        <p className="text-zinc-500 mt-1">{t.startByCreating || 'Get started by creating a new product.'}</p>
      </div>
    );
  }

  const label = (key) => { const c = COLUMNS.find((x) => x.key === key); return isAr ? c.ar : c.en; };
  const titleKey = isAr ? 'title_ar' : 'title_en';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-zinc-400">{isAr ? 'الخانات اللي جنبها ✎ بتتعدّل مكانها.' : 'Cells with ✎ are edited in place.'}</p>
        <ColumnsMenu columns={columns} isAr={isAr} />
      </div>
      <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-zinc-50 dark:bg-white/[0.02] border-b border-zinc-200 dark:border-white/5">
              <tr className={isAr ? 'text-right' : 'text-left'}>
                <th className={`${TH} px-6`}>{t.productName || 'Product'}</th>
                {COLUMNS.filter((c) => show(c.key)).map((c) => <th key={c.key} className={TH}>{label(c.key)}</th>)}
                <th className={`${TH} px-6 ${isAr ? 'text-left' : 'text-right'}`}>{t.actions || 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
              {products.map((product) => {
                const isPublished = product.status === 'published';
                const isPending = product.status === 'pending';
                const isToggling = togglingId === product._id;
                const save = saveField(product);
                const finalPrice = product.discount_price ?? product.price;
                const name = isAr ? (product.title_ar || product.title_en) : product.title_en;
                return (
                  <tr key={product._id} {...rowLink(`${reviewBasePath}/${product._id}`)} className="hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors group cursor-pointer">
                    {/* Product */}
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-zinc-100 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/5 overflow-hidden flex-shrink-0 shadow-sm">
                          {product.images?.[0]?.url ? (
                            <img src={thumbUrl(product.images[0].url, 160)} alt={product.title_en} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-zinc-300"><LayoutGrid size={20} /></div>
                          )}
                        </div>
                        {/* min-w-0 lets the box honour its max-width: the table cannot wrap, and a
                            long SKU would otherwise push the badges over the next column. */}
                        <div className="min-w-0 max-w-[200px] sm:max-w-[300px]">
                          <EditableCell canEdit={can('title')} isAr={isAr} onSave={save}
                            initial={product[titleKey] || ''}
                            // Its own title: the whole name on hover, over the button's "Quick edit".
                            display={<span className="block font-bold text-sm text-zinc-900 dark:text-white truncate" title={name}>{name}</span>}
                            kind="text" dir={isAr ? 'rtl' : 'ltr'} width="w-56"
                            toPatch={(d) => (!d.trim() ? (isAr ? 'العنوان مايبقاش فاضي' : 'The title cannot be empty') : d === (product[titleKey] || '') ? null : { [titleKey]: d.trim() })} />
                          <div className="flex items-center gap-2 mt-0.5 text-[10px] min-w-0">
                            <span className="text-zinc-500 font-bold tracking-wider truncate min-w-0">SKU: {product.sku}</span>
                            {product.is_universal && (
                              <span className="shrink-0 bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400 px-1.5 py-0.5 rounded font-black tracking-widest uppercase text-[8px]">{t.universalFit || 'Universal'}</span>
                            )}
                            {product.variants?.length > 0 && (
                              <span className="shrink-0 bg-purple-50 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400 px-1.5 py-0.5 rounded font-black tracking-widest uppercase text-[8px]">
                                {product.variants.length} {isAr ? 'تنويعات' : 'Variants'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {show('status') && (
                      <td className={TD}>
                        {isPending ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
                            <Bell size={11} />{isAr ? 'معلق' : 'Pending'}
                          </span>
                        ) : (
                          <button onClick={() => handleToggleStatus(product)} disabled={isToggling} title={isAr ? 'انقر لتغيير الحالة' : 'Click to toggle status'}
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer ${isPublished
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/20'
                              : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'}`}>
                            {isToggling ? <Loader2 size={11} className="animate-spin" /> : isPublished ? <ToggleRight size={13} /> : <ToggleLeft size={13} />}
                            {isPublished ? (isAr ? 'منشور' : 'Published') : (isAr ? 'مسودة' : 'Draft')}
                          </button>
                        )}
                      </td>
                    )}

                    {show('price') && (
                      <td className={TD}>
                        <EditableCell canEdit={can('price')} isAr={isAr} onSave={save} initial={String(product.price ?? '')}
                          display={(
                            <span className="font-bold text-zinc-900 dark:text-zinc-200">
                              {money(finalPrice)}
                              {finalPrice !== product.price && <span className="ms-1 text-zinc-400 line-through font-medium">{Number(product.price).toLocaleString(isAr ? 'ar-EG' : 'en-US', { maximumFractionDigits: 2 })}</span>}
                            </span>
                          )}
                          kind="number" width="w-24"
                          toPatch={(d) => {
                            if (!(Number(d) > 0)) return isAr ? 'اكتب سعر أكبر من صفر' : 'Enter a price above zero';
                            if (Number(d) === Number(product.price)) return null;
                            return validateDiscount(Number(d), product.discount_type || null, product.discount_value, isAr) || { price: Number(d) };
                          }} />
                      </td>
                    )}

                    {show('discount') && (
                      <td className={TD}>
                        <EditableCell canEdit={can('discount')} isAr={isAr} onSave={save}
                          initial={{ type: product.discount_type || '', value: product.discount_value ?? '' }}
                          display={<span className="text-zinc-600 dark:text-zinc-300 font-bold">{!product.discount_type ? '—' : product.discount_type === 'percentage' ? `${product.discount_value}%` : money(product.discount_value)}</span>}
                          kind="discount" currency={currency} basePrice={product.price}
                          toPatch={(d) => {
                            const problem = validateDiscount(product.price, d.type || null, d.value, isAr);
                            if (problem) return problem;
                            if ((d.type || '') === (product.discount_type || '') && String(d.value ?? '') === String(product.discount_value ?? '')) return null;
                            return { discount_type: d.type || null, discount_value: d.type && d.value !== '' ? Number(d.value) : null };
                          }} />
                      </td>
                    )}

                    {show('stock') && (
                      <td className={TD}>
                        <EditableCell canEdit={can('stock')} isAr={isAr} onSave={save}
                          initial={{ tracked: !!product.stock_management, quantity: String(product.quantity ?? 0) }}
                          display={(
                            <span className={`font-bold ${product.stock_management && !(product.quantity > 0) ? 'text-red-500' : 'text-zinc-900 dark:text-zinc-300'}`}>
                              {product.stock_management ? `${product.quantity ?? 0} ${isAr ? 'في المخزن' : 'in stock'}` : (t.notTracked || (isAr ? 'مش متتبع' : 'Not tracked'))}
                            </span>
                          )}
                          kind="stock"
                          toPatch={(d) => {
                            const q = Number(d.quantity);
                            if (d.tracked && (!Number.isInteger(q) || q < 0)) return isAr ? 'الكمية رقم صحيح من صفر وطالع' : 'Quantity is a whole number, zero or more';
                            if (d.tracked === !!product.stock_management && (!d.tracked || q === Number(product.quantity ?? 0))) return null;
                            return { stock_management: d.tracked, ...(d.tracked ? { quantity: q } : {}) };
                          }} />
                      </td>
                    )}

                    {show('vendor') && (
                      <td className={TD}>
                        <div className="text-zinc-900 dark:text-zinc-300 font-bold">{product.vendor_id?.store_name || 'Unknown vendor'}</div>
                        <div className="text-zinc-400 text-[10px] mt-0.5 font-bold">@{product.vendor_id?.store_username || '-'}</div>
                      </td>
                    )}

                    {show('category') && (
                      <td className={TD}>
                        <EditableCell canEdit={can('category') && flatCategories.length > 0} isAr={isAr} onSave={save} initial={idOf(product.category_id)}
                          display={<span className="text-zinc-500 dark:text-zinc-400 font-medium">{isAr ? (product.category_id?.name_ar || product.category_id?.name || 'غير مصنف') : (product.category_id?.name_en || product.category_id?.name || 'Uncategorized')}</span>}
                          kind="select" width="max-w-[220px]" placeholder={isAr ? '— اختار —' : '— choose —'} options={categoryOptions}
                          toPatch={(d) => (!d ? (isAr ? 'اختار فئة' : 'Choose a category') : String(d) === String(idOf(product.category_id)) ? null : { category_id: d })} />
                      </td>
                    )}

                    {show('brand') && <td className={`${TD} text-zinc-600 dark:text-zinc-300`}>{product.product_brand_id?.name || '—'}</td>}

                    {show('part_type') && (
                      <td className={TD}>
                        <EditableCell canEdit={can('part_type')} isAr={isAr} onSave={save} initial={product.part_type || ''}
                          display={<span className="font-bold text-zinc-600 dark:text-zinc-300">{partTypeLabel(product.part_type, isAr) || '—'}</span>}
                          kind="select" width="" options={partTypeOptions}
                          toPatch={(d) => (!d ? (isAr ? 'اختار نوع القطعة' : 'Choose a part type') : d === product.part_type ? null : { part_type: d })} />
                      </td>
                    )}

                    {show('part_number') && (
                      <td className={TD}>
                        <EditableCell canEdit={can('part_number')} isAr={isAr} onSave={save} initial={product.part_number || ''}
                          display={<span className="font-mono text-zinc-600 dark:text-zinc-300">{product.part_number || '—'}</span>}
                          kind="text" width="w-32"
                          toPatch={(d) => (d.trim() === (product.part_number || '') ? null : { part_number: d.trim() })} />
                      </td>
                    )}

                    {show('sku') && (
                      <td className={TD}>
                        <EditableCell canEdit={can('sku')} isAr={isAr} onSave={save} initial={product.sku || ''}
                          display={<span className="font-mono text-zinc-600 dark:text-zinc-300">{product.sku || '—'}</span>}
                          kind="text" width="w-36"
                          toPatch={(d) => (!d.trim() ? (isAr ? 'الـ SKU مايبقاش فاضي' : 'The SKU cannot be empty') : d.trim() === (product.sku || '') ? null : { sku: d.trim() })} />
                      </td>
                    )}

                    {show('fitment') && (
                      <td className={TD}>
                        <FitmentCell product={product} canEdit={can('fitment') && !!loadCarBrands} isAr={isAr}
                          busy={!!fitmentBusy[product._id]} error={fitmentError[product._id]}
                          // On: universal at once. Off: choose the cars first; nothing changes until "Done".
                          onUniversal={(on) => (on ? saveFitment(product, { is_universal: true, compatible_cars: [] }) : openFitment(product))}
                          onOpen={() => openFitment(product)} />
                      </td>
                    )}

                    {show('sold') && <td className={`${TD} font-bold text-zinc-700 dark:text-zinc-300`}>{(product.sold_count || 0).toLocaleString(isAr ? 'ar-EG' : 'en-US')}</td>}

                    {show('rating') && (
                      <td className={TD}>
                        <span className="inline-flex items-center gap-1 font-bold text-zinc-700 dark:text-zinc-300">
                          <Star size={11} className="text-amber-400 fill-amber-400" />{Number(product.rating || 0).toFixed(1)}
                          <span className="text-zinc-400 font-medium">({product.reviews_count || 0})</span>
                        </span>
                      </td>
                    )}

                    {show('created') && <td className={`${TD} text-zinc-500`}>{product.created_at ? formatLocalizedDate(product.created_at, isAr, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}</td>}

                    {/* Actions */}
                    <td className={`px-6 py-3 ${isAr ? 'text-left' : 'text-right'}`}>
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200">
                        <ProductViewMenu product={product} reviewHref={`${reviewBasePath}/${product._id}`} language={language} />
                        <button onClick={() => onEdit(product)} className="p-2 text-zinc-400 hover:text-marine-primary hover:bg-red-50 dark:hover:bg-marine-cyan/10 rounded-xl transition-colors" title={t.edit || 'Edit'}>
                          <Edit2 size={16} />
                        </button>
                        {onDelete && (
                          <button onClick={() => onDelete(product._id)} className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-colors" title={t.delete || 'Delete'}>
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {fitmentFor && (
        // The online bulk upload's own popup; "Done" saves the cars and turns "universal" off.
        <CompatibilityModal
          key={`${fitmentFor._id}-${carBrands ? 'ready' : 'loading'}`}
          row={fitmentFor}
          refs={{ metadata: { carBrands: carBrands || [] } }}
          onSave={(patch) => saveFitment(fitmentFor, patch)}
          onClose={() => setFitmentFor(null)}
        />
      )}
    </div>
  );
}
