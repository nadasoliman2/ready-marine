'use client';

import { useMemo, useState } from 'react';
import { FileSpreadsheet, UserPlus, Download, Upload, CheckCircle2, AlertTriangle } from 'lucide-react';
import { companyPortalApi, downloadFile } from '../../lib/api';
import { importStatusLabel, errorText } from '../../lib/companyLocalization';
import { Modal, Button, Field, Notice, INPUT, TableWrap, Th, Td, Pill } from './CompanyUI';
import { usePortalTerms } from './OrgTermsContext';

const OK_STATUSES = ['valid', 'make_employee'];

/**
 * "Add employees": one person by hand, or many from an Excel file.
 *
 * The Excel path never sends straight from the upload. The file is read, every
 * row is shown with what sending it would do, the manager fixes or skips rows,
 * and only then are the invitations sent — each one re-checked by the server.
 */
export default function AddEmployeesModal({ open, onClose, onDone, groups = [], offices = [], isAr }) {
    const ot = usePortalTerms(isAr);
    const [mode, setMode] = useState(null); // null | 'manual' | 'excel'
    const close = () => { setMode(null); onClose(); };

    return (
        <Modal
            open={open}
            onClose={close}
            wide={mode === 'excel'}
            title={mode === 'manual'
                ? (isAr ? `إضافة ${ot.member}` : `Add ${ot.aMember}`)
                : mode === 'excel'
                    ? (isAr ? `إضافة ${ot.membersN} من Excel` : `Add ${ot.members} from Excel`)
                    : (isAr ? `إضافة ${ot.membersN}` : `Add ${ot.members}`)}
        >
            {mode === null && (
                <div className="grid sm:grid-cols-2 gap-3">
                    <ChoiceCard
                        icon={FileSpreadsheet}
                        title={isAr ? 'رفع ملف Excel' : 'Upload an Excel file'}
                        body={isAr ? `لستة ${ot.membersN} مرة واحدة. هتشوف كل صف قبل ما الدعوات تتبعت.` : 'A whole list at once. You review every row before anything is sent.'}
                        onClick={() => setMode('excel')}
                    />
                    <ChoiceCard
                        icon={UserPlus}
                        title={isAr ? 'إضافة يدوية' : 'Add by hand'}
                        body={isAr ? `${ot.member} واحد بالإيميل أو رقم الموبايل.` : `One ${ot.member} by email or mobile number.`}
                        onClick={() => setMode('manual')}
                    />
                </div>
            )}
            {mode === 'manual' && (
                <ManualInvite groups={groups} offices={offices} isAr={isAr} onDone={() => { onDone(); close(); }} />
            )}
            {mode === 'excel' && (
                <ExcelImport groups={groups} offices={offices} isAr={isAr} onDone={onDone} onClose={close} />
            )}
        </Modal>
    );
}

function ChoiceCard({ icon: Icon, title, body, onClick }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="text-start rounded-2xl border border-zinc-200 dark:border-white/10 p-5 hover:border-marine-cyan hover:bg-red-50/40 dark:hover:bg-marine-cyan/5 transition-all"
        >
            <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-marine-cyan/10 text-marine-primary flex items-center justify-center mb-3">
                <Icon size={20} />
            </div>
            <p className="font-black text-zinc-900 dark:text-white">{title}</p>
            <p className="text-sm text-zinc-500 mt-1">{body}</p>
        </button>
    );
}

