'use client';

import { Lock, Loader2, CheckCircle2, AlertCircle, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import ProfileHeaderBar from './ProfileHeaderBar';

function PasswordFieldInput({ value, onChange, visible, onToggle, isAr }) {
  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-xl px-4 py-3 pe-11 focus:outline-none focus:border-marine-cyan focus:bg-white focus:ring-2 focus:ring-marine-cyan/15 transition-all text-sm"
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute end-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 focus:outline-none focus:text-marine-primary transition-colors"
        aria-label={visible ? (isAr ? 'إخفاء كلمة المرور' : 'Hide password') : (isAr ? 'إظهار كلمة المرور' : 'Show password')}
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

export default function SettingsDetailSecurity({
  passForm,
  setPassForm,
  showPass,
  setShowPass,
  onSubmit,
  submitting,
  message,
  isAr = true,
}) {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Header Bar with Back Button to Settings */}
      <ProfileHeaderBar
        title={isAr ? 'كلمة السر والأمان' : 'Password & Security'}
        subtitle={isAr ? 'تأمين حسابك وتغيير كلمة المرور' : 'Secure your account and change password'}
        backHref="/profile"
        isAr={isAr}
      />

      {message?.text && (
        <div
          className={`p-4 rounded-2xl text-sm font-bold flex items-center gap-3 animate-in fade-in ${
            message.type === 'success'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
              : 'bg-red-50 border border-red-200 text-red-600'
          }`}
        >
          {message.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Security Tip Card */}
      <div className="bg-marine-mist/60 border border-marine-cyan/20 rounded-2xl p-4 flex items-start gap-3">
        <ShieldCheck size={20} className="text-marine-primary shrink-0 mt-0.5" />
        <div className="text-xs text-zinc-700 leading-relaxed">
          <p className="font-bold text-zinc-900 mb-0.5">
            {isAr ? 'نصيحة أمان لحماية حسابك:' : 'Account security tip:'}
          </p>
          <p>
            {isAr
              ? 'اختر كلمة مرور قوية تحتوي على 8 أحرف على الأقل، وتجمع بين الحروف الكبيرة والصغيرة والأرقام والرموز.'
              : 'Choose a strong password with at least 8 characters, combining uppercase and lowercase letters, numbers, and symbols.'}
          </p>
        </div>
      </div>

      {/* Password Change Form */}
      <form onSubmit={onSubmit} className="bg-white border border-zinc-200/90 rounded-2xl p-6 shadow-sm space-y-5 max-w-xl">
        <div className="space-y-2">
          <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider flex items-center gap-2">
            <Lock size={14} className="text-marine-primary" />
            <span>{isAr ? 'كلمة المرور الحالية' : 'Current Password'}</span>
          </label>
          <PasswordFieldInput
            value={passForm.oldPassword}
            visible={showPass.old}
            onToggle={() => setShowPass((p) => ({ ...p, old: !p.old }))}
            onChange={(val) => setPassForm({ ...passForm, oldPassword: val })}
            isAr={isAr}
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider flex items-center gap-2">
            <Lock size={14} className="text-marine-primary" />
            <span>{isAr ? 'كلمة المرور الجديدة' : 'New Password'}</span>
          </label>
          <PasswordFieldInput
            value={passForm.newPassword}
            visible={showPass.next}
            onToggle={() => setShowPass((p) => ({ ...p, next: !p.next }))}
            onChange={(val) => setPassForm({ ...passForm, newPassword: val })}
            isAr={isAr}
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold text-zinc-700 uppercase tracking-wider flex items-center gap-2">
            <Lock size={14} className="text-marine-primary" />
            <span>{isAr ? 'تأكيد كلمة المرور الجديدة' : 'Confirm New Password'}</span>
          </label>
          <PasswordFieldInput
            value={passForm.confirmPassword}
            visible={showPass.confirm}
            onToggle={() => setShowPass((p) => ({ ...p, confirm: !p.confirm }))}
            onChange={(val) => setPassForm({ ...passForm, confirmPassword: val })}
            isAr={isAr}
          />
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="w-full sm:w-auto bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold py-3 px-8 rounded-xl transition-all shadow-[0_4px_14px_0_rgba(0,166,206,0.35)] flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 size={16} className="animate-spin" />}
            <span>{isAr ? 'تحديث كلمة المرور' : 'Update Password'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
