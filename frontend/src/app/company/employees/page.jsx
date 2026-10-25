'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { UserPlus, Search, RefreshCw, Pencil, Trash2, Send, XCircle, Users, PauseCircle, PlayCircle, History } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { companyPortalApi } from '../../../lib/api';
import { formatMoney, formatDate, formatMonth, memberStatusLabel, memberStatusClass, limitSourceLabel, errorText, formatLimit } from '../../../lib/companyLocalization';
import {
    CARD, INPUT, PageHeader, Button, Notice, Spinner, EmptyState, TableWrap, Th, Td, Pill, Modal, Field,
} from '../../../components/company/CompanyUI';
import AddEmployeesModal from '../../../components/company/AddEmployeesModal';
import EmployeeHistoryModal from '../../../components/company/EmployeeHistoryModal';
import { usePortalTerms } from '../../../components/company/OrgTermsContext';

export default function CompanyEmployeesPage() {
    return (
        <Suspense fallback={<Spinner />}>
            <EmployeesContent />
        </Suspense>
    );
}

function EmployeesContent() {
    const { language } = useApp();
    const isAr = language === 'ar';
    const ot = usePortalTerms(isAr);
    const params = useSearchParams();

    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState(params.get('status') || 'all');
    const [groupFilter, setGroupFilter] = useState(params.get('group') || 'all');
    const [officeFilter, setOfficeFilter] = useState('all');
    const [selected, setSelected] = useState(new Set());
    const [addOpen, setAddOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [historyOf, setHistoryOf] = useState(null);
    const [busyId, setBusyId] = useState('');
    const [bulkBusy, setBulkBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            setData(await companyPortalApi.getEmployees());
            setError('');
        } catch (err) {
            setError(errorText(err, isAr));
        }
    }, [isAr]);

    useEffect(() => { load(); }, [load]);

    const rows = useMemo(() => {
        if (!data) return [];
        const q = search.trim().toLowerCase();
        return data.rows.filter((r) => {
            if (status !== 'all' && r.status !== status) return false;
            if (groupFilter === 'none' && (r.group_id || r.limit_source === 'override')) return false;
            if (groupFilter !== 'all' && groupFilter !== 'none' && String(r.group_id) !== groupFilter) return false;
            if (officeFilter !== 'all' && String(r.office_id) !== officeFilter) return false;
            if (!q) return true;
            return [r.name, r.email, r.phone].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
        });
    }, [data, search, status, groupFilter, officeFilter]);

    const memberRows = rows.filter((r) => r.kind === 'member');
    const expiredCount = data ? data.rows.filter((r) => r.status === 'expired').length : 0;

    const toggle = (id) => setSelected((cur) => {
        const next = new Set(cur);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const allSelected = memberRows.length > 0 && memberRows.every((r) => selected.has(r._id));
    const toggleAll = () => setSelected(allSelected ? new Set() : new Set(memberRows.map((r) => r._id)));

    const run = async (id, fn, successText) => {
        setBusyId(id);
        setError('');
        try {
            await fn();
            if (successText) setMessage(successText);
            await load();
        } catch (err) {
            setError(errorText(err, isAr));
        } finally {
            setBusyId('');
        }
    };

    const removeMember = (row) => {
        const text = row.is_manager
            ? (isAr ? `شيل ${row.name} من ${ot.members}؟ هيفضل مدير للحساب بس مش هيبقى ليه ليميت.` : `Remove ${row.name} as ${ot.aMember}? They stay a manager but lose their limit.`)
            : (isAr ? `شيل ${row.name} من ${ot.the}؟ مش هيقدر يطلب على حساب ${ot.the}، والأوردرات اللي طلبها قبل كده هتكمل وتتحسب على ${ot.the}.` : `Remove ${row.name}? They can no longer order on the ${ot.one} account; orders already placed continue and are billed to the ${ot.one}.`);
        if (!confirm(text)) return;
        run(row._id, () => companyPortalApi.removeEmployee(row._id), isAr ? 'اتشال' : 'Removed');
    };

    const setActive = (row, active) => {
        if (!active && !confirm(isAr
            ? `وقّف ${row.name}؟ مش هيقدر يطلب على حساب ${ot.the} لحد ما ترجّعه. الأوردرات اللي طلبها قبل كده بتكمل، والجروب والليميت بيفضلوا زي ما هما.`
            : `Pause ${row.name}? They cannot order on the ${ot.one} account until you resume them. Orders already placed continue; their group and limit stay as they are.`)) return;
        run(row._id,
            () => (active ? companyPortalApi.reactivateEmployee(row._id) : companyPortalApi.deactivateEmployee(row._id)),
            active ? (isAr ? 'رجع يطلب تاني' : 'Resumed') : (isAr ? 'اتوقف' : 'Paused'));
    };

    const bulk = async (action, extra = {}) => {
        const ids = [...selected];
        if (!ids.length) return;
        if (action === 'remove' && !confirm(isAr ? `شيل ${ids.length} ${ot.member} من ${ot.the}؟` : `Remove ${ids.length} ${ot.member}(s)?`)) return;
        if (action === 'deactivate' && !confirm(isAr ? `وقّف ${ids.length} ${ot.member}؟ مش هيقدروا يطلبوا على حساب ${ot.the} لحد ما ترجّعهم.` : `Pause ${ids.length} ${ot.member}(s)? They cannot order on the ${ot.one} account until resumed.`)) return;
        setBulkBusy(true);
        setError('');
        try {
            const res = await companyPortalApi.bulkEmployees({ membership_ids: ids, action, ...extra });
            setMessage(isAr ? `اتعدل ${res.updated} ${ot.member}` : `${res.updated} ${ot.member}(s) updated`);
            setSelected(new Set());
            await load();
        } catch (err) {
            setError(errorText(err, isAr));
        } finally {
            setBulkBusy(false);
        }
    };

    const resendExpired = () => run('expired', async () => {
        const res = await companyPortalApi.resendExpired(isAr ? 'ar' : 'en');
        setMessage(isAr ? `اتبعت تاني لـ ${res.resent}` : `Resent to ${res.resent}`);
        if (res.failed?.length) setError(isAr ? `${res.failed.length} ماتبعتش` : `${res.failed.length} could not be resent`);
    });

    if (!data) return error ? <Notice>{error}</Notice> : <Spinner />;

    const groups = data.groups || [];
    const offices = data.offices || [];

    return (
        <div>
            <PageHeader
                title={isAr ? `${ot.members}` : `${ot.Members}`}
                subtitle={isAr
                    ? `صرف ${formatMonth(data.month, true)} — الليميتات بتتجدد ${formatDate(data.renews_on, true)}`
                    : `Spend for ${formatMonth(data.month, false)} — limits renew on ${formatDate(data.renews_on, false)}`}
                actions={(
                    <>
                        {expiredCount > 0 && (
                            <Button variant="secondary" icon={RefreshCw} loading={busyId === 'expired'} onClick={resendExpired}>
                                {isAr ? `ابعت تاني للمنتهيين (${expiredCount})` : `Resend expired (${expiredCount})`}
                            </Button>
                        )}
                        <Button icon={UserPlus} onClick={() => setAddOpen(true)}>{isAr ? `إضافة ${ot.membersN}` : `Add ${ot.members}`}</Button>
                    </>
                )}
            />

            {error && <Notice onClose={() => setError('')}>{error}</Notice>}
            {message && <Notice tone="success" onClose={() => setMessage('')}>{message}</Notice>}

            <div className={`${CARD} p-4 mb-4 grid grid-cols-1 md:grid-cols-4 gap-3`}>
                <div className="relative md:col-span-1">
                    <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input className={`${INPUT} w-full ps-9`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder={isAr ? 'اسم، إيميل، موبايل' : 'Name, email, mobile'} />
                </div>
                <select className={INPUT} value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="all">{isAr ? 'كل الحالات' : 'All statuses'}</option>
                    {['joined', 'deactivated', 'pending', 'expired', 'declined'].map((s) => <option key={s} value={s}>{memberStatusLabel(s, isAr)}</option>)}
                </select>
                <select className={INPUT} value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
                    <option value="all">{isAr ? 'كل الجروبات' : 'All groups'}</option>
                    <option value="none">{isAr ? 'من غير جروب' : 'No group'}</option>
                    {groups.map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}
                </select>
                <select className={INPUT} value={officeFilter} onChange={(e) => setOfficeFilter(e.target.value)}>
                    <option value="all">{isAr ? `كل ${ot.branches}` : `All ${ot.branches}`}</option>
                    {offices.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
                </select>
            </div>

            {selected.size > 0 && (
                <div className={`${CARD} p-3 mb-4 flex flex-wrap items-center gap-2 sticky top-0 z-10`}>
                    <span className="text-sm font-bold text-zinc-700 dark:text-zinc-200 me-2">
                        {isAr ? `${selected.size} متحددين` : `${selected.size} selected`}
                    </span>
                    <select className={`${INPUT} py-1.5`} defaultValue="" disabled={bulkBusy}
                        onChange={(e) => { if (e.target.value !== '') bulk('move_group', { group_id: e.target.value === 'none' ? null : e.target.value }); e.target.value = ''; }}>
                        <option value="" disabled>{isAr ? 'نقل لجروب…' : 'Move to group…'}</option>
                        <option value="none">{isAr ? 'من غير جروب' : 'No group'}</option>
                        {groups.map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}
                    </select>
                    <select className={`${INPUT} py-1.5`} defaultValue="" disabled={bulkBusy}
                        onChange={(e) => { if (e.target.value) bulk('move_office', { office_id: e.target.value }); e.target.value = ''; }}>
                        <option value="" disabled>{isAr ? `نقل ل${ot.branch}…` : `Move to ${ot.branch}…`}</option>
                        {offices.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
                    </select>
                    <Button variant="secondary" icon={PauseCircle} loading={bulkBusy} onClick={() => bulk('deactivate')}>{isAr ? 'وقّف' : 'Pause'}</Button>
                    <Button variant="secondary" icon={PlayCircle} loading={bulkBusy} onClick={() => bulk('reactivate')}>{isAr ? 'رجّع' : 'Resume'}</Button>
                    <Button variant="danger" icon={Trash2} loading={bulkBusy} onClick={() => bulk('remove')}>{isAr ? 'شيل' : 'Remove'}</Button>
                    <Button variant="ghost" onClick={() => setSelected(new Set())}>{isAr ? 'إلغاء التحديد' : 'Clear'}</Button>
                </div>
            )}

            <div className={CARD}>
                {rows.length === 0 ? (
                    <EmptyState
                        icon={Users}
                        title={data.rows.length ? (isAr ? 'مفيش نتايج' : 'No matches') : (isAr ? `لسه مفيش ${ot.membersN}` : `No ${ot.members} yet`)}
                        message={data.rows.length
                            ? (isAr ? 'غيّر البحث أو الفلاتر.' : 'Change the search or filters.')
                            : (isAr ? `ارفع ملف Excel أو ضيف ${ot.member} بإيدك.` : 'Upload an Excel file or add someone by hand.')}
                    />
                ) : (
                    <>
                        {/* Desktop table */}
                        <div className="hidden md:block">
                            <TableWrap>
                                <table className="w-full">
                                    <thead className="border-b border-zinc-100 dark:border-white/5">
                                        <tr>
                                            <Th className="w-10">
                                                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-marine-cyan w-4 h-4" aria-label={isAr ? 'تحديد الكل' : 'Select all'} />
                                            </Th>
                                            <Th align="start">{isAr ? `${ot.theMember}` : `${ot.Member}`}</Th>
                                            <Th align="start">{isAr ? 'الحالة' : 'Status'}</Th>
                                            <Th align="start">{isAr ? 'الجروب' : 'Group'}</Th>
                                            <Th align="start">{isAr ? `${ot.theBranch}` : `${ot.Branch}`}</Th>
                                            <Th align="start">{isAr ? 'الليميت' : 'Limit'}</Th>
                                            <Th align="start">{isAr ? 'صرف الشهر' : 'Spent'}</Th>
                                            <Th align="end">{isAr ? 'إجراءات' : 'Actions'}</Th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                        {rows.map((row) => (
                                            <tr key={`${row.kind}-${row._id}`} className="hover:bg-zinc-50/60 dark:hover:bg-white/[0.02]">
                                                <Td>
                                                    {row.kind === 'member' && (
                                                        <input type="checkbox" checked={selected.has(row._id)} onChange={() => toggle(row._id)} className="accent-marine-cyan w-4 h-4" />
                                                    )}
                                                </Td>
                                                <Td align="start"><PersonCell row={row} isAr={isAr} /></Td>
                                                <Td align="start"><Pill className={memberStatusClass(row.status)}>{memberStatusLabel(row.status, isAr)}</Pill></Td>
                                                <Td align="start" className="text-zinc-600 dark:text-zinc-300">{row.group_name || '—'}</Td>
                                                <Td align="start" className="text-zinc-600 dark:text-zinc-300">{row.office_name || '—'}</Td>
                                                <Td align="start"><LimitCell row={row} isAr={isAr} /></Td>
                                                <Td align="start">{row.kind === 'member' ? <span dir="ltr" className="tabular-nums">{formatMoney(row.spent, isAr)}</span> : '—'}</Td>
                                                <Td align="end"><RowActions row={row} isAr={isAr} busy={busyId === row._id} onEdit={() => setEditing(row)} onRemove={() => removeMember(row)} onSetActive={(active) => setActive(row, active)} onHistory={() => setHistoryOf(row)} run={run} /></Td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableWrap>
                        </div>

                        {/* Mobile cards */}
                        <ul className="md:hidden divide-y divide-zinc-100 dark:divide-white/5">
                            {rows.map((row) => (
                                <li key={`${row.kind}-${row._id}`} className="p-4 space-y-2">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-start gap-3 min-w-0">
                                            {row.kind === 'member' && (
                                                <input type="checkbox" checked={selected.has(row._id)} onChange={() => toggle(row._id)} className="accent-marine-cyan w-4 h-4 mt-1" />
                                            )}
                                            <PersonCell row={row} isAr={isAr} />
                                        </div>
                                        <Pill className={memberStatusClass(row.status)}>{memberStatusLabel(row.status, isAr)}</Pill>
                                    </div>
                                    <p className="text-xs text-zinc-500">{[row.group_name, row.office_name].filter(Boolean).join(' · ') || '—'}</p>
                                    <div className="flex items-center justify-between gap-3">
                                        <LimitCell row={row} isAr={isAr} />
                                        <RowActions row={row} isAr={isAr} busy={busyId === row._id} onEdit={() => setEditing(row)} onRemove={() => removeMember(row)} onSetActive={(active) => setActive(row, active)} onHistory={() => setHistoryOf(row)} run={run} />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </div>

            <AddEmployeesModal
                open={addOpen}
                onClose={() => setAddOpen(false)}
                onDone={load}
                groups={groups}
                offices={offices}
                isAr={isAr}
            />

            <EmployeeHistoryModal row={historyOf} isAr={isAr} onClose={() => setHistoryOf(null)} />

            <EditEmployeeModal
                row={editing}
                groups={groups}
                offices={offices}
                defaultLimit={data.default_limit}
                isAr={isAr}
                onClose={() => setEditing(null)}
                onSaved={async (text) => { setEditing(null); setMessage(text); await load(); }}
            />
        </div>
    );
}

function PersonCell({ row, isAr }) {
    return (
        <div className="min-w-0">
            <p className="font-bold text-zinc-900 dark:text-white truncate">
                {row.name || (isAr ? 'بدون اسم' : 'No name')}
                {row.is_manager && <span className="ms-2 text-[10px] font-black uppercase text-marine-primary">{isAr ? 'مدير' : 'Manager'}</span>}
            </p>
            <p className="text-xs text-zinc-500 truncate" dir="ltr">{row.email || row.phone || ''}</p>
        </div>
    );
}

function LimitCell({ row, isAr }) {
    if (row.kind !== 'member') return <span className="text-zinc-400">—</span>;
    return (
        <div>
            <p className="font-bold tabular-nums" dir="ltr">{formatLimit(row.limit, isAr)}</p>
            <p className="text-[11px] text-zinc-500">{limitSourceLabel(row.limit_source, isAr)}</p>
        </div>
    );
}

function RowActions({ row, isAr, busy, onEdit, onRemove, onSetActive, onHistory, run }) {
    if (row.kind === 'member') {
        const paused = row.status === 'deactivated';
        return (
            <div className="inline-flex gap-1">
                <button type="button" onClick={onEdit} className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5" title={isAr ? 'تعديل' : 'Edit'}>
                    <Pencil size={16} />
                </button>
                <button type="button" onClick={onHistory} className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5" title={isAr ? 'السجل' : 'History'}>
                    <History size={16} />
                </button>
                <button type="button" onClick={() => onSetActive(paused)} disabled={busy}
                    className={`p-2 rounded-lg disabled:opacity-50 ${paused ? 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10' : 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-500/10'}`}
                    title={paused ? (isAr ? 'رجّعه يطلب' : 'Resume ordering') : (isAr ? 'وقّف الطلب' : 'Pause ordering')}>
                    {paused ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
                </button>
                <button type="button" onClick={onRemove} disabled={busy} className="p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50" title={isAr ? 'شيل' : 'Remove'}>
                    <Trash2 size={16} />
                </button>
            </div>
        );
    }
    const canResend = row.status === 'pending' || row.status === 'expired';
    return (
        <div className="inline-flex gap-1">
            {canResend && (
                <button type="button" disabled={busy}
                    onClick={() => run(row._id, () => companyPortalApi.resendInvitation(row._id, isAr ? 'ar' : 'en'), isAr ? 'الدعوة اتبعتت تاني' : 'Invitation resent')}
                    className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 disabled:opacity-50" title={isAr ? 'ابعت تاني' : 'Resend'}>
                    <Send size={16} />
                </button>
            )}
            {canResend && (
                <button type="button" disabled={busy}
                    onClick={() => { if (confirm(isAr ? 'إلغاء الدعوة؟' : 'Cancel this invitation?')) run(row._id, () => companyPortalApi.revokeInvitation(row._id), isAr ? 'الدعوة اتلغت' : 'Invitation cancelled'); }}
                    className="p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50" title={isAr ? 'إلغاء الدعوة' : 'Cancel invitation'}>
                    <XCircle size={16} />
                </button>
            )}
        </div>
    );
}

function EditEmployeeModal({ row, groups, offices, defaultLimit, isAr, onClose, onSaved }) {
    const ot = usePortalTerms(isAr);
    const [form, setForm] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (row) {
            setForm({
                group_id: row.group_id || '',
                office_id: row.office_id || '',
                useOverride: row.limit_override !== null && row.limit_override !== undefined,
                limit_override: row.limit_override ?? '',
            });
            setError('');
        }
    }, [row]);

    if (!row || !form) return null;

    const groupLimit = groups.find((g) => g._id === form.group_id)?.limit;
    const inheritedLimit = groupLimit ?? defaultLimit;
    const newLimit = form.useOverride ? Number(form.limit_override || 0) : inheritedLimit;
    const overBy = row.spent > newLimit;

    const save = async () => {
        setBusy(true);
        setError('');
        try {
            await companyPortalApi.updateEmployee(row._id, {
                group_id: form.group_id || null,
                office_id: form.office_id,
                limit_override: form.useOverride ? Number(form.limit_override || 0) : null,
            });
            onSaved(isAr ? 'اتحفظ' : 'Saved');
        } catch (err) {
            setError(errorText(err, isAr));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            open={!!row}
            onClose={onClose}
            title={isAr ? `تعديل ${row.name}` : `Edit ${row.name}`}
            footer={(
                <>
                    <Button variant="ghost" onClick={onClose}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
                    <Button onClick={save} loading={busy}>{isAr ? 'حفظ' : 'Save'}</Button>
                </>
            )}
        >
            {error && <Notice>{error}</Notice>}
            <div className="space-y-4">
                <Field label={isAr ? 'الجروب' : 'Group'}>
                    <select className={`${INPUT} w-full`} value={form.group_id} onChange={(e) => setForm({ ...form, group_id: e.target.value })}>
                        <option value="">{isAr ? `من غير جروب — الافتراضي ${formatMoney(defaultLimit, true)}` : `No group — default ${formatMoney(defaultLimit, false)}`}</option>
                        {groups.map((g) => <option key={g._id} value={g._id}>{`${g.name} — ${formatMoney(g.limit, isAr)}`}</option>)}
                    </select>
                </Field>
                <Field label={isAr ? `${ot.theBranch}` : `${ot.Branch}`}>
                    <select className={`${INPUT} w-full`} value={form.office_id} onChange={(e) => setForm({ ...form, office_id: e.target.value })}>
                        {offices.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
                    </select>
                </Field>
                <label className="flex items-center gap-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                    <input type="checkbox" className="accent-marine-cyan w-4 h-4" checked={form.useOverride} onChange={(e) => setForm({ ...form, useOverride: e.target.checked })} />
                    {isAr ? `ليميت خاص لـ${ot.theMember} ده` : `A personal limit for this ${ot.member}`}
                </label>
                {form.useOverride && (
                    <Field label={isAr ? 'الليميت الشهري (شامل الشحن)' : 'Monthly limit (shipping included)'} hint={isAr ? `صفر معناه إنه مش هيقدر يطلب على حساب ${ot.the}.` : `Zero means they cannot order on the ${ot.one} account.`}>
                        <input type="number" min="0" step="1" dir="ltr" className={`${INPUT} w-full`} value={form.limit_override} onChange={(e) => setForm({ ...form, limit_override: e.target.value })} />
                    </Field>
                )}
                {overBy && (
                    <Notice tone="warn">
                        {isAr
                            ? `صرف ${formatMoney(row.spent, true)} الشهر ده، أكتر من الليميت الجديد. مش هيقدر يطلب تاني لحد أول الشهر الجاي، والأوردرات اللي اتعملت مش هتتلغي.`
                            : `They have spent ${formatMoney(row.spent, false)} this month, more than the new limit. They cannot order again until next month; orders already placed are not cancelled.`}
                    </Notice>
                )}
            </div>
        </Modal>
    );
}
