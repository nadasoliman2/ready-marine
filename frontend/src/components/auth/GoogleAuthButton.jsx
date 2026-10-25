'use client';

/**
 * Google Sign-In button (Google Identity Services) plus the step that finishes
 * a Google signup.
 *
 * The whole flow needs nothing but the OAuth **client ID**: Google renders the
 * button, runs the account chooser, and hands back a signed ID token, which
 * the backend verifies against Google's public keys. No client secret, no
 * redirect URI, no popup we have to manage ourselves.
 *
 * A returning customer is signed straight in. A brand-new one cannot be
 * created from the Google profile alone — Google gives us a name, an email and
 * a photo, and nothing else this shop needs — so signup becomes two steps:
 * Google, then a second form (rendered by this component, in place of the page
 * form) for everything Google did not supply. `onPendingChange` tells the host
 * page to stand down while that second step is on screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Eye, EyeOff, Hash, Loader2, Lock, MapPin, Phone, Store, X } from 'lucide-react';
import { authApi } from '../../lib/api';
import ShippingZoneSelect from '../ShippingZoneSelect';

// Shared by every text field in the second step.
const FIELD_CLASS = 'peer w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-sm text-white transition-all focus:border-marine-cyan focus:bg-white/10 focus:outline-none ltr:pl-11 rtl:pr-11';
const FIELD_ICON_CLASS = 'absolute top-1/2 -translate-y-1/2 text-zinc-500 transition-colors peer-focus:text-marine-primary ltr:left-4 rtl:right-4';

const GSI_SRC = 'https://accounts.google.com/gsi/client';
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';

/** Load the GSI script once per page, no matter how many buttons mount. */
let gsiPromise = null;
const loadGsi = () => {
    if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
    if (window.google?.accounts?.id) return Promise.resolve();
    if (gsiPromise) return gsiPromise;

    gsiPromise = new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[src="${GSI_SRC}"]`);
        const script = existing || document.createElement('script');
        script.addEventListener('load', () => resolve());
        script.addEventListener('error', () => {
            gsiPromise = null;
            reject(new Error('Could not load Google sign-in'));
        });
        if (!existing) {
            script.src = GSI_SRC;
            script.async = true;
            script.defer = true;
            document.head.appendChild(script);
        }
    });
    return gsiPromise;
};

const copy = (isAr) => ({
    or: isAr ? 'أو' : 'or',
    unavailable: isAr
        ? 'تسجيل الدخول عبر جوجل غير متاح حالياً.'
        : 'Google sign-in is unavailable right now.',
    signingIn: isAr ? 'جارٍ تسجيل الدخول…' : 'Signing you in…',

    // ---- Step 2 ----
    title: isAr ? 'أكمل بياناتك' : 'Complete your details',
    subtitle: isAr
        ? 'باقي خطوة واحدة بس — البيانات دي جوجل مش بيبعتها لنا.'
        : "Just one step left — Google doesn't share these details with us.",
    stepCounter: isAr ? 'الخطوة 2 من 2' : 'Step 2 of 2',
    stepGoogle: isAr ? 'حساب جوجل' : 'Google account',
    stepDetails: isAr ? 'بياناتك' : 'Your details',
    fromGoogle: isAr ? 'من جوجل' : 'From Google',
    phoneLabel: isAr ? 'رقم الهاتف' : 'Phone number',
    phoneHint: isAr
        ? 'هنستخدمه لتأكيد الطلبات والشحن.'
        : 'Used to confirm your orders and delivery.',

    // ---- Step 2, vendor ----
    vendorTitle: isAr ? 'أكمل بيانات متجرك' : 'Complete your store details',
    vendorSubtitle: isAr
        ? 'باقي خطوة واحدة بس — البيانات دي جوجل مش بيبعتها لنا.'
        : "Just one step left — Google doesn't share these details with us.",
    vendorStepDetails: isAr ? 'بيانات المتجر' : 'Store details',
    storeNameLabel: isAr ? 'اسم المتجر' : 'Store name',
    storeUsernameLabel: isAr ? 'اسم المستخدم للمتجر' : 'Store username',
    addressLabel: isAr ? 'عنوان المتجر' : 'Store address',
    vendorPhoneHint: isAr
        ? 'هنستخدمه للتواصل معاك بخصوص الطلبات والاستلام.'
        : 'Used to reach you about orders and pickups.',
    createStore: isAr ? 'إنشاء المتجر' : 'Create store',
    creatingStore: isAr ? 'جارٍ إنشاء المتجر…' : 'Creating your store…',
    storeNameRequired: isAr ? 'اسم المتجر مطلوب' : 'Store name is required',
    storeUsernameRequired: isAr ? 'اسم المستخدم للمتجر مطلوب' : 'Store username is required',
    addressRequired: isAr ? 'العنوان مطلوب للمتجر' : 'Store address is required',
    zoneRequired: isAr ? 'اختر المنطقة والمدينة' : 'Choose your zone and city',
    passwordLabel: isAr ? 'كلمة المرور' : 'Password',
    optional: isAr ? 'اختياري' : 'optional',
    passwordHint: isAr
        ? 'سيبها فاضية لو هتدخل بجوجل دايماً. تقدر تضيفها بعدين من "نسيت كلمة المرور".'
        : 'Leave empty to sign in with Google only. You can add one later via "forgot password".',
    invalidPhone: isAr
        ? 'رقم الهاتف غير صحيح. يجب أن يبدأ بـ 01xxxxxxxxx أو +201xxxxxxxxx'
        : 'Invalid phone number. Use 01xxxxxxxxx or +201xxxxxxxxx',
    shortPassword: isAr
        ? 'كلمة المرور يجب ألا تقل عن 6 أحرف'
        : 'Password must be at least 6 characters',
    createAccount: isAr ? 'إنشاء الحساب' : 'Create account',
    creating: isAr ? 'جارٍ إنشاء الحساب…' : 'Creating your account…',
    cancel: isAr ? 'إلغاء' : 'Cancel',
    useAnother: isAr ? 'استخدم حساب آخر' : 'Use a different account',
});

export default function GoogleAuthButton({
    role = 'customer',
    text = 'signin_with',
    rememberMe = false,
    language = 'en',
    onAuthenticated,
    onError,
    onPendingChange,
}) {
    const isAr = language === 'ar';
    const c = copy(isAr);

    const buttonRef = useRef(null);
    const [scriptFailed, setScriptFailed] = useState(false);
    const [busy, setBusy] = useState(false);

    // Set when Google verified someone we have no account for yet — this is
    // what swaps the page over to the second step.
    const [pendingSignup, setPendingSignup] = useState(null);
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [signupError, setSignupError] = useState('');
    const [creating, setCreating] = useState(false);
    // Store fields, only used when the handoff is for a vendor.
    const [storeForm, setStoreForm] = useState({
        store_name: '',
        store_username: '',
        address: '',
        shipping_country: '',
        shipping_city: '',
    });

    const isVendorSignup = pendingSignup?.role === 'vendor';

    // Google calls back into whatever was registered at initialize() time, so
    // the live props are read through a ref instead of re-initializing (and
    // re-rendering the button) every time the role or language changes.
    const latest = useRef({ role, rememberMe, onAuthenticated, onError, onPendingChange });
    latest.current = { role, rememberMe, onAuthenticated, onError, onPendingChange };

    // Keep the host page's "is the signup step showing?" flag in step with ours.
    useEffect(() => {
        latest.current.onPendingChange?.(Boolean(pendingSignup));
    }, [pendingSignup]);

    const handleCredential = useCallback(async (response) => {
        const { role: currentRole, rememberMe: remember, onAuthenticated: done, onError: fail } = latest.current;
        if (!response?.credential) return;

        setBusy(true);
        try {
            const res = await authApi.googleSignIn({
                credential: response.credential,
                role: currentRole === 'vendor' ? 'vendor' : 'customer',
                remember_me: remember,
            });

            if (res.status === 'signup_required') {
                setPhone('');
                setPassword('');
                setSignupError('');
                setStoreForm({
                    // Google's display name is a fair first guess at the store
                    // name; it stays editable.
                    store_name: res.role === 'vendor' ? (res.profile?.name || '') : '',
                    store_username: '',
                    address: '',
                    shipping_country: '',
                    shipping_city: '',
                });
                setPendingSignup({ ...res.profile, role: res.role, signup_token: res.signup_token });
                window.scrollTo({ top: 0, behavior: 'smooth' });
                return;
            }

            done?.(res, { created: false });
        } catch (err) {
            fail?.(err.message || 'Google sign-in failed. Please try again.');
        } finally {
            setBusy(false);
        }
    }, []);

    useEffect(() => {
        if (!CLIENT_ID || pendingSignup) return;
        let cancelled = false;

        loadGsi()
            .then(() => {
                if (cancelled || !buttonRef.current) return;
                window.google.accounts.id.initialize({
                    client_id: CLIENT_ID,
                    callback: handleCredential,
                    cancel_on_tap_outside: true,
                });
                // GSI needs an explicit pixel width (400 is its maximum), so
                // the rendered button tracks the card it sits in.
                const width = Math.min(400, Math.max(200, buttonRef.current.clientWidth || 320));
                buttonRef.current.innerHTML = '';
                window.google.accounts.id.renderButton(buttonRef.current, {
                    type: 'standard',
                    // Light, with a thin border, on the white sign-in and sign-up pages.
                    theme: 'outline',
                    size: 'large',
                    shape: 'rectangular',
                    text,
                    // The G at the button's edge, the words centred: centred together, an Arabic
                    // label ran over the G.
                    logo_alignment: 'left',
                    locale: isAr ? 'ar' : 'en',
                    width,
                });
            })
            .catch(() => {
                if (!cancelled) setScriptFailed(true);
            });

        return () => { cancelled = true; };
    }, [handleCredential, text, isAr, pendingSignup]);

    const abandonSignup = () => {
        setPendingSignup(null);
        setSignupError('');
        // Let Google offer the chooser again rather than silently re-picking
        // the account that was just abandoned.
        window.google?.accounts?.id?.disableAutoSelect?.();
    };

    const submitSignup = async (e) => {
        e.preventDefault();
        setSignupError('');

        if (!/^(01\d{9}|\+201\d{9})$/.test(phone.trim())) {
            setSignupError(c.invalidPhone);
            return;
        }

        if (password && password.length < 6) {
            setSignupError(c.shortPassword);
            return;
        }

        // The store fields are checked here as well as on the server so a
        // vendor is told what is missing before a round trip.
        if (isVendorSignup) {
            if (!storeForm.store_name.trim()) return setSignupError(c.storeNameRequired);
            if (!storeForm.store_username.trim()) return setSignupError(c.storeUsernameRequired);
            if (!storeForm.shipping_city) return setSignupError(c.zoneRequired);
            if (!storeForm.address.trim()) return setSignupError(c.addressRequired);
        }

        setCreating(true);
        try {
            const res = await authApi.completeGoogleSignup({
                signup_token: pendingSignup.signup_token,
                phone: phone.trim(),
                password: password || undefined,
                language,
                ...(isVendorSignup ? {
                    store_name: storeForm.store_name.trim(),
                    store_username: storeForm.store_username.trim(),
                    address: storeForm.address.trim(),
                    shipping_country: storeForm.shipping_country || null,
                    shipping_city: storeForm.shipping_city || null,
                } : {}),
            });
            setPendingSignup(null);
            latest.current.onAuthenticated?.(res, { created: true });
        } catch (err) {
            setSignupError(err.message || 'Could not create your account. Please try again.');
            setCreating(false);
        }
    };

    // Without a client ID configured there is nothing to render — the password
    // form is still perfectly usable, so this stays silent.
    if (!CLIENT_ID) return null;

    /* ---------------- Step 2: everything Google did not give us -------------- */
    if (pendingSignup) {
        // Step 1 is behind us; the bar completes as the account is created.
        const progress = creating ? 100 : 50;

        return (
            <div className="animate-in fade-in duration-300">
                <div className="mb-6 flex items-start justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-black tracking-tight text-white">
                            {isVendorSignup ? c.vendorTitle : c.title}
                        </h1>
                        <p className="mt-2 text-sm text-zinc-400">
                            {isVendorSignup ? c.vendorSubtitle : c.subtitle}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={abandonSignup}
                        disabled={creating}
                        className="mt-1 text-zinc-500 transition-colors hover:text-white disabled:opacity-40"
                        aria-label={c.cancel}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Progress */}
                <div className="mb-6">
                    <div className="mb-2 flex items-center justify-between text-xs">
                        <span className="font-bold text-white">{c.stepCounter}</span>
                        <span className="text-zinc-500">{progress}%</span>
                    </div>
                    <div
                        className="h-1.5 w-full overflow-hidden rounded-full bg-white/10"
                        role="progressbar"
                        aria-valuenow={progress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                    >
                        <div
                            className="h-full rounded-full bg-marine-cyan transition-all duration-700 ease-out"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-[11px]">
                        <span className="inline-flex items-center gap-1 font-medium text-emerald-400">
                            <Check size={12} /> {c.stepGoogle}
                        </span>
                        <span className="text-zinc-600">›</span>
                        <span className="font-bold text-white">
                            {isVendorSignup ? c.vendorStepDetails : c.stepDetails}
                        </span>
                    </div>
                </div>

                {/* What Google did supply */}
                <div className="mb-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                    {pendingSignup.picture ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={pendingSignup.picture}
                            alt=""
                            className="h-10 w-10 flex-shrink-0 rounded-full object-cover"
                            referrerPolicy="no-referrer"
                        />
                    ) : null}
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-white">{pendingSignup.name}</p>
                        <p className="truncate text-xs text-zinc-400" dir="ltr">{pendingSignup.email}</p>
                    </div>
                    <span className="flex-shrink-0 rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-400">
                        {c.fromGoogle}
                    </span>
                </div>

                {signupError && (
                    <div className="mb-5 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-center text-sm text-red-400">
                        {signupError}
                    </div>
                )}

                <form className="space-y-4" onSubmit={submitSignup}>
                    {isVendorSignup && (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-zinc-300">{c.storeNameLabel}</label>
                                <div className="relative">
                                    <input
                                        autoFocus
                                        required
                                        type="text"
                                        value={storeForm.store_name}
                                        onChange={(e) => setStoreForm((f) => ({ ...f, store_name: e.target.value }))}
                                        placeholder={isAr ? 'قطع غيار السريع' : 'Fast Parts Store'}
                                        className={FIELD_CLASS}
                                    />
                                    <Store size={18} className={FIELD_ICON_CLASS} />
                                </div>
                            </div>
                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-zinc-300">{c.storeUsernameLabel}</label>
                                <div className="relative">
                                    <input
                                        required
                                        type="text"
                                        dir="ltr"
                                        value={storeForm.store_username}
                                        onChange={(e) => setStoreForm((f) => ({ ...f, store_username: e.target.value }))}
                                        placeholder="fastparts"
                                        className={FIELD_CLASS}
                                    />
                                    <Hash size={18} className={FIELD_ICON_CLASS} />
                                </div>
                            </div>
                        </div>
                    )}

                    <div>
                        <label className="mb-1.5 block text-sm font-medium text-zinc-300">{c.phoneLabel}</label>
                        <div className="relative">
                            <input
                                autoFocus
                                required
                                type="tel"
                                dir="ltr"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                placeholder="01xxxxxxxxx"
                                className="peer w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-sm text-white transition-all focus:border-marine-cyan focus:bg-white/10 focus:outline-none ltr:pl-11 rtl:pr-11"
                            />
                            <Phone
                                size={18}
                                className="absolute top-1/2 -translate-y-1/2 text-zinc-500 transition-colors peer-focus:text-marine-primary ltr:left-4 rtl:right-4"
                            />
                        </div>
                        <p className="mt-1.5 text-[11px] text-zinc-500">
                            {isVendorSignup ? c.vendorPhoneHint : c.phoneHint}
                        </p>
                    </div>

                    {isVendorSignup && (
                        <>
                            <ShippingZoneSelect
                                dark
                                required
                                country={storeForm.shipping_country || ''}
                                city={storeForm.shipping_city || ''}
                                onChange={({ country, city }) =>
                                    setStoreForm((f) => ({ ...f, shipping_country: country, shipping_city: city }))
                                }
                            />
                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-zinc-300">{c.addressLabel}</label>
                                <div className="relative">
                                    <input
                                        required
                                        type="text"
                                        value={storeForm.address}
                                        onChange={(e) => setStoreForm((f) => ({ ...f, address: e.target.value }))}
                                        placeholder={isAr ? 'شارع عباس العقاد، مدينة نصر' : 'Abbas El Akkad St, Nasr City'}
                                        className={FIELD_CLASS}
                                    />
                                    <MapPin size={18} className={FIELD_ICON_CLASS} />
                                </div>
                            </div>
                        </>
                    )}

                    <div>
                        <label className="mb-1.5 block text-sm font-medium text-zinc-300">
                            {c.passwordLabel}{' '}
                            <span className="font-normal text-zinc-500">({c.optional})</span>
                        </label>
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                className="peer w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-sm text-white transition-all focus:border-marine-cyan focus:bg-white/10 focus:outline-none ltr:pl-11 ltr:pr-11 rtl:pl-11 rtl:pr-11"
                            />
                            <Lock
                                size={18}
                                className="absolute top-1/2 -translate-y-1/2 text-zinc-500 transition-colors peer-focus:text-marine-primary ltr:left-4 rtl:right-4"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword((visible) => !visible)}
                                className="absolute top-1/2 -translate-y-1/2 text-zinc-500 transition-colors hover:text-zinc-200 focus:text-marine-primary focus:outline-none ltr:right-4 rtl:left-4"
                                aria-label={showPassword ? (isAr ? 'إخفاء كلمة المرور' : 'Hide password') : (isAr ? 'إظهار كلمة المرور' : 'Show password')}
                            >
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                        <p className="mt-1.5 text-[11px] leading-snug text-zinc-500">{c.passwordHint}</p>
                    </div>

                    <button
                        type="submit"
                        disabled={creating}
                        className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-marine-cyan py-3.5 font-bold text-white shadow-[0_4px_14px_0_rgba(0,166,206,0.39)] transition-all hover:-translate-y-0.5 hover:bg-marine-cyan-dark disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {creating && <Loader2 size={18} className="animate-spin" />}
                        {isVendorSignup
                            ? (creating ? c.creatingStore : c.createStore)
                            : (creating ? c.creating : c.createAccount)}
                    </button>
                </form>

                <button
                    type="button"
                    onClick={abandonSignup}
                    disabled={creating}
                    className="mt-5 w-full text-center text-xs text-zinc-500 transition-colors hover:text-zinc-300 disabled:opacity-40"
                >
                    {c.useAnother}
                </button>
            </div>
        );
    }

    /* ---------------- Step 1: the Google button ---------------- */
    return (
        <>
            <div className="my-6 flex items-center gap-3">
                <span className="h-px flex-1 bg-zinc-200" />
                <span className="text-xs uppercase tracking-wider text-zinc-500">{c.or}</span>
                <span className="h-px flex-1 bg-zinc-200" />
            </div>

            <div className="relative flex min-h-[44px] justify-center">
                <div ref={buttonRef} className="flex w-full justify-center [color-scheme:light]" />
                {busy && (
                    <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-md bg-white/90 text-sm text-zinc-600">
                        <Loader2 size={16} className="animate-spin" /> {c.signingIn}
                    </div>
                )}
            </div>

            {scriptFailed && (
                <p className="mt-3 text-center text-xs text-zinc-500">{c.unavailable}</p>
            )}
        </>
    );
}
