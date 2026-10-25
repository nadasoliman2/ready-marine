'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from '../../../components/LocaleLink';
import { Loader2, CheckCircle2, AlertCircle, Star, ImagePlus, X, Store } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { reviewsApi } from '../../../lib/api';
import { reviewCopy, reviewErrorCopy } from '../../../lib/reviewLocalization';
import { resolveAssetUrl } from '../../../lib/assets';
import StarRating from '../../../components/reviews/StarRating';

/**
 * The page a customer lands on from the WhatsApp review link.
 *
 * Deliberately requires no login: the single-use token in the URL is the credential, and
 * asking someone to sign in three days after delivery is where most review flows lose their
 * responses.
 *
 * The form is grouped by SELLER — that seller's products, then one block to rate the seller
 * themselves. A store review is worth having and nobody makes a second journey to leave
 * one, so it has to be the next thing under your thumb rather than another link.
 *
 * Every answer is optional. A customer who rates one product and skips everything else is a
 * normal outcome, not an incomplete form.
 */
export default function ReviewPage() {
    const params = useParams();
    const { language, isMounted } = useApp();
    const isAr = language === 'ar';
    const copy = useMemo(() => reviewCopy(isAr), [isAr]);
    const token = String(params?.token || '');

    const [context, setContext] = useState(null);
    // Keyed by `product:<id>` / `vendor:<id>`, so products and stores share one set of
    // state without their ids ever colliding.
    const [answers, setAnswers] = useState({});
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [done, setDone] = useState(false);

    const maxImages = context?.max_images || 3;

    useEffect(() => {
        if (!isMounted || !token) return;
        reviewsApi.getInvite(token)
            .then((data) => {
                setContext(data);
                // Pre-fill anything already submitted, so a returning customer sees their
                // own answers rather than a blank form.
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
            .catch((err) => setError({ code: err.code, message: err.message }))
            .finally(() => setLoading(false));
    }, [isMounted, token]);

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
            await reviewsApi.submit(token, entries);
            setDone(true);
        } catch (err) {
            setError({ code: err.code, message: err.message });
        } finally {
            setSubmitting(false);
        }
    };

    if (!isMounted || loading) {
        return (
            <Shell isAr={isAr}>
                <div className="flex items-center justify-center py-16">
                    <Loader2 size={34} className="animate-spin text-marine-primary" />
                </div>
            </Shell>
        );
    }

    if (done) {
        return (
            <Shell isAr={isAr}>
                <div className="text-center py-8">
                    <div className="w-16 h-16 bg-emerald-500/15 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-5">
                        <CheckCircle2 size={32} />
                    </div>
                    <h1 className="text-2xl font-black text-white mb-2">{copy.thanksTitle}</h1>
                    <p className="text-zinc-400 text-sm leading-relaxed">{copy.thanksBody}</p>
                    <Link href="/" className="inline-block mt-6 bg-marine-cyan hover:bg-marine-cyan-dark text-white font-bold px-6 py-3 rounded-xl transition-all">
                        {copy.backHome}
                    </Link>
                </div>
            </Shell>
        );
    }

    // A dead link is a terminal state, not an error banner over a usable form.
    if (!context) {
        return (
            <Shell isAr={isAr}>
                <div className="text-center py-8">
                    <div className="w-16 h-16 bg-amber-500/15 text-amber-400 rounded-full flex items-center justify-center mx-auto mb-5">
                        <AlertCircle size={32} />
                    </div>
                    <h1 className="text-xl font-black text-white mb-2">
                        {reviewErrorCopy(error?.code, isAr) || error?.message}
                    </h1>
                    <Link href="/" className="inline-block mt-6 bg-white/5 hover:bg-white/10 text-zinc-300 font-bold px-6 py-3 rounded-xl transition-all">
                        {copy.backHome}
                    </Link>
                </div>
            </Shell>
        );
    }

    // Group the products under the seller who shipped them. An order from one seller — the
    // common case — renders as a single group and reads exactly as it did before.
    const vendors = context.vendors || [];
    const groups = vendors.map((vendor) => ({
        vendor,
        items: (context.items || []).filter((i) => String(i.vendor_id) === String(vendor.vendor_id)),
    }));
    // Anything whose seller could not be resolved still has to be rateable.
    const orphans = (context.items || []).filter(
        (i) => !vendors.some((v) => String(v.vendor_id) === String(i.vendor_id))
    );
    const multipleStores = groups.length > 1;

    return (
        <Shell isAr={isAr}>
            <div className="text-center mb-8">
                <div className="w-14 h-14 bg-marine-cyan/15 text-marine-primary rounded-full flex items-center justify-center mx-auto mb-4">
                    <Star size={26} />
                </div>
                <h1 className="text-2xl font-black text-white">{copy.pageTitle}</h1>
                <p className="text-zinc-400 text-sm mt-2 leading-relaxed">{copy.intro}</p>
                <p className="text-zinc-600 text-xs mt-3">
                    {copy.orderRef} <span className="font-mono text-zinc-400">#{context.reference}</span>
                </p>
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
                        {/* Only worth naming the seller above their products when the order
                            came from more than one — otherwise it is a header over the
                            whole page saying what the page already says. */}
                        {multipleStores && (
                            <div className="flex items-center gap-2 text-zinc-500 text-xs font-black uppercase tracking-widest">
                                <Store size={13} className="text-marine-primary" />
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
                            token={token}
                            copy={copy}
                            isAr={isAr}
                            maxImages={maxImages}
                            answer={answerFor(`vendor:${vendor.vendor_id}`)}
                            onChange={(changes) => patch(`vendor:${vendor.vendor_id}`, changes)}
                            onError={setError}
                            title={copy.rateVendorTitle}
                            subtitle={vendor.store_name}
                            hint={copy.rateVendorHint}
                            image={vendor.store_image}
                            fallbackIcon={<Store size={22} className="text-marine-primary" />}
                            accent
                        />
                    </div>
                ))}

                {orphans.map((item) => (
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
            </div>

            <button
                onClick={submit}
                disabled={submitting}
                className="w-full mt-6 bg-marine-cyan hover:bg-marine-cyan-dark disabled:opacity-60 text-white font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2"
            >
                {submitting && <Loader2 size={18} className="animate-spin" />}
                {submitting ? copy.submitting : copy.submit}
            </button>
        </Shell>
    );
}

/**
 * One rateable thing: stars, an optional comment, optional photos. Identical for a product
 * and for a store, because the customer is answering the same question about both.
 */
function ReviewBlock({
    token, copy, isAr, maxImages, answer, onChange, onError,
    title, subtitle, hint, image, fallbackIcon = null, accent = false,
}) {
    const [uploading, setUploading] = useState(false);
    const fileInput = useRef(null);
    const images = answer.images || [];
    const remaining = Math.max(0, maxImages - images.length);

    const pickFiles = async (event) => {
        const files = Array.from(event.target.files || []).slice(0, remaining);
        // Clear immediately so re-picking the same file still fires a change event.
        event.target.value = '';
        if (files.length === 0) return;

        setUploading(true);
        try {
            const uploaded = await reviewsApi.uploadImages(token, files);
            onChange({ images: [...images, ...uploaded.map((i) => i.url)].slice(0, maxImages) });
        } catch (err) {
            onError({ code: err.code, message: err.message });
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className={`rounded-2xl p-5 border ${accent ? 'bg-marine-cyan/5 border-marine-cyan/20' : 'bg-white/5 border-white/10'}`}>
            <div className="flex items-center gap-4 mb-4">
                <div className="w-16 h-16 bg-white/10 rounded-xl overflow-hidden flex-shrink-0 border border-white/10 flex items-center justify-center">
                    {image
                        ? <img src={resolveAssetUrl(image)} alt="" className="w-full h-full object-cover" />
                        : fallbackIcon}
                </div>
                <div className="min-w-0">
                    <p className="text-white font-bold text-sm">{title}</p>
                    {subtitle && <p className="text-zinc-500 text-xs mt-0.5">{subtitle}</p>}
                    {hint && <p className="text-zinc-600 text-xs mt-1 leading-relaxed">{hint}</p>}
                </div>
            </div>

            <StarRating
                value={answer.rating || 0}
                onChange={(v) => onChange({ rating: v })}
                size={30}
                label={title}
                className="mb-4"
            />

            <textarea
                rows={3}
                maxLength={1000}
                value={answer.comment || ''}
                onChange={(e) => onChange({ comment: e.target.value })}
                placeholder={copy.optionalComment}
                className="w-full bg-white/5 border border-white/10 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-marine-cyan resize-none"
            />

            <div className="mt-3">
                <div className="flex flex-wrap items-center gap-2">
                    {images.map((url) => (
                        <div key={url} className="relative w-16 h-16 rounded-xl overflow-hidden border border-white/10">
                            <img src={resolveAssetUrl(url)} alt="" className="w-full h-full object-cover" />
                            <button
                                type="button"
                                onClick={() => onChange({ images: images.filter((u) => u !== url) })}
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
                <p className="text-zinc-600 text-[11px] mt-2">
                    {uploading ? copy.uploading : `${copy.addPhotos} · ${copy.photosHint(maxImages)}`}
                </p>
            </div>
        </div>
    );
}

function Shell({ children, isAr }) {
    return (
        <div className="min-h-screen bg-[#111315] flex items-center justify-center px-4 py-12" dir={isAr ? 'rtl' : 'ltr'}>
            <div className="w-full max-w-lg bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl">
                {children}
            </div>
        </div>
    );
}
