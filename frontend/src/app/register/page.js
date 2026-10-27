'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff, Lock, User as UserIcon, Mail, Phone, MapPin, Store, Hash, Loader2, MessageCircle, ArrowLeft, ShieldCheck } from 'lucide-react';
import { useRouter } from '../../lib/navigation';
import { useApp } from '../../context/AppContext';
import Link from '../../components/LocaleLink';
import { authApi } from '../../lib/api';
import OtpInput from '../../components/verification/OtpInput';
import { verificationCopy, verificationErrorCopy } from '../../lib/verificationLocalization';
import GoogleAuthButton from '../../components/auth/GoogleAuthButton';
import ShippingZoneSelect from '../../components/ShippingZoneSelect';
import VendorEducationModal, { vendorEducationLabel } from '../../components/vendor/VendorEducationModal';
import { safeRedirect } from '../../lib/safeRedirect';
import { MobileListingTop } from '../../components/products/MobileListingHeader';

const getRoleFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const roleParam = params.get('role');

  if (roleParam === 'vendor') return 'vendor';
  if (roleParam === 'customer' || roleParam === 'user') return 'customer';
  return null;
};

const updateRoleInUrl = (nextRole) => {
  const url = new URL(window.location.href);
  url.searchParams.set('role', nextRole);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
};

