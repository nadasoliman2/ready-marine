'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from '../../../components/LocaleLink';
import { Layers, Plus, Pencil, Trash2 } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { companyPortalApi } from '../../../lib/api';
import { formatMoney, errorText } from '../../../lib/companyLocalization';
import {
    CARD, INPUT, PageHeader, Button, Notice, Spinner, EmptyState, Modal, Field,
} from '../../../components/company/CompanyUI';
import { usePortalTerms } from '../../../components/company/OrgTermsContext';

/**
 * Groups: sets of employees who share a monthly limit. An employee in no group
 * gets the company default; a personal limit (set on the employee) beats both.
 */
export default function CompanyGroupsPage() {
    const { language } = useApp();
    const isAr = language === 'ar';
    const ot = usePortalTerms(isAr);
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [editing, setEditing] = useState(null); // null | {} (new) | group

    const load = useCallback(async () => {
        try {
            setData(await companyPortalApi.getGroups());
            setError('');
        } catch (err) {
            setError(errorText(err, isAr));
        }
    }, [isAr]);

    useEffect(() => { load(); }, [load]);

    const remove = async (group) => {
        const text = isAr
            ? `مسح جروب "${group.name}"؟ الـ ${group.employees} ${ot.member} اللي فيه هياخدوا الليميت الافتراضي.`
            : `Delete "${group.name}"? Its ${group.employees} ${ot.member}(s) move to the default limit.`;
        if (!confirm(text)) return;
        try {
            await companyPortalApi.deleteGroup(group._id);
            setMessage(isAr ? 'الجروب اتمسح' : 'Group deleted');
            await load();
        } catch (err) {
            setError(errorText(err, isAr));
        }
    };

    if (!data) return error ? <Notice>{error}</Notice> : <Spinner />;

    return (
        <div>
            <PageHeader
                title={isAr ? 'الجروبات' : 'Groups'}
                subtitle={isAr ? `كل جروب ليه ليميت شهري لكل ${ot.member} فيه، شامل الشحن.` : `Each group gives its ${ot.members} one monthly limit, shipping included.`}
                actions={<Button icon={Plus} onClick={() => setEditing({})}>{isAr ? 'جروب جديد' : 'New group'}</Button>}
            />
            {error && <Notice onClose={() => setError('')}>{error}</Notice>}
            {message && <Notice tone="success" onClose={() => setMessage('')}>{message}</Notice>}

            <div className={`${CARD} p-4 mb-4 flex flex-wrap items-center justify-between gap-3`}>
                <div>
                    <p className="text-sm font-bold text-zinc-900 dark:text-white">{isAr ? 'الليميت الافتراضي' : 'Default limit'}</p>
                    <p className="text-xs text-zinc-500">
                        {isAr ? `لـ ${data.employees_without_group} ${ot.member} مش في أي جروب` : `For ${data.employees_without_group} ${ot.member}(s) in no group`}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-lg font-black tabular-nums" dir="ltr">{formatMoney(data.default_limit, isAr)}</span>
                    <Link href="/company/settings" className="text-sm font-bold text-marine-primary hover:underline">{isAr ? 'تغيير' : 'Change'}</Link>
                </div>
            </div>

            {data.groups.length === 0 ? (
                <div className={CARD}>
                    <EmptyState
                        icon={Layers}
                        title={isAr ? 'لسه مفيش جروبات' : 'No groups yet'}
                        message={isAr ? `اعمل جروب لو فيه ${ot.membersN} محتاجين ليميت مختلف عن الافتراضي (مثلاً المديرين أو السواقين).` : `Create a group when some ${ot.members} need a different limit from the default (e.g. managers or drivers).`}
                    />
                </div>
            ) : (
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                    {data.groups.map((group) => (
                        <div key={group._id} className={`${CARD} p-5`}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="font-black text-zinc-900 dark:text-white truncate">{group.name}</p>
                                    <p className="text-xs text-zinc-500 mt-0.5">{isAr ? `${group.employees} ${ot.member}` : `${group.employees} ${ot.member}(s)`}</p>
                                </div>
                                <div className="flex gap-1">
                                    <button type="button" onClick={() => setEditing(group)} className="p-2 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5" title={isAr ? 'تعديل' : 'Edit'}><Pencil size={16} /></button>
                                    <button type="button" onClick={() => remove(group)} className="p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10" title={isAr ? 'مسح' : 'Delete'}><Trash2 size={16} /></button>
                                </div>
                            </div>
                            <p className="text-2xl font-black mt-3 tabular-nums" dir="ltr">{formatMoney(group.limit, isAr)}</p>
                            <p className="text-xs text-zinc-500">{isAr ? `في الشهر لكل ${ot.member}` : `per ${ot.member}, per month`}</p>
                            <Link href={`/company/employees?group=${group._id}`} className="inline-block mt-3 text-xs font-bold text-marine-primary hover:underline">
                                {isAr ? `شوف ${ot.members}` : `See ${ot.members}`}
                            </Link>
                        </div>
                    ))}
                </div>
            )}

            <GroupModal
                group={editing}
                isAr={isAr}
                onClose={() => setEditing(null)}
                onSaved={async (text) => { setEditing(null); setMessage(text); await load(); }}
            />
        </div>
    );
}

