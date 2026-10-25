'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Save, Search, Send, X } from 'lucide-react';
import { adminApi } from '../../lib/api';
import { searchOptions } from '../../lib/searchSuggest';
import { useApp } from '../../context/AppContext';

const inputCls = 'w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white';

const scopeOptions = [
  { value: 'all_products', label: 'All Products' },
  { value: 'category_tree', label: 'Category Tree' },
  { value: 'product_list', label: 'Product List' },
  { value: 'vendor_list', label: 'Vendor List' },
];

const discountTypeOptions = [
  { value: 'percent', label: 'Percent (%)' },
  { value: 'fixed', label: 'Fixed Amount' },
];

/* ─── helpers ─── */
function normalizeIds(v) {
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  if (!v) return [];
  return String(v).split(',').map(s => s.trim()).filter(Boolean);
}

function toLocal(val) {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d)) return '';
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/* ─── flatten category tree ─── */
function flattenTree(nodes = [], depth = 0, acc = []) {
  nodes.forEach(n => {
    acc.push({ ...n, depth });
    if (n.subcategories?.length) flattenTree(n.subcategories, depth + 1, acc);
  });
  return acc;
}

/* collect all descendant IDs of a node (inclusive) */
function collectIds(node) {
  const ids = [String(node._id)];
  (node.subcategories || []).forEach(c => ids.push(...collectIds(c)));
  return ids;
}

