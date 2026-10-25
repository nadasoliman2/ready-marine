'use client';

/**
 * Shared pieces for vendor payouts — the status badge and the "where the money went" line —
 * so the admin screens and the vendor's wallet describe a payout in the same words.
 */

export const PAYOUT_STATUS = {
    pending: { en: 'Awaiting approval', ar: 'في انتظار الموافقة', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
    approved: { en: 'Approved', ar: 'تمت الموافقة', cls: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
    processing: { en: 'On its way', ar: 'جاري التحويل', cls: 'bg-sky-500/10 text-sky-600 dark:text-sky-400' },
    paid: { en: 'Paid', ar: 'مدفوع', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
    failed: { en: 'Failed — money back in wallet', ar: 'فشل — الفلوس رجعت للمحفظة', cls: 'bg-red-500/10 text-red-600 dark:text-red-400' },
    rejected: { en: 'Rejected', ar: 'مرفوض', cls: 'bg-red-500/10 text-red-600 dark:text-red-400' },
    cancelled: { en: 'Cancelled', ar: 'ملغي', cls: 'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400' },
};

export function PayoutStatusBadge({ status, isAr, unknown = false }) {
    const s = PAYOUT_STATUS[status] || { en: status, ar: status, cls: 'bg-zinc-500/10 text-zinc-500' };
    return (
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap ${s.cls}`}>
            {isAr ? s.ar : s.en}
            {unknown && <span className="ms-1">· {isAr ? 'بانتظار رد Paymob' : 'awaiting Paymob'}</span>}
        </span>
    );
}

/** "Vodafone Cash · 010•••••789" from a described payout method (server `describe`). */
export function destinationText(dest, isAr) {
    if (!dest) return null;
    const label = dest.label ? (isAr ? dest.label.ar : dest.label.en) : dest.issuer;
    return [label, dest.bank_name, dest.account].filter(Boolean).join(' · ');
}

export const CHANNEL_LABEL = {
    paymob: { en: 'Paymob', ar: 'Paymob' },
    manual: { en: 'Manual transfer', ar: 'تحويل يدوي' },
};