function GroupModal({ group, isAr, onClose, onSaved }) {
    const ot = usePortalTerms(isAr);
    const [form, setForm] = useState({ name: '', limit: '' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const isNew = group && !group._id;

    useEffect(() => {
        if (group) {
            setForm({ name: group.name || '', limit: group.limit ?? '' });
            setError('');
        }
    }, [group]);

    if (!group) return null;

    const save = async () => {
        setBusy(true);
        setError('');
        try {
            const payload = { name: form.name, limit: Number(form.limit || 0) };
            if (isNew) {
                await companyPortalApi.createGroup(payload);
                onSaved(isAr ? 'الجروب اتعمل' : 'Group created');
            } else {
                const res = await companyPortalApi.updateGroup(group._id, payload);
                onSaved(res.over_limit_count
                    ? (isAr ? `اتحفظ. ${res.over_limit_count} ${ot.member} صرفوا أكتر من الليميت الجديد — مش هيقدروا يطلبوا لحد الشهر الجاي.` : `Saved. ${res.over_limit_count} ${ot.member}(s) already spent more than the new limit and cannot order until next month.`)
                    : (isAr ? 'اتحفظ' : 'Saved'));
            }
        } catch (err) {
            setError(errorText(err, isAr));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            open={!!group}
            onClose={onClose}
            title={isNew ? (isAr ? 'جروب جديد' : 'New group') : (isAr ? 'تعديل الجروب' : 'Edit group')}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
                    <Button onClick={save} loading={busy} disabled={!form.name.trim() || form.limit === ''}>{isAr ? 'حفظ' : 'Save'}</Button>
                </>
            )}
        >
            {error && <Notice>{error}</Notice>}
            <div className="space-y-4">
                <Field label={isAr ? 'اسم الجروب' : 'Group name'}>
                    <input className={`${INPUT} w-full`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={isAr ? 'مثلاً: المبيعات' : 'e.g. Sales'} />
                </Field>
                <Field label={isAr ? `الليميت الشهري لكل ${ot.member} (شامل الشحن)` : `Monthly limit per ${ot.member} (shipping included)`} hint={isAr ? 'تغيير الليميت بيسري من دلوقتي ومش بيلغي أوردرات اتعملت.' : 'A change applies from now on and never cancels orders already placed.'}>
                    <input type="number" min="0" step="1" dir="ltr" className={`${INPUT} w-full`} value={form.limit} onChange={(e) => setForm({ ...form, limit: e.target.value })} />
                </Field>
            </div>
        </Modal>
    );
}
