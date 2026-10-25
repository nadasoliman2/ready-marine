'use client';

import { useEffect, useState } from 'react';
import { companyPortalApi } from '../../lib/api';
import { formatMoney, formatDateTime, errorText } from '../../lib/companyLocalization';
import { Button, Modal, Notice, Spinner } from './CompanyUI';
import { usePortalTerms } from './OrgTermsContext';

// `ot` is the account's words (lib/orgTerms.js): a property's resident, not an employee.
const historyTitles = (ot) => ({
    company_invitation_accepted: { ar: `انضم ${ot.toThe}`, en: `Joined the ${ot.one}` },
    company_manager_made_employee: { ar: `اتضاف ك${ot.member}`, en: `Added as ${ot.aMember}` },
    company_employee_updated: { ar: 'اتعدل', en: 'Changed' },
    company_employee_deactivated: { ar: 'اتوقف عن الطلب', en: 'Ordering paused' },
    company_employee_reactivated: { ar: 'رجع يطلب', en: 'Ordering resumed' },
    company_employee_removed: { ar: `اتشال من ${ot.the}`, en: `Removed from the ${ot.one}` },
});

const fieldLabels = (ot) => ({
    limit: { ar: 'الليميت الخاص', en: 'Personal limit' },
    group: { ar: 'الجروب', en: 'Group' },
    office: { ar: ot.theBranch, en: ot.Branch },
});

const historyValue = (field, value, isAr) => {
    if (value === null || value === undefined) {
        if (field === 'limit') return isAr ? 'من الجروب/الافتراضي' : 'From group/default';
        if (field === 'group') return isAr ? 'من غير جروب' : 'No group';
        return '—';
    }
    return field === 'limit' ? formatMoney(value, isAr) : value;
};

const actorText = (entry, isAr, ot) => {
    if (entry.by_role === 'admin') return isAr ? `Ready Marine (${entry.by || 'أدمن'})` : `Ready Marine (${entry.by || 'admin'})`;
    return entry.by || (isAr ? `${ot.theMember} نفسه` : `The ${ot.member}`);
};

/** Who changed this employee — limit, group, office, paused or resumed — and when. */
export default function EmployeeHistoryModal({ row, isAr, onClose, load = companyPortalApi.getEmployeeHistory }) {
    const ot = usePortalTerms(isAr);
    const [entries, setEntries] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!row) return undefined;
        let alive = true;
        setEntries(null);
        setError('');
        load(row._id)
            .then((res) => { if (alive) setEntries(res.entries || []); })
            .catch((err) => { if (alive) setError(errorText(err, isAr)); });
        return () => { alive = false; };
    }, [row, isAr, load]);

    if (!row) return null;

    return (
        <Modal
            open={!!row}
            onClose={onClose}
            title={isAr ? `سجل ${row.name || `${ot.theMember}`}` : `${row.name || `${ot.Member}`} — history`}
            footer={<Button variant="ghost" onClick={onClose}>{isAr ? 'قفل' : 'Close'}</Button>}
        >
            {error && <Notice>{error}</Notice>}
            {!entries && !error && <Spinner />}
            {entries && entries.length === 0 && (
                <p className="text-sm text-zinc-500">{isAr ? 'مفيش تغييرات متسجلة لسه.' : 'No changes recorded yet.'}</p>
            )}
            {entries && entries.length > 0 && (
                <ol className="space-y-3">
                    {entries.map((e, i) => (
                        <li key={i} className="rounded-xl border border-zinc-100 dark:border-white/10 p-3">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <p className="font-bold text-sm text-zinc-900 dark:text-white">
                                    {(historyTitles(ot)[e.action] || { ar: e.action, en: e.action })[isAr ? 'ar' : 'en']}
                                </p>
                                <p className="text-[11px] text-zinc-500 tabular-nums">{formatDateTime(e.at, isAr)}</p>
                            </div>
                            <p className="text-xs text-zinc-500 mt-0.5">{isAr ? 'بواسطة: ' : 'By: '}{actorText(e, isAr, ot)}</p>
                            {e.changes.length > 0 && (
                                <ul className="mt-2 space-y-1">
                                    {e.changes.map((c) => (
                                        <li key={c.field} className="text-sm text-zinc-700 dark:text-zinc-200">
                                            <span className="font-semibold">{fieldLabels(ot)[c.field][isAr ? 'ar' : 'en']}: </span>
                                            <span className="text-zinc-500">{historyValue(c.field, c.from, isAr)}</span>
                                            <span className="mx-1.5 text-zinc-400">{isAr ? '←' : '→'}</span>
                                            <span className="font-semibold">{historyValue(c.field, c.to, isAr)}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </li>
                    ))}
                </ol>
            )}
        </Modal>
    );
}
