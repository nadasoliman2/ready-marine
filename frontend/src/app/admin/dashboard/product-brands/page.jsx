'use client';

import { useEffect, useMemo, useState } from 'react';
import { BadgePercent, Loader2, Pencil, Plus, Save, Search, Trash2, X } from 'lucide-react';
import { adminApi } from '../../../../lib/api';
import { matchScore } from '../../../../lib/searchSuggest';
import { useApp } from '../../../../context/AppContext';
import SingleImageUploader from '../../../../components/dashboard/SingleImageUploader';
import PaginationControls from '../../../../components/dashboard/PaginationControls';
import usePageSize from '../../../../lib/usePageSize';
import Overlay from '../../../../components/Overlay';


const emptyForm = {
  name: '',
  image: '',
  categories: [],
};

export default function AdminProductBrandsPage() {
  const { language } = useApp();
  const isAr = language === 'ar';

  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('admin.productBrands', 12);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState(emptyForm);
  // The whole tree, for the picker in the form and the tags on each row.
  const [categories, setCategories] = useState([]);

  const load = async () => {
    setLoading(true);
    try {
      const data = await adminApi.getProductBrandsAdmin();
      const list = data.productBrands || [];
      setBrands(list);
    } catch (err) {
      setError(err.message || 'Failed to load product brands');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    adminApi.getCategoriesAdmin()
      .then((data) => setCategories(data.categories || []))
      // The picker is a convenience on top of the form; a brand can still be saved without it.
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return brands;
    return brands.filter(brand => String(brand.name || '').toLowerCase().includes(q));
  }, [brands, search]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const openAdd = () => {
    setEditingId('');
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (brand) => {
    setEditingId(brand._id);
    setForm({
      name: brand.name || '',
      image: brand.image || '',
      categories: (brand.categories || []).map(String),
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId('');
    setForm(emptyForm);
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const payload = {
        name: form.name.trim(),
        image: (form.image || '').trim(),
        categories: form.categories || [],
      };

      if (!payload.name) {
        throw new Error('Brand name is required');
      }

      if (editingId) {
        await adminApi.updateProductBrandAdmin(editingId, payload);
      } else {
        await adminApi.addProductBrandAdmin(payload);
      }

      closeModal();
      await load();
    } catch (err) {
      setError(err.message || 'Failed to save product brand');
    } finally {
      setSaving(false);
    }
  };

  const removeBrand = async (brand) => {
    const ok = confirm(isAr ? 'هل تريد حذف هذه العلامة؟' : 'Are you sure you want to delete this brand?');
    if (!ok) return;

    setDeletingId(brand._id);
    setError('');

    try {
      await adminApi.deleteProductBrandAdmin(brand._id);
      await load();
    } catch (err) {
      setError(err.message || 'Failed to delete product brand');
    } finally {
      setDeletingId('');
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-marine-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-wide">
            {isAr ? 'إدارة ماركات المنتجات' : 'Product Brands'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {isAr
              ? 'إضافة وتعديل وحذف ماركات المنتجات. ماركات العربيات (تويوتا، بي إم دبليو…) بتظهر تلقائيًا في كل قوائم الماركات جنب دول — متضيفهاش هنا تاني، وعدّلها من صفحة ماركات العربيات.'
              : 'Create, edit, and manage product brands. Car makes (Toyota, BMW…) appear automatically on every brand list beside these — do not add them again here; edit them under Car Brands.'}
          </p>
        </div>
        <button
          onClick={openAdd}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-marine-cyan hover:bg-marine-cyan-dark text-white rounded-xl font-bold"
        >
          <Plus size={18} />
          {isAr ? 'إضافة ماركة' : 'Add Product Brand'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-bold">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatCard icon={BadgePercent} label={isAr ? 'كل الماركات' : 'Total Brands'} value={brands.length} />
        <StatCard icon={BadgePercent} label={isAr ? 'نتائج البحث' : 'Search Results'} value={filtered.length} tone="gray" />
      </div>

      <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-zinc-100 dark:border-white/5">
          <div className="relative max-w-xl">
            <Search size={18} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={isAr ? 'ابحث باسم الماركة' : 'Search by brand name'}
              className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl ps-10 pe-4 py-3 text-sm focus:outline-none focus:border-marine-cyan"
            />
          </div>
        </div>

        <div className="divide-y divide-zinc-100 dark:divide-white/5">
          {paginated.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <BadgePercent size={36} className="mx-auto text-zinc-300 mb-3" />
              <p className="text-zinc-500 font-semibold">{isAr ? 'لا توجد ماركات' : 'No brands found'}</p>
            </div>
          ) : (
            paginated.map(brand => (
              <div key={brand._id} className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <h3 className="font-black text-zinc-900 dark:text-white">{brand.name}</h3>
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">ID: {brand._id}</p>
                  <BrandCategoryTags ids={brand.categories} categories={categories} isAr={isAr} />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openEdit(brand)}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-300"
                  >
                    <Pencil size={13} /> {isAr ? 'تعديل' : 'Edit'}
                  </button>
                  <button
                    onClick={() => removeBrand(brand)}
                    disabled={deletingId === brand._id}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold bg-red-500/10 text-red-500 hover:bg-red-500/20 disabled:opacity-50"
                  >
                    {deletingId === brand._id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    {isAr ? 'حذف' : 'Delete'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <PaginationControls
          page={page}
          pageSize={pageSize}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
          total={filtered.length}
          onPageChange={setPage}
          labels={{
            showing: isAr ? 'عرض' : 'Showing',
            of: isAr ? 'من' : 'of',
            previous: isAr ? 'الصفحة السابقة' : 'Previous page',
            next: isAr ? 'الصفحة التالية' : 'Next page',
          }}
        />
      </div>

      {showModal && (
        <Overlay className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white dark:bg-[#14171A] rounded-2xl border border-zinc-200 dark:border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-5 border-b border-zinc-100 dark:border-white/5 shrink-0">
              <h2 className="text-lg font-black text-zinc-900 dark:text-white">
                {editingId ? (isAr ? 'تعديل ماركة' : 'Edit Product Brand') : (isAr ? 'إضافة ماركة' : 'Add Product Brand')}
              </h2>
              <button onClick={closeModal} className="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-xl hover:bg-zinc-50 dark:hover:bg-white/5">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={submit} className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto">
              <Field label={isAr ? 'اسم الماركة' : 'Brand Name'} required>
                <input
                  required
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-marine-cyan"
                />
              </Field>

              <div className="md:col-span-2">
                <CategoryPicker
                  categories={categories}
                  value={form.categories}
                  onChange={(next) => setForm({ ...form, categories: next })}
                  isAr={isAr}
                />
              </div>

              <div className="md:col-span-2">
                <SingleImageUploader
                  label={isAr ? 'صورة الماركة' : 'Brand Image'}
                  value={form.image}
                  onChange={url => setForm({ ...form, image: url })}
                />
              </div>

              <div className="md:col-span-2 flex justify-end gap-3 pt-4 mt-2 border-t border-zinc-100 dark:border-white/5 shrink-0">
                <button type="button" onClick={closeModal} className="px-5 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 font-bold">
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
                <button type="submit" disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 text-white rounded-xl font-bold">
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  {isAr ? 'حفظ' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </Overlay>
      )}
    </div>
  );
}

/** The categories a brand is tagged with, as small chips under its name. */
function BrandCategoryTags({ ids = [], categories, isAr }) {
  if (!ids.length) {
    return (
      <p className="text-xs text-zinc-400 mt-1.5">
        {isAr ? 'بدون تصنيفات — بتظهر في كل الفلاتر' : 'No categories — shown in every filter'}
      </p>
    );
  }
  const byId = new Map(categories.map((c) => [String(c._id), c]));
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {ids.map((id) => {
        const c = byId.get(String(id));
        if (!c) return null;
        return (
          <span key={id} className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-zinc-100 dark:bg-white/5 text-zinc-600 dark:text-zinc-300">
            {(isAr ? c.name_ar : c.name) || c.name}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Tick the categories a brand works in.
 *
 * The tree is shown as it is, indented, and a parent stands for everything under it — so
 * a brand that makes every kind of filter is one tick on "Filters", not twelve. The
 * children of a ticked parent are shown as covered and cannot be ticked separately, or
 * the same choice would be stored twice and read as two.
 */
function CategoryPicker({ categories, value = [], onChange, isAr }) {
  const [query, setQuery] = useState('');
  const selected = new Set(value.map(String));

  const childrenOf = useMemo(() => {
    const map = new Map();
    for (const c of categories) {
      const key = String(c.parent_id || '');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(c);
    }
    return map;
  }, [categories]);

  const label = (c) => (isAr ? c.name_ar : c.name) || c.name || c.name_ar || '';
  const q = query.trim();
  // Each typed word has to start a word, in either language (lib/searchSuggest).
  const matches = (c) => !q || [label(c), c.name, c.name_ar].some((text) => matchScore(text, q) > 0);

  // A node is shown when it matches or any descendant does, so a search for a child keeps
  // its parent on screen for context.
  const visible = (c) => matches(c) || (childrenOf.get(String(c._id)) || []).some(visible);

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange([...next]);
  };

  const render = (parentId, depth, coveredByParent) => (childrenOf.get(String(parentId || '')) || [])
    .filter(visible)
    .map((c) => {
      const id = String(c._id);
      const checked = selected.has(id);
      const covered = coveredByParent;
      return (
        <div key={id}>
          <label
            className={`flex items-center gap-2 py-1 text-sm ${covered ? 'text-zinc-400' : 'text-zinc-800 dark:text-zinc-200'}`}
            style={{ paddingInlineStart: `${depth * 18}px` }}
          >
            <input
              type="checkbox"
              checked={checked || covered}
              disabled={covered}
              onChange={() => toggle(id)}
              className="accent-marine-cyan"
            />
            <span>{label(c)}</span>
          </label>
          {render(id, depth + 1, covered || checked)}
        </div>
      );
    });

  if (!categories.length) return null;

  return (
    <div className="block">
      <span className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
        {isAr ? 'بتشتغل في التصنيفات دي' : 'Works in these categories'}
      </span>
      <p className="text-xs text-zinc-500 mb-2">
        {isAr
          ? 'اختيار تصنيف رئيسي بيشمل كل اللي تحته. لو مفيش ولا تصنيف، الماركة بتظهر في كل الفلاتر.'
          : 'Ticking a parent covers everything under it. With nothing ticked the brand appears in every filter.'}
      </p>
      <div className="bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl">
        <div className="p-2 border-b border-zinc-200 dark:border-white/10">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isAr ? 'ابحث في التصنيفات' : 'Search categories'}
            className="w-full bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-marine-cyan"
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-2">
          {render(null, 0, false)}
        </div>
        {selected.size > 0 && (
          <div className="px-3 py-2 border-t border-zinc-200 dark:border-white/10 flex items-center justify-between text-xs">
            <span className="text-zinc-500">{isAr ? `${selected.size} مختار` : `${selected.size} selected`}</span>
            <button type="button" onClick={() => onChange([])} className="font-bold text-marine-primary hover:underline">
              {isAr ? 'مسح الكل' : 'Clear all'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, required = false, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
        {label} {required ? '*' : ''}
      </span>
      {children}
    </label>
  );
}

function StatCard({ icon: Icon, label, value, tone = 'default' }) {
  const toneMap = {
    default: 'bg-marine-cyan/10 text-marine-primary',
    gray: 'bg-zinc-500/10 text-zinc-500',
  };

  return (
    <div className="rounded-2xl border border-zinc-200 dark:border-white/5 bg-white dark:bg-[#14171A] p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${toneMap[tone] || toneMap.default}`}>
          <Icon size={18} />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">{label}</p>
          <p className="text-2xl font-black text-zinc-900 dark:text-white">{value}</p>
        </div>
      </div>
    </div>
  );
}
