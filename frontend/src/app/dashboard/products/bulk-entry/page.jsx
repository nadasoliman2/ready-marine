'use client';

import { ArrowLeft, FileSpreadsheet } from 'lucide-react';
import Link from '../../../../components/LocaleLink';
import { vendorApi } from '../../../../lib/api';
import { useApp } from '../../../../context/AppContext';
import BulkEntryGrid from '../../../../components/dashboard/bulk-entry/BulkEntryGrid';
import { L } from '../../../../components/dashboard/bulk-entry/bulkEntryUtils';

export default function VendorBulkEntryPage() {
    const { language } = useApp();
    return (
        <div className="animate-in fade-in duration-300">
            <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
                <div className="flex items-center gap-3">
                    <Link href="/dashboard/products" className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors">
                        <ArrowLeft size={20} />
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">{L(language, 'Add products online', 'إضافة منتجات أونلاين')}</h1>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">{L(language, 'Fill the table and submit many products at once. Complex fields open a popup.', 'املأ الجدول وأرسل عدة منتجات دفعة واحدة. الحقول المعقّدة تُفتح في نافذة منبثقة.')}</p>
                    </div>
                </div>
                <Link href="/dashboard/products/bulk-upload" className="flex items-center gap-2 text-sm font-semibold text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-white/10 hover:border-marine-cyan hover:text-marine-primary px-3 py-2 rounded-lg transition-colors">
                    <FileSpreadsheet size={15} /> {L(language, 'Bulk Excel Upload', 'رفع جماعي بالإكسل')}
                </Link>
            </div>

            <BulkEntryGrid
                submit={(products) => vendorApi.bulkCreateProducts(products)}
                storageKey="bulk-entry:vendor"
                editBase="/dashboard/products"
            />
        </div>
    );
}
