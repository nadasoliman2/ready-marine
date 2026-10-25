'use client';

import { storePath } from '../../../lib/storeLink';
import { useState, useEffect, useCallback } from 'react';
import { vendorAdApi, vendorApi } from '../../../lib/api';
import { useApp } from '../../../context/AppContext';
import { resolveAssetUrl } from '../../../lib/assets';
import SingleImageUploader from '../../../components/dashboard/SingleImageUploader';
import { Loader2, Info, Plus, X, Megaphone, ImageIcon, TrendingUp, Store, Lock, Eye, MousePointerClick, BarChart3 } from 'lucide-react';
import AdAnalyticsPanel from '../../../components/dashboard/AdAnalyticsPanel';
import Overlay from '../../../components/Overlay';

const STATUS_STYLES = {
  pending: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  approved: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  rejected: 'bg-red-500/10 text-red-600 dark:text-red-400',
  cancelled: 'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400',
  expired: 'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400',
};

// UI ad-type cards. `serviceFree` types are allowed without a subscription.
const AD_TYPES = [
  { key: 'service_banner', type: 'banner', subject: 'service', serviceFree: true, icon: ImageIcon,
    en: 'Service Banner', ar: 'بانر خدمة', descEn: 'Promote a service in the homepage banner.', descAr: 'روّج لخدمة في بانر الصفحة الرئيسية.' },
  { key: 'banner', type: 'banner', subject: 'product', serviceFree: false, icon: ImageIcon,
    en: 'Product / Store Banner', ar: 'بانر منتج/متجر', descEn: 'A banner promoting your product or store.', descAr: 'بانر يروّج لمنتجك أو متجرك.' },
  { key: 'product_visibility', type: 'product_visibility', serviceFree: false, icon: TrendingUp,
    en: 'Product Visibility', ar: 'إبراز منتج', descEn: 'Boost a product to the top of listings (Sponsored).', descAr: 'إبراز منتج أعلى القوائم (مموّل).' },
  { key: 'featured_vendor', type: 'featured_vendor', serviceFree: false, icon: Store,
    en: 'Featured Vendor', ar: 'بائع مميّز', descEn: 'Feature your store on the homepage / vendors page.', descAr: 'إبراز متجرك في الرئيسية / صفحة البائعين.' },
];

const PRODUCT_PLACEMENTS = [
  { key: 'category_top', en: 'Top of its category', ar: 'أعلى تصنيفه' },
  { key: 'shop_top', en: 'Top of all products', ar: 'أعلى كل المنتجات' },
  { key: 'promoted_section', en: 'Promoted Products row', ar: 'صف المنتجات المموّلة' },
  { key: 'most_sold', en: 'Most Sold row', ar: 'صف الأكثر مبيعًا' },
  { key: 'new_arrivals', en: 'New Arrivals row', ar: 'صف وصل حديثًا' },
  { key: 'special_offers', en: 'Special Offers row', ar: 'صف العروض' },
];

const VENDOR_PLACEMENTS = [
  { key: 'home', en: 'Homepage vendors slider', ar: 'سلايدر البائعين بالرئيسية' },
  { key: 'vendors_page', en: 'Vendors directory (top)', ar: 'أعلى دليل البائعين' },
];

const emptyForm = { banner_image: '', subject_type: 'product', product_id: '', link_url: '', placements: [], vendor_placements: [], vendor_note: '' };

