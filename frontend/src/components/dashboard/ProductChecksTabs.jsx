'use client';

import { CarFront, ImageOff } from 'lucide-react';
import Link from '../LocaleLink';
import { L } from '../../lib/catalog';

/** The two product checks side by side: the fitment check and the image check. */
export default function ProductChecksTabs({ active, language }) {
    const tabs = [
        { id: 'fitment', href: '/admin/dashboard/fitment-check', icon: CarFront, en: 'Fitment check', ar: 'مراجعة التوافق' },
        { id: 'images', href: '/admin/dashboard/image-check', icon: ImageOff, en: 'Image check', ar: 'مراجعة الصور' },
    ];
    return (
        <div className="flex gap-1 mb-5 border-b border-zinc-200 dark:border-white/10">
            {tabs.map((t) => {
                const on = t.id === active;
                const Icon = t.icon;
                return (
                    <Link key={t.id} href={t.href}
                        className={`inline-flex items-center gap-1.5 px-4 py-2.5 -mb-px border-b-2 text-sm font-bold transition-colors ${on ? 'border-marine-cyan text-marine-primary' : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-white'}`}>
                        <Icon size={15} /> {L(language, t.en, t.ar)}
                    </Link>
                );
            })}
        </div>
    );
}