export default function RegisterPage() {
  // Someone who already has an account switches to "Sign in" here: they keep where signing
  // up was meant to take them (the hero sends them to their garage). Read after mount so the
  // first render matches the server's.
  const [loginRedirect, setLoginRedirect] = useState('');
  useEffect(() => { setLoginRedirect(safeRedirect('')); }, []);

  const router = useRouter();
  const { language, isMounted, t, login } = useApp();
  const isAr = language === 'ar';
  const vc = verificationCopy(isAr);

  const [role, setRole] = useState('customer'); // 'customer' | 'vendor'
  const [loading, setLoading] = useState(false);
  const [showUserPassword, setShowUserPassword] = useState(false);
  const [showVendorPassword, setShowVendorPassword] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [educationOpen, setEducationOpen] = useState(false);
  // True while the Google signup's second step owns the card — the register
  // form steps aside rather than competing with it.
  const [googleStep, setGoogleStep] = useState(false);

  // How the customer proves ownership: an emailed link, or a WhatsApp code.
  // Vendors stay on the email link — they have no post-login prompt to finish
  // confirming whichever detail the other channel would leave unproven.
  const [verificationChannel, setVerificationChannel] = useState('email');

  // Set once a WhatsApp registration is pending; swaps the form for the code screen.
  const [otpStage, setOtpStage] = useState(null);
  const [otpCode, setOtpCode] = useState('');
  const [otpError, setOtpError] = useState('');
  const [resendIn, setResendIn] = useState(0);

  // Form State
  const [userForm, setUserForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [vendorForm, setVendorForm] = useState({
    name: '',
    store_name: '',
    store_username: '',
    email: '',
    phone: '',
    address: '',
    shipping_country: '',
    shipping_city: '',
    password: ''
  });

  useEffect(() => {
    const selectedRole = getRoleFromUrl();
    if (selectedRole) setRole(selectedRole);
  }, []);

  const handleRoleChange = (nextRole) => {
    setRole(nextRole);
    setError('');
    setSuccessMessage('');
    updateRoleInUrl(nextRole);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccessMessage('');

    const phoneRegex = /^(01\d{9}|\+201\d{9})$/;
    const phone = role === 'customer' ? userForm.phone : vendorForm.phone;
    if (!phoneRegex.test(phone)) {
      setError(isAr ? 'رقم الهاتف غير صحيح. يجب أن يبدأ بـ 01xxxxxxxxx أو +201xxxxxxxxx' : 'Invalid phone number. Use 01xxxxxxxxx or +201xxxxxxxxx');
      setLoading(false);
      return;
    }

    try {
      let res;
      if (role === 'customer') {
        res = await authApi.registerUser({
          ...userForm,
          language,
          verification_channel: verificationChannel,
        });

        // WhatsApp path: no account yet — collect the code before creating it.
        if (res?.verification?.channel === 'whatsapp') {
          setOtpStage(res.verification);
          setOtpCode('');
          setResendIn(secondsUntilResend(res.verification));
          setLoading(false);
          return;
        }
      } else {
        if (!vendorForm.address?.trim()) {
          setError(isAr ? 'العنوان مطلوب للمتجر' : 'Store address is required.');
          setLoading(false);
          return;
        }
        res = await authApi.registerVendor({
          ...vendorForm,
          language,
          verification_channel: verificationChannel,
        });

        // A store is always confirmed with a code, over whichever channel the
        // owner picked — no account exists until it is entered.
        if (res?.verification?.verification_id) {
          setOtpStage({ ...res.verification, role: 'vendor' });
          setOtpCode('');
          setResendIn(secondsUntilResend(res.verification));
          setLoading(false);
          return;
        }
      }
      setSuccessMessage(
        isAr
          ? 'تم إرسال رابط التحقق إلى بريدك الإلكتروني. افتح الرابط لإكمال إنشاء الحساب.'
          : res?.message || 'Verification email sent. Please verify your email to complete registration.'
      );
    } catch (err) {
      setError(err.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Seconds until the server will accept another resend. Read from the
  // response so the UI can never contradict the backend's cooldown.
  const secondsUntilResend = (verification) => {
    const at = verification?.resend_available_at;
    if (!at) return 0;
    return Math.max(0, Math.ceil((new Date(at).getTime() - Date.now()) / 1000));
  };

  // Resend countdown, so the button states plainly when it becomes usable.
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setInterval(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendIn]);

  const handleVerifyOtp = async (submitted) => {
    const code = String(submitted ?? otpCode);
    if (code.length !== 6 || loading) return;

    setLoading(true);
    setOtpError('');
    try {
      const res = await authApi.verifyRegistrationOtp({
        verification_id: otpStage.verification_id,
        code,
      });
      // The backend created the account and set the session cookie. A store
      // owner lands on their dashboard, where the prompt asks them to confirm
      // whichever contact detail the code did not prove.
      if (res.role === 'vendor' && res.vendor) {
        login({ ...res.vendor, role: 'vendor' });
        sessionStorage.setItem('readycar_show_vendor_education', '1');
        router.push('/dashboard');
      } else {
        login({ ...res.user, role: 'user' });
        // Back to where signing up started (the hero's "save your cars" sends them to
        // their garage); confirming contact details is prompted on every page anyway.
        router.push(safeRedirect('/profile?tab=info&verify=1'));
      }
      router.refresh();
    } catch (err) {
      setOtpError(
        verificationErrorCopy(err.code, isAr, { retryAfterSeconds: err.retryAfterSeconds })
        || err.message
      );
      setOtpCode('');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendIn > 0 || loading) return;
    setLoading(true);
    setOtpError('');
    try {
      const res = await authApi.resendRegistrationOtp({
        verification_id: otpStage.verification_id,
        language,
      });
      setOtpStage(res.verification);
      setOtpCode('');
      setResendIn(secondsUntilResend(res.verification));
    } catch (err) {
      setOtpError(verificationErrorCopy(err.code, isAr, { retryAfterSeconds: err.retryAfterSeconds }) || err.message);
      if (err.retryAfterSeconds) setResendIn(err.retryAfterSeconds);
    } finally {
      setLoading(false);
    }
  };

  // Signing up with Google skips the whole verification dance: Google already
  // vouched for the email, so the account exists the moment the phone number
  // is given, and the profile prompt takes over to confirm that number.
  const handleGoogleAuthenticated = (res, { created } = {}) => {
    setError('');
    setSuccessMessage('');

    if (res.role === 'vendor' && res.vendor) {
      login({ ...res.vendor, role: 'vendor' });
      if (created) sessionStorage.setItem('readycar_show_vendor_education', '1');
      router.push('/dashboard');
    } else {
      login({ ...res.user, role: 'user' });
      router.push(safeRedirect(created ? '/profile?tab=info&verify=1' : '/'));
    }
    router.refresh();
  };

  const restartWithEmail = () => {
    // Abandons the pending WhatsApp registration; re-submitting replaces it.
    setOtpStage(null);
    setOtpCode('');
    setOtpError('');
    setVerificationChannel('email');
  };

  // A phone: a plain white page, as the sign-in. From `sm` up — and for the code step and
  // Google's second step, whose parts are drawn for the dark card — the dark page as before.
  const light = !googleStep && !otpStage;

  return (
    <div className={`min-h-screen flex justify-center relative overflow-hidden ${light ? 'bg-white sm:bg-zinc-50 sm:items-center sm:py-12 sm:px-4' : 'bg-[#111315] items-center py-12 px-4'}`} dir={isAr ? 'rtl' : 'ltr'}>
      {/* Background aesthetics */}
      <div className={`absolute inset-0 z-0 ${light ? 'hidden' : ''}`}>
        <img src="https://images.pexels.com/photos/3807517/pexels-photo-3807517.jpeg?auto=compress&cs=tinysrgb&w=1920" alt="Background" className="w-full h-full object-cover opacity-10" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#111315] via-[#111315]/90 to-[#111315]/60" />
        <div className="absolute top-0 right-0 w-96 h-96 bg-marine-cyan rounded-full blur-[128px] opacity-20 translate-x-1/2 -translate-y-1/4" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-marine-cyan rounded-full blur-[128px] opacity-10 -translate-x-1/2 translate-y-1/4" />
      </div>

      <div className={`relative z-10 w-full ${role === 'vendor' ? 'max-w-2xl' : 'max-w-md'} transition-all duration-500 ${light
        ? 'px-5 pb-8 sm:bg-white sm:border sm:border-zinc-100 sm:rounded-3xl sm:shadow-[0_20px_60px_rgba(0,0,0,0.08)] sm:p-8 sm:my-10'
        : 'bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.6)] p-8 my-10'}`}>
        {otpStage ? (
          <div className="animate-in fade-in duration-300">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-marine-cyan/15 text-marine-primary rounded-full flex items-center justify-center mx-auto mb-5">
                <MessageCircle size={30} />
              </div>
              <h1 className="text-2xl font-black text-white tracking-tight">{vc.enterCode}</h1>
              <p className="text-zinc-400 mt-2 text-sm">
                {vc.codeSentTo} <span dir="ltr" className="font-bold text-white">{otpStage.masked_destination}</span>
              </p>
            </div>

            {otpError && (
              <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl text-center">
                {otpError}
              </div>
            )}

            <OtpInput
              value={otpCode}
              onChange={setOtpCode}
              onComplete={handleVerifyOtp}
              disabled={loading}
            />

            {/* WhatsApp codes arrive noticeably slower than email, so say so
                rather than letting the registrant conclude it failed. */}
            {otpStage.channel === 'whatsapp' && (
              <p className="text-zinc-500 text-xs text-center mt-4 leading-relaxed">
                {vc.whatsappDelayNote}
              </p>
            )}

            <button
              type="button"
              onClick={() => handleVerifyOtp()}
              disabled={loading || otpCode.length !== 6}
              className="w-full bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3.5 rounded-xl transition-all mt-6 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={18} className="animate-spin" />}
              {vc.verify}
            </button>

            <div className="mt-5 text-center space-y-2">
              <button
                type="button"
                onClick={handleResendOtp}
                disabled={resendIn > 0 || loading}
                className="text-sm font-bold text-marine-primary hover:text-red-400 disabled:text-zinc-500 disabled:cursor-not-allowed transition-colors"
              >
                {resendIn > 0 ? vc.resendIn(resendIn) : vc.resendCode}
              </button>
              {otpStage.channel === 'whatsapp' && (
                <div>
                  <button
                    type="button"
                    onClick={restartWithEmail}
                    className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    <ArrowLeft size={12} className="rtl:rotate-180" /> {vc.changeMethod}
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
        <>
        {!googleStep && (
        <>
        <div className="-mx-5 mb-6 sm:hidden">
          <MobileListingTop isAr={isAr} title={isAr ? 'إنشاء حساب' : 'Create account'} />
        </div>

        <div className="text-center mb-6 sm:mb-8">
          <h1 className="text-xl sm:text-2xl font-bold text-zinc-900">{isAr ? 'انضم لـ Ready Marine' : 'Join Ready Marine'}</h1>
          <p className="text-zinc-500 mt-1.5 text-xs sm:text-sm">{isAr ? 'اعمل حسابك عشان تطلب وتتابع طلباتك.' : 'Create your account to order and follow your orders.'}</p>
        </div>

        {/* Tab Toggle */}
        <div className="flex p-1 bg-zinc-100 rounded-xl mb-6 border border-zinc-100 max-w-md mx-auto">
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

        {successMessage && (
          <div className="mb-6 p-4 bg-green-500/10 border border-green-500/20 text-green-700 text-sm rounded-xl text-center">
            {successMessage}
          </div>
        )}

        {role === 'vendor' && (
          <button
            type="button"
            onClick={() => setEducationOpen(true)}
            className="mb-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-5 py-4 text-sm font-black text-zinc-900 shadow-sm hover:text-white transition-all hover:-translate-y-0.5 hover:border-marine-cyan hover:bg-marine-cyan"
          >
            {vendorEducationLabel(isAr)}
          </button>
        )}

        <form className="space-y-4" onSubmit={handleSubmit}>
          {role === 'customer' ? (
            // Customer Form
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-zinc-900 mb-1.5">{t.fullName}</label>
                <div className="relative">
                  <input required type="text" value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} className="w-full bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-xl px-4 py-3.5 peer focus:outline-none focus:border-marine-cyan focus:bg-white transition-all text-base sm:text-sm ltr:pl-11 rtl:pr-11" placeholder={isAr ? 'اكتب اسمك هنا' : 'John Doe'} />
                  <UserIcon size={18} className="absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 text-zinc-500 peer-focus:text-marine-primary transition-colors" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-zinc-900 mb-1.5">{t.emailAddress}</label>
                <div className="relative">
                  <input required type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} className="w-full bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-xl px-4 py-3.5 peer focus:outline-none focus:border-marine-cyan focus:bg-white transition-all text-base sm:text-sm ltr:pl-11 rtl:pr-11" placeholder="john@example.com" />
                  <Mail size={18} className="absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 text-zinc-500 peer-focus:text-marine-primary transition-colors" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-zinc-900 mb-1.5">{t.phoneNumber}</label>
                <div className="relative">
                  <input required type="tel" value={userForm.phone} onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })} className="w-full bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-xl px-4 py-3.5 peer focus:outline-none focus:border-marine-cyan focus:bg-white transition-all text-base sm:text-sm ltr:pl-11 rtl:pr-11" placeholder="01xxxxxxxxx" />
                  <Phone size={18} className="absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 text-zinc-500 peer-focus:text-marine-primary transition-colors" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-zinc-900 mb-1.5">{t.password}</label>
                <div className="relative">
                  <input required type={showUserPassword ? 'text' : 'password'} value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} className="w-full bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-xl px-4 py-3.5 peer focus:outline-none focus:border-marine-cyan focus:bg-white transition-all text-base sm:text-sm ltr:pl-11 ltr:pr-11 rtl:pr-11 rtl:pl-11" placeholder="••••••••" />
                  <Lock size={18} className="absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 text-zinc-500 peer-focus:text-marine-primary transition-colors" />
                  <button
                    type="button"
                    onClick={() => setShowUserPassword((visible) => !visible)}
                    className="absolute ltr:right-4 rtl:left-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-900 focus:outline-none focus:text-marine-primary transition-colors"
                    aria-label={showUserPassword ? (isAr ? 'إخفاء كلمة المرور' : 'Hide password') : (isAr ? 'إظهار كلمة المرور' : 'Show password')}
                  >
                    {showUserPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            // Vendor Form
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm font-bold text-zinc-900 mb-1.5">{t.ownerFullName}</label>
                <div className="relative">
                  <input required type="text" value={vendorForm.name} onChange={(e) => setVendorForm({ ...vendorForm, name: e.target.value })} className="w-full bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-xl px-4 py-3.5 peer focus:outline-none focus:border-marine-cyan focus:bg-white transition-all text-base sm:text-sm ltr:pl-11 rtl:pr-11" placeholder={isAr ? 'اكتب اسمك هنا' : 'John Doe'} />
                  <UserIcon size={18} className="absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 text-zinc-500 peer-focus:text-marine-primary transition-colors" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-zinc-900 mb-1.5">{t.storeName}</label>
                <div className="relative">
                  <input required type="text" value={vendorForm.store_name} onChange={(e) => setVendorForm({ ...vendorForm, store_name: e.target.value })} className="w-full bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-xl px-4 py-3.5 peer focus:outline-none focus:border-marine-cyan focus:bg-white transition-all text-base sm:text-sm ltr:pl-11 rtl:pr-11" placeholder={isAr ? 'قطع غيار السريع' : 'Fast Parts Store'} />
                  <Store size={18} className="absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 text-zinc-500 peer-focus:text-marine-primary transition-colors" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-zinc-900 mb-1.5">{t.storeUsername}</label>
                <div className="relative">
                  <input required type="text" value={vendorForm.store_username} onChange={(e) => setVendorForm({ ...vendorForm, store_username: e.target.value })} className="w-full bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-xl px-4 py-3.5 peer focus:outline-none focus:border-marine-cyan focus:bg-white transition-all text-base sm:text-sm ltr:pl-11 rtl:pr-11" placeholder="fastparts" />
                  <Hash size={18} className="absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 text-zinc-500 peer-focus:text-marine-primary transition-colors" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-zinc-900 mb-1.5">{t.emailAddress}</label>
                <div className="relative">
                  <input required type="email" value={vendorForm.email} onChange={(e) => setVendorForm({ ...vendorForm, email: e.target.value })} className="w-full bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-xl px-4 py-3.5 peer focus:outline-none focus:border-marine-cyan focus:bg-white transition-all text-base sm:text-sm ltr:pl-11 rtl:pr-11" placeholder="vendor@example.com" />
                  <Mail size={18} className="absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 text-zinc-500 peer-focus:text-marine-primary transition-colors" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-zinc-900 mb-1.5">{t.phoneNumber}</label>
                <div className="relative">
                  <input required type="tel" value={vendorForm.phone} onChange={(e) => setVendorForm({ ...vendorForm, phone: e.target.value })} className="w-full bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-xl px-4 py-3.5 peer focus:outline-none focus:border-marine-cyan focus:bg-white transition-all text-base sm:text-sm ltr:pl-11 rtl:pr-11" placeholder="01xxxxxxxxx" />
                  <Phone size={18} className="absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 text-zinc-500 peer-focus:text-marine-primary transition-colors" />
                </div>
              </div>
              <div className="sm:col-span-2">
                <ShippingZoneSelect
                  required
                  country={vendorForm.shipping_country || ''}
                  city={vendorForm.shipping_city || ''}
                  onChange={({ country, city }) => setVendorForm(f => ({ ...f, shipping_country: country, shipping_city: city }))}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-bold text-zinc-900 mb-1.5">{t.storeAddress}</label>
                <div className="relative">
                  <input required type="text" value={vendorForm.address} onChange={(e) => setVendorForm({ ...vendorForm, address: e.target.value })} className="w-full bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-xl px-4 py-3.5 peer focus:outline-none focus:border-marine-cyan focus:bg-white transition-all text-base sm:text-sm ltr:pl-11 rtl:pr-11" placeholder={isAr ? 'شارع عباس العقاد، مدينة نصر' : 'Abbas El Akkad St, Nasr City'} />
                  <MapPin size={18} className="absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 text-zinc-500 peer-focus:text-marine-primary transition-colors" />
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-bold text-zinc-900 mb-1.5">{t.password}</label>
                <div className="relative">
                  <input required type={showVendorPassword ? 'text' : 'password'} value={vendorForm.password} onChange={(e) => setVendorForm({ ...vendorForm, password: e.target.value })} className="w-full bg-zinc-50 border border-zinc-200 text-zinc-900 rounded-xl px-4 py-3.5 peer focus:outline-none focus:border-marine-cyan focus:bg-white transition-all text-base sm:text-sm ltr:pl-11 ltr:pr-11 rtl:pr-11 rtl:pl-11" placeholder="••••••••" />
                  <Lock size={18} className="absolute ltr:left-4 rtl:right-4 top-1/2 -translate-y-1/2 text-zinc-500 peer-focus:text-marine-primary transition-colors" />
                  <button
                    type="button"
                    onClick={() => setShowVendorPassword((visible) => !visible)}
                    className="absolute ltr:right-4 rtl:left-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-900 focus:outline-none focus:text-marine-primary transition-colors"
                    aria-label={showVendorPassword ? (isAr ? 'إخفاء كلمة المرور' : 'Hide password') : (isAr ? 'إظهار كلمة المرور' : 'Show password')}
                  >
                    {showVendorPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {(
            <div className="pt-2">
              <label className="block text-sm font-bold text-zinc-900 mb-2">
                {role === 'vendor' ? vc.howToVerifyStore : vc.howToVerify}
              </label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  {
                    value: 'email',
                    title: vc.channelEmail,
                    // Same channel, different proof: a customer gets a link, a
                    // store owner gets a code.
                    desc: role === 'vendor' ? vc.channelEmailCodeDesc : vc.channelEmailDesc,
                    Icon: Mail,
                  },
                  { value: 'whatsapp', title: vc.channelWhatsapp, desc: vc.channelWhatsappDesc, Icon: MessageCircle },
                ].map(({ value, title, desc, Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setVerificationChannel(value)}
                    className={`p-3.5 rounded-xl border-2 text-start transition-all ${
                      verificationChannel === value
                        ? 'border-marine-cyan bg-marine-cyan/10'
                        : 'border-zinc-200 bg-zinc-50 hover:border-zinc-300'
                    }`}
                  >
                    <Icon size={18} className={verificationChannel === value ? 'text-marine-primary' : 'text-zinc-500'} />
                    <p className="text-zinc-900 font-bold text-sm mt-2">{title}</p>
                    <p className="text-zinc-500 text-[11px] leading-snug mt-0.5">{desc}</p>
                  </button>
                ))}
              </div>
              <p className="text-zinc-500 text-[11px] mt-2 flex items-start gap-1.5">
                <ShieldCheck size={12} className="mt-0.5 flex-shrink-0 text-emerald-600" />
                {role === 'vendor'
                  ? vc.storeChannelNote
                  : (verificationChannel === 'whatsapp' ? vc.whatsappNote : vc.channelEmailDesc)}
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className={`w-full bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 sm:py-3.5 rounded-xl transition-all shadow-[0_4px_14px_0_rgba(0,166,206,0.39)] hover:shadow-[0_6px_20px_rgba(0,166,206,0.23)] hover:-translate-y-0.5 ${role === 'vendor' ? 'mt-6' : 'mt-4'} flex items-center justify-center gap-2`}
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            {t.signUp}
          </button>
        </form>
        </>
        )}

        {/* Customers and vendors both sign up here; the second step asks for
            whatever that role needs and Google does not supply. */}
        <div className={role === 'vendor' && googleStep ? '' : 'max-w-md mx-auto'}>
          <GoogleAuthButton
            role={role}
            text="signup_with"
            language={language}
            onAuthenticated={handleGoogleAuthenticated}
            onError={setError}
            onPendingChange={setGoogleStep}
          />
        </div>

        {!googleStep && (
          <>
            {/* A phone: the way back to signing in as a second, outlined button. */}
            <Link
              href={`/login?role=${role}${loginRedirect ? `&redirect=${encodeURIComponent(loginRedirect)}` : ''}`}
              className="mt-4 flex w-full items-center justify-center rounded-xl border-2 border-zinc-900 py-3.5 text-sm font-bold text-zinc-900 active:bg-zinc-50"
            >
              {isAr ? 'عندك حساب؟ سجّل دخول' : 'Have an account? Sign in'}
            </Link>
          </>
        )}
        </>
        )}
      </div>

      <VendorEducationModal
        open={educationOpen}
        onClose={() => setEducationOpen(false)}
        language={language}
      />
    </div>
  );
}
