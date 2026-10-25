'use client';

import { storeUrl } from '../../../lib/storeLink';
import { useState, useEffect } from 'react';
import { vendorApi } from '../../../lib/api';
import { useApp } from '../../../context/AppContext';
import { Save, Loader2, Info, Store, User, Mail, Phone, MapPin, AtSign, Image as ImageIcon, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { useRouter } from '../../../lib/navigation';
import SingleImageUploader from '../../../components/dashboard/SingleImageUploader';
import ShippingZoneSelect from '../../../components/ShippingZoneSelect';

export default function VendorSettingsPage() {
  const { language, t, user, login } = useApp();
  const isAr = language === 'ar';
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [appOrigin, setAppOrigin] = useState('');

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    store_name: '',
    store_username: '',
    store_image: null,
    locations: []
  });

  useEffect(() => {
    setAppOrigin(window.location.origin);

    const fetchProfile = async () => {
      try {
        const data = await vendorApi.getProfile();
        setForm({
          name: data.name || '',
          email: data.email || '',
          phone: data.phone || '',
          store_name: data.store_name || '',
          store_username: data.store_username || '',
          store_image: data.store_image || null,
          // The clean link as saved; shown while the username is unchanged.
          store_slug: data.store_slug || '',
          saved_username: data.store_username || '',
          locations: data.locations || []
        });
      } catch (err) {
        setError(isAr ? 'تعذر تحميل بيانات المتجر.' : (err.message || 'Failed to load profile.'));
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    if (!form.locations || form.locations.length === 0) {
      setError(isAr ? 'يجب إضافة موقع واحد على الأقل للمتجر' : 'At least one store location is required.');
      setSaving(false);
      return;
    }

    try {
      // The saved link and username are display-only here; the server sets the slug itself.
      const { store_slug: _slug, saved_username: _saved, ...payload } = form;
      const res = await vendorApi.updateProfile(payload);
      if (res?.profile) {
        setForm((f) => ({ ...f, store_slug: res.profile.store_slug || f.store_slug, saved_username: res.profile.store_username || f.saved_username }));
      }
      setSuccess(t.profileUpdated || 'Profile updated successfully!');
      
      // Update global user context just in case name/store_name changed
      if (user) {
        login({ ...user, ...res.profile });
      }
    } catch (err) {
      setError(isAr ? 'تعذر تحديث بيانات المتجر.' : (err.message || 'Failed to update profile.'));
    } finally {
      setSaving(false);
    }
  };

  const addLocation = () => {
    setForm(prev => ({
      ...prev,
      locations: [...(prev.locations || []), { address: '', is_default: prev.locations?.length === 0 }]
    }));
  };

  const removeLocation = (index) => {
    setForm(prev => {
      const newLocs = prev.locations.filter((_, i) => i !== index);
      // If we removed the default one, pick the first remaining as default
      if (prev.locations[index]?.is_default && newLocs.length > 0) {
        newLocs[0].is_default = true;
      }
      return { ...prev, locations: newLocs };
    });
  };

  const updateLocation = (index, field, value) => {
    setForm(prev => ({
      ...prev,
      locations: prev.locations.map((loc, i) => i === index ? { ...loc, [field]: value } : loc)
    }));
  };

  const setDefaultLocation = (index) => {
    setForm(prev => ({
      ...prev,
      locations: prev.locations.map((loc, i) => ({ ...loc, is_default: i === index }))
    }));
  };

  const storePreviewUrl = storeUrl(
    (form.store_slug && form.store_username === form.saved_username ? form.store_slug : form.store_username) || 'your-store',
    appOrigin || ''
  );

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-marine-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto pb-12 animate-in fade-in duration-300">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">
          {t.storeSettings || 'Store Settings'}
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          {t.manageStoreDetails || 'Manage your store details and contact information.'}
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
          <Info size={16} /> {error}
        </div>
      )}

      {success && (
        <div className="mb-6 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-600 dark:text-emerald-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
          <Info size={16} /> {success}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        
        {/* Store Info Section */}
        <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
            <h3 className="font-bold text-zinc-900 dark:text-white flex items-center gap-2">
              <Store size={18} className="text-marine-primary" />
              {t.storeInfo || 'Store Information'}
            </h3>
          </div>
          <div className="p-6 space-y-6">
            <div className="flex flex-col md:flex-row gap-8 items-start">
              <div className="w-full md:w-1/3">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2 block">
                  {t.storeLogo || 'Store Logo / Image'}
                </label>
                <SingleImageUploader 
                  value={form.store_image} 
                  onChange={(url) => setForm({...form, store_image: url})} 
                  label={t.uploadLogo || 'Upload Logo'}
                />
              </div>
              
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-6 w-full">
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.storeName || 'Store Name'}</label>
                  <input 
                    type="text" 
                    required 
                    value={form.store_name} 
                    onChange={e => setForm({...form, store_name: e.target.value})} 
                    className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:border-marine-cyan focus:outline-none dark:text-white transition-colors" 
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{isAr ? 'رابط المتجر (Slug)' : 'Store Username (URL Slug)'}</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"><AtSign size={16} /></span>
                    <input 
                      type="text" 
                      required 
                      value={form.store_username} 
                      onChange={e => setForm({...form, store_username: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '')})} 
                      className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg pl-10 pr-3 py-2.5 text-sm focus:border-marine-cyan focus:outline-none dark:text-white transition-colors" 
                    />
                  </div>
                  <p className="text-[10px] text-zinc-400 mt-1" dir="ltr">{storePreviewUrl}</p>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.ownerName || 'Owner Name'}</label>
                  <input 
                    type="text" 
                    required 
                    value={form.name} 
                    onChange={e => setForm({...form, name: e.target.value})} 
                    className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:border-marine-cyan focus:outline-none dark:text-white transition-colors" 
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.emailAddress || 'Email Address'}</label>
                  <input 
                    type="email" 
                    required 
                    readOnly
                    disabled
                    value={form.email} 
                    className="w-full bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-zinc-500 focus:outline-none transition-colors cursor-not-allowed" 
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.phoneNumber || 'Phone Number'}</label>
                  <input 
                    type="tel" 
                    required 
                    readOnly
                    disabled
                    value={form.phone} 
                    className="w-full bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-zinc-500 focus:outline-none transition-colors cursor-not-allowed" 
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Locations Section */}
        <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02] flex items-center justify-between">
            <h3 className="font-bold text-zinc-900 dark:text-white flex items-center gap-2">
              <MapPin size={18} className="text-marine-primary" />
              {t.storeLocations || 'Store Locations'}
            </h3>
            <button 
              type="button" 
              onClick={addLocation}
              className="text-xs font-bold text-marine-primary hover:text-red-600 flex items-center gap-1 transition-colors"
            >
              <Plus size={14} /> {t.addLocation || 'Add Location'}
            </button>
          </div>
          <div className="p-6 space-y-4">
            {form.locations?.length === 0 ? (
              <div className="text-center py-8 border-2 border-dashed border-zinc-100 dark:border-white/5 rounded-2xl">
                <p className="text-sm text-zinc-400">{t.noLocationsAdded || 'No locations added yet.'}</p>
              </div>
            ) : (
              form.locations?.map((loc, idx) => (
                <div key={idx} className="bg-zinc-50 dark:bg-white/[0.02] p-4 rounded-xl border border-zinc-100 dark:border-white/5 space-y-3">
                  <div className="flex items-start gap-4">
                    <input
                      type="text"
                      placeholder={t.addressPlaceholder || 'Full Address (e.g. Cairo Branch, Nasr City)'}
                      value={loc.address}
                      onChange={e => updateLocation(idx, 'address', e.target.value)}
                      className="flex-1 bg-white dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-marine-cyan focus:outline-none dark:text-white transition-colors"
                    />
                    <div className="flex items-center gap-4 shrink-0 pt-1">
                      <label className="flex items-center gap-2 cursor-pointer group">
                        <input type="radio" name="default_location" checked={loc.is_default} onChange={() => setDefaultLocation(idx)} className="w-4 h-4 accent-marine-cyan" />
                        <span className="text-xs font-bold text-zinc-500 group-hover:text-zinc-700 dark:group-hover:text-zinc-300 transition-colors">{t.default || 'Default'}</span>
                      </label>
                      <button type="button" onClick={() => removeLocation(idx)} className="p-2 text-zinc-400 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                    </div>
                  </div>
                  <ShippingZoneSelect
                    variant="dashboard"
                    country={loc.shipping_country || ''}
                    city={loc.shipping_city || ''}
                    onChange={({ country, city }) => { updateLocation(idx, 'shipping_country', country); updateLocation(idx, 'shipping_city', city); }}
                  />
                  {/* Bosta sync status (read-only) */}
                  <div className="flex items-center gap-2 mt-1">
                    {loc.bosta_location_id ? (
                      <span className="text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded-lg flex items-center gap-1">
                        <CheckCircle2 size={10} />
                        {isAr ? 'متزامن مع بوسطة' : 'Synced to Bosta'}
                      </span>
                    ) : loc.shipping_city ? (
                      <span className="text-[10px] font-bold text-amber-500 bg-amber-500/10 px-2 py-1 rounded-lg">
                        {isAr ? 'سيتم المزامنة عند الحفظ' : 'Will sync to Bosta on save'}
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-zinc-400 bg-zinc-100 dark:bg-white/5 px-2 py-1 rounded-lg">
                        {isAr ? 'اختر مدينة للمزامنة مع بوسطة' : 'Select a city to sync with Bosta'}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
            <p className="text-[10px] text-zinc-400 italic">
              {t.defaultLocationRequirement || '* You must set one location as the default for new orders.'}
            </p>
          </div>
        </section>

        {/* Personal & Contact Section */}
        <section className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
            <h3 className="font-bold text-zinc-900 dark:text-white flex items-center gap-2">
              <User size={18} className="text-marine-primary" />
              {t.personalInfo || 'Contact Information'}
            </h3>
          </div>
          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.fullName || 'Full Name'}</label>
              <input 
                type="text" 
                required 
                value={form.name} 
                onChange={e => setForm({...form, name: e.target.value})} 
                className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:border-marine-cyan focus:outline-none dark:text-white transition-colors" 
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.emailAddress || 'Email Address'}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"><Mail size={16} /></span>
                <input 
                  type="email" 
                  required 
                  value={form.email} 
                  onChange={e => setForm({...form, email: e.target.value})} 
                  className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg pl-10 pr-3 py-2.5 text-sm focus:border-marine-cyan focus:outline-none dark:text-white transition-colors" 
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t.phoneNumber || 'Phone Number'}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"><Phone size={16} /></span>
                <input 
                  type="tel" 
                  required 
                  value={form.phone} 
                  onChange={e => setForm({...form, phone: e.target.value})} 
                  className="w-full bg-zinc-50 dark:bg-[#0E1012] border border-zinc-200 dark:border-white/10 rounded-lg pl-10 pr-3 py-2.5 text-sm focus:border-marine-cyan focus:outline-none dark:text-white transition-colors" 
                />
              </div>
            </div>
          </div>
        </section>

        {/* Action Button */}
        <div className="flex justify-end pt-4">
          <button 
            type="submit"
            disabled={saving}
            className="bg-marine-cyan hover:bg-marine-cyan-dark disabled:bg-zinc-400 text-white px-8 py-3 rounded-xl text-sm font-bold shadow-md shadow-red-900/20 transition-all flex items-center gap-2"
          >
            {saving && <Loader2 size={18} className="animate-spin" />}
            <Save size={18} /> {t.saveChanges || 'Save Changes'}
          </button>
        </div>

      </form>
    </div>
  );
}
