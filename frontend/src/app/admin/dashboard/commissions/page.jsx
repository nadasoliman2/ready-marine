'use client';

import { useState, useEffect } from 'react';
import { useApp } from '../../../../context/AppContext';
import { Save, Loader2, Plus, Trash2 } from 'lucide-react';

const inputClass = 'w-full bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-2.5 focus:border-marine-cyan focus:ring-1 focus:ring-marine-cyan outline-none transition-colors';
const labelClass = 'block text-xs font-bold text-zinc-500 uppercase mb-2';

export default function CommissionsControl() {
  const { siteSettings, setSiteSettings, language } = useApp();
  const [formData, setFormData] = useState(null);
  const [categories, setCategories] = useState([]);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const isAr = language === 'ar';

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/products/categories`);
        const data = await res.json();
        if (Array.isArray(data)) {
          const flattenCategories = (cats, level = 0, result = []) => {
            cats.forEach(cat => {
              result.push({ ...cat, level });
              if (cat.subcategories && cat.subcategories.length > 0) {
                flattenCategories(cat.subcategories, level + 1, result);
              }
            });
            return result;
          };
          setCategories(flattenCategories(data));
        } else if (data.success && data.categories) {
          setCategories(data.categories);
        }
      } catch (err) {
        console.error('Failed to fetch categories:', err);
      }
    };
    fetchCategories();
  }, []);

  useEffect(() => {
    if (siteSettings) {
      setFormData({
        type: siteSettings.commission_settings?.type || 'fixed',
        fixed_rate: siteSettings.commission_settings?.fixed_rate || 0,
        category_rates: siteSettings.commission_settings?.category_rates || [],
      });
    }
  }, [siteSettings]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commission_settings: formData }),
        credentials: 'include'
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to save commission settings');

      setSiteSettings(data.settings);
      setSuccessMsg(isAr ? 'تم حفظ إعدادات العمولة بنجاح!' : 'Commission settings saved successfully!');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setSaving(false);
    }
  };

  const addCategoryRate = () => {
    setFormData(prev => ({
      ...prev,
      category_rates: [...prev.category_rates, { category_id: '', rate: 0 }]
    }));
  };

  const updateCategoryRate = (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      category_rates: prev.category_rates.map((item, i) => i === index ? { ...item, [field]: value } : item)
    }));
  };

  const removeCategoryRate = (index) => {
    setFormData(prev => ({
      ...prev,
      category_rates: prev.category_rates.filter((_, i) => i !== index)
    }));
  };

  if (!formData) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-marine-primary" size={30} /></div>;
  }

  return (
    <form onSubmit={handleSave} className="max-w-4xl">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-wide">
            {isAr ? 'إعدادات العمولات العامة' : 'Global Commissions'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {isAr ? 'تحكم بالعمولة الافتراضية المطبقة على جميع المبيعات.' : 'Manage default commission rates applied to all sales.'}
          </p>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 text-white rounded-xl font-bold shadow-lg shadow-red-500/20 transition-all"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          <span>{isAr ? 'حفظ التغييرات' : 'Save Changes'}</span>
        </button>
      </div>

      {successMsg && (
        <div className="bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 p-4 rounded-xl mb-6 font-medium">
          {successMsg}
        </div>
      )}

      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-xl mb-6 font-medium">
          {errorMsg}
        </div>
      )}

      <section className="bg-white dark:bg-[#09090b] p-6 rounded-xl border border-zinc-100 dark:border-white/5 shadow-sm mb-6">
        <h2 className="text-lg font-bold text-zinc-900 dark:text-white mb-4 border-b border-zinc-100 dark:border-white/5 pb-2">
          {isAr ? 'نوع العمولة' : 'Commission Type'}
        </h2>
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <label className="flex items-center gap-3 cursor-pointer">
            <input 
              type="radio" 
              name="type" 
              value="fixed" 
              checked={formData.type === 'fixed'} 
              onChange={() => setFormData({ ...formData, type: 'fixed' })} 
              className="w-4 h-4 accent-marine-cyan" 
            />
            <span className="text-sm font-medium">{isAr ? 'نسبة ثابتة على كل المنتجات' : 'Fixed Rate for All Products'}</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input 
              type="radio" 
              name="type" 
              value="category" 
              checked={formData.type === 'category'} 
              onChange={() => setFormData({ ...formData, type: 'category' })} 
              className="w-4 h-4 accent-marine-cyan" 
            />
            <span className="text-sm font-medium">{isAr ? 'نسبة متغيرة حسب التصنيف' : 'Variable based on Categories'}</span>
          </label>
        </div>

        {formData.type === 'fixed' && (
          <div>
            <label className={labelClass}>{isAr ? 'نسبة العمولة (%)' : 'Commission Rate (%)'}</label>
            <input 
              type="number" 
              min="0" 
              max="100" 
              step="0.01" 
              value={formData.fixed_rate} 
              onChange={e => setFormData({ ...formData, fixed_rate: Number(e.target.value) })} 
              className={inputClass} 
              style={{ maxWidth: '200px' }}
            />
            <p className="text-xs text-zinc-500 mt-2">
              {isAr ? 'سيتم تطبيق هذه النسبة على جميع المنتجات.' : 'This rate will be applied to all products.'}
            </p>
          </div>
        )}
      </section>

      {formData.type === 'category' && (
        <section className="bg-white dark:bg-[#09090b] p-6 rounded-xl border border-zinc-100 dark:border-white/5 shadow-sm">
          <div className="flex items-center justify-between mb-4 border-b border-zinc-100 dark:border-white/5 pb-2">
            <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
              {isAr ? 'عمولات التصنيفات' : 'Category Rates'}
            </h2>
            <button 
              type="button" 
              onClick={addCategoryRate} 
              className="inline-flex items-center gap-1.5 text-xs font-bold text-marine-primary hover:text-red-600"
            >
              <Plus size={14} />
              {isAr ? 'إضافة تصنيف' : 'Add Category'}
            </button>
          </div>

          <div className="mb-4">
            <label className={labelClass}>{isAr ? 'النسبة الافتراضية للغير مصنف (%)' : 'Default Rate for Others (%)'}</label>
            <input 
              type="number" 
              min="0" 
              max="100" 
              step="0.01" 
              value={formData.fixed_rate} 
              onChange={e => setFormData({ ...formData, fixed_rate: Number(e.target.value) })} 
              className={inputClass} 
              style={{ maxWidth: '200px' }}
            />
            <p className="text-xs text-zinc-500 mt-2 mb-4">
              {isAr ? 'تطبق هذه النسبة على المنتجات التي لا تندرج تحت التصنيفات المحددة أدناه.' : 'Applied to products not falling under the categories specified below.'}
            </p>
          </div>

          {formData.category_rates.length === 0 ? (
            <div className="text-sm text-zinc-500 italic py-4 text-center border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">
              {isAr ? 'لا يوجد تصنيفات محددة. سيتم تطبيق النسبة الافتراضية.' : 'No categories specified. Default rate will be applied.'}
            </div>
          ) : (
            <div className="space-y-3">
              {formData.category_rates.map((item, index) => (
                <div key={index} className="flex gap-2">
                  <select 
                    value={item.category_id} 
                    onChange={e => updateCategoryRate(index, 'category_id', e.target.value)} 
                    className={inputClass}
                  >
                    <option value="" disabled>{isAr ? '-- اختر تصنيف --' : '-- Select Category --'}</option>
                    {categories.map(cat => (
                      <option key={cat._id} value={cat._id}>
                        {'\u00A0\u00A0'.repeat(cat.level || 0)}{isAr ? cat.name_ar || cat.name : cat.name}
                      </option>
                    ))}
                  </select>
                  <input 
                    type="number" 
                    min="0" 
                    max="100" 
                    step="0.01" 
                    value={item.rate} 
                    onChange={e => updateCategoryRate(index, 'rate', Number(e.target.value))} 
                    placeholder="Rate %"
                    className={`${inputClass} w-32`} 
                  />
                  <button
                    type="button"
                    onClick={() => removeCategoryRate(index)}
                    className="h-[46px] w-[46px] shrink-0 inline-flex items-center justify-center rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-400 hover:text-red-500 hover:border-red-500/30"
                    aria-label={isAr ? 'حذف' : 'Remove'}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </form>
  );
}
