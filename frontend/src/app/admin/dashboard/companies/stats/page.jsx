'use client';

import Link from '../../../../../components/LocaleLink';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useApp } from '../../../../../context/AppContext';
import { adminCompanyApi } from '../../../../../lib/api';
import { PageHeader } from '../../../../../components/company/CompanyUI';
import CompanyStatsView from '../../../../../components/company/CompanyStatsView';

/** Every corporate account together, month by month (feature 14, phase 5). */
export default function AdminCompanyStatsPage() {
    const { language } = useApp();
    const isAr = language === 'ar';
    const Back = isAr ? ArrowRight : ArrowLeft;
    return (
        <div>
            <Link href="/admin/dashboard/companies" className="inline-flex items-center gap-1.5 text-sm font-bold text-zinc-500 hover:text-zinc-900 dark:hover:text-white mb-4">
                <Back size={16} /> {isAr ? 'كل الحسابات' : 'All accounts'}
            </Link>
            <PageHeader
                title={isAr ? 'إحصائيات حسابات الشركات والجهات' : 'Corporate account statistics'}
                subtitle={isAr
                    ? 'الفلوس، والنشاط، والتجميع — لكل الحسابات مع بعض، شهر بشهر.'
                    : 'Money, activity and consolidation — every company together, month by month.'}
            />
            <CompanyStatsView
                isAr={isAr}
                load={(params) => adminCompanyApi.getStats(params)}
                exportUrl={(params) => adminCompanyApi.exportStatsUrl(params)}
            />
        </div>
    );
}
