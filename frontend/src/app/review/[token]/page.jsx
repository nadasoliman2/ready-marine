'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from '../../../components/LocaleLink';
import {
    Loader2, CheckCircle2, AlertCircle, Star, ImagePlus, X,
    Store, Gift, PhoneCall, Lock, ShieldAlert, User, ArrowLeft, ArrowRight, LogIn
} from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { reviewsApi } from '../../../lib/api';
import { reviewCopy, reviewErrorCopy } from '../../../lib/reviewLocalization';
import { resolveAssetUrl } from '../../../lib/assets';
import StarRating from '../../../components/reviews/StarRating';

export default function ReviewPage() {
    const params = useParams();
    const router = useRouter();
    const { language, isMounted, user, logout } = useApp();
    const isAr = language === 'ar';
    const copy = useMemo(() => reviewCopy(isAr), [isAr]);
    const token = String(params?.token || '');

    const [context, setContext] = useState(null);
    const [answers, setAnswers] = useState({});
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [done, setDone] = useState(false);
    const [submissionResult, setSubmissionResult] = useState(null);

    const maxImages = context?.max_images || 3;

    useEffect(() => {
        if (!isMounted || !token) return;

        // 1. Must be logged in: customer or admin
        if (!user) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        reviewsApi.getInvite(token)
            .then((data) => {
                setContext(data);
                const seeded = {};
                for (const item of data.items || []) {
                    seeded[`product:${item.product_id}`] = {
                        rating: item.rating || 0,
                        comment: item.comment || '',
                        images: item.images || [],
                    };
                }
                for (const vendor of data.vendors || []) {
                    seeded[`vendor:${vendor.vendor_id}`] = {
                        rating: vendor.rating || 0,
                        comment: vendor.comment || '',
                        images: vendor.images || [],
                    };
                }
                setAnswers(seeded);
            })
            .catch((err) => {
                setError({ code: err.code || 'REVIEW_ERROR', message: err.message });
            })
            .finally(() => setLoading(false));
    }, [isMounted, token, user]);

    const answerFor = (key) => answers[key] || { rating: 0, comment: '', images: [] };
    const patch = (key, changes) => setAnswers((a) => ({ ...a, [key]: { ...answerFor(key), ...changes } }));

    const submit = async () => {
        const entries = [];
        for (const [key, answer] of Object.entries(answers)) {
            if (!answer?.rating) continue;
            const [target, id] = key.split(':');
            entries.push({
                target_type: target,
                ...(target === 'vendor' ? { vendor_id: id } : { product_id: id }),
                rating: answer.rating,
                comment: answer.comment || '',
                images: (answer.images || []).map((url) => ({ url })),
            });
        }

        if (entries.length === 0) {
            setError({ code: 'NO_RATINGS', message: copy.ratingRequired });
            return;
        }

        setSubmitting(true);
        setError(null);
        try {
            const result = await reviewsApi.submit(token, entries);
            setSubmissionResult(result);
            setDone(true);
        } catch (err) {
            setError({ code: err.code || 'REVIEW_ERROR', message: err.message });
        } finally {
            setSubmitting(false);
        }
    };

    // Loading State
    if (!isMounted || (loading && user)) {
        return (
            <Shell isAr={isAr} user={user} onLogout={logout}>
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <Loader2 size={36} className="animate-spin text-marine-cyan" />
                    <p className="text-zinc-400 text-xs font-bold">
                        {isAr ? 'جاري التحقق من صلاحية الطلب...' : 'Verifying order access...'}
                    </p>
                </div>
            </Shell>
        );
    }

    // 1. NOT LOGGED IN GATE
    if (!user) {
        return (
            <Shell isAr={isAr} user={null}>
                <div className="text-center py-6">
                    <div className="w-16 h-16 bg-amber-500/15 text-amber-400 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-amber-500/20 shadow-sm">
                        <Lock size={32} />
                    </div>
                    <h1 className="text-2xl font-black text-white mb-2">
                        {isAr ? 'تسجيل الدخول مطلوب لكتابة التقييم' : 'Sign in Required to Review'}
                    </h1>
                    <p className="text-zinc-400 text-sm leading-relaxed max-w-md mx-auto mb-6">
                        {isAr
                            ? 'لضمان أمان وموثوقية تقييمات المنتجات، يرجى تسجيل الدخول بالحساب الذي تم الطلب من خلاله أو كمسؤول للمتابعة.'
                            : 'To ensure verified and trusted reviews, please sign in with the account used for this order or as an admin.'}
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3 max-w-xs mx-auto">
                        <Link
                            href={`/login?redirect=/review/${token}`}
                            className="w-full inline-flex items-center justify-center gap-2 bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold px-6 py-3 rounded-xl transition-all shadow-md text-sm"
                        >
                            <LogIn size={16} />
                            <span>{isAr ? 'تسجيل الدخول الآن' : 'Sign in Now'}</span>
                        </Link>
                        <Link
                            href="/"
                            className="w-full inline-flex items-center justify-center bg-white/5 hover:bg-white/10 text-zinc-300 font-bold px-6 py-3 rounded-xl transition-all text-sm border border-white/10"
                        >
                            {isAr ? 'العودة للمتجر' : 'Back to Store'}
                        </Link>
                    </div>
                </div>
            </Shell>
        );
    }

    // 2. SUBMITTED SUCCESS SCREEN
    if (done) {
        const isNegative = submissionResult?.has_low_rating;

        return (
            <Shell isAr={isAr} user={user} onLogout={logout}>
                <div className="text-center py-6">
                    {isNegative ? (
                        <>
                            <div className="w-16 h-16 bg-amber-500/15 text-amber-400 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-amber-500/20">
                                <AlertCircle size={32} />
                            </div>
                            <h1 className="text-2xl font-black text-white mb-2">
                                {isAr ? 'نعتذر عن عدم رضاك، ورأيك يهمنا جداً' : 'We apologize for your experience'}
                            </h1>
                            <p className="text-zinc-300 text-sm leading-relaxed max-w-md mx-auto mb-4">
                                {isAr
                                    ? 'تم فتح تذكرة دعم فني عاجلة لمتابعة ملاحظاتك والتدخل فوراً لحل المشكلة أو استبدال القطعة.'
                                    : 'An urgent support ticket has been opened to resolve this issue or arrange a replacement.'}
                            </p>
                            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 max-w-md mx-auto flex items-center gap-3 text-start mb-6">
                                <PhoneCall size={20} className="text-amber-400 shrink-0" />
                                <p className="text-xs text-amber-200">
                                    {isAr
                                        ? 'سيتواصل معك فريق خدمة العملاء على رقم هاتفك المسجل بأسرع وقت.'
                                        : 'Our customer support team will contact you shortly on your registered phone number.'}
                                </p>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="w-16 h-16 bg-emerald-500/15 text-emerald-400 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-emerald-500/20">
                                <CheckCircle2 size={32} />
                            </div>
                            <h1 className="text-2xl font-black text-white mb-2">{copy.thanksTitle}</h1>
                            <p className="text-zinc-400 text-sm leading-relaxed max-w-md mx-auto">{copy.thanksBody}</p>

                            {/* Reward Banner */}
                            <div className="mt-5 mb-6 p-4 rounded-2xl bg-white/5 border border-white/10 max-w-md mx-auto flex items-center gap-3.5 text-start">
                                <div className="w-12 h-12 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                                    <Gift size={24} />
                                </div>
                                <div>
                                    <p className="text-xs font-bold text-amber-400">
                                        {isAr ? '🎁 مكافأة التقييم الموثق' : '🎁 Verified Review Reward'}
                                    </p>
                                    <p className="text-xs text-zinc-300 mt-0.5">
                                        {isAr
                                            ? 'ستتم إضافة 50 نقطة ولاء إلى رصيدك فور اعتماد التقييم، كما يمكنك استخدام كود الخصم THANKS5 عند طلبك القادم!'
                                            : '50 loyalty points will be added once approved. You can also use code THANKS5 on your next order!'}
                                    </p>
                                </div>
                            </div>
                        </>
                    )}

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3 max-w-xs mx-auto">
                        <Link
                            href="/profile?view=orders-history"
                            className="w-full inline-flex items-center justify-center bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold px-6 py-3 rounded-xl transition-all text-sm shadow-md"
                        >
                            {isAr ? 'الذهاب لسجل طلباتي' : 'View My Orders'}
                        </Link>
                        <Link
                            href="/"
                            className="w-full inline-flex items-center justify-center bg-white/5 hover:bg-white/10 text-zinc-300 font-bold px-6 py-3 rounded-xl transition-all text-sm border border-white/10"
                        >
                            {copy.backHome}
                        </Link>
                    </div>
                </div>
            </Shell>
        );
    }

    // 3. FORBIDDEN OWNERSHIP ERROR
    if (error?.code === 'FORBIDDEN_NOT_ORDER_OWNER') {
        return (
            <Shell isAr={isAr} user={user} onLogout={logout}>
                <div className="text-center py-6">
                    <div className="w-16 h-16 bg-red-500/15 text-red-400 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-red-500/20">
                        <ShieldAlert size={32} />
                    </div>
                    <h1 className="text-2xl font-black text-white mb-2">
                        {isAr ? 'هذا الطلب غير مرتبط بحسابك' : 'Order Not Linked to This Account'}
                    </h1>
                    <p className="text-zinc-300 text-sm leading-relaxed max-w-md mx-auto mb-3">
                        {isAr
                            ? 'التقييم متاح فقط للعميل صاحب هذا الطلب أو لإدارة ريدي مارين.'
                            : 'This review is only accessible to the customer who placed the order or an admin.'}
                    </p>
                    <div className="p-3 bg-white/5 border border-white/10 rounded-xl max-w-xs mx-auto mb-6 text-xs text-zinc-400">
                        {isAr ? 'الحساب المسجل حالياً: ' : 'Signed in as: '}
                        <span className="text-white font-bold">{user?.name || user?.phone || user?.username}</span>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3 max-w-xs mx-auto">
                        <Link
                            href={`/login?redirect=/review/${token}`}
                            className="w-full inline-flex items-center justify-center bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold px-6 py-3 rounded-xl transition-all text-sm shadow-md"
                        >
                            {isAr ? 'تسجيل الدخول بحساب آخر' : 'Switch Account'}
                        </Link>
                        <Link
                            href="/profile?view=orders-history"
                            className="w-full inline-flex items-center justify-center bg-white/5 hover:bg-white/10 text-zinc-300 font-bold px-6 py-3 rounded-xl transition-all text-sm border border-white/10"
                        >
                            {isAr ? 'عرض طلباتي' : 'My Orders'}
                        </Link>
                    </div>
                </div>
            </Shell>
        );
    }

    // 4. ALREADY USED / SUBMITTED
    if (error?.code === 'INVITE_ALREADY_USED') {
        return (
            <Shell isAr={isAr} user={user} onLogout={logout}>
                <div className="text-center py-6">
                    <div className="w-16 h-16 bg-emerald-500/15 text-emerald-400 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-emerald-500/20">
                        <CheckCircle2 size={32} />
                    </div>
                    <h1 className="text-2xl font-black text-white mb-2">
                        {isAr ? 'تم تقييم هذا الطلب مسبقاً' : 'Order Already Reviewed'}
                    </h1>
                    <p className="text-zinc-300 text-sm leading-relaxed max-w-md mx-auto mb-6">
                        {isAr
                            ? 'شكراً لمشاركتك رأيك وتقييمك لطلبك! تقييمك مسجل في لوحة الإدارة ومتاح للمراجعة.'
                            : 'Thank you for your feedback! Your review has been recorded and is available to administrators.'}
                    </p>
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3 max-w-xs mx-auto">
                        <Link
                            href="/profile?view=orders-history"
                            className="w-full inline-flex items-center justify-center bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold px-6 py-3 rounded-xl transition-all text-sm shadow-md"
                        >
                            {isAr ? 'عرض طلباتي' : 'My Orders'}
                        </Link>
                        <Link
                            href="/"
                            className="w-full inline-flex items-center justify-center bg-white/5 hover:bg-white/10 text-zinc-300 font-bold px-6 py-3 rounded-xl transition-all text-sm border border-white/10"
                        >
                            {copy.backHome}
                        </Link>
                    </div>
                </div>
            </Shell>
        );
    }

    // 5. OTHER ERRORS (EXPIRED, INVALID)
    if (!context) {
        return (
            <Shell isAr={isAr} user={user} onLogout={logout}>
                <div className="text-center py-6">
                    <div className="w-16 h-16 bg-amber-500/15 text-amber-400 rounded-2xl flex items-center justify-center mx-auto mb-5 border border-amber-500/20">
                        <AlertCircle size={32} />
                    </div>
                    <h1 className="text-xl font-black text-white mb-2">
                        {reviewErrorCopy(error?.code, isAr) || error?.message || (isAr ? 'حدث خطأ في تحميل التقييم' : 'Error loading review')}
                    </h1>
                    <p className="text-zinc-400 text-xs max-w-sm mx-auto mb-6">
                        {isAr
                            ? 'يرجى مراجعة الرابط أو العودة لصفحة طلباتك في حسابك.'
                            : 'Please check the link or return to your orders list.'}
                    </p>
                    <Link
                        href="/profile?view=orders-history"
                        className="inline-block bg-white/5 hover:bg-white/10 text-zinc-300 font-bold px-6 py-3 rounded-xl transition-all text-sm border border-white/10"
                    >
                        {isAr ? 'الذهاب لطلباتي' : 'Go to My Orders'}
                    </Link>
                </div>
            </Shell>
        );
    }

    // 6. ACTIVE REVIEW FORM
    const vendors = context.vendors || [];
    const groups = vendors.map((vendor) => ({
        vendor,
        items: (context.items || []).filter((i) => String(i.vendor_id) === String(vendor.vendor_id)),
    }));
    const multipleStores = groups.length > 1;

    return (
        <Shell isAr={isAr} user={user} onLogout={logout}>
            <div className="text-center mb-8">
                <div className="w-14 h-14 bg-marine-cyan/15 text-marine-primary rounded-2xl flex items-center justify-center mx-auto mb-4 border border-marine-cyan/20">
                    <Star size={26} />
                </div>
                <h1 className="text-2xl font-black text-white">{copy.pageTitle}</h1>
                <p className="text-zinc-400 text-sm mt-2 leading-relaxed">{copy.intro}</p>
                <div className="flex items-center justify-center gap-3 mt-3 flex-wrap">
                    <span className="text-xs bg-white/5 border border-white/10 px-3 py-1 rounded-full text-zinc-300">
                        {copy.orderRef}: <strong className="font-mono text-marine-cyan">#{context.reference}</strong>
                    </span>
                    {context.customer_name && (
                        <span className="text-xs bg-white/5 border border-white/10 px-3 py-1 rounded-full text-zinc-300">
                            {isAr ? 'العميل: ' : 'Customer: '}<strong>{context.customer_name}</strong>
                        </span>
                    )}
                </div>
            </div>

            {error && (
                <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm font-bold flex items-start gap-3">
                    <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
                    <span>{reviewErrorCopy(error.code, isAr) || error.message}</span>
                </div>
            )}

            <div className="space-y-8">
                {groups.map(({ vendor, items }) => (
                    <div key={String(vendor.vendor_id)} className="space-y-4">
                        {multipleStores && (
                            <div className="flex items-center gap-2 text-zinc-400 text-xs font-black uppercase tracking-widest pt-2 border-t border-white/5">
                                <Store size={14} className="text-marine-cyan" />
                                <span>{copy.soldByVendor} {vendor.store_name}</span>
                            </div>
                        )}

                        {items.map((item) => (
                            <ReviewBlock
                                key={item.product_id}
                                token={token}
                                copy={copy}
                                isAr={isAr}
                                maxImages={maxImages}
                                answer={answerFor(`product:${item.product_id}`)}
                                onChange={(changes) => patch(`product:${item.product_id}`, changes)}
                                onError={setError}
                                title={item.title}
                                subtitle={item.variant_label}
                                image={item.image}
                            />
                        ))}

                        <ReviewBlock
                            key={`vendor-${vendor.vendor_id}`}
                            token={token}
                            copy={copy}
                            isAr={isAr}
                            maxImages={maxImages}
                            answer={answerFor(`vendor:${vendor.vendor_id}`)}
                            onChange={(changes) => patch(`vendor:${vendor.vendor_id}`, changes)}
                            onError={setError}
                            title={`${copy.rateVendorTitle}: ${vendor.store_name}`}
                            subtitle={copy.rateVendorHint}
                            isVendor
                        />
                    </div>
                ))}
            </div>

            <div className="mt-8 pt-6 border-t border-white/10 flex flex-col items-center gap-3">
                <button
                    type="button"
                    onClick={submit}
                    disabled={submitting}
                    className="w-full sm:w-auto min-w-[220px] bg-marine-cyan hover:bg-marine-cyan-dark text-white font-black text-sm px-8 py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
                >
                    {submitting ? (
                        <>
                            <Loader2 size={16} className="animate-spin" />
                            <span>{copy.submitting}</span>
                        </>
                    ) : (
                        <span>{copy.submit}</span>
                    )}
                </button>
                <p className="text-[11px] text-zinc-500 text-center max-w-sm">
                    {isAr
                        ? 'يتم فحص ومراجعة جميع التقييمات قبل نشرها. التقييمات الإيجابية تكافئك بنقاط ولاء.'
                        : 'All reviews are checked before publishing. Verified positive reviews earn loyalty points.'}
                </p>
            </div>
        </Shell>
    );
}

