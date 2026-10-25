'use client';

import { useState, useEffect, useRef } from 'react';
import { useApp } from '../../../../context/AppContext';
import { Clock, Loader2, Plus, Save, Trash2, Upload, Image as ImageIcon, Facebook, Instagram, Twitter, Youtube, Linkedin, MessageCircle, Send } from 'lucide-react';

function TikTokIcon({ size = 16, className = "" }) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 448 512" 
      fill="currentColor" 
      className={className}
    >
      <path d="M448 209.91a210.06 210.06 0 0 1-122.77-39.25V349.38A162.55 162.55 0 1 1 185 188.31V278.2a74.62 74.62 0 1 0 52.23 71.18V0l88 0a121.18 121.18 0 0 0 1.86 22.17h.03a122.18 122.18 0 0 0 108.11 104.1V209.91z"/>
    </svg>
  );
}



const inputClass = 'w-full bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white rounded-xl px-4 py-2.5 focus:border-marine-cyan focus:ring-1 focus:ring-marine-cyan outline-none transition-colors';
const labelClass = 'block text-xs font-bold text-zinc-500 uppercase mb-2';

const toLines = (value) => Array.isArray(value) ? value : [];

const toLocationRows = (en = [], ar = []) => {
  const count = Math.max(en.length, ar.length, 1);
  return Array.from({ length: count }, (_, index) => ({
    en: en[index] || '',
    ar: ar[index] || '',
  }));
};