/* ─── CategoryTreePicker ─── */
function CategoryTreePicker({ tree, selected, onChange }) {
  const [open, setOpen] = useState({});

  const toggle = (id) => setOpen(p => ({ ...p, [id]: !p[id] }));

  const isChecked = (node) => {
    const ids = collectIds(node);
    return ids.every(id => selected.includes(id));
  };
  const isIndeterminate = (node) => {
    const ids = collectIds(node);
    const some = ids.some(id => selected.includes(id));
    return some && !isChecked(node);
  };

  const handleCheck = (node, checked) => {
    const ids = collectIds(node);
    if (checked) {
      onChange([...new Set([...selected, ...ids])]);
    } else {
      onChange(selected.filter(id => !ids.includes(id)));
    }
  };

  const renderNode = (node) => {
    const hasChildren = node.subcategories?.length > 0;
    const expanded = open[node._id];
    const checked = isChecked(node);
    const indet = isIndeterminate(node);

    return (
      <div key={node._id} className="select-none">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-white/[0.03] transition-colors">
          {hasChildren ? (
            <button type="button" onClick={() => toggle(node._id)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-white flex-shrink-0">
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : (
            <span className="w-[13px] flex-shrink-0" />
          )}
          <input
            type="checkbox"
            checked={checked}
            ref={el => { if (el) el.indeterminate = indet; }}
            onChange={e => handleCheck(node, e.target.checked)}
            className="w-3.5 h-3.5 accent-marine-cyan flex-shrink-0 cursor-pointer"
          />
          <span className="text-sm text-zinc-800 dark:text-zinc-200 font-medium truncate">{node.name}</span>
          {node.name_ar && <span className="text-xs text-zinc-400 truncate">{node.name_ar}</span>}
        </div>
        {hasChildren && expanded && (
          <div className="ms-6 border-s border-zinc-100 dark:border-white/5">
            {node.subcategories.map(renderNode)}
          </div>
        )}
      </div>
    );
  };

  if (!tree.length) return <p className="text-sm text-zinc-400">No categories found.</p>;

  return (
    <div className="border border-zinc-200 dark:border-white/10 rounded-xl overflow-hidden">
      <div className="max-h-64 overflow-y-auto p-2 space-y-0.5">
        {tree.map(renderNode)}
      </div>
      {selected.length > 0 && (
        <div className="border-t border-zinc-100 dark:border-white/5 px-3 py-2 flex flex-wrap gap-1.5">
          {selected.map(id => {
            const flat = flattenTree(tree);
            const cat = flat.find(c => String(c._id) === id);
            return cat ? (
              <span key={id} className="inline-flex items-center gap-1 text-xs bg-marine-cyan/10 text-marine-primary rounded-full px-2 py-0.5 font-semibold">
                {cat.name}
                <button type="button" onClick={() => onChange(selected.filter(s => s !== id))} className="hover:text-red-500"><X size={10} /></button>
              </span>
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}

/* ─── SearchableMultiSelect ─── */
function SearchableMultiSelect({ items, selected, onChange, getLabel, getId, placeholder }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Best match first; each typed word has to start a word (lib/searchSuggest).
  const filtered = useMemo(() => searchOptions(items, q, (i) => [getLabel(i)]), [items, q, getLabel]);

  const toggle = (id) => {
    onChange(selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]);
  };

  return (
    <div ref={ref} className="relative">
      <div
        onClick={() => setOpen(o => !o)}
        className="w-full min-h-[38px] bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 flex flex-wrap gap-1.5 cursor-pointer"
      >
        {selected.length === 0 && <span className="text-sm text-zinc-400">{placeholder}</span>}
        {selected.map(id => {
          const item = items.find(i => getId(i) === id);
          return item ? (
            <span key={id} className="inline-flex items-center gap-1 text-xs bg-marine-cyan/10 text-marine-primary rounded-full px-2 py-0.5 font-semibold">
              {getLabel(item)}
              <button type="button" onClick={e => { e.stopPropagation(); toggle(id); }} className="hover:text-red-500"><X size={10} /></button>
            </span>
          ) : null;
        })}
        <ChevronDown size={14} className={`ms-auto text-zinc-400 flex-shrink-0 mt-0.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>

      {open && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/10 rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-zinc-100 dark:border-white/5">
            <div className="relative">
              <Search size={13} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                autoFocus
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search…"
                className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg ps-8 pe-3 py-1.5 text-sm focus:outline-none focus:border-marine-cyan dark:text-white"
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0
              ? <p className="text-sm text-zinc-400 px-3 py-3">No results</p>
              : filtered.map(item => {
                  const id = getId(item);
                  const checked = selected.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggle(id)}
                      className={`w-full text-start px-3 py-2 text-sm flex items-center gap-2 transition-colors ${checked ? 'bg-marine-cyan/10 text-marine-primary' : 'text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/[0.03]'}`}
                    >
                      <input type="checkbox" checked={checked} readOnly className="w-3.5 h-3.5 accent-marine-cyan" />
                      {getLabel(item)}
                    </button>
                  );
                })
            }
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Who pays for the discount ───
   The percentage is OF THE DISCOUNT, never of the order — a 10% coupon with the vendor at
   30% means the vendor gives up 3% of the price and the platform 7%, and the worked example
   below says exactly that in money so nobody has to do the arithmetic in their head. */
const fmtEGP = (n) => `${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP`;

function CouponFundingSection({ form, setForm, isAr }) {
  const share = Math.min(100, Math.max(0, Number(form.vendor_share_percent) || 0));
  const platformShare = Math.round((100 - share) * 100) / 100;
  const value = Number(form.discount_value) || 0;
  const isPercent = form.discount_type === 'percent';

  // A worked example on a round basket, so the split reads as money and not as a ratio
  // of a ratio. The basket is chosen so the coupon is not clamped by its own size.
  const exampleOrder = isPercent ? 1000 : Math.max(1000, Math.ceil((value * 2) / 100) * 100);
  const exampleDiscount = isPercent ? (exampleOrder * value) / 100 : Math.min(value, exampleOrder);
  const exampleVendor = Math.floor(exampleDiscount * share) / 100;
  const examplePlatform = Math.round((exampleDiscount - exampleVendor) * 100) / 100;

  const presets = [0, 25, 50, 75, 100];
  const set = (v) => setForm((p) => ({ ...p, vendor_share_percent: v }));

  const discountLabel = value > 0
    ? (isPercent
      ? (isAr ? `${value}% من سعر المنتجات المشمولة` : `${value}% of the eligible items' price`)
      : (isAr ? `${fmtEGP(value)} ثابتة على الأوردر` : `a fixed ${fmtEGP(value)} off the order`))
    : (isAr ? 'حدد قيمة الخصم فوق الأول' : 'set the discount value above first');

  return (
    <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl shadow-sm overflow-visible relative z-10">
      <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02] rounded-t-2xl">
        <h3 className="font-bold text-zinc-900 dark:text-white">{isAr ? '٣. مين بيتحمل الخصم؟' : '3. Who pays for the discount?'}</h3>
        <p className="text-xs text-zinc-500 mt-1">
          {isAr
            ? 'النسبة دي من قيمة الخصم نفسه، مش من قيمة الأوردر. بتتقفل على كل أوردر وقت إنشائه، فتعديلها بعدين مبيأثرش على أوردرات اتعملت.'
            : 'This is a share of the discount itself, not of the order. It is frozen onto every order at placement, so changing it later never touches orders already placed.'}
        </p>
      </div>

      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
            {isAr ? 'نسبة التاجر من الخصم *' : "Vendor's share of the discount *"}
          </label>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={form.vendor_share_percent}
              onChange={(e) => set(e.target.value === '' ? '' : Math.min(100, Math.max(0, Number(e.target.value))))}
              className={`${inputCls} max-w-[120px] text-center font-black text-lg`}
              dir="ltr"
            />
            <span className="text-lg font-black text-zinc-400">%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={share}
            onChange={(e) => set(Number(e.target.value))}
            className="w-full accent-marine-cyan"
            dir="ltr"
          />
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => set(p)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${share === p
                  ? 'bg-marine-cyan border-marine-cyan text-white'
                  : 'border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-zinc-400'}`}
              >
                {p === 0 ? (isAr ? 'الموقع كله' : 'Platform pays all')
                  : p === 100 ? (isAr ? 'التاجر كله' : 'Vendor pays all')
                    : `${p}%`}
              </button>
            ))}
          </div>
        </div>

        {/* The split, in words and in money, live as the numbers change. */}
        <div className="rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/[0.03] p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-white dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{isAr ? 'التاجر يتحمل' : 'Vendor absorbs'}</p>
              <p className="text-2xl font-black text-zinc-900 dark:text-white" dir="ltr">{share}%</p>
              <p className="text-[11px] text-zinc-500">{isAr ? 'من قيمة الخصم' : 'of the discount'}</p>
            </div>
            <div className="rounded-lg bg-white dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{isAr ? 'الموقع يتحمل' : 'Platform absorbs'}</p>
              <p className="text-2xl font-black text-marine-primary" dir="ltr">{platformShare}%</p>
              <p className="text-[11px] text-zinc-500">{isAr ? 'من قيمة الخصم' : 'of the discount'}</p>
            </div>
          </div>

          <div className="h-2 rounded-full overflow-hidden bg-zinc-200 dark:bg-white/10 flex" dir="ltr">
            <div className="h-full bg-zinc-800 dark:bg-zinc-200" style={{ width: `${share}%` }} />
            <div className="h-full bg-marine-cyan" style={{ width: `${platformShare}%` }} />
          </div>

          <div className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300 space-y-1">
            <p>
              <span className="font-bold">{isAr ? 'الخصم: ' : 'Discount: '}</span>{discountLabel}
            </p>
            {value > 0 && (
              <p>
                {isAr
                  ? <>مثال: أوردر بـ <b dir="ltr">{fmtEGP(exampleOrder)}</b> الخصم عليه <b dir="ltr">{fmtEGP(exampleDiscount)}</b> — التاجر يتحمل <b dir="ltr">{fmtEGP(exampleVendor)}</b> (بتتخصم من أرباحه) والموقع يتحمل <b dir="ltr">{fmtEGP(examplePlatform)}</b> (تكلفة علينا).</>
                  : <>Example: on a <b dir="ltr">{fmtEGP(exampleOrder)}</b> order the discount is <b dir="ltr">{fmtEGP(exampleDiscount)}</b> — the vendor absorbs <b dir="ltr">{fmtEGP(exampleVendor)}</b> (taken off their earning) and the platform absorbs <b dir="ltr">{fmtEGP(examplePlatform)}</b> (our cost).</>}
              </p>
            )}
            <p className="text-zinc-500">
              {isAr
                ? 'العمولة بتتحسب على السعر بعد الخصم في كل الحالات. العميل بيشوف خصم واحد بس ومبيعرفش مين متحمله.'
                : 'Commission is always charged on the post-discount price. The customer sees one discount and never who funded it.'}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Main CouponForm ─── */
export default function CouponForm({ initialData, loading, onSubmit, onCancel, submitLabel = 'Save as Inactive', publishLabel = 'Save & Activate' }) {
  const { language } = useApp();
  const isAr = language === 'ar';
  const [savingStatus, setSavingStatus] = useState(null);
  const [error, setError] = useState('');

  const [form, setForm] = useState(() => ({
    code: initialData?.code || '',
    name: initialData?.name || '',
    description: initialData?.description || '',
    discount_type: initialData?.discount_type || 'percent',
    discount_value: initialData?.discount_value ?? '',
    scope_type: initialData?.scope_type || 'all_products',
    // Who funds the discount. Stored as the VENDOR's percentage of the discount itself.
    // A coupon saved before this existed carries nothing and reads 0: the platform pays.
    vendor_share_percent: initialData?.vendor_share_percent ?? 0,
    category_ids: normalizeIds(initialData?.category_ids?.map?.(x => x?._id || x)),
    product_ids: normalizeIds(initialData?.product_ids?.map?.(x => x?._id || x)),
    vendor_ids: normalizeIds(initialData?.vendor_ids?.map?.(x => x?._id || x)),
    min_order_amount: initialData?.min_order_amount ?? 0,
    usage_limit_total: initialData?.usage_limit_total ?? '',
    usage_limit_per_user: initialData?.usage_limit_per_user ?? '',
    starts_at: toLocal(initialData?.starts_at),
    expires_at: toLocal(initialData?.expires_at),
    is_active: Boolean(initialData?.is_active),
  }));

  /* scope data */
  const [catTree, setCatTree] = useState([]);
  const [catLoading, setCatLoading] = useState(false);
  const [products, setProducts] = useState([]);
  const [prodLoading, setProdLoading] = useState(false);
  const [vendors, setVendors] = useState([]);
  const [vendLoading, setVendLoading] = useState(false);

  /* lazy fetch when scope changes */
  useEffect(() => {
    if (form.scope_type === 'category_tree' && !catTree.length) {
      setCatLoading(true);
      adminApi.getCategoriesAdmin().then(d => setCatTree(d.tree || [])).catch(() => {}).finally(() => setCatLoading(false));
    }
    if (form.scope_type === 'product_list' && !products.length) {
      setProdLoading(true);
      adminApi.getProducts('published').then(d => setProducts(d.products || [])).catch(() => {}).finally(() => setProdLoading(false));
    }
    if (form.scope_type === 'vendor_list' && !vendors.length) {
      setVendLoading(true);
      adminApi.getVendors().then(d => setVendors(d.vendors || [])).catch(() => {}).finally(() => setVendLoading(false));
    }
  }, [form.scope_type]);

  const canSubmit = useMemo(() => {
    if (!form.code.trim() || !form.name.trim()) return false;
    const v = Number(form.discount_value);
    if (!isFinite(v) || v <= 0) return false;
    if (form.discount_type === 'percent' && v > 100) return false;
    const share = Number(form.vendor_share_percent);
    if (form.vendor_share_percent === '' || !isFinite(share) || share < 0 || share > 100) return false;
    if (form.scope_type === 'category_tree' && !form.category_ids.length) return false;
    if (form.scope_type === 'product_list' && !form.product_ids.length) return false;
    if (form.scope_type === 'vendor_list' && !form.vendor_ids.length) return false;
    if (form.starts_at && form.expires_at && new Date(form.starts_at) > new Date(form.expires_at)) return false;
    return true;
  }, [form]);

  const submit = async (targetStatus) => {
    setSavingStatus(targetStatus);
    setError('');
    try {
      await onSubmit({
        ...form,
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        description: form.description.trim(),
        discount_value: Number(form.discount_value),
        vendor_share_percent: Math.min(100, Math.max(0, Number(form.vendor_share_percent) || 0)),
        min_order_amount: form.min_order_amount === '' ? 0 : Math.max(0, Number(form.min_order_amount)),
        usage_limit_total: form.usage_limit_total === '' ? null : Math.max(0, Number(form.usage_limit_total)),
        usage_limit_per_user: form.usage_limit_per_user === '' ? null : Math.max(0, Number(form.usage_limit_per_user)),
        category_ids: form.scope_type === 'category_tree' ? form.category_ids : [],
        product_ids: form.scope_type === 'product_list' ? form.product_ids : [],
        vendor_ids: form.scope_type === 'vendor_list' ? form.vendor_ids : [],
        starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
        is_active: targetStatus === 'active',
      });
    } catch (err) {
      setError(err.message || 'Failed to save coupon');
    } finally {
      setSavingStatus(null);
    }
  };

  return (
    <div className="space-y-6">
      {error && <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm">{error}</div>}

      {/* 1. Coupon Details */}
      <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl shadow-sm overflow-visible">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02] rounded-t-2xl">
          <h3 className="font-bold text-zinc-900 dark:text-white">1. Coupon Details</h3>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Coupon Code *</label>
            <input value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="WELCOME10" className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Name *</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputCls} />
          </div>
          <div className="md:col-span-2 space-y-1">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Description</label>
            <textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className={inputCls} />
          </div>
        </div>
      </section>

      {/* 2. Discount & Scope */}
      <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl shadow-sm overflow-visible relative z-20">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02] rounded-t-2xl">
          <h3 className="font-bold text-zinc-900 dark:text-white">2. Discount &amp; Scope</h3>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-1">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Discount Type *</label>
            <select value={form.discount_type} onChange={e => setForm({ ...form, discount_type: e.target.value })} className={inputCls}>
              {discountTypeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Discount Value *</label>
            <input type="number" min="0" step="0.01" value={form.discount_value} onChange={e => setForm({ ...form, discount_value: e.target.value })} className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Scope Type *</label>
            <select value={form.scope_type} onChange={e => setForm({ ...form, scope_type: e.target.value })} className={inputCls}>
              {scopeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          {/* Category Tree */}
          {form.scope_type === 'category_tree' && (
            <div className="md:col-span-3 space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                Select Categories <span className="text-marine-primary">({form.category_ids.length} selected)</span>
              </label>
              {catLoading
                ? <div className="flex items-center gap-2 text-sm text-zinc-400"><Loader2 size={14} className="animate-spin" /> Loading categories…</div>
                : <CategoryTreePicker tree={catTree} selected={form.category_ids} onChange={ids => setForm(p => ({ ...p, category_ids: ids }))} />
              }
            </div>
          )}

          {/* Product List */}
          {form.scope_type === 'product_list' && (
            <div className="md:col-span-3 space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                Select Products <span className="text-marine-primary">({form.product_ids.length} selected)</span>
              </label>
              {prodLoading
                ? <div className="flex items-center gap-2 text-sm text-zinc-400"><Loader2 size={14} className="animate-spin" /> Loading products…</div>
                : <SearchableMultiSelect
                    items={products}
                    selected={form.product_ids}
                    onChange={ids => setForm(p => ({ ...p, product_ids: ids }))}
                    getId={p => p._id}
                    getLabel={p => p.title_en || p.title_ar || p._id}
                    placeholder="Search and select products…"
                  />
              }
            </div>
          )}

          {/* Vendor List */}
          {form.scope_type === 'vendor_list' && (
            <div className="md:col-span-3 space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
                Select Vendors <span className="text-marine-primary">({form.vendor_ids.length} selected)</span>
              </label>
              {vendLoading
                ? <div className="flex items-center gap-2 text-sm text-zinc-400"><Loader2 size={14} className="animate-spin" /> Loading vendors…</div>
                : <SearchableMultiSelect
                    items={vendors}
                    selected={form.vendor_ids}
                    onChange={ids => setForm(p => ({ ...p, vendor_ids: ids }))}
                    getId={v => v._id}
                    getLabel={v => v.store_name || v.store_username || v._id}
                    placeholder="Search and select vendors…"
                  />
              }
            </div>
          )}
        </div>
      </section>

      {/* 2b. Who pays for the discount */}
      <CouponFundingSection form={form} setForm={setForm} isAr={isAr} />

      {/* 3. Limits & Schedule */}
      <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl shadow-sm overflow-visible relative z-10">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02] rounded-t-2xl">
          <h3 className="font-bold text-zinc-900 dark:text-white">4. Limits &amp; Schedule</h3>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Minimum Order Amount</label>
            <input type="number" min="0" step="0.01" value={form.min_order_amount} onChange={e => setForm({ ...form, min_order_amount: e.target.value })} className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Total Usage Limit</label>
            <input type="number" min="0" step="1" value={form.usage_limit_total} onChange={e => setForm({ ...form, usage_limit_total: e.target.value })} className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Per-User Usage Limit</label>
            <input type="number" min="0" step="1" value={form.usage_limit_per_user} onChange={e => setForm({ ...form, usage_limit_per_user: e.target.value })} className={inputCls} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Starts At</label>
            <input type="datetime-local" value={form.starts_at} onChange={e => setForm({ ...form, starts_at: e.target.value })} className={inputCls} />
          </div>
          <div className="md:col-span-2 space-y-1">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Expires At</label>
            <input type="datetime-local" value={form.expires_at} onChange={e => setForm({ ...form, expires_at: e.target.value })} className={inputCls} />
          </div>
        </div>
      </section>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        <button type="button" onClick={onCancel} className="px-5 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-zinc-400 font-medium">Cancel</button>
        <button type="button" onClick={() => submit('inactive')} disabled={!canSubmit || !!savingStatus || loading} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 disabled:opacity-50 font-bold">
          {savingStatus === 'inactive' ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}{submitLabel}
        </button>
        <button type="button" onClick={() => submit('active')} disabled={!canSubmit || !!savingStatus || loading} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold disabled:opacity-50">
          {savingStatus === 'active' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}{publishLabel}
        </button>
      </div>
    </div>
  );
}
