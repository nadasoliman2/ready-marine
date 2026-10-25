'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Mail, Send, Sparkles, Car, Users, RefreshCw, Eye, Smartphone, Monitor,
  CheckCircle2, AlertCircle, Plus, Trash2, Search, ArrowRight, Loader2,
  Calendar, Layers, ExternalLink, ShieldAlert
} from 'lucide-react';
import { adminApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import Overlay from '../../../../components/Overlay';
import SearchableSelect from '../../../../components/SearchableSelect';
import { useBrandModels } from '../../../../lib/carBrandModels';

// The email carries the products the admin picks — at least one, at most eight — and only those.
const MAX_PRODUCTS = 8;

const CARD = 'bg-white dark:bg-[#14171A] border border-zinc-200 dark:border-white/5 rounded-2xl';
const INPUT = 'w-full bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-zinc-900 dark:text-white outline-none focus:border-marine-cyan transition-colors';
const LABEL = 'block text-xs font-bold text-zinc-600 dark:text-zinc-400 mb-1.5';

/** Every category, children after their parent, named with the path to it: "Engine › Filters". */
const flattenCategories = (nodes, isAr, trail = [], acc = []) => {
  (nodes || []).forEach((cat) => {
    const name = isAr ? (cat.name_ar || cat.name) : (cat.name || cat.name_ar);
    const path = [...trail, name];
    acc.push({ cat, label: path.join(' › ') });
    flattenCategories(cat.subcategories, isAr, path, acc);
  });
  return acc;
};

/**
 * The product search for the email: opens on a click with products to pick from — the ones
 * that fit the chosen car, else the published ones — and narrows as the admin types. A
 * search that finds nothing says so; a reply that arrives after a newer search is dropped.
 */
function ProductPicker({ car, selectedIds, onPick, isAr }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);
  const latestRef = useRef(0);

  useEffect(() => {
    if (!open) return undefined;
    const request = ++latestRef.current;
    setLoading(true);
    const timer = setTimeout(() => {
      const term = query.trim();
      adminApi.getProducts({
        status: 'published',
        limit: 20,
        ...(term ? { search: term } : {}),
        // With a car chosen, only its products — while searching too.
        ...(car.brand_id ? { car_brand_id: car.brand_id, car_model_id: car.model_id, car_year: car.year } : {}),
      })
        .then((res) => { if (request === latestRef.current) setResults(res?.products || []); })
        .catch(() => { if (request === latestRef.current) setResults([]); })
        .finally(() => { if (request === latestRef.current) setLoading(false); });
    }, query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [open, query, car.brand_id, car.model_id, car.year]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => { if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shown = results.filter((p) => !selectedIds.has(String(p._id)));

  return (
    <div className="relative" ref={boxRef}>
      <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
      <input
        type="text"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        placeholder={isAr ? 'اضغط لاختيار منتج، أو اكتب اسمه أو رقم القطعة…' : 'Click to pick a product, or type its name or part number…'}
        className={`${INPUT} ps-9 text-xs`}
      />
      {loading && open && (
        <Loader2 size={14} className="absolute end-3 top-1/2 -translate-y-1/2 animate-spin text-marine-primary" />
      )}
      {open && (
        <div className="absolute z-30 start-0 end-0 top-full mt-1 bg-white dark:bg-[#181B1F] border border-zinc-200 dark:border-white/10 rounded-xl shadow-xl max-h-72 overflow-y-auto divide-y divide-zinc-100 dark:divide-white/5">
          {car.brand_id && shown.length > 0 && (
            <p className="px-3 py-2 text-[11px] font-bold text-zinc-400">{isAr ? 'منتجات تناسب العربية المختارة' : 'Products that fit the chosen car'}</p>
          )}
          {shown.map((p) => (
            <button
              type="button"
              key={p._id}
              onClick={() => { onPick(p); setQuery(''); }}
              className="w-full text-start p-2.5 flex items-center gap-3 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
            >
              <img src={(p.images || [])[0]?.url || '/placeholder.png'} className="w-8 h-8 rounded object-contain bg-zinc-100 shrink-0" alt="" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-bold text-zinc-900 dark:text-white truncate">{(isAr ? p.title_ar : p.title_en) || p.title_ar || p.title_en}</span>
                <span className="block text-[11px] text-marine-primary font-bold">{Number(p.discount_price ?? p.price ?? 0).toLocaleString('en-US')} ج.م</span>
              </span>
              <Plus size={16} className="text-marine-primary shrink-0" />
            </button>
          ))}
          {!loading && shown.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-zinc-400">
              {query.trim()
                ? (isAr ? `مفيش منتجات باسم "${query.trim()}"${car.brand_id ? ' للعربية دي' : ''}` : `No products match "${query.trim()}"${car.brand_id ? ' for this car' : ''}`)
                : (isAr ? 'مفيش منتجات تانية للإضافة' : 'No more products to add')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Top-level helper component for Tab Button */
function TabButton({ active, onClick, icon: Icon, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold transition-all ${
        active
          ? 'bg-marine-cyan text-white shadow-lg shadow-marine-cyan/20'
          : 'bg-zinc-100 hover:bg-zinc-200 dark:bg-white/5 dark:hover:bg-white/10 text-zinc-700 dark:text-zinc-300'
      }`}
    >
      <Icon size={16} />
      <span>{children}</span>
    </button>
  );
}

/** Top-level helper for selected product chip in campaign builder */
function ProductItemCard({ product, onRemove, isAr }) {
  const title = (isAr ? product.title_ar : product.title_en) || product.title_ar || product.title_en || 'منتج Ready Marine';
  const price = product.discount_price ?? product.price ?? 0;
  const imgUrl = (product.images || [])[0]?.url || '/placeholder.png';

  return (
    <div className="flex items-center gap-3 p-2.5 bg-zinc-50 dark:bg-white/[0.02] border border-zinc-200 dark:border-white/5 rounded-xl">
      <img
        src={imgUrl}
        alt={title}
        className="w-12 h-12 rounded-lg object-contain bg-white dark:bg-zinc-800 shrink-0 border border-zinc-100 dark:border-white/5"
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-zinc-900 dark:text-white truncate">{title}</p>
        <p className="text-xs font-black text-marine-primary mt-0.5">{Number(price).toLocaleString('en-US')} ج.م</p>
      </div>
      <button
        type="button"
        onClick={() => onRemove(product._id)}
        className="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
        title={isAr ? 'حذف من الحملة' : 'Remove product'}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

/** Top-level helper for past campaigns table row */
function CampaignRow({ campaign, isAr, onViewDetails }) {
  const car = campaign.target_filter || {};
  const carName = [car.brand_name, car.model_name, car.year].filter(Boolean).join(' ') || (isAr ? 'جميع السيارات' : 'All cars');
  // toLocaleString, not toLocaleDateString: a date-only formatter throws on `timeStyle`.
  const dateStr = campaign.createdAt ? new Date(campaign.createdAt).toLocaleString(isAr ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

  const getStatusBadge = () => {
    switch (campaign.status) {
      case 'sent':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
            <CheckCircle2 size={13} /> {isAr ? 'تم الإرسال' : 'Sent'}
          </span>
        );
      case 'sending':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
            <RefreshCw size={13} className="animate-spin" /> {isAr ? 'قيد الإرسال' : 'Sending'}
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400">
            <AlertCircle size={13} /> {isAr ? 'فشل' : 'Failed'}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {campaign.status}
          </span>
        );
    }
  };

  return (
    <tr className="hover:bg-zinc-50/50 dark:hover:bg-white/[0.01] transition-colors border-b border-zinc-100 dark:border-white/5">
      <td className="px-4 py-3 font-bold text-zinc-900 dark:text-white">
        <div>{campaign.title}</div>
        <div className="text-xs text-zinc-500 font-normal truncate max-w-xs">{campaign.subject}</div>
      </td>
      <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300 font-medium">
        <div className="flex items-center gap-1.5">
          <Car size={14} className="text-marine-primary shrink-0" />
          <span>{carName}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-center text-zinc-700 dark:text-zinc-300 font-bold">
        {campaign.stats?.targeted_count || 0}
      </td>
      <td className="px-4 py-3 text-center font-bold text-emerald-600">
        {campaign.stats?.sent_count || 0}
      </td>
      <td className="px-4 py-3 text-center">{getStatusBadge()}</td>
      <td className="px-4 py-3 text-zinc-500 text-xs whitespace-nowrap">{dateStr}</td>
      <td className="px-4 py-3 text-end">
        <button
          type="button"
          onClick={() => onViewDetails(campaign)}
          className="text-xs font-bold text-marine-primary hover:underline"
        >
          {isAr ? 'عرض التفاصيل' : 'View'}
        </button>
      </td>
    </tr>
  );
}

export default function CarCampaignsPage() {
  const { language, categories: siteCategories } = useApp();
  const isAr = language === 'ar';

  const [activeTab, setActiveTab] = useState('create'); // 'create' | 'history'

  // Car brands and selection
  const [carBrands, setCarBrands] = useState([]);
  const [loadingBrands, setLoadingBrands] = useState(true);
  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [selectedYear, setSelectedYear] = useState('');

  // Audience counting
  const [audienceCount, setAudienceCount] = useState(0);
  const [audienceSample, setAudienceSample] = useState([]);
  const [countingAudience, setCountingAudience] = useState(false);

  // Campaign Form State
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [messageBody, setMessageBody] = useState('');
  // Each tag carries both names: a customer reads the email in their account's language.
  const [categoryTags, setCategoryTags] = useState([
    { label: 'فلاتر وزيوت', label_en: 'Filters & Oils', link: '' },
    { label: 'تيل وطنابير الفرامل', label_en: 'Brakes', link: '' },
    { label: 'مستلزمات وعناية', label_en: 'Car Care', link: '' },
    { label: 'بطاريات وإضاءة', label_en: 'Batteries & Lights', link: '' },
  ]);
  const [customCtaText, setCustomCtaText] = useState('');
  const [customCtaLink, setCustomCtaLink] = useState('');

  // Products
  const [products, setProducts] = useState([]);

  // Live Preview
  const [previewDevice, setPreviewDevice] = useState('mobile'); // 'mobile' | 'desktop'
  // The email goes out in each customer's language; the preview and the test show either.
  const [previewLang, setPreviewLang] = useState(isAr ? 'ar' : 'en');
  const [previewHtml, setPreviewHtml] = useState('');
  const [generatingPreview, setGeneratingPreview] = useState(false);

  // Test email & Dispatch
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchResult, setDispatchResult] = useState(null);
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);

  // Campaign History
  const [campaigns, setCampaigns] = useState([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [selectedCampaignForDetails, setSelectedCampaignForDetails] = useState(null);

  // Load car brands on mount
  useEffect(() => {
    let alive = true;
    adminApi.getCarBrandsAdmin()
      .then((res) => {
        if (alive) setCarBrands(res.carBrands || []);
      })
      .catch((err) => console.error('Failed to load brands:', err))
      .finally(() => { if (alive) setLoadingBrands(false); });
    return () => { alive = false; };
  }, []);

  // Compute selected brand & models
  const currentBrand = useMemo(() => {
    return carBrands.find((b) => String(b._id) === String(selectedBrandId)) || null;
  }, [carBrands, selectedBrandId]);

  // A make's models are loaded on their own when it is picked; the makes list no longer
  // carries them, so `currentBrand.models` was always empty.
  const availableModels = useBrandModels(currentBrand);

  const currentModel = useMemo(() => {
    return availableModels.find((m) => String(m._id) === String(selectedModelId)) || null;
  }, [availableModels, selectedModelId]);

  const availableYears = useMemo(() => {
    if (!currentModel?.years) return [];
    return currentModel.years.map((y) => y.year).sort((a, b) => b - a);
  }, [currentModel]);

  // The title and subject written for the picked car follow it while they are untouched:
  // the make picked first, then a model, renames them. Once edited by hand they stay.
  const autoTextRef = useRef({ title: '', subject: '' });

  // Update Audience & Recommendations when car filter changes. A pick made while the last
  // one is still loading drops the older answer, so a slow reply cannot show another car's.
  useEffect(() => {
    if (!selectedBrandId) {
      setAudienceCount(0);
      setAudienceSample([]);
      setProducts([]);
      return undefined;
    }
    let alive = true;
    // The admin fills the email: nothing is picked for them. Products picked for another car
    // are dropped, since they may not fit this one.
    setProducts([]);

    setCountingAudience(true);
    adminApi.getCarCampaignAudience({
      brand_id: selectedBrandId,
      brand_name: currentBrand?.name || '',
      model_id: selectedModelId,
      model_name: currentModel?.name || '',
      year: selectedYear,
    })
      .then((res) => {
        if (!alive) return;
        setAudienceCount(res?.count || 0);
        setAudienceSample(res?.users || res?.sample || []);
      })
      .catch((err) => console.error('Audience count error:', err))
      .finally(() => { if (alive) setCountingAudience(false); });

    if (currentBrand) {
      const carName = [currentBrand.name, currentModel?.name, selectedYear].filter(Boolean).join(' ');
      const nextTitle = `عروض وتوصيات ${carName}`;
      const nextSubject = `عروض خاصة لسيارتك ${carName}: قطع غيار معتمدة وتوصيات مختارة`;
      const auto = autoTextRef.current;
      setTitle((prev) => (!prev || prev === auto.title ? nextTitle : prev));
      setSubject((prev) => (!prev || prev === auto.subject ? nextSubject : prev));
      autoTextRef.current = { title: nextTitle, subject: nextSubject };
    }
    return () => { alive = false; };
  }, [selectedBrandId, selectedModelId, selectedYear, currentBrand, currentModel]);

  // Generate live email preview whenever content changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setGeneratingPreview(true);
      adminApi.previewCarCampaignHtml({
        recipient_name: previewLang === 'ar' ? 'أحمد محمد' : 'Ahmed Mohamed',
        // The car as picked — the make alone, or with a model and a year. Nothing made up.
        brand_name: currentBrand?.name || '',
        model_name: currentModel?.name || '',
        year: selectedYear ? Number(selectedYear) : null,
        subject: subject || 'عروض وتوصيات لسيارتك',
        message_body: messageBody || (previewLang === 'ar'
          ? 'يسعدنا تقديم باقة مختارة من أفضل قطع الغيار المتوافقة تماماً مع سيارتك بأفضل الأسعار.'
          : 'A handpicked set of the best parts that fit your car, at the best prices.'),
        category_tags: categoryTags,
        product_ids: products.map((p) => p._id),
        custom_cta_text: customCtaText,
        custom_cta_link: customCtaLink,
        lang: previewLang,
      })
        .then((res) => {
          if (res?.html) setPreviewHtml(res.html);
        })
        .catch((err) => console.error('Preview error:', err))
        .finally(() => setGeneratingPreview(false));
    }, 400);

    return () => clearTimeout(timer);
  }, [currentBrand, currentModel, selectedYear, subject, messageBody, categoryTags, products, customCtaText, customCtaLink, previewLang]);

  // Load campaign history
  const loadCampaignHistory = () => {
    setLoadingCampaigns(true);
    adminApi.getCarCampaigns({ limit: 30 })
      .then((res) => setCampaigns(res?.campaigns || []))
      .catch((err) => console.error('History load error:', err))
      .finally(() => setLoadingCampaigns(false));
  };

  useEffect(() => {
    if (activeTab === 'history') {
      loadCampaignHistory();
    }
  }, [activeTab]);

  // Product removal
  const handleRemoveProduct = (productId) => {
    setProducts((prev) => prev.filter((p) => String(p._id) !== String(productId)));
  };

  const handleAddSearchedProduct = (prod) => {
    if (products.length >= MAX_PRODUCTS) return;
    if (!products.some((p) => String(p._id) === String(prod._id))) {
      setProducts((prev) => [...prev, prod]);
    }
  };

  // Tag Management: a tag is one of the site's categories, and opens it from the email.
  const categoryOptions = useMemo(() => flattenCategories(siteCategories, isAr), [siteCategories, isAr]);
  const handleAddTag = (categoryId) => {
    const found = categoryOptions.find(({ cat }) => String(cat._id) === String(categoryId));
    if (!found) return;
    const { cat } = found;
    setCategoryTags((prev) => (prev.some((tag) => String(tag.category_id) === String(cat._id))
      ? prev
      : [...prev, { label: cat.name_ar || cat.name, label_en: cat.name || cat.name_ar, category_id: cat._id, link: '' }]));
  };

  const handleRemoveTag = (index) => {
    setCategoryTags((prev) => prev.filter((_, i) => i !== index));
  };

  // Test Email
  const handleSendTestEmail = async () => {
    if (!testEmailAddress || !testEmailAddress.includes('@')) {
      alert(isAr ? 'برجاء كتابة بريد إلكتروني صحيح لإرسال التجربة' : 'Please provide a valid test email address');
      return;
    }
    setSendingTest(true);
    setTestResult(null);
    try {
      await adminApi.sendCarCampaignTest({
        to: testEmailAddress.trim(),
        brand_id: selectedBrandId,
        brand_name: currentBrand?.name || '',
        model_id: selectedModelId,
        model_name: currentModel?.name || '',
        year: selectedYear ? Number(selectedYear) : null,
        subject: subject || 'عروض سيارتك - تجربة',
        message_body: messageBody,
        category_tags: categoryTags,
        product_ids: products.map((p) => p._id),
        custom_cta_text: customCtaText,
        custom_cta_link: customCtaLink,
        lang: previewLang,
      });
      setTestResult({ success: true, message: isAr ? 'تم إرسال الإيميل التجريبي بنجاح! تفقد بريدك الإلكتروني الآن.' : 'Test email sent successfully!' });
    } catch (err) {
      setTestResult({ success: false, message: err.message || (isAr ? 'فشل إرسال الإيميل التجريبي.' : 'Failed to send test email.') });
    } finally {
      setSendingTest(false);
    }
  };

  // Dispatch Campaign
  const handleLaunchCampaign = async () => {
    if (!title.trim() || !subject.trim()) {
      alert(isAr ? 'برجاء كتابة عنوان الحملة وعنوان الإيميل' : 'Campaign title and subject are required');
      return;
    }
    if (audienceCount === 0) {
      alert(isAr ? 'لا يوجد أي عملاء مسجلين بهذه السيارة يمتلكون بريداً إلكترونياً.' : 'No users found matching this car filter.');
      return;
    }

    setDispatching(true);
    setDispatchResult(null);
    try {
      const res = await adminApi.createCarCampaign({
        title: title.trim(),
        subject: subject.trim(),
        target_filter: {
          brand_id: selectedBrandId || null,
          brand_name: currentBrand?.name || '',
          model_id: selectedModelId || null,
          model_name: currentModel?.name || '',
          year: selectedYear ? Number(selectedYear) : null,
        },
        message_body: messageBody,
        category_tags: categoryTags,
        product_ids: products.map((p) => p._id),
        custom_cta_text: customCtaText,
        custom_cta_link: customCtaLink,
      });

      setConfirmSendOpen(false);
      setDispatchResult({ success: true, message: isAr ? 'تم بدء إرسال الحملة بنجاح في الخلفية!' : 'Campaign dispatched successfully!' });
      // Switch to history tab after 2 seconds
      setTimeout(() => {
        setActiveTab('history');
      }, 1500);
    } catch (err) {
      setDispatchResult({ success: false, message: err.message || (isAr ? 'حدث خطأ أثناء إطلاق الحملة.' : 'Failed to dispatch campaign.') });
    } finally {
      setDispatching(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-marine-primary font-bold text-xs uppercase tracking-wider mb-1">
            <Mail size={16} />
            <span>{isAr ? 'أدوات التسويق' : 'Marketing Tools'}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-zinc-900 dark:text-white">
            {isAr ? 'حملات السيارات البريدية' : 'Car Email Campaigns'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {isAr
              ? 'إرسال إيميلات مخصصة لمالكي السيارات المسجلة مع منتجات متوافقة على طراز إيميلات علي بابا'
              : 'Targeted recommendation emails for registered car owners styled like Alibaba'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <TabButton active={activeTab === 'create'} onClick={() => setActiveTab('create')} icon={Plus}>
            {isAr ? 'إنشاء حملة جديدة' : 'New Campaign'}
          </TabButton>
          <TabButton active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={Calendar}>
            {isAr ? 'سجل الحملات' : 'History'}
          </TabButton>
        </div>
      </div>

      {/* CREATE CAMPAIGN TAB */}
      {activeTab === 'create' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Form & Settings (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Step 1: Car Selection & Audience */}
            <div className={`${CARD} p-5 space-y-4`}>
              <div className="flex items-center justify-between gap-2 border-b border-zinc-100 dark:border-white/5 pb-3">
                <div className="flex items-center gap-2 font-black text-zinc-900 dark:text-white">
                  <span className="w-6 h-6 rounded-lg bg-marine-cyan text-white flex items-center justify-center text-xs font-black">1</span>
                  <span>{isAr ? 'تحديد السيارة والجمهور المستهدف' : 'Car Fitment & Audience'}</span>
                </div>
                {countingAudience ? (
                  <span className="text-xs text-zinc-400 flex items-center gap-1">
                    <Loader2 size={12} className="animate-spin text-marine-primary" /> {isAr ? 'جارِ فحص قاعدة البيانات...' : 'Counting...'}
                  </span>
                ) : null}
              </div>

              {/* Searchable, the makes with their logos — the same lists as the rest of the
                  dashboard. The make alone is enough; a model and a year narrow it. */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={LABEL}>{isAr ? 'ماركة السيارة' : 'Make'}</label>
                  <SearchableSelect
                    value={selectedBrandId}
                    onChange={(v) => {
                      setSelectedBrandId(v);
                      setSelectedModelId('');
                      setSelectedYear('');
                    }}
                    options={carBrands.map((b) => ({ value: b._id, label: b.name, keywords: (b.name_aliases || []).join(' '), image: b.image }))}
                    placeholder={loadingBrands ? (isAr ? 'جارِ التحميل…' : 'Loading…') : (isAr ? 'اختر الماركة' : 'Select make')}
                    disabled={loadingBrands}
                    isAr={isAr}
                    buttonClassName={INPUT}
                  />
                </div>

                <div>
                  <label className={LABEL}>{isAr ? 'الموديل (اختياري)' : 'Model (Optional)'}</label>
                  <SearchableSelect
                    value={selectedModelId}
                    onChange={(v) => {
                      setSelectedModelId(v);
                      setSelectedYear('');
                    }}
                    options={availableModels.map((m) => ({ value: m._id, label: m.name }))}
                    placeholder={isAr ? 'كل الموديلات' : 'All models'}
                    disabled={!selectedBrandId || !availableModels.length}
                    isAr={isAr}
                    buttonClassName={`${INPUT} disabled:opacity-50`}
                  />
                </div>

                <div>
                  <label className={LABEL}>{isAr ? 'سنة الصنع (اختياري)' : 'Year (Optional)'}</label>
                  <SearchableSelect
                    value={selectedYear}
                    onChange={(v) => setSelectedYear(v)}
                    options={availableYears.map((yr) => ({ value: String(yr), label: String(yr) }))}
                    placeholder={isAr ? 'كل السنين' : 'All years'}
                    disabled={!selectedModelId || !availableYears.length}
                    isAr={isAr}
                    buttonClassName={`${INPUT} disabled:opacity-50`}
                  />
                </div>
              </div>

              {/* Live Audience Result Badge */}
              <div className={`p-4 rounded-xl flex items-center justify-between gap-3 ${
                audienceCount > 0
                  ? 'bg-red-50/80 dark:bg-marine-cyan/10 border border-red-200 dark:border-marine-cyan/20'
                  : 'bg-zinc-50 dark:bg-white/[0.02] border border-zinc-200 dark:border-white/5'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    audienceCount > 0 ? 'bg-marine-cyan text-white shadow-md' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-500'
                  }`}>
                    <Users size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-zinc-500 dark:text-zinc-400">
                      {isAr ? 'العملاء المستهدفين المستوفين للشروط' : 'Eligible Recipients'}
                    </p>
                    <p className="text-lg font-black text-zinc-900 dark:text-white">
                      {audienceCount} {isAr ? 'عميل نشط ولديه بريد إلكتروني' : 'active customers with email'}
                    </p>
                  </div>
                </div>

              </div>

              {/* Everyone the campaign will reach, as soon as a car is picked. A customer
                  without an email, or who unsubscribed, is not among them. */}
              {audienceCount > 0 && !countingAudience && (
                <div className="border border-zinc-200 dark:border-white/5 rounded-xl max-h-72 overflow-y-auto divide-y divide-zinc-100 dark:divide-white/5">
                  {audienceSample.map((u) => (
                    <div key={u.user_id || u.email} className="px-3 py-2.5 flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-bold text-zinc-900 dark:text-white truncate">{u.name}</p>
                        <p className="text-xs text-zinc-500 truncate" dir="ltr">{u.email}</p>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-zinc-500 bg-zinc-100 dark:bg-white/5 px-2.5 py-1 rounded-lg">
                        {[u.car?.brand_name, u.car?.model_name, u.car?.year].filter(Boolean).join(' ')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Step 2: Content & Copy */}
            <div className={`${CARD} p-5 space-y-4`}>
              <div className="border-b border-zinc-100 dark:border-white/5 pb-3">
                <div className="flex items-center gap-2 font-black text-zinc-900 dark:text-white">
                  <span className="w-6 h-6 rounded-lg bg-marine-cyan text-white flex items-center justify-center text-xs font-black">2</span>
                  <span>{isAr ? 'محتوى الرسالة والنصائح المخصصة' : 'Email Content & Advice'}</span>
                </div>
              </div>

              <div>
                <label className={LABEL}>{isAr ? 'اسم الحملة (مرجعي للأدمن)' : 'Campaign Title (Admin Ref)'}</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={isAr ? 'مثال: عروض تويوتا كورولا - خريف 2026' : 'e.g. Toyota Corolla Autumn Campaign'}
                  className={INPUT}
                />
              </div>

              <div>
                <label className={LABEL}>
                  {isAr ? 'عنوان الإيميل (Subject Line - ما يراه العميل)' : 'Subject Line (Visible to user)'}
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={isAr ? 'مثال: عروض خاصة لسيارتك {car_model} - Ready Marine' : 'e.g. Special parts for your {car_model}'}
                  className={INPUT}
                />
              </div>

              <div>
                <label className={LABEL}>
                  {isAr ? 'نصائح صيانة أو معلومات مخصصة للسيارة (اختياري)' : 'Car Maintenance Tips / Custom Text (Optional)'}
                </label>
                <textarea
                  rows={3}
                  value={messageBody}
                  onChange={(e) => setMessageBody(e.target.value)}
                  placeholder={isAr ? 'اكتب نصيحة دورية أو عرضاً خاصاً لمالكي هذا الموديل (مثلاً: مواعيد فحص السيور، أو كود خصم إضافي)' : 'Write advice, seasonal tips or discount code for this specific model'}
                  className={INPUT}
                />
              </div>

              {/* Quick Tags / Pills (Like Alibaba) */}
              <div>
                <label className={LABEL}>{isAr ? 'شريط الأقسام السريعة (كبسولات مثل علي بابا)' : 'Quick Category Tags (Pills)'}</label>
                <div className="flex flex-wrap items-center gap-2 mb-2.5">
                  {categoryTags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-zinc-100 dark:bg-white/10 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-white/10"
                    >
                      <span>{isAr ? tag.label : (tag.label_en || tag.label)}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(idx)}
                        className="text-zinc-400 hover:text-red-500"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <SearchableSelect
                  value=""
                  onChange={handleAddTag}
                  options={categoryOptions.map(({ cat, label }) => ({ value: cat._id, label }))}
                  placeholder={isAr ? 'أضف قسماً من أقسام الموقع…' : 'Add one of the site\'s categories…'}
                  disabled={!categoryOptions.length}
                  isAr={isAr}
                  buttonClassName={`${INPUT} text-xs py-2`}
                />
              </div>
            </div>

            {/* Step 3: Product Recommendations Selection */}
            <div className={`${CARD} p-5 space-y-4`}>
              <div className="flex items-center justify-between border-b border-zinc-100 dark:border-white/5 pb-3">
                <div className="flex items-center gap-2 font-black text-zinc-900 dark:text-white">
                  <span className="w-6 h-6 rounded-lg bg-marine-cyan text-white flex items-center justify-center text-xs font-black">3</span>
                  <span>{isAr ? `المنتجات المعروضة في الإيميل (من 1 لـ ${MAX_PRODUCTS})` : `Products in Email (1 to ${MAX_PRODUCTS})`}</span>
                </div>
                <span className="text-xs font-bold text-zinc-500">
                  {products.length} {isAr ? 'منتجات مختارة' : 'selected'}
                </span>
              </div>

              {/* Product search box */}
              {products.length < MAX_PRODUCTS ? (
                <ProductPicker
                  car={{ brand_id: selectedBrandId, model_id: selectedModelId, year: selectedYear }}
                  selectedIds={new Set(products.map((p) => String(p._id)))}
                  onPick={handleAddSearchedProduct}
                  isAr={isAr}
                />
              ) : (
                <p className="text-xs font-bold text-zinc-500">
                  {isAr ? `وصلت للحد الأقصى (${MAX_PRODUCTS} منتجات). امسح منتج عشان تضيف غيره.` : `That is the most (${MAX_PRODUCTS}). Remove one to add another.`}
                </p>
              )}

              {/* Selected Products Grid */}
              {products.length === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-400">
                  {isAr ? 'لسه مفيش منتجات. اختار المنتجات اللي هتظهر في الإيميل من فوق.' : 'No products yet. Pick the ones the email shows above.'}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {products.map((p) => (
                    <ProductItemCard
                      key={p._id}
                      product={p}
                      onRemove={handleRemoveProduct}
                      isAr={isAr}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Step 4: Testing & Dispatch */}
            <div className={`${CARD} p-5 space-y-4 border-2 border-red-500/20`}>
              <div className="border-b border-zinc-100 dark:border-white/5 pb-3">
                <div className="flex items-center gap-2 font-black text-zinc-900 dark:text-white">
                  <span className="w-6 h-6 rounded-lg bg-marine-cyan text-white flex items-center justify-center text-xs font-black">4</span>
                  <span>{isAr ? 'التجربة والإطلاق' : 'Test & Dispatch'}</span>
                </div>
              </div>

              {/* Send Test Email Section */}
              <div className="p-3 bg-zinc-50 dark:bg-white/[0.02] border border-zinc-200 dark:border-white/5 rounded-xl space-y-2">
                <label className={LABEL}>{isAr ? 'إرسال إيميل تجريبي للمعاينة قبل الإطلاق' : 'Send Test Email before launch'}</label>
                <p className="text-[11px] text-zinc-500">
                  {isAr
                    ? `هيتبعت ${previewLang === 'ar' ? 'بالعربي' : 'بالإنجليزي'} زي المعاينة. كل عميل بيوصله الإيميل بلغة حسابه.`
                    : `It goes in ${previewLang === 'ar' ? 'Arabic' : 'English'}, as the preview. Each customer gets the email in their account's language.`}
                </p>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={testEmailAddress}
                    onChange={(e) => setTestEmailAddress(e.target.value)}
                    placeholder="your-email@example.com"
                    className={`${INPUT} text-xs`}
                  />
                  <button
                    type="button"
                    onClick={handleSendTestEmail}
                    disabled={sendingTest || products.length === 0}
                    className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-900 text-white text-xs font-bold shrink-0 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {sendingTest ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    <span>{isAr ? 'إرسال تجربة' : 'Send Test'}</span>
                  </button>
                </div>
                {testResult && (
                  <p className={`text-xs font-bold mt-1 ${testResult.success ? 'text-emerald-600' : 'text-red-500'}`}>
                    {testResult.message}
                  </p>
                )}
              </div>

              {products.length === 0 && (
                <p className="text-xs font-bold text-amber-600">
                  {isAr ? 'اختار منتج واحد على الأقل عشان تقدر تبعت التجربة أو الحملة.' : 'Pick at least one product to send the test or the campaign.'}
                </p>
              )}

              {/* Launch Campaign Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmSendOpen(true)}
                  disabled={audienceCount === 0 || products.length === 0 || !title.trim() || !subject.trim()}
                  className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-40 disabled:hover:bg-marine-cyan text-white font-black text-base shadow-lg shadow-marine-cyan/20 transition-all"
                >
                  <Send size={18} />
                  <span>{isAr ? `إطلاق الحملة البريدية إلى (${audienceCount}) عميل` : `Dispatch Campaign to (${audienceCount}) users`}</span>
                </button>
              </div>

              {dispatchResult && (
                <div className={`p-3 rounded-xl text-xs font-bold ${
                  dispatchResult.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                }`}>
                  {dispatchResult.message}
                </div>
              )}
            </div>

          </div>

          {/* Right Column: Live Responsive Preview (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            <div className={`${CARD} p-4 sticky top-6`}>
              <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-white/5">
                <div className="flex items-center gap-2 font-black text-sm text-zinc-900 dark:text-white">
                  <Eye size={16} className="text-marine-primary" />
                  <span>{isAr ? 'معاينة الإيميل الحية' : 'Live Email Preview'}</span>
                </div>

                <div className="flex items-center gap-2">
                {/* Which language the preview and the test email are in. */}
                <div className="flex items-center gap-1 bg-zinc-100 dark:bg-white/5 p-1 rounded-lg">
                  {['ar', 'en'].map((lng) => (
                    <button
                      key={lng}
                      type="button"
                      onClick={() => setPreviewLang(lng)}
                      className={`px-2 py-1 rounded-md text-[11px] font-black transition-all ${
                        previewLang === lng ? 'bg-white dark:bg-zinc-800 text-marine-primary shadow-sm' : 'text-zinc-500'
                      }`}
                      title={isAr ? (lng === 'ar' ? 'الإيميل بالعربي' : 'الإيميل بالإنجليزي') : (lng === 'ar' ? 'The email in Arabic' : 'The email in English')}
                    >
                      {lng.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1 bg-zinc-100 dark:bg-white/5 p-1 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setPreviewDevice('mobile')}
                    className={`p-1.5 rounded-md text-xs font-bold transition-all ${
                      previewDevice === 'mobile' ? 'bg-white dark:bg-zinc-800 text-marine-primary shadow-sm' : 'text-zinc-500'
                    }`}
                    title={isAr ? 'عرض الموبايل' : 'Mobile view'}
                  >
                    <Smartphone size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewDevice('desktop')}
                    className={`p-1.5 rounded-md text-xs font-bold transition-all ${
                      previewDevice === 'desktop' ? 'bg-white dark:bg-zinc-800 text-marine-primary shadow-sm' : 'text-zinc-500'
                    }`}
                    title={isAr ? 'عرض الديسكتوب' : 'Desktop view'}
                  >
                    <Monitor size={14} />
                  </button>
                </div>
                </div>
              </div>

              {/* Preview Container */}
              <div className="py-3 flex justify-center bg-zinc-100 dark:bg-zinc-950/60 rounded-xl overflow-hidden min-h-[580px] max-h-[750px]">
                {generatingPreview ? (
                  <div className="flex items-center justify-center gap-2 text-zinc-400 text-xs">
                    <Loader2 size={16} className="animate-spin text-marine-primary" />
                    <span>{isAr ? 'جارِ تحديث المعاينة...' : 'Updating preview...'}</span>
                  </div>
                ) : (
                  <iframe
                    srcDoc={previewHtml}
                    title="Email Preview"
                    className={`h-[700px] border border-zinc-300 dark:border-white/10 rounded-2xl shadow-xl transition-all duration-300 bg-white ${
                      previewDevice === 'mobile' ? 'w-[360px]' : 'w-full'
                    }`}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* HISTORY TAB */}
      {activeTab === 'history' && (
        <div className={`${CARD} overflow-hidden`}>
          <div className="p-4 border-b border-zinc-100 dark:border-white/5 flex items-center justify-between">
            <h2 className="font-black text-lg text-zinc-900 dark:text-white">
              {isAr ? 'سجل الحملات السابقة' : 'Past Campaigns'}
            </h2>
            <button
              type="button"
              onClick={loadCampaignHistory}
              className="flex items-center gap-1.5 text-xs font-bold text-marine-primary hover:underline"
            >
              <RefreshCw size={13} className={loadingCampaigns ? 'animate-spin' : ''} />
              <span>{isAr ? 'تحديث' : 'Refresh'}</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead className="bg-zinc-50 dark:bg-white/[0.02] text-zinc-500 text-xs border-b border-zinc-100 dark:border-white/5">
                <tr>
                  <th className="text-start px-4 py-3">{isAr ? 'اسم الحملة' : 'Campaign'}</th>
                  <th className="text-start px-4 py-3">{isAr ? 'السيارة المستهدفة' : 'Target Car'}</th>
                  <th className="text-center px-4 py-3">{isAr ? 'المستهدفين' : 'Targeted'}</th>
                  <th className="text-center px-4 py-3">{isAr ? 'تم الإرسال' : 'Sent'}</th>
                  <th className="text-center px-4 py-3">{isAr ? 'الحالة' : 'Status'}</th>
                  <th className="text-start px-4 py-3">{isAr ? 'تاريخ الإنشاء' : 'Date'}</th>
                  <th className="text-end px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                {loadingCampaigns ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-zinc-400">
                      <Loader2 size={24} className="animate-spin text-marine-primary mx-auto mb-2" />
                      <span>{isAr ? 'جارِ تحميل السجل...' : 'Loading history...'}</span>
                    </td>
                  </tr>
                ) : campaigns.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-zinc-400 text-sm">
                      {isAr ? 'لا توجد حملات بريدية سابقة حتى الآن.' : 'No past email campaigns.'}
                    </td>
                  </tr>
                ) : (
                  campaigns.map((c) => (
                    <CampaignRow
                      key={c._id}
                      campaign={c}
                      isAr={isAr}
                      onViewDetails={(item) => setSelectedCampaignForDetails(item)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Confirmation Modal Before Launching */}
      {confirmSendOpen && (
        <Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#181B1F] border border-zinc-200 dark:border-white/10 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <ShieldAlert size={28} />
              <h3 className="font-black text-lg text-zinc-900 dark:text-white">
                {isAr ? 'تأكيد إطلاق الحملة البريدية' : 'Confirm Campaign Dispatch'}
              </h3>
            </div>

            <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
              {isAr
                ? `أنت على وشك إرسال هذه الرسالة إلى (${audienceCount}) عميل يمتلكون سيارة (${currentBrand?.name || ''} ${currentModel?.name || ''} ${selectedYear || ''}). سيتم الإرسال على دفعات لتفادي تصنيف الرسائل كـ Spam.`
                : `You are about to dispatch this campaign to (${audienceCount}) recipients.`}
            </p>

            <div className="flex justify-end gap-3 pt-3 border-t border-zinc-100 dark:border-white/5">
              <button
                type="button"
                onClick={() => setConfirmSendOpen(false)}
                className="px-4 py-2 rounded-xl text-sm font-bold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleLaunchCampaign}
                disabled={dispatching}
                className="px-5 py-2 rounded-xl bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold text-sm shadow-md flex items-center gap-1.5 disabled:opacity-50"
              >
                {dispatching ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                <span>{isAr ? 'تأكيد وإرسال الآن' : 'Confirm & Dispatch'}</span>
              </button>
            </div>
          </div>
        </Overlay>
      )}

      {/* Campaign Details Modal */}
      {selectedCampaignForDetails && (
        <Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#181B1F] border border-zinc-200 dark:border-white/10 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-white/5">
              <h3 className="font-black text-lg text-zinc-900 dark:text-white">
                {selectedCampaignForDetails.title}
              </h3>
              <button
                type="button"
                onClick={() => setSelectedCampaignForDetails(null)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <span className="text-xs font-bold text-zinc-400 block">{isAr ? 'عنوان الإيميل' : 'Subject'}</span>
                <p className="font-medium text-zinc-800 dark:text-zinc-200">{selectedCampaignForDetails.subject}</p>
              </div>

              <div className="grid grid-cols-3 gap-2 py-3 bg-zinc-50 dark:bg-white/[0.02] rounded-xl text-center">
                <div>
                  <span className="text-[11px] text-zinc-400 block">{isAr ? 'المستهدفين' : 'Targeted'}</span>
                  <span className="text-base font-black text-zinc-900 dark:text-white">
                    {selectedCampaignForDetails.stats?.targeted_count || 0}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-zinc-400 block">{isAr ? 'تم الإرسال' : 'Sent'}</span>
                  <span className="text-base font-black text-emerald-600">
                    {selectedCampaignForDetails.stats?.sent_count || 0}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-zinc-400 block">{isAr ? 'فشل' : 'Failed'}</span>
                  <span className="text-base font-black text-red-500">
                    {selectedCampaignForDetails.stats?.failed_count || 0}
                  </span>
                </div>
              </div>

              {selectedCampaignForDetails.message_body && (
                <div>
                  <span className="text-xs font-bold text-zinc-400 block">{isAr ? 'النصائح / نص الرسالة' : 'Advice / Body'}</span>
                  <p className="text-xs text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-white/[0.02] p-3 rounded-xl whitespace-pre-wrap">
                    {selectedCampaignForDetails.message_body}
                  </p>
                </div>
              )}

              {selectedCampaignForDetails.error_log?.length > 0 && (
                <div className="pt-2">
                  <span className="text-xs font-bold text-red-500 block mb-1">{isAr ? 'سجل الأخطاء' : 'Error Log'}</span>
                  <div className="max-h-32 overflow-y-auto text-xs text-red-600 space-y-1 bg-red-50/50 p-2 rounded-lg">
                    {selectedCampaignForDetails.error_log.map((err, idx) => (
                      <div key={idx}><strong>{err.email}:</strong> {err.error}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-3 border-t border-zinc-100 dark:border-white/5">
              <button
                type="button"
                onClick={() => setSelectedCampaignForDetails(null)}
                className="px-4 py-2 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-white/10 text-xs font-bold"
              >
                {isAr ? 'إغلاق' : 'Close'}
              </button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}
