'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, Bell, CheckCircle2, XCircle, Search, CheckCheck, RefreshCw, LayoutGrid, Store, Calendar,
  Pencil, MoreHorizontal, Undo2, Rows3, Keyboard, Wrench, AlertTriangle, Zap, X, Car,
} from 'lucide-react';
import { adminApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import ProductViewMenu from '../../../../components/dashboard/ProductViewMenu';
import ReviewPanel from '../../../../components/dashboard/review/ReviewPanel';
import BulkFixModal from '../../../../components/dashboard/review/BulkFixModal';
import ReviewGrid from '../../../../components/dashboard/review/ReviewGrid';
import { formatLocalizedDate } from '../../../../lib/dateFormat';
import { resolvePricing } from '../../../../lib/productPricing';
import { thumbUrl, resolveAssetUrl } from '../../../../lib/assets';
import { ISSUE_LABELS, issueLabel, categoryParents, isUnder, inType, flattenTree } from '../../../../lib/productReview';

/*
 * "Pending approval": the review of vendors' new products. Ready Marine corrects what is wrong
 * and publishes — it does not turn vendors away — so the screen is built for that:
 *   - filters (vendor, category, type, fitment, problems, upload day) to split the clean
 *     products from the ones that need correcting;
 *   - every card says what is wrong with it (Backend services/productReviewService.js);
 *   - tick many, then correct them in one step (category, part type, fitting cars) and
 *     publish them — or publish them as they are;
 *   - a side panel to correct one and "publish → next" without leaving the list;
 *   - a sheet view to correct titles, prices and categories row after row;
 *   - keyboard: J/K move, E edit, A publish, X tick;
 *   - a trusted vendor can be set to publish without review, from here.
 * Each vendor is told once what went live and what was corrected on it.
 */

const SELECT = 'bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm text-zinc-800 dark:text-white focus:border-marine-cyan focus:outline-none';
const VIEW_KEY = 'readycar.review.view';

const DEFAULT_FILTERS = { search: '', vendor: '', category: '', type: '', fitment: 'all', issue: 'all', uploaded: 'all', sort: 'newest' };

const effective = (r) => Number(r.discount_price ?? r.price) || 0;

/** Price the seller will charge, with the regular price struck through beside it. */
function ProductPrice({ row, currency }) {
  const { price, original, hasDiscount } = resolvePricing(row.price, row.discount_price);
  return (
    <span className="font-bold text-zinc-600 dark:text-zinc-300">
      {currency} {price.toLocaleString()}
      {hasDiscount && <span className="text-zinc-400 line-through ms-1">{original.toLocaleString()}</span>}
    </span>
  );
}

/** The "…" menu: sending a product back to the vendor as a draft (rare: a duplicate, say). */
function MoreMenu({ isAr, onReturn, busy }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative" onBlur={() => setTimeout(() => setOpen(false), 150)}>
      <button type="button" onClick={() => setOpen((o) => !o)} title={isAr ? 'المزيد' : 'More'}
        className="w-full h-full flex items-center justify-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-zinc-50 dark:bg-white/5 text-zinc-500 hover:text-zinc-800 dark:hover:text-white">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <MoreHorizontal size={14} />}{isAr ? 'المزيد' : 'More'}
      </button>
      {open && (
        <div className="absolute bottom-full mb-1 end-0 z-20 w-56 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#1A1D20] p-1 shadow-xl">
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setOpen(false); onReturn(); }}
            className="w-full text-start flex items-start gap-2 rounded-lg px-3 py-2 hover:bg-zinc-100 dark:hover:bg-white/5">
            <Undo2 size={14} className="mt-0.5 text-zinc-500 shrink-0" />
            <span>
              <span className="block text-xs font-bold text-zinc-800 dark:text-white">{isAr ? 'رجّعه للتاجر كمسودة' : 'Return to the vendor as a draft'}</span>
              <span className="block text-[10px] text-zinc-500">{isAr ? 'للحالات النادرة زي منتج متكرر.' : 'For rare cases, such as a duplicate.'}</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

/** One waiting product. */
function ReviewCard({ row, isAr, currency, language, selected, focused, busy, onToggle, onEdit, onPublish, onReturn, cardRef }) {
  const title = isAr ? (row.title_ar || row.title_en) : (row.title_en || row.title_ar);
  const ready = row.issues.length === 0;
  return (
    <div ref={cardRef}
      className={`bg-white dark:bg-[#14171A] border rounded-2xl overflow-hidden shadow-sm transition-all ${selected ? 'border-marine-cyan ring-2 ring-marine-cyan/20' : 'border-zinc-200 dark:border-white/5'} ${focused ? 'outline outline-2 outline-offset-2 outline-sky-400' : ''}`}>
      <div className="relative aspect-[4/3] bg-zinc-100 dark:bg-[#0E1012] overflow-hidden">
        {row.image
          ? <img src={thumbUrl(resolveAssetUrl(row.image), 480)} loading="lazy" decoding="async" alt={title || ''} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center"><LayoutGrid size={32} className="text-zinc-300 dark:text-zinc-600" /></div>}
        <label className="absolute top-3 start-3 flex items-center justify-center w-8 h-8 rounded-lg bg-white/90 dark:bg-black/60 cursor-pointer shadow">
          <input type="checkbox" checked={selected} onChange={() => onToggle(row._id)} className="w-4 h-4 accent-marine-cyan" aria-label={isAr ? 'تحديد' : 'Select'} />
        </label>
        <span className={`absolute top-3 end-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black ${ready ? 'bg-emerald-500 text-white' : 'bg-amber-400 text-zinc-900'}`}>
          {ready ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
          {ready ? (isAr ? 'جاهز للنشر' : 'Ready') : (isAr ? `${row.issues.length} محتاج تصليح` : `${row.issues.length} to fix`)}
        </span>
        {row.images_count > 1 && <span className="absolute bottom-3 end-3 bg-black/60 text-white text-[10px] font-bold px-2 py-1 rounded-lg">+{row.images_count - 1}</span>}
      </div>

      <div className="p-4">
        <h3 className="font-black text-zinc-900 dark:text-white text-sm leading-snug line-clamp-2 mb-1">{title || (isAr ? 'منتج بدون عنوان' : 'Untitled')}</h3>
        <p className="text-[11px] font-bold text-zinc-400 mb-2">SKU: {row.sku || '—'}{row.part_number ? ` · ${row.part_number}` : ''}</p>

        {!ready && (
          <div className="flex flex-wrap gap-1 mb-3">
            {row.issues.map((code) => <span key={code} className="rounded-full bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-300">{issueLabel(code, isAr)}</span>)}
          </div>
        )}

        <div className="space-y-1.5 text-xs mb-3">
          <p className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300 font-bold truncate"><Store size={12} className="text-marine-primary shrink-0" />{row.vendor?.store_name || '—'}</p>
          <p className="text-zinc-500 truncate">{row.category ? (isAr ? (row.category.name_ar || row.category.name) : row.category.name) : (isAr ? 'من غير فئة' : 'No category')}</p>
          <p className="flex items-center gap-1.5 text-zinc-500 truncate"><Car size={12} className="shrink-0" />
            {row.is_universal ? (isAr ? 'عام: أي عربية' : 'Universal') : (row.cars.length ? row.cars.join('، ') : (isAr ? 'من غير توافق' : 'No fitment'))}
          </p>
          {/* The cars the title names that the fitment lacks — the edit fixes them. */}
          {row.fitment_hint?.length > 0 && (
            <p className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400 font-bold truncate" title={row.fitment_hint.join('، ')}>
              <AlertTriangle size={12} className="shrink-0" />
              {isAr ? `العنوان بيذكر: ${row.fitment_hint.join('، ')}` : `Title names: ${row.fitment_hint.join(', ')}`}
            </p>
          )}
          <div className="flex items-center justify-between">
            <ProductPrice row={row} currency={currency} />
            <span className="flex items-center gap-1 text-zinc-400 font-bold"><Calendar size={11} />{formatLocalizedDate(row.created_at, isAr, { month: 'short', day: 'numeric' })}</span>
          </div>
        </div>

        {/* Correct and publish first; looking and the rare "return" after. */}
        <div className="grid grid-cols-2 gap-2 pt-3 border-t border-zinc-100 dark:border-white/5">
          <button type="button" onClick={() => onEdit(row._id)}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-marine-cyan/30 text-marine-primary hover:bg-red-50 dark:hover:bg-red-500/10">
            <Pencil size={14} />{isAr ? 'تعديل سريع' : 'Quick edit'}
          </button>
          <button type="button" onClick={() => onPublish(row._id)} disabled={busy}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}{isAr ? 'نشر' : 'Publish'}
          </button>
          <div className="[&>div>button]:w-full [&>div>button]:justify-center [&>div>button]:whitespace-nowrap [&>div>button]:bg-zinc-50 dark:[&>div>button]:bg-white/5">
            <ProductViewMenu product={{ ...row, status: 'pending' }} reviewHref={`/admin/dashboard/products/${row._id}`} language={language} compact />
          </div>
          <MoreMenu isAr={isAr} busy={false} onReturn={() => onReturn(row._id)} />
        </div>
      </div>
    </div>
  );
}

/** A labelled select in the filter bar. */
function FilterSelect({ label, value, onChange, children }) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={SELECT}>{children}</select>
    </label>
  );
}