function GroupOfficeSelects({ groupId, officeId, onChange, groups, offices, isAr, compact = false }) {
    const ot = usePortalTerms(isAr);
    const cls = `${INPUT} w-full ${compact ? 'py-1.5 text-xs' : ''}`;
    return (
        <>
            <select className={cls} value={groupId || ''} onChange={(e) => onChange({ group_id: e.target.value || null })}>
                <option value="">{compact ? (isAr ? 'من غير جروب' : 'No group') : (isAr ? 'من غير جروب (الليميت الافتراضي)' : 'No group (default limit)')}</option>
                {groups.map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}
            </select>
            <select className={cls} value={officeId || ''} onChange={(e) => onChange({ office_id: e.target.value || null })}>
                <option value="">{isAr ? `أول ${ot.branch}` : `First ${ot.branch}`}</option>
                {offices.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
            </select>
        </>
    );
}

function ManualInvite({ groups, offices, isAr, onDone }) {
    const ot = usePortalTerms(isAr);
    const [form, setForm] = useState({ name: '', identifier: '', group_id: null, office_id: null });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(null);

    const submit = async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            const res = await companyPortalApi.inviteEmployee({ ...form, language: isAr ? 'ar' : 'en' });
            setDone(res.direct ? 'direct' : 'sent');
        } catch (err) {
            setError(errorText(err, isAr));
        } finally {
            setBusy(false);
        }
    };

    if (done) {
        return (
            <div className="text-center py-4">
                <CheckCircle2 size={40} className="text-emerald-500 mx-auto mb-3" />
                <p className="font-black text-zinc-900 dark:text-white">
                    {done === 'direct'
                        ? (isAr ? `اتضاف ك${ot.member} على طول` : `Added as ${ot.aMember} straight away`)
                        : (isAr ? 'الدعوة اتبعتت' : 'Invitation sent')}
                </p>
                <p className="text-sm text-zinc-500 mt-1">
                    {done === 'direct'
                        ? (isAr ? 'الشخص ده مدير في الحساب، فمش محتاج دعوة.' : 'This person already manages the account, so no invitation was needed.')
                        : (isAr ? 'هيظهر في الجدول "مستني يقبل" لحد ما يرد. الدعوة صالحة 14 يوم.' : 'They appear as "Pending" until they answer. The invitation is valid for 14 days.')}
                </p>
                <Button className="mt-5" onClick={onDone}>{isAr ? 'تمام' : 'Done'}</Button>
            </div>
        );
    }

    return (
        <form onSubmit={submit} className="space-y-4">
            {error && <Notice>{error}</Notice>}
            <Field label={isAr ? 'الاسم (اختياري)' : 'Name (optional)'}>
                <input className={`${INPUT} w-full`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field
                label={isAr ? 'الإيميل أو رقم الموبايل' : 'Email or mobile number'}
                hint={isAr ? 'الموبايل بيوصله الدعوة على واتساب، والإيميل بيوصله على الإيميل.' : 'A mobile gets the invitation on WhatsApp; an email gets it by email.'}
            >
                <input required className={`${INPUT} w-full`} dir="ltr" value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} placeholder="name@company.com / 01xxxxxxxxx" />
            </Field>
            <div className="grid sm:grid-cols-2 gap-3">
                <Field label={isAr ? 'الجروب' : 'Group'}>
                    <select className={`${INPUT} w-full`} value={form.group_id || ''} onChange={(e) => setForm({ ...form, group_id: e.target.value || null })}>
                        <option value="">{isAr ? 'من غير جروب' : 'No group'}</option>
                        {groups.map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}
                    </select>
                </Field>
                <Field label={isAr ? `${ot.theBranch}` : `${ot.Branch}`}>
                    <select className={`${INPUT} w-full`} value={form.office_id || ''} onChange={(e) => setForm({ ...form, office_id: e.target.value || null })}>
                        <option value="">{isAr ? `أول ${ot.branch}` : `First ${ot.branch}`}</option>
                        {offices.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
                    </select>
                </Field>
            </div>
            <div className="flex justify-end">
                <Button type="submit" loading={busy} icon={UserPlus}>{isAr ? 'ابعت الدعوة' : 'Send invitation'}</Button>
            </div>
        </form>
    );
}

