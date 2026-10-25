'use client';

import { Menu } from 'lucide-react';
import CustomerNotificationBell from '../CustomerNotificationBell';
import ThemeToggle from '../ThemeToggle';
import { useApp } from '../../context/AppContext';

/**
 * The portal's top bar. Not the vendor TopBar: a manager is a customer account,
 * so the bell is the customer inbox and the role label says "Company manager".
 */
export default function CompanyTopBar({ onMenuClick }) {
    const { user, language, setLanguage } = useApp();
    const isAr = language === 'ar';
    const name = user?.name || '';

    return (
        <header className="h-16 flex-shrink-0 bg-white dark:bg-[#14171A] border-b border-zinc-200 dark:border-white/5 flex items-center justify-between px-6 z-10">
            <button
                onClick={onMenuClick}
                className="lg:hidden p-2 -ms-2 text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-50 dark:hover:bg-white/5 rounded-lg transition-colors"
                aria-label={isAr ? 'القايمة' : 'Menu'}
            >
                <Menu size={20} />
            </button>
            <div className="flex-1" />
            <div className="flex items-center gap-3">
                <ThemeToggle />
                <button
                    onClick={() => setLanguage(isAr ? 'en' : 'ar')}
                    className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white px-3 py-1.5 text-xs font-bold border border-zinc-100 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/5 rounded-lg transition-all"
                >
                    {isAr ? 'EN' : 'عربي'}
                </button>
                <CustomerNotificationBell />
                <div className="h-6 w-px bg-zinc-200 dark:bg-white/10" />
                <div className="flex items-center gap-3">
                    <div className="text-end hidden sm:block">
                        <p className="text-sm font-bold text-zinc-900 dark:text-white leading-tight">{name}</p>
                        <p className="text-[10px] uppercase font-black tracking-widest text-marine-primary">
                            {isAr ? 'مدير الحساب' : 'Account manager'}
                        </p>
                    </div>
                    <div className="w-9 h-9 rounded-xl bg-marine-cyan flex items-center justify-center text-white font-black text-sm shadow-md">
                        {(name || 'M').charAt(0).toUpperCase()}
                    </div>
                </div>
            </div>
        </header>
    );
}
