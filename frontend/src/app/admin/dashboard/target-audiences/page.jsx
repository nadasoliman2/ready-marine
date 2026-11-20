'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Sparkles, Loader2, Pencil, Plus, Save, Search, Trash2, X,
  SlidersHorizontal, Check, Eye, EyeOff, Layers, Package, LayoutGrid
} from 'lucide-react';
import { adminApi } from '../../../../lib/api';
import { matchScore } from '../../../../lib/searchSuggest';
import { useApp } from '../../../../context/AppContext';
import SingleImageUploader from '../../../../components/dashboard/SingleImageUploader';
import PaginationControls from '../../../../components/dashboard/PaginationControls';
import usePageSize from '../../../../lib/usePageSize';
import Overlay from '../../../../components/Overlay';

const POSITION_CONFIG = {
  large: {
    labelAr: 'بطاقة رئيسية كبرى',
    labelEn: 'Large Hero Tile',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
    descAr: 'تظهر كبطاقة رئيسية كبيرة تأخذ عمودين وصفين في سلايدر الهيرو',
    descEn: 'Dominant large tile (2 cols x 2 rows) rotating in hero',
  },
  small_top: {
    labelAr: 'بطاقة علوية مكدسة',
    labelEn: 'Small Top Tile',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
    descAr: 'تظهر في الزاوية العلوية بجانب البطاقة الكبرى',
    descEn: 'Stacked top right/left tile next to large card',
  },
  small_bottom: {
    labelAr: 'بطاقة سفلية مكدسة',
    labelEn: 'Small Bottom Tile',
    badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800',
    descAr: 'تظهر في الزاوية السفلية بجانب البطاقة الكبرى',
    descEn: 'Stacked bottom right/left tile next to large card',
  },
  hidden: {
    labelAr: 'مخفي من السلايدر',
    labelEn: 'Hidden from Slider',
    badgeClass: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
    descAr: 'لا تظهر في سلايدر الهيرو ولكن تتاح في تصنيف المنتجات وصفحة /hub',
    descEn: 'Not in hero slider, but accessible in filters & /hub/[slug]',
  },
};

const emptyForm = {
  name_ar: '',
  name_en: '',
  slug: '',
  badge_ar: '',
  badge_en: '',
  description_ar: '',
  description_en: '',
  image: '',
  card_position: 'large',
  sort_order: 1,
  is_active: true,
  slider_active: true,
};