export default function VendorAdsPage() {
  const { language } = useApp();
  const isAr = language === 'ar';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ads, setAds] = useState([]);
  const [products, setProducts] = useState([]);
  const [storeUsername, setStoreUsername] = useState('');
  const [subscribed, setSubscribed] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [statsAd, setStatsAd] = useState(null);
  const statsAdId = statsAd?._id;
  const loadAnalytics = useCallback((params) => vendorAdApi.getAdAnalytics(statsAdId, params), [statsAdId]);
  const [step, setStep] = useState(1);
  const [adType, setAdType] = useState(null); // AD_TYPES entry
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString(isAr ? 'ar-EG' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
  const statusLabel = (s) => (isAr
    ? { pending: 'قيد المراجعة', approved: 'منشور', rejected: 'مرفوض', cancelled: 'ملغي', expired: 'منتهي' }
    : { pending: 'Pending', approved: 'Live', rejected: 'Rejected', cancelled: 'Cancelled', expired: 'Expired' })[s] || s;
  const typeLabel = (ad) => {
    if (ad.type === 'product_visibility') return isAr ? 'إبراز منتج' : 'Product Visibility';
    if (ad.type === 'featured_vendor') return isAr ? 'بائع مميّز' : 'Featured Vendor';
    if (ad.subject_type === 'service') return isAr ? 'بانر خدمة' : 'Service Banner';
    return isAr ? 'بانر' : 'Banner';
  };

  const productSlug = (p) => p?.slug_en || p?.slug_ar || '';
  const productTitle = (p) => (isAr ? (p?.title_ar || p?.title_en) : (p?.title_en || p?.title_ar)) || (isAr ? 'منتج' : 'Product');

  const loadData = async () => {
    try {
      const [adsRes, productsRes, profileRes] = await Promise.all([
        vendorAdApi.getAds({ limit: 50 }),
        vendorApi.getProducts().catch(() => []),
        vendorApi.getProfile().catch(() => null),
      ]);
      setAds(adsRes.ads || []);
      setProducts(Array.isArray(productsRes) ? productsRes : (productsRes?.products || []));
      setStoreUsername(profileRes?.store_slug || profileRes?.store_username || '');
      setSubscribed(['active', 'trial_active'].includes(profileRes?.subscription_status));
    } catch (err) {
      setError(isAr ? 'تعذر تحميل الإعلانات.' : (err.message || 'Failed to load ads.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const openWizard = () => { setForm(emptyForm); setAdType(null); setStep(1); setError(''); setShowModal(true); };

  const pickType = (t) => {
    if (!t.serviceFree && !subscribed) return;
    setAdType(t);
    setForm({ ...emptyForm, subject_type: t.subject || 'product' });
    setStep(2);
  };

  const togglePlacement = (field, key) => {
    setForm((f) => {
      const arr = f[field];
      return { ...f, [field]: arr.includes(key) ? arr.filter((k) => k !== key) : [...arr, key] };
    });
  };

  const onSubjectChange = (subject_type) => {
    setForm((f) => {
      let link_url = f.link_url;
      if (subject_type === 'store') link_url = storeUsername ? storePath(storeUsername) : '';
      else if (subject_type === 'product') {
        const p = products.find((x) => x._id === f.product_id);
        link_url = p ? `/product/${productSlug(p)}` : '';
      }
      return { ...f, subject_type, link_url };
    });
  };

  const onBannerProductChange = (product_id) => {
    const p = products.find((x) => x._id === product_id);
    setForm((f) => ({ ...f, product_id, link_url: p ? `/product/${productSlug(p)}` : f.link_url }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload = { type: adType.type, vendor_note: form.vendor_note };
      if (adType.type === 'banner') {
        payload.subject_type = adType.subject === 'service' ? 'service' : form.subject_type;
        payload.banner_image = form.banner_image;
        payload.link_url = form.link_url;
        payload.product_id = payload.subject_type === 'product' ? (form.product_id || null) : null;
      } else if (adType.type === 'product_visibility') {
        payload.product_id = form.product_id || null;
        payload.placements = form.placements;
      } else if (adType.type === 'featured_vendor') {
        payload.vendor_placements = form.vendor_placements;
      }
      await vendorAdApi.createAd(payload);
      setShowModal(false);
      setLoading(true);
      await loadData();
    } catch (err) {
      setError(isAr ? 'تعذر إرسال طلب الإعلان. يرجى مراجعة البيانات.' : (err.message || 'Failed to submit ad request.'));
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async (id) => {
    try {
      await vendorAdApi.cancelAd(id);
      setLoading(true);
      await loadData();
    } catch (err) {
      setError(isAr ? 'تعذر إلغاء طلب الإعلان.' : (err.message || 'Failed to cancel ad request.'));
    }
  };

  if (loading) {
    return <div className="h-full flex items-center justify-center min-h-[400px]"><Loader2 size={32} className="animate-spin text-marine-primary" /></div>;
  }

  const isBanner = adType?.type === 'banner';
  const isService = adType?.subject === 'service';
  const canSubmit = !submitting && (
    isBanner ? (form.banner_image && form.link_url)
      : adType?.type === 'product_visibility' ? (form.product_id && form.placements.length)
      : adType?.type === 'featured_vendor' ? form.vendor_placements.length
      : false
  );

  return (
    <div className="max-w-5xl mx-auto pb-12 animate-in fade-in duration-300" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">{isAr ? 'الإعلانات' : 'Advertising'}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            {isAr
              ? 'اطلب إعلانات لمنتجاتك أو متجرك. تتم مراجعتها وتحديد مدتها من الإدارة. (يتم تنسيق السعر مع مدير حسابك.)'
              : 'Request ads for your products or store. Admin reviews & schedules them. (Pricing is arranged with your account manager.)'}
          </p>
        </div>
        <button onClick={openWizard} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-marine-cyan text-white text-sm font-bold hover:bg-marine-cyan-dark transition-colors">
          <Plus size={16} /> {isAr ? 'إنشاء إعلان' : 'Create Ad'}
        </button>
      </div>

      {!subscribed && (
        <div className="mb-6 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
          <Info size={16} /> {isAr ? 'بدون اشتراك يمكنك طلب إعلان خدمة فقط. اشترك أولًا لإضافة المنتجات ثم الإعلان عنها.' : 'Without a subscription you can only request a Service ad. Subscribe first to add products, then advertise them.'}
        </div>
      )}

      {error && (
        <div className="mb-6 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
          <Info size={16} /> {error}
        </div>
      )}

      <div className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl shadow-sm overflow-hidden">
        {ads.length === 0 ? (
          <div className="p-12 text-center text-zinc-500">
            <Megaphone size={32} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">{isAr ? 'لا توجد إعلانات بعد.' : 'No ads yet.'}</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 dark:divide-white/5">
            {ads.map((ad) => (
              <div key={ad._id} className="flex items-center gap-4 px-5 py-4">
                <div className="w-24 h-14 rounded-lg overflow-hidden bg-zinc-100 dark:bg-white/5 flex-shrink-0 flex items-center justify-center text-zinc-300">
                  {ad.banner_image ? <img src={resolveAssetUrl(ad.banner_image)} alt="" className="w-full h-full object-cover" />
                    : ad.type === 'product_visibility' ? <TrendingUp size={20} /> : <Store size={20} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">{typeLabel(ad)}</span>
                    <span className="font-mono text-[11px] text-zinc-400">{ad.ad_number}</span>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold ${STATUS_STYLES[ad.status] || ''}`}>{statusLabel(ad.status)}</span>
                  </div>
                  {ad.status === 'approved' && <p className="text-xs text-zinc-400 mt-1">{fmtDate(ad.start_date)} → {fmtDate(ad.end_date)}</p>}
                  {ad.status === 'rejected' && ad.rejection_reason && <p className="text-xs text-red-500 mt-0.5">{ad.rejection_reason}</p>}
                  {ad.stats && (ad.status === 'approved' || ad.status === 'expired' || ad.stats.impressions > 0) && (
                    <p className="text-xs text-zinc-500 mt-1 flex items-center gap-3">
                      <span><Eye size={12} className="inline me-1" />{ad.stats.impressions} {isAr ? 'مشاهدة' : 'views'}</span>
                      <span><MousePointerClick size={12} className="inline me-1" />{ad.stats.clicks} {isAr ? 'كليك' : 'clicks'}</span>
                      <span>{isAr ? 'نسبة النقر' : 'CTR'} {ad.stats.ctr}%</span>
                    </p>
                  )}
                </div>
                {(ad.status === 'approved' || ad.status === 'expired' || ad.stats?.impressions > 0) && (
                  <button onClick={() => setStatsAd(ad)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-zinc-100 dark:bg-white/5 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-white/10 flex-shrink-0">
                    <BarChart3 size={14} /> {isAr ? 'الإحصائيات' : 'Stats'}
                  </button>
                )}
                {ad.status === 'pending' && (
                  <button onClick={() => cancel(ad._id)} className="text-xs font-bold text-red-500 hover:underline flex-shrink-0">{isAr ? 'إلغاء' : 'Cancel'}</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ad performance */}
      {statsAd && (
        <Overlay className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto" onClick={() => setStatsAd(null)}>
          <div className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/10 rounded-2xl w-full max-w-3xl p-6 shadow-xl my-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-lg text-zinc-900 dark:text-white flex items-center gap-2"><BarChart3 size={18} className="text-marine-primary" /> {isAr ? 'أداء الإعلان' : 'Ad performance'}</h3>
                <p className="text-xs text-zinc-500 mt-0.5"><span className="font-mono">{statsAd.ad_number}</span> · {typeLabel(statsAd)}</p>
              </div>
              <button onClick={() => setStatsAd(null)} className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white"><X size={20} /></button>
            </div>
            <AdAnalyticsPanel load={loadAnalytics} isAr={isAr} />
          </div>
        </Overlay>
      )}

      {/* Create-Ad wizard */}
      {showModal && (
        <Overlay className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto" onClick={() => setShowModal(false)}>
          <div className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/10 rounded-2xl w-full max-w-md p-6 shadow-xl my-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg text-zinc-900 dark:text-white">
                {step === 1 ? (isAr ? 'اختر نوع الإعلان' : 'Choose ad type') : (isAr ? adType.ar : adType.en)}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white"><X size={20} /></button>
            </div>

            {step === 1 && (
              <div className="space-y-2">
                {AD_TYPES.map((t) => {
                  const locked = !t.serviceFree && !subscribed;
                  const Icon = t.icon;
                  return (
                    <button key={t.key} type="button" disabled={locked} onClick={() => pickType(t)}
                      className={`w-full flex items-start gap-3 p-3 rounded-xl border text-start transition-colors ${locked
                        ? 'border-zinc-200 dark:border-white/10 opacity-60 cursor-not-allowed'
                        : 'border-zinc-200 dark:border-white/10 hover:border-marine-cyan/50 hover:bg-marine-cyan/5'}`}>
                      <div className="mt-0.5 text-marine-primary">{locked ? <Lock size={18} /> : <Icon size={18} />}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-zinc-900 dark:text-white">{isAr ? t.ar : t.en}</p>
                        <p className="text-xs text-zinc-500">{locked ? (isAr ? 'يتطلب اشتراكًا فعّالًا' : 'Requires an active subscription') : (isAr ? t.descAr : t.descEn)}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {step === 2 && (
              <form onSubmit={submit} className="space-y-4">
                {/* Banner / Service banner */}
                {isBanner && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-zinc-500 mb-1.5">{isAr ? 'صورة البانر' : 'Banner Image'}</label>
                      <SingleImageUploader value={form.banner_image} onChange={(url) => setForm({ ...form, banner_image: url })} />
                    </div>
                    {!isService && (
                      <div>
                        <label className="block text-xs font-bold text-zinc-500 mb-1.5">{isAr ? 'ماذا تُعلن؟' : 'What are you advertising?'}</label>
                        <select value={form.subject_type} onChange={(e) => onSubjectChange(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-transparent text-zinc-900 dark:text-white text-sm">
                          <option value="product">{isAr ? 'منتج' : 'A product'}</option>
                          <option value="store">{isAr ? 'متجري' : 'My store'}</option>
                          <option value="custom">{isAr ? 'رابط مخصص' : 'Custom link'}</option>
                        </select>
                      </div>
                    )}
                    {!isService && form.subject_type === 'product' && (
                      <ProductPicker {...{ products, value: form.product_id, onChange: onBannerProductChange, isAr, productTitle }} />
                    )}
                    <div>
                      <label className="block text-xs font-bold text-zinc-500 mb-1.5">{isAr ? 'رابط الوجهة' : 'Destination link'}</label>
                      <input type="text" required value={form.link_url} onChange={(e) => setForm({ ...form, link_url: e.target.value })}
                        placeholder={isAr ? '/product/... أو https://...' : '/product/... or https://...'}
                        className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-transparent text-zinc-900 dark:text-white text-sm" />
                    </div>
                  </>
                )}

                {/* Product visibility */}
                {adType.type === 'product_visibility' && (
                  <>
                    <ProductPicker {...{ products, value: form.product_id, onChange: (id) => setForm({ ...form, product_id: id }), isAr, productTitle }} />
                    <div>
                      <label className="block text-xs font-bold text-zinc-500 mb-1.5">{isAr ? 'أماكن الإبراز' : 'Placements'}</label>
                      <div className="space-y-1.5">
                        {PRODUCT_PLACEMENTS.map((p) => (
                          <label key={p.key} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
                            <input type="checkbox" checked={form.placements.includes(p.key)} onChange={() => togglePlacement('placements', p.key)}
                              className="rounded border-zinc-300 text-marine-primary focus:ring-marine-cyan" />
                            {isAr ? p.ar : p.en}
                          </label>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* Featured vendor */}
                {adType.type === 'featured_vendor' && (
                  <div>
                    <label className="block text-xs font-bold text-zinc-500 mb-1.5">{isAr ? 'أماكن الإبراز' : 'Placements'}</label>
                    <div className="space-y-1.5">
                      {VENDOR_PLACEMENTS.map((p) => (
                        <label key={p.key} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
                          <input type="checkbox" checked={form.vendor_placements.includes(p.key)} onChange={() => togglePlacement('vendor_placements', p.key)}
                            className="rounded border-zinc-300 text-marine-primary focus:ring-marine-cyan" />
                          {isAr ? p.ar : p.en}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-zinc-500 mb-1.5">{isAr ? 'ملاحظة (اختياري)' : 'Note (optional)'}</label>
                  <textarea rows={2} value={form.vendor_note} onChange={(e) => setForm({ ...form, vendor_note: e.target.value })}
                    placeholder={isAr ? 'أي تفاصيل للتنسيق مع مدير الحساب' : 'Any details for the account manager'}
                    className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-transparent text-zinc-900 dark:text-white text-sm" />
                </div>

                <div className="flex gap-2">
                  <button type="button" onClick={() => setStep(1)} className="px-4 py-3 rounded-xl border border-zinc-200 dark:border-white/10 text-sm font-bold text-zinc-600 dark:text-zinc-300">{isAr ? 'رجوع' : 'Back'}</button>
                  <button type="submit" disabled={!canSubmit}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-marine-cyan text-white text-sm font-bold hover:bg-marine-cyan-dark transition-colors disabled:opacity-50">
                    {submitting ? <Loader2 size={16} className="animate-spin" /> : null}{isAr ? 'إرسال الطلب' : 'Submit Request'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </Overlay>
      )}
    </div>
  );
}

function ProductPicker({ products, value, onChange, isAr, productTitle }) {
  return (
    <div>
      <label className="block text-xs font-bold text-zinc-500 mb-1.5">{isAr ? 'اختر المنتج' : 'Select product'}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} required
        className="w-full px-3 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-transparent text-zinc-900 dark:text-white text-sm">
        <option value="">{isAr ? '— اختر —' : '— choose —'}</option>
        {products.map((p) => <option key={p._id} value={p._id}>{productTitle(p)}</option>)}
      </select>
    </div>
  );
}
