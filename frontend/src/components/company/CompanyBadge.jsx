'use client';

import Link from '../LocaleLink';
import { Building2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import useMyCompany from './useMyCompany';
import { formatMoney } from '../../lib/companyLocalization';
import { orgTerms } from '../../lib/orgTerms';

/**
 * The header reminder that an employee has a company balance to spend:
 * "Acme · EGP 1,250 left". Someone employed by several companies sees the first
 * one and "+N"; "My company" lists them all. Renders nothing for anyone else.
 */
export default function CompanyBadge() {
    const { language } = useApp();
    const isAr = language === 'ar';
    const { memberships } = useMyCompany();
    const employed = (memberships || []).filter((m) => m.is_employee && !m.deactivated);
    const membership = employed[0];
    const ot = orgTerms(membership?.company?.org_type, isAr);

    if (!membership) return null;

    return (
        <Link
            href="/profile?tab=company"
            className="hidden md:inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-bold text-zinc-700 hover:border-marine-cyan hover:text-marine-primary transition-colors max-w-[260px]"
            title={isAr ? `رصيدك على حساب ${ot.the}` : `Your ${ot.one} balance`}
        >
            <Building2 size={14} className="shrink-0 text-marine-primary" />
            <span className="truncate">{membership.company.name}</span>
            <span className="text-zinc-300">·</span>
            <span className="whitespace-nowrap tabular-nums" dir="ltr">
                {membership.limit === null || membership.limit === undefined
                    ? (isAr ? 'من غير ليميت' : 'No limit')
                    : isAr ? `فاضل ${formatMoney(membership.remaining, true)}` : `${formatMoney(membership.remaining, false)} left`}
            </span>
            {employed.length > 1 && <span className="text-zinc-400">+{employed.length - 1}</span>}
        </Link>
    );
}

/** The account-menu entry for managers. */
export function CompanyPortalMenuLink({ className }) {
    const { language } = useApp();
    const isAr = language === 'ar';
    const { memberships } = useMyCompany();
    const ot = orgTerms((memberships || []).find((m) => m.is_manager)?.company?.org_type, isAr);
    if (!(memberships || []).some((m) => m.is_manager)) return null;
    return (
        <Link href="/company" className={className}>
            <Building2 size={16} />
            <span>{isAr ? `لوحة ${ot.the}` : `${ot.One} portal`}</span>
        </Link>
    );
}
