'use client';

import { useEffect, useMemo, useState } from 'react';
import { Car, ChevronDown, Loader2, Pencil, Plus, Save, Search, Trash2, X } from 'lucide-react';
import { adminApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import SingleImageUploader from '../../../../components/dashboard/SingleImageUploader';
import PaginationControls from '../../../../components/dashboard/PaginationControls';
import usePageSize from '../../../../lib/usePageSize';
import Overlay from '../../../../components/Overlay';


const emptyBrand = {
  name: '',
  image: '',
  is_featured: false,
  models: [],
};

const normalizeYears = (years = []) => {
  return (Array.isArray(years) ? years : [])
    .map(y => Number(y?.year ?? y))
    .filter(y => Number.isInteger(y) && y > 1900)
    .sort((a, b) => a - b);
};

const normalizeModels = (models = []) => {
  return (Array.isArray(models) ? models : [])
    .map(model => ({
      _id: model?._id,
      name: String(model?.name || '').trim(),
      years: normalizeYears(model?.years || []),
      yearsInput: normalizeYears(model?.years || []).join(', '),
    }))
    .filter(model => model.name);
};

const parseYearsInput = (value) => {
  return String(value || '')
    .split(',')
    .map(v => Number(v.trim()))
    .filter(v => Number.isInteger(v) && v > 1900)
    .filter((year, idx, arr) => arr.indexOf(year) === idx)
    .sort((a, b) => a - b);
};

export default function AdminCarBrandsPage() {
  const { language } = useApp();
  const isAr = language === 'ar';

  const [carBrands, setCarBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('admin.carBrands', 10);
  const [expandedId, setExpandedId] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState(emptyBrand);

  const load = async () => {
    setLoading(true);
    try {
      const data = await adminApi.getCarBrandsAdmin();
      setCarBrands(data.carBrands || []);
    } catch (err) {
      setError(err.message || 'Failed to load car brands');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return carBrands;

    return carBrands.filter(brand => {
      const inBrand = String(brand.name || '').toLowerCase().includes(q);
      const inModels = (brand.models || []).some(model => String(model?.name || '').toLowerCase().includes(q));
      const inYears = (brand.models || []).some(model => normalizeYears(model?.years || []).some(year => String(year).includes(q)));
      return inBrand || inModels || inYears;
    });
  }, [carBrands, search]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const openAdd = () => {
    setEditingId('');
    setForm(emptyBrand);
    setShowModal(true);
  };

  const openEdit = (brand) => {
    setEditingId(brand._id);
    setForm({
      name: brand.name || '',
      image: brand.image || '',
      is_featured: !!brand.is_featured,
      models: normalizeModels(brand.models || []),
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId('');
    setForm(emptyBrand);
  };

  const addModel = () => {
    setForm(prev => ({
      ...prev,
      models: [...prev.models, { name: '', years: [], yearsInput: '' }],
    }));
  };

  const updateModel = (index, key, value) => {
    setForm(prev => ({
      ...prev,
      models: prev.models.map((model, i) => {
        if (i !== index) return model;
        if (key === 'yearsInput') {
          return {
            ...model,
            yearsInput: value,
            years: parseYearsInput(value),
          };
        }
        return { ...model, [key]: value };
      }),
    }));
  };

  const removeModel = (index) => {
    setForm(prev => ({
      ...prev,
      models: prev.models.filter((_, i) => i !== index),
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const payload = {
        name: form.name.trim(),
        image: (form.image || '').trim(),
        is_featured: form.is_featured,
        models: form.models
          .map(model => ({
            _id: model._id,
            name: String(model.name || '').trim(),
            years: parseYearsInput(model.yearsInput),
          }))
          .filter(model => model.name),
      };

      if (!payload.name) {
        throw new Error('Car brand name is required');
      }

      if (editingId) {
        await adminApi.updateCarBrandAdmin(editingId, payload);
      } else {
        await adminApi.addCarBrandAdmin(payload);
      }

      closeModal();
      await load();
    } catch (err) {
      setError(err.message || 'Failed to save car brand');
    } finally {
      setSaving(false);
    }
  };

  const removeBrand = async (brand) => {
    const ok = confirm(isAr ? 'هل تريد حذف هذه العلامة؟' : 'Are you sure you want to delete this car brand?');
    if (!ok) return;

    setDeletingId(brand._id);
    setError('');

    try {
      await adminApi.deleteCarBrandAdmin(brand._id);
      await load();
    } catch (err) {
      setError(err.message || 'Failed to delete car brand');
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
            {isAr ? 'إدارة ماركات السيارات' : 'Car Brands'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {isAr ? 'إدارة الماركات والموديلات وسنوات التصنيع.' : 'Manage brands, models, and production years.'}
          </p>
        </div>
        <button
          onClick={openAdd}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-marine-cyan hover:bg-marine-cyan-dark text-white rounded-xl font-bold"
        >
          <Plus size={18} />
          {isAr ? 'إضافة ماركة' : 'Add Car Brand'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl text-sm font-bold">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard icon={Car} label={isAr ? 'كل الماركات' : 'Total Brands'} value={carBrands.length} />
        <StatCard icon={Car} label={isAr ? 'كل الموديلات' : 'Total Models'} value={carBrands.reduce((sum, b) => sum + (b.models?.length || 0), 0)} tone="green" />
        <StatCard icon={Car} label={isAr ? 'كل السنوات' : 'Total Years'} value={carBrands.reduce((sum, b) => sum + (b.models || []).reduce((s, m) => s + normalizeYears(m.years || []).length, 0), 0)} tone="gray" />
      </div>

      <div className="bg-white dark:bg-[#14171A] rounded-xl border border-zinc-200 dark:border-white/5 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-zinc-100 dark:border-white/5">
          <div className="relative max-w-xl">
            <Search size={18} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={isAr ? 'ابحث بالماركة أو الموديل أو السنة' : 'Search by brand, model, or year'}
              className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl ps-10 pe-4 py-3 text-sm focus:outline-none focus:border-marine-cyan"
            />
          </div>
        </div>

        <div className="divide-y divide-zinc-100 dark:divide-white/5">
          {paginated.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <Car size={36} className="mx-auto text-zinc-300 mb-3" />
              <p className="text-zinc-500 font-semibold">{isAr ? 'لا توجد ماركات' : 'No car brands found'}</p>
            </div>
          ) : (
            paginated.map(brand => {
              const expanded = expandedId === brand._id;
              const models = brand.models || [];
              const totalYears = models.reduce((sum, m) => sum + normalizeYears(m.years || []).length, 0);

              return (
                <div key={brand._id} className="p-4 sm:p-5">
                  <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="font-black text-zinc-900 dark:text-white">{brand.name}</h3>
                        {brand.is_featured && <span className="px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-500 text-[10px] font-bold uppercase">{isAr ? 'مميزة' : 'Featured'}</span>}
                        <span className="text-xs font-semibold text-zinc-500">{models.length} {isAr ? 'موديل' : 'models'}</span>
                        <span className="text-xs font-semibold text-zinc-500">{totalYears} {isAr ? 'سنة' : 'years'}</span>
                      </div>
                      <p className="text-xs text-zinc-500">ID: {brand._id}</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setExpandedId(expanded ? '' : brand._id)}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-300"
                      >
                        <ChevronDown size={13} className={expanded ? 'rotate-180' : ''} />
                        {expanded ? (isAr ? 'إخفاء' : 'Hide') : (isAr ? 'تفاصيل' : 'Details')}
                      </button>
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

                  {expanded && (
                    <div className="mt-4 rounded-xl border border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02] p-4">
                      {models.length === 0 ? (
                        <p className="text-sm text-zinc-500">{isAr ? 'لا توجد موديلات مسجلة.' : 'No models configured.'}</p>
                      ) : (
                        <div className="space-y-3">
                          {models.map(model => (
                            <div key={model._id || model.name} className="rounded-lg bg-white dark:bg-[#14171A] border border-zinc-100 dark:border-white/5 p-3">
                              <p className="font-bold text-zinc-900 dark:text-white text-sm">{model.name}</p>
                              <p className="text-xs text-zinc-500 mt-1">
                                {normalizeYears(model.years || []).length ? normalizeYears(model.years || []).join(', ') : (isAr ? 'كل السنوات' : 'All years')}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
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
          <div className="w-full max-w-4xl bg-white dark:bg-[#14171A] rounded-2xl border border-zinc-200 dark:border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-5 border-b border-zinc-100 dark:border-white/5 shrink-0">
              <h2 className="text-lg font-black text-zinc-900 dark:text-white">
                {editingId ? (isAr ? 'تعديل ماركة سيارات' : 'Edit Car Brand') : (isAr ? 'إضافة ماركة سيارات' : 'Add Car Brand')}
              </h2>
              <button onClick={closeModal} className="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white rounded-xl hover:bg-zinc-50 dark:hover:bg-white/5">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={submit} className="p-5 space-y-5 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label={isAr ? 'اسم الماركة' : 'Brand Name'} required>
                  <input
                    required
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-marine-cyan"
                  />
                </Field>

                <div className="md:col-span-2">
                  <SingleImageUploader
                    label={isAr ? 'صورة الماركة' : 'Brand Image'}
                    value={form.image}
                    onChange={url => setForm({ ...form, image: url })}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="flex items-center gap-3 p-4 border border-zinc-200 dark:border-white/10 rounded-xl cursor-pointer hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                    <input
                      type="checkbox"
                      checked={form.is_featured}
                      onChange={e => setForm({ ...form, is_featured: e.target.checked })}
                      className="w-5 h-5 rounded text-marine-primary focus:ring-marine-cyan"
                    />
                    <div>
                      <p className="font-bold text-sm text-zinc-900 dark:text-white">{isAr ? 'عرض في الصفحة الرئيسية' : 'Show on Landing Page'}</p>
                      <p className="text-xs text-zinc-500">{isAr ? 'سيتم عرض هذه الماركة في شريط الماركات بالصفحة الرئيسية' : 'This brand will be displayed in the landing page brands slider'}</p>
                    </div>
                  </label>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 dark:border-white/10 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-black text-zinc-900 dark:text-white">{isAr ? 'الموديلات والسنوات' : 'Models & Years'}</h3>
                  <button
                    type="button"
                    onClick={addModel}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold bg-marine-cyan/10 text-marine-primary"
                  >
                    <Plus size={12} /> {isAr ? 'إضافة موديل' : 'Add Model'}
                  </button>
                </div>

                {form.models.length === 0 ? (
                  <p className="text-sm text-zinc-500">{isAr ? 'لا توجد موديلات، يمكنك إضافتها.' : 'No models yet. Add one or more models.'}</p>
                ) : (
                  <div className="space-y-3">
                    {form.models.map((model, idx) => (
                      <div key={`${model._id || 'new'}-${idx}`} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end rounded-xl border border-zinc-100 dark:border-white/5 p-3">
                        <Field label={isAr ? 'اسم الموديل' : 'Model Name'} required>
                          <input
                            required
                            value={model.name}
                            onChange={e => updateModel(idx, 'name', e.target.value)}
                            className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-marine-cyan"
                          />
                        </Field>

                        <Field label={isAr ? 'السنوات (مفصولة بفاصلة)' : 'Years (comma separated)'}>
                          <input
                            value={model.yearsInput}
                            onChange={e => updateModel(idx, 'yearsInput', e.target.value)}
                            placeholder="2015, 2016, 2017"
                            className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-marine-cyan"
                          />
                        </Field>

                        <button
                          type="button"
                          onClick={() => removeModel(idx)}
                          className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-zinc-200 dark:border-white/10 text-zinc-400 hover:text-red-500"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-zinc-100 dark:border-white/5 mt-4 shrink-0">
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
