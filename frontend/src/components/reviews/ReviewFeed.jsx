'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, BadgeCheck, Star, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { reviewsApi } from '../../lib/api';
import { reviewCopy } from '../../lib/reviewLocalization';
import { resolveAssetUrl } from '../../lib/assets';
import StarRating from './StarRating';
import Overlay from '../Overlay';

/**
 * A page of approved reviews with its star breakdown — the same feed whether the subject is
 * a product or a store, because the two answer the same question in the same shape and a
 * reader should not have to learn two layouts.
 *
 * Everything it renders comes straight from the API, which returns only APPROVED reviews
 * and trims the author to a first name. The moderation gate and the privacy trim both live
 * server-side, so there is nothing here that could accidentally surface a pending review or
 * an unchecked photo.
 */
export default function ReviewFeed({ subject, subjectId, title, emptyText, initialData = null }) {
    const { language } = useApp();
    const isAr = language === 'ar';
    const copy = useMemo(() => reviewCopy(isAr), [isAr]);

    const [data, setData] = useState(initialData);
    // A feed handed its first page by the parent must not flash a spinner over content it
    // already has.
    const [loading, setLoading] = useState(!initialData);
    const [page, setPage] = useState(1);
    const [lightbox, setLightbox] = useState(null);

    useEffect(() => {
        if (!subjectId) return;
        // Page 1 is already in hand when the parent passed it; only fetch past it.
        if (page === 1 && initialData) { setData(initialData); return; }

        let cancelled = false;
        setLoading(true);
        const fetcher = subject === 'vendor' ? reviewsApi.getForVendor : reviewsApi.getForProduct;
        fetcher(subjectId, { page, limit: 5 })
            .then((res) => {
                if (cancelled) return;
                setData((prev) => (page > 1 && prev
                    ? { ...res, reviews: [...prev.reviews, ...res.reviews] }
                    : res));
            })
            .catch(() => { if (!cancelled) setData(null); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [subject, subjectId, page, initialData]);

    if (loading && !data) {
        return (
            <div className="flex items-center justify-center py-10">
                <Loader2 size={26} className="animate-spin text-marine-primary" />
            </div>
        );
    }

    const summary = data?.summary || { rating: 0, count: 0, breakdown: {} };
    const reviews = data?.reviews || [];

    return (
        <div className="space-y-4 pt-4">
            <h3 className="text-marine-ink font-bold text-2xl">{title || copy.reviewsTitle}</h3>

            {summary.count === 0 ? (
                <div className="bg-marine-canvas p-8 rounded-xl border border-marine-teal/15 text-center">
                    <Star size={34} className="text-marine-line mx-auto mb-3" />
                    <p className="text-marine-outline font-bold text-sm">{emptyText || copy.noReviews}</p>
                </div>
            ) : (
                <div className="bg-marine-canvas rounded-xl border border-marine-teal/15 overflow-hidden">
                    {/* Summary + star breakdown */}
                    <div className="p-8 flex flex-col sm:flex-row gap-8 border-b border-marine-teal/15">
                        <div className="text-center flex-shrink-0">
                            <p className="text-5xl font-bold text-marine-ink">{summary.rating.toFixed(1)}</p>
                            <StarRating value={Math.round(summary.rating)} size={16} className="mt-2" />
                            <p className="text-marine-outline text-xs mt-2">{copy.basedOn(summary.count)}</p>
                        </div>

                        <div className="flex-1 space-y-1.5 min-w-0">
                            {[5, 4, 3, 2, 1].map((star) => {
                                const count = summary.breakdown?.[star] || 0;
                                const pct = summary.count > 0 ? (count / summary.count) * 100 : 0;
                                return (
                                    <div key={star} className="flex items-center gap-3">
                                        <span className="text-marine-muted text-xs font-bold w-3 tabular-nums">{star}</span>
                                        <Star size={12} className="fill-amber-400 text-amber-400 flex-shrink-0" />
                                        <div className="flex-1 h-2 bg-marine-frost rounded-full overflow-hidden">
                                            <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} />
                                        </div>
                                        <span className="text-marine-outline text-xs w-6 text-end tabular-nums">{count}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Individual reviews */}
                    <div className="divide-y divide-zinc-100">
                        {reviews.map((review, index) => (
                            <div key={index} className="p-6">
                                <div className="flex items-center gap-3 flex-wrap mb-2">
                                    <StarRating value={review.rating} size={14} />
                                    <span className="text-marine-ink font-bold text-sm">{review.author}</span>
                                    {review.verified_purchase && (
                                        <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-100 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full">
                                            <BadgeCheck size={11} /> {copy.verifiedPurchase}
                                        </span>
                                    )}
                                    <span className="text-marine-outline text-xs ms-auto">
                                        {new Date(review.created_at).toLocaleDateString(isAr ? 'ar-u-ca-gregory' : 'en-US', {
                                            year: 'numeric', month: 'short', day: 'numeric',
                                        })}
                                    </span>
                                </div>
                                {review.comment && (
                                    <p className="text-marine-muted leading-relaxed text-sm">{review.comment}</p>
                                )}
                                {(review.images || []).length > 0 && (
                                    <div className="flex flex-wrap gap-2 mt-3">
                                        {review.images.map((url, i) => (
                                            <button
                                                key={i}
                                                type="button"
                                                onClick={() => setLightbox(resolveAssetUrl(url))}
                                                className="w-20 h-20 rounded-xl overflow-hidden border border-marine-teal/15 hover:border-marine-cyan transition-colors"
                                            >
                                                <img
                                                    src={resolveAssetUrl(url)}
                                                    alt=""
                                                    loading="lazy"
                                                    className="w-full h-full object-cover"
                                                />
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {data?.pagination && page < data.pagination.pages && (
                        <button
                            onClick={() => setPage((p) => p + 1)}
                            disabled={loading}
                            className="w-full py-4 text-marine-primary font-bold text-sm hover:bg-white transition-colors border-t border-marine-teal/15 disabled:opacity-50"
                        >
                            {loading ? <Loader2 size={16} className="animate-spin inline" /> : copy.showMore}
                        </button>
                    )}
                </div>
            )}

            {lightbox && (
                <Overlay
                    className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => setLightbox(null)}
                    role="dialog"
                    aria-modal="true"
                >
                    <button
                        type="button"
                        onClick={() => setLightbox(null)}
                        className="absolute top-5 end-5 text-white/80 hover:text-white"
                        aria-label="Close"
                    >
                        <X size={28} />
                    </button>
                    <img src={lightbox} alt="" className="max-w-full max-h-full rounded-lg object-contain" />
                </Overlay>
            )}
        </div>
    );
}
