'use client';

import { Clock, CreditCard, Loader2, CheckCircle2, XCircle, Archive } from 'lucide-react';
import {
    getRequestStatusLabel,
    getRequestStatusTone,
    getRequestStatusIcon,
} from '../../lib/familyLocalization';

const ICONS = {
    clock: Clock,
    card: CreditCard,
    spinner: Loader2,
    check: CheckCircle2,
    x: XCircle,
    archive: Archive,
};

/**
 * Request status pill. Status is always carried by an icon AND text, never by
 * colour alone, so it stays readable for colour-blind users and in high
 * contrast modes.
 */
export default function RequestStatusBadge({ status, isAr, className = '' }) {
    const iconKey = getRequestStatusIcon(status);
    const Icon = ICONS[iconKey] || Clock;

    return (
        <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-[0.08em] ${getRequestStatusTone(status)} ${className}`}
        >
            <Icon size={12} className={iconKey === 'spinner' ? 'animate-spin' : ''} />
            {getRequestStatusLabel(status, isAr)}
        </span>
    );
}
