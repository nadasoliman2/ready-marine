'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { FolderTree, ImageOff, Layers, Loader2, Pencil, Plus, Save, Search, Trash2, X } from 'lucide-react';
import { adminApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import SingleImageUploader from '../../../../components/dashboard/SingleImageUploader';
import PaginationControls from '../../../../components/dashboard/PaginationControls';
import usePageSize from '../../../../lib/usePageSize';
import Overlay from '../../../../components/Overlay';
import SearchableSelect from '../../../../components/SearchableSelect';


const emptyForm = {
  name: '',
  name_ar: '',
  parent_id: '',
  image: '',
  sort_order: 0,
  is_active: true,
  type_ids: [],
};

const emptyTypeForm = {
  name: '',
  name_ar: '',
  image: '',
  sort_order: 0,
  is_active: true,
};

function flattenTree(nodes = [], depth = 0, acc = []) {
  nodes.forEach(node => {
    acc.push({ ...node, depth });
    if (Array.isArray(node.subcategories) && node.subcategories.length) {
      flattenTree(node.subcategories, depth + 1, acc);
    }
  });
  return acc;
}

export default function AdminCategoriesPage() {
  const { language } = useApp();
  const isAr = language === 'ar';

  const [categories, setCategories] = useState([]);
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [onlyMissingImage, setOnlyMissingImage] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('admin.categories', 12);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [types, setTypes] = useState([]);
  const [typeForm, setTypeForm] = useState(null); // null = closed; { id?, ...fields } = open
  const [savingType, setSavingType] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [data, typeData] = await Promise.all([adminApi.getCategoriesAdmin(), adminApi.getProductTypesAdmin()]);
      setCategories(data.categories || []);
      setTree(data.tree || []);
      setTypes(typeData.types || []);
    } catch (err) {
      setError(err.message || (isAr ? 'تعذر تحميل التصنيفات' : 'Failed to load categories'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const flat = useMemo(() => flattenTree(tree), [tree]);

  const parentNameOf = (cat) => {
    const parent = flat.find(c => String(c._id) === String(cat.parent_id || ''));
    return parent ? ((isAr && parent.name_ar) || parent.name) : '';
  };

  // Where each category shows among the ones beside it (same parent), in the shop's order.
  const positionById = useMemo(() => {
    const groups = new Map();
    flat.forEach(cat => {
      const key = String(cat.parent_id || '');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(cat);
    });
    const positions = new Map();
    groups.forEach(list => {
      [...list].sort(byShopOrder).forEach((cat, i) => positions.set(String(cat._id), { at: i + 1, of: list.length }));
    });
    return positions;
  }, [flat]);

  const missingImageCount = useMemo(() => flat.filter(cat => !String(cat.image || '').trim()).length, [flat]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return flat.filter(cat => (!onlyMissingImage || !String(cat.image || '').trim())
      && (!q || [cat.name, cat.name_ar].some(v => String(v || '').toLowerCase().includes(q))));
  }, [flat, search, onlyMissingImage]);

  useEffect(() => {
    setPage(1);
  }, [search, onlyMissingImage]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const openAdd = () => {
    setEditingId('');
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (cat) => {
    setEditingId(cat._id);
    setForm({
      name: cat.name || '',
      name_ar: cat.name_ar || '',
      parent_id: cat.parent_id || '',
      image: cat.image || '',
      sort_order: cat.sort_order || 0,
      is_active: cat.is_active !== false,
      type_ids: (cat.type_ids || []).map(String),
    });
    setShowModal(true);
  };

  const toggleFormType = (typeId) => setForm((prev) => ({
    ...prev,
    type_ids: prev.type_ids.includes(typeId) ? prev.type_ids.filter((id) => id !== typeId) : [...prev.type_ids, typeId],
  }));

  const typeName = (type) => (isAr ? (type.name_ar || type.name) : type.name);
  const typeById = useMemo(() => new Map(types.map((type) => [String(type._id), type])), [types]);
  // The types a category has through the categories above it. The shop already counts
  // everything under a "Spare parts" category as spare parts (typeCategoryIds in
  // services/productService.js); shown here so a subcategory does not look typeless.
  const inheritedTypes = useMemo(() => {
    const byId = new Map(categories.map((c) => [String(c._id), c]));
    const out = new Map();
    for (const cat of categories) {
      const own = new Set((cat.type_ids || []).map(String));
      const found = [];
      const seen = new Set();
      let parent = cat.parent_id ? byId.get(String(cat.parent_id)) : null;
      while (parent && !seen.has(String(parent._id))) {
        seen.add(String(parent._id));
        for (const id of parent.type_ids || []) {
          const type = typeById.get(String(id));
          if (type && !own.has(String(id)) && !found.some((f) => String(f.type._id) === String(id))) found.push({ type, from: parent });
        }
        parent = parent.parent_id ? byId.get(String(parent.parent_id)) : null;
      }
      out.set(String(cat._id), found);
    }
    return out;
  }, [categories, typeById]);

  // In the form: the types the chosen parent passes down, ticked and locked.
  const formInheritedTypeIds = useMemo(() => {
    const byId = new Map(categories.map((c) => [String(c._id), c]));
    const ids = new Set();
    const seen = new Set();
    let parent = form.parent_id ? byId.get(String(form.parent_id)) : null;
    while (parent && !seen.has(String(parent._id))) {
      seen.add(String(parent._id));
      (parent.type_ids || []).forEach((id) => ids.add(String(id)));
      parent = parent.parent_id ? byId.get(String(parent.parent_id)) : null;
    }
    return ids;
  }, [categories, form.parent_id]);

  const saveType = async (e) => {
    e.preventDefault();
    setSavingType(true);
    setError('');
    try {
      const { id, ...fields } = typeForm;
      const payload = { ...fields, name: fields.name.trim(), name_ar: fields.name_ar.trim(), image: (fields.image || '').trim() };
      if (id) await adminApi.updateProductTypeAdmin(id, payload);
      else await adminApi.addProductTypeAdmin(payload);
      setTypeForm(null);
      await load();
    } catch (err) {
      setError(err.message || (isAr ? 'تعذر حفظ النوع' : 'Failed to save type'));
    } finally {
      setSavingType(false);
    }
  };

  const removeType = async (type) => {
    const ok = confirm(isAr
      ? `حذف النوع «${typeName(type)}»؟ الفئات نفسها مش هتتمسح، بس مش هتبقى تحت النوع ده.`
      : `Delete the type "${typeName(type)}"? Its categories stay; they just leave this type.`);
    if (!ok) return;
    setError('');
    try {
      await adminApi.deleteProductTypeAdmin(type._id);
      await load();
    } catch (err) {
      setError(err.message || (isAr ? 'تعذر حذف النوع' : 'Failed to delete type'));
    }
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
        ...form,
        name: form.name.trim(),
        name_ar: form.name_ar.trim(),
        parent_id: form.parent_id || null,
        image: (form.image || '').trim(),
      };

      if (editingId) {
        await adminApi.updateCategoryAdmin(editingId, payload);
      } else {
        await adminApi.addCategoryAdmin(payload);
      }

      closeModal();
      await load();
    } catch (err) {
      setError(err.message || (isAr ? 'تعذر حفظ التصنيف' : 'Failed to save category'));
    } finally {
      setSaving(false);
    }
  };

  const removeCategory = async (cat) => {
    const ok = confirm(isAr ? 'هل تريد حذف هذا التصنيف؟' : 'Are you sure you want to delete this category?');
    if (!ok) return;

    setDeletingId(cat._id);
    setError('');
    try {
      await adminApi.deleteCategoryAdmin(cat._id);
      await load();
    } catch (err) {
      setError(err.message || (isAr ? 'تعذر حذف التصنيف' : 'Failed to delete category'));
    } finally {
      setDeletingId('');
    }
  };

  // The parent picker: every category by its full path ("Boat Equipment › Boat Cleaning"),
  // searchable in both languages. Not the category itself nor anything under it — a category
  // under its own child drops out of the tree with everything below it.
  const parentOptions = useMemo(() => {
    const byId = new Map(flat.map(cat => [String(cat._id), cat]));
    const pathOf = (cat, key) => {
      const names = [];
      for (let at = cat, guard = 0; at && guard < 20; at = byId.get(String(at.parent_id || '')), guard += 1) {
        names.unshift(at[key] || at.name);
      }
      return names.join(' › ');
    };
    const blocked = new Set();
    if (editingId) {
      blocked.add(String(editingId));
      flat.forEach(cat => {
        for (let at = cat, guard = 0; at && guard < 20; at = byId.get(String(at.parent_id || '')), guard += 1) {
          if (blocked.has(String(at.parent_id || ''))) { blocked.add(String(cat._id)); break; }
        }
      });
    }
    return flat
      .filter(cat => !blocked.has(String(cat._id)))
      .map(cat => ({
        value: cat._id,
        label: isAr && cat.name_ar ? pathOf(cat, 'name_ar') : pathOf(cat, 'name'),
        keywords: [cat.name, cat.name_ar, pathOf(cat, 'name'), pathOf(cat, 'name_ar')].filter(Boolean).join(' '),
      }));
  }, [flat, editingId, isAr]);

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
            {isAr ? 'إدارة التصنيفات' : 'Categories'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {isAr ? 'إضافة وتعديل وحذف التصنيفات الهرمية.' : 'Create, edit, and manage hierarchical categories.'}
          </p>
        </div>
        <button
          onClick={openAdd}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-marine-cyan hover:bg-marine-cyan-dark text-white rounded-xl font-bold"
        >
          <Plus size={18} />
          {isAr ? 'إضافة تصنيف' : 'Add Category'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-bold">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard icon={FolderTree} label={isAr ? 'كل التصنيفات' : 'Total Categories'} value={categories.length} />
        <StatCard icon={FolderTree} label={isAr ? 'تصنيفات رئيسية' : 'Root Categories'} value={categories.filter(c => !c.parent_id).length} tone="green" />
        <StatCard icon={FolderTree} label={isAr ? 'تصنيفات فرعية' : 'Subcategories'} value={categories.filter(c => !!c.parent_id).length} tone="gray" />
      </div>

      <ProductTypesPanel
        types={types}
        isAr={isAr}
        typeName={typeName}
        onAdd={() => setTypeForm({ ...emptyTypeForm })}
        onEdit={(type) => setTypeForm({
          id: type._id,
          name: type.name || '',
          name_ar: type.name_ar || '',
          image: type.image || '',
          sort_order: type.sort_order || 0,
          is_active: type.is_active !== false,
        })}
        onDelete={removeType}
      />

      <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-zinc-100 dark:border-white/5 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 max-w-xl">
            <Search size={18} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={isAr ? 'ابحث باسم التصنيف' : 'Search by category name'}
              className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl ps-10 pe-4 py-3 text-sm focus:outline-none focus:border-marine-cyan"
            />
          </div>
          <button
            type="button"
            onClick={() => setOnlyMissingImage(v => !v)}
            aria-pressed={onlyMissingImage}
            className={`inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold border transition-colors ${
              onlyMissingImage
                ? 'bg-marine-cyan/10 border-marine-cyan text-marine-cyan'
                : 'bg-zinc-50 dark:bg-[#0E1012] border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan'
            }`}
          >
            <ImageOff size={16} />
            {isAr ? 'بدون صورة' : 'No image'}
            <span className="text-xs font-black opacity-70">({missingImageCount})</span>
          </button>
        </div>

        <div className="divide-y divide-zinc-100 dark:divide-white/5">
          {paginated.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <FolderTree size={36} className="mx-auto text-zinc-300 mb-3" />
              <p className="text-zinc-500 font-semibold">{isAr ? 'لا توجد تصنيفات' : 'No categories found'}</p>
            </div>
          ) : (
            paginated.map(cat => (
              <Fragment key={cat._id}>
                <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h3 className="font-black text-zinc-900 dark:text-white">
                        {(isAr && cat.name_ar) || cat.name}
                      </h3>
                      {isAr ? <span className="text-xs text-zinc-500" dir="ltr">{cat.name}</span> : (cat.name_ar && <span className="text-xs text-zinc-500">{cat.name_ar}</span>)}
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 rounded-full border border-zinc-200 dark:border-white/10">
                        {cat.parent_id
                          ? (isAr ? `جوه: ${parentNameOf(cat)}` : `Inside: ${parentNameOf(cat)}`)
                          : (isAr ? 'تصنيف رئيسي' : 'Main category')}
                      </span>
                      {cat.is_active === false && (
                        <span className="px-2 py-0.5 text-[10px] font-bold bg-zinc-100 dark:bg-white/10 text-zinc-500 dark:text-zinc-400 rounded-full border border-zinc-200 dark:border-white/10 uppercase">
                          {isAr ? 'مخفي' : 'Hidden'}
                        </span>
                      )}
                      <span
                        title={isAr ? `رقم الترتيب: ${cat.sort_order || 0}` : `Sort number: ${cat.sort_order || 0}`}
                        className="px-2 py-0.5 text-[10px] font-bold bg-marine-cyan/10 text-marine-primary rounded-full border border-marine-cyan/20"
                      >
                        {isAr
                          ? `بيظهر رقم ${positionById.get(String(cat._id))?.at || 1} من ${positionById.get(String(cat._id))?.of || 1}`
                          : `Shows ${positionById.get(String(cat._id))?.at || 1} of ${positionById.get(String(cat._id))?.of || 1}`}
                      </span>
                      {(cat.type_ids || []).map((id) => typeById.get(String(id))).filter(Boolean).map((type) => (
                        <span key={type._id} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold bg-sky-500/10 text-sky-600 dark:text-sky-400 rounded-full border border-sky-500/20">
                          <Layers size={10} /> {typeName(type)}
                        </span>
                      ))}
                      {(inheritedTypes.get(String(cat._id)) || []).map(({ type, from }) => (
                        <span key={`inherited-${type._id}`} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold text-sky-600 dark:text-sky-400 rounded-full border border-dashed border-sky-500/40">
                          <Layers size={10} /> {typeName(type)} · {isAr ? `من ${from.name_ar || from.name}` : `from ${from.name}`}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-zinc-500">ID: {cat._id}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEdit(cat)}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-300"
                    >
                      <Pencil size={13} /> {isAr ? 'تعديل' : 'Edit'}
                    </button>
                    <button
                      onClick={() => removeCategory(cat)}
                      disabled={deletingId === cat._id}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold bg-red-500/10 text-red-500 hover:bg-red-500/20 disabled:opacity-50"
                    >
                      {deletingId === cat._id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      {isAr ? 'حذف' : 'Delete'}
                    </button>
                  </div>
                </div>
              </Fragment>
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
                {editingId ? (isAr ? 'تعديل تصنيف' : 'Edit Category') : (isAr ? 'إضافة تصنيف' : 'Add Category')}
              </h2>
              <button onClick={closeModal} className="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-xl hover:bg-zinc-50 dark:hover:bg-white/5">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={submit} className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto">
              {(() => {
                const english = (
                  <Field key="en" label={isAr ? 'الاسم بالإنجليزي' : 'English name'} required>
                    <input
                      required
                      dir="ltr"
                      value={form.name}
                      onChange={e => setForm({ ...form, name: e.target.value })}
                      className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-marine-cyan"
                    />
                  </Field>
                );
                const arabic = (
                  <Field key="ar" label={isAr ? 'الاسم بالعربي' : 'Arabic name'}>
                    <input
                      dir="rtl"
                      value={form.name_ar}
                      onChange={e => setForm({ ...form, name_ar: e.target.value })}
                      className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-marine-cyan"
                    />
                  </Field>
                );
                return isAr ? [arabic, english] : [english, arabic];
              })()}

              <Field label={isAr ? 'التصنيف الأب' : 'Parent Category'}>
                <SearchableSelect
                  value={form.parent_id}
                  onChange={value => setForm(prev => ({ ...prev, parent_id: value }))}
                  options={parentOptions}
                  placeholder={isAr ? 'مالوش أب: تصنيف رئيسي' : 'No parent: a main category'}
                  isAr={isAr}
                  buttonClassName="bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl ps-4 pe-9 py-3 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-marine-cyan"
                />
                <span className="block text-[11px] text-zinc-400 mt-1.5 leading-relaxed">
                  {form.parent_id
                    ? (isAr ? 'التصنيف ده هيظهر جوه التصنيف اللي اخترته.' : 'This category shows inside the one you picked.')
                    : (isAr
                      ? 'فاضي = تصنيف رئيسي، يعني أول مستوى في الموقع (زي «أدوات الصيد» و«معدات القوارب»). اختار تصنيف لو عايزه يبقى فرعي جواه.'
                      : 'Empty = a main category, the top level of the shop (like “Fishing Gear”). Pick one to put this inside it.')}
                </span>
              </Field>

              <div className="md:col-span-2">
                <SortOrderField
                  value={form.sort_order}
                  onChange={(sort_order) => setForm(prev => ({ ...prev, sort_order }))}
                  name={(isAr ? form.name_ar : '') || form.name}
                  siblings={flat.filter(cat => String(cat.parent_id || '') === String(form.parent_id || '') && String(cat._id) !== String(editingId))}
                  parentName={(() => {
                    const parent = flat.find(cat => String(cat._id) === String(form.parent_id || ''));
                    return parent ? ((isAr && parent.name_ar) || parent.name) : '';
                  })()}
                  isAr={isAr}
                />
              </div>

              <div className="flex items-center gap-3 h-full pt-6">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <div 
                    onClick={() => setForm({ ...form, is_active: !form.is_active })}
                    className={`w-10 h-5 rounded-full transition-all duration-300 relative ${form.is_active ? 'bg-marine-cyan' : 'bg-zinc-300 dark:bg-white/10'}`}
                  >
                    <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all duration-300 ${form.is_active ? 'left-6' : 'left-1'}`} />
                  </div>
                  <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300 group-hover:text-marine-primary transition-colors">
                    {isAr ? 'تفعيل العرض' : 'Active / Visible'}
                  </span>
                </label>
              </div>

              <div className="md:col-span-2">
                <span className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
                  {isAr ? 'نوع المنتج (ممكن أكتر من نوع)' : 'Product types (any number)'}
                </span>
                {types.length === 0 ? (
                  <p className="text-xs text-zinc-400">{isAr ? 'مفيش أنواع لسه. ضيفها من قسم «أنواع المنتجات».' : 'No types yet. Add them in "Product types".'}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {types.map((type) => {
                      const inherited = formInheritedTypeIds.has(String(type._id));
                      const on = inherited || form.type_ids.includes(String(type._id));
                      return (
                        <button
                          key={type._id}
                          type="button"
                          onClick={() => toggleFormType(String(type._id))}
                          disabled={inherited}
                          aria-pressed={on}
                          title={inherited ? (isAr ? 'جاي من الفئة الأعلى' : 'From the parent category') : undefined}
                          className={`px-3 py-2 rounded-xl text-sm font-bold border transition-colors ${
                            on
                              ? 'bg-marine-cyan border-marine-cyan text-white'
                              : 'bg-zinc-50 dark:bg-[#0E1012] border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-marine-cyan'
                          } ${inherited ? 'opacity-70 cursor-not-allowed' : ''}`}
                        >
                          {typeName(type)}{inherited ? (isAr ? ' · من الفئة الأعلى' : ' · from parent') : ''}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="text-[11px] text-zinc-400 mt-2">
                  {isAr
                    ? 'الفئة بتظهر كارت تحت النوع ده في صفحة المنتجات، ومعاها كل الفئات اللي جواها.'
                    : 'The category shows as a card under the type in the shop, with everything under it.'}
                </p>
              </div>

              <div className="md:col-span-2">
                <SingleImageUploader
                  label={isAr ? 'صورة التصنيف' : 'Category Image'}
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

      {typeForm && (
        <TypeModal
          form={typeForm}
          setForm={setTypeForm}
          saving={savingType}
          isAr={isAr}
          onSubmit={saveType}
          onClose={() => setTypeForm(null)}
        />
      )}
    </div>
  );
}

/** The product types: shopper-facing groupings the home page's search offers. */
function ProductTypesPanel({ types, isAr, typeName, onAdd, onEdit, onDelete }) {
  return (
    <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="font-black text-zinc-900 dark:text-white flex items-center gap-2">
            <Layers size={18} className="text-marine-primary" /> {isAr ? 'أنواع المنتجات' : 'Product types'}
          </h2>
          <p className="text-xs text-zinc-500 mt-1">
            {isAr
              ? 'بتظهر في بحث الصفحة الرئيسية بدل الفئات. اختار من «تعديل» في أي فئة هي تبع أنهي نوع.'
              : 'Offered in the home page search instead of the categories. Pick a category\'s types from its Edit.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-white/10 hover:bg-marine-cyan text-white rounded-xl text-sm font-bold"
        >
          <Plus size={16} /> {isAr ? 'إضافة نوع' : 'Add type'}
        </button>
      </div>
      {types.length === 0 ? (
        <p className="text-sm text-zinc-400">{isAr ? 'مفيش أنواع لسه.' : 'No types yet.'}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {types.map((type) => (
            <div key={type._id} className="inline-flex items-center gap-2 ps-3 pe-1 py-1 rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#0E1012]">
              <span className="text-sm font-bold text-zinc-800 dark:text-zinc-100">{typeName(type)}</span>
              <span className="text-[11px] text-zinc-400">
                {isAr ? `${type.category_count || 0} فئة` : `${type.category_count || 0} categories`}
              </span>
              {type.is_active === false && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold bg-zinc-200 dark:bg-white/10 text-zinc-500 rounded-full">{isAr ? 'مخفي' : 'Hidden'}</span>
              )}
              <button type="button" onClick={() => onEdit(type)} aria-label={isAr ? 'تعديل' : 'Edit'} className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-lg">
                <Pencil size={13} />
              </button>
              <button type="button" onClick={() => onDelete(type)} aria-label={isAr ? 'حذف' : 'Delete'} className="p-1.5 text-zinc-400 hover:text-red-500 rounded-lg">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TypeModal({ form, setForm, saving, isAr, onSubmit, onClose }) {
  const input = 'w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-marine-cyan';
  return (
    <Overlay className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white dark:bg-[#14171A] rounded-2xl border border-zinc-200 dark:border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-5 border-b border-zinc-100 dark:border-white/5 shrink-0">
          <h2 className="text-lg font-black text-zinc-900 dark:text-white">
            {form.id ? (isAr ? 'تعديل نوع' : 'Edit type') : (isAr ? 'إضافة نوع' : 'Add type')}
          </h2>
          <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-xl hover:bg-zinc-50 dark:hover:bg-white/5">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={onSubmit} className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 overflow-y-auto">
          <Field label={isAr ? 'الاسم بالإنجليزية' : 'Name'} required>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
          </Field>
          <Field label={isAr ? 'الاسم بالعربية' : 'Arabic name'}>
            <input value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} className={input} />
          </Field>
          <Field label={isAr ? 'ترتيب العرض' : 'Sort order'}>
            <input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value, 10) || 0 })} className={input} />
          </Field>
          <label className="flex items-center gap-2 cursor-pointer pt-6">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="accent-marine-cyan w-4 h-4" />
            <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300">{isAr ? 'ظاهر في الموقع' : 'Shown on the site'}</span>
          </label>
          <div className="sm:col-span-2">
            <SingleImageUploader
              label={isAr ? 'صورة (اختياري)' : 'Image (optional)'}
              value={form.image}
              onChange={(url) => setForm({ ...form, image: url })}
            />
          </div>
          <div className="sm:col-span-2 flex justify-end gap-3 pt-4 border-t border-zinc-100 dark:border-white/5">
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 font-bold">
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
  );
}

// The shop's order (Backend: sort by sort_order, then name): smaller number first, a tie by name.
function byShopOrder(a, b) {
  const diff = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
  if (diff) return diff;
  const an = String(a.name || '');
  const bn = String(b.name || '');
  return an < bn ? -1 : an > bn ? 1 : 0;
}

/**
 * The sort number, explained by showing it: the categories beside this one (same parent) in
 * the order the shop shows them, with this one marked where the number puts it.
 */
function SortOrderField({ value, onChange, name, siblings, parentName, isAr }) {
  const me = { _id: '__me__', name: name || (isAr ? 'التصنيف ده' : 'This category'), sort_order: value };
  const ordered = [...siblings, me].sort(byShopOrder);
  const at = ordered.findIndex(cat => cat._id === '__me__') + 1;
  const where = parentName
    ? (isAr ? `جوه «${parentName}»` : `inside “${parentName}”`)
    : (isAr ? 'في التصنيفات الرئيسية' : 'among the main categories');

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-white/10 p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <label className="block sm:w-40 shrink-0">
          <span className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">
            {isAr ? 'رقم الترتيب' : 'Sort number'}
          </span>
          <input
            type="number"
            min="0"
            value={value}
            onChange={e => onChange(parseInt(e.target.value, 10) || 0)}
            className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-marine-cyan"
          />
        </label>
        <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
          {isAr
            ? <>الرقم الأصغر بيظهر الأول. التصنيف ده هيظهر <b className="text-marine-primary">رقم {at} من {ordered.length}</b> {where}. لو رقمين زي بعض، بيترتبوا بالاسم.</>
            : <>Smaller numbers show first. This category will show <b className="text-marine-primary">{at} of {ordered.length}</b> {where}. Equal numbers go by name.</>}
        </p>
      </div>

      <div>
        <span className="block text-[11px] font-bold text-zinc-400 mb-1.5">
          {isAr ? 'كده هيبان الترتيب في الموقع:' : 'How the shop will list them:'}
        </span>
        <ol className="max-h-48 overflow-y-auto rounded-lg bg-zinc-50 dark:bg-[#0E1012] divide-y divide-zinc-100 dark:divide-white/5">
          {ordered.map((cat, i) => {
            const mine = cat._id === '__me__';
            return (
              <li
                key={cat._id}
                className={`flex items-center gap-3 px-3 py-2 text-sm ${mine ? 'bg-marine-cyan/10 font-bold text-marine-primary' : 'text-zinc-700 dark:text-zinc-300'}`}
              >
                <span className="w-6 text-center text-xs font-black text-zinc-400">{i + 1}</span>
                <span className="flex-1 min-w-0 truncate">
                  {mine ? cat.name : ((isAr && cat.name_ar) || cat.name)}
                  {mine && <span className="ms-2 text-[11px]">{isAr ? '← ده اللي بتعدّله' : '← this one'}</span>}
                </span>
                <span className="text-[11px] text-zinc-400">{isAr ? `رقم ${Number(cat.sort_order) || 0}` : `#${Number(cat.sort_order) || 0}`}</span>
              </li>
            );
          })}
        </ol>
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
    green: 'bg-emerald-500/10 text-emerald-500',
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
