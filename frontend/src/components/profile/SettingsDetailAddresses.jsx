'use client';

import { MapPin, Plus, Edit, Trash2, CheckCircle2, X, Loader2 } from 'lucide-react';
import Overlay from '../Overlay';
import ShippingZoneSelect from '../ShippingZoneSelect';
import ProfileHeaderBar from './ProfileHeaderBar';

export default function SettingsDetailAddresses({
  profile,
  showAddressModal,
  setShowAddressModal,
  addressForm,
  setAddressForm,
  editingAddressId,
  setEditingAddressId,
  onSubmit,
  onDelete,
  submitting,
  isAr = true,
  t,
}) {
  const openNewAddress = () => {
    setEditingAddressId(null);
    setAddressForm({
      label: '',
      recipient_name: '',
      phone: '',
      full_address: '',
      shipping_country: '',
      shipping_city: '',
      is_default: false,
    });
    setShowAddressModal(true);
  };

  const openEditAddress = (addr) => {
    setEditingAddressId(addr._id);
    setAddressForm(addr);
    setShowAddressModal(true);
  };

  const hasAddresses = Boolean(profile?.addresses && profile.addresses.length > 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Header Bar with Back Button to Settings */}
      <ProfileHeaderBar
        title={isAr ? 'عناوين التوصيل' : 'Saved Addresses'}
        subtitle={isAr ? 'إدارة عناوين الشحن والعنوان الافتراضي' : 'Manage your shipping and delivery destinations'}
        backHref="/profile"
        isAr={isAr}
        rightAction={
          hasAddresses ? (
            <button
              type="button"
              onClick={openNewAddress}
              className="flex items-center gap-1.5 bg-marine-cyan hover:bg-marine-cyan-dark text-white px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all shadow-xs"
            >
              <Plus size={16} />
              <span>{isAr ? 'إضافة عنوان' : 'Add Address'}</span>
            </button>
          ) : null
        }
      />

      {/* Addresses Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {profile?.addresses?.map((addr) => (
          <div
            key={addr._id}
            className="bg-white border border-zinc-200/90 rounded-2xl p-5 relative transition-all hover:border-marine-cyan/40 hover:shadow-sm flex flex-col justify-between space-y-4"
          >
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <MapPin size={16} className="text-rose-500 shrink-0" />
                  {addr.label && (
                    <span className="bg-marine-mist text-marine-primary border border-marine-cyan/20 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md">
                      {addr.label}
                    </span>
                  )}
                </div>
                {addr.is_default && (
                  <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md">
                    {isAr ? 'افتراضي' : 'Default'}
                  </span>
                )}
              </div>

              <h3 className="text-zinc-900 font-bold text-base mb-1">{addr.recipient_name}</h3>
              <p className="text-zinc-600 text-xs sm:text-sm mb-1">{addr.phone}</p>
              <p className="text-zinc-500 text-xs sm:text-sm leading-relaxed">{addr.full_address}</p>
            </div>

            <div className="flex items-center gap-4 pt-3 border-t border-zinc-100">
              <button
                type="button"
                onClick={() => openEditAddress(addr)}
                className="flex items-center gap-1.5 text-marine-primary hover:text-marine-cyan text-xs font-bold transition-colors"
              >
                <Edit size={14} />
                <span>{isAr ? 'تعديل' : 'Edit'}</span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(addr._id)}
                className="flex items-center gap-1.5 text-red-500 hover:text-red-700 text-xs font-bold transition-colors"
              >
                <Trash2 size={14} />
                <span>{isAr ? 'حذف' : 'Delete'}</span>
              </button>
            </div>
          </div>
        ))}

        {(!profile?.addresses || profile.addresses.length === 0) && (
          <div className="sm:col-span-2 bg-white border border-dashed border-zinc-200 rounded-3xl p-10 text-center space-y-3">
            <MapPin size={40} className="text-zinc-400 mx-auto" />
            <h3 className="text-zinc-800 font-bold text-base">
              {isAr ? 'لا توجد عناوين مسجلة بعد' : 'No addresses saved yet'}
            </h3>
            <p className="text-xs text-zinc-500 max-w-sm mx-auto">
              {isAr
                ? 'أضف عناوين التوصيل الخاصة بك لتسهيل وتسريع إتمام الطلبات مستقبلاً.'
                : 'Add shipping addresses to speed up checkout on your future marine orders.'}
            </p>
            <button
              type="button"
              onClick={openNewAddress}
              className="inline-flex items-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-xs"
            >
              <Plus size={16} />
              <span>{isAr ? 'إضافة عنوان جديد' : 'Add First Address'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Address Modal (Responsive Bottom Sheet on Mobile / Centered on Desktop) */}
      {showAddressModal && (
        <Overlay className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center sm:p-4 overflow-y-auto" dir={isAr ? 'rtl' : 'ltr'}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowAddressModal(false)} />
          <div className="relative bg-white border border-zinc-200/90 w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[90dvh] sm:max-h-[85vh] overflow-hidden z-10 sm:my-auto animate-in slide-in-from-bottom sm:slide-in-from-bottom-4 duration-200">
            {/* 1. STICKY HEADER */}
            <div className="px-5 sm:px-6 py-4 border-b border-zinc-100 flex items-center justify-between shrink-0 bg-white">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-marine-mist text-marine-primary flex items-center justify-center shrink-0">
                  <MapPin size={18} />
                </div>
                <h3 className="text-base sm:text-lg font-black text-zinc-900">
                  {editingAddressId ? (isAr ? 'تعديل العنوان' : 'Edit Address') : (isAr ? 'إضافة عنوان جديد' : 'New Address')}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddressModal(false)}
                className="w-8 h-8 rounded-full bg-zinc-100 hover:bg-zinc-200 text-zinc-500 hover:text-zinc-800 transition-colors flex items-center justify-center shrink-0"
                aria-label={isAr ? 'إغلاق' : 'Close'}
              >
                <X size={18} />
              </button>
            </div>

            {/* 2. FORM: SCROLLABLE BODY + STICKY FOOTER */}
            <form onSubmit={onSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-4 overscroll-contain">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">
                    {isAr ? 'اسم مختصر (اختياري)' : 'Label (optional)'}
                  </label>
                  <input
                    type="text"
                    maxLength={40}
                    value={addressForm.label || ''}
                    onChange={(e) => setAddressForm({ ...addressForm, label: e.target.value })}
                    placeholder={isAr ? 'المنزل، المارينا، العمل' : 'Home, Marina, Work'}
                    className="w-full bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-xl px-4 py-2.5 focus:outline-none focus:border-marine-cyan focus:bg-white text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">
                    {isAr ? 'اسم المستلم' : 'Recipient Name'}
                  </label>
                  <input
                    type="text"
                    required
                    value={addressForm.recipient_name}
                    onChange={(e) => setAddressForm({ ...addressForm, recipient_name: e.target.value })}
                    className="w-full bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-xl px-4 py-2.5 focus:outline-none focus:border-marine-cyan focus:bg-white text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">
                    {isAr ? 'رقم الهاتف' : 'Phone Number'}
                  </label>
                  <input
                    type="tel"
                    required
                    value={addressForm.phone}
                    onChange={(e) => setAddressForm({ ...addressForm, phone: e.target.value })}
                    className="w-full bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-xl px-4 py-2.5 focus:outline-none focus:border-marine-cyan focus:bg-white text-sm"
                  />
                </div>

                <ShippingZoneSelect
                  dark={false}
                  country={addressForm.shipping_country || ''}
                  city={addressForm.shipping_city || ''}
                  onChange={({ country, city }) =>
                    setAddressForm((f) => ({ ...f, shipping_country: country, shipping_city: city }))
                  }
                />

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider">
                    {isAr ? 'العنوان التفصيلي' : 'Full Address'}
                  </label>
                  <textarea
                    required
                    rows="3"
                    value={addressForm.full_address}
                    onChange={(e) => setAddressForm({ ...addressForm, full_address: e.target.value })}
                    placeholder={isAr ? 'الشارع، رقم المبنى، الشقة، أو اسم الرصيف في المارينا' : 'Street, building, apt, or marina berth'}
                    className="w-full bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-xl px-4 py-2.5 focus:outline-none focus:border-marine-cyan focus:bg-white text-sm"
                  />
                </div>

                <label className="flex items-center gap-3 text-zinc-800 text-xs sm:text-sm cursor-pointer py-1">
                  <input
                    type="checkbox"
                    checked={addressForm.is_default}
                    onChange={(e) => setAddressForm({ ...addressForm, is_default: e.target.checked })}
                    className="w-4 h-4 rounded border-zinc-300 text-marine-primary accent-marine-cyan"
                  />
                  <span>{isAr ? 'ضبط كعنوان توصيل افتراضي' : 'Set as default delivery address'}</span>
                </label>
              </div>

              {/* 3. STICKY FOOTER WITH ALWAYS VISIBLE ACTION BUTTONS */}
              <div className="p-4 sm:px-6 sm:py-4 border-t border-zinc-100 bg-white flex items-center gap-3 shrink-0 shadow-xs">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-marine-cyan hover:bg-marine-cyan-dark text-white py-3 rounded-xl font-bold text-xs sm:text-sm transition-all shadow-xs disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting && <Loader2 size={16} className="animate-spin" />}
                  <span>{isAr ? 'حفظ العنوان' : 'Save Address'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddressModal(false)}
                  className="px-6 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 py-3 rounded-xl font-bold text-xs sm:text-sm transition-all"
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
              </div>
            </form>
          </div>
        </Overlay>
      )}
    </div>
  );
}
