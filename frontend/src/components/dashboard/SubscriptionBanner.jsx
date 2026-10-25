'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { subscriptionApi } from '../../lib/api';
import { useApp } from '../../context/AppContext';
import Link from '../LocaleLink';

export default function SubscriptionBanner() {
    const { user, language } = useApp();
    const isAr = language === 'ar';
    const [status, setStatus] = useState(null);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        if (user?.role !== 'vendor') return;
        const savedDismissal = localStorage.getItem('sub_expiring_dismissed');
        if (savedDismissal) {
            const dismissedAt = new Date(savedDismissal);
            const now = new Date();
            if (dismissedAt.getTime() > now.getTime() - 24 * 60 * 60 * 1000) {
                setDismissed(true);
                return;
            }
        }
        subscriptionApi.getStatus()
            .then(data => setStatus(data))
            .catch(() => {});
    }, [user]);

    if (!status || !status.hasActive || !status.isExpiringSoon || dismissed) return null;
    if (status.subscription?.is_free_trial) return null; // Don't show for trials

    const daysLeft = status.daysUntilExpiry;

    const handleDismiss = () => {
        setDismissed(true);
        localStorage.setItem('sub_expiring_dismissed', new Date().toISOString());
    };

    return (
        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl px-5 py-3.5 flex items-start gap-3">
            <AlertTriangle size={20} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
                <p className="font-black text-amber-700 dark:text-amber-300 text-sm">
                    {daysLeft === 1
                        ? (isAr ? 'اشتراكك ينتهي غداً!' : 'Your subscription expires tomorrow!')
                        : isAr
                            ? `اشتراكك ينتهي خلال ${daysLeft} أيام!`
                            : `Your subscription expires in ${daysLeft} days!`}
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5 font-semibold">
                    {isAr
                        ? 'قم بتجديد اشتراكك الآن للحفاظ على منتجاتك ظاهرة ومتاحه للشراء.'
                        : 'Renew now to keep your products live and purchasable.'}
                </p>
                <Link href="/dashboard/subscription"
                    className="inline-flex items-center gap-1.5 mt-2 px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-black rounded-lg transition-colors">
                    <RefreshCw size={12} />
                    {isAr ? 'تجديد الآن' : 'Renew Now'}
                </Link>
            </div>
            <button onClick={handleDismiss}
                className="p-1 text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors shrink-0">
                <X size={16} />
            </button>
        </div>
    );
}