function ReviewBlock({
    token,
    title,
    subtitle,
    image,
    isVendor = false,
    answer,
    onChange,
    onError,
    copy,
    isAr,
    maxImages,
}) {
    const fileInput = useRef(null);
    const [uploading, setUploading] = useState(false);

    const pickFiles = async (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        setUploading(true);
        try {
            const res = await reviewsApi.uploadImages(token, files);
            const urls = (res.images || []).map((i) => i.url);
            const current = answer.images || [];
            onChange({ images: [...current, ...urls].slice(0, maxImages) });
        } catch (err) {
            onError({ code: err.code || 'UPLOAD_FAILED', message: err.message });
        } finally {
            setUploading(false);
            if (fileInput.current) fileInput.current.value = '';
        }
    };

    const removeImage = (index) => {
        const current = [...(answer.images || [])];
        current.splice(index, 1);
        onChange({ images: current });
    };

    const remaining = maxImages - (answer.images || []).length;

    return (
        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4 sm:p-5 transition-all">
            <div className="flex items-start gap-3 sm:gap-4 mb-4">
                {isVendor ? (
                    <div className="w-12 h-12 rounded-xl bg-marine-cyan/15 text-marine-primary flex items-center justify-center shrink-0 border border-marine-cyan/20">
                        <Store size={22} />
                    </div>
                ) : image ? (
                    <img
                        src={resolveAssetUrl(image)}
                        alt={title}
                        className="w-12 h-12 rounded-xl object-cover border border-white/10 shrink-0"
                    />
                ) : null}

                <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-white truncate">{title}</h3>
                    {subtitle && <p className="text-xs text-zinc-400 mt-0.5 truncate">{subtitle}</p>}
                </div>
            </div>

            <div className="mb-4">
                <StarRating
                    value={answer.rating}
                    onChange={(r) => onChange({ rating: r })}
                    size={28}
                    interactive
                />
            </div>

            <div className="space-y-3">
                <textarea
                    value={answer.comment}
                    onChange={(e) => onChange({ comment: e.target.value })}
                    placeholder={copy.optionalComment}
                    rows={2}
                    maxLength={1000}
                    className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-marine-cyan transition-colors resize-none"
                />

                <div className="flex flex-wrap items-center gap-2">
                    {(answer.images || []).map((url, i) => (
                        <div key={i} className="relative w-16 h-16 rounded-xl overflow-hidden border border-white/10 group">
                            <img src={resolveAssetUrl(url)} alt="" className="w-full h-full object-cover" />
                            <button
                                type="button"
                                onClick={() => removeImage(i)}
                                aria-label={copy.removePhoto}
                                className="absolute top-0.5 end-0.5 bg-black/70 hover:bg-black text-white rounded-full p-0.5"
                            >
                                <X size={12} />
                            </button>
                        </div>
                    ))}

                    {remaining > 0 && (
                        <button
                            type="button"
                            onClick={() => fileInput.current?.click()}
                            disabled={uploading}
                            className="w-16 h-16 rounded-xl border border-dashed border-white/20 hover:border-marine-cyan text-zinc-500 hover:text-marine-primary transition-colors flex items-center justify-center disabled:opacity-50"
                        >
                            {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
                        </button>
                    )}

                    <input
                        ref={fileInput}
                        type="file"
                        accept="image/jpeg,image/jpg,image/png,image/webp"
                        multiple={remaining > 1}
                        onChange={pickFiles}
                        className="hidden"
                    />
                </div>
                <p className="text-zinc-500 text-[11px]">
                    {uploading ? copy.uploading : `${copy.addPhotos} · ${copy.photosHint(maxImages)}`}
                </p>
            </div>
        </div>
    );
}

function Shell({ children, isAr, user = null, onLogout }) {
    const BackArrow = isAr ? ArrowRight : ArrowLeft;
    const roleLabel = user?.role === 'admin' ? (isAr ? 'مسؤول' : 'Admin') : (isAr ? 'عميل' : 'Customer');

    return (
        <div className="min-h-screen bg-[#0C0E10] text-zinc-100 flex flex-col" dir={isAr ? 'rtl' : 'ltr'}>
            {/* Dedicated Clean Branded Top Header */}
            <header className="border-b border-white/10 bg-[#14171A]/80 backdrop-blur-md sticky top-0 z-50">
                <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
                    <Link href="/" className="flex items-center gap-2 group">
                        <img
                            src="/uploads/branding/logo_light-1793267522813.png?v=5"
                            alt="Ready Marine"
                            className="h-7 w-auto object-contain brightness-105"
                        />
                    </Link>

                    <div className="flex items-center gap-3">
                        {user ? (
                            <div className="flex items-center gap-2">
                                <div className="hidden sm:flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-xs">
                                    <User size={13} className="text-marine-cyan" />
                                    <span className="font-bold text-white truncate max-w-[120px]">{user.name || user.username}</span>
                                    <span className="text-[10px] bg-marine-cyan/20 text-marine-cyan font-black px-1.5 py-0.5 rounded">
                                        {roleLabel}
                                    </span>
                                </div>
                                <Link
                                    href="/profile?view=orders-history"
                                    className="text-xs font-bold text-zinc-400 hover:text-white transition-colors px-2 py-1"
                                >
                                    {isAr ? 'طلباتي' : 'My Orders'}
                                </Link>
                            </div>
                        ) : (
                            <Link
                                href="/login"
                                className="text-xs font-bold bg-white/10 hover:bg-white/15 text-white px-3.5 py-1.5 rounded-xl transition-all"
                            >
                                {isAr ? 'تسجيل الدخول' : 'Sign in'}
                            </Link>
                        )}

                        <Link
                            href="/"
                            className="text-xs font-bold text-zinc-400 hover:text-white flex items-center gap-1 transition-colors border-s border-white/10 ps-3"
                        >
                            <BackArrow size={13} />
                            <span>{isAr ? 'الرئيسية' : 'Home'}</span>
                        </Link>
                    </div>
                </div>
            </header>

            {/* Main Content Area */}
            <main className="flex-1 flex items-center justify-center px-4 py-8 sm:py-12">
                <div className="w-full max-w-xl bg-[#14171A] border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl">
                    {children}
                </div>
            </main>

            {/* Footer */}
            <footer className="py-4 text-center text-xs text-zinc-600 border-t border-white/5">
                Ready Marine © {new Date().getFullYear()} — {isAr ? 'جميع الحقوق محفوظة' : 'All rights reserved'}
            </footer>
        </div>
    );
}
