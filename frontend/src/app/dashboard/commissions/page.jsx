'use client';

import { useState, useEffect } from 'react';
import { vendorApi } from '../../../lib/api';
import { useApp } from '../../../context/AppContext';
import { Loader2, Info, Percent, ChevronRight } from 'lucide-react';

export default function VendorCommissionsPage() {
  const { language, siteSettings } = useApp();
  const isAr = language === 'ar';
  const currency = siteSettings?.currency || 'QAR';

  const [loading, setLoading] = useState(true);
  const [vendorComm, setVendorComm] = useState(null);
  const [globalComm, setGlobalComm] = useState(null);
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [profileRes, settingsRes, catsRes] = await Promise.all([
          vendorApi.getProfile(),
          vendorApi.getSettings(),
          vendorApi.getCategories()
        ]);
        
        setVendorComm(profileRes.commission_settings || { is_custom: false });
        setGlobalComm(settingsRes.settings?.commission_settings || { type: 'fixed', fixed_rate: 0, category_rates: [] });
        setCategories(catsRes || []);
      } catch (err) {
        setError(isAr ? 'تعذر تحميل بيانات العمولات.' : (err.message || 'Failed to load commission data.'));
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center min-h-[400px]">
        <Loader2 size={32} className="animate-spin text-marine-primary" />
      </div>
    );
  }

  const activeComm = (vendorComm?.is_custom) ? vendorComm : globalComm;
  const isCustom = vendorComm?.is_custom;

  const getCategoryName = (id) => {
    const flattenCategories = (cats) => {
      let result = [];
      cats.forEach(cat => {
        result.push(cat);
        if (cat.subcategories) result = [...result, ...flattenCategories(cat.subcategories)];
      });
      return result;
    };
    const flat = flattenCategories(categories);
    const cat = flat.find(c => c._id === id);
    return cat ? (isAr ? cat.name_ar || cat.name : cat.name) : id;
  };

  return (
    <div className="max-w-4xl mx-auto pb-12 animate-in fade-in duration-300">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">
          {isAr ? 'نسب العمولات' : 'Commission Rates'}
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          {isAr ? 'استعرض نسب العمولة المطبقة على مبيعات متجرك' : 'View the commission rates applied to your store sales.'}
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
          <Info size={16} /> {error}
        </div>
      )}

      {/* Status Banner */}
      <div className={`mb-8 p-6 rounded-2xl border ${isCustom ? 'bg-amber-500/5 border-amber-500/20' : 'bg-blue-500/5 border-blue-500/20'} flex items-start gap-4`}>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${isCustom ? 'bg-amber-500/20 text-amber-600' : 'bg-blue-500/20 text-blue-600'}`}>
          <Percent size={24} />
        </div>
        <div>
          <h3 className={`font-bold text-lg ${isCustom ? 'text-amber-700 dark:text-amber-400' : 'text-blue-700 dark:text-blue-400'}`}>
            {isCustom 
              ? (isAr ? 'أنت تعمل بنظام عمولة خاص بمتجرك' : 'You are using custom commission rates')
              : (isAr ? 'أنت تعمل بنظام العمولة العام للمنصة' : 'You are using global platform commission rates')}
          </h3>
          <p className="text-sm opacity-80 mt-1">
            {isCustom 
              ? (isAr ? 'لقد تم تحديد نسب خاصة لك من قبل الإدارة.' : 'Specific rates have been set for your store by the administration.')
              : (isAr ? 'يتم تطبيق النسب الافتراضية للمنصة على جميع مبيعاتك.' : 'Standard platform rates apply to all your sales.')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Type Info */}
        <div className="md:col-span-1 space-y-6">
          <div className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl p-6 shadow-sm">
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-4">
              {isAr ? 'نوع الحساب' : 'Calculation Type'}
            </h4>
            <div className="flex items-center justify-between">
              <span className="font-black text-zinc-900 dark:text-white capitalize">
                {activeComm.type === 'fixed' ? (isAr ? 'ثابت' : 'Fixed') : (isAr ? 'متغير حسب التصنيف' : 'Variable per Category')}
              </span>
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>
          </div>

          <div className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl p-6 shadow-sm">
            <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-4">
              {isAr ? 'النسبة الأساسية' : 'Base Rate'}
            </h4>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-black text-marine-primary">{activeComm.fixed_rate}%</span>
              {activeComm.type === 'category' && (
                <span className="text-xs text-zinc-400 font-bold">({isAr ? 'الافتراضي' : 'Default'})</span>
              )}
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              {isAr ? 'تطبق على المنتجات التي لا تتبع تصنيفات مخصصة.' : 'Applied to items without specific category rates.'}
            </p>
          </div>
        </div>

        {/* Detailed Rates */}
        <div className="md:col-span-2">
          <div className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl shadow-sm overflow-hidden h-full">
            <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
              <h3 className="font-bold text-zinc-900 dark:text-white flex items-center gap-2">
                {isAr ? 'تفاصيل العمولات حسب التصنيف' : 'Category-Specific Rates'}
              </h3>
            </div>
            
            <div className="divide-y divide-zinc-100 dark:divide-white/5">
              {activeComm.type === 'category' && activeComm.category_rates?.length > 0 ? (
                activeComm.category_rates.map((rate, idx) => (
                  <div key={idx} className="px-6 py-4 flex items-center justify-between hover:bg-zinc-50 dark:hover:bg-white/[0.01] transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-white/5 flex items-center justify-center text-zinc-400">
                        <ChevronRight size={14} />
                      </div>
                      <span className="font-bold text-zinc-900 dark:text-white text-sm">
                        {getCategoryName(rate.category_id)}
                      </span>
                    </div>
                    <span className="text-lg font-black text-marine-primary">{rate.rate}%</span>
                  </div>
                ))
              ) : (
                <div className="p-12 text-center text-zinc-500">
                  <Percent size={32} className="mx-auto mb-3 opacity-20" />
                  <p className="text-sm font-medium">
                    {activeComm.type === 'fixed' 
                      ? (isAr ? 'يتم تطبيق النسبة الثابتة على جميع التصنيفات.' : 'Fixed rate applies to all categories.')
                      : (isAr ? 'لا توجد استثناءات مخصصة للتصنيفات.' : 'No specific category overrides found.')}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Disclaimer */}
      <div className="mt-8 text-center">
        <p className="text-xs text-zinc-400 italic">
          {isAr 
            ? '* يتم احتساب العمولة بناءً على سعر المنتج الصافي (بعد خصم كوبونات التخفيض). بعض الكوبونات بيتحمّل التاجر نسبة من قيمة خصمها، وبتظهر على كل طرد وفي المحفظة كـ "نصيبك من الكوبون".'
            : '* Commissions are calculated based on the net product price (after coupon discounts). Some coupons are partly vendor-funded; that share is shown on each parcel and in the wallet as "your share of the coupon".'}
        </p>
      </div>
    </div>
  );
}
