'use client';

import Link from '../../../../components/LocaleLink';
import { usePathname } from '../../../../lib/navigation';
import { useApp } from '../../../../context/AppContext';
import { Globe2, Layers, Package, ScrollText, Settings2, FlaskConical, TrendingDown } from 'lucide-react';

export default function ShippingLayout({ children }) {
    const pathname = usePathname();
    const { language } = useApp();
    const isAr = language === 'ar';

    const tabs = [
        { href: '/admin/dashboard/shipping/zones', label: isAr ? 'المناطق' : 'Zones', icon: Globe2 },
        { href: '/admin/dashboard/shipping/classes', label: isAr ? 'فئات الشحن' : 'Classes', icon: Layers },
        { href: '/admin/dashboard/shipping/methods', label: isAr ? 'طرق الشحن' : 'Methods', icon: Package },
        { href: '/admin/dashboard/shipping/policies', label: isAr ? 'السياسات' : 'Policies', icon: ScrollText },
        { href: '/admin/dashboard/shipping/settings', label: isAr ? 'الإعدادات' : 'Settings', icon: Settings2 },
        { href: '/admin/dashboard/shipping/test', label: isAr ? 'اختبار الحساب' : 'Test', icon: FlaskConical },
        { href: '/admin/dashboard/shipping/subsidy', label: isAr ? 'دعم الشحن' : 'Subsidy', icon: TrendingDown },
    ];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-wide">{isAr ? 'الشحن' : 'Shipping'}</h1>
                <p className="text-sm text-zinc-500 mt-1">
                    {isAr ? 'إدارة المناطق وفئات الشحن وطرقه وسياساته — مُتحكم بها بالكامل من قبل المسؤول.' : 'Zones, shipping classes, methods, and policies — fully admin-controlled.'}
                </p>
            </div>

            <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-white/10">
                {tabs.map((t) => {
                    const Icon = t.icon;
                    const active = pathname === t.href || pathname.startsWith(t.href + '/');
                    return (
                        <Link
                            key={t.href}
                            href={t.href}
                            className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold rounded-t-lg border-b-2 -mb-px transition-colors ${
                                active
                                    ? 'border-marine-cyan text-marine-primary bg-marine-cyan/5'
                                    : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-50 dark:hover:bg-white/5'
                            }`}
                        >
                            <Icon size={16} />
                            {t.label}
                        </Link>
                    );
                })}
            </div>

            <div>{children}</div>
        </div>
    );
}
