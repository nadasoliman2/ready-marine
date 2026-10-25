'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff, Lock, User as UserIcon, Loader2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import Link from '../../components/LocaleLink';
import { authApi } from '../../lib/api';
import GoogleAuthButton from '../../components/auth/GoogleAuthButton';
import { useRouter } from '../../lib/navigation';
import { safeRedirect } from '../../lib/safeRedirect';
import { MobileListingTop } from '../../components/products/MobileListingHeader';

const getRoleFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const roleParam = params.get('role');

  if (roleParam === 'vendor') return 'vendor';
  if (roleParam === 'customer' || roleParam === 'user') return 'customer';
  return null;
};

// Where a vendor goes after signing in: the dashboard page they were sent to,
// and nothing else — the value comes from the query string.
const getVendorRedirect = () => {
  const redirect = new URLSearchParams(window.location.search).get('redirect');
  return redirect && /^\/dashboard(?:[/?]|$)/.test(redirect) ? redirect : '/dashboard';
};

const updateRoleInUrl = (nextRole) => {
  const url = new URL(window.location.href);
  url.searchParams.set('role', nextRole);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
};

export default function LoginPage() {
  const router = useRouter();
  const { language, isMounted, login, t, siteSettings } = useApp();
  const isAr = language === 'ar';
  
  const [role, setRole] = useState('customer'); // 'customer' | 'vendor'
  const [formData, setFormData] = useState({ identifier: '', password: '' });
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [verificationStatus, setVerificationStatus] = useState(null);
  // True while the Google signup's second step owns the card — the sign-in
  // form steps aside rather than competing with it.
  const [googleStep, setGoogleStep] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verified = params.get('verified');
    const selectedRole = getRoleFromUrl();
    if (selectedRole) setRole(selectedRole);
    // A family invitation sends the invitee here with the invited address, so
    // they sign in with the exact account the invitation was addressed to.
    const prefillEmail = params.get('email');
    if (prefillEmail) setFormData((form) => ({ ...form, identifier: prefillEmail }));
    if (verified === '1') {
      setVerificationStatus('success');
      if (params.get('auto') === '1') {
        authApi.me()
          .then((res) => {
            if (res.role === 'vendor' && res.vendor) {
              login({ ...res.vendor, role: 'vendor' });
              sessionStorage.setItem('readycar_show_vendor_education', '1');
              router.replace('/dashboard');
              router.refresh();
              return;
            }
            if (res.user) {
              login({ ...res.user, role: 'user' });
              router.replace('/');
              router.refresh();
            }
          })
          .catch(() => {});
      }
    } else if (verified === '0') {
      setVerificationStatus('failed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRoleChange = (nextRole) => {
    setRole(nextRole);
    setError('');
    updateRoleInUrl(nextRole);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setVerificationStatus(null);

    try {
      if (role === 'customer') {
        const res = await authApi.loginUser({ ...formData, remember_me: rememberMe });
        login({ ...res.user, role: 'user' }, { rememberMe });
        router.push(safeRedirect('/'));
      } else {
        const res = await authApi.loginVendor({ ...formData, remember_me: rememberMe });
        login({ ...res.vendor, role: 'vendor' }, { rememberMe });
        router.push(getVendorRedirect());
      }
      router.refresh();

    } catch (err) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  // Google sign-in lands here with the session cookie already set. A signup
  // completed through it is brand new, so it goes to the profile prompt that
  // asks the customer to confirm the phone number they just gave.
  const handleGoogleAuthenticated = (res, { created } = {}) => {
    setError('');
    setVerificationStatus(null);

    if (res.role === 'vendor' && res.vendor) {
      login({ ...res.vendor, role: 'vendor' }, { rememberMe });
      if (created) sessionStorage.setItem('readycar_show_vendor_education', '1');
      router.push(created ? '/dashboard' : getVendorRedirect());
    } else {
      login({ ...res.user, role: 'user' }, { rememberMe });
      router.push(safeRedirect(created ? '/profile?tab=info&verify=1' : '/'));
    }
    router.refresh();
  };

  // A phone: a plain white page, as in the app design — the title bar, the logo, the form.
  // From `sm` up, and while Google's second step owns the card (it is drawn for the dark
  // card), the dark page as before.
  const light = !googleStep;
  const logo = siteSettings?.logo_light_url || siteSettings?.logo_url;

  return (
    <div className={`min-h-screen flex justify-center relative overflow-hidden ${light ? 'bg-white sm:bg-zinc-50 sm:items-center sm:py-12 sm:px-4' : 'bg-[#111315] items-center py-12 px-4'}`} dir={isAr ? 'rtl' : 'ltr'}>
      {/* Background aesthetics */}
      <div className={`absolute inset-0 z-0 ${light ? 'hidden' : ''}`}>
        <img src="https://images.pexels.com/photos/3807517/pexels-photo-3807517.jpeg?auto=compress&cs=tinysrgb&w=1920" alt="Background" className="w-full h-full object-cover opacity-10" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#111315] via-[#111315]/90 to-[#111315]/60" />
        <div className="absolute top-0 right-0 w-96 h-96 bg-marine-cyan rounded-full blur-[128px] opacity-20 translate-x-1/2 -translate-y-1/4" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-marine-cyan rounded-full blur-[128px] opacity-10 -translate-x-1/2 translate-y-1/4" />
      </div>

      <div className={`relative z-10 w-full max-w-md ${light
        ? 'px-5 pb-8 sm:bg-white sm:border sm:border-zinc-100 sm:rounded-3xl sm:shadow-[0_20px_60px_rgba(0,0,0,0.08)] sm:p-8 sm:my-10'
        : 'bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.6)] p-8 my-10'}`}>
        {!googleStep && (
        <>
        <div className="-mx-5 mb-6 sm:hidden">
          <MobileListingTop isAr={isAr} title={t.signIn} />
        </div>

        <div className="text-center mb-6 sm:mb-8">
          {logo && <img src={logo} alt="Ready Marine" className="mx-auto h-11 w-auto max-w-[200px] object-contain mb-5" />}
          <h1 className="text-xl sm:text-2xl font-bold text-zinc-900">{isAr ? 'أهلاً بيك في Ready Marine' : 'Welcome to Ready Marine'}</h1>
          <p className="text-zinc-500 mt-1.5 text-xs sm:text-sm">{isAr ? 'سجل دخولك لمتابعة الطلبات والعناوين وعربياتك.' : 'Sign in to follow your orders, addresses and cars.'}</p>
        </div>

        {/* Tab Toggle */}
        <div className="flex p-1 bg-zinc-100 rounded-xl mb-6 border border-zinc-100">
          <button 
            onClick={() => handleRoleChange('customer')}
            className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all duration-300 ${role === 'customer' ? 'bg-marine-cyan text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-900'}`}
          >
            {t.customer}
          </button>
          <button 
            onClick={() => handleRoleChange('vendor')}
            className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all duration-300 ${role === 'vendor' ? 'bg-marine-cyan text-white shadow-lg' : 'text-zinc-500 hover:text-zinc-900'}`}
          >
            {t.vendor}
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-600 text-sm rounded-xl text-center">
            {error}
          </div>
        )}

        {verificationStatus === 'success' && (
          <div className="mb-6 p-4 bg-green-500/10 border border-green-500/20 text-green-700 text-sm rounded-xl text-center">
            {isAr ? 'تم تأكيد بريدك الإلكتروني. يمكنك تسجيل الدخول الآن.' : 'Email verified. You can sign in now.'}
          </div>
        )}

        {verificationStatus === 'failed' && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-600 text-sm rounded-xl text-center">
            {isAr ? 'رابط التحقق غير صالح أو منتهي الصلاحية.' : 'Verification link is invalid or expired.'}
          </div>
        )}

        <form className="space-y-5" onSubmit={handleLogin}>
          <div>
            <label className="block text-sm font-bold text-zinc-900 mb-1.5">
              {t.emailOrPhone}{role === 'vendor' ? ` / ${t.username}` : ''}
            </label>
            <div className="relative">
              <input 
                type="text" 
                required
                value={formData.identifier}
                onChange={(e) => setFormData({ ...formData, identifier: e.target.value })}
                className="w-full bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-xl px-4 py-3.5 peer focus:outline-none focus:border-marine-cyan focus:bg-white transition-all text-base sm:text-sm ltr:pl-11 rtl:pr-11" 
                placeholder={isAr ? 'أدخل بياناتك' : 'Enter your details'} 
              />
              <UserIcon size={18} className="absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 text-zinc-500 peer-focus:text-marine-primary transition-colors" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-bold text-zinc-900 mb-1.5">{t.password}</label>
            <div className="relative">
              <input 
                type={showPassword ? 'text' : 'password'} 
                required
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-xl px-4 py-3.5 peer focus:outline-none focus:border-marine-cyan focus:bg-white transition-all text-base sm:text-sm ltr:pl-11 ltr:pr-11 rtl:pr-11 rtl:pl-11" 
                placeholder="••••••••" 
              />
              <Lock size={18} className="absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 text-zinc-500 peer-focus:text-marine-primary transition-colors" />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                className="absolute ltr:right-4 rtl:left-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-900 focus:outline-none focus:text-marine-primary transition-colors"
                aria-label={showPassword ? (isAr ? 'إخفاء كلمة المرور' : 'Hide password') : (isAr ? 'إظهار كلمة المرور' : 'Show password')}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          
          <div className="flex items-center justify-between text-sm py-1">
            <label className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded border-zinc-300 bg-white text-marine-primary accent-marine-cyan focus:ring-marine-cyan"
              />
              <span className="text-zinc-600 select-none group-hover:text-zinc-900 transition-colors">{t.rememberMe}</span>
            </label>
            <Link href={`/forgot-password?role=${role === 'vendor' ? 'vendor' : 'user'}`} className="text-marine-primary hover:text-red-400 font-medium transition-colors">{t.forgotPassword}</Link>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 sm:py-3.5 rounded-xl transition-all shadow-[0_4px_14px_0_rgba(0,166,206,0.39)] hover:shadow-[0_6px_20px_rgba(0,166,206,0.23)] hover:-translate-y-0.5 mt-4 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            {t.signIn}
          </button>
        </form>
        </>
        )}

        <GoogleAuthButton
          role={role}
          text="signin_with"
          rememberMe={rememberMe}
          language={language}
          onAuthenticated={handleGoogleAuthenticated}
          onError={setError}
          onPendingChange={setGoogleStep}
        />

        {!googleStep && (
          <>
            <Link
              href={`/register?role=${role}`}
              className="mt-4 flex w-full items-center justify-center rounded-xl border-2 border-zinc-900 py-3.5 text-sm font-bold text-zinc-900 active:bg-zinc-50"
            >
              {isAr ? 'إنشاء حساب جديد' : 'Create a new account'}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
