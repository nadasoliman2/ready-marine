'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from '../../lib/navigation';
import { AlertTriangle, Loader2 } from 'lucide-react';
import CompanySidebar from '../../components/company/CompanySidebar';
import CompanyTopBar from '../../components/company/CompanyTopBar';
import useMyCompany from '../../components/company/useMyCompany';
import { useApp } from '../../context/AppContext';
import { COMPANY_SCOPE_KEY } from '../../lib/api';
import { formatDate, hasWallet } from '../../lib/companyLocalization';
import { orgTerms } from '../../lib/orgTerms';
import { OrgTypeProvider } from '../../components/company/OrgTermsContext';
import Overlay from '../../components/Overlay';

/**
 * The company portal shell. Only a customer account holding an active manager
 * membership gets past the guard; the server re-checks that on every request,
 * so this is for the experience, not the security.
 *
 * The invitation landing page lives under /company too but is for people who
 * are not members yet, so it renders on its own without this shell.
 */
export default function CompanyLayout({ children }) {
    const pathname = usePathname();
    if (pathname?.startsWith('/company/invitation')) return children;
    return <PortalShell>{children}</PortalShell>;
}

function PortalShell({ children }) {
    const { user, isMounted, language } = useApp();
    const { memberships, loading } = useMyCompany();
    // The company this portal is showing. A manager of several picks one (the sidebar
    // switcher); the choice is remembered in this browser and sent with every portal
    // request. Written during render, before any page below fetches its data.
    const managed = useMemo(() => (memberships || []).filter((m) => m.is_manager), [memberships]);
    const membership = useMemo(() => {
        if (!managed.length) return null;
        let saved = null;
        try { saved = window.localStorage.getItem(COMPANY_SCOPE_KEY); } catch (_) { /* private mode */ }
        const returnedCompany = new URLSearchParams(window.location.search).get('companyId');
        const current = managed.find((m) => String(m.company._id) === String(returnedCompany || saved)) || managed[0];
        try {
            if (String(saved) !== String(current.company._id)) window.localStorage.setItem(COMPANY_SCOPE_KEY, current.company._id);
        } catch (_) { /* private mode */ }
        return current;
    }, [managed]);
    const switchCompany = (companyId) => {
        try { window.localStorage.setItem(COMPANY_SCOPE_KEY, companyId); } catch (_) { /* private mode */ }
        window.location.href = '/company';
    };
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const router = useRouter();
    const pathname = usePathname();
    const isAr = language === 'ar';

    useEffect(() => {
        if (!isMounted) return;
        if (!user) {
            router.push(`/login?role=customer&redirect=${encodeURIComponent(pathname || '/company')}`);
        } else if (user.role !== 'user') {
            router.push(user.role === 'admin' ? '/admin/dashboard' : '/dashboard');
        } else if (!loading && !membership?.is_manager) {
            router.push('/profile?tab=company');
        }
    }, [isMounted, user, loading, membership, router, pathname]);

    useEffect(() => { setSidebarOpen(false); }, [pathname]);

    if (!isMounted || !user || user.role !== 'user' || loading || !membership?.is_manager) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#0E1012]">
                <Loader2 size={40} className="text-marine-primary animate-spin" />
            </div>
        );
    }

    const t = orgTerms(membership.company?.org_type, isAr);
    return (
        <OrgTypeProvider value={membership.company?.org_type || 'company'}>
        <div className="flex h-screen-safe bg-zinc-50 dark:bg-[#0E1012] font-sans antialiased text-zinc-900 dark:text-zinc-100 overflow-hidden" dir={isAr ? 'rtl' : 'ltr'}>
            {sidebarOpen && (
                <Overlay className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
            )}
            <CompanySidebar
                isOpen={sidebarOpen}
                setIsOpen={setSidebarOpen}
                companyName={membership.company?.name}
                orgType={membership.company?.org_type}
                billingMode={membership.company?.billing_mode}
                hasInvoices={!!membership.company?.has_invoices}
                hasWalletHistory={!!membership.company?.has_wallet}
                companies={managed.map((m) => m.company)}
                currentCompanyId={membership.company?._id}
                onSwitchCompany={switchCompany}
            />
            <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
                <CompanyTopBar onMenuClick={() => setSidebarOpen(true)} />
                {/* Bottom padding keeps the last table row clear of the floating chat button. */}
                <main className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto bg-zinc-50 dark:bg-[#0E1012] p-4 pb-24 lg:p-8 lg:pb-24">
                    <div className="max-w-[1400px] mx-auto w-full">
                        {membership.company?.status === 'ended' && (
                            <div className="mb-5 flex items-start gap-3 rounded-xl border border-zinc-300 bg-zinc-100 px-5 py-4 text-zinc-700 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200">
                                <AlertTriangle size={22} className="mt-0.5 shrink-0" />
                                <div>
                                    <p className="font-black">
                                        {isAr
                                            ? `العقد مع Ready Marine انتهى${membership.company.ended_at ? ` يوم ${formatDate(membership.company.ended_at, true)}` : ''}`
                                            : `The contract with Ready Marine ended${membership.company.ended_at ? ` on ${formatDate(membership.company.ended_at, false)}` : ''}`}
                                    </p>
                                    <p className="mt-1 text-sm font-semibold">
                                        {hasWallet(membership.company.billing_mode) ? (isAr ? 'مفيش طلبات جديدة. الرصيد المتبقي والمرتجعات بيتسوّوا مع Ready Marine.' : 'No new orders. Ready Marine settles the remaining wallet balance and any later refunds.') : isAr
                                            ? `مفيش طلب جديد على حساب ${t.the}. تقدر تشوف الفواتير وتسدد المتبقي. أي مرتجع بعد كده بيتخصم من المتبقي عليكم، ولو فضل ليكم فلوس Ready Marine بتحوّلهالكم.`
                                            : `No new orders on the ${t.one} account. You can see your invoices and pay what is left. Any later return comes off what you owe, and Ready Marine transfers back anything left in your favour.`}
                                    </p>
                                </div>
                            </div>
                        )}
                        {membership.company?.status === 'suspended' && (
                            <div className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
                                <AlertTriangle size={22} className="mt-0.5 shrink-0" />
                                <div>
                                    <p className="font-black">{isAr ? `الطلب على حساب ${t.the} موقوف` : `Ordering on the ${t.one} account is paused`}</p>
                                    <p className="mt-1 text-sm font-semibold">
                                        {isAr
                                            ? `${t.members} مش هيقدروا يطلبوا على حساب ${t.the} لحد ما الإيقاف يتشال. الأوردرات اللي اتطلبت قبل كده بتكمل عادي. تواصل مع Ready Marine لو عندك سؤال.`
                                            : `${t.Members} cannot order on the ${t.one} account until this is lifted. Orders already placed continue as normal. Contact Ready Marine with any questions.`}
                                    </p>
                                </div>
                            </div>
                        )}
                        {children}
                    </div>
                </main>
            </div>

            {/* Popups render here (see components/Overlay.jsx): on the screen, yet still
                inside the shell, so they keep its text colour and font. */}
            <div id="overlay-root" />
        </div>
        </OrgTypeProvider>
    );
}
