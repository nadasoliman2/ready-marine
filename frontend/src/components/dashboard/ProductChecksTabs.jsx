'use client';

import { Ship, ImageOff } from 'lucide-react';
import Link from '../LocaleLink';
import { L } from '../../lib/catalog';

/** The two product checks side by side: the fitment check and the image check. */
export default function ProductChecksTabs({ active, language }) {
    const tabs = [
        { id: 'images', href: '/admin/dashboard/image-check', icon: ImageOff, en: 'Image check', ar: 'مراجعة الصور' },
    ];
    return (
        <div className="">
            {tabs.map((t) => {
                const on = t.id === active;
                const Icon = t.icon;
                return (
                    <Link key={t.id} href={t.href}
                        className={`inline-flex items-center gap-1.5 px-4 py-2.5 -mb-px border-b-2 text-sm font-bold transition-colors ${on ? 'border-marine-cyan text-marine-primary' : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-white'}`}>
                 
                    </Link>
                );
            })}
        </div>
    );
}
