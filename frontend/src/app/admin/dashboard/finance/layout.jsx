'use client';

import Link from '../../../../components/LocaleLink';
import { usePathname } from '../../../../lib/navigation';
import { useApp } from '../../../../context/AppContext';
import { LayoutDashboard, Store, Percent, Users, Settings, Wallet, ReceiptText, Truck, Landmark, FileSpreadsheet, Banknote } from 'lucide-react';

/**
 * The finance module's own tab bar.
 *
 * Nine screens that share one subject and are constantly compared against each other —
 * "we owe vendors this much, and we made this much" is one thought — so they live under
 * one sidebar entry rather than five.
 */
export default function FinanceLayout({ children }) {
    const { language } = useApp();
    const isAr = language === 'ar';
    const pathname = usePathname();

    const tabs = [
        { href: '/admin/dashboard/finance', icon: LayoutDashboard, en: 'Overview', ar: 'نظرة عامة', exact: true },
        { href: '/admin/dashboard/finance/vendors', icon: Store, en: 'Vendor Payouts', ar: 'مستحقات التجار' },
        // Every transfer to a vendor, as an invoice: Paymob status, retries, bank returns.
        { href: '/admin/dashboard/finance/payouts', icon: Banknote, en: 'Payouts & invoices', ar: 'التحويلات والفواتير' },
        { href: '/admin/dashboard/finance/commissions', icon: Percent, en: 'Commissions', ar: 'العمولات' },
        { href: '/admin/dashboard/finance/customers', icon: Users, en: 'Customers & Profit', ar: 'العملاء والأرباح' },
        // The finance team's order-by-order sheet, exportable to Excel in their own layout.
        { href: '/admin/dashboard/finance/tracking', icon: FileSpreadsheet, en: 'Tracking report', ar: 'تقرير التتبع' },
        // Where money is sitting outside the bank — gateways, couriers, wallets — and what
        // came in each month by payment method.
        { href: '/admin/dashboard/finance/treasury', icon: Landmark, en: 'Money map', ar: 'الفلوس فين' },
        // The cash couriers are holding for us, and the shipping we prepaid them for. It
        // sits in Finance rather than under Shipping because it is money owed, not logistics.
        { href: '/admin/dashboard/finance/couriers', icon: Truck, en: 'Couriers', ar: 'شركات الشحن' },
        { href: '/admin/dashboard/finance/wallets', icon: Wallet, en: 'Wallets', ar: 'المحافظ', exact: true },
        { href: '/admin/dashboard/finance/wallets/ledger', icon: ReceiptText, en: 'Wallet Ledger', ar: 'حركات المحافظ' },
        { href: '/admin/dashboard/finance/settings', icon: Settings, en: 'Settings', ar: 'الإعدادات' },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-wide">
                    {isAr ? 'المالية' : 'Finance'}
                </h1>
                <p className="text-sm text-zinc-500 mt-1">
                    {isAr
                        ? 'مستحقات التجار، العمولات، تكاليف الشحن والأرباح.'
                        : 'Vendor payouts, commissions, shipping costs and profit.'}
                </p>
            </div>

            <div className="border-b border-zinc-200 dark:border-white/5 overflow-x-auto">
                <nav className="flex gap-1 min-w-max">
                    {tabs.map((tab) => {
                        // The overview sits at the section root, so it would otherwise light
                        // up on every child route.
                        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
                        const Icon = tab.icon;
                        return (
                            <Link
                                key={tab.href}
                                href={tab.href}
                                className={`flex items-center gap-2 px-4 py-3 text-sm font-bold whitespace-nowrap border-b-2 transition-colors ${active
                                    ? 'border-marine-cyan text-marine-primary'
                                    : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                                    }`}
                            >
                                <Icon size={16} />
                                {isAr ? tab.ar : tab.en}
                            </Link>
                        );
                    })}
                </nav>
            </div>

            {children}
        </div>
    );
}
