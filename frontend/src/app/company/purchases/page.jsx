'use client';

import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../../context/AppContext';
import { companyPortalApi, downloadFile } from '../../../lib/api';
import { errorText } from '../../../lib/companyLocalization';
import { PageHeader, Notice, Spinner } from '../../../components/company/CompanyUI';
import PurchasesView from '../../../components/company/PurchasesView';
import { usePortalTerms } from '../../../components/company/OrgTermsContext';

/** The company's ledger: who took what, for how much, and when — month by month. */
export default function CompanyPurchasesPage() {
    const { language } = useApp();
    const isAr = language === 'ar';
    const ot = usePortalTerms(isAr);
    const [month, setMonth] = useState('');
    const [data, setData] = useState(null);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        try {
            const res = await companyPortalApi.getPurchases(month ? { month } : {});
            setData(res);
            if (!month) setMonth(res.month);
            setError('');
        } catch (err) {
            setError(errorText(err, isAr));
        }
    }, [month, isAr]);

    useEffect(() => { load(); }, [load]);

    const exportExcel = () => downloadFile(companyPortalApi.exportPurchasesUrl({ month: data.month }));

    return (
        <div>
            <PageHeader
                title={isAr ? 'المشتريات' : 'Purchases'}
                subtitle={isAr ? `كل اللي اتطلب على حساب ${ot.the}: مين أخد إيه وبكام وامتى.` : `Everything ordered on the ${ot.one} account: who took what, for how much, and when.`}
            />
            {error && <Notice onClose={() => setError('')}>{error}</Notice>}
            {!data ? <Spinner /> : (
                <PurchasesView data={data} isAr={isAr} month={month || data.month} onMonthChange={setMonth} onExport={exportExcel} />
            )}
        </div>
    );
}
