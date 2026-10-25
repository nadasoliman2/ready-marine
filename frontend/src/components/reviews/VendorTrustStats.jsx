'use client';

import { PackageCheck, Star } from 'lucide-react';

/**
 * A vendor's two public trust numbers: orders they have actually completed, and what
 * customers scored them.
 *
 * One component behind all three surfaces that show them — the store page, the vendor
 * directory card, and the "sold by" block on a product page — so the same seller cannot
 * read as more established in one place than another. `tone` only swaps the palette for
 * the dark hero on the store page; the content and its meaning stay identical.
 *
 * A store with no completed orders yet says so plainly rather than showing "0". Zero is a
 * number a reader interprets as failure; "New store" is what it actually means.
 */
export default function VendorTrustStats({
    completedOrders = 0,
    rating = 0,
    reviewsCount = 0,
    isAr = false,
    tone = 'light',
    size = 'md',
    className = '',
}) {
    const orders = Number(completedOrders) || 0;
    const stars = Number(rating) || 0;
    const reviews = Number(reviewsCount) || 0;
    const locale = isAr ? 'ar-u-nu-latn' : 'en-US';

    const dark = tone === 'dark';
    const iconSize = size === 'sm' ? 14 : 18;
    const textCls = size === 'sm' ? 'text-xs' : 'text-sm';
    const mutedCls = dark ? 'text-marine-outline' : 'text-marine-outline';

    return (
        <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${textCls} font-bold ${mutedCls} ${className}`}>
            <span className="inline-flex items-center gap-1.5">
                <PackageCheck size={iconSize} className="text-emerald-500 shrink-0" />
                {orders > 0 ? (
                    <span>
                        <span className={dark ? 'text-white' : 'text-marine-ink'}>{orders.toLocaleString(locale)}</span>
                        {' '}
                        {isAr ? 'طلب مكتمل' : `completed order${orders === 1 ? '' : 's'}`}
                    </span>
                ) : (
                    <span>{isAr ? 'متجر جديد' : 'New store'}</span>
                )}
            </span>

            {reviews > 0 && (
                <span className="inline-flex items-center gap-1.5">
                    <Star size={iconSize} className="fill-amber-400 text-amber-400 shrink-0" />
                    <span className={dark ? 'text-white' : 'text-marine-ink'}>{stars.toFixed(1)}</span>
                    <span className="font-medium">
                        ({reviews.toLocaleString(locale)})
                    </span>
                </span>
            )}
        </div>
    );
}