function ListField({ label, value, placeholder, type = 'text', onAdd, onRemove, onChange, isAr }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <label className={labelClass}>{label}</label>
        <button type="button" onClick={onAdd} className="inline-flex items-center gap-1.5 text-xs font-bold text-marine-primary hover:text-red-600">
          <Plus size={14} />
          {isAr ? 'إضافة' : 'Add'}
        </button>
      </div>
      <div className="space-y-2">
        {value.map((item, index) => (
          <div key={index} className="flex gap-2">
            <input
              type={type}
              value={item}
              onChange={e => onChange(index, e.target.value)}
              placeholder={placeholder}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => onRemove(index)}
              disabled={value.length === 1}
              className="h-[46px] w-[46px] shrink-0 inline-flex items-center justify-center rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-400 hover:text-red-500 hover:border-red-500/30 disabled:opacity-40 disabled:hover:text-zinc-400 disabled:hover:border-zinc-200 dark:disabled:hover:border-white/10"
              aria-label={isAr ? 'حذف' : 'Remove'}
            >
              <Trash2 size={17} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function BrandingUploader({ type, currentUrl, onUploaded, isAr, label: customLabel }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const label = customLabel || (type === 'logo'
    ? (isAr ? 'الشعار' : 'Logo')
    : type === 'logo_light'
      ? (isAr ? 'الشعار (الوضع الفاتح)' : 'Logo (Light Mode)')
      : (isAr ? 'أيقونة المتصفح (Favicon)' : 'Favicon'));

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/admin/upload/branding?type=${type}`,
        { method: 'POST', body: fd, credentials: 'include' }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Upload failed');
      onUploaded(data.url, data.settings);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <label className={labelClass}>{label}</label>
      <div className="flex items-center gap-4">
        <div className="w-20 h-20 rounded-xl border-2 border-dashed border-zinc-200 dark:border-white/10 flex items-center justify-center overflow-hidden bg-zinc-50 dark:bg-white/5 flex-shrink-0">
          {currentUrl ? (
            <img src={currentUrl} alt={type} className="w-full h-full object-contain p-1" />
          ) : (
            <ImageIcon size={28} className="text-zinc-300" />
          )}
        </div>
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          {currentUrl && (
            <p className="text-xs text-zinc-400 truncate">{currentUrl}</p>
          )}
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-white/10 hover:bg-zinc-200 dark:hover:bg-white/15 disabled:opacity-50 rounded-lg text-sm font-bold text-zinc-700 dark:text-zinc-200 transition-colors"
          >
            {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            {uploading ? (isAr ? 'جارٍ الرفع...' : 'Uploading...') : (isAr ? 'رفع ملف' : 'Upload file')}
          </button>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*,.ico" className="hidden" onChange={handleFile} />
    </div>
  );
}

export default function LandingControl() {
  const { siteSettings, setSiteSettings, language } = useApp();
  const [formData, setFormData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const isAr = language === 'ar';

  useEffect(() => {
    if (siteSettings) {
      setFormData({
        currency: siteSettings.currency || '',
        header_phone: siteSettings.header_phone || '',
        footer_phones: toLines(siteSettings.footer_phones).length ? siteSettings.footer_phones : [''],
        footer_emails: toLines(siteSettings.footer_emails).length ? siteSettings.footer_emails : [''],
        contact_email: siteSettings.contact_email || '',
        contact_telephone: siteSettings.contact_telephone || '',
        contact_address: siteSettings.contact_address || '',
        header_text_en: siteSettings.header_text_en || '',
        header_text_ar: siteSettings.header_text_ar || '',
        footer_text_en: siteSettings.footer_text_en || '',
        footer_text_ar: siteSettings.footer_text_ar || '',
        locations: toLocationRows(siteSettings.locations_en || [], siteSettings.locations_ar || []),
        social_links: {
          facebook: siteSettings.social_links?.facebook || '',
          instagram: siteSettings.social_links?.instagram || '',
          twitter: siteSettings.social_links?.twitter || '',
          youtube: siteSettings.social_links?.youtube || '',
          linkedin: siteSettings.social_links?.linkedin || '',
          tiktok: siteSettings.social_links?.tiktok || '',
          whatsapp: siteSettings.social_links?.whatsapp || '',
        }
      });
    }
  }, [siteSettings]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name.startsWith('social_')) {
      const platform = name.replace('social_', '');
      setFormData(prev => ({
        ...prev,
        social_links: { ...prev.social_links, [platform]: value }
      }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const updateList = (field, index, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: prev[field].map((item, itemIndex) => itemIndex === index ? value : item),
    }));
  };

  const addListItem = (field, value = '') => {
    setFormData(prev => ({ ...prev, [field]: [...prev[field], value] }));
  };

  const removeListItem = (field, index) => {
    setFormData(prev => ({ ...prev, [field]: prev[field].filter((_, itemIndex) => itemIndex !== index) }));
  };

  const updateLocation = (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      locations: prev.locations.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item),
    }));
  };



  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');

    const validLocations = formData.locations.filter(loc => loc.en.trim() || loc.ar.trim());
    
    const payload = {
      currency: formData.currency,
      header_phone: formData.header_phone,
      footer_phones: formData.footer_phones.map(s => s.trim()).filter(Boolean),
      footer_emails: formData.footer_emails.map(s => s.trim()).filter(Boolean),
      contact_email: formData.contact_email,
      contact_telephone: formData.contact_telephone,
      contact_address: formData.contact_address,
      header_text_en: formData.header_text_en,
      header_text_ar: formData.header_text_ar,
      footer_text_en: formData.footer_text_en,
      footer_text_ar: formData.footer_text_ar,
      locations_en: validLocations.map(loc => loc.en.trim()),
      locations_ar: validLocations.map(loc => loc.ar.trim()),
      social_links: formData.social_links,
    };

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include'
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to save settings');

      setSiteSettings(data.settings);
      setSuccessMsg(isAr ? 'تم حفظ الإعدادات بنجاح!' : 'Settings saved successfully!');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!formData) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-marine-primary" size={30} /></div>;
  }

  return (
    <form onSubmit={handleSave}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-wide">
            {isAr ? 'التحكم بالصفحة الرئيسية' : 'Landing Control'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {isAr ? 'إدارة النصوص، أرقام التواصل، والعملة' : 'Manage global text, contact info, and currency'}
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
          {isAr ? 'الهوية البصرية' : 'Branding'}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <BrandingUploader
            type="logo"
            label={isAr ? 'الشعار (الوضع الداكن)' : 'Logo (Dark Mode)'}
            currentUrl={siteSettings?.logo_url}
            isAr={isAr}
            onUploaded={(url, settings) => setSiteSettings(settings)}
          />
          <BrandingUploader
            type="logo_light"
            label={isAr ? 'الشعار (الوضع الفاتح)' : 'Logo (Light Mode)'}
            currentUrl={siteSettings?.logo_light_url}
            isAr={isAr}
            onUploaded={(url, settings) => setSiteSettings(settings)}
          />
          <BrandingUploader
            type="favicon"
            currentUrl={siteSettings?.favicon_url}
            isAr={isAr}
            onUploaded={(url, settings) => setSiteSettings(settings)}
          />
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className="bg-white dark:bg-[#09090b] p-6 rounded-xl border border-zinc-100 dark:border-white/5 shadow-sm">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-white mb-4 border-b border-zinc-100 dark:border-white/5 pb-2">
            {isAr ? 'إعدادات عامة' : 'Global Settings'}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>{isAr ? 'العملة الافتراضية' : 'Default Currency'}</label>
              <input type="text" name="currency" value={formData.currency} onChange={handleChange} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{isAr ? 'رقم هاتف الهيدر' : 'Header Phone Number'}</label>
              <input type="tel" name="header_phone" value={formData.header_phone} onChange={handleChange} className={inputClass} />
            </div>
          </div>
        </section>

        <section className="bg-white dark:bg-[#09090b] p-6 rounded-xl border border-zinc-100 dark:border-white/5 shadow-sm">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-white mb-4 border-b border-zinc-100 dark:border-white/5 pb-2">
            {isAr ? 'معلومات التواصل' : 'Contact Info'}
          </h2>
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>{isAr ? 'بريد صفحة التواصل' : 'Contact Page Email'}</label>
                <input
                  type="email"
                  name="contact_email"
                  value={formData.contact_email}
                  onChange={handleChange}
                  placeholder={isAr ? 'أدخل بريد التواصل' : 'Enter contact email'}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>{isAr ? 'هاتف صفحة التواصل' : 'Contact Page Telephone'}</label>
                <input
                  type="tel"
                  name="contact_telephone"
                  value={formData.contact_telephone}
                  onChange={handleChange}
                  placeholder={isAr ? 'أدخل هاتف التواصل' : 'Enter contact telephone'}
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className={labelClass}>{isAr ? 'عنوان صفحة التواصل' : 'Contact Page Address'}</label>
              <input
                type="text"
                name="contact_address"
                value={formData.contact_address}
                onChange={handleChange}
                placeholder={isAr ? 'أدخل عنوان التواصل' : 'Enter contact address'}
                className={inputClass}
              />
            </div>
            <ListField
              label={isAr ? 'أرقام الهواتف في الفوتر' : 'Footer Phone Numbers'}
              value={formData.footer_phones}
              placeholder={isAr ? 'أدخل رقم هاتف' : 'Enter phone number'}
              type="tel"
              isAr={isAr}
              onAdd={() => addListItem('footer_phones')}
              onRemove={index => removeListItem('footer_phones', index)}
              onChange={(index, value) => updateList('footer_phones', index, value)}
            />
            <ListField
              label={isAr ? 'البريد الإلكتروني في الفوتر' : 'Footer Emails'}
              value={formData.footer_emails}
              placeholder={isAr ? 'أدخل بريد إلكتروني' : 'Enter email address'}
              type="email"
              isAr={isAr}
              onAdd={() => addListItem('footer_emails')}
              onRemove={index => removeListItem('footer_emails', index)}
              onChange={(index, value) => updateList('footer_emails', index, value)}
            />
          </div>
        </section>

        <section className="bg-white dark:bg-[#09090b] p-6 rounded-xl border border-zinc-100 dark:border-white/5 shadow-sm">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-white mb-4 border-b border-zinc-100 dark:border-white/5 pb-2">
            {isAr ? 'النصوص الترويجية' : 'Promotional Texts'}
          </h2>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Header Text (EN)</label>
                <input type="text" name="header_text_en" value={formData.header_text_en} onChange={handleChange} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Header Text (AR)</label>
                <input type="text" name="header_text_ar" value={formData.header_text_ar} onChange={handleChange} dir="rtl" className={inputClass} />
              </div>
            </div>
            <div>
              <label className={labelClass}>Footer About Text (EN)</label>
              <textarea name="footer_text_en" value={formData.footer_text_en} onChange={handleChange} rows={3} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Footer About Text (AR)</label>
              <textarea name="footer_text_ar" value={formData.footer_text_ar} onChange={handleChange} dir="rtl" rows={3} className={inputClass} />
            </div>
          </div>
        </section>

        <section className="bg-white dark:bg-[#09090b] p-6 rounded-xl border border-zinc-100 dark:border-white/5 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-4 border-b border-zinc-100 dark:border-white/5 pb-2">
            <h2 className="text-lg font-bold text-zinc-900 dark:text-white">{isAr ? 'الفروع والمواقع' : 'Locations'}</h2>
            <button type="button" onClick={() => addListItem('locations', { en: '', ar: '' })} className="inline-flex items-center gap-1.5 text-xs font-bold text-marine-primary hover:text-red-600">
              <Plus size={14} />
              {isAr ? 'إضافة' : 'Add'}
            </button>
          </div>
          <div className="space-y-3">
            {formData.locations.map((location, index) => (
              <div key={index} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_46px] gap-2">
                <input value={location.en} onChange={e => updateLocation(index, 'en', e.target.value)} placeholder="Doha, Industrial Area" className={inputClass} />
                <input value={location.ar} onChange={e => updateLocation(index, 'ar', e.target.value)} placeholder="الدوحة، المنطقة الصناعية" dir="rtl" className={inputClass} />
                <button
                  type="button"
                  onClick={() => removeListItem('locations', index)}
                  disabled={formData.locations.length === 1}
                  className="h-[46px] w-full md:w-[46px] inline-flex items-center justify-center rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-400 hover:text-red-500 hover:border-red-500/30 disabled:opacity-40"
                  aria-label={isAr ? 'حذف' : 'Remove'}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
          </div>
        </section>


        <section className="bg-white dark:bg-[#09090b] p-6 rounded-xl border border-zinc-100 dark:border-white/5 shadow-sm xl:col-span-2">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-white mb-4 border-b border-zinc-100 dark:border-white/5 pb-2">
            {isAr ? 'روابط التواصل الاجتماعي' : 'Social Media Links'}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-4">
              <div>
                <label className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase mb-2">
                  <Facebook size={14} className="text-blue-600" /> Facebook
                </label>
                <input type="url" name="social_facebook" value={formData.social_links.facebook} onChange={handleChange} placeholder="https://facebook.com/..." className={inputClass} />
              </div>
              <div>
                <label className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase mb-2">
                  <Instagram size={14} className="text-pink-600" /> Instagram
                </label>
                <input type="url" name="social_instagram" value={formData.social_links.instagram} onChange={handleChange} placeholder="https://instagram.com/..." className={inputClass} />
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase mb-2">
                  <Twitter size={14} className="text-sky-500" /> Twitter (X)
                </label>
                <input type="url" name="social_twitter" value={formData.social_links.twitter} onChange={handleChange} placeholder="https://twitter.com/..." className={inputClass} />
              </div>
              <div>
                <label className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase mb-2">
                  <Youtube size={14} className="text-red-600" /> YouTube
                </label>
                <input type="url" name="social_youtube" value={formData.social_links.youtube} onChange={handleChange} placeholder="https://youtube.com/..." className={inputClass} />
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase mb-2">
                  <Linkedin size={14} className="text-blue-700" /> LinkedIn
                </label>
                <input type="url" name="social_linkedin" value={formData.social_links.linkedin} onChange={handleChange} placeholder="https://linkedin.com/..." className={inputClass} />
              </div>
              <div>
                <label className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase mb-2">
                  <MessageCircle size={14} className="text-green-500" /> WhatsApp
                </label>
                <input type="tel" name="social_whatsapp" value={formData.social_links.whatsapp} onChange={handleChange} placeholder="+974..." className={inputClass} />
              </div>
              <div>
                <label className="flex items-center gap-2 text-xs font-bold text-zinc-500 uppercase mb-2">
                  <TikTokIcon size={14} className="text-zinc-900 dark:text-white" /> TikTok
                </label>
                <input type="url" name="social_tiktok" value={formData.social_links.tiktok} onChange={handleChange} placeholder="https://tiktok.com/@..." className={inputClass} />
              </div>
            </div>
          </div>
        </section>
      </div>
    </form>
  );
}