export default function AdminTargetAudiencesPage() {
  const { language } = useApp();
  const isAr = language === 'ar';

  const [audiences, setAudiences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [positionFilter, setPositionFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('admin.targetAudiences', 12);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    setLoading(true);
    try {
      const data = await adminApi.getTargetAudiencesAdmin();
      setAudiences(data.audiences || []);
      setError('');
    } catch (err) {
      setError(err.message || (isAr ? 'فشل تحميل المجموعات' : 'Failed to load audiences'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreateModal = () => {
    setEditingId('');
    setForm({
      ...emptyForm,
      sort_order: audiences.length + 1,
    });
    setError('');
    setShowModal(true);
  };

  const openEditModal = (item) => {
    setEditingId(item._id);
    setForm({
      name_ar: item.name_ar || '',
      name_en: item.name_en || '',
      slug: item.slug || '',
      badge_ar: item.badge_ar || '',
      badge_en: item.badge_en || '',
      description_ar: item.description_ar || '',
      description_en: item.description_en || '',
      image: item.image || '',
      card_position: item.card_position || 'large',
      sort_order: item.sort_order ?? 1,
      is_active: item.is_active ?? true,
      slider_active: item.slider_active ?? true,
    });
    setError('');
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId('');
    setForm(emptyForm);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name_ar.trim() || !form.name_en.trim()) {
      setError(isAr ? 'الاسم باللغة العربية والإنجليزية مطلوب' : 'Arabic and English names are required');
      return;
    }

    setSaving(true);
    setError('');
    try {
      if (editingId) {
        await adminApi.updateTargetAudienceAdmin(editingId, form);
        setSuccess(isAr ? 'تم تحديث المجموعة بنجاح' : 'Audience updated successfully');
      } else {
        await adminApi.addTargetAudienceAdmin(form);
        setSuccess(isAr ? 'تم إنشاء المجموعة بنجاح' : 'Audience created successfully');
      }
      closeModal();
      await load();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err.message || (isAr ? 'حدث خطأ أثناء الحفظ' : 'Failed to save audience'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item) => {
    const confirmMsg = isAr
      ? `هل أنت متأكد من حذف المجموعة "${item.name_ar}"؟ سيتم فك ارتباطها من المنتجات.`
      : `Are you sure you want to delete "${item.name_en}"? Products will be unlinked.`;
    if (!window.confirm(confirmMsg)) return;

    setDeletingId(item._id);
    try {
      await adminApi.deleteTargetAudienceAdmin(item._id);
      setSuccess(isAr ? 'تم حذف المجموعة بنجاح' : 'Audience deleted successfully');
      await load();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err.message || (isAr ? 'فشل حذف المجموعة' : 'Failed to delete audience'));
    } finally {
      setDeletingId('');
    }
  };

  const toggleStatus = async (item, field) => {
    try {
      const updatedValue = !item[field];
      await adminApi.updateTargetAudienceAdmin(item._id, { [field]: updatedValue });
      setAudiences((prev) =>
        prev.map((a) => (a._id === item._id ? { ...a, [field]: updatedValue } : a))
      );
    } catch (err) {
      setError(err.message || (isAr ? 'فشل تغيير الحالة' : 'Failed to toggle status'));
    }
  };

  // Filter & Search
  const filtered = useMemo(() => {
    let list = [...audiences];
    if (positionFilter !== 'all') {
      list = list.filter((a) => a.card_position === positionFilter);
    }
    const q = search.trim();
    if (!q) return list;
    return list
      .map((item) => {
        const text = `${item.name_ar || ''} ${item.name_en || ''} ${item.key || ''} ${item.slug || ''} ${item.badge_ar || ''}`;
        return { item, score: matchScore(text, q) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
  }, [audiences, positionFilter, search]);

  const totalPages = Math.ceil(filtered.length / pageSize) || 1;
  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  // Overall Stats
  const stats = useMemo(() => {
    const total = audiences.length;
    const activeInSlider = audiences.filter((a) => a.is_active && a.slider_active && a.card_position !== 'hidden').length;
    const largeCount = audiences.filter((a) => a.card_position === 'large' && a.is_active).length;
    const totalProducts = audiences.reduce((sum, a) => sum + (a.products_count || 0), 0);
    return { total, activeInSlider, largeCount, totalProducts };
  }, [audiences]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2.5 bg-sky-50 text-marine-cyan rounded-xl dark:bg-zinc-800 dark:text-marine-cyan border border-sky-100 dark:border-zinc-700">
              <Sparkles className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-black text-gray-900 dark:text-white">
              {isAr ? 'المجموعات المخصصة وسلايدر الهيرو' : 'Custom Audiences & Hero Slider'}
            </h1>
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {isAr
              ? 'إدارة المجموعات التسويقية المتخصصة للمنتجات البحرية وتوزيعها في بطاقات السلايدر التفاعلي بالصفحة الرئيسية'
              : 'Manage specialized marine audiences, linked products, and their dynamic placement in the hero auto-slider'}
          </p>
        </div>

        <button
          onClick={openCreateModal}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-marine-cyan hover:bg-marine-cyan-dark text-white rounded-xl font-bold shadow-md shadow-marine-cyan/20 transition-all active:scale-95 text-sm"
        >
          <Plus className="w-4 h-4" />
          <span>{isAr ? 'إضافة مجموعة جديدة' : 'Add New Audience'}</span>
        </button>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-zinc-900 rounded-2xl p-4 border border-gray-200/80 dark:border-zinc-800 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
            {isAr ? 'إجمالي المجموعات' : 'Total Audiences'}
          </p>
          <p className="text-2xl font-black text-gray-900 dark:text-white mt-1">{stats.total}</p>
        </div>
        <div className="bg-white dark:bg-zinc-900 rounded-2xl p-4 border border-gray-200/80 dark:border-zinc-800 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
            {isAr ? 'مفعلة بسلايدر الهيرو' : 'Active in Hero Slider'}
          </p>
          <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{stats.activeInSlider}</p>
        </div>
        <div className="bg-white dark:bg-zinc-900 rounded-2xl p-4 border border-gray-200/80 dark:border-zinc-800 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
            {isAr ? 'بطاقات كبرى دوارة' : 'Large Rotating Cards'}
          </p>
          <p className="text-2xl font-black text-marine-cyan mt-1">{stats.largeCount}</p>
        </div>
        <div className="bg-white dark:bg-zinc-900 rounded-2xl p-4 border border-gray-200/80 dark:border-zinc-800 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
            {isAr ? 'إجمالي ارتباطات المنتجات' : 'Linked Products'}
          </p>
          <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1">{stats.totalProducts}</p>
        </div>
      </div>

      {/* Alerts */}
      {success && (
        <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 rounded-xl text-sm border border-emerald-200 dark:border-emerald-800 flex items-center justify-between">
          <span>{success}</span>
          <button onClick={() => setSuccess('')}><X className="w-4 h-4" /></button>
        </div>
      )}
      {error && (
        <div className="p-3.5 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 rounded-xl text-sm border border-red-200 dark:border-red-800 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Filters & Search */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl p-4 border border-gray-200/80 dark:border-zinc-800 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-gray-400 absolute top-1/2 -translate-y-1/2 start-3" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={isAr ? 'بحث بالاسم، الكود، أو الشارة...' : 'Search by name, key, or badge...'}
            className="w-full ps-9 pe-4 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-marine-cyan focus:border-marine-cyan dark:text-white"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <span className="text-xs text-gray-500 font-bold">{isAr ? 'الموقع في الهيرو:' : 'Position:'}</span>
          {['all', 'large', 'small_top', 'small_bottom', 'hidden'].map((pos) => (
            <button
              key={pos}
              onClick={() => { setPositionFilter(pos); setPage(1); }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                positionFilter === pos
                  ? 'bg-marine-cyan text-white shadow-sm'
                  : 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300'
              }`}
            >
              {pos === 'all'
                ? (isAr ? 'الكل' : 'All')
                : (isAr ? POSITION_CONFIG[pos]?.labelAr : POSITION_CONFIG[pos]?.labelEn)}
            </button>
          ))}
        </div>
      </div>

      {/* Table / List View */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-gray-200/80 dark:border-zinc-800 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center text-gray-500">
            <Loader2 className="w-8 h-8 animate-spin text-marine-cyan mb-2" />
            <p className="text-sm font-medium">{isAr ? 'جاري تحميل المجموعات المخصصة...' : 'Loading audiences...'}</p>
          </div>
        ) : paginated.length === 0 ? (
          <div className="py-16 text-center text-gray-500">
            <Sparkles className="w-10 h-10 mx-auto text-gray-400 mb-3" />
            <p className="text-base font-bold text-gray-700 dark:text-gray-300">{isAr ? 'لم يتم العثور على مجموعات' : 'No audiences found'}</p>
            <p className="text-sm text-gray-400 mt-1">
              {search ? (isAr ? 'جرب البحث بكلمات أخرى' : 'Try searching for other terms') : (isAr ? 'ابدأ بإضافة أول مجموعة مخصصة' : 'Start by adding a new audience')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-600 dark:text-gray-400 font-medium text-xs border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="py-3 px-4 text-start">{isAr ? 'المجموعة' : 'Audience'}</th>
                  <th className="py-3 px-4 text-start">{isAr ? 'المعرّف والرابط' : 'Key / Slug'}</th>
                  <th className="py-3 px-4 text-start">{isAr ? 'موقع البطاقة' : 'Card Position'}</th>
                  <th className="py-3 px-4 text-center">{isAr ? 'المنتجات' : 'Products'}</th>
                  <th className="py-3 px-4 text-center">{isAr ? 'الترتيب' : 'Order'}</th>
                  <th className="py-3 px-4 text-center">{isAr ? 'في السلايدر' : 'Slider'}</th>
                  <th className="py-3 px-4 text-center">{isAr ? 'الحالة' : 'Active'}</th>
                  <th className="py-3 px-4 text-end">{isAr ? 'الإجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
                {paginated.map((item) => {
                  const posCfg = POSITION_CONFIG[item.card_position] || POSITION_CONFIG.large;
                  return (
                    <tr key={item._id} className="hover:bg-gray-50/80 dark:hover:bg-gray-700/30 transition-colors">
                      {/* Name & Image & Badge */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-lg bg-gray-100 dark:bg-gray-700 overflow-hidden shrink-0 border border-gray-200 dark:border-gray-600 flex items-center justify-center">
                            {item.image ? (
                              <img src={item.image} alt={item.name_ar} className="w-full h-full object-cover" />
                            ) : (
                              <Sparkles className="w-5 h-5 text-gray-400" />
                            )}
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900 dark:text-white">
                              {isAr ? item.name_ar : item.name_en}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {isAr ? item.name_en : item.name_ar}
                            </div>
                            {(item.badge_ar || item.badge_en) && (
                              <span className="inline-block mt-0.5 px-2 py-0.5 text-[10px] rounded bg-marine-50 text-marine-700 dark:bg-marine-950/60 dark:text-marine-300 font-medium">
                                {isAr ? item.badge_ar || item.badge_en : item.badge_en || item.badge_ar}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Key & Slug */}
                      <td className="py-3 px-4">
                        <div className="font-mono text-xs text-gray-700 dark:text-gray-300">{item.key}</div>
                        <div className="text-[11px] text-gray-400">/hub/{item.slug}</div>
                      </td>

                      {/* Card Position */}
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${posCfg.badgeClass}`}>
                          <span>{isAr ? posCfg.labelAr : posCfg.labelEn}</span>
                        </span>
                      </td>

                      {/* Products Count */}
                      <td className="py-3 px-4 text-center">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                          <Package className="w-3 h-3 text-gray-400" />
                          <span>{item.products_count ?? 0}</span>
                        </span>
                      </td>

                      {/* Sort Order */}
                      <td className="py-3 px-4 text-center font-mono text-xs text-gray-600 dark:text-gray-400">
                        {item.sort_order ?? 0}
                      </td>

                      {/* Slider Active Toggle */}
                      <td className="py-3 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => toggleStatus(item, 'slider_active')}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                            item.slider_active
                              ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300'
                              : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400'
                          }`}
                          title={isAr ? 'تبديل الظهور في السلايدر' : 'Toggle in Hero Slider'}
                        >
                          {item.slider_active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                          <span>{item.slider_active ? (isAr ? 'ظاهر' : 'Shown') : (isAr ? 'معطل' : 'Off')}</span>
                        </button>
                      </td>

                      {/* General Active Toggle */}
                      <td className="py-3 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => toggleStatus(item, 'is_active')}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                            item.is_active
                              ? 'bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300'
                              : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400'
                          }`}
                          title={isAr ? 'تبديل التفعيل العام' : 'Toggle active state'}
                        >
                          <span>{item.is_active ? (isAr ? 'نشط' : 'Active') : (isAr ? 'معطل' : 'Inactive')}</span>
                        </button>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-end">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEditModal(item)}
                            className="p-1.5 text-gray-600 hover:text-marine-600 hover:bg-marine-50 dark:text-gray-400 dark:hover:text-marine-300 dark:hover:bg-gray-700 rounded-md transition-colors"
                            title={isAr ? 'تعديل' : 'Edit'}
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(item)}
                            disabled={deletingId === item._id}
                            className="p-1.5 text-gray-600 hover:text-red-600 hover:bg-red-50 dark:text-gray-400 dark:hover:text-red-400 dark:hover:bg-gray-700 rounded-md transition-colors disabled:opacity-50"
                            title={isAr ? 'حذف' : 'Delete'}
                          >
                            {deletingId === item._id ? (
                              <Loader2 className="w-4 h-4 animate-spin text-red-600" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && filtered.length > 0 && (
          <div className="p-4 border-t border-gray-200 dark:border-gray-700">
            <PaginationControls
              page={page}
              totalPages={totalPages}
              totalItems={filtered.length}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <Overlay
          className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
          dir={isAr ? 'rtl' : 'ltr'}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="relative w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden flex flex-col max-h-[92vh] my-auto animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between shrink-0 bg-white dark:bg-zinc-900">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-marine-cyan/10 text-marine-cyan flex items-center justify-center">
                  <Sparkles className="w-5 h-5" />
                </div>
                <h3 className="font-black text-lg text-gray-900 dark:text-white">
                  {editingId
                    ? (isAr ? 'تعديل المجموعة المخصصة' : 'Edit Custom Audience')
                    : (isAr ? 'إضافة مجموعة مخصصة جديدة' : 'Add New Custom Audience')}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="p-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-xl hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSave} className="flex flex-col flex-1 min-h-0">
              <div className="p-6 overflow-y-auto space-y-4 flex-1">
                {/* Names */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {isAr ? 'الاسم بالعربية *' : 'Arabic Name *'}
                    </label>
                    <input
                      type="text"
                      required
                      value={form.name_ar}
                      onChange={(e) => setForm({ ...form, name_ar: e.target.value })}
                      placeholder="مثال: مستلزمات اليخوت الفاخرة"
                      className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-marine-cyan focus:border-marine-cyan dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {isAr ? 'الاسم بالإنجليزية *' : 'English Name *'}
                    </label>
                    <input
                      type="text"
                      required
                      value={form.name_en}
                      onChange={(e) => setForm({ ...form, name_en: e.target.value })}
                      placeholder="e.g. Premium Yacht Luxury"
                      className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-marine-cyan focus:border-marine-cyan dark:text-white"
                    />
                  </div>
                </div>

                {/* Slug / Key */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {isAr ? 'الرابط المخصص (Slug) - اختياري' : 'Custom Slug (Optional)'}
                  </label>
                  <input
                    type="text"
                    value={form.slug}
                    onChange={(e) => setForm({ ...form, slug: e.target.value })}
                    placeholder="e.g. yacht-luxury (اتركه فارغاً للتوليد التلقائي)"
                    className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-marine-cyan focus:border-marine-cyan dark:text-white"
                  />
                </div>

                {/* Badges */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {isAr ? 'الشارة بالعربية (Badge)' : 'Arabic Badge'}
                    </label>
                    <input
                      type="text"
                      value={form.badge_ar}
                      onChange={(e) => setForm({ ...form, badge_ar: e.target.value })}
                      placeholder="مثال: فخامة واعتناء فائق"
                      className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-marine-cyan focus:border-marine-cyan dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {isAr ? 'الشارة بالإنجليزية (Badge)' : 'English Badge'}
                    </label>
                    <input
                      type="text"
                      value={form.badge_en}
                      onChange={(e) => setForm({ ...form, badge_en: e.target.value })}
                      placeholder="e.g. Ultra-Luxury VIP"
                      className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-marine-cyan focus:border-marine-cyan dark:text-white"
                    />
                  </div>
                </div>

                {/* Descriptions */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {isAr ? 'الوصف بالعربية' : 'Arabic Description'}
                    </label>
                    <textarea
                      rows={2}
                      value={form.description_ar}
                      onChange={(e) => setForm({ ...form, description_ar: e.target.value })}
                      placeholder="شرح موجز لمحتويات المجموعة..."
                      className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-marine-cyan focus:border-marine-cyan dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {isAr ? 'الوصف بالإنجليزية' : 'English Description'}
                    </label>
                    <textarea
                      rows={2}
                      value={form.description_en}
                      onChange={(e) => setForm({ ...form, description_en: e.target.value })}
                      placeholder="Short description of the audience hub..."
                      className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-marine-cyan focus:border-marine-cyan dark:text-white"
                    />
                  </div>
                </div>

                {/* Image Upload */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                    {isAr ? 'صورة المجموعة / بطاقة السلايدر' : 'Audience / Slider Card Image'}
                  </label>
                  <SingleImageUploader
                    value={form.image}
                    onChange={(url) => setForm({ ...form, image: url })}
                  />
                </div>

                {/* Card Position Selector */}
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-2">
                    {isAr ? 'موقع البطاقة في سلايدر الهيرو (Hero Auto-Slider Position) *' : 'Hero Slider Card Position *'}
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {Object.entries(POSITION_CONFIG).map(([posKey, posInfo]) => {
                      const isSelected = form.card_position === posKey;
                      return (
                        <div
                          key={posKey}
                          onClick={() => setForm({ ...form, card_position: posKey })}
                          className={`p-3.5 rounded-2xl border-2 cursor-pointer transition-all ${
                            isSelected
                              ? 'border-marine-cyan bg-sky-50/70 dark:bg-marine-cyan/10 shadow-xs'
                              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-zinc-800'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-xs text-gray-900 dark:text-white">
                              {isAr ? posInfo.labelAr : posInfo.labelEn}
                            </span>
                            {isSelected && (
                              <span className="w-4 h-4 rounded-full bg-marine-cyan text-white flex items-center justify-center text-[10px]">
                                <Check className="w-3 h-3" />
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                            {isAr ? posInfo.descAr : posInfo.descEn}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Sort order & Toggles */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      {isAr ? 'ترتيب الظهور' : 'Sort Order'}
                    </label>
                    <input
                      type="number"
                      value={form.sort_order}
                      onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value, 10) || 0 })}
                      className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-marine-cyan focus:border-marine-cyan dark:text-white"
                    />
                  </div>

                  <div className="flex items-center sm:pt-6">
                    <label className="relative flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={form.slider_active}
                        onChange={(e) => setForm({ ...form, slider_active: e.target.checked })}
                        className="w-4 h-4 text-marine-cyan border-gray-300 rounded focus:ring-marine-cyan"
                      />
                      <span className="text-xs font-bold text-gray-700 dark:text-gray-300">
                        {isAr ? 'تفعيل في سلايدر الهيرو' : 'Active in Hero Slider'}
                      </span>
                    </label>
                  </div>

                  <div className="flex items-center sm:pt-6">
                    <label className="relative flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={form.is_active}
                        onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                        className="w-4 h-4 text-marine-cyan border-gray-300 rounded focus:ring-marine-cyan"
                      />
                      <span className="text-xs font-bold text-gray-700 dark:text-gray-300">
                        {isAr ? 'تفعيل المجموعة ككل' : 'Globally Active'}
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Modal Actions Footer - Pinned */}
              <div className="px-6 py-4 border-t border-gray-100 dark:border-zinc-800 bg-gray-50/80 dark:bg-zinc-800/50 flex items-center justify-end gap-3 shrink-0">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2.5 text-sm font-bold text-gray-600 dark:text-gray-400 hover:bg-gray-200/60 dark:hover:bg-zinc-700 rounded-xl transition-colors"
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-6 py-2.5 text-sm bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold rounded-xl shadow-md shadow-marine-cyan/20 transition-all active:scale-95 disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  <span>{isAr ? 'حفظ المجموعة' : 'Save Audience'}</span>
                </button>
              </div>
            </form>
          </div>
        </Overlay>
      )}
    </div>
  );
}
