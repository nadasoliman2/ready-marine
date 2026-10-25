'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2, Loader2, Save, Send, Phone, MessageCircle, Link as LinkIcon, Store, MapPin } from 'lucide-react';
import ImageUploader from './ImageUploader';
import { getServiceLocations } from '../../lib/serviceLocations';

const inputClass = 'w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white';

const socialPlatforms = ['facebook', 'instagram', 'tiktok', 'x', 'youtube', 'linkedin', 'website', 'other'];

const emptyLocation = () => ({ name_en: '', name_ar: '', link: '' });

function getInitialLocations(initialData) {
  const locations = getServiceLocations(initialData || {});
  return locations.length ? locations : [emptyLocation()];
}

function DynamicList({ label, icon: Icon, values, onAdd, onChange, onRemove, placeholder, type = 'text' }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
          {Icon ? <Icon size={12} /> : null}
          {label}
        </label>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 text-xs font-bold text-marine-primary hover:text-red-600"
        >
          <Plus size={12} /> Add
        </button>
      </div>
      {values.map((value, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <input
            type={type}
            value={value}
            onChange={e => onChange(idx, e.target.value)}
            placeholder={placeholder}
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => onRemove(idx)}
            disabled={values.length === 1}
            className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-zinc-200 dark:border-white/10 text-zinc-400 hover:text-red-500 disabled:opacity-40"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export default function ServiceForm({
  initialData,
  loading,
  onSubmit,
  onCancel,
  submitLabel = 'Save Service',
  publishLabel = 'Save & Activate',
}) {
  const [savingStatus, setSavingStatus] = useState(null);
  const [error, setError] = useState('');

  const [form, setForm] = useState(() => ({
    title_en: initialData?.title_en || '',
    title_ar: initialData?.title_ar || '',
    description_en: initialData?.description_en || '',
    description_ar: initialData?.description_ar || '',
    vendor_name_en: initialData?.vendor_name_en || '',
    vendor_name_ar: initialData?.vendor_name_ar || '',
    locations: getInitialLocations(initialData),
    phones: initialData?.phones?.length ? initialData.phones : [''],
    whatsapp_numbers: initialData?.whatsapp_numbers?.length ? initialData.whatsapp_numbers : [''],
    social_links: initialData?.social_links?.length ? initialData.social_links : [{ platform: 'instagram', url: '' }],
    images: initialData?.images || [],
    price: initialData?.price ?? '',
    featured: Boolean(initialData?.featured),
    show_in_banner_ad_slider: Boolean(initialData?.show_in_banner_ad_slider),
    status: initialData?.status || 'active',
  }));

  const canSubmit = useMemo(() => {
    const hasTitle = Boolean(form.title_en.trim() || form.title_ar.trim());
    const hasDescription = Boolean(form.description_en.trim() || form.description_ar.trim());
    const hasVendorName = Boolean(form.vendor_name_en.trim() || form.vendor_name_ar.trim());
    const hasVendorLocation = form.locations.some(location => String(location.name_en || '').trim() || String(location.name_ar || '').trim());
    const hasContact = form.phones.some(v => String(v).trim()) || form.whatsapp_numbers.some(v => String(v).trim());
    const hasImage = form.images.length > 0;
    const hasValidPrice = form.price === '' || (Number.isFinite(Number(form.price)) && Number(form.price) >= 0);
    return hasTitle && hasDescription && hasVendorName && hasVendorLocation && hasContact && hasImage && hasValidPrice;
  }, [form]);

  const updateList = (field, index, value) => {
    setForm(prev => ({
      ...prev,
      [field]: prev[field].map((item, i) => (i === index ? value : item)),
    }));
  };

  const addListItem = (field, initial = '') => {
    setForm(prev => ({ ...prev, [field]: [...prev[field], initial] }));
  };

  const removeListItem = (field, index) => {
    setForm(prev => {
      const next = prev[field].filter((_, i) => i !== index);
      return { ...prev, [field]: next.length ? next : [''] };
    });
  };

  const updateSocialLink = (index, key, value) => {
    setForm(prev => ({
      ...prev,
      social_links: prev.social_links.map((item, i) => (i === index ? { ...item, [key]: value } : item)),
    }));
  };

  const addSocialLink = () => {
    setForm(prev => ({
      ...prev,
      social_links: [...prev.social_links, { platform: 'other', url: '' }],
    }));
  };

  const removeSocialLink = (index) => {
    setForm(prev => {
      const next = prev.social_links.filter((_, i) => i !== index);
      return {
        ...prev,
        social_links: next.length ? next : [{ platform: 'other', url: '' }],
      };
    });
  };

  const updateLocation = (index, key, value) => {
    setForm(prev => ({
      ...prev,
      locations: prev.locations.map((location, i) => (i === index ? { ...location, [key]: value } : location)),
    }));
  };

  const addLocation = () => {
    setForm(prev => ({
      ...prev,
      locations: [...prev.locations, emptyLocation()],
    }));
  };

  const removeLocation = (index) => {
    setForm(prev => {
      const next = prev.locations.filter((_, i) => i !== index);
      return {
        ...prev,
        locations: next.length ? next : [emptyLocation()],
      };
    });
  };

  const submit = async (targetStatus) => {
    setSavingStatus(targetStatus);
    setError('');

    try {
      const payload = {
        ...form,
        status: targetStatus,
        price: form.price === '' ? null : Number(form.price),
        phones: form.phones.map(v => String(v).trim()).filter(Boolean),
        whatsapp_numbers: form.whatsapp_numbers.map(v => String(v).trim()).filter(Boolean),
        locations: form.locations
          .map(location => ({
            name_en: String(location.name_en || '').trim(),
            name_ar: String(location.name_ar || '').trim(),
            link: String(location.link || '').trim(),
          }))
          .filter(location => location.name_en || location.name_ar),
        social_links: form.social_links
          .map(link => ({ platform: link.platform, url: String(link.url || '').trim() }))
          .filter(link => link.url),
      };

      await onSubmit(payload);
    } catch (err) {
      setError(err.message || 'Failed to save service');
    } finally {
      setSavingStatus(null);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
          <h3 className="font-bold text-zinc-900 dark:text-white">1. Service Details</h3>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Title (EN) *</label>
            <input value={form.title_en} onChange={e => setForm({ ...form, title_en: e.target.value })} className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Title (AR)</label>
            <input value={form.title_ar} onChange={e => setForm({ ...form, title_ar: e.target.value })} dir="rtl" className={inputClass} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Description (EN) *</label>
            <textarea rows={4} value={form.description_en} onChange={e => setForm({ ...form, description_en: e.target.value })} className={inputClass} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Description (AR)</label>
            <textarea rows={4} value={form.description_ar} onChange={e => setForm({ ...form, description_ar: e.target.value })} dir="rtl" className={inputClass} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Price</label>
            <input type="number" min="0" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} className={inputClass} />
          </div>
        </div>
      </section>

      <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
          <h3 className="font-bold text-zinc-900 dark:text-white">2. Vendor Information</h3>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5"><Store size={12} /> Vendor Name (EN) *</label>
            <input value={form.vendor_name_en} onChange={e => setForm({ ...form, vendor_name_en: e.target.value })} className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Vendor Name (AR)</label>
            <input value={form.vendor_name_ar} onChange={e => setForm({ ...form, vendor_name_ar: e.target.value })} dir="rtl" className={inputClass} />
          </div>
          <div className="md:col-span-2 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                <MapPin size={12} /> Locations *
              </label>
              <button type="button" onClick={addLocation} className="inline-flex items-center gap-1 text-xs font-bold text-marine-primary hover:text-red-600">
                <Plus size={12} /> Add
              </button>
            </div>
            {form.locations.map((location, idx) => (
              <div key={idx} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_40px] gap-2">
                <input
                  value={location.name_en}
                  onChange={e => updateLocation(idx, 'name_en', e.target.value)}
                  placeholder="Location name or address (EN)"
                  className={inputClass}
                />
                <input
                  value={location.name_ar}
                  onChange={e => updateLocation(idx, 'name_ar', e.target.value)}
                  placeholder="اسم أو عنوان الموقع (AR)"
                  dir="rtl"
                  className={inputClass}
                />
                <input
                  type="url"
                  value={location.link}
                  onChange={e => updateLocation(idx, 'link', e.target.value)}
                  placeholder="https://maps.google.com/..."
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => removeLocation(idx)}
                  disabled={form.locations.length === 1}
                  className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-zinc-200 dark:border-white/10 text-zinc-400 hover:text-red-500 disabled:opacity-40"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
          <h3 className="font-bold text-zinc-900 dark:text-white">3. Contacts & Social</h3>
        </div>
        <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
          <DynamicList
            label="Phone Numbers"
            icon={Phone}
            values={form.phones}
            onAdd={() => addListItem('phones')}
            onChange={(i, value) => updateList('phones', i, value)}
            onRemove={(i) => removeListItem('phones', i)}
            placeholder="+974..."
          />
          <DynamicList
            label="WhatsApp Numbers"
            icon={MessageCircle}
            values={form.whatsapp_numbers}
            onAdd={() => addListItem('whatsapp_numbers')}
            onChange={(i, value) => updateList('whatsapp_numbers', i, value)}
            onRemove={(i) => removeListItem('whatsapp_numbers', i)}
            placeholder="974..."
          />

          <div className="lg:col-span-2 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5"><LinkIcon size={12} /> Social Links</label>
              <button type="button" onClick={addSocialLink} className="inline-flex items-center gap-1 text-xs font-bold text-marine-primary hover:text-red-600">
                <Plus size={12} /> Add
              </button>
            </div>
            {form.social_links.map((link, idx) => (
              <div key={idx} className="grid grid-cols-[170px_1fr_40px] gap-2">
                <select
                  value={link.platform}
                  onChange={e => updateSocialLink(idx, 'platform', e.target.value)}
                  className={inputClass}
                >
                  {socialPlatforms.map(platform => (
                    <option key={platform} value={platform}>{platform}</option>
                  ))}
                </select>
                <input
                  value={link.url}
                  onChange={e => updateSocialLink(idx, 'url', e.target.value)}
                  placeholder="https://..."
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => removeSocialLink(idx)}
                  disabled={form.social_links.length === 1}
                  className="h-10 w-10 inline-flex items-center justify-center rounded-lg border border-zinc-200 dark:border-white/10 text-zinc-400 hover:text-red-500 disabled:opacity-40"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
          <h3 className="font-bold text-zinc-900 dark:text-white">4. Photos</h3>
        </div>
        <div className="p-6">
          <ImageUploader images={form.images} onChange={imgs => setForm({ ...form, images: imgs })} />
        </div>
      </section>

      <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
          <h3 className="font-bold text-zinc-900 dark:text-white">5. Visibility</h3>
        </div>
        <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <label className="flex items-start gap-3 rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/[0.03] p-4 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={form.featured}
              onChange={e => setForm({ ...form, featured: e.target.checked })}
              className="mt-0.5 rounded text-marine-primary focus:ring-marine-cyan"
            />
            <span>
              <span className="block text-zinc-900 dark:text-white">Show on landing featured services section</span>
              <span className="mt-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Adds this service to the standard featured services grid.</span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/[0.03] p-4 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={form.show_in_banner_ad_slider}
              onChange={e => setForm({ ...form, show_in_banner_ad_slider: e.target.checked })}
              className="mt-0.5 rounded text-marine-primary focus:ring-marine-cyan"
            />
            <span>
              <span className="block text-zinc-900 dark:text-white">Show in the banner ad slider</span>
              <span className="mt-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Displays this active service in the full-width homepage banner below Shop by Category.</span>
            </span>
          </label>
          <select
            value={form.status}
            onChange={e => setForm({ ...form, status: e.target.value })}
            className={`${inputClass} lg:col-span-2`}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </section>

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-5 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-300 hover:border-zinc-400"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => submit('inactive')}
          disabled={!canSubmit || !!savingStatus || loading}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-zinc-200 dark:border-white/10 text-zinc-700 dark:text-zinc-300 disabled:opacity-50"
        >
          {savingStatus === 'inactive' ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={() => submit('active')}
          disabled={!canSubmit || !!savingStatus || loading}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold disabled:opacity-50"
        >
          {savingStatus === 'active' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          {publishLabel}
        </button>
      </div>
    </div>
  );
}