function ExcelImport({ groups, offices, isAr, onDone, onClose }) {
    const ot = usePortalTerms(isAr);
    const [file, setFile] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [rows, setRows] = useState(null);
    const [result, setResult] = useState(null);

    const readFile = async () => {
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.xlsx')) {
            setError(isAr ? 'الملف لازم يكون .xlsx' : 'The file must be .xlsx');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setError(isAr ? 'الملف أكبر من 5 ميجا' : 'The file is larger than 5 MB');
            return;
        }
        setBusy(true);
        setError('');
        try {
            const res = await companyPortalApi.previewImport(file);
            setRows(res.rows.map((r) => ({ ...r, include: r.sendable, edited: false })));
        } catch (err) {
            setError(errorText(err, isAr));
        } finally {
            setBusy(false);
        }
    };

    const updateRow = (index, patch) => {
        setRows((current) => current.map((r, i) => (i === index ? { ...r, ...patch, edited: true, include: true } : r)));
    };

    const toSend = useMemo(() => (rows || []).filter((r) => r.include), [rows]);
    const problemCount = (rows || []).filter((r) => !OK_STATUSES.includes(r.status) && !r.edited).length;

    const send = async () => {
        setBusy(true);
        setError('');
        try {
            const res = await companyPortalApi.importEmployees(
                toSend.map(({ row_number, name, identifier, group_id, office_id }) => ({ row_number, name, identifier, group_id, office_id })),
                isAr ? 'ar' : 'en'
            );
            setResult(res);
            onDone();
        } catch (err) {
            setError(errorText(err, isAr));
        } finally {
            setBusy(false);
        }
    };

    if (result) {
        return (
            <div className="py-2">
                <div className="text-center mb-4">
                    <CheckCircle2 size={40} className="text-emerald-500 mx-auto mb-3" />
                    <p className="font-black text-zinc-900 dark:text-white">
                        {isAr ? `اتبعت ${result.sent} دعوة` : `${result.sent} invitation(s) sent`}
                    </p>
                    {result.made_employee > 0 && (
                        <p className="text-sm text-zinc-500 mt-1">
                            {isAr ? `و${result.made_employee} مدير بقى ليهم ليميت من غير دعوة` : `and ${result.made_employee} manager(s) got a limit without an invitation`}
                        </p>
                    )}
                </div>
                {result.failed.length > 0 && (
                    <Notice tone="warn">
                        <p className="mb-2">{isAr ? `${result.failed.length} صف ماتبعتش:` : `${result.failed.length} row(s) were not sent:`}</p>
                        <ul className="space-y-1 text-xs">
                            {result.failed.map((f) => (
                                <li key={`${f.row_number}-${f.identifier}`}>
                                    {isAr ? `صف ${f.row_number}` : `Row ${f.row_number}`} — <span dir="ltr">{f.identifier}</span>: {errorText(f, isAr)}
                                </li>
                            ))}
                        </ul>
                    </Notice>
                )}
                <div className="flex justify-end"><Button onClick={onClose}>{isAr ? 'تمام' : 'Done'}</Button></div>
            </div>
        );
    }

    if (!rows) {
        return (
            <div className="space-y-5">
                {error && <Notice>{error}</Notice>}
                <div className="rounded-xl border border-zinc-100 dark:border-white/5 p-4">
                    <p className="font-bold text-sm text-zinc-900 dark:text-white mb-1">{isAr ? '1. نزّل الشيت الجاهز' : '1. Download the template'}</p>
                    <p className="text-xs text-zinc-500 mb-3">
                        {isAr ? `فيه أعمدة الاسم والإيميل أو الموبايل، والجروبات و${ot.branches} بتاعتك جاهزة كاختيارات.` : `It has columns for name and email or mobile, with your groups and ${ot.branches} ready as choices.`}
                    </p>
                    <Button variant="secondary" icon={Download} onClick={() => downloadFile(companyPortalApi.employeesTemplateUrl())}>{isAr ? 'تحميل الشيت' : 'Download template'}</Button>
                </div>
                <div className="rounded-xl border border-zinc-100 dark:border-white/5 p-4">
                    <p className="font-bold text-sm text-zinc-900 dark:text-white mb-1">{isAr ? '2. ارفع الملف بعد ما تملاه' : '2. Upload the filled file'}</p>
                    <p className="text-xs text-zinc-500 mb-3">{isAr ? 'مش هيتبعت حاجة دلوقتي — هتشوف كل صف الأول.' : 'Nothing is sent yet — you will see every row first.'}</p>
                    <label
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files?.[0]) setFile(e.dataTransfer.files[0]); }}
                        className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-200 dark:border-white/10 py-8 cursor-pointer hover:border-marine-cyan transition-colors"
                    >
                        <Upload size={24} className="text-zinc-400" />
                        <span className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
                            {file ? file.name : (isAr ? 'اسحب الملف هنا أو دوس للاختيار' : 'Drop the file here or click to choose')}
                        </span>
                        <input type="file" accept=".xlsx" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                    </label>
                    <div className="flex justify-end mt-3">
                        <Button onClick={readFile} loading={busy} disabled={!file}>{isAr ? 'اقرا الملف' : 'Read the file'}</Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div>
            {error && <Notice>{error}</Notice>}
            <div className="flex flex-wrap gap-2 mb-3 text-xs font-bold">
                <Pill className="bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                    {isAr ? `${rows.filter((r) => OK_STATUSES.includes(r.status)).length} سليم` : `${rows.filter((r) => OK_STATUSES.includes(r.status)).length} valid`}
                </Pill>
                {problemCount > 0 && (
                    <Pill className="bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                        {isAr ? `${problemCount} محتاج تصليح أو هيتتجاهل` : `${problemCount} to fix or skip`}
                    </Pill>
                )}
            </div>
            <TableWrap>
                <table className="w-full min-w-[720px]">
                    <thead className="border-b border-zinc-100 dark:border-white/5">
                        <tr>
                            <Th className="w-10" />
                            <Th>{isAr ? 'صف' : 'Row'}</Th>
                            <Th>{isAr ? 'الاسم' : 'Name'}</Th>
                            <Th>{isAr ? 'الإيميل أو الموبايل' : 'Email or mobile'}</Th>
                            <Th>{isAr ? `الجروب / ${ot.theBranch}` : `Group / ${ot.branch}`}</Th>
                            <Th>{isAr ? 'الحالة' : 'Status'}</Th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                        {rows.map((row, index) => {
                            const ok = OK_STATUSES.includes(row.status);
                            const fixable = !ok && ['invalid_contact', 'duplicate', 'unknown_group', 'unknown_office'].includes(row.status);
                            return (
                                <tr key={`${row.row_number}-${index}`} className={row.include ? '' : 'opacity-50'}>
                                    <Td>
                                        <input
                                            type="checkbox"
                                            checked={row.include}
                                            disabled={!ok && !row.edited}
                                            onChange={(e) => setRows((cur) => cur.map((r, i) => (i === index ? { ...r, include: e.target.checked } : r)))}
                                            className="accent-marine-cyan w-4 h-4"
                                        />
                                    </Td>
                                    <Td className="text-zinc-500 tabular-nums">{row.row_number}</Td>
                                    <Td>
                                        {fixable ? (
                                            <input className={`${INPUT} w-full py-1.5 text-xs`} value={row.name} onChange={(e) => updateRow(index, { name: e.target.value })} />
                                        ) : <span className="text-zinc-900 dark:text-white">{row.name || '—'}</span>}
                                    </Td>
                                    <Td>
                                        {fixable ? (
                                            <input dir="ltr" className={`${INPUT} w-full py-1.5 text-xs`} value={row.identifier} onChange={(e) => updateRow(index, { identifier: e.target.value })} />
                                        ) : <span dir="ltr" className="text-zinc-700 dark:text-zinc-300">{row.identifier}</span>}
                                    </Td>
                                    <Td>
                                        {fixable ? (
                                            <div className="grid gap-1.5">
                                                <GroupOfficeSelects
                                                    compact
                                                    groupId={row.group_id}
                                                    officeId={row.office_id}
                                                    groups={groups}
                                                    offices={offices}
                                                    isAr={isAr}
                                                    onChange={(patch) => updateRow(index, patch)}
                                                />
                                            </div>
                                        ) : (
                                            <span className="text-xs text-zinc-500">{[row.group_name, row.office_name].filter(Boolean).join(' · ') || '—'}</span>
                                        )}
                                    </Td>
                                    <Td>
                                        {row.edited ? (
                                            <Pill className="bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400">{isAr ? 'اتعدل — هيتتشيك وقت الإرسال' : 'Edited — checked on send'}</Pill>
                                        ) : (
                                            <Pill className={ok ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'}>
                                                {!ok && <AlertTriangle size={12} className="me-1" />}
                                                {importStatusLabel(row.status, isAr)}
                                            </Pill>
                                        )}
                                    </Td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </TableWrap>
            <div className="flex flex-wrap justify-between gap-2 mt-4">
                <Button variant="ghost" onClick={() => { setRows(null); setFile(null); }}>{isAr ? 'ملف تاني' : 'Another file'}</Button>
                <Button onClick={send} loading={busy} disabled={!toSend.length}>
                    {isAr ? `ابعت ${toSend.length} دعوة` : `Send ${toSend.length} invitation(s)`}
                </Button>
            </div>
        </div>
    );
}
