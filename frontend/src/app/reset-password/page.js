'use client';

import { useEffect, useState } from 'react';
import Link from '../../components/LocaleLink';
import { Eye, EyeOff, Loader2, Lock } from 'lucide-react';
import { authApi } from '../../lib/api';
import { useApp } from '../../context/AppContext';

export default function ResetPasswordPage() {
  const { language, t } = useApp();
  const isAr = language === 'ar';

  const [token, setToken] = useState('');
  const [role, setRole] = useState('user');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get('token') || '');
    setRole(params.get('role') === 'vendor' ? 'vendor' : 'user');
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!token) {
      setError(t.invalidResetLink);
      return;
    }

    if (password !== confirmPassword) {
      setError(t.passwordMismatch);
      return;
    }

    if (password.length < 8) {
      setError(t.resetPasswordHelp);
      return;
    }

    setLoading(true);
    try {
      await authApi.resetPassword({ token, password });
      setSuccess(true);
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err.message || t.invalidResetLink);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#111315] flex items-center justify-center py-12 px-4 relative overflow-hidden" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="absolute inset-0 z-0">
        <img src="https://images.pexels.com/photos/3807517/pexels-photo-3807517.jpeg?auto=compress&cs=tinysrgb&w=1920" alt="Background" className="w-full h-full object-cover opacity-10" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#111315] via-[#111315]/90 to-[#111315]/60" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-marine-cyan rounded-full blur-[128px] opacity-10 -translate-x-1/2 translate-y-1/4" />
      </div>

      <div className="relative z-10 w-full max-w-md bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.6)] p-8 my-10">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-white tracking-tight">{t.chooseNewPassword}</h1>
          <p className="text-zinc-400 mt-2 text-sm">{role === 'vendor' ? t.vendor : t.customer}</p>
        </div>

        {success ? (
          <div className="space-y-6">
            <div className="p-4 bg-green-500/10 border border-green-500/20 text-green-400 text-sm rounded-xl text-center">
              {t.passwordResetSuccess}
            </div>
            <Link
              href={`/login?role=${role === 'vendor' ? 'vendor' : 'customer'}`}
              className="block w-full text-center bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold py-3.5 rounded-xl transition-all"
            >
              {t.signIn}
            </Link>
          </div>
        ) : (
          <form className="space-y-5" onSubmit={handleSubmit}>
            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl text-center">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">{t.newPassword}</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3.5 peer focus:outline-none focus:border-marine-cyan focus:bg-white/10 transition-all text-sm ltr:pl-11 ltr:pr-11 rtl:pr-11 rtl:pl-11"
                  placeholder="••••••••"
                />
                <Lock size={18} className="absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 text-zinc-500 peer-focus:text-marine-primary transition-colors" />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute ltr:right-4 rtl:left-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200 focus:outline-none focus:text-marine-primary transition-colors"
                  aria-label={showPassword ? (isAr ? 'إخفاء كلمة المرور' : 'Hide password') : (isAr ? 'إظهار كلمة المرور' : 'Show password')}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-zinc-500">{t.resetPasswordHelp}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">{t.confirmPassword}</label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3.5 peer focus:outline-none focus:border-marine-cyan focus:bg-white/10 transition-all text-sm ltr:pl-11 ltr:pr-11 rtl:pr-11 rtl:pl-11"
                  placeholder="••••••••"
                />
                <Lock size={18} className="absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 text-zinc-500 peer-focus:text-marine-primary transition-colors" />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((visible) => !visible)}
                  className="absolute ltr:right-4 rtl:left-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200 focus:outline-none focus:text-marine-primary transition-colors"
                  aria-label={showConfirmPassword ? (isAr ? 'إخفاء كلمة المرور' : 'Hide password') : (isAr ? 'إظهار كلمة المرور' : 'Show password')}
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-all shadow-[0_4px_14px_0_rgba(0,166,206,0.39)] hover:shadow-[0_6px_20px_rgba(0,166,206,0.23)] hover:-translate-y-0.5 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={18} className="animate-spin" />}
              {t.resetPassword}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
