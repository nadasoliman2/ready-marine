'use client';

import Link from '../LocaleLink';
import { usePathname } from '../../lib/navigation';
import {
    LayoutDashboard, Users, Layers, Building2, Car, Settings, LogOut, X, Store, ShoppingBag, Receipt, Wallet,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { orgTerms } from '../../lib/orgTerms';

/** The company portal's navigation. */
export default function CompanySidebar({ isOpen, setIsOpen, companyName, orgType = 'company', billingMode = 'monthly', hasInvoices = false, hasWalletHistory = false, companies = [], currentCompanyId = null, onSwitchCompany = null }) {
    const pathname = usePathname();
    const { logout, language } = useApp();
    const isAr = language === 'ar';
    const t = orgTerms(orgType, isAr);

    // The side the account pays with now, and the other one for as long as there is
    // something on it — the admin may have moved the account from one to the other.
    const onWallet = billingMode === 'wallet' || billingMode === 'credit_wallet';
    const menuItems = [
        { name: isAr ? 'الرئيسية' : 'Home', icon: LayoutDashboard, href: '/company' },
        { name: t.Members, icon: Users, href: '/company/employees' },
        { name: isAr ? 'المشتريات' : 'Purchases', icon: ShoppingBag, href: '/company/purchases' },
        ...(onWallet || hasWalletHistory ? [{ name: isAr ? `محفظة ${t.the}` : `${t.One} wallet`, icon: Wallet, href: '/company/wallet' }] : []),
        ...(!onWallet || hasInvoices ? [{ name: isAr ? 'الفواتير' : 'Invoices', icon: Receipt, href: '/company/invoices' }] : []),
        { name: isAr ? 'الجروبات' : 'Groups', icon: Layers, href: '/company/groups' },
        { name: t.Branches, icon: Building2, href: '/company/offices' },
        { name: isAr ? `عربيات ${t.the}` : `${t.One} cars`, icon: Car, href: '/company/cars' },
        { name: isAr ? 'الإعدادات' : 'Settings', icon: Settings, href: '/company/settings' },
    ];

    return (
        <aside className={`
            fixed inset-y-0 z-50 w-72 shrink-0 bg-white dark:bg-[#14171A] border-e border-zinc-200 dark:border-white/5 flex flex-col transition-transform duration-300 ease-in-out lg:static lg:translate-x-0
            ${isOpen ? 'translate-x-0' : (isAr ? 'translate-x-full' : '-translate-x-full')}
        `}>
            <div className="h-16 flex items-center justify-between px-6 border-b border-zinc-100 dark:border-white/5">
                <Link href="/company" className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded bg-marine-cyan flex items-center justify-center shrink-0">
                        <Building2 size={16} className="text-white" />
                    </div>
                    <div className="min-w-0">
                        <p className="font-black text-sm text-zinc-900 dark:text-white truncate">{companyName || (isAr ? t.account : `${t.One} account`)}</p>
                        <p className="text-[10px] font-black uppercase tracking-widest text-marine-primary">{t.portal}</p>
                    </div>
                </Link>
                <button onClick={() => setIsOpen(false)} className="lg:hidden p-1 text-zinc-400 hover:text-zinc-900 dark:hover:text-white">
                    <X size={20} />
                </button>
            </div>

            {/* A manager of several companies switches between their portals here. */}
            {companies.length > 1 && onSwitchCompany && (
                <div className="px-4 pt-4">
                    <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1.5">{isAr ? 'الحساب' : 'Account'}</label>
                    <select
                        value={String(currentCompanyId || '')}
                        onChange={(e) => onSwitchCompany(e.target.value)}
                        className="w-full rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 px-3 py-2 text-sm font-bold text-zinc-900 dark:text-white"
                    >
                        {companies.map((c) => <option key={c._id} value={String(c._id)}>{c.name}</option>)}
                    </select>
                </div>
            )}

            <nav className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
                {menuItems.map((item) => {
                    const isActive = pathname === item.href || (item.href !== '/company' && pathname.startsWith(item.href));
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setIsOpen(false)}
                            className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-bold transition-all duration-200 ${isActive
                                ? 'bg-marine-mist dark:bg-marine-cyan/10 text-marine-primary shadow-sm'
                                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-50 dark:hover:bg-white/5'}`}
                        >
                            <item.icon size={20} className={isActive ? 'text-marine-primary' : 'text-zinc-400 dark:text-zinc-500'} />
                            <span className="flex-1 truncate">{item.name}</span>
                        </Link>
                    );
                })}
            </nav>

            <div className="p-4 border-t border-zinc-100 dark:border-white/5 space-y-1">
                <Link
                    href="/"
                    className="flex w-full items-center gap-3 px-4 py-3 text-sm font-bold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5 rounded-xl transition-all"
                >
                    <Store size={20} />
                    {isAr ? 'الرجوع للمتجر' : 'Back to the store'}
                </Link>
                <button
                    onClick={logout}
                    className="flex w-full items-center gap-3 px-4 py-3 text-sm font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-all"
                >
                    <LogOut size={20} />
                    {isAr ? 'تسجيل الخروج' : 'Log out'}
                </button>
            </div>
        </aside>
    );
}