export default function PendingProductsPage() {
  const { language, siteSettings } = useApp();
  const isAr = language === 'ar';
  const currency = siteSettings?.currency || 'EGP';

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [metadata, setMetadata] = useState(null);
  const [carBrands, setCarBrands] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [view, setView] = useState('cards');
  const [selected, setSelected] = useState(() => new Set());
  const [panelId, setPanelId] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [busyAll, setBusyAll] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const cardRefs = useRef(new Map());

  const showToast = (type, message) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const loadQueue = useCallback(async () => {
    try {
      const data = await adminApi.getReviewQueue();
      setRows(data.products || []);
    } catch {
      showToast('error', isAr ? 'تعذر تحميل المنتجات المستنية' : 'Could not load the waiting products');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAr]);

  useEffect(() => { loadQueue(); }, [loadQueue]);
  useEffect(() => {
    adminApi.getFilterMetadata(['categories', 'productBrands', 'productTypes']).then(setMetadata).catch(() => setMetadata({}));
    try { const v = localStorage.getItem(VIEW_KEY); if (v === 'grid' || v === 'cards') setView(v); } catch (_) { /* private mode */ }
  }, []);

  const loadCarBrands = useCallback(() => {
    if (carBrands) return;
    adminApi.getFilterMetadata(['carBrands'], { detail: 'full' }).then((m) => setCarBrands(m.carBrands || [])).catch(() => setCarBrands([]));
  }, [carBrands]);

  const pickView = (v) => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch (_) { /* private mode */ }
  };

  /* ---- Filters ---- */
  const parents = useMemo(() => categoryParents(metadata?.categories || []), [metadata?.categories]);
  const flatCategories = useMemo(() => flattenTree(metadata?.categories || []), [metadata?.categories]);
  const types = metadata?.productTypes || [];
  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const type = types.find((t) => String(t._id) === String(filters.type));
    const dayMs = 86400000;
    const now = Date.now();
    const out = rows.filter((r) => {
      if (q && ![r.title_ar, r.title_en, r.sku, r.part_number, r.vendor?.store_name].some((v) => String(v || '').toLowerCase().includes(q))) return false;
      if (filters.vendor && String(r.vendor?._id) !== filters.vendor) return false;
      if (filters.category && !isUnder(parents, r.category?._id, filters.category)) return false;
      if (type && !inType(parents, r.category?._id, type)) return false;
      if (filters.fitment === 'universal' && !r.is_universal) return false;
      if (filters.fitment === 'cars' && (r.is_universal || !r.cars.length)) return false;
      if (filters.fitment === 'none' && (r.is_universal || r.cars.length)) return false;
      if (filters.issue === 'ready' && r.issues.length) return false;
      if (filters.issue === 'issues' && !r.issues.length) return false;
      if (ISSUE_LABELS[filters.issue] && !r.issues.includes(filters.issue)) return false;
      const age = now - new Date(r.created_at).getTime();
      if (filters.uploaded === 'today' && age > dayMs) return false;
      if (filters.uploaded === 'week' && age > 7 * dayMs) return false;
      return true;
    });
    const sorters = {
      newest: (a, b) => new Date(b.created_at) - new Date(a.created_at),
      oldest: (a, b) => new Date(a.created_at) - new Date(b.created_at),
      vendor: (a, b) => String(a.vendor?.store_name || '').localeCompare(String(b.vendor?.store_name || '')),
      issues: (a, b) => b.issues.length - a.issues.length,
      price_high: (a, b) => effective(b) - effective(a),
      price_low: (a, b) => effective(a) - effective(b),
    };
    return out.sort(sorters[filters.sort] || sorters.newest);
  }, [rows, filters, parents, types]);

  // Counts for the filter options (over everything waiting).
  const counts = useMemo(() => {
    const vendors = new Map();
    const issues = {};
    let ready = 0;
    for (const r of rows) {
      const v = r.vendor?._id ? String(r.vendor._id) : '';
      if (!vendors.has(v)) vendors.set(v, { ...r.vendor, count: 0 });
      vendors.get(v).count += 1;
      if (!r.issues.length) ready += 1;
      for (const code of r.issues) issues[code] = (issues[code] || 0) + 1;
    }
    return { vendors: [...vendors.values()].sort((a, b) => b.count - a.count), issues, ready };
  }, [rows]);

  const filtersOn = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);
  const selectedVendor = counts.vendors.find((v) => String(v._id) === filters.vendor);

  /* ---- Selection ---- */
  const toggle = useCallback((id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const allShownSelected = filtered.length > 0 && filtered.every((r) => selected.has(r._id));
  const toggleAllShown = () => setSelected((s) => {
    const n = new Set(s);
    if (allShownSelected) filtered.forEach((r) => n.delete(r._id));
    else filtered.forEach((r) => n.add(r._id));
    return n;
  });
  // Ticks only count products still waiting.
  const selectedIds = useMemo(() => rows.filter((r) => selected.has(r._id)).map((r) => r._id), [rows, selected]);

  const dropRows = (ids) => {
    const gone = new Set(ids.map(String));
    setRows((prev) => prev.filter((r) => !gone.has(String(r._id))));
    setSelected((s) => { const n = new Set(s); gone.forEach((id) => n.delete(id)); return n; });
  };

  /* ---- Actions ---- */
  const publish = async (ids, { quiet = false } = {}) => {
    const res = await adminApi.approveProducts(ids);
    dropRows(res.approved || ids);
    if (!quiet) showToast('success', isAr ? `اتنشر ${res.approved?.length ?? ids.length} منتج` : `${res.approved?.length ?? ids.length} published`);
    return res;
  };

  const publishOne = async (id) => {
    setBusyId(id);
    try { await publish([id]); } catch (err) { showToast('error', err.message || (isAr ? 'تعذر النشر' : 'Could not publish')); } finally { setBusyId(null); }
  };

  const publishSelected = async () => {
    if (!selectedIds.length) return;
    if (!confirm(isAr ? `نشر ${selectedIds.length} منتج زي ما هما؟` : `Publish ${selectedIds.length} products as they are?`)) return;
    setBusyAll(true);
    try { await publish(selectedIds); } catch (err) { showToast('error', err.message); } finally { setBusyAll(false); }
  };

  const publishReadyShown = async () => {
    const ids = filtered.filter((r) => !r.issues.length).map((r) => r._id);
    if (!ids.length) return;
    if (!confirm(isAr ? `نشر ${ids.length} منتج جاهز (مفيش عليهم أي علامة)؟` : `Publish ${ids.length} ready products (no warnings)?`)) return;
    setBusyAll(true);
    try { await publish(ids); } catch (err) { showToast('error', err.message); } finally { setBusyAll(false); }
  };

  const returnToVendor = async (id) => {
    if (!confirm(isAr ? 'ترجّع المنتج ده للتاجر كمسودة؟ (مش هيتنشر لحد ما التاجر يبعته تاني)' : 'Return this product to the vendor as a draft? (It will not be published until the vendor submits it again.)')) return;
    setBusyId(id);
    try {
      await adminApi.rejectProduct(id);
      dropRows([id]);
      showToast('success', isAr ? 'رجع للتاجر كمسودة' : 'Returned to the vendor as a draft');
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setBusyId(null);
    }
  };

  const applyBulk = async (set, publishToo) => {
    const res = await adminApi.bulkFixProducts({ ids: selectedIds, set, publish: publishToo });
    setBulkOpen(false);
    if (publishToo) dropRows(res.published_ids || []);
    await loadQueue();
    showToast('success', publishToo
      ? (isAr ? `اتصلّح ${res.updated} واتنشر ${res.published} منتج` : `${res.updated} corrected, ${res.published} published`)
      : (isAr ? `اتصلّح ${res.updated} منتج` : `${res.updated} corrected`));
  };

  const enableAutoPublish = async (vendor) => {
    if (!confirm(isAr
      ? `تفعيل النشر التلقائي لـ ${vendor.store_name}؟ منتجاته الجديدة هتتنشر على طول من غير ما تعدّي على المراجعة.`
      : `Turn on auto-publish for ${vendor.store_name}? Their new products will go live without review.`)) return;
    try {
      await adminApi.updateVendor(vendor._id, { auto_publish_products: true });
      setRows((prev) => prev.map((r) => (String(r.vendor?._id) === String(vendor._id) ? { ...r, vendor: { ...r.vendor, auto_publish_products: true } } : r)));
      showToast('success', isAr ? `النشر التلقائي اتفعّل لـ ${vendor.store_name}. المنتجات اللي مستنية لسه محتاجة نشر.` : `Auto-publish is on for ${vendor.store_name}. The ones already waiting still need publishing.`);
    } catch (err) {
      showToast('error', err.message);
    }
  };

  /* ---- The side panel ---- */
  const panelIndex = panelId ? filtered.findIndex((r) => r._id === panelId) : -1;
  const panelRow = panelIndex >= 0 ? filtered[panelIndex] : rows.find((r) => r._id === panelId);
  const navigate = (step) => {
    if (!filtered.length) return;
    const from = panelIndex >= 0 ? panelIndex : 0;
    const next = filtered[Math.min(filtered.length - 1, Math.max(0, from + step))];
    if (next) setPanelId(next._id);
  };
  const onPanelPublished = (id) => {
    const idx = filtered.findIndex((r) => r._id === id);
    const nextRow = filtered[idx + 1] || filtered[idx - 1] || null;
    dropRows([id]);
    showToast('success', isAr ? 'اتنشر' : 'Published');
    setPanelId(nextRow && nextRow._id !== id ? nextRow._id : null);
  };

  /* ---- Keyboard on the list ---- */
  useEffect(() => {
    const onKey = (e) => {
      if (panelId || bulkOpen || view !== 'cards') return;
      const tag = (e.target?.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const current = filtered[focusIdx];
      if (k === 'j' || k === 'k') {
        e.preventDefault();
        const next = Math.min(filtered.length - 1, Math.max(0, (focusIdx < 0 ? -1 : focusIdx) + (k === 'j' ? 1 : -1)));
        setFocusIdx(next);
        cardRefs.current.get(filtered[next]?._id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else if ((k === 'e' || k === 'enter') && current) { e.preventDefault(); setPanelId(current._id); }
      else if (k === 'a' && current) { e.preventDefault(); publishOne(current._id); }
      else if (k === 'x' && current) { e.preventDefault(); toggle(current._id); }
      else if (k === '?') { setHelpOpen((o) => !o); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const readyShown = filtered.filter((r) => !r.issues.length).length;

  return (
    <div className="h-full flex flex-col animate-in fade-in duration-300 pb-24">
      {toast && (
        <div className={`fixed top-6 end-6 z-[100] flex items-center gap-3 px-5 py-4 rounded-2xl shadow-2xl text-sm font-bold ${toast.type === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'}`}>
          {toast.type === 'success' ? <CheckCircle2 size={18} /> : <XCircle size={18} />}{toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-5">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-amber-500 flex items-center justify-center"><Bell size={20} /></div>
            <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-wide">{isAr ? 'المنتجات المعلقة' : 'Pending Approval'}</h1>
          </div>
          <p className="text-sm text-zinc-500 mt-1">{isAr ? 'صلّح المنتجات الجديدة للتجار وانشرها.' : "Correct vendors' new products and publish them."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-xl px-4 py-2 text-center">
            <p className="text-[11px] font-bold text-zinc-500">{isAr ? 'مستني' : 'Waiting'}</p>
            <p className="text-xl font-black text-amber-500">{rows.length}</p>
          </div>
          <button type="button" onClick={() => setFilters({ ...DEFAULT_FILTERS, issue: 'ready' })} className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-xl px-4 py-2 text-center hover:border-emerald-400">
            <p className="text-[11px] font-bold text-zinc-500">{isAr ? 'جاهز للنشر' : 'Ready'}</p>
            <p className="text-xl font-black text-emerald-500">{counts.ready}</p>
          </button>
          <button type="button" onClick={() => setFilters({ ...DEFAULT_FILTERS, issue: 'issues' })} className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-xl px-4 py-2 text-center hover:border-amber-400">
            <p className="text-[11px] font-bold text-zinc-500">{isAr ? 'محتاج تصليح' : 'To fix'}</p>
            <p className="text-xl font-black text-amber-600">{rows.length - counts.ready}</p>
          </button>
          <div className="flex rounded-xl border border-zinc-200 dark:border-white/10 overflow-hidden">
            <button type="button" onClick={() => pickView('cards')} className={`px-3 py-2.5 ${view === 'cards' ? 'bg-marine-cyan text-white' : 'text-zinc-500'}`} title={isAr ? 'كروت' : 'Cards'}><LayoutGrid size={16} /></button>
            <button type="button" onClick={() => pickView('grid')} className={`px-3 py-2.5 ${view === 'grid' ? 'bg-marine-cyan text-white' : 'text-zinc-500'}`} title={isAr ? 'جدول' : 'Sheet'}><Rows3 size={16} /></button>
          </div>
          <button type="button" onClick={() => setHelpOpen((o) => !o)} className="p-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-500" title={isAr ? 'اختصارات الكيبورد' : 'Keyboard shortcuts'}><Keyboard size={16} /></button>
          <button type="button" onClick={() => { setLoading(true); loadQueue(); }} className="p-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-500" title={isAr ? 'تحديث' : 'Refresh'}><RefreshCw size={16} /></button>
        </div>
      </div>

      {helpOpen && (
        <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 dark:bg-sky-500/10 dark:border-sky-500/20 p-3 text-xs text-sky-900 dark:text-sky-200 flex flex-wrap gap-x-5 gap-y-1">
          <span><b>J / K</b> {isAr ? 'التالي / السابق' : 'next / previous'}</span>
          <span><b>E</b> {isAr ? 'تعديل سريع' : 'quick edit'}</span>
          <span><b>A</b> {isAr ? 'نشر' : 'publish'}</span>
          <span><b>X</b> {isAr ? 'تحديد' : 'tick'}</span>
          <span><b>Ctrl+Enter</b> {isAr ? 'في اللوحة: حفظ ونشر والتالي' : 'in the panel: save, publish, next'}</span>
          <span><b>Alt+↓ / Alt+↑</b> {isAr ? 'في اللوحة: التالي / السابق' : 'in the panel: next / previous'}</span>
          <span><b>Esc</b> {isAr ? 'إغلاق اللوحة' : 'close the panel'}</span>
        </div>
      )}

      {/* Filters */}
      {rows.length > 0 && (
        <div className="bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl p-3 mb-4 space-y-3">
          <div className="relative">
            <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input type="text" value={filters.search} onChange={(e) => setFilter('search', e.target.value)}
              placeholder={isAr ? 'ابحث بالعنوان، SKU، رقم القطعة أو التاجر' : 'Search title, SKU, part number or vendor'}
              className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl ps-9 pe-3 py-2.5 text-sm focus:border-marine-cyan focus:outline-none dark:text-white" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
            <FilterSelect label={isAr ? 'التاجر' : 'Vendor'} value={filters.vendor} onChange={(v) => setFilter('vendor', v)}>
              <option value="">{isAr ? 'كل التجار' : 'All vendors'}</option>
              {counts.vendors.map((v) => <option key={v._id || 'none'} value={v._id || ''}>{v.store_name} ({v.count})</option>)}
            </FilterSelect>
            <FilterSelect label={isAr ? 'المشاكل' : 'Problems'} value={filters.issue} onChange={(v) => setFilter('issue', v)}>
              <option value="all">{isAr ? 'الكل' : 'All'}</option>
              <option value="ready">{isAr ? `جاهز للنشر (${counts.ready})` : `Ready (${counts.ready})`}</option>
              <option value="issues">{isAr ? `محتاج تصليح (${rows.length - counts.ready})` : `To fix (${rows.length - counts.ready})`}</option>
              {Object.keys(ISSUE_LABELS).filter((c) => counts.issues[c]).map((c) => <option key={c} value={c}>{issueLabel(c, isAr)} ({counts.issues[c]})</option>)}
            </FilterSelect>
            <FilterSelect label={isAr ? 'التوافق' : 'Fitment'} value={filters.fitment} onChange={(v) => setFilter('fitment', v)}>
              <option value="all">{isAr ? 'الكل' : 'All'}</option>
              <option value="universal">{isAr ? 'عام (أي عربية)' : 'Universal'}</option>
              <option value="cars">{isAr ? 'لعربيات محددة' : 'Specific cars'}</option>
              <option value="none">{isAr ? 'من غير توافق' : 'No fitment'}</option>
            </FilterSelect>
            <FilterSelect label={isAr ? 'نوع المنتج' : 'Product type'} value={filters.type} onChange={(v) => setFilter('type', v)}>
              <option value="">{isAr ? 'كل الأنواع' : 'All types'}</option>
              {types.map((t) => <option key={t._id} value={t._id}>{isAr ? (t.name_ar || t.name) : t.name}</option>)}
            </FilterSelect>
            <FilterSelect label={isAr ? 'الفئة' : 'Category'} value={filters.category} onChange={(v) => setFilter('category', v)}>
              <option value="">{isAr ? 'كل الفئات' : 'All categories'}</option>
              {flatCategories.map((c) => <option key={c._id} value={c._id}>{'  '.repeat(c.level)}{isAr ? (c.name_ar || c.name) : c.name}</option>)}
            </FilterSelect>
            <FilterSelect label={isAr ? 'اترفع' : 'Uploaded'} value={filters.uploaded} onChange={(v) => setFilter('uploaded', v)}>
              <option value="all">{isAr ? 'أي وقت' : 'Any time'}</option>
              <option value="today">{isAr ? 'آخر 24 ساعة' : 'Last 24 hours'}</option>
              <option value="week">{isAr ? 'آخر 7 أيام' : 'Last 7 days'}</option>
            </FilterSelect>
            <FilterSelect label={isAr ? 'الترتيب' : 'Sort'} value={filters.sort} onChange={(v) => setFilter('sort', v)}>
              <option value="newest">{isAr ? 'الأحدث' : 'Newest'}</option>
              <option value="oldest">{isAr ? 'الأقدم' : 'Oldest'}</option>
              <option value="issues">{isAr ? 'الأكتر مشاكل' : 'Most problems'}</option>
              <option value="vendor">{isAr ? 'التاجر' : 'Vendor'}</option>
              <option value="price_high">{isAr ? 'الأغلى' : 'Price: high'}</option>
              <option value="price_low">{isAr ? 'الأرخص' : 'Price: low'}</option>
            </FilterSelect>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-bold text-zinc-500">{isAr ? `ظاهر ${filtered.length} من ${rows.length}` : `Showing ${filtered.length} of ${rows.length}`}</span>
            {filtersOn && <button type="button" onClick={() => setFilters(DEFAULT_FILTERS)} className="inline-flex items-center gap-1 font-bold text-marine-primary hover:underline"><X size={12} />{isAr ? 'مسح الفلاتر' : 'Clear filters'}</button>}
            <button type="button" onClick={toggleAllShown} disabled={!filtered.length} className="font-bold text-zinc-600 dark:text-zinc-300 hover:text-marine-primary disabled:opacity-40">
              {allShownSelected ? (isAr ? 'إلغاء تحديد المعروض' : 'Untick the shown') : (isAr ? `تحديد كل المعروض (${filtered.length})` : `Tick all shown (${filtered.length})`)}
            </button>
            {readyShown > 0 && (
              <button type="button" onClick={publishReadyShown} disabled={busyAll} className="ms-auto inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 font-bold disabled:opacity-50">
                {busyAll ? <Loader2 size={13} className="animate-spin" /> : <CheckCheck size={13} />}{isAr ? `نشر الجاهز من المعروض (${readyShown})` : `Publish the ready shown (${readyShown})`}
              </button>
            )}
          </div>
          {selectedVendor && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-zinc-50 dark:bg-white/[0.03] border border-zinc-100 dark:border-white/5 p-2.5 text-xs">
              <Zap size={14} className="text-amber-500" />
              {selectedVendor.auto_publish_products
                ? <span className="font-bold text-emerald-600">{isAr ? `${selectedVendor.store_name}: النشر التلقائي شغال — منتجاته الجديدة بتتنشر من غير مراجعة.` : `${selectedVendor.store_name}: auto-publish is on.`}</span>
                : (
                  <>
                    <span className="text-zinc-600 dark:text-zinc-300">{isAr ? `واثق في بيانات ${selectedVendor.store_name}؟ خلّي منتجاته الجديدة تتنشر من غير مراجعة.` : `Trust ${selectedVendor.store_name}'s data? Let their new products go live without review.`}</span>
                    <button type="button" onClick={() => enableAutoPublish(selectedVendor)} className="font-bold text-marine-primary hover:underline">{isAr ? 'فعّل النشر التلقائي' : 'Turn on auto-publish'}</button>
                  </>
                )}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center py-24"><Loader2 size={36} className="text-marine-primary animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-24">
          <div className="w-20 h-20 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-400 rounded-3xl flex items-center justify-center mb-5"><CheckCircle2 size={40} /></div>
          <h2 className="text-xl font-black text-zinc-900 dark:text-white mb-2">{rows.length ? (isAr ? 'مفيش منتجات بالفلاتر دي' : 'Nothing matches these filters') : (isAr ? 'لا توجد منتجات معلقة' : 'All Caught Up!')}</h2>
          <p className="text-zinc-500 text-sm text-center max-w-sm">
            {rows.length
              ? <button type="button" onClick={() => setFilters(DEFAULT_FILTERS)} className="text-marine-primary font-bold hover:underline">{isAr ? 'مسح الفلاتر' : 'Clear filters'}</button>
              : (isAr ? 'لا توجد منتجات بانتظار الموافقة. كل المنتجات اتراجعت، شغل عظيم!' : 'No products are waiting for approval.')}
          </p>
        </div>
      ) : view === 'grid' ? (
        <ReviewGrid rows={filtered} selected={selected} onToggle={toggle} onToggleAll={toggleAllShown} flatCategories={flatCategories} isAr={isAr}
          onOpen={setPanelId}
          onDone={async (ids, published) => {
            if (published) dropRows(ids);
            await loadQueue();
            if (ids.length) showToast('success', published ? (isAr ? `اتحفظ واتنشر ${ids.length} منتج` : `${ids.length} saved and published`) : (isAr ? `اتحفظ ${ids.length} منتج` : `${ids.length} saved`));
          }} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {filtered.map((row, i) => (
            <ReviewCard key={row._id} row={row} isAr={isAr} currency={currency} language={language}
              selected={selected.has(row._id)} focused={i === focusIdx} busy={busyId === row._id}
              onToggle={toggle} onEdit={(id) => { setFocusIdx(i); setPanelId(id); }} onPublish={publishOne} onReturn={returnToVendor}
              cardRef={(node) => { if (node) cardRefs.current.set(row._id, node); else cardRefs.current.delete(row._id); }} />
          ))}
        </div>
      )}

      {/* What to do with the ticked ones */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-4 inset-x-4 lg:start-[19rem] z-[60] flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-200 dark:border-white/10 bg-white/95 dark:bg-[#14171A]/95 backdrop-blur p-3 shadow-2xl">
          <span className="text-sm font-black text-zinc-900 dark:text-white me-auto">{isAr ? `${selectedIds.length} محدد` : `${selectedIds.length} selected`}</span>
          <button type="button" onClick={() => setSelected(new Set())} className="px-3 py-2 rounded-xl text-xs font-bold text-zinc-500 hover:text-red-500">{isAr ? 'إلغاء التحديد' : 'Clear'}</button>
          <button type="button" onClick={() => setBulkOpen(true)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-marine-cyan/30 text-marine-primary text-xs font-bold hover:bg-red-50 dark:hover:bg-red-500/10">
            <Wrench size={14} />{isAr ? 'تصليح المحدد…' : 'Correct the selected…'}
          </button>
          <button type="button" onClick={publishSelected} disabled={busyAll} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50">
            {busyAll ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />}{isAr ? 'نشر المحدد' : 'Publish the selected'}
          </button>
        </div>
      )}

      {panelId && panelRow && (
        <ReviewPanel row={panelRow} position={panelIndex >= 0 ? panelIndex + 1 : 1} total={filtered.length || 1}
          metadata={metadata} carBrands={carBrands} loadCarBrands={loadCarBrands} isAr={isAr}
          onClose={() => setPanelId(null)} onNavigate={navigate}
          onSaved={() => { loadQueue(); showToast('success', isAr ? 'اتحفظ' : 'Saved'); }}
          onPublished={onPanelPublished} />
      )}

      {bulkOpen && (
        <BulkFixModal count={selectedIds.length} metadata={metadata} carBrands={carBrands} loadCarBrands={loadCarBrands} isAr={isAr}
          onClose={() => setBulkOpen(false)} onApply={applyBulk} />
      )}
    </div>
  );
}
