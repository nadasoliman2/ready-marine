'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Check, X, Star, AlertCircle, MessageSquare, Store, Package } from 'lucide-react';
import { useApp } from '../../../../context/AppContext';
import { adminReviewsApi } from '../../../../lib/api';
import { reviewCopy } from '../../../../lib/reviewLocalization';
import StarRating from '../../../../components/reviews/StarRating';
import { resolveAssetUrl } from '../../../../lib/assets';
import Overlay from '../../../../components/Overlay';

/**
 * Admin moderation queue.
 *
 * Every customer review lands here as `pending` and reaches a product page only
 * on explicit approval — the product's rating is recomputed from approved
 * reviews on both approve and reject, so un-publishing takes the stars back.
 */
export default function AdminReviewsPage() {
    const { language } = useApp();
    const isAr = language === 'ar';
    const copy = useMemo(() => reviewCopy(isAr), [isAr]);

    const [status, setStatus] = useState('pending');
    // Product reviews and store reviews are read with different questions in mind, so the
    // queue can be narrowed to one kind without losing the combined view.
    const [target, setTarget] = useState('all');
    const [lightbox, setLightbox] = useState(null);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState('');
    const [message, setMessage] = useState({ type: '', text: '' });
    const [rejecting, setRejecting] = useState(null);
    const [reason, setReason] = useState('');

    const load = useCallback(async (nextStatus = status, nextTarget = target) => {
        setLoading(true);
        try {
            setData(await adminReviewsApi.list({ status: nextStatus, target: nextTarget, limit: 50 }));
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setLoading(false);
        }
    }, [status, target]);

    useEffect(() => { load(status, target); }, [status, target, load]);

    const moderate = async (id, nextStatus, rejectionReason = '') => {
        setBusy(id);
        setMessage({ type: '', text: '' });
        try {
            const res = await adminReviewsApi.moderate(id, { status: nextStatus, reason: rejectionReason });
            setMessage({ type: 'success', text: res.message });
            setRejecting(null);
            setReason('');
            await load(status, target);
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setBusy('');
        }
    };

    const tabs = [
        { value: 'pending', label: copy.pending, count: data?.pending_count },
        { value: 'approved', label: copy.approved },
        { value: 'rejected', label: copy.rejected },
        { value: 'all', label: copy.all },
    ];

    const targetTabs = [
        { value: 'all', label: copy.all },
        { value: 'product', label: copy.targetProduct },
        { value: 'vendor', label: copy.targetVendor },
    ];

    return (
        <div className="p-6 max-w-5xl" dir={isAr ? 'rtl' : 'ltr'}>
            <h1 className="text-2xl font-black text-zinc-900 flex items-center gap-3 mb-6">
                <MessageSquare className="text-marine-primary" /> {copy.adminTitle}
            </h1>

            <div className="flex items-center gap-2 mb-6 flex-wrap">
                {tabs.map((tab) => (
                    <button
                        key={tab.value}
                        onClick={() => setStatus(tab.value)}
                        className={`px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
                            status === tab.value
                                ? 'bg-marine-cyan text-white shadow-lg'
                                : 'bg-white border border-zinc-200 text-zinc-600 hover:border-zinc-300'
                        }`}
                    >
                        {tab.label}
                        {tab.count > 0 && (
                            <span className={`text-[11px] font-black rounded-full px-1.5 ${
                                status === tab.value ? 'bg-white text-marine-primary' : 'bg-marine-cyan text-white'
                            }`}>
                                {tab.count}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            <div className="flex items-center gap-2 mb-6 flex-wrap">
                {targetTabs.map((tab) => (
                    <button
                        key={tab.value}
                        onClick={() => setTarget(tab.value)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            target === tab.value
                                ? 'bg-zinc-900 text-white'
                                : 'bg-white border border-zinc-200 text-zinc-500 hover:border-zinc-300'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {message.text && (
                <div className={`mb-6 p-4 rounded-xl text-sm font-bold flex items-start gap-3 ${
                    message.type === 'success'
                        ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                        : 'bg-red-50 border border-red-200 text-red-700'
                }`}>
                    <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
                    <span>{message.text}</span>
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 size={32} className="animate-spin text-marine-primary" />
                </div>
            ) : (data?.reviews || []).length === 0 ? (
                <div className="bg-white border border-dashed border-zinc-200 rounded-2xl p-12 text-center">
                    <Star size={40} className="text-zinc-300 mx-auto mb-3" />
                    <p className="text-zinc-500 font-bold text-sm">{copy.noPending}</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {data.reviews.map((review) => (
                        <div key={review._id} className="bg-white border border-zinc-200 rounded-2xl p-5 shadow-sm">
                            <div className="flex items-start gap-4">
                                <div className="w-14 h-14 bg-zinc-100 rounded-xl overflow-hidden flex-shrink-0 border border-zinc-200 flex items-center justify-center">
                                    {review.target_type === 'vendor'
                                        ? <Store size={22} className="text-marine-primary" />
                                        : review.product?.image
                                            ? <img src={resolveAssetUrl(review.product.image)} alt={review.product.title} className="w-full h-full object-cover" />
                                            : <Package size={22} className="text-zinc-400" />}
                                </div>

                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-3 flex-wrap mb-1">
                                        <StarRating value={review.rating} size={16} />
                                        <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                                            review.status === 'approved' ? 'bg-emerald-100 text-emerald-700'
                                            : review.status === 'rejected' ? 'bg-red-100 text-red-700'
                                            : 'bg-amber-100 text-amber-700'
                                        }`}>
                                            {copy[review.status] || review.status}
                                        </span>
                                        <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                                            review.target_type === 'vendor' ? 'bg-indigo-100 text-indigo-700' : 'bg-zinc-100 text-zinc-600'
                                        }`}>
                                            {review.target_type === 'vendor' ? copy.targetVendor : copy.targetProduct}
                                        </span>
                                    </div>

                                    {/* What was rated. A store review has no product, so it
                                        names the store instead of showing an em dash. */}
                                    {review.target_type === 'vendor' ? (
                                        <p className="text-zinc-500 text-xs">
                                            {copy.onVendor} <span className="font-bold text-zinc-800">{review.vendor_name || '—'}</span>
                                        </p>
                                    ) : (
                                        <p className="text-zinc-500 text-xs">
                                            {copy.onProduct} <span className="font-bold text-zinc-800">{review.product?.title || '—'}</span>
                                            {review.vendor_name && <span className="text-zinc-400"> · {review.vendor_name}</span>}
                                        </p>
                                    )}
                                    <p className="text-zinc-500 text-xs mt-0.5">
                                        {copy.by} {review.author_name || '—'} · {new Date(review.created_at).toLocaleDateString(isAr ? 'ar-u-ca-gregory' : 'en-US')}
                                    </p>

                                    {review.comment && (
                                        <p className="text-zinc-800 text-sm mt-3 bg-zinc-50 border border-zinc-100 rounded-xl p-3 leading-relaxed">
                                            {review.comment}
                                        </p>
                                    )}

                                    {/* The half of a review most worth checking before it
                                        goes public — shown inline, full size on click. */}
                                    {(review.images || []).length > 0 && (
                                        <div className="mt-3">
                                            <p className="text-zinc-400 text-[11px] font-bold uppercase tracking-widest mb-1.5">{copy.reviewPhotos}</p>
                                            <div className="flex flex-wrap gap-2">
                                                {review.images.map((url, i) => (
                                                    <button
                                                        key={i}
                                                        type="button"
                                                        onClick={() => setLightbox(resolveAssetUrl(url))}
                                                        className="w-20 h-20 rounded-xl overflow-hidden border border-zinc-200 hover:border-marine-cyan transition-colors"
                                                    >
                                                        <img src={resolveAssetUrl(url)} alt="" loading="lazy" className="w-full h-full object-cover" />
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {review.status === 'rejected' && review.rejection_reason && (
                                        <p className="text-red-600 text-xs mt-2">{review.rejection_reason}</p>
                                    )}
                                    {review.reviewed_by && (
                                        <p className="text-zinc-400 text-[11px] mt-2">
                                            {copy.moderatedBy} {review.reviewed_by}
                                        </p>
                                    )}

                                    {rejecting === review._id ? (
                                        <div className="mt-4 space-y-2">
                                            <input
                                                value={reason}
                                                onChange={(e) => setReason(e.target.value)}
                                                placeholder={copy.rejectReason}
                                                className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 text-sm focus:outline-none focus:border-marine-cyan"
                                            />
                                            <div className="flex items-center gap-3">
                                                <button
                                                    onClick={() => moderate(review._id, 'rejected', reason)}
                                                    disabled={busy === review._id}
                                                    className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold"
                                                >
                                                    {copy.reject}
                                                </button>
                                                <button
                                                    onClick={() => { setRejecting(null); setReason(''); }}
                                                    className="text-zinc-500 hover:text-zinc-800 text-xs font-bold"
                                                >
                                                    {isAr ? 'إلغاء' : 'Cancel'}
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-3 mt-4">
                                            {review.status !== 'approved' && (
                                                <button
                                                    onClick={() => moderate(review._id, 'approved')}
                                                    disabled={busy === review._id}
                                                    className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all"
                                                >
                                                    {busy === review._id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                                                    {copy.approve}
                                                </button>
                                            )}
                                            {review.status !== 'rejected' && (
                                                <button
                                                    onClick={() => { setRejecting(review._id); setReason(''); }}
                                                    disabled={busy === review._id}
                                                    className="flex items-center gap-1.5 bg-white border border-zinc-200 hover:border-red-300 text-red-600 px-4 py-2 rounded-xl text-xs font-bold transition-all"
                                                >
                                                    <X size={13} /> {copy.reject}
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
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
                    <img src={lightbox} alt="" className="max-w-full max-h-full rounded-2xl object-contain" />
                </Overlay>
            )}
        </div>
    );
}
