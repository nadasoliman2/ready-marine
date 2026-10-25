'use client';

import { useEffect, useState } from 'react';
import Link from '../../components/LocaleLink';
import { ArrowLeft, Loader2, Mail, MessageCircle, Phone, KeyRound, Lock, CheckCircle2 } from 'lucide-react';
import { authApi } from '../../lib/api';
import { useApp } from '../../context/AppContext';

/**
 * Forgotten password — reset by the emailed link, or by a code on WhatsApp.
 *
 * The visitor picks the channel. WhatsApp is two steps on this one page: the number, then
 * the code with the new password. Both steps answer the same way whether or not the
 * number has an account, so the page cannot be used to look people up.
 */
export default function ForgotPasswordPage() {
  const { language, t } = useApp();
  const isAr = language === 'ar';

  const [role, setRole] = useState('user');
  const [method, setMethod] = useState('email'); // 'email' | 'whatsapp'
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState('request'); // whatsapp: 'request' | 'code' | 'done'
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [masked, setMasked] = useState('');
  const [resendAt, setResendAt] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('role') === 'vendor') setRole('vendor');
    if (q.get('method') === 'whatsapp') setMethod('whatsapp');
  }, []);

  // Ticks only while a resend countdown is showing.
  useEffect(() => {
    if (!resendAt) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [resendAt]);
  const resendIn = resendAt ? Math.max(0, Math.ceil((new Date(resendAt).getTime() - now) / 1000)) : 0;

  const resetMessages = () => { setMessage(''); setError(''); };
  const switchMethod = (m) => { setMethod(m); setStep('request'); setCode(''); resetMessages(); };
  const switchRole = (r) => { setRole(r); setStep('request'); setCode(''); resetMessages(); };

  const submitEmail = async (e) => {
    e.preventDefault();
    setLoading(true);
    resetMessages();
    try {
      const res = await authApi.forgotPassword({ role, email, language });
      setMessage(res?.message || t.resetLinkSent);
    } catch (err) {
      setError(err.message || (isAr ? 'تعذر إرسال رابط إعادة التعيين.' : 'Could not send reset link.'));
    } finally {
      setLoading(false);
    }
  };

  const sendCode = async (e) => {
    e?.preventDefault?.();
    setLoading(true);
    resetMessages();
    try {
      const res = await authApi.forgotPasswordOtp({ role, phone, language });
      const v = res?.verification || {};
      setMasked(v.masked_destination || '');
      setResendAt(v.resend_available_at || new Date(Date.now() + 120000).toISOString());
      setStep('code');
      setMessage(isAr
        ? 'لو الرقم ده مسجّل عندنا، هيوصلك كود على واتساب خلال دقيقة.'
        : 'If this number has an account, a code is on its way to WhatsApp — it can take a minute.');
    } catch (err) {
      setError(err.message || (isAr ? 'تعذر إرسال الكود.' : 'Could not send the code.'));
    } finally {
      setLoading(false);
    }
  };

  const resetWithCode = async (e) => {
    e.preventDefault();
    resetMessages();
    if (password.length < 8) {
      setError(isAr ? 'كلمة السر لازم تكون 8 حروف على الأقل.' : 'Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError(isAr ? 'كلمتين السر مش زي بعض.' : 'The two passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await authApi.resetPasswordOtp({ role, phone, code: code.trim(), password });
      setStep('done');
      setMessage('');
    } catch (err) {
      setError(err.message || (isAr ? 'الكود غلط أو انتهى.' : 'Incorrect or expired code.'));
    } finally {
      setLoading(false);
    }
  };

  const inputCls = 'w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3.5 peer focus:outline-none focus:border-marine-cyan focus:bg-white/10 transition-all text-sm ltr:pl-11 rtl:pr-11';
  const iconCls = 'absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 text-zinc-500 peer-focus:text-marine-primary transition-colors';
  const submitCls = 'w-full bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-all shadow-[0_4px_14px_0_rgba(0,166,206,0.39)] hover:shadow-[0_6px_20px_rgba(0,166,206,0.23)] hover:-translate-y-0.5 flex items-center justify-center gap-2';
  const tabCls = (active) => `flex-1 py-2 text-sm font-bold rounded-lg transition-all duration-300 inline-flex items-center justify-center gap-1.5 ${active ? 'bg-marine-cyan text-white shadow-lg' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`;

  return (
    <div className="min-h-screen bg-[#111315] flex items-center justify-center py-12 px-4 relative overflow-hidden" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="absolute inset-0 z-0">
        <img src="https://images.pexels.com/photos/3807517/pexels-photo-3807517.jpeg?auto=compress&cs=tinysrgb&w=1920" alt="Background" className="w-full h-full object-cover opacity-10" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#111315] via-[#111315]/90 to-[#111315]/60" />
        <div className="absolute top-0 right-0 w-96 h-96 bg-marine-cyan rounded-full blur-[128px] opacity-20 translate-x-1/2 -translate-y-1/4" />
      </div>

      <div className="relative z-10 w-full max-w-md bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.6)] p-8 my-10">
        <Link href="/login" className="inline-flex items-center gap-2 text-sm font-bold text-zinc-400 hover:text-white transition-colors mb-6">
          <ArrowLeft size={16} className={isAr ? 'rotate-180' : ''} />
          {t.signIn}
        </Link>

        <div className="text-center mb-8">
          <h1 className="text-3xl font-black text-white tracking-tight">{t.resetPasswordTitle}</h1>
          <p className="text-zinc-400 mt-2 text-sm">
            {isAr ? 'اختار هتسترجع حسابك إزاي: رابط على الإيميل أو كود على واتساب.' : 'Choose how to reset it: a link by email or a code on WhatsApp.'}
          </p>
        </div>

        {/* Whose account */}
        <div className="flex p-1 bg-white/5 rounded-xl mb-3 border border-white/5">
          <button type="button" onClick={() => switchRole('user')} className={tabCls(role === 'user')}>{t.customer}</button>
          <button type="button" onClick={() => switchRole('vendor')} className={tabCls(role === 'vendor')}>{t.vendor}</button>
        </div>

        {/* How */}
        <div className="flex p-1 bg-white/5 rounded-xl mb-6 border border-white/5">
          <button type="button" onClick={() => switchMethod('email')} className={tabCls(method === 'email')}>
            <Mail size={15} /> {isAr ? 'بالإيميل' : 'By email'}
          </button>
          <button type="button" onClick={() => switchMethod('whatsapp')} className={tabCls(method === 'whatsapp')}>
            <MessageCircle size={15} /> {isAr ? 'بواتساب' : 'By WhatsApp'}
          </button>
        </div>

        {message && (
          <div className="mb-6 p-4 bg-green-500/10 border border-green-500/20 text-green-400 text-sm rounded-xl text-center">
            {method === 'email' && isAr ? t.resetLinkSent : message}
          </div>
        )}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl text-center">{error}</div>
        )}

        {method === 'email' ? (
          <form className="space-y-5" onSubmit={submitEmail}>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">{t.emailAddress}</label>
              <div className="relative">
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="name@example.com" />
                <Mail size={18} className={iconCls} />
              </div>
            </div>
            <button type="submit" disabled={loading} className={submitCls}>
              {loading && <Loader2 size={18} className="animate-spin" />}
              {t.sendResetLink}
            </button>
          </form>
        ) : step === 'done' ? (
          <div className="text-center space-y-5">
            <CheckCircle2 size={48} className="mx-auto text-emerald-400" />
            <p className="text-white font-bold">{isAr ? 'تم تغيير كلمة السر.' : 'Your password has been changed.'}</p>
            <p className="text-zinc-400 text-sm">{isAr ? 'سجّل دخولك بكلمة السر الجديدة.' : 'Sign in with your new password.'}</p>
            <Link href={role === 'vendor' ? '/login?role=vendor' : '/login'} className={submitCls}>{t.signIn}</Link>
          </div>
        ) : step === 'request' ? (
          <form className="space-y-5" onSubmit={sendCode}>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                {isAr ? 'رقم الموبايل المسجّل في الحساب' : 'The mobile number on the account'}
              </label>
              <div className="relative">
                <input type="tel" dir="ltr" required value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="01xxxxxxxxx" />
                <Phone size={18} className={iconCls} />
              </div>
            </div>
            <button type="submit" disabled={loading} className={submitCls}>
              {loading && <Loader2 size={18} className="animate-spin" />}
              {isAr ? 'ابعت الكود على واتساب' : 'Send the code on WhatsApp'}
            </button>
          </form>
        ) : (
          <form className="space-y-5" onSubmit={resetWithCode}>
            <p className="text-sm text-zinc-400 text-center">
              {isAr ? 'اكتب الكود اللي وصلك على واتساب' : 'Enter the code sent on WhatsApp to'}
              {masked && <span className="font-bold text-white" dir="ltr"> {masked}</span>}
            </p>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">{isAr ? 'الكود' : 'Code'}</label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  dir="ltr"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className={`${inputCls} tracking-[0.4em] font-bold`}
                  placeholder="••••••"
                />
                <KeyRound size={18} className={iconCls} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">{isAr ? 'كلمة السر الجديدة' : 'New password'}</label>
              <div className="relative">
                <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder={isAr ? '8 حروف على الأقل' : 'At least 8 characters'} />
                <Lock size={18} className={iconCls} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">{isAr ? 'أكّد كلمة السر' : 'Confirm password'}</label>
              <div className="relative">
                <input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputCls} />
                <Lock size={18} className={iconCls} />
              </div>
            </div>
            <button type="submit" disabled={loading || code.length !== 6} className={submitCls}>
              {loading && <Loader2 size={18} className="animate-spin" />}
              {isAr ? 'غيّر كلمة السر' : 'Change password'}
            </button>
            <div className="flex items-center justify-between text-xs">
              <button type="button" onClick={() => { setStep('request'); setCode(''); resetMessages(); }} className="text-zinc-400 hover:text-white font-bold">
                {isAr ? 'غيّر الرقم' : 'Change number'}
              </button>
              <button
                type="button"
                onClick={sendCode}
                disabled={loading || resendIn > 0}
                className="text-marine-primary hover:text-red-400 font-bold disabled:text-zinc-500 disabled:cursor-not-allowed"
              >
                {resendIn > 0
                  ? (isAr ? `ابعت تاني بعد ${resendIn} ث` : `Resend in ${resendIn}s`)
                  : (isAr ? 'ابعت الكود تاني' : 'Resend code')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
