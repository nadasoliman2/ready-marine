'use client';

import {
  Camera,
  Loader2,
  CheckCircle2,
  AlertCircle,
  User,
  Mail,
  Phone,
  Globe,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import Link from '../LocaleLink';
import { resolveAssetUrl } from '../../lib/assets';
import ProfileHeaderBar from './ProfileHeaderBar';

export default function SettingsDetailPersonalInfo({
  profile,
  user,
  infoForm,
  setInfoForm,
  onSubmit,
  submitting,
  message,
  uploadingPhoto,
  onProfilePhotoChange,
  isAr = true,
  t,
}) {
  const hasPendingEmail = Boolean(profile?.pending_email);
  const isEmailModified = Boolean(infoForm.email && infoForm.email !== profile?.email);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Header Bar with Back Button to Profile */}
      <ProfileHeaderBar
        title={isAr ? 'المعلومات الشخصية' : 'Personal Information'}
        subtitle={isAr ? 'تعديل بيانات حسابك الشخصي' : 'Update your personal profile details'}
        backHref="/profile"
        isAr={isAr}
      />

      {/* Global Message Banner */}
      {message?.text && (
        <div
          className={`p-4 rounded-2xl text-sm font-bold flex items-center gap-3 animate-in fade-in ${
            message.type === 'success'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
              : 'bg-red-50 border border-red-200 text-red-600'
          }`}
        >
          {message.type === 'success' ? <CheckCircle2 size={18} className="shrink-0" /> : <AlertCircle size={18} className="shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Pending Email Notice Card (if user has an unconfirmed email staged) */}
      {hasPendingEmail && (
        <div className="bg-amber-50 border border-amber-200/90 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs animate-in fade-in">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
              <Mail size={19} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="font-bold text-xs sm:text-sm text-zinc-900">
                  {isAr ? 'بريد إلكتروني بانتظار التأكيد' : 'Pending Email Verification'}
                </h4>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-200/70 text-amber-900">
                  {isAr ? 'مطلوب الرمز' : 'Action Required'}
                </span>
              </div>
              <p className="text-xs font-mono font-bold text-marine-primary mt-0.5 truncate dir-ltr text-start">
                {profile.pending_email}
              </p>
            </div>
          </div>

          <Link
            href="/profile?view=verify-email-change"
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-marine-primary hover:bg-marine-navy text-white text-xs font-bold transition-all shadow-xs shrink-0"
          >
            <ShieldCheck size={14} />
            <span>{isAr ? 'إدخال رمز التأكيد' : 'Enter Verification Code'}</span>
          </Link>
        </div>
      )}

      {/* Avatar Change Section */}
      <div className="bg-white border border-zinc-200/90 rounded-2xl p-5 shadow-sm flex items-center gap-4">
        <div className="relative shrink-0">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-marine-primary to-marine-cyan flex items-center justify-center text-white text-xl font-black shadow-sm overflow-hidden ring-2 ring-zinc-100">
            {profile?.profile_image ? (
              <img
                src={resolveAssetUrl(profile.profile_image)}
                alt={profile?.name || 'Profile'}
                className="w-full h-full object-cover"
              />
            ) : (
              profile?.name?.[0]?.toUpperCase() || 'U'
            )}
          </div>
          <label
            className="absolute -bottom-1 -end-1 w-6 h-6 rounded-full bg-marine-primary text-white border border-white shadow flex items-center justify-center cursor-pointer hover:bg-marine-cyan transition-colors"
            title={isAr ? 'تغيير الصورة' : 'Change photo'}
          >
            {uploadingPhoto ? <Loader2 size={11} className="animate-spin" /> : <Camera size={11} />}
            <input
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp"
              onChange={onProfilePhotoChange}
              className="hidden"
              disabled={uploadingPhoto}
            />
          </label>
        </div>

        <div>
          <h2 className="text-sm font-bold text-zinc-900">{isAr ? 'الصورة الشخصية' : 'Profile Picture'}</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {isAr ? 'اضغط على أيقونة الكاميرا لرفع صورة جديدة' : 'Tap camera icon to upload a new picture'}
          </p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={onSubmit} className="bg-white border border-zinc-200/90 rounded-2xl p-6 shadow-sm space-y-5">
        {/* Full Name */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider flex items-center gap-2">
            <User size={14} className="text-marine-primary" />
            <span>{isAr ? 'الاسم بالكامل' : 'Full Name'}</span>
          </label>
          <input
            type="text"
            required
            value={infoForm.name}
            onChange={(e) => setInfoForm({ ...infoForm, name: e.target.value })}
            className="w-full bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan focus:bg-white focus:ring-2 focus:ring-marine-cyan/15 transition-all text-sm font-medium"
          />
        </div>

        {/* Email Address */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider flex items-center gap-2">
              <Mail size={14} className="text-marine-primary" />
              <span>{isAr ? 'البريد الإلكتروني' : 'Email Address'}</span>
            </label>
            {profile?.email_verified_at && (
              <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                <CheckCircle2 size={10} />
                <span>{isAr ? 'مؤكد' : 'Verified'}</span>
              </span>
            )}
          </div>
          <input
            type="email"
            required
            value={infoForm.email}
            onChange={(e) => setInfoForm({ ...infoForm, email: e.target.value })}
            className="w-full bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan focus:bg-white focus:ring-2 focus:ring-marine-cyan/15 transition-all text-sm font-medium"
          />

          {isEmailModified && (
            <p className="text-[11px] text-amber-600 font-semibold flex items-center gap-1.5 mt-1 animate-in fade-in">
              <Clock size={13} className="shrink-0" />
              <span>
                {isAr
                  ? 'ملاحظة: سيتم توجيهك لصفحة تأكيد الرمز للبريد الجديد قبل تفعيله لحسابك.'
                  : 'Notice: You will be redirected to verify your new email address.'}
              </span>
            </p>
          )}
        </div>

        {/* Phone Number */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider flex items-center gap-2">
            <Phone size={14} className="text-marine-primary" />
            <span>{isAr ? 'رقم الهاتف' : 'Phone Number'}</span>
          </label>
          <input
            type="tel"
            required
            value={infoForm.phone}
            onChange={(e) => setInfoForm({ ...infoForm, phone: e.target.value })}
            className="w-full bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan focus:bg-white focus:ring-2 focus:ring-marine-cyan/15 transition-all text-sm font-medium"
          />
        </div>

        {/* Preferred Language */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider flex items-center gap-2">
            <Globe size={14} className="text-marine-primary" />
            <span>{isAr ? 'لغة الإشعارات المفضلة' : 'Preferred Notification Language'}</span>
          </label>
          <select
            value={infoForm.preferred_language || 'en'}
            onChange={(e) => setInfoForm({ ...infoForm, preferred_language: e.target.value })}
            className="w-full bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-xl px-4 py-3 focus:outline-none focus:border-marine-cyan focus:bg-white focus:ring-2 focus:ring-marine-cyan/15 transition-all text-sm font-medium"
          >
            <option value="ar">العربية (Arabic)</option>
            <option value="en">English</option>
          </select>
          <p className="text-zinc-500 text-[11px] leading-relaxed">
            {isAr
              ? 'تُرسل رسائل البريد والإشعارات وتحديثات الطلبات بهذه اللغة.'
              : 'Emails and order status updates will be sent in this language.'}
          </p>
        </div>

        {/* Submit Button */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="w-full sm:w-auto bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold py-3 px-8 rounded-xl transition-all shadow-[0_4px_14px_0_rgba(0,166,206,0.35)] flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 size={16} className="animate-spin" />}
            <span>{isAr ? 'حفظ التغييرات' : 'Save Changes'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